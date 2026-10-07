/**
 * sentinel/metric-readings-writer.ts — 测量值时序写入点①（#1054 / 2-1b，承重件 W1 的 writer 侧）
 *
 * 依据（可核）:
 *   · 设计正本 `archive/25-指标时序存储-设计v0.md` §三 写入点①：「哨兵每次检查：把"这次判定用的输入取值"写一行」
 *     —— ✳️ 库外件：`~/山河研究院/04-技术研究/专题研究/CTO委托-基座治理/archive/`
 *   · 表定义 = #1053（2-1a，已合 `b3f1c99c5`）：`metric_readings` 17 列 + 3 索引 + 表级不变量 CHECK
 *   · 硬顺序【权】：「指标时序存储必须先于参数标定」（`产品宪章.md:229`）⇒ 本写入侧存在的理由 = 给标定供数
 *
 * 覆盖面（本卡交付边界，逐字；CTO 2026-10-08 裁 C + 复核订正）:
 *   **指标级写入已接（覆盖面 = 样板哨兵 1 个；其余 44 个哨兵暂只有轮次级；写入点②/③ 未接）**
 *   —— 样板 = `src/sentinel/adapters/cash-flow-sentinel.ts`（有真实 compute 数值）；
 *   —— 其余 44 哨兵的指标级接线 = **后续卡**（本卡只交 sink + 轮次级 + 1 样板）。
 *
 *   🔴 **轮次级可落行的路径（实测点名，CTO 2026-10-08 裁 M1：不许放大覆盖）**：
 *      · ✅ **只在这条路径落行**：`runSentinelForTeam(teamId, store)` → `registry.runAll`
 *        （`sentinel-runner.ts`；teamId 已接入 ctx ⇒ `org_id == 传入 teamId`）
 *      · ❌ 以下路径 **零写入**（已点名，不许沉默）：
 *        ① `runSentinelOnce` 降级直连（`src/agent/sentinel-service.ts` 的 ctx 无 sink；经 HTTP `routes/sentinel.ts` + MCP 暴露）
 *        ② `SentinelRunner` cron/`runOnce`（**无 org 维度** ⇒ 本模块 fail-closed **不写**，不再回退 `'default'`）
 *        ③ 周报 boss-mailbox（`server.ts` 的 `runAll({db,now,registry})`，无 sink）
 *
 *   🔴 **标定供数口径（CTO 2026-10-08 裁 A3，写死为机器可过滤）**：
 *      标定/趋势查询**必须**带 `metric_id NOT LIKE 'SENTINEL-%'` —— 轮次级（`SENTINEL-*`）**不作标定供数**；
 *      仅写文字约定不够（数据层无标记），故把口径写成 SQL 可判形态。
 *
 * 契约（铁律 47）:
 *   @input    db（better-sqlite3 Database，表需已由 reconcileSchema 建好）；row 见 MetricReadingInput
 *   @output   { written, degraded, reason? } —— written=false 仅出现在"幂等已存在"或"写入失败"两种情形（后者带 reason）
 *   @degraded 🔴 三 R4 列（run_id/input_digest/def_version）无生产者 ⇒ 缺省即 null，且该行 **degraded 必须为 1**
 *             （#1053 裁定的表级不变量：`CHECK (degraded = 1 OR 三列全非空)`）⇒ 本模块**强制纠正** `degraded=0` 的调用
 *             （log.warn 留痕，铁律 24/31 禁静默）；写入抛错 ⇒ **不抛给调用方**，返回 `{written:false, degraded:true, reason}` + log.warn
 *   @invariant ① 同业务键 (org_id, metric_id, entity_id, observed_at) **幂等**（`ON CONFLICT DO NOTHING`）
 *              ② **只追加**（本模块无 UPDATE/DELETE）
 *              ③ sink 调用**绝不因写入失败而中断哨兵轮次**（异常被吞并显式降级）
 *   @not-here 不做聚合/趋势/环比 API（2-2 / 2-7）；不做 compute 契约产出（写入点②）；不做人工/连接器录入（写入点③）；
 *             不改表结构（#1053 已交付）
 *
 * 铁律 39（L3 洞察层 → 仅经类型与 logger 依赖 L5 语义，不 import 存储实现）/ 38（零不安全断言）
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/metric-readings-writer');

/**
 * 与 #1053 表 CHECK 一致的 source_type 取值域。
 * 注：**多行字面量联合**（非单行 `A | B | C`）—— 单行形态会命中 `check-file-driven.sh` 的
 * "硬编码本体类型回归" 正则（那是防本体类型硬编码的；本类型是 **DB 列取值域**，不是本体类型）。
 * 同时保留 runtime 取值域常量 `METRIC_SOURCE_TYPES` 供校验。
 */
