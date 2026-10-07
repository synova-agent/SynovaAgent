/**
 * tests/routes/workspace-goal-creation.integration.test.ts — #1322 判据件（V1/V2/V3/V5 + 反例锚）
 *
 * 主题: **目标创建链的生产入口**（提方向 → 三选一 → 选定 → GOAL 落图 → 真实 HTTP 读回）。
 *
 * 判据形态（铁律 12：真 HTTP，不 mock 管线）:
 *   · 真 express 装配：真 `jwtAuthMiddleware` + 真 `rbacMiddleware` + **真路由** +
 *     **真 `SqliteGraphStore` 注入 `app.locals.graphStore`**（与生产同一条取数路径）
 *   · 身份一律仓内真 `signJwtToken()` 签发、经真 HMAC 验签；请求走 `fetch` 真 socket
 *   · 库用**临时文件**（非 `:memory:`）—— 判据要**另开连接直查** `graph_nodes`；
 *     严禁写真实 `data/`（`SYNOVA_DATA_DIR` 指向 mkdtemp）
 *
 * ⚠️ 为什么**不用** `createServer()`（完整 Bootstrap）：在本机 Node v24.19.0 上，
 *   `createServer()` 会在 worker 退出时触发 better-sqlite3 原生断言
 *   `node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr`
 *   （Statement 析构落在 env 之后）⇒ 全部用例被判 unhandled error。
 *   **该崩溃在 pristine `origin/main` 上同样复现**（`tests/routes/middleware-order.test.ts` 单跑即崩），
 *   属**既有环境问题**、非本卡引入 ⇒ 本件改用等价强度的真装配夹具。
 *   完整生产链路（真 `tsx src/index.ts` + curl + sqlite3 直查）的 V1–V3 原始输出见 PR 正文。
 *
 * 为什么必须另开一件: 既有 `tests/routes/workspace-data.test.ts` 用**裸 express**（无
 *   `app.locals.graphStore`）⇒ 结构上到不了"真落图"；`tests/growth/*` 又全在函数层。
 *   本件是唯一"生产入口 → 图库"的端到端判据。
 *
 * 覆盖（正常 / 降级 / 边界）:
 *   正常 — V1 提方向→选定后 `graph_nodes` 新增 GOAL；V2 真 HTTP 读回 `metrics[].targetValue`
 *   降级 — 无 graphStore ⇒ 读 200+degraded:true / 写 503+degraded:true（不假成功）
 *   边界 — 空 orgId ⇒ 403；跨租户选定 ⇒ 404 且**不新增 GOAL**；pathIndex 越界 ⇒ 400；V3 两 org 互不可见
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

process.env.JWT_SECRET = 'd1322-goal-creation-secret-0123456789';
process.env.DEV_MODE = 'false';
process.env.PORT = '0';

import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import workspaceDataRoutes from '../../src/routes/workspace-data';

// ═══ 夹具 ═══

let tmpDir = '';
let dbPath = '';
let server: Server | undefined;
let base = '';
let depBase = '';            // 降级面：裸 express（只挂 router，无 app.locals.graphStore）
let depServer: Server | undefined;

const ORG_A = 'org-1322-a';
const ORG_B = 'org-1322-b';
let tokA = '';
let tokB = '';

interface HttpResult { status: number; body: Record<string, unknown> }

async function call(
  root: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${root}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const raw = await res.text();
  let body: Record<string, unknown> = {};
  try { body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { body = { __unparsed: raw }; }
  return { status: res.status, body };
}

/** 从响应体安全取一层字段（零 cast） */
function pick(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  return (obj as Record<string, unknown>)[key];
}

function str(obj: unknown, key: string): string {
  const v = pick(obj, key);
  return typeof v === 'string' ? v : '';
}

/** 直查临时库的连接（长生命期：避免 per-call 开关连接引发 Statement 析构时序问题） */
let judgeDb: Database.Database | undefined;

/** 直查临时库：所有 GOAL 节点（判据的第三方视角，不经应用层） */
function queryGoalRows(): Array<{ nodeId: string; type: string; goalId: string; orgId: string; targetValue: unknown }> {
  if (!judgeDb) judgeDb = new Database(dbPath, { readonly: true });
  const rows = judgeDb.prepare(
    `SELECT id AS nodeId, type,
            json_extract(props, '$.goalId')       AS goalId,
            json_extract(props, '$.orgId')        AS orgId,
            json_extract(props, '$.metrics[0].targetValue') AS targetValue
       FROM graph_nodes WHERE type = 'GOAL'`,
  ).all() as Array<{ nodeId: string; type: string; goalId: string; orgId: string; targetValue: unknown }>;
  return rows;
}

