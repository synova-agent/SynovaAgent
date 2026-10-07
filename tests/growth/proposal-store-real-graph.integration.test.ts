/**
 * tests/growth/proposal-store-real-graph.integration.test.ts — #1322 B1 判据件（Proposal 侧，真库）
 *
 * 与 `goal-store-real-graph.integration.test.ts` 同因（实体 id ≠ 图节点 id），
 * 但 Proposal 侧的后果更重: `selectPath` / `confirmByGa` 是「选定 → 落图」的必经两步，
 * 改前对真库**恒抛「不存在」**⇒ 目标创建链物理不可达（#1322 V1）。
 *
 * 三路径（铁律 48，非空壳）:
 *   正常 — createProposal → getProposal 命中 → 走合法状态链到 confirmed（含 orgId 透传）
 *   降级 — store 不可用 ⇒ getProposal null；selectPath 抛「不存在」
 *   边界 — pathIndex 越界必抛；从 draft 直接 selectPath 必抛「非法状态转换」（状态机不被放宽）
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import {
  createProposal, getProposal, selectPath, confirmByGa, updateProposalStatus,
} from '../../src/growth/proposal-store';
import type { Proposal } from '../../src/growth/proposal-types';
import type { GraphBridgeLike, AuditStoreLike } from '../../src/growth/goal-types';

const audit: AuditStoreLike = {
  async write() { return 'audit-1322-t2'; },
};

const brokenStore: GraphBridgeLike = {
  createNode(): string { throw new Error('graph down'); },
  getNode(): unknown { throw new Error('graph down'); },
  updateNode(): void { throw new Error('graph down'); },
  queryNodes(): Array<{ id: string; type: string; props: Record<string, unknown> }> { throw new Error('graph down'); },
};

function newStore(): SqliteGraphStore {
  return new SqliteGraphStore(new Database(':memory:'));
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposalId: '',
    orgId: 'org-a',
    diagnosisReportId: 'diag-1',
    title: '现金流要盯住',
    department: 'dept-fin',
    paths: [
      { label: '稳健优化', riskLevel: 'low', expectedImpact: '小幅改善', tradeoffs: '慢', recommendationReason: '保守', isDefault: true, goals: [] },
      { label: '均衡推进', riskLevel: 'medium', expectedImpact: '稳步改善', tradeoffs: '平衡', recommendationReason: '适中', isDefault: false, goals: [] },
      { label: '积极增长', riskLevel: 'high', expectedImpact: '大幅提升', tradeoffs: '高风险', recommendationReason: '高置信', isDefault: false, goals: [] },
    ],
    context: { diagnosisConfidence: 0.8, keyRisks: ['账期拉长'], triggeringSentinels: ['margin-health'] },
    status: 'pending_selection',
    changeCount: 0,
    timeline: { createdAt: '2026-10-08T00:00:00.000Z', expiresAt: '2026-10-13T00:00:00.000Z' },
    forgottenReminderCount: 0,
    lastActiveAt: '2026-10-08T00:00:00.000Z',
    createdBy: 'system:proposal-engine',
    auditLog: [],
    ...overrides,
  };
}

describe('#1322 B1 — Proposal 侧真库 id 语义（getProposal / selectPath / confirmByGa）', () => {
  it('正常: 走通 pending_selection → selected → pending_ga_confirmation → confirmed', () => {
    const store = newStore();
    const proposalId = createProposal(makeProposal(), store, audit);

    // 真库节点主键 = node-<uuid>；实体 id 只在 props（钉住语义）
    const rows = store.queryNodes('PROPOSAL', { proposalId }, 'growth');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(proposalId);
    expect(rows[0].id.startsWith('node-')).toBe(true);

    // 改前此处恒 null ⇒ 后续 selectPath/confirmByGa 恒抛「不存在」
    expect(getProposal(proposalId, store, 'growth')).not.toBeNull();

    selectPath(proposalId, 1, 'manager', store, audit);
    let current = getProposal(proposalId, store, 'growth');
    expect(current?.status).toBe('selected');
    expect(current?.selectedPathIndex).toBe(1);

    updateProposalStatus(proposalId, 'pending_ga_confirmation', 'manager', {}, store, audit, 'growth');
    confirmByGa(proposalId, 'ga-1', store, audit);

    current = getProposal(proposalId, store, 'growth');
    expect(current?.status).toBe('confirmed');
    expect(current?.selectedPathIndex).toBe(1);
    // 每次转换各追加一条审计（生成 + 三次状态变更）
    expect(current?.auditLog.length).toBeGreaterThanOrEqual(3);
    expect(current?.timeline.confirmedAt).toBeTruthy();
  });

  it('正常: orgId 透传到节点 props（R21 的租户载体）', () => {
    const store = newStore();
    const a = createProposal(makeProposal({ orgId: 'org-a', title: 'A' }), store, audit);
    const b = createProposal(makeProposal({ orgId: 'org-b', title: 'B' }), store, audit);

    expect(store.queryNodes('PROPOSAL', { orgId: 'org-a' }, 'growth').map(r => (r.props as { proposalId?: string }).proposalId)).toEqual([a]);
    expect(store.queryNodes('PROPOSAL', { orgId: 'org-b' }, 'growth').map(r => (r.props as { proposalId?: string }).proposalId)).toEqual([b]);
  });

  it('降级: store 不可用 ⇒ getProposal 返回 null（不抛）；selectPath 抛「不存在」', () => {
    expect(getProposal('any-id', brokenStore, 'growth')).toBeNull();
    expect(() => selectPath('any-id', 0, 'manager', brokenStore, audit)).toThrowError(/不存在/);
  });

  it('边界: pathIndex 越界 ⇒ 抛「路径索引非法」（不写任何节点）', () => {
    const store = newStore();
    const proposalId = createProposal(makeProposal(), store, audit);
    expect(() => selectPath(proposalId, -1, 'manager', store, audit)).toThrowError(/路径索引非法/);
    expect(() => selectPath(proposalId, 3, 'manager', store, audit)).toThrowError(/路径索引非法/);
    expect(getProposal(proposalId, store, 'growth')?.status).toBe('pending_selection');
  });

  it('边界: 从 draft 直接 selectPath ⇒ 抛「非法状态转换」（状态机未被放宽）', () => {
    const store = newStore();
    const proposalId = createProposal(makeProposal({ status: 'draft' }), store, audit);
    expect(() => selectPath(proposalId, 0, 'manager', store, audit))
      .toThrowError(/非法 Proposal 状态转换: draft → selected/);
  });
});
