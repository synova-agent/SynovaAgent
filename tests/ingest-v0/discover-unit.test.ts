/**
 * tests/ingest-v0/discover-unit.test.ts — V1 发现层**纯函数**判据（#1492 / 任务书 B 段）。
 *
 * 为什么单列纯函数：分类（类型/越界判定）、限额账本、报告形状、ZIP 中央目录解析都是**可脱离磁盘**的判定，
 * 它们的边界（第 N 个文件、`C:/win`、加密位、损坏签名）必须确定性可测；真实目录跑不到这些形态。
 *
 * 覆盖：
 *   · classify：8 类支持型 + 未支持型 + 大小写不敏感 + 无扩展名；`isTraversalEntry` 四种越界形态
 *   · budget：文件数／总字节／深度／时长**超限即抛 E_RESOURCE_LIMIT**；单文件超大 ⇒ oversized（不抛）
 *   · report：supported/unsupported/skipped 分流、totals 口径、`全部 unsupported` ⇒ 非 ok 状态
 *   · zip：EOCD 定位 + 中央目录解析（含加密位、目录条目、越界条目、损坏签名）
 */
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_TYPES,
  classifyFileName,
  extensionBucket,
  extensionOf,
  isTraversalEntry,
} from '../../scripts/ingest-v0/lib/classify.mjs';
import {
  DEFAULT_LIMITS,
  admitFile,
  checkDepth,
  createBudget,
} from '../../scripts/ingest-v0/lib/budget.mjs';
import { buildReport, deriveStatus, summarize } from '../../scripts/ingest-v0/lib/report.mjs';
import {
  EOCD_TAIL_BYTES,
  locateEndOfCentralDirectory,
  parseCentralDirectory,
} from '../../scripts/ingest-v0/lib/zip-entries.mjs';
import { buildZip } from './support/build-zip';

const MB = 1024 * 1024;

// ═══ classify ═══════════════════════════════════════════════════════════════

describe('classify — 类型分类（8 类支持型 + 未支持型）', () => {
  it('八类支持型逐个可分类；`.htm` 与 `.html` 同型', () => {
    const cases: Array<[string, string]> = [
      ['a.docx', 'docx'],
      ['a.pptx', 'pptx'],
      ['a.pdf', 'pdf'],
      ['a.html', 'html'],
      ['a.htm', 'html'],
      ['a.json', 'json'],
      ['a.md', 'md'],
      ['a.markdown', 'md'],
      ['a.txt', 'txt'],
      ['a.zip', 'zip'],
    ];
    for (const [name, type] of cases) {
      const result = classifyFileName(name);
      expect(result.supported).toBe(true);
      expect(result.type).toBe(type);
      expect(SUPPORTED_TYPES).toContain(type);
    }
  });

  it('大小写不敏感（`.DOCX` / `.PDF`）', () => {
    expect(classifyFileName('报表.DOCX').type).toBe('docx');
    expect(classifyFileName('报表.PDF').type).toBe('pdf');
    expect(extensionOf('报表.PDF')).toBe('.pdf');
  });

  it('未支持型 ⇒ supported:false + reason:unsupported_type（不猜类型）', () => {
    for (const name of ['a.xlsx', 'a.csv', 'a.png', 'a.exe', 'a.bin']) {
      const result = classifyFileName(name);
      expect(result.supported).toBe(false);
      expect(result.reason).toBe('unsupported_type');
      expect(result.type).toBe('other');
    }
  });

  it('无扩展名 / 以点结尾 ⇒ 未支持（no_ext 桶）', () => {
    expect(classifyFileName('README').supported).toBe(false);
    expect(extensionOf('README')).toBe('');
    expect(extensionBucket('README')).toBe('no_ext');
    expect(classifyFileName('weird.').supported).toBe(false);
  });

  it('目录段里的点不影响扩展名判定（只取末段）', () => {
    expect(extensionOf('a.b.c/report.txt')).toBe('.txt');
    expect(extensionBucket('dir.v2/data.json')).toBe('json');
  });
});

describe('classify — ZIP 条目越界判定（path_traversal）', () => {
  it('四种越界形态全部命中', () => {
    expect(isTraversalEntry('../evil.txt')).toBe(true);
    expect(isTraversalEntry('a/../b.txt')).toBe(true);
    expect(isTraversalEntry('/etc/passwd')).toBe(true);
    expect(isTraversalEntry('C:/Windows/win.ini')).toBe(true);
    expect(isTraversalEntry('C:win.ini')).toBe(true);
    expect(isTraversalEntry('\\\\server\\share\\x.txt')).toBe(true);
    expect(isTraversalEntry('..\\evil.txt')).toBe(true);
    expect(isTraversalEntry('x/..')).toBe(true);
  });

  it('安全形态不命中（含中文名与相对子目录）', () => {
    expect(isTraversalEntry('dir/a.txt')).toBe(false);
    expect(isTraversalEntry('a..b/c.txt')).toBe(false);
    expect(isTraversalEntry('.../x.txt')).toBe(false);
    expect(isTraversalEntry('哇呢宝贝资料留底/制度-v1.docx')).toBe(false);
    expect(isTraversalEntry('')).toBe(false);
  });
});

