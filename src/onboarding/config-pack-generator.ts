/**
 * src/onboarding/config-pack-generator.ts — 建档「文档进 → 配置出」的配置包生成器
 *
 * 架构位置: **⓪-b 人侧入口**（宪章 §4.1「人侧 extensions/presets/ + extensions/onboarding/」）。
 *   本文件把建档采集结果**落成内容面文件**（`extensions/presets/roles/{id}/` 六件套），
 *   使「丢一批文档 ⇒ 产出可用的岗位预设包」成立，且**加岗位不改宿主代码**。
 *
 * 设计哲学（一句）：**先证后写** —— 一个角色要么 6 件齐、要么 0 件；缺项/坏引用只拒绝、不半写。
 *
 * 出处: K12-03（#186）卡面 §Q2 写集 / §Q3 判据 V1（dry-run 不落盘）+ V2（真落盘 ≥2 角色目录）；
 *   **#1075 P1-b（岗位包 v2 生成面）**：六件＋载荷键名 `scopes:`（修 `knowledgeScope:` 真缺陷）＋
 *   缺项拒绝写（规格 §1.2-P1-b／§2.4 投影规则／§2.5 字段级契约）。
 *
 * 契约（铁律 47）:
 *   @input  — `GenerateConfigPackInput`：{ roles: RoleSeed[], rootDir?: string, dryRun?: boolean }
 *             `RoleSeed` 六块（§2.5-A）：knowledgeScope?／capabilities?／acceptanceCriteria?（各 ≥1）＋
 *             contexts?（≥1，每条 source 须是 §2.4 四形态之一）＋ systemAddendum?（去空白后非空）＋
 *             outputTemplate?（sections ≥1）
 *   @output — `ConfigPackResult`：{ written, planned, skipped, rejected, degraded, errors }
 *             `rejected[]` 元素 = { roleId, code, missingParams, **badParams?** } —— **机器判据唯一落点**；
 *             `badParams` 是 #1104 的 **additive** 字段：只放**格式非法**的取值（≤5 条，超出 `…(+N)` 截断），
 *             `missingParams` 只放**缺失**字段名（两者禁混用）；
 *             顶层**不另造** `code` 字段（防两真源；J4 明文）。`dryRun=true` ⇒ 一律不落盘
 *             （`written` 空，`planned` 列将写路径 —— 卡面 V1 判据探针据此判红）。
 *   @degraded — 目录不可写／写失败 ⇒ **不抛**，进 `errors[]` ＋ `log.error` ＋ `degraded:true`
 *             （铁律 11/24/31：不静默降级）。任一角色缺项 ⇒ `ROLE_SEED_INCOMPLETE`；
 *             `contexts.source` 不可投影 ⇒ `ROLE_SEED_BAD_SOURCE`；
 *             `knowledgeScope[]` 取值格式非法（不符 `^[a-z0-9][a-z0-9.-]{0,63}$`）⇒ `ROLE_SEED_BAD_SCOPE_ID`
 *             （#1104 / 规格 §4.5-C2；**执行体＝本文件**，规格 §10-L15）—— 三者都是**该角色零写入**、不抛。
 *             roleId 非法（非 `[a-z0-9-]+`）⇒ 跳过并实名进 `skipped`/`errors`（**防路径穿越**）。
 *   @error  — 生成期**不 throw**（契约：调用方按 `rejected[]`／`errors[]` 判定）；拒绝码是 typed 常量
 *             （`RoleSeedRejectionCode`），禁裸字符串回落。
 *   @authority — 生产调用方唯一 = `src/onboarding/onboarding-flow.ts:130`；
 *             `POST /api/onboarding/apply` 的 400 前置判定**只复用**本文件的纯函数
 *             `missingSeedParams()`（禁止第二套缺项口径）。
 *   @not-here — 不做装载期校验（唯一实现 `src/init/role-pack-schema.ts`）；不做 refs 投影规则
 *             （同文件 `projectContextSource()` 是唯一实现，本文件只调用＋去重排序）；
 *             不写主树 `data/**`；不跑真模型。
 *
 * 🔴 已知限制（禁写"暂无"）:
 *   ① `profile.<key>` 只投影不校验白名单 —— 装载期由 `reconcileRefs()` 判（本批仅 `business-plan`，
 *      规格 §10-L2）。
 *   ② contexts 的 scope 引用与 `knowledgeScope` 不一致时**生成期不拒**（生成期错误码只有
 *      `ROLE_SEED_INCOMPLETE`／`ROLE_SEED_BAD_SOURCE`／`ROLE_SEED_BAD_SCOPE_ID` 三码，无"一致性"码）
 *      ⇒ 该不一致在装载期红（refs 命中检查）；一致性由 P3 对话追问保证。
 *      `ROLE_SEED_BAD_SCOPE_ID` 只判 `knowledgeScope[]` **取值本身**的字符集/长度（#1104），不判语义一致性。
 *   ③ slug 归一按 §2.5-B **字面**（lower → 非 `[a-z0-9]` 归一 `-` → 去首尾 `-`）：纯非 ASCII label
 *      （如纯中文）归一为空 ⇒ id 形如 `ac.`／`capability.`。回退策略待 P3 定，本批不发明新规则。
 *   ④ `badParams` 的**截断**只记条数（`…(+N)`），被截断的原值**既不返回也不落日志** —— 取舍：非法输入
 *      不得让 400 响应体／日志随条数无界增长（§4.5-C1 上限 5 条）；需要完整原值时由调用方对原始 seed 自行点名。
 */
