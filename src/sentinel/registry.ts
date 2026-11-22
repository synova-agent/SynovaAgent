/**
 * sentinel/registry.ts — SentinelRegistry 实现 (P1-1)
 *
 * 哨兵注册中心: 管理所有 Sentinel 实例的生命周期。
 * 单例模式, 全局可访问。支持按类别/优先级过滤。
 *
 * @state: real — 生产可用, 与 CronScheduler 集成
 */

import type { Sentinel, SentinelConfig, SentinelCategory, SentinelPriority, SentinelRegistry, SentinelFinding, SentinelContext, SentinelCheckResult } from './types';
import { createLogger } from '@synova/logger';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { writeRoundReadings } from './metric-readings-writer';
import { writeMetricObservation } from './metric-observations-writer';
import { resolveOrCreate } from '../agent/graph-store-service';
const log = createLogger('sentinel/registry');

/**
 * 轮次级 ④a 写入选项（#1431 阶段 2 · S2）。
 *
 * 三者**都由调用方/装配方显式给**，本模块不推导：
 * @field period —— 业务周期（`YYYY-MM`）。禁 `now()` 派生、禁用写入时间顶替；
 *                  缺 ⇒ 不写 `metric_observations` + `log.warn` `S2_DEGRADED_NO_PERIOD`。
 * @field objectKey —— ② 对象的业务键（`resolveOrCreate` 的幂等键）；缺 ⇒ 不写 + `S2_DEGRADED_NO_OBJECT`，
 *                   **不回落 `'*'`**（`metric_observations.object_id <> '*'` 是表级不变量）。
 * @field db —— 引擎库句柄（由 runner 经注入给出；registry 不自行 `getDatabase`）。缺 ⇒ 不写 + `S2_DEGRADED_NO_DB`。
 *
 * @not-here 不扩 `SentinelContext`（S2 卡 v2 停点：当前设计不需要）；period 的生产者（调度接入）归 S2b。
 */
export interface SentinelRoundObservationOptions {
  period?: string;
  objectKey?: string;
  db?: Database.Database;
}

// ═══ SentinelRegistryImpl ═══

export class SentinelRegistryImpl implements SentinelRegistry {
  private sentinels = new Map<string, Sentinel>();

  /** #1463 B7：重复注册被跳过的累计次数（可观测计数；修前该信号为「静默覆盖」） */
  private duplicateSkips = 0;

  /**
   * 注册哨兵（**幂等**，#1463 B7）。
   *
   * 契约（铁律 47）：
   * - 输入：`sentinel` — 满足 `Sentinel` 结构的实例
   * - 输出：`void`（接口 `SentinelRegistry.register` 签名不变）；副作用 = 首次登记 / 重复则跳过并计数
   * - 降级：不适用（无 I/O、不抛异常；非法结构不在本函数校验范围内）
   *
   * 语义（2026-10-09 由「覆盖旧实例」改为「显式跳过」）：
   *   同 id 二次注册 ⇒ **保留首登实例**、`duplicateSkips += 1`、按 warn 记一条带累计数的日志。
   *   为什么改：生产有**两个**调用点登记同一批 45 个文件驱动哨兵
   *   （src/init/file-driven-loaders.ts、src/deploy/bootstrap.ts）⇒ 实测刷 45 条「覆盖旧实例」。
   *   两个调用点 import 的是**同一模块实例**（ESM 按 URL 缓存）⇒ 跳过与覆盖在实例同一性上等价，
   *   但「跳过」不再让「谁赢了」这件事变得不可见（P-03：声称必须与事实一致）。
   */
  register(sentinel: Sentinel): void {
    const id = sentinel.config.id;
    if (this.sentinels.has(id)) {
      this.duplicateSkips += 1;
      log.warn({ sentinelId: id, skipped: this.duplicateSkips },
        '哨兵重复注册 — 跳过 (幂等)');
      return;
    }
    this.sentinels.set(id, sentinel);
    log.info({ sentinelId: id, name: sentinel.config.name, category: sentinel.config.category },
      '哨兵已注册');
  }

