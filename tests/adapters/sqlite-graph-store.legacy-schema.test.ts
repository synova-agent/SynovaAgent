/**
 * tests/adapters/sqlite-graph-store.legacy-schema.test.ts — #237 (K4-04) 旧库图边读/写
 *
 * 卡面 Done① 的验收入口：`npx vitest run tests/adapters/sqlite-graph-store.legacy-schema.test.ts` ⇒ exit 0
 * （含：旧库升级后 createEdge 成功、queryEdges 取到数据）。
 *
 * 为什么要单独一份：既有 5 处图存储用例（`tests/adapters/sqlite-graph-store.test.ts:14`、
 * `tests/l4/synova-graph-store.test.ts:7`、`tests/l4/synova-graph-store-permission.test.ts:18`、
 * `tests/packages/graph-store-wal.test.ts:33`、`tests/agent/graph-store-service.test.ts:19`）
 * **全用 `:memory:` 新库** —— `CREATE TABLE IF NOT EXISTS` 对已存在表 no-op，新库直接建成
 * canonical 形状 ⇒ **结构性测不到旧库**。真机 `graph_triples` 是
 * `id INTEGER PRIMARY KEY AUTOINCREMENT` + `props_json`（**无 `props`**）：
 * 读面 `no such column: props`、写面 `datatype mismatch`（均实测）。
 *
 * 本文件不 mock：用"真机形态"夹具走**同一条生产路径** `new SqliteGraphStore(db)`
 * （ctor 内 `initSchema()` → `reconcileSchema()`）⇒ 读面 `queryEdges()` / 写面 `createEdge()` 双通。
 *
 * 夹具口径（K3 可核）：`REAL_*_DDL` **逐字抄真机 `data/synova.db`**（2026-10-09 实测
 * `sqlite_master.sql`；见 `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md`
 * §4.2 快照行：`graph_triples 迁移前 = id:INTEGER(pk), …, weight:REAL, props_json:TEXT,
 * confidence:REAL, source:TEXT, …`）；`graph_nodes` 去掉 001 已补的 `props` 列以还原"真·旧形态"。
 * 判别性断言一律用**具体行数 / 具体值**（禁用 `Array.isArray` 之类在坏库上照样绿的恒真式）。
 *
 * 铁律 33（*.test.ts 单元测试）/ 47（契约在源侧）/ 48（非空壳：正常 + 边界全覆盖）。
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';

/** canonical `graph_triples` 期望列（12 列；CTO 2026-10-11 裁——不含 `confidence` / `source` / `props_json`） */
const EXPECTED_CANONICAL_COLUMNS = [
  'id', 'graph', 'subject_type', 'subject_id', 'predicate', 'object_type',
  'object_id', 'weight', 'props', 'created_at', 'valid_from', 'valid_to',
];

/** 真机 `graph_triples` DDL —— 逐字抄 `data/synova.db` 实测 `sqlite_master.sql`（含 `id INTEGER PRIMARY KEY AUTOINCREMENT`） */
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

/** 真机 `graph_nodes` DDL —— 逐字抄，去掉 001 已补的 `props` 列（还原真·旧形态） */
const REAL_NODES_DDL = `
CREATE TABLE graph_nodes (
        id TEXT NOT NULL, type TEXT NOT NULL, graph TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '', confidence REAL DEFAULT 1.0,
        props_json TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_to TEXT,
        PRIMARY KEY (id, graph)
      )`;

/** 造"真机旧形态"库：两表均 `props_json`、无 `props`、无 `schema_version` 表 */
function createLegacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(REAL_NODES_DDL);
  db.exec(REAL_TRIPLES_DDL);
  for (const idx of REAL_TRIPLES_INDEXES) db.exec(idx);
  return db;
}

/** 真机形态下插边：`id` 由 AUTOINCREMENT 生成（不能显式传 TEXT id，那正是 `datatype mismatch` 的来源之一） */
function insertLegacyEdge(
  db: Database.Database,
  subjectId: string,
  objectId: string,
  propsJson: string | null,
): void {
  db.prepare(
    `INSERT INTO graph_triples (subject_type, subject_id, predicate, object_type, object_id, graph, weight, props_json, valid_to)
     VALUES ('Client', ?, 'REVENUE_FROM', 'Product', ?, 'default', 0.9, ?, NULL)`,
  ).run(subjectId, objectId, propsJson);
}

const columnsOf = (db: Database.Database, t: string): string[] =>
  (db.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);

