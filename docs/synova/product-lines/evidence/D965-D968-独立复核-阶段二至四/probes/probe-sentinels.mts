/**
 * probe-sentinels.mts — sentinel-verifier 独立探针（D965-D968 批）
 * 作者: sentinel-verifier（不复用队长/CTO 脚本）
 *
 * 目的: 对 extensions/sentinels/ 下全部哨兵逐个执行 check(store, teamId, traversal, thresholds)，
 *       插桩计数 queryNodes/queryEdges/getNode/traverse，并按 loader 口径解包 findings。
 *
 * 用法: tsx probe-sentinels.mts --db=<path> --label=<A|B>
 * 输出: stdout 人读表 + /tmp/verify-d965/probe-<label>.json 机器读
 */
import { pathToFileURL } from 'url';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

const WT = (process.argv.find(a => a.startsWith('--wt=')) || '').slice(5) || '/Users/wane/SynovaAgent/.synova-wt-verify-d965';
process.chdir(WT); // sentinelsDir() = cwd/extensions/sentinels

const argv = process.argv.slice(2);
const dbPath = (argv.find(a => a.startsWith('--db=')) || '').slice(5);
const label = (argv.find(a => a.startsWith('--label=')) || '--label=X').slice(8);
const fixtures = (argv.find(a => a.startsWith('--fixtures=')) || '').slice(11);
const arity = Number((argv.find(a => a.startsWith('--arity=')) || '--arity=4').slice(8));
const entryMode = ((argv.find(a => a.startsWith('--entry=')) || '--entry=manifest').slice(8));
if (fixtures) process.env.SENTINELS_FIXTURE_DIR = fixtures;
if (!dbPath) { console.error('need --db=<path>'); process.exit(2); }

const { loadSentinels, resolveThresholds } = await import(`${WT}/src/sentinel/sentinel-loader.ts`);
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);
const { createGraphTraversal } = await import(`${WT}/src/l4/graph-traversal.ts`);

// ── 真 store（指向 /tmp 副本，绝不碰生产库）──
const db = new Database(dbPath);
// SQL 级取证: 任何 "FROM graph_triples" 的 prepare 是否抛错（= 边读路径是否可用）
const sqlStats = { graphTriplesPrepare: 0, graphTriplesPrepareFail: 0, graphTriplesInsert: 0, graphTriplesInsertFail: 0, graphNodesPrepare: 0 };
const origPrepare = db.prepare.bind(db);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(db as any).prepare = function (sql: string, ...rest: unknown[]) {
  const isEdgeRead = typeof sql === 'string' && /FROM\s+graph_triples/i.test(sql);
  const isEdgeInsert = typeof sql === 'string' && /INSERT\s+INTO\s+graph_triples/i.test(sql);
  if (typeof sql === 'string' && /FROM\s+graph_nodes/i.test(sql)) sqlStats.graphNodesPrepare++;
  if (isEdgeRead) sqlStats.graphTriplesPrepare++;
  if (isEdgeInsert) sqlStats.graphTriplesInsert++;
  try {
    return (origPrepare as (...a: unknown[]) => unknown)(sql, ...rest);
  } catch (e) {
    if (isEdgeRead) sqlStats.graphTriplesPrepareFail++;
    if (isEdgeInsert) sqlStats.graphTriplesInsertFail++;
    throw e;
  }
};
const realStore = new SqliteGraphStore(db as never);

function countingProxy(target: Record<string, unknown>, counts: Record<string, number>, rowCounts?: Record<string, number>) {
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v === 'function' && typeof prop === 'string') {
        return (...args: unknown[]) => {
          counts[prop] = (counts[prop] || 0) + 1;
          const res = (v as (...a: unknown[]) => unknown).apply(t, args);
          if (rowCounts && Array.isArray(res) && (prop === 'queryEdges' || prop === 'queryNodes' || prop === 'queryTriples')) rowCounts[prop] = (rowCounts[prop] || 0) + res.length;
          return res;
        };
      }
      return v;
    },
  });
}

