/**
 * tests/store/migrations/003-orgs.test.ts — 迁移 003（`orgs` 租户注册表）完整判据（#1371）
 *
 * 本文件 = **迁移模块本体**（version/name/up 幂等）+ **表结构矩阵与边界**（原 `tests/store/orgs-migration.test.ts`
 *   的 6 例于 #1371 预算瘦身时并入 —— **并文件不删用例，用例数守恒**：4 + 6 = 10）。
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`；R61/R87）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { orgsMigration } from '../../../src/store/migrations/003-orgs';

let reconcileSchema: (db: Database.Database) => void;
let SCHEMA_VERSION: number;
async function loadModules() {
  const mod = await import('../../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
  SCHEMA_VERSION = mod.SCHEMA_VERSION;
}

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

interface ColRow { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
const EXPECTED_COLS = ['org_id', 'display_name', 'status', 'source', 'created_at', 'updated_at'];
function tableSql(db: Database.Database): string {
  const r = db.prepare("SELECT sql FROM sqlite_master WHERE name='orgs'").get() as { sql: string } | undefined;
  return r?.sql ?? '';
}

describe('迁移 003 orgs（模块本体 + 表结构矩阵）', () => {
  let db: Database.Database;
  beforeEach(async () => { await loadModules(); db = createMemoryDb(); reconcileSchema(db); });

  // ── 模块本体（配对，组 2）──
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
    const before = (db.pragma('table_info(orgs)') as ColRow[]).map(c => c.name);
    expect(() => orgsMigration.up(db)).not.toThrow();
    expect((db.pragma('table_info(orgs)') as ColRow[]).map(c => c.name)).toEqual(before);
  });

  it('up(db) 失败面上抛：与同名视图冲突 ⇒ 抛错（fail-closed，由 reconcileSchema 阻断启动）', () => {
    const bare = createMemoryDb();
    bare.exec('CREATE VIEW orgs AS SELECT 1 AS x');
    expect(() => orgsMigration.up(bare)).toThrow();
  });

  // ── 表结构矩阵与边界（原 orgs-migration.test.ts 的 6 例，逐条保留）──
  it('正常：6 列 + 1 索引；SCHEMA_VERSION = 4', () => {
    const cols = db.pragma('table_info(orgs)') as ColRow[];
    expect(cols.map(c => c.name)).toEqual(EXPECTED_COLS);
    const idx = db.pragma('index_list(orgs)') as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('ix_orgs_status');
    expect(SCHEMA_VERSION).toBe(4);
  });

  it('约束文本在位：两处 CHECK + 1 处 default 守卫', () => {
    const sql = tableSql(db);
    expect(sql).toContain("CHECK (status IN ('active','suspended','closed'))");
    expect(sql).toContain("CHECK (source IN ('provisioning','manual','migration'))");
    expect(sql).toContain("CHECK (org_id <> 'default')");
  });

  it("边界：插 'default' ⇒ CHECK 拒绝（'default' 是回落值，不是租户）", () => {
    expect(() => db.prepare("INSERT INTO orgs (org_id, source) VALUES ('default','manual')").run())
      .toThrow(/CHECK constraint failed/i);
  });

  it('边界：status / source 非法值被拒；source 缺失 NOT NULL 被拒', () => {
    expect(() => db.prepare("INSERT INTO orgs (org_id, status, source) VALUES ('o1','bogus','manual')").run())
      .toThrow(/CHECK constraint failed/i);
    expect(() => db.prepare("INSERT INTO orgs (org_id, source) VALUES ('o2','bogus')").run())
      .toThrow(/CHECK constraint failed/i);
    expect(() => db.prepare("INSERT INTO orgs (org_id) VALUES ('o3')").run())
      .toThrow(/NOT NULL constraint failed: orgs.source/i);
  });

  it("正常：status 默认 'active'；display_name 可空；created_at/updated_at 自动", () => {
    db.prepare("INSERT INTO orgs (org_id, source) VALUES ('org-a','provisioning')").run();
    const r = db.prepare('SELECT * FROM orgs WHERE org_id = ?').get('org-a') as {
      status: string; display_name: string | null; created_at: string; updated_at: string;
    };
    expect(r.status).toBe('active');
    expect(r.display_name).toBeNull();
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(r.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it('幂等（迁移系统路径）：reconcileSchema 连跑两次不抛、orgs 结构不变', () => {
    const before = (db.pragma('table_info(orgs)') as ColRow[]).map(c => c.name);
    expect(() => reconcileSchema(db)).not.toThrow();
    expect((db.pragma('table_info(orgs)') as ColRow[]).map(c => c.name)).toEqual(before);
  });
});
