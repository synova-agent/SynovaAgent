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
import type Database from 'better-sqlite3';
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

/**
 * `runSentinelForTeam` 的注入选项（铁律 47）：
 * @field metricSink —— 旧链（`metric_readings`）sink；不注入 ⇒ 发动机库造一个（既有行为，零改动）
 * @field period —— #1431 S2：④a 周期（`YYYY-MM`），**必须由调用方显式传入**；
 *                 禁 `now()` 派生、禁用写入时间顶替；缺 ⇒ 不写 `metric_observations`（log.warn 降级码）
 * @field objectKey —— #1431 S2：② 对象业务键（`resolveOrCreate` 的幂等键）；缺 ⇒ 不写 ④a、不回落 `'*'`
 * @not-here 不扩 `SentinelContext`（S2 卡 v2 停点：当前设计不需要）；period 的调度生产者归 S2b
 */
export interface RunSentinelForTeamOptions {
  metricSink?: MetricSink;
  period?: string;
  objectKey?: string;
}

// ═══ 主入口 ═══

/** 为指定团队运行所有已注册哨兵, 返回 Finding[] */
export async function runSentinelForTeam(
  teamId: string,
  store: GraphStoreReader,
  options?: RunSentinelForTeamOptions,
): Promise<SentinelFinding[]> {
  const registry = getSentinelRegistry();
  // 构造 SentinelContext — db 字段携带 GraphStore
  // 🔴 #1054（2-1b）A2（CTO 2026-10-08 裁）：**teamId 必须接进 ctx** —— 否则测量值行的 `org_id`
  //    退化为常量 `'default'`，而 `org_id` 是唯一索引业务键的一部分 ⇒ 跨租户串数据的种子。
  //    （同一缺口的旁证：`src/mcp/tool-definitions.ts` 注释已指出"teamId 传 runSentinelForTeam，
  //      实际跑全量且丢 D577 阈值注入的 teamId 上下文"。）
  // 尽力从引擎上下文取 Database 造 sink（失败 ⇒ undefined ⇒ 不写；**不抛**，铁律 24/31）
  let sink: MetricSink | undefined = options?.metricSink;
  // #1431 S2：④a 写入要真实引擎库句柄（`metric_observations`）；只在**调用方尝试了 ④a**
  //   （给了 period 或 objectKey 任一）时才取 —— 旧调用点不传 options ⇒ 行为与改动前逐字相同，
  //   不多一次 getDatabase。取不到 ⇒ db 为 undefined，registry 侧记 `S2_DEGRADED_NO_DB`
  //   （不写、不抛，铁律 24/31）。
  let db: Database.Database | undefined;
  const needsObservationDb = options?.period !== undefined || options?.objectKey !== undefined;
  if (!sink || needsObservationDb) {
    try {
      const { getDatabase } = await import('../init/engine-context');
      db = getDatabase();
      if (!sink) sink = createMetricSink(db);
    } catch (err: unknown) {
      log.debug(
        { err: err instanceof Error ? err.message : String(err) },
        '引擎库不可用 ⇒ 测量值 sink / ④a 写入未注入（不写，不抛）',
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
  return registry.runAll(context, { period: options?.period, objectKey: options?.objectKey, db });
}

// Re-export formatFindingsForLLM for backward compatibility
export { formatFindingsForLLM };
