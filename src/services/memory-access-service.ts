/**
 * services/memory-access-service.ts — 记忆读取服务 (L2 编排层)
 *
 * 为 L1 路由层提供 AgentMemoryStore (L4) 的安全访问封装。
 * 铁律 39: L1 不得直接触 L4 —— routes 通过本服务访问，保持层边界。
 *
 * 契约:
 *   @input  — listByType(type, limit) / list(query) / remember(entry)
 *   @output — MemoryEntry[] / MemoryEntry
 *   @degraded — AgentMemoryStore 不可用时返回空数组 / 抛错给调用方降级
 *   @error  — MEMORY_STORE_UNAVAILABLE
 */
import { createLogger } from '@synova/logger';
import { getAgentMemoryStore, type MemoryQuery, type MemoryEntry } from '../l4/agent-memory-store';
import type { AgentMemoryStoreLike } from '@synova/evolution';
import { getDatabase } from '../init/engine-context';

const log = createLogger('services/memory-access');

/**
 * 按类型列出记忆（跨组织 — 通知系统等全局查询）。
 * 降级：AgentMemoryStore 不可用 → 返回空数组（调用方展示降级）。
 */
export function listMemoryByType(type: string, limit = 50): MemoryEntry[] {
  try {
    return getAgentMemoryStore(getDatabase()).listByType(type, limit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, type }, '记忆按类型查询失败 — degraded');
    return [];
  }
}

/**
 * 按查询条件列出记忆（orgId + type + tags 过滤）。
 * 降级：AgentMemoryStore 不可用 → 返回空数组（调用方展示降级）。
 */
export function listMemory(query: MemoryQuery): MemoryEntry[] {
  try {
    return getAgentMemoryStore(getDatabase()).list(query);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, orgId: query.orgId }, '记忆查询失败 — degraded');
    return [];
  }
}

/**
 * 写入一条记忆（action 持久化等）。
 * 降级：AgentMemoryStore 不可用 → 返回 null（调用方仅内存存储）。
 */
export function rememberMemory(
  entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>,
): MemoryEntry | null {
  try {
    return getAgentMemoryStore(getDatabase()).remember(entry);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, key: entry.key }, '记忆写入失败 — degraded');
    return null;
  }
}

/**
 * 取 L4 AgentMemoryStore 的安全视图（#981：供 L1 路由把它交给 `@synova/evolution` 的
 * `collectFeedback(input, memoryStore)` —— 该函数形参类型是 `AgentMemoryStoreLike`，四方法**皆必填**）。
 *
 * 契约（铁律 47）:
 *   @input  无
 *   @output 视图对象 | null。视图**只做转调，不新增能力、不含桩方法**：
 *           `remember` 是反馈落库所需；`recall` / `list` / `forget` 为满足 `AgentMemoryStoreLike`
 *           结构约束而原样转调到同一 store 实例（本服务的 `listMemory` / `listMemoryByType` 已提供读路径）。
 *   @degraded AgentMemoryStore 不可用（未初始化 / schema 不可建）→ **返回 null**（调用方必须
 *           log.warn + 显式降级，禁静默用空对象顶替——铁律 11/31）
 *   @error  无（不抛；失败以 null 表达）
 */
export function getMemoryWriter(): AgentMemoryStoreLike | null {
  try {
    const store = getAgentMemoryStore(getDatabase());
    // 两处窄化断言: `AgentMemoryStoreLike` 用 `type: string` 放宽描述，store 用 `MemoryType` 联合
    // （不引入 as any/never/unknown as —— 铁律 38；断言方向 store ⊂ like，可核）
    return {
      remember: (entry) => store.remember({ ...entry, type: entry.type as MemoryEntry['type'] }),
      recall: (orgId, key) => store.recall(orgId, key),
      list: (query) => store.list(query as MemoryQuery),
      forget: (orgId, key) => store.forget(orgId, key),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, '记忆写入视图不可用 — degraded (null)');
    return null;
  }
}