  /** #1463 B7：累计被跳过的重复注册次数（与修前「覆盖」日志行数可直接对照） */
  getDuplicateSkipCount(): number {
    return this.duplicateSkips;
  }

  unregister(id: string): void {
    if (this.sentinels.delete(id)) {
      log.info({ sentinelId: id }, '哨兵已注销');
    }
  }

  get(id: string): Sentinel | undefined {
    return this.sentinels.get(id);
  }

  list(): Sentinel[] {
    return [...this.sentinels.values()];
  }

  listByCategory(category: SentinelCategory): Sentinel[] {
    return this.list().filter(s => s.config.category === category);
  }

  listByPriority(priority: SentinelPriority): Sentinel[] {
    return this.list().filter(s => s.config.priority === priority);
  }

  count(): number {
    return this.sentinels.size;
  }

  /** 获取所有 cron 模式的哨兵 */
  listCronSentinels(): Array<{ sentinel: Sentinel; cron: string }> {
    return this.list()
      .filter(s => s.config.mode === 'cron' && s.config.cron)
      .map(s => ({ sentinel: s, cron: s.config.cron! }));
  }

  /** 按团队列出哨兵 — 当前所有哨兵全局适用, 团队过滤在 check() 内部通过 discoverTeams 实现 */
  listForTeam(_teamId: string): Sentinel[] {
    return this.list();
  }

  /**
   * 运行所有哨兵 (按需诊断用), 返回 Finding[]。每哨兵独立降级。
   *
   * #1054：旧链轮次级写入（`metric_readings`）**保持原样**（本卡零改动）。
   * #1431 S2：可选 `observation` 给出 period/objectKey/db 时，**追加**一轮 ④a 写入
   * （新表 `metric_observations`，`object_id` 指向 `resolveOrCreate` 得到的真实 ② 节点）；
   * 缺任一项 ⇒ 该轮**不写 ④a** + `log.warn`（降级码见 `SentinelRoundObservationOptions`）。
   */
  async runAll(
    context: SentinelContext,
    observation?: SentinelRoundObservationOptions,
  ): Promise<SentinelFinding[]> {
    const all: SentinelFinding[] = [];
    const observationTarget = resolveRoundObservationTarget(context, observation);
    for (const s of this.sentinels.values()) {
      try {
        const result = await s.check(context);
        // #1054（2-1b）轮次级写入（覆盖面 = 其余 44 哨兵；sink 未注入 ⇒ no-op）—— 旧链，零改动
        writeRoundReadings(context.metricSink, s.config.id, result, context.teamId);
        // #1431 S2：④a 轮次级写入（新表；缺 period/objectKey/db ⇒ 本轮已降级，target 为 null）
        if (observationTarget) writeRoundObservations(observationTarget, s.config, result);
        if (result.findings) all.push(...result.findings);
      } catch (err: unknown) {
        log.warn({ err, id: s.config.id }, '哨兵执行失败 — degraded');
      }
    }
    if (all.length > 0) log.info({ findings: all.length }, '哨兵运行完成');
    return all;
  }
}

// ═══ #1431 阶段 2 · S2：轮次级 ④a 写入（新表 metric_observations）═══

/** ④a 写入指向的 ② 对象类型（企业团队） */
const ROUND_OBSERVATION_OBJECT_TYPE = 'Team';

/**
 * 哨兵轮次生产的 ② 对象 `defVersion`（S1 `createObject` 必填的**对象定义版本**）。
 * ⚠️ 与观测行的 `def_version`（= 哨兵 `config.version`）**不是同一个东西**：
 *    前者标 ② 对象形态的版本，后者标指标定义的版本。
 */
const ROUND_OBJECT_DEF_VERSION = 'sentinel-round-v1';

