/**
 * src/agent/loop-handlers.ts — 默认循环处理器 (D8a MVP)
 *
 * D333 起: defaultEvolutionHandler 已真实化 (N13 反馈→规则闭环接线)。
 * D475 起: diagnosis (loop-1) / navigation (loop-2) / overflow (loop-6) 三 placeholder
 *   真实化 + selfCheck (loop-4) / knowledge (loop-5) 专属处理器（K3 P0/P1 清零）。
 *
 * 诚实性不变量 (D333 范本, K3 P0): success:true ⟺ 实际发生执行/回写。
 *   无数据 / 依赖不可用 / 零动作 / 回写失败 → success:false + degraded:true + 显式输出，
 *   禁静默 success（每次 cron 写伪造 'completed' 审计记录是 K3 P0 事故）。
 *
 * 契约:
 *   @input  — ScaleName
 *   @output — LoopExecutionResult
 *   @degraded — 各 handler 注释逐条声明
 *
 * 依赖注入 (测试隔离, D333 范式): 每个 handler 一个专用 deps interface + 模块级 setter，
 *   传 null 恢复生产默认。生产默认在 handler 内惰性构造（getDatabase() 须在
 *   initEngineContext 后才可用，不能 import 时构造）。
 */
import { createLogger } from '@synova/logger';
import type { ScaleName } from '../loops/loop-trigger-config';
import { processFeedbackSignals, applyEvolutionActions } from '../loops/middle-evolution-engine';
import { getFeedbackCollector } from '../growth/feedback-collector';
import {
  lightweightReDiagnosis,
  type LightweightReDiagnosisDeps,
  type MiniDiagnosisContext,
  type ExpertRediagnosisResult,
} from '../growth/lightweight-diagnosis';
import type { GraphBridgeLike } from '../growth/goal-types';
import { propagateGoalToMembers } from '../growth/goal-store';
import { UserStore } from '../growth/user-store';
import { SqliteGraphStore } from '../adapters/sqlite-graph-store';
import { getExpertRegistry } from '../l3/expert-registry';
import { KnowledgeStore } from './knowledge-bridge-service';
import { computeOverflow } from '../cycles/overflow-compute';
import { writeOverflowSnapshot, getCycleSnapshots, getOverflowHeatmap } from '../cycles/overflow-graph-bridge';
import { cycleRegistry } from '../cycles/cycle-registry';
import { registerLoadedCycles } from '../cycles/cycle-loader';
import type { CycleConfig } from '../cycles/cycle-types';

const log = createLogger('agent/loop-handlers');

/** GOAL/PROPOSAL 所在图（对齐 src/growth/goal-store.ts:94 / proposal-store.ts 的 graph 参数） */
const GROWTH_GRAPH = 'growth';

/** 循环执行结果 */
export interface LoopExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  degraded: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 生产默认依赖（惰性构造 + 记忆化 — 模块 import 时不触 DB）
// ═══════════════════════════════════════════════════════════════════════════

let _prodGraphStore: GraphBridgeLike | null = null;
let _prodKnowledgeStore: KnowledgeStore | null = null;

/**
 * 生产图存储（SqliteGraphStore 满足 GraphBridgeLike 子集）。
 * getDatabase 走动态 import — src/agent 下 init/engine-context 的静态 from 会被
 * pre-commit 5a 判 L2→L5 跨层（builtin-tools.ts:209 同款惯例）。
 */
async function prodGraphStore(): Promise<GraphBridgeLike> {
  if (!_prodGraphStore) {
    const { getDatabase } = await import('../init/engine-context');
    _prodGraphStore = new SqliteGraphStore(getDatabase());
  }
  return _prodGraphStore;
}

/** 生产知识存储（同上动态 import 惯例） */
async function prodKnowledgeStore(): Promise<KnowledgeStore> {
  if (!_prodKnowledgeStore) {
    const { getDatabase } = await import('../init/engine-context');
    _prodKnowledgeStore = new KnowledgeStore(getDatabase());
  }
  return _prodKnowledgeStore;
}

