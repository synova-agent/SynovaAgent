/**
 * tests/ingest-v0/extract-zip-guard.test.ts — V2 ZIP 解压边界的**真实文件系统**验收（C7）。
 *
 * 覆盖：
 *   · 安全条目落盘；`../`／绝对路径／盘符 ⇒ `path_traversal` 且**不写盘**；
 *   · 加密条目 ⇒ `encrypted`；单条超上限 ⇒ `oversized`；未知压缩方法 ⇒ 明确 reason；
 *   · 条目数/总解压量超限 ⇒ 抛 `E_RESOURCE_LIMIT`（已处理部分在 `.partial` 里，报告可如实记录）；
 *   · deflate（方法 8）+ CRC 校验可解；损坏 CRC ⇒ 该条 skipped 且不中断整包。
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractZip, safeEntryPath } from '../../scripts/ingest-v0/lib/zip-extract.mjs';
import { IngestError } from '../../scripts/ingest-v0/lib/errors.mjs';
import { buildZip } from './support/build-zip';

const FIXTURE_ROOT = path.join(os.tmpdir(), 'ingest-v0', `extract-zip-${process.pid}-${Date.now()}`);
fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

let counter = 0;
/** @input entries —— 条目规格 @output 写好的 zip 绝对路径 @degraded 无 @authority 测试夹具 @not-here 无 @error 无 */
function writeZip(entries: Parameters<typeof buildZip>[0]): string {
  counter += 1;
  const zipPath = path.join(FIXTURE_ROOT, `fixture-${String(counter)}.zip`);
  fs.writeFileSync(zipPath, buildZip(entries));
  return zipPath;
}

/** @input prefix —— 目录前缀 @output 本用例新建的目标目录 @degraded 无 @authority 测试夹具 @not-here 不清理既有目录 @error 无 */
function targetDir(prefix: string): string {
  const dir = path.join(FIXTURE_ROOT, `${prefix}-${String(counter)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ZIP 解压 — 安全条目与跳过原因（C7）', () => {
  it('安全条目落盘；traversal/encrypted/oversized 逐条 skipped 且不越界写盘', () => {
    const zipPath = writeZip([
      { name: 'safe/ok.txt', data: Buffer.from('hello', 'utf8'), method: 'deflate' },
      { name: '../escape.txt', data: Buffer.from('bad', 'utf8') },
      { name: 'C:/win.txt', data: Buffer.from('bad', 'utf8') },
      { name: '/abs.txt', data: Buffer.from('bad', 'utf8') },
      { name: 'secret.txt', data: Buffer.from('bad', 'utf8'), flags: 1 },
      { name: 'huge.bin', data: Buffer.from('x'), uncompressedSize: 1024 * 1024 },
    ]);
    const dir = targetDir('extract');
    const result = extractZip(zipPath, dir, { maxFileBytes: 1024 });
    expect(result.ok).toBe(true);
    expect(result.extracted.map(item => item.entryName)).toEqual(['safe/ok.txt']);
    expect(fs.readFileSync(path.join(dir, 'safe', 'ok.txt'), 'utf8')).toBe('hello');
    const reasons = result.skipped.map(item => item.reason).sort();
    expect(reasons).toEqual(['encrypted', 'oversized', 'path_traversal', 'path_traversal', 'path_traversal']);
    expect(fs.existsSync(path.join(FIXTURE_ROOT, 'escape.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '..', 'escape.txt'))).toBe(false);
  });

  it('safeEntryPath 纯判定：拒绝 `..`/绝对/盘符，接受普通相对路径', () => {
    expect(safeEntryPath('../x', FIXTURE_ROOT)).toEqual({ ok: false, reason: 'path_traversal' });
    expect(safeEntryPath('/abs', FIXTURE_ROOT)).toEqual({ ok: false, reason: 'path_traversal' });
    expect(safeEntryPath('C:/win', FIXTURE_ROOT)).toEqual({ ok: false, reason: 'path_traversal' });
    expect(safeEntryPath('a/b.txt', FIXTURE_ROOT)).toEqual({ ok: true, relativePath: 'a/b.txt' });
  });
});

describe('ZIP 解压 — 资源上限（C7）', () => {
  it('条目数超限 ⇒ E_RESOURCE_LIMIT，带已处理部分', () => {
    const zipPath = writeZip([
      { name: 'a.txt', data: Buffer.from('a') },
      { name: 'b.txt', data: Buffer.from('b') },
      { name: 'c.txt', data: Buffer.from('c') },
    ]);
    const dir = targetDir('entries');
    let caught: unknown = null;
    try {
      extractZip(zipPath, dir, { maxEntries: 2 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IngestError);
    expect((caught as IngestError).code).toBe('E_RESOURCE_LIMIT');
    expect((caught as IngestError).partial?.extracted?.length).toBe(2);
  });

  it('总解压量超限 ⇒ E_RESOURCE_LIMIT', () => {
    const zipPath = writeZip([
      { name: 'a.txt', data: Buffer.from('a'.repeat(10)) },
      { name: 'b.txt', data: Buffer.from('b'.repeat(10)) },
    ]);
    const dir = targetDir('bytes');
    expect(() => extractZip(zipPath, dir, { maxTotalBytes: 15 })).toThrow(/总解压量超限/);
  });
});

describe('ZIP 解压 — 结构损坏', () => {
  it('非 ZIP/尾部截断 ⇒ ok=false + corrupt 原因（不当空包）', () => {
    const zipPath = path.join(FIXTURE_ROOT, 'not-a-zip.zip');
    fs.writeFileSync(zipPath, Buffer.from('this is not a zip'));
    const result = extractZip(zipPath, targetDir('corrupt'));
    expect(result.ok).toBe(false);
    expect(result.corrupt).toBe(true);
    expect(result.corruptReason).toContain('EOCD');
  });

  it('CRC 不符 ⇒ 该条 skipped(corrupt)，其余条目仍可解', () => {
    const zipPath = writeZip([{ name: 'ok.txt', data: Buffer.from('good') }]);
    const bytes = fs.readFileSync(zipPath);
    // 中央目录 + 本地头都写了 CRC；把中央目录里的 CRC 改坏（中央目录在 EOCD 前）
    const eocdOffset = bytes.length - 22;
    const cdOffset = bytes.readUInt32LE(eocdOffset + 16);
    const centralCrcOffset = cdOffset + 16;
    bytes.writeUInt32LE(0xdeadbeef, centralCrcOffset);
    fs.writeFileSync(zipPath, bytes);
    const result = extractZip(zipPath, targetDir('crc'));
    expect(result.ok).toBe(true);
    expect(result.extracted).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('corrupt');
    expect(result.skipped[0].detail.message).toContain('CRC');
  });
});
