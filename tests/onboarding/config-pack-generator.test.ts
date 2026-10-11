/**
 * tests/onboarding/config-pack-generator.test.ts — 配对测试（铁律 48）
 *
 * 覆盖：正常（多角色写盘）｜降级（roleId 非法 ⇒ 跳过 + errors 点名，不抛）｜
 *       边界（dry-run 绝不落盘；空角色零写入；路径穿越被拒；目录已存在时幂等覆盖）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateConfigPack } from '../../src/onboarding/config-pack-generator';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-pack-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config-pack-generator — 正常路径', () => {
  it('两个角色 ⇒ 真写 6 件（每角色 3 类 yaml），written 已排序', () => {
    const r = generateConfigPack({
      roles: [
        { roleId: 'finance', knowledgeScope: ['finance/reports'], capabilities: ['budget-review'], acceptanceCriteria: ['c1'] },
        { roleId: 'sales', capabilities: ['forecast'] },
      ],
      rootDir: root,
    });
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.written.length).toBe(6);
    expect(r.written).toEqual([...r.written].sort());
    expect(r.written).toContain(join('extensions/presets/roles/finance', 'knowledge-scope.yaml'));
  });

  it('写入内容含真值（不是空壳文件）', () => {
    generateConfigPack({ roles: [{ roleId: 'finance', capabilities: ['budget-review'] }], rootDir: root });
    const body = readFileSync(join(root, 'extensions/presets/roles/finance', 'capabilities.yaml'), 'utf8');
    expect(body).toContain('budget-review');
    expect(body).toContain('capabilities:');
  });

  it('列表为空 ⇒ 渲染 `key: []`（非空文件，仍可被解析）', () => {
    generateConfigPack({ roles: [{ roleId: 'hr' }], rootDir: root });
    const body = readFileSync(join(root, 'extensions/presets/roles/hr', 'knowledge-scope.yaml'), 'utf8');
    expect(body).toContain('knowledgeScope: []');
  });
});

describe('config-pack-generator — 降级路径', () => {
  it('🔴 roleId 非法（路径穿越）⇒ 跳过 + errors 点名，且**不创建穿越目标**', () => {
    const r = generateConfigPack({ roles: [{ roleId: '../evil' }, { roleId: 'ok-role' }], rootDir: root });
    expect(r.degraded).toBe(true);
    expect(r.skipped.join(' ')).toContain('../evil');
    expect(r.errors.join(' ')).toContain('roleId 非法');
    expect(existsSync(join(root, 'evil'))).toBe(false);
    // 合法的那个照写
    expect(r.written.join(' ')).toContain('ok-role');
  });

  it('空字符串 roleId / 大写 / 下划线 一律非法（白名单正则）', () => {
    const r = generateConfigPack({
      roles: [{ roleId: '' }, { roleId: 'Finance' }, { roleId: 'a_b' }],
      rootDir: root,
    });
    expect(r.written).toEqual([]);
    expect(r.skipped.length).toBe(3);
  });
});

describe('config-pack-generator — 边界', () => {
  it('🔴 dry-run ⇒ written 空、planned 有条目、**文件系统零写入**', () => {
    const r = generateConfigPack({ roles: [{ roleId: 'finance' }], rootDir: root, dryRun: true });
    expect(r.written).toEqual([]);
    expect(r.planned.length).toBe(3);
    expect(existsSync(join(root, 'extensions'))).toBe(false);
    expect(r.degraded).toBe(false);
  });

  it('空角色数组 ⇒ 零写入且非 degraded（ENAENT 级正常默认）', () => {
    const r = generateConfigPack({ roles: [], rootDir: root });
    expect(r.written).toEqual([]);
    expect(r.planned).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('重复执行幂等（覆盖写，不报错、不重复计数）', () => {
    const seed = { roles: [{ roleId: 'finance', capabilities: ['x'] }], rootDir: root };
    const first = generateConfigPack(seed);
    const second = generateConfigPack(seed);
    expect(first.written).toEqual(second.written);
    expect(second.errors).toEqual([]);
  });
});
