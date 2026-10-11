/**
 * K3-3-8: AI 化机会窗口（宪章 §3.6 报正向）
 *
 * 契约（铁律 47）:
 *   @input  — agentReadyTools: 已具备 Agent/LLM 接入条件的工具数（protocol/connector/llm/agent 任一）
 *             totalTools: 工具总数；digitizedProcesses: 已数字化/自动化流程数；
 *             totalProcesses: 流程总数。全部非负整数。
 *   @output — score ∈ [0,1]（0.35*tooling + 0.35*process + 0.30*data，两位小数）；
 *             toolingReadiness / processReadiness / dataReadiness ∈ [0,1]；
 *             degraded: true 当且仅当 totalTools===0 且 totalProcesses===0（无数据可算）。
 *   @degraded — degraded=true 时 score 固定 0（不编假值，铁律 24/31）。
 *   @threshold — 窗口开闭由 aggregate 按增强阈值判定；本函数只出分数，不判窗口。
 */
export interface AgentOpportunityWindowResult {
  score: number;
  toolingReadiness: number;
  processReadiness: number;
  dataReadiness: number;
  degraded: boolean;
}

export function computeAgentOpportunityWindow(params: {
  agentReadyTools: number;
  totalTools: number;
  digitizedProcesses: number;
  totalProcesses: number;
}): AgentOpportunityWindowResult {
  const { agentReadyTools, totalTools, digitizedProcesses, totalProcesses } = params;
  if (totalTools === 0 && totalProcesses === 0) {
    return { score: 0, toolingReadiness: 0, processReadiness: 0, dataReadiness: 0, degraded: true };
  }
  const toolingReadiness = totalTools > 0 ? Math.min(agentReadyTools / totalTools, 1) : 0;
  const processReadiness = totalProcesses > 0 ? Math.min(digitizedProcesses / totalProcesses, 1) : 0;
  const dataReadiness = totalTools > 0 ? Math.min(agentReadyTools / Math.max(totalTools, 1), 1) : 0;
  const score = Math.round((0.35 * toolingReadiness + 0.35 * processReadiness + 0.3 * dataReadiness) * 100) / 100;
  return {
    score,
    toolingReadiness: Math.round(toolingReadiness * 100) / 100,
    processReadiness: Math.round(processReadiness * 100) / 100,
    dataReadiness: Math.round(dataReadiness * 100) / 100,
    degraded: false,
  };
}
