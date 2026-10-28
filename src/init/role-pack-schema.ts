/**
 * src/init/role-pack-schema.ts — 岗位包 v3 结构契约与校验核（#1075 P1-a → P2-1）
 *
 * 架构位置: **引擎侧**（`src/init/`）读取**内容面**（`extensions/presets/**`）。方向单向：
 *   内容面零 import；本文件不写盘、不触网络。随仓 schema 是数据（`extensions/presets/schema/role-pack-v3.schema.json`），
 *   执行体是本文件的 zod（本仓无 ajv —— 见 §10-L5 的口径）。
 *
 * 设计哲学（一句）: **一个分离 ＋ 四条承诺** ——
 *   · **一个分离**：纯核（零 IO／无 async／不抛）与 IO 壳分离 ⇒ 规则可单测、问题可归因；
 *   · 承诺① **typed & 点名**：一切问题走 `RolePackProblemCode` ＋ 带具体 path/scope id 的消息；
 *   · 承诺② **双声明 drift 可核**：JSON Schema（契约）与 zod（执行体）键集由 `tests/init/role-pack-schema.test.ts` 钉死一致；
 *   · 承诺③ **三方对账**：`manifest.refs`（声明）↔ `contexts[].source` 的投影（内容）↔ 磁盘 `pieces`（实物）双向相等；
 *   · 承诺④ **指纹与校验同一次读**（#1075 P2-1）：六件原始字节只读一次，结构/refs 校验与 `contentHash` 共用同一份
 *     快照 ⇒ 校验结论与指纹之间无 TOCTOU 窗口（审批门据此判"内容是否被改"）。
 *
 * 契约（铁律 47）:
 *   @input  — `validateRolePackDir(roleDir, {repoRoot?})`（IO 壳）／
 *             `validateManifestDoc(doc, {roleId})`／`reconcileRefs(manifest, filesOnDisk, contentSources)`（纯核）／
 *             `projectContextSource(source, roleId)`（§2.4 投影规则**唯一实现**，P1-b 生成器复用）／
 *             `computeRolePackContentHash(pieces)`（纯核；入参 = 六件名＋**原始字节**，内部按 `ROLE_PACK_PIECES` 顺序，
 *             与入参数组顺序无关）
 *   @output — `RolePackValidation { ok, schemaVersion, problems[], refsChecked, contentHash? }`（纯数据）
 *             `refsChecked` = 本次对账实际比对的引用条数（`manifest.refs` 条目数 ＋ `contentSources` 条目数）；
 *             纯结构校验 `validateManifestDoc()` 恒 0。
 *             `contentHash` = 六件原始字节的 sha256（64 位小写 hex；`sha256(name + '\0' + bytes)` × 六件，按
 *             `ROLE_PACK_PIECES` 顺序，**无 canonical 化**），**仅 `ok:true` 时必有**；结构/refs 失败或早期返回
 *             （缺 manifest 等）**缺省** ⇒ 调用方不得在无 hash 时判审批（规格 §2.3-E / N4）。
 *   @degraded — **不抛**：读失败／JSON 坏／YAML 坏／形状非法一律折成 `problems`（typed code）。
 *             **`ROLE_PACK_DIR_UNREADABLE`**（#1104 / T4）：角色目录 `readdir` 失败（如 EACCES）也折成
 *             problem（点名目录＋原因）＋ `log.warn`，仍返回空集合 ⇒ 根因可归因，不再被吞。
 *             **`ROLE_PACK_ROLE_ID_MISMATCH`**（#1075 P2-1）：`manifest.roleId ≠ basename(roleDir)`（身份换牌／串岗）
 *             折成 problem（**点名两侧值**、不抛），并早退不做 refs 对账（身份不成立时对账无意义）。
 *             调用方（`src/init/preset-loader.ts`）把 problems 逐条折进 `errors[]` ＋ `degraded:true`
 *             ＋ `log.warn/error`（铁律 11/24/31：不静默、不打断 boot）。
 *   @authority — 生产消费者**唯一** = `src/init/preset-loader.ts`（经 `content-registry` 的 boot/reload 入口）；
 *             loader 把本函数产出的 `contentHash` 交给 `src/init/role-pack-approval.ts` 的
 *             `judgeRolePackApproval()` 判审批态（**本文件不判审批、不读审批记录**，防循环依赖 —— N6）。
 *             P1-b 生成器只复用 `projectContextSource()`（禁自创第二套投影）；其它模块不得复制本文件判定。
 *   @not-here  — 不做五件内容件的**字段级**校验（豁免清单 = `FIELD_LEVEL_VALIDATION_EXEMPT_PIECES`，
 *             恰好五件，测试钉死；P2 与各件读者同批落地）；不执行 JSON Schema；不做 IO 缓存；不改写磁盘；
 *             **不做 canonical 化**（指纹吃 raw bytes —— 跨平台前提见 §10-L12）。
 *
 * test-facing 导出（T1 分类要求；#1104 —— 以下五项**测试面消费**，不是"导出无人用"）:
 *   · `CONTENT_PIECES`／`FIELD_LEVEL_VALIDATION_EXEMPT_PIECES` —— 集合常量，测试钉死字面值（防豁免面悄悄扩大）；
 *   · `validateManifestDoc`／`reconcileRefs` —— 纯核，按 §4.5-C1 明列为契约面，测试直接驱动以观测 drift 行为；
 *   · `computeRolePackContentHash` —— 纯核（规格 §4.5-C1 明列），测试直接钉死 raw-bytes 语义（重排空白 ⇒ hash 变）。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `ROLE_PACK_SCHEMA_VERSION`／`ROLE_PACK_SCHEMA_POINTER` | v3 契约常量 |
 *   | `ROLE_PACK_PIECES`／`CONTENT_PIECES`／`FIELD_LEVEL_VALIDATION_EXEMPT_PIECES` | 六件／五件清单（单一出处） |
 *   | `validateManifestDoc()` | 结构校验（纯核；drift 面经其**行为**观测，键集常量不导出） |
 *   | `projectContextSource()` | §2.4 投影（纯函数） |
 *   | `computeRolePackContentHash()` | 六件原始字节指纹（纯核；审批门的判据来源） |
 *   | `validateManifestDoc()`／`reconcileRefs()` | 纯核 |
 *   | `validateRolePackDir()` | IO 壳（**六件单读快照** → 纯核 → 目标存在性 → 指纹） |
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L12**：`context-manifest.yaml`／`capabilities.yaml`／`acceptance-criteria.yaml`／`output-template.ref`
 *     的**字段级**形状不在本批校验（装载期只断存在/非空 ＋ pieces/refs 对账）；本文件对
 *     `context-manifest.yaml` 只读 `contexts[].source`（refs 对账所必需的**唯一**字段），其余字段不判。
 *   · **L2**：`kind=profile` 白名单仅 `business-plan`（无 profile 词汇表；P2 定表）。新增 `profile.*` 须与其读者同批。
 *   · **L5**：JSON Schema **不作执行体**（无 ajv）—— 与 zod 的一致性只靠 drift 测试，不靠运行时同判。
 *   · **存在性口径**（#1104 / 规格 §10-L14）：`kind=file` 按 `opts.repoRoot` 解析。**生产 loader 已显式传**
 *     由内容根派生的仓库根（`resolve(root,'../..')`），故 cwd≠仓库根时不再降级；本函数自身只在
 *     `opts.repoRoot` 缺省时回退 `process.cwd()`（仅供无内容根的裸调用，如测试/诊断）。
 *   · 其余 133 个扩展 manifest 的 `$schema` 同病未治（本文件只认岗位包 manifest）。
 *   · **P2-L10**（#1075 P2-1 / 规格 §10-L10）：`contentHash` 只覆盖 `ROLE_PACK_PIECES` 六件的**普通文件**原始字节；
 *     `listRoleDirFiles` 只收 `entry.isFile()` ⇒ 符号链接／子目录／多余散落文件**不进指纹**（今天无第七消费者；
 *     P2-2 接入前必须封）。
 *   · **P2-L12**（#1075 P2-1 / 规格 §10-L12，跨平台）：指纹吃**检出字节**（raw bytes，无 canonical 化）⇒ 依赖仓库
 *     `.gitattributes` 的 `extensions/presets/roles/** text eol=lf`。若撤该规则或新增内容根，Windows/autocrlf 下
 *     出厂三包指纹会全变（判据会红 —— 属**信号正确**）；P4 客户形态分发须带同一规则或改规范化字节定义。
 *   · **P2-L1**（#1075 P2-1 / 规格 §10-L1）：`contentHash` 是**工作流闸**的判据，不是抗伪造手段：能改文件的
 *     用户可重写记录并重算（零门槛）。抗伪造／取证／撤销持久归 P3（审计链）／P4（签名清单）。
 */
