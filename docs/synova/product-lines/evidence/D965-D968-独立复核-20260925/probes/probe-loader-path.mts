/**
 * probe-loader-path.mts — 走 loader 自身解包路径（registerLoadedSentinels + registry.check）
 * 生产库被重定向到 /tmp 副本（SYNOVA_DB_PATH），绝不触碰 data/synova.db。
 */
process.env.SYNOVA_DB_PATH = '/tmp/verify-d965/db-loader.db';
const WT = '/Users/wane/SynovaAgent/.synova-wt-verify-d965';
process.chdir(WT);

const { initEngineContext, getDatabase } = await import(`${WT}/src/init/engine-context.ts`);
initEngineContext();
const db = getDatabase();
console.log('# db opened at =', (db as unknown as { name: string }).name);
if (!String((db as unknown as { name: string }).name).startsWith('/tmp/verify-d965/')) {
  console.error('FATAL: DB not redirected to /tmp — abort');
  process.exit(3);
}

const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);
const store = new SqliteGraphStore(db as never);

const { registerLoadedSentinels, loadSentinels } = await import(`${WT}/src/sentinel/sentinel-loader.ts`);
const { getSentinelRegistry } = await import(`${WT}/src/sentinel/registry.ts`);

const loadResult = loadSentinels();
console.log('# loadSentinels count=', loadResult.sentinels.length, 'errors=', JSON.stringify(loadResult.errors));
const reg = await registerLoadedSentinels();
console.log('# registerLoadedSentinels =', JSON.stringify(reg));
const registry = getSentinelRegistry();
const list = registry.list();
console.log('# registry.list().length =', list.length);

const out: Array<Record<string, unknown>> = [];
let totalFindings = 0;
const perId: Record<string, number> = {};
for (const s of list) {
  const t0 = Date.now();
  const r = await s.check({ db: store, teamId: 'probe-team', now: new Date() });
  const ids = (r.findings || []).map(f => f.id);
  const evLens = (r.findings || []).map(f => (Array.isArray(f.evidence) ? f.evidence.length : -1));
  totalFindings += ids.length;
  for (const id of ids) perId[id] = (perId[id] || 0) + 1;
  out.push({ id: s.config.id, findings: ids.length, ids, evidenceLens: evLens, degraded: r.degraded === true, ok: r.ok, ms: Date.now() - t0 });
  if (ids.length > 0) console.log(`${s.config.id} -> findings=${ids.length} ids=${JSON.stringify(ids)} evidenceLens=${JSON.stringify(evLens)} degraded=${r.degraded === true}`);
}

console.log('\n=== LOADER-PATH SUMMARY ===');
console.log('registered_sentinels=' + list.length);
console.log('sentinels_with_findings=' + out.filter(o => (o.findings as number) > 0).length);
console.log('sentinels_zero_findings=' + out.filter(o => (o.findings as number) === 0).length);
console.log('total_findings_via_loader=' + totalFindings);
console.log('finding_id_histogram=' + JSON.stringify(perId));
console.log('zero_finding_ids=' + JSON.stringify(out.filter(o => (o.findings as number) === 0).map(o => o.id)));

const fs = await import('fs');
fs.writeFileSync('/tmp/verify-d965/probe-loader-path.json', JSON.stringify({ dbPath: (db as unknown as { name: string }).name, registered: reg, listLength: list.length, out }, null, 2));
console.log('json_written=/tmp/verify-d965/probe-loader-path.json');
