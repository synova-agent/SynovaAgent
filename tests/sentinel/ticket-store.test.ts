/**
 * tests/sentinel/ticket-store.test.ts — D580 8-2/8-3: 工单表读同源 + 通知去重持久化
 *
 * 契约（铁律 47/48, spec §5.2/§5.3）:
 *   listSentinelTickets(status?) — 表读: 有行返回行（created_at DESC, LIMIT 200）; db 失败/表不存在 → 抛出
 *     （降级决策单点在 sentinel-service, 铁律 31）。
 *   getSentinelTickets(status?) — 表读优先: 表有行 → source:'table'; 表空/db 失败 → 内存派生 fallback
 *     + degraded:true + source:'memory-fallback'（裁决 3, 铁律 24 双标记 + log 非静默）。
 *   通知去重 — markNotificationSent 写穿内存 Map + sentinel_notification_dedup 表; isNotificationDuplicate
 *     优先读表; 重启（同库新 runner）后窗口内仍命中（B-19 裁决 2: 需复活 → 持久化）。
 *   窗口 — 缺省 5min（D339 裁决 A）; env SENTINEL_NOTIFICATION_DEDUP_MS 正整数覆盖, 非法回退缺省 + log.warn。
 *
 * 模式对齐 sentinel-runner-auto-ticket.test.ts（D466）: better-sqlite3 :memory: + 自建 DDL,
 *   不调 runner.start()（避免 cron 副作用）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SentinelRunner, setGlobalSentinelRunner } from '../../src/sentinel/runner';
import { getSentinelTickets } from '../../src/agent/sentinel-service';
import { getSentinelRegistry, destroySentinelRegistry } from '../../src/sentinel/registry';
import type { Sentinel, SentinelFinding, SentinelCheckResult } from '../../src/sentinel/types';
import type { CronScheduler } from '../../src/cron/scheduler';

// 捕获 dispatchNotification 调用（去重行为的物理观测点, 对齐 dedup-key-stability.test.ts）
const { dispatchNotificationMock, logMock } = vi.hoisted(() => ({
  dispatchNotificationMock: vi.fn(async () => ({ results: [], degraded: false })),
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock('../../src/notifications/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/notifications/registry')>()),
  dispatchNotification: dispatchNotificationMock,
}));
vi.mock('@synova/logger', () => ({ logger: logMock, createLogger: vi.fn(() => logMock) }));

const T0 = new Date('2026-09-06T10:00:00.000Z');

// 与 runner.start() 相同的 DDL（测试自建, 不依赖 start 的 cron 副作用）
const TICKET_DDL = `CREATE TABLE IF NOT EXISTS sentinel_tickets (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  expert_type TEXT NOT NULL,
  diagnosis TEXT,
  suggested_actions TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
)`;
const DEDUP_DDL = `CREATE TABLE IF NOT EXISTS sentinel_notification_dedup (
  key TEXT PRIMARY KEY,
  last_sent_ms INTEGER NOT NULL
)`;

function makeFinding(overrides: Partial<SentinelFinding> = {}): SentinelFinding {
  return {
    id: 'f1', severity: 'critical', title: '团队A: 现金流危急', description: '跑道 0.3 个月',
    evidence: [], suggestion: '应急融资', detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSentinel(id: string, findings: SentinelFinding[]): Sentinel {
  return {
    config: {
      id, name: id, description: '', category: 'growth', priority: 'P1', mode: 'manual',
      version: '1', requiredDataSources: [], confidenceModel: 'deterministic',
    },
    async check(_context): Promise<SentinelCheckResult> {
      return { sentinelId: id, ok: true, findings, durationMs: 0, checkedAt: new Date().toISOString() };
    },
  };
}

function makeRunner(db: unknown): SentinelRunner {
  return new SentinelRunner({} as unknown as CronScheduler, db);
}

function insertTicketRow(
  db: Database.Database,
  over: { id?: string; status?: string; severity?: string; createdAt?: string; signalId?: string } = {},
): void {
  db.prepare(
    `INSERT INTO sentinel_tickets (id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    over.id ?? 'ticket-sig_demo-auto',
    over.signalId ?? 'sig_demo',
    over.severity ?? 'critical',
    'auto',
    JSON.stringify({ title: '现金流危急', summary: '跑道不足', evidence: [], auto: true }),
    null,
    over.status ?? 'open',
    over.createdAt ?? '2026-09-06 09:00:00',
    over.status === 'resolved' ? '2026-09-06 09:30:00' : null,
  );
}

// #1373 (a) 卫生改进：句柄跟踪 + 顶层 afterEach 兜底关闭（**不消除 teardown 崩溃**，见卡面）
const openDbs: Database.Database[] = [];
const openDb = (): Database.Database => { const d = new Database(':memory:'); openDbs.push(d); return d; };
afterEach(() => {
  setGlobalSentinelRunner(null);
  for (const d of openDbs.splice(0)) { try { d.close(); } catch { /* 已关闭 */ } }
});