import { createLogger } from '@synova/logger';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

const log = createLogger('init/role-pack-schema');

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约常量（六件／五件清单的单一出处）
// ══════════════════════════════════════════════════════════════════════════════

/** 岗位包包契约版本（= manifest.schemaVersion；缺省**不**当当前版本） */
export const ROLE_PACK_SCHEMA_VERSION = 3;

/** 随仓 schema 指针（相对角色包目录；loader 只校验这个常量，仓内存在性由测试断言 —— §2.2-D4） */
export const ROLE_PACK_SCHEMA_POINTER = '../../schema/role-pack-v3.schema.json';

/**
 * 岗位包六件名（**单一字面量出处**；zod enum 与 `ROLE_PACK_PIECES` 都从这里来，防两份清单漂移）。
 * 顺序 = §2.5-B 的字面顺序（manifest.pieces 按此顺序写；判据按此顺序比对）。
 */
const PIECE_NAMES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/**
 * 岗位包六件（与 `manifest.pieces[]` 同源；`preset-loader.EXPECTED_PIECES` 由此派生）。
 * 注意：顺序是**契约的一部分**。
 */
export const ROLE_PACK_PIECES: readonly string[] = PIECE_NAMES;

/** 五件**内容**件（六件去掉 manifest 自身）—— 与 schema `$defs` 的五项一一对应 */
export const CONTENT_PIECES: readonly string[] = PIECE_NAMES.filter((piece) => piece !== 'manifest.json');

/**
 * **字段级校验豁免清单**（本批**恰好**这五件；测试钉死 —— 防"悄悄扩大豁免面"）。
 *
 * 语义：这五件的**字段级形状**本批**不**做 zod 校验（§10-L12：字段与其读者同批；P2 接读者时同步加）。
 * 装载期仍会：判存在且非空（loader）／`pieces`↔磁盘对账／`contexts[].source` 投影进 refs。
 * 🔴 本常量与 `CONTENT_PIECES` 当前同值，但**语义不同**：将来若有内容件进入字段级校验，
 *    应从本清单移除而**不必**从 `CONTENT_PIECES` 移除 ⇒ 两者不得合并且测试钉死本清单字面值。
 */
export const FIELD_LEVEL_VALIDATION_EXEMPT_PIECES: readonly string[] = [
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'acceptance-criteria.yaml',
  'output-template.ref',
  'capabilities.yaml',
];

// ══════════════════════════════════════════════════════════════════════════════
// 二、类型（typed problem；禁裸字符串 —— 铁律 32）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 校验问题码（§4.5-C1 的**十三个**码，逐一；禁自造第三方码）。
 * 前九个属「装载期结构/引用对账」（含 #1075 P2-1 的 `ROLE_PACK_ROLE_ID_MISMATCH` 身份绑定）；
 * `ROLE_PACK_DIR_UNREADABLE` 属「装载期 IO 根因」（#1104）；
 * 后三个属「生成期 seed」（P1-b 使用，本文件只定义类型不产出 —— 执行体在
 * `src/onboarding/config-pack-generator.ts`，规格 §10-L15）。
 */
