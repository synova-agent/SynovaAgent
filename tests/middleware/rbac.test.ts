import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { extractRbacContext, canAccessWorkspace, canModifyWorkspace, derivePermissions, BUILTIN_TEMPLATES, type RbacContext } from '../../src/middleware/rbac';
import { listTemplates, getTemplate, saveTemplate, deleteTemplate } from '../../src/services/role-template-store';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947）—— 夹具自证环境已就位，否则判空转
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});

/**
 * D947 夹具请求构造——只带自报 x-synova-token（无 req.auth）。
 * 返回类型与 extractRbacContext 入参结构一致，不需要 any/never 断言。
 */
function mockReq(token: string) {
  return { headers: { 'x-synova-token': token }, query: {} as Record<string, unknown> };
}

/**
 * D947 PR-1 / P0+P1: 默认安全姿态——自报凭据（x-synova-token / query.token）
 * 不经验签，**一律不放行**；无凭据时标记未认证，绝不回退 admin。
 *
 * 修复前行为（rbac.ts:110-119）: 任一带 ':' 的字符串即可自封 role=admin；
 * 无凭据时兜底 `{ role: 'admin' }`。以下用例在修复前为红/为"放行"，修复后为绿/为"拒绝"。
 */
describe('extractRbacContext — D947 默认安全姿态', () => {
  it('P0: x-synova-token=admin::dev 自报 → 角色 ≠ admin 且标记未认证', () => {
    const ctx = extractRbacContext(mockReq('admin::dev'));
    expect(ctx.role).not.toBe('admin');
    expect(ctx.authenticated).toBe(false);
  });

  it('P0: query.token=admin::x 自报 → 角色 ≠ admin（query 自报同样不放行）', () => {
    const ctx = extractRbacContext({ headers: {}, query: { token: 'admin::x' } });
    expect(ctx.role).not.toBe('admin');
    expect(ctx.authenticated).toBe(false);
  });

  it('P0: manager:marketing:alice 自报 → 不解析出 manager/department/alice（越权面归零）', () => {
    const ctx = extractRbacContext(mockReq('manager:marketing:alice'));
    expect(ctx.role).not.toBe('manager');
    expect(ctx.department).toBeUndefined();
    expect(ctx.userId).not.toBe('alice');
  });

  it('P0: liaison::coordinator 自报 → 不解析出 liaison', () => {
    const ctx = extractRbacContext(mockReq('liaison::coordinator'));
    expect(ctx.role).not.toBe('liaison');
    expect(ctx.authenticated).toBe(false);
  });

  it('P1: 空 token → 不得 admin + 标记未认证', () => {
    const ctx = extractRbacContext(mockReq(''));
    expect(ctx.role).not.toBe('admin');
    expect(ctx.authenticated).toBe(false);
  });

  it('P1: 无冒号 token → 不得 admin + 标记未认证', () => {
    const ctx = extractRbacContext(mockReq('some-random-token'));
    expect(ctx.role).not.toBe('admin');
    expect(ctx.authenticated).toBe(false);
  });

  it('P1: 完全无 headers/query → 不得 admin + 标记未认证', () => {
    const ctx = extractRbacContext({});
    expect(ctx.role).not.toBe('admin');
    expect(ctx.authenticated).toBe(false);
  });

  it('P1: 自报 admin 上下文 → canAccessWorkspace(global) 拒绝', () => {
    const ctx = extractRbacContext(mockReq('admin::dev'));
    expect(canAccessWorkspace(ctx, { visibility: 'global' })).toBe(false);
  });

  it('P1: 自报 admin 上下文 → canModifyWorkspace 拒绝', () => {
    const ctx = extractRbacContext(mockReq('admin::dev'));
    expect(canModifyWorkspace(ctx, { visibility: 'global' })).toBe(false);
  });

  it('P1 边界: department 可见但 ws.department 缺失 → 不得因 undefined===undefined 放行', () => {
    const ctx = extractRbacContext(mockReq('admin::dev'));
    expect(canAccessWorkspace(ctx, { visibility: 'department' })).toBe(false);
  });

  it('正常路径: req.auth（验签注入）仍正确提取，且标记已认证', () => {
    const ctx = extractRbacContext({ auth: { sub: 'ga_001', role: 'ga', orgId: 'org-1' } });
    expect(ctx.role).toBe('ga');
    expect(ctx.userId).toBe('ga_001');
    expect(ctx.authenticated).toBe(true);
  });
});

