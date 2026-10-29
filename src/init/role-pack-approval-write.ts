/**
 * src/init/role-pack-approval-write.ts — 岗位包审批记录**写入器**（#1075 P3 / T1）
 *
 * 架构位置: **引擎侧**（`src/init/`）写**运行时状态**（`<approvalsRoot>/<roleId>.json`）。
 *   方向单向：本文件 → `role-pack-persona`（六件单读快照）／`role-pack-schema`（内容指纹）／
 *   `role-pack-approval`（出厂锚 ＋ 记录形状读取 ＋ `ApprovalRecord` 类型）。
 *   **不** import `src/routes/**`、`src/l4/**`、`src/services/audit-service`：
 *   审计 append 属路由层（`AuditService.log`，铁律 39 ＋ 规格 §2.2-D6）；写入器不触审计。
 *
 * 设计哲学（一句）: **先校验后落盘、单读一次定指纹、写全或写零** ——
 *   任一前置不符即 typed code 返回（不写盘、不 append 审计、不留 .tmp 残留）；
 *   只有全部通过才 tmp → rename 原子落记录。
 *
 * 契约（铁律 47）:
 *   @input  — `approveRolePack({roleId, contentRoot, approvalsRoot, expectedContentHash, scope, orgId, actor:{id,role}, now?})`
 *             `revokeRolePack({roleId, approvalsRoot, orgId, actor, now?})`
 *             · `contentRoot` = `loadRolePacks().root`（`extensions/presets`）；`roleDir = join(contentRoot,'roles',roleId)`。
 *             · `approvalsRoot` = 调用方给（可经 `preset-loader.resolveApprovalsRoot(contentRoot)` 派生）；**禁**写死仓内 `.synova`。
 *             · `now?` = 注入时钟（approve 的 `approvedAt`；revoke 只用于日志，撤销不落新记录）。
 *   @output — `WriteResult` 判别联合：`{ok:true, record, unchanged}` 或 `{ok:false, code, reason}`（§2.3-A 九码）。
 *             🔴 `unchanged:true` ＝ **同 hash 同 scope 的重复批准**：记录未重写，**调用方不得新增审计**（D9）。
 *   @degraded — **不抛**（路由层同步调用，抛会把 500 变成未捕获异常）：
 *             文件系统失败折 `E_APPROVAL_IO` ＋ `log.error({code, degraded:true})`（铁律 11/24/31：不静默、不打断请求）；
 *             输入不合法折对应 typed 码（无 IO、无写盘、无噪音日志）。
 *   @authority — **生产唯一调用方 = `src/routes/role-approvals.ts`**（Bearer ＋ `admin|manager|ga` ＋
 *             `req.auth.orgId === loadConfig().orgId` 守卫之后调用，规格 §2.2-D8）；
 *             测试 = `tests/init/role-pack-approval-write.test.ts`。**其它模块不得复制本段**（写入面唯一）。
 *   @error  — **typed error 带 code**（铁律 32）：九码见下表，**只经 `WriteResult.code` 传出**，本文件不 throw
 *             （`ok:false` 是唯一失败形态；`E_APPROVAL_IO` 必须伴随 `log.error({code, degraded:true})`）。
 *   @not-here — 不 append 审计（路由层经 `AuditService.log`，D6）／不判审批（读路径唯一 = `judgeRolePackApproval`，
 *             本文件不复制判定）／不删审计／不改六件正文／不做签名与抗伪造（P4）／不做 HTTP 状态码映射
 *             （路由层按码表映射 400/403/404/409/422/503/500）。
 *
 * typed error（铁律 32；`code` 只取 §2.3-A **九码**，禁自造）:
 *   | code | HTTP | 触发 |
 *   |---|---|---|
 *   | `E_APPROVAL_WRITE_DISABLED` | 503 | `SYNOVA_APPROVAL_WRITE=off` 回滚开关（读/卡/页不受影响） |
 *   | `E_APPROVAL_ROLE_ID_INVALID` | 400 | roleId 空／>64／含 `/`、`\`／为 `.`、`..`／不匹配 `ROLE_PACK_ID_PATTERN` |
 *   | `E_APPROVAL_SCOPE_INVALID` | 422 | scope ∉ `content`／`content+permissions` |
 *   | `E_APPROVAL_FACTORY_LOCKED` | 403 | roleId ∈ `Object.keys(FACTORY_APPROVALS)`（出厂锚优先；写/撤一律锁） |
 *   | `E_APPROVAL_ROLE_NOT_FOUND` | 404 | `<contentRoot>/roles/<roleId>` 不存在或不是目录 |
 *   | `E_APPROVAL_CONTENT_CHANGED` | 409 | 六件现场指纹 ≠ `expectedContentHash`（或期望值形状非法 ⇒ 必然不符） |
 *   | `E_APPROVAL_ORG_MISMATCH` | 403 | 记录 `orgId` ≠ 入参（含入参 `orgId` 为空） |
 *   | `E_APPROVAL_NOT_FOUND` | 404 | 撤销无记录（**不返回 200 幂等**，§10-L5） |
 *   | `E_APPROVAL_IO` | 500 | 文件系统失败／既有记录不可用／写不出可读记录（actor 空、记录 > 8 KiB、`now` 非法） |
 *
 * 判定顺序（逐条短路；改此行须同批改 `tests/init/role-pack-approval-write.test.ts`）:
 *   approve：回滚开关 → roleId 形状 → scope → expectedContentHash 形状（必然不符 ⇒ 409）→ 出厂锁 → orgId 非空 →
 *            角色目录 → 六件**单读一次** → 内容指纹比对 → 既有记录（同 hash 同 scope ⇒ unchanged；跨 org ⇒ 403）→
 *            构造记录（自绑定 approvalId）→ 8 KiB 限额 → mkdir recursive → tmp(0600) → rename。
 *   revoke： 回滚开关 → roleId 形状 → 出厂锁 → orgId 非空 → 读记录（无 ⇒ 404；坏 ⇒ 500）→ org 比对 → unlink。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `approveRolePack()` | 批准：前置校验 → 指纹比对 → 原子写记录 |
 *   | `revokeRolePack()` | 撤销：读记录 → org 校验 → 删记录（**不删审计**） |
 *   | `ApprovalWriteCode`／`WriteResult`／`ApprovalActor`／`RolePackApprovalScope` | §2.3-A 契约类型（路由层消费） |
 *   | `ApproveRolePackInput`／`RevokeRolePackInput` | 入参类型（字段级契约） |
 *   内部：`computeSelfBoundApprovalId()`（approvalId **独立复刻**；上游 `computeSelfBoundApprovalId` 未导出 ⇒ 禁 import）／
 *         `isWriteDisabled()`／`isFactoryRole()`／`roleIdShapeError()`／`probeRoleDir()`／`writeRecordAtomic()`／
 *         `ioFailure()`（IO 拒绝唯一构造点，保证 log.error ＋ degraded）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L1 · 无签名/抗伪造**：记录可被重写并重算（读路径 L1 同）；审计链只证**事件序**、不证文件（D6）。本文件不落审计。
 *   · **L2 · 无四眼**：同一人能自建自批；`actor` 由路由层从 JWT 取，本文件不判"二次批准须换人"（非目标）。
 *   · **L3 · `E_APPROVAL_IO` 兼收"写不出合法记录"**：码表无独立"记录超限/actor 非法"码 ⇒ 记录 > 8 KiB、
 *         `actor.id`／`actor.role` 为空、`now` 为 Invalid Date 一律折 `E_APPROVAL_IO`（500，
 *         路由层**不得**当 4xx 处理）。理由：这些状态都写不出**读路径可读**的记录。
 *   · **L4 · 崩在 rename 前留 `.json.tmp`**：tmp 用固定名（`<roleId>.json.tmp`），下次写入覆盖；
 *         读路径只读 `<roleId>.json` ⇒ 残留不影响判定，但占目录项需运维清理（本文件尽力清理，清理失败只 log.warn）。
 *   · **L5 · `unchanged` 不刷新 `approvedAt`/批准人**：同 hash 同 scope 重复批准**不改**记录（D9）；
 *         要换批准人/时间须先 revoke 再 approve。
 *   · **L6 · 模式仅 POSIX 有意义**：新建 `approvalsRoot` 用 `0o700`、记录 `0o600`；Windows 无 mode 语义
 *         （`chmodSync` 跳过，测试 `skipIf(win32)`）。
 *   · **L7 · 跨 org**：已存在记录 `orgId` 不符 ⇒ 拒绝覆盖（防串租户）；但**形状损坏的记录**（读不出的）会被批准覆盖
 *         —— 损坏记录无可信 org 可读，且批准是唯一修复面（覆盖前 `log.warn` 留痕，不静默）。
 *   · **L8 · 即时生效依赖 loader 缓存指纹**（`mtimeMs:size`，D10）：若覆盖后 mtime 与 size 双不变（毫秒/尺寸碰撞），
 *         请求路径缓存可能仍读旧判定 ⇒ 属**概率型非硬保证**；`loadRolePacks()` 无缓存（每次重读）。
 *   · **L9 · 本文件不创建/修复角色包**：`contentRoot` 只读；六件缺件/不可读 ⇒ `E_APPROVAL_IO`（不猜、不补）。
 *   · **L-TOCTOU**：六件单读（`readPieceBytesOnce`）与写记录之间内容可能被改 ⇒ 记录绑定的是**快照指纹**；
 *         内容再变 ⇒ 下一轮读路径 `E_APPROVAL_CONTENT_CHANGED`（方向 fail-closed，信号正确）。
 */
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@synova/logger';
import { FACTORY_APPROVALS, readApprovalRecord, type ApprovalRecord } from './role-pack-approval';
import { readPieceBytesOnce } from './role-pack-persona';
import { computeRolePackContentHash } from './role-pack-schema';

