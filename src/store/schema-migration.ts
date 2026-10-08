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
import { orgsMigration } from './migrations/003-orgs';

const log = createLogger('store/schema-migration');

// ═══ 常量 ═══

/** 当前 schema 版本。每次新增迁移文件时递增。 */
export const SCHEMA_VERSION = 4;

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
  // #1371: 租户注册表 orgs（cron org 维度的唯一真源；CTO 2026-10-08 裁）
  orgsMigration,
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

  // 读取当前版本（#1366）：
  //   ① **取 MAX 而非 `ORDER BY updated_at DESC LIMIT 1`** —— 后者在**同秒并列**（SQLite 无确定序）时
  //      会取到**旧**行 ⇒ `currentVersion < SCHEMA_VERSION` ⇒ 最后一条迁移被**重复执行**
  //      （实测：新库插入 2/3 两行同秒 ⇒ reader 返回 2；二次 reconcile ⇒ schema_version 追加一行）。
  //   ② **只认数值行**：同表还存**字符串 tag**（`'d93b_actor_role'` / `'d551_target_type'` /
  //      `'k6_confirm_decision'` / `'d551_memory_type'`，由 feedback-collector / agent-memory-store 写入；
  //      列声明 `INTEGER NOT NULL` 在 SQLite 无强制 ⇒ 实际存为 TEXT）⇒ 旧写法 `as { version: number }`
  //      是**单方面断言**：字符串混入后 `currentVersion >= SCHEMA_VERSION` 退化为 NaN 比较（恒 false）
  //      ⇒ 走"无待执行迁移 ⇒ 只插版本号"分支 ⇒ 每次启动都追加一行（实测已复现）。
  //   ③ 第二层防御：JS 侧数值守卫（非数值 ⇒ 视为 0），与 SQL 侧 `typeof(version)='integer'` 双保险。
  //
  // 🔴 **写入侧不动（两侧一起定后的结论，不是遗漏）**：
  //   · `MAX(数值)` 对"多行 / 同秒并列"天然免疫 ⇒ **写侧无需改动**即可修正上述两处；
  //   · 保留"逐迁移一行"（`:75` 初始化路径 + `:84` 每迁移一行）⇒ **保留可审计历史**（哪次跑过哪些迁移）；
  //   · 反向验证（本卡反例 M3）：**只改写侧**（例如"循环结束后只插一次最终版本"）在**既有库**上
  //     （已含同秒多行 `[2,3]`）**仍会读旧行** ⇒ 证明读侧才是必要修复；
  //   · 且"只插最终版本"**不能**解决字符串 tag 面（更晚写入的 tag 仍会是"最新行"）⇒ 读侧守卫必要。
  const row = db.prepare(
    "SELECT MAX(version) AS maxVersion FROM schema_version WHERE typeof(version) = 'integer'",
  ).get() as { maxVersion: number | null } | undefined;
  const currentVersion = typeof row?.maxVersion === 'number' ? row.maxVersion : 0;

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
