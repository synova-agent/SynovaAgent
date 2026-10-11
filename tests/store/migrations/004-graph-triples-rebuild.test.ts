/**
 * tests/store/migrations/004-graph-triples-rebuild.test.ts — #1455 迁移 004 单测
 *
 * 铁律 33: *.test.ts 单元测试（`:memory:` SQLite，禁 data/synova.db）
 * 铁律 48: 真实断言 — 正常路径（搬运/回填）/ 降级路径（NULL/空/缺表/已 canonical）/ 边界（幂等/视图/事务）
 *
 * 🔴 夹具口径（K3 可核）：`REAL_NODES_DDL` / `REAL_TRIPLES_DDL` **逐字抄真机
 *    `data/synova.db`（2026-10-09 实测 `sqlite_master.sql`）**，`graph_nodes` 只去掉 001 已补的
 *    `props` 列以还原"真·旧形态"（含 `id INTEGER PRIMARY KEY AUTOINCREMENT`、`props_json`、
 *    无 `props`、无 `schema_version` 表）——**不是**按 canonical 臆造的夹具。
 *    ⇒ 夹具与真机同形，才复现得出真机写面的 `datatype mismatch`（纯 canonical 夹具复现不出）。
 *
 * 判别性断言一律用**长度 N(N>0) / 具体值**（❌ 不用 `Array.isArray` 之类在坏库上照样绿的恒真式）。
 */
import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { graphTriplesRebuildMigration } from '../../../src/store/migrations/004-graph-triples-rebuild';
import { graphNodesPropsMigration } from '../../../src/store/migrations/001-graph-nodes-props';
import { reconcileSchema, SCHEMA_VERSION } from '../../../src/store/schema-migration';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';

/**
 * canonical `graph_triples` 期望列（本文件即"规格书写处"，与迁移 DDL 逐列对齐）。
 * 🔴 由下方【同形守卫】用例与 adapter `SCHEMA_SQL` 的解析结果比对 ⇒ 两处漂移必红。
 */
const EXPECTED_CANONICAL_COLUMNS = [
  'id', 'graph', 'subject_type', 'subject_id', 'predicate', 'object_type',
  'object_id', 'weight', 'props', 'created_at', 'valid_from', 'valid_to',
];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createDb = (): Database.Database => new (require('better-sqlite3'))(':memory:') as Database.Database;

/**
 * 真机 `graph_triples` DDL —— 逐字抄 `data/synova.db` 实测 `sqlite_master.sql`。
 * 🔴 保留 `id INTEGER PRIMARY KEY AUTOINCREMENT`（canonical 声明 `id TEXT PRIMARY KEY`）
 *    —— 这正是"补列修不好写面"的根因；夹具丢了它就测不出真机行为。
 */
const REAL_TRIPLES_DDL = `
CREATE TABLE graph_triples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
        graph TEXT NOT NULL, weight REAL DEFAULT 1.0,
        props_json TEXT DEFAULT '{}', confidence REAL DEFAULT 1.0, source TEXT,
        valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`;
const REAL_TRIPLES_INDEXES = [
  `CREATE INDEX idx_gt_subject ON graph_triples(graph, subject_type, subject_id)`,
  `CREATE INDEX idx_gt_object ON graph_triples(graph, object_type, object_id)`,
  `CREATE INDEX idx_gt_predicate ON graph_triples(graph, predicate)`,
  `CREATE INDEX idx_gt_weight ON graph_triples(graph, predicate, weight)`,
  `CREATE INDEX idx_gt_valid ON graph_triples(graph, valid_from, valid_to)`,
];

/** 真机 `graph_nodes` DDL —— 逐字抄，去掉 001 补的 `props` 列（还原真·旧形态） */
const REAL_NODES_DDL = `
CREATE TABLE graph_nodes (
        id TEXT NOT NULL, type TEXT NOT NULL, graph TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '', confidence REAL DEFAULT 1.0,
        props_json TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_to TEXT,
        PRIMARY KEY (id, graph)
      )`;