const log = createLogger('init/role-pack-approval-write');

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约常量（限额与码表 §2.3-A/§2.3-D11；禁自造）
// ══════════════════════════════════════════════════════════════════════════════

/** 审批记录单件**硬上限**（字节）。超限 ⇒ `E_APPROVAL_IO`（读路径侧同值 8192 判 `INVALID`，两侧对称）。 */
const APPROVAL_RECORD_MAX_BYTES = 8192;

/** 记录 schemaVersion（本批只写 1；读路径只认 1）。 */
const APPROVAL_RECORD_SCHEMA_VERSION = 1;

/** 回滚开关（D10）：`SYNOVA_APPROVAL_WRITE=off` ⇒ 写/撤一律 `E_APPROVAL_WRITE_DISABLED`。 */
const WRITE_SWITCH_ENV = 'SYNOVA_APPROVAL_WRITE';
const WRITE_SWITCH_OFF = 'off';

/**
 * roleId 形状（与 `src/routes/conversations.ts:280` 的 `ROLE_PACK_ID_PATTERN` **同语义**；
 * 该常量未导出 ⇒ 独立复刻，测例钉死边界 1/64/65/大写/分隔符）。
 */
const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** roleId 长度上限（§2.3-D11；模式已含，仍显式点名以便 reason 可读）。 */
const ROLE_ID_MAX_LENGTH = 64;

