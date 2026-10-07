import type { SentinelFinding } from "../../../src/sentinel/types";
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeProcessAiReadiness } from "./computes/compute-process-ai-readiness";
import { createLogger } from "@synova/logger";
const log = createLogger("sentinel/process-ai-readiness");
interface GSR { queryNodes(t:string,f?:Record<string,unknown>,g?:string): Array<{id:string;type:string;props:Record<string,unknown>}> }
export const ProcessAiReadinessSentinel = {
  async check(s: GSR, tid: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const now = new Date(); const ca = now.toISOString();
    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B3）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1/B2 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([tid], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-process-ai-readiness', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-process-ai-readiness', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const tools = s.queryNodes("Tool",{tid});
      const processes = s.queryNodes("Process",{tid});
      const connectors = tools.filter(t => t.props.protocol || t.props.connector);
      const r = computeProcessAiReadiness({
        structuredDataRatio: tools.length > 0 ? connectors.length / tools.length : 0,
        digitizedProcesses: processes.filter(p => p.props.digitized === true || p.props.automated === true).length,
        totalProcesses: processes.length,
        teamSkillAvg: 3,
      });
      if (r.degraded) return [{description:'',id:`t-na`,severity:"info",title:"无流程数据",evidence:[],suggestion:"",detectedAt:ca}];
      if (r.score < 0.3) return [{id:`t-pro`,severity:"warning",title:"流程AI就绪度偏低",description:`就绪度${(r.score*100).toFixed(0)}%`,evidence:[`就绪度: ${(r.score*100).toFixed(0)}%`],suggestion:"提升数据结构和流程数字化水平",detectedAt:ca}];
      return [];
    } catch(e: unknown) { log.error({e}); return [{id:`e`,severity:"warning",title:"异常",description:`${(e as Error)?.message||""}`,evidence:[],suggestion:"",detectedAt:ca}]; }
  },
};
