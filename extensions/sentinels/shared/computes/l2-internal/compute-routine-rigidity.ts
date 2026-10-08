/**
 * compute-routine-rigidity.ts — "我们一直这样做"阻止调整 (2.10)
 *
 * @contract COMPUTE-ROUTINE-RIGIDITY-v1 RoutineRigidityInput {value,confidence,evidence,degraded,warnings} adjustmentFlexibility<0
 * 模块: l2-internal/routine_rigidity
 * 消费边: ROUTINE_RIGIDITY
 * 输入: adjustmentFlexibility(0-1)
 * 输出(正常): { value: 1 - adjustment_flexibility, confidence:'high'|'medium', evidence[], degraded:false }
 * 输出(降级): { value:0, confidence:'low', degraded:true, warnings:['无历史数据'] }
 *
 * 算法: 1 - adjustment_flexibility  (值越高=越僵化)
 */
export interface RoutineRigidityInput {
  adjustmentFlexibility: number; // 调整灵活性(0-1), -1=未配置
}

export function computeRoutineRigidity(input: RoutineRigidityInput) {
  const warnings: string[] = [];
  const { adjustmentFlexibility } = input;

  if (adjustmentFlexibility < 0) {
    return {
      value: 0, confidence: 'low' as const, evidence: [],
      degraded: true, warnings: ['无历史数据 — adjustmentFlexibility未配置'],
    };
  }

  const clamped = Math.max(0, Math.min(1, adjustmentFlexibility));
  const value = Math.round((1 - clamped) * 1000) / 1000;
  const confidence = value > 0.5 ? 'high' as const : 'medium' as const;

  return {
    value,
    confidence,
    evidence: [`adjustmentFlexibility: ${clamped}`, `routine_rigidity: ${value.toFixed(3)}`],
    degraded: false,
    warnings,
  };
}
