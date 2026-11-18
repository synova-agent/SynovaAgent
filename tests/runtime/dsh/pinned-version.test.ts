/**
 * tests/runtime/dsh/pinned-version.test.ts — 固定版本 / 含版本安装目录 / 版本不匹配拒绝的单测。
 *
 * 配对对象：src/runtime/dsh/pinned-version.ts
 * 覆盖：版本常量、缺省与显式回退解析、非法版本（rc.3／任意串／空值）拒绝、
 * 含版本默认目录（win/posix/env 覆盖）、已安装版本读取与不匹配 typed error。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('生产固定 rc.2，显式回退只有 rc.1', () => {
    expect(PINNED_DSH_VERSION).toBe('0.2.2-rc.2');
    expect(PREVIOUS_DSH_VERSION).toBe('0.2.2-rc.1');
    expect(isSelectableDshVersion(PINNED_DSH_VERSION)).toBe(true);
    expect(isSelectableDshVersion(PREVIOUS_DSH_VERSION)).toBe(true);
    expect(isSelectableDshVersion('0.2.2-rc.3')).toBe(false);
    expect(isSelectableDshVersion('')).toBe(false);
    expect(isSelectableDshVersion(undefined)).toBe(false);
  });

  it('缺省 ⇒ rc.2 且 explicit=false；显式 rc.1 ⇒ explicit=true', () => {
    const defaulted = resolveExpectedDshVersion();
    expect(defaulted).toEqual({ version: PINNED_DSH_VERSION, explicit: false });
    const explicit = resolveExpectedDshVersion(PREVIOUS_DSH_VERSION);
    expect(explicit).toEqual({ version: PREVIOUS_DSH_VERSION, explicit: true });
  });

  it('rc.3／任意字符串／空值 ⇒ DSH_VERSION_MISMATCH（不可重试）', () => {
    for (const bad of ['0.2.2-rc.3', 'latest', '', ' 0.2.2-rc.2']) {
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
    const dir = defaultInstallDir({ platform: 'win32', env: { SYNOVA_DSH_INSTALL_DIR: 'C:\\SynovaLab\\work\\install\\0.2.2-rc.2' } });
    expect(dir).toBe('C:\\SynovaLab\\work\\install\\0.2.2-rc.2');
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
    const rc2 = writeInstallDir(PINNED_DSH_VERSION);
    expect(assertInstalledDshVersion(PINNED_DSH_VERSION, rc2)).toBe(PINNED_DSH_VERSION);

    const rc1 = writeInstallDir(PREVIOUS_DSH_VERSION);
    const mismatch = catchError(() => assertInstalledDshVersion(PINNED_DSH_VERSION, rc1));
    expect(mismatch).toBeInstanceOf(DshError);
    expect((mismatch as DshError).code).toBe('DSH_VERSION_MISMATCH');
    expect((mismatch as DshError).retryable).toBe(false);

    const unreadable = catchError(() => assertInstalledDshVersion(PINNED_DSH_VERSION, makeTempRoot()));
    expect(unreadable).toBeInstanceOf(DshError);
    expect((unreadable as DshError).code).toBe('SIDECAR_SPAWN_FAILED');
  });
});
