/**
 * engine-auth/permission-grants.ts — 权限**项**模型（K12-11 / #194 / RB-03）
 *
 * 一句话: 权限是「**一项一项勾**」（能看到什么 / 能做什么），**不是"五档套餐"**。
 *   五档（admin/manager/employee/viewer/external）**保留为出厂默认（L0）**，
 *   但**不是类型的一部分** —— 类型面只有 `PermissionId`（项）。
 *
 * 出处: 创始人 2026-10-05 —— 「权限不是 5 档，是一堆权限选择的模式」
 *   ＋ 登记件 `docs/synova/coordination/施工项登记.ts:1650`（RB-03，
 *     原文: 「五档保留为出厂默认，但**不是类型的一部分**」）。
 *
 * 🔴 解决什么问题（档位制太粗的实证场景）: 「财务能看全公司数据」这种要求，
 *   档位表达不了 ⇒ 客户只好"给高一级"（employee → manager）⇒ **权限只会越来越松**。
 *   项模型的答法是: 只勾 `knowledge.finance.read`，**不牵连**其它项。
 *
 * 分层（宪章 5.2「覆盖不是替换」）:
 *   L0 出厂默认 —— `FACTORY_ROLE_GRANTS`（本文件常量，改它要改代码）
 *   L2 客户可配 —— `extensions/presets/roles/<roleId>/{tenant/<tenantId>/}capabilities.yaml`
 *                 的 `permissionGrants` 段（**加文件即生效，不改代码**）
 *   合成规则: `生效 = (出厂默认 ∪ 包内 grants) − 包内 denies`
 *     ⇒ 包只做「加项」与「显式减项」，**不整包替换**（否则"覆盖"退化成"重写"，
 *       客户的包一旦落后于出厂版本，就会静默失去新默认项 —— 那是 fail-open 方向）。
 *
 * 🔴 本文件**不含任何角色硬编码判定**（除出厂默认常量本身）: 角色能力一律从
 *   `capabilities.yaml` 真读磁盘 ⇒ 「加文件即生效」；**不做进程级缓存**
 *   （缓存会让该语义失效 —— 同 `src/init/preset-loader.ts` 的纪律）。
 *
 * DSH 依据（借鉴面 / 自研面，逐条说明，别假借）:
 *   · ✅ 借: **按名声明能力，宿主满足** —— `packages/settings/settings/src/index.ts:224`
 *     （`static inject = ['configEditor','profileContext']`）。角色"需要哪些能力"
 *     在这里就是 `PermissionId[]` 按名声明。
 *   · ✅ 借: **出厂默认与客户配置分层（覆盖非替换）** —— 宪章 5.2 四层覆盖。
 *   · ⚠️ **自研**: **DSH 没有权限模型** —— 本文件的项/授权/分层合成是我们自己的设计，
 *     不得声称"照 DSH 抄的"。
 *
 * 契约（铁律 47）:
 *   @input    — `roleId: string`（必填）；`tenantId: string`（可选，客户槽）；
 *               `root`（可选，内容根注入缝，缺省 `process.cwd()` + `SYNOVA_PRESETS_ROOT` 覆盖）
 *   @output   — `ResolvedGrants`:
 *               · `items: PermissionId[]`（**展开后**的具体项，字典序，已过白名单校验）
 *               · `sources: { factory: PermissionId[]; packGrants: PermissionId[]; packDenies: PermissionId[] }`
 *                 （**来源可审计** —— 客户看得见"哪些是出厂给的、哪些是我配的"）
 *               · `packFile: string | null`（实际命中的包文件；null = 只有出厂默认）
 *               · `fallback: boolean`（true = 未命中任何包文件 ⇒ 回落出厂默认，**不是错误**）
 *               · `degraded: boolean` + `degradedReasons: string[]`（**真降级**才置位，
 *                 见下；回落**不**置位 —— 判例口径同 `content-layering`）
 *   @degraded — 两态**分开**（防"回落 ≡ 基线"判据被污染）:
 *               · **正常回落**（`fallback: true`、`degraded` 保持 false、不记 reason）:
 *                 角色包文件不存在 / 无 `permissionGrants` 段 / 目录不存在。
 *                 这是**预期路径**（五档＝出厂默认的全部意义）。
 *               · **真降级**（`degraded: true` + reason + `log.warn`，铁律 11/24/31）:
 *                 文件读到了但 YAML 解析失败 / 字段类型非法（`grants` 非数组等）。
 *               · **未知项**（`permissionId` 不在白名单）: **不抛**、不静默 ——
 *                 记入 `degradedReasons` 并**丢弃该项**（fail-closed: 认不出的项一律不授予；
 *                 若反过来"认不出就放行"，拼错一个 id 就等于自动提权）。
 *
 * 退出/降级面: 本模块**从不抛**（除参数类型非法 ⇒ 由调用方类型守卫挡）。IO 失败走
 *   `degraded` 通道，调用方（`src/middleware/auth.ts` 的授权判定点）据此**回落出厂默认**。
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';
import { createLogger } from '@synova/logger';

const log = createLogger('engine-auth/permission-grants');

// ════════════════════════════════════════════════════════════════
// 一、权限项（PermissionId）—— 类型面只有"项"，没有"档"
// ════════════════════════════════════════════════════════════════

/** 知识范围（与 `extensions/presets/roles/<id>/knowledge-scope.yaml` 的 `scopes[].id` 同域） */
export const KNOWLEDGE_SCOPES = ['finance', 'hr', 'sales', 'people', 'market'] as const;
/** 知识范围 id 类型 */
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

