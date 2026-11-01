/**
 * tests/routes/admin-knowledge.test.ts — D241 知识审批 + D244 联邦知识 API 测试
 *
 * 覆盖（D391，dev doc §7.1 T1-T8）:
 *   T1 路由可导入 + server 挂载（保留，不回归）
 *   T2 路由注册完整性（8 路径/方法，audit.test.ts stack 遍历模式）
 *   T3 API 行为：pending 注入 mock → 200
 *   T4 API 行为：approve/reject 注入 mock → 200 + 调用参数断言
 *   T5 M3 兜底：不注入 + getDatabase throw → 500 degraded（不再 503，铁律 24/31）
 *   T6 federated 兜底：注入 mock → 200/201；不注入 → ??= 惰性单例 → 写后读回可见（D402，K3 P1-1）
 *   T7 接线（wire check）：getStore()/getPipeline() 生产调用计数 + 无 '../l4' import + 无 'not ready' 残留
 * (KnowledgeStore 内部方法测试在 tests/l4/knowledge-store-approval.test.ts)
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/init/engine-context';
import type { KnowledgeStore } from '../../src/agent/knowledge-bridge-service';
import type { FederatedPipeline } from '../../src/services/federated-pipeline';

// D402: 惰性单例构造计数（getPipeline/getStore 同实例物理证明——构造次数 = 1）
const ctorCount = vi.hoisted(() => ({ pipeline: 0, store: 0 }));

// T5 确定性降级路径：getDatabase 模拟未初始化（不依赖测试顺序/全局 db 状态）
// D402: 改为 vi.fn 实现 → 单例测试可用 vi.mocked(getDatabase).mockReturnValue(内存 DB) 覆盖
vi.mock('../../src/init/engine-context', () => ({
  getDatabase: vi.fn(() => {
    throw new Error('db not init');
  }),
}));

// D402: FederatedPipeline 构造计数（写后读回同实例证明）——子类保持全部真实行为
vi.mock('../../src/services/federated-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/federated-pipeline')>();
  const Orig = actual.FederatedPipeline;
  class CountingFederatedPipeline extends Orig {
    constructor(...args: ConstructorParameters<typeof Orig>) {
      super(...args);
      ctorCount.pipeline += 1;
    }
  }
  return { ...actual, FederatedPipeline: CountingFederatedPipeline };
});

// D402: KnowledgeStore 构造计数（getStore 惰性单例证明）——子类保持全部真实行为
// D603 适配: 路由构造点已下沉 L2 createSystemKnowledgeStore()（源内不再 new）——
// 计数 mock 同步包住 L2 工厂，T5b「构造仅 1 次」断言语义不变。
vi.mock('../../src/agent/knowledge-bridge-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agent/knowledge-bridge-service')>();
  const Orig = actual.KnowledgeStore;
  const { getDatabase: getDb } = await import('../../src/init/engine-context');
  class CountingKnowledgeStore extends Orig {
    constructor(...args: ConstructorParameters<typeof Orig>) {
      super(...args);
      ctorCount.store += 1;
    }
  }
  return {
    ...actual,
    KnowledgeStore: CountingKnowledgeStore,
    createSystemKnowledgeStore: () => new CountingKnowledgeStore(getDb()),
  };
});

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

/** 每个用例独立模块实例 — 隔离模块级 knowledgeStore/federatedPipeline 状态 */
async function loadMod() {
  vi.resetModules();
  return await import('../../src/routes/admin-knowledge');
}

