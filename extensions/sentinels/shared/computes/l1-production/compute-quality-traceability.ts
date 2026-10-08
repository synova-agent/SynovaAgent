/**
 * compute-quality-traceability.ts — 质量可追溯性评分
 *
 * 契约ID: COMPUTE-QUALITY-TRACEABILITY-v1
 * 模块: l1-production
 * 消费边: PRODUCES, DEPENDS_ON
 * 输入: tracedUnits: number, totalUnits: number, defect_rate: number
 * 输出(正常): { value: number(0-1), confidence:'high', evidence:[], degraded:false }
 */
export function computeQualityTraceability(tracedUnits: number, totalUnits: number, defect_rate: number): {
  value: number;
  traceabilityRate: number;
  qualityScore: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  degraded: boolean;
  warnings: string[];
  computedAt: string;
} {
  const warnings: string[] = [];
  const computedAt = new Date().toISOString();

  if (totalUnits <= 0) {
    return { value: 0, traceabilityRate: 0, qualityScore: 0, confidence: 'low', evidence: [], degraded: true, warnings: ['总单位数为0'], computedAt };
  }

  const traceabilityRate = Math.min(tracedUnits / totalUnits, 1);
  const qualityScore = Math.max(0, 1 - defect_rate);
  const combined = traceabilityRate * 0.5 + qualityScore * 0.5;

  if (tracedUnits > totalUnits) warnings.push('可追溯单位数超过总数 — 数据可能不一致');
  if (defect_rate < 0 || defect_rate > 1) warnings.push('缺陷率不在0-1范围内');

  return {
    value: Math.round(combined * 10000) / 10000,
    traceabilityRate: Math.round(traceabilityRate * 10000) / 10000,
    qualityScore: Math.round(qualityScore * 10000) / 10000,
    confidence: totalUnits >= 100 ? 'high' : 'medium',
    evidence: [`可追溯: ${tracedUnits}/${totalUnits}`, `缺陷率: ${(defect_rate * 100).toFixed(1)}%`],
    degraded: false,
    warnings,
    computedAt,
  };
}
