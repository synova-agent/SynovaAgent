import { createHash } from 'node:crypto';
import type { SentinelFinding, MetricRow, SentinelAggregateResult } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeModelCoherence } from './computes/model-consistency-score';
import { createLogger } from '@synova/logger';
const log = createLogger('sentinel/bizmodel-coherence');
interface GraphStoreReader { queryNodes(t: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>; }
export const businessModelCoherenceSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const checkedAt = now.toISOString();
    let allNodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
    let usedTraversal = false;
    // #1375 A2：metrics 容器（try 外声明 ⇒ catch 分支可见）
    const metricsHolder: MetricRow[] = [];

    try {
      // @deprecated — 语义迁移由D15处理
      try { if (traversal) { const r = traversal.traverse([teamId], ['FUNDS', 'DEPLOYS', 'OPERATIONAL_EXECUTION']); if (r.nodes[0]) { allNodes = r.nodes; usedTraversal = true; } } } catch (err: unknown) { log.warn({ err, teamId }, '图遍历失败 — 降级到旧路径'); }
      if (!usedTraversal) { allNodes = (store.queryNodes('Event', { teamId }) || []).concat(store.queryNodes('Tool', { teamId })).concat(store.queryNodes('Client', { teamId })).concat(store.queryNodes('Person', { teamId })).concat(store.queryNodes('Financial', { teamId })); }
      const r = computeModelCoherence(allNodes);
      log.debug({ coherence: r.score }, '商业模式一致性计算完成');
      

      const inputDigest = createHash('sha256').update(JSON.stringify([allNodes.map(n => n.id).sort()])).digest('hex').slice(0, 16);

      // #1375 A2：赋值（catch 分支仍可见 holder）

      metricsHolder.push(...(r.degraded ? [] : [{ metricId: 'BUSINESS-MODEL-COHERENCE-SCORE', value: Number(r.score) || 0, unit: 'ratio', sourceId: 'sentinel-business-model-coherence', inputDigest }]));

      if (r.score < 0.2) return { findings: [{ id: `i7-crit`, severity: 'critical', title: `商业模式一致性低 (${(r.score*100).toFixed(0)}%)`, description: '价值主张-收入-成本结构存在明显不一致。', evidence: [`一致性: ${(r.score*100).toFixed(0)}%`, ...r.signals], suggestion: '审视核心价值主张与收入模式的匹配度。', detectedAt: checkedAt }], metrics: metricsHolder };
      if (r.score < 0.4) return { findings: [{ id: `i7-warn`, severity: 'warning', title: `商业模式一致性偏低 (${(r.score*100).toFixed(0)}%)`, description: '部分维度存在不匹配。', evidence: [`一致性: ${(r.score*100).toFixed(0)}%`, ...r.signals], suggestion: '优化收入模式或成本结构。', detectedAt: checkedAt }], metrics: metricsHolder };
      if (r.signals.length > 0) return { findings: [{ id: `i7-info`, severity: 'info', title: `商业模式一致性 (${(r.score*100).toFixed(0)}%)`, description: '基础一致但部分定义缺失。', evidence: r.signals, suggestion: '补充缺失的商业模式定义。', detectedAt: checkedAt }], metrics: metricsHolder };
      return { findings: [], metrics: metricsHolder };
    } catch (err: unknown) { log.error({ err }, '[bizmodel-coherence] 失败'); return { findings: [{ id: `i7-error`, severity: 'warning', title: '检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }], metrics: metricsHolder }; }
  },
};
