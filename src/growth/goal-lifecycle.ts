/**
 * src/growth/goal-lifecycle.ts — Goal 生命周期管理
 *
 * 封装完整的 7 态状态机 + PolicyEngine 权限检查 + closeGoal 闭环验证。
 *
 * @deprecated 未接线（#982 明示不接）。接入点见 #1010（Goal 关闭路径接线）。
 *
 * #982（0-8）实测依据（2026-10-04）：本模块在 `src/` 内**零真实 import/零调用**
 * （`grep -rn "goal-lifecycle" src/` 仅 2 处注释；`closeGoal` / `verifyEffect` / `transitionGoal` 在 src/ 零调用方；
 * `updateGoalStatus` 全仓唯一调用者 = 本文件自身）⇒ 整条 Goal 关闭路径在生产侧从未接线。
 * 处置（产品线 2026-10-04 裁定，Done 判据订正为三支）：
 *   ① 本 `@deprecated` 标注 + 接入点指针（= #1010）——**状态明确、有主**；
 *   ② 既有 5 个测试文件逐条跑绿 ⇒ **能力未损坏，只是不接线**（非"无残留符号"式删除，禁毁 D71/D76/D254 已验能力）；
 *   ③ 接线 = 第 1 批 #1010 的工作（跨批次，不在第 0 批止血范围）。
 *
 * 契约:
 *   @input  — goalId + 目标状态 + actor 信息 + GraphStore + AuditStore + PolicyEngine
 *   @output — void（成功）或 throw Error（失败）
 *   @degraded — AuditStore 不可用时仅 log.warn，不影响主流程
 */
import { createLogger } from '@synova/logger';
import type { Goal, GoalStatus, GoalMetric, GraphBridgeLike, AuditStoreLike, PolicyEngineLike } from './goal-types';
import { getGoal, updateGoalStatus } from './goal-store';
import { registerOnGoalActive, unregisterOnGoalClosed, pauseOnGoalPaused } from './goal-sentinel-lifecycle';
import type { SentinelRegistry } from '../sentinel/types';

const log = createLogger('growth/goal-lifecycle');

// ═══ SOI 定义 ═══

/** Goal 操作对应的 SOI */
const SOI_GOAL_WRITE = 'goal.write';
const SOI_GOAL_ARCHIVE = 'goal.archive';
const SOI_GOAL_CLOSE = 'goal.close';
const SOI_GOAL_ABANDON = 'goal.abandon';

// ═══ 权限辅助 ═══

/**
 * 检查 PolicyEngine 是否允许指定操作。
 * @returns true=允许，false=拒绝（log.warn）
 */
function checkPolicy(
  policy: PolicyEngineLike,
  role: string,
  soi: string,
): boolean {
  const decision = policy.evaluate({ role, dataLevel: 'S1', soi });
  if (!decision.allow) {
    log.warn({ role, soi, denyReason: decision.denyReason }, 'PolicyEngine 拒绝操作');
    return false;
  }
  return true;
}

// ═══ 生命周期函数 ═══

/**
 * 转换 Goal 生命周期状态。
 *
 * 步骤:
 * 1. 调用 goal-store 的 updateGoalStatus（含17条规则校验 + AuditStore 写入）
 * 2. 对特定转换进行 PolicyEngine 权限检查:
 *    - active→abandoned: 需要 GA 权限
 *    - abandoned→archived: 需要 admin 权限
 *
 * @throws Error — 非法转换或权限不足时抛出
 */
export function transitionGoal(
  goalId: string,
  toStatus: GoalStatus,
  actor: { role: string; departmentId?: string },
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  policy: PolicyEngineLike,
  sentinelRegistry?: SentinelRegistry,
): void {
  // 获取当前 Goal 以检查转换
  const goal = getGoal(goalId, store);
  if (!goal) {
    throw new Error(`Goal ${goalId} 不存在`);
  }

  // 特殊转换需要 PolicyEngine 权限
  if (goal.status === 'active' && toStatus === 'abandoned') {
    if (!checkPolicy(policy, actor.role, SOI_GOAL_ABANDON)) {
      throw new Error(`权限不足: ${actor.role} 无法废弃 Goal (需要 GA 权限)`);
    }
  }
  if (toStatus === 'archived') {
    if (!checkPolicy(policy, actor.role, SOI_GOAL_ARCHIVE)) {
      throw new Error(`权限不足: ${actor.role} 无法归档 Goal`);
    }
  }

  // 非特殊转换也需要写入权限
  if (goal.status !== toStatus) {
    if (!checkPolicy(policy, actor.role, SOI_GOAL_WRITE)) {
      throw new Error(`权限不足: ${actor.role} 无法修改 Goal 状态`);
    }
  }

  // 委托给 goal-store 的 updateGoalStatus（含转换规则 + 审计日志）
  updateGoalStatus(goalId, toStatus, store, audit);

  // D73: 方案哨兵生命周期钩子（可选 sentinelRegistry — 不阻断主流程）
  if (sentinelRegistry) {
    try {
      if (toStatus === 'active' && goal.status !== 'active') {
        registerOnGoalActive(goalId, store, sentinelRegistry);
      } else if ((toStatus === 'completed' || toStatus === 'abandoned') && goal.status !== toStatus) {
        unregisterOnGoalClosed(goalId, sentinelRegistry);
      } else if (toStatus === 'paused' && goal.status !== 'paused') {
        pauseOnGoalPaused(goalId, sentinelRegistry);
      }
    } catch {
      log.warn({ goalId, toStatus }, '方案哨兵钩子执行失败 — 不阻断状态转换');
    }
  }
}

