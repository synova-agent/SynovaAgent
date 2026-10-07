/**
 * sentinel-runner.ts — 哨兵按需运行适配器 (L3)
 *
 * 编排者在 Phase 2 调用此模块。注册委托给 SentinelRegistry (单例),
 * 本模块只做 context 适配 (GraphStore → SentinelContext) 和 LLM 格式化。
 *
 * 与 registry.ts 分工: registry 管哨兵生命周期, runner 做按需执行适配。
 *
 * Iron law #24: catch + log + degraded.
 * Iron law #38: zero unsafe type casts.
 */
import { createLogger } from '@synova/logger';
import { getSentinelRegistry, formatFindingsForLLM } from './registry';
import type { SentinelFinding, SentinelContext } from './types';
import { createMetricSink, type MetricSink } from './metric-readings-writer';

const log = createLogger('sentinel/runner');

// ═══ 类型 ═══

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

// ═══ 主入口 ═══

/** 为指定团队运行所有已注册哨兵, 返回 Finding[] */
export async function runSentinelForTeam(
  teamId: string,
  store: GraphStoreReader,
  options?: { metricSink?: MetricSink },
): Promise<SentinelFinding[]> {
  const registry = getSentinelRegistry();
  // 构造 SentinelContext — db 字段携带 GraphStore
  // 🔴 #1054（2-1b）A2（CTO 2026-10-08 裁）：**teamId 必须接进 ctx** —— 否则测量值行的 `org_id`
  //    退化为常量 `'default'`，而 `org_id` 是唯一索引业务键的一部分 ⇒ 跨租户串数据的种子。
  //    （同一缺口的旁证：`src/mcp/tool-definitions.ts` 注释已指出"teamId 传 runSentinelForTeam，
  //      实际跑全量且丢 D577 阈值注入的 teamId 上下文"。）
  // 尽力从引擎上下文取 Database 造 sink（失败 ⇒ undefined ⇒ 不写；**不抛**，铁律 24/31）
  let sink: MetricSink | undefined = options?.metricSink;
  if (!sink) {
    try {
      const { getDatabase } = await import('../init/engine-context');
      sink = createMetricSink(getDatabase());
    } catch (err: unknown) {
      log.debug(
        { err: err instanceof Error ? err.message : String(err) },
        '引擎库不可用 ⇒ 测量值 sink 未注入（不写，不抛）',
      );
    }
  }

  const context: SentinelContext = {
    db: store,
    now: new Date(),
    registry,
    teamId,
    metricSink: sink,
  };
  return registry.runAll(context);
}

// Re-export formatFindingsForLLM for backward compatibility
export { formatFindingsForLLM };