function findHandler(router: RouterLike, path: string, method: 'get' | 'post') {
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer?.route) throw new Error(`route not registered: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

describe('D241 Admin Knowledge Routes', () => {
  it('T1a admin-knowledge router 可导入', async () => {
    const mod = await import('../../src/routes/admin-knowledge');
    expect(mod.default).toBeDefined();
    expect(typeof mod.setKnowledgeStore).toBe('function');
    expect(typeof mod.setFederatedPipeline).toBe('function');
  });

  it('T1b server.ts 已挂载 admin-knowledge 路由', async () => {
    const fs = await import('fs');
    const server = fs.readFileSync('src/server.ts', 'utf-8');
    expect(server).toContain('admin-knowledge');
    expect(server).toContain('adminKnowledgeRoutes');
  });
});

describe('T2 路由注册完整性', () => {
  const expected: Array<[string, 'get' | 'post']> = [
    ['/api/admin/knowledge/pending', 'get'],
    ['/api/admin/knowledge/:id/approve', 'post'],
    ['/api/admin/knowledge/:id/reject', 'post'],
    ['/api/admin/knowledge/:id/mark-shareable', 'post'],
    ['/api/admin/knowledge/federated/pending', 'get'],
    ['/api/admin/knowledge/federated/:id/approve', 'post'],
    ['/api/admin/knowledge/federated/degraded', 'get'],
    ['/api/admin/knowledge/federated/ga-weight-drop', 'post'],
  ];

  it('Router stack 至少 7 个路由', async () => {
    const mod = await loadMod();
    const count = (mod.default as unknown as RouterLike).stack.filter((l) => l.route).length;
    expect(count).toBeGreaterThanOrEqual(7);
  });

  it.each(expected)('已注册 %s %s', async (path, method) => {
    const mod = await loadMod();
    const layer = (mod.default as unknown as RouterLike).stack.find(
      (l) => l.route?.path === path && l.route?.methods?.[method],
    );
    expect(layer).toBeTruthy();
  });
});

describe('T3/T4 API 行为 — 注入 mock 正常路径', () => {
  it('T3 GET pending 注入 mock → 200 + 数据形状', async () => {
    const mod = await loadMod();
    const store = {
      listPendingPkb: vi.fn().mockReturnValue([{ id: 'k1', snippet: 's' }]),
    } as unknown as KnowledgeStore;
    mod.setKnowledgeStore(store);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/pending', 'get');
    const res = makeRes();
    handler({ headers: {} }, res);

    expect(store.listPendingPkb).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: [{ id: 'k1', snippet: 's' }], count: 1 });
    expect(res.status).not.toHaveBeenCalledWith(503);
  });

  it('T3b 空 pending 列表 → 200 count 0（边界）', async () => {
    const mod = await loadMod();
    mod.setKnowledgeStore({ listPendingPkb: vi.fn().mockReturnValue([]) } as unknown as KnowledgeStore);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/pending', 'get');
    const res = makeRes();
    handler({ headers: {} }, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, data: [], count: 0 });
  });

  it('T4 POST approve 注入 mock → 200 + 调用参数断言', async () => {
    const mod = await loadMod();
    const approvePkb = vi.fn();
    mod.setKnowledgeStore({ approvePkb } as unknown as KnowledgeStore);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/approve', 'post');
    const res = makeRes();
    handler({ params: { id: 'k1' }, headers: { 'x-user-id': 'tester' }, body: {} }, res);

    expect(approvePkb).toHaveBeenCalledWith('k1', 'tester');
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { id: 'k1', status: 'approved' } });
  });

  it('T4b POST reject 注入 mock → 200 + 默认审批人/原因（边界）', async () => {
    const mod = await loadMod();
    const rejectPkb = vi.fn();
    mod.setKnowledgeStore({ rejectPkb } as unknown as KnowledgeStore);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/reject', 'post');
    const res = makeRes();
    handler({ params: { id: 'k2' }, headers: {}, body: {} }, res);

    expect(rejectPkb).toHaveBeenCalledWith('k2', 'admin', 'No reason provided');
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { id: 'k2', status: 'rejected', reason: 'No reason provided' } });
  });
});

describe('T5 M3 兜底 — 不注入 + DB 未初始化 → 500 degraded（不再 503）', () => {
  it('GET pending 不注入 → getDatabase throw → 500 + degraded:true', async () => {
    const mod = await loadMod(); // 不调 setKnowledgeStore
    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/pending', 'get');
    const res = makeRes();
    handler({ headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.status).not.toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, degraded: true }),
    );
  });

  it('POST approve 不注入 → 500 + degraded:true（同款兜底覆盖）', async () => {
    const mod = await loadMod();
    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/approve', 'post');
    const res = makeRes();
    handler({ params: { id: 'k9' }, headers: {}, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.status).not.toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, degraded: true }),
    );
  });

  it('T5b getStore 惰性单例: DB 可用 → 连续 2 次 handler 共用同一实例（构造仅 1 次，P2-2）', async () => {
    ctorCount.store = 0;
    const db = new Database(':memory:');
    vi.mocked(getDatabase).mockReturnValue(db);
    try {
      const mod = await loadMod(); // 不调 setKnowledgeStore → 走 ??= 惰性单例
      const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/pending', 'get');

      const res1 = makeRes();
      handler({ headers: {} }, res1);
      expect(res1.json).toHaveBeenCalledWith({ ok: true, data: [], count: 0 });

      const res2 = makeRes();
      handler({ headers: {} }, res2);
      expect(res2.json).toHaveBeenCalledWith({ ok: true, data: [], count: 0 });

      expect(ctorCount.store).toBe(1); // 两次 handler 仅构造 1 次 → 惰性单例（旧实现为 2 次 new）
    } finally {
      db.close();
      vi.mocked(getDatabase).mockImplementation(() => {
        throw new Error('db not init');
      });
    }
  });

  it('T5c getStore 降级不缓存: DB 未初始化 → 连续 2 次都 500 degraded（??= 不缓存失败，下次重试）', async () => {
    ctorCount.store = 0;
    const mod = await loadMod(); // getDatabase 默认 throw（未初始化）
    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/pending', 'get');

    const res1 = makeRes();
    handler({ headers: {} }, res1);
    expect(res1.status).toHaveBeenCalledWith(500);
    expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, degraded: true }));

    const res2 = makeRes();
    handler({ headers: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(500);
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, degraded: true }));

    expect(ctorCount.store).toBe(0); // getDatabase throw 于构造前 → ??= 不完成赋值 → 不缓存
  });
});

describe('T6 federated 兜底 — 注入/不注入均可用（不再 503）', () => {
  it('T6a GET federated/pending 注入 mock → 200 合并两状态列表', async () => {
    const mod = await loadMod();
    const listByStatus = vi.fn().mockReturnValue([{ id: 'f1' }]);
    mod.setFederatedPipeline({ listByStatus } as unknown as FederatedPipeline);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/federated/pending', 'get');
    const res = makeRes();
    handler({ headers: {} }, res);

    expect(listByStatus).toHaveBeenCalledWith('pending_admin');
    expect(listByStatus).toHaveBeenCalledWith('pending_ga');
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: [{ id: 'f1' }, { id: 'f1' }], count: 2 });
  });

  it('T6b federated 写后读回: mark-shareable 201 → federated/pending 读回该条目（惰性单例，K3 P1-1 闭合）', async () => {
    ctorCount.pipeline = 0;
    const mod = await loadMod(); // 不调 setFederatedPipeline → 走 ??= 惰性单例
    const post = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/mark-shareable', 'post');
    const get = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/federated/pending', 'get');

    const resPost = makeRes();
    post({ params: { id: 'k1' }, headers: {}, auth: { orgId: 'org1' }, body: { text: 'hello', orgId: 'org1' } }, resPost);
    expect(resPost.status).toHaveBeenCalledWith(201); // 写入成功（不再假性成功）

    const resGet = makeRes();
    get({ headers: {} }, resGet);
    const payload = resGet.json.mock.calls[0][0] as { ok: boolean; data: Array<{ sourceChunkId: string }>; count: number };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(1); // 写后读回可见（旧实现：读全新实例 → 恒空）
    expect(payload.data[0].sourceChunkId).toBe('k1');
    expect(ctorCount.pipeline).toBe(1); // 写入与读回共用同一实例 → 仅构造 1 次
  });

  it('T6b2 惰性单例: 连续 4 次 handler 共用同一实例（状态累积，构造仅 1 次）', async () => {
    ctorCount.pipeline = 0;
    const mod = await loadMod();
    const post = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/mark-shareable', 'post');
    const get = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/federated/pending', 'get');

    post({ params: { id: 'k1' }, headers: {}, auth: { orgId: 'org1' }, body: { text: 'a', orgId: 'org1' } }, makeRes());
    post({ params: { id: 'k2' }, headers: {}, auth: { orgId: 'org1' }, body: { text: 'b', orgId: 'org1' } }, makeRes());

    const resGet = makeRes();
    get({ headers: {} }, resGet);
    const payload = resGet.json.mock.calls[0][0] as { data: Array<{ sourceChunkId: string }>; count: number };
    expect(payload.count).toBe(2); // 两次写入都在同一实例中累积
    expect(payload.data.map((e) => e.sourceChunkId).sort()).toEqual(['k1', 'k2']);
    expect(ctorCount.pipeline).toBe(1); // 4 次 getPipeline 调用仅构造 1 次 → 同实例（===）
  });

  it('T6c POST mark-shareable 注入 mock → 201', async () => {
    const mod = await loadMod();
    const markShareable = vi.fn().mockReturnValue({ id: 'fed-1', status: 'pending_admin' });
    mod.setFederatedPipeline({ markShareable } as unknown as FederatedPipeline);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/mark-shareable', 'post');
    const res = makeRes();
    handler({ params: { id: 'k1' }, headers: {}, auth: { orgId: 'org1' }, body: { text: 'hello', orgId: 'org1' } }, res);

    expect(markShareable).toHaveBeenCalledWith('k1', 'hello', 'org1');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('T6d POST mark-shareable 缺 text/orgId → 400 VALIDATION_ERROR（校验不回归）', async () => {
    const mod = await loadMod();
    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/:id/mark-shareable', 'post');
    const res = makeRes();
    handler({ params: { id: 'k1' }, headers: {}, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'VALIDATION_ERROR' }),
    );
  });

  it('T6e POST ga-weight-drop 注入 mock → 200 + 缺 gaUserId 400（边界）', async () => {
    const mod = await loadMod();
    const checkGaWeightDrop = vi.fn().mockReturnValue(3);
    mod.setFederatedPipeline({ checkGaWeightDrop } as unknown as FederatedPipeline);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/federated/ga-weight-drop', 'post');
    const res = makeRes();
    handler({ params: {}, headers: {}, body: { gaUserId: 'ga-7' } }, res);
    expect(checkGaWeightDrop).toHaveBeenCalledWith('ga-7');
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { gaUserId: 'ga-7', affectedEntries: 3 } });

    const res2 = makeRes();
    handler({ params: {}, headers: {}, body: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it('T6f 注入优先: setFederatedPipeline mock → 注入实例被用（不走 ??=，不构造）', async () => {
    ctorCount.pipeline = 0;
    const mod = await loadMod();
    const injected = {
      listByStatus: vi.fn().mockReturnValue([{ id: 'inj-1', sourceChunkId: 'inj' }]),
    } as unknown as FederatedPipeline;
    mod.setFederatedPipeline(injected);

    const handler = findHandler(mod.default as unknown as RouterLike, '/api/admin/knowledge/federated/pending', 'get');
    const res = makeRes();
    handler({ headers: {} }, res);

    expect(injected.listByStatus).toHaveBeenCalledWith('pending_admin');
    expect(injected.listByStatus).toHaveBeenCalledWith('pending_ga');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      data: [{ id: 'inj-1', sourceChunkId: 'inj' }, { id: 'inj-1', sourceChunkId: 'inj' }],
      count: 2,
    });
    expect(ctorCount.pipeline).toBe(0); // 注入优先 → ??= 不触发构造
  });
});

describe('T7 接线（wire check）— grep 物理断言', () => {
  it('getStore()/getPipeline() 被生产 handler 调用 + 无跨层 import + 无 503 守卫残留', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/routes/admin-knowledge.ts', 'utf-8');

    expect(src).not.toContain("from '../l4");
    expect(src).toContain("from '../agent/knowledge-bridge-service'");
    expect(src).not.toContain('not ready');

    // getStore: pending/approve/reject ≥3 个 handler 调用；getPipeline: ≥5 个 handler 调用（dev doc §8）
    expect((src.match(/getStore\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((src.match(/getPipeline\(\)/g) || []).length).toBeGreaterThanOrEqual(5);

    // D402: 惰性单例物理断言 — ??= 存在且无每请求 new 残留（K3 P1-1 防回归）
    expect(src).toContain('federatedPipeline ??=');
    expect(src).toContain('knowledgeStore ??=');
    expect(src).not.toMatch(/\?\? new (FederatedPipeline|KnowledgeStore)/);
  });
});
