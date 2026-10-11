/**
 * src/l4/goal-alignment.ts — 目标一致：岗位目标 ↔ 公司目标 可追溯（#190 / K12-07）
 *
 * 架构位置: **② 本体层（代码层 L4）** —— GOAL 图节点 ＋ 目标分解边（GOAL_DECOMPOSITION）。
 *   沿分解边**向上逐跳**追到公司目标（卡面判据 V2）；反向**向下**取公司目标分解出的
 *   岗位目标集合（V3）。只读模块：不写图、不写库。
 *
 * 为什么需要它（卡面 §〇②）: 宪章 §2.7 的痛点「同一个目标被拆成互相打架的子目标」——
 *   系统里有 GOAL 节点，却**没有"分解"这条边** ⇒ 目标之间是孤岛，谁也说不清"我这个目标
 *   从公司哪条来的"。本模块 = 一致性第④层（目标一致）的载体：先有**可追溯关系**，
 *   考核/导航才谈得上目标生命周期。
 *
 * 边类型真源: `extensions/ontology/edge-types/goal_decomposition.json`（label `GOAL_DECOMPOSITION`）。
 *   端点矩阵由 `src/l4/ontology-loader.ts:100-106` 从该 JSON **动态构建** ⇒ 本模块**逐跳**都过
 *   `validateEdgeEndpoints()` 校验：矩阵里没有这条边（文件被删/改坏）⇒ 端点校验恒 false ⇒
 *   追溯 fail-closed 失败（与"断开分解边必红"同型，V4）。
 *
 * 类型轴兼容（V5「建档产出的 GOAL 节点接入本链路」）: 生产里 GOAL 节点有**两个实际字面量** ——
 *   `'GOAL'`（`src/growth/goal-store.ts:169` 目标写入）与 `'Goal'`（`src/agent/conversation-engine.ts:543-551`
 *   建档 Phase 0 访谈摘要）。SQLite 的 `type = ?` 比较**大小写敏感** ⇒ 只读 'GOAL' 会让建档产出的
 *   节点在链路上不可见。故读侧同时枚举两者（`GOAL_NODE_TYPE_LOCALS`），并把两者都写进端点矩阵
 *   （`allowedFrom/allowedTo`）—— 少任一个，V5 即红。
 *
 * 「公司级 / 岗位级」判定（**不猜，显式标记驱动**）: 读 `props.goalLevel ?? props.level ?? props.scope`
 *   （三个键名取自既有消费点 `src/sentinel/adapters/goal-alignment-sentinel.ts:38`），与
 *   `COMPANY_LEVEL_VALUES` 比对。**无标记 ⇒ 'unknown' ⇒ 不认定为公司级**（fail-closed：宁可报
 *   "不可追溯"，也不把链顶当成公司目标——那会让"断开分解边"变成假绿，直接废掉 V4）。
 *
 * 契约（铁律 47）:
 *   @input  — `store`（`GoalAlignmentStore`：`queryNodes` 必需；`queryEdges` **可选**，缺席即降级）
 *             ＋ `goalRef`（图节点 id **或** 实体 `props.goalId`，两种写法都收；命中不到 ⇒ 明确报不存在，
 *                不取"最像的那个"）
 *             ＋ `graph`（租户图名，缺省 `'default'`）
 *   @output — `traceGoalToCompany` → `GoalAlignmentTrace`：{ goalId, startNodeId, satisfied,
 *               companyGoalId, companyNodeId, path[]（起点→…→公司目标）, hops[]（**逐跳**边）,
 *               degraded, errors[] }
 *             `listDecomposedGoals` → `GoalDecomposition`：{ companyGoalId, companyNodeId, company,
 *               goals[]（全部下级）, roleGoals[]（岗位级下级）, hops[], degraded, errors[] }
 *   @degraded — **能力/环境失败**（铁律 11/24/31，禁静默）⇒ `degraded:true` ＋ `log.warn/log.error`
 *               ＋ 原因进 `errors[]`。触发面: ① store 无 `queryEdges` ② `queryNodes/queryEdges` 抛错
 *               ③ 端点矩阵不含本边类型。
 *             **数据问题**（目标不存在 / 无父分解边 ⇒ 追不到公司目标 / 成环 / 多父全部不通 /
 *               起点非公司级）⇒ `satisfied:false` ＋ `errors[]`，但 `degraded` **仍 false**
 *               —— 是链路本身不完整，不是模块坏了。两类**必须分开**，否则"未接入"会被读成"系统故障"。
 *
 * 确定性（同输入同输出，可复跑）: 候选父边按 `(from, edgeId)` 升序、BFS 取**最短链**；
 *   同输入两次运行的 `path/hops` 逐字节一致（多父菱形图谱亦同）。
 */