/** 项模型里的**桶**（只用于分组展示/校验，不参与判定） */
export const PERMISSION_BUCKETS = ['knowledge', 'tool', 'mcp', 'admin'] as const;

/**
 * 权限项 —— **联合字面量**（不是枚举值，不是档位）。
 *
 * 🔴 为什么必须是字面量联合而不是 `string`: 拼错一个 id 在类型期就该红。
 *   运行时侧另有一道白名单校验（见 {@link isPermissionId}）—— 因为 id 来自**文件**（外部输入）。
 */
export type PermissionId =
  // ── 知识项: 「能看哪些库」的按项授予（院方《02》§三机制1① 角色预设包第①件）──
  | `knowledge.${KnowledgeScope}.read`
  | `knowledge.${KnowledgeScope}.write`
  | 'knowledge.*.read'
  | 'knowledge.*.write'
  // ── 能力项: 「能做什么」 ──
  | 'tool.analysis.invoke'
  | 'tool.export.raw'
  | 'mcp.external.expose'
  | 'admin.role.manage';

/** 项模型目录条目（id + 人类可读标签 + 所属桶） */
export interface PermissionItem {
  readonly id: PermissionId;
  readonly bucket: (typeof PERMISSION_BUCKETS)[number];
  readonly label: string;
}

/**
 * 权限目录 —— **可授予项的全集**（白名单）。
 *
 * 包文件里出现此处无有的 id ⇒ 丢弃 + 记 reason（**不授予**，fail-closed）。
 */
function buildCatalog(): readonly PermissionItem[] {
  const items: PermissionItem[] = [];
  for (const scope of KNOWLEDGE_SCOPES) {
    items.push({ id: `knowledge.${scope}.read`, bucket: 'knowledge', label: `读取知识库: ${scope}` });
    items.push({ id: `knowledge.${scope}.write`, bucket: 'knowledge', label: `写入知识库: ${scope}` });
  }
  items.push({ id: 'knowledge.*.read', bucket: 'knowledge', label: '读取全部知识库' });
  items.push({ id: 'knowledge.*.write', bucket: 'knowledge', label: '写入全部知识库' });
  items.push({ id: 'tool.analysis.invoke', bucket: 'tool', label: '调用分析能力' });
  items.push({ id: 'tool.export.raw', bucket: 'tool', label: '导出原始数据' });
  items.push({ id: 'mcp.external.expose', bucket: 'mcp', label: '对外暴露 MCP 工具' });
  items.push({ id: 'admin.role.manage', bucket: 'admin', label: '管理角色与授权' });
  return items;
}

/** 权限目录（白名单唯一事实源） */
export const PERMISSION_CATALOG: readonly PermissionItem[] = buildCatalog();