// ═══ budget ═════════════════════════════════════════════════════════════════

describe('budget — 资源上限（超限即抛 E_RESOURCE_LIMIT）', () => {
  it('文件数超限 ⇒ E_RESOURCE_LIMIT（maxFiles）', () => {
    const budget = createBudget({ maxFiles: 2 });
    admitFile(budget, { size: 1, path: 'a.txt' }, 0);
    admitFile(budget, { size: 1, path: 'b.txt' }, 0);
    let caught: unknown;
    try {
      admitFile(budget, { size: 1, path: 'c.txt' }, 0);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code: string }).code).toBe('E_RESOURCE_LIMIT');
    expect((caught as { detail: { limit: string } }).detail.limit).toBe('maxFiles');
  });

  it('总字节超限 ⇒ E_RESOURCE_LIMIT（maxTotalBytes）', () => {
    const budget = createBudget({ maxTotalBytes: 100 });
    admitFile(budget, { size: 60, path: 'a.bin' }, 0);
    let caught: unknown;
    try {
      admitFile(budget, { size: 60, path: 'b.bin' }, 0);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code: string }).code).toBe('E_RESOURCE_LIMIT');
    expect((caught as { detail: { limit: string } }).detail.limit).toBe('maxTotalBytes');
  });

  it('单文件超大 ⇒ 不中断（oversized 交调用方记 skipped）', () => {
    const budget = createBudget({ maxFileBytes: 10 });
    const result = admitFile(budget, { size: 11, path: 'big.docx' }, 0);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('oversized');
    // 仍然计入扫描面（files/bytes），不因大小而"看不见"
    expect(budget.files).toBe(1);
    expect(budget.bytes).toBe(11);
  });

  it('深度超限 ⇒ E_RESOURCE_LIMIT（maxDepth）', () => {
    const budget = createBudget({ maxDepth: 2 });
    checkDepth(budget, 2, 'a/b');
    let caught: unknown;
    try {
      checkDepth(budget, 3, 'a/b/c');
    } catch (err) {
      caught = err;
    }
    expect((caught as { detail: { limit: string } }).detail.limit).toBe('maxDepth');
  });

  it('时长超限 ⇒ E_RESOURCE_LIMIT（maxDurationMs；时钟注入）', () => {
    const budget = createBudget({ maxDurationMs: 1_000 }, 10_000);
    admitFile(budget, { size: 1, path: 'a.txt' }, 11_000);
    let caught: unknown;
    try {
      admitFile(budget, { size: 1, path: 'b.txt' }, 11_001);
    } catch (err) {
      caught = err;
    }
    expect((caught as { detail: { limit: string } }).detail.limit).toBe('maxDurationMs');
  });

  it('默认上限 = 任务书原值（5000／500MB／50MB／8／600000ms）', () => {
    expect(DEFAULT_LIMITS.maxFiles).toBe(5000);
    expect(DEFAULT_LIMITS.maxTotalBytes).toBe(500 * MB);
    expect(DEFAULT_LIMITS.maxFileBytes).toBe(50 * MB);
    expect(DEFAULT_LIMITS.maxDepth).toBe(8);
    expect(DEFAULT_LIMITS.maxDurationMs).toBe(10 * 60 * 1000);
  });

  it('默认上限的**行为面**（不是常量镜像）：第 5001 个文件抛、51MB 判 oversized、深度 9 抛', () => {
    const files = createBudget({});
    for (let index = 1; index <= 5000; index += 1) admitFile(files, { size: 1, path: `f${index}` }, 0);
    expect(files.files).toBe(5000);
    expect(() => admitFile(files, { size: 1, path: 'f5001' }, 0)).toThrow(/maxFiles/);

    const sizing = createBudget({});
    const big = admitFile(sizing, { size: 51 * MB, path: 'big.docx' }, 0);
    expect(big.accepted).toBe(false);
    expect(big.reason).toBe('oversized');

    const depths = createBudget({});
    checkDepth(depths, 8, 'a/b/c/d/e/f/g/h');
    expect(() => checkDepth(depths, 9, 'a/b/c/d/e/f/g/h/i')).toThrow(/maxDepth/);
  });
});

// ═══ report ═════════════════════════════════════════════════════════════════

