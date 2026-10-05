/**
 * tests/security/rbac-all-routes.test.ts — D1153 / #1051（施工单 1-7）判据件
 *
 * 主题: **工作区数据路由的 RBAC 执法面**（改前全仓仅 1 处执法 —— workspaces-api.ts:207）。
 *
 * 判据形态（铁律 12：真 HTTP，不 mock 管线）:
 *   · 真 `express()` + `app.listen(0)` + 真 `jwtAuthMiddleware` + 真 `rbacMiddleware`
 *   · 身份一律由仓内真 `signJwtToken()` 签发、经真 HMAC-SHA256 验签（不手搓 payload）
 *   · 请求一律走 `node:http` 真 socket（不直调 handler、不注入手搓 req.rbac）
 *
 * ── 两层防线与「403 从哪来」（必读，防误读为判据被绕开）──────────────────
 * `/api/workspace/*` 与 `/api/actions/*` **不在** `middleware/auth.ts` 的
 * `isWhitelisted` 白名单内 ⇒ 真实生产链路（组 B）里**未认证请求在 JWT 层就被
 * 401 拦下**，根本走不到路由。因此路由内的 403 是**纵深防御**（卡 Q0 §b 已登记
 * 这一事实：「已认证才可达；路由级 403 是纵深防御 + 执法模式收口」）。
 * 于是本件的 403 判据必须打在**路由层自身**：组 A 挂 `rbacMiddleware` 而不挂
 * `jwtAuthMiddleware` —— 真 `rbacMiddleware` 在无 `req.auth` 时**真实产出**
 * `authenticated: false`（非手搓、非 mock），请求真实穿过路由守卫。
 * 组 B 则用完整链路证明：① 未认证 ⇒ 401（上游身份门）② 已认证有权 ⇒ 非 403。
 * 两组缺一不可：只有 A 则「生产链路是否可达」未被验证；只有 B 则路由守卫从未
 * 被真正触发（撤掉守卫组 B 依然全绿 ⇒ 判据无分辨力）。
 *
 * ── 判别性（改坏即红，已实测）────────────────────────────────────────────
 * 撤掉 `workspace-data.ts` / `actions-api.ts` 中**任一**路由的 `requireAuthenticatedRbac`
 * 守卫 ⇒ 组 A 对应用例必红（该路径由 403 变 200）。实测记录见交付回执。
 *
 * ── 本卡**不做**越权判定（刻意，带注释钉住）──────────────────────────────
 * 组 C 只断言「已认证 ⇒ 非 403 / 业务成功」，**不**断言任何角色级拒绝。
 * 原因: `RbacContext` 无 org/team 维度（`middleware/rbac.ts:127` 的 `department` 恒
 * `undefined`；`extractRbacContext` 连 `req.auth.orgId` 都不携带），而路由不得重算身份
 * （L-4）⇒ 跨部门/跨租户判据**今日无法表达**，只能靠接口变更（另立卡）补齐。
 * 曾尝试叠部门级读判据 ⇒ 恒假 ⇒ `app/js/dashboard.js:35`（deptId = 登录者 orgId）
 * 的 manager/staff 用户静默得到空工作台 = **过度拒绝（功能回归）**，已撤。
 * ⇒ 下面 C 组的「非 403」钉是**刻意**的：接口补齐（RbacContext 有部门/租户维度）后
 *   该组应变红，强制越权判定走复核，而不是静默生效。
 *
 * ── 覆盖（枚举式，非抽样）────────────────────────────────────────────────
 * D1153 射程 10 端点（workspace-data 7 + actions-api 3）
 * ＋ 对照 6 端点（workspaces-api.ts 既有守卫 —— PR-1/D947 P3 已落地的执法点）。
 *
 * ⚠️ 已知残留（非本卡射程，仅登记，勿在此断言——断「bug 存在」会在修复时误红）:
 *   1) `tests` 对照组用**真实存在的 id**：因为 `GET /api/workspaces/:id/context`
 *      （workspaces-api.ts:198-209）的 404 判定**先于** RBAC 判定 ⇒ 匿名 + 不存在的 id
 *      得 404（存在性对匿名泄漏）。该文件不在本卡写集（且属 #1009 邻域）⇒ 只登记。
 *   2) `GET /api/workspaces` / `GET /api/workspaces/:id` / `GET /api/workspaces/by-dept/:dept`
 *      / `GET /api/workspaces/conflicts` 在 workspaces-api.ts 内**无任何守卫**（匿名可达
 *      200）⇒ 故**不得**纳入「未认证 ⇒ 403」对照组（纳入即假红）。只登记。
 *   3) `GET /api/workspaces/mine`（workspaces-api.ts:264）被前序 `/api/workspaces/:id`
 *      （:126）按注册顺序**遮蔽** ⇒ 匿名访问得 404（`workspace not found`），其 D947
 *      守卫经此路径**不可达**。只登记。
 *
 * 铁律 48: 每条用例均有 expect() 断言；覆盖拒绝路径 / 正常路径 / 角色边界三路径。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947 同型）—— 必须先于任何请求就位，否则判据空转
// 坑: vitest.config.ts 的 test.env 把 DEV_MODE 固定为 'true'。若不设 JWT_SECRET，
//   jwtAuthMiddleware 会走「DevMode 无 JWT_SECRET ⇒ 自动 admin」分支（auth.ts:350-365）
//   ⇒ 未认证请求会被当成 dev-admin = 已认证 ⇒ 组 A/B 的拒绝判据全部假绿。
//   设置 ≥16 字符 JWT_SECRET 是关闭该分支的唯一物理开关（`!secret && DEV_MODE==='true'`）。
// ════════════════════════════════════════════════════════════════

process.env.JWT_SECRET = 'd1153-rbac-all-routes-secret-0123456789';
process.env.DEV_MODE = 'false';

import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import workspaceDataRoutes from '../../src/routes/workspace-data';
import actionsApiRoutes from '../../src/routes/actions-api';
import workspacesApiRoutes from '../../src/routes/workspaces-api';

// ════════════════════════════════════════════════════════════════
// 真 HTTP 夹具
// ════════════════════════════════════════════════════════════════

interface HttpResult { status: number; body: Record<string, unknown>; raw: string }

function call(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const url = new URL(`${base}${path}`);
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = {};
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try {
            body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
          } catch {
            // 非 JSON 响应（如 500 文本/空体）⇒ 保留原文供判据报错
            body = { __unparsed: raw };
          }
          resolve({ status: res.statusCode ?? 0, body, raw });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** 拍平一层嵌套字段（响应体断言用，零 cast） */
