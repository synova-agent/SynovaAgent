/**
 * tests/init/preset-loader.test.ts — `src/init/preset-loader.ts` 配对测试（铁律 48）
 *
 * 覆盖三路径（每路径 ≥1 真 `expect()`）：
 *   正常：临时内容根 + 齐备角色包 ⇒ roles 含该角色、pieces 齐、degraded=false
 *   降级：内容根缺失 / roles 目录缺失 / 角色缺件 ⇒ degraded=true + errors 点名，且**不抛**
 *   边界：空 roles 目录 / 隐藏项 / 非目录项 / 覆盖缝 SYNOVA_PRESETS_ROOT
 *
 * 🔴 隔离手法：用 `SYNOVA_PRESETS_ROOT` 指向 `tmpdir()` 夹具，**不读也不改**仓库真实内容面
 *   （`extensions/presets/**` 属 K12-01 段一交付物，本卡零改动 —— 只读它另有一条"真实内容面"用例）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearPresetCache, listRolePacks, loadRolePacks } from '../../src/init/preset-loader';

/** 五件套（与 loader 的 EXPECTED_PIECES 同源语义） */
const PIECES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/** 造一个齐备角色目录 */
function writeRole(rolesRoot: string, roleId: string, omit: readonly string[] = []): void {
  const dir = join(rolesRoot, roleId);
  mkdirSync(dir, { recursive: true });
  for (const piece of PIECES) {
    if (omit.includes(piece)) continue;
    writeFileSync(join(dir, piece), `# ${roleId}/${piece}\n`, 'utf8');
  }
}

let root: string;
const ORIGINAL_ENV = process.env['SYNOVA_PRESETS_ROOT'];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'preset-loader-'));
  process.env['SYNOVA_PRESETS_ROOT'] = root;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (ORIGINAL_ENV === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_ENV;
});

describe('preset-loader — 正常路径', () => {
  it('齐备的角色包 ⇒ roles 含该角色且五件套齐、degraded=false', () => {
    mkdirSync(join(root, 'roles'), { recursive: true });
    writeRole(join(root, 'roles'), 'finance');

    const report = loadRolePacks();
    expect(report.degraded).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.roles.map((r) => r.roleId)).toEqual(['finance']);
    expect(report.roles[0]?.missing).toEqual([]);
    expect([...(report.roles[0]?.pieces ?? [])].sort()).toEqual([...PIECES].sort());
  });

  it('多角色 ⇒ roleId 字典序稳定（判据可比对）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'sales');
    writeRole(rolesRoot, 'finance');
    writeRole(rolesRoot, 'hr');

    expect(listRolePacks()).toEqual(['finance', 'hr', 'sales']);
  });

  it('listRolePacks() 零参返回角色 id 清单（探针观测面同源）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');

    expect(listRolePacks()).toContain('finance');
  });
});

describe('preset-loader — 降级路径', () => {
  it('内容根不存在 ⇒ degraded=true、roles 空、**不抛**（ENOENT = 正常默认，不进 errors）', () => {
    process.env['SYNOVA_PRESETS_ROOT'] = join(root, '__absent__');

    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles).toEqual([]);
    expect(report.errors).toEqual([]); // ENOENT 不算错误
  });

  it('roles 子目录缺失 ⇒ degraded=true、roles 空、不抛', () => {
    // root 存在但无 roles/
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles).toEqual([]);
  });

  it('角色缺件 ⇒ degraded=true 且 errors 逐条点名缺哪几件（不静默）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance', ['capabilities.yaml', 'acceptance-criteria.yaml']);

    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles[0]?.missing).toEqual(['capabilities.yaml', 'acceptance-criteria.yaml']);
    expect(report.errors.join(' ')).toContain('finance');
    expect(report.errors.join(' ')).toContain('capabilities.yaml');
  });

  it('空 roles 目录 ⇒ degraded=true（无角色即降级），但无 error', () => {
    mkdirSync(join(root, 'roles'), { recursive: true });

    const report = loadRolePacks();
    expect(report.roles).toEqual([]);
    expect(report.degraded).toBe(true);
    expect(report.errors).toEqual([]);
  });
});

describe('preset-loader — 边界', () => {
  it('忽略隐藏项与非目录项（.DS_Store / 散落文件不成为角色）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');
    writeFileSync(join(rolesRoot, '.DS_Store'), 'x', 'utf8');
    writeFileSync(join(rolesRoot, 'README.md'), '# not a role\n', 'utf8');

    const report = loadRolePacks();
    expect(report.roles.map((r) => r.roleId)).toEqual(['finance']);
  });

  it('零字节件视为缺失（非空判定）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');
    writeFileSync(join(rolesRoot, 'finance', 'capabilities.yaml'), '', 'utf8');

    const report = loadRolePacks();
    expect(report.roles[0]?.missing).toEqual(['capabilities.yaml']);
  });

  it('clearPresetCache() 幂等且不抛（无缓存可清的显式声明）', () => {
    expect(() => {
      clearPresetCache();
      clearPresetCache();
    }).not.toThrow();
  });

  it('真实内容面（extensions/presets）在本仓可用 —— 至少 3 个出厂角色齐备', () => {
    // 本条**只读**真实内容面（不写不删），确认段一交付面与 loader 契约一致
    delete process.env['SYNOVA_PRESETS_ROOT'];
    const report = loadRolePacks();
    const ids = report.roles.map((r) => r.roleId);
    expect(ids).toContain('finance');
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(report.roles.every((r) => r.missing.length === 0)).toBe(true);
  });
});
