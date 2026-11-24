/**
 * scripts/ingest-v0/lib/zip-entries.mjs — ZIP **只枚举不解压**（读中央目录，绝不膨胀条目内容）。
 *
 * 为什么必须是"读中央目录"而不是"边解压边看名字"：解压才能校验的防穿越已经太晚（条目可能已落盘），
 * 且解压会引入 zip bomb 风险。ZIP 的中央目录（End Of Central Directory → 中央目录记录）自带
 * 全部条目名与大小，**只读这部分**即可完成发现与越界判定。
 *
 * 安全边界（任务书 §4／§6）：
 *   · 只读中央目录字节，**不解压任何条目、不写任何文件**；
 *   · 条目名越界（`..`／绝对路径／盘符／UNC）由 `classify.isTraversalEntry` 判定（单一真源）；
 *   · 加密位（general purpose flag bit 0）逐条读出 ⇒ 由调用方记 `skipped{reason:'encrypted'}`；
 *   · 中央目录缺失/签名不符/长度矛盾 ⇒ 归为 `corrupt`（**不猜、不跳过、不当空 ZIP**）。
 *
 * 已知限制（不在本层解决，登记给 V2 抽取层）：
 *   · 条目名编码：仅尊重 UTF-8 标志位（bit 11），其余按 UTF-8 尽力解码；名称只用于安全判定与展示，
 *     **不参与任何落盘路径拼装**，故编码误差不影响防穿越结论；
 *   · 不支持分卷（multi-disk）ZIP ⇒ 记 `corrupt`（reason=`multi_disk_zip`）；
 *   · 不支持 ZIP64 之外的其它扩展（如 AES 加密扩展的具体算法）——只需枚举，无需解密。
 */

import fs from 'node:fs';
import { IngestError } from './errors.mjs';
import { isTraversalEntry } from './classify.mjs';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;

/** EOCD 固定部分 22 字节 ＋ 注释上限 65535 字节 ⇒ 尾部窗口 */
const EOCD_MAX_COMMENT = 0xffff;
export const EOCD_TAIL_BYTES = 22 + EOCD_MAX_COMMENT;

/** 中央目录体积上限（超过即判 corrupt：真实目录不会这么大，异常大小更像构造攻击/损坏） */
export const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

/** `0xFFFFFFFF` = 该字段在 ZIP64 扩展记录里（4 字节装不下） */
const ZIP64_SENTINEL32 = 0xffffffff;

/**
 * 在尾部窗口里定位 EOCD（纯函数）。
 *
 * @input  tail —— 文件**末尾**最多 `EOCD_TAIL_BYTES` 字节
 * @output 命中 ⇒ `{eocdOffset, cdOffset, cdSize, entryCount, needsZip64}`；
 *         未命中 ⇒ `null`（调用方判 corrupt）
 * @degraded 无：找不到就是找不到（**不当空 ZIP、不回退猜测**）
 * @authority EOCD 结构以 ZIP 规范（APPNOTE 4.3.16）为准，偏移量在本函数单一真源给出
 * @not-here 不解 ZIP64 扩展记录（`readZip64EndOfCentralDirectory` 负责）、不读中央目录
 * @error 无（纯解析，不抛）
 */
export function locateEndOfCentralDirectory(tail) {
  if (!Buffer.isBuffer(tail) || tail.length < 22) return null;
  // 从尾部往前找签名（EOCD 后面可能跟任意长度注释）
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength > tail.length) continue; // 注释长度越界 ⇒ 不是真 EOCD
    const entryCount = tail.readUInt16LE(offset + 10);
    const cdSize = tail.readUInt32LE(offset + 12);
    const cdOffset = tail.readUInt32LE(offset + 16);
    return {
      eocdOffset: offset,
      cdOffset,
      cdSize,
      entryCount,
      needsZip64: entryCount === 0xffff || cdSize === ZIP64_SENTINEL32 || cdOffset === ZIP64_SENTINEL32,
    };
  }
  return null;
}

