/**
 * margin-health/computes/compute-fixed-variable-ratio.ts — 固定成本占比计算（D358 迁自 _extinct/cost-health）
 *
 * 契约ID: COMPUTE-FIXED-VARIABLE-RATIO-v1（迁移版 — 算法冻结，数据获取上移 aggregate）
 * 输入: financials: Array<{ total_revenue; gross_margin; operatingExpenses; fixed_cost? }>
 *   COGS = total_revenue − gross_margin（毛利润金额制）；总成本 = COGS + operatingExpenses。
 *   fixed_cost 为 erp 契约外扩展字段（snake_case），缺失 → 本指标降级（缺失≠0）。
 * 输出(正常): { value: fixed_cost/total_cost(0-1), degraded: false }
 * 输出(降级): 空数组 / fixed_cost 全缺 / 总成本=0 → { value: 0, degraded: true, warnings: [...] }
 * 边界: fixed_cost 显式 0 → value 0 且不降级（无固定成本≠无数据）
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface FixedVariableRatioResult {
  /** 固定成本占比 (fixed_cost / total_cost)，0-1 */
  value: number;
  fixedCost: number;
  totalCost: number;
  evidence: string[];
  degraded: boolean;
  warnings: string[];
}

export function computeFixedVariableRatio(financials: Array<{
  total_revenue: number;
  gross_margin: number;
  operatingExpenses: number;
  fixed_cost?: number;
}>): FixedVariableRatioResult {
  // #1408：输入有效性检查（显式调用）
  const _inputIssues = checkFiniteInputs(financials, ['total_revenue', 'gross_margin']);
  if (_inputIssues.length > 0) {
    return { value: 0, fixedCost: 0, totalCost: 0, evidence: [], degraded: true, warnings: _inputIssues };
  }
  if (financials.length === 0) {
    return {
      value: 0, fixedCost: 0, totalCost: 0,
      evidence: [], degraded: true,
      warnings: ['无成本数据 — 无法计算固定成本占比'],
    };
  }

  let fixedCost = 0;
  let totalCost = 0;
  let hasFixedCost = false;
  for (const f of financials) {
    if (f.fixed_cost !== undefined && f.fixed_cost !== null) {
      fixedCost += f.fixed_cost;
      hasFixedCost = true;
    }
    const cogs = f.total_revenue - f.gross_margin;
    totalCost += cogs + f.operatingExpenses;
  }

  if (!hasFixedCost) {
    return {
      value: 0, fixedCost: 0, totalCost,
      evidence: [], degraded: true,
      warnings: ['fixed_cost 缺失（erp 契约外扩展字段）— 无法计算固定成本占比'],
    };
  }

  if (totalCost === 0) {
    return {
      value: 0, fixedCost, totalCost: 0,
      evidence: [], degraded: true,
      warnings: ['总成本为 0 — 无法计算固定成本占比（分母 guard）'],
    };
  }

  const ratio = fixedCost / totalCost;

  return {
    value: Math.round(ratio * 10000) / 10000,
    fixedCost,
    totalCost,
    evidence: [`固定成本: ${fixedCost}`, `总成本: ${totalCost}`],
    degraded: false,
    warnings: [],
  };
}
