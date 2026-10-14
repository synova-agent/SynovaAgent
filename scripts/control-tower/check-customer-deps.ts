#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/check-customer-deps.ts — **第二档·端口级摘除演练器**（CTO 裁定 086）
 *
 * @why 图纸说「包能独立交付」；第一档只证**类型层**。第二档问的是**交付期真值**：
 *      「**客户只装一半**，Y 的 min 判据会不会红」——**该红的必须红**，绿了就是假声明。
 *
 * 🔴 CTO 086 四条裁定，本件逐条落实（**这是本件存在的全部理由**）：
 *   ① **替代锚**：步骤 0 的 0a 用 **项级** 锚 `extensions/ontology/edge-types/*.json`
 *      ＋ 判据 `check-ontology-fields.sh`（**已实测 0a 红 / 0b 绿**）；
 *      ❌ **不用** 派单件字面锚 `3-8→3-5`（**实测该红不红**：`probe-sentinel` 自带合成图，
 *        不读本体层内容目录 ⇒ 与 3-5 写集零耦合）。
 *   ② **项级锚，不用块级**：块级 `paths` 有 **43 对字面包含**（实测）⇒ 摘 X 必然连带摘掉 Y 自己
 *      ⇒ 块级摘除的"红"不指向依赖。本件锚一律从 **item 级 `paths`** 派生。
 *   ③ **不造 MockHost**：宿主 = **隔离宿主树**（`exile-tree.sh`）＋ **既有装配面/判据**；
 *      ❌ 不新造 `provides` / `capabilities.min` / `capability.yaml` / `host.adapter`（全仓 0 命中，
 *        造 = 造产品语义）。
 *   ④ **两态守门**：`锚为空` ⇒ 判不了；`锚与 Y 纠缠` ⇒ 判不了；`判据基线不绿` ⇒ 判不了。
 *
 * @契约（铁律 47）
 *   @input   `--tree <dir>`（**已 create 的隔离宿主树**）｜ `--candidates <json>`（候选值表，
 *            缺省 = 同目录 `customer-deps-candidates.json`）｜ `--source <登记件>`（可选）
 *            `--phase <step0|scan|run|all>`（缺省 all）｜ `--only <Y>`（限定某个包）｜
 *            `--timeout <秒>`（每条 min 命令超时，缺省 300）｜ `--out <file>`
 *   @output  stdout：逐段人类可读 ＋ 末行 SUMMARY；stderr：诊断；`--out` 另落机器可读 JSON
 *   @exit    🔴 **三态（D328）**：
 *              0 = 全部可判且**无假声明**
 *              1 = 真红（**有假声明** / 有"判不了"行 / 步骤 0 不过 —— 逐条点名）
 *              2 = **判不了**（步骤 0 **演练器判废** / 环境失败 / 真源读不到 / 树不存在）
 *   @degraded — 无独立降级路径：一切异常归 exit 2 ＋ stderr 点名原始异常
 *
 * 🔴 **演练器判废条款（派单件停止条件①，原样保留）**：
 *   步骤 0 不过（0a 该红不红 / 0b 该绿不绿）⇒ **本件 exit 2**，并把**原始输出**打出来；
 *   此时**第二档的一切输出作废**，不许拿它下任何结论。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_MISMATCH, EXIT_OK, EXIT_UNJUDGEABLE } from './block-paths-core.ts';
import { blockPathsOf, hasEntanglement, pathMatcher } from './probe-exile-compile.ts';
import { loadRegistryView, resolveSourceArg } from './gen-block-paths.ts';
import { QUARANTINE, applyExile, expandAll, restoreTree } from './exile-tree-core.ts';

/** 判定字面量（🔴 具名常量） */
export const V_RED = '红·依赖成立';
export const V_GREEN = '绿·假声明（打回）';
export const V_UNK = '判不了';
export const V_STEP0_OK = '通过';
export const V_STEP0_FAIL = '不过';

/** 判不了的原因（**必须点名**） */
export const R_NO_ITEM_EDGE = '候选值在项级 dependsOn 图上无对应边（无真源支撑）';
export const R_ANCHOR_EMPTY = '项级锚为空';
export const R_ENTANGLED = '锚与 Y 的项级 paths 字面包含（摘 X 会连带摘 Y）';
export const R_MIN_BASELINE_RED = 'Y 的 min 判据在**全量树**上就不绿 ⇒ 判据基线不绿，不可作依赖判据';
export const R_NO_MIN = 'Y 在真源里没有可跑的 min 判据（blockAcceptance 空）';
export const R_MIN_NOT_SENSITIVE = 'Y 的 min 判据**不在摘除面上**（自摘 Y 自己的项级写集后判据仍绿）⇒ 它测不出依赖，绿不算数';
export const R_SCREEN_EMPTY = '灵敏度筛选面为空（Y 的项级写集减去判据自身文件后一条不剩）';

/** 真源里"验收步"的形状（宽松声明：只取本件用得到的） */
export interface AcceptanceStepLike {
  run: string;
  expectExit?: number;
  expectStdoutContains?: string;
  expectRowsGt?: { table: string; n: number };
  expectRowsEq?: { table: string; n: number };
}

/** 真源 item 的扩展视图（比 `RegistryItemLike` 多几个字段，**全部可选** ⇒ 直接 `as` 合法） */
export interface ItemLike {
  id: string;
  block?: string;
  paths?: readonly string[];
  dependsOn?: readonly string[];
  acceptance?: readonly AcceptanceStepLike[];
  /** 真源：本项若建表，列出表名（步 4「表」残留类用） */
  createsTable?: { name?: string };
}

/** 真源 block 的扩展视图 */
export interface BlockLike {
  id: string;
  items: readonly string[];
  paths?: readonly string[];
  blockAcceptance?: readonly AcceptanceStepLike[];
}

/** 步骤 0 的一条结果 */
export interface Step0Row {
  name: string;
  /** 0a = 摘锚（必红）｜ 0b = 全量（必绿） */
  expect: 'red' | 'green';
  command: string;
  rc: number | null;
  ok: boolean;
  stdoutTail: string;
}

/** 静态可判性扫描的一行 */
export interface ScanRow {
  pkg: string;
  missing: string;
  /** 项级支撑：`Y.dependsOn` 里出现过的 X 的 item id */
  itemEdges: string[];
  /** 派生出的项级锚（字面量） */
  anchor: readonly string[];
  verdict: string;
  reason: string;
  /** 声明里的 unavailable（**占位**，仅供打回时对照） */
  declaredUnavailable: readonly string[];
}

/** 真跑的一行 */
export interface RunRow {
  pkg: string;
  missing: string;
  anchor: readonly string[];
  minCommand: string;
  baselineOk: boolean;
  baselineRc: number | null;
  afterRc: number | null;
  afterPass: boolean;
  verdict: string;
  note: string;
}

/** 一次完整跑的产物 */
export interface DrillReport {
  tree: string;
  candidates: string;
  step0: Step0Row[];
  scan: ScanRow[];
  /** 摘除灵敏度筛选（设计件 §3.2）：逐包"自摘 Y 的项级写集 ⇒ 判据必红" */
  sensitivity: RunRow[];
  runs: RunRow[];
  /** 🔴 步 4 · 可卸载性（--phase uninstall）：逐包 × 七类残留 */
  uninstall: UninstallPkgResult[];
  /** 🔴 裁定 097 · 还原率（--phase restore-rate） */
  restore: RestoreRow[];
  baselineGreenRuns: string[];
  baselineRedRuns: string[];
  notes: string[];
}

/** 读 `--flag value` */
function readFlag(argv: readonly string[], flag: string): string {
  const i = argv.indexOf(flag);
  return i < 0 ? '' : (argv[i + 1] ?? '');
}

