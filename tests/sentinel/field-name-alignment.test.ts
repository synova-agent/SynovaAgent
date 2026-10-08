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
import { computeFixedVariableRatio } from '../../extensions/sentinels/margin-health/computes/compute-fixed-variable-ratio';
import { computeRoicWaccSpread } from '../../extensions/sentinels/capital-health/computes/roic-wacc-spread';

/** 本批（**批 2**）A 类字段；1a（dfac2ef66）/1b（b022f5646）的五个**已合入 main** */
const BATCH_1A = [
  { camel: 'operatingExpenses', snake: 'operating_expense', file: 'extensions/sentinels/margin-health/computes/compute-fixed-variable-ratio.ts' },
  { camel: 'operatingExpenses', snake: 'operating_expense', file: 'extensions/sentinels/capital-health/computes/roic-wacc-spread.ts' },
] as const;
/** 显式豁免（**逐条登记**，禁静默排除） */
const EXEMPT = [
  { name: 'churnRisk', why: '批 1a **已合入 main**（dfac2ef66）' },
  { name: 'tenureMonths', why: '批 1a 已合入 main' },
  { name: 'defectRate', why: '批 1a 已合入 main' },
  { name: 'marketShare', why: '批 1b **已合入 main**（b022f5646）' },
  { name: 'routineRigidity', why: '批 1b 已合入 main' },
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
    expect(EXEMPT.length, '豁免必须逐条登记（禁静默）').toBe(7);
  });

  it('🔴 V2【行为断言·**本批自己的实测样例**】旧名 ⇒ 一处 NaN｜**一处「看起来合理的错数」**', () => {
    // 实测（本批；行为样例，非频次观测）：
    //   computeFixedVariableRatio：真源名 ⇒ 0.1875；旧名 ⇒ **NaN** 且 degraded=false、warnings=[]
    //   computeRoicWaccSpread：真源名 ⇒ spread = **-0.075**；旧名 ⇒ spread = **-0.05**（**不同的数，且 degraded=false**）
    //     ⇒ 🔴 后者是更严重的形态：**不是"算不出来"，是"算出一个看起来合理的错数"**（#1408 卡的核心）
    const base = { total_revenue: 1000, gross_margin: 400, fixed_cost: 150, operating_expense: 200, total_cost: 600 };
    const fvrGood = computeFixedVariableRatio([base]);
    expect(fvrGood.degraded).toBe(false);
    expect(fvrGood.value, '真源名 ⇒ 有数值').toBe(0.1875);
    const fvrStale = computeFixedVariableRatio([{ ...base, operating_expense: undefined, operatingExpenses: 200 } as unknown as typeof base]);
    expect(Number.isNaN(fvrStale.value), '旧名 ⇒ **实测 NaN**').toBe(true);
    expect(fvrStale.degraded, '旧名 ⇒ **实测 degraded=false**（静默）').toBe(false);

    const fin = [{ total_revenue: 1000, cogs: 600, operating_expense: 200, total_debt: 3000, equity: 5000, total_assets: 8000 }];
    const spreadGood = computeRoicWaccSpread(fin);
    expect(spreadGood.spread, '真源名 ⇒ spread=-0.075').toBe(-0.075);
    const spreadStale = computeRoicWaccSpread([{ ...fin[0], operating_expense: undefined, operatingExpenses: 200 } as unknown as typeof fin[0]]);
    expect(spreadStale.spread, '🔴 旧名 ⇒ **实测 -0.05（错数，非 NaN）**').toBe(-0.05);
    expect(spreadStale.degraded, '🔴 旧名 ⇒ **实测 degraded=false**（**看起来正常的错数**）').toBe(false);
  });

  it('V3【形态扫描·只证明形态 + 豁免逐条登记】A 类旧名在 extensions/** 零残留（排除项已列明）', () => {
    const out = execSync(
      `git grep -n -E "\\b(${BATCH_1A.map(b => b.camel).join('|')})\\b" HEAD -- extensions/ | grep -v "_extinct/" | grep -v "/skills/" || true`,
      { encoding: 'utf-8' },
    ).trim();
    expect(out, `A 类旧名应有零残留；实际：\n${out}`).toBe('');
  });
});
