/**
 * m1m2-drive.mjs — #1459 closeout runner: drive the REAL desktop renderer over CDP.
 *
 * M1  : log in through the app's own login panel with the isolated test account, then one
 *       controlled prompt (T5 shape) — records the three evidence pieces (SSE / DSH session / desktop DOM).
 * M2a : the five natural questions, zero format requirement.
 * M2b : the same five questions + the T5 shape-only block (no problemId, no data, no answer hint).
 *
 * Every field written here is read back from the live DOM or from a real HTTP response; nothing is
 * synthesised. The prompt text for each run is fixed before the first call and never rewritten after
 * seeing an outcome (no retries, no prompt tuning).
 *
 * usage:
 *   node m1m2-drive.mjs --cdp-port 9222 --base http://127.0.0.1:18790 \
 *        --email <m> --password-file <p> --evidence <dir> [--phase M1|M2a|M2b] [--skip-login]
 * @output <evidence>/<id>-desktop.png, <id>-dom.json, <id>-sse.txt, <id>-meta.json,
 *         m1m2-drive-result.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key.startsWith('--')) throw new Error(`bad argument: ${key}`);
  args.set(key.slice(2), process.argv[i + 1]);
}
const cdpPort = args.get('cdp-port') ?? '9222';
const base = args.get('base');
const email = args.get('email');
const passwordFile = args.get('password-file');
const evidence = args.get('evidence');
const phaseFilter = args.get('phase') ?? null;
const skipLogin = args.get('skip-login') === 'true';
const waitMs = Number(args.get('wait-ms') ?? '300000');
if (!base || !email || !passwordFile || !evidence) {
  throw new Error('m1m2-drive: --base --email --password-file --evidence are required');
}
mkdirSync(evidence, { recursive: true });
const password = readFileSync(passwordFile, 'utf8').trim();

// ── Fixed prompt plan (frozen before the first call) ────────────────────────────────────────────
const T5_FORMAT_BLOCK = [
  '请只调用一次工具 synova_context_get。',
  '拿到返回 JSON 后，只输出一个 JSON 对象（不要输出任何解释文字，也不要使用代码围栏）。',
  '该 JSON 必须包含以下五个字段且都非空：hypothesis（一句中文瓶颈假设）；objects（数组，元素为条目里的 $id）；',
  'relations（数组，元素为条目里的 relation.type）；evidence（数组，元素为条目里的 evidence.sources[0].ref）；',
  'uncertainty（数组，写清你无法确认的地方）。不要调用其它工具，不要臆造数据。',
].join('');
const Q = [
  '我们今年的增长为什么慢下来了？主要卡在哪个环节？',
  '交付团队的产能是不是瓶颈？如果是，具体卡在哪一步？',
  '如果只能改一件事来提升回款速度，你会改什么？',
  '我们组织里哪个团队对结果影响最大、却最容易被忽视？',
  '就现在能看到的数据，有哪些地方你其实没法确认、需要我们去核？',
];
const plan = [
  {
    id: 'M1',
    phase: 'M1',
    prompt: '这是一次合成数据测试。请只调用一次工具 synova_context_get，参数 problemId = team:delivery-a。'
      + '拿到返回 JSON 后，只输出一个 JSON 对象（不要输出任何解释文字，也不要使用代码围栏）。'
      + '该 JSON 必须包含以下五个字段且都非空：hypothesis（一句中文瓶颈假设）；objects（数组，元素为条目里的 $id）；'
      + 'relations（数组，元素为条目里的 relation.type）；evidence（数组，元素为条目里的 evidence.sources[0].ref）；'
      + 'uncertainty（数组，写清你无法确认的地方）。不要调用其它工具，不要臆造数据。',
  },
  ...Q.map((text, index) => ({ id: `M2a-Q${index + 1}`, phase: 'M2a', prompt: text })),
  ...Q.map((text, index) => ({ id: `M2b-Q${index + 1}`, phase: 'M2b', prompt: `${text}\n\n${T5_FORMAT_BLOCK}` })),
];
const selected = phaseFilter === null ? plan : plan.filter((item) => item.phase === phaseFilter);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (event) => reject(new Error(`cdp ws error: ${String(event?.message ?? event)}`)));
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id !== 'number') return;
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails)}`);
    return result.result?.value;
  }
  close() { this.ws.close(); }
}

async function findPageTarget(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.includes('5173'));
      if (page !== undefined) return page;
      last = `targets=${targets.map((t) => `${t.type}:${t.url}`).join(' | ')}`;
    } catch (err) { last = String(err); }
    await sleep(500);
  }
  throw new Error(`no 5173 page target within ${deadlineMs}ms (${last ?? 'no cdp response'})`);
}

const READ_PANEL = `(() => {
  const panel = document.querySelector('[data-testid="dsh-run-panel"]');
  const loginPanel = document.querySelector('[data-testid="dsh-login-panel"]');
  const entry = document.querySelector('#dsh-login-entry');
  const events = Array.from(document.querySelectorAll('[data-testid="dsh-run-events"] li'));
  const statusEl = document.querySelector('.dsh-status');
  const runIdEl = document.querySelector('.dsh-run-id');
  const sessionEl = document.querySelector('.dsh-session-id');
  const errorEl = document.querySelector('.dsh-error');
  const loginError = document.querySelector('.dsh-login-error');
  const hypothesis = events.filter((e) => e.getAttribute('data-event-kind') === 'hypothesis');
  const fields = {};
  for (const field of ['objects', 'relations', 'evidence', 'uncertainty']) {
    const node = document.querySelector('[data-hypothesis-field="' + field + '"]');
    fields[field] = node === null ? null : Array.from(node.querySelectorAll('li')).map((li) => li.innerText);
  }
  const claimEl = document.querySelector('.dsh-hypothesis-claim');
  const rawEl = document.querySelector('.dsh-hypothesis-raw');
  const unstructuredEl = document.querySelector('.dsh-hypothesis-unstructured');
  return {
    href: location.href,
    hasRunPanel: panel !== null,
    hasLoginPanel: loginPanel !== null,
    hasLoginEntry: entry !== null,
    auth: panel ? panel.getAttribute('data-auth') : null,
    runStatus: panel ? panel.getAttribute('data-run-status') : null,
    statusText: statusEl ? statusEl.innerText : null,
    runIdText: runIdEl ? runIdEl.innerText : null,
    sessionIdText: sessionEl ? sessionEl.innerText : null,
    errorCode: errorEl ? errorEl.getAttribute('data-error-code') : null,
    errorText: errorEl ? errorEl.innerText : null,
    loginErrorCode: loginError ? loginError.getAttribute('data-error-code') : null,
    loginErrorText: loginError ? loginError.innerText : null,
    eventCount: events.length,
    eventKinds: events.map((e) => e.getAttribute('data-event-kind')),
    hypothesisCount: hypothesis.length,
    hypothesisStructured: hypothesis.length === 0 ? null : hypothesis[hypothesis.length - 1].getAttribute('data-hypothesis-structured'),
    hypothesisClaim: claimEl ? claimEl.innerText : null,
    hypothesisFields: fields,
    hypothesisRaw: rawEl ? rawEl.innerText : null,
    hypothesisInvalidReason: unstructuredEl ? unstructuredEl.innerText : null,
    toolEvents: events.filter((e) => e.getAttribute('data-event-kind') === 'tool').map((e) => ({
      status: e.getAttribute('data-tool-status'),
      text: e.innerText,
    })),
  };
})()`;

const result = { ok: false, phase: 'start', generatedAt: new Date().toISOString(), plan: selected.map((p) => p.id), runs: [], reason: null };
let cdp = null;

function runIdOf(panel) {
  const text = panel?.runIdText ?? '';
  const match = /run_[A-Za-z0-9]+/.exec(text);
  return match === null ? null : match[0];
}
function sessionIdOf(panel) {
  const text = panel?.sessionIdText ?? '';
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(text);
  return match === null ? null : match[1];
}

/** API login of the SAME account, used ONLY to replay this run's SSE frames into evidence. */
async function apiLogin() {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await response.json();
  if (json.ok !== true || typeof json.token !== 'string') throw new Error(`api login failed: ${response.status} ${json.code ?? ''}`);
  return json.token;
}

