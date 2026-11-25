/**
 * scripts/ingest-v0/lib/extract/html.mjs — HTML 的**表格/文本抽取**（纯函数，零 I/O）。
 *
 * 为什么手写解析而不引 DOM 库：本票只消费客户看板里的**静态表格 + 文本**，
 * 且要求零依赖、可复跑、坏 HTML 不抛错（truncated 文件在真实资料里大量存在，见 §7 验收现场）。
 *
 * 边界（C1 规则抽取）：
 *   · 只认 `<table>/<tr>/<th>/<td>` 与块级标签文本；**不执行脚本、不建 DOM、不联网**；
 *   · 结构缺口（未闭合标签/半行）⇒ 该行/该表**不产出**，不修补、不猜补；
 *   · 实体只解常见字符实体与数字实体；未知实体原样保留（不静默丢字）。
 */

/** 常见命名实体（足够覆盖看板文本；未知实体原样保留）。 */
const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  yen: '¥',
  middot: '·',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  times: '×',
  divide: '÷',
  plusmn: '±',
  deg: '°',
  permil: '‰',
});

/**
 * 解码 HTML 实体（命名 + 十进制/十六进制数字实体）。
 *
 * @input  text —— HTML 片段
 * @output 解码后的文本（未知实体原样保留）
 * @degraded 无：未知实体不抛、不丢
 * @authority 实体表 = 本文件 `NAMED_ENTITIES`
 * @not-here 不做 HTML 语法校验
 * @error 无
 */
export function decodeEntities(text) {
  if (typeof text !== 'string' || text.indexOf('&') === -1) return typeof text === 'string' ? text : '';
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/**
 * 去掉 `<style>`/`<script>` 块（内容不是业务文本；保留原始 index 不重要）。
 *
 * @input  html —— 原始 HTML
 * @output 移除 style/script 后的 HTML（其余原样）
 * @degraded 无
 * @authority 只移除这两类块（其它标签由 `htmlToText` 处理）
 * @not-here 不解析 CSS/JS
 * @error 无
 */
export function stripNonContentBlocks(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
}

/**
 * 去掉所有标签并解码实体（保留空白；空白压缩由调用方决定）。
 *
 * @input  fragment —— HTML 片段
 * @output 纯文本（标签替换为空格，实体已解码）
 * @degraded 无
 * @authority 标签识别 = `/<[^>]*>/`（对静态看板足够；不处理 `<` 文本转义以外的怪形态）
 * @not_here 不做可读性排版
 * @error 无
 */
export function stripTags(fragment) {
  if (typeof fragment !== 'string') return '';
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '));
}

/**
 * 纯文本归一：压缩连续空白为单个空格（**保留非空白字符原样**，便于名称/数值精确比对）。
 *
 * @input  text —— 任意文本
 * @output 去首尾、压缩内部空白后的文本
 * @degraded 无
 * @authority 归一判据只由本函数给出（名称比对/C8 去重都复用它）
 * @not_here 不做全半角/繁简转换（见 `normalizeName`）
 * @error 无
 */
export function squeezeWhitespace(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 把 HTML 变成"按块换行"的纯文本（期间识别与段落规则用）。
 *
 * @input  html —— 原始 HTML
 * @output 纯文本：块级标签/`<br>`/行尾 → `\n`，其余空白压缩为空格；实体已解码
 * @degraded 无
 * @authority 块级标签集合固定在本函数（不扩张）
 * @not-here 不做表格对齐（表格另有 `parseTables`）
 * @error 无
 */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  let text = stripNonContentBlocks(html);
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:div|p|h[1-6]|li|tr|section|header|footer|article|table)\s*>/gi, '\n');
  text = text.replace(/<(?:div|p|h[1-6]|li|tr|section|header|footer|article|table)\b[^>]*>/gi, '\n');
  text = stripTags(text);
  return text
    .split('\n')
    .map(line => squeezeWhitespace(line))
    .filter((line, index, array) => line.length > 0 || (index > 0 && array[index - 1].length > 0))
    .join('\n')
    .trim();
}

/**
 * 解析 HTML 中的所有表格（只收**结构完整**的行；半行不产）。
 *
 * @input  html —— 原始 HTML（建议先截断 NUL 填充；见 `text-format.decodeTextFile`）
 * @output `[{index, title, headers[], rows[], locator}]`：
 *           index 1-based；title 为表前最近一个 `<h2>`/`<h3>`/`<caption>` 的文本（可能为空）；
 *           headers 为**首行 `<th>`** 文本（无 th ⇒ 空数组，整表按无头表返回）；
 *           rows 仅含数据行：`{index, cells:[{text, raw, colIndex, header}], locator}`
 * @degraded 无：坏表/半行直接不产出（不修补、不猜）
 * @authority 表结构判据 = "有 `<table>` 起止 + 行有 `<tr>` 起止 + 单元格有 `<td>/<th>` 起止"
 * @not-here 不解析 rowspan/colspan（看板未见；出现时列对位可能错，调用方按表头缺失放弃该行）
 * @error 无（纯解析，不抛）
 */
export function parseTables(html) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const tables = [];
  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableIndex = tables.length + 1;
    const inner = tableMatch[1];
    const title = findTableTitle(html, tableMatch.index);
    const parsedRows = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(inner)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [];
      const cellRegex = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const raw = squeezeWhitespace(stripTags(cellMatch[2]));
        cells.push({ text: raw, raw, colIndex: cells.length });
      }
      if (cells.length > 0) parsedRows.push({ html: rowHtml, cells });
    }
    if (parsedRows.length === 0) continue;

    const hasHeader = /<th\b/i.test(parsedRows[0].html);
    const headers = hasHeader ? parsedRows[0].cells.map(cell => cell.text) : [];
    const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
    const rows = dataRows.map((row, rowIndex) => ({
      index: rowIndex + 1,
      cells: row.cells.map((cell, colIndex) => ({
        text: cell.text,
        raw: cell.raw,
        colIndex,
        header: headers[colIndex] ?? `col${String(colIndex + 1)}`,
      })),
      locator: `table[${String(tableIndex)}]/row[${String(rowIndex + 1)}]`,
    }));
    tables.push({
      index: tableIndex,
      title,
      headers,
      rows,
      locator: `table[${String(tableIndex)}]`,
    });
  }
  return tables;
}

/**
 * 取表格前最近一个 `<h2>/<h3>/<caption>` 文本作为表名（取证用；找不到 ⇒ 空串）。
 *
 * @input  html —— 原始 HTML；tableStart —— 该表 `<table>` 起点偏移
 * @output 归一的标题文本或 `''`
 * @degraded 无（找不到就是空）
 * @authority 只看表前 4000 字符窗口
 * @not-here 不建立 DOM 层级
 * @error 无
 */
function findTableTitle(html, tableStart) {
  const windowStart = Math.max(0, tableStart - 4000);
  const window = html.slice(windowStart, tableStart);
  const headingMatches = [...window.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]\s*>/gi)];
  if (headingMatches.length > 0) {
    return squeezeWhitespace(stripTags(headingMatches[headingMatches.length - 1][1]));
  }
  const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/i.exec(html.slice(tableStart, tableStart + 4000));
  return caption === null ? '' : squeezeWhitespace(stripTags(caption[1]));
}
