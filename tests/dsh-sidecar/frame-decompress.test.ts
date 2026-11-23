/**
 * tests/dsh-sidecar/frame-decompress.test.ts —— Issue #1458
 *
 * 守 `scripts/dsh-sidecar/r3-chain/lib/frame-decompress.mjs` 的三条不变式（真实断言，非空壳）：
 *   INV-1 正常多帧流 ⇒ Σ帧字节 === 文件字节，且返回真实帧数
 *   INV-2 截断流 ⇒ 明确失败（结构化错误码 TRUNCATED_FRAME），**不静默返回不完整结果**
 *   INV-3 空输入／非法头 ⇒ 结构化错误码（EMPTY_INPUT / INVALID_HEADER）
 * 另加两条 golden：真实证据件的帧边界与报告字段可复现、薄壳脚本重跑产出字段不变。
 *
 * 为什么这三条必须真跑（不是形式要求）：Node v24.16.0 的 `zstdDecompressSync` 对**截断帧不抛错**，
 * 只返回不完整解码结果（实测）。所以「截断必须失败」只能靠本库的结构校验自己发现——
 * 如果实现退化成「把 slice 丢给 zstd」，下面的截断用例必须变红。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { decodeMultiFrameSessionLog, FRAME_ERROR } from '../../scripts/dsh-sidecar/r3-chain/lib/frame-decompress.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/synova/product-lines/evidence/r3-chain-1455');
const SHELL_SCRIPT = path.join(REPO_ROOT, 'scripts/dsh-sidecar/r3-chain/session-decompress.mjs');

/** 压一行成单帧（Node 内置 zstd，不引新依赖）。 */
const frame = (text: string): Buffer => zstdCompressSync(Buffer.from(text, 'utf8'));
/** 多帧串联 —— 正是 DSH 会话日志 `.jsonl.zstd` 的真实形态（逐条 append 一帧）。 */
const multiFrame = (...texts: string[]): Buffer => Buffer.concat(texts.map(frame));

describe('decodeMultiFrameSessionLog / INV-1 正常多帧流', () => {
  it('正常多帧流 ⇒ Σ帧字节 === 文件字节，返回真实帧数', () => {
    const headerLine = '{"type":"session","version":4}\n';
    const callLines = `${Array.from({ length: 20 }, (_, index) => `{"seq":${index},"kind":"tool/call"}`).join('\n')}\n`;
    const resultLine = '{"kind":"tool/result","synthetic":false,"count":2}\n';
    const input = multiFrame(headerLine, callLines, resultLine);

    const result = decodeMultiFrameSessionLog(input);

    expect(result.ok).toBe(true);
    expect(result.frameCount).toBe(3);
    expect(result.frames).toHaveLength(3);
    // INV-1：这是本票要守的不变式本体
    expect(result.coverage.sumFrameBytes).toBe(input.length);
    expect(result.coverage.fileBytes).toBe(input.length);
    expect(result.coverage.byteCoveragePasses).toBe(true);
    // 帧边界必须首尾相接、恰好铺满整个文件（不允许有字节没被任何帧覆盖）
    expect(result.frames[0].start).toBe(0);
    expect(result.frames[1].start).toBe(result.frames[0].end);
    expect(result.frames[2].start).toBe(result.frames[1].end);
    expect(result.frames[2].end).toBe(input.length);
    expect(result.frames.reduce((sum: number, entry: { bytes: number }) => sum + entry.bytes, 0)).toBe(input.length);
    // 多帧内容必须全部解出来（不是只解第一帧）
    expect(result.decoded.toString('utf8')).toBe(headerLine + callLines + resultLine);
  });
});

describe('decodeMultiFrameSessionLog / INV-2 截断流', () => {
  it('截断流 ⇒ 明确失败 TRUNCATED_FRAME，不静默返回不完整结果', () => {
    const input = multiFrame('{"type":"session"}\n', '{"seq":1}\n{"seq":2}\n', '{"seq":3}\n');
    // 砍掉最后一个帧的 1 字节：zstd 自己不会抛错，只有结构校验能发现
    const truncated = input.subarray(0, input.length - 1);

    const result = decodeMultiFrameSessionLog(truncated);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(FRAME_ERROR.TRUNCATED_FRAME);
    // 失败时不得给出“看起来成功”的解码产物
    expect(result.decoded).toBeUndefined();
  });

  it('真实证据件截断 5 字节 ⇒ 同样明确失败（不因文件大小而改变判据）', () => {
    const input = readFileSync(path.join(EVIDENCE_DIR, '07-dsh-session-log.jsonl.zstd'));
    const intact = decodeMultiFrameSessionLog(input);
    expect(intact.ok).toBe(true);

    const result = decodeMultiFrameSessionLog(input.subarray(0, input.length - 5));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(FRAME_ERROR.TRUNCATED_FRAME);
    expect(result.error.frameIndex).toBe(intact.frameCount - 1);
  });
});

