/**
 * growth-quality/computes/organic-growth-pct.ts — 有机增长比例
 *
 * 营收增长中剔除并购/汇率等因素后的有机增长比例。
 * 低有机增长 = 增长依赖外部收购而非内生能力。
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface OrganicGrowthResult {
  /** #1408：输入有效性等告警 */
  warnings?: string[];
  organicPct: number;
  totalGrowth: number;
  organicGrowth: number;
  degraded: boolean;
}

export function computeOrganicGrowthPct(financials: Array<{
  revenue: number;
  previousRevenue: number;
  acquisitionRevenue: number;
}>): OrganicGrowthResult {
  // #1408：输入有效性检查（本 compute 自己声明必需字段）
  const _inputIssues = checkFiniteInputs(financials, ['revenue', 'previousRevenue', 'acquisitionRevenue']);
  if (_inputIssues.length > 0) return { ...{ organicPct: 0.5, totalGrowth: 0, organicGrowth: 0, degraded: true }, warnings: _inputIssues };
  if (financials.length < 2) {
    return { organicPct: 0.5, totalGrowth: 0, organicGrowth: 0, degraded: true };
  }
  const totalRev = financials.reduce((s, f) => s + f.revenue, 0);
  const prevRev = financials.reduce((s, f) => s + (f.previousRevenue || 0), 0);
  const acqRev = financials.reduce((s, f) => s + (f.acquisitionRevenue || 0), 0);
  const totalGrowth = prevRev > 0 ? (totalRev - prevRev) / prevRev : 0;
  const organicGrowth = Math.max(totalGrowth - (prevRev > 0 ? acqRev / prevRev : 0), 0);
  const organicPct = totalGrowth > 0 ? organicGrowth / totalGrowth : (organicGrowth > 0 ? 1 : 0.5);
  return { organicPct: Math.round(organicPct * 100) / 100, totalGrowth: Math.round(totalGrowth * 10000) / 100, organicGrowth: Math.round(organicGrowth * 10000) / 100, degraded: false };
}
