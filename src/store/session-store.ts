/**
 * store/session-store.ts — SQLite 会话持久化 (Era 1.3)
 *
 * 对标 Hermes hermes_state.py SessionDB:
 *   - sessions 表 + messages 表 + FTS5 全文搜索
 *   - Schema 自动创建 (幂等)
 *   - WAL 模式
 *
 * 设计决策: 独立的 SessionStore 实例，不与 engine-core 共享 DB 连接。
 * 会话数据属于 Agent 进程层，本体数据属于 engine-core 层。
 */
import Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

const log = createLogger('store/session-store');

// ═══ Types ═══

/** Raw SQLite row (P1-02: 替代 `as-any`) */
type SqliteRow = Record<string, unknown>;

// ═══ D563（CT-46/D489 验收返修）: 类型谓词导出 ═══

/**
 * better-sqlite3 Database 鸭子类型谓词 — unknown → Database.Database 窄化（替代 L1 侧 never 断言）。
 *
 * 架构位（铁律 39 + D563 返工）: 本谓词属 L5 存储层——数据库驱动类型只归 L5 所有；
 * L1（routes/diagnosis.ts）经既有动态 import 通道解构使用，不经行任何数据库层引用
 * （Architecture Check 1d: L1→L5 跨层引用零容忍，注释/消息字样同样计红）。
 *
 * 契约（铁律 47）:
 *   @input    — v: unknown（req.app.locals.orchestration.db 等运行时未类型化句柄）
 *   @output   — 类型谓词；true = 可安全传入 `new SessionStore(db)`（Database.Database）
 *   @degraded — false（非对象 / 缺关键方法）→ 调用方把谓词失败转译为 TypeError，
 *               走既有 try/catch log.warn 降级通道（铁律 24/31，行为零变化）
 *
 * 方法探测取 prepare/exec/pragma 三方法（better-sqlite3 Database 的最小读写面；
 * SessionStore.initSchema 实际只用 exec）。非断言——失败路径显式降级，不静默信任 unknown。
 */
export function isSqliteDatabase(v: unknown): v is Database.Database {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { prepare?: unknown; exec?: unknown; pragma?: unknown };
  return typeof o.prepare === 'function' && typeof o.exec === 'function' && typeof o.pragma === 'function';
}

// ═══ D593: 报告归档行（diagnosis_checkpoints phase=5）类型与结构守卫 ═══

/**
 * D593: 报告归档行 partial_report 的窄化结果类型——consult/对话桥两路线写侧的同一形状
 * （spec §5.2-A）。report 为**消费面子集内联类型**（本仓库读侧只消费 summary + 透传 +
 * onePager 渲染入口；完整 L3 DiagnosisReport 形状守卫归 L1 渲染边界——铁律 39 层内自洽，
 * 对齐 conversations.ts isEngineStateLike 只验消费字段的哲学）。
 */
export interface DiagnosisReportArchive {
  /** 归档键 = reportId（rpt_xxx，与 checkpoint session_id 同值） */
  reportId: string;
  teamId: string;
  /** 诊断完成时刻（ISO，读侧展示用；SQL 排序键为 saved_at） */
  completedAt: string;
  /** consult 路线附带（对话桥路线无该概念，spec §5.2-A） */
  consultId?: string;
  /** 落盘来源路线（'consult' | 'conversation'） */
  source?: string;
  /** 完成时渲染的一页纸；raw 深度/渲染失败为 null/缺省 → GET 按需补渲染 */
  onePager?: string | null;
  /** 完整报告对象（读侧验证 summary 消费字段；其余字段透传渲染层自查） */
  report: { summary: string } & Record<string, unknown>;
}

/**
 * D593: checkpoint partial_report 报告归档行结构守卫——JSON.parse 结果不盲信
 * （铁律 38：类型守卫替代断言，对齐 conversations.ts isEngineStateLike 形态）。
 *
 * 架构位（铁律 39 + D563 先例）: 本谓词属 L5 存储层——checkpoint 行内容归存储层解释；
 * L1（routes/diagnosis.ts 列表端点 / GET report 冷读 fallback）经既有动态 import 通道
 * 解构使用，不经行任何 L5 静态引用。
 *
 * 契约（铁律 47）:
 *   @input    — v: unknown（JSON.parse(partial_report) 结果，形状不可信）
 *   @output   — 类型谓词；true = 可安全作为 DiagnosisReportArchive 消费（读侧消费字段已验证）
 *   @degraded — false（非对象/缺关键字段/字段类型不符）→ 调用方 log.warn + 跳过该行或 404
 *              （诚实降级，不静默，铁律 24）
 */
export function isDiagnosisReportArchive(v: unknown): v is DiagnosisReportArchive {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.reportId !== 'string' || o.reportId.length === 0) return false;
  if (typeof o.teamId !== 'string') return false;
  if (typeof o.completedAt !== 'string') return false;
  if (o.consultId !== undefined && typeof o.consultId !== 'string') return false;
  if (o.source !== undefined && typeof o.source !== 'string') return false;
  if (o.onePager !== undefined && o.onePager !== null && typeof o.onePager !== 'string') return false;
  // report 对象：读侧消费字段 = summary（列表/降级文案）；其余字段由渲染层完整形状守卫把关
  const r = o.report;
  if (typeof r !== 'object' || r === null) return false;
  if (typeof (r as Record<string, unknown>).summary !== 'string') return false;
  return true;
}

export interface SessionRow {
  id: string;
  orgId: string;
  phase: number;
  stateJson: string | null;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: number;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SearchResult {
  sessionId: string;
  orgId: string;
  messageCount: number;
  snippet: string;
  updatedAt: string;
}

export interface ConversationState {
  orgId: string;
  phase: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  startedAt: string;
  /**
   * #1075 P2-2（additive，可选）：会话**绑定的岗位 id**（`EngineState.rolePackId` 的落库形态）。
   *
   * 口径：只存"岗位归属"，**人设文本不落库** —— 每轮由
   * `src/init/role-pack-persona.ts` 的 `loadRolePackPersona()` 从磁盘重解析（审批态/内容变更即时生效）。
   * 无岗位绑定的既有会话：该键**缺省**（不是 `null`）⇒ 读路径逐字不变。
   */
  rolePackId?: string;
}

// ═══ D500: 事件溯源类型 ═══

/**
 * 事件词表（**v1 单一真源**，#964 Q-7）。
 *
 * 事件类型（surface 事件 = 投影到消息历史的；log-only 事件 = 仅审计）。
 * D487: 新增诊断事件三类——GA 诊断过程落 session_events 可回放；
 * deriveMessages 投影跳过（log-only，不污染消息历史）。
 *
 * 🔴 新增/删除类目必须同批 bump `SESSION_EVENT_FORMAT_VERSION`，否则
 * `tests/store/session-event-log.test.ts` 的词表冻结用例先红（禁悄悄扩词表）。
 */
export const SESSION_EVENT_TYPES = [
  'message',
  'tool_result',
  'system',
  'diagnosis_phase',
  'diagnosis_module',
  'diagnosis_report',
] as const;

/** 事件类型（由词表常量派生 —— 词表唯一真源，禁第二处手写联合） */
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

/**
 * 事件行格式版本（**读侧 fail-closed**，#964 Q-7）。
 * 写侧恒写当前版本；读侧遇更高版本（旧构建读新库）⇒ `EVENT_FORMAT_TOO_NEW`，
 * 绝不按旧格式猜测解码（对齐 DSH storage-contract 的 version gate）。
 */
export const SESSION_EVENT_FORMAT_VERSION = 1;

/** 事件流 typed error 码（铁律 32：code/phase/retryable 可分类） */
export type SessionEventErrorCode = 'UNKNOWN_EVENT_TYPE' | 'EVENT_FORMAT_TOO_NEW' | 'SESSION_EVENT_LIMIT';

/** 事件流 typed error —— 词表/格式版本违约走**抛错**（不是 degraded 返回值） */
export class SessionEventError extends Error {
  readonly code: SessionEventErrorCode;
  readonly phase: 'validate' | 'read';
  readonly retryable = false;

