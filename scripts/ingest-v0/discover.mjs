#!/usr/bin/env node
/**
 * scripts/ingest-v0/discover.mjs — agentic ingest v0 的 **V1 发现层** CLI（#1492）。
 *
 * 做什么：给一个 `--source <目录>`，**自己遍历**，把里面每个常规文件分成
 *   supported[]（可进入后续抽取）/ unsupported[]（类型不支持，带 reason）/ skipped[]（带 reason），
 * 并落盘 report.json：`{supported, unsupported, skipped, totals:{files,bytes,byType}}`。
 *
 * 边界（任务书 B 段，缺一不算完成）：
 *   · 不联网、不打开文件内容、不执行宏/脚本/嵌入对象/文档外链（本层连内容都不读）；
 *   · ZIP **只枚举中央目录**，不解压；条目越界/加密/超大逐条记 skipped；
 *   · 符号链接 / junction 不跟随、不递归 ⇒ skipped{reason:'symlink'}；
 *   · 资源上限（可参数覆盖）：文件数 ≤5000、总字节 ≤500MB、单文件 ≤50MB、递归深度 ≤8、总时长 ≤10min；
 *     累计型超限 ⇒ **立即停** 并报 `E_RESOURCE_LIMIT`（单文件超大按 §6 记 skipped 后继续，见 budget.mjs）；
 *   · 只用本进程新建的临时输出目录（默认 `%TEMP%/ingest-v0/<stamp>/`），**不清理任何既有目录**；
 *   · 「全部 unsupported」**不算成功**（`status=no_supported_input`，退出码 1）。
 *
 * 退出码（三态）：`0` 发现成功（supported>0）｜`1` 已执行但结果不成立（超限／零支持项／内部错误）｜
 *                 `2` 判不了（参数错／输入不可读／报告写不进）。
 *
 * 用法：
 *   node scripts/ingest-v0/discover.mjs --source <目录> [--out <report.json>]
 *        [--max-files N] [--max-total-bytes N] [--max-file-bytes N] [--max-depth N] [--max-duration-ms N]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INGEST_ERROR_CODES, IngestError, toIngestError } from './lib/errors.mjs';
import { createBudget, DEFAULT_LIMITS } from './lib/budget.mjs';
import { scanTree } from './lib/walk.mjs';
import { annotateZipFiles } from './lib/zip-scan.mjs';
import { buildReport, deriveStatus, summarize } from './lib/report.mjs';

/** 数值型开关 → 限额键（白名单；未知开关一律 E_BAD_ARGS，fail-closed） */
const NUMERIC_FLAGS = Object.freeze({
  '--max-files': 'maxFiles',
  '--max-total-bytes': 'maxTotalBytes',
  '--max-file-bytes': 'maxFileBytes',
  '--max-depth': 'maxDepth',
  '--max-duration-ms': 'maxDurationMs',
});

const USAGE = [
  '用法: node scripts/ingest-v0/discover.mjs --source <目录> [--out <report.json>]',
  '      [--max-files N] [--max-total-bytes N] [--max-file-bytes N] [--max-depth N] [--max-duration-ms N]',
  `默认上限: files=${String(DEFAULT_LIMITS.maxFiles)} bytes=${String(DEFAULT_LIMITS.maxTotalBytes)}`,
  `          file=${String(DEFAULT_LIMITS.maxFileBytes)} depth=${String(DEFAULT_LIMITS.maxDepth)} durationMs=${String(DEFAULT_LIMITS.maxDurationMs)}`,
].join('\n');

/**
 * 解析 CLI 参数（纯；不做 I/O）。
 *
 * @input  argv —— `process.argv.slice(2)`
 * @output `{help:true}` 或 `{source, out, limits}`（`limits` 只含被显式覆盖的键）
 * @degraded 无：参数错 → 显式 `E_BAD_ARGS`（**不猜默认意图**）
 * @authority 开关白名单只由本函数给出（`NUMERIC_FLAGS`；未知开关拒绝）
 * @not-here 不校验路径是否存在（由 `resolveSource` 负责）
 * @error `IngestError(E_BAD_ARGS, phase='args')` —— 缺 `--source`／数值非法（须为正整数）／重复／未知开关
 */