/** 造"真机旧形态"库：两表均 props_json、无 props、无 schema_version 表 */
function createLegacyDb(): Database.Database {
  const db = createDb();
  db.exec(REAL_NODES_DDL);
  db.exec(REAL_TRIPLES_DDL);
  for (const idx of REAL_TRIPLES_INDEXES) db.exec(idx);
  return db;
}

/** 真机形态下插边：`id` 由 AUTOINCREMENT 生成（不能显式传 TEXT id） */
function insertLegacyEdge(db: Database.Database, subjectId: string, objectId: string, propsJson: string | null): void {
  db.prepare(
    `INSERT INTO graph_triples (subject_type, subject_id, predicate, object_type, object_id, graph, weight, props_json, valid_to)
     VALUES ('Client', ?, 'REVENUE_FROM', 'Product', ?, 'default', 0.9, ?, NULL)`,
  ).run(subjectId, objectId, propsJson);
}

const columnsOf = (db: Database.Database, t: string): string[] =>
  (db.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);
const indexNames = (db: Database.Database): string[] =>
  (db.pragma('index_list(graph_triples)') as Array<{ name: string }>).map((i) => i.name).filter((n) => !n.startsWith('sqlite_autoindex'));
const edgeCount = (db: Database.Database): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n;

/**
 * 生产读路径 SQL 的不变前缀（`src/adapters/sqlite-graph-store.ts:245`，逐字复制；
 * 由下方 `it` 钉死防漂移 —— 生产代码里这是**模板字符串**，`WHERE` 后为 `${conditions}` 插值）
 */
const PROD_EDGE_SQL_PREFIX =
  'SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples WHERE ';
const PROD_EDGE_SQL = `${PROD_EDGE_SQL_PREFIX}graph = ? AND valid_to IS NULL`;