  constructor(code: SessionEventErrorCode, phase: 'validate' | 'read', message: string) {
    super(message);
    this.name = 'SessionEventError';
    this.code = code;
    this.phase = phase;
  }
}

/**
 * 会话事件数上限（#991 Q-12「上限即纪律」· 裁 407 A 组 ／ 裁 411）
 *
 * 出生证（裁 407 · 本能力＝「单会话事件数上限」；七格）:
 *   ① 拥有什么：给「一个会话能追加多少条事件」一个**显式上限**，超限在**写库前**拒单条。
 *   ② 不拥有什么：不做轮转/归档/压缩（另立卡）；不做跨会话或跨租户配额；不删既有行。
 *   ③ 为什么这样设计：事件表 append-only 且 seq 单调 ⇒ `MAX(seq)+1` 本身就是「下一条的序号」，
 *      拿它当计数**零额外查询**；若改用 `COUNT(*)`，每次写都随会话变长退化成 O(n)。
 *   ④ 失败形态：抛 `SessionEventError{SESSION_EVENT_LIMIT, phase:'validate', retryable:false}`
 *      —— **拒单条、不断会话**：会话本身与既有事件不受影响，调用方可用新会话继续；
 *      **不折成 degraded、不静默丢**（catch 里对 typed error 显式 rethrow）。
 *   ⑤ 上限：默认 **20000** 条/会话；`SYNO_MAX_SESSION_EVENTS` 可配，clamp 到 [1, 1000000]
 *      （沿裁 219 模板：`Math.min(上界, Math.max(1, parseInt(env) || 默认))`
 *      —— 未配/非数/0 ⇒ 回落默认，**负数 ⇒ 下界 1**，超上界 ⇒ 夹到 CEILING）。
 *      为什么是 20000：本仓 `session_events` 实测 0 行（`SELECT COUNT(*)`＝0，无存量分布可依）
 *      ⇒ 取「10 事件/日 × 5 年 ≈ 1.8 万」的保守上界，同时把「重试风暴/循环追加」这类真异常
 *      挡在 2 万条（≈ 单会话 ≤ ~40MB @2KB/条）。判据形态＝**配对测试**（两态＋改坏必红），
 *      不新增 checker 脚本或 CI 步（裁 402 净增=0）。
 *   ⑥ 已知限制：额度按 seq 计，**物理删行不回收额度**；对**已超限的存量会话**立即生效（补不进）；
 *      `SYNO_SESSION_EVENT_STRICT=0` 只回滚词表/格式版本校验，**不回滚本上限**（两条闸独立）。
 *   ⑦ 借用边界：借鉴 `dsh@687f282e86:packages/jobs/jobs-local/src/index.ts:220`（每 owner 并发上限
 *      ⇒ 超限抛错并给**可执行指引**「job_kill / 等完成再重试」）与
 *      `.../attachment/attachment/src/index.ts:77`（数量上限 ⇒ `TOO_MANY_IMAGES` 稳定码）；
 *      不借其「每 owner 并发」的多租户维度（我们只有会话内 seq 一条轴，跨会话配额另立卡）；
 *      我们改：把可执行指引落在**配置项＋新开会话**上，并把计数挂在既有 seq 上（DSH 是独立计数器）。
 */
export const DEFAULT_MAX_SESSION_EVENTS = 20_000;

/** 上限硬上界（防误配天文数字把闸变成空闸） */
export const MAX_SESSION_EVENTS_CEILING = 1_000_000;

/**
 * 解析本进程生效的事件数上限（逐调用读取 ⇒ 可测试注入；clamp 而非裸用，裁 219 字面模板）。
 * 模板同形：`src/agent/tool-loop-executor.ts:183`
 *   `Math.min(10, Math.max(1, Number.parseInt(process.env.SYNO_MAX_TOOL_ROUNDS ?? '', 10) || 3))`
 * @input  无（读 `process.env.SYNO_MAX_SESSION_EVENTS`）
 * @output 正整数上限：未配/非数/0 ⇒ `DEFAULT_MAX_SESSION_EVENTS`；负数 ⇒ 下界 1；
 *         > `MAX_SESSION_EVENTS_CEILING` ⇒ clamp 到 CEILING；其余原样
 * @degraded 不适用（纯解析，无 IO、无 catch 分支）
 */
export function maxSessionEvents(): number {
  const raw =
    Number.parseInt(process.env.SYNO_MAX_SESSION_EVENTS ?? '', 10) || DEFAULT_MAX_SESSION_EVENTS;
  return Math.min(MAX_SESSION_EVENTS_CEILING, Math.max(1, raw));
}

/**
 * 运行时词表守卫（DB CHECK 只兜 SQL 面；API 入参 / 旧库行 / 直连 SQL 都要过这一道）。
 * @input  value — 未知（调用方可能是 JS/动态值）
 * @output 类型谓词；true = 可安全当作 SessionEventType
 */
export function isSessionEventType(value: unknown): value is SessionEventType {
  return typeof value === 'string' && (SESSION_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * 严格模式开关（**默认开**；`SYNO_SESSION_EVENT_STRICT=0` ⇒ 回滚旧 degraded 行为）。
 * 逐调用读取（可测试注入）；关闭时按铁律 11 留痕一次，不静默。
 */
function isSessionEventStrict(): boolean {
  return process.env.SYNO_SESSION_EVENT_STRICT !== '0';
}

let strictDisabledWarned = false;

function warnStrictDisabled(where: string): void {
  if (strictDisabledWarned) return;
  strictDisabledWarned = true;
  log.warn(
    { degraded: true, component: 'store/session-store', code: 'SESSION_EVENT_STRICT_DISABLED', where },
    'SYNO_SESSION_EVENT_STRICT=0 — 事件词表/格式版本校验降级为旧行为（回滚态）',
  );
}

/** session_events 表行 */
export interface SessionEvent {
  id: number;
  sessionId: string;
  seq: number;
  eventType: SessionEventType;
  payloadJson: string;
  /** 行格式版本（老库升级后历史行 = 1） */
  formatVersion: number;
  createdAt: string;
}

/** appendEvent 结果契约（铁律 24/31: 失败显式降级） */
export type AppendEventResult =
  | { ok: true; seq: number }
  | { ok: false; degraded: true; error: string };

/**
 * R-E1 ①: `addMessage` 结果契约（铁律 47）。
 *
 * `{ok:true, seq}` = 消息行与事件行**已整笔落账**（事务态）／已按旧路径落账（回滚态）；
 * `{ok:false, degraded:true, error}` = appendEvent 折成 degraded ⇒ 事务态下**整笔已回滚**。
 * 返回值是 **additive**：既有 11+1 处调用方全部忽略返回值 ⇒ 源码零改动（设计稿 §2.1）。
 */
export type AddMessageResult =
  | { ok: true; seq: number }
  | { ok: false; degraded: true; error: string };

// ═══ R-E1（#1165）: 事务 / seq 原子 / busy_timeout 的开关与阈值 ═══

/**
 * R-E1 ①: 消息双写事务开关（默认开；`SYNO_SESSION_TX=0` ⇒ 回旧行为）。
 *
 * 回旧行为 = 三条独立语句（消息行**不**回滚）。逐调用读取（可测试注入）。
 * 为何必须有开关：事务化把"消息落了、事件没落"的静默半截改成"整笔回滚"，
 * 错误面变化必须留回滚路径（规格 §4.1「回滚开关」）。
 */
function isSessionTxEnabled(): boolean {
  return process.env.SYNO_SESSION_TX !== '0';
}

/**
 * R-E1 ②: seq 单语句原子分配开关（默认开；`SYNO_SESSION_SEQ_ATOMIC=0` ⇒ 回旧"读后写"）。
 *
 * 旧路径单线程仍得 1..N；多进程下会撞 `UNIQUE(session_id,seq)` ⇒ degraded，
 * 正是本批要修的洞（P5 实测 1936/2000、64 degraded）。逐调用读取。
 */
function isSessionSeqAtomicEnabled(): boolean {
  return process.env.SYNO_SESSION_SEQ_ATOMIC !== '0';
}

/** R-E1 ②: 默认 busy_timeout（毫秒）——SQLite 跨进程写等待窗（L1 裁定 3） */
export const DEFAULT_SESSION_BUSY_TIMEOUT_MS = 5_000;

/** R-E1 ②: busy_timeout 硬上界（防误配天文数字把"等待"变成"挂死"） */
export const MAX_SESSION_BUSY_TIMEOUT_MS = 60_000;

/**
 * 解析本连接生效的 busy_timeout（**逐构造读取**，clamp [1, 60000]，L1 裁定 3）。
 *
 * 模板同 `maxSessionEvents()`（裁 219 字面模板）：未配/非数/0 ⇒ 默认 5000；
 * 负数 ⇒ 下界 1；超上界 ⇒ 夹到 `MAX_SESSION_BUSY_TIMEOUT_MS`；其余原样。
 * @input  无（读 `process.env.SYNO_SESSION_BUSY_TIMEOUT_MS`）
 * @output 正整数毫秒
 * @degraded 不适用（纯解析，无 IO、无 catch 分支）
 */
export function sessionBusyTimeoutMs(): number {
  const raw =
    Number.parseInt(process.env.SYNO_SESSION_BUSY_TIMEOUT_MS ?? '', 10) || DEFAULT_SESSION_BUSY_TIMEOUT_MS;
  return Math.min(MAX_SESSION_BUSY_TIMEOUT_MS, Math.max(1, raw));
}

/**
 * R-E1 ①: `addMessage` 事务体内的**内部哨兵**（typed，带 `code`；**不导出**）。
 *
 * 为什么需要它：`appendEvent` 已把 I/O 失败折成 `{ok:false,degraded:true}` 返回值
 * （它的契约不变、不感知事务），而事务体只有"抛"才能触发 ROLLBACK ⇒
 * 事务体内把该返回值转成本哨兵抛出，外层 catch 再转回 degraded 返回值。
 * typed（`SESSION_EVENT_LIMIT`/`UNKNOWN_EVENT_TYPE`）/ SQL 错**不经**本哨兵（原样抛）。
 * 边界：本类永不逃出 `addMessage` ⇒ 不纳入导出的 `SessionEventErrorCode` 词表。
 */
class AppendEventDegradedError extends Error {
  readonly code = 'APPEND_EVENT_DEGRADED';
  readonly reason: string;

  constructor(reason: string) {
    super(`appendEvent 已降级（事务回滚）: ${reason}`);
    this.name = 'AppendEventDegradedError';
    this.reason = reason;
  }
}

/** 取 unknown 错误的字符串 `code`（零断言：`in` 窄化后判类型，缺省空串） */
function errorCodeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = err.code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/**
 * R-E1 ②: 是否「冲突类」错误（可重试 1 次）。
 *
 * `UNIQUE(session_id,seq)` 冲突（并发同 seq）／`SQLITE_BUSY`（写锁未获）⇒ 重试一次
 * （设计稿 §2.2；**禁止无限重试**）。第二次仍失败 ⇒ 交外层折 degraded（铁律 24/31）。
 */
function isRetryableSeqError(err: unknown): boolean {
  const code = errorCodeOf(err);
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(msg) || /database is locked|SQLITE_BUSY/i.test(msg);
}

/**
 * R-E1 ②: 「事件数上限」typed error（消息保留既有 `SYNO_MAX_SESSION_EVENTS`／`新开一个会话`
 * 子串 —— `tests/store/session-events-limit.test.ts` 据此断言可执行指引，禁改文案骨架）。
 */
function sessionEventLimitError(cap: number, nextSeq: number): SessionEventError {
  return new SessionEventError(
    'SESSION_EVENT_LIMIT',
    'validate',
    `会话事件数已达上限 ${cap}（下一条 seq=${nextSeq}）；` +
      `可用 SYNO_MAX_SESSION_EVENTS 调整（默认 ${DEFAULT_MAX_SESSION_EVENTS}，范围 1-${MAX_SESSION_EVENTS_CEILING}），` +
      `或新开一个会话继续 —— 本条被拒，会话与既有事件不受影响。`,
  );
}

// ═══ SessionStore ═══

export class SessionStore {
  private db: Database.Database;

  /**
   * D500 / C5: 降级信号传播（铁律 31）——appendEvent 双写失败时置 true，
   * 调用方（SessionManager model-visible⟺logged 断言 / 路由 `STORE_DEGRADED` 帧）检查。
   *
   * 🔴 C5（spec §9.2，R-E1）: 语义为「**本轮累积**」而非「本次调用结果」——
   *   任何失败（degraded 返回或抛错）置 true 并**保持**；**只有一次成功的 `role='user'`
   *   写入**才清闩（轮边界＝新轮起点）；`assistant`/`system` 成功**不清**。
   *   旧语义（"后一次成功即重置"）会让同轮 `:734` 的 assistant 成功把 `:720` 的 user
   *   失败抹掉，路由 `conversations.ts:757` 就看不见降级（院方 P1-2 的洞）。
   *   已知限制：闩是 **store 级**（同一实例共享）；只有 system/assistant 写入的会话，
   *   降级会保持到下一次 user 写入。
   */
  lastDegraded = false;

  constructor(db: Database.Database) {
    this.db = db;
    // R-E1 ②（L1 裁定 3）: 跨进程 SQLITE_BUSY 需要显式等待窗。better-sqlite3 自带默认值，
    // 但本仓从未显式设过 ⇒ 显式设 + 可配 + 可测试注入（逐构造读取，clamp [1, 60000]）。
    // 已知限制：DB 连接级设置，影响该连接的全部使用者。
    this.db.pragma(`busy_timeout = ${sessionBusyTimeoutMs()}`);
    this.initSchema();
  }

  // ═══ Schema ═══

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT,
        phase INTEGER DEFAULT 0,
        state_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- M1-Slice2: user_id migration for existing databases (idempotent via try-catch below)
      -- D251: title column migration (idempotent via try-catch)

      CREATE TABLE IF NOT EXISTS agent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_agent_msg_session ON agent_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_session_org ON agent_sessions(org_id);

      -- FTS5 全文搜索 (支持中文)
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_messages_fts USING fts5(
        session_id UNINDEXED,
        content,
        tokenize='unicode61'
      );

      -- D500: 事件溯源 append-only 事件流（会话唯一事实源）
      -- seq 单调 + UNIQUE(session_id, seq) 物理防并发 seq 重复（2026-08-22 缺陷①防线）
      -- D487: CHECK 扩展诊断事件三类（旧库经下方表重建迁移升级，CREATE IF NOT EXISTS 不更新已有约束）
      -- #964 Q-7: format_version 行格式版本（老库经下方 PRAGMA 判缺 + ALTER 幂等升级）
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('message','tool_result','system','diagnosis_phase','diagnosis_module','diagnosis_report')),
        payload_json TEXT NOT NULL,
        format_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_session_events_sess ON session_events(session_id, seq);
    `);

    // #964 Q-7: 老库升级 —— `session_events` 无 format_version 列 ⇒ PRAGMA 判缺 + ALTER ADD COLUMN。
    // 🔴 裁 395：必须幂等且**不吞错**。这里不靠 `try/catch` 分流（ADD COLUMN 对"列已存在"会抛，
    //    用异常当控制流 = 把真实错误一起吞掉）⇒ 先 PRAGMA 判存在性，再执行 ALTER；ALTER 失败原样上抛。
    const eventColumns = this.db.prepare('PRAGMA table_info(session_events)').all() as Array<{ name: string }>;
    if (!eventColumns.some((column) => column.name === 'format_version')) {
      this.db.exec('ALTER TABLE session_events ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1');
      log.info('session_events 补 format_version 列（老库升级；历史行按 DEFAULT 1 视作 v1）');
    }

    // D487: 旧库 session_events CHECK 约束升级 — ALTER 不支持修改 CHECK，
    // 幂等表重建（仅当现有建表 SQL 缺 diagnosis_phase 时执行；BEGIN/COMMIT 保证原子）
    try {
      const tpl = this.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'"
      ).get() as { sql?: string } | undefined;
      if (tpl?.sql && !tpl.sql.includes('diagnosis_phase')) {
        this.db.exec('BEGIN');
        try {
          this.db.exec(`
            CREATE TABLE session_events_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
              seq INTEGER NOT NULL,
              event_type TEXT NOT NULL CHECK(event_type IN ('message','tool_result','system','diagnosis_phase','diagnosis_module','diagnosis_report')),
              payload_json TEXT NOT NULL,
              format_version INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(session_id, seq)
            );
            INSERT INTO session_events_new (id, session_id, seq, event_type, payload_json, format_version, created_at)
              SELECT id, session_id, seq, event_type, payload_json, format_version, created_at FROM session_events;
            DROP TABLE session_events;
            ALTER TABLE session_events_new RENAME TO session_events;
            CREATE INDEX IF NOT EXISTS idx_session_events_sess ON session_events(session_id, seq);
          `);
          this.db.exec('COMMIT');
          log.info('session_events CHECK 约束已升级 — 诊断事件类型启用 (D487)');
        } catch (migErr) {
          this.db.exec('ROLLBACK');
          throw migErr;
        }
      }
    } catch (err) {
      log.warn({ err }, 'session_events 诊断事件约束迁移失败 — degraded（旧库继续用三事件类型）');
    }

    // 诊断检查点表
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS diagnosis_checkpoints (
        session_id TEXT NOT NULL, phase INTEGER DEFAULT 0,
        completed_modules TEXT DEFAULT '[]', partial_report TEXT DEFAULT 'null',
        saved_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, phase)
      )`);
    } catch (err) { log.debug({ err }, '会话表已存在 — 跳过创建'); }

    // M1-Slice2: 迁移旧数据库 (添加 user_id 列，幂等)
    try { this.db.exec('ALTER TABLE agent_sessions ADD COLUMN user_id TEXT'); } catch { log.debug('user_id 列已存在 — 跳过迁移'); }

    // FTS5 同步触发器 (幂等——触发器已存在时报错忽略)
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS agent_msg_fts_insert AFTER INSERT ON agent_messages BEGIN
        INSERT INTO agent_messages_fts(session_id, content) VALUES (new.session_id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_msg_fts_delete AFTER DELETE ON agent_messages BEGIN
        INSERT INTO agent_messages_fts(agent_messages_fts, session_id, content) VALUES ('delete', old.session_id, old.content);
      END;
    `);
  }

  // ═══ Sessions ═══

  createSession(orgId: string, userId?: string): SessionRow {
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; // nosec: nonce for session ID
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO agent_sessions (id, org_id, user_id, phase, created_at, updated_at) VALUES (?,?,?,0,?,?)')
      .run(id, orgId, userId || null, now, now);
    return this.getSession(id)!;
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(id) as SqliteRow | undefined;
    if (!row) return null;
    return {
      id: row.id as string, orgId: row.org_id as string, phase: row.phase as number,
      stateJson: row.state_json as string | null, createdAt: row.created_at as string, updatedAt: row.updated_at as string,
    };
  }

  updateSession(id: string, updates: { phase?: number }): void {
    const now = new Date().toISOString();
    if (updates.phase !== undefined) {
      this.db.prepare('UPDATE agent_sessions SET phase=?, updated_at=? WHERE id=?')
        .run(updates.phase, now, id);
    }
  }

  /** D251: 重命名会话——设置 title。自动处理 ALTER TABLE 迁移。 */
  renameSession(id: string, title: string): boolean {
    try {
      // 安全迁移: 尝试添加 title 列 (已存在则忽略)
      try { this.db.exec("ALTER TABLE agent_sessions ADD COLUMN title TEXT DEFAULT ''"); } catch (err) {
        log.warn({ err }, 'title 列迁移 — 列已存在');
      }
      this.db.prepare('UPDATE agent_sessions SET title=?, updated_at=? WHERE id=?')
        .run(title, new Date().toISOString(), id);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, '重命名会话失败');
      return false;
    }
  }

  listSessions(limit = 20): SessionRow[] {
    const rows = this.db.prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM agent_messages WHERE session_id=s.id) as msg_count FROM agent_sessions s ORDER BY s.updated_at DESC LIMIT ?'
    ).all(limit) as SqliteRow[];
    return rows.map(r => ({
      id: r.id as string, orgId: r.org_id as string, phase: r.phase as number,
      stateJson: r.state_json as string | null, title: r.title as string | undefined,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }));
  }

  /** 列出有诊断状态的会话 (state_json IS NOT NULL), Gear6 知识提取使用 */
  listSessionsWithState(limit = 10): SessionRow[] {
    const rows = this.db.prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM agent_messages WHERE session_id=s.id) as msg_count FROM agent_sessions s WHERE s.state_json IS NOT NULL ORDER BY s.updated_at DESC LIMIT ?'
    ).all(limit) as SqliteRow[];
    return rows.map(r => ({
      id: r.id as string, orgId: r.org_id as string, phase: r.phase as number,
      stateJson: r.state_json as string | null, title: r.title as string | undefined,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }));
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM agent_messages WHERE session_id=?').run(id);
    this.db.prepare('DELETE FROM agent_sessions WHERE id=?').run(id);
  }

  // ═══ Messages ═══

  /**
   * D500 / R-E1 ①: 消息写入（双写——agent_messages 兼容 + session_events 事件流下沉）。
   *
   * 契约（铁律 47）:
   *   @input    — sessionId, role, content
   *   @output   — `AddMessageResult`：`{ok:true, seq}` ｜ `{ok:false, degraded:true, error}`
   *               （**additive**：既有 11+1 处调用方全部忽略返回值 ⇒ 源码零改动）
   *   @degraded — appendEvent 折成 degraded ⇒（事务态）**整笔回滚** ＋ `lastDegraded=true`
   *               ＋ `log.error` ＋ 返回 degraded（**不抛**，铁律 24/31）
   *   @error    — appendEvent 抛 typed（`SESSION_EVENT_LIMIT`/`UNKNOWN_EVENT_TYPE`）或
   *               INSERT/UPDATE 的 SQL 错 ⇒（事务态）回滚后**原样抛出**（保持调用方既有抛错面；
   *               半截行不再残留 —— 这正是 P3 实测的洞）
   *   @rollback — `SYNO_SESSION_TX=0` ⇒ 旧行为（三条独立语句，消息行不回滚）
   *   @authority — 仅本进程持 store 实例者调用；**事务体内禁止 `await`**（better-sqlite3 同步）
   *   @not-here — 不做会话数配额/归档压缩；不改调用方对抛错的处置（11+1 处逐处实测，设计稿 §2.1 表）
   *
   * C5（spec §9.2）: 闩锁语义见 `lastDegraded` 字段注释——失败置闩并保持，
   * **只有成功的 `role='user'` 写入**才清闩（轮边界）；`assistant`/`system` 成功不清。
   *
   * 双写下沉决策（2026-08-22）: 11 处 `store.addMessage` ＋ 1 处 `SessionManager` 封装
   * （设计稿 §2.1 逐处实测）经本方法写入，自动获得事件流，无需逐个修改调用方。
   */
  addMessage(sessionId: string, role: MessageRow['role'], content: string): AddMessageResult {
    // 🔴 时间戳只取**一次**（事务态与回滚态共用）：`tests/contract/time-injection.test.ts` 的
    // 时种棘轮按**字面计数**（注释里的同形文本也计入）冻结本文件为 [1,5] ⇒ 禁逐分支各取一次
    // （会 +1 变红），也禁改成 NOW 形态（NOW 计数同样被冻结）。
    const updatedAt = new Date().toISOString();
    try {
      const result = this.writeMessage(sessionId, role, content, updatedAt);
      if (result.ok) {
        // C5: 只有「新轮起点」（成功的 user 写入）清闩；assistant/system 成功**不清**
        if (role === 'user') this.lastDegraded = false;
        return result;
      }
      log.error(
        { sessionId, role, error: result.error, degraded: true },
        'appendEvent 双写失败 — model-visible⟺logged 断裂（事务态整笔回滚）',
      );
      this.lastDegraded = true;
      return result;
    } catch (err) {
      // P3 的第二个洞：抛错路径同样必须置位（旧实现只在 degraded 返回值时置位）
      this.lastDegraded = true;
      throw err;
    }
  }

  /**
   * R-E1 ①: `addMessage` 主体——事务态／回滚态两分支（同步，无 await）。
   *
   * 事务态：`db.transaction` 包 `INSERT agent_messages` → `appendEvent('message')` →
   * `UPDATE agent_sessions.updated_at`；appendEvent 降级 ⇒ 抛内部哨兵触发 ROLLBACK，
   * 本方法把它转回 degraded 返回值；typed/SQL 错 ⇒ 回滚后原样抛。
   * 回滚态（`SYNO_SESSION_TX=0`）：逐字复刻改造前的三条独立语句。
   *
   * 已知限制：事务体用 better-sqlite3 `db.transaction`（同步；嵌套时自动 SAVEPOINT），
   * 不自写 `BEGIN`——避免"已在外层事务"时炸（设计稿 §2.1 实现要点 1）。
   */
  private writeMessage(
    sessionId: string,
    role: MessageRow['role'],
    content: string,
    updatedAt: string,
  ): AddMessageResult {
    if (!isSessionTxEnabled()) {
      return this.writeMessageSequential(sessionId, role, content, updatedAt);
    }
    const writeAll = this.db.transaction((): number => {
      this.db.prepare('INSERT INTO agent_messages (session_id, role, content) VALUES (?,?,?)')
        .run(sessionId, role, content);
      // D500: 事件流双写（append-only，model-visible⟺logged 根基）
      const res = this.appendEvent(sessionId, 'message', { role, content });
      // appendEvent 的契约不变（自己折 degraded）⇒ 这里用内部哨兵把"降级"变成"回滚"
      if (!res.ok) throw new AppendEventDegradedError(res.error);
      this.db.prepare('UPDATE agent_sessions SET updated_at=? WHERE id=?')
        .run(updatedAt, sessionId);
      return res.seq;
    });
    try {
      return { ok: true, seq: writeAll() };
    } catch (err) {
      if (err instanceof AppendEventDegradedError) {
        return { ok: false, degraded: true, error: err.reason };
      }
      throw err; // typed（SESSION_EVENT_LIMIT / UNKNOWN_EVENT_TYPE）/ SQL 错：回滚后原样抛
    }
  }

  /** `SYNO_SESSION_TX=0` 回滚态：旧三条独立语句（与改造前逐字同形；消息行不回滚）。 */
  private writeMessageSequential(
    sessionId: string,
    role: MessageRow['role'],
    content: string,
    updatedAt: string,
  ): AddMessageResult {
    this.db.prepare('INSERT INTO agent_messages (session_id, role, content) VALUES (?,?,?)')
      .run(sessionId, role, content);
    const res = this.appendEvent(sessionId, 'message', { role, content });
    this.db.prepare('UPDATE agent_sessions SET updated_at=? WHERE id=?')
      .run(updatedAt, sessionId);
    return res.ok ? { ok: true, seq: res.seq } : { ok: false, degraded: true, error: res.error };
  }

  /**
   * D500: append-only 事件写入。
   * 契约（铁律 47 — 契约优先）:
   *   @input  — sessionId, eventType, payload（payload 序列化为 JSON 存 payload_json）
   *   @output — { ok: true, seq } | { ok: false, degraded: true, error }（写入失败显式降级，铁律 24/31）
   *   @error  — UNIQUE(session_id, seq) 冲突 → log.error + degraded（并发防线，seq 不重放）
   *   崩溃恢复: 续写基于 SELECT MAX(seq)（持久化 lastSeq），禁止内存 seq 回退（2026-08-22 缺陷②防线）
   *   seq 单调: 基于持久化 MAX(seq)+1，无内存计数器（缺陷①防线）
   *
   * #964 Q-7 契约变更（裁 395）:
   *   未知 eventType ⇒ **抛** `SessionEventError('UNKNOWN_EVENT_TYPE')`（strict 默认开）；
   *   `SYNO_SESSION_EVENT_STRICT=0` ⇒ 回滚旧行为（返回 degraded，不抛，warn 一次）。
   *   I/O 失败（SQL/约束）仍走 degraded 返回值（铁律 24/31 不变）。
   *
   * #991 Q-12 契约变更（裁 411 · 上限即纪律）:
   *   下一条 seq > `maxSessionEvents()`（默认 20000，`SYNO_MAX_SESSION_EVENTS` 可配）⇒
   *   **写库前抛** `SessionEventError('SESSION_EVENT_LIMIT','validate')` —— 拒单条、不断会话；
   *   本上限**独立于** `SYNO_SESSION_EVENT_STRICT`（关词表校验不回滚上限）。
   *
   * R-E1 ② 契约变更（#1165，本批）:
   *   seq 分配改为**单语句原子**（`INSERT…SELECT COALESCE(MAX(seq),0)+1 … HAVING … RETURNING seq`）
   *   —— 跨进程不再有"读后写"窗口（P5 实测旧路径 20 进程×100 ⇒ 1936/2000、64 degraded）。
   *   `UNIQUE(session_id,seq)` 或 `SQLITE_BUSY` ⇒ **重试 1 次**（幂等，禁止无限重试）；
   *   第二次仍失败 ⇒ 照旧折 degraded 返回（铁律 24/31，不静默）。
   *   回滚开关 `SYNO_SESSION_SEQ_ATOMIC=0` ⇒ 回旧"SELECT MAX 后 INSERT"（逐调用读取）。
   *   已知限制：`RETURNING` 需 SQLite ≥ 3.35（本仓实测 3.53.2）；cap 拒单时多一次只读
   *   `SELECT MAX(seq)` 仅用于错误文案报真实 nextSeq（不进热路径）。
   */
  appendEvent(sessionId: string, eventType: SessionEventType, payload: unknown): AppendEventResult {
    // 词表 fail-closed：必须在 try 之前（否则会被下面的 catch 折成 degraded = 旧病复发）
    if (!isSessionEventType(eventType)) {
      if (isSessionEventStrict()) {
        throw new SessionEventError(
          'UNKNOWN_EVENT_TYPE',
          'validate',
          `未知事件类型 ${JSON.stringify(eventType)}；合法词表 v1 = ${SESSION_EVENT_TYPES.join('|')}`,
        );
      }
      warnStrictDisabled('appendEvent');
      this.lastDegraded = true; // C5: 任一写入降级 ⇒ 置闩（不是只有 addMessage 一条路）
      return { ok: false, degraded: true, error: `unknown event type: ${String(eventType)}` };
    }
    try {
      const payloadJson = JSON.stringify(payload);
      const seq = isSessionSeqAtomicEnabled()
        ? this.insertEventAtomic(sessionId, eventType, payloadJson)
        : this.insertEventReadThenWrite(sessionId, eventType, payloadJson);
      return { ok: true, seq };
    } catch (err) {
      // typed error 必须原样抛：折成 degraded 就等于「静默丢事件」，正是 Q-12 要治的形态
      if (err instanceof SessionEventError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ sessionId, eventType, error: msg, degraded: true }, 'appendEvent 写入失败 — degraded');
      // C5（spec §9.2）: 任一写入降级 ⇒ 置闩（含 BUSY/UNIQUE 重试后仍失败、直连 appendEvent 的调用方）
      this.lastDegraded = true;
      return { ok: false, degraded: true, error: msg };
    }
  }

  /**
   * R-E1 ②: **单语句原子分配** —— seq 的唯一正确写法（跨进程）。
   *
   * `INSERT…SELECT COALESCE(MAX(seq),0)+1 … WHERE session_id=?`：`MAX(seq)` 与 INSERT
   * 在同一条语句内求值 ⇒ 不存在"读到 MAX=5 再写 6 时别人已写 6"的窗口。
   * `HAVING … <= ?`：cap 超限时语句**不插入**、`RETURNING` 无行（实测 SQLite 3.53.2）
   *   ⇒ 抛 `SESSION_EVENT_LIMIT`（写库前拒，Q-12 语义不变；错误文案报真实 nextSeq）。
   * 冲突/BUSY ⇒ 重试 1 次（第二次的 `MAX(seq)` 会重新求值，天然幂等恢复）。
   *
   * @input   sessionId, eventType, payloadJson（已序列化）
   * @output  成功写入的 seq（≥1）
   * @error   `SESSION_EVENT_LIMIT`（cap 超限）｜ 两次仍冲突/BUSY 的原生 SQLite 错（交外层折 degraded）
   */
  private insertEventAtomic(sessionId: string, eventType: SessionEventType, payloadJson: string): number {
    const cap = maxSessionEvents();
    const stmt = this.db.prepare(
      `INSERT INTO session_events (session_id, seq, event_type, payload_json, format_version)
       SELECT ?, COALESCE(MAX(seq),0)+1, ?, ?, ? FROM session_events WHERE session_id=?
       HAVING COALESCE(MAX(seq),0)+1 <= ?
       RETURNING seq`,
    );
    // 至多重试 1 次：`for (;;)` 内每条路径都 return 或 throw ⇒ 无"看似返回 undefined"的落空分支
    let retried = false;
    for (;;) {
      try {
        const row = stmt.get(
          sessionId,
          eventType,
          payloadJson,
          SESSION_EVENT_FORMAT_VERSION,
          sessionId,
          cap,
        ) as { seq?: number } | undefined;
        if (row === undefined) {
          // HAVING 过滤 = 下一条 seq 超过 cap ⇒ **未插入**（不是"插入后被删"）
          throw sessionEventLimitError(cap, this.readMaxSeq(sessionId) + 1);
        }
        return Number(row.seq);
      } catch (err) {
        if (err instanceof SessionEventError) throw err;
        // 只有**冲突类**错误才重试，且只重试一次（设计稿 §2.2；禁止无限重试）
        if (retried || !isRetryableSeqError(err)) throw err;
        retried = true;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          { sessionId, eventType, attempt: 2, error: msg, degraded: true },
          'appendEvent seq 冲突/BUSY — 重试 1 次',
        );
      }
    }
  }

  /** `SYNO_SESSION_SEQ_ATOMIC=0` 回滚态：旧"先 SELECT MAX(seq) 再 INSERT"（保留原注释语义） */
  private insertEventReadThenWrite(
    sessionId: string,
    eventType: SessionEventType,
    payloadJson: string,
  ): number {
    // 持久化 lastSeq: 基于 MAX(seq) 续写，禁止内存回退（缺陷②防线）
    const nextSeq = this.readMaxSeq(sessionId) + 1;
    // #991 Q-12：超限即拒 —— 写库前拒绝单条（不静默丢、不折 degraded、不断会话）
    const cap = maxSessionEvents();
    if (nextSeq > cap) throw sessionEventLimitError(cap, nextSeq);
    this.db.prepare(
      'INSERT INTO session_events (session_id, seq, event_type, payload_json, format_version) VALUES (?,?,?,?,?)',
    ).run(sessionId, nextSeq, eventType, payloadJson, SESSION_EVENT_FORMAT_VERSION);
    return nextSeq;
  }

  /** 该会话当前最大 seq（空会话 = 0）；用于旧路径与上限报错文案 */
  private readMaxSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT MAX(seq) as max_seq FROM session_events WHERE session_id=?')
      .get(sessionId) as SqliteRow | undefined;
    return Number((row?.max_seq as number | null) ?? 0);
  }

  /**
   * 读取某会话全部事件（按 seq 升序）。
   *
   * #964 Q-7 读侧 fail-closed（裁 395）:
   *   ① 行 `event_type` 不在 v1 词表（旧库/直连 SQL 可绕过 DB CHECK）⇒ 抛 `UNKNOWN_EVENT_TYPE`；
   *   ② 行 `format_version` 高于本构建 ⇒ 抛 `EVENT_FORMAT_TOO_NEW`（旧构建拒按旧格式解码新行）；
   *   `SYNO_SESSION_EVENT_STRICT=0` ⇒ 两条守卫退回旧行为（照读 + warn 一次 + lastDegraded）。
   */
  getEvents(sessionId: string): SessionEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM session_events WHERE session_id=? ORDER BY seq ASC'
    ).all(sessionId) as SqliteRow[];
    return rows.map((r) => {
      const rawType = r.event_type;
      const formatVersion = Number(r.format_version ?? SESSION_EVENT_FORMAT_VERSION);
      const strict = isSessionEventStrict();
      if (!isSessionEventType(rawType)) {
        if (strict) {
          throw new SessionEventError(
            'UNKNOWN_EVENT_TYPE',
            'read',
            `事件行含未知类型 ${JSON.stringify(rawType)}（session=${sessionId} seq=${String(r.seq)}）—— 词表 fail-closed`,
          );
        }
        warnStrictDisabled('getEvents');
        this.lastDegraded = true;
      }
      if (formatVersion > SESSION_EVENT_FORMAT_VERSION) {
        if (strict) {
          throw new SessionEventError(
            'EVENT_FORMAT_TOO_NEW',
            'read',
            `事件行格式版本 ${formatVersion} 高于本构建 ${SESSION_EVENT_FORMAT_VERSION}` +
              `（session=${sessionId} seq=${String(r.seq)}）—— 拒绝按旧格式解码`,
          );
        }
        warnStrictDisabled('getEvents');
        this.lastDegraded = true;
      }
      return {
        id: Number(r.id), sessionId: r.session_id as string, seq: Number(r.seq),
        eventType: rawType as SessionEventType,
        payloadJson: r.payload_json as string,
        formatVersion,
        createdAt: r.created_at as string,
      };
    });
  }

  /**
   * D500 / R-E1 ②③: 从事件流投影消息历史（dsh-session deriveMessages 范式，B1）。
   *
   * 契约（铁律 47）:
   *   @input    — sessionId
   *   @output   — MessageRow[]（按 seq 升序；投影 `message` 与「带 content 的 `tool_result`」两类
   *               surface 事件；其余 log-only 跳过）
   *   @degraded — ① 事件流含半截事件（缺尾部）：log.warn + 返回可重建前缀 + `lastDegraded=true`；
   *               ② **seq 拓扑缺口**（R-E1 ②）：`log.error({code:'SESSION_SEQ_GAP',degraded:true})`
   *               + `lastDegraded=true`，**返回值语义不变**（仍返回全部可投影消息）
   *   @error    — 事件行词表/格式版本违约 ⇒ 由 `getEvents` 抛 typed `SessionEventError`（fail-closed）
   *   @authority — 只读派生；不写库（不修洞、不补 seq —— 缺口只报不猜，对齐 DSH chain 契约）
   *   @not-here  — 不做 `tool` 角色投影（`MessageRow` 无 `tool`；surface 投影契约属 R-2 冻结后另开）
   *   空事件流 → []（边界，且**不置位**降级 —— 防假绿）
   *   model-visible ⟺ logged: 投影输出 = 模型看到的输入（不变量，测试断言）
   */
  deriveMessages(sessionId: string): MessageRow[] {
    const events = this.getEvents(sessionId);
    const messages: MessageRow[] = [];
    let truncated = false;
    let gap = false;
    let gapReported = false;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      // R-E1 ②: 读侧连续性 —— seq 必须逐位 +1（`getEvents` 按 seq 升序 ⇒ 期望 = i+1）。
      // 只报不猜：缺口 ⇒ log.error + 降级信号；**不改变返回值语义**（仍返回可投影消息）。
      // 每次 deriveMessages 只细报**首个**缺口（防长会话日志洪水），后续缺口仅置位。
      if (ev.seq !== i + 1) {
        gap = true;
        if (!gapReported) {
          gapReported = true;
          log.error(
            { code: 'SESSION_SEQ_GAP', sessionId, expected: i + 1, got: ev.seq, degraded: true },
            '事件流 seq 缺口 — 日志不连续（只报不猜，返回值语义不变）',
          );
        }
      }
      try {
        const payload = JSON.parse(ev.payloadJson) as { role?: string; content?: string };
        // 事实源口径（C6 注释改正）: `message` 与 `tool_result` 是 surface 事件；其余
        // （`system`/`diagnosis_*`）是 log-only —— 这里跳过的**是后者**，不是 `tool_result`。
        if (ev.eventType !== 'message' && ev.eventType !== 'tool_result') continue; // log-only（system/diagnosis_*）跳过
        // C6（spec §9.2）: 无 `content` 的 `tool_result` = log-only 工具结果事件（E1 写入侧
        // payload 不含 content）⇒ **显式跳过**，不投影成空 assistant 消息（否则 parity 必破）。
        // 带 `content` 的历史 `tool_result` 行保持旧投影（assistant + content），兼容既有数据。
        if (ev.eventType === 'tool_result' && typeof payload.content !== 'string') continue;
        // tool_result 事件投影为 assistant 角色（2026-08-22 实测修正：Synova 消息契约
        // MessageRow.role = system|user|assistant，conversation-engine 用 assistant 承载工具结果；
        // 无独立 tool 角色——对齐现有模型，避免 MessageRow 类型膨胀）
        const role = ev.eventType === 'tool_result' ? 'assistant' : (payload.role as MessageRow['role']);
        if (role !== 'user' && role !== 'assistant' && role !== 'system') {
          log.warn({ sessionId, seq: ev.seq }, '事件 payload 角色非法 — 跳过');
          continue;
        }
        messages.push({
          id: Number(ev.seq), sessionId, role,
          content: payload.content ?? '', timestamp: ev.createdAt,
        });
      } catch (err) {
        // payload 非 JSON 或半截 → 截断检测
        truncated = true;
        log.warn({ sessionId, seq: ev.seq, err }, '事件 payload 解析失败 — 投影截断');
        break; // 半截事件: 停止投影（保留前缀），degraded
      }
    }
    if (truncated) {
      this.lastDegraded = true;
    }
    if (gap) {
      this.lastDegraded = true;
    }
    return messages;
  }

  /** D500 测试辅助: 把某会话最后一条事件 payload 改成非法 JSON（模拟物理半截/损坏） */
  corruptLastEventPayload(sessionId: string): void {
    this.db.prepare(
      "UPDATE session_events SET payload_json='{broken' WHERE session_id=? AND seq=(SELECT MAX(seq) FROM session_events WHERE session_id=?)"
    ).run(sessionId, sessionId);
  }

  getMessages(sessionId: string): MessageRow[] {
    // D500 复核修复: getMessages backing deriveMessages —— 消息真相统一从事件流派生
    // （dev doc §4.1 "deriveMessages backing getMessages" 字面意图）。
    // 原实现直接查 agent_messages（mutable 快照），缺陷 A 根源——事件流才是唯一事实源。
    // agent_messages 表保留为兼容 + FTS5 触发器源（双写下沉），但读取走事件派生。
    // data-exporter 等消费者只读 role/content，id 语义（seq vs 自增）不影响。
    return this.deriveMessages(sessionId);
  }

  // ═══ State ═══

  saveState(sessionId: string, state: Record<string, unknown>): void {
    this.db.prepare('UPDATE agent_sessions SET state_json=?, phase=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(state), state.phase ?? 0, new Date().toISOString(), sessionId);
  }

  loadState(sessionId: string): ConversationState | null {
    const row = this.db.prepare('SELECT state_json FROM agent_sessions WHERE id=?').get(sessionId) as SqliteRow | undefined;
    if (!row?.state_json) return null;
    try {
      return JSON.parse(row.state_json as string);
    } catch (err) {
      log.warn({ err }, '会话状态反序列化失败');
      return null;
    }
  }

  // ═══ FTS5 Search ═══

  search(query: string, limit = 10): SearchResult[] {
    // FTS5 unicode61 对中文支持有限——使用 LIKE 作为 fallback
    const hasCJK = /[一-鿿]/.test(query);
    if (hasCJK) {
      const likePattern = `%${query}%`;
      const rows = this.db.prepare(`
        SELECT DISTINCT m.session_id, s.org_id, s.updated_at,
               (SELECT COUNT(*) FROM agent_messages WHERE session_id=m.session_id) as msg_count,
               substr(m.content, max(0, instr(m.content, ?) - 30), 80) as snippet
        FROM agent_messages m
        JOIN agent_sessions s ON s.id = m.session_id
        WHERE m.content LIKE ?
        ORDER BY s.updated_at DESC
        LIMIT ?
      `).all(query, likePattern, limit) as SqliteRow[];
      return rows.map(r => ({
        sessionId: r.session_id as string, orgId: r.org_id as string,
        messageCount: Number(r.msg_count), snippet: r.snippet as string, updatedAt: r.updated_at as string,
      }));
    }

    // English/ASCII → FTS5
    const rows = this.db.prepare(`
      SELECT f.session_id, s.org_id, s.updated_at,
             (SELECT COUNT(*) FROM agent_messages WHERE session_id=f.session_id) as msg_count,
             snippet(agent_messages_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
      FROM agent_messages_fts f
      JOIN agent_sessions s ON s.id = f.session_id
      WHERE agent_messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as SqliteRow[];
    return rows.map(r => ({
      sessionId: r.session_id as string, orgId: r.org_id as string,
      messageCount: Number(r.msg_count), snippet: r.snippet as string, updatedAt: r.updated_at as string,
    }));
  }

  // ═══ 诊断检查点 — 崩溃恢复 ═══

  /** 保存诊断检查点 (每个 Phase 完成后调用) */
  saveDiagnosisCheckpoint(checkpoint: {
    sessionId: string; phase: number; completedModules: string[];
    partialReport: unknown; savedAt: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO diagnosis_checkpoints (session_id, phase, completed_modules, partial_report, saved_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      checkpoint.sessionId, checkpoint.phase,
      JSON.stringify(checkpoint.completedModules),
      JSON.stringify(checkpoint.partialReport),
      checkpoint.savedAt,
    );
  }

  /** 获取最近的诊断检查点 */
  getDiagnosisCheckpoint(sessionId: string): {
    phase: number; completedModules: string[]; partialReport: unknown; savedAt: string;
  } | null {
    const row = this.db.prepare(`
      SELECT phase, completed_modules, partial_report, saved_at
      FROM diagnosis_checkpoints WHERE session_id = ? ORDER BY saved_at DESC LIMIT 1
    `).get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return {
        phase: row.phase as number,
        completedModules: JSON.parse(row.completed_modules as string || '[]'),
        partialReport: JSON.parse(row.partial_report as string || 'null'),
        savedAt: row.saved_at as string,
      };
    } catch (err) { log.warn({ err }, '会话检查点解析失败'); return null; }
  }

  /** 删除会话的检查点 */
  deleteDiagnosisCheckpoints(sessionId: string): void {
    this.db.prepare('DELETE FROM diagnosis_checkpoints WHERE session_id = ?').run(sessionId);
  }

  /**
   * D593: 诊断报告列表读（报告归档行 = diagnosis_checkpoints phase=5，键=reportId）。
   *
   * 契约（铁律 47 — 契约优先，spec §5.2-C）:
   *   @input    — opts: { limit: number, offset: number }（路由层已夹取；本方法再防御性
   *               夹取 limit 1..200、offset >= 0，sentinel findings 同款 idiom）
   *   @output   — { ok: true, total, degraded, reports: Array<{ reportId, teamId, completedAt,
   *               summary: string | null, onePagerAvailable: boolean }> }，按 saved_at DESC
   *               （rowid DESC 决同刻稳定序：后写先出）
   *   @degraded — 行级 partial_report JSON 损坏/形状非法 → log.warn + 跳过该行 + degraded: true
   *               （不 500，铁律 24）；total 恒为 phase=5 行计数（不因跳过缩水）
   *   @error    — 查询异常 → { ok: false, degraded: true, error }（调用方路由映射 503 fail-closed）
   */
  listDiagnosisReports(opts: { limit: number; offset: number }):
    | { ok: true; total: number; degraded: boolean; reports: Array<{ reportId: string; teamId: string; completedAt: string; summary: string | null; onePagerAvailable: boolean }> }
    | { ok: false; degraded: true; error: string } {
    try {
      const limit = Math.min(Math.max(Math.trunc(opts.limit) || 0, 1), 200);
      const offset = Math.max(Math.trunc(opts.offset) || 0, 0);
      const totalRow = this.db.prepare('SELECT COUNT(*) AS c FROM diagnosis_checkpoints WHERE phase = 5').get() as { c: number } | undefined;
      const total = Number(totalRow?.c ?? 0);
      const rows = this.db.prepare(
        'SELECT session_id, partial_report FROM diagnosis_checkpoints WHERE phase = 5 ORDER BY saved_at DESC, rowid DESC LIMIT ? OFFSET ?',
      ).all(limit, offset) as SqliteRow[];
      const reports: Array<{ reportId: string; teamId: string; completedAt: string; summary: string | null; onePagerAvailable: boolean }> = [];
      let degraded = false;
      for (const row of rows) {
        const sessionId = typeof row.session_id === 'string' ? row.session_id : '';
        try {
          const partial: unknown = JSON.parse(typeof row.partial_report === 'string' ? row.partial_report : 'null');
          if (!isDiagnosisReportArchive(partial)) {
            // 形状不合规（损坏/非归档行误标 phase=5）→ 诚实跳过，不 500、不静默（铁律 24）
            log.warn({ sessionId }, 'listDiagnosisReports: partial_report 形状非法 — 跳过该行（degraded）');
            degraded = true;
            continue;
          }
          reports.push({
            reportId: partial.reportId,
            teamId: partial.teamId,
            completedAt: partial.completedAt,
            summary: partial.report.summary,
            onePagerAvailable: typeof partial.onePager === 'string' && partial.onePager.length > 0,
          });
        } catch (err) {
          log.warn({ err, sessionId }, 'listDiagnosisReports: partial_report JSON 损坏 — 跳过该行（degraded）');
          degraded = true;
        }
      }
      return { ok: true, total, degraded, reports };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, 'listDiagnosisReports 查询失败 — fail-closed');
      return { ok: false, degraded: true, error: msg };
    }
  }
}
