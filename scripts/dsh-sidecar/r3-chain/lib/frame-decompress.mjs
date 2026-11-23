/**
 * frame-decompress.mjs — 帧感知 zstd 解压（无副作用小库，Issue #1458）。
 *
 * 为什么需要它（DEV DOC v3.1 勘误 + rc.5 实测）：
 *   - rc.5 的 `@deepseek-ai/dsh-session-persistence-jsonl` 的 `exports` 没有深层 `./lib/zstd.js`，
 *     其内部帧读取器（`scanZstdFrames` / `createZstdFrameDecoder` / `decompressZstdFrame`）不可 import。
 *   - Node 的 `zstdDecompressSync` 对**多帧**文件只解第一帧、其余静默丢弃（不抛）。
 *   - 更关键：`zstdDecompressSync` 对**截断帧**也**不抛**，只返回不完整的解码结果（实测 Node v24.16.0）。
 *     ⇒ 截断必须由本库的**结构校验**（帧头 + 块链 + 长度）自己发现，不能依赖 zlib 抛错。
 *
 * 契约（铁律 47）：
 *   @input   buffer: Buffer | Uint8Array —— 一份 `.jsonl.zstd` 会话日志的原始字节（帧可多于一帧）
 *   @returns { ok: true,  frameCount, frames, decoded, coverage }
 *          | { ok: false, error: { code, message, frameIndex?, offset?, detail? }, frameCount, frames }
 *     · frames[i] = { index, start, end, bytes, decodedBytes, decodedLines }
 *     · coverage  = { fileBytes, sumFrameBytes, byteCoveragePasses, sumDecodedLines, decodedNewlines }
 *     · 失败路径**一律** `ok:false` + 结构化 `error.code`，**绝不**返回“看起来成功但不完整”的结果；
 *       失败时返回的 `frames` 只是已校验通过的诊断前缀，调用方不得当作解码产物使用。
 *   @degrade 本模块无 I/O、无日志、无全局状态；所有失败都由 `error.code` 表达，不抛异常。
 *
 * 常量不变式：
 *   INV-1  Σ(frames[i].bytes) === buffer.length          ⇒ coverage.byteCoveragePasses
 *   INV-2  每帧「帧头 + 块链 + 可选校验和」恰好铺满该帧切片 ⇒ 否则 TRUNCATED_FRAME / INVALID_FRAME_LAYOUT
 *   INV-3  帧头声明的内容大小（若存在）=== 实际解码字节数   ⇒ 否则 TRUNCATED_FRAME / CONTENT_SIZE_MISMATCH
 */

import { zstdDecompressSync } from 'node:zlib';

/** zstd 帧魔数（小端 0xFD2FB528）。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const ZSTD_MAGIC_BYTES = ZSTD_MAGIC.length;
/** 单帧块数上限——只为防“块头 bit 位被当成灾难性循环”的失控，不是业务阈值。 */
const MAX_BLOCKS_PER_FRAME = 1_000_000;

/**
 * 结构化失败码。每个码对应一类**可判别**的坏输入，调用方据此决定处置，不靠解析字符串。
 */
export const FRAME_ERROR = Object.freeze({
  /** 输入零字节：没有可解的帧。 */
  EMPTY_INPUT: 'EMPTY_INPUT',
  /** 偏移 0 起不是合法 zstd 帧头（缺魔数／保留位被置位／帧头不完整）。 */
  INVALID_HEADER: 'INVALID_HEADER',
  /** 帧被截断：块链或校验和越过帧切片末尾，或解码字节数少于帧头声明的内容大小。 */
  TRUNCATED_FRAME: 'TRUNCATED_FRAME',
  /** 帧头声明的内容大小与实际解码字节数不符（且不是变少 ⇒ 非截断方向）。 */
  CONTENT_SIZE_MISMATCH: 'CONTENT_SIZE_MISMATCH',
  /** 帧结构自洽但与切片边界不符：切片尾部有多余字节（含“魔数出现在压缩载荷内部”这种误切）。 */
  INVALID_FRAME_LAYOUT: 'INVALID_FRAME_LAYOUT',
  /** 结构自洽、字节数也对，但 zlib 拒绝解码（载荷损坏）。 */
  FRAME_DECODE_FAILED: 'FRAME_DECODE_FAILED',
});

/** 帧头 Content_Size 字段的字节宽度，索引 = Frame_Content_Size_flag。 */
const FCS_WIDTH = Object.freeze([0, 2, 4, 8]);
/** 帧头 Dictionary_ID 字段的字节宽度，索引 = Dictionary_ID_flag。 */
const DICT_ID_WIDTH = Object.freeze([0, 1, 2, 4]);

const newlineCount = text => (text.match(/\n/g) ?? []).length;

/**
 * 扫描**全部**魔数出现位置。
 * 不能“解第一帧，然后再找下一个”：那会漏掉边界判定（#1455 首次实现的实际教训）。
 * @param {Buffer} buffer
 * @returns {number[]} 非减的魔数偏移序列
 */
