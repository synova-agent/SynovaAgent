import { createHash } from 'node:crypto';
/**
 * capital-health/aggregate.ts — 资本健康哨兵(合并)
 *
 * D358 去灭绝: 原实现为壳桥接（动态 import 退役子哨兵 capital-efficiency +
 * capital-structure + capital-turnover，违反铁律 37 + 子哨兵读 camelCase
 * 致真数据喂不进——D356 仅做入口校验兜底，本任务真实化）。
 * 现为本哨兵自有归一化层: 读 erp-standard 契约 props（D455 后全 snake_case）
 * camel）→ 归一化为 typed records → 自家 computes/ 计算 → manifest 阈值判定。
 *
 * P1-3 双层降级:
 *  - 入口层: Financial 节点缺失 total_revenue/total_assets/total_debt/equity/
 *    operating_cashflow 任一 → ch-degraded warning finding，跳过全部指标
 *    （interest_expense 移出入口组 — 契约外扩展字段，缺失走指标层，防常驻误报）。
 *  - 指标层: 指标必填字段缺失 → log.warn + 跳过该指标，不发 finding。
 *    扩展字段（interest_expense/short_term_debt/long_term_debt/accounts_payable/
 *    tax_rate/wacc）缺失仅影响依赖它的指标（D358 决策 4）。
 * 显式 0 视为合法数据（hasValue 存在性判定，D356 语义保留）；分母 0 → compute 自降级
 * （决策 5: 堵 99/rev-1/0 假值路径）。
 */
import type { MetricRow, SentinelAggregateResult, SentinelFinding } from '../../../src/sentinel/types';
import type { GraphStoreReader, GraphTraversal } from '../../../src/l4/graph-traversal';
import type { SentinelManifest } from '../../../src/sentinel/sentinel-loader';
import { createLogger } from '@synova/logger';
import { computeRoicWaccSpread } from './computes/roic-wacc-spread';
import { computeCapitalTurnover } from './computes/capital-turnover';
import { computeWacc } from './computes/wacc';
import { computeDebtEquityRatio } from './computes/debt-equity-ratio';
import { computeInterestCoverage } from './computes/interest-coverage';
import { computeDebtStructure } from './computes/debt-structure';
import { computeAssetTurnover } from './computes/asset-turnover';
import { computeReceivableTurnover } from './computes/receivable-turnover';
import { computeCashConversionCycle } from './computes/cash-conversion-cycle';

const log = createLogger('sentinel/capital-health');

interface CapitalThreshold {
  warning: number;
  critical: number;
}

/** manifest 阈值直连单测无注入时的契约默认值（path-dependency 先例） */
const DEFAULT_THRESHOLDS: Record<string, CapitalThreshold> = {
  roic_wacc_spread: { warning: 0, critical: -0.05 },
  capital_turnover: { warning: 0.8, critical: 0.4 },
  debt_equity: { warning: 1.5, critical: 2.5 },
  interest_coverage: { warning: 3.0, critical: 1.5 },
  asset_turnover: { warning: 0.8, critical: 0.5 },
  receivable_turnover_days: { warning: 60, critical: 90 },
};

/** 入口必填字段组（D358 snake 化，对齐 erp-standard 契约） */
const REQUIRED_FIELD_GROUPS: Array<{ name: string; fields: string[] }> = [
  { name: 'total_revenue', fields: ['total_revenue'] },
  { name: 'total_assets', fields: ['total_assets'] },
  { name: 'total_debt', fields: ['total_debt'] },
  { name: 'equity', fields: ['equity'] },
  { name: 'operating_cashflow', fields: ['operating_cashflow'] },
];

