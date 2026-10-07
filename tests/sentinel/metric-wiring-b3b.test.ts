/**
 * tests/sentinel/metric-wiring-b3b.test.ts — #1375 **B3b** 判据（3 个多 compute 哨兵）
 *
 * CTO 2026-10-08 裁 **(a)「每 compute 一行」** + 两条要求：
 *   ① `<FIELD>` 命名与 **#1054 样板**一致（样板 = `CASH-FLOW-GROSS-MARGIN`）
 *   ② **同一哨兵的多行 metric_id 互不重名**
 * 口径：被测对象 = **哨兵的 metric 产出**（输入由真实 `SqliteGraphStore.createNode` 建）。
 * 短路声明（R178）：`V2-空库`（不编造）**有对象**（已接线）⇒ 非短路。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

const B3B = ['capital-health', 'growth-quality', 'margin-health'] as const;
/** 每哨兵的 compute 数（实测：capital-health 9 处调用中 7 处接入；growth-quality 2；margin-health 5） */
const EXPECTED_ROWS: Record<string, number> = { 'capital-health': 7, 'growth-quality': 2, 'margin-health': 5 };
const NAME_RE = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;   // #1054 样板：全大写 + 连字符

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1375 B3b · 指标级接线（3 个多 compute 哨兵 · 每 compute 一行）', () => {
  it('V1 🔴 覆盖面 + 命名 + **同哨兵多行互不重名**（CTO 要求 ②）+ 跨批唯一', () => {
    const allIds: string[] = [];
    for (const n of B3B) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 不得直接写库`).not.toMatch(/metricSink|metric_readings|\.prepare\(/);
      const ids = [...src.matchAll(/metricId: '([A-Z0-9-]+)'/g)].map(m => m[1]);
      expect(ids.length, `${n} 每个 compute 一行`).toBe(EXPECTED_ROWS[n]);
      // ① 命名合 #1054 样板
      for (const id of ids) expect(id, `${n}: ${id} 命名不合样板`).toMatch(NAME_RE);
      // ② 同一哨兵多行互不重名
      expect(new Set(ids).size, `${n} 多行 metric_id 不得重名`).toBe(ids.length);
      // ③ 前缀 = 哨兵域（防跨哨兵撞名）
      for (const id of ids) expect(id.startsWith(`${n.toUpperCase()}-`), `${n}: ${id} 前缀应为哨兵域`).toBe(true);
      allIds.push(...ids);
    }
    // ④ 跨批唯一（与已接批次比对）
    const other = ['business-model-coherence', 'make-or-buy', 'talent-density', 'knowledge-accessibility']
      .map(n => readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8')).join('');
    for (const id of allIds) expect(other.includes(`'${id}'`), `${id} 与已接批次撞名`).toBe(false);
    expect(new Set(allIds).size, '本批内也不得重名').toBe(allIds.length);
  });

  it('🔴 V2 端到端（真路径）：多 compute 哨兵 ⇒ 写出**多行** metric + ≥1 行 degraded=0 + 行级租户正确', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    // 本体轴财务数据（#1393 后经收口点并集读命中 resource/money）
    // 夹具按**各 compute 的输入契约**构造（实测自各 computes 的 JSDoc `输入:` 行）：
    //   margin-health: total_revenue/gross_margin/cogs/operatingExpenses/total_debt/equity/total_cost/head_count
    //   growth-quality: operating_cashflow/netIncome/revenue/previousRevenue/organicGrowth/acquisitionRevenue
    //   capital-health: total_assets/current_assets/inventory/receivables/accounts_payable/short_term_debt/tax_rate/ebit/interest_expense
    store.createNode('resource/money', {
      orgId: 'org-b3b',
      total_revenue: 1000, gross_margin: 400, cogs: 600, total_cost: 600, operating_expense: 200, operatingExpenses: 200,
      netProfit: 120, netIncome: 120, profitMargin: 0.12,
      operating_cashflow: 150, operatingCashFlow: 150,
      equity: 5000, total_debt: 3000, short_term_debt: 800, long_term_debt: 2200,
      total_assets: 8000, current_assets: 3000, inventory: 200, receivables: 300, accounts_payable: 250,
      tax_rate: 0.25, ebit: 180, interest_expense: 30, head_count: 10, headCount: 10,
      revenue: 1000, previousRevenue: 800, organicGrowth: 150, acquisitionRevenue: 50,
      riskFree: 0.02, marketReturn: 0.08, beta: 1.1,
    });
    // margin-health 额外读 Person（缺则早退 ⇒ 需真实节点）
    store.createNode('Person', { orgId: 'org-b3b', name: 'p1', skills: ['ops'], skillLevel: 0.4 });
    store.createNode('Person', { orgId: 'org-b3b', name: 'p2', skills: ['ai'], skillLevel: 0.9 });
    const sink = createMetricSink(db);
    let rowsTotal = 0;
    for (const n of B3B) {
      const s = getSentinelRegistry().get(`sentinel-${n}`);
      expect(s, `${n} 应在注册表`).toBeTruthy();
      const res = await s!.check({ db: store, metricSink: sink, teamId: 'org-b3b', now: new Date('2026-10-08T00:00:00Z') });
      expect(res.ok, `${n} 应正常返回`).toBe(true);
    }
    const rows = db.prepare('SELECT metric_id, org_id, degraded FROM metric_readings').all() as Array<{ metric_id: string; org_id: string; degraded: number }>;
    rowsTotal = rows.length;
    // 🔴 「每 compute 一行」的端到端可见形态：多数哨兵应写出**多行**（而非一行）
    expect(rowsTotal, '应写出 metric 行').toBeGreaterThan(0);
    expect(rows.every(r => r.org_id === 'org-b3b')).toBe(true);
    expect(rows.some(r => r.degraded === 0), '≥1 行 degraded=0').toBe(true);
    const bySentinel = new Map<string, number>();
    for (const r of rows) {
      const k = r.metric_id.split('-')[0];
      bySentinel.set(k, (bySentinel.get(k) ?? 0) + 1);
    }
    // 🔴 **逐哨兵**断言（防"三哨兵合计"掩盖单个哨兵 0 行 —— 反例 M1 即此）
    for (const n of B3B) {
      const prefix = n.toUpperCase().split('-')[0];
      expect(bySentinel.get(prefix) ?? 0, `🔴 ${n} 必须产出 ≥1 行（不得靠其他哨兵掩盖）`).toBeGreaterThan(0);
    }
    expect([...bySentinel.values()].some(v => v > 1), '🔴 至少一个哨兵写出多行（每 compute 一行）').toBe(true);
  });

  it('🔴 V2-空库（不编造）：库空 ⇒ 不得编造 metric 行（本批有对象 ⇒ 非短路）', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const sink = createMetricSink(db);
    for (const n of B3B) {
      await getSentinelRegistry().get(`sentinel-${n}`)!.check({ db: store, metricSink: sink, teamId: 'org-empty', now: new Date('2026-10-08T00:00:00Z') });
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get() as { n: number }).n, '库空 ⇒ 不得编造').toBe(0);
  });
});
