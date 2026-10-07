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
      if (traversal) { const r = traversal.traverse([tid], ['DEPLOYS']); if (!r.nodes[0]) return []; }
      const agents = s.queryNodes("Agent",{tid});
      const tools = s.queryNodes("Tool",{tid});
      const monitoredAgents = agents.filter(a => a.props.monitored === true).length;
      const recentErrors = tools.filter(t => t.props.error === true || t.props.failing === true).length;
      const totalOps = tools.length || 1;
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
