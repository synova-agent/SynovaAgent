import { createHash } from 'node:crypto';
import type { SentinelFinding, MetricRow, SentinelAggregateResult } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeMakeOrBuyScore } from './computes/make-or-buy-score';
import { createLogger } from '@synova/logger';
const log = createLogger('sentinel/make-or-buy');
interface GraphStoreReader { queryNodes(t: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>; }
export const makeOrBuySentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const checkedAt = now.toISOString();
    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B2）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-make-or-buy', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-make-or-buy', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const personNodes = store.queryNodes('Person', { teamId });
      // 核心能力从 Person 节点的 role/dept/skills 提取
      const caps = personNodes.map(n => ({ category: (n.props.dept as string) || (n.props.role as string) || 'supporting', inHouse: n.props.inHouse !== false }));
      const r = computeMakeOrBuyScore(caps);
      // #1375 B2（A2）：哨兵只**返回** metrics（不碰库）；inputDigest 由哨兵给
      const inputDigest = createHash('sha256').update(JSON.stringify(caps)).digest('hex').slice(0, 16);
      const metricsHolder: MetricRow[] = r.degraded ? [] : [{ metricId: 'MAKE-OR-BUY-HEALTH', value: Number(r.health) || 0, unit: 'ratio', sourceId: 'sentinel-make-or-buy', inputDigest }];
      if (r.degraded) { log.warn({ teamId }, 'compute degraded — skipping threshold'); return { findings: [], metrics: [] }; }
      if (r.health < 0.2) return { findings: [{ id: `i12-crit`, severity: 'critical', title: `自制/外购决策风险 (${(r.health*100).toFixed(0)}%)`, description: '核心能力被外包。', evidence: [`健康度: ${(r.health*100).toFixed(0)}%`, `外包核心能力: ${r.outsourcedCore.join(',') || '无'}`], suggestion: '评估核心能力是否不应外包。', detectedAt: checkedAt }], metrics: metricsHolder };
      return { findings: [], metrics: metricsHolder };
    } catch (err: unknown) { log.error({ err }, '[make-or-buy] 失败'); return [{ id: `i12-error`, severity: 'warning', title: '检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }]; }
  },
};
