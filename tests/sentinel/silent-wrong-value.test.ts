/**
 * tests/sentinel/silent-wrong-value.test.ts — #1408 判据（静默错误值：缺字段/NaN 入参必须有信号）
 *
 * CTO 2026-10-08 裁：范围 (b)「只做已接指标级哨兵所依赖的 compute」｜形态 (c)「共享助手 + **显式调用** + 覆盖率判据」
 *   · 批 A = margin-health 的 compute（7 个里 **5 个有数值入参** ⇒ 接线；**2 个是图遍历形态 ⇒ 不适用**，登记）
 * 口径（R192）：**行为断言优先**；形态扫描**写明"只证明形态"**；短路显式声明（R178）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { reconcileSchema } from '../../src/store/schema-migration';
import { computeGrossMargin } from '../../extensions/sentinels/margin-health/computes/compute-gross-margin';
import { computeCostPerHead } from '../../extensions/sentinels/margin-health/computes/compute-cost-per-head';
import { computeAssetTurnover } from '../../extensions/sentinels/capital-health/computes/asset-turnover';
import { computeDebtEquityRatio } from '../../extensions/sentinels/capital-health/computes/debt-equity-ratio';

/** 本批接线集合（**声称**；由 V3 用扫描核） */
const WIRED_THIS_BATCH = [
  'compute-cost-per-head.ts', 'compute-fixed-variable-ratio.ts', 'compute-gross-margin.ts',
  'compute-margin-vs-benchmark.ts', 'compute-profit-margin-change.ts',
];
/** 批 B：capital-health 的 9 个 compute（本轮接线） */
const WIRED_BATCH_B_DIR = 'extensions/sentinels/capital-health/computes';
const WIRED_BATCH_B = [
  'asset-turnover.ts', 'capital-turnover.ts', 'cash-conversion-cycle.ts', 'debt-equity-ratio.ts',
  'debt-structure.ts', 'interest-coverage.ts', 'receivable-turnover.ts', 'roic-wacc-spread.ts', 'wacc.ts',
];

