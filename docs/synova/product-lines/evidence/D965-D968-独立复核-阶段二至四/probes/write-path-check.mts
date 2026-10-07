import Database from 'better-sqlite3';
import { copyFileSync } from 'fs';
const WT = '/Users/wane/SynovaAgent/.synova-wt-verify-d965';
process.chdir(WT);
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);
copyFileSync('/tmp/verify-d965/db-A.db', '/tmp/verify-d965/db-W.db');
const db = new Database('/tmp/verify-d965/db-W.db');
const store = new SqliteGraphStore(db as never);
console.log('-- createNode (graph_nodes 有 props) --');
let nid = '';
try { nid = store.createNode('Client', { name: '写入测试' }, 'default'); console.log('createNode OK id=' + nid); }
catch (e) { console.log('createNode THREW:', e instanceof Error ? e.message : String(e)); }
console.log('-- createEdge (graph_triples 无 props) --');
try { const eid = store.createEdge('DEPLOYS', nid || 'x', nid || 'y', 1, {}, 'default'); console.log('createEdge OK id=' + eid); }
catch (e) { console.log('createEdge THREW:', e instanceof Error ? e.message : String(e)); }
console.log('-- rows after --', JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get()), JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get()));
db.close();
