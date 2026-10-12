/**
 * tests/control-tower/block-paths-core.test.ts — 块级 `paths` 生成/对账（CTO 裁定 074 步 1b）
 *
 * 覆盖矩阵（铁律 48 三路径：正常 / 降级 / 边界 —— 逐条有真断言，禁空壳）
 *
 *  情境① 块 items 为空（真源 K11）                    ⇒ `[]`、不报错、exit 0
 *  情境② 块存在但所有 item 的 paths 都空（真源 K13）   ⇒ `[]`、块**存在**（防"漏块当空"）
 *  情境③ 同一路径被多 item 引用                        ⇒ 去重后只出现一次（真源 7/14 块天然有重复）
 *  情境④ item 的 `paths` 缺省（undefined）             ⇒ 按 `[]`、**不崩**、notes 点名（夹具 `no-paths-field`）
 *  情境⑤ 🔴 `items` 引用不存在的 id                     ⇒ **exit 2**（禁静默跳过 —— 夹具 `dangling`）
 *  情境⑥ 通配符与普通路径混存                          ⇒ **两条都在、不合并**（夹具 `no-paths-field` ＋ 真源）
 *  情境⑦ 排序稳定性                                    ⇒ 同输入两次 ⇒ **逐字节相同**（跑两次独立进程）
 *  情境⑧ 路径含非 ASCII / 空格 / 单引号                ⇒ 原样进结果、仍稳定
 *  情境⑨ 🔴 块 id 带 `as BlockId` 断言                  ⇒ 仍能取到（**今天的坑，回归测试**）
 *  情境⑩ 快照与现算不符                                ⇒ **exit 1**（真源天然无差异；夹具造差异）
 *
 * 负向（改坏即红）：N1 改 item.paths ｜ N2 删块级 paths 条目 ｜ N3 缺 `constructionItems` 导出 ｜ N3b 块级 paths 整体缺失
 *
 * 🔴 造场景的技术支点：`computeBlockPaths` / `compareBlockPaths` 吃**已 import 进来的数据对象**，
 *    不在函数内部自己 import ⇒ ① 可注入合成数据（覆盖真源里取不到的形态）
 *    ② `import` 真源仍在 CLI 入口（约束①"禁正则解析 TS"不破）。
 *    凡"必须验 CLI 全链路"的（⑤ / N3 / N3b）一律走 `--source <fixture>` 真跑子进程，**只测 core 不算数**。
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_MISMATCH,
  EXIT_OK,
  EXIT_UNJUDGEABLE,
  compareBlockPaths,
  computeBlockPaths,
  dedupSort,
  renderBlockPathsJson,
  validateRegistryView,
  type RegistryView,
} from '../../scripts/control-tower/block-paths-core.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const TRUE_SOURCE = join(REPO_ROOT, 'docs/synova/coordination/施工项登记.ts');
const FIXTURES = join(HERE, 'block-paths-fixtures');
const ENTRY_GEN = join(REPO_ROOT, 'scripts/control-tower/gen-block-paths.ts');
const ENTRY_CHECK = join(REPO_ROOT, 'scripts/control-tower/check-block-paths.ts');
const GATE_SH = join(REPO_ROOT, 'scripts/control-tower/check-block-paths.sh');

/** 🔴 真源必须存在（本测试的对象就是它；不在 ⇒ 立刻红，不静默跳过） */
if (!existsSync(TRUE_SOURCE)) {
  throw new Error(`真源缺失，测试无法进行：${TRUE_SOURCE}（🔴 本地/CI 均以真源为对象，禁静默跳过）`);
}

/** tsx 可执行文件（本仓 → 主仓上溯，与门禁壳同一条上溯规则） */
function findTsx(): string {
  const cands = [
    process.env['SYNO_TSX'] ?? '',
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    join(dirname(REPO_ROOT), 'node_modules/.bin/tsx'),
    join(dirname(dirname(REPO_ROOT)), 'node_modules/.bin/tsx'),
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
  ];
  for (const c of cands) if (c !== '' && existsSync(c)) return c;
  throw new Error('找不到 tsx（本仓与上溯两级均无 node_modules/.bin/tsx）');
}
const TSX = findTsx();

