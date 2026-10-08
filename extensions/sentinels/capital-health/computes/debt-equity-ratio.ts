/**
 * capital-health/computes/debt-equity-ratio.ts — 负债权益比计算（D358 迁自 _extinct/capital-structure）
 *
 * 契约ID: COMPUTE-DEBT-EQUITY-RATIO-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ total_debt; long_term_debt; equity }>
 *   D/E = total_debt / equity；长期负债比 = long_term_debt / total_debt
 * 输出(正常): { debtEquity, longTermDebtRatio, totalDebt, totalEquity, degraded: false }
 * 输出(降级): 空数组 / equity=0 → degraded
 *   D358 决策 5: equity=0 不再 fallback 99（原实现 D/E=99 恒触发 >2.5 critical 误报）；
 *   分母 0 → degrade，aggregate 门控 !degraded。
 * 边界: 负债显式 0 → D/E 0 且不降级（无负债企业）
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface DebtEquityResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  debtEquity: number;
  longTermDebtRatio: number;
  totalDebt: number;
  totalEquity: number;
  degraded: boolean;
}

export function computeDebtEquityRatio(financials: Array<{
  total_debt: number;
  long_term_debt: number;
  equity: number;
}>): DebtEquityResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(financials, ['total_debt', 'equity']);
  if (_inputIssues.length > 0) return { debtEquity: 0, longTermDebtRatio: 0, totalDebt: 0, totalEquity: 0, degraded: true, warnings: _inputIssues };
  if (financials.length === 0) {
    return {
      debtEquity: 0, longTermDebtRatio: 0, totalDebt: 0, totalEquity: 0, degraded: true,
    };
  }
  const totalDebt = financials.reduce((s, f) => s + (f.total_debt || 0), 0);
  const totalLtDebt = financials.reduce((s, f) => s + (f.long_term_debt || 0), 0);
  const totalEquity = financials.reduce((s, f) => s + (f.equity || 0), 0);

  if (totalEquity === 0) {
    return {
      debtEquity: 0, longTermDebtRatio: 0, totalDebt, totalEquity: 0, degraded: true,
    };
  }

  const debtEquity = totalDebt / totalEquity;
  const longTermDebtRatio = totalDebt > 0 ? totalLtDebt / totalDebt : 0;

  return {
    debtEquity: Math.round(debtEquity * 100) / 100,
    longTermDebtRatio: Math.round(longTermDebtRatio * 100) / 100,
    totalDebt,
    totalEquity,
    degraded: false,
  };
}
