/**
 * src/runtime/dsh/pinned-version.ts — DSH 固定版本与含版本安装目录的**单一来源**。
 *
 * 为什么单独成文件：1A 基线把 `defaultInstallDir()` 指向桌面应用的安装根
 * （`%LOCALAPPDATA%\Programs\DeepSeek Harness`），既没有版本层级，也无法证明
 * 「装的是哪一个版本」。本票把「固定版本」从口头约定变成可被 sidecar／session
 * 共同校验的代码事实：版本常量、允许的显式回退（仅 rc.2）、含版本目录、
 * 已安装版本读取与不匹配拒绝，全部只在这里定义。
 *
 * 契约（铁律 47）:
 *   @input  可选 requested 版本字符串（CLI `--expected-version`）｜ installDir 绝对路径
 *   @output DshVersionSelection{version, explicit} ｜ 含版本的默认安装目录 ｜ 已安装版本字符串
 *   @degraded 无：版本不可读或不匹配一律 typed error；不猜版本、不静默回退到别的版本
 *   @error   DSH_VERSION_MISMATCH（rc.3／任意字符串／空值／已安装版本不符）｜
 *            SIDECAR_SPAWN_FAILED（安装目录里读不到 @deepseek-ai/dsh/package.json）
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, win32 as win32Path } from 'node:path';
import { DshError } from './errors';

/** 生产唯一允许的固定版本（#1430 候选升 0.2.2-rc.5；#1411 原锁 0.2.2-rc.2）。 */
export const PINNED_DSH_VERSION = '0.2.2-rc.5';

/** 唯一允许的显式回退版本（必须显式 `--expected-version` 才能选择；rc.1 已退役为历史记录）。 */
export const PREVIOUS_DSH_VERSION = '0.2.2-rc.2';

/** 可被显式选择的版本白名单（白名单之外一律 DSH_VERSION_MISMATCH）。 */
const SELECTABLE_DSH_VERSIONS = [PINNED_DSH_VERSION, PREVIOUS_DSH_VERSION] as const;

/** 版本字面量类型。 */
export type SelectableDshVersion = (typeof SELECTABLE_DSH_VERSIONS)[number];

/** 一次版本选择的结果（explicit=false 表示走了生产缺省）。 */
export interface DshVersionSelection {
  version: SelectableDshVersion;
  explicit: boolean;
}

/** 类型守卫：字符串是否属于可显式选择的版本白名单。 */
export function isSelectableDshVersion(value: unknown): value is SelectableDshVersion {
  return typeof value === 'string' && (SELECTABLE_DSH_VERSIONS as readonly string[]).includes(value);
}

/**
 * 解析期望版本。
 * - 不传 ⇒ 生产缺省 PINNED_DSH_VERSION（显式回退未被请求）；
 * - 显式传值 ⇒ 必须命中白名单，否则 DSH_VERSION_MISMATCH（含 rc.3／任意字符串／空值）。
 */
export function resolveExpectedDshVersion(requested?: string): DshVersionSelection {
  if (requested === undefined) {
    return { version: PINNED_DSH_VERSION, explicit: false };
  }
  if (!isSelectableDshVersion(requested)) {
    throw new DshError(
      'DSH_VERSION_MISMATCH',
      'spawn',
      `不支持的 expectedVersion=${JSON.stringify(requested)}；仅允许缺省 ${PINNED_DSH_VERSION} 或显式回退 ${PREVIOUS_DSH_VERSION}`,
      { retryable: false },
    );
  }
  return { version: requested, explicit: true };
}

/** 默认安装目录的判定输入（测试注入平台/env，生产用 process）。 */
export interface DefaultInstallDirOptions {
  version?: SelectableDshVersion;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/** posix 家目录：显式 env.HOME 优先（测试与沙箱可注入），否则操作系统 home。 */
function homeDir(env: NodeJS.ProcessEnv): string {
  const home = env.HOME;
  return home !== undefined && home.length > 0 ? home : homedir();
}

/**
 * 默认安装目录 = **含版本的完整目录**：
 * - Win：`%LOCALAPPDATA%\Synova\dsh-sidecar\install\<version>`
 * - posix：`$HOME/.synova/dsh-sidecar/install/<version>`
 * - `SYNOVA_DSH_INSTALL_DIR` 显式覆盖优先（沙箱注入 `C:\SynovaLab\work\install\<version>`）。
 */
export function defaultInstallDir(options: DefaultInstallDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fromEnv = env.SYNOVA_DSH_INSTALL_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return platform === 'win32' ? win32Path.resolve(fromEnv) : resolve(fromEnv);
  }
  const version = options.version ?? PINNED_DSH_VERSION;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData !== undefined && localAppData.length > 0) {
      return join(localAppData, 'Synova', 'dsh-sidecar', 'install', version);
    }
    return join(homeDir(env), '.synova', 'dsh-sidecar', 'install', version);
  }
  return join(homeDir(env), '.synova', 'dsh-sidecar', 'install', version);
}

/** 安装目录内 `@deepseek-ai/dsh/package.json` 路径（失败信息与读取共用）。 */
function installedPackageJsonPath(installDir: string): string {
  return join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
}

/**
 * 读取安装目录里的实际 DSH 版本；读不到返回 null（由调用方决定是 spawn failed 还是 mismatch）。
 * 只读 package.json 的 version 字段，不猜版本号、不回退目录名。
 */
export function readInstalledDshVersion(installDir: string): string | null {
  const path = installedPackageJsonPath(installDir);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' && version.length > 0 ? version : null;
  } catch {
    // 读取/解析失败一律视为「版本不可核实」，由调用方按 typed error 处理（不降级放行）。
    return null;
  }
}

/**
 * 断言安装目录的实际版本 == 期望版本；不匹配即 DSH_VERSION_MISMATCH（不 spawn）。
 * @output 实际版本字符串
 * @error  SIDECAR_SPAWN_FAILED（读不到 package.json）｜DSH_VERSION_MISMATCH（版本不符）
 */
export function assertInstalledDshVersion(version: SelectableDshVersion, installDir: string): string {
  const actual = readInstalledDshVersion(installDir);
  if (actual === null) {
    throw new DshError(
      'SIDECAR_SPAWN_FAILED',
      'spawn',
      `无法读取已安装 DSH 版本: ${installedPackageJsonPath(installDir)}`,
      { retryable: false },
    );
  }
  if (actual !== version) {
    throw new DshError(
      'DSH_VERSION_MISMATCH',
      'spawn',
      `已安装 DSH 版本 ${actual} 与期望 ${version} 不符（生产只锁 ${PINNED_DSH_VERSION}；${PREVIOUS_DSH_VERSION} 仅显式回退可用）`,
      { retryable: false },
    );
  }
  return actual;
}
