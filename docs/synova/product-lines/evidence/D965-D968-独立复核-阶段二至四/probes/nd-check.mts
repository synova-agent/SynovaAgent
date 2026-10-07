/**
 * nd-check.mts — D967「迁移机制整体失效 / 非确定性」独立复核
 * 用法: tsx nd-check.mts --wt=<worktree> --db=<db> --label=<A|B|...> [--apply]
 * 打印: 旧口径读取结果 / 新口径读取结果 / reconcileSchema 前后的 schema_version / measurements / graph_triples 形态
 */
import Database from 'better-sqlite3';
const arg = (k: string, d = '') => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const WT = arg('wt');
const DB = arg('db');
const LABEL = arg('label', 'X');
const APPLY = process.argv.includes('--apply');

const mod = await import(`${WT}/src/store/schema-migration.ts`);
const { reconcileSchema, SCHEMA_VERSION } = mod as { reconcileSchema: (db: unknown) => void; SCHEMA_VERSION: number };

const db = new Database(DB);
const q = <T>(sql: string): T[] => db.prepare(sql).all() as T[];

function state(tag: string) {
  const rows = q<{ rowid: number; version: unknown; t: string; updated_at: string }>(
    'SELECT rowid, version, typeof(version) AS t, updated_at FROM schema_version ORDER BY rowid');
  const oldRead = q<{ version: unknown; t: string; updated_at: string }>(
    'SELECT version, typeof(version) AS t, updated_at FROM schema_version ORDER BY updated_at DESC LIMIT 1');
  const newRead = q<{ v: number | null }>(
    "SELECT MAX(version) AS v FROM schema_version WHERE typeof(version) IN ('integer','real')");
  const hasMeas = q<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='measurements'");
  const gcols = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  const measCols = hasMeas[0].n
    ? (db.pragma('table_info(measurements)') as Array<{ name: string }>).map(c => c.name)
    : [];
  console.log(`[${LABEL}:${tag}] rows=${rows.length} | 旧口径→${String(oldRead[0]?.version)} (typeof=${oldRead[0]?.t}) | 新口径 MAX=${newRead[0]?.v} | measurements=${hasMeas[0].n ? 'YES' : 'no'} | graph_triples: id=${gcols.find(c => c.name === 'id')?.type} props=${gcols.some(c => c.name === 'props')}`);
  return { rows, oldVersion: oldRead[0]?.version, oldType: oldRead[0]?.t, newMax: newRead[0]?.v, hasMeas: !!hasMeas[0].n, measCols, gcols };
}

console.log(`# wt=${WT} SCHEMA_VERSION=${SCHEMA_VERSION} db=${DB} apply=${APPLY}`);
const before = state('before');
if (APPLY) {
  const t0 = Date.now();
  reconcileSchema(db);
  console.log(`# reconcileSchema() took ${Date.now() - t0}ms`);
}
const after = state(APPLY ? 'after' : 'no-apply');
console.log(`[${LABEL}] SUMMARY oldVersion=${String(before.oldVersion)}(${before.oldType}) newMax=${before.newMax} | apply=${APPLY} | measurements ${before.hasMeas}→${after.hasMeas} | vRows ${before.rows.length}→${after.rows.length}`);
db.close();
