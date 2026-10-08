import { createHash } from 'node:crypto';
import type { SentinelFinding, MetricRow, SentinelAggregateResult } from "../../../src/sentinel/types";
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeAgentDeploymentMaturity } from "./computes/compute-agent-deployment-maturity";
import { createLogger } from "@synova/logger";
const log = createLogger("sentinel/agent-deployment-maturity");
interface GSR { queryNodes(t:string,f?:Record<string,unknown>,g?:string): Array<{id:string;type:string;props:Record<string,unknown>}> }
export const AgentDeploymentMaturitySentinel = {
  async check(s: GSR, tid: string, traversal?: GraphTraversal): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const ca = now.toISOString();
    // #1375 A2：metrics 容器（try 外声明 ⇒ catch 分支可见）
    const metricsHolder: MetricRow[] = [];

    try {
      // @deprecated — 语义迁移由D15处理
      // #1387（机制③）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 business-model-coherence 的"带回退"模板）；
      //   🔴 **留痕粒度边界（CTO 2026-10-08 裁）**：
      //     ① 无匹配边 = "我走了备用路径"（**正常**）⇒ `log.warn` + 退回；**不置 `result.degraded`**
      //     ② 退回后**也读空** = "我没有数据"（**降级**）⇒ 归 **#1379 V3** 规则 ⇒ 【那时才】置 `degraded`
      //   ⇒ 故此处 warn 却不置 degraded：**前者该留痕不该降级，后者才该降级**（下一个人不必再问"为什么"）
      if (traversal) {
        try {
          const r = traversal.traverse([tid], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-agent-deployment-maturity', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径（store 读）；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-agent-deployment-maturity', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const agents = s.queryNodes("Agent",{tid});
      const tools = s.queryNodes("Tool",{tid});
      const monitoredAgents = agents.filter(a => a.props.monitored === true).length;
      const recentErrors = tools.filter(t => t.props.error === true || t.props.failing === true).length;
      const totalOps = tools.length || 1;
      // #1387 + #1379 V3（CTO 裁定）：**退回后也读空 ⇒ 机制②（读空）** ⇒ 留痕 + 置 degraded + **不产出 metrics**
      //   （不得让 compute 的默认值把『没有数据』算成一个分数 —— 那是**编造**，M3 防线）
      if (agents.length === 0 && tools.length === 0) {
        log.warn({ sentinelId: 'sentinel-agent-deployment-maturity', degraded: true, reason: 'empty-read', types: ['Agent','Tool'] },
          '退回旧路径后仍读空 ⇒ 降级（无数据 ≠ 正常；不发 metrics）');
        return { findings: [], metrics: [], degraded: true };
      }
      const r = computeAgentDeploymentMaturity({
        agentCount: agents.length,
        autonomyLevel: 2,
        monitoredAgents,
        totalAgents: agents.length || 1,
        recentErrors,
        totalOperations: totalOps,
      });
      

      const inputDigest = createHash('sha256').update(JSON.stringify([agents.map(a => a.id).sort(), tools.map(t => t.id).sort()])).digest('hex').slice(0, 16);

      // #1375 A2：赋值（catch 分支仍可见 holder）

      metricsHolder.push(...(r.degraded ? [] : [{ metricId: 'AGENT-DEPLOYMENT-MATURITY-SCORE', value: Number(r.score) || 0, unit: 'ratio', sourceId: 'sentinel-agent-deployment-maturity', inputDigest }]));

      if (r.degraded) return { findings: [{description:'',id:`t-na`,severity:"info",title:"无Agent数据",evidence:[],suggestion:"",detectedAt:ca}], metrics: [] };
      if (r.score < 0.3) return { findings: [{id:`t-age`,severity:"warning",title:"Agent部署成熟度偏低",description:`成熟度${(r.score*100).toFixed(0)}%`,evidence:[`成熟度: ${(r.score*100).toFixed(0)}%`],suggestion:"增加Agent监控和自治等级",detectedAt:ca}], metrics: metricsHolder };
      return { findings: [], metrics: metricsHolder };
    } catch(e: unknown) { log.error({e}); return { findings: [{id:`e`,severity:"warning",title:"异常",description:`${(e as Error)?.message||""}`,evidence:[],suggestion:"",detectedAt:ca}], metrics: metricsHolder }; }
  },
};
