import { describe, it, expect } from "vitest";
import { collectFeedback, getFeedbackByAction, collectAllFeedback, detectBehavioralValidation, aggregateExternalData, detectCostTemplateDrift, detectDiagnosisContradiction, updateSignalSourceWeight } from "@synova/evolution";

describe('collectFeedback', () => {
  it('confirm → ok+persisted', async () => {
    const result = await collectFeedback({ orgId: 'test-org', actionId: 'act_1', decision: 'confirm' });
    expect(result.ok).toBe(true);
    expect(result.record.decision).toBe('confirm');
    expect(result.persisted).toBe(false); // no memoryStore
  });

  it('reject → recorded', async () => {
    const result = await collectFeedback({ orgId: 'test-org', actionId: 'act_1', decision: 'reject', reason: '不适用' });
    expect(result.record.reason).toBe('不适用');
  });

  it('modify → recorded with modifiedSuggestion', async () => {
    const result = await collectFeedback({ orgId: 'test-org', actionId: 'act_2', decision: 'modify', modifiedSuggestion: '调整定价至35元' });
    expect(result.record.modifiedSuggestion).toBe('调整定价至35元');
  });

  it('getFeedbackByAction → 返回该action的反馈(≥1条)', async () => {
    const r1 = await collectFeedback({ orgId: 'test-org', actionId: 'act_z', decision: 'confirm' });
    await collectFeedback({ orgId: 'test-org', actionId: 'act_z', decision: 'modify', modifiedSuggestion: 'v2' });
    const list = getFeedbackByAction('act_z');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].decision).toBe('modify');
  });

  it('orgId 必选 — record 中包含 orgId', async () => {
    const result = await collectFeedback({ orgId: 'my-org', actionId: 'act_3', decision: 'confirm' });
    expect(result.record.orgId).toBe('my-org');
  });

  // K6/2-3 通道归一: 第三参 middleSink 把本通道反馈同步给通道 A（feedback_log）。
  // 契约: sink 收到的就是本通道原始形状（confirm 正向值必须原样传下去 —— 通道 A 此前拒它）。
  it('middleSink → 收到本通道原始形状（confirm 透传；sink 抛错不影响 persisted 语义）', async () => {
    const seen: Array<{ orgId: string; actionId: string; decision: string }> = [];
    const result = await collectFeedback(
      { orgId: 'sink-org', actionId: 'act_sink', decision: 'confirm', reason: '采纳', sentinelId: 'F1_KZ' },
      undefined,
      (input) => { seen.push({ orgId: input.orgId, actionId: input.actionId, decision: input.decision }); },
    );
    expect(seen).toEqual([{ orgId: 'sink-org', actionId: 'act_sink', decision: 'confirm' }]);
    expect(result.ok).toBe(true);

    // 降级: sink 抛错 ⇒ 本通道语义不变（ok/record 正常返回），不向外抛
    const degraded = await collectFeedback(
      { orgId: 'sink-org', actionId: 'act_sink_2', decision: 'reject' },
      undefined,
      () => { throw new Error('channel A down'); },
    );
    expect(degraded.ok).toBe(true);
    expect(degraded.record.decision).toBe('reject');
  });
});
describe('collectAllFeedback', () => {
  it('collects from 4 sources', async () => {
    const r = await collectAllFeedback(undefined,
      () => [{ id:'b1', source:'user_behavior' as const, timestamp:'', teamId:'t1', payload:{}, requiresReview:false, autoApplicable:true }],
      () => [{ id:'e1', source:'external_data' as const, timestamp:'', teamId:'t1', payload:{}, requiresReview:true, autoApplicable:false }],
      () => [{ id:'c1', source:'diagnosis_contradiction' as const, timestamp:'', teamId:'t1', payload:{}, requiresReview:true, autoApplicable:false }]);
    expect(r.events.length).toBeGreaterThanOrEqual(3); expect(r.autoApplied).toBe(1); expect(r.reviewRequired).toBeGreaterThanOrEqual(2);
  });
  it('degrades on throw', async () => { const r = await collectAllFeedback(undefined, () => { throw new Error('fail'); }); expect(r.degraded).toBe(true); });
});

describe('v3 org-adapter functions', () => {
  const ms = { queryNodes: () => [{ id:'d1', type:'Document', props:{ text:'需要重新考虑现金流', teamId:'t1' } }], queryEdges: () => [], getNode: () => null };
  it('detectBehavioralValidation', () => { expect(detectBehavioralValidation(ms, null, 't1').some(x => x.originalClassification === 'silenced')).toBe(true); });
  it('aggregateExternalData', () => { const s = { queryNodes: () => [{ id:'f1', type:'FINANCIAL', props:{ revenue:5000000 } }], queryEdges: () => [], getNode: () => null }; expect(aggregateExternalData(s, 't1')[0].dimension).toBe('industry_avg_revenue'); });
  it('detectCostTemplateDrift', () => { const s = { queryNodes: () => [{ id:'f1', type:'FINANCIAL', props:{ cogs:80000, benchmarkCost:100000 } }], queryEdges: () => [], getNode: () => null }; expect(detectCostTemplateDrift(s, 't1')[0].driftPercent).toBeGreaterThan(0); });
  it('detectDiagnosisContradiction', () => { const s = { queryNodes: () => [{ id:'a1', type:'Activity' }], queryEdges: () => [], getNode: () => null }; expect(detectDiagnosisContradiction(s, null, 't1').length).toBeGreaterThanOrEqual(1); });
  it('updateSignalSourceWeight', () => { expect(updateSignalSourceWeight(null, 't1', 's1', 'confirmed').newWeight).toBeGreaterThan(0.5); expect(updateSignalSourceWeight(null, 't1', 's2', 'dismissed').newWeight).toBeLessThan(0.5); });
});
