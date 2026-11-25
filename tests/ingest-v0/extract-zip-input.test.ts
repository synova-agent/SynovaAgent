/**
 * tests/ingest-v0/extract-zip-input.test.ts — V2 以 **ZIP 作为输入源**的端到端判据（C7 + 主链）。
 *
 * 为什么单独一件：真实引擎（engine-context）在本进程是单例且成功路径结束时会关闭数据库；
 * 每个测试文件独立 worker（vitest 默认 isolate）⇒ ZIP 输入用例需要自己的文件级引擎生命周期。
 *
 * 覆盖：ZIP → 受控解压 → V1 分类 → DOCX 解析 → 对象/关系/指标 → persistFacts → C4 count>0。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runExtract } from '../../scripts/ingest-v0/extract.mjs';
import { initEngineContext } from '../../src/init/engine-context';
import { buildZip } from './support/build-zip';

const FIXTURE_ROOT = path.join(os.tmpdir(), 'ingest-v0', `extract-zip-input-${process.pid}-${Date.now()}`);
const DB_PATH = path.join(FIXTURE_ROOT, 'synova.db');
fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

beforeAll(() => {
  process.env.SYNOVA_DB_PATH = DB_PATH;
  process.env.SYNOVA_SKIP_MCP = '1';
  initEngineContext();
});

describe('CLI — ZIP 输入（C7 受控解压 + 抽取 + C4）', () => {
  it('zip 内的 docx 表可抽出对象/关系/指标，C4 count>0', async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>数据周期 2026-08-01 ~ 08-31</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>销售</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>队</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>目标</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>张测试</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>测试队</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>¥9,900</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl></w:body></w:document>`;
    const zipBytes = buildZip([
      { name: '资料/业绩.docx', data: buildZip([{ name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8'), method: 'deflate' }]), method: 'deflate' },
      { name: '资料/说明.txt', data: Buffer.from('这份说明没有任何日期。', 'utf8'), method: 'deflate' },
      { name: '资料/图片.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    const zipPath = path.join(FIXTURE_ROOT, 'input.zip');
    fs.writeFileSync(zipPath, zipBytes);

    const reportPath = path.join(FIXTURE_ROOT, 'zip-report.json');
    const result = await runExtract(['--source', zipPath, '--db', DB_PATH, '--out', reportPath, '--graph', 'itest-zip'], { tempRoot: FIXTURE_ROOT });

    expect(result.exitCode).toBe(0);
    expect(result.report.sourceKind).toBe('zip');
    expect(result.report.status).toBe('ok');
    expect(result.report.prepared.files).toBe(2); // docx + txt（png 是 unsupported）
    expect(result.report.prepared.stats.extractedFiles).toBe(3);
    expect(result.report.prepared.skipped.some((item: { reason: string }) => item.reason === 'unsupported_type')).toBe(true);
    // 嵌套 zip（docx）也被 V1 认成 supported 并通过受控解压读取，不当作普通文件抽取
    expect(result.report.extraction.objects.total).toBe(2);
    expect(result.report.extraction.relations.total).toBe(1);
    expect(result.report.extraction.metrics.total).toBe(1);
    expect(result.report.facts.objects.every((object: { sourceRef: { file: string } }) => object.sourceRef.file.startsWith('input.zip!/'))).toBe(true);
    expect(result.report.c4.count).toBeGreaterThan(0);
  });
});
