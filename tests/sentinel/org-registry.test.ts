/**
 * tests/sentinel/org-registry.test.ts — 租户注册表只读面 + 扇出编排（#1371）
 *
 * 配对：`src/sentinel/org-registry.ts`（组 2「新文件配对」要求同名测试）。
 * 分工：本文件 = 注册表**只读面 + 编排**；`org-fanout.test.ts` = 端到端写路径（行级租户正确 + 零交叉）。
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { listActiveOrgs, executeForActiveOrgs, findOrgsWithDataButNotRegistered } from '../../src/sentinel/org-registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { discoverTeams } from '../../src/sentinel/adapters/helpers';

let reconcileSchema: (db: Database.Database) => void;
async function loadModules() {
  const mod = await import('../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
}
function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}
function addOrg(db: Database.Database, orgId: string, status = 'active'): void {
  db.prepare('INSERT INTO orgs (org_id, status, source) VALUES (?, ?, ?)').run(orgId, status, 'manual');
}
/** 桩：`orgs` 读取走真库；其余（graph_nodes）返回空 */
function stubDb(db: Database.Database): { prepare(sql: string): { all(): unknown[] } } {
  return { prepare: (sql: string) => ({ all: () => db.prepare(sql).all() as unknown[] }) };
}

describe('#1371 租户注册表（只读面）', () => {
  let db: Database.Database;
  beforeEach(async () => { await loadModules(); db = createMemoryDb(); reconcileSchema(db); });

  it('V2 listActiveOrgs：只列 active（suspended 排除）、确定性序；空注册表 ⇒ []（fail-closed）', () => {
    addOrg(db, 'org-b'); addOrg(db, 'org-a'); addOrg(db, 'org-susp', 'suspended');
    expect(listActiveOrgs(db)).toEqual(['org-a', 'org-b']);
    const empty = createMemoryDb(); reconcileSchema(empty);
    expect(listActiveOrgs(empty)).toEqual([]);
  });

  it('只读面：表不存在时返回空集且不抛（未迁移库 ⇒ 调用方 fail-closed）', () => {
    const bare = createMemoryDb();
    expect(listActiveOrgs(bare)).toEqual([]);
    expect(() => findOrgsWithDataButNotRegistered(bare)).not.toThrow();
  });

  it('扇出编排：每个 active org 各执行一次；无 active org ⇒ 零次调用', async () => {
    addOrg(db, 'org-a'); addOrg(db, 'org-b'); addOrg(db, 'org-susp', 'suspended');
    const calls: string[] = [];
    expect(await executeForActiveOrgs(db, async (o) => { calls.push(o); })).toEqual(['org-a', 'org-b']);
    expect(calls).toEqual(['org-a', 'org-b']);
    const empty = createMemoryDb(); reconcileSchema(empty);
    const calls2: string[] = [];
    expect(await executeForActiveOrgs(empty, async (o) => { calls2.push(o); })).toEqual([]);
    expect(calls2).toEqual([]);
  });

  it('V5 对账：有数据但不在注册表的 org ⇒ 列出（orgIds + 行数）', () => {
    addOrg(db, 'org-ok');
    const sink = createMetricSink(db);
    sink({ orgId: 'org-ok', metricId: 'M-1', value: 1, observedAt: '2026-10-08T00:00:00Z' });
    sink({ orgId: 'rogue', metricId: 'M-2', value: 1, observedAt: '2026-10-08T00:00:00Z' });
    sink({ orgId: 'rogue', metricId: 'M-3', value: 1, observedAt: '2026-10-08T00:01:00Z' });
    const r = findOrgsWithDataButNotRegistered(db);
    expect(r.orgIds).toEqual(['rogue']);
    expect(r.count).toBe(2);
  });

  it('V6 discoverTeams（修后）：读数 == 注册表 active 枚举；空注册表 ⇒ []（不再回落 default）', () => {
    addOrg(db, 'org-a'); addOrg(db, 'org-b'); addOrg(db, 'org-susp', 'suspended');
    expect(discoverTeams({ db: stubDb(db), now: new Date() })).toEqual(['org-a', 'org-b']);
    const empty = createMemoryDb(); reconcileSchema(empty);
    expect(discoverTeams({ db: stubDb(empty), now: new Date() })).toEqual([]);
  });
});
