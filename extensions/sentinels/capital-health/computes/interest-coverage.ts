/**
 * capital-health/computes/interest-coverage.ts — 利息覆盖倍数计算（D358 迁自 _extinct/capital-structure）
 *
 * 契约ID: COMPUTE-INTEREST-COVERAGE-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ operating_cashflow; interest_expense }>
 *   EBIT 近似 = operating_cashflow（D358 归一化映射: operatingIncome/operatingCashFlow → operating_cashflow）
 *   ICR = ebit / interest_expense
 * 输出(正常): { icr, ebit, interestExpense, degraded: false }
 * 输出(降级): 空数组 / interest_expense=0 → degraded
 *   D358 决策 5: 利息为 0 不再 fallback 99（原实现 ICR=99 恒「健康」，掩盖缺失数据）；
 *   分母 0 → degrade，aggregate 门控 !degraded。
 * 边界: ICR 恰好 1.5（critical 阈值线）→ 不降级
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface InterestCoverageResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  icr: number;
  ebit: number;
  interestExpense: number;
  degraded: boolean;
}

export function computeInterestCoverage(financials: Array<{
  operating_cashflow: number;
  interest_expense: number;
}>): InterestCoverageResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(financials, ['operating_cashflow', 'interest_expense']);
  if (_inputIssues.length > 0) return { icr: 0, ebit: 0, interestExpense: 0, degraded: true, warnings: _inputIssues };
  if (financials.length === 0) {
    return { icr: 0, ebit: 0, interestExpense: 0, degraded: true };
  }
  const ebit = financials.reduce((s, f) => s + (f.operating_cashflow || 0), 0);
  const interestExpense = financials.reduce((s, f) => s + (f.interest_expense || 0), 0);

  if (interestExpense === 0) {
    return { icr: 0, ebit, interestExpense: 0, degraded: true };
  }

  const icr = ebit / interestExpense;
  return { icr: Math.round(icr * 100) / 100, ebit, interestExpense, degraded: false };
}
