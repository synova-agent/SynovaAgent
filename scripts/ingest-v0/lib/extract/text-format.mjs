/**
 * scripts/ingest-v0/lib/extract/text-format.mjs — 文本类资料（txt/md/json）的**解码与表格/行级解析**（纯函数，零 I/O）。
 *
 * 为什么单列：真实客户资料的文本文件里已经出现「正文 + 大段 NUL 填充」的截断形态
 * （本票验收现场 17 个 HTML 中 8 个全 NUL、9 个尾部 NUL），解码层必须把"读到哪为止"
 * 变成一个**显式事实**（`truncated`），否则抽取层会把填充字节当内容、把半行当整行。
 */

import { squeezeWhitespace } from './html.mjs';

/**
 * 解码 UTF-8 文本，并在**首个 NUL 字节**处截断（NUL 不是合法 UTF-8 文本字符）。
 *
 * @input  buffer —— 文件原始字节
 * @output `{text, truncated, contentBytes, totalBytes}`：text 为 NUL 前内容；
 *         truncated = 存在 NUL 且其后仍有字节；contentBytes/totalBytes 用于报告
 * @degraded 无：全 NUL 文件 ⇒ `text=''` + `truncated=true`（调用方计 `corrupt`，不当成功）
 * @authority 截断判据 = "字节 0x00 首次出现位置"（UTF-8 文本中 NUL 只可能是填充/损坏）
 * @not-here 不做 BOM 之外的编码探测（GBK 等由调用方按"解不出"处理）
 * @error 无（纯处理）
 */
export function decodeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { text: '', truncated: false, contentBytes: 0, totalBytes: 0 };
  }
  const nulIndex = buffer.indexOf(0);
  const contentEnd = nulIndex === -1 ? buffer.length : nulIndex;
  let truncated = false;
  if (nulIndex !== -1) {
    for (let index = nulIndex; index < buffer.length; index += 1) {
      if (buffer[index] !== 0) {
        truncated = true;
        break;
      }
    }
  }
  let text = buffer.subarray(0, contentEnd).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return {
    text,
    truncated: truncated || nulIndex !== -1,
    contentBytes: contentEnd,
    totalBytes: buffer.length,
  };
}

/**
 * 解析 Markdown 管道表（`| a | b |` + 分隔行 `|---|---|`）。
 *
 * @input  text —— Markdown 文本
 * @output `[{index, title, headers[], rows[], locator}]`，形状与 `html.parseTables` 对齐；
 *         row.cells 同样含 `{text, raw, colIndex, header}`；locator 用 `md-table[<n>]/row[<r>]`
 * @degraded 无：缺分隔行的"伪表"不产出（避免把正文竖线当表）
 * @authority 判据 = "连续 ≥2 行以 `|` 开头/结尾，且第 2 行是 `---` 分隔行"
 * @not-here 不解析单元格内联格式（`**粗体**` 保留原文，由 name 规则自行校验）
 * @error 无
 */
export function parseMarkdownTables(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  const tables = [];
  let index = 0;
  while (index < lines.length) {
    const headerLine = lines[index];
    const separatorLine = lines[index + 1];
    if (!looksLikePipeRow(headerLine) || !isPipeSeparator(separatorLine)) {
      index += 1;
      continue;
    }
    const headers = splitPipeRow(headerLine);
    const rows = [];
    let cursor = index + 2;
    while (cursor < lines.length && looksLikePipeRow(lines[cursor])) {
      const cells = splitPipeRow(lines[cursor]);
      if (cells.length === headers.length) {
        rows.push({
          index: rows.length + 1,
          cells: cells.map((cell, colIndex) => ({
            text: cell,
            raw: cell,
            colIndex,
            header: headers[colIndex] ?? `col${String(colIndex + 1)}`,
          })),
          locator: `md-table[${String(tables.length + 1)}]/row[${String(rows.length + 1)}]`,
        });
      }
      cursor += 1;
    }
    if (rows.length > 0) {
      tables.push({
        index: tables.length + 1,
        title: findMarkdownTableTitle(lines, index),
        headers,
        rows,
        locator: `md-table[${String(tables.length + 1)}]`,
      });
    }
    index = cursor;
  }
  return tables;
}

/** @input line —— 单行 @output 是否形如管道行 @degraded 无 @authority 本文件 @not-here 无 @error 无 */
function looksLikePipeRow(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

/** @input line —— 单行 @output 是否为 `|---|:--:|` 形态的分隔行 @degraded 无 @authority 本文件 @not-here 无 @error 无 */
function isPipeSeparator(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!looksLikePipeRow(trimmed)) return false;
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed);
}

/** @input line —— 管道行 @output 单元格文本数组（去首尾空白） @degraded 无 @authority 本文件 @not-here 不处理转义竖线 @error 无 */
function splitPipeRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(cell => squeezeWhitespace(cell));
}

/**
 * 取 Markdown 表格标题：表前最近一个 `#` 标题行（最多回看 40 行）。
 *
 * @input  lines —— 全文行数组；tableLineIndex —— 表头行下标
 * @output 标题文本或 `''`
 * @degraded 无
 * @authority 只看回看窗口内的第一/二级标题
 * @not-here 不解析块引用/HTML 标题
 * @error 无
 */
function findMarkdownTableTitle(lines, tableLineIndex) {
  for (let index = tableLineIndex - 1; index >= Math.max(0, tableLineIndex - 40); index -= 1) {
    const match = /^#{1,2}\s+(.+)$/.exec(lines[index].trim());
    if (match !== null) return squeezeWhitespace(match[1]);
  }
  return '';
}

/**
 * 把文本拆成行条目（1-based 行号 + 文本），用于 key-value/负责人规则。
 *
 * @input  text —— 任意文本
 * @output `[{line, text}]`（跳过空行；保留行号便于 sourceRef）
 * @degraded 无
 * @authority 行号口径 = 1-based，与 `period.lineAtOffset` 一致
 * @not-here 不做行合并
 * @error 无
 */
export function lineEntries(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: squeezeWhitespace(line) }))
    .filter(entry => entry.text.length > 0);
}