describe('report — 形状与状态（全部 unsupported 不算成功）', () => {
  const baseInput = {
    source: 'X:/src',
    limits: { maxFiles: 5000 },
    startedAt: '2026-11-24T00:00:00.000Z',
    finishedAt: '2026-11-24T00:00:01.000Z',
    durationMs: 1000,
  };

  it('supported/unsupported/skipped 分流 + totals.byType 按扩展名计数', () => {
    const report = buildReport({
      ...baseInput,
      status: 'ok',
      files: [
        { relPath: 'a.docx', path: 'X:/src/a.docx', size: 10, depth: 0, type: 'docx', supported: true },
        { relPath: 'b.xlsx', path: 'X:/src/b.xlsx', size: 20, depth: 0, type: 'other', supported: false, reason: 'unsupported_type' },
      ],
      walkSkipped: [{ path: 'link', reason: 'symlink' }],
      extraSkipped: [{ path: 'c.zip!/../evil', reason: 'path_traversal' }],
    });

    expect(report.supported.map(item => item.path)).toEqual(['a.docx']);
    expect(report.unsupported).toHaveLength(1);
    expect(report.unsupported[0].reason).toBe('unsupported_type');
    expect(report.skipped.map(item => item.reason).sort()).toEqual(['path_traversal', 'symlink']);
    expect(report.totals.files).toBe(2);
    expect(report.totals.bytes).toBe(30);
    expect(report.totals.byType).toEqual({ docx: 1, xlsx: 1 });
    expect(report.totals.supported).toBe(1);
    expect(report.totals.unsupported).toBe(1);
    expect(report.totals.skipped).toBe(2);
  });

  it('零 supported ⇒ status=no_supported_input（禁止"全部 unsupported 还算成功"）', () => {
    const status = deriveStatus({ supportedCount: 0, error: null });
    expect(status).toBe('no_supported_input');
    expect(deriveStatus({ supportedCount: 1, error: null })).toBe('ok');
    expect(deriveStatus({ supportedCount: 0, error: { code: 'E_RESOURCE_LIMIT' } })).toBe('resource_limit');
    expect(deriveStatus({ supportedCount: 0, error: { code: 'E_INPUT_UNREADABLE' } })).toBe('failed');
  });

  it('摘要行字段固定（下游 grep 依赖）', () => {
    const report = buildReport({ ...baseInput, status: 'ok', files: [], walkSkipped: [], extraSkipped: [] });
    const line = summarize(report, 'X:/out/report.json');
    expect(line).toBe('INGEST-DISCOVER status=ok files=0 supported=0 unsupported=0 skipped=0 bytes=0 out=X:/out/report.json');
  });
});

// ═══ ZIP 解析（纯，不经文件系统）═════════════════════════════════════════════

describe('zip-entries — EOCD 定位与中央目录解析', () => {
  it('定位 EOCD 并解析条目：加密位/目录条目/越界条目/大小', () => {
    const zip = buildZip([
      { name: 'dir/' },
      { name: 'dir/ok.txt', data: Buffer.from('hello') },
      { name: '../evil.txt', data: Buffer.from('x') },
      { name: 'C:/win.ini', data: Buffer.from('y') },
      { name: 'secret.docx', data: Buffer.from('z'), flags: 0x1 },
      { name: 'big.pdf', uncompressedSize: 999 },
    ]);
    const tail = zip.subarray(Math.max(0, zip.length - EOCD_TAIL_BYTES));
    const eocd = locateEndOfCentralDirectory(tail);
    expect(eocd).not.toBeNull();
    if (eocd === null) throw new Error('EOCD 未定位');
    expect(eocd.entryCount).toBe(6);
    expect(eocd.needsZip64).toBe(false);

    const centralDirectory = zip.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize);
    const parsed = parseCentralDirectory(centralDirectory, eocd.entryCount);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('中央目录解析失败');
    const byName = new Map(parsed.entries.map(entry => [entry.name, entry]));
    expect(byName.get('dir/')?.directory).toBe(true);
    expect(byName.get('dir/ok.txt')?.traversal).toBe(false);
    expect(byName.get('dir/ok.txt')?.uncompressedSize).toBe(5);
    expect(byName.get('../evil.txt')?.traversal).toBe(true);
    expect(byName.get('C:/win.ini')?.traversal).toBe(true);
    expect(byName.get('secret.docx')?.encrypted).toBe(true);
    expect(byName.get('big.pdf')?.uncompressedSize).toBe(999);
  });

  it('非 ZIP 字节 ⇒ 定位失败（不猜、不当空 ZIP）', () => {
    const notZip = Buffer.from('这不是 ZIP'.repeat(10), 'utf8');
    expect(locateEndOfCentralDirectory(notZip)).toBeNull();
  });

  it('中央目录签名被破坏 ⇒ ok:false + corruptReason（不静默返回部分结果）', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('a') }]);
    const tail = zip.subarray(Math.max(0, zip.length - EOCD_TAIL_BYTES));
    const eocd = locateEndOfCentralDirectory(tail);
    if (eocd === null) throw new Error('EOCD 未定位');
    const centralDirectory = Buffer.from(zip.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize));
    centralDirectory.writeUInt32LE(0xdeadbeef, 0);
    const parsed = parseCentralDirectory(centralDirectory, eocd.entryCount);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('损坏签名不应 ok');
    expect(parsed.corruptReason).toContain('签名不符');
  });
});
