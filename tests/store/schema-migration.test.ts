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

  it('SCHEMA_VERSION 应为 5（含 D355 + #1053 metric_readings + #1371 orgs + #1455 graph_triples props 迁移）', () => {
    expect(SCHEMA_VERSION).toBe(5);
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

// ═══════════════════════════════════════════════════════════════════
// #964 Q-8（裁 395）: 版本门禁（库比构建新 ⇒ 拒）＋迁移链相邻完整 ＋ 存量基线冻结
//
// 存量基线（**只登记，不迁台账**；双向棘轮：新增写点 ⇒ 红；偷减写点 ⇒ 红）:
//   · 台账外 `schema_version` 写入 = 7 条（4 个 tag 值；feedback-collector 5 条 + agent-memory-store 2 条）
//   · `session_events` 台账外 DDL = D487 重建 2 处（CREATE IF NOT EXISTS / CREATE _new）
//   · `agent_sessions` 台账外 ALTER = 2 处（user_id / title）
//   —— 全量迁入台账属 E-7（另立），本卡不改写侧。
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import path from 'path';
import {
  SchemaMigrationError,
  assertMigrationChain,
  type Migration,
} from '../../src/store/schema-migration';

const migrationStub = (version: number): Migration => ({ version, name: `m${version}`, up: () => {} });

describe('#964 版本门禁：库比构建新 ⇒ 拒（SCHEMA_TOO_NEW）', () => {
  beforeEach(async () => { await loadModules(); });

  it('schema_version=99 ⇒ reconcileSchema 抛 SchemaMigrationError(SCHEMA_TOO_NEW)，且不改库', () => {
    const db = createTestDb();
    db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.prepare('INSERT INTO schema_version (version) VALUES (99)').run();

    let caught: unknown;
    try {
      reconcileSchema(db);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    const typed = caught as SchemaMigrationError;
    expect(typed.code).toBe('SCHEMA_TOO_NEW');
    expect(typed.phase).toBe('reconcile');
    expect(typed.retryable).toBe(false);

    const row = db.prepare("SELECT MAX(version) AS v FROM schema_version WHERE typeof(version) = 'integer'").get() as { v: number };
    expect(row.v).toBe(99); // 拒 = 零写入（不追加版本行）
    db.close();
  });
});

describe('#964 迁移链完整性 assertMigrationChain（缺环/重复/末条≠版本）', () => {
  it('合法链：v2..v5 严格 +1 且末条 = SCHEMA_VERSION ⇒ 通过', () => {
    expect(() => assertMigrationChain([2, 3, 4, 5].map(migrationStub), 5)).not.toThrow();
    expect(() => assertMigrationChain([2].map(migrationStub), 2)).not.toThrow();
  });

  it('缺环（v2,v4,v5）⇒ MIGRATION_CHAIN_GAP，message 点名期望 v3', () => {
    let caught: unknown;
    try { assertMigrationChain([2, 4, 5].map(migrationStub), 5); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    expect((caught as SchemaMigrationError).code).toBe('MIGRATION_CHAIN_GAP');
    expect((caught as SchemaMigrationError).message).toContain('期望 v3');
  });

  it('重复（v2,v3,v3,v4,v5）⇒ MIGRATION_DUPLICATE_VERSION', () => {
    let caught: unknown;
    try { assertMigrationChain([2, 3, 3, 4, 5].map(migrationStub), 5); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    expect((caught as SchemaMigrationError).code).toBe('MIGRATION_DUPLICATE_VERSION');
  });

  it('首条非 v2（从 v3 起）⇒ MIGRATION_CHAIN_GAP（v1 基线之后必须从 2 开始）', () => {
    let caught: unknown;
    try { assertMigrationChain([3, 4, 5].map(migrationStub), 5); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    expect((caught as SchemaMigrationError).code).toBe('MIGRATION_CHAIN_GAP');
  });

  it('末条 ≠ SCHEMA_VERSION（v2..v4 但版本 5）⇒ MIGRATION_CHAIN_GAP', () => {
    let caught: unknown;
    try { assertMigrationChain([2, 3, 4].map(migrationStub), 5); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    expect((caught as SchemaMigrationError).code).toBe('MIGRATION_CHAIN_GAP');
  });

  it('空迁移表：schemaVersion=1 ⇒ 合法；schemaVersion>1 ⇒ GAP', () => {
    expect(() => assertMigrationChain([], 1)).not.toThrow();
    let caught: unknown;
    try { assertMigrationChain([], 5); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    expect((caught as SchemaMigrationError).code).toBe('MIGRATION_CHAIN_GAP');
  });
});

describe('#964 真·拒启：initEngineContext 对不兼容库抛错（Phase 0 fatal）', () => {
  it('临时文件库 schema_version=99 ⇒ 抛 SCHEMA_TOO_NEW；SYNO_SCHEMA_STRICT=0 ⇒ 不抛（回滚态）', async () => {
    const fsMod = await import('fs');
    const osMod = await import('os');
    const pathMod = await import('path');
    const BetterSqlite3 = require('better-sqlite3');
    const tmpDir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), '964-schema99-'));
    const dbPath = pathMod.join(tmpDir, 'schema99.db');
    const seed = new BetterSqlite3(dbPath);
    seed.exec("CREATE TABLE schema_version (version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
    seed.prepare('INSERT INTO schema_version (version) VALUES (99)').run();
    seed.close();

    const prevDbPath = process.env.SYNOVA_DB_PATH;
    const prevStrict = process.env.SYNO_SCHEMA_STRICT;
    process.env.SYNOVA_DB_PATH = dbPath;
    delete process.env.SYNO_SCHEMA_STRICT;

    const engineContext = await import('../../src/init/engine-context');
    try {
      let caught: unknown;
      try {
        engineContext.initEngineContext();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SchemaMigrationError);
      expect((caught as SchemaMigrationError).code).toBe('SCHEMA_TOO_NEW');

      // 回滚开关：退回旧 warn+degraded 语义 ⇒ 不抛，可继续启动
      process.env.SYNO_SCHEMA_STRICT = '0';
      expect(() => engineContext.initEngineContext()).not.toThrow();
      engineContext.closeEngineContext();
    } finally {
      if (prevDbPath === undefined) delete process.env.SYNOVA_DB_PATH; else process.env.SYNOVA_DB_PATH = prevDbPath;
      if (prevStrict === undefined) delete process.env.SYNO_SCHEMA_STRICT; else process.env.SYNO_SCHEMA_STRICT = prevStrict;
      fsMod.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('#964 存量基线冻结（只登记不迁台账；新增 ⇒ 红，偷减 ⇒ 红）', () => {
  const REPO_ROOT = path.resolve(__dirname, '..', '..');
  const readSource = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

  /** 台账外 schema_version 写入：tag → 次数（4 个 tag 值 / 共 7 条） */
  const EXPECTED_TAG_WRITES: Record<string, number> = {
    d93b_actor_role: 1,
    d551_target_type: 2,
    k6_confirm_decision: 2,
    d551_memory_type: 2,
  };

  it('台账外 schema_version 写入 = 7 条 / 4 tag 值（新增写点 ⇒ 红；偷减 ⇒ 红）', () => {
    const texts = [readSource('src/growth/feedback-collector.ts'), readSource('src/l4/agent-memory-store.ts')].join('\n');
    const actual: Record<string, number> = {};
    for (const tag of Object.keys(EXPECTED_TAG_WRITES)) {
      const pattern = new RegExp(`INSERT OR IGNORE INTO schema_version \\(version\\) VALUES \\('${tag}'\\)`, 'g');
      actual[tag] = (texts.match(pattern) ?? []).length;
    }
    expect(actual).toEqual(EXPECTED_TAG_WRITES);
    // 总量棘轮：任何**新 tag/新写点**都会让总数 > 7（只在已知 tag 上比对会漏掉新 tag）
    const totalWrites = (texts.match(/INSERT OR IGNORE INTO schema_version/g) ?? []).length;
    expect(totalWrites).toBe(7);
    expect(Object.values(actual).reduce((sum, count) => sum + count, 0)).toBe(totalWrites);
  });

  it('session_events 台账外 DDL 冻结：重建 2 处 + agent_sessions ALTER 2 处（新 DDL ⇒ 红；删 DDL ⇒ 红）', () => {
    const sessionStore = readSource('src/store/session-store.ts');
    const count = (pattern: RegExp): number => (sessionStore.match(pattern) ?? []).length;
    expect(count(/CREATE TABLE IF NOT EXISTS session_events/g)).toBe(1);
    expect(count(/CREATE TABLE session_events_new/g)).toBe(1);
    expect(count(/ALTER TABLE agent_sessions ADD COLUMN/g)).toBe(2);
  });
});
