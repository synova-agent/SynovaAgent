/**
 * tests/security/boundary-identity.test.ts — #1200 / R-S0-1「边界·授权与会话身份」
 *
 * 判据来源：`.handbook/派单件/2026-10-31-规格-1200-S0-入口身份与边界.md`
 *   §1.1／§1.2（做什么）、§3（U-1…U-5，**CTO 裁定 A**）、§4（已知限制）、§9（已生效裁定）。
 * 锚：`b11927d9b`（worktree `/tmp/w-1200`；锚不符 ⇒ 本文件不得作为判据使用）。
 *
 * 本文件证明什么（防误读）:
 *   「**身份是唯一的授权与租户来源**」在**真 HTTP 链路**上成立：`role` / `tenantId` / `orgId`
 *   一律派生自**验签身份**（`req.auth`）；自报值（`body.role` / `body.tenantId` / `query.orgId`）
 *   只能**与身份一致**或**被拒**，不能扩张权限。
 *   它**不**证明"导出内容闭合"——`DataExporter` 的租户作用域缺口已登记为已知限制（§4-8）
 *   并另立卡 #1203；故本文件**不**断言"导出内容只含 org-a"（裁定 A）。
 *
 * 手法（铁律 12：不 mock 管线）:
 *   真 `express()` + 真 `express.json()` + 真 `jwtAuthMiddleware`（验签身份注入）
 *   + 真路由（`data-lifecycle` / `audit`）+ `app.locals.graphStore`＝**真** `SqliteGraphStore`
 *   + `app.listen(0)` + `fetch` 真 HTTP。
 *   🔴 禁 mock 中间件 / 禁 grep 当判据 / 禁裸挂路由（裸挂 ⇒ `req.auth` 永不出现，U-2…U-5 无从判定）。
 *   🔴 不用 `createServer()`（本仓实测：vitest worker 内会 abort）——只 `app.listen(0)`。
 *
 * 契约（铁律 47）:
 *   @input  — 环境两态（`JWT_SECRET` ≥16 字符 ＋ **显式删除** `DEV_MODE` ＋ `SYNOVA_ORG_ID='org-a'`
 *             ＋ `LOG_LEVEL='silent'`）＋ `Authorization: Bearer <jwt>`（`signJwtToken` **真签**）
 *             ＋ 声明面：`body.tenantId` / `body.role` / `query.orgId`。
 *             🔴 请求**不发** `x-org-id` / `x-tenant-id` 头——那两个头会被中间件
 *             `evaluateCrossOrgAccess` 先行拦成 `CROSS_ORG_FORBIDDEN`（**码不同**），
 *             会把本卡要判的路由层判据遮住；跨租户诉求只走 body/query（规格 §3）。
 *   @output — 判定表（三态齐）:
 *             ① 声明与身份一致 / 未声明 ⇒ **200**（导出归档 `archive.tenantId==='org-a'`；
 *                审计 `ok:true`）——U-1；
 *             ② 声明 ≠ 身份 ⇒ **403** `CROSS_ORG_DENIED` / `reason:'org_mismatch'`
 *                （export / purge / audit 同型）——U-2、U-4；
 *             ③ 自授角色（`body.role` ≠ `req.auth.role`）⇒ **403** `IDENTITY_MISMATCH` /
 *                `reason:'role_declared'`——U-3a；不传 role 但身份无权 ⇒ **403**（checkPolicy deny）——U-3b；
 *             ④ 无身份 ⇒ **401**（中间件先行；**只断状态**，不断 `code`）——U-5。
 *   @degraded — **无**。本文件不引入任何降级放行路径；夹具自身不可用（`initEngineContext` 未就绪 /
 *              `signJwtToken` 返回 null / 归档不可解析）一律 `throw` 报错，**不静默跳过**（铁律 11/31 的反向适用）。
 *              被测件内部的降级（`AuditService` 未初始化 ⇒ 空集）不改变状态码判据。
 *   @exit   — **不适用**：本件是 vitest 测试件，不是可执行脚本，没有独立进程退出码；
 *              其三态落在 runner 上（`npx vitest run <file>`：0＝全绿／1＝有用例红／2＝runner 自身失败），
 *              故不实现 `@exit 0/1/2`（那是脚本件约定，见 dsh-code-standards D1；本件不重复实现）。
 *
 * 已知限制（本文件**不**覆盖，防把"绿"读成"已闭合"）:
 *   1. 只覆盖 4 个端点（data-lifecycle 2 ＋ audit 2）；其余自报租户点归 **S0-2**（§4-1）。
 *   2. **不断言"导出内容只含 org-a"** —— 实测不成立（边全量、无租户字段节点保守包含，
 *      `src/l4/data-exporter.ts:181-205`／`:244-252`）⇒ 裁定 A：只断言"带租户标记的节点被过滤"，
 *      泄漏面登记 §4-8 ＋ 另立卡 #1203。
 *   3. 只覆盖**路由层**收口；`executeExport`／`executePurge` 内部不再校验租户（§4-6）。
 *   4. 不覆盖"人在环审批"：`data.export`／`data.purge` 不在 `HIGH_RISK_ACTIONS`（§4-7／§9-⑤）。
 *   5. `tsconfig.json` 排除 `tests` ⇒ 本件**没有编译期类型检查**，只有运行期判据（§3 U-7 已知缺口）。
 *
 * 设计哲学：身份是唯一的授权与租户来源（自报值只能收窄，不能扩张）。
 * 铁律 48: 每格均有真 `expect()`；三态（200 / 403 / 401）齐；无空壳用例。
 * 铁律 38: 零 `as any` / `as never` / `as unknown as`（响应体用**运行时收窄**，不用断言穿透）。
 * 铁律 33: 命名 `*.test.ts`。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { initEngineContext, getDatabase, closeEngineContext } from '../../src/init/engine-context';
import { getAgentMemoryStore } from '../../src/l4/agent-memory-store';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import dataLifecycleRoutes from '../../src/routes/data-lifecycle';
import auditRoutes from '../../src/routes/audit';

// ════════════════════════════════════════════════════════════════
// 常量与两态环境（自切 ＋ 还原）
// ════════════════════════════════════════════════════════════════

/** 生产姿态签名密钥（≥16 字符，满足 `getSecret()` 的有效性门槛 `src/middleware/auth.ts:83`） */
const PROD_SIGNING_SECRET = 's0-1-boundary-identity-secret-0123456789';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const NODE_TYPE = 'resource/money';
const GRAPH = 'default';

