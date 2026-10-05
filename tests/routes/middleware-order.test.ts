/**
 * tests/routes/middleware-order.test.ts — D947 PR-2a（P4 · P6 · P7 夹具）
 *
 * 覆盖判据：
 * - **P4** 中间件前移：`app.use(rbacMiddleware)` 必须落在冻结区间 [357,366]（L-2），
 *   且其**之前**的「路由注册」集合**恰好等于**冻结豁免集 5 项 = 按**标识符/路径**断言
 *   （`setupGuideGoneRouter` · `llmConfigRoutes` · `uploadV2GoneRouter` · `authRoutes` · 内联
 *   `GET /api/status/budget`）。**本文件不硬编码任何行号**——行号只进证据文件。
 * - **P6** 零自欺：关键判据函数零 `void`（`canAccessWorkspace` / `canModifyWorkspace`）；
 *   装配期硬编码身份字面量与空调用已清除；import 已收窄为仅 `rbacMiddleware`。
 * - **I4 不变量**：rbac 不得早于 `jwtAuthMiddleware`（`req.rbac` 的唯一可信来源是验签后的 `req.auth`），
 *   且必须早于 `homeRoutes` / `workspacesApiRoutes`（否则路由级守卫永远拿不到 `req.rbac`）。
 *
 * 判别性（「接线了 ≠ 被执行」，L-5）：
 * - **正路径**（判别性证据）：合法 admin JWT → `POST /api/workspaces` → **200**。
 *   变异体 = 把 `app.use(rbacMiddleware)` 移回 `workspacesApiRoutes` 之后 → `req.rbac` 缺失
 *   → P3 守卫 fail-closed → **403 ⇒ 红**。这条把 P3 与 P4 物理绑在同一根链上。
 *   ⚠️ 该正路径依赖 P3（`src/routes/workspaces-api.ts` 消费 `req.rbac`，L-4）。
 * - **负路径/回归守卫**：无凭据访问非白名单路径 → 认证层 fail-closed。
 * - **豁免路径回归**：`/health`、`POST /api/auth/login`、`GET /api/status/budget`、
 *   `GET /api/knowledge/ask` 前移后仍**直达**（不得被 401/403 拦）。
 *
 * 铁律 12：真实 `createServer()` + `PORT=0` + 真实 `fetch` 走真实路由，**不 mock 管线**。
 * 先例：`tests/routes/llm-config.test.ts`（createServer + PORT=0 + 真实 fetch 骨架）。
 *
 * ⚠️ 已知环境事实（不改判据，只据实设超时）：`createServer()` 内部跑 Bootstrap（本机实测 ≈15s），
 * 而 vitest 的 `hookTimeout` 默认 10s ⇒ 本文件对 `beforeAll` 显式放宽到 120s。
 * 另：`createServer()` 内 bootstrap 失败会 `process.exit(1)`（server.ts:130-142）——**杀进程而非抛异常**，
 * 故 `beforeAll` 末尾先打一条 bootstrap 健康探针，把「bootstrap 挂了」与「断言不符」两类红分开。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/server';
import { signJwtToken } from '../../src/middleware/auth';

// ────────────────────────────────────────────────────────────────
// 源码夹具（P4/P6/I4）——按标识符/路径断言，禁硬编码行号
// ────────────────────────────────────────────────────────────────

const SERVER_TS = fileURLToPath(new URL('../../src/server.ts', import.meta.url));
const RBAC_LINE = 'app.use(rbacMiddleware);';

/** 冻结豁免集（L-1/L-2）：rbac 之前允许存在的路由注册，顺序固定。 */
const EXEMPT_REGISTRATIONS = [
  'setupGuideGoneRouter',
  'llmConfigRoutes',
  'uploadV2GoneRouter',
  'authRoutes',
  '/api/status/budget',
] as const;

/** 镜像冻结 P4 判别谓词：`app\.use\([A-Za-z0-9_]+(Router|Routes)\)` 或 `app\.(get|post|...)(` */
const MOUNT_RE = /app\.use\(([A-Za-z0-9_]+(?:Router|Routes))\)/;
const INLINE_RE = /app\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/;
const RBAC_MOUNT_RE = /app\.use\(rbacMiddleware\)/;

