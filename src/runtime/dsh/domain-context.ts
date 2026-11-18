/**
 * src/runtime/dsh/domain-context.ts — DSH 只读工具的**真实领域上下文**（#1426 I-1；本切片只产 ②）。
 *
 * 边界（很重要）：
 *   · 只读：只 SELECT `graph_nodes`／`graph_triples`（经 `SqliteGraphStore`），不写领域数据、不写审计；
 *   · 身份只来自服务端注入的 `ToolCallContext`（token 绑定），本文件不接受任何入参身份字段；
 *   · **只产 ②（本体结构）**：③（哨兵观测）与 ④（参数依据）本切片 **NOT DONE**，条目恒 0；
 *   · **无合成兜底**：查不到就是 `DOMAIN_EMPTY`，字段缺失就是**不产出条目**（不补零、不编常量）。
 *
 * 契约（铁律 47）:
 *   @input  ctx: ToolCallContext（enterpriseId/userId/scope/runId，只来自一次性 token 解析）
 *           problemId: 本企业 ② 对象的 `businessKey` 或 `$id`（`graph_nodes.id`；不限类型）
 *   @output ContextSnapshot（`synthetic:false`；`items` ≤ 200；`truncated = count > items.length`）
 *   @degraded 无：DB 异常 ⇒ `PERSISTENCE_ERROR`（**复用既有码**，不新增）；身份不可见企业域 ⇒ `FORBIDDEN`
 *   @error   `UNAUTHORIZED`（缺 ctx，由 `tools.ts` 在进入本文件前抛）／`FORBIDDEN`／`VALIDATION_ERROR`
 *            ／`DOMAIN_EMPTY`／`PERSISTENCE_ERROR`
 *
 * 逐字段来源表（DEV DOC v3 §5；PR 内复核）：
 *   layer        ← `'②'`（本切片唯一产出层；类型联合保留 ②③④，③④ 恒 0）
 *   $id          ← `graph_nodes.id`
 *   cycleVersion ← `null`（**全仓零生产者**：没有任何写路径给 ② 节点落 cycle 版本，不作为可证字段）
 *   sentinelRun  ← `null`（③ 不产：`sentinel_events` 无企业列/period/defVersion/status）
 *   period       ← `graph_nodes.props.period`（非空字符串才产出；缺失/空串 ⇒ 该条目不产出）
 *   defVersion   ← `graph_nodes.props.defVersion`（同上）
 *   evidenceId   ← `null`（④ 不产；② 的 `props.sourceIds` 是 `scan_evidence` 引用，与 ④ `evidenceId`
 *                  的三套语义（evidence/scan_evidence/metric_readings.evidence_ref）未定，不拼接）
 *   status       ← `'observed'`（有 `period`+`defVersion` 的已落库 ② 节点即观测态；缺字段不产出 ⇒ 永不出现 `partial`）
 *   visibility   ← 既有判据函数 `toScanViewer`（`connectors/enterprise-scan/visibility.ts`）确认企业域后才产出；
 *                  图必须等于判据产物 `viewer.orgId`（跨企业读不到）
 *   source       ← `{ kind:'synova.domain', api:'synova.domain/v1' }`（真实领域面；不再是 `synthetic-context-v1`）
 *
 * 已知限制（不在本切片修）：
 *   · `SqliteGraphStore.queryNodes/queryEdges/getNode` 内部把 SQL 异常吞成 `[]`/`null`（既有 fail-open），
 *     因此“查询层内部错误”不能在本文件区分；本文件的 `PERSISTENCE_ERROR` 覆盖取库/建 store/直查类型清单。
 *   · 1 跳邻接 = 出边 + 入边的对端（去重、不含根对象本身；自环不把根当邻接节点）。
 */
import { SqliteGraphStore } from '../../adapters/sqlite-graph-store';
import { EnterpriseScanError } from '../../connectors/enterprise-scan/errors';
import type { ScanViewer } from '../../connectors/enterprise-scan/types';
import { toScanViewer } from '../../connectors/enterprise-scan/visibility';
import { getDatabase } from '../../init/engine-context';
import { DshError, toDshError } from './errors';
import type { ContextSnapshot, ContextSnapshotItem, ToolCallContext } from './tools';

/** 有界返回上限（DEV DOC v3 §3.6：items ≤ 200，`truncated = count > items.length`）。 */
const MAX_ITEMS = 200;
/** problemId 上限（防御异常长输入；真实业务键/节点 id 远小于此）。 */
const MAX_PROBLEM_ID_CHARS = 256;

/**
 * 既有可见性判据（`toScanViewer`）把 ctx 收窄为企业域 viewer。
 * ga / 未知角色 / 缺 sub|orgId ⇒ `SCOPE_DENIED`（fail-closed）⇒ 本层稳定映射为既有码 `FORBIDDEN`（403）。
 * @error `DshError('FORBIDDEN', 'tool')`
 */
function assertEnterpriseViewer(ctx: ToolCallContext): ScanViewer {
  try {
    return toScanViewer({ sub: ctx.userId, role: ctx.scope, orgId: ctx.enterpriseId });
  } catch (err: unknown) {
    if (err instanceof EnterpriseScanError) {
      throw new DshError('FORBIDDEN', 'tool', `身份未通过企业域可见性判据（toScanViewer）：${err.message}`, {
        retryable: false,
        cause: err,
      });
    }
    throw err;
  }
}

