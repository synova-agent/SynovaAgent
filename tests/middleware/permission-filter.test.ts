/**
 * tests/middleware/permission-filter.test.ts — D947 PR-1 / P2 夹具（新建）
 *
 * 主题: 权限过滤唯一漏斗（src/middleware/auth.ts getPermissionFilter）不再恒返空条件集。
 *
 *   修复前: 恒返空条件集 ⇒ l4/knowledge-store.ts:335 短路
 *           （该行注释自述 "admin: 无过滤"，但短路**无条件**生效）⇒ 知识检索完全不过滤（fail-open）。
 *   修复后: 条件由**验签身份**派生（role × clearance）⇒ 敏感度越权块被真实过滤。
 *
 * 判别性（改回空条件集即红）: 本夹具不止断言数组形状，而是把漏斗产出的 FilterClause
 * 喂进**真实 KnowledgeStore + 真实 matchFilter 引擎**，验证条件确实「被执行」：
 *   · 漏斗改回空条件集 → 形状断言红（conditions 为空）
 *   · 且引擎断言红（restricted 块不再被过滤，filteredOut 归 0）
 *   —— 后者正是「接线了 ≠ 被执行」的判别性夹具。
 *
 * 铁律 48: 每条用例均有 expect 断言；覆盖正常路径 / 拒绝路径 / 边界。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { getCurrentAuthProvider, getCurrentUser } from '../../src/services/request-context';
import { KnowledgeStore, type FilterClause } from '../../src/l4/knowledge-store';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947）—— 夹具自证环境已就位，否则判空转
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});

function mockRes(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
  res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
  res.json = (body: unknown) => { res.body = body; return res as unknown as Response; };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

/**
 * 走真实中间件链，取回漏斗（authProvider.getPermissionFilter）产出的 FilterClause。
 *
 * 注意：`getCurrentAuthProvider()` 必须在 next() 的**同步执行期**调用，
 * 否则 AsyncLocalStorage 上下文已退出（这正是"context 可用性"的边界）。
 */
async function runMiddlewareAndCaptureFilter(role: string, orgId = 'org-1'): Promise<FilterClause> {
  const token = signJwtToken({ sub: `u-${role}`, role, orgId });
  expect(token).toBeTruthy();

  const req: Record<string, unknown> & { path: string; headers: Record<string, string>; auth?: unknown } = {
    path: '/api/knowledge/search',
    headers: { authorization: `Bearer ${token}` },
  };
  const res = mockRes();

  return new Promise<FilterClause>((resolve, reject) => {
    jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => {
      const provider = getCurrentAuthProvider();
      const user = getCurrentUser();
      if (!provider || !user) {
        reject(new Error('request-context 未建立：runWithContext 未生效'));
        return;
      }
      provider
        .getPermissionFilter(user, 'KnowledgeChunk', 'read')
        .then(f => resolve(f as unknown as FilterClause))
        .catch(reject);
    });
  });
}

/** 建一个真实内存库并播两种敏感度的块（其余标签一致，隔离单一变量） */
function seedStore(): { db: Database.Database; store: KnowledgeStore; close: () => void } {
  const db = new Database(':memory:');
  const store = new KnowledgeStore(db);
  return { db, store, close: () => db.close() };
}

describe('D947/P2 — 权限过滤唯一漏斗', () => {
  it('正常路径: staff 身份 → 条件非空且为最窄白名单 [normal]', async () => {
    const filter = await runMiddlewareAndCaptureFilter('staff');
    expect(filter.conditions.length).toBeGreaterThan(0);

    const cond = filter.conditions.find(c => c.field === 'access.sensitivity');
    expect(cond).toBeDefined();
    expect(cond?.operator).toBe('IN');
    expect(cond?.value).toEqual(['normal']);
  });

  it('P2: admin 身份 → 白名单放宽到全三级（证明确由身份派生，而非常量）', async () => {
    const filter = await runMiddlewareAndCaptureFilter('admin');
    const cond = filter.conditions.find(c => c.field === 'access.sensitivity');
    expect(cond).toBeDefined();
    expect(cond?.value).toEqual(['normal', 'sensitive', 'restricted']);
  });

  it('P2 边界: 非 admin 角色（含未识别角色名）白名单恒为 [normal]，不因未识别而放宽', async () => {
    for (const role of ['staff', 'manager', 'liaison', 'ga', 'unknown-role']) {
      const filter = await runMiddlewareAndCaptureFilter(role);
      const cond = filter.conditions.find(c => c.field === 'access.sensitivity');
      expect({ role, value: cond?.value }).toEqual({ role, value: ['normal'] });
      expect({ role, nonEmpty: filter.conditions.length > 0 }).toEqual({ role, nonEmpty: true });
    }
  });

  it('P2 判别性: 真实引擎下 restricted 块对 staff 被过滤（条件确实被执行）', async () => {
    const filter = await runMiddlewareAndCaptureFilter('staff');
    const { store, close } = seedStore();
    try {
      store.insert({
        text: 'alpha normal knowledge', sourceType: 'document', sourceId: 's1',
        authorityLevel: 'reference', accessLevel: 'public', accessSensitivity: 'normal',
      });
      store.insert({
        text: 'alpha restricted knowledge', sourceType: 'document', sourceId: 's2',
        authorityLevel: 'reference', accessLevel: 'public', accessSensitivity: 'restricted',
      });

      const { results, stats } = store.search('alpha', filter, 10);

      expect(stats.totalHits).toBe(2);        // 引擎确实检索到两行
      expect(stats.filteredOut).toBe(1);      // 其中越权一行被过滤（空条件集时此处为 0）
      expect(results.map(r => r.accessSensitivity)).toEqual(['normal']);
    } finally {
      close();
    }
  });

  it('P2 判别性对照: admin 身份下 restricted 块放行（过滤随身份变化，非一刀切）', async () => {
    const filter = await runMiddlewareAndCaptureFilter('admin');
    const { store, close } = seedStore();
    try {
      store.insert({
        text: 'beta normal knowledge', sourceType: 'document', sourceId: 's1',
        authorityLevel: 'reference', accessLevel: 'public', accessSensitivity: 'normal',
      });
      store.insert({
        text: 'beta restricted knowledge', sourceType: 'document', sourceId: 's2',
        authorityLevel: 'reference', accessLevel: 'public', accessSensitivity: 'restricted',
      });

      const { results, stats } = store.search('beta', filter, 10);

      expect(stats.totalHits).toBe(2);
      expect(stats.filteredOut).toBe(0);
      expect(results.length).toBe(2);
    } finally {
      close();
    }
  });

  it('拒绝路径: 自报 token（无验签）→ 401 且不建立过滤上下文（漏斗不可被自报喂入）', () => {
    const req: Record<string, unknown> & { path: string; headers: Record<string, string> } = {
      path: '/api/knowledge/search',
      headers: { 'x-synova-token': 'admin::x' },
    };
    const res = mockRes();
    let nextCalled = false;

    jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(getCurrentAuthProvider()).toBeUndefined();
  });
});
