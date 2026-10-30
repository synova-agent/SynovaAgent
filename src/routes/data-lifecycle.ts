/**
 * routes/data-lifecycle.ts — D40 数据生命周期 API (GDPR 可携带权+被遗忘权)
 *
 * POST /api/data/export          — 导出租户全部数据
 * POST /api/data/purge           — 发起数据清除（四阶段）
 * GET  /api/data/purge/:id/status — 查询清除进度
 *
 * 设计哲学：**身份是唯一的授权与租户来源** —— `role` 与 `tenantId` 一律从验签身份
 *   （`jwtAuthMiddleware` 验签后注入的 `req.auth`）派生；请求体里的 `role` / `tenantId`
 *   只被当作「越权意图声明」：与身份不一致 ⇒ 403 明确拒绝；与身份一致 ⇒ 放行但**以身份为准**。
 *   请求体永远不是执行参数的来源（#1200 · S0-1）。
 *
 * 契约（本文件是 Express 路由，无导出的 compute；契约按端点给）：
 *   @input   — HTTP 请求。`Authorization: Bearer <jwt>` 由 `jwtAuthMiddleware` 验签并注入
 *              `req.auth`（唯一可信来源，不做任何请求头/查询参数回落）；body 形如
 *              `{ tenantId?: string; role?: string; immediate?: boolean }`，其中
 *              `tenantId` / `role` **不是可信输入**，仅用于冲突检测（见下二条 fail-loud 规则）。
 *   @output  — 200 `{ ok: true, … }`（archive / job / message）；
 *              401 `{ ok: false, error, code: 'UNAUTHORIZED' }`（无验签身份 —— 防御性分支，
 *              真 HTTP 下由中间件先行拦截，见文末「已知限制」第 5 条）；
 *              403 `{ ok: false, error, code, reason? }`（身份冲突：`IDENTITY_MISMATCH` /
 *              `CROSS_ORG_DENIED`；或 PolicyEngine 拒绝的既有 `{ ok:false, error }` 形状）；
 *              500 `{ ok: false, error }`（服务层异常，log.warn 带原始原因）。
 *   @exit    — 不适用：路由不自退进程（进程退出码归宿主 `src/index.ts` / bootstrap）。
 *   @degraded — 服务层异常不静默：`log.warn` 记账原始 err 后返回 500，不伪造 200、
 *              不回落 `'default'` 租户（铁律 11/24/31）。
 *
 * 谁能调（explicit authority）：
 *   · 仅**持有效 JWT** 的已认证主体 —— `data-lifecycle` 三端点**均不在 D590 白名单**，
 *     无匿名通道；身份缺失由 `jwtAuthMiddleware` 先行 401。
 *   · `POST /api/data/export` 需 `checkPolicy(req.auth.role, 'data.export')` 放行；
 *   · `POST /api/data/purge` 需 `checkPolicy(req.auth.role, 'data.delete')` 放行（破坏性，最优先）。
 *   · 任何主体都**不能**用请求体自称更高角色（`role_declared`）或别的租户（`org_mismatch`）——
 *     那只会得到 403；自授不生效、不静默改写。
 *
 * 铁律 39: L1 路由层 → L2 桥接 (agent/data-lifecycle-service) → L3 洞察层
 * 铁律 24: catch + log + degraded
 * 铁律 38: 零 as any
 * 铁律 47/48: 契约先行 + 测试配对（tests/security/boundary-identity.test.ts）
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { StandardOperations } from '../security/policy-engine';
import { extractAuthFromRequest } from '../middleware/auth';
import { checkPolicy, executeExport, executePurge, queryPurgeStatus } from '../agent/data-lifecycle-service';

const log = createLogger('routes/data-lifecycle');
const router = Router();

// ═══ 拒绝码（集中在本文件顶部，禁散落字面量；「码＋reason」口径同 src/routes/config.ts:44-56）═══

/** 身份冲突码 —— 只能是这两个（本批不新增第三个业务码；`UNAUTHORIZED` 是既有中间件码） */
const DENY_CODE = {
  /** `body.role` 与验签身份的 `role` 不一致（自授角色） */
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  /** `body.tenantId` 与验签身份的 `orgId` 不一致（跨租户） */
  CROSS_ORG_DENIED: 'CROSS_ORG_DENIED',
  /** 无验签身份 —— 与 `src/middleware/auth.ts` / `src/routes/audit.ts` 同码（非新增） */
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

/** 403 的 reason 细分（与 `DENY_CODE` 成对；`org_mismatch` 与 `config.ts:48` 同义，禁第二套说法） */
const DENY_REASON = {
  /** 请求体声明了角色 */
  ROLE_DECLARED: 'role_declared',
  /** 请求体声明了别的组织 */
  ORG_MISMATCH: 'org_mismatch',
} as const;

/** 身份判定结果：要么拿到可执行的 `(role, tenantId)`，要么一个待原样回写的拒绝载荷 */
type IdentityResolution =
  | { ok: true; role: string; tenantId: string }
  | { ok: false; status: 401 | 403; denial: { ok: false; error: string; code: string; reason?: string } };

/**
 * resolveVerifiedIdentity — 把「请求体自报」折叠为「验签身份」，并**先**校验两处冲突
 *
 * 契约:
 *   @input  — `req`: Express Request（只读 `req.auth`，**不读** `req.query` / 租户类请求头）；
 *             `declared`: 请求体里的 `{ tenantId?, role? }`（**不可信**，仅用于冲突检测）
 *   @output — `{ ok:true, role, tenantId }`：可执行身份，`role` / `tenantId` 全部来自验签身份；
 *             `{ ok:false, status, denial }`：拒绝载荷（status 401/403，`denial` 原样回写响应体）
 *   @exit   — 不适用：纯函数，不自退进程
 *   @degraded — 不适用：身份缺失即 fail-closed 拒绝（401），不降级放行、不回落 `'default'`/`'boss'`
 * @param req - Express 请求（验签身份由 `jwtAuthMiddleware` 注入）
 * @param declared - 请求体里的自报字段（不可信，只作冲突检测）
 * @returns 见 `@output`
 */
function resolveVerifiedIdentity(
  req: Request,
  declared: { tenantId?: unknown; role?: unknown },
): IdentityResolution {
  // 唯一可信来源：`jwtAuthMiddleware` 验签后注入的 `req.auth`（复用既有提取器，禁另造判定器）
  const identity = extractAuthFromRequest(req);
  if (!identity || !identity.role || !identity.orgId) {
    // fail loud：没有验签身份就没有授权与租户来源 —— 绝不回落 'default' / 'boss'
    return {
      ok: false,
      status: 401,
      denial: { ok: false, error: '未认证（缺少验签身份）', code: DENY_CODE.UNAUTHORIZED },
    };
  }

  // 🔴 顺序不变量：冲突校验必须在任何赋值 / checkPolicy **之前**。
  //   反写（先赋值再校验）⇒ 403 永不触发 ⇒ U-2 / U-3 必红（改坏必红判据见测试件）。

  // ① 自授角色：body.role 在场且不等于身份 role ⇒ 403 IDENTITY_MISMATCH
  if (declared.role !== undefined && declared.role !== identity.role) {
    return {
      ok: false,
      status: 403,
      denial: {
        ok: false,
        error: '角色声明与验签身份不一致（禁止自授角色）',
        code: DENY_CODE.IDENTITY_MISMATCH,
        reason: DENY_REASON.ROLE_DECLARED,
      },
    };
  }

  // ② 跨租户：body.tenantId 在场且不等于身份 orgId ⇒ 403 CROSS_ORG_DENIED
  if (declared.tenantId !== undefined && declared.tenantId !== identity.orgId) {
    return {
      ok: false,
      status: 403,
      denial: {
        ok: false,
        error: '跨租户访问被拒绝（声明 tenantId 与验签身份不一致）',
        code: DENY_CODE.CROSS_ORG_DENIED,
        reason: DENY_REASON.ORG_MISMATCH,
      },
    };
  }

  // ③ 一致（或未声明）⇒ 放行；声明了且一致只记一次 warn —— 不打断旧调用方，也不静默改写
  if (declared.role !== undefined) {
    log.warn(
      { declaredRole: declared.role, role: identity.role, tenantId: identity.orgId },
      '请求体声明 role 与验签身份一致：放行（以身份为准）',
    );
  }

  return { ok: true, role: identity.role, tenantId: identity.orgId };
}

/** 从 app.locals 提取 GraphStore（运行时注入，无 L4 静态导入） */
function getGraphStore(req: Request): unknown {
  const gs = req.app.locals?.graphStore;
  if (!gs || typeof (gs as Record<string, unknown>).queryNodes !== 'function') {
    throw new Error('GraphStore 不可用');
  }
  return gs;
}

// ═══ POST /api/data/export ═══

router.post('/api/data/export', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const identity = resolveVerifiedIdentity(req, { tenantId: body.tenantId, role: body.role });

  if (!identity.ok) {
    log.warn(
      { code: identity.denial.code, reason: identity.denial.reason },
      '数据导出请求被拒绝（身份门）',
    );
    return res.status(identity.status).json(identity.denial);
  }

  const { role, tenantId } = identity;

  try {
    const denyReason = checkPolicy(role, StandardOperations.DATA_EXPORT);
    if (denyReason) {
      log.warn({ tenantId, role, denyReason }, '数据导出权限拒绝');
      return res.status(403).json({ ok: false, error: denyReason });
    }

    const graphStore = getGraphStore(req);
    const result = await executeExport(graphStore, tenantId);

    return res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, tenantId }, '数据导出失败');
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ POST /api/data/purge ═══

router.post('/api/data/purge', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const identity = resolveVerifiedIdentity(req, { tenantId: body.tenantId, role: body.role });

  if (!identity.ok) {
    log.warn(
      { code: identity.denial.code, reason: identity.denial.reason },
      '数据清除请求被拒绝（身份门）',
    );
    return res.status(identity.status).json(identity.denial);
  }

  const { role, tenantId } = identity;
  // `immediate` 是执行模式（不是身份），保持原语义：只认布尔 true，其余一律 false
  const immediate = body.immediate === true;

  try {
    const denyReason = checkPolicy(role, StandardOperations.DATA_DELETE);
    if (denyReason) {
      log.warn({ tenantId, role, denyReason }, '数据删除权限拒绝');
      return res.status(403).json({ ok: false, error: denyReason });
    }

    const graphStore = getGraphStore(req);
    const result = await executePurge(graphStore, tenantId, immediate);

    return res.json({ ok: true, job: result.job, message: result.message });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, tenantId }, '数据清除发起失败');
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ GET /api/data/purge/:id/status ═══

router.get('/api/data/purge/:id/status', async (req: Request, res: Response) => {
  const purgeIdParam = req.params.id;
  const purgeId = Array.isArray(purgeIdParam) ? purgeIdParam[0] : purgeIdParam;

  if (!purgeId) {
    return res.status(400).json({ ok: false, error: 'purgeId 必填' });
  }

  try {
    const graphStore = getGraphStore(req);
    const job = queryPurgeStatus(graphStore, purgeId);

    if (!job) {
      return res.status(404).json({ ok: false, error: '清除任务不存在' });
    }

    return res.json({ ok: true, job });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, purgeId }, '查询清除状态失败');
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;

// ═══ 已知限制（Known Limitations）═══
//
// 1. **只覆盖本文件两个写/破坏端点**（`POST /api/data/export`、`POST /api/data/purge`）。
//    `GET /api/data/purge/:id/status` 只按 `purgeId` 查进度，本批未纳入身份收窄（不在 #1200 判据）。
//    其余仍自报租户的非白名单端点（`src/routes/im.ts`、`admin-knowledge.ts`、`evolution.ts`、
//    `chat.ts`）归 S0-2，本文件不碰。
// 2. **不做条目级权限**：只解决「role 与 tenant 从哪来」，不做 principal×resource×action
//    （T1-11），不做数据 scope 标签。
// 3. **导出内容不闭合**：本件只修**身份门**（能导出谁）；`DataExporter` 本身不做租户作用域
//    （边全量、无租户字段节点保守包含、四路查询图恒 `'default'`）⇒ 同租户请求也可能看到
//    别人的边与无主节点。已另立卡 **#1203**；不得据本文件宣称「导出面边界已闭合」。
// 4. **服务层未再校验租户**：`executeExport` / `executePurge` 内部不校验 tenantId 与身份的关系，
//    收口只在路由层。将来若出现第二条（非路由）调用路径，本防线不覆盖 —— 归 S1 议题。
// 5. **401 分支在真 HTTP 下不可达**：中间件先行 401（`jwtAuthMiddleware`）。此处防御性判空
//    只为 fail-closed 兜底，**不新增 `AUTH_REQUIRED` 码**（该码不存在），判据只承诺 401 状态。
// 6. **人在环审批未接**：`HIGH_RISK_ACTIONS` 不含 `data.export` / `data.delete`，破坏性操作
//    今天仍无「人点头」环节。纳入人门会改运行时语义并触碰 M5 写集 ⇒ §9-⑤ 另立卡，本件不碰。
// 7. **允许一致声明**：调用方仍可传 `body.role` / `body.tenantId`，与身份一致即放行（`log.warn`
//    记一次），避免无谓打断旧调用方；**不静默改写**、不一致即拒。
// 8. **两态环境**：`DEV_MODE=true` 且无 `JWT_SECRET` 时中间件注入 dev 身份
//    （`src/middleware/auth.ts` 白名单外的 devMode 分支）⇒ 生产态判据须在测试内显式
//    `set JWT_SECRET` + `delete DEV_MODE`，否则「无身份态」不存在。
