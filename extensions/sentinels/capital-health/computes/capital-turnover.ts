/**
 * capital-health/computes/capital-turnover.ts — 资本周转率计算（D358 迁自 _extinct/capital-efficiency）
 *
 * 契约ID: COMPUTE-CAPITAL-TURNOVER-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ total_revenue; total_debt?; equity? }>
 *   资本周转率 = total_revenue / (total_debt + equity)。反映单位资本产生的营收效率。
 * 输出(正常): { turnover, totalRevenue, totalCapital, degraded: false }
 * 输出(降级): 空数组 / total_revenue=0 / 投入资本=0 → degraded
 *   D358 决策 5: 投入资本 0 不再 fallback rev/1（原实现假值——无资本数据不得产出周转率）；
 *   total_revenue=0 亦降级（无收入不得产出周转率结论）。
 * 边界: 周转率恰好 0.8（warning 阈值线）→ 不降级
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface CapitalTurnoverResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  /** 营收 / 投入资本 */
  turnover: number;
  totalRevenue: number;
  totalCapital: number;
  degraded: boolean;
}

export function computeCapitalTurnover(financials: Array<{
  total_revenue: number;
  total_debt?: number;
  equity?: number;
}>): CapitalTurnoverResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(financials, ['total_revenue']);
  if (_inputIssues.length > 0) return { turnover: 0, totalRevenue: 0, totalCapital: 0, degraded: true, warnings: _inputIssues };
  if (financials.length === 0) {
    return { turnover: 0, totalRevenue: 0, totalCapital: 0, degraded: true };
  }

  const totalRevenue = financials.reduce((s, f) => s + f.total_revenue, 0);
  const totalCapital = financials.reduce(
    (s, f) => s + (f.total_debt || 0) + (f.equity || 0), 0,
  );

  if (totalRevenue === 0 || totalCapital === 0) {
    return { turnover: 0, totalRevenue, totalCapital, degraded: true };
  }

  const turnover = totalRevenue / totalCapital;

  return {
    turnover: Math.round(turnover * 10000) / 10000,
    totalRevenue,
    totalCapital,
    degraded: false,
  };
}