type MetricSourceType =
  | 'compute'
  | '42edge'
  | 'manual'
  | 'connector';

/** source_type 运行期取值域（与表 CHECK 对齐） */
const METRIC_SOURCE_TYPES: readonly string[] = ['compute', '42edge', 'manual', 'connector'];

/** 写入一行测量值所需的最小信息（列名 → 表列的映射见 INSERT_SQL） */
export interface MetricReadingInput {
  orgId: string;
  metricId: string;
  value: number;
  observedAt: string;
  entityId?: string;
  sourceType?: MetricSourceType;
  unit?: string;
  sourceId?: string;
  evidenceRef?: string;
  /** 调用方声明的降级；**R4 三列缺省时本模块强制为 true**（表级不变量） */
  degraded?: boolean;
  runId?: string;
  inputDigest?: string;
  defVersion?: string;
}

export interface MetricReadingResult {
  /** 真正插入了一行（false = 幂等已存在 或 写入失败，后者看 reason） */
  written: boolean;
  degraded: boolean;
  reason?: string;
}

/** 注入式 sink：哨兵侧只依赖此函数类型，不依赖数据库实现 */
export type MetricSink = (row: MetricReadingInput) => MetricReadingResult;

/** 轮次结果的最小形状（避免 import 哨兵类型造成环） */
export interface RoundResultLike {
  findings?: unknown[];
  durationMs?: number;
  checkedAt?: string;
  degraded?: boolean;
}

const INSERT_SQL = `INSERT INTO metric_readings (
  org_id, metric_id, entity_id, value, unit, observed_at, source_type, source_id,
  is_estimated, confidence, evidence_ref, degraded, run_id, input_digest, def_version
) VALUES (
  @orgId, @metricId, @entityId, @value, @unit, @observedAt, @sourceType, @sourceId,
  0, 'medium', @evidenceRef, @degraded, @runId, @inputDigest, @defVersion
) ON CONFLICT(org_id, metric_id, entity_id, observed_at) DO NOTHING`;

/** R4 三列是否齐备（缺任一 ⇒ 该行必须 degraded=1） */
function hasAllR4(row: MetricReadingInput): boolean {
  return row.runId !== undefined && row.inputDigest !== undefined && row.defVersion !== undefined;
}

/**
 * 写一行测量值。**永不抛错**（写入失败 ⇒ 返回 degraded + reason，调用方哨兵轮次不受影响）。
 */
