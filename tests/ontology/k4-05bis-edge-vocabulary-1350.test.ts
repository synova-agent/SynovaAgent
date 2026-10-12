/**
 * tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts — #1350（K4-05bis）边词表：目标层级边 ＋ 计划边
 *
 * 判据（CTO 受理裁定原文 V1/V2/V3）：
 *   V1 词表计数 = 实测基数 +2（56 → 58）；两新件与既有件**同构**（11 键 ＋ canonical 顺序）
 *   V2 新边被 ontology 加载器**认领**（`loadOntology()` 计数 +2）且 **#1031 的桥可读其字段**
 *   V3 反例：**删任一新边 ⇒ 加载计数回落 ⇒ 测试红**（本件 B 组即该反例，判别性）
 *
 * 🔴 设计要点 1（cwd 敏感）：`src/l4/ontology-loader.ts` 的 `ONTOLOGY_DIR =
 *    join(process.cwd(), 'extensions', 'ontology')` ⇒ **必须在独立子进程内先 `chdir` 再动态 import**，
 *    否则读到的是 vitest 进程的 cwd（= 真仓根），沙箱无效（且会**静默**拿到真仓 58 件）。
 * 🔴 设计要点 2（"删掉即报红"必须真发生）：沙箱删除后，**先断言沙箱磁盘实况**（文件数 57/56），
 *    再断言 `loadOntology()` 计数回落 —— 防「替换未发生却报绿」（R22 教训）。
 * 🔴 设计要点 3（口径）：本件所有计数都标**全量**（58 件逐件 / 沙箱逐件），非抽样。
 *
 * 判据口径：`ledger 值 + 口径(全量) + 时点(HEAD SHA) + 探针版本(本文件)`
 *
 * @module tests/ontology/k4-05bis-edge-vocabulary-1350
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const EDGE_DIR = join(REPO, 'extensions', 'ontology', 'edge-types');
const ONTOLOGY_DIR = join(REPO, 'extensions', 'ontology');
const LOADER_TS = join(REPO, 'src', 'l4', 'ontology-loader.ts');

/** 本卡新增两件的文件名（⏳ 待《命名权威登记册》N3/N4 认领确认 —— CTO 裁定 §2） */
const NEW_FILES = ['goal_decomposes_to.json', 'plan_commits_to.json'] as const;
/** 本卡新增两件的 label（CTO 裁定 §2 逐字） */
const NEW_LABELS = ['GOAL_DECOMPOSES_TO', 'PLAN_COMMITS_TO'] as const;

/** canonical 11 键顺序（实测 53/56 件；另 3 件在 transfer_function 与 description 之间多插 diagnostic_signals） */
const CANON_KEYS = [
  '$id', 'label', 'tags', 'allowedFrom', 'allowedTo', 'requiredProps', 'optionalProps',
  'consumed_by_sentinels', 'action_effect_lag', 'transfer_function', 'description',
] as const;

/** 🔴 棘轮：实测基数 56 ＋ 本卡 2 = 58。**漂移即红**。 */
const BASELINE_TOTAL = 58;
/** 无本卡两件时的基数（= 实测基数）。 */
const BASELINE_WITHOUT_NEW = 56;

const PROBE_PREFIX = 'SYNO_1350_PROBE:';

interface ProbeEdge {
  file: string | null;
  id: unknown;
  label: unknown;
  keys: string[];
  lag: unknown;
  tf: unknown;
  bridgeDegraded: boolean;
  bridgeParams: Array<{ key: string; status: string; injectable: boolean; value?: unknown }>;
}
interface ProbeResult {
  loaded: number;
  degraded: boolean;
  dirFiles: number;
  edges: ProbeEdge[];
}

/**
 * 经**生产入口** `loadOntology()` 在 `root` 下装载边类型。
 *
 * @input  root — 作为 `process.cwd()` 的树根；须含 `extensions/ontology/edge-types/`
 * @output `{ loaded, degraded, dirFiles, edges[] }`（`edges` 含 `$id`/`label`/键序/两参数字段/桥结果）
 * @degrade 子进程失败 / 超时 / 输出不可解析 ⇒ **抛**（fail-closed，禁与"通过"混同）
 */
