/**
 * tests/routes/workspaces-mine-conflicts.test.ts — D1002 夹具（新建）
 *
 * 判据源 = docs/synova/product-lines/evidence/D1002-20260925/PLAN.md v1.3（唯一判据源）。
 * 主题: workspaces 路由自卫——F1（/mine HTTP 可达）/ F2（/conflicts 守卫）/
 *   F3（注册序双探针）/ F4+E-2（/merge 边界四值）/ F5（正常+降级+边界）/
 *   【附条件1+2】by-dept/context 哨兵。
 *
 * 铁律 12: 真实 createServer() + PORT=0 + 真实 fetch，不 mock 管线
 *   （先例 tests/routes/workspace-access-write-endpoint.test.ts / middleware-order.test.ts）。
 * ◆F1 裁定: HTTP 面只断真实路径；部门分支零断言、零覆盖，不用 syntheticRbac。
 *   唯二非 HTTP 探针均为先例认可形态:
 *   · F2-P = 直接 handler 无 req.rbac → fail-closed 403（判别性腿，非合成身份注入）;
 *   · 边界四值「id 空串」= 真实 JWT 链直调（jwtAuthMiddleware→rbacMiddleware→抽出 handler，
 *     ◆F1 认可形态）——HTTP 面空段在 Express `[^/]+` 语义下不匹配路由（实测 404 Cannot PUT），
 *     物理无法表达空 id。
 * F5 降级 = 同实例 env 翻转（auth.ts:50/:349 逐请求读 process.env），日志捕获先例
 *   tests/middleware/auth.test.ts:25-41/:493-523（vi.mock('@synova/logger')）。
 * 铁律 48: 每条用例均有 expect 断言; 覆盖正常 / 降级 / 边界。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { createServer } from '../../src/server';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';

// ═══ 日志捕获（F5 降级留痕断言; 先例 auth.test.ts:25-41）═══
const logCapture = vi.hoisted(() => {
  const calls: Array<{ level: string; meta?: { code?: string }; msg?: unknown }> = [];
  return { calls };
});
vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: { code?: string }, msg?: unknown) => {
    logCapture.calls.push({ level, meta, msg });
  };
  return {
    ...actual, // root `logger` 保真（runtime-global-handlers.ts:27 的 logger.fatal 不经 mock）
    createLogger: () => ({
      // D1002: 补 fatal/trace 空录——防装配路径未来调用缺失方法炸 mock（防御性，实测 src 子 logger 仅用 4 法）
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
      fatal: record('fatal'), trace: record('trace'),
    }),
  };
});

// ═══ 夹具状态（先例 workspace-access-write-endpoint.test.ts:39-42 savedEnv 模式）═══

let server: Server | undefined;
let BASE = '';
let tmpDataDir = '';
const savedEnv: Record<string, string | undefined> = {};

let T_M1 = '';    // manager, sub=m1（正路径属主）
let T_M2 = '';    // manager, sub=m2（非属主 manager）
let T_STAFF = ''; // staff（低权）
let T_ADMIN = ''; // admin（对照）

// 播种产物 id（各 describe 的 beforeAll 内写入）
let ownWsId = '';         // m1 自有（global）
let globalByAdminId = ''; // admin 建的 global
let marketingSubId = '';  // admin 的 department='marketing' 子（他人部门级）
let m1SubId = '';         // m1 自有子（正路径 merge 目标）

interface ApiResult { status: number; body: Record<string, unknown> }

/** 真实 HTTP 调用（不 mock fetch —— 铁律 12; 先例 api() helper） */
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

/** 验签 JWT（唯一可信身份来源; 签不出即判空转） */
function jwt(sub: string, role: string): string {
  const t = signJwtToken({ sub, role, orgId: 'org-d1002' });
  if (!t) throw new Error('signJwtToken 返回 null — JWT_SECRET 未就位（夹具应判空转）');
  return t;
}

/** 从创建类响应取 workspace.id（播种失败即红，附响应体） */
function idOf(r: ApiResult, expected: number): string {
  expect(r.status, `播种失败（期望 ${expected}）: ${JSON.stringify(r.body)}`).toBe(expected);
  const ws = r.body['workspace'] as { id?: string } | undefined;
  expect(ws?.id, '播种响应缺 workspace.id').toBeDefined();
  return ws?.id ?? '';
}

