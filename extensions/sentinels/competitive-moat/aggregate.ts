/**
 * competitive-moat/aggregate.ts — 竞争护城河哨兵(合并)
 *
 * 合并自 competitive-moat-perceptual(I4) + competitive-moat-structural(I3)。
 * 整合感知壁垒(品牌溢价/客户忠诚度) + 结构性壁垒(规模经济/网络效应/切换成本等)。
 * 源文件保留在 _extinct/ 作为审计参考。
 */
import type { SentinelFinding } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/competitive-moat');

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const competitiveMoatSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal): Promise<SentinelFinding[]> {
    const now = new Date();
    const findings: SentinelFinding[] = [];

    try {
      // M1b（CTO 裁 157 选②·「卸=移除」）：子哨兵 perceptual/structural 已退役至 _extinct/，
      // 断开编译期 import 边（tsc 会追动态 import()，把归档件拉回编译域报 TS2307/TS7006）。
      // 降级声明（铁律 11）：不再有子检查产出，显式 warn + degraded，不静默。
      log.warn({ degraded: true }, '[competitive-moat] 子哨兵已退役(_extinct)，合并检查暂无产出');
      log.debug({ totalFindings: findings.length }, '竞争护城河合并检查完成');
      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[competitive-moat] check 失败');
      return [{
        id: `cm-error`, severity: 'warning' as const,
        title: '竞争护城河检测异常',
        description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查源哨兵 aggregate.ts 和 Product/Market 数据源。',
        detectedAt: now.toISOString(),
      }];
    }
  },
};
