/**
 * src/growth/workspace-types.ts — DepartmentWorkspace 类型定义 (D74)
 *
 * 第13份权威文档（增长导航系统工程规范）第四章 §2 完整接口定义。
 * DepartmentWorkspace = 中层工作台的数据聚合视图。
 * 每个字段标注精确数据来源路径。
 *
 * @wire-target — workspace-builder.ts 消费所有类型构建工作台
 * @wire-target — next-action-engine.ts 消费 DepartmentWorkspace 产出 NextAction
 * @wire-target — dnd-engine.ts 消费 WorkspaceAlert 做免打扰过滤
 * @wire-target — routes/workspace-data.ts 消费全部类型做 API 响应
 *
 * 契约:
 *   @input  — 全部 7 个接口，完整 JSDoc
 *   @output — 类型安全
 *   @degraded — 所有接口含 degraded 标记
 */

// ═══ GoalDeviationStatus ═══

/**
 * Goal 偏离状态。
 * 由 goal-sentinel.ts computeDeviations() 判定。
 *
 * 数据来源: goal-sentinel.ts 的三因子偏离模型判定结果。
 * on_track  = 零因子偏离
 * at_risk   = 单因子偏离（仅记录日志，不触发告警）
 * deviated  = 双因子偏离（P2 告警）
 * critical  = 三因子偏离 或 持续三因子2周期以上（P1/P0 告警）
 */

// ═══ ActiveGoal ═══

/**
 * 活跃 Goal 在工作台中的展示视图。
 *
 * 数据来源: goal-store.ts listGoalsByDept() 筛选 status='active' 的 Goal。
 * deviationStatus 来自 goal-sentinel.ts computeDeviations()。
 */
export interface ActiveGoal {
  /** Goal 唯一标识，来自 Goal.goalId */
  goalId: string;
  /** Goal 标题，来自 Goal.title */
  title: string;
  /** 偏离状态，来自 goal-sentinel.computeDeviations() 结果: on_track/at_risk/deviated/critical/unknown */
  deviationStatus: 'on_track' | 'at_risk' | 'deviated' | 'critical' | 'unknown';
  /** 优先级（P0/P1/P2），来自 Goal.priority */
  priority: 'P0' | 'P1' | 'P2';
  /** 截止日期 ISO-8601，来自 Goal.deadline */
  deadline: string;
  /** 进度百分比 = (当前值 - 基线值) / (目标值 - 基线值) * 100 */
  progressPercent: number;
  /** 负责人，来自 Goal.assignedTo（可选） */
  owner?: string;
  /** 方案哨兵检测到的因子偏离详情（可选），来自 goal-sentinel */
  deviationDetail?: {
    /** 阈值偏离标志 */
    thresholdDeviation: boolean;
    /** 趋势偏离标志 */
    trendDeviation: boolean;
    /** 基线偏离标志 */
    baselineDeviation: boolean;
  };
  /**
   * Goal 的量化指标（#1322 新增）。
   *
   * 读回面硬要求（卡 M4）：`GET /api/workspace/:deptId/goals` 必须能读回
   * `metrics[].targetValue` —— 改前 ActiveGoal 无此字段 ⇒ 就算落图成功也**读不出来**。
   * 只暴露回答「目标值是多少」所需的最小字段；`computeContractId` / `baselinePeriod`
   * 属 #1316 版本化与时序域，不在本卡读回面。
   */
  metrics?: ActiveGoalMetric[];
}

/**
 * 工作台读回面的最小指标视图（#1322）。
 *
 * @contract 字段是 `GoalMetric` 的子集（`goal-types.ts:46-59`），只保留读回必需的 4 个；
 *   不复制 `computeContractId`（compute 绑定关系由图中 props 单一真源承载）。
 */
export interface ActiveGoalMetric {
  /** 指标名称，来自 GoalMetric.metricName */
  metricName: string;
  /** 当前实测值，来自 GoalMetric.currentValue */
  currentValue: number;
  /** 目标值，来自 GoalMetric.targetValue */
  targetValue: number;
  /** 单位，来自 GoalMetric.unit */
  unit: string;
}

// ═══ WorkspaceAlert ═══

/**
 * 工作台告警条目。
 *
 * 数据来源:
 * - 关联 Goal 偏离 → goal-sentinel.ts 产出 P1/P2 告警
 * - 哨兵系统 → SentinelRegistry 产出 critical/warning 发现
 * - Proposal 过期 → proposal-store.ts checkExpiry() 检测
 */
