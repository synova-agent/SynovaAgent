/**
 * tests/middleware/rbac-default-deny.test.ts — D947 PR-1 / P1 夹具（新建）
 *
 * 主题: RBAC 默认拒绝姿态（default-deny）。
 *
 *   修复前（rbac.ts:110-119）:
 *     · 任一带 ':' 的自报 token（header `x-synova-token` 或 `query.token`）即可自封角色，含 admin
 *     · 无凭据时兜底 `{ role: 'admin' }`
 *   修复后（D947）:
 *     · 唯一可信来源 = `req.auth`（jwtAuthMiddleware 验签后注入）
 *     · 无凭据 → `authenticated:false` → canAccessWorkspace / canModifyWorkspace 一律拒绝（fail-closed）
 *
 * 判别性（改回即红）: 去掉 extractRbacContext 的拒绝返回、或去掉 canAccess/canModify 的
 * `authenticated === false` 前置短路，本文件即红。
 *
 * 铁律 48: 每条用例均有 expect 断言；覆盖正常路径 / 拒绝路径 / 边界三路径。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * D947: 捕获拒绝留痕。P5 的「被拒绝」态必须是**可执行断言**，
 * 而不是 grep 型静态判据 —— 故此处拦截 logger 工厂并断言日志标记。
 */
const logCapture = vi.hoisted(() => {
  const calls: Array<{ level: string; meta?: { code?: string } }> = [];
  return { calls };
});

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: { code?: string }) => {
    logCapture.calls.push({ level, meta });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
    }),
  };
});

import {
  extractRbacContext,
  rbacMiddleware,
  canAccessWorkspace,
  canModifyWorkspace,
  type RbacContext,
} from '../../src/middleware/rbac';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947）—— 夹具自证环境已就位，否则判空转
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});

/** 取基线之后的日志标记（logCapture 文件级累积，故按位置切片） */
function codesSince(mark: number): string[] {
  return logCapture.calls
    .slice(mark)
    .map(c => c.meta?.code)
    .filter((c): c is string => typeof c === 'string');
}

/** 构造只带自报凭据的请求（无 req.auth） */
function selfReportedReq(token: string) {
  return { headers: { 'x-synova-token': token }, query: {} as Record<string, unknown> };
}

/** 全部可见性形态（含两处边界：department 缺字段 / 无 visibility） */
const ALL_VISIBILITIES = [
  { label: 'global', ws: { visibility: 'global' as const } },
  { label: 'department(有部门)', ws: { visibility: 'department' as const, department: 'sales' } },
  { label: 'department(缺字段·边界)', ws: { visibility: 'department' as const } },
  { label: 'private(他人)', ws: { visibility: 'private' as const, owner: 'bob' } },
  { label: 'private(自报同名)', ws: { visibility: 'private' as const, owner: 'dev' } },
  { label: 'undefined visibility(边界)', ws: {} },
];

describe('D947/P1 — RBAC 默认拒绝（自报凭据不放行）', () => {
  it('P1: 无凭据 → 标记未认证、角色 ≠ admin、身份为匿名占位', () => {
    const ctx = extractRbacContext({});
    expect(ctx.authenticated).toBe(false);
    expect(ctx.role).not.toBe('admin');
    expect(ctx.userId).toBe('unauthenticated');
  });

  it('P1: 自报 admin（header）→ 不解析为 admin，且任何可见性形态都不放行', () => {
    const ctx = extractRbacContext(selfReportedReq('admin::dev'));
    expect(ctx.authenticated).toBe(false);
    for (const { label, ws } of ALL_VISIBILITIES) {
      expect({ label, allowed: canAccessWorkspace(ctx, ws) }).toEqual({ label, allowed: false });
    }
  });

  it('P1: 自报 admin（query.token）→ 同样不放行', () => {
    const ctx = extractRbacContext({ headers: {}, query: { token: 'admin::x' } });
    expect(ctx.authenticated).toBe(false);
    expect(canAccessWorkspace(ctx, { visibility: 'global' })).toBe(false);
  });

  it('P1: 自报 manager 带部门 → 不解析出部门，跨部门隔离不可被自报绕过', () => {
    const ctx = extractRbacContext(selfReportedReq('manager:sales:alice'));
    expect(ctx.role).not.toBe('manager');
    expect(ctx.department).toBeUndefined();
    expect(canAccessWorkspace(ctx, { visibility: 'department', department: 'sales' })).toBe(false);
    expect(canModifyWorkspace(ctx, { department: 'sales', owner: 'alice' })).toBe(false);
  });

  it('P1 边界: 自报 admin 且 ws.department 缺失 → 不得因 undefined===undefined 放行', () => {
    const ctx = extractRbacContext(selfReportedReq('admin::dev'));
    expect(canAccessWorkspace(ctx, { visibility: 'department' })).toBe(false);
  });

  it('P1 留痕: 拒绝路径写入 RBAC_DENIED 标记（P5「被拒绝」态可断言）', () => {
    const mark = logCapture.calls.length;
    const ctx = extractRbacContext(selfReportedReq('admin::dev'));
    canAccessWorkspace(ctx, { visibility: 'global' });
    canModifyWorkspace(ctx, { visibility: 'global' });
    const denied = codesSince(mark).filter(c => c === 'RBAC_DENIED');
    expect(denied.length).toBeGreaterThanOrEqual(3); // 提取 1 次 + 判定 2 次
  });

  it('正常路径: 验签注入（req.auth）→ 仍按角色放行（拒绝不是一刀切）', () => {
    const ctx = extractRbacContext({ auth: { sub: 'admin-1', role: 'admin', orgId: 'org-1' } });
    expect(ctx.authenticated).toBe(true);
    expect(ctx.role).toBe('admin');
    expect(ctx.userId).toBe('admin-1');
    expect(canAccessWorkspace(ctx, { visibility: 'global' })).toBe(true);
    expect(canModifyWorkspace(ctx, { visibility: 'global' })).toBe(true);
  });

  it('P1 接线: rbacMiddleware 真实注入拒绝态（非仅纯函数层面正确）', () => {
    const req: Record<string, unknown> & { headers: Record<string, string>; query: Record<string, unknown>; rbac?: unknown } = {
      headers: { 'x-synova-token': 'admin::dev' },
      query: {},
    };
    let nextCalled = false;
    rbacMiddleware(
      req as unknown as Request,
      {} as unknown as Response,
      (() => { nextCalled = true; }) as NextFunction,
    );

    expect(nextCalled).toBe(true); // 中间件本身不阻断，只注入
    const injected = req.rbac as RbacContext;
    expect(injected).toBeDefined();
    expect(injected.authenticated).toBe(false);
    expect(injected.role).not.toBe('admin');
    // 注入进 req 的上下文本身即拒绝态（下游拿到的就是它）
    expect(canAccessWorkspace(injected, { visibility: 'global' })).toBe(false);
    expect(canModifyWorkspace(injected, { visibility: 'global' })).toBe(false);
  });

  it('P1 接线: rbacMiddleware + 验签注入 → 注入放行态', () => {
    const req: Record<string, unknown> & { headers: Record<string, string>; auth?: unknown; rbac?: unknown } = {
      headers: {},
      auth: { sub: 'admin-1', role: 'admin', orgId: 'org-1' },
    };
    rbacMiddleware(req as unknown as Request, {} as unknown as Response, (() => {}) as NextFunction);

    const injected = req.rbac as RbacContext;
    expect(injected.authenticated).toBe(true);
    expect(injected.role).toBe('admin');
    expect(canAccessWorkspace(injected, { visibility: 'global' })).toBe(true);
  });
});