/** 内容指纹形状（小写 64 hex；＝`computeRolePackContentHash()` 与独立脚本产出的形状）。 */
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** 角色目录所在（相对内容根）。 */
const ROLES_SUBDIR = 'roles';

/** 审批记录文件的临时后缀（`<roleId>.json.tmp`；固定名 ⇒ 崩溃残留可被下次写入覆盖）。 */
const TMP_SUFFIX = '.tmp';

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型（typed code；禁裸字符串 —— 铁律 32）
// ══════════════════════════════════════════════════════════════════════════════

/** 审批粒度（§2.3-C；与读路径 `RolePackApprovalScope` 同值，独立声明以避开类型循环引用面）。 */
export type RolePackApprovalScope = 'content' | 'content+permissions';

/** 写入器拒绝码（**只取 §2.3-A 九码**；路由层据码映射 HTTP，禁在路由层另造码）。 */
export type ApprovalWriteCode =
  | 'E_APPROVAL_ROLE_ID_INVALID'
  | 'E_APPROVAL_FACTORY_LOCKED'
  | 'E_APPROVAL_ROLE_NOT_FOUND'
  | 'E_APPROVAL_CONTENT_CHANGED'
  | 'E_APPROVAL_SCOPE_INVALID'
  | 'E_APPROVAL_WRITE_DISABLED'
  | 'E_APPROVAL_NOT_FOUND'
  | 'E_APPROVAL_ORG_MISMATCH'
  | 'E_APPROVAL_IO';

/** 审批人身份（由路由层从验签 JWT 取：`req.auth.userId`／`req.auth.role`；本文件不校验角色白名单）。 */
export type ApprovalActor = {
  /** 审批人 id（写入 `record.approverId`；空 ⇒ `E_APPROVAL_IO` —— 空值写不出读路径可读的记录） */
  readonly id: string;
  /** 审批人角色（写入 `record.approverRole`；同上） */
  readonly role: string;
};

/** `approveRolePack()` 入参（§2.3-A 字段级契约）。 */
export type ApproveRolePackInput = {
  /** 角色 id（＝角色目录名；形状见 `ROLE_ID_PATTERN`） */
  readonly roleId: string;
  /** 内容根（`loadRolePacks().root`）—— 只读；`roleDir = join(contentRoot, 'roles', roleId)` */
  readonly contentRoot: string;
  /** 审批记录根（绝对路径；生产 = `resolveApprovalsRoot(contentRoot)`，测试 = 临时根） */
  readonly approvalsRoot: string;
  /** 期望内容指纹（必填，§2.2-D2；与六件现场指纹不等 ⇒ 409，无写入、无审计） */
  readonly expectedContentHash: string;
  /** 审批粒度（§2.3-C） */
  readonly scope: RolePackApprovalScope;
  /** 记录所属 org（单源 = `loadConfig().orgId`，§2.2-D8；与已存在记录不符 ⇒ 403） */
  readonly orgId: string;
  /** 审批人（路由层从 JWT 取） */
  readonly actor: ApprovalActor;
  /** 注入时钟（缺省 `new Date()`；只影响 `approvedAt`，Invalid Date ⇒ `E_APPROVAL_IO`） */
  readonly now?: Date;
};