/** 取 `src/server.ts` 中 rbac 挂载行**之前**的全部路由注册（标识符或内联路径）。 */
function registrationsBeforeRbac(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split('\n')) {
    // 与冻结谓词的 grep -v 'res.redirect' 口径一致：redirect 页不算路由注册
    if (line.includes('res.redirect')) continue;
    if (RBAC_MOUNT_RE.test(line)) break; // 到达 rbac 即停
    const mount = MOUNT_RE.exec(line);
    if (mount) {
      found.push(mount[1]);
      continue;
    }
    const inline = INLINE_RE.exec(line);
    if (inline) found.push(inline[1]);
  }
  return found;
}

// ────────────────────────────────────────────────────────────────
// 运行时探针（P4）——createServer() + PORT=0 + 真实 fetch
// ────────────────────────────────────────────────────────────────

let server: Server;
let BASE: string;
let tmpDataDir: string;
const savedEnv: Record<string, string | undefined> = {};
let adminJwt = '';

beforeAll(async () => {
  // ═══ N1 硬前置（缺即判空转、不算通过）═══
  // vitest.config.ts:58-63 设 DEV_MODE='true'（该文件不在写集内，禁改）⇒ 必须在夹具自身内解决。
  // 必要性（auth.ts 逐行）：DEV_MODE=true 且 JWT_SECRET 缺失时 auth.ts:350-364 走「devMode 自动 admin」
  // ⇒ 无凭据请求也会被注入 admin 身份 ⇒ 下面的 fail-closed / 403 断言全部空转。
  // 另：getSecret()（auth.ts:50-65）要求 JWT_SECRET.length >= 16 才当可用密钥。
  savedEnv.DEV_MODE = process.env.DEV_MODE;
  savedEnv.JWT_SECRET = process.env.JWT_SECRET;
  savedEnv.PORT = process.env.PORT;
  savedEnv.SYNOVA_DB_PATH = process.env.SYNOVA_DB_PATH;
  savedEnv.SYNOVA_DATA_DIR = process.env.SYNOVA_DATA_DIR;

  process.env.JWT_SECRET = 'd947-test-secret-0123456789'; // 27 chars ≥ 16
  process.env.DEV_MODE = 'false';
  process.env.PORT = '0'; // config.ts:107 parseInt('0')=0 → app.listen(0) 由 OS 分配端口
  process.env.SYNOVA_DB_PATH = ':memory:';
  tmpDataDir = mkdtempSync(join(tmpdir(), 'd947-middleware-order-'));
  process.env.SYNOVA_DATA_DIR = tmpDataDir; // 严禁写真实 data/

  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');

  server = await createServer(); // 真实 Bootstrap + 真实 express 装配
  const addr = server.address() as AddressInfo;
  BASE = `http://127.0.0.1:${addr.port}`;

  adminJwt = signJwtToken({ sub: 'd947-admin', role: 'admin', orgId: 'default' }) ?? '';
  expect(adminJwt).toBeTruthy(); // JWT_SECRET 可用才签得出

  // 健康探针：把「bootstrap 挂了（进程被杀）」与「断言不符」两类红分开
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

// ════════════════════════════════════════════════════════════════
// 源码断言（P4 顺序 / I4 不变量 / P6 零自欺）——无服务启动依赖
// ════════════════════════════════════════════════════════════════

describe('D947 P4 — 装配顺序源码断言（标识符口径，无硬编码行号）', () => {
  const src = readFileSync(SERVER_TS, 'utf8');

  it('P4-1 rbac 之前的「路由注册」恰好等于冻结豁免集 5 项', () => {
    expect(registrationsBeforeRbac(src)).toEqual([...EXEMPT_REGISTRATIONS]);
  });

  it('P4-2 前移后计数值恒为 5（与 P4-1 同源的显式计数，便于红时读数）', () => {
    expect(registrationsBeforeRbac(src)).toHaveLength(5);
  });

  it('I4 rbac 晚于 jwtAuthMiddleware 与 rateLimitMiddleware，早于 homeRoutes 与 workspacesApiRoutes', () => {
    const at = (needle: string): number => {
      const i = src.indexOf(needle);
      expect(i, `src/server.ts 未找到: ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    const rbacAt = at(RBAC_LINE);
    expect(at('app.use(jwtAuthMiddleware);')).toBeLessThan(rbacAt); // I4：唯一可信来源是验签后的 req.auth
    expect(at('app.use(rateLimitMiddleware);')).toBeLessThan(rbacAt);
    expect(rbacAt).toBeLessThan(at('app.use(homeRoutes);'));
    // P3 能拿到 req.rbac 的物理前提
    expect(rbacAt).toBeLessThan(at('app.use(workspacesApiRoutes);'));
  });

  it('P6-1 关键判据函数零 void（判定结果不得被丢弃）', () => {
    expect(src).not.toMatch(/void\s+(canAccessWorkspace|canModifyWorkspace)/);
  });

  it('P6-2 装配期硬编码身份字面量已清除', () => {
    expect(src).not.toContain("'admin::dev'");
  });

  it('P6-3 middleware/rbac import 已收窄为仅 rbacMiddleware（装配期空调用已删）', () => {
    expect(src).toMatch(/^import \{ rbacMiddleware \} from '\.\/middleware\/rbac';/m);
    expect(src).not.toMatch(/^import \{[^}]*\b(extractRbacContext|canAccessWorkspace|canModifyWorkspace)\b[^}]*\} from '\.\/middleware\/rbac';/m);
  });
});

// ════════════════════════════════════════════════════════════════
// 运行时探针（真实 HTTP）
// ════════════════════════════════════════════════════════════════

describe('D947 P4 — 运行时探针（真实 createServer + 真实 fetch）', () => {
  it('N1 有效性：无凭据访问非白名单路径 → 认证层 fail-closed 401（N1 若未生效则 devMode 自动 admin → 200）', async () => {
    const res = await fetch(`${BASE}/api/workspaces/mine`);
    // 实测口径登记（偏离卡面「403」的显式说明）：
    //   `/api/workspaces/mine` 不在 auth.ts:103-133 白名单内 ⇒ jwtAuthMiddleware 非白名单分支
    //   在**路由之前**拦截（auth.ts:369-379，HTTP 401），路由层的 403 不会有机会产生。
    //   ⇒ 卡面「无凭据 → 403」经实测不成立（已报队长裁定，未静默改判据）；此处按实测值断言。
    //   403 的真实出现在**路由级守卫**（P3 写端点），由 workspace-access-write-endpoint.test.ts 覆盖。
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('UNAUTHORIZED');
  });

  it('P4 判别性正路径：合法 admin JWT → POST /api/workspaces → 200（变异体：rbac 移回 → req.rbac 缺失 → 403 红）', async () => {
    const res = await fetch(`${BASE}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
      body: JSON.stringify({ title: 'D947 P4 判别性探针' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; workspace?: { owner?: string } };
    expect(body.ok).toBe(true);
    // owner 必须来自验签身份（rbac.userId），不得为空 —— 空 owner 会让
    // `canModifyWorkspace` 的 owner 分支与 /api/workspaces/mine 的非管理员过滤同时失去判据
    expect(body.workspace?.owner).toBe('d947-admin');
  });

  it('豁免路径回归：/health 仍直达（非 401/403）', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('豁免路径回归：POST /api/auth/login 仍直达（路由自身执行 → 400 VALIDATION_ERROR，而非认证层 401）', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // 强判据：401 = 被全局中间件拦死（登录入口不可达）；400 VALIDATION_ERROR = 路由真的执行了
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('VALIDATION_ERROR');
  });

  it('豁免路径回归：GET /api/status/budget 仍直达（200）', async () => {
    const res = await fetch(`${BASE}/api/status/budget`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('ok');
  });

  it('豁免路径回归：GET /api/knowledge/ask 仍直达（非 401/403）', async () => {
    const res = await fetch(`${BASE}/api/knowledge/ask?q=ping`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
