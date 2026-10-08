/**
 * sentinel/adapters/cash-flow-sentinel.ts — 现金流哨兵 (D1)
 * @state: real — V4.2.4: 内联 computeCashFlowMetrics 替代已删除桥接
 *
 * 数据源: SOG FINANCIAL 节点 + diagnosis_snapshots。
  // V4.2.4: financial-snapshot 桥接已删除，内联实现
 */

import type { Sentinel, SentinelCheckResult, SentinelConfig, SentinelContext, SentinelFinding } from '../types';
  // V4.2.4: financial-snapshot 桥接已删除
import { discoverTeams } from './helpers';
import { createLogger } from '@synova/logger';
import { readByMappedTypeFromRawDb } from '../mapped-read';
import { resolveOntologyTarget } from '../node-type-resolver';
import { writeMetricReadings } from '../metric-readings-writer';

const log = createLogger('sentinel/cashflow');

const config: SentinelConfig = {
  id: 'sentinel-cash-flow', name: '现金流', description: '现金流预测/跑道/应收逾期。数据源: SOG FINANCIAL 节点 + diagnosis_snapshots。', category: 'risk', priority: 'P0', mode: 'cron', cron: '0 9 * * *', requiredDataSources: ['sog_graph'], confidenceModel: 'statistical', version: '2.0.0',
};

/** 内联现金流指标计算 (V4.2.4: 替代已删除的 financial-snapshot 桥接) */
function computeCashFlowMetrics(
  entries: Array<{ revenue: number; cost: number; operating_expense: number; cashBalance: number; period: string }>
): { cashFlowHealth: 'critical' | 'tight' | 'healthy'; netMargin: number; revenueYoYGrowth: number | null; grossMargin: number } {
  const totalRevenue = entries.reduce((s, e) => s + (e.revenue || 0), 0);
  const totalCost = entries.reduce((s, e) => s + (e.cost || 0), 0);
  const totalOpEx = entries.reduce((s, e) => s + (e.operating_expense || 0), 0);
  const totalCash = entries.reduce((s, e) => s + (e.cashBalance || 0), 0);
  const count = entries.length;

  const netMargin = totalRevenue > 0 ? (totalRevenue - totalCost - totalOpEx) / totalRevenue : 0;
  const grossMargin = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0;

  // Year-over-year: compare first vs last period revenue
  let revenueYoYGrowth: number | null = null;
  if (entries.length >= 2) {
    const sorted = [...entries].sort((a, b) => (a.period || '').localeCompare(b.period || ''));
    const first = sorted[0].revenue || 0;
    const last = sorted[sorted.length - 1].revenue || 0;
    revenueYoYGrowth = first > 0 ? (last - first) / first : 0;
  }

  // 现金流健康度：基于跑道月数和净利率
  const monthlyBurn = count > 0 ? (totalOpEx + totalCost) / count : 0;
  const runwayMonths = monthlyBurn > 0 ? totalCash / monthlyBurn : (totalCash > 0 ? Infinity : 0);
  let cashFlowHealth: 'critical' | 'tight' | 'healthy';
  if (runwayMonths < 3 || netMargin < -0.2) {
    cashFlowHealth = 'critical';
  } else if (runwayMonths < 12 || netMargin < 0) {
    cashFlowHealth = 'tight';
  } else {
    cashFlowHealth = 'healthy';
  }

  return { cashFlowHealth, netMargin, revenueYoYGrowth, grossMargin };
}

