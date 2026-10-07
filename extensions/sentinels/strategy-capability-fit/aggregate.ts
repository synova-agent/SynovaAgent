/**
 * strategy-capability-fit/aggregate.ts — S1 战略-能力一致性哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与改造前硬编码现值一致，蓝绿基准）。
 * info 档边界（score ≥ warning 时提示可改善项）复用 score.warning，与 warn 档同一配置源。
 */
import type { SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeStrategyCapabilityFit } from './computes/compute-strategy-capability-fit';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/strategy-capability-fit');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  score: { warning: 0.6, critical: 0.3 },
} as const;

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

/** S1: 战略-能力一致性。读取 Event + Person 节点评估匹配度。 */
export const strategyCapabilityFitSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[]> {
    const now = new Date();
    const checkedAt = now.toISOString();

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'strategy-capability-fit', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'strategy-capability-fit', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
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
            log.warn({ sentinelId: 'sentinel-strategy-capability-fit', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-strategy-capability-fit', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const eventNodes = store.queryNodes('Event', { teamId });
      const personNodes = store.queryNodes('Person', { teamId });

      // 战略目标从 Event 节点中筛选（eventType 包含 strategic/goal/objective）
      const goals = eventNodes
        .filter(n => { const t = (n.props.eventType as string || '').toLowerCase(); return t.includes('strategic') || t.includes('goal') || t.includes('objective'); })
        .map(n => ({
          name: (n.props.name as string) || n.id,
          goalType: n.props.eventType as string | undefined,
        }));

      // 能力数据从 Person 节点的 skills/competency_vector 中提取
      const capabilities = personNodes.map(n => ({
        name: (n.props.name as string) || n.id,
        category: (n.props.skills as string) || (n.props.competencyVector as string) || (n.props.role as string) || 'general',
        level: n.props.skillLevel !== undefined ? Number(n.props.skillLevel) : undefined,
      }));

      const result = computeStrategyCapabilityFit(goals, capabilities);
      log.debug({ score: result.score, gaps: result.alignmentGaps.length }, '战略-能力一致性计算完成');

      if (result.degraded) {
        return [{ id: `s1-nodata`, severity: 'info', title: '战略与能力数据不足', description: '缺少 Event 或 Person 节点，无法评估一致性。', evidence: [], suggestion: '上传事件与人员能力数据。', detectedAt: checkedAt }];
      }

      const scorePct = (result.score * 100).toFixed(0);
      const findings: SentinelFinding[] = [];

      if (result.score < th('score').critical) {
        findings.push({
          id: `s1-crit`, severity: 'critical',
          title: `战略-能力一致性低 (${scorePct}%)`,
          description: `战略目标与现有能力存在显著差距。`,
          evidence: [
            `一致性评分: ${scorePct}%`,
            `战略/创新目标: ${result.strategicGoals}`,
            `核心能力数: ${result.coreCapabilities}`,
            ...result.alignmentGaps,
          ],
          suggestion: '审视战略目标与核心能力是否匹配，补齐关键能力短板。',
          detectedAt: checkedAt,
        });
      } else if (result.score < th('score').warning) {
        findings.push({
          id: `s1-warn`, severity: 'warning',
          title: `战略-能力一致性偏低 (${scorePct}%)`,
          description: '部分战略目标缺乏对应能力支撑。',
          evidence: [`一致性评分: ${scorePct}%`, ...result.alignmentGaps],
          suggestion: '评估能力建设优先级，确保战略目标有对应的能力支撑。',
          detectedAt: checkedAt,
        });
      }

      if (result.alignmentGaps.length > 0 && result.score >= th('score').warning) {
        findings.push({
          id: `s1-info`, severity: 'info',
          title: `战略-能力一致性: ${scorePct}%，存在可改善项`,
          description: result.alignmentGaps.join('; '),
          evidence: result.alignmentGaps,
          suggestion: '定期审视战略目标与能力的匹配度。',
          detectedAt: checkedAt,
        });
      }

      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[strategy-capability-fit] check 失败');
      return [{
        id: `s1-error`, severity: 'warning',
        title: '战略-能力一致性检测异常',
        description: `${(err as Error)?.message || String(err)}`,
        evidence: [], suggestion: '检查 SOG 图数据源。', detectedAt: checkedAt,
      }];
    }
  },
};
