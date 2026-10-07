/**
 * tests/growth/e2e-navigation-loop.integration.test.ts — D77 增长导航端到端测试
 *
 * 全链路: 诊断→Proposal→Goal→方案哨兵→偏离→轻量级再诊断→知识回流
 *
 * 使用 mock 存储模拟 GraphStore，测试各模块之间的数据流转正确性。
 * 不依赖真实数据库，所有 store 为内存 mock。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { GraphBridgeLike, AuditStoreLike } from '../../src/growth/goal-types';

/** 共享 mock 存储 */
function createMockStores() {
  const nodes = new Map<string, Record<string, unknown>>();
  const auditLogs: unknown[] = [];

  const store: GraphBridgeLike = {
    createNode: vi.fn((type: string, props: Record<string, unknown>) => {
      // 按类型选择 ID 字段: GOAL 用 goalId, PROPOSAL 用 proposalId
      const nodeId = (
        type === 'GOAL' ? props.goalId :
        type === 'PROPOSAL' ? props.proposalId :
        `${type.toLowerCase()}-${Date.now()}`
      ) as string;
      nodes.set(nodeId, { ...props });
      return nodeId;
    }),
    getNode: vi.fn((id: string) => {
      const props = nodes.get(id);
      return props ? { id, type: 'GOAL', props } : null;
    }),
    updateNode: vi.fn((id: string, props: Record<string, unknown>) => {
      const existing = nodes.get(id);
      if (existing) nodes.set(id, { ...existing, ...props });
    }),
    queryNodes: vi.fn((type: string, filters?: Record<string, unknown>) => {
      return [...nodes.entries()]
        .filter(([_, props]) => {
          if (!filters) return true;
          return Object.entries(filters).every(([k, v]) => props[k] === v);
        })
        .map(([id, props]) => ({ id, type, props }));
    }),
  };

  // AuditStore 的 mock
  const auditStore: AuditStoreLike = {
    write: vi.fn().mockResolvedValue('audit-entry-1'),
  };

  return { nodes, store, auditStore, auditLogs };
}