export type RolePackProblemCode =
  | 'ROLE_PACK_MANIFEST_UNREADABLE'
  | 'ROLE_PACK_MANIFEST_INVALID'
  | 'ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED'
  | 'ROLE_PACK_SCHEMA_POINTER_INVALID'
  | 'ROLE_PACK_PIECES_MISMATCH'
  | 'ROLE_PACK_REF_MISSING'
  | 'ROLE_PACK_REF_UNDECLARED'
  | 'ROLE_PACK_REF_ORPHAN'
  | 'ROLE_PACK_ROLE_ID_MISMATCH'
  | 'ROLE_PACK_DIR_UNREADABLE'
  | 'ROLE_SEED_INCOMPLETE'
  | 'ROLE_SEED_BAD_SOURCE'
  | 'ROLE_SEED_BAD_SCOPE_ID';

/** 一条问题（纯数据；`message` 必须点名具体 path／scope id／文件名，供 grep） */
export interface RolePackProblem {
  readonly code: RolePackProblemCode;
  readonly message: string;
}

/** 校验结果（纯数据；**不抛**） */
export interface RolePackValidation {
  /** 无问题即 true（缺 manifest 导致跳过校验 ⇒ 调用方给 false —— 见 preset-loader 的 schemaValid） */
  readonly ok: boolean;
  /** `manifest.schemaVersion`（合法整数时；否则 null） */
  readonly schemaVersion: number | null;
  /** 逐条问题（空数组 = 通过） */
  readonly problems: readonly RolePackProblem[];
  /** 本次对账实际比对的引用条数（`manifest.refs` ＋ `contentSources`；纯结构校验恒 0） */
  readonly refsChecked: number;
  /**
   * 六件原始字节的内容指纹（64 位小写 hex；`sha256(name + '\0' + bytes)` × 六件，按 `ROLE_PACK_PIECES` 顺序）。
   *
   * 🔴 **仅 `ok:true` 时必有**（additive，规格 §2.3-E / N4）：结构/refs 失败或早期返回（缺 manifest 等）时
   * **缺省**（属性不存在）⇒ 调用方不得在无 hash 时判审批；判审批前必须先确认 `ok === true`。
   */
  readonly contentHash?: string;
}

/** refs 条目（三种 kind 的判别联合；与 `manifest.refs[]` 形状一一对应） */
export type RolePackRef =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'profile'; readonly name: string }
  | { readonly kind: 'scope'; readonly name: string };

/** `projectContextSource()` 的结果（判别联合；失败必带 typed code） */
export type ProjectedContextSource =
  | { readonly ok: true; readonly ref: RolePackRef }
  | { readonly ok: false; readonly code: 'ROLE_SEED_BAD_SOURCE'; readonly message: string };

// ══════════════════════════════════════════════════════════════════════════════
// 三、zod 执行体（schema 的镜像；键集 drift 由测试钉死）
// ══════════════════════════════════════════════════════════════════════════════

/** refs 条目：kind 判别 → file 必带 path／scope・profile 必带 name（与 schema 的 if/then 同判） */
const REF_ZOD = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), path: z.string().min(1) }),
  z.strictObject({ kind: z.literal('profile'), name: z.string().min(1) }),
  z.strictObject({ kind: z.literal('scope'), name: z.string().min(1) }),
]);

/**
 * manifest.json 的 zod 形状 —— **唯一真源**（schema JSON 是它的镜像，不是反过来）。
 * 键集与必填性 drift 断言在 `tests/init/role-pack-schema.test.ts`（J1-④/⑤）。
 */
const MANIFEST_ZOD = z.strictObject({
  $schema: z.literal(ROLE_PACK_SCHEMA_POINTER),
  schemaVersion: z.literal(ROLE_PACK_SCHEMA_VERSION),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: z.literal('role-preset'),
  displayName: z.string().min(1),
  entryPoint: z.string().min(1),
  roleId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  pieces: z
    .array(z.enum(PIECE_NAMES))
    .min(PIECE_NAMES.length)
    .max(PIECE_NAMES.length)
    .refine((pieces) => new Set(pieces).size === pieces.length, 'pieces 有重复项（须 uniqueItems）'),
  refs: z.array(REF_ZOD),
  note: z.string().optional(),
});

/** 收窄成"对象但不是数组"（铁律 38 替代式：内联类型 ＋ 类型守卫，不用 as 断言） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 值的人类可读类型（错误消息用；禁 `as` 断言） */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、§2.4 refs 投影规则 —— **唯一实现**（P1-b 生成器复用；禁第二套）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把 `context-manifest.yaml` 的一条 `contexts[].source` 投影为 `manifest.refs[]` 条目（§2.4）。
 *
 * 规则（顺序固定，不得调换）:
 *   ① 去空白；去锚（第一个 `#` 之前）后再去空白；
 *   ② `profile.<key>`（key 非空）⇒ `{kind:'profile', name:key}`；
 *   ③ 去锚值 = `knowledge-scope.yaml` 或 `<本包路径>/knowledge-scope.yaml`，且锚非空
 *      ⇒ `{kind:'scope', name:<锚>}` —— **不同时**记 file（否则 J2-② 反例恒绿）；
 *   ④ 其余含 `#` 的路径 ⇒ `{kind:'file', path:<去锚路径>}`；
 *   ⑤ 不含 `#` 的路径 ⇒ `{kind:'file', path:<原值>}`（相对仓库根）；
 *   ⑥ 其它（空值／`profile.` 空 key／仅锚点）⇒ `ROLE_SEED_BAD_SOURCE`（生成期拒绝，禁静默丢弃）。
 *
 * @param source - `contexts[].source` 原文
 * @param roleId - 角色 id（用于识别"本包 knowledge-scope.yaml"的完整路径形态）
 * @returns 判别联合：成功带 `ref`；失败带 typed `code` ＋ 点名消息
 *
 * @authority 纯函数；`src/init/preset-loader.ts` 的装载期对账与 P1-b 生成器共用本实现。
 */
