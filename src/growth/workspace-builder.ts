/**
 * src/growth/workspace-builder.ts — 工作台数据聚合器 (D74)
 *
 * buildDepartmentWorkspace() 聚合 5 个独立模块的数据:
 *   1. 部门基本信息（GraphStore TEAM 节点）
 *   2. 活跃 Goal 列表（goal-store + goal-sentinel 偏离状态）
 *   3. 待处理 Proposal（proposal-store）
 *   4. 关联告警（哨兵 Findings + Goal 偏离）
 *   5. 诊断报告引用
 *
 * 每步独立 try-catch，单点失败标记 degraded 不阻断其他模块。
 *
 * 契约:
 *   @input  — deptId + WorkspaceBuilderDeps（依赖注入）
 *   @output — DepartmentWorkspace
 *   @degraded — 任意子模块失败时 degraded=true
 */
import { createLogger } from '@synova/logger';
import type {
  DepartmentWorkspace,
  ActiveGoal,
  WorkspaceAlert,
  PendingProposal,
  DiagnosticReference,
} from './workspace-types';
import { computeNextAction } from './next-action-engine';
import { shouldDeliver } from './dnd-engine';
import type { DNDConfig, NextAction } from './workspace-types';
import { DEFAULT_DND_CONFIG } from './workspace-types';

const log = createLogger('growth/workspace-builder');

// ═══ 依赖注入接口 ═══

/**
 * workspace-builder 所需的最小外部依赖。
 * 遵循 goal-store/proposal-store 的 DI 模式，避免直接耦合具体实现。
 */
export interface WorkspaceBuilderDeps {
  /** GraphStore 查询接口 — 用于查询部门/团队 TEAM 节点 */
  graphStore: {
    queryNodes(
      type: string,
      filters?: Record<string, unknown>,
      graph?: string,
    ): Array<{ id: string; type: string; props: Record<string, unknown> }>;
  };

  /** 按部门查询活跃 Goal，返回 ActiveGoal[]（含偏离状态） */
  getGoalsByDept?: (deptId: string) => ActiveGoal[];

  /**
   * 按**组织（租户）**查询活跃 Goal（#1322，R21）。
   *
   * 为什么必须另立入口而不是复用 getGoalsByDept：租户隔离载体是 `props.orgId`
   * （卡 R21），而 `getGoalsByDept` 的契约是「按部门」——把 org 语义塞进它 = 名实不符，
   * 调用方再也无法从签名判断到底按哪个维度过滤。两者并存：传 `opts.orgId` 时优先本入口。
   */
  getGoalsByOrg?: (orgId: string) => ActiveGoal[];

  /** 按部门查询待处理 Proposal */
  getProposalsByDept?: (deptId: string) => PendingProposal[];

  /** 按部门查询告警列表 */
  getAlertsByDept?: (deptId: string) => WorkspaceAlert[];

  /** 按部门查询最近诊断报告引用（最多 3 份） */
  getDiagnosticsByDept?: (deptId: string) => DiagnosticReference[];

  /** 免打扰配置（可选，使用默认值） */
  dndConfig?: DNDConfig;
}

// ═══ 模块降级标记集合 ═══

interface DegradedEntry {
  step: string;
  error: string;
}

// ═══ 工具函数 ═══

/**
 * 从 GraphStore TEAM 节点 props 中提取部门名称。
 * 兼容 TEAM schema: props.name (string) 或 props.displayName。
 */
function extractDeptName(props: Record<string, unknown>): string {
  if (typeof props.name === 'string' && props.name.length > 0) return props.name;
  if (typeof props.displayName === 'string' && props.displayName.length > 0) return props.displayName;
  return '未知部门';
}

// ═══ 主聚合函数 ═══

/**
 * 构建部门工作台全量数据。
 *
 * 5 步聚合，每步独立 try-catch:
 *   1. 部门基本信息 — GraphStore.queryNodes('resource/team')
 *   2. 活跃 Goal — getGoalsByOrg（租户，#1322）｜无 orgId 时回退 getGoalsByDept（部门）
 *   3. 待处理 Proposal — getProposalsByDept
 *   4. 告警 — getAlertsByDept (免打扰过滤)
 *   5. 诊断报告 — getDiagnosticsByDept
 *   最后: 计算 NextAction
 *
 * @param deptId  部门 ID
 * @param deps    外部依赖（GraphStore + 查询函数）
 * @param graph   图名称（默认 'growth'）
 * @param opts    可选。#1322 新增 `orgId`（**租户过滤唯一载体**，R21：`props.orgId`）；
 *                传入时 Step 2 优先走 `deps.getGoalsByOrg`，未装配则**显式记降级**（不静默）。
 * @returns DepartmentWorkspace
 * @degraded 单步失败 → degradedModules 留痕；`opts.orgId` 有值而 `getGoalsByOrg` 缺席
 *           同样记降级（铁律 31：不把「没查」伪装成「没有」）
 */
