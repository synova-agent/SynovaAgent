/**
 * capture-run.mjs — R3 chain evidence script (Issue #1455, T3 captures).
 *
 * Reads the run back from the REAL API after the desktop run reached its terminal event:
 *   GET /api/dsh/runs/:runId          -> 06-run-snapshot.json
 *   GET /api/dsh/runs/:runId/events   -> 05-sse-events.txt (raw SSE bytes) + frame meta
 *
 * The SSE body is written verbatim (no re-formatting) so the transport evidence stays raw;
 * parsed frames are summarised in T3-sse-meta.json only.
 *
 * usage: node capture-run.mjs --base <url> --jwt <token> --run-id <id> --evidence <dir>
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const base = args.get('base');
const jwt = args.get('jwt');
const runId = args.get('run-id');
const evidenceDir = args.get('evidence');
if (!base || !jwt || !runId || !evidenceDir) {
  throw new Error('capture-run: --base --jwt --run-id --evidence are required');
}

const headers = { authorization: `Bearer ${jwt}` };

const snapshotResponse = await fetch(`${base}/api/dsh/runs/${encodeURIComponent(runId)}`, { headers });
const snapshotText = await snapshotResponse.text();
writeFileSync(join(evidenceDir, '06-run-snapshot.json'), `${snapshotText}\n`, 'utf8');

const sseResponse = await fetch(`${base}/api/dsh/runs/${encodeURIComponent(runId)}/events`, { headers });
const sseText = await sseResponse.text();
writeFileSync(join(evidenceDir, '05-sse-events.txt'), sseText, 'utf8');

/** Parse `id: <seq>` / `event: <type>` / `data: <json>` frames the way the route writes them. */
const frames = [];
for (const block of sseText.split(/\r?\n\r?\n/)) {
  if (block.trim().length === 0) continue;
  const frame = { id: null, event: null, data: null, raw: block };
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('id:')) frame.id = Number(line.slice(3).trim());
    else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
    else if (line.startsWith('data:')) {
      const dataText = line.slice(5).trim();
      try { frame.data = JSON.parse(dataText); } catch { frame.data = { _unparsed: dataText }; }
    }
  }
  frames.push(frame);
}

const eventTypes = frames.map(frame => frame.event ?? frame.data?.type ?? null).filter(name => name !== null);
const terminal = frames.find(frame => ['run.completed', 'run.failed', 'run.cancelled'].includes(String(frame.event ?? frame.data?.type)));
const toolStarted = frames.filter(frame => (frame.event ?? frame.data?.type) === 'tool.started');
const toolFinished = frames.filter(frame => (frame.event ?? frame.data?.type) === 'tool.finished');
const textDeltas = frames.filter(frame => (frame.event ?? frame.data?.type) === 'text.delta');

const snapshot = JSON.parse(snapshotText);
const meta = {
  ok: sseResponse.status === 200 && snapshotResponse.status === 200,
  generatedAt: new Date().toISOString(),
  baseUrl: base,
  runId,
  snapshotHttpStatus: snapshotResponse.status,
  snapshot: {
    status: snapshot.status,
    sessionId: snapshot.sessionId,
    eventCount: snapshot.eventCount,
    stats: snapshot.stats,
    terminal: snapshot.terminal,
  },
  sseHttpStatus: sseResponse.status,
  sseContentType: sseResponse.headers.get('content-type'),
  sseBytes: Buffer.byteLength(sseText, 'utf8'),
  frameCount: frames.length,
  eventTypes,
  counters: {
    textDeltas: textDeltas.length,
    toolStarted: toolStarted.length,
    toolFinished: toolFinished.length,
    other: frames.length - textDeltas.length - toolStarted.length - toolFinished.length,
  },
  terminalFrame: terminal === undefined ? null : { event: terminal.event ?? terminal.data?.type, id: terminal.id, data: terminal.data },
  toolStartedFrames: toolStarted.map(frame => ({ id: frame.id, data: frame.data })),
  toolFinishedFrames: toolFinished.map(frame => ({ id: frame.id, data: frame.data })),
};
writeFileSync(join(evidenceDir, 'T3-sse-meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: meta.ok,
  snapshotStatus: meta.snapshot.status,
  sessionId: meta.snapshot.sessionId,
  runStats: meta.snapshot.stats,
  terminal: meta.terminalFrame?.event ?? null,
  terminalEmpty: meta.terminalFrame?.data?.empty ?? null,
  terminalToolCalls: meta.terminalFrame?.data?.stats?.toolCalls ?? null,
  frameCount: meta.frameCount,
  counters: meta.counters,
  eventTypes: Array.from(new Set(eventTypes)),
}, null, 2)}\n`);
if (!meta.ok) process.exit(1);