export function projectContextSource(source: string, roleId: string): ProjectedContextSource {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 'ROLE_SEED_BAD_SOURCE', message: 'source 为空（无法投影为 refs）' };
  }

  const hashAt = trimmed.indexOf('#');
  const baseRaw = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
  const anchor = hashAt >= 0 ? trimmed.slice(hashAt + 1).trim() : '';
  const base = baseRaw.trim();
  if (base.length === 0) {
    return { ok: false, code: 'ROLE_SEED_BAD_SOURCE', message: `source「${trimmed}」只有锚点、没有路径` };
  }

  if (base.startsWith('profile.')) {
    const key = base.slice('profile.'.length).trim();
    if (key.length === 0) {
      return { ok: false, code: 'ROLE_SEED_BAD_SOURCE', message: `source「${trimmed}」的 profile key 为空` };
    }
    return { ok: true, ref: { kind: 'profile', name: key } };
  }

  const roleScopePath = `extensions/presets/roles/${roleId}/knowledge-scope.yaml`;
  const isOwnScopeFile = base === 'knowledge-scope.yaml' || base === roleScopePath;
  if (isOwnScopeFile && anchor.length > 0) {
    return { ok: true, ref: { kind: 'scope', name: anchor } };
  }

  // ④＋⑤：含锚取去锚路径，不含锚取原值 —— 两者都是 base（trim 后）。
  return { ok: true, ref: { kind: 'file', path: base } };
}

/** `refs` 条目的比较键（kind 字典序 → 标识字典序；§2.4 的稳定顺序） */
function refKey(ref: RolePackRef): string {
  return ref.kind === 'file' ? `file:${ref.path}` : `${ref.kind}:${ref.name}`;
}

/** 去重并按 §2.4 排序（kind 字典序 → 标识字典序） */
function uniqueSortedRefs(refs: readonly RolePackRef[]): readonly RolePackRef[] {
  const byKey = new Map<string, RolePackRef>();
  for (const ref of refs) {
    if (!byKey.has(refKey(ref))) byKey.set(refKey(ref), ref);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, ref]) => ref);
}

// ══════════════════════════════════════════════════════════════════════════════
// 四·五、纯核 ⓪ — 六件内容指纹（raw bytes；sha256）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 计算岗位包**内容指纹**（纯核；零 IO／不抛；规格 §4.5-C1 ＋ §2.2-D2）。
 *
 * 定义（逐字实现，**不得**加 canonical 化／不得排序键／不得剔除空白）:
 *   `sha256( for name in ROLE_PACK_PIECES: name_utf8 + 0x00 + rawBytes )` → 64 位小写 hex。
 *   六件 = `manifest.json` ＋ 五件内容件；`manifest` 的**原始字节**参与（不做 JSON 规范化）。
 *
 * 顺序语义: **与入参数组顺序无关** —— 本函数按 `ROLE_PACK_PIECES` 契约顺序重排后再喂 hash
 *   （未知件名排在六件之后、按名字典序），故"同一内容重排 JSON 空白"会把 hash **改掉**（raw bytes 语义），
 *   而"调用方按别的顺序传同一批字节"**不会**改 hash。
 *
 * @param pieces - 六件的 `{name, bytes}`（bytes 必须是磁盘原始字节；顺序无关）
 * @returns 64 位小写 hex（恒定返回；🔴 缺件时仍返回 hex，但此时不代表完整体 —— 调用方必须先保证六件齐备，
 *   `validateRolePackDir()` 只在 `ok:true`（六件齐备且结构/refs 通过）时才调用本函数）
 *
 * @authority 纯函数；生产唯一调用点 = `validateRolePackDir()`（同一份单读快照）。
 *   审批判定侧（`role-pack-approval.ts`）只**收** hash，不自己算（N6：防循环依赖）。
 */
export function computeRolePackContentHash(
  pieces: readonly { readonly name: string; readonly bytes: Buffer }[],
): string {
  const rank = new Map<string, number>(ROLE_PACK_PIECES.map((name, index) => [name, index]));
  const ordered = [...pieces].sort((left, right) => {
    const leftRank = rank.get(left.name) ?? ROLE_PACK_PIECES.length;
    const rightRank = rank.get(right.name) ?? ROLE_PACK_PIECES.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
  const hash = createHash('sha256');
  for (const piece of ordered) {
    hash.update(piece.name, 'utf8'); // 件名（UTF-8）
    hash.update(Buffer.from([0])); // 分隔符 '\0'（单字节 0x00）
    hash.update(piece.bytes); // 原始字节：**不**解码、**不**规范化
  }
  return hash.digest('hex');
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、纯核 ①  — manifest 结构校验（零 IO／无 async／不抛）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 校验 manifest 文档形状（纯核；不读盘）。
 *
 * 归因顺序: 非对象 ⇒ MANIFEST_INVALID；`schemaVersion` 缺失/≠3 ⇒ SCHEMA_VERSION_UNSUPPORTED；
 * `$schema` ≠ 常量 ⇒ SCHEMA_POINTER_INVALID；其余 zod 违规 ⇒ MANIFEST_INVALID（逐条带 path）。
 * 已由专用码报过的字段（`schemaVersion`／`$schema`）不重复报 MANIFEST_INVALID。
 *
 * @param doc - 已 `JSON.parse` 的 manifest 文档（`unknown`，绝不信任）
 * @param ctx.roleId - 角色 id（仅用于定位；消息本身不带前缀，由调用方统一加 `${roleId}: `）
 * @returns {@link RolePackValidation}（`refsChecked` 恒 0 —— 此函数不碰 refs 目标）
 */
export function validateManifestDoc(doc: unknown, ctx: { roleId: string }): RolePackValidation {
  void ctx; // roleId 供调用方定位；消息不带前缀（loader 统一 `${roleId}: ${code} ${message}`）
  const problems: RolePackProblem[] = [];

  if (!isRecord(doc)) {
    problems.push({
      code: 'ROLE_PACK_MANIFEST_INVALID',
      message: `manifest.json 顶层不是对象（实测 ${describeValue(doc)}）`,
    });
    return { ok: false, schemaVersion: null, problems, refsChecked: 0 };
  }

  const rawVersion = doc['schemaVersion'];
  const schemaVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : null;
  let versionReported = false;
  if (schemaVersion !== ROLE_PACK_SCHEMA_VERSION) {
    versionReported = true;
    problems.push({
      code: 'ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED',
      message:
        rawVersion === undefined
          ? `schemaVersion 缺失（本装载器只接受 ${String(ROLE_PACK_SCHEMA_VERSION)}，禁缺省当 ${String(ROLE_PACK_SCHEMA_VERSION)}）`
          : `schemaVersion=${String(rawVersion)} 不受支持（只接受 ${String(ROLE_PACK_SCHEMA_VERSION)}，禁向上兼容猜测）`,
    });
  }

  const rawPointer = doc['$schema'];
  let pointerReported = false;
  if (rawPointer !== ROLE_PACK_SCHEMA_POINTER) {
    pointerReported = true;
    problems.push({
      code: 'ROLE_PACK_SCHEMA_POINTER_INVALID',
      message: `$schema=${JSON.stringify(rawPointer)} ≠ ${ROLE_PACK_SCHEMA_POINTER}`,
    });
  }

  const parsed = MANIFEST_ZOD.safeParse(doc);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = issue.path.length > 0 ? String(issue.path[0]) : '';
      if (versionReported && head === 'schemaVersion') continue;
      if (pointerReported && head === '$schema') continue;
      const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `${where}: ${issue.message}` });
    }
    // 边界：zod 唯一失败项就是已被专用码报过的字段 ⇒ 不额外造问题（避免同因双报）
    if (problems.length === 0) {
      problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: 'manifest.json 不符合 v3 结构契约' });
    }
  }

  return { ok: problems.length === 0, schemaVersion, problems, refsChecked: 0 };
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、纯核 ②  — refs 三方对账（零 IO／无 async／不抛）
// ══════════════════════════════════════════════════════════════════════════════

