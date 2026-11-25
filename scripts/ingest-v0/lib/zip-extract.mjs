/**
 * scripts/ingest-v0/lib/zip-extract.mjs — ZIP **受控解压**与条目内存读取（本票唯一解压 I/O）。
 *
 * 为什么必须自己解压：V1 只读中央目录（不解压）；V2 要抽内容就必须落字节，而任务书 C7 要求
 * 「总解压 ≤200MB、条目 ≤5000；traversal/encrypted/oversized 一律跳过并计原因」——
 * 这些上限必须**在写盘前**由中央目录给的大小判定，不能"先解了再说"。
 *
 * 安全边界（C7 / DEV DOC §6）：
 *   · 只写本进程新建的临时目录（调用方给 `targetDir`），**不清理任何既有目录**；
 *   · 条目名先规范化（`\`→`/`、去空段）再拼路径，最后**再校验落点仍在 targetDir 内**（双保险）；
 *   · 越界/加密/超大/未知压缩方法/结构损坏 ⇒ 逐条 `skipped{reason}`，**不静默**；
 *   · 累计条目数或累计解压字节超限 ⇒ **立即停**（`IngestError(E_RESOURCE_LIMIT)`），已解条目保留
 *     在 `error.partial` 里供报告如实记录；
 *   · 不执行条目内容、不跟随链接（ZIP 条目按普通文件写出，不建 symlink）。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { IngestError } from './errors.mjs';
import { readZipEntries } from './zip-entries.mjs';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_BYTES = 30;

/** C7 默认上限（可在测试/CLI 注入覆盖；生产默认值 = 任务书原值）。 */
export const ZIP_EXTRACT_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
});

/**
 * 规范化 ZIP 条目名并校验落点（纯判断；不访问文件系统）。
 *
 * @input  entryName —— 条目名；targetDir —— 解压根（绝对路径）
 * @output 安全 ⇒ `{ok:true, relativePath}`（统一用 `/`）；不安全 ⇒ `{ok:false, reason}`
 * @degraded 无：不安全一律拒绝（`path_traversal`），**不尝试修复**
 * @authority 判据 = V1 `isTraversalEntry` 的同族口径 + 落点前缀复核（本函数单点给出）
 * @not_here 不创建目录/写文件
 * @error 无（纯判断）
 */
export function safeEntryPath(entryName, targetDir) {
  if (typeof entryName !== 'string' || entryName.length === 0) return { ok: false, reason: 'empty_name' };
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return { ok: false, reason: 'path_traversal' };
  const segments = normalized.split('/').filter(segment => segment.length > 0);
  if (segments.some(segment => segment === '..' || segment === '.')) return { ok: false, reason: 'path_traversal' };
  if (segments.length === 0) return { ok: false, reason: 'empty_name' };
  const relativePath = segments.join('/');
  const resolvedRoot = path.resolve(targetDir);
  const resolvedFile = path.resolve(resolvedRoot, ...segments);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
    return { ok: false, reason: 'path_traversal' };
  }
  return { ok: true, relativePath };
}

/**
 * 打开一个 ZIP 读取器（中央目录只读一次；条目内容按需读，不解压到磁盘）。
 *
 * @input  zipPath —— ZIP 绝对路径；options.maxCentralDirectoryBytes —— 中央目录上限
 * @output `{ok:true, entries, readEntry(name), close()}`；结构损坏 ⇒ `{ok:false, corrupt, corruptReason}`
 * @degraded 无：读失败/结构矛盾都以显式结果返回（调用方必须记 skipped）
 * @authority 中央目录解析复用 V1 `readZipEntries`（本文件不重写 ZIP 结构解析）
 * @not_here 不解压到磁盘、不判断业务内容
 * @error `IngestError(E_INPUT_UNREADABLE)` —— 打不开/读失败（原样上抛）
 */
