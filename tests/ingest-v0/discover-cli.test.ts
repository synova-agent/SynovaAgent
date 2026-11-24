/**
 * tests/ingest-v0/discover-cli.test.ts — V1 发现层**真实文件系统**判据（#1492 / 任务书 B 段）。
 *
 * 与 `discover-unit.test.ts` 分工：本件只证 I/O 路径 —— 目录遍历（含 junction 不跟随）、
 * ZIP 只枚举（含越界/加密/损坏条目）、限额真的会让扫描停下、report.json 真的落盘、退出码三态。
 *
 * 夹具口径：全部建在**本进程新建**的 `%TMP%/ingest-v0/fixture-*` 下（任务书 §8：只用本票新建的临时目录）。
 * 刻意**不清理**夹具目录 —— 任务书明令"不清理任何既有目录"，且报告里要能回指到真实路径。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, parseArgs, defaultOutputPath, exitCodeFor } from '../../scripts/ingest-v0/discover.mjs';
import { readZipEntries } from '../../scripts/ingest-v0/lib/zip-entries.mjs';
import { annotateZipFiles } from '../../scripts/ingest-v0/lib/zip-scan.mjs';
import { createBudget } from '../../scripts/ingest-v0/lib/budget.mjs';
import { scanTree } from '../../scripts/ingest-v0/lib/walk.mjs';
import { buildZip } from './support/build-zip';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'scripts/ingest-v0/discover.mjs');
const TEMP_ROOT = path.join(os.tmpdir(), 'ingest-v0');

/** 本件创建的夹具根（`%TMP%/ingest-v0/fixture-<随机>`） */
function makeFixtureRoot(prefix: string): string {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEMP_ROOT, `${prefix}-`));
}

interface ReportJson {
  schemaVersion: string;
  source: string;
  status: string;
  supported: Array<{ path: string; type: string; size: number; zip?: { entryCount: number; traversalCount: number; encryptedCount: number } }>;
  unsupported: Array<{ path: string; reason: string }>;
  skipped: Array<{ path: string; reason: string; detail?: Record<string, unknown> }>;
  totals: { files: number; bytes: number; byType: Record<string, number>; supported: number; unsupported: number; skipped: number };
  error?: { code: string; phase: string };
}

/** 造一棵覆盖全部类型的夹具树（含 junction 与合法 ZIP）。 */
function buildFixtureTree(): { root: string; zipCounts: { entryCount: number; traversalCount: number; encryptedCount: number } } {
  const root = makeFixtureRoot('fixture');
  const write = (rel: string, content: string | Buffer): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  write('a.docx', 'docx fixture');
  write('b.pptx', 'pptx fixture');
  write('c.pdf', 'pdf fixture');
  write('d.html', '<html></html>');
  write('e.json', '{}');
  write('f.md', '# md');
  write('g.txt', 'txt');
  write('h.xlsx', 'unsupported fixture');
  write('nested/deep/i.txt', 'nested txt');

  const zipBytes = buildZip([
    { name: 'dir/' },
    { name: 'dir/ok.txt', data: Buffer.from('ok') },
    { name: '../evil.txt', data: Buffer.from('evil') },
    { name: '/abs.txt', data: Buffer.from('abs') },
    { name: 'C:/win.ini', data: Buffer.from('win') },
    { name: 'secret.docx', data: Buffer.from('s'), flags: 0x1 },
  ]);
  write('bundle.zip', zipBytes);

  // junction（Windows）/目录符号链接（POSIX）：**不跟随、不递归**
  const linkPath = path.join(root, 'link-dir');
  fs.symlinkSync(path.join(root, 'nested'), linkPath, process.platform === 'win32' ? 'junction' : 'dir');

  return { root, zipCounts: { entryCount: 6, traversalCount: 3, encryptedCount: 1 } };
}

const fixture = buildFixtureTree();

afterAll(() => {
  // 刻意不删夹具（任务书 §8「不清理任何既有目录」）；它们位于 %TMP%/ingest-v0/ 下，随系统临时区回收
  console.info(`[ingest-v0 discover 夹具] ${fixture.root}`);
});

// ═══ 目录遍历：分类 / junction / ZIP ═══════════════════════════════════════