export function parseArgs(argv) {
  const limits = {};
  let source;
  let out;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    const takeValue = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', `${String(flag)} 缺少取值`);
      }
      index += 1;
      return next;
    };
    if (flag === '--source') {
      if (source !== undefined) throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', '--source 重复');
      source = takeValue();
      continue;
    }
    if (flag === '--out') {
      if (out !== undefined) throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', '--out 重复');
      out = takeValue();
      continue;
    }
    const limitKey = NUMERIC_FLAGS[flag];
    if (limitKey !== undefined) {
      const raw = takeValue();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', `${String(flag)} 必须是正整数（实得 ${raw}）`);
      }
      if (limits[limitKey] !== undefined) {
        throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', `${String(flag)} 重复`);
      }
      limits[limitKey] = parsed;
      continue;
    }
    throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', `未知开关: ${String(flag)}（--help 查看用法）`);
  }
  if (source === undefined) throw new IngestError(INGEST_ERROR_CODES.BAD_ARGS, 'args', '缺少 --source <目录>');
  return { help: false, source: path.resolve(source), out: out === undefined ? undefined : path.resolve(out), limits };
}

/**
 * 校验 `--source`（I/O：只做 lstat）。
 *
 * @input  sourcePath —— 已 resolve 的绝对路径
 * @output 同一路径（通过校验）
 * @degraded 无
 * @authority 判据：存在 ∧ 是目录 ∧ **不是符号链接/junction**（发现层不跟随链接）
 * @not-here 不读目录内容、不递归
 * @error `IngestError(E_INPUT_UNREADABLE, phase='args')` —— 不存在/不是目录/是链接
 */
