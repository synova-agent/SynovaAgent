/**
 * src/agent/cost-budget.ts — 推理成本预算 (D8g)
 *
 * 权威文档 #4 §2.8 推理成本控制:
 *   - token 预算上限（maxTokens per scale）
 *   - 成本累计追踪（cumulativeCost）
 *   - 预算告警（warnAt 80%/blockAt 100%）
 *   - 执行记录持久化（history）
 *
 * 契约:
 *   @input  — loopId + scale（执行前），actualTokens + costEstimate（执行后）
 *   @output — BudgetStatus { allowed, warnLevel, cumulativeCost, remainingBudget }
 *   @degraded — 追踪器未初始化 → 允许执行 + degraded
 */
import { createLogger } from "@synova/logger";

const log = createLogger("agent/cost-budget");

// ═══ 类型定义 ═══

/** 预算配置 */
export interface BudgetConfig {
  /** fast 尺度最大 token（默认 50K） */
  maxTokensFast: number;
  /** medium 尺度最大 token（默认 200K） */
  maxTokensMedium: number;
  /** slow 尺度最大 token（默认 500K） */
  maxTokensSlow: number;
  /** 累计预算上限（跨多次执行，默认 500K） */
  cumulativeBudget: number;
  /** 告警阈值 (0-1, 默认 0.8) */
  warnAt: number;
  /** 拦截阈值 (0-1, 默认 1.0) */
  blockAt: number;
}

/** 预算检查结果 */
export interface BudgetStatus {
  /** 是否允许执行 */
  allowed: boolean;
  /** 是否被预算拦截（累计超限） */
  blocked: boolean;
  /** 是否达到告警阈值 */
  warnLevel: boolean;
  /** 当前累计成本 */
  cumulativeCost: number;
  /** 剩余预算 */
  remainingBudget: number;
  /** 本次请求的预估 token */
  estimatedTokens: number;
}

/** 单次执行成本记录 */
export interface ExecutionCostRecord {
  loopId: string;
  scale: string;
  tokens: number;
  cost: number;
  timestamp: string;
}

// ═══ 默认配置 ═══

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokensFast: 50_000,
  maxTokensMedium: 200_000,
  maxTokensSlow: 500_000,
  cumulativeBudget: 500_000,
  warnAt: 0.8,
  blockAt: 1.0,
};

/** Scale → maxTokens 映射 */
const SCALE_MAX_TOKENS: Record<string, number> = {
  fast: DEFAULT_CONFIG.maxTokensFast,
  medium: DEFAULT_CONFIG.maxTokensMedium,
  slow: DEFAULT_CONFIG.maxTokensSlow,
};

// ═══ BudgetTracker ═══

/**
 * 推理成本预算追踪器。
 *
 * 每次循环执行前调用 checkBudget() 检查是否超预算。
 * 执行后调用 trackExecution() 记录实际消耗。
 * 累计成本达 warnAt 触发告警，达 blockAt 拒绝执行。
 */
export class BudgetTracker {
  private cumulativeCost = 0;
  private history: ExecutionCostRecord[] = [];
  private config: BudgetConfig;
  private degraded = false;

  constructor(config?: Partial<BudgetConfig>) {
    // 合并默认配置与自定义配置
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查预算是否允许执行。
   *
   * @param loopId — 循环 ID
   * @param scale — 执行尺度 (fast/medium/slow)
   * @returns BudgetStatus
   */
  checkBudget(loopId: string, scale: string): BudgetStatus {
    const estimatedTokens = SCALE_MAX_TOKENS[scale] || DEFAULT_CONFIG.maxTokensFast;
    const cumulativeBudget = this.config.cumulativeBudget;

    // 累计预算检查
    const projectedCost = this.cumulativeCost + estimatedTokens;
    const remainingBudget = Math.max(0, cumulativeBudget - this.cumulativeCost);

    // blockAt 检查: 累计成本是否超过 blockAt * cumulativeBudget
    const blockThreshold = cumulativeBudget * this.config.blockAt;
    const blocked = projectedCost > blockThreshold;

    // warnAt 检查: 累计成本是否超过 warnAt * cumulativeBudget
    const warnThreshold = cumulativeBudget * this.config.warnAt;
    const warnLevel = !blocked && projectedCost > warnThreshold;

    if (blocked) {
      log.warn(
        { loopId, scale, cumulativeCost: this.cumulativeCost, estimatedTokens, cumulativeBudget },
        "预算拦截 — 累计成本超出 blockAt 阈值，拒绝执行",
      );
    } else if (warnLevel) {
      log.warn(
        { loopId, scale, cumulativeCost: this.cumulativeCost, estimatedTokens, cumulativeBudget },
        "预算告警 — 累计成本超出 warnAt 阈值，建议降级为轻量模式",
      );
    }

    return {
      allowed: !blocked,
      blocked,
      warnLevel,
      cumulativeCost: this.cumulativeCost,
      remainingBudget,
      estimatedTokens,
    };
  }

  /**
   * 记录执行成本。
   *
   * @param loopId — 循环 ID
   * @param scale — 执行尺度
   * @param actualTokens — 实际消耗 token 数（或估算值）
   * @param costEstimate — 成本估算（单位: 分/毫/自定义）
   */
  trackExecution(loopId: string, scale: string, actualTokens: number, costEstimate: number): void {
    this.cumulativeCost += costEstimate;
    this.history.push({
      loopId,
      scale,
      tokens: actualTokens,
      cost: costEstimate,
      timestamp: new Date().toISOString(),
    });

    log.info(
      { loopId, scale, tokens: actualTokens, cost: costEstimate, cumulativeCost: this.cumulativeCost },
      "执行成本已记录",
    );
  }

  /** 获取当前累计成本 */
  getCumulativeCost(): number {
    return this.cumulativeCost;
  }

  /** 获取执行历史（可选限制条数） */
  getHistory(limit?: number): ExecutionCostRecord[] {
    if (limit && limit > 0) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /** 重置累计成本和历史记录 */
  reset(): void {
    this.cumulativeCost = 0;
    this.history = [];
    log.info("预算追踪器已重置");
  }

  /** 是否处于降级状态 */
  isDegraded(): boolean {
    return this.degraded;
  }
}

/** 未初始化的占位追踪器（降级用）— M1b: 具名类（TS4094：匿名类私有成员无法生成 .d.ts） */
class NoopBudgetTracker extends BudgetTracker {
  constructor() {
    super({ cumulativeBudget: Infinity });
  }

  override checkBudget(_loopId: string, _scale: string): BudgetStatus {
    return {
      allowed: true,
      blocked: false,
      warnLevel: false,
      cumulativeCost: 0,
      remainingBudget: Infinity,
      estimatedTokens: 0,
    };
  }

  override trackExecution(_loopId: string, _scale: string, _actualTokens: number, _costEstimate: number): void {
    // noop — 降级时不记录
  }

  override getCumulativeCost(): number {
    return 0;
  }

  override getHistory(_limit?: number): ExecutionCostRecord[] {
    return [];
  }

  override reset(): void {
    // noop
  }

  override isDegraded(): boolean {
    return true;
  }
}

export const NOOP_BUDGET_TRACKER: BudgetTracker = new NoopBudgetTracker();
