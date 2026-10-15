/**
 * tests/evolution/writeback-applied.test.ts — K6-E9 (#539 / Closes #539)
 *
 * 卡面 Done 核心判据（引擎链，L2-真跑通）：
 *   ③ applied > 0 可证 —— 跑一轮 ⇒ applied 不再恒 0（0-2 总闸关闭的直接证据）
 *   ④ 上限可测 —— 第 11 条自动回写必停（halted，第 11 条不落盘）
 *   ⑤ 分级可测 —— ② 本体类未批不得落盘（无审计条目）
 *   ② 改坏即红 —— 四类各一组：摘链（未批/坏载荷/审计失败）⇒ 该类回写必消失
 * 铁律 48：全部 expect 断言。
 */
import { describe, it, expect } from 'vitest';
import type { AgentMemoryStoreLike, EvolutionProposal, TypedChange } from '@synova/evolution';
import { applyTypedWritebacks } from '../../src/loops/middle-evolution-engine';

/** 内存替身：记录 remember 调用，可注入审计失败 */
function makeStore(opts?: { failAuditKeys?: string[] }): AgentMemoryStoreLike & {
  entries: Array<{ key: string; value: string; tags: string[] }>;
} {
  const entries: Array<{ key: string; value: string; tags: string[] }> = [];
  return {
    entries,
    remember: (e: { key: string; value: string; tags: string[] }) => {
      if (opts?.failAuditKeys?.some((k) => e.key.startsWith(k))) {
        throw new Error('injected audit failure');
      }
      entries.push({ key: e.key, value: e.value, tags: e.tags });
      return undefined;
    },
    recall: () => null,
    forget: () => false,
    list: () => [],
  };
}

