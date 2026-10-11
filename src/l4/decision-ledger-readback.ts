/**
 * decision-ledger-readback.ts — J5 / #405：④ 决策台账**读回**面 ＋ 进程级读口接缝
 *
 * 为什么是独立模块（而不是加在 decision-capture.ts）：
 *   `tests/l4/decision-capture-single-entry.test.ts:215` 守卫「决策模块可调用导出只有
 *   captureDecision 一个」（单一写入口不变量，K12-08 立）——读侧导出进同文件会破该守卫。
 *   写读仍**同源**：边类型全集 DECISION_EDGE_TYPES 与台账行 schema 均从 decision-capture 导入，
 *   本文件不复制任何口径（型 G 防线）。
 *
 * 读原语 = 图存储的 queryEdges（与 createEdge 同一张 graph_triples 表，仅返回未删除边）。
 */
import { createLogger } from '@synova/logger';
import { DECISION_EDGE_TYPES, type DecisionLedgerRow } from './decision-capture';

const log = createLogger('l4/decision-ledger-readback');

/** 读回查询入参（全部可选；nodeId=按决策对象过滤, userId=按裁决人过滤, limit=截取前 N 行） */
export interface DecisionLedgerQuery {
  nodeId?: string;
  userId?: string;
  limit?: number;
}

/** 一条读回项：边 + 反序列化后的台账行 */
export interface DecisionLedgerEntry {
  edgeId: string;
  edgeType: string;
  row: DecisionLedgerRow;
}

/** 读回结果 —— ok=false 时 errors 必在场（禁静默，铁律 24/31） */
export interface DecisionLedgerReadResult {
  ok: boolean;
  entries: DecisionLedgerEntry[];
  errors?: string[];
}

/** 读侧存储形状：只需 queryEdges 一个原语（写侧 DecisionStore 不动） */
interface DecisionReadableStore {
  queryEdges(
    type?: string, from?: string, to?: string, graph?: string,
  ): Array<{ id: string; type: string; from?: string; to?: string; props?: Record<string, unknown> }>;
}

/**
 * 读回 ④ 决策台账（append-only 行，按落账时间倒序）。
 *
 * 契约（铁律 47）:
 *   @input  store  — 图存储实例（需 queryEdges；SqliteGraphStore 天然满足）
 *           query  — { nodeId?, userId?, limit? }
 *           graph  — 图名（与写入侧同口径）
 *   @output ok=true ⇒ entries（可能为空数组——空是合法业务态"还没人裁过"，不是降级）
 *           ok=false ⇒ errors 在场（store 形状不符 / 查询异常 / 行损坏，**不抛**）
 *   @degraded store 无 queryEdges ⇒ ok=false + errors=['READ_PRIMITIVE_MISSING: …']（显式）
 */
export function listDecisionRows(
  store: unknown,
  query: DecisionLedgerQuery = {},
  graph = 'default',
): DecisionLedgerReadResult {
  if (store === null || typeof store !== 'object'
    || typeof (store as { queryEdges?: unknown }).queryEdges !== 'function') {
    const message = 'READ_PRIMITIVE_MISSING: 图存储无 queryEdges 原语 — 台账读回不可用（不静默返回空）';
    log.warn({ graph }, message);
    return { ok: false, entries: [], errors: [message] };
  }
  const readable = store as DecisionReadableStore;
  const errors: string[] = [];
  const entries: DecisionLedgerEntry[] = [];
  for (const edgeType of DECISION_EDGE_TYPES) {
    let edges: ReturnType<DecisionReadableStore['queryEdges']>;
    try {
      edges = readable.queryEdges(edgeType, query.userId, query.nodeId, graph);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`QUERY_FAILED(${edgeType}): ${msg}`);
      continue;
    }
    for (const edge of edges) {
      const raw = edge?.props?.ledger;
      if (typeof raw !== 'string' || raw === '') continue;
      try {
        entries.push({ edgeId: edge.id, edgeType, row: JSON.parse(raw) as DecisionLedgerRow });
      } catch {
        errors.push(`ROW_CORRUPT(edge=${edge.id}): 台账行 JSON 损坏 — 跳过该行（不静默）`);
      }
    }
  }
  if (errors.length > 0) {
    log.warn({ graph, count: errors.length }, '决策台账读回部分降级（详见 errors）');
    return { ok: false, entries, errors };
  }
  entries.sort((a, b) => (a.row.at < b.row.at ? 1 : a.row.at > b.row.at ? -1 : 0));
  const limit = typeof query.limit === 'number' && query.limit > 0 ? query.limit : entries.length;
  return { ok: true, entries: entries.slice(0, limit) };
}

// ── 进程级读回接缝（形态对齐 conversation-engine 的 setDecisionRecordingSeam 先例）──
// 为什么进程级：L1 路由不持 Bootstrap 服务（铁律 39 经 L2/L4 出口），与写侧同一模式。

/** 读回端口：给定图名 ⇒ 给定查询 ⇒ 读回结果（装配层用真图存储构造） */
export type DecisionLedgerReaderPort =
  (graph?: string) => (query: DecisionLedgerQuery) => DecisionLedgerReadResult;

let ledgerReaderPort: DecisionLedgerReaderPort | null = null;

/** 装配层注册读回端口（bootstrap 调；未注册 ⇒ 消费方拿到 null 并显式降级） */
export function setDecisionLedgerReader(port: DecisionLedgerReaderPort): void {
  ledgerReaderPort = port;
}

/** 取读回端口；未装配 ⇒ null（调用方据此 503 + code，不静默） */
export function getDecisionLedgerReader(): DecisionLedgerReaderPort | null {
  return ledgerReaderPort;
}
