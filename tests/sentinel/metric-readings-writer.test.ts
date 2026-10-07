/**
 * tests/sentinel/metric-readings-writer.test.ts — #1054（2-1b）写入点① 判据载体
 *
 * 卡面判据身份：`V2`（真跑一次哨兵 ⇒ `metric_readings` 行数 > 0，**临时库口径**）、
 *   `V7`（数据可用性：两段 before/after ⇒ 可算差值）、"写入事件非静默"（返回值 + 行），
 *   以及反例 `M1`/`M2`/`M3` 的红点。
 *
 * 覆盖面（逐字，CTO 2026-10-08 裁 C 指定形态）：
 *   **指标级写入已接（覆盖面 = 样板哨兵 1 个；其余 44 个哨兵暂只有轮次级；写入点②/③ 未接）**
 *
 * 库口径：`:memory:` 临时库（**禁 `data/synova.db`** —— R61/R87）；表由 `reconcileSchema` 建（2-1a 契约）。
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createMetricSink,
  writeRoundReadings,
  type MetricSink,
} from '../../src/sentinel/metric-readings-writer';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import type { SentinelContext } from '../../src/sentinel/types';

let reconcileSchema: (db: Database.Database) => void;

async function loadModules() {
  const mod = await import('../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
}

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

interface ReadingRow {
  org_id: string; metric_id: string; entity_id: string; value: number;
  unit: string | null; observed_at: string; source_type: string; source_id: string | null;
  evidence_ref: string | null; degraded: number; is_estimated: number; confidence: string;
}

function rows(db: Database.Database, where = "1=1"): ReadingRow[] {
  return db.prepare(`SELECT * FROM metric_readings WHERE ${where} ORDER BY metric_id`).all() as ReadingRow[];
}

/** 桩图库：cash-flow 哨兵只调用 `prepare(sql).all()` 取 FINANCIAL 节点 */
function stubGraphDb(propsList: Array<Record<string, unknown>>): { prepare(sql: string): { all(): unknown[] } } {
  return {
    prepare: () => ({ all: () => propsList.map(p => ({ props: JSON.stringify(p) })) }),
  };
}

