/**
 * agent/graph-store-service.ts — GraphStore 装配服务 (L2)
 * @state: real
 *
 * D603 跨层修复（扫描报告 §三 簇3 图存储簇）: SqliteGraphStore 构造 + getDatabase
 * 句柄直取从 L1（routes/auth、routes/agent-observer）移出到本 L2 服务（铁律 39）。
 *
 * 注入优先语义由调用方保留（app.locals.graphStore ← server.ts:259 Bootstrap Phase 1c
 * 单例注入）；本服务是未注入环境（独立测试挂载/降级路径）的行为等价兜底——
 * 与修复前 L1 直构 `new SqliteGraphStore(getDatabase())` 逐字节一致，异常原样传播。
 *
 * L1→L2 ✅ | L2→L4(adapters)/L5(init) 装配职责 ✅（先例: conversation-engine.ts:44 同款直构）
 */

import { SqliteGraphStore, GraphLookupError } from '../adapters/sqlite-graph-store';
import { getDatabase } from '../init/engine-context';

// L1 类型出口 — L1 不再出现 adapters/sqlite-graph-store 值依赖
export type { SqliteGraphStore } from '../adapters/sqlite-graph-store';
// L1 错误出口 — `getObjectById` 的失败契约（#1431 T2）随本服务导出，调用方不必直连 adapters
export { GraphLookupError };

/**
 * createSystemGraphStore — 全局 db 上的 SqliteGraphStore 兜底构造。
 * getDatabase() 未初始化时抛出（fail-closed），调用方既有 try-catch 语义不变
 * （如 auth.ts getUserStore 的内存 Map 降级）。
 */
export function createSystemGraphStore(): SqliteGraphStore {
  return new SqliteGraphStore(getDatabase());
}

/**
 * getObjectById — 按 `(orgId, nodeId)` 取回 ② 节点（#1431 阶段 2 · T2）。
 *
 * 契约（铁律 47；DEV DOC v2 §6，Issue #1431 评论 14176）:
 *   @input  orgId  —— 企业身份（非空字符串）；nodeId —— **`graph_nodes.id`**（`node-<uuid>`，**不是业务键**）
 *   @output 命中 ⇒ `{ id, type, props }`；未找到 ⇒ `null`
 *   @error  orgId/nodeId 不是非空字符串 ⇒ `GraphLookupError(VALIDATION, phase=validate, retryable=false)`，
 *           且**零查询**（校验先于构造 store / 触达数据库）；
 *           介质层查询失败 ⇒ `GraphLookupError(GRAPH_LOOKUP_FAILED, phase=graph-lookup, retryable=true)` **原样上抛**
 *           （不得沿用 `getNode` 的吞错返 null）
 *   @invariant 图分区**只由 orgId 派生**（`graph = orgId`）：本签名**没有 graph 入参** ⇒ 调用方无从自报，
 *               也不回落默认 `default`；跨企业查询 ⇒ 查不到（`null`）
 *   @not-here 业务键（businessKey）↔ 节点 id 的解析（另票，需映射载体）；⑤建议；①快照；多用户
 */
export function getObjectById(
  orgId: string,
  nodeId: string,
): { id: string; type: string; props: Record<string, unknown> } | null {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    throw new GraphLookupError('VALIDATION', `orgId 必须是非空字符串（实为 ${describeArg(orgId)}）`, {
      phase: 'validate',
      retryable: false,
    });
  }
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    throw new GraphLookupError('VALIDATION', `nodeId 必须是非空字符串（实为 ${describeArg(nodeId)}）`, {
      phase: 'validate',
      retryable: false,
    });
  }

  // graph 只由 orgId 派生（单点；不默认 'default'、不接受调用方自报）
  return createSystemGraphStore().getNodeStrict(nodeId, orgId);
}

/** 诊断用：把非法入参渲染成可读形态（不抛、不遍历对象） */
function describeArg(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}