async function captureSse(token, runId, id) {
  const response = await fetch(`${base}/api/dsh/runs/${encodeURIComponent(runId)}/events`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  writeFileSync(join(evidence, `${id}-sse.txt`), text, 'utf8');
  const frames = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (block.trim().length === 0) continue;
    const frame = { id: null, event: null, data: null };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('id:')) frame.id = Number(line.slice(3).trim());
      else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        try { frame.data = JSON.parse(line.slice(5).trim()); } catch { frame.data = { _unparsed: true }; }
      }
    }
    frames.push(frame);
  }
  const started = frames.find((f) => f.event === 'run.started');
  const structured = frames.find((f) => f.event === 'hypothesis.structured');
  const invalid = frames.find((f) => f.event === 'hypothesis.invalid');
  const completed = frames.find((f) => f.event === 'run.completed');
  const failed = frames.find((f) => f.event === 'run.failed');
  const toolStarted = frames.filter((f) => f.event === 'tool.started');
  return {
    httpStatus: response.status,
    frameCount: frames.length,
    events: frames.map((f) => f.event),
    runStarted: started?.data?.data ?? started?.data ?? null,
    hypothesis: structured !== undefined ? 'structured' : (invalid !== undefined ? 'invalid' : 'none'),
    invalidReason: invalid?.data?.data?.reason ?? null,
    terminal: completed !== undefined ? 'run.completed' : (failed !== undefined ? 'run.failed' : null),
  };
}

