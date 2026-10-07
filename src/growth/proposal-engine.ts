/**
 * src/growth/proposal-engine.ts — Proposal 引擎
 *
 * 诊断建议 → 3 条可选路径展开 → 中层选择 → GA 确认 → Goal 生成。
 * 消费 D71 goal-store 的 createGoal。
 *
 * 契约:
 *   @input  — 诊断报告数据 + GraphBridgeLike/AuditStoreLike/PolicyEngineLike（依赖注入）
 *   @output — Proposal 对象 / Goal ID / 处理结果
 *   @degraded — 各步骤独立降级，不阻断整体流程
 */
import { createLogger } from '@synova/logger';
import type { GraphBridgeLike, AuditStoreLike, PolicyEngineLike, Goal, GoalMetric } from './goal-types';
import type { Proposal, ProposalPath, ProposalStatus } from './proposal-types';
import { createProposal, getProposal, updateProposalStatus, checkExpiry } from '../growth/proposal-store';
import { createGoal } from '../growth/goal-store';

const log = createLogger('growth/proposal-engine');

// ═══ 诊断报告输入接口 ═══

/**
 * 最小诊断报告接口（供 generateProposalFromDiagnosis 使用）。
 * D77 将替换为完整的 StandardExpertReport 类型。
 */
export interface DiagnosisReportLike {
  diagnosisId: string;
  title: string;
  department: string;
  /**
   * 所属组织（租户）ID —— #1322 新增。
   *
   * @contract **唯一合法来源是验签后的 `req.auth.orgId`**（路由侧注入，
   *   `src/middleware/auth.ts:492-503` 的 `extractAuthFromRequest`）；
   *   **绝不接受客户端 body 传入**（否则租户隔离判据可被伪造）。
   * @contract 缺省 undefined ⇒ 走旧行为（proposal.orgId 不写），仅为存量调用方兼容。
   */
  orgId?: string;
  confidence: number;
  keyRisks: string[];
  triggeringSentinels: string[];
  /** D71 StandardExpertReport→Goal 映射表引用的 actionRecommendations */
  actionRecommendations: Array<{
    description: string;
    riskLevel: 'high' | 'medium' | 'low';
    expectedImpact: string;
    timeline: string;
  }>;
}

// ═══ 3 路径生成 ═══

/**
 * 从诊断报告生成 Proposal（含 3 条可选路径）。
 *
 * 根据诊断置信度、风险水平和触发哨兵，展开 3 条策略路径:
 *   路径 0 = 保守/防御型（低风险）
 *   路径 1 = 均衡/稳健型（中风险）
 *   路径 2 = 激进/增长型（高风险，若置信度足够高则设为默认）
 *
 * @param report - 诊断报告数据
 * @param store - GraphBridge 实例
 * @param audit - AuditStore 实例
 * @returns 生成的 Proposal（含 3 条路径）
 */
