/**
 * tests/ingest-v0/support/build-zip.ts — 测试专用 ZIP 构造器（**仅测试**，不产生产物）。
 *
 * 为什么不引第三方 zip 库：本票要造的是**可控的恶意/边界条目**（`..`／绝对路径／盘符／加密位／
 * 损坏签名／压缩方法），第三方库反而难以精确构造这些形态，且会引入依赖。
 * 本构造器产最小合法 ZIP：local header + data + central directory + EOCD。
 *
 * 支持：stored（方法 0）与 deflate（方法 8）；CRC32 真实计算（V2 解压层的 CRC 校验需要真值）。
 * 已知限制：不支持 ZIP64／分卷（不是本票判据，故意不实现）。
 */

import { deflateRawSync } from 'node:zlib';

export interface ZipEntrySpec {
  /** 条目名（原样写入中央目录；测试用它构造 `../x`、`/abs`、`C:/win` 等形态） */
  name: string;
  /** 条目内容（默认空） */
  data?: Buffer;
  /** 通用位标志（bit0=加密）；默认 0 */
  flags?: number;
  /** 显式指定解压后大小（用于构造"超大条目"用例，覆盖 data 实际长度） */
  uncompressedSize?: number;
  /** 压缩方法：`store`（默认，方法 0）或 `deflate`（方法 8） */
  method?: 'store' | 'deflate';
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** CRC32（多项式 0xEDB88320；测试夹具用，避免依赖 Node 版本是否带 zlib.crc32）。 */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** @input entries 条目规格 @output 合法 ZIP 字节 @degraded 无 @authority 测试夹具 @not-here 不写盘 @error 无 */
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
    const deflate = entry.method === 'deflate';
    const method = deflate ? 8 : 0;
    const payload = deflate ? deflateRawSync(data) : data;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);

    localOffset += 30 + nameBytes.length + payload.length;
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
