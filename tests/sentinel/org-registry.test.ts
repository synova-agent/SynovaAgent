/**
 * tests/sentinel/org-registry.test.ts — 租户注册表只读面 + 扇出（#1371）
 *
 * 配对：`src/sentinel/org-registry.ts`（组 2「新文件配对」要求同名测试）。
 * 本文件 = 注册表**只读面 + 编排**（5 例）＋ **扇出写路径**（2 例，原 `tests/sentinel/org-fanout.test.ts`
 *   于 #1371 预算瘦身时并入 —— **并文件不删用例，用例数守恒**：5 + 2 = 7）。
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { listActiveOrgs, executeForActiveOrgs, findOrgsWithDataButNotRegistered } from '../../src/sentinel/org-registry';
import { createMetricSink, writeRoundReadings } from '../../src/sentinel/metric-readings-writer';
import { discoverTeams } from '../../src/sentinel/adapters/helpers';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import type { SentinelContext, Sentinel, SentinelCheckResult } from '../../src/sentinel/types';

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
/** 桩：`orgs` 读取走真库；`graph_nodes` 返回一条 FINANCIAL 节点（供 cash-flow 哨兵） */
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
  // #1376 必要连带：哨兵/helper 已改为显式取用 `context.rawDb`
  //   rawDb 需【路由】：`graph_nodes` 查询 ⇒ 夹具行；其余 ⇒ 真库（如 orgs / metric_readings）
  const rawDb = {
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => (sql.includes('graph_nodes')
        ? [{ id: 'n-fixture', type: 'FINANCIAL', props: JSON.stringify({ revenue: 1000, cost: 200, operating_expenses: 300, cash_balance: 5000, period: '2026-09' }) }]
        : (db.prepare(sql).all(...args) as unknown[])),
      get: (...args: unknown[]) => db.prepare(sql).get(...args) as unknown,
      run: (...args: unknown[]) => db.prepare(sql).run(...args) as { changes: number },
    }),
  };
  return { db: splitDb(db), rawDb, now: new Date('2026-10-08T00:00:00Z'), teamId, metricSink: createMetricSink(db) };
}
function orgRows(db: Database.Database): string[] {
  const rows = db.prepare('SELECT DISTINCT org_id FROM metric_readings ORDER BY org_id').all() as Array<{ org_id: string }>;
  return rows.map(r => r.org_id);
}

describe('#1371 租户注册表（只读面 + 编排 + 扇出写路径）', () => {
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
    expect(discoverTeams({ db: splitDb(db), rawDb: db, now: new Date() })).toEqual(['org-a', 'org-b']);
    const empty = createMemoryDb(); reconcileSchema(empty);
    expect(discoverTeams({ db: splitDb(empty), rawDb: empty, now: new Date() })).toEqual([]);
  });

  // ── 扇出写路径（原 org-fanout.test.ts 的 2 例，逐条保留）──
  it('V1+V3 行级租户正确 + 跨租户零交叉：org A / org B 各跑一轮 ⇒ 各自的行只挂自己', async () => {
    const sink = createMetricSink(db);
    await cashFlowSentinel.check({ ...ctxFor(db, 'org-A'), metricSink: sink });
    await cashFlowSentinel.check({ ...ctxFor(db, 'org-B'), metricSink: sink });
    expect(orgRows(db)).toEqual(['org-A', 'org-B']);
    for (const o of orgRows(db)) {
      const rows = db.prepare('SELECT metric_id FROM metric_readings WHERE org_id = ?').all(o) as Array<{ metric_id: string }>;
      expect(rows.some(r => r.metric_id.startsWith('CASH-FLOW-'))).toBe(true);
    }
    const crossA = db.prepare("SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = 'org-A' AND metric_id LIKE 'CASH-FLOW-%'").get() as { n: number };
    const crossB = db.prepare("SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = 'org-B' AND metric_id LIKE 'CASH-FLOW-%'").get() as { n: number };
    expect(crossA.n).toBeGreaterThan(0);
    expect(crossA.n).toBe(crossB.n);
  });

  it("边界 fail-closed（生产路径保证）：无 teamId ⇒ 轮次级写入零行；且不产生 org_id='default'", () => {
    // 生产保证的两层（#1371）：① runner 只对 org 轮注入 sink；② writer 层 `writeRoundReadings` 对空 teamId fail-closed。
    //   ⚠️ 样板哨兵的"指标级"路径在无 teamId 时不自行拦截 —— 该加固属 #1371 预算瘦身时【延后】项（已登记）。
    const sink = createMetricSink(db);
    writeRoundReadings(sink, 'some-sentinel', { findings: [1], durationMs: 5, checkedAt: '2026-10-08T00:00:00Z' }, undefined);
    expect(db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get()).toEqual({ n: 0 });
  });
});

