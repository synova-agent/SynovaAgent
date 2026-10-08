/**
 * src/extensions/profession-layer.ts — L1.5 专业包层（内容四层覆盖机制）
 *
 * 卡: #1056（3-11 专业包层 L1.5 机制）｜宪章 5.2 通用性四层覆盖 / P2
 *
 *   宪章 5.2 原文四层：
 *     L0 基线（我们维护）/ L1 行业包（我们维护）/
 *     L1.5 专业包（**第三方维护，可跨客户复用**）/ L2 客户层（客户/我们配）
 *   叠加规则：**下层覆盖上层，不是替换**
 *   判据原文：「能不能在另一个客户原样再用一次？」⇒ 同一专业包须能被 ≥2 个 orgId 同时命中
 *   防碎片化硬规矩：「同一东西在 ≥2 个客户出现 ⇒ 必须提升一层」
 *     ⇒ 本文件 detectCustomerFragmentation() 使该规矩**可被检测**（不建则 L1.5 建了也会被绕过）。
 *
 * 覆盖顺序（本文件是唯一事实源 CONTENT_LAYER_ORDER）：
 *   builtin（L0） < industry（L1） < **profession（L1.5）** < custom（L2）
 *   同名键由更高层**整值**胜出；更低层**未被覆盖**的键保留（叠加，非替换）。
 *
 * ⚠️ 硬约束（卡面 §③.2）：本文件与 src/config/config-layers.ts 是**两套互不相干的层名**。
 *   那件 LayerName = default|industry|customer|workspace 是**客户配置包轴**（D599 / DSH 借鉴卡 B-10）；
 *   本文件是**内容通用性轴**（宪章 5.2）。两者层名不同轴、不可互推。
 *   ⇒ 本文件**只复用其归并内核 mergeLayers（稀疏 patch 语义）**，
 *      **不复用其 LAYER_ORDER**（卡面原文明令）。
 *
 * ⚠️ 硬约束（卡面 §③.3）：L1.5 的物理载体 = `extensions/` 下的**内容目录**（加文件即生效，P1）。
 *   专业包**不得**被编进宿主 TS 常量；本文件只提供「怎么合」，不提供「合什么」。
 *
 * 契约（铁律 47）:
 *   - CONTENT_LAYER_ORDER: 层序的唯一事实源（升序优先，后者胜）。
 *   - resolveContentLayers({orgId, industry, profession, baseDir?, roots?, contentFile?}):
 *       逐层读 `<root>/<contentFile>` → 按 CONTENT_LAYER_ORDER 归并。
 *       输入: orgId/industry/profession 必填；baseDir/roots/contentFile 可选（roots 可只覆盖部分层）。
 *       输出: { orgId, resolved, layers[], degraded, errors[] }；resolved 为 detached clone。
 *       降级: 目录或文件**不存在** → 该层 present=false，**不报错、degraded 不变**（ENOENT 是正常默认，铁律 24）；
 *             文件存在但读取/JSON 解析失败、或非 plain object → 该层跳过 + log.warn + errors[] + degraded=true。
 *       永不抛错。
 *   - loadProfessionPackages({baseDir?}): 文件驱动发现 `extensions/professions/<专业包>/manifest.json`。
 *       输出: { packages[], degraded, errors[] }。目录不存在 → 空结果 + degraded=false；
 *             非目录项 / `_` 前缀 / 缺 manifest → 跳过（缺 manifest 记 log.warn）；JSON 解析失败 → errors[] + degraded=true。
 *       永不抛错。
 *   - detectCustomerFragmentation({baseDir?, customerRoot?, contentFile?}):
 *       扫 `<customerRoot>/<orgId>/`，逐 org 读内容文档 → **叶子键路径**在 ≥2 个 org 上**深度相等** ⇒ finding + log.warn。
 *       输出: { scannedOrgs[], findings[], degraded, errors[] }。永不抛错。
 *
 * 层根目录约定（**一律沿用既有约定，不新造顶层目录**）：
 *   builtin    → `extensions/industries/general-enterprise/`（既有 L0 基线行业包）
 *   industry   → `extensions/industries/<industry>/`（既有 L1 行业包）
 *   profession → `extensions/professions/<profession>/`（**本卡新建**，卡面 §④ 授权）
 *   custom     → `<DEFAULT_ROOT_NAME>/<orgId>/`，即既有 L2 客户配置包根
 *                （`src/config/customer-config-package.ts` 的 `customer-config/<orgId>/`，
 *                 决策点 2；此处**复用其根名常量**以免两处漂移，未新造目录约定）
 *
 * 内容文档形状：沿用本仓既有内容包形状（`extensions/industries/<行业>/thresholds.json`：plain object）。
 * 本机制对形状无假设——任意 plain object 都按同名键整值/递归归并；更丰富的 schema 由
 * 《extensions内容面规范-v0.1》收口，本卡不擅自扩 schema。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'node:fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';
import { mergeLayers } from '../config/config-layers';
import { DEFAULT_ROOT_NAME } from '../config/customer-config-package';

const log = createLogger('extensions/profession-layer');

// ═══ 层序（唯一事实源；升序优先 = 数组后者覆盖前者） ═══

/** 内容四层名，按**应用顺序**排列（后者覆盖前者）：builtin < industry < profession < custom。 */
export const CONTENT_LAYER_ORDER = ['builtin', 'industry', 'profession', 'custom'] as const;