/**
 * 闭环 Goal：比对实际指标 vs 目标指标，判断 outcome。
 *
 * 步骤:
 * 1. 比对 actualMetrics vs goal.metrics 的 targetValue
 * 2. 判断 outcome（achieved / partially_achieved / not_achieved）
 * 3. 调用 updateGoalStatus 将状态转为 completed
 * 4. 预留 D76 知识提取接口
 *
 * @param goalId - 要闭环的 Goal ID
 * @param outcome - 达成状态
 * @param actualMetrics - 实际达成的指标值列表
 */
/** #1010: 达成判定输入（结构子集 —— 完整 Goal 对象可直接传入） */
export interface GoalAchievementInput {
  /** 成功条件（读 verified；缺省/非数组 ⇒ 视为无成功条件） */
  successCriteria?: ReadonlyArray<{ verified?: boolean }>;
  /** 指标（读 currentValue ≥ targetValue） */
  metrics?: ReadonlyArray<{ currentValue?: number; targetValue?: number }>;
}

/** #1010: 达成判定结果 */
export interface GoalAchievement {
  /** 是否达成（true ⇒ 调用方走 closeGoal 闭环） */
  achieved: boolean;
  /** 判定理由（可入 output/日志，便于审计） */
  reason: string;
}

/**
 * #1010: Goal 达成判定（纯函数，零 IO）—— 生产侧"该不该关"的唯一定义。
 *
 * 口径（与 `checkCompletionPreconditions` 同源，**不新增第二套标准**）：
 *   ① `successCriteria` 非空 ⇒ 全部 `verified === true` 才算达成（GA/外部确认过 ⇒ 可闭环）
 *   ② 无成功条件 ⇒ 一律**不达成**（不按指标自动关：那会绕过人工确认，也过不了
 *      `updateGoalStatus` 的 `active→completed` 前置条件；指标只用于再诊断，见 loop-1）
 *
 * 契约:
 *   @input  — GoalAchievementInput（完整 Goal 可直接传入）
 *   @output — { achieved, reason }
 *   @degraded — 不适用（纯判定无 IO）；字段缺失/类型不符按"未达成"处理（不猜、不误关）
 * @诚实边界 — 不产出 `partially_achieved`（那需人工判断，由调用方显式调 closeGoal 传入）
 */
export function evaluateGoalAchievement(goal: GoalAchievementInput): GoalAchievement {
  const criteria = Array.isArray(goal?.successCriteria) ? goal.successCriteria : [];
  if (criteria.length === 0) {
    return { achieved: false, reason: '无成功条件 —— 不可机械判定达成，交再诊断/人工确认' };
  }
  const unverified = criteria.filter((c) => c?.verified !== true);
  if (unverified.length > 0) {
    return { achieved: false, reason: `成功条件仍有 ${unverified.length}/${criteria.length} 项未验证` };
  }
  return { achieved: true, reason: `成功条件 ${criteria.length}/${criteria.length} 项已验证` };
}

export async function closeGoal(
  goalId: string,
  outcome: 'achieved' | 'partially_achieved' | 'not_achieved',
  actualMetrics: GoalMetric[],
  store: GraphBridgeLike,
  audit: AuditStoreLike,
): Promise<void> {
  const goal = getGoal(goalId, store);
  if (!goal) {
    throw new Error(`Goal ${goalId} 不存在`);
  }

  if (goal.status !== 'active') {
    throw new Error(`只能闭环 active 状态的 Goal（当前: ${goal.status}）`);
  }

  // 1. 比对实际指标 vs 目标指标
  const metricComparisons: Array<{ metricName: string; target: number; actual: number; met: boolean }> = [];
  for (const targetMetric of goal.metrics) {
    const actual = actualMetrics.find(m => m.metricName === targetMetric.metricName);
    const actualValue = actual?.currentValue ?? 0;
    const met = actualValue >= targetMetric.targetValue;
    metricComparisons.push({
      metricName: targetMetric.metricName,
      target: targetMetric.targetValue,
      actual: actualValue,
      met,
    });
  }

  // 2. 记录闭环日志
  log.info({
    goalId,
    outcome,
    metricComparisons,
    actualDurationDays: goal.actualDurationDays,
  }, 'Goal 闭环');

  // 3. 单次 updateGoalStatus（含 extraProps）保证原子性
  const startDate = new Date(goal.createdAt);
  const actualDays = Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  updateGoalStatus(goalId, 'completed', store, audit, 'growth', {
    metrics: actualMetrics,
    actualDurationDays: actualDays,
  });

  // 4. D76: 提取 Goal 执行知识 → 写入 PKB
  try {
    const { extractGoalKnowledge, writeGoalKnowledge } = await import('./knowledge-feedback');
    const knowledge = extractGoalKnowledge(goal, outcome, metricComparisons);
    const KnowledgeStore = (await import('../l4/knowledge-store')).KnowledgeStore;
    const { getDatabase } = await import('../init/engine-context');
    const db = getDatabase();
    const ks = new KnowledgeStore(db);
    writeGoalKnowledge(knowledge, ks);

    // D254: 效果验证 — 回溯诊断报告 edge 参数对比
    const { writeEffectReport } = await import('./knowledge-feedback');
    const effect = await verifyEffect(goal, store);
    writeEffectReport(effect);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, goalId }, '知识提取/PKB 写入失败 — 降级（不阻断 Goal 关闭）');
  }
}

