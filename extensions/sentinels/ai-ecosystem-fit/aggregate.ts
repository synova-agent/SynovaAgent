import { createHash } from 'node:crypto';
import type { SentinelFinding, MetricRow, SentinelAggregateResult } from "../../../src/sentinel/types";
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeAiEcosystemFit } from "./computes/compute-ai-ecosystem-fit";
import { createLogger } from "@synova/logger";
const log = createLogger("sentinel/ai-ecosystem-fit");
interface GSR { queryNodes(t:string,f?:Record<string,unknown>,g?:string): Array<{id:string;type:string;props:Record<string,unknown>}> }
export const AiEcosystemFitSentinel = {
  async check(s: GSR, tid: string, traversal?: GraphTraversal): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const ca = now.toISOString();
    // #1375 A2：metrics 容器（try 外声明 ⇒ catch 分支可见）
    const metricsHolder: MetricRow[] = [];

    try {
      // @deprecated — 语义迁移由D15处理
      if (traversal) { const r = traversal.traverse([tid], ['DEPLOYS']); if (!r.nodes[0]) return []; }
      const tools = s.queryNodes("Tool",{tid});
      const aiApis = tools.filter(t => t.props.aiEnabled === true || (t.props.protocol as string || '')?.includes('ai'));
      const aiPlatforms = [...new Set(tools.filter(t => t.props.platform).map(t => t.props.platform as string))];
      const r = computeAiEcosystemFit({
        apiCompatible: aiApis.length,
        totalApis: tools.length,
        platformsCovered: aiPlatforms.length,
        totalPlatforms: 5,
        devEcosystemScore: Math.min(aiPlatforms.length / 3, 1),
      });
      

      const inputDigest = createHash('sha256').update(JSON.stringify([tools.map(t => t.id).sort()])).digest('hex').slice(0, 16);

      // #1375 A2：赋值（catch 分支仍可见 holder）

      metricsHolder.push(...(r.degraded ? [] : [{ metricId: 'AI-ECOSYSTEM-FIT-SCORE', value: Number(r.score) || 0, unit: 'ratio', sourceId: 'sentinel-ai-ecosystem-fit', inputDigest }]));

      if (r.degraded) return { findings: [{description:'',id:`t-na`,severity:"info",title:"无AI生态数据",evidence:[],suggestion:"",detectedAt:ca}], metrics: [] };
      if (r.score < 0.3) return { findings: [{id:`t-ai`,severity:"warning",title:"AI生态匹配度偏低",description:`匹配度${(r.score*100).toFixed(0)}%`,evidence:[`匹配度: ${(r.score*100).toFixed(0)}%`],suggestion:"增加对主流AI平台的API兼容性",detectedAt:ca}], metrics: metricsHolder };
      return { findings: [], metrics: metricsHolder };
    } catch(e: unknown) { log.error({e}); return { findings: [{id:`e`,severity:"warning",title:"异常",description:`${(e as Error)?.message||""}`,evidence:[],suggestion:"",detectedAt:ca}], metrics: metricsHolder }; }
  },
};