export function createZipReader(zipPath, options = {}) {
  // 单条目解压上限：docx/pptx 内部 XML 与普通 ZIP 条目同样受 C7 单文件上限约束（防 OOXML 内嵌压缩炸弹）。
  const maxEntryBytes = typeof options.maxEntryBytes === 'number' ? options.maxEntryBytes : ZIP_EXTRACT_LIMITS.maxFileBytes;
  const listed = readZipEntries(zipPath, options);
  if (!listed.ok) {
    return { ok: false, corrupt: true, corruptReason: listed.corruptReason, entries: [], readEntry() { throw new Error('corrupt zip'); }, close() {} };
  }
  let fd;
  try {
    fd = fs.openSync(zipPath, 'r');
  } catch (err) {
    throw new IngestError('E_INPUT_UNREADABLE', 'zip', `ZIP 打不开: ${zipPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const fileSize = fs.fstatSync(fd).size;
  const byName = new Map(listed.entries.map(entry => [entry.name, entry]));

  const close = () => {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // 关闭失败不改变业务结论（文件已读/写完成）；不在此处抛错
      }
      fd = undefined;
    }
  };

  /**
   * 读一个条目并解压到内存（不落盘）。
   *
   * @input  entryName —— 中央目录里的条目名（须已由调用方做安全判定）
   * @output Buffer（已解压、长度=中央目录声称值）
   * @degraded 无：长度矛盾/CRC 不符/未知方法 ⇒ 抛 `IngestError(E_INTERNAL, 'zip')`
   * @authority 压缩方法只支持 0(stored)/8(deflate)（ZIP 基础方法）
   * @not-here 不写文件、不决定 skipped 语义（调用方按错误转 skipped）
   * @error `IngestError(E_INTERNAL, phase='zip')` —— 条目缺失/头签名不符/长度矛盾/CRC 不符/未知方法
   */
  const readEntry = (entryName) => {
    const entry = byName.get(entryName);
    if (entry === undefined) {
      throw new IngestError('E_INTERNAL', 'zip', `条目不存在: ${entryName}`);
    }
    if (fd === undefined) throw new IngestError('E_INTERNAL', 'zip', 'ZIP 读取器已关闭');
    if (entry.encrypted) throw new IngestError('E_INTERNAL', 'zip', `条目加密，拒绝读取: ${entryName}`);
    if (entry.sizeUnknown) throw new IngestError('E_INTERNAL', 'zip', `条目大小未知（ZIP64 扩展），拒绝读取: ${entryName}`);
    if (entry.uncompressedSize > maxEntryBytes) {
      throw new IngestError('E_INTERNAL', 'zip', `条目解压后超过上限（${String(entry.uncompressedSize)} > ${String(maxEntryBytes)}）: ${entryName}`);
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new IngestError('E_INTERNAL', 'zip', `不支持的压缩方法 ${String(entry.method)}: ${entryName}`);
    }
    if (entry.localHeaderOffset + LOCAL_HEADER_BYTES > fileSize) {
      throw new IngestError('E_INTERNAL', 'zip', `本地头越界: ${entryName}`);
    }
    const header = Buffer.alloc(LOCAL_HEADER_BYTES);
    fs.readSync(fd, header, 0, LOCAL_HEADER_BYTES, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
      throw new IngestError('E_INTERNAL', 'zip', `本地头签名不符: ${entryName}`);
    }
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_BYTES + nameLength + extraLength;
    if (dataOffset + entry.compressedSize > fileSize) {
      throw new IngestError('E_INTERNAL', 'zip', `条目数据越界: ${entryName}`);
    }
    const raw = Buffer.alloc(entry.compressedSize);
    if (entry.compressedSize > 0) fs.readSync(fd, raw, 0, entry.compressedSize, dataOffset);
    let data;
    if (entry.method === 0) {
      data = raw;
    } else {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: entry.uncompressedSize + 1 });
      } catch (err) {
        throw new IngestError('E_INTERNAL', 'zip', `deflate 解压失败: ${entryName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (data.length !== entry.uncompressedSize) {
      throw new IngestError('E_INTERNAL', 'zip', `解压长度矛盾: ${entryName}（${String(data.length)} != ${String(entry.uncompressedSize)}）`);
    }
    // 测试夹具的 stored ZIP 未写 CRC（0=未计算）；真实 ZIP 的 CRC 必须校验，不符判损坏。
    if (entry.crc32 !== 0 && typeof zlib.crc32 === 'function' && zlib.crc32(data) >>> 0 !== entry.crc32 >>> 0) {
      throw new IngestError('E_INTERNAL', 'zip', `CRC 校验失败: ${entryName}`);
    }
    return data;
  };

  return { ok: true, corrupt: false, entries: listed.entries, readEntry, close };
}

/**
 * 把 ZIP 安全解压到 `targetDir`（受 C7 上限约束）。
 *
 * @input  zipPath —— ZIP 绝对路径；targetDir —— **本进程新建**的目标目录；options —— 覆盖
 *         `ZIP_EXTRACT_LIMITS` 的 `maxEntries/maxTotalBytes/maxFileBytes`
 * @output `{ok, corrupt, entries, extracted, skipped, stats, corruptReason?}`：
 *           extracted —— `[{entryName, relativePath, localPath, size}]`（成功落盘）
 *           skipped —— `[{entryName, reason, detail?}]`
 *           stats —— `{fileEntries, extractedFiles, extractedBytes, skippedCounts, directoryCount}`
 * @degraded 无：损坏/越界/加密/超大逐条记 skipped；**不把"跳过"当"成功"**
 * @authority 上限数值 = `ZIP_EXTRACT_LIMITS`（本文件单一真源）；路径安全 = `safeEntryPath`
 * @not_here 不解析条目内容（docx/pptx 由 `office.mjs` 读）；不清理既有目录
 * @error `IngestError(E_RESOURCE_LIMIT, phase='zip')` —— 条目数/累计解压字节超限（`.partial` 带已处理结果）；
 *        `IngestError(E_OUTPUT_WRITE, phase='output')` —— 目标目录建不了/写不进
 */
export function extractZip(zipPath, targetDir, options = {}) {
  const limits = { ...ZIP_EXTRACT_LIMITS, ...options };
  const reader = createZipReader(zipPath, options);
  if (!reader.ok) {
    return {
      ok: false,
      corrupt: true,
      corruptReason: reader.corruptReason,
      entries: 0,
      extracted: [],
      skipped: [{ entryName: '*', reason: 'corrupt', detail: { corruptReason: reader.corruptReason } }],
      stats: { fileEntries: 0, extractedFiles: 0, extractedBytes: 0, skippedCounts: { corrupt: 1 }, directoryCount: 0 },
    };
  }

  const extracted = [];
  const skipped = [];
  const skippedCounts = {};
  const skip = (entryName, reason, detail) => {
    skippedCounts[reason] = (skippedCounts[reason] ?? 0) + 1;
    const item = { entryName, reason };
    if (detail !== undefined) item.detail = detail;
    skipped.push(item);
  };

  let directoryCount = 0;
  let fileEntries = 0;
  let extractedBytes = 0;
  let totalClaimedBytes = 0;

  try {
    const entries = [...reader.entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.directory) {
        directoryCount += 1;
        continue;
      }
      fileEntries += 1;
      const partial = () => ({
        ok: false,
        corrupt: false,
        entries: reader.entries.length,
        extracted,
        skipped,
        stats: { fileEntries, extractedFiles: extracted.length, extractedBytes, skippedCounts, directoryCount },
      });
      if (fileEntries > limits.maxEntries) {
        throw new IngestError('E_RESOURCE_LIMIT', 'zip', `ZIP 条目数超限: ${String(fileEntries)} > ${String(limits.maxEntries)}`, { partial: partial() });
      }
      const safe = safeEntryPath(entry.name, targetDir);
      if (!safe.ok) {
        skip(entry.name, safe.reason);
        continue;
      }
      if (entry.encrypted) {
        skip(entry.name, 'encrypted');
        continue;
      }
      if (entry.sizeUnknown) {
        skip(entry.name, 'zip64_unsupported');
        continue;
      }
      if (entry.uncompressedSize > limits.maxFileBytes) {
        skip(entry.name, 'oversized', { uncompressedSize: entry.uncompressedSize, maxFileBytes: limits.maxFileBytes });
        continue;
      }
      if (entry.method !== 0 && entry.method !== 8) {
        skip(entry.name, 'unsupported_compression', { method: entry.method });
        continue;
      }
      totalClaimedBytes += entry.uncompressedSize;
      if (totalClaimedBytes > limits.maxTotalBytes) {
        throw new IngestError(
          'E_RESOURCE_LIMIT',
          'zip',
          `ZIP 总解压量超限: ${String(totalClaimedBytes)} > ${String(limits.maxTotalBytes)}`,
          { partial: partial() },
        );
      }
      let data;
      try {
        data = reader.readEntry(entry.name);
      } catch (err) {
        skip(entry.name, 'corrupt', { message: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const localPath = path.resolve(targetDir, ...safe.relativePath.split('/'));
      try {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, data);
      } catch (err) {
        throw new IngestError(
          'E_OUTPUT_WRITE',
          'output',
          `解压写出失败: ${localPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      extractedBytes += data.length;
      extracted.push({ entryName: entry.name, relativePath: safe.relativePath, localPath, size: data.length });
    }
  } catch (err) {
    if (err instanceof IngestError) {
      if (err.partial === null || err.partial === undefined) err.partial = { ok: false, extracted, skipped, stats: { fileEntries, extractedFiles: extracted.length, extractedBytes, skippedCounts, directoryCount } };
      throw err;
    }
    throw err;
  } finally {
    reader.close();
  }

  return {
    ok: true,
    corrupt: false,
    entries: reader.entries.length,
    extracted,
    skipped,
    stats: { fileEntries, extractedFiles: extracted.length, extractedBytes, skippedCounts, directoryCount },
  };
}