import { createLogger } from '@synova/logger';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EXPECTED_PIECES } from '../init/preset-loader';
import {
  ROLE_PACK_SCHEMA_POINTER,
  ROLE_PACK_SCHEMA_VERSION,
  projectContextSource,
  type RolePackRef,
} from '../init/role-pack-schema';

const log = createLogger('onboarding/config-pack-generator');

/** 内容根（仓库相对）——与 `preset-loader.ts` 的 `PRESETS_DIR` 同源 */
const PRESETS_DIR = 'extensions/presets';
/** 角色目录所在（相对内容根） */
const ROLES_SUBDIR = 'roles';

/** 🔴 角色 id 白名单（防路径穿越：`../` / 绝对路径 / 空段一律不合法） */
const SAFE_ROLE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * 🔴 知识范围 scope id 白名单（规格 §4.5-C2；#1104 —— 此前只写在 JSDoc，无执行体）。
 * 与 `SAFE_ROLE_ID` 同风格：首字符须字母/数字，其余 `[a-z0-9.-]`，总长 ≤64（`{0,63}` ⇒ 含首字符恰 64 过、65 拒）。
 */
const SAFE_SCOPE_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** `badParams` 逐条上限（规格 §4.5-C1：最多 5 条，超出以 `…(+N)` 截断并计数） */
const MAX_BAD_PARAMS = 5;

/** 生成期拒绝码（typed；§4.5-C1 —— 禁裸字符串） */
export type RoleSeedRejectionCode =
  | 'ROLE_SEED_INCOMPLETE'
  | 'ROLE_SEED_BAD_SOURCE'
  | 'ROLE_SEED_BAD_SCOPE_ID'
  | 'ROLE_SEED_BAD_CONTEXT_WHY';

/** 一个上下文来源的采集种子（§2.5-A） */
export interface RoleContextSeed {
  /** 上下文 id（`^[a-z0-9][a-z0-9.-]{0,63}$`） */
  readonly id: string;
  /** 人类可读标签（非空） */
  readonly label: string;
  /** 来源（§2.4 四形态之一） */
  readonly source: string;
  /** 为什么必须带这份上下文（可选） */
  readonly why?: string;
  /** 是否必需（缺省 false） */
  readonly required?: boolean;
}

/** 输出模板一节（§2.5-A） */
export interface RoleOutputSectionSeed {
  /** 节 id（`^[a-z0-9][a-z0-9-]{0,31}$`） */
  readonly id: string;
  /** 节标题 */
  readonly title: string;
  /** 本节必须出现的要素（≥1） */
  readonly must: readonly string[];
}