const onlyArg = (argv.find(a => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? new Set(onlyArg.split(',')) : null;

const loadAll = loadSentinels();
const load = { ...loadAll, sentinels: only ? loadAll.sentinels.filter(s => only.has(s.manifest.name)) : loadAll.sentinels };
const rows: Record<string, unknown>[] = [];
console.log('# probe options: arity=' + arity + ' entry=' + entryMode);
const storeCallKeys = ['queryNodes', 'queryEdges', 'getNode', 'queryTriples', 'createNode', 'createEdge', 'updateNode', 'deleteNode', 'deleteEdge'];

console.log(`# probe label=${label} db=${dbPath}`);
console.log(`# loadSentinels: count=${load.sentinels.length} degraded=${load.degraded} errors=${JSON.stringify(load.errors)}`);
console.log(`# header: name | entry | rawArray | rawLen | objKeys | unpackLen | threw | storeCalls(qN/qE/getNode/trav) | ms`);

for (const { manifest, dir } of load.sentinels) {
  const entryRel = entryMode === 'hardcoded' ? './aggregate.ts' : (manifest.entryPoint || './aggregate.ts');
  const entryPath = join(dir, entryRel);
  const counts: Record<string, number> = {};
  const rowCounts: Record<string, number> = {};
  const tcounts: Record<string, number> = {};
  const rec: Record<string, unknown> = { name: manifest.name, entryPoint: manifest.entryPoint, exportKey: manifest.exportKey, entryExists: existsSync(entryPath) };
  sqlStats.graphTriplesPrepare = 0; sqlStats.graphTriplesPrepareFail = 0; sqlStats.graphTriplesInsert = 0; sqlStats.graphTriplesInsertFail = 0; sqlStats.graphNodesPrepare = 0;

  let obj: Record<string, unknown> | undefined;
  try {
    const mod = await import(pathToFileURL(entryPath).href);
    obj = mod[manifest.exportKey || 'default'] as Record<string, unknown>;
    rec.moduleLoaded = true;
    rec.hasCheck = typeof (obj as { check?: unknown })?.check === 'function';
    rec.hasManifestField = 'manifest' in (obj as object);
    rec.checkArity = typeof (obj as { check?: { length?: number } })?.check?.length === 'number' ? (obj as { check: { length: number } }).check.length : null;
  } catch (e) {
    rec.moduleLoaded = false;
    rec.moduleError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    rows.push(rec);
    console.log(`${manifest.name} | ${manifest.entryPoint} | MODULE-IMPORT-FAILED | ${rec.moduleError}`);
    continue;
  }

  // loader registerLoadedSentinels() 同款：只对声明了 manifest 字段的对象注入
  if (rec.hasManifestField) (obj as Record<string, unknown>).manifest = manifest;

  for (const k of Object.keys(rowCounts)) delete rowCounts[k];
  const storeProxy = countingProxy(realStore as unknown as Record<string, unknown>, counts, rowCounts);
  let traversal: unknown;
  try {
    traversal = createGraphTraversal(storeProxy as never);
  } catch (e) { rec.traversalBuildError = e instanceof Error ? e.message : String(e); }
  const travProxy = traversal ? countingProxy(traversal as Record<string, unknown>, tcounts) : undefined;

  const { thresholds } = await resolveThresholds(manifest.name, 'probe-team', { memoryStore: { recall: () => null } });

  const t0 = Date.now();
  let raw: unknown; let threw: string | null = null;
  try {
    const callArgs = arity >= 4 ? [storeProxy, 'probe-team', travProxy, thresholds] : arity === 3 ? [storeProxy, 'probe-team', travProxy] : [storeProxy, 'probe-team'];
    raw = await (obj as { check: (...a: unknown[]) => unknown }).check(...callArgs);
  } catch (e) {
    threw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    raw = undefined;
  }
  const ms = Date.now() - t0;

  // loader 口径解包（sentinel-loader.ts:287-290 同款公式）
  const rawIsArray = Array.isArray(raw);
  const unpackRaw = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.findings as unknown[]) ?? [];
  const unpacked: unknown[] = Array.isArray(unpackRaw) ? unpackRaw : [];
  const degradedProp = !Array.isArray(raw) && (raw as Record<string, unknown>)?.degraded === true;

  const findingIds = unpacked.map((f) => (f as { id?: string })?.id);
  const evidenceEmpties = unpacked.map((f) => {
    const ev = (f as { evidence?: unknown }).evidence;
    return Array.isArray(ev) ? ev.length : -1;
  });

  rec.rawIsArray = rawIsArray;
  rec.rawLen = rawIsArray ? (raw as unknown[]).length : null;
  rec.rawKeys = rawIsArray ? null : (raw && typeof raw === 'object' ? Object.keys(raw as object) : typeof raw);
  rec.rawType = raw === null ? 'null' : typeof raw;
  rec.unpackedLen = unpacked.length;
  rec.degradedProp = degradedProp;
  rec.threw = threw;
  rec.ms = ms;
  rec.storeCounts = counts;
  rec.rowsRead = { ...rowCounts };
  rec.traversalCounts = tcounts;
  rec.storeCallTotal = storeCallKeys.reduce((s, k) => s + (counts[k] || 0), 0);
  rec.findingIds = findingIds;
  rec.evidenceLens = evidenceEmpties;
  rec.nodeReadSqlPrepare = sqlStats.graphNodesPrepare;
  rec.edgeReadPrepare = sqlStats.graphTriplesPrepare;
  rec.edgeReadPrepareFail = sqlStats.graphTriplesPrepareFail;
  rows.push(rec);

  console.log(`${manifest.name} | ${manifest.entryPoint} | ${rawIsArray} | ${rawIsArray ? (raw as unknown[]).length : '-'} | ${rec.rawKeys ? JSON.stringify(rec.rawKeys) : '-'} | ${unpacked.length} | ${threw ? 'THREW:' + threw : 'no'} | qN=${counts.queryNodes || 0}/qE=${counts.queryEdges || 0}/getNode=${counts.getNode || 0}/trav=${tcounts.traverse || 0} | ${ms}ms`);
}

// ── 汇总 ──
const total = rows.length;
const arrayRows = rows.filter(r => r.rawIsArray === true);
const threwRows = rows.filter(r => r.threw);
const nonArrayRows = rows.filter(r => r.rawIsArray === false);
const zeroFindingsRaw = rows.filter(r => r.rawIsArray === true && r.rawLen === 0).map(r => r.name);
const zeroFindingsUnpacked = rows.filter(r => r.unpackedLen === 0).map(r => r.name);
const zeroStoreCalls = rows.filter(r => (r.storeCallTotal as number) === 0).map(r => r.name);
const unpackedNonZero = rows.filter(r => (r.unpackedLen as number) > 0).map(r => ({ name: r.name, len: r.unpackedLen, ids: r.findingIds }));

console.log('\n=== SUMMARY ' + label + ' ===');
console.log('sentinels_total=' + total);
console.log('raw_is_array_count=' + arrayRows.length);
console.log('threw_count=' + threwRows.length + (threwRows.length ? ' -> ' + JSON.stringify(threwRows.map(r => [r.name, r.threw])) : ''));
console.log('non_array_count=' + nonArrayRows.length + (nonArrayRows.length ? ' -> ' + JSON.stringify(nonArrayRows.map(r => [r.name, r.rawKeys, r.unpackedLen])) : ''));
console.log('zero_findings_raw_count=' + zeroFindingsRaw.length);
console.log('zero_findings_unpacked_count=' + zeroFindingsUnpacked.length);
console.log('unpacked_nonzero_count=' + unpackedNonZero.length + ' -> ' + JSON.stringify(unpackedNonZero));
console.log('store_zero_call_count=' + zeroStoreCalls.length + ' -> ' + JSON.stringify(zeroStoreCalls));
console.log('module_import_failures=' + JSON.stringify(rows.filter(r => r.moduleLoaded === false).map(r => [r.name, r.moduleError])));
console.log('entry_missing=' + JSON.stringify(rows.filter(r => !r.entryExists).map(r => r.name)));
console.log('hasCheck_false=' + JSON.stringify(rows.filter(r => r.hasCheck === false).map(r => r.name)));
console.log('degraded_prop_true=' + JSON.stringify(rows.filter(r => r.degradedProp === true).map(r => [r.name, r.unpackedLen])));
console.log('total_store_calls=' + rows.reduce((s, r) => s + (r.storeCallTotal as number), 0));
console.log('total_edges_queries=' + rows.reduce((s, r) => s + ((r.storeCounts as Record<string, number>).queryEdges || 0), 0));
console.log('total_nodes_queries=' + rows.reduce((s, r) => s + ((r.storeCounts as Record<string, number>).queryNodes || 0), 0));
const edgeRead = rows.reduce((s, r) => s + (r.edgeReadPrepare as number), 0);
const edgeReadFail = rows.reduce((s, r) => s + (r.edgeReadPrepareFail as number), 0);
console.log('edge_read_sql_prepare_total=' + edgeRead);
console.log('edge_read_sql_prepare_FAILED=' + edgeReadFail);
console.log('edge_read_sql_prepare_SUCCEEDED=' + (edgeRead - edgeReadFail));
console.log('edge_rows_read_total=' + rows.reduce((s, r) => s + (((r.rowsRead as Record<string, number>).queryEdges) || 0), 0));
console.log('node_rows_read_total=' + rows.reduce((s, r) => s + (((r.rowsRead as Record<string, number>).queryNodes) || 0), 0));
console.log('sentinels_with_edge_reads=' + rows.filter(r => ((r.storeCounts as Record<string, number>).queryEdges || 0) > 0).length);

writeFileSync(`/tmp/verify-d965/probe-${label}.json`, JSON.stringify({ label, dbPath, arity, entryMode, loadSentinels: { count: load.sentinels.length, degraded: load.degraded, errors: load.errors }, rows, summary: { total, arrayCount: arrayRows.length, threwCount: threwRows.length, nonArrayCount: nonArrayRows.length, zeroFindingsRaw, zeroFindingsUnpacked, zeroStoreCalls, unpackedNonZero, edgeReadPrepare: edgeRead, edgeReadPrepareFailed: edgeReadFail, edgeReadPrepareSucceeded: edgeRead - edgeReadFail } }, null, 2));
db.close();
console.log('json_written=/tmp/verify-d965/probe-' + label + '.json');
