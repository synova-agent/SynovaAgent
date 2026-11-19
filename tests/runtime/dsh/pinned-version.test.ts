/**
 * tests/runtime/dsh/pinned-version.test.ts — 固定版本 / 含版本安装目录 / 版本不匹配拒绝的单测。
 *
 * 配对对象：src/runtime/dsh/pinned-version.ts
 * 覆盖：版本常量、缺省与显式回退解析、非法版本（rc.3／任意串／空值）拒绝、
 * 含版本默认目录（win/posix/env 覆盖）、已安装版本读取与不匹配 typed error。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PINNED_DSH_VERSION,
  PREVIOUS_DSH_VERSION,
  assertInstalledDshVersion,
  defaultInstallDir,
  isSelectableDshVersion,
  readInstalledDshVersion,
  resolveExpectedDshVersion,
} from '../../../src/runtime/dsh/pinned-version';
import { DshError } from '../../../src/runtime/dsh/errors';

const tempRoots: string[] = [];

/** #1430 Mandate 给定的候选版本与完整性（测试期望值；不从被测脚本反读）。 */
const EXPECTED_PINNED = '0.2.2-rc.5';
const EXPECTED_PREVIOUS = '0.2.2-rc.2';
const EXPECTED_PINNED_INTEGRITY = 'sha512-cNbp12tLYLUTXaVli7zwwMjzmmEVCD1PRldg4oKtXM4+lFYckcaliMS2PU/FoThB4iAN/fKOSID0nrtRZU4Gjw==';
const EXPECTED_PREVIOUS_INTEGRITY = 'sha512-J727r2C471x2cYXGjqZ0D9T1zYaYQDFH/Ynx8iq+85oslM4nky5YTBnbAuTtxMhW7nhY8wuAEfjjFCQ+K6Swgw==';

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-pinned-version-'));
  tempRoots.push(dir);
  return dir;
}

/** 在临时目录里造一个 npm 安装布局（node_modules/@deepseek-ai/dsh/package.json + lib/bin.js）。 */
function writeInstallDir(version: string): string {
  const root = makeTempRoot();
  const pkgDir = join(root, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(join(pkgDir, 'lib'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version, bin: { dsh: 'lib/bin.js' } }), 'utf8');
  writeFileSync(join(pkgDir, 'lib', 'bin.js'), '// probe stub (never executed by this test)\n', 'utf8');
  return root;
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err: unknown) {
    return err;
  }
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describe('pinned-version: 版本常量与选择', () => {
  it('生产固定 rc.5，显式回退只有 rc.2；rc.1 退役为历史记录', () => {
    expect(PINNED_DSH_VERSION).toBe(EXPECTED_PINNED);
    expect(PREVIOUS_DSH_VERSION).toBe(EXPECTED_PREVIOUS);
    expect(isSelectableDshVersion(PINNED_DSH_VERSION)).toBe(true);
    expect(isSelectableDshVersion(PREVIOUS_DSH_VERSION)).toBe(true);
    expect(isSelectableDshVersion('0.2.2-rc.3')).toBe(false);
    expect(isSelectableDshVersion('0.2.2-rc.1')).toBe(false);
    expect(isSelectableDshVersion('')).toBe(false);
    expect(isSelectableDshVersion(undefined)).toBe(false);
  });

  it('缺省 ⇒ rc.5 且 explicit=false；显式 rc.2 ⇒ explicit=true', () => {
    const defaulted = resolveExpectedDshVersion();
    expect(defaulted).toEqual({ version: PINNED_DSH_VERSION, explicit: false });
    const explicit = resolveExpectedDshVersion(PREVIOUS_DSH_VERSION);
    expect(explicit).toEqual({ version: PREVIOUS_DSH_VERSION, explicit: true });
  });

  it('rc.3／rc.1／任意字符串／空值 ⇒ DSH_VERSION_MISMATCH（不可重试）', () => {
    for (const bad of ['0.2.2-rc.3', '0.2.2-rc.1', 'latest', '', ' 0.2.2-rc.5']) {
      const error = catchError(() => resolveExpectedDshVersion(bad));
      expect(error, `非法版本必须拒绝: ${JSON.stringify(bad)}`).toBeInstanceOf(DshError);
      expect((error as DshError).code).toBe('DSH_VERSION_MISMATCH');
      expect((error as DshError).retryable).toBe(false);
      expect((error as DshError).phase).toBe('spawn');
    }
  });
});

