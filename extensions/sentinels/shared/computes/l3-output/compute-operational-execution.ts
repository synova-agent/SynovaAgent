/**
 * compute-operational-execution.ts — 把资源转化为产出 (3.1)
 *
 * @contract COMPUTE-OPERATIONAL-EXECUTION-v1 OperationalExecutionInput {value,confidence,evidence,degraded,warnings} efficiencyRate<0||defect_rate<0
 * 模块: l3-output/operational_execution
 * 消费边: OPERATIONAL_EXECUTION
 * 输入: efficiencyRate(0-1), defect_rate(0-1)
 * 输出(正常): { value: efficiency_rate × (1 - defect_rate), confidence:'high'|'medium', evidence[], degraded:false }
 * 输出(降级): { value:0, confidence:'low', degraded:true, warnings:['无产出数据'] }
 *
 * 算法: efficiency_rate × (1 - defect_rate)
 */
export interface OperationalExecutionInput {
  efficiencyRate: number;  // 生产效率(0-1), -1=未配置
  defect_rate: number;      // 缺陷率(0-1), -1=未配置
}

export function computeOperationalExecution(input: OperationalExecutionInput) {
  const warnings: string[] = [];
  const { efficiencyRate, defect_rate } = input;

  if (efficiencyRate < 0 || defect_rate < 0) {
    return {
      value: 0, confidence: 'low' as const, evidence: [],
      degraded: true, warnings: ['无产出数据 — efficiencyRate 或 defect_rate 未配置'],
    };
  }

  const clampedEff = Math.max(0, Math.min(1, efficiencyRate));
  const clampedDefect = Math.max(0, Math.min(1, defect_rate));

  const value = Math.round(clampedEff * (1 - clampedDefect) * 1000) / 1000;
  const confidence = value > 0.5 ? 'high' as const : 'medium' as const;

  return {
    value,
    confidence,
    evidence: [`efficiencyRate: ${clampedEff}`, `defect_rate: ${clampedDefect}`],
    degraded: false,
    warnings,
  };
}