/** 存在性判定: 显式 0 是合法数据，只有 undefined/null/'' 视为缺失 */
const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/** 归一化后的 Financial 记录（契约字段 + 扩展字段可选） */
interface NormalizedFinancial {
  total_revenue: number;
  gross_margin?: number;
  total_assets: number;
  current_assets?: number;
  total_debt: number;
  equity: number;
  operating_cashflow: number;
  operatingExpenses: number;
  interest_expense?: number;
  short_term_debt?: number;
  long_term_debt?: number;
  inventory?: number;
  receivables?: number;
  accounts_payable?: number;
  tax_rate?: number;
  wacc?: number;
}

export const capitalHealthSentinel = {
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
        // 无 Financial 节点 = 正常空态，非降级（K3 T2-b 空库基线）
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
          id: `ch-degraded`,
          severity: 'warning',
          title: '资本健康数据不完整',
          description: `Financial 节点缺失必填字段组: ${names}。已跳过资本健康检查，避免缺失字段被默认为 0 产生误报。`,
          evidence: [`缺失字段组: ${names}`],
          suggestion: '请补全财务数据字段后重试。',
          detectedAt: checkedAt,
        }], metrics: metricsHolder };
      }

      // 归一化: erp-standard 契约 props → typed records
      const financials: NormalizedFinancial[] = finNodes.map(n => ({
        total_revenue: Number(n.props.total_revenue) || 0,
        gross_margin: hasValue(n.props.gross_margin) ? Number(n.props.gross_margin) : undefined,
        total_assets: Number(n.props.total_assets) || 0,
        current_assets: hasValue(n.props.current_assets) ? Number(n.props.current_assets) : undefined,
        total_debt: Number(n.props.total_debt) || 0,
        equity: Number(n.props.equity) || 0,
        operating_cashflow: Number(n.props.operating_cashflow) || 0,
        operatingExpenses: Number(n.props.operating_expense) || 0,
        interest_expense: hasValue(n.props.interest_expense) ? Number(n.props.interest_expense) : undefined,
        short_term_debt: hasValue(n.props.short_term_debt) ? Number(n.props.short_term_debt) : undefined,
        long_term_debt: hasValue(n.props.long_term_debt) ? Number(n.props.long_term_debt) : undefined,
        inventory: hasValue(n.props.inventory) ? Number(n.props.inventory) : undefined,
        receivables: hasValue(n.props.receivables) ? Number(n.props.receivables) : undefined,
        accounts_payable: hasValue(n.props.accounts_payable) ? Number(n.props.accounts_payable) : undefined,
        tax_rate: hasValue(n.props.tax_rate) ? Number(n.props.tax_rate) : undefined,
        wacc: hasValue(n.props.wacc) ? Number(n.props.wacc) : undefined,
      }));

      // manifest 阈值: loader 注入优先，直连单测无注入 → 默认契约值
      const th = (key: string): CapitalThreshold =>
        this.manifest?.thresholds?.[key] ?? DEFAULT_THRESHOLDS[key];

      // 1. ROIC/WACC spread（capital-efficiency 源; COGS = total_revenue − gross_margin）
      if (financials.some(f => f.gross_margin === undefined)) {
        log.warn({ teamId }, 'gross_margin 缺失 — ROIC 需要 COGS（毛利润金额制），跳过 spread 指标');
      } else {
        const roicRecords = financials.map(f => ({
          total_revenue: f.total_revenue,
          cogs: f.total_revenue - (f.gross_margin as number),
          operatingExpenses: f.operatingExpenses,
          total_debt: f.total_debt,
          equity: f.equity,
          wacc_override: undefined as number | undefined,
        }));
        const waccProp = financials.find(f => f.wacc !== undefined)?.wacc;
        if (waccProp === undefined) {
          // 无 wacc 覆盖值 → CAPM 计算（原 capital-efficiency 流程）
          const waccResult = computeWacc(financials.map(f => ({
            equity: f.equity, total_debt: f.total_debt, tax_rate: f.tax_rate ?? 0.25,
          })));
          if (!waccResult.degraded) {
            for (const rec of roicRecords) rec.wacc_override = waccResult.wacc;
          } else {
            log.warn({ teamId, warnings: waccResult.warnings }, 'WACC 计算降级 — spread 使用默认 10%');
          }
        } else {
          for (const rec of roicRecords) rec.wacc_override = waccProp;
        }
        const spreadResult = computeRoicWaccSpread(roicRecords);
        if (!spreadResult.degraded) {
          const t = th('roic_wacc_spread');
          const spPct = (spreadResult.spread * 100).toFixed(1);
          const roicPct = (spreadResult.roic * 100).toFixed(1);
          const waccPct = (spreadResult.wacc * 100).toFixed(1);
          if (spreadResult.spread < t.critical) {
            findings.push({
              id: `f3-spread-crit`, severity: 'critical',
              title: `ROIC (${roicPct}%) 低于 WACC (${waccPct}%) — 价值毁灭`,
              description: `ROIC/WACC 差距 ${spPct} 个百分点。`,
              evidence: [`ROIC: ${roicPct}%`, `WACC: ${waccPct}%`, `差距: ${spPct}%`, ...spreadResult.warnings],
              suggestion: '立即停止需要外部融资的扩张，聚焦现金流。',
              detectedAt: checkedAt,
            });
          } else if (spreadResult.spread < t.warning) {
            findings.push({
              id: `f3-spread-warn`, severity: 'warning',
              title: `ROIC (${roicPct}%) 略低于 WACC (${waccPct}%)`,
              description: `资本配置效率不足，差距 ${Math.abs(spreadResult.spread * 100).toFixed(1)} 个百分点。`,
              evidence: [`ROIC: ${roicPct}%`, `WACC: ${waccPct}%`, ...spreadResult.warnings],
              suggestion: '评估资本配置效率。',
              detectedAt: checkedAt,
            });
          }
        } else {
          log.warn({ teamId, warnings: spreadResult.warnings }, 'ROIC/WACC spread 降级 — 跳过该指标');
        }
      }

      // 2. 资本周转率（入口字段全齐，必可计算; 分母 0 → compute 自降级）
      const ct = computeCapitalTurnover(financials.map(f => ({
        total_revenue: f.total_revenue, total_debt: f.total_debt, equity: f.equity,
      })));
      if (!ct.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-CAPITAL-TURNOVER', value: Number(ct.turnover) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
      if (!ct.degraded) {
        const t = th('capital_turnover');
        if (ct.turnover < t.critical) {
          findings.push({
            id: `f3-turnover-crit`, severity: 'critical',
            title: `资本周转率过低 (${ct.turnover.toFixed(2)})`,
            description: `每单位资本仅产生 ${ct.turnover.toFixed(2)} 倍营收。`,
            evidence: [`周转率: ${ct.turnover.toFixed(2)}`, `营收: ${ct.totalRevenue}`, `资本: ${ct.totalCapital}`],
            suggestion: '审查资产效率，处置低效资产。',
            detectedAt: checkedAt,
          });
        } else if (ct.turnover < t.warning) {
          findings.push({
            id: `f3-turnover-warn`, severity: 'warning',
            title: `资本周转率偏低 (${ct.turnover.toFixed(2)})`,
            description: '资本使用效率不足。',
            evidence: [`周转率: ${ct.turnover.toFixed(2)}`],
            suggestion: '优化资本配置。',
            detectedAt: checkedAt,
          });
        }
      } else {
        log.warn({ teamId }, '资本周转率降级 — 跳过该指标');
      }

      // 3. 负债权益比（long_term_debt 缺失 → 长期负债比分量按 0 计，D/E 主信号不受影响，原算法同）
      const de = computeDebtEquityRatio(financials.map(f => ({
        total_debt: f.total_debt, long_term_debt: f.long_term_debt ?? 0, equity: f.equity,
      })));
      if (!de.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-DEBT-EQUITY', value: Number(de.debtEquity) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
      if (!de.degraded) {
        const t = th('debt_equity');
        if (de.debtEquity > t.critical) {
          findings.push({
            id: `f2-de-crit`, severity: 'critical',
            title: `负债权益比过高 (${de.debtEquity.toFixed(1)})`,
            description: '负债/权益 > 2.5，财务杠杆过高。',
            evidence: [`D/E: ${de.debtEquity.toFixed(1)}`, `长期负债占比: ${(de.longTermDebtRatio * 100).toFixed(0)}%`],
            suggestion: '考虑降杠杆：偿还债务或增资。',
            detectedAt: checkedAt,
          });
        } else if (de.debtEquity > t.warning) {
          findings.push({
            id: `f2-de-warn`, severity: 'warning',
            title: `负债权益比偏高 (${de.debtEquity.toFixed(1)})`,
            description: 'D/E > 1.5，需关注。',
            evidence: [`D/E: ${de.debtEquity.toFixed(1)}`],
            suggestion: '评估债务偿还计划。',
            detectedAt: checkedAt,
          });
        }
      } else {
        log.warn({ teamId }, '负债权益比降级（equity=0 分母 guard）— 跳过该指标');
      }

      // 4. 利息覆盖倍数（interest_expense 契约外扩展字段 → 缺失仅跳过本指标）
      if (financials.some(f => f.interest_expense === undefined)) {
        log.warn({ teamId }, 'interest_expense 缺失（契约外扩展字段）— 跳过 ICR 指标（D358 决策 4）');
      } else {
        const ic = computeInterestCoverage(financials.map(f => ({
          operating_cashflow: f.operating_cashflow, interest_expense: f.interest_expense as number,
        })));
      if (!ic.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-INTEREST-COVERAGE', value: Number(ic.icr) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
        if (!ic.degraded) {
          const t = th('interest_coverage');
          if (ic.icr < t.critical) {
            findings.push({
              id: `f2-icr-crit`, severity: 'critical',
              title: `利息覆盖倍数过低 (${ic.icr.toFixed(1)}x)`,
              description: 'EBIT/利息 < 1.5，偿债能力不足。',
              evidence: [`ICR: ${ic.icr.toFixed(1)}x`, `EBIT: ${ic.ebit}`, `利息: ${ic.interestExpense}`],
              suggestion: '改善经营现金流或重组债务。',
              detectedAt: checkedAt,
            });
          } else if (ic.icr < t.warning) {
            findings.push({
              id: `f2-icr-warn`, severity: 'warning',
              title: `利息覆盖倍数偏低 (${ic.icr.toFixed(1)}x)`,
              description: 'EBIT/利息 < 3.0。',
              evidence: [`ICR: ${ic.icr.toFixed(1)}x`],
              suggestion: '监控盈利和利率变化。',
              detectedAt: checkedAt,
            });
          }
        } else {
          log.warn({ teamId }, '利息覆盖倍数降级（interest=0 分母 guard）— 跳过该指标');
        }
      }

      // 5. 短债比（short_term_debt 契约外扩展字段 → 缺失仅跳过本指标; 多节点取均值，原算法同）
      if (financials.some(f => f.short_term_debt === undefined)) {
        log.warn({ teamId }, 'short_term_debt 缺失（契约外扩展字段）— 跳过债务期限结构指标（D358 决策 4）');
      } else {
        const shortTermDebt = financials.reduce((s, f) => s + (f.short_term_debt as number), 0) / financials.length;
        const totalDebtAvg = financials.reduce((s, f) => s + f.total_debt, 0) / financials.length;
        const ds = computeDebtStructure({ short_term_debt: shortTermDebt, total_debt: totalDebtAvg });
      if (!ds.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-DEBT-STRUCTURE', value: Number(ds.shortTermRatio) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
        if (!ds.degraded) {
          if (ds.signal === 'critical') {
            findings.push({
              id: `f2-ds-crit`, severity: 'critical',
              title: `短债占比过高 (${(ds.shortTermRatio * 100).toFixed(0)}%)`,
              description: `短期债务占总债务 ${(ds.shortTermRatio * 100).toFixed(0)}%，超过 70% 警戒线。`,
              evidence: [`短债比: ${(ds.shortTermRatio * 100).toFixed(0)}%`],
              suggestion: '延长债务期限，用长期融资置换短期借款。',
              detectedAt: checkedAt,
            });
          } else if (ds.signal === 'warning') {
            findings.push({
              id: `f2-ds-warn`, severity: 'warning',
              title: `短债占比偏高 (${(ds.shortTermRatio * 100).toFixed(0)}%)`,
              description: `短期债务占比 ${(ds.shortTermRatio * 100).toFixed(0)}%，超过 50%。`,
              evidence: [`短债比: ${(ds.shortTermRatio * 100).toFixed(0)}%`],
              suggestion: '优化债务期限结构。',
              detectedAt: checkedAt,
            });
          }
        } else {
          log.warn({ teamId }, '债务期限结构降级 — 跳过该指标');
        }
      }

      // 6. 资产周转率（current_assets 契约字段缺失 → 仅跳过本指标）
      if (financials.some(f => f.current_assets === undefined)) {
        log.warn({ teamId }, 'current_assets 缺失 — 跳过资产周转率指标');
      } else {
        const at = computeAssetTurnover(financials.map(f => ({
          total_revenue: f.total_revenue, total_assets: f.total_assets, current_assets: f.current_assets as number,
        })));
      if (!at.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-ASSET-TURNOVER', value: Number(at.totalTurnover) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
        if (!at.degraded) {
          const t = th('asset_turnover');
          if (at.totalTurnover < t.critical) {
            findings.push({
              id: `f5-at-crit`, severity: 'critical',
              title: `总资产周转率过低 (${at.totalTurnover.toFixed(2)})`,
              description: '每单位资产营收不足 0.5。',
              evidence: [`周转率: ${at.totalTurnover.toFixed(2)}`, `营收: ${at.totalRevenue}`, `总资产: ${at.totalAssets}`],
              suggestion: '审查资产效率，处置低效资产。',
              detectedAt: checkedAt,
            });
          } else if (at.totalTurnover < t.warning) {
            findings.push({
              id: `f5-at-warn`, severity: 'warning',
              title: `总资产周转率偏低 (${at.totalTurnover.toFixed(2)})`,
              description: '周转率 < 0.8。',
              evidence: [`周转率: ${at.totalTurnover.toFixed(2)}`],
              suggestion: '优化资产配置。',
              detectedAt: checkedAt,
            });
          }
        } else {
          log.warn({ teamId }, '资产周转率降级（分母 0 guard）— 跳过该指标');
        }
      }

      // 7. 应收周转（receivables 契约字段缺失 → 仅跳过本指标）
      if (financials.some(f => f.receivables === undefined)) {
        log.warn({ teamId }, 'receivables 缺失 — 跳过应收周转指标');
      } else {
        const rt = computeReceivableTurnover(financials.map(f => ({
          total_revenue: f.total_revenue, receivables: f.receivables as number,
        })));
      if (!rt.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-RECEIVABLE-TURNOVER', value: Number(rt.turnoverRatio) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
        if (!rt.degraded) {
          const t = th('receivable_turnover_days');
          if (rt.daysOutstanding > t.critical) {
            findings.push({
              id: `f5-rt-crit`, severity: 'critical',
              title: `应收周转天数过长 (${rt.daysOutstanding}d)`,
              description: '应收 > 90 天。',
              evidence: [`周转天数: ${rt.daysOutstanding}d`, `应收: ${rt.avgReceivables}`, `年营收: ${rt.totalRevenue}`],
              suggestion: '收紧信用政策，加速应收回收。',
              detectedAt: checkedAt,
            });
          } else if (rt.daysOutstanding > t.warning) {
            findings.push({
              id: `f5-rt-warn`, severity: 'warning',
              title: `应收周转天数偏长 (${rt.daysOutstanding}d)`,
              description: '应收 > 60 天。',
              evidence: [`周转天数: ${rt.daysOutstanding}d`],
              suggestion: '关注应收回收情况。',
              detectedAt: checkedAt,
            });
          }
        } else {
          log.warn({ teamId }, '应收周转降级（分母 0 guard）— 跳过该指标');
        }
      }

      // 8. 现金转换周期 CCC（D358 决策 3 新接线: 原 capital-turnover import 本 compute 却
      //    从不调用 = 死代码（铁律 37），本层接线消除。需 inventory（契约）+ accounts_payable
      //    （扩展）→ 缺失仅跳过本指标。阈值在 compute 内部: >120 critical / >90 warning）
      if (financials.some(f => f.gross_margin === undefined || f.inventory === undefined
        || f.receivables === undefined || f.accounts_payable === undefined)) {
        log.warn({ teamId }, 'CCC 需要 gross_margin/inventory/receivables/accounts_payable — 跳过（D358 决策 4）');
      } else {
        const ccc = computeCashConversionCycle({
          cogs: financials.reduce((s, f) => s + (f.total_revenue - (f.gross_margin as number)), 0),
          inventory: financials.reduce((s, f) => s + (f.inventory as number), 0),
          receivables: financials.reduce((s, f) => s + (f.receivables as number), 0),
          accounts_payable: financials.reduce((s, f) => s + (f.accounts_payable as number), 0),
          total_revenue: financials.reduce((s, f) => s + f.total_revenue, 0),
        });
      if (!ccc.degraded) metricsHolder.push({ metricId: 'CAPITAL-HEALTH-CASH-CONVERSION-CYCLE', value: Number(ccc.cccDays) || 0, unit: 'ratio', sourceId: 'sentinel-capital-health', inputDigest });
        if (!ccc.degraded) {
          if (ccc.signal === 'critical') {
            findings.push({
              id: `f5-ccc-crit`, severity: 'critical',
              title: `现金转换周期过长 (${ccc.cccDays}天)`,
              description: `CCC ${ccc.cccDays} 天，超过 120 天警戒线（制造/零售基线）。`,
              evidence: [`CCC: ${ccc.cccDays}天`, `DIO: ${ccc.dio}天`, `DSO: ${ccc.dso}天`, `DPO: ${ccc.dpo}天`, ...ccc.warnings],
              suggestion: '优化营运资金：降低库存、加速应收、合理利用应付。',
              detectedAt: checkedAt,
            });
          } else if (ccc.signal === 'warning') {
            findings.push({
              id: `f5-ccc-warn`, severity: 'warning',
              title: `现金转换周期偏长 (${ccc.cccDays}天)`,
              description: `CCC ${ccc.cccDays} 天，超过 90 天预警线。`,
              evidence: [`CCC: ${ccc.cccDays}天`, `DIO: ${ccc.dio}天`, `DSO: ${ccc.dso}天`, `DPO: ${ccc.dpo}天`],
              suggestion: '关注营运资金效率。',
              detectedAt: checkedAt,
            });
          }
        } else {
          log.warn({ teamId, warnings: ccc.warnings }, 'CCC 降级 — 跳过该指标');
        }
      }

      log.debug({ totalFindings: findings.length }, '资本健康检查完成');
      // #1375 B3b：标识符形态返回也须带 metrics（否则 loader 读不到 ⇒ 0 行）
      return { findings: findings, metrics: metricsHolder };
    } catch (err: unknown) {
      log.error({ err }, '[capital-health] check 失败');
      return { findings: [{
        id: `ch-error`, severity: 'warning' as const,
        title: '资本健康检测异常',
        description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查 Financial 数据源。',
        detectedAt: checkedAt,
      }], metrics: metricsHolder };
    }
  },
};
