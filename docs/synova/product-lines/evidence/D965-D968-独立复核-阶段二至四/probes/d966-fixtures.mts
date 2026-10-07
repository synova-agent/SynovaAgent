/**
 * d966-fixtures.mts — 复核员自建 P7 夹具（不依赖被验方脚本）
 * 19 节点（含 id==teamId 根节点）+ 3 边；三断面：legacy / props-added / canonical
 * 全部在 /tmp 副本上操作；生产库只读。
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'fs';

const SRC = '/tmp/verify-d965/synova-ro-copy.db';
const OUT = '/tmp/verify-d965';
const TEAM = 'probe-team';
const NODE_TYPES = ['Financial', 'Event', 'Person', 'Tool', 'Client', 'Process', 'Team', 'Document', 'Agent'];

function nodes() {
  const rows: Array<{ id: string; type: string; name: string; props: Record<string, unknown> }> = [
    { id: TEAM, type: 'Tool', name: TEAM, props: { name: TEAM, label: TEAM, teamId: TEAM, amount: 500, value: 50, count: 5 } },
  ];
  for (const t of NODE_TYPES) {
    for (let i = 1; i <= 2; i += 1) {
      rows.push({ id: `${t.toLowerCase()}-${i}`, type: t, name: `${t}-${i}`,
        props: { name: `${t}-${i}`, label: `${t}-${i}`, teamId: TEAM, amount: 100 * i, value: 10 * i, count: i } });
    }
  }
  return rows;
}

const edges = [
  { st: 'Tool', si: TEAM, p: 'DEPLOYS', ot: 'Process', oi: 'process-1' },
  { st: 'Tool', si: TEAM, p: 'DEPLOYS', ot: 'Process', oi: 'process-2' },
  { st: 'Tool', si: TEAM, p: 'DEPLOYS', ot: 'Tool', oi: 'tool-1' },
];

function seed(dbPath: string, withEdges: boolean, canonical: boolean) {
  const db = new Database(dbPath);
  if (canonical) {
    db.exec('DROP TABLE IF EXISTS graph_triples');
    // 由仓库 SCHEMA_SQL 重建（逐字取自 src/adapters/sqlite-graph-store.ts SCHEMA_SQL 的 graph_triples 段）
    db.exec(`
      CREATE TABLE IF NOT EXISTS graph_triples (
        id TEXT PRIMARY KEY,
        graph TEXT NOT NULL DEFAULT 'default',
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        props TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_from TEXT NOT NULL DEFAULT (datetime('now')),
        valid_to TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gt_subject ON graph_triples(graph, subject_type, subject_id);
      CREATE INDEX IF NOT EXISTS idx_gt_object ON graph_triples(graph, object_type, object_id);
      CREATE INDEX IF NOT EXISTS idx_gt_predicate ON graph_triples(graph, predicate);
      CREATE INDEX IF NOT EXISTS idx_gt_weight ON graph_triples(graph, predicate, weight);
      CREATE INDEX IF NOT EXISTS idx_gt_valid ON graph_triples(graph, valid_from, valid_to);
    `);
  }
  const insNode = db.prepare("INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, 'default', ?, ?, ?)");
  for (const n of nodes()) insNode.run(n.id, n.type, n.name, JSON.stringify(n.props));
  if (withEdges) {
    if (canonical) {
      const ins = db.prepare("INSERT INTO graph_triples (id, graph, subject_type, subject_id, predicate, object_type, object_id, weight, props) VALUES (?, 'default', ?, ?, ?, ?, ?, 1.0, '{}')");
      edges.forEach((e, i) => ins.run(`edge-canon-${i + 1}`, e.st, e.si, e.p, e.ot, e.oi));
    } else {
      const ins = db.prepare("INSERT INTO graph_triples (graph, subject_type, subject_id, predicate, object_type, object_id, weight, props_json) VALUES ('default', ?, ?, ?, ?, ?, 1.0, '{}')");
      edges.forEach((e) => ins.run(e.st, e.si, e.p, e.ot, e.oi));
    }
  }
  const n = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n;
  const t = (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n;
  const cols = (db.pragma('table_info(graph_triples)') as Array<{ name: string }>).map(c => c.name);
  const idType = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>).find(c => c.name === 'id')?.type;
  db.close();
  console.log(`${dbPath}: nodes=${n} triples=${t} props=${cols.includes('props')} idType=${idType}`);
}

if (!existsSync(SRC)) { console.error('snapshot missing'); process.exit(2); }
copyFileSync(SRC, `${OUT}/db-P-A.db`); seed(`${OUT}/db-P-A.db`, false, false);   // 19 节点 + 0 边 + legacy
copyFileSync(SRC, `${OUT}/db-P-B.db`); seed(`${OUT}/db-P-B.db`, true, false);    // 19 节点 + 3 边 + legacy
copyFileSync(SRC, `${OUT}/db-P-D.db`); seed(`${OUT}/db-P-D.db`, true, false);
{ const db = new Database(`${OUT}/db-P-D.db`); db.exec("ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'"); db.close(); }
copyFileSync(SRC, `${OUT}/db-P-F.db`); seed(`${OUT}/db-P-F.db`, true, true);     // 19 节点 + 3 边 + canonical
console.log('--- schema after build ---');
for (const s of ['A', 'B', 'D', 'F']) {
  const db = new Database(`${OUT}/db-P-${s}.db`, { readonly: true });
  const cols = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  const idc = cols.find(c => c.name === 'id');
  console.log(`db-P-${s}: props=${cols.some(c => c.name === 'props')} idColumn=${idc?.type}${idc?.type === 'INTEGER' ? '(legacy PK)' : '(TEXT PK)'} cols=${cols.length}`);
  db.close();
}