import { createLogger } from '@synova/logger';
import { EdgeType } from '@synova/ontology';
import { validateEdgeEndpoints } from './ontology-loader';

const log = createLogger('l4/goal-alignment');

// ═══ 常量（本体真源在此声明一次，JSON 侧为端点矩阵真源）═══

/**
 * 分解边 label —— **走共享契约包**（`@synova/ontology` 的 `EdgeType`），不在本模块自留字面量副本。
 * 出处: 卡面 Q1 memory 教训（内容面规范 §3.3「类型走契约包」）：新边类型被引擎消费 ⇒
 * 类型应登记在 `packages/ontology/src/edge-types.ts`（与该 JSON 的 `label` 逐字一致）。
 */
const GOAL_DECOMPOSITION_EDGE: string = EdgeType.GOAL_DECOMPOSITION;

/**
 * 生产实际写入的 GOAL 节点字面量（大小写敏感，两个都要枚举）。
 * 见文件头「类型轴兼容」；少任一个 ⇒ 该侧节点在本链路上不可见。
 */
const GOAL_NODE_TYPE_LOCALS: readonly string[] = ['GOAL', 'Goal'];

/** 公司级标记取值（小写比对）。 */
const COMPANY_LEVEL_VALUES: readonly string[] = ['company', 'org', 'organization', 'corporate', 'group'];

/** 层级标记键名（首命中优先）——沿用既有消费点 goal-alignment-sentinel.ts:38 的 `level || scope`。 */
const LEVEL_KEYS: readonly string[] = ['goalLevel', 'level', 'scope'];

/** BFS 上限（防病态图拖死调用方；成环另有 visited 兜底）。 */
const MAX_TRACE_NODES = 500;

// ═══ 类型 ═══

/** 图节点最小形状（`type` 可选 —— 兼容只返回 {id, props} 的窄 store）。 */
export interface GoalAlignmentNode {
  readonly id: string;
  readonly type?: string;
  readonly props: Record<string, unknown>;
}

/** 图边最小形状（`id`/`weight` 可选 —— 兼容只返回 {from,to,type,props} 的窄 store）。 */
export interface GoalAlignmentEdge {
  readonly id?: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly weight?: number;
  readonly props: Record<string, unknown>;
}

/**
 * 本模块所需的存储能力（结构化，非名义类型 ⇒ SqliteGraphStore / GraphBridge / 窄 fake 皆可传）。
 * `queryEdges` **可选**：缺席 ⇒ `degraded:true`，绝不假装"没有分解边"。
 */
export interface GoalAlignmentStore {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): GoalAlignmentNode[];
  queryEdges?(type?: string, from?: string, to?: string, graph?: string): GoalAlignmentEdge[];
}

/** 目标节点视图（对外形状，不含图内部字段）。 */
export interface GoalNodeView {
  readonly nodeId: string;
  readonly goalId: string;
  readonly title: string;
  readonly level: string;
  readonly ownerDeptId: string;
}

/**
 * 逐跳链路的一跳。
 *
 * 🔴 `parentId`/`childId` 与**图中边的存储方向逐字一致**（分解边 = 父 → 子，
 *   `graph_triples.subject_id = 父`）：这样 `edgeId` 可直接回查 `queryEdges()` 复核，
 *   不引入"层内方向与存储方向相反"的第二套语义。`hops[]` 数组本身按**遍历序**排列
 *   （起点在下、链顶在后）⇒ 沿 `hops[i].parentId` 依次读即为 岗位 ← … ← 公司。
 */
export interface GoalHop {
  readonly edgeId: string;
  readonly parentId: string;
  readonly childId: string;
  readonly parentLevel: string;
  readonly childLevel: string;
}

/** 向上追溯结果（岗位目标 ⇒ 公司目标，逐跳）。 */
export interface GoalAlignmentTrace {
  readonly goalId: string;
  readonly startNodeId: string | null;
  readonly satisfied: boolean;
  readonly companyGoalId: string | null;
  readonly companyNodeId: string | null;
  readonly path: readonly GoalNodeView[];
  readonly hops: readonly GoalHop[];
  readonly degraded: boolean;
  readonly errors: readonly string[];
}

