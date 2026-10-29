/**
 * src/init/role-pack-approval.ts — 岗位包审批门：记录侧判定 ＋ 出厂代码锚（#1075 P2-1）
 *
 * 架构位置: **引擎侧**（`src/init/`）读取**运行时状态**（`<repo>/.synova/approvals/<roleId>.json`）。
 *   方向单向：内容面零 import；审批记录**不在包内**（manifest 不携带审批字段，§2.2-D1）；
 *   本文件不读六件内容、不写盘、不触网络、不 append 审计（写入器属 P3）。
 *
 * 🔴 口径（§2.0 威胁模型）：本模块是**人在环工作流闸（workflow gate）**，**不是对抗性安全控制**。
 *   它只保证：**默认不生效**（无记录 ⇒ pending）／**改内容即失效**（contentHash 不符）／
 *   **单字段篡改即失效**（自绑定 `approvalId` 复算）／**状态可见**（三值＋code＋点名 reason）。
 *   它**不保证**：不可伪造（能改文件者可重写记录并重算）、取证不可抹、撤销持久、抗本地 DoS ——
 *   见 Known Limitations L1／L5／L6；抗伪造与取证归 P3（审计链）／P4（签名或可信发布清单）。
 *
 * 设计哲学（一句）: **默认不生效 ＋ 单一权威 ＋ 逐条短路** ——
 *   没有"匹配的记录或命中的出厂锚"就一律不批准；每个拒绝只产出一个 typed code ＋ 点名到字段的 reason；
 *   判定顺序固定（出厂锚 → 记录可读性 → 记录形状 → 身份 → 租户 → 自绑定 → 内容指纹），任一环不符即短路。
 *
 * 契约（铁律 47）:
 *   @input  — `readApprovalRecord(roleId, { approvalsRoot })`（IO 壳）／
 *             `judgeRolePackApproval({ roleId, contentHash, orgId, approvalsRoot, hasToolDeclarations })`（组合）。
 *             🔴 `contentHash` **由调用方传入**（`validateRolePackDir()` 的同一次读产出，§2.2-D2）；
 *             本文件**不 import** `./role-pack-schema`（**N6 防循环依赖**：schema 不依赖审批，
 *             审批也不依赖 schema —— hash 归 schema 侧，判定归本侧）。
 *   @output — `RolePackApproval { status, approvalId?, scope?, permissionsPending?, code?, reason? }`；
 *             `status` 三值：`approved`／`pending`（无记录）／`unverified`（读失败或任一不符）。
 *             `readApprovalRecord()` 返回 `{ok:true, record}` 或 `{ok:false, code, reason}`。
 *   @degraded — **不抛**（判定在装载路径上）：读失败／JSON 坏／形状非法／不符一律折成
 *             `unverified ＋ code ＋ log.error`（铁律 11/24/31）；无记录折 `pending ＋ ROLE_PACK_APPROVAL_PENDING
 *             ＋ log.info`（**pending 不计 degraded** —— §4.5-C1）。信封由调用方（`preset-loader`）
 *             折进 `RolePack.approval`／`usable[]`／`resolveRoleKnowledgeScope().degraded`。
 *   @authority — 生产消费者**唯一** = `src/init/preset-loader.ts` 的 `readRolePack()`（单读 → hash → 判定）。
 *             其它模块不得复制本文件判定；审批记录的**写入／撤销／审计 append 属 P3**，本文件只读。
 *   @not-here — 不算内容指纹（N6）；不做 canonical 化；不做权限消费（P2-4 必须据 `permissionsPending` 拒绝）；
 *             不做审批 UI/写入器/撤销（P3）；不认 `schemaVersion !== 1` 的记录（未来版本走新规格，不猜）。
 *
 * 判定顺序（逐条短路；＝规格 §2.3-B，改此行须同批改 `tests/init/role-pack-approval.test.ts`）:
 *   ① 出厂 roleId（`FACTORY_APPROVALS` 命中）⇒ **只与锚比 contentHash**；不符 ⇒ `unverified(E_FACTORY_ANCHOR_MISMATCH)`；
 *      相符 ⇒ `approved(scope=锚 scope, approvalId='factory:<roleId>:v1')`；**存在记录 ⇒ log.warn 忽略，记录不得覆盖锚**。
 *   ② 非出厂 ⇒ **先探审批根可读性**（`accessSync(root, R_OK)`）：`ENOENT` ⇒ 无记录 ⇒ `pending`；
 *      其它失败（`EACCES`／`ENOTDIR`…）⇒ **非出厂一律 `unverified(E_APPROVAL_INVALID)`**（fail-closed，D5/J8）。
 *      🔴 必须先探目录再 `lstatSync` 记录：POSIX 下目录 `0o111`（有 x 无 r）仍允许**按名** lstat/读文件，
 *      只判记录文件会把"目录不可读"误判成"无记录 ⇒ pending"（方向错误的 fail-open）。
 *   ②b 记录 `lstatSync`（**不跟随符号链接**）：非普通文件 或 > 8192 B ⇒ `E_APPROVAL_INVALID`。
 *   ③ JSON 解析失败／字段缺失／`schemaVersion !== 1` ⇒ `E_APPROVAL_INVALID`。
 *   ④ 记录 `roleId` ≠ 入参 roleId（＝目录名）⇒ `E_APPROVAL_ROLE_MISMATCH`。
 *   ⑤ 记录 `orgId` ≠ 入参 orgId ⇒ `E_APPROVAL_ORG_MISMATCH`。
 *   ⑥ 复算 `approvalId` ≠ 记录值 ⇒ `E_APPROVAL_ID_MISMATCH`（覆盖 scope/approvedAt/approverId/approverRole 篡改）。
 *   ⑦ 记录 `contentHash` ≠ 入参 contentHash ⇒ `E_APPROVAL_CONTENT_CHANGED`。
 *   ⑧ 全过 ⇒ `approved`（`scope` 透出）。
 *   无记录（ENOENT）⇒ `pending`；审批目录/记录读失败（非 ENOENT）⇒ **非出厂全部 `unverified`**（fail-closed）。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `FACTORY_APPROVALS` | 出厂三包代码锚（判定第①步；键集＝`FACTORY_ROLE_IDS`） |
 *   | `readApprovalRecord()` | 记录读取＋形状校验（IO 壳；同步、不抛；**先探审批根 R_OK** → `lstatSync` 判类型/大小） |
 *   | `judgeRolePackApproval()` | 判定组合（三值结果；不抛） |
 *   | `RolePackApproval` | 判定结果类型（`RolePack.approval` 的形状来源） |
 *   | `ApprovalRecord` | 审批记录类型（§2.3-B 的字段级契约；P3 写入器据此构造） |
 *   内部：`computeSelfBoundApprovalId()`（D9 自绑定纯核）／`permissionsPendingFor()`／`factoryAnchorFor()`。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L1 · 工作流闸不是安全控制**：能改文件的半可信用户可**重写记录并重算 hash**（零门槛）；
 *     本模块只做"默认不生效／改内容即失效／单字段篡改即失效／可见"。**禁对外宣称"不可伪造"**。
 *   · **L2 · 无写入器/UI**：记录由 P3 写；本文件测试手工构造。**上线后客户新建岗位默认 `pending`**（有意的安全默认）。
 *   · **L3 · 出厂锚要改代码**：改出厂三包内容 ⇒ 必须同批改 `FACTORY_APPROVALS`（评审闸的代价），
 *     否则锚不符 ⇒ `E_FACTORY_ANCHOR_MISMATCH`（记录写得再对也不覆盖）。
 *   · **L4 · `permissionsPending` 只是标志**：不阻止"已批内容含 tools"，只保证**不被当已批权限**；
 *     P2-4 消费权限时必须据 `scope === 'content+permissions'` ＋ `permissionsPending === false` 才放行。
 *   · **L5 · 伪造与取证**：伪造记录不防（L1）；**删记录可把 `unverified` 退化为 `pending`**（可见性可被抹）；
 *     **撤销不持久**（旧记录可贴回）。→ P3 审计链 append ＋ `verifyChain` ＋ 撤销留痕。
 *   · **L6 · 本地可自伤（DoS）**：`chmod` 审批目录不可读（`R_OK` 失败，含 `0o111` 有 x 无 r）⇒
 *     **非出厂全 `unverified`**（fail-closed 的代价）；出厂三包不受影响（只信代码锚）。机制：
 *     `accessSync(approvalsRoot, R_OK)` 一次探针（**不列举目录**），POSIX 下 `0o111` 按名仍可 lstat/读记录
 *     ⇒ 只判记录文件会漏判，故探针必须先于 `lstatSync`。记录文件自身不可读（`0o000`）⇒ 同样 `unverified`。
 *   · **L7 · `orgId` 来自 env**（`SYNOVA_ORG_ID`，`src/config.ts:110`）：同一对手可改 ⇒ **不是安全控制**，
 *     只防跨实例误用。
 *   · **L10 · 符号链接**：`lstatSync` 不跟随 ⇒ 记录是符号链接即 `E_APPROVAL_INVALID`（不读目标）；
 *     但 `.synova/approvals` 下的**多余记录文件**不影响判定（只按键读 `<roleId>.json`）。
 *   · **L11 · J8 的 chmod 判据依赖非 root 身份**：root 下 `chmod` 不产生 `EACCES` ⇒ 用例空转（测试内 `skipIf`）。
 *   · **L-TOCTOU**：`lstatSync` 与 `readFileSync` 之间有窗口；内容指纹由调用方**单读**产出、本模块不重读内容件
 *     ⇒ 记录文件的"写入中途"读法可致 `E_APPROVAL_INVALID`（fail-closed，方向安全）。
 *   · **L-LEN**：记录 > 8192 B 直接 `INVALID`（**不读**）；**恰好** 8192 B 放行（由 JSON 形状兜底）。
 *   · **L-SCHEMA**：记录 `schemaVersion` 只认 `1`；未来版本须新规格（本文件不"猜"旧/新版本）。
 *   · **L-FACTORY-AT**：出厂锚的 `approvedAt` 是**声明性常量**，不参与自绑定（出厂 `approvalId` 恒为 `factory:<roleId>:v1`）。
 */
