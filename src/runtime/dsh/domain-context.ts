/**
 * src/runtime/dsh/domain-context.ts — DSH 只读工具的**真实领域上下文**（#1426 I-1；#1459 T-A 补关系与依据）。
 *
 * 边界（很重要）：
 *   · 只读：只 SELECT `graph_nodes`／`graph_triples`（经 `SqliteGraphStore`）与 `scan_assertions*`
 *     （直查），不写领域数据、不写审计；
 *   · 身份只来自服务端注入的 `ToolCallContext`（token 绑定），本文件不接受任何入参身份字段；
 *   · **只产 ②（本体结构）**：③（哨兵观测）与 ④（参数依据）本切片 **NOT DONE**，条目恒 0；
 *   · **无合成兜底**：查不到就是 `DOMAIN_EMPTY`，字段缺失就是**不产出条目**（不补零、不编常量）；
 *   · **count===0 不再返回"成功空快照"**：根可解析但无可用条目 ⇒ 返回字段 `insufficient`
 *     （`INSUFFICIENT_CONTEXT`，不抛 error）；根解析不到仍是 `DOMAIN_EMPTY`（错误，不是空成功）。
 *
 * 契约（铁律 47）:
 *   @input  ctx: ToolCallContext（enterpriseId/userId/scope/runId，只来自一次性 token 解析）
 *           problemId: 本企业 ② 对象的 `businessKey` 或 `$id`（`graph_nodes.id`；不限类型）
 *   @output ContextSnapshot（`synthetic:false`；`items` ≤ 200；`truncated = count > items.length`）
 *           count===0 ⇒ 快照带 `insufficient{code,reason,missing[]}`（不抛 error）
 *   @degraded 无：DB 异常 ⇒ `PERSISTENCE_ERROR`（**复用既有码**，不新增）；身份不可见企业域 ⇒ `FORBIDDEN`
 *   @error   `UNAUTHORIZED`（缺 ctx，由 `tools.ts` 在进入本文件前抛）／`FORBIDDEN`／`VALIDATION_ERROR`
 *            ／`DOMAIN_EMPTY`／`PERSISTENCE_ERROR`
 *
 * 逐字段来源表（DEV DOC v3 §5；#1459 T-A 更新）：
 *   layer        ← `'②'`（本切片唯一产出层；类型联合保留 ②③④，③④ 恒 0）
 *   $id          ← `graph_nodes.id`
 *   cycleVersion ← `null`（**全仓零生产者**：没有任何写路径给 ② 节点落 cycle 版本，不作为可证字段）
 *   sentinelRun  ← `null`（③ 不产：`sentinel_events` 无企业列/period/defVersion/status）
 *   period       ← `graph_nodes.props.period`（非空字符串才产出；缺失/空串 ⇒ 该条目不产出）
 *   defVersion   ← `graph_nodes.props.defVersion`（同上）
 *   relation     ← 1 跳命中的 `graph_triples`：`type`←`predicate`；`direction`＝遍历方向
 *                  （`out`＝根为 subject／`in`＝根为 object）；`edgeId`←`graph_triples.id`
 *   evidence     ← 该节点**最新**扫描断言版本（`scan_assertions`→`scan_assertion_versions`）的
 *                  `evidence_status`／`instance_state` ＋ 该版本证据行的
 *                  `scan_assertion_evidence.source_ref`
 *   evidenceId   ← 上述证据行对应的 `scan_evidence_versions.evidence_id`（经
 *                  `scan_assertion_evidence.evidence_version_id` 连接；**不是** `evidence_version_id` 本身）。
 *                  无证据行 ⇒ `null`。覆盖范围：只有**产出条目的 ② 节点**可带 evidence；
 *                  无 period/defVersion 的节点不产条目，其证据从 items 侧不可达（已知限制）。
 *   status       ← `'observed'`（有 `period`+`defVersion` 的已落库 ② 节点即观测态；缺字段不产出 ⇒ 永不出现 `partial`）
 *   visibility   ← 既有判据函数 `toScanViewer`（`connectors/enterprise-scan/visibility.ts`）确认企业域后才产出；
 *                  图必须等于判据产物 `viewer.orgId`（跨企业读不到）
 *   source       ← `{ kind:'synova.domain', api:'synova.domain/v1' }`（真实领域面；不再是 `synthetic-context-v1`）
 *
 * 确定性与择新规则（#1459 T-A 钉子）：
 *   · 断言版本择新：`ORDER BY created_at DESC, rowid DESC LIMIT 1` —— 夹具多版本 `created_at`
 *     逐字相同时用 rowid 兜底，同节点连续两次调用的 `sources` 顺序稳定；
 *   · 证据来源顺序：同一断言版本内 `ORDER BY source_ref ASC, evidence_id ASC`，按 `ref` 去重；
 *   · 同一邻接节点有多条边时，`relation` 取 `(direction out 优先, type, edgeId)` 升序第一条
 *     （确定性规则；契约未规定多边语义，这里显式钉死，不留随机顺序）。
 *
 * 已知限制（不在本切片修）：
 *   · `SqliteGraphStore.queryNodes/queryEdges/getNode` 内部把 SQL 异常吞成 `[]`/`null`（既有 fail-open），
 *     因此“查询层内部错误”不能在本文件区分；本文件的 `PERSISTENCE_ERROR` 覆盖取库/建 store/直查类型清单。
 *   · 1 跳邻接 = 出边 + 入边的对端（去重、不含根对象本身；自环不把根当邻接节点）。
 *   · 根＝`activity/delivery_batch` 时 1 跳只有 team（props 无 period/defVersion）⇒ count=0 ⇒
 *     `INSUFFICIENT_CONTEXT`（#1459 切片根类型钉死＝`resource/delivery_team`；batch 根为已知限制）。
 */
