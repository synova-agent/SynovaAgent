/**
 * capital-health/computes/asset-turnover.ts — 资产周转率计算（D358 迁自 _extinct/capital-turnover）
 *
 * 契约ID: COMPUTE-ASSET-TURNOVER-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ total_revenue; total_assets; current_assets }>
 *   总资产周转率 = total_revenue / total_assets；流动资产周转率 = total_revenue / current_assets
 * 输出(正常): { totalTurnover, currentTurnover, totalRevenue, totalAssets, currentAssets, degraded: false }
 * 输出(降级): 空数组 / total_revenue=0 / total_assets=0 → degraded
 *   D358 决策 5: total_assets=0 不再产出周转率 0（原实现 0 恒 <0.5 触发 critical 误报）；
 *   分母 0 → degrade，aggregate 门控 !degraded。
 * 边界: 总周转率恰好 0.5（critical 阈值线）→ 不降级
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface AssetTurnoverResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  totalTurnover: number;
  currentTurnover: number;
  totalRevenue: number;
  totalAssets: number;
  currentAssets: number;
  degraded: boolean;
}

export function computeAssetTurnover(financials: Array<{
  total_revenue: number;
  total_assets: number;
  current_assets: number;
}>): AssetTurnoverResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(financials, ['total_revenue', 'total_assets']);
  if (_inputIssues.length > 0) return { totalTurnover: 0, currentTurnover: 0, totalRevenue: 0, totalAssets: 0, currentAssets: 0, degraded: true, warnings: _inputIssues };
  if (financials.length === 0) {
    return {
      totalTurnover: 0, currentTurnover: 0,
      totalRevenue: 0, totalAssets: 0, currentAssets: 0, degraded: true,
    };
  }
  const tr = financials.reduce((s, f) => s + f.total_revenue, 0);
  const ta = financials.reduce((s, f) => s + (f.total_assets || 0), 0);
  const ca = financials.reduce((s, f) => s + (f.current_assets || 0), 0);

  if (tr === 0 || ta === 0) {
    return {
      totalTurnover: 0, currentTurnover: 0,
      totalRevenue: tr, totalAssets: ta, currentAssets: ca, degraded: true,
    };
  }

  return {
    totalTurnover: Math.round((tr / ta) * 100) / 100,
    currentTurnover: ca > 0 ? Math.round((tr / ca) * 100) / 100 : 0,
    totalRevenue: tr,
    totalAssets: ta,
    currentAssets: ca,
    degraded: false,
  };
}