const ORIGINAL_ENV = {
  JWT_SECRET: process.env['JWT_SECRET'],
  DEV_MODE: process.env['DEV_MODE'],
  SYNOVA_ORG_ID: process.env['SYNOVA_ORG_ID'],
  LOG_LEVEL: process.env['LOG_LEVEL'],
};

/**
 * 生产姿态：有 `JWT_SECRET`、**无** `DEV_MODE`、实例组织 `org-a`、静默日志。
 * 🔴 `vitest.config.ts` 的 `env` 自带 `DEV_MODE:'true'` ⇒ 不显式 `delete` 则中间件走
 *    DevMode 分支注入 `dev-admin`（`src/middleware/auth.ts:775-799`），"无身份态"根本不存在，
 *    U-5 会假绿（401 永远拿不到）。故删除动作是**判据的一部分**，不是清理动作。
 */
function enterProdEnv(): void {
  process.env['JWT_SECRET'] = PROD_SIGNING_SECRET;
  delete process.env['DEV_MODE'];
  process.env['SYNOVA_ORG_ID'] = ORG_A;
  process.env['LOG_LEVEL'] = 'silent';
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// ════════════════════════════════════════════════════════════════
// 夹具：真 store / 真 app / 真 HTTP
// ════════════════════════════════════════════════════════════════

/** 图库（`:memory:`，与 engine 库分离；只作 GraphStore 的真存储） */
let graphDb: Database.Database;
/** 被测应用挂在 `app.locals.graphStore` 上的**真** store（路由通过 getGraphStore(req) 取它） */
let graphStore: SqliteGraphStore;
/** 核对用**独立** store 实例（同一真库句柄，不与被测应用共享对象） */
let verifyStore: SqliteGraphStore;
let server: Server;
let BASE = '';

/** 每例重建的种子节点 id（真 `createNode` 返回，用于证明"断言落在真行为上"） */
let orgANodeId = '';
let orgBNodeId = '';

/**
 * 重置图库为**固定 2 节点**：`resource/money` + graph='default'
 * ＋ `props.orgId` 分别 `org-a` / `org-b`。
 * 🔴 必须真写、真读回（本仓判例：`tests/l4/decision-capture-single-entry.test.ts:147-161`
 *   的假 store会让 25/25 全绿 ⇒ 此处用真 `SqliteGraphStore` 并在夹具内**回读自证**）。
 */
function reseedGraph(): void {
  graphDb.exec('DELETE FROM graph_triples; DELETE FROM graph_nodes;');
  orgANodeId = graphStore.createNode(NODE_TYPE, { orgId: ORG_A, name: 'org-a-cash' }, GRAPH);
  orgBNodeId = graphStore.createNode(NODE_TYPE, { orgId: ORG_B, name: 'org-b-cash' }, GRAPH);
  const seeded = graphStore.queryNodes(NODE_TYPE, {}, GRAPH);
  // 夹具自证：真 store 真写入（若 store 是假实现，这里先红，而不是让判据假绿）
  expect(seeded.length).toBe(2);
  expect(seeded.map((n) => n.id).sort()).toEqual([orgANodeId, orgBNodeId].sort());
}

/** 用**独立** store 实例读回真实库内节点（U-2c「零删除」用真库计数，不用计数探针） */
function inspectGraph(): { total: number; ids: string[] } {
  const nodes = verifyStore.queryNodes(NODE_TYPE, {}, GRAPH);
  return { total: nodes.length, ids: nodes.map((n) => n.id) };
}

/** 运行时收窄：未知值 → 普通对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * 真 HTTP 请求（`fetch`）。
 * 🔴 只发 `Authorization`；**不发** `x-org-id` / `x-tenant-id`（见头部契约 @input）。
 */
async function httpCall(
  path: string,
  options: { method?: 'GET' | 'POST'; token?: string; body?: Record<string, unknown> } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const raw = await response.text();
  let body: Record<string, unknown> = {};
  if (raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      body = isRecord(parsed) ? parsed : { __unparsed: raw };
    } catch {
      // 非 JSON 响应（如 500 文本）⇒ 保留原文，便于判据报错时看见真实响应
      body = { __unparsed: raw };
    }
  }
  return { status: response.status, body };
}