/** 一个岗位的采集种子（§2.5-A；六块齐 ⇔ 可生成） */
export interface RoleSeed {
  /** 角色 id（= 目录名；须匹配 `SAFE_ROLE_ID`） */
  readonly roleId: string;
  /** 知识可见范围（≥1；每条 → `knowledge-scope.yaml` 的 `scopes[].id`） */
  readonly knowledgeScope?: readonly string[];
  /** 能力清单（≥1；每条 → `capabilities[]` 的 `capability.<slug>`） */
  readonly capabilities?: readonly string[];
  /** 验收判据（≥1；每条 → `criteria[]` 的 `ac.<slug>`） */
  readonly acceptanceCriteria?: readonly string[];
  /** 上下文清单（≥1；每条 source 走 §2.4 投影进 `manifest.refs[]`） */
  readonly contexts?: readonly RoleContextSeed[];
  /** 人设追加（去空白后非空 → `prompt.systemAddendum` 块标量） */
  readonly systemAddendum?: string;
  /** 输出模板（sections ≥1 → `output-template.ref`） */
  readonly outputTemplate?: {
    readonly templateId: string;
    readonly sections: readonly RoleOutputSectionSeed[];
    readonly emptyState?: string;
  };
}

/** `generateConfigPack()` 入参 */
export interface GenerateConfigPackInput {
  readonly roles: readonly RoleSeed[];
  /** 仓库根（缺省 `process.cwd()`）；测试注入缝 */
  readonly rootDir?: string;
  /** true ⇒ 只算不写（判据 V1） */
  readonly dryRun?: boolean;
}

/** 被拒绝的角色（零写入；机器判据唯一落点 —— 顶层不另造 code） */
export interface RejectedRole {
  readonly roleId: string;
  readonly code: RoleSeedRejectionCode;
  /** 逐字段点名的缺项（INCOMPLETE）或坏 source 的字段路径（BAD_SOURCE），如 `contexts[0].source` */
  readonly missingParams: readonly string[];
  /**
   * **格式非法**的取值（`ROLE_SEED_BAD_SCOPE_ID` 时为非法的 scope id 原值；#1104 additive）。
   * 🔴 语义不混用：本字段只放**取值**，`missingParams` 只放**缺失字段名**。
   * 最多 5 条，超出以 `…(+N)` 截断并计数（N = 超出条数，如 8 条非法 ⇒ 5 条 ＋ `…(+3)`）。
   */
  readonly badParams?: readonly string[];
}

/** `generateConfigPack()` 返回 */
export interface ConfigPackResult {
  /** 真写入的文件（仓库相对路径，已排序） */
  readonly written: readonly string[];
  /** dry-run 下"本会写入"的文件（仓库相对路径，已排序） */
  readonly planned: readonly string[];
  /** 因 roleId 非法而跳过的角色（含原因） */
  readonly skipped: readonly string[];
  /** 因缺项/坏 source 而零写入的角色（#1075 P1-b；与 `skipped` 语义不同：roleId 合法但不可生成） */
  readonly rejected: readonly RejectedRole[];
  readonly degraded: boolean;
  readonly errors: readonly string[];
}

// ══════════════════════════════════════════════════════════════════════════════
// 一、纯核：缺项判定（**唯一实现**；route `/apply` 的 400 前置判定复用本函数）
// ══════════════════════════════════════════════════════════════════════════════

/** 非空数组判定（`undefined` 与 `[]` 都算缺） */
function hasItems<T>(list: readonly T[] | undefined): list is readonly T[] {
  return list !== undefined && list.length > 0;
}

/**
 * 列出该 seed 缺失的六块（有序＝§2.5-A 字段序；空数组 = 六块齐）。
 *
 * 🔴 判据（§2.5-A／§4.5-C2）：knowledgeScope／capabilities／acceptanceCriteria／contexts 各 ≥1；
 *   `systemAddendum` 去空白后非空（**空白算缺**）；`outputTemplate` 整体缺 ⇒ `outputTemplate`，
 *   存在但 `sections` 空 ⇒ `outputTemplate.sections`。
 *
 * @param seed - 采集种子
 * @returns 逐字段点名的缺项清单（**有序、去重**；纯函数、零 IO、不抛）
 */
export function missingSeedParams(seed: RoleSeed): readonly string[] {
  const missing: string[] = [];
  if (!hasItems(seed.knowledgeScope)) missing.push('knowledgeScope');
  if (!hasItems(seed.capabilities)) missing.push('capabilities');
  if (!hasItems(seed.acceptanceCriteria)) missing.push('acceptanceCriteria');
  if (!hasItems(seed.contexts)) missing.push('contexts');
  if (seed.systemAddendum === undefined || seed.systemAddendum.trim().length === 0) {
    missing.push('systemAddendum');
  }
  if (seed.outputTemplate === undefined) missing.push('outputTemplate');
  else if (!hasItems(seed.outputTemplate.sections)) missing.push('outputTemplate.sections');
  return missing;
}