/** `period` 形态（`YYYY-MM`）—— 与 S1 `createObject` / `metric_observations.period` 口径一致 */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 一轮 ④a 写入的目标（对象已解析、runId 已生成） */
interface RoundObservationTarget {
  db: Database.Database;
  orgId: string;
  objectId: string;
  period: string;
  runId: string;
  /** `checkedAt` 缺失时的观测时间兜底 —— 取**注入的** `context.now`（tests/contract/time-injection 禁新代码直取系统时钟） */
  fallbackObservedAt: string;
}

/**
 * 解析本轮 ④a 的目标；任一前提缺失 ⇒ `log.warn` + 返回 null（**本轮不写 ④a**）。
 *
 * 降级码（机器可过滤，铁律 11/24/31）：
 *   · `S2_DEGRADED_NO_PERIOD` —— 调用方未显式传入 period（禁 `now()` 派生）；
 *   · `S2_DEGRADED_BAD_PERIOD` —— period 非 `YYYY-MM`；
 *   · `S2_DEGRADED_NO_OBJECT` —— 未传 objectKey（不得回退 `'*'`）；
 *   · `S2_DEGRADED_NO_ORG` —— 无 teamId（org 维度未接 ⇒ fail-closed，不写错租户行）；
 *   · `S2_DEGRADED_NO_DB` —— 引擎库句柄不可用（不抛、不中断哨兵轮次）；
 *   · `S2_DEGRADED_OBJECT_FAILED` —— ② 对象解析/创建失败（严格链抛错 ⇒ 本轮不写 ④a）。
 */
function resolveRoundObservationTarget(
  context: SentinelContext,
  observation: SentinelRoundObservationOptions | undefined,
): RoundObservationTarget | null {
  const period = observation?.period;
  if (typeof period !== 'string' || period === '') {
    log.warn(
      { code: 'S2_DEGRADED_NO_PERIOD', teamId: context.teamId },
      '缺调用方显式传入的 period（YYYY-MM）⇒ 本轮不写 metric_observations（禁 now() 派生、禁写 *）',
    );
    return null;
  }
  if (!PERIOD_PATTERN.test(period)) {
    log.warn(
      { code: 'S2_DEGRADED_BAD_PERIOD', period, teamId: context.teamId },
      'period 不是 YYYY-MM ⇒ 本轮不写 metric_observations',
    );
    return null;
  }
  const objectKey = observation?.objectKey;
  if (typeof objectKey !== 'string' || objectKey === '') {
    log.warn(
      { code: 'S2_DEGRADED_NO_OBJECT', teamId: context.teamId },
      '缺 objectKey ⇒ 本轮不写 metric_observations（不得回退写 *）',
    );
    return null;
  }
  const orgId = context.teamId;
  if (typeof orgId !== 'string' || orgId === '') {
    log.warn(
      { code: 'S2_DEGRADED_NO_ORG', objectKey },
      '无 teamId（org 维度未接）⇒ 本轮不写 metric_observations（fail-closed）',
    );
    return null;
  }
  const db = observation?.db;
  if (!db) {
    log.warn(
      { code: 'S2_DEGRADED_NO_DB', orgId, objectKey },
      '引擎库句柄不可用 ⇒ 本轮不写 metric_observations（不抛、不中断哨兵轮次）',
    );
    return null;
  }
  let objectId: string;
  try {
    objectId = resolveOrCreate(orgId, objectKey, ROUND_OBSERVATION_OBJECT_TYPE, {
      name: objectKey,
      period,
      defVersion: ROUND_OBJECT_DEF_VERSION,
    });
  } catch (err: unknown) {
    log.warn(
      { code: 'S2_DEGRADED_OBJECT_FAILED', orgId, objectKey, err: err instanceof Error ? err.message : String(err) },
      '② 对象解析/创建失败 ⇒ 本轮不写 metric_observations（不中断哨兵轮次）',
    );
    return null;
  }
  // runId 每轮一个（不入唯一键 ⇒ 同周期重跑只留首行，run_id 仅用于追账）
  return {
    db,
    orgId,
    objectId,
    period,
    runId: `run-${randomUUID()}`,
    fallbackObservedAt: context.now.toISOString(),
  };
}

