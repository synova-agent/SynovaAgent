/**
 * l2/proposal-manager.ts — GNS v2.0 变更提议管理器 (M2 核心)
 *
 * 铁律 39: L2 编排层组件。SQLite 持久化 — 重启不丢失。
 */
import Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

type SqliteDB = InstanceType<typeof Database>;
const log = createLogger('l2/proposal-manager');

// ═══ Types ═══

export interface Proposal {
  id: string;
  type:
    | 'goal_create'
    | 'goal_update'
    | 'alert_create'
    | 'alert_resolve'
    | 'obstacle_add'
    | 'obstacle_close'
    /** 1A（#1395）：DSH 一轮运行产出的 Proposal 草案（proposal_only，不写经营决定）。 */
    | 'agent_proposal_draft';
  title: string;
  description: string;
  confidence: number;
  source: string;
  status: 'proposed' | 'confirmed' | 'rejected' | 'opinion' | 'expired';
  createdAt: string;
  expiresAt: string;
  /** 1A 幂等键：同一 runId 重试不重复创建草案（旧库升级后才有此列）。 */
  runId?: string;
  resolvedAt?: string;
  userFeedback?: string;
  suppressedUntil?: string;
}

// ═══ ProposalManager ═══

export class ProposalManager {
  private db: SqliteDB;

