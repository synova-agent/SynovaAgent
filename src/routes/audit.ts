/**
 * routes/audit.ts — 审计日志 API (Phase 0.3, Desktop 实施方案)
 *
 * 仅供 enterprise owner/admin 访问。
 * GA 角色调用返回 403 Forbidden。
 *
 * GET /api/audit          — 查询审计日志
 * GET /api/audit/ga/:gaId — 指定 GA 操作历史
 *
 * 契约（铁律 47）:
 *   @input  — HTTP GET，`req.auth` 为 `jwtAuthMiddleware` 注入的**验签身份**：
 *             GET /api/audit?orgId=&action=&actorId=&targetType=&limit=
 *             GET /api/audit/ga/:gaId?orgId=
 *             `query.orgId` **只是"声明"**：在场且 ≠ 身份 orgId ⇒ 403（不参与租户选择）；
 *             缺席 ⇒ 租户＝身份 orgId（🔴 不回落 `'default'`）。
 *   @output — 200 `{ok:true, entries, total}`（GA 历史另带 `gaId`）；
 *             401 `{ok:false, code:'UNAUTHORIZED', message}`；
 *             403 `{ok:false, code:'FORBIDDEN'|'CROSS_ORG_DENIED', reason?, message}`；
 *             500 `{ok:false, code:'INTERNAL_ERROR', message, degraded:true}`。
 *   @exit   — 进程内路由，无退出码；失败面只用 HTTP 状态码表达（401/403/500）。
 *   @degraded — 查询异常：`log.error` ＋ 500 ＋ `degraded:true`（铁律 24/31，不静默）。
 *
 * 授权（explicit authority，#1200 §1.2-2）：仅**已验证身份的 `admin`**（企业主/管理员）可调用本路由。
 *   无身份 ⇒ 中间件先行 401 `UNAUTHORIZED`（`requireAdminOrOwner` 同码兜底）；
 *   身份存在但非 admin ⇒ 403 `FORBIDDEN`。GA/staff/manager/liaison 一律读不到审计日志。
 *
 * 设计哲学：**身份是唯一的授权与租户来源** —— 授权看 `req.auth.role`、租户看 `req.auth.orgId`；
 *   请求体/查询串只能"声明"，不能"授予"。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { AuditService } from '../services/audit-service';
import { extractAuthFromRequest } from '../middleware/auth';

const log = createLogger('routes/audit');
const router = Router();

// ── 拒绝码/原因常量（集中，禁散落字面量）───────────────────────────────
/** 401：无验签身份（沿用既有码；🔴 不新增 `AUTH_REQUIRED` —— #1200 §1.2-4）。 */
const CODE_UNAUTHORIZED = 'UNAUTHORIZED';
/** 403：有身份但非 admin（权限不足）。 */
const CODE_FORBIDDEN = 'FORBIDDEN';
/** 403：声明租户 ≠ 验签身份租户（与 `src/routes/config.ts:44-56` **同码同义**，禁第二套说法）。 */
const CODE_CROSS_ORG_DENIED = 'CROSS_ORG_DENIED';
/** 拒绝原因：租户声明与身份不一致（与 `config.ts` 同义）。 */
const REASON_ORG_MISMATCH = 'org_mismatch';
/** 500：查询异常（degraded 响应，铁律 24/31）。 */
const CODE_INTERNAL_ERROR = 'INTERNAL_ERROR';

// ════════════════════════════════════════════════════════════════
// 中间件: 仅 admin/owner 可访问审计日志
// ════════════════════════════════════════════════════════════════

function requireAdminOrOwner(req: Request, res: Response): boolean {
  const authCtx = extractAuthFromRequest(req);
  if (!authCtx) {
    res.status(401).json({ ok: false, code: CODE_UNAUTHORIZED, message: '未认证' });
    return false;
  }
  if (authCtx.role !== 'admin') {
    res.status(403).json({ ok: false, code: CODE_FORBIDDEN, message: '仅企业主/管理员可查看审计日志' });
    return false;
  }
  return true;
}

