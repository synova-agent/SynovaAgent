/**
 * sentinel/metric-observations-writer.ts — 指标观测**严格写入**（#1431 / 阶段 2 · T1）
 *
 * 依据（逐条可核）:
 *   · DEV DOC v2（Issue #1431 评论 13555）§3 DDL ＋ §5「新链契约」；
 *   · CTO 放行（评论 13556）：只放行 T1；旧链 `metric-readings-writer.ts` **零改动**。
 *
 * 双契约（v2 §2.2，**不是**同一套）:
 *   · 旧链 = **永不抛**：返回 `{written, degraded, reason}` + `log.warn`（`metric-readings-writer.ts`，本卡不碰）；
 *   · 新链 = **严格**：缺键 / `objectId === '*'` / `period === ''` / 非法 `sourceType` / 非有限 `value`
 *     ⇒ 抛 `MetricObservationError(VALIDATION)` 且 **零写入**（铁律 24/31：不静默降级）。
 *
 * 契约（铁律 47）:
 *   @input    db —— better-sqlite3 Database（表须已由 `reconcileSchema` 建好，迁移 007）；
 *             input —— `MetricObservationInput`（见 §5：orgId/objectId/metricId/period/value/
 *             defVersion/runId/sourceType/observedAt ＋ 可选 unit/sourceId/evidenceRef）
 *   @output   `{ written, duplicate }` —— 新行 `{written:true, duplicate:false}`；
 *             同四键已存在 ⇒ `{written:false, duplicate:true}`（**不覆盖**首行）
 *   @error    `MetricObservationError`：
 *             `VALIDATION`（phase=validate, retryable=false, field 点名首个违约字段）—— 校验在 INSERT **之前**，
 *             违约时**零写入**；`WRITE_FAILED`（phase=persist, retryable=true）—— 存储层失败，**抛错不降级**
 *   @invariant ① 唯一键 = `(org_id, object_id, metric_id, period)`，**`run_id` 不入唯一键**
 *              （同周期重跑（runId 变）仍是幂等重复，不产生第二行）；
 *              ② `objectId` 禁止 `'*'`；`period` 由**调用方显式传入**（本模块不以 `now()` 推导、
 *              也不用 `observed_at` 顶替）；`value === null` ⇒ 写 NULL（**禁止 0 冒充**）；
 *              ③ 只追加（本模块无 UPDATE/DELETE）
 *   @not-here 不做读取（读侧 = `metric-observations-reader.ts`）；不接哨兵/流程（T2/T3 另票）；
 *             不碰旧表 `metric_readings`；不做跨请求缓存
 *
 * 铁律: 32（.code/.phase/.retryable）/ 38（零不安全断言）/ 39（L3 洞察层，仅经类型依赖 L5 语义）
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';
import { checkFiniteInputs, checkRequiredFields } from './assert-finite-inputs';

const log = createLogger('sentinel/metric-observations-writer');

// ═══ source_type 取值域（与迁移 007 的列 CHECK 逐值对齐）═══
// 注：用「数组 + 派生类型」而非单行 `A | B | C` 字面量联合 —— 单行形态会误命中
// `check-file-driven.sh` 的"硬编码本体类型回归"正则（本域是 DB 列取值域，不是本体类型；
// 同 `metric-readings-writer.ts` 的既有规避方式）。
export const METRIC_OBSERVATION_SOURCE_TYPES = ['compute', '42edge', 'manual', 'connector'] as const;

/** `source_type` 取值域（由常量派生，避免第二份手写字面量） */
export type MetricObservationSourceType = (typeof METRIC_OBSERVATION_SOURCE_TYPES)[number];

/** 新链错误码（铁律 32：调用方可区分「键非法」与「存储失败」） */
export type MetricObservationErrorCode = 'VALIDATION' | 'WRITE_FAILED' | 'READ_FAILED';

/** 新链 typed error —— **严格链唯一的失败出口**（不静默、不降级） */
export class MetricObservationError extends Error {
  readonly code: MetricObservationErrorCode;
  readonly phase: 'validate' | 'persist' | 'read';
  readonly retryable: boolean;
  /** 违约字段（仅 VALIDATION 有；便于日志/调用方定位） */
  readonly field: string | undefined;

  constructor(
    code: MetricObservationErrorCode,
    message: string,
    options: { phase: 'validate' | 'persist' | 'read'; retryable: boolean; field?: string },
  ) {
    super(message);
    this.name = 'MetricObservationError';
    this.code = code;
    this.phase = options.phase;
    this.retryable = options.retryable;
    this.field = options.field;
  }
}

/** 四键 —— 唯一键的组成部分（v2 §3：`(org_id, object_id, metric_id, period)`） */
export interface MetricObservationKey {
  orgId: string;
  objectId: string;
  metricId: string;
  /** 周期，由**调用方显式传入**（禁 `now()` 推导、禁用 `observed_at` 顶替） */
  period: string;
}

/** 写入一行观测所需的最小信息（严格链：全部必填键齐备才允许落库） */
export interface MetricObservationInput extends MetricObservationKey {
  /** `null` = 值缺失（落 NULL）；**禁止**用 0 冒充缺失 */
  value: number | null;
  defVersion: string;
  runId: string;
  sourceType: MetricObservationSourceType;
  /** 观测时间（必填；**不得**用写入时间 `created_at` 冒充） */
  observedAt: string;
  unit?: string;
  sourceId?: string;
  evidenceRef?: string;
}