  constructor(db: SqliteDB) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
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
      CREATE TABLE IF NOT EXISTS proposal_suppressions (
        proposal_type TEXT PRIMARY KEY,
        suppressed_until INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
      CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);
    `);
    this.ensureRunIdColumn();
  }

  /**
   * 1A 幂等迁移：旧 `proposals` 表（无 run_id）在构造时就地升级。
   * 幂等：用 PRAGMA 判列存在再 ALTER；索引 IF NOT EXISTS（重启/重复构造都安全）。
   */
  private ensureRunIdColumn(): void {
    const columns = this.db.prepare('PRAGMA table_info(proposals)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'run_id')) {
      this.db.exec('ALTER TABLE proposals ADD COLUMN run_id TEXT');
      log.info('proposals 表已升级：新增 run_id 列（1A 幂等键）');
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_run_id ON proposals(run_id) WHERE run_id IS NOT NULL');
  }

  propose(opts: {
    type: Proposal['type']; title: string; description: string;
    confidence: number; source: string;
    /** 1A：幂等键（缺省 = 旧行为，无幂等）。 */
    runId?: string;
    /** 1A：企业归属（写入 source = `enterprise:<id>`，不改表契约）。 */
    enterpriseId?: string;
  }): Proposal {
    if (opts.runId !== undefined) {
      const existing = this.getByRunId(opts.runId);
      if (existing !== null) {
        log.info({ id: existing.id, runId: opts.runId }, '提议已存在（runId 幂等，返回原记录）');
        return existing;
      }
    }
    const suppressed = this.db.prepare('SELECT suppressed_until FROM proposal_suppressions WHERE proposal_type=?').get(opts.type) as { suppressed_until: number } | undefined;
    if (suppressed && Date.now() < suppressed.suppressed_until) {
      return {
        id: '', type: opts.type, title: opts.title, description: opts.description,
        confidence: opts.confidence, source: opts.source,
        status: 'rejected', createdAt: new Date().toISOString(),
        expiresAt: '', userFeedback: 'auto-suppressed',
      };
    }

    const source = opts.enterpriseId === undefined ? opts.source : `enterprise:${opts.enterpriseId}`;
    const proposal: Proposal = {
      id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: opts.type, title: opts.title, description: opts.description,
      confidence: opts.confidence, source,
      status: 'proposed',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      ...(opts.runId === undefined ? {} : { runId: opts.runId }),
    };

    try {
      this.db.prepare(`INSERT INTO proposals (id,type,title,description,confidence,source,status,created_at,expires_at,run_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        proposal.id, proposal.type, proposal.title, proposal.description,
        proposal.confidence, proposal.source, proposal.status,
        proposal.createdAt, proposal.expiresAt,
        opts.runId ?? null,
      );
    } catch (err: unknown) {
      // 并发同 runId：唯一索引兜底，冲突后重查（不吞错：只处理已知 UNIQUE 冲突）。
      const message = err instanceof Error ? err.message : String(err);
      if (opts.runId !== undefined && message.includes('UNIQUE constraint failed')) {
        const raced = this.getByRunId(opts.runId);
        if (raced !== null) return raced;
      }
      throw err;
    }
    log.info({ id: proposal.id, type: opts.type }, '提议已创建 (SQLite)');
    return proposal;
  }

  resolve(id: string, action: 'confirm' | 'reject' | 'opinion', feedback?: string):
    { ok: boolean; proposal?: Proposal; error?: string } {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: `提议 ${id} 不存在` };
    if (row.status !== 'proposed') return { ok: false, error: `提议 ${id} 已处理 (${row.status})` };

    const now = new Date().toISOString();
    let status = row.status as string;
    switch (action) {
      case 'confirm': status = 'confirmed'; break;
      case 'reject':
        status = 'rejected';
        this.db.prepare(`INSERT OR REPLACE INTO proposal_suppressions (proposal_type, suppressed_until) VALUES (?,?)`)
          .run(row.type, Date.now() + 24 * 3600_000);
        break;
      case 'opinion': status = 'opinion'; break;
    }

    this.db.prepare(`UPDATE proposals SET status=?, resolved_at=?, user_feedback=? WHERE id=?`)
      .run(status, now, feedback || null, id);

    const proposal = this.rowToProposal({ ...row, status, resolved_at: now, user_feedback: feedback });
    log.info({ id, action }, '提议已处理');
    return { ok: true, proposal };
  }

  /** 按 runId 查草案（1A 幂等；不存在返回 null）。 */
  getByRunId(runId: string): Proposal | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE run_id=?').get(runId) as Record<string, unknown> | undefined;
    return row === undefined ? null : this.rowToProposal(row);
  }

  getPending(): Proposal[] {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE proposals SET status='expired' WHERE status='proposed' AND expires_at < ?`).run(now);
    const rows = this.db.prepare('SELECT * FROM proposals WHERE status=? ORDER BY created_at DESC').all('proposed') as Record<string, unknown>[];
    return rows.map(r => this.rowToProposal(r));
  }

  getHistory(limit = 20): Proposal[] {
    const rows = this.db.prepare('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(r => this.rowToProposal(r));
  }

  getConfirmationRate(): { total: number; confirmed: number; rejected: number; opinion: number; rate: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status='opinion' THEN 1 ELSE 0 END) as opinion
      FROM proposals WHERE status NOT IN ('proposed','expired')
    `).get() as Record<string, number>;
    return {
      total: row.total || 0, confirmed: row.confirmed || 0,
      rejected: row.rejected || 0, opinion: row.opinion || 0,
      rate: row.total > 0 ? Math.round((row.confirmed / row.total) * 100) : 0,
    };
  }

  clearSuppression(type: Proposal['type']): void {
    this.db.prepare('DELETE FROM proposal_suppressions WHERE proposal_type=?').run(type);
  }

  private rowToProposal(r: Record<string, unknown>): Proposal {
    return {
      id: r.id as string, type: r.type as Proposal['type'],
      title: r.title as string, description: r.description as string,
      confidence: r.confidence as number, source: r.source as string,
      status: r.status as Proposal['status'],
      createdAt: r.created_at as string, expiresAt: r.expires_at as string,
      resolvedAt: r.resolved_at as string | undefined,
      userFeedback: r.user_feedback as string | undefined,
      ...(r.run_id === null || r.run_id === undefined ? {} : { runId: r.run_id as string }),
    };
  }
}

// ═══ Singleton (兼容旧无参调用) ═══

let _instance: ProposalManager | null = null;
export function getProposalManager(db?: SqliteDB): ProposalManager {
  if (db) { _instance = new ProposalManager(db); return _instance; }
  if (!_instance) throw new Error('ProposalManager requires Database — call getProposalManager(db) at startup');
  return _instance;
}
