/**
 * src/loops/loop-scheduler.ts — 多尺度循环调度器 (D91 + D223)
 *
 * D91: 消费 LoopTriggerConfig[] + CronScheduler，管理 6 循环 x 3 尺度的触发调度。
 * D223: 追加心跳追踪 + 停滞检测 (Gate 13)。每个循环执行后记录心跳，
 *       24h 周期性检查 → 超 3 周期无产出 → SYSTEM_SILENCE 告警。
 *
 * 契约:
 *   @input  — LoopTriggerConfig[] + CronScheduler 实例
 *   @output — 注册结果 / 触发响应 / 查询时间 / StagnationReport
 *   @degraded — 心跳文件不可用 → 标记 unknown + degraded
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';
import type { LoopTriggerConfig, TriggerScale, ScaleName, TriggerType } from './loop-trigger-config';
import { validateLoopConfig, LOOP_TRIGGER_MATRIX } from './loop-trigger-config';
import { emitSignal } from '../control-tower/signal-emitter';
import type { LoopExecutorLike } from './main-agent-binding';
import { getBoundMainAgent } from './main-agent-binding';

const log = createLogger('loops/loop-scheduler');

// ═══ 类型定义 ═══

export interface CronSchedulerLike {
  schedule(name: string, cron: string, handler: () => Promise<void>): string;
}

interface RegisteredLoop {
  config: LoopTriggerConfig;
  scales: Map<ScaleName, RegisteredScale>;
}

interface RegisteredScale {
  config: TriggerScale;
  jobId?: string;
  lastEventAt?: Date;
  nextScheduledAt?: Date;
}

export interface TriggerEvent {
  type: string;
  payload?: unknown;
}

export interface NextTriggerInfo {
  loopId: string;
  scale: ScaleName;
  triggerType: TriggerType;
  nextAt: string | null;
  remainingMs: number;
}

// ═══ D223: 心跳 & 停滞 ═══

export interface HeartbeatRecord {
  loopId: string;
  loopName: string;
  lastOutputAt: string;
  cycleCount: number;
}

export interface StagnationReport {
  stalled: string[];
  healthy: string[];
  unknown: string[];
  degraded: boolean;
  checkedAt: string;
}

const STALL_THRESHOLD_CYCLES = 3;
const HEARTBEAT_DIR = join(process.cwd(), '.codex');
const HEARTBEAT_FILE = join(HEARTBEAT_DIR, 'heartbeat.json');

/** 内置循环注册规格（D9/D237/D238）——消息原样保留（探针口径不可漂移） */
interface BuiltinLoopSpec {
  jobName: string;
  cron: string;
  loopId: string;
  scale: ScaleName;
  tag: string;
  /** 未注入时的原始告警串（#975 判据的观测面，逐字保留） */
  skipMessage: string;
  /** 执行完成日志的中文标签（原样保留） */
  doneLabel: string;
}

/**
 * 6 个内置循环的注册规格（#975: 单一机制，消息逐字保留原 D9/D237/D238 措辞）。
 * 顺序与历史实现一致（loop-4 → loop-5 → loop-1 → loop-2 → loop-3 → loop-6）。
 */
const BUILTIN_LOOPS: BuiltinLoopSpec[] = [
  {
    jobName: 'loop-4-self-check', cron: '0 0 * * *', loopId: 'loop-4', scale: 'fast', tag: 'D9',
    skipMessage: '[D9] MainAgent 未注入 — 跳过 loop-4 执行 (degraded)',
    doneLabel: 'loop-4 系统自检完成',
  },
  {
    jobName: 'loop-5-knowledge', cron: '0 0 * * 0', loopId: 'loop-5', scale: 'medium', tag: 'D9',
    skipMessage: '[D9] MainAgent 未注入 — 跳过 loop-5 执行 (degraded)',
    doneLabel: 'loop-5 知识积累完成',
  },
  {
    jobName: 'loop-1-diagnosis', cron: '0 9 1 */3 *', loopId: 'loop-1', scale: 'slow', tag: 'D9',
    skipMessage: '[D9] MainAgent 未注入 — 跳过 loop-1 (degraded)',
    doneLabel: 'loop-1 企业诊断完成',
  },
  {
    jobName: 'loop-2-navigation', cron: '0 9 * * 1', loopId: 'loop-2', scale: 'medium', tag: 'D9',
    skipMessage: '[D9] MainAgent 未注入 — 跳过 loop-2 (degraded)',
    doneLabel: 'loop-2 部门导航完成',
  },
  {
    jobName: 'loop-3-ga-evolution', cron: '0 9 1 */3 *', loopId: 'loop-3', scale: 'slow', tag: 'D237',
    skipMessage: '[D237] MainAgent 未注入 — 跳过 loop-3 (degraded)',
    doneLabel: 'loop-3 GA进化完成',
  },
  {
    jobName: 'loop-6-overflow', cron: '0 9 1 * *', loopId: 'loop-6', scale: 'medium', tag: 'D238',
    skipMessage: '[D238] MainAgent 未注入 — 跳过 loop-6',
    doneLabel: 'loop-6 溢出监控完成',
  },
];