const idColumnType = (db: Database.Database): string | undefined =>
  (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find(
    (c) => c.name === 'id',
  )?.type;

const edgeCount = (db: Database.Database): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n;

const rawProps = (db: Database.Database, id: string): string =>
  (db.prepare('SELECT props FROM graph_triples WHERE id = ?').get(id) as { props: string }).props;

describe('SqliteGraphStore — 旧库（真机 DDL）升级后读面', () => {
  it('① queryEdges() 读回旧边 2 条，且 props 由 props_json 迁入、端点映射正确', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');
    insertLegacyEdge(db, 'c2', 'p2', '{"share":7}');

    const store = new SqliteGraphStore(db); // ctor: initSchema → reconcileSchema（生产路径）
    const edges = store.queryEdges();

    // 判别断言：具体条数 N>0 + 具体值
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.type === 'REVENUE_FROM')).toBe(true);
    const byFrom = new Map(edges.map((e) => [e.from, e.props]));
    expect(byFrom.get('c1')).toEqual({ action_effect_lag: '3-6_months' });
    expect(byFrom.get('c2')).toEqual({ share: 7 });
    expect(edges.find((e) => e.from === 'c1')?.to).toBe('p1');
  });

  it('边界：旧库边表为空 ⇒ 升级后 queryEdges() = []（合法空，不是"读失败被吞"）', () => {
    const db = createLegacyDb();
    const store = new SqliteGraphStore(db);

    expect(store.queryEdges()).toEqual([]);
    // 反向锚：同一库写一条后必须读得回来（证明上面的 [] 是"确实没有"，不是"读不出来"）
    const id = store.createEdge('OWNS', 'c1', 'p1');
    expect(store.queryEdges().map((e) => e.id)).toEqual([id]);
  });
});

describe('SqliteGraphStore — 旧库（真机 DDL）升级后写面', () => {
  it('① createEdge() 成功：返回 edge- 前缀 id、props 正确落库、queryEdges 计数 +1', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"share":7}');
    const store = new SqliteGraphStore(db);
    expect(store.queryEdges()).toHaveLength(1);

    let created = '';
    expect(() => {
      created = store.createEdge('OWNS', 'c1', 'p2', 1.0, { k: 'v' }, 'default');
    }).not.toThrow();

    expect(created).toMatch(/^edge-/);
    expect(store.queryEdges()).toHaveLength(2);
    const fresh = store.queryEdges().find((e) => e.id === created);
    expect(fresh?.type).toBe('OWNS');
    expect(fresh?.from).toBe('c1');
    expect(fresh?.to).toBe('p2');
    expect(fresh?.props).toEqual({ k: 'v' });
    // 落库面（不经读路径的二次确认）：列里就是 {"k":"v"}
    expect(JSON.parse(rawProps(db, created))).toEqual({ k: 'v' });
  });

  it('① 表形状转 canonical：id 列 TEXT、props 在、props_json 已移除、12 列逐列一致', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"share":7}');

    expect(idColumnType(db)).toBe('INTEGER'); // 升级前：真机形态
    const store = new SqliteGraphStore(db);
    expect(store.queryEdges()).toHaveLength(1);

    expect(idColumnType(db)).toBe('TEXT'); // 升级后：canonical 主键形状（写面不再 datatype mismatch 的根因）
    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
    expect(columnsOf(db, 'graph_triples')).not.toContain('props_json');
    expect(columnsOf(db, 'graph_triples')).not.toContain('confidence');
    expect(columnsOf(db, 'graph_triples')).not.toContain('source');
  });

  it('边界：同库二次构造（幂等）⇒ 不重复搬运、行数与 props 均不变', () => {
    const db = createLegacyDb();
    insertLegacyEdge(db, 'c1', 'p1', '{"action_effect_lag":"3-6_months"}');

    const first = new SqliteGraphStore(db);
    expect(first.queryEdges()).toHaveLength(1);
    const colsAfterFirst = columnsOf(db, 'graph_triples');

    const second = new SqliteGraphStore(db);
    expect(second.queryEdges()).toHaveLength(1);
    expect(columnsOf(db, 'graph_triples')).toEqual(colsAfterFirst);
    expect(edgeCount(db)).toBe(1);
    expect(second.queryEdges()[0].props).toEqual({ action_effect_lag: '3-6_months' });
  });

  it('回归：全新 :memory: 库（无旧表）⇒ 迁移 no-op，读写正常', () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);

    const a = store.createNode('Person', { name: 'n-a' }, 'default');
    const b = store.createNode('Team', { name: 'n-b' }, 'default');
    const id = store.createEdge('MEMBER_OF', a, b, 1.0, { role: 'lead' }, 'default');

    expect(columnsOf(db, 'graph_triples')).toEqual([...EXPECTED_CANONICAL_COLUMNS]);
    const edges = store.queryEdges('MEMBER_OF', a, undefined, 'default');
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe(id);
    expect(edges[0].props).toEqual({ role: 'lead' });
  });
});
