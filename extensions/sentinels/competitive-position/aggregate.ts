/**
 * competitive-position/aggregate.ts — 竞争定位哨兵(合并)
 *
 * 合并自 competitive-dynamics(E3) + market-lifecycle(E1)。
 * 整合竞争格局变化和产业生命周期判定。
 * 源文件保留在 _extinct/ 作为审计参考。
 */
import type { SentinelFinding } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/competitive-position');

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const competitivePositionSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const now = new Date();
    const findings: SentinelFinding[] = [];

    try {
      // M1b（CTO 裁 157 选②·「卸=移除」）：子哨兵 competitive-dynamics/market-lifecycle 已退役至 _extinct/，
      // 断开编译期 import 边（tsc 会追动态 import()，把归档件拉回编译域报 TS2307/TS7006）。
      // 降级声明（铁律 11）：不再有子检查产出，显式 warn + degraded，不静默。
      log.warn({ degraded: true }, '[competitive-position] 子哨兵已退役(_extinct)，合并检查暂无产出');
      log.debug({ totalFindings: findings.length }, '竞争定位合并检查完成');
      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[competitive-position] check 失败');
      return [{
        id: `cp-error`, severity: 'warning' as const,
        title: '竞争定位检测异常',
        description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查源哨兵 aggregate.ts 和 Market/Financial 数据源。',
        detectedAt: now.toISOString(),
      }];
    }
  },
};