describe('walk + zip-scan — 遍历分类、junction 不跟随、ZIP 只枚举', () => {
  it('扫描夹具树：8 类 supported、xlsx unsupported、junction skipped、ZIP 计数与越界条目', () => {
    const budget = createBudget({});
    const scanned = scanTree(fixture.root, { budget });
    const supportedTypes = scanned.files.filter(file => file.supported).map(file => file.type).sort();
    // txt 两个：`g.txt` 与 `nested/deep/i.txt`（后者同时证明递归确实发生）
    expect(supportedTypes).toEqual(['docx', 'html', 'json', 'md', 'pdf', 'pptx', 'txt', 'txt', 'zip']);

    const unsupported = scanned.files.filter(file => !file.supported);
    expect(unsupported.map(file => file.relPath)).toEqual(['h.xlsx']);
    expect(unsupported[0].reason).toBe('unsupported_type');

    // junction ⇒ skipped{symlink}，且其目标目录没被"额外"扫一遍
    const symlinkSkips = scanned.skipped.filter(entry => entry.reason === 'symlink');
    expect(symlinkSkips.map(entry => entry.path)).toEqual(['link-dir']);
    expect(scanned.files.some(file => file.relPath.startsWith('link-dir/'))).toBe(false);

    // 子目录文件在（证明递归确实发生）
    expect(scanned.files.some(file => file.relPath === 'nested/deep/i.txt')).toBe(true);

    const annotated = annotateZipFiles(scanned.files, { maxFileBytes: 50 * 1024 * 1024 });
    const zip = annotated.files.find(file => file.type === 'zip');
    expect(zip?.zip).toEqual({
      entryCount: 6,
      directoryCount: 1,
      traversalCount: 3,
      encryptedCount: 1,
      oversizedCount: 0,
    });
    const reasons = annotated.extraSkipped.map(entry => `${entry.reason}:${entry.path}`).sort();
    // 条目名原样拼在 `!/` 之后（`/abs.txt` 的条目名本身以 `/` 开头 ⇒ 呈现为 `!//abs.txt`）
    expect(reasons).toEqual([
      'encrypted:bundle.zip!/secret.docx',
      'path_traversal:bundle.zip!/../evil.txt',
      'path_traversal:bundle.zip!//abs.txt',
      'path_traversal:bundle.zip!/C:/win.ini',
    ]);
  });

  it('损坏 ZIP ⇒ readZipEntries 显式 ok:false（不猜、不当空 ZIP）；annotate 把它移出 supported', () => {
    const root = makeFixtureRoot('corrupt');
    const corruptPath = path.join(root, 'broken.zip');
    fs.writeFileSync(corruptPath, Buffer.from('PK\u0003\u0004 definitely not a zip'));

    const result = readZipEntries(corruptPath);
    expect(result.ok).toBe(false);
    expect(result.corrupt).toBe(true);
    expect(result.entryCount).toBe(0);

    const annotated = annotateZipFiles(
      [{ path: corruptPath, relPath: 'broken.zip', size: 32, depth: 0, type: 'zip', supported: true }],
      {},
    );
    expect(annotated.files).toEqual([]);
    expect(annotated.extraSkipped).toHaveLength(1);
    expect(annotated.extraSkipped[0].reason).toBe('corrupt');
    expect(String(annotated.extraSkipped[0].detail?.corruptReason)).toContain('EOCD');
  });
});

// ═══ CLI：报告形状 / 退出码 / 落盘 ═════════════════════════════════════════