async function driveOne(token, item) {
  const before = await cdp.evaluate(READ_PANEL);
  const previousRunId = runIdOf(before);
  const fill = await cdp.evaluate(`(() => {
    const el = document.querySelector('#dsh-run-input');
    if (el === null) return 'missing-run-input';
    const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    desc.set.call(el, ${JSON.stringify(item.prompt)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.length;
  })()`);
  const submittedAt = new Date().toISOString();
  const click = await cdp.evaluate(`(() => {
    const button = document.querySelector('#dsh-run-submit');
    if (button === null) return { clicked: false, reason: 'missing-submit' };
    if (button.disabled) return { clicked: false, reason: 'submit-disabled' };
    button.click();
    return { clicked: true, reason: null };
  })()`);
  if (click.clicked !== true) throw new Error(`${item.id}: submit not clicked (${click.reason})`);

  const deadline = Date.now() + waitMs;
  let last = null;
  let terminal = false;
  const timeline = [];
  while (Date.now() < deadline) {
    last = await cdp.evaluate(READ_PANEL);
    timeline.push({ at: new Date().toISOString(), status: last.runStatus, events: last.eventCount, runId: runIdOf(last) });
    const currentRunId = runIdOf(last);
    if (currentRunId !== null && currentRunId !== previousRunId && ['done', 'failed', 'cancelled', 'expired'].includes(last.runStatus)) {
      terminal = true;
      break;
    }
    await sleep(1000);
  }
  const runId = runIdOf(last ?? {});
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(evidence, `${item.id}-desktop.png`), Buffer.from(shot.data, 'base64'));
  writeFileSync(join(evidence, `${item.id}-dom.json`), `${JSON.stringify(last, null, 2)}\n`, 'utf8');
  const sse = runId === null ? null : await captureSse(token, runId, item.id);
  const meta = {
    id: item.id,
    phase: item.phase,
    prompt: item.prompt,
    promptChars: item.prompt.length,
    submittedAt,
    terminal,
    runId,
    sessionId: sessionIdOf(last ?? {}),
    domStatus: last?.runStatus ?? null,
    auth: last?.auth ?? null,
    hypothesisStructuredDom: last?.hypothesisStructured ?? null,
    hypothesisEvents: last?.hypothesisCount ?? null,
    eventCount: last?.eventCount ?? null,
    eventKinds: last?.eventKinds ?? null,
    sse,
    timelineTail: timeline.slice(-3),
  };
  writeFileSync(join(evidence, `${item.id}-meta.json`), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

try {
  const page = await findPageTarget(120_000);
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  result.page = { url: page.url, title: page.title };

  // navigate to the DSH panel through the app's own left navigation
  for (let i = 0; i < 120; i += 1) {
    const state = await cdp.evaluate(`(() => {
      const nav = document.querySelector('[data-cap="nav-dsh"]');
      const panel = document.querySelector('[data-testid="dsh-run-panel"]');
      const login = document.querySelector('[data-testid="dsh-login-panel"]');
      if (panel === null && login === null && nav !== null) { nav.click(); return { clicked: true }; }
      return { clicked: false, hasPanel: panel !== null, hasLogin: login !== null };
    })()`);
    if (state.clicked === false) break;
    await sleep(500);
  }

  if (!skipLogin) {
    const pre = await cdp.evaluate(READ_PANEL);
    result.preLogin = { auth: pre.auth, hasLoginPanel: pre.hasLoginPanel, hasLoginEntry: pre.hasLoginEntry };
    if (!pre.hasLoginPanel) {
      if (!pre.hasLoginEntry) throw new Error('no login panel and no login entry — cannot reach token auth');
      await cdp.evaluate(`(() => { document.querySelector('#dsh-login-entry').click(); return true; })()`);
      for (let i = 0; i < 100; i += 1) {
        const has = await cdp.evaluate(`document.querySelector('#dsh-login-email') !== null`);
        if (has) break;
        await sleep(200);
      }
    }
    await cdp.evaluate(`(() => {
      const el = document.querySelector('#dsh-login-email');
      if (el === null) return 'missing-email';
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      desc.set.call(el, ${JSON.stringify(email)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value.length;
    })()`);
    await cdp.evaluate(`(() => {
      const el = document.querySelector('#dsh-login-password');
      if (el === null) return 'missing-password';
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      desc.set.call(el, ${JSON.stringify(password)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value.length;
    })()`);
    await cdp.evaluate(`(() => { document.querySelector('#dsh-login-submit').click(); return true; })()`);
    const deadline = Date.now() + 60_000;
    let authState = null;
    while (Date.now() < deadline) {
      authState = await cdp.evaluate(READ_PANEL);
      if (authState.auth === 'authenticated') break;
      if (authState.loginErrorCode !== null) break;
      await sleep(300);
    }
    result.login = { auth: authState?.auth ?? null, loginErrorCode: authState?.loginErrorCode ?? null, loginErrorText: authState?.loginErrorText ?? null };
    if (authState?.auth !== 'authenticated') {
      throw new Error(`login did not reach authenticated (auth=${authState?.auth}, error=${authState?.loginErrorCode})`);
    }
  }

  const token = await apiLogin();
  for (const item of selected) {
    const meta = await driveOne(token, item);
    result.runs.push(meta);
    process.stdout.write(`${JSON.stringify({ id: meta.id, terminal: meta.terminal, runId: meta.runId, domStatus: meta.domStatus, structured: meta.hypothesisStructuredDom, sseHypothesis: meta.sse?.hypothesis ?? null })}\n`);
    await sleep(1500);
  }
  result.ok = true;
  result.phase = 'done';
} catch (err) {
  result.reason = err instanceof Error ? err.message : String(err);
  result.phase = 'failed';
} finally {
  writeFileSync(join(evidence, 'm1m2-drive-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (cdp !== null) cdp.close();
}
process.stdout.write(`${JSON.stringify({ ok: result.ok, phase: result.phase, reason: result.reason, login: result.login ?? null, runs: result.runs.map((r) => ({ id: r.id, runId: r.runId, status: r.domStatus, structured: r.hypothesisStructuredDom })) })}\n`);
if (!result.ok) process.exit(1);
