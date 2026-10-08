/**
 * I12: 自制/外购决策健康度
 *
 * 理论依据: Williamson 交易成本经济学。企业应将核心能力保持在内，
 * 非核心活动通过市场获取。核心能力外购意味着战略脆弱性。
 *
 * 评分方法:
 * - capabilities: 企业各项能力的自制/外购状态列表
 * - 如果核心能力(core_competence/core)被外购，健康度降低
 * - health ∈ [0.1, 0.8]，0.8 = 全部自制，0.1 = 核心全部外购
 */
import { checkRequiredFields } from '../../../../src/sentinel/assert-finite-inputs';   // #1408 批 C2b：存在性维度
export interface MakeOrBuyResult {
  health: number;
  outsourcedCore: string[];
  totalCapabilities: number;
  degraded: boolean;
}

export function computeMakeOrBuyScore(capabilities: Array<{ category: string; inHouse: boolean }>): MakeOrBuyResult {
  // #1408 批 C2b：**结构/存在性**检查 —— 本类型**无数值字段可查**（category:string｜inHouse:boolean｜type:string｜props:object）
  //   ⇒ **不适用 ≠ 不管**：缺字段仍必须有信号（CTO 2026-10-08 裁）
  const _missing = checkRequiredFields(capabilities, ['category', 'inHouse']);
  if (_missing.length > 0) return Object.assign({}, { health: 0.5, outsourcedCore: [], totalCapabilities: 0, degraded: true }, { signals: _missing });
  if (capabilities.length === 0) return { health: 0.5, outsourcedCore: [], totalCapabilities: 0, degraded: true };
  const core = capabilities.filter(c => c.category === 'core_competence' || c.category === 'core');
  const outsourcedCore = core.filter(c => !c.inHouse).map(c => c.category);
  const health = outsourcedCore.length > 0 ? Math.max(0.1, 0.5 - outsourcedCore.length * 0.1) : 0.8;
  return {
    health: Math.round(health * 100) / 100,
    outsourcedCore,
    totalCapabilities: capabilities.length,
    degraded: false,
  };
}
