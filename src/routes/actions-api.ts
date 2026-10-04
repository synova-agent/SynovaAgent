/**
 * actions-api.ts — 行动项 CRUD (PRD §7, v3.5)
 * POST /api/actions → 创建 | GET /api/actions → 列表 | PUT /api/actions/:id/status → 状态流转
 *
 * ── D1153 / #1051（施工单 1-7）— 路由级 fail-closed 守卫 ─────────────────────
 * 改前病根（实测 as_of 13b294013）: 本文件 3 个端点**零守卫**——匿名（无验签身份）
 * 即可创建/列举/流转行动项。改后 3 个端点全部消费 `req.rbac`（不重算身份），
 * `authenticated !== true` ⇒ HTTP 403 + 响应体 `code` + `log.warn({code:'RBAC_DENIED'})` 留痕。
 *
 * 🔴 **未做（依赖接口变更，另立卡）**: 跨工作区/跨租户的**越权**判定。
 *   原因同 `workspace-data.ts` 文件头：`RbacContext` 无 org/team 维度（`middleware/rbac.ts:127`
 *   的 `department` 恒 `undefined`）、且路由不得重算身份（L-4）⇒ 今日**无法表达**该判据。
 *   曾尝试叠读/写判据（部门级读 + `{owner: rbac.userId}` 写）⇒ 判据要么恒假、要么退化为
 *   角色门，对 `app/js/dashboard.js` 的真消费方构成过度拒绝，已撤。
 * **不新增第二份角色/部门判定**——唯一规则真源是 `middleware/rbac.ts`。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { listMemory, rememberMemory } from '../services/memory-access-service';
import { type RbacContext } from '../middleware/rbac';

const log = createLogger('routes/actions-api');
const router = Router();

interface ActionItem {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: 'pending' | 'confirmed' | 'executing' | 'completed' | 'rejected';
  priority: 'critical' | 'high' | 'medium' | 'low';
  owner?: string;
  createdAt: string;
  updatedAt: string;
}

const store = new Map<string, ActionItem>();

// ════════════════════════════════════════════════════════════════
// D1153 / #1051（1-7）— 路由级执法守卫（fail-closed）
//
// 与 workspace-data.ts 同形、与 routes/workspaces-api.ts:21-59 同源语义。
// 差异仅一处: 取 `authenticated !== true`（比 `!== false` 更严，`undefined` 亦拒绝）。
// ════════════════════════════════════════════════════════════════

/**
 * 取当前请求的验签 RBAC 上下文。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: express Request。`req.rbac` 由 `middleware/rbac.rbacMiddleware` 注入
 *   （挂载点 `server.ts:366`，**早于**本路由的 `server.ts:384`）；
 *   唯一可信来源是 `req.auth`（`jwtAuthMiddleware` 验签后写入，`server.ts:344`）。
 * - 输出: `RbacContext`，或 `undefined`（中间件未执行 / 未挂载）。
 * - 降级: 无。**不重算** `extractRbacContext(req)` —— 路由必须消费 `req.rbac`。
 */
function readRbac(req: Request): RbacContext | undefined {
  return (req as Request & { rbac?: RbacContext }).rbac;
}

/**
 * 拒绝路径统一出口: HTTP 403 + 响应体带 `code` + `log.warn` 留痕
 * （照 `middleware/rbac.ts:246-252` 的 RBAC_DENIED 先例）。
 * 返回 `true` 表示**已拒绝**（响应已写），调用方一律 `return` 收口。
 */
function denyRbac(res: Response, reason: string, rbac?: RbacContext): true {
  log.warn(
    { code: 'RBAC_DENIED', reason, userId: rbac?.userId, role: rbac?.role },
    '安全判据: 被拒绝 — 行动项端点（fail-closed，HTTP 403）',
  );
  res.status(403).json({ ok: false, error: 'access denied', code: 'RBAC_DENIED' });
  return true;
}

/**
 * 取**已认证**的 RBAC 上下文；`authenticated !== true` ⇒ 写 403 并返回 `undefined`。
 * 调用方形态固定: `const rbac = requireAuthenticatedRbac(req, res); if (!rbac) return;`
 */
function requireAuthenticatedRbac(req: Request, res: Response): RbacContext | undefined {
  const rbac = readRbac(req);
  if (rbac && rbac.authenticated === true) return rbac;
  denyRbac(res, 'no_authenticated_identity', rbac);
  return undefined;
}

// V4.2.1: 从 AgentMemoryStore 持久化恢复
function persistAction(id: string, item: ActionItem): void {
  try {
    rememberMemory({
      orgId: item.workspaceId,
      key: `action_${id}`,
      value: JSON.stringify(item),
      type: 'enterprise_fact',
      confidence: 0.9,
      source: 'user_confirmed',
      tags: ['action', item.status],
      expiresAt: null,
    });
  } catch (err) { log.warn({ err }, 'AgentMemoryStore 不可用 — degraded, 仅内存存储'); }
}

router.post('/api/actions', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫（先于请求体校验——不向匿名调用方泄漏参数契约）
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;

  const { workspaceId, title, description, priority } = req.body as Record<string, string>;
  if (!workspaceId || !title) return res.status(400).json({ ok: false, error: 'workspaceId and title required' });
  const id = `act_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const item: ActionItem = { id, workspaceId, title, description: description || '', status: 'pending', priority: (priority as ActionItem['priority']) || 'medium', createdAt: now, updatedAt: now };
  store.set(id, item);
  persistAction(id, item);
  log.info({ id, title }, '行动项已创建');
  res.json({ ok: true, action: item });
});

router.get('/api/actions', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫。本卡**不做越权判定** —— 见文件头「未做」段
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;
  const wsId = String(req.query.workspaceId || '');
  // 如果内存为空, 从 AgentMemoryStore 恢复
  if (store.size === 0) {
    try {
      const records = listMemory({ orgId: wsId, type: 'enterprise_fact', tags: ['action'], limit: 50 });
      if (records && records.length > 0) {
        for (const r of records) {
          try { const item = JSON.parse(r.value) as ActionItem; store.set(item.id, item); } catch (err) {
            log.warn({ err, orgId: wsId }, 'Action 条目解析失败 — 跳过损坏项');
          }
        }
      }
    } catch (err) { log.warn({ err }, 'AgentMemoryStore 不可用 — degraded'); }
  }
  const list = Array.from(store.values())
    .filter(a => !wsId || a.workspaceId === wsId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ ok: true, actions: list });
});

router.put('/api/actions/:id/status', (req: Request, res: Response) => {
  // D1153/#1051: 身份守卫（先于 404 —— 不因存在性泄漏给匿名调用方；与
  //   workspaces-api.ts:134 的「403 先于资源查找」判据一致）
  const rbac = requireAuthenticatedRbac(req, res);
  if (!rbac) return;

  const id = String(req.params.id);
  const item = store.get(id);
  if (!item) return res.status(404).json({ ok: false, error: 'action not found' });

  const { status } = req.body as { status?: string };
  if (!status) return res.status(400).json({ ok: false, error: 'status required' });
  const valid = ['pending', 'confirmed', 'executing', 'completed', 'rejected'];
  if (!valid.includes(status)) return res.status(400).json({ ok: false, error: `invalid status: ${status}` });
  item.status = status as ActionItem['status'];
  item.updatedAt = new Date().toISOString();
  store.set(id, item);
  persistAction(id, item);
  log.info({ id, status }, '行动项状态已更新');
  res.json({ ok: true, action: item });
});

export default router;