// ══════════════════════════════════════════════════════════════════════════════
// 一bis、纯核：seed 取值合法性（#1104 / 规格 §4.5-C2「knowledgeScope」行）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 列出知识范围里**格式非法**的 scope id **原值**（保序；纯函数、零 IO、不抛）。
 *
 * 🔴 判据（§4.5-C2）：每条须匹配 `SAFE_SCOPE_ID`（`^[a-z0-9][a-z0-9.-]{0,63}$`）——
 *   空/缺 ⇒ 归 `ROLE_SEED_INCOMPLETE`（缺项，走 `missingSeedParams`）；
 *   **有但字符集不符或长度 >64 ⇒ 本函数点名** ⇒ 生成器拒绝该角色（`ROLE_SEED_BAD_SCOPE_ID`）。
 *
 * @param seed - 采集种子
 * @returns 非法取值的原值数组（空数组 = 全部合法；**不改写、不归一**，便于调用方原样点名脱敏）
 */
function invalidScopeIds(seed: RoleSeed): readonly string[] {
  const scope = seed.knowledgeScope ?? [];
  return scope.filter((id) => !SAFE_SCOPE_ID.test(id));
}

/**
 * `badParams` 截断（§4.5-C1：最多 5 条，超出以 `…(+N)` 截断并计数）。
 *
 * @param values - 非法取值（原值，已保序）
 * @returns ≤5 条原值；超出时末条为 `…(+N)`（N = 超出条数）
 */
/**
 * 列出 `contexts[].why` **缺失/空白/超长** 的字段路径（#1178；与人设面 `role-pack-persona.ts:417` 同口径）。
 * 人设面把 `why` 当必填（1..200），生成器若放行 ⇒ 生成件过 loader、过不了人设解析。
 */
function invalidContextWhys(seed: RoleSeed): readonly string[] {
  const contexts = seed.contexts ?? [];
  const bad: string[] = [];
  contexts.forEach((context, index) => {
    const why = context.why;
    if (typeof why !== 'string' || why.trim().length === 0 || why.length > 200) {
      bad.push(`contexts[${String(index)}].why`);
    }
  });
  return bad;
}

function summarizeBadParams(values: readonly string[]): readonly string[] {
  if (values.length <= MAX_BAD_PARAMS) return values;
  return [...values.slice(0, MAX_BAD_PARAMS), `…(+${String(values.length - MAX_BAD_PARAMS)})`];
}

// ══════════════════════════════════════════════════════════════════════════════
// 二、纯核：refs 投影（唯一实现归 role-pack-schema.projectContextSource；此处只收集排序）
// ══════════════════════════════════════════════════════════════════════════════

type SeedRefProjection =
  | { readonly ok: true; readonly refs: readonly RolePackRef[] }
  | { readonly ok: false; readonly badParams: readonly string[]; readonly messages: readonly string[] };

/** refs 的去重键（也是排序键：`kind:标识`，§2.4 的稳定顺序） */
function refSortKey(ref: RolePackRef): string {
  return ref.kind === 'file' ? `${ref.kind}:${ref.path}` : `${ref.kind}:${ref.name}`;
}

/** 把 `seed.contexts[].source` 逐条投影为 `manifest.refs[]`（去重 ＋ §2.4 排序） */
function projectSeedRefs(seed: RoleSeed): SeedRefProjection {
  const collected: RolePackRef[] = [];
  const badParams: string[] = [];
  const messages: string[] = [];
  const contexts = seed.contexts ?? [];
  contexts.forEach((context, index) => {
    const projected = projectContextSource(context.source, seed.roleId);
    if (projected.ok) {
      collected.push(projected.ref);
      return;
    }
    badParams.push(`contexts[${String(index)}].source`);
    messages.push(`contexts[${String(index)}].source「${context.source}」— ${projected.message}`);
  });
  if (badParams.length > 0) return { ok: false, badParams, messages };

  const byKey = new Map<string, RolePackRef>();
  for (const ref of collected) {
    const key = refSortKey(ref);
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  const refs = [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, ref]) => ref);
  return { ok: true, refs };
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、渲染原语（纯字符串；不引 YAML 依赖 —— 标量一律 JSON.stringify 双引号）
// ══════════════════════════════════════════════════════════════════════════════

