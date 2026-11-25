#!/usr/bin/env node
/**
 * scripts/ingest-v0/extract.mjs — agentic ingest v0 的 **V2 抽取层 CLI**（#1500）。
 *
 * 做什么（一条命令串起 C1–C8）：
 *   目录/ZIP → V1 发现层（supported 文件）→ 规则抽取（对象/关系/指标，每条带 sourceRef）
 *   → 合并去重 → 经产品 `persistFacts` + 指标 writer 落隔离库 → `synova_context_get` 反查根对象 count>0
 *   → 写 extract-report.json + 一行摘要。
 *
 * 不做（任务书硬边界）：
 *   · 不用大模型、不联网外发（C1）；不写生产库（默认 `%TEMP%/ingest-v0/synova.db`）；
 *   · 不直写 scan_* / graph_* 表（C3；唯一写入口 = `lib/persist.mjs`）；
 *   · 不改 V1 discover 行为；不动 src/**。
 *
 * 退出码（三态）：`0` 成功（对象/关系/指标齐备 ∧ C4 count>0）｜`1` 已执行但结果不成立
 *   （INSUFFICIENT_INGEST／C4 count=0／落库失败／资源超限）｜`2` 判不了（参数/输入/输出/运行环境）。
 *
 * 用法：
 *   node scripts/ingest-v0/extract.mjs --source <目录|zip> [--out <report.json>] [--db <synova.db>] [--graph <orgId>]
 *   （在沙箱/无 tsx 环境会自动以 Node 原生 TS 参数重启自身；正常开发机也可 `npx tsx` 运行）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { IngestError, toIngestError } from './lib/errors.mjs';
import { loadDocument } from './lib/extract/documents.mjs';
import { extractFactsFromDocument } from './lib/extract/facts.mjs';
import { aggregateFacts, listMissing, selectRoot } from './lib/extract/aggregate.mjs';
import { buildExtractReport, summarize, verifyRead } from './lib/extract/report.mjs';
import { defaultRunDir, prepareSource } from './lib/extract/source.mjs';
import { writeReport } from './discover.mjs';

const SELF = fileURLToPath(import.meta.url);
const IS_MAIN = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SELF);

// ── 环境自举：Node 原生类型擦除 + TS 解析钩子（不改源码、不引 tsx/esbuild）──
// 只在"直接执行本文件"时触发；被测试 import 时不重启进程。
if (IS_MAIN && process.env.INGEST_V0_BOOTSTRAPPED !== '1' && !process.execArgv.includes('--experimental-transform-types')) {
  const registerPath = fileURLToPath(new URL('./lib/ts-register.mjs', import.meta.url));
  const relativeSelf = path.relative(process.cwd(), SELF).replace(/\\/g, '/');
  const selfArg = relativeSelf.startsWith('..') ? pathToFileURL(SELF).href : `./${relativeSelf}`;
  const registerUrl = pathToFileURL(registerPath).href;
  const child = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', '--import', registerUrl, selfArg, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, INGEST_V0_BOOTSTRAPPED: '1' } },
  );
  if (child.error !== undefined && child.error !== null) {
    process.stderr.write(`degraded: ${JSON.stringify({ code: 'E_ENV', message: `无法以 TS 运行参数重启: ${child.error.message}` })}\n`);
    process.exit(2);
  }
  process.exit(child.status === null ? 2 : child.status);
}

const USAGE = [
  '用法: node scripts/ingest-v0/extract.mjs --source <目录|zip> [--out <report.json>] [--db <synova.db>] [--graph <orgId>]',
  '默认: --db %TEMP%/ingest-v0/synova.db  --graph default  --out <runDir>/extract-report.json',
].join('\n');

/**
 * 解析 CLI 参数（纯；不碰文件系统）。
 *
 * @input  argv —— `process.argv.slice(2)`
 * @output `{help:true}` 或 `{source, out?, db?, graph}`
 * @degraded 无：参数错显式 `E_BAD_ARGS`（不猜默认意图）
 * @authority 开关白名单只由本函数给出（未知开关拒绝）
 * @not_here 不校验路径存在（`prepareSource` 负责）
 * @error `IngestError(E_BAD_ARGS, phase='args')` —— 缺 `--source`／重复／未知开关／缺取值
 */
export function parseArgs(argv) {
  let source;
  let out;
  let db;
  let graph = 'default';
  let graphSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    const takeValue = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new IngestError('E_BAD_ARGS', 'args', `${String(flag)} 缺少取值`);
      }
      index += 1;
      return next;
    };
    if (flag === '--source') {
      if (source !== undefined) throw new IngestError('E_BAD_ARGS', 'args', '--source 重复');
      source = takeValue();
      continue;
    }
    if (flag === '--out') {
      if (out !== undefined) throw new IngestError('E_BAD_ARGS', 'args', '--out 重复');
      out = takeValue();
      continue;
    }
    if (flag === '--db') {
      if (db !== undefined) throw new IngestError('E_BAD_ARGS', 'args', '--db 重复');
      db = takeValue();
      continue;
    }
    if (flag === '--graph') {
      if (graphSet) throw new IngestError('E_BAD_ARGS', 'args', '--graph 重复');
      graph = takeValue();
      graphSet = true;
      continue;
    }
    throw new IngestError('E_BAD_ARGS', 'args', `未知开关: ${String(flag)}（--help 查看用法）`);
  }
  if (source === undefined) throw new IngestError('E_BAD_ARGS', 'args', '缺少 --source <目录|zip>');
  if (graph.length === 0) throw new IngestError('E_BAD_ARGS', 'args', '--graph 不能为空');
  return {
    help: false,
    source: path.resolve(source),
    out: out === undefined ? undefined : path.resolve(out),
    db: db === undefined ? undefined : path.resolve(db),
    graph,
  };
}

