/**
 * scripts/ingest-v0/lib/extract/office.mjs — DOCX/PPTX 的 **OOXML 文本与表格抽取**（纯解析，无第三方库）。
 *
 * 为什么手写：docx/pptx 本质是 ZIP + XML，本票只需要"段落文本 + 表格单元格"两类节点；
 * 引 DOM/Office 解析库会带依赖与宏执行面，而任务书要求零模型、零执行、可复跑。
 *
 * 边界：
 *   · 只读 `word/document.xml`（docx）与 `ppt/slides/slideN.xml`（pptx），**不执行宏/脚本/外链**；
 *   · 只做 XML 标签级的段落/表格识别；不解析样式、合并单元格、页眉页脚脚注；
 *   · 结构坏 ⇒ 返回空/部分结果（调用方据此计 `no_extractable_facts`），不静默修补。
 */

import { decodeEntities, squeezeWhitespace } from './html.mjs';
import { createZipReader } from '../zip-extract.mjs';

/**
 * 取一段 OOXML 里可见文本（`<w:t>` / `<a:t>` 拼接；tab/br 保留为空白）。
 *
 * @input  xmlFragment —— OOXML 片段；textTag —— `'w:t'` 或 `'a:t'`
 * @output 归一后的可见文本（实体已解码）
 * @degraded 无：无文本 ⇒ 空串
 * @authority 只认该命名空间的文本标签（其余标签一律剥掉）
 * @not_here 不解析 `<w:instrText>`（域代码不是业务文本）
 * @error 无
 */
function textOfFragment(xmlFragment, textTag) {
  if (typeof xmlFragment !== 'string' || xmlFragment.length === 0) return '';
  const pattern = new RegExp(`<${textTag}\\b[^>]*>([\\s\\S]*?)<\\/${textTag}\\s*>`, 'gi');
  const parts = [];
  let match;
  while ((match = pattern.exec(xmlFragment)) !== null) parts.push(match[1]);
  let text = parts.join('');
  text = text.replace(/<w:tab\b[^>]*\/>/gi, '\t').replace(/<w:br\b[^>]*\/>/gi, '\n');
  text = decodeEntities(text.replace(/<[^>]*>/g, ''));
  return squeezeWhitespace(text);
}

/**
 * 把 OOXML 表格 XML 解析成与 HTML 表同形的结构。
 *
 * @input  tableXml —— `<w:tbl>...</w:tbl>` 或 `<a:tbl>...</a:tbl>` 片段；
 *         options.locatorPrefix —— locator 前缀（如 `word/document.xml/table[2]`）
 * @output `{headers, rows, locator}`（行/单元格只收完整闭合的；空行跳过）
 * @degraded 无：半行/空表 ⇒ 空 rows
 * @authority 单元格文本 = `textOfFragment`（与段落同口径）
 * @not_here 不处理合并单元格（被合并的列会缺格，调用方按表头缺失跳过该行）
 * @error 无
 */
function parseOoxmlTable(tableXml, locatorPrefix) {
  const headers = [];
  const rows = [];
  const rowPattern = /<(?:w|a):tr\b[^>]*>([\s\S]*?)<\/(?:w|a):tr\s*>/gi;
  let rowMatch;
  let rowIndex = 0;
  while ((rowMatch = rowPattern.exec(tableXml)) !== null) {
    const cellPattern = /<(?:w|a):tc\b[^>]*>([\s\S]*?)<\/(?:w|a):tc\s*>/gi;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      const text = textOfFragment(cellMatch[1], 'w:t') || textOfFragment(cellMatch[1], 'a:t');
      cells.push({ text, raw: text, colIndex: cells.length });
    }
    if (cells.length === 0) continue;
    if (rowIndex === 0) {
      headers.push(...cells.map(cell => cell.text));
    } else {
      rows.push({
        index: rowIndex,
        cells: cells.map((cell, colIndex) => ({ ...cell, header: headers[colIndex] ?? `col${String(colIndex + 1)}` })),
        locator: `${locatorPrefix}/row[${String(rowIndex)}]`,
      });
    }
    rowIndex += 1;
  }
  return { headers, rows, locator: locatorPrefix };
}

/**
 * 抽取 DOCX 的段落与表格。
 *
 * @input  zipPath —— `.docx` 绝对路径
 * @output `{kind:'docx', text, paragraphs, tables, truncated:false}`（形状与 HTML 文档对齐；
 *         paragraphs = `[{index, text, locator}]`，tables 形状同 `html.parseTables`）
 * @degraded 无：缺 `word/document.xml` ⇒ `text=''`、空表（调用方计 `no_extractable_facts`）
 * @authority 只读 `word/document.xml`；文本口径 = `textOfFragment`
 * @not-here 不读页眉页脚/批注/嵌入对象；不执行宏
 * @error `IngestError(E_INPUT_UNREADABLE, 'zip')` —— docx 打不开（原样上抛）
 */