const CATALOG_IDS: ReadonlySet<string> = new Set(PERMISSION_CATALOG.map((i) => i.id));

/** 运行期白名单校验（id 来自文件 ⇒ 必须校验） */
export function isPermissionId(value: unknown): value is PermissionId {
  return typeof value === 'string' && CATALOG_IDS.has(value);
}

/**
 * 范围 id → 读/写项 id（**类型安全**的构造点）。
 *
 * 🔴 为什么写成具名函数而不是内联模板字符串: `KNOWLEDGE_SCOPES.map((s) => \`...\`)`
 *   在 TS 里推成 `string[]`（模板字面量不反向收窄）⇒ 赋给 `PermissionId[]` 就报 TS2322。
 *   参数标注为 `KnowledgeScope` 后，模板字面量类型可被推成联合字面量 ⇒ 无需断言（禁 `as any` 族）。
 */
function scopePermissionId(scope: KnowledgeScope, action: 'read' | 'write'): PermissionId {
  return `knowledge.${scope}.${action}`;
}

/** 通配展开: `knowledge.*.read` ⇒ 每个范围一条；非通配原样返回 */
export function expandPermissionId(id: PermissionId): PermissionId[] {
  if (id === 'knowledge.*.read') return KNOWLEDGE_SCOPES.map((s) => scopePermissionId(s, 'read'));
  if (id === 'knowledge.*.write') return KNOWLEDGE_SCOPES.map((s) => scopePermissionId(s, 'write'));
  return [id];
}

// ════════════════════════════════════════════════════════════════
// 二、L0 出厂默认 —— 五档只是"出厂打包"，不是类型
// ════════════════════════════════════════════════════════════════

/**
 * 五档出厂默认授权表（**唯一**的档位→项 映射处）。
 *
 * 🔴 与 `src/middleware/rbac.ts` 的 `BUILTIN_TEMPLATES` 的关系: 后者是**旧**的
 *   粗档模板（`PermissionSet{data,function,time}` 三轴枚举），本表是**项**化后的
 *   出厂默认。两者**并存不替换**（宪章 5.2 覆盖非替换；旧表删不删属后续卡），
 *   映射关系见 {@link FACTORY_TIER_BY_LEGACY_ROLE}。
 *
 * 🔴 `liaison` / `ga` 不在本表 ⇒ 无出厂项 ⇒ 解析结果 `items: []` ⇒
 *   调用方**回落**原有的档位默认（见 `src/middleware/auth.ts` 的判定点）。
 *   这是**故意**的: 本卡只新增项模型，不改动既有档位行为（窄改纪律）。
 */
export const FACTORY_ROLE_GRANTS: Readonly<Record<string, readonly PermissionId[]>> = {
  admin: [
    'knowledge.*.read',
    'knowledge.*.write',
    'tool.analysis.invoke',
    'tool.export.raw',
    'mcp.external.expose',
    'admin.role.manage',
  ],
  manager: ['knowledge.*.read', 'knowledge.people.write', 'tool.analysis.invoke'],
  employee: ['knowledge.people.read', 'knowledge.market.read', 'tool.analysis.invoke'],
  viewer: ['knowledge.market.read'],
  external: [],
};

/** 旧档（`WorkspaceRole`/`AuthRole`）→ 出厂 tier 的**显式映射表**（消解两套五档并行） */
export const FACTORY_TIER_BY_LEGACY_ROLE: Readonly<Record<string, string | null>> = {
  // WorkspaceRole（src/middleware/rbac.ts:13）
  admin: 'admin', manager: 'manager', liaison: null, staff: 'employee', ga: null,
  // AuthRole（packages/engine-auth/src/types.ts:27）—— 与外层同名的档位按 tier 名同名
  employee: 'employee', viewer: 'viewer', external: 'external',
};

/** 项 → 该项覆盖的最高敏感度（用于把"项"接到既有的敏感度漏斗上，见 auth.ts 判定点） */
const SENSITIVITY_BY_ITEM_KIND: Readonly<Record<string, readonly string[]>> = {
  // 具体知识范围: 覆盖到 sensitive（不含 restricted —— 原始数据另有闸）
  'knowledge.scope': ['normal', 'sensitive'],
  // 通配（全库）: 覆盖到 restricted（＝现状 admin 的行为）
  'knowledge.all': ['normal', 'sensitive', 'restricted'],
};

