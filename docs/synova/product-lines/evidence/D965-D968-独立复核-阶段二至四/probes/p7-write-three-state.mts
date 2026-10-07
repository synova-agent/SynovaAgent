/**
 * p7-write-three-state.mts — P7 写路径三态（复核员自建，不依赖被验方脚本）
 * legacy / props-added / canonical → createNode → createEdge → queryEdges 读回
 */
import Database from 'better-sqlite3';
const WT = '/Users/wane/SynovaAgent/.synova-wt-verify-base2';
process.chdir(WT);
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);

for (const section of ['A', 'D', 'F'] as const) {
  const path = `/tmp/verify-d965/db-P-${section}.db`;
  const db = new Database(path);
  const cols = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  console.log(`\n═══ section P-${section} ═══ props=${cols.some(c => c.name === 'props')} idType=${cols.find(c => c.name === 'id')?.type}`);
  const store = new SqliteGraphStore(db as never);
  let nid = '';
  try { nid = store.createNode('Client', { name: '写路径测试' }, 'default'); console.log('createNode: OK'); }
  catch (e) { console.log('createNode: THREW', e instanceof Error ? e.message : String(e)); }
  let wrote = false;
  try {
    const eid = store.createEdge('DEPLOYS', nid, nid, 1, {}, 'default');
    console.log('createEdge: OK id=' + eid); wrote = true;
  } catch (e) { console.log('createEdge: THREW', e instanceof Error ? e.message : String(e)); }
  const back = store.queryEdges('DEPLOYS', nid, undefined, 'default');
  console.log('queryEdges read-back rows =', back.length, wrote && back.length > 0 ? '(写后可读)' : '');
  const rawCount = (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n;
  console.log('raw table rows =', rawCount);
  db.close();
}