/** 每个 YAML 文件的统一注释头（YAML 注释，不影响解析） */
const YAML_HEADER = '# 由建档通道生成（生成器: src/onboarding/config-pack-generator.ts）\n';

/**
 * 渲染一个 YAML 标量：string ⇒ `JSON.stringify`（双引号 ＋ 转义，防 `:`／`#`／引号破坏结构）；
 * number／boolean ⇒ 裸值（`version: 2` 不写成 `"2"`）。
 */
function yamlScalar(value: string | number | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** 单行 `key: scalar` */
function yamlKeyValue(key: string, value: string | number | boolean): string {
  return `${key}: ${yamlScalar(value)}\n`;
}

/** 对象列表的一行（首字段 `  - k: v`，其余字段 `    k: v`） */
function yamlRow(fields: readonly (readonly [string, string | number | boolean])[]): string {
  let out = '';
  fields.forEach(([field, value], index) => {
    out += `${index === 0 ? '  - ' : '    '}${field}: ${yamlScalar(value)}\n`;
  });
  return out;
}

/** 块标量（`key: |`；内容逐行缩进两格，空行渲染成真空行） */
function yamlBlockScalar(key: string, indent: string, text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const body = lines.map((line) => (line.length === 0 ? '' : `${indent}  ${line}`)).join('\n');
  return `${indent}${key}: |\n${body}\n`;
}

/** §2.5-B 的字面 slug 归一（**不发明回退**；纯非 ASCII label ⇒ 空串，见头部已知限制 ③） */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、六件逐件渲染（形状 = 规格 §2.5-B；refs 只来自 projectSeedRefs）
// ══════════════════════════════════════════════════════════════════════════════

/** `manifest.json`（JSON；键集严格 = 10 键 —— P1-a `MANIFEST_ZOD` 是 strictObject，多键即红） */
function renderManifest(seed: RoleSeed, refs: readonly RolePackRef[]): string {
  const doc = {
    $schema: ROLE_PACK_SCHEMA_POINTER,
    schemaVersion: ROLE_PACK_SCHEMA_VERSION,
    name: `role-${seed.roleId}`,
    version: '2.0.0',
    type: 'role-preset',
    displayName: seed.roleId,
    entryPoint: 'context-manifest.yaml',
    roleId: seed.roleId,
    pieces: [...EXPECTED_PIECES],
    refs: [...refs],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** `knowledge-scope.yaml`（🔴 键名 `scopes`，对象数组 —— 这是 #1075 前的真缺陷所在） */
function renderKnowledgeScope(seed: RoleSeed): string {
  const scopes = seed.knowledgeScope ?? [];
  let body = YAML_HEADER + yamlKeyValue('roleId', seed.roleId) + yamlKeyValue('version', 2) + 'scopes:\n';
  for (const scopeId of scopes) body += yamlRow([['id', scopeId]]);
  return body;
}

/** `capabilities.yaml`（`capability.<slug>`；不生成 `tool` —— 工具接线属 P2） */
function renderCapabilities(seed: RoleSeed): string {
  const capabilities = seed.capabilities ?? [];
  let body = YAML_HEADER + yamlKeyValue('roleId', seed.roleId) + yamlKeyValue('version', 2) + 'capabilities:\n';
  for (const label of capabilities) {
    body += yamlRow([
      ['id', `capability.${slugify(label)}`],
      ['label', label],
      ['enabled', true],
    ]);
  }
  return body;
}

/** `acceptance-criteria.yaml`（`ac.<slug>`；不生成 `check` —— 判据接线属 P2） */
function renderAcceptanceCriteria(seed: RoleSeed): string {
  const criteria = seed.acceptanceCriteria ?? [];
  let body = YAML_HEADER + yamlKeyValue('roleId', seed.roleId) + yamlKeyValue('version', 2) + 'criteria:\n';
  for (const text of criteria) {
    body += yamlRow([
      ['id', `ac.${slugify(text)}`],
      ['text', text],
    ]);
  }
  return body;
}

/** `context-manifest.yaml`（`contexts[]` ＋ `prompt.systemAddendum` 块标量） */
function renderContextManifest(seed: RoleSeed): string {
  const contexts = seed.contexts ?? [];
  let body = YAML_HEADER + yamlKeyValue('roleId', seed.roleId) + yamlKeyValue('version', 2) + 'contexts:\n';
  for (const context of contexts) {
    const fields: (readonly [string, string | number | boolean])[] = [
      ['id', context.id],
      ['label', context.label],
      ['source', context.source],
    ];
    if (context.why !== undefined && context.why.length > 0) fields.push(['why', context.why]);
    if (context.required !== undefined) fields.push(['required', context.required]);
    body += yamlRow(fields);
  }
  body += 'prompt:\n' + yamlBlockScalar('systemAddendum', '  ', seed.systemAddendum ?? '');
  return body;
}

/** `output-template.ref`（`templateId` ＋ `sections[]`；`emptyState` 仅当给了非空值） */
function renderOutputTemplate(seed: RoleSeed): string {
  const template = seed.outputTemplate;
  if (template === undefined) return YAML_HEADER; // 不可达（缺项已在 generateConfigPack 前置拒绝）
  let body = YAML_HEADER + yamlKeyValue('templateId', template.templateId) + 'sections:\n';
  for (const section of template.sections) {
    body += yamlRow([
      ['id', section.id],
      ['title', section.title],
    ]);
    body += `    must: [${section.must.map((item) => yamlScalar(item)).join(', ')}]\n`;
  }
  if (template.emptyState !== undefined && template.emptyState.length > 0) {
    body += yamlKeyValue('emptyState', template.emptyState);
  }
  return body;
}

/** 单角色要写的六件（顺序 = `EXPECTED_PIECES` 契约顺序）→ 内容 */
function roleFiles(
  seed: RoleSeed,
  refs: readonly RolePackRef[],
): readonly { readonly name: string; readonly body: string }[] {
  return [
    { name: 'manifest.json', body: renderManifest(seed, refs) },
    { name: 'knowledge-scope.yaml', body: renderKnowledgeScope(seed) },
    { name: 'context-manifest.yaml', body: renderContextManifest(seed) },
    { name: 'output-template.ref', body: renderOutputTemplate(seed) },
    { name: 'capabilities.yaml', body: renderCapabilities(seed) },
    { name: 'acceptance-criteria.yaml', body: renderAcceptanceCriteria(seed) },
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、入口
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把采集结果生成配置包（内容面文件）。
 *
 * 🔴 `dryRun` 语义不可妥协：**任何文件系统写入都不发生**（判据 V1）。
 * 🔴 零部分写：任一角色缺项/坏 source ⇒ 该角色**不 mkdir、不写任何文件**（先证后写）。
 */
export function generateConfigPack(input: GenerateConfigPackInput): ConfigPackResult {
  const root = input.rootDir ?? process.cwd();
  const dryRun = input.dryRun === true;
  const written: string[] = [];
  const planned: string[] = [];
  const skipped: string[] = [];
  const rejected: RejectedRole[] = [];
  const errors: string[] = [];

  for (const seed of input.roles) {
    if (!SAFE_ROLE_ID.test(seed.roleId)) {
      const why = `${seed.roleId}: roleId 非法（须匹配 ${String(SAFE_ROLE_ID)}，防路径穿越）`;
      skipped.push(why);
      errors.push(why);
      log.warn({ roleId: seed.roleId }, 'roleId 非法 — 跳过该角色（degraded）');
      continue;
    }

    // ② 缺项 ⇒ 拒绝写（零部分写；不 mkdir）
    // 🔴 顺序（#1104 / §施工补充 项 5）：**先 INCOMPLETE（缺）再 BAD_SCOPE_ID（有但坏）** ——
    //    两者同时命中时以 INCOMPLETE 优先（缺字段才是阻断主因），但坏值**不丢**：随 badParams 带出。
    const missing = missingSeedParams(seed);
    const illegalScopeIds = invalidScopeIds(seed);
    const badParams = illegalScopeIds.length > 0 ? summarizeBadParams(illegalScopeIds) : undefined;
    if (missing.length > 0) {
      rejected.push({
        roleId: seed.roleId,
        code: 'ROLE_SEED_INCOMPLETE',
        missingParams: missing,
        ...(badParams === undefined ? {} : { badParams }),
      });
      errors.push(`${seed.roleId}: 缺项 ${missing.join(', ')}（ROLE_SEED_INCOMPLETE，该角色零写入）`);
      log.warn(
        { roleId: seed.roleId, code: 'ROLE_SEED_INCOMPLETE', missingParams: missing, badParams, degraded: true },
        '角色种子缺项 — 拒绝生成（零部分写）',
      );
      continue;
    }

    // ②a 有但坏：contexts[].why 缺失/空白/超长 ⇒ 拒绝写（#1178；与人设面同口径）
    const badWhys = invalidContextWhys(seed);
    if (badWhys.length > 0) {
      rejected.push({
        roleId: seed.roleId,
        code: 'ROLE_SEED_BAD_CONTEXT_WHY',
        missingParams: [],
        badParams: summarizeBadParams(badWhys),
      });
      errors.push(`${seed.roleId}: contexts[].why 缺失/空白/超长 ${badWhys.join(', ')}（ROLE_SEED_BAD_CONTEXT_WHY，该角色零写入）`);
      log.warn({ roleId: seed.roleId, code: 'ROLE_SEED_BAD_CONTEXT_WHY', badParams: badWhys, degraded: true }, '角色种子 context why 非法 — 拒绝生成（零部分写）');
      continue;
    }

    // ②b 有但坏：knowledgeScope 取值格式非法 ⇒ 拒绝写（零文件、不 mkdir —— #1104）
    if (badParams !== undefined) {
      rejected.push({
        roleId: seed.roleId,
        code: 'ROLE_SEED_BAD_SCOPE_ID',
        missingParams: [],
        badParams,
      });
      errors.push(
        `${seed.roleId}: knowledgeScope 取值非法 ${badParams.join(', ')}` +
          `（须匹配 ${String(SAFE_SCOPE_ID)}；ROLE_SEED_BAD_SCOPE_ID，该角色零写入）`,
      );
      log.warn(
        { roleId: seed.roleId, code: 'ROLE_SEED_BAD_SCOPE_ID', badParams, degraded: true },
        '角色种子 scope id 格式非法 — 拒绝生成（零部分写）',
      );
      continue;
    }

    // ③ refs 投影 ⇒ 坏 source 拒绝写
    const projection = projectSeedRefs(seed);
    if (!projection.ok) {
      rejected.push({
        roleId: seed.roleId,
        code: 'ROLE_SEED_BAD_SOURCE',
        missingParams: projection.badParams,
      });
      errors.push(`${seed.roleId}: ${projection.messages.join('；')}（ROLE_SEED_BAD_SOURCE，该角色零写入）`);
      log.warn(
        { roleId: seed.roleId, code: 'ROLE_SEED_BAD_SOURCE', badParams: projection.badParams, degraded: true },
        '角色种子 context source 不可投影 — 拒绝生成（零部分写）',
      );
      continue;
    }

    const relDir = join(PRESETS_DIR, ROLES_SUBDIR, seed.roleId);
    const files = roleFiles(seed, projection.refs);
    if (dryRun) {
      for (const file of files) planned.push(join(relDir, file.name));
      continue;
    }

    const absDir = join(root, relDir);
    try {
      mkdirSync(absDir, { recursive: true });
    } catch (err: unknown) {
      const msg = `${relDir}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      log.error({ relDir, err }, '配置包目录创建失败 — degraded');
      continue;
    }
    for (const file of files) {
      const rel = join(relDir, file.name);
      try {
        writeFileSync(join(root, rel), file.body, 'utf8');
        written.push(rel);
      } catch (err: unknown) {
        const msg = `${rel}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        log.error({ rel, err }, '配置包写入失败 — degraded');
      }
    }
  }

  const degraded = errors.length > 0;
  log.info(
    { dryRun, written: written.length, planned: planned.length, rejected: rejected.length, degraded },
    '配置包生成完成',
  );
  return {
    written: written.sort(),
    planned: planned.sort(),
    skipped: skipped.sort(),
    rejected,
    degraded,
    errors,
  };
}