export function resolveSource(sourcePath) {
  let stat;
  try {
    stat = fs.lstatSync(sourcePath);
  } catch (err) {
    throw new IngestError(
      INGEST_ERROR_CODES.INPUT_UNREADABLE,
      'args',
      `--source 不可访问: ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new IngestError(INGEST_ERROR_CODES.INPUT_UNREADABLE, 'args', `--source 是符号链接（发现层不跟随链接）: ${sourcePath}`);
  }
  if (!stat.isDirectory()) {
    throw new IngestError(INGEST_ERROR_CODES.INPUT_UNREADABLE, 'args', `--source 不是目录: ${sourcePath}`);
  }
  return sourcePath;
}

/**
 * 生成默认输出路径（只用本进程新建的临时目录，不碰任何既有目录）。
 *
 * @input  now —— 注入时钟（便于测试）；tempRoot —— 临时根（缺省 `os.tmpdir()`）
 * @output `{outputPath, outputDir}` —— `<temp>/ingest-v0/run-<yyyymmdd-hhmmss-mmm>/report.json`
 * @degraded 无
 * @authority 目录名格式由本函数单一真源给出（下游只读取，不猜）
 * @not-here 不建目录、不写文件（`writeReport` 负责）
 * @error 无
 */
export function defaultOutputPath(now, tempRoot) {
  const stamp = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    '-',
    String(now.getMilliseconds()).padStart(3, '0'),
  ].join('');
  const outputDir = path.join(tempRoot ?? os.tmpdir(), 'ingest-v0', `run-${stamp}`);
  return { outputPath: path.join(outputDir, 'report.json'), outputDir };
}

/**
 * 写 report.json（UTF-8、两空格缩进、末尾换行）；父目录不存在则新建。
 *
 * @input  outputPath —— 目标绝对路径；report —— `buildReport` 产物
 * @output 无（通过即返回）
 * @degraded 无：写不进 ⇒ 显式失败（不假装"报告已落盘"）
 * @authority 编码固定 UTF-8（跨平台一致；报告含中文路径）
 * @not-here 不删任何既有文件/目录（只 `mkdir -p` 与覆盖同名报告）
 * @error `IngestError(E_OUTPUT_WRITE, phase='output')` —— 建目录/写文件失败
 */
export function writeReport(outputPath, report) {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' });
  } catch (err) {
    throw new IngestError(
      INGEST_ERROR_CODES.OUTPUT_WRITE,
      'output',
      `report.json 写出失败: ${outputPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 退出码映射（三态；`0` 成功 ∧ `1` 已执行但结果不成立 ∧ `2` 判不了）。
 *
 * @input  status —— `deriveStatus` 结果；error —— `IngestError | null`
 * @output 0 / 1 / 2
 * @degraded 无
 * @authority 映射只由本函数给出（main 不另写分支）
 * @not-here 不打印、不写文件
 * @error 无
 */
export function exitCodeFor(status, error) {
  if (error !== null && error !== undefined) {
    if (error.code === 'E_BAD_ARGS' || error.code === 'E_INPUT_UNREADABLE' || error.code === 'E_OUTPUT_WRITE') return 2;
    return 1;
  }
  return status === 'ok' ? 0 : 1;
}

/**
 * 主流程（可注入时钟与临时根，便于测试；`main` 只做 process 交互）。
 *
 * @input  argv —— 参数数组；deps.now —— `() => Date`；deps.tempRoot —— 临时根；deps.stdout —— `{write}`
 * @output `{exitCode, report, outputPath}`（report 为 null 仅在 --help／参数/输入校验失败时）
 * @degraded 无：任何失败都落成显式 `status` + `error`，不静默成 `ok`
 * @authority 状态/退出码只由 `deriveStatus`/`exitCodeFor` 给
 * @not-here 不 `process.exit`（由 `main` 决定，便于测试）
 * @error 不抛：内部异常归一并转成退出码（参数/输入错误在写报告前即返回 2）
 */
export function run(argv, deps = {}) {
  const now = deps.now ?? (() => new Date());
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    const error = toIngestError(err, 'args');
    return { exitCode: exitCodeFor('failed', error), report: null, outputPath: '', error };
  }
  if (parsed.help === true) {
    return { exitCode: 0, report: null, outputPath: '', help: true };
  }

  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const { outputPath } = parsed.out === undefined ? defaultOutputPath(startedAtDate, deps.tempRoot) : { outputPath: parsed.out };

  let sourcePath;
  try {
    sourcePath = resolveSource(parsed.source);
  } catch (err) {
    const error = toIngestError(err, 'args');
    return { exitCode: exitCodeFor('failed', error), report: null, outputPath, error };
  }

  const clock = deps.clock ?? (() => Date.now());
  const budget = createBudget(parsed.limits, clock());

  let error = null;
  let files = [];
  let skipped = [];
  let stats = { dirsVisited: 0, maxDepthSeen: 0 };
  try {
    const scanned = scanTree(sourcePath, { budget, clock });
    files = scanned.files;
    skipped = scanned.skipped;
    stats = scanned.stats;
  } catch (err) {
    error = toIngestError(err, 'scan');
    const partial = error.partial;
    if (partial !== null && partial !== undefined) {
      files = partial.files;
      skipped = partial.skipped;
      stats = partial.stats;
    }
  }

  let extraSkipped = [];
  if (error === null) {
    try {
      const annotated = annotateZipFiles(files, { maxFileBytes: budget.limits.maxFileBytes });
      files = annotated.files;
      extraSkipped = annotated.extraSkipped;
    } catch (err) {
      error = toIngestError(err, 'zip');
    }
  }

  const finishedAtDate = now();
  const status = deriveStatus({ supportedCount: files.filter(file => file.supported).length, error });
  const report = buildReport({
    source: sourcePath,
    status,
    files,
    walkSkipped: skipped,
    extraSkipped,
    limits: budget.limits,
    startedAt,
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
    error,
  });
  report.discovery = { dirsVisited: stats.dirsVisited, maxDepthSeen: stats.maxDepthSeen };

  try {
    writeReport(outputPath, report);
  } catch (err) {
    const writeError = toIngestError(err, 'output');
    return { exitCode: exitCodeFor('failed', writeError), report, outputPath, error: writeError };
  }

  return { exitCode: exitCodeFor(status, error), report, outputPath, error };
}

/**
 * CLI 入口（进程交互：stdout/stderr/exitCode）。
 *
 * @input  argv —— `process.argv.slice(2)`
 * @output 无（副作用：stdout 打一行摘要／用法；失败时 stderr 打 `degraded:` + 结构化错误 JSON；设置 exitCode）
 * @degraded 无：失败一律写明 code/phase/message（`degraded:` 前缀，铁律 11）
 * @authority 退出码来自 `run().exitCode`
 * @not-here 不做业务判断
 * @error 无（不抛）
 */
function main(argv) {
  const result = run(argv);
  if (result.help === true) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = 0;
    return;
  }
  if (result.report === null) {
    const error = result.error;
    process.stderr.write(`degraded: ${JSON.stringify(error === null || error === undefined ? {} : error.toJSON())}\n`);
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  process.stdout.write(`${summarize(result.report, result.outputPath)}\n`);
  if (result.error !== null && result.error !== undefined) {
    process.stderr.write(`degraded: ${JSON.stringify(result.error.toJSON())}\n`);
  }
  process.exitCode = result.exitCode;
}

// 只有被直接执行（`node discover.mjs ...`）才跑 CLI；被测试 import 时不执行（否则 import 即副作用）
const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (entryPath !== '' && path.resolve(modulePath) === entryPath) main(process.argv.slice(2));