/** 真签身份（`signJwtToken` 唯一签名源 = `process.env.JWT_SECRET`） */
function signToken(orgId: string, role: string, sub = 'u-boundary'): string {
  const token = signJwtToken({ sub, role, orgId });
  if (!token) throw new Error('夹具自证失败: signJwtToken 返回 null（JWT_SECRET 不可用）');
  return token;
}

interface DecodedArchive {
  tenantId: string;
  nodes: Array<{ id: string; type: string; props: Record<string, unknown> }>;
}

/** 解 base64 归档 + 运行时收窄（禁 `as` 穿透：字段缺失一律抛错，不静默当成空） */
function decodeArchive(body: Record<string, unknown>): DecodedArchive {
  const archive = body['archive'];
  if (typeof archive !== 'string') throw new Error('响应缺 archive(base64) 字段 — 夹具自证失败');

  const parsed: unknown = JSON.parse(Buffer.from(archive, 'base64').toString('utf8'));
  if (!isRecord(parsed)) throw new Error('导出归档不是 JSON 对象');

  const tenantId = parsed['tenantId'];
  if (typeof tenantId !== 'string') throw new Error('导出归档缺 tenantId 字符串');

  const rawNodes: unknown[] = Array.isArray(parsed['nodes']) ? parsed['nodes'] : [];
  const nodes: DecodedArchive['nodes'] = [];
  for (const rawNode of rawNodes) {
    if (!isRecord(rawNode)) continue;
    const id = rawNode['id'];
    const type = rawNode['type'];
    if (typeof id !== 'string' || typeof type !== 'string') continue;
    const props = rawNode['props'];
    nodes.push({ id, type, props: isRecord(props) ? props : {} });
  }
  return { tenantId, nodes };
}

// ════════════════════════════════════════════════════════════════
// 生命周期
// ════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // ① 两态自切先于一切（中间件在**请求时**读 env，但引擎侧同样按 env 建库，顺序保持先 env 后 init）
  enterProdEnv();

  // ② engine 库（vitest env 已给 SYNOVA_DB_PATH=':memory:'）+ AgentMemoryStore
  //    `executeExport` 内部走 `getDatabase()` / `getAgentMemoryStore()`（与 bootstrap.ts:891/907 同路径）
  initEngineContext();
  getAgentMemoryStore(getDatabase());

  // ③ 真图库 + 真 store（禁用假 store / 计数探针）
  graphDb = new Database(':memory:');
  graphStore = new SqliteGraphStore(graphDb, { standardKeyGuard: false });
  verifyStore = new SqliteGraphStore(graphDb, { standardKeyGuard: false });

  // ④ 真 app：中间件 → 路由 → app.locals.graphStore（生产挂载顺序；禁裸挂路由）
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(dataLifecycleRoutes);
  app.use(auditRoutes);
  app.locals.graphStore = graphStore;

  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => { resolve(); });
    server.once('error', reject);
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('无法取得 listen(0) 端口 — 夹具失败');
  }
  BASE = `http://127.0.0.1:${String(address.port)}`;
});

