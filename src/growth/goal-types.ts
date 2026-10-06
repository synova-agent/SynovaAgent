/**
 * src/growth/goal-types.ts — Goal 类型定义
 *
 * 第13份权威文档（增长导航系统工程规范）第一章 §3.1-§3.3。
 * Goal = 增长导航系统中可追踪、可闭环、可审计的改进项。
 *
 * @wire-target — D72 (Proposal引擎) 消费 Goal 类型定义
 * @wire-target — D77 (主Agent集成) 消费 StandardExpertReport→Goal 映射
 * @wire-target — D73 (方案哨兵) 消费 Goal.goalId 注册方案哨兵
 *
 * 契约:
 *   @input  — 28字段完整定义，全部字段 JSDoc 标注
 *   @output — 类型安全的封闭枚举
 *   @degraded — 不适用（纯类型定义，无运行时逻辑）
 */

// ═══ Goal 7态状态机 ═══

/**
 * Goal 的 7 种生命周期状态。
 *
 * 状态转换规则（共17条，详见 goal-store.ts 的 TRANSITION_RULES）:
 *   draft → pending_ga → active ⇄ paused
 *                      ↘ abandoned
 *   draft → abandoned
 *   active → completed → archived
 *   active → abandoned → archived
 *   paused → active | abandoned
 *
 * 废弃和归档不可逆：abandoned → * 和 archived → * 均不允许。
 */
export type GoalStatus = 'draft' | 'pending_ga' | 'active' | 'completed' | 'abandoned' | 'paused' | 'archived';

/** 全部 7 个有效 GoalStatus 值 */
export const VALID_GOAL_STATUSES: readonly GoalStatus[] = [
  'draft', 'pending_ga', 'active', 'completed', 'abandoned', 'paused', 'archived',
];

// ═══ GoalMetric ═══

/**
 * 可量化指标 — 绑定 compute 函数的具体测量。
 *
 * @contract currentValue ≤ targetValue 表示正向指标（如营收），反之亦然。
 */
export interface GoalMetric {
  /** 指标名称（如 "营收增长率", "利润率"） */
  metricName: string;
  /** 当前实测值 */
  currentValue: number;
  /** 目标值 */
  targetValue: number;
  /** 单位（如 "万元", "%", "人天"） */
  unit: string;
  /** 对应的 compute 契约 ID（如 COMPUTE-BREAK-EVEN-v1） */
  computeContractId: string;
  /** 基线时段（可选） */
  baselinePeriod?: { start: string; end: string };
}

// ═══ SuccessCriterion ═══

/**
 * 完成条件 — 判定 Goal 是否达成的标准。
 */
export interface SuccessCriterion {
  /** 条件描述（如 "月度营收 ≥ 500 万元"） */
  criterion: string;
  /** 验证方式 */
  verificationMethod: 'metric_threshold' | 'manual_review' | 'external_audit';
  /** 是否已验证通过 */
  verified: boolean;
  /** 验证通过时间戳 */
  verifiedAt?: string;
}

// ═══ Goal 28字段接口 ═══

/**
 * Goal — 增长导航系统中的改进项。
 *
 * 共 28 个字段，与权威文档第一章 §3.1 完全对齐。
 * 通过 GraphStore.createNode(type='GOAL') 持久化。
 *
 * @contract goalId 全局唯一，由 createGoal 生成
 * @contract status 只能是 7 态之一，受 17 条转换规则约束
 * @contract createdAt/lastModifiedAt 为 ISO-8601 字符串
 */
