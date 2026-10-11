/**
 * e2e-decision-roundtrip.ts — J5 / #405：④ 决策台账「写 → 读回」端到端判据
 *
 * 🔴 它回答的问题（不是"不报错"）：**机器能不能转完一圈** ——
 *    真实入口触发（HTTP POST，非 boot 自检）∧ 写侧不静默 ∧ **读回非空且逐字段匹配**。
 *
 * 契约（铁律 47；治理线/CI 按此调用）:
 *   @input  环境变量（全部可选）:
 *            SYNOVA_DB_PATH — sqlite 库路径（缺省 ./data/synova.db；脚本会用**临时库**覆盖缺省，
 *                             绝不碰真库 data/synova.db）
 *            SYNOVA_ORG_ID  — 图名（缺省 default）
 *            KEEP_DB=1      — 保留临时库（排障用；缺省删）
 *   @output 逐段打印 [PASS]/[FAIL] 明细 + 最终一行 E2E-DECISION-ROUNDTRIP: PASS|FAIL|ERROR
 *   @exit   0 = 通过（POST 落账 ∧ GET 读回 ∧ 字段匹配）
 *           1 = 真红（读回空 / 字段不匹配 / 写侧降级 / 摘掉读回路径后的任何断言失败）
 *           2 = 环境或脚本自身失败（服务起不来 / 播种失败）——**禁吞**，与真红严格区分
 *
 * 改坏即红（判据③的用法）: 摘掉 GET /tickets/:id/decisions 路由或 listDecisionRows 读口
 *   ⇒ 本脚本必 exit 1（断言读回 count≥1 且含本次唯一锚点）。
 *
 * 自证（纪律 8）: 打印实解析的服务端口 / 库路径 / 工单 id / 唯一锚点；
 *   断言"读回行里确有本次写入的锚点"（防读到历史行冒充）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 三态退出的统一出口（禁 process.exit 混用）──
let finalVerdict: 'PASS' | 'FAIL' | 'ERROR' = 'ERROR';
const failPoints: string[] = [];
function fail(point: string, detail: unknown): void {
  failPoints.push(point);
  console.error(`[FAIL] ${point}`, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
async function finish(): Promise<never> {
  const code = finalVerdict === 'PASS' ? 0 : finalVerdict === 'FAIL' ? 1 : 2;
  console.log(`E2E-DECISION-ROUNDTRIP: ${finalVerdict} (failPoints=${JSON.stringify(failPoints)})`);
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!keepDb && dbDir) rmSync(dbDir, { recursive: true, force: true });
  process.exit(code);
}

const keepDb = process.env.KEEP_DB === '1';
const dbDir = mkdtempSync(join(tmpdir(), 'synova-e2e-j5-'));
const dbPath = process.env.SYNOVA_DB_PATH ?? join(dbDir, 'synova.db');
process.env.SYNOVA_DB_PATH = dbPath;
process.env.PORT = '0'; // 临时端口（listen(0) ⇒ 内核分配；实解析值见下方自证打印）
process.env.SYNOVA_ORG_ID ??= 'default';
delete process.env.JWT_SECRET; // 走 AUTH_DEV_MODE 留痕通道（真实入口的鉴权中间件照常穿过）

// ── 阶段 0：起真服务（环境失败 ⇒ exit 2，与真红严格区分）──
type HttpServer = import('node:http').Server;
let server: HttpServer | null = null;
let baseUrl = '';
try {
  // 真入口 = src/index.ts 的生命周期（initEngineContext → SynovaAgent.start → createServer + SentinelRunner）
  // —— 只调 createServer 会缺 SentinelRunner（工单迁移 503 SENTINEL_RUNNER_UNAVAILABLE），不是真入口。
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
  console.log(`[BOOT] 服务已起 port=${port} db=${dbPath} org=${process.env.SYNOVA_ORG_ID}（纪律 8 自证：以上为实解析值）`);
} catch (err: unknown) {
  fail('BOOT', err instanceof Error ? err.message : String(err));
  await finish();
}

// ── 阶段 1：播种输入（图节点 + 哨兵工单；这是**输入**，断言在阶段 3）──
const ANCHOR = `e2e-j5-anchor-${Date.now()}-${process.pid}`;
const NODE_ID = `e2e-risk-node-${Date.now()}`;
const TICKET_ID = `e2e-ticket-${Date.now()}`;
try {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  // sentinel_tickets 由 SentinelRunner.start() 惰性建表（boot 未必已跑）——此处按同款 DDL 自备（IF NOT EXISTS，幂等）
  db.exec(`CREATE TABLE IF NOT EXISTS sentinel_tickets (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('emergency','critical','warning','info')),
    expert_type TEXT NOT NULL,
    diagnosis TEXT,
    suggested_actions TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved','dismissed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );`);
  // 注意：queryNodes 的 {id} 过滤匹配 props.id（json_extract），不是表主键 —— 播种按此口径
  db.prepare(`INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, 'default', 'outcome/risk', ?, ?)`)
    .run(NODE_ID, NODE_ID, JSON.stringify({ id: NODE_ID }));
  db.prepare(`INSERT INTO sentinel_tickets (id, signal_id, severity, expert_type, diagnosis, status)
              VALUES (?, ?, 'warning', 'e2e', ?, 'open')`)
    .run(TICKET_ID, NODE_ID, JSON.stringify({ title: `J5 端到端 ${ANCHOR}`, summary: ANCHOR }));
  db.close();
  console.log(`[SEED] 节点=${NODE_ID} 工单=${TICKET_ID} 锚点=${ANCHOR}`);
} catch (err: unknown) {
  fail('SEED', err instanceof Error ? err.message : String(err));
  await finish();
}

// ── 阶段 2：真实入口写（POST 状态机迁移 → 工单关闭裁决落 ④）──
async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: await res.json().catch(() => null) };
}

try {
  // 状态机白名单: open→acknowledged→resolved（open→resolved 是 409）
  const ack = await post(`/api/sentinel/tickets/${TICKET_ID}/transition`, { to: 'acknowledged' });
  if (ack.status !== 200 || ack.json?.ok !== true) { fail('TRANSITION-ACK', ack); finalVerdict = 'FAIL'; await finish(); }

  const resolved = await post(`/api/sentinel/tickets/${TICKET_ID}/transition`, {
    to: 'resolved', operatorId: 'e2e-operator', role: 'e2e-role', orgId: process.env.SYNOVA_ORG_ID,
  });
  console.log(`[WRITE] POST transition(resolved) → ${resolved.status} ledgerRecorded=${resolved.json?.ledgerRecorded}`);
  if (resolved.status !== 200 || resolved.json?.ok !== true) { fail('TRANSITION-RESOLVED', resolved); finalVerdict = 'FAIL'; await finish(); }
  if (resolved.json?.ledgerRecorded !== true) {
    fail('LEDGER-WRITE-DEGRADED', '写侧降级：ledgerRecorded !== true（台账未落账 = 机器半圈，判据④要求显式可见）');
    finalVerdict = 'FAIL'; await finish();
  }

  // ── 阶段 3：读回断言（本脚本的 Done）──
  const read = await get(`/api/sentinel/tickets/${TICKET_ID}/decisions`);
  console.log(`[READ] GET decisions → ${read.status} count=${read.json?.count}`);
  if (read.status !== 200 || read.json?.ok !== true) {
    fail('LEDGER-READ-BROKEN', read); finalVerdict = 'FAIL'; await finish();
  }
  const rows: any[] = Array.isArray(read.json?.decisions) ? read.json.decisions : [];
  if (rows.length < 1) { fail('LEDGER-READ-EMPTY', '读回 count=0 —— 写进去了读不出来（J5 未修 / 被摘）'); finalVerdict = 'FAIL'; await finish(); }

  const row = rows[0]?.row ?? {};
  const checks: Array<[string, boolean]> = [
    ['nodeId 匹配（台账行落在决策节点上）', read.json.nodeId === NODE_ID],
    ['who 匹配（谁裁的）', row.who === 'e2e-operator'],
    ['role 匹配（岗位）', row.role === 'e2e-role'],
    ['output.ref 匹配（产出锚 = 工单 id）', row.output?.ref === TICKET_ID],
    ['presetVersion 匹配（哪版预设）', row.presetVersion === 1],
    ['context.taskRef 匹配（防读到历史行冒充：taskRef=本次唯一工单 id）', row.context?.taskRef === TICKET_ID],
  ];
  let allPass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? '[PASS]' : '[FAIL]'} 断言: ${name}`);
    if (!ok) { allPass = false; failPoints.push(name); }
  }
  finalVerdict = allPass ? 'PASS' : 'FAIL';
  await finish();
} catch (err: unknown) {
  fail('UNEXPECTED', err instanceof Error ? err.message : String(err));
  finalVerdict = 'FAIL'; // 运行中抛错 = 断言链断了，按真红处理；BOOT/SEED 才是环境错
  await finish();
}
