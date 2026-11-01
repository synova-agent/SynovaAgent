/**
 * cron/scheduler.ts — Cron 调度器 + Hybrid 触发器 (D94)
 *                     ＋ 单 job 单飞 / 失败分类 / 有界退避 / 终态 disabled（#1257 S1.5 P0-3a/b）
 *
 * Yer 3.4 + D94: triggerType='cron'|'event'|'hybrid'
 * - cron: 传统定时触发（向后兼容）
 * - event: 仅事件触发（无定时）
 * - hybrid: cron 作为安全网 + event 作为加速器
 *
 * 对标 Hermes cron/scheduler.py: setTimeout 循环 + SQLite 持久化。
 * 简单可靠，不需要外部依赖。
 *
 * 设计哲学：**一条分离 ＋ 三条承诺** —
 *   分离：调度（何时跑）与执行（跑得成不成）分开记账 —— 派发时立刻推进 `nextRun`，
 *         执行结果只改 `attempts`/`disabled`，两条时钟互不污染（修前二者共用 `nextRun`，
 *         故 handler 一旦超过一个 tick 周期就被重复启动）。
 *   承诺① 单飞：进程内同一 job 永不重入（`inFlight` 守卫，`finally` 必复位，异常路径亦然）。
 *   承诺② 分类：失败按 `code`/`retryable` 分流，**只有显式不可重试**才一次打死。
 *   承诺③ 有界：可重试退避 `min(30s·2^(attempts-1), 30min)`，`attempts>=MAX_ATTEMPTS` 进终态。
 *
 * 契约（铁律 47）:
 *   @input     db — better-sqlite3 实例（`cron_jobs` 表；缺列时本类自迁移，幂等）
 *              schedule(name, cron, handler, triggerType?, eventTypes?) — 作业注册（按 name 认领既有行）
 *   @output    listJobs() → 作业快照（含 `attempts`/`disabled`/`nextRun`/`inFlight`，供观测与自检）
 *   @authority 谁能调：`schedule`/`registerEventTrigger` 只由启动装配面（deploy/bootstrap、
 *              sentinel runner、loops/loop-scheduler）与内置工具调用；tick 为私有入口；
 *              `executeNow` 供管理面/工具显式触发（**不解除 `disabled`** —— 终态只能显式操作解除）
 *   @degraded  ① cron 表达式无效/窗内无匹配 ⇒ `nextCronTime` 退化为下一个整点（既有语义，log.warn）
 *              ② 失败进入退避或终态 ⇒ log.error 带 `degraded: true` ＋ code/attempts/disabled
 *              ③ 迁移列已存在/ALTER 失败 ⇒ log.warn + `degraded: true` 跳过（幂等，不阻断启动）
 *   @error     无抛出型新增错误：`runJob` 内部全捕获并分类落库（单个作业失败不得崩调度器）；
 *              `executeNow` 未知作业名 ⇒ throw Error(`任务不存在: <name>`)（既有语义，保留）
 *
 * @known-limitations （做不到什么）
 *   - **单飞是进程内语义**：多进程共库不保证跨进程单飞（S2 处理；规格 §4-1）。
 *   - **`disabled` 无自动复活**：终态只能由显式操作解除（S2 管理面；规格 §4-8），本类不提供 re-enable。
 *   - **历史同名重复行未清理**：库中若已有多个同名 `cron_jobs` 行（旧版每次重启新插一行所致），
 *     `schedule` 只认领最老一行（`ORDER BY rowid LIMIT 1`），其余作为无 handler 的孤儿行
 *     仍出现在 `listJobs()` 里 —— 本批不采纳孤儿清理（规格 §1.2-7 方案②）。
 *   - **失败分类只认显式信号**：错误既无 `code` 也不带 `retryable=false` ⇒ 一律按可重试
 *     （规格 §1.2-1 v3 更正：哨兵 handler 抛普通 Error，不能一次打死 7×24 作业）。
 *   - **退避参数是规格常量**：`MAX_ATTEMPTS=5`、基数 30s、上限 30min（规格 §十 待裁，改值归 L1）。
 *   - **时钟直取沿用既有 6 处/4 处**（带参构造不计；不新增 —— 口径见 tests/contract/time-injection.test.ts 棘轮）。
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';
import { DiagnosticAgentError } from '@synova/error-types';

const log = createLogger('cron/scheduler');

// ═══ Types ═══

/**
 * nextCronTime 逐分钟搜索的迭代硬上界（防空转保险丝，不是性能手段）。
 *
 * 口径（自算，非引用）：2 年搜索窗 = 731 天 × 1440 分钟 = 1,052,640 分钟，
 * 故 1,100,000 的预算**大于窗宽** ⇒ 正常路径下「窗宽」先触底，本预算只在
 * `check` 因 DST 等原因未向前推进时兜死循环。
 *
 * 成本削减来自**解析正确**，不是来自本预算：
 *   · 修前：`* / n`、`a-b` 解析为空集 ⇒ 仍静默扫满 1,052,640 次/调用（实测 ~168ms/行）
 *   · 修后：字段空集 ⇒ 立即 log.warn + 兜底返回（**0 次迭代**）
 * 🔴 窗内无匹配（如 `0 0 31 2 *` 2 月 31 日）仍扫满窗宽 —— 该路径成本**未变低**，
 *    只从「静默」变为「log.warn + 常数上界」。不得声称本预算降低了这条路径的成本。
 */
