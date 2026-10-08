/**
 * T7: Agent 部署成熟度
 *
 * 理论依据: Gartner AI 成熟度模型 — Level 0(无) 到 Level 4(自主)。
 * 成熟度 = 部署规模 x 自治等级 x 监控覆盖率 x 可靠性。
 *
 * 评分方法:
 * - agentCount: 已部署的 AI Agent 数量
 * - autonomyLevel: 自治等级 [0,4], 0=全人工 4=全自治
 * - monitoredRatio: 有监控的 Agent 比例
 * - errorRate: 总操作中的错误率
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface AgentMaturityResult {
  /** #1408：输入有效性等告警（缺字段/NaN/非有限 ⇒ 非空） */
  warnings?: string[];
  score: number;
  agentCount: number;
  autonomyLevel: number;
  monitoredRatio: number;
  errorRate: number;
  degraded: boolean;
}

export function computeAgentDeploymentMaturity(params: {
  agentCount: number;
  autonomyLevel: number;
  monitoredAgents: number;
  totalAgents: number;
  recentErrors: number;
  totalOperations: number;
}): AgentMaturityResult {
  // #1408：输入有效性检查（**params 对象型** ⇒ 逐字段名与 params 逐字一致）
  const _inputIssues = checkFiniteInputs(params, ['agentCount', 'autonomyLevel', 'monitoredAgents', 'totalAgents', 'recentErrors', 'totalOperations']);
  if (_inputIssues.length > 0) return { ...{ score: 0, agentCount: 0, autonomyLevel: 0, monitoredRatio: 0, errorRate: 0, degraded: true }, warnings: _inputIssues };
  const { agentCount, autonomyLevel, monitoredAgents, totalAgents, recentErrors, totalOperations } = params;
  if (totalAgents === 0) return { score: 0, agentCount: 0, autonomyLevel: 0, monitoredRatio: 0, errorRate: 0, degraded: true };
  const autonomy = Math.min(autonomyLevel / 4, 1);
  const monitoredRatio = monitoredAgents / totalAgents;
  const errorRate = totalOperations > 0 ? recentErrors / totalOperations : 1;
  const reliability = Math.max(1 - errorRate, 0);
  const scale = Math.min(agentCount / 20, 1);
  return {
    score: Math.round((0.3 * autonomy + 0.3 * monitoredRatio + 0.2 * reliability + 0.2 * scale) * 100) / 100,
    agentCount,
    autonomyLevel,
    monitoredRatio: Math.round(monitoredRatio * 100) / 100,
    errorRate: Math.round(errorRate * 100) / 100,
    degraded: false,
  };
}
