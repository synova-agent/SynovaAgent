/**
 * install-profile.ts — R3 chain evidence script (Issue #1455, T0).
 *
 * Installs the repo-owned `synova-sidecar` dsh profile into the task-isolated
 * DSH_HOME, reusing the PRODUCT functions (no re-implementation):
 *   loadSidecarProfile -> assertSidecarProfile -> installSidecarProfile
 * and prints one JSON line describing what was installed.
 *
 * 🔴 #1458 改造：可测逻辑走 export（`resolveDshHome` / `buildInstallReport`），本文件只在
 *    **被直接执行时**才跑 CLI（`invokedDirectly`）。理由：CI `core-gates/core` 用
 *    `vitest run --changed <base>` 找受影响测试，只有测试**真的 import 本文件**才存在依赖边；
 *    把逻辑挪进 `lib/*.mjs` 而不留 import 边 ⇒ 本文件仍判定「无受影响测试」⇒ 红。
 *    禁止的替代做法：改名/挪目录成非 `.ts`（那是把源伪装成非源）。
 *
 * @input  env SYNOVA_DSH_HOME (task-isolated DSH home, absolute)
 * @output stdout: JSON { ok, dshHome, profileDir, target, files, bundles, patchEntryCount, disabledIds }
 * @error  missing env / profile violations -> non-zero exit, message on stderr
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertSidecarProfile,
  defaultProfileDir,
  installSidecarProfile,
  loadSidecarProfile,
} from '../../../src/runtime/dsh/profile';
import type { PatchEntry } from '../../../src/runtime/dsh/profile';

/** T0 证据报告的字段（顺序即 stdout 的键序，勿调整）。 */
export interface InstallProfileReport {
  ok: true;
  dshHome: string;
  profileDir: string;
  target: string;
  files: string[];
  bundles: string[];
  patchEntryCount: number;
  disabledIds: string[];
  sandboxEntry: PatchEntry | null;
  approvalEntry: PatchEntry | null;
  targetFileCount: number;
}

/**
 * 取任务隔离的 DSH_HOME。
 * @input env（默认 process.env）
 * @output 非空的 dshHome 绝对路径字符串
 * @error SYNOVA_DSH_HOME 缺失/为空 → 抛错（与原脚本逐字相同的消息，CLI 仍非零退出）
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const dshHome = env.SYNOVA_DSH_HOME;
  if (typeof dshHome !== 'string' || dshHome.length === 0) {
    throw new Error('install-profile: SYNOVA_DSH_HOME is required');
  }
  return dshHome;
}

/**
 * 装 profile 并产出证据报告（不做 stdout / 不改 process.exitCode）。
 * @input options.dshHome 缺省取 env；options.profileDir 缺省取仓库内 defaultProfileDir()
 * @output InstallProfileReport（字段与 T0 证据件一致）
 * @error profile 目录缺失 / profile 违规 → 原样抛出（沿用 installSidecarProfile 的 DshError）
 */
export function buildInstallReport(options: {
  dshHome?: string;
  profileDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): InstallProfileReport {
  const dshHome = options.dshHome ?? resolveDshHome(options.env ?? process.env);
  const profileDir = options.profileDir ?? defaultProfileDir();
  if (!existsSync(profileDir)) {
    throw new Error(`install-profile: profile dir missing: ${profileDir}`);
  }
  const profile = loadSidecarProfile(profileDir);
  assertSidecarProfile(profile);
  const target = installSidecarProfile({ profileDir, dshHome });
  return {
    ok: true,
    dshHome,
    profileDir,
    target,
    files: readdirSync(target).sort(),
    bundles: profile.bundles,
    patchEntryCount: profile.patchEntries.length,
    disabledIds: profile.patchEntries.filter(entry => entry.disabled).map(entry => entry.id),
    sandboxEntry: profile.patchEntries.find(entry => entry.id === 'sandbox-policy') ?? null,
    approvalEntry: profile.patchEntries.find(entry => entry.id === 'approval') ?? null,
    targetFileCount: readdirSync(join(target)).length,
  };
}

/** 本模块是否被当作 CLI 直接执行（被 import 时不得产生副作用）。 */
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isInvokedDirectly()) {
  process.stdout.write(`${JSON.stringify(buildInstallReport(), null, 2)}\n`);
}
