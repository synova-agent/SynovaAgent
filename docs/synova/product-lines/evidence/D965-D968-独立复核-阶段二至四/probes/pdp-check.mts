/**
 * pdp-check.mts — D967④「post-diagnosis-processor 不再写 finding_count=0 伪条目」判别性复核
 * 夹具: 内存库 + BaselineStore.setDatabase → 统计行数 → 调 runPostDiagnosisProcessing → 再统计
 * 判别性: 同校验在「把被删的旧代码放回去」的副本上必须变红（出现 org-baseline-* 伪条目）
 */
import Database from 'better-sqlite3';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const LABEL = (process.argv.find(a => a.startsWith('--label=')) || '--label=X').slice(8);
const { BaselineStore, getBaselineStore } = await import(`${WT}/src/sentinel/baseline-store.ts`);
const { runPostDiagnosisProcessing } = await import(`${WT}/src/agent/post-diagnosis-processor.ts`);

const db = new Database(':memory:');
const store = new BaselineStore();
store.setDatabase(db as never);
// 生产启动路径: 全局单例也接同一个库（旧代码走的是 getBaselineStore()）
getBaselineStore().setDatabase(db as never);

const emptyGraph = {
  queryNodes: () => [],
  queryEdges: () => [],
  getNode: () => null,
  queryTriples: () => [],
  createNode: () => 'node-x',
  createEdge: () => 'edge-x',
};

const count = () => (db.prepare('SELECT COUNT(*) AS n FROM sentinel_alert_stats').get() as { n: number }).n;
const rows = () => db.prepare('SELECT sentinel_id, finding_count, checked_at FROM sentinel_alert_stats').all() as Array<Record<string, unknown>>;

console.log(`[${LABEL}] 调用前行数 = ${count()}`);
const res = await runPostDiagnosisProcessing(emptyGraph as never, 'verify-team', {});
console.log(`[${LABEL}] runPostDiagnosisProcessing 返回 errors = ${JSON.stringify((res as { errors?: string[] }).errors ?? [])}`);
console.log(`[${LABEL}] 调用后行数 = ${count()}`);
console.log(`[${LABEL}] 表内行 = ${JSON.stringify(rows())}`);
const pseudo = rows().filter(r => String(r.sentinel_id).startsWith('org-baseline-'));
console.log(`[${LABEL}] ASSERT 无 org-baseline-* 伪条目 = ${pseudo.length === 0 ? 'HOLDS' : 'VIOLATED -> ' + JSON.stringify(pseudo)}`);
console.log(`[${LABEL}] ASSERT 调用前后行数不变 = ${count() === 0 ? 'HOLDS' : 'VIOLATED'}`);
process.exit(0);