function scanMagicOffsets(buffer) {
  const offsets = [];
  let cursor = 0;
  for (;;) {
    const hit = buffer.indexOf(ZSTD_MAGIC, cursor);
    if (hit === -1) break;
    offsets.push(hit);
    cursor = hit + ZSTD_MAGIC_BYTES;
  }
  return offsets;
}

/**
 * 解析一个 zstd 帧头（RFC 8878 §3.1.1）。
 * @param {Buffer} buffer 整个文件缓冲
 * @param {number} start  帧起始偏移（= 魔数位置）
 * @returns {{ ok: true, headerBytes: number, declaredContentSize: number|null, hasChecksum: boolean }
 *          | { ok: false, code: string, message: string }}
 */
function readFrameHeader(buffer, start) {
  if (buffer.length - start < ZSTD_MAGIC_BYTES + 1) {
    return { ok: false, code: FRAME_ERROR.INVALID_HEADER, message: `frame header at offset ${start} is shorter than 5 bytes` };
  }
  const fhd = buffer[start + ZSTD_MAGIC_BYTES];
  const fcsFlag = (fhd >> 6) & 0x3;
  const singleSegment = (fhd >> 5) & 0x1;
  const hasChecksum = ((fhd >> 2) & 0x1) === 1;
  const dictIdFlag = fhd & 0x3;
  if (((fhd >> 3) & 0x1) !== 0) {
    return { ok: false, code: FRAME_ERROR.INVALID_HEADER, message: `frame header at offset ${start} sets reserved bit (FHD=0x${fhd.toString(16)})` };
  }
  let cursor = start + ZSTD_MAGIC_BYTES + 1;
  if (singleSegment === 0) cursor += 1; // Window_Descriptor
  cursor += DICT_ID_WIDTH[dictIdFlag];
  // Frame_Content_Size 的 0 号宽度取决于 Single_Segment_flag：单段 ⇒ 1 字节，否则该字段不存在
  const fcsWidth = fcsFlag === 0 ? (singleSegment === 1 ? 1 : 0) : FCS_WIDTH[fcsFlag];
  if (cursor + fcsWidth > buffer.length) {
    return { ok: false, code: FRAME_ERROR.INVALID_HEADER, message: `frame header at offset ${start} declares ${fcsWidth}-byte content size but the header is truncated` };
  }
  let declaredContentSize = null;
  if (fcsWidth > 0) {
    let value = 0n;
    for (let index = fcsWidth - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(buffer[cursor + index]);
    }
    // 2 字节形式的真实值是 field + 256（RFC 8878 §3.1.1.3）
    if (fcsWidth === 2) value += 256n;
    declaredContentSize = Number(value);
  }
  return { ok: true, headerBytes: cursor + fcsWidth - start, declaredContentSize, hasChecksum };
}

/**
 * 走完一帧的块链，返回该帧内容的精确结束偏移（RFC 8878 §3.1.1.2）。
 * 块头 3 字节（小端）：bit0=Last_Block，bit1..2=Block_Type，bit3..23=Block_Size。
 * @param {Buffer} buffer
 * @param {number} blockStart 第一个块头的偏移
 * @returns {{ ok: true, end: number, blockCount: number }
 *          | { ok: false, code: string, message: string }}
 */
function walkFrameBlocks(buffer, blockStart) {
  let cursor = blockStart;
  for (let blockCount = 0; blockCount <= MAX_BLOCKS_PER_FRAME; blockCount += 1) {
    if (cursor + 3 > buffer.length) {
      return { ok: false, code: FRAME_ERROR.TRUNCATED_FRAME, message: `block header at offset ${cursor} runs past the frame end` };
    }
    const first = buffer[cursor];
    const isLast = (first & 0x1) === 1;
    const blockType = (first >> 1) & 0x3;
    const blockSize = (first >> 3) | (buffer[cursor + 1] << 5) | (buffer[cursor + 2] << 13);
    if (blockType === 3) {
      return { ok: false, code: FRAME_ERROR.INVALID_FRAME_LAYOUT, message: `block at offset ${cursor} uses reserved block type` };
    }
    // RLE 块只占 1 字节载荷，其余类型占 Block_Size 字节
    cursor += 3 + (blockType === 1 ? 1 : blockSize);
    if (cursor > buffer.length) {
      return { ok: false, code: FRAME_ERROR.TRUNCATED_FRAME, message: `block payload starting at offset ${cursor - (blockType === 1 ? 1 : blockSize)} runs past the frame end` };
    }
    if (isLast) return { ok: true, end: cursor, blockCount: blockCount + 1 };
  }
  return { ok: false, code: FRAME_ERROR.INVALID_FRAME_LAYOUT, message: `block chain starting at offset ${blockStart} exceeds ${MAX_BLOCKS_PER_FRAME} blocks` };
}