/**
 * 退出码映射（三态；参数/输入/输出/环境 ⇒ 2；其余已执行未成立 ⇒ 1）。
 *
 * @input  status —— `'ok'|'insufficient'|'failed'|'resource_limit'`；error —— `IngestError|null`
 * @output 0 / 1 / 2
 * @degraded 无
 * @authority 映射只由本函数给出（main 不另写分支）
 * @not_here 不打印、不写文件
 * @error 无
 */
export function exitCodeFor(status, error) {
  if (error !== null && error !== undefined) {
    if (['E_BAD_ARGS', 'E_INPUT_UNREADABLE', 'E_OUTPUT_WRITE', 'E_ENV'].includes(error.code)) return 2;
    return 1;
  }
  return status === 'ok' ? 0 : 1;
}

/**
 * 组装 `INSUFFICIENT_INGEST` 明细（C6：缺什么说什么，不编造）。
 *
 * @input  missing —— 缺项数组；stats —— 抽取统计（用于 reason 里给计数）
 * @output `{code:'INSUFFICIENT_INGEST', missing, detail}`
 * @degraded 无
 * @authority 文案与字段由本函数给出
 * @not_here 不补数、不降级成成功
 * @error 无
 */
export function insufficientDetail(missing, stats) {
  return {
    code: 'E_INSUFFICIENT_INGEST',
    missing,
    detail: {
      objects: stats?.objects?.total ?? 0,
      relations: stats?.relations?.total ?? 0,
      metrics: stats?.metrics?.total ?? 0,
      missingPeriod: (stats?.objects?.missingPeriod ?? 0) + (stats?.metrics?.missingPeriod ?? 0),
      missingSourceRef: (stats?.objects?.missingSourceRef ?? 0) + (stats?.metrics?.missingSourceRef ?? 0),
    },
  };
}

/**
 * 主流程（可注入时钟/临时根/落库函数；`main` 只做 process 交互）。
 *
 * @input  argv —— 参数数组；deps.now/`deps.tempRoot`/`deps.persistAndVerify`（测试注入）
 * @output `{exitCode, report, outputPath, error, help?}`
 * @degraded 无：失败/不足都落成显式 `status` + `error`，不静默成 `ok`
 * @authority 状态判定顺序：资源超限 → 输入失败 → 抽取 → 落库+C4 → 缺项判定
 * @not_here 不 `process.exit`（由 `main` 决定，便于测试）
 * @error 不抛：内部异常归一并转成退出码
 */
