#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-evolution-writeback.ts — K6-E9 进化回写判据探针
 * （#539 / Closes #539 ｜ 卡面：.claude/task-briefs/2026-10-15-535-K6-E9-进化回写.md）
 *
 * Done 逐条 → 场景映射（全部 L2-真跑通：真 import 目标模块、真调用、真观测落盘与置位）：
 *   D1 applied>0 可证（0-2 总闸关闭直接证据）
 *   D2 四类 payload 各一组改坏即红（载荷缺必填 ⇒ 该类回写消失）
 *   D3 上限可测（第 11 条自动回写必停，不静默写进去）
 *   D4 分级可测（② 本体类未批不得落盘，零审计条目）
 *   D5 审计写失败 ⇒ 拒绝落盘（不许没记账的 applied）
 *
 * 契约（铁律 47）:
 *   @input    无参数（默认全场景）
 *   @output   stdout 逐条 ✅ PASS / ❌ FAIL / ⚠️ 未实现 / ❌ ERROR；末行恒 RESULT=PASS|FAIL|NOT_IMPLEMENTED|ERROR
 *   @degraded 目标件不存在 / import 失败 ⇒ ⚠️ + RESULT=NOT_IMPLEMENTED + exit 2（不把"未实现"报成 PASS）
 *   退出码: 0 全过 ｜ 1 真红 ｜ 2 未实现或探针无法判定
 *
 * 判据级别（判例 V-01/V-02）：判定不吃 grep —— 全部断言基于真实调用返回值与替身存储观测。
 */

import { pathToFileURL } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = join(HERE, '..', '..');

interface MemoryEntry { key: string; value: string; tags: string[]; type: string }

function makeStore(opts?: { failAuditKeys?: string[] }): {
  store: unknown;
  entries: MemoryEntry[];
} {
  const entries: MemoryEntry[] = [];
  const store = {
    remember: (e: { key: string; value: string; tags: string[]; type: string }): undefined => {
      if (opts?.failAuditKeys?.some((k) => e.key.startsWith(k))) throw new Error('injected audit failure');
      entries.push({ key: e.key, value: e.value, tags: e.tags, type: e.type });
      return undefined;
    },
    recall: (): null => null,
    forget: (): boolean => false,
    list: (): Array<{ value: string; tags: string[]; type: string; key: string }> => [],
  };
  return { store, entries };
}