describe('004-graph-triples-rebuild — 旧库搬运到 canonical（正常路径，夹具=真机 DDL）', () => {
  it('2 行真数据：行数不丢、props_json → props 回填、id CAST 为 TEXT', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');
    insertLegacyEdge(db, 'c2', 'p2', '{"share":7}');

    graphTriplesRebuildMigration.up(db);

    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
    expect(edgeCount(db)).toBe(2);
    const rows = db.prepare('SELECT id, props FROM graph_triples ORDER BY subject_id').all() as Array<{ id: string; props: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('1'); // 旧 INTEGER 主键 1 → CAST 为 TEXT（身份稳定，不重造）
    expect(rows[1].id).toBe('2');
    expect(JSON.parse(rows[0].props)).toEqual({ action_effect_lag: '3-6_months' });
    expect(JSON.parse(rows[1].props)).toEqual({ share: 7 });
  });

  it('重建后 id 列类型 = TEXT（canonical 主键形状）', () => {
    const db = createLegacyDb();
    expect((db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find((c) => c.name === 'id')?.type).toBe('INTEGER');

    graphTriplesRebuildMigration.up(db);

    expect((db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find((c) => c.name === 'id')?.type).toBe('TEXT');
  });

  it('props_json 为 NULL / 空串的行回填默认 {}，有值行保留原值', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', null);
    insertLegacyEdge(db, 'c2', 'p2', '');
    insertLegacyEdge(db, 'c3', 'p3', '{"share":7}');

    graphTriplesRebuildMigration.up(db);

    const rows = db.prepare('SELECT props FROM graph_triples ORDER BY subject_id').all() as Array<{ props: string }>;
    expect(rows).toHaveLength(3);
    expect(rows[0].props).toBe('{}');
    expect(rows[1].props).toBe('{}');
    expect(JSON.parse(rows[2].props)).toEqual({ share: 7 });
  });

  it('canonical 5 索引全部在位（名字与 SCHEMA_SQL 一致）', () => {
    const db = createLegacyDb();

    graphTriplesRebuildMigration.up(db);

    expect(indexNames(db).sort()).toEqual(
      ['idx_gt_object', 'idx_gt_predicate', 'idx_gt_subject', 'idx_gt_valid', 'idx_gt_weight'],
    );
  });
});

describe('004-graph-triples-rebuild — 幂等与边界', () => {
  it('幂等：连跑两次 ⇒ 第二次 no-op（列/索引/行数/值都不变）', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');

    graphTriplesRebuildMigration.up(db);
    const colsAfter1 = columnsOf(db, 'graph_triples');
    const idxAfter1 = indexNames(db).sort();
    graphTriplesRebuildMigration.up(db); // 第二次

    expect(columnsOf(db, 'graph_triples')).toEqual(colsAfter1);
    expect(indexNames(db).sort()).toEqual(idxAfter1);
    expect(edgeCount(db)).toBe(1);
    const row = db.prepare('SELECT props FROM graph_triples').get() as { props: string };
    expect(JSON.parse(row.props)).toEqual({ action_effect_lag: '3-6_months' });
  });

  it('已是 canonical 的新库 ⇒ no-op（列不变、数据不变）', () => {
    const db = createDb();
    db.exec(`CREATE TABLE graph_triples (
      id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default', subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL, predicate TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0, props TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT)`);
    db.prepare("INSERT INTO graph_triples (id, subject_type, subject_id, predicate, object_type, object_id, props) VALUES ('edge-x','Client','c1','OWNS','Product','p1','{\"k\":1}')").run();

    expect(() => graphTriplesRebuildMigration.up(db)).not.toThrow();

    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
    const row = db.prepare("SELECT props FROM graph_triples WHERE id = 'edge-x'").get() as { props: string };
    expect(JSON.parse(row.props)).toEqual({ k: 1 });
  });

  it('中间态（id 仍 INTEGER 但已被补过 props 列）⇒ 仍重建（兜住"只补列"半修遗留态）', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"share":7}');
    db.exec("ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'"); // 半修遗留态
    db.prepare("UPDATE graph_triples SET props = props_json").run();

    graphTriplesRebuildMigration.up(db);

    expect((db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find((c) => c.name === 'id')?.type).toBe('TEXT');
    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
    const row = db.prepare('SELECT props FROM graph_triples').get() as { props: string };
    expect(JSON.parse(row.props)).toEqual({ share: 7 });
  });

  it('graph_triples 不存在（全新库）→ no-op 不抛错、不建表', () => {
    const db = createDb();

    expect(() => graphTriplesRebuildMigration.up(db)).not.toThrow();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain('graph_triples');
  });

  it('graph_triples 是视图（异常 schema）→ 抛错 fail-closed，视图本体不被破坏', () => {
    const db = createDb();
    db.exec("CREATE VIEW graph_triples AS SELECT 1 AS id, 'OWNS' AS predicate, NULL AS props_json");

    expect(() => graphTriplesRebuildMigration.up(db)).toThrow(/不是 TABLE/);

    const obj = db.prepare("SELECT type FROM sqlite_master WHERE name = 'graph_triples'").get() as { type: string };
    expect(obj.type).toBe('view');
  });

  it('重建抛错 ⇒ 事务回滚（不留半成品表、不留 scratch 表）', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"share":7}');
    // 失败注入：先释放 `idx_gt_subject` 名（旧表上的同名索引），再在**别的表**上占用它
    // ⇒ 重建末尾 `CREATE INDEX idx_gt_subject ON graph_triples(…)` 必失败（index already exists）
    // ⇒ 整个事务回滚
    db.exec('DROP INDEX idx_gt_subject');
    db.exec('CREATE INDEX idx_gt_subject ON graph_nodes(graph, name)');

    expect(() => graphTriplesRebuildMigration.up(db)).toThrow(/already exists/);

    // 回滚后：原表仍是旧形态、行数不变、scratch 表不存在
    expect(edgeCount(db)).toBe(1);
    expect((db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find((c) => c.name === 'id')?.type).toBe('INTEGER');
    expect(columnsOf(db, 'graph_triples')).not.toContain('props');
    const scratch = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'graph_triples_1455_legacy'").get();
    expect(scratch).toBeUndefined();
  });
});