const SCAN_BUDGET = 1_100_000;

/** 字段片段的合法整数形态：纯十进制数字（`+5` / `1e3` / `2-3` 一律判非法 —— 防 parseInt 静默取前缀） */
const FIELD_NUM = /^\d+$/;

export type TriggerType = 'cron' | 'event' | 'hybrid';

// ═══ 失败分类与有界重试参数（规格 #1257 §1.2；改值归 L1 裁定，本文件不得自行调） ═══

/** 可重试失败的连续次数上限：达到即进终态 `disabled`（规格 §1.2-2） */
const MAX_ATTEMPTS = 5;

/** 退避基数：`attempts=1` 的等待 ≈ 30s（规格 §1.2-2） */
const RETRY_BASE_MS = 30_000;

/** 退避帽：单次等待不超过 30min（规格 §1.2-2） */
const RETRY_MAX_MS = 30 * 60 * 1000;

export interface CronJob {
  id: string;
  name: string;
  cron: string;
  handler: () => Promise<void>;
  lastRunAt: string | null;
  lastError: string | null;
  /** 连续失败次数（成功即清零）—— 与 `attempts` 同值同生命周期，保留以兼容既有自检数据源 */
  failures: number;
  runs: number;
  /** 下次（cron）触发时刻（ms）。**派发时即推进**，失败退避时才被覆盖 */
  nextRun: number; // timestamp
  // D94: Hybrid trigger support
  triggerType: TriggerType;
  eventTypes: string[];
  lastEventAt: string | null;
  // ── #1257 S1.5 P0-3a/b（进程内单飞 ＋ 失败分类/终态） ──
  /** 单飞标记：handler 执行中。tick 见到即跳过（进程内语义，`finally` 必复位） */
  inFlight: boolean;
  /** 最近一次失败的机器可读码（按 code 路由，不解析 message；无码/上次成功 ⇒ null） */
  lastErrorCode: string | null;
  /** 可重试退避的指数基准：连续失败次数（= `failures`，成功即清零） */
  attempts: number;
  /** 显式终态：true ⇒ 从 tick/事件自动触发中排除，只能由显式操作解除（规格 §4-8） */
  disabled: boolean;
}

/**
 * 失败分类结果（铁律 32：错误可分类，调用方按 `code` 路由）。
 *
 * @input  err — 任意抛出值（`unknown`：handler 可能抛非 Error）
 * @output code（机器可读码，无码 ⇒ null）／message（人读）／retryable（是否可重试）
 * @degraded 无 —— 纯函数，不抛出；无法识别的形态一律按「可重试」处理（见文件头已知限制）
 */
export interface ClassifiedFailure {
  code: string | null;
  message: string;
  retryable: boolean;
}

/**
 * 把任意抛出值分类成本调度器可路由的失败形状。
 *
 * 分类口径（规格 §1.2-1，v3 更正）：
 *   · `DiagnosticAgentError`（`@synova/error-types`）⇒ 取 `code` ＋ 按其 `retryable` 字段；
 *   · 任意对象带字符串 `code` ⇒ 取该码；`retryable` 为布尔则采信，否则**按可重试**；
 *   · 无码/非对象 ⇒ `code=null` 且**按可重试**（禁「无码即不可重试」—— 会把哨兵一次打死）。
 * 🔴 只有 `retryable === false` 是「显式不可重试」的唯一信号。
 *
 * @invariant `retryable === false` ⇒ 必来自错误自带的显式声明，不由本函数推断
 */
export function classifyFailure(err: unknown): ClassifiedFailure {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof DiagnosticAgentError) {
    return { code: err.code, message, retryable: err.retryable };
  }

  if (err !== null && typeof err === 'object') {
    const bag = err as Record<string, unknown>;
    const rawCode = bag['code'];
    const code = typeof rawCode === 'string' && rawCode !== '' ? rawCode : null;
    const rawRetryable = bag['retryable'];
    const retryable = typeof rawRetryable === 'boolean' ? rawRetryable : true;
    return { code, message, retryable };
  }

  return { code: null, message, retryable: true };
}

// ═══ Cron Expression Parser ═══

