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

/* ══════════════════════════════════════════════════════════════════════════════
 * 步 4 · 可卸载性（--phase uninstall）的判据测试（CTO 裁定 074 步 4）
 *
 * 🔴 四条承重判据（禁删）：
 *   ① `splitMarkers` 必须把**块 id 一律降为弱标记** —— 本仓 `K3` 同时是**审计角色名**，
 *      裸 `grep -w K3` 实测命中 269 行（绝大多数是"K3 审计"）⇒ 不弱化就是**假红**。
 *   ② `sharedTopEntries` = "卸 X 会误伤他包"的机器判据（写集重叠）。
 *   ③ `tablesOf` 只认真源 `createsTable.name`（禁从别处猜表名）。
 *   ④ `topPathsLabel` 必须给"命中落在哪些文件" —— 回执要据此判"新残留 vs 历史冻结名单"。
 * ══════════════════════════════════════════════════════════════════════════════ */
import {
  RESIDUAL_CLASSES,
  RETENTION_BASES,
  U_CLEAN,
  extinctEntries,
  markersOf,
  runGrep,
  sharedTopEntries,
  splitMarkers,
  tablesOf,
  topPathsLabel,
} from '../../scripts/control-tower/check-customer-deps.ts';

describe('步4 · splitMarkers — 块 id 必须降为弱标记（防"审计角色名"假红）', () => {
  it('块 id 即使含字母也是弱标记', () => {
    const r = splitMarkers('K3', ['K3', '2-1a', '0-3']);
    expect(r.weak).toContain('K3');
    expect(r.strong).not.toContain('K3');
  });
  it('含字母的项 id 是强标记；纯数字项 id 是弱标记', () => {
    const r = splitMarkers('K3', ['K3', '2-1a', '0-3', 'K3-13']);
    expect(r.strong).toEqual(['2-1a', 'K3-13']);
    expect(r.weak.sort()).toEqual(['0-3', 'K3']);
  });
  it('markersOf 含块 id 本身', () => {
    expect(markersOf('K2', [{ id: '0-11', block: 'K2' }, { id: 'x', block: 'K9' }])).toEqual(['K2', '0-11']);
  });
});

describe('步4 · sharedTopEntries — 写集重叠（卸 X 会误伤他包）', () => {
  it('只挑"别的块也声明了"的条目', () => {
    const byBlock = { K3: ['src/sentinel/', 'src/store/'], K4: ['src/store/', 'cycles/'] };
    expect(sharedTopEntries(byBlock, 'K3')).toEqual(['src/store/']);
    expect(sharedTopEntries(byBlock, 'K4')).toEqual(['src/store/']);
  });
  it('独占 ⇒ 空', () => {
    expect(sharedTopEntries({ K1: ['a/'], K2: ['b/'] }, 'K1')).toEqual([]);
  });
});

describe('步4 · tablesOf — 只认真源 createsTable.name', () => {
  it('只取该块、且 name 非空', () => {
    const items = [
      { id: 'a', block: 'K3', createsTable: { name: 'metric_readings' } },
      { id: 'b', block: 'K3', createsTable: {} },
      { id: 'c', block: 'K9', createsTable: { name: 'other' } },
    ];
    expect(tablesOf('K3', items)).toEqual(['metric_readings']);
    expect(tablesOf('K9', items)).toEqual(['other']);
  });
});

describe('步4 · 常量与依据（防"声明保留"没有出处）', () => {
  it('七类残留一个不多一个不少', () => {
    expect([...RESIDUAL_CLASSES]).toEqual(['目录', '配置', '表', '索引', '引用', '缓存', '登记']);
  });
  it('每条"声明保留"都必须点名到文件/件', () => {
    expect(RETENTION_BASES.length).toBeGreaterThan(0);
    for (const b of RETENTION_BASES) {
      expect(b.basis).toMatch(/施工项登记\.ts:\d+|AGENTS\.md/);
    }
  });
  it('干净是独立态（不许与判不了混用字面量）', () => {
    expect(U_CLEAN).toBe('干净');
  });
});

describe('步4 · topPathsLabel — 命中落在哪些文件', () => {
  it('按文件聚合、降序、给出总数', () => {
    const hits = ['a/x.ts:1:foo', 'a/x.ts:2:foo', 'b/y.ts:9:foo'];
    expect(topPathsLabel(hits)).toBe('a/x.ts×2 , b/y.ts×1');
  });
  it('超过 top ⇒ 标出文件总数', () => {
    expect(topPathsLabel(['a:1', 'b:1', 'c:1'], 2)).toContain('共 3 个文件');
  });
});

describe('步4 · runGrep / extinctEntries — 环境边界', () => {
  it('grep 无命中 ⇒ count=0（正常默认，不是异常）', () => {
    const r = runGrep(process.cwd(), ['-rnwE', '-e', '__决不存在的标记__', 'package.json']);
    expect(r.count).toBe(0);
    expect(r.command).toContain('grep');
  });
  it('目录不存在 ⇒ 空数组，不抛', () => {
    expect(extinctEntries('/tmp/绝对不存在的目录-xyz')).toEqual([]);
  });
});
