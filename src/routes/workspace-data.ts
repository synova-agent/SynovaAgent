/**
 * src/routes/workspace-data.ts — 工作台数据 API 端点 (D74)
 *
 * 提供部门工作台数据的 RESTful API，由 workspace-builder.ts 聚合。
 * 不修改旧 PRD v1.6 routes/workspace.ts（HTML 三栏页面）。
 *
 * 端点:
 *   GET    /api/workspace/:deptId              — 部门工作台全量数据
 *   GET    /api/workspace/:deptId/goals        — 部门活跃 Goal 列表
 *   GET    /api/workspace/:deptId/alerts       — 部门告警（受免打扰过滤）
 *   GET    /api/workspace/:deptId/next-action  — 推荐下一步行动
 *   PUT    /api/workspace/goals/:goalId/target — 调整 Goal 目标值
 *   POST   /api/workspace/proposals/:proposalId/reject — 拒绝 Proposal
 *   PUT    /api/workspace/alerts/:id/dismiss   — 消除告警
 *
 * 每个端点返回 { ok: boolean, data?: ..., degraded?: boolean, error?: string }
 *
 * 铁律 24+31: 每个 catch 有 log.warn + degraded 信号
 *
 * ── D1153 / #1051（施工单 1-7）— 路由级 fail-closed 守卫 ─────────────────────
 * 改前病根（实测 as_of 13b294013）: 本文件 7 个端点**零守卫**——匿名（无验签身份）
 * 即可读取任一部部门工作台数据。
 * 改后: 7 个端点全部消费 `req.rbac`（不重算身份），`authenticated !== true` ⇒
 *   HTTP 403 + 响应体 `code` + `log.warn({code:'RBAC_DENIED'})` 留痕。
 *   路由级是本仓**设计指定的执法点**（`server.ts:375` 明文「拦截责任在路由级守卫（P3）」）。
 *
 * 🔴 **#1322 起：租户（org）维度已接入，角色/部门维度仍未做**。
 *   · **已做**：读/写两侧按 **`props.orgId`** 过滤（CTO 裁定 R21 = 隔离载体 (a)）。
 *     `orgId` 取自 `extractAuthFromRequest(req)`（`auth.ts:492-503`，验签后的 `req.auth`），
 *     空/缺 orgId ⇒ **fail-closed 403**（`verifyJwtToken` 只强校验 `sub/role/jti`，
 *     `auth.ts:216-218`，**不校验 orgId** ⇒ 这一层必须由本文件兜住）。
 *   · **与 L-4「路由不得重算身份」的关系**：本文件**仍然只消费 `req.rbac` 做守卫**
 *     （`readRbac`/`requireAuthenticatedRbac`，下方不动）；`extractAuthFromRequest` 只用于取
 *     **租户标量**，不产出任何 RBAC 判定 ⇒ 不使 `rbacMiddleware` 退化为空操作，二者不冲突。
 *   · **仍未做**：**角色/部门级越权**判定。`RbacContext` 无 org/team 维度
 *     （`middleware/rbac.ts:127` 的 `department` 恒 `undefined`，D947/L-32 刻意收窄），
 *     而路由不得重算身份（L-4）⇒ 该判据今日仍**无法表达**（CTO 裁定 R22：不扩 RbacContext）。
 *     曾尝试把**部门级读判据**叠在 4 个 `:deptId` 端点上：因 `department` 恒 `undefined`
 *     该判据**恒假** ⇒ `app/js/dashboard.js:35`（deptId = 登录者 orgId）的真消费方被误杀
 *     = 过度拒绝（功能回归），已撤；代价（已知并接受）: 已认证用户仍可读任意 `:deptId`
 *     的**本租户** 数据。
 * **不新增第二份角色/部门判定**——唯一规则真源是 `middleware/rbac.ts`（#984 判决书 §3）。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { buildDepartmentWorkspace } from "../growth/workspace-builder";
import { feedbackCollector } from "../growth/feedback-collector";
import type { WorkspaceBuilderDeps } from '../growth/workspace-builder';
import { type RbacContext } from '../middleware/rbac';
// #1322: 租户**标量**取数（唯一合法来源 = 验签后的 req.auth，见 auth.ts:492-503）
import { extractAuthFromRequest } from '../middleware/auth';
// #1322: 生产唯一审计写通道（AuditStore 类只有 log():void，本域接口要 write→Promise）
import { AuditService } from '../services/audit-service';
import { listGoalsByOrg, getGoal, updateGoalStatus } from '../growth/goal-store';
import { selectPath, confirmByGa, updateProposalStatus, getProposal } from '../growth/proposal-store';
import { generateProposalFromDiagnosis, generateGoalFromProposal, startProposalExecution } from '../growth/proposal-engine';
import type { GraphBridgeLike, AuditStoreLike, Goal } from '../growth/goal-types';
import type { ActiveGoal } from '../growth/workspace-types';

const log = createLogger('routes/workspace-data');
const router = Router();

/** 增长域的图名（与 goal-store/proposal-store 的默认值同源，勿各写一份） */
const WORKSPACE_GRAPH = 'growth';

