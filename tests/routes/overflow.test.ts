/**
 * tests/routes/overflow.test.ts — D476 O7 overflow 路由隔离收紧测试
 *
 * 覆盖 6: ①无认证 401 ②auth.orgId 缺失 400 ORG_REQUIRED ③同租户透传 auth.orgId
 *         ④body 跨租户 403 ⑤快照未传 enterpriseId → auth.orgId 权威（无 default 回退）⑥路径参数跨租户 403
 * 约束: 零 as any（mock 注入 as unknown as）；vi.mock 属单元测试合法（铁律 12 集成测试才禁 mock）
 *
 * D947（L-7）: 本文件进入 PR-2 写集的归因 = **N1（夹具硬前置）**，不是 P0
 *   —— 本文件内的 `x-synova-token` 仅出现在注释与「显式不带头」的 mock 上（侦察 §R6-2），
 *   删自报通道不会打红本文件。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ════════════════════════════════════════════════════════════════
// D947 N1 硬前置 —— 夹具自证环境已就位，否则判空转（不算通过）
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});


vi.mock('../../src/cycles/cycle-registry', () => ({
  cycleRegistry: { get: vi.fn(), list: vi.fn() },
}));
vi.mock('../../src/cycles/overflow-dashboard', () => ({
  generateOverflowDashboard: vi.fn(() => ({ ok: true })),
}));
vi.mock('../../src/cycles/investment-advisor', () => ({
  simulateInvestment: vi.fn(() => ({ ok: true })),
}));
vi.mock('../../src/cycles/overflow-graph-bridge', () => ({
  getCycleSnapshots: vi.fn(() => []),
  getLatestSnapshot: vi.fn(() => null),
}));

import overflowRoutes, { setOverflowGraphStore } from '../../src/routes/overflow';

/** express Router stack 最小类型（避免 as any，铁律 38） */
interface RouteLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown) => void }>;
  };
}
interface RouterLike {
  stack: RouteLayer[];
}

interface MockRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function makeRes(): MockRes {
  const res: MockRes = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function findHandler(router: RouterLike, path: string, method: 'get' | 'post') {
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer?.route) throw new Error(`route not registered: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

/** 同代引用（P1-1）: mocked 模块与路由模块共享同一 vi.fn 实例 */
async function loadMocks() {
  const reg = await import('../../src/cycles/cycle-registry');
  const ovd = await import('../../src/cycles/overflow-dashboard');
  const inv = await import('../../src/cycles/investment-advisor');
  const bridge = await import('../../src/cycles/overflow-graph-bridge');
  return {
    cycleRegistry: reg.cycleRegistry as unknown as { get: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
    generateOverflowDashboard: ovd.generateOverflowDashboard as unknown as ReturnType<typeof vi.fn>,
    simulateInvestment: inv.simulateInvestment as unknown as ReturnType<typeof vi.fn>,
    getCycleSnapshots: bridge.getCycleSnapshots as unknown as ReturnType<typeof vi.fn>,
    getLatestSnapshot: bridge.getLatestSnapshot as unknown as ReturnType<typeof vi.fn>,
  };
}

/** 构造带 JWT auth 的 mock 请求（headers 无 x-synova-token，auth 走 JWT 注入路径） */
function makeAuth(orgId: string) {
  return { sub: 'u1', role: 'ga', orgId, iat: 1, exp: 9999999999, jti: 'j1' };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return { headers: {}, params: {}, query: {}, body: {}, ...overrides };
}

describe('D476 O7 — overflow 路由隔离收紧', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 每用例独立注入 graphStore（模块级状态；未注入 → 503）
    setOverflowGraphStore({} as unknown as import('../../src/l4/graph-bridge').GraphStore);
  });

  it('① simulate 无认证 → 401 UNAUTHORIZED（修复前放行）', async () => {
    const mocks = await loadMocks();
    mocks.cycleRegistry.get.mockReturnValue({ id: 'c1' });
    mocks.cycleRegistry.list.mockReturnValue([]);
    const handler = findHandler(overflowRoutes as unknown as RouterLike, '/api/overflow/simulate', 'post');
    const res = makeRes();
    handler(makeReq({ body: { cycleId: 'c1', amount: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    expect(mocks.simulateInvestment).not.toHaveBeenCalled();
  });

  it('② simulate auth.orgId 缺失 → 400 ORG_REQUIRED（修复前放行）', async () => {
    const mocks = await loadMocks();
    mocks.cycleRegistry.get.mockReturnValue({ id: 'c1' });
    mocks.cycleRegistry.list.mockReturnValue([]);
    const handler = findHandler(overflowRoutes as unknown as RouterLike, '/api/overflow/simulate', 'post');
    const res = makeRes();
    handler(makeReq({ auth: makeAuth(''), body: { cycleId: 'c1', amount: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORG_REQUIRED' }));
    expect(mocks.simulateInvestment).not.toHaveBeenCalled();
  });

  it('③ simulate 同租户（body 与 auth 一致）→ 业务透传 auth.orgId', async () => {
    const mocks = await loadMocks();
    mocks.cycleRegistry.get.mockReturnValue({ id: 'c1' });
    mocks.cycleRegistry.list.mockReturnValue([]);
    const handler = findHandler(overflowRoutes as unknown as RouterLike, '/api/overflow/simulate', 'post');
    const res = makeRes();
    handler(makeReq({ auth: makeAuth('org-a'), body: { cycleId: 'c1', amount: 100, enterpriseId: 'org-a' } }), res);
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(mocks.simulateInvestment).toHaveBeenCalledTimes(1);
    expect(mocks.simulateInvestment.mock.calls[0][0]).toBe('org-a');
  });

  it('④ simulate body.enterpriseId 跨租户 → 403 FORBIDDEN（修复前跨租户覆盖）', async () => {
    const mocks = await loadMocks();
    mocks.cycleRegistry.get.mockReturnValue({ id: 'c1' });
    mocks.cycleRegistry.list.mockReturnValue([]);
    const handler = findHandler(overflowRoutes as unknown as RouterLike, '/api/overflow/simulate', 'post');
    const res = makeRes();
    handler(makeReq({ auth: makeAuth('org-a'), body: { cycleId: 'c1', amount: 100, enterpriseId: 'org-b' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(mocks.simulateInvestment).not.toHaveBeenCalled();
  });

  it('⑤ snapshots 未传 enterpriseId → auth.orgId 权威（修复前落 default）', async () => {
    const mocks = await loadMocks();
    const handler = findHandler(overflowRoutes as unknown as RouterLike, '/api/overflow/snapshots/:cycleId', 'get');
    const res = makeRes();
    handler(makeReq({ auth: makeAuth('org-a'), params: { cycleId: 'c1' } }), res);
    expect(mocks.getCycleSnapshots).toHaveBeenCalledTimes(1);
    expect(mocks.getCycleSnapshots.mock.calls[0][0]).toBe('org-a');
    expect(mocks.getLatestSnapshot.mock.calls[0][0]).toBe('org-a');
  });

  it('⑥ dashboard 路径参数跨租户 → 403 FORBIDDEN（修复前放行）', async () => {
    const mocks = await loadMocks();
    const handler = findHandler(overflowRoutes as unknown as RouterLike, '/api/overflow/dashboard/:enterpriseId', 'get');
    const res = makeRes();
    handler(makeReq({ auth: makeAuth('org-a'), params: { enterpriseId: 'org-b' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(mocks.generateOverflowDashboard).not.toHaveBeenCalled();
  });
});
