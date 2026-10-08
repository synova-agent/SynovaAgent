import type { SentinelFinding } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeNicheSqueezeIndex } from './computes/niche-squeeze-index';
import { createLogger } from '@synova/logger';
const log = createLogger('sentinel/niche-squeeze');
interface GraphStoreReader { queryNodes(t: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>; }
export const nicheSqueezeSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const now = new Date(); const checkedAt = now.toISOString();
    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B3）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1/B2 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-niche-squeeze', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-niche-squeeze', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const nodes = [...store.queryNodes('Client', { teamId }), ...store.queryNodes('Agent', { teamId })];
      const competitors = nodes.map(n => ({ name: (n.props.name as string) || n.id, revenue: Number(n.props.revenue) || Number(n.props.amount) || 0 }));
      const r = computeNicheSqueezeIndex(competitors);
      if (r.degraded) { log.warn({ teamId }, 'compute degraded — skipping threshold'); return []; }
      log.debug({ squeeze: r.squeeze, hhi: r.hhi }, '挤压指数计算完成');
      if (r.squeeze > 0.7) return [{ id: `i2-crit`, severity: 'critical', title: `生态位严重挤压 (${(r.squeeze * 100).toFixed(0)}%)`, description: `HHI=${r.hhi}, 竞争者${r.competitorCount}个。`, evidence: [`挤压指数: ${(r.squeeze * 100).toFixed(0)}%`, `HHI: ${r.hhi}`], suggestion: '差异化或寻找新生态位。', detectedAt: checkedAt }];
      if (r.squeeze > 0.5) return [{ id: `i2-warn`, severity: 'warning', title: `生态位挤压 (${(r.squeeze * 100).toFixed(0)}%)`, description: `竞争压力增大。`, evidence: [`挤压指数: ${(r.squeeze * 100).toFixed(0)}%`, `HHI: ${r.hhi}`], suggestion: '评估竞争态势，考虑防御策略。', detectedAt: checkedAt }];
      return [];
    } catch (err: unknown) { log.error({ err }, '[niche-squeeze] 失败'); return [{ id: `i2-error`, severity: 'warning', title: '检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }]; }
  },
};