describe('canAccessWorkspace', () => {
  const r = (role: string, dept?: string): RbacContext => ({ role: role as RbacContext['role'], userId: 'u', department: dept });

  it('admin can access all workspaces', () => {
    expect(canAccessWorkspace(r('admin'), { visibility: 'global' })).toBe(true);
    expect(canAccessWorkspace(r('admin'), { visibility: 'department', department: 'marketing' })).toBe(true);
    expect(canAccessWorkspace(r('admin'), { visibility: 'private', owner: 'bob' })).toBe(true);
  });

  it('liaison can access all workspaces', () => {
    expect(canAccessWorkspace(r('liaison'), { visibility: 'global' })).toBe(true);
    expect(canAccessWorkspace(r('liaison'), { visibility: 'department', department: 'sales' })).toBe(true);
    expect(canAccessWorkspace(r('liaison'), { visibility: 'private', owner: 'bob' })).toBe(true);
  });

  it('manager can access own department workspace', () => {
    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'department', department: 'marketing' })).toBe(true);
  });

  it('manager CANNOT access other department workspace', () => {
    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'department', department: 'sales' })).toBe(false);
  });

  it('manager CANNOT access global workspace', () => {
    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'global' })).toBe(false);
  });

  it('manager can access own private workspace', () => {
    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'private', owner: 'u' })).toBe(true);
  });

  it('manager CANNOT access other private workspace', () => {
    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'private', owner: 'bob' })).toBe(false);
  });
});

describe('canModifyWorkspace', () => {
  const r = (role: string, dept?: string): RbacContext => ({ role: role as RbacContext['role'], userId: 'u', department: dept });

  it('admin can modify all', () => {
    expect(canModifyWorkspace(r('admin'), { department: 'sales' })).toBe(true);
  });

  it('manager can modify own department', () => {
    expect(canModifyWorkspace(r('manager', 'marketing'), { department: 'marketing' })).toBe(true);
  });

  it('manager can modify own workspace', () => {
    expect(canModifyWorkspace(r('manager'), { department: 'sales', owner: 'u' })).toBe(true);
  });

  it('manager CANNOT modify other department workspace', () => {
    expect(canModifyWorkspace(r('manager'), { department: 'sales', owner: 'bob' })).toBe(false);
  });

  it('liaison CANNOT modify', () => {
    expect(canModifyWorkspace(r('liaison'), { department: 'marketing' })).toBe(false);
  });

  // ═══ Phase 0.1: GA 角色 ═══

  it('GA token → role=ga', () => {
    const ctx = extractRbacContext({ auth: { sub: 'ga_001', role: 'ga', orgId: 'org-1' } } as any);
    expect(ctx.role).toBe('ga');
    expect(ctx.userId).toBe('ga_001');
  });

  it('GA can access all workspaces (like liaison)', () => {
    expect(canAccessWorkspace(r('ga'), { visibility: 'global' })).toBe(true);
    expect(canAccessWorkspace(r('ga'), { visibility: 'department', department: 'sales' })).toBe(true);
    expect(canAccessWorkspace(r('ga'), { visibility: 'private', owner: 'bob' })).toBe(true);
  });

  it('GA CANNOT modify workspace (403)', () => {
    expect(canModifyWorkspace(r('ga'), { department: 'marketing' })).toBe(false);
    expect(canModifyWorkspace(r('ga'), { department: 'sales', owner: 'ga_001' })).toBe(false);
  });

  it('extractRbacContext: JWT auth takes priority over x-synova-token', () => {
    const ctx = extractRbacContext({
      headers: { 'x-synova-token': 'admin:dev:user1' },
      auth: { sub: 'ga_001', role: 'ga', orgId: 'org-1' },
    } as any);
    expect(ctx.role).toBe('ga');
    expect(ctx.userId).toBe('ga_001');
  });
});

// ═══ D947 / L-29: canModifyWorkspace 部门分支 fail-closed 收窄 ═══

/**
 * L-29（code-c 实测 F-2）: 修复前部门分支为 `ws.department === ctx.department`，
 * 在**双 undefined** 时命中 `undefined === undefined` ⇒ 对**无部门工作区**，
 * 任意已认证 manager（含非属主）均可修改 ⇒ fail-open 授权分支。
 *
 * 修复后：部门分支要求**双方部门均有值**（均非 undefined）才可能命中；
 * 双 undefined / 单侧 undefined ⇒ 不命中 ⇒ deny（owner 路径并行保留，不受影响）。
 *
 * 判别性：把修复改回原样，本 describe 的前 5 例即红（回执附变异体红证）。
 */
