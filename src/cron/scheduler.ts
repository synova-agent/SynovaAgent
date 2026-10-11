/**
 * cron/scheduler.ts — Cron 调度器 + Hybrid 触发器 (D94)
 *
 * Yer 3.4 + D94: triggerType='cron'|'event'|'hybrid'
 * - cron: 传统定时触发（向后兼容）
 * - event: 仅事件触发（无定时）
 * - hybrid: cron 作为安全网 + event 作为加速器
 *
 * 对标 Hermes cron/scheduler.py: setTimeout 循环 + SQLite 持久化。
 * 简单可靠，不需要外部依赖。
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

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

export interface CronJob {
  id: string;
  name: string;
  cron: string;
  handler: () => Promise<void>;
  lastRunAt: string | null;
  lastError: string | null;
  failures: number;
  runs: number;
  nextRun: number; // timestamp
  // D94: Hybrid trigger support
  triggerType: TriggerType;
  eventTypes: string[];
  lastEventAt: string | null;
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
        last_event_at TEXT
      );
    `);

    // D94: 迁移旧表 — 安全地添加列（忽略已存在错误）
    try { this.db.exec("ALTER TABLE cron_jobs ADD COLUMN trigger_type TEXT DEFAULT 'cron'"); } catch { log.warn({}, 'ALTER TABLE trigger_type 已存在或失败 — 跳过'); }
    try { this.db.exec("ALTER TABLE cron_jobs ADD COLUMN event_types TEXT DEFAULT '[]'"); } catch { log.warn({}, 'ALTER TABLE event_types 已存在或失败 — 跳过'); }
    try { this.db.exec("ALTER TABLE cron_jobs ADD COLUMN last_event_at TEXT"); } catch { log.warn({}, 'ALTER TABLE last_event_at 已存在或失败 — 跳过'); }
  }

  private restoreJobs(): void {
    const rows = this.db.prepare('SELECT * FROM cron_jobs').all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      log.debug({ name: row.name, id: row.id }, '恢复持久化任务');
      const eventTypes: string[] = this.safeParseEventTypes(row.event_types as string | undefined);
      const job: CronJob = {
        id: row.id as string, name: row.name as string, cron: row.cron as string,
        handler: async () => {},
        lastRunAt: row.last_run_at as string | null, lastError: row.last_error as string | null,
        failures: Number(row.failures || 0), runs: Number(row.runs || 0),
        nextRun: nextCronTime(row.cron as string).getTime(),
        triggerType: (row.trigger_type as TriggerType) || 'cron',
        eventTypes,
        lastEventAt: row.last_event_at as string | null,
      };
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
   * @param name - 任务名称
   * @param cron - cron 表达式
   * @param handler - 执行函数
   * @param triggerType - 触发器类型（默认 'cron'，向后兼容）
   * @param eventTypes - 监听的事件类型列表（event/hybrid 时使用）
   * @returns job ID
   */
  schedule(
    name: string,
    cron: string,
    handler: () => Promise<void>,
    triggerType: TriggerType = 'cron',
    eventTypes: string[] = [],
  ): string {
    const id = `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; // nosec: nonce
    const nextRun = nextCronTime(cron).getTime();

    const job: CronJob = {
      id, name, cron, handler, lastRunAt: null, lastError: null, failures: 0, runs: 0, nextRun,
      triggerType, eventTypes, lastEventAt: null,
    };
    this.jobs.set(id, job);
    this.indexEventToJob(job);

    this.db.prepare(
      'INSERT OR REPLACE INTO cron_jobs (id, name, cron, trigger_type, event_types) VALUES (?,?,?,?,?)',
    ).run(id, name, cron, triggerType, JSON.stringify(eventTypes));
    log.debug({ name, cron, triggerType, nextRun: new Date(nextRun).toISOString() }, '任务已调度');

    return id;
  }

  listJobs(): Array<{
    id: string; name: string; cron: string; triggerType: TriggerType;
    eventTypes: string[]; lastRunAt: string | null; lastError: string | null;
    failures: number; runs: number;
  }> {
    return [...this.jobs.values()].map(j => ({
      id: j.id, name: j.name, cron: j.cron, triggerType: j.triggerType,
      eventTypes: j.eventTypes,
      lastRunAt: j.lastRunAt, lastError: j.lastError,
      failures: j.failures, runs: j.runs,
    }));
  }

  async executeNow(name: string): Promise<void> {
    const job = [...this.jobs.values()].find(j => j.name === name);
    if (!job) throw new Error(`任务不存在: ${name}`);
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

      if (job.nextRun <= now) {
        this.runJob(job).catch(err => log.error({ err, name: job.name }, 'Cron 执行异常'));
      }
      if (job.nextRun < minNext) minNext = job.nextRun;
    }

    const delay = Math.max(1000, Math.min(minNext - Date.now(), 3600000));
    this.timer = setTimeout(() => this.scheduleNextTick(), delay);
  }

  private async runJob(job: CronJob): Promise<void> {
    const start = Date.now();
    try {
      log.debug({ name: job.name }, '任务开始');
      await job.handler();
      job.lastRunAt = new Date().toISOString();
      job.lastError = null;
      job.runs++;
      job.failures = 0;
      job.nextRun = nextCronTime(job.cron).getTime();
      const dur = Date.now() - start;
      log.debug({ name: job.name, durationMs: dur }, '任务完成');
      this.persistRun(job);
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "任务调试信息记录");
      const msg = err instanceof Error ? err.message : String(err);
      job.lastError = msg;
      job.failures++;
      job.nextRun = Date.now() + 60000;
      log.error({ err: msg, name: job.name, failures: job.failures }, '任务失败');
      this.persistRun(job);
    }
  }

  private persistRun(job: CronJob): void {
    this.db.prepare(
      'UPDATE cron_jobs SET last_run_at=?, last_error=?, failures=?, runs=?, last_event_at=? WHERE id=?',
    ).run(job.lastRunAt, job.lastError, job.failures, job.runs, job.lastEventAt, job.id);
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