/** 提方向 → 选定，返回 { proposalId, goalId }；rate = 一次完整链 */
async function proposeAndSelect(
  token: string,
  title: string,
  targetValue: number,
  pathIndex = 1,
): Promise<{ proposalId: string; goalId: string; status: number }> {
  const created = await call(base, 'POST', '/api/workspace/proposals', {
    token, body: { title, department: 'dept-fin', keyRisks: ['账期拉长'], confidence: 0.8 },
  });
  expect(created.status).toBe(201);
  const proposalId = str(pick(created.body, 'data'), 'proposalId');
  expect(proposalId).not.toBe('');

  const selected = await call(base, 'POST', `/api/workspace/proposals/${proposalId}/select`, {
    token, body: { pathIndex, targetValue, unit: '%' },
  });
  expect(selected.status).toBe(200);
  const goalId = str(pick(selected.body, 'data'), 'goalId');
  expect(goalId).not.toBe('');
  return { proposalId, goalId, status: selected.status };
}

beforeAll(async () => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');

  tmpDir = mkdtempSync(join(tmpdir(), 'd1322-'));
  dbPath = join(tmpDir, 'v1322.db');
  process.env.SYNOVA_DB_PATH = dbPath;
  process.env.SYNOVA_DATA_DIR = tmpDir;      // 严禁写真实 data/

  // ── 生产面：真中间件 + 真路由 + 真 SqliteGraphStore（注入 app.locals，与 server.ts:331 同形）──
  const appDb = new Database(dbPath);
  const graphStore = new SqliteGraphStore(appDb);
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  app.locals.graphStore = graphStore;
  app.use(workspaceDataRoutes);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // ── 降级面：同装配但**不注入 app.locals.graphStore** ──
  const depApp = express();
  depApp.use(express.json());
  depApp.use(jwtAuthMiddleware);
  depApp.use(rbacMiddleware);
  depApp.use(workspaceDataRoutes);
  depServer = depApp.listen(0);
  depBase = `http://127.0.0.1:${(depServer.address() as AddressInfo).port}`;

  tokA = signJwtToken({ sub: 'ga-1322-a', role: 'ga', orgId: ORG_A }) ?? '';
  tokB = signJwtToken({ sub: 'ga-1322-b', role: 'ga', orgId: ORG_B }) ?? '';
  expect(tokA).not.toBe('');
  expect(tokB).not.toBe('');

  // 夹具自证：真 token 可验签（防「签了但验不过」导致全组假绿）
  const authed = await call(base, 'GET', `/api/workspace/${ORG_A}/goals`, { token: tokA });
  expect(authed.status).toBe(200);

  // 端点已注册 + 参数校验生效（防路径写错导致下面全是 404）
  const probe = await call(base, 'POST', '/api/workspace/proposals', { token: tokA, body: {} });
  expect({ label: 'title 缺失 ⇒ 400', status: probe.status }).toEqual({ label: 'title 缺失 ⇒ 400', status: 400 });
}, 60_000);

