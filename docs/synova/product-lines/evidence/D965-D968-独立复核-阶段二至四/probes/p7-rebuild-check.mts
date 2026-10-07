/**
 * p7-rebuild-check.mts — P7 整表重建独立复核（自建夹具，生产副本只读）
 * 态: L=legacy(有数据) / P=props-added(有数据) / C=canonical / F=全新库
 * 断言: ① 结构回 canonical ② 旧行按列映射搬运（行数不丢、props_json→props、id→TEXT、valid_to 保留）
 *       ③ 写路径可用（createEdge）④ 读路径可用（queryEdges 读回）⑤ 幂等
 */
import Database from 'better-sqlite3';
import { copyFileSync } from 'fs';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const OUT = '/tmp/verify-d967';
const { graphTriplesRebuildMigration } = await import(`${WT}/src/store/migrations/002-graph-triples-rebuild.ts`);
const { reconcileSchema } = await import(`${WT}/src/store/schema-migration.ts`);
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);

function buildLegacy(path: string, withProps: boolean) {
  copyFileSync(`${OUT}/prod.db`, path);
  const db = new Database(path);
  db.exec("DROP TABLE IF EXISTS graph_triples");
  db.exec(`CREATE TABLE graph_triples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
    predicate TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
    graph TEXT NOT NULL, weight REAL DEFAULT 1.0,
    props_json TEXT DEFAULT '{}', confidence REAL DEFAULT 1.0, source TEXT,
    valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const i of [1, 2, 3]) {
    db.prepare(`INSERT INTO graph_triples
      (subject_type, subject_id, predicate, object_type, object_id, graph, weight, props_json, valid_to)
      VALUES ('Tool','probe-team','DEPLOYS','Process','process-${i}','default', 1.0, '{"edge":"${i}"}', ${i === 3 ? "'2026-01-01 00:00:00'" : 'NULL'})`).run();
  }
  db.prepare("INSERT INTO graph_nodes (id, graph, type, name, props) VALUES ('probe-team','default','Tool','probe-team','{\"name\":\"probe-team\"}')").run();
  if (withProps) db.exec("ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'");
  db.close();
}

function inspect(path: string, tag: string) {
  const db = new Database(path);
  const cols = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  const idc = cols.find(c => c.name === 'id');
  const propsExpr = cols.some(c => c.name === 'props') ? 'props' : 'NULL AS props';
  const pjExpr = cols.some(c => c.name === 'props_json') ? 'props_json' : 'NULL AS props_json';
  const rows = db.prepare(`SELECT id, typeof(id) AS idt, predicate, ${propsExpr}, ${pjExpr}, valid_to FROM graph_triples ORDER BY id`).all() as Array<Record<string, unknown>>;
  const idx = (db.pragma('index_list(graph_triples)') as Array<{ name: string }>).map(i => i.name).sort();
  console.log(`[${tag}] id=${idc?.type} props=${cols.some(c => c.name === 'props')} rows=${rows.length} idx=[${idx.join(',')}]`);
  rows.forEach(r => console.log(`   id=${String(r.id).slice(0, 22)} (${r.idt}) props=${JSON.stringify(r.props)} props_json=${JSON.stringify(r.props_json)} valid_to=${r.valid_to}`));
  db.close();
  return { cols, rows, idx };
}

console.log('═══════ 态 L：legacy + 3 行数据（含 1 行软删除）═══════');
buildLegacy(`${OUT}/p7-L.db`, false);
inspect(`${OUT}/p7-L.db`, 'L before');
{
  const db = new Database(`${OUT}/p7-L.db`);
  graphTriplesRebuildMigration.up(db);
  db.close();
}
const after = inspect(`${OUT}/p7-L.db`, 'L after ');
{
  const db = new Database(`${OUT}/p7-L.db`);
  const store = new SqliteGraphStore(db as never);
  let edgeOk = 'NO', readBack = 0;
  try { store.createEdge('DEPLOYS', 'probe-team', 'process-9', 1, {}, 'default'); edgeOk = 'YES'; } catch (e) { edgeOk = 'THREW:' + (e instanceof Error ? e.message : String(e)); }
  readBack = store.queryEdges('DEPLOYS', undefined, undefined, 'default').length;
  console.log(`[L after] createEdge = ${edgeOk} | queryEdges 读回 = ${readBack} 行`);
  // 幂等：再跑一次 reconcileSchema（含 002）
  const before3 = db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number };
  reconcileSchema(db);
  const after3 = db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number };
  console.log(`[L after] 幂等: reconcileSchema 再跑 → 行数 ${before3.n} → ${after3.n}（应不变），列数 ${(db.pragma('table_info(graph_triples)') as unknown[]).length}`);
  db.close();
}
console.log(`断言: 结构回 canonical=${after.cols.some(c => c.name === 'props') && after.cols.find(c => c.name === 'id')?.type === 'TEXT'}`
  + ` 行数不丢=${after.rows.length === 3}`
  + ` props_json→props=${after.rows.every(r => typeof r.props === 'string' && r.props.includes('edge'))}`
  + ` valid_to 保留=${after.rows.some(r => r.valid_to !== null)}`
  + ` 5 索引=${after.idx.length === 5}`);

console.log('\n═══════ 态 P：props-added（id 仍 INTEGER）+ 3 行 ═══════');
buildLegacy(`${OUT}/p7-P.db`, true);
inspect(`${OUT}/p7-P.db`, 'P before');
{
  const db = new Database(`${OUT}/p7-P.db`);
  const r = (() => { try { new SqliteGraphStore(db as never); return 'store 构造 OK'; } catch (e) { return 'THREW:' + (e instanceof Error ? e.message : String(e)); } })();
  console.log(`[P before] ${r}`);
  // 写路径在 props-added 态仍然坏（id INTEGER ← TEXT）
  const store = new SqliteGraphStore(db as never);
  try { store.createEdge('DEPLOYS', 'probe-team', 'process-9', 1, {}, 'default'); console.log('[P before] createEdge = YES（意外）'); }
  catch (e) { console.log('[P before] createEdge THREW:', e instanceof Error ? e.message : String(e)); }
  graphTriplesRebuildMigration.up(db);
  const store2 = new SqliteGraphStore(db as never);
  let ok = 'NO';
  try { store2.createEdge('DEPLOYS', 'probe-team', 'process-9', 1, {}, 'default'); ok = 'YES'; } catch (e) { ok = 'THREW:' + (e instanceof Error ? e.message : String(e)); }
  console.log(`[P after ] createEdge = ${ok} | queryEdges 读回 = ${store2.queryEdges('DEPLOYS').length} 行`);
  db.close();
}
inspect(`${OUT}/p7-P.db`, 'P after ');

console.log('\n═══════ 态 F：全新库（graph_triples 不存在）→ 迁移 no-op ═══════');
{
  const p = `${OUT}/p7-F.db`;
  const db = new Database(p);
  db.exec('CREATE TABLE placeholder (x INTEGER)');
  const obj = db.prepare("SELECT type FROM sqlite_master WHERE name='graph_triples'").get();
  graphTriplesRebuildMigration.up(db);
  console.log(`[F] graph_triples 存在与否 = ${String(Boolean(obj))} → 迁移后存在与否 = ${Boolean(db.prepare("SELECT type FROM sqlite_master WHERE name='graph_triples'").get())}（no-op，交给 initSchema）`);
  db.close();
}
