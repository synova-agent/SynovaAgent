/**
 * src/init/preset-loader.ts — 角色预设包（Role Pack）宿主侧 loader
 *
 * 架构位置: **⓪-b（人侧入口）内容载体** —— `extensions/presets/`（宪章 §4.1）。
 *   一个岗位一个目录，五件套声明「这个岗位该给 agent 带什么上下文」。
 *   **加一个角色目录 = 加一个岗位，不改宿主代码**（宪章三条不可妥协之①「文件驱动」）。
 *
 * 出处: K12-01 **段二**（#184）—— 段一已落内容面（`extensions/presets/**`，
 *   `content-registry` 登记为 `pending-cto`）；段二补宿主 loader + 接线，把该登记升为 `reachable`，
 *   使判据 `probe-role-pack.ts --role finance` 能从 exit 1 走到 exit 0。
 *   ⚠️ `manifest.json` 段一写明的 `exportKey: loadRolePacks` + `loaderPending: true`
 *   即本文件的接口预留 —— 本文件补齐后同步改 manifest（去 `loaderPending`、`entryPoint` 指本模块）。
 *
 * 🔴 本文件**不含任何角色硬编码清单**：角色集合一律从磁盘目录名推导。
 *   判据探针据此设反例 —— 「磁盘上每个角色目录都出现在生产入口的真实返回里」，
 *   硬编码角色表 ⇒ 新建目录不出现 ⇒ 探针判红（`probe-role-pack.ts` 边界声明 ①）。
 *
 * 契约（铁律 47）:
 *   @input  — 无参数（零参查询；探针只驱动零参导出，见 `probe-role-pack.ts`「观测面」段）。
 *             可选环境变量 `SYNOVA_PRESETS_ROOT` 覆盖内容根（测试注入缝，同 `SYNOVA_CONTENT_REGISTRY_DISABLE` 惯例）。
 *   @output — `loadRolePacks(): PresetLoadReport` — 角色清单 + 每角色的五件套存在性 + degraded 信号
 *             `listRolePacks(): string[]` — 角色 id 清单（零参，机器可观测）
 *             （有参查询不入契约面：无生产消费方即不导出，避免"导出但无人调用"的表面积 —— 铁律 0-2）
 *               故探针不驱动；保留给生产消费方与测试）
 *   @degraded — 内容根缺失 / roles 目录缺失 / 角色目录内文件读不到 ⇒ **不抛**，
 *             返回 `degraded: true` + `errors[]` 逐条点名 + `log.warn`（铁律 11/24/31：不静默降级）。
 *             ⚠️ 区分两类：**ENOENT = 正常默认**（角色目录为空 ⇒ degraded 但非错误），
 *             **读失败/解析失败 = 真错误**（进 `errors[]`）。
 */
import { createLogger } from '@synova/logger';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const log = createLogger('init/preset-loader');

/** 内容根（仓库相对）。环境变量覆盖 = 测试注入缝。 */
const PRESETS_DIR = 'extensions/presets';
/** 角色目录所在（相对内容根） */
const ROLES_SUBDIR = 'roles';

/** 一个岗位预设包 */
export interface RolePack {
  /** 角色 id（= 目录名，去扩展名前的原名） */
  readonly roleId: string;
  /** 本包**实际存在且非空**的五件套文件名（按磁盘实测，非声明） */
  readonly pieces: readonly string[];
  /** 五件套里缺失的文件名（空数组 = 齐备） */
  readonly missing: readonly string[];
}

/** `loadRolePacks()` 的返回 */
export interface PresetLoadReport {
  /** 内容根绝对路径 */
  readonly root: string;
  /** 角色清单（按 roleId 字典序，稳定顺序便于判据比对） */
  readonly roles: readonly RolePack[];
  /** 至少一项降级（缺根 / 缺目录 / 读失败） */
  readonly degraded: boolean;
  /** 逐条错误（铁律 24：不空吞）—— 仅真错误，不含"目录为空"这类正常默认 */
  readonly errors: readonly string[];
}

/** 五件套（与角色包 `manifest.json` 的 `pieces[]` 同源；此处为宿主侧期望集） */
const EXPECTED_PIECES: readonly string[] = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
];

