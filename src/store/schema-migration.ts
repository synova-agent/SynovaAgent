/**
 * store/schema-migration.ts — Schema 版本化迁移 (Phase 3.2)
 *
 * 提供 reconcileSchema 函数，统一管理 SQLite 数据库 schema 变更。
 * 迁移文件命名: src/store/migrations/00N-*.ts
 *
 * 铁律 24: 降级路径有 log.warn
 * 铁律 38: 纯类型安全
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';
import { graphNodesPropsMigration } from './migrations/001-graph-nodes-props';
import { metricReadingsMigration } from './migrations/002-metric-readings';

const log = createLogger('store/schema-migration');

// ═══ 常量 ═══

/** 当前 schema 版本。每次新增迁移文件时递增。 */
export const SCHEMA_VERSION = 3;

// ═══ Migration 定义 ═══

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * 已注册的迁移列表。
 * 按版本号顺序执行。
 */
const migrations: Migration[] = [
  // D355: 旧库 graph_nodes 以 props_json 存储属性 → 补 props 列并回填（K3 P0-3）
  graphNodesPropsMigration,
  // #1053（2-1a）: 承重件 W1 —— 测量值时序表 metric_readings（17 列 + 3 索引）
  metricReadingsMigration,
];

// ═══ reconcileSchema ═══

/**
 * 协调 schema 版本。
 * 1. 创建 schema_version 表（如果不存在）
 * 2. 读取当前版本
 * 3. 顺序执行所有缺少的迁移
 * 4. 更新版本号
 *
 * 幂等：重复调用安全。
 */
export function reconcileSchema(db: Database.Database): void {
  // 创建 schema_version 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 读取当前版本
  const row = db.prepare('SELECT version FROM schema_version ORDER BY updated_at DESC LIMIT 1').get() as
    { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion >= SCHEMA_VERSION) {
    log.debug({ currentVersion, schemaVersion: SCHEMA_VERSION }, 'Schema 已是最新');
    return;
  }

  // 按版本顺序执行迁移
  const pending = migrations.filter(m => m.version > currentVersion && m.version <= SCHEMA_VERSION);
  if (pending.length === 0) {
    // 没有迁移文件，仅更新版本号
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    log.info({ schemaVersion: SCHEMA_VERSION }, 'Schema 版本已初始化');
    return;
  }

  for (const migration of pending) {
    try {
      log.info({ version: migration.version, name: migration.name }, `执行迁移 ${migration.version}: ${migration.name}`);
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
      log.info({ version: migration.version }, `迁移 ${migration.version} 完成`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg, version: migration.version }, `迁移 ${migration.version} 失败`);
      throw err; // 迁移失败必须阻止启动
    }
  }
}
