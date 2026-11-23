/**
 * session-decompress.mjs — 帧感知 zstd 解压 DSH 会话日志的**薄壳**（Issue #1455 T4/T5 → #1458 抽出小库）。
 *
 * 本文件只做三件事：读文件 → 调 `./lib/frame-decompress.mjs` → 打报告。
 * 帧感知解压、Σ帧字节==文件字节 不变式、截断／非法头检测全部归 `lib/frame-decompress.mjs`
 * （由 `tests/dsh-sidecar/frame-decompress.test.ts` 守着）。
 *
 * 本壳保留的**会话语义**判定（不是解压逻辑）：
 *   check 1  first decoded line parses as the session header (JSON object)
 *   check 2  total decoded lines == sum of per-frame decoded lines
 *   check 4  decoded text ends with a newline
 *   check 5  text contains `tool/call` and `tool/result`
 *   check 6  a `tool/call` named synova_context_get exists
 *   check 7  its `tool/result` carries synthetic:false and count>=1
 *   （check 3 = Σ帧字节==文件字节 已下沉到库里，壳只把库给的 coverage 打出来）
 *
 * 🔴 行为与输出字段**不得变化**：既有证据件
 *    docs/synova/product-lines/evidence/r3-chain-1455/{07-dsh-session-log,T6-run1-session,T6-run2-session}.decompress-report.json
 *    的字段结构必须可复现（由 frame-decompress.test.ts 的 golden 用例守着）。
 *
 * usage: node session-decompress.mjs <in.zstd> <out.jsonl> <report.json>
 * @exit 0 all checks pass; 1 any check fails (report still written); 2 bad usage
 *       失败路径（输入坏到解不出来）沿用原行为：uncaught error ⇒ 非 0 退出、不写报告。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMultiFrameSessionLog } from './lib/frame-decompress.mjs';

/**
 * `producer` = **实际产出本报告的代码**（#1458 CTO 裁定 3）。
 * `codeSha` 保留原义 = **证据基线**（当时锁定的 base SHA），不是生产者。
 * 刻意用「模块自身 sha256」而不是运行时 git：git 计算会让旧证据件不可复现。
 */
const PRODUCER_REPO_PATH = 'scripts/dsh-sidecar/r3-chain/lib/frame-decompress.mjs';

const [inputPath, outputPath, reportPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !reportPath) {
  process.stderr.write('usage: node session-decompress.mjs <in.zstd> <out.jsonl> <report.json>\n');
  process.exit(2);
}

const file = readFileSync(inputPath);
const producerPath = fileURLToPath(new URL('./lib/frame-decompress.mjs', import.meta.url));
const producerSha256 = createHash('sha256').update(readFileSync(producerPath)).digest('hex');

// 1) 解压 + 结构不变式（全部在库里；失败即结构化错误码，不返回不完整结果）
const decompressed = decodeMultiFrameSessionLog(file);
if (!decompressed.ok) {
  throw new Error(`session-decompress: ${decompressed.error.code}: ${decompressed.error.message}`);
}
const { frames, decoded: decodedBuffer, coverage } = decompressed;
const text = decodedBuffer.toString('utf8');
const lines = text.split('\n');
const nonEmptyLines = lines.filter(line => line.trim().length > 0);

// 2) verdict checks —— 会话语义
const checks = {
  firstLineIsHeader: false,
  totalLinesEqualsSumOfFrames: false,
  byteCoverage: coverage.byteCoveragePasses,
  endsWithNewline: false,
  hasToolCall: false,
  hasToolResult: false,
  hasSynovaContextGetCall: false,
  synovaToolResultIsReal: false,
};
let header = null;
try {
  header = JSON.parse(nonEmptyLines[0]);
  checks.firstLineIsHeader = header !== null && typeof header === 'object';
} catch {
  checks.firstLineIsHeader = false;
}
checks.totalLinesEqualsSumOfFrames = coverage.sumDecodedLines === coverage.decodedNewlines;
checks.endsWithNewline = text.endsWith('\n');
checks.hasToolCall = text.includes('tool/call');
checks.hasToolResult = text.includes('tool/result');

/** Pull JSON entries mentioning a tool call/result so the judgement is auditable. */
const parsedEntries = [];
for (const line of nonEmptyLines) {
  if (!line.includes('tool/call') && !line.includes('tool/result')) continue;
  try {
    parsedEntries.push(JSON.parse(line));
  } catch {
    /* a non-JSON payload line is reported through the checks above, not silently ignored */
  }
}
const calls = parsedEntries.filter(entry => JSON.stringify(entry).includes('tool/call'));
const results = parsedEntries.filter(entry => JSON.stringify(entry).includes('tool/result'));
const synovaCalls = calls.filter(entry => JSON.stringify(entry).includes('synova_context_get'));
checks.hasSynovaContextGetCall = synovaCalls.length > 0;
const synovaResults = results.filter(entry => JSON.stringify(entry).includes('synova_context_get') || JSON.stringify(entry).includes('synthetic'));
for (const entry of synovaResults) {
  const raw = JSON.stringify(entry);
  if (raw.includes('"synthetic":false') || raw.includes('synthetic\\":false')) {
    const countMatch = /count\\?"\s*:\s*(\d+)/.exec(raw);
    if (countMatch !== null && Number(countMatch[1]) >= 1) checks.synovaToolResultIsReal = true;
  }
}

const allPassed = Object.values(checks).every(Boolean);
const report = {
  file: '07-dsh-session-log.decompress-report.json',
  generatedAt: new Date().toISOString(),
  codeSha: 'caf61fcdeb3e00c79abe9211546690ca963549a2',
  producer: { path: PRODUCER_REPO_PATH, sha256: producerSha256 },
  input: { path: inputPath, bytes: file.length, sha256: createHash('sha256').update(file).digest('hex') },
  output: { path: outputPath, bytes: decodedBuffer.length, sha256: createHash('sha256').update(decodedBuffer).digest('hex'), lines: lines.length, nonEmptyLines: nonEmptyLines.length },
  method: 'scan every magic 28 B5 2F FD offset -> cut frames by consecutive offsets -> zstdDecompressSync per frame -> concat',
  forbiddenMethodNotUsed: 'zstdDecompressSync on the whole multi-frame file (decodes only the first frame and does not throw)',
  frameCount: decompressed.frameCount,
  frames,
  coverage,
  header,
  checks,
  toolCallEntries: synovaCalls.length,
  toolResultEntries: synovaResults.length,
  allPassed,
};
writeFileSync(outputPath, text, 'utf8');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: allPassed,
  inputBytes: file.length,
  outputBytes: decodedBuffer.length,
  frameCount: decompressed.frameCount,
  lines: lines.length,
  checks,
  coverage,
}, null, 2)}\n`);
if (!allPassed) process.exit(1);