/** `revokeRolePack()` 入参（§2.3-A；`now?` 只用于日志时间 —— 撤销**不落新记录**）。 */
export type RevokeRolePackInput = {
  /** 角色 id（同上） */
  readonly roleId: string;
  /** 审批记录根（同 approve） */
  readonly approvalsRoot: string;
  /** 记录所属 org（与记录不符 ⇒ 403，不删） */
  readonly orgId: string;
  /** 撤销人（路由层从 JWT 取；本文件只用于日志留痕） */
  readonly actor: ApprovalActor;
  /** 注入时钟（缺省 `new Date()`；**不参与持久化**，撤销不落记录） */
  readonly now?: Date;
};

/**
 * 写入结果（§2.3-A 判别联合；**不抛**）:
 *   · `ok:true` ⇒ `record` 是**已落盘**（approve）或**已删除**（revoke）的记录；
 *     `unchanged:true` 仅可能来自 approve ＝ 重复批准（**不新增审计**，D9）。
 *   · `ok:false` ⇒ `code` 只取九码；`reason` 点名到字段（路由层直接进 4xx/5xx body 的诊断面，禁含六件正文）。
 */
export type WriteResult =
  | { readonly ok: true; readonly record: ApprovalRecord; readonly unchanged: boolean }
  | { readonly ok: false; readonly code: ApprovalWriteCode; readonly reason: string };

// ══════════════════════════════════════════════════════════════════════════════
// 三、小工具（纯函数；不抛、不 IO）
// ══════════════════════════════════════════════════════════════════════════════

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 取 Node 错误的 `code`（`ENOENT`／`EACCES`／`ENOTDIR`／…）；无则 `undefined`（不猜）。 */
function nodeErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 回滚开关（D10）：`off`（大小写不敏感＋trim）⇒ 写/撤关闭；未设／其它值 ⇒ 开启（读路径从不看本开关）。 */
function isWriteDisabled(): boolean {
  const raw = process.env[WRITE_SWITCH_ENV];
  return raw !== undefined && raw.trim().toLowerCase() === WRITE_SWITCH_OFF;
}

/** 出厂 roleId（D3）：键集来自 `FACTORY_APPROVALS`（单一出处，禁复制名单）。 */
function isFactoryRole(roleId: string): boolean {
  return Object.keys(FACTORY_APPROVALS).includes(roleId);
}

/** 审批记录文件绝对路径（`<approvalsRoot>/<roleId>.json`；roleId 形状已先校验，禁穿越）。 */
function recordPathOf(approvalsRoot: string, roleId: string): string {
  return join(approvalsRoot, `${roleId}.json`);
}

/**
 * roleId 形状校验（防目录穿越 ＋ §2.3-D11 限额）。返回 `undefined` ＝ 合法。
 * 🔴 顺序价值：`ROLE_ID_PATTERN` 已排除 `.`／`..`／分隔符；仍显式点名 —— reason 要能直接告诉用户错在哪。
 */
function roleIdShapeError(roleId: unknown): string | undefined {
  if (!isNonEmptyString(roleId)) {
    return `roleId 非法（空／非字符串）：${JSON.stringify(roleId)}`;
  }
  if (roleId === '.' || roleId === '..' || roleId.includes('/') || roleId.includes('\\')) {
    return `roleId 含路径分隔符或为 .／..（防逃出审批根）：${JSON.stringify(roleId)}`;
  }
  if (roleId.length > ROLE_ID_MAX_LENGTH) {
    return `roleId 超长（${String(roleId.length)} > ${String(ROLE_ID_MAX_LENGTH)}）：${JSON.stringify(roleId)}`;
  }
  if (!ROLE_ID_PATTERN.test(roleId)) {
    return (
      'roleId 形状非法（须 1..64 位小写字母/数字/`.`/`-`，且首字符为小写字母或数字）：' +
      JSON.stringify(roleId)
    );
  }
  return undefined;
}

/**
 * 自绑定 approvalId（§2.3-C）**独立复刻**：
 * `'apv1:' + sha256hex(orgId|roleId|contentHash|scope|approvedAt|approverId|approverRole)[0:16]`。
 *
 * 🔴 上游 `computeSelfBoundApprovalId()`（`role-pack-approval.ts`）**未导出**，规格 §〇.4-5 明令"独立复刻、禁 import"；
 *   跨实现一致性由测试 `J2 approvalId 自绑定独立复算` 钉死（任一字段顺序/分隔符漂移 ⇒ 读路径复算不符 ⇒ 必红）。
 */
