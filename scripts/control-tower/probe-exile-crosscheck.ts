#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-exile-crosscheck.ts — **第一档·两路互证**（CTO 裁定 086）
 *
 * @why CTO 放行时明确要求：「**主路（编译宿主封锁）＋ 复核路（隔离树真删）双机制**，
 *      🔴 **两路结论必须一致，不一致 ⇒ 该行判"判不了"**」。
 *      本件就干这一件事：把**同一批 (X,Y)** 的两路结论摆在一起逐行比。
 *
 * 🔴 两路是**不同机制**（这是互证的全部价值）：
 *   · **主路** `probe-exile-compile.ts`：`ts.createProgram` ＋ 自造 `CompilerHost`
 *     （对 X 的文件回答"不存在"）——**零文件系统改动**，但共用 TS 的 program 语义。
 *   · **复核路** `exile-tree.sh matrix`：`git worktree` 隔离树里**真把文件搬走**，
 *     跑**真 `tsc` 命令行** —— 机制完全独立，代价是慢（每块一次全量 tsc）。
 *   ⇒ 一路错、另一路对 ⇒ 该行判"判不了"（**不取多数**，禁"以谁为准"的裁量）。
 *
 * 🔴 两路的**基线口径不同、但各自内部自洽**（实测，2026-10-13）：
 *   · 主路基线（API）：**33 条**（含 `src/agent/cost-budget.ts` 的 4 条 `TS4094`）；
 *   · 复核路基线（CLI `tsc --noEmit -p tsconfig.json`）：**29 条**（无 TS4094）。
 *   ⇒ 差异只在**基线**，两路各自都是"**摘除后 − 各自基线**"，故**差集口径不变**。
 *      本件**不强行统一基线**（那会掩盖差异），而是**把差异打印出来**（见 `baselineNote`）。
 *
 * @契约（铁律 47）
 *   @input   `--api <matrix.json>`（主路产物）｜ `--cli-dir <dir>`（复核路产物目录，
 *            含 `baseline.txt` 与 `after-<X>.txt`）｜ `--source <登记件>`（可选）
 *   @output  stdout：逐行对照 ＋ 末行 SUMMARY；`--json` 时输出机器可读
 *   @exit    🔴 **三态**：0 = 两路**逐行一致**（含"两路都判不了且原因同类"）｜
 *            1 = 存在**不一致**行（逐行点名）｜ 2 = **判不了**（输入文件缺 / 解析失败 / 真源读不到）
 *   @degraded — 无：一切异常归 2 ＋ stderr 点名
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_MISMATCH,
  EXIT_OK,
  EXIT_UNJUDGEABLE,
} from './block-paths-core.ts';
import {
  VERDICT_DEPENDENT,
  VERDICT_INDEPENDENT,
  VERDICT_UNJUDGEABLE,
  blockPathsOf,
  hasEntanglement,
  pathMatcher,
  type DiagRow,
  type ExileReport,
} from './probe-exile-compile.ts';
import { loadRegistryView, resolveSourceArg } from './gen-block-paths.ts';

/** 复核路的原始 tsc 文本里的一行错误 */
export function parseTscLine(line: string): DiagRow | null {
  const m = /^(\S.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
  if (m === null) return null;
  return {
    file: m[1] as string,
    line: Number(m[2]),
    col: Number(m[3]),
    code: Number((m[4] as string).slice(2)),
    message: m[5] as string,
  };
}

/** 读一个 tsc 输出文件 ⇒ 诊断行（**原样读，禁裁剪**） */
export function readTscOut(path: string): DiagRow[] {
  if (!existsSync(path)) return [];
  const out: DiagRow[] = [];
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const d = parseTscLine(raw);
    if (d !== null) out.push(d);
  }
  return out;
}

/** 复核路单块结果 */
export interface CliRow {
  exile: string;
  target: string;
  verdict: string;
  reason: string;
  newErrorCountInTarget: number;
}

