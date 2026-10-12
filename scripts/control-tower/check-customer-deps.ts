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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_MISMATCH, EXIT_OK, EXIT_UNJUDGEABLE } from './block-paths-core.ts';
import { hasEntanglement, pathMatcher } from './probe-exile-compile.ts';
import { loadRegistryView, resolveSourceArg } from './gen-block-paths.ts';
import { applyExile, expandAll, restoreTree } from './exile-tree-core.ts';

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

  const outFile = readFlag(argv, '--out');
  if (outFile !== '') {
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
    process.stderr.write(`  ⓘ 机器可读结果已落 ${resolve(outFile)}\n`);
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