/**
 * 解析单个 cron 字段。
 *
 * 支持语法（POSIX crontab(5) 常用子集 + Vixie 的 `n/m` 形态）：
 *   `n`          单值          —— `5`
 *   `a-b`        区间          —— `9-17`
 *   `*`          全域          —— `*`
 *   `* / n`      全域步进       —— `* / 3`（自 min 起，每 n）
 *   `a-b / n`    区间步进       —— `9-17 / 2`
 *   `n / m`      起点步进       —— `0 / 15`（自 n 起、每 m、上界 max；即 0,15,30,45）
 *   `a,b,c`      列表（元素可为上述任一）
 *
 * @input  field — 原始字段串；min/max — 该字段合法闭区间（分 0-59 / 时 0-23 / 日 1-31 / 月 1-12 / 周 0-6）
 * @output 字段所代表的取值集合（无合法片段 ⇒ 空集）
 * @degraded 非法片段（非纯数字 / 反向区间 / 步长 ≤ 0 / 缺起始域 / 区间与单值之外的形态）
 *           **跳过该片段**，其余合法片段照常生效 —— 函数本身不抛，
 *           由调用方 `nextCronTime` 判定「全空 = 表达式无效」并 log.warn + 兜底。
 * @invariant ① 返回集合恒为 [min, max] 的子集；`*` 恒等于全域
 *            ② 区间/步进的两端**裁剪**到 [min,max]（如分字段 `50-70` ⇒ 50..59）
 *            ③ 越界**单值**不裁剪也不贡献（如分字段 `70` ⇒ 不加入），与 ② 的差异是刻意的：
 *               越界单值几乎总是书写错误，静默裁剪会把它变成另一个看起来正常的表达式
 */
export function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  const raw = field.trim();
  if (raw === '') return values;

  /** 把 [from, to] 按 step 展开，两端裁剪到 [min, max] 后逐点入集 */
  const addRange = (from: number, to: number, step: number): void => {
    const lo = Math.max(min, from);
    const hi = Math.min(max, to);
    for (let i = lo; i <= hi; i += step) values.add(i);
  };

  for (const rawPart of raw.split(',')) {
    const part = rawPart.trim();
    if (part === '') continue;

    // ── 拆步进：`<主体>/<步长>`。`/` 只认首个；主体缺省 / 步长非法 ⇒ 整片段非法
    const slash = part.indexOf('/');
    const body = (slash === -1 ? part : part.slice(0, slash)).trim();
    let step = 1;
    if (slash !== -1) {
      const stepStr = part.slice(slash + 1).trim();
      if (!FIELD_NUM.test(stepStr)) continue; // `3/4` / 空 / `-2` / `2.5` ⇒ 非法片段
      step = parseInt(stepStr, 10);
      if (step <= 0) continue; // 步长 0 会让展开死循环 ⇒ 非法片段
    }
    if (body === '') continue; // `/3`（缺起始域）⇒ 非法片段，不猜「全域」

    // ── `*` / `* /n`：全域（自 min 起，每 step 个）
    if (body === '*') {
      addRange(min, max, step);
      continue;
    }

    // ── `a-b` / `a-b/n`：区间（两端裁剪到 [min,max]）
    const dash = body.indexOf('-');
    if (dash !== -1) {
      const fromStr = body.slice(0, dash).trim();
      const toStr = body.slice(dash + 1).trim();
      if (!FIELD_NUM.test(fromStr) || !FIELD_NUM.test(toStr)) continue; // `-5` / `5-` / `1-2-3` ⇒ 非法
      const from = parseInt(fromStr, 10);
      const to = parseInt(toStr, 10);
      if (from > to) continue; // 反向区间 ⇒ 非法片段
      addRange(from, to, step);
      continue;
    }

    // ── `n` / `n/m`：单值；带步长时按 POSIX 语义展开到 max
    if (!FIELD_NUM.test(body)) continue;
    const n = parseInt(body, 10);
    if (n < min || n > max) continue; // 越界单值 ⇒ 非法片段
    if (slash !== -1) {
      addRange(n, max, step);
      continue;
    }
    values.add(n);
  }

  return values;
}

/**
 * 计算 cron 表达式的下一次触发时刻。
 *
 * @input  cron — 5 字段表达式（分 时 日 月 周）；from — 起算时刻（默认 now）
 * @output 下一次触发时刻；两条降级路径均返回 `from` 之后的**下一个整点**（≤1h）作为安全网
 * @degraded ① 字段数 ≠ 5 或任一字段解析为空集（表达式无效）⇒ log.warn + 兜底
 *           ② 2 年搜索窗内无匹配（如 `0 0 31 2 *` = 2 月 31 日）⇒ log.warn + 兜底
 *           —— 修前两条路径均**静默**；①的成本由 1,052,640 次迭代降为 0，②的成本未变
 * @invariant 迭代次数 ≤ min(窗宽 1,052,640, SCAN_BUDGET)；返回值恒 > from
 */
