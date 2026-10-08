import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface CaptureResult { captureIndex: number; grossMargin: number; profitRetention: number; signals: string[]; degraded: boolean; }
export function computeValueCaptureScore(financials: Array<{ revenue: number; cost: number; netProfit: number; previousRevenue: number }>): CaptureResult {
  // #1408：输入有效性检查（本 compute 自己声明必需字段）
  const _inputIssues = checkFiniteInputs(financials, ['revenue', 'cost', 'netProfit', 'previousRevenue']);
  if (_inputIssues.length > 0) return { ...{ captureIndex: 0, grossMargin: 0, profitRetention: 0, signals: ['无数据'], degraded: true }, signals: _inputIssues };
  if (financials.length === 0) return { captureIndex: 0, grossMargin: 0, profitRetention: 0, signals: ['无数据'], degraded: true };
  const totalRev = financials.reduce((s, f) => s + f.revenue, 0);
  const totalCost = financials.reduce((s, f) => s + f.cost, 0);
  const totalProfit = financials.reduce((s, f) => s + f.netProfit, 0);
  const prevRev = financials.reduce((s, f) => s + (f.previousRevenue || 0), 0);
  const grossMargin = totalRev > 0 ? (totalRev - totalCost) / totalRev : 0;
  const profitRetention = totalRev > 0 ? totalProfit / totalRev : 0;
  const priceTrend = prevRev > 0 && totalRev > 0 && financials.length > 0 ? (totalRev / financials.length) / (prevRev / financials.length) - 1 : 0;
  const captureIndex = 0.5 * grossMargin + 0.3 * profitRetention + 0.2 * Math.max(priceTrend, 0);
  const signals: string[] = [];
  if (grossMargin < 0.2) signals.push('毛利率 < 20%');
  if (profitRetention < 0.05) signals.push('净利润率 < 5%');
  return { captureIndex: Math.round(captureIndex * 100) / 100, grossMargin: Math.round(grossMargin * 100) / 100, profitRetention: Math.round(profitRetention * 100) / 100, signals, degraded: false };
}