export const cashFlowSentinel: Sentinel = {
  config,
  async check(context: SentinelContext): Promise<SentinelCheckResult> {
    const { now } = context; const checkedAt = now.toISOString(); const startTime = Date.now();
    try {
      // #1376: **显式取用** raw 能力（`context.rawDb`）；缺席 ⇒ 显式降级（warn + degraded），不静默
      const rawDb = context.rawDb ?? null;
      if (!rawDb) {
        log.warn({ sentinelId: config.id }, 'rawDb 能力缺席（该路径无 raw 句柄）⇒ 降级：跳过财务条目读取');
      }
      const db = rawDb as { prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>> } } | null;
      if (!db) return { sentinelId: config.id, ok: true, findings: [], durationMs: Date.now() - startTime, checkedAt, degraded: true };

      // 从 SOG FINANCIAL 节点提取财务条目
      let rawEntries: Array<Record<string, unknown>> = [];
      try {
        // #1381 V2a（B1）：**经显式映射读**（并集读逻辑单点：mapped-read）
        const mapped = readByMappedTypeFromRawDb(db, 'FINANCIAL');
        rawEntries = mapped.rows as Array<Record<string, unknown>>;
        if (mapped.legacyFallback) {
          log.warn({ sentinelId: config.id, usedTypes: mapped.usedTypes, degraded: true, reason: 'no-mapping' },
            '无映射 ⇒ 回退遗留字面量（显式）');
        }
        // 归类（本体轴语义）：首行 props 判定该批数据落在哪个本体类型（用于观测，不静默）
        const firstProps = rawEntries.length > 0
          ? (() => { const p0 = rawEntries[0].props; return typeof p0 === 'string' ? JSON.parse(p0) as Record<string, unknown> : (p0 as Record<string, unknown>) ?? {}; })()
          : {};
        const classified = resolveOntologyTarget('FINANCIAL', firstProps);
        log.debug({ sentinelId: config.id, usedTypes: mapped.usedTypes, classified: classified.target, warn: classified.warn }, '映射读归类');
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "从 SOG FINANCIAL 节点提取财务条目");
        /* DB 不可用 — 降级 */
      }

      if (rawEntries.length === 0) {
        // #1379 V3：**能力在、数据读不到** ⇒ 显式 warn（不静默）
        log.warn({ sentinelId: config.id, degraded: true, reason: 'empty-read', type: 'FINANCIAL' },
          '读路径可用但 0 行 ⇒ 降级（静默空读会伪装成"无异常"；FNANCIAL 目前【无写入者】，见 #1381）');
        return { sentinelId: config.id, ok: true, findings: [], durationMs: Date.now() - startTime, checkedAt, degraded: true };
      }

      // 映射 SOG props → 内部财务条目
      const entries: Array<{
        period: string; startDate: string; endDate: string;
        revenue: number; cost: number; operating_expense: number;
        cashBalance: number; headcount: number; operatingCashFlow: number | undefined;
      }> = [];
      for (const r of rawEntries) {
        const p = typeof r.props === 'string' ? JSON.parse(r.props as string) : (r.props || {}) as Record<string, unknown>;
        entries.push({
          period: (p.period || p.月份 || now.toISOString().slice(0, 7)) as string,
          startDate: (p.start_date || p.开始日期 || '') as string,
          endDate: (p.end_date || p.结束日期 || '') as string,
          // #1384 V2b（消费侧）：**优先读本体 schema 字段名**（连接器按本体写）⇒ 旧名回退（显式，不静默）
          revenue: Number(p.total_revenue) || Number(p.revenue) || Number(p.收入) || 0,
          cost: Number(p.total_cost) || Number(p.cost) || Number(p.costs) || Number(p.成本) || 0,
          operating_expense: Number(p.operating_expenses) || Number(p.运营支出) || 0,
          cashBalance: Number(p.cash_balance) || Number(p.cash) || Number(p.现金) || 0,
          headcount: Number(p.headcount) || Number(p.人数) || 1,
          operatingCashFlow: Number(p.operating_cash_flow) || Number(p.cashflow) || Number(p.经营现金流) || undefined,
        });
      }
      if (entries.length === 0) {
        return { sentinelId: config.id, ok: true, findings: [], durationMs: Date.now() - startTime, checkedAt, degraded: true };
      }

      // 内联现金流计算 (V4.2.4: financial-snapshot 桥接已删除)
      const snapshot = computeCashFlowMetrics(entries);

      // 计算跑道
      const totalCash = entries.reduce((s, e) => s + (e.cashBalance || 0), 0);
      const monthlyBurn = entries.reduce((s, e) => s + (e.operating_expense || 0), 0) / Math.max(entries.length, 1);
      const runwayMonths = monthlyBurn > 0 ? totalCash / monthlyBurn : (totalCash > 0 ? Infinity : 0);

      // 生成 findings
      const allFindings: SentinelFinding[] = [];
      const { cashFlowHealth, netMargin, revenueYoYGrowth, grossMargin } = snapshot;

      // 🔴 #1054（2-1b）写点①·**指标级**（样板哨兵）：把"这次判定用的输入取值"落 metric_readings。
      //   metric_id = compute 的真实指标名；value = 本次 compute 取值（这正是 archive/25 §三 写点①的语义）。
      //   覆盖面：**仅本样板哨兵**；其余 44 哨兵暂只有轮次级（见 metric-readings-writer.ts 头注）。
      writeMetricReadings(
        context.metricSink,
        {
          orgId: context.teamId ?? 'default',
          observedAt: checkedAt,
          entityId: '*',
          sourceId: 'SENTINEL-CASH-FLOW-v1',
          evidenceRef: 'sentinel:cash-flow',
        },
        // ⚠️ compute 可能返回 null（数据不足）⇒ **不写**（不把"算不出"记成 0，避免假测量值）
        [
          { metricId: 'CASH-FLOW-NET-MARGIN', value: netMargin, unit: 'ratio' },
          { metricId: 'CASH-FLOW-REVENUE-YOY-GROWTH', value: revenueYoYGrowth, unit: 'ratio' },
          { metricId: 'CASH-FLOW-GROSS-MARGIN', value: grossMargin, unit: 'ratio' },
          { metricId: 'CASH-FLOW-RUNWAY-MONTHS', value: Number.isFinite(runwayMonths) ? runwayMonths : null, unit: 'months' },
        ].filter((r): r is { metricId: string; value: number; unit: string } => typeof r.value === 'number'),
      );

      const runwayDisplay = Number.isFinite(runwayMonths) ? `${runwayMonths.toFixed(1)} 个月` : '充足';

      if (cashFlowHealth === 'critical') {
        allFindings.push({
          id: `cf-critical-${now.getTime()}`, severity: 'critical',
          title: `现金流危急 — 跑道 ${runwayDisplay}`,
          description: `经营现金流/现金余额不足以覆盖运营支出。净利率 ${(netMargin * 100).toFixed(1)}%，毛利率 ${(grossMargin * 100).toFixed(1)}%。`,
          evidence: [`跑道: ${runwayDisplay}`, `净利率: ${(netMargin * 100).toFixed(1)}%`, `毛利率: ${(grossMargin * 100).toFixed(1)}%`],
          suggestion: '启动应急融资，削减非必要支出，加速应收回收。', detectedAt: checkedAt,
        });
      } else if (cashFlowHealth === 'tight') {
        allFindings.push({
          id: `cf-tight-${now.getTime()}`, severity: 'warning',
          title: `现金流偏紧 — 跑道 ${runwayDisplay}`,
          description: `现金流尚可维持但余量不足。${revenueYoYGrowth !== null && revenueYoYGrowth < 0 ? `营收同比下降 ${(Math.abs(revenueYoYGrowth) * 100).toFixed(0)}%。` : ''}`,
          evidence: [`跑道: ${runwayDisplay}`, `净利率: ${(netMargin * 100).toFixed(1)}%`],
          suggestion: '准备融资材料，评估节流方案。', detectedAt: checkedAt,
        });
      }

      // 应收账款逾期检查 (AR 不在财务条目中，从原始 SOG 数据提取)
      const totalAR = rawEntries.reduce((s, r) => {
        const p = typeof r.props === 'string' ? JSON.parse(r.props as string) : (r.props || {}) as Record<string, unknown>;
        return s + (Number(p.accounts_receivable) || Number(p.receivable) || Number(p.应收账款) || 0);
      }, 0);
      if (totalAR > 0 && totalCash > 0 && totalAR / totalCash > 0.3) {
        allFindings.push({
          id: `cf-overdue-${now.getTime()}`, severity: 'warning',
          title: `应收账款占比过高 (${((totalAR / totalCash) * 100).toFixed(0)}%)`,
          description: `应收占总现金 ${((totalAR / totalCash) * 100).toFixed(0)}%，回收压力大。`,
          evidence: [`应收: ${totalAR}`, `现金: ${totalCash}`],
          suggestion: '加强催收流程，评估客户信用。', detectedAt: checkedAt,
        });
      }

      if (allFindings.length === 0 && cashFlowHealth === 'healthy') {
        allFindings.push({
          id: `cf-healthy-${now.getTime()}`, severity: 'info',
          title: '现金流健康',
          description: `跑道 ${runwayDisplay}，净利率 ${(netMargin * 100).toFixed(1)}%。`,
          evidence: [`跑道: ${runwayDisplay}`, `净利率: ${(netMargin * 100).toFixed(1)}%`],
          suggestion: '维持现状，持续监控。', detectedAt: checkedAt,
        });
      }

      return { sentinelId: config.id, ok: true, findings: allFindings, durationMs: Date.now() - startTime, checkedAt, degraded: false };
    } catch (err: unknown) {
      log.error({ err }, '[cashflow] check 失败');
      return { sentinelId: config.id, ok: false, findings: [], durationMs: Date.now() - startTime, checkedAt, error: (err as Error)?.message || String(err), degraded: true };
    }
  },
};
