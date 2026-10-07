/**
 * tests/store/schema-migration.test.ts — Phase 3.2 Schema 迁移测试
 *
 * 铁律 33: *.test.ts 单元测试 (使用 :memory: SQLite)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

let reconcileSchema: any;
let SCHEMA_VERSION: number;

async function loadModules() {
  const mod = await import('../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
  SCHEMA_VERSION = mod.SCHEMA_VERSION;
}

function createTestDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

describe('SchemaMigration — 初始化', () => {
  beforeEach(async () => { await loadModules(); });

  it('SCHEMA_VERSION 应 >= 1', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('reconcileSchema 应创建 schema_version 表', () => {
    const db = createTestDb();
    reconcileSchema(db);

    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").all();
    expect(rows).toHaveLength(1);
  });

  it('首次调用应写入版本号', () => {
    const db = createTestDb();
    reconcileSchema(db);

    const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>;
    // ⚠️ #1053 起迁移 ≥2 条 ⇒ schema_version 每次迁移插一行；首行不再等于最新版本
    //   （且同秒写入时 `ORDER BY updated_at DESC` 无法区分 ⇒ 详见 #1053 回执的"读取器并列"发现）
    expect(rows.map(r => r.version)).toContain(SCHEMA_VERSION);
    expect(Math.max(...rows.map(r => r.version))).toBe(SCHEMA_VERSION);
  });
});

describe('SchemaMigration — 幂等', () => {
  beforeEach(async () => { await loadModules(); });

  it('重复调用不应报错', () => {
    const db = createTestDb();
    reconcileSchema(db);
    reconcileSchema(db);

    const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>;
    expect(Math.max(...rows.map(r => r.version))).toBe(SCHEMA_VERSION);
  });

  it('已有 schema_version 表应跳过创建', () => {
    const db = createTestDb();
    db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    db.prepare('INSERT INTO schema_version (version, updated_at) VALUES (?, datetime(\'now\'))').run(SCHEMA_VERSION);

    reconcileSchema(db);

    const row = db.prepare('SELECT version FROM schema_version').get() as any;
    expect(row.version).toBe(SCHEMA_VERSION);
  });
});

describe('SchemaMigration — v2 迁移 (D355 graph_nodes props)', () => {
  beforeEach(async () => { await loadModules(); });

  it('SCHEMA_VERSION 应为 3（含 D355 + #1053 metric_readings 迁移）', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('旧库（props_json 无 props）reconcile 后补 props 列并回填数据', () => {
    const db = createTestDb();
    db.exec(`
      CREATE TABLE graph_nodes (
        id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL, name TEXT,
        props_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT
      )
    `);
    db.prepare("INSERT INTO graph_nodes (id, type, props_json) VALUES ('n1', 'Client', ?)").run('{"churn_rate":0.12}');

    reconcileSchema(db);

    const props = (db.prepare("SELECT props FROM graph_nodes WHERE id = 'n1'").get() as { props: string }).props;
    expect(JSON.parse(props)).toEqual({ churn_rate: 0.12 });
  });

  it('schema_version 已到 v1 的库增量执行 v2 并推进版本', () => {
    const db = createTestDb();
    db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
    db.exec(`
      CREATE TABLE graph_nodes (
        id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL, name TEXT,
        props_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT
      )
    `);

    reconcileSchema(db);

    const versions = (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>).map((r) => r.version);
    expect(versions).toContain(2);
  });

  it('v2 迁移失败必须抛（fail-closed — 迁移失败阻止启动）', () => {
    const db = createTestDb();
    db.exec("CREATE VIEW graph_nodes AS SELECT 1 AS id, 'Client' AS type, NULL AS props_json");

    expect(() => reconcileSchema(db)).toThrow();
  });
});
