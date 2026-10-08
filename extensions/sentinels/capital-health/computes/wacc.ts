/**
 * capital-health/computes/wacc.ts — WACC 计算（D358 迁自 _extinct/capital-efficiency）
 *
 * 契约ID: COMPUTE-WACC-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ equity; total_debt; tax_rate }>, params?: { riskFree?, marketReturn?, beta? }
 *   WACC = (E/V) × re + (D/V) × rd × (1 − tax)；re = rf + β × (rm − rf)（CAPM）
 *   来源: Copeland, Koller & Murrin (McKinsey Valuation)；公司理财(罗斯) Ch12
 * 输出(正常): { wacc, costOfEquity, costOfDebt, equityWeight, debtWeight, degraded: false }
 * 输出(降级): 空数组 / 总资本=0 / 单侧资本缺失（equity 或 debt 为 0 → partial）→ degraded
 * 边界: equity=debt → creditSpread 取 0.03 档（D358 对齐: 负债 ≥ 权益即取高信用利差档）
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface WaccResult {
  wacc: number;
  costOfEquity: number;
  costOfDebt: number;
  equityWeight: number;
  debtWeight: number;
  degraded: boolean;
  warnings: string[];
}

export interface WaccParams {
  /** 无风险利率 (默认: 3% = 0.03) */
  riskFree?: number;
  /** 市场预期收益率 (默认: 10% = 0.10) */
  marketReturn?: number;
  /** 无杠杆β (默认: 1.0) */
  beta?: number;
}

export function computeWacc(
  financials: Array<{ equity: number; total_debt: number; tax_rate: number }>,
  params?: WaccParams,
): WaccResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(financials, ['equity', 'total_debt', 'tax_rate']);
  if (_inputIssues.length > 0) return { wacc: 0, costOfEquity: 0, costOfDebt: 0, equityWeight: 0, debtWeight: 0, degraded: true, warnings: _inputIssues };
  const warnings: string[] = [];
  const rf = params?.riskFree ?? 0.03;
  const rm = params?.marketReturn ?? 0.10;
  const beta = params?.beta ?? 1.0;

  if (financials.length === 0) {
    return {
      wacc: 0, costOfEquity: 0, costOfDebt: 0, equityWeight: 0, debtWeight: 0,
      degraded: true,
      warnings: ['No financial data available'],
    };
  }

  // 聚合
  let totalEquity = 0;
  let totalDebt = 0;
  let totalTaxRate = 0;
  let countWithData = 0;

  for (const f of financials) {
    totalEquity += Math.max(0, f.equity);
    totalDebt += Math.max(0, f.total_debt);
    if (f.tax_rate > 0 && f.tax_rate < 1) {
      totalTaxRate += f.tax_rate;
      countWithData++;
    }
  }

  const taxRate = countWithData > 0 ? totalTaxRate / countWithData : 0.25; // 默认25%税率

  const totalCapital = totalEquity + totalDebt;

  if (totalCapital === 0) {
    return {
      wacc: 0, costOfEquity: 0, costOfDebt: 0, equityWeight: 0, debtWeight: 0,
      degraded: true,
      warnings: ['Total capital (equity + debt) is zero'],
    };
  }

  const equityWeight = totalEquity / totalCapital;
  const debtWeight = totalDebt / totalCapital;

  // CAPM: re = rf + β × (rm - rf)
  const costOfEquity = rf + beta * (rm - rf);

  // 债务成本: rd = rf + credit spread (简化: 负债 ≥ 权益 → +3%，否则 +2%)
  const creditSpread = totalDebt >= totalEquity ? 0.03 : 0.02;
  const costOfDebt = rf + creditSpread;

  // WACC = E/V × re + D/V × rd × (1 - tax)
  const wacc = equityWeight * costOfEquity + debtWeight * costOfDebt * (1 - taxRate);

  const degraded = totalEquity === 0 || totalDebt === 0;
  if (degraded) {
    warnings.push('Partial capital data — WACC estimate may be unreliable');
  }

  return {
    wacc: Math.round(wacc * 10000) / 10000,
    costOfEquity: Math.round(costOfEquity * 10000) / 10000,
    costOfDebt: Math.round(costOfDebt * 10000) / 10000,
    equityWeight: Math.round(equityWeight * 100) / 100,
    debtWeight: Math.round(debtWeight * 100) / 100,
    degraded,
    warnings,
  };
}
