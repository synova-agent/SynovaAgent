/**
 * src/growth/proposal-store.ts — Proposal 持久化存储
 *
 * 基于 GraphStore 的 PROPOSAL 类型节点存储。
 * 实现 11 态状态机转换验证 + AuditStore 审计日志。
 *
 * 契约:
 *   @input  — Proposal 对象 + GraphBridgeLike/AuditStoreLike（依赖注入）
 *   @output — 按函数定义返回
 *   @degraded — GraphStore 不可用时返回降级结果，不崩溃
 */
import { randomUUID } from 'crypto';
import { createLogger } from '@synova/logger';
import type { GraphBridgeLike, AuditStoreLike } from './goal-types';
import type { Proposal, ProposalStatus, ProposalTimeline, ProposalTransitionRule } from './proposal-types';
// #1322 B1: 实体 id → 图节点 id 的共用解析件（与 goal-store 同源，避免两份实现漂移）
import { resolveEntityNode } from './goal-store';

const log = createLogger('growth/proposal-store');

// ═══ 11 态状态转换规则 ═══

/**
 * Proposal 合法状态转换规则。
 * 不在表中的组合被视为非法转换。
 */
export const PROPOSAL_TRANSITIONS: ProposalTransitionRule[] = [
  // — 主路径 —
  { from: 'draft', to: 'pending_selection', description: '提交给中层选择' },
  { from: 'pending_selection', to: 'selected', description: '中层选择一条路径' },
  { from: 'selected', to: 'pending_ga_confirmation', description: '提交 GA 确认' },
  { from: 'pending_ga_confirmation', to: 'confirmed', description: 'GA 确认通过' },
  { from: 'confirmed', to: 'executing', description: '转换为 Goal 开始执行' },
  { from: 'executing', to: 'completed', description: '执行完成' },
  // — 非理想路径: 超时 —
  { from: 'pending_selection', to: 'expired', description: '5 工作日未选择，自动选默认' },
  { from: 'pending_ga_confirmation', to: 'expired', description: 'GA 超时未确认' },
  // — 非理想路径: 变更 —
  { from: 'confirmed', to: 'disputed', description: '中层提出异议/想变更' },
  { from: 'disputed', to: 'selected', description: '异议解决，返回已选状态' },
  // — 非理想路径: 拒绝+再诊断 —
  { from: 'disputed', to: 'regenerating', description: '触发轻量级再诊断' },
  { from: 'regenerating', to: 'draft', description: '重新生成 Proposal' },
  // — 非理想路径: GA 驳回 —
  { from: 'pending_ga_confirmation', to: 'ga_rejected', description: 'GA 驳回提案' },
  // — 非理想路径: 中层拒绝 —
  { from: 'selected', to: 'regenerating', description: '中层拒绝选中路径，重新生成' },
  // — 完成/归档 —
  { from: 'expired', to: 'completed', description: '过期后归档' },
  { from: 'ga_rejected', to: 'completed', description: '驳回后归档' },
];

/**
 * 判断 Proposal 状态转换是否合法。
 */
export function isValidProposalTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  if (from === to) return true;
  return PROPOSAL_TRANSITIONS.some(r => r.from === from && r.to === to);
}

/**
 * props 是否可视为 Proposal。
 *
 * 同 goal-store 的 `isGoalProps`：用**类型谓词**替代 `as unknown as Proposal`
 * （铁律 38 / CT-46 零容忍；CI 组 1 对新增行硬阻断）。形状锚只取 `proposalId`，
 * 其余字段由 `createProposal` 的写入契约保证（`proposal-types.ts`）。
 */
function isProposalProps(value: unknown): value is Proposal {
  return typeof value === 'object' && value !== null
    && typeof (value as { proposalId?: unknown }).proposalId === 'string';
}

// ═══ CRUD 操作 ═══

/**
 * 从诊断报告创建 Proposal。
 *
 * @param proposal - Proposal 数据（不含 proposalId，自动生成）
 * @param store - GraphBridge 实例
 * @param audit - AuditStore 实例
 * @param graph - 图名称
 * @returns 生成的 proposalId
 */
