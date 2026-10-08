import { createHash } from 'node:crypto';
/**
 * margin-health/aggregate.ts — 利润健康哨兵(合并)
 *
 * D358 去灭绝: 原实现为壳桥接（动态 import 退役子哨兵 cost-health + profit-health，
 * 违反铁律 37 + 子哨兵读 camelCase 致真数据喂不进）。
 * 现为本哨兵自有归一化层: 读 erp-standard 契约 props（D455 后全 snake_case）→
 * 归一化为 typed records → 自家 computes/ 计算 → manifest 阈值判定。
 *
 * P1-3 双层降级:
 *  - 入口层: Financial 节点缺失 total_revenue/gross_margin/operating_expense 任一 →
 *    mh-degraded warning finding（防缺失字段默认 0 假 finding），跳过全部指标。
 *  - 指标层: 扩展字段（fixed_cost 等契约外）缺失 → 该指标 log.warn + 跳过，不发 finding。
 * 显式 0 视为合法数据（hasValue 存在性判定，D356 语义保留）；分母 0 → compute 自降级。
 */
import type { MetricRow, SentinelAggregateResult, SentinelFinding } from '../../../src/sentinel/types';
import type { GraphStoreReader, GraphTraversal } from '../../../src/l4/graph-traversal';
import type { SentinelManifest } from '../../../src/sentinel/sentinel-loader';
import { createLogger } from '@synova/logger';
import { computeGrossMargin } from './computes/compute-gross-margin';
import { computeFixedVariableRatio } from './computes/compute-fixed-variable-ratio';
import { computeCostPerHead } from './computes/compute-cost-per-head';
import { computeIncentiveBindGap } from './computes/compute-incentive-bind';
import { computeProfitMarginChange } from './computes/compute-profit-margin-change';
import { computeMarginVsBenchmark } from './computes/compute-margin-vs-benchmark';
import { computeMetricBindDivergence } from './computes/compute-metric-bind-divergence';

const log = createLogger('sentinel/margin-health');

interface MarginThreshold {
  warning: number;
  critical: number;
}

/** manifest 阈值直连单测无注入时的契约默认值（path-dependency 先例；D577 B1 补 ib/mbd 两 key = 现值新增） */
const DEFAULT_THRESHOLDS: Record<string, MarginThreshold> = {
  gross_margin: { warning: -0.05, critical: -0.15 },
  fixed_ratio: { warning: 0.6, critical: 0.75 },
  cost_per_head: { warning: 0.1, critical: 0.25 },
  profit_margin_change: { warning: -0.02, critical: -0.05 },
  margin_vs_benchmark: { warning: -0.05, critical: -0.15 },
  incentive_bind: { warning: 0.4, critical: 0.4 },
  metric_bind_divergence: { warning: 0.3, critical: 0.5 },
};

/** 入口必填字段组（D358 snake 化; 契约字段缺失 → 假 0 的源头，必须拦截） */
const REQUIRED_FIELD_GROUPS: Array<{ name: string; fields: string[] }> = [
  { name: 'total_revenue', fields: ['total_revenue'] },
  { name: 'gross_margin', fields: ['gross_margin'] },
  { name: 'operating_expense', fields: ['operating_expense'] },
];

/** 存在性判定: 显式 0 是合法数据，只有 undefined/null/'' 视为缺失 */
const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