/**
 * 复核路：用 CLI 产物判一块。
 *
 * 🔴 **分工写清楚（这决定了"互证"到底证了什么）**：
 *   · **守门层（路线无关，两路共用）**：`paths 字面包含` / `X 在编译域无文件` / `Y 在编译域无文件`
 *     —— 这三条是"**判据有没有对象**"的物理事实，与"用什么机制摘"无关
 *     ⇒ 直接沿用主路的守门结论（`guardRow.verdict`），**复核路不另造一套**（另造 = 制造第二口径）。
 *   · **判定层（路线相关，各算各的）**：主路看 `CompilerHost` 封锁后的 program 诊断；
 *     复核路看**真 `tsc`** 在**真搬走文件**的树上的输出 ⇒ **这才是互证的那一半**。
 *
 * @contract
 *   @input  cliDir｜baseline（CLI 基线诊断）｜byBlock｜exileId｜guardRows（主路该 X 的行，**只取守门**）
 *   @output `CliRow[]`
 *   @degraded `after-<X>.txt` 缺失 ⇒ 该 X 全部目标判"判不了"（**摘除面为空**的显式表达）
 */
export function runCliRoute(
  cliDir: string,
  baseline: readonly DiagRow[],
  byBlock: Record<string, string[]>,
  exileId: string,
  guardRows: readonly { target: string; verdict: string; reason: string }[],
): CliRow[] {
  const afterPath = join(cliDir, `after-${exileId}.txt`);
  const absent = !existsSync(afterPath);
  const after = absent ? [] : readTscOut(afterPath);
  const baseKeys = new Set(baseline.map((d) => `${d.file}:${d.line}:${d.col}:${d.code}`));
  const newDiags = after.filter((d) => !baseKeys.has(`${d.file}:${d.line}:${d.col}:${d.code}`));
  const pathsX = byBlock[exileId] ?? [];
  const guardMap = new Map(guardRows.map((g) => [g.target, g]));
  const rows: CliRow[] = [];
  for (const targetId of Object.keys(byBlock).sort()) {
    if (targetId === exileId) continue;
    const pathsY = byBlock[targetId] ?? [];
    const matchersY = pathsY.map(pathMatcher);
    const inTarget = newDiags.filter((d) => matchersY.some((m) => m(d.file)));
    const g = guardMap.get(targetId);
    if (g !== undefined && g.verdict === VERDICT_UNJUDGEABLE) {
      rows.push({ exile: exileId, target: targetId, verdict: VERDICT_UNJUDGEABLE, reason: g.reason, newErrorCountInTarget: inTarget.length });
      continue;
    }
    if (absent) {
      rows.push({ exile: exileId, target: targetId, verdict: VERDICT_UNJUDGEABLE, reason: '复核路摘除面为空（无 after 文件）', newErrorCountInTarget: 0 });
      continue;
    }
    if (hasEntanglement(pathsX, pathsY)) {
      rows.push({ exile: exileId, target: targetId, verdict: VERDICT_UNJUDGEABLE, reason: 'paths 字面包含', newErrorCountInTarget: inTarget.length });
      continue;
    }
    rows.push({
      exile: exileId,
      target: targetId,
      verdict: inTarget.length > 0 ? VERDICT_DEPENDENT : VERDICT_INDEPENDENT,
      reason: '',
      newErrorCountInTarget: inTarget.length,
    });
  }
  return rows;
}

/** 两路对照的一行 */
export interface CompareRow {
  exile: string;
  target: string;
  api: string;
  cli: string;
  /** 两路是否一致（判不了 ↔ 判不了 亦算一致） */
  agree: boolean;
  note: string;
}

/**
 * 逐行比对（🔴 **不取多数**：不一致即"判不了"）。
 *
 * @contract
 *   @input  apiRows（主路）｜cliRows（复核路）
 *   @output `CompareRow[]`（含两路都缺的行 ⇒ agree=false）
 *   @degraded 不适用
 */
