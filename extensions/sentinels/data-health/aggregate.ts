/**
 * data-health/aggregate.ts — T3 数据健康度哨兵
 *
 * 综合 computeDataReadiness + computeDataSiloScore 结果，
 * 按阈值判定输出 SentinelFinding[]。
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 */
import type { SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeDataReadiness } from './computes/data-readiness-score';
import { computeDataSiloScore } from './computes/data-silo-score';
import type { DataFlowEdge } from './computes/data-silo-score';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/data-health');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  data_readiness: { warning: 0.6, critical: 0.3 },
  silo_rate: { warning: 0.3, critical: 0.5 },
} as const;

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const dataHealthSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[]> {
    const now = new Date();
    const checkedAt = now.toISOString();
    const findings: SentinelFinding[] = [];

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'data-health', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'data-health', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };

    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B2）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-data-health', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-data-health', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      // 1. 读取多种合法实体类型（数据就绪度：从 Tool/Process/Document 综合评估）
      const allToolNodes = store.queryNodes('Tool', { teamId });
      const allProcessNodes = store.queryNodes('Process', { teamId });
      const allDocNodes = store.queryNodes('Document', { teamId });
      const allNodes = [...allToolNodes, ...allProcessNodes, ...allDocNodes];
      const readiness = computeDataReadiness(allNodes);
      log.debug({ readiness: readiness.readiness, total: readiness.totalNodes }, '数据就绪度计算完成');

      if (!readiness.degraded && readiness.totalNodes > 0) {
        const rdPct = (readiness.readiness * 100).toFixed(0);
        if (readiness.readiness < th('data_readiness').critical) {
          findings.push({
            id: `t3-readiness-crit`, severity: 'critical',
            title: `数据就绪度过低 (${rdPct}%)`,
            description: `${readiness.totalNodes} 个节点中 ${(readiness.missingFieldRate * 100).toFixed(0)}% 仅含基础字段。`,
            evidence: [`就绪度: ${rdPct}%`, `缺失字段率: ${(readiness.missingFieldRate * 100).toFixed(0)}%`],
            suggestion: '上传更丰富的企业文档（组织结构图、财务表、客户清单）。',
            detectedAt: checkedAt,
          });
        } else if (readiness.readiness < th('data_readiness').warning) {
          findings.push({
            id: `t3-readiness-warn`, severity: 'warning',
            title: `数据就绪度偏低 (${rdPct}%)`,
            description: `结构化数据占比 ${(readiness.structuredRate * 100).toFixed(0)}%。`,
            evidence: [`就绪度: ${rdPct}%`, `结构化率: ${(readiness.structuredRate * 100).toFixed(0)}%`],
            suggestion: '按维度上传结构化文档。',
            detectedAt: checkedAt,
          });
        }
        if (readiness.piiHitCount > 0) {
          findings.push({
            id: `t3-pii`, severity: 'warning',
            title: `检测到 ${readiness.piiHitCount} 个节点含潜在 PII`,
            description: '个人身份信息(手机/身份证/薪资)混入本体层，存在隐私合规风险。',
            evidence: [`PII 命中: ${readiness.piiHitCount}/${readiness.totalNodes}`],
            suggestion: '运行 PIIScrubber 清理敏感字段。',
            detectedAt: checkedAt,
          });
        }
      }

      // 2. 读取系统节点和数据流边（数据孤岛）：所有工具和流程视为系统
      const sysToolNodes = store.queryNodes('Tool', { teamId });
      const sysProcessNodes = store.queryNodes('Process', { teamId });
      const allSystems = [...sysToolNodes, ...sysProcessNodes].map(n => ({
        id: n.id,
        name: (n.props.name as string) || n.id,
      }));

      // 从 edges 获取数据流（需要从 store 读取 — 此处简化处理）
      const edges: DataFlowEdge[] = [];
      // 系统间数据流：期望 graph store 有 DATA_FLOW / INTEGRATES 边
      // 当前 GraphStoreReader 接口不支持 queryEdges，留空不阻断
      log.debug({ totalSystems: allSystems.length }, '数据孤岛计算完成');

      const siloResult = computeDataSiloScore(allSystems, edges);
      if (!siloResult.degraded && siloResult.totalSystems >= 2) {
        const srPct = (siloResult.siloRate * 100).toFixed(0);
        if (siloResult.siloRate > th('silo_rate').critical) {
          findings.push({
            id: `t3-silo-crit`, severity: 'critical',
            title: `数据孤岛严重 (${srPct}% 系统孤立)`,
            description: `${siloResult.siloCount}/${siloResult.totalSystems} 个系统无数据流通。`,
            evidence: [`孤岛率: ${srPct}%`, `连接密度: ${(siloResult.connectivityDensity * 100).toFixed(1)}%`],
            suggestion: '优先打通核心业务系统之间的数据流。',
            detectedAt: checkedAt,
          });
        } else if (siloResult.siloRate > th('silo_rate').warning) {
          findings.push({
            id: `t3-silo-warn`, severity: 'warning',
            title: `数据孤岛率偏高 (${srPct}%)`,
            description: `${siloResult.siloCount} 个系统处于孤立状态。`,
            evidence: [`孤岛率: ${srPct}%`, `连接密度: ${(siloResult.connectivityDensity * 100).toFixed(1)}%`],
            suggestion: '评估这些系统是否需要对接。',
            detectedAt: checkedAt,
          });
        }
      }

      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[data-health] check 失败');
      return [{
        id: `t3-error`, severity: 'warning',
        title: '数据健康度检测异常',
        description: `检测过程出错: ${(err as Error)?.message || String(err)}`,
        evidence: [],
        suggestion: '检查 SOG 图数据源是否可用。',
        detectedAt: checkedAt,
      }];
    }
  },
};
