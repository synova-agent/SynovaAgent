/**
 * src/growth/goal-store.ts — Goal 持久化存储
 *
 * 基于 GraphStore 的 GOAL 类型节点存储，复用 createNode/queryNodes/updateNode/getNode。
 * 实现 17 条状态转换规则 + AuditStore 审计日志。
 *
 * 契约:
 *   @input  — Goal 对象 + GraphBridgeLike（依赖注入）
 *   @output — createGoal 返回 goalId，其他函数按定义返回
 *   @degraded — GraphStore 不可用时返回降级结果，不崩溃
 */
import { randomUUID } from 'crypto';
import { createLogger } from '@synova/logger';
import { GOAL_ASSIGNMENT_NODE_TYPE } from './goal-types';
import type {
  Goal, GoalStatus, GraphBridgeLike, AuditStoreLike, TransitionRule,
  GoalMember, GoalAssignment, GoalCoverage, GoalPropagationResult,
} from './goal-types';
import { DecisionRecordStore } from './decision-record';

const log = createLogger('growth/goal-store');

// ═══ 17 条状态转换规则（权威文档 §3.2 完整清单） ═══

/**
 * Goal 状态转换规则表。
 * 每条规则标注 from→to 方向 + 前置条件说明。
 * 非法转换（不在表中的组合）被 updateGoalStatus 拒绝。
 */
export const TRANSITION_RULES: TransitionRule[] = [
  { from: 'draft', to: 'pending_ga', description: '提交GA审核', precondition: '28字段中 title/deadline/ownerDeptId/≥1 metric 非空' },
  { from: 'draft', to: 'abandoned', description: '创建者可在确认前废弃' },
  { from: 'pending_ga', to: 'active', description: 'GA确认标记，开始执行' },
  { from: 'pending_ga', to: 'draft', description: 'GA驳回，返回修改' },
  { from: 'pending_ga', to: 'abandoned', description: 'GA拒绝并废弃' },
  { from: 'active', to: 'completed', description: '所有 SuccessCriterion.verified === true', precondition: '全部 successCriteria 的 verified 字段为 true' },
  { from: 'active', to: 'paused', description: '中层或GA暂停执行' },
  { from: 'active', to: 'abandoned', description: '仅GA权限 + 废弃原因非空' },
  { from: 'paused', to: 'active', description: '恢复执行' },
  { from: 'paused', to: 'abandoned', description: '暂停超过90天自动废弃' },
  { from: 'completed', to: 'archived', description: '30天自动归档' },
  { from: 'abandoned', to: 'archived', description: '30天自动归档' },
];

/**
 * 判断状态转换是否合法（是否符合 17 条规则中的一条）。
 * @returns true=合法, false=非法
 */
export function isValidTransition(from: GoalStatus, to: GoalStatus): boolean {
  if (from === to) return true; // 允许原地更新（仅 metrics 等字段变化）
  return TRANSITION_RULES.some(r => r.from === from && r.to === to);
}

/**
 * 检查从 draft→pending_ga 的前置条件是否满足。
 * 仅检查 title/deadline/ownerDeptId/≥1 metric 非空。
 */
export function checkDraftPreconditions(goal: Goal): { valid: boolean; reason?: string } {
  if (!goal.title || goal.title.trim().length === 0) {
    return { valid: false, reason: 'title 为空' };
  }
  if (!goal.deadline || goal.deadline.trim().length === 0) {
    return { valid: false, reason: 'deadline 为空' };
  }
  if (!goal.ownerDeptId || goal.ownerDeptId.trim().length === 0) {
    return { valid: false, reason: 'ownerDeptId 为空' };
  }
  if (!goal.metrics || goal.metrics.length === 0) {
    return { valid: false, reason: '至少需要一个 metric' };
  }
  return { valid: true };
}

/**
 * 检查 active→completed 的前置条件：全部 successCriteria verified。
 */
export function checkCompletionPreconditions(goal: Goal): { valid: boolean; reason?: string } {
  if (!goal.successCriteria || goal.successCriteria.length === 0) {
    return { valid: false, reason: 'successCriteria 为空，无法判定完成' };
  }
  const unverified = goal.successCriteria.filter(sc => !sc.verified);
  if (unverified.length > 0) {
    return { valid: false, reason: `仍有 ${unverified.length} 个条件未验证` };
  }
  return { valid: true };
}

// ═══ CRUD 操作 ═══

