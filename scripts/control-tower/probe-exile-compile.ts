#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-exile-compile.ts — **第一档·类型层摘除探针**（CTO 裁定 086 放行）
 *
 * @why 图纸说「**包能独立交付**」——"能不能独立"必须**验**，不能只声明。
 *      第一档 = 把 X 的 `paths` **从编译域摘除** ⇒ 看 Y 的文件是否出现 `error TS`：
 *        · Y 报错 ⇒ 类型层依赖成立（**红=证实**）
 *        · Y 零错 ⇒ 类型层无依赖（**降级待端口级裁决**）
 *
 * 🔴 **本件不是"tsconfig exclude"**（CTO 派单件原模板实测**不成立**，本件是其替代机制）：
 *      实测（2026-10-13，锚 918f2adea）：
 *        ① `exclude` 只筛 `include` 的**入口**，**不切断 import 边** ——
 *           把 `extensions/sentinels/_extinct/**` 写进 exclude 后，错误数**仍是 29 条（与基线相同）**；
 *        ② 模板字面形态（`exclude: [X, "**\/*"]`）直接得 `error TS18003: No inputs were found`。
 *      ⇒ 真"从编译域排除"只有一条路：**让编译器宿主解析不到那些文件**。
 *        本件用 `ts.createProgram` ＋ 自造 `CompilerHost`（`fileExists`/`readFile`/`getSourceFile`
 *        对落在 `PATHS(X)` 下的文件**一律回答"不存在"**）⇒ 依赖方得 `TS2307`。
 *        零文件系统改动 ⇒ 可逐包批量、可复跑、不碰主树。
 *      （复核路 = `exile-tree.sh` 的"隔离树真删"；两路结论必须一致，不一致 ⇒ 该行判"判不了"。）
 *
 * @契约（铁律 47）
 *   @input   `--source <path>`（可选；默认 = 真源 `docs/synova/coordination/施工项登记.ts`）
 *            `--exile <BlockId>`（单块模式）｜ `--all`（全矩阵）—— 二者必居其一
 *            `--only-block <BlockId>`（可选；单块模式下只判一个 Y）
 *            `--root <dir>`（可选；仓根，缺省从 cwd 上溯定位）
 *            `--out <file>`（可选；把机器可读结果写盘）
 *   @output  stdout：`--json` ⇒ 机器可读 JSON；否则人类可读逐行矩阵
 *            stderr：诊断（口径说明 / 判不了的原因逐条点名）
 *   @exit    🔴 **三态（D328）**：
 *              `0` = 矩陣跑完且**无"判不了"行**
 *              `1` = 矩陣跑完但**存在"判不了"行**（逐行点名 —— fail-closed，禁把"看不见"当"没问题"）
 *              `2` = **演练器自身判不了**（真源读不到 / tsconfig 读不到 / program 建不起来 / 基线跑不动）
 *   @degraded — **无独立降级路径**：一切异常归 exit 2 ＋ stderr 点名**原始异常**（禁空结果当通过）
 *
 * 🔴 三条判据口径（写死，禁改）
 *   ① **基线取差集**：锚 918f2adea 上 `tsc --noEmit -p tsconfig.json` **本身就是红的**
 *      （29 条；其中 25 条在 `extensions/sentinels/_extinct/**`，经 `src/sentinel/types.ts` 的
 *      `import type` 进编译域）⇒ 判据**只能是"摘除后新增"**，**不能**是"是否出现 error TS"。
 *   ② **两态守门（把"探针没生效"机器化）**：
 *      · `removedFileCount == 0` ⇒ **判"判不了"**（不是"无依赖"）；
 *      · `PATHS(X)` 与 `PATHS(Y)` 有**字面包含** ⇒ **判"判不了"**（摘 X 会连带摘掉 Y 自己）。
 *   ③ **字面包含（近似）**：`a` 覆盖 `b` ⇔ `a===b` ∨ (`a` 以 `/` 结尾 ∧ `b` 以其为前缀)
 *      ∨ (`a` 以 `/**` 结尾 ∧ `b` 在 `a` 去 `/**` 的前缀下)。**语义包含（通配互盖）不在此列**（见未核）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import {
  EXIT_MISMATCH,
  EXIT_OK,
  EXIT_UNJUDGEABLE,
  computeBlockPaths,
  type RegistryView,
} from './block-paths-core.ts';
import { loadRegistryView, locateRepoRoot, resolveSourceArg } from './gen-block-paths.ts';