beforeEach(() => {
  reseedGraph();
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  graphDb.close();
  closeEngineContext();
  restoreEnv();
});

// ════════════════════════════════════════════════════════════════
// U-1 · 正常路径（本租户导出／审计）
// ════════════════════════════════════════════════════════════════

describe('#1200 U-1 正常路径 — 本租户导出／审计（身份与声明一致 ⇒ 200）', () => {
  it('U-1a 身份 org-a/boss + body{tenantId:org-a,role:boss} ⇒ 200，archive.tenantId===org-a', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_A, 'boss'),
      body: { tenantId: ORG_A, role: 'boss' },
    });
    expect(res.status).toBe(200);
    expect(res.body['ok']).toBe(true);
    const archive = decodeArchive(res.body);
    expect(archive.tenantId).toBe(ORG_A);
  });

  it('U-1b 同身份 + body{}（不传 tenantId）⇒ 200（🔴 不得 400），archive.tenantId===org-a', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_A, 'boss'),
      body: {},
    });
    // 旧实现此处返回 400「tenantId 必填」（data-lifecycle.ts:35-37）；新口径缺省即身份 ⇒ 200
    expect(res.status).toBe(200);
    expect(res.body['ok']).toBe(true);
    const archive = decodeArchive(res.body);
    expect(archive.tenantId).toBe(ORG_A);
  });

  it('U-1c archive.nodes 含 org-a 节点、不含 org-b 节点（matchesTenant 生效）', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_A, 'boss'),
      body: { tenantId: ORG_A, role: 'boss' },
    });
    expect(res.status).toBe(200);
    const archive = decodeArchive(res.body);
    const ids = archive.nodes.map((node) => node.id);
    // 真 store 真写入 ⇒ 真导出可见（防"假 store / 恒真断言"假绿）
    expect(ids).toContain(orgANodeId);
    // 带租户标记的异租户节点必须被过滤（matchesTenant，data-exporter.ts:244-252）
    expect(ids).not.toContain(orgBNodeId);
    // 🔴 不断言"导出内容只含 org-a"（§4-8 已知限制 / 裁定 A）
  });

  it('U-1d 身份 org-a/admin + GET /api/audit?orgId=org-a ⇒ 200；省略 query ⇒ 200', async () => {
    const withQuery = await httpCall(`/api/audit?orgId=${ORG_A}`, {
      method: 'GET',
      token: signToken(ORG_A, 'admin'),
    });
    expect(withQuery.status).toBe(200);
    expect(withQuery.body['ok']).toBe(true);

    const withoutQuery = await httpCall('/api/audit', {
      method: 'GET',
      token: signToken(ORG_A, 'admin'),
    });
    // 缺省即身份（audit.ts 原 `query.orgId || authCtx.orgId || 'default'` 里的 'default' 回落已删）
    expect(withoutQuery.status).toBe(200);
    expect(withoutQuery.body['ok']).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// U-2 · 反例①跨租户导出／清除 ⇒ 403
// ════════════════════════════════════════════════════════════════

describe('#1200 U-2 反例① — 跨租户导出／清除 ⇒ 403 CROSS_ORG_DENIED', () => {
  it('U-2a 身份 org-a/boss + body{tenantId:org-b,role:boss} export ⇒ 403 CROSS_ORG_DENIED/org_mismatch', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_A, 'boss'),
      body: { tenantId: ORG_B, role: 'boss' },
    });
    expect(res.status).toBe(403);
    expect(res.body['ok']).toBe(false);
    expect(res.body['code']).toBe('CROSS_ORG_DENIED');
    expect(res.body['reason']).toBe('org_mismatch');
  });

  it('U-2b 对称：身份 org-b/boss + body{tenantId:org-a} export ⇒ 403 同码同 reason', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_B, 'boss'),
      body: { tenantId: ORG_A },
    });
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('CROSS_ORG_DENIED');
    expect(res.body['reason']).toBe('org_mismatch');
  });

  it('U-2c 身份 org-a/boss + body{tenantId:org-b,role:boss,immediate:true} purge ⇒ 403；org-b 零删除（2→2）', async () => {
    const before = inspectGraph();
    expect(before.total).toBe(2);
    expect(before.ids).toContain(orgBNodeId);

    const res = await httpCall('/api/data/purge', {
      token: signToken(ORG_A, 'boss'),
      body: { tenantId: ORG_B, role: 'boss', immediate: true },
    });
    // 破坏面：purge 是 DATA_DELETE，最优先；被拒后**目标租户零删除**
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('CROSS_ORG_DENIED');
    expect(res.body['reason']).toBe('org_mismatch');

    const after = inspectGraph();
    expect(after.total).toBe(2); // 2 → 2：零删除（真库计数，非计数探针）
    expect(after.ids).toContain(orgBNodeId); // org-b 节点仍在
    expect(after.ids).toContain(orgANodeId);
  });
});

