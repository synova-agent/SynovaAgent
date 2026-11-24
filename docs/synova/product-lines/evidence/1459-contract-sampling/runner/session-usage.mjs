/**
 * session-usage.mjs 鈥?#1459 evidence piece 鈶? decode ONE DSH session log and report model usage.
 *
 * Calls the repository's canonical decoder (scripts/dsh-sidecar/r3-chain/session-decompress.mjs)
 * so the byte-coverage / frame invariants are the repo's own checks, then reads the decoded jsonl
 * and reports: assistant message count, provider/model, per-message usage, tool calls, totals.
 *
 * usage: node session-usage.mjs --session-zstd <f> --evidence <dir> --id <M1|M2a-Q1...> --decoder <path>
 * @output <evidence>/<id>-dsh-session.json + <id>-dsh-session-log.jsonl + <id>-dsh-session-report.json
 * @not-here no model call, no network; read-only over the DSH-written session log.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].slice(2), process.argv[i + 1]);
const sessionZstd = args.get('session-zstd');
const evidence = args.get('evidence');
const id = args.get('id');
const decoder = args.get('decoder');
if (!sessionZstd || !evidence || !id || !decoder) {
  console.error('usage: node session-usage.mjs --session-zstd <f> --evidence <dir> --id <id> --decoder <path>');
  process.exit(2);
}

const outJsonl = join(evidence, `${id}-dsh-session-log.jsonl`);
const outReport = join(evidence, `${id}-dsh-session-report.json`);
let decodeOk = true;
let decoderExitNonZero = false;
let decoderError = null;
try {
  execFileSync(process.execPath, [decoder, sessionZstd, outJsonl, outReport], { stdio: 'pipe' });
} catch (err) {
  // exit 1 = the repo decoder's SEMANTIC checks failed (e.g. a natural-question run has no tool call).
  // The decoded jsonl is still written in that case, so keep going and report the failed checks.
  decoderExitNonZero = true;
  decodeOk = existsSync(outJsonl);
  decoderError = err?.stderr ? err.stderr.toString('utf8').slice(0, 600) : String(err);
}
if (!decodeOk) {
  writeFileSync(join(evidence, `${id}-dsh-session.json`), `${JSON.stringify({ id, decodeOk: false, decoderExitNonZero, error: decoderError }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ id, decodeOk: false, decoderExitNonZero, error: decoderError }));
  process.exit(1);
}

const lines = readFileSync(outJsonl, 'utf8').split('\n').filter((line) => line.trim().length > 0);
const entries = [];
for (const line of lines) {
  try { entries.push(JSON.parse(line)); } catch { /* a non-JSON line is reported via decode report checks */ }
}
const ofType = (type) => entries.filter((entry) => entry.type === type);
const assistant = ofType('assistant/message');
const tools = entries.filter((entry) => JSON.stringify(entry).includes('tool/call') || JSON.stringify(entry).includes('tool/result'));

let inputTokens = 0;
let outputTokens = 0;
let cacheReadTokens = 0;
let totalTokens = 0;
const messages = assistant.map((entry) => {
  const usage = entry.data?.usage ?? null;
  if (usage !== null) {
    inputTokens += Number(usage.inputTokens ?? 0);
    outputTokens += Number(usage.outputTokens ?? 0);
    cacheReadTokens += Number(usage.cacheReadTokens ?? 0);
    totalTokens += Number(usage.totalTokens ?? 0);
  }
  const message = entry.data?.message ?? {};
  const blocks = Array.isArray(message.content) ? message.content.map((block) => block?.type) : [];
  const texts = Array.isArray(message.content) ? message.content.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')) : [];
  const toolCalls = Array.isArray(message.content)
    ? message.content.filter((b) => b?.type === 'tool-call' || b?.type === 'tool_call').map((b) => ({ name: b.name ?? null, args: b.arguments ?? null }))
    : [];
  return {
    seq: entry.seq ?? null,
    provider: message.source?.provider ?? null,
    model: message.source?.model ?? null,
    contentTypes: blocks,
    toolCalls,
    textChars: texts.join('').length,
    usage,
  };
});

const summary = {
  id,
  sessionZstd,
  sessionZstdBytes: readFileSync(sessionZstd).length,
  decodeOk,
  decoderExitNonZero,
  decoderChecks: (() => { try { return JSON.parse(readFileSync(outReport, 'utf8')).checks ?? null; } catch { return null; } })(),
  decodeReport: outReport,
  lineCount: lines.length,
  entryTypes: Object.fromEntries([...new Set(entries.map((entry) => String(entry.type)))].map((type) => [type, entries.filter((entry) => String(entry.type) === type).length])),
  assistantMessageCount: assistant.length,
  assistantMessagesWithUsage: messages.filter((message) => message.usage !== null).length,
  messages,
  toolCallEntries: tools.length,
  totals: { inputTokens, outputTokens, cacheReadTokens, totalTokens },
  realModelRound: assistant.some((entry) => entry.data?.usage !== null && entry.data?.usage !== undefined),
};
writeFileSync(join(evidence, `${id}-dsh-session.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  id,
  decodeOk,
  assistantMessageCount: summary.assistantMessageCount,
  usageMessages: summary.assistantMessagesWithUsage,
  totals: summary.totals,
  realModelRound: summary.realModelRound,
}));