/** 取 /mine、/by-dept 类响应的 workspace id 列表 */
function wsIdsOf(body: Record<string, unknown>): string[] {
  const list = body['workspaces'];
  if (!Array.isArray(list)) return [];
  return list.map((w) => (w as { id?: string }).id ?? '');
}

/** router 层形态（先例 loadMineHandler :341-343; 单层内联类型断言，铁律 38 零容忍模式零使用） */
interface RouteLayer {
  route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown) => unknown }> };
}

async function routerStack(): Promise<RouteLayer[]> {
  const mod = await import('../../src/routes/workspaces-api');
  return (mod.default as { stack: RouteLayer[] }).stack;
}

/** 从 router.stack 抽指定路由 handler，以给定 req 直调（先例 loadMineHandler/callMine :338-366） */
async function callHandlerDirect(
  routePath: string, method: 'get' | 'put', req: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const stack = await routerStack();
  const layer = stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  expect(layer?.route, `${method} ${routePath} handler 必须可提取（否则判空转）`).toBeDefined();
  const handler = layer?.route?.stack[0]?.handle;
  expect(handler).toBeDefined();
  let status = 200;
  let wroteJson = false;
  let payload: Record<string, unknown> = {};
  const res = {
    status: (c: number) => { status = c; return res; },
    json: (b: unknown) => { wroteJson = true; payload = (b as Record<string, unknown>) ?? {}; return res; },
  };
  await handler?.(req, res);
  expect(wroteJson, 'handler 未写出 JSON 响应（判据被丢弃 / 未接线）').toBe(true);
  return { status, body: payload };
}

/**
 * 真实 JWT 链直调 merge handler（◆F1 认可形态，零合成身份注入）:
 * jwtAuthMiddleware（验签注入 req.auth）→ rbacMiddleware（注入 req.rbac）→ 抽出 handler。
 * 用途: HTTP 面无法表达的 id 形态——空串段在 Express `[^/]+` 下不匹配路由（实测 404 Cannot PUT）。
 */
async function callMergeRealChain(id: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const stack = await routerStack();
  const layer = stack.find((l) => l.route?.path === '/api/workspaces/:id/merge' && l.route?.methods?.['put']);
  expect(layer?.route, 'PUT /api/workspaces/:id/merge handler 必须可提取（否则判空转）').toBeDefined();
  const handler = layer?.route?.stack[0]?.handle;
  expect(handler).toBeDefined();

  let status = 200;
  let wroteJson = false;
  let payload: Record<string, unknown> = {};
  const res = {
    status: (c: number) => { status = c; return res; },
    json: (b: unknown) => { wroteJson = true; payload = (b as Record<string, unknown>) ?? {}; return res; },
  };
  const req = {
    method: 'PUT',
    path: `/api/workspaces/${id}/merge`,
    headers: { authorization: `Bearer ${token}` },
    params: { id },
  } as Request;

  await new Promise<void>((resolve) => {
    jwtAuthMiddleware(req, res as Response, () => resolve());
  });
  await new Promise<void>((resolve) => {
    rbacMiddleware(req, res as Response, () => resolve());
  });
  await handler?.(req, res);
  expect(wroteJson, 'merge handler 未写出 JSON 响应（判据被丢弃）').toBe(true);
  return { status, body: payload };
}

// ═══ N1 硬前置 + 服务器装配（先例 middleware-order.test.ts:90-122, hookTimeout 120s——bootstrap ≈15s）═══

beforeAll(async () => {
  // vitest.config.ts env 块设 DEV_MODE='true' ⇒ 必须显式压掉（否则 auth.ts devMode 自动 admin，全负路径空转）
  savedEnv.DEV_MODE = process.env.DEV_MODE;
  savedEnv.JWT_SECRET = process.env.JWT_SECRET;
  savedEnv.PORT = process.env.PORT;
  savedEnv.SYNOVA_DB_PATH = process.env.SYNOVA_DB_PATH;
  savedEnv.SYNOVA_DATA_DIR = process.env.SYNOVA_DATA_DIR;

  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = 'd1002-test-secret-0123456789'; // 26 chars ≥ 16
  process.env.PORT = '0'; // config.ts parseInt('0')=0 → app.listen(0) 由 OS 分配端口
  process.env.SYNOVA_DB_PATH = ':memory:';
  tmpDataDir = mkdtempSync(join(tmpdir(), 'd1002-ws-routes-'));
  process.env.SYNOVA_DATA_DIR = tmpDataDir; // 严禁写真实 data/

  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');

  server = await createServer(); // 真实 Bootstrap + 真实 express 装配
  const addr = (server as Server & { address(): AddressInfo }).address();
  BASE = `http://127.0.0.1:${addr.port}`;

  T_M1 = jwt('m1', 'manager');
  T_M2 = jwt('m2', 'manager');
  T_STAFF = jwt('staff-1', 'staff');
  T_ADMIN = jwt('admin-1', 'admin');

  // 健康探针: 把「bootstrap 挂了（进程被杀）」与「断言不符」两类红分开（先例 :119-121）
  const health = await fetch(`${BASE}/health`);
  expect(health.status).toBeLessThan(500);
}, 120_000);

