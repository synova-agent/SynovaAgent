/**
 * scripts/ingest-v0/lib/extract/source.mjs — 输入源准备：目录/ ZIP / 目录内嵌 ZIP 的**受控展开**（I/O 边界）。
 *
 * 复用（不重写）：
 *   · 目录遍历/类型分类/限额 = V1 `walk.mjs` + `classify.mjs` + `budget.mjs`（V1 已合入 PR #1493）；
 *   · ZIP 结构解析 = V1 `zip-entries.mjs`；
 *   · 解压安全语义 = 本票 `zip-extract.mjs`（C7 上限 + traversal/encrypted/oversized 逐条 skipped）。
 *
 * 语义：
 *   · `--source` 是目录 ⇒ 直接扫；是 `.zip` ⇒ 先安全解压到本 run 的临时目录再扫（条目名带 `zip!/entry` 前缀）；
 *   · 目录/压缩包里再遇到 `.zip` ⇒ 递归展开（最多 2 层，防 zip bomb 递归），超过层数记 `nested_zip_too_deep`；
 *   · C7 上限（条目 ≤5000、总解压 ≤200MB、单条 ≤50MB）**跨所有 ZIP 累计**，超限即停（`E_RESOURCE_LIMIT`）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IngestError } from '../errors.mjs';
import { createBudget } from '../budget.mjs';
import { scanTree } from '../walk.mjs';
import { extensionOf } from '../classify.mjs';
import { ZIP_EXTRACT_LIMITS, extractZip } from '../zip-extract.mjs';

/** 嵌套 ZIP 展开层数上限（防递归轰炸；两层足够覆盖"资料包里再放看板包"）。 */
const MAX_ZIP_DEPTH = 2;

/**
 * 生成一次 run 的临时目录（`<os.tmpdir()>/ingest-v0/run-<stamp>`；**只新建，不清理既有目录**）。
 *
 * @input  now —— 注入时钟；tempRoot —— 临时根（缺省 `os.tmpdir()`）
 * @output `{runDir, stamp}`（未创建；由调用方 `mkdirSync`）
 * @degraded 无
 * @authority 目录名格式只由本函数给出（与 V1 `defaultOutputPath` 同 stamp 口径）
 * @not_here 不建目录
 * @error 无
 */
export function defaultRunDir(now, tempRoot) {
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
  return { runDir: path.join(tempRoot ?? os.tmpdir(), 'ingest-v0', `run-${stamp}`), stamp };
}

/**
 * 判断 `--source` 是目录还是 ZIP（I/O：只 lstat）。
 *
 * @input  sourcePath —— 已 resolve 的绝对路径
 * @output 目录 ⇒ `'directory'`；`.zip` 常规文件 ⇒ `'zip'`
 * @degraded 无
 * @authority 判据 = lstat + 扩展名（不猜内容类型）
 * @not_here 不打开文件内容
 * @error `IngestError(E_INPUT_UNREADABLE, phase='args')` —— 不存在/链接/既非目录也非 zip
 */
