/**
 * tests/evolution/approval-policy.test.ts — K6-E9 (#539 / Closes #539)
 *
 * 卡面 Done ④⑤ 的策略面单测：
 *   ④ 上限可测：第 11 条自动回写必停（halt，不是静默写进去）
 *   ⑤ 分级可测：L1 未批 ⇒ 不落盘（fail-closed；一次授权只对一次动作）
 * 铁律 48：全部 expect 断言。
 */
import { describe, it, expect, beforeEach } from 'vitest';

/** 负路径构造器：unknown → 层类 单点合法转换（铁律 38：禁双层断言链） */
function asBadKind(v: unknown): Parameters<typeof resolveApprovalLevel>[0] {
  return v as Parameters<typeof resolveApprovalLevel>[0];
}

/** 负路径构造器：unknown → WritebackBudget 单点合法转换 */
function asBadBudget(v: unknown): WritebackBudget {
  return v as WritebackBudget;
}
import {
  resolveApprovalLevel,
  setApprovalLevelOverride,
  clearApprovalLevelOverrides,
  decideWriteback,
  WritebackBudget,
  L0_AUTO_KINDS,
  L1_MANUAL_KINDS,
  MAX_AUTO_WRITEBACK_PER_CYCLE,
} from '@synova/evolution';

describe('K6-E9 approval-policy：分级 + 上限 + fail-closed', () => {
  beforeEach(() => clearApprovalLevelOverrides());

  it('默认分级：③④⑤ ⇒ L0 自动；①② ⇒ L1 人工', () => {
    expect(L0_AUTO_KINDS).toEqual(['sentinel-threshold', 'param-prior', 'nav-weight']);
    expect(L1_MANUAL_KINDS).toEqual(['loop-param', 'ontology']);
    expect(resolveApprovalLevel('sentinel-threshold')).toBe('L0');
    expect(resolveApprovalLevel('param-prior')).toBe('L0');
    expect(resolveApprovalLevel('nav-weight')).toBe('L0');
    expect(resolveApprovalLevel('loop-param')).toBe('L1');
    expect(resolveApprovalLevel('ontology')).toBe('L1');
  });

  it('显式写路径：setApprovalLevelOverride 覆盖分级；clear 复位', () => {
    setApprovalLevelOverride('nav-weight', 'L1');
    expect(resolveApprovalLevel('nav-weight')).toBe('L1');
    clearApprovalLevelOverrides();
    expect(resolveApprovalLevel('nav-weight')).toBe('L0');
  });

  it('fail-closed：未知层类 ⇒ L1（宁可等人批，不放行）', () => {
    expect(resolveApprovalLevel(asBadKind('totally-unknown'))).toBe('L1');
  });

  it('上限：MAX_AUTO_WRITEBACK_PER_CYCLE=10；第 11 条 consume 必 false', () => {
    expect(MAX_AUTO_WRITEBACK_PER_CYCLE).toBe(10);
    const b = new WritebackBudget();
    for (let i = 0; i < 10; i++) expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false); // 第 11 条必停
    expect(b.remaining).toBe(0);
  });

  it('decideWriteback：L0 第 11 条 ⇒ halt（停下来等人看，不是静默写）', () => {
    const b = new WritebackBudget();
    for (let i = 0; i < 10; i++) {
      expect(decideWriteback({ kind: 'nav-weight', proposalApproved: false, budget: b }).decision).toBe('apply');
    }
    const eleventh = decideWriteback({ kind: 'nav-weight', proposalApproved: false, budget: b });
    expect(eleventh.decision).toBe('halt');
    expect(eleventh.reason).toContain('停下来等人看');
  });

  it('decideWriteback：L1 未批 ⇒ await-approval（不落盘）', () => {
    const b = new WritebackBudget();
    const d = decideWriteback({ kind: 'ontology', proposalApproved: false, budget: b });
    expect(d.decision).toBe('await-approval');
    expect(d.reason).toContain('fail-closed');
  });

  it('decideWriteback：L1 已批但缺 approvedRef ⇒ 仍 await-approval（无法对账 ⇒ 不落盘）', () => {
    const b = new WritebackBudget();
    const d = decideWriteback({ kind: 'loop-param', proposalApproved: true, budget: b });
    expect(d.decision).toBe('await-approval');
  });

  it('decideWriteback：L1 已批且带 ref ⇒ apply 且不占自动预算', () => {
    const b = new WritebackBudget();
    for (let i = 0; i < 10; i++) b.consume(); // 预算耗尽
    const d = decideWriteback({ kind: 'ontology', proposalApproved: true, approvedRef: 'approve:p1', budget: b });
    expect(d.decision).toBe('apply');
    expect(b.consumed).toBe(10); // L1 人工批不占自动额度
  });

  it('fail-closed：预算对象缺失 ⇒ halt', () => {
    const d = decideWriteback({ kind: 'nav-weight', proposalApproved: false, budget: asBadBudget(undefined) });
    expect(d.decision).toBe('halt');
  });
});
