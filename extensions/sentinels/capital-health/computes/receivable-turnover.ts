/**
 * capital-health/computes/receivable-turnover.ts — 应收账款周转计算（D358 迁自 _extinct/capital-turnover）
 *
 * 契约ID: COMPUTE-RECEIVABLE-TURNOVER-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ total_revenue; receivables }>
 *   周转率 = total_revenue / receivables；周转天数 = 365 / 周转率
 *   （erp-standard: 应收账款 prop = receivables，归一化映射 accountsReceivable → receivables）
 *   高周转 = 回款快；低 DSO = 营运资金效率好
 * 输出(正常): { turnoverRatio, daysOutstanding, totalRevenue, avgReceivables, degraded: false }
 * 输出(降级): 空数组 / receivables=0 / total_revenue=0 → degraded
 *   D358 决策 5: 应收为 0 不再产出天数 0（原实现 0 天恒「健康」，掩盖缺失数据）；
 *   分母 0 → degrade，aggregate 门控 !degraded。
 * 边界: 周转天数恰好 60（warning 阈值线）→ 不降级
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface ReceivableTurnoverResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  turnoverRatio: number;
  daysOutstanding: number;
  totalRevenue: number;
  avgReceivables: number;
  degraded: boolean;
}

export function computeReceivableTurnover(financials: Array<{
  total_revenue: number;
  receivables: number;
}>): ReceivableTurnoverResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(financials, ['total_revenue', 'receivables']);
  if (_inputIssues.length > 0) return { turnoverRatio: 0, daysOutstanding: 0, totalRevenue: 0, avgReceivables: 0, degraded: true, warnings: _inputIssues };
  if (financials.length === 0) {
    return {
      turnoverRatio: 0, daysOutstanding: 0, totalRevenue: 0, avgReceivables: 0, degraded: true,
    };
  }
  const tr = financials.reduce((s, f) => s + f.total_revenue, 0);
  const ar = financials.reduce((s, f) => s + (f.receivables || 0), 0);

  if (tr === 0 || ar === 0) {
    return {
      turnoverRatio: 0, daysOutstanding: 0, totalRevenue: tr, avgReceivables: ar, degraded: true,
    };
  }

  const ratio = tr / ar;
  return {
    turnoverRatio: Math.round(ratio * 100) / 100,
    daysOutstanding: Math.round(365 / ratio),
    totalRevenue: tr,
    avgReceivables: ar,
    degraded: false,
  };
}
