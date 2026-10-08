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

  it('runner 未初始化 → degraded 空列表（无数据源, 不静默）', () => {
    setGlobalSentinelRunner(null);
    const res = getSentinelTickets();
    expect(res.ok).toBe(true);
    expect(res.source).toBe('memory-fallback');
    expect(res.degraded).toBe(true);
    expect(res.tickets).toEqual([]);
  });
});

describe('D580 8-3 — 通知去重持久化（B-19 裁决 2: 重启复活）', () => {
  let db: Database.Database;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    db = openDb();
    db.exec(TICKET_DDL);
    db.exec(DEDUP_DDL);
    destroySentinelRegistry();
    dispatchNotificationMock.mockClear();
    logMock.warn.mockClear();
    delete process.env.SENTINEL_NOTIFICATION_DEDUP_MS;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SENTINEL_NOTIFICATION_DEDUP_MS;
    db.close();
    setGlobalSentinelRunner(null);
  });

  async function primeOneDispatch(runner: SentinelRunner): Promise<void> {
    getSentinelRegistry().register(makeSentinel('sentinel-cash-runway', [makeFinding()]));
    await runner.runOnce('sentinel-cash-runway');
    await runner.aggregateAndDispatch();
  }

  it('runner A 发送 → 销毁 → 同库新 runner B: 窗口内不重发（重启恢复的物理证明）', async () => {
    const runnerA = makeRunner(db);
    await primeOneDispatch(runnerA);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);

    // 重启: 同库（表在）+ 新 runner 实例（内存 Map 已清空）→ 表命中去重
    const runnerB = makeRunner(db);
    await primeOneDispatch(runnerB);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1); // 不重发

    // 窗口过后 → 重发（窗口语义: 过后重新通知）
    vi.setSystemTime(new Date(T0.getTime() + 6 * 60 * 1000));
    await primeOneDispatch(runnerB);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(2);
  });

  it('窗口缺省 5min（D339 裁决 A）: 3 分钟命中去重, 6 分钟重发', async () => {
    const runner = makeRunner(db);
    await primeOneDispatch(runner);
    vi.setSystemTime(new Date(T0.getTime() + 3 * 60 * 1000));
    await primeOneDispatch(runner);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1); // < 5min 命中
    vi.setSystemTime(new Date(T0.getTime() + 6 * 60 * 1000));
    await primeOneDispatch(runner);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(2); // > 5min 重发
  });

  it('env 覆盖生效: SENTINEL_NOTIFICATION_DEDUP_MS=60000 → 1 分钟窗口', async () => {
    process.env.SENTINEL_NOTIFICATION_DEDUP_MS = '60000';
    const runner = makeRunner(db);
    await primeOneDispatch(runner);
    vi.setSystemTime(new Date(T0.getTime() + 30 * 1000));
    await primeOneDispatch(runner);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1); // < 1min 命中
    vi.setSystemTime(new Date(T0.getTime() + 61 * 1000));
    await primeOneDispatch(runner);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(2); // > 1min 重发
  });

  it('非法 env 回退缺省 + log.warn 非静默', async () => {
    process.env.SENTINEL_NOTIFICATION_DEDUP_MS = 'not-a-number';
    const runner = makeRunner(db);
    expect(logMock.warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n'))
      .toContain('SENTINEL_NOTIFICATION_DEDUP_MS');
    await primeOneDispatch(runner);
    vi.setSystemTime(new Date(T0.getTime() + 3 * 60 * 1000));
    await primeOneDispatch(runner);
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1); // 3min < 缺省 5min → 命中（非法 env 未生效）
  });

  it('DS6 场景②: 同 finding 二次 check 不重复开单/不重复通知（id 稳定 + 表去重）', async () => {
    const runner = makeRunner(db);
    await primeOneDispatch(runner);
    const count = (): number =>
      (db.prepare('SELECT COUNT(*) AS c FROM sentinel_tickets').get() as { c: number }).c;
    expect(count()).toBe(1);
    vi.setSystemTime(new Date(T0.getTime() + 1 * 60 * 1000));
    await primeOneDispatch(runner);
    expect(count()).toBe(1); // INSERT OR REPLACE 幂等（工单 = 问题类, 不是问题快照）
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1); // 窗口内不重发
  });
});
