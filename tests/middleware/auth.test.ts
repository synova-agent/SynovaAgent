/**
 * tests/middleware/auth.test.ts — JWT 认证中间件单元测试 (Phase 0.1)
 *
 * test-first: 先定义验收标准，再实现。
 * 铁律 33: *.test.ts 命名约定。
 * 铁律 38: as any 零容忍。
 *
 * D947 PR-1 修订:
 *   - N1 硬前置: beforeAll 显式建立 JWT_SECRET(≥16)/DEV_MODE=false 并断言生效
 *     （vitest.config.ts:59 把 DEV_MODE 设为 'true'，该文件不在写集内 ⇒ 夹具内自解）
 *   - P5 三态可区分: 被拒绝 / 不可用（系统异常）/ 出错 —— 断言日志标记 + fail-closed 行为
 *   - P0: legacy x-synova-token 自报分支已删除（原"向下兼容"契约退役，见下方用例）
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { createHmac } from 'crypto';
import type { Request, Response } from 'express';

// 测试前设置 JWT_SECRET（模块读取时使用）
const TEST_SECRET = 'test-secret-for-unit-testing-only';

/**
 * D947: 捕获 auth 中间件的日志标记（P5 三态可区分需要"写日志"成为可执行断言，
 * 而非 grep 型静态判据）。@synova/logger 只被 createLogger 消费，mock 其工厂即可。
 */
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
    ...actual,
    createLogger: () => ({
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
    }),
  };
});

import {
  signJwtToken,
  verifyJwtToken,
  jwtAuthMiddleware,
  revokeToken,
  extractAuthFromRequest,
  clearRevokedTokens,
  type JwtPayload,
} from '../../src/middleware/auth';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947）—— 每个夹具文件必须自证环境已就位，否则判空转
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});

/** 取基线之后的日志标记（logCapture 文件级累积，故按位置切片；P5 / L-20 判据用） */
function codesSince(mark: number): string[] {
  return logCapture.calls
    .slice(mark)
    .map(c => c.meta?.code)
    .filter((c): c is string => typeof c === 'string');
}

// ============================================================
// 辅助函数
// ============================================================

function mockReq(headers: Record<string, string> = {}, path = '/api/workspaces'): Partial<Request> {
  const req: Record<string, unknown> & { headers: Record<string, string> } = {
    headers: { ...headers },
    path,
  };
  return req as unknown as Request;
}

