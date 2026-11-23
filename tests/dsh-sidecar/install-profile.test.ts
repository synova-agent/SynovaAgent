/**
 * tests/dsh-sidecar/install-profile.test.ts —— Issue #1458（#1457 core 门红的加做部分）
 *
 * 为什么必须有这个文件（不是形式要求）：
 *   `scripts/ci/core-tests.sh` 的 source 判定把 `scripts/**\/*.ts` 计成 source_changes，
 *   CI 随后跑 `vitest run --changed <base>`；**只把逻辑抽进 lib/*.mjs 而不留 import 边**的话，
 *   `install-profile.ts` 仍然「找不到受影响测试」⇒ `affected-no-tests` ⇒ 红。
 *   所以本文件**直接 import 那个 .ts 脚本**（真实依赖边），并真跑它的导出函数。
 *   禁止的替代做法：把脚本改名/挪目录成非 .ts（那是伪装成非源，复核者明确反对）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildInstallReport, resolveDshHome } from '../../scripts/dsh-sidecar/r3-chain/install-profile';

describe('install-profile / resolveDshHome', () => {
  it('SYNOVA_DSH_HOME 缺失或为空 ⇒ 抛错（原脚本的非零退出语义）', () => {
    expect(() => resolveDshHome({})).toThrow('SYNOVA_DSH_HOME is required');
    expect(() => resolveDshHome({ SYNOVA_DSH_HOME: '' })).toThrow('SYNOVA_DSH_HOME is required');
    expect(resolveDshHome({ SYNOVA_DSH_HOME: '/tmp/isolated-dsh-home' })).toBe('/tmp/isolated-dsh-home');
  });
});

describe('install-profile / buildInstallReport', () => {
  it('装 profile 到隔离 DSH_HOME ⇒ 报告字段与 T0 证据件同形，且四件真被逐字节复制', () => {
    const dshHome = mkdtempSync(path.join(tmpdir(), 'install-profile-home-'));
    try {
      const report = buildInstallReport({ dshHome });

      expect(report.ok).toBe(true);
      expect(report.dshHome).toBe(dshHome);
      // 装到 <dshHome>/profiles/synova-sidecar（产品函数的契约路径）
      expect(report.target).toBe(path.join(dshHome, 'profiles', 'synova-sidecar'));
      expect(statSync(report.target).isDirectory()).toBe(true);

      // 四个 profile 文件都在，且 files 与 targetFileCount 自洽
      expect(report.files).toHaveLength(4);
      expect(report.files).toEqual([...report.files].sort());
      expect(report.targetFileCount).toBe(report.files.length);
      expect(report.targetFileCount).toBe(readdirSync(report.target).length);

      // 真复制：目标文件与仓库 profile 逐字节相同（不是建空目录/软链）
      for (const file of report.files) {
        const installed = readFileSync(path.join(report.target, file));
        const source = readFileSync(path.join(report.profileDir, file));
        expect(installed.equals(source)).toBe(true);
        expect(installed.length).toBeGreaterThan(0);
      }

      // patch 语义：19 条 entry / 17 条 disable 是 T0 证据的核心事实，且两条关键姿态存在
      expect(report.patchEntryCount).toBeGreaterThan(0);
      expect(report.disabledIds.length).toBeLessThanOrEqual(report.patchEntryCount);
      expect(report.sandboxEntry).not.toBeNull();
      expect(report.sandboxEntry?.id).toBe('sandbox-policy');
      expect(report.approvalEntry?.id).toBe('approval');
      expect(report.bundles.length).toBeGreaterThan(0);
    } finally {
      rmSync(dshHome, { recursive: true, force: true });
    }
  });

  it('重复安装幂等：同一 DSH_HOME 装两次不抛、产出同样的文件集（仓库是唯一版本源）', () => {
    const dshHome = mkdtempSync(path.join(tmpdir(), 'install-profile-idem-'));
    try {
      const first = buildInstallReport({ dshHome });
      const second = buildInstallReport({ dshHome });

      expect(second.files).toEqual(first.files);
      expect(second.targetFileCount).toBe(first.targetFileCount);
      expect(second.patchEntryCount).toBe(first.patchEntryCount);
      expect(second.disabledIds).toEqual(first.disabledIds);
    } finally {
      rmSync(dshHome, { recursive: true, force: true });
    }
  });
});