export function resolveSourceKind(sourcePath) {
  let stat;
  try {
    stat = fs.lstatSync(sourcePath);
  } catch (err) {
    throw new IngestError('E_INPUT_UNREADABLE', 'args', `--source 不可访问: ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (stat.isSymbolicLink()) {
    throw new IngestError('E_INPUT_UNREADABLE', 'args', `--source 是符号链接（不跟随）: ${sourcePath}`);
  }
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile() && extensionOf(sourcePath) === '.zip') return 'zip';
  throw new IngestError('E_INPUT_UNREADABLE', 'args', `--source 必须是目录或 .zip 文件: ${sourcePath}`);
}

/**
 * 准备输入源：扫描目录、展开 ZIP，产出"可抽取文件清单 + 跳过清单"。
 *
 * @input  input.sourcePath —— 目录或 zip 绝对路径；input.runDir —— 本次 run 临时目录（须可写）
 *         input.limits —— V1 扫描限额覆盖；input.zipLimits —— C7 解压限额覆盖（测试用）
 *         input.clock —— 注入时钟
 * @output `{kind, files, skipped, stats, resourceLimit}`：
 *           files —— `[{localPath, displayPath, type, relPath, size}]`（只剩**非 zip** 的 supported 文件）
 *           skipped —— `[{path, reason, detail?}]`（目录层 + ZIP 条目层，含 traversal/encrypted/oversized）
 *           stats —— `{scannedFiles, supportedFiles, zipFiles, extractedFiles, extractedBytes, skippedCounts}`
 * @degraded 无：所有跳过都有 reason；不把跳过当成功
 * @authority 目录扫描复用 V1 `scanTree`；zip 语义复用 `extractZip`（C7 单一真源）
 * @not_here 不解析文件内容（`documents.mjs` 负责）；不清理既有目录
 * @error `IngestError(E_RESOURCE_LIMIT, phase='scan'|'zip')` —— 目录扫描/解压超限
 *        `IngestError(E_INPUT_UNREADABLE, phase='args'|'zip')` —— 源不可用/zip 损坏
 */
export function prepareSource(input) {
  const sourceKind = resolveSourceKind(input.sourcePath);
  const clock = input.clock ?? (() => Date.now());
  const budget = createBudget(input.limits ?? {}, clock());
  const zipLimits = { ...ZIP_EXTRACT_LIMITS, ...(input.zipLimits ?? {}) };

  const files = [];
  const skipped = [];
  const stats = {
    scannedFiles: 0,
    supportedFiles: 0,
    zipFiles: 0,
    extractedFiles: 0,
    extractedBytes: 0,
    skippedCounts: {},
  };
  const zipBudget = { entriesLeft: zipLimits.maxEntries, bytesLeft: zipLimits.maxTotalBytes };
  let extractIndex = 0;

  const recordSkip = (entry) => {
    stats.skippedCounts[entry.reason] = (stats.skippedCounts[entry.reason] ?? 0) + 1;
    skipped.push(entry);
  };

  /** 递归展开一个根目录（目录来源或已解压目录）。 */
  const expandRoot = (rootDir, displayPrefix, zipDepth) => {
    const scanned = scanTree(rootDir, { budget, clock });
    stats.scannedFiles += scanned.files.length;
    for (const entry of scanned.skipped) recordSkip({ path: `${displayPrefix}${entry.path}`, reason: entry.reason, detail: entry.detail });
    for (const file of scanned.files) {
      if (!file.supported) {
        recordSkip({ path: `${displayPrefix}${file.relPath}`, reason: file.reason ?? 'unsupported_type' });
        continue;
      }
      if (file.type !== 'zip') {
        stats.supportedFiles += 1;
        files.push({
          localPath: file.path,
          displayPath: `${displayPrefix}${file.relPath}`,
          relPath: file.relPath,
          type: file.type,
          size: file.size,
        });
        continue;
      }
      // 目录/包内的 zip：受控展开（层数超限 ⇒ 显式跳过，不递归）
      stats.zipFiles += 1;
      if (zipDepth >= MAX_ZIP_DEPTH) {
        recordSkip({ path: `${displayPrefix}${file.relPath}`, reason: 'nested_zip_too_deep', detail: { maxDepth: MAX_ZIP_DEPTH } });
        continue;
      }
      if (zipBudget.entriesLeft <= 0 || zipBudget.bytesLeft <= 0) {
        throw new IngestError('E_RESOURCE_LIMIT', 'zip', 'ZIP 累计上限已用尽', { partial: { files, skipped, stats } });
      }
      extractIndex += 1;
      const targetDir = path.join(input.runDir, `extracted-${String(extractIndex)}`);
      fs.mkdirSync(targetDir, { recursive: true });
      const result = extractZip(file.path, targetDir, { maxEntries: zipBudget.entriesLeft, maxTotalBytes: zipBudget.bytesLeft, maxFileBytes: zipLimits.maxFileBytes });
      if (!result.ok) {
        recordSkip({ path: `${displayPrefix}${file.relPath}`, reason: 'corrupt', detail: { corruptReason: result.corruptReason } });
        continue;
      }
      for (const item of result.skipped) {
        recordSkip({ path: `${displayPrefix}${file.relPath}!/${item.entryName}`, reason: item.reason, detail: item.detail });
      }
      stats.extractedFiles += result.stats.extractedFiles;
      stats.extractedBytes += result.stats.extractedBytes;
      zipBudget.entriesLeft -= result.stats.fileEntries;
      zipBudget.bytesLeft -= result.stats.extractedBytes;
      expandRoot(targetDir, `${displayPrefix}${file.relPath}!/`, zipDepth + 1);
    }
  };

  try {
    if (sourceKind === 'zip') {
      const targetDir = path.join(input.runDir, 'extracted-0');
      fs.mkdirSync(targetDir, { recursive: true });
      const result = extractZip(input.sourcePath, targetDir, { maxEntries: zipBudget.entriesLeft, maxTotalBytes: zipBudget.bytesLeft, maxFileBytes: zipLimits.maxFileBytes });
      if (!result.ok) {
        throw new IngestError('E_INPUT_UNREADABLE', 'zip', `ZIP 无法解压: ${input.sourcePath}: ${String(result.corruptReason ?? '')}`);
      }
      for (const item of result.skipped) {
        recordSkip({ path: `${path.basename(input.sourcePath)}!/${item.entryName}`, reason: item.reason, detail: item.detail });
      }
      stats.zipFiles += 1;
      stats.extractedFiles += result.stats.extractedFiles;
      stats.extractedBytes += result.stats.extractedBytes;
      zipBudget.entriesLeft -= result.stats.fileEntries;
      zipBudget.bytesLeft -= result.stats.extractedBytes;
      expandRoot(targetDir, `${path.basename(input.sourcePath)}!/`, 0);
    } else {
      expandRoot(input.sourcePath, '', 0);
    }
  } catch (err) {
    if (err instanceof IngestError) {
      if (err.partial === null || err.partial === undefined) err.partial = { files, skipped, stats };
      throw err;
    }
    throw new IngestError('E_INTERNAL', 'scan', err instanceof Error ? err.message : String(err), {
      detail: { cause: err instanceof Error ? err.name : typeof err },
    });
  }

  files.sort((left, right) => (left.displayPath < right.displayPath ? -1 : left.displayPath > right.displayPath ? 1 : 0));
  skipped.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { kind: sourceKind, files, skipped, stats };
}