describe('D580 8-2 — listSentinelTickets 表读（L3）', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb();
    db.exec(TICKET_DDL);
  });
  afterEach(() => {
    db.close();
    setGlobalSentinelRunner(null);
  });

  it('正常路径: 插入工单后返回行, 字段对齐 DDL', () => {
    insertTicketRow(db, { id: 'ticket-a', status: 'open' });
    insertTicketRow(db, { id: 'ticket-b', status: 'resolved', createdAt: '2026-09-06 08:00:00' });
    const runner = makeRunner(db);
    const rows = runner.listSentinelTickets();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('ticket-a'); // created_at DESC
    expect(rows[0]).toMatchObject({ status: 'open', expert_type: 'auto', resolved_at: null });
    expect(rows[1].resolved_at).toBe('2026-09-06 09:30:00');
  });

  it('status 过滤真实生效（表路径 SQL WHERE）', () => {
    insertTicketRow(db, { id: 'ticket-a', status: 'open' });
    insertTicketRow(db, { id: 'ticket-b', status: 'resolved', createdAt: '2026-09-06 08:00:00' });
    const runner = makeRunner(db);
    const open = runner.listSentinelTickets('open');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe('ticket-a');
    expect(runner.listSentinelTickets('dismissed')).toHaveLength(0);
  });

  it('降级传播: 表不存在 → 抛出（L3 不吞错, 降级决策单点在 L2 — 铁律 31）', () => {
    const bareDb = openDb(); // 无 DDL
    const runner = makeRunner(bareDb);
    expect(() => runner.listSentinelTickets()).toThrow(/no such table/i);
    bareDb.close();
  });
});

describe('D580 8-2 — getSentinelTickets 表读优先 + 降级（L2 写读同源）', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb();
    db.exec(TICKET_DDL);
    destroySentinelRegistry();
    logMock.info.mockClear();
    logMock.warn.mockClear();
    logMock.error.mockClear();
  });
  afterEach(() => {
    db.close();
    setGlobalSentinelRunner(null);
  });

  function warnMessages(): string {
    return logMock.warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
  }

  it('表有行 → source:table, status 字段在场, severity emergency 映射 critical', () => {
    insertTicketRow(db, { id: 'ticket-a', status: 'open', severity: 'emergency' });
    setGlobalSentinelRunner(makeRunner(db));
    const res = getSentinelTickets();
    expect(res.ok).toBe(true);
    expect(res.source).toBe('table');
    expect(res.degraded).toBeUndefined();
    expect(res.tickets).toHaveLength(1);
    expect(res.tickets[0]).toMatchObject({
      id: 'ticket-a', status: 'open', severity: 'critical', title: '现金流危急',
    });
  });

  it('空表 → memory-fallback + degraded:true + source 标注（裁决 3: 表空即降级, 比静默空列表诚实）', async () => {
    const runner = makeRunner(db); // DDL 在但 0 行
    setGlobalSentinelRunner(runner);
    // 先在内存投影里放一条 finding（runOnce 走真实管线）
    getSentinelRegistry().register(makeSentinel('sentinel-cash-runway', [makeFinding()]));
    await runner.runOnce('sentinel-cash-runway');
    const res = getSentinelTickets();
    expect(res.ok).toBe(true);
    expect(res.source).toBe('memory-fallback');
    expect(res.degraded).toBe(true);
    expect(res.tickets.length).toBeGreaterThanOrEqual(1); // 内存派生兜底非空
    expect(res.tickets[0].id).toBe('sentinel-cash-runway_f1'); // 旧派生 id 形状（向后兼容）
  });

  it('db 句柄损坏 → fallback + log.warn 非静默（mock 断言, 铁律 24）', async () => {
    const throwingDb = { prepare: () => { throw new Error('db handle corrupted'); } };
    const runner = makeRunner(throwingDb);
    setGlobalSentinelRunner(runner);
    getSentinelRegistry().register(makeSentinel('sentinel-cash-runway', [makeFinding()]));
    await runner.runOnce('sentinel-cash-runway');
    const res = getSentinelTickets();
    expect(res.source).toBe('memory-fallback');
    expect(res.degraded).toBe(true);
    expect(res.tickets.length).toBeGreaterThanOrEqual(1);
    expect(warnMessages()).toContain('工单表读取失败'); // 降级必须留痕
  });
});