// ════════════════════════════════════════════════════════════════
// U-3 · 反例②自授角色 ⇒ 403
// ════════════════════════════════════════════════════════════════

describe('#1200 U-3 反例② — 自授角色 ⇒ 403 IDENTITY_MISMATCH', () => {
  it('U-3a 身份 org-a/staff + body{tenantId:org-a,role:boss} export ⇒ 403 IDENTITY_MISMATCH/role_declared', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_A, 'staff'),
      body: { tenantId: ORG_A, role: 'boss' },
    });
    expect(res.status).toBe(403);
    expect(res.body['ok']).toBe(false);
    expect(res.body['code']).toBe('IDENTITY_MISMATCH');
    expect(res.body['reason']).toBe('role_declared');
  });

  it('U-3b 身份 org-a/staff + body{tenantId:org-a}（不传 role）⇒ 403（checkPolicy deny，不自授也拿不到）', async () => {
    const res = await httpCall('/api/data/export', {
      token: signToken(ORG_A, 'staff'),
      body: { tenantId: ORG_A },
    });
    // role 取身份 staff ⇒ `deny_staff_sensitive`（policy-engine.ts:118-122，S3 + staff）deny
    expect(res.status).toBe(403);
    expect(res.body['ok']).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// U-4 · 反例③跨租户读审计 ⇒ 403
// ════════════════════════════════════════════════════════════════

describe('#1200 U-4 反例③ — 跨租户读审计 ⇒ 403 CROSS_ORG_DENIED', () => {
  it('U-4a 身份 org-a/admin + GET /api/audit?orgId=org-b ⇒ 403 CROSS_ORG_DENIED', async () => {
    const res = await httpCall(`/api/audit?orgId=${ORG_B}`, {
      method: 'GET',
      token: signToken(ORG_A, 'admin'),
    });
    expect(res.status).toBe(403);
    expect(res.body['ok']).toBe(false);
    expect(res.body['code']).toBe('CROSS_ORG_DENIED');
  });

  it('U-4b 身份 org-a/admin + GET /api/audit/ga/ga-1?orgId=org-b ⇒ 403 同码（同型）', async () => {
    const res = await httpCall(`/api/audit/ga/ga-1?orgId=${ORG_B}`, {
      method: 'GET',
      token: signToken(ORG_A, 'admin'),
    });
    expect(res.status).toBe(403);
    expect(res.body['ok']).toBe(false);
    expect(res.body['code']).toBe('CROSS_ORG_DENIED');
  });
});

// ════════════════════════════════════════════════════════════════
// U-5 · 无身份 ⇒ 401（中间件先行；只断状态）
// ════════════════════════════════════════════════════════════════

describe('#1200 U-5 无身份 ⇒ 401（只断状态，🔴 不断 code==="AUTH_REQUIRED"）', () => {
  it('U-5-0 两态自切已生效：DEV_MODE 已删／JWT_SECRET ≥16／实例组织 org-a（防 DevMode 注入假绿）', () => {
    // 前置事实自证：若 DEV_MODE 残留，中间件会注入 dev-admin（role=admin/orgId=org-a），
    // 「无身份态」不存在 ⇒ 下面三条 401 判据会退化成"永远拿不到"的假机制
    expect(process.env['DEV_MODE']).toBeUndefined();
    expect((process.env['JWT_SECRET'] ?? '').length).toBeGreaterThanOrEqual(16);
    expect(process.env['SYNOVA_ORG_ID']).toBe(ORG_A);
    // 真签可用（null ⇒ 夹具失真，不应继续）
    expect(typeof signToken(ORG_A, 'admin', 'u-probe')).toBe('string');
  });

  it('U-5a 无 Authorization 打 POST /api/data/export ⇒ 401', async () => {
    const res = await httpCall('/api/data/export', { body: { tenantId: ORG_A, role: 'boss' } });
    expect(res.status).toBe(401);
    // 🔴 只断状态：`AUTH_REQUIRED` 这个码不存在（规格 §1.1-3／§3 U-5），断言它必红
  });

  it('U-5b 无 Authorization 打 POST /api/data/purge ⇒ 401', async () => {
    const res = await httpCall('/api/data/purge', { body: { tenantId: ORG_A, immediate: true } });
    expect(res.status).toBe(401);
  });

  it('U-5c 无 Authorization 打 GET /api/audit ⇒ 401', async () => {
    const res = await httpCall('/api/audit', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