/**
 * 创建 Goal 并持久化到 GraphStore。
 *
 * @param goal - 不含 goalId 的 Goal 数据（goalId 由本函数生成）
 * @param store - GraphBridge 实例
 * @param audit - AuditStore 实例（用于记录创建审计事件）
 * @param graph - 图名称（默认 'growth'）
 * @returns 生成的 goalId
 */
export function createGoal(goal: Goal, store: GraphBridgeLike, audit: AuditStoreLike, graph: string = 'growth'): string {
  const goalId = randomUUID();

  // 来源三类由下面的 `...goal` 原样透传（无需白名单）：
  //   diagnosisId（诊断驱动，已有）/ decisionRecordId（决策驱动，导航 §2.2 新增）/ externalEventId（外部驱动）
  const goalNode: Goal = {
    ...goal,
    goalId,
    status: goal.status || 'draft',
    createdAt: goal.createdAt || new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
    reDiagnosisCount: goal.reDiagnosisCount || 0,
  };

  try {
    store.createNode('GOAL', goalNode as unknown as Record<string, unknown>, graph);
    log.info({ goalId, title: goal.title }, 'Goal 已创建');

    // 决策驱动：把 Goal 关联回 DecisionRecord（导航 §2.3 决策→分解为 Goal 的闭环）。
    // 失败不阻断 Goal 创建（degraded：Goal 已落地，仅关联缺失）。
    if (goal.decisionRecordId !== undefined) {
      const linked = new DecisionRecordStore(store, graph).linkGoal(goal.decisionRecordId, goalId);
      if (!linked.ok) {
        log.warn(
          { decisionRecordId: goal.decisionRecordId, goalId, err: linked.error },
          'Goal 已创建，但决策记录关联失败 — degraded',
        );
      }
    }

    // 写入创建审计日志（fire-and-forget，失败不阻断）
    audit.write({
      orgId: goal.orgId,
      actorId: 'system:goal-store',
      actorRole: 'system',
      action: 'goal.created',
      targetType: 'GOAL',
      targetId: goalId,
      newValue: JSON.stringify({ title: goal.title, ownerDeptId: goal.ownerDeptId }),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, goalId }, 'Goal 创建审计日志写入失败');
    });

    return goalId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId }, 'Goal 创建失败');
    throw new Error(`创建 Goal 失败: ${msg}`);
  }
}

/**
 * 按 goalId 获取 Goal。
 * @returns Goal 对象，不存在时返回 null
 */
export function getGoal(goalId: string, store: GraphBridgeLike, graph: string = 'growth'): Goal | null {
  try {
    // #1010: 解析顺序改为 props.goalId 反查优先（见 resolveGoalNodeId）—— 真实 SqliteGraphStore
    // 的节点 id 恒为 `node-<uuid>`，而 goalId 只存在于 props；只按节点 id 查会让
    // getGoal/updateGoalStatus/closeGoal 整条关闭路径在生产 store 上"查不到自己的 Goal"。
    // 解析失败回退 goalId（旧式/内存 store 语义不变）。
    const nodeRef = resolveGoalNodeId(goalId, store, graph) ?? goalId;
    const node = store.getNode(nodeRef, graph) as { id: string; type: string; props: Record<string, unknown> } | null;
    if (!node) return null;
    return node.props as unknown as Goal;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId }, '获取 Goal 失败');
    return null;
  }
}

/**
 * 按部门 ID 列出所有 Goal。
 */
/**
 * #1010: 解析 Goal 的**图节点 id**（updateGoalStatus / closeGoal 关闭路径的解析器）。
 *
 * 为什么需要：真实 `SqliteGraphStore.createNode` 恒生成 `node-<uuid>` 作节点 id，而 Goal 的
 * 业务标识 `goalId` 只存在 props 里 ⇒ 用 goalId 调 `updateNode` 是 0 行 UPDATE（静默无效果）。
 * 解析顺序与 `getGoal` 同源：props.goalId 反查（严格匹配）→ 节点 id 兜底（旧式/内存 store）。
 *
 * 契约:
 *   @input  — goalId + store（GraphBridgeLike）+ graph
 *   @output — 节点 id；未找到 → null（调用方决定降级，不抛）
 *   @degraded — store 查询抛错 → log.warn + 继续尝试兜底路径；两条路都失败 → null（不静默成功）
 */
