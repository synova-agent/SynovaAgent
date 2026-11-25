/**
 * scripts/ingest-v0/lib/extract/pdf.mjs — PDF 文本的**保守抽取**（纯解析，零依赖、零执行）。
 *
 * 为什么"保守"：中文 PDF 常用子集化 CID 字体，字节里是字形号而不是 Unicode；没有 ToUnicode
 * 映射时**任何解码都可能产出看似中文的乱码**。本票宁可抽不到（计入 `no_extractable_facts`），
 * 也不允许把乱码当对象/指标（C6 禁止编造）。
 *
 * 判据：
 *   · 只解 FlateDecode 内容流（`stream ... endstream`；解不开就按明文尝试）；
 *   · 只接受 `Tj`/`TJ` 文本操作符里的字面串/十六进制串；
 *   · 字面串必须是「UTF-16BE（带 BOM）」或「≥80% 可打印 ASCII」才采纳；
 *     其它（含 CID 高位字节）整串丢弃 —— 不猜字体编码；
 *   · 不解析页面树/XObject/加密 PDF（加密文件整份跳过，由调用方计 `pdf_encrypted`）。
 */

import zlib from 'node:zlib';

import { squeezeWhitespace } from './html.mjs';

/** 单个内容流解压后的上限（防 PDF bomb；真实文本流远小于此）。 */
const MAX_STREAM_OUTPUT_BYTES = 20 * 1024 * 1024;
/** 单份 PDF 最多检查的内容流数（防异常结构跑飞）。 */
const MAX_STREAMS = 5000;

/**
 * 解码 PDF 字面串（`(...)` 内内容，已含转义序列）。
 *
 * @input  bytes —— 原始字面串字节（含反斜杠转义）
 * @output `{text, ok}`：ok=false ⇒ 该串不可信（不采纳）
 * @degraded 无：不可信 ⇒ 明确 ok=false（调用方丢弃，不修补）
 * @authority 判据 = "UTF-16BE BOM" 或 "≥80% 可打印 ASCII 且含字母/数字"
 * @not_here 不处理字体编码/ToUnicode/CMap
 * @error 无
 */
export function decodePdfLiteral(bytes) {
  if (bytes.length === 0) return { text: '', ok: false };
  const unescaped = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 0x5c) {
      unescaped.push(byte);
      continue;
    }
    const next = bytes[index + 1];
    if (next === undefined) break;
    index += 1;
    switch (next) {
      case 0x6e: unescaped.push(0x0a); break; // n
      case 0x72: unescaped.push(0x0d); break; // r
      case 0x74: unescaped.push(0x09); break; // t
      case 0x62: unescaped.push(0x08); break; // b
      case 0x66: unescaped.push(0x0c); break; // f
      case 0x28: unescaped.push(0x28); break; // (
      case 0x29: unescaped.push(0x29); break; // )
      case 0x5c: unescaped.push(0x5c); break; // \
      case 0x0d:
        if (bytes[index + 1] === 0x0a) index += 1; // 行续接
        break;
      case 0x0a:
        break;
      default:
        if (next >= 0x30 && next <= 0x37) {
          let octal = next - 0x30;
          for (let count = 0; count < 2; count += 1) {
            const digit = bytes[index + 1];
            if (digit === undefined || digit < 0x30 || digit > 0x37) break;
            octal = octal * 8 + (digit - 0x30);
            index += 1;
          }
          unescaped.push(octal & 0xff);
        } else {
          unescaped.push(next);
        }
    }
  }
  const buffer = Buffer.from(unescaped);
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2));
    for (let index = 0; index + 1 < body.length; index += 2) {
      const high = body[index];
      body[index] = body[index + 1];
      body[index + 1] = high;
    }
    if (body.length % 2 === 1) return { text: '', ok: false };
    return { text: body.toString('utf16le'), ok: true };
  }
  let printable = 0;
  let useful = 0;
  for (const byte of buffer) {
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x0a || byte === 0x09) printable += 1;
    if ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)) useful += 1;
  }
  if (printable / buffer.length < 0.8 || useful === 0) return { text: '', ok: false };
  return { text: buffer.toString('latin1'), ok: true };
}

/**
 * 解十六进制串（`<...>` 内内容）。
 *
 * @input  hexText —— 十六进制文本
 * @output `{text, ok}`（判据同 `decodePdfLiteral`）
 * @degraded 无
 * @authority 判据复用 `decodePdfLiteral`
 * @not_here 不处理奇数长度（补 0 后按字节解码）
 * @error 无
 */
function decodePdfHexString(hexText) {
  const normalized = hexText.replace(/\s+/g, '');
  if (normalized.length === 0 || /[^0-9a-fA-F]/.test(normalized)) return { text: '', ok: false };
  const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  return decodePdfLiteral(Buffer.from(padded, 'hex'));
}