describe('pinned-version: 含版本默认安装目录', () => {
  it('Win：%LOCALAPPDATA%\\Synova\\dsh-sidecar\\install\\<version>（版本层级在最后）', () => {
    const dir = defaultInstallDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' } });
    expect(dir).toBe(join('C:\\Users\\tester\\AppData\\Local', 'Synova', 'dsh-sidecar', 'install', PINNED_DSH_VERSION));
    const rc1 = defaultInstallDir({ platform: 'win32', version: PREVIOUS_DSH_VERSION, env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' } });
    expect(rc1).toBe(join('C:\\Users\\tester\\AppData\\Local', 'Synova', 'dsh-sidecar', 'install', PREVIOUS_DSH_VERSION));
  });

  it('posix：$HOME/.synova/dsh-sidecar/install/<version>；无 HOME 回退系统 home', () => {
    const dir = defaultInstallDir({ platform: 'linux', env: { HOME: '/home/tester' } });
    expect(dir).toBe(join('/home/tester', '.synova', 'dsh-sidecar', 'install', PINNED_DSH_VERSION));
    const fallback = defaultInstallDir({ platform: 'linux', env: {} });
    expect(fallback).toContain(join('.synova', 'dsh-sidecar', 'install', PINNED_DSH_VERSION));
  });

  it('SYNOVA_DSH_INSTALL_DIR 显式覆盖优先（沙箱注入路径）', () => {
    const dir = defaultInstallDir({ platform: 'win32', env: { SYNOVA_DSH_INSTALL_DIR: 'C:\\SynovaLab\\work\\install\\0.2.2-rc.5' } });
    expect(dir).toBe('C:\\SynovaLab\\work\\install\\0.2.2-rc.5');
  });
});

describe('pinned-version: 已安装版本核对', () => {
  it('读取 package.json 的 version；缺失/非法 JSON ⇒ null（不猜版本）', () => {
    const rc1 = writeInstallDir(PREVIOUS_DSH_VERSION);
    expect(readInstalledDshVersion(rc1)).toBe(PREVIOUS_DSH_VERSION);

    const missing = makeTempRoot();
    expect(readInstalledDshVersion(missing)).toBeNull();

    const broken = makeTempRoot();
    const pkgDir = join(broken, 'node_modules', '@deepseek-ai', 'dsh');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), '{not-json', 'utf8');
    expect(readInstalledDshVersion(broken)).toBeNull();
  });

  it('版本一致 ⇒ 返回实际版本；不符 ⇒ DSH_VERSION_MISMATCH；不可读 ⇒ SIDECAR_SPAWN_FAILED', () => {
    const pinnedDir = writeInstallDir(PINNED_DSH_VERSION);
    expect(assertInstalledDshVersion(PINNED_DSH_VERSION, pinnedDir)).toBe(PINNED_DSH_VERSION);

    const previousDir = writeInstallDir(PREVIOUS_DSH_VERSION);
    const mismatch = catchError(() => assertInstalledDshVersion(PINNED_DSH_VERSION, previousDir));
    expect(mismatch).toBeInstanceOf(DshError);
    expect((mismatch as DshError).code).toBe('DSH_VERSION_MISMATCH');
    expect((mismatch as DshError).retryable).toBe(false);

    const unreadable = catchError(() => assertInstalledDshVersion(PINNED_DSH_VERSION, makeTempRoot()));
    expect(unreadable).toBeInstanceOf(DshError);
    expect((unreadable as DshError).code).toBe('SIDECAR_SPAWN_FAILED');
  });
});

