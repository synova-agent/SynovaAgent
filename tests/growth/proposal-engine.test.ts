/**
 * tests/growth/proposal-engine.test.ts — D72 ProposalEngine 单元测试
 *
 * 覆盖: 3路径生成/Goal生成/异议处理/超时自动/GA驳回
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphBridgeLike, AuditStoreLike, PolicyEngineLike, Goal } from '../../src/growth/goal-types';
import type { Proposal } from '../../src/growth/proposal-types';
import type { DiagnosisReportLike } from '../../src/growth/proposal-engine';

// ═══ Mock 基础设施 ═══

function createMocks(): {
  store: GraphBridgeLike;
  audit: AuditStoreLike;
  policy: PolicyEngineLike;
  auditEntries: unknown[];
  goals: Map<string, Goal>;
  proposals: Map<string, Proposal>;
} {
  const goals = new Map<string, Goal>();
  const proposals = new Map<string, Proposal>();
  const auditEntries: unknown[] = [];

  const store: GraphBridgeLike = {
    createNode(type, props) {
      const id = (props.proposalId as string) || (props.goalId as string) || `mock-${goals.size + proposals.size + 1}`;
      if (type === 'GOAL') {
        const g = props as unknown as Goal;
        goals.set(id, g);
      } else {
        const p = props as unknown as Proposal;
        proposals.set(id, p);
      }
      return id;
    },
    getNode(id) {
      const g = goals.get(id);
      if (g) return { id, type: 'GOAL', props: g as unknown as Record<string, unknown> };
      const p = proposals.get(id);
      if (p) return { id, type: 'PROPOSAL', props: p as unknown as Record<string, unknown> };
      return null;
    },
    updateNode(id, props) {
      const g = goals.get(id);
      if (g) { goals.set(id, { ...g, ...props } as Goal); return; }
      const p = proposals.get(id);
      if (p) { proposals.set(id, { ...p, ...props } as Proposal); }
    },
    queryNodes() { return []; },
  };

  const audit: AuditStoreLike = {
    async write(entry) { auditEntries.push(entry); return 'audit-id'; },
  };

  const policy: PolicyEngineLike = {
    evaluate: () => ({ allow: true }),
  };

  return { store, audit, policy, auditEntries, goals, proposals };
}

function makeReport(overrides: Partial<DiagnosisReportLike> = {}): DiagnosisReportLike {
  return {
    diagnosisId: 'diag-1',
    title: '营收下降诊断',
    department: 'dept-sales',
    confidence: 0.85,
    keyRisks: ['竞争加剧', '成本上升'],
    triggeringSentinels: ['margin-health'],
    actionRecommendations: [
      { description: '优化定价策略', riskLevel: 'medium', expectedImpact: '利润率提升3-5%', timeline: '3个月' },
      { description: '成本削减计划', riskLevel: 'low', expectedImpact: '成本降低10%', timeline: '6个月' },
    ],
    ...overrides,
  };
}

describe('ProposalEngine', () => {
  describe('generateProposalFromDiagnosis', () => {
    it('生成含 3 条路径的 Proposal', async () => {
      const { generateProposalFromDiagnosis } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();
      const proposal = generateProposalFromDiagnosis(makeReport(), store, audit);
      expect(proposal.paths.length).toBe(3);
      expect(proposal.diagnosisReportId).toBe('diag-1');
    });

    it('高置信度（≥0.7）→ 积极增长为默认路径', async () => {
      const { generateProposalFromDiagnosis } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();
      const proposal = generateProposalFromDiagnosis(makeReport({ confidence: 0.85 }), store, audit);
      const defaultPath = proposal.paths.find(p => p.isDefault);
      expect(defaultPath?.label).toBe('积极增长');
    });

    it('低置信度 → 稳健优化为默认路径', async () => {
      const { generateProposalFromDiagnosis } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();
      const proposal = generateProposalFromDiagnosis(makeReport({ confidence: 0.5 }), store, audit);
      const defaultPath = proposal.paths.find(p => p.isDefault);
      expect(defaultPath?.label).toBe('稳健优化');
    });
  });

  describe('generateGoalFromProposal', () => {
    it('从已确认的 Proposal 生成 Goal', async () => {
      const { createProposal, selectPath, confirmByGa } = await import('../../src/growth/proposal-store');
      const { generateGoalFromProposal } = await import('../../src/growth/proposal-engine');
      const { store, audit, goals } = createMocks();

      const propId = createProposal({
        proposalId: '', diagnosisReportId: 'diag-1', title: '测试',
        department: 'dept-a',
        paths: [{ label: '稳健', riskLevel: 'low', expectedImpact: '改善', tradeoffs: '低', recommendationReason: '保守', isDefault: true, goals: [] }],
        context: { diagnosisConfidence: 0.7, keyRisks: [], triggeringSentinels: [] },
        status: 'confirmed', changeCount: 0,
        timeline: { createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString() },
        forgottenReminderCount: 0, lastActiveAt: new Date().toISOString(),
        createdBy: 'test', auditLog: [],
        selectedPathIndex: 0,
      }, store, audit);

      const goalIds = generateGoalFromProposal({
        proposalId: propId, diagnosisReportId: 'diag-1', title: '测试',
        department: 'dept-a',
        paths: [{ label: '稳健', riskLevel: 'low', expectedImpact: '改善', tradeoffs: '低', recommendationReason: '保守', isDefault: true, goals: [] }],
        context: { diagnosisConfidence: 0.7, keyRisks: [], triggeringSentinels: [] },
        status: 'confirmed', changeCount: 0,
        timeline: { createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString() },
        forgottenReminderCount: 0, lastActiveAt: new Date().toISOString(),
        createdBy: 'test', auditLog: [],
        selectedPathIndex: 0,
      }, store, audit);

      expect(goalIds.length).toBe(1);
      expect(goalIds[0]).toBeTruthy();
      expect(goals.size).toBe(1);
    });

    it('未选路径 → 抛出 Error', async () => {
      const { generateGoalFromProposal } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();

      expect(() => generateGoalFromProposal({
        proposalId: 'p1', diagnosisReportId: 'diag-1', title: '测试',
        department: 'dept-a',
        paths: [{ label: '稳健', riskLevel: 'low', expectedImpact: '改善', tradeoffs: '低', recommendationReason: '保守', isDefault: true, goals: [] }],
        context: { diagnosisConfidence: 0.7, keyRisks: [], triggeringSentinels: [] },
        status: 'confirmed', changeCount: 0,
        timeline: { createdAt: new Date().toISOString() },
        forgottenReminderCount: 0, lastActiveAt: new Date().toISOString(),
        createdBy: 'test', auditLog: [],
        // 未设置 selectedPathIndex
      }, store, audit)).toThrow('未选中任何路径');
    });
  });

  describe('handleDispute', () => {
    it('已 confirmed 的 Proposal → 进入 disputed', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const { handleDispute } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();

      const id = createProposal({
        proposalId: '', diagnosisReportId: 'diag-1', title: '测试',
        department: 'dept-a',
        paths: [{ label: '稳健', riskLevel: 'low', expectedImpact: '改善', tradeoffs: '低', recommendationReason: '保守', isDefault: true, goals: [] }],
        context: { diagnosisConfidence: 0.7, keyRisks: [], triggeringSentinels: [] },
        status: 'confirmed', changeCount: 0,
        timeline: { createdAt: new Date().toISOString() },
        forgottenReminderCount: 0, lastActiveAt: new Date().toISOString(),
        createdBy: 'test', auditLog: [],
        selectedPathIndex: 0,
      }, store, audit);

      const result = handleDispute(id, '策略不合適', 'middle-manager', store, audit);
      expect(result.newStatus).toBe('disputed');
      expect(result.needsReDiagnosis).toBe(false);
    });

    it('变更超限 → 不触发再诊断', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const { handleDispute } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();

      const id = createProposal({
        proposalId: '', diagnosisReportId: 'diag-1', title: '测试',
        department: 'dept-a',
        paths: [{ label: '稳健', riskLevel: 'low', expectedImpact: '改善', tradeoffs: '低', recommendationReason: '保守', isDefault: true, goals: [] }],
        context: { diagnosisConfidence: 0.7, keyRisks: [], triggeringSentinels: [] },
        status: 'confirmed', changeCount: 2, // 已达上限
        timeline: { createdAt: new Date().toISOString() },
        forgottenReminderCount: 0, lastActiveAt: new Date().toISOString(),
        createdBy: 'test', auditLog: [],
        selectedPathIndex: 0,
      }, store, audit);

      const result = handleDispute(id, '还是不合适', 'middle-manager', store, audit);
      expect(result.needsReDiagnosis).toBe(false);
      expect(result.newStatus).toBe('confirmed'); // 状态不变
    });
  });

  describe('startProposalExecution', () => {
    it('执行 Proposal → 状态变为 executing', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const { startProposalExecution } = await import('../../src/growth/proposal-engine');
      const { store, audit } = createMocks();

      const id = createProposal({
        proposalId: '', diagnosisReportId: 'diag-1', title: '测试',
        department: 'dept-a',
        paths: [{ label: '稳健', riskLevel: 'low', expectedImpact: '改善', tradeoffs: '低', recommendationReason: '保守', isDefault: true, goals: [] }],
        context: { diagnosisConfidence: 0.7, keyRisks: [], triggeringSentinels: [] },
        status: 'confirmed', changeCount: 0,
        timeline: { createdAt: new Date().toISOString() },
        forgottenReminderCount: 0, lastActiveAt: new Date().toISOString(),
        createdBy: 'test', auditLog: [],
        selectedPathIndex: 0,
      }, store, audit);

      startProposalExecution(id, ['goal-1'], store, audit);
      const { getProposal } = await import('../../src/growth/proposal-store');
      const updated = getProposal(id, store);
      expect(updated?.status).toBe('executing');
    });
  });
});
