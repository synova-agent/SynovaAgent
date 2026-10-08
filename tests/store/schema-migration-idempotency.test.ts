/**
 * tests/store/schema-migration-idempotency.test.ts — #1366 迁移读取器确定性 / 类型自证 判据载体
 *
 * 卡面判据身份：`V1`（修前红→修后绿）、`V2`（字符串 tag 不污染）、`V2b`（同秒并列）、
 *   以及反例 `M1`/`M2`/`M3` 的红点。
 *
 * 覆盖面：**迁移版本读取点已修**（覆盖面 = `reconcileSchema` 读取点 **1 处**；同表另有 4 个写入方
 *   （字符串 tag）+ 3 个读取点属他人写集，本卡只读登记不改）。
 *
 * 库口径：`:memory:` 临时库（**禁 `data/synova.db`** —— `data/` 被 `.gitignore:3` 排除，R61/R87）。
 * 口径命名：本文件计数一律 **行数**（`SELECT COUNT(*)`），不混用"文件数"口径。
 *
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

let reconcileSchema: (db: Database.Database) => void;
let SCHEMA_VERSION: number;

async function loadModules() {
  const mod = await import('../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
  SCHEMA_VERSION = mod.SCHEMA_VERSION;
}

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

/** 与生产同形的 schema_version 表（用于种入"既有库"形态） */
const SCHEMA_VERSION_DDL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

function seedVersionTable(db: Database.Database, rows: Array<{ version: unknown; updatedAt: string }>): void {
  db.exec(SCHEMA_VERSION_DDL);
  const ins = db.prepare('INSERT INTO schema_version (version, updated_at) VALUES (?, ?)');
  for (const r of rows) ins.run(r.version, r.updatedAt);
}

function versionRowCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number };
  return row.n;
}

function numericMax(db: Database.Database): number | null {
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_version WHERE typeof(version) = 'integer'")
    .get() as { v: number | null };
  return row.v;
}

function allVersions(db: Database.Database): unknown[] {
  const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: unknown }>;
  return rows.map(r => r.version);
}

/** 字符串 tag 行（模拟 feedback-collector / agent-memory-store 的写入） */
const TAG_ROW = "INSERT INTO schema_version (version, updated_at) VALUES ('d551_target_type', ?)";

describe('#1366 迁移读取器：确定性 + 类型自证', () => {
  let db: Database.Database;

  beforeEach(async () => {
    await loadModules();
    db = createMemoryDb();
  });

  it('V1 全新库：二次 reconcile **不新增行**（修前 = 3 行 / 修后 = 2 行）', () => {
    reconcileSchema(db);
    const afterFirst = versionRowCount(db);
    // ⚠️ 与"迁移条数"解耦：只断言「≥2 行」（每次迁移一行）与「最大数值版本 = 当前版本」
    expect(afterFirst).toBeGreaterThanOrEqual(2);
    expect(numericMax(db)).toBe(SCHEMA_VERSION);

    reconcileSchema(db); // 第二次：修前会因同秒并列读旧版本而**再跑一次**最后一条迁移
    expect(versionRowCount(db)).toBe(afterFirst); // 核心判据 = 不增长（不写死条数）
    expect(numericMax(db)).toBe(SCHEMA_VERSION);
  });

  it('V2 字符串 tag（更晚写入）不污染版本判定：不新增行，且 MAX(数值) 仍为最新', () => {
    reconcileSchema(db);
    const before = versionRowCount(db);

    // 模拟 tag 写入方：updated_at 更晚 ⇒ 旧读法（ORDER BY updated_at DESC LIMIT 1）会取到该字符串
    db.prepare(TAG_ROW).run('2099-01-01 00:00:00');

    reconcileSchema(db);
    expect(versionRowCount(db)).toBe(before + 1); // 只新增了 tag 那一行；reconcile 未追加
    expect(numericMax(db)).toBe(SCHEMA_VERSION);
    expect(allVersions(db)).toContain('d551_target_type'); // tag 行仍在（本卡不改写入方）
  });

  it('V2b 同秒并列（既有库形态）：二次 reconcile 不新增行', () => {
    // 种入"既有库"：两行数值版本 + 相同 updated_at（复刻真实并列）
    // 既有库形态：做到"当前版本已记录"为止（动态取 SCHEMA_VERSION，避免写死迁移条数）
    seedVersionTable(db, [
      { version: SCHEMA_VERSION - 1, updatedAt: '2026-10-07 18:49:17' },
      { version: SCHEMA_VERSION, updatedAt: '2026-10-07 18:49:17' },
    ]);
    const before = versionRowCount(db);

    reconcileSchema(db);
    expect(versionRowCount(db)).toBe(before); // 读取器取 MAX ⇒ 3 ≥ 3 ⇒ 早退
    expect(numericMax(db)).toBe(SCHEMA_VERSION);
  });

  it('边界：表中只有字符串 tag（无数值行）⇒ 视为版本 0 ⇒ 全量迁移执行', () => {
    seedVersionTable(db, [{ version: 'd551_memory_type', updatedAt: '2099-01-01 00:00:00' }]);

    reconcileSchema(db);
    expect(numericMax(db)).toBe(SCHEMA_VERSION);
    expect(versionRowCount(db)).toBeGreaterThanOrEqual(3); // tag 1 行 + 迁移 2/3 各一行
  });

  it('边界：空库（无 schema_version 表）⇒ 建表 + 全量迁移 + 版本号 = SCHEMA_VERSION', () => {
    reconcileSchema(db);
    expect(numericMax(db)).toBe(SCHEMA_VERSION);
    expect(versionRowCount(db)).toBeGreaterThanOrEqual(2); // 与迁移条数解耦
  });

  it('幂等（三连跑）：行数不再增长（读数稳定 = 缺陷已修的可观测代理）', () => {
    reconcileSchema(db);
    const after1 = versionRowCount(db);
    reconcileSchema(db);
    reconcileSchema(db);
    expect(versionRowCount(db)).toBe(after1);
  });
});