/** 解析内容根（绝对路径） */
function resolvePresetsRoot(cwd: string = process.cwd()): string {
  const override = process.env['SYNOVA_PRESETS_ROOT'];
  if (typeof override === 'string' && override.length > 0) return override;
  return join(cwd, PRESETS_DIR);
}

/** 读目录项名（安全：失败返回空数组 + log.warn） */
function safeReaddir(dir: string, errors: string[]): string[] {
  try {
    return readdirSync(dir);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    // ENOENT = 正常默认（目录尚不存在）；其余 = 真错误
    if (code !== 'ENOENT') {
      const msg = `${dir}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      log.warn({ dir, err }, 'presets 目录读取失败 — degraded');
    }
    return [];
  }
}

/** 判定文件存在且非空 */
function isNonEmptyFile(abs: string): boolean {
  try {
    return existsSync(abs) && statSync(abs).isFile() && statSync(abs).size > 0;
  } catch {
    return false; // statSync 竞态（文件被删）⇒ 视为不存在，非错误
  }
}

/** 读一个角色包（磁盘实测五件套，不读声明） */
function readRolePack(rolesRoot: string, roleId: string, errors: string[]): RolePack {
  const roleDir = join(rolesRoot, roleId);
  const pieces: string[] = [];
  const missing: string[] = [];
  for (const piece of EXPECTED_PIECES) {
    if (isNonEmptyFile(join(roleDir, piece))) pieces.push(piece);
    else missing.push(piece);
  }
  if (missing.length > 0) {
    // 缺件是**内容问题**（非读取失败）⇒ 记 errors 让调用方可见，但不 throw
    errors.push(`${roleId}: 缺件 ${missing.join(', ')}`);
    log.warn({ roleId, missing }, '角色包缺件 — degraded');
  }
  return { roleId, pieces, missing };
}

/**
 * 装配角色预设包（boot 入口 / 判据入口）。
 *
 * 🔴 零参（探针只驱动零参导出）—— 内容根由 `process.cwd()` + `SYNOVA_PRESETS_ROOT` 推导。
 */
export function loadRolePacks(): PresetLoadReport {
  const errors: string[] = [];
  const root = resolvePresetsRoot();
  const rolesRoot = join(root, ROLES_SUBDIR);

  if (!existsSync(root)) {
    // ENOENT = 正常默认：内容面未装 ⇒ degraded，不是错误
    log.warn({ root }, 'presets 内容根不存在 — 角色预设包未装配（degraded，非错误）');
    return { root, roles: [], degraded: true, errors };
  }

  const entries = safeReaddir(rolesRoot, errors);
  const roleIds: string[] = [];
  for (const name of entries) {
    // 只要目录；忽略 .DS_Store / 文件 / 隐藏项
    if (name.startsWith('.')) continue;
    try {
      if (!statSync(join(rolesRoot, name)).isDirectory()) continue;
    } catch (err: unknown) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      log.warn({ name, err }, '角色目录 stat 失败 — degraded');
      continue;
    }
    roleIds.push(name);
  }
  roleIds.sort(); // 稳定顺序（判据可比对）

  const roles = roleIds.map((id) => readRolePack(rolesRoot, id, errors));
  const degraded = errors.length > 0 || roleIds.length === 0;
  log.info({ root, roles: roleIds.length, degraded }, '角色预设包已装配');
  return { root, roles, degraded, errors };
}

/**
 * 零参查询：角色 id 清单（**机器可观测面** —— 判据探针驱动本函数观察真实返回）。
 *
 * @output 角色 id 数组（字典序）；内容缺失 ⇒ 空数组（不是 null；调用方按空处理）
 */
export function listRolePacks(): string[] {
  return loadRolePacks().roles.map((r) => r.roleId);
}

/**
 * 状态清理（幂等）。
 *
 * 本 loader **不持有进程级缓存**（每次调用直读磁盘，保持"加文件即生效"的宪章语义）⇒
 * 本函数仅为满足 `content-registry` 的 `loader.cleanup` 契约而存在，
 * 显式声明「无缓存可清」，避免探针按名调用时找不到符号（`probe-role-pack.ts` 会核 `loader.cleanup`）。
 */
export function clearPresetCache(): void {
  log.info('preset-loader 无常驻缓存（每次直读磁盘）— cleanup 为空操作');
}
