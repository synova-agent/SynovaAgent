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
import type Database from 'better-sqlite3';

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

// ═══ #1486 裁定 c：② 资料期间解析（哨兵 ④a 的 period 来源；禁 now() 派生）═══

/** ② 资料里可接受的业务周期形态（`YYYY-MM`；与 ④a 写入侧口径一致） */
const MATERIAL_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * resolveLatestMaterialPeriod — 从 **② 资料**（`graph_nodes.props.period`）解析该企业「最新业务周期」。
 *
 * 为什么是"资料"而不是 `now()`：期间是**业务事实**（#1486 裁定 a 同一判据）—— 只能取客户资料里
 * 已经存在的期间；取不到就不传（由既有 `S2_DEGRADED_NO_PERIOD` 语义暴露），**禁编造**。
 *
 * 契约（铁律 47）:
 *   @input  orgId —— 企业图分区（非空字符串；不接受跨企业读）
 *           db —— 可选引擎库句柄（缺省 = `getDatabase()` 单例；注入形态便于测试/装配方复用）
 *   @output 命中 ⇒ 该分区现存 ② 节点 `props.period` 中最大的合法 `YYYY-MM`；
 *           无资料/无合法期间/orgId 非法 ⇒ `undefined`（**不补默认值、不回退当前月**）
 *   @degraded 无：查询失败**原样抛出**（由调用方 `log.warn` + 按无 period 运行，不在这里吞错）
 *   @authority 只读 `graph_nodes`（不写）；分区只由入参 orgId 决定
 *   @not-here 不派生期间、不读 `metric_observations`（读路径在 `sentinel/registry.ts` 绑定）、不做聚合/趋势
 *   @error  better-sqlite3 的 SQL 异常原样上抛（表缺失/句柄失效 ⇒ 调用方降级）
 */
export function resolveLatestMaterialPeriod(orgId: string, db?: Database.Database): string | undefined {
  if (typeof orgId !== 'string' || orgId === '') return undefined;
  const connection = db ?? getDatabase();
  const rows = connection.prepare(
    `SELECT props FROM graph_nodes
      WHERE graph = ? AND valid_to IS NULL AND props LIKE '%"period"%'`,
  ).all(orgId) as Array<{ props: string }>;

  let latest: string | undefined;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.props);
    } catch {
      continue; // 历史脏行：不是合法 JSON ⇒ 该行不提供期间（不猜）
    }
    if (typeof parsed !== 'object' || parsed === null || !('period' in parsed)) continue;
    const value: unknown = parsed.period;
    if (typeof value !== 'string' || !MATERIAL_PERIOD_PATTERN.test(value)) continue;
    if (latest === undefined || value > latest) latest = value; // `YYYY-MM` 字典序 = 时间序
  }
  return latest;
}

// ═══ #1431 阶段 2 · S1：② 对象与关系写入原语 ═══

/** `period` 形态（`YYYY-MM`）—— ② 对象属性必填之一（与 T1 `metric_observations.period` 口径对齐） */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * `props.defVersion` 缺省时由**系统**赋予的对象定义版本（#1486 裁定 a）。
 *
 * 语义边界（不得扩用）：`defVersion` 是**本体定义版本**（系统语义，系统可以给默认值）；
 * `period` 是**业务事实**（编一个＝造数据）⇒ **永不**由本模块派生/默认，缺则拒绝写入。
 */
export const INGEST_DEF_VERSION = 'ingest-v0';

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
 * 契约（铁律 47；DEV DOC v1 §4，Issue #1431 评论 14226；#1486 裁定 a 放宽 defVersion）:
 *   @input  orgId —— 企业身份（非空字符串；**同时是图分区**）
 *           type  —— ② 对象类型（非空字符串，如 `Team`）
 *           props —— 对象属性（纯对象；**必须含** `period`（`YYYY-MM`，业务事实，禁编造）；
 *                    `defVersion`（非空字符串）**可缺省** —— 缺省时由本函数注入 `INGEST_DEF_VERSION`）
 *   @output 新节点 id（`node-<uuid>`），可被 `getObjectById(orgId, id)` 原样读回；
 *           落库 props 在入参缺 `defVersion` 时等于 `{ ...props, defVersion: 'ingest-v0' }`
 *   @degraded 无：本函数是严格写入原语（校验失败即拒绝、零写入），不降级、不伪造成功
 *   @authority 图分区只由 `orgId` 派生；`defVersion` 的默认值只由本模块（系统语义）给出，
 *              `period` 的默认值**不经本函数** —— 期间只能由调用方从资料给出
 *   @error  `GraphWriteError(VALIDATION, phase=validate, retryable=false)` —— 任一入参违约
 *           （`period` 缺失/形态非法；`defVersion` 显式给出但非非空字符串也算违约 ——
 *           **只放宽"缺省"，不放宽"乱填"**）；校验**先于**构造 store / 触达数据库 ⇒ 零写入、
 *           零 `getDatabase` 调用；介质层写入异常原样上抛
 *   @invariant ① 图分区**只由 orgId 派生**（`graph = orgId`）：签名没有 graph 入参 ⇒ 调用方无从自报，
 *              也不回落默认 `default`；② `props` 除 `defVersion` 缺省注入外**不改写**（不覆盖调用方键）
 *   @not-here 业务键（businessKey）↔ 节点 id 解析；SOG schema 校验；`name` 默认值
 *              （缺 `props.name`/`props.label` 时由 `createNode` 回落为 `type`，见 sqlite-graph-store.ts:208）；
 *              `period` 的派生/补全（编期间 = 造数据，属调用方资料责任）
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
  // #1486 裁定 a：**只**放宽 defVersion 可缺省（系统语义给默认值）；period 仍强制（业务事实，编一个＝造数据）。
  const rawDefVersion: unknown = props.defVersion;
  if (rawDefVersion !== undefined && (typeof rawDefVersion !== 'string' || rawDefVersion === '')) {
    throw validationError('defVersion', `props.defVersion 必须是非空字符串（实得 ${describeValue(rawDefVersion)}）`);
  }
  const nodeProps: Record<string, unknown> = rawDefVersion === undefined
    ? { ...props, defVersion: INGEST_DEF_VERSION }
    : props;

  // 全部校验已在构造 store 之前完成 ⇒ 违约时零写入；graph 只由 orgId 派生（不默认 'default'）
  return createSystemGraphStore().createNode(type, nodeProps, orgId);
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

