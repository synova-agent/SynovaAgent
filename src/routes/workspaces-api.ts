/**
 * workspaces-api.ts — 工作区 CRUD API (PRD v1.6 Slice 2)
 *
 * GET  /api/workspaces          → 工作区列表
 * POST /api/workspaces          → 创建工作区
 * GET  /api/workspaces/:id      → 工作区详情
 * PUT  /api/workspaces/:id/status → 更新状态
 * POST /api/workspaces/:id/messages → 发送消息
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { extractRbacContext, canAccessWorkspace, canModifyWorkspace, type RbacContext } from '../middleware/rbac';

const log = createLogger('routes/workspaces-api');
const router = Router();

// ════════════════════════════════════════════════════════════════
// D947 P3/P5 — 路由级写守卫（fail-closed）
// ════════════════════════════════════════════════════════════════

/**
 * 取当前请求的验签 RBAC 上下文。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: express Request，其中 `req.rbac` 由 `middleware/rbac.rbacMiddleware` 注入。
 *   该注入的**唯一可信来源**是 `req.auth`（jwtAuthMiddleware 验签后写入）；
 *   客户端自报凭据（`x-synova-token` / `query.token`）在 PR-1 后永不进入 `req.rbac`。
 * - 输出: `RbacContext`（含 `authenticated` 标记）或 `undefined`（中间件未执行/未挂载）。
 * - 降级: 无。**不重算** `extractRbacContext(req)` —— 依 L-4：P3 必须消费 `req.rbac`，
 *   否则 P4 的中间件前移退化为行为空操作（P3 与 P4 成对验收的前提）。
 */
function readRbac(req: Request): RbacContext | undefined {
  return (req as Request & { rbac?: RbacContext }).rbac;
}

/**
 * 写端点守卫：无验签上下文 / 未认证 → 403 + 留痕（P5 三态之「被拒绝」）。
 * 返回 `true` 表示**已拒绝**（响应已写），调用方一律 `return` 收口。
 */
function denyWorkspaceWrite(res: Response, reason: string, rbac?: RbacContext): true {
  log.warn(
    { code: 'WORKSPACE_WRITE_DENIED', reason, userId: rbac?.userId, role: rbac?.role },
    '安全判据: 被拒绝 — 工作区写操作（fail-closed，403）',
  );
  res.status(403).json({ ok: false, error: 'access denied' });
  return true;
}

/**
 * 取**已验签**的 RBAC 上下文；无验签身份 → 写 403 并返回 `undefined`。
 * 调用方形态固定为：`const rbac = requireVerifiedRbac(req, res); if (!rbac) return;`
 * ⇒ 既 fail-closed，又让 TS 正确收窄，且判据结果**从不被丢弃**。
 * D1002: 不消费上下文的端点可写短式 `if (!requireVerifiedRbac(req, res)) return;`（判据同样从不丢弃）。
 */
function requireVerifiedRbac(req: Request, res: Response): RbacContext | undefined {
  const rbac = readRbac(req);
  if (rbac && rbac.authenticated !== false) return rbac;
  denyWorkspaceWrite(res, 'no_verified_identity', rbac);
  return undefined;
}

