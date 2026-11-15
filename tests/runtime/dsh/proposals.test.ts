/**
 * tests/runtime/dsh/proposals.test.ts — run → Proposal 草案落库单测（真实 SQLite）。
 *
 * 配对对象：src/runtime/dsh/proposals.ts
 * 覆盖：首次/重试/新 runId 计数、runId 与企业归属、校验失败、DB 失败收敛为 PERSISTENCE_ERROR。
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ProposalManager, type Proposal } from '../../../src/l2/proposal-manager';
import { DshError } from '../../../src/runtime/dsh/errors';
import { persistProposalDraft } from '../../../src/runtime/dsh/proposals';

const INPUT = {
  runId: 'run_proposals_0001',
  enterpriseId: 'ent-1',
  userId: 'user-1',
  title: 'draft title',
  description: 'draft body',
};

function countByRun(db: InstanceType<typeof Database>, runId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?').get(runId) as { n: number };
  return row.n;
}

class FailingProposalManager extends ProposalManager {
  override propose(): Proposal {
    throw new Error('simulated db failure');
  }
}

describe('proposals: 幂等草稿落库', () => {
  it('首次 created=true（count=1），同 runId 重试 created=false（仍 1），新 runId=2', () => {
    const db = new Database(':memory:');
    const manager = new ProposalManager(db);

    const first = persistProposalDraft(manager, INPUT);
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    expect(first.proposal.runId).toBe(INPUT.runId);
    expect(first.proposal.source).toBe('enterprise:ent-1');
    expect(first.proposal.type).toBe('agent_proposal_draft');
    expect(countByRun(db, INPUT.runId)).toBe(1);

    const retry = persistProposalDraft(manager, INPUT);
    expect(retry.created).toBe(false);
    expect(retry.proposal.id).toBe(first.proposal.id);
    expect(countByRun(db, INPUT.runId)).toBe(1);

    const next = persistProposalDraft(manager, { ...INPUT, runId: 'run_proposals_0002' });
    expect(next.created).toBe(true);
    expect(countByRun(db, 'run_proposals_0002')).toBe(1);
    expect(countByRun(db, INPUT.runId)).toBe(1);
    expect(manager.getByRunId(INPUT.runId)?.id).toBe(first.proposal.id);
    db.close();
  });

  it('输入校验：非法 runId 与缺失企业归属 ⇒ VALIDATION_ERROR（不落库）', () => {
    const db = new Database(':memory:');
    const manager = new ProposalManager(db);
    expect(() => persistProposalDraft(manager, { ...INPUT, runId: 'bad id!' })).toThrow(/runId 非法/);
    expect(() => persistProposalDraft(manager, { ...INPUT, enterpriseId: '' })).toThrow(/enterpriseId/);
    expect(() => persistProposalDraft(manager, { ...INPUT, userId: '' })).toThrow(/userId/);
    db.close();
  });

  it('DB 写入失败 ⇒ PERSISTENCE_ERROR（retryable=true，不伪装成功）', () => {
    const db = new Database(':memory:');
    const failing = new FailingProposalManager(db);
    let caught: unknown = null;
    try { persistProposalDraft(failing, { ...INPUT, runId: 'run_proposals_0003' }); } catch (err: unknown) { caught = err; }
    expect(caught).toBeInstanceOf(DshError);
    expect((caught as DshError).code).toBe('PERSISTENCE_ERROR');
    expect((caught as DshError).retryable).toBe(true);
    expect((caught as DshError).message).toContain('simulated db failure');
    db.close();
  });
});
