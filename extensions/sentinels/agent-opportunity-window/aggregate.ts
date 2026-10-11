/**
 * K3-3-8: AI 化机会窗口哨兵 — aggregate（宪章 §3.6 报正向执行体）
 *
 * 与存量"报异常"哨兵相反：本哨兵在就绪度**越过增强阈值**（manifest.thresholds.
 * opportunityScore.warning）时产出**正向发现**（SentinelFinding.polarity='positive'，
 * severity='info'）——报告"机会窗口开启"，不是异常。
 *
 * 契约:
 *   @input  — s: GraphStoreReader 结构子集（queryNodes）；tid: teamId；
 *             thresholds: loader 注入（manifest 基线 + memStore 覆写，D577）；
 *             未注入时回退 this.manifest.thresholds；两者皆缺 ⇒ 不产 finding（无尺子不裁）。
 *   @output — SentinelFinding[] 或 { findings, degraded, metrics }（D577 形态）。
 *   @degraded — 图上无 Tool 且无 Process ⇒ { findings: [], degraded: true }（铁律 24/31）。
 *   @error  — 内部异常 log.error + 返回 warning finding（不抛、不静默）。
 */
import type { SentinelFinding, SentinelAggregateResult, MetricRow } from "../../../src/sentinel/types";
import { computeAgentOpportunityWindow } from "./computes/compute-agent-opportunity-window";
import { createLogger } from "@synova/logger";

const log = createLogger("sentinel/agent-opportunity-window");

interface GSR { queryNodes(t: string, f?: Record<string, unknown>): Array<{ id: string; type: string; props: Record<string, unknown> }> }

interface ThresholdPair { warning: number; critical: number }

/** 解析生效阈值：loader 注入优先（含 memStore 覆写），否则 manifest 基线 */
function resolveThresholds(injected?: Record<string, ThresholdPair>, own?: Record<string, ThresholdPair>): ThresholdPair | null {
  const pair = injected?.opportunityScore ?? own?.opportunityScore;
  if (!pair || typeof pair.warning !== 'number' || !Number.isFinite(pair.warning)) return null;
  return pair;
}

export const AgentOpportunityWindowSentinel = {
  manifest: null as unknown,
  async check(
    s: GSR,
    tid: string,
    _traversal?: unknown,
    thresholdsInjected?: Record<string, ThresholdPair>,
  ): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date().toISOString();
    try {
      const tools = s.queryNodes("Tool", { tid });
      const processes = s.queryNodes("Process", { tid });
      const agentReady = tools.filter(t =>
        Boolean(t.props.protocol || t.props.connector || t.props.llm || t.props.agent),
      ).length;
      const digitized = processes.filter(p => p.props.digitized === true || p.props.automated === true).length;

      const r = computeAgentOpportunityWindow({
        agentReadyTools: agentReady,
        totalTools: tools.length,
        digitizedProcesses: digitized,
        totalProcesses: processes.length,
      });

      if (r.degraded) {
        log.warn({ sentinelId: 'sentinel-agent-opportunity-window', tid, degraded: true },
          '无工具且无流程数据 — 降级，不产 finding（铁律 24/31）');
        return { findings: [], degraded: true };
      }

      const own = (this.manifest && typeof this.manifest === 'object'
        ? (this.manifest as { thresholds?: Record<string, ThresholdPair> }).thresholds
        : undefined);
      const pair = resolveThresholds(thresholdsInjected, own);
      const metrics: MetricRow[] = [{
        metricId: 'agent-opportunity-score',
        value: r.score,
        unit: 'ratio',
        evidenceRef: 'agent-opportunity-window/computes/compute-agent-opportunity-window.ts',
      }];

      // 增强阈值门控（正向方向：score >= warning ⇒ 窗口开启）。无阈值 ⇒ 不裁（禁假绿）。
      if (!pair || r.score < pair.warning) {
        log.info({ sentinelId: 'sentinel-agent-opportunity-window', score: r.score, warning: pair?.warning ?? null },
          '未越过增强阈值 — 机会窗口未开启');
        return { findings: [], metrics };
      }

      const finding: SentinelFinding = {
        id: `aow-window-open-${tid}`,
        severity: 'info',
        polarity: 'positive',
        title: 'AI 化机会窗口开启（报正向）',
        description: `AI 化就绪度 ${(r.score * 100).toFixed(0)}% 已越过增强阈值 ${(pair.warning * 100).toFixed(0)}% — 企业已具备落地 AI/Agent 的条件，属于正向机会信号`,
        evidence: [
          `score=${r.score}`,
          `toolingReadiness=${r.toolingReadiness}`,
          `processReadiness=${r.processReadiness}`,
          `dataReadiness=${r.dataReadiness}`,
          `thresholdWarning=${pair.warning}`,
        ],
        suggestion: '抓住窗口：优先在就绪度最高的工具/流程上落地 AI 场景，并设定增强循环（宪章 §3.6）',
        detectedAt: now,
      };
      return { findings: [finding], metrics };
    } catch (e: unknown) {
      log.error({ err: e instanceof Error ? e.message : String(e), sentinelId: 'sentinel-agent-opportunity-window' },
        '检查异常 — 返回 warning finding（不静默）');
      return [{
        id: `aow-error-${tid}`,
        severity: 'warning',
        title: 'AI 化机会窗口哨兵异常',
        description: e instanceof Error ? e.message : String(e),
        evidence: [],
        suggestion: '检查图数据可用性',
        detectedAt: now,
      }];
    }
  },
};
