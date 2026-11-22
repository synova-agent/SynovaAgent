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

// ═══ #1431 阶段 2 · S1：② 对象与关系写入原语 ═══

/** `period` 形态（`YYYY-MM`）—— ② 对象属性必填之一（与 T1 `metric_observations.period` 口径对齐） */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 写侧 typed error 的码（铁律 32：调用方可区分「入参非法」与「边端点缺失」）。
 * 介质层写入异常**不包装**（由 adapter 记日志后原样上抛，见 `GraphWriteError` 注释）。
 */
export type GraphWriteErrorCode = 'VALIDATION' | 'EDGE_ENDPOINT_MISSING';

/**
 * GraphWriteError — ② 对象/关系**写入前置校验**的 typed error（#1431 阶段 2 · S1）。
 *
 * `.code` / `.phase` / `.retryable` 三件齐（铁律 32）：
 *   · `VALIDATION`            —— 入参/属性非法（phase=validate, retryable=false）；校验先于任何写入 ⇒ **零写入**；
 *   · `EDGE_ENDPOINT_MISSING` —— 关系端点在该 org 分区内不存在（含跨 org；phase=validate, retryable=false）。
 *
 * 介质层写入失败（SQL 异常等）**不套本错误**：由 `SqliteGraphStore` 记日志后原样上抛（不吞、不降级为假成功）。
 */
export class GraphWriteError extends Error {
  readonly code: GraphWriteErrorCode;
  readonly phase: 'validate';
  readonly retryable: boolean;
  /** 违约字段（便于调用方/日志定位；无单一字段时为 undefined） */
  readonly field: string | undefined;

  constructor(code: GraphWriteErrorCode, message: string, options: { field?: string }) {
    super(message);
    this.name = 'GraphWriteError';
    this.code = code;
    this.phase = 'validate';
    this.retryable = false;
    this.field = options.field;
  }
}

/**
 * createObject — 在 `graph = orgId` 分区内创建一个 ② 对象节点（#1431 阶段 2 · S1）。
 *
 * 契约（铁律 47；DEV DOC v1 §4，Issue #1431 评论 14226）:
 *   @input  orgId —— 企业身份（非空字符串；**同时是图分区**）
 *           type  —— ② 对象类型（非空字符串，如 `Team`）
 *           props —— 对象属性（纯对象；**必须含** `period`（`YYYY-MM`）与 `defVersion`（非空字符串））
 *   @output 新节点 id（`node-<uuid>`），可被 `getObjectById(orgId, id)` 原样读回
 *   @error  `GraphWriteError(VALIDATION, phase=validate, retryable=false)` —— 任一入参违约；
 *           校验**先于**构造 store / 触达数据库 ⇒ 零写入、零 `getDatabase` 调用；介质层写入异常原样上抛
 *   @invariant 图分区**只由 orgId 派生**（`graph = orgId`）：签名没有 graph 入参 ⇒ 调用方无从自报，
 *              也不回落默认 `default`；`props` **原样落库**（本函数不改写、不注入键）
 *   @not-here 业务键（businessKey）↔ 节点 id 解析；SOG schema 校验；`name` 默认值
 *              （缺 `props.name`/`props.label` 时由 `createNode` 回落为 `type`，见 sqlite-graph-store.ts:208）
 */
export function createObject(
  orgId: string,
  type: string,
  props: Record<string, unknown>,
): string {
  requireNonEmptyString(orgId, 'orgId');
  requireNonEmptyString(type, 'type');
  requirePlainObject(props, 'props');

  const period = props.period;
  if (typeof period !== 'string' || !PERIOD_PATTERN.test(period)) {
    throw validationError('period', `props.period 必须是 YYYY-MM 形态字符串（实得 ${describeValue(period)}）`);
  }
  const defVersion = props.defVersion;
  if (typeof defVersion !== 'string' || defVersion === '') {
    throw validationError('defVersion', `props.defVersion 必须是非空字符串（实得 ${describeValue(defVersion)}）`);
  }

  // 全部校验已在构造 store 之前完成 ⇒ 违约时零写入；graph 只由 orgId 派生（不默认 'default'）
  return createSystemGraphStore().createNode(type, props, orgId);
}