import { SqliteGraphStore } from '../../adapters/sqlite-graph-store';
import { EnterpriseScanError } from '../../connectors/enterprise-scan/errors';
import type { ScanViewer } from '../../connectors/enterprise-scan/types';
import { toScanViewer } from '../../connectors/enterprise-scan/visibility';
import { getDatabase } from '../../init/engine-context';
import { DshError, toDshError } from './errors';
import type { ContextSnapshot, ContextSnapshotItem, InsufficientContext, ToolCallContext } from './tools';

/** 有界返回上限（DEV DOC v3 §3.6：items ≤ 200，`truncated = count > items.length`）。 */
const MAX_ITEMS = 200;
/** problemId 上限（防御异常长输入；真实业务键/节点 id 远小于此）。 */
const MAX_PROBLEM_ID_CHARS = 256;

/** 1 跳关系（`relation` 的数据源：`graph_triples`）。 */
interface RelationHop {
  type: string;
  direction: 'out' | 'in';
  edgeId: string;
}

/** 邻接节点 + 命中它的那条边。 */
interface NeighborHop {
  id: string;
  relation: RelationHop;
}

/** 最新断言版本行（`evidence_status`／`instance_state` 的唯一来源）。 */
interface AssertionVersionRow {
  assertion_version_id: string;
  evidence_status: string;
  instance_state: string;
}

/** 断言版本 → 证据行（`source_ref` ＋ 逻辑 `evidence_id`）。 */
interface AssertionEvidenceRow {
  evidence_id: string;
  source_ref: string;
}

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

/** `relation` 同节点多条边时的确定性比较：out 优先 → type 升序 → edgeId 升序。 */
function compareHops(left: RelationHop, right: RelationHop): number {
  if (left.direction !== right.direction) return left.direction === 'out' ? -1 : 1;
  if (left.type !== right.type) return left.type < right.type ? -1 : 1;
  if (left.edgeId === right.edgeId) return 0;
  return left.edgeId < right.edgeId ? -1 : 1;
}

