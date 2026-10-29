/**
 * src/init/role-pack-permissions.ts — 岗位包「工具与权限」编译器（#1075 P2-4a）
 *
 * 架构位置: **引擎侧**（`src/init/`）读**内容面**（`extensions/presets/roles/<roleId>/capabilities.yaml`）
 *   ＋ P2-1 审批记录，把「岗位声明了哪些能力／批了哪一档权限／哪些工具真的已注册」编译成**纯数据**白名单。
 *   方向单向：内容面零 import；本文件**不写盘、不触网络、不执行任何工具**。
 *   执行门 = `src/agent/tools.ts`（`setAllowedTools()` ＋ `execute()` 拒绝码 `TOOL_PERMISSION_DENIED`），
 *   装配点 = `src/agent/conversation-engine.ts`（`applyRolePackPermissions()`／`ensurePermissionsApplied()`）。
 *
 * 设计哲学（一句）: **能力清单只是"声明"，白名单必须由「审批 scope × 已注册工具」两把尺子量出来** ——
 *   声明了但没实现 ⇒ `declaredUnavailable`（可见，不放行）；批了内容没批权限 ⇒ `permissionsPending`（全拒）；
 *   显式 `enabled:false` ⇒ 永不放行（disabled 优先）；三种"空"彼此可区分，**绝不塌成一个"没有工具"**。
 *
 * 契约（铁律 47）:
 *   @input  — `loadRolePackPermissions(roleId, opts?)`（IO 壳；**同步、不抛**）。
 *             `roleId`：岗位 id（= 内容根 `roles/` 下的目录名；**形状/白名单校验归路由层**，本文件只查"包在不在"）。
 *             `opts.knownTools`：**已注册工具名的原始清单**（生产 = `ToolRegistry.allToolNames()`；
 *             🔴 **禁传 `listTools()`** —— 后者会被上一轮白名单过滤，二次解析会把全部声明误判成"未落地"）。
 *             缺省 ⇒ 只做声明侧分类：`allowlist=[]`、`declaredUnavailable` 全量（规格 §2.3-B.5）。
 *   @output — `LoadRolePackPermissionsResult = {ok:true, permissions} | {ok:false, code, reason}`（判别联合）。
 *             `permissions` = `{roleId, allowlist（已注册 ∩ 启用）, disabled（enabled:false 项）,
 *             declaredUnavailable, permissionsPending, scope}`，全 `readonly`（规格 §2.3-A）；
 *             `code` ∈ {@link RolePackPermissionsCode} **四值**（规格 §4.5-C1），**禁自造码**。
 *   @degraded — **不抛**：包不存在／未批准／内容已变／capabilities 非法一律折成 typed code ＋ 点名 reason
 *             ＋ `log.warn({roleId, code, reason, degraded:true})`（铁律 11/24/31）。
 *             **成功但有可见降级**同样留痕（不改变返回值语义）：`declaredUnavailable` 非空 ⇒ `log.warn`
 *             （`degraded:true`，禁止静默丢弃）；`disabled` 非空 ⇒ `log.warn` 点名能力 id；
 *             `permissionsPending===true` ⇒ `log.warn`（"权限待批"，`degraded:true`）。
 *             🔴 **不加全局 catch-all**：已知失败点各自 catch（`readPieceBytesOnce` 逐件 catch、
 *             `parseYaml` 包 try、`loadRolePacks` 内部逐包 catch）；未预期异常的**调用点防御**归消费方
 *             —— 与 P2-3 的 `auditRolePackOutput` 调用点 try/catch 同样式（`cc30c84ff`）；
 *             加一个不可测的全包 catch 只会把未预期缺陷伪装成已知码（铁律 37／fail loud）。
 *   @authority — 生产唯一调用方 = `src/agent/conversation-engine.ts` 的 `applyRolePackPermissions()`
 *             （`processMessage()`／`processMessageStream()` 入口惰性应用；测试经公开的
 *             `refreshRolePackPermissions()` 驱动）。**其它模块不得复制本文件判定**。
 *             权限**项**（`knowledge.*` grants）解析归 P2-4b（`packages/engine-auth/permission-grants.ts`），本批不碰。
 *   @not-here  — 不做 HTTP 码映射（路由层）；不调用/不执行任何工具（执行门在 `src/agent/tools.ts`）；
 *             不读 `SYNOVA_ROLE_PACK_TOOLS`（D8 回滚开关在 engine 装配层）；不改 `RolePack`／审批记录
 *             （P2-1 件，红线）；不解析 `permissionGrants`（P2-4b）；不缓存（规格 L5）；
 *             不判 `label`／`disabledReason` 文案（只透出能力 id —— KL-5）。
 *   @error   — 四码语义（**禁扩展**）：`E_ROLE_PACK_NOT_FOUND`＝包不在装载清单；
 *             `E_ROLE_PACK_NOT_APPROVED`＝审批态非 approved（pending／unverified）；
 *             `E_ROLE_PACK_CONTENT_CHANGED`＝"批准之后内容被改"（含 P2-1 审批门子案映射，判定序②a）
 *             或六件不可复核（load↔snapshot 窗口）；`E_ROLE_PACK_CAPABILITIES_INVALID`＝capabilities.yaml
 *             取不到字节／超 64 KiB／YAML 坏（含重复键）／形状非法／超条数或超工具名长度。
 *
 * 判定顺序（逐条短路；＝规格 §2.3-B，改此行须同批改 `tests/init/role-pack-permissions.test.ts`）:
 *   ① `loadRolePacks()` 按 roleId 找包（无缓存语义，每轮重扫）；无 ⇒ `E_ROLE_PACK_NOT_FOUND`。
 *   ② 审批门（`permissionsPending` 的**唯一数据源**同在 `pack.approval`）：`status !== 'approved'` ⇒ 细分——
 *      ②a `approval.code === 'E_APPROVAL_CONTENT_CHANGED'`（P2-1："记录指纹 ≠ 实测指纹"）⇒
 *          **`E_ROLE_PACK_CONTENT_CHANGED`**。可核理由（同 P2-2 判定序⑤，L1 裁定保留）：这是稳态
 *          "批准后内容被改"的**生产主触发面**；不映射则本码只剩 TOCTOU 窗口可达 ⇒ 规格 J5 永不可达（死码）。
 *          两码在 HTTP 侧同为 409，且不放大其余 pending／unverified（仍走 NOT_APPROVED）。
 *      ②b 其余 `pending`／`unverified` ⇒ `E_ROLE_PACK_NOT_APPROVED`（透出 status ＋ code／reason）。
 *   ③ 六件单读快照（`readPieceBytesOnce(roleDir)`，**禁二读**）→ `computeRolePackContentHash(pieces)` 必须
 *      `=== pack.validation.contentHash`；不等 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`。
 *      快照失败（缺件／符号链接／读失败）或校验期无指纹 ⇒ **同码**（"不可复核内容"按"已变"处理，
 *      fail-closed —— KL-2；稳态不可达：validation 失败 ⇒ 审批 unverified ⇒ 已在②拦下）。
 *   ④ 从**同一份快照**取 `capabilities.yaml` 字节（封 TOCTOU）：缺件 ⇒ `E_ROLE_PACK_CAPABILITIES_INVALID`；
 *      `> 64 KiB` ⇒ 同码（**先于解析**，不截断）；YAML 坏（含重复键）⇒ 同码；`capabilities` 非数组／
 *      条目非映射／`id` 非非空串／`tool` 非串或空或 >120 字符／`enabled` 非 boolean／条数 >64 ⇒ 同码
 *      （reason 逐条点名到 `capabilities[i].字段`）。
 *   ⑤ 分类（**disabled 优先**）：`allowlist = (声明 ∩ knownTools) − (enabled:false 条目声明的 tool)`；
 *      `declaredUnavailable = 声明了 tool 但 ∉ knownTools`（与 enabled 无关；两数组语义不同，见 KL-4）；
 *      `disabled`：每个 `enabled:false` 条目**必记 capability id**，该条若另声明 tool 再追加该 tool；
 *      工具名/能力 id 各自去重（保声明顺序）。
 *   ⑥ `permissionsPending` = `pack.approval.permissionsPending === true`（**D4 单一判据，不自行推导**）；
 *      `permissionsPending === true ⇒ allowlist 恒为 []`（全拒）；`scope` = `approval.scope`（缺省按
 *      `'content'` 保守 —— KL-6）；`capabilities: 0 条` 合法（allowlist 空，**不是错误**）。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `RolePackToolPermissions` | 字段级契约（规格 §2.3-A；全 readonly） |
 *   | `RolePackPermissionsCode`／`LoadRolePackPermissionsResult` | typed 结果（判别联合；四码） |
 *   | `LoadRolePackPermissionsOptions` | 注入缝（`knownTools`；测试与 engine 共用） |
 *   | `loadRolePackPermissions()` | IO 壳：装载 → 审批门 → 六件单读 → 指纹自校验 → 解析 capabilities → 分类 |
 *   内部：`classifyCapabilities()`（纯核：解析并分类 capabilities 字节；无 IO、不抛）／
 *         `isRecord()`／`show()`／`describeError()`（小工具，禁 `as`）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **KL-1 · 只判工具名**（规格 L3）：不判工具参数、不判数据域／知识域读写；`permissionGrants`
 *     的项级授权归 P2-4b。本文件的白名单是"能调哪个工具"，不是"能碰哪行数据"。
 *   · **KL-2 · 快照不可复核 ⇒ 按 `CONTENT_CHANGED`**（规格 §4.5-C1 四码表无 `UNREADABLE` 位）：
 *     规格 §2.3-B 只给"指纹不等 ⇒ CONTENT_CHANGED"，未给"读不到"；本文件按 **fail-closed** 折进同码，
 *     靠 reason 区分"读到但不等"／"快照失败"／"无校验期指纹"三子案。消费方对四码一律 fail-closed
 *     （`setAllowedTools([])`），故码精度差异不影响判定结果，只影响排障文案。
 *   · **KL-3 · 工厂三包工具全未落地**（规格 L1）：`analysis.*` 全仓 0 定义／0 注册 ⇒ 三包 `allowlist` 均空、
 *     `declaredUnavailable` 全量（finance 3／hr 2／sales 2）—— **如实暴露**，不假装能跑、也不静默丢弃；
 *     用户侧看到的是"声明未上线／权限待批"，不是假绿。补齐归后续内容批。
 *   · **KL-4 · `declaredUnavailable` 与 `disabled` 可重叠**：一个"既被禁用、又未注册"的工具会同时出现在
 *     两数组（前者语义＝"这轮没实现"，后者＝"这轮被关"）。消费方只用 `allowlist`／`disabled` 做放行判定，
 *     `declaredUnavailable` 是**可见性面**；重叠不是矛盾，是两种空因都要可见（禁静默合并）。
 *   · **KL-5 · 不判 `label`／`disabledReason`**：这两字段是审批面文案（P3 展示），不是授权判据；
 *     本文件只在 `disabled` 里透出能力 id，不回显文案（回显会把它变成第二套判据）。
 *   · **KL-6 · `approved` 缺 `permissionsPending`／`scope` ⇒ 按 `false`／`'content'`**：P2-1 的
 *     `RolePackApproval` 契约规定 `approved` **必带**这两字段，故该形态属契约外；D4 要求"只读字段、不自行
 *     推导"，故本文件**不**把它改判成 `CAPABILITIES_INVALID`（不自造码），只在 KL 里点名该残口。
 *   · **KL-7 · 不缓存**（规格 L5）：每轮 `loadRolePacks()` 全角色扫描 ＋ 六件单读 ＋ capabilities 解析；
 *     属"改文件即生效"的代价（正确性优先，D7）。规模变大需另卡加缓存（缓存键须含 `contentHash`）。
 *   · **KL-8 · 缺省值的两处口径**：`capabilities` 键缺省 ⇒ 按 **0 条**（与 `preset-loader.detectToolDeclarations()`
 *     的"无声明"同口径，且 §4.5-C2 明定"0 条合法"，故不按 v3 schema 的 `minItems: 1` 拒）；
 *     条目缺 `enabled` ⇒ 按 **`true`**（C2 只把"`enabled:false` 项"算禁用，缺省不静默禁用）。
 *     两处均与此件 `$defs.capabilities` 的 required 有差异，**以本规格 C2 为准**并在此点名。
 *   · **KL-9 · 不是安全边界**（规格 L7）：能改文件者仍可改包并重走审批（零门槛）；本模块是**工作流闸**，
 *     不是沙箱。抗伪造／取证归 P3，签名清单归 P4。
 */