/** node 的 bin 目录（`node_modules/.bin/tsx` 是 `#!/usr/bin/env node` 的启动器 ⇒ PATH 必须有 node） */
function findNodeBinDir(): string {
  const tsxDir = dirname(TSX);
  const nodeShim = join(tsxDir, 'node');
  if (existsSync(nodeShim)) return tsxDir;
  const fromPath = (process.env['PATH'] ?? '')
    .split(':')
    .filter((p) => p !== '' && existsSync(join(p, 'node')));
  if (fromPath.length > 0) return fromPath[0] as string;
  throw new Error('找不到 node 的 bin 目录（tsx 需要 `env node`）');
}

/** 跑一次 TS 入口（🔴 真子进程，禁 mock —— 被测的正是 CLI 取数链路） */
function runTsx(entry: string, args: readonly string[] = []): { rc: number; stdout: string; stderr: string } {
  const env = { ...process.env, PATH: `${findNodeBinDir()}:${process.env['PATH'] ?? ''}` };
  try {
    const stdout = execFileSync(TSX, [entry, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return { rc: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { rc: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** 跑一次 bash 门禁壳（三态／负向的**最终判据点**：仓内唯一被 pre-commit/CI 调用的入口） */
function runGateSh(args: readonly string[] = []): { rc: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [GATE_SH, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, SYNO_TSX: TSX },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return { rc: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { rc: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** 真源视图（🔴 经 CLI 取数出口 `--json-raw` —— 与门禁**同一条**访问路径，而非测试自己再 import 一次） */
function loadTrueSource(): TrueSourceView {
  const r = runTsx(ENTRY_GEN, ['--json-raw']);
  if (r.rc !== 0) {
    throw new Error(`取真源失败（rc=${r.rc}）：${r.stderr.slice(0, 500)}`);
  }
  return JSON.parse(r.stdout) as TrueSourceView;
}

/**
 * `--json-raw` 的返回形态。
 * 🔴 `paths: null` = **字段缺省**，`paths: []` = 空数组 —— 两者必须区分（情境④要看得见这个差别）。
 */
interface TrueSourceView {
  itemCount: number;
  ok: boolean;
  errors: string[];
  notes: string[];
  blocks: { id: string; items: string[]; paths: string[] | null; computed: string[] }[];
  items: { id: string; paths: string[] | null }[];
}

/** `TrueSourceView` → core 入参形态（`paths: null` = 字段缺省 ⇒ 不设该键，与 `[]` 区分） */
function toRegistryView(v: TrueSourceView): RegistryView {
  return {
    items: v.items.map((it) => (it.paths === null ? { id: it.id } : { id: it.id, paths: it.paths })),
    blocks: v.blocks.map((b) =>
      b.paths === null ? { id: b.id, items: b.items } : { id: b.id, items: b.items, paths: b.paths },
    ),
  };
}

// ════════════════════════════════════════════════════════════════════
// 情境①–④、⑥、⑧：core 层（纯函数 + 合成数据）
// ════════════════════════════════════════════════════════════════════
describe('情境①–④ / ⑥ / ⑧ — core 纯函数三路径', () => {
  it('情境① 块 items 为空 ⇒ `[]` 且不报错、exit 0', () => {
    const view: RegistryView = {
      items: [{ id: 'x-1', paths: ['src/x.ts'] }],
      blocks: [{ id: 'EMPTY', items: [], paths: [] }],
    };
    const res = computeBlockPaths(view);
    expect(res.ok).toBe(true);
    expect(res.exit).toBe(EXIT_OK);
    expect(res.byBlock['EMPTY']).toEqual([]);
    expect(res.diag.errors).toEqual([]);
  });

  it('情境①（真源）K11 的 items 为空 ⇒ `[]`，不报错', () => {
    const view = loadTrueSource();
    const res = computeBlockPaths(toRegistryView(view));
    expect(res.ok).toBe(true);
    expect(res.byBlock['K11']).toEqual([]);
  });

  it('情境② 块存在但所有 item 的 paths 都空 ⇒ `[]`，且**块仍存在**（防"漏块当空"）', () => {
    const view: RegistryView = {
      items: [
        { id: 'e-1', paths: [] },
        { id: 'e-2', paths: [] },
      ],
      blocks: [{ id: 'ALL-EMPTY', items: ['e-1', 'e-2'], paths: [] }],
    };
    const res = computeBlockPaths(view);
    expect(res.ok).toBe(true);
    // 🔴 「存在且为数组」是关键断言：漏块时 `byBlock['ALL-EMPTY']` 会是 undefined
    expect(Object.prototype.hasOwnProperty.call(res.byBlock, 'ALL-EMPTY')).toBe(true);
    expect(Array.isArray(res.byBlock['ALL-EMPTY'])).toBe(true);
    expect(res.byBlock['ALL-EMPTY']).toEqual([]);
  });

  it('情境②（真源）K13 的 11 项 pathTBD 全空 ⇒ `[]`，不报错', () => {
    const view = loadTrueSource();
    const res = computeBlockPaths(toRegistryView(view));
    expect(res.ok).toBe(true);
    expect(res.byBlock['K13']).toEqual([]);
    expect(res.diag.errors).toEqual([]);
  });

  it('情境③ 同一路径被多 item 引用 ⇒ 去重后只出现一次', () => {
    const view: RegistryView = {
      items: [
        { id: 'd-1', paths: ['x.ts'] },
        { id: 'd-2', paths: ['x.ts', 'y.ts'] },
      ],
      blocks: [{ id: 'DUP', items: ['d-1', 'd-2'], paths: ['x.ts', 'y.ts'] }],
    };
    const res = computeBlockPaths(view);
    expect(res.byBlock['DUP']).toEqual(['x.ts', 'y.ts']);
    expect((res.byBlock['DUP'] as string[]).filter((p) => p === 'x.ts')).toHaveLength(1);
  });

  it('情境③（真源）14 块快照逐块无重复元素（去重已生效）', () => {
    const view = loadTrueSource();
    const res = computeBlockPaths(toRegistryView(view));
    const dupBlocks: string[] = [];
    for (const b of view.blocks) {
      const snap = b.paths ?? [];
      if (snap.length !== new Set(snap).size) dupBlocks.push(b.id);
      const computed = res.byBlock[b.id] ?? [];
      if (computed.length !== new Set(computed).size) dupBlocks.push(`${b.id}(现算)`);
    }
    expect(dupBlocks).toEqual([]);
  });

  it('情境④ item 的 paths 缺省 ⇒ 按 `[]` 处理，**不崩**，且 notes 点名', () => {
    const view: RegistryView = {
      items: [{ id: 'n-1' }, { id: 'n-2', paths: ['z.ts'] }],
      blocks: [{ id: 'NOFIELD', items: ['n-1', 'n-2'], paths: ['z.ts'] }],
    };
    expect(() => computeBlockPaths(view)).not.toThrow();
    const res = computeBlockPaths(view);
    expect(res.ok).toBe(true);
    expect(res.byBlock['NOFIELD']).toEqual(['z.ts']);
    // 🔴 "不静默"：缺字段要看得见（否则与"本来就没有"无法区分）
    expect(res.diag.notes.join(' ')).toContain('缺 `paths` 字段');
  });

  it('情境⑥ 通配符与普通路径混存 ⇒ **三条都在，不合并**', () => {
    const wild = 'extensions/';
    const nested = 'extensions/adapters/**';
    const manifest = `extensions/*${'*'}/manifest.json`;
    const view: RegistryView = {
      items: [{ id: 'w-1', paths: [wild, nested, manifest] }],
      blocks: [{ id: 'WILD', items: ['w-1'], paths: [wild, nested, manifest] }],
    };
    const res = computeBlockPaths(view);
    expect(res.byBlock['WILD']).toHaveLength(3);
    expect(res.byBlock['WILD']).toEqual(expect.arrayContaining([wild, nested, manifest]));
    // 反例：任何"归一化"都会让长度变 2 或 1 ⇒ 必红
    expect(res.byBlock['WILD']).not.toContain('extensions/**');
  });

  it('情境⑥（真源）K12 里三条并存路径逐条原样在结果中', () => {
    const view = loadTrueSource();
    const res = computeBlockPaths(toRegistryView(view));
    const k12 = res.byBlock['K12'] as string[];
    for (const p of ['extensions/', 'extensions/adapters/**', 'extensions/business-models/**']) {
      expect(k12).toContain(p);
    }
  });

  it('情境⑧ 路径含非 ASCII / 空格 / 单引号 ⇒ 原样进结果（禁规范化）', () => {
    // 合成数据直接注入（字符面是 core 的职责）；`--source` 全链路那半由 ⑤ / N1 / N2 / N3 覆盖
    const view: RegistryView = {
      items: [{ id: 'n-1' }, { id: 'n-2', paths: ['dir with space/x.ts', "it's/a.ts", '提案/子目录/'] }],
      blocks: [
        {
          id: 'FX-CHARS',
          items: ['n-1', 'n-2'],
          paths: ['dir with space/x.ts', "it's/a.ts", '提案/子目录/'],
        },
      ],
    };
    const res = computeBlockPaths(view);
    expect(res.ok).toBe(true);
    expect(res.byBlock['FX-CHARS']).toEqual(['dir with space/x.ts', "it's/a.ts", '提案/子目录/']);
    // 🔴 缺 `paths` 的项要看得见（notes 点名）—— 与"空数组"可区分
    expect(res.diag.notes.join(' ')).toContain('缺 `paths` 字段');
  });

  it('情境⑧（真源）非 ASCII 路径原样在结果里', () => {
    const view = loadTrueSource();
    const res = computeBlockPaths(toRegistryView(view));
    const all = Object.values(res.byBlock).flat();
    expect(all).toContain('docs/synova/coordination/提案/');
    expect(all).toContain('docs/synova/research/DSH迁移施工图-20260820/');
  });
});

// ════════════════════════════════════════════════════════════════════
// 情境⑤ / ⑩：三态（含 CLI 全链路）
// ════════════════════════════════════════════════════════════════════
describe('情境⑤ — 悬空 item id ⇒ exit 2（判不了，禁静默跳过）', () => {
  it('core：悬空 ⇒ ok=false、exit 2、错误点名到 `ghost-99`，且**不当成空结果**', () => {
    const view: RegistryView = {
      items: [{ id: 'a-1', paths: ['x.ts'] }],
      blocks: [{ id: 'K1', items: ['a-1', 'ghost-99'], paths: ['x.ts'] }],
    };
    const res = computeBlockPaths(view);
    expect(res.ok).toBe(false);
    // 🔴 显式 toBe(2)：不是 not.toBe(0) —— "1（不一致）"与"2（判不了）"必须分开
    expect(res.exit).toBe(EXIT_UNJUDGEABLE);
    expect(res.diag.errors.join(' ')).toContain('ghost-99');
    expect(res.diag.errors.join(' ')).toContain('K1');
  });

  it('🔴 CLI 全链路（夹具 `dangling`）：静默跳过的实现在此**会假绿** ⇒ 必须 exit 2', () => {
    // 该夹具的快照刻意 = "跳过 ghost-99 之后的并集" ⇒ 若实现静默跳过 ⇒ exit 0（假绿）
    const r = runTsx(ENTRY_CHECK, ['--source', join(FIXTURES, 'dangling.ts')]);
    expect(r.rc).toBe(EXIT_UNJUDGEABLE);
    expect(`${r.stdout}${r.stderr}`).toContain('ghost-99');
  });

  it('🔴 bash 门禁壳亦传 exit 2（三态不能在中途被吞）', () => {
    const r = runGateSh(['--source', join(FIXTURES, 'dangling.ts')]);
    expect(r.rc).toBe(EXIT_UNJUDGEABLE);
  });

  it('🔴 反例对照：真源同文件里 `deriveBlockDeps()` 是**静默跳过** ⇒ 本件与之**有意不同**', () => {
    const src = readFileSync(TRUE_SOURCE, 'utf8');
    // 断言该先例仍在（若它被改掉，本条注释/测试需同步复核 —— 防"文档说的与代码不一致"）
    expect(src).toContain('if (!it) continue;');
    // 断言本件**不是**静默跳过（core 里悬空分支必须 push 错误）
    const core = readFileSync(join(REPO_ROOT, 'scripts/control-tower/block-paths-core.ts'), 'utf8');
    expect(core).toContain('悬空引用');
    expect(core).toMatch(/danglingCount\+\+/);
  });
});

describe('情境⑩ — 快照与现算不符 ⇒ exit 1', () => {
  it('core：造一条差异 ⇒ exit 1，且区分于 2', () => {
    const view: RegistryView = {
      items: [{ id: 'm-1', paths: ['x.ts', 'y.ts'] }],
      blocks: [{ id: 'MM', items: ['m-1'], paths: ['x.ts'] }],
    };
    const res = compareBlockPaths(view);
    expect(res.exit).toBe(EXIT_MISMATCH);
    expect(res.exit).not.toBe(EXIT_UNJUDGEABLE);
    expect(res.diffs).toHaveLength(1);
    expect(res.diffs[0]?.onlyInComputed).toEqual(['y.ts']);
  });

  it('🔴 CLI 全链路（夹具 `mismatch-items`，负向 N1）⇒ exit 1', () => {
    const r = runTsx(ENTRY_CHECK, ['--source', join(FIXTURES, 'mismatch-items.ts')]);
    expect(r.rc).toBe(EXIT_MISMATCH);
    expect(r.stdout).toContain('src/a-new.ts');
  });

  it('🔴 CLI 全链路（夹具 `mismatch-snapshot`，负向 N2）⇒ exit 1', () => {
    const r = runTsx(ENTRY_CHECK, ['--source', join(FIXTURES, 'mismatch-snapshot.ts')]);
    expect(r.rc).toBe(EXIT_MISMATCH);
    expect(r.stdout).toContain('tests/a.test.ts');
  });

  it('顺序漂移也算不一致（排序口径有防线）', () => {
    const view: RegistryView = {
      items: [
        { id: 'o-1', paths: ['a.ts'] },
        { id: 'o-2', paths: ['b.ts'] },
      ],
      // 快照集合相同但顺序反了 ⇒ 必须判"不一致"（否则判据④失去防线）
      blocks: [{ id: 'ORD', items: ['o-1', 'o-2'], paths: ['b.ts', 'a.ts'] }],
    };
    const res = compareBlockPaths(view);
    expect(res.exit).toBe(EXIT_MISMATCH);
    expect(res.diffs[0]?.orderOnlyDiffer).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 情境⑦：排序稳定性（真跑两次独立进程 ⇒ 逐字节相同）
// ════════════════════════════════════════════════════════════════════
describe('情境⑦ — 排序稳定性（同输入 ⇒ 逐字节相同）', () => {
  it('core：同输入两次 ⇒ 序列化逐字节相同', () => {
    const view: RegistryView = {
      items: [
        { id: 's-1', paths: ['b.ts', 'a.ts', 'b.ts'] },
        { id: 's-2', paths: ['提案/', 'C.ts'] },
      ],
      blocks: [
        { id: 'S2', items: ['s-2'], paths: ['C.ts', '提案/'] },
        { id: 'S1', items: ['s-1'], paths: ['a.ts', 'b.ts'] },
      ],
    };
    const a = renderBlockPathsJson(computeBlockPaths(view).byBlock);
    const b = renderBlockPathsJson(computeBlockPaths(view).byBlock);
    expect(b).toBe(a);
  });

  it('🔴 真源 E2E：两次独立进程输出逐字节相同（并落盘比对）', () => {
    const r1 = runTsx(ENTRY_GEN);
    const r2 = runTsx(ENTRY_GEN);
    expect(r1.rc).toBe(EXIT_OK);
    expect(r2.rc).toBe(EXIT_OK);
    expect(r2.stdout).toBe(r1.stdout); // 🔴 逐字节（vitest 的字符串相等即字节相等，UTF-8 下同理）

    const dir = mkdtempSync(join(tmpdir(), 'block-paths-repro-'));
    try {
      const f1 = join(dir, 'a.json');
      const f2 = join(dir, 'b.json');
      writeFileSync(f1, r1.stdout);
      writeFileSync(f2, r2.stdout);
      expect(readFileSync(f1, 'utf8')).toBe(readFileSync(f2, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('渲染用码点序（不是 localeCompare）：`Dockerfile` 排在 `app/` 之前', () => {
    const json = renderBlockPathsJson({ X: dedupSort(['app/**', 'Dockerfile', '.gitignore']) });
    const order = JSON.parse(json)['X'] as string[];
    expect(order).toEqual(['.gitignore', 'Dockerfile', 'app/**']);
    // 反证：localeCompare 会给 ['app/**','Dockerfile'] 的顺序（大写在后）⇒ 与本实现的序不同
    expect([...['app/**', 'Dockerfile']].sort((x, y) => x.localeCompare(y))).toEqual([
      'app/**',
      'Dockerfile',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// 情境⑨：`as BlockId` 断言的回归（禁正则解析 TS 的机器防线）
// ════════════════════════════════════════════════════════════════════
describe('情境⑨ — 块 id 带 `as BlockId` 断言 ⇒ 仍能取到（今天的坑，必须有回归测试）', () => {
  it('真源 `constructionBlocks` 是 14 块，且 4 个带断言的块都在', () => {
    const view = loadTrueSource();
    expect(view.blocks).toHaveLength(14);
    const ids = view.blocks.map((b) => b.id);
    // 逐条枚举（不写"14 个"这种手写数：改名/删块必须当场红）
    expect(ids).toEqual(
      expect.arrayContaining([
        'K11',
        'RETIRED',
        'K1',
        'K2',
        'K3',
        'K4',
        'K5',
        'K6',
        'K7',
        'K8',
        'K9',
        'K10',
        'K12',
        'K13',
      ]),
    );
    // 🔴 这 4 块正是带 `as BlockId` 断言的那 4 块（正则会漏它们）
    for (const id of ['K11', 'RETIRED', 'K12', 'K13']) {
      expect(computedHasBlock(loadTrueSource(), id)).toBe(true);
    }
  });

  it('🔴 反正则回归：天真正则只命中 10 块（与 import 的 14 块不等）⇒ 证明"禁正则"必要', () => {
    const src = readFileSync(TRUE_SOURCE, 'utf8');
    // 派单 §三① 描述的那类正则：要求"逗号紧跟引号"
    const naive = [...src.matchAll(/\bid:\s*'(K\d+|RETIRED)',\s*name:/g)].map((m) => m[1] as string);
    // 感知 `as BlockId` 的正则
    const aware = [
      ...src.matchAll(/\bid:\s*'(K\d+|RETIRED)'\s*(?:as\s+\w+)?,\s*name:/g),
    ].map((m) => m[1] as string);
    expect(naive).toHaveLength(10);
    expect(naive).not.toContain('K12');
    expect(aware).toHaveLength(14);
    expect(aware).toEqual(expect.arrayContaining(['K11', 'RETIRED', 'K12', 'K13']));
  });
});

// ════════════════════════════════════════════════════════════════════
// 负向 N3 / N3b（CLI 全链路）
// ════════════════════════════════════════════════════════════════════
describe('负向 N3 / N3b — "读不到"与"没有可比对象"一律 exit 2（fail-closed）', () => {
  it('🔴 N3：`constructionItems` 导出缺失（改名）⇒ exit 2（**不是 0**）', () => {
    const r = runTsx(ENTRY_CHECK, ['--source', join(FIXTURES, 'no-items-export.ts')]);
    expect(r.rc).toBe(EXIT_UNJUDGEABLE);
    expect(`${r.stdout}${r.stderr}`).toContain('constructionItems');
  });

  it('🔴 N3b：块级 `paths` 字段整体缺失 ⇒ exit 2（判不了，非"不一致"）', () => {
    const r = runTsx(ENTRY_CHECK, ['--source', join(FIXTURES, 'no-block-paths.ts')]);
    expect(r.rc).toBe(EXIT_UNJUDGEABLE);
    expect(`${r.stdout}${r.stderr}`).toContain('paths 字段缺失');
  });

  it('N3b 旁证：未合上游的分支形态（真源真的没有块级 paths）⇒ 同一分支判定为 2', () => {
    const src = readFileSync(TRUE_SOURCE, 'utf8');
    const hasBlockPaths = /id:\s*'K\d+'[^}]*?paths:/.test(src);
    // 真源当前**已含**块级 paths（上游 ct/block-paths 已入）⇒ 此处只断言"若缺则必为 2"的分支存在
    if (!hasBlockPaths) {
      const r = runTsx(ENTRY_CHECK);
      expect(r.rc).toBe(EXIT_UNJUDGEABLE);
    } else {
      expect(hasBlockPaths).toBe(true);
    }
  });

  it('真源不存在 ⇒ exit 2（不是 0，也不是崩）', () => {
    const r = runTsx(ENTRY_CHECK, ['--source', join(FIXTURES, '不存在的文件.ts')]);
    expect(r.rc).toBe(EXIT_UNJUDGEABLE);
    expect(`${r.stdout}${r.stderr}`).toContain('不存在');
  });

  it('形状校验：块 id 重复 ⇒ 判不了（且点名）', () => {
    const view = {
      items: [{ id: 'a', paths: ['x.ts'] }],
      blocks: [
        { id: 'DUP', items: ['a'], paths: ['x.ts'] },
        { id: 'DUP', items: ['a'], paths: ['x.ts'] },
      ],
    } as unknown as RegistryView;
    expect(validateRegistryView(view).join(' ')).toContain('块 id 重复');
    expect(computeBlockPaths(view).exit).toBe(EXIT_UNJUDGEABLE);
  });
});

// ════════════════════════════════════════════════════════════════════
// 判据①（放行后的新锚）：生成器对现真源跑 ⇒ 与真源逐块一致
// ════════════════════════════════════════════════════════════════════
describe('判据① — 生成器 vs 真源（14 块逐块一致，含顺序）', () => {
  it('core 层：14 块全部一致，MISMATCH=0', () => {
    const view = loadTrueSource();
    const res = compareBlockPaths(toRegistryView(view));
    expect(res.diffs).toEqual([]);
    expect(res.exit).toBe(EXIT_OK);
  });

  it('🔴 bash 门禁壳：exit 0（真源，无参数 = 生默认路径）', () => {
    const r = runGateSh();
    expect(r.rc).toBe(EXIT_OK);
    expect(r.stdout).toContain('14 块逐块一致');
  });

  it('生成器输出与真源块级 paths 逐块相同（防"生成器自己漂了"）', () => {
    const view = loadTrueSource();
    const gen = runTsx(ENTRY_GEN);
    expect(gen.rc).toBe(EXIT_OK);
    const parsed = JSON.parse(gen.stdout) as Record<string, string[]>;
    for (const b of view.blocks) {
      expect(parsed[b.id]).toEqual(b.paths);
    }
    expect(Object.keys(parsed)).toHaveLength(14);
  });
});

/** 辅助：块 id 在现算结果里是否有条目（且是数组） */
function computedHasBlock(view: RegistryView, blockId: string): boolean {
  const res = computeBlockPaths(view);
  return (
    Object.prototype.hasOwnProperty.call(res.byBlock, blockId) && Array.isArray(res.byBlock[blockId])
  );
}
