/**
 * tests/routes/enterprise.test.ts — D102+D103 企业路由测试 + D484 邀请全链路 + D485 双轨账号关联集成测试
 *
 * D102+D103（保留）: bcrypt/内存 store 操作/模块导出接线检查
 * D485（新增）: 双轨账号关联——个人轨已注册 email 被邀请 → accept 绑定（userId/密码保留，
 *   orgId/role 更新，linked=true）；新 email accept 新建（linked=false 现状回归）；
 *   未绑定个人账号调企业端点 403（边界不削弱）。复用 D484 真实 HTTP 基建。
 * D484（新增）: 企业邀请注册全链路——匿名 register→login→invite→query→accept 真实 HTTP。
 *   铁律 12: 真实 express 挂载（jwtAuthMiddleware→authRoutes→enterpriseRoutes，与生产
 *   server.ts L290/L293/L354 顺序同构），native fetch，真实 signJwtToken/UserStore/bcrypt。
 *   UserStore 注入内存 GraphStoreLike（真实组件实现，非 mock 管线；零 SQLite 依赖），
 *   同一实例注入 auth/enterprise 两路由模块（模拟生产 synova-agent.ts D224 注入）。
 * 约束: ≥12测试 / 零as any
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createLogger } from '@synova/logger';

// Use direct imports for backend logic testing
import bcrypt from 'bcrypt';

// D484: 测试环境（getSecret() 运行时读取，须早于任何请求发出）
process.env.JWT_SECRET = 'synova-d484-enterprise-invite-test-secret';
process.env.DEV_MODE = 'false';

import express from 'express';
import type { Server } from 'http';
import { jwtAuthMiddleware } from '../../src/middleware/auth';
import authRoutes, { setUserStore as authSetUserStore } from '../../src/routes/auth';
import enterpriseRoutes, { setUserStore as entSetUserStore } from '../../src/routes/enterprise';
import { UserStore, type GraphStoreLike } from '../../src/growth/user-store';

// ═══ Auth Store Helpers (mirror in-memory store used in auth.ts) ═══

interface TestUser {
  userId: string; email: string; passwordHash: string; role: string; orgId: string;
  status: 'active' | 'disabled'; createdAt: string;
}
const testUsers = new Map<string, TestUser>();

async function createTestUser(email: string, password: string, role = 'staff'): Promise<TestUser> {
  const userId = `test-${testUsers.size + 1}`;
  const passwordHash = await bcrypt.hash(password, 4); // low rounds for speed
  const user = { userId, email, passwordHash, role, orgId: 'default', status: 'active' as const, createdAt: new Date().toISOString() };
  testUsers.set(userId, user);
  return user;
}

// ═══ D484: 内存 GraphStoreLike（真实组件——UserStore 的真实依赖实现，非 mock 管线） ═══

class InMemoryGraphStore implements GraphStoreLike {
  private nodes = new Map<string, { id: string; type: string; props: Record<string, unknown> }>();
  private counter = 0;

  createNode(type: string, props: Record<string, unknown>, _graph: string): string {
    const id = `node-${++this.counter}`;
    this.nodes.set(id, { id, type, props });
    return id;
  }

  queryNodes(type: string, filters?: Record<string, unknown>, _graph?: string):
    Array<{ id: string; type: string; props: Record<string, unknown> }> {
    const all = Array.from(this.nodes.values()).filter(n => n.type === type);
    if (!filters) return all;
    return all.filter(n => Object.entries(filters).every(([k, v]) => n.props[k] === v));
  }

  getNode(id: string, _graph: string): unknown | null {
    return this.nodes.get(id) ?? null;
  }

  updateNode(id: string, props: Record<string, unknown>, _graph: string): void {
    const node = this.nodes.get(id);
    if (node) node.props = { ...node.props, ...props };
  }
}

describe('D102 — bcrypt auth', () => {
  it('bcrypt.hash creates valid hash', async () => {
    const hash = await bcrypt.hash('password123', 4);
    expect(hash).toBeTruthy();
    expect(hash.startsWith('$2b$')).toBe(true);
  });

  it('bcrypt.compare matches correct password', async () => {
    const hash = await bcrypt.hash('password123', 4);
    const match = await bcrypt.compare('password123', hash);
    expect(match).toBe(true);
  });

  it('bcrypt.compare rejects wrong password', async () => {
    const hash = await bcrypt.hash('password123', 4);
    const match = await bcrypt.compare('wrongpassword', hash);
    expect(match).toBe(false);
  });
});

describe('D102 — user store operations', () => {
  beforeEach(() => { testUsers.clear(); });

  it('register: creates new user with hashed password', async () => {
    const user = await createTestUser('test@example.com', 'securePass1');
    expect(user.email).toBe('test@example.com');
    expect(user.passwordHash).not.toBe('securePass1'); // hashed
    expect(user.role).toBe('staff');
    expect(user.status).toBe('active');
  });

  it('login: finds user by email', async () => {
    await createTestUser('alice@co.com', 'alicePass');
    let found: TestUser | null = null;
    for (const u of testUsers.values()) { if (u.email === 'alice@co.com') { found = u; break; } }
    expect(found).not.toBeNull();
    expect(found!.email).toBe('alice@co.com');
  });

  it('login: bcrypt password verification', async () => {
    await createTestUser('bob@co.com', 'bobPass!');
    let foundUser: TestUser | null = null;
    for (const u of testUsers.values()) { if (u.email === 'bob@co.com') { foundUser = u; break; } }
    const match = await bcrypt.compare('bobPass!', foundUser!.passwordHash);
    expect(match).toBe(true);
  });
});

describe('D103 — enterprise route handlers', () => {
  it('auth.ts exports router', async () => {
    const authRoutes = await import('../../src/routes/auth');
    expect(authRoutes.default).toBeDefined();
  });

  it('enterprise.ts exports router', async () => {
    const enterpriseRoutes = await import('../../src/routes/enterprise');
    expect(enterpriseRoutes.default).toBeDefined();
  });

  it('server.ts imports enterpriseRoutes', () => {
    // verify by checking the compiled module has the import
    const fs = require('fs');
    const content = fs.readFileSync('src/server.ts', 'utf-8');
    expect(content).toContain('enterpriseRoutes');
  });
});

describe('D103 — degraded paths', () => {
  it('bcrypt hash failure returns degraded info', async () => {
    // #1405 红 C：原写法把唯一断言放在 catch 里（等 bcrypt 抛「invalid rounds」），但 bcrypt 6.0.0
    // 对 rounds=0 视为「默认 10 轮」**不抛**（本机实测 resolved，返回 $2b$10$… 长 60）⇒ catch 永不执行
    // ⇒ 该用例零断言 ⇒ CI 零断言判据（scripts/ci/core-tests.sh:170-177，afterEach 比对
    // expect.getState().assertionCalls）抛 CORE_ZERO_ASSERTIONS。本机无该 hook，故"全绿"是假绿。
    // 修法：真跑产品降级路径 —— UserStore.createUser 的 bcrypt.hash 失败（src/growth/user-store.ts:89）
    // 冒泡到 enterprise register 的 catch（src/routes/enterprise.ts:121-125）⇒ 500 + degraded:true。
    // 注入失败（而不是等原生模块抛）让判据跨平台确定：不再依赖各平台 bcrypt 对非法入参的宽容度。
    const hashSpy = vi.spyOn(bcrypt, 'hash').mockRejectedValueOnce(new Error('bcrypt hash failed (D103)'));
    try {
      const res = await fetch(`${baseUrl}/api/enterprise/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'd103-degraded@synova.test',
          password: 'degradedPass1',
          orgName: 'D103 降级企业',
        }),
      });
      const body = await res.json() as { ok: boolean; code?: string; degraded?: boolean };
      expect(res.status).toBe(500);
      expect(body.ok).toBe(false);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.degraded).toBe(true);
    } finally {
      hashSpy.mockRestore();
    }
  });

  it('empty password fails validation', () => {
    expect(''.length < 6).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// D484 — 企业邀请注册全链路（集成，铁律 12: 真实路由不 mock 管线）
// 匿名企业注册 → admin 真实 login → 发邀请 → 匿名查邀请 → 匿名接受
// → GraphStore 实证用户 orgId/role 绑定 → 已用/过期邀请 400 → invite 双层保护
// ════════════════════════════════════════════════════════════════

let server: Server;
let baseUrl: string;
let userStore: UserStore;

// 链路共享状态（同 describe 内用例按声明顺序执行，链式依赖即真实业务顺序）
const ADMIN_EMAIL = 'd484-admin@synova.test';
const ADMIN_PASSWORD = 'd484-admin-pass';
const INVITEE_EMAIL = 'd484-invitee@synova.test';
const INVITEE_PASSWORD = 'd484-invitee-pass';
const INVITE_ROLE = 'staff'; // requireAdmin 只放行 admin/manager——staff 用于⑥的 403 断言
let orgId = '';
let adminToken = '';
let inviteToken = '';

beforeAll(async () => {
  // 同一 UserStore 实例注入两路由模块（模拟生产 synova-agent.ts D224 注入）
  userStore = new UserStore(new InMemoryGraphStore());
  authSetUserStore(userStore);
  entSetUserStore(userStore);

  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware); // 生产同构: server.ts L290 认证层
  app.use(authRoutes);        // 生产同构: server.ts L293 auth 路由（login 白名单）
  app.use(enterpriseRoutes);  // 生产同构: server.ts L354 企业路由

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 3099}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  vi.useRealTimers(); // ⑤ 的 fake 时钟恢复（防泄漏到后续用例）
});

describe('D484 — 企业邀请注册全链路（集成）', () => {
  it('① 匿名企业注册 → 200 + orgId/userId/email/role=admin（修复前被认证层 401 挡）', async () => {
    const res = await fetch(`${baseUrl}/api/enterprise/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, orgName: 'D484 测试企业' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { orgId: string; userId: string; email: string; role: string } };
    expect(body.ok).toBe(true);
    expect(body.data.orgId).toMatch(/^org-/);
    expect(body.data.userId).toBeTruthy();
    expect(body.data.email).toBe(ADMIN_EMAIL);
    expect(body.data.role).toBe('admin');
    orgId = body.data.orgId;

    // GraphStore 实证: admin 用户真实入图且 orgId 绑定
    const adminUser = userStore.queryByEmail(ADMIN_EMAIL);
    expect(adminUser).not.toBeNull();
    expect(adminUser?.role).toBe('admin');
    expect(adminUser?.orgId).toBe(orgId);
  });

  it('② admin 真实 login → JWT；携带 JWT 发邀请 → 200 + invitation token', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const loginBody = await login.json() as { ok: boolean; token: string; payload: { role: string; orgId: string } };
    expect(loginBody.ok).toBe(true);
    expect(loginBody.payload.role).toBe('admin');
    expect(loginBody.payload.orgId).toBe(orgId);
    adminToken = loginBody.token;

    const res = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: INVITEE_EMAIL, role: INVITE_ROLE }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { token: string; email: string; role: string; expiresAt: string } };
    expect(body.ok).toBe(true);
    expect(body.data.token).toMatch(/^inv-/);
    expect(body.data.email).toBe(INVITEE_EMAIL);
    expect(body.data.role).toBe(INVITE_ROLE);
    inviteToken = body.data.token;
  });

  it('③ 匿名查询邀请 → 200 + email/orgId/role 匹配（被邀请人打开邀请链接）', async () => {
    const res = await fetch(`${baseUrl}/api/enterprise/invitation/${inviteToken}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { email: string; orgId: string; role: string } };
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe(INVITEE_EMAIL);
    expect(body.data.orgId).toBe(orgId);
    expect(body.data.role).toBe(INVITE_ROLE);
  });

  it('④ 匿名接受邀请 → 200 + 用户创建且 orgId/role 绑定（GraphStore 实证）', async () => {
    const res = await fetch(`${baseUrl}/api/enterprise/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteToken, password: INVITEE_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { userId: string; email: string; role: string; orgId: string } };
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe(INVITEE_EMAIL);
    expect(body.data.role).toBe(INVITE_ROLE);
    expect(body.data.orgId).toBe(orgId);

    // DS3 链路实证: 用户节点真实写入图，orgId/role 绑定邀请方企业
    const invitee = userStore.queryByEmail(INVITEE_EMAIL);
    expect(invitee).not.toBeNull();
    expect(invitee?.userId).toBe(body.data.userId);
    expect(invitee?.orgId).toBe(orgId);
    expect(invitee?.role).toBe(INVITE_ROLE);
    // 密码 bcrypt 哈希实证（非明文落图）
    expect(invitee?.passwordHash).not.toBe(INVITEE_PASSWORD);
    expect(invitee?.passwordHash.startsWith('$2')).toBe(true);
  });

  it('⑤ 已用邀请再查/再接受 → 400 INVITATION_USED；过期邀请 → 400 INVITATION_EXPIRED', async () => {
    // 已用: ④ 接受后同 token 再 accept → 400
    const reAccept = await fetch(`${baseUrl}/api/enterprise/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteToken, password: INVITEE_PASSWORD }),
    });
    expect(reAccept.status).toBe(400);
    const reAcceptBody = await reAccept.json() as { code: string };
    expect(reAcceptBody.code).toBe('INVITATION_USED');

    // 已用: GET 同 token → 400
    const reQuery = await fetch(`${baseUrl}/api/enterprise/invitation/${inviteToken}`);
    expect(reQuery.status).toBe(400);
    const reQueryBody = await reQuery.json() as { code: string };
    expect(reQueryBody.code).toBe('INVITATION_USED');

    // 过期: 真实时间发第二封邀请 → 时钟前移 8 天（>7 天有效期）→ GET/accept 均 400
    const invite2 = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: 'd484-expired@synova.test', role: 'staff' }),
    });
    expect(invite2.status).toBe(200);
    const invite2Body = await invite2.json() as { data: { token: string } };
    const expiredToken = invite2Body.data.token;

    // toFake: ['Date'] 只冻结路由内 new Date()，不拦 HTTP 栈 setTimeout
    vi.useFakeTimers({ now: Date.now() + 8 * 24 * 3600 * 1000, toFake: ['Date'] });
    try {
      const expiredQuery = await fetch(`${baseUrl}/api/enterprise/invitation/${expiredToken}`);
      expect(expiredQuery.status).toBe(400);
      const expiredQueryBody = await expiredQuery.json() as { code: string };
      expect(expiredQueryBody.code).toBe('INVITATION_EXPIRED');

      const expiredAccept = await fetch(`${baseUrl}/api/enterprise/invitation/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: expiredToken, password: 'expired-pass-123' }),
      });
      expect(expiredAccept.status).toBe(400);
      const expiredAcceptBody = await expiredAccept.json() as { code: string };
      expect(expiredAcceptBody.code).toBe('INVITATION_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('⑥ invite 双层保护不削弱: 无 token → 401（认证层）；staff token → 403（requireAdmin）', async () => {
    // 外圈: 认证层拦截（无 Authorization header）
    const noToken = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'd484-noauth@synova.test', role: 'staff' }),
    });
    expect(noToken.status).toBe(401);
    const noTokenBody = await noToken.json() as { code: string };
    expect(noTokenBody.code).toBe('UNAUTHORIZED');

    // 内圈: ④ 创建的邀请用户（staff）真实 login → 携其 token 发邀请 → requireAdmin 403
    const staffLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: INVITEE_EMAIL, password: INVITEE_PASSWORD }),
    });
    expect(staffLogin.status).toBe(200);
    const staffLoginBody = await staffLogin.json() as { ok: boolean; token: string };
    expect(staffLoginBody.ok).toBe(true);

    const staffInvite = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffLoginBody.token}` },
      body: JSON.stringify({ email: 'd484-forbidden@synova.test', role: 'staff' }),
    });
    expect(staffInvite.status).toBe(403);
    const staffInviteBody = await staffInvite.json() as { code: string };
    expect(staffInviteBody.code).toBe('FORBIDDEN');
  });
});

// ════════════════════════════════════════════════════════════════
// D485 — 双轨账号关联（个人账号绑定企业，飞书/钉钉模式）
// 个人轨已注册 email 被企业邀请 → accept 绑定（userId/密码保留，orgId/role 更新）
// → 新 email accept 新建（现状回归）→ 未绑定个人账号边界 403 不削弱
// ════════════════════════════════════════════════════════════════

describe('D485 — 双轨账号关联（个人账号绑定企业）', () => {
  const PERSONAL_EMAIL = 'd485-personal@synova.test';
  const PERSONAL_PASSWORD = 'd485-personal-pass';
  const FRESH_EMAIL = 'd485-fresh@synova.test';
  const FRESH_PASSWORD = 'd485-fresh-pass';
  const LONER_EMAIL = 'd485-loner@synova.test';
  const LONER_PASSWORD = 'd485-loner-pass';

  it('⑦ 个人注册→同 email 被邀请→accept 绑定: userId 不变 + orgId/role 更新 + linked=true + 密码延续 + 错误密码 401 可重试', async () => {
    // 1) 个人轨注册（auth/register 个人空间: orgId=default, role=staff）
    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: PERSONAL_EMAIL, password: PERSONAL_PASSWORD }),
    });
    expect(register.status).toBe(201);
    const registerBody = await register.json() as { ok: boolean; payload: { userId: string; role: string; orgId: string } };
    expect(registerBody.ok).toBe(true);
    const personalUserId = registerBody.payload.userId;
    expect(personalUserId).toBeTruthy();
    expect(registerBody.payload.role).toBe('staff');
    expect(registerBody.payload.orgId).toBe('default');

    // 2) 企业 admin 邀请同 email（role=manager——绑定后 role 真实更新的断言力）
    const invite = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: PERSONAL_EMAIL, role: 'manager' }),
    });
    expect(invite.status).toBe(200);
    const inviteBody = await invite.json() as { data: { token: string } };
    const bindToken = inviteBody.data.token;
    expect(bindToken).toMatch(/^inv-/);

    // 3) accept 绑定（携带个人注册密码——账号所有权证明）
    const accept = await fetch(`${baseUrl}/api/enterprise/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: bindToken, password: PERSONAL_PASSWORD }),
    });
    expect(accept.status).toBe(200);
    const acceptBody = await accept.json() as { ok: boolean; data: { userId: string; email: string; role: string; orgId: string; linked: boolean } };
    expect(acceptBody.ok).toBe(true);
    expect(acceptBody.data.linked).toBe(true);           // 绑定语义（非新建）
    expect(acceptBody.data.userId).toBe(personalUserId); // userId 不变（现状缺陷: 新建重复账号断裂）
    expect(acceptBody.data.email).toBe(PERSONAL_EMAIL);
    expect(acceptBody.data.role).toBe('manager');
    expect(acceptBody.data.orgId).toBe(orgId);

    // 4) GraphStore 实证: 绑定而非新建（userId 不变，orgId/role 已更新，default 组织移除）
    const bound = userStore.queryByEmail(PERSONAL_EMAIL);
    expect(bound).not.toBeNull();
    expect(bound?.userId).toBe(personalUserId);
    expect(bound?.orgId).toBe(orgId);
    expect(bound?.role).toBe('manager');
    expect(userStore.listByOrg(orgId).some(u => u.userId === personalUserId)).toBe(true);
    expect(userStore.listByOrg('default').some(u => u.userId === personalUserId)).toBe(false);

    // 5) 密码延续实证: 原密码可登录，登录身份已是企业（payload.orgId/role 更新）
    const relogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: PERSONAL_EMAIL, password: PERSONAL_PASSWORD }),
    });
    expect(relogin.status).toBe(200);
    const reloginBody = await relogin.json() as { ok: boolean; payload: { userId: string; role: string; orgId: string } };
    expect(reloginBody.ok).toBe(true);
    expect(reloginBody.payload.userId).toBe(personalUserId);
    expect(reloginBody.payload.role).toBe('manager');
    expect(reloginBody.payload.orgId).toBe(orgId);

    // 6) 安全边界: 错误密码 accept → 401 + 邀请不消耗（仍 pending 可重试）
    const invite2 = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: PERSONAL_EMAIL, role: 'staff' }),
    });
    expect(invite2.status).toBe(200);
    const invite2Body = await invite2.json() as { data: { token: string } };
    const retryToken = invite2Body.data.token;

    const wrongPass = await fetch(`${baseUrl}/api/enterprise/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: retryToken, password: 'd485-wrong-password' }),
    });
    expect(wrongPass.status).toBe(401);
    const wrongPassBody = await wrongPass.json() as { code: string };
    expect(wrongPassBody.code).toBe('AUTH_FAILED');

    // 邀请未被消耗: 同 token 仍 pending（GET 200 而非 400 INVITATION_USED）
    const pendingQuery = await fetch(`${baseUrl}/api/enterprise/invitation/${retryToken}`);
    expect(pendingQuery.status).toBe(200);
  });

  it('⑧ 新 email accept → 新建账号 + linked=false（现状回归，与⑦绑定路径对照）', async () => {
    const invite = await fetch(`${baseUrl}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: FRESH_EMAIL, role: 'staff' }),
    });
    expect(invite.status).toBe(200);
    const inviteBody = await invite.json() as { data: { token: string } };

    const accept = await fetch(`${baseUrl}/api/enterprise/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteBody.data.token, password: FRESH_PASSWORD }),
    });
    expect(accept.status).toBe(200);
    const acceptBody = await accept.json() as { ok: boolean; data: { userId: string; email: string; role: string; orgId: string; linked: boolean } };
    expect(acceptBody.ok).toBe(true);
    expect(acceptBody.data.linked).toBe(false); // 新建语义显式区分
    expect(acceptBody.data.email).toBe(FRESH_EMAIL);
    expect(acceptBody.data.role).toBe('staff');
    expect(acceptBody.data.orgId).toBe(orgId);
    expect(acceptBody.data.userId).toBeTruthy();

    const created = userStore.queryByEmail(FRESH_EMAIL);
    expect(created).not.toBeNull();
    expect(created?.userId).toBe(acceptBody.data.userId);
    expect(created?.orgId).toBe(orgId);
    expect(created?.passwordHash).not.toBe(FRESH_PASSWORD);
    expect(created?.passwordHash.startsWith('$2')).toBe(true);
  });

  it('⑨ 未绑定个人账号调企业 members → 403（双轨边界不削弱: staff+default 不接企业系统）', async () => {
    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LONER_EMAIL, password: LONER_PASSWORD }),
    });
    expect(register.status).toBe(201);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LONER_EMAIL, password: LONER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const loginBody = await login.json() as { ok: boolean; token: string; payload: { role: string; orgId: string } };
    expect(loginBody.ok).toBe(true);
    expect(loginBody.payload.role).toBe('staff');
    expect(loginBody.payload.orgId).toBe('default');

    const members = await fetch(`${baseUrl}/api/enterprise/members`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    expect(members.status).toBe(403);
    const membersBody = await members.json() as { code: string };
    expect(membersBody.code).toBe('FORBIDDEN');
  });
});

// ════════════════════════════════════════════════════════════════
// D702 — accept 绑定写失败不吞错（K3 W-2）
// 独立 app + 失败注入 store（updateNode 可抛错，镜像真实 SqliteGraphStore 语义）。
// 本 describe 声明在文件末尾——重注入 setUserStore 不影响上方 D484/D485 用例。
// RED 契约: 修复前 accept 绑定持久化失败仍 200 linked:true → 断言失败（red 留痕）。
// ════════════════════════════════════════════════════════════════

class D702FailInjectGraphStore extends InMemoryGraphStore {
  failNextUpdate = false;
  updateNode(id: string, props: Record<string, unknown>, graph: string): void {
    if (this.failNextUpdate) throw new Error('injected persistence failure (D702)');
    super.updateNode(id, props, graph);
  }
}

describe('D702 — accept 绑定写失败不吞错（K3 W-2）', () => {
  const P_OK_EMAIL = 'd702-bind-ok@synova.test';
  const P_OK_PASSWORD = 'd702-bind-ok-pass';
  const P_FAIL_EMAIL = 'd702-bind-fail@synova.test';
  const P_FAIL_PASSWORD = 'd702-bind-fail-pass';

  let d702Server: Server;
  let d702Base: string;
  let d702Store: UserStore;
  let d702Graph: D702FailInjectGraphStore;

  beforeAll(async () => {
    d702Graph = new D702FailInjectGraphStore();
    d702Store = new UserStore(d702Graph);
    authSetUserStore(d702Store);
    entSetUserStore(d702Store);

    const app = express();
    app.use(express.json());
    app.use(jwtAuthMiddleware);
    app.use(authRoutes);
    app.use(enterpriseRoutes);

    await new Promise<void>((resolve) => {
      d702Server = app.listen(0, () => {
        const addr = d702Server.address();
        d702Base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 3098}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => d702Server.close(() => resolve()));
  });

  it('正常绑定路径 → 200 linked:true + orgId/role 真实更新（写成功必须可见）', async () => {
    const register = await fetch(`${d702Base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: P_OK_EMAIL, password: P_OK_PASSWORD }),
    });
    expect(register.status).toBe(201);

    const invite = await fetch(`${d702Base}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: P_OK_EMAIL, role: 'manager' }),
    });
    expect(invite.status).toBe(200);
    const inviteBody = await invite.json() as { data: { token: string } };

    const accept = await fetch(`${d702Base}/api/enterprise/invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteBody.data.token, password: P_OK_PASSWORD }),
    });
    expect(accept.status).toBe(200);
    const acceptBody = await accept.json() as { ok: boolean; data: { linked: boolean; orgId: string; role: string } };
    expect(acceptBody.ok).toBe(true);
    expect(acceptBody.data.linked).toBe(true);
    expect(acceptBody.data.orgId).toBe(orgId);
    expect(acceptBody.data.role).toBe('manager');

    // 持久化实证: 绑定写操作真实落库（orgId 从 default → 企业 orgId）
    const bound = d702Store.queryByEmail(P_OK_EMAIL);
    expect(bound?.orgId).toBe(orgId);
    expect(bound?.role).toBe('manager');
  });

  it('绑定 updateUser 持久化失败 → 500 {ok:false,degraded:true}，不返 linked:true，邀请不消耗，orgId 不变', async () => {
    const register = await fetch(`${d702Base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: P_FAIL_EMAIL, password: P_FAIL_PASSWORD }),
    });
    expect(register.status).toBe(201);

    const invite = await fetch(`${d702Base}/api/enterprise/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: P_FAIL_EMAIL, role: 'staff' }),
    });
    expect(invite.status).toBe(200);
    const inviteBody = await invite.json() as { data: { token: string } };
    const failToken = inviteBody.data.token;

    // 注入持久化失败（updateNode 抛错——与真实 SqliteGraphStore 失败语义同型）
    d702Graph.failNextUpdate = true;
    let acceptRes: Response;
    try {
      acceptRes = await fetch(`${d702Base}/api/enterprise/invitation/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: failToken, password: P_FAIL_PASSWORD }),
      });
    } finally {
      d702Graph.failNextUpdate = false;
    }

    // 核心断言（K3 W-2）: 失败不得假报成功
    expect(acceptRes.status).toBe(500);
    const acceptBody = await acceptRes.json() as { ok: boolean; degraded?: boolean; code?: string; data?: { linked?: boolean } };
    expect(acceptBody.ok).toBe(false);
    expect(acceptBody.degraded).toBe(true);
    expect(acceptBody.data?.linked).toBeUndefined();

    // 降级语义: 邀请保持 pending（可重试），orgId 绑定未发生
    const pendingQuery = await fetch(`${d702Base}/api/enterprise/invitation/${failToken}`);
    expect(pendingQuery.status).toBe(200);
    const bound = d702Store.queryByEmail(P_FAIL_EMAIL);
    expect(bound?.orgId).toBe('default');
    expect(bound?.role).toBe('staff');
  });
});