/** 向下分解结果（公司目标 ⇒ 岗位目标集合）。 */
export interface GoalDecomposition {
  readonly companyGoalId: string;
  readonly companyNodeId: string | null;
  readonly company: GoalNodeView | null;
  readonly goals: readonly GoalNodeView[];
  readonly roleGoals: readonly GoalNodeView[];
  readonly hops: readonly GoalHop[];
  readonly degraded: boolean;
  readonly errors: readonly string[];
}

/** 内部累积：降级位（errors[] 由调用方共享累加）。 */
interface TraceState {
  degraded: boolean;
}

/** 内部 GOAL 节点索引。 */
interface GoalIndex {
  readonly byId: Map<string, GoalNodeView>;
  readonly typeOf: Map<string, string>;
  readonly nodeIdByEntityId: Map<string, string>;
}

// ═══ 小工具 ═══

/** 读非空字符串属性（其它类型一律 null —— 不 String() 化数字/对象，避免把脏值读成合法值）。 */
function readText(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** 解析层级标记（首命中优先；无标记 ⇒ 'unknown'）。 */
function resolveGoalLevel(props: Record<string, unknown>): string {
  for (const key of LEVEL_KEYS) {
    const value = readText(props, key);
    if (value !== null) return value.toLowerCase();
  }
  return 'unknown';
}

/** 是否公司级（fail-closed：'unknown' 一律不算）。 */
function isCompanyLevel(level: string): boolean {
  return COMPANY_LEVEL_VALUES.includes(level);
}

/** 图节点 → 对外视图（title 兼容 goal-store 的 `title` 与旧哨兵的 `name`）。 */
function toGoalNodeView(nodeId: string, props: Record<string, unknown>): GoalNodeView {
  return {
    nodeId,
    goalId: readText(props, 'goalId') ?? nodeId,
    title: readText(props, 'title') ?? readText(props, 'name') ?? nodeId,
    level: resolveGoalLevel(props),
    ownerDeptId: readText(props, 'ownerDeptId') ?? '',
  };
}

/** 边 id 兜底（窄 store 可能不返回 id —— 用 from→to 合成，仅供错误信息定位）。 */
function edgeLabelOf(edge: GoalAlignmentEdge): string {
  return edge.id ?? `${edge.from}->${edge.to}`;
}

/**
 * 枚举 GOAL/Goal 节点建索引。
 *
 * @input  store / graph / errors（共享累加）
 * @output 索引；**queryNodes 抛错 ⇒ null**（调用方转 degraded，绝不返回空索引假装"没有目标"）
 * @degraded 抛错 ⇒ `log.error` ＋ 写 `state.degraded` ＋ 原因进 errors[]
 */
function loadGoalIndex(
  store: GoalAlignmentStore,
  graph: string,
  errors: string[],
  state: TraceState,
): GoalIndex | null {
  const byId = new Map<string, GoalNodeView>();
  const typeOf = new Map<string, string>();
  const nodeIdByEntityId = new Map<string, string>();
  try {
    for (const nodeType of GOAL_NODE_TYPE_LOCALS) {
      const rows = store.queryNodes(nodeType, {}, graph);
      for (const row of rows) {
        if (byId.has(row.id)) continue;
        const view = toGoalNodeView(row.id, row.props);
        byId.set(row.id, view);
        typeOf.set(row.id, nodeType);
        if (!nodeIdByEntityId.has(view.goalId)) nodeIdByEntityId.set(view.goalId, row.id);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`GOAL 节点枚举失败: ${msg}`);
    log.error({ err: msg, graph }, '目标一致 — 节点枚举失败（degraded）');
    state.degraded = true;
    return null;
  }
  return { byId, typeOf, nodeIdByEntityId };
}

/** 解析 `goalRef`（图节点 id 或实体 goalId）→ 视图；命中不到 ⇒ null（fail-closed，不猜）。 */
function resolveGoalRef(index: GoalIndex, goalRef: string): GoalNodeView | null {
  const direct = index.byId.get(goalRef);
  if (direct !== undefined) return direct;
  const byEntity = index.nodeIdByEntityId.get(goalRef);
  if (byEntity === undefined) return null;
  return index.byId.get(byEntity) ?? null;
}

/**
 * 读分解边（**能力检测 + 显式降级**）。
 *
 * @input  store / 过滤条件（from/to 任一可省）/ graph / errors / state
 * @output 边数组；**无能力或抛错 ⇒ null**（调用方终止遍历并保留 degraded）
 * @degraded 无 `queryEdges` ⇒ `log.warn` ＋ `state.degraded=true` ＋ errors[]；抛错 ⇒ `log.error` 同型
 */
function readDecompositionEdges(
  store: GoalAlignmentStore,
  filter: { readonly from?: string; readonly to?: string },
  graph: string,
  errors: string[],
  state: TraceState,
): GoalAlignmentEdge[] | null {
  if (typeof store.queryEdges !== 'function') {
    const msg = 'store 无 queryEdges 能力 ⇒ 读不到分解边（降级：目标一致不可用，非"无分解边"）';
    errors.push(msg);
    log.warn({ graph }, msg);
    state.degraded = true;
    return null;
  }
  try {
    return store.queryEdges(GOAL_DECOMPOSITION_EDGE, filter.from, filter.to, graph);
  } catch (err: unknown) {
    const msg = `读分解边失败: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    log.error({ err: err instanceof Error ? err.message : String(err), graph }, '目标一致 — 读分解边失败（degraded）');
    state.degraded = true;
    return null;
  }
}

/**
 * 一跳的端点矩阵校验（**逐跳**）。
 *
 * @input  fromType（下级节点实际字面量）/ toType（上级节点实际字面量）
 * @output true = 矩阵放行；false = 拒（含"矩阵里根本没有这条边"的情形）
 * @degraded 无 —— 纯查表；加载器自身失败时 `validateEdgeEndpoints` 返回 false（fail-closed 由返回值承载）
 */
function passesEndpointMatrix(fromType: string, toType: string): boolean {
  try {
    return validateEdgeEndpoints(GOAL_DECOMPOSITION_EDGE, fromType, toType);
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, '端点矩阵校验抛错 — 按不通过处理（fail-closed）');
    return false;
  }
}

/** 排序键：保证同输入同输出（先 from，再 edgeId）。 */
function compareEdges(a: GoalAlignmentEdge, b: GoalAlignmentEdge): number {
  if (a.from !== b.from) return a.from.localeCompare(b.from);
  return edgeLabelOf(a).localeCompare(edgeLabelOf(b));
}

/**
 * 组装一条候选跳（含端点矩阵 + 成环校验）。
 *
 * @input  edge / index / visited / errors
 * @output GoalHop（合法）｜ null（拒：起点非目标节点 / 未过端点矩阵 / 成环）——拒因写 errors[]
 */
function buildHop(
  edge: GoalAlignmentEdge,
  index: GoalIndex,
  visited: ReadonlySet<string>,
  errors: string[],
): GoalHop | null {
  const parent = index.byId.get(edge.from);
  if (parent === undefined) {
    errors.push(`分解边 ${edgeLabelOf(edge)} 的起点 ${edge.from} 不是 GOAL/Goal 节点 ⇒ 拒绝遍历（端点矩阵 fail-closed）`);
    return null;
  }
  if (visited.has(parent.nodeId)) {
    errors.push(`分解边成环：${edgeLabelOf(edge)} 指回已访问节点 ${parent.nodeId} ⇒ 跳过该跳`);
    return null;
  }
  const fromType = index.typeOf.get(edge.from) ?? '';
  const toType = index.typeOf.get(edge.to) ?? '';
  if (!passesEndpointMatrix(fromType, toType)) {
    errors.push(`分解边 ${edgeLabelOf(edge)} 端点 (${fromType} → ${toType}) 未过端点矩阵校验 ⇒ 拒绝遍历`);
    return null;
  }
  return {
    edgeId: edgeLabelOf(edge),
    parentId: edge.from,
    childId: edge.to,
    parentLevel: parent.level,
    childLevel: index.byId.get(edge.to)?.level ?? 'unknown',
  };
}

// ═══ 公开函数 ═══

/**
 * 向上追溯：任一目标 ⇒ 到公司目标的**逐跳**链路（卡面 V2）。
 *
 * 入口: `src/l3/briefing-generator.ts` → `BriefingGenerator.generate()`（生产每日简报）。
 *
 * @input  — store（含 queryNodes；queryEdges 可选）/ goalRef（图节点 id 或实体 goalId）/ graph
 * @output — `GoalAlignmentTrace`；`satisfied:true` ⟺ 沿分解边抵达**公司级**目标
 *           （起点自身即公司级 ⇒ satisfied:true、hops 空、path 仅起点）
 * @degraded — 见文件头契约；能力/环境失败 ⇒ true（数据问题 ⇒ 仅 `satisfied:false`）
 */
export function traceGoalToCompany(
  store: GoalAlignmentStore,
  goalRef: string,
  graph: string = 'default',
): GoalAlignmentTrace {
  const errors: string[] = [];
  const state: TraceState = { degraded: false };
  const empty = (startNodeId: string | null): GoalAlignmentTrace => ({
    goalId: goalRef,
    startNodeId,
    satisfied: false,
    companyGoalId: null,
    companyNodeId: null,
    path: [],
    hops: [],
    degraded: state.degraded,
    errors,
  });

  const index = loadGoalIndex(store, graph, errors, state);
  if (index === null) return empty(null);

  const start = resolveGoalRef(index, goalRef);
  if (start === null) {
    errors.push(`目标不存在: ${goalRef}（既非图节点 id，也非 props.goalId ⇒ fail-closed，不猜）`);
    log.warn({ goalRef, graph }, '目标一致 — 目标不存在，追溯 fail-closed');
    return empty(null);
  }

  // 起点即公司级 —— 它自己就是链顶
  if (isCompanyLevel(start.level)) {
    log.info({ goalRef, nodeId: start.nodeId, level: start.level }, '目标一致 — 起点本身即公司级目标');
    return {
      goalId: goalRef,
      startNodeId: start.nodeId,
      satisfied: true,
      companyGoalId: start.goalId,
      companyNodeId: start.nodeId,
      path: [start],
      hops: [],
      degraded: state.degraded,
      errors,
    };
  }

  interface Frame {
    readonly node: GoalNodeView;
    readonly path: readonly GoalNodeView[];
    readonly hops: readonly GoalHop[];
    readonly visited: ReadonlySet<string>;
  }

  const queue: Frame[] = [{ node: start, path: [start], hops: [], visited: new Set([start.nodeId]) }];
  const tops: string[] = [];
  const walked = new Set<string>([start.nodeId]);

  for (let i = 0; i < queue.length; i += 1) {
    const frame = queue[i];
    if (walked.size > MAX_TRACE_NODES) {
      errors.push(`追溯节点数超过上限 ${String(MAX_TRACE_NODES)} ⇒ 终止（防病态图）`);
      break;
    }
    walked.add(frame.node.nodeId);

    const incoming = readDecompositionEdges(store, { to: frame.node.nodeId }, graph, errors, state);
    if (incoming === null) break; // 能力缺失/抛错 ⇒ 终止（degraded 已置位）

    const candidates = [...incoming].sort(compareEdges);
    let accepted = 0;
    for (const edge of candidates) {
      const hop = buildHop(edge, index, frame.visited, errors);
      if (hop === null) continue;
      accepted += 1;
      const parent = index.byId.get(edge.from);
      if (parent === undefined) continue; // buildHop 已拒并记账，此处仅为类型收敛
      const nextPath = [...frame.path, parent];
      const nextHops = [...frame.hops, hop];

      if (isCompanyLevel(parent.level)) {
        log.info(
          { goalRef, hops: nextHops.length, company: parent.goalId, chain: nextPath.map((n) => n.goalId).join(' <- ') },
          '目标一致 — 追溯成功（逐跳链路）',
        );
        return {
          goalId: goalRef,
          startNodeId: start.nodeId,
          satisfied: true,
          companyGoalId: parent.goalId,
          companyNodeId: parent.nodeId,
          path: nextPath,
          hops: nextHops,
          degraded: state.degraded,
          errors,
        };
      }
      queue.push({
        node: parent,
        path: nextPath,
        hops: nextHops,
        visited: new Set([...frame.visited, parent.nodeId]),
      });
    }
    if (accepted === 0) tops.push(frame.node.nodeId);
  }

  errors.push(
    `沿 ${GOAL_DECOMPOSITION_EDGE} 向上未抵达公司目标（链顶: ${tops.join(', ') || '无'}；`
    + `公司级标记 ${LEVEL_KEYS.join('/')} ∈ [${COMPANY_LEVEL_VALUES.join('/')}] 未命中）⇒ fail-closed`,
  );
  log.warn({ goalRef, graph, tops: tops.length }, '目标一致 — 追溯未达公司目标（fail-closed）');
  return empty(start.nodeId);
}

/**
 * 向下分解：公司目标 ⇒ 分解到的**岗位目标集合**（卡面 V3）。
 *
 * 入口: 同 `traceGoalToCompany`（`BriefingGenerator.generate()` 对每个公司级目标取下级计数）。
 *
 * @input  — store / companyRef（图节点 id 或实体 goalId）/ graph
 * @output — `GoalDecomposition`；`goals` = 全部下级（不含起点），`roleGoals` = 其中**非公司级**的下级；
 *           起点非公司级 ⇒ **fail-closed**（`goals/roleGoals` 空 ＋ 显式 errors，不拿中层目标冒充公司目标）
 * @degraded — 见文件头契约（能力/环境失败 ⇒ true；起点不存在/非公司级 ⇒ false ＋ errors）
 */
export function listDecomposedGoals(
  store: GoalAlignmentStore,
  companyRef: string,
  graph: string = 'default',
): GoalDecomposition {
  const errors: string[] = [];
  const state: TraceState = { degraded: false };
  const failed = (): GoalDecomposition => ({
    companyGoalId: companyRef,
    companyNodeId: null,
    company: null,
    goals: [],
    roleGoals: [],
    hops: [],
    degraded: state.degraded,
    errors,
  });

  const index = loadGoalIndex(store, graph, errors, state);
  if (index === null) return failed();

  const start = resolveGoalRef(index, companyRef);
  if (start === null) {
    errors.push(`公司目标不存在: ${companyRef}（既非图节点 id，也非 props.goalId ⇒ fail-closed，不猜）`);
    log.warn({ companyRef, graph }, '目标一致 — 公司目标不存在，反查 fail-closed');
    return failed();
  }
  if (!isCompanyLevel(start.level)) {
    errors.push(
      `起点非公司级目标（${LEVEL_KEYS.join('/')}=${start.level}）⇒ 不返回分解集合（fail-closed，不用中层目标冒充公司目标）`,
    );
    log.warn({ companyRef, level: start.level }, '目标一致 — 起点非公司级，反查 fail-closed');
    return {
      companyGoalId: start.goalId,
      companyNodeId: start.nodeId,
      company: start,
      goals: [],
      roleGoals: [],
      hops: [],
      degraded: state.degraded,
      errors,
    };
  }

  const goals: GoalNodeView[] = [];
  const roleGoals: GoalNodeView[] = [];
  const hops: GoalHop[] = [];
  const seen = new Set<string>([start.nodeId]);
  const queue: GoalNodeView[] = [start];

  for (let i = 0; i < queue.length && seen.size <= MAX_TRACE_NODES; i += 1) {
    const current = queue[i];
    const outgoing = readDecompositionEdges(store, { from: current.nodeId }, graph, errors, state);
    if (outgoing === null) break; // 能力缺失/抛错 ⇒ 终止（degraded 已置位）

    for (const edge of [...outgoing].sort(compareEdges)) {
      const child = index.byId.get(edge.to);
      if (child === undefined) {
        errors.push(`分解边 ${edgeLabelOf(edge)} 的终点 ${edge.to} 不是 GOAL/Goal 节点 ⇒ 拒绝遍历（端点矩阵 fail-closed）`);
        continue;
      }
      if (seen.has(child.nodeId)) continue; // 菱形/成环：去重（不重复计入集合）
      const fromType = index.typeOf.get(edge.from) ?? '';
      const toType = index.typeOf.get(edge.to) ?? '';
      if (!passesEndpointMatrix(fromType, toType)) {
        errors.push(`分解边 ${edgeLabelOf(edge)} 端点 (${fromType} → ${toType}) 未过端点矩阵校验 ⇒ 拒绝遍历`);
        continue;
      }
      seen.add(child.nodeId);
      goals.push(child);
      if (!isCompanyLevel(child.level)) roleGoals.push(child);
      hops.push({
        edgeId: edgeLabelOf(edge),
        parentId: edge.from,
        childId: edge.to,
        parentLevel: current.level,
        childLevel: child.level,
      });
      queue.push(child);
    }
  }

  log.info(
    { companyRef, goals: goals.length, roleGoals: roleGoals.length, hops: hops.length },
    '目标一致 — 反查分解集合完成',
  );
  return {
    companyGoalId: start.goalId,
    companyNodeId: start.nodeId,
    company: start,
    goals,
    roleGoals,
    hops,
    degraded: state.degraded,
    errors,
  };
}