afterAll(() => {
  server?.close();
  depServer?.close();
  judgeDb?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════
// 正常路径
// ════════════════════════════════════════════════════════════════

describe('#1322 V1 · 提方向 → 三选一 → 选定 ⇒ GOAL 落图（真 HTTP）', () => {
  it('POST /api/workspace/proposals ⇒ 201 + 恰好 3 条候选路径', async () => {
    const res = await call(base, 'POST', '/api/workspace/proposals', {
      token: tokA, body: { title: '盯住现金流', keyRisks: ['账期拉长'] },
    });
    expect(res.status).toBe(201);
    const data = pick(res.body, 'data');
    expect(res.body.ok).toBe(true);
    expect(str(data, 'proposalId')).not.toBe('');
    expect(str(data, 'status')).toBe('pending_selection');
    expect(str(data, 'orgId')).toBe(ORG_A);
    const paths = pick(data, 'paths');
    expect(Array.isArray(paths)).toBe(true);
    expect((paths as unknown[]).length).toBe(3);
  });

  it('V1: 选定后 graph_nodes 新增该 GOAL（node id ≠ goalId，props.orgId = 调用者租户）', async () => {
    const before = queryGoalRows().length;
    const { goalId } = await proposeAndSelect(tokA, 'V1 落图判据', 15, 1);

    const rows = queryGoalRows();
    expect(rows.length).toBe(before + 1);
    const mine = rows.filter(r => r.goalId === goalId);
    expect(mine).toHaveLength(1);
    expect(mine[0].orgId).toBe(ORG_A);
    expect(mine[0].targetValue).toBe(15);
    // 真库主键是 node-<uuid>；实体 id 只在 props（#1322 B1 的语义锚）
    expect(mine[0].nodeId).not.toBe(goalId);
    expect(mine[0].nodeId.startsWith('node-')).toBe(true);
  });
});

describe('#1322 V2 · 真 HTTP GET 读回目标值', () => {
  it('GET /api/workspace/:deptId/goals 读回 metrics[].targetValue = 提交值（非常量 100）', async () => {
    const { goalId } = await proposeAndSelect(tokA, 'V2 读回判据', 15, 2);

    const res = await call(base, 'GET', `/api/workspace/${ORG_A}/goals`, { token: tokA });
    expect(res.status).toBe(200);
    const list = pick(res.body, 'data');
    expect(Array.isArray(list)).toBe(true);
    const mine = (list as Array<Record<string, unknown>>).find(g => g.goalId === goalId);
    expect(mine, '读回面必须含刚落的 goalId').toBeDefined();
    const metrics = mine?.metrics as Array<{ targetValue?: number }> | undefined;
    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics?.[0]?.targetValue).toBe(15);
  });
});

describe('#1322 V3 · 两个不同 orgId 的后目标互不可见', () => {
  it('A/B 各自提目标 ⇒ 各自只读到自己的；两条 props.orgId 互不相同且 ≠ default', async () => {
    const a = await proposeAndSelect(tokA, 'V3-A 目标', 11, 0);
    const b = await proposeAndSelect(tokB, 'V3-B 目标', 22, 2);

    const listA = (pick((await call(base, 'GET', `/api/workspace/${ORG_A}/goals`, { token: tokA })).body, 'data') ?? []) as Array<{ goalId?: string }>;
    const listB = (pick((await call(base, 'GET', `/api/workspace/${ORG_B}/goals`, { token: tokB })).body, 'data') ?? []) as Array<{ goalId?: string }>;

    expect(listA.some(g => g.goalId === a.goalId)).toBe(true);
    expect(listA.some(g => g.goalId === b.goalId)).toBe(false);
    expect(listB.some(g => g.goalId === b.goalId)).toBe(true);
    expect(listB.some(g => g.goalId === a.goalId)).toBe(false);

    const rows = queryGoalRows();
    const orgs = new Set(rows.map(r => r.orgId));
    expect(orgs.has(ORG_A)).toBe(true);
    expect(orgs.has(ORG_B)).toBe(true);
    expect(orgs.has('default')).toBe(false);
    // 两条记录确实属于两个不同租户
    expect(rows.find(r => r.goalId === a.goalId)?.orgId).not.toBe(rows.find(r => r.goalId === b.goalId)?.orgId);
  });
});

// ════════════════════════════════════════════════════════════════
// 降级路径（V5）
// ════════════════════════════════════════════════════════════════

describe('#1322 V5 · 图存储缺席 ⇒ 降级可见（不静默、不假成功）', () => {
  it('读端点 ⇒ 200 + degraded:true（不是 500，也不是假装有数据）', async () => {
    const res = await call(depBase, 'GET', `/api/workspace/${ORG_A}/goals`, { token: tokA });
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
  });

  it('提方向 ⇒ 503 + degraded:true（缺图存储不得受理）', async () => {
    const res = await call(depBase, 'POST', '/api/workspace/proposals', {
      token: tokA, body: { title: '降级用例' },
    });
    expect(res.status).toBe(503);
    expect(res.body.degraded).toBe(true);
    expect(str(res.body, 'code')).toBe('GRAPH_UNAVAILABLE');
  });

  it('选定 ⇒ 503 + degraded:true', async () => {
    const res = await call(depBase, 'POST', '/api/workspace/proposals/any/select', {
      token: tokA, body: { pathIndex: 0 },
    });
    expect(res.status).toBe(503);
    expect(res.body.degraded).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 边界路径
// ════════════════════════════════════════════════════════════════

describe('#1322 边界 · 租户与参数', () => {
  it('合法签名但 orgId 为空 ⇒ 403 ORG_ID_MISSING（fail-closed）', async () => {
    // signJwtToken 的 payload 类型要求 orgId；空串是合法签名但无租户维度
    const noOrg = signJwtToken({ sub: 'no-org', role: 'ga', orgId: '' }) ?? '';
    expect(noOrg).not.toBe('');

    const read = await call(base, 'GET', `/api/workspace/${ORG_A}/goals`, { token: noOrg });
    expect(read.status).toBe(403);
    expect(str(read.body, 'code')).toBe('ORG_ID_MISSING');

    const write = await call(base, 'POST', '/api/workspace/proposals', { token: noOrg, body: { title: 'x' } });
    expect(write.status).toBe(403);
  });

  it('跨租户选定 ⇒ 404 PROPOSAL_NOT_FOUND 且不新增 GOAL', async () => {
    const created = await call(base, 'POST', '/api/workspace/proposals', { token: tokA, body: { title: 'A 的提案' } });
    const proposalId = str(pick(created.body, 'data'), 'proposalId');
    expect(proposalId).not.toBe('');

    const before = queryGoalRows().length;
    const res = await call(base, 'POST', `/api/workspace/proposals/${proposalId}/select`, {
      token: tokB, body: { pathIndex: 0 },
    });
    expect(res.status).toBe(404);
    expect(str(res.body, 'code')).toBe('PROPOSAL_NOT_FOUND');
    expect(queryGoalRows().length).toBe(before);
  });

  it('pathIndex 越界 ⇒ 400（且不新增 GOAL）', async () => {
    const created = await call(base, 'POST', '/api/workspace/proposals', { token: tokA, body: { title: '越界用例' } });
    const proposalId = str(pick(created.body, 'data'), 'proposalId');

    const before = queryGoalRows().length;
    for (const bad of [3, -1, 'x']) {
      const res = await call(base, 'POST', `/api/workspace/proposals/${proposalId}/select`, {
        token: tokA, body: { pathIndex: bad },
      });
      expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
    }
    expect(queryGoalRows().length).toBe(before);
  });

  it('未认证 ⇒ 401（上游 JWT 层，非白名单路径）', async () => {
    const res = await call(base, 'POST', '/api/workspace/proposals', { body: { title: '匿名' } });
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// #1322 修「假受理」：PUT …/target 真的落值
// ════════════════════════════════════════════════════════════════

describe('#1322 · PUT …/target 不再假受理', () => {
  it('真实目标 ⇒ 200 + adjusted:true，且图库目标值确实被改写', async () => {
    const { goalId } = await proposeAndSelect(tokA, '改值判据', 33, 1);

    const res = await call(base, 'PUT', `/api/workspace/goals/${goalId}/target`, {
      token: tokA, body: { targetValue: 77, reason: '中层调整' },
    });
    expect(res.status).toBe(200);
    const data = pick(res.body, 'data');
    expect(pick(res.body, 'data')).toBeDefined();
    expect(str(res.body, 'ok')).toBe('');           // ok 是 boolean，不是字符串
    expect(res.body.ok).toBe(true);
    expect(pick(data, 'adjusted')).toBe(true);
    expect(pick(data, 'targetValue')).toBe(77);

    const rows = queryGoalRows();
    expect(rows.find(r => r.goalId === goalId)?.targetValue).toBe(77);
  });

  it('不存在的目标 ⇒ 200 + adjusted:false + GOAL_NOT_FOUND（明示未写入，且与跨租户同形）', async () => {
    const res = await call(base, 'PUT', `/api/workspace/goals/no-such-goal/target`, {
      token: tokA, body: { targetValue: 5 },
    });
    expect(res.status).toBe(200);
    const data = pick(res.body, 'data');
    expect(pick(data, 'adjusted')).toBe(false);
    expect(str(data, 'reason')).toBe('GOAL_NOT_FOUND');
  });

  it('跨租户改值 ⇒ 与「不存在」同形（不泄漏存在性、不写入）', async () => {
    const { goalId } = await proposeAndSelect(tokA, '跨租户改值', 44, 0);
    const before = queryGoalRows().find(r => r.goalId === goalId)?.targetValue;

    const res = await call(base, 'PUT', `/api/workspace/goals/${goalId}/target`, {
      token: tokB, body: { targetValue: 999 },
    });
    expect(res.status).toBe(200);
    expect(pick(pick(res.body, 'data'), 'adjusted')).toBe(false);
    expect(queryGoalRows().find(r => r.goalId === goalId)?.targetValue).toBe(before);
  });

  it('targetValue 非有限数 ⇒ 400', async () => {
    const { goalId } = await proposeAndSelect(tokA, '非法值', 55, 0);
    const res = await call(base, 'PUT', `/api/workspace/goals/${goalId}/target`, {
      token: tokA, body: { targetValue: 'abc' },
    });
    expect(res.status).toBe(400);
  });
});