function computeSelfBoundApprovalId(parts: {
  readonly orgId: string;
  readonly roleId: string;
  readonly contentHash: string;
  readonly scope: RolePackApprovalScope;
  readonly approvedAt: string;
  readonly approverId: string;
  readonly approverRole: string;
}): string {
  const material = [
    parts.orgId,
    parts.roleId,
    parts.contentHash,
    parts.scope,
    parts.approvedAt,
    parts.approverId,
    parts.approverRole,
  ].join('|');
  const digest = createHash('sha256').update(material, 'utf8').digest('hex');
  return `apv1:${digest.slice(0, 16)}`;
}

/** `now` → ISO 字符串；Invalid Date ⇒ `undefined`（**不抛** —— `toISOString()` 会 throw RangeError）。 */
function resolveApprovedAt(now: Date | undefined): string | undefined {
  const value = now === undefined ? new Date() : now;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString();
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、拒绝构造点（**唯一**：输入拒绝静默、IO 拒绝 fail loud —— 铁律 11/24/31）
// ══════════════════════════════════════════════════════════════════════════════

/** 输入拒绝（无 IO、无写盘 —— 不记日志，避免把用户输入错误刷成 noise；路由层按码映射 4xx）。 */
function reject(code: ApprovalWriteCode, reason: string): WriteResult {
  return { ok: false, code, reason };
}

/**
 * IO／完整性拒绝（**fail loud**）：一律 `log.error({ code, degraded:true })`。
 * 覆盖：文件系统失败、既有记录不可用、写不出可读记录（actor 空／记录超限／now 非法）。
 */
function ioFailure(code: ApprovalWriteCode, reason: string, meta: Record<string, unknown> = {}): WriteResult {
  log.error(
    { ...meta, code, degraded: true },
    `审批写入失败 — ${code}（fail loud：不静默、不吞 IO；无写盘或写盘已回滚）`,
  );
  return { ok: false, code, reason };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、IO 壳：角色目录探针 ＋ 原子写（同步；不抛，折 typed 结果）
// ══════════════════════════════════════════════════════════════════════════════

/** 角色目录探针结果（`E_APPROVAL_ROLE_NOT_FOUND` = 客户端 404；`E_APPROVAL_IO` = 环境/完整性 500）。 */
type RoleDirProbe =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'E_APPROVAL_ROLE_NOT_FOUND' | 'E_APPROVAL_IO'; readonly reason: string };

/**
 * 角色目录探针（`lstat`，不跟随符号链接）：
 *   · `ENOENT`／`ENOTDIR` ⇒ 岗位包不存在（缺口 404）；
 *   · 存在但非目录 ⇒ 也按不存在（一个文件不是岗位包）；
 *   · 其它失败（`EACCES`…）⇒ `E_APPROVAL_IO`（环境问题，不得伪装成 404）。
 */
function probeRoleDir(roleDir: string): RoleDirProbe {
  try {
    const stats = lstatSync(roleDir);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        code: 'E_APPROVAL_ROLE_NOT_FOUND',
        reason: `岗位包路径不是目录（${roleDir}）：非岗位包`,
      };
    }
    return { ok: true };
  } catch (err: unknown) {
    const code = nodeErrorCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, code: 'E_APPROVAL_ROLE_NOT_FOUND', reason: `岗位包不存在：${roleDir}` };
    }
    return {
      ok: false,
      code: 'E_APPROVAL_IO',
      reason: `角色目录不可 stat（${roleDir}）：${code ?? errorMessage(err)}`,
    };
  }
}

/** 尽力清理半写 tmp（失败不掩盖原错误，只 log.warn —— 不静默）。 */
function cleanupTmp(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
  } catch (err: unknown) {
    if (nodeErrorCode(err) === 'ENOENT') return; // tmp 可能尚未创建：正常
    log.warn(
      { path: tmpPath, code: nodeErrorCode(err), err: errorMessage(err), degraded: true },
      '半写 tmp 清理失败 — 残留不影响判定（读路径只读 <roleId>.json），需运维视角可见',
    );
  }
}

/**
 * 原子写：`mkdir -p approvalsRoot(0o700)` → 写 `<roleId>.json.tmp`(0o600) → `rename` → `<roleId>.json`。
 * 返回 `undefined` ＝ 成功；否则返回 typed 失败（本函数**不抛**）。
 * 🔴 tmp 固定名 ⇒ 崩溃残留在下次写入时被覆盖；rename 是同一目录内的原子替换（POSIX）。
 * 🔴 必须 `chmodSync` 补一次：`writeFileSync` 的 `mode` **只在创建时**生效，覆盖旧 tmp 会保留旧 mode。
 */