export const marginHealthSentinel = {
  manifest: null as SentinelManifest | null, // 由 loader 注入（D356 P0-1）

  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[] | SentinelAggregateResult> {
    const now = new Date();
    const checkedAt = now.toISOString();
    const findings: SentinelFinding[] = [];

    // #1375 B3b（A2 + CTO 裁 (a) 每 compute 一行）：哨兵只**返回** metrics（不碰库）

    //   metric_id 命名依 #1054 样板（`CASH-FLOW-GROSS-MARGIN`）：<哨兵域大写>-<FIELD 大写>

    let metricsHolder: MetricRow[] = [];

    let inputDigest = '';   // 读取后赋值（见下方 finNodes 处）


    try {
      const finNodes = store.queryNodes('Financial', { teamId });
      inputDigest = createHash('sha256').update(JSON.stringify(finNodes)).digest('hex').slice(0, 16);
      if (finNodes.length === 0) {
        // 无 Financial 节点 = 正常空态，非降级
        log.info({ teamId }, '无 Financial 节点 — 空库基线');
        return { findings: [], metrics: metricsHolder };
      }

      const props = finNodes[0]?.props || {};
      const missingGroups = REQUIRED_FIELD_GROUPS.filter(
        g => !g.fields.some(f => hasValue(props[f])),
      );
      if (missingGroups.length > 0) {
        const names = missingGroups.map(g => g.name).join('、');
        log.warn({ teamId, missing: names }, 'Financial 节点缺必填字段组 — 跳过指标（防缺失默认 0 假 finding）');
        return { findings: [{
          id: `mh-degraded`,
          severity: 'warning',
          title: '利润健康数据不完整',
          description: `Financial 节点缺失必填字段组: ${names}。已跳过利润健康检查，避免缺失字段被默认为 0 产生误报。`,
          evidence: [`缺失字段组: ${names}`],
          suggestion: '请补全财务数据字段后重试。',
          detectedAt: checkedAt,
        }], metrics: metricsHolder };
      }

      // 归一化: erp-standard 契约 props → typed records
      // 入口已保证三个契约字段存在; fixed_cost 为契约外扩展字段（缺失 → undefined）
      const financials = finNodes.map(n => ({
        total_revenue: Number(n.props.total_revenue) || 0,
        gross_margin: Number(n.props.gross_margin) || 0,
        operating_expense: Number(n.props.operating_expense) || 0,
        fixed_cost: hasValue(n.props.fixed_cost) ? Number(n.props.fixed_cost) : undefined,
      }));

      // manifest 阈值: loader 注入优先，直连单测无注入 → 默认契约值
      const th = (key: string): MarginThreshold =>
        this.manifest?.thresholds?.[key] ?? DEFAULT_THRESHOLDS[key];

      // 1. 毛利率（cost-health 源）
      const gm = computeGrossMargin(financials);
      if (!gm.degraded) metricsHolder.push({ metricId: 'MARGIN-HEALTH-GROSS-MARGIN', value: Number(gm.value) || 0, unit: 'ratio', sourceId: 'sentinel-margin-health', inputDigest });
      if (!gm.degraded) {
        const t = th('gross_margin');
        if (gm.value <= t.critical) {
          findings.push({
            id: 'cost_gross_margin_critical',
            severity: 'critical',
            title: '毛利率严重下降',
            description: `毛利率 ${(gm.value * 100).toFixed(1)}%，低于 critical 阈值 ${(t.critical * 100).toFixed(0)}%。`,
            evidence: gm.evidence,
            suggestion: '立即审查定价与成本结构，识别亏损产品或客户线。',
            detectedAt: checkedAt,
          });
        } else if (gm.value <= t.warning) {
          findings.push({
            id: 'cost_gross_margin_warning',
            severity: 'warning',
            title: '毛利率下降',
            description: `毛利率 ${(gm.value * 100).toFixed(1)}%，低于 warning 阈值 ${(t.warning * 100).toFixed(0)}%。`,
            evidence: gm.evidence,
            suggestion: '关注成本上升或定价压力趋势，及早干预。',
            detectedAt: checkedAt,
          });
        }
      } else {
        log.warn({ teamId, warnings: gm.warnings }, '毛利率计算降级 — 跳过该指标');
      }

      // 2. 固定/变动成本比（fixed_cost 契约外扩展字段缺失 → compute 自降级）
      const fr = computeFixedVariableRatio(financials);
      if (!fr.degraded) metricsHolder.push({ metricId: 'MARGIN-HEALTH-FIXED-VARIABLE-RATIO', value: Number(fr.value) || 0, unit: 'ratio', sourceId: 'sentinel-margin-health', inputDigest });
      if (!fr.degraded) {
        const t = th('fixed_ratio');
        if (fr.value >= t.critical) {
          findings.push({
            id: 'cost_fixed_ratio_critical',
            severity: 'critical',
            title: '固定成本占比过高',
            description: `固定成本占比 ${(fr.value * 100).toFixed(1)}%，超出 critical 阈值 ${(t.critical * 100).toFixed(0)}%。成本结构僵化。`,
            evidence: fr.evidence,
            suggestion: '审查固定成本构成，寻找可变成本化机会（外包、按需资源）。',
            detectedAt: checkedAt,
          });
        } else if (fr.value >= t.warning) {
          findings.push({
            id: 'cost_fixed_ratio_warning',
            severity: 'warning',
            title: '固定成本占比偏高',
            description: `固定成本占比 ${(fr.value * 100).toFixed(1)}%，超出 warning 阈值 ${(t.warning * 100).toFixed(0)}%。`,
            evidence: fr.evidence,
            suggestion: '关注固定成本增速，避免成本结构进一步僵化。',
            detectedAt: checkedAt,
          });
        }
      } else {
        log.warn({ teamId, warnings: fr.warnings }, '固定成本占比降级 — 跳过该指标');
      }

      // 3. 人均成本（Person 节点计数上移本层; 总成本 = COGS + operating_expense）
      const personNodes = store.queryNodes('Person', { teamId })
        .filter(n => n.type === 'Person' || n.type === 'person');
      if (personNodes.length === 0) {
        log.warn({ teamId }, '无 Person 节点 — 人均成本降级，跳过该指标');
      } else {
        const totalCost = financials.reduce(
          (s, f) => s + (f.total_revenue - f.gross_margin) + f.operating_expense, 0,
        );
        const cph = computeCostPerHead({ total_cost: totalCost, head_count: personNodes.length });
      if (!cph.degraded) metricsHolder.push({ metricId: 'MARGIN-HEALTH-COST-PER-HEAD', value: Number(cph.value) || 0, unit: 'ratio', sourceId: 'sentinel-margin-health', inputDigest });
        if (!cph.degraded) {
          const t = th('cost_per_head');
          if (cph.value >= t.critical) {
            findings.push({
              id: 'cost_per_head_critical',
              severity: 'critical',
              title: '人均成本过高',
              description: `人均成本 ${cph.value.toFixed(0)}，超出 critical 阈值 ${t.critical}。`,
              evidence: cph.evidence,
              suggestion: '审查人员结构和成本效率。',
              detectedAt: checkedAt,
            });
          } else if (cph.value >= t.warning) {
            findings.push({
              id: 'cost_per_head_warning',
              severity: 'warning',
              title: '人均成本偏高',
              description: `人均成本 ${cph.value.toFixed(0)}，超出 warning 阈值 ${t.warning}。`,
              evidence: cph.evidence,
              suggestion: '关注人效指标，评估人力成本增速是否可持续。',
              detectedAt: checkedAt,
            });
          }
        }
      }

      // 4. 净利率（profit-health 源; D358 决策 6: 原假 critical 加 !degraded 门控）
      const pm = computeProfitMarginChange(financials);
      if (!pm.degraded) metricsHolder.push({ metricId: 'MARGIN-HEALTH-PROFIT-MARGIN-CHANGE', value: Number(pm.value) || 0, unit: 'ratio', sourceId: 'sentinel-margin-health', inputDigest });
      if (!pm.degraded) {
        const t = th('profit_margin_change');
        if (pm.value <= Math.abs(t.critical)) {
          findings.push({
            id: 'profit_low_critical',
            severity: 'critical',
            title: '利润率过低',
            description: `利润率 ${(pm.value * 100).toFixed(1)}%，低于 critical 阈值。`,
            evidence: pm.evidence,
            suggestion: '审查成本结构与定价策略，利润率过低威胁生存能力。',
            detectedAt: checkedAt,
          });
        }
      } else {
        log.warn({ teamId, warnings: pm.warnings }, '净利率计算降级 — 跳过该指标');
      }

      // 5. 利润率 vs 行业基准（D358 决策 6: degraded gap 恒 0 + 门控 !degraded 双保险）
      const mb = computeMarginVsBenchmark(financials, {});
      if (!mb.degraded) metricsHolder.push({ metricId: 'MARGIN-HEALTH-MARGIN-VS-BENCHMARK', value: Number(mb.profitMargin) || 0, unit: 'ratio', sourceId: 'sentinel-margin-health', inputDigest });
      if (!mb.degraded) {
        const t = th('margin_vs_benchmark');
        if (mb.gap <= t.critical) {
          findings.push({
            id: 'profit_bench_critical',
            severity: 'critical',
            title: '利润率严重低于行业基准',
            description: `利润率 ${(mb.profitMargin * 100).toFixed(1)}%，与行业基准差距 ${(Math.abs(mb.gap) * 100).toFixed(0)}pp，超出 critical 阈值。`,
            evidence: [`行业基准: ${(mb.benchmark * 100).toFixed(0)}%`],
            suggestion: '审查成本结构，寻找利润率改善机会。',
            detectedAt: checkedAt,
          });
        } else if (mb.gap <= t.warning) {
          findings.push({
            id: 'profit_bench_warning',
            severity: 'warning',
            title: '利润率低于行业基准',
            description: `利润率 ${(mb.profitMargin * 100).toFixed(1)}%，低于行业基准 ${(mb.benchmark * 100).toFixed(0)}%。`,
            evidence: [`行业基准: ${(mb.benchmark * 100).toFixed(0)}%`],
            suggestion: '对标同行盈利能力，识别利润率差距的来源。',
            detectedAt: checkedAt,
          });
        }
      } else {
        log.warn({ teamId, warnings: mb.warnings }, '基准对比降级 — 跳过该指标');
      }

      // 6+7. 边绑定（store-based 保持，读边 props; 无边 = 正常无数据 → 跳过）
      const [ib, mbd] = await Promise.all([
        computeIncentiveBindGap(store, { teamId, traversal }),
        computeMetricBindDivergence(store, { teamId, traversal }),
      ]);
      // D577 B1: ib/mbd 接入既有 th() 机制（this.manifest 通道，D356 交付不动）；阈值 = 现硬编码值回填 manifest
      if (!ib.degraded && ib.value > th('incentive_bind').warning) {
        findings.push({
          id: 'cost_incentive_gap', severity: 'warning',
          title: '激励行为差距大',
          description: `KPI-行为差距 ${(ib.value * 100).toFixed(0)}% > 40%，激励可能扭曲成本行为。`,
          evidence: ib.evidence,
          suggestion: '审查KPI与成本行为的对齐度。',
          detectedAt: checkedAt,
        });
      } else if (ib.degraded) {
        log.warn({ teamId, warnings: ib.warnings }, '激励绑定降级 — 跳过该指标');
      }
      if (!mbd.degraded && mbd.value > th('metric_bind_divergence').critical) {
        findings.push({
          id: 'profit_metric_divergence', severity: 'critical',
          title: 'KPI与现金流严重偏离',
          description: `KPI-现金流偏离度 ${(mbd.value * 100).toFixed(0)}% > 50%，指标体系可能失真。`,
          evidence: mbd.evidence,
          suggestion: '审查KPI体系的cash alignment，减少CustomAdj指标。',
          detectedAt: checkedAt,
        });
      } else if (!mbd.degraded && mbd.value > th('metric_bind_divergence').warning) {
        findings.push({
          id: 'profit_metric_divergence_warn', severity: 'warning',
          title: 'KPI与现金流偏离偏高',
          description: `KPI-现金流偏离度 ${(mbd.value * 100).toFixed(0)}% > 30%，建议关注。`,
          evidence: mbd.evidence,
          suggestion: '审查KPI口径，减少与现金流的偏离。',
          detectedAt: checkedAt,
        });
      } else if (mbd.degraded) {
        log.warn({ teamId, warnings: mbd.warnings }, '度量绑定降级 — 跳过该指标');
      }

      if (findings.length > 0) {
        log.info({ teamId, count: findings.length }, '利润健康检查完成');
      }
      // #1375 B3b：标识符形态返回也须带 metrics（否则 loader 读不到 ⇒ 0 行）
      return { findings: findings, metrics: metricsHolder };
    } catch (err: unknown) {
      log.error({ err, teamId }, '[margin-health] check失败');
      return { findings: [{
        id: `mh-error`, severity: 'warning' as const,
        title: '利润健康检测异常',
        description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查 Financial 数据源。',
        detectedAt: checkedAt,
      }], metrics: metricsHolder };
    }
  },
};
