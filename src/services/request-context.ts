/**
 * services/request-context.ts — 请求级上下文 (M2 权限透传) ＋ **身份/部门轴单一入口**（K12-10 / #193 / RB-02）
 *
 * 问题: KnowledgeAgent 工具执行时无法获取当前用户的 UserContext，
 *       导致 search_documents 无法生成 FilterClause，权限过滤失效。
 *
 * 方案: 使用 AsyncLocalStorage 存储请求级上下文。
 *       L1 (routes) 设置 → L3 (tools) 读取，不通过 LLM 参数传递。
 *
 * ── K12-10 / #193（RB-02）本件新增职责：**部门轴**（部门级＝知识分层第二层）──
 *
 * ① **复数**：一人**可属多个部门** ⇒ 身份面唯一口径是 `departmentIds?: string[]`。
 *    `departmentId`（单数）/ `departments`（别名）**只作兼容入参**，解析后被归一到复数集合。
 * ② **文件驱动真源**：部门定义在 `extensions/departments/<id>.yaml`
 *    （id ＝ 文件名去扩展名）⇒ **加一个部门 = 加一个文件，不改代码**。
 * ③ **单一入口**：`resolveContext(identity)` 是**唯一**从原始身份推导部门范围的地方。
 *    除它以外，本模块任何导出**不得**再读原始身份的部门字段 ——
 *    多入口 = 各岗位各读各的 ⇒ 同一事实在不同人那里不一样（一致性从根上破）。
 *    判据由 `scripts/control-tower/probe-department-axis.ts --case single-entry` **行为观测**给出
 *    （身份探针 getter 记读次数；判例 V-02：grep 型不得作验收依据）。
 *
 * 边界（本层只算不执行）：本件**不拦任何动作** —— 只算"本次身份可见的部门集合是什么"。
 *   拆掉本层 ⇒ 无法解析 ⇒ 执行层无依据 ⇒ 应拒全拒（更安全）。
 */
import { AsyncLocalStorage } from 'async_hooks';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';
import { createLogger } from '@synova/logger';

const log = createLogger('services/request-context');

// 内联类型 — 避免跨包 tsc 路径解析问题 (engine-auth 不在 tsc include 范围内)
// D947: `FilterClause.operator` 由 `string` 收窄为与 `l4/knowledge-store.FilterClause`
//   相同的字面量联合——两者必须**结构等价**，否则漏斗产出无法直接喂给
//   `KnowledgeStore.search()`（实际 L4 引擎），必须在调用点写断言=类型级漏斗失守。
interface UserContext { userId: string; identity: { openId: string; email: string; name: string; source: string }; auth: { roles: string[]; teamId: string; tenantId: string; sensitivity: string }; permissions: { version: number; expiresAt: number }; }
interface AuthProvider { getPermissionFilter(ctx: UserContext, resourceType: string, action: string): Promise<FilterClause>; }
interface FilterClause { conditions: Array<{ field: string; operator: 'IN' | 'EQ' | 'NOT_EQ' | 'CONTAINS'; value: unknown }>; }

const storage = new AsyncLocalStorage<RequestContext>();

export interface RequestContext {
  user?: UserContext;
  authProvider?: AuthProvider;
  /**
   * K12-10: 由 `resolveContext()`（**单一入口**）算出的身份/部门范围。
   * 消费方一律读这里 —— 不得再从原始身份对象自行推导。
   */
  resolved?: ResolvedContext;
}

/** L1 调用: 设置当前请求的上下文 */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** L3 调用: 获取当前请求的用户身份 */
export function getCurrentUser(): UserContext | undefined {
  return storage.getStore()?.user;
}

/** L3 调用: 获取当前请求的 AuthProvider */
export function getCurrentAuthProvider(): AuthProvider | undefined {
  return storage.getStore()?.authProvider;
}