export function nextCronTime(cron: string, from: Date = new Date()): Date {
  const parts = cron.trim().split(/\s+/);
  const fields: [string, number, number][] = [
    [parts[0] ?? '', 0, 59],
    [parts[1] ?? '', 0, 23],
    [parts[2] ?? '', 1, 31],
    [parts[3] ?? '', 1, 12],
    [parts[4] ?? '', 0, 6],
  ];
  const [mins, hours, days, months, dows] = fields.map(([f, lo, hi]) =>
    parseCronField(f, lo, hi),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];

  if (parts.length !== 5 || [mins, hours, days, months, dows].some((s) => s.size === 0)) {
    log.warn({ cron, fields: parts.length }, 'cron 表达式无效（字段数≠5 或字段解析为空集）— 退化为下一个整点触发');
    return fallbackTime(from);
  }

  const check = new Date(from.getTime() + 60000);
  check.setSeconds(0, 0);

  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 2);

  let iterations = 0;
  while (check <= limit && iterations < SCAN_BUDGET) {
    iterations++;
    if (
      months.has(check.getMonth() + 1) &&
      days.has(check.getDate()) &&
      hours.has(check.getHours()) &&
      mins.has(check.getMinutes()) &&
      dows.has(check.getDay())
    ) {
      return check;
    }
    check.setMinutes(check.getMinutes() + 1);
  }

  log.warn(
    { cron, iterations, budget: SCAN_BUDGET },
    'cron 表达式在 2 年搜索窗内无匹配 — 退化为下一个整点触发',
  );
  return fallbackTime(from);
}

/**
 * 兜底时刻：`from` 之后的**下一个整点**（≤1h）。
 *
 * @invariant 返回值恒 > from（`from` 加 1h 再截到整点，最坏情形仍比 from 晚 1ms）
 */
function fallbackTime(from: Date): Date {
  const fallback = new Date(from.getTime() + 3600000);
  fallback.setMinutes(0, 0, 0);
  return fallback;
}

// ═══ Event Bus (in-process) ═══

type EventListener = (eventType: string, payload?: unknown) => void;
const eventListeners = new Map<string, Set<EventListener>>();

/**
 * 注册事件监听器（进程内事件总线）。
 */
export function onEventType(eventType: string, listener: EventListener): void {
  if (!eventListeners.has(eventType)) eventListeners.set(eventType, new Set());
  eventListeners.get(eventType)!.add(listener);
}

/**
 * 触发事件（供外部模块调用）。
 */
export function emitEvent(eventType: string, payload?: unknown): void {
  const listeners = eventListeners.get(eventType);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try { listener(eventType, payload); } catch (err: unknown) {
      log.warn({ err, eventType }, '事件监听器执行失败 — 不阻断');
    }
  }
}

// ═══ CronScheduler ═══