export function resolveGoalNodeId(goalId: string, store: GraphBridgeLike, graph: string = 'growth'): string | null {
  try {
    const rows = store.queryNodes('GOAL', { goalId }, graph);
    const hit = rows.find((r) => readText(r.props, 'goalId') === goalId);
    if (hit) return hit.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, goalId }, 'Goal 节点解析 props 反查失败 — 回退节点 id 兜底（degraded）');
  }
  try {
    const node = store.getNode(goalId, graph) as { id?: string } | null;
    if (node) return node.id ?? goalId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, goalId }, 'Goal 节点解析兜底失败 — 返回 null（调用方按降级处理）');
  }
  return null;
}

export function listGoalsByDept(deptId: string, store: GraphBridgeLike, graph: string = 'growth'): Goal[] {
  try {
    const nodes = store.queryNodes('GOAL', { ownerDeptId: deptId }, graph);
    return nodes.map(n => n.props as unknown as Goal);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, deptId }, '按部门查询 Goal 失败');
    return [];
  }
}

/**
 * 按组织 ID 列出所有 Goal。
 */
export function listGoalsByOrg(orgId: string, store: GraphBridgeLike, graph: string = 'growth'): Goal[] {
  try {
    const nodes = store.queryNodes('GOAL', { orgId }, graph);
    return nodes.map(n => n.props as unknown as Goal);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, orgId }, '按组织查询 Goal 失败');
    return [];
  }
}

/**
 * 获取指定组织的活跃 Goal 数量（status 为 active 的 Goal 数）。
 */
export function getActiveGoalCount(orgId: string, store: GraphBridgeLike, graph: string = 'growth'): number {
  try {
    const goals = listGoalsByOrg(orgId, store, graph);
    return goals.filter(g => g.status === 'active').length;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "目标列表查询");
    return 0;
  }
}

/**
 * 更新 Goal 状态，含 17 条状态转换规则校验。
 *
 * 每次状态变更:
 * 1. 验证转换是否合法（isValidTransition）
 * 2. 验证前置条件（draft→pending_ga 检查字段完整性，active→completed 检查 criteria）
 * 3. 写入 AuditStore
 *
 * 如果需要在状态变更的同时更新其他字段（如 closeGoal 的 metrics），
 * 传入 extraProps。所有更新在一次 store.updateNode 中完成，保证原子性。
 *
 * @param extraProps - 可选。状态变更时同时更新的额外字段（如 metrics, actualDurationDays）
 * @throws Error — 非法转换或前置条件不满足时抛出
 */
// ═══ 目标传导（1-4：目标传导到每个人） ═══

/**
 * 从节点 props 读字符串字段（无类型断言；坏数据 → undefined）。
 */