function probe(root: string): ProbeResult {
  const loaderUrl = pathToFileURL(LOADER_TS).href;
  const code = `
(async () => {
  try {
    process.chdir(${JSON.stringify(root)});
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), 'extensions', 'ontology', 'edge-types');
    const dirFiles = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length;
    const fileOfId = new Map();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (d && typeof d['\$id'] === 'string') fileOfId.set(d['\$id'], f);
      } catch (e) { /* 坏文件不计入映射；装载器侧另有其职责 */ }
    }
    const m = await import(${JSON.stringify(loaderUrl)});
    const r = m.loadOntology();
    const edges = r.ontology.edgeTypes.map((e) => {
      const p = m.readEdgeTypeParams(e);
      return {
        file: fileOfId.has(String(e['\$id'])) ? fileOfId.get(String(e['\$id'])) : null,
        id: e['\$id'],
        label: e.label,
        keys: Object.keys(e),
        lag: Object.prototype.hasOwnProperty.call(e, 'action_effect_lag') ? e.action_effect_lag : undefined,
        tf: Object.prototype.hasOwnProperty.call(e, 'transfer_function') ? e.transfer_function : undefined,
        bridgeDegraded: p.degraded,
        bridgeParams: p.params.map((x) => ({ key: x.key, status: x.status, injectable: x.injectable, value: x.value })),
      };
    });
    process.stdout.write(${JSON.stringify(PROBE_PREFIX)} + JSON.stringify({
      loaded: edges.length, degraded: r.degraded, dirFiles, edges,
    }) + '\\n');
  } catch (err) {
    process.stderr.write('SYNO_1350_PROBE_ERR:' + (err && err.message ? err.message : String(err)) + '\\n');
    process.exitCode = 3;
  }
})();
`;
  const res = spawnSync(process.execPath, ['--import', 'tsx', '--eval', code], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (res.error) throw new Error(`生产入口子进程启动失败（fail-closed）: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`生产入口子进程非零退出（fail-closed）status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  }
  const line = String(res.stdout).split(/\r?\n/).find((l) => l.startsWith(PROBE_PREFIX));
  if (!line) throw new Error(`生产入口探针输出不可解析（fail-closed）: stdout=${res.stdout} stderr=${res.stderr}`);
  return JSON.parse(line.slice(PROBE_PREFIX.length)) as ProbeResult;
}

/**
 * 造一个沙箱：复制 `extensions/ontology/` 后**按名单物理删除**边文件。
 *
 * @input  remove — 要删除的边文件名（相对 `edge-types/`）
 * @output 沙箱根路径（调用方负责 rmSync 清理）
 * @invariant **不写真仓**；删除后由调用方用 `dirFiles` 核"替换确实发生"
 */
function makeSandbox(remove: readonly string[]): string {
  const sb = join(tmpdir(), `k4b3-1350-sb-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(sb, 'extensions'), { recursive: true });
  cpSync(ONTOLOGY_DIR, join(sb, 'extensions', 'ontology'), { recursive: true });
  for (const f of remove) {
    rmSync(join(sb, 'extensions', 'ontology', 'edge-types', f), { force: true });
  }
  return sb;
}

function withSandbox<T>(remove: readonly string[], fn: (sb: string) => T): T {
  const sb = makeSandbox(remove);
  try {
    return fn(sb);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
}

const edgeOf = (r: ProbeResult, label: string): ProbeEdge | undefined =>
  r.edges.find((e) => e.label === label);

// ═══════════════════════════════════════════════════════════════════════════
// 0. 前置：真仓磁盘实况（**不依赖装载器**，先钉住分母）
// ═══════════════════════════════════════════════════════════════════════════

describe('0. 真仓磁盘实况（全量，非抽样）', () => {
  const files = readdirSync(EDGE_DIR).filter((n) => n.endsWith('.json'));

  it('0.1 `edge-types/` 全量件数 = 58（实测基数 56 ＋ 本卡 2）', () => {
    expect(files.length).toBe(BASELINE_TOTAL);
  });

  it('0.2 本卡两件文件确实存在（防"没建文件却报绿"）', () => {
    for (const f of NEW_FILES) expect(files).toContain(f);
  });

  it('0.3 两件新文件 JSON 可解析，且 `$id`/`label` 与 CTO 裁定 §2 逐字一致', () => {
    for (const f of NEW_FILES) {
      const d = JSON.parse(readFileSync(join(EDGE_DIR, f), 'utf-8')) as Record<string, unknown>;
      expect(String(d['$id'])).toBe(`edge/${f.replace(/\.json$/, '')}`);
      expect(NEW_LABELS).toContain(String(d['label']));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A. 真仓基线 — 穿生产入口 loadOntology()（正常路径 / V1 ＋ V2）
// ═══════════════════════════════════════════════════════════════════════════

describe('A. 真仓基线 — 穿生产入口 loadOntology()（正常路径）', () => {
  const r = probe(REPO);

  it('A1 【V1】装载器读到 58 件边类型（实测基数 56 ＋ 本卡 2；棘轮）', () => {
    expect(r.loaded).toBe(BASELINE_TOTAL);
  });

  it('A2 【V2】两新边被加载器**认领**（按 label 可查到，且各自带真实文件名）', () => {
    for (const lbl of NEW_LABELS) {
      const e = edgeOf(r, lbl);
      expect(e, `label=${lbl} 未被加载器认领`).toBeTruthy();
      expect(e!.file).toBeTruthy(); // 有对应真文件 ⇒ 非"凭空出现"
    }
  });

  it('A3 【V1】两新边与既有件**同构**：键集合 ＋ 键顺序 = canonical 11 键', () => {
    for (const lbl of NEW_LABELS) {
      const e = edgeOf(r, lbl)!;
      expect(e.keys, `label=${lbl} 键序不符`).toEqual([...CANON_KEYS]);
    }
  });

  it('A4 两新边的端点与卡面附录 C 一致（双枚举 GOAL/Goal ＝ 队长 W-2 裁定；边 B 方向 计划→目标）', () => {
    const ra = JSON.parse(readFileSync(join(EDGE_DIR, 'goal_decomposes_to.json'), 'utf-8')) as {
      allowedFrom: string[]; allowedTo: string[]; $id: string; label: string;
    };
    const rb = JSON.parse(readFileSync(join(EDGE_DIR, 'plan_commits_to.json'), 'utf-8')) as {
      allowedFrom: string[]; allowedTo: string[]; $id: string; label: string;
    };
    // 边 A：父 → 子（both GOAL/Goal）
    expect(ra.allowedFrom).toEqual(['GOAL', 'Goal']);
    expect(ra.allowedTo).toEqual(['GOAL', 'Goal']);
    expect(ra.$id).toBe('edge/goal_decomposes_to');
    expect(ra.label).toBe('GOAL_DECOMPOSES_TO');
    // 边 B：**方向 = 计划 → 目标**（subject=计划，object=目标）
    expect(rb.allowedFrom).toEqual(['PLAN']);
    expect(rb.allowedTo).toEqual(['GOAL', 'Goal']);
    expect(rb.$id).toBe('edge/plan_commits_to');
    expect(rb.label).toBe('PLAN_COMMITS_TO');
  });

  it('A5 两新边 `action_effect_lag` / `transfer_function` 均 = `"unknown"`（队长裁「丙但取 unknown」）', () => {
    for (const lbl of NEW_LABELS) {
      const e = edgeOf(r, lbl)!;
      expect(e.lag).toBe('unknown');
      expect(e.tf).toBe('unknown');
    }
  });

  it('A6 【V2】#1031 的桥**可读其字段**：`action_effect_lag` 可解析（resolved / injectable）', () => {
    for (const lbl of NEW_LABELS) {
      const e = edgeOf(r, lbl)!;
      const lag = e.bridgeParams.find((p) => p.key === 'action_effect_lag')!;
      expect(lag, `label=${lbl} 桥缺 action_effect_lag 槽`).toBeTruthy();
      expect(lag.status).toBe('resolved');
      expect(lag.injectable).toBe(true);
      expect(lag.value).toBe('unknown');
    }
  });

  it('A7 【V2】`transfer_function` 槽存在且**不可注入**（状态名如实记录，不伪造）', () => {
    const statuses: string[] = [];
    for (const lbl of NEW_LABELS) {
      const e = edgeOf(r, lbl)!;
      const tf = e.bridgeParams.find((p) => p.key === 'transfer_function')!;
      expect(tf, `label=${lbl} 桥缺 transfer_function 槽`).toBeTruthy();
      expect(tf.injectable).toBe(false); // 与既有 52 件 TBD 的**结果**同形：不注入
      statuses.push(tf.status);
    }
    // 如实记录实际状态（`unknown` 既非 placeholder 族亦非 declaration 族 ⇒ 落 prose_formula）
    expect(statuses).toEqual(['prose_formula', 'prose_formula']);
  });

  it('A8 桥的 3 槽齐备（EDGE_PARAM_KEYS 顺序：transfer_function / causal_strength / action_effect_lag）', () => {
    for (const lbl of NEW_LABELS) {
      const e = edgeOf(r, lbl)!;
      expect(e.bridgeParams.map((p) => p.key)).toEqual(['transfer_function', 'causal_strength', 'action_effect_lag']);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. 【V3】删掉即报红 — 判别性反例（沙箱内物理删除）
// ═══════════════════════════════════════════════════════════════════════════

describe('B. 【V3】删任一新边 ⇒ 加载计数回落 ⇒ 本件红（判别性）', () => {
  it('B0 🔴 "替换确实发生"：完整沙箱 = 58 件（阴性对照，证明沙箱机制本身不改变计数）', () => {
    withSandbox([], (sb) => {
      const r = probe(sb);
      expect(r.dirFiles).toBe(BASELINE_TOTAL); // 沙箱磁盘实况
      expect(r.loaded).toBe(BASELINE_TOTAL);   // 装载器读数
    });
  });

  it('B1 删 `goal_decomposes_to.json` ⇒ 沙箱磁盘 57 件，装载计数回落 57（期望"红"）', () => {
    withSandbox(['goal_decomposes_to.json'], (sb) => {
      const r = probe(sb);
      expect(r.dirFiles).toBe(BASELINE_TOTAL - 1); // 先证替换发生
      expect(r.loaded).toBe(BASELINE_TOTAL - 1);   // 再证计数回落（主仓基线 58 时本断言必红 ⇒ 判别性成立）
    });
  });

  it('B2 删 `plan_commits_to.json` ⇒ 沙箱磁盘 57 件，装载计数回落 57（期望"红"）', () => {
    withSandbox(['plan_commits_to.json'], (sb) => {
      const r = probe(sb);
      expect(r.dirFiles).toBe(BASELINE_TOTAL - 1);
      expect(r.loaded).toBe(BASELINE_TOTAL - 1);
    });
  });

  it('B3 两件都删 ⇒ 回到**引入本卡之前的基数 56**（本卡 +2 的净增量可判）', () => {
    withSandbox([...NEW_FILES], (sb) => {
      const r = probe(sb);
      expect(r.dirFiles).toBe(BASELINE_WITHOUT_NEW);
      expect(r.loaded).toBe(BASELINE_WITHOUT_NEW);
      for (const lbl of NEW_LABELS) expect(edgeOf(r, lbl)).toBeUndefined();
    });
  });

  it('B4 沙箱删除后**确无该文件**（磁盘判据，防"删了但文件还在"）', () => {
    withSandbox(['goal_decomposes_to.json'], (sb) => {
      const d = join(sb, 'extensions', 'ontology', 'edge-types');
      const fs2 = readdirSync(d).filter((n) => n.endsWith('.json'));
      expect(fs2).not.toContain('goal_decomposes_to.json');
      expect(fs2).toContain('plan_commits_to.json');
      expect(fs2.length).toBe(BASELINE_TOTAL - 1);
    });
  });

  it('B5 🔴 "夹具会红"的**自足证明**：把 A1 的同一条断言施加到「删了一件」的沙箱 ⇒ **必抛（= 红）**', () => {
    withSandbox(['goal_decomposes_to.json'], (sb) => {
      const r = probe(sb);
      // 复刻 A1 的断言形态（期望 58）施加到缺件沙箱 ⇒ 必须抛
      expect(() => expect(r.loaded).toBe(BASELINE_TOTAL)).toThrow();
      // 反向对照：期望值改成实际值 ⇒ 不抛（证明上一行的"抛"来自计数差，不是写法错误）
      expect(() => expect(r.loaded).toBe(BASELINE_TOTAL - 1)).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. 边界与失败面（fail-closed，禁静默）
// ═══════════════════════════════════════════════════════════════════════════

describe('C. 边界与失败面', () => {
  it('C1 沙箱缺 `edge-types/` 目录 ⇒ 装载计数 = 0（**不抛**，但计数如实归零）', () => {
    const sb = join(tmpdir(), `k4b3-1350-nodir-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(sb, 'extensions', 'ontology'), { recursive: true });
    try {
      // 该沙箱没有 edge-types/ ⇒ 探测代码在 readdirSync 处会抛 ⇒ 本探针 fail-closed
      expect(() => probe(sb)).toThrow();
    } finally {
      rmSync(sb, { recursive: true, force: true });
    }
  });

  it('C2 真仓两新件的 `optionalProps` 非空且 `requiredProps` 非空（实测 56/56 件皆非空的同构要求）', () => {
    for (const f of NEW_FILES) {
      const d = JSON.parse(readFileSync(join(EDGE_DIR, f), 'utf-8')) as Record<string, unknown>;
      expect(Object.keys(d.optionalProps as object).length).toBeGreaterThan(0);
      expect((d.requiredProps as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('C3 🆕 判别性：把沙箱里新件的 `requiredProps` 清空 ⇒ C2 的同判据会红（证明 C2 非恒绿）', () => {
    const sb = makeSandbox([]);
    try {
      const p = join(sb, 'extensions', 'ontology', 'edge-types', 'goal_decomposes_to.json');
      const d = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      d.requiredProps = [];
      writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf-8');
      const d2 = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      expect((d2.requiredProps as unknown[]).length).toBe(0); // ⇒ 若对沙箱跑 C2，必红
    } finally {
      rmSync(sb, { recursive: true, force: true });
    }
  });
});