/**
 * 由**生效项集合**推出敏感度白名单（**只能收窄，永不放宽**）。
 *
 * 语义: 有任一「读知识」项 ⇒ 取这些项覆盖面的**并集**；无任何读项 ⇒ 返回 `null`
 *   （＝"本模型不说话"，调用方按 {@link itemModelSpeaksForRole} 决定回落还是取最窄）。
 *
 * 🔴 **全库读 ⇒ 覆盖到 restricted**（本卡实测踩到的坑）: `knowledge.*.read` 在**出厂项**里
 *   已被 {@link expandPermissionId} 展开成逐范围的具体项 ⇒ 若只判"逐项"，全库读**永远**
 *   推不出 `restricted`（＝既有 admin 面被静默收窄）。故此处补判：**读项覆盖了全部知识范围
 *   ⇒ 视同全库读**。客户包减掉任一范围 ⇒ 覆盖不全 ⇒ 自然退回逐项面（收窄方向正确）。
 *
 * 🔴 为什么是"收窄"而不是"替换": 既有档位默认是**功能面**的一部分（D947 漏斗），
 *   项模型是新面；新面若把面放得比旧面宽，就是**自动提权**。故只做交集。
 */
export function sensitivityWhitelistFromGrants(items: readonly PermissionId[]): string[] | null {
  const allowed = new Set<string>();
  const scopesWithRead = new Set<string>();
  let sawReadItem = false;
  for (const raw of items) {
    for (const id of expandPermissionId(raw)) {
      if (!id.startsWith('knowledge.') || !id.endsWith('.read')) continue;
      sawReadItem = true;
      const scope = id.slice('knowledge.'.length, -'.read'.length);
      scopesWithRead.add(scope);
      const kind = id === 'knowledge.*.read' ? 'knowledge.all' : 'knowledge.scope';
      for (const lvl of SENSITIVITY_BY_ITEM_KIND[kind] ?? []) allowed.add(lvl);
    }
  }
  if (!sawReadItem) return null;
  // 全库读（覆盖全部范围）⇒ 补上全库面（含 restricted）—— 与 `knowledge.*.read` 同义
  if (KNOWLEDGE_SCOPES.every((s) => scopesWithRead.has(s))) {
    for (const lvl of SENSITIVITY_BY_ITEM_KIND['knowledge.all'] ?? []) allowed.add(lvl);
  }
  return ['normal', 'sensitive', 'restricted'].filter((l) => allowed.has(l));
}

// ════════════════════════════════════════════════════════════════
// 三、L2 客户可配包 —— 真读磁盘，加文件即生效
// ════════════════════════════════════════════════════════════════

/** 内容根（仓库相对）—— 与 `src/init/preset-loader.ts` 同口径 */
const PRESETS_DIR = 'extensions/presets';
/** 角色目录所在（相对内容根） */
const ROLES_SUBDIR = 'roles';
/** 包文件（五件套之一；授权段就写在它里面） */
const CAPABILITIES_FILE = 'capabilities.yaml';
/** 客户槽子目录名 */
const TENANT_SUBDIR = 'tenant';
/** 授权段字段名 */
const GRANTS_KEY = 'permissionGrants';

/** 解析结果（来源可审计） */
export interface ResolvedGrants {
  readonly roleId: string;
  readonly tenantId: string | null;
  /** 生效项（**已展开**，字典序） */
  readonly items: readonly PermissionId[];
  readonly sources: {
    readonly factory: readonly PermissionId[];
    readonly packGrants: readonly PermissionId[];
    readonly packDenies: readonly PermissionId[];
  };
  /** 实际命中的包文件（仓库相对路径）；`null` = 未命中任何包 */
  readonly packFile: string | null;
  /** **正常回落**出厂默认（不是错误，不置 degraded） */
  readonly fallback: boolean;
  /** **真降级**（解析失败 / 字段非法 / 未知项） */
  readonly degraded: boolean;
  readonly degradedReasons: readonly string[];
}

