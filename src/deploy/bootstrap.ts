/**
 * src/deploy/bootstrap.ts — 启动序列编排器 (D83)
 *
 * 6-Phase 启动序列，用于规范化 Server 启动行为。
 * 每 Phase 独立 try-catch，失败按策略处理（fatal→exit / degraded→continue）。
 * Phase 1 支持快照回滚（Schema 迁移失败时）。
 * Phase 2 内部有子顺序 DAG（2a∥2d → 2b → 2c）。
 *
 * Phase 0: 基础设施   — Config, DB, Logger, Audit, 编排层
 * Phase 1: 存储层     — GraphStore, Schema 迁移, AgentMemory
 * Phase 2: 核心引擎   — SentinelLoader(2a) ∥ CausalChain(预留,2d) → SkillLoader(2b) → PlaybookLoader(2c)
 * Phase 3: 本体计算   — ToolRegistry, FileDrivenLoaders, ExtensionRegistry, FederalReporter
 * Phase 4: 专家与安全 — Credentials, PII, Policy, ExpertFiles, KnowledgeServices
 * Phase 5: 交互层     — Cron, MCP, BossMailbox, BudgetTracker, ServiceContainer
 */
import { loadConfig, type SynovaConfig } from '../config';
import { initEngineContext, getDatabase } from '../init/engine-context';
import { AuditService } from '../services/audit-service';
import { EventStore } from '../orchestrator/event-store';
import { EventBus } from '../orchestrator/event-bus';
import { HookRunner } from '../orchestrator/hook-runner';
import { SessionManager } from '../orchestrator/session-manager';
import { SessionStore } from '../store/session-store';
// M3 修复（D597/D588）：副作用导入——session-projection 模块加载时原型级 wrap
// SessionStore.prototype.appendEvent，生产 8+ 构造点零修改自动获得投影 drive（import 即接线）。
// 无此行 = wrap 从未触发 = 投影死代码（铁律 0-2 接线）。
import '../store/session-projection';
// M3 修复（D810）：副作用导入——retry-projection 模块加载时经 registerProjection 注册
// llm_retry 计数单元；无此行 = 投影单元从未注册（appendEvent 落的重试事件无人投影）。
// 与上行 session-projection 同范式（import 即接线，铁律 0-2）。
import '../store/retry-projection';
import { PhaseStateMachine } from '../orchestrator/phase-state-machine';
import { createOrchestrationWiring, type OrchestrationWiring } from '../orchestrator/wiring';
import { ToolRegistry } from '../agent/tools';
import { createLogger } from '@synova/logger';
import type { Database } from 'better-sqlite3';

const log = createLogger('deploy/bootstrap');

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/** Phase 定义 — 描述一个启动阶段的行为和失败策略 */
export interface PhaseDefinition {
  /** Phase 编号 (0-5) */
  id: number;
  /** 唯一名称 */
  name: string;
  /** 人类可读描述 */
  description: string;
  /** true = 此 Phase 失败会导致启动终止 (exit(1)) */
  fatal: boolean;
  /** true = 此 Phase 失败时触发快照回滚 */
  rollbackOnFail?: boolean;
  /** 执行体，接收 BootstrapContext 做服务累加 */
  execute: (ctx: BootstrapContext) => Promise<void>;
  /** 回滚回调，rollbackOnFail=true 时在 fatal 退出前调用 */
  rollback?: (ctx: BootstrapContext) => Promise<void>;
  /** 超时毫秒 (默认 60000) */
  timeoutMs?: number;
}

/** Phase 执行结果 */
export interface PhaseResult {
  phaseId: number;
  name: string;
  /** 状态 */
  status: 'success' | 'degraded' | 'failed' | 'skipped';
  /** 执行耗时 (ms) */
  durationMs: number;
  /** 错误信息列表 */
  errors: string[];
  /** Phase 2 内部子 Phase 结果 */
  subPhaseResults?: PhaseResult[];
}

/** Bootstrap 总体结果 */
export interface BootstrapResult {
  /** 是否全部成功 (不含 degraded) */
  ok: boolean;
  /** 是否有降级运行 */
  degraded: boolean;
  /** 是否因 fatal 中断 */
  aborted: boolean;
  /** 各 Phase 执行结果 */
  phaseResults: PhaseResult[];
  /** 已初始化服务容器 */
  services: BootstrapServices;
}

/** 已初始化服务 — 从 bootstrap 传递给 server.ts */
export interface BootstrapServices {
  config: SynovaConfig;
  db: Database;
  eventStore: EventStore;
  eventBus: EventBus;
  hookRunner: HookRunner;
  sessionManager: SessionManager;
  /** D487: 会话事件 store — 诊断事件落 session_events 的装配源 */
  sessionStore: SessionStore;
  stateMachine: PhaseStateMachine;
  wiring: OrchestrationWiring;
  graphStore?: unknown;
  agentMemory?: unknown;
  connectorToolRegistry?: ToolRegistry;
  credentialVault?: unknown;
  credentialPool?: unknown;
  piiScrubber?: unknown;
  fileScanner?: unknown;
  expertFileLoader?: unknown;
  federalAdapter?: unknown;
  /** 降级模块追踪列表 */
  degradedModules: Array<{ phase: number; module: string; error: string }>;
}

/** 降级项 */
interface DegradedEntry {
  phase: number;
  module: string;
  error: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// BootstrapContext — 内部累加器
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bootstrap 内部的状态累加器。
 * Phase 执行体通过此对象存储已初始化服务、记录降级、传递数据。
 * 不导出 — 外部通过 PhaseDefinition.execute 参数类型推断获得类型。
 */
class BootstrapContext {
  private storage = new Map<string, unknown>();
  private _degradedModules: DegradedEntry[] = [];
  /** Phase 1 回滚用的快照路径 */
  preMigrationSnapshotPath: string | undefined;

  /**
   * 存入一个已初始化的服务实例。
   * @param key  唯一键名
   * @param value 服务实例
   */
  set<T>(key: string, value: T): void {
    this.storage.set(key, value);
  }

  /**
   * 获取一个已初始化的服务实例。
   * @param key 唯一键名
   * @returns 服务实例或 undefined
   */
  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  /**
   * 获取一个必须存在的服务实例。不存在时抛出详细错误。
   * @param key 唯一键名
   * @returns 服务实例 (非空)
   */
  require<T>(key: string): T {
    const value = this.storage.get(key) as T | undefined;
    if (value === undefined) {
      throw new Error(`BootstrapContext: 缺少必需服务 "${key}" — 请检查 Phase 执行顺序`);
    }
    return value;
  }