// ═══ LoopScheduler ═══

export class LoopScheduler {
  private loops = new Map<string, RegisteredLoop>();
  private scheduler: CronSchedulerLike | null = null;
  private enabled = true;

  constructor(scheduler?: CronSchedulerLike) {
    this.scheduler = scheduler ?? null;
    this.initHeartbeatDir();
    this.registerHeartbeatCheck();
    this.registerBuiltinLoops();
  }

  /**
   * #975（0-1 循环点火）: 解析本轮触发要用的执行器 —— **唯一注入路径 = 进程级绑定**
   * （src/loops/main-agent-binding.ts:bindMainAgent，由 server.ts 装配期写入）。
   *
   * 铁律 37: 原 `LoopScheduler#setMainAgent`（实例注入）实测零调用（`grep -rn "\.setMainAgent(" src/` = 0），
   * 且与 `src/routes/loops.ts:setMainAgent` 构成"同名陷阱"的另一半 ⇒ 已删除，不做保留式死代码。
   *
   * @returns 执行器 | null
   * @degraded 未绑定 → null（调用方必须 log.warn + 跳过，禁静默）
   */
  private resolveExecutor(): LoopExecutorLike | null {
    return getBoundMainAgent();
  }

  /**
   * #975: 分派一次循环执行（尺度必须透传）。
   * 优先 executeLoopScale(loopId, scale)；缺省回退 executeLoop(loopId, scale)。
   * ⚠️ MainAgent#executeLoop 实为单参（忽略 scale）——直接调用会让 slow/medium 静默降为 fast，
   * 故能走 executeLoopScale 时必须走它。
   */
  private async dispatchLoop(executor: LoopExecutorLike, loopId: string, scale: ScaleName): Promise<{ status: string }> {
    if (typeof executor.executeLoopScale === 'function') {
      return executor.executeLoopScale(loopId, scale);
    }
    return executor.executeLoop(loopId, scale);
  }

  /** 确保心跳目录存在 */
  private initHeartbeatDir(): void {
    try { mkdirSync(HEARTBEAT_DIR, { recursive: true }); } catch { log.warn({}, '心跳目录创建失败 — 降级'); }
  }

  /**
   * D223: 注册 24h 停滞检测任务。
   */
  private registerHeartbeatCheck(): void {
    if (!this.scheduler) return;
    try {
      this.scheduler.schedule('system-heartbeat-check', '0 0 * * *', async () => {
        const report = await this.checkStagnation();
        if (report.stalled.length > 0) {
          log.warn({ stalled: report.stalled, report }, 'SYSTEM_SILENCE — 检测到停滞循环');
          emitSignal('loop-scheduler', 'red', `${report.stalled.length} loops stalled`);
        } else if (report.unknown.length > 0) {
          emitSignal('loop-scheduler', 'yellow', `${report.unknown.length} loops unknown`);
        } else {
          log.info({ healthy: report.healthy.length }, '心跳检查 — 全部循环正常');
          emitSignal('loop-scheduler', 'green', 'all_loops_healthy');
        }
      });
    } catch (err: unknown) {
      log.warn({ err }, '停滞检测任务注册失败 — 降级');
    }
  }

