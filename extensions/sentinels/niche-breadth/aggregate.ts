/**
 * niche-breadth/aggregate.ts — I1 生态位宽度哨兵
 *
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 * niche_depth 为单档判定（消费 .critical；severity 保持代码现状 warning，不新增 .warning 档 finding）。
 */
import type { SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeLevinsBreadth } from './computes/levins-breadth';
import { createLogger } from '@synova/logger';
const log = createLogger('sentinel/niche-breadth');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  niche_breadth: { warning: 1.5, critical: 1.0 },
  niche_depth: { warning: 0.3, critical: 0.5 },
} as const;

interface GraphStoreReader { queryNodes(t: string, f?: Record<string, unknown>, g?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>; }
export const nicheBreadthSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[]> {
    const now = new Date(); const checkedAt = now.toISOString();

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'niche-breadth', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'niche-breadth', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
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
            log.warn({ sentinelId: 'sentinel-niche-breadth', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-niche-breadth', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      const clientNodes = store.queryNodes('Client', { teamId });
      const eventNodes = store.queryNodes('Event', { teamId });
      // 生态位分段：客户群 + 事件区域
      const segments = [...clientNodes, ...eventNodes].map(n => ({
        name: (n.props.name as string) || n.id,
        value: Number(n.props.revenue) || Number(n.props.amount) || 1,
      }));
      const r = computeLevinsBreadth(segments);
      if (r.degraded) { log.warn({ teamId }, 'compute degraded — skipping threshold'); return []; }
      log.debug({ breadth: r.breadth, depth: r.depth, volume: r.volume }, '生态位计算完成');
      const f: SentinelFinding[] = [];
      if (r.breadth < th('niche_breadth').critical) {
        f.push({ id: `i1-breadth-crit`, severity: 'critical', title: `生态位过窄 (B=${r.breadth.toFixed(2)})`, description: `单一细分市场占比过高。`, evidence: [`B: ${r.breadth.toFixed(2)}`, `D: ${r.depth.toFixed(2)}`], suggestion: '拓展品类或区域。', detectedAt: checkedAt });
      } else if (r.breadth < th('niche_breadth').warning) {
        f.push({ id: `i1-breadth-warn`, severity: 'warning', title: `生态位偏窄 (B=${r.breadth.toFixed(2)})`, description: `B < 1.5, 多样性不足。`, evidence: [`B: ${r.breadth.toFixed(2)}`, `D: ${r.depth.toFixed(2)}`], suggestion: '评估扩展机会。', detectedAt: checkedAt });
      }
      if (r.depth > th('niche_depth').critical) {
        f.push({ id: `i1-depth`, severity: 'warning', title: `生态位深度过高 (D=${r.depth.toFixed(2)})`, description: `单一细分市场依赖度过高。`, evidence: [`D: ${r.depth.toFixed(2)}`], suggestion: '分散市场依赖。', detectedAt: checkedAt });
      }
      return f;
    } catch (err: unknown) { log.error({ err }, '[niche-breadth] 失败'); return [{ id: `i1-error`, severity: 'warning', title: '生态位检测异常', description: `${(err as Error)?.message || String(err)}`, evidence: [], suggestion: '检查数据源。', detectedAt: checkedAt }]; }
  },
};
