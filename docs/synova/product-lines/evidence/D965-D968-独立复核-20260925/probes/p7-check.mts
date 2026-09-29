/**
 * p7-check.mts — P7 (graph_triples 缺 props 列) 因果性核验
 * 只用 /tmp 副本；生产库仅只读快照。
 */
import Database from 'better-sqlite3';

const WT = '/Users/wane/SynovaAgent/.synova-wt-verify-d965';
process.chdir(WT);
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);

function pragma(dbPath: string, table: string) {
  const d = new Database(dbPath, { readonly: true });
  const cols = d.pragma(`table_info(${table})`) as Array<{ name: string }>;
  d.close();
  return cols.map(c => c.name);
}

console.log('== [1] schema facts (readonly) ==');
console.log('graph_nodes columns  :', JSON.stringify(pragma('/tmp/verify-d965/db-B.db', 'graph_nodes')));
console.log('graph_triples columns:', JSON.stringify(pragma('/tmp/verify-d965/db-B.db', 'graph_triples')));

console.log('\n== [2] db-B: 3 triples present, no props col — real store runtime ==');
{
  const db = new Database('/tmp/verify-d965/db-B.db');
  const store = new SqliteGraphStore(db as never);
  const nodes = store.queryNodes('Client');
  const edgesAll = store.queryEdges();
  const edgesTyped = store.queryEdges('DEPLOYS', 'node-client-1');
  const triples = store.queryTriples({ predicate: 'DEPLOYS' });
  console.log('after construct: graph_triples cols =', JSON.stringify((db.pragma('table_info(graph_triples)') as Array<{name:string}>).map(c => c.name)));
  console.log('SELECT COUNT(*) graph_triples (via db) =', JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get()));
  console.log('queryNodes("Client").length  =', nodes.length, '(expect 2 — node path OK)');
  console.log('queryEdges().length          =', edgesAll.length, '(expect 0 despite 3 rows present)');
  console.log('queryEdges("DEPLOYS",...).length =', edgesTyped.length, '(expect 0)');
  console.log('queryTriples({predicate}).length =', triples.length, '(SELECT * — expect 1)');
  // 精确复刻 sqlite-graph-store.ts:245 的 SQL，直接抛错取证
  try {
    db.prepare("SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples WHERE graph = ? AND valid_to IS NULL").all('default');
    console.log('RAW SQL (line 245): unexpectedly OK');
  } catch (e) {
    console.log('RAW SQL (sqlite-graph-store.ts:245) throws ->', e instanceof Error ? e.message : String(e));
  }
  db.close();
}

console.log('\n== [3] 因果性: db-C = db-B + ALTER TABLE graph_triples ADD COLUMN props ==');
{
  const fs = await import('fs');
  fs.copyFileSync('/tmp/verify-d965/db-B.db', '/tmp/verify-d965/db-C.db');
  const raw = new Database('/tmp/verify-d965/db-C.db');
  raw.exec("ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'");
  raw.close();
  const db = new Database('/tmp/verify-d965/db-C.db');
  const store = new SqliteGraphStore(db as never);
  console.log('queryEdges().length (props col added) =', store.queryEdges().length, '(expect 3 → 失败可归因于缺列)');
  console.log('queryEdges("DEPLOYS").length =', store.queryEdges('DEPLOYS').length, '(expect 1)');
  db.close();
}
