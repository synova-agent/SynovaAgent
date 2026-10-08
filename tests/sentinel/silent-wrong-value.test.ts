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
import { computeGrossMargin } from '../../extensions/sentinels/margin-health/computes/compute-gross-margin';
import { computeCostPerHead } from '../../extensions/sentinels/margin-health/computes/compute-cost-per-head';

/** 本批接线集合（**声称**；由 V3 用扫描核） */
const WIRED_THIS_BATCH = [
  'compute-cost-per-head.ts', 'compute-fixed-variable-ratio.ts', 'compute-gross-margin.ts',
  'compute-margin-vs-benchmark.ts', 'compute-profit-margin-change.ts',
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
});
