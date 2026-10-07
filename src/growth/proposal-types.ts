/**
 * src/growth/proposal-types.ts — Proposal 类型定义
 *
 * 第13份权威文档（增长导航系统工程规范）第二章。
 * Proposal = 诊断建议 → 3条可选路径 → 中层选择 → GA确认 → Goal执行。
 *
 * @wire-target — D73 (方案哨兵) 消费 ProposalStatus
 * @wire-target — D75 (轻量级再诊断) 消费 ProposalDispute
 * @wire-target — D77 (主Agent集成) 消费 generateProposalFromDiagnosis
 *
 * 契约:
 *   @input  — 11态状态机 + 3条可选路径 + 4条非理想路径
 *   @output — 类型安全的封闭枚举
 *   @degraded — 不适用（纯类型定义，无运行时逻辑）
 */

// ═══ Proposal 11态状态机 ═══

/**
 * Proposal 的 11 种生命周期状态。
 *
 * 主路径:
 *   draft → pending_selection → selected → pending_ga_confirmation → confirmed → executing → completed
 *
 * 非理想路径:
 *   pending_selection → expired          (5工作日未选择 → 自动选默认)
 *   confirmed → disputed                 (中层提出异议)
 *   disputed → regenerating              (触发轻量级再诊断)
 *   pending_ga_confirmation → expired    (GA超时未确认)
 *   pending_ga_confirmation → ga_rejected (GA驳回)
 *   any → regenerating                   (中层拒绝 → 重新生成)
 *
 * 废弃/归档不可逆。
 */
export type ProposalStatus =
  | 'draft'
  | 'pending_selection'
  | 'selected'
  | 'pending_ga_confirmation'
  | 'confirmed'
  | 'executing'
  | 'completed'
  | 'expired'
  | 'disputed'
  | 'regenerating'
  | 'ga_rejected';

/** 全部 11 个有效 ProposalStatus 值 */
export const VALID_PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'draft', 'pending_selection', 'selected', 'pending_ga_confirmation',
  'confirmed', 'executing', 'completed',
  'expired', 'disputed', 'regenerating', 'ga_rejected',
];

// ═══ ProposalPath ═══

/**
 * 一条可选路径（共 3 条）。
 * 每条路径包含独立的策略假设、风险水平、预期影响和权衡说明。
 */
export interface ProposalPath {
  /** 路径标签（如 "激进增长", "稳健优化", "防御收缩"） */
  label: string;
  /** 风险等级 */
  riskLevel: 'high' | 'medium' | 'low';
  /** 预期影响描述 */
  expectedImpact: string;
  /** 权衡/取舍说明 */
  tradeoffs: string;
  /** 推荐理由 */
  recommendationReason: string;
  /** 是否为默认路径（超时自动选择此路） */
  isDefault: boolean;
  /** 此路径将要生成的 Goal ID 列表（生成后填充） */
  goals: string[];
  /** 压力测试结果（可选） */
  pressureTestResults?: Array<{
    scenario: string;
    outcome: string;
    resilience: 'pass' | 'marginal' | 'fail';
  }>;
}

// ═══ ProposalDispute ═══

/**
 * 中层对 Proposal 的异议记录。
 * 触发轻量级再诊断（D75）或 GA 仲裁。
 */
export interface ProposalDispute {
  /** 异议原因 */
  reason: string;
  /** 替代证据 */
  alternativeEvidence?: string;
  /** 建议的置信度修正 */
  suggestedConfidence?: number;
  /** 提出时间 */
  createdAt: string;
  /** 提出者 */
  raisedBy: string;
}

// ═══ ProposalTimeline ═══

/**
 * Proposal 关键时间线。
 */
export interface ProposalTimeline {
  /** 创建时间 */
  createdAt: string;
  /** 中层选择路径时间 */
  selectedAt?: string;
  /** GA 确认时间 */
  confirmedAt?: string;
  /** 过期时间（超时 = createdAt + 5工作日） */
  expiresAt?: string;
  /** 完成时间 */
  completedAt?: string;
}

// ═══ Proposal 完整接口 ═══

/**
 * Proposal — 增长导航系统中的诊断提案。
 *
 * 一条诊断产出 → 3 条可选路径 → 中层选择 → GA 确认 → 转换为 Goal 执行。
 *
 * @contract status 只能是 11 态之一，受状态转换规则约束
 * @contract paths 长度为 3（正好 3 条可选路径）
 * @contract selectedPathIndex 在 0-2 范围内，仅 selected+ 状态非空
 * @contract orgId（#1322 新增）为**租户 id**，唯一合法来源是验签后的 `req.auth.orgId`；
 *   与 `department`（部门）**不是一回事** —— 缺省 undefined 表示旧数据（无租户标注），
 *   消费方需 fail-closed 或走 department 兼容回退（见 proposal-engine.ts 的注释）。
 */
export interface Proposal {
  /** 唯一标识 */
  proposalId: string;
  /**
   * 所属组织（租户）ID。
   *
   * #1322 新增：真身份有 orgId（`middleware/auth.ts:29` 的 JwtPayload.orgId），但
   * Proposal 此前不带 ⇒ 无法表达「这条提案属于哪个租户」⇒ 跨租户"选定"无法拒绝。
   * 缺省 undefined 仅为兼容存量/测试夹具，**新写入一律由路由从 `req.auth` 注入**。
   */
  orgId?: string;
  /** 来源诊断报告 ID */
  diagnosisReportId: string;
  /** 提案标题 */
  title: string;
  /** 所属部门 */
  department: string;
  /** 3 条可选路径 */
  paths: ProposalPath[];
  /** 被选中的路径索引（0-2，选中前为 undefined） */
  selectedPathIndex?: number;
  /** Proposal 执行的上下文信息 */
  context: {
    /** 诊断置信度 */
    diagnosisConfidence: number;
    /** 关键风险摘要 */
    keyRisks: string[];
    /** 触发此诊断的哨兵告警列表 */
    triggeringSentinels: string[];
  };
  /** 当前生命周期状态 */
  status: ProposalStatus;
  /** 变更次数（已确认后中层想改，最多 2 次） */
  changeCount: number;
  /** 关键时间线 */
  timeline: ProposalTimeline;
  /** 遗忘提醒次数 */
  forgottenReminderCount: number;
  /** 最后活跃时间（用于遗忘检测） */
  lastActiveAt: string;
  /** 创建部门 */
  createdBy: string;
  /** 审计日志 */
  auditLog: Array<{
    action: string;
    actor: string;
    timestamp: string;
    detail?: string;
  }>;
  /** 异议记录（disputed 时存在） */
  dispute?: ProposalDispute;
  /** GA 驳回原因 */
  rejectionReason?: string;
}

// ═══ 状态转换规则类型 ═══

export interface ProposalTransitionRule {
  from: ProposalStatus;
  to: ProposalStatus;
  description: string;
}

// ═══ 时间常量 ═══

/** 5 个工作日的毫秒数（简化: 5 × 24h） */
export const PROPOSAL_EXPIRY_MS = 5 * 24 * 60 * 60 * 1000;

/** 遗忘检测间隔（7 天） */
export const PROPOSAL_FORGOTTEN_MS = 7 * 24 * 60 * 60 * 1000;

/** 最大变更次数 */
export const MAX_CHANGE_COUNT = 2;