// 内存告警消除记录（D77 应迁移到持久化存储）
const dismissedAlerts = new Map<string, { dismissedAt: string }>();

// ════════════════════════════════════════════════════════════════
// D1153 / #1051（1-7）— 路由级执法守卫（fail-closed）
//
// 与 `routes/workspaces-api.ts:21-59` 的 P3 守卫**同形**（readRbac /
// requireVerifiedRbac 的语义），差异只在一处：本文件按卡要求取
// `authenticated !== true`（比 `!== false` 更严——`undefined` 亦拒绝）。
// 理由: 本文件所有端点都必须有验签身份才有意义；`undefined` 只可能来自
// 中间件未执行或手搓上下文，二者都不构成可信身份。
// ════════════════════════════════════════════════════════════════

/**
 * 取当前请求的验签 RBAC 上下文。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: express Request。`req.rbac` 由 `middleware/rbac.rbacMiddleware` 注入
 *   （挂载点 `server.ts:366`，**早于**本路由的 `server.ts:379`）。
 *   该注入的唯一可信来源是 `req.auth`（`jwtAuthMiddleware` 验签后写入，`server.ts:344`）。
 * - 输出: `RbacContext`，或 `undefined`（中间件未执行 / 未挂载）。
 * - 降级: 无。**不重算** `extractRbacContext(req)` —— 依 L-4：路由必须消费
 *   `req.rbac`，否则中间件前移退化为行为空操作（同 `workspaces-api.ts:32` 判据）。
 */
function readRbac(req: Request): RbacContext | undefined {
  return (req as Request & { rbac?: RbacContext }).rbac;
}

/**
 * 拒绝路径统一出口: HTTP 403 + 响应体带 `code` + `log.warn` 留痕
 * （P5 三态之「被拒绝」；照 `middleware/rbac.ts:246-252` 的 RBAC_DENIED 先例）。
 * 返回 `true` 表示**已拒绝**（响应已写），调用方一律 `return` 收口。
 */
function denyRbac(res: Response, reason: string, rbac?: RbacContext): true {
  log.warn(
    { code: 'RBAC_DENIED', reason, userId: rbac?.userId, role: rbac?.role },
    '安全判据: 被拒绝 — 工作台数据端点（fail-closed，HTTP 403）',
  );
  res.status(403).json({ ok: false, error: 'access denied', code: 'RBAC_DENIED' });
  return true;
}

/**
 * 取**已认证**的 RBAC 上下文；`authenticated !== true` ⇒ 写 403 并返回 `undefined`。
 * 调用方形态固定: `const rbac = requireAuthenticatedRbac(req, res); if (!rbac) return;`
 * ⇒ 既 fail-closed，又让 TS 正确收窄，且判据结果**从不被丢弃**。
 */
function requireAuthenticatedRbac(req: Request, res: Response): RbacContext | undefined {
  const rbac = readRbac(req);
  if (rbac && rbac.authenticated === true) return rbac;
  denyRbac(res, 'no_authenticated_identity', rbac);
  return undefined;
}

/**
 * 取本请求的**租户 id**（#1322 / CTO 裁定 R22）。
 *
 * 契约（铁律 47）:
 * - 输入: express Request。唯一合法来源是 `req.auth`（`jwtAuthMiddleware` 验签后注入），
 *   经 `extractAuthFromRequest`（`middleware/auth.ts:492-503`）取出 `orgId`。
 * - 输出: 非空 `string`；验签身份缺失 / `orgId` 缺失或空白 → `undefined`。
 * - 降级: **无**。不回落 `'default'`（卡 §③3 明禁），不从 body/query/header 取值
 *   （那会让租户隔离判据可被伪造）。
 */