/**
 * L3 调用: 获取本次身份**生效**的部门 id（复数）。
 *
 * 契约（铁律 47）:
 * - 输入: 无（读请求级存储）。
 * - 输出: `resolveContext()` 算出的 `departments`；无上下文 ⇒ `[]`
 *   （**不是**"全部门" —— 无身份 ⇒ 无部门，与 fail-closed 同向）。
 * - 降级: 不适用（纯读；无上下文不是故障，不记 degraded）。
 * - 前提: 只读**已解析结果**。若上游未经 `resolveContext()` 直接用 `runWithContext()`
 *   塞入身份，则本函数返回 `[]` —— 这是**刻意的**：绕过单一入口 ⇒ 拿不到部门范围
 *   （fail-closed，不静默补算）。
 */
export function getCurrentDepartmentIds(): readonly string[] {
  return storage.getStore()?.resolved?.departments ?? [];
}

// ════════════════════════════════════════════════════════════════
// K12-10 / #193（RB-02）: 部门轴 —— 复数 ＋ 文件驱动真源 ＋ 单一入口
// ════════════════════════════════════════════════════════════════

/** 部门定义真源目录名（仓内 `extensions/<本名>`；判据探针按 extensions/ 下 depart|org|identity|team|struct 匹配） */
const DEPARTMENTS_DIR = 'departments';

/** 部门定义文件扩展名（部门 id ＝ 文件名去扩展名 —— 与 manifest.idRule 同口径） */
const DEPARTMENT_FILE_RE = /\.(ya?ml|json)$/i;

/** 部门定义真源缺失的降级原因前缀（调用方据此判定"文件面未就位"而非"身份非法"） */
const DEPT_SOURCE_MISSING = 'DEPT_SOURCE_MISSING';

/**
 * 解析单一入口的入参（身份对象；见 `resolveContext` 的 @input）。
 *
 * 🔴 `departmentId` / `departments` 是**兼容入参**（单数历史形态 ＋ 别名），不是第二口径：
 *   两者都只用于**取到候选 id**，取到后立刻归一进复数集合 —— 不留下任何单数语义。
 */
export interface IdentityInput {
  /** 部门身份（**复数** —— 唯一正式口径。一人可属多部门） */
  readonly departmentIds?: readonly string[];
  /** 兼容入参：部门身份单数形态（历史写法 `departmentId`）—— 解析时视为单元素集合 */
  readonly departmentId?: string;
  /** 兼容入参：`departmentIds` 的等价别名 */
  readonly departments?: readonly string[];
  /** 用户 id（进 `ResolvedContext.identityKey`，供审计/留痕） */
  readonly userId?: string;
  /** 部门定义真源仓根（依赖注入缝，缺省 `process.cwd()`；生产不传） */
  readonly rootDir?: string;
}

/** 单个部门的解析结果（叶子字段逐字来自 `extensions/departments/<id>.yaml`） */
export interface ResolvedDepartment {
  /** 部门 id（＝ 文件名去扩展名） */
  readonly id: string;
  readonly displayName: string;
  /** 上级部门 id；未声明 ⇒ null */
  readonly parent: string | null;
  readonly description: string;
}

/** `resolveContext()` 的输出（见其 @output） */
export interface ResolvedContext {
  /**
   * 本次身份**请求**的部门 id（按入参顺序去重；含**未知** id —— 未知也是"请求过"的事实，
   * 与 `departments` 分开，使"请求了但未生效"可被观测，不被静默抹掉）。
   */
  readonly requestedDepartments: readonly string[];
  /**
   * 本次身份**生效**的部门集合（＝ 请求 id ∩ 真源已知 id，**并集语义**，按 requested 顺序去重）。
   *
   * 🔴 不变式: `departments ⊆ requestedDepartments` ＋
   *   `departments(A ∪ B) ⊇ departments(A) ∪ departments(B)`（多部门 = 并集，**非覆盖**）。
   *   空请求 ⇒ 空集合（**不得**退化为"默认给全量"＝越权）。
   */
  readonly departments: readonly string[];
  /** 生效部门对应的定义（顺序与 `departments` 一致） */
  readonly profiles: readonly ResolvedDepartment[];
  /** 可观测的身份键（缺省 undefined —— 不伪造） */
  readonly identityKey?: string;
  /** 真降级标记（铁律 11/24/31：不可静默） */
  readonly degraded: boolean;
  /** 降级/失败原因（**数组** —— 铁律 31 不丢信号；正常路径为空数组） */
  readonly degradedReasons: readonly string[];
}

