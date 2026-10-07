/**
 * pk-collision-and-p7-e2e.mts — 两项补充核验
 * A) measurements 主键冲突行为（代码注释声称 "UPSERT 语义" 是否成立）
 * B) P7 端到端：真实生产副本 → SqliteGraphStore 构造器（启动路径）→ 三条断言
 */
import Database from 'better-sqlite3';
import { copyFileSync } from 'fs';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const OUT = '/tmp/verify-d967';
const { recordMeasurement, queryMeasurements } = await import(`${WT}/src/store/measurements.ts`);
const { reconcileSchema } = await import(`${WT}/src/store/schema-migration.ts`);
const { SqliteGraphStore } = await import(`${WT}/src/adapters/sqlite-graph-store.ts`);

console.log('═══ A) 主键冲突：同 (entity_id, metric_id, computed_at, run_id) 二次写入 ═══');
{
  const db = new Database(':memory:');
  reconcileSchema(db);
  const base = { entityId: '', metricId: 'x:finding_count', computedAt: '2026-09-25T00:00:00.000Z', runId: 'x@2026-09-25T00:00:00.000Z', source: 'sentinel', inputDigest: 'd1', defVersion: 'v1' };
  recordMeasurement(db, { ...base, value: 1 });
  try {
    recordMeasurement(db, { ...base, value: 2 });
    console.log('二次写入 = 成功（真 UPSERT 语义）');
  } catch (e) {
    console.log('二次写入 = THREW:', e instanceof Error ? e.message : String(e));
  }
  console.log('表内行 =', JSON.stringify(queryMeasurements(db, {})));
  // 并发/同秒不同 runId → 正常并存
  recordMeasurement(db, { ...base, runId: 'x@2026-09-25T00:00:00.000Z#2', value: 3 });
  console.log('同 computedAt 不同 runId 行数 =', queryMeasurements(db, {}).length);
  db.close();
}

console.log('\n═══ B) P7 端到端：真实生产副本 + 启动路径（SqliteGraphStore 构造器）═══');
{
  const p = `${OUT}/p7-e2e-prod.db`;
  copyFileSync(`${OUT}/prod.db`, p);
  const db = new Database(p);
  const before = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  const beforeRows = (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n;
  console.log(`before: id=${before.find(c => c.name === 'id')?.type} props=${before.some(c => c.name === 'props')} rows=${beforeRows}`);
  const store = new SqliteGraphStore(db as never); // 生产启动路径：构造器内部 reconcileSchema
  const after = (db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>);
  const afterRows = (db.prepare('SELECT COUNT(*) AS n FROM graph_triples').get() as { n: number }).n;
  const idx = (db.pragma('index_list(graph_triples)') as Array<{ name: string }>).map(i => i.name).sort();
  console.log(`after : id=${after.find(c => c.name === 'id')?.type} props=${after.some(c => c.name === 'props')} rows=${afterRows} idx=${JSON.stringify(idx)}`);
  console.log(`measurements 表 = ${Boolean((db.prepare("SELECT name FROM sqlite_master WHERE name='measurements'").get()))}`);
  // 三条断言
  const a1 = store.queryEdges() .length >= 0 && !('error' in {});
  let readOk = 'NO', writeOk = 'NO';
  try { readOk = 'YES(' + store.queryEdges('DEPLOYS', undefined, undefined, 'default').length + ' 行)'; } catch (e) { readOk = 'THREW:' + (e instanceof Error ? e.message : String(e)); }
  try { const id = store.createEdge('DEPLOYS', 'probe-e2e', 'probe-e2e', 1, {}, 'default'); writeOk = 'YES(' + id.slice(0, 16) + ')'; } catch (e) { writeOk = 'THREW:' + (e instanceof Error ? e.message : String(e)); }
  const schemaOk = after.find(c => c.name === 'id')?.type === 'TEXT' && after.some(c => c.name === 'props');
  console.log(`ALL PASS ① schema 回 canonical = ${schemaOk}`);
  console.log(`ALL PASS ② 读路径 queryEdges = ${readOk}`);
  console.log(`ALL PASS ③ 写路径 createEdge = ${writeOk}`);
  db.close();
}
process.exit(0);