/** margin-health 内【不适用】的（无 props 数值入参：图遍历形态） */
const NOT_APPLICABLE = ['compute-incentive-bind.ts', 'compute-metric-bind-divergence.ts'];

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1408 静默错误值（批 A：margin-health 的 5 个 compute）', () => {
  it('🔴 V1【行为】缺字段/NaN 入参 ⇒ **degraded=true 且 warnings 非空**（对照批 A 前：NaN + degraded=false + warnings=[]）', () => {
    const nan = computeGrossMargin([{ total_revenue: NaN, gross_margin: 400 }]);
    expect(nan.degraded, 'NaN 入参 ⇒ 必须降级').toBe(true);
    expect(nan.warnings.length, 'NaN 入参 ⇒ 必须有告警').toBeGreaterThan(0);
    expect(nan.warnings.join(' ')).toContain('非有限数');

    const missing = computeGrossMargin([{ total_revenue: 1000 } as unknown as { total_revenue: number; gross_margin: number }]);
    expect(missing.degraded, '缺字段 ⇒ 必须降级').toBe(true);
    expect(missing.warnings.join(' ')).toContain('缺字段');

    const cph = computeCostPerHead({ total_cost: Number.NaN, head_count: 10 });
    expect(cph.degraded, '对象入参的 NaN ⇒ 必须降级').toBe(true);
    expect(cph.warnings.join(' ')).toContain('非有限数');
  });

  it('🔴 V2【行为】正常入参 ⇒ **不得误报**（degraded=false 且 warnings 无输入类问题）', () => {
    const ok = computeGrossMargin([{ total_revenue: 1000, gross_margin: 400 }]);
    expect(ok.degraded, '正常入参 ⇒ 不得降级').toBe(false);
    expect(ok.warnings.filter(w => w.includes('缺字段') || w.includes('非有限数')), '正常入参 ⇒ 无输入类告警').toEqual([]);
    const cph = computeCostPerHead({ total_cost: 600, head_count: 10 });
    expect(cph.degraded).toBe(false);
  });

  it('V3【形态扫描·**只证明形态**】覆盖率：本批已调用集合 == 声称的 5 个；未调用者**逐条点名**（禁静默漏）', () => {
    const dir = 'extensions/sentinels/margin-health/computes';
    const files = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    // 🔴 扫【**调用**】而非【出现】—— 排除 import 行（否则"只 import 未调用"会假绿；M1 实测过这个漏洞）
    const called = files.filter(f => readFileSync(join(dir, f), 'utf-8')
      .split('\n').some(l => /checkFiniteInputs\(/.test(l) && !/^\s*import\b/.test(l)));
    expect(new Set(called), '已调用集合应恰为本批声称的 5 个（多/少都算漂）').toEqual(new Set(WIRED_THIS_BATCH));
    const pending = files.filter(f => !called.includes(f) && !NOT_APPLICABLE.includes(f));
    expect(pending, 'margin-health 内既未调用、又非"不适用"的 ⇒ 必须为空（本批 5 调用 + 2 不适用 = 7）').toEqual([]);
    expect(NOT_APPLICABLE.length, '不适用者必须逐条登记').toBe(2);
  });

  it('🔴 V4【行为·端到端】已接指标级的哨兵产出 **≥1 行且值为有限数**（#1408 的存在理由）', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    store.createNode('resource/money', {
      orgId: 'org-1408', total_revenue: 1000, gross_margin: 400, cogs: 600, total_cost: 600,
      operating_expense: 200, netProfit: 120, profitMargin: 0.12, operating_cashflow: 150,
      equity: 5000, total_debt: 3000, total_assets: 8000, head_count: 10, headCount: 10,
    });
    store.createNode('Person', { orgId: 'org-1408', name: 'p1', skills: ['ops'], skillLevel: 0.4 });
    store.createNode('Person', { orgId: 'org-1408', name: 'p2', skills: ['ai'], skillLevel: 0.9 });
    const sink = createMetricSink(db);
    const s = getSentinelRegistry().get('sentinel-margin-health');
    expect(s, 'margin-health 应在注册表').toBeTruthy();
    const res = await s!.check({ db: store, metricSink: sink, teamId: 'org-1408', now: new Date('2026-10-08T00:00:00Z') });
    expect(res.ok).toBe(true);
    const rows = db.prepare('SELECT metric_id, value FROM metric_readings').all() as Array<{ metric_id: string; value: number }>;
    expect(rows.length, '应产出 ≥1 行指标').toBeGreaterThan(0);
    for (const r of rows) {
      expect(Number.isFinite(r.value), `🔴 ${r.metric_id} 的值必须是有限数（不得 NaN/Infinity）`).toBe(true);
    }
  });

  it('🔴 V-writer【行为·落库侧收口】非有限值 ⇒ **不落库 + 留痕（含行标识）**；且与 compute 侧**独立**', () => {
    const db = new Database(':memory:');
    reconcileSchema(db);   // 建 `metric_readings` 表（迁移 002）
    const sink = createMetricSink(db);
    const base = { orgId: 'org-1408', observedAt: new Date('2026-10-08T00:00:00Z').toISOString(), sourceType: 'compute' as const };
    sink({ ...base, metricId: 'X-NONFINITE', value: Number.NaN });
    sink({ ...base, metricId: 'X-INFINITY', value: Number.POSITIVE_INFINITY });
    sink({ ...base, metricId: 'X-OK', value: 1.5 });
    const rows = db.prepare('SELECT metric_id, value FROM metric_readings').all() as Array<{ metric_id: string; value: number }>;
    expect(rows.map(r => r.metric_id), '非有限值 ⇒ **不落库**；正常值 ⇒ 落库').toEqual(['X-OK']);
    expect(Number.isFinite(rows[0].value)).toBe(true);
    // 🔴 与 compute 侧【独立】：本判据不依赖任何 compute 是否调用助手 ⇒ M1（去掉 compute 调用）仍必须红（由 V1/V3 守）
  });

  it('🔴 V1-b【行为·**批 B 自己的实测样例**】capital-health：NaN/缺字段 ⇒ degraded + warnings', () => {
    const nan = computeAssetTurnover([{ total_revenue: Number.NaN, total_assets: 100, current_assets: 50 }]);
    expect(nan.degraded, 'NaN ⇒ 必须降级').toBe(true);
    expect(nan.warnings?.join(' ') ?? '', 'NaN ⇒ 必须留痕').toContain('非有限数');
    const missing = computeDebtEquityRatio([{ total_debt: 100 } as unknown as { total_debt: number; long_term_debt: number; equity: number }]);
    expect(missing.degraded, '缺字段 ⇒ 必须降级').toBe(true);
    expect(missing.warnings?.join(' ') ?? '').toContain('缺字段');
  });

  it('V2-b【行为】capital-health 正常入参 ⇒ **不得误报**', () => {
    const ok = computeAssetTurnover([{ total_revenue: 1000, total_assets: 500, current_assets: 200 }]);
    expect(ok.degraded, '正常入参 ⇒ 不得降级').toBe(false);
    expect((ok.warnings ?? []).filter(w => w.includes('缺字段') || w.includes('非有限数'))).toEqual([]);
  });

  it('V3-b【形态扫描·**只证明形态**】批 B 覆盖率：已调用集合 == 声称的 9 个（扫**调用**，排除 import 行）', () => {
    const files = readdirSync(WIRED_BATCH_B_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const called = files.filter(f => readFileSync(join(WIRED_BATCH_B_DIR, f), 'utf-8')
      .split('\n').some(l => /checkFiniteInputs\(/.test(l) && !/^\s*import\b/.test(l)));
    expect(new Set(called), '批 B 已调用集合应恰为 9 个').toEqual(new Set(WIRED_BATCH_B));
    expect(files.length - called.length, 'capital-health 内未调用者应为 0（本批全接线）').toBe(0);
  });

  it('🔴 V4-b【行为·端到端】capital-health 产出 ≥1 行且**值均为有限数**', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    store.createNode('resource/money', {
      orgId: 'org-1408b', total_revenue: 1000, gross_margin: 400, cogs: 600, total_cost: 600,
      operating_expense: 200, operatingExpenses: 200, current_assets: 300, total_assets: 800,
      total_debt: 300, long_term_debt: 200, short_term_debt: 100, equity: 500, cash: 120,
      receivables: 90, inventory: 60, accounts_payable: 40, interest_expense: 30, operating_cashflow: 150,
    });
    const sink = createMetricSink(db);
    const s = getSentinelRegistry().get('sentinel-capital-health');
    expect(s, 'capital-health 应在注册表').toBeTruthy();
    const res = await s!.check({ db: store, metricSink: sink, teamId: 'org-1408b', now: new Date('2026-10-08T00:00:00Z') });
    expect(res.ok).toBe(true);
    const rows = db.prepare('SELECT metric_id, value FROM metric_readings').all() as Array<{ metric_id: string; value: number }>;
    expect(rows.length, '应产出 ≥1 行').toBeGreaterThan(0);
    for (const r of rows) expect(Number.isFinite(r.value), `${r.metric_id} 必须为有限数`).toBe(true);
  });
});
