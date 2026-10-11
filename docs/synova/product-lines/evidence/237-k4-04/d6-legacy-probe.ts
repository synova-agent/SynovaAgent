/**
 * d6-legacy-probe.ts — #237 (K4-04) D6/D7 取证探针（走**生产路径**，不是测试替身）
 *
 * 运行：`npx --no-install tsx docs/synova/product-lines/evidence/237-k4-04/d6-legacy-probe.ts`
 *
 * 做四件事（全部打印原始读数，供 D6/D7 逐条核）：
 *   ① 造"真机旧形态"库（真机 DDL：`id INTEGER PRIMARY KEY AUTOINCREMENT` + `props_json`、无 `props`）
 *   ② `new SqliteGraphStore(db)`（ctor 内 initSchema → reconcileSchema ⇒ 生产迁移路径）
 *   ③ 读面：`queryEdges()` ⇒ **具体行数 N>0** + 具体值；④ 写面：`createEdge()` ⇒ 成功 + props 落库
 *   ⑤ D7② 同形：升级后 12 列逐列比对 CTO 口径
 */
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../../../../src/adapters/sqlite-graph-store';

/** CTO 2026-10-11 裁的 canonical 12 列口径（不含 confidence / source / props_json） */
const CANONICAL_12 = [
  'id', 'graph', 'subject_type', 'subject_id', 'predicate', 'object_type',
  'object_id', 'weight', 'props', 'created_at', 'valid_from', 'valid_to',
];

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

const REAL_NODES_DDL = `
CREATE TABLE graph_nodes (
        id TEXT NOT NULL, type TEXT NOT NULL, graph TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '', confidence REAL DEFAULT 1.0,
        props_json TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_to TEXT,
        PRIMARY KEY (id, graph)
      )`;

const cols = (db: Database.Database): string[] =>
  (db.pragma('table_info(graph_triples)') as Array<{ name: string }>).map((c) => c.name);
const idType = (db: Database.Database): string | undefined =>
  (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find(
    (c) => c.name === 'id',
  )?.type;

const db = new Database(':memory:');
db.exec(REAL_NODES_DDL);
db.exec(REAL_TRIPLES_DDL);
db.prepare(
  `INSERT INTO graph_triples (subject_type, subject_id, predicate, object_type, object_id, graph, weight, props_json, valid_to)
   VALUES ('Client','c1','REVENUE_FROM','Product','p1','default',0.9,'{"action_effect_lag":"3-6_months"}',NULL),
          ('Client','c2','REVENUE_FROM','Product','p2','default',0.9,'{"share":7}',NULL)`,
).run();

console.log('[legacy] cols      =', cols(db).join(', '));
console.log('[legacy] id_type   =', idType(db));
console.log('[legacy] rows      =', (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n);
console.log('[legacy] has_props_json =', cols(db).includes('props_json'), '| has_props =', cols(db).includes('props'));

const store = new SqliteGraphStore(db); // ← 生产路径：ctor 内 initSchema + reconcileSchema

const afterCols = cols(db);
console.log('[upgraded] cols    =', afterCols.join(', '));
console.log('[upgraded] id_type =', idType(db), '| has_props =', afterCols.includes('props'), '| has_props_json =', afterCols.includes('props_json'));
console.log('[D7②] canonical_12_equal =', JSON.stringify(afterCols) === JSON.stringify(CANONICAL_12), '| count =', afterCols.length);
console.log('[D7②] removed_extra     =', ['confidence', 'source', 'props_json'].every((c) => !afterCols.includes(c)));

const edges = store.queryEdges();
console.log('[read] queryEdges N =', edges.length);
console.log('[read] values       =', JSON.stringify(edges.map((e) => ({ id: e.id, type: e.type, from: e.from, to: e.to, props: e.props }))));

const created = store.createEdge('OWNS', 'c1', 'p2', 1.0, { k: 'v' }, 'default');
console.log('[write] createEdge  =', created, '| no-throw = true');
const after = store.queryEdges();
console.log('[read-after] N      =', after.length, '| raw_props =', (db.prepare('SELECT props FROM graph_triples WHERE id = ?').get(created) as { props: string }).props);
console.log('[write] from/to     =', JSON.stringify(after.find((e) => e.id === created)));

db.close();
