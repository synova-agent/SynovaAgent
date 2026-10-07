/**
 * nd-mechanism.mts — 「文本版本行 ⇒ pending 恒空 ⇒ 零迁移」机制复现（自实现）
 * 对同一生产副本，用两种读取逻辑各自计算 pending（迁移清单 = PR-A 的三支）
 */
import Database from 'better-sqlite3';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const DB = process.argv.find(a => a.startsWith('--db='))!.slice(5);

const { graphNodesPropsMigration } = await import(`${WT}/src/store/migrations/001-graph-nodes-props.ts`);
const { graphTriplesRebuildMigration } = await import(`${WT}/src/store/migrations/002-graph-triples-rebuild.ts`);
const { measurementsTableMigration } = await import(`${WT}/src/store/migrations/003-measurements-table.ts`);
const migrations = [graphNodesPropsMigration, graphTriplesRebuildMigration, measurementsTableMigration]
  .map(m => ({ version: (m as { version: number }).version, name: (m as { name: string }).name }));
const SCHEMA_VERSION = 4;

const db = new Database(DB, { readonly: true });
const oldRow = db.prepare('SELECT version FROM schema_version ORDER BY updated_at DESC LIMIT 1').get() as { version: unknown } | undefined;
const newRow = db.prepare("SELECT MAX(version) AS version FROM schema_version WHERE typeof(version) IN ('integer','real')").get() as { version: number | null } | undefined;

const oldVersion = oldRow?.version;
const newVersion = typeof newRow?.version === 'number' && Number.isFinite(newRow.version) ? newRow.version : 0;

// 旧逻辑（逐字复刻 main ef299746 的比较）
const oldPending = migrations.filter(m => m.version > (oldVersion as number) && m.version <= SCHEMA_VERSION);
// 新逻辑（PR-A）
const newPending = migrations.filter(m => m.version > newVersion && m.version <= SCHEMA_VERSION);

console.log(`# db=${DB}`);
console.log(`旧口径 currentVersion = ${JSON.stringify(oldVersion)} (typeof=${typeof oldVersion})`);
console.log(`新口径 currentVersion = ${newVersion}`);
console.log(`迁移清单 = ${JSON.stringify(migrations)}  SCHEMA_VERSION=${SCHEMA_VERSION}`);
console.log(`旧逻辑 pending = ${JSON.stringify(oldPending)}   ← 期望空（NaN 比较恒 false）`);
console.log(`新逻辑 pending = ${JSON.stringify(newPending)}`);
console.log(`旧逻辑是否早退(currentVersion >= SCHEMA_VERSION) = ${(oldVersion as number) >= SCHEMA_VERSION}   (NaN 比较 → false)`);
console.log(`NaN 比较复现: ('d93b_actor_role' > 3) = ${('d93b_actor_role' as unknown as number) > 3} ; ('d93b_actor_role' >= 4) = ${('d93b_actor_role' as unknown as number) >= 4}`);
// 反例边界：migration 001 曾跑过的物理证据
const gn = (db.pragma('table_info(graph_nodes)') as Array<{ name: string }>).map(c => c.name);
const intRows = db.prepare("SELECT COUNT(*) AS n FROM schema_version WHERE typeof(version) IN ('integer','real')").get() as { n: number };
console.log(`反例边界: graph_nodes.props 存在 = ${gn.includes('props')} ; schema_version 数值行数 = ${intRows.n}`);
db.close();
