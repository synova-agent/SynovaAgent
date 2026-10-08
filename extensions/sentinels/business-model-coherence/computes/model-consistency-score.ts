/**
 * I7 商业模式一致性: 三角框架
 * - 价值主张(VP) vs 收入模式(Rev): VP是否支撑定价
 * - 收入模式 vs 成本结构(Cost): 毛利是否合理
 * - 成本结构 vs 核心能力(Cap): 成本是否投入在关键能力
 */
import { checkRequiredFields } from '../../../../src/sentinel/assert-finite-inputs';   // #1408 批 C2b：存在性维度
export interface CoherenceResult { score: number; vpRevFit: number; revCostFit: number; costCapFit: number; signals: string[]; degraded: boolean; }
export function computeModelCoherence(nodes: Array<{ type: string; props: Record<string, unknown> }>): CoherenceResult {
  // #1408 批 C2b：**结构/存在性**检查 —— 本类型**无数值字段可查**（category:string｜inHouse:boolean｜type:string｜props:object）
  //   ⇒ **不适用 ≠ 不管**：缺字段仍必须有信号（CTO 2026-10-08 裁）
  const _missing = checkRequiredFields(nodes, ['type', 'props']);
  if (_missing.length > 0) return Object.assign({}, { score: 0, vpRevFit: 0, revCostFit: 0, costCapFit: 0, signals: ['无数据'], degraded: true }, { signals: _missing });
  if (nodes.length === 0) return { score: 0, vpRevFit: 0, revCostFit: 0, costCapFit: 0, signals: ['无数据'], degraded: true };
  const signals: string[] = [];
  const hasVP = nodes.some(n => n.type === 'BusinessModel' || n.props.valueProposition);
  const hasRevenue = nodes.some(n => n.props.revenue || n.props.pricing);
  const hasCost = nodes.some(n => n.props.cost || n.props.costStructure);
  const hasCap = nodes.some(n => n.type === 'Capability' || n.props.capability);
  const vpRevFit = hasVP && hasRevenue ? 0.8 : (hasVP || hasRevenue ? 0.4 : 0.2);
  const revCostFit = hasRevenue && hasCost ? 0.8 : (hasRevenue || hasCost ? 0.4 : 0.2);
  const costCapFit = hasCost && hasCap ? 0.8 : (hasCost || hasCap ? 0.4 : 0.2);
  if (!hasVP) signals.push('缺少价值主张定义');
  if (!hasRevenue) signals.push('缺少收入模式定义');
  if (!hasCost) signals.push('缺少成本结构定义');
  const score = (vpRevFit + revCostFit + costCapFit) / 3;
  return { score: Math.round(score * 100) / 100, vpRevFit, revCostFit, costCapFit, signals, degraded: false };
}
