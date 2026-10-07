import { createHash } from 'node:crypto';
import type { SentinelFinding, MetricRow, SentinelAggregateResult } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeValueCaptureScore } from './computes/value-capture-score';
import { createLogger } from '@synova/logger';
const log = createLogger('sentinel/value-capture');
interface GraphStoreReader { queryNodes(t: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>; }
export const valueCaptureSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const checkedAt = now.toISOString();
    // #1375 B3：metrics 容器（try 外声明 ⇒ catch 可见）
    let metricsHolder: MetricRow[] = [];

    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B4 收尾）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1/B2/B3 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-value-capture', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-value-capture', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const finNodes = store.queryNodes('Financial', { teamId });
      const financials = finNodes.map(n => ({ revenue: Number(n.props.revenue) || 0, cost: Number(n.props.cost) || 0, netProfit: Number(n.props.netProfit) || Number(n.props.profit) || 0, previousRevenue: Number(n.props.previousRevenue) || 0 }));
      const r = computeValueCaptureScore(financials);
      // #1375 B3（A2）：哨兵只**返回** metrics（不碰库）
      metricsHolder = r.degraded ? [] : [{ metricId: 'VALUE-CAPTURE-INDEX', value: Number(r.captureIndex) || 0, unit: 'ratio', sourceId: 'sentinel-value-capture', inputDigest: createHash('sha256').update(JSON.stringify(financials)).digest('hex').slice(0, 16) }];;
      if (r.degraded) { log.warn({ teamId }, 'compute degraded — skipping threshold'); return { findings: [], metrics: [] }; }
      log.debug({ captureIndex: r.captureIndex }, '价值捕获计算完成');
      if (r.captureIndex < 0.2) return [{ id: `i6-crit`, severity: 'critical', title: `价值捕获效率低 (${(r.captureIndex*100).toFixed(0)}%)`, description: '利润留存和定价能力不足。', evidence: [`捕获指数: ${(r.captureIndex*100).toFixed(0)}%`, `毛利率: ${(r.grossMargin*100).toFixed(0)}%`, `净利润率: ${(r.profitRetention*100).toFixed(0)}%`], suggestion: '审查定价策略和成本结构。', detectedAt: checkedAt }];
      if (r.captureIndex < 0.4) return [{ id: `i6-warn`, severity: 'warning', title: `价值捕获效率偏低 (${(r.captureIndex*100).toFixed(0)}%)`, description: '价值转化能力需提升。', evidence: [`捕获指数: ${(r.captureIndex*100).toFixed(0)}%`, ...r.signals], suggestion: '优化定价和毛利率。', detectedAt: checkedAt }];
      return { findings: [], metrics: metricsHolder };
    } catch (err: unknown) { log.error({ err }, '[value-capture] 失败'); return [{ id: `i6-error`, severity: 'warning', title: '检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }]; }
  },
};