// ═══ #1431 阶段 2 · S2：业务键 → ② 对象 id 的幂等解析 ═══

/**
 * resolveOrCreate — 按业务键解析 ② 对象 id；不存在则创建（**幂等**，#1431 阶段 2 · S2）。
 *
 * 契约（铁律 47；S2 卡 v2 §设计决策 2，Issue #1431 评论 14333 / Mandate 评论 14335）:
 *   @input  orgId —— 企业身份（非空字符串；**同时是图分区**）
 *           businessKey —— 业务身份（非空字符串；落 `props.businessKey`，是**幂等判据**）
 *           type —— ② 对象类型（非空字符串，如 `Team`）
 *           props —— 对象属性（纯对象；**新建时**必须满足 `createObject` 契约：`period` 为 `YYYY-MM`、
 *                    `defVersion` 可缺省（#1486 裁定 a：系统赋 `ingest-v0`）—— 命中既有对象时不再校验 props，
 *                    因为不写库）
 *   @output 节点 id（`node-<uuid>`）—— 命中既有对象 ⇒ 复用其 id（不新建、不改 props）；
 *           未命中 ⇒ 走 `createObject` 新建后返回
 *   @degraded 无：严格解析原语（校验失败即拒绝、零写入），不降级、不返回假 id
 *   @authority 幂等键 `(orgId, type, businessKey)` 由本函数统一写入 props；期间（`period`）不由本函数派生
 *   @error  `GraphWriteError(VALIDATION)` —— 入参非法 / 新建时 props 违约（**校验先于写入** ⇒ 零写入）；
 *           查重/写入的介质层异常**原样上抛**（查重失败由 `queryNodes` 记 error 日志后返回空，
 *           随后 `createObject` 在介质层失败时同样抛出 ⇒ 不返回假 id）
 *   @invariant ① 幂等键 = `(orgId, type, businessKey)` —— 与既有 `scan_ontology_links` 的
 *              `(graph, kind, type, business_key)` **同形**（先例：`src/runtime/dsh/domain-context.ts:85`
 *              也是按 `queryNodes(type, { businessKey }, graph)` 解析）；`queryNodes` 必须带 type，
 *              故 type 是幂等键的一部分（同 businessKey 不同 type 视为不同对象）；
 *              ② **先查后建** ⇒ 同键重复调用不产生第二个节点；
 *              ③ `props.businessKey` 由本函数统一写入（调用方同名键被**覆盖** ⇒ 业务键单一真源）；
 *              ④ 图分区只由 `orgId` 派生（签名无 graph 入参，不回落 `'default'`）
 *   @not-here 属性更新（命中后不 update）；业务键跨 type 全局唯一；SOG schema 校验；①快照
 */
export function resolveOrCreate(
  orgId: string,
  businessKey: string,
  type: string,
  props?: Record<string, unknown>,
): string {
  requireNonEmptyString(orgId, 'orgId');
  requireNonEmptyString(businessKey, 'businessKey');
  requireNonEmptyString(type, 'type');
  const objectProps = props === undefined ? {} : props;
  requirePlainObject(objectProps, 'props');

  // 先查后建（幂等）：同 (orgId, type, businessKey) ⇒ 复用首建节点的 id
  const existing = createSystemGraphStore().queryNodes(type, { businessKey }, orgId);
  if (existing.length > 0) return existing[0].id;

  // 未命中 ⇒ 走 S1 的 createObject（同一套校验/分区语义）；businessKey 由本函数注入 ⇒ 下次必命中
  return createObject(orgId, type, { ...objectProps, businessKey });
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