/** 内容层名。由 CONTENT_LAYER_ORDER 派生——层序只有一个事实源，避免两处漂移。 */
export type ContentLayerName = (typeof CONTENT_LAYER_ORDER)[number];

/** 每层内容文档文件名。默认值对齐既有内容包形状（extensions/industries/<行业>/thresholds.json）。 */
const LAYER_CONTENT_FILE = 'thresholds.json';

/** 专业包声明文件名。 */
const PROFESSION_MANIFEST_FILE = 'manifest.json';

/** 专业包目录中以下划线开头者视为模板/草稿，不参与发现（沿用 playbook-loader 约定）。 */
const SKIP_PREFIX = '_';

// ═══ 根目录 ═══

/** 四层根目录（绝对路径）。 */
export interface ContentRoots {
  /** L0 基线：`extensions/industries/general-enterprise/`。 */
  builtin: string;
  /** L1 行业包：`extensions/industries/<industry>/`。 */
  industry: string;
  /** L1.5 专业包：`extensions/professions/<profession>/`（第三方维护，可跨客户复用）。 */
  profession: string;
  /** L2 客户层：`<customer-config>/<orgId>/`（沿用既有客户配置包根名，本卡只引用路径、不创建目录）。 */
  custom: string;
}

/** 根目录派生入参。 */
export interface RootInput {
  /** 仓库根；缺省 = process.cwd()。 */
  baseDir?: string;
  /** L1 行业包标识（如 retail-ecommerce）。 */
  industry: string;
  /** L1.5 专业包标识（如 chain-retail-expansion）。 */
  profession: string;
  /** L2 客户标识。**专业包与 orgId 无耦合**——这正是"跨客户复用"的物理保证。 */
  orgId: string;
}

/**
 * 由 baseDir + 三个标识派生四层默认根目录（纯函数，无 I/O）。
 * @param input - baseDir（可选）与 industry/profession/orgId。
 * @returns 四层根目录绝对路径。
 */
function defaultContentRoots(input: RootInput): ContentRoots {
  const base = input.baseDir ?? process.cwd();
  return {
    builtin: join(base, 'extensions', 'industries', 'general-enterprise'),
    industry: join(base, 'extensions', 'industries', input.industry),
    profession: join(base, 'extensions', 'professions', input.profession),
    custom: join(base, DEFAULT_ROOT_NAME, input.orgId),
  };
}

// ═══ 内部工具 ═══

/** 是否 plain data object（非数组、非 null、原型为 Object.prototype 或 null）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** JSON round-trip 深拷贝（detached；内容文档为 plain JSON）。 */
function detachJson(value: unknown): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(value ?? {}));
  return isPlainRecord(cloned) ? cloned : {};
}