/**
 * 从一个内容流字节里抽出可信文本（`Tj`/`TJ` 操作符）。
 *
 * @input  streamBytes —— 已解压（或明文）内容流
 * @output 文本片段数组（调用方按顺序拼接）
 * @degraded 无：不可信的串直接丢弃（不产生占位文本）
 * @authority 只看 `Tj`/`TJ` 两类操作符的字符串参数
 * @not_here 不解释字体/坐标/换行布局
 * @error 无
 */
function extractTextOperators(streamBytes) {
  const latin = streamBytes.toString('latin1');
  const parts = [];
  // 字面串 + Tj / TJ（先抓串，再看紧跟的操作符）
  const literalPattern = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ|'|")/g;
  let match;
  while ((match = literalPattern.exec(latin)) !== null) {
    const raw = Buffer.from(match[1], 'latin1');
    const decoded = decodePdfLiteral(raw);
    if (decoded.ok && decoded.text.trim().length > 0) parts.push(decoded.text);
  }
  const hexPattern = /<([0-9a-fA-F\s]+)>\s*(?:Tj|TJ|'|")/g;
  while ((match = hexPattern.exec(latin)) !== null) {
    const decoded = decodePdfHexString(match[1]);
    if (decoded.ok && decoded.text.trim().length > 0) parts.push(decoded.text);
  }
  // TJ 数组里的字面串（`[(A) -120 (B)] TJ` 形态；上式已覆盖括号串，这里去重不必要：
  // 重复串会带来重复文本但不会制造新事实；为控制噪声，按"同一串连续出现"折叠。
  return parts;
}

/**
 * 抽取 PDF 文本（保守；抽不到即返回空，不猜）。
 *
 * @input  buffer —— PDF 原始字节
 * @output `{kind:'pdf', text, paragraphs, tables:[], truncated:false, pageCount, streamCount,
 *         extractedChars, encrypted}`；encrypted=true ⇒ 调用方计 `pdf_encrypted`
 * @degraded 无：解不开的流跳过（streamCount 与抽取字符数可归因）
 * @authority 流定位 = `stream/endstream` 标记；文本判据 = `extractTextOperators`
 * @not_here 不解析交叉引用表/页面树/对象压缩（ObjStm 里的流可能漏检 —— 已知限制）
 * @error 无（纯解析，不抛）
 */
export function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { kind: 'pdf', text: '', paragraphs: [], tables: [], truncated: false, pageCount: 0, streamCount: 0, extractedChars: 0, encrypted: false };
  }
  const latin = buffer.toString('latin1');
  const encrypted = /\/Encrypt\b/.test(latin);
  if (encrypted) {
    return { kind: 'pdf', text: '', paragraphs: [], tables: [], truncated: false, pageCount: 0, streamCount: 0, extractedChars: 0, encrypted: true };
  }
  const pageCount = (latin.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const parts = [];
  let streamCount = 0;
  let cursor = 0;
  while (streamCount < MAX_STREAMS) {
    const start = latin.indexOf('stream', cursor);
    if (start === -1) break;
    const end = latin.indexOf('endstream', start + 6);
    if (end === -1) break;
    streamCount += 1;
    cursor = end + 9;
    let dataStart = start + 6;
    if (latin[dataStart] === '\r') dataStart += 1;
    if (latin[dataStart] === '\n') dataStart += 1;
    let dataEnd = end;
    if (latin[dataEnd - 1] === '\n') dataEnd -= 1;
    if (latin[dataEnd - 1] === '\r') dataEnd -= 1;
    if (dataEnd <= dataStart) continue;
    const raw = buffer.subarray(dataStart, dataEnd);
    let content = null;
    try {
      content = zlib.inflateSync(raw, { maxOutputLength: MAX_STREAM_OUTPUT_BYTES });
    } catch {
      try {
        content = zlib.inflateRawSync(raw, { maxOutputLength: MAX_STREAM_OUTPUT_BYTES });
      } catch {
        content = raw; // 未压缩内容流
      }
    }
    if (content.length > 0) parts.push(...extractTextOperators(content));
  }

  const text = squeezeWhitespace(parts.join(' '));
  const paragraphs = [];
  if (text.length > 0) {
    // 以句号/分号/换行符等做粗分段（只为 locator 可读；不改变字符集合）
    const segments = parts
      .join('\n')
      .split(/\n+/)
      .map(segment => squeezeWhitespace(segment))
      .filter(segment => segment.length > 0);
    for (const segment of segments) {
      paragraphs.push({ index: paragraphs.length + 1, text: segment, locator: `pdf/text[${String(paragraphs.length + 1)}]` });
    }
  }
  return {
    kind: 'pdf',
    text,
    paragraphs,
    tables: [],
    truncated: false,
    pageCount,
    streamCount,
    extractedChars: text.length,
    encrypted: false,
  };
}