export interface Goal {
  /** 唯一标识（由 createGoal 自动生成） */
  goalId: string;
  /** 所属组织 ID */
  orgId: string;
  /** 来源 Proposal ID（来自 D72，可选） */
  proposalId: string;
  /** 来源诊断报告 ID */
  diagnosisId: string;
  /**
   * 来源决策记录 ID（决策驱动目标来源，导航权威 2026-09-06 §2.2 三来源之一）。
   * 与 proposalId/diagnosisId 并列：老板凭直觉定新方向 → 记 DecisionRecord →
   * 分解为目标时带此 id。缺省 undefined = 非决策驱动（诊断/外部驱动），向后兼容。
   */
  decisionRecordId?: string;
  /** Goal 标题 */
  title: string;
  /** 详细描述 */
  description: string;
  /** 优先级 */
  priority: 'P0' | 'P1' | 'P2';
  /** 当前生命周期状态 */
  status: GoalStatus;
  /** 负责部门 ID */
  ownerDeptId: string;
  /** 具体负责人（可选） */
  assignedTo?: string;
  /** 创建时间（ISO-8601） */
  createdAt: string;
  /** 截止日期（ISO-8601） */
  deadline: string;
  /** 绑定的可量化指标列表 */
  metrics: GoalMetric[];
  /** 完成条件清单 */
  successCriteria: SuccessCriterion[];
  /** 依赖的其他 Goal ID 列表 */
  dependsOn: string[];
  /** 冲突的其他 Goal ID 列表 */
  conflictsWith: string[];
  /** 轻量级再诊断次数（D75 使用） */
  reDiagnosisCount: number;
  /** 创建者信息 */
  createdBy: { role: string; departmentId?: string };
  /** 最后修改时间（ISO-8601） */
  lastModifiedAt: string;
  /** 计划持续天数 */
  plannedDurationDays: number;
  /** 实际持续天数（完成后设置） */
  actualDurationDays?: number;
  /** 从诊断报告继承的根因 */
  rootCause?: string;
  /** 自定义标签 */
  tags?: string[];
  /** 扩展属性 */
  props?: Record<string, unknown>;
}

// ═══ StandardExpertReport → Goal 字段映射（供 D77 集成使用） ═══

/**
 * StandardExpertReport → Goal 字段映射。
 *
 * 权威文档第五章 §2.1 定义。D77 将实现自动转换。
 *
 * | StandardExpertReport 字段 | Goal 字段 | 规则 |
 * |--------------------------|----------|------|
 * | diagnosisId              | diagnosisId | 直接复制 |
 * | actionRecommendations[selected].description | title | 提取前30字符 |
 * | actionRecommendations[selected].estimatedCost.timeline | deadline | ISO-8601 |
 * | actionRecommendations[selected].riskLevel | priority | high→P0, medium→P1, low→P2 |
 * | actionRecommendations[selected].expectedImpact | metrics[] | 每个受影响维度创建一个 GoalMetric |
 * | crossExpertContradictions | conflictsWith | 同部门内维度冲突 → Goal 冲突标记 |
 * | hypotheses[rootCause] | rootCause | 置信度最高的根因 |
 *
 * 注意: `actionRecommendations[selected]` 指 GA 选择的行动方案。
 * 当前 `actionRecommendations` 在 engine-core 中为 `string[]`。
 * D77 将处理此映射，D71 只定义映射表。
 */

// ═══ 状态转换规则类型定义 ═══

/**
 * 状态转换规则定义。
 * 每条规则标注 from→to 方向、前置条件和说明。
 */
export interface TransitionRule {
  from: GoalStatus;
  to: GoalStatus;
  /** 规则描述 */
  description: string;
  /** 前置条件检查函数名（在 goal-store.ts 中实现） */
  precondition?: string;
}

// ═══ 目标传导（1-4：目标传导到每个人） ═══

/**
 * 目标传导的成员最小集（1-4）。
 *
 * 来源：`UserStore.listByOrg(orgId)` 的 UserRecord（只取传导所需字段），
 * 用最小结构避免 goal-store 反向依赖 user-store（L2 内部松耦合，依赖注入）。
 */
export interface GoalMember {
  /** 成员唯一标识（= USER 节点 id） */
  userId: string;
  /** 角色（可选，来自 UserRecord.role） */
  role?: string;
  /** 所属部门（可选，来自 UserRecord.department） */
  deptId?: string;
  /** 显示名（可选，来自 UserRecord.displayName） */
  displayName?: string;
}

/**
 * 单人派发节点类型。
 *
 * 前缀必须匹配 `goal` —— 1-4 判据 `COUNT(graph_nodes WHERE type LIKE 'goal%') > 0`
 * 以该前缀为机器可核事实（列名实测为 `type`，见 PLAN-K6 §0）。
 */