// 三态探针原语（与 probe-approval-seam.ts 同构：PASS/FAIL/NOT_IMPLEMENTED/ERROR + RESULT= + 0/1/2）
let fails = 0; let errors = 0; let notImpl = 0;
function pass(msg: string): void { console.log(`✅ PASS ${msg}`); }
function fail(msg: string, detail?: unknown): void { fails++; console.log(`❌ FAIL ${msg}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
function error(msg: string, detail?: unknown): void { errors++; console.log(`❌ ERROR ${msg}${detail !== undefined ? ` — ${String(detail)}` : ''}`); }
function notImplemented(msg: string): void { notImpl++; console.log(`⚠️ 未实现 ${msg}`); }

type EvolutionProposalLike = {
  id: string;
  type: string;
  status: string;
  changes: unknown[];
  typedChanges?: unknown[];
  appliedAt?: string;
  appliedBy?: string;
  approvedRef?: string;
  [k: string]: unknown;
};

function makeProposal(id: string, typedChanges: unknown[], status: string): EvolutionProposalLike {
  return {
    id, type: 'loop_param', title: `t-${id}`, description: '', industry: 'general-enterprise',
    changes: [], typedChanges, risk: 'low',
    impactEstimate: { orgCount: 1, sentinelIds: [] }, evidence: '', status,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

const NAV = { kind: 'nav-weight', expertId: 'host', weightFrom: 0.5, weightTo: 0.45 };
const ONTO = { kind: 'ontology', nodeType: 'Financial', op: 'update', patch: { f: 1 } };
const PRIOR = { kind: 'param-prior', paramId: 'p1', priorAlpha: 2, priorBeta: 3, evidenceCount: 5 };
const LOOP = { kind: 'loop-param', cycleId: 'c1', paramKey: 'k', from: 1, to: 2 };
const THRESH = { sentinelId: 'F1_KZ', from: { warning: 0.5, critical: 1 }, to: { warning: 0.6, critical: 1.1 } };

async function main(): Promise<number> {
  // ——— 载入目标件（未实现 ⇒ exit 2，不报 PASS）———
  let approval: Record<string, unknown>;
  let engine: Record<string, unknown>;
  try {
    approval = (await import(pathToFileURL(join(REPO, 'packages/evolution/src/approval-policy.ts')).href)) as Record<string, unknown>;
  } catch (err) {
    notImplemented(`approval-policy.ts 不存在或不可载入：${String(err)}`);
    console.log('RESULT=NOT_IMPLEMENTED');
    return 2;
  }
  try {
    const mod = (await import(pathToFileURL(join(REPO, 'packages/evolution/src/proposal-payloads.ts')).href)) as Record<string, unknown>;
    if (typeof mod.PAYLOAD_CONTRACTS !== 'object' || mod.PAYLOAD_CONTRACTS === null) throw new Error('PAYLOAD_CONTRACTS 缺失');
  } catch (err) {
    notImplemented(`proposal-payloads.ts 不存在或不可载入：${String(err)}`);
    console.log('RESULT=NOT_IMPLEMENTED');
    return 2;
  }
  try {
    engine = (await import(pathToFileURL(join(REPO, 'src/loops/middle-evolution-engine.ts')).href)) as Record<string, unknown>;
    if (typeof engine.applyTypedWritebacks !== 'function') throw new Error('applyTypedWritebacks 缺失（未实现）');
  } catch (err) {
    notImplemented(`middle-evolution-engine.ts applyTypedWritebacks 不可用：${String(err)}`);
    console.log('RESULT=NOT_IMPLEMENTED');
    return 2;
  }

  const applyTypedWritebacks = engine.applyTypedWritebacks as
    (input: { proposals: EvolutionProposalLike[]; memoryStore?: unknown }) => Promise<{
      applied: number; awaitingApproval: number; halted: boolean; haltedAtProposalId?: string;
      rejected: number; degraded: boolean; errors: string[];
    }>;
  const decideWriteback = approval.decideWriteback as (i: unknown) => { decision: string; reason: string };
  const WritebackBudget = approval.WritebackBudget as new () => { consume(): boolean };
  const MAX = approval.MAX_AUTO_WRITEBACK_PER_CYCLE as number;

  // D1 — applied > 0（0-2 总闸）
  try {
    const { store, entries } = makeStore();
    const ps = [
      makeProposal('d1-nav', [NAV], 'pending'),
      makeProposal('d1-prior', [PRIOR], 'pending'),
      makeProposal('d1-th', [THRESH], 'pending'),
      makeProposal('d1-onto', [ONTO], 'approved'),
    ];
    const r = await applyTypedWritebacks({ proposals: ps, memoryStore: store });
    if (r.applied === 4 && ps.every((p) => p.status === 'applied' && p.appliedBy === 'system:evolution-writeback' && !!p.approvedRef)) {
      const audits = entries.filter((e) => e.tags.includes('evolution_writeback') && e.tags.includes('applied'));
      if (audits.length === 4) pass('D1 applied>0 可证：四类一轮全落盘、applied 置位、审计 4 条');
      else fail('D1 审计条目数不符', { audits: audits.length });
    } else {
      fail('D1 applied 不为 4 / 置位字段缺失', r);
    }
  } catch (err) { error('D1 执行异常', err); }

  // D2 — 四类改坏即红
  try {
    const { store, entries } = makeStore();
    const bad = [
      makeProposal('d2-loop', [{ kind: 'loop-param', cycleId: '', paramKey: 'k', from: 1, to: 2 }], 'approved'),
      makeProposal('d2-onto', [{ kind: 'ontology', nodeType: 'Financial', op: 'delete', patch: {} }], 'approved'),
      makeProposal('d2-prior', [{ kind: 'param-prior', paramId: 'p', priorAlpha: 0, priorBeta: 3, evidenceCount: 5 }], 'pending'),
      makeProposal('d2-nav', [{ kind: 'nav-weight', expertId: 'host', weightFrom: 0.5, weightTo: 2 }], 'pending'),
    ];
    const r = await applyTypedWritebacks({ proposals: bad, memoryStore: store });
    if (r.applied === 0 && r.rejected === 4 && entries.length === 0) {
      pass('D2 四类改坏即红：坏载荷全部被拒、零落盘');
    } else {
      fail('D2 坏载荷未被全部拒绝（改坏不红）', r);
    }
  } catch (err) { error('D2 执行异常', err); }

  // D3 — 第 11 条必停
  try {
    const { store } = makeStore();
    const ps = Array.from({ length: 11 }, (_, i) => makeProposal(`d3-${i + 1}`, [NAV], 'pending'));
    const r = await applyTypedWritebacks({ proposals: ps, memoryStore: store });
    if (r.applied === MAX && r.halted && ps[10].status === 'pending' && ps[10].appliedAt === undefined) {
      pass(`D3 上限可测：applied=${r.applied}/${MAX}，第 11 条停（未落盘、未置位）`);
    } else {
      fail('D3 第 11 条未停（或仍被写进去）', r);
    }
  } catch (err) { error('D3 执行异常', err); }

  // D4 — 本体类未批不得落盘（含策略面 fail-closed 复核）
  try {
    const { store, entries } = makeStore();
    const onto = makeProposal('d4-onto', [ONTO], 'pending');
    const r = await applyTypedWritebacks({ proposals: [onto], memoryStore: store });
    const noWrite = r.applied === 0 && onto.status === 'pending' && entries.length === 0;
    const b = new WritebackBudget();
    const d = decideWriteback({ kind: 'ontology', proposalApproved: false, budget: b });
    if (noWrite && d.decision === 'await-approval') {
      pass('D4 分级可测：② 本体未批 ⇒ 不落盘（fail-closed）');
    } else {
      fail('D4 本体类未批却落盘 / 策略未 fail-closed', { r, d });
    }
  } catch (err) { error('D4 执行异常', err); }

  // D5 — 审计写失败 ⇒ 拒绝落盘
  try {
    const { store } = makeStore({ failAuditKeys: ['evolution_writeback'] });
    const p = makeProposal('d5-nav', [NAV], 'pending');
    const r = await applyTypedWritebacks({ proposals: [p], memoryStore: store });
    if (r.applied === 0 && r.degraded && p.status === 'pending') {
      pass('D5 审计写失败 ⇒ 拒绝落盘（不许没记账的 applied）');
    } else {
      fail('D5 审计失败仍落盘', r);
    }
  } catch (err) { error('D5 执行异常', err); }

  if (errors > 0) { console.log('RESULT=ERROR'); return 2; }
  if (notImpl > 0) { console.log('RESULT=NOT_IMPLEMENTED'); return 2; }
  if (fails > 0) { console.log('RESULT=FAIL'); return 1; }
  console.log('RESULT=PASS');
  return 0;
}

main().then((c) => process.exit(c)).catch((err: unknown) => {
  console.log(`❌ ERROR 探针自身异常：${String(err)}`);
  console.log('RESULT=ERROR');
  process.exit(2);
});