  /**
   * 记录一个降级模块。
   * @param phase  Phase 编号
   * @param module 模块名称
   * @param error  错误描述
   */
  addDegraded(phase: number, module: string, error: string): void {
    this._degradedModules.push({ phase, module, error });
  }

  /** 获取所有降级模块列表 */
  get degradedModules(): DegradedEntry[] {
    return this._degradedModules;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap 类
// ═══════════════════════════════════════════════════════════════════════════

/** Bootstrap 构造选项 */
export interface BootstrapOptions {
  /** 跳过注册默认 Phase (用于测试) */
  skipDefaultPhases?: boolean;
}

/**
 * Bootstrap 启动序列编排器。
 *
 * 协调 6 个 Phase 的启动顺序，实现:
 * - 顺序执行 (0→1→2→3→4→5)
 * - Phase 0/1 fatal 失败 → 提前终止启动
 * - Phase 2-4 失败 → degraded + 继续后续
 * - Phase 1 Schema 迁移失败 → 快照回滚
 * - Phase 2 内部 DAG: 2a∥2d → 2b → 2c
 * - 每 Phase 记录执行时间 + 结果
 * - 热重载接口预留 (reload)
 */
export class Bootstrap {
  private phases: Map<number, PhaseDefinition> = new Map();
  private ctx = new BootstrapContext();
  private results: PhaseResult[] = [];
  private aborted = false;

  constructor(options?: BootstrapOptions) {
    if (!options?.skipDefaultPhases) {
      this.registerDefaultPhases();
    }
  }

  /**
   * 注册一个 Phase。
   * 用于构造时自动注册默认 Phase，或在测试中注入自定义 Phase。
   */
  registerPhase(def: PhaseDefinition): void {
    this.phases.set(def.id, def);
  }

  /**
   * 执行所有已注册 Phase。
   * @returns BootstrapResult — 启动结果
   */
  async run(): Promise<BootstrapResult> {
    this.aborted = false;
    this.results = [];
    this.ctx = new BootstrapContext();

    const orderedIds = [0, 1, 2, 3, 4, 5];
    for (const phaseId of orderedIds) {
      if (this.aborted) break;

      const def = this.phases.get(phaseId);
      if (!def) {
        // 未注册的 Phase 视为 skipped
        this.results.push({
          phaseId,
          name: `phase-${phaseId}`,
          status: 'skipped',
          durationMs: 0,
          errors: [],
        });
        continue;
      }

      await this.runPhase(def);
    }

    return this.buildResult();
  }

  /**
   * 热重载接口（预留，D83 不实现）。
   * MVS 阶段后实现完整的热重载协议。
   *
   * @param _sentinelId 哨兵 ID
   * @returns 操作结果
   */
  async reload(_sentinelId: string): Promise<{ ok: boolean; error?: string }> {
    log.warn({ sentinelId: _sentinelId }, '[D83] 热重载接口—预留，未实现');
    return { ok: false, error: '热重载接口预留（D83 范围未实现）' };
  }

  // ─── 内部方法 ───

  /**
   * 执行单个 Phase。
   * 包含超时控制、错误处理、fatal 判断、回滚触发。
   */
  private async runPhase(def: PhaseDefinition): Promise<void> {
    if (this.aborted) return;

    const start = Date.now();
    const timeoutMs = def.timeoutMs ?? 60_000;
    const errors: string[] = [];

    try {
      await this.withTimeout(def.execute(this.ctx), timeoutMs);

      // 检查是否有降级
      const phaseDegraded = this.ctx.degradedModules.some((d) => d.phase === def.id);
      const subResults = this.ctx.get<PhaseResult[]>('_phase2SubResults');
      const hasSubDegraded = subResults?.some((r) => r.status === 'degraded' || r.status === 'failed');
      this.results.push({
        phaseId: def.id,
        name: def.name,
        status: (phaseDegraded || hasSubDegraded) ? 'degraded' : 'success',
        durationMs: Date.now() - start,
        errors: [],
        subPhaseResults: subResults,
      });

      log.info({ phase: def.name, durationMs: Date.now() - start }, `Phase ${def.id} 完成`);
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "超时包装执行");
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      log.error({ phase: def.name, error: msg }, `Phase ${def.id} 失败`);

      // 回滚 (Phase 1 Schema 迁移失败)
      if (def.rollbackOnFail && def.rollback) {
        try {
          await def.rollback(this.ctx);
          log.warn({ phase: def.name }, `Phase ${def.id} 回滚完成`);
        } catch (rollbackErr: unknown) {
          const rollbackMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          log.error({ phase: def.name, error: rollbackMsg }, `Phase ${def.id} 回滚也失败 — 数据可能已损坏`);
          errors.push(`回滚失败: ${rollbackMsg}`);
        }
      }

      this.results.push({
        phaseId: def.id,
        name: def.name,
        status: 'failed',
        durationMs: Date.now() - start,
        errors,
      });

      if (def.fatal) {
        this.aborted = true;
        log.error({ phase: def.name, errors }, `Phase ${def.id} fatal — 启动终止`);
      } else {
        log.warn({ phase: def.name, errors }, `Phase ${def.id} 失败 — 降级继续`);
      }
    }
  }

  /**
   * Phase 2 内部 DAG 执行器。
   * Level 0: 2a (SentinelLoader) + 2d (CausalChainLoader stub) 并行
   * Level 1: 2b (SkillLoader) — 依赖 2a 完成
   * Level 2: 2c (PlaybookLoader) — 依赖 2b 完成
   * 返回 subPhaseResults，由 runPhase() 写入最终结果。
   */
  private async runPhase2Internal(): Promise<{ subResults: PhaseResult[]; }> {
    const subResults: PhaseResult[] = [];

    // Level 0: 2a ∥ 2d
    await Promise.all([
      this.runPhase2a(subResults),
      this.runPhase2d(subResults),
    ]);

    // Level 1: 2b (依赖 2a sentinel 注册)
    await this.runPhase2b(subResults);

    // Level 2: 2c (依赖 2b skill 注册)
    await this.runPhase2c(subResults);

    // Level 3: 2e — 循环调度器注册 (D91)
    await this.runPhase2e(subResults);

    // Level 4: 2f — MainAgent 注册 (D8a)
    await this.runPhase2f(subResults);

    log.info({
      subPhases: subResults.map((r) => ({ name: r.name, status: r.status, durationMs: r.durationMs })),
    }, 'Phase 2 子 Phase 完成');

    return { subResults };
  }

  /**
   * Phase 2a: SentinelLoader (src/sentinel/sentinel-loader.ts)
   * 扫描 extensions/sentinels/ 目录，加载哨兵定义并注册。
   */
  private async runPhase2a(subResults: PhaseResult[]): Promise<void> {
    const start = Date.now();
    try {
      const { loadSentinels, registerLoadedSentinels } = await import('../sentinel/sentinel-loader');
      const { sentinels, degraded, errors: loadErrors } = loadSentinels();
      if (degraded) {
        for (const e of loadErrors) {
          this.ctx.addDegraded(2, 'sentinel-loader', e);
        }
        log.warn({ errors: loadErrors }, 'Phase 2a: SentinelLoader 降级');
      }
      const regResult = await registerLoadedSentinels();
      if (regResult.errors.length > 0) {
        for (const e of regResult.errors) {
          this.ctx.addDegraded(2, 'sentinel-register', e);
        }
      }
      log.info({ sentinels: sentinels.length, registered: regResult.registered }, 'Phase 2a: SentinelLoader 完成');
      subResults.push({
        phaseId: 2,
        name: 'sentinel-loader',
        status: degraded || regResult.errors.length > 0 ? 'degraded' : 'success',
        durationMs: Date.now() - start,
        errors: [...loadErrors, ...regResult.errors],
      });
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.addDegraded(2, 'sentinel-loader', msg);
      log.warn({ err: msg }, 'Phase 2a: SentinelLoader 失败 — 降级');
      subResults.push({
        phaseId: 2,
        name: 'sentinel-loader',
        status: 'degraded',
        durationMs: Date.now() - start,
        errors: [msg],
      });
    }
  }

  /**
   * Phase 2b: SkillLoader (src/skill/skill-loader.ts)
   * 依赖 2a 哨兵已注册。扫描 extensions/skills/ 目录加载技能。
   */
  private async runPhase2b(subResults: PhaseResult[]): Promise<void> {
    const start = Date.now();
    try {
      const { loadSkills, registerLoadedSkills } = await import('../skill/skill-loader');
      const { skills, degraded, errors: loadErrors } = loadSkills();
      if (degraded) {
        for (const e of loadErrors) {
          this.ctx.addDegraded(2, 'skill-loader', e);
        }
      }
      const regResult = await registerLoadedSkills();
      if (regResult.errors.length > 0) {
        for (const e of regResult.errors) {
          this.ctx.addDegraded(2, 'skill-register', e);
        }
      }
      log.info({ skills: skills.length, registered: regResult.registered }, 'Phase 2b: SkillLoader 完成');
      subResults.push({
        phaseId: 2,
        name: 'skill-loader',
        status: degraded || regResult.errors.length > 0 ? 'degraded' : 'success',
        durationMs: Date.now() - start,
        errors: [...loadErrors, ...regResult.errors],
      });
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.addDegraded(2, 'skill-loader', msg);
      log.warn({ err: msg }, 'Phase 2b: SkillLoader 失败 — 降级');
      subResults.push({
        phaseId: 2,
        name: 'skill-loader',
        status: 'degraded',
        durationMs: Date.now() - start,
        errors: [msg],
      });
    }
  }

  /**
   * Phase 2c: PlaybookLoader (src/playbook/playbook-loader.ts)
   * 依赖 2b 技能已注册。扫描 extensions/playbooks/ 目录加载剧本。
   */
  private async runPhase2c(subResults: PhaseResult[]): Promise<void> {
    const start = Date.now();
    try {
      const { loadPlaybooks, registerLoadedPlaybooks } = await import('../playbook/playbook-loader');
      const { playbooks, degraded, errors: loadErrors } = loadPlaybooks();
      if (degraded) {
        for (const e of loadErrors) {
          this.ctx.addDegraded(2, 'playbook-loader', e);
        }
      }
      const regResult = await registerLoadedPlaybooks();
      if (regResult.errors.length > 0) {
        for (const e of regResult.errors) {
          this.ctx.addDegraded(2, 'playbook-register', e);
        }
      }
      log.info({ playbooks: playbooks.length, registered: regResult.registered }, 'Phase 2c: PlaybookLoader 完成');
      subResults.push({
        phaseId: 2,
        name: 'playbook-loader',
        status: degraded || regResult.errors.length > 0 ? 'degraded' : 'success',
        durationMs: Date.now() - start,
        errors: [...loadErrors, ...regResult.errors],
      });
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.addDegraded(2, 'playbook-loader', msg);
      log.warn({ err: msg }, 'Phase 2c: PlaybookLoader 失败 — 降级');
      subResults.push({
        phaseId: 2,
        name: 'playbook-loader',
        status: 'degraded',
        durationMs: Date.now() - start,
        errors: [msg],
      });
    }
  }

  /**
   * Phase 2d: CausalChainLoader (预留)
   * D83 仅声明接口，不实现实际加载逻辑。
   * MVS 阶段后实现。
   */
  private async runPhase2d(subResults: PhaseResult[]): Promise<void> {
    const start = Date.now();
    // 预留 — 未来实现因果链 YAML 加载
    log.info('Phase 2d: CausalChainLoader — 预留接口，未实现 (D83 范围)');
    subResults.push({
      phaseId: 2,
      name: 'causal-chain-loader',
      status: 'success',
      durationMs: Date.now() - start,
      errors: [],
    });
  }

  /**
   * Phase 2e: 循环调度器注册 (D91 Multi-scale Trigger Matrix)。
   * 注册 6 循环 × 3 尺度的触发配置到 LoopScheduler。
   * 降级: LoopScheduler 不可用时仅记录日志，不阻断启动。
   */
  private async runPhase2e(subResults: PhaseResult[]): Promise<void> {
    const start = Date.now();
    try {
      const { LoopScheduler } = await import('../loops/loop-scheduler');
      const { getGlobalScheduler } = await import('../cron/scheduler');
      const db = this.ctx.get<import('better-sqlite3').Database>('db');
      const scheduler = db ? getGlobalScheduler(db) : undefined;
      const loopScheduler = new LoopScheduler(scheduler);
      const count = loopScheduler.registerDefaultLoops();
      this.ctx.set('loopScheduler', loopScheduler);
      log.info({ loops: count }, 'Phase 2e: 循环调度器注册完成');
      subResults.push({
        phaseId: 2,
        name: 'loop-scheduler',
        status: 'success',
        durationMs: Date.now() - start,
        errors: [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, 'Phase 2e: 循环调度器注册失败 — 降级');
      this.ctx.addDegraded(2, 'loop-scheduler', msg);
      subResults.push({
        phaseId: 2,
        name: 'loop-scheduler',
        status: 'degraded',
        durationMs: Date.now() - start,
        errors: [msg],
      });
    }
  }

  /**
   * Phase 2f: MainAgent 注册 (D8a L2 Main Agent)。
   * 从 LOOP_TRIGGER_MATRIX 注册 6 个循环到 MainAgent。
   * 降级: MainAgent 初始化失败时仅记录日志，不阻断启动。
   */
  private async runPhase2f(subResults: PhaseResult[]): Promise<void> {
    const start = Date.now();
    try {
      const { MainAgent } = await import('../agent/main-agent');
      const { LOOP_TRIGGER_MATRIX } = await import('../loops/loop-trigger-config');
      const mainAgent = new MainAgent();
      for (const config of LOOP_TRIGGER_MATRIX) {
        mainAgent.registerLoop(config);
      }
      this.ctx.set('mainAgent', mainAgent);
      log.info({ loops: LOOP_TRIGGER_MATRIX.length }, 'Phase 2f: MainAgent 注册完成');
      subResults.push({
        phaseId: 2,
        name: 'main-agent',
        status: 'success',
        durationMs: Date.now() - start,
        errors: [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, 'Phase 2f: MainAgent 注册失败 — 降级');
      this.ctx.addDegraded(2, 'main-agent', msg);
      subResults.push({
        phaseId: 2,
        name: 'main-agent',
        status: 'degraded',
        durationMs: Date.now() - start,
        errors: [msg],
      });
    }
  }

  /**
   * 带超时的 Promise 执行。
   * 超时后 reject 而非悬挂。
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Phase 超时 (${ms}ms)`)), ms);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * 构建最终 BootstrapResult。
   * 汇总所有 Phase 结果、降级信息、服务容器。
   */
  private buildResult(): BootstrapResult {
    const hasFailed = this.results.some((r) => r.status === 'failed');
    const hasDegraded = this.results.some((r) => r.status === 'degraded')
      || this.ctx.degradedModules.length > 0;

    return {
      ok: !hasFailed || !this.aborted,
      degraded: hasDegraded,
      aborted: this.aborted,
      phaseResults: this.results,
      services: this.buildServices(),
    };
  }

  /**
   * 从 BootstrapContext 提取服务，构建 BootstrapServices。
   * 使用 get() 而非 require() 以确保降级场景下不崩溃。
   */
  private buildServices(): BootstrapServices {
    return {
      config: this.ctx.get<SynovaConfig>('config')!,
      db: this.ctx.get<Database>('db')!,
      eventStore: this.ctx.get<EventStore>('eventStore')!,
      eventBus: this.ctx.get<EventBus>('eventBus')!,
      hookRunner: this.ctx.get<HookRunner>('hookRunner')!,
      sessionManager: this.ctx.get<SessionManager>('sessionManager')!,
      sessionStore: this.ctx.get<SessionStore>('sessionStore')!,
      stateMachine: this.ctx.get<PhaseStateMachine>('stateMachine')!,
      wiring: this.ctx.get<OrchestrationWiring>('wiring')!,
      graphStore: this.ctx.get('graphStore'),
      agentMemory: this.ctx.get('agentMemory'),
      connectorToolRegistry: this.ctx.get('connectorToolRegistry'),
      credentialVault: this.ctx.get('credentialVault'),
      credentialPool: this.ctx.get('credentialPool'),
      piiScrubber: this.ctx.get('piiScrubber'),
      fileScanner: this.ctx.get('fileScanner'),
      expertFileLoader: this.ctx.get('expertFileLoader'),
      federalAdapter: this.ctx.get('federalAdapter'),
      degradedModules: this.ctx.degradedModules,
    };
  }

  /**
   * 注册默认 Phase 0-5。
   */
  private registerDefaultPhases(): void {
    // ─── Phase 0: 基础设施 (fatal) ───
    this.registerPhase({
      id: 0,
      name: 'infrastructure',
      description: 'DB, Config, Logger, 编排层 (EventBus/StateMachine)',
      fatal: true,
      timeoutMs: 30_000,
      execute: async (ctx: BootstrapContext) => {
        // 0a: 全局错误兜底在 server.ts app.listen 中注册
        // (因为需要 Server 实例)

        // 0b: 配置加载
        const config = loadConfig();
        ctx.set('config', config);
        log.info({ port: config.port, devMode: config.devMode }, '配置已加载');

        // 0c: 数据库 + 引擎初始化
        initEngineContext();
        const db = getDatabase();
        ctx.set('db', db);
        log.info('数据库已初始化 (SQLite WAL)');

        // 0d: 审计日志
        AuditService.init(db);
        log.info('审计服务已初始化');

        // 0e: 编排层 — EventBus + StateMachine + SessionManager
        const eventStore = new EventStore(db);
        const eventBus = new EventBus(eventStore);
        const hookRunner = new HookRunner();
        // D500: 注入 SessionStore 启用事件溯源（model-visible⟺logged 生产装配；
        // SessionManager 注入为可选参数，无 db 环境仍兼容）
        // D487: store 提升为具名实例并注册到 ctx —— ConversationEngine 经
        // EngineConfig.sessionStore 装配，诊断事件落 session_events
        const sessionStore = new SessionStore(db);
        const sessionManager = new SessionManager({}, sessionStore);
        const stateMachine = new PhaseStateMachine({
          0: { label: '目标访谈', required: true, maxDurationMs: 600_000 },
          1: { label: '数据采集', required: true, maxDurationMs: 120_000 },
          2: { label: '假设生成', required: true, maxDurationMs: 300_000 },
          3: { label: '障碍分析', required: true, maxDurationMs: 180_000 },
          4: { label: '简报生成', required: true, maxDurationMs: 60_000 },
          5: { label: '交付', required: true, maxDurationMs: 120_000 },
        });
        const wiring = createOrchestrationWiring(eventBus, hookRunner, sessionManager, stateMachine);

        ctx.set('eventStore', eventStore);
        ctx.set('eventBus', eventBus);
        ctx.set('hookRunner', hookRunner);
        ctx.set('sessionManager', sessionManager);
        ctx.set('sessionStore', sessionStore);
        ctx.set('stateMachine', stateMachine);
        ctx.set('wiring', wiring);
        log.info('编排层已初始化 (EventBus + PhaseStateMachine + SessionManager)');
      },
    });

    // ─── Phase 1: 存储层 (fatal + rollback) ───
    this.registerPhase({
      id: 1,
      name: 'storage',
      description: 'GraphStore, Schema 迁移, AgentMemory',
      fatal: true,
      rollbackOnFail: true,
      timeoutMs: 60_000,
      execute: async (ctx: BootstrapContext) => {
        const config = ctx.require<SynovaConfig>('config');

        // 1a: 预迁移快照 (回滚点)
        try {
          const { createSnapshot } = await import('./rollback');
          const snap = createSnapshot('pre-schema-migration');
          if (snap.created) {
            ctx.preMigrationSnapshotPath = snap.path;
            log.info({ path: snap.path }, '预迁移快照已创建');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, '预迁移快照创建失败 — 回滚不可用');
        }

        // 1b: DB 解密
        const encryptionConfig = {
          masterSecret: process.env.CREDENTIAL_MASTER_KEY || config.engineTokens || (config.devMode ? 'synova-dev-secret' : ''),
          salt: config.dbPath,
          dbPath: config.dbPath,
        };
        try {
          const { autoDecryptOnStartup } = await import('../services/db-encryption');
          const wasEncrypted = autoDecryptOnStartup(encryptionConfig);
          if (wasEncrypted) log.info('数据库启动时已解密');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'DB 解密 — 降级');
          ctx.addDegraded(1, 'db-decrypt', msg);
        }

        // 1c: GraphStore + OntologyEventBus (D286: 原生 SqliteGraphStore 统一)
        try {
          const { SqliteGraphStore } = await import('../adapters/sqlite-graph-store');
          const store = new SqliteGraphStore(ctx.require<Database>('db'));
          ctx.set('graphStore', store);
          const { getOntologyEventBus } = await import('../l5/ontology-event-bus');
          getOntologyEventBus(store as never);

          log.info('GraphStore + OntologyEventBus 已初始化');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'GraphStore 初始化失败 — 降级');
          ctx.addDegraded(1, 'graphstore', msg);
        }

        // 1d: AgentMemoryStore
        try {
          const { getAgentMemoryStore } = await import('../l4/agent-memory-store');
          const db = ctx.require<Database>('db');
          const agentMemory = getAgentMemoryStore(db);
          ctx.set('agentMemory', agentMemory);
          log.info('AgentMemoryStore 已初始化');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'AgentMemoryStore 初始化失败 — 降级');
          ctx.addDegraded(1, 'agent-memory', msg);
        }
      },
      rollback: async (ctx: BootstrapContext) => {
        if (ctx.preMigrationSnapshotPath) {
          const { rollbackToSnapshot } = await import('./rollback');
          const rollResult = rollbackToSnapshot(ctx.preMigrationSnapshotPath);
          if (!rollResult.success) {
            log.error({
              snapshot: ctx.preMigrationSnapshotPath,
              result: rollResult,
            }, 'CRITICAL: Schema 迁移失败后回滚也失败 — 数据可能已损坏');
          } else {
            log.info({ snapshot: ctx.preMigrationSnapshotPath }, 'Schema 迁移回滚完成');
          }
        } else {
          log.warn('无可用快照 — 跳过回滚');
        }
      },
    });

    // Phase 2 内部 DAG: 2a∥2d → 2b → 2c
    this.registerPhase({
      id: 2,
      name: 'core-engine',
      description: 'SentinelLoader(2a) ∥ CausalChain(2d) → SkillLoader(2b) → PlaybookLoader(2c)',
      fatal: false,
      execute: async (ctx: BootstrapContext) => {
        const { subResults } = await this.runPhase2Internal();
        // 子 Phase 结果存入 ctx，runPhase 检查 degraded 时使用
        ctx.set('_phase2SubResults', subResults);
      },
    });

    // ─── Phase 3: 本体计算 (degraded) ───
    this.registerPhase({
      id: 3,
      name: 'ontology-compute',
      description: 'ToolRegistry, FileDrivenLoaders, ExtensionRegistry, FederalReporter',
      fatal: false,
      timeoutMs: 60_000,
      execute: async (ctx: BootstrapContext) => {
        const config = ctx.require<SynovaConfig>('config');
        const db = ctx.require<Database>('db');

        // 3a: ConnectorToolRegistry + bindConnectorTools
        try {
          const { bindConnectorTools } = await import('../init/connector-binding');
          const registry = new ToolRegistry();
          bindConnectorTools(registry);
          ctx.set('connectorToolRegistry', registry);
          log.info('Phase 3a: Connector 工具绑定完成');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 3a: Connector 工具绑定失败 — 降级');
          ctx.addDegraded(3, 'connector-tools', msg);
        }

        // 3b: 文件驱动加载器 (i18n/报告/框架/通知/哨兵/规则/本体/适配器)
        try {
          const { initFileDrivenLoaders } = await import('../init/file-driven-loaders');
          await initFileDrivenLoaders();
          log.info('Phase 3b: 文件驱动加载器初始化完成');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 3b: 文件驱动加载器初始化失败 — 降级');
          ctx.addDegraded(3, 'file-driven-loaders', msg);
        }

        // 3c: ExtensionRegistry discover
        try {
          const { getExtensionRegistry } = await import('@synova/extension-registry');
          const registry = getExtensionRegistry();
          const manifests = await registry.discover('extensions');
          log.info({ count: manifests.length }, 'Phase 3c: ExtensionRegistry discover 完成');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 3c: ExtensionRegistry discover 失败 — 降级');
          ctx.addDegraded(3, 'extension-registry', msg);
        }

        // 3d: FederalReporter (联邦进化)
        try {
          const { initFederalReporter, getFederalAdapter } = await import('../adapters/federal-adapter');
          const adapter = await initFederalReporter(db, { epsilon: 1.0, optOut: config.devMode });
          ctx.set('federalAdapter', adapter);
          log.info('Phase 3d: 联邦进化上报已启用');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 3d: 联邦进化初始化失败 — 降级');
          ctx.addDegraded(3, 'federal-reporter', msg);
          try {
            const { getFederalAdapter } = await import('../adapters/federal-adapter');
            ctx.set('federalAdapter', getFederalAdapter());
          } catch (err) {
            log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
            // getFederalAdapter 也不可能时，仅记录
            ctx.addDegraded(3, 'federal-adapter-fallback', '联邦适配器降级失败');
          }
        }
      },
    });

    // ─── Phase 4: 专家与安全 (degraded) ───
    this.registerPhase({
      id: 4,
      name: 'expert-security',
      description: 'Credentials, PII, Policy, ExpertFiles, KnowledgeServices',
      fatal: false,
      timeoutMs: 60_000,
      execute: async (ctx: BootstrapContext) => {
        const config = ctx.require<SynovaConfig>('config');
        const db = ctx.require<Database>('db');

        // 4a: CredentialVault
        try {
          const { CredentialVault } = await import('../security/credential-vault');
          const masterSecret = process.env.CREDENTIAL_MASTER_KEY || config.engineTokens || (config.devMode ? 'synova-dev-secret' : '');
          const vault = new CredentialVault(db, masterSecret, config.dbPath);
          ctx.set('credentialVault', vault);
          log.info('Phase 4a: CredentialVault 已初始化 (AES-256-GCM)');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4a: CredentialVault 初始化失败 — 降级, 凭证仍走 .env');
          ctx.addDegraded(4, 'credential-vault', msg);
        }

        // 4b: CredentialPool
        try {
          const vault = ctx.get<{ list(): Array<{ id: string }>; decryptForSubprocess(id: string): string | null }>('credentialVault');
          if (vault) {
            const { CredentialPool } = await import('../security/credential-vault');
            const pool = new (CredentialPool as new () => { register(id: string, data: unknown): void })();
            for (const cred of vault.list()) {
              const decrypted = vault.decryptForSubprocess(cred.id);
              if (decrypted) {
                try { pool.register(cred.id, JSON.parse(decrypted)); } catch {
                  log.warn({ credentialId: cred.id }, '单个凭证解析失败 — 跳过');
                }
              }
            }
            ctx.set('credentialPool', pool);
            log.info('Phase 4b: CredentialPool 已初始化 (多凭据轮换)');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4b: CredentialPool 初始化失败 — 降级');
          ctx.addDegraded(4, 'credential-pool', msg);
        }

        // 4c: PIIScrubber
        try {
          const { PIIScrubber } = await import('../security/pii-scrubber');
          const scrubber = new (PIIScrubber as new () => unknown)();
          ctx.set('piiScrubber', scrubber);
          log.info('Phase 4c: PIIScrubber 已初始化 (S1-S4 敏感度脱敏)');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4c: PIIScrubber 初始化失败 — 降级');
          ctx.addDegraded(4, 'pii-scrubber', msg);
        }

        // 4d: ConfigRecovery 配置检查
        try {
          const { ConfigRecovery } = await import('../services/config-recovery');
          const result = ConfigRecovery.verify(config.dbPath + '.config.json');
          if (!result.ok && result.corrupted) {
            log.warn({ result }, 'Phase 4d: 配置文件损坏 — 降级默认配置');
            ctx.addDegraded(4, 'config-recovery', '配置文件损坏');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4d: 配置恢复检查失败 — degraded');
          ctx.addDegraded(4, 'config-recovery', msg);
        }

        // 4e: Knowledge 服务
        try {
          const { KnowledgeInjector, KnowledgeConflictHandler, AtomicWriter } = await import('../agent/index');
          const knowledgeInjector = new KnowledgeInjector(process.cwd());
          const knowledgeConflicts = new KnowledgeConflictHandler(db);
          const atomicWriter = new AtomicWriter(process.cwd());
          atomicWriter.cleanup();
          ctx.set('knowledgeInjector', knowledgeInjector);
          ctx.set('knowledgeConflicts', knowledgeConflicts);
          ctx.set('atomicWriter', atomicWriter);
          log.info('Phase 4e: Knowledge 服务已初始化');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4e: Knowledge 服务初始化失败 — 降级');
          ctx.addDegraded(4, 'knowledge-services', msg);
        }

        // 4f: BehaviorMonitor
        try {
          await import('../services/behavior-monitor');
          log.info('Phase 4f: BehaviorMonitor 已加载 — 4 rules active');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4f: BehaviorMonitor 加载失败 — 降级');
          ctx.addDegraded(4, 'behavior-monitor', msg);
        }

        // 4g: ExpertConfigLoader
        try {
          const { loadExpertConfig } = await import('../agent/expert-config-loader');
          const expertConfig = loadExpertConfig();
          const expertCount = Object.keys(expertConfig.experts || {}).length;
          log.info({ experts: expertCount }, 'Phase 4g: 专家配置已加载');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4g: 专家配置加载失败 — 降级');
          ctx.addDegraded(4, 'expert-config', msg);
        }

        // 4h: PolicyEngine 验证
        try {
          const { PolicyEngine } = await import('../security/policy-engine');
          // PolicyEngine 是纯逻辑，无 IO — 只需要确认能 import 即可
          new PolicyEngine();
          log.info('Phase 4h: PolicyEngine 已验证');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4h: PolicyEngine 验证失败 — 降级');
          ctx.addDegraded(4, 'policy-engine', msg);
        }

        // 4i: FileScanner + ExpertFileLoader (文件优先范式)
        try {
          const { FileScanner } = await import('../agent/file-scanner');
          const { ExpertFileLoader } = await import('../agent/expert-file-loader');
          const fileScanner = new FileScanner();
          const expertFileLoader = new ExpertFileLoader();
          const index = fileScanner.scan();
          const loadResult = expertFileLoader.loadFromIndex(index, {});
          ctx.set('fileScanner', fileScanner);
          ctx.set('expertFileLoader', expertFileLoader);
          log.info({
            fromFiles: loadResult.fromFiles,
            total: loadResult.loaded.length,
          }, 'Phase 4i: 专家文件加载完成');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4i: 专家文件加载失败 — 降级, 使用代码默认 prompt');
          ctx.addDegraded(4, 'expert-files', msg);
        }

        // 4j: Workspace 服务初始化
        try {
          const { buildInheritedContext, detectConflicts } = await import('../agent/workspace-service');
          buildInheritedContext({
            parentId: 'init',
            department: 'dept',
            title: 'init',
            source: 'boss_assigned',
            parentSummary: 'init',
          });
          detectConflicts([]);
          log.info('Phase 4j: Workspace 服务已就绪');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 4j: Workspace 服务初始化失败 — 降级');
          ctx.addDegraded(4, 'workspace-service', msg);
        }
      },
    });

    // ─── Phase 5: 交互层 (degraded) ───
    this.registerPhase({
      id: 5,
      name: 'interaction',
      description: 'Cron, MCP, BossMailbox, BudgetTracker, 运行时服务',
      fatal: false,
      timeoutMs: 60_000,
      execute: async (ctx: BootstrapContext) => {
        const config = ctx.require<SynovaConfig>('config');
        const db = ctx.require<Database>('db');

        // 5a: BudgetTracker
        try {
          const { getBudgetTracker } = await import('../services/context-budget-tracker');
          ctx.set('budgetTracker', getBudgetTracker());
          log.info('Phase 5a: 上下文预算追踪器已初始化');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5a: BudgetTracker 初始化失败 — 降级');
          ctx.addDegraded(5, 'budget-tracker', msg);
        }

        // 5b: BossMailbox
        try {
          const { BossMailbox } = await import('../agent/boss-mailbox');
          const bossMailbox = new BossMailbox();
          ctx.set('bossMailbox', bossMailbox);
          log.info('Phase 5b: BossMailbox 已就绪');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5b: BossMailbox 初始化失败 — 降级');
          ctx.addDegraded(5, 'boss-mailbox', msg);
        }

        // 5c: Cron 调度器 + 定时任务
        try {
          const { getGlobalScheduler } = await import('../cron/scheduler');
          const scheduler = getGlobalScheduler(db);
          ctx.set('scheduler', scheduler);
          log.info('Phase 5c: Cron 调度器已启动');

          // Connector 同步 (每30分钟)
          try {
            const connectorToolRegistry = ctx.get<ToolRegistry>('connectorToolRegistry');
            scheduler.schedule('connector-sync', '*/30 * * * *', async () => {
              if (!connectorToolRegistry) return;
              try {
                const { runConnectorPipeline } = await import('../l5/connector-pipeline');
                const connectors = connectorToolRegistry.listTools().filter(
                  (t: { executionMode?: string }) => t.executionMode === 'connector',
                );
                for (const tool of connectors) {
                  try {
                    const result = await runConnectorPipeline(tool.name, 'default', {});
                    if (result.degraded) log.warn({ tool: tool.name }, 'Connector 同步 degraded');
                  } catch (connErr: unknown) {
                    const connMsg = connErr instanceof Error ? connErr.message : String(connErr);
                    log.warn({ err: connMsg, tool: tool.name }, 'Connector 同步失败');
                  }
                }
              } catch {
                log.debug('无可用连接器 — 跳过同步');
              }
            });
            log.info('Connector 同步调度已启动 (cron: */30 * * * *)');
          } catch (cronErr: unknown) {
            const cronMsg = cronErr instanceof Error ? cronErr.message : String(cronErr);
            log.warn({ err: cronMsg }, 'Connector 同步调度注册失败 — 降级');
            ctx.addDegraded(5, 'connector-sync', cronMsg);
          }

          // 企业事实冲突扫描 (D240, 每日 04:00)
          try {
            scheduler.schedule('enterprise-facts-conflict-scan', '0 4 * * *', async () => {
              try {
                const { ConflictScanner } = await import('../../scripts/control-tower/conflict-scanner');
                const report = new ConflictScanner().scan();
                if (report.conflicts.length > 0) {
                  log.warn({ count: report.conflicts.length }, '企业事实冲突 cron 检测到矛盾');
                } else {
                  log.info({ scanned: report.scanned, degraded: report.degraded }, '企业事实冲突 cron 扫描完成');
                }
              } catch (scanErr: unknown) {
                const scanMsg = scanErr instanceof Error ? scanErr.message : String(scanErr);
                log.warn({ err: scanMsg }, '企业事实冲突扫描失败 — 降级');
              }
            });
            log.info('企业事实冲突扫描调度已启动 (cron: 0 4 * * *)');
          } catch (cronErr: unknown) {
            const cronMsg = cronErr instanceof Error ? cronErr.message : String(cronErr);
            log.warn({ err: cronMsg }, '企业事实冲突扫描调度注册失败 — 降级');
            ctx.addDegraded(5, 'enterprise-facts-conflict-scan', cronMsg);
          }

          // 每日简报 (19:00)
          try {
            scheduler.schedule('daily-briefing', '0 19 * * *', async () => {
              try {
                const { BriefingGenerator } = await import('../l3/briefing-generator');
                const { SqliteGraphStore } = await import('../adapters/sqlite-graph-store');
                const store = new SqliteGraphStore(ctx.require<Database>('db'));
                const gen = new BriefingGenerator(store as never);
                const briefing = await gen.generate('default');
                const markdown = gen.formatMarkdown(briefing);
                log.info({ summary: briefing.summary }, '每日简报已生成');
                log.debug({ markdown: markdown.slice(0, 500) }, '简报内容 (预览)');
              } catch (briefErr: unknown) {
                log.warn({ err: briefErr }, '每日简报生成失败 — degraded');
              }
            });
            log.info('每日简报调度已启动 (cron: 0 19 * * *)');
          } catch (briefErr: unknown) {
            const briefMsg = briefErr instanceof Error ? briefErr.message : String(briefErr);
            log.warn({ err: briefMsg }, '每日简报调度注册失败 — 降级');
            ctx.addDegraded(5, 'daily-briefing', briefMsg);
          }

          // DB 备份 (凌晨3:00)
          try {
            scheduler.schedule('db-backup', '0 3 * * *', async () => {
              try {
                const { backupDatabase } = await import('../services/db-encryption');
                const result = backupDatabase({
                  dbPath: config.dbPath,
                  backupDir: config.dbPath.replace(/[^/\\]+$/, '') + 'backups',
                  maxBackups: 7,
                  encryptBackups: true,
                  masterSecret: process.env.CREDENTIAL_MASTER_KEY || config.engineTokens || (config.devMode ? 'synova-dev-secret' : ''),
                  salt: config.dbPath,
                });
                if (result.ok) log.info({ path: result.path }, '数据库备份完成');
                else log.warn({ error: result.error }, '数据库备份失败');
              } catch (backupErr: unknown) {
                log.warn({ err: backupErr }, '数据库备份异常');
              }
            });
            log.info('数据库备份调度已启动 (cron: 0 3 * * *, 保留 7 天)');
          } catch (backupErr: unknown) {
            const backupMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
            log.warn({ err: backupMsg }, 'DB 备份调度注册失败 — 降级');
            ctx.addDegraded(5, 'db-backup', backupMsg);
          }

          // 证据保留分级维护 (D717) — evidence-store.expireOld() 的生产调用方（M3 机制接线）
          // 分级策略见 l3/evidence-retention.ts：默认 permanent（不按时间删，D660「按时间清理是错误模型」）；
          // 需要时间清理的部署设 SYNOVA_EVIDENCE_RETENTION_TIER / _DAYS 显式开启。
          try {
            const retention = await import('../l3/evidence-retention');
            try {
              const policy = retention.parseEvidenceRetentionPolicy(process.env);
              // 启动即跑一次（桌面端/短生命周期进程常在 03:30 不在线）
              const startupResult = retention.runEvidenceRetention(db, policy);
              if (startupResult.degraded) {
                ctx.addDegraded(5, 'evidence-retention', `${startupResult.errorCode ?? 'EVIDENCE_RETENTION_SWEEP_FAILED'}: 启动清理失败`);
              }
              scheduler.schedule(
                retention.EVIDENCE_RETENTION_JOB_NAME,
                retention.EVIDENCE_RETENTION_CRON,
                retention.createEvidenceRetentionJob(db, (message) => ctx.addDegraded(5, 'evidence-retention', message)),
              );
              log.info(
                { tier: policy.tier, windowMs: policy.windowMs, source: policy.source, cron: retention.EVIDENCE_RETENTION_CRON },
                '证据保留分级维护已启动（启动清理 + 每日 cron）',
              );
            } catch (policyErr: unknown) {
              // 配置非法 = fail-safe：不注册作业、不删证据（铁律 24/31）
              const classified = policyErr instanceof retention.EvidenceRetentionError ? policyErr : null;
              const msg = policyErr instanceof Error ? policyErr.message : String(policyErr);
              log.warn(
                { err: msg, code: classified?.code, retryable: classified?.retryable },
                '证据保留配置非法 — 未注册清理作业（fail-safe：不删证据）',
              );
              ctx.addDegraded(5, 'evidence-retention', msg);
            }
          } catch (retentionErr: unknown) {
            const msg = retentionErr instanceof Error ? retentionErr.message : String(retentionErr);
            log.warn({ err: msg }, '证据保留维护模块加载失败 — 降级');
            ctx.addDegraded(5, 'evidence-retention', msg);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5c: Cron 调度器初始化失败 — 降级');
          ctx.addDegraded(5, 'cron-scheduler', msg);
        }

        // 5d: Gear6 知识提取 + PKB 种子
        try {
          const { startGear6Scheduler } = await import('../l3/gear6-scheduler');
          startGear6Scheduler();
          log.info('Phase 5d: 齿轮6 知识提取调度已启动 (每6h)');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5d: 齿轮6 启动失败 — 降级');
          ctx.addDegraded(5, 'gear6', msg);
        }

        try {
          const { seedPKB } = await import('../l3/pkb-seed');
          const { inserted } = seedPKB(db);
          if (inserted > 0) log.info({ inserted }, 'PKB 种子知识已初始化');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5d: PKB 种子初始化失败 — 降级');
          ctx.addDegraded(5, 'pkb-seed', msg);
        }

        // 5e: KnowledgeAgent — 第7个专家
        try {
          const { createKnowledgeAgent } = await import('../l3/knowledge-agent');
          const kAgent = createKnowledgeAgent();
          ctx.set('knowledgeAgent', kAgent);
          log.info('Phase 5e: KnowledgeAgent 已注册 — 第7个专家就绪');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5e: KnowledgeAgent 注册失败 — 降级');
          ctx.addDegraded(5, 'knowledge-agent', msg);
        }

        // 5f: 告警规则引擎 + IM 通道 + 文件守卫 + 沙箱
        try {
          const { getFileGuard } = await import('../security/file-guard');
          // #1052: workDir 必须是**进程工作根**（与 EXPERT_DIR/EXTENSIONS_DIR 同 base）。
          // 原传 config.dbPath（默认 ./data/synova.db，**文件**路径）⇒ FileGuard.checkBoundary
          // 的「工作目录内」分支永不为真 ⇒ 接线后几乎全部写入被拒。
          // CTO 2026-10-08 裁定：workDir = process.cwd()。
          ctx.set('fileGuard', getFileGuard(process.cwd()));
          log.info('Phase 5f: 文件安全守卫已启动');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5f: 文件守卫初始化失败 — 降级');
          ctx.addDegraded(5, 'file-guard', msg);
        }

        try {
          const { determineSandboxLevel } = await import('../security/connector-sandbox');
          ctx.set('determineSandboxLevel', determineSandboxLevel);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5f: 沙箱判定初始化失败 — 降级');
          ctx.addDegraded(5, 'connector-sandbox', msg);
        }

        try {
          const { getAlertRuleEngine } = await import('../l5/alert-rules');
          getAlertRuleEngine(db);
          log.info('Phase 5f: 告警规则引擎已初始化');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5f: 告警规则引擎初始化失败 — 降级');
          ctx.addDegraded(5, 'alert-rules', msg);
        }

        try {
          const { getIMRegistry, createFeishuWebhookChannel } = await import('../l1/im-channel');
          const imReg = getIMRegistry();
          if (process.env.FEISHU_WEBHOOK_URL) {
            imReg.register(createFeishuWebhookChannel(process.env.FEISHU_WEBHOOK_URL));
            imReg.switchTo('feishu');
            log.info('Phase 5f: 飞书 IM 通道已注册');
          } else {
            log.info('Phase 5f: IM 通道 — 未配置飞书 Webhook');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'Phase 5f: IM 通道初始化失败 — 降级');
          ctx.addDegraded(5, 'im-channel', msg);
        }

        // 5g: MCP 工具注册 (非阻塞, fire-and-forget)
        if (process.env.SYNOVA_SKIP_MCP !== '1') {
          try {
            const { registerMCPTools } = await import('../mcp/tool-registration');
            const { ToolRegistry: MCPToolRegistry } = await import('../agent/tools');
            const mcpRegistry = new MCPToolRegistry();
            ctx.set('mcpToolRegistry', mcpRegistry);
            // 非阻塞: 后台并行连接 MCP servers
            registerMCPTools(mcpRegistry).then(() => {
              log.info('MCP 工具已注册');
            }).catch((mcpErr: Error) => {
              log.warn({ err: mcpErr.message }, 'MCP 工具注册失败 — degraded');
              ctx.addDegraded(5, 'mcp-tools', mcpErr.message);
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn({ err: msg }, 'Phase 5g: MCP 初始化失败 — 降级');
            ctx.addDegraded(5, 'mcp-tools', msg);
          }
        }
      },
    });
  }
}
