/**
 * resource-misallocation/aggregate.ts — S3 资源错配哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与改造前硬编码现值一致，蓝绿基准）。
 */
import type { SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeResourceMisallocation } from './computes/compute-resource-misallocation';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/resource-misallocation');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  score: { warning: 0.2, critical: 0.5 },
} as const;

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const resourceMisallocationSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[]> {
    const now = new Date();
    const checkedAt = now.toISOString();

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'resource-misallocation', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'resource-misallocation', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };

    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B4 收尾）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1/B2/B3 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-resource-misallocation', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-resource-misallocation', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const eventNodes = store.queryNodes('Event', { teamId });
      const personNodes = store.queryNodes('Person', { teamId });
      const finNodes = store.queryNodes('Financial', { teamId });

      // 战略目标从 Event 节点中筛选（eventType 包含 goal/objective/strategic）
      const goals = eventNodes
        .filter(n => { const t = (n.props.eventType as string || '').toLowerCase(); return t.includes('goal') || t.includes('objective') || t.includes('strategic'); })
        .map(n => ({
          name: (n.props.name as string) || n.id,
          priority: n.props.priority !== undefined ? Number(n.props.priority) : 3,
          area: (n.props.area as string) || (n.props.category as string) || '',
        }));

      const resources = [
        ...personNodes.map(n => ({
          goalArea: (n.props.dept as string) || (n.props.area as string) || 'general',
          headcount: 1,
          budget: 0,
        })),
        ...finNodes.map(n => ({
          goalArea: (n.props.category as string) || 'finance',
          headcount: 0,
          budget: Number(n.props.amount) || Number(n.props.revenue) || 0,
        })),
      ];

      const result = computeResourceMisallocation(goals, resources);
      if (result.degraded) { log.warn({ teamId }, 'compute degraded — data incomplete'); return []; }
      log.debug({ index: result.index }, '资源错配计算完成');

      if (result.index > th('score').critical) {
        return [{
          id: `s3-crit`, severity: 'critical',
          title: `资源错配严重 (${(result.index * 100).toFixed(0)}%)`,
          description: `${result.underfundedGoals.length} 个高优目标缺资源，${result.overstaffedAreas.length} 个领域可能资源过剩。`,
          evidence: [`错配指数: ${(result.index * 100).toFixed(0)}%`, `缺资源目标: ${result.underfundedGoals.join(', ') || '无'}`, `可能过剩: ${result.overstaffedAreas.join(', ') || '无'}`],
          suggestion: '重新评估资源分配与战略优先级的一致性。',
          detectedAt: checkedAt,
        }];
      }

      if (result.index > th('score').warning) {
        return [{
          id: `s3-warn`, severity: 'warning',
          title: `资源错配 (${(result.index * 100).toFixed(0)}%)`,
          description: '部分资源分配与战略目标不匹配。',
          evidence: [`错配指数: ${(result.index * 100).toFixed(0)}%`, ...result.underfundedGoals.map(g => `${g}: 缺资源`)],
          suggestion: '审查资源分配，确保高优目标有足够支持。',
          detectedAt: checkedAt,
        }];
      }

      return [];
    } catch (err: unknown) {
      log.error({ err }, '[resource-misallocation] check 失败');
      return [{
        id: `s3-error`, severity: 'warning',
        title: '资源错配检测异常', description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt,
      }];
    }
  },
};
