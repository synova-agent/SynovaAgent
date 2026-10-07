/**
 * wiring-check.mts — D967 ③/⑤ 独立验收（自建探针，公开 API，:memory: 库）
 * 结构: reconcileSchema → CronScheduler → SentinelRunner → runOnce ×N → 读 measurements / diffMeasurement
 */
import Database from 'better-sqlite3';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const { reconcileSchema } = await import(`${WT}/src/store/schema-migration.ts`);
const { CronScheduler } = await import(`${WT}/src/cron/scheduler.ts`);
const { SentinelRunner } = await import(`${WT}/src/sentinel/runner.ts`);
const { getSentinelRegistry, destroySentinelRegistry } = await import(`${WT}/src/sentinel/registry.ts`);
const { createSentinelEventsTable } = await import(`${WT}/src/sentinel/sentinel-events.ts`);
const { queryMeasurements, diffMeasurement } = await import(`${WT}/src/store/measurements.ts`);

const SID = 'vd967-probe';
let nextFindings: Array<Record<string, unknown>> = [];
const mkFinding = (i: number, sev: 'critical' | 'warning') => ({
  id: `f${i}`, severity: sev, title: `t${i}`, description: `d${i}`, evidence: [], detectedAt: new Date().toISOString(),
});

const db = new Database(':memory:');
console.log('# 隔离检查: db.name =', db.name, '（:memory: = 未触碰任何磁盘库）');
reconcileSchema(db);
const hasMeas = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='measurements'").get() as { n: number }).n;
console.log('# reconcileSchema 后 measurements 表存在 =', !!hasMeas);
const cols = (db.pragma('table_info(measurements)') as Array<{ name: string; type: string; pk: number }>);
console.log('# measurements 列 =', JSON.stringify(cols.map(c => `${c.name}:${c.type}${c.pk ? '(pk)' + c.pk : ''}`)));
const idx = (db.pragma('index_list(measurements)') as Array<{ name: string; unique: number }>);
console.log('# measurements 索引 =', JSON.stringify(idx));
const idxCols = idx.filter(i => i.name === 'idx_measurements_entity_metric_time')
  .map(i => (db.pragma(`index_info(${i.name})`) as Array<{ name: string }>).map(c => c.name));
console.log('# 时序索引列 =', JSON.stringify(idxCols));

const scheduler = new CronScheduler(db);
const runner = new SentinelRunner(scheduler, db);
createSentinelEventsTable(db);
destroySentinelRegistry();
getSentinelRegistry().register({
  config: { id: SID, name: 'verifier probe', description: 'd967 verification probe', category: 'growth', priority: 'P1', mode: 'on-demand', version: '1', requiredDataSources: [] },
  async check() {
    return { sentinelId: SID, ok: true, findings: nextFindings, durationMs: 1, checkedAt: new Date().toISOString() };
  },
} as never);

async function run(label: string, findings: Array<Record<string, unknown>>) {
  nextFindings = findings;
  const t0 = Date.now();
  await (runner as unknown as { runOnce: (id: string) => Promise<unknown> }).runOnce(SID);
  console.log(`# run ${label}: findings=${findings.length} (${Date.now() - t0}ms)`);
}

await new Promise(r => setTimeout(r, 1100)); // 保证 computed_at 秒级不同
await run('R1', [mkFinding(1, 'critical'), mkFinding(2, 'warning'), mkFinding(3, 'warning')]);
await new Promise(r => setTimeout(r, 1100));
await run('R2', [mkFinding(1, 'critical'), mkFinding(2, 'critical'), mkFinding(3, 'warning'), mkFinding(4, 'warning'), mkFinding(5, 'warning')]);
await new Promise(r => setTimeout(r, 1100));
await run('R3-零finding', []);

const rows = queryMeasurements(db, { metricId: `${SID}:finding_count` });
console.log('\n# measurements(:finding_count) 行 =', JSON.stringify(rows, null, 1));

const from = rows[0]?.computedAt ?? '';
const to = rows[1]?.computedAt ?? '';
const d = diffMeasurement(db, '', `${SID}:finding_count`, from, to);
console.log('\n# diffMeasurement(from=R1, to=R2) =', JSON.stringify(d));
const dcrit = diffMeasurement(db, '', `${SID}:critical_count`, from, to);
console.log('# diffMeasurement(critical) =', JSON.stringify(dcrit));
const allRows = queryMeasurements(db, {});
console.log('\n# 全部 measurements 行数 =', allRows.length, '（3 次运行 × 3 metric = 9）');
console.log('# metric_id 清单 =', JSON.stringify([...new Set(allRows.map(r => r.metricId))].sort()));
console.log('# entity_id 取值集合 =', JSON.stringify([...new Set(allRows.map(r => r.entityId))]));
console.log('# def_version 集合 =', JSON.stringify([...new Set(allRows.map(r => r.defVersion))]));
console.log('# input_digest 样例 =', JSON.stringify(allRows[0]?.inputDigest));
console.log('# run_id 样例 =', JSON.stringify(allRows[0]?.runId));
db.close();
console.log("# DONE");
process.exit(0);
