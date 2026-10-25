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

  // Phase 4.4: Schema 版本化迁移（必须在任何 query 前执行）
  // #964 Q-8（裁 395）：迁移/版本门禁失败 **必须拒启**（原实现 catch → log.warn 后继续，
  //   ⇒ "库版本高于构建即拒"在进程级不成立）。Phase 0 为 `fatal: true`（src/deploy/bootstrap.ts），
  //   本函数抛错 ⇒ 启动中止。回滚开关 `SYNO_SCHEMA_STRICT=0` ⇒ 退回旧 warn+degraded 语义。
  try {
    reconcileSchema(db);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.SYNO_SCHEMA_STRICT === '0') {
      log.warn({ err: msg, degraded: true, code: 'SCHEMA_RECONCILE_DEGRADED' }, 'Schema 迁移失败 — degraded（SYNO_SCHEMA_STRICT=0 回滚态）');
    } else {
      // 先释放已开连接再抛（不留半开句柄），由启动入口按 Phase 0 fatal 处理
      db?.close();
      db = null;
      log.error({ err: msg }, 'Schema 迁移/版本门禁失败 — 拒绝启动（Phase 0 fatal）');
      throw err;
    }
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
