import { createHash } from 'node:crypto';
/**
 * growth-quality/aggregate.ts — F4 增长质量指数哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 */
import type { MetricRow, SentinelAggregateResult, SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeCashConversionRate } from './computes/cash-conversion-rate';
import { computeOrganicGrowthPct } from './computes/organic-growth-pct';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/growth-quality');
interface GraphStoreReader { queryNodes(type: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown>; }>; }

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  cash_conversion: { warning: 0.7, critical: 0.5 },
  organic_growth: { warning: 0.5, critical: 0.3 },
} as const;

export const growthQualitySentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date(); const checkedAt = now.toISOString();
    let finNodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
    let usedTraversal = false;

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'growth-quality', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'growth-quality', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };
    // #1375 B3b（A2 + CTO 裁 (a) 每 compute 一行）：哨兵只**返回** metrics（不碰库）
    //   metric_id 命名依 #1054 样板（`CASH-FLOW-GROSS-MARGIN`）：<哨兵域大写>-<FIELD 大写>
    let metricsHolder: MetricRow[] = [];
    let inputDigest = '';   // 读取后赋值（见下方 finNodes 处）

    try {
      // @deprecated — 语义迁移由D15处理
      try { if (traversal) { const r = traversal.traverse([teamId], ['FUNDS', 'OPERATIONAL_EXECUTION']); if (r.nodes[0]) { finNodes = r.nodes; usedTraversal = true; } } } catch (err: unknown) { log.warn({ err, teamId }, '图遍历失败 — 降级到旧路径'); }
      if (!usedTraversal) { finNodes = store.queryNodes('Financial', { teamId }); }
      inputDigest = createHash('sha256').update(JSON.stringify(finNodes)).digest('hex').slice(0, 16);
      const financials = finNodes.map(n => ({
        operatingCashFlow: Number(n.props.operatingCashFlow) || 0,
        netIncome: Number(n.props.netIncome) || Number(n.props.profit) || 0,
        revenue: Number(n.props.revenue) || 0,
        previousRevenue: Number(n.props.previousRevenue) || 0,
        acquisitionRevenue: Number(n.props.acquisitionRevenue) || 0,
      }));

      const ccr = computeCashConversionRate(financials);
      if (!ccr.degraded) metricsHolder.push({ metricId: 'GROWTH-QUALITY-CASH-CONVERSION-RATE', value: Number(ccr.rate) || 0, unit: 'ratio', sourceId: 'sentinel-growth-quality', inputDigest });
      const ogr = computeOrganicGrowthPct(financials);
      if (!ogr.degraded) metricsHolder.push({ metricId: 'GROWTH-QUALITY-ORGANIC-GROWTH-PCT', value: Number(ogr.organicPct) || 0, unit: 'ratio', sourceId: 'sentinel-growth-quality', inputDigest });
      const findings: SentinelFinding[] = [];

      if (!ccr.degraded && ccr.rate < th('cash_conversion').critical) {
        findings.push({ id: `f4-ccr-crit`, severity: 'critical', title: `现金流转化率过低 (${(ccr.rate * 100).toFixed(0)}%)`, description: '净利润转化为经营现金流不足 50%，应收账款或存货积压严重。', evidence: [`转化率: ${(ccr.rate * 100).toFixed(0)}%`, `经营现金流: ${ccr.operatingCashFlow}`, `净利润: ${ccr.netIncome}`], suggestion: '收紧信用政策，加速应收账款回收。', detectedAt: checkedAt });
      } else if (!ccr.degraded && ccr.rate < th('cash_conversion').warning) {
        findings.push({ id: `f4-ccr-warn`, severity: 'warning', title: `现金流转化率偏低 (${(ccr.rate * 100).toFixed(0)}%)`, description: '转化率 < 70%。', evidence: [`转化率: ${(ccr.rate * 100).toFixed(0)}%`], suggestion: '检查应收账款和存货周转情况。', detectedAt: checkedAt });
      }

      if (!ogr.degraded && ogr.organicPct < th('organic_growth').critical) {
        findings.push({ id: `f4-org-crit`, severity: 'critical', title: `有机增长比例过低 (${(ogr.organicPct * 100).toFixed(0)}%)`, description: '增长高度依赖并购而非内生能力。', evidence: [`有机增长占比: ${(ogr.organicPct * 100).toFixed(0)}%`, `总增长率: ${ogr.totalGrowth}%`], suggestion: '评估并购整合效果，加强内生增长能力。', detectedAt: checkedAt });
      } else if (!ogr.degraded && ogr.organicPct < th('organic_growth').warning) {
        findings.push({ id: `f4-org-warn`, severity: 'warning', title: `有机增长比例偏低 (${(ogr.organicPct * 100).toFixed(0)}%)`, description: '有机增长 < 50%。', evidence: [`有机增长占比: ${(ogr.organicPct * 100).toFixed(0)}%`], suggestion: '关注内生增长动力。', detectedAt: checkedAt });
      }

      // #1375 B3b：标识符形态返回也须带 metrics（否则 loader 读不到 ⇒ 0 行）

      return { findings: findings, metrics: metricsHolder };
    } catch (err: unknown) {
      log.error({ err }, '[growth-quality] check 失败');
      return { findings: [{ id: `f4-error`, severity: 'warning', title: '增长质量检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }], metrics: metricsHolder };
    }
  },
};
