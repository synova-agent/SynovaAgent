/**
 * tests/routes/workspace-access-write-endpoint.test.ts — D947 PR-2b / P3 夹具（新建）
 *
 * 主题: `src/routes/workspaces-api.ts` 的**路由级写守卫**（P3）+ `/api/workspaces/mine`
 *   的**身份派生收口**（P0 活越权读）。
 *
 * 铁律 12 / 禁 grep 型静态判据当验收: 全部走 `createServer()` + `PORT=0` + 真实 fetch
 *   （先例 `tests/routes/llm-config.test.ts`），不 mock 管线、不读源码文本。
 *
 * P3 与 P4 **成对**（R2 / REV-3.3）: 守卫消费 `req.rbac`（L-4），而 `req.rbac` 只由
 *   `rbacMiddleware` 注入；`rbacMiddleware` 在 `src/server.ts` 的挂载点必须早于
 *   `workspacesApiRoutes`（L-2 区间 [357,366]）。若 P4 回退 ⇒ 正路径因 `req.rbac` 缺失
 *   而 fail-closed 403 ⇒ 本例 A2/A6/A7/A8 全红。反之若 P3 未接线 ⇒ 负路径全红。
 *
 * 判别性（删掉即报红）:
 *   · 摘掉任一写端点守卫 → 对应用例的 `expect(403)` 变 200 → 红
 *   · 把守卫改回 `extractRbacContext(req)` 重算（L-4 禁止）→ P4 前移成为空操作，
 *     但仍可通过本夹具（属"接线了 ≠ 被执行"的反面：本夹具同时锚在 req.rbac 的**存在性**上，
 *     见 A9/B4 的无 rbac 直接调用路径）
 *   · 恢复 `/mine` 的自报头子串判定 → B1（role 必须为 staff 且不含部门级工作区）必红
 *
 * 铁律 48: 每条用例均有 expect 断言；覆盖正常路径 / 拒绝路径（ga / 跨部门 / staff）/ 边界（无凭据）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server';
import { signJwtToken } from '../../src/middleware/auth';
import { getCurrentFilterClause, runWithContext } from '../../src/services/request-context';
import { KnowledgeStore } from '../../src/agent/knowledge-bridge-service';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'http';

// ════════════════════════════════════════════════════════════════
// 夹具状态
// ════════════════════════════════════════════════════════════════

let server: Server | undefined;
let BASE = '';
let tmpDataDir = '';
const savedEnv: Record<string, string | undefined> = {};

const ORG = 'org-d947';

/** 验签 JWT（唯一可信身份来源） */
function jwt(sub: string, role: string): string {
  const t = signJwtToken({ sub, role, orgId: ORG });
  if (!t) throw new Error('signJwtToken 返回 null — JWT_SECRET 未就位（夹具应判空转）');
  return t;
}

let T_M1 = '';    // manager, sub=m1（正路径属主）
let T_M2 = '';    // manager, sub=m2（非属主 manager）
let T_GA = '';    // ga
let T_STAFF = ''; // staff
let T_ADMIN = ''; // admin

interface ApiResult { status: number; body: Record<string, unknown> }

/** 真实 HTTP 调用（不 mock fetch —— 铁律 12） */
async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    body = { _raw: text };
  }
  return { status: res.status, body };
}

/** 从响应体读 workspace（inline 类型断言，零 as any / as never / as unknown as — 铁律 38） */
function pickWorkspace(body: Record<string, unknown>): { id: string; owner?: string; department?: string; visibility?: string } {
  const w = body['workspace'];
  if (typeof w !== 'object' || w === null) throw new Error('响应体缺 workspace 对象');
  const rec = w as { id: string; owner?: string; department?: string; visibility?: string };
  return rec;
}

/** 从 /mine 响应体读工作区 id 列表 */
function pickWorkspaceIds(body: Record<string, unknown>): string[] {
  const raw = body['workspaces'];
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item === 'object' && item !== null) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string') ids.push(id);
    }
  }
  return ids;
}

/** 从响应体读 role（必须是字符串，否则夹具应判空转） */
function pickRole(body: Record<string, unknown>): string {
  const role = body['role'];
  if (typeof role !== 'string') throw new Error(`响应体 role 非字符串: ${JSON.stringify(role)}`);
  return role;
}

