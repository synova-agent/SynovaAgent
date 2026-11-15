/**
 * T4 验收：Proposal 草案的 runId 幂等（真实 SQLite 持久化对象，非零对象恒真）。
 *
 * 覆盖：旧 schema（无 run_id）升级、部分唯一索引、同 runId 重试 =1、不同 runId =2、
 * 企业归属断言（不只看 run_id）、真实写入证明（先断言 >0 再断言不重复）。
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ProposalManager } from '../../../src/l2/proposal-manager';
import { persistProposalDraft } from '../../../src/runtime/dsh/proposals';

function openDb(): InstanceType<typeof Database> {
  return new Database(':memory:');
}

function countByRun(db: InstanceType<typeof Database>, runId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?').get(runId) as { n: number };
  return row.n;
}

describe('T4 runId 幂等（Proposal 草案真实持久化）', () => {
  it('首次 run =1、同 runId 重试仍 =1、不同 runId =2，且企业归属正确', () => {
    const db = openDb();
    const manager = new ProposalManager(db);
    const input = {
      runId: 'run_idem_0001',
      enterpriseId: 'ent-1',
      userId: 'user-1',
      title: 'draft',
      description: 'draft body',
    };

    const first = persistProposalDraft(manager, input);
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    // 先证明真实写入（count>0），再证明不重复
    expect(countByRun(db, 'run_idem_0001')).toBe(1);
    expect(first.proposal.type).toBe('agent_proposal_draft');
    expect(first.proposal.source).toBe('enterprise:ent-1');

    const retry = persistProposalDraft(manager, input);
    expect(retry.created).toBe(false);
    expect(retry.proposal.id).toBe(first.proposal.id);
    expect(countByRun(db, 'run_idem_0001')).toBe(1);

    const other = persistProposalDraft(manager, { ...input, runId: 'run_idem_0002' });
    expect(other.created).toBe(true);
    expect(countByRun(db, 'run_idem_0002')).toBe(1);
    expect(countByRun(db, 'run_idem_0001')).toBe(1);
    db.close();
  });

  it('旧 schema（无 run_id）库升级后仍可幂等，且历史行不丢', () => {
    const db = openDb();
    // 旧表形状（与 1A 前一致，无 run_id 列）
    db.exec(`
      CREATE TABLE proposals (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        confidence REAL DEFAULT 0.7,
        source TEXT DEFAULT 'unknown',
        status TEXT NOT NULL DEFAULT 'proposed',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        resolved_at TEXT,
        user_feedback TEXT
      );
    `);
    db.prepare(`INSERT INTO proposals (id,type,title,created_at) VALUES (?,?,?,?)`)
      .run('legacy-1', 'goal_create', '历史草案', '2026-01-01T00:00:00.000Z');

    const manager = new ProposalManager(db);
    const columns = db.prepare('PRAGMA table_info(proposals)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toContain('run_id');
    const indexes = db.prepare('PRAGMA index_list(proposals)').all() as Array<{ name: string; unique: number }>;
    expect(indexes.some(index => index.name === 'idx_proposals_run_id' && index.unique === 1)).toBe(true);

    const first = persistProposalDraft(manager, {
      runId: 'run_upgrade_0001',
      enterpriseId: 'ent-1',
      userId: 'user-1',
      title: '升级后草案',
      description: '',
    });
    expect(first.created).toBe(true);
    const retry = persistProposalDraft(manager, {
      runId: 'run_upgrade_0001',
      enterpriseId: 'ent-1',
      userId: 'user-1',
      title: '升级后草案',
      description: '',
    });
    expect(retry.created).toBe(false);
    expect(countByRun(db, 'run_upgrade_0001')).toBe(1);

    const legacy = db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE id = ?').get('legacy-1') as { n: number };
    expect(legacy.n).toBe(1);
    db.close();
  });

  it('唯一索引真实存在：同 run_id 二次直插被拒（删除约束必红）', () => {
    const db = openDb();
    const manager = new ProposalManager(db);
    persistProposalDraft(manager, {
      runId: 'run_unique_0001', enterpriseId: 'ent-1', userId: 'user-1', title: 'x', description: '',
    });
    let caught: unknown = null;
    try {
      db.prepare(`INSERT INTO proposals (id,type,title,created_at,run_id) VALUES (?,?,?,?,?)`)
        .run('dup-1', 'agent_proposal_draft', 'dup', '2026-01-01T00:00:00.000Z', 'run_unique_0001');
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught)).toMatch(/UNIQUE constraint failed/);
    db.close();
  });

  it('非法 runId / 缺企业归属 ⇒ VALIDATION_ERROR（不静默放行）', () => {
    const db = openDb();
    const manager = new ProposalManager(db);
    expect(() => persistProposalDraft(manager, { runId: 'bad id', enterpriseId: 'ent-1', userId: 'u', title: 'x', description: '' }))
      .toThrow(/runId 非法/);
    expect(() => persistProposalDraft(manager, { runId: 'run_valid_0001', enterpriseId: '', userId: 'u', title: 'x', description: '' }))
      .toThrow(/enterpriseId/);
    db.close();
  });
});
