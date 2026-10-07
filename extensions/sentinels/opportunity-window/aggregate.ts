/**
 * opportunity-window/aggregate.ts — E2 结构性机会窗口哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 * opportunity_score 为单档判定（消费 .critical；severity 保持代码现状 warning）。
 * L49 `score > 0.7` 为正向 info 发现（非告警阈值，manifest 无对应 key）— 保持现状不接线（spec §6）。
 */
import type { SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeOpportunityWindowScore } from './computes/opportunity-window-score';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/opportunity-window');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  opportunity_score: { warning: 0.4, critical: 0.2 },
} as const;

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const opportunityWindowSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[]> {
    const now = new Date();
    const checkedAt = now.toISOString();
    const findings: SentinelFinding[] = [];

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'opportunity-window', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'opportunity-window', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };

    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B3）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1/B2 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-opportunity-window', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-opportunity-window', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const eventNodes = store.queryNodes('Event', { teamId });
      const toolNodes = store.queryNodes('Tool', { teamId });

      const events = [
        ...eventNodes.map(n => ({ type: n.type, eventType: n.props.eventType as string, description: n.props.description as string })),
        ...toolNodes.map(n => ({ type: n.type, eventType: 'technology_change', description: n.props.name as string })),
      ];

      const result = computeOpportunityWindowScore(events);
      if (result.degraded) { log.warn({ teamId }, 'compute degraded — data incomplete'); return []; }
      log.debug({ score: result.score, signals: result.signals.length }, '机会窗口评分完成');

      const scorePct = (result.score * 100).toFixed(0);

      if (result.score < th('opportunity_score').critical) {
        findings.push({
          id: `e2-low`, severity: 'warning',
          title: `结构性变化机会少 (${scorePct}%)`,
          description: '外部环境相对稳定，无明显技术/法规/竞争变化信号。',
          evidence: result.signals.length > 0 ? result.signals : ['无显著变化信号'],
          suggestion: '专注内部优化和效率提升。',
          detectedAt: checkedAt,
        });
      } else if (result.score > 0.7) {
        findings.push({
          id: `e2-high`, severity: 'info',
          title: `结构性机会窗口打开 (${scorePct}%)`,
          description: `检测到 ${result.techChangeSignals + result.regulatorySignals + result.competitiveSignals} 个结构性变化信号。`,
          evidence: result.signals,
          suggestion: '评估这些变化是否为企业带来战略机遇。',
          detectedAt: checkedAt,
        });
      }

      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[opportunity-window] check 失败');
      return [{
        id: `e2-error`, severity: 'warning',
        title: '机会窗口检测异常', description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt,
      }];
    }
  },
};