/** 跑一条 shell（cwd = 隔离宿主树；**不捕获即弃**，一律留痕） */
export function runShell(cwd: string, command: string, timeoutSec: number): { rc: number | null; out: string } {
  const r = spawnSync('/bin/bash', ['-c', command], {
    cwd,
    timeout: timeoutSec * 1000,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { rc: r.status, out };
}

/**
 * 按真源自己的期望判一条验收步是"过"还是"不过"。
 *
 * @why 真源的 `acceptance` 自带 expectExit / expectStdoutContains / expectRowsGt / expectRowsEq
 *      —— 「怎么算完」的语义**在真源里**，本件**照它判**（禁另造一套）。
 * @contract
 *   @input  step｜rc｜out
 *   @output true = 该步判过
 *   @degraded 超时（rc === null）⇒ 判不过（fail-closed）
 */
export function stepPassed(step: AcceptanceStepLike, rc: number | null, out: string): boolean {
  if (rc === null) return false;
  if (step.expectExit !== undefined) return rc === step.expectExit;
  if (step.expectStdoutContains !== undefined) return out.includes(step.expectStdoutContains);
  if (step.expectRowsGt !== undefined) {
    const n = Number.parseInt(out.trim().split(/\s+/)[0] ?? '', 10);
    return Number.isFinite(n) && n > step.expectRowsGt.n;
  }
  if (step.expectRowsEq !== undefined) {
    const n = Number.parseInt(out.trim().split(/\s+/)[0] ?? '', 10);
    return Number.isFinite(n) && n === step.expectRowsEq.n;
  }
  return rc === 0;
}

/** 收集 Y 的 min 判据（块级 `blockAcceptance` 优先；无则用其 items 的 `acceptance`） */
export function minStepsOf(
  blockId: string,
  items: readonly ItemLike[],
  blocks: readonly BlockLike[],
): AcceptanceStepLike[] {
  const b = blocks.find((x) => x.id === blockId);
  const fromBlock = b?.blockAcceptance ?? [];
  if (fromBlock.length > 0) return [...fromBlock];
  const out: AcceptanceStepLike[] = [];
  for (const it of items) if (it.block === blockId) out.push(...(it.acceptance ?? []));
  return out;
}

/**
 * 从判据命令串里抽出"**它自己要用的**仓内路径"（用于灵敏度筛选时**不摘它**）。
 *
 * @why 灵敏度筛选要问"判据读不读 Y 的写集"；若把判据自己的脚本/测试文件也摘了，
 *      "自摘必红"就变成**同义反复**（文件没了当然跑不了）⇒ 必须先把它们排除。
 * @contract
 *   @input  command（真源里的 run 串）｜tree（宿主树绝对路径）
 *   @output 树里**实际存在**的仓根相对路径（最多 8 条，供排除用）
 *   @degraded 不适用（抽不到就返回空数组 —— 那只是"不排除任何东西"，由筛选结果自己说话）
 */
export function commandOwnPaths(command: string, tree: string): string[] {
  const out: string[] = [];
  for (const raw of command.split(/[\s"'`|();&<>]+/)) {
    const t = raw.replace(/^\.\//, '');
    if (t === '' || !t.includes('/')) continue;
    if (t.startsWith('-')) continue;
    if (!existsSync(join(tree, t))) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * **摘除灵敏度筛选**（设计件 §3.2；防"永远绿"）。
 *
 * @why 第二档判据是「摘 X ⇒ Y 的 min 必红」。若 Y 的 min 判据**根本不读**被摘的东西，
 *      它**永远绿**——那时"绿"既不能证明"无依赖"，也不能证明"假声明"，只能判"判不了"。
 *      筛选法：**摘 Y 自己的项级写集**（减去判据自身文件）⇒ 判据**必须红**；
 *      仍绿 ⇒ 该判据不在摘除面上。
 * @contract
 *   @input  tree｜pkg｜items｜blocks｜timeoutSec
 *   @output `{sensitive, reason, rows}`；`rows` 供结果件贴原始输出
 *   @degraded 判不了是**结果**（带原因），不是异常
 */
export function sensitivityScreen(
  tree: string,
  pkg: string,
  items: readonly ItemLike[],
  blocks: readonly BlockLike[],
  timeoutSec: number,
): { sensitive: boolean; reason: string; rows: RunRow[] } {
  const rows: RunRow[] = [];
  const pkgPaths = items.filter((i) => i.block === pkg).flatMap((i) => [...(i.paths ?? [])]);
  if (pkgPaths.length === 0) return { sensitive: false, reason: R_ANCHOR_EMPTY, rows };
  const steps = minStepsOf(pkg, items, blocks);
  if (steps.length === 0) return { sensitive: false, reason: R_NO_MIN, rows };
  let anyRed = false;
  for (const step of steps) {
    restoreTree(tree);
    const own = commandOwnPaths(step.run, tree);
    const expanded = expandAll(tree, pkgPaths).rels.filter(
      (rel) => !own.some((o) => rel === o || rel.startsWith(o + '/') || o.startsWith(rel + '/')),
    );
    if (expanded.length === 0) {
      rows.push({ pkg, missing: '(自摘)', anchor: pkgPaths, minCommand: step.run, baselineOk: false, baselineRc: null, afterRc: null, afterPass: true, verdict: V_UNK, note: R_SCREEN_EMPTY });
      continue;
    }
    const moved = applyExile(tree, expanded);
    const after = moved === 0 ? { rc: null, out: '摘除面为空（moved=0）' } : runShell(tree, step.run, timeoutSec);
    const afterPass = moved === 0 ? false : stepPassed(step, after.rc, after.out);
    restoreTree(tree);
    if (!afterPass) anyRed = true;
    rows.push({
      pkg, missing: '(自摘)', anchor: expanded, minCommand: step.run,
      baselineOk: true, baselineRc: null, afterRc: after.rc, afterPass,
      verdict: afterPass ? V_UNK : V_RED,
      note: afterPass ? R_MIN_NOT_SENSITIVE : '',
    });
  }
  if (anyRed) return { sensitive: true, reason: '', rows };
  return { sensitive: false, reason: R_MIN_NOT_SENSITIVE, rows };
}

/** 步骤 0 的锚（🔴 CTO 086 裁定的替代锚：**项级** edge-types 字面量） */
export const STEP0_ANCHOR: readonly string[] = ['extensions/ontology/edge-types/*.json'];
/** 步骤 0 的判据（K4 块级 blockAcceptance 的原文） */
export const STEP0_MIN = 'bash scripts/control-tower/check-ontology-fields.sh';

/**
 * 步骤 0（**演练器自检**：先证"这台演练器本身靠不靠得住"）。
 *
 * @contract
 *   @input  tree｜timeoutSec
 *   @output `Step0Row[]`（0a / 0b 两条）
 *   @degraded 不适用（"不过"是**结果**，由调用方转 exit 2 —— 演练器判废）
 */
export function runStep0(tree: string, timeoutSec: number): Step0Row[] {
  const rows: Step0Row[] = [];
  // 0a：摘锚 ⇒ 判据必红
  const restoreFirst = restoreTree(tree);
  if (restoreFirst.dangling.length > 0) throw new Error('隔离区残留，无法开始步骤 0');
  const ex = expandAll(tree, STEP0_ANCHOR);
  const moved = applyExile(tree, ex.rels);
  if (moved === 0) throw new Error(`步骤 0a 摘除面为空（锚=${STEP0_ANCHOR.join(', ')} 在树里一条都匹配不到）`);
  const a = runShell(tree, STEP0_MIN, timeoutSec);
  rows.push({
    name: '0a 摘锚（必红）',
    expect: 'red',
    command: `摘 ${ex.rels.length} 条 ⇒ ${STEP0_MIN}`,
    rc: a.rc,
    ok: a.rc !== null && a.rc !== 0,
    stdoutTail: a.out.trim().split('\n').slice(-3).join('\n'),
  });
  const rs = restoreTree(tree);
  if (rs.dangling.length > 0) throw new Error('步骤 0a 还原后隔离区仍有残留');
  // 0b：全量 ⇒ 判据必绿
  const b = runShell(tree, STEP0_MIN, timeoutSec);
  rows.push({
    name: '0b 全量（必绿）',
    expect: 'green',
    command: `全量 ⇒ ${STEP0_MIN}`,
    rc: b.rc,
    ok: b.rc === 0,
    stdoutTail: b.out.trim().split('\n').slice(-3).join('\n'),
  });
  return rows;
}

/**
 * 扫描：每条候选声明**能不能判**（**静态可判性**，不跑命令）。
 *
 * @contract
 *   @input  items｜blocks｜declarations
 *   @output `ScanRow[]`
 *   @degraded 判不了是**结果**（带原因），不是异常
 */
export function scanDeclarations(
  items: readonly ItemLike[],
  blocks: readonly BlockLike[],
  declarations: readonly { pkg: string; missing: string; unavailable: readonly string[] }[],
): ScanRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: ScanRow[] = [];
  for (const d of declarations) {
    if (d.missing === '') {
      out.push({ pkg: d.pkg, missing: '(无)', itemEdges: [], anchor: [], verdict: '不适用', reason: '该包声明为空（enabler / 无依赖）', declaredUnavailable: d.unavailable });
      continue;
    }
    const yItems = items.filter((i) => i.block === d.pkg);
    const xItems = items.filter((i) => i.block === d.missing);
    const itemEdges: string[] = [];
    for (const y of yItems) {
      for (const dep of y.dependsOn ?? []) {
        const dx = byId.get(dep);
        if (dx !== undefined && dx.block === d.missing) itemEdges.push(dep);
      }
    }
    if (itemEdges.length === 0) {
      out.push({ pkg: d.pkg, missing: d.missing, itemEdges: [], anchor: [], verdict: V_UNK, reason: R_NO_ITEM_EDGE, declaredUnavailable: d.unavailable });
      continue;
    }
    const anchorSet = new Set<string>();
    for (const id of itemEdges) for (const p of byId.get(id)?.paths ?? []) anchorSet.add(p);
    const anchor = [...anchorSet].sort();
    if (anchor.length === 0) {
      out.push({ pkg: d.pkg, missing: d.missing, itemEdges, anchor, verdict: V_UNK, reason: R_ANCHOR_EMPTY, declaredUnavailable: d.unavailable });
      continue;
    }
    const yPaths = yItems.flatMap((i) => [...(i.paths ?? [])]);
    if (hasEntanglement(anchor, yPaths)) {
      out.push({ pkg: d.pkg, missing: d.missing, itemEdges, anchor, verdict: V_UNK, reason: R_ENTANGLED, declaredUnavailable: d.unavailable });
      continue;
    }
    const steps = minStepsOf(d.pkg, items, blocks);
    if (steps.length === 0) {
      out.push({ pkg: d.pkg, missing: d.missing, itemEdges, anchor, verdict: V_UNK, reason: R_NO_MIN, declaredUnavailable: d.unavailable });
      continue;
    }
    out.push({ pkg: d.pkg, missing: d.missing, itemEdges, anchor, verdict: '可判（待真跑）', reason: '', declaredUnavailable: d.unavailable });
  }
  return out;
}

/**
 * 真跑：摘锚 ⇒ 跑 Y 的 min（**先证判据基线绿**，否则判不了）。
 *
 * @contract
 *   @input  tree｜items｜blocks｜declaration｜timeoutSec
 *   @output `RunRow`
 *   @degraded 不适用（"判不了"是结果）
 */
export function runDeclaration(
  tree: string,
  items: readonly ItemLike[],
  blocks: readonly BlockLike[],
  d: { pkg: string; missing: string; unavailable: readonly string[] },
  anchor: readonly string[],
  timeoutSec: number,
): RunRow[] {
  const steps = minStepsOf(d.pkg, items, blocks);
  const rows: RunRow[] = [];
  restoreTree(tree);
  // ① 基线：不摘任何东西 ⇒ 判据必须绿（否则判据本身不绿 ⇒ 判不了）
  for (const step of steps) {
    const base = runShell(tree, step.run, timeoutSec);
    const baseOk = stepPassed(step, base.rc, base.out);
    if (!baseOk) {
      rows.push({
        pkg: d.pkg, missing: d.missing, anchor, minCommand: step.run,
        baselineOk: false, baselineRc: base.rc, afterRc: null, afterPass: false,
        verdict: V_UNK, note: `${R_MIN_BASELINE_RED}；原始输出末行：${base.out.trim().split('\n').slice(-1)[0] ?? ''}`,
      });
      continue;
    }
    // ② 摘锚 ⇒ 跑
    const ex = expandAll(tree, anchor);
    const moved = applyExile(tree, ex.rels);
    const after = moved === 0 ? { rc: null, out: '摘除面为空（moved=0）' } : runShell(tree, step.run, timeoutSec);
    const afterPass = moved === 0 ? false : stepPassed(step, after.rc, after.out);
    restoreTree(tree);
    rows.push({
      pkg: d.pkg, missing: d.missing, anchor, minCommand: step.run,
      baselineOk: true, baselineRc: base.rc, afterRc: after.rc, afterPass,
      verdict: afterPass ? V_GREEN : V_RED,
      note: moved === 0 ? '摘除面为空 ⇒ 该条无效' : '',
    });
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **步 4 · 可卸载性真值实测**（CTO 裁定 074 步 4）—— **--phase uninstall**
 *
 * 与步 2/3 的分别（**两件事，别混**）：
 *   · 步 2/3 判「**缺了 X，Y 还能不能跑**」= **功能**（依赖判定）
 *   · 步 4 判「**把 X 拿掉之后，"残留"是什么**」= **痕迹**（清理彻底性）
 *
 * 🔴 **复用而非重建**（派单件 §二）：隔离树走 `exile-tree-core.ts`（applyExile / restoreTree / expandAll），
 *    卸除面走 `blockPathsOf()`（块级 paths = 该块 items 的 paths 并集，**已被对账门禁验过**）。
 *    本段**不新造第二套摘除/隔离逻辑**。
 *
 * 七类残留（派单件 §三 原表）与各自的**可跑判据**：
 *   ① 目录  卸完再展开一次 ⇒ 零命中 ＋ 无空目录残留
 *   ② 配置  剩余 extensions/ 下各级 manifest.json 里还有没有 X 的落点 ⇒ 零命中
 *           （🔴 铁律 45：本行**不写字面量** —— `*` 与 `/` 相邻会把块注释提前终结；
 *             实测 esbuild 报 `Expected ";" but found "里还有没有"`，报错点在此行）
 *   ③ 表    真源 createsTable 的表在库里还在不在 ⇒ 已删（**或已声明"数据保留"**）
 *   ④ 索引  content-registry.ts ＋ extensions/** 里指向"已移除落点"的悬空条目 ⇒ 零命中
 *   ⑤ 引用  grep -rnw "X 的 id" src/ extensions/ scripts/ ⇒ 零命中（**除历史留痕**）
 *   ⑥ 缓存  X 相关的构建/派生缓存 ⇒ 全不存在
 *   ⑦ 登记  施工项账仍列 X 的 items / _extinct/ 归档 ⇒ 状态与声明一致
 *
 * 🔴 三态（沿用）：干净 ／ 不干净（逐条列）／ 判不了（说明为什么）。
 *    **"判不了"不许并进"干净"**；**声明保留**必须点名**哪条 ＋ 依据哪份文件**。
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 残留类（七类，派单件 §三 原表；禁改名 —— 回执矩阵按它对齐） */
export const RESIDUAL_CLASSES = ['目录', '配置', '表', '索引', '引用', '缓存', '登记'] as const;
export type ResidualClass = (typeof RESIDUAL_CLASSES)[number];

/** 判定（三态 ＋ 两个非"-"态） */
export const U_CLEAN = '干净';
export const U_DIRTY = '不干净';
export const U_UNK = '判不了';
export const U_DECLARED = '声明保留';
export const U_NA = '不适用';

/**
 * 一条"声明保留"的**依据**（🔴 必须点名到文件:行 —— 派单件 §四）。
 * 没有依据的保留**不算保留**，一律判"不干净"。
 */
export interface RetentionBasis {
  what: string;
  basis: string;
}

/** 🔴 已知的"声明保留"依据（逐条点名文件:行；新增必须同时给出处） */
export const RETENTION_BASES: readonly RetentionBasis[] = [
  {
    what: '登记面（施工项账在卸载后仍在册）',
    basis: 'docs/synova/coordination/施工项登记.ts:41 「本件是**施工项账**，不是卡账」',
  },
  {
    what: '_extinct/ 归档件（卸载 = 移入归档，不是删）',
    basis: 'AGENTS.md §5.1 「内容包……卸 = 移 _extinct/ ＋ 重扫」',
  },
];

/** 一步外部命令的结果（本段只用它拼"可跑判据"与证据） */
export interface CmdEvidence {
  command: string;
  rc: number | null;
  /** 命中行（最多留 cap 条，够回执用） */
  hits: string[];
  count: number;
}

/**
 * 跑一条 grep（**判据就是这条命令**；回执要贴它）。
 *
 * @contract
 *   @input  tree｜args（grep 参数数组，**不含** grep 本身）｜cap（最多留多少行）
 *   @output `{command, rc, hits, count}`；`count` = 命中行数
 *   @degraded grep 无命中 ⇒ rc=1、count=0（**正常默认**，不是异常）；
 *             rc>=2 ⇒ 环境/用法错误 ⇒ 由调用方按"判不了"处理（签名里保留 rc 供调用方判）
 */
export function runGrep(tree: string, args: readonly string[], cap = 40): CmdEvidence {
  const r = spawnSync('grep', [...args], { cwd: tree, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const out = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  return {
    command: 'grep ' + args.map((a) => (a.includes(' ') || a === '' ? "'" + a + "'" : a)).join(' '),
    rc: r.status,
    hits: out.slice(0, cap),
    count: out.length,
  };
}

/** 某一类的一行结果 */
export interface UninstallRow {
  pkg: string;
  cls: ResidualClass;
  verdict: string;
  /** 残留条数（0 = 干净；判不了/不适用 时为 -1） */
  residual: number;
  /** 可跑判据（回执直接贴这行） */
  command: string;
  /** 逐条证据（原始输出片段） */
  evidence: string[];
  /** 声明保留时的依据（文件:行）；其余为空串 */
  declaredBy: string;
}

/** 某包卸除的整段结果 */
export interface UninstallPkgResult {
  pkg: string;
  /** 卸除面展开后的顶层条目数 */
  removedCount: number;
  /** 🔴 与他包共用的条目数（写集重叠 ⇒ "卸 X 会误伤他包"的第一类证据） */
  sharedWithOthers: number;
  rows: UninstallRow[];
}

/** 把一组顶层条目里"别的块也声明了"的挑出来（写集重叠） */
export function sharedTopEntries(byBlock: Record<string, string[]>, pkg: string): string[] {
  const mine = byBlock[pkg] ?? [];
  const others = new Set<string>();
  for (const [k, v] of Object.entries(byBlock)) {
    if (k === pkg) continue;
    for (const p of v) others.add(p);
  }
  return mine.filter((p) => others.has(p)).sort();
}

/** X 的 id 标记（块 id ＋ 该项 id；供"引用"类 grep） */
export function markersOf(pkg: string, items: readonly ItemLike[]): string[] {
  const ids = items.filter((i) => i.block === pkg).map((i) => i.id);
  return [pkg, ...ids];
}

/**
 * 把 id 分成**强标记**与**弱标记**（🔴 防"数字 id 命中正文"的假阳性）。
 *
 * @why 实测（2026-10-13）：弱标记 `2-4` 会在**正文**里命中 ——
 *      `src/l3/pkb-seed.ts:169` 的 `每季度 3-5 个 O,每个 O 配 2-4 个 KR` 被算成"K2 的引用残留"。
 *      那是**假阳性**：它会把一个干净的包判成"不干净"。⇒ 必须分强弱：
 *        · **强标记** = 含字母（如 `K12-01` / `RB-01` / `B2-GRAPH` / `D48`）⇒ 词边界即可（`grep -w`）；
 *        · **弱标记** = 纯数字短 id（如 `2-4` / `3-8`）⇒ **只认被引号/反引号包住的形态**
 *          （`'3-8'` / `"3-5"` / \`3-6\` —— 代码里引用 id 的常态），不认裸出现。
 * @contract
 *   @input  markers（`markersOf` 的产物）
 *   @output `{strong, weak}`
 *   @degraded 不适用（纯分类）
 */
export function splitMarkers(pkg: string, markers: readonly string[]): { strong: string[]; weak: string[] } {
  const strong: string[] = [];
  const weak: string[] = [];
  for (const m of markers) {
    // 🔴 **块 id 一律算弱标记**（实测 2026-10-13）：本仓里 `K3` **同时是审计角色名**
    //    （"K3 独立审计" / "K3 P0 事故"），裸 `grep -w K3` 在 K3 包上命中 **269 行**，
    //    绝大多数是**审计角色**不是**包引用** ⇒ 不弱化就会把一个包判成"重度不干净"（假红）。
    //    ⇒ 块 id 只认**被引号/反引号包住**的形态（代码里引用包 id 的常态）。
    if (m === pkg || !/[A-Za-z]/.test(m)) weak.push(m);
    else strong.push(m);
  }
  return { strong, weak };
}

/** X 建的表（真源 createsTable.name） */
export function tablesOf(pkg: string, items: readonly ItemLike[]): string[] {
  const out = new Set<string>();
  for (const it of items) {
    if (it.block !== pkg) continue;
    const t = it.createsTable;
    if (t !== undefined && typeof t.name === 'string' && t.name !== '') out.add(t.name);
  }
  return [...out].sort();
}

/** 把 grep 命中行按文件聚合，取前 3 个（`path:count`）—— 供回执判"是新残留还是历史冻结名单" */
export function topPathsLabel(hits: readonly string[], top = 3): string {
  const m = new Map<string, number>();
  for (const h of hits) {
    const f = h.split(':')[0] ?? h;
    m.set(f, (m.get(f) ?? 0) + 1);
  }
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return sorted.slice(0, top).map(([f, n]) => f + '×' + n).join(' , ') + (sorted.length > top ? ' …（共 ' + sorted.length + ' 个文件）' : '');
}

/** 隔离树里 _extinct/ 的条目 */
export function extinctEntries(tree: string): string[] {
  const base = join(tree, 'extensions', 'sentinels', '_extinct');
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base).sort();
  } catch (err) {
    // ENOENT/权限：不抛（该目录不存在 = 无归档，是正常默认）；真异常由回执的"登记"行点名条目数暴露
    void (err instanceof Error ? err.code : undefined);
    return [];
  }
}

/**
 * **卸一个包**（只在隔离树里）—— 步 4 的主算法。
 *
 * @contract
 *   @input  tree｜items｜byBlock（块级 paths 视图）｜pkg｜dbPath（树内 sqlite 路径）
 *   @output `UninstallPkgResult`（七类各一行）
 *   @degraded 不适用（"判不了"/"不干净"是**结果**，不是异常）
 *
 * 🔴 进出都 `restoreTree`：**卸完必须还原**（派单件 §六"不真删"）。
 */
export function runUninstall(
  tree: string,
  items: readonly ItemLike[],
  byBlock: Record<string, string[]>,
  pkg: string,
  dbPath: string,
): UninstallPkgResult {
  const rows: UninstallRow[] = [];
  restoreTree(tree);

  const pathsX = byBlock[pkg] ?? [];
  const expanded = expandAll(tree, pathsX);
  const removed = expanded.rels;
  const shared = sharedTopEntries(byBlock, pkg);
  const moved = applyExile(tree, removed);

  // ① 目录：卸完再展开一次（必须零命中）＋ 扫"移除后留下的空目录"
  const after = expandAll(tree, pathsX);
  const emptyDirs: string[] = [];
  const parents = new Set(removed.map((r) => (r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '.')));
  for (const p of parents) {
    const abs = p === '.' ? tree : join(tree, p);
    if (!existsSync(abs)) continue;
    try {
      if (readdirSync(abs).length === 0) emptyDirs.push(p);
    } catch (err) {
      // ENOENT/权限：不抛。空目录扫描是**加分项**，缺它不影响本行判定（判定只看 after 命中数）
      void (err instanceof Error ? err.code : undefined);
    }
  }
  rows.push({
    pkg,
    cls: '目录',
    verdict: after.rels.length === 0 && emptyDirs.length === 0 ? U_CLEAN : U_DIRTY,
    residual: after.rels.length + emptyDirs.length,
    command: 'ls -d ' + pathsX.slice(0, 3).join(' ') + (pathsX.length > 3 ? ' …' : '') + '   # 卸后应全不存在',
    evidence: [
      '卸除面展开 ' + removed.length + ' 条（applyExile moved=' + moved + '）',
      '卸后仍能匹配：' + after.rels.length + ' 条' + (after.rels.length > 0 ? ' ⇒ ' + after.rels.slice(0, 5).join(', ') : ''),
      '空目录残留：' + emptyDirs.length + ' 个' + (emptyDirs.length > 0 ? ' ⇒ ' + emptyDirs.slice(0, 5).join(', ') : ''),
      '🔴 与他包共用条目：' + shared.length + ' 条' + (shared.length > 0 ? ' ⇒ ' + shared.slice(0, 6).join(' , ') : '') + '（卸 X 会连带移除他包的东西）',
    ],
    declaredBy: '',
  });

  // ② 配置：剩余 extensions/ 下各级 manifest.json 里还有没有 X 的落点（铁律 45：注释内不写 `*` 紧邻 `/`）
  const cfgPatterns = removed.filter((r) => r.startsWith('extensions/'));
  const cfg = cfgPatterns.length === 0
    ? { command: '(无 extensions/ 落点 ⇒ 不适用)', rc: 0, hits: [], count: 0 }
    : runGrep(tree, ['-rnF', '-f', writePatterns(pkg, 'cfg', cfgPatterns), '--include=manifest.json', 'extensions/']);
  rows.push({
    pkg,
    cls: '配置',
    verdict: cfgPatterns.length === 0 ? U_NA : cfg.count === 0 ? U_CLEAN : U_DIRTY,
    residual: cfgPatterns.length === 0 ? -1 : cfg.count,
    command: cfg.command,
    evidence: cfgPatterns.length === 0
      ? ['X 在 extensions/ 下无落点 ⇒ 不涉内容面配置（**不适用**，不是干净）']
      : ['X 在 extensions/ 下落点 ' + cfgPatterns.length + ' 条', 'manifest.json 命中 ' + cfg.count + ' 行', ...cfg.hits.slice(0, 6)],
    declaredBy: '',
  });

  // ③ 表：真源 createsTable 的表在库里还在不在
  const tables = tablesOf(pkg, items);
  let tableHits: string[] = [];
  let tableCmd = 'sqlite3 <db> "SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (…)"';
  if (tables.length > 0 && existsSync(dbPath)) {
    const inList = tables.map((t) => "'" + t + "'").join(',');
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name IN (" + inList + ")";
    tableCmd = 'sqlite3 <树内 db> "' + sql + '"';
    const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
    tableHits = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  }
  rows.push({
    pkg,
    cls: '表',
    verdict: tables.length === 0 ? U_NA : !existsSync(dbPath) ? U_UNK : tableHits.length === 0 ? U_CLEAN : U_DIRTY,
    residual: tables.length === 0 || !existsSync(dbPath) ? -1 : tableHits.length,
    command: tableCmd,
    evidence: tables.length === 0
      ? ['真源里该块无 createsTable ⇒ 不涉数据面（不适用）']
      : !existsSync(dbPath)
        ? ['隔离树内无 sqlite 库 ⇒ **判不了**（与"干净"不同）']
        : ['真源声明该块建表 ' + tables.length + ' 张：' + tables.join(', '), '卸后库里仍在：' + tableHits.length + ' 张' + (tableHits.length > 0 ? ' ⇒ ' + tableHits.join(', ') : '')],
    declaredBy: '',
  });

  // ④ 索引：剩余注册表里指向"已移除落点"的悬空条目
  const idxPatterns = removed.filter((r) => r.startsWith('extensions/') || r.startsWith('src/'));
  const idxTargets = ['src/deploy/content-registry.ts'];
  if (existsSync(join(tree, 'extensions'))) idxTargets.push('extensions/');
  const idx = idxPatterns.length === 0
    ? { command: '(无 src/ 或 extensions/ 落点 ⇒ 不适用)', rc: 0, hits: [], count: 0 }
    : runGrep(tree, ['-rnF', '-f', writePatterns(pkg, 'idx', idxPatterns), ...idxTargets]);
  rows.push({
    pkg,
    cls: '索引',
    verdict: idxPatterns.length === 0 ? U_NA : idx.count === 0 ? U_CLEAN : U_DIRTY,
    residual: idxPatterns.length === 0 ? -1 : idx.count,
    command: idx.command,
    evidence: idxPatterns.length === 0
      ? ['该块无 src/ 或 extensions/ 落点 ⇒ 无注册表可悬空（不适用）']
      : ['检查面：src/deploy/content-registry.ts ＋ extensions/**', '悬空/残留命中 ' + idx.count + ' 行', ...idx.hits.slice(0, 8)],
    declaredBy: '',
  });

  // ⑤ 引用：grep X 的 id（块 id ＋ 项 id）；_extinct/ 单列"历史留痕"
  //    🔴 强弱分开跑（防数字 id 命中正文的假阳性 —— 见 splitMarkers 的 @why）
  const markers = markersOf(pkg, items);
  const { strong, weak } = splitMarkers(pkg, markers);
  const refStrong = strong.length === 0
    ? { command: '(无强标记)', rc: 1, hits: [], count: 0 }
    : runGrep(tree, ['-rnwE', '-e', strong.join('|'), 'src/', 'extensions/', 'scripts/'], 200);
  const weakRe = weak.length === 0 ? '' : "['\"\u0060](" + weak.join('|') + ")['\"\u0060]";
  const refWeak = weak.length === 0
    ? { command: '(无弱标记)', rc: 1, hits: [], count: 0 }
    : runGrep(tree, ['-rnE', '-e', weakRe, 'src/', 'extensions/', 'scripts/'], 200);
  const allHits = [...refStrong.hits, ...refWeak.hits];
  const allCount = refStrong.count + refWeak.count;
  const historical = allHits.filter((l) => l.includes('_extinct/'));
  // 🔴 本件**自带**的演练输入件（步 2/3 落的候选值表）：它含全部包 id，是**演练输入不是产品残留**
  //    ⇒ 单列一个数，不混进"产品残留"里（也**不隐藏** —— 两个数都给）
  const ownFixture = allHits.filter((l) => l.includes('customer-deps-candidates.json'));
  const live = allCount - historical.length - ownFixture.length;
  rows.push({
    pkg,
    cls: '引用',
    verdict: live === 0 ? U_CLEAN : U_DIRTY,
    residual: live,
    command: refStrong.command + '   ;   ' + refWeak.command,
    evidence: [
      '标记 ' + markers.length + ' 个：强 ' + strong.length + '（含字母，grep -w）／ 弱 ' + weak.length + '（纯数字，**只认被引号包住**）' + ' ⇒ ' + markers.slice(0, 8).join(', ') + ' …',
      '命中 ' + allCount + ' 行（强 ' + refStrong.count + ' ＋ 弱 ' + refWeak.count + '）⇒ 原始 ' + allCount +
        ' ／ 历史留痕（_extinct/）' + historical.length + ' ／ 本件自带夹具 ' + ownFixture.length +
        ' ⇒ **产品残留 = ' + live + ' 行**',
      '命中落在（按文件聚合，供判"是新残留还是历史冻结名单"）：' + topPathsLabel(allHits),
      ...allHits.filter((l) => !l.includes('_extinct/')).slice(0, 6),
    ],
    declaredBy: historical.length > 0 ? (RETENTION_BASES[1]?.basis ?? '') : '',
  });

  // ⑥ 缓存：**构建/派生缓存**里还有没有 X 的落点
  //    🔴 两条实测修正（2026-10-13）：
  //      ① 缓存根**不含 `.dsh/`** —— 那是**受版本控制的源码目录**（DSH 插件），不是缓存；
  //         把它当缓存 ⇒ 每个包都判"不干净"（假红）。
  //      ② **不把 `.exile-quarantine/` 算作残留** —— 那是**本件自己的摘除机制**，
  //         此刻正装着刚卸下来的东西；把它计入 ⇒ 又是一个必然假红。
  const cacheTargets = ['dist', 'coverage', 'node_modules/.cache'];
  const present = cacheTargets.filter((c) => existsSync(join(tree, c)));
  const cache = present.length === 0 || removed.length === 0
    ? { command: 'ls -d dist/ coverage/ node_modules/.cache/ 2>/dev/null', rc: 1, hits: [], count: 0 }
    : runGrep(tree, ['-rlF', '-f', writePatterns(pkg, 'cache', removed), ...present]);
  rows.push({
    pkg,
    cls: '缓存',
    verdict: present.length === 0 ? U_NA : cache.count === 0 ? U_CLEAN : U_DIRTY,
    residual: present.length === 0 ? -1 : cache.count,
    command: cache.command,
    evidence: [
      '树内存在的缓存根：' + (present.length === 0 ? '（无）' : present.join(', ')),
      present.length === 0
        ? '🔴 隔离树是**源码树**（无 dist/ coverage/ 等构建产物）⇒ 该类**测不到**，判"不适用"而非"干净"'
        : '缓存里命中 X 落点的文件：' + cache.count + ' 个' + (cache.count > 0 ? ' ⇒ ' + cache.hits.slice(0, 5).join(', ') : ''),
    ],
    declaredBy: '',
  });

  // ⑦ 登记：施工项账在卸载后仍在册（声明保留）＋ _extinct/ 归档条目
  const inRegistry = items.filter((i) => i.block === pkg).length;
  const extinct = extinctEntries(tree);
  rows.push({
    pkg,
    cls: '登记',
    verdict: U_DECLARED,
    residual: inRegistry,
    command: "grep -c \"block: '" + pkg + "'\" docs/synova/coordination/施工项登记.ts ; ls extensions/sentinels/_extinct/",
    evidence: [
      '施工项账仍登记该块 ' + inRegistry + ' 项（**卸载不改登记件 —— CTO 红线，本件只读**）',
      '_extinct/ 归档条目：' + extinct.length + ' 个' + (extinct.length > 0 ? ' ⇒ ' + extinct.slice(0, 12).join(', ') : ''),
    ],
    declaredBy: (RETENTION_BASES[0]?.basis ?? '') + ' ｜ ' + (RETENTION_BASES[1]?.basis ?? ''),
  });

  restoreTree(tree);
  return { pkg, removedCount: removed.length, sharedWithOthers: shared.length, rows };
}

/**
 * 把 patterns 写成临时文件（`grep -f` 用：**一次 grep 覆盖多条**，避免 N 次进程）。
 *
 * 🔴 落点必须在**树外**（`os.tmpdir()`）：树内的 `.exile-quarantine/` 会被 `restoreTree` 清掉，
 *    写在里面 ⇒ 文件在 grep 前就没了（**实测踩过的坑**）。
 */
function writePatterns(pkg: string, tag: string, patterns: readonly string[]): string {
  const dir = join(tmpdir(), 'synova-uninstall-patterns');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, pkg + '-' + tag + '.patterns');
  writeFileSync(p, patterns.join('\n') + '\n', 'utf8');
  return p;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **验 K12 的"还原率"**（CTO 裁定 097）—— **--phase restore-rate**
 *
 * 要回答的一句话（创始人原话）：「**K12 离了别的包，还能还原多少能力？**」
 *   · 能还原一大部分 ⇒ 维持 **T1**（可独立交付/可单独卖）
 *   · 只还原一点点 ⇒ 降 **T2**（必须成组卖）
 * ⇒ 产出是**还原率表**，不是"瘫/不瘫"的二元结论。
 *
 * 🔴 **复用而非重建**：隔离树走 `exile-tree-core.ts`，摘除走 `applyExile`；
 *    本段只**加一个 phase**，不新造摘除/隔离逻辑（派单件 §七）。
 *
 * 🔴 **两个摘除面**（都要跑，因为"摘掉 X"在本仓有歧义 —— 块级 paths 互叠）：
 *   · **面 A（字面照做）**：摘 `PATHS(X)` 全部 —— 任务书 §四 的字面读法
 *   · **面 B（扣目标自持）**：摘 `PATHS(X) \ PATHS(target)` —— **"客户只买 K12"的场景**
 *     （若把 K12 自己也声明持有的文件摘掉，那一刀砍的是 K12 自己 ⇒ 红因不指向依赖）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 还原率的一行（一个 X × 一个面） */
export interface RestoreRow {
  /** 'A' = 字面摘 PATHS(X) ｜ 'B' = 摘 PATHS(X) 减 PATHS(target) */
  face: 'A' | 'B';
  target: string;
  missing: string;
  /** 目标包被判的**步数**（含重复；本仓 K12 = 23） */
  totalSteps: number;
  /** 去重后的唯一命令数 */
  uniqueSteps: number;
  /** 基线（全量树）绿数（按步数口径） */
  baselineGreen: number;
  /** 摘除后绿数（按步数口径） */
  remainGreen: number;
  /** 还原率 = remainGreen / baselineGreen（**分母用基线绿**，排除"本来就不绿"的步） */
  restoreRate: number;
  /** 按任务书口径 = remainGreen / totalSteps */
  rateOfTotal: number;
  /** 摘除面条目数（展开后） */
  anchorCount: number;
  /** 基线绿、摘后红 的步（**实测不可用面**） */
  newlyRed: string[];
  /** 基线就红的步（**不计入分母**，但要看得见） */
  baselineRed: string[];
  verdict: string;
  note: string;
}

/** 判定（程度，不是二元 —— 派单件 §五） */
export const RR_SOFT = '软依赖（还原率 ≥ 2/3）';
export const RR_HARD = '硬依赖（还原率 < 1/3）';
export const RR_MID = '中间地带（交 CTO 裁，不四舍五入）';
export const RR_UNK = '判不了';

/**
 * 取目标包的**判据步**（blockAcceptance ＋ 该包 items 的 acceptance；**按原样保留重复**）。
 *
 * @why 任务书说"K12 的 blockAcceptance（**23 步**）"——实测 23 = 块级 2 ＋ 21 项各 1；
 *      其中 `check-content-coupling.sh` 出现 4 次 ⇒ **去重后 21 条唯一命令**。
 *      两个口径都给（步数口径用于对齐任务书，唯一口径用于实际执行）。
 * @contract
 *   @input  blockId｜items｜blocks
 *   @output `{steps, weights}`：`steps` = 去重后的命令；`weights` = 每条命令的步权重
 *   @degraded 不适用
 */
export function targetSteps(
  blockId: string,
  items: readonly ItemLike[],
  blocks: readonly BlockLike[],
): { steps: AcceptanceStepLike[]; weights: number[]; total: number } {
  const raw: AcceptanceStepLike[] = [];
  const b = blocks.find((x) => x.id === blockId);
  if (b?.blockAcceptance !== undefined) raw.push(...b.blockAcceptance);
  for (const it of items) if (it.block === blockId) raw.push(...(it.acceptance ?? []));
  const steps: AcceptanceStepLike[] = [];
  const weights: number[] = [];
  for (const s of raw) {
    const i = steps.findIndex((x) => x.run === s.run);
    if (i >= 0) weights[i] = (weights[i] ?? 1) + 1;
    else {
      steps.push(s);
      weights.push(1);
    }
  }
  return { steps, weights, total: raw.length };
}

/**
 * **验还原率**：逐个摘 X ⇒ 跑目标包的判据 ⇒ 数"还剩几绿"。
 *
 * @contract
 *   @input  tree｜items｜blocks｜byBlock｜target｜against（要摘的包）｜timeoutSec
 *   @output `RestoreRow[]`（每个 X × 两个面各一行）
 *   @degraded 不适用（"判不了"是结果）
 *
 * 🔴 **进出都 `restoreTree`**：卸完必须还原（沿用步 4 的做法）。
 */
export function runRestoreRate(
  tree: string,
  items: readonly ItemLike[],
  blocks: readonly BlockLike[],
  byBlock: Record<string, string[]>,
  target: string,
  against: readonly string[],
  timeoutSec: number,
): { rows: RestoreRow[]; baselineGreenRuns: string[]; baselineRedRuns: string[] } {
  const { steps, weights, total } = targetSteps(target, items, blocks);
  const rows: RestoreRow[] = [];
  restoreTree(tree);

  // ① 基线：全量树跑一遍（**这也是停止条件④ 的闸门**：全红 = 判据跑不起来）
  const baselineGreen: boolean[] = [];
  for (const s of steps) {
    const r = runShell(tree, s.run, timeoutSec);
    baselineGreen.push(stepPassed(s, r.rc, r.out));
  }
  const baselineGreenRuns = steps.filter((_, i) => baselineGreen[i] === true).map((s) => s.run);
  const baselineRedRuns = steps.filter((_, i) => baselineGreen[i] !== true).map((s) => s.run);
  const baselineGreenSteps = weights.reduce((a, w, i) => a + (baselineGreen[i] === true ? w : 0), 0);

  const targetPaths = byBlock[target] ?? [];
  const targetSet = new Set(targetPaths);

  for (const x of against) {
    const px = byBlock[x] ?? [];
    const faces: { face: 'A' | 'B'; patterns: string[] }[] = [
      { face: 'A', patterns: px },
      { face: 'B', patterns: px.filter((p) => !targetSet.has(p)) },
    ];
    for (const f of faces) {
      restoreTree(tree);
      if (f.patterns.length === 0) {
        rows.push({
          face: f.face, target, missing: x, totalSteps: total, uniqueSteps: steps.length,
          baselineGreen: baselineGreenSteps, remainGreen: -1, restoreRate: -1, rateOfTotal: -1,
          anchorCount: 0, newlyRed: [], baselineRed: baselineRedRuns,
          verdict: RR_UNK, note: '摘除面为空（PATHS(X) 被 PATHS(target) 字面全覆盖）',
        });
        continue;
      }
      const ex = expandAll(tree, f.patterns);
      const moved = applyExile(tree, ex.rels);
      if (moved === 0) {
        rows.push({
          face: f.face, target, missing: x, totalSteps: total, uniqueSteps: steps.length,
          baselineGreen: baselineGreenSteps, remainGreen: -1, restoreRate: -1, rateOfTotal: -1,
          anchorCount: ex.rels.length, newlyRed: [], baselineRed: baselineRedRuns,
          verdict: RR_UNK, note: '摘除面展开为空（树里匹配不到）—— 禁当"全绿"',
        });
        restoreTree(tree);
        continue;
      }
      const after: boolean[] = [];
      for (const s of steps) {
        const r = runShell(tree, s.run, timeoutSec);
        after.push(stepPassed(s, r.rc, r.out));
      }
      restoreTree(tree);
      const remainGreen = weights.reduce((a, w, i) => a + (after[i] === true ? w : 0), 0);
      const newlyRed = steps.filter((_, i) => baselineGreen[i] === true && after[i] !== true).map((s) => s.run);
      const rate = baselineGreenSteps === 0 ? -1 : remainGreen / baselineGreenSteps;
      let verdict = RR_MID;
      let note = '';
      if (baselineGreenSteps === 0) {
        verdict = RR_UNK;
        note = '基线全红 ⇒ 判据跑不起来（停止条件④）';
      } else if (rate >= 2 / 3) verdict = RR_SOFT;
      else if (rate < 1 / 3) verdict = RR_HARD;
      rows.push({
        face: f.face, target, missing: x, totalSteps: total, uniqueSteps: steps.length,
        baselineGreen: baselineGreenSteps, remainGreen,
        restoreRate: rate, rateOfTotal: remainGreen / total,
        anchorCount: ex.rels.length, newlyRed, baselineRed: baselineRedRuns, verdict, note,
      });
    }
  }
  restoreTree(tree);
  return { rows, baselineGreenRuns, baselineRedRuns };
}

/** CLI 主体 */
export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const tree = resolve(readFlag(argv, '--tree'));
  if (readFlag(argv, '--tree') === '' || !existsSync(tree)) {
    process.stderr.write(`❌ 演练器判不了（exit 2）：--tree 必须指向已存在的隔离宿主树（收到「${readFlag(argv, '--tree')}」）\n`);
    return EXIT_UNJUDGEABLE;
  }
  const candArg = readFlag(argv, '--candidates');
  const candPath = candArg !== '' ? resolve(candArg) : join(dirname(fileURLToPath(import.meta.url)), 'customer-deps-candidates.json');
  if (!existsSync(candPath)) {
    process.stderr.write(`❌ 演练器判不了（exit 2）：候选值表不存在 ${candPath}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const phase = readFlag(argv, '--phase') || 'all';
  const only = readFlag(argv, '--only');
  const timeoutSec = Number.parseInt(readFlag(argv, '--timeout') || '300', 10);

  const { sourceArg, error } = resolveSourceArg(argv);
  if (error !== '') {
    process.stderr.write(`❌ 演练器判不了（exit 2）：${error}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const loaded = await loadRegistryView(sourceArg);
  if (!loaded.ok || loaded.view === null) {
    process.stderr.write(`❌ 演练器判不了（exit 2）：${loaded.error}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const items = loaded.view.items as readonly ItemLike[];
  const blocks = loaded.view.blocks as readonly BlockLike[];

  let cand: { declarations: { pkg: string; missing: string; unavailable: string[] }[] };
  try {
    cand = JSON.parse(readFileSync(candPath, 'utf8')) as typeof cand;
  } catch (err) {
    process.stderr.write(`❌ 演练器判不了（exit 2）：候选值表解析失败（${err instanceof Error ? err.message : String(err)}）\n`);
    return EXIT_UNJUDGEABLE;
  }

  const report: DrillReport = {
    tree,
    candidates: candPath,
    step0: [],
    scan: [],
    sensitivity: [],
    runs: [],
    uninstall: [],
    notes: [
      `ⓘ 真源 = ${loaded.sourcePath}`,
      `ⓘ 候选值表 = ${candPath}（**候选，待本演练验**；不写回登记件）`,
      `ⓘ 摘除面 = **项级 paths**（块级有 43 对字面包含 ⇒ 不可用 —— CTO 086 ②）`,
    ],
  };

  if (phase === 'step0' || phase === 'all') {
    try {
      report.step0 = runStep0(tree, timeoutSec);
    } catch (err) {
      process.stderr.write(`❌ 演练器判不了（exit 2）：步骤 0 自身异常 —— ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT_UNJUDGEABLE;
    }
    for (const r of report.step0) {
      process.stdout.write(`[步骤0] ${r.name} expect=${r.expect} rc=${r.rc ?? 'null'} ⇒ ${r.ok ? '✅ 符合' : '❌ 不符'}\n`);
      process.stdout.write(`          命令：${r.command}\n          原始输出末 3 行：\n${r.stdoutTail}\n`);
    }
    const bad = report.step0.filter((r) => !r.ok);
    if (bad.length > 0) {
      process.stderr.write(
        `\n🔴🔴 **演练器判废**（exit 2）：步骤 0 有 ${bad.length} 条不符（${bad.map((b) => b.name).join(' / ')}）\n` +
          `   ⇒ 按派单件停止条件①：**第二档全部输出作废**，不许拿它下任何结论。\n`,
      );
      return EXIT_UNJUDGEABLE;
    }
    process.stdout.write('✅ 步骤 0 通过：0a 该红已红 / 0b 该绿已绿 ⇒ 演练器**不判废**\n');
  }

  // 🔴 扫描是**纯静态**（不跑命令）⇒ 任何 phase 都要算（否则 `--phase run` 会"无行可跑"而假绿）
  {
    const decls = cand.declarations.filter((d) => only === '' || d.pkg === only);
    report.scan = scanDeclarations(items, blocks, decls);
  }
  if (phase === 'scan' || phase === 'all') {
    process.stdout.write('\n[扫描] 逐条候选值"能不能跑"（静态，不跑命令）\n');
    for (const s of report.scan) {
      process.stdout.write(
        `  · ${s.pkg} 缺 ${s.missing}：${s.verdict}${s.reason === '' ? '' : ` —— ${s.reason}`}` +
          `（项级边 ${s.itemEdges.length} 条；锚 ${s.anchor.length} 条）\n`,
      );
    }
  }

  // 🔴 摘除灵敏度筛选（设计件 §3.2）：不过筛的包 ⇒ 其全部声明判"判不了"（**绿不算数**）
  const sensMap = new Map<string, { sensitive: boolean; reason: string }>();
  if (phase === 'sensitivity' || phase === 'run' || phase === 'all') {
    const pkgs = [...new Set(report.scan.filter((s) => s.verdict === '可判（待真跑）').map((s) => s.pkg))].sort();
    if (phase !== 'run') process.stdout.write('\n[灵敏度筛选] 自摘 Y 自己的项级写集 ⇒ 判据**必须红**（绿 ⇒ 判据不在摘除面上，绿不算数）\n');
    for (const p of pkgs) {
      const scr = sensitivityScreen(tree, p, items, blocks, timeoutSec);
      report.sensitivity.push(...scr.rows);
      sensMap.set(p, { sensitive: scr.sensitive, reason: scr.reason });
      if (phase !== 'run') {
        process.stdout.write(`  · ${p}：${scr.sensitive ? '✅ 敏感（判据在摘除面上）' : `❌ 不敏感 —— ${scr.reason}`}\n`);
        for (const r of scr.rows) {
          process.stdout.write(`      ${r.verdict} ｜ 摘 ${r.anchor.length} 条 ⇒ rc=${r.afterRc ?? 'null'} ｜ ${r.minCommand}\n`);
        }
      }
    }
  }

  if (phase === 'run' || phase === 'sensitivity' || phase === 'all') {
    for (const s of report.scan) {
      if (s.verdict !== '可判（待真跑）') continue;
      const sens = sensMap.get(s.pkg);
      if (sens !== undefined && !sens.sensitive) {
        report.runs.push({
          pkg: s.pkg, missing: s.missing, anchor: s.anchor,
          minCommand: minStepsOf(s.pkg, items, blocks).map((x) => x.run).join(' ｜ '),
          baselineOk: false, baselineRc: null, afterRc: null, afterPass: true,
          verdict: V_UNK, note: sens.reason,
        });
      }
    }
  }

  if (phase === 'run' || phase === 'all') {
    process.stdout.write('\n[真跑] 摘锚 ⇒ 跑 Y 的 min（先证判据基线绿）\n');
    for (const s of report.scan) {
      if (s.verdict !== '可判（待真跑）') continue;
      const sens = sensMap.get(s.pkg);
      if (sens !== undefined && !sens.sensitive) continue;
      const d = cand.declarations.find((x) => x.pkg === s.pkg && x.missing === s.missing);
      if (d === undefined) continue;
      const rows = runDeclaration(tree, items, blocks, d, s.anchor, timeoutSec);
      report.runs.push(...rows);
      for (const r of rows) {
        process.stdout.write(
          `  · ${r.pkg} 缺 ${r.missing} ｜ ${r.verdict} ｜ baseline rc=${r.baselineRc ?? 'null'}` +
            ` ⇒ after rc=${r.afterRc ?? 'null'}` +
            `${r.note === '' ? '' : `\n      ⚠️ ${r.note}`}` +
            `\n      判据：${r.minCommand}\n`,
        );
      }
    }
  }

  // ══ 🔴 步 4 · 可卸载性真值实测（--phase uninstall）══════════════════════════════
  //    与步 2/3 的 phase 互斥使用（uninstall 只做"痕迹"，不做"功能" —— 派单件 §一）。
  if (phase === 'uninstall') {
    const dbArg = readFlag(argv, '--db');
    const dbPath = dbArg !== '' ? resolve(dbArg) : join(tree, 'data', 'synova.db');
    const bp = blockPathsOf(loaded.view);
    if (bp.error !== '') {
      process.stderr.write('❌ 演练器判不了（exit 2）：块级 paths 算不出来：' + bp.error + '\n');
      return EXIT_UNJUDGEABLE;
    }
    const pkgs = Object.keys(bp.byBlock).sort().filter((p) => only === '' || p === only);
    report.notes.push(
      'ⓘ 卸除面 = 块级 paths（= 该块 items 的 paths 并集，**已被对账门禁验过**）—— 派单件 §二「复用而非重建」',
      'ⓘ 隔离树内 sqlite = ' + (existsSync(dbPath) ? dbPath : '（无 ⇒ 「表」类判不了）'),
    );
    process.stdout.write('\n[步4·可卸载性] 逐包卸除（**只在隔离树里**）⇒ 七类残留\n');
    for (const p of pkgs) {
      const one = runUninstall(tree, items, bp.byBlock, p, dbPath);
      report.uninstall.push(one);
      process.stdout.write('── ' + p + '：卸除面 ' + one.removedCount + ' 条 ｜ 🔴 与他包共用 ' + one.sharedWithOthers + ' 条\n');
      for (const r of one.rows) {
        const tag = r.verdict === U_CLEAN ? '✅' : r.verdict === U_DIRTY ? '❌' : r.verdict === U_DECLARED ? '▣' : '⚠️';
        process.stdout.write('   ' + tag + ' ' + r.cls + '：' + r.verdict + '（残留 ' + (r.residual < 0 ? '–' : String(r.residual)) + '）\n');
        for (const e of r.evidence.slice(0, 3)) process.stdout.write('        ' + e + '\n');
        if (r.declaredBy !== '') process.stdout.write('        ▣ 依据：' + r.declaredBy + '\n');
      }
    }
    const flat = report.uninstall.flatMap((u) => u.rows);
    process.stdout.write(
      'SUMMARY(步4): 干净 ' + flat.filter((r) => r.verdict === U_CLEAN).length +
        ' ｜ 声明保留 ' + flat.filter((r) => r.verdict === U_DECLARED).length +
        ' ｜ **不干净 ' + flat.filter((r) => r.verdict === U_DIRTY).length + '**' +
        ' ｜ 判不了 ' + flat.filter((r) => r.verdict === U_UNK).length +
        ' ｜ 不适用 ' + flat.filter((r) => r.verdict === U_NA).length + '\n',
    );
  }

  // ══ 🔴 验 K12 的还原率（--phase restore-rate · CTO 裁定 097）══════════════════════
  if (phase === 'restore-rate') {
    const target = readFlag(argv, '--target') || 'K12';
    const againstArg = readFlag(argv, '--against');
    const bp = blockPathsOf(loaded.view);
    if (bp.error !== '') {
      process.stderr.write('❌ 演练器判不了（exit 2）：块级 paths 算不出来：' + bp.error + '\n');
      return EXIT_UNJUDGEABLE;
    }
    const all = Object.keys(bp.byBlock).sort();
    const against = (againstArg !== '' ? againstArg.split(',') : all.filter((p) => p !== target)).map((s) => s.trim()).filter((s) => s !== '');
    const tgt = targetSteps(target, items, blocks);
    report.notes.push(
      'ⓘ 目标包 = ' + target + ' ｜ 判据步 = ' + tgt.total + ' 步（去重后 ' + tgt.steps.length + ' 条唯一命令）',
      'ⓘ 要摘的包 = ' + against.join(', '),
      'ⓘ 两个摘除面：A = 字面摘 PATHS(X) ｜ B = 摘 PATHS(X) 减 PATHS(' + target + ')（= 「客户只买 ' + target + '」的场景）',
    );
    process.stdout.write('\n[还原率] 目标 ' + target + '：' + tgt.total + ' 步（唯一 ' + tgt.steps.length + ' 条）\n');
    const rr = runRestoreRate(tree, items, blocks, bp.byBlock, target, against, timeoutSec);
    report.notes.push('ⓘ 基线绿 ' + rr.baselineGreenRuns.length + ' / 唯一 ' + tgt.steps.length + '（基线本红 ' + rr.baselineRedRuns.length + ' 条，不计入分母）');
    process.stdout.write('ⓘ 基线绿 ' + rr.baselineGreenRuns.length + ' / 唯一 ' + tgt.steps.length + ' 条\n');
    for (const r of rr.baselineRedRuns) process.stdout.write('   ⚠️ 基线本红（不计分母）：' + r.slice(0, 110) + '\n');
    process.stdout.write('\n面 ｜ 摘 ｜ 剩绿/步 ｜ 还原率 ｜ 摘除面 ｜ 新红步数 ｜ 判定\n');
    for (const r of rr.rows) {
      process.stdout.write(
        ' ' + r.face + ' ｜ ' + r.missing.padEnd(7) + ' ｜ ' +
          (r.remainGreen < 0 ? ' 判不了' : String(r.remainGreen).padStart(3) + '/' + r.totalSteps) + ' ｜ ' +
          (r.restoreRate < 0 ? '  –  ' : (r.restoreRate * 100).toFixed(1) + '%') + ' ｜ ' +
          String(r.anchorCount).padStart(4) + ' 条 ｜ ' + String(r.newlyRed.length).padStart(4) + ' ｜ ' + r.verdict +
          (r.note === '' ? '' : '（' + r.note + '）') + '\n',
      );
      for (const s of r.newlyRed) process.stdout.write('        ❌ 新红：' + s.slice(0, 120) + '\n');
    }
    report.restore = rr.rows;
    report.baselineGreenRuns = rr.baselineGreenRuns;
    report.baselineRedRuns = rr.baselineRedRuns;
    const soft = rr.rows.filter((r) => r.verdict === RR_SOFT).length;
    const hard = rr.rows.filter((r) => r.verdict === RR_HARD).length;
    const mid = rr.rows.filter((r) => r.verdict === RR_MID).length;
    const unk = rr.rows.filter((r) => r.verdict === RR_UNK).length;
    process.stdout.write('SUMMARY(还原率): 软 ' + soft + ' ｜ 硬 ' + hard + ' ｜ 中间地带 ' + mid + ' ｜ 判不了 ' + unk + ' ｜ 共 ' + rr.rows.length + ' 行\n');
    // 🔴 本 phase **自带出口**（不回落到下面的通用收尾）⇒ `--out` 必须在此处落盘
    //    （实测踩坑：首版在此直接 return ⇒ `--out` 静默失效、JSON 从未生成）
    const rrOut = readFlag(argv, '--out');
    if (rrOut !== '') {
      mkdirSync(dirname(resolve(rrOut)), { recursive: true });
      writeFileSync(resolve(rrOut), JSON.stringify(report, null, 2), 'utf8');
      process.stderr.write('  ⓘ 机器可读结果已落 ' + resolve(rrOut) + '\n');
    }
    return unk > 0 ? EXIT_MISMATCH : EXIT_OK;
  }

  const outFile = readFlag(argv, '--out');
  if (outFile !== '') {
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
    process.stderr.write(`  ⓘ 机器可读结果已落 ${resolve(outFile)}\n`);
  }

  // 🔴 步 4 与步 2/3 的**收尾口径不同**（一个是"痕迹"，一个是"功能"）⇒ 各印各的、各判各的
  if (phase === 'uninstall') {
    const flat = report.uninstall.flatMap((u) => u.rows);
    const dirty = flat.filter((r) => r.verdict === U_DIRTY).length;
    const unk = flat.filter((r) => r.verdict === U_UNK).length;
    const sharedTotal = report.uninstall.reduce((a, u) => a + u.sharedWithOthers, 0);
    process.stdout.write(
      'SUMMARY(步4·收尾): 卸除面顶层条目合计 ' +
        report.uninstall.reduce((a, u) => a + u.removedCount, 0) +
        ' 条 ｜ 🔴 与他包共用合计 ' + sharedTotal + ' 条\n' +
        '🔴 判据：**卸 X ⇒ 残留集 = ∅（或已声明保留）** —— 不干净 ' + dirty + ' 类 ／ 判不了 ' + unk + ' 类\n',
    );
    return dirty > 0 || unk > 0 ? EXIT_MISMATCH : EXIT_OK;
  }

  const greenFake = report.runs.filter((r) => r.verdict === V_GREEN).length;
  const redTrue = report.runs.filter((r) => r.verdict === V_RED).length;
  const unk = report.scan.filter((s) => s.verdict === V_UNK).length + report.runs.filter((r) => r.verdict === V_UNK).length;
  process.stdout.write(
    `SUMMARY: 依赖成立(红) ${redTrue} ｜ **假声明(绿)** ${greenFake} ｜ 判不了 ${unk} ｜ 扫描行 ${report.scan.length}\n`,
  );
  return greenFake > 0 || unk > 0 ? EXIT_MISMATCH : EXIT_OK;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
    } catch (err) {
      process.stderr.write(
        `ⓘ 降级：无法判定是否直接调用（${err instanceof Error ? err.message : String(err)}）⇒ 不自动执行 main\n`,
      );
      return false;
    }
  })();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`❌ 演练器自身异常（exit 2）：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(EXIT_UNJUDGEABLE);
    });
}
