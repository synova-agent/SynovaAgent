import { describe, it, expect, beforeAll } from 'vitest';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { computeValueCaptureScore } from '../../extensions/sentinels/value-capture/computes/value-capture-score';
describe('computeValueCaptureScore', () => {
  it('空degraded', () => { expect(computeValueCaptureScore([]).degraded).toBe(true); });
  it('高利润=高捕获', () => { const r = computeValueCaptureScore([{revenue:1000,cost:400,netProfit:200,previousRevenue:800}]); expect(r.captureIndex).toBeGreaterThan(0.4); expect(r.degraded).toBe(false); });
  it('低毛利=低捕获', () => { const r = computeValueCaptureScore([{revenue:1000,cost:950,netProfit:10,previousRevenue:1000}]); expect(r.captureIndex).toBeLessThan(0.3); });
});

// ═══ #1419 第 5 形态「告警分支吞指标」：**两态判据**（CTO 2026-10-08 裁的标准形态）═══
describe('#1419 两态判据（正常态 / 告警态都必须产出指标行，且**同数**）', () => {
  beforeAll(async () => { const { sentinels } = loadSentinels(); await registerLoadedSentinels(sentinels); });
  async function run(revenue: number, cost: number, netProfit: number, prev: number) {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const org = 'org-vc-2state';
    store.createNode('Financial', { tid: org, orgId: org, revenue, cost, netProfit, previousRevenue: prev });
    const sink = createMetricSink(db);
    const g = getSentinelRegistry().get('sentinel-value-capture');
    const res = await g!.check({ db: store, metricSink: sink, teamId: org, now: new Date('2026-10-08T00:00:00Z') });
    const rows = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(value),0) v FROM metric_readings').get() as { n: number; v: number };
    return { rows: rows.n, values: rows.v, findings: res.findings?.length ?? -1 };
  }

  it('🔴 正常态（captureIndex ≥ 0.4）⇒ ≥1 行', async () => {
    const r = await run(1000, 300, 400, 800);
    expect(r.rows, '正常态必须有指标行').toBeGreaterThanOrEqual(1);
    expect(r.values, '值应为有限数（不得 NaN）').toBeGreaterThan(0);
  });

  it('🔴 告警态（captureIndex < 0.4）⇒ **也有 ≥1 行**（原缺陷：0 行）+ finding 仍在', async () => {
    const r = await run(1000, 600, 120, 800);
    expect(r.findings, '告警态应仍有 finding').toBeGreaterThanOrEqual(1);
    expect(r.rows, '🔴 告警态也必须有指标行（第 5 形态修复点）').toBeGreaterThanOrEqual(1);
  });

  it('🔴 两态**同数**（CTO ⑦：只断言"≥1"会漏掉"部分行被吞"）', async () => {
    const normal = await run(1000, 300, 400, 800);
    const alert = await run(1000, 600, 120, 800);
    expect(alert.rows, `告警态行数(${alert.rows}) 应等于正常态行数(${normal.rows})`).toBe(normal.rows);
  });
});
