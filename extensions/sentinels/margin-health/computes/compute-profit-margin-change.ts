/**
 * margin-health/computes/compute-profit-margin-change.ts — 净利率计算（D358 迁自 _extinct/profit-health）
 *
 * 契约ID: COMPUTE-PROFIT-MARGIN-CHANGE-v1（迁移版 — 算法冻结，数据获取上移 aggregate）
 * 输入: financials: Array<{ total_revenue; gross_margin; operating_expense }>
 *   净利率 = (gross_margin − operating_expense) / total_revenue（毛利润金额制）
 *   名称保留「change」系迁移自 profit-health 的历史命名，实现语义为利润率水平（算法不改）。
 * 输出(正常): { value: 净利率 ∈ [-1, 1] 可为负, degraded: false, warnings: [] }
 * 输出(降级): 空数组 / total_revenue=0 → { value: 0, degraded: true, warnings: [...] }
 *   分母 0 → degrade（D358 决策 5: 堵 0/0 假值）
 * 边界: operating_expense 显式 0 → 净利率 = 毛利率
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface ProfitMarginResult {
  /** 净利率 ((gross_margin − operating_expense) / total_revenue)，可为负 */
  value: number;
  totalRevenue: number;
  netProfit: number;
  evidence: string[];
  degraded: boolean;
  warnings: string[];
}

export function computeProfitMarginChange(financials: Array<{
  total_revenue: number;
  gross_margin: number;
  operating_expense: number;
}>): ProfitMarginResult {
  // #1408：输入有效性检查（显式调用）
  const _inputIssues = checkFiniteInputs(financials, ['total_revenue', 'gross_margin']);
  if (_inputIssues.length > 0) {
    return { value: 0, totalRevenue: 0, netProfit: 0, evidence: [], degraded: true, warnings: _inputIssues };
  }
  if (financials.length === 0) {
    return {
      value: 0, totalRevenue: 0, netProfit: 0,
      evidence: [], degraded: true,
      warnings: ['无财务数据 — 无法计算净利率'],
    };
  }

  const totalRevenue = financials.reduce((s, f) => s + f.total_revenue, 0);
  const netProfit = financials.reduce(
    (s, f) => s + f.gross_margin - f.operating_expense, 0,
  );

  if (totalRevenue === 0) {
    return {
      value: 0, totalRevenue: 0, netProfit,
      evidence: [], degraded: true,
      warnings: ['总收入为 0 — 无法计算净利率（分母 guard）'],
    };
  }

  const profitMargin = netProfit / totalRevenue;

  return {
    value: Math.round(profitMargin * 10000) / 10000,
    totalRevenue,
    netProfit,
    evidence: [`收入: ${totalRevenue}`, `净利: ${netProfit}`],
    degraded: false,
    warnings: [],
  };
}