// ── #1371 复核必做⑤（a′）：**runner 级**判据（真 SentinelRunner.runOrgWriteRound）──
//   为什么用【探针哨兵】而非现成哨兵：经 runner 路径，唯一写行的样板 cash-flow 其读路径（raw `prepare`）
//   与 runner 传入的 GraphStore 不兼容 ⇒ 0 行（**已登记缺陷，另立 p1 卡**）。
//   ⇒ 本判据打在【runner 的扇出契约】上：逐 active org 各调一次 + 行级租户正确 + **基线不被污染**。
const PROBE_ID = 'sentinel-org-probe';
function makeProbeSentinel(): Sentinel {
  return {
    config: {
      id: PROBE_ID, name: PROBE_ID, description: '', category: 'growth', priority: 'P1', mode: 'manual',
      version: '1', requiredDataSources: [], confidenceModel: 'deterministic',
    },
    async check(context): Promise<SentinelCheckResult> {
      const sink = context.metricSink;
      const orgId = context.teamId;
      if (sink && orgId) {
        sink({ orgId, metricId: 'PROBE-ROUND', value: 1, observedAt: context.now.toISOString(), sourceId: 'PROBE-v1' });
      }
      return { sentinelId: PROBE_ID, ok: true, findings: [], durationMs: 0, checkedAt: context.now.toISOString() };
    },
  };
}

describe('#1371 runner 级 org 扇出（真 runner + 临时库 + 2 org）', () => {
  it('runOrgWriteRound：逐 active org 各跑一次 ⇒ 行按 org 分开；suspended 排除；**基线不被污染**', async () => {
    const raw = new Database(':memory:');
    new SqliteGraphStore(raw);                            // 建 schema + 跑迁移（含 orgs）
    const { CronScheduler } = await import('../../src/cron/scheduler');
    const scheduler = new CronScheduler(raw);
    const { SentinelRunner } = await import('../../src/sentinel/runner');
    const { getBaselineStore } = await import('../../src/sentinel/baseline-store');
    const { getSentinelRegistry } = await import('../../src/sentinel/registry');
    const runner = new SentinelRunner(scheduler, raw);
    const probe = makeProbeSentinel();
    try {
      const ins = raw.prepare('INSERT INTO orgs (org_id, status, source) VALUES (?, ?, ?)');
      ins.run('org-A', 'active', 'manual'); ins.run('org-B', 'active', 'manual'); ins.run('org-S', 'suspended', 'manual');
      const orgsVisible = raw.prepare("SELECT org_id FROM orgs WHERE status='active' ORDER BY org_id").all() as Array<{ org_id: string }>;
      expect(orgsVisible.map(r => r.org_id)).toEqual(['org-A', 'org-B']);   // 诊断：sqlite 句柄侧确有两 active
      getSentinelRegistry().register(probe);
      expect(getSentinelRegistry().get(PROBE_ID)).toBeTruthy();

      const baselineStore = getBaselineStore();
      const recordSpy = vi.spyOn(baselineStore, 'record');
      const ranOrgs = await runner.runOrgWriteRound(PROBE_ID);
      expect(ranOrgs).toEqual(['org-A', 'org-B']);          // 逐 active org；suspended 排除

      const rows = raw.prepare('SELECT org_id, COUNT(*) AS n FROM metric_readings GROUP BY org_id ORDER BY org_id').all() as Array<{ org_id: string; n: number }>;
      expect(rows.map(r => r.org_id)).toEqual(['org-A', 'org-B']);
      expect(rows.every(r => r.n === 1)).toBe(true);
      expect(rows.some(r => r.org_id === 'default')).toBe(false);

      // 必做①：per-org 轮**不写基线**（BaselineStore 键只有 sentinelId ⇒ 否则 1→1+N 且跨租户混算）
      //   判据打在【真实调用点】上：`baselineStore.record` 在 per-org 轮**一次都没被调**
      expect(recordSpy).not.toHaveBeenCalled();
    } finally {
      getSentinelRegistry().unregister(PROBE_ID);
      scheduler.stop();
      raw.close();
    }
  });
});