/**
 * 根对象的 1 跳邻接（出边对端 + 入边对端；去重、按 `$id` 升序、不含根本身），
 * 同时带回**命中该邻接节点的那条边**（`relation` 的数据源，不新增图查询方法）。
 */
function neighborHops(store: SqliteGraphStore, graph: string, rootId: string): NeighborHop[] {
  const hops = new Map<string, RelationHop>();
  const consider = (other: string, edge: { id: string; type: string }, direction: 'out' | 'in'): void => {
    if (other === rootId) return;
    const candidate: RelationHop = { type: edge.type, direction, edgeId: edge.id };
    const existing = hops.get(other);
    if (existing === undefined || compareHops(candidate, existing) < 0) hops.set(other, candidate);
  };
  for (const edge of store.queryEdges(undefined, rootId, undefined, graph)) consider(edge.to, edge, 'out');
  for (const edge of store.queryEdges(undefined, undefined, rootId, graph)) consider(edge.from, edge, 'in');
  return [...hops.entries()]
    .map(([id, relation]) => ({ id, relation }))
    .sort((left, right) => (left.id === right.id ? 0 : left.id < right.id ? -1 : 1));
}

/**
 * 节点**最新**断言版本：`ORDER BY created_at DESC, rowid DESC LIMIT 1`（#1459 钉子 1）。
 * 夹具多版本 `created_at` 逐字相同 ⇒ 只靠 `created_at` 无法定序，rowid 是稳定 tiebreak。
 * 无断言 ⇒ `null`（条目不产出 `evidence`，不补零）。
 */
function latestAssertionVersion(graph: string, nodeId: string): AssertionVersionRow | null {
  const row = getDatabase()
    .prepare(
      `SELECT av.assertion_version_id, av.evidence_status, av.instance_state
         FROM scan_assertions a
         JOIN scan_assertion_versions av ON av.graph = a.graph AND av.assertion_id = a.assertion_id
        WHERE a.graph = ? AND a.target_kind = 'node' AND a.target_object_id = ?
        ORDER BY av.created_at DESC, av.rowid DESC
        LIMIT 1`,
    )
    .get(graph, nodeId) as AssertionVersionRow | undefined;
  return row ?? null;
}

/**
 * 某断言版本的全部证据来源（`source_ref` ＋ 逻辑 `evidence_id`）。
 * 顺序：`source_ref ASC, evidence_id ASC`（稳定）；**按 ref 去重**（同一来源多版本不重复展示）。
 */