/**
 * 解析 ZIP64 EOCD（纯函数；`needsZip64` 时才调用）。
 *
 * @input  tail —— 同 `locateEndOfCentralDirectory` 的尾部窗口；eocdOffset —— EOCD 在窗口内的偏移
 *         readAt —— `(absolutePosition, length) => Buffer`，由 I/O 层提供（本函数只用它读 20/56 字节）
 * @output `{cdOffset, cdSize, entryCount}`（8 字节字段已收窄为 Number）
 * @degraded 无
 * @authority ZIP64 结构（APPNOTE 4.3.14／4.3.15）
 * @not-here 不做 I/O 决策（读多少由调用方给）
 * @error `IngestError(E_INTERNAL, phase='zip')` —— 定位器/记录缺失或签名不符（归为 corrupt 由调用方转换）
 */
export function readZip64EndOfCentralDirectory(tail, eocdOffset, readAt) {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0) {
    throw new IngestError('E_INTERNAL', 'zip', 'ZIP64 定位器超出尾部窗口（EOCD 前不足 20 字节）');
  }
  if (tail.readUInt32LE(locatorOffset) !== ZIP64_LOCATOR_SIGNATURE) {
    throw new IngestError('E_INTERNAL', 'zip', `ZIP64 定位器签名不符（实得 0x${tail.readUInt32LE(locatorOffset).toString(16)}）`);
  }
  const totalDisks = tail.readUInt32LE(locatorOffset + 16);
  if (totalDisks > 1) {
    throw new IngestError('E_INTERNAL', 'zip', `不支持分卷 ZIP（totalDisks=${String(totalDisks)}）`);
  }
  const zip64EocdOffsetBig = tail.readBigUInt64LE(locatorOffset + 8);
  if (zip64EocdOffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new IngestError('E_INTERNAL', 'zip', 'ZIP64 EOCD 偏移超出可安全表示范围');
  }
  const record = readAt(Number(zip64EocdOffsetBig), 56);
  if (record.length < 56 || record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
    throw new IngestError('E_INTERNAL', 'zip', 'ZIP64 EOCD 记录缺失或签名不符');
  }
  const cdSizeBig = record.readBigUInt64LE(40);
  const cdOffsetBig = record.readBigUInt64LE(48);
  if (cdSizeBig > BigInt(Number.MAX_SAFE_INTEGER) || cdOffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new IngestError('E_INTERNAL', 'zip', 'ZIP64 中央目录偏移/长度超出可安全表示范围');
  }
  return {
    cdOffset: Number(cdOffsetBig),
    cdSize: Number(cdSizeBig),
    entryCount: Number(record.readBigUInt64LE(32)),
  };
}

/**
 * 解析中央目录（纯函数）。
 *
 * @input  cd —— 中央目录字节（自 `cdOffset` 起，长度 ≥ `cdSize`）；entryCount —— 期望记录数
 * @output `{ok:true, entries:[{name, flags, encrypted, method, compressedSize, uncompressedSize,
 *          traversal, directory, sizeUnknown}]}`；或 `{ok:false, corruptReason}`
 * @degraded **无静默降级**：任何结构矛盾 ⇒ `ok:false`（调用方记 `skipped{reason:'corrupt'}`）
 * @authority 记录解析偏移以 APPNOTE 4.3.12 为准；`traversal` 只由 `classify.isTraversalEntry` 判定
 * @not-here 不解压、不校验 CRC、不读 local header
 * @error 无（结构矛盾以返回值表达，不抛；I/O 异常由调用方处理）
 */
export function parseCentralDirectory(cd, entryCount) {
  const entries = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > cd.length) return { ok: false, corruptReason: `中央目录记录越界（第 ${String(index + 1)} 条，offset=${String(offset)}）` };
    if (cd.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
      return { ok: false, corruptReason: `中央目录签名不符（第 ${String(index + 1)} 条，offset=${String(offset)}）` };
    }
    const flags = cd.readUInt16LE(offset + 8);
    const method = cd.readUInt16LE(offset + 10);
    const compressedSize = cd.readUInt32LE(offset + 20);
    const uncompressedSize = cd.readUInt32LE(offset + 24);
    const nameLength = cd.readUInt16LE(offset + 28);
    const extraLength = cd.readUInt16LE(offset + 30);
    const commentLength = cd.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength + extraLength + commentLength > cd.length) {
      return { ok: false, corruptReason: `中央目录记录长度矛盾（第 ${String(index + 1)} 条）` };
    }
    const name = cd.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const normalizedName = name.replace(/\\/g, '/');
    entries.push({
      name,
      flags,
      encrypted: (flags & 0x1) === 0x1,
      method,
      compressedSize,
      uncompressedSize,
      sizeUnknown: compressedSize === ZIP64_SENTINEL32 || uncompressedSize === ZIP64_SENTINEL32,
      directory: normalizedName.endsWith('/'),
      traversal: isTraversalEntry(name),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, entries };
}