/**
 * createRelation — 在 `graph = orgId` 分区内创建一条 ② 关系边（#1431 阶段 2 · S1）。
 *
 * 契约（铁律 47；DEV DOC v1 §4，Issue #1431 评论 14226）:
 *   @input  orgId —— 企业身份（非空字符串；**同时是图分区**）
 *           type  —— 关系谓词（非空字符串）
 *           fromId/toId —— **已存在且同 org** 的 ② 节点 id（`node-<uuid>`）
 *           props —— 可选边属性（纯对象）
 *   @output 新边 id（`edge-<uuid>`）
 *   @error  `GraphWriteError(VALIDATION)` —— 入参/边属性非法（**零写入**，先于构造 store）；
 *           `GraphWriteError(EDGE_ENDPOINT_MISSING)` —— 任一端点在该 org 分区内不存在（跨 org 同此，零写入）；
 *           `GraphLookupError(GRAPH_LOOKUP_FAILED)` —— 端点存在性检查时介质层失败（不吞，原样上抛）；
 *           写入异常 ⇒ 由 adapter 记日志后原样上抛
 *   @invariant 端点**先查后写** ⇒ `createEdge` 内部 `getNode` 必得真实类型，不会把边两端写成 `"unknown"`
 *              （`createEdge` 的既有静默降级见 sqlite-graph-store.ts:234-237；本函数在调用前消除该路径）；
 *              图分区只由 orgId 派生
 *   @not-here 端点自动创建（不自动建节点）；边权重/软删除；业务键解析
 */
export function createRelation(
  orgId: string,
  type: string,
  fromId: string,
  toId: string,
  props?: Record<string, unknown>,
): string {
  requireNonEmptyString(orgId, 'orgId');
  requireNonEmptyString(type, 'type');
  requireNonEmptyString(fromId, 'fromId');
  requireNonEmptyString(toId, 'toId');
  if (props !== undefined) requirePlainObject(props, 'props');

  const store = createSystemGraphStore();
  // 端点必须存在且同 org：同一 graph=orgId 分区下查不到 ⇒ 「不存在」与「跨 org」同判缺失
  const from = store.getNodeStrict(fromId, orgId);
  const to = store.getNodeStrict(toId, orgId);
  if (!from || !to) {
    const missing: string[] = [];
    if (!from) missing.push(`fromId=${fromId}`);
    if (!to) missing.push(`toId=${toId}`);
    throw new GraphWriteError(
      'EDGE_ENDPOINT_MISSING',
      `关系端点在该 org 分区内不存在（不得跨 org）: ${missing.join('; ')}`,
      { field: from ? 'toId' : 'fromId' },
    );
  }

  // 端点已确认存在且同 org ⇒ createEdge 内部 getNode 必得真实类型（不写 'unknown'）
  return store.createEdge(type, fromId, toId, undefined, props ?? {}, orgId);
}

function validationError(field: string, message: string): GraphWriteError {
  return new GraphWriteError('VALIDATION', message, { field });
}

/** 入参非空字符串校验（运行期兜住 JS 调用方传入的非字符串） */
function requireNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value === '') {
    throw validationError(field, `${field} 必须是非空字符串（实得 ${describeValue(value)}）`);
  }
}

/** 纯对象校验（null / 数组 / 原始值一律拒绝） */
function requirePlainObject(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validationError(field, `${field} 必须是普通对象（实得 ${describeValue(value)}）`);
  }
}

/** 诊断用：字符串带引号；其余只报类别（不遍历对象，避免循环引用/序列化异常） */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return describeArg(value);
}

/** 诊断用：把非法入参渲染成可读形态（不抛、不遍历对象） */
function describeArg(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}