export interface WorkspaceAlert {
  /** 告警唯一标识 */
  alertId: string;
  /** 严重程度 */
  severity: 'critical' | 'warning' | 'info';
  /** 来源哨兵 ID，如 sentinel-margin-health（可选） */
  sourceSentinel?: string;
  /** 关联的 Goal ID（可选） */
  sourceGoal?: string;
  /** 告警时间 ISO-8601 */
  timestamp: string;
  /** 告警消息 */
  message: string;
  /** 是否已消除 */
  dismissed: boolean;
  /** 消除时间（可选） */
  dismissedAt?: string;
  /** 免打扰分类（P0/P1/P2），由 dnd-engine.ts 判定 */
  dndCategory: 'P0' | 'P1' | 'P2';
  /** 此告警在同一 Goal+哨兵组合下的最近推送时间（dnd 追踪用） */
  lastDeliveredAt?: string;
}

// ═══ PendingProposal ═══

/**
 * 待处理 Proposal 在工作台中的展示视图。
 *
 * 数据来源: proposal-store.ts listProposalsByDept() + 按 status 筛选。
 */
export interface PendingProposal {
  /** Proposal 唯一标识，来自 Proposal.proposalId */
  proposalId: string;
  /** 提案标题，来自 Proposal.title */
  title: string;
  /** 所属部门，来自 Proposal.department */
  department: string;
  /** 过期时间 ISO-8601，来自 Proposal.timeline.expiresAt */
  expiresAt?: string;
  /** 当前状态，来自 Proposal.status */
  status: string;
  /** 已选路径索引（可选），来自 Proposal.selectedPathIndex */
  selectedPathIndex?: number;
}

// ═══ DiagnosticReference ═══

/**
 * 诊断报告引用摘要。
 *
 * 数据来源: GraphStore.queryNodes('DIAGNOSIS_REPORT') 或 report-graph-adapter。
 */
export interface DiagnosticReference {
  /** 诊断报告 ID */
  reportId: string;
  /** CEO 摘要（前 200 字） */
  summary: string;
  /** 生成时间 ISO-8601 */
  generatedAt: string;
  /** 相关发现摘要 */
  relevantFindings: string[];
}

// ═══ NextAction ═══

/**
 * 推荐的下一步行动。
 *
 * 数据来源: next-action-engine.ts computeNextAction() 基于工作台全量数据判定。
 */
export interface NextAction {
  /** 行动类型 */
  actionType:
    | 'review_critical_goal'
    | 'confirm_proposal'
    | 'review_dashboard'
    | 'handle_alert'
    | 'no_action';
  /** 行动描述 */
  description: string;
  /** 优先级 */
  priority: 'P0' | 'P1' | 'P2';
  /** 关联的 Goal ID（可选） */
  targetGoalId?: string;
  /** 推荐理由 */
  reason: string;
}

// ═══ DNDConfig ═══

/**
 * 免打扰配置。
 *
 * 数据来源: dnd-engine.ts 消费此配置判定告警是否应推送。
 */
export interface DNDConfig {
  /** 免打扰时段列表 */
  quietHours?: Array<{
    /** 星期几 (0=周日, 1=周一, ...) */
    dayOfWeek: number;
    /** 开始时间 HH:mm */
    start: string;
    /** 结束时间 HH:mm */
    end: string;
  }>;
  /** 同一 Goal+哨兵组合的 P1 告警最小间隔（小时），默认 168（7天） */
  p1MinIntervalHours?: number;
  /** 已消除告警的重复抑制时间（小时），默认 168（7天） */
  dismissedSuppressHours?: number;
}

/** 默认免打扰配置 */
export const DEFAULT_DND_CONFIG: DNDConfig = {
  quietHours: [],
  p1MinIntervalHours: 168,
  dismissedSuppressHours: 168,
};

// ═══ DepartmentWorkspace ═══

/**
 * 部门工作台全量数据聚合。
 *
 * 数据来源: workspace-builder.ts buildDepartmentWorkspace() 聚合结果。
 * 每步独立 try-catch，单点故障标记 degraded 不阻断其他模块。
 *
 * @degraded — 某个子模块失败时 degraded=true，degradedModules[] 记录失败详情。
 */
export interface DepartmentWorkspace {
  /** 部门唯一标识 */
  departmentId: string;
  /** 部门名称 */
  name: string;
  /** 当前活跃 Goal 列表 */
  activeGoals: ActiveGoal[];
  /** 近期告警（受免打扰过滤后） */
  recentAlerts: WorkspaceAlert[];
  /** 待处理 Proposal */
  pendingProposals: PendingProposal[];
  /** 最近诊断报告引用（最多 3 份） */
  diagnosticsReferenced: DiagnosticReference[];
  /** 推荐的下一步行动 */
  nextAction: NextAction | null;
  /** 是否有降级 */
  degraded: boolean;
  /** 降级模块详情列表 */
  degradedModules: Array<{ step: string; error: string }>;
}