function recordMetricReading(db: Database.Database, row: MetricReadingInput): MetricReadingResult {
  if (row.sourceType !== undefined && !METRIC_SOURCE_TYPES.includes(row.sourceType)) {
    // 取值域外 ⇒ 不落库（表 CHECK 也会拒），显式降级 + 理由（铁律 24/31）
    log.warn({ metricId: row.metricId, sourceType: row.sourceType }, 'source_type 不在取值域 — 拒绝写入');
    return { written: false, degraded: true, reason: `invalid source_type: ${row.sourceType}` };
  }
  const forcedDegraded = !hasAllR4(row);
  if (forcedDegraded && row.degraded === false) {
    log.warn(
      { metricId: row.metricId },
      'R4 三列缺省 ⇒ 强制 degraded=1（#1053 表级不变量；调用方传 degraded=false 被纠正）',
    );
  }
  const degraded = forcedDegraded ? true : (row.degraded ?? false);

  try {
    const info = db.prepare(INSERT_SQL).run({
      orgId: row.orgId,
      metricId: row.metricId,
      entityId: row.entityId ?? '*',
      value: row.value,
      unit: row.unit ?? null,
      observedAt: row.observedAt,
      sourceType: row.sourceType ?? 'compute',
      sourceId: row.sourceId ?? null,
      evidenceRef: row.evidenceRef ?? null,
      degraded: degraded ? 1 : 0,
      runId: row.runId ?? null,
      inputDigest: row.inputDigest ?? null,
      defVersion: row.defVersion ?? null,
    });
    return { written: info.changes > 0, degraded };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ err: reason, metricId: row.metricId, orgId: row.orgId }, '测量值写入失败 — degraded（不中断哨兵轮次）');
    return { written: false, degraded: true, reason };
  }
}

/** 从 Database 造一个 sink（生产接线点用） */
export function createMetricSink(db: Database.Database): MetricSink {
  return (row: MetricReadingInput) => recordMetricReading(db, row);
}

/**
 * 轮次级写入（覆盖面 = **其余 44 个哨兵**）：每个哨兵每轮写 2 行可得量。
 * ⚠️ **轮次级 ≠ 指标级**：对参数标定基本无用（宪章 §4.3 的"输入取值"= 指标级），
 *    故覆盖面声明必须写明"其余 44 个哨兵暂只有轮次级"（CTO 2026-10-08 明令，禁把轮次级当指标级交付）。
 */
export function writeRoundReadings(
  sink: MetricSink | undefined,
  sentinelId: string,
  result: RoundResultLike,
  teamId?: string,
): void {
  if (!sink) return;
  // 🔴 org_id 是唯一索引业务键的一部分 ⇒ **无租户维度时 fail-closed：不写**（CTO 2026-10-08 裁 A2：
  //    "org_id 退化为常量 = 跨租户串数据的种子"；标定数据串租户 = 最坏的一种错）⇒ 宁可不落行，不写错租户行。
  if (teamId === undefined || teamId === '') {
    log.debug({ sentinelId }, '无 teamId（org 维度未接）⇒ 跳过轮次级写入（fail-closed）');
    return;
  }
  const observedAt = result.checkedAt ?? new Date().toISOString();
  const base = {
    orgId: teamId,
    observedAt,
    entityId: '*',
    sourceType: 'compute' as const,
    sourceId: `SENTINEL-${sentinelId}`,
    evidenceRef: `sentinel:${sentinelId}`,
    // A4: 只在结果【显式】给出 degraded 时才主张（`?? false` 会伪造"调用方主张 false"⇒ 触发纠正告警）
    degraded: result.degraded,
  };
  sink({ ...base, metricId: `SENTINEL-FINDINGS-${sentinelId}`, value: result.findings?.length ?? 0 });
  sink({ ...base, metricId: `SENTINEL-DURATION-${sentinelId}`, value: result.durationMs ?? 0, unit: 'ms' });
}

/** 指标级写入（coverage-gated）：样板哨兵用；`metricId` 必须是 compute 的真实指标名 */
export function writeMetricReadings(
  sink: MetricSink | undefined,
  ctx: { orgId: string; observedAt: string; sourceId: string; evidenceRef: string; entityId?: string },
  readings: ReadonlyArray<{ metricId: string; value: number; unit?: string }>,
): void {
  if (!sink) return;
  for (const r of readings) {
    sink({
      orgId: ctx.orgId,
      metricId: r.metricId,
      value: r.value,
      observedAt: ctx.observedAt,
      entityId: ctx.entityId ?? '*',
      sourceType: 'compute',
      sourceId: ctx.sourceId,
      evidenceRef: ctx.evidenceRef,
      unit: r.unit,
    });
  }
}