// ═══════════════════════════════════════════════════════════════════════════
// loop-1: 诊断循环 (diagnosis) — D475 真实化
// ═══════════════════════════════════════════════════════════════════════════

/** lightweightReDiagnosis 所需的 Goal 形状（复用其 deps 的 getGoal 返回类型） */
type LightweightGoal = Exclude<ReturnType<LightweightReDiagnosisDeps['getGoal']>, null>;

/** loop-1 诊断循环依赖（测试注入；null → 生产默认惰性构造） */
export interface DiagnosisDeps {
  /** 图存储（active GOAL 枚举 + 计数回写） */
  getStore: () => GraphBridgeLike;
  /** 按 goalId 取 Goal（生产默认从 getStore 的 GOAL 节点 props 派生） */
  getGoal: (goalId: string) => LightweightGoal | null;
  /** 专家再诊断调用（生产默认为确定性差距分析，不接 LLM — Q1c 决策点 1） */
  callExpert: (ctx: MiniDiagnosisContext) => Promise<ExpertRediagnosisResult>;
  /** 升级全量诊断回调（可选，透传 lightweightReDiagnosis） */
  onEscalation?: (goalId: string, reason: string) => void;
}

let _diagnosisDeps: DiagnosisDeps | null = null;

/** 注入 loop-1 诊断循环依赖。传 null 恢复生产默认。 */
export function setDiagnosisDeps(deps: DiagnosisDeps | null): void {
  _diagnosisDeps = deps;
}

/**
 * 确定性差距分析（生产默认 callExpert — 不接 LLM）。
 * cron 内 LLM 的成本/失败面与 loop-1 轻量定位不符（Q1c 决策点 1，第一性原理最少机制）。
 *   paused / deadline 已过未完成 → abandon_goal
 *   指标落后 ≥10% → adjust_target（建议 current 与 target 的中点）
 *   无显著偏差 → adjust_target 保持原目标（union 无 'no_change' 类型，契约空隙 S-6 已记）
 */
async function deterministicGapAnalysis(ctx: MiniDiagnosisContext): Promise<ExpertRediagnosisResult> {
  const goal = ctx.goal;
  if (goal.status === 'paused') {
    return {
      suggestedAdjustment: 'abandon_goal',
      description: `目标 "${goal.title}" 处于 paused，建议废弃或重启`,
      abandonReason: '目标长期暂停',
      degraded: false,
    };
  }
  if (goal.deadline && new Date(goal.deadline).getTime() < Date.now() && goal.status !== 'completed') {
    return {
      suggestedAdjustment: 'abandon_goal',
      description: `目标 "${goal.title}" 已过 deadline (${goal.deadline}) 未完成`,
      abandonReason: 'deadline 已过未完成',
      degraded: false,
    };
  }
  const metric = goal.metrics[0];
  if (!metric) {
    return {
      suggestedAdjustment: 'adjust_target',
      description: `目标 "${goal.title}" 无指标数据，保持现状`,
      degraded: false,
    };
  }
  const gap = metric.currentValue - metric.targetValue;
  if (gap < -0.1 * Math.abs(metric.targetValue)) {
    const mid = Math.round(((metric.currentValue + metric.targetValue) / 2) * 100) / 100;
    return {
      suggestedAdjustment: 'adjust_target',
      description: `指标 ${metric.metricName} 落后目标 ${metric.targetValue} 超过 10%，建议调整至中点 ${mid}`,
      suggestedNewTarget: mid,
      affectedMetric: metric.metricName,
      degraded: false,
    };
  }
  return {
    suggestedAdjustment: 'adjust_target',
    description: `指标 ${metric.metricName} 无显著偏差，保持目标 ${metric.targetValue}`,
    suggestedNewTarget: metric.targetValue,
    affectedMetric: metric.metricName,
    degraded: false,
  };
}

