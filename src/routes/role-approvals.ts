/**
 * src/routes/role-approvals.ts — 岗位包审批 API（写/读面；#1075 P3）
 *
 * 架构位置: **L1 交互面**（`src/routes/`）。**注册点 = `src/server.ts`，必须在 `jwtAuthMiddleware` 之后**
 *   （数据面全部要身份；与页面壳 `role-packs-page.ts` 相反 —— 页面先于 auth、API 后于 auth，规格 §2.2-D7）。
 *
 * 设计哲学（一句）: **本文件只做"身份 → 写模块 → 审计 → 读回"的翻译** ——
 *   审批的**真判定**在 `src/init/role-pack-approval-write.ts`（写）与 `src/init/role-pack-approval.ts`（读），
 *   这里**不复制任何判定**，只把 typed 结果翻成 HTTP，并在**批准/撤销/改 scope 成功时**追加一条审计。
 *
 * 契约（铁律 47）:
 *   @input  — 三条 Bearer 路由（均要求 `req.auth` 存在；org/角色守卫见下）:
 *             · `GET  /api/role-packs`                    → 列表（`loadRolePacks()` 的真实返回）
 *             · `GET  /api/role-packs/:roleId`            → 详情（六件文本＋现场指纹＋记录＋审计历史＋链校验）
 *             · `POST /api/role-packs/:roleId/approval`   → `{action:'approve'|'revoke', scope?, expectedContentHash?}`
 *   @output — 200 `{ok:true, ...}`；错误 4xx/5xx `{ok:false, code, message}`（码表＝规格 §2.3-B）。
 *             `approve` 成功后**重新** `loadRolePacks()` 取 `pack.approval` 返回（写后即时生效的证据）。
 *   @degraded — **不抛**：写失败一律 typed 结果 → 码表；读面降级（六件读不出／审计未初始化）显式进响应
 *             （`pieceError`／`chain:null`）＋ `log.warn(degraded:true)`（铁律 11/24/31），不静默吞。
 *             唯一 fail-loud 出口 = `E_APPROVAL_IO` ⇒ HTTP **500** ＋ `log.error`（IO 错误即未写入）。
 *   @authority — 角色白名单 **admin／manager／ga**（规格 §〇.7-1）；其余角色 403。
 *             org 单源 = `loadConfig().orgId`（规格 §2.2-D8）：`req.auth.orgId` 不等 ⇒ 403 `E_APPROVAL_ORG_MISMATCH`。
 *             记录 `orgId` **恒取 loadConfig().orgId**（禁 `req.auth.orgId` 当记录 org —— 双源会永不生效）。
 *             审计**唯一通道** = `AuditService`（`src/services/audit-service.ts`）；🔴 **禁** import `src/l4/**`（铁律 39）。
 *   @not-here — 不做审批判定（写模块负责）；不写六件正文进审计（只写 `contentHash`/`scope`/`approvalId`）；
 *             不做四眼/签名/通知（§1.3 非目标）；不做页面（`role-packs-page.ts`）与审批会话卡（T3 已接）。
 *
 * 身份与码表（规格 §2.3-B）:
 *   401 `UNAUTHORIZED`（无 `req.auth`；生产态由中间件先行）｜403 `E_APPROVAL_ROLE_FORBIDDEN`（角色不足）｜
 *   403 `E_APPROVAL_ORG_MISMATCH`（org 不符）｜400 `E_APPROVAL_ROLE_ID_INVALID`（roleId 形状/穿越）｜
 *   404 `E_APPROVAL_ROLE_NOT_FOUND`（包不存在）｜404 `E_APPROVAL_NOT_FOUND`（撤销无记录）｜
 *   409 `E_APPROVAL_CONTENT_CHANGED`（指纹不符；**零写入零审计**）｜422 `E_APPROVAL_SCOPE_INVALID`｜
 *   403 `E_APPROVAL_FACTORY_LOCKED`（出厂锚优先）｜503 `E_APPROVAL_WRITE_DISABLED`（`SYNOVA_APPROVAL_WRITE=off`）｜
 *   500 `E_APPROVAL_IO`（IO 失败，fail loud）。
 *   路由层自有的两个 4xx 码（非写模块码表，复用同一 `E_APPROVAL_` 命名空间）:
 *   · 400 `E_APPROVAL_ACTION_INVALID`（body.action 不是 approve/revoke）
 *   · 413 `E_APPROVAL_BODY_TOO_LARGE`（body > 16 KiB，规格 §2.2-D11）
 *
 * 审计（规格 §2.3-D）:
 *   · `role_pack.approved`     — 首次批准 / 内容变更后重新批准（`unchanged:false`）
 *   · `role_pack.scope_changed`— 同 hash 下 scope 变更（旧记录存在且 hash 相同、scope 不同）
 *   · `role_pack.revoked`      — 撤销（**不删审计**；再撤 404，非 200 幂等，§10-L5）
 *   · `oldValue`/`newValue` 只含 `{contentHash, scope, approvalId}`（**禁六件正文**）；
 *     `unchanged:true`（同 hash 同 scope 重复批准）**不新增审计**（D9）。
 *   目标键：`targetType='role_pack'`、`targetId=<roleId>`（详情面的审计历史按此过滤）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · L1 · 无四眼：同一人可自建自批；记录只记 `approver`（§10-L1）。
 *   · L2 · 无签名/抗伪造：审计链只证事件序，不证记录文件内容；贴回旧记录可恢复（§10-L2、P2-1 L1）。
 *   · L5 · 撤销 404 语义：再撤不返回 200 幂等（§10-L5）。
 *   · L-page-1 · 详情六件文本单件 ≤64 KiB，超限 `truncated:true` 且**截断在前 64 KiB 字节边界**，
 *     末字符可能落在多字节 UTF-8 中间 ⇒ 显示为替换符（本批不引入按码点截断）。
 *   · L-chain-1 · 审计链按 org 校验（§10-L7）：本接口只验 `loadConfig().orgId` 这一条链。
 *   · L-body-1 · body 上限在**解析后**按 UTF-8 字节量校验（express.json 全局上限 10mb 在 server.ts），
 *     超限返回 413；不改变既有全局解析行为。
 *   · L-list-1 · 列表截断在 200 条（§2.2-D11），超出 `truncated:true`；不提供分页。
 */