export const GOAL_ASSIGNMENT_NODE_TYPE = 'GOAL_ASSIGNMENT';

/**
 * 单人 Goal 派发记录（一个成员一个 GOAL_ASSIGNMENT 节点）。
 *
 * @contract assignmentId 为 GraphStore.createNode 返回值（真实库为 `node-<uuid>`）
 * @contract status 当前只有 pending/acknowledged（进度回流另卡，不在 1-4 范围）
 */
export interface GoalAssignment {
  /** 派发节点 id（GraphStore 生成） */
  assignmentId: string;
  /** 源 Goal 标识（Goal.goalId） */
  goalId: string;
  /** 目标所属组织 */
  orgId: string;
  /** 承接成员标识 */
  userId: string;
  /** 成员角色（可选） */
  role?: string;
  /** 成员所属部门（可选） */
  deptId?: string;
  /** 派发态 */
  status: 'pending' | 'acknowledged';
  /** 派发时间（ISO-8601） */
  assignedAt: string;
}

/**
 * 目标传导结果码取值（单一事实源）。
 *
 * 文件驱动门禁禁止在 src/ 内新增硬编码类型联合（scripts/check-file-driven.sh 组 8.c）——
 * 故取值以 `as const` 数组声明，类型由其派生（判别值仍是编译期闭合的 4 态，不弱化类型）。
 */
export const GOAL_PROPAGATION_CODES = ['OK', 'GOAL_NOT_FOUND', 'EMPTY_MEMBERS', 'STORE_UNAVAILABLE'] as const;

/** 目标传导结果码（拒绝路径可核，不靠异常字符串） */
export type GoalPropagationCode = (typeof GOAL_PROPAGATION_CODES)[number];

/**
 * 目标传导结果。
 *
 * @contract ok=false 时 assignments 只含「已成功写入」的部分（不夸大）
 * @contract degraded=true 只出现在 store 不可用（铁律 24/31：不静默，不抛）
 */
export interface GoalPropagationResult {
  /** 是否全员派发成功 */
  ok: boolean;
  /** 结果码（OK / GOAL_NOT_FOUND / EMPTY_MEMBERS / STORE_UNAVAILABLE） */
  code: GoalPropagationCode;
  /** 拒绝或降级原因（人类可读） */
  reason?: string;
  /** 源 Goal 标识 */
  goalId: string;
  /** 去重后的应派发人数 */
  expectedMembers: number;
  /** 已写入的派发记录 */
  assignments: GoalAssignment[];
  /** 是否降级（store 不可用） */
  degraded: boolean;
}

/**
 * 目标覆盖率（1-4 判据 ②：coverage N/N）。
 */
export interface GoalCoverage {
  /** 源 Goal 标识 */
  goalId: string;
  /** 应派发人数（入参成员去重后） */
  expected: number;
  /** 已派发人数（交集中的成员） */
  assigned: number;
  /** assigned / expected（expected=0 时为 0） */
  ratio: number;
  /** 尚未派发的成员标识 */
  missingUserIds: string[];
  /** 查询降级标记（store 不可用 → true，铁律 31） */
  degraded: boolean;
}

// ═══ GraphStore 轻量接口（供 goal-store 使用） ═══

/**
 * goal-store 所需的最小 GraphStore 接口。
 * 用于依赖注入，避免直接依赖 l4/graph-bridge 实现类。
 */
export interface GraphBridgeLike {
  createNode(type: string, props: Record<string, unknown>, graph: string): string;
  getNode(id: string, graph: string): unknown | null;
  updateNode(id: string, props: Record<string, unknown>, graph: string): void;
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>;
}

/**
 * goal-lifecycle 所需的最小 AuditStore 接口。
 */
export interface AuditStoreLike {
  write(entry: {
    orgId: string;
    actorId: string;
    actorRole: string;
    action: string;
    targetType?: string;
    targetId?: string;
    oldValue?: string;
    newValue?: string;
  }): Promise<string>;
}

/**
 * goal-lifecycle 所需的最小 PolicyEngine 接口。
 */
export interface PolicyEngineLike {
  evaluate(req: { role: string; dataLevel: string; soi: string }): { allow: boolean; denyReason?: string };
}
