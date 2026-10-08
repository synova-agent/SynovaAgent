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
import { computeCustomerValueScore } from '../../extensions/sentinels/shared/computes/l2-value/compute-customer-value-score';
import { computeOperationalExecution } from '../../extensions/sentinels/shared/computes/l3-output/compute-operational-execution';

/** 本批 A 类字段（camel → 真源 snake） */
const BATCH_1A = [
  { camel: 'churnRisk', snake: 'churn_risk', file: 'extensions/sentinels/shared/computes/l2-value/compute-customer-value-score.ts' },
  { camel: 'tenureMonths', snake: 'tenure_months', file: 'extensions/sentinels/shared/computes/l2-value/compute-customer-value-score.ts' },
  { camel: 'defectRate', snake: 'defect_rate', file: 'extensions/sentinels/shared/computes/l3-output/compute-operational-execution.ts' },
] as const;
/** 显式豁免（**逐条登记**，禁静默排除） */
const EXEMPT = [
  { name: 'marketShare', why: '批 1b（A 类）—— 本批未处理，已登记' },
  { name: 'routineRigidity', why: '批 1b（A 类）—— 本批未处理，已登记' },
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
    expect(EXEMPT.length, '豁免必须逐条登记（禁静默）').toBe(4);
  });

  it('🔴 V2【行为断言·具体样例】真源名 ⇒ 算出；旧 camel 名 ⇒ **实测 null 且 degraded=false（静默！）**', () => {
    // 实测（本机 ref=origin/main@f86445c9c 的批 1a 分支）：
    //   真源名 ⇒ computeCustomerValueScore.value=79（components 全填）｜computeOperationalExecution.value=0.784
    //   旧 camel 名 ⇒ 两者 value=**NaN**，且 **degraded=false、warnings 为空** ⇒ **静默**
    //   （⚠️ 探针首测显示 null 是 `JSON.stringify(NaN)` 的假象 ⇒ 已更正为 NaN）
    const ok = computeCustomerValueScore({ revenue: 100_000, tenure_months: 24, churn_risk: 0.1, referralCount: 3 });
    expect(ok.degraded).toBe(false);
    expect(ok.value, '真源名 ⇒ 有数值').toBe(79);
    expect(ok.components.retentionScore, '真源名 ⇒ 组件已填').toBe(18);

    const stale = computeCustomerValueScore({ revenue: 100_000, tenureMonths: 24, churnRisk: 0.1 } as unknown as Parameters<typeof computeCustomerValueScore>[0]);
    // ⚠️ 测量假象更正：探针里 `JSON.stringify(NaN)` → `null` ⇒ 实测真值是 **NaN**（不是 null）
    expect(Number.isNaN(stale.value), '旧名 ⇒ **实测 NaN**（读不到）').toBe(true);
    expect(Number.isNaN(stale.components.loyaltyScore), '旧名 ⇒ 组件实测 NaN').toBe(true);

    const oe = computeOperationalExecution({ efficiencyRate: 0.8, defect_rate: 0.02 });
    expect(oe.degraded).toBe(false);
    expect(oe.value, 'defect_rate（真源名）⇒ 有数值').toBe(0.784);
    const oeStale = computeOperationalExecution({ efficiencyRate: 0.8, defectRate: 0.02 } as unknown as Parameters<typeof computeOperationalExecution>[0]);
    expect(Number.isNaN(oeStale.value), '旧名 ⇒ **实测 NaN**').toBe(true);
    // 🔴 发现（登记）：旧名产生 null **但不置 degraded、不给 warnings** ⇒ **静默读到 null**
    //   ⇒ 这正是本卡"名字必须对齐真源"的价值：**不齐时没有任何信号**
    expect(oeStale.degraded, '旧名 ⇒ 实测 degraded=false（静默）').toBe(false);
    expect(oeStale.warnings.length, '旧名 ⇒ 实测无告警（静默）').toBe(0);
  });

  it('V3【形态扫描·只证明形态 + 豁免逐条登记】A 类旧名在 extensions/** 零残留（排除项已列明）', () => {
    const out = execSync(
      `git grep -n -E "\\b(${BATCH_1A.map(b => b.camel).join('|')})\\b" HEAD -- extensions/ | grep -v "_extinct/" | grep -v "/skills/" || true`,
      { encoding: 'utf-8' },
    ).trim();
    expect(out, `A 类旧名应有零残留；实际：\n${out}`).toBe('');
  });
});