describe('run() — report.json 落盘与三态退出码', () => {
  it('[正常] 全类型夹具 ⇒ status=ok、totals.files>0、report.json 真落盘', () => {
    const outRoot = makeFixtureRoot('out');
    const outPath = path.join(outRoot, 'report.json');
    const result = run(['--source', fixture.root, '--out', outPath], {
      now: () => new Date('2026-11-24T01:02:03.000Z'),
      tempRoot: outRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('ok');
    const report = result.report as ReportJson;

    // 任务书 §9 的四个顶层键都在
    expect(Array.isArray(report.supported)).toBe(true);
    expect(Array.isArray(report.unsupported)).toBe(true);
    expect(Array.isArray(report.skipped)).toBe(true);
    expect(typeof report.totals.files).toBe('number');
    expect(report.totals.files).toBeGreaterThan(0);
    expect(report.totals.bytes).toBeGreaterThan(0);
    expect(report.totals.byType.docx).toBe(1);
    expect(report.totals.byType.xlsx).toBe(1);

    const zipItem = report.supported.find(item => item.type === 'zip');
    expect(zipItem?.zip?.entryCount).toBe(fixture.zipCounts.entryCount);
    expect(zipItem?.zip?.traversalCount).toBe(fixture.zipCounts.traversalCount);
    expect(zipItem?.zip?.encryptedCount).toBe(fixture.zipCounts.encryptedCount);

    // 落盘且内容即返回值（报告不是"内存里说说"）
    expect(fs.existsSync(outPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(outPath, 'utf8')) as ReportJson;
    expect(onDisk.schemaVersion).toBe(report.schemaVersion);
    expect(onDisk.totals).toEqual(report.totals);
    expect(onDisk.skipped.map(entry => entry.reason).sort()).toEqual(['encrypted', 'path_traversal', 'path_traversal', 'path_traversal', 'symlink']);
  });

  it('[失败] 文件数超限 ⇒ status=resource_limit + E_RESOURCE_LIMIT + 退出码 1（报告仍落盘，含部分结果）', () => {
    const outRoot = makeFixtureRoot('limit');
    const outPath = path.join(outRoot, 'report.json');
    const result = run(['--source', fixture.root, '--out', outPath, '--max-files', '2'], { tempRoot: outRoot });

    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe('resource_limit');
    const report = result.report as ReportJson;
    expect(report.error?.code).toBe('E_RESOURCE_LIMIT');
    expect(report.error?.phase).toBe('scan');
    // 超限时报告仍落盘（"停下并报"，不是"静默截断"）
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('[失败] 递归深度超限 ⇒ E_RESOURCE_LIMIT（maxDepth）', () => {
    const outRoot = makeFixtureRoot('depth');
    const result = run(['--source', fixture.root, '--out', path.join(outRoot, 'r.json'), '--max-depth', '1'], {
      tempRoot: outRoot,
    });
    expect(result.report.status).toBe('resource_limit');
    expect((result.report as ReportJson).error?.detail.limit).toBe('maxDepth');
  });

  it('[失败] 总时长超限 ⇒ E_RESOURCE_LIMIT（maxDurationMs，时钟注入）', () => {
    const outRoot = makeFixtureRoot('duration');
    let ticks = 0;
    const clock = (): number => {
      ticks += 100;
      return ticks;
    };
    const result = run(['--source', fixture.root, '--out', path.join(outRoot, 'r.json'), '--max-duration-ms', '150'], {
      tempRoot: outRoot,
      clock,
    });
    expect(result.report.status).toBe('resource_limit');
    expect((result.report as ReportJson).error?.detail.limit).toBe('maxDurationMs');
  });

  it('[失败] 单文件超大 ⇒ skipped{oversized} 但整体仍 ok（任务书 §6 逐条原因）', () => {
    const outRoot = makeFixtureRoot('oversized');
    const result = run(['--source', fixture.root, '--out', path.join(outRoot, 'r.json'), '--max-file-bytes', '5'], {
      tempRoot: outRoot,
    });
    const report = result.report as ReportJson;
    expect(result.report.status).toBe('ok');
    const oversized = report.skipped.filter(entry => entry.reason === 'oversized');
    expect(oversized.length).toBeGreaterThan(0);
    expect(oversized.every(entry => typeof entry.detail?.maxFileBytes === 'number')).toBe(true);
  });

  it('[反例] 全部 unsupported ⇒ status=no_supported_input 且退出码 1（禁止"全不支持还报成功"）', () => {
    const root = makeFixtureRoot('allunsupported');
    fs.writeFileSync(path.join(root, 'a.xlsx'), 'x');
    fs.writeFileSync(path.join(root, 'b.exe'), 'y');
    const outRoot = makeFixtureRoot('allunsupported-out');
    const result = run(['--source', root, '--out', path.join(outRoot, 'r.json')], { tempRoot: outRoot });

    expect(result.report.status).toBe('no_supported_input');
    expect(result.exitCode).toBe(1);
    expect((result.report as ReportJson).totals.supported).toBe(0);
    expect((result.report as ReportJson).totals.files).toBe(2);
  });

  it('[失败] 参数错 ⇒ 退出码 2 且不写报告（判不了 ≠ 通过）', () => {
    const missing = run([]);
    expect(missing.exitCode).toBe(2);
    expect(missing.report).toBeNull();
    expect(missing.error?.code).toBe('E_BAD_ARGS');

    const unknown = run(['--source', fixture.root, '--nope']);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.error?.code).toBe('E_BAD_ARGS');

    const badNumber = run(['--source', fixture.root, '--max-files', '0']);
    expect(badNumber.exitCode).toBe(2);

    const notDir = run(['--source', path.join(fixture.root, 'a.docx')]);
    expect(notDir.exitCode).toBe(2);
    expect(notDir.error?.code).toBe('E_INPUT_UNREADABLE');
  });
});

// ═══ CLI 进程级：摘要行 + 默认输出目录 ═══════════════════════════════════════

describe('CLI 进程级契约（被直接执行时）', () => {
  it('node discover.mjs ⇒ stdout 一行摘要 + report.json 落在 %TMP%/ingest-v0/<stamp>/', () => {
    const before = fs.readdirSync(TEMP_ROOT).filter(name => name.startsWith('run-'));
    const stdout = execFileSync(process.execPath, [CLI, '--source', fixture.root], { encoding: 'utf8' });
    const line = stdout.trim().split(/\r?\n/)[0];
    expect(line.startsWith('INGEST-DISCOVER status=ok ')).toBe(true);
    expect(line).toContain('files=');
    expect(line).toContain('supported=');

    const after = fs.readdirSync(TEMP_ROOT).filter(name => name.startsWith('run-'));
    expect(after.length).toBe(before.length + 1);
    const created = after.filter(name => !before.includes(name));
    const reportPath = path.join(TEMP_ROOT, created[0], 'report.json');
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ReportJson;
    expect(report.source).toBe(path.resolve(fixture.root));
    expect(report.totals.files).toBeGreaterThan(0);
    // 摘要里的 out= 与真实落盘一致
    expect(line).toContain(`out=${reportPath}`);
  });

  it('--help ⇒ 退出码 0 且打印用法（无报告）', () => {
    const stdout = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    expect(stdout).toContain('用法: node scripts/ingest-v0/discover.mjs');
    expect(stdout).toContain('默认上限:');
  });
});

// ═══ 少量纯函数（与 CLI 契约强相关，放在本件避免再造一件）══════════════════

describe('parseArgs / defaultOutputPath / exitCodeFor', () => {
  it('默认输出路径只在 %TMP%/ingest-v0/<stamp>/ 下（不用 --out 时）', () => {
    // 用本地时间构造（目录名取本地时钟分量），避免测试机时区影响断言
    const { outputPath, outputDir } = defaultOutputPath(new Date(2026, 10, 24, 1, 2, 3, 456), 'X:/tmp');
    expect(outputDir).toBe(path.join('X:/tmp', 'ingest-v0', 'run-20261124-010203-456'));
    expect(outputPath).toBe(path.join(outputDir, 'report.json'));
  });

  it('三个数值开关都落到对应限额键；重复/未知/非正整数一律 E_BAD_ARGS', () => {
    const parsed = parseArgs(['--source', 'X:/s', '--max-files', '7', '--max-depth', '3']);
    expect(parsed.source).toBe(path.resolve('X:/s'));
    expect(parsed.limits).toEqual({ maxFiles: 7, maxDepth: 3 });
    expect(() => parseArgs(['--source', 'X:/s', '--max-files', '7', '--max-files', '8'])).toThrow(/重复/);
    expect(() => parseArgs(['--source', 'X:/s', '--max-files', 'abc'])).toThrow(/正整数/);
    expect(() => parseArgs(['-x'])).toThrow(/未知开关/);
  });

  it('退出码映射：ok⇒0；resource_limit / no_supported_input⇒1；参数/输入/输出错⇒2', () => {
    expect(exitCodeFor('ok', null)).toBe(0);
    expect(exitCodeFor('no_supported_input', null)).toBe(1);
    expect(exitCodeFor('resource_limit', { code: 'E_RESOURCE_LIMIT' })).toBe(1);
    expect(exitCodeFor('failed', { code: 'E_BAD_ARGS' })).toBe(2);
    expect(exitCodeFor('failed', { code: 'E_INPUT_UNREADABLE' })).toBe(2);
    expect(exitCodeFor('failed', { code: 'E_OUTPUT_WRITE' })).toBe(2);
  });
});