/** 生产默认 getGoal：GOAL 图节点 props → lightweight 形状（goalId ≠ 图节点 id，Q1c 决策点 2） */
function defaultGetGoal(store: GraphBridgeLike): (goalId: string) => LightweightGoal | null {
  return (goalId: string) => {
    const nodes = store.queryNodes('GOAL', { goalId }, GROWTH_GRAPH);
    const props = nodes[0]?.props;
    if (!props) return null;
    return {
      goalId: String(props.goalId ?? goalId),
      title: String(props.title ?? goalId),
      description: String(props.description ?? ''),
      priority: String(props.priority ?? 'P1'),
      status: String(props.status ?? 'active'),
      ownerDeptId: String(props.ownerDeptId ?? ''),
      deadline: String(props.deadline ?? ''),
      metrics: Array.isArray(props.metrics)
        ? (props.metrics as Array<{ metricName: string; currentValue: number; targetValue: number; unit: string }>)
        : [],
      reDiagnosisCount: typeof props.reDiagnosisCount === 'number' ? props.reDiagnosisCount : 0,
      rootCause: typeof props.rootCause === 'string' ? props.rootCause : undefined,
    };
  };
}

/** loop-1 scale → 每轮再诊断目标上限（fast=1 / medium=2 / slow=10） */
function diagnosisCap(scale: ScaleName): number {
  if (scale === 'fast') return 1;
  if (scale === 'medium') return 2;
  return 10;
}

/** priority 排序键（数字越小越优先，未知优先级取中间档 P1） */
const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * 默认诊断循环处理器（D475 真实化）。
 *
 * 1. GOAL 全量取回 → JS 侧过滤 active（queryNodes 数字属性过滤不可靠，值被 String 化）
 * 2. priority 降序（P0 先）→ createdAt 升序 → scale 数量档
 * 3. lightweightReDiagnosis（确定性差距分析）→ 提案回写 + reDiagnosisCount 计数
 *
 * @degraded — 无 active 目标 / store 不可用 / 计数回写部分失败
 */
