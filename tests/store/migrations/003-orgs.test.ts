/**
 * tests/store/migrations/003-orgs.test.ts — 迁移模块配对测试（#1371）
 *
 * 身份：pre-commit 组 2「新文件配对」要求 `src/store/migrations/003-*.ts` 有同名测试（同 001/002 先例）。
 * 与 `tests/store/orgs-migration.test.ts` 的分工：
 *   · 本文件 = **迁移对象本体**（version/name/up 幂等、DDL 落地、索引）
 *   · `orgs-migration.test.ts` = 表结构矩阵 + 边界（CHECK/NOT NULL/默认值）
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { orgsMigration } from '../../../src/store/migrations/003-orgs';

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

describe('迁移 003 orgs（模块本体）', () => {
  let db: Database.Database;
  beforeEach(() => { db = createMemoryDb(); });

  it('元数据：version=4、name=orgs', () => {
    expect(orgsMigration.version).toBe(4);
    expect(orgsMigration.name).toBe('orgs');
  });

  it('up(db)：建 orgs 表 + ix_orgs_status 索引', () => {
    orgsMigration.up(db);
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='orgs'").get() as { sql: string }).sql;
    expect(sql).toContain('CREATE TABLE orgs');
    const idx = db.pragma('index_list(orgs)') as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('ix_orgs_status');
  });

  it('up(db) 幂等：连跑两次不抛、结构不变', () => {
    orgsMigration.up(db);
    const before = (db.pragma('table_info(orgs)') as Array<{ name: string }>).map(c => c.name);
    expect(() => orgsMigration.up(db)).not.toThrow();
    expect((db.pragma('table_info(orgs)') as Array<{ name: string }>).map(c => c.name)).toEqual(before);
  });

  it('up(db) 失败面上抛：与已存在的同名视图冲突 ⇒ 抛错（fail-closed，由 reconcileSchema 阻断启动）', () => {
    db.exec('CREATE VIEW orgs AS SELECT 1 AS x');
    expect(() => orgsMigration.up(db)).toThrow();
  });
});
