import { createHash } from 'node:crypto';
/**
 * financing-constraint/aggregate.ts — F1 融资约束指数哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 */
import type { SentinelFinding, SentinelThresholdPair, MetricRow, SentinelAggregateResult } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeKzIndex } from './computes/kz-index';
import { computeCashRunway } from './computes/cash-runway';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/financing-constraint');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  kz_index: { warning: 1.0, critical: 2.0 },
} as const;

interface GraphStoreReader { queryNodes(type: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown>; }>; }

export const financingConstraintSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const checkedAt = now.toISOString();
    let finNodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
    let usedTraversal = false;

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'financing-constraint', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'financing-constraint', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };
    // #1375 B3：metrics 容器（try 外声明 ⇒ catch 可见）
    let metricsHolder: MetricRow[] = [];

    try {
      // @deprecated — 语义迁移由D15处理
      try { if (traversal) { const r = traversal.traverse([teamId], ['FUNDS']); if (r.nodes[0]) { finNodes = r.nodes; usedTraversal = true; } } } catch (err: unknown) { log.warn({ err, teamId }, '图遍历失败 — 降级到旧路径'); }
      if (!usedTraversal) { finNodes = store.queryNodes('Financial', { teamId }); }
      const financials = finNodes.map(n => ({
        operatingCashFlow: Number(n.props.operatingCashFlow) || 0,
        netPpe: Number(n.props.netPPE) || Number(n.props.netPpe) || 0,
        totalDebt: Number(n.props.totalDebt) || 0,
        equity: Number(n.props.equity) || 0,
        cash: Number(n.props.cash) || 0,
      }));

      const result = computeKzIndex(financials);
      // #1375 B3（A2）：哨兵只**返回** metrics（不碰库）
      metricsHolder = result.degraded ? [] : [{ metricId: 'FINANCING-CONSTRAINT-KZ-INDEX', value: Number(result.kzIndex) || 0, unit: 'ratio', sourceId: 'sentinel-financing-constraint', inputDigest: createHash('sha256').update(JSON.stringify(financials)).digest('hex').slice(0, 16) }];;
      log.debug({ kzIndex: result.kzIndex }, 'KZ指数计算完成');

      if (result.kzIndex > th('kz_index').critical) {
        return { findings: [{ id: `f1-kz-crit`, severity: 'critical', title: `融资约束严重 (KZ=${result.kzIndex.toFixed(2)})`, description: 'KZ>2.0: 企业确定受到融资约束。', evidence: [`KZ: ${result.kzIndex.toFixed(2)}`, `CF/K: ${result.cfRatio.toFixed(3)}`, `杠杆: ${result.leverage.toFixed(3)}`, `现金/K: ${result.cashRatio.toFixed(3)}`, ...result.warnings], suggestion: '评估融资渠道，考虑补充资本或优化现金流。', detectedAt: checkedAt }], metrics: metricsHolder };
      } else if (result.kzIndex > th('kz_index').warning) {
        return { findings: [{ id: `f1-kz-warn`, severity: 'warning', title: `融资约束偏紧 (KZ=${result.kzIndex.toFixed(2)})`, description: 'KZ 1.0-2.0: 可能存在融资约束。', evidence: [`KZ: ${result.kzIndex.toFixed(2)}`], suggestion: '关注现金流趋势，准备融资预案。', detectedAt: checkedAt }], metrics: metricsHolder };
      }
      return { findings: [], metrics: metricsHolder };
    } catch (err: unknown) {
      log.error({ err }, '[financing-constraint] check 失败');
      return { findings: [{ id: `f1-error`, severity: 'warning', title: '融资约束检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }], metrics: metricsHolder };
    }
  },
};
