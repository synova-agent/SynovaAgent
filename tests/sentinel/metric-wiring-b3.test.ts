/**
 * tests/sentinel/metric-wiring-b3.test.ts — #1375 **B3a** 判据（3 哨兵：单 compute ⇒ 可机械接线）
 *
 * ⚠️ **批次组成说明（实测驱动）**：CTO 裁"全取 6"，但实测 6 个里 **3 个是多 compute 形态**
 *   （`capital-health`｜`growth-quality`｜`margin-health`）⇒ 需先定"**哪个值作指标**"的规则
 *   ⇒ 本 PR 只接 **3 个单 compute**（`environment-rent-dependency`｜`financing-constraint`｜`value-capture`），
 *      另 3 个**待规则**（已报 CTO；**不是"分两次"而是"缺一条规则"**）。
 * 口径：被测对象 = **哨兵的 metric 产出**（输入由真实 `SqliteGraphStore.createNode` 建）。
 * 短路声明（R178）：本批 `V2①-b`（不编造）**有对象**（已接线）⇒ 非短路。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

const B3A = ['environment-rent-dependency', 'financing-constraint', 'value-capture'] as const;

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1375 B3a · 指标级接线（3 哨兵）', () => {
  it('V1 覆盖面 + 形态：3 个只返回 metrics（不碰库）；metric_id 互不重名', () => {
    const ids: string[] = [];
    for (const n of B3A) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 应返回 metrics`).toContain('metricsHolder');
      expect(src, `${n} 不得直接写库`).not.toMatch(/metricSink|metric_readings|\.prepare\(/);
      const m = src.match(/metricId: '([A-Z0-9-]+)'/);
      expect(m, `${n} 应有 metricId`).toBeTruthy();
      ids.push(m![1]);
    }
    expect(new Set(ids).size).toBe(ids.length);
    // 🔴 全局唯一（防跨批撞名）：每个 metric_id 在全仓 aggregate 中只应出现一次
    const allAgg = readFileSync('extensions/sentinels/business-model-coherence/aggregate.ts', 'utf-8')
      + readFileSync('extensions/sentinels/make-or-buy/aggregate.ts', 'utf-8')
      + readFileSync('extensions/sentinels/talent-density/aggregate.ts', 'utf-8')
      + readFileSync('extensions/sentinels/knowledge-accessibility/aggregate.ts', 'utf-8');
    for (const id of ids) {
      expect(allAgg.includes(`'${id}'`), `metric_id ${id} 与已接批次撞名`).toBe(false);
    }
    expect(B3A.length).toBe(3);
  });

  it('🔴 V2 端到端（真路径 + 真 store）：经 loader ⇒ 写出 metric 行 + ≥1 行 degraded=0 + 行级租户正确', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    // 输入：本体轴财务节点（#1393 后经收口点并集读，读 `Financial` 能命中 `resource/money`）
    store.createNode('resource/money', { orgId: 'org-b3', total_revenue: 1000, total_cost: 300, cash_balance: 5000, operating_cashflow: 200 });
    const sink = createMetricSink(db);
    for (const n of B3A) {
      const s = getSentinelRegistry().get(`sentinel-${n}`);
      expect(s, `${n} 应在注册表`).toBeTruthy();
      const res = await s!.check({ db: store, metricSink: sink, teamId: 'org-b3', now: new Date('2026-10-08T00:00:00Z') });
      expect(res.ok).toBe(true);
    }
    const rows = db.prepare('SELECT metric_id, org_id, degraded, run_id, def_version, input_digest FROM metric_readings').all() as Array<{ metric_id: string; org_id: string; degraded: number; run_id: string | null; def_version: string | null; input_digest: string | null }>;
    expect(rows.length, '应写出 metric 行').toBeGreaterThan(0);
    expect(rows.every(r => r.org_id === 'org-b3')).toBe(true);
    const okRows = rows.filter(r => r.degraded === 0);
    expect(okRows.length, '🔴 至少一行 degraded=0').toBeGreaterThan(0);
    expect(okRows[0].run_id).toBeTruthy();
    expect(okRows[0].def_version).toBeTruthy();
    expect(okRows[0].input_digest).toBeTruthy();
  });

  it('🔴 V2①-b（不编造）：**库空** ⇒ 不得编造 metric 行（本批有对象 ⇒ 非短路）', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const sink = createMetricSink(db);
    for (const n of B3A) {
      await getSentinelRegistry().get(`sentinel-${n}`)!.check({ db: store, metricSink: sink, teamId: 'org-empty', now: new Date('2026-10-08T00:00:00Z') });
    }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get() as { n: number }).n;
    expect(n, '库空 ⇒ 不得编造').toBe(0);
  });
});
