/**
 * src/growth/feedback-collector.ts — 中层反馈收集器
 *
 * D93: 中层行为数据管道。将中层对哨兵、Goal、Proposal 的反馈收集到
 * SQLite feedback_log 表，供 D92 进化循环使用。
 *
 * 输入源:
 *   - 中层标记哨兵告警为"误报" → decision:'reject'
 *   - 中层调整 Goal 目标值 → decision:'modify'
 *   - 中层拒绝 Proposal 路径 → decision:'reject_path'
 *   - 中层闭环 Goal 但标记"无效" → decision:'ineffective'
 *
 * 契约:
 *   @input  — MiddleFeedbackInput
 *   @output — FeedbackRecord（含 id/createdAt）
 *   @degraded — SQLite 写入失败 → log.warn + return degraded:true（不阻断用户操作）
 */
import { randomUUID } from 'crypto';
import { createLogger } from '@synova/logger';

const log = createLogger('growth/feedback-collector');

// ═══ Types ═══

/** 反馈决策类型 */
export type FeedbackDecision = 'reject' | 'modify' | 'reject_path' | 'ineffective';

/** 反馈目标类型（D551: + 'diagnosis_conclusion' — GA 诊断校准回流，spec SYNOVA-IMPL-DSH-D551 §6.3） */
export type FeedbackTargetType =
  | 'sentinel_alert'
  | 'goal'
  | 'proposal'
  // D551: GA 诊断校准回流（存储判别值，非本体类型）
  | 'diagnosis_conclusion';

/** 收集反馈的输入 */
export interface MiddleFeedbackInput {
  /** 企业 ID */
  enterpriseId: string;
  /** 操作者 ID */
  actorId: string;
  /** 决策类型 */
  decision: FeedbackDecision;
  /** 反馈目标类型 */
  targetType: FeedbackTargetType;
  /** 反馈目标 ID */
  targetId: string;
  /** 反馈理由（可选） */
  reason?: string;
  /** 证据引用（可选，相关快照/日志 ID） */
  /** 操作者角色（D93b — 支持 D92 矛盾检测） */
  actorRole?: string;
  evidenceRefs?: string[];
}

/** 持久化的反馈记录 */
export interface FeedbackRecord {
  /** 唯一标识 */
  id: string;
  /** 企业 ID */
  enterpriseId: string;
  /** 操作者 ID */
  actorId: string;
  /** 决策类型 */
  decision: FeedbackDecision;
  /** 反馈目标类型 */
  targetType: FeedbackTargetType;
  /** 反馈目标 ID */
  targetId: string;
  /** 反馈理由 */
  reason: string;
  /** 证据引用（JSON 序列化数组） */
  evidenceRefs: string;
  /** 操作者角色（D93b — 支持 D92 矛盾检测） */
  actorRole: string;
  /** 创建时间 */
  createdAt: string;
}

/** 查询过滤条件 */
export interface FeedbackQuery {
  enterpriseId?: string;
  decision?: FeedbackDecision;
  targetType?: FeedbackTargetType;
  targetId?: string;
  since?: string;
  limit?: number;
}

/**
 * 查询结果（D338 fail-closed）。
 * 铁律 31: `[]` 无法区分「拒绝查询」与「无结果」，degraded 显式传播降级信号。
 */
export interface FeedbackQueryResult {
  entries: FeedbackRecord[];
  degraded: boolean;
}

/** 聚合信号 */
export interface AggregatedSignal {
  /**
   * 聚合键（#976: 真 target_id，如哨兵键 `F1_KZ` / goalId / pathKey / expertKey）。
   * 消费者以它匹配 extensions 配置里的真键 —— 不再是 decision:target_type:actor_role 复合键。
   */
  key: string;
  /** 信号类型 */
  decision: FeedbackDecision;
  /** 目标类型 */
  targetType: FeedbackTargetType;
  /** 聚合次数 */
  count: number;
  /** 最新反馈时间 */
  latestTimestamp: string;
  /** 相关目标 ID 列表 */
  targetIds: string[];
}

