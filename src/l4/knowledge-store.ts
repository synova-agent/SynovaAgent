/**
 * l4/knowledge-store.ts — 知识块存储 (M1-Slice3)
 *
 * SQLite + FTS5 全文索引。每条 KnowledgeChunk 携带权限标签。
 * L4 层不感知调用方身份，只执行 FilterClause。
 */
import Database from 'better-sqlite3';
// FilterClause type — 使用内联类型避免跨包 tsc 路径解析问题
export interface FilterClause {
  conditions: Array<{ field: string; operator: 'IN' | 'EQ' | 'NOT_EQ' | 'CONTAINS'; value: unknown }>;
}
import { createLogger } from '@synova/logger';

const log = createLogger('l4/knowledge-store');

// ═══ Types ═══

export interface KnowledgeChunk {
  id: string;
  text: string;
  sourceType: string;       // 'document' | 'message' | 'phase0' | 'external'
  sourceId: string;          // 来源文档/消息 ID
  authorityLevel: 'internal_stored' | 'external_official' | 'external_reference' | 'reference';
  mimeType?: string;
  // 权限标签
  accessLevel: 'public' | 'team' | 'private';
  accessTeamId?: string;
  accessOwnerId?: string;
  accessSensitivity: 'normal' | 'sensitive' | 'restricted';
  /**
   * #1075 P2-4b-B: PKB 域标签（`pkb_domain` 列；岗位包 `knowledge-scope.yaml` 的 scope id）。
   * 🔴 对外映射字段名是 `pkbDomain`（工具边界才改名 `domain`）——**不**在本类型加 `domain` 键。
   */
  pkbDomain?: string | null;
  // 元数据
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult extends KnowledgeChunk {
  rank: number;              // FTS5 相关性排名
  snippet: string;           // 高亮摘要
}

export interface SearchStats {
  totalHits: number;
  filteredOut: number;       // 被权限过滤掉的数量
  latencyMs: number;
}

// ═══ Schema ═══

export class KnowledgeStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        authority_level TEXT NOT NULL DEFAULT 'reference',
        mime_type TEXT,
        access_level TEXT NOT NULL DEFAULT 'private',
        access_team_id TEXT,
        access_owner_id TEXT,
        access_sensitivity TEXT NOT NULL DEFAULT 'normal',
        -- 多租户隔离 (Phase 4c)
        org_id TEXT DEFAULT 'default',
        -- PKB 扩展 (Slice 1)
        pkb_domain TEXT,
        pkb_type TEXT,
        pkb_confidence REAL DEFAULT 0.7,
        pkb_status TEXT DEFAULT 'draft',
        pkb_source TEXT,
        pkb_expires_at TEXT,
        pkb_version TEXT,
        knowledge_level INTEGER DEFAULT 2,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- PKB 索引
      CREATE INDEX IF NOT EXISTS idx_kb_domain ON knowledge_chunks(pkb_domain);
      CREATE INDEX IF NOT EXISTS idx_kb_status ON knowledge_chunks(pkb_status);
      CREATE INDEX IF NOT EXISTS idx_kb_level ON knowledge_chunks(knowledge_level);
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
        id UNINDEXED,
        text,
        source_type UNINDEXED,
        tokenize='unicode61'
      );
    `);

    // FTS5 同步触发器
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS kc_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(id, text, source_type) VALUES (new.id, new.text, new.source_type);
      END;
      CREATE TRIGGER IF NOT EXISTS kc_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, id, text, source_type) VALUES ('delete', old.id, old.text, old.source_type);
      END;
    `);

    // 审计日志表 (仅追加)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        user_id TEXT,
        query TEXT,
        total_hits INTEGER DEFAULT 0,
        filtered_out INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 权限变更审计表 (M2 — 对话变更权限)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL CHECK(event_type IN ('access_change','bulk_share','restrict','temporary_grant','revoke')),
        changed_by TEXT NOT NULL,
        target_ids TEXT NOT NULL,
        old_access_level TEXT,
        new_access_level TEXT,
        old_team_id TEXT,
        new_team_id TEXT,
        old_sensitivity TEXT,
        new_sensitivity TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_perm_audit_time ON permission_audit_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_perm_audit_user ON permission_audit_log(changed_by);
    `);
    // Phase 4c: 向后兼容 — 已有数据库添加 org_id 列
    try { this.db.exec('ALTER TABLE knowledge_chunks ADD COLUMN org_id TEXT DEFAULT \'default\''); } catch { /* 列已存在 */ }
    log.info('KnowledgeStore schema initialized');
  }

  // ═══ CRUD ═══

  insert(chunk: Omit<KnowledgeChunk, 'id' | 'createdAt' | 'updatedAt'> & { orgId?: string }): string {
    const id = `kc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const orgId = chunk.orgId || 'default';
    this.db.prepare(`
      INSERT INTO knowledge_chunks (id, text, source_type, source_id, authority_level, mime_type,
        access_level, access_team_id, access_owner_id, access_sensitivity, org_id, pkb_domain, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, chunk.text, chunk.sourceType, chunk.sourceId, chunk.authorityLevel,
      chunk.mimeType || null, chunk.accessLevel, chunk.accessTeamId || null,
      chunk.accessOwnerId || null, chunk.accessSensitivity, orgId,
      // #1075 P2-4b-B: 可选域标签（缺省 NULL ⇒ 角色会话按 fail-closed 不返回，需 update 打标）
      chunk.pkbDomain ?? null, now, now);
    return id;
  }

  /**
   * FTS5 全文搜索 + FilterClause 权限过滤。
   * L4 层不感知调用方身份 — 只接收 FilterClause 执行。
   *
   * @param query 搜索关键词
   * @param filter 权限过滤条件 (来自 AuthProvider)
   * @param limit 返回条数
   */
  search(query: string, filter: FilterClause, limit = 10): { results: SearchResult[]; stats: SearchStats } {
    const startTime = Date.now();
    const hasCJK = /[一-鿿]/.test(query);

    // FTS5 查询
    let rows: Array<Record<string, unknown>>;
    if (hasCJK) {
      // 中文使用 LIKE fallback
      const likePattern = `%${query}%`;
      rows = this.db.prepare(`
        SELECT k.*, 1 as rank, substr(k.text, max(0, instr(k.text, ?) - 40), 120) as snippet
        FROM knowledge_chunks k
        WHERE k.text LIKE ?
        ORDER BY k.updated_at DESC
        LIMIT ?
      `).all(query, likePattern, limit * 2) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.prepare(`
        SELECT k.*, fts.rank, snippet(knowledge_chunks_fts, 1, '<b>', '</b>', '...', 40) as snippet
        FROM knowledge_chunks_fts fts
        JOIN knowledge_chunks k ON k.id = fts.id
        WHERE knowledge_chunks_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(query, limit * 2) as Array<Record<string, unknown>>;
    }

    // 权限过滤
    const filtered = filter.conditions.length === 0
      ? rows  // admin: 无过滤
      : rows.filter(row => this.matchFilter(row, filter));

    const stats: SearchStats = {
      totalHits: rows.length,
      filteredOut: rows.length - filtered.length,
      latencyMs: Date.now() - startTime,
    };

    const results = filtered.slice(0, limit).map(r => ({
      id: r.id as string,
      text: r.text as string,
      sourceType: r.source_type as string,
      sourceId: r.source_id as string,
      authorityLevel: r.authority_level as KnowledgeChunk['authorityLevel'],
      mimeType: r.mime_type as string | undefined,
      accessLevel: r.access_level as KnowledgeChunk['accessLevel'],
      accessTeamId: r.access_team_id as string | undefined,
      accessOwnerId: r.access_owner_id as string | undefined,
      accessSensitivity: r.access_sensitivity as KnowledgeChunk['accessSensitivity'],
      // #1075 P2-4b-B: PKB 域标签（`pkbDomain`；**不**在此加对外键 `domain` —— 映射在工具边界）
      pkbDomain: (r.pkb_domain as string | null | undefined) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      rank: (r.rank as number) || 1,
      snippet: (r.snippet as string) || (r.text as string).slice(0, 120),
    }));

    return { results, stats };
  }

  /** 记录审计日志 */
  auditLog(eventType: string, userId: string, queryStr: string, stats: SearchStats): void {
    this.db.prepare(`
      INSERT INTO knowledge_audit (event_type, user_id, query, total_hits, filtered_out, latency_ms)
      VALUES (?,?,?,?,?,?)
    `).run(eventType, userId, queryStr, stats.totalHits, stats.filteredOut, stats.latencyMs);
  }

  /** 获取存储统计 */
  stats(): { totalChunks: number; totalSizeBytes: number } {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM knowledge_chunks').get() as Record<string, unknown>).c as number || 0;
    const size = (this.db.prepare('SELECT SUM(LENGTH(text)) as s FROM knowledge_chunks').get() as Record<string, unknown>).s as number || 0;
    return { totalChunks: count, totalSizeBytes: size };
  }

  /**
   * 时间窗口新增知识统计 (D475 loop-5 知识积累循环)
   *
   * 契约:
   *   @input  sinceIso — ISO 8601 起点（如 '2026-08-01T00:00:00.000Z'）
   *   @output { total, byDomain, bySourceType } — 窗口内新增条目总量 + 分域 + 分源计数
   *   @degraded 无外部依赖，SQL 查询失败由调用方 catch 处理
   *
   * 双格式归一: insert() 写 ISO 格式（L147），schema DEFAULT 写 datetime('now')
   *   格式（L80）——两边都用 datetime() 归一化后比较，两种格式均可正确入窗口。
   */
  recentStats(sinceIso: string): {
    total: number;
    byDomain: Record<string, number>;
    bySourceType: Record<string, number>;
  } {
    const since = `datetime(?)`;
    const total = (
      this.db.prepare(`SELECT COUNT(*) as c FROM knowledge_chunks WHERE datetime(created_at) >= ${since}`).get(sinceIso) as Record<string, unknown>
    ).c as number || 0;
    const domainRows = this.db.prepare(
      `SELECT pkb_domain as d, COUNT(*) as c FROM knowledge_chunks
       WHERE datetime(created_at) >= ${since} AND pkb_domain IS NOT NULL
       GROUP BY pkb_domain`
    ).all(sinceIso) as Array<Record<string, unknown>>;
    const sourceRows = this.db.prepare(
      `SELECT source_type as s, COUNT(*) as c FROM knowledge_chunks
       WHERE datetime(created_at) >= ${since}
       GROUP BY source_type`
    ).all(sinceIso) as Array<Record<string, unknown>>;

    const byDomain: Record<string, number> = {};
    for (const r of domainRows) byDomain[r.d as string] = r.c as number || 0;
    const bySourceType: Record<string, number> = {};
    for (const r of sourceRows) bySourceType[r.s as string] = r.c as number || 0;
    return { total, byDomain, bySourceType };
  }

  /**
   * 更新知识条目 (PKB Slice 1)。
   *
   * #1075 P2-4b-B（写丢修复）: 增写 `pkb_domain` / `pkb_type` / `pkb_source` 三列 ——
   *   此前 `update({pkb_domain})` 被静默丢弃（三处生产打标 `src/l3/pkb-seed.ts`／
   *   `src/l3/knowledge-agent.ts`／`src/routes/documents.ts` 全部无效）。
   *   取 `merged`（= existing ∪ props），缺省 `null`；其余列语义不变。
   *
   * @input  id — 知识块 id；props — 部分字段（未给的沿用 existing）
   * @output 无
   * @degraded 不适用（纯 SQL；错误照旧抛出，由调用方处理）
   * @error  条目不存在 ⇒ throw（既有行为，不改）
   */
  update(id: string, props: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT * FROM knowledge_chunks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new Error(`KnowledgeChunk ${id} not found`);
    const merged: Record<string, unknown> = { ...existing, ...props, updated_at: now };
    this.db.prepare(`
      UPDATE knowledge_chunks SET text=?, source_type=?, authority_level=?, mime_type=?,
        access_level=?, access_team_id=?, access_sensitivity=?,
        pkb_confidence=?, pkb_status=?, pkb_expires_at=?, pkb_version=?, knowledge_level=?,
        pkb_domain=?, pkb_type=?, pkb_source=?, updated_at=?
      WHERE id=?
    `).run(
      merged.text, merged.source_type, merged.authority_level, merged.mime_type,
      merged.access_level, merged.access_team_id, merged.access_sensitivity,
      merged.pkb_confidence ?? null, merged.pkb_status ?? 'active',
      merged.pkb_expires_at ?? null, merged.pkb_version ?? null,
      merged.knowledge_level ?? 2,
      merged.pkb_domain ?? null, merged.pkb_type ?? null, merged.pkb_source ?? null,
      now, id,
    );
  }

  /** 获取长文本块 (Gear6 知识提取使用) */
  getLongChunks(minLength = 2000, limit = 20): Array<{ id: string; text: string }> {
    const rows = this.db.prepare(
      'SELECT id, text FROM knowledge_chunks WHERE LENGTH(text) > ? LIMIT ?'
    ).all(minLength, limit) as Array<Record<string, unknown>>;
    return rows.map(r => ({ id: r.id as string, text: r.text as string }));
  }

  /** 删除知识条目 */
  delete(id: string): void {
    this.db.prepare('DELETE FROM knowledge_chunks WHERE id=?').run(id);
  }

  /** PKB 专用搜索 — 按 domain/type/level/confidence 过滤 */
  searchPKB(params: {
    query: string; domain?: string; type?: string; minConfidence?: number;
    knowledgeLevel?: number; limit?: number;
  }, filter: FilterClause, limit = 10): { results: KnowledgeChunk[]; stats: SearchStats } {
    const startTime = Date.now();
    const minConf = params.minConfidence ?? 0.5;
    const level = params.knowledgeLevel ?? 2;

    let sql = `SELECT k.*, 1 as rank FROM knowledge_chunks k WHERE k.pkb_domain = ? AND k.pkb_confidence >= ? AND k.knowledge_level <= ?`;
    const sqlParams: unknown[] = [params.domain, minConf, level];

    if (params.type) { sql += ' AND k.pkb_type = ?'; sqlParams.push(params.type); }
    if (params.query) {
      sql += ' AND (k.text LIKE ? OR k.source_id LIKE ?)';
      const like = `%${params.query}%`;
      sqlParams.push(like, like);
    }
    sql += ' ORDER BY k.pkb_confidence DESC, k.updated_at DESC LIMIT ?';
    sqlParams.push(limit * 2);

    const rows = this.db.prepare(sql).all(...sqlParams) as Array<Record<string, unknown>>;

    // 权限过滤
    const filtered = filter.conditions.length === 0
      ? rows
      : rows.filter(row => this.matchFilter(row, filter));

    const stats: SearchStats = {
      totalHits: rows.length,
      filteredOut: rows.length - filtered.length,
      latencyMs: Date.now() - startTime,
    };

    return {
      results: filtered.slice(0, limit).map(r => this.rowToChunk(r)),
      stats,
    };
  }

  /**
   * 按 SKILL 名称查询知识条目（D63 pull-mode）。
   * 通过 pkb_type 精确匹配 SKILL 名称。
   *
   * @param skillName — SKILL 名称（如 me_pricing_strategy）
   * @param limit — 最大返回条数
   * @returns KnowledgeChunk[]
   */
  getBySkill(skillName: string, limit = 5): KnowledgeChunk[] {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM knowledge_chunks
        WHERE pkb_type = ? AND pkb_status = 'active'
        ORDER BY pkb_confidence DESC, knowledge_level ASC
        LIMIT ?
      `).all(skillName, limit) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToChunk(r));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, skillName }, 'getBySkill 查询失败 — 返回空');
      return [];
    }
  }

  /** 获取 PKB 统计 */
  pkbStats(): { total: number; byDomain: Record<string, number>; averageConfidence: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM knowledge_chunks WHERE pkb_domain IS NOT NULL").get() as Record<string, unknown>).c as number || 0;
    const avgConf = (this.db.prepare('SELECT AVG(pkb_confidence) as a FROM knowledge_chunks WHERE pkb_domain IS NOT NULL').get() as Record<string, unknown>).a as number || 0;
    const domains = this.db.prepare('SELECT pkb_domain, COUNT(*) as c FROM knowledge_chunks WHERE pkb_domain IS NOT NULL GROUP BY pkb_domain').all() as Array<Record<string, unknown>>;
    const byDomain: Record<string, number> = {};
    for (const d of domains) { byDomain[d.pkb_domain as string] = d.c as number; }
    return { total, byDomain, averageConfidence: Math.round(avgConf * 100) / 100 };
  }

  /** 置信度衰减 (Slice 3) — 每周衰减因子 */
  decayConfidence(factor = 0.95): number {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const result = this.db.prepare(`
      UPDATE knowledge_chunks
      SET pkb_confidence = MAX(0, ROUND(pkb_confidence * ?, 4)),
          pkb_status = CASE WHEN pkb_confidence * ? < 0.5 THEN 'deprecated' ELSE pkb_status END,
          updated_at = ?
      WHERE pkb_domain IS NOT NULL AND pkb_status = 'active' AND updated_at < ?
    `).run(factor, factor, new Date().toISOString(), weekAgo);
    return result.changes;
  }

  /** 过期检测 (Slice 3) */
  expireOutdated(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE knowledge_chunks SET pkb_status = 'expired', updated_at = ?
      WHERE pkb_domain IS NOT NULL AND pkb_status = 'active' AND pkb_expires_at IS NOT NULL AND pkb_expires_at < ?
    `).run(now, now);
    return result.changes;
  }

  /** 诊断反馈表 (Slice 4) */
  initFeedbackSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS diagnosis_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consult_id TEXT NOT NULL,
        knowledge_entry_id TEXT NOT NULL,
        expert_type TEXT NOT NULL,
        result TEXT NOT NULL CHECK(result IN ('confirmed','rejected','contradicted')),
        confidence REAL,
        user_feedback TEXT,
        contradicting_expert TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_fb_entry ON diagnosis_feedback(knowledge_entry_id);
      CREATE INDEX IF NOT EXISTS idx_fb_processed ON diagnosis_feedback(processed);
    `);
  }

  /** 记录诊断反馈 */
  recordFeedback(entry: {
    consultId: string; knowledgeEntryId: string; expertType: string;
    result: 'confirmed' | 'rejected' | 'contradicted';
    confidence?: number; userFeedback?: string; contradictingExpert?: string;
  }): void {
    this.initFeedbackSchema();
    this.db.prepare(`
      INSERT INTO diagnosis_feedback (consult_id, knowledge_entry_id, expert_type, result, confidence, user_feedback, contradicting_expert)
      VALUES (?,?,?,?,?,?,?)
    `).run(entry.consultId, entry.knowledgeEntryId, entry.expertType,
      entry.result, entry.confidence ?? null, entry.userFeedback ?? null, entry.contradictingExpert ?? null);
  }

  /** 冲突检测 — 相似知识标记 reviewing */
  detectConflicts(): number {
    try {
      const rows = this.db.prepare(`
        SELECT a.id as id1, a.pkb_domain, a.text as text1, b.id as id2, b.text as text2
        FROM knowledge_chunks a
        JOIN knowledge_chunks b ON a.pkb_domain = b.pkb_domain AND a.id < b.id
        WHERE a.pkb_domain IS NOT NULL AND a.pkb_status = 'active' AND b.pkb_status = 'active'
        LIMIT 100
      `).all() as Array<Record<string, unknown>>;
      let count = 0;
      for (const r of rows) {
        const t1 = (r.text1 as string).toLowerCase();
        const t2 = (r.text2 as string).toLowerCase();
        const sim = this.jaccardTextSimilarity(t1, t2);
        if (sim > 0.8) {
          this.db.prepare('UPDATE knowledge_chunks SET pkb_status = ?, updated_at = ? WHERE id = ?')
            .run('reviewing', new Date().toISOString(), r.id2);
          count++;
        }
      }
      return count;
    } catch { log.warn("PKB count 查询失败"); return 0; }
  }

  /** 应用诊断反馈 — 调整知识置信度 */
  applyFeedback(): number {
    try {
      this.initFeedbackSchema();
      const rows = this.db.prepare(`
        SELECT knowledge_entry_id, SUM(CASE WHEN result = 'confirmed' THEN 0.02 ELSE -0.05 END) as delta
        FROM diagnosis_feedback WHERE processed = 0 GROUP BY knowledge_entry_id
      `).all() as Array<Record<string, unknown>>;
      for (const r of rows) {
        const id = r.knowledge_entry_id as string;
        try {
          const current = this.db.prepare('SELECT pkb_confidence FROM knowledge_chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
          if (!current) continue;
          const newConf = Math.max(0, Math.min(1, (current.pkb_confidence as number || 0.7) + (r.delta as number)));
          this.update(id, { pkb_confidence: newConf, pkb_status: newConf < 0.5 ? 'deprecated' : 'active' });
        } catch { log.debug('知识库: 跳过损坏的反馈记录'); }
      }
      this.db.prepare('UPDATE diagnosis_feedback SET processed = 1 WHERE processed = 0').run();
      return rows.length;
    } catch { log.warn("PKB 活跃 count 查询失败"); return 0; }
  }

  // ═══ 权限管理 (M2 — 对话变更权限) ═══

  /** 财务领域强制 restricted — 不可降级 (铁律: 财务是最高级权限) */
  private readonly FINANCE_LOCK_DOMAINS = ['finance'];

  /**
   * 更新单条知识的访问权限。
   * 财务领域强制 restricted sensitivity，不可降级。
   */
  updateAccess(id: string, access: {
    accessLevel?: KnowledgeChunk['accessLevel'];
    accessTeamId?: string | null;
    accessSensitivity?: KnowledgeChunk['accessSensitivity'];
  }): { ok: boolean; warning?: string } {
    const existing = this.db.prepare('SELECT * FROM knowledge_chunks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return { ok: false, warning: `条目 ${id} 不存在` };

    // 财务领域锁定: sensitivity 不可降级到 normal
    const domain = existing.pkb_domain as string | undefined;
    if (domain && this.FINANCE_LOCK_DOMAINS.includes(domain)) {
      if (access.accessSensitivity && access.accessSensitivity !== 'restricted') {
        return { ok: false, warning: `财务领域条目 (${domain}) 敏感级别不可降级 — 保持 restricted` };
      }
      // 财务条目不可设为 public
      if (access.accessLevel === 'public') {
        return { ok: false, warning: `财务领域条目 (${domain}) 不可设为 public — 保持 team/private` };
      }
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (access.accessLevel) {
      updates.push('access_level = ?'); values.push(access.accessLevel);
    }
    if (access.accessTeamId !== undefined) {
      updates.push('access_team_id = ?'); values.push(access.accessTeamId);
    }
    if (access.accessSensitivity) {
      updates.push('access_sensitivity = ?'); values.push(access.accessSensitivity);
    }

    if (updates.length === 0) return { ok: false, warning: '无变更' };

    updates.push('updated_at = ?'); values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE knowledge_chunks SET ${updates.join(', ')} WHERE id=?`).run(...values);
    return { ok: true };
  }

  /**
   * 批量更新访问权限 — 按领域或 ID 列表。
   * 市场领域可共享 (public)，财务领域强制 restricted。
   */
  bulkUpdateAccess(params: {
    domain?: string;
    ids?: string[];
    accessLevel?: KnowledgeChunk['accessLevel'];
    accessTeamId?: string | null;
    accessSensitivity?: KnowledgeChunk['accessSensitivity'];
    /** 仅限于当前团队的数据 */
    restrictToTeam?: string;
  }): { ok: boolean; updated: number; skipped: number; warnings: string[] } {
    const warnings: string[] = [];
    let updated = 0;
    let skipped = 0;

    // 财务领域锁定
    if (params.domain && this.FINANCE_LOCK_DOMAINS.includes(params.domain)) {
      if (params.accessLevel === 'public') {
        return { ok: false, updated: 0, skipped: 0, warnings: ['财务领域不可设为 public'] };
      }
      if (params.accessSensitivity && params.accessSensitivity !== 'restricted') {
        return { ok: false, updated: 0, skipped: 0, warnings: ['财务领域敏感级别不可降级'] };
      }
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.accessLevel) { updates.push('access_level = ?'); values.push(params.accessLevel); }
    if (params.accessTeamId !== undefined) { updates.push('access_team_id = ?'); values.push(params.accessTeamId); }
    if (params.accessSensitivity) { updates.push('access_sensitivity = ?'); values.push(params.accessSensitivity); }
    updates.push('updated_at = ?'); values.push(now);

    if (updates.length <= 1) return { ok: false, updated: 0, skipped: 0, warnings: ['无变更字段'] };

    // 按 ID 列表
    if (params.ids && params.ids.length > 0) {
      const placeholders = params.ids.map(() => '?').join(',');
      const sql = `UPDATE knowledge_chunks SET ${updates.join(', ')} WHERE id IN (${placeholders})`;
      const result = this.db.prepare(sql).run(...values, ...params.ids);
      updated = result.changes;
      return { ok: true, updated, skipped, warnings };
    }

    // 按领域
    if (params.domain) {
      let whereClause = 'pkb_domain = ?';
      const whereValues: unknown[] = [params.domain];
      if (params.restrictToTeam) {
        whereClause += ' AND access_team_id = ?';
        whereValues.push(params.restrictToTeam);
      }
      const sql = `UPDATE knowledge_chunks SET ${updates.join(', ')} WHERE ${whereClause}`;
      const result = this.db.prepare(sql).run(...values, ...whereValues);
      updated = result.changes;
      return { ok: true, updated, skipped, warnings };
    }

    return { ok: false, updated: 0, skipped: 0, warnings: ['请指定 domain 或 ids'] };
  }

  /**
   * 记录权限变更审计
   */
  auditPermissionChange(entry: {
    eventType: 'access_change' | 'bulk_share' | 'restrict' | 'temporary_grant' | 'revoke';
    changedBy: string;
    targetIds: string[];
    oldAccessLevel?: string;
    newAccessLevel?: string;
    oldTeamId?: string;
    newTeamId?: string;
    oldSensitivity?: string;
    newSensitivity?: string;
    reason?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO permission_audit_log (event_type, changed_by, target_ids, old_access_level, new_access_level, old_team_id, new_team_id, old_sensitivity, new_sensitivity, reason)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      entry.eventType, entry.changedBy, JSON.stringify(entry.targetIds),
      entry.oldAccessLevel ?? null, entry.newAccessLevel ?? null,
      entry.oldTeamId ?? null, entry.newTeamId ?? null,
      entry.oldSensitivity ?? null, entry.newSensitivity ?? null,
      entry.reason ?? null,
    );
  }

  /** 获取权限审计日志 */
  getPermissionAuditLog(limit = 50, changedBy?: string): Array<Record<string, unknown>> {
    if (changedBy) {
      return this.db.prepare('SELECT * FROM permission_audit_log WHERE changed_by=? ORDER BY created_at DESC LIMIT ?').all(changedBy, limit) as Array<Record<string, unknown>>;
    }
    return this.db.prepare('SELECT * FROM permission_audit_log ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
  }

  /** 按领域列出知识条目 (用于权限管理概览) */
  listByDomain(domain?: string, limit = 100): Array<Record<string, unknown>> {
    if (domain) {
      return this.db.prepare(`
        SELECT id, pkb_domain, pkb_type, access_level, access_team_id, access_sensitivity, pkb_confidence, pkb_status, substr(text, 1, 100) as preview, updated_at
        FROM knowledge_chunks WHERE pkb_domain = ? ORDER BY updated_at DESC LIMIT ?
      `).all(domain, limit) as Array<Record<string, unknown>>;
    }
    return this.db.prepare(`
      SELECT id, pkb_domain, pkb_type, access_level, access_team_id, access_sensitivity, pkb_confidence, pkb_status, substr(text, 1, 100) as preview, updated_at
      FROM knowledge_chunks WHERE pkb_domain IS NOT NULL ORDER BY pkb_domain, updated_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  }

  /** 按领域获取访问统计 (用于 admin 概览) */
  getAccessStatsByDomain(): Record<string, { total: number; public: number; team: number; private: number; restricted: number }> {
    const rows = this.db.prepare(`
      SELECT pkb_domain, access_level, access_sensitivity, COUNT(*) as c
      FROM knowledge_chunks WHERE pkb_domain IS NOT NULL
      GROUP BY pkb_domain, access_level, access_sensitivity
    `).all() as Array<Record<string, unknown>>;
    const stats: Record<string, { total: number; public: number; team: number; private: number; restricted: number }> = {};
    for (const r of rows) {
      const domain = r.pkb_domain as string;
      if (!stats[domain]) stats[domain] = { total: 0, public: 0, team: 0, private: 0, restricted: 0 };
      stats[domain].total += (r.c as number);
      const level = r.access_level as string;
      if (level === 'public') stats[domain].public += (r.c as number);
      else if (level === 'team') stats[domain].team += (r.c as number);
      else stats[domain].private += (r.c as number);
      if (r.access_sensitivity === 'restricted') stats[domain].restricted += (r.c as number);
    }
    return stats;
  }

  private jaccardTextSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const setA = new Set(a.split(/\s+/).filter(w => w.length > 1));
    const setB = new Set(b.split(/\s+/).filter(w => w.length > 1));
    if (setA.size === 0 || setB.size === 0) return 0;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    return intersection.size / (setA.size + setB.size - intersection.size);
  }

  /** Row → KnowledgeChunk 映射复用 */
  private rowToChunk(r: Record<string, unknown>): KnowledgeChunk {
    return {
      id: r.id as string, text: r.text as string,
      sourceType: r.source_type as string, sourceId: r.source_id as string,
      authorityLevel: r.authority_level as KnowledgeChunk['authorityLevel'],
      mimeType: r.mime_type as string | undefined,
      accessLevel: r.access_level as KnowledgeChunk['accessLevel'],
      accessTeamId: r.access_team_id as string | undefined,
      accessOwnerId: r.access_owner_id as string | undefined,
      accessSensitivity: r.access_sensitivity as KnowledgeChunk['accessSensitivity'],
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    };
  }

  // ═══ 权限过滤 ═══

  private matchFilter(row: Record<string, unknown>, filter: FilterClause): boolean {
    for (const c of filter.conditions) {
      const field = c.field.replace('access.', '');
      const colMap: Record<string, string> = {
        level: 'access_level',
        teamId: 'access_team_id',
        ownerId: 'access_owner_id',
        sensitivity: 'access_sensitivity',
        allowedUsers: 'access_owner_id',
      };
      const col = colMap[field] || field;
      const val = row[col];

      if (c.operator === 'IN') {
        const allowed = c.value as unknown[];
        if (!allowed.includes(val)) return false;
      } else if (c.operator === 'EQ') {
        if (val !== c.value) return false;
      } else if (c.operator === 'NOT_EQ') {
        if (val === c.value) return false;
      }
    }
    return true;
  }

  // ═══ D241: 知识审批 ═══

  /**
   * 审批通过一条 PKB。
   * 将 pkb_status 从 draft 改为 approved，记录审批人信息。
   */
  approvePkb(id: string, approverId: string): void {
    try {
      const existing = this.db.prepare('SELECT pkb_status FROM knowledge_chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!existing) throw new Error(`KnowledgeChunk ${id} not found`);
      this.db.prepare('UPDATE knowledge_chunks SET pkb_status = ?, updated_at = ? WHERE id = ?').run('approved', new Date().toISOString(), id);
      log.info({ id, approverId }, 'PKB approved');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, 'PKB approve failed');
      throw err;
    }
  }

  /**
   * 驳回一条 PKB，记录驳回原因。
   */
  rejectPkb(id: string, approverId: string, reason: string): void {
    try {
      const existing = this.db.prepare('SELECT pkb_status FROM knowledge_chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!existing) throw new Error(`KnowledgeChunk ${id} not found`);
      this.db.prepare('UPDATE knowledge_chunks SET pkb_status = ?, updated_at = ? WHERE id = ?').run('rejected', new Date().toISOString(), id);
      log.info({ id, approverId, reason }, 'PKB rejected');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, 'PKB reject failed');
      throw err;
    }
  }

  /**
   * 列出待审批的 PKB 条目。
   */
  listPendingPkb(orgId?: string, limit = 50, offset = 0): KnowledgeChunk[] {
    try {
      let sql = 'SELECT * FROM knowledge_chunks WHERE pkb_status = "draft"';
      const params: unknown[] = [];
      if (orgId) { sql += ' AND org_id = ?'; params.push(orgId); }
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToChunk(r));
    } catch (err: unknown) {
      log.warn({ err }, 'listPendingPkb failed');
      return [];
    }
  }
}
