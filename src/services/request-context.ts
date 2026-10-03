/**
 * services/request-context.ts — 请求级上下文 (M2 权限透传)
 *
 * 问题: KnowledgeAgent 工具执行时无法获取当前用户的 UserContext，
 *       导致 search_documents 无法生成 FilterClause，权限过滤失效。
 *
 * 方案: 使用 AsyncLocalStorage 存储请求级上下文。
 *       L1 (routes) 设置 → L3 (tools) 读取，不通过 LLM 参数传递。
 */
import { AsyncLocalStorage } from 'async_hooks';
import { createLogger } from '@synova/logger';

const log = createLogger('services/request-context');

// 内联类型 — 避免跨包 tsc 路径解析问题 (engine-auth 不在 tsc include 范围内)
// D947: `FilterClause.operator` 由 `string` 收窄为与 `l4/knowledge-store.FilterClause`
//   相同的字面量联合——两者必须**结构等价**，否则漏斗产出无法直接喂给
//   `KnowledgeStore.search()`（实际 L4 引擎），必须在调用点写断言=类型级漏斗失守。
interface UserContext { userId: string; identity: { openId: string; email: string; name: string; source: string }; auth: { roles: string[]; teamId: string; tenantId: string; sensitivity: string }; permissions: { version: number; expiresAt: number }; }
interface AuthProvider { getPermissionFilter(ctx: UserContext, resourceType: string, action: string): Promise<FilterClause>; }
interface FilterClause { conditions: Array<{ field: string; operator: 'IN' | 'EQ' | 'NOT_EQ' | 'CONTAINS'; value: unknown }>; }

const storage = new AsyncLocalStorage<RequestContext>();

export interface RequestContext {
  user?: UserContext;
  authProvider?: AuthProvider;
}

/** L1 调用: 设置当前请求的上下文 */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** L3 调用: 获取当前请求的用户身份 */
export function getCurrentUser(): UserContext | undefined {
  return storage.getStore()?.user;
}

/** L3 调用: 获取当前请求的 AuthProvider */
export function getCurrentAuthProvider(): AuthProvider | undefined {
  return storage.getStore()?.authProvider;
}

// ════════════════════════════════════════════════════════════════
// D947 / L-21: 无上下文时的 fail-closed 拒绝型条件集
// ════════════════════════════════════════════════════════════════

/**
 * 拒绝型（deny-all）条件集常量。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: 无。纯常量。
 * - 输出: **非空** conditions；字段名不存在于任何知识块的权限列
 *   （`l4/knowledge-store.ts` 的 `matchFilter` 用 `row[col]` 取值 ⇒ 恒 `undefined`），
 *   配合 `EQ` 与哨兵值 `undefined !== DENY_ALL_SENTINEL` ⇒ 每一行都判 false。
 * - 降级: 不适用（无 IO、无异常路径）。
 *
 * Why 非空：`l4/knowledge-store.ts:195` / `:335` 在 `filter.conditions.length === 0`
 * 时**完全跳过过滤**（`? rows : rows.filter(...)`）——空条件集 = 不过滤 = fail-open。
 * 故此处**不得**返回空条件集，也**不得**返回允许型条件。
 */
const DENY_ALL_FIELD = '__d947_no_authenticated_context';
const DENY_ALL_SENTINEL = '__d947_deny_all__';

/**
 * L3 调用: 生成当前用户的权限过滤条件。
 *
 * D947 / L-21（安全项）: 无请求上下文时**必须 fail-closed**。
 * 触发场景（实测）: 白名单路径（`middleware/auth.ts isWhitelisted`）不经过
 * `runWithContext` ⇒ 即使 L-20 已注入 `req.auth`，该分支仍无 authProvider
 * ⇒ 本函数落回兜底。`/api/knowledge/ask` 正在白名单内 ⇒ 旧兜底（空条件集）
 * 会让知识检索经白名单路径拿到**无过滤**结果（fail-open）。
 */
export async function getCurrentFilterClause(resourceType: string): Promise<FilterClause> {
  const ctx = storage.getStore();
  if (!ctx?.user || !ctx?.authProvider) {
    log.warn(
      { code: 'RBAC_DENIED', resourceType, reason: 'no_request_context' },
      '安全判据: 被拒绝 — 无请求上下文（漏斗兜底 fail-closed，返回拒绝型非空条件集）',
    );
    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };
  }
  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
}
