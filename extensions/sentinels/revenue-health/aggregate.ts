/** revenue-health aggregate — 收入健康哨兵。综合N个指标→1条Finding。V4.4.2 */
import type { SentinelManifest } from '../../../src/sentinel/sentinel-loader';
import type { SentinelFinding } from '../../../src/sentinel/types';
import type { GraphStoreReader, GraphTraversal } from '../../../src/l4/graph-traversal';
import { createLogger } from '@synova/logger';
import { computeRevenueGrowth } from './computes/compute-revenue-growth';
import { computeSalesFourTotals } from './computes/compute-sales-four-totals';

const log = createLogger('sentinel/revenue-health');

export const revenueHealthSentinel = {
  manifest: null as SentinelManifest | null,
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const findings: SentinelFinding[] = [];
    let revenueNodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
    let clientNodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
    let usedTraversal = false;
    let totalRevenue = 0;

    try {
      // 图遍历或旧路径获取节点
      try {
        if (traversal) {
          // @deprecated — 语义迁移由D15处理
          const finR = traversal.traverse([teamId], ['FUNDS', 'OPERATIONAL_EXECUTION']);
          // @deprecated — 语义迁移由D15处理
          const clientR = traversal.traverse([teamId], ['DEPLOYS']);
          if (finR.nodes[0] || clientR.nodes[0]) {
            revenueNodes = finR.nodes.filter(n => n.props.financialType === 'revenue' || n.props.total_revenue);
            clientNodes = clientR.nodes.filter(n => n.type === 'CLIENT');
            usedTraversal = true;
          }
        }
      } catch (err: unknown) { log.warn({ err, teamId }, '图遍历失败 — 降级到旧路径'); }

      if (!usedTraversal) {
        const nodes = store.queryNodes('Financial', { teamId });
        // D803 切片②（10-2 读侧契约）: 原为 `n.props.financialType === 'revenue'`——值域硬编码断裂。
        // ingest 写入的 financialType = mapping.name = 'erp-standard'（data-ingest-service.ts:164），
        // 上传数据永远不等于 'revenue' → 过滤器恒空 → 「无收入数据」静默 return []（K3 断裂②同构）。
        // 修复方向 = 对齐其自有遍历分支（本文件 :28）的判定：financialType 标识 + total_revenue 兜底。
        // 用 `!= null` 而非真值判断——显式 0 是合法营收值，不应被判空。
        revenueNodes = nodes.filter(n => n.props.financialType === 'revenue' || n.props.total_revenue != null);
        clientNodes = store.queryNodes('Client', { teamId });
      }

      if (!revenueNodes[0]) { log.info({ teamId }, '无收入数据'); return []; }

      totalRevenue = revenueNodes.reduce((s, n) => s + (Number(n.props.amount) || Number(n.props.total_revenue) || 0), 0);
      const clientCount = clientNodes.length;
      const cr5 = clientCount > 0 ? Math.min(1, clientCount / 5) : 0;

      // 收入增长率 — 通过 compute 函数
      const growthResult = await computeRevenueGrowth(store, { teamId, traversal });

      // 销售四总数 — 仅以 ERP 应收字段识别销售行；普通营收节点不误入。
      const salesNodes = revenueNodes.filter(n => n.props.receivables != null);
      if (salesNodes.length > 0) {
        const salesResult = computeSalesFourTotals({
          rows: salesNodes.map(n => ({
            orderId: typeof n.props.standardKey === 'string' ? n.props.standardKey : '',
            orderAmount: Number(n.props.total_revenue),
            receivedAmount: Number(n.props.total_revenue) - Number(n.props.receivables),
          })),
          // 写侧暂无独立人工基线；显式降级，绝不从同批来源行伪造 matched=true。
          baseline: null,
        });
        if (salesResult.degraded || !salesResult.matched) {
          findings.push({
            id: salesResult.degraded ? 'rev_sales_totals_degraded' : 'rev_sales_totals_mismatch',
            severity: 'warning',
            title: salesResult.degraded ? '销售四总数无法完成对账' : '销售四总数与人工基线不一致',
            description: salesResult.degraded
              ? `销售四总数对账降级：${salesResult.warnings.join('；')}`
              : '四总数存在显式差额，不能解释为一致。',
            evidence: [
              `计算值: ${JSON.stringify(salesResult.totals)}`,
              `差额: ${JSON.stringify(salesResult.differences)}`,
              ...salesResult.warnings,
            ],
            suggestion: '请核对订单来源行、重复业务键与独立人工基线。',
            detectedAt: new Date().toISOString(),
          });
        }
      }

      if (this.manifest) {
        const t = this.manifest.thresholds;
        // 客户集中度
        if (cr5 >= t.customer_concentration.critical) {
          findings.push({ id: 'rev_conc_critical', severity: 'critical', title: '客户集中度过高', description: `CR5估算${(cr5 * 100).toFixed(0)}%，超出critical阈值。`, evidence: [`客户数: ${clientCount}`, `收入来源: ${revenueNodes.length}`], suggestion: '拓展客户基础，降低单客户依赖。', detectedAt: new Date().toISOString() });
        } else if (cr5 >= t.customer_concentration.warning) {
          findings.push({ id: 'rev_conc_warning', severity: 'warning', title: '客户集中度偏高', description: `CR5估算${(cr5 * 100).toFixed(0)}%，超出warning阈值。`, evidence: [`客户数: ${clientCount}`, `收入来源: ${revenueNodes.length}`], suggestion: '建立第二增长客户群，降低单客户收入占比。', detectedAt: new Date().toISOString() });
        }
        // 收入增长率 — P1-1 (K3 20260813): degraded 短路改发可见 warning finding。
        // 此前 !degraded 静默跳过 → 降级不可见 = 静默降级（铁律 31）复发，
        // 且 K3 P0-1 修复（manifest 挂载）激活本路径后该隐患会扩大。
        if (growthResult.degraded) {
          findings.push({ id: 'rev_growth_degraded', severity: 'warning', title: '收入数据不完整', description: `收入增长率计算降级：${growthResult.warnings.join('；')}`, evidence: growthResult.evidence, suggestion: '请确认收入数据是否完整。', detectedAt: new Date().toISOString() });
        } else if (growthResult.value <= t.revenue_growth.critical) {
          findings.push({ id: 'rev_growth_critical', severity: 'critical', title: '收入增长停滞', description: `收入增长率${(growthResult.value * 100).toFixed(1)}%，低于critical阈值。`, evidence: [`当期: ${growthResult.totalRevenue}`, `上期: ${growthResult.previousRevenue}`], suggestion: '审查市场策略，寻找新增长点。', detectedAt: new Date().toISOString() });
        } else if (growthResult.value <= t.revenue_growth.warning) {
          findings.push({ id: 'rev_growth_warning', severity: 'warning', title: '收入增长放缓', description: `收入增长率${(growthResult.value * 100).toFixed(1)}%，低于warning阈值。`, evidence: [`当期: ${growthResult.totalRevenue}`, `上期: ${growthResult.previousRevenue}`], suggestion: '复盘获客渠道与续约情况，锁定增长放缓的具体环节。', detectedAt: new Date().toISOString() });
        }
      }
      if (findings.length) log.info({ teamId, count: findings.length }, '收入健康检查完成');
    } catch (err: any) { log.warn({ err, teamId }, '收入健康检查失败'); }
    return findings;
  },
};
