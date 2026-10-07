/**
 * tests/l3/business-model-canvas.test.ts — 商业模式画布计算模块单元测试
 */
import { describe, it, expect } from 'vitest';
import { computeCanvas, formatCanvasSummary } from '../../src/l3/business-model-canvas';
import type { GraphStore } from '../../src/l4/graph-bridge';

/** 构造一个最小 GraphStore mock */
function makeStore(nodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [], edges: Array<{ from: string; to: string; type: string; props: Record<string, unknown> }> = []): GraphStore {
  return {
    queryNodes(type: string, _filters?: Record<string, unknown>, _graph?: string) {
      return nodes.filter(n => n.type === type).map(n => ({ id: n.id, type: n.type, props: n.props }));
    },
    queryEdges(type?: string, from?: string, to?: string, _graph?: string) {
      return edges
        .filter(e => !type || e.type === type)
        .filter(e => !from || e.from === from)
        .filter(e => !to || e.to === to)
        .map(e => ({ from: e.from, to: e.to, type: e.type, props: e.props }));
    },
    createNode: () => 'n1',
    createEdge: () => {},
    updateNode: () => {},
    deleteNode: () => {},
  } as unknown as GraphStore;
}

describe('business-model-canvas', () => {
  it('空本体图 → 返回默认低健康度报告', () => {
    const store = makeStore([], []);
    const report = computeCanvas(store, 'default');
    expect(report.overallHealth).toBeLessThan(0.5);
    expect(report.canvas.customerSegments.data.count).toBe(0);
    expect(report.canvas.revenueStreams.data.totalSources).toBe(0);
  });

  it('单客户+单收入 → 检测收入集中风险', () => {
    const store = makeStore(
      [
        { id: 'c1', type: 'Client', props: { name: '大客户A', entityType: 'external' } },
        { id: 'f1', type: 'Financial', props: { financialType: 'revenue', amount: 100000, currency: 'CNY', name: '主营收' } },
      ],
      [
        { from: 'f1', to: 'c1', type: 'REVENUE_FROM', props: { share: 1.0, revenueType: 'service' } },
      ],
    );
    const report = computeCanvas(store, 'default');
    expect(report.canvas.revenueStreams.data.concentrationRisk).toBeGreaterThanOrEqual(0.5);
    expect(report.canvas.customerSegments.data.concentrationRisk).toBeGreaterThanOrEqual(0.4);
    const riskSignals = report.contradictions.map(c => c.signal);
    expect(riskSignals.some(s => s.includes('集中'))).toBe(true);
  });

  it('多客户细分 → 检测平台化机会', () => {
    const store = makeStore(
      [
        { id: 'c1', type: 'Client', props: { name: '买家', entityType: 'external' } },
        { id: 'c2', type: 'Client', props: { name: '卖家', entityType: 'external' } },
        { id: 'c3', type: 'Client', props: { name: '广告主', entityType: 'external' } },
        { id: 'f1', type: 'Financial', props: { financialType: 'revenue', amount: 50000, currency: 'CNY', name: '交易收入' } },
        { id: 't1', type: 'Team', props: { name: '运营团队', teamType: 'permanent' } },
      ],
      [
        { from: 'f1', to: 'c1', type: 'REVENUE_FROM', props: { share: 1.0, revenueType: 'transaction' } },
      ],
    );
    const report = computeCanvas(store, 'default');
    expect(report.innovationOpportunities.some(o => o.includes('平台'))).toBe(true);
  });

  it('价值主张缺失收入 → 检测价值-收入矛盾', () => {
    const store = makeStore(
      [
        { id: 'g1', type: 'GOAL', props: { goalType: 'mission', description: '为客户提供极致体验' } },
        { id: 'c1', type: 'Client', props: { name: '客户A', entityType: 'external' } },
      ],
      [
        { from: 'g1', to: 'c1', type: 'VALUE_PROPOSITION', props: { alignmentStrength: 0.8, monetized: false } },
      ],
    );
    const report = computeCanvas(store, 'default');
    const hasValueRevenueContradiction = report.contradictions.some(
      c => c.signal.includes('价值-收入') || c.signal.includes('未检测到收入')
    );
    expect(hasValueRevenueContradiction).toBe(true);
  });

  it('高固定成本+少收入源 → 检测结构性亏损风险', () => {
    const store = makeStore(
      [
        { id: 'f1', type: 'Financial', props: { financialType: 'revenue', amount: 100000, currency: 'CNY', name: '主营收入' } },
        { id: 'f2', type: 'Financial', props: { financialType: 'cost', name: '服务器成本' } },
        { id: 'f3', type: 'Financial', props: { financialType: 'cost', name: '人员成本' } },
        { id: 'p1', type: 'Process', props: { name: '运维', processType: 'deployment' } },
        { id: 't1', type: 'Tool', props: { name: 'Kubernetes', category: 'infra' } },
        { id: 'cap1', type: 'Capability', props: { name: '云原生', category: 'technical' } },
      ],
      [
        { from: 'f2', to: 'p1', type: 'COST_DRIVEN_BY', props: { share: 0.6, costType: 'fixed' } },
        { from: 'f3', to: 't1', type: 'COST_DRIVEN_BY', props: { share: 0.4, costType: 'fixed' } },
      ],
    );
    const report = computeCanvas(store, 'default');
    const hasStructuralRisk = report.contradictions.some(
      c => c.signal.includes('固定成本') && c.signal.includes('结构性')
    );
    expect(hasStructuralRisk).toBe(true);
  });

  it('完整画布 → formatCanvasSummary 生成可读摘要', () => {
    const store = makeStore(
      [
        { id: 'c1', type: 'Client', props: { name: '企业客户', entityType: 'external' } },
        { id: 'c2', type: 'Client', props: { name: '个人用户', entityType: 'external' } },
        { id: 'g1', type: 'GOAL', props: { goalType: 'mission', description: '让企业协作更高效' } },
        { id: 'f1', type: 'Financial', props: { financialType: 'revenue', amount: 500000, currency: 'CNY', name: '订阅收入' } },
        { id: 'f2', type: 'Financial', props: { financialType: 'revenue', amount: 100000, currency: 'CNY', name: '服务收入' } },
        { id: 'f3', type: 'Financial', props: { financialType: 'cost', name: '研发成本' } },
        { id: 't1', type: 'Team', props: { name: '工程团队', teamType: 'permanent' } },
        { id: 'cap1', type: 'Capability', props: { name: 'SaaS研发', category: 'technical' } },
        { id: 'tool1', type: 'Tool', props: { name: 'GitHub', category: 'dev' } },
        { id: 'p1', type: 'Process', props: { name: '持续交付', processType: 'deployment' } },
      ],
      [
        { from: 'f1', to: 'c1', type: 'REVENUE_FROM', props: { share: 0.8, revenueType: 'subscription' } },
        { from: 'f2', to: 'c2', type: 'REVENUE_FROM', props: { share: 0.2, revenueType: 'subscription' } },
        { from: 'g1', to: 'c1', type: 'VALUE_PROPOSITION', props: { alignmentStrength: 0.9, monetized: true } },
        { from: 'f3', to: 'p1', type: 'COST_DRIVEN_BY', props: { share: 0.5, costType: 'variable' } },
      ],
    );
    const report = computeCanvas(store, 'default');
    const summary = formatCanvasSummary(report);
    expect(summary).toContain('商业模式画布健康度');
    expect(summary).toContain('九要素');
    expect(summary).toContain('客户细分: 2 种');
    expect(summary).toContain('收入来源: 2 个');
  });

  it('computeCanvas contains all 9 canvas elements', () => {
    const store = makeStore([], []);
    const report = computeCanvas(store, 'default');
    const elements = Object.keys(report.canvas);
    expect(elements).toHaveLength(9);
    expect(elements).toContain('customerSegments');
    expect(elements).toContain('valuePropositions');
    expect(elements).toContain('channels');
    expect(elements).toContain('customerRelationships');
    expect(elements).toContain('revenueStreams');
    expect(elements).toContain('keyResources');
    expect(elements).toContain('keyActivities');
    expect(elements).toContain('keyPartnerships');
    expect(elements).toContain('costStructure');
  });
});
