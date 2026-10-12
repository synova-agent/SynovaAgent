/**
 * boss-mailbox-weekly.test.ts — E5/E7：周报消费段（测量值趋势 + 决策台账）单元判据
 * 覆盖：① 测量值/决策段落进报告与文本渲染 ② 空态显式（"无落行/无落账"不是静默）
 *       ③ 降级显式（measurementErrors/decisionErrors 进报告与文本，不阻断生成）
 */
import { describe, it, expect } from 'vitest';
import { BossMailbox, type WeeklySignal, type ActionProgress } from '../../src/agent/boss-mailbox';

const mb = new BossMailbox();
const signals: WeeklySignal[] = [{ severity: 'warning', title: '现金流转弱', description: 'runway 下降', trend: 'worsening' }];
const actions: ActionProgress[] = [{ title: '催收', status: 'in_progress', detail: '进行中' }];

describe('E5 周报测量值段（#389 业务读者②）', () => {
  it('测量值趋势进报告与文本（含环比）', () => {
    const report = mb.generateReport('T', 'W41', signals, actions,
      [{ metricId: 'cash.runway', entityId: 'e1', unit: '月', latestValue: 9, previousValue: 12.5, changeRatio: -0.28, latestAt: '2026-10-12T01:00:00Z' }]);
    expect(report.measurements.length).toBe(1);
    const text = mb.renderText(report);
    expect(text).toContain('二b、本周测量值趋势');
    expect(text).toContain('cash.runway[e1] = 9月');
    expect(text).toContain('-28.0%');
  });
  it('空态显式（无落行不是静默）', () => {
    const text = mb.renderText(mb.generateReport('T', 'W41', signals, actions));
    expect(text).toContain('（本周无指标级测量值落行）');
  });
  it('降级显式（measurementErrors 进文本，不阻断）', () => {
    const report = mb.generateReport('T', 'W41', signals, actions, [], ['TABLE_MISSING: …']);
    expect(report.measurementErrors).toEqual(['TABLE_MISSING: …']);
    expect(mb.renderText(report)).toContain('测量值段降级');
  });
});

describe('E7 周报决策段（#406 ⑤ 交付读 ④）', () => {
  it('决策行进报告与文本（谁/何时/什么动作/对象）', () => {
    const report = mb.generateReport('T', 'W41', signals, actions, [], [],
      [{ nodeId: 'n-risk-1', who: 'ga.wang', role: 'ga', action: 'confirmed', at: '2026-10-09T14:00:00Z', outputRef: 'ticket-7' }]);
    expect(report.decisions.length).toBe(1);
    const text = mb.renderText(report);
    expect(text).toContain('二c、本周决策台账');
    expect(text).toContain('ga.wang(ga) confirmed n-risk-1 → ticket-7');
  });
  it('空态与降级显式', () => {
    expect(mb.renderText(mb.generateReport('T', 'W41', signals, actions))).toContain('（本周无决策落账）');
    const degraded = mb.generateReport('T', 'W41', signals, actions, [], [], [], ['LEDGER_READER_NOT_WIRED']);
    expect(degraded.decisionErrors).toEqual(['LEDGER_READER_NOT_WIRED']);
    expect(mb.renderText(degraded)).toContain('决策段降级');
  });
});