/**
 * 写一轮 ④a（每个哨兵 2 行可得量：findings 条数 + 耗时）。
 *
 * 与旧链 `writeRoundReadings` 的差别：**严格链**（`writeMetricObservation` 校验失败即抛），
 * 故此处必须逐行 `try/catch` + `log.warn`：单行写失败**不中断**哨兵轮次（铁律 24/31），
 * 也不伪造成功 —— 没写进去就是没写进去。
 */
function writeRoundObservations(
  target: RoundObservationTarget,
  sentinel: Pick<SentinelConfig, 'id' | 'version'>,
  result: Pick<SentinelCheckResult, 'findings' | 'durationMs' | 'checkedAt'>,
): void {
  const sentinelId = sentinel.id;
  const observedAt =
    typeof result.checkedAt === 'string' && result.checkedAt !== ''
      ? result.checkedAt
      : target.fallbackObservedAt;
  const rows: ReadonlyArray<{ metricId: string; value: number; unit?: string }> = [
    { metricId: `SENTINEL-FINDINGS-${sentinelId}`, value: result.findings?.length ?? 0 },
    { metricId: `SENTINEL-DURATION-${sentinelId}`, value: result.durationMs ?? 0, unit: 'ms' },
  ];
  for (const row of rows) {
    try {
      writeMetricObservation(target.db, {
        orgId: target.orgId,
        objectId: target.objectId,
        metricId: row.metricId,
        period: target.period,
        value: row.value,
        unit: row.unit,
        // 指标定义版本 = 哨兵自己的 config.version（不是轮次对象的 defVersion）
        defVersion: sentinel.version,
        runId: target.runId,
        sourceType: 'compute',
        sourceId: `SENTINEL-${sentinelId}`,
        evidenceRef: `sentinel:${sentinelId}`,
        observedAt,
      });
    } catch (err: unknown) {
      log.warn(
        {
          code: 'S2_DEGRADED_WRITE_FAILED',
          orgId: target.orgId,
          objectId: target.objectId,
          metricId: row.metricId,
          period: target.period,
          err: err instanceof Error ? err.message : String(err),
        },
        'metric_observations 写入失败 ⇒ 该行不落库（严格链；不中断哨兵轮次）',
      );
    }
  }
}

// ═══ LLM 格式化 ═══

/** 将 Finding[] 格式化为 LLM prompt 文本 */
export function formatFindingsForLLM(findings: SentinelFinding[]): string {
  if (findings.length === 0) return '';
  const crit = findings.filter(f => f.severity === 'critical');
  const warn = findings.filter(f => f.severity === 'warning');
  const lines: string[] = ['## 哨兵监测数据 (客观事实)\n'];
  if (crit.length > 0) {
    lines.push(`🔴 严重 (${crit.length} 条):`);
    for (const f of crit) lines.push(`- ${f.title}: ${f.description}`);
  }
  if (warn.length > 0) {
    lines.push(`\n🟡 警告 (${warn.length} 条):`);
    for (const f of warn) lines.push(`- ${f.title}: ${f.description}`);
  }
  lines.push(`\n共 ${findings.length} 条发现。请基于以上客观数据生成诊断假设。`);
  return lines.join('\n');
}

// ═══ Global Singleton ═══

let _globalRegistry: SentinelRegistryImpl | null = null;

/** 获取全局 SentinelRegistry 单例 */
export function getSentinelRegistry(): SentinelRegistryImpl {
  if (!_globalRegistry) {
    _globalRegistry = new SentinelRegistryImpl();
  }
  return _globalRegistry;
}

/** 销毁全局单例 (测试用) */
export function destroySentinelRegistry(): void {
  _globalRegistry = null;
}
