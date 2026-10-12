/**
 * tests/control-tower/check-customer-deps.test.ts — 第二档演练器的判据（CTO 裁定 086）
 *
 * 🔴 三条承重判据（禁删）：
 *   ① `stepPassed` 必须**照真源自己的期望**判（expectExit / expectStdoutContains /
 *      expectRowsGt / expectRowsEq）—— 另造一套 = 制造第二口径。
 *   ② `scanDeclarations` 必须在"项级无对应边"时判**判不了**（打回候选值的机器依据）。
 *   ③ `commandOwnPaths` 必须排除判据自身文件 —— 否则"自摘必红"是同义反复（灵敏度筛选失效）。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  R_ENTANGLED,
  R_NO_ITEM_EDGE,
  V_UNK,
  commandOwnPaths,
  minStepsOf,
  scanDeclarations,
  stepPassed,
  type BlockLike,
  type ItemLike,
} from '../../scripts/control-tower/check-customer-deps.ts';

describe('stepPassed — 照真源期望判（禁另造口径）', () => {
  it('expectExit 命中 ⇒ 过；不命中 ⇒ 不过', () => {
    expect(stepPassed({ run: 'x', expectExit: 0 }, 0, '')).toBe(true);
    expect(stepPassed({ run: 'x', expectExit: 0 }, 1, '')).toBe(false);
    expect(stepPassed({ run: 'x', expectExit: 2 }, 2, '')).toBe(true);
  });
  it('expectStdoutContains ⇒ 看 stdout', () => {
    expect(stepPassed({ run: 'x', expectStdoutContains: 'OK' }, 0, 'a OK b')).toBe(true);
    expect(stepPassed({ run: 'x', expectStdoutContains: 'OK' }, 0, 'a b')).toBe(false);
  });
  it('expectRowsGt / expectRowsEq ⇒ 解析首列数字', () => {
    expect(stepPassed({ run: 'x', expectRowsGt: { table: 't', n: 0 } }, 0, '3\n')).toBe(true);
    expect(stepPassed({ run: 'x', expectRowsGt: { table: 't', n: 0 } }, 0, '0\n')).toBe(false);
    expect(stepPassed({ run: 'x', expectRowsEq: { table: 't', n: 0 } }, 0, '0\n')).toBe(true);
  });
  it('超时（rc=null）⇒ fail-closed 判不过', () => {
    expect(stepPassed({ run: 'x' }, null, '')).toBe(false);
  });
  it('无任何期望 ⇒ 退化为 rc===0', () => {
    expect(stepPassed({ run: 'x' }, 0, '')).toBe(true);
    expect(stepPassed({ run: 'x' }, 1, '')).toBe(false);
  });
});

const items: ItemLike[] = [
  { id: 'y1', block: 'KY', paths: ['src/ky/'], dependsOn: ['x1'] },
  { id: 'y2', block: 'KY', paths: ['extensions/'], dependsOn: [] },
  { id: 'x1', block: 'KX', paths: ['src/kx/'] },
  { id: 'x2', block: 'KX', paths: ['extensions/'] },
];
const blocks: BlockLike[] = [
  { id: 'KY', items: ['y1', 'y2'], blockAcceptance: [{ run: 'echo KY', expectExit: 0 }] },
  { id: 'KX', items: ['x1', 'x2'], blockAcceptance: [] },
];

describe('scanDeclarations — 静态可判性', () => {
  it('项级有边且不纠缠 ⇒ 可判（待真跑），锚 = 该 item 的 paths', () => {
    const rows = scanDeclarations(items, blocks, [{ pkg: 'KY', missing: 'KX', unavailable: ['a'] }]);
    expect(rows[0]?.verdict).toBe('可判（待真跑）');
    expect(rows[0]?.anchor).toEqual(['src/kx/']);
    expect(rows[0]?.itemEdges).toEqual(['x1']);
  });
  it('项级无边 ⇒ 判不了（打回候选值的机器依据）', () => {
    const rows = scanDeclarations(items, blocks, [{ pkg: 'KX', missing: 'KY', unavailable: ['a'] }]);
    expect(rows[0]?.verdict).toBe(V_UNK);
    expect(rows[0]?.reason).toBe(R_NO_ITEM_EDGE);
  });
  it('锚与 Y 的项级 paths 字面包含 ⇒ 判不了（不取块级）', () => {
    const it2: ItemLike[] = [
      { id: 'y1', block: 'KY', paths: ['extensions/'], dependsOn: ['x2'] },
      { id: 'x2', block: 'KX', paths: ['extensions/'] },
    ];
    const rows = scanDeclarations(it2, blocks, [{ pkg: 'KY', missing: 'KX', unavailable: ['a'] }]);
    expect(rows[0]?.verdict).toBe(V_UNK);
    expect(rows[0]?.reason).toBe(R_ENTANGLED);
  });
  it('声明为空 ⇒ 不适用（不是判不了）', () => {
    const rows = scanDeclarations(items, blocks, [{ pkg: 'KY', missing: '', unavailable: [] }]);
    expect(rows[0]?.verdict).toBe('不适用');
  });
});

describe('minStepsOf — 块级优先，无则回退 items', () => {
  it('有 blockAcceptance 用它', () => {
    expect(minStepsOf('KY', items, blocks)).toHaveLength(1);
  });
  it('没有则回退该块 items 的 acceptance；都没有 ⇒ 空', () => {
    expect(minStepsOf('KX', items, blocks)).toEqual([]);
  });
});

describe('commandOwnPaths — 排除判据自身文件（防同义反复）', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cmd-own-'));
    mkdirSync(join(root, 'tests', 'g'), { recursive: true });
    writeFileSync(join(root, 'tests', 'g', 'a.test.ts'), '\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  it('抽出命令里真实存在的仓内文件', () => {
    expect(commandOwnPaths('npx vitest run tests/g/a.test.ts', root)).toEqual(['tests/g/a.test.ts']);
  });
  it('不存在的路径与选项不入选', () => {
    expect(commandOwnPaths('npx --flag ghost/x.ts tests/g/a.test.ts', root)).toEqual(['tests/g/a.test.ts']);
  });
});
