/**
 * e2e-metric-readback.ts — E5 / #389：④a 测量值「写 → 读回」端到端判据
 *
 * 🔴 它回答的问题：**E5 边通不通** —— 真实入口（HTTP GET 业务读者）∧ 写侧真落表 ∧
 *    读回逐字段匹配 ∧ 标定供数口径（默认排除轮次级）。
 *
 * 契约（铁律 47；治理线/CI 按此调用）:
 *   @input  环境变量全可选：SYNOVA_DB_PATH（缺省临时库）/ KEEP_DB=1（排障保留）
 *   @output [BOOT]/[SEED]/[READ]/[PASS]/[FAIL] 明细 ＋ 终行 E2E-METRIC-READBACK: PASS|FAIL|ERROR
 *   @exit   0=通过 ｜ 1=真红（读回空/不匹配/口径错/降级码）｜ 2=环境或脚本自身失败（禁吞）
 *
 * 改坏即红（判据用法）：摘掉 GET /api/sentinel/metrics/readings 路由或
 *   metric-readings-reader 读口 ⇒ 本脚本必 exit 1。
 * 自证（纪律 8）：打印实解析端口/库路径/唯一锚（metricId 含 ts+pid，断言读回含锚 ⇒ 防历史行冒充）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let finalVerdict: 'PASS' | 'FAIL' | 'ERROR' = 'ERROR';
const failPoints: string[] = [];
function fail(point: string, detail: unknown): void {
  failPoints.push(point);
  console.error(`[FAIL] ${point}`, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
async function finish(): Promise<never> {
  const code = finalVerdict === 'PASS' ? 0 : finalVerdict === 'FAIL' ? 1 : 2;
  console.log(`E2E-METRIC-READBACK: ${finalVerdict} (failPoints=${JSON.stringify(failPoints)})`);
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!keepDb && dbDir) rmSync(dbDir, { recursive: true, force: true });
  process.exit(code);
}

const keepDb = process.env.KEEP_DB === '1';
const dbDir = mkdtempSync(join(tmpdir(), 'synova-e2e-e5-'));
const dbPath = process.env.SYNOVA_DB_PATH ?? join(dbDir, 'synova.db');
process.env.SYNOVA_DB_PATH = dbPath;
process.env.PORT = '0';
process.env.SYNOVA_ORG_ID ??= 'default';
delete process.env.JWT_SECRET;

type HttpServer = import('node:http').Server;
let server: HttpServer | null = null;
let baseUrl = '';
try {
  const { startSynovaAgentProcess } = await import('../../src/init/agent-entry');
  const agent = await startSynovaAgentProcess();
  server = agent.getServer();
  if (!server) throw new Error('SynovaAgent.start() 未返回 HTTP 服务实例');
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('listen 超时(15s)')), 15_000);
    server!.once('error', reject);
    if (server!.listening) { clearTimeout(t); resolve(); return; }
    server!.once('listening', () => { clearTimeout(t); resolve(); });
  });
  const addr = server!.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : NaN;
  if (!Number.isInteger(port)) throw new Error(`无法解析监听端口: ${String(addr)}`);
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[BOOT] port=${port} db=${dbPath} org=${process.env.SYNOVA_ORG_ID}（纪律 8 自证）`);
} catch (err: unknown) {
  fail('BOOT', err instanceof Error ? err.message : String(err));
  await finish();
}

// 播种：经**写侧单一入口**（createMetricSink → recordMetricReading）落两行指标级 + 一行轮次级
const ANCHOR = `e2e.e5.metric.${Date.now()}.${process.pid}`;
try {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  const { createMetricSink } = await import('../../src/sentinel/metric-readings-writer');
  const sink = createMetricSink(db);
  const base = { orgId: 'default', entityId: 'entity-e2e', unit: '月', sourceType: 'compute' as const, runId: 'r1', inputDigest: 'd1', defVersion: 'v1' };
  const r1 = sink({ ...base, metricId: ANCHOR, value: 12.5, observedAt: new Date(Date.now() - 86400000).toISOString() });
  const r2 = sink({ ...base, metricId: ANCHOR, value: 9, observedAt: new Date().toISOString() });
  const r3 = sink({ ...base, metricId: `SENTINEL-${ANCHOR}`, value: 1, observedAt: new Date().toISOString() });
  if (!r1.written || !r2.written || !r3.written) { fail('SEED', { r1, r2, r3 }); finalVerdict = 'FAIL'; await finish(); }
  db.close();
  console.log(`[SEED] 指标级×2（${ANCHOR}：12.5→9）＋ 轮次级×1`);
} catch (err: unknown) {
  fail('SEED', err instanceof Error ? err.message : String(err));
  await finish();
}

try {
  const read = await fetch(`${baseUrl}/api/sentinel/metrics/readings?days=2`);
  const json: any = await read.json().catch(() => null);
  console.log(`[READ] GET metrics/readings → ${read.status} count=${json?.count}`);
  const rows: any[] = Array.isArray(json?.rows) ? json.rows : [];
  const mine = rows.filter(r => r.metric_id === ANCHOR);
  const checks: Array<[string, boolean]> = [
    ['HTTP 200 且 ok=true', read.status === 200 && json?.ok === true],
    ['读回含本次唯一锚的 2 行（防历史行冒充）', mine.length === 2],
    ['逐字段匹配（org/value/unit/降位）', mine.every(r => r.org_id === 'default' && r.value !== undefined && r.unit === '月' && r.degraded === 0)],
    ['标定供数口径：默认排除轮次级', !rows.some(r => r.metric_id === `SENTINEL-${ANCHOR}`)],
  ];
  const trendsRes = await fetch(`${baseUrl}/api/sentinel/metrics/readings?view=trends&days=2`);
  const trends: any = await trendsRes.json().catch(() => null);
  const t = Array.isArray(trends?.summary) ? trends.summary.find((x: any) => x.metricId === ANCHOR) : undefined;
  checks.push(['趋势聚合：最新 9 / 上一次 12.5 / 环比 -0.28', t !== undefined && t.latestValue === 9 && t.previousValue === 12.5 && Math.abs(t.changeRatio + 0.28) < 1e-9]);
  let allPass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? '[PASS]' : '[FAIL]'} 断言: ${name}`);
    if (!ok) { allPass = false; failPoints.push(name); }
  }
  finalVerdict = allPass ? 'PASS' : 'FAIL';
  await finish();
} catch (err: unknown) {
  fail('UNEXPECTED', err instanceof Error ? err.message : String(err));
  finalVerdict = 'FAIL';
  await finish();
}