import { Router, type Request, type Response } from 'express';
import { join } from 'path';
import { createLogger } from '@synova/logger';
import { loadConfig } from '../config';
import {
  loadRolePacks,
  resolveApprovalsRoot,
  type PresetLoadReport,
  type RolePack,
} from '../init/preset-loader';
import { readPieceBytesOnce } from '../init/role-pack-persona';
import { computeRolePackContentHash } from '../init/role-pack-schema';
import {
  readApprovalRecord,
  type ApprovalRecord,
} from '../init/role-pack-approval';
import {
  approveRolePack,
  revokeRolePack,
  type ApprovalWriteCode,
  type RolePackApprovalScope,
  type WriteResult,
} from '../init/role-pack-approval-write';
import { AuditService } from '../services/audit-service';
import type { JwtPayload } from '../middleware/auth';

const log = createLogger('routes/role-approvals');
const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量（限额与码表；单一出处＝规格，禁散落字面量）
// ══════════════════════════════════════════════════════════════════════════════

/** roleId 形状（与 `conversations.ts` 的 `ROLE_PACK_ID_PATTERN` 同值；1..64 小写字母/数字/`.`/`-`）。 */
const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** 可执行审批动作的角色（规格 §〇.7-1）。 */
const APPROVAL_ROLES: readonly string[] = ['admin', 'manager', 'ga'];

/** 详情面单件显示上限（§2.2-D11：单件 ≤64 KiB，超出 `truncated:true`）。 */
const PIECE_DISPLAY_MAX_BYTES = 64 * 1024;

/** 列表上限（§2.2-D11）。 */
const LIST_MAX = 200;

/** body 上限（§2.2-D11：16 KiB）。 */
const BODY_MAX_BYTES = 16 * 1024;

/** 审计历史取数上限（§1.2-2：最近 50 条）。 */
const AUDIT_HISTORY_LIMIT = 50;