/** 判定三态（🔴 具名常量，禁在调用点写裸字面量） */
export const VERDICT_DEPENDENT = '红·依赖成立';
export const VERDICT_INDEPENDENT = '绿·类型层无依赖';
export const VERDICT_UNJUDGEABLE = '判不了';

/** 判不了的原因枚举（**必须点名**，禁笼统"判不了"） */
export const REASON_ENTANGLED = 'paths 字面包含（摘 X 会连带摘掉 Y 自己）';
export const REASON_NO_FILE_REMOVED = '探针无效：基线 program 里 X 的文件数为 0';
export const REASON_NO_BLOCK_FILES = 'Y 在编译域里没有任何文件（判据无对象）';

/** 编译域里的 diagnostic（拍平后的行） */
export interface DiagRow {
  /** 仓根相对 POSIX 路径 */
  file: string;
  line: number;
  col: number;
  code: number;
  message: string;
}

/** 单块摘除的机器可读结果 */
export interface ExileRow {
  /** 摘除的块 */
  exile: string;
  /** 受判的块 */
  target: string;
  verdict: string;
  /** 判不了的原因（verdict === 判不了 时非空） */
  reason: string;
  /** 基线 program 中落在 PATHS(X) 下的文件数 */
  removedFileCount: number;
  /** 编译域中落在 PATHS(Y) 下的文件数 */
  targetFileCount: number;
  /** 摘除后新增的诊断条数（落在 Y 的文件集内） */
  newErrorCountInTarget: number;
  /** 摘除后新增的诊断条数（全仓，供交叉核对） */
  newErrorCountTotal: number;
  /** 摘除后新增、且落在 Y 文件集内的诊断（**逐条点名**） */
  newErrors: DiagRow[];
}

/** 一次完整跑的机器可读产物 */
export interface ExileReport {
  /** 锚（真源路径） */
  source: string;
  /** 仓根 */
  root: string;
  /** 编译域根文件数（基线 program） */
  baselineRootFileCount: number;
  /** 基线诊断条数 */
  baselineDiagCount: number;
  /** 逐行结果 */
  rows: ExileRow[];
  /** 口径说明（打印用） */
  notes: string[];
}