  /**
   * D9/D237/D238: 注册 6 个内置业务循环到 CronScheduler。
   *
   * loop-1 企业诊断（季度，slow）· loop-2 部门导航（周度，medium）· loop-3 GA进化（季度，slow）
   * loop-4 系统自检（每日，fast）· loop-5 知识积累（每周日，medium）· loop-6 溢出监控（月级，medium）
   * 各自 cron 表达式见下方 BUILTIN_LOOPS（唯一事实源，勿在注释里复写）。
   *
   * #975（0-1 循环点火）: 六个循环共用同一注册/分派机制 —— 触发时 resolveExecutor()
   * 解析执行器（显式注入 → 进程级绑定），解析不到才 log.warn + 跳过（铁律 24+31）。
   * 注册规格集中在 BUILTIN_LOOPS；告警/完成日志逐字保留（探针口径不可漂移）。
   *
   * 降级: MainAgent 不可用 → log.warn + 跳过执行。
   */
  private registerBuiltinLoops(): void {
    if (!this.scheduler) {
      log.warn('[D9] CronScheduler 不可用 — 内置循环跳过');
      return;
    }

    try {
      for (const spec of BUILTIN_LOOPS) {
        this.scheduleBuiltinLoop(spec);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '[D9] 内置循环注册失败 — 降级');
    }
  }

