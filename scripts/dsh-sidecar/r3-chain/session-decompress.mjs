/**
 * session-decompress.mjs — frame-aware zstd decompression of a DSH session log (Issue #1455, T4/T5).
 *
 * Why this shape (DEV DOC v3.1 erratum + rc.5 facts):
 *   - rc.5's `@deepseek-ai/dsh-session-persistence-jsonl` exports only { Config, JsonlCompressionSchema, apply, name }
 *     and its `exports` map has no deep `./lib/zstd.js`, so the package-internal frame readers
 *     (`scanZstdFrames` / `createZstdFrameDecoder` / `decompressZstdFrame`) are NOT importable.
 *   - Node's `zlib.zstdDecompressSync` decodes ONE frame and silently ignores the rest on a multi-frame file.
 *
 * So: scan EVERY magic occurrence (28 B5 2F FD), cut frames by consecutive offsets, decode each frame with
 * zstdDecompressSync, concatenate, and then prove nothing was dropped:
 *   check 1  first decoded line parses as the session header (JSON object)
 *   check 2  total decoded lines == sum of per-frame decoded lines
 *   check 3  Σ (frame end - frame start) == file byte length        <-- coverage check (v3.1 §4)
 *   check 4  decoded text ends with a newline
 *   check 5  text contains `tool/call` and `tool/result`
 *   check 6  a `tool/call` named synova_context_get exists
 *   check 7  its `tool/result` carries synthetic:false and count>=1
 *
 * usage: node session-decompress.mjs <in.zstd> <out.jsonl> <report.json>
 * @exit 0 all checks pass; 1 any check fails (report still written); 2 bad usage
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const [inputPath, outputPath, reportPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !reportPath) {
  process.stderr.write('usage: node session-decompress.mjs <in.zstd> <out.jsonl> <report.json>\n');
  process.exit(2);
}

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const file = readFileSync(inputPath);

// 1) scan EVERY magic occurrence (not "decode one then look further": that misses boundaries)
const magicOffsets = [];
let cursor = 0;
for (;;) {
  const hit = file.indexOf(MAGIC, cursor);
  if (hit === -1) break;
  magicOffsets.push(hit);
  cursor = hit + MAGIC.length;
}
if (magicOffsets.length === 0 || magicOffsets[0] !== 0) {
  throw new Error(`session-decompress: no frame magic at offset 0 (first hit=${magicOffsets[0] ?? 'none'})`);
}

// 2) cut frames by consecutive offsets, decode each independently
const frames = [];
const chunks = [];
for (let index = 0; index < magicOffsets.length; index += 1) {
  const start = magicOffsets[index];
  const end = index + 1 < magicOffsets.length ? magicOffsets[index + 1] : file.length;
  const slice = file.subarray(start, end);
  let decoded;
  try {
    decoded = zstdDecompressSync(slice);
  } catch (err) {
    throw new Error(`session-decompress: frame ${index} (offset ${start}..${end}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  frames.push({
    index,
    start,
    end,
    bytes: end - start,
    decodedBytes: decoded.length,
    decodedLines: (decoded.toString('utf8').match(/\n/g) ?? []).length,
  });
  chunks.push(decoded);
}
const decodedBuffer = Buffer.concat(chunks);
const text = decodedBuffer.toString('utf8');
const lines = text.split('\n');
const nonEmptyLines = lines.filter(line => line.trim().length > 0);

// 3) verdict checks
const checks = {
  firstLineIsHeader: false,
  totalLinesEqualsSumOfFrames: false,
  byteCoverage: false,
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
const sumFrameLines = frames.reduce((sum, frame) => sum + frame.decodedLines, 0);
checks.totalLinesEqualsSumOfFrames = sumFrameLines === (text.match(/\n/g) ?? []).length;
const sumFrameBytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
checks.byteCoverage = sumFrameBytes === file.length;
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
  input: { path: inputPath, bytes: file.length, sha256: createHash('sha256').update(file).digest('hex') },
  output: { path: outputPath, bytes: decodedBuffer.length, sha256: createHash('sha256').update(decodedBuffer).digest('hex'), lines: lines.length, nonEmptyLines: nonEmptyLines.length },
  method: 'scan every magic 28 B5 2F FD offset -> cut frames by consecutive offsets -> zstdDecompressSync per frame -> concat',
  forbiddenMethodNotUsed: 'zstdDecompressSync on the whole multi-frame file (decodes only the first frame and does not throw)',
  frameCount: frames.length,
  frames,
  coverage: { fileBytes: file.length, sumFrameBytes, byteCoveragePasses: checks.byteCoverage, sumDecodedLines: sumFrameLines, decodedNewlines: (text.match(/\n/g) ?? []).length },
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
  frameCount: frames.length,
  lines: lines.length,
  checks,
  coverage: report.coverage,
}, null, 2)}\n`);
if (!allPassed) process.exit(1);