function readText(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * 定位 Goal 节点。
 *
 * 为什么不能只用 getGoal/getNode：`SqliteGraphStore.createNode` 恒生成 `node-<uuid>`
 * 作节点 id，而 `Goal.goalId` 只存在 props 里 —— 必须按 props.goalId 反查。
 * 兼容旧式/内存 store（以其 props.goalId 作节点 id）时回退 getNode。
 */
function resolveGoalForPropagation(
  goalId: string,
  store: GraphBridgeLike,
  graph: string,
): { nodeId: string; orgId: string } | null {
  const rows = store.queryNodes('GOAL', { goalId }, graph);
  // 严格匹配：过滤被实现忽略时不得把别的 Goal 当成目标（fail-closed，不猜）
  const hit = rows.find(r => readText(r.props, 'goalId') === goalId);
  if (hit) {
    return { nodeId: hit.id, orgId: readText(hit.props, 'orgId') ?? '' };
  }
  const direct = store.getNode(goalId, graph) as { id?: string; props?: Record<string, unknown> } | null;
  if (direct?.props && readText(direct.props, 'goalId') === goalId) {
    return { nodeId: direct.id ?? goalId, orgId: readText(direct.props, 'orgId') ?? '' };
  }
  return null;
}

/**
 * 目标传导到每个成员（1-4）。
 *
 * 为每位（去重后的）成员写入一个 `GOAL_ASSIGNMENT` 节点：props 记
 * goalId/orgId/userId/role/deptId/status/assignedAt，节点 type 以 `goal` 为前缀 ——
 * 判据 `COUNT(graph_nodes WHERE type LIKE 'goal%') > 0` 直接读得到（列名实测为 `type`）。
 *
 * 契约:
 *   @input  — goalId（createGoal 生成）+ members（成员最小集，通常来自
 *             UserStore.listByOrg(orgId)）+ store（GraphBridgeLike 依赖注入）
 *             + graph（默认 'growth'）
 *   @output — GoalPropagationResult：{ ok, code, expectedMembers, assignments, degraded }
 *   @degraded — store 抛错（查询/写入）→ 不抛异常，返回 code='STORE_UNAVAILABLE' +
 *               degraded=true（log.error 留痕，铁律 24/31）；
 *               目标不存在 / 成员空集 → 拒绝并给错误码，degraded=false
 */
export function propagateGoalToMembers(
  goalId: string,
  members: readonly GoalMember[],
  store: GraphBridgeLike,
  graph: string = 'growth',
): GoalPropagationResult {
  const uniqueMembers: GoalMember[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const userId = typeof member?.userId === 'string' ? member.userId.trim() : '';
    if (userId.length === 0 || seen.has(userId)) continue;
    seen.add(userId);
    uniqueMembers.push({
      userId,
      role: member.role,
      deptId: member.deptId,
      displayName: member.displayName,
    });
  }

  if (uniqueMembers.length === 0) {
    log.warn({ goalId, membersReceived: members.length }, '目标传导被拒：成员清单为空（EMPTY_MEMBERS）');
    return {
      ok: false, code: 'EMPTY_MEMBERS', reason: '成员清单为空',
      goalId, expectedMembers: 0, assignments: [], degraded: false,
    };
  }

  let goalOrgId: string;
  try {
    const resolved = resolveGoalForPropagation(goalId, store, graph);
    if (!resolved) {
      log.warn({ goalId, members: uniqueMembers.length }, '目标传导被拒：目标不存在（GOAL_NOT_FOUND）');
      return {
        ok: false, code: 'GOAL_NOT_FOUND', reason: `Goal ${goalId} 不存在`,
        goalId, expectedMembers: uniqueMembers.length, assignments: [], degraded: false,
      };
    }
    goalOrgId = resolved.orgId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId }, '目标传导失败：图存储不可用 — degraded');
    return {
      ok: false, code: 'STORE_UNAVAILABLE', reason: msg,
      goalId, expectedMembers: uniqueMembers.length, assignments: [], degraded: true,
    };
  }

  const assignedAt = new Date().toISOString();
  const assignments: GoalAssignment[] = [];
  for (const member of uniqueMembers) {
    try {
      const assignmentId = store.createNode(GOAL_ASSIGNMENT_NODE_TYPE, {
        goalId,
        orgId: goalOrgId,
        userId: member.userId,
        role: member.role,
        deptId: member.deptId,
        displayName: member.displayName,
        status: 'pending',
        assignedAt,
      }, graph);
      assignments.push({
        assignmentId,
        goalId,
        orgId: goalOrgId,
        userId: member.userId,
        role: member.role,
        deptId: member.deptId,
        status: 'pending',
        assignedAt,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        { err: msg, goalId, userId: member.userId, written: assignments.length, expected: uniqueMembers.length },
        '目标传导中断：图存储不可用 — degraded（已写入部分保留）',
      );
      return {
        ok: false, code: 'STORE_UNAVAILABLE', reason: msg,
        goalId, expectedMembers: uniqueMembers.length, assignments, degraded: true,
      };
    }
  }

  log.info({ goalId, count: assignments.length, graph }, '目标已传导到每个成员');
  return {
    ok: true, code: 'OK',
    goalId, expectedMembers: uniqueMembers.length, assignments, degraded: false,
  };
}

/**
 * 列出某 Goal 的全部派发记录（1-4）。
 *
 * 契约:
 *   @input  — goalId + store（GraphBridgeLike）+ graph（默认 'growth'）
 *   @output — GoalAssignment[]（无记录 → []）
 *   @degraded — store 抛错 → log.error + 返回 []（调用方与 getGoalCoverage 的
 *               degraded 标记区分「无记录」与「查不到」，铁律 31）
 */
export function listGoalAssignments(
  goalId: string,
  store: GraphBridgeLike,
  graph: string = 'growth',
): GoalAssignment[] {
  try {
    const rows = store.queryNodes(GOAL_ASSIGNMENT_NODE_TYPE, { goalId }, graph);
    return rows
      .filter(r => readText(r.props, 'goalId') === goalId)
      .map(r => ({
        assignmentId: r.id,
        goalId,
        orgId: readText(r.props, 'orgId') ?? '',
        userId: readText(r.props, 'userId') ?? '',
        role: readText(r.props, 'role'),
        deptId: readText(r.props, 'deptId'),
        status: readText(r.props, 'status') === 'acknowledged' ? ('acknowledged' as const) : ('pending' as const),
        assignedAt: readText(r.props, 'assignedAt') ?? '',
      }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId }, '查询目标派发记录失败 — degraded');
    return [];
  }
}