/** 内容根解析（`SYNOVA_PRESETS_ROOT` = 测试注入缝，同 preset-loader 惯例） */
function resolvePresetsRoot(root?: string): string {
  if (typeof root === 'string' && root.length > 0) return root;
  const override = process.env['SYNOVA_PRESETS_ROOT'];
  if (typeof override === 'string' && override.length > 0) return override;
  return join(process.cwd(), PRESETS_DIR);
}

/**
 * 包文件候选（**顺序即优先级**）:
 *   ① 指定了客户槽 ⇒ `<root>/roles/<roleId>/tenant/<tenantId>/capabilities.yaml`（客户专属）
 *   ② `<root>/roles/<roleId>/capabilities.yaml`（岗位默认层 —— 内容面出厂视图）
 * 逐条找第一个存在且为文件者；**都不存在 ⇒ 回落出厂默认**（`fallback`，非错误）。
 *
 * 🔴 客户槽**不覆盖**岗位默认层，是**叠加优先**（先客户槽，再岗位默认）—— 因为岗位默认层
 *   本身就是产品出厂内容（宪章 5.2「覆盖不是替换」：L0 常量 ⇒ L2 内容面 ⇒ 客户槽更窄）。
 */
function candidatePackPaths(presetsRoot: string, roleId: string, tenantId: string | null): string[] {
  const roleDir = join(presetsRoot, ROLES_SUBDIR, roleId);
  const paths: string[] = [];
  if (tenantId) paths.push(join(roleDir, TENANT_SUBDIR, tenantId, CAPABILITIES_FILE));
  paths.push(join(roleDir, CAPABILITIES_FILE));
  return paths;
}

/** 读包内 `permissionGrants` 段（返回原始字符串数组；解析失败走 reasons） */
interface RawGrants {
  readonly grants: readonly string[];
  readonly denies: readonly string[];
  readonly inherited: string | null;
}

function readRawGrants(absPath: string, reasons: string[]): RawGrants | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err: unknown) {
    // 读失败 = 真错误（调用方已先判存在性；此处属竞态或权限问题）
    reasons.push(`${absPath}: 读取失败 — ${err instanceof Error ? err.message : String(err)}`);
    log.warn({ path: absPath, err }, '角色包读取失败 — degraded（回落出厂默认）');
    return null;
  }

  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err: unknown) {
    reasons.push(`${absPath}: YAML 解析失败 — ${err instanceof Error ? err.message : String(err)}`);
    log.warn({ path: absPath, err }, '角色包解析失败 — degraded（回落出厂默认）');
    return null;
  }
  if (doc === null || doc === undefined || typeof doc !== 'object') {
    // 空文件 / 非对象 ⇒ **无授权段** = 正常回落（不是错误）
    return { grants: [], denies: [], inherited: null };
  }

  const section = (doc as Record<string, unknown>)[GRANTS_KEY];
  if (section === undefined || section === null) {
    return { grants: [], denies: [], inherited: null };
  }
  if (typeof section !== 'object' || Array.isArray(section)) {
    reasons.push(`${absPath}: \`${GRANTS_KEY}\` 段必须是对象（实测 ${Array.isArray(section) ? 'array' : typeof section}）`);
    log.warn({ path: absPath, got: Array.isArray(section) ? 'array' : typeof section },
      `${GRANTS_KEY} 段类型非法 — degraded（回落出厂默认）`);
    return null;
  }

  const obj = section as Record<string, unknown>;
  const asStringList = (key: string): { list: string[]; bad: unknown } => {
    const v = obj[key];
    if (v === undefined || v === null) return { list: [], bad: undefined };
    if (!Array.isArray(v)) return { list: [], bad: v };
    const list: string[] = [];
    for (const entry of v) {
      if (typeof entry !== 'string') return { list: [], bad: entry };
      list.push(entry);
    }
    return { list, bad: undefined };
  };

  const g = asStringList('grants');
  const d = asStringList('denies');
  for (const [key, r] of [['grants', g], ['denies', d]] as const) {
    if (r.bad !== undefined) {
      reasons.push(`${absPath}: \`${GRANTS_KEY}.${key}\` 必须是非空字符串数组（实测 ${JSON.stringify(r.bad)}）`);
      log.warn({ path: absPath, key, got: r.bad }, `${GRANTS_KEY}.${key} 类型非法 — degraded（回落出厂默认）`);
      return null;
    }
  }

  const inheritedRaw = obj['inherits'];
  const inherited = typeof inheritedRaw === 'string' && inheritedRaw.length > 0 ? inheritedRaw : null;
  return { grants: g.list, denies: d.list, inherited };
}