describe('decodeMultiFrameSessionLog / INV-3 空输入与非法头', () => {
  it('空输入 ⇒ EMPTY_INPUT', () => {
    const result = decodeMultiFrameSessionLog(Buffer.alloc(0));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(FRAME_ERROR.EMPTY_INPUT);
    expect(result.frameCount).toBe(0);
  });

  it('非法头 ⇒ INVALID_HEADER（无魔数／魔数不在偏移 0／保留位被置位）', () => {
    const noMagic = decodeMultiFrameSessionLog(Buffer.from('not a zstd frame at all'));
    expect(noMagic.ok).toBe(false);
    expect(noMagic.error.code).toBe(FRAME_ERROR.INVALID_HEADER);

    const shifted = Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), frame('{"type":"session"}\n')]);
    const offsetNotZero = decodeMultiFrameSessionLog(shifted);
    expect(offsetNotZero.ok).toBe(false);
    expect(offsetNotZero.error.code).toBe(FRAME_ERROR.INVALID_HEADER);

    // 帧头描述符的保留位（bit3）被置位 ⇒ RFC 8878 不允许，必须判非法
    const corruptedHeader = Buffer.from(frame('{"type":"session"}\n'));
    corruptedHeader[4] |= 0x08;
    const reservedBit = decodeMultiFrameSessionLog(corruptedHeader);
    expect(reservedBit.ok).toBe(false);
    expect(reservedBit.error.code).toBe(FRAME_ERROR.INVALID_HEADER);
  });
});

describe('golden / 证据件可复现（#1458 完成判据）', () => {
  it('真实证据件 ⇒ 帧数与 frames/coverage 与既有报告逐字段一致，解码 sha256 一致', () => {
    const input = readFileSync(path.join(EVIDENCE_DIR, '07-dsh-session-log.jsonl.zstd'));
    const golden = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, '07-dsh-session-log.decompress-report.json'), 'utf8'));

    const result = decodeMultiFrameSessionLog(input);

    expect(result.ok).toBe(true);
    expect(result.frameCount).toBe(golden.frameCount);
    expect(result.frames).toEqual(golden.frames);
    expect(result.coverage).toEqual(golden.coverage);
    expect(createHash('sha256').update(result.decoded).digest('hex')).toBe(golden.output.sha256);
  });

  it('薄壳脚本重跑 ⇒ 报告与既有证据件字段一致（仅 generatedAt 与 input/output.path 不同）', () => {
    const workDir = mkdtempSync(path.join(tmpdir(), 'frame-decompress-'));
    try {
      const inputPath = path.join(EVIDENCE_DIR, '07-dsh-session-log.jsonl.zstd');
      const outPath = path.join(workDir, 'out.jsonl');
      const reportPath = path.join(workDir, 'report.json');
      // stdio: 'ignore' —— 本用例只关心产出文件；若脚本非 0 退出，execFileSync 会抛错使断言变红
      execFileSync(process.execPath, [SHELL_SCRIPT, inputPath, outPath, reportPath], { stdio: 'ignore' });

      const produced = JSON.parse(readFileSync(reportPath, 'utf8'));
      const golden = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, '07-dsh-session-log.decompress-report.json'), 'utf8'));
      // 只归一化「每次运行必然不同」的三处：生成时间与两个绝对路径
      const normalise = (report: { generatedAt: string; input: { path: string }; output: { path: string } }) => {
        report.generatedAt = '<normalised>';
        report.input.path = '<normalised>';
        report.output.path = '<normalised>';
        return report;
      };

      expect(normalise(produced)).toEqual(normalise(golden));
      // 解码产物本身也必须逐字节可复现（不是只有报告字段对上）
      const outBytes = readFileSync(outPath);
      expect(outBytes.length).toBe(golden.output.bytes);
      expect(createHash('sha256').update(outBytes).digest('hex')).toBe(golden.output.sha256);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
