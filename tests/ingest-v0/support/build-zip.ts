/**
 * tests/ingest-v0/support/build-zip.ts — 测试专用 ZIP 构造器（**仅测试**，不产生产物）。
 *
 * 为什么不引第三方 zip 库：本票只做"读中央目录"，需要的是**可控的恶意/边界条目**（`..`／绝对路径／
 * 盘符／加密位／损坏签名），第三方库反而难以精确构造这些形态，且会引入依赖。
 * 本构造器产"stored（不压缩）"的最小合法 ZIP：local header + data + central directory + EOCD。
 *
 * 已知限制：不支持 ZIP64／分卷／压缩方法 ≠ 0 —— 这些不是本票判据，故意不实现（不做无消费者的框架）。
 */

export interface ZipEntrySpec {
  /** 条目名（原样写入中央目录；测试用它构造 `../x`、`/abs`、`C:/win` 等形态） */
  name: string;
  /** 条目内容（默认空）；只用于算大小，不参与解析判据 */
  data?: Buffer;
  /** 通用位标志（bit0=加密）；默认 0 */
  flags?: number;
  /** 显式指定解压后大小（用于构造"超大条目"用例，覆盖 data 实际长度） */
  uncompressedSize?: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** @input entries 条目规格 @output 合法 ZIP 字节（stored 方法） @degraded 无 @authority 测试夹具 @not-here 不压缩/不加密/不写盘 @error 无 */
export function buildZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  const encodedNames = entries.map(entry => Buffer.from(entry.name, 'utf8'));

  entries.forEach((entry, index) => {
    const nameBytes = encodedNames[index];
    const data = entry.data ?? Buffer.alloc(0);
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const flags = entry.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // method = stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(0, 14); // crc32（不校验，测试不依赖）
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);

    localOffset += 30 + nameBytes.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/** @input size 目标字节数 @output 全零 Buffer（构造"超大文件"夹具，不写盘） @degraded 无 @authority 测试夹具 @not-here 无 @error 无 */
export function zeroBuffer(size: number): Buffer {
  return Buffer.alloc(size);
}