import { createLogger } from '@synova/logger';
import { load as parseYaml } from 'js-yaml';
import { join } from 'path';
import { loadRolePacks } from './preset-loader';
import { readPieceBytesOnce } from './role-pack-persona';
import { computeRolePackContentHash } from './role-pack-schema';

const log = createLogger('init/role-pack-permissions');

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约常量（与规格 §2.3／§4.5-C2 一一对应；改值须同批改测试）
// ══════════════════════════════════════════════════════════════════════════════

/** 能力清单件名（六件之一；本文件唯一的解析对象） */
const CAPABILITIES_FILE = 'capabilities.yaml';

/**
 * 角色目录名（相对内容根）。🔴 P2-1 的 `ROLES_SUBDIR` **未导出** ⇒ 本文件用字面量（同 P2-2 L9／P2-3 KL-9）。
 * 漂移可观测：`loadRolePacks()` 只在 `join(root,'roles')` 下发现角色 ⇒ 若本字面量不同，
 * `readPieceBytesOnce()` 必 ENOENT ⇒ 第③步返回 `E_ROLE_PACK_CONTENT_CHANGED`（fail-loud，不静默空）。
 */
const ROLES_SUBDIR = 'roles';

/** `capabilities[]` 条数上限（规格 §4.5-C2：64 过／65 拒；0 条合法） */
const CAPABILITIES_MAX_ITEMS = 64;