function writeRecordAtomic(approvalsRoot: string, roleId: string, json: string): WriteResult | undefined {
  const recordPath = recordPathOf(approvalsRoot, roleId);
  const tmpPath = `${recordPath}${TMP_SUFFIX}`;
  try {
    mkdirSync(approvalsRoot, { recursive: true, mode: 0o700 });
  } catch (err: unknown) {
    return ioFailure(
      'E_APPROVAL_IO',
      `审批根不可创建（${approvalsRoot}）：${nodeErrorCode(err) ?? errorMessage(err)}`,
      { roleId, path: approvalsRoot },
    );
  }
  try {
    writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(tmpPath, 0o600);
  } catch (err: unknown) {
    cleanupTmp(tmpPath);
    return ioFailure(
      'E_APPROVAL_IO',
      `审批记录写入失败（${tmpPath}）：${nodeErrorCode(err) ?? errorMessage(err)}`,
      { roleId, path: tmpPath },
    );
  }
  try {
    renameSync(tmpPath, recordPath);
  } catch (err: unknown) {
    cleanupTmp(tmpPath);
    return ioFailure(
      'E_APPROVAL_IO',
      `审批记录原子替换失败（${tmpPath} → ${recordPath}）：${nodeErrorCode(err) ?? errorMessage(err)}`,
      { roleId, path: recordPath },
    );
  }
  return undefined;
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、批准（§2.3-A approveRolePack）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 批准一个岗位包（写审批记录；**不 append 审计** —— 路由层据 `unchanged` 决定是否 `AuditService.log`）。
 *
 * 判定顺序（逐条短路；任一不符 ⇒ **无写盘**）:
 *   ① 回滚开关 ② roleId 形状 ③ scope ④ expectedContentHash 形状 ⑤ 出厂锁 ⑥ orgId/actor/now 非空
 *   ⑦ 角色目录 ⑧ 六件单读一次 ⑨ 现场指纹 vs 期望 ⑩ 既有记录（unchanged／跨 org／损坏修复）
 *   ⑪ 记录构造（自绑定 approvalId）＋ 8 KiB 限额 ⑫ 原子写。
 *
 * @returns `WriteResult`（**不抛**）；`ok:true` ⇒ 记录已落盘（或 `unchanged:true` ＝ 未重写）
 */
export function approveRolePack(input: ApproveRolePackInput): WriteResult {
  // ① 回滚开关（D10）：写/撤一律 503；读/卡/页不受影响（本文件不被读路径调用）
  if (isWriteDisabled()) {
    return reject(
      'E_APPROVAL_WRITE_DISABLED',
      `审批写入已关闭（${WRITE_SWITCH_ENV}=off）— 读/卡/页不受影响；恢复须去掉该 env`,
    );
  }

  // ② roleId 形状（防目录穿越 ＋ 长度）
  const roleIdError = roleIdShapeError(input.roleId);
  if (roleIdError !== undefined) return reject('E_APPROVAL_ROLE_ID_INVALID', roleIdError);
  const roleId = input.roleId;

  // ③ scope（§2.3-B：422）
  if (input.scope !== 'content' && input.scope !== 'content+permissions') {
    return reject(
      'E_APPROVAL_SCOPE_INVALID',
      `scope 非法：${JSON.stringify(input.scope)}（只接受 content／content+permissions）`,
    );
  }
  const scope: RolePackApprovalScope = input.scope;

  // ④ 期望指纹形状（D2）：形状非法 ⇒ 必然不符 ⇒ 409（不做 IO，省一次读盘）
  if (typeof input.expectedContentHash !== 'string' || !CONTENT_HASH_PATTERN.test(input.expectedContentHash)) {
    return reject(
      'E_APPROVAL_CONTENT_CHANGED',
      `expectedContentHash 形状非法（须 64 位小写 hex）：${JSON.stringify(input.expectedContentHash)} — 无写入`,
    );
  }
  const expectedContentHash = input.expectedContentHash;

  // ⑤ 出厂锁（D3）：锚优先 —— 记录写得再对也不覆盖出厂判定（读路径第①步只信代码锚）
  if (isFactoryRole(roleId)) {
    return reject(
      'E_APPROVAL_FACTORY_LOCKED',
      `出厂岗位包不可批（roleId=${roleId}）：出厂三包只信代码锚 FACTORY_APPROVALS —— 写/撤一律拒绝`,
    );
  }

  // ⑥ orgId 与 actor（空值 ⇒ 写不出读路径可读的记录：读路径要求非空字符串）
  if (!isNonEmptyString(input.orgId)) {
    return reject(
      'E_APPROVAL_ORG_MISMATCH',
      `orgId 为空（记录 orgId 必须与 loadConfig().orgId 同源）—— 拒绝写入`,
    );
  }
  const orgId = input.orgId;
  if (!isNonEmptyString(input.actor.id) || !isNonEmptyString(input.actor.role)) {
    return ioFailure(
      'E_APPROVAL_IO',
      `调用方传入非法 actor（id/role 须非空）：${JSON.stringify(input.actor)} — 无写入`,
      { roleId },
    );
  }
  const approvedAt = resolveApprovedAt(input.now);
  if (approvedAt === undefined) {
    return ioFailure('E_APPROVAL_IO', 'now 非法（Invalid Date），无法产出 approvedAt — 无写入', { roleId });
  }

  // ⑦ 角色目录（缺口 404；其它失败 500）
  const roleDir = join(input.contentRoot, ROLES_SUBDIR, roleId);
  const dirProbe = probeRoleDir(roleDir);
  if (!dirProbe.ok) {
    return dirProbe.code === 'E_APPROVAL_ROLE_NOT_FOUND'
      ? reject(dirProbe.code, dirProbe.reason)
      : ioFailure(dirProbe.code, dirProbe.reason, { roleId, path: roleDir });
  }

  // ⑧ 六件单读一次（规格 §〇.3-3：唯一实现 = readPieceBytesOnce，禁二读/禁复制）
  const snapshot = readPieceBytesOnce(roleDir);
  if (!snapshot.ok) {
    return ioFailure(
      'E_APPROVAL_IO',
      `六件快照不可读（${snapshot.code}）：${snapshot.reason} — 无写入`,
      { roleId, path: roleDir },
    );
  }

  // ⑨ 内容指纹（纯核；raw bytes，无 canonical 化）
  const contentHash = computeRolePackContentHash(snapshot.pieces);
  if (contentHash !== expectedContentHash) {
    return reject(
      'E_APPROVAL_CONTENT_CHANGED',
      `内容指纹不符：现场 ${contentHash} ≠ 期望 ${expectedContentHash}（可能包已被修改）— 无写入、无审计`,
    );
  }

  // ⑩ 既有记录：跨 org 拒绝覆盖；同 hash 同 scope ⇒ unchanged（D9，不重写、不新增审计）；损坏 ⇒ 覆盖修复（L7）
  const existing = readApprovalRecord(roleId, { approvalsRoot: input.approvalsRoot });
  if (existing.ok) {
    if (existing.record.orgId !== orgId) {
      return reject(
        'E_APPROVAL_ORG_MISMATCH',
        `既有记录属于其它 org（记录 ${existing.record.orgId} ≠ 入参 ${orgId}）— 拒绝跨租户覆盖`,
      );
    }
    const selfBound = computeSelfBoundApprovalId(existing.record);
    if (
      existing.record.contentHash === contentHash &&
      existing.record.scope === scope &&
      existing.record.approvalId === selfBound
    ) {
      log.info(
        {
          roleId,
          approvalId: existing.record.approvalId,
          contentHash,
          scope,
          unchanged: true,
        },
        '重复批准（同 hash 同 scope）— 不重写记录、调用方不得新增审计（D9）',
      );
      return { ok: true, record: existing.record, unchanged: true };
    }
  } else if (existing.code !== 'ROLE_PACK_APPROVAL_PENDING') {
    // 形状损坏的记录读不出可信 org ⇒ 批准是唯一修复面；必须留痕（不静默）
    log.warn(
      { roleId, code: existing.code, reason: existing.reason, degraded: true },
      '既有审批记录不可用 — 本次批准将覆盖它（修复面；原记录问题见 reason）',
    );
  }

  // ⑪ 记录构造 ＋ 自绑定（approvalId 独立复刻）＋ 8 KiB 限额
  const record: ApprovalRecord = {
    schemaVersion: APPROVAL_RECORD_SCHEMA_VERSION,
    roleId,
    orgId,
    approvalId: computeSelfBoundApprovalId({
      orgId,
      roleId,
      contentHash,
      scope,
      approvedAt,
      approverId: input.actor.id,
      approverRole: input.actor.role,
    }),
    contentHash,
    approverId: input.actor.id,
    approverRole: input.actor.role,
    approvedAt,
    scope,
  };
  const json = JSON.stringify(record);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > APPROVAL_RECORD_MAX_BYTES) {
    return ioFailure(
      'E_APPROVAL_IO',
      `记录超长（${String(bytes)} B > ${String(APPROVAL_RECORD_MAX_BYTES)} B）— 无写入（读路径会判 INVALID）`,
      { roleId, bytes },
    );
  }

  // ⑫ 原子写（mkdir recursive → tmp 0600 → rename）
  const writeFailure = writeRecordAtomic(input.approvalsRoot, roleId, json);
  if (writeFailure !== undefined) return writeFailure;

  log.info(
    {
      roleId,
      approvalId: record.approvalId,
      contentHash,
      scope,
      approverId: record.approverId,
      approverRole: record.approverRole,
      bytes,
    },
    '岗位包审批记录已落盘（原子写）— 下一轮 loadRolePacks() 即生效（无需重启）',
  );
  return { ok: true, record, unchanged: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、撤销（§2.3-A revokeRolePack；删记录、**不删审计**）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 撤销一个岗位包的批准（删除 `<approvalsRoot>/<roleId>.json`）。
 *
 * 判定顺序：① 回滚开关 ② roleId 形状 ③ 出厂锁 ④ orgId 非空 ⑤ 读记录（无 ⇒ 404；坏 ⇒ 500）
 *            ⑥ 记录 org 比对（不符 ⇒ 403，不删）⑦ unlink。
 *
 * 🔴 **不删审计**：审计链由路由层 append（`role_pack.revoked`），本文件只删记录 —— 事件序必须留在链上（D6）。
 * 🔴 **不返回 200 幂等**：再撤 ⇒ `E_APPROVAL_NOT_FOUND`（§10-L5）。
 *
 * @returns `WriteResult`（**不抛**）；`ok:true` ⇒ `record` 是**被删除**的记录（路由层用它记 `oldValue`）
 */
export function revokeRolePack(input: RevokeRolePackInput): WriteResult {
  // ① 回滚开关（D10）
  if (isWriteDisabled()) {
    return reject(
      'E_APPROVAL_WRITE_DISABLED',
      `审批写入已关闭（${WRITE_SWITCH_ENV}=off）— 读/卡/页不受影响；恢复须去掉该 env`,
    );
  }

  // ② roleId 形状
  const roleIdError = roleIdShapeError(input.roleId);
  if (roleIdError !== undefined) return reject('E_APPROVAL_ROLE_ID_INVALID', roleIdError);
  const roleId = input.roleId;

  // ③ 出厂锁（§2.2-D3：写/撤一律）
  if (isFactoryRole(roleId)) {
    return reject(
      'E_APPROVAL_FACTORY_LOCKED',
      `出厂岗位包不可撤（roleId=${roleId}）：出厂三包只信代码锚 FACTORY_APPROVALS —— 写/撤一律拒绝`,
    );
  }

  // ④ orgId 非空（空值无法与记录比对 ⇒ 拒绝；码表无独立 org-invalid 码，归 ORG_MISMATCH）
  if (!isNonEmptyString(input.orgId)) {
    return reject('E_APPROVAL_ORG_MISMATCH', 'orgId 为空（须与 loadRolePacks 读路径同源）— 拒绝撤销');
  }
  const orgId = input.orgId;

  // ⑤ 读记录（无记录 ⇒ 404；形状坏 ⇒ 500 —— 不猜 org、不盲删）
  const existing = readApprovalRecord(roleId, { approvalsRoot: input.approvalsRoot });
  if (!existing.ok) {
    if (existing.code === 'ROLE_PACK_APPROVAL_PENDING') {
      log.info(
        { roleId, approvalsRoot: input.approvalsRoot, code: 'E_APPROVAL_NOT_FOUND' },
        '撤销无记录 — 404（不返回 200 幂等，§10-L5）',
      );
      return reject('E_APPROVAL_NOT_FOUND', `无审批记录可撤销：${roleId}（${existing.reason}）`);
    }
    return ioFailure(
      'E_APPROVAL_IO',
      `既有记录不可用（${existing.code}）：${existing.reason} — 拒绝撤销（不盲删、不猜 org）`,
      { roleId },
    );
  }

  // ⑥ 跨 org（不删）
  if (existing.record.orgId !== orgId) {
    return reject(
      'E_APPROVAL_ORG_MISMATCH',
      `既有记录属于其它 org（记录 ${existing.record.orgId} ≠ 入参 ${orgId}）— 拒绝撤销`,
    );
  }

  // ⑦ unlink（ENOENT ⇒ 竞态：仍按 404；其它 ⇒ 500）
  try {
    unlinkSync(recordPathOf(input.approvalsRoot, roleId));
  } catch (err: unknown) {
    if (nodeErrorCode(err) === 'ENOENT') {
      return reject(
        'E_APPROVAL_NOT_FOUND',
        `审批记录在撤销时已消失（竞态，ENOENT）：${recordPathOf(input.approvalsRoot, roleId)}`,
      );
    }
    return ioFailure(
      'E_APPROVAL_IO',
      `审批记录删除失败（${recordPathOf(input.approvalsRoot, roleId)}）：${nodeErrorCode(err) ?? errorMessage(err)}`,
      { roleId },
    );
  }

  log.info(
    {
      roleId,
      approvalId: existing.record.approvalId,
      approverId: existing.record.approverId,
      revokedBy: input.actor.id,
      revokedAt: resolveApprovedAt(input.now),
    },
    '岗位包审批记录已撤销（删记录，不删审计）— 下一轮 loadRolePacks() 即失效',
  );
  return { ok: true, record: existing.record, unchanged: false };
}
