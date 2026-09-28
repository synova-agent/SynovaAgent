/**
 * tests/config/settings-applies.test.ts — D1053 LIVE 套件（线25 25-8 路径 A）
 *
 * ⚠ (b) 版预案：收缩公开面后的写法 —— 只经**生产入口**取 runtime（3 个公开导出），
 *   不使用任何 registry 注入缝；负控退化为真进程/真 runtime 一形态（见末条用例）。
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md §8.1
 * 承载断言: A1 live 键改盘后 effective 立即新值 / A2 sourceLayer 三态 / A3 未声明默认安全
 *
 * A2 套件定位串: settings-applies-live（yaml evidence 串逐字；本文件含一次，另一套件串不出现）
 * env 隔离: SYNOVA_SETTINGS_ROOT / SYNOVA_SETTINGS_HOME 双指 tmpdir，绝不写仓库或真实 $HOME。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSettingsBootFence, getSettingsRuntime } from '../../src/config/settings-applies';

const ENV_ROOT = 'SYNOVA_SETTINGS_ROOT';
const ENV_HOME = 'SYNOVA_SETTINGS_HOME';

interface RowLike {
  path: string;
  applies: string;
  declared: boolean;
  effective: unknown;
  pending: unknown;
  sourceLayer: string;
}

describe('settings-applies-live · LIVE 套件（D1053 / 25-8 路径 A）', () => {
  let root = '';
  let home = '';
  let savedRoot: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedRoot = process.env[ENV_ROOT];
    savedHome = process.env[ENV_HOME];
    root = mkdtempSync(join(tmpdir(), 'd1053-live-root-'));
    home = mkdtempSync(join(tmpdir(), 'd1053-live-home-'));
    process.env[ENV_ROOT] = root;
    process.env[ENV_HOME] = home;
  });

  afterEach(() => {
    if (savedRoot === undefined) delete process.env[ENV_ROOT];
    else process.env[ENV_ROOT] = savedRoot;
    if (savedHome === undefined) delete process.env[ENV_HOME];
    else process.env[ENV_HOME] = savedHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function writeWorkspace(body: string): void {
    writeFileSync(join(root, 'settings.yaml'), body, 'utf8');
  }

  function writeHome(body: string): void {
    writeFileSync(join(home, 'settings.yaml'), body, 'utf8');
  }

  it('A1 · live 键改盘后不重启即新值（同一 runtime 的 effective 立即变）', () => {
    writeWorkspace('settings:\n  diagnosis:\n    gateDataCompleteness: 0.30\n');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    const before = runtime.row('diagnosis.gateDataCompleteness') as RowLike | null;
    expect(before).not.toBeNull();
    expect(before?.applies).toBe('live');
    expect(before?.effective).toBe(0.3);
    writeWorkspace('settings:\n  diagnosis:\n    gateDataCompleteness: 0.55\n');
    const after = runtime.row('diagnosis.gateDataCompleteness') as RowLike | null;
    expect(after?.effective).toBe(0.55);
    expect(after?.pending).toBeNull();
  });

  it('A2 · sourceLayer 三态归属（workspace / home / declaration）', () => {
    writeWorkspace('settings:\n  diagnosis:\n    gateDataCompleteness: 0.30\n');
    writeHome('settings:\n  wording:\n    locale: en-US\n');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect((runtime.row('diagnosis.gateDataCompleteness') as RowLike | null)?.sourceLayer).toBe('workspace');
    expect((runtime.row('wording.locale') as RowLike | null)?.sourceLayer).toBe('home');
    const declared = runtime.row('extensions.skill.enabled') as RowLike | null;
    expect(declared?.sourceLayer).toBe('declaration');
    expect(declared?.effective).toBe(true);
    writeHome('settings:\n  diagnosis:\n    gateDataCompleteness: 0.11\n');
    initSettingsBootFence({ force: true });
    const overlay = getSettingsRuntime().row('diagnosis.gateDataCompleteness') as RowLike | null;
    expect(overlay?.effective).toBe(0.3);
    expect(overlay?.sourceLayer).toBe('workspace');
  });

  it('A3 · 未声明键 ⇒ 强制 restart + declared:false + 进 undeclared[]（默认安全）', () => {
    writeWorkspace('settings:\n  rogue:\n    whoAmI: 1\n');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    const row = runtime.row('rogue.whoAmI') as RowLike | null;
    expect(row).not.toBeNull();
    expect(row?.applies).toBe('restart');
    expect(row?.declared).toBe(false);
    expect(runtime.undeclared).toContain('rogue.whoAmI');
    expect(runtime.rows().some((r) => r.path === 'rogue.whoAmI')).toBe(true);
  });

  it('边界 · 两层皆不存在 ⇒ 零降级 + 全 declaration 归属（ENOENT 是正常默认，不是降级）', () => {
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect(runtime.degraded).toBe(false);
    expect(runtime.sourceFiles.workspace).toBeNull();
    expect(runtime.sourceFiles.home).toBeNull();
    expect(runtime.undeclared).toEqual([]);
    expect((runtime.row('store.dbPath') as RowLike | null)?.sourceLayer).toBe('declaration');
  });

  it('降级 · 非法声明（yaml 携带 applies）⇒ runtime degraded + SETTINGS_SPEC_INVALID，且涉事键不出现（(b) 版：负控只剩真 runtime 一形态）', () => {
    writeWorkspace('settings:\n  bad:\n    x:\n      applies: sometimes\n');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect(runtime.degraded).toBe(true);
    // 鸭子类型断言（无 SettingsSpecError 类可 import）：错误契约仍逐项可核
    expect(runtime.code).toBe('SETTINGS_SPEC_INVALID');
    expect(String(runtime.reason)).toContain('SETTINGS_BOOT_FAILED');
    expect(runtime.rows().length).toBe(0);
    expect(runtime.row('bad.x')).toBeNull();
  });

  it('边界 · 目录存在但文件缺失（仅父目录在）⇒ 仍视为 ENOENT 正常默认', () => {
    mkdirSync(join(root, 'nested'), { recursive: true });
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect(runtime.degraded).toBe(false);
    expect(runtime.sourceFiles.workspace).toBeNull();
    expect(runtime.rows().length).toBeGreaterThan(0);
  });
});
