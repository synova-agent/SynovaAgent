/**
 * src/adapters/standard-key-guard.ts — **标准键写入守卫**（共享检测；#1403）
 *
 * 契约（铁律 47）:
 *   @input  store —— 具 `createNode` / `queryNodes`（+ 可选 `updateNode`）的图存储（**含被包装者**）
 *   @output 同形 store（**包装**）：`createNode` 在 `props.standardKey` 存在时先查后写
 *   @invariant ① **不新造第二套检测**：逻辑**逐字平移**自 `src/l4/graph-bridge.ts`（D29/D33 的 standardKey 分支）
 *              ② 幂等：同 `standardKey` **不重复插入** ⇒ 追加 `data_versions` + `has_conflict: true`
 *              ③ 无 `standardKey` ⇒ 直通（不改语义）
 *              ④ **不越层**：纯 store 装饰器，不 import L4/L5（供 composition root 与 L4 共用）
 *   @degraded 无（纯同步包装；`queryNodes`/`updateNode` 缺失时按能力降级：无 `updateNode` ⇒ 直通创建）
 *   @not-here SOG schema 校验（`validateAndLog`）与 D33 时间字段推导**留在 graph-bridge**（其自有语义）
 */
export interface StandardKeyGuardStore {
  createNode(type: string, props: Record<string, unknown>, graph: string): string;
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; props: Record<string, unknown> }>;
  updateNode?(id: string, props: Record<string, unknown>, graph: string): void;
}

/**
 * 包装 store ⇒ 标准键冲突检测（#1403：**一处收口，两条路径共用**）
 * 用法：① L4 `graph-bridge` 在自有 patch 内委托 ② composition root（`src/server.ts`）注入前包一次
 */
export function wrapStandardKeyGuard<T extends StandardKeyGuardStore>(store: T): T {
  const originalCreate = store.createNode.bind(store);
  const originalQuery = store.queryNodes.bind(store);
  const originalUpdate = store.updateNode?.bind(store);

  const guardedCreate = (type: string, props: Record<string, unknown>, graph: string): string => {
    const standardKey = props?.standardKey;
    if (!standardKey) return originalCreate(type, props, graph);

    const existing = originalQuery(type, { standardKey: standardKey as string }, graph);
    if (existing.length === 0) {
      return originalCreate(type, { ...props, data_versions: [], has_conflict: false }, graph);
    }
    const existingNode = existing[0];
    const existingProps = existingNode.props;
    const dataVersions = Array.isArray(existingProps.data_versions)
      ? (existingProps.data_versions as Array<Record<string, unknown>>)
      : [];
    const existingCore: Record<string, unknown> = {};
    for (const k of Object.keys(existingProps)) {
      if (k !== 'data_versions' && k !== 'has_conflict') existingCore[k] = existingProps[k];
    }
    if (originalUpdate) {
      originalUpdate(existingNode.id, {
        ...existingProps,
        ...props,
        data_versions: [...dataVersions, { value: existingCore, recordedAt: new Date().toISOString() }],
        has_conflict: true,
      }, graph);
      return existingNode.id;
    }
    // 能力降级：无 updateNode ⇒ 直通创建（**显式**：调用方应知晓该 store 不具版本化能力）
    return originalCreate(type, props, graph);
  };

  return Object.assign(Object.create(store as object), { createNode: guardedCreate }) as T;
}