import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants, lstatSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@synova/logger';

const log = createLogger('init/role-pack-approval');

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约常量（错误码只取 §4.5-C1 码表，禁自造）
// ══════════════════════════════════════════════════════════════════════════════

/** 审批记录单件**硬上限**（字节）。超限 ⇒ `E_APPROVAL_INVALID`（不读超长文件，§4.5-C2）。 */
const APPROVAL_RECORD_MAX_BYTES = 8192;

/** 记录 schema 版本（本批只认 1；`schemaVersion !== 1` ⇒ `E_APPROVAL_INVALID`）。 */
const APPROVAL_RECORD_SCHEMA_VERSION = 1;

/** 内容指纹形状（小写 64 hex；＝`computeRolePackContentHash()` 的产出形状）。 */
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** 无记录（正常默认）的**装载期 problem 码**（§4.5-C1；`pending` 用它，**不计 degraded**）。 */
const PENDING_CODE = 'ROLE_PACK_APPROVAL_PENDING';

/**
 * 出厂岗位包 roleId 键集（唯一三包；`FACTORY_APPROVALS` 的键集 ⇒ 出厂只信代码锚，§2.2-D4）。
 * 判定时用 `FACTORY_ROLE_IDS.find()` 做 **own-property 等价的字符串匹配**（不走原型链，防 `toString` 之类误命中）。
 */