function mockRes(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res as unknown as Response;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res as unknown as Response;
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

function makeExpiredToken(sub: string, role: string, orgId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const expiredPayload = Buffer.from(JSON.stringify({
    sub, role, orgId,
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 3600,
    jti: `expired-${sub}-${Date.now()}`,
  })).toString('base64url');
  const signingInput = `${header}.${expiredPayload}`;
  const sig = createHmac('sha256', TEST_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

// ============================================================
// JWT 签名 & 验证
// ============================================================

describe('signJwtToken / verifyJwtToken', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.DEV_MODE = 'false';
    clearRevokedTokens();
  });

  it('sign + verify 返回有效 payload', () => {
    const payload = { sub: 'user1', role: 'ga', orgId: 'org-1' };
    const token = signJwtToken(payload);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token!.split('.')).toHaveLength(3); // header.payload.signature

    const result = verifyJwtToken(token!);
    expect(result.payload).toBeTruthy();
    expect(result.payload!.sub).toBe('user1');
    expect(result.payload!.role).toBe('ga');
    expect(result.payload!.orgId).toBe('org-1');
    expect(result.payload!.iat).toBeGreaterThan(0);
    expect(result.payload!.exp).toBeGreaterThan(result.payload!.iat);
    expect(result.payload!.jti).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it('过期 token 返回 error=Token expired', () => {
    const token = makeExpiredToken('user2', 'admin', 'org-1');
    const result = verifyJwtToken(token);
    expect(result.payload).toBeNull();
    expect(result.error).toBe('Token expired');
  });

  it('被篡改的 token 返回 error=Invalid signature', () => {
    const token = signJwtToken({ sub: 'user3', role: 'admin', orgId: 'org-1' });
    expect(token).toBeTruthy();

    // 篡改 payload 部分
    const parts = token!.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      sub: 'hacker', role: 'admin', orgId: 'org-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'hacked-jti',
    })).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const result = verifyJwtToken(tamperedToken);
    expect(result.payload).toBeNull();
    expect(result.error).toBe('Invalid signature');
  });

  it('畸形 token 格式返回 error=Invalid token format', () => {
    const result = verifyJwtToken('not-a-jwt-token');
    expect(result.payload).toBeNull();
    expect(result.error).toBe('Invalid token format');
  });

  it('空 token 返回 error=Token is empty', () => {
    const result = verifyJwtToken('');
    expect(result.payload).toBeNull();
    expect(result.error).toBe('Token is empty');
  });

  it('每个 token 有唯一 jti', () => {
    const payload = { sub: 'alice', role: 'manager', orgId: 'acme-corp' };
    const token1 = signJwtToken(payload);
    const token2 = signJwtToken(payload);
    expect(token1).toBeTruthy();
    expect(token2).toBeTruthy();

    const r1 = verifyJwtToken(token1!);
    const r2 = verifyJwtToken(token2!);
    expect(r1.payload!.jti).not.toBe(r2.payload!.jti);
  });

  it('缺失必填字段的 token 被拒绝', () => {
    const { createHmac: ch } = require('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    // 缺少 sub 字段
    const badPayload = Buffer.from(JSON.stringify({
      role: 'admin', orgId: 'org-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'no-sub-jti',
    })).toString('base64url');
    const sig = ch('sha256', TEST_SECRET).update(`${header}.${badPayload}`).digest('base64url');
    const badToken = `${header}.${badPayload}.${sig}`;

    const result = verifyJwtToken(badToken);
    expect(result.payload).toBeNull();
    expect(result.error).toContain('Missing required fields');
  });
});

// ============================================================
// Token 撤销
// ============================================================

describe('revokeToken', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    clearRevokedTokens();
  });

  it('撤销有效 token → isTokenRevoked 返回 true', () => {
    const token = signJwtToken({ sub: 'ga_user', role: 'ga', orgId: 'org-1' });
    expect(token).toBeTruthy();

    // 撤销前能通过验证
    const before = verifyJwtToken(token!);
    expect(before.error).toBeUndefined();

    // 撤销
    const revoked = revokeToken(token!);
    expect(revoked).toBe(true);

    // 撤销后验证失败
    const after = verifyJwtToken(token!);
    expect(after.payload).toBeNull();
    expect(after.error).toBe('Token revoked');
  });

  it('撤销无效 token → 返回 false', () => {
    const revoked = revokeToken('invalid-token');
    expect(revoked).toBe(false);
  });

  it('撤销后同一用户的新 token 仍可用', () => {
    const token1 = signJwtToken({ sub: 'user', role: 'admin', orgId: 'org-1' });
    expect(token1).toBeTruthy();
    revokeToken(token1!);

    // 新签发 token（不同 jti）应可用
    const token2 = signJwtToken({ sub: 'user', role: 'admin', orgId: 'org-1' });
    expect(token2).toBeTruthy();
    const result2 = verifyJwtToken(token2!);
    expect(result2.payload).toBeTruthy();
  });
});

// ============================================================
// 中间件行为
// ============================================================