export function createProposal(
  proposal: Proposal,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
): string {
  const proposalId = randomUUID();

  const now = new Date().toISOString();
  const proposalNode: Proposal = {
    ...proposal,
    proposalId,
    status: proposal.status || 'draft',
    timeline: {
      ...proposal.timeline,
      createdAt: proposal.timeline?.createdAt || now,
      expiresAt: proposal.timeline?.expiresAt || new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    changeCount: proposal.changeCount ?? 0,
    forgottenReminderCount: proposal.forgottenReminderCount ?? 0,
    lastActiveAt: now,
    auditLog: [],
  };

  try {
    store.createNode('PROPOSAL', proposalNode as unknown as Record<string, unknown>, graph);
    log.info({ proposalId, title: proposal.title }, 'Proposal 已创建');

    audit.write({
      orgId: proposal.orgId ?? proposal.department,
      actorId: `system:proposal-store`,
      actorRole: 'system',
      action: 'proposal.created',
      targetType: 'PROPOSAL',
      targetId: proposalId,
      newValue: JSON.stringify({ title: proposal.title }),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, proposalId }, 'Proposal 创建审计日志写入失败');
    });

    return proposalId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId }, 'Proposal 创建失败');
    throw new Error(`创建 Proposal 失败: ${msg}`);
  }
}

/**
 * 按 ID 获取 Proposal。
 *
 * #1322 B1: 走 `resolveEntityNode`（真库节点主键是 `node-<uuid>`，`proposalId` 只在
 * props 里）⇒ 改前 `store.getNode(proposalId)` 对真库**恒 null**。
 */
export function getProposal(proposalId: string, store: GraphBridgeLike, graph: string = 'growth'): Proposal | null {
  try {
    const resolved = resolveEntityNode('PROPOSAL', 'proposalId', proposalId, store, graph);
    if (!resolved || !isProposalProps(resolved.props)) return null;
    return resolved.props;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId }, '获取 Proposal 失败');
    return null;
  }
}

/**
 * 按部门列出所有 Proposal。
 */
export function listProposalsByDept(deptId: string, store: GraphBridgeLike, graph: string = 'growth'): Proposal[] {
  try {
    const nodes = store.queryNodes('PROPOSAL', { department: deptId }, graph);
    return nodes.map(n => n.props as unknown as Proposal);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, deptId }, '按部门查询 Proposal 失败');
    return [];
  }
}

/**
 * 列出组织内待处理（pending_selection 或 pending_ga_confirmation）的 Proposal。
 */
export function listPendingProposals(orgId: string, store: GraphBridgeLike, graph: string = 'growth'): Proposal[] {
  try {
    const nodes = store.queryNodes('PROPOSAL', {}, graph);
    return nodes
      .map(n => n.props as unknown as Proposal)
      .filter(p => p.status === 'pending_selection' || p.status === 'pending_ga_confirmation');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, orgId }, '查询待处理 Proposal 失败');
    return [];
  }
}

// ═══ 状态转换函数 ═══

/**
 * 更新 Proposal 状态的内部函数。
 * 验证合法性 + 写入审计日志。
 */
export function updateProposalStatus(
  proposalId: string,
  newStatus: ProposalStatus,
  actor: string,
  extraProps: Partial<Proposal>,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string,
): void {
  // #1322 B1: 一次解析同时拿到 props 与**图节点 id**（语义与改前等价：
  // store 抛错 → log.error 后仍抛「Proposal <id> 不存在」，不泄漏底层错误、不静默）。
  let resolved: { nodeId: string; props: Record<string, unknown> } | null = null;
  try {
    resolved = resolveEntityNode('PROPOSAL', 'proposalId', proposalId, store, graph);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId }, '获取 Proposal 失败');
  }
  if (!resolved || !isProposalProps(resolved.props)) {
    throw new Error(`Proposal ${proposalId} 不存在`);
  }
  const proposal = resolved.props;

  const fromStatus = proposal.status;

  if (!isValidProposalTransition(fromStatus, newStatus)) {
    throw new Error(`非法 Proposal 状态转换: ${fromStatus} → ${newStatus}`);
  }

  const now = new Date().toISOString();
  const updatedProps: Proposal = {
    ...proposal,
    ...extraProps,
    status: newStatus,
    lastActiveAt: now,
    auditLog: [
      ...proposal.auditLog,
      { action: `status:${fromStatus}→${newStatus}`, actor, timestamp: now },
    ],
  };

  try {
    store.updateNode(resolved.nodeId, { ...updatedProps }, graph);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId, fromStatus, newStatus }, 'Proposal 状态更新失败');
    throw new Error(`更新 Proposal 状态失败: ${msg}`);
  }

  audit.write({
    orgId: proposal.orgId ?? proposal.department,
    actorId: actor,
    actorRole: 'system',
    action: `proposal.status.${fromStatus}→${newStatus}`,
    targetType: 'PROPOSAL',
    targetId: proposalId,
    oldValue: JSON.stringify({ status: fromStatus }),
    newValue: JSON.stringify({ status: newStatus }),
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, proposalId }, 'Proposal 审计日志写入失败');
  });
}