/**
 * 计算某 Goal 的逐人覆盖率（1-4 判据 ②：coverage N/N）。
 *
 * 契约:
 *   @input  — goalId + members（应派发成员清单）+ store + graph（默认 'growth'）
 *   @output — GoalCoverage：{ expected, assigned, ratio, missingUserIds, degraded }
 *             expected = 成员去重后人数；assigned = 已派发 ∩ 成员
 *   @degraded — 查询抛错 → degraded=true + log.error + 全员 missing
 *               （不把「查不到」伪装成「已覆盖」）
 */
export function getGoalCoverage(
  goalId: string,
  members: readonly GoalMember[],
  store: GraphBridgeLike,
  graph: string = 'growth',
): GoalCoverage {
  const expectedUserIds: string[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const userId = typeof member?.userId === 'string' ? member.userId.trim() : '';
    if (userId.length === 0 || seen.has(userId)) continue;
    seen.add(userId);
    expectedUserIds.push(userId);
  }

  let assignedUserIds = new Set<string>();
  let degraded = false;
  try {
    const rows = store.queryNodes(GOAL_ASSIGNMENT_NODE_TYPE, { goalId }, graph);
    assignedUserIds = new Set(
      rows
        .filter(r => readText(r.props, 'goalId') === goalId)
        .map(r => readText(r.props, 'userId'))
        .filter((userId): userId is string => typeof userId === 'string'),
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId }, '计算目标覆盖率失败：图存储不可用 — degraded');
    degraded = true;
  }

  const missingUserIds = expectedUserIds.filter(userId => !assignedUserIds.has(userId));
  const expected = expectedUserIds.length;
  const assigned = expected - missingUserIds.length;
  return {
    goalId,
    expected,
    assigned,
    ratio: expected === 0 ? 0 : assigned / expected,
    missingUserIds,
    degraded,
  };
}

export function updateGoalStatus(
  goalId: string,
  newStatus: GoalStatus,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
  extraProps?: Partial<Goal>,
): void {
  const goal = getGoal(goalId, store, graph);
  if (!goal) {
    throw new Error(`Goal ${goalId} 不存在`);
  }

  const fromStatus = goal.status;

  // 1. 验证转换合法性
  if (!isValidTransition(fromStatus, newStatus)) {
    throw new Error(`非法状态转换: ${fromStatus} → ${newStatus}`);
  }

  // 2. 验证前置条件
  if (fromStatus === 'draft' && newStatus === 'pending_ga') {
    const check = checkDraftPreconditions(goal);
    if (!check.valid) {
      throw new Error(`draft→pending_ga 前置条件不满足: ${check.reason}`);
    }
  }
  if (fromStatus === 'active' && newStatus === 'completed') {
    const check = checkCompletionPreconditions(goal);
    if (!check.valid) {
      throw new Error(`active→completed 前置条件不满足: ${check.reason}`);
    }
  }

  // 3. 更新节点（含 extraProps，保证原子性）
  const updatedProps = { ...goal, ...extraProps, status: newStatus, lastModifiedAt: new Date().toISOString() };
  try {
    // #1010: 用**节点 id** 更新 —— 真实 store 的节点 id ≠ props.goalId，用 goalId 更新是
    // 0 行 UPDATE（静默无效果）；解析失败回退 goalId（旧式/内存 store 语义不变）。
    const nodeRef = resolveGoalNodeId(goalId, store, graph) ?? goalId;
    store.updateNode(nodeRef, updatedProps as unknown as Record<string, unknown>, graph);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId, fromStatus, newStatus }, 'Goal 状态更新失败');
    throw new Error(`更新 Goal 状态失败: ${msg}`);
  }

  // 4. 写入审计日志（fire-and-forget，失败仅 log.warn）
  // 设计决策: 审计日志使用 fire-and-forget 模式。
  // 审计写入失败不应阻塞 Goal 状态变更（铁律31降级传播）。
  // 进程崩溃导致审计丢失是可接受风险——状态变更本身已持久化到 GraphStore。
  audit.write({
    orgId: goal.orgId,
    actorId: `system:goal-store`,
    actorRole: 'system',
    action: `goal.status.${fromStatus}→${newStatus}`,
    targetType: 'GOAL',
    targetId: goalId,
    oldValue: JSON.stringify({ status: fromStatus }),
    newValue: JSON.stringify({ status: newStatus }),
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, goalId }, 'Goal 状态变更审计日志写入失败');
  });

  log.info({ goalId, fromStatus, newStatus }, 'Goal 状态已更新');
}
