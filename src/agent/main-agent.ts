/**
 * src/agent/main-agent.ts — L2 Main Agent 决策中心 (D8a)
 *
 * Auth Doc #4 Agent Engineering Benchmark — Gap #1.
 * 升级 L2 编排层从被动诊断调度器为主 Agent 决策中心。
 *
 * 职责:
 *   - 注册循环 (registerLoop)
 *   - 执行循环 (executeLoop / executeLoopScale)
 *   - 追踪执行状态
 *   - 写入执行记录到审计日志
 *
 * 契约（铁律 47）:
 *   @input  — `new MainAgent(auditStore?, taskDecomposer?, conflictArbitrator?, clock: Clock = systemClock)`
 *             ＋ `LoopTriggerConfig`（registerLoop）
 *   @output — `LoopExecutionRecord`：startedAt / completedAt / durationMs 全部来自注入的 clock
 *             （本文件已无直取系统时钟）
 *   @degraded — 单循环失败不崩溃 MainAgent, catch + log.warn + degraded:true
 *   @error   — 不适用：本类不向调用方抛错；失败一律落 record.status='failed' +
 *              degraded:true 并 log.warn（既有语义不变）；clock 接口不符 ⇒ TypeScript 编译期失败
 */
import { createLogger } from '@synova/logger';
import type { LoopTriggerConfig, ScaleName } from '../loops/loop-trigger-config';
import { defaultDiagnosisHandler, defaultNavigationHandler, defaultEvolutionHandler, defaultSelfCheckHandler, defaultKnowledgeAccumulationHandler, defaultOverflowHandler } from './loop-handlers';
import type { ConflictArbitrator } from './conflict-arbitrator';
import { BudgetTracker } from './cost-budget';
import { systemClock, type Clock } from '../services/clock';

const log = createLogger('agent/main-agent');
const UNKNOWN_EXPERT = 'unknown' as const;

// ═══ 类型定义 ═══

/** 循环执行状态全集 — 单一来源（D333: 新增 degraded — handler 执行但降级，禁伪造 completed） */
const LOOP_STATUSES = ['pending', 'running', 'completed', 'degraded', 'failed'] as const;

/** 循环执行状态 */
export type LoopStatus = (typeof LOOP_STATUSES)[number];

/** 循环执行记录 */
export interface LoopExecutionRecord {
  loopId: string;
  scale?: ScaleName;
  status: LoopStatus;
  durationMs: number;
  output?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  degraded: boolean;
}

/** 已注册循环 */
export interface RegisteredLoop {
  config: LoopTriggerConfig;
  lastExecution?: LoopExecutionRecord;
  executionCount: number;
}

/** 审计存储最小接口 */
export interface AuditStoreLike {
  log(entry: {
    orgId: string;
    actorId: string;
    actorRole: string;
    action: string;
    targetType?: string;
    targetId?: string;
    oldValue?: string;
    newValue?: string;
  }): void;
}

// ═══ MainAgent ═══

/**
 * L2 Main Agent — 循环调度与执行决策中心。
 *
 * 管理 6 个循环的注册、执行和状态追踪。
 * 使用依赖注入接收 AuditStore 实例。
 */
export class MainAgent {
  private loops = new Map<string, RegisteredLoop>();
  private auditStore: AuditStoreLike | null;

  /**
   * @param auditStore — 审计存储实例（可选，null 时降级）
   */
  private taskDecomposer: import('./task-decomposer').TaskDecomposer | null;
  private conflictArbitrator: ConflictArbitrator | null;
  private budgetTracker: BudgetTracker;
  /** 时间源（Q-6）——默认 `systemClock`，不传即旧行为 */
  private readonly clock: Clock;

  /**
   * @param auditStore — 审计存储实例（可选，null 时降级）
   * @param taskDecomposer — 任务分解器（可选，null 时 loop-1 不走分解）
   * @param conflictArbitrator — 冲突仲裁器（可选，null 时不仲裁）
   * @param clock — 时间源（可选，缺省 `systemClock` ⇒ 生产行为等价）
   */
  constructor(
    auditStore?: AuditStoreLike | null,
    taskDecomposer?: import('./task-decomposer').TaskDecomposer | null,
    conflictArbitrator?: ConflictArbitrator | null,
    clock: Clock = systemClock,
  ) {
    this.auditStore = auditStore ?? null;
    this.taskDecomposer = taskDecomposer ?? null;
    this.conflictArbitrator = conflictArbitrator ?? null;
    this.budgetTracker = new BudgetTracker();
    this.clock = clock;
  }