describe('jwtAuthMiddleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.DEV_MODE = 'false';
    clearRevokedTokens();
  });

  it('whitelisted path /health → pass through', () => {
    const req = { path: '/health', headers: {} } as Request;
    const res = { statusCode: undefined, status() { return this; }, json() { return this; } } as unknown as Response & { statusCode?: number };
    let nextCalled = false;

    jwtAuthMiddleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it('whitelisted path /api/auth/login → pass through', () => {
    const req = { path: '/api/auth/login', headers: {} } as Request;
    const res = { statusCode: undefined, status() { return this; }, json() { return this; } } as unknown as Response & { statusCode?: number };
    let nextCalled = false;

    jwtAuthMiddleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  // D483: 匿名注册可达——register 与 login 并列入白名单（修复前此用例红：无 Authorization 头被 401 拦截）
  it('whitelisted path /api/auth/register → pass through', () => {
    const req = { path: '/api/auth/register', headers: {} } as Request;
    const res = { statusCode: undefined, status() { return this; }, json() { return this; } } as unknown as Response & { statusCode?: number };
    let nextCalled = false;

    jwtAuthMiddleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it('无 Authorization header → 401', () => {
    const req = { path: '/api/workspaces', headers: {} } as Request;
    const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
    res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
    res.json = (body: unknown) => { res.body = body; return res as unknown as Response; };
    let nextCalled = false;

    jwtAuthMiddleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect((res.body as Record<string, unknown>)?.code).toBe('UNAUTHORIZED');
  });

  it('Authorization header 无 Bearer 前缀 → 401', () => {
    const req = { path: '/api/workspaces', headers: { authorization: 'Basic xxx' } } as Request;
    const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
    res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
    res.json = (body: unknown) => { res.body = body; return res as unknown as Response; };
    let nextCalled = false;

    jwtAuthMiddleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('有效 JWT → 注入 auth + 调用 next', () => {
    const token = signJwtToken({ sub: 'ga_user', role: 'ga', orgId: 'org-1' });
    expect(token).toBeTruthy();

    const req: Record<string, unknown> & { path: string; headers: Record<string, string>; auth?: unknown } = {
      path: '/api/workspaces',
      headers: { authorization: `Bearer ${token}` },
    };
    const res: Record<string, unknown> & { statusCode?: number } = {};
    res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
    res.json = (body: unknown) => { return res as unknown as Response; };
    let nextCalled = false;

    jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeUndefined();
    expect(req.auth).toBeTruthy();
    expect((req.auth as Record<string, unknown>)?.role).toBe('ga');
    expect((req.auth as Record<string, unknown>)?.sub).toBe('ga_user');
  });

  it('过期 token → 401', () => {
    const token = makeExpiredToken('old', 'ga', 'org-1');
    const req = { path: '/api/workspaces', headers: { authorization: `Bearer ${token}` } } as Request;
    const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
    res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
    res.json = (body: unknown) => { res.body = body; return res as unknown as Response; };
    let nextCalled = false;

    jwtAuthMiddleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('撤销的 token → 401', () => {
    const token = signJwtToken({ sub: 'revoked_user', role: 'ga', orgId: 'org-1' });
    expect(token).toBeTruthy();
    revokeToken(token!);

    const req = { path: '/api/workspaces', headers: { authorization: `Bearer ${token}` } } as Request;
    const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
    res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
    res.json = (body: unknown) => { res.body = body; return res as unknown as Response; };
    let nextCalled = false;

    jwtAuthMiddleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('DEV_MODE 自动 admin 会话 orgId 取 SYNOVA_ORG_ID 配置值（D479）', () => {
    const prevOrg = process.env.SYNOVA_ORG_ID;
    const prevSecret = process.env.JWT_SECRET;
    const prevDev = process.env.DEV_MODE;
    process.env.SYNOVA_ORG_ID = 'org-x';
    delete process.env.JWT_SECRET; // 触发 DEV_MODE 无密钥分支
    process.env.DEV_MODE = 'true';
    try {
      const req: Record<string, unknown> & { path: string; headers: Record<string, string>; auth?: unknown } = {
        path: '/api/workspaces',
        headers: {},
      };
      const res: Record<string, unknown> & { statusCode?: number } = {};
      res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
      res.json = (body: unknown) => { return res as unknown as Response; };
      let nextCalled = false;

      jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBeUndefined();
      expect(req.auth).toBeTruthy();
      // D479: DEV_MODE 会话不得落字面 'default'，须与 config.orgId 同源（SYNOVA_ORG_ID）
      expect((req.auth as Record<string, unknown>)?.orgId).toBe('org-x');
    } finally {
      if (prevOrg === undefined) delete process.env.SYNOVA_ORG_ID;
      else process.env.SYNOVA_ORG_ID = prevOrg;
      if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;
      if (prevDev !== undefined) process.env.DEV_MODE = prevDev;
    }
  });
});

// ============================================================
// extractAuthFromRequest — 桥接 JWT → RBAC
// ============================================================

describe('extractAuthFromRequest', () => {
  it('从有 auth 的请求返回角色和用户ID', () => {
    const req = {
      auth: { sub: 'ga_user', role: 'ga', orgId: 'org-1', iat: 0, exp: 0, jti: 'test' },
    };
    const result = extractAuthFromRequest(req as never);
    expect(result).toBeTruthy();
    expect(result!.role).toBe('ga');
    expect(result!.userId).toBe('ga_user');
    expect(result!.orgId).toBe('org-1');
  });

  it('从无 auth 的请求返回 null', () => {
    const req = {};
    const result = extractAuthFromRequest(req as never);
    expect(result).toBeNull();
  });

  // D947 P0: 原「支持 x-synova-token 向下兼容」契约退役——不经验签的
  // `role:orgId:userId` 字符串可自封 admin，属默认放行姿态。
  // 本用例由「放行 admin」反转为「拒绝」。
  it('D947: x-synova-token 自报 admin → 不再解析，返回 null（fail-closed）', () => {
    const req = { headers: { 'x-synova-token': 'admin:dev:user1' } };
    const result = extractAuthFromRequest(req as never);
    expect(result).toBeNull();
  });

  it('x-synova-token 格式不对时返回 null', () => {
    const req = { headers: { 'x-synova-token': 'not-a-valid-format' } };
    const result = extractAuthFromRequest(req as never);
    expect(result).toBeNull();
  });

  // D947 P0: legacy 自报 token 的 orgId 回退语义（D479）随之退役——该回退只对
  // 自报凭据有意义，而自报凭据已整体不再放行。此处把「退役」固定成可执行事实，
  // 避免静默删除历史契约（K3 可核）。
  it('D947: legacy 自报 token（含缺 orgId 段）→ 一律 null，D479 回退语义退役', () => {
    const prevOrg = process.env.SYNOVA_ORG_ID;
    process.env.SYNOVA_ORG_ID = 'org-x';
    try {
      const result = extractAuthFromRequest({ headers: { 'x-synova-token': 'admin::user1' } } as never);
      expect(result).toBeNull();

      delete process.env.SYNOVA_ORG_ID;
      const fallback = extractAuthFromRequest({ headers: { 'x-synova-token': 'admin::user2' } } as never);
      expect(fallback).toBeNull();
    } finally {
      if (prevOrg === undefined) delete process.env.SYNOVA_ORG_ID;
      else process.env.SYNOVA_ORG_ID = prevOrg;
    }
  });
});

// ════════════════════════════════════════════════════════════════
// D947 / P5: 安全判据 fail-closed + 三态可区分
//
//   ① 被拒绝            — 无凭据 / 凭据无效            → 401
//   ② 不可用（系统异常）  — 判据配置缺失（JWT_SECRET 不可用）→ fail-closed 401，绝不降级放行
//   ③ 出错              — 判据执行抛异常                → 500 + degraded:true
//
// 三态由日志标记区分（AUTH_REJECTED / AUTH_UNAVAILABLE / AUTH_ERROR），
// 此处以可执行断言（捕获日志条目）+ 响应行为双重固定，不用 grep 静态判据。
// 降级只适用于业务判据；安全判据一律 fail-closed。
// ════════════════════════════════════════════════════════════════

describe('D947/P5 — 安全判据三态（fail-closed + 留痕）', () => {
  it('① 被拒绝: 无 Authorization 头 → 401 + AUTH_REJECTED 留痕', () => {
    const mark = logCapture.calls.length;
    const req = { path: '/api/workspaces', headers: {} } as Request;
    const res = mockRes();
    let nextCalled = false;

    jwtAuthMiddleware(req, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect((res.body as Record<string, unknown>)?.code).toBe('UNAUTHORIZED');
    expect(codesSince(mark)).toContain('AUTH_REJECTED');
  });

  it('② 不可用（系统异常）: JWT_SECRET 不可用 + DEV_MODE=false → fail-closed 401，绝不降级 admin', () => {
    const mark = logCapture.calls.length;
    const prevSecret = process.env.JWT_SECRET;
    const prevDev = process.env.DEV_MODE;
    delete process.env.JWT_SECRET;
    process.env.DEV_MODE = 'false';
    try {
      // 判据层自证：同一状态下 verifyJwtToken 明确报「不可用」
      expect(verifyJwtToken('header.payload.signature').error).toBe('JWT_SECRET not configured');

      const req: Record<string, unknown> & { path: string; headers: Record<string, string>; auth?: unknown } = {
        path: '/api/workspaces',
        headers: { authorization: 'Bearer header.payload.signature' },
      };
      const res = mockRes();
      let nextCalled = false;

      jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(req.auth).toBeUndefined();                          // 关键：未降级为 admin
      expect(codesSince(mark)).toContain('AUTH_UNAVAILABLE');    // 与 ① 可区分
      expect(codesSince(mark)).not.toContain('AUTH_REJECTED');
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevDev === undefined) delete process.env.DEV_MODE;
      else process.env.DEV_MODE = prevDev;
    }
  });

  it('③ 出错: 判据执行抛异常 → 500 + degraded:true + AUTH_ERROR 留痕', () => {
    const mark = logCapture.calls.length;
    const req = {
      get path(): string { throw new Error('injected judgement failure'); },
      headers: {},
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;

    jwtAuthMiddleware(req, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(500);
    expect((res.body as Record<string, unknown>)?.degraded).toBe(true);
    expect(codesSince(mark)).toContain('AUTH_ERROR');
  });

  it('边界: DEV_MODE=true + 无 JWT_SECRET → 唯一无凭据放行路径，带 AUTH_DEV_MODE_GRANT 留痕', () => {
    const mark = logCapture.calls.length;
    const prevSecret = process.env.JWT_SECRET;
    const prevDev = process.env.DEV_MODE;
    delete process.env.JWT_SECRET;
    process.env.DEV_MODE = 'true';
    try {
      const req: Record<string, unknown> & { path: string; headers: Record<string, string>; auth?: unknown } = {
        path: '/api/workspaces',
        headers: {},
      };
      const res = mockRes();
      let nextCalled = false;

      jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect((req.auth as Record<string, unknown>)?.role).toBe('admin');
      expect(codesSince(mark)).toContain('AUTH_DEV_MODE_GRANT');
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevDev === undefined) delete process.env.DEV_MODE;
      else process.env.DEV_MODE = prevDev;
    }
  });
});

// ════════════════════════════════════════════════════════════════
// D947 / L-20: 白名单语义 = 「不要求认证」≠「忽略认证」
//
//   验签通过 → 注入 req.auth（路由内 requireAuth 才可能被满足）；
//   无凭据 / 无效凭据 / 验签失败 → 不注入，但**照旧放行**（可达性不变）。
//   P0 不变量: 注入的只能是验签身份；自报值永不进入 req.auth。
// 判别性（M5/M6 变异体靶点）: M5「吞掉合法 Bearer」→ 用例 1 红；
//   M6「无效 Bearer 也注入」→ 用例 2 红。
// ════════════════════════════════════════════════════════════════

describe('D947/L-20 — 白名单路径的凭据注入', () => {
  type WhitelistReq = { path: string; headers: Record<string, string>; auth?: JwtPayload };

  function runWhitelist(path: string, headers: Record<string, string>) {
    const mark = logCapture.calls.length;
    const req: WhitelistReq = { path, headers };
    const res = mockRes();
    let nextCalled = false;

    jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });

    return { req, res, nextCalled, codes: codesSince(mark) };
  }

  it('L-20: 白名单 + 验签通过的 Bearer → 注入 req.auth，且可被路由内 requireAuth 采纳', () => {
    const token = signJwtToken({ sub: 'whitelist-user', role: 'ga', orgId: 'org-l20' });
    expect(token).toBeTruthy();

    const { req, res, nextCalled } = runWhitelist('/api/solutions', { authorization: `Bearer ${token}` });

    expect(nextCalled).toBe(true);                    // 白名单不拦截
    expect(res.statusCode).toBeUndefined();
    expect(req.auth).toBeTruthy();                    // 关键：注入发生
    expect(req.auth?.role).toBe('ga');
    expect(req.auth?.sub).toBe('whitelist-user');
    // 端到端意图：solutions.ts:32/36 的 extractAuthFromRequest 在此请求上得以返回上下文
    expect(extractAuthFromRequest(req)?.orgId).toBe('org-l20');
    expect(extractAuthFromRequest(req)?.userId).toBe('whitelist-user');
  });

  it('L-20/P0: 白名单 + 无效 Bearer → 不注入（绝不采信伪造身份），但照旧放行 + 留痕', () => {
    const { req, res, nextCalled, codes } = runWhitelist('/api/solutions', { authorization: 'Bearer not-a-jwt' });

    expect(nextCalled).toBe(true);                    // 可达性不变
    expect(res.statusCode).toBeUndefined();           // 不拦截
    expect(req.auth).toBeUndefined();                 // 无效凭据绝不成为身份
    expect(extractAuthFromRequest(req)).toBeNull();
    expect(codes).toContain('AUTH_REJECTED');         // 留痕（whitelist:true 区分于真 401）
  });

  it('L-20/P0: 白名单 + 仅自报 x-synova-token（无 Bearer）→ 不注入（自报值永不成为身份）', () => {
    const { req, nextCalled } = runWhitelist('/api/solutions', { 'x-synova-token': 'admin:org-x:attacker' });

    expect(nextCalled).toBe(true);
    expect(req.auth).toBeUndefined();
    expect(extractAuthFromRequest(req)).toBeNull();
  });

  it('L-20: 白名单 + 无任何凭据 → 放行且不注入（白名单=不要求认证，不是必须）', () => {
    const { req, res, nextCalled, codes } = runWhitelist('/api/solutions', {});

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeUndefined();
    expect(req.auth).toBeUndefined();
    expect(codes).not.toContain('AUTH_REJECTED'); // 无凭据不构成留痕事件
  });

  it('L-20: 白名单 + Bearer 但判据不可用（无 JWT_SECRET + DEV_MODE=false）→ 不注入、仍放行、留痕 AUTH_UNAVAILABLE', () => {
    const prevSecret = process.env.JWT_SECRET;
    const prevDev = process.env.DEV_MODE;
    delete process.env.JWT_SECRET;
    process.env.DEV_MODE = 'false';
    try {
      const { req, res, nextCalled, codes } = runWhitelist('/api/solutions', { authorization: 'Bearer whatever.value.here' });

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBeUndefined();
      expect(req.auth).toBeUndefined();
      expect(codes).toContain('AUTH_UNAVAILABLE');
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (prevDev === undefined) delete process.env.DEV_MODE;
      else process.env.DEV_MODE = prevDev;
    }
  });

  it('REV-6 豁免路径回归: /health · /api/auth/login · /api/status/budget · /api/knowledge/ask 仍直达（非 401/403）', () => {
    for (const path of ['/health', '/api/auth/login', '/api/status/budget', '/api/knowledge/ask']) {
      const { nextCalled, res } = runWhitelist(path, {});
      expect({ path, nextCalled, statusCode: res.statusCode ?? null })
        .toEqual({ path, nextCalled: true, statusCode: null });
    }
  });
});