/**
 * D254: 效果验证 — 回溯诊断关联的 edge 参数，对比当前值 vs 基线。
 *
 * 流程:
 *   goal.diagnosisId → 诊断报告 node → matchedEdgeIds + baselineValues
 *   → 取首条 edge 当前 weight → 对比 → EffectReport
 *
 * @returns EffectReport（降级时 status=unknown + reason）
 */
export interface EffectReport {
  status: 'improved' | 'worsened' | 'unchanged' | 'unknown';
  before?: number;
  after?: number;
  deltaPct?: number;
  edgeId?: string;
  reason?: string;
  verifiedAt: string;
}

export async function verifyEffect(goal: Goal, store: GraphBridgeLike): Promise<EffectReport> {
  const verifiedAt = new Date().toISOString();

  if (!goal.diagnosisId) {
    return { status: 'unknown', reason: '无关联诊断报告', verifiedAt };
  }

  try {
    const diagnosis = store.getNode(goal.diagnosisId, 'default') as Record<string, unknown> | null;
    if (!diagnosis) {
      return { status: 'unknown', reason: '诊断报告不存在', verifiedAt };
    }

    const props = (diagnosis as { props?: Record<string, unknown> }).props || {};
    const edgeIds = props.matchedEdgeIds as string[] | undefined;
    const baselineValues = props.baselineValues as Record<string, number> | undefined;

    if (!edgeIds?.length || !baselineValues) {
      return { status: 'unknown', reason: '诊断报告无 edge 引用或基线数据', verifiedAt };
    }

    const edgeId = edgeIds[0];
    const baseline = baselineValues[edgeId];
    // 当前值优先从 diagnosis node props.currentValues 获取，回退到 baseline（表示无变化）
    const currentValues = props.currentValues as Record<string, number> | undefined;
    const current = currentValues?.[edgeId] ?? baseline;

    if (baseline == null) {
      return { status: 'unknown', reason: '基线值缺失', verifiedAt };
    }

    if (baseline === 0) {
      const delta = current - baseline;
      const status = delta > 0 ? 'improved' : delta < 0 ? 'worsened' : 'unchanged';
      return { status, before: baseline, after: current, deltaPct: delta > 0 ? 100 : delta < 0 ? -100 : 0, edgeId, verifiedAt };
    }

    const delta = current - baseline;
    const pct = Math.round((delta / baseline) * 100);
    const status = pct > 10 ? 'improved' : pct < -10 ? 'worsened' : 'unchanged';

    return { status, before: baseline, after: current, deltaPct: pct, edgeId, verifiedAt };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, goalId: goal.goalId }, '效果验证失败 — 降级');
    return { status: 'unknown', reason: `效果验证异常: ${msg}`, verifiedAt };
  }
}

/**
 * 归档 Goal（completed 或 abandoned 后 30 天可归档）。
 *
 * 自动检查:
 * - 只有 completed/abandoned 状态可归档
 * - completed 后未满 30 天的抛出警告但不阻止（允许手动归档）
 *
 * @throws Error — 状态不允许归档时抛出
 */
export function archiveGoal(
  goalId: string,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
): void {
  const goal = getGoal(goalId, store);
  if (!goal) {
    throw new Error(`Goal ${goalId} 不存在`);
  }

  if (goal.status !== 'completed' && goal.status !== 'abandoned') {
    throw new Error(`只有 completed 或 abandoned 状态的 Goal 可归档（当前: ${goal.status}）`);
  }

  // 检查是否完成/废弃已满 30 天
  const lastModified = new Date(goal.lastModifiedAt).getTime();
  const daysSinceModification = Math.ceil((Date.now() - lastModified) / (1000 * 60 * 60 * 24));

  if (daysSinceModification < 30) {
    log.warn({ goalId, daysSinceModification },
      `Goal 归档: 完成/废弃后仅 ${daysSinceModification} 天（建议等待 30 天）`);
    // 仍然允许归档（手动触发），仅警告
  }

  // 转换为 archived 状态
  updateGoalStatus(goalId, 'archived', store, audit);
}