export function extractDocx(zipPath) {
  const reader = createZipReader(zipPath);
  try {
    if (!reader.ok) {
      return { kind: 'docx', text: '', paragraphs: [], tables: [], truncated: false, corrupt: true, corruptReason: reader.corruptReason };
    }
    const entry = reader.entries.find(item => item.name === 'word/document.xml');
    if (entry === undefined) {
      return { kind: 'docx', text: '', paragraphs: [], tables: [], truncated: false, corrupt: false };
    }
    let xml;
    try {
      xml = reader.readEntry('word/document.xml').toString('utf8');
    } catch (err) {
      return { kind: 'docx', text: '', paragraphs: [], tables: [], truncated: false, corrupt: true, corruptReason: err instanceof Error ? err.message : String(err) };
    }

    const paragraphs = [];
    const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p\s*>/gi;
    let paragraphMatch;
    while ((paragraphMatch = paragraphPattern.exec(xml)) !== null) {
      const text = textOfFragment(paragraphMatch[1], 'w:t');
      if (text.length > 0) {
        paragraphs.push({ index: paragraphs.length + 1, text, locator: `word/document.xml/p[${String(paragraphs.length + 1)}]` });
      }
    }

    const tables = [];
    const tablePattern = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl\s*>/gi;
    let tableMatch;
    while ((tableMatch = tablePattern.exec(xml)) !== null) {
      const parsed = parseOoxmlTable(tableMatch[1], `word/document.xml/table[${String(tables.length + 1)}]`);
      if (parsed.rows.length > 0) {
        tables.push({ index: tables.length + 1, title: '', headers: parsed.headers, rows: parsed.rows, locator: parsed.locator });
      }
    }

    const textParts = [...paragraphs.map(item => item.text)];
    for (const table of tables) {
      textParts.push(table.headers.join(' '));
      for (const row of table.rows) textParts.push(row.cells.map(cell => cell.text).join(' '));
    }
    return { kind: 'docx', text: textParts.join('\n'), paragraphs, tables, truncated: false, corrupt: false };
  } finally {
    reader.close();
  }
}

/**
 * 抽取 PPTX 各页文本与表格。
 *
 * @input  zipPath —— `.pptx` 绝对路径
 * @output `{kind:'pptx', text, paragraphs, tables, truncated:false}`（paragraphs 带 `slide`;
 *         tables 形状同 HTML；locator 前缀 `ppt/slides/slideN.xml`）
 * @degraded 无：无幻灯片 ⇒ 空结果（调用方计 `no_extractable_facts`）
 * @authority 只读 `ppt/slides/slideN.xml`（按 N 数值升序）；文本口径 = `textOfFragment`
 * @not_here 不读备注/母版/嵌入对象
 * @error `IngestError(E_INPUT_UNREADABLE, 'zip')` —— pptx 打不开（原样上抛）
 */
export function extractPptx(zipPath) {
  const reader = createZipReader(zipPath);
  try {
    if (!reader.ok) {
      return { kind: 'pptx', text: '', paragraphs: [], tables: [], truncated: false, corrupt: true, corruptReason: reader.corruptReason };
    }
    const slideEntries = reader.entries
      .map(entry => {
        const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(entry.name);
        return match === null ? null : { name: entry.name, number: Number(match[1]) };
      })
      .filter(item => item !== null)
      .sort((left, right) => left.number - right.number);

    const paragraphs = [];
    const tables = [];
    const textParts = [];
    const skippedSlides = [];
    for (const slide of slideEntries) {
      let xml;
      try {
        xml = reader.readEntry(slide.name).toString('utf8');
      } catch (err) {
        // 单页损坏：不静默吞 —— 记入 skippedSlides（调用方/报告可归因），其余页继续
        skippedSlides.push({ slide: slide.number, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const slideLocator = `ppt/slides/slide${String(slide.number)}.xml`;
      const paragraphPattern = /<a:p\b[^>]*>([\s\S]*?)<\/a:p\s*>/gi;
      let paragraphMatch;
      let localIndex = 0;
      while ((paragraphMatch = paragraphPattern.exec(xml)) !== null) {
        const text = textOfFragment(paragraphMatch[1], 'a:t');
        if (text.length > 0) {
          localIndex += 1;
          paragraphs.push({ index: paragraphs.length + 1, slide: slide.number, text, locator: `${slideLocator}/p[${String(localIndex)}]` });
          textParts.push(text);
        }
      }
      const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl\s*>/gi;
      let tableMatch;
      while ((tableMatch = tablePattern.exec(xml)) !== null) {
        const parsed = parseOoxmlTable(tableMatch[1], `${slideLocator}/table[${String(tables.length + 1)}]`);
        if (parsed.rows.length > 0) {
          tables.push({ index: tables.length + 1, title: '', headers: parsed.headers, rows: parsed.rows, locator: parsed.locator });
          textParts.push(parsed.headers.join(' '));
          for (const row of parsed.rows) textParts.push(row.cells.map(cell => cell.text).join(' '));
        }
      }
    }
    return { kind: 'pptx', text: textParts.join('\n'), paragraphs, tables, truncated: false, corrupt: false, skippedSlides };
  } finally {
    reader.close();
  }
}