describe('canModifyWorkspace — D947/L-29 部门分支 fail-closed', () => {
  const ctxOf = (role: string, department?: string): RbacContext => ({
    role: role as RbacContext['role'],
    userId: 'm1',
    department,
  });

  it('L-29 核心: manager + 双方部门皆缺失 + 非属主 → false（双 undefined 不得放行）', () => {
    expect(canModifyWorkspace(ctxOf('manager', undefined), { department: undefined, owner: '别人' })).toBe(false);
  });

  it('L-29: manager + 双方部门皆缺失 + 属主 → true（owner 路径不受影响）', () => {
    expect(canModifyWorkspace(ctxOf('manager', undefined), { department: undefined, owner: 'm1' })).toBe(true);
  });

  it('L-29: manager + ctx 有部门 / ws 无部门 + 非属主 → false（单侧 undefined 不得命中）', () => {
    expect(canModifyWorkspace(ctxOf('manager', 'marketing'), { department: undefined, owner: '别人' })).toBe(false);
  });

  it('L-29: manager + ctx 无部门 / ws 有部门 + 非属主 → false（单侧 undefined 不得命中）', () => {
    expect(canModifyWorkspace(ctxOf('manager', undefined), { department: 'sales', owner: '别人' })).toBe(false);
  });

  it('L-29: manager + ws 完全无 department 字段 + 非属主 → false', () => {
    expect(canModifyWorkspace(ctxOf('manager', undefined), { owner: '别人' })).toBe(false);
  });

  it('边界/正常: manager 同部门且双方均有值 → true（既有应有结果保持）', () => {
    expect(canModifyWorkspace(ctxOf('manager', 'marketing'), { department: 'marketing' })).toBe(true);
  });

  it('边界/正常: manager 跨部门 → false（既有结果保持）', () => {
    expect(canModifyWorkspace(ctxOf('manager', 'marketing'), { department: 'sales' })).toBe(false);
  });

  it('边界: manager 同部门 + 非属主 → true（部门命中即放行，本就如此）', () => {
    expect(canModifyWorkspace(ctxOf('manager', 'marketing'), { department: 'marketing', owner: '别人' })).toBe(true);
  });

  it('边界: admin 不受部门分支收窄影响 → true', () => {
    expect(canModifyWorkspace(ctxOf('admin', undefined), { department: undefined, owner: '别人' })).toBe(true);
  });

  it('边界: staff / ga 依旧拒绝（不因收窄而放宽）', () => {
    expect(canModifyWorkspace(ctxOf('staff', 'marketing'), { department: 'marketing' })).toBe(false);
    expect(canModifyWorkspace(ctxOf('ga', 'marketing'), { department: 'marketing' })).toBe(false);
  });

  it('边界: 未认证上下文仍拒绝（先于 manager 分支）', () => {
    const anon: RbacContext = { role: 'manager', userId: 'm1', authenticated: false };
    expect(canModifyWorkspace(anon, { department: undefined, owner: 'm1' })).toBe(false);
  });

  // ── L-32 一次收口 §7③: 空串同样不得视为「有值」（本组在 L-32 前为红） ──

  it('L-32 收口: manager + 双空串部门 + 非属主 → false（空串非「有值」）', () => {
    expect(canModifyWorkspace(ctxOf('manager', ''), { department: '', owner: '别人' })).toBe(false);
  });

  it('L-32 收口: manager + 单侧空串 + 非属主 → false', () => {
    expect(canModifyWorkspace(ctxOf('manager', ''), { department: 'sales', owner: '别人' })).toBe(false);
    expect(canModifyWorkspace(ctxOf('manager', 'sales'), { department: '', owner: '别人' })).toBe(false);
  });
});

// ═══ D947 / L-32: canAccessWorkspace 部门分支 fail-closed（L-29 同型 twin） ═══

/**
 * L-32（裁定）: `canAccessWorkspace` 的部门可见性分支原为 `ws.department === ctx.department`，
 * 与 L-29 **完全同源**——双 undefined 命中 `undefined === undefined` ⇒ 已认证非 admin
 * 可越权读到「无部门」的部门可见工作区（fail-open）。
 *
 * 与 L-29 一次收口：命中条件收紧为「双方均为**非空字符串**且相等」
 * ⇒ 双 undefined / 单侧 undefined / 双 '' / 单侧 '' 一律**不命中**；
 * `role === 'admin'` 旁路保持原样（admin 不受收窄影响）。
 */