/** 🔴 路径匹配器：把登记件里的一条 `paths` 字面量变成"文件是否落在它下面"的谓词 */
export function globToRegExp(pattern: string): RegExp {
  const special = new Set(['\\', '^', '$', '.', '|', '?', '+', '(', ')', '[', ']', '{', '}']);
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (special.has(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * 单条 `paths` 字面量 ⇒ 谓词（入参 = 仓根相对 POSIX 路径）。
 *
 * @contract
 *   @input  pattern（登记件里的原样字面量，**禁规范化** —— 见 `block-paths-core.ts` 约束③）
 *   @output `(rel: string) => boolean`
 *   @degraded 不适用（纯函数）
 */
export function pathMatcher(pattern: string): (rel: string) => boolean {
  if (pattern.endsWith('/')) {
    const dir = pattern.slice(0, -1);
    return (rel) => rel === dir || rel.startsWith(pattern);
  }
  if (pattern.includes('*')) {
    const re = globToRegExp(pattern);
    return (rel) => re.test(rel);
  }
  return (rel) => rel === pattern || rel.startsWith(pattern + '/');
}

/** 🔴 字面包含（近似）：`a` 是否覆盖 `b`（= 每条匹配 b 的路径也匹配 a） */
export function pathCovers(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith('/') && b.startsWith(a)) return true;
  if (a.endsWith('/**')) {
    const pre = a.slice(0, -3);
    if (b === pre || b.startsWith(pre)) return true;
  }
  return false;
}

/** 两块之间是否存在字面包含（任一方向） */
export function hasEntanglement(pathsX: readonly string[], pathsY: readonly string[]): boolean {
  for (const a of pathsX) for (const b of pathsY) if (pathCovers(a, b) || pathCovers(b, a)) return true;
  return false;
}

/** 把绝对路径变成仓根相对 POSIX 路径（不在仓内 ⇒ 返回 null） */
export function toRepoRel(root: string, abs: string): string | null {
  const r = relative(root, resolve(abs));
  if (r === '' || r.startsWith('..')) return null;
  return sep === '/' ? r : r.split(sep).join('/');
}

/** 诊断拍平（只留非 lib 的、有文件位置的） */
function flattenDiagnostics(diags: readonly ts.Diagnostic[], root: string): DiagRow[] {
  const out: DiagRow[] = [];
  for (const d of diags) {
    if (d.file === undefined || d.start === undefined) continue;
    const rel = toRepoRel(root, d.file.fileName);
    if (rel === null) continue;
    if (rel.startsWith('node_modules/')) continue;
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    out.push({
      file: rel,
      line: pos.line + 1,
      col: pos.character + 1,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    });
  }
  return out;
}

/** 诊断去重键（供差集用） */
export function diagKey(d: DiagRow): string {
  return `${d.file}:${d.line}:${d.col}:${d.code}:${d.message}`;
}

/** 解析后的 tsconfig（供建 program 用） */
interface ParsedConfig {
  options: ts.CompilerOptions;
  fileNames: string[];
}

/**
 * 读仓根 `tsconfig.json`（🔴 缺省与 `npm run lint` **同一份配置**，禁另造编译选项）。
 *
 * @contract
 *   @input  root（仓根绝对路径）
 *   @output `{options, fileNames}`
 *   @degraded 读不到 / 解析报错 ⇒ 抛（调用方一律转 exit 2）—— 禁"空 program 当通过"
 */
export function readTsConfig(root: string): ParsedConfig {
  const cfgPath = join(root, 'tsconfig.json');
  if (!existsSync(cfgPath)) throw new Error(`找不到 tsconfig：${cfgPath}`);
  const cfgFile = ts.readConfigFile(cfgPath, (p) => ts.sys.readFile(p));
  if (cfgFile.error !== undefined) {
    throw new Error(`读 tsconfig 失败：${ts.flattenDiagnosticMessageText(cfgFile.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    cfgFile.config,
    ts.sys,
    root,
    { noEmit: true, incremental: false },
    cfgPath,
  );
  return { options: parsed.options, fileNames: parsed.fileNames.map((f) => resolve(f)) };
}

/** 一次 program 跑的结果 */
export interface ProgramRun {
  /** program 里的（仓内）源文件相对路径 */
  files: string[];
  /** 诊断行 */
  diagnostics: DiagRow[];
}

/**
 * 建一次 program 并取诊断。
 *
 * @contract
 *   @input  cfg（`readTsConfig` 产物）｜ isExiled（可选，谓词：绝对路径 ⇒ 是否"隐藏"）
 *   @output `{files, diagnostics}`
 *   @degraded 不适用（异常向上抛，调用方转 exit 2）
 *
 * 🔴 实现要点：**在 `createProgram` 之前**替换 host 的 `fileExists`/`readFile`/`getSourceFile`
 *    —— 模块解析走的就是这三个口；只改 ROOT 列表是**不够**的（被 import 的文件照样会被拉进来）。
 */
export function runProgram(cfg: ParsedConfig, root: string, isExiled?: (abs: string) => boolean): ProgramRun {
  const host = ts.createCompilerHost(cfg.options, true);
  if (isExiled !== undefined) {
    const origFileExists = host.fileExists.bind(host);
    const origReadFile = host.readFile.bind(host);
    const origGetSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (f: string) => (isExiled(resolve(f)) ? false : origFileExists(f));
    host.readFile = (f: string) => (isExiled(resolve(f)) ? undefined : origReadFile(f));
    host.getSourceFile = (f: string, lv: ts.ScriptTarget, oe?: boolean, sc?: ts.SourceFile[]) =>
      isExiled(resolve(f)) ? undefined : origGetSourceFile(f, lv, oe, sc);
  }
  const rootNames = cfg.fileNames.filter((f) => (isExiled === undefined ? true : !isExiled(f)));
  const program = ts.createProgram(rootNames, cfg.options, host);
  const files: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toRepoRel(root, sf.fileName);
    if (rel === null || rel.startsWith('node_modules/')) continue;
    files.push(rel);
  }
  return { files, diagnostics: flattenDiagnostics(ts.getPreEmitDiagnostics(program), root) };
}

/** 逐块 `paths` 视图（块 id ⇒ 字面量数组） */
export function blockPathsOf(view: RegistryView): { byBlock: Record<string, string[]>; error: string } {
  const computed = computeBlockPaths(view);
  if (!computed.ok) {
    return { byBlock: {}, error: computed.diag.errors.join(' / ') };
  }
  return { byBlock: computed.byBlock, error: '' };
}

/**
 * 跑一档摘除（单块）——**本模块的主算法**。
 *
 * @contract
 *   @input  root｜cfg｜baseline（基线 program 结果）｜byBlock（逐块 paths）｜exileId
 *   @output `ExileRow[]`（该 X 对每个 Y 一行；`--only-block` 时只一行）
 *   @degraded 不适用（判定"判不了"是**结果**，不是异常）
 */
export function runExile(
  root: string,
  cfg: ParsedConfig,
  baseline: ProgramRun,
  byBlock: Record<string, string[]>,
  exileId: string,
): ExileRow[] {
  const pathsX = byBlock[exileId] ?? [];
  const matchersX = pathsX.map(pathMatcher);
  const isExiled = (abs: string): boolean => {
    const rel = toRepoRel(root, abs);
    if (rel === null) return false;
    return matchersX.some((m) => m(rel));
  };
  const blocked = runProgram(cfg, root, isExiled);

  const removedFileCount = baseline.files.filter((f) => matchersX.some((m) => m(f))).length;
  const baseKeys = new Set(baseline.diagnostics.map(diagKey));
  const newDiags = blocked.diagnostics.filter((d) => !baseKeys.has(diagKey(d)));

  const rows: ExileRow[] = [];
  for (const targetId of Object.keys(byBlock).sort()) {
    if (targetId === exileId) continue;
    const pathsY = byBlock[targetId] ?? [];
    const matchersY = pathsY.map(pathMatcher);
    const targetFiles = baseline.files.filter((f) => matchersY.some((m) => m(f)));
    const inTarget = newDiags.filter((d) => matchersY.some((m) => m(d.file)));

    let verdict = VERDICT_INDEPENDENT;
    let reason = '';
    if (removedFileCount === 0) {
      verdict = VERDICT_UNJUDGEABLE;
      reason = REASON_NO_FILE_REMOVED;
    } else if (targetFiles.length === 0) {
      verdict = VERDICT_UNJUDGEABLE;
      reason = REASON_NO_BLOCK_FILES;
    } else if (hasEntanglement(pathsX, pathsY)) {
      verdict = VERDICT_UNJUDGEABLE;
      reason = REASON_ENTANGLED;
    } else if (inTarget.length > 0) {
      verdict = VERDICT_DEPENDENT;
    }

    rows.push({
      exile: exileId,
      target: targetId,
      verdict,
      reason,
      removedFileCount,
      targetFileCount: targetFiles.length,
      newErrorCountInTarget: inTarget.length,
      newErrorCountTotal: newDiags.length,
      newErrors: inTarget,
    });
  }
  return rows;
}

/** 人类可读渲染 */
export function renderRows(report: ExileReport): string {
  const lines: string[] = [];
  for (const n of report.notes) lines.push(`  ${n}`);
  lines.push(
    `ⓘ 基线：编译域根文件 ${report.baselineRootFileCount} 个 / 诊断 ${report.baselineDiagCount} 条` +
      `（🔴 判据一律取**差集**，基线红不算 Y 的依赖）`,
  );
  let last = '';
  for (const r of report.rows) {
    if (r.exile !== last) {
      lines.push(`── 摘 ${r.exile}（编译域内 ${r.removedFileCount} 个文件被隐藏）`);
      last = r.exile;
    }
    const tag = r.verdict === VERDICT_DEPENDENT ? '🔴' : r.verdict === VERDICT_INDEPENDENT ? '🟢' : '⚠️';
    lines.push(
      `  ${tag} ${r.target}：${r.verdict}` +
        (r.reason === ''
          ? `（Y 编译域 ${r.targetFileCount} 文件，新增 error TS ${r.newErrorCountInTarget} 条）`
          : `（${r.reason}）`),
    );
    for (const e of r.newErrors.slice(0, 5)) {
      lines.push(`        ${e.file}(${e.line},${e.col}): error TS${e.code}: ${e.message.slice(0, 110)}`);
    }
    if (r.newErrors.length > 5) lines.push(`        … 另 ${r.newErrors.length - 5} 条（见 --json / --out）`);
  }
  return lines.join('\n');
}

/** CLI 主体（🔴 显式导出：测试直接调它） */
export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const rootArg = readFlag(argv, '--root');
  const root = rootArg !== '' ? resolve(rootArg) : locateRepoRoot();
  if (root === null) {
    process.stderr.write('❌ 探针判不了（exit 2）：定位不到仓根（含 tsconfig.json 与真源）\n');
    return EXIT_UNJUDGEABLE;
  }

  const { sourceArg, error } = resolveSourceArg(argv);
  if (error !== '') {
    process.stderr.write(`❌ 探针判不了（exit 2）：${error}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const loaded = await loadRegistryView(sourceArg);
  if (!loaded.ok || loaded.view === null) {
    process.stderr.write(`❌ 探针判不了（exit 2）：${loaded.error}\n`);
    return EXIT_UNJUDGEABLE;
  }
  const { byBlock, error: compErr } = blockPathsOf(loaded.view);
  if (compErr !== '') {
    process.stderr.write(`❌ 探针判不了（exit 2）：块级 paths 算不出来：${compErr}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const exileArg = readFlag(argv, '--exile');
  const allMode = argv.includes('--all');
  const onlyBlock = readFlag(argv, '--only-block');
  if (exileArg === '' && !allMode) {
    process.stderr.write('❌ 探针判不了（exit 2）：必须给 `--exile <BlockId>` 或 `--all`\n');
    return EXIT_UNJUDGEABLE;
  }

  let cfg: ParsedConfig;
  try {
    cfg = readTsConfig(root);
  } catch (err) {
    process.stderr.write(`❌ 探针判不了（exit 2）：${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const baseline = runProgram(cfg, root);
  const notes = [
    `ⓘ 真源 = ${loaded.sourcePath}`,
    `ⓘ 仓根 = ${root}（编译选项取同目录 tsconfig.json —— 与 \`npm run lint\` 同一份）`,
  ];

  const exiles = allMode ? Object.keys(byBlock).sort() : [exileArg];
  const rows: ExileRow[] = [];
  for (const x of exiles) {
    if (!(x in byBlock)) {
      process.stderr.write(`❌ 探针判不了（exit 2）：真源里没有块 「${x}」\n`);
      return EXIT_UNJUDGEABLE;
    }
    const one = runExile(root, cfg, baseline, byBlock, x).filter(
      (r) => onlyBlock === '' || r.target === onlyBlock,
    );
    rows.push(...one);
    process.stderr.write(`  ⓘ 摘 ${x}：${one.length} 行已判（隐藏文件 ${one[0]?.removedFileCount ?? 0} 个）\n`);
  }

  const report: ExileReport = {
    source: loaded.sourcePath,
    root,
    baselineRootFileCount: baseline.files.length,
    baselineDiagCount: baseline.diagnostics.length,
    rows,
    notes,
  };

  const outFile = readFlag(argv, '--out');
  if (outFile !== '') {
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
    process.stderr.write(`  ⓘ 机器可读结果已落 ${resolve(outFile)}\n`);
  }

  if (argv.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    process.stdout.write(renderRows(report) + '\n');
    const red = rows.filter((r) => r.verdict === VERDICT_DEPENDENT).length;
    const green = rows.filter((r) => r.verdict === VERDICT_INDEPENDENT).length;
    const unk = rows.filter((r) => r.verdict === VERDICT_UNJUDGEABLE).length;
    process.stdout.write(`SUMMARY: 红(依赖成立) ${red} ｜ 绿(无依赖) ${green} ｜ 判不了 ${unk} ｜ 共 ${rows.length} 行\n`);
  }
  return rows.some((r) => r.verdict === VERDICT_UNJUDGEABLE) ? EXIT_MISMATCH : EXIT_OK;
}

/** 读 `--flag value`（缺省返回空串） */
function readFlag(argv: readonly string[], flag: string): string {
  const i = argv.indexOf(flag);
  if (i < 0) return '';
  return argv[i + 1] ?? '';
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
    } catch (err) {
      // 非致命：非常规 URL 形态下 `fileURLToPath` 会抛 ⇒ **无法断定**是否被直接调用。
      // 处置 = 显式降级为"不自动跑 main" ＋ stderr 留痕（禁空 catch —— 铁律 24）。
      process.stderr.write(
        `ⓘ 降级：无法判定是否直接调用（${err instanceof Error ? err.message : String(err)}）` +
          ` ⇒ 不自动执行 main（作为模块被 import 时的预期行为）\n`,
      );
      return false;
    }
  })();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`❌ 探针自身异常（exit 2）：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(EXIT_UNJUDGEABLE);
    });
}