interface Workspace {
  id: string;
  title: string;
  type: 'diagnostic' | 'manual';
  status: 'pending' | 'analyzing' | 'confirmed' | 'executing' | 'resolved' | 'shelved';
  priority: 'critical' | 'high' | 'medium' | 'low';
  expert?: string;
  // PRD v1.6 Slice 7: 部门协作扩展
  department?: string;
  parentWsId?: string;
  owner?: string;
  visibility: 'global' | 'department' | 'private';
  source?: 'agent_suggested' | 'boss_assigned' | 'self_created';
  inheritedContext?: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceConflict {
  id: string;
  type: 'numeric' | 'temporal' | 'resource';
  dimension: string;
  workspaceA: { id: string; department: string; value: string; evidence: string };
  workspaceB: { id: string; department: string; value: string; evidence: string };
  detectedAt: string;
  status: 'open' | 'escalated' | 'resolved';
}

// In-memory store (Phase 1; Phase 2 → SQLite via SessionStore)
const store = new Map<string, Workspace>();

router.get('/api/workspaces', (_req: Request, res: Response) => {
  const list = Array.from(store.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  res.json({ ok: true, workspaces: list });
});

router.post('/api/workspaces', (req: Request, res: Response) => {
  // D947 P3: 写守卫（无验签身份 → 403，fail-closed）
  const rbac = requireVerifiedRbac(req, res);
  if (!rbac) return;
  // 创建动作无既有目标，按「调用者即属主」提交给统一判据（admin 通过；ga/staff/liaison 拒绝）
  if (!canModifyWorkspace(rbac, { owner: rbac.userId })) {
    return denyWorkspaceWrite(res, 'insufficient_permission', rbac);
  }

  const { title, type = 'manual' } = req.body as { title?: string; type?: 'diagnostic' | 'manual' };
  if (!title) return res.status(400).json({ ok: false, error: 'title is required' });

  const id = `ws_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const ws: Workspace = {
    id, title, type, status: 'pending', priority: 'medium',
    // D947 P0: owner 来自**验签身份**（rbac.userId），不再留空——留空会使
    //   `GET /api/workspaces/mine` 的非管理员过滤与 `canModifyWorkspace` 的
    //   `ws.owner === userId` 分支同时失去判据（原实现无 owner，两处恒不成立）。
    owner: rbac.userId,
    visibility: 'global', createdAt: now, updatedAt: now,
  };
  store.set(id, ws);
  log.info({ id, title, owner: rbac.userId }, '工作区已创建');
  res.json({ ok: true, workspace: ws });
});

// ═══ D1002 F-1: 注册序修复 — 静态/字面量段路由先于参数段 GET /:id 注册 ═══
// Express 按注册序匹配：/mine、/conflicts 若注册在 /:id 之后，一段式 GET 会被
// /:id 以 id='mine'/'conflicts' 吞掉（HTTP 恒 404）；/by-dept/:dept 为两段式虽未被
// 遮蔽，一并前移属防御性卫生。顺序契约 = tests/routes/workspaces-mine-conflicts.test.ts。

// 按部门过滤
router.get('/api/workspaces/by-dept/:dept', (req: Request, res: Response) => {
  const dept = req.params.dept;
  const list = Array.from(store.values())
    .filter(w => w.department === dept || w.visibility === 'global')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ ok: true, workspaces: list, department: dept });
});

// 获取当前用户可见的工作区
router.get('/api/workspaces/mine', (req: Request, res: Response) => {
  // D947 P0（活越权读修复）——改前实现（实测 file:line 记于 evidence）:
  //   const token = String(req.headers['x-synova-token'] || '');
  //   const role = token.includes('admin') ? 'admin' : token.includes('liaison') ? 'liaison' : 'manager';
  //   const dept = token.split(':')[1] || '';
  //   ① 身份来自**未验签**的自报头子串判定 ⇒ 已认证的低权用户只要带 `x-synova-token: admin`
  //      即得 role='admin' ⇒ 返回**全部工作区**（含跨部门/他人私有）。
  //   ② 不带该头时默认 role='manager'（不得默认 manager —— 默认放行姿态）。
  //   改后：身份**只**取自 `req.rbac`（rbacMiddleware ← jwtAuthMiddleware 验签后注入）；
  //   无验签身份 → 403 fail-closed；自报头零参与。
  const rbac = requireVerifiedRbac(req, res);
  if (!rbac) return;

  const role = rbac.role;
  const dept = rbac.department;   // R5/REV-8（D947 期口径）: JWT 载荷无 department ⇒ 恒 undefined；D1000 切片 A 起由 JWT 携带——届时以身份链为准
  const userId = rbac.userId;

  let list: Workspace[];
  if (role === 'admin' || role === 'liaison') {
    list = Array.from(store.values());
  } else {
    list = Array.from(store.values()).filter(w =>
      w.department === dept || w.owner === userId || w.visibility === 'global',
    );
  }
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ ok: true, workspaces: list, role, department: dept });
});

// 冲突检测 (对接人)
router.get('/api/workspaces/conflicts', (req: Request, res: Response) => {
  // D1002: 读端点守卫（先加守卫、后放开遮蔽，两步同一 commit 不拆；短式——不消费上下文）
  if (!requireVerifiedRbac(req, res)) return;
  const conflicts: WorkspaceConflict[] = [];
  const all = Array.from(store.values()).filter(w => w.status === 'confirmed');

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]; const b = all[j];
      if (a.department === b.department) continue;
      // 简单数值型冲突: 同title的confirmed workspace跨部门 → 标记冲突
      if (a.title.includes(b.title.slice(0, 5)) || b.title.includes(a.title.slice(0, 5))) {
        conflicts.push({
          id: `conflict_${Date.now().toString(36)}`,
          type: 'numeric',
          dimension: a.title,
          workspaceA: { id: a.id, department: a.department || 'unknown', value: a.title, evidence: '' },
          workspaceB: { id: b.id, department: b.department || 'unknown', value: b.title, evidence: '' },
          detectedAt: new Date().toISOString(),
          status: 'open',
        });
      }
    }
  }
  res.json({ ok: true, conflicts, count: conflicts.length });
});

router.get('/api/workspaces/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });
  res.json({ ok: true, workspace: ws });
});

router.put('/api/workspaces/:id/status', (req: Request, res: Response) => {
  // D947 P3: 无验签身份 → 403（先于资源查找，不因 404 泄漏存在性给匿名调用方）
  const rbac = requireVerifiedRbac(req, res);
  if (!rbac) return;

  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });
  // D947 P3: 权限判据绑定**目标工作区**（department + owner）
  if (!canModifyWorkspace(rbac, { department: ws.department, owner: ws.owner })) {
    return denyWorkspaceWrite(res, 'insufficient_permission', rbac);
  }

  const { status, priority } = req.body as { status?: Workspace['status']; priority?: Workspace['priority'] };
  if (status) {
    // V4.2.3: 状态流转验证 — PRD §8 工作区生命周期
    const validTransitions: Record<string, string[]> = {
      pending: ['analyzing'],
      analyzing: ['confirmed', 'pending'],
      confirmed: ['executing', 'analyzing'],
      executing: ['resolved', 'shelved', 'confirmed'],
      shelved: ['pending', 'resolved'],
      resolved: [],
    };
    const allowed = validTransitions[ws.status];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: `无效状态流转: ${ws.status} → ${status}` });
    }
    ws.status = status;
  }
  if (priority) ws.priority = priority;
  ws.updatedAt = new Date().toISOString();
  store.set(id, ws);
  log.info({ id, status }, '工作区状态已更新');
  res.json({ ok: true, workspace: ws });
});

router.post('/api/workspaces/:id/messages', (req: Request, res: Response) => {
  // D947 P3: 无验签身份 → 403
  const rbac = requireVerifiedRbac(req, res);
  if (!rbac) return;

  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });
  // D947 P3: 权限判据绑定目标工作区
  if (!canModifyWorkspace(rbac, { department: ws.department, owner: ws.owner })) {
    return denyWorkspaceWrite(res, 'insufficient_permission', rbac);
  }

  const { content } = req.body as { content?: string };
  if (!content) return res.status(400).json({ ok: false, error: 'content is required' });

  // v3.3: 基于工作区上下文的真实回复（替代echo空壳）
  const contextSummary = `工作区"${ws.title}"（类型: ${ws.type}, 状态: ${ws.status}, 优先级: ${ws.priority}）。`;
  let reply: string;
  if (ws.type === 'diagnostic') {
    reply = `${contextSummary}\n\n我分析了你在诊断工作区中的问题"${content.slice(0, 100)}"。当前诊断状态为"${ws.status}"。你可以：\n1. 补充更多企业数据以提升诊断精度\n2. 确认或驳回我的判断\n3. 要求我深入分析某个维度`;
  } else {
    reply = `${contextSummary}\n\n关于"${content.slice(0, 100)}"——我基于当前工作区上下文的理解如上。你可以进一步描述细节，或切换到诊断工作区进行深度分析。`;
  }
  res.json({ ok: true, reply, workspaceId: ws.id });
});

// v3.5 PRD §17: 工作区上下文数据（RBAC服务端验证）
router.get('/api/workspaces/:id/context', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });
  // RBAC: 验证请求者是否有权限访问此工作区
  // D947: 保留 `extractRbacContext` 取数（PR-1 后该函数唯一可信来源 = 验签后的 req.auth，
  //   自报头/query 永不参与 ⇒ 已 fail-closed）。**读端点**不属 L-4 的 P3 射程
  //   （P3 = 5 个写端点消费 req.rbac），故此处不改为 req.rbac，零多余耦合。
  const ctx = extractRbacContext(req);
  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
    return res.status(403).json({ ok: false, error: 'access denied' });
  }
  const sources = ws.department
    ? ['本部门数据', '竞品数据库', '客户调研报告']
    : ['全局诊断报告', '财务数据', '行业基准'];
  res.json({ ok: true, sources, workspaceId: ws.id, department: ws.department });
});

// ═══ PRD v1.6 Slice 7: 部门协作扩展 ═══

// 创建子工作区 (Agent建议 或 老板手动分配)
router.post('/api/workspaces/:id/sub', (req: Request, res: Response) => {
  // D947 P3: 无验签身份 → 403
  const rbac = requireVerifiedRbac(req, res);
  if (!rbac) return;

  const parentId = String(req.params.id);
  const parent = store.get(parentId);
  if (!parent) return res.status(404).json({ ok: false, error: 'parent workspace not found' });
  // D947 P3: 本端点**修改的是父工作区**（挂载子节点）⇒ 判据绑定父工作区
  if (!canModifyWorkspace(rbac, { department: parent.department, owner: parent.owner })) {
    return denyWorkspaceWrite(res, 'insufficient_permission', rbac);
  }

  const { department, title } = req.body as { department?: string; title?: string };
  if (!department || !title) return res.status(400).json({ ok: false, error: 'department and title required' });

  const id = `ws_sub_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const subWs: Workspace = {
    id, title, type: 'manual', status: 'pending', priority: parent.priority,
    department, parentWsId: parentId,
    // D947: owner 由字面量 'agent' 改为**验签身份**（rbac.userId）。
    //   理由：字面量 owner 无法被任何验签身份匹配 ⇒ `canModifyWorkspace` 的
    //   `ws.owner === userId` 分支对本资源恒不成立 ⇒ 子工作区创建后即成
    //   只能 admin 触碰的死资源（PUT /:id/merge 亦同）。属 P3 接线所必需。
    owner: rbac.userId, visibility: 'department',
    source: req.body.agentSuggested ? 'agent_suggested' : 'boss_assigned',
    inheritedContext: `从全局方案"${parent.title}"分配。目标: ${parent.title}。状态: ${parent.status}。`,
    createdAt: now, updatedAt: now,
  };
  store.set(id, subWs);
  log.info({ id, department, parentId, owner: rbac.userId }, '子工作区已创建');
  res.json({ ok: true, workspace: subWs });
});

// 子工作区方案汇入全局
router.put('/api/workspaces/:id/merge', (req: Request, res: Response) => {
  // D947 P3: 无验签身份 → 403
  const rbac = requireVerifiedRbac(req, res);
  if (!rbac) return;

  const id = String(req.params.id);
  const ws = store.get(id);
  // D1002 E-2: 权限判据**前移到形状校验之前**——低权（staff/ga/liaison/非属主 manager）
  //   对任何 id 形态先吃 403，不向未授权方泄露存在性/形状；admin 才落到 400/404 层。
  //   D947 P3 原判据不变：绑定被汇入的**子工作区**（改名/状态流转的目标资源）；
  //   ws 不存在时按 {department:undefined, owner:undefined} 提交判据（低权恒 deny）。
  if (!canModifyWorkspace(rbac, { department: ws?.department, owner: ws?.owner })) {
    return denyWorkspaceWrite(res, 'insufficient_permission', rbac);
  }

  if (!ws || !ws.parentWsId) return res.status(400).json({ ok: false, error: 'not a sub-workspace' });

  const parent = store.get(ws.parentWsId);
  if (!parent) return res.status(404).json({ ok: false, error: 'parent not found' });

  ws.status = 'resolved';
  ws.updatedAt = new Date().toISOString();
  store.set(id, ws);
  log.info({ id, parentId: ws.parentWsId }, '子工作区方案已汇入全局');
  res.json({ ok: true, workspace: ws, parentTitle: parent.title });
});

export default router;