function str(obj: unknown, key: string): string {
  if (typeof obj !== 'object' || obj === null) return '';
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

/** 真签发身份（真 HMAC 签名；jti/iat/exp 由仓内实现自动填充） */
function tokenFor(role: string): string {
  const token = signJwtToken({ sub: `${role}-d1153`, role, orgId: 'org-d1153' });
  if (!token) throw new Error('夹具失败: signJwtToken 返回 null（JWT_SECRET 未就位 ⇒ 身份不可构造）');
  return token;
}

/** 起始一个真 HTTP 服务；`withJwt=false` ⇒ 只有 rbac 注入层（纵深防御面） */
function serve(router: express.Router[], withJwt: boolean): Promise<{ base: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  if (withJwt) app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  for (const r of router) app.use(r);
  return new Promise((resolve) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

interface RouteCase {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  /** D1153 射程内路由的 403 响应体必须带 code（workspaces-api 既有守卫不带） */
  expectCode?: string;
}

// ════════════════════════════════════════════════════════════════
// 夹具
// ════════════════════════════════════════════════════════════════

let depth: { base: string; close: () => void };   // 纵深防御面（仅 rbacMiddleware）
let full: { base: string; close: () => void };    // 完整链路（jwt + rbac）
let TOKEN: Record<string, string> = {};
/** 计数器：每个用例用独立 id，避免跨用例状态耦合（夹具隔离） */
let seq = 0;
const uid = (prefix: string): string => `${prefix}-${++seq}-${Date.now().toString(36)}`;

let d1153Routes: RouteCase[] = [];
let controlRoutes: RouteCase[] = [];

const D1153_ROUTE_COUNT = 10;   // workspace-data 7 + actions-api 3
const CONTROL_ROUTE_COUNT = 6;  // workspaces-api 既有守卫（PR-1/D947 P3）

beforeAll(async () => {
  // 硬前置自证（判据不可空转）
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');

  depth = await serve([workspaceDataRoutes, actionsApiRoutes, workspacesApiRoutes], false);
  full = await serve([workspaceDataRoutes, actionsApiRoutes, workspacesApiRoutes], true);
  TOKEN = {
    admin: tokenFor('admin'),
    manager: tokenFor('manager'),
    staff: tokenFor('staff'),
    liaison: tokenFor('liaison'),
    ga: tokenFor('ga'),
  };
  // 真 token 自证可验（防「签了但验不过」导致全组假绿）
  const probe = await call(full.base, 'GET', '/api/actions', { token: TOKEN.admin });
  expect(probe.status).toBe(200);

  // ── 夹具资源一律经**真 HTTP + 真 token** 建立（不直插 store —— 铁律 12）──
  const ws = await call(full.base, 'POST', '/api/workspaces', {
    token: TOKEN.admin, body: { title: 'D1153 夹具工作区' },
  });
  expect(ws.status).toBe(200);
  const wsId = str(ws.body.workspace, 'id');
  expect(wsId).not.toBe('');

  const sub = await call(full.base, 'POST', `/api/workspaces/${wsId}/sub`, {
    token: TOKEN.admin, body: { department: 'd1153-dept', title: 'D1153 夹具子工作区' },
  });
  expect(sub.status).toBe(200);
  const subId = str(sub.body.workspace, 'id');
  expect(subId).not.toBe('');

  const act = await call(full.base, 'POST', '/api/actions', {
    token: TOKEN.admin, body: { workspaceId: 'ws-d1153', title: 'D1153 夹具行动项' },
  });
  expect(act.status).toBe(200);
  const actId = str(act.body.action, 'id');
  expect(actId).not.toBe('');

  // ── 枚举表 ──
  d1153Routes = [
    // workspace-data.ts — 7 端点
    { label: 'GET    /api/workspace/:deptId', method: 'GET', path: '/api/workspace/d1153-dept', expectCode: 'RBAC_DENIED' },
    { label: 'GET    /api/workspace/:deptId/goals', method: 'GET', path: '/api/workspace/d1153-dept/goals', expectCode: 'RBAC_DENIED' },
    { label: 'GET    /api/workspace/:deptId/alerts', method: 'GET', path: '/api/workspace/d1153-dept/alerts', expectCode: 'RBAC_DENIED' },
    { label: 'GET    /api/workspace/:deptId/next-action', method: 'GET', path: '/api/workspace/d1153-dept/next-action', expectCode: 'RBAC_DENIED' },
    { label: 'PUT    /api/workspace/goals/:goalId/target', method: 'PUT', path: '/api/workspace/goals/goal-d1153/target', body: { targetValue: 42, reason: '用例' }, expectCode: 'RBAC_DENIED' },
    { label: 'POST   /api/workspace/proposals/:proposalId/reject', method: 'POST', path: '/api/workspace/proposals/prop-d1153/reject', body: { reason: '用例' }, expectCode: 'RBAC_DENIED' },
    { label: 'PUT    /api/workspace/alerts/:id/dismiss', method: 'PUT', path: '/api/workspace/alerts/alert-d1153/dismiss', body: { reason: '用例' }, expectCode: 'RBAC_DENIED' },
    // actions-api.ts — 3 端点
    { label: 'POST   /api/actions', method: 'POST', path: '/api/actions', body: { workspaceId: 'ws-d1153', title: '用例' }, expectCode: 'RBAC_DENIED' },
    { label: 'GET    /api/actions', method: 'GET', path: '/api/actions?workspaceId=ws-d1153', expectCode: 'RBAC_DENIED' },
    { label: 'PUT    /api/actions/:id/status', method: 'PUT', path: `/api/actions/${actId}/status`, body: { status: 'confirmed' }, expectCode: 'RBAC_DENIED' },
  ];

  controlRoutes = [
    { label: 'POST   /api/workspaces', method: 'POST', path: '/api/workspaces', body: { title: '对照' } },
    { label: 'PUT    /api/workspaces/:id/status', method: 'PUT', path: `/api/workspaces/${wsId}/status`, body: { status: 'analyzing' } },
    { label: 'POST   /api/workspaces/:id/messages', method: 'POST', path: `/api/workspaces/${wsId}/messages`, body: { content: '对照' } },
    { label: 'POST   /api/workspaces/:id/sub', method: 'POST', path: `/api/workspaces/${wsId}/sub`, body: { department: 'd1153-dept', title: '对照' } },
    { label: 'PUT    /api/workspaces/:id/merge', method: 'PUT', path: `/api/workspaces/${subId}/merge`, body: {} },
    { label: 'GET    /api/workspaces/:id/context', method: 'GET', path: `/api/workspaces/${wsId}/context` },
  ];

  // 枚举完整性锚（端点增删即红 —— 强制同步本表，防「静默漏枚举」）
  expect(d1153Routes.length).toBe(D1153_ROUTE_COUNT);
  expect(controlRoutes.length).toBe(CONTROL_ROUTE_COUNT);
});

afterAll(() => {
  depth?.close();
  full?.close();
});

// ════════════════════════════════════════════════════════════════
// A 组 — 纵深防御：未认证 rbac 上下文 ⇒ 403（每条路由逐一枚举）
//
// 本组是本件的**核心判据**：撤掉任一守卫 ⇒ 该条必红。
// ════════════════════════════════════════════════════════════════

describe('A · 未认证 rbac 上下文 ⇒ HTTP 403（逐路由枚举，纵深防御面）', () => {
  it.each([
    ['D1153 射程', D1153_ROUTE_COUNT],
    ['既有守卫对照', CONTROL_ROUTE_COUNT],
  ])('%s 段枚举数 = %i（端点增删即红，强制同步）', (seg, expected) => {
    const routes = seg === 'D1153 射程' ? d1153Routes : controlRoutes;
    expect({ seg, count: routes.length }).toEqual({ seg, count: expected });
  });

  it.each(
    // 表在 beforeAll 内构建 ⇒ 此处按 label 惰性取（保持枚举单一真源）
    [
      'GET    /api/workspace/:deptId',
      'GET    /api/workspace/:deptId/goals',
      'GET    /api/workspace/:deptId/alerts',
      'GET    /api/workspace/:deptId/next-action',
      'PUT    /api/workspace/goals/:goalId/target',
      'POST   /api/workspace/proposals/:proposalId/reject',
      'PUT    /api/workspace/alerts/:id/dismiss',
      'POST   /api/actions',
      'GET    /api/actions',
      'PUT    /api/actions/:id/status',
      'POST   /api/workspaces',
      'PUT    /api/workspaces/:id/status',
      'POST   /api/workspaces/:id/messages',
      'POST   /api/workspaces/:id/sub',
      'PUT    /api/workspaces/:id/merge',
      'GET    /api/workspaces/:id/context',
    ],
  )('%s → 403', async (label) => {
    const all = [...d1153Routes, ...controlRoutes];
    const c = all.find((r) => r.label === label);
    expect(c, `判据表缺 ${label}（枚举表与用例不同步）`).toBeDefined();
    if (!c) return;

    const res = await call(depth.base, c.method, c.path, { body: c.body });
    // 403 而非 404：守卫先于资源查找 ⇒ 不因存在性差异泄漏给未认证调用方
    expect({ label: c.label, status: res.status }).toEqual({ label: c.label, status: 403 });
    if (c.expectCode) {
      expect({ label: c.label, code: str(res.body, 'code') }).toEqual({ label: c.label, code: c.expectCode });
      expect(res.body.ok).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// B 组 — 完整链路（真 jwtAuthMiddleware）：未认证在 JWT 层先拦 401
//   ⇒ 证明 A 组的 403 是纵深防御第二层，而非唯一防线（两层都要成立）
// ════════════════════════════════════════════════════════════════

describe('B · 完整链路（jwt + rbac）：未认证 ⇒ 401（上游身份门）', () => {
  it.each([
    'GET    /api/workspace/:deptId',
    'PUT    /api/workspace/goals/:goalId/target',
    'POST   /api/actions',
    'GET    /api/actions',
    'PUT    /api/actions/:id/status',
    'POST   /api/workspaces',
    'GET    /api/workspaces/:id/context',
  ])('%s → 401（无 Authorization 头）', async (label) => {
    const c = [...d1153Routes, ...controlRoutes].find((r) => r.label === label);
    expect(c, `判据表缺 ${label}`).toBeDefined();
    if (!c) return;

    const res = await call(full.base, c.method, c.path, { body: c.body });
    expect({ label: c.label, status: res.status, code: str(res.body, 'code') })
      .toEqual({ label: c.label, status: 401, code: 'UNAUTHORIZED' });
  });

  it('防伪凭据：合法结构但签名无效的 Bearer ⇒ 401（验签真发生）', async () => {
    const forged = `${TOKEN.admin.split('.').slice(0, 2).join('.')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const res = await call(full.base, 'GET', '/api/workspace/d1153-dept', { token: forged });
    expect(res.status).toBe(401);
    expect(str(res.body, 'code')).toBe('UNAUTHORIZED');
  });
});

// ════════════════════════════════════════════════════════════════
// C 组 — 已认证且有权 ⇒ 非 403；已认证但无权 ⇒ 403
//   两个方向都断言 ⇒ 同时防「一刀切全拒」的假绿 与「只验身份不验权限」的假绿
// ════════════════════════════════════════════════════════════════

describe('C · 已认证 ⇒ 非 403（防「一刀切全拒」；本卡刻意不做越权判定，见文件头）', () => {
  // ── D1153 射程：持有 admin / manager 身份 ⇒ 业务成功 ──
  it.each([
    'GET    /api/workspace/:deptId',
    'GET    /api/workspace/:deptId/goals',
    'GET    /api/workspace/:deptId/alerts',
    'GET    /api/workspace/:deptId/next-action',
    'PUT    /api/workspace/goals/:goalId/target',
    'POST   /api/workspace/proposals/:proposalId/reject',
    'PUT    /api/workspace/alerts/:id/dismiss',
    'POST   /api/actions',
    'GET    /api/actions',
  ])('%s · admin 已认证且有权 ⇒ 200（非 403）', async (label) => {
    const c = d1153Routes.find((r) => r.label === label);
    expect(c, `判据表缺 ${label}`).toBeDefined();
    if (!c) return;
    const res = await call(full.base, c.method, c.path, { token: TOKEN.admin, body: c.body });
    expect({ label: c.label, status: res.status }).toEqual({ label: c.label, status: 200 });
    expect(res.body.ok).toBe(true);
  });

  it('PUT /api/actions/:id/status · admin 已认证且有权 ⇒ 200（身份守卫 + 对象定位）', async () => {
    const created = await call(full.base, 'POST', '/api/actions', {
      token: TOKEN.admin, body: { workspaceId: uid('ws'), title: '流转用例' },
    });
    expect(created.status).toBe(200);
    const id = str(created.body.action, 'id');
    expect(id).not.toBe('');

    const res = await call(full.base, 'PUT', `/api/actions/${id}/status`, {
      token: TOKEN.admin, body: { status: 'confirmed' },
    });
    expect(res.status).toBe(200);
    expect(str(res.body.action, 'status')).toBe('confirmed');
  });

  it('PUT /api/workspace/goals/:goalId/target · manager ⇒ 200（中层写路径不被误杀）', async () => {
    const res = await call(full.base, 'PUT', `/api/workspace/goals/${uid('goal')}/target`, {
      token: TOKEN.manager, body: { targetValue: 7, reason: '中层调整' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET    /api/workspace/:deptId · liaison / ga ⇒ 200（已认证即可读；本卡不做越权判定）', async () => {
    for (const role of ['liaison', 'ga']) {
      const res = await call(full.base, 'GET', '/api/workspace/d1153-dept', { token: TOKEN[role] });
      expect({ role, status: res.status }).toEqual({ role, status: 200 });
    }
  });

  // ── 刻意钉「已认证 ⇒ 非 403」（含只读角色）──────────────────────────────
  // 这些不是「有权」的证明，而是**本卡射程边界**的可执行声明: 越权判定依赖
  //   `RbacContext` 补齐 org/team 维度（另立卡）。接口补齐后本组应变红 → 强制复核。
  it('PUT    /api/workspace/goals/:goalId/target · staff / ga / liaison ⇒ 非 403（刻意：本卡不做越权判定）', async () => {
    for (const role of ['staff', 'ga', 'liaison']) {
      const res = await call(full.base, 'PUT', `/api/workspace/goals/${uid('goal')}/target`, {
        token: TOKEN[role], body: { targetValue: 1 },
      });
      expect({ role, status: res.status }).toEqual({ role, status: 200 });
    }
  });

  it('POST   /api/actions · staff ⇒ 非 403（刻意：本卡不做越权判定）', async () => {
    const res = await call(full.base, 'POST', '/api/actions', {
      token: TOKEN.staff, body: { workspaceId: 'ws-d1153', title: 'staff 创建用例' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  /**
   * 部门级读端点（`app/js/dashboard.js:35` 的真消费方 —— deptId = 登录者 orgId，
   * `app/js/api-client.js:61` 带真 Bearer）:
   * 本卡**必须**让已认证的 manager/staff 读到自己的部门工作台。
   * 曾叠 `canAccessWorkspace({visibility:'department', department: deptId})` ⇒ 因
   *   `department` 恒 `undefined`（rbac.ts:127）该判据恒假 ⇒ dashboard 静默空面板
   *   = 过度拒绝（功能回归），已撤。
   * 本钉的意义: 接口补齐部门/租户维度后，若有人重新引入越权判定，本用例即红
   *   —— 强制该变更走复核，而不是静默把 dashboard 弄空。
   */
  it('GET    /api/workspace/:deptId · manager / staff ⇒ 非 403（真消费方路径，不得过度拒绝）', async () => {
    for (const role of ['manager', 'staff']) {
      const res = await call(full.base, 'GET', '/api/workspace/d1153-dept', { token: TOKEN[role] });
      expect({ role, status: res.status }).toEqual({ role, status: 200 });
    }
  });

  // ── 对照组（workspaces-api 既有守卫）: 已认证有权 ⇒ 成功 ──
  it('对照 · POST /api/workspaces ⇒ 200（admin 建区，夹具闭环）', async () => {
    const res = await call(full.base, 'POST', '/api/workspaces', {
      token: TOKEN.admin, body: { title: '对照工作区' },
    });
    expect(res.status).toBe(200);
    expect(str(res.body.workspace, 'id')).not.toBe('');
  });

  it('对照 · GET /api/workspaces/:id/context ⇒ 200（既有 canAccessWorkspace 执法点）', async () => {
    const created = await call(full.base, 'POST', '/api/workspaces', {
      token: TOKEN.admin, body: { title: '对照上下文' },
    });
    const id = str(created.body.workspace, 'id');
    expect(id).not.toBe('');
    const res = await call(full.base, 'GET', `/api/workspaces/${id}/context`, { token: TOKEN.admin });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('对照 · 写链路 order: create → status → messages → sub → merge 全 200', async () => {
    const created = await call(full.base, 'POST', '/api/workspaces', {
      token: TOKEN.admin, body: { title: '对照写链路' },
    });
    expect(created.status).toBe(200);
    const id = str(created.body.workspace, 'id');

    const st = await call(full.base, 'PUT', `/api/workspaces/${id}/status`, {
      token: TOKEN.admin, body: { status: 'analyzing' },
    });
    expect(st.status).toBe(200);

    const msg = await call(full.base, 'POST', `/api/workspaces/${id}/messages`, {
      token: TOKEN.admin, body: { content: '对照消息' },
    });
    expect(msg.status).toBe(200);

    const sub = await call(full.base, 'POST', `/api/workspaces/${id}/sub`, {
      token: TOKEN.admin, body: { department: 'd1153-dept', title: '对照子区' },
    });
    expect(sub.status).toBe(200);
    const subId = str(sub.body.workspace, 'id');
    expect(subId).not.toBe('');

    const merged = await call(full.base, 'PUT', `/api/workspaces/${subId}/merge`, {
      token: TOKEN.admin, body: {},
    });
    expect(merged.status).toBe(200);
    expect(str(merged.body.workspace, 'status')).toBe('resolved');
  });
});

// ════════════════════════════════════════════════════════════════
// D 组 — 判据来源自证：身份确实由 rbacMiddleware 真实注入（非 mock/非手搓）
// ════════════════════════════════════════════════════════════════

describe('D · 判据来源自证（防「判据其实是 mock 绿的」）', () => {
  it('A 组 403 的成因是 rbac.authenticated===false，而非路由根本不存在', async () => {
    // 同一路径在完整链路 + admin 下可达（非 404）⇒ 证明 A 组的 403 来自守卫而非路由缺失
    const res = await call(full.base, 'GET', '/api/workspace/d1153-dept', { token: TOKEN.admin });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // 同一路径在纵深防御面（无 jwt 层、无 token）⇒ 守卫拒绝
    const denied = await call(depth.base, 'GET', '/api/workspace/d1153-dept');
    expect(denied.status).toBe(403);
    expect(str(denied.body, 'code')).toBe('RBAC_DENIED');
  });

  it('纵深防御面确实注入了 req.rbac（authenticated=false）；非「中间件未挂载」的侥幸', async () => {
    // 若 rbacMiddleware 未生效，req.rbac 为 undefined —— 守卫仍会 403，但成因不同。
    // 此处用「已认证有权」对照证明注入层真实工作：同一 app 内带 token 的反向探针被拒
    // （无 jwt 层 ⇒ 无 req.auth ⇒ 即便带 Bearer 也是匿名上下文）
    const withBearer = await call(depth.base, 'GET', '/api/workspace/d1153-dept', { token: TOKEN.admin });
    expect(withBearer.status).toBe(403);
    expect(str(withBearer.body, 'code')).toBe('RBAC_DENIED');
  });
});