/** 审计目标类型（详情面按 `targetType ＋ targetId` 过滤）。 */
const AUDIT_TARGET_TYPE = 'role_pack';

/** 三个审计动作（§2.3-D）。 */
const AUDIT_APPROVED = 'role_pack.approved';
const AUDIT_REVOKED = 'role_pack.revoked';
const AUDIT_SCOPE_CHANGED = 'role_pack.scope_changed';

/** 写模块拒绝码 → HTTP（§2.3-B 码表；**唯一**映射点）。 */
const HTTP_BY_WRITE_CODE: Readonly<Record<ApprovalWriteCode, number>> = {
  E_APPROVAL_ROLE_ID_INVALID: 400,
  E_APPROVAL_FACTORY_LOCKED: 403,
  E_APPROVAL_ROLE_NOT_FOUND: 404,
  E_APPROVAL_CONTENT_CHANGED: 409,
  E_APPROVAL_SCOPE_INVALID: 422,
  E_APPROVAL_WRITE_DISABLED: 503,
  E_APPROVAL_NOT_FOUND: 404,
  E_APPROVAL_ORG_MISMATCH: 403,
  E_APPROVAL_IO: 500,
};

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型与小工具（不抛；窄收窄）
// ══════════════════════════════════════════════════════════════════════════════

/** `req.auth` 的注入形状（由 `jwtAuthMiddleware` 验签后写入；本文件只读）。 */
type AuthedRequest = Request & { auth?: JwtPayload };

/**
 * 路由参数类型（@types/express 5 的 `ParamsDictionary` 索引签名是 `string | string[]`，
 * 显式 `Request` 注解会丢掉路由字面量推断 ⇒ 这里显式钉 `:roleId` 是单值 string）。
 */
type RoleIdParams = { roleId: string };

/** 通过守卫后携带的身份（orgId 已与实例同源）。 */
interface AuthorizedCaller {
  readonly auth: JwtPayload;
  readonly orgId: string;
}

/** 审计历史行（只读投影；不 import `src/l4/**` —— 铁律 39）。 */
interface AuditHistoryRow {
  readonly id: string;
  readonly action: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly createdAt: string;
}

/** 审计快照（§2.3-D：**只放 hash/scope/approvalId**，禁六件正文）。 */
interface ApprovalAuditSnapshot {
  readonly contentHash: string;
  readonly scope: string;
  readonly approvalId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** roleId 形状守卫（与写模块同值；先判再 IO，reason 点名"形状/穿越"两件事）。 */
function isValidRoleId(roleId: string): boolean {
  return ROLE_ID_PATTERN.test(roleId);
}

/** scope 解析：缺省 `content`（保守，与读路径缺省一致）；非法 ⇒ `undefined`（⇒ 422）。 */
function parseScope(value: unknown): RolePackApprovalScope | undefined {
  if (value === undefined) return 'content';
  if (value === 'content' || value === 'content+permissions') return value;
  return undefined;
}

/** 审计快照（只取三字段；`ApprovalRecord` 的另外字段不进审计）。 */
function auditSnapshotOf(record: ApprovalRecord): ApprovalAuditSnapshot {
  return { contentHash: record.contentHash, scope: record.scope, approvalId: record.approvalId };
}

/** 审计链校验（未初始化 ⇒ `null` ＋ 显式降级标记；不伪造 `valid:true`）。 */
function verifyChainOf(orgId: string): { valid: boolean; brokenAt?: number; totalRecords: number } | null {
  const store = AuditService.getStore();
  if (store === null) {
    log.warn({ orgId, degraded: true }, '审计服务未初始化 — 链校验返回 null（不伪造 valid）');
    return null;
  }
  return store.verifyChain(orgId);
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、身份与 org 守卫（**所有路由的唯一入口**；缺则已写响应并返回 undefined）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 身份/org/角色三重守卫。
 *
 * 顺序（每条短路）：① `req.auth` 缺失 ⇒ 401（生产态中间件已先拦；本判为纵深防御）⇒
 *   ② `req.auth.orgId !== loadConfig().orgId` ⇒ 403 `E_APPROVAL_ORG_MISMATCH` ⇒
 *   ③ `req.auth.role ∉ {admin,manager,ga}` ⇒ 403 `E_APPROVAL_ROLE_FORBIDDEN`。
 *
 * @returns 通过 ⇒ `{auth, orgId}`；拒绝 ⇒ 已写响应并返回 `undefined`（调用方 `return`）。
 */
function ensureAuthorized(req: Request, res: Response, where: string): AuthorizedCaller | undefined {
  const auth = (req as AuthedRequest).auth;
  if (auth === undefined) {
    log.warn({ code: 'UNAUTHORIZED', where, degraded: true }, '审批 API 拒绝：请求无验签身份（401 fail-closed）');
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '未认证：需要 Bearer token' });
    return undefined;
  }