function readOrgId(req: Request): string | undefined {
  const orgId = extractAuthFromRequest(req)?.orgId;
  return typeof orgId === 'string' && orgId.trim().length > 0 ? orgId.trim() : undefined;
}

/**
 * 取「已认证 + 有租户」的请求上下文；任一缺失 ⇒ 写 403 并返回 `undefined`。
 *
 * 为什么 orgId 也要 fail-closed：`verifyJwtToken` 的必填字段只有 `sub/role/jti`
 * （`auth.ts:216-218`），**不校验 orgId** ⇒ 合法签名但无 org 的 token 会让
 * `props.orgId` 落空、租户隔离形同虚设。此处拒绝属默认安全姿态。
 *
 * 调用方形态固定: `const auth = requireOrgId(req, res); if (!auth) return;`
 */
function requireOrgId(req: Request, res: Response): { rbac: RbacContext; orgId: string } | undefined {
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return undefined;
  const orgId = readOrgId(req);
  if (!orgId) {
    log.warn(
      { code: 'ORG_ID_MISSING', reason: 'token_without_org_claim', userId: rbac.userId, role: rbac.role },
      '安全判据: 被拒绝 — 身份无租户维度（fail-closed，HTTP 403）',
    );
    res.status(403).json({ ok: false, error: 'access denied', code: 'ORG_ID_MISSING' });
    return undefined;
  }
  return { rbac, orgId };
}

/**
 * 取 app.locals 注入的图存储（`server.ts:331` Bootstrap Phase 1c 单例）。
 *
 * @returns 形状完整时返回 `GraphBridgeLike`；缺席或形状不符 → `undefined`（调用方走降级）
 * @degraded 形状不符 ⇒ `log.warn` 留痕（铁律 11/31：不静默把坏依赖当空数据）
 */
function readGraphStore(req: Request): GraphBridgeLike | undefined {
  const injected = (req.app?.locals as { graphStore?: unknown } | undefined)?.graphStore;
  if (!injected || typeof injected !== 'object') return undefined;
  const candidate = injected as Partial<GraphBridgeLike>;
  if (typeof candidate.createNode !== 'function' || typeof candidate.getNode !== 'function'
    || typeof candidate.updateNode !== 'function' || typeof candidate.queryNodes !== 'function') {
    log.warn({ code: 'GRAPH_STORE_SHAPE_MISMATCH' }, '注入的 graphStore 形状不符 — 按未装配处理（degraded）');
    return undefined;
  }
  return candidate as GraphBridgeLike;
}

/**
 * 本域 `AuditStoreLike` 薄适配器（#1322）。
 *
 * 为什么不直接用 L4 `AuditStore`：它只有 `log(entry): void`，不满足本域
 * `AuditStoreLike.write → Promise<string>`；且 L1 直引 L4 违铁律 39。
 * `AuditService`（`services/audit-service.ts:46-58`，Bootstrap `:684` 初始化）是既有唯一
 * 审计写通道，路由消费它有先例（`routes/audit.ts:12`）。
 *
 * @degraded AuditService 未初始化 ⇒ 其内部 `log.warn` 后跳过，本适配器**照常 resolve**
 *   —— 与 `createGoal`/`createProposal` 的 fire-and-forget 契约一致（审计失败不阻断主流程）。
 */
const workspaceAuditStore: AuditStoreLike = {
  async write(entry) {
    AuditService.log(entry);
    return `audit:workspace-data:${entry.action}`;
  },
};

/**
 * Goal[] → ActiveGoal[]（读回面投影，#1322）。
 *
 * @contract 必须带出 `metrics`（卡 M4 读回硬要求：`metrics[].targetValue`）；
 *   只投影指标名/当前值/目标值/单位，不复制 computeContractId。
 * @degraded 无（纯映射，不做 IO）
 */
function toActiveGoals(goals: readonly Goal[]): ActiveGoal[] {
  return goals.map((g) => ({
    goalId: g.goalId,
    title: g.title,
    // 偏离状态由 goal-sentinel 判定；本路径未跑哨兵 ⇒ unknown（不谎报 on_track）
    deviationStatus: 'unknown' as const,
    priority: g.priority,
    deadline: g.deadline,
    progressPercent: computeProgressPercent(g),
    owner: g.assignedTo,
    metrics: (g.metrics ?? []).map((m) => ({
      metricName: m.metricName,
      currentValue: m.currentValue,
      targetValue: m.targetValue,
      unit: m.unit,
    })),
  }));
}

