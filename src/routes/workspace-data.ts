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
 * 🔴 **未做（依赖接口变更，另立卡）**: 跨部门/跨租户的**越权**判定。
 *   原因: `RbacContext` 无 org/team 维度（`middleware/rbac.ts:127` 的 `department` 恒
 *   `undefined`，D947/L-32 刻意收窄；`extractRbacContext` 连 `req.auth.orgId` 都不携带），
 *   而路由**不得重算身份**（L-4 硬约束）⇒ 今日**无法表达**该判据。
 *   曾尝试把**部门级读判据**叠在 4 个 `:deptId` 端点上（`{visibility:'department', department: deptId}`）：
 *   因 `department` 恒 `undefined`，该判据**恒假**——连读自己部门也 403，而
 *   `app/js/dashboard.js:35`（deptId = 登录者 orgId）是真消费方 ⇒ 属**过度拒绝**（功能回归），已撤。
 *   代价（已知并接受，已登记）: 已认证用户仍可读任意 `:deptId`（= 现状不变）。
 * **不新增第二份角色/部门判定**——唯一规则真源是 `middleware/rbac.ts`（#984 判决书 §3）。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { buildDepartmentWorkspace } from "../growth/workspace-builder";
import { feedbackCollector } from "../growth/feedback-collector";
import type { WorkspaceBuilderDeps } from '../growth/workspace-builder';
import { type RbacContext } from '../middleware/rbac';

const log = createLogger('routes/workspace-data');
const router = Router();

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
 * 构建默认的 WorkspaceBuilderDeps（从 app.locals 取依赖）。
 * 在真实的 app 环境中，需要 GraphStore 等依赖。
 */
function getDefaultDeps(_req: Request): WorkspaceBuilderDeps {
  return {
    graphStore: {
      queryNodes: () => [],
    },
    // 默认不挂载额外查询 — 由调用方配置
  };
}

// ═══ GET /api/workspace/:deptId — 全量数据 ═══

router.get('/api/workspace/:deptId', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫（先于任何数据读取）。本卡**不做越权判定** —— 见文件头「未做」段
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps);

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
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps);

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
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps);

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
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const deptId = String(req.params.deptId);
    const deps = getDefaultDeps(req);
    const workspace = buildDepartmentWorkspace(deptId, deps);

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
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const goalId = String(req.params.goalId);
    const newTarget = req.body?.targetValue;
    
    feedbackCollector.collectFeedback({
      enterpriseId: "default",
      actorId: (req.headers["x-user-id"] as string) || "unknown",
      decision: "modify",
      targetType: "goal",
      targetId: goalId,
      reason: (req.body?.reason as string) || "中层调整目标值",
      evidenceRefs: newTarget !== undefined ? [String(newTarget)] : undefined,
    });

    log.info({ goalId, newTarget }, "Goal 目标值已调整 — 反馈已收集");
    res.json({ ok: true, data: { goalId, adjusted: true } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, goalId: req.params.goalId }, "Goal 目标值调整失败");
    res.status(500).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ D93: POST /api/workspace/proposals/:proposalId/reject — 中层拒绝 Proposal ═══

router.post("/api/workspace/proposals/:proposalId/reject", (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const proposalId = String(req.params.proposalId);

    feedbackCollector.collectFeedback({
      enterpriseId: "default",
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
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  try {
    const id = String(req.params.id);
    dismissedAlerts.set(id, { dismissedAt: new Date().toISOString() });
    // D93: 收集中层反馈 — 误报
    feedbackCollector.collectFeedback({
      enterpriseId: "default",
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

export default router;