describe('canAccessWorkspace — D947/L-32 部门分支 fail-closed（twin）', () => {
  const acc = (role: string, department?: string): RbacContext => ({
    role: role as RbacContext['role'],
    userId: 'u',
    department,
  });
  const DEPT_WS = { visibility: 'department' as const };

  it('L-32 核心: manager + 双 undefined + visibility=department → false（双 undefined 不得放行）', () => {
    expect(canAccessWorkspace(acc('manager', undefined), DEPT_WS)).toBe(false);
  });

  it('L-32: manager + ctx 有部门 / ws 无部门 → false（单侧 undefined 不得命中）', () => {
    expect(canAccessWorkspace(acc('manager', 'marketing'), DEPT_WS)).toBe(false);
  });

  it('L-32: manager + ctx 无部门 / ws 有部门 → false（单侧 undefined 不得命中）', () => {
    expect(canAccessWorkspace(acc('manager', undefined), { visibility: 'department', department: 'sales' })).toBe(false);
  });

  it('L-32: manager + 双空串部门 → false（空串非「有值」）', () => {
    expect(canAccessWorkspace(acc('manager', ''), { visibility: 'department', department: '' })).toBe(false);
  });

  it('L-32: manager + 单侧空串 → false', () => {
    expect(canAccessWorkspace(acc('manager', ''), { visibility: 'department', department: 'sales' })).toBe(false);
    expect(canAccessWorkspace(acc('manager', 'sales'), { visibility: 'department', department: '' })).toBe(false);
  });

  it('L-32 正常: manager + 同非空部门 → true（既有应有结果保持）', () => {
    expect(canAccessWorkspace(acc('manager', 'marketing'), { visibility: 'department', department: 'marketing' })).toBe(true);
  });

  it('L-32 正常: manager + 跨部门 → false（既有结果保持）', () => {
    expect(canAccessWorkspace(acc('manager', 'marketing'), { visibility: 'department', department: 'sales' })).toBe(false);
  });

  it('L-32 边界: admin + 任意（含双 undefined / 双空串）→ true（旁路保持原样）', () => {
    expect(canAccessWorkspace(acc('admin', undefined), DEPT_WS)).toBe(true);
    expect(canAccessWorkspace(acc('admin', ''), { visibility: 'department', department: '' })).toBe(true);
  });

  it('L-32 边界: 未认证上下文仍拒绝（不回归）', () => {
    const anon: RbacContext = { role: 'manager', userId: 'u', authenticated: false };
    expect(canAccessWorkspace(anon, { visibility: 'department', department: 'marketing' })).toBe(false);
  });
});

// ═══ D242: 权限模板 ═══

describe('D242 — RoleTemplate builtins', () => {
  it('有 5 个内置模板', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(5);
    const ids = BUILTIN_TEMPLATES.map(t => t.id);
    expect(ids).toContain('admin');
    expect(ids).toContain('manager');
    expect(ids).toContain('liaison');
    expect(ids).toContain('staff');
    expect(ids).toContain('ga');
  });

  it('内置模板 isBuiltin=true', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.isBuiltin).toBe(true);
    }
  });

  it('derivePermissions 从模板派生', () => {
    const admin = BUILTIN_TEMPLATES.find(t => t.id === 'admin')!;
    const perms = derivePermissions(admin);
    expect(perms.data).toBe('admin');
    expect(perms.function).toBe('audit');
  });

  it('derivePermissions 支持覆盖', () => {
    const staff = BUILTIN_TEMPLATES.find(t => t.id === 'staff')!;
    const perms = derivePermissions(staff, { data: 'write' });
    expect(perms.data).toBe('write');   // covered
    expect(perms.function).toBe('use');  // from template
    expect(perms.time).toBe('business_hours');  // from template
  });
});

describe('D242 — RoleTemplateStore CRUD', () => {
  const TEST_ID = 'test-custom-role';
  const testTemplate = {
    id: TEST_ID, name: 'Test Role', description: 'A test custom role',
    basedOn: 'staff', permissions: { data: 'read' as const, function: 'use' as const, time: 'unlimited' as const },
    isBuiltin: false, createdAt: new Date().toISOString(),
  };

  afterEach(() => {
    try {
      const p = join(process.cwd(), '.codex', 'settings', 'role-templates', `${TEST_ID}.json`);
      if (existsSync(p)) unlinkSync(p);
    } catch { /* ok */ }
  });

  it('listTemplates 包含 5 个内置', () => {
    const all = listTemplates();
    const builtins = all.filter(t => t.isBuiltin);
    expect(builtins).toHaveLength(5);
  });

  it('saveTemplate + getTemplate CRUD', () => {
    expect(saveTemplate(testTemplate)).toBe(true);
    const loaded = getTemplate(TEST_ID);
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('Test Role');
    expect(loaded!.permissions.data).toBe('read');
  });

  it('内置模板不可删除', () => {
    const result = deleteTemplate('admin');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不可删除');
  });

  it('自定义模板可删除', () => {
    saveTemplate(testTemplate);
    const result = deleteTemplate(TEST_ID);
    expect(result.ok).toBe(true);
    expect(getTemplate(TEST_ID)).toBeUndefined();
  });

  it('listTemplates 包含已保存的自定义模板', () => {
    saveTemplate(testTemplate);
    const all = listTemplates();
    const custom = all.find(t => t.id === TEST_ID);
    expect(custom).toBeDefined();
    expect(custom!.isBuiltin).toBe(false);
  });
});