/** 单个 `capabilities[].tool` 名字符上限（规格 §4.5-C2：120 过／121 拒） */
const TOOL_NAME_MAX_CHARS = 120;

/** `capabilities.yaml` **原始字节**上限（规格 §4.5-C2：64 KiB 过／+1 拒；**先于解析**判，不截断） */
const CAPABILITIES_MAX_BYTES = 64 * 1024;

/**
 * P2-1 审批门的「记录指纹 ≠ 实测指纹」拒绝码（`src/init/role-pack-approval.ts:182` 的
 * `ApprovalRejectCode` 成员；该类型**未导出** ⇒ 此处用字面量，并以此注释指明唯一出处）。
 * 用途：映射成本模块更具体的 `E_ROLE_PACK_CONTENT_CHANGED`（判定序②a）。
 */
const APPROVAL_CODE_CONTENT_CHANGED = 'E_APPROVAL_CONTENT_CHANGED';

/** 审批粒度（= P2-1 `RolePackApproval.scope` 的取值域；本文件只**透出**，不推导 —— D4） */
type RolePackScope = 'content' | 'content+permissions';

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型（字段级契约 ＝ 规格 §2.3-A；只读，判别联合带 typed code）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一个岗位的工具权限编译结果（规格 §2.3-A；**全 readonly**，纯数据，无方法）。
 */
