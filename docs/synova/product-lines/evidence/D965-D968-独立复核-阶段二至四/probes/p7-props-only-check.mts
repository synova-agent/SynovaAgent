/**
 * p7-props-only-check.mts — 「只 ALTER ADD COLUMN 修不好写路径」判别性复核
 * 关键: 把 schema_version 数值行钉到 4（= 迁移视为已完成），使 SqliteGraphStore 构造器的
 *       reconcileSchema 早退、**不自动修表**，从而观测"仅补列"断面的真实读写行为。
 */
import Database from 'better-sqlite3';
import { copyFileSync } from 'fs';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const OUT = '/tmp/verify-d967';
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);
const { graphTriplesRebuildMigration } = await import(`${WT}/src/store/migrations/002-graph-triples-rebuild.ts`);

function build(path: string, propsCol: boolean, versionPin: number) {
  copyFileSync(`${OUT}/prod.db`, path);
  const db = new Database(path);
  db.exec('DROP TABLE IF EXISTS graph_triples');
  db.exec(`CREATE TABLE graph_triples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
    predicate TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
    graph TEXT NOT NULL, weight REAL DEFAULT 1.0,
    props_json TEXT DEFAULT '{}', confidence REAL DEFAULT 1.0, source TEXT,
    valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const i of [1, 2]) {
    db.prepare(`INSERT INTO graph_triples (subject_type, subject_id, predicate, object_type, object_id, graph, weight, props_json)
      VALUES ('Tool','probe-team','DEPLOYS','Process','process-${i}','default',1.0,'{"edge":"${i}"}')`).run();
  }
  if (propsCol) db.exec("ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'");
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(versionPin);
  db.close();
}

for (const [tag, propsCol] of [['legacy(仅缺列)', false], ['props-added(只补列)', true]] as Array<[string, boolean]>) {
  const p = `${OUT}/p7-only-${propsCol ? 'P' : 'L'}.db`;
  build(p, propsCol, 4);
  console.log(`\n═══ ${tag} ═══ schema_version MAX 已钉 4 ⇒ 构造器不得自动修表`);
  const db = new Database(p);
  const cols0 = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  console.log(`构造前: id=${cols0.find(c => c.name === 'id')?.type} props=${cols0.some(c => c.name === 'props')}`);
  const store = new SqliteGraphStore(db as never);
  const cols1 = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  console.log(`构造后（应不变）: id=${cols1.find(c => c.name === 'id')?.type} props=${cols1.some(c => c.name === 'props')}`);
  let writeRes = '';
  try { const id = store.createEdge('DEPLOYS', 'probe-team', 'process-9', 1, {}, 'default'); writeRes = `OK id=${id}`; }
  catch (e) { writeRes = `THREW: ${e instanceof Error ? e.message : String(e)}`; }
  const readRows = store.queryEdges('DEPLOYS', undefined, undefined, 'default').length;
  console.log(`createEdge = ${writeRes}`);
  console.log(`queryEdges 读回 = ${readRows} 行（表内 2 行）`);
  // 只有整表重建才修好写路径
  graphTriplesRebuildMigration.up(db);
  const store2 = new SqliteGraphStore(db as never);
  let writeRes2 = '';
  try { const id = store2.createEdge('DEPLOYS', 'probe-team', 'process-9', 1, {}, 'default'); writeRes2 = `OK id=${id.slice(0, 20)}`; }
  catch (e) { writeRes2 = `THREW: ${e instanceof Error ? e.message : String(e)}`; }
  console.log(`整表重建后 createEdge = ${writeRes2} | queryEdges 读回 = ${store2.queryEdges('DEPLOYS').length} 行`);
  db.close();
}