/**
 * 进度百分比 = (当前值 − 基线) / (目标值 − 基线) × 100（`workspace-types.ts:51` 口径）。
 *
 * @contract 本路径无基线数据 ⇒ 基线按 0 计；目标值为 0/非有限 ⇒ 0（不做除法，不产出 NaN）。
 * @degraded 无
 */
function computeProgressPercent(goal: Goal): number {
  const metric = goal.metrics?.[0];
  if (!metric) return 0;
  const target = metric.targetValue;
  if (!Number.isFinite(target) || target === 0) return 0;
  const current = Number.isFinite(metric.currentValue) ? metric.currentValue : 0;
  return (current / target) * 100;
}

/**
 * 构建 WorkspaceBuilderDeps（#1322：真装配，不再是零查询桩）。
 *
 * 契约（铁律 47）:
 * - 输入: express Request（读 `app.locals.graphStore`；tenant 由调用方另行传入 builder）
 * - 输出: `WorkspaceBuilderDeps` —— `graphStore` 为真实例；`getGoalsByOrg` 闭合到
 *   `listGoalsByOrg(org, store, 'growth')`（R21 载体 = props.orgId），并投影出 `metrics`
 * - 降级: `graphStore` 缺席/形状不符 ⇒ `graphStore` 退回旧桩 `{queryNodes: () => []}`、
 *   **不提供** `getGoalsByOrg` ⇒ `buildDepartmentWorkspace` 记 `active_goals` 降级，
 *   响应 `degraded:true`（铁律 31）。**绝不**在缺租户维度时回落成"查全员"。
 */
function getDefaultDeps(req: Request): WorkspaceBuilderDeps {
  const graphStore = readGraphStore(req);
  const deps: WorkspaceBuilderDeps = {
    graphStore: graphStore ?? { queryNodes: () => [] },
  };
  if (graphStore) {
    deps.getGoalsByOrg = (org: string): ActiveGoal[] => {
      try {
        return toActiveGoals(listGoalsByOrg(org, graphStore, WORKSPACE_GRAPH));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg, org }, '按租户查询 Goal 失败 — 降级');
        return [];
      }
    };
  } else {
    log.warn({ code: 'GRAPH_STORE_ABSENT' }, 'app.locals.graphStore 缺席 — 工作台读侧降级');
  }
  return deps;
}

// ═══ GET /api/workspace/:deptId — 全量数据 ═══

router.get('/api/workspace/:deptId', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫（先于任何数据读取）。本卡**不做越权判定** —— 见文件头「未做」段
  const auth = requireOrgId(req, res);
  if (!auth) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps, WORKSPACE_GRAPH, { orgId: auth.orgId });

    const statusCode = workspace.degraded ? 200 : 200;
    res.status(statusCode).json({
      ok: true,
      data: workspace,
      degraded: workspace.degraded,
      degradedModules: workspace.degradedModules.length > 0 ? workspace.degradedModules : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, deptId: req.params.deptId }, '工作台数据聚合失败');
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ GET /api/workspace/:deptId/goals — 活跃 Goal 列表 ═══

router.get('/api/workspace/:deptId/goals', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const auth = requireOrgId(req, res);
  if (!auth) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps, WORKSPACE_GRAPH, { orgId: auth.orgId });

    res.json({
      ok: true,
      data: workspace.activeGoals,
      count: workspace.activeGoals.length,
      degraded: workspace.degraded,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, deptId: req.params.deptId }, 'Goal 列表加载失败');
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ GET /api/workspace/:deptId/alerts — 告警列表（受 DND 过滤） ═══

router.get('/api/workspace/:deptId/alerts', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const auth = requireOrgId(req, res);
  if (!auth) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps, WORKSPACE_GRAPH, { orgId: auth.orgId });

    // 合并消除状态
    const alerts = workspace.recentAlerts.map((a) => ({
      ...a,
      dismissed: dismissedAlerts.has(a.alertId) ? true : a.dismissed,
      dismissedAt: dismissedAlerts.get(a.alertId)?.dismissedAt ?? a.dismissedAt,
    }));

    res.json({
      ok: true,
      data: alerts,
      count: alerts.length,
      degraded: workspace.degraded,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, deptId: req.params.deptId }, '告警列表加载失败');
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ GET /api/workspace/:deptId/next-action — 推荐下一步行动 ═══

