/**
 * sentinel/metric-observations-reader.ts — 指标观测**按四键读回**（#1431 / 阶段 2 · T1）
 *
 * 依据（逐条可核）:
 *   · DEV DOC v2（Issue #1431 评论 13555）§4 写集 ＋ §7 验收 5（两用户同企业读同一 `id`；跨 org 为空）；
 *   · CTO 放行（评论 13556）：只放行 T1；旧链 `metric-readings-reader.ts` **零改动**。
 *
 * 覆盖面（本卡边界，逐字）:
 *   **只做"四键精确读回"一个原语**（`(orgId, objectId, metricId, period)` ⇒ 单行或 null）。
 *   趋势/聚合/时间窗/多对象列表**不在本卡**（v2 §6：T2/T3 另票）。
 *
 * 契约（铁律 47）:
 *   @input    db —— better-sqlite3 Database（表须已由 `reconcileSchema` 建好，迁移 007）；
 *             key —— `MetricObservationKey`（四键，由调用方显式传入）
 *   @output   命中 ⇒ `MetricObservationRow`（列名 = 迁移 007 真列名）；未命中 ⇒ `null`
 *   @error    `MetricObservationError`：`VALIDATION`（四键非法/`objectId === '*'`/`period === ''`，
 *             phase=validate, retryable=false）；`READ_FAILED`（表缺失/查询失败，phase=read, retryable=true）——
 *             **不静默返回空**（"查不到"与"查不了"必须可区分）
 *   @invariant 读侧与写侧共用同一四键判据（`assertMetricObservationKey`，来自 writer 单一实现）；
 *             身份字段是 **`orgId`**（不是 `enterpriseId`）；只 select，不写
 *   @not-here 不做写入（写侧 = `metric-observations-writer.ts`）；不做聚合/趋势；不做缓存
 *
 * 铁律: 32（.code/.phase/.retryable）/ 38（零不安全断言）/ 39（L3 洞察层，仅经类型依赖 L5 语义）
 */
import type Database from 'better-sqlite3';
import {
  MetricObservationError,
  assertMetricObservationKey,
  type MetricObservationKey,
  type MetricObservationSourceType,
} from './metric-observations-writer';

/** 读回一行（列名与迁移 007 真表一致；`value` 可空 = 缺失） */
export interface MetricObservationRow {
  id: number;
  org_id: string;
  object_id: string;
  metric_id: string;
  period: string;
  value: number | null;
  unit: string | null;
  def_version: string;
  run_id: string;
  source_type: MetricObservationSourceType;
  source_id: string | null;
  evidence_ref: string | null;
  observed_at: string;
  degraded: number;
  created_at: string;
}

const SELECT_SQL = `SELECT
  id, org_id, object_id, metric_id, period, value, unit, def_version, run_id,
  source_type, source_id, evidence_ref, observed_at, degraded, created_at
FROM metric_observations
WHERE org_id = @orgId
  AND object_id = @objectId
  AND metric_id = @metricId
  AND period = @period
LIMIT 1`;

/**
 * 按四键读回一行观测（唯一键查 ⇒ 最多一行）。
 *
 * @input  db（迁移 007 已建表）；key（四键）
 * @output 命中 ⇒ 行；未命中 ⇒ `null`（"还没落过行"是合法业务态）
 * @error  `VALIDATION`（键非法）／`READ_FAILED`（表缺失或查询失败 —— 不静默空）
 */
export function getMetricObservation(
  db: Database.Database,
  key: MetricObservationKey,
): MetricObservationRow | null {
  assertMetricObservationKey(key);

  try {
    const row = db.prepare(SELECT_SQL).get({
      orgId: key.orgId,
      objectId: key.objectId,
      metricId: key.metricId,
      period: key.period,
    }) as MetricObservationRow | undefined;
    return row ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MetricObservationError('READ_FAILED', `metric_observations 读回失败: ${message}`, {
      phase: 'read',
      retryable: true,
    });
  }
}
