/**
 * sentinel/metric-readings-reader.ts — ④a 测量值时序**读回**面（E5 / #389 G5）
 *
 * 为什么现在存在：E5 边（③→④a）此前"只写不读"——表建了（#1053）、写点接了（#1054 轮次级+1 样板指标级），
 * 但全仓零业务读者（07 号件边表 E5 🔴 单向）。本模块给出读侧原语；业务消费面 =
 *   ① `GET /api/sentinel/metrics/readings`（GA/前端查趋势）
 *   ② 周报 boss-mailbox 的"测量值"段（⑤ 交付读 ④a）
 *
 * 标定供数口径（CTO 2026-10-08 裁 A3，写死为 SQL 可判形态）：
 *   **默认排除轮次级**（`metric_id NOT LIKE 'SENTINEL-%'`）——轮次级不作标定供数；
 *   需要轮次级时显式传 `includeRound: true`（查询面自证口径，不靠文字约定）。
 *
 * 契约（铁律 47）:
 *   @input  db（better-sqlite3 Database；表由 reconcileSchema 建）＋ { orgId?, days?, limit?, metricId?, includeRound? }
 *   @output ok=true ⇒ rows/summary（空是合法业务态："还没落过行"）；ok=false ⇒ errors 在场（禁静默）
 *   @degraded 表不存在（未迁移）/查询异常 ⇒ ok=false + errors（不静默空数组）
 *   @not-here 不做写入（写侧在 metric-readings-writer，单一写入口不变）；不做标定（2-2/2-7）
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/metric-readings-reader');

/** 读回查询入参 */
export interface MetricReadingsQuery {
  orgId?: string;
  /** 回看天数（缺省 7） */
  days?: number;
  /** 最大行数（缺省 500） */
  limit?: number;
  /** 按指标过滤（精确匹配） */
  metricId?: string;
  /** 显式包含轮次级（SENTINEL-*；缺省排除——标定供数口径） */
  includeRound?: boolean;
}

/** 一行读回（列名与 002-metric-readings 迁移真表一致，值类型收窄） */
export interface MetricReadingRow {
  org_id: string;
  metric_id: string;
  entity_id: string;
  observed_at: string;
  value: number;
  unit: string | null;
  source_type: string;
  is_estimated: number;
  confidence: string;
  degraded: number;
}

/** 读回结果 —— ok=false 时 errors 必在场 */
export interface MetricReadingsReadResult {
  ok: boolean;
  rows: MetricReadingRow[];
  errors?: string[];
}

/** 按指标聚合的趋势摘要（周报/前端消费形态） */
export interface MetricTrendSummary {
  metricId: string;
  entityId: string;
  unit: string | null;
  count: number;
  latestAt: string;
  latestValue: number | null;
  previousValue: number | null;
  /** (latest - previous) / |previous|；previous 缺席/为零 ⇒ null（不假装可算） */
  changeRatio: number | null;
}

export interface MetricTrendsReadResult {
  ok: boolean;
  summary: MetricTrendSummary[];
  errors?: string[];
}

function buildWhere(q: MetricReadingsQuery): { sql: string; params: unknown[] } {
  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  if (!q.includeRound) conds.push(`metric_id NOT LIKE 'SENTINEL-%'`);
  if (q.orgId !== undefined && q.orgId !== '') { conds.push('org_id = ?'); params.push(q.orgId); }
  if (q.metricId !== undefined && q.metricId !== '') { conds.push('metric_id = ?'); params.push(q.metricId); }
  const days = typeof q.days === 'number' && q.days > 0 ? q.days : 7;
  conds.push(`observed_at >= datetime('now', ?)`);
  params.push(`-${days} days`);
  return { sql: conds.join(' AND '), params };
}

function tableMissing(db: Database.Database): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='metric_readings'",
  ).get() as { name?: string } | undefined;
  return row === undefined;
}

/**
 * 读回测量值行（observed_at 倒序）。
 * @degraded 表不存在（#22 观测面：真库未迁移）⇒ ok=false + errors=['TABLE_MISSING…']——不静默空
 */
export function listRecentReadings(db: unknown, query: MetricReadingsQuery = {}): MetricReadingsReadResult {
  if (db === null || typeof db !== 'object' || typeof (db as Database.Database).prepare !== 'function') {
    const message = 'READ_PRIMITIVE_MISSING: db 无 prepare 原语 — 测量值读回不可用（不静默返回空）';
    log.warn(message);
    return { ok: false, rows: [], errors: [message] };
  }
  const realDb = db as Database.Database;
  try {
    if (tableMissing(realDb)) {
      const message = 'TABLE_MISSING: 真库无 metric_readings 表（未迁移？#22 同面）— 读回不可用';
      log.warn(message);
      return { ok: false, rows: [], errors: [message] };
    }
    const where = buildWhere(query);
    const limit = typeof query.limit === 'number' && query.limit > 0 ? query.limit : 500;
    const rows = realDb.prepare(
      `SELECT org_id, metric_id, entity_id, observed_at, value, unit, source_type, is_estimated, confidence, degraded
       FROM metric_readings WHERE ${where.sql}
       ORDER BY observed_at DESC LIMIT ?`,
    ).all(...where.params, limit) as unknown as MetricReadingRow[];
    return { ok: true, rows };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, '测量值读回失败 — 显式降级');
    return { ok: false, rows: [], errors: [`QUERY_FAILED: ${msg}`] };
  }
}

/**
 * 按指标聚合趋势（每 metric×entity：最新值/上一次值/变化率）。
 * 同标定供数口径：缺省排除轮次级。
 */
export function summarizeMetricTrends(db: unknown, query: MetricReadingsQuery = {}): MetricTrendsReadResult {
  const read = listRecentReadings(db, { ...query, limit: 5000 });
  if (!read.ok) return { ok: false, summary: [], errors: read.errors };
  type Key = string;
  const groups = new Map<Key, MetricReadingRow[]>();
  for (const row of read.rows) {
    const key = `${row.metric_id}::${row.entity_id}`;
    const list = groups.get(key);
    if (list) list.push(row); else groups.set(key, [row]);
  }
  const summary: MetricTrendSummary[] = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1)); // 倒序：最新在前
    const latest = rows[0];
    const previous = rows[1];
    const [metricId, entityId] = key.split('::');
    const changeRatio =
      previous !== undefined && previous.value !== 0
        ? (latest.value - previous.value) / Math.abs(previous.value)
        : null;
    summary.push({
      metricId, entityId,
      unit: latest.unit ?? null,
      count: rows.length,
      latestAt: latest.observed_at,
      latestValue: latest.value,
      previousValue: previous?.value ?? null,
      changeRatio,
    });
  }
  summary.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
  return { ok: true, summary };
}