/**
 * 读一层内容文档。
 * ENOENT（目录/文件不存在）是**正常默认**——静默返回 null，不记 error（铁律 24）。
 * 存在但读不了 / 解析不了 / 不是 plain object → log.warn + 记 error（degraded 由调用方传播，铁律 31）。
 */
function readLayerDoc(root: string, fileName: string, errors: string[]): Record<string, unknown> | null {
  const path = join(root, fileName);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ path, err: msg }, '内容层文档读取失败 — 该层跳过（degraded）');
    errors.push(`${path}: 读取失败 ${msg}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ path, err: msg }, '内容层文档 JSON 解析失败 — 该层跳过（degraded）');
    errors.push(`${path}: JSON 解析失败 ${msg}`);
    return null;
  }
  if (!isPlainRecord(parsed)) {
    log.warn({ path }, '内容层文档不是 plain object — 该层跳过（degraded）');
    errors.push(`${path}: 内容层文档必须是 plain object`);
    return null;
  }
  return parsed;
}

// ═══ 四层归并 ═══

/** 入参：三层解析上下文 + 可选覆盖。 */
export interface ResolveInput extends RootInput {
  /** 覆盖部分层根目录（只覆盖给定层，其余走 defaultContentRoots）。 */
  roots?: Partial<ContentRoots>;
  /** 覆盖内容文档文件名（缺省 LAYER_CONTENT_FILE）。 */
  contentFile?: string;
}

/** 单层贡献行（provenance）。 */
export interface LayerContribution {
  /** 层名。 */
  layer: ContentLayerName;
  /** 该层根目录（绝对路径）。 */
  root: string;
  /** 该层内容文档是否读到（false = 目录/文件不存在，或读取/解析失败）。 */
  present: boolean;
  /** resolved 顶层键中归属本层的键（未被更高层覆盖者），升序。 */
  contributedKeys: string[];
}

/** 四层归并结果。 */
export interface ResolvedContent {
  /** 本次解析的客户标识（L2 轴；**不参与 profession 层寻址**）。 */
  orgId: string;
  /** 四层归并后的内容（detached clone）。 */
  resolved: Record<string, unknown>;
  /** 逐层 provenance，顺序恒为 CONTENT_LAYER_ORDER。 */
  layers: LayerContribution[];
  /** 是否有层因解析失败被跳过（铁律 31 降级信号）。 */
  degraded: boolean;
  /** 降级明细（JSON 解析失败等）。 */
  errors: string[];
}

/**
 * 四层归并：builtin → industry → **profession** → custom（后者逐键覆盖前者）。
 * 同名键由更高层**整值**胜出；更低层**未被覆盖**的键保留（叠加，非替换）。
 * 缺省层（目录/文件不存在）跳过且不计降级。
 * @param input - orgId/industry/profession 必填；baseDir/roots/contentFile 可选。
 * @returns 归并结果 + 逐层 provenance + 降级信号。永不抛错。
 */
export function resolveContentLayers(input: ResolveInput): ResolvedContent {
  const errors: string[] = [];
  const roots: ContentRoots = { ...defaultContentRoots(input), ...(input.roots ?? {}) };
  const fileName = input.contentFile ?? LAYER_CONTENT_FILE;

  const docs = new Map<ContentLayerName, Record<string, unknown>>();
  for (const layer of CONTENT_LAYER_ORDER) {
    const doc = readLayerDoc(roots[layer], fileName, errors);
    if (doc) docs.set(layer, doc);
  }

  let acc: Record<string, unknown> = {};
  for (const layer of CONTENT_LAYER_ORDER) {
    const doc = docs.get(layer);
    if (!doc) continue;
    const merged = mergeLayers(acc, doc);
    acc = isPlainRecord(merged) ? merged : { ...acc };
  }

  // 顶层键 provenance：每键恰有一个 owner（定义该键的最高层）。
  const owner = new Map<string, ContentLayerName>();
  for (const layer of CONTENT_LAYER_ORDER) {
    const doc = docs.get(layer);
    if (!doc) continue;
    for (const key of Object.keys(doc)) owner.set(key, layer);
  }

  const layers: LayerContribution[] = CONTENT_LAYER_ORDER.map((layer) => ({
    layer,
    root: roots[layer],
    present: docs.has(layer),
    contributedKeys: [...owner.entries()]
      .filter(([, ownerLayer]) => ownerLayer === layer)
      .map(([key]) => key)
      .sort(),
  }));

  return { orgId: input.orgId, resolved: detachJson(acc), layers, degraded: errors.length > 0, errors };
}

// ═══ L1.5 专业包发现（文件驱动：加文件即生效） ═══

/** 专业包声明（manifest.json，字段从简）。 */
export interface ProfessionPackageManifest {
  /** 包标识（必填，非空字符串）。 */
  name: string;
  /** 包版本。 */
  version?: string;
  /** 包类型（约定 'profession-package'）。 */
  type?: string;
  /** 人类可读名（第三方包的展示面）。 */
  displayName?: string;
  /** 内容文档文件名（相对包目录）。 */
  entryPoint?: string;
  /** 包目录绝对路径（由加载器填入，非 manifest 字段）。 */
  dir: string;
}

/** 专业包发现结果。 */
export interface ProfessionPackagesResult {
  /** 已发现的专业包。 */
  packages: ProfessionPackageManifest[];
  /** 是否有包声明解析失败（铁律 31）。 */
  degraded: boolean;
  /** 降级明细。 */
  errors: string[];
}

/**
 * 文件驱动发现 `extensions/professions/<专业包>/manifest.json`。
 * 加一个目录 + manifest.json 即被发现——**无需改宿主 TS**（P1「一切皆为内容」）。
 * @param input - baseDir 可选（缺省 process.cwd()）。
 * @returns 包清单 + 降级信号。目录不存在 → 空结果 + degraded=false。永不抛错。
 */
export function loadProfessionPackages(input?: { baseDir?: string }): ProfessionPackagesResult {
  const base = input?.baseDir ?? process.cwd();
  const root = join(base, 'extensions', 'professions');
  const errors: string[] = [];
  const packages: ProfessionPackageManifest[] = [];

  if (!existsSync(root)) {
    log.info({ root }, '专业包目录不存在 — 返回空清单（非降级）');
    return { packages, degraded: false, errors };
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ root, err: msg }, '专业包目录扫描失败 — degraded');
    return { packages, degraded: true, errors: [`${root}: 扫描失败 ${msg}`] };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(SKIP_PREFIX)) continue;
    const dir = join(root, entry.name);
    const manifestPath = join(dir, PROFESSION_MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      log.warn({ dir: entry.name }, '专业包目录缺 manifest.json — 跳过');
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ path: manifestPath, err: msg }, '专业包 manifest 读取/解析失败 — degraded');
      errors.push(`${manifestPath}: ${msg}`);
      continue;
    }
    if (!isPlainRecord(parsed) || typeof parsed.name !== 'string' || !parsed.name.trim()) {
      log.warn({ path: manifestPath }, '专业包 manifest 缺 name 或非 plain object — degraded');
      errors.push(`${manifestPath}: 缺 name 字段`);
      continue;
    }
    const manifest: ProfessionPackageManifest = { ...parsed, name: parsed.name, dir };
    packages.push(manifest);
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));
  log.info({ root, count: packages.length, errors: errors.length }, '专业包发现完成');
  return { packages, degraded: errors.length > 0, errors };
}

// ═══ 反碎片化检测（宪章 5.2：「同一东西在 ≥2 个客户出现 ⇒ 必须提升一层」） ═══

/** 一条碎片化告警：同一叶子键在 ≥2 个客户层上携带**深度相等**的值。 */
export interface FragmentationFinding {
  /** 叶子键路径（点分，如 `thresholdOverrides.F1_KZ.critical`）。 */
  key: string;
  /** 出现该键的客户标识（≥2，升序）。 */
  orgIds: string[];
  /** 该键在客户层上重复出现的值。 */
  value: unknown;
  /** 处置建议（提升到 L1.5 专业包 / L1 行业包）。 */
  suggestion: string;
}

/** 反碎片化检测结果。 */
export interface FragmentationReport {
  /** 已扫描的客户层目录（orgId 升序）。 */
  scannedOrgs: string[];
  /** 碎片化告警。 */
  findings: FragmentationFinding[];
  /** 是否有客户层文档解析失败（铁律 31）。 */
  degraded: boolean;
  /** 降级明细。 */
  errors: string[];
}

/** 把嵌套 plain object 摊平为「叶子键路径 → 值」。 */
function flattenLeaves(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (prefix) out.set(prefix, value);
}

/**
 * 扫客户层目录，检测「同一内容在 ≥2 个客户出现」（宪章 5.2 防碎片化硬规矩）。
 * 仅当**叶子键路径**在多个客户上**深度相等**时才告警——同键不同值是真实个性化，不算碎片化。
 * @param input - baseDir / customerRoot（缺省 `<base>/<customer-config>`，沿用既有客户配置包根名）/ contentFile。
 * @returns 扫描到的 org 列表 + 告警 + 降级信号。目录不存在 → 空报告 + degraded=false。永不抛错。
 */
export function detectCustomerFragmentation(input?: {
  baseDir?: string;
  customerRoot?: string;
  contentFile?: string;
}): FragmentationReport {
  const base = input?.baseDir ?? process.cwd();
  const root = input?.customerRoot ?? join(base, DEFAULT_ROOT_NAME);
  const fileName = input?.contentFile ?? LAYER_CONTENT_FILE;
  const errors: string[] = [];
  const scannedOrgs: string[] = [];
  const findings: FragmentationFinding[] = [];

  if (!existsSync(root)) {
    log.info({ root }, '客户层目录不存在 — 无碎片化可检（非降级）');
    return { scannedOrgs, findings, degraded: false, errors };
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ root, err: msg }, '客户层目录扫描失败 — degraded');
    return { scannedOrgs, findings, degraded: true, errors: [`${root}: 扫描失败 ${msg}`] };
  }

  // key → (值指纹 → [orgId…])，并保留原文值。
  const byKey = new Map<string, Map<string, { value: unknown; orgIds: string[] }>>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(SKIP_PREFIX)) continue;
    const orgId = entry.name;
    const path = join(root, orgId, fileName);
    if (!existsSync(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ path, err: msg }, '客户层文档读取/解析失败 — 该 org 跳过（degraded）');
      errors.push(`${path}: ${msg}`);
      continue;
    }
    if (!isPlainRecord(parsed)) {
      log.warn({ path }, '客户层文档不是 plain object — 该 org 跳过（degraded）');
      errors.push(`${path}: 客户层文档必须是 plain object`);
      continue;
    }
    scannedOrgs.push(orgId);
    const leaves = new Map<string, unknown>();
    flattenLeaves(parsed, '', leaves);
    for (const [key, value] of leaves) {
      const fingerprint = JSON.stringify(value) ?? 'null';
      let buckets = byKey.get(key);
      if (!buckets) {
        buckets = new Map();
        byKey.set(key, buckets);
      }
      const bucket = buckets.get(fingerprint);
      if (bucket) bucket.orgIds.push(orgId);
      else buckets.set(fingerprint, { value, orgIds: [orgId] });
    }
  }

  for (const [key, buckets] of byKey) {
    for (const [, bucket] of buckets) {
      if (bucket.orgIds.length < 2) continue;
      const finding: FragmentationFinding = {
        key,
        orgIds: [...bucket.orgIds].sort(),
        value: bucket.value,
        suggestion: `同一键 "${key}" 在 ${bucket.orgIds.length} 个客户层重复出现 ⇒ 按宪章 5.2 提升到 L1.5 专业包或 L1 行业包`,
      };
      log.warn({ key, orgIds: finding.orgIds }, '反碎片化告警：同一内容在 ≥2 个客户出现 — 须提升一层');
      findings.push(finding);
    }
  }

  findings.sort((a, b) => a.key.localeCompare(b.key));
  scannedOrgs.sort();
  log.info({ root, scannedOrgs: scannedOrgs.length, findings: findings.length }, '反碎片化检测完成');
  return { scannedOrgs, findings, degraded: errors.length > 0, errors };
}