export async function runExtract(argv, deps = {}) {
  const now = deps.now ?? (() => new Date());
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    const error = toIngestError(err, 'args');
    return { exitCode: exitCodeFor('failed', error), report: null, outputPath: '', error };
  }
  if (parsed.help === true) return { exitCode: 0, report: null, outputPath: '', help: true };

  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const tempRoot = deps.tempRoot ?? os.tmpdir();
  const { runDir } = defaultRunDir(startedAtDate, tempRoot);
  fs.mkdirSync(runDir, { recursive: true });
  const outputPath = parsed.out ?? path.join(runDir, 'extract-report.json');
  const dbPath = parsed.db ?? path.join(tempRoot, 'ingest-v0', 'synova.db');

  let prepared;
  try {
    prepared = (deps.prepareSource ?? prepareSource)({
      sourcePath: parsed.source,
      runDir,
      clock: deps.clock,
      limits: deps.limits,
      zipLimits: deps.zipLimits,
    });
  } catch (err) {
    const error = toIngestError(err, 'scan');
    const status = error.code === 'E_RESOURCE_LIMIT' ? 'resource_limit' : 'failed';
    const report = buildExtractReport({
      source: parsed.source,
      sourceKind: null,
      graph: parsed.graph,
      dbPath,
      status,
      runDir,
      prepared: error.partial === null || error.partial === undefined ? null : { stats: error.partial.stats, skipped: error.partial.skipped },
      aggregated: null,
      persist: null,
      context: null,
      insufficient: null,
      error,
      startedAt,
      finishedAt: now().toISOString(),
      durationMs: now().getTime() - startedAtDate.getTime(),
    });
    return finish(report, outputPath, exitCodeFor(status, error), error);
  }

  const loaded = [];
  const results = [];
  for (const file of prepared.files) {
    let document;
    try {
      document = (deps.loadDocument ?? loadDocument)({ localPath: file.localPath, displayPath: file.displayPath, type: file.type });
    } catch (err) {
      document = {
        kind: file.type,
        displayPath: file.displayPath,
        localPath: file.localPath,
        text: '',
        paragraphs: [],
        tables: [],
        truncated: false,
        corrupt: true,
        corruptReason: err instanceof Error ? err.message : String(err),
      };
    }
    loaded.push(document);
    try {
      const facts = extractFactsFromDocument(document, {});
      results.push({ doc: document, facts });
    } catch (err) {
      results.push({ doc: document, facts: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const aggregated = aggregateFacts(results);
  const missing = listMissing(aggregated, results);
  const root = selectRoot(aggregated);
  const fileIndex = new Map(prepared.files.map(file => [file.displayPath, file.localPath]));
  const loadedByPath = new Map(loaded.map(document => [document.displayPath, document]));
  const verification = verifyRead(aggregated, fileIndex, loadedByPath);

  let status = 'ok';
  let error = null;
  let insufficient = null;
  let persist = null;
  let context = null;

  if (aggregated.objects.length === 0) {
    status = 'insufficient';
    insufficient = insufficientDetail(missing.length > 0 ? missing : ['objects', 'relations', 'metrics'], aggregated.stats);
    error = new IngestError('E_INSUFFICIENT_INGEST', 'extract', `无任何可落库事实（缺: ${insufficient.missing.join('/')}）`, { detail: insufficient.detail });
  } else {
    try {
      const persistAndVerify = deps.persistAndVerify ?? (await import('./lib/persist.mjs')).persistAndVerify;
      const persisted = await persistAndVerify({
        dbPath,
        graph: parsed.graph,
        runId: `ingest-v0-${startedAtDate.getTime()}`,
        objects: aggregated.objects,
        relations: aggregated.relations,
        metrics: aggregated.metrics,
        rootBusinessKey: root === null ? null : root.rootBusinessKey,
        observedAt: startedAt,
      });
      persist = persisted.persist;
      context = persisted.context;
      if (missing.length > 0) {
        status = 'insufficient';
        insufficient = insufficientDetail(missing, aggregated.stats);
        error = new IngestError('E_INSUFFICIENT_INGEST', 'extract', `抽取结果不完整（缺: ${missing.join('/')}）`, { detail: insufficient.detail });
      } else if (root === null) {
        status = 'insufficient';
        insufficient = insufficientDetail(['relations'], aggregated.stats);
        error = new IngestError('E_INSUFFICIENT_INGEST', 'extract', '无关系 ⇒ 无法做 C4 反查（不判成功）', { detail: insufficient.detail });
      }
    } catch (err) {
      const ingestError = toIngestError(err, 'persist');
      status = ingestError.code === 'E_RESOURCE_LIMIT' ? 'resource_limit' : 'failed';
      error = ingestError;
      if (ingestError.code === 'E_C4_ZERO') {
        const detail = ingestError.detail;
        context = detail !== null && typeof detail === 'object' && 'context' in detail ? detail.context : null;
      }
    }
  }

  const finishedAtDate = now();
  const report = buildExtractReport({
    source: parsed.source,
    sourceKind: prepared.kind,
    graph: parsed.graph,
    dbPath,
    status,
    runDir,
    prepared: { stats: prepared.stats, skipped: prepared.skipped, files: prepared.files.length },
    aggregated,
    persist,
    context,
    verify: verification,
    insufficient,
    error,
    startedAt,
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
  });
  return finish(report, outputPath, exitCodeFor(status, error), error);
}

/**
 * 写报告并返回结果（`runExtract` 的公共收尾）。
 *
 * @input  report/outputPath/exitCode/error
 * @output `{exitCode, report, outputPath, error}`
 * @degraded 无：报告写不进 ⇒ 追加 `E_OUTPUT_WRITE` 并改为退出码 2（判不了）
 * @authority 退出码优先按"报告可落盘"判定
 * @not_here 不打印
 * @error 无（错误以返回值表达）
 */
function finish(report, outputPath, exitCode, error) {
  try {
    writeReport(outputPath, report);
    return { exitCode, report, outputPath, error };
  } catch (err) {
    const writeError = toIngestError(err, 'output');
    return { exitCode: 2, report, outputPath, error: writeError };
  }
}

/**
 * CLI 入口（process 交互）。
 *
 * @input  argv —— `process.argv.slice(2)`
 * @output 无（stdout 打一行摘要；失败时 stderr 打 `degraded:` + 结构化错误；设置 exitCode）
 * @degraded 无：失败一律写明 code/phase
 * @authority 退出码来自 `runExtract().exitCode`
 * @not_here 不做业务判断
 * @error 无（不抛）
 */
async function main(argv) {
  const result = await runExtract(argv);
  if (result.help === true) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = 0;
    return;
  }
  if (result.report === null) {
    process.stderr.write(`degraded: ${JSON.stringify(result.error === null || result.error === undefined ? {} : result.error.toJSON())}\n`);
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

if (IS_MAIN) {
  await main(process.argv.slice(2));
}
