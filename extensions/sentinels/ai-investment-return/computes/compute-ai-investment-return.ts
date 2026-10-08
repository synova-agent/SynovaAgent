/**
 * T8: AI 投入产出比
 *
 * 理论依据: AI 项目 ROI = (成本节约 + 收入增长) / 总投资。
 * 需考虑投资回收期，短期 ROI 可能为负值。
 *
 * 评分方法:
 * - costSaving: AI 带来的成本节约
 * - revenueUplift: AI 驱动的收入增长
 * - totalInvestment: AI 总投资
 * - paybackMonths: 预计投资回收期（月）
 * - roi = min(costSaving+revenueUplift)/investment, 3x封顶
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface AiInvestmentResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  roi: number;
  costSaving: number;
  revenueUplift: number;
  totalInvestment: number;
  paybackMonths: number;
  degraded: boolean;
}

export function computeAiInvestmentReturn(params: {
  costSaved: number;
  revenueUplift: number;
  totalInvestment: number;
  paybackMonths: number;
}): AiInvestmentResult {
  // #1408：输入有效性检查（**params 对象型** ⇒ 逐字段名与 params 逐字一致）
  const _inputIssues = checkFiniteInputs(params, ['costSaved', 'revenueUplift', 'totalInvestment', 'paybackMonths']);
  if (_inputIssues.length > 0) return { ...{ roi: 0, costSaving: 0, revenueUplift: 0, totalInvestment: 0, paybackMonths: 0, degraded: true }, warnings: _inputIssues };
  const { costSaved, revenueUplift, totalInvestment, paybackMonths } = params;
  if (totalInvestment <= 0) return { roi: 0, costSaving: 0, revenueUplift: 0, totalInvestment: 0, paybackMonths: 0, degraded: true };
  const totalReturn = costSaved + revenueUplift;
  const rawRoi = totalReturn / totalInvestment;
  const normalizedPayback = Math.min(36 / Math.max(paybackMonths, 1), 1);
  const score = Math.min(rawRoi / 3, 1) * 0.7 + normalizedPayback * 0.3;
  return {
    roi: Math.round(score * 100) / 100,
    costSaving: costSaved,
    revenueUplift,
    totalInvestment,
    paybackMonths,
    degraded: false,
  };
}