export interface MetricObservationWriteResult {
  /** 真正插入了一行 */
  written: boolean;
  /** 同四键已存在 ⇒ true（幂等 no-op，不覆盖首行） */
  duplicate: boolean;
}

/** 必填字符串键（`value` 不在内：它允许 `null` = 缺失） */
const REQUIRED_STRING_FIELDS = ['orgId', 'objectId', 'metricId', 'period', 'defVersion', 'runId', 'observedAt'] as const;

function validationError(field: string, message: string): MetricObservationError {
  return new MetricObservationError('VALIDATION', message, { phase: 'validate', retryable: false, field });
}

/**
 * 四键校验（写/读两侧共用同一判据）：非空字符串、`objectId !== '*'`、`period` 非空。
 * @throws MetricObservationError(VALIDATION) —— 首个违约字段
 */
export function assertMetricObservationKey(key: MetricObservationKey): void {
  const missing = checkRequiredFields(key, ['orgId', 'objectId', 'metricId', 'period']);
  if (missing.length > 0) {
    throw validationError('key', `缺必填键: ${missing.join('; ')}`);
  }
  for (const field of ['orgId', 'objectId', 'metricId', 'period'] as const) {
    const value = key[field];
    if (typeof value !== 'string' || value === '') {
      throw validationError(field, `${field} 必须是非空字符串（实得 ${JSON.stringify(value)}）`);
    }
  }
  if (key.objectId === '*') {
    throw validationError('objectId', "objectId 禁止 '*' —— 唯一键必须指向具体对象（v2 §2.5）");
  }
}

/**
 * 完整写入输入校验（**在 INSERT 之前**跑 ⇒ 违约时零写入）。
 * @throws MetricObservationError(VALIDATION)
 */
export function assertMetricObservationInput(input: MetricObservationInput): void {
  assertMetricObservationKey(input);

  const missing = checkRequiredFields(input, ['defVersion', 'runId', 'observedAt', 'sourceType']);
  if (missing.length > 0) {
    throw validationError('input', `缺必填键: ${missing.join('; ')}`);
  }
  for (const field of ['defVersion', 'runId', 'observedAt'] as const) {
    const value = input[field];
    if (typeof value !== 'string' || value === '') {
      throw validationError(field, `${field} 必须是非空字符串（实得 ${JSON.stringify(value)}）`);
    }
  }
  if (!METRIC_OBSERVATION_SOURCE_TYPES.includes(input.sourceType)) {
    throw validationError(
      'sourceType',
      `sourceType 不在取值域 [${METRIC_OBSERVATION_SOURCE_TYPES.join(', ')}]（实得 ${JSON.stringify(input.sourceType)}）`,
    );
  }
  // `value === null` 是**合法缺失**；只有"给了值"时才要求有限数（NaN/Infinity 不落库，#1408 同族）
  if (input.value !== null) {
    const issues = checkFiniteInputs({ value: input.value }, ['value']);
    if (issues.length > 0) {
      throw validationError('value', `value 必须为有限数或 null（${issues.join('; ')}）`);
    }
  }
}

const INSERT_SQL = `INSERT INTO metric_observations (
  org_id, object_id, metric_id, period, value, unit, def_version, run_id,
  source_type, source_id, evidence_ref, observed_at
) VALUES (
  @orgId, @objectId, @metricId, @period, @value, @unit, @defVersion, @runId,
  @sourceType, @sourceId, @evidenceRef, @observedAt
) ON CONFLICT(org_id, object_id, metric_id, period) DO NOTHING`;

/**
 * 写一行指标观测（**严格链**：校验失败/存储失败一律抛错，绝不返回"假成功"）。
 *
 * @input  db（迁移 007 已建表）；input（见 `MetricObservationInput`）
 * @output `{ written, duplicate }`；同四键已存在 ⇒ `{written:false, duplicate:true}`（不覆盖）
 * @error  `MetricObservationError(VALIDATION)`（零写入）／`MetricObservationError(WRITE_FAILED)`（存储失败）
 */
export function writeMetricObservation(
  db: Database.Database,
  input: MetricObservationInput,
): MetricObservationWriteResult {
  assertMetricObservationInput(input);

  try {
    const info = db.prepare(INSERT_SQL).run({
      orgId: input.orgId,
      objectId: input.objectId,
      metricId: input.metricId,
      period: input.period,
      value: input.value,
      unit: input.unit ?? null,
      defVersion: input.defVersion,
      runId: input.runId,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      evidenceRef: input.evidenceRef ?? null,
      observedAt: input.observedAt,
    });
    const written = info.changes > 0;
    if (!written) {
      log.info(
        { orgId: input.orgId, objectId: input.objectId, metricId: input.metricId, period: input.period },
        '同四键已存在 ⇒ 幂等跳过（不覆盖首行；run_id 不在唯一键内）',
      );
    }
    return { written, duplicate: !written };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { err: message, orgId: input.orgId, objectId: input.objectId, metricId: input.metricId, period: input.period },
      '指标观测写入失败 —— 严格链：抛错，不降级',
    );
    throw new MetricObservationError('WRITE_FAILED', `metric_observations 写入失败: ${message}`, {
      phase: 'persist',
      retryable: true,
    });
  }
}