/** 校验 + 展开（未知项 ⇒ 记 reason + 丢弃；**fail-closed**） */
function validateAndExpand(
  raw: readonly string[],
  absPath: string,
  reasons: string[],
): PermissionId[] {
  const out = new Set<PermissionId>();
  for (const entry of raw) {
    if (!isPermissionId(entry)) {
      reasons.push(`${absPath}: 未知权限项 \`${entry}\`（不在 PERMISSION_CATALOG 内）⇒ **不授予**`);
      log.warn({ path: absPath, permissionId: entry }, '未知权限项已丢弃（fail-closed，不静默不提权）');
      continue;
    }
    for (const expanded of expandPermissionId(entry)) out.add(expanded);
  }
  return [...out].sort();
}

/**
 * 解析某角色在**某客户槽**下的生效授权。
 *
 * @input  `roleId`（必填）、`tenantId`（可选 —— 客户槽；缺省 = 岗位默认层）、
 *         `root`（可选内容根，测试注入缝）
 * @output {@link ResolvedGrants}
 * @degraded 见文件头契约：回落 = `fallback: true`（非错误）；解析/类型/未知项 = `degraded: true`。
 *           🔴 **本函数从不抛** —— 它在请求路径上被判定的每一次调用触发；任何未预期异常
 *           一律收敛为「出厂默认 + degraded」并 `log.warn`（铁律 11/24/31：不静默、不阻断认证）。
 */
export function resolveGrants(
  roleId: string,
  options: { tenantId?: string | null; root?: string } = {},
): ResolvedGrants {
  try {
    return resolveGrantsUnsafe(roleId, options);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ roleId, err }, '权限项解析未预期异常 — 收敛为出厂默认（degraded，不抛）');
    const factory = factoryItemsOf(roleId);
    return {
      roleId,
      tenantId: null,
      items: factory,
      sources: { factory, packGrants: [], packDenies: [] },
      packFile: null,
      fallback: true,
      degraded: true,
      degradedReasons: [`resolveGrants 未预期异常: ${msg}`],
    };
  }
}

/** 出厂项（展开 + 去重 + 字典序） —— 唯一展开点 */
function factoryItemsOf(roleId: string): PermissionId[] {
  const out: PermissionId[] = [];
  for (const id of FACTORY_ROLE_GRANTS[roleId] ?? []) out.push(...expandPermissionId(id));
  return [...new Set(out)].sort();
}

/**
 * **L0 出厂项**（不读磁盘）—— 与 {@link permissionsForRole} 的区别是**语义级**：
 *   · `permissionsForRole(roleId)`（无客户槽）会读 `roles/<roleId>/capabilities.yaml`
 *     ⇒ 返回的是"岗位默认层"，**不是**出厂基线；
 *   · 本函数**只**返回 `FACTORY_ROLE_GRANTS` 展开值 ⇒ 用于回答
 *     "这份包相对出厂多了什么 / 少了什么"（客户可自审），也是判据的基线面。
 */
export function factoryPermissionsForRole(roleId: string): PermissionId[] {
  return factoryItemsOf(roleId);
}

