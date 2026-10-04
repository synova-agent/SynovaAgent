/**
 * tests/security/request-context-failclosed.test.ts — D1153 / #984（施工单 0-10）**判据件**
 *
 * ⚠️ 性质声明（必读，防误读 —— 本线刚因「判据分辨不出改前/改后」被拒收一张卡）:
 *   本文件是**不变量回归锁（invariant regression lock）**，
 *   **不是**「0-10 已实现」的证明。
 *   0-10 的实现（`services/request-context.ts` 的 deny-all 兜底）**已于 D947 落地**
 *   （`getCurrentFilterClause` 的 `!ctx?.user || !ctx?.authProvider` 分支返回非空
 *   拒绝型条件集）。本卡的 Q2 明确规定「不改 `src/services/request-context.ts`
 *   的逻辑零改动」⇒ 本文件在 `main` 上**应当已经全绿**：它锁住既有不变量，
 *   不新增任何生产能力。若它在改动前即为红，说明是**既有回归**，不是本卡引入。
 *
 * 既存覆盖（诚实标注，勿重复宣称首建）:
 *   `tests/routes/workspace-access-write-endpoint.test.ts:475-537`（L-21 组）已从
 *   **引擎级**验证同一不变量（真实 KnowledgeStore 下 deny-all ⇒ results.length===0）。
 *   本文件的**新增增量**只有三处: ①哨兵字段/取值/算子三元的显式钉死
 *   ②provider 条件的**原样透传**（对象同一性 `toBe`，证明不吞不改写不复制）
 *   ③`RBAC_DENIED` 留痕在两种上下文缺失形态下都可断言。
 *
 * 判别性（改坏即红，已实测）:
 *   把 deny-all 的返回改成 `{ conditions: [] }` ⇒ 本文件必红。
 *   空条件集 = `l4/knowledge-store.ts:335` 短路「完全跳过过滤」= **fail-open**，
 *   故本文件存在的意义是把「不得返回空条件集」变成可执行判据。
 *
 * 铁律 48: 每条用例均有 expect() 断言；覆盖拒绝路径 / 正常路径 / 边界三路径。
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * 捕获拒绝留痕。P5 的「被拒绝」态必须是**可执行断言**而非 grep 型静态判据
 * ⇒ 拦截 logger 工厂并断言日志标记（同 `tests/middleware/rbac-default-deny.test.ts:25-41` 判据）。
 */
const logCapture = vi.hoisted(() => {
  const calls: Array<{ level: string; meta?: { code?: string; reason?: string } }> = [];
  return { calls };
});

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: { code?: string; reason?: string }) => {
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
  getCurrentFilterClause,
  getCurrentUser,
  getCurrentAuthProvider,
  runWithContext,
} from '../../src/services/request-context';

// ════════════════════════════════════════════════════════════════
// 契约常量（与本文件断言的唯一真源同名同值；改实现即红）
// ════════════════════════════════════════════════════════════════

const DENY_ALL_FIELD = '__d947_no_authenticated_context';
const DENY_ALL_SENTINEL = '__d947_deny_all__';

/** 取基线之后的日志标记（logCapture 文件级累积，故按位置切片） */
function codesSince(mark: number): string[] {
  return logCapture.calls
    .slice(mark)
    .map(c => c.meta?.code)
    .filter((c): c is string => typeof c === 'string');
}

/** 合法用户上下文（形态与 `jwtAuthMiddleware` 注入的 UserContext 一致，auth.ts:424-440） */
function userFixture(userId = 'u-staff-1') {
  return {
    userId,
    identity: { openId: userId, email: `${userId}@org-d947`, name: userId, source: 'jwt' },
    auth: { roles: ['staff'], teamId: 'org-d947', tenantId: 'org-d947', sensitivity: 'normal' },
    permissions: { version: 1, expiresAt: Date.now() + 3_600_000 },
  };
}

// ════════════════════════════════════════════════════════════════
// 1. 无请求上下文 ⇒ 非空 deny-all（fail-closed 起点）
// ════════════════════════════════════════════════════════════════