// ═══ SQLite DDL ═══

export const FEEDBACK_DDL = `
CREATE TABLE IF NOT EXISTS feedback_log (
  id            TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK(decision IN ('reject','modify','reject_path','ineffective')),
  target_type   TEXT NOT NULL CHECK(target_type IN ('sentinel_alert','goal','proposal','diagnosis_conclusion')),
  target_id     TEXT NOT NULL,
  reason        TEXT DEFAULT '',
  evidence_refs TEXT DEFAULT '[]',
  actor_role    TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_enterprise ON feedback_log(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_feedback_decision ON feedback_log(decision);
CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback_log(target_type, target_id);
-- D93b: migration
CREATE TABLE IF NOT EXISTS schema_version (version TEXT PRIMARY KEY);
INSERT OR IGNORE INTO schema_version (version) VALUES ('d93b_actor_role');
`;

/**
 * D551: feedback_log 重建表目标结构（target_type CHECK 扩 'diagnosis_conclusion'）。
 * 仅用于旧 schema 库的重建迁移（SQLite 无法 ALTER CHECK → CREATE new → INSERT SELECT → DROP → RENAME）。
 */
const FEEDBACK_LOG_DDL_D551 = `
CREATE TABLE feedback_log (
  id            TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK(decision IN ('reject','modify','reject_path','ineffective')),
  target_type   TEXT NOT NULL CHECK(target_type IN ('sentinel_alert','goal','proposal','diagnosis_conclusion')),
  target_id     TEXT NOT NULL,
  reason        TEXT DEFAULT '',
  evidence_refs TEXT DEFAULT '[]',
  actor_role    TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ═══ FeedbackCollector ═══

export class FeedbackCollector {
  private db: import('better-sqlite3').Database | null = null;

  /** 注入 SQLite 数据库实例 */
  setDatabase(db: import('better-sqlite3').Database): void {
    this.db = db;
    this.initSchema();
  }

  /** 初始化表结构 */
  private initSchema(): void {
    if (!this.db) return;
    try {
      this.db.exec(FEEDBACK_DDL);
      this.migrateD551TargetType();
      log.info('feedback_log 表就绪');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, 'feedback_log 表初始化失败 — 降级（内存模式）');
    }
  }

  /**
   * D551 migration 'd551_target_type' — feedback_log.target_type CHECK 扩 'diagnosis_conclusion'。
   *
   * SQLite 无法 ALTER CHECK → 重建表迁移（CREATE feedback_log_new → INSERT SELECT 复制 →
   * DROP → RENAME → 重建索引），机制先例 schema_version（'d93b_actor_role'，D93b）。
   * D487 教训: 扩枚举必须同步 DDL CHECK，否则 INSERT 失败——本迁移保证存量旧库同步升级。
   *
   * 契约:
   *   @input  — 无（内部读 schema_version + sqlite_master 判定）
   *   @output — 迁移后 feedback_log CHECK 含 'diagnosis_conclusion' + schema_version 含 'd551_target_type'
   *   @degraded — 迁移失败 → log.warn 不阻断启动（新值写入将被旧 CHECK 拒绝 → collectFeedback
   *               走既有 degraded 降级路径，不静默，铁律 24/31）
   */
  private migrateD551TargetType(): void {
    if (!this.db) return;
    try {
      const done = this.db.prepare(`SELECT 1 FROM schema_version WHERE version = 'd551_target_type'`).get();
      if (done) return;

      const table = this.db.prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='feedback_log'`,
      ).get() as { sql: string } | undefined;
      if (table?.sql && table.sql.includes('diagnosis_conclusion')) {
        // 新建库: FEEDBACK_DDL 已含新枚举 → 仅补版本标记，不重建
        this.db.prepare(`INSERT OR IGNORE INTO schema_version (version) VALUES ('d551_target_type')`).run();
        return;
      }

      // 旧 schema 库: 事务内重建表（复制存量数据 + 重建索引，防中途失败丢表）
      this.db.exec('BEGIN');
      try {
        this.db.exec(FEEDBACK_LOG_DDL_D551.replace('CREATE TABLE feedback_log', 'CREATE TABLE feedback_log_new'));
        this.db.exec(`
          INSERT INTO feedback_log_new (id, enterprise_id, actor_id, decision, target_type, target_id, reason, evidence_refs, actor_role, created_at)
          SELECT id, enterprise_id, actor_id, decision, target_type, target_id, reason, evidence_refs, actor_role, created_at FROM feedback_log;
        `);
        this.db.exec('DROP TABLE feedback_log');
        this.db.exec('ALTER TABLE feedback_log_new RENAME TO feedback_log');
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_feedback_enterprise ON feedback_log(enterprise_id);
          CREATE INDEX IF NOT EXISTS idx_feedback_decision ON feedback_log(decision);
          CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback_log(target_type, target_id);
        `);
        this.db.exec(`INSERT OR IGNORE INTO schema_version (version) VALUES ('d551_target_type')`);
        this.db.exec('COMMIT');
      } catch (inner: unknown) {
        this.db.exec('ROLLBACK');
        throw inner;
      }
      log.info("migration 'd551_target_type' 完成 — feedback_log.target_type 已扩 'diagnosis_conclusion'");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "migration 'd551_target_type' 失败 — 降级（新枚举写入将被旧 CHECK 拒绝，collectFeedback 走 degraded 路径）");
    }
  }

  /**
   * 收集一条中层反馈。
   *
   * @param input - 反馈输入
   * @returns FeedbackRecord（降级时 degraded:true）
   */
  collectFeedback(input: MiddleFeedbackInput): FeedbackRecord & { degraded?: boolean } {
    const now = new Date().toISOString();
    const record: FeedbackRecord = {
      id: randomUUID(),
      enterpriseId: input.enterpriseId,
      actorId: input.actorId,
      decision: input.decision,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason || '',
      evidenceRefs: JSON.stringify(input.evidenceRefs || []),
      actorRole: input.actorRole || '',
      createdAt: now,
    };

    if (!this.db) {
      log.warn({ record }, 'SQLite 未就绪 — 反馈降级（仅内存）');
      return { ...record, degraded: true };
    }

    try {
      this.db.prepare(`
        INSERT INTO feedback_log (id, enterprise_id, actor_id, decision, target_type, target_id, reason, evidence_refs, actor_role, created_at)
        VALUES (@id, @enterpriseId, @actorId, @decision, @targetType, @targetId, @reason, @evidenceRefs, @actorRole, @createdAt)
      `).run({
        id: record.id,
        enterpriseId: record.enterpriseId,
        actorId: record.actorId,
        decision: record.decision,
        targetType: record.targetType,
        targetId: record.targetId,
        reason: record.reason,
        evidenceRefs: record.evidenceRefs,
        actorRole: record.actorRole,
        createdAt: record.createdAt,
      });
      log.info({ id: record.id, decision: record.decision }, '反馈已收集');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, record }, '反馈写入 SQLite 失败 — 降级');
      return { ...record, degraded: true };
    }

    return record;
  }

  /**
   * 查询反馈记录。
   *
   * 契约（D338 fail-closed）:
   *   @input  — filters.enterpriseId 必填（缺 → 拒绝，绝不查询全局）
   *   @output — FeedbackQueryResult { entries, degraded }
   *   @degraded — 缺 enterpriseId → log.warn + {entries:[],degraded:true}；
   *               SQLite 未就绪/查询失败 → 同上（绝不返回跨企业数据）
   */
  queryFeedback(filters: FeedbackQuery): FeedbackQueryResult {
    if (!this.db) return { entries: [], degraded: true };

    if (!filters.enterpriseId) {
      log.warn({ filters }, '反馈查询拒绝 — 缺少 enterpriseId（fail-closed，不回落全局）');
      return { entries: [], degraded: true };
    }

    try {
      let sql = 'SELECT * FROM feedback_log WHERE enterprise_id = @enterpriseId';
      const params: Record<string, unknown> = { enterpriseId: filters.enterpriseId };

      if (filters.decision) {
        sql += ' AND decision = @decision';
        params.decision = filters.decision;
      }
      if (filters.targetType) {
        sql += ' AND target_type = @targetType';
        params.targetType = filters.targetType;
      }
      if (filters.targetId) {
        sql += ' AND target_id = @targetId';
        params.targetId = filters.targetId;
      }
      if (filters.since) {
        sql += ' AND created_at >= @since';
        params.since = filters.since;
      }

      sql += ' ORDER BY created_at DESC';

      if (filters.limit && filters.limit > 0) {
        sql += ' LIMIT @limit';
        params.limit = filters.limit;
      }

      const rows = this.db.prepare(sql).all(params) as Array<Record<string, unknown>>;
      const entries: FeedbackRecord[] = rows.map(r => ({
        id: r.id as string,
        enterpriseId: r.enterprise_id as string,
        actorId: r.actor_id as string,
        decision: r.decision as FeedbackDecision,
        targetType: r.target_type as FeedbackTargetType,
        targetId: r.target_id as string,
        reason: (r.reason as string) || '',
        evidenceRefs: (r.evidence_refs as string) || '[]',
        actorRole: (r.actor_role as string) || '',
        createdAt: r.created_at as string,
      }));
      return { entries, degraded: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '反馈查询失败 — 降级');
      return { entries: [], degraded: true };
    }
  }

  /**
   * 获取聚合信号（#976 / 0-2 反馈键）。
   *
   * 聚合粒度 = **per `target_id`**：同一真目标 ID（哨兵键如 `F1_KZ` / goalId / pathKey / expertKey）
   * × 同一 decision × target_type × actor_role 出现 >= threshold 次时聚合为一条 signal。
   *
   * 契约（铁律 47）:
   *   @input   threshold 聚合阈值（默认 3）
   *   @output  AggregatedSignal[]；`key` = **真 target_id**（不再是
   *            `${decision}:${target_type}:${actor_role}` 复合键）——消费者
   *            src/loops/middle-evolution-engine.ts 直接以 `key` 作 sentinelKey/goalType/
   *            pathKey/expertKey 去匹配 extensions 配置里的真键，复合键永远匹配不上
   *            （#976 实测：`_gaCorrections` 在 extensions/ 零命中，从未写过一字节）。
   *   @degraded db 缺失 / 查询异常 → log.warn + 返回 []（铁律 24+31）
   */
  getAggregatedSignals(threshold: number = 3): AggregatedSignal[] {
    if (!this.db) return [];

    try {
      // 注: 不用 GROUP_CONCAT(DISTINCT target_id, ',') —— SQLite 的 DISTINCT 聚合只接受单参数
      // （"DISTINCT aggregates must have exactly one argument"），会静默落到下方 catch → 恒空。
      // 分组已含 target_id ⇒ 每组的 targetIds 就是该 target_id 本身（单元素）。
      const rows = this.db.prepare(`
        SELECT decision, target_type, actor_role, target_id, COUNT(*) as count, MAX(created_at) as latest
        FROM feedback_log
        GROUP BY decision, target_type, actor_role, target_id
        HAVING count >= @threshold
        ORDER BY count DESC
      `).all({ threshold }) as Array<Record<string, unknown>>;

      return rows.map(r => ({
        key: r.target_id as string,
        decision: r.decision as FeedbackDecision,
        targetType: r.target_type as FeedbackTargetType,
        actorRoles: ((r.actor_role as string) || '').split(',').filter(Boolean),
        count: r.count as number,
        latestTimestamp: r.latest as string,
        targetIds: [r.target_id as string],
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '聚合信号查询失败 — 降级');
      return [];
    }
  }
}

/** 全局单例 */
export const feedbackCollector = new FeedbackCollector();

/** D262: 单例工厂 — 获取全局 FeedbackCollector 实例 */
export function getFeedbackCollector(): FeedbackCollector {
  return feedbackCollector;
}
