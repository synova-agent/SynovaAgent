/**
 * engine-context.ts — engine-core 初始化注入
 *
 * 设置 SQLite 数据库 + 注入 EngineContext + 设置 StorageBackend。
 * engine-core 的所有模块依赖这些基础设施。
 */
import Database from 'better-sqlite3';
// setEngineContext 已随 engine-core 弃用 — 引擎上下文由 initEngineContext 直接管理
import { createLogger } from '@synova/logger';
import { loadConfig } from '../config';
import { SqliteStorageBackend } from '../store/storage-backend';
import { reconcileSchema } from '../store/schema-migration';
import * as path from 'path';
import * as fs from 'fs';

const log = createLogger('init/engine-context');

let db: Database.Database | null = null;
let _initialized = false;

// ═══ WAL 降级 (Phase 0.2) ═══

/**
 * 启用 SQLite WAL 模式，NFS/SMB 不可用时降级 DELETE 模式。
 * 这是 engine-context 的内联版本，接收 Database.Database 类型。
 *
 * @param database - better-sqlite3 Database 实例
 * @param dbPath - 数据库路径（用于日志）
 */
function enableWAL(database: Database.Database, dbPath: string): void {
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "数据库连接初始化");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('locking protocol') || msg.includes('not authorized')) {
      log.warn({ path: dbPath, err: msg }, 'WAL 不可用(可能是网络文件系统) — 降级 DELETE 模式. 并发性能会降低.');
      try {
        database.pragma('journal_mode = DELETE');
      } catch {
        log.warn({ path: dbPath }, 'DELETE 模式也失败 — 使用 SQLite 默认日志模式');
      }
    } else {
      throw err;
    }
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('数据库未初始化，请先调用 initEngineContext()');
  return db;
}

// ═══ D1143 W1: 测量值时序 (metric_readings) ═══
//
// 为什么需要这张表: 方向监测要回答"上次判错多少"，前提是**同一 (entity, metric) 有 ≥2 个
// 时间点读数**——单点快照无法区分"真偏离"与"该指标本来就在波动"。参数标定同理：
// 先有时序，才有无数据可标的落点（硬顺序: 时序存储 → 参数标定）。

/** 一条测量值读数（结构上兼容 loops 侧 MetricReading，不反向依赖 L3） */
export interface MetricSeriesPoint {
  value: number;
  /** ISO-8601 观测时刻 */
  observedAt: string;
}

/** 写一条测量值读数的入参 */
export interface MetricReadingInput {
  entityId: string;
  metric: string;
  value: number;
  /** ISO-8601 观测时刻 */
  observedAt: string;
  /** 该读数的测量不确定度（可选） */
  uncertainty?: number;
  /** 数据来源标签（可选，可追溯） */
  source?: string;
}

/** metric_readings 表 + 索引 DDL（幂等） */
const METRIC_READINGS_DDL = `
  CREATE TABLE IF NOT EXISTS metric_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    uncertainty REAL,
    observed_at TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_metric_readings_em
    ON metric_readings(entity_id, metric, observed_at);
`;

/**
 * 建测量值时序表（幂等）。
 *
 * @input  — better-sqlite3 Database（任意句柄，含测试内存库）
 * @output — metric_readings 表 + idx_metric_readings_em 索引就位
 * @degraded — 建表失败 → 抛错由调用方判定（initEngineContext 内 log.warn；测试直接暴露）
 */
export function ensureMetricReadingsTable(database: Database.Database): void {
  database.exec(METRIC_READINGS_DDL);
}

/**
 * 写一条测量值读数。
 *
 * @input  — entityId + metric + value + observedAt [+ uncertainty + source]
 * @output — 落库 1 行
 * @degraded — 库不可写/表缺失 → 抛错（写入失败必须可见，不静默吞）
 */
