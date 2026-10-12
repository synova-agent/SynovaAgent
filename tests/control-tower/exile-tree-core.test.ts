/**
 * tests/control-tower/exile-tree-core.test.ts — 隔离宿主树核心（CTO 裁定 086）
 *
 * 🔴 判据（铁律 48：必须有真断言，禁空壳）：
 *   ① `expandPattern` 的四种字面量形态（目录尾斜杠 / 双星 / 单星 / 精确文件）
 *   ② `dropNested`：被祖先覆盖者不再单列（口径②）
 *   ③ `expandAll` **必须点名**匹配为 0 的字面量（口径① —— 禁静默跳过）
 *   ④ `applyExile` + `restoreTree` **往返无损**（摘了能原样还回来）
 *   ⑤ `restoreTree` 幂等（无隔离区时 restored=0 且 dangling 为空）
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  QUARANTINE,
  applyExile,
  dropNested,
  expandAll,
  expandPattern,
  restoreTree,
} from '../../scripts/control-tower/exile-tree-core.ts';

let root = '';

/** 造一棵最小树：src/a.ts、src/sub/b.ts、ext/one.json、ext/two.json、ext/deep/three.json */
function seed(): void {
  mkdirSync(join(root, 'src', 'sub'), { recursive: true });
  mkdirSync(join(root, 'ext', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'sub', 'b.ts'), 'export const b = 1;\n');
  writeFileSync(join(root, 'ext', 'one.json'), '{}\n');
  writeFileSync(join(root, 'ext', 'two.json'), '{}\n');
  writeFileSync(join(root, 'ext', 'deep', 'three.json'), '{}\n');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exile-tree-'));
  seed();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('expandPattern — 四种字面量形态', () => {
  it('目录尾斜杠 ⇒ 该目录本身', () => {
    expect(expandPattern(root, 'ext/')).toEqual(['ext']);
  });
  it('双星 ⇒ 目录本身 + 其下**目录**（零段也匹配；🔴 口径：不逐文件列举）', () => {
    expect(expandPattern(root, 'src/**')).toEqual(['src', 'src/sub']);
  });
  it('双星 + 具体末段 ⇒ 逐条匹配文件（这里必须逐条）', () => {
    expect(expandPattern(root, 'src/**/b.ts')).toEqual(['src/sub/b.ts']);
  });
  it('单星 ⇒ 段内任意，不跨段', () => {
    expect(expandPattern(root, 'ext/*.json')).toEqual(['ext/one.json', 'ext/two.json']);
  });
  it('精确文件 ⇒ 自身；不存在 ⇒ 空数组（不抛）', () => {
    expect(expandPattern(root, 'src/a.ts')).toEqual(['src/a.ts']);
    expect(expandPattern(root, 'no/such.ts')).toEqual([]);
  });
});

describe('dropNested — 口径②：被祖先覆盖者不再单列', () => {
  it('ext/ 与 ext/one.json 同时命中 ⇒ 只留 ext/', () => {
    expect(dropNested(['ext', 'ext/one.json', 'ext/deep/three.json'])).toEqual(['ext']);
  });
  it('互不包含 ⇒ 全留', () => {
    expect(dropNested(['src', 'ext'])).toEqual(['ext', 'src']);
  });
});

describe('expandAll — 口径①：匹配为 0 必须点名', () => {
  it('missing 列出没匹配到的字面量（禁静默跳过）', () => {
    const r = expandAll(root, ['src/a.ts', 'ghost/path', 'ext/*.json']);
    expect(r.missing).toEqual(['ghost/path']);
    expect(r.rels).toEqual(['ext/one.json', 'ext/two.json', 'src/a.ts']);
  });
});

describe('applyExile + restoreTree — 往返无损（口径③）', () => {
  it('摘了能原样还回来，且不留残留', () => {
    const rels = expandAll(root, ['src/sub/**', 'ext/one.json']).rels;
    const moved = applyExile(root, rels);
    expect(moved).toBeGreaterThan(0);
    expect(existsSync(join(root, 'src', 'sub'))).toBe(false);
    expect(existsSync(join(root, 'ext', 'one.json'))).toBe(false);
    expect(existsSync(join(root, QUARANTINE))).toBe(true);

    const rs = restoreTree(root);
    expect(rs.dangling).toEqual([]);
    expect(existsSync(join(root, 'src', 'sub', 'b.ts'))).toBe(true);
    expect(existsSync(join(root, 'ext', 'one.json'))).toBe(true);
    expect(existsSync(join(root, QUARANTINE))).toBe(false);
  });

  it('无隔离区时幂等：restored=0 且 dangling 为空', () => {
    const rs = restoreTree(root);
    expect(rs.restored).toBe(0);
    expect(rs.dangling).toEqual([]);
  });
});