/** 已知部门定义（id → 定义）＋ 加载期降级原因 */
interface DepartmentRegistry {
  readonly byId: ReadonlyMap<string, ResolvedDepartment>;
  readonly degradedReasons: readonly string[];
  /** 是否读到过部门定义文件（false ⇒ 真源未就位；true 且 byId 空 ⇒ 文件都在但都坏了） */
  readonly sourceFound: boolean;
}

/** 定义文件解析结果的内部三态 */
type DepartmentFileLoad =
  | { readonly kind: 'ok'; readonly profile: ResolvedDepartment }
  | { readonly kind: 'error'; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** 部门 id 合法性（与探针可观测口径一致：字母/数字/`_`/`-`/`.`，非空） */
const DEPARTMENT_ID_RE = /^[A-Za-z0-9_.-]+$/;

/** 单份部门定义文件 → `ResolvedDepartment`（字段缺失/类型不符 ⇒ 显式降级，不静默） */
function toDepartmentProfile(path: string, stem: string, raw: unknown): DepartmentFileLoad {
  if (!isRecord(raw)) {
    return { kind: 'error', message: `部门定义非对象（${path}）` };
  }
  const declared = optionalString(raw.id);
  if (declared !== undefined && declared !== stem) {
    // id 与文件名不一致 ⇒ 部门轴出现两个真值 ⇒ 拒绝该文件（不猜哪个对）
    return {
      kind: 'error',
      message: `部门 id 与文件名不一致（${path}：id=${declared} / 文件名=${stem}）⇒ 拒绝该定义`,
    };
  }
  const displayName = optionalString(raw.displayName) ?? optionalString(raw.name) ?? stem;
  const description = optionalString(raw.description) ?? '';
  const parentRaw = raw.parent;
  const parent = optionalString(parentRaw) ?? null;
  return { kind: 'ok', profile: { id: stem, displayName, parent, description } };
}

/**
 * 读取部门定义真源（`extensions/departments/<id>.{yaml,yml,json}`）。
 *
 * 契约（铁律 47）:
 * - 输入: `deptDir`（绝对路径）。
 * - 输出: `{ byId, degradedReasons, sourceFound }`；**每次调用真读文件、不做缓存**
 *   —— 缓存会让「加文件即生效」失效（K12-20 同纪律）。
 * - 降级（铁律 11/24/31，不静默）: 目录不可读 / 文件解析失败 / id 与文件名不一致
 *   ⇒ 只跳过该文件 ＋ `log.warn` ＋ 原因进 `degradedReasons`；**不抛出、不阻断**
 *   （与 content-layering 同构：「单层失败只跳过该层」）。
 * - 边界: 目录不存在 ⇒ `sourceFound=false`（真源未就位，由调用方记 DEPT_SOURCE_MISSING）。
 */
function loadDepartmentRegistry(deptDir: string): DepartmentRegistry {
  const byId = new Map<string, ResolvedDepartment>();
  const degradedReasons: string[] = [];
  if (!existsSync(deptDir)) {
    return { byId, degradedReasons, sourceFound: false };
  }

  let entries;
  try {
    entries = readdirSync(deptDir, { withFileTypes: true });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn({ err: detail, deptDir }, '部门定义目录不可读 — 部门轴退化为空集合（降级）');
    degradedReasons.push(`${DEPT_SOURCE_MISSING}: 部门定义目录不可读（${deptDir}：${detail}）`);
    return { byId, degradedReasons, sourceFound: true };
  }

  let sourceFound = false;
  for (const entry of entries) {
    if (!entry.isFile() || !DEPARTMENT_FILE_RE.test(entry.name)) continue;
    sourceFound = true;
    const stem = entry.name.replace(DEPARTMENT_FILE_RE, '');
    const abs = join(deptDir, entry.name);
    if (!DEPARTMENT_ID_RE.test(stem)) {
      log.warn({ file: abs, stem }, '部门定义文件名非法（id 口径）— 跳过该文件（降级）');
      degradedReasons.push(`部门定义文件名非法（${abs}：stem=${stem}）`);
      continue;
    }
    let raw: unknown;
    try {
      const text = readFileSync(abs, 'utf8');
      raw = /\.json$/i.test(entry.name) ? JSON.parse(text) : parseYaml(text);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
      log.warn({ err: detail, file: abs }, '部门定义文件读取/解析失败 — 跳过该文件（降级）');
      degradedReasons.push(`部门定义文件读取或解析失败: ${abs}（${detail}）`);
      continue;
    }
    const loaded = toDepartmentProfile(abs, stem, raw);
    if (loaded.kind === 'ok') {
      byId.set(stem, loaded.profile);
    } else {
      log.warn({ file: abs, reason: loaded.message }, '部门定义不可用 — 跳过该文件（降级）');
      degradedReasons.push(loaded.message);
    }
  }
  return { byId, degradedReasons, sourceFound };
}

/**
 * 从原始身份提取**候选**部门 id（复数，按入参顺序去重、丢空值）。
 *
 * 🔴 这是**唯一**读原始身份部门字段的地方（由 `resolveContext` 调用）。
 *   兼容入参 `departmentId`（单数）/ `departments`（别名）在此被归一 —— 归一之后
 *   全流程只见复数集合，单数语义不外溢。
 *
 * @input  — IdentityInput ｜ @output — 候选 id（含未知 id）｜ @degraded — 不适用（纯提取）
 */
function requestedDepartmentIds(input: IdentityInput): string[] {
  const out: string[] = [];
  const push = (raw: unknown): void => {
    const id = optionalString(raw);
    if (id !== undefined && !out.includes(id)) out.push(id);
  };
  if (Array.isArray(input.departmentIds)) for (const raw of input.departmentIds) push(raw);
  push(input.departmentId);
  if (Array.isArray(input.departments)) for (const raw of input.departments) push(raw);
  return out;
}

/**
 * 部门轴**唯一解析入口** —— 从原始身份算出本次可见的部门集合（复数，并集语义）。
 *
 * 契约（铁律 47）:
 * - **@input** — `IdentityInput`：`departmentIds?: string[]`（**正式口径，复数**）
 *   ｜`departmentId?: string`（兼容单数入参）｜`departments?: string[]`（等价别名）
 *   ｜`userId?: string`（进 identityKey）｜`rootDir?: string`（依赖注入缝，缺省 cwd）。
 *   入参**缺省/空对象合法**（探针会以空对象调用）⇒ 返回"无部门"结果，不抛。
 * - **@output** — `ResolvedContext`：`requestedDepartments`（请求到的，含未知）
 *   ＋ `departments`（**生效**的 ＝ 请求 ∩ 真源已知，**并集非覆盖**）
 *   ＋ `profiles`（叶子字段逐字来自定义文件）＋ `identityKey` ＋ `degraded` ＋ `degradedReasons`。
 * - **@degraded** — 两态**严格分开**（与 content-layering 同纪律）:
 *     · **正常路径**（`degraded=false`）：未知部门 id ⇒ 跳过（预期路径，**不记 reason**）；
 *       部门定义为空 ⇒ `departments=[]`（**不是**"给全量"）。
 *     · **真降级**（`degraded=true` ＋ reason ＋ `log.warn`）：部门定义真源目录不存在
 *       （原因以 `DEPT_SOURCE_MISSING` 开头）／目录不可读／定义文件解析失败／id 与文件名不一致。
 * - **@error** — 本函数**不抛**：所有失败都走 degraded 通道上报（铁律 31 信号向上传播，
 *   不阻断能力面）。异步签名是为将来可能的远端部门源留位，当前实现同步（真读文件）。
 *
 * 实现纪律: ① **真读文件**（无缓存 ⇒ 加/改部门文件即生效）；
 *   ② 除本函数外，本模块任何导出不得读原始身份的部门字段（单一入口）。
 */
export async function resolveContext(input: IdentityInput = {}): Promise<ResolvedContext> {
  const root = optionalString(input.rootDir) ?? process.cwd();
  const deptDir = join(root, 'extensions', DEPARTMENTS_DIR);
  const registry = loadDepartmentRegistry(deptDir);

  const degradedReasons: string[] = [...registry.degradedReasons];
  if (!registry.sourceFound) {
    const message = `${DEPT_SOURCE_MISSING}: 部门定义真源不存在（extensions/${DEPARTMENTS_DIR}，root=${root}）`;
    log.warn({ deptDir }, '部门定义真源不存在 — 部门轴解析为空集合（降级，未静默）');
    degradedReasons.push(message);
  }

  const requested = requestedDepartmentIds(input);
  const departments: string[] = [];
  const profiles: ResolvedDepartment[] = [];
  for (const id of requested) {
    const profile = registry.byId.get(id);
    if (profile === undefined) continue; // 未知部门 ⇒ 正常跳过（预期路径，不记 reason）
    departments.push(profile.id);
    profiles.push(profile);
  }

  const userId = optionalString(input.userId);
  return {
    requestedDepartments: requested,
    departments,
    profiles,
    ...(userId === undefined ? {} : { identityKey: userId }),
    degraded: degradedReasons.length > 0,
    degradedReasons,
  };
}

// ════════════════════════════════════════════════════════════════
// D947 / L-21: 无上下文时的 fail-closed 拒绝型条件集
// ════════════════════════════════════════════════════════════════

/**
 * 拒绝型（deny-all）条件集常量。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: 无。纯常量。
 * - 输出: **非空** conditions；字段名不存在于任何知识块的权限列
 *   （`l4/knowledge-store.ts` 的 `matchFilter` 用 `row[col]` 取值 ⇒ 恒 `undefined`），
 *   配合 `EQ` 与哨兵值 `undefined !== DENY_ALL_SENTINEL` ⇒ 每一行都判 false。
 * - 降级: 不适用（无 IO、无异常路径）。
 *
 * Why 非空：`l4/knowledge-store.ts:195` / `:335` 在 `filter.conditions.length === 0`
 * 时**完全跳过过滤**（`? rows : rows.filter(...)`）——空条件集 = 不过滤 = fail-open。
 * 故此处**不得**返回空条件集，也**不得**返回允许型条件。
 */
const DENY_ALL_FIELD = '__d947_no_authenticated_context';
const DENY_ALL_SENTINEL = '__d947_deny_all__';

/**
 * L3 调用: 生成当前用户的权限过滤条件。
 *
 * D947 / L-21（安全项）: 无请求上下文时**必须 fail-closed**。
 * 触发场景（实测）: 白名单路径（`middleware/auth.ts isWhitelisted`）不经过
 * `runWithContext` ⇒ 即使 L-20 已注入 `req.auth`，该分支仍无 authProvider
 * ⇒ 本函数落回兜底。`/api/knowledge/ask` 正在白名单内 ⇒ 旧兜底（空条件集）
 * 会让知识检索经白名单路径拿到**无过滤**结果（fail-open）。
 */
export async function getCurrentFilterClause(resourceType: string): Promise<FilterClause> {
  const ctx = storage.getStore();
  // K12-10 加固（实测，非预防性）: `resourceType` 非字符串 ⇒ 立即 fail-closed。
  //   · 为什么: 旧实现把入参**原样**塞进 log.warn 的 meta（`{ resourceType }`）。
  //     探针行为观测（probe-department-axis --case single-entry）实测到：
  //     传一个**身份对象**进来时，该对象会被整份打印进日志 —— 身份面泄进日志面。
  //     （该次观测同时被误计为"第二个解析入口"：读的是入参、不是身份 —— 但**日志泄漏是真的**。）
  //   · 处置: 非字符串 ⇒ 只记录 **JS 类型**（不记录值），条件集语义**零变化**（仍为拒绝型）。
  if (typeof resourceType !== 'string') {
    log.warn(
      { code: 'RBAC_DENIED', reason: 'invalid_resource_type', resourceTypeJsType: typeof resourceType },
      '安全判据: 被拒绝 — resourceType 非字符串（fail-closed；**不回显入参值**，防身份面泄进日志面）',
    );
    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };
  }
  if (!ctx?.user || !ctx?.authProvider) {
    log.warn(
      { code: 'RBAC_DENIED', resourceType, reason: 'no_request_context' },
      '安全判据: 被拒绝 — 无请求上下文（漏斗兜底 fail-closed，返回拒绝型非空条件集）',
    );
    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };
  }
  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
}
