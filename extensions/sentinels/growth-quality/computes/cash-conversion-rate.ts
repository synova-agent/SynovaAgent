/**
 * growth-quality/computes/cash-conversion-rate.ts — 现金流转化率
 *
 * 净利润中有多少转化为经营现金流。
 * 转化率 < 0.7 表示应收账款或存货积压问题。
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface CashConversionResult {
  /** #1408：输入有效性等告警 */
  warnings?: string[];
  rate: number;
  operatingCashFlow: number;
  netIncome: number;
  degraded: boolean;
}

export function computeCashConversionRate(financials: Array<{
  operatingCashFlow: number;
  netIncome: number;
  revenue: number;
}>): CashConversionResult {
  // #1408：输入有效性检查（本 compute 自己声明必需字段）
  const _inputIssues = checkFiniteInputs(financials, ['operatingCashFlow', 'netIncome', 'revenue']);
  if (_inputIssues.length > 0) return { ...{ rate: 0, operatingCashFlow: 0, netIncome: 0, degraded: true }, warnings: _inputIssues };
  if (financials.length === 0) {
    return { rate: 0, operatingCashFlow: 0, netIncome: 0, degraded: true };
  }
  const totalOcf = financials.reduce((s, f) => s + (f.operatingCashFlow || 0), 0);
  const totalNi = financials.reduce((s, f) => s + (f.netIncome || 0), 0);
  const rate = totalNi > 0 ? totalOcf / totalNi : (totalOcf > 0 ? 1 : 0);
  return { rate: Math.round(rate * 100) / 100, operatingCashFlow: totalOcf, netIncome: totalNi, degraded: false };
}