export function recordMetricReading(
  database: Database.Database,
  input: MetricReadingInput,
): void {
  database
    .prepare(
      `INSERT INTO metric_readings (entity_id, metric, value, uncertainty, observed_at, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.entityId,
      input.metric,
      input.value,
      input.uncertainty ?? null,
      input.observedAt,
      input.source ?? null,
    );
}

/** 把一行 SQLite 结果收敛成读数（坏行丢弃，不让 unknown 渗进业务） */
function toMetricSeriesPoint(row: unknown): MetricSeriesPoint | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as { value?: unknown; observed_at?: unknown };
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  if (typeof r.observed_at !== 'string' || r.observed_at.length === 0) return null;
  return { value: r.value, observedAt: r.observed_at };
}

/**
 * 读同一 (entity, metric) 的测量值时序。
 *
 * 取**最近** limit 条，再按 observedAt 升序返回（时序语义：旧 → 新）。
 *
 * **metric 键大小写不敏感**（D1143 独立复核 P1-2 修复）：写入方按本体口径可能写
 * `CAPITAL_ACQUISITION`，而消费方（方向监测）按分类表小写键读 —— 若按大小写精确匹配，
 * 这种不一致会**静默返回 0 行且零告警**，整条时序能力悄悄失效。故此处统一按
 * `lower(metric)` 匹配，两侧任一写法都能命中。
 *
 * @input  — entityId + metric [+ limit，默认 90]
 * @output — MetricSeriesPoint[]（无数据 → 空数组）
 * @degraded — 表缺失/查询失败 → 抛错由调用方处理（loops 侧按"无时序"降级 + 告警）
 */
export function readMetricSeries(
  database: Database.Database,
  entityId: string,
  metric: string,
  limit = 90,
): MetricSeriesPoint[] {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 90;
  const rows = database
    .prepare(
      `SELECT value, observed_at FROM (
         SELECT value, observed_at, id FROM metric_readings
         WHERE entity_id = ? AND lower(metric) = lower(?)
         ORDER BY observed_at DESC, id DESC
         LIMIT ?
       ) ORDER BY observed_at ASC, id ASC`,
    )
    .all(entityId, metric, safeLimit);

  const points: MetricSeriesPoint[] = [];
  for (const row of rows) {
    const point = toMetricSeriesPoint(row);
    if (point) points.push(point);
  }
  return points;
}

/**
 * 构造绑定了库句柄的时序读取器（供 DirectionMonitor 注入）。
 *
 * @input  — better-sqlite3 Database
 * @output — { readSeries(entityId, metric, limit?) }，结构上兼容 loops 侧 MetricSeriesReader
 * @degraded — 读失败 → 抛错；由 DirectionMonitor.readMetricSeries 捕获并降级为空序列 + 告警
 */
export function createMetricSeriesReader(database: Database.Database): {
  readSeries(entityId: string, metric: string, limit?: number): MetricSeriesPoint[];
} {
  return {
    readSeries: (entityId: string, metric: string, limit?: number) =>
      readMetricSeries(database, entityId, metric, limit),
  };
}

export function initEngineContext(): void {
  // 幂等：SynovaAgent.start() 和 createServer() 都可能调用
  if (_initialized) return;
  const config = loadConfig();

  // 1. 初始化 SQLite
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.dbPath);
  // Phase 0.2: WAL 降级 — NFS/SMB 不可用时自动回退 DELETE
  enableWAL(db, config.dbPath);
  db.pragma('foreign_keys = ON');

  // Week 4: D3 哨兵数据采集表
  db.exec(`
    CREATE TABLE IF NOT EXISTS collaboration_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('hitl_correction','auto_accept','agent_to_agent','routing_decision','task_completed','task_failed','team_change','permission_change')),
      source_agent_id TEXT,
      target_agent_id TEXT,
      outcome TEXT,
      human_intervention INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      gap_dimension TEXT,
      mode_used TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_collab_events_type ON collaboration_events(event_type, created_at);

    CREATE TABLE IF NOT EXISTS routing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_agent_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      route_count INTEGER NOT NULL DEFAULT 1,
      dependency_concentration REAL DEFAULT 0,
      risk_level TEXT CHECK(risk_level IN ('critical','high','moderate','low')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_routing_events_src ON routing_events(source_agent_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tasks_completed INTEGER NOT NULL DEFAULT 0,
      tasks_failed INTEGER NOT NULL DEFAULT 0,
      auto_accept_count INTEGER NOT NULL DEFAULT 0,
      correction_count INTEGER NOT NULL DEFAULT 0,
      health_score REAL DEFAULT 0.7,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_aid ON agent_metrics(agent_id, recorded_at);

    CREATE TABLE IF NOT EXISTS agent_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      permission_scope TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_contracts_aid ON agent_contracts(agent_id, is_active);

    CREATE TABLE IF NOT EXISTS team_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_type TEXT NOT NULL CHECK(change_type IN ('add_role','remove_role','add_agent','remove_agent','permission_grant','permission_revoke')),
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('agent','person','team','permission')),
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_team_changes_type ON team_changes(change_type, created_at);
  `);

  // D1143 W1: 测量值时序表（幂等）+ 表/索引就位
  try {
    ensureMetricReadingsTable(db);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, 'metric_readings 建表失败 — degraded（时序能力不可用）');
  }

  // Phase 4.4: Schema 版本化迁移（必须在任何 query 前执行）
  try {
    reconcileSchema(db);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, 'Schema 迁移失败 — degraded');
  }

  log.info({ path: config.dbPath }, 'SQLite 数据库已打开');

  // 2. 注入 EngineContext。pino child() 返回类型与 AppLogger 的递归类型不兼容 — 运行时兼容。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engineCtx = {
    database: { getDb: () => db! },
    logger: {
      trace: (...args: any[]) => log.debug({ args }, args.length > 1 ? args[1] : 'trace'),
      debug: (...args: any[]) => log.debug(args.length > 1 ? args[1] : {}, args[0]),
      info: (...args: any[]) => log.info(args.length > 1 ? args[1] : {}, args[0]),
      warn: (...args: any[]) => log.warn(args.length > 1 ? args[1] : {}, args[0]),
      error: (...args: any[]) => log.error(args.length > 1 ? args[1] : {}, args[0]),
      fatal: (...args: any[]) => log.error(args.length > 1 ? args[1] : {}, `[FATAL] ${args[0]}`),
      child: (_bindings: Record<string, unknown>) => createLogger('engine-context-child'),
      level: process.env.LOG_LEVEL || 'info',
    },
  };
  // pino child() 返回类型与旧 AppLogger 递归类型不兼容 — 运行时兼容
  // D10: engine-core 弃用 — 引擎上下文不再注入

  // 3. 设置存储后端 (Slice 2.2: SQLite 持久化替换内存模式)
  const storageBackend = new SqliteStorageBackend(db!);
  _initialized = true;
  log.info('EngineContext 注入完成 (SQLite 持久化存储模式)');
}

/** 关闭数据库连接 */
export function closeEngineContext(): void {
  if (db) {
    db.close();
    db = null;
    log.info('数据库已关闭');
  }
}