export class CronScheduler {
  private db: Database.Database;
  private jobs = new Map<string, CronJob>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  // D94: 事件 → jobs 映射
  private eventToJobs = new Map<string, Set<string>>();

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
    this.restoreJobs();
    // D94: 事件订阅在 indexEventToJob/subscribeToEventType 时动态建立
    this.start();
  }

  // ═══ Schema ═══

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        last_run_at TEXT,
        last_error TEXT,
        failures INTEGER DEFAULT 0,
        runs INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        trigger_type TEXT DEFAULT 'cron',
        event_types TEXT DEFAULT '[]',
        last_event_at TEXT,
        last_error_code TEXT,
        attempts INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0
      );
    `);

    // D94: 迁移旧表 — 安全地添加列（忽略已存在错误）
    try { this.db.exec("ALTER TABLE cron_jobs ADD COLUMN trigger_type TEXT DEFAULT 'cron'"); } catch { log.warn({}, 'ALTER TABLE trigger_type 已存在或失败 — 跳过'); }
    try { this.db.exec("ALTER TABLE cron_jobs ADD COLUMN event_types TEXT DEFAULT '[]'"); } catch { log.warn({}, 'ALTER TABLE event_types 已存在或失败 — 跳过'); }
    try { this.db.exec("ALTER TABLE cron_jobs ADD COLUMN last_event_at TEXT"); } catch { log.warn({}, 'ALTER TABLE last_event_at 已存在或失败 — 跳过'); }
    // #1257 S1.5 P0-3b: 失败分类/退避/终态三列（幂等迁移，沿用上方 try ALTER / catch log.warn 范式）
    try { this.db.exec('ALTER TABLE cron_jobs ADD COLUMN last_error_code TEXT'); } catch { log.warn({ degraded: true }, 'ALTER TABLE last_error_code 已存在或失败 — 跳过'); }
    try { this.db.exec('ALTER TABLE cron_jobs ADD COLUMN attempts INTEGER DEFAULT 0'); } catch { log.warn({ degraded: true }, 'ALTER TABLE attempts 已存在或失败 — 跳过'); }
    try { this.db.exec('ALTER TABLE cron_jobs ADD COLUMN disabled INTEGER DEFAULT 0'); } catch { log.warn({ degraded: true }, 'ALTER TABLE disabled 已存在或失败 — 跳过'); }
  }

  /**
   * 单行（`cron_jobs` 原始行）→ `CronJob`（内存态）。
   *
   * @input  row — `SELECT * FROM cron_jobs` 的一行（可能来自旧 schema，三新列缺失/为 null）
   * @output CronJob（handler 恒为 no-op：恢复态无真实执行体，真实 handler 由 `schedule` 认领时装入）
   * @degraded 旧库行缺 `attempts`/`disabled` ⇒ 按 0/false 恢复（旧行本就没有终态语义）
   */
  private jobFromRow(row: Record<string, unknown>): CronJob {
    const eventTypes: string[] = this.safeParseEventTypes(row.event_types as string | undefined);
    return {
      id: row.id as string, name: row.name as string, cron: row.cron as string,
      handler: async () => {},
      lastRunAt: row.last_run_at as string | null, lastError: row.last_error as string | null,
      failures: Number(row.failures || 0), runs: Number(row.runs || 0),
      nextRun: nextCronTime(row.cron as string).getTime(),
      triggerType: (row.trigger_type as TriggerType) || 'cron',
      eventTypes,
      lastEventAt: row.last_event_at as string | null,
      inFlight: false,
      lastErrorCode: (row.last_error_code as string | null) ?? null,
      attempts: Number(row.attempts || 0),
      disabled: Number(row.disabled || 0) === 1,
    };
  }

  private restoreJobs(): void {
    const rows = this.db.prepare('SELECT * FROM cron_jobs').all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      log.debug({ name: row.name, id: row.id }, '恢复持久化任务');
      const job = this.jobFromRow(row);
      this.jobs.set(job.id, job);
      this.indexEventToJob(job);
    }
  }

  private safeParseEventTypes(raw: string | undefined): string[] {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch {
      log.warn({ raw }, 'event_types JSON 解析失败 — 返回空数组');
      return [];
    }
  }

  // ═══ D94: Event → Job 索引 ═══

  private indexEventToJob(job: CronJob): void {
    for (const et of job.eventTypes) {
      if (!this.eventToJobs.has(et)) {
        this.eventToJobs.set(et, new Set());
        this.subscribeToEventType(et);
      }
      this.eventToJobs.get(et)!.add(job.id);
    }
  }

  private subscribeToEventType(eventType: string): void {
    onEventType(eventType, (et, payload) => {
      this.onEvent(et, payload).catch(err => {
        log.warn({ err, eventType: et }, "事件触发执行失败");
      });
    });
  }

  // ═══ Public API ═══

  /**
   * 调度一个任务。
   *
   * **按 name 认领既有行**（规格 §1.2-7 方案①）：`restoreJobs()` 恢复的旧行 handler 是 no-op，
   * 真实执行靠本方法装入；若按新 id 新插一行，重启后 `disabled` 必被新行（默认 0）复活。
   * 故先按 name 查库：命中 ⇒ 复用该 id、UPDATE `cron`/`trigger_type`/`event_types`，
   * **绝不新插一行、绝不碰 `disabled`/`attempts`/`last_*`**；未命中 ⇒ 才新建行。
   *
   * @param name - 任务名称（**认领键**；同进程内视为唯一业务键）
   * @param cron - cron 表达式
   * @param handler - 执行函数
   * @param triggerType - 触发器类型（默认 'cron'，向后兼容）
   * @param eventTypes - 监听的事件类型列表（event/hybrid 时使用）
   * @returns job ID（认领命中时 = 既有行的 id；否则为新生成的 id）
   * @degraded cron 表达式无效 ⇒ `nextCronTime` 退化为下一个整点（log.warn），本方法照常注册
   */
  schedule(
    name: string,
    cron: string,
    handler: () => Promise<void>,
    triggerType: TriggerType = 'cron',
    eventTypes: string[] = [],
  ): string {
    const nextRun = nextCronTime(cron).getTime();

    const claimed = this.claimByName(name);
    if (claimed) {
      // 换 handler / cron / 触发面；**不碰** disabled/attempts/last_*（终态与失败账必须跨重启保住）
      for (const et of claimed.eventTypes) this.eventToJobs.get(et)?.delete(claimed.id);
      claimed.cron = cron;
      claimed.handler = handler;
      claimed.triggerType = triggerType;
      claimed.eventTypes = [...eventTypes];
      claimed.nextRun = nextRun;
      this.indexEventToJob(claimed);

      this.db.prepare(
        'UPDATE cron_jobs SET cron=?, trigger_type=?, event_types=? WHERE id=?',
      ).run(cron, triggerType, JSON.stringify(eventTypes), claimed.id);
      log.info(
        { name, id: claimed.id, disabled: claimed.disabled, attempts: claimed.attempts },
        '任务已认领既有行（保留 disabled/attempts）',
      );
      return claimed.id;
    }

    const id = `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; // nosec: nonce
    const job: CronJob = {
      id, name, cron, handler, lastRunAt: null, lastError: null, failures: 0, runs: 0, nextRun,
      triggerType, eventTypes, lastEventAt: null,
      inFlight: false, lastErrorCode: null, attempts: 0, disabled: false,
    };
    this.jobs.set(id, job);
    this.indexEventToJob(job);

    this.db.prepare(
      'INSERT OR REPLACE INTO cron_jobs (id, name, cron, trigger_type, event_types) VALUES (?,?,?,?,?)',
    ).run(id, name, cron, triggerType, JSON.stringify(eventTypes));
    log.debug({ name, cron, triggerType, nextRun: new Date(nextRun).toISOString() }, '任务已调度');

    return id;
  }

  /**
   * 按 name 认领既有 `cron_jobs` 行（规格 §1.2-7 方案① 的实现件）。
   *
   * @input  name — 业务键
   * @output 命中 ⇒ 该行的内存 `CronJob`（已入 `this.jobs` 并索引事件；保留 disabled/attempts）；未命中 ⇒ null
   * @invariant 只读+装载，**不写库**（写库由 `schedule` 的 UPDATE 分支负责）；同名多行时取最老一行
   */
  private claimByName(name: string): CronJob | null {
    const row = this.db
      .prepare('SELECT * FROM cron_jobs WHERE name = ? ORDER BY rowid LIMIT 1')
      .get(name) as Record<string, unknown> | undefined;
    if (!row) return null;

    const id = String(row.id);
    const existing = this.jobs.get(id);
    if (existing) return existing;

    // 行在库但内存无（正常不可达：restoreJobs 已全量恢复）⇒ 按库行重建，仍保留 disabled/attempts
    const rebuilt = this.jobFromRow(row);
    this.jobs.set(rebuilt.id, rebuilt);
    this.indexEventToJob(rebuilt);
    return rebuilt;
  }

  /**
   * 作业快照（观测面）。
   *
   * @output 每个作业的 id/name/cron/triggerType/eventTypes/lastRunAt/lastError/failures/runs
   *         ＋ `attempts`/`disabled`/`nextRun`/`inFlight`/`lastErrorCode`
   *         （`disabled` 在 DB 是 INTEGER 0/1，TS 面统一为 boolean；`nextRun` 为 ms 时间戳 —— 退避可观测）
   * @degraded 无（纯内存映射）
   */
  listJobs(): Array<{
    id: string; name: string; cron: string; triggerType: TriggerType;
    eventTypes: string[]; lastRunAt: string | null; lastError: string | null;
    failures: number; runs: number;
    attempts: number; disabled: boolean; nextRun: number; inFlight: boolean;
    lastErrorCode: string | null;
  }> {
    return [...this.jobs.values()].map(j => ({
      id: j.id, name: j.name, cron: j.cron, triggerType: j.triggerType,
      eventTypes: j.eventTypes,
      lastRunAt: j.lastRunAt, lastError: j.lastError,
      failures: j.failures, runs: j.runs,
      attempts: j.attempts, disabled: j.disabled, nextRun: j.nextRun, inFlight: j.inFlight,
      lastErrorCode: j.lastErrorCode,
    }));
  }

  /**
   * 显式触发一个作业（管理面/内置工具入口，不经 tick）。
   *
   * @param name - 作业名（同进程内唯一业务键）
   * @output 无；成功/失败均落库（失败处置与 tick 派发完全一致，同走 `runJob`）
   * @degraded 该作业正在执行（`inFlight`）⇒ log.warn 后**跳过**（单飞：显式触发也不得并发重入）
   * @error 作业名不存在 ⇒ throw Error(`任务不存在: <name>`)（既有语义，保留）
   * @note **不解除 `disabled`** —— 终态只能由显式管理操作解除（规格 §4-8；S2 提供 re-enable）
   */
  async executeNow(name: string): Promise<void> {
    const job = [...this.jobs.values()].find(j => j.name === name);
    if (!job) throw new Error(`任务不存在: ${name}`);
    if (job.inFlight) {
      log.warn({ name, jobId: job.id }, '任务仍在执行 — 跳过显式触发（单飞）');
      return;
    }
    await this.runJob(job);
  }

  remove(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      for (const et of job.eventTypes) {
        this.eventToJobs.get(et)?.delete(id);
      }
    }
    this.jobs.delete(id);
    this.db.prepare('DELETE FROM cron_jobs WHERE id=?').run(id);
    log.info({ id }, '任务已删除');
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  // ═══ D94: Event Methods ═══

  /**
   * 注册事件触发器 — 将 job 与事件类型关联。
   * 事件触发时执行 job。
   */
  registerEventTrigger(jobId: string, eventType: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`任务不存在: ${jobId}`);

    if (!job.eventTypes.includes(eventType)) {
      job.eventTypes.push(eventType);
    }
    this.indexEventToJob(job);

    const etJson = JSON.stringify(job.eventTypes);
    this.db.prepare('UPDATE cron_jobs SET event_types=? WHERE id=?').run(etJson, jobId);
    log.info({ jobId, eventType }, '事件触发器已注册');
  }

  /**
   * 处理事件 — 触发所有匹配的 hybrid/event 类型 job。
   *
   * event 类型: 直接执行
   * hybrid 类型: 执行 + 重置 cron 计时器
   *
   * @returns 被触发的 job ID 列表
   */
  async onEvent(eventType: string, _payload?: unknown): Promise<string[]> {
    const matchingJobIds = this.eventToJobs.get(eventType);
    if (!matchingJobIds || matchingJobIds.size === 0) return [];

    const fired: string[] = [];
    for (const jobId of matchingJobIds) {
      const job = this.jobs.get(jobId);
      if (!job) continue;
      if (job.triggerType === 'cron') continue; // cron-only 不受事件影响
      // 终态作业不参与任何自动触发（tick 与事件两条自动路径一致；解除须显式操作 —— 规格 §4-8）
      if (job.disabled) {
        log.warn({ jobId, eventType }, '作业处于终态 disabled — 跳过事件触发（需显式解除）');
        continue;
      }
      // 单飞：handler 未结束 ⇒ 跳过（与 tick 同一守卫语义，规格 §1.1）
      if (job.inFlight) {
        log.warn({ jobId, eventType }, '任务仍在执行 — 跳过事件触发（单飞）');
        continue;
      }

      try {
        await this.runJob(job);
        job.lastEventAt = new Date().toISOString();
        fired.push(jobId);

        // hybrid: 事件触发后重置 cron 计时器（延长安全网）
        if (job.triggerType === 'hybrid') {
          job.nextRun = nextCronTime(job.cron).getTime();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, jobId, eventType }, '事件触发执行失败 — 降级');
      }
    }
    return fired;
  }

  /**
   * 重置事件计时器 — hybrid 模式下事件触发后调用。
   * 将 cron 计时器重置为从现在起的下一个 cron 时间。
   */
  resetEventTimer(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`任务不存在: ${jobId}`);
    if (job.triggerType !== 'hybrid') return; // 仅 hybrid 模式需要
    job.nextRun = nextCronTime(job.cron).getTime();
    job.lastEventAt = new Date().toISOString();
    log.debug({ jobId, nextRun: new Date(job.nextRun).toISOString() }, 'Hybrid 计时器已重置');
  }

  // ═══ Internal ═══

  private start(): void {
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (this.jobs.size === 0) {
      this.timer = setTimeout(() => this.scheduleNextTick(), 60000);
      return;
    }

    const now = Date.now();
    let minNext = Infinity;

    for (const job of this.jobs.values()) {
      // cron-only 和 hybrid: cron 定时触发
      // event-only: 不参与 cron 轮询
      if (job.triggerType === 'event') continue;
      // 🔴 终态作业从 tick 排除（仍保留在 listJobs() 供观测；解除须显式操作 —— 规格 §1.2-4/§4-8）
      if (job.disabled) continue;

      if (job.nextRun <= now) {
        if (job.inFlight) {
          // 单飞：上一轮 handler 未结束 ⇒ 本轮跳过（进程内语义，规格 §1.1）
          log.warn({ name: job.name, jobId: job.id }, '任务仍在执行 — 跳过本轮（单飞，进程内不重入）');
        } else {
          // 🔴 派发时**立刻**推进 nextRun：修前只在 handler 结束后写，
          //    故 handler >1s 的 job 会被下一 tick 重复启动（且 delay 恒 1000ms）
          job.nextRun = nextCronTime(job.cron).getTime();
          this.runJob(job).catch(err => log.error({ err, name: job.name, degraded: true }, 'Cron 执行异常'));
        }
      }
      if (job.nextRun < minNext) minNext = job.nextRun;
    }

    const delay = Math.max(1000, Math.min(minNext - Date.now(), 3600000));
    this.timer = setTimeout(() => this.scheduleNextTick(), delay);
  }

  /**
   * 执行一个作业（单飞 ＋ 分类记账）。
   *
   * 调度 / 失败记账的分工（文件头「一条分离」）：
   *   · `nextRun` 由**派发侧**推进（tick 里派发瞬间即推进到下一个 cron 时刻）；
   *   · 本方法只负责执行与结果记账：成功 ⇒ 清 `attempts`/`failures`/`lastError`；
   *     失败 ⇒ 交 `recordFailure` 分类（退避覆盖 `nextRun` 或进终态 `disabled`）；
   *   · `inFlight` 在 `finally` 复位 —— **异常/提前 return 的所有路径都复位**；
   *   · 单飞守卫在**三个入口**（tick / `executeNow` / `onEvent`）判定，本方法只置位与复位 ——
   *     守卫集中在一处，才可能被"删掉守卫 ⇒ 执行次数翻倍"的判别力用例证伪。
   *
   * @input  job — 内存态作业（handler 由 `schedule` 装入）
   * @output 无（成功/失败均落库；不向调用方抛错）
   * @degraded 失败 ⇒ `recordFailure` 内 log.error 带 `degraded: true`
   */
  private async runJob(job: CronJob): Promise<void> {
    const start = Date.now();
    job.inFlight = true;
    try {
      log.debug({ name: job.name }, '任务开始');
      await job.handler();
      job.lastRunAt = new Date().toISOString();
      job.lastError = null;
      job.lastErrorCode = null;
      job.runs++;
      job.failures = 0;
      job.attempts = 0;
      const dur = Date.now() - start;
      log.debug({ name: job.name, durationMs: dur }, '任务完成');
      this.persistRun(job);
    } catch (err: unknown) {
      this.recordFailure(job, err);
    } finally {
      job.inFlight = false;
    }
  }

  /**
   * 失败记账：分类（code/retryable）→ 退避或终态 → 落库。
   *
   * 处置矩阵（规格 §1.2）：
   * | 条件 | `nextRun` | `disabled` |
   * |---|---|---|
   * | `retryable === false`（显式不可重试） | 不改（不再参与 tick） | **true**（一次即停） |
   * | 可重试且 `attempts >= MAX_ATTEMPTS` | 不改 | **true**（次数耗尽终态） |
   * | 可重试且 `attempts < MAX_ATTEMPTS` | `now + min(30s·2^(attempts-1), 30min)` | false |
   *
   * @input  job — 内存态作业（`inFlight` 仍为 true，由 `runJob.finally` 复位）；err — 抛出值
   * @output 无；副作用 = 就地更新 job 三个失败字段 ＋ persistRun 落库
   * @degraded 恒 log.error 带 `degraded: true`（显式降级，铁律 11/24/31；不静默吞错）
   */
  private recordFailure(job: CronJob, err: unknown): void {
    const { code, message, retryable } = classifyFailure(err);
    job.lastError = message;
    job.lastErrorCode = code;
    job.failures++;
    job.attempts++;

    if (!retryable) {
      job.disabled = true;
      log.error(
        { name: job.name, jobId: job.id, code, retryable, attempts: job.attempts, disabled: true, degraded: true },
        '任务失败 — 显式不可重试，一次即进终态 disabled',
      );
    } else if (job.attempts >= MAX_ATTEMPTS) {
      job.disabled = true;
      log.error(
        { name: job.name, jobId: job.id, code, retryable, attempts: job.attempts, maxAttempts: MAX_ATTEMPTS, disabled: true, degraded: true },
        '任务失败 — 可重试次数耗尽，进入终态 disabled',
      );
    } else {
      const backoffMs = Math.min(RETRY_BASE_MS * 2 ** (job.attempts - 1), RETRY_MAX_MS);
      job.nextRun = Date.now() + backoffMs;
      log.error(
        {
          name: job.name, jobId: job.id, code, retryable, attempts: job.attempts,
          backoffMs, nextRun: new Date(job.nextRun).toISOString(), degraded: true,
        },
        '任务失败 — 可重试，按指数退避重排',
      );
    }

    this.persistRun(job);
  }

  /**
   * 把内存态落库（一次 UPDATE 写全 8 列）。
   *
   * @input  job — 内存态作业
   * @output 无；`disabled` 以 INTEGER 0/1 落库（SQLite 无 boolean）
   * @degraded 无 —— 库写失败直接抛（fail loud：落库失败不得静默，见文件头 @error）
   */
  private persistRun(job: CronJob): void {
    this.db.prepare(
      'UPDATE cron_jobs SET last_run_at=?, last_error=?, failures=?, runs=?, last_event_at=?, last_error_code=?, attempts=?, disabled=? WHERE id=?',
    ).run(
      job.lastRunAt, job.lastError, job.failures, job.runs, job.lastEventAt,
      job.lastErrorCode, job.attempts, job.disabled ? 1 : 0, job.id,
    );
  }
}

// ═══ Global Singleton ═══

let _globalScheduler: CronScheduler | null = null;
let _initLock: Promise<CronScheduler> | null = null;

export function getGlobalScheduler(db?: import('better-sqlite3').Database): CronScheduler {
  if (_globalScheduler) return _globalScheduler;
  if (!db) throw new Error('首次调用 getGlobalScheduler 必须提供 database 实例');

  if (!_initLock) {
    _initLock = (async () => {
      _globalScheduler = new CronScheduler(db!);
      return _globalScheduler;
    })();
  }

  if (_globalScheduler) return _globalScheduler;
  throw new Error('CronScheduler 初始化未完成');
}

export function destroyGlobalScheduler(): void {
  if (_globalScheduler) {
    _globalScheduler.stop();
    _globalScheduler = null;
  }
}