  const orgId = loadConfig().orgId;
  if (auth.orgId !== orgId) {
    log.warn(
      {
        code: 'E_APPROVAL_ORG_MISMATCH',
        where,
        authOrgId: auth.orgId,
        instanceOrgId: orgId,
        actorId: auth.sub,
        degraded: true,
      },
      '审批 API 拒绝：身份 org 与实例 org 不一致（记录 orgId 单源 = loadConfig().orgId，规格 §2.2-D8）',
    );
    res.status(403).json({
      ok: false,
      code: 'E_APPROVAL_ORG_MISMATCH',
      message: `身份 org（${auth.orgId}）与实例 org（${orgId}）不一致 — 跨租户审批一律拒绝`,
    });
    return undefined;
  }

  if (!APPROVAL_ROLES.includes(auth.role)) {
    log.warn(
      { code: 'E_APPROVAL_ROLE_FORBIDDEN', where, role: auth.role, actorId: auth.sub, degraded: true },
      '审批 API 拒绝：角色不在审批白名单（admin/manager/ga）',
    );
    res.status(403).json({
      ok: false,
      code: 'E_APPROVAL_ROLE_FORBIDDEN',
      message: `角色 ${auth.role} 无审批权限（只允许 admin／manager／ga）`,
    });
    return undefined;
  }