/** 解析 `manifest.refs`（纯核；非法条目 ⇒ MANIFEST_INVALID，返回已解析的合法条目） */
function parseDeclaredRefs(rawRefs: unknown, problems: RolePackProblem[]): readonly RolePackRef[] {
  if (!Array.isArray(rawRefs)) {
    problems.push({
      code: 'ROLE_PACK_MANIFEST_INVALID',
      message: `refs 不是数组（实测 ${describeValue(rawRefs)}）`,
    });
    return [];
  }
  const refs: RolePackRef[] = [];
  for (const [index, entry] of rawRefs.entries()) {
    if (!isRecord(entry)) {
      problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `refs[${String(index)}] 不是对象` });
      continue;
    }
    const kind = entry['kind'];
    if (kind === 'file') {
      const path = entry['path'];
      if (typeof path !== 'string' || path.trim().length === 0) {
        problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `refs[${String(index)}].path 缺非空字符串（kind=file）` });
        continue;
      }
      refs.push({ kind: 'file', path });
    } else if (kind === 'scope' || kind === 'profile') {
      const name = entry['name'];
      if (typeof name !== 'string' || name.trim().length === 0) {
        problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `refs[${String(index)}].name 缺非空字符串（kind=${kind}）` });
        continue;
      }
      refs.push(kind === 'scope' ? { kind: 'scope', name } : { kind: 'profile', name });
    } else {
      problems.push({
        code: 'ROLE_PACK_MANIFEST_INVALID',
        message: `refs[${String(index)}].kind=${JSON.stringify(kind)} 不在 [file, profile, scope]`,
      });
    }
  }
  return refs;
}

/**
 * refs 三方对账（纯核；**不自查目标存在性** —— 那需要 IO，归 IO 壳）:
 *   ① 声明→磁盘：`manifest.pieces` 集合 === `filesOnDisk` 集合（不等 ⇒ ROLE_PACK_PIECES_MISMATCH，点名两侧差集）；
 *   ② 内容→声明：`contentSources` 逐条 `projectContextSource()` 后去重排序，与 `manifest.refs` 集合比较
 *      —— 内容有而声明无 ⇒ ROLE_PACK_REF_UNDECLARED；声明有而内容无 ⇒ ROLE_PACK_REF_ORPHAN；
 *   ③ `kind=profile` 白名单：本批仅 `business-plan`（其余 ⇒ ROLE_PACK_REF_MISSING，§10-L2）。
 * ④ `kind=file` 的路径存在性、`kind=scope` 的 `scopes[].id` 命中由 IO 壳补（需读盘）。
 *
 * @param manifest - 已通过结构校验的 manifest 文档（`unknown`；本函数仍做形状防御）
 * @param filesOnDisk - 角色目录内的**文件名**清单（IO 壳 readdir 得来）
 * @param contentSources - `context-manifest.yaml` 的 `contexts[].source` 原文清单
 * @returns {@link RolePackValidation}（`refsChecked` = refs 条目数 ＋ source 条目数）
 */
