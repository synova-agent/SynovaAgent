/**
 * scripts/ingest-v0/lib/extract/documents.mjs — 把 V1 认定的 supported 文件加载成**统一文档结构**（I/O 边界）。
 *
 * 为什么需要统一结构：抽取规则（facts.mjs）只吃 `{text, paragraphs, tables}`；
 * 让每种格式各自把内容塞进同一形状，规则层才能脱离文件格式单测（HTML/docx/pptx/pdf 共用一套判据）。
 *
 * 边界：
 *   · 只读本地文件与 ZIP 条目；**不执行**宏/脚本/外链、不联网（C1）；
 *   · 解码失败/全 NUL/结构坏 ⇒ `corrupt:true` + 空内容（调用方显式记 skipped，不当成功）；
 *   · `displayPath` 只写**相对路径或 zip!/条目**，不把绝对临时路径写进来源指针（证据可搬运）。
 */

import fs from 'node:fs';

import { decodeTextBuffer, lineEntries, parseMarkdownTables } from './text-format.mjs';
import { htmlToText, parseTables, squeezeWhitespace, stripNonContentBlocks } from './html.mjs';
import { extractDocx, extractPptx } from './office.mjs';
import { extractPdfText } from './pdf.mjs';

/**
 * 统一文档结构（各格式的区别只在"怎么把字拿出来"）。
 *
 * @typedef {object} IngestDocument
 * @property {'html'|'docx'|'pptx'|'pdf'|'markdown'|'text'} kind
 * @property {string} displayPath —— 证据里的文件标识（相对路径或 `zip!/entry`）
 * @property {string} localPath —— 本机可读路径（仅供 verifyRead/调试；**不入证据**）
 * @property {string} text —— 期间识别与行级规则用的全文
 * @property {Array<{index:number,text:string,locator:string}>} paragraphs
 * @property {Array<{index:number,title:string,headers:string[],rows:Array,locator:string}>} tables
 * @property {boolean} truncated —— 检测到 NUL 填充/截断
 * @property {boolean} corrupt —— 无可读内容（全 NUL/结构坏）
 */

/**
 * 把 HTML 文本解码结果整理成统一文档。
 *
 * @input  text —— 原始 HTML；displayPath/localPath —— 标识；decode —— `{truncated}`
 * @output IngestDocument
 * @degraded 无
 * @authority 表格/文本解析复用 `html.mjs`
 * @not_here 不做字符集探测（UTF-8 之外按乱码处理，见 `corrupt` 判据）
 * @error 无
 */
function htmlDocument(text, displayPath, localPath, decode) {
  const clean = stripNonContentBlocks(text);
  const tables = parseTables(clean);
  const plain = htmlToText(clean);
  const paragraphs = plain
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, text: squeezeWhitespace(line), locator: `text[${String(index + 1)}]` }))
    .filter(item => item.text.length > 0);
  return {
    kind: 'html',
    displayPath,
    localPath,
    text: plain,
    paragraphs,
    tables,
    truncated: decode.truncated,
    corrupt: clean.length === 0,
  };
}

/**
 * 把纯文本/Markdown 整理成统一文档。
 *
 * @input  text/kind/displayPath/localPath/decode
 * @output IngestDocument（markdown 额外解析管道表；txt/json 只做行级）
 * @degraded 无
 * @authority 表格 = `parseMarkdownTables`（仅 markdown）
 * @not_here 不解析 JSON 语义（只当文本找明写字段；避免把任意 JSON 猜成对象）
 * @error 无
 */
function textDocument(text, kind, displayPath, localPath, decode) {
  const tables = kind === 'markdown' ? parseMarkdownTables(text) : [];
  const paragraphs = lineEntries(text).map(entry => ({ index: entry.line, text: entry.text, locator: `line[${String(entry.line)}]` }));
  return {
    kind,
    displayPath,
    localPath,
    text,
    paragraphs,
    tables,
    truncated: decode.truncated,
    corrupt: text.length === 0,
  };
}

/**
 * 加载一个 supported 文件为统一文档结构（**唯一文件格式分派点**）。
 *
 * @input  input.localPath —— 本机绝对路径；input.displayPath —— 证据标识；input.type —— V1 类型
 *         （`html|md|txt|json|docx|pptx|pdf`）
 * @output IngestDocument（失败也返回显式 `corrupt/truncated`，**不抛**）
 * @degraded 无：读失败 ⇒ `corrupt:true` + 空内容（调用方计 skipped）
 * @authority 类型→解析器映射只由本函数给出
 * @not_here 不解压 ZIP 容器（由 `source` 层先解压再逐文件调用）
 * @error 无（I/O 异常被转成 corrupt 结果，原因写 `corruptReason`）
 */
export function loadDocument(input) {
  const { localPath, displayPath, type } = input;
  if (type === 'docx') return { ...extractDocx(localPath), displayPath, localPath };
  if (type === 'pptx') return { ...extractPptx(localPath), displayPath, localPath };
  if (type === 'pdf') {
    let buffer;
    try {
      buffer = fs.readFileSync(localPath);
    } catch (err) {
      return { kind: 'pdf', displayPath, localPath, text: '', paragraphs: [], tables: [], truncated: false, corrupt: true, corruptReason: err instanceof Error ? err.message : String(err) };
    }
    const extracted = extractPdfText(buffer);
    return { ...extracted, displayPath, localPath, corrupt: extracted.encrypted || extracted.text.length === 0 };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(localPath);
  } catch (err) {
    return { kind: 'text', displayPath, localPath, text: '', paragraphs: [], tables: [], truncated: false, corrupt: true, corruptReason: err instanceof Error ? err.message : String(err) };
  }
  const decode = decodeTextBuffer(buffer);
  if (type === 'html') return htmlDocument(decode.text, displayPath, localPath, decode);
  if (type === 'md') return textDocument(decode.text, 'markdown', displayPath, localPath, decode);
  return textDocument(decode.text, 'text', displayPath, localPath, decode);
}