// 夹具资源 id
let parentId = '';   // m1 属主 · 无部门 · global
let subMktId = '';   // m1 属主 · department=marketing · visibility=department（正路径目标）
let subSalesId = ''; // m1 属主 · department=sales（负路径目标）
let adminGlobalId = '';   // admin 属主 · global
let adminSubMktId = '';   // admin 属主 · department=marketing（/mine 越权判别目标）

/**
 * 夹具引导（含 N1 硬前置 + 资源建设）。
 *
 * 显式超时 60s：本机 `createServer()` bootstrap 实测≈15s（sentinel/skill/playbook 装载 +
 * schema 迁移），超过 vitest 默认 `hookTimeout: 10000`⇒ 会以 `Hook timed out` 假红。
 * 超时是**执行预算**不是判据放宽：N1 断言与全部用例断言均未削弱（见下方 expect）。
 */
beforeAll(async () => {
  // ════════════════════════════════════════════════════════════════
  // D947 N1 硬前置 —— 夹具自证环境已就位，否则判空转（不算通过）
  // ════════════════════════════════════════════════════════════════
  savedEnv.JWT_SECRET = process.env.JWT_SECRET;
  savedEnv.DEV_MODE = process.env.DEV_MODE;
  savedEnv.SYNOVA_DATA_DIR = process.env.SYNOVA_DATA_DIR;
  savedEnv.SYNOVA_DB_PATH = process.env.SYNOVA_DB_PATH;

  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_SKIP_MCP = '1';
  tmpDataDir = mkdtempSync(join(tmpdir(), 'synova-d947-write-'));
  process.env.SYNOVA_DATA_DIR = tmpDataDir;

  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');

  T_M1 = jwt('m1', 'manager');
  T_M2 = jwt('m2', 'manager');
  T_GA = jwt('ga-1', 'ga');
  T_STAFF = jwt('staff-1', 'staff');
  T_ADMIN = jwt('admin-1', 'admin');

  server = await createServer();
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  expect(port).toBeGreaterThan(0);
  BASE = `http://localhost:${port}`;

  // ═══ 夹具资源（全部经真实 HTTP 建立，顺带验证 P3 正路径可构造）═══
  const p = await api('/api/workspaces', { method: 'POST', token: T_M1, body: { title: 'D947-P' } });
  expect(p.status, `夹具前置: m1 建父工作区应 200，实得 ${p.status} ${JSON.stringify(p.body)}`).toBe(200);
  parentId = pickWorkspace(p.body).id;

  const s1 = await api(`/api/workspaces/${parentId}/sub`, {
    method: 'POST', token: T_M1, body: { department: 'marketing', title: 'D947-S1' },
  });
  expect(s1.status, '夹具前置: m1 建子工作区 S1 应 200').toBe(200);
  subMktId = pickWorkspace(s1.body).id;

  const s2 = await api(`/api/workspaces/${parentId}/sub`, {
    method: 'POST', token: T_M1, body: { department: 'sales', title: 'D947-S2' },
  });
  expect(s2.status, '夹具前置: m1 建子工作区 S2 应 200').toBe(200);
  subSalesId = pickWorkspace(s2.body).id;

  const g = await api('/api/workspaces', { method: 'POST', token: T_ADMIN, body: { title: 'D947-G' } });
  expect(g.status, '夹具前置: admin 建全局工作区应 200').toBe(200);
  adminGlobalId = pickWorkspace(g.body).id;

  const s3 = await api(`/api/workspaces/${adminGlobalId}/sub`, {
    method: 'POST', token: T_ADMIN, body: { department: 'marketing', title: 'D947-S3' },
  });
  expect(s3.status, '夹具前置: admin 建子工作区 S3 应 200').toBe(200);
  adminSubMktId = pickWorkspace(s3.body).id;

  // 前置自证：目标资源属性符合判据构造意图（避免夹具静默构造错）
  expect(pickWorkspace(g.body).owner).toBe('admin-1');
  expect(pickWorkspace(p.body).owner).toBe('m1');
}, 60_000);