  /**
   * #975: 注册一个内置循环 —— 六个循环共用同一点火/分派路径。
   * @input  spec 注册规格（jobName/cron/loopId/scale/tag/消息，见 BUILTIN_LOOPS）
   * @output 无（job 注册进 CronScheduler；handler 在 cron 到点时执行）
   * @degraded 执行器未解析到 → log.warn(spec.skipMessage) + return（不 recordHeartbeat，
   *           否则会把「未点火」伪装成「有产出」）
   */
  private scheduleBuiltinLoop(spec: BuiltinLoopSpec): void {
    if (!this.scheduler) return;
    this.scheduler.schedule(spec.jobName, spec.cron, async () => {
      const executor = this.resolveExecutor();
      if (!executor) {
        log.warn(spec.skipMessage);
        return;
      }
      try {
        const result = await this.dispatchLoop(executor, spec.loopId, spec.scale);
        this.recordHeartbeat(spec.loopId);
        log.info({ status: result.status }, spec.doneLabel);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg }, `${spec.loopId} 执行失败 — degraded`);
      }
    });
    log.info(`[${spec.tag}] ${spec.jobName} 已注册 (${spec.cron})`);
  }

  /**
   * D223: 记录循环心跳。
   * 每次循环执行完成后调用。
   */
  recordHeartbeat(loopId: string): void {
    try {
      const records = this.loadHeartbeats();
      const existing = records.find(r => r.loopId === loopId);
      if (existing) {
        existing.lastOutputAt = new Date().toISOString();
        existing.cycleCount++;
      } else {
        records.push({
          loopId,
          loopName: this.loops.get(loopId)?.config.loopName || loopId,
          lastOutputAt: new Date().toISOString(),
          cycleCount: 1,
        });
      }
      writeFileSync(HEARTBEAT_FILE, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err: unknown) {
      log.warn({ err, loopId }, '心跳记录失败 — 降级');
    }
  }

  /**
   * D223: 检测停滞循环。
   * 对比每循环最后心跳时间 vs 当前时间。
   * 超 3 周期未产出 → 标记 stalled。
   */
  async checkStagnation(): Promise<StagnationReport> {
    const records = this.loadHeartbeats();
    const allLoopIds = [...this.loops.keys()];

    const stalled: string[] = [];
    const healthy: string[] = [];
    const unknown: string[] = [];

    for (const loopId of allLoopIds) {
      const hb = records.find(r => r.loopId === loopId);
      if (!hb) {
        unknown.push(loopId);
        continue;
      }
      const lastOutput = new Date(hb.lastOutputAt).getTime();
      const elapsedHours = (Date.now() - lastOutput) / (1000 * 60 * 60);
      // 3 周期 ≈ 72h 无产出（假设 24h/周期）
      if (elapsedHours > STALL_THRESHOLD_CYCLES * 24) {
        stalled.push(loopId);
      } else {
        healthy.push(loopId);
      }
    }

    const report: StagnationReport = {
      stalled, healthy, unknown,
      degraded: records.length === 0,
      checkedAt: new Date().toISOString(),
    };

    if (stalled.length > 0) {
      log.warn({ stalled, report }, '检测到循环停滞 — SYSTEM_SILENCE');
    }

    return report;
  }

  /** 加载心跳记录 */
  private loadHeartbeats(): HeartbeatRecord[] {
    try {
      if (!existsSync(HEARTBEAT_FILE)) return [];
      const raw = readFileSync(HEARTBEAT_FILE, 'utf-8');
      return JSON.parse(raw) as HeartbeatRecord[];
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "循环任务文件存在检查");
      return [];
    }
  }

  /** 以下为 D91 原有方法（不变） */

  registerDefaultLoops(): number {
    let count = 0;
    for (const config of LOOP_TRIGGER_MATRIX) {
      const result = this.registerLoop(config);
      if (result) count++;
    }
    log.info({ count, total: LOOP_TRIGGER_MATRIX.length }, '默认循环已注册');
    return count;
  }

  registerLoop(config: LoopTriggerConfig): boolean {
    try {
      const errors = validateLoopConfig([config]);
      if (errors.length > 0) {
        log.warn({ loopId: config.loopId, errors }, '循环配置验证失败 — 跳过');
        return false;
      }

      const scales = new Map<ScaleName, RegisteredScale>();

      for (const scale of config.scales) {
        const registered: RegisteredScale = { config: scale };

        if (scale.triggerType === 'cron' || scale.triggerType === 'hybrid') {
          if (this.scheduler) {
            try {
              const jobId = this.scheduler.schedule(
                `loop-${config.loopId}-${scale.name}`,
                scale.period,
                async () => {
                  log.info({ loopId: config.loopId, scale: scale.name }, '循环定时触发');
                  // D223: 循环执行后记录心跳
                  this.recordHeartbeat(config.loopId);
                },
              );
              registered.jobId = jobId;
              registered.nextScheduledAt = new Date(Date.now() + 60000);
            } catch (jobErr: unknown) {
              const msg = jobErr instanceof Error ? jobErr.message : String(jobErr);
              log.warn({ err: msg, loopId: config.loopId, scale: scale.name }, '循环定时任务注册失败 — 降级');
            }
          } else {
            log.warn({ loopId: config.loopId, scale: scale.name }, 'CronScheduler 不可用 — 降级为仅事件触发');
          }
        }

        scales.set(scale.name, registered);
      }

      this.loops.set(config.loopId, { config, scales });
      log.info({ loopId: config.loopId, loopName: config.loopName }, '循环已注册');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, loopId: config.loopId }, '循环注册失败 — 降级');
      return false;
    }
  }

  onEvent(event: TriggerEvent): { loopId: string; scale: ScaleName }[] {
    if (!this.enabled) {
      log.debug({ eventType: event.type }, '调度器已禁用，忽略事件');
      return [];
    }

    const triggered: { loopId: string; scale: ScaleName }[] = [];

    for (const [loopId, loop] of this.loops) {
      for (const [scaleName, scale] of loop.scales) {
        if (scale.config.triggerType === 'cron') continue;

        if (scale.config.eventSource && event.type === scale.config.eventSource) {
          scale.lastEventAt = new Date();
          triggered.push({ loopId, scale: scaleName });
          log.info({ loopId, scale: scaleName, eventType: event.type }, '事件触发循环');
        }
      }
    }

    if (triggered.length === 0) {
      log.debug({ eventType: event.type }, '无匹配循环触发');
    }

    return triggered;
  }

  getNextTrigger(loopId: string, scale: ScaleName): NextTriggerInfo | null {
    const loop = this.loops.get(loopId);
    if (!loop) return null;

    const registered = loop.scales.get(scale);
    if (!registered) return null;

    const cfg = registered.config;

    if (cfg.triggerType === 'event') {
      return { loopId, scale, triggerType: cfg.triggerType, nextAt: null, remainingMs: -1 };
    }

    const now = Date.now();
    const nextAt = registered.nextScheduledAt?.getTime() ?? (now + 3600000);
    const remainingMs = Math.max(0, nextAt - now);

    return { loopId, scale, triggerType: cfg.triggerType, nextAt: new Date(nextAt).toISOString(), remainingMs };
  }

  listLoops(): { loopId: string; loopName: string; scales: ScaleName[] }[] {
    return [...this.loops.values()].map((l) => ({
      loopId: l.config.loopId,
      loopName: l.config.loopName,
      scales: [...l.scales.keys()],
    }));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    log.info({ enabled }, '循环调度器状态已更新');
  }
}