describe('0-10 · 漏斗兜底（getCurrentFilterClause）fail-closed 不变量回归锁', () => {
  it('无上下文 ⇒ conditions 非空（空集 = knowledge-store.ts:335 短路 = fail-open）', async () => {
    // 注意: 本用例在 AsyncLocalStorage 上下文之外调用 ⇒ 走兜底分支
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    expect(Array.isArray(filter.conditions)).toBe(true);
    expect(filter.conditions.length).toBeGreaterThan(0);
  });

  it('无上下文 ⇒ 条件集是**钉死的**拒绝型三元组（字段名不存在于任何权限列）', async () => {
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    expect(filter.conditions).toEqual([
      { field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL },
    ]);
    // 逐元断言（防「条件集非空但形状被改写成放行型」的假绿）
    for (const cond of filter.conditions) {
      expect(cond.field).toBe(DENY_ALL_FIELD);
      expect(cond.operator).toBe('EQ');
      expect(cond.value).toBe(DENY_ALL_SENTINEL);
    }
  });

  it('无上下文 ⇒ 与 resourceType 无关（边界: 多资源类型一律拒绝）', async () => {
    for (const resourceType of ['KnowledgeChunk', 'KnowledgeDocument', 'unknown-resource', '']) {
      const filter = await getCurrentFilterClause(resourceType);
      expect({ resourceType, n: filter.conditions.length > 0 })
        .toEqual({ resourceType, n: true });
    }
  });

  it('无上下文 ⇒ 留痕 RBAC_DENIED + reason=no_request_context（P5「被拒绝」态可断言）', async () => {
    const mark = logCapture.calls.length;
    await getCurrentFilterClause('KnowledgeChunk');
    const warns = logCapture.calls.slice(mark).filter(c => c.level === 'warn');
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns.some(c => c.meta?.code === 'RBAC_DENIED')).toBe(true);
    expect(warns.some(c => c.meta?.reason === 'no_request_context')).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════
  // 2. 有 user、无 authProvider ⇒ 同上（两种缺失形态同判，边界）
  // ══════════════════════════════════════════════════════════════

  it('有 user、无 authProvider ⇒ 同样非空 deny-all + RBAC_DENIED', async () => {
    const mark = logCapture.calls.length;
    const filter = await runWithContext({ user: userFixture() }, async () =>
      getCurrentFilterClause('KnowledgeChunk'));

    expect(filter.conditions).toEqual([
      { field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL },
    ]);
    expect(codesSince(mark)).toContain('RBAC_DENIED');
  });

  it('有 user、无 authProvider ⇒ 上下文确实已建立（非「没跑进 runWithContext」的假绿）', async () => {
    await runWithContext({ user: userFixture('u-ctx-proof') }, async () => {
      // 若此处 user 为 undefined，则上一条用例的拒绝来自「无 user」而非「无 provider」——
      // 判据会失去分辨力。此断言把两种缺失形态真正区分开。
      expect(getCurrentUser()?.userId).toBe('u-ctx-proof');
      expect(getCurrentAuthProvider()).toBeUndefined();
      const filter = await getCurrentFilterClause('KnowledgeChunk');
      expect(filter.conditions.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 3. 有 user、有 authProvider ⇒ **原样透传**（不吞、不改写、不复制）
  // ══════════════════════════════════════════════════════════════

  it('有 user、有 authProvider ⇒ 返回 provider 的条件对象本体（toBe 同一性）且零附加日志', async () => {
    const mark = logCapture.calls.length;
    const provided = {
      conditions: [
        { field: 'access.sensitivity', operator: 'IN' as const, value: ['normal'] },
        { field: 'tenant.id', operator: 'EQ' as const, value: 'org-d947' },
      ],
    };
    const provider = { getPermissionFilter: async () => provided };

    const filter = await runWithContext({ user: userFixture(), authProvider: provider }, async () =>
      getCurrentFilterClause('KnowledgeChunk'));

    // 对象同一性: 证明未复制/未改写/未包装（改写成安全副本亦会让此断言红）
    expect(filter).toBe(provided);
    expect(filter.conditions).toEqual(provided.conditions);
    expect(filter).not.toEqual({ conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] });
    // 正常路径零拒绝留痕（拒绝不是一刀切）
    expect(codesSince(mark).filter(c => c === 'RBAC_DENIED')).toEqual([]);
  });

  it('有 user、有 authProvider ⇒ provider 收到的 resourceType 与 action 契约不变（首参透传）', async () => {
    const seen: Array<{ resourceType: string; action: string; userId: string }> = [];
    const provider = {
      getPermissionFilter: async (
        ctx: { userId: string },
        resourceType: string,
        action: string,
      ) => {
        seen.push({ resourceType, action, userId: ctx.userId });
        return { conditions: [{ field: 'access.sensitivity', operator: 'IN' as const, value: ['normal'] }] };
      },
    };

    await runWithContext({ user: userFixture('u-args'), authProvider: provider }, async () =>
      getCurrentFilterClause('KnowledgeChunk'));

    expect(seen).toEqual([{ resourceType: 'KnowledgeChunk', action: 'read', userId: 'u-args' }]);
  });

  // ══════════════════════════════════════════════════════════════
  // 4. 信任边界（已知残留，本卡不改 —— 登记，不宣称已修）
  // ══════════════════════════════════════════════════════════════

  it('信任边界: provider 自身返回空条件集时**原样透传**（漏斗只在上下文缺失时 fail-closed）', async () => {
    // 本用例钉的是「不吞不改写」契约本身：漏斗**不**替 provider 兜底。
    // 残留风险（不属本卡射程，仅登记）: provider 若返回空集，过滤在
    //   l4/knowledge-store.ts:335 短路 ⇒ 该路径 fail-open。
    //   修点在 provider 侧（auth.ts:450-458 的 getPermissionFilter），
    //   而 auth.ts 属 #1011 写集 ⇒ 本卡零改动（见卡 §写集硬豁免）。
    const empty = { conditions: [] as Array<{ field: string; operator: 'IN' | 'EQ' | 'NOT_EQ' | 'CONTAINS'; value: unknown }> };
    const provider = { getPermissionFilter: async () => empty };

    const filter = await runWithContext({ user: userFixture(), authProvider: provider }, async () =>
      getCurrentFilterClause('KnowledgeChunk'));

    expect(filter).toBe(empty);
    expect(filter.conditions).toEqual([]);
  });
});