/**
 * 校验并解码单帧。
 * 顺序是刻意的：**先结构校验、再解码**。这样“截断”永远得到确定性的 TRUNCATED_FRAME，
 * 不会因为 Node 的 zstd 对截断是否抛错而变成另一种码（实测 Node 不抛）。
 * @returns {{ ok: true, frame: object, decoded: Buffer } | { ok: false, code: string, message: string }}
 */
function decodeFrame(buffer, start, end, index) {
  const header = readFrameHeader(buffer, start);
  if (!header.ok) {
    return { ok: false, code: header.code, message: `frame ${index}: ${header.message}` };
  }
  const blocks = walkFrameBlocks(buffer, start + header.headerBytes);
  if (!blocks.ok) {
    return { ok: false, code: blocks.code, message: `frame ${index} (offset ${start}..${end}): ${blocks.message}` };
  }
  const structuralEnd = blocks.end + (header.hasChecksum ? 4 : 0);
  if (structuralEnd > end) {
    return { ok: false, code: FRAME_ERROR.TRUNCATED_FRAME, message: `frame ${index} (offset ${start}..${end}) ends at ${structuralEnd} but the file only provides ${end} bytes` };
  }
  if (structuralEnd < end) {
    return { ok: false, code: FRAME_ERROR.INVALID_FRAME_LAYOUT, message: `frame ${index} (offset ${start}..${end}) ends at ${structuralEnd}, leaving ${end - structuralEnd} unexpected byte(s) in this frame slice` };
  }
  let decoded;
  try {
    decoded = zstdDecompressSync(buffer.subarray(start, end));
  } catch (err) {
    return { ok: false, code: FRAME_ERROR.FRAME_DECODE_FAILED, message: `frame ${index} (offset ${start}..${end}) failed to decode: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (header.declaredContentSize !== null && header.declaredContentSize !== decoded.length) {
    if (decoded.length < header.declaredContentSize) {
      return { ok: false, code: FRAME_ERROR.TRUNCATED_FRAME, message: `frame ${index} declared ${header.declaredContentSize} content bytes but decoded ${decoded.length}` };
    }
    return { ok: false, code: FRAME_ERROR.CONTENT_SIZE_MISMATCH, message: `frame ${index} declared ${header.declaredContentSize} content bytes but decoded ${decoded.length}` };
  }
  return {
    ok: true,
    decoded,
    frame: {
      index,
      start,
      end,
      bytes: end - start,
      decodedBytes: decoded.length,
      decodedLines: newlineCount(decoded.toString('utf8')),
    },
  };
}

/**
 * 帧感知解压一份多帧 zstd 会话日志。
 * @param {Buffer|Uint8Array} input 原始文件字节
 * @returns {{ ok: true, frameCount: number, frames: object[], decoded: Buffer, coverage: object }
 *          | { ok: false, error: { code: string, message: string, frameIndex?: number, offset?: number }, frameCount: number, frames: object[] }}
 */
export function decodeMultiFrameSessionLog(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  const frames = [];
  const decodedChunks = [];

  if (buffer.length === 0) {
    return { ok: false, error: { code: FRAME_ERROR.EMPTY_INPUT, message: 'input is empty: no zstd frame is present' }, frameCount: 0, frames };
  }

  const magicOffsets = scanMagicOffsets(buffer);
  if (magicOffsets.length === 0 || magicOffsets[0] !== 0) {
    return {
      ok: false,
      error: {
        code: FRAME_ERROR.INVALID_HEADER,
        message: `no zstd frame magic at offset 0 (first magic hit=${magicOffsets[0] ?? 'none'})`,
        offset: 0,
      },
      frameCount: 0,
      frames,
    };
  }

  for (let index = 0; index < magicOffsets.length; index += 1) {
    const start = magicOffsets[index];
    const end = index + 1 < magicOffsets.length ? magicOffsets[index + 1] : buffer.length;
    const result = decodeFrame(buffer, start, end, index);
    if (!result.ok) {
      return { ok: false, error: { code: result.code, message: result.message, frameIndex: index, offset: start }, frameCount: frames.length, frames };
    }
    frames.push(result.frame);
    decodedChunks.push(result.decoded);
  }

  const sumFrameBytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
  // INV-1：帧切片的字节总和必须恰好等于文件字节（否则有字节没被任何帧覆盖 ⇒ 静默丢数据）
  if (sumFrameBytes !== buffer.length) {
    return {
      ok: false,
      error: {
        code: FRAME_ERROR.INVALID_FRAME_LAYOUT,
        message: `frame slices cover ${sumFrameBytes} of ${buffer.length} byte(s)`,
      },
      frameCount: frames.length,
      frames,
    };
  }

  const decoded = Buffer.concat(decodedChunks);
  const decodedNewlines = newlineCount(decoded.toString('utf8'));
  return {
    ok: true,
    frameCount: frames.length,
    frames,
    decoded,
    coverage: {
      fileBytes: buffer.length,
      sumFrameBytes,
      byteCoveragePasses: sumFrameBytes === buffer.length,
      sumDecodedLines: frames.reduce((sum, frame) => sum + frame.decodedLines, 0),
      decodedNewlines,
    },
  };
}