export function reconcileRefs(
  manifest: unknown,
  filesOnDisk: readonly string[],
  contentSources: readonly string[],
): RolePackValidation {
  const problems: RolePackProblem[] = [];
  if (!isRecord(manifest)) {
    problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: 'manifest 顶层不是对象 ⇒ 无法对账' });
    return { ok: false, schemaVersion: null, problems, refsChecked: 0 };
  }
  const rawVersion = manifest['schemaVersion'];
  const schemaVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : null;

  // ① pieces ↔ 磁盘（双向相等）
  const rawPieces = manifest['pieces'];
  const declaredPieces = Array.isArray(rawPieces) ? rawPieces.filter((piece): piece is string => typeof piece === 'string') : [];
  const declaredSet = [...new Set(declaredPieces)].sort();
  const diskSet = [...new Set(filesOnDisk)].sort();
  const onlyOnDisk = diskSet.filter((name) => !declaredSet.includes(name));
  const onlyDeclared = declaredSet.filter((name) => !diskSet.includes(name));
  if (onlyOnDisk.length > 0 || onlyDeclared.length > 0) {
    problems.push({
      code: 'ROLE_PACK_PIECES_MISMATCH',
      message:
        `pieces 与磁盘文件集不等（磁盘多出: ${onlyOnDisk.length > 0 ? onlyOnDisk.join(', ') : '无'}；` +
        `声明多出: ${onlyDeclared.length > 0 ? onlyDeclared.join(', ') : '无'}）`,
    });
  }

  // ② 解析声明侧 refs ＋ ③ profile 白名单
  const declaredRefs = parseDeclaredRefs(manifest['refs'], problems);
  for (const ref of declaredRefs) {
    if (ref.kind === 'profile' && ref.name !== 'business-plan') {
      problems.push({
        code: 'ROLE_PACK_REF_MISSING',
        message: `profile 命名空间白名单外：profile.${ref.name}（本批仅允许 business-plan，§10-L2）`,
      });
    }
  }

  // ② 内容侧投影
  const projected: RolePackRef[] = [];
  for (const source of contentSources) {
    const result = projectContextSource(source, typeof manifest['roleId'] === 'string' ? manifest['roleId'] : '');
    if (!result.ok) {
      problems.push({ code: result.code, message: `context source「${source}」— ${result.message}` });
      continue;
    }
    projected.push(result.ref);
  }
  const projectedKeys = uniqueSortedRefs(projected).map(refKey);
  const declaredKeys = uniqueSortedRefs(declaredRefs).map(refKey);
  for (const key of projectedKeys) {
    if (!declaredKeys.includes(key)) {
      problems.push({
        code: 'ROLE_PACK_REF_UNDECLARED',
        message: `context source 投影出的 ref 未在 manifest.refs 声明：${key}`,
      });
    }
  }
  for (const key of declaredKeys) {
    if (!projectedKeys.includes(key)) {
      problems.push({
        code: 'ROLE_PACK_REF_ORPHAN',
        message: `manifest.refs 声明的条目在 context-manifest 中无对应 source（孤儿引用）：${key}`,
      });
    }
  }

  return {
    ok: problems.length === 0,
    schemaVersion,
    problems,
    refsChecked: declaredRefs.length + contentSources.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、IO 壳 —— 读盘 → 纯核 → 目标存在性（全同步；不抛）
// ══════════════════════════════════════════════════════════════════════════════

/** IO 壳选项 */
export interface ValidateRolePackDirOptions {
  /**
   * 仓库根（`kind=file` 的相对基准）。
   * #1104：生产 loader **由内容根派生**（`resolve(root,'../..')`）后显式传入；缺省 `process.cwd()`
   * 仅兜无内容根的裸调用（测试/诊断），不得作为生产路径依赖（规格 §10-L14）。
   */
  readonly repoRoot?: string;
}

/** 读失败件（`missing` = ENOENT；缺件由 pieces 对账另行点名，不在此重复报） */
interface PieceReadFailure {
  readonly name: string;
  readonly missing: boolean;
  readonly reason: string;
}

/**
 * 六件**原始字节**的单读快照 —— 结构/refs 校验与内容指纹**共用**这一份字节（#1075 P2-1 / D2）。
 *
 * 为什么单读：若校验收到的字节与指纹吃到的字节来自两次读，两者之间文件可被改写 ⇒ 校验结论与
 * `contentHash` 描述的不是同一份内容（TOCTOU）；审批门据此判"内容是否被改"，故必须同源。
 */
interface PieceBytesSnapshot {
  /** 成功读到的件 → 原始字节（**不经 canonical 化**，指纹直接吃这些字节） */
  readonly bytes: ReadonlyMap<string, Buffer>;
  /** 读失败件（空数组 = 六件齐备） */
  readonly failures: readonly PieceReadFailure[];
}

/** 取 errno code（铁律 38 替代式：类型守卫，不用 `as` 断言；非对象 ⇒ 空串） */
function errnoCode(err: unknown): string {
  if (!isRecord(err)) return '';
  const code = err['code'];
  return typeof code === 'string' ? code : '';
}

/**
 * 一次性读六件原始字节（`ROLE_PACK_PIECES` 顺序；**每件只读一次**）。
 *
 * @param roleDir - 角色包目录（绝对路径）
 * @returns {@link PieceBytesSnapshot}（**不抛**：读失败折成 `failures`，由调用方按"缺件/不可读"分别归因）
 */
function snapshotPieceBytes(roleDir: string): PieceBytesSnapshot {
  const bytes = new Map<string, Buffer>();
  const failures: PieceReadFailure[] = [];
  for (const name of ROLE_PACK_PIECES) {
    try {
      bytes.set(name, readFileSync(join(roleDir, name)));
    } catch (err: unknown) {
      failures.push({
        name,
        missing: errnoCode(err) === 'ENOENT',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { bytes, failures };
}

/** 取某件的读失败原因（未失败 ⇒ 占位串；仅用于消息拼接） */
function readFailureReason(snapshot: PieceBytesSnapshot, name: string): string {
  const failure = snapshot.failures.find((candidate) => candidate.name === name);
  return failure === undefined ? '未记录原因' : failure.reason;
}

/** 解析一份 YAML **原始字节**（失败 ⇒ 点名消息；不抛） */
function parseYamlBytes(
  absPath: string,
  bytes: Buffer,
): { readonly ok: true; readonly doc: unknown } | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, doc: parseYaml(bytes.toString('utf8')) };
  } catch (err: unknown) {
    return { ok: false, message: `${absPath}: YAML 解析失败 — ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 从 `context-manifest.yaml` 收集 `contexts[].source`（其余字段不判 —— §10-L12） */
function collectContextSources(doc: unknown, absPath: string, problems: RolePackProblem[]): readonly string[] {
  if (doc === null || doc === undefined) return []; // 空文档 ⇒ 未声明（KL-T1-1 同族语义）
  if (!isRecord(doc)) {
    problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `${absPath}: 顶层不是映射（实测 ${describeValue(doc)}）` });
    return [];
  }
  const rawContexts = doc['contexts'];
  if (rawContexts === null || rawContexts === undefined) {
    problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `${absPath}: 缺 contexts 清单（refs 对账无法投影）` });
    return [];
  }
  if (!Array.isArray(rawContexts)) {
    problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `${absPath}: contexts 不是数组（实测 ${describeValue(rawContexts)}）` });
    return [];
  }
  const sources: string[] = [];
  for (const [index, entry] of rawContexts.entries()) {
    if (!isRecord(entry)) {
      problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: `${absPath}: contexts[${String(index)}] 不是映射` });
      continue;
    }
    const source = entry['source'];
    if (typeof source !== 'string' || source.trim().length === 0) {
      problems.push({
        code: 'ROLE_PACK_MANIFEST_INVALID',
        message: `${absPath}: contexts[${String(index)}].source 缺非空字符串（refs 对账必需）`,
      });
      continue;
    }
    sources.push(source);
  }
  return sources;
}

/**
 * 从 `knowledge-scope.yaml` 收集 `scopes[].id`（**吃同一份单读快照**；缺件/坏件 ⇒ 空集合）。
 * 缺件由 pieces 对账报，不在此重复；坏件（YAML 语法）走 `ROLE_PACK_MANIFEST_INVALID` 点名文件。
 */
function collectScopeIds(
  roleDir: string,
  snapshot: PieceBytesSnapshot,
  problems: RolePackProblem[],
): readonly string[] {
  const bytes = snapshot.bytes.get('knowledge-scope.yaml');
  if (bytes === undefined) return []; // 缺件由 pieces 对账报，不在此重复
  const absPath = join(roleDir, 'knowledge-scope.yaml');
  const read = parseYamlBytes(absPath, bytes);
  if (!read.ok) {
    problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: read.message });
    return [];
  }
  if (!isRecord(read.doc)) return [];
  const rawScopes = read.doc['scopes'];
  if (!Array.isArray(rawScopes)) return [];
  const ids: string[] = [];
  for (const entry of rawScopes) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

/**
 * 列角色目录内的**文件**名（不含子目录）。
 *
 * #1104 / T4（规格 §10 的 T4：catch 无 log ⇒ 静默降级）：目录不可读（如 EACCES／ENOTDIR）不再被吞 ——
 *   `log.warn` 带 `code: 'ROLE_PACK_DIR_UNREADABLE'` ＋ `problems` 点名目录与原因，**仍返回空集合（不抛）**。
 *
 * @param roleDir - 角色包目录（绝对路径）
 * @param problems - 逐条问题累加器（调用方持有；本函数 push，不抛）
 * @returns 文件名数组（不可读 ⇒ `[]`，原因已在 `problems` 与 warn 日志里）
 */
function listRoleDirFiles(roleDir: string, problems: RolePackProblem[]): readonly string[] {
  try {
    return readdirSync(roleDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    // 铁律 11/24/31：根因（EACCES 等）必须可归因，不许静默吞掉
    log.warn({ roleDir, code: 'ROLE_PACK_DIR_UNREADABLE', err }, '角色目录不可读 — 逐条点名（不抛）');
    problems.push({ code: 'ROLE_PACK_DIR_UNREADABLE', message: `${roleDir}: 目录不可读 — ${reason}` });
    return []; // 仍不抛：pieces 对账会连带点名（调用方见 mismatch）
  }
}

/**
 * 校验一个角色包目录（IO 壳；全同步、**不抛**）。
 *
 * 流程（#1075 P2-1 起**六件原始字节只读一次**；结构/refs 校验与内容指纹共用该快照）:
 *   ① 单读六件原始字节（`snapshotPieceBytes`；读失败折成 `failures`，不抛）；
 *   ② `manifest.json` 读失败/JSON 坏 ⇒ `ROLE_PACK_MANIFEST_UNREADABLE`（提前返回，无 `contentHash`）；
 *   ③ `validateManifestDoc()`（结构；失败 ⇒ 提前返回，无 `contentHash`）；
 *   ④ **身份绑定** `manifest.roleId === basename(roleDir)`（失败 ⇒ `ROLE_PACK_ROLE_ID_MISMATCH`，提前返回）；
 *   ⑤ `context-manifest.yaml` 的 `contexts[].source` ＋ `knowledge-scope.yaml` 的 `scopes[].id`（同一快照）；
 *   ⑥ `reconcileRefs()` ＋ 补两项目标存在性：
 *      · `kind=file`：路径在 `repoRoot` 下存在（否则 `ROLE_PACK_REF_MISSING`，点名 path）；
 *      · `kind=scope`：name 命中同包 `scopes[].id`（否则 `ROLE_PACK_REF_MISSING`，点名 scope id）；
 *   ⑦ **全部通过**才产出 `contentHash`（六件原始字节 sha256；`ok:false` 时该属性**缺省**）。
 *
 * 🔴 结构校验未通过时**不**做 refs 对账（避免级联噪音）；`refsChecked` 为 0。
 * 🔴 `contentHash` 语义 = 工作流闸判据（能改文件者可重算，**不防伪造** —— 规格 §10-L1/P2）。
 *
 * @param roleDir - 角色包目录（绝对路径；如 `<root>/extensions/presets/roles/finance`）
 * @param opts.repoRoot - `kind=file` 的解析基准。**生产 loader 由内容根派生并显式传入**（#1104 / §10-L14）；
 *   缺省 `process.cwd()` 只兜裸调用（无内容根的测试/诊断），不得作为生产路径依赖。
 * @returns {@link RolePackValidation}（`ok:true` ⇒ 必有 `contentHash`；`ok:false` ⇒ 无该属性）
 *
 * @authority 生产消费者唯一 = `src/init/preset-loader.ts` 的 `readRolePack()`（boot/reload 同一入口）；
 *   它把 `contentHash` 交给 `role-pack-approval.ts` 判审批态（本函数不判审批）。
 */
export function validateRolePackDir(roleDir: string, opts: ValidateRolePackDirOptions = {}): RolePackValidation {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const directoryRoleId = basename(roleDir);
  const problems: RolePackProblem[] = [];
  const manifestPath = join(roleDir, 'manifest.json');

  // 1) 六件原始字节的单读快照（结构/refs 校验与内容指纹共用；🔴 不二次读盘 —— TOCTOU 关闭）
  const snapshot = snapshotPieceBytes(roleDir);

  // 2) manifest：读失败/JSON 坏 ⇒ UNREADABLE（读不到就是读不到；此时无 contentHash）
  const manifestBytes = snapshot.bytes.get('manifest.json');
  if (manifestBytes === undefined) {
    problems.push({
      code: 'ROLE_PACK_MANIFEST_UNREADABLE',
      message: `${manifestPath}: 读取失败 — ${readFailureReason(snapshot, 'manifest.json')}`,
    });
    return { ok: false, schemaVersion: null, problems, refsChecked: 0 };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(manifestBytes.toString('utf8'));
  } catch (err: unknown) {
    problems.push({
      code: 'ROLE_PACK_MANIFEST_UNREADABLE',
      message: `${manifestPath}: JSON 解析失败 — ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false, schemaVersion: null, problems, refsChecked: 0 };
  }

  // 3) 结构校验（纯核）
  const structural = validateManifestDoc(doc, { roleId: directoryRoleId });
  problems.push(...structural.problems);
  if (!structural.ok) {
    return { ok: false, schemaVersion: structural.schemaVersion, problems, refsChecked: 0 };
  }

  // 4) 身份绑定（#1075 P2-1）：manifest.roleId 必须 === basename(roleDir)
  //    角色唯一 id = 目录名（审批记录键 `approvals/<roleId>.json` 与指纹绑定同源）；违反 ⇒ 点名两侧、不抛
  const declaredRoleId = isRecord(doc) && typeof doc['roleId'] === 'string' ? doc['roleId'] : '';
  if (declaredRoleId !== directoryRoleId) {
    problems.push({
      code: 'ROLE_PACK_ROLE_ID_MISMATCH',
      message:
        `manifest.roleId=${JSON.stringify(declaredRoleId)} ≠ 目录名 ${JSON.stringify(directoryRoleId)}` +
        '（角色唯一 id = 目录名；审批记录键与内容指纹绑定同源 ⇒ 身份换牌/串岗一律拒）',
    });
    return { ok: false, schemaVersion: structural.schemaVersion, problems, refsChecked: 0 };
  }

  // 5) 内容面（refs 对账输入）—— 同一份字节快照，不再读盘
  const contextPath = join(roleDir, 'context-manifest.yaml');
  const contextBytes = snapshot.bytes.get('context-manifest.yaml');
  if (contextBytes === undefined) {
    problems.push({
      code: 'ROLE_PACK_MANIFEST_INVALID',
      message: `${contextPath}: 读取失败 — ${readFailureReason(snapshot, 'context-manifest.yaml')}`,
    });
    return { ok: false, schemaVersion: structural.schemaVersion, problems, refsChecked: 0 };
  }
  const contextRead = parseYamlBytes(contextPath, contextBytes);
  if (!contextRead.ok) {
    problems.push({ code: 'ROLE_PACK_MANIFEST_INVALID', message: contextRead.message });
    return { ok: false, schemaVersion: structural.schemaVersion, problems, refsChecked: 0 };
  }
  const contentSources = collectContextSources(contextRead.doc, contextPath, problems);
  const scopeIds = collectScopeIds(roleDir, snapshot, problems);

  // 6) 三方对账（纯核）＋磁盘文件集（readdir 失败 ⇒ DIR_UNREADABLE，仍返回 []）
  const filesOnDisk = listRoleDirFiles(roleDir, problems);
  const reconciled = reconcileRefs(doc, filesOnDisk, contentSources);
  problems.push(...reconciled.problems);

  // 6b) 磁盘在册却读不出（EACCES 等）：点名该件
  //     ENOENT 缺件已由 PIECES_MISMATCH 单条归因（禁级联双报）
  for (const failure of snapshot.failures) {
    if (failure.missing || failure.name === 'manifest.json') continue;
    if (!filesOnDisk.includes(failure.name)) continue;
    problems.push({
      code: 'ROLE_PACK_MANIFEST_INVALID',
      message: `${join(roleDir, failure.name)}: 读取失败 — ${failure.reason}`,
    });
  }

  // 7) 目标存在性（只有 IO 壳能做）
  const manifestRecord: Record<string, unknown> = isRecord(doc) ? doc : {};
  const declaredRefs = parseDeclaredRefs(manifestRecord['refs'], []);
  for (const ref of declaredRefs) {
    if (ref.kind === 'file') {
      if (!existsSync(join(repoRoot, ref.path))) {
        problems.push({
          code: 'ROLE_PACK_REF_MISSING',
          message: `refs 悬空 — file ${ref.path} 在仓库根 ${repoRoot} 下不存在`,
        });
      }
    } else if (ref.kind === 'scope') {
      if (!scopeIds.includes(ref.name)) {
        problems.push({
          code: 'ROLE_PACK_REF_MISSING',
          message: `refs 悬空 — scope ${ref.name} 不在同包 knowledge-scope.yaml 的 scopes[].id 中（实测 ${scopeIds.length} 个）`,
        });
      }
    }
  }

  // 8) 内容指纹：只有 `ok:true`（结构/refs 全过且六件字节齐备）才产出 —— 否则 `contentHash` 属性缺省
  const hashPieces: { readonly name: string; readonly bytes: Buffer }[] = [];
  for (const name of ROLE_PACK_PIECES) {
    const pieceBytes = snapshot.bytes.get(name);
    if (pieceBytes === undefined) {
      problems.push({
        code: 'ROLE_PACK_MANIFEST_INVALID',
        message: `${join(roleDir, name)}: 原始字节缺失 — 内容指纹无法产出（六件必须齐备）`,
      });
      break;
    }
    hashPieces.push({ name, bytes: pieceBytes });
  }

  if (problems.length > 0) {
    return { ok: false, schemaVersion: structural.schemaVersion, problems, refsChecked: reconciled.refsChecked };
  }
  return {
    ok: true,
    schemaVersion: structural.schemaVersion,
    problems,
    refsChecked: reconciled.refsChecked,
    contentHash: computeRolePackContentHash(hashPieces),
  };
}