/**
 * 版本固定面不只在 TS 常量里：安装/下载/构建/探针/证据/配置脚本各自复制了版本与
 * integrity。本组测试把这些副本钉到 #1430 Mandate 的期望值，改一处就红。
 */
describe('pinned-version: 运行时脚本固定面一致', () => {
  const SCRIPT_ROOT = join(process.cwd(), 'scripts', 'dsh-sidecar');
  const readScript = (relative: string): string => readFileSync(join(SCRIPT_ROOT, ...relative.split('/')), 'utf8');

  it('安装/下载/构建/探针/证据/配置脚本都固定 rc.5 + rc.2 与给定 integrity', () => {
    const install = readScript('install-dsh-runtime.ps1');
    expect(install).toContain(`[ValidateSet('${EXPECTED_PINNED}', '${EXPECTED_PREVIOUS}')]`);
    expect(install).toContain(`'${EXPECTED_PINNED}' = '${EXPECTED_PINNED_INTEGRITY}'`);
    expect(install).toContain(`'${EXPECTED_PREVIOUS}' = '${EXPECTED_PREVIOUS_INTEGRITY}'`);

    const fetchInputs = readScript('sandbox/Fetch-DshSandboxInputs.ps1');
    expect(fetchInputs).toContain(`https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${EXPECTED_PINNED}.tgz`);
    expect(fetchInputs).toContain(`'${EXPECTED_PINNED}' = @{`);
    expect(fetchInputs).toContain(`Integrity = '${EXPECTED_PINNED_INTEGRITY}'`);
    expect(fetchInputs).toContain(`'${EXPECTED_PREVIOUS}' = @{`);
    expect(fetchInputs).toContain(`Integrity = '${EXPECTED_PREVIOUS_INTEGRITY}'`);

    const build = readScript('sandbox/Invoke-DshSandboxBuild.ps1');
    expect(build).toContain(EXPECTED_PINNED_INTEGRITY);
    expect(build).toContain(EXPECTED_PREVIOUS_INTEGRITY);
    expect(build).toContain(`dshVersions = @('${EXPECTED_PINNED}', '${EXPECTED_PREVIOUS}')`);

    const probe = readScript('probe-dsh-runtime.ps1');
    expect(probe).toContain(`$DshVersion = '${EXPECTED_PINNED}'`);
    expect(probe).toContain(`$PreviousVersion = '${EXPECTED_PREVIOUS}'`);
    expect(probe).toContain(`$PinnedIntegrity = '${EXPECTED_PINNED_INTEGRITY}'`);

    const evidence = readScript('sandbox/Test-DshEvidence.ps1');
    expect(evidence).toContain(`$PinnedDsh = '${EXPECTED_PINNED}'`);

    const config = readScript('sandbox/New-DshSandboxConfig.ps1');
    expect(config).toContain(`'dsh-${EXPECTED_PINNED}.tgz'`);
    expect(config).toContain(`'dsh-${EXPECTED_PREVIOUS}.tgz'`);

    const probeEntry = readScript('sandbox/Invoke-DshSandboxProbe.ps1');
    expect(probeEntry).toContain(`foreach ($version in @('${EXPECTED_PINNED}', '${EXPECTED_PREVIOUS}'))`);
    expect(probeEntry).toContain(`$env:SYNOVA_DSH_INSTALL_DIR = Join-Path $InstallRoot '${EXPECTED_PINNED}'`);
  });

  it('活动脚本不再把 rc.1 当作安装或回退候选', () => {
    for (const relative of [
      'start.ps1',
      'install-dsh-runtime.ps1',
      'probe-dsh-runtime.ps1',
      'sandbox/Fetch-DshSandboxInputs.ps1',
      'sandbox/Invoke-DshSandboxBuild.ps1',
      'sandbox/Invoke-DshSandboxProbe.ps1',
      'sandbox/New-DshSandboxConfig.ps1',
      'sandbox/Test-DshEvidence.ps1',
    ]) {
      expect(readScript(relative), relative).not.toContain('0.2.2-rc.1');
    }
  });
});
