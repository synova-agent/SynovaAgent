/**
 * tests/sentinel/field-name-alignment.test.ts — #1398 判据（批 1a：A 类字段名对齐真源）
 *
 * CTO 2026-10-08 裁：范围 = **A 类（camel 但真源有 snake 对应）改名**；**去掉运行时归一化**
 *   （依据：分类证明 A 类 ≤7，其余 camel 字段**不从数据 props 取值**（内部参数/容器）⇒ 归一化无事可做）
 * 判据口径（R192）：**行为断言优先**；形态扫描**写明"只证明形态"**；豁免**逐条登记**（禁静默排除）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { computeLearningRate } from '../../extensions/sentinels/shared/computes/l2-value/compute-learning-rate';
import { computeCompetitorPricingLandscape } from '../../extensions/sentinels/shared/computes/l4-competition/compute-competitor-pricing-landscape';

/** 本批（**1b**）A 类字段（camel → 真源 snake）；1a 的三个**已合入 main**（dfac2ef66） */
const BATCH_1A = [
  { camel: 'marketShare', snake: 'market_share', file: 'extensions/sentinels/shared/computes/l4-competition/compute-competitor-pricing-landscape.ts' },
  { camel: 'routineRigidity', snake: 'routine_rigidity', file: 'extensions/sentinels/shared/computes/l2-internal/compute-routine-rigidity.ts' },
] as const;
/** 显式豁免（**逐条登记**，禁静默排除） */
const EXEMPT = [
  { name: 'churnRisk', why: '批 1a **已合入 main**（dfac2ef66）' },
  { name: 'tenureMonths', why: '批 1a 已合入 main' },
  { name: 'defectRate', why: '批 1a 已合入 main' },
  { name: 'referralCount', why: 'B 类（真源无对应；compute 内部参数）⇒ 不改' },
  { name: 'efficiencyRate', why: 'B 类（真源无对应；compute 内部参数）⇒ 不改' },
] as const;
const TRUTH_PROPS = new Set<string>(
  JSON.parse(readFileSync('extensions/ontology/resource/client.json', 'utf-8')).optionalProps ? Object.keys(JSON.parse(readFileSync('extensions/ontology/resource/client.json', 'utf-8')).optionalProps) : [],
);

describe('#1398 批 1a · A 类字段名对齐真源（去掉运行时归一化）', () => {
  it('V1【形态扫描·只证明形态】本批 A 类字段名 == 真源 props 名；D 类（真源为 camel）= 0', () => {
    for (const { snake, camel, file } of BATCH_1A) {
      const src = readFileSync(file, 'utf-8');
      expect(src, `${file} 应含真源名 ${snake}`).toMatch(new RegExp(`\\b${snake}\\b`));
      expect(src, `${file} 不应残留 ${camel}`).not.toMatch(new RegExp(`\\b${camel}\\b`));
    }
    // 真源侧：`churn_risk` / `tenure_months` 在 client schema 里；`defect_rate` 属生产类（非 client）
    expect(TRUTH_PROPS.has('churn_risk'), 'client schema 应声明 churn_risk').toBe(true);
    expect(TRUTH_PROPS.has('tenure_months'), 'client schema 应声明 tenure_months').toBe(true);
    expect(EXEMPT.length, '豁免必须逐条登记（禁静默）').toBe(5);
  });

  it('🔴 V2【行为断言·**本批自己的实测样例**】旧名 ⇒ **静默默认值 0.5**（正名 0.3）；竞品字段本次无分歧（如实报）', () => {
    // 实测（本批，n=1 的行为样例；非频次观测）：
    //   computeLearningRate：真源名 ⇒ routine_rigidity=0.3；旧 camel 名 ⇒ **实测 0.5（默认值）且 degraded=false** ⇒ **静默替代**
    //   computeCompetitorPricingLandscape：真源名 与 旧名 ⇒ **返回值实测【无分歧】**（该字段本次未影响产出）⇒ 如实登记
    const lrGood = computeLearningRate({ unitCostT0: 100, unitCostT: 80, cumulativeOutput: 200, routine_rigidity: 0.3 });
    expect(lrGood.routine_rigidity, '真源名 ⇒ 用传入值').toBe(0.3);
    expect(lrGood.degraded).toBe(false);
    const lrStale = computeLearningRate({ unitCostT0: 100, unitCostT: 80, cumulativeOutput: 200, routineRigidity: 0.3 } as unknown as Parameters<typeof computeLearningRate>[0]);
    expect(lrStale.routine_rigidity, '旧名 ⇒ **实测 0.5 = 默认值**（静默替代）').toBe(0.5);
    expect(lrStale.degraded, '旧名 ⇒ **实测 degraded=false**（无信号）').toBe(false);

    const cplGood = computeCompetitorPricingLandscape([{ name: 'A', price: 100, market_share: 0.3 }], 90);
    const cplStale = computeCompetitorPricingLandscape([{ name: 'A', price: 100, marketShare: 0.3 }] as unknown as Parameters<typeof computeCompetitorPricingLandscape>[0], 90);
    // 比**稳定部分**（排除 computedAt 时间戳）
    expect(JSON.stringify(cplStale.value), '竞品字段：value **实测无分歧**（如实登记）').toBe(JSON.stringify(cplGood.value));
    expect(cplStale.degraded, '竞品字段：degraded 实测亦无分歧').toBe(cplGood.degraded);
  });

  it('V3【形态扫描·只证明形态 + 豁免逐条登记】A 类旧名在 extensions/** 零残留（排除项已列明）', () => {
    const out = execSync(
      `git grep -n -E "\\b(${BATCH_1A.map(b => b.camel).join('|')})\\b" HEAD -- extensions/ | grep -v "_extinct/" | grep -v "/skills/" || true`,
      { encoding: 'utf-8' },
    ).trim();
    expect(out, `A 类旧名应有零残留；实际：\n${out}`).toBe('');
  });
});