function assertionEvidence(graph: string, assertionVersionId: string): AssertionEvidenceRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT sev.evidence_id AS evidence_id, sae.source_ref AS source_ref
         FROM scan_assertion_evidence sae
         JOIN scan_evidence_versions sev
           ON sev.graph = sae.graph AND sev.evidence_version_id = sae.evidence_version_id
        WHERE sae.graph = ? AND sae.assertion_version_id = ?
        ORDER BY sae.source_ref ASC, sev.evidence_id ASC`,
    )
    .all(graph, assertionVersionId) as AssertionEvidenceRow[];
  const seen = new Set<string>();
  const deduped: AssertionEvidenceRow[] = [];
  for (const row of rows) {
    if (seen.has(row.source_ref)) continue;
    seen.add(row.source_ref);
    deduped.push(row);
  }
  return deduped;
}

/** 单条邻接节点 → 该条目的**缺失字段**（仅 period/defVersion 决定条目是否产出；用于 insufficient.missing）。 */
function missingItemFields(node: { props: Record<string, unknown> }, missing: Set<string>): void {
  const period = node.props.period;
  const defVersion = node.props.defVersion;
  if (typeof period !== 'string' || period.length === 0) missing.add('period');
  if (typeof defVersion !== 'string' || defVersion.length === 0) missing.add('defVersion');
}

/**
 * 单个邻接节点 → ② 条目；`period`/`defVersion` 必须同时是非空字符串，否则**不产出**（不补零、不编常量）。
 * `relation` 恒有（条目只来自 1 跳边）；`evidence` 仅在存在扫描断言版本时出现。
 */
function toContextItem(
  node: { id: string; props: Record<string, unknown> },
  relation: RelationHop,
  graph: string,
): ContextSnapshotItem | null {
  const period = node.props.period;
  const defVersion = node.props.defVersion;
  if (typeof period !== 'string' || period.length === 0) return null;
  if (typeof defVersion !== 'string' || defVersion.length === 0) return null;

  const latest = latestAssertionVersion(graph, node.id);
  const sources = latest === null ? [] : assertionEvidence(graph, latest.assertion_version_id);
  const item: ContextSnapshotItem = {
    layer: '②',
    $id: node.id,
    cycleVersion: null,
    sentinelRun: null,
    period,
    defVersion,
    evidenceId: sources[0]?.evidence_id ?? null,
    status: 'observed',
    visibility: 'enterprise',
    source: { kind: 'synova.domain', api: 'synova.domain/v1' },
    relation,
  };
  if (latest !== null) {
    item.evidence = {
      evidenceStatus: latest.evidence_status,
      instanceState: latest.instance_state,
      sources: sources.map(source => ({ ref: source.source_ref })),
    };
  }
  return item;
}

/**
 * `count===0` 的显式不足说明（返回字段，不是 error）。
 * `missing` 是**机器可读**的缺项类别：`neighbors`（无 1 跳关系）／`period`／`defVersion`（条目产出条件）／
 * `items`（邻域存在但均不满足，且缺项无法归类时的兜底）。
 */
function describeInsufficiency(
  problemId: string,
  neighborCount: number,
  missingFields: Set<string>,
): InsufficientContext {
  if (neighborCount === 0) {
    return {
      code: 'INSUFFICIENT_CONTEXT',
      reason: `根对象 ${problemId} 没有任何 1 跳关系，不足以形成瓶颈假设`,
      missing: ['neighbors'],
    };
  }
  const missing = missingFields.size > 0 ? [...missingFields].sort() : ['items'];
  return {
    code: 'INSUFFICIENT_CONTEXT',
    reason: `根对象 ${problemId} 的 ${String(neighborCount)} 个 1 跳邻接节点均不满足条目产出条件（需同时具备 period 与 defVersion），不足以形成瓶颈假设`,
    missing,
  };
}

/**
 * 构造真实领域 ContextSnapshot（**只读 ②**，本切片 ③④ 恒 0）。
 *
 * @input  ctx（服务端注入身份）＋ problemId（本企业 ② 对象 businessKey 或 $id）
 * @output 真实节点数据驱动的快照；同输入两次调用 JSON 逐字相等（无时间戳/随机值入内容）；
 *         `count===0` ⇒ 带 `insufficient` 字段（不抛 error）
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
    const hops = neighborHops(store, graph, rootId);
    const items: ContextSnapshotItem[] = [];
    const missingFields = new Set<string>();
    for (const hop of hops) {
      const node = store.getNode(hop.id, graph);
      if (node === null) continue;
      const item = toContextItem(node, hop.relation, graph);
      if (item !== null) {
        items.push(item);
      } else {
        missingItemFields(node, missingFields);
      }
    }
    const count = items.length;
    const snapshot: ContextSnapshot = {
      synthetic: false,
      problemId,
      count,
      truncated: count > MAX_ITEMS,
      items: items.slice(0, MAX_ITEMS),
    };
    if (count === 0) {
      snapshot.insufficient = describeInsufficiency(problemId, hops.length, missingFields);
    }
    return snapshot;
  } catch (err: unknown) {
    if (err instanceof DshError) throw err;
    // 复用既有码：存储层失败 = PERSISTENCE_ERROR（phase 'persist'，retryable=true 语义见 errors.ts CODE_META）。
    throw toDshError(err, { code: 'PERSISTENCE_ERROR', phase: 'persist' });
  }
}