/**
 * 中层选择一条路径。
 *
 * @param proposalId - Proposal ID
 * @param pathIndex - 选中的路径索引（0/1/2）
 * @param actor - 操作者
 */
export function selectPath(
  proposalId: string,
  pathIndex: number,
  actor: string,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
): void {
  const proposal = getProposal(proposalId, store, graph);
  if (!proposal) {
    throw new Error(`Proposal ${proposalId} 不存在`);
  }

  if (pathIndex < 0 || pathIndex >= proposal.paths.length) {
    throw new Error(`路径索引非法: ${pathIndex}（共 ${proposal.paths.length} 条路径）`);
  }

  updateProposalStatus(proposalId, 'selected', actor, {
    selectedPathIndex: pathIndex,
    timeline: { ...proposal.timeline, selectedAt: new Date().toISOString() },
  }, store, audit, graph);
}

/**
 * GA 确认 Proposal。
 */
export function confirmByGa(
  proposalId: string,
  actor: string,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
): void {
  const current = getProposal(proposalId, store, graph);
  const timeline: ProposalTimeline = current?.timeline || { createdAt: new Date().toISOString() };
  updateProposalStatus(proposalId, 'confirmed', actor, {
    timeline: { ...timeline, confirmedAt: new Date().toISOString() },
  }, store, audit, graph);
}

/**
 * GA 驳回 Proposal。
 */
export function rejectByGa(
  proposalId: string,
  reason: string,
  actor: string,
  store: GraphBridgeLike,
  audit: AuditStoreLike,
  graph: string = 'growth',
): void {
  if (!reason || reason.trim().length === 0) {
    throw new Error('驳回原因不能为空');
  }
  updateProposalStatus(proposalId, 'ga_rejected', actor, { rejectionReason: reason }, store, audit, graph);
}

/**
 * 检查超时 Proposal → 自动选默认路径。
 *
 * 扫描所有 pending_selection 状态的 Proposal，
 * 如果超时（createdAt + 5 工作日 > 当前时间），自动选择 isDefault 路径。
 *
 * @returns 被自动选择的 Proposal ID 列表
 */
export function checkExpiry(store: GraphBridgeLike, audit: AuditStoreLike, graph: string = 'growth'): string[] {
  const expired: string[] = [];

  try {
    const nodes = store.queryNodes('PROPOSAL', {}, graph);
    const now = Date.now();

    for (const node of nodes) {
      const proposal = node.props as unknown as Proposal;
      if (proposal.status !== 'pending_selection') continue;

      const expiresAt = new Date(proposal.timeline.expiresAt || proposal.timeline.createdAt).getTime();
      if (now >= expiresAt) {
        const defaultIdx = proposal.paths.findIndex(p => p.isDefault);
        const idx = defaultIdx >= 0 ? defaultIdx : 0;

        log.warn({ proposalId: proposal.proposalId, defaultIdx: idx }, 'Proposal 超时，自动选择默认路径');

        updateProposalStatus(proposal.proposalId, 'expired', 'system', {
          selectedPathIndex: idx,
          timeline: { ...proposal.timeline, selectedAt: new Date().toISOString() },
        }, store, audit, graph);

        expired.push(proposal.proposalId);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Proposal 超时检查失败');
  }

  return expired;
}