const FACTORY_ROLE_IDS = ['finance', 'hr', 'sales'] as const;

/** 出厂 roleId 的联合类型（`FACTORY_APPROVALS` 的键类型）。 */
type FactoryRoleId = (typeof FACTORY_ROLE_IDS)[number];

/**
 * **出厂代码锚**（§1.2-6／§2.2-D4）：出厂三包 ＝ `{contentHash, approvedAt, approvalId, scope:'content+permissions'}`。
 *
 * 🔴 出厂 roleId **永远先过本锚**（判定第①步）：锚不符 ⇒ `unverified`；**记录存在也不得覆盖**
 *   （记录只作 `log.warn` 证据）。代价见 L3：改出厂内容必须同批改常量（评审闸）。
 * `approvalId` 用常量 `factory:<roleId>:v1`（不入 D9 自绑定 —— 见 L-FACTORY-AT）；
 * 该字面量同时是 loader 缓存指纹（D10）的出厂取值（`'factory:' + roleId + ':v1'`）。
 *
 * 🔴 三行 `contentHash` 是**独立自验员 python 脚本**（hashlib 直读六件 raw bytes）产出的字面量
 *   （≈ 规格 §5-⑤ 的内联脚本；跨实现一致），**禁**用 `computeRolePackContentHash()` 生成期望值
 *   （同源自证 ＝ gate-A B11 退回项）；`tests/init/role-pack-approval.test.ts` 的 J2 三字面量与本处同源。
 */
export const FACTORY_APPROVALS: Readonly<
  Record<
    FactoryRoleId,
    {
      /** 六件内容指纹（raw bytes；独立脚本产出，见上） */
      readonly contentHash: string;
      /** 出厂批准时间（**声明性**；不参与自绑定，见 L-FACTORY-AT） */
      readonly approvedAt: string;
      /** 出厂常量 id（＝`factory:<roleId>:v1`；loader 缓存指纹同源） */
      readonly approvalId: string;
      /** 出厂三包按"内容＋权限"粒度批准（三包均声明 tools） */
      readonly scope: 'content+permissions';
    }
  >