describe('测量值写入 sink（#1054 / 2-1b · V2/V7）', () => {
  let db: Database.Database;

  beforeEach(async () => {
    await loadModules();
    db = createMemoryDb();
    reconcileSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('V2 正常：写一行 ⇒ 行数 1，列值正确（org/metric/value/observed_at/source_type）', () => {
    const r = createMetricSink(db)({
      orgId: 'org-1', metricId: 'CASH-FLOW-GROSS-MARGIN', value: 0.42,
      observedAt: '2026-10-08T00:00:00Z', sourceId: 'SENTINEL-CASH-FLOW-v1', evidenceRef: 'sentinel:cash-flow',
      unit: 'ratio',
    });
    expect(r.written).toBe(true);
    expect(r.degraded).toBe(true); // R4 三列缺省 ⇒ 强制降级（表级不变量）

    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0].org_id).toBe('org-1');
    expect(all[0].metric_id).toBe('CASH-FLOW-GROSS-MARGIN');
    expect(all[0].value).toBe(0.42);
    expect(all[0].source_type).toBe('compute');
    expect(all[0].degraded).toBe(1);
    expect(all[0].entity_id).toBe('*'); // 缺省粒度
  });

  it('幂等：同业务键连写两次 ⇒ 行数仍 1（第二次 written=false）', () => {
    const row = {
      orgId: 'org-1', metricId: 'M-1', value: 1, observedAt: '2026-10-08T00:00:00Z',
    };
    const sink0 = createMetricSink(db);
    expect(sink0(row).written).toBe(true);
    const second = sink0({ ...row, value: 999 });
    expect(second.written).toBe(false);
    // 🔴 判别性关键：`written=false` 必须来自【幂等 no-op】，而不是【写入失败被吞】
    //   （否则"删掉 ON CONFLICT DO NOTHING"这类改坏不会被判红 —— 反例 M3 的判别点）
    expect(second.reason).toBeUndefined();
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0].value).toBe(1); // DO NOTHING ⇒ 首值保留
  });

  it('降级：R4 三列缺省且调用方传 degraded=false ⇒ **强制纠正为 1**（不静默）', () => {
    const r = createMetricSink(db)({
      orgId: 'org-1', metricId: 'M-2', value: 1, observedAt: '2026-10-08T00:00:00Z', degraded: false,
    });
    expect(r.degraded).toBe(true);
    expect(rows(db)[0].degraded).toBe(1);
  });

  it('边界：R4 三列齐备 ⇒ degraded 可为 0（表级不变量只约束"缺列"一侧）', () => {
    const r = createMetricSink(db)({
      orgId: 'org-1', metricId: 'M-3', value: 1, observedAt: '2026-10-08T00:00:00Z',
      degraded: false, runId: 'run-1', inputDigest: 'd-1', defVersion: 'v1',
    });
    expect(r.degraded).toBe(false);
    expect(rows(db)[0].degraded).toBe(0);
  });

  it('失败面：表不存在 ⇒ **不抛**，返回 {written:false, degraded:true, reason}（铁律 24/31）', () => {
    const bare = createMemoryDb(); // 未跑 reconcileSchema ⇒ 无 metric_readings
    try {
      const r = createMetricSink(bare)({
        orgId: 'org-1', metricId: 'M-4', value: 1, observedAt: '2026-10-08T00:00:00Z',
      });
      expect(r.written).toBe(false);
      expect(r.degraded).toBe(true);
      expect(typeof r.reason).toBe('string');
      expect(r.reason ?? '').toMatch(/no such table/i);
    } finally {
      bare.close();
    }
  });

  it('轮次级：writeRoundReadings 写 2 行（findings 数 + durationMs），sink 缺省时 no-op', () => {
    const sink = createMetricSink(db);
    writeRoundReadings(sink, 'cash-flow', { findings: [1, 2, 3], durationMs: 17, checkedAt: '2026-10-08T00:00:00Z', degraded: false }, 'org-1');
    writeRoundReadings(undefined, 'no-sink', { findings: [] }, 'org-1'); // 缺省 ⇒ no-op

    const all = rows(db);
    expect(all).toHaveLength(2);
    const byMetric = new Map(all.map(r => [r.metric_id, r.value]));
    expect(byMetric.get('SENTINEL-FINDINGS-cash-flow')).toBe(3);
    expect(byMetric.get('SENTINEL-DURATION-cash-flow')).toBe(17);
    expect(all.every(r => r.org_id === 'org-1')).toBe(true);
  });

  it('🔴 样板哨兵（指标级）：真跑 cashFlowSentinel.check ⇒ 写出 compute 真实指标行（metric_id + value）', async () => {
    const sink: MetricSink = createMetricSink(db);
    const ctx: SentinelContext = {
      db: stubGraphDb([{ revenue: 1000, cost: 200, operating_expenses: 300, cash_balance: 5000, period: '2026-09' }]),
      now: new Date('2026-10-08T00:00:00Z'),
      teamId: 'org-sample',
      metricSink: sink,
    };

    const result = await cashFlowSentinel.check(ctx);
    expect(result.sentinelId).toBe(cashFlowSentinel.config.id);

    const metricRows = rows(db, "metric_id LIKE 'CASH-FLOW-%'");
    expect(metricRows.length).toBeGreaterThan(0); // ← V2 核心断言：指标级行数 > 0

    const byMetric = new Map(metricRows.map(r => [r.metric_id, r]));
    // grossMargin / netMargin 必为非空（compute 对非空数据必定产出）
    expect(byMetric.get('CASH-FLOW-GROSS-MARGIN')?.value).toBeCloseTo((1000 - 200) / 1000, 5);
    expect(byMetric.get('CASH-FLOW-NET-MARGIN')?.value).toBeCloseTo((1000 - 200 - 300) / 1000, 5);
    const sample = byMetric.get('CASH-FLOW-GROSS-MARGIN');
    expect(sample?.source_id).toBe('SENTINEL-CASH-FLOW-v1');
    expect(sample?.unit).toBe('ratio');
    expect(sample?.org_id).toBe('org-sample');
    expect(sample?.observed_at).toBe('2026-10-08T00:00:00.000Z'); // = now.toISOString()（哨兵口径）
    expect(sample?.degraded).toBe(1); // R4 无生产者 ⇒ 降级显式
  });

  it('🔴 A2 判据：runSentinelForTeam(teamId, store) 写出的行 org_id == 传入 teamId（且 ≠ default）', async () => {
    const sink = createMetricSink(db);
    const store = stubGraphDb([{ revenue: 1000, cost: 200, operating_expenses: 300, cash_balance: 5000, period: '2026-09' }]);
    const { runSentinelForTeam } = await import('../../src/sentinel/sentinel-runner');
    const { getSentinelRegistry } = await import('../../src/sentinel/registry');
    // 注册样板哨兵（`runAll` 遍历注册表；用后 unregister，避免污染其它用例）
    const registry = getSentinelRegistry();
    registry.register(cashFlowSentinel);

    try {
      await runSentinelForTeam('org-A2', store, { metricSink: sink });
    } finally {
      registry.unregister(cashFlowSentinel.config.id);
    }

    const all = rows(db);
    expect(all.length).toBeGreaterThan(0); // 该路径**确实落行**（不是零写入）
    expect(all.every(r => r.org_id === 'org-A2')).toBe(true);
    expect(all.every(r => r.org_id !== 'default')).toBe(true);
  });

  it('🔴 A2/M1 判据：无 teamId ⇒ fail-closed **零行**（不写错租户行、不回退 default）', () => {
    const sink = createMetricSink(db);
    writeRoundReadings(sink, 'some-sentinel', { findings: [1], durationMs: 5, checkedAt: '2026-10-08T00:00:00Z' }, undefined);
    expect(rows(db)).toHaveLength(0); // 无 org 维度 ⇒ 宁可不落行
  });

  it('V7 数据可用性：两段 observed_at ⇒ 可算差值（时序是参数标定的前提）', async () => {
    const sink: MetricSink = createMetricSink(db);
    const makeCtx = (checkedAt: string, revenue: number): SentinelContext => ({
      db: stubGraphDb([{ revenue, cost: 200, operating_expenses: 300, cash_balance: 5000, period: '2026-09' }]),
      now: new Date(checkedAt),
      teamId: 'org-1',
      metricSink: sink,
    });

    await cashFlowSentinel.check(makeCtx('2026-10-08T00:00:00Z', 1000));
    await cashFlowSentinel.check(makeCtx('2026-10-08T01:00:00Z', 2000));

    const series = db.prepare(
      "SELECT observed_at, value FROM metric_readings WHERE metric_id = 'CASH-FLOW-GROSS-MARGIN' ORDER BY observed_at",
    ).all() as Array<{ observed_at: string; value: number }>;
    expect(series).toHaveLength(2);
    expect(series[0].value).toBeCloseTo(0.8, 5);  // (1000-200)/1000
    expect(series[1].value).toBeCloseTo(0.9, 5);  // (2000-200)/2000
    expect(series[1].value - series[0].value).toBeCloseTo(0.1, 5); // before/after 差值可算
  });

  it('🔴 决策锁定（卡面反例 2 的夹具变体）：R4 列若被改成 NOT NULL ⇒ 写入必拒', () => {
    // 本卡写集**不含** `src/store/migrations/**`（2-1a 已交付，属 #1053 写集）⇒ CTO 2026-10-08 裁：
    // 用【夹具变体】证明"三列可空"这条决策的必要性（证明力等价 + 不越写集）。
    db.exec(`CREATE TABLE metric_readings_variant (
      id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, metric_id TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '*', value REAL NOT NULL, observed_at TEXT NOT NULL,
      source_type TEXT NOT NULL, degraded INTEGER NOT NULL DEFAULT 0, run_id TEXT NOT NULL)`);
    // 真表：R4 缺省可写（+ 强制 degraded=1）
    expect(createMetricSink(db)({ orgId: 'o', metricId: 'M', value: 1, observedAt: '2026-10-08T00:00:00Z' }).written).toBe(true);
    // 变体表：同一语义的写入被 NOT NULL 拒 ⇒ 若真表改成 NOT NULL，本卡写入路径必然失败
    expect(() => db.prepare(
      "INSERT INTO metric_readings_variant (org_id, metric_id, value, observed_at, source_type, run_id) VALUES ('o','M',1,'t','compute',NULL)",
    ).run()).toThrow(/NOT NULL constraint failed: metric_readings_variant\.run_id/i);
  });

  it('只追加（本模块无 UPDATE/DELETE）：行数只随写入增长', () => {
    const sink = createMetricSink(db);
    for (let i = 0; i < 3; i++) {
      sink({ orgId: 'org-1', metricId: `M-${i}`, value: i, observedAt: `2026-10-08T0${i}:00:00Z` });
    }
    expect(rows(db)).toHaveLength(3);
  });
});