  return { auth, orgId };
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、读面投影
// ══════════════════════════════════════════════════════════════════════════════

/** 列表项（§1.2-2 字段集：roleId/status/scope/contentHash/permissionsPending/usable）。 */
function summarizePack(pack: RolePack, usableSet: ReadonlySet<string>): Record<string, unknown> {
  return {
    roleId: pack.roleId,
    status: pack.approval.status,
    scope: pack.approval.scope ?? null,
    contentHash: pack.validation.contentHash ?? null,
    permissionsPending: pack.approval.permissionsPending ?? false,
    usable: usableSet.has(pack.roleId),
    schemaValid: pack.schemaValid,
    missing: pack.missing,
    approvalCode: pack.approval.code ?? null,
  };
}

/** 审计历史：三个审批动作 × 每动作最近 50 条 → 过滤到本 roleId → 合并倒序 → 截 50。 */
function readAuditHistory(orgId: string, roleId: string): AuditHistoryRow[] {
  const rows: AuditHistoryRow[] = [];
  for (const action of [AUDIT_APPROVED, AUDIT_REVOKED, AUDIT_SCOPE_CHANGED]) {
    for (const entry of AuditService.query(orgId, { action, limit: AUDIT_HISTORY_LIMIT })) {
      if (entry.targetType !== AUDIT_TARGET_TYPE || entry.targetId !== roleId) continue;
      rows.push({
        id: entry.id,
        action: entry.action,
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        createdAt: entry.createdAt,
      });
    }
  }
  rows.sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
  return rows.slice(0, AUDIT_HISTORY_LIMIT);
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、写面：审计追加与失败翻译
// ══════════════════════════════════════════════════════════════════════════════

/** 追加一条岗位包审批审计（唯一通道 = AuditService；只写 hash/scope/approvalId）。 */
function appendAudit(
  req: Request,
  caller: AuthorizedCaller,
  roleId: string,
  action: string,
  oldValue: ApprovalAuditSnapshot | null,
  newValue: ApprovalAuditSnapshot | null,
): void {
  const userAgent = req.headers['user-agent'];
  AuditService.log({
    orgId: caller.orgId,
    actorId: caller.auth.sub,
    actorRole: caller.auth.role,
    action,
    targetType: AUDIT_TARGET_TYPE,
    targetId: roleId,
    oldValue: oldValue === null ? undefined : JSON.stringify(oldValue),
    newValue: newValue === null ? undefined : JSON.stringify(newValue),
    ipAddress: req.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
  });
}

/** 写模块拒绝 → HTTP（失败一律无写盘／无审计；IO 类 fail loud 记 error）。 */
function sendWriteFailure(
  res: Response,
  roleId: string,
  failure: Extract<WriteResult, { ok: false }>,
): void {
  const status = HTTP_BY_WRITE_CODE[failure.code];
  const meta = {
    code: failure.code,
    roleId,
    httpStatus: status,
    reason: failure.reason,
    degraded: status >= 500,
  };
  if (status >= 500) {
    log.error(meta, '岗位包审批写入失败 — IO 错误（fail loud；未写入、未审计）');
  } else {
    log.warn(meta, '岗位包审批写入被拒（未写入、未审计）');
  }
  res.status(status).json({ ok: false, code: failure.code, message: failure.reason, roleId });
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、GET /api/role-packs — 列表
// ══════════════════════════════════════════════════════════════════════════════

router.get('/api/role-packs', (req: Request, res: Response) => {
  const caller = ensureAuthorized(req, res, 'GET /api/role-packs');
  if (caller === undefined) return;

  const report: PresetLoadReport = loadRolePacks();
  const usableSet = new Set<string>(report.usable);
  const all = report.roles.map((pack) => summarizePack(pack, usableSet));
  const truncated = all.length > LIST_MAX;

  res.json({
    ok: true,
    orgId: caller.orgId,
    root: report.root,
    rolePacks: all.slice(0, LIST_MAX),
    total: all.length,
    truncated,
    usable: report.usable,
    degraded: report.degraded,
    errors: report.errors,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 七、GET /api/role-packs/:roleId — 详情（六件文本＋现场指纹＋记录＋审计历史＋链）
// ══════════════════════════════════════════════════════════════════════════════

router.get('/api/role-packs/:roleId', (req: Request<RoleIdParams>, res: Response) => {
  const caller = ensureAuthorized(req, res, 'GET /api/role-packs/:roleId');
  if (caller === undefined) return;

  const roleId = req.params.roleId;
  if (!isValidRoleId(roleId)) {
    log.warn(
      { code: 'E_APPROVAL_ROLE_ID_INVALID', roleId, degraded: true },
      '详情拒绝：roleId 形状非法（防目录穿越）',
    );
    res.status(400).json({
      ok: false,
      code: 'E_APPROVAL_ROLE_ID_INVALID',
      message: `roleId 形状非法（须 1..64 位小写字母/数字/./-，且首字符为小写字母或数字）：${JSON.stringify(roleId)}`,
      roleId,
    });
    return;
  }

  const report = loadRolePacks();
  const pack = report.roles.find((item) => item.roleId === roleId);
  if (pack === undefined) {
    log.warn({ code: 'E_APPROVAL_ROLE_NOT_FOUND', roleId, degraded: true }, '详情拒绝：岗位包不存在');
    res.status(404).json({
      ok: false,
      code: 'E_APPROVAL_ROLE_NOT_FOUND',
      message: `岗位包不存在：${roleId}`,
      roleId,
    });
    return;
  }

  const approvalsRoot = resolveApprovalsRoot(report.root);
  const roleDir = join(report.root, 'roles', roleId);

  // 六件单读一次（唯一实现 = readPieceBytesOnce；指纹与文本共用同一份快照，封 TOCTOU）
  const snapshot = readPieceBytesOnce(roleDir);
  let contentHash: string | null = null;
  let pieces: Array<{ name: string; bytes: number; truncated: boolean; text: string }> = [];
  let pieceError: { code: string; reason: string } | null = null;
  if (snapshot.ok) {
    contentHash = computeRolePackContentHash(snapshot.pieces);
    pieces = snapshot.pieces.map((piece) => {
      const truncated = piece.bytes.length > PIECE_DISPLAY_MAX_BYTES;
      const shown = truncated ? piece.bytes.subarray(0, PIECE_DISPLAY_MAX_BYTES) : piece.bytes;
      return { name: piece.name, bytes: piece.bytes.length, truncated, text: shown.toString('utf8') };
    });
  } else {
    pieceError = { code: snapshot.code, reason: snapshot.reason };
    log.warn(
      { roleId, code: snapshot.code, reason: snapshot.reason, degraded: true },
      '详情六件快照不可读 — 文本面降级（记录/审计/链照常返回）',
    );
  }

  const recordResult = readApprovalRecord(roleId, { approvalsRoot });
  const record = recordResult.ok ? recordResult.record : null;
  const recordError = recordResult.ok ? null : { code: recordResult.code, reason: recordResult.reason };

  const audit = readAuditHistory(caller.orgId, roleId);
  const chain = verifyChainOf(caller.orgId);
  const usableSet = new Set<string>(report.usable);

  res.json({
    ok: true,
    orgId: caller.orgId,
    roleId,
    status: pack.approval.status,
    scope: pack.approval.scope ?? null,
    approvalId: pack.approval.approvalId ?? null,
    permissionsPending: pack.approval.permissionsPending ?? false,
    usable: usableSet.has(roleId),
    schemaValid: pack.schemaValid,
    missing: pack.missing,
    contentHash,
    validationHash: pack.validation.contentHash ?? null,
    pieces,
    pieceError,
    record,
    recordError,
    audit,
    chain,
    degraded: report.degraded || pieceError !== null,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 八、POST /api/role-packs/:roleId/approval — 批准 / 撤销
// ══════════════════════════════════════════════════════════════════════════════

router.post('/api/role-packs/:roleId/approval', (req: Request<RoleIdParams>, res: Response) => {
  const caller = ensureAuthorized(req, res, 'POST /api/role-packs/:roleId/approval');
  if (caller === undefined) return;

  const roleId = req.params.roleId;
  if (!isValidRoleId(roleId)) {
    log.warn(
      { code: 'E_APPROVAL_ROLE_ID_INVALID', roleId, degraded: true },
      '审批写入拒绝：roleId 形状非法（防目录穿越）',
    );
    res.status(400).json({
      ok: false,
      code: 'E_APPROVAL_ROLE_ID_INVALID',
      message: `roleId 形状非法（须 1..64 位小写字母/数字/./-，且首字符为小写字母或数字）：${JSON.stringify(roleId)}`,
      roleId,
    });
    return;
  }

  if (!isPlainObject(req.body)) {
    log.warn({ code: 'E_APPROVAL_ACTION_INVALID', roleId, degraded: true }, '审批写入拒绝：body 不是对象');
    res.status(400).json({
      ok: false,
      code: 'E_APPROVAL_ACTION_INVALID',
      message: 'body 必须是 JSON 对象：{action:"approve"|"revoke", scope?, expectedContentHash?}',
      roleId,
    });
    return;
  }
  const body = req.body;

  const bodyBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (bodyBytes > BODY_MAX_BYTES) {
    log.warn(
      { code: 'E_APPROVAL_BODY_TOO_LARGE', roleId, bodyBytes, max: BODY_MAX_BYTES, degraded: true },
      '审批写入拒绝：body 超限（§2.2-D11）',
    );
    res.status(413).json({
      ok: false,
      code: 'E_APPROVAL_BODY_TOO_LARGE',
      message: `body 超限：${String(bodyBytes)} B > ${String(BODY_MAX_BYTES)} B`,
      roleId,
    });
    return;
  }

  const action = body['action'];
  if (action !== 'approve' && action !== 'revoke') {
    log.warn(
      { code: 'E_APPROVAL_ACTION_INVALID', roleId, action: JSON.stringify(action), degraded: true },
      '审批写入拒绝：action 非法（只接受 approve／revoke）',
    );
    res.status(400).json({
      ok: false,
      code: 'E_APPROVAL_ACTION_INVALID',
      message: `action 非法：${JSON.stringify(action)}（只接受 approve／revoke）`,
      roleId,
    });
    return;
  }

  const report = loadRolePacks();
  const contentRoot = report.root;
  const approvalsRoot = resolveApprovalsRoot(contentRoot);
  const actor = { id: caller.auth.sub, role: caller.auth.role };

  if (action === 'revoke') {
    const revoked = revokeRolePack({ roleId, approvalsRoot, orgId: caller.orgId, actor });
    if (!revoked.ok) {
      sendWriteFailure(res, roleId, revoked);
      return;
    }
    appendAudit(req, caller, roleId, AUDIT_REVOKED, auditSnapshotOf(revoked.record), null);
    const after = loadRolePacks();
    const pack = after.roles.find((item) => item.roleId === roleId);
    log.info(
      { roleId, approvalId: revoked.record.approvalId, actorId: actor.id, degraded: false },
      '岗位包审批已撤销（记录已删除，审计保留）— 下一轮 loadRolePacks() 即失效',
    );
    res.json({
      ok: true,
      roleId,
      result: 'revoked',
      unchanged: false,
      auditAction: AUDIT_REVOKED,
      approval: pack?.approval ?? null,
      record: revoked.record,
      chain: verifyChainOf(caller.orgId),
    });
    return;
  }

  const scope = parseScope(body['scope']);
  if (scope === undefined) {
    log.warn(
      { code: 'E_APPROVAL_SCOPE_INVALID', roleId, scope: JSON.stringify(body['scope']), degraded: true },
      '审批写入拒绝：scope 非法（只接受 content／content+permissions）',
    );
    res.status(422).json({
      ok: false,
      code: 'E_APPROVAL_SCOPE_INVALID',
      message: `scope 非法：${JSON.stringify(body['scope'])}（只接受 content／content+permissions）`,
      roleId,
    });
    return;
  }

  const expectedContentHash = typeof body['expectedContentHash'] === 'string' ? body['expectedContentHash'] : '';
  const priorResult = readApprovalRecord(roleId, { approvalsRoot });
  const prior = priorResult.ok ? priorResult.record : null;

  const approved = approveRolePack({
    roleId,
    contentRoot,
    approvalsRoot,
    expectedContentHash,
    scope,
    orgId: caller.orgId,
    actor,
  });
  if (!approved.ok) {
    sendWriteFailure(res, roleId, approved);
    return;
  }

  let auditAction: string | null = null;
  if (!approved.unchanged) {
    const scopeChanged =
      prior !== null &&
      prior.contentHash === approved.record.contentHash &&
      prior.scope !== approved.record.scope;
    auditAction = scopeChanged ? AUDIT_SCOPE_CHANGED : AUDIT_APPROVED;
    appendAudit(
      req,
      caller,
      roleId,
      auditAction,
      prior === null ? null : auditSnapshotOf(prior),
      auditSnapshotOf(approved.record),
    );
  }

  const after = loadRolePacks();
  const pack = after.roles.find((item) => item.roleId === roleId);
  log.info(
    {
      roleId,
      approvalId: approved.record.approvalId,
      contentHash: approved.record.contentHash,
      scope: approved.record.scope,
      unchanged: approved.unchanged,
      auditAction,
      degraded: false,
    },
    approved.unchanged
      ? '重复批准（同 hash 同 scope）— 记录未重写、审计未新增（D9）'
      : '岗位包审批已落盘 — 下一轮 loadRolePacks() 即生效（无需重启）',
  );
  res.json({
    ok: true,
    roleId,
    result: approved.unchanged ? 'unchanged' : auditAction === AUDIT_SCOPE_CHANGED ? 'scope_changed' : 'approved',
    unchanged: approved.unchanged,
    auditAction,
    approval: pack?.approval ?? null,
    record: approved.record,
    chain: verifyChainOf(caller.orgId),
  });
});

/**
 * 具名导出（R1.2：`check-quality-delta.py` 的 `exported_names()` 只认具名 export）。
 * 生产调用点 = `src/server.ts`（JWT 之后注册；页面壳 `role-packs-page.ts` 另在先于 JWT 处挂载）。
 */
export const roleApprovalsRoutes = router;

export default roleApprovalsRoutes;