> = {
  finance: {
    contentHash: '9ddbffe2967c0be4a1ddc3d64efbbb35caa12450af46ff78b5ede0abab0cb783',
    approvedAt: '2026-10-28T00:00:00.000Z',
    approvalId: 'factory:finance:v1',
    scope: 'content+permissions',
  },
  hr: {
    contentHash: '167aba961881c994c25b44c2751835639b5b47f77b84ec793fd4179ae61bc390',
    approvedAt: '2026-10-28T00:00:00.000Z',
    approvalId: 'factory:hr:v1',
    scope: 'content+permissions',
  },
  sales: {
    contentHash: '27098076f67a2fbd0b866fd5205eb2485637cfd9e954d2bda7741984bf452839',
    approvedAt: '2026-10-28T00:00:00.000Z',
    approvalId: 'factory:sales:v1',
    scope: 'content+permissions',
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型（typed code；禁裸字符串 —— 铁律 32）
// ══════════════════════════════════════════════════════════════════════════════

/** 审批粒度（§2.3-B/C）：只批内容／内容＋权限。 */
type RolePackApprovalScope = 'content' | 'content+permissions';

/**
 * 本文件产出的拒绝码（**只取 §4.5-C1 码表**；`ROLE_PACK_APPROVAL_UNVERIFIED` 是**调用方**的装载期码，
 * 由 loader 在把 `unverified` 折进 `problems[]` 时使用，本文件不产出）。
 */
type ApprovalRejectCode =
  | 'E_APPROVAL_INVALID'
  | 'E_APPROVAL_ROLE_MISMATCH'
  | 'E_APPROVAL_ORG_MISMATCH'
  | 'E_APPROVAL_ID_MISMATCH'
  | 'E_APPROVAL_CONTENT_CHANGED'
  | 'E_FACTORY_ANCHOR_MISMATCH';

/** 记录读取失败（`code` 为拒绝码或 `ROLE_PACK_APPROVAL_PENDING`）。 */
type ApprovalReadFailure = { readonly ok: false; readonly code: string; readonly reason: string };

/**
 * 判定结果（§2.3-C；`RolePack.approval` 的**形状来源**）。
 * `approved` ⇒ 带 `approvalId` ＋ `scope` ＋ `permissionsPending`；
 * `pending`／`unverified` ⇒ 带 `code` ＋ `reason`（**不透出 `scope`／`approvalId`** —— status 已足够拒绝）。
 */
export type RolePackApproval = {
  readonly status: 'approved' | 'pending' | 'unverified';
  readonly approvalId?: string;
  readonly scope?: RolePackApprovalScope;
  readonly permissionsPending?: boolean;
  readonly code?: string;
  readonly reason?: string;
};

/**
 * 审批记录（§2.3-B 字段级契约；`.synova/approvals/<roleId>.json`，P3 写、本文件只读）。
 * `scope` 缺省按 `content`（保守）；未知键**容忍**（additive），但本文件只读上列九键。
 */
export type ApprovalRecord = {
  readonly schemaVersion: 1;
  readonly roleId: string;
  readonly orgId: string;
  readonly approvalId: string;
  readonly contentHash: string;
  readonly approverId: string;
  readonly approverRole: string;
  readonly approvedAt: string;
  readonly scope: RolePackApprovalScope;
};

// ══════════════════════════════════════════════════════════════════════════════
// 三、纯核（自绑定 digest ＋ 权限待批标志；无 IO／不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * D9 自绑定（§2.2-D9／§4.5-C1）：`'apv1:' + sha256hex(orgId|roleId|contentHash|scope|approvedAt|approverId|approverRole)[0:16]`。
 *
 * 🔴 判定时**复算并比对** ⇒ `scope`／`orgId`／`roleId`／`approvedAt`／`approverId`／`approverRole` 任一被改即失效
 *   （N7 把 approver 段也纳入）。复算用的是**记录自身字段**（内部自洽校验）：
 *   `roleId`／`orgId` 与入参的比对**先于**本步（§2.3-B 顺序 ④⑤ 在 ⑥ 之前），
 *   故"改 orgId／roleId"由专用码点名，"改 scope／approvedAt／approver*"由本步点名。
 * 🔴 **不防**"整条重写并重算"（L1）。
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

/**
 * `permissionsPending` 口径（§2.3-C）：
 *   · `scope === 'content+permissions'` ⇒ `false`（权限已批）；
 *   · `scope === 'content'` ⇒ 看包是否声明了 `capabilities[].tool`（`hasToolDeclarations`）——
 *     声明了则**权限仍未批** ⇒ `true`，未声明 ⇒ `false`（无待批权限）。
 * 🔴 保守默认由**调用方**实现：`capabilities.yaml` 解析失败时必须传 `hasToolDeclarations: true`
 *   （否则会把"读不出"当"没有 tools"）；本函数只做无歧义映射。
 */
function permissionsPendingFor(scope: RolePackApprovalScope, hasToolDeclarations: boolean): boolean {
  if (scope === 'content+permissions') return false;
  return hasToolDeclarations;
}

/** 出厂锚查找（**不走原型链**：`find` 匹配键集名单，`toString`/`__proto__` 等不会被误判为出厂）。 */
function factoryAnchorFor(roleId: string): (typeof FACTORY_APPROVALS)[FactoryRoleId] | undefined {
  const matched = FACTORY_ROLE_IDS.find((id) => id === roleId);
  return matched === undefined ? undefined : FACTORY_APPROVALS[matched];
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、IO 壳：记录读取（同步、不抛；lstat 判类型/大小）
// ══════════════════════════════════════════════════════════════════════════════

/** 拒绝信封（不抛；`code` 只取码表）。 */
function reject(code: ApprovalRejectCode | typeof PENDING_CODE, reason: string): ApprovalReadFailure {
  return { ok: false, code, reason };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 取 Node 错误的 `code`（`ENOENT`／`EACCES`／…）；无则 `undefined`（不猜）。 */
function nodeErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 非普通文件的**点名**（诊断用；顺序＝最可能先命中者）。 */
function describeFileType(stats: Stats): string {
  if (stats.isSymbolicLink()) return '符号链接（lstat 不跟随）';
  if (stats.isDirectory()) return '目录';
  if (stats.isFIFO()) return 'FIFO（命名管道）';
  if (stats.isSocket()) return 'socket';
  if (stats.isCharacterDevice()) return '字符设备';
  if (stats.isBlockDevice()) return '块设备';
  return '非普通文件';
}

/** 取记录字段的非空字符串值（缺失/类型不符 ⇒ `undefined`）。 */
function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return isNonEmptyString(value) ? value : undefined;
}

/**
 * 记录形状校验（纯核；§2.3-B 顺序 ③）。
 * 只认 `schemaVersion === 1`；`scope` 缺省按 `content`（保守），非法值 ⇒ INVALID；未知键容忍。
 */
function validateRecordDoc(
  doc: unknown,
  ctx: { readonly roleId: string; readonly recordPath: string },
): { readonly ok: true; readonly record: ApprovalRecord } | ApprovalReadFailure {
  const where = ctx.recordPath;
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return reject('E_APPROVAL_INVALID', `审批记录不是 JSON 对象（${where}）`);
  }
  const fields = doc as Record<string, unknown>;

  if (fields['schemaVersion'] !== APPROVAL_RECORD_SCHEMA_VERSION) {
    return reject(
      'E_APPROVAL_INVALID',
      `记录 schemaVersion=${JSON.stringify(fields['schemaVersion'])} ≠ ${String(APPROVAL_RECORD_SCHEMA_VERSION)}（${where}）`,
    );
  }

  const roleIdValue = stringField(fields, 'roleId');
  const orgIdValue = stringField(fields, 'orgId');
  const approvalIdValue = stringField(fields, 'approvalId');
  const contentHashValue = stringField(fields, 'contentHash');
  const approverIdValue = stringField(fields, 'approverId');
  const approverRoleValue = stringField(fields, 'approverRole');
  const approvedAtValue = stringField(fields, 'approvedAt');

  const missing = [
    ['roleId', roleIdValue],
    ['orgId', orgIdValue],
    ['approvalId', approvalIdValue],
    ['contentHash', contentHashValue],
    ['approverId', approverIdValue],
    ['approverRole', approverRoleValue],
    ['approvedAt', approvedAtValue],
  ]
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  if (
    roleIdValue === undefined ||
    orgIdValue === undefined ||
    approvalIdValue === undefined ||
    contentHashValue === undefined ||
    approverIdValue === undefined ||
    approverRoleValue === undefined ||
    approvedAtValue === undefined
  ) {
    return reject('E_APPROVAL_INVALID', `记录字段缺失或非非空字符串：${missing.join('、')}（${where}）`);
  }

  if (!CONTENT_HASH_PATTERN.test(contentHashValue)) {
    return reject(
      'E_APPROVAL_INVALID',
      `记录 contentHash 非 64 位小写 hex（${where}）：${JSON.stringify(contentHashValue)}`,
    );
  }

  const rawScope = fields['scope'];
  if (rawScope !== undefined && rawScope !== 'content' && rawScope !== 'content+permissions') {
    return reject(
      'E_APPROVAL_INVALID',
      `记录 scope 非法（${where}）：${JSON.stringify(rawScope)}（只接受 content／content+permissions；缺省按 content）`,
    );
  }
  const scope: RolePackApprovalScope = rawScope === undefined ? 'content' : rawScope;

  return {
    ok: true,
    record: {
      schemaVersion: APPROVAL_RECORD_SCHEMA_VERSION,
      roleId: roleIdValue,
      orgId: orgIdValue,
      approvalId: approvalIdValue,
      contentHash: contentHashValue,
      approverId: approverIdValue,
      approverRole: approverRoleValue,
      approvedAt: approvedAtValue,
      scope,
    },
  };
}

/**
 * 审批根可读性探针（**必须先于记录 `lstat`** —— D5/J8 的 fail-closed 落点）。
 *
 * 🔴 为什么需要（2026-10-28 实测，verifier 独立复现）：POSIX 下目录 `0o111`（有 x 无 r）仍允许
 *   **按名** lstat／读取已知文件名 ⇒ 只判 `<approvalsRoot>/<roleId>.json` 会把"审批目录不可读"
 *   误判成"无记录 ⇒ pending"（**fail-open 方向**），与 D5「目录读失败（非 ENOENT）⇒ 非出厂 unverified」相反。
 *   故先用 `accessSync(root, R_OK)` 一次探针（**不列举目录**，不引入 readdir 成本）：
 *   · `ENOENT` ⇒ 审批根不存在 ＝ 正常默认（无记录 ⇒ `pending`，不是错误）；
 *   · 其它失败（`EACCES`／`ENOTDIR`／…）⇒ 审批目录不可读 ⇒ **非出厂一律 `unverified`**（L6）。
 * 返回 `undefined` ⇒ 可读，继续读记录。
 */
function probeApprovalsRoot(approvalsRoot: string): ApprovalReadFailure | undefined {
  try {
    accessSync(approvalsRoot, fsConstants.R_OK);
    return undefined;
  } catch (err: unknown) {
    const code = nodeErrorCode(err);
    if (code === 'ENOENT') {
      return reject(PENDING_CODE, `审批根不存在：${approvalsRoot} —— 无记录（pending，正常默认）`);
    }
    return reject(
      'E_APPROVAL_INVALID',
      `审批目录不可读（${approvalsRoot}）：${code ?? errorMessage(err)} —— fail-closed（非出厂不生效，L6）`,
    );
  }
}

/**
 * `readApprovalRecord()` — 读一条审批记录（**同步、不抛**；§4.5-C1）。
 *
 * 契约:
 *   @input  — `roleId`（＝角色包目录名，也是记录文件名主干）；`opts.approvalsRoot`（审批根，由调用方派生）。
 *   @output — `{ok:true, record}`（已校验形状；`scope` 已按缺省 `content` 归一）
 *             或 `{ok:false, code, reason}`：**无记录**（审批根或记录文件 ENOENT）⇒ `code = ROLE_PACK_APPROVAL_PENDING`；
 *             其余（审批目录不可读／非普通文件／超 8192 B／记录不可读／JSON 坏／字段缺失／schemaVersion≠1）
 *             ⇒ `E_APPROVAL_INVALID`。
 *   @degraded — **不抛**；**本函数不记日志**（唯一生产消费者 `judgeRolePackApproval()` 折日志，避免双写）。
 *   @authority — 只读；不创建目录、不修正权限、不跟随符号链接（`lstatSync`）；先探审批根可读性。
 */
export function readApprovalRecord(
  roleId: string,
  opts: { readonly approvalsRoot: string },
): { readonly ok: true; readonly record: ApprovalRecord } | { readonly ok: false; readonly code: string; readonly reason: string } {
  // 0. roleId 形状（防御目录穿越：本模块恒以目录名为键；`../` 会逃出 approvalsRoot）
  if (!isNonEmptyString(roleId) || roleId === '.' || roleId === '..' || /[\\/]/.test(roleId)) {
    return reject('E_APPROVAL_INVALID', `roleId 非法（空／含路径分隔符／为 . 或 ..）：${JSON.stringify(roleId)}`);
  }
  const recordPath = join(opts.approvalsRoot, `${roleId}.json`);

  // 1. 审批根可读性（**必须先于记录 lstat** —— 见 probeApprovalsRoot 的 POSIX 0o111 说明）
  const rootUnreadable = probeApprovalsRoot(opts.approvalsRoot);
  if (rootUnreadable !== undefined) return rootUnreadable;

  // 2. 类型/大小（lstat：不跟随符号链接）
  let stats: Stats;
  try {
    stats = lstatSync(recordPath);
  } catch (err: unknown) {
    const code = nodeErrorCode(err);
    if (code === 'ENOENT') {
      // 正常默认：无记录 ⇒ pending（不是错误，不计 degraded）
      return reject(PENDING_CODE, `无审批记录：${recordPath} 不存在 —— 默认不生效（pending）`);
    }
    return reject('E_APPROVAL_INVALID', `审批记录不可 stat（${recordPath}）：${code ?? errorMessage(err)}`);
  }
  if (!stats.isFile()) {
    return reject(
      'E_APPROVAL_INVALID',
      `审批记录非普通文件（${recordPath}）：${describeFileType(stats)}`,
    );
  }
  if (stats.size > APPROVAL_RECORD_MAX_BYTES) {
    return reject(
      'E_APPROVAL_INVALID',
      `审批记录超长（${recordPath}）：${String(stats.size)} B > ${String(APPROVAL_RECORD_MAX_BYTES)} B`,
    );
  }

  // 2. 读 + 解析
  let raw: string;
  try {
    raw = readFileSync(recordPath, 'utf8');
  } catch (err: unknown) {
    return reject(
      'E_APPROVAL_INVALID',
      `审批记录不可读（${recordPath}）：${nodeErrorCode(err) ?? errorMessage(err)}`,
    );
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err: unknown) {
    return reject('E_APPROVAL_INVALID', `审批记录 JSON 解析失败（${recordPath}）：${errorMessage(err)}`);
  }

  // 3. 形状（含 schemaVersion / 字段缺失 / contentHash 形状 / scope 缺省）
  return validateRecordDoc(doc, { roleId, recordPath });
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、判定：组合（出厂锚 → 记录 → 身份 → 租户 → 自绑定 → 指纹）
// ══════════════════════════════════════════════════════════════════════════════

/** 不通过 ⇒ `unverified`（**一律 `log.error` 带 code** —— G2 不静默，铁律 11/24/31）。 */
function rejectUnverified(roleId: string, code: string, reason: string): RolePackApproval {
  log.error(
    { roleId, code, reason, degraded: true },
    '岗位包审批不通过 — 按 fail-closed 判 unverified（该岗位不生效）',
  );
  return { status: 'unverified', code, reason };
}

/** 无记录 ⇒ `pending`（**`log.info`**；**不计 degraded** —— §4.5-C1 口径）。 */
function markPending(roleId: string, approvalsRoot: string, reason: string): RolePackApproval {
  log.info(
    { roleId, code: PENDING_CODE, approvalsRoot, status: 'pending' },
    '岗位包无审批记录 — 默认不生效（pending，非降级）',
  );
  return { status: 'pending', code: PENDING_CODE, reason };
}

/** 出厂 roleId 判定（第①步；只与锚比 contentHash，记录仅作日志）。 */
function judgeFactoryRole(ctx: {
  readonly roleId: string;
  readonly contentHash: string;
  readonly approvalsRoot: string;
  readonly hasToolDeclarations: boolean;
  readonly anchor: (typeof FACTORY_APPROVALS)[FactoryRoleId];
}): RolePackApproval {
  // 记录**只作证据**：存在 ⇒ log.warn 忽略；不可读 ⇒ log.warn（两条都不影响锚判定）
  const recordRead = readApprovalRecord(ctx.roleId, { approvalsRoot: ctx.approvalsRoot });
  if (recordRead.ok) {
    log.warn(
      { roleId: ctx.roleId, recordApprovalId: recordRead.record.approvalId },
      '出厂岗位包只信代码锚 — 存在审批记录，已忽略（记录不得覆盖锚，§2.2-D4）',
    );
  } else if (recordRead.code !== PENDING_CODE) {
    log.warn(
      { roleId: ctx.roleId, code: recordRead.code, reason: recordRead.reason },
      '出厂岗位包的审批记录不可读 — 不影响出厂锚判定（已忽略）',
    );
  }

  if (ctx.contentHash !== ctx.anchor.contentHash) {
    return rejectUnverified(
      ctx.roleId,
      'E_FACTORY_ANCHOR_MISMATCH',
      `contentHash 与出厂代码锚不符：实测 ${ctx.contentHash} ≠ 锚 ${ctx.anchor.contentHash}` +
        '（改出厂内容必须同批改 FACTORY_APPROVALS —— L3）',
    );
  }

  const permissionsPending = permissionsPendingFor(ctx.anchor.scope, ctx.hasToolDeclarations);
  log.info(
    { roleId: ctx.roleId, approvalId: ctx.anchor.approvalId, scope: ctx.anchor.scope, permissionsPending },
    '出厂岗位包锚命中 — 批准（scope 来自代码锚，不来自记录）',
  );
  return {
    status: 'approved',
    approvalId: ctx.anchor.approvalId,
    scope: ctx.anchor.scope,
    permissionsPending,
  };
}

/** 非出厂 roleId 判定（第②–⑧步）。 */
function judgeRecordRole(ctx: {
  readonly roleId: string;
  readonly contentHash: string;
  readonly orgId: string;
  readonly approvalsRoot: string;
  readonly hasToolDeclarations: boolean;
}): RolePackApproval {
  const recordRead = readApprovalRecord(ctx.roleId, { approvalsRoot: ctx.approvalsRoot });
  if (!recordRead.ok) {
    if (recordRead.code === PENDING_CODE) return markPending(ctx.roleId, ctx.approvalsRoot, recordRead.reason);
    // ②③ 读失败/形状非法（含审批目录不可读 ⇒ E_APPROVAL_INVALID）⇒ fail-closed
    return rejectUnverified(ctx.roleId, recordRead.code, recordRead.reason);
  }
  const record = recordRead.record;

  // ④ 身份（＝目录名）：记录被拷到别的岗位键下 / roleId 被改
  if (record.roleId !== ctx.roleId) {
    return rejectUnverified(
      ctx.roleId,
      'E_APPROVAL_ROLE_MISMATCH',
      `记录 roleId=${JSON.stringify(record.roleId)} ≠ 角色包目录名 roleId=${JSON.stringify(ctx.roleId)}` +
        '（记录被拷到别的岗位键下，或 roleId 被改）',
    );
  }

  // ⑤ 租户：跨实例误用（不是安全控制 —— L7）
  if (record.orgId !== ctx.orgId) {
    return rejectUnverified(
      ctx.roleId,
      'E_APPROVAL_ORG_MISMATCH',
      `记录 orgId=${JSON.stringify(record.orgId)} ≠ 当前实例 orgId=${JSON.stringify(ctx.orgId)}` +
        '（只防跨实例误用，不防改 env —— L7）',
    );
  }

  // ⑥ 自绑定：复算记录自身字段（覆盖 scope/approvedAt/approverId/approverRole 篡改）
  const recomputed = computeSelfBoundApprovalId(record);
  if (recomputed !== record.approvalId) {
    return rejectUnverified(
      ctx.roleId,
      'E_APPROVAL_ID_MISMATCH',
      `approvalId 复算不符：记录 ${JSON.stringify(record.approvalId)} ≠ 复算 ${JSON.stringify(recomputed)}` +
        '（scope/approvedAt/approverId/approverRole 任一被改即失效；整条重写不防 —— L1）',
    );
  }

  // ⑦ 内容指纹：改一字节即失效
  if (record.contentHash !== ctx.contentHash) {
    return rejectUnverified(
      ctx.roleId,
      'E_APPROVAL_CONTENT_CHANGED',
      `记录 contentHash=${record.contentHash} ≠ 实测 contentHash=${ctx.contentHash}（内容改一字节即失效）`,
    );
  }

  // ⑧ 全过
  const permissionsPending = permissionsPendingFor(record.scope, ctx.hasToolDeclarations);
  log.info(
    {
      roleId: ctx.roleId,
      approvalId: record.approvalId,
      scope: record.scope,
      permissionsPending,
      orgId: ctx.orgId,
    },
    '审批记录校验通过 — 批准',
  );
  return {
    status: 'approved',
    approvalId: record.approvalId,
    scope: record.scope,
    permissionsPending,
  };
}

/**
 * `judgeRolePackApproval()` — 岗位包审批态判定（**组合、不抛**；§4.5-C1）。
 *
 * 契约:
 *   @input  — `roleId`（目录名）／`contentHash`（**调用方单读产出**，64 小写 hex）／
 *             `orgId`（`config.orgId`，跨实例隔离字段）／`approvalsRoot`（`.synova/approvals` 绝对路径）／
 *             `hasToolDeclarations`（包是否声明 `capabilities[].tool`；**解析失败时调用方传 `true`**＝保守）。
 *   @output — `RolePackApproval`：`approved`（带 `approvalId`/`scope`/`permissionsPending`）／
 *             `pending`（`code=ROLE_PACK_APPROVAL_PENDING`）／`unverified`（`code` ＋ 点名 `reason`）。
 *   @degraded — **不抛**：`pending` ⇒ `log.info`（不计 degraded）；`unverified` ⇒ `log.error`（带 code）；
 *             出厂锚不符 ⇒ `log.error`；出厂 + 存在记录/记录不可读 ⇒ `log.warn`（记录被忽略）。
 *   @authority — 生产消费者唯一 = `src/init/preset-loader.ts`（`readRolePack()`）；判定顺序见文件头。
 */
export function judgeRolePackApproval(input: {
  readonly roleId: string;
  readonly contentHash: string;
  readonly orgId: string;
  readonly approvalsRoot: string;
  readonly hasToolDeclarations: boolean;
}): RolePackApproval {
  const { roleId, contentHash, orgId, approvalsRoot, hasToolDeclarations } = input;

  // 入参自检（N4：loader 校验失败时**不应**调用本函数；此处兜底 ⇒ 仍不抛、不批准）
  if (!isNonEmptyString(roleId)) {
    return rejectUnverified(
      roleId,
      'E_APPROVAL_INVALID',
      `入参 roleId 为空（${JSON.stringify(roleId)}）—— 无法定位审批记录`,
    );
  }
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    return rejectUnverified(
      roleId,
      'E_APPROVAL_INVALID',
      `入参 contentHash 非 64 位小写 hex：${JSON.stringify(contentHash)}（调用方须先 validateRolePackDir() 拿 hash —— N4）`,
    );
  }

  const anchor = factoryAnchorFor(roleId);
  if (anchor !== undefined) {
    return judgeFactoryRole({ roleId, contentHash, approvalsRoot, hasToolDeclarations, anchor });
  }
  return judgeRecordRole({ roleId, contentHash, orgId, approvalsRoot, hasToolDeclarations });
}