export function buildDepartmentWorkspace(
  deptId: string,
  deps: WorkspaceBuilderDeps,
  graph: string = 'growth',
  opts?: { orgId?: string },
): DepartmentWorkspace {
  const degraded: DegradedEntry[] = [];
  let deptName = deptId;

  // ── Step 1: 部门基本信息 ──
  try {
    const teams = deps.graphStore.queryNodes('resource/team', { name: deptId }, graph);
    if (teams.length > 0) {
      deptName = extractDeptName(teams[0].props);
      log.debug({ deptId, deptName, nodeId: teams[0].id }, '部门信息已加载');
    } else {
      // 也尝试用 id 查询
      const teamsById = deps.graphStore.queryNodes('resource/team', undefined, graph);
      const match = teamsById.find(
        (t) => t.id === deptId || t.props.id === deptId || t.props.name === deptId,
      );
      if (match) {
        deptName = extractDeptName(match.props);
        log.debug({ deptId, deptName }, '部门信息已加载（通过匹配）');
      } else {
        log.warn({ deptId }, '部门 TEAM 节点未找到，使用 deptId 作为名称');
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, deptId }, 'Step 1: 部门基本信息加载失败 — 降级');
    degraded.push({ step: 'department_info', error: msg });
  }

  // ── Step 2: 活跃 Goal ──
  // #1322: 传了 opts.orgId ⇒ 走租户维度（R21）。绝不在缺少 getGoalsByOrg 时回落到
  //   「不按租户查」——那会把多客户串账重新引回来；宁可置空 + 显式降级。
  let activeGoals: ActiveGoal[] = [];
  const orgId = opts?.orgId;
  if (orgId) {
    if (deps.getGoalsByOrg) {
      try {
        activeGoals = deps.getGoalsByOrg(orgId);
        log.debug({ orgId, count: activeGoals.length }, '活跃 Goal 已加载（按租户）');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, orgId }, 'Step 2: 活跃 Goal 加载失败 — 降级');
        degraded.push({ step: 'active_goals', error: msg });
      }
    } else {
      log.warn({ orgId }, 'Step 2: getGoalsByOrg 未装配 — 活跃 Goal 置空（degraded）');
      degraded.push({ step: 'active_goals', error: 'getGoalsByOrg 未装配（租户维度不可查）' });
    }
  } else if (deps.getGoalsByDept) {
    try {
      activeGoals = deps.getGoalsByDept(deptId);
      log.debug({ deptId, count: activeGoals.length }, '活跃 Goal 已加载');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, deptId }, 'Step 2: 活跃 Goal 加载失败 — 降级');
      degraded.push({ step: 'active_goals', error: msg });
    }
  }

  // ── Step 3: 待处理 Proposal ──
  let pendingProposals: PendingProposal[] = [];
  if (deps.getProposalsByDept) {
    try {
      pendingProposals = deps.getProposalsByDept(deptId);
      log.debug({ deptId, count: pendingProposals.length }, '待处理 Proposal 已加载');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, deptId }, 'Step 3: Proposal 加载失败 — 降级');
      degraded.push({ step: 'pending_proposals', error: msg });
    }
  }

  // ── Step 4: 告警（受免打扰过滤） ──
  let allAlerts: WorkspaceAlert[] = [];
  if (deps.getAlertsByDept) {
    try {
      allAlerts = deps.getAlertsByDept(deptId);
      log.debug({ deptId, count: allAlerts.length }, '告警已加载');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, deptId }, 'Step 4: 告警加载失败 — 降级');
      degraded.push({ step: 'alerts', error: msg });
    }
  }

  // 免打扰过滤
  const dndConfig = deps.dndConfig ?? DEFAULT_DND_CONFIG;
  const now = new Date();
  const recentAlerts = allAlerts.filter((alert) => shouldDeliver(alert, dndConfig, now));

  // ── Step 5: 诊断报告引用 ──
  let diagnosticsReferenced: DiagnosticReference[] = [];
  if (deps.getDiagnosticsByDept) {
    try {
      diagnosticsReferenced = deps.getDiagnosticsByDept(deptId);
      log.debug({ deptId, count: diagnosticsReferenced.length }, '诊断报告引用已加载');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, deptId }, 'Step 5: 诊断报告加载失败 — 降级');
      degraded.push({ step: 'diagnostics', error: msg });
    }
  }

  // ── 计算 NextAction ──
  let nextAction: NextAction | null = null;
  try {
    const partialWorkspace: DepartmentWorkspace = {
      departmentId: deptId,
      name: deptName,
      activeGoals,
      recentAlerts,
      pendingProposals,
      diagnosticsReferenced,
      nextAction: null,
      degraded: degraded.length > 0,
      degradedModules: degraded,
    };
    nextAction = computeNextAction(partialWorkspace);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, 'NextAction 计算失败 — 降级');
    degraded.push({ step: 'next_action', error: msg });
  }

  // ── 构建最终结果 ──
  return {
    departmentId: deptId,
    name: deptName,
    activeGoals,
    recentAlerts,
    pendingProposals,
    diagnosticsReferenced,
    nextAction,
    degraded: degraded.length > 0,
    degradedModules: degraded,
  };
}
