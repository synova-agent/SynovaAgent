/**
 * tests/evolution/writeback-rollback.test.ts — K6-E9 (#539 / Closes #539)
 *
 * 卡面 Q3「结果」：applied > 0 ＋ **快照可回滚** ＋ 审计可对账。
 * 覆盖：E9 回写链与 RuleVersionManager 快照/回滚的协同 ——
 *   批次前建快照 → 回写落盘 → rollbackTo ⇒ 旧阈值状态被恢复（remember 反写）。
 * 铁律 48：全部 expect 断言。
 */
import { describe, it, expect } from 'vitest';
import type { AgentMemoryStoreLike, EvolutionProposal, TypedChange } from '@synova/evolution';
import { RuleVersionManager } from '@synova/evolution';
import { applyTypedWritebacks } from '../../src/loops/middle-evolution-engine';

interface RecordedEntry { key: string; value: string; tags: string[]; type: string }

/** 内存替身：remember 全记录；list 按 orgId+type+tags(任一命中) 过滤 */
function makeStore(): AgentMemoryStoreLike & { entries: RecordedEntry[] } {
  const entries: RecordedEntry[] = [];
  return {
    entries,
    remember: (e: { key: string; value: string; tags: string[]; type: string }) => {
      entries.push({ key: e.key, value: e.value, tags: e.tags, type: e.type });
      return undefined;
    },
    recall: (orgId: string, key: string) => {
      const hit = entries.find((e) => e.key === key);
      return hit ? { value: hit.value } : null;
    },
    forget: () => false,
    list: (q: { orgId: string; type?: string; tags?: string[] }) =>
      entries.filter(
        (e) =>
          (!q.type || e.type === q.type) &&
          (!q.tags || q.tags.some((t) => e.tags.includes(t))),
      ).map((e) => ({ value: e.value, tags: e.tags, type: e.type, key: e.key })),
  };
}

describe('K6-E9 回写 × 快照回滚（RuleVersionManager 协同）', () => {
  it('回写批次可回滚：快照 → applied 落盘 → rollbackTo ⇒ 恢复快照时点阈值', async () => {
    const store = makeStore();
    const rvm = new RuleVersionManager(store);

    // 快照前：既有一条阈值调整（将被快照捕获为快照时点状态）
    store.remember({
      orgId: 'global',
      key: 'threshold_adjustment:pre',
      value: JSON.stringify({
        sentinelId: 'F1_KZ', orgId: 'global',
        newThreshold: { warning: 0.5, critical: 1.0 },
        reason: 'pre-existing',
      }),
      type: 'enterprise_fact',
      confidence: 0.9,
      source: 'test',
      tags: ['threshold_adjustment'],
      expiresAt: null,
    });

    // 批次前快照（E9 引擎的 snapshotProvider 面）
    const snapshotId = await rvm.createSnapshot('e9-rollback-test');
    expect(snapshotId).toBeTruthy();

    // E9 回写：一条 L0 阈值类提案落盘（applied > 0）
    const p: EvolutionProposal = {
      id: 'p-th-1',
      type: 'threshold_adjustment',
      title: 't', description: '', industry: 'general-enterprise',
      changes: [],
      typedChanges: [{
        sentinelId: 'F1_KZ',
        from: { warning: 0.5, critical: 1.0 },
        to: { warning: 0.7, critical: 1.2 },
      } as TypedChange],
      risk: 'low', impactEstimate: { orgCount: 1, sentinelIds: [] }, evidence: '',
      status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const r = await applyTypedWritebacks({
      proposals: [p],
      memoryStore: store,
      snapshotProvider: { createSnapshot: async () => rvm.createSnapshot('e9-writeback:1 proposals') },
    });
    expect(r.applied).toBe(1);
    expect(p.appliedSnapshotId).toBeTruthy();
    expect(p.status).toBe('applied');

    // 回滚：恢复到快照时点 ⇒ 旧阈值被反写（thresholdsRestored ≥ 1，无 degraded）
    const rollback = await rvm.rollbackTo(snapshotId as string);
    expect(rollback.degraded).toBe(false);
    expect(rollback.errors).toEqual([]);
    expect(rollback.thresholdsRestored).toBeGreaterThanOrEqual(1);
    // 反写条目带上恢复语义（可对账）
    const restoredEntries = store.entries.filter(
      (e) => e.tags.includes('threshold_adjustment') && e.tags.includes('rollback'),
    );
    expect(restoredEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('审计可对账：每条 applied 有 evolution_writeback 审计条目（含 kind/appliedBy/approvedRef）', async () => {
    const store = makeStore();
    const p: EvolutionProposal = {
      id: 'p-nav-1', type: 'nav_weight', title: 't', description: '', industry: 'general-enterprise',
      changes: [],
      typedChanges: [{ kind: 'nav-weight', expertId: 'host', weightFrom: 0.5, weightTo: 0.45 }],
      risk: 'low', impactEstimate: { orgCount: 1, sentinelIds: [] }, evidence: '',
      status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await applyTypedWritebacks({ proposals: [p], memoryStore: store });
    const audit = store.entries.find((e) => e.tags.includes('evolution_writeback') && e.tags.includes('applied'));
    expect(audit).toBeTruthy();
    const parsed = JSON.parse(audit?.value ?? '{}') as Record<string, unknown>;
    expect(parsed.kind).toBe('nav-weight');
    expect(parsed.appliedBy).toBe('system:evolution-writeback');
    expect(String(parsed.approvedRef)).toBe('auto:L0:p-nav-1');
  });

  it('快照不可用（memoryStore 未注入 RVM）⇒ createSnapshot null，回滚 degraded 且不抛', async () => {
    const rvm = new RuleVersionManager(null);
    expect(await rvm.createSnapshot('x')).toBeNull();
    const rollback = await rvm.rollbackTo('snap_missing');
    expect(rollback.degraded).toBe(true);
  });
});