export interface RolePackToolPermissions {
  /** 角色 id（= 内容根下 `roles/` 的目录名） */
  readonly roleId: string;
  /** 放行清单：`capabilities[].tool` 中 **`enabled !== false` ∧ 已注册 ∧ 未被禁用** 的名字（去重，保声明序） */
  readonly allowlist: readonly string[];
  /**
   * 显式禁用项（`enabled:false`）：逐条记 **capability id**；该条若另声明 `tool`，再追加该 `tool`。
   * 🔴 出现在此集合里的 **tool 永不放行**（即使同时被其它 enabled 条目声明 —— **disabled 优先**）。
   */
  readonly disabled: readonly string[];
  /** 声明了 `tool` 但 ∉ `knownTools`（**未落地**；可见但不放行 —— 禁静默丢弃） */
  readonly declaredUnavailable: readonly string[];
  /** D4 单一判据：`pack.approval.permissionsPending === true`（**不自行推导**）；`true` ⇒ `allowlist` 恒空 */
  readonly permissionsPending: boolean;
  /** 审批粒度（`pack.approval.scope` 透出；缺省按 `'content'` 保守 —— KL-6） */
  readonly scope: RolePackScope;
}

/** 工具权限错误码（规格 §4.5-C1 的**四值**，逐一；**禁自造第三方码**） */
export type RolePackPermissionsCode =
  | 'E_ROLE_PACK_NOT_FOUND'
  | 'E_ROLE_PACK_NOT_APPROVED'
  | 'E_ROLE_PACK_CONTENT_CHANGED'
  | 'E_ROLE_PACK_CAPABILITIES_INVALID';

