/**
 * tests/sentinel/org-fanout.test.ts — #1371 org 维度扇出判据载体（V1–V3 / V5 / V6）
 *
 * 覆盖面（逐字，CTO 2026-10-08 裁）：
 *   **行级租户正确 + 跨租户零交叉；数值级隔离未接 ⇒ 各 org 取值目前相同**
 *   （哨兵读路径 `SELECT props FROM graph_nodes WHERE type='FINANCIAL'` 全局；graph_nodes 无 org 列 ⇒
 *    逐 org 跑的 compute 取值相同 —— "数值级隔离"另立卡，p1）
 *
 * 口径：`:memory:` 临时库（禁 `data/synova.db`）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import type { SentinelContext } from '../../src/sentinel/types';

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

/** 桩图库：cash-flow 只调 `prepare(sql).all()` 取 FINANCIAL 节点；另供 discoverTeams 读 orgs */
function splitDb(db: Database.Database): { prepare(sql: string): { all(): unknown[] } } {
  return {
    prepare: (sql: string) => ({
      all: () => (sql.includes('graph_nodes')
        ? [{ props: JSON.stringify({ revenue: 1000, cost: 200, operating_expenses: 300, cash_balance: 5000, period: '2026-09' }) }]
        : (db.prepare(sql).all() as unknown[])),
    }),
  };
}

function ctxFor(db: Database.Database, teamId?: string): SentinelContext {
  return { db: splitDb(db), now: new Date('2026-10-08T00:00:00Z'), teamId, metricSink: createMetricSink(db) };
}

function orgRows(db: Database.Database): string[] {
  const rows = db.prepare('SELECT DISTINCT org_id FROM metric_readings ORDER BY org_id').all() as Array<{ org_id: string }>;
  return rows.map(r => r.org_id);
}

describe('#1371 org 维度扇出', () => {
  let db: Database.Database;
  beforeEach(async () => {
    await loadModules();
    db = createMemoryDb();
    reconcileSchema(db);
  });

  it('V1+V3 行级租户正确 + 跨租户零交叉：org A / org B 各跑一轮 ⇒ 各自的行只挂自己', async () => {
    const sink = createMetricSink(db);
    await cashFlowSentinel.check({ ...ctxFor(db, 'org-A'), metricSink: sink });
    await cashFlowSentinel.check({ ...ctxFor(db, 'org-B'), metricSink: sink });

    const orgs = orgRows(db);
    expect(orgs).toEqual(['org-A', 'org-B']);      // 每行 org_id != 'default'，且两个租户各有一份
    for (const o of orgs) {
      const rows = db.prepare('SELECT metric_id FROM metric_readings WHERE org_id = ?').all(o) as Array<{ metric_id: string }>;
      expect(rows.some(r => r.metric_id.startsWith('CASH-FLOW-'))).toBe(true);
    }
    // 零交叉：A 的 observed_at 与 B 相同（同 now）但 org 不同 ⇒ 唯一键不冲突、无覆盖
    const crossA = db.prepare("SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = 'org-A' AND metric_id LIKE 'CASH-FLOW-%'").get() as { n: number };
    const crossB = db.prepare("SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = 'org-B' AND metric_id LIKE 'CASH-FLOW-%'").get() as { n: number };
    expect(crossA.n).toBeGreaterThan(0);
    expect(crossA.n).toBe(crossB.n);
  });

  it("边界 fail-closed：无 teamId（全局轮）⇒ 零行；且不产生 org_id='default'", async () => {
    await cashFlowSentinel.check(ctxFor(db, undefined));
    expect(db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get()).toEqual({ n: 0 });
  });

});
