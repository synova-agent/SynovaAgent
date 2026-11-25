/**
 * tests/ingest-v0/extract-html.test.ts — V2 文本/Office/PDF 解析边界的**真实文件系统**验收（#1500）。
 *
 * 覆盖：
 *   · 文本解码遇到 NUL 填充 ⇒ 截断在首个 NUL（本票验收现场 17 个 HTML 中 8 个全 NUL 的真实形态）；
 *   · HTML 表：实体解码、空白归一、未闭合行不产出；
 *   · DOCX（ZIP + OOXML）：段落/表格抽取 + 期间识别 + 规则抽取串起来；
 *   · PDF：明文字面串可抽、高位字节乱码不采纳（C6：宁可抽不到，不编造）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodeTextBuffer, parseMarkdownTables } from '../../scripts/ingest-v0/lib/extract/text-format.mjs';
import { htmlToText, parseTables, squeezeWhitespace } from '../../scripts/ingest-v0/lib/extract/html.mjs';
import { extractDocx } from '../../scripts/ingest-v0/lib/extract/office.mjs';
import { extractPdfText, decodePdfLiteral } from '../../scripts/ingest-v0/lib/extract/pdf.mjs';
import { extractFactsFromDocument } from '../../scripts/ingest-v0/lib/extract/facts.mjs';
import { buildZip } from './support/build-zip';

const FIXTURE_ROOT = path.join(os.tmpdir(), 'ingest-v0', `extract-html-${process.pid}-${Date.now()}`);
fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

afterAll(() => {
  // 只清理本文件新建的夹具根（不触碰任何既有目录）
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('文本解码 — NUL 截断（真实资料形态）', () => {
  it('正文 + 大段 NUL ⇒ 截断在首个 NUL，并显式标记 truncated', () => {
    const buffer = Buffer.concat([Buffer.from('<html>数据周期 2026-08-01</html>', 'utf8'), Buffer.alloc(64)]);
    const decoded = decodeTextBuffer(buffer);
    expect(decoded.text).toBe('<html>数据周期 2026-08-01</html>');
    expect(decoded.truncated).toBe(true);
    expect(decoded.contentBytes).toBeLessThan(decoded.totalBytes);
  });

  it('全 NUL 文件 ⇒ text 为空（调用方判 corrupt，不当成功）', () => {
    const decoded = decodeTextBuffer(Buffer.alloc(32));
    expect(decoded.text).toBe('');
    expect(decoded.truncated).toBe(true);
  });
});

describe('HTML 表解析 — 实体/空白/半行', () => {
  it('实体解码 + 单元格空白归一 + 表头正确', () => {
    const html = `<table><tr><th>销售</th><th>队</th><th>目标</th></tr>
      <tr><td> 张&amp;测试 </td><td>测试&nbsp;队</td><td>&yen;1,000</td></tr></table>`;
    const tables = parseTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['销售', '队', '目标']);
    expect(tables[0].rows[0].cells[0].raw).toBe('张&测试');
    expect(tables[0].rows[0].cells[1].raw).toBe('测试 队');
    expect(tables[0].rows[0].cells[2].raw).toBe('¥1,000');
  });

  it('未闭合的行/表不产出（不修补、不猜）', () => {
    const html = `<table><tr><th>销售</th></tr><tr><td>只有半行`;
    expect(parseTables(html)).toHaveLength(0);
  });

  it('块级标签转换行；style/script 不计入正文', () => {
    const text = htmlToText('<style>.x{}</style><div>第一段</div><div>第二段</div><script>alert(1)</script>');
    expect(text).toContain('第一段');
    expect(text).toContain('第二段');
    expect(text).not.toContain('alert');
    expect(squeezeWhitespace(' a   b ')).toBe('a b');
  });
});

describe('Markdown 表 — 分隔行判据', () => {
  it('管道表 + 分隔行 ⇒ 产出；正文竖线不误判', () => {
    const md = ['# 计划', '| 销售 | 队 | 目标 |', '|---|---|---|', '| 张测试 | 测试队 | ¥1,000 |', '正文 | 不是表'].join('\n');
    const tables = parseMarkdownTables(md);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['销售', '队', '目标']);
    expect(tables[0].rows[0].cells[0].raw).toBe('张测试');
    expect(tables[0].title).toBe('计划');
  });
});

describe('DOCX — ZIP + OOXML 段落/表格', () => {
  function writeDocx(fileName: string): string {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>数据周期 2026-08-01 ~ 08-31</w:t></w:r></w:p>
<w:p><w:r><w:t>测试队负责人：张测试</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>销售</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>队</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>目标</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>李样例</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>样例队</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>¥12,000</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl></w:body></w:document>`;
    const zip = buildZip([
      { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8'), method: 'deflate' },
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>', 'utf8') },
    ]);
    const filePath = path.join(FIXTURE_ROOT, fileName);
    fs.writeFileSync(filePath, zip);
    return filePath;
  }

  it('抽出段落与表格，并串起期间/对象/关系/指标', () => {
    const filePath = writeDocx('fixture.docx');
    const document = extractDocx(filePath);
    expect(document.corrupt).toBe(false);
    expect(document.paragraphs.some(item => item.text.includes('数据周期 2026-08-01'))).toBe(true);
    expect(document.tables).toHaveLength(1);
    expect(document.tables[0].headers).toEqual(['销售', '队', '目标']);

    const facts = extractFactsFromDocument({ ...document, displayPath: 'fixture.docx' });
    expect(facts.periodInfo.period).toBe('2026-08');
    expect(facts.objects.some(object => object.props.name === '李样例')).toBe(true);
    expect(facts.objects.some(object => object.props.name === '样例队')).toBe(true);
    // 段落「测试队负责人：张测试」⇒ 团队负责人关系
    expect(facts.objects.some(object => object.props.name === '测试队')).toBe(true);
    expect(facts.relations.some(relation => relation.businessKey === 'member_of_team/张测试@测试队')).toBe(true);
    expect(facts.metrics.some(metric => metric.metricId === 'sales.target' && metric.value === 12000)).toBe(true);
  });
});

describe('PDF — 保守文本抽取', () => {
  it('明文 Tj 可抽；UTF-16BE BOM 可解；高位乱码不采纳', () => {
    expect(decodePdfLiteral(Buffer.from('2026-08', 'latin1'))).toEqual({ text: '2026-08', ok: true });
    const utf16 = Buffer.concat([Buffer.from([0xfe, 0xff, 0x00, 0x32, 0x00, 0x30])]);
    expect(decodePdfLiteral(utf16)).toEqual({ text: '20', ok: true });
    expect(decodePdfLiteral(Buffer.from([0x01, 0x02, 0x03, 0x04])).ok).toBe(false);
  });

  it('未压缩内容流里的 `(2026-08) Tj` 可抽出期间', () => {
    const pdf = ['%PDF-1.4', '1 0 obj', '<< /Length 26 >>', 'stream', 'BT (2026-08) Tj ET', 'endstream', 'endobj', '%%EOF'].join('\n');
    const extracted = extractPdfText(Buffer.from(pdf, 'latin1'));
    expect(extracted.encrypted).toBe(false);
    expect(extracted.text).toContain('2026-08');
  });

  it('加密 PDF 整份不抽（不猜）', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n%%EOF', 'latin1');
    expect(extractPdfText(pdf).encrypted).toBe(true);
  });
});