describe('D77: 增长导航 e2e — 全链路', () => {
  let mockStores: ReturnType<typeof createMockStores>;

  beforeAll(() => {
    vi.resetAllMocks();
  });

  it('完整链路: 诊断→Proposal→Goal→哨兵→再诊断→知识回流', async () => {
    mockStores = createMockStores();

    // ── Step 1: 诊断报告 → Proposal ──
    const { generateProposalFromDiagnosis } = await import('../../src/growth/proposal-engine');
    const report = {
      diagnosisId: 'diag-1',
      title: '成本结构诊断',
      department: 'finance',
      confidence: 0.85,
      keyRisks: ['利润下滑风险'],
      triggeringSentinels: ['sentinel-margin-health'],
      actionRecommendations: [
        { description: '优化成本结构', riskLevel: 'high' as const, expectedImpact: '提升利润率5%', timeline: '3个月' },
        { description: '改善现金流', riskLevel: 'medium' as const, expectedImpact: '降低负债率', timeline: '6个月' },
        { description: '拓展新市场', riskLevel: 'low' as const, expectedImpact: '营收增长', timeline: '12个月' },
      ],
    };

    const proposal = generateProposalFromDiagnosis(report, mockStores.store, mockStores.auditStore);
    expect(proposal).toBeDefined();
    expect(proposal.title).toBe('成本结构诊断');
    expect(proposal.paths).toHaveLength(3);
    expect(mockStores.store.createNode).toHaveBeenCalled();

    // ── Step 2: Proposal → Goal ──
    const { generateGoalFromProposal } = await import('../../src/growth/proposal-engine');
    const { updateProposalStatus } = await import('../../src/growth/proposal-store');
    // 状态转换: draft → pending_selection → selected (通过 selectPath)
    updateProposalStatus(proposal.proposalId, 'pending_selection', 'system', {}, mockStores.store, mockStores.auditStore);
    const { selectPath } = await import('../../src/growth/proposal-store');
    selectPath(proposal.proposalId, 1, 'manager', mockStores.store, mockStores.auditStore);
    // GA 确认（需要先到 pending_ga_confirmation）
    const { confirmByGa } = await import('../../src/growth/proposal-store');
    updateProposalStatus(proposal.proposalId, 'pending_ga_confirmation', 'system', {}, mockStores.store, mockStores.auditStore);
    confirmByGa(proposal.proposalId, 'ga-user', mockStores.store, mockStores.auditStore);
    // 从 store 获取最新 Proposal 状态（confirmed）
    const { getProposal } = await import('../../src/growth/proposal-store');
    const confirmedProposal = getProposal(proposal.proposalId, mockStores.store);
    expect(confirmedProposal).not.toBeNull();
    expect(confirmedProposal!.status).toBe('confirmed');
    // 生成 Goal
    const goalIds = generateGoalFromProposal(confirmedProposal!, mockStores.store, mockStores.auditStore);

    expect(goalIds.length).toBeGreaterThan(0);
    const goalId = goalIds[0];
    expect(goalId).toBeTruthy();

    // ── Step 3: 获取 Goal 并验证字段 ──
    const { getGoal } = await import('../../src/growth/goal-store');
    const goal = getGoal(goalId, mockStores.store);
    expect(goal).not.toBeNull();
    if (!goal) return; // TypeScript narrow
    expect(goal.ownerDeptId).toBeTruthy();
    expect(goal.reDiagnosisCount).toBe(0);

    // 将 Goal 状态从 draft 推进到 active（closeGoal 需要 active 状态）
    const { updateGoalStatus } = await import('../../src/growth/goal-store');
    updateGoalStatus(goalId, 'pending_ga', mockStores.store, mockStores.auditStore);
    updateGoalStatus(goalId, 'active', mockStores.store, mockStores.auditStore);
    const activeGoal = getGoal(goalId, mockStores.store);
    expect(activeGoal?.status).toBe('active');

    // ── Step 4: 创建方案哨兵 + 偏离检测 ──
    const { createGoalSentinel } = await import('../../src/growth/goal-sentinel');
    const goalSentinel = createGoalSentinel(
      activeGoal!,
      {
        baselineStatus: 'active',
        samples: [{ value: 50, timestamp: new Date(Date.now() - 7 * 86400000).toISOString() }],
        sustainedAlertCycles: 3,
      },
    );
    const checkResult = await goalSentinel.check({ db: {}, now: new Date() });
    expect(checkResult.ok).toBe(true);
    expect(Array.isArray(checkResult.findings)).toBe(true);

    // ── Step 5: 轻量级再诊断 ──
    const { lightweightReDiagnosis } = await import('../../src/growth/lightweight-diagnosis');
    const rediagnosisResult = await lightweightReDiagnosis(
      { goalId, triggeredBy: 'p0_alert', timeoutMs: 100 },
      {
        getGoal: vi.fn().mockReturnValue({ ...activeGoal!, reDiagnosisCount: 0 }),
        callExpert: vi.fn().mockResolvedValue({
          suggestedAdjustment: 'adjust_target',
          description: '建议调整目标值',
          suggestedNewTarget: 6,
          affectedMetric: '成本控制',
          degraded: false,
        }),
        incrementReDiagnosisCount: vi.fn(),
      },
    );
    expect(rediagnosisResult.adjustmentType).toBe('adjust_target');
    expect(rediagnosisResult.degraded).toBe(false);

    // ── Step 6: 闭环 Goal + 知识回流 ──
    const { closeGoal } = await import('../../src/growth/goal-lifecycle');
    // 先设置 successCriteria 满足前置条件
    const goalBeforeClose = getGoal(goalId, mockStores.store);
    if (goalBeforeClose) {
      updateGoalStatus(goalId, goalBeforeClose.status, mockStores.store, mockStores.auditStore, 'growth', {
        successCriteria: [{ criterion: '目标达成', verificationMethod: 'metric_threshold', verified: true }],
      });
    }
    await closeGoal(goalId, 'partially_achieved', [
      { metricName: '目标达成', currentValue: 70, targetValue: 100, unit: '%', computeContractId: 'test' },
    ], mockStores.store, mockStores.auditStore);

    // 验证 Goal 状态变更为 completed
    const closedGoal = getGoal(goalId, mockStores.store);
    expect(closedGoal).not.toBeNull();
    expect(closedGoal!.status).toBe('completed');
  });

  it('无数据时 Proposal 仍能生成', async () => {
    mockStores = createMockStores();
    const { generateProposalFromDiagnosis } = await import('../../src/growth/proposal-engine');
    const report = {
      diagnosisId: 'diag-empty',
      title: '空诊断',
      department: 'finance',
      confidence: 0.5,
      keyRisks: [],
      triggeringSentinels: [],
      actionRecommendations: [],
    };

    const proposal = generateProposalFromDiagnosis(report, mockStores.store, mockStores.auditStore);
    expect(proposal).toBeDefined();
    expect(proposal.paths).toHaveLength(3);
  });

  it('单阶段失败不阻断整体流程', async () => {
    mockStores = createMockStores();

    // 哨兵检测可以有 findings 但不至于崩溃
    const { createGoalSentinel } = await import('../../src/growth/goal-sentinel');
    const goal = {
      goalId: 'goal-resilient',
      orgId: 'org-1',
      proposalId: 'prop-1',
      diagnosisId: 'diag-1',
      title: '弹性测试',
      description: 'test',
      priority: 'P1' as const,
      status: 'active' as const,
      ownerDeptId: 'engineering',
      assignedTo: '张三',
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      deadline: new Date(Date.now() + 60 * 86400000).toISOString(),
      metrics: [{ metricName: '测试覆盖率', currentValue: 50, targetValue: 80, unit: '%', computeContractId: 'test' }],
      successCriteria: [],
      dependsOn: [],
      conflictsWith: [],
      reDiagnosisCount: 0,
      createdBy: { role: 'manager' },
      lastModifiedAt: new Date().toISOString(),
      plannedDurationDays: 90,
    };

    const sentinel = createGoalSentinel(goal, {
      baselineStatus: 'active',
      samples: [],
      sustainedAlertCycles: 0,
    });
    const result = await sentinel.check({ db: {}, now: new Date() });
    // 即使没有数据，哨兵也应返回 ok 而非崩溃
    expect(result.ok).toBe(true);
  });
});