export async function defaultDiagnosisHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  try {
    const deps = _diagnosisDeps ?? null;
    const store = deps?.getStore() ?? (await prodGraphStore());
    const getGoal = deps?.getGoal ?? defaultGetGoal(store);
    const callExpert = deps?.callExpert ?? deterministicGapAnalysis;

    const goalNodes = store.queryNodes('GOAL', {}, GROWTH_GRAPH);
    const active = goalNodes
      .filter((n) => n.props.status === 'active')
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[String(a.props.priority)] ?? 1;
        const pb = PRIORITY_ORDER[String(b.props.priority)] ?? 1;
        if (pa !== pb) return pa - pb;
        return String(a.props.createdAt ?? '').localeCompare(String(b.props.createdAt ?? ''));
      })
      .slice(0, diagnosisCap(scale));

    if (active.length === 0) {
      log.info({ scale }, '无 active 目标 — 诊断循环降级（无可再诊断对象）');
      return {
        success: false,
        output: `诊断循环 [${scale}]: 无 active 目标（GOAL 图无 active 状态节点），无可再诊断对象`,
        degraded: true,
      };
    }

    // 计数回写闭包: lightweightReDiagnosis 内部吞 increment 异常（lightweight-diagnosis.ts:423-428），
    // 必须本闭包捕获并记录失败；回写后复读验证（updateNode 对 0 行 UPDATE 静默不 throw）。
    const incrementFailures: string[] = [];
    const incrementReDiagnosisCount = (goalId: string): void => {
      try {
        const nodes = store.queryNodes('GOAL', { goalId }, GROWTH_GRAPH);
        const node = nodes[0];
        if (!node) throw new Error(`GOAL ${goalId} 节点不存在`);
        const prev = typeof node.props.reDiagnosisCount === 'number' ? node.props.reDiagnosisCount : 0;
        store.updateNode(node.id, { reDiagnosisCount: prev + 1 }, GROWTH_GRAPH);
        const after = store.queryNodes('GOAL', { goalId }, GROWTH_GRAPH);
        const afterCount = after[0]?.props.reDiagnosisCount;
        if (typeof afterCount !== 'number' || afterCount <= prev) {
          throw new Error(`GOAL ${goalId} 计数回写未生效（复读 ${String(afterCount)} ≤ ${prev}）`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, goalId }, '再诊断计数回写失败 — 计入降级');
        incrementFailures.push(goalId);
      }
    };

    const proposals: string[] = [];
    // K6/1-4: 目标传导到每个人 —— 活跃目标在循环-1 巡检时下发到该组织每位成员
    // （per-person GOAL_ASSIGNMENT 节点）。传导失败**不阻断**再诊断主流程（铁律 24/31），
    // 但必须 log.warn 且把计数写进 output（不静默）。
    let propagated = 0;
    let propagationFailures = 0;
    for (const node of active) {
      const goalId = String(node.props.goalId ?? node.id);

      try {
        const orgId = String(node.props.orgId ?? '').trim();
        const members = orgId
          ? new UserStore(store).listByOrg(orgId).map((u) => ({
            userId: u.userId,
            role: u.role,
            deptId: u.department,
            displayName: u.displayName,
          }))
          : [];
        const propagation = propagateGoalToMembers(goalId, members, store, GROWTH_GRAPH);
        if (propagation.ok) {
          propagated += propagation.assignments.length;
        } else {
          propagationFailures++;
          log.warn(
            { goalId, orgId, code: propagation.code, reason: propagation.reason },
            '目标传导未完成 — degraded（不阻断再诊断）',
          );
        }
      } catch (err: unknown) {
        propagationFailures++;
        log.warn(
          { err: err instanceof Error ? err.message : String(err), goalId },
          '目标传导异常 — degraded（不阻断再诊断）',
        );
      }

      const proposal = await lightweightReDiagnosis(
        { goalId, triggeredBy: 'manual' },
        { getGoal, callExpert, onEscalation: deps?.onEscalation, incrementReDiagnosisCount },
      );
      proposals.push(`${goalId}:${proposal.adjustmentType}`);
    }

    const detail = `诊断循环 [${scale}]: 再诊断 ${proposals.length} 个目标（${proposals.join('; ')}）`
      + `，目标传导到每人 ${propagated} 条派发`
      + (propagationFailures > 0 ? `（传导未完成 ${propagationFailures} 个目标）` : '');
    if (incrementFailures.length > 0) {
      log.warn({ scale, failures: incrementFailures.length }, '再诊断计数回写部分失败 — 降级');
      return {
        success: false,
        output: `${detail}，计数回写失败 ${incrementFailures.length} 项`,
        error: `计数回写失败: ${incrementFailures.join(', ')}`,
        degraded: true,
      };
    }
    log.info({ scale, count: proposals.length }, '诊断循环执行完成');
    return { success: true, output: detail, degraded: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, scale }, '诊断循环处理失败 — 降级');
    return { success: false, error: msg, degraded: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// loop-2: 部门导航循环 (navigation) — D475 真实化
// ═══════════════════════════════════════════════════════════════════════════

/** loop-2 导航循环依赖 */
export interface NavigationDeps {
  getStore: () => GraphBridgeLike;
}

let _navigationDeps: NavigationDeps | null = null;

/** 注入 loop-2 导航循环依赖。传 null 恢复生产默认。 */
export function setNavigationDeps(deps: NavigationDeps | null): void {
  _navigationDeps = deps;
}

/**
 * 默认部门导航循环处理器（D475 真实化）。
 *
 * GOAL/PROPOSAL 全量取回 → JS 侧聚合：状态分布 + 完成率 + 近期提案（lastActiveAt
 * 排序取 5）+ 告警关联（context.triggeringSentinels 非空计数 — 嵌套字段不用
 * queryNodes filters，其过滤器不支持）。
 *
 * @degraded — GOAL 图为空 / store 不可用
 */
export async function defaultNavigationHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  try {
    const store = _navigationDeps?.getStore() ?? (await prodGraphStore());

    const goalNodes = store.queryNodes('GOAL', {}, GROWTH_GRAPH);
    if (goalNodes.length === 0) {
      log.info({ scale }, '无目标数据 — 导航循环降级');
      return {
        success: false,
        output: `部门导航循环 [${scale}]: 无目标数据（GOAL 图为空），无法生成导航摘要`,
        degraded: true,
      };
    }

    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    for (const n of goalNodes) {
      const status = String(n.props.status ?? 'unknown');
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const priority = String(n.props.priority ?? 'unknown');
      priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
    }
    const completed = statusCounts['completed'] ?? 0;
    const completionRate = Math.round((completed / goalNodes.length) * 100);

    const proposalNodes = store.queryNodes('PROPOSAL', {}, GROWTH_GRAPH);
    const recent = [...proposalNodes]
      .sort((a, b) => String(b.props.lastActiveAt ?? '').localeCompare(String(a.props.lastActiveAt ?? '')))
      .slice(0, 5);
    const alertLinked = recent.filter((p) => {
      const context = p.props.context as { triggeringSentinels?: unknown } | undefined;
      return Array.isArray(context?.triggeringSentinels) && context.triggeringSentinels.length > 0;
    }).length;

    const statusSummary = Object.entries(statusCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const prioritySummary = Object.entries(priorityCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const detail = `部门导航循环 [${scale}]: 目标 ${goalNodes.length} 个（${statusSummary}；优先级 ${prioritySummary}），完成率 ${completionRate}%，近期提案 ${recent.length} 条，告警关联 ${alertLinked} 条`;
    log.info({ scale, goals: goalNodes.length, completionRate }, '导航循环执行完成');
    return { success: true, output: detail, degraded: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, scale }, '导航循环处理失败 — 降级');
    return { success: false, error: msg, degraded: true };
  }
}

/**
 * 默认进化循环处理器（D333 真实化 — 曾为 placeholder 假成功）。
 *
 * N13 反馈→规则闭环:
 *   1. getAggregatedSignals() — D93 聚合中层反馈信号
 *   2. processFeedbackSignals(signals) — D92 信号 → 进化动作（纯函数）
 *   3. applyEvolutionActions(actions) — D273 回写阈值/专家配置
 *
 * 诚实性不变量: success:true ⟺ 实际发生回写 (applied > 0)。
 * 无信号/零动作/回写失败 → success:false + degraded:true + 显式输出（禁静默 success）。
 *
 * @param scale — 循环尺度 (fast/medium/slow)
 * @returns LoopExecutionResult — 含真实 applied/skipped 计数
 * @degraded — 无聚合信号 / 信号未达触发阈值 / 回写部分失败 / collector 不可用
 */
export async function defaultEvolutionHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  try {
    // 1. 聚合信号 (D93 feedback-collector)
    const signals = getFeedbackCollector().getAggregatedSignals();
    if (signals.length === 0) {
      log.info({ scale }, '无聚合信号 — 进化循环降级（无可执行进化动作）');
      return {
        success: false,
        output: `进化循环 [${scale}]: 无聚合信号（feedback_log 为空或未达聚合阈值），无可执行进化动作`,
        degraded: true,
      };
    }

    // 2. 信号 → 进化动作 (D92 middle-evolution-engine，纯函数)
    const actions = processFeedbackSignals(signals);
    if (actions.length === 0) {
      log.info({ scale, signals: signals.length }, '信号未达触发阈值 — 进化循环降级（零进化动作）');
      return {
        success: false,
        output: `进化循环 [${scale}]: 聚合信号 ${signals.length} 条，未达触发阈值（<3 次），零进化动作`,
        degraded: true,
      };
    }

    // 3. 回写进化动作 (D273 applyEvolutionActions)
    const result = applyEvolutionActions(actions);
    const detail = `进化循环 [${scale}]: 聚合信号 ${signals.length} 条 → 进化动作 ${actions.length} 个（applied=${result.applied}, skipped=${result.skipped}）`;

    if (result.errors.length > 0) {
      log.warn({ scale, applied: result.applied, skipped: result.skipped, errors: result.errors.length }, '进化动作回写部分失败 — 降级');
      return {
        success: false,
        output: detail,
        error: `回写失败 ${result.errors.length} 项: ${result.errors[0]}`,
        degraded: true,
      };
    }

    if (result.applied === 0) {
      log.info({ scale, skipped: result.skipped }, '回写全部 pending — 进化循环降级（等待累计确认）');
      return {
        success: false,
        output: `${detail}（全部 pending，未实际调整，等待累计确认 ≥${result.skipped + 1} 次）`,
        degraded: true,
      };
    }

    log.info({ scale, applied: result.applied, skipped: result.skipped }, '进化循环执行完成');
    return { success: true, output: detail, degraded: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, scale }, '进化循环处理失败 — 降级');
    return { success: false, error: msg, degraded: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// loop-4: 系统自检循环 (selfCheck) — D475 新增专属处理器（K3 P1）
// ═══════════════════════════════════════════════════════════════════════════

/** loop-4 自检循环依赖（生产默认惰性构造；getScheduler 异步以支持动态 import） */
export interface SelfCheckDeps {
  getDatabase: () => { prepare: (sql: string) => { get: () => unknown } };
  getExpertRegistry: () => { listTypes: () => string[] };
  getScheduler: () => Promise<unknown>;
}

let _selfCheckDeps: SelfCheckDeps | null = null;

/** 注入 loop-4 自检循环依赖。传 null 恢复生产默认。 */
export function setSelfCheckDeps(deps: SelfCheckDeps | null): void {
  _selfCheckDeps = deps;
}

/** 生产默认调度器可达性探针（动态 import — src/agent/builtin-tools.ts 同款惯例） */
async function prodScheduler(): Promise<unknown> {
  const { getGlobalScheduler } = await import('../cron/scheduler');
  const { getDatabase } = await import('../init/engine-context');
  return getGlobalScheduler(getDatabase());
}

/**
 * 默认系统自检循环处理器（loop-4，D475 新增）。
 *
 * 三查逐项报告:
 *   ① DB 可达性（SELECT 1 往返）
 *   ② 专家注册表可调且非空（0 → 可能未完成 bootstrap，生产由 ExpertFileLoader 注册 8 位）
 *   ③ 调度器可达（仅 medium/slow；catch 'CronScheduler 初始化未完成' 后 await 一个 tick
 *      重试一次 — scheduler.ts:406-419 初始化竞态会同步 throw）
 *
 * scale 分档: fast=DB+registry、medium=+scheduler、slow=三查全 + 计数明细。
 *
 * @degraded — 任一检查失败
 */
export async function defaultSelfCheckHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  try {
    const deps = _selfCheckDeps ?? null;
    const getDb = deps?.getDatabase ?? (await import('../init/engine-context')).getDatabase;
    const getRegistry = deps?.getExpertRegistry ?? getExpertRegistry;
    const getScheduler = deps?.getScheduler ?? prodScheduler;

    const results: string[] = [];
    let failures = 0;

    // ① DB 可达性
    try {
      getDb().prepare('SELECT 1 as ok').get();
      results.push('db=ok');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures++;
      results.push(`db=fail(${msg})`);
    }

    // ② 专家注册表
    try {
      const types = getRegistry().listTypes();
      if (types.length === 0) {
        failures++;
        results.push('experts=fail(registry 为空 — 可能未完成 bootstrap)');
      } else {
        results.push(scale === 'slow' ? `experts=ok(${types.length} 位)` : 'experts=ok');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures++;
      results.push(`experts=fail(${msg})`);
    }

    // ③ 调度器可达性（fast 不查 — 对应 loop-trigger-config 三档 coverage）
    if (scale !== 'fast') {
      try {
        await getScheduler();
        results.push('scheduler=ok');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('初始化未完成')) {
          await new Promise((r) => setTimeout(r, 0));
          try {
            await getScheduler();
            results.push('scheduler=ok(重试)');
          } catch (retryErr: unknown) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            failures++;
            results.push(`scheduler=fail(重试后仍失败: ${retryMsg})`);
          }
        } else {
          failures++;
          results.push(`scheduler=fail(${msg})`);
        }
      }
    }

    const detail = `系统自检循环 [${scale}]: ${results.join(', ')}`;
    if (failures > 0) {
      log.warn({ scale, failures }, '自检存在失败项 — 降级');
      return { success: false, output: detail, error: `${failures} 项自检失败`, degraded: true };
    }
    log.info({ scale }, '系统自检循环执行完成');
    return { success: true, output: detail, degraded: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, scale }, '自检循环处理失败 — 降级');
    return { success: false, error: msg, degraded: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// loop-5: 知识积累循环 (knowledge) — D475 新增专属处理器（K3 P1）
// ═══════════════════════════════════════════════════════════════════════════

/** KnowledgeStore.recentStats 返回形状 */
export interface KnowledgeRecentStats {
  total: number;
  byDomain: Record<string, number>;
  bySourceType: Record<string, number>;
}

/** loop-5 知识积累循环依赖 */
export interface KnowledgeDeps {
  getStore: () => { recentStats: (sinceIso: string) => KnowledgeRecentStats };
}

let _knowledgeDeps: KnowledgeDeps | null = null;

/** 注入 loop-5 知识积累循环依赖。传 null 恢复生产默认。 */
export function setKnowledgeDeps(deps: KnowledgeDeps | null): void {
  _knowledgeDeps = deps;
}

/** loop-5 scale → 时间窗口（天）: fast=1 / medium=7 / slow=30（对应 daily/monthly/quarterly） */
function knowledgeWindowDays(scale: ScaleName): number {
  if (scale === 'fast') return 1;
  if (scale === 'medium') return 7;
  return 30;
}

/**
 * 默认知识积累循环处理器（loop-5，D475 新增）。
 *
 * KnowledgeStore.recentStats(scale 窗口) → 总量/分域/分源统计。
 *
 * @degraded — 窗口内零新增（不搞「绿灯零积累」）/ store 不可用
 */
export async function defaultKnowledgeAccumulationHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  try {
    const store = _knowledgeDeps?.getStore() ?? (await prodKnowledgeStore());
    const days = knowledgeWindowDays(scale);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const stats = store.recentStats(since);

    const domainSummary = Object.entries(stats.byDomain).map(([k, v]) => `${k}=${v}`).join(', ');
    const sourceSummary = Object.entries(stats.bySourceType).map(([k, v]) => `${k}=${v}`).join(', ');
    const detail = `知识积累循环 [${scale}]: 近${days}天新增知识 ${stats.total} 条`
      + (domainSummary ? `（域: ${domainSummary}）` : '')
      + (sourceSummary ? `（源: ${sourceSummary}）` : '');

    if (stats.total === 0) {
      log.info({ scale, days }, '窗口内无新增知识 — 知识积累循环降级');
      return { success: false, output: detail, degraded: true };
    }
    log.info({ scale, total: stats.total, days }, '知识积累循环执行完成');
    return { success: true, output: detail, degraded: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, scale }, '知识积累循环处理失败 — 降级');
    return { success: false, error: msg, degraded: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// loop-6: 溢出监控循环 (overflow) — D475 真实化
// ═══════════════════════════════════════════════════════════════════════════

/** loop-6 溢出监控循环依赖 */
export interface OverflowDeps {
  getStore: () => GraphBridgeLike;
  getCycles: () => Promise<CycleConfig[]>;
}

let _overflowDeps: OverflowDeps | null = null;

/** 注入 loop-6 溢出监控循环依赖。传 null 恢复生产默认。 */
export function setOverflowDeps(deps: OverflowDeps | null): void {
  _overflowDeps = deps;
}

/** 生产默认循环加载: registry 为空时 registerLoadedCycles 自加载（本 handler 是首个生产调用方） */
async function prodCycles(): Promise<CycleConfig[]> {
  if (cycleRegistry.list().length === 0) {
    await registerLoadedCycles();
  }
  return cycleRegistry.list();
}

/**
 * 默认溢出监控循环处理器（D475 真实化）。
 *
 * 1. 循环自加载（registry 空时 registerLoadedCycles）
 * 2. 企业发现: GOAL.props.orgId 去重；空 → ['default']（单租户惯例，routes/overflow.ts:88 同款）。
 *    不用 OVERFLOW_SNAPSHOT/FINANCIAL 节点发现企业（FINANCIAL 全 src 无生产写方=死查询）
 * 3. 每企业×每循环: getCycleSnapshots 历史 → computeOverflow → writeOverflowSnapshot
 *    → 复读验证（writeOverflowSnapshot 静默吞写失败，必须复读才 written++）
 * 4. getOverflowHeatmap 摘要进 output
 *
 * 不硬编码快照图名/cycleId，读写全走 bridge 公开函数（D338 并行改图名不影响本 handler）。
 * scale 不映射循环子集，全部注册循环一律处理。
 *
 * @degraded — 无已注册循环 / 无历史快照数据（首月仅建立基线）/ 写入验证失败 / store 不可用
 */
export async function defaultOverflowHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  try {
    const deps = _overflowDeps ?? null;
    const store = deps?.getStore() ?? (await prodGraphStore());
    const cycles = await (deps?.getCycles ?? prodCycles)();

    if (cycles.length === 0) {
      log.info({ scale }, '无已注册循环 — 溢出监控循环降级');
      return {
        success: false,
        output: `溢出监控循环 [${scale}]: 无已注册循环（cycles/ 无 .cycle.json 或加载失败）`,
        degraded: true,
      };
    }

    const goalNodes = store.queryNodes('GOAL', {}, GROWTH_GRAPH);
    const orgIds = new Set<string>();
    for (const n of goalNodes) {
      const orgId = String(n.props.orgId ?? '').trim();
      if (orgId) orgIds.add(orgId);
    }
    const enterprises = orgIds.size > 0 ? [...orgIds] : ['default'];

    // bridge 只消费 GraphStore 的 createNode/queryNodes 子集（GraphBridgeLike 已覆盖）；
    // 全量 GraphStore 接口单源声明于 l4/graph-bridge.ts（check-architecture 禁第二处声明），
    // 此处仅做边界一次 cast（routes/overflow.ts:20 同款内联类型惯例）。
    type OverflowStore = import('../l4/graph-bridge').GraphStore;
    const gs = store as OverflowStore;

    let written = 0;
    let noData = 0;
    let verifyFailed = 0;
    for (const enterpriseId of enterprises) {
      for (const cycle of cycles) {
        const history = getCycleSnapshots(enterpriseId, cycle.cycleId, gs);
        const snapshot = computeOverflow(cycle, {
          dataPoints: history.map((s) => ({ month: s.month, value: s.overflowValue })),
          currentNodeValues: {},
          enterpriseId,
        });
        if (snapshot.degraded) {
          noData++;
          continue;
        }
        writeOverflowSnapshot(enterpriseId, cycle.cycleId, snapshot, gs);
        // 写后复读验证: writeOverflowSnapshot 静默吞写失败（overflow-graph-bridge.ts:64-76）
        const latest = getCycleSnapshots(enterpriseId, cycle.cycleId, gs, { limit: 1 });
        if (latest.length > 0 && latest[0].month === snapshot.month) written++;
        else verifyFailed++;
      }
    }

    let heatCells = 0;
    for (const enterpriseId of enterprises) {
      heatCells += getOverflowHeatmap(enterpriseId, gs).cells.length;
    }

    const detail = `溢出监控循环 [${scale}]: 企业 ${enterprises.length} × 循环 ${cycles.length}，写入快照 written=${written}（数据不足跳过 ${noData}，写入验证失败 ${verifyFailed}），热力图 cells ${heatCells}`;
    if (written === 0) {
      const reason = noData > 0
        ? `无历史快照数据（${noData} 个循环数据不足，首月仅建立基线）`
        : `写入验证失败 ${verifyFailed} 个`;
      log.warn({ scale, noData, verifyFailed }, '溢出监控循环降级');
      return { success: false, output: detail, error: reason, degraded: true };
    }
    log.info({ scale, written, heatCells }, '溢出监控循环执行完成');
    return { success: true, output: detail, degraded: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, scale }, '溢出监控循环处理失败 — 降级');
    return { success: false, error: msg, degraded: true };
  }
}