function proposal(
  id: string,
  typedChanges: TypedChange[],
  status: EvolutionProposal['status'] = 'pending',
): EvolutionProposal {
  return {
    id,
    type: 'loop_param',
    title: `t-${id}`,
    description: '',
    industry: 'general-enterprise',
    changes: [],
    typedChanges,
    risk: 'low',
    impactEstimate: { orgCount: 1, sentinelIds: [] },
    evidence: '',
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const LOOP: TypedChange = { kind: 'loop-param', cycleId: 'c1', paramKey: 'k', from: 1, to: 2 };
const ONTO: TypedChange = { kind: 'ontology', nodeType: 'Financial', op: 'update', patch: { f: 1 } };
const PRIOR: TypedChange = { kind: 'param-prior', paramId: 'p1', priorAlpha: 2, priorBeta: 3, evidenceCount: 5 };
const NAV: TypedChange = { kind: 'nav-weight', expertId: 'host', weightFrom: 0.5, weightTo: 0.4 };

/** 负路径构造器：unknown → TypedChange 单点合法转换（铁律 38：禁双层断言链） */
function asBad(v: unknown): TypedChange {
  return v as TypedChange;
}

describe('K6-E9 applyTypedWritebacks：applied 置位（0-2 总闸）', () => {
  it('🔴 applied > 0：一轮四类（L0 三类 + L1 已批本体）⇒ 4 条全部落盘并置位 applied', async () => {
    const store = makeStore();
    const ps = [
      proposal('p-nav', [NAV]),                    // L0 自动
      proposal('p-prior', [PRIOR]),                // L0 自动
      proposal('p-th', [{ sentinelId: 'F1_KZ', from: { warning: 0.5, critical: 1 }, to: { warning: 0.6, critical: 1.1 } }]), // L0（存量阈值形态）
      proposal('p-onto', [ONTO], 'approved'),      // L1 已批
    ];
    const r = await applyTypedWritebacks({ proposals: ps, memoryStore: store });
    expect(r.applied).toBe(4);
    expect(r.applied).toBeGreaterThan(0); // 0-2 总闸证据
    expect(r.degraded).toBe(false);
    for (const p of ps) {
      expect(p.status).toBe('applied');
      expect(p.appliedBy).toBe('system:evolution-writeback');
      expect(p.appliedAt).toBeTruthy();
      expect(p.approvedRef).toBeTruthy();
    }
    // 审计对账面：每条 applied 有 evolution_writeback 审计条目
    const audits = store.entries.filter((e) => e.tags.includes('evolution_writeback') && e.tags.includes('applied'));
    expect(audits.length).toBe(4);
  });

  it('⑤ 分级可测：② 本体类未批 ⇒ awaitingApproval、零审计条目（未批不得落盘）', async () => {
    const store = makeStore();
    const onto = proposal('p-onto-unapproved', [ONTO], 'pending');
    const r = await applyTypedWritebacks({ proposals: [onto], memoryStore: store });
    expect(r.awaitingApproval).toBe(1);
    expect(r.applied).toBe(0);
    expect(onto.status).toBe('pending'); // 未置位
    expect(store.entries.filter((e) => e.tags.includes('ontology')).length).toBe(0); // 改坏即红：落了盘必红
  });

  it('④ 上限可测：第 11 条自动回写必停（applied=10、halted=true、第 11 条不落盘）', async () => {
    const store = makeStore();
    const ps = Array.from({ length: 11 }, (_, i) => proposal(`p-nav-${i + 1}`, [NAV]));
    const r = await applyTypedWritebacks({ proposals: ps, memoryStore: store });
    expect(r.applied).toBe(10);
    expect(r.halted).toBe(true);
    expect(r.haltedAtProposalId).toBe('p-nav-11');
    expect(ps[10].status).toBe('pending'); // 第 11 条没被写进去
    expect(ps[10].appliedAt).toBeUndefined();
  });

  it('审计写失败 ⇒ 拒绝落盘（不许没记账的 applied）', async () => {
    const store = makeStore({ failAuditKeys: ['evolution_writeback'] });
    const p = proposal('p-nav-auditfail', [NAV]);
    const r = await applyTypedWritebacks({ proposals: [p], memoryStore: store });
    expect(r.applied).toBe(0);
    expect(r.degraded).toBe(true);
    expect(p.status).toBe('pending'); // fail-closed：审计失败不置位
  });

  it('② 改坏即红（四类逐组）：载荷缺必填字段 ⇒ rejected、该类回写消失', async () => {
    const store = makeStore();
    const bad: EvolutionProposal[] = [
      proposal('bad-loop', [asBad({ kind: 'loop-param', cycleId: '', paramKey: 'k', from: 1, to: 2 })]),
      proposal('bad-onto', [asBad({ kind: 'ontology', nodeType: 'Financial', op: 'delete', patch: {} })]),
      proposal('bad-prior', [asBad({ kind: 'param-prior', paramId: 'p', priorAlpha: 0, priorBeta: 3, evidenceCount: 5 })]),
      proposal('bad-nav', [asBad({ kind: 'nav-weight', expertId: 'host', weightFrom: 0.5, weightTo: 2 })]),
    ];
    const r = await applyTypedWritebacks({ proposals: bad, memoryStore: store });
    expect(r.rejected).toBe(4);
    expect(r.applied).toBe(0);
    expect(store.entries.length).toBe(0); // 四类全部消失（改坏即红）
  });

  it('摘 approve→apply 链：L1 类 status 仍 pending ⇒ 链不通 ⇒ 零落盘', async () => {
    const store = makeStore();
    const loop = proposal('p-loop-unapproved', [LOOP], 'pending');
    const r = await applyTypedWritebacks({ proposals: [loop], memoryStore: store });
    expect(r.awaitingApproval).toBe(1);
    expect(store.entries.length).toBe(0);
  });

  it('快照提供者：成功 ⇒ appliedSnapshotId 记到每条已落盘提案；失败 ⇒ degraded 继续', async () => {
    const okStore = makeStore();
    const p1 = proposal('p-nav-snap', [NAV]);
    const r1 = await applyTypedWritebacks({
      proposals: [p1],
      memoryStore: okStore,
      snapshotProvider: { createSnapshot: async () => 'snap_test_1' },
    });
    expect(p1.appliedSnapshotId).toBe('snap_test_1');
    expect(r1.degraded).toBe(false);

    const p2 = proposal('p-nav-snapfail', [NAV]);
    const r2 = await applyTypedWritebacks({
      proposals: [p2],
      memoryStore: makeStore(),
      snapshotProvider: { createSnapshot: async () => null },
    });
    expect(r2.applied).toBe(1);
    expect(r2.degraded).toBe(true);
  });
});