  /**
   * 注册一个循环。
   * 将 LoopTriggerConfig 注册到 MainAgent，供 executeLoop 调度。
   */
  registerLoop(config: LoopTriggerConfig): void {
    try {
      this.loops.set(config.loopId, {
        config,
        executionCount: 0,
      });
      log.info({ loopId: config.loopId, scales: config.scales.length }, '循环已注册到 MainAgent');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, loopId: config.loopId }, '循环注册失败 — 降级');
    }
  }

  /**
   * 执行指定循环的默认尺度（fast）。
   * 默认使用 fast 尺度，可通过 executeLoopScale 指定。
   */
  async executeLoop(loopId: string): Promise<LoopExecutionRecord> {
    const loop = this.loops.get(loopId);
    if (!loop) {
      return {
        loopId,
        status: 'failed',
        durationMs: 0,
        error: `循环 ${loopId} 未注册`,
        startedAt: this.clock.nowIso(),
        degraded: true,
      };
    }

    // 默认执行 fast 尺度
    return this.executeLoopScale(loopId, 'fast');
  }

  /**
   * 执行指定循环的指定尺度。
   *
   * @param loopId — 循环 ID
   * @param scale — 尺度名称 (fast/medium/slow)
   * @returns LoopExecutionRecord
   */
  async executeLoopScale(loopId: string, scale: ScaleName): Promise<LoopExecutionRecord> {
    const loop = this.loops.get(loopId);
    if (!loop) {
      return {
        loopId,
        scale,
        status: 'failed',
        durationMs: 0,
        error: `循环 ${loopId} 未注册`,
        startedAt: this.clock.nowIso(),
        degraded: true,
      };
    }

    // D8g: 执行前预算检查
    const budgetStatus = this.budgetTracker.checkBudget(loopId, scale);
    if (budgetStatus.blocked) {
      log.warn({ loopId, scale, cumulativeCost: budgetStatus.cumulativeCost }, "预算拦截 — 累计成本超出上限");
      return {
        loopId, scale, status: 'failed' as const, durationMs: 0, startedAt: this.clock.nowIso(),
        error: `预算拦截: 累计成本 ${budgetStatus.cumulativeCost} 超出上限 ${this.budgetTracker['config']?.cumulativeBudget || '?'}`,
        degraded: true,
      };
    }

    const startedAt = this.clock.nowIso();
    const startTime = this.clock.now();

    try {
      // D8b: 对于诊断循环 (loop-1)，使用任务分解
      if (loopId === 'loop-1' && this.taskDecomposer) {
        const decoResult = await this.executeWithDecomposition(loopId, scale, startTime, startedAt, loop);
        this.budgetTracker.trackExecution(loopId, scale, budgetStatus.estimatedTokens, budgetStatus.estimatedTokens);
        return decoResult;
      }

      // 选择对应处理器
      const handler = this.selectHandler(loopId);
      const result = await handler(scale);

      const durationMs = this.clock.now() - startTime;
      const record: LoopExecutionRecord = {
        loopId,
        scale,
        // D333: 状态由 handler.degraded 决定（占位 handler 的假 success 不再伪造 completed）
        status: result.degraded ? 'degraded' : result.success ? 'completed' : 'failed',
        durationMs,
        output: result.output,
        error: result.error,
        startedAt,
        completedAt: this.clock.nowIso(),
        degraded: result.degraded,
      };

      // 更新注册状态
      loop.lastExecution = record;
      loop.executionCount++;

      // 写入审计日志
      this.writeAuditLog(loopId, scale, record);

      // D8g: 执行后成本追踪（使用预估 token 作为实际消耗）
      this.budgetTracker.trackExecution(loopId, scale, budgetStatus.estimatedTokens, budgetStatus.estimatedTokens);

      // D8f: 收敛规则分析 (loop-1/loop-3 诊断循环完成后)
      if ((loopId === 'loop-1' || loopId === 'loop-3') && result.success) {
        try {
          const { ConvergenceEngine } = await import('./convergence-engine');
          const engine = new ConvergenceEngine(this.auditStore);
          engine.analyzePrecedents('default').catch((err: unknown) => {
            log.warn({ err, loopId, scale }, '收敛分析前置查询失败 — 降级，不阻断主流程');
          });
        } catch (err: unknown) {
          log.warn({ err, loopId, scale }, '收敛分析异常 — 降级，不阻断主流程');
        }
      }

      if (record.status === 'degraded') {
        log.warn({ loopId, scale, output: result.output, error: result.error }, '循环执行降级');
      } else if (!result.success) {
        log.warn({ loopId, scale, error: result.error }, '循环执行失败 — 降级');
      } else {
        log.info({ loopId, scale, durationMs }, '循环执行完成');
      }

      return record;
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
      const msg = err instanceof Error ? err.message : String(err);
      const durationMs = this.clock.now() - startTime;
      const record: LoopExecutionRecord = {
        loopId,
        scale,
        status: 'failed',
        durationMs,
        error: msg,
        startedAt,
        completedAt: this.clock.nowIso(),
        degraded: true,
      };

      loop.lastExecution = record;
      loop.executionCount++;
      this.writeAuditLog(loopId, scale, record);
      log.warn({ err: msg, loopId, scale }, '循环执行异常 — 降级');

      return record;
    }
  }

  /**
   * 列出所有已注册循环。
   */
  listLoops(): RegisteredLoop[] {
    return [...this.loops.values()];
  }

  /**
   * 获取指定循环的当前状态。
   */
  getLoopStatus(loopId: string): LoopStatus | null {
    const loop = this.loops.get(loopId);
    if (!loop) return null;
    return loop.lastExecution?.status ?? 'pending';
  }

  // ─── 内部方法 ───

  /**
   * 选择循环处理器。
   * MVP: 基于 loopId 前缀分发到默认处理器。
   */
  private selectHandler(loopId: string): (scale: ScaleName) => Promise<{ success: boolean; output?: string; error?: string; degraded: boolean }> {
    if (loopId.includes('diagnosis') || loopId === 'loop-1') {
      return defaultDiagnosisHandler;
    }
    if (loopId.includes('navigation') || loopId === 'loop-2') {
      return defaultNavigationHandler;
    }
    if (loopId.includes('evolution') || loopId === 'loop-3') {
      return defaultEvolutionHandler;
    }
    // D475 (K3 P1): loop-4/loop-5 专属处理器 — 不再落 diagnosis / 错挂 evolution
    if (loopId.includes('self-check') || loopId === 'loop-4') {
      return defaultSelfCheckHandler;
    }
    if (loopId.includes('knowledge') || loopId === 'loop-5') {
      return defaultKnowledgeAccumulationHandler;
    }
    if (loopId.includes('overflow') || loopId === 'loop-6') {
      return defaultOverflowHandler;
    }
    // 默认: 诊断处理器（有意兜底 — 未知循环按诊断语义执行）
    return defaultDiagnosisHandler;
  }

  /**
   * 使用 TaskDecomposer 执行诊断循环（D8b）。
   * 分解 → 并行执行子任务 → 聚合结果。
   */
  private async executeWithDecomposition(
    loopId: string, scale: ScaleName, startTime: number, startedAt: string, loop: RegisteredLoop,
  ): Promise<LoopExecutionRecord> {
    try {
      const scope = {
        enterpriseId: 'default',
        sentinelFindings: [],
        triggeredBy: `loop:${loopId}:${scale}`,
      };
      const { subTasks } = this.taskDecomposer!.decompose(scope);
      if (subTasks.length === 0) {
        return {
          loopId, scale, status: 'completed' as const, durationMs: this.clock.now() - startTime,
          output: '诊断范围无异常，跳过分解', startedAt, completedAt: this.clock.nowIso(), degraded: false,
        };
      }
      const results = await Promise.allSettled(
        subTasks.map((st) => this.taskDecomposer!.executeSubTask(st)),
      );
      const subResults = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return { subTaskId: subTasks[i].id, status: 'failed' as const, error: r.reason?.message || '未知错误', durationMs: 0, confidence: 0 };
      });
      const aggregated = this.taskDecomposer!.aggregate(subResults);

      // D8d: 交叉验证 — 检测专家冲突
      let cvInfo = '';
      try {
        const { CrossValidationTrigger } = await import('./cross-validator');
        const validator = new CrossValidationTrigger();
        const expertResponses: import('./expert-router').ExpertResponse[] = [];
        for (const r of aggregated.results) {
          if (r.status === 'completed') {
            const sr = r as { expertType?: string; confidence: number; output?: string };
            expertResponses.push({
              subTaskId: r.subTaskId, expertType: sr.expertType || UNKNOWN_EXPERT, analysis: sr.output || '', confidence: sr.confidence || 0,
              evidence: [], edgeIds: [], degraded: false, durationMs: r.durationMs,
            });
          }
        }
        const cvResult = validator.detectConflicts(expertResponses);
        if (cvResult.length > 0) {
          cvInfo = `, 冲突: ${cvResult.length}`;
          // D8e: ConflictArbitrator 仲裁
          if (this.conflictArbitrator) {
            this.conflictArbitrator.arbitrate({
              conflicts: cvResult,
              tieBreakers: [],
              hasUnresolved: cvResult.length > 0,
              consensus: cvResult.length > 0 ? 'partial' : 'full',
            }).catch((err: unknown) => {
              log.warn({ err, loopId, scale }, '仲裁异常 — 不阻断主流程');
            });
          }
        }
      } catch (err: unknown) {
        log.warn({ err, loopId, scale }, '交叉验证异常 — 降级，不阻断主流程');
      }

      // D8f v2: ConvergenceEngine 四步收敛 → 综合叙述
      try {
        const { ConvergenceEngine } = await import('./convergence-engine');
        const engine = new ConvergenceEngine();
        const expertResponses: import('./expert-router').ExpertResponse[] = [];
        for (const r of aggregated.results) {
          if (r.status === 'completed') {
            const sr = r as { expertType?: string; confidence: number; output?: string };
            expertResponses.push({
              subTaskId: r.subTaskId, expertType: sr.expertType || UNKNOWN_EXPERT, analysis: sr.output || '', confidence: sr.confidence || 0,
              evidence: [], edgeIds: [], degraded: false, durationMs: r.durationMs,
            });
          }
        }
        const synthesis = engine.synthesize(
          expertResponses,
          { conflicts: [], tieBreakers: [], consensus: aggregated.status === 'completed' ? 'full' : 'partial' },
          [],
        );
        if (synthesis.narrative) {
          cvInfo += `, 综合: ${synthesis.convergentFindings.filter((f) => f.consensus).length}项共识`;
        }
      } catch (err: unknown) {
        log.warn({ err, loopId, scale }, '收敛合成异常 — 降级，不阻断主流程');
      }

      return {
        loopId, scale, status: aggregated.status === 'completed' ? 'completed' as const : 'failed' as const,
        durationMs: this.clock.now() - startTime, output: `子任务: ${aggregated.results.length}${cvInfo}`,
        error: aggregated.degraded ? '部分子任务失败' : undefined,
        startedAt, completedAt: this.clock.nowIso(), degraded: aggregated.degraded,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, loopId, scale }, '分解执行异常 — 降级');
      return {
        loopId, scale, status: 'failed' as const, durationMs: this.clock.now() - startTime,
        error: msg, startedAt, completedAt: this.clock.nowIso(), degraded: true,
      };
    }
  }

  /**
   * 写入审计日志。
   * 降级: AuditStore 不可用时仅 log.warn，不抛出。
   */
  private writeAuditLog(loopId: string, scale: ScaleName, record: LoopExecutionRecord): void {
    if (!this.auditStore) {
      log.warn({ loopId, scale }, 'AuditStore 不可用 — 跳过审计日志');
      return;
    }
    try {
      this.auditStore.log({
        orgId: 'synova',
        actorId: 'main-agent',
        actorRole: 'system',
        // D333: loop.completed / loop.degraded / loop.failed 三态真实映射
        action: `loop.${record.status}`,
        targetType: 'loop',
        targetId: `${loopId}:${scale}`,
        newValue: JSON.stringify({ durationMs: record.durationMs, degraded: record.degraded }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, loopId }, '审计日志写入失败 — 降级');
    }
  }
}