afterAll(() => {
  if (server) server.close();
  if (tmpDataDir && tmpDataDir.startsWith(tmpdir())) rmSync(tmpDataDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ════════════════════════════════════════════════════════════════
// P3 — 写端点守卫矩阵（真打 HTTP）
// ════════════════════════════════════════════════════════════════

describe('P3 · POST /api/workspaces — 写守卫', () => {
  it('staff → 403（含判据结果不得被丢弃）', async () => {
    const r = await api('/api/workspaces', { method: 'POST', token: T_STAFF, body: { title: 'x' } });
    expect(r.status).toBe(403);
    expect(r.body['error']).toBe('access denied');
  });

  it('ga → 403（canModifyWorkspace 对 ga 恒 false）', async () => {
    const r = await api('/api/workspaces', { method: 'POST', token: T_GA, body: { title: 'x' } });
    expect(r.status).toBe(403);
  });

  it('正路径: admin → 200 且 owner 取自验签身份', async () => {
    const r = await api('/api/workspaces', { method: 'POST', token: T_ADMIN, body: { title: 'D947-A1' } });
    expect(r.status).toBe(200);
    expect(pickWorkspace(r.body).owner).toBe('admin-1');
  });

  it('边界: 无凭据 → 401（中间件 fail-closed，先于路由）', async () => {
    const r = await api('/api/workspaces', { method: 'POST', body: { title: 'x' } });
    expect(r.status).toBe(401);
  });
});

describe('P3 · PUT /api/workspaces/:id/status — 写守卫', () => {
  it('正路径: owner===userId 的 manager → 200（L-6 唯一通过路径）', async () => {
    const r = await api(`/api/workspaces/${subMktId}/status`, {
      method: 'PUT', token: T_M1, body: { status: 'analyzing' },
    });
    expect(r.status).toBe(200);
  });

  it('负路径: 非属主 manager 打部门级工作区 → 403（R5/REV-8 已裁定为功能回退，非缺陷）', async () => {
    // JWT 载荷无 department ⇒ ctx.department 恒 undefined ⇒ 部门分支恒不成立；
    // 且 owner(m1) !== userId(m2) ⇒ 拒绝。此处即 L-6③ 要求显式覆盖的
    // 「manager 且部门级工作区 → deny」路径：**功能回退已登记（R5/REV-8）**，不得读作已修复。
    const r = await api(`/api/workspaces/${subSalesId}/status`, {
      method: 'PUT', token: T_M2, body: { status: 'analyzing' },
    });
    expect(r.status).toBe(403);
  });

  it('负路径: ga → 403', async () => {
    const r = await api(`/api/workspaces/${subSalesId}/status`, {
      method: 'PUT', token: T_GA, body: { status: 'analyzing' },
    });
    expect(r.status).toBe(403);
  });

  it('负路径: staff → 403', async () => {
    const r = await api(`/api/workspaces/${subSalesId}/status`, {
      method: 'PUT', token: T_STAFF, body: { status: 'analyzing' },
    });
    expect(r.status).toBe(403);
  });

  it('边界: 无凭据 → 401', async () => {
    const r = await api(`/api/workspaces/${subSalesId}/status`, { method: 'PUT', body: { status: 'analyzing' } });
    expect(r.status).toBe(401);
  });
});

describe('P3 · POST /api/workspaces/:id/messages — 写守卫', () => {
  it('负路径: staff → 403', async () => {
    const r = await api(`/api/workspaces/${subMktId}/messages`, {
      method: 'POST', token: T_STAFF, body: { content: 'hi' },
    });
    expect(r.status).toBe(403);
  });

  it('正路径: owner manager → 200', async () => {
    const r = await api(`/api/workspaces/${subMktId}/messages`, {
      method: 'POST', token: T_M1, body: { content: 'hi' },
    });
    expect(r.status).toBe(200);
    expect(typeof r.body['reply']).toBe('string');
  });
});

describe('P3 · POST /api/workspaces/:id/sub — 写守卫（判据绑定父工作区）', () => {
  it('负路径: staff → 403', async () => {
    const r = await api(`/api/workspaces/${parentId}/sub`, {
      method: 'POST', token: T_STAFF, body: { department: 'sales', title: 'x' },
    });
    expect(r.status).toBe(403);
  });

  it('负路径: ga → 403', async () => {
    const r = await api(`/api/workspaces/${parentId}/sub`, {
      method: 'POST', token: T_GA, body: { department: 'sales', title: 'x' },
    });
    expect(r.status).toBe(403);
  });

  it('正路径: 父属主 manager → 200 且子工作区 owner 取自验签身份', async () => {
    const r = await api(`/api/workspaces/${parentId}/sub`, {
      method: 'POST', token: T_M1, body: { department: 'sales', title: 'D947-S4' },
    });
    expect(r.status).toBe(200);
    expect(pickWorkspace(r.body).owner).toBe('m1');
  });
});

describe('P3 · PUT /api/workspaces/:id/merge — 写守卫', () => {
  it('负路径: staff → 403', async () => {
    const r = await api(`/api/workspaces/${subSalesId}/merge`, { method: 'PUT', token: T_STAFF });
    expect(r.status).toBe(403);
  });

  it('负路径: ga → 403', async () => {
    const r = await api(`/api/workspaces/${subSalesId}/merge`, { method: 'PUT', token: T_GA });
    expect(r.status).toBe(403);
  });

  it('正路径: 子属主 manager → 200', async () => {
    const r = await api(`/api/workspaces/${subSalesId}/merge`, { method: 'PUT', token: T_M1 });
    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════
// P0 — GET /api/workspaces/mine 活越权读
//
// D1002（ordering 已修）: /by-dept/:dept、/mine、/conflicts 三块已整体上移至
//   `GET /:id` 之前注册 ⇒ /mine 经 HTTP **真实可达**（D947 F-1 遮蔽收口；原
//   「恒 404 / CTO 裁定另立卡 / 本卡不修 ordering」口径作废——D1002 即那张卡）。
//   本组**直接 handler 运行时探针保留**（快速判别性路径，语义不变，仍非 grep 型
//   静态判据）；HTTP 面正路径见下方 D1002 翻转断言（200）。
// ════════════════════════════════════════════════════════════════

/** 取 /mine 的 handler（直接调用形态，绕过路由遮蔽，用于 P0 判别性探针） */
async function loadMineHandler(): Promise<(req: unknown, res: unknown) => unknown> {
  const mod = await import('../../src/routes/workspaces-api');
  interface RouteLayer {
    route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown) => unknown }> };
  }
  const stack = (mod.default as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === '/api/workspaces/mine' && l.route?.methods?.['get']);
  expect(layer?.route, 'GET /api/workspaces/mine handler 必须可提取（否则判空转）').toBeDefined();
  const handler = layer?.route?.stack[0]?.handle;
  expect(handler).toBeDefined();
  return handler as (req: unknown, res: unknown) => unknown;
}

/** 以给定 req 直接调用 /mine handler，返回 { status, body }（未显式 status() 即 200） */
async function callMine(req: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const handler = await loadMineHandler();
  let status = 200;
  let wroteJson = false;
  let payload: Record<string, unknown> = {};
  const res = {
    status: (c: number) => { status = c; return res; },
    json: (b: unknown) => { wroteJson = true; payload = (b as Record<string, unknown>) ?? {}; return res; },
  };
  await handler(req, res);
  // 判据不得被丢弃：handler 必须真的写出响应（否则判空转）
  expect(wroteJson, 'handler 未写出 JSON 响应（判据被丢弃 / 未接线）').toBe(true);
  return { status, body: payload };
}

/** 合成验签 RBAC 上下文（等价 rbacMiddleware 注入形态 —— 只来自 req.auth） */
function syntheticRbac(role: string, userId: string, authenticated = true) {
  return { role, userId, department: undefined, authenticated };
}

describe('P0 · GET /api/workspaces/mine — 自报身份完全失效（直接 handler 运行时探针）', () => {
  it('已认证低权用户 + 自报 admin 头 → role 取自验签身份，且拿不到部门级工作区', async () => {
    // 改前: role = token.includes('admin') ? 'admin' : … ⇒ 自报 'admin' 即成管理员 ⇒ 返回全部工作区
    // 改后: role 只来自 req.rbac（验签注入）；自报头零参与
    const r = await callMine({
      rbac: syntheticRbac('staff', 'staff-1'),
      headers: { 'x-synova-token': 'admin' },
      query: {},
    });
    expect(r.status).toBe(200);
    expect(pickRole(r.body)).toBe('staff');

    const ids = pickWorkspaceIds(r.body);
    expect(ids).not.toContain(adminSubMktId);  // admin 的部门级子工作区
    expect(ids).not.toContain(subMktId);       // 他人部门级
    expect(ids).not.toContain(subSalesId);     // 他人部门级
  });

  it('不带自报头 → role 取自验签身份，**不得**默认 manager', async () => {
    // 改前: 无头 ⇒ token='' ⇒ role 默认 'manager'
    const r = await callMine({ rbac: syntheticRbac('staff', 'staff-1'), headers: {}, query: {} });
    expect(r.status).toBe(200);
    expect(pickRole(r.body)).toBe('staff');
  });

  it('对照: admin 身份确实可见部门级工作区（证明上条不是"恒空"假绿）', async () => {
    const r = await callMine({ rbac: syntheticRbac('admin', 'admin-1'), headers: {}, query: {} });
    expect(r.status).toBe(200);
    expect(pickRole(r.body)).toBe('admin');
    expect(pickWorkspaceIds(r.body)).toContain(adminSubMktId);
  });

  it('判别性: 无 req.rbac → 403 fail-closed（不得默认 manager / 不得放行）', async () => {
    const r = await callMine({ headers: {}, query: {} });
    expect(r.status).toBe(403);
    expect(r.body['error']).toBe('access denied');
  });

  it('判别性: req.rbac.authenticated=false（匿名上下文）→ 403', async () => {
    const r = await callMine({
      rbac: syntheticRbac('staff', 'unauthenticated', false),
      headers: { 'x-synova-token': 'admin' },
      query: {},
    });
    expect(r.status).toBe(403);
  });

  it('HTTP 面: 无凭据 → 401（中间件 fail-closed）', async () => {
    const r = await api('/api/workspaces/mine');
    expect(r.status).toBe(401);
  });

  it('D1002 翻转: HTTP 面可达 → 200（原登记性断言按 :335 预告「翻转为 200，不得静默改动」执行）', async () => {
    // D947 期原断言 = expect(404)（F-1 遮蔽锁定现状，不代表期望行为）。
    // D1002 修 ordering 后按原预告翻转；staff JWT 下 /mine 返回真实过滤结果。
    const r = await api('/api/workspaces/mine', { token: T_STAFF });
    expect(r.status).toBe(200);
    expect(r.body['ok']).toBe(true);
    expect(r.body['role']).toBe('staff');
  });
});

// ════════════════════════════════════════════════════════════════
// F-2 — L-6 前提订正（PR-2b 新发现 · CTO 已裁定 (a)：**本卡内修复**，
//        以 PR-1 fixup（A2）交付，写者 code-a；本文件**不碰 rbac.ts**）
//
// L-6 原文：「JWT 用户 ctx.department 恒 undefined ⇒ canModifyWorkspace 的部门分支**恒 false**，
//   唯一通过路径 = ws.owner === userId」。
// 实测订正：`ws.department === ctx.department` 在**两侧均为 undefined** 时成立
//   ⇒ 部门分支对「无部门工作区」恒 **true** ⇒ 非属主 manager 亦可通过（**fail-open 授权分支**）。
//   ⇒ 「唯一通过路径 = owner」仅对 **ws.department 有值**的工作区成立。
// 裁定：**(a) 本卡内修复（fail-closed）** —— 部门分支须**双方部门均有值**才可能命中。
// 本组断言的是**裁定后契约**（即 A2 落地后的行为）：双侧 undefined ⇒ deny。
//   顺序 **A2 → 本夹具 → commit B**；A2 未落地时本组为红，属**预期的跨 PR 依赖**，不得静默放宽。
// 行内预写（原）: 「若裁定给 rbac.ts 加 `ws.department &&` 前置，本断言须翻转为 false，不得静默改动」→ 已按裁定执行翻转。
// ════════════════════════════════════════════════════════════════

describe('F-2 · canModifyWorkspace 部门分支对无部门工作区的行为（F-2 已裁定修复，A2 交付）', () => {
  it('非属主 manager + 无部门工作区 → deny（F-2 已裁定修复，A2 交付）', async () => {
    const { canModifyWorkspace } = await import('../../src/middleware/rbac');
    const ctx = { role: 'manager' as const, userId: 'm2', department: undefined, authenticated: true };
    // 裁定后契约: 部门分支须**双方部门均有值**才可能命中；双侧 undefined ⇒ 不命中，且 owner 不匹配 ⇒ deny
    expect(canModifyWorkspace(ctx, { department: undefined, owner: 'm1' })).toBe(false);
    // 对照 1: 同一非属主 manager 打**有部门**的工作区 → 部门分支不成立且 owner 不匹配 → 拒绝
    expect(canModifyWorkspace(ctx, { department: 'sales', owner: 'm1' })).toBe(false);
    // 对照 2: 属主本人（owner===userId）仍经 owner 分支通过 ⇒ F-2 修复未过度收紧（P3 正路径不受影响）
    expect(canModifyWorkspace(ctx, { department: undefined, owner: 'm2' })).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// L-21 — 漏斗兜底（services/request-context.ts）必须 fail-closed
//
// 触发（verifier R-1）: 白名单路径不经过 runWithContext ⇒ 该分支无 authProvider
//   ⇒ getCurrentFilterClause() 落回兜底；而 /api/knowledge/ask 正在白名单内。
//   旧兜底返回**空条件集**，而 l4/knowledge-store.ts:195/:335 在条件集长度为 0 时
//   **完全跳过过滤** ⇒ 空 = 不过滤 = fail-open。
// 本组判据形态（禁 grep 型静态判据）: ①条件集形状 ②真实 KnowledgeStore 引擎级结果
//   ③对照（有上下文时同一引擎可用）——三者在同一轮次内成对。
// ════════════════════════════════════════════════════════════════

describe('L-21 · 漏斗兜底 fail-closed（无请求上下文 ⇒ 非空 deny-all）', () => {
  /** 内存库 + 两个敏感度的块（隔离单一变量） */
  function seedStore(): { store: KnowledgeStore; close: () => void } {
    const db = new Database(':memory:');
    const store = new KnowledgeStore(db);
    store.insert({
      text: 'gamma normal knowledge', sourceType: 'document', sourceId: 'g1',
      authorityLevel: 'reference', accessLevel: 'public', accessSensitivity: 'normal',
    });
    store.insert({
      text: 'gamma restricted knowledge', sourceType: 'document', sourceId: 'g2',
      authorityLevel: 'reference', accessLevel: 'public', accessSensitivity: 'restricted',
    });
    return { store, close: () => db.close() };
  }

  it('无请求上下文 → 兜底条件集**非空**（不得为空集）', async () => {
    // 注意: 本用例在 AsyncLocalStorage 上下文之外调用 ⇒ 走兜底分支
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    expect(Array.isArray(filter.conditions)).toBe(true);
    expect(filter.conditions.length).toBeGreaterThan(0);
  });

  it('判别性（引擎级）: 兜底条件集喂入真实 KnowledgeStore → 全部行被过滤（deny-all）', async () => {
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    const { store, close } = seedStore();
    try {
      const { results, stats } = store.search('gamma', filter, 10);
      expect(stats.totalHits).toBe(2);                 // 引擎确实检索到两行
      expect(stats.filteredOut).toBe(2);               // 兜底为 deny-all ⇒ 两行全被过滤
      expect(results.length).toBe(0);                  // 空条件集时此处为 2（即红）
    } finally {
      close();
    }
  });

  it('对照: 有请求上下文（runWithContext + 真实 authProvider 形态）→ 引擎按条件放行', async () => {
    const ctx = {
      user: {
        userId: 'u-staff-1',
        identity: { openId: 'u-staff-1', email: 'u-staff-1@org-d947', name: 'u-staff-1', source: 'jwt' },
        auth: { roles: ['staff'], teamId: 'org-d947', tenantId: 'org-d947', sensitivity: 'normal' },
        permissions: { version: 1, expiresAt: Date.now() + 3600_000 },
      },
      authProvider: {
        getPermissionFilter: async () => ({
          conditions: [{ field: 'access.sensitivity', operator: 'IN' as const, value: ['normal'] }],
        }),
      },
    };
    const filter = await runWithContext(ctx, async () => getCurrentFilterClause('KnowledgeChunk'));
    expect(filter.conditions.length).toBeGreaterThan(0);

    const { store, close } = seedStore();
    try {
      const { results, stats } = store.search('gamma', filter, 10);
      expect(stats.totalHits).toBe(2);
      expect(stats.filteredOut).toBe(1);               // 仅 restricted 被过滤
      expect(results.map(r => r.accessSensitivity)).toEqual(['normal']);
    } finally {
      close();
    }
  });
});
