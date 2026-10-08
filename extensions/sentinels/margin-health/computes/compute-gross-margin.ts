/**
 * margin-health/computes/compute-gross-margin.ts — 毛利率计算（D358 迁自 _extinct/cost-health）
 *
 * 契约ID: COMPUTE-GROSS-MARGIN-v1（迁移版 — 算法冻结，数据获取上移 aggregate）
 * 输入: financials: Array<{ total_revenue: number; gross_margin: number }>
 *   erp-standard 契约: gross_margin prop = 毛利润金额（非比率），total_revenue = 营业收入。
 *   prop 归一化（camel→snake、金额制换算）在 aggregate 层完成，本函数为纯函数。
 * 输出(正常): { value: 毛利率(0-1), evidence: ['收入: N', '毛利润: N'], degraded: false, warnings: [] }
 * 输出(降级): 空数组 / 总收入=0 → { value: 0, degraded: true, warnings: [...] }
 *   分母 0 → degrade（D358 决策 5: 堵 0/0 假值）
 * 边界: gross_margin 显式 0（无毛利企业）→ value 0 且不降级（显式 0 ≠ 缺失）
 */
import { checkFiniteInputs } from '../../shared/computes/assert-finite-inputs';   // #1408：输入有效性检查
export interface GrossMarginResult {
  /** 毛利率 (gross_profit / total_revenue)，0-1 */
  value: number;
  totalRevenue: number;
  grossProfit: number;
  evidence: string[];
  degraded: boolean;
  warnings: string[];
}

export function computeGrossMargin(financials: Array<{
  total_revenue: number;
  gross_margin: number;
}>): GrossMarginResult {
  // #1408：输入有效性检查（显式调用）
  const _inputIssues = checkFiniteInputs(financials, ['total_revenue', 'gross_margin']);
  if (_inputIssues.length > 0) {
    return { value: 0, totalRevenue: 0, grossProfit: 0, evidence: [], degraded: true, warnings: _inputIssues };
  }
  if (financials.length === 0) {
    return {
      value: 0, totalRevenue: 0, grossProfit: 0,
      evidence: [], degraded: true,
      warnings: ['无财务数据 — 无法计算毛利率'],
    };
  }

  const totalRevenue = financials.reduce((s, f) => s + f.total_revenue, 0);
  const grossProfit = financials.reduce((s, f) => s + f.gross_margin, 0);

  if (totalRevenue === 0) {
    return {
      value: 0, totalRevenue, grossProfit,
      evidence: [], degraded: true,
      warnings: ['总收入为 0 — 无法计算毛利率（分母 guard）'],
    };
  }

  const grossMargin = grossProfit / totalRevenue;

  return {
    value: Math.round(grossMargin * 10000) / 10000,
    totalRevenue,
    grossProfit,
    evidence: [`收入: ${totalRevenue}`, `毛利润: ${grossProfit}`],
    degraded: false,
    warnings: [],
  };
}