export function compareRoutes(apiRows: readonly { exile: string; target: string; verdict: string }[], cliRows: readonly CliRow[]): CompareRow[] {
  const key = (r: { exile: string; target: string }): string => `${r.exile}->${r.target}`;
  const cliMap = new Map(cliRows.map((r) => [key(r), r]));
  const out: CompareRow[] = [];
  for (const a of apiRows) {
    const c = cliMap.get(key(a));
    if (c === undefined) {
      out.push({ exile: a.exile, target: a.target, api: a.verdict, cli: '（复核路无此行）', agree: false, note: '复核路缺行' });
      continue;
    }
    const agree = a.verdict === c.verdict;
    out.push({ exile: a.exile, target: a.target, api: a.verdict, cli: c.verdict, agree, note: agree ? '' : '两路结论不一致 ⇒ 该行判"判不了"' });
  }
  return out;
}

/** 读 `--flag value` */
function readFlag(argv: readonly string[], flag: string): string {
  const i = argv.indexOf(flag);
  return i < 0 ? '' : (argv[i + 1] ?? '');
}

/** CLI 主体 */
export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apiPath = resolve(readFlag(argv, '--api'));
  const cliDir = resolve(readFlag(argv, '--cli-dir'));
  if (readFlag(argv, '--api') === '' || readFlag(argv, '--cli-dir') === '') {
    process.stderr.write('❌ 互证判不了（exit 2）：必须给 --api <matrix.json> 与 --cli-dir <dir>\n');
    return EXIT_UNJUDGEABLE;
  }
  if (!existsSync(apiPath) || !existsSync(cliDir)) {
    process.stderr.write(`❌ 互证判不了（exit 2）：输入不存在（api=${apiPath} cliDir=${cliDir}）\n`);
    return EXIT_UNJUDGEABLE;
  }
  let report: ExileReport;
  try {
    report = JSON.parse(readFileSync(apiPath, 'utf8')) as ExileReport;
  } catch (err) {
    process.stderr.write(`❌ 互证判不了（exit 2）：主路 JSON 解析失败（${err instanceof Error ? err.message : String(err)}）\n`);
    return EXIT_UNJUDGEABLE;
  }
  const { sourceArg, error } = resolveSourceArg(argv);
  if (error !== '') {
    process.stderr.write(`❌ 互证判不了（exit 2）：${error}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const loaded = await loadRegistryView(sourceArg);
  if (!loaded.ok || loaded.view === null) {
    process.stderr.write(`❌ 互证判不了（exit 2）：${loaded.error}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const { byBlock, error: compErr } = blockPathsOf(loaded.view);
  if (compErr !== '') {
    process.stderr.write(`❌ 互证判不了（exit 2）：块级 paths 算不出来：${compErr}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const cliBaseline = readTscOut(join(cliDir, 'baseline.txt'));
  process.stderr.write(
    `  ⓘ 基线口径差异（**不强行统一**，两路各自内部自洽）：主路(API) ${report.baselineDiagCount} 条` +
      ` ｜ 复核路(CLI) ${cliBaseline.length} 条\n`,
  );

  const exiles = [...new Set(report.rows.map((r) => r.exile))].sort();
  const cliRows: CliRow[] = [];
  for (const x of exiles) {
    const guardRows = report.rows.filter((r) => r.exile === x).map((r) => ({ target: r.target, verdict: r.verdict, reason: r.reason }));
    cliRows.push(...runCliRoute(cliDir, cliBaseline, byBlock, x, guardRows));
  }
  const compared = compareRoutes(report.rows, cliRows);

  if (argv.includes('--json')) process.stdout.write(JSON.stringify(compared, null, 2) + '\n');
  else {
    for (const c of compared) {
      if (c.agree) continue;
      process.stdout.write(`  ❌ ${c.exile} ⇒ ${c.target}：主路=${c.api} ｜ 复核路=${c.cli}（${c.note}）\n`);
    }
    const agreeN = compared.filter((c) => c.agree).length;
    process.stdout.write(
      `SUMMARY: 一致 ${agreeN} / 共 ${compared.length} 行 ｜ 不一致 ${compared.length - agreeN}` +
        `（不一致行一律判"判不了" —— **不取多数**）\n`,
    );
  }
  return compared.some((c) => !c.agree) ? EXIT_MISMATCH : EXIT_OK;
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
      process.stderr.write(`❌ 互证自身异常（exit 2）：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(EXIT_UNJUDGEABLE);
    });
}
