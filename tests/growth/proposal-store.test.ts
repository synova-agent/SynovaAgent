/**
 * tests/growth/proposal-store.test.ts — D72 ProposalStore 单元测试
 *
 * 覆盖: 创建/查询/选择/确认/GA驳回/超时/非法转换/审计
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphBridgeLike, AuditStoreLike } from '../../src/growth/goal-types';
import type { Proposal } from '../../src/growth/proposal-types';
import { VALID_PROPOSAL_STATUSES } from '../../src/growth/proposal-types';

// ═══ 测试夹具 ═══

function createMockStore(): { store: GraphBridgeLike; nodes: Map<string, unknown> } {
  const nodes = new Map<string, unknown>();
  const store: GraphBridgeLike = {
    createNode(type, props) {
      const id = (props.proposalId as string) || `mock-${nodes.size + 1}`;
      nodes.set(id, { id, type, props });
      return id;
    },
    getNode(id) {
      return (nodes.get(id) as { id: string; type: string; props: Record<string, unknown> }) || null;
    },
    updateNode(id, props) {
      const existing = nodes.get(id) as { id: string; type: string; props: Record<string, unknown> } | undefined;
      if (existing) nodes.set(id, { ...existing, props: { ...existing.props, ...props } });
    },
    queryNodes(type, filters) {
      const results: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];
      for (const [, value] of nodes) {
        const n = value as { id: string; type: string; props: Record<string, unknown> };
        if (n.type !== type) continue;
        if (filters) {
          let matches = true;
          for (const [k, v] of Object.entries(filters)) {
            if (n.props[k] !== v) { matches = false; break; }
          }
          if (!matches) continue;
        }
        results.push(n);
      }
      return results;
    },
  };
  return { store, nodes };
}

function createMockAudit(): { audit: AuditStoreLike; entries: unknown[] } {
  const entries: unknown[] = [];
  const audit: AuditStoreLike = {
    async write(entry) { entries.push(entry); return 'audit-id'; },
  };
  return { audit, entries };
}

const BASE_PATHS = [
  { label: '稳健优化', riskLevel: 'low' as const, expectedImpact: '小幅改善', tradeoffs: '风险低', recommendationReason: '保守选择', isDefault: true, goals: [] },
  { label: '均衡推进', riskLevel: 'medium' as const, expectedImpact: '稳步改善', tradeoffs: '平衡', recommendationReason: '适中策略', isDefault: false, goals: [] },
  { label: '积极增长', riskLevel: 'high' as const, expectedImpact: '大幅提升', tradeoffs: '高回报', recommendationReason: '积极策略', isDefault: false, goals: [] },
];

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposalId: '',
    diagnosisReportId: 'diag-1',
    title: '测试提案',
    department: 'dept-a',
    paths: BASE_PATHS,
    context: { diagnosisConfidence: 0.8, keyRisks: ['风险A'], triggeringSentinels: ['sentinel-x'] },
    status: 'draft',
    changeCount: 0,
    timeline: { createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 86400000).toISOString() },
    forgottenReminderCount: 0,
    lastActiveAt: new Date().toISOString(),
    createdBy: 'test',
    auditLog: [],
    ...overrides,
  };
}

describe('ProposalStore', () => {
  describe('createProposal / getProposal', () => {
    it('创建 Proposal → 返回 proposalId', async () => {
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const { createProposal } = await import('../../src/growth/proposal-store');
      const id = createProposal(makeProposal(), store, audit);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('按 ID 获取 Proposal → 返回完整对象', async () => {
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const { createProposal, getProposal } = await import('../../src/growth/proposal-store');
      const id = createProposal(makeProposal(), store, audit);
      const result = getProposal(id, store);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('测试提案');
    });

    it('不存在的 ID → 返回 null', async () => {
      const { store } = createMockStore();
      const { getProposal } = await import('../../src/growth/proposal-store');
      expect(getProposal('nonexistent', store)).toBeNull();
    });
  });

  describe('listProposalsByDept / listPendingProposals', () => {
    it('按部门列出 Proposal', async () => {
      const { createProposal, listProposalsByDept } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      createProposal(makeProposal({ department: 'dept-a' }), store, audit);
      createProposal(makeProposal({ department: 'dept-b' }), store, audit);
      expect(listProposalsByDept('dept-a', store).length).toBe(1);
    });

    it('列出待处理 Proposal', async () => {
      const { createProposal, listPendingProposals } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      createProposal(makeProposal({ status: 'pending_selection' }), store, audit);
      createProposal(makeProposal({ status: 'draft' }), store, audit);
      expect(listPendingProposals('org', store).length).toBe(1);
    });
  });

  describe('状态转换', () => {
    it('selectPath → 选中路径并更新状态', async () => {
      const { createProposal, selectPath, getProposal } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const id = createProposal(makeProposal({ status: 'pending_selection' }), store, audit);
      selectPath(id, 0, 'middle-manager', store, audit);
      const result = getProposal(id, store);
      expect(result?.status).toBe('selected');
      expect(result?.selectedPathIndex).toBe(0);
    });

    it('confirmByGa → GA 确认', async () => {
      const { createProposal, confirmByGa, getProposal } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const id = createProposal(makeProposal({ status: 'pending_ga_confirmation' }), store, audit);
      confirmByGa(id, 'ga-user', store, audit);
      expect(getProposal(id, store)?.status).toBe('confirmed');
    });

    it('rejectByGa → GA 驳回', async () => {
      const { createProposal, rejectByGa, getProposal } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const id = createProposal(makeProposal({ status: 'pending_ga_confirmation' }), store, audit);
      rejectByGa(id, '风险过高', 'ga-user', store, audit);
      expect(getProposal(id, store)?.status).toBe('ga_rejected');
      expect(getProposal(id, store)?.rejectionReason).toBe('风险过高');
    });

    it('非法状态转换 → 抛出 Error', async () => {
      const { createProposal, updateProposalStatus } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const id = createProposal(makeProposal({ status: 'draft' }), store, audit);
      expect(() => updateProposalStatus(id, 'completed', 'test', {}, store, audit, 'growth')).toThrow('非法');
    });
  });

  describe('checkExpiry', () => {
    it('超时 Proposal → 自动选默认路径', async () => {
      const { createProposal, checkExpiry, getProposal } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit } = createMockAudit();
      const expiredDate = new Date(Date.now() - 10 * 86400000).toISOString();
      const id = createProposal(makeProposal({
        status: 'pending_selection',
        timeline: { createdAt: expiredDate, expiresAt: expiredDate },
      }), store, audit);

      const autoSelected = checkExpiry(store, audit);
      expect(autoSelected).toContain(id);
      expect(getProposal(id, store)?.status).toBe('expired');
    });
  });

  describe('审计日志', () => {
    it('创建 Proposal 写入审计', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const { store } = createMockStore();
      const { audit, entries } = createMockAudit();
      createProposal(makeProposal(), store, audit);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const entry = entries[0] as Record<string, unknown>;
      expect(entry.action).toContain('proposal.created');
    });
  });

  // ═══ #1322 X2（CTO 裁定）: 审计归属 orgId —— 缺值写显式哨兵 'unknown'，绝不回落 department ═══
  describe('审计归属 orgId（X2 哨兵）', () => {
    it('正常: 有 orgId ⇒ 审计条目 orgId = 该租户值', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const store = createMockStore().store;
      const { audit, entries } = createMockAudit();
      createProposal(makeProposal({ orgId: 'org-x2', department: 'dept-x2' }), store, audit);
      const entry = entries[0] as Record<string, unknown>;
      expect(entry.orgId).toBe('org-x2');
      expect(entry.orgId).not.toBe('dept-x2');
    });

    it('边界: 缺 orgId ⇒ 审计条目 orgId = \'unknown\'（**不是** department —— 宁标不可归属，不错归属）', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const store = createMockStore().store;
      const { audit, entries } = createMockAudit();
      createProposal(makeProposal({ orgId: undefined, department: 'dept-x2' }), store, audit);
      const entry = entries[0] as Record<string, unknown>;
      expect(entry.orgId).toBe('unknown');
      expect(entry.orgId).not.toBe('dept-x2');
    });

    it('边界: 空白 orgId ⇒ 同样命中哨兵（不把 "" / 空格当租户）', async () => {
      const { createProposal } = await import('../../src/growth/proposal-store');
      const store = createMockStore().store;
      const { audit, entries } = createMockAudit();
      createProposal(makeProposal({ orgId: '   ', department: 'dept-x2' }), store, audit);
      expect((entries[0] as Record<string, unknown>).orgId).toBe('unknown');
    });

    it('正常: 状态转换的审计同样走哨兵口径（有 orgId ⇒ 真值；缺 ⇒ unknown）', async () => {
      const { createProposal, updateProposalStatus } = await import('../../src/growth/proposal-store');
      const store = createMockStore().store;
      const { audit, entries } = createMockAudit();
      const id = createProposal(makeProposal({ orgId: 'org-x2' }), store, audit);
      entries.length = 0;
      updateProposalStatus(id, 'pending_selection', 'tester', {}, store, audit, 'growth');
      expect((entries[0] as Record<string, unknown>).orgId).toBe('org-x2');
    });
  });

  describe('isValidProposalTransition', () => {
    it('合法转换', async () => {
      const { isValidProposalTransition } = await import('../../src/growth/proposal-store');
      expect(isValidProposalTransition('draft', 'pending_selection')).toBe(true);
      expect(isValidProposalTransition('pending_selection', 'selected')).toBe(true);
    });

    it('非法转换', async () => {
      const { isValidProposalTransition } = await import('../../src/growth/proposal-store');
      expect(isValidProposalTransition('draft', 'completed')).toBe(false);
      expect(isValidProposalTransition('ga_rejected', 'confirmed')).toBe(false);
    });
  });

  describe('VALID_PROPOSAL_STATUSES', () => {
    it('包含全部 11 个状态', () => {
      expect(VALID_PROPOSAL_STATUSES.length).toBe(11);
    });
  });
});
