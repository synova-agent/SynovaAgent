import { createHash } from 'node:crypto';
/**
 * environment-rent-dependency/aggregate.ts — E5 环境红利依赖性哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 */
import type { SentinelFinding, SentinelThresholdPair, MetricRow, SentinelAggregateResult } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeRentDependencyIndex } from './computes/rent-dependency-index';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/rent-dependency');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  rent_dependency: { warning: 0.3, critical: 0.5 },
} as const;

interface GraphStoreReader { queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; type: string; props: Record<string, unknown>; }>; }

export const environmentRentDependencySentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const checkedAt = now.toISOString();
    let finNodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
    let usedTraversal = false;

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'environment-rent-dependency', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'environment-rent-dependency', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };
    // #1375 B3：metrics 容器（try 外声明 ⇒ catch 可见）
    let metricsHolder: MetricRow[] = [];

    try {
      // @deprecated — 语义迁移由D15处理
      try { if (traversal) { const r = traversal.traverse([teamId], ['FUNDS', 'OPERATIONAL_EXECUTION']); if (r.nodes[0]) { finNodes = r.nodes; usedTraversal = true; } } } catch (err: unknown) { log.warn({ err, teamId }, '图遍历失败 — 降级到旧路径'); }
      if (!usedTraversal) { finNodes = store.queryNodes('Financial', { teamId }); }
      const financials = finNodes.map(n => ({ type: (n.props.financialType as string) || (n.props.type as string) || 'revenue', value: Number(n.props.amount) || 0 }));
      const result = computeRentDependencyIndex(financials);
      // #1375 B3（A2）：哨兵只**返回** metrics（不碰库）
      metricsHolder = result.degraded ? [] : [{ metricId: 'ENVIRONMENT-RENT-DEPENDENCY-INDEX', value: Number(result.index) || 0, unit: 'ratio', sourceId: 'sentinel-environment-rent-dependency', inputDigest: createHash('sha256').update(JSON.stringify(financials)).digest('hex').slice(0, 16) }];;
      log.debug({ index: result.index }, '环境红利依赖计算完成');

      if (result.index > th('rent_dependency').critical) {
        return { findings: [{ id: `e5-rent`, severity: 'critical', title: `环境红利依赖度过高 (${(result.index * 100).toFixed(0)}%)`, description: `企业过度依赖外部环境红利。`, evidence: result.signals, suggestion: '建立独立于外部红利的核心竞争力。', detectedAt: checkedAt }], metrics: metricsHolder };
      } else if (result.index > th('rent_dependency').warning) {
        return { findings: [{ id: `e5-rent-warn`, severity: 'warning', title: `环境红利依赖中等 (${(result.index * 100).toFixed(0)}%)`, description: '部分营收依赖外部红利。', evidence: result.signals, suggestion: '评估外部红利可持续性。', detectedAt: checkedAt }], metrics: metricsHolder };
      }
      return { findings: [], metrics: metricsHolder };
    } catch (err: unknown) {
      log.error({ err }, '[rent-dependency] check 失败');
      return { findings: [{ id: `e5-error`, severity: 'warning', title: '环境红利检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }], metrics: metricsHolder };
    }
  },
};