function resolveGrantsUnsafe(
  roleId: string,
  options: { tenantId?: string | null; root?: string } = {},
): ResolvedGrants {
  const tenantId = typeof options.tenantId === 'string' && options.tenantId.length > 0
    ? options.tenantId
    : null;
  const presetsRoot = resolvePresetsRoot(options.root);

  const factory = factoryItemsOf(roleId);

  const reasons: string[] = [];
  let packFile: string | null = null;
  let rawGrants: readonly string[] = [];
  let rawDenies: readonly string[] = [];
  let inherited: string | null = null;

  for (const abs of candidatePackPaths(presetsRoot, roleId, tenantId)) {
    let isFile = false;
    try {
      isFile = existsSync(abs) && statSync(abs).isFile();
    } catch {
      isFile = false; // stat 竞态 ⇒ 视为不存在（正常回落），非错误
    }
    if (!isFile) continue;
    packFile = abs;
    const raw = readRawGrants(abs, reasons);
    if (raw === null) {
      // 真降级 ⇒ 回落出厂默认（**不抛**，调用方照常判定）
      return {
        roleId, tenantId,
        items: factory,
        sources: { factory, packGrants: [], packDenies: [] },
        packFile, fallback: false, degraded: true, degradedReasons: reasons,
      };
    }
    rawGrants = raw.grants;
    rawDenies = raw.denies;
    inherited = raw.inherited;
    break; // ① 命中即止（窄槽优先）
  }

  // `inherits`: 包可声明"继承另一个角色包的项"（同客户槽）——目录名推导，无硬编码角色表
  let inheritedItems: PermissionId[] = [];
  let inheritedPackFile: string | null = null;
  if (inherited !== null && inherited !== roleId) {
    for (const abs of candidatePackPaths(presetsRoot, inherited, tenantId)) {
      let isFile = false;
      try {
        isFile = existsSync(abs) && statSync(abs).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) continue;
      const raw = readRawGrants(abs, reasons);
      if (raw === null) break;
      inheritedPackFile = abs;
      inheritedItems = validateAndExpand(raw.grants, abs, reasons);
      break;
    }
    if (inheritedPackFile === null) {
      // 父包缺失 ⇒ 正常回落（本包仍生效），只在 note 层面留痕，不置 degraded
      log.info({ roleId, inherited, tenantId }, 'inherits 指名的父角色包不存在 — 只按本包生效');
    }
  }

  const packGrants = validateAndExpand(rawGrants, packFile ?? '(none)', reasons);
  const packDenies = validateAndExpand(rawDenies, packFile ?? '(none)', reasons);

  const effective = new Set<PermissionId>([...factory, ...inheritedItems, ...packGrants]);
  for (const denied of packDenies) effective.delete(denied);

  return {
    roleId,
    tenantId,
    items: [...effective].sort(),
    sources: { factory, packGrants, packDenies },
    packFile: packFile ?? inheritedPackFile,
    fallback: packFile === null,
    degraded: reasons.length > 0,
    degradedReasons: reasons,
  };
}

/**
 * 项模型是否**为这个角色发声**（spoken = 有出厂清单命中，**或**有客户包文件命中）。
 *
 * 🔴 为什么必须区分（本卡实测踩到的坑）: 两者都表现为 `items: []`，但语义相反 ——
 *   · `admin` 被客户包减掉**全部**读项 ⇒ **项模型发声且说了"不许读"** ⇒ 取最窄（deny）
 *   · `liaison` / `ga` / 未知角色 ⇒ **项模型没发声**（不属本模型管辖）⇒ 逐字回落档位默认
 *   若把两者并成一句"items 空 ⇒ 回落档位"，则「客户把读权收干净」会被静默当成
 *   「没配置」而放行到档位默认 ⇒ **恰恰是最危险方向的假绿**。
 */
export function itemModelSpeaksForRole(
  roleId: string,
  options: { tenantId?: string | null; root?: string } = {},
): boolean {
  if (Object.prototype.hasOwnProperty.call(FACTORY_ROLE_GRANTS, roleId)) return true;
  return resolveGrants(roleId, options).packFile !== null;
}

/** 便捷面: 生效项清单（探针/调用方最常用的一行） */
export function permissionsForRole(
  roleId: string,
  options: { tenantId?: string | null; root?: string } = {},
): PermissionId[] {
  return [...resolveGrants(roleId, options).items];
}

/** 便捷面: 是否授予某项（**判定唯一入口** —— 按项，不按档） */
export function hasPermission(item: string, items: readonly PermissionId[]): boolean {
  return items.includes(item as PermissionId);
}