/** 本图已有的 ② 节点类型清单（`queryNodes` 的 type 必填；类型枚举用直查，§8 允许 SQL 方法自选）。 */
function listNodeTypes(graph: string): string[] {
  const rows = getDatabase()
    .prepare('SELECT DISTINCT type FROM graph_nodes WHERE graph = ? AND valid_to IS NULL ORDER BY type ASC')
    .all(graph) as Array<{ type: string }>;
  return rows.map(row => row.type);
}

/**
 * 解析 problemId → 根节点 id。先按 `$id`（`graph_nodes.id`），再按 `businessKey`（不限类型）。
 * 只在本企业 graph 内解析（跨企业命中 = 未命中 ⇒ DOMAIN_EMPTY，不泄露存在性）。
 */
function resolveRootId(store: SqliteGraphStore, graph: string, problemId: string): string | null {
  const byId = store.getNode(problemId, graph);
  if (byId !== null) return byId.id;
  for (const type of listNodeTypes(graph)) {
    const matches = store.queryNodes(type, { businessKey: problemId }, graph);
    if (matches.length > 0) {
      // 同 businessKey 理论上唯一（scan_ontology_links 以 (graph,type,business_key) 为键）；防御性取最小 id
      return matches.map(match => match.id).sort()[0];
    }
  }
  return null;
}

/** 根对象的 1 跳邻接节点 id（出边对端 + 入边对端；去重、升序、不含根本身）。 */
function neighborIds(store: SqliteGraphStore, graph: string, rootId: string): string[] {
  const ids = new Set<string>();
  for (const edge of store.queryEdges(undefined, rootId, undefined, graph)) ids.add(edge.to);
  for (const edge of store.queryEdges(undefined, undefined, rootId, graph)) ids.add(edge.from);
  ids.delete(rootId);
  return [...ids].sort();
}

/**
 * 单个邻接节点 → ② 条目；`period`/`defVersion` 必须同时是非空字符串，否则**不产出**（不补零、不编常量）。
 */
function toContextItem(node: { id: string; props: Record<string, unknown> }): ContextSnapshotItem | null {
  const period = node.props.period;
  const defVersion = node.props.defVersion;
  if (typeof period !== 'string' || period.length === 0) return null;
  if (typeof defVersion !== 'string' || defVersion.length === 0) return null;
  return {
    layer: '②',
    $id: node.id,
    cycleVersion: null,
    sentinelRun: null,
    period,
    defVersion,
    evidenceId: null,
    status: 'observed',
    visibility: 'enterprise',
    source: { kind: 'synova.domain', api: 'synova.domain/v1' },
  };
}

/**
 * 构造真实领域 ContextSnapshot（**只读 ②**，本切片 ③④ 恒 0）。
 *
 * @input  ctx（服务端注入身份）＋ problemId（本企业 ② 对象 businessKey 或 $id）
 * @output 真实节点数据驱动的快照；同输入两次调用 JSON 逐字相等（无时间戳/随机值入内容）
 * @error  `VALIDATION_ERROR`（problemId 超长）／`FORBIDDEN`（可见性判据拒绝）／`DOMAIN_EMPTY`（解析不到根）
 *         ／`PERSISTENCE_ERROR`（取库/建 store/直查失败，复用既有码）
 */
export function buildContextSnapshot(ctx: ToolCallContext, problemId: string): ContextSnapshot {
  if (problemId.length > MAX_PROBLEM_ID_CHARS) {
    throw new DshError('VALIDATION_ERROR', 'tool', `problemId 超过 ${MAX_PROBLEM_ID_CHARS} 字符上限`, { retryable: false });
  }
  // §3.5：visibility 不得写常量 —— 先用既有判据函数确认企业域（ga/未知角色/缺身份 fail-closed）。
  const viewer = assertEnterpriseViewer(ctx);
  const graph = viewer.orgId;

  try {
    const store = new SqliteGraphStore(getDatabase());
    const rootId = resolveRootId(store, graph, problemId);
    if (rootId === null) {
      throw new DshError('DOMAIN_EMPTY', 'tool', `本企业 ② 对象中解析不到 problemId: ${problemId}`, { retryable: false });
    }
    const items: ContextSnapshotItem[] = [];
    for (const id of neighborIds(store, graph, rootId)) {
      const node = store.getNode(id, graph);
      if (node === null) continue;
      const item = toContextItem(node);
      if (item !== null) items.push(item);
    }
    const count = items.length;
    return {
      synthetic: false,
      problemId,
      count,
      truncated: count > MAX_ITEMS,
      items: items.slice(0, MAX_ITEMS),
    };
  } catch (err: unknown) {
    if (err instanceof DshError) throw err;
    // 复用既有码：存储层失败 = PERSISTENCE_ERROR（phase 'persist'，retryable=true 语义见 errors.ts CODE_META）。
    throw toDshError(err, { code: 'PERSISTENCE_ERROR', phase: 'persist' });
  }
}