afterAll(async () => {
  if (server) server.close();
  if (tmpDataDir && tmpDataDir.startsWith(tmpdir())) {
    rmSync(tmpDataDir, { recursive: true, force: true });
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}, 30_000);

// ═══════════════════════════════════════════════════════════════
// F3 · 源码腿 — 注册行全字面量 needle（裸路径 indexOf 会被注释裸路径假绿，禁用）
// ═══════════════════════════════════════════════════════════════

const WS_API_TS = fileURLToPath(new URL('../../src/routes/workspaces-api.ts', import.meta.url));

describe('F3 · 源码腿 — readFileSync + 注册行 needle（先例 middleware-order P4/I4 :139-162）', () => {
  const src = readFileSync(WS_API_TS, 'utf8');
  // needle 带闭合引号 ⇒ 唯一命中注册行: "router.get('/api/workspaces/:id'" 不会命中
  // ':id/context' 注册行（其后随 '/' 非 '"'），也不会命中头注释/行内注释（无 router.get( 前缀）。
  const at = (needle: string): number => {
    const i = src.indexOf(needle);
    expect(i, `src/routes/workspaces-api.ts 未找到注册行: ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it('三块均注册于 GET /:id 之前（F3 主断言; M1 变异体在此红）', () => {
    const idAt = at("router.get('/api/workspaces/:id'");
    expect(at("router.get('/api/workspaces/by-dept/:dept'")).toBeLessThan(idAt);
    expect(at("router.get('/api/workspaces/mine'")).toBeLessThan(idAt);
    expect(at("router.get('/api/workspaces/conflicts'")).toBeLessThan(idAt);
  });

  it('块间相对序 by-dept → mine → conflicts（PLAN ① 新下标 2/3/4）', () => {
    expect(at("router.get('/api/workspaces/by-dept/:dept'")).toBeLessThan(at("router.get('/api/workspaces/mine'"));
    expect(at("router.get('/api/workspaces/mine'")).toBeLessThan(at("router.get('/api/workspaces/conflicts'"));
  });
});

// ═══════════════════════════════════════════════════════════════
// F3 · 运行时腿 — router.stack 层下标（11 层全 route ⇒ stack 序=注册序）
// ═══════════════════════════════════════════════════════════════

describe('F3 · 运行时腿 — router.stack 层下标（先例 loadMineHandler :338-350）', () => {
  it('index(by-dept)=2, index(mine)=3, index(conflicts)=4, index(/:id)=5（PLAN ①; M1 变异体在此红）', async () => {
    const stack = await routerStack();
    expect(stack.length).toBe(11); // 11 层全 route（无 router 级中间件）⇒ 下标=注册序
    const idx = (p: string) => stack.findIndex((l) => l.route?.path === p && l.route?.methods?.['get']);
    expect(idx('/api/workspaces/by-dept/:dept')).toBe(2);
    expect(idx('/api/workspaces/mine')).toBe(3);
    expect(idx('/api/workspaces/conflicts')).toBe(4);
    expect(idx('/api/workspaces/:id')).toBe(5);
    expect(idx('/api/workspaces/mine')).toBeLessThan(idx('/api/workspaces/:id'));
  });
});

// ═══════════════════════════════════════════════════════════════
// F5 边界 · 空 store 形态（本组须为文件内首个触达 store 的用例组——播种在后续 describe 的 beforeAll）
// ═══════════════════════════════════════════════════════════════

describe('F5 边界 · 空 store 形态', () => {
  it('GET /mine（manager JWT）→ 200 + workspaces 空数组', async () => {
    const r = await api('/api/workspaces/mine', { token: T_M1 });
    expect(r.status).toBe(200);
    expect(r.body['ok']).toBe(true);
    expect(Array.isArray(r.body['workspaces'])).toBe(true);
    expect((r.body['workspaces'] as unknown[]).length).toBe(0);
  });

  it('GET /conflicts（admin JWT）→ 200 + conflicts 空数组 + count 0', async () => {
    const r = await api('/api/workspaces/conflicts', { token: T_ADMIN });
    expect(r.status).toBe(200);
    expect(r.body['conflicts']).toEqual([]);
    expect(r.body['count']).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// F1 · GET /api/workspaces/mine — HTTP 面（◆F1: 只断真实路径; 部门分支零断言、零覆盖）
// ═══════════════════════════════════════════════════════════════

describe('F1 · GET /api/workspaces/mine — HTTP 面（真实 JWT; M1 变异体在此红）', () => {
  beforeAll(async () => {
    ownWsId = idOf(await api('/api/workspaces', { method: 'POST', token: T_M1, body: { title: 'D1002-F1-own' } }), 200);
    globalByAdminId = idOf(await api('/api/workspaces', { method: 'POST', token: T_ADMIN, body: { title: 'D1002-F1-global' } }), 200);
    marketingSubId = idOf(
      await api(`/api/workspaces/${globalByAdminId}/sub`, {
        method: 'POST', token: T_ADMIN, body: { department: 'marketing', title: 'D1002-F1-mkt-sub' },
      }),
      200,
    );
  });

  it('manager JWT → 200 ≠ 404（遮蔽已除）+ role=manager', async () => {
    const r = await api('/api/workspaces/mine', { token: T_M1 });
    expect(r.status).toBe(200);
    expect(r.body['ok']).toBe(true);
    expect(r.body['role']).toBe('manager');
  });

  it('可见集: 含自有属主工作区 + global；不含他人 department 工作区（真实路径可达性判据）', async () => {
    const r = await api('/api/workspaces/mine', { token: T_M1 });
    expect(r.status).toBe(200);
    const ids = wsIdsOf(r.body);
    expect(ids).toContain(ownWsId);          // 属主
    expect(ids).toContain(globalByAdminId);  // global 可见集
    expect(ids).not.toContain(marketingSubId); // 他人 department 级（sub 由 admin 经 POST /:id/sub 造）
  });
});

// ═══════════════════════════════════════════════════════════════
// F2 · GET /api/workspaces/conflicts — 守卫 + 认证层
// ═══════════════════════════════════════════════════════════════

describe('F2 · GET /api/workspaces/conflicts — 守卫（先加守卫、后放开遮蔽，同一 commit）', () => {
  it('HTTP 无凭据 → 401 + code UNAUTHORIZED（全局门先拦; 先例 middleware-order N1）', async () => {
    const r = await api('/api/workspaces/conflicts');
    expect(r.status).toBe(401);
    expect(r.body['code']).toBe('UNAUTHORIZED');
  });

  it('HTTP 合法 JWT → 200 + conflicts 数组 + count', async () => {
    const r = await api('/api/workspaces/conflicts', { token: T_ADMIN });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body['conflicts'])).toBe(true);
    expect(typeof r.body['count']).toBe('number');
  });

  it('F2-P 判别性腿: 直接 handler 无 req.rbac → 403 fail-closed（非合成身份注入; M2 变异体在此红）', async () => {
    // M2（删守卫）时无身份直调将 200 而非 403 ⇒ 红; HTTP 面无凭据仍 401 不受骗。
    const r = await callHandlerDirect('/api/workspaces/conflicts', 'get', { headers: {} });
    expect(r.status).toBe(403);
    expect(r.body['error']).toBe('access denied');
  });
});

// ═══════════════════════════════════════════════════════════════
// F4/E-2 · PUT /api/workspaces/:id/merge — 边界四值（低权）+ admin 对照 + 正路径
// ═══════════════════════════════════════════════════════════════

describe('F4/E-2 · PUT /merge — canModify 前移后语义（M3 变异体在 F4 主断言红）', () => {
  beforeAll(async () => {
    // m1 在自有 global 父下建子（owner=m1）⇒ 正路径 merge 目标
    m1SubId = idOf(
      await api(`/api/workspaces/${ownWsId}/sub`, {
        method: 'POST', token: T_M1, body: { department: 'sales', title: 'D1002-F4-m1-sub' },
      }),
      200,
    );
  });

  it('staff × id 不存在 → 403（低权任何 id 先吃 403，不泄露存在性）', async () => {
    const r = await api('/api/workspaces/ws_ghost_d1002/merge', { method: 'PUT', token: T_STAFF });
    expect(r.status).toBe(403);
  });

  it('F4 主断言: staff × 存在但非子（m1 自有 global）→ 403（M3 回退得 400 即红）', async () => {
    const r = await api(`/api/workspaces/${ownWsId}/merge`, { method: 'PUT', token: T_STAFF });
    expect(r.status).toBe(403);
  });

  it('存在且无权限: m2（非属主 manager）打 m1 的 sub → 403', async () => {
    const r = await api(`/api/workspaces/${m1SubId}/merge`, { method: 'PUT', token: T_M2 });
    expect(r.status).toBe(403);
  });

  it('id 空串 × staff → 403（真实 JWT 链直调——HTTP 面空段不匹配路由属 Express 语义，实测 404 Cannot PUT）', async () => {
    const r = await callMergeRealChain('', T_STAFF);
    expect(r.status).toBe(403);
  });

  it('id 空串 × admin 对照 → 400（canModify 通过后落形状校验层）', async () => {
    const r = await callMergeRealChain('', T_ADMIN);
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('not a sub-workspace');
  });

  it('admin 对照 × id 不存在 → 400（admin 才落 400/404 层）', async () => {
    const r = await api('/api/workspaces/ws_ghost_d1002/merge', { method: 'PUT', token: T_ADMIN });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('not a sub-workspace');
  });

  it('正路径: m1 汇入自有子 → 200', async () => {
    const r = await api(`/api/workspaces/${m1SubId}/merge`, { method: 'PUT', token: T_M1 });
    expect(r.status).toBe(200);
    expect(r.body['ok']).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// F5 · 降级路径 — 无 JWT_SECRET + DEV_MODE=false + 任意 Bearer（同实例 env 翻转）
// ═══════════════════════════════════════════════════════════════

describe('F5 · 降级: 判据不可用 → fail-closed 401 + 留痕（先例 auth.test.ts:493-523）', () => {
  it('401 + body{code:UNAUTHORIZED, message:"JWT_SECRET not configured"} + 日志 AUTH_UNAVAILABLE(level=error)', async () => {
    const mark = logCapture.calls.length;
    const prevSecret = process.env.JWT_SECRET;
    const prevDev = process.env.DEV_MODE;
    delete process.env.JWT_SECRET;
    process.env.DEV_MODE = 'false';
    try {
      const r = await api('/api/workspaces/conflicts', { headers: { authorization: 'Bearer d1002-arbitrary-token' } });
      expect(r.status).toBe(401);
      expect(r.body['code']).toBe('UNAUTHORIZED');
      expect(r.body['message']).toBe('JWT_SECRET not configured');
      const since = logCapture.calls.slice(mark);
      const codes = since.map((c) => c.meta?.code).filter((c): c is string => typeof c === 'string');
      expect(codes).toContain('AUTH_UNAVAILABLE');
      // 源码口径: unavailable 分支 log.error（auth.ts:405），log.warn 属被拒绝分支——按实测断言
      const unavail = since.find((c) => c.meta?.code === 'AUTH_UNAVAILABLE');
      expect(unavail?.level).toBe('error');
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevDev === undefined) delete process.env.DEV_MODE;
      else process.env.DEV_MODE = prevDev;
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 【附条件1+2】哨兵 · GET /api/workspaces/by-dept/context
// ═══════════════════════════════════════════════════════════════

describe('【附条件1+2】哨兵 · by-dept 优先于 /:id/context（M1 变异体在此红）', () => {
  it('合法 JWT → 200 + body.department==="context"', async () => {
    // **有意: by-dept 优先**——回退注册序将静默翻回 404（id='by-dept' 走 /:id/context 查无此 ws），
    // 本断言即哨兵（PLAN【附条件1】; 本用例原始输出整段进回执【附条件2】）。
    const r = await api('/api/workspaces/by-dept/context', { token: T_M1 });
    expect(r.status).toBe(200);
    expect(r.body['department']).toBe('context');
  });
});