/**
 * rejectCrossOrgQuery — 租户声明闸（`GET /api/audit` 与 `GET /api/audit/ga/:gaId` **同型**，#1200 §1.2-1）
 *
 * 契约（铁律 47）:
 *   @input  — req: Express Request（只读 `req.query.orgId`，它是**声明**不是来源）；
 *             identityOrgId: string（＝`req.auth.orgId`，**唯一租户来源**）。
 *   @output — `true` ＝ 声明与身份不一致、已写 403 `CROSS_ORG_DENIED`/`org_mismatch`（调用方**必须立即 return**）；
 *             `false` ＝ 声明缺席或与身份一致，放行。
 *             `query.orgId` 非字符串（数组/缺省）⇒ 视为**未声明**（不据此选租户，fail-safe）。
 *   @exit   — 进程内函数，无退出码；拒绝面只用 403 表达。
 *   @degraded — 不适用：无降级路径、不吞错；🔴 **不回落 `'default'`**（#1200 §1.2-4 / §7 红线）。
 *   @error  — typed code：`{ok:false, code:'CROSS_ORG_DENIED', reason:'org_mismatch', message}`
 *             （码复用 `config.ts`，§1.2-1；禁第二套说法）。
 */
function rejectCrossOrgQuery(req: Request, res: Response, identityOrgId: string): boolean {
  const declaredOrgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  if (declaredOrgId === undefined || declaredOrgId === identityOrgId) return false;
  res.status(403).json({
    ok: false,
    code: CODE_CROSS_ORG_DENIED,
    reason: REASON_ORG_MISMATCH,
    message: '跨租户访问被拒绝（声明 orgId 与验签身份不一致）',
  });
  return true;
}

// ════════════════════════════════════════════════════════════════
// GET /api/audit — 查询审计日志
// ════════════════════════════════════════════════════════════════

router.get('/api/audit', (req: Request, res: Response) => {
  try {
    if (!requireAdminOrOwner(req, res)) return;

    const authCtx = extractAuthFromRequest(req)!;
    // 🔴 租户来源＝验签身份（#1200 §1.2-1）：query.orgId 只在上一道闸做一致性比对，永不作为租户。
    if (rejectCrossOrgQuery(req, res, authCtx.orgId)) return;
    const orgId: string = authCtx.orgId;
    const action = req.query.action as string | undefined;
    const actorId = req.query.actorId as string | undefined;
    const targetType = req.query.targetType as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const entries = AuditService.query(orgId, { action, actorId, targetType, limit });

    res.json({
      ok: true,
      entries,
      total: entries.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, '查询审计日志异常');
    res.status(500).json({ ok: false, code: CODE_INTERNAL_ERROR, message: msg, degraded: true });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/audit/ga/:gaId — 指定 GA 操作历史
// ════════════════════════════════════════════════════════════════

router.get('/api/audit/ga/:gaId', (req: Request, res: Response) => {
  try {
    if (!requireAdminOrOwner(req, res)) return;

    const authCtx = extractAuthFromRequest(req)!;
    // 🔴 同上：租户＝身份；`gaId` 是**被查主体**，不是租户（#1200 §1.2-3，路径参数不动）。
    if (rejectCrossOrgQuery(req, res, authCtx.orgId)) return;
    const orgId: string = authCtx.orgId;
    const { gaId } = req.params;

    const entries = AuditService.getGAHistory(orgId, gaId as string);

    res.json({
      ok: true,
      gaId,
      entries,
      total: entries.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, '查询 GA 操作历史异常');
    res.status(500).json({ ok: false, code: CODE_INTERNAL_ERROR, message: msg, degraded: true });
  }
});

// ════════════════════════════════════════════════════════════════
// 已知限制（#1200 §4；知情登记，不在本件修）
// ════════════════════════════════════════════════════════════════
// 1. 本批只覆盖 4 个端点：`data-lifecycle`（export/purge 2）＋ 本文件（audit 2）。
//    其余非白名单自报租户点（`src/routes/im.ts:113`／`admin-knowledge.ts:117`／
//    `evolution.ts:255,279`／`chat.ts:93`）归 S0-2，本件不碰。
// 2. D590 白名单族**不动**（§9-①）：`diagnosis`／`sessions`／`sentinel`／`ontology/*`
//    仍可按 body/query 自报租户；其中 `ontology/ingest` 是写面，已单列待裁。
//    ⇒ 本文件收口的是"审计面"，不等于"全仓入口身份已闭合"。
// 3. 不做条目级权限（principal × resource × action）：本文件只解决"租户从哪来"。
// 4. `requireAdminOrOwner` 的 `!authCtx` 分支在真 HTTP 下不可达（中间件先行 401）；
//    保留它作纵深防御，**不新增 `AUTH_REQUIRED` 码**（§1.2-4）。
// 5. 审计条目的租户归集仍由 `AuditService`／存储层按 `orgId` 过滤；本文件只保证**传入的
//    orgId 来自验签身份**，不改存储层语义。

export default router;
