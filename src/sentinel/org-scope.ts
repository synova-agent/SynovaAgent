/**
 * sentinel/org-scope.ts — 哨兵读路径的租户收口（#1374，数值级隔离）
 *
 * 依据（可核）：
 *   · **载体 = `props.orgId`**（R21/R22；代码面已确立：`loop-handlers.ts:265,700`、`goal-store.ts:308,440`、
 *     `data-exporter.ts:247`、`data-purger.ts:434`；夹具断言见 `tests/growth/goal-store-real-graph.integration.test.ts:85/128`、
 *     `tests/growth/proposal-store-real-graph.integration.test.ts:91`）
 *   · **过滤能力现成**：`src/adapters/sqlite-graph-store.ts:193-204` 的 `queryNodes(type, filters)` 内部已拼
 *     `AND json_extract(props, '$.${key}') = ?`（`proposal-store` 测试即用 `{ orgId }`）
 *   · **单点收口**：`src/sentinel/sentinel-loader.ts:260` 把 `SentinelContext.db` 作为 GraphStore 交给**全部** aggregate
 *     ⇒ 包装这一处 ⇒ 43 个 queryNodes 读路径一次性获得 org 过滤（**不散改**）
 *
 * 契约（铁律 47）:
 *   @input  store（具 `queryNodes` 的 GraphStoreReader）；orgId（**租户真源 = `ctx.teamId`**，缺省 = 未隔离）
 *   @output 包装后的 store（同形；`queryNodes` 行为在"有 orgId"时并入 `{ orgId }` 过滤）
 *   @degraded **无 orgId ⇒ 【行为】透传（不加过滤 = 现行为）+ 计入未隔离计数**（**不静默**；空结果 ≠ 隔离成功，R61 同族）
 *             ⚠️ 注意：为计数**仍会包装**（返回对象身份 ≠ 入参对象），但查询行为与入参一致
 *   @invariant ① `orgId` 只来自 `ctx.teamId`（不来自请求自报，#1322 同族）
 *              ② 调用方已传 `orgId` 且与 ctx 冲突 ⇒ **ctx 优先 + log.warn**（单一真源）
 *              ③ 不改 store 的其他方法；不改返回结构；不缓存
 *   @not-here 数据侧补标签（L4 本体域 / 方案 C）；`metric_readings` 表结构；compute 指标语义
 *
 * 口径：`metric_id` = compute 指标名（与租户无关）｜`entity_id` = 分析单元（现一律 `'*'`）｜
 *      **`org_id` = 租户维度的唯一落点** —— **租户不得借用 `entity_id`**（否则唯一索引业务键语义混乱：
 *      `(org_id, metric_id, entity_id, observed_at)` 会把同 org 同指标压成一行 ⇒ 多租户互相覆盖）。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/org-scope');

/**
 * **租户别名键**（一次枚举；#1375 扩展自 #1374 的 `teamId`）
 * 口径：全仓 `queryNodes(..., { <key>: ... })` 枚举 ⇒ 见 `tests/sentinel/tenant-filter-keys.test.ts`（判据：非载体键必须登记）
 * 说明：这些键在**语义上**都指向租户，但**载体**只有 `props.orgId`（R21/R22）⇒ 统一改写。
 */
export const TENANT_ALIAS_KEYS = ['teamId', 'tid'] as const;

/** 未隔离读计数（可观测；**空结果 ≠ 隔离成功**） */
let unscopedQueryCount = 0;

/** 读当前未隔离查询计数（#1374 判据用） */
export function getUnscopedQueryCount(): number {
  return unscopedQueryCount;
}

/** 复位计数（测试用） */
export function resetUnscopedQueryCount(): void {
  unscopedQueryCount = 0;
}

interface QueryableStore {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): unknown;
}

function isQueryable(store: unknown): store is QueryableStore {
  return typeof store === 'object' && store !== null
    && typeof (store as { queryNodes?: unknown }).queryNodes === 'function';
}

/** 查询函数签名（显式声明，避免散落断言） */
type QueryFn = (type: string, filters?: Record<string, unknown>, graph?: string) => unknown;

/**
 * 给 store 套上租户过滤（**单点收口**）。无 orgId ⇒ 原样返回（现行为）+ 计数未隔离。
 *
 * 实现：`Object.create(store)` **保留原型链**（class 实例的其余方法全部继承），
 *   仅以自有属性遮蔽 `queryNodes` ⇒ 不改既有语义、不复制、不缓存。
 */
export function withOrgScope<T>(store: T, orgId: string | undefined): T {
  if (!isQueryable(store)) return store;
  const scopedOrg = typeof orgId === 'string' && orgId.trim() !== '' ? orgId.trim() : undefined;
  const original = store.queryNodes.bind(store) as QueryFn;

  const scopedQuery: QueryFn = (type, filters, graph) => {
    if (scopedOrg === undefined) {
      unscopedQueryCount++;
      log.debug({ type, total: unscopedQueryCount }, '未隔离读（无 orgId）—— 计数，不静默');
      return original(type, filters, graph);
    }
    const given = filters?.orgId;
    if (given !== undefined && given !== scopedOrg) {
      log.warn({ type, given, ctx: scopedOrg }, '调用方 orgId 与 ctx.teamId 冲突 ⇒ 以 ctx 为准（单一真源）');
    }
    // 🔴 **键归一化**（#1374 实测发现）：哨兵普遍传 `{ teamId }`，而本仓租户载体是 **`props.orgId`**
    //   （R21/R22；`loop-handlers` / `goal-store` / `data-exporter` 均读 `props.orgId`）。
    //   若不归一化 ⇒ 过滤退化为 `{ teamId, orgId }` 双键 ⇒ 只带 orgId 的数据**全部落空** ⇒
    //   **空结果被误当"隔离成功"**（R61 同族）⇒ 故此处把 `teamId` 键**改写**为 `orgId`（单一载体）。
    // 🔴 **键归一化（一次枚举全部别名键；#1375 扩展）**
    //   口径：`git grep -oE "queryNodes\([^)]*\{[^}]*\}"` ⇒ 全仓过滤器键枚举（见 tests/sentinel/tenant-filter-keys.test.ts）：
    //     载体键 = `orgId`｜**别名键 = TENANT_ALIAS_KEYS**｜其余 = 业务键（如 goalId/status/email…，**非租户键，原样保留**）
    //   历史：`teamId`（#1374 实测发现）⇒ 本卡扩展覆盖 `tid`（5 文件）——**一次全归一化，避免"改一个漏一个"**。
    const rawFilters = filters ?? {};
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawFilters)) {
      if ((TENANT_ALIAS_KEYS as readonly string[]).includes(k)) continue;   // 别名键：丢弃（统一由 orgId 承载）
      rest[k] = v;
    }
    const dropped = Object.keys(rawFilters).filter(k => (TENANT_ALIAS_KEYS as readonly string[]).includes(k));
    if (dropped.length > 0) {
      log.debug({ type, dropped }, '租户别名键归一化为 orgId（单一载体；R21/R22）');
    }
    return original(type, { ...rest, orgId: scopedOrg }, graph);
  };

  const scoped: T = Object.create(store as object);
  Object.defineProperty(scoped, 'queryNodes', {
    value: scopedQuery, enumerable: true, writable: true, configurable: true,
  });
  return scoped;
}