/** `loadRolePackPermissions()` 结果（判别联合；**不抛**） */
export type LoadRolePackPermissionsResult =
  | { readonly ok: true; readonly permissions: RolePackToolPermissions }
  | { readonly ok: false; readonly code: RolePackPermissionsCode; readonly reason: string };

/** 编译选项（`knownTools` = 已注册工具名原始清单；测试与 engine 共用同一注入缝） */
export interface LoadRolePackPermissionsOptions {
  /** 已注册工具名（生产 = `ToolRegistry.allToolNames()`；缺省 ⇒ 只做声明分类，`declaredUnavailable` 全量） */
  readonly knownTools?: readonly string[];
}

/** 内部：capabilities 分类结果（纯核；与对外 `permissions` 的三数组同形） */
type ClassifyOutcome =
  | {
      readonly ok: true;
      readonly allowlist: readonly string[];
      readonly disabled: readonly string[];
      readonly declaredUnavailable: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

// ══════════════════════════════════════════════════════════════════════════════
// 三、小工具（纯函数；不抛 —— 形状判定一律先过 `isRecord`）
// ══════════════════════════════════════════════════════════════════════════════

/** YAML 映射判断（`load()` 返回 `unknown`，一切按键访问前必须过此关） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 值的人读展示（`reason` 里点名用；**不用** `as`） */
function show(value: unknown): string {
  if (value === undefined) return '（缺省）';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `数组(${String(value.length)})`;
  return typeof value;
}

/** 异常的人读展示（`catch` 里点名原因用 —— 铁律 11/24：不吞） */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、纯核：解析并分类 capabilities.yaml（入参 = 第④步同一份快照字节；无 IO、不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 解析 `capabilities.yaml` 的**同一份快照字节**并分类成三数组（**disabled 优先**）。
 *
 * 归因顺序（失败一律 `{ok:false, reason}`，由调用方折成 `E_ROLE_PACK_CAPABILITIES_INVALID`）:
 *   ⓪ `> 64 KiB` ⇒ 拒（**先于解析**，绝不"读进来再截"）；
 *   ① YAML 失败（含重复键 —— `js-yaml` 抛）⇒ 拒；
 *   ② 顶层非映射 ⇒ 拒；`capabilities` 缺省/null ⇒ **0 条**（合法，KL-8）；非数组 ⇒ 拒；条数 >64 ⇒ 拒；
 *   ③ 逐条：非映射／`id` 非非空串／`tool` 非 string 或空或 >120 字符／`enabled` 非 boolean ⇒ 拒
 *      （reason 点名 `capabilities[i].字段`；**不截断、不猜**）；
 *   ④ 分类：
 *      · `declaredTools` = 所有声明了 `tool` 的条目（去重、保声明序）；
 *      · `disabled` = `enabled:false` 条目（**先记 capability id**，该条另声明 tool 时再追加 tool）；
 *      · `allowlist` = `declaredTools` 中 ∈ `knownTools` 且 ∉ 禁用 tool 集者（**disabled 优先**）；
 *      · `declaredUnavailable` = `declaredTools` 中 ∉ `knownTools` 者（与 enabled 无关 —— KL-4）；
 *        `knownTools` 缺省 ⇒ 全量（规格 §2.3-B.5）。
 *
 * @param bytes - `capabilities.yaml` 的原始字节（**来自六件快照，禁再读盘**）
 * @param capabilitiesPath - 点名用的绝对路径（只进 reason，不做 IO）
 * @param knownTools - 已注册工具名清单（`undefined` ⇒ 不做注册侧交集，`declaredUnavailable` 全量）
 * @returns `{ok:true, allowlist, disabled, declaredUnavailable}` 或 `{ok:false, reason}`
 * @degraded 不抛：全部失败形态折成 `{ok:false, reason}`（调用方单点 `log.warn` ＋ typed code）
 */
function classifyCapabilities(
  bytes: Buffer,
  capabilitiesPath: string,
  knownTools: readonly string[] | undefined,
): ClassifyOutcome {
  // ⓪ 字节上限（先于解析；YAML 锚点膨胀也挡不住"文件小 ≠ 结构小" ⇒ ③ 另有条数闸）
  if (bytes.length > CAPABILITIES_MAX_BYTES) {
    return {
      ok: false,
      reason:
        `${capabilitiesPath}: ${String(bytes.length)} B > 上限 ${String(CAPABILITIES_MAX_BYTES)} B` +
        '（64 KiB；未进入解析 —— 规格 §4.5-C2）',
    };
  }

  // ① YAML（重复键抛 ⇒ 折成 INVALID，不静默取最后一个）
  let doc: unknown;
  try {
    doc = parseYaml(bytes.toString('utf8'));
  } catch (err: unknown) {
    return {
      ok: false,
      reason: `${capabilitiesPath}: YAML 解析失败（重复键亦在此拦）— ${describeError(err)}`,
    };
  }

  // ② 顶层与条数
  if (!isRecord(doc)) {
    return { ok: false, reason: `${capabilitiesPath}: 顶层必须是映射对象，实为 ${show(doc)}` };
  }
  const rawCapabilities = doc['capabilities'];
  let items: readonly unknown[];
  if (rawCapabilities === undefined || rawCapabilities === null) {
    items = []; // 缺省 ⇒ 0 条（KL-8：与 detectToolDeclarations 的"无声明"同口径）
  } else if (!Array.isArray(rawCapabilities)) {
    return {
      ok: false,
      reason: `${capabilitiesPath}: capabilities 必须是数组，实为 ${show(rawCapabilities)}`,
    };
  } else {
    items = rawCapabilities;
  }
  if (items.length > CAPABILITIES_MAX_ITEMS) {
    return {
      ok: false,
      reason:
        `${capabilitiesPath}: capabilities ${String(items.length)} 条 > 上限 ` +
        `${String(CAPABILITIES_MAX_ITEMS)}（不截断 —— 规格 §4.5-C2）`,
    };
  }

  // ③ 逐条形状 ＋ ④ 分类（一趟遍历，保持声明顺序）
  const declaredTools: string[] = [];
  const disabled: string[] = [];
  const disabledTools = new Set<string>();

  for (let index = 0; index < items.length; index += 1) {
    const item: unknown = items[index];
    const at = `capabilities[${String(index)}]`;
    if (!isRecord(item)) {
      return { ok: false, reason: `${capabilitiesPath}: ${at} 必须是映射对象，实为 ${show(item)}` };
    }

    // id（必填；`disabled` 里点名能力用）
    const idRaw = item['id'];
    if (typeof idRaw !== 'string' || idRaw.trim().length === 0) {
      return {
        ok: false,
        reason: `${capabilitiesPath}: ${at}.id 必须是非空字符串，实为 ${show(idRaw)}`,
      };
    }
    const capabilityId = idRaw;

    // tool（可选；出现即判形状与长度）
    const toolRaw = item['tool'];
    let tool: string | undefined;
    if (toolRaw !== undefined && toolRaw !== null) {
      if (typeof toolRaw !== 'string') {
        return {
          ok: false,
          reason: `${capabilitiesPath}: ${at}.tool 必须是 string，实为 ${show(toolRaw)}`,
        };
      }
      if (toolRaw.trim().length === 0) {
        return {
          ok: false,
          reason: `${capabilitiesPath}: ${at}.tool 空/纯空白（声明了就必须给可调用的工具名）`,
        };
      }
      if (toolRaw.length > TOOL_NAME_MAX_CHARS) {
        return {
          ok: false,
          reason:
            `${capabilitiesPath}: ${at}.tool ${String(toolRaw.length)} 字符 > 上限 ` +
            `${String(TOOL_NAME_MAX_CHARS)}（不截断 —— 规格 §4.5-C2）`,
        };
      }
      tool = toolRaw;
    }

    // enabled（缺省 ⇒ true；非 boolean ⇒ 非法 —— KL-8）
    const enabledRaw = item['enabled'];
    let enabled = true;
    if (enabledRaw !== undefined && enabledRaw !== null) {
      if (typeof enabledRaw !== 'boolean') {
        return {
          ok: false,
          reason: `${capabilitiesPath}: ${at}.enabled 必须是 boolean，实为 ${show(enabledRaw)}`,
        };
      }
      enabled = enabledRaw;
    }

    if (tool !== undefined && !declaredTools.includes(tool)) declaredTools.push(tool);

    if (!enabled) {
      // disabled：**能力 id 必记**（点名用），该条另声明 tool 时再追加 tool（C2／J3 的可读面）
      if (!disabled.includes(capabilityId)) disabled.push(capabilityId);
      if (tool !== undefined) {
        disabledTools.add(tool);
        if (!disabled.includes(tool)) disabled.push(tool);
      }
    }
  }

  const allowlist: string[] = [];
  const declaredUnavailable: string[] = [];
  for (const tool of declaredTools) {
    const registered = knownTools !== undefined && knownTools.includes(tool);
    if (!registered) {
      // 未落地 ⇒ 可见（**禁静默丢弃**），且永不进 allowlist
      declaredUnavailable.push(tool);
      continue;
    }
    if (disabledTools.has(tool)) continue; // 🔴 disabled 优先：显式关掉的工具即使有 enabled 声明也不放行
    allowlist.push(tool);
  }

  return { ok: true, allowlist, disabled, declaredUnavailable };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、IO 壳：对外入口（判定顺序逐条短路 —— 规格 §2.3-B；同步、不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 编译某岗位的工具白名单（**同步、不抛**；判定顺序见文件头）。
 *
 * @param roleId - 岗位 id（形状/白名单校验归路由层；本文件只按装载清单精确匹配，故无路径穿越面）
 * @param opts - `{knownTools?}`：已注册工具名原始清单（生产 = `ToolRegistry.allToolNames()`）
 * @returns `{ok:true, permissions}` 或 `{ok:false, code, reason}`（四码表：NOT_FOUND／NOT_APPROVED／
 *          CONTENT_CHANGED／CAPABILITIES_INVALID）
 *
 * @degraded 任一失败 ⇒ 一条 `log.warn`（`{roleId, code, reason, degraded:true}`）＋ typed 结果；
 *           成功但有可见降级（`declaredUnavailable`／`disabled`／`permissionsPending`）各留一条 warn。
 *           消费方（engine）对 `ok:false` 与"`permissionsPending===true`"一律 **fail-closed**
 *           （`setAllowedTools([])`），故本函数永不"放行式降级"。
 * @authority 生产唯一调用方 = `src/agent/conversation-engine.ts` 的 `applyRolePackPermissions()`。
 */
export function loadRolePackPermissions(
  roleId: string,
  opts: LoadRolePackPermissionsOptions = {},
): LoadRolePackPermissionsResult {
  /**
   * 统一的失败出口（单点 `log.warn` ＋ typed 结果 —— 铁律 11/24/31：不静默、不吞）。
   * 放在函数内的唯一理由：它能捕获本次调用的 `roleId`（不额外传参）。
   */
  const reject = (code: RolePackPermissionsCode, reason: string): LoadRolePackPermissionsResult => {
    log.warn(
      { roleId, code, reason, degraded: true },
      '岗位工具权限不可用 — 本轮白名单按全拒处理（typed code；fail-closed）',
    );
    return { ok: false, code, reason };
  };

  // ① 装载清单（无缓存语义：改文件即生效 —— 规格 L5）
  const report = loadRolePacks();
  const pack = report.roles.find((candidate) => candidate.roleId === roleId);
  if (pack === undefined) {
    return reject(
      'E_ROLE_PACK_NOT_FOUND',
      `岗位包不存在: ${JSON.stringify(roleId)}（内容根 ${report.root}；已装载 ${String(report.roles.length)} 个岗位）`,
    );
  }

  // ② 审批门（permissionsPending 的**唯一数据源**同在此对象 —— D4：只读，不自行推导 scope）
  if (pack.approval.status !== 'approved') {
    if (pack.approval.code === APPROVAL_CODE_CONTENT_CHANGED) {
      return reject(
        'E_ROLE_PACK_CONTENT_CHANGED',
        `${roleId}: 六件内容与审批记录不符 — 审批门 code=${APPROVAL_CODE_CONTENT_CHANGED}；` +
          `${pack.approval.reason ?? '（无原因）'}（修改后须重新审批；本轮全拒）`,
      );
    }
    const hint = pack.approval.code ?? pack.approval.reason ?? '（无记录/无原因）';
    return reject(
      'E_ROLE_PACK_NOT_APPROVED',
      `${roleId}: 审批态 ${pack.approval.status} — ${hint}（未批准 ⇒ 工具白名单不可用于放行）`,
    );
  }

  // ③ 六件单读快照（复用 P2-2 的唯一实现；roleDir 由 ① 的 report.root 推导 —— **不二次 load**）
  const roleDir = join(report.root, ROLES_SUBDIR, roleId);
  const snapshot = readPieceBytesOnce(roleDir);
  if (!snapshot.ok) {
    // 稳态不可达（validation 失败 ⇒ 审批 unverified ⇒ ②已拦）；此处只兜 load↔snapshot 的 TOCTOU 窗口
    return reject(
      'E_ROLE_PACK_CONTENT_CHANGED',
      `${roleDir}: 六件单读快照失败（load↔snapshot 窗口）— ${snapshot.code}: ${snapshot.reason}` +
        '（内容不可复核 ⇒ 按"已变"处理，本轮全拒 —— KL-2）',
    );
  }
  const expectedHash = pack.validation.contentHash;
  if (expectedHash === undefined) {
    return reject(
      'E_ROLE_PACK_CONTENT_CHANGED',
      `${roleId}: 审批 approved 却无校验期 contentHash（不可判内容是否被改；load↔snapshot 窗口 —— KL-2）`,
    );
  }
  const computedHash = computeRolePackContentHash(snapshot.pieces);
  if (computedHash !== expectedHash) {
    return reject(
      'E_ROLE_PACK_CONTENT_CHANGED',
      `${roleId}: 六件内容已变 — 磁盘 ${computedHash} ≠ 校验期 ${expectedHash}（修改后须重新审批；本轮全拒）`,
    );
  }

  // ④ 从**同一份快照**取 capabilities.yaml 字节（禁二读，封 TOCTOU）
  const capabilitiesPath = join(roleDir, CAPABILITIES_FILE);
  const capabilitiesBytes = snapshot.pieces.find((piece) => piece.name === CAPABILITIES_FILE)?.bytes;
  if (capabilitiesBytes === undefined) {
    return reject(
      'E_ROLE_PACK_CAPABILITIES_INVALID',
      `${capabilitiesPath}: 单读快照缺该件（六件集合不完整；load↔snapshot 窗口）`,
    );
  }

  // ⑤ 解析 ＋ 分类（纯核）
  const classified = classifyCapabilities(capabilitiesBytes, capabilitiesPath, opts.knownTools);
  if (!classified.ok) return reject('E_ROLE_PACK_CAPABILITIES_INVALID', classified.reason);

  // ⑥ 生效门槛（D4 单一判据：只读既有字段，**不自行推导**）
  const permissionsPending = pack.approval.permissionsPending === true;
  const scope: RolePackScope = pack.approval.scope ?? 'content'; // KL-6：approved 必有；缺省保守
  const allowlist = permissionsPending ? [] : classified.allowlist;

  // ⑦ 可见性留痕（禁静默丢弃 —— 三种"空"各自点名，绝不塌成一个"没有工具"）
  if (classified.declaredUnavailable.length > 0) {
    log.warn(
      {
        roleId,
        declaredUnavailable: classified.declaredUnavailable,
        count: classified.declaredUnavailable.length,
        degraded: true,
      },
      '岗位包声明了未注册的工具 — 不入白名单（可见，不静默丢弃；补齐归后续内容批）',
    );
  }
  if (classified.disabled.length > 0) {
    log.warn(
      { roleId, disabled: classified.disabled, count: classified.disabled.length },
      '岗位包存在被显式禁用的能力 — 永不放行（disabled 优先）',
    );
  }
  if (permissionsPending) {
    log.warn(
      { roleId, scope, degraded: true },
      '岗位权限待批（scope=content）— 工具白名单为空，本轮全拒（D4）',
    );
  }
  log.info(
    {
      roleId,
      scope,
      permissionsPending,
      allowlist: allowlist.length,
      disabled: classified.disabled.length,
      declaredUnavailable: classified.declaredUnavailable.length,
      knownTools: opts.knownTools === undefined ? null : opts.knownTools.length,
    },
    '岗位工具权限已编译（白名单/禁用/未落地）',
  );

  return {
    ok: true,
    permissions: {
      roleId,
      allowlist,
      disabled: classified.disabled,
      declaredUnavailable: classified.declaredUnavailable,
      permissionsPending,
      scope,
    },
  };
}
