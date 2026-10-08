import type { SentinelFinding } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeRoutineMutation } from './computes/compute-routine-mutation';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/routine-mutation');

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const routineMutationSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const now = new Date();
    const checkedAt = now.toISOString();

    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B4 收尾）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1/B2/B3 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-routine-mutation', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-routine-mutation', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const processNodes = store.queryNodes('Process', { teamId });
      const eventNodes = store.queryNodes('Event', { teamId });

      const routines = processNodes.map(n => ({
        id: n.id,
        updated: n.props.updated === true || n.props.lastUpdated !== undefined,
        hasChanges: n.props.changes !== undefined && Number(n.props.changes) > 0,
      }));

      const events = eventNodes.map(n => ({
        eventType: (n.props.eventType as string) || '',
      }));

      const result = computeRoutineMutation(routines, events);
      log.debug({ mutationRate: result.mutationRate, assessment: result.assessment }, '惯例变异率计算完成');

      if (result.degraded) {
        return [{
          id: `o2-nodata`, severity: 'info',
          title: '惯例数据不足', description: '未检测到 Process 节点。',
          evidence: [], suggestion: '添加工序/流程数据。', detectedAt: checkedAt,
        }];
      }

      const ratePct = (result.mutationRate * 100).toFixed(0);

      if (result.assessment === 'frozen') {
        return [{
          id: `o2-frozen`, severity: 'warning',
          title: `惯例僵化 — 变异率仅 ${ratePct}%`,
          description: `过去12个月内仅 ${result.mutatedRoutines}/${result.totalRoutines} 个惯例发生过变化。Nelson & Winter 认为过低变异率意味着组织丧失适应能力。`,
          evidence: [`变异率: ${ratePct}%`, `总惯例: ${result.totalRoutines}`, `变异数: ${result.mutatedRoutines}`],
          suggestion: '引入流程审查机制，定期评估和优化现有惯例。',
          detectedAt: checkedAt,
        }];
      }

      if (result.assessment === 'unstable') {
        return [{
          id: `o2-unstable`, severity: 'warning',
          title: `惯例过高变异 — ${ratePct}% 的惯例在变化`,
          description: `大量惯例同时处于变动状态，可能意味着组织缺乏稳定的运作基础。`,
          evidence: [`变异率: ${ratePct}%`, `变异数: ${result.mutatedRoutines}/${result.totalRoutines}`],
          suggestion: '在变化与稳定之间寻求平衡，确保核心惯例的相对稳定。',
          detectedAt: checkedAt,
        }];
      }

      return [{
        id: `o2-healthy`, severity: 'info',
        title: `惯例变异健康 (${ratePct}%)`,
        description: `${result.totalRoutines} 个惯例中 ${result.mutatedRoutines} 个有变化，变异率在健康区间。`,
        evidence: [`变异率: ${ratePct}%`],
        suggestion: '维持当前节奏。',
        detectedAt: checkedAt,
      }];
    } catch (err: unknown) {
      log.error({ err }, '[routine-mutation] check 失败');
      return [{
        id: `o2-error`, severity: 'warning',
        title: '惯例变异率检测异常', description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt,
      }];
    }
  },
};