/**
 * 枚举一个 ZIP 文件的条目（**唯一 I/O 入口**；只读中央目录字节）。
 *
 * @input  filePath —— ZIP 绝对路径；options.maxCentralDirectoryBytes —— 中央目录体积上限
 * @output `{ok:true, entryCount, entries, encryptedCount, traversalCount, oversizedCount}`；
 *         结构损坏 ⇒ `{ok:false, corrupt:true, corruptReason, entryCount:0, entries:[]}`
 * @degraded **无静默降级**：读失败/结构矛盾都变成 `ok:false` 的显式结果（调用方必须记 skipped）
 * @authority 条目名越界判定复用 `classify.isTraversalEntry`；本文件不另写判据
 * @not-here 不解压条目、不写任何文件、不联网；也不判断条目内容是否"可解析"
 * @error `IngestError(E_INPUT_UNREADABLE, phase='zip')` —— 文件打不开/读失败（IO 错误原样上抛）
 */
export function readZipEntries(filePath, options = {}) {
  const maxCdBytes = options.maxCentralDirectoryBytes ?? MAX_CENTRAL_DIRECTORY_BYTES;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (err) {
    throw new IngestError('E_INPUT_UNREADABLE', 'zip', `ZIP 打不开: ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    const tailLength = Math.min(size, EOCD_TAIL_BYTES);
    const tail = Buffer.alloc(tailLength);
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);

    const located = locateEndOfCentralDirectory(tail);
    if (located === null) {
      return { ok: false, corrupt: true, corruptReason: '找不到 EOCD（不是 ZIP 或尾部被截断）', entryCount: 0, entries: [] };
    }

    let cdOffset = located.cdOffset;
    let cdSize = located.cdSize;
    let entryCount = located.entryCount;
    if (located.needsZip64) {
      try {
        const zip64 = readZip64EndOfCentralDirectory(tail, located.eocdOffset, (position, length) => {
          const buffer = Buffer.alloc(length);
          fs.readSync(fd, buffer, 0, length, position);
          return buffer;
        });
        cdOffset = zip64.cdOffset;
        cdSize = zip64.cdSize;
        entryCount = zip64.entryCount;
      } catch (err) {
        return {
          ok: false,
          corrupt: true,
          corruptReason: err instanceof Error ? err.message : String(err),
          entryCount: 0,
          entries: [],
        };
      }
    }

    if (cdSize > maxCdBytes) {
      return { ok: false, corrupt: true, corruptReason: `中央目录过大（${String(cdSize)} B > 上限 ${String(maxCdBytes)} B）`, entryCount: 0, entries: [] };
    }
    if (cdOffset + cdSize > size) {
      return { ok: false, corrupt: true, corruptReason: `中央目录越界（offset=${String(cdOffset)} size=${String(cdSize)} file=${String(size)}）`, entryCount: 0, entries: [] };
    }

    const cd = Buffer.alloc(cdSize);
    if (cdSize > 0) fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const parsed = parseCentralDirectory(cd, entryCount);
    if (!parsed.ok) {
      return { ok: false, corrupt: true, corruptReason: parsed.corruptReason, entryCount: 0, entries: [] };
    }

    const entries = parsed.entries;
    return {
      ok: true,
      corrupt: false,
      entryCount: entries.length,
      entries,
      encryptedCount: entries.filter(entry => entry.encrypted).length,
      traversalCount: entries.filter(entry => entry.traversal).length,
      oversizedCount: 0,
    };
  } finally {
    fs.closeSync(fd);
  }
}