router.get('/api/workspace/:deptId/next-action', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const auth = requireOrgId(req, res);
  if (!auth) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps, WORKSPACE_GRAPH, { orgId: auth.orgId });

    res.json({
      ok: true,
      data: workspace.nextAction,
      degraded: workspace.degraded,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, deptId: req.params.deptId }, 'NextAction 加载失败');
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ D93: PUT /api/workspace/goals/:goalId/target — 中层调整 Goal 目标值 ═══

router.put("/api/workspace/goals/:goalId/target", (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段。
  // 曾尝试叠**写判据**（`{ owner: rbac.userId }` 形式）：把**调用者自己的 id**
  //   当对象 owner 传 ⇒ `ws.owner === ctx.userId` 恒真，判据退化为角色门（ga/staff/liaison 恒拒）
  //   ⇒ `app/js/dashboard.js:211` 的 GA「消除告警」被误杀，属过度拒绝，已撤。
  const auth = requireOrgId(req, res);
  if (!auth) return;
  const graphStore = readGraphStore(req);
  if (!graphStore) {
    log.error({ code: 'GRAPH_UNAVAILABLE', goalId: req.params.goalId }, '目标值调整失败：图存储不可用');
    res.status(503).json({ ok: false, code: 'GRAPH_UNAVAILABLE', error: '图存储不可用', degraded: true });
    return;
  }
  try {
    const goalId = String(req.params.goalId);
    const rawTarget = req.body?.targetValue;
    const newTarget = typeof rawTarget === 'number' ? rawTarget : Number(rawTarget);
    if (!Number.isFinite(newTarget)) {
      res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: 'targetValue 必须是有限数' });
      return;
    }

    // ── #1322 修「假受理」：先定位目标（含**同租户**校验），再真写入 ──
    // 不同租户与不存在**同码同形**返回 ⇒ 不向别租户泄漏"该 id 是否存在"。
    const goal = getGoal(goalId, graphStore, WORKSPACE_GRAPH);
    if (!goal || goal.orgId !== auth.orgId) {
      log.warn({ code: 'GOAL_NOT_FOUND', goalId, orgId: auth.orgId }, '目标值调整未执行：目标不存在或非本租户');
      res.json({ ok: true, data: { goalId, targetValue: null, adjusted: false, reason: 'GOAL_NOT_FOUND' } });
      return;
    }
    const metrics = goal.metrics ?? [];
    if (metrics.length === 0) {
      res.status(400).json({ ok: false, code: 'METRIC_MISSING', error: '该目标没有可调整的指标' });
      return;
    }
    // 写值走既有 updateGoalStatus（同状态转换合法：goal-store.ts isValidTransition from===to），
    // 仅借其 extraProps 通道写 metrics —— 不新建第二个 update 函数、不直写 graph_nodes。
    const updatedMetrics = metrics.map((m, i) => (i === 0 ? { ...m, targetValue: newTarget } : m));
    updateGoalStatus(goalId, goal.status, graphStore, workspaceAuditStore, WORKSPACE_GRAPH, { metrics: updatedMetrics });

    feedbackCollector.collectFeedback({
      enterpriseId: auth.orgId,
      actorId: (req.headers["x-user-id"] as string) || "unknown",
      decision: "modify",
      targetType: "goal",
      targetId: goalId,
      reason: (req.body?.reason as string) || "中层调整目标值",
      evidenceRefs: [String(newTarget)],
    });

    log.info({ goalId, newTarget, orgId: auth.orgId }, "Goal 目标值已写入（图库已落值）");
    res.json({ ok: true, data: { goalId, targetValue: newTarget, adjusted: true } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId: req.params.goalId }, "Goal 目标值调整失败");
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ D93: POST /api/workspace/proposals/:proposalId/reject — 中层拒绝 Proposal ═══

router.post("/api/workspace/proposals/:proposalId/reject", (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const auth = requireOrgId(req, res);
  if (!auth) return;
  try {
    const proposalId = String(req.params.proposalId);

    feedbackCollector.collectFeedback({
      enterpriseId: auth.orgId,
      actorId: (req.headers["x-user-id"] as string) || "unknown",
      decision: "reject_path",
      targetType: "proposal",
      targetId: proposalId,
      reason: (req.body?.reason as string) || "中层拒绝提案",
    });

    log.info({ proposalId }, "Proposal 已拒绝 — 反馈已收集");
    res.json({ ok: true, data: { proposalId, rejected: true } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId: req.params.proposalId }, "Proposal 拒绝失败");
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ PUT /api/workspace/alerts/:id/dismiss — 消除告警 ═══

router.put('/api/workspace/alerts/:id/dismiss', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const auth = requireOrgId(req, res);
  if (!auth) return;
  try {
    const id = String(req.params.id);
    dismissedAlerts.set(id, { dismissedAt: new Date().toISOString() });
    // D93: 收集中层反馈 — 误报
    feedbackCollector.collectFeedback({
      enterpriseId: auth.orgId,
      actorId: req.headers["x-user-id"] as string || "unknown",
      decision: "reject",
      targetType: "sentinel_alert",
      targetId: id,
      reason: (req.body?.reason as string) || "中层标记为误报",
    });

    log.info({ alertId: id }, '告警已消除');
    res.json({
      ok: true,
      data: {
        alertId: id,
        dismissed: true,
        dismissedAt: dismissedAlerts.get(id)!.dismissedAt,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, alertId: req.params.id }, '告警消除失败');
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ════════════════════════════════════════════════════════════════
// #1322 — 目标创建链的生产入口（CTO 裁定 R20 = (a) growth/proposal-engine 唯一候选引擎）
//
// 为什么在这条面上扩：本文件已拥有 `/api/workspace/proposals/:proposalId/reject`
//   （下方），新端点与之同组路径 ⇒ 满足卡 §③2「在**已有** HTTP 面上扩」，
//   不新建文件/表/引擎，不构成第二套目标入口（R20 禁 `l2/proposal-manager` 双入口）。
// 链序抄既有实现，不自创：`tests/growth/e2e-navigation-loop.integration.test.ts:87-103`
//   pending_selection → selectPath → pending_ga_confirmation → confirmByGa
//   → generateGoalFromProposal → startProposalExecution
// ════════════════════════════════════════════════════════════════

/** 提方向请求体（最小形状；未知字段忽略） */
interface ProposalRequestBody {
  title?: unknown;
  department?: unknown;
  keyRisks?: unknown;
  confidence?: unknown;
  triggeringSentinels?: unknown;
  actionRecommendations?: unknown;
}

/** 选定请求体 */
interface SelectPathRequestBody {
  pathIndex?: unknown;
  targetValue?: unknown;
  unit?: unknown;
  metricName?: unknown;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ═══ POST /api/workspace/proposals — ① 提方向 → ② 三选一候选 ═══

router.post('/api/workspace/proposals', (req: Request, res: Response) => {
  const auth = requireOrgId(req, res);
  if (!auth) return;
  const graphStore = readGraphStore(req);
  if (!graphStore) {
    log.error({ code: 'GRAPH_UNAVAILABLE' }, '提方向失败：图存储不可用');
    res.status(503).json({ ok: false, code: 'GRAPH_UNAVAILABLE', error: '图存储不可用', degraded: true });
    return;
  }
  try {
    const body = (req.body ?? {}) as ProposalRequestBody;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length === 0 || title.length > 200) {
      res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: 'title 必填且 ≤200 字' });
      return;
    }
    const department = typeof body.department === 'string' && body.department.trim().length > 0
      ? body.department.trim()
      : auth.orgId;
    const rawConfidence = typeof body.confidence === 'number' ? body.confidence : 0.5;
    const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0.5;

    const proposal = generateProposalFromDiagnosis({
      diagnosisId: `dir-${Date.now().toString(36)}`,
      title,
      department,
      // 🔴 租户只从验签身份注入 —— 绝不读 body（否则 V3 可伪造）
      orgId: auth.orgId,
      confidence,
      keyRisks: asStringArray(body.keyRisks),
      triggeringSentinels: asStringArray(body.triggeringSentinels),
      actionRecommendations: [],
    }, graphStore, workspaceAuditStore);

    // draft → pending_selection（合法转换；proposal-engine 输出恒为 draft）
    updateProposalStatus(proposal.proposalId, 'pending_selection', auth.rbac.userId, {}, graphStore, workspaceAuditStore, WORKSPACE_GRAPH);

    log.info({ proposalId: proposal.proposalId, orgId: auth.orgId, paths: proposal.paths.length }, '目标候选已生成（待选定）');
    res.status(201).json({
      ok: true,
      data: {
        proposalId: proposal.proposalId,
        orgId: auth.orgId,
        status: 'pending_selection',
        title: proposal.title,
        department: proposal.department,
        paths: proposal.paths.map((p, index) => ({
          index,
          label: p.label,
          riskLevel: p.riskLevel,
          expectedImpact: p.expectedImpact,
          tradeoffs: p.tradeoffs,
          isDefault: p.isDefault,
        })),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, orgId: auth.orgId }, '提方向失败');
    res.status(503).json({ ok: false, code: 'PROPOSAL_CREATE_FAILED', error: msg, degraded: true });
  }
});

// ═══ POST /api/workspace/proposals/:proposalId/select — ③ 选定 → GOAL 落图 ═══

router.post('/api/workspace/proposals/:proposalId/select', (req: Request, res: Response) => {
  const auth = requireOrgId(req, res);
  if (!auth) return;
  const graphStore = readGraphStore(req);
  if (!graphStore) {
    log.error({ code: 'GRAPH_UNAVAILABLE' }, '选定失败：图存储不可用');
    res.status(503).json({ ok: false, code: 'GRAPH_UNAVAILABLE', error: '图存储不可用', degraded: true });
    return;
  }
  try {
    const proposalId = String(req.params.proposalId);
    const body = (req.body ?? {}) as SelectPathRequestBody;
    const pathIndex = typeof body.pathIndex === 'number' ? body.pathIndex : Number(body.pathIndex);
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex > 2) {
      res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: 'pathIndex 必须是 0/1/2' });
      return;
    }

    // 目标值可选：缺省走引擎默认（100），与原行为一致
    let targetValue: number | undefined;
    if (body.targetValue !== undefined) {
      const parsed = typeof body.targetValue === 'number' ? body.targetValue : Number(body.targetValue);
      if (!Number.isFinite(parsed)) {
        res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: 'targetValue 必须是有限数' });
        return;
      }
      targetValue = parsed;
    }
    const unit = typeof body.unit === 'string' && body.unit.trim().length > 0 ? body.unit.trim() : undefined;
    const metricName = typeof body.metricName === 'string' && body.metricName.trim().length > 0 ? body.metricName.trim() : undefined;

    // 同租户校验：不存在 / 非本租户 **同码同形**（404），不泄漏存在性
    const proposal = getProposal(proposalId, graphStore, WORKSPACE_GRAPH);
    if (!proposal || proposal.orgId !== auth.orgId) {
      log.warn({ code: 'PROPOSAL_NOT_FOUND', proposalId, orgId: auth.orgId }, '选定被拒：提案不存在或非本租户');
      res.status(404).json({ ok: false, code: 'PROPOSAL_NOT_FOUND', error: 'proposal not found' });
      return;
    }

    const actor = auth.rbac.userId;
    selectPath(proposalId, pathIndex, actor, graphStore, workspaceAuditStore, WORKSPACE_GRAPH);
    updateProposalStatus(proposalId, 'pending_ga_confirmation', actor, {}, graphStore, workspaceAuditStore, WORKSPACE_GRAPH);
    confirmByGa(proposalId, actor, graphStore, workspaceAuditStore, WORKSPACE_GRAPH);

    const confirmed = getProposal(proposalId, graphStore, WORKSPACE_GRAPH);
    if (!confirmed) {
      res.status(503).json({ ok: false, code: 'PROPOSAL_RELOAD_FAILED', error: '提案确认后读回失败', degraded: true });
      return;
    }
    const goalIds = generateGoalFromProposal(confirmed, graphStore, workspaceAuditStore, {
      targetValue,
      unit,
      metricName,
    });
    startProposalExecution(proposalId, goalIds, graphStore, workspaceAuditStore, WORKSPACE_GRAPH);

    const goalId = goalIds[0];
    log.info({ proposalId, goalId, pathIndex, orgId: auth.orgId }, '目标已落入企业图谱');
    res.json({
      ok: true,
      data: {
        proposalId,
        orgId: auth.orgId,
        goalId,
        status: 'executing',
        targetValue: targetValue ?? 100,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId: req.params.proposalId, orgId: auth.orgId }, '选定失败');
    res.status(503).json({ ok: false, code: 'GOAL_CREATE_FAILED', error: msg, degraded: true });
  }
});

export default router;