export function generateProposalFromDiagnosis(
  report: DiagnosisReportLike,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
): Proposal {
  const now = new Date().toISOString();

  // 根据诊断报告生成 3 条路径
  const isHighConfidence = report.confidence >= 0.7;
  const paths: ProposalPath[] = [
    {
      label: '稳健优化',
      riskLevel: 'low',
      expectedImpact: report.actionRecommendations[0]?.expectedImpact || '小幅改善核心指标',
      tradeoffs: '速度较慢，但风险可控',
      recommendationReason: '基于当前诊断置信度较低或风险偏好保守的默认选择',
      isDefault: !isHighConfidence,
      goals: [],
      pressureTestResults: [
        { scenario: '市场下行', outcome: '影响最小，可维持', resilience: 'pass' },
        { scenario: '资源收缩', outcome: '可逐步推进', resilience: 'pass' },
      ],
    },
    {
      label: '均衡推进',
      riskLevel: 'medium',
      expectedImpact: report.actionRecommendations[0]?.expectedImpact || '稳步改善关键指标',
      tradeoffs: '平衡速度与风险',
      recommendationReason: '适中风险，兼顾短期改善与长期布局',
      isDefault: false,
      goals: [],
      pressureTestResults: [
        { scenario: '市场下行', outcome: '部分延迟但可完成', resilience: 'marginal' },
        { scenario: '资源收缩', outcome: '需调整优先级', resilience: 'marginal' },
      ],
    },
    {
      label: '积极增长',
      riskLevel: 'high',
      expectedImpact: report.actionRecommendations[0]?.expectedImpact || '大幅提升关键指标',
      tradeoffs: '高回报伴随高风险',
      recommendationReason: isHighConfidence ? '高置信度，可采取积极策略' : '需谨慎评估风险',
      isDefault: isHighConfidence,
      goals: [],
      pressureTestResults: [
        { scenario: '市场下行', outcome: '可能严重受挫', resilience: 'fail' },
        { scenario: '资源充足', outcome: '最大化收益', resilience: 'pass' },
      ],
    },
  ];

  // 根据风险级别调整路径详细内容
  if (report.actionRecommendations.length > 1) {
    paths[1].expectedImpact = report.actionRecommendations[1]?.expectedImpact || paths[1].expectedImpact;
  }
  if (report.actionRecommendations.length > 2) {
    paths[2].expectedImpact = report.actionRecommendations[2]?.expectedImpact || paths[2].expectedImpact;
  }

  const proposal: Proposal = {
    proposalId: '',
    // #1322: 租户由调用方（路由）从验签身份注入；缺省 undefined ⇒ 不写该字段（旧行为）
    orgId: report.orgId,
    diagnosisReportId: report.diagnosisId,
    title: report.title,
    department: report.department,
    paths,
    context: {
      diagnosisConfidence: report.confidence,
      keyRisks: report.keyRisks,
      triggeringSentinels: report.triggeringSentinels,
    },
    status: 'draft',
    changeCount: 0,
    timeline: {
      createdAt: now,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    forgottenReminderCount: 0,
    lastActiveAt: now,
    createdBy: 'system:proposal-engine',
    auditLog: [{ action: 'proposal.generated', actor: 'system', timestamp: now }],
  };

  const proposalId = createProposal(proposal, store, audit);
  return { ...proposal, proposalId };
}

/**
 * 目标创建的可选覆盖项（#1322）。
 *
 * 为什么需要：`metrics[0].targetValue` 的引擎默认值是常量 100，**不可分辨**
 * 「真写入了用户提的值」与「写死常量」⇒ V1/V2 判据会失去判别力。
 * 由调用方把「用户提的目标值」透传进来，读回面才有可核的期望值。
 */
export interface GoalCreationOverrides {
  /** 目标值（缺省 100，与原行为逐字一致） */
  targetValue?: number;
  /** 单位（缺省 '%'） */
  unit?: string;
  /** 指标名（缺省 '目标达成'） */
  metricName?: string;
}

/**
 * 从选中的 Proposal 路径生成 Goal。
 *
 * 消费 D71 createGoal，将选中路径转换为可执行的 Goal。
 *
 * @param proposal - 已选路径的 Proposal
 * @param store - GraphBridge 实例
 * @param audit - AuditStore 实例
 * @param opts - 可选。目标值/单位/指标名覆盖（见 GoalCreationOverrides）
 * @returns 生成的 Goal ID 列表（**实体 id**；图节点 id 为 `node-<uuid>`，二者不同）
 * @degraded 无降级：store 抛错 → log.error + 抛 `生成 Goal 失败: <msg>`
 *   （**刻意不改**：把创建失败伪装成成功会直接毁掉 V1 的判别力）
 */
export function generateGoalFromProposal(
  proposal: Proposal,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  opts?: GoalCreationOverrides,
): string[] {
  if (proposal.status !== 'confirmed' && proposal.status !== 'executing') {
    throw new Error(`只能从 confirmed/executing 状态的 Proposal 生成 Goal（当前: ${proposal.status}）`);
  }

  if (proposal.selectedPathIndex === undefined) {
    throw new Error('Proposal 未选中任何路径');
  }

  const path = proposal.paths[proposal.selectedPathIndex];
  if (!path) {
    throw new Error(`路径索引非法: ${proposal.selectedPathIndex}`);
  }

  const now = new Date().toISOString();
  const goalIds: string[] = [];

  // 根据路径风险级别设置 Goal 优先级
  const priorityMap: Record<string, 'P0' | 'P1' | 'P2'> = {
    high: 'P0',
    medium: 'P1',
    low: 'P2',
  };

  // 创建 Goal
  // #1322 修正（卡 §③3 / 现状 7）：orgId 是**租户**，department 是**部门** —— 二者不可互换。
  //   proposal.orgId 由调用方从验签身份注入（唯一合法来源）。
  // 🔴 CTO 复核必改（残余风险）: **已删除 `?? proposal.department` 回退** —— 那是
  //   「命名错位复发口」（orgId 位被 department 顶替），与 D338「缺 orgId → null，
  //   绝不回落全局」同型；新 HTTP 路径够不到它，但非 HTTP 调用方会复发。
  //   无 orgId ⇒ **显式 fail-closed**：拒绝生成 + log.warn（不静默、不猜、不回落）。
  const orgId = proposal.orgId;
  if (typeof orgId !== 'string' || orgId.trim().length === 0) {
    log.warn(
      { proposalId: proposal.proposalId, department: proposal.department },
      'Proposal 缺少 orgId —— 拒绝生成 Goal（fail-closed，不回落 department）',
    );
    throw new Error(`Proposal ${proposal.proposalId} 缺少 orgId，拒绝生成 Goal（fail-closed）`);
  }
  const goal: Goal = {
    goalId: '',
    orgId,
    proposalId: proposal.proposalId,
    diagnosisId: proposal.diagnosisReportId,
    title: `${path.label}: ${proposal.title}`.substring(0, 100),
    description: `${path.recommendationReason} | ${path.expectedImpact}`,
    priority: priorityMap[path.riskLevel] || 'P1',
    status: 'draft',
    ownerDeptId: proposal.department,
    createdAt: now,
    deadline: proposal.timeline.confirmedAt
      ? new Date(new Date(proposal.timeline.confirmedAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    metrics: [{
      metricName: opts?.metricName ?? '目标达成',
      currentValue: 0,
      targetValue: opts?.targetValue ?? 100,
      unit: opts?.unit ?? '%',
      computeContractId: 'COMPUTE-GOAL-ACHIEVEMENT-v1',
    }],
    successCriteria: [],
    dependsOn: [],
    conflictsWith: [],
    reDiagnosisCount: 0,
    createdBy: { role: 'system', departmentId: proposal.department },
    lastModifiedAt: now,
    plannedDurationDays: 90,
    rootCause: proposal.context.keyRisks.join(', '),
  };

  try {
    const goalId = createGoal(goal, store, audit);
    goalIds.push(goalId);
    log.info({ goalId, proposalId: proposal.proposalId }, '从 Proposal 生成 Goal');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId: proposal.proposalId }, '从 Proposal 生成 Goal 失败');
    throw new Error(`生成 Goal 失败: ${msg}`);
  }

  return goalIds;
}

/**
 * 将 Proposal 状态转为 executing，表示 Goal 已生成并开始执行。
 */
export function startProposalExecution(
  proposalId: string,
  goalIds: string[],
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
): void {
  const proposal = getProposal(proposalId, store, graph);
  if (!proposal) {
    throw new Error(`Proposal ${proposalId} 不存在`);
  }

  // 更新路径的 goals 字段
  const updatedPaths = proposal.paths.map((p, i) =>
    i === proposal.selectedPathIndex ? { ...p, goals: goalIds } : p,
  );

  updateProposalStatus(proposalId, 'executing', 'system', { paths: updatedPaths }, store, audit, graph);
}

/**
 * 处理中层异议。
 *
 * 记录 Dispute，将 Proposal 状态转为 disputed。
 * 如果 dispute 次数超过阈值，触发 GA 通知。
 *
 * @returns 是否自动触发了再诊断标记
 */
/**
 * 处理 Proposal 异议。
 *
 * 如果 Proposal 处于 selected 状态 → 进入 regenerating 状态，标记 needsReDiagnosis=true。
 * 如果 Proposal 处于 confirmed 状态且变更次数未超限 → 进入 disputed 状态。
 *
 * @param onRediagnosis — 可选。当 needsReDiagnosis=true 时触发（D75 轻量级再诊断集成）
 */
export function handleDispute(
  proposalId: string,
  reason: string,
  raisedBy: string,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
  onRediagnosis?: (goalIds: string[], reason: string) => void,
): { needsReDiagnosis: boolean; newStatus: ProposalStatus } {
  const proposal = getProposal(proposalId, store, graph);
  if (!proposal) {
    throw new Error(`Proposal ${proposalId} 不存在`);
  }

  if (proposal.status !== 'confirmed' && proposal.status !== 'selected') {
    throw new Error(`只能对 confirmed/selected 状态的 Proposal 提出异议（当前: ${proposal.status}）`);
  }

  const now = new Date().toISOString();
  const dispute = {
    reason,
    createdAt: now,
    raisedBy,
  };

  // 已 confirmed 后更改 → count++，未超限则进入 disputed
  let newStatus: ProposalStatus;
  if (proposal.status === 'confirmed') {
    if (proposal.changeCount >= 2) {
      log.warn({ proposalId, changeCount: proposal.changeCount }, '变更次数超限，通知 GA 仲裁');
      // 状态不变，仅记录异议 — GA 需要人工介入
      return { needsReDiagnosis: false, newStatus: proposal.status };
    }
    newStatus = 'disputed';
  } else {
    // selected 状态 → 直接走重新生成
    newStatus = 'regenerating';
  }

  updateProposalStatus(proposalId, newStatus, raisedBy, {
    dispute,
    changeCount: proposal.changeCount + 1,
  }, store, audit, graph);

  const needsReDiagnosis = newStatus === 'regenerating';
  log.info({ proposalId, newStatus, needsReDiagnosis }, 'Proposal 异议已处理');

  // D75: needsReDiagnosis=true → 触发轻量级再诊断
  if (needsReDiagnosis && onRediagnosis) {
    try {
      // 从 Proposal 的 paths 中获取关联的 Goal ID 列表
      const goalIds = (proposal.paths || []).flatMap((p) => p.goals || []);
      if (goalIds.length > 0) {
        // 非阻塞触发
        setImmediate(async () => {
          try {
            await onRediagnosis(goalIds, reason);
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.warn({ err: errMsg, proposalId }, '轻量级再诊断（异议触发）失败');
          }
        });
      }
    } catch (triggerErr: unknown) {
      const triggerMsg = triggerErr instanceof Error ? triggerErr.message : String(triggerErr);
      log.warn({ err: triggerMsg, proposalId }, '轻量级再诊断触发异常');
    }
  }

  return { needsReDiagnosis, newStatus };
}

/**
 * 检查超时并自动选默认路径。
 * 代理调用 proposal-store.checkExpiry。
 */
export function checkExpiryAndAutoSelect(
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
): string[] {
  return checkExpiry(store, audit, graph);
}