describe('004-graph-triples-rebuild — 版本门控与生产读写路径（L2 真跑，夹具=真机 DDL）', () => {
  it('reconcileSchema 门控：无 schema_version 表的旧库 ⇒ 004 被登记并执行（表转 canonical + 版本号写入）', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');

    reconcileSchema(db);

    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
    const ver = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(ver.v).toBe(SCHEMA_VERSION);
  });

  it('【L2 真路径·读面】真机形态库 → new SqliteGraphStore → queryEdges() 读回 2 条且 props 可解析', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');
    insertLegacyEdge(db, 'c2', 'p2', '{"share":7}');

    const store = new SqliteGraphStore(db); // ctor 内 initSchema + reconcileSchema（生产路径）
    const edges = store.queryEdges();

    // 判别断言：具体条数 + 具体值
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.type === 'REVENUE_FROM')).toBe(true);
    const byFrom = new Map(edges.map((e) => [e.from, e.props]));
    expect(byFrom.get('c1')).toEqual({ action_effect_lag: '3-6_months' });
    expect(byFrom.get('c2')).toEqual({ share: 7 });
  });

  it('【L2 真路径·写面】同一 store createEdge() 成功（半修的 datatype mismatch 已消失）', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"share":7}');
    const store = new SqliteGraphStore(db);

    let created = '';
    expect(() => { created = store.createEdge('OWNS', 'c1', 'p2'); }).not.toThrow();

    expect(created).toMatch(/^edge-/);
    const edges = store.queryEdges();
    expect(edges).toHaveLength(2); // 旧 1 条 + 新 1 条
    expect(edges.find((e) => e.type === 'OWNS')?.props).toEqual({});
  });

  it('【V4 改坏即红】把 props 列还原成旧库形态 ⇒ 同一 store 的 queryEdges 退回 0 条、原文 SQL 抛 no such column', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');
    const store = new SqliteGraphStore(db);
    expect(store.queryEdges()).toHaveLength(1); // 绿：迁移后

    // 改坏：还原旧库列形态（= 迁移未执行时的真实形态）
    db.exec('ALTER TABLE graph_triples DROP COLUMN props');

    expect(store.queryEdges()).toHaveLength(0); // 红①：被 catch 吞成"无边"
    expect(() => db.prepare(PROD_EDGE_SQL).all('default')).toThrow(/no such column: props/); // 红②：症状字面量
  });

  it('【同形守卫】canonical DDL 与 adapter SCHEMA_SQL 的 graph_triples 列**逐列一致**（防两处漂移）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    const src = fs.readFileSync('src/adapters/sqlite-graph-store.ts', 'utf8');

    const m = /CREATE TABLE IF NOT EXISTS graph_triples \(([\s\S]*?)\n\);/.exec(src);
    expect(m).not.toBeNull();
    const adapterCols = (m?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim().replace(/,$/, ''))
      .filter((l) => l.length > 0)
      .map((l) => l.split(/\s+/)[0]);
    expect(adapterCols).toEqual([...EXPECTED_CANONICAL_COLUMNS]);

    // 读路径 SQL 原文（:245）与 props 解析（:253）仍不被本迁移改写
    expect(src).toContain(PROD_EDGE_SQL_PREFIX);
    expect(src).toContain('JSON.parse(row.props || "{}")');
  });

  it('001 与 004 互不越界 + 同库合跑：graph_nodes 由 001 补 props，graph_triples 由 004 转 canonical', () => {
    const db = createLegacyDb();
    const nodeColsBefore = columnsOf(db, 'graph_nodes');

    graphNodesPropsMigration.up(db);
    graphTriplesRebuildMigration.up(db);

    expect(columnsOf(db, 'graph_nodes')).toContain('props');
    expect(columnsOf(db, 'graph_nodes').filter((c) => c !== 'props')).toEqual(nodeColsBefore);
    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
  });
});
