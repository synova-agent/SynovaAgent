/**
 * consolidate.mjs — #1459 M1/M2 evidence consolidation (one row per run, no hand-written numbers).
 *
 * For every run meta written by m1m2-drive.mjs it:
 *   1. reads the DOM verdict + the replayed SSE verdict (structured / invalid / reason.code),
 *   2. decodes THAT run's DSH session log (piece ②, real model usage) via session-usage.mjs,
 *   3. writes runs.json + pass-rate.md + evidence-index.md.
 *
 * usage: node consolidate.mjs --m1-evidence <dir> --m2-evidence <dir> --dsh-home <dir>
 *          --decoder <path> --session-usage <path> [--skip-m1]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].slice(2), process.argv[i + 1]);
const m1Dir = args.get('m1-evidence');
const m2Dir = args.get('m2-evidence');
const dshHome = args.get('dsh-home');
const decoder = args.get('decoder');
const sessionUsage = args.get('session-usage');
const dbPath = args.get('db');
if (!m1Dir || !m2Dir || !dshHome || !decoder || !sessionUsage || !dbPath) {
  console.error('usage: node consolidate.mjs --m1-evidence <d> --m2-evidence <d> --dsh-home <d> --decoder <p> --session-usage <p> --db <p>');
  process.exit(2);
}

// ── Real referents of the isolated fixture graph (used to test "四要素是否回指真实对象") ─────────
const BetterSqlite3 = require('better-sqlite3');
const db = new BetterSqlite3(dbPath, { readonly: true });
const realNodeIds = new Set(db.prepare("select id from graph_nodes where graph='org-a'").all().map((row) => row.id));
const realPredicates = new Set(db.prepare("select distinct predicate from graph_triples where graph='org-a'").all().map((row) => row.predicate));
const realEvidenceRefs = new Set(db.prepare("select distinct source_ref from scan_assertion_evidence where graph='org-a'").all().map((row) => row.source_ref));
const realBusinessKeys = new Set(db.prepare("select distinct business_key from scan_ontology_links where graph='org-a'").all().map((row) => row.business_key));
db.close();
const referents = {
  realNodeIds: [...realNodeIds],
  realPredicates: [...realPredicates],
  realEvidenceRefs: [...realEvidenceRefs],
  realBusinessKeys: [...realBusinessKeys],
};

/** Recursively find `<sessionId>/session.v4.jsonl.zstd` under the DSH home. */
function findSessionZstd(sessionId) {
  if (!sessionId) return null;
  const root = join(dshHome, 'sessions');
  if (!existsSync(root)) return null;
  for (const bucket of readdirSync(root)) {
    const candidate = join(root, bucket, sessionId, 'session.v4.jsonl.zstd');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readMetas(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('-meta.json'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

/** Count text.delta frames + characters from the replayed SSE (the run's actual model text). */
function readTextStats(ssePath) {
  if (!existsSync(ssePath)) return { textDeltas: 0, chars: 0, reasoningDeltas: 0, toolStarted: 0 };
  const raw = readFileSync(ssePath, 'utf8');
  let textDeltas = 0;
  let chars = 0;
  let reasoningDeltas = 0;
  let toolStarted = 0;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (block.trim().length === 0) continue;
    const eventMatch = /event: (\S+)/.exec(block);
    if (eventMatch === null) continue;
    if (eventMatch[1] === 'tool.started') toolStarted += 1;
    if (eventMatch[1] !== 'text.delta' && eventMatch[1] !== 'reasoning.delta') continue;
    const dataMatch = /data: (.*)/.exec(block);
    if (dataMatch === null) continue;
    let data = null;
    try { data = JSON.parse(dataMatch[1]); } catch { continue; }
    const text = typeof data?.data?.text === 'string' ? data.data.text : '';
    if (eventMatch[1] === 'text.delta') { textDeltas += 1; chars += text.length; } else { reasoningDeltas += 1; }
  }
  return { textDeltas, chars, reasoningDeltas, toolStarted };
}

function sseVerdict(meta) {
  const sse = meta.sse ?? {};
  const reason = sse.invalidReason ?? null;
  return {
    hypothesisEvent: sse.hypothesis ?? null,
    terminal: sse.terminal ?? null,
    reasonCode: reason !== null && typeof reason === 'object' ? (reason.code ?? null) : null,
    reasonDetail: reason !== null && typeof reason === 'object' ? (reason.detail ?? reason.message ?? null) : null,
    eventOrder: sse.events ?? null,
  };
}

/** Read the hypothesis payload out of the replayed SSE (`hypothesis.structured` data). */
function readHypothesisPayload(ssePath) {
  if (!existsSync(ssePath)) return null;
  const raw = readFileSync(ssePath, 'utf8');
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!/event: hypothesis\.structured/.test(block)) continue;
    const dataMatch = /data: (.*)/.exec(block);
    if (dataMatch === null) continue;
    try {
      const parsed = JSON.parse(dataMatch[1]);
      return parsed?.data ?? null;
    } catch { return null; }
  }
  return null;
}

/**
 * "四要素是否回指真实对象" (DEV DOC v1.1 §10.1: 重点看 objects/relations/evidence 指向真实 $id / predicate / source_ref).
 * Every element must match a referent that actually exists in the isolated fixture graph; prose
 * placeholders ("未获取：…") therefore fail, even when the adapter accepted the payload as structured.
 */
function contentBackref(payload) {
  if (payload === null) return { objectsReal: false, relationsReal: false, evidenceReal: false, contentQualified: false, detail: 'no structured payload' };
  const asArray = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
  const objects = asArray(payload.objects);
  const relations = asArray(payload.relations);
  const evidence = asArray(payload.evidence);
  const objectsReal = objects.length > 0 && objects.every((item) => realNodeIds.has(item));
  const relationsReal = relations.length > 0 && relations.every((item) => realPredicates.has(item));
  const evidenceReal = evidence.length > 0 && evidence.every((item) => realEvidenceRefs.has(item));
  return {
    objectsReal,
    relationsReal,
    evidenceReal,
    contentQualified: objectsReal && relationsReal && evidenceReal,
    detail: `objects=${objects.length}/${objectsReal ? 'real' : 'not-real'} relations=${relations.length}/${relationsReal ? 'real' : 'not-real'} evidence=${evidence.length}/${evidenceReal ? 'real' : 'not-real'}`,
  };
}

const runs = [];
for (const [phase, dir] of [['M1', m1Dir], ['M2a', m2Dir], ['M2b', m2Dir]]) {
  for (const meta of readMetas(dir)) {
    if (phase === 'M2a' && !meta.id.startsWith('M2a-')) continue;
    if (phase === 'M2b' && !meta.id.startsWith('M2b-')) continue;
    if (phase === 'M1' && meta.id !== 'M1') continue;
    const ssePath = join(dir, `${meta.id}-sse.txt`);
    const text = readTextStats(ssePath);
    const verdict = sseVerdict(meta);
    const zstd = findSessionZstd(meta.sessionId);
    const payload = readHypothesisPayload(ssePath);
    const backref = contentBackref(payload);
    let usage = null;
    let session = null;
    if (zstd !== null) {
      try {
        const stdout = execFileSync(process.execPath, [sessionUsage, '--session-zstd', zstd, '--evidence', dir, '--id', meta.id, '--decoder', decoder], { encoding: 'utf8' });
        session = JSON.parse(stdout.trim().split('\n').pop());
        const summaryPath = join(dir, `${meta.id}-dsh-session.json`);
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
        usage = summary.totals;
        session = { ...session, assistantMessageCount: summary.assistantMessageCount, messages: summary.messages.map((m) => ({ seq: m.seq, model: m.model, provider: m.provider, contentTypes: m.contentTypes, usage: m.usage, textChars: m.textChars })) };
      } catch (err) {
        session = { decodeOk: false, error: String(err).slice(0, 400) };
      }
    }
    runs.push({
      id: meta.id,
      phase,
      runId: meta.runId,
      sessionId: meta.sessionId,
      prompt: meta.prompt,
      promptChars: meta.promptChars,
      submittedAt: meta.submittedAt,
      domStatus: meta.domStatus,
      domAuth: meta.auth,
      domStructured: meta.hypothesisStructuredDom === 'true',
      domHypothesisFields: meta.hypothesisFields ?? null,
      domClaim: meta.hypothesisClaim ?? null,
      sseHypothesis: verdict.hypothesisEvent,
      sseTerminal: verdict.terminal,
      reasonCode: verdict.reasonCode,
      reasonDetail: verdict.reasonDetail,
      eventOrder: verdict.eventOrder,
      textDeltas: text.textDeltas,
      textChars: text.chars,
      reasoningDeltas: text.reasoningDeltas,
      toolStarted: text.toolStarted,
      usageTotalTokens: usage?.totalTokens ?? null,
      usageInputTokens: usage?.inputTokens ?? null,
      usageOutputTokens: usage?.outputTokens ?? null,
      sessionLogAvailable: zstd !== null,
      session,
      hasText: text.textDeltas > 0 && text.chars > 0,
      hypothesisPayload: payload,
      contentBackref: backref,
    });
  }
}

function summarize(phase) {
  const rows = runs.filter((run) => run.phase === phase);
  const withText = rows.filter((run) => run.hasText);
  const structured = withText.filter((run) => run.sseHypothesis === 'structured');
  const empty = rows.filter((run) => !run.hasText);
  const reasons = {};
  for (const run of rows) {
    if (run.sseHypothesis === 'structured') continue;
    const key = `${run.sseHypothesis ?? 'none'}:${run.reasonCode ?? '-'}`;
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  const rate = withText.length === 0 ? null : structured.length / withText.length;
  const contentQualified = rows.filter((run) => run.contentBackref?.contentQualified === true).length;
  return {
    phase,
    runs: rows.length,
    withText: withText.length,
    emptyRuns: empty.length,
    structured: structured.length,
    invalid: withText.length - structured.length,
    passRate: rate,
    passRatePct: rate === null ? null : `${(rate * 100).toFixed(0)}%`,
    contentQualified,
    contentRatePct: withText.length === 0 ? null : `${((contentQualified / withText.length) * 100).toFixed(0)}%`,
    reasons,
    totalTokens: rows.reduce((sum, run) => sum + (run.usageTotalTokens ?? 0), 0),
  };
}

const summary = { generatedAt: new Date().toISOString(), referents, m1: summarize('M1'), m2a: summarize('M2a'), m2b: summarize('M2b'), runs };
writeFileSync(join(m2Dir, 'runs.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const line = (run) => `| ${run.id} | \`${run.runId}\` | ${run.prompt.replace(/\n+/g, ' ').slice(0, 60)}… | ${run.sseHypothesis ?? 'none'} | ${run.reasonCode ?? '-'} | ${run.contentBackref?.contentQualified === true ? 'yes' : 'no'} | ${run.textDeltas} | ${run.usageTotalTokens ?? 'n/a'} |`;
const table = [
  '# #1459 M2 契约合格率抽样（M2a / M2b 分列）',
  '',
  `> 生成 = consolidate.mjs（每条数据读自该 run 的 SSE 重放 + DSH 会话日志 + 桌面 DOM，无手写数字）｜${summary.generatedAt}`,
  '',
  '## 合格率（两种口径分开列，禁止混用）',
  '',
  '- **形状合格** = 服务端适配器判 `hypothesis.structured`（四要素非空且类型正确）÷ **有文本的 run**。',
  '- **内容回指** = 四要素**逐项**命中隔离库里真实存在的 `$id` / `predicate` / `source_ref`（DEV DOC v1.1 §10.1 的重点口径）。',
  '',
  '| 段 | 记录 run | 有文本 run（分母） | 空文本 run | 形状合格 | 形状合格率 | 内容回指 | 内容回指率 |',
  '|---|---|---|---|---|---|---|---|',
  `| M2a（自然提问，零格式要求） | ${summary.m2a.runs} | ${summary.m2a.withText} | ${summary.m2a.emptyRuns} | ${summary.m2a.structured} | **${summary.m2a.passRatePct ?? 'n/a'}** | ${summary.m2a.contentQualified} | **${summary.m2a.contentRatePct ?? 'n/a'}** |`,
  `| M2b（同题 + T5 形状要求） | ${summary.m2b.runs} | ${summary.m2b.withText} | ${summary.m2b.emptyRuns} | ${summary.m2b.structured} | **${summary.m2b.passRatePct ?? 'n/a'}** | ${summary.m2b.contentQualified} | **${summary.m2b.contentRatePct ?? 'n/a'}** |`,
  '',
  '## 失败码分布',
  '',
  '| 段 | reason.code | 条数 |',
  '|---|---|---|',
  ...Object.entries(summary.m2a.reasons).map(([key, count]) => `| M2a | ${key} | ${count} |`),
  ...Object.entries(summary.m2b.reasons).map(([key, count]) => `| M2b | ${key} | ${count} |`),
  '',
  '## 逐条记录（每条一行；每条各问一次，无重试）',
  '',
  '| id | runId | prompt（≤60字） | 假设事件 | reason.code | 内容回指 | textDeltas | usage.totalTokens |',
  '|---|---|---|---|---|---|---|---|',
  ...runs.filter((run) => run.phase !== 'M1').map(line),
  '',
  '## M1（真实登录复跑，单列，不计入合格率）',
  '',
  '| id | runId | auth | 假设事件 | reason.code | 内容回指 | textDeltas | usage.totalTokens |',
  '|---|---|---|---|---|---|---|---|',
  ...runs.filter((run) => run.phase === 'M1').map((run) => `| ${run.id} | \`${run.runId}\` | ${run.domAuth} | ${run.sseHypothesis ?? 'none'} | ${run.reasonCode ?? '-'} | ${run.contentBackref?.contentQualified === true ? 'yes' : 'no'} | ${run.textDeltas} | ${run.usageTotalTokens ?? 'n/a'} |`),
  '',
  '## 隔离库里的真实指代（内容回指的判据来源）',
  '',
  `- node ids：${referents.realNodeIds.map((id) => `\`${id}\``).join('、')}`,
  `- predicate：${referents.realPredicates.map((id) => `\`${id}\``).join('、')}`,
  `- evidence source_ref：${referents.realEvidenceRefs.map((id) => `\`${id}\``).join('、')}`,
  '',
].join('\n');
writeFileSync(join(m2Dir, 'pass-rate.md'), table, 'utf8');

writeFileSync(join(m2Dir, 'runs-summary.json'), `${JSON.stringify({ generatedAt: summary.generatedAt, referents, m1: summary.m1, m2a: summary.m2a, m2b: summary.m2b }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ m1: summary.m1, m2a: summary.m2a, m2b: summary.m2b }, null, 2));
