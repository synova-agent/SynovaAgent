/**
 * tests/config/settings-source.test.ts — D1053 RESTART 套件（线25 25-9 路径 B）
 *
 * ⚠ (b) 版预案：收缩公开面后的写法 —— 只经**生产入口** `initSettingsBootFence()` 取边界；
 *   「模拟重启」改用 `vi.resetModules()` + 动态 `import()`（真实重启本来就重置模块态，忠实度更高），
 *   不再依赖 `bootSettingsRuntime()` 这个公开导出。
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md §8.1
 * 承载断言: B1 同 boot 改 restart 键 ⇒ effective 旧值 + pending 新值 / B2 同 boot 冻结稳定（D-BOOT-1）
 *           / B3 新 boot（模块态重置）⇒ bootId 变 + effective 新值
 *
 * A2 套件定位串: settings-applies-restart（yaml evidence 串逐字；本文件含一次，另一套件串不出现）
 * env 隔离: 双指 tmpdir，绝不写仓库或真实 $HOME。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  changedOnDisk: boolean;
  sourceLayer: string;
}

const V1 = 'settings:\n  llm:\n    baseUrl: "http://old.invalid"\n';
const V2 = 'settings:\n  llm:\n    baseUrl: "http://new.invalid"\n';

describe('settings-applies-restart · RESTART 套件（D1053 / 25-9 路径 B）', () => {
  let root = '';
  let home = '';
  let savedRoot: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedRoot = process.env[ENV_ROOT];
    savedHome = process.env[ENV_HOME];
    root = mkdtempSync(join(tmpdir(), 'd1053-restart-root-'));
    home = mkdtempSync(join(tmpdir(), 'd1053-restart-home-'));
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

  it('B1 · 同 boot 改 restart 键 ⇒ effective 仍旧值 + pending 新值 + applies:restart（绝不半生效）', () => {
    writeWorkspace(V1);
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    const before = runtime.row('llm.baseUrl') as RowLike | null;
    expect(before?.applies).toBe('restart');
    expect(before?.effective).toBe('http://old.invalid');
    expect(before?.pending).toBeNull();
    writeWorkspace(V2);
    const after = runtime.row('llm.baseUrl') as RowLike | null;
    expect(after?.effective).toBe('http://old.invalid');
    expect(after?.pending).toBe('http://new.invalid');
    expect(after?.changedOnDisk).toBe(true);
    expect(after?.applies).toBe('restart');
  });

  it('B2 · 同 boot 内多次读取 restart 键 effective 恒等（判据 D-BOOT-1：变化即半生效）', () => {
    writeWorkspace(V1);
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    const first = runtime.row('llm.baseUrl') as RowLike | null;
    writeWorkspace(V2);
    const second = runtime.row('llm.baseUrl') as RowLike | null;
    const third = runtime.row('llm.baseUrl') as RowLike | null;
    expect(second?.effective).toBe(first?.effective);
    expect(third?.effective).toBe(first?.effective);
    expect(runtime.bootId).toBeTruthy();
    expect(runtime.bootId.length).toBeGreaterThan(8);
  });

  it('B3 · 新 boot（模块态重置 = 真实重启语义）⇒ bootId 变 + restart 键 effective = 新值', async () => {
    writeWorkspace(V1);
    initSettingsBootFence({ force: true });
    const bootIdA = getSettingsRuntime().bootId;
    expect((getSettingsRuntime().row('llm.baseUrl') as RowLike | null)?.effective).toBe('http://old.invalid');

    writeWorkspace(V2);
    // 模拟重启：清模块注册表 ⇒ 新模块实例（bootFence 归零）⇒ 重新经生产入口建立边界
    vi.resetModules();
    const restarted = await import('../../src/config/settings-applies');
    restarted.initSettingsBootFence();
    const runtimeB = restarted.getSettingsRuntime();

    expect(runtimeB.bootId).not.toBe(bootIdA);
    expect((runtimeB.row('llm.baseUrl') as RowLike | null)?.effective).toBe('http://new.invalid');
    expect((runtimeB.row('llm.baseUrl') as RowLike | null)?.pending).toBeNull();
  });

  it('边界 · 两层文件均无该 restart 键 ⇒ 回落声明默认值且 sourceLayer:declaration', () => {
    initSettingsBootFence({ force: true });
    const row = getSettingsRuntime().row('llm.baseUrl') as RowLike | null;
    expect(row?.effective).toBe('https://api.deepseek.com/v1');
    expect(row?.sourceLayer).toBe('declaration');
    expect(row?.pending).toBeNull();
  });

  it('降级 · YAML 不可解析 ⇒ degraded:true + code + reason（铁律 24/31，检查面不成为故障面）', () => {
    writeWorkspace('settings:\n  llm:\n    baseUrl: "unterminated\n');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect(runtime.degraded).toBe(true);
    expect(runtime.code).toBe('SETTINGS_SOURCE_UNPARSABLE');
    expect(String(runtime.reason)).toContain('settings.yaml');
    expect((runtime.row('llm.baseUrl') as RowLike | null)?.effective).toBe('https://api.deepseek.com/v1');
  });

  it('降级 · 文件值类型与声明默认值不同类 ⇒ degraded + 该键回落默认值（显式点名，禁静默）', () => {
    writeWorkspace('settings:\n  server:\n    port: "not-a-number"\n');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect(runtime.degraded).toBe(true);
    expect(runtime.code).toBe('SETTINGS_VALUE_TYPE_MISMATCH');
    expect((runtime.row('server.port') as RowLike | null)?.effective).toBe(18790);
  });

  it('边界 · restart 键仅 home 层给值 ⇒ 同 boot 冻结后改 home 盘仍为旧值', () => {
    writeFileSync(join(home, 'settings.yaml'), V1, 'utf8');
    initSettingsBootFence({ force: true });
    const runtime = getSettingsRuntime();
    expect((runtime.row('llm.baseUrl') as RowLike | null)?.sourceLayer).toBe('home');
    writeFileSync(join(home, 'settings.yaml'), V2, 'utf8');
    const after = runtime.row('llm.baseUrl') as RowLike | null;
    expect(after?.effective).toBe('http://old.invalid');
    expect(after?.pending).toBe('http://new.invalid');
  });
});
