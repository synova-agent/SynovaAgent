import type { SentinelFinding } from "../../../src/sentinel/types";
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeHumanAgentBoundary } from "./computes/compute-human-agent-boundary";
import { createLogger } from "@synova/logger";
const log = createLogger("sentinel/human-agent-boundary");
interface GSR { queryNodes(t:string,f?:Record<string,unknown>,g?:string): Array<{id:string;type:string;props:Record<string,unknown>}> }
export const HumanAgentBoundarySentinel = {
  async check(s: GSR, tid: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const now = new Date(); const ca = now.toISOString();
    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B2）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([tid], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-human-agent-boundary', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-human-agent-boundary', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const tools = s.queryNodes("Tool",{tid});
      const processes = s.queryNodes("Process",{tid});
      const automatedPct = tools.length > 0 ? tools.filter(t => t.props.automated === true).length / tools.length : 0;
      const handoffs = tools.filter(t => t.props.handoff === true);
      const r = computeHumanAgentBoundary({
        automatedTasks: tools.filter(t => t.props.automated === true).length,
        totalTasks: tools.length || 1,
        successfulHandoffs: handoffs.filter(t => t.props.successful === true).length,
        totalHandoffs: handoffs.length || 1,
        preAgentThroughput: 100,
        postAgentThroughput: 100 * (1 + automatedPct * 0.5),
        satisfactionScore: 0.7,
      });
      if (r.degraded) return [{description:'',id:`t-na`,severity:"info",title:"无混合边界数据",evidence:[],suggestion:"",detectedAt:ca}];
      if (r.score < 0.3) return [{id:`t-hum`,severity:"warning",title:"人机协同效率偏低",description:`效率${(r.score*100).toFixed(0)}%`,evidence:[`效率: ${(r.score*100).toFixed(0)}%`],suggestion:"优化人机任务分配",detectedAt:ca}];
      return [];
    } catch(e: unknown) { log.error({e}); return [{id:`e`,severity:"warning",title:"异常",description:`${(e as Error)?.message||""}`,evidence:[],suggestion:"",detectedAt:ca}]; }
  },
};
