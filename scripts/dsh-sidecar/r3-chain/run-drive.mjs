/**
 * run-drive.mjs — R3 chain evidence script (Issue #1455, T3).
 *
 * Drives the REAL Electron desktop renderer over the Chrome DevTools Protocol
 * (the page at http://localhost:5173 that electron/main.cjs loaded) and records what
 * the user would see:
 *   login (synthetic account) -> type the synthetic prompt -> click 发起会话 ->
 *   poll the panel until the run reaches a terminal status -> screenshot + DOM + console.
 *
 * It never fabricates state: every recorded field is read back from the live DOM or from
 * a CDP response. It does not start/stop the app or the backend — it only drives the UI.
 *
 * usage:
 *   node run-drive.mjs --cdp-port 9222 --evidence <dir> --email <m> --password <p>
 *        --problem-id <id> --wait-ms 240000 --app-wait-ms 180000
 *
 * @output <evidence>/T3-cdp-result.json, <evidence>/08-desktop.png, <evidence>/09-desktop-console.txt
 * @error  any step that does not reach its observable state -> exit 1 with the recorded reason
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (key === undefined || !key.startsWith('--')) throw new Error(`bad argument: ${key}`);
  args.set(key.slice(2), value);
}
const cdpPort = args.get('cdp-port') ?? '9222';
const evidenceDir = args.get('evidence');
const email = args.get('email');
const password = args.get('password');
const problemId = args.get('problem-id');
const waitMs = Number(args.get('wait-ms') ?? '240000');
const appWaitMs = Number(args.get('app-wait-ms') ?? '180000');
const captureOnly = args.get('capture-only') === 'true';
if (!evidenceDir || !email || !password || !problemId) {
  throw new Error('run-drive: --evidence --email --password --problem-id are required');
}

const PROMPT = [
  `这是一次合成数据测试。请只调用一次工具 synova_context_get，参数 problemId = ${problemId}，`,
  '然后只用中文回答三点：(1) 返回 JSON 里的 count 数值；(2) 每个条目的 $id；(3) 每个条目的 period 和 defVersion。',
  '不要调用其它工具，不要臆造数据；如果工具报错，请原样复述错误码。',
].join('');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Wait until the page target of the vite dev server is exposed by the CDP endpoint. */
async function findPageTarget() {
  const deadline = Date.now() + appWaitMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const targets = await response.json();
      const page = targets.find(target => target.type === 'page' && typeof target.url === 'string' && target.url.includes('localhost:5173'));
      if (page !== undefined) return { page, targets };
      if (targets.length > 0) lastError = `no 5173 page yet; targets=${targets.map(t => `${t.type}:${t.url}`).join(' | ')}`;
    } catch (err) {
      lastError = String(err);
    }
    await sleep(500);
  }
  throw new Error(`run-drive: vite page target not found within ${appWaitMs}ms (${lastError ?? 'no cdp response'})`);
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', event => reject(new Error(`cdp ws error: ${String(event?.message ?? event)}`)));
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (typeof message.id === 'number') {
        const waiter = this.pending.get(message.id);
        if (waiter !== undefined) {
          this.pending.delete(message.id);
          if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
          else waiter.resolve(message.result);
        }
        return;
      }
      this.events.push(message);
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  close() { this.ws.close(); }
}

const consoleLines = [];
function collectConsole(events) {
  for (const event of events) {
    if (event.method === 'Runtime.consoleAPICalled') {
      const text = (event.params.args ?? []).map(arg => {
        if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
        return arg.description ?? arg.type;
      }).join(' ');
      consoleLines.push(`[console.${event.params.type}] ${text}`);
    } else if (event.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`[exception] ${event.params.exceptionDetails?.text ?? ''} ${event.params.exceptionDetails?.exception?.description ?? ''}`);
    } else if (event.method === 'Log.entryAdded') {
      consoleLines.push(`[log.${event.params.entry.level}] ${event.params.entry.text}`);
    }
  }
}

const result = {
  ok: false,
  phase: 'start',
  generatedAt: new Date().toISOString(),
  cdpPort,
  prompt: PROMPT,
  steps: [],
  dom: null,
  console: consoleLines,
  reason: null,
};
let cdp = null;

function record(step, detail) {
  result.steps.push({ at: new Date().toISOString(), step, detail });
}

try {
  const { page, targets } = await findPageTarget();
  record('pageTarget', { id: page.id, url: page.url, title: page.title, targetCount: targets.length });
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  record('cdpConnected', { webSocketDebuggerUrl: page.webSocketDebuggerUrl });

  // 1) navigate to the DSH view through the app's own navigation, then wait for its panel.
  //    The desktop boots into the welcome / LLM-setup view, so the run panel only exists after
  //    the user selects "DSH 会话" in the left navigation (@see electron-renderer/src/components/LeftPanel.tsx data-cap="nav-dsh").
  const navDeadline = Date.now() + 60_000;
  let navState = null;
  while (Date.now() < navDeadline) {
    navState = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="dsh-run-panel"]');
      const loginPanel = document.querySelector('[data-testid="dsh-login-panel"]');
      const nav = document.querySelector('[data-cap="nav-dsh"]');
      if (panel === null && loginPanel === null && nav !== null) { nav.click(); return { clicked: true }; }
      return { clicked: false };
    })()`);
    if (navState.clicked === false) break;
    await sleep(300);
  }
  record('navigateToDsh', navState ?? null);

  const panelDeadline = Date.now() + 60_000;
  let panelState = null;
  while (Date.now() < panelDeadline) {
    panelState = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="dsh-run-panel"]');
      const loginPanel = document.querySelector('[data-testid="dsh-login-panel"]');
      const loginEntry = document.querySelector('#dsh-login-entry');
      return {
        href: location.href,
        hasRunPanel: panel !== null,
        hasLoginPanel: loginPanel !== null,
        hasLoginEntry: loginEntry !== null,
        auth: panel ? panel.getAttribute('data-auth') : null,
        bodyTextSize: document.body ? document.body.innerText.length : 0,
      };
    })()`);
    if (panelState.hasRunPanel || panelState.hasLoginPanel) break;
    await sleep(500);
  }
  record('panelPresent', panelState);
  if (!panelState || (!panelState.hasRunPanel && !panelState.hasLoginPanel)) {
    throw new Error('run-drive: DSH panel did not appear in the renderer');
  }

  // Capture-only mode: a run already reached its terminal status in this app instance; read the
  // live panel DOM + screenshot + console without starting a second model round.
  if (captureOnly) {
    result.phase = 'capturing';
    const live = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="dsh-run-panel"]');
      const events = Array.from(document.querySelectorAll('[data-testid="dsh-run-events"] li'));
      const runIdEl = document.querySelector('.dsh-run-id');
      const sessionEl = document.querySelector('.dsh-session-id');
      const status = document.querySelector('.dsh-status');
      const errorEl = document.querySelector('.dsh-error');
      return {
        hasRunPanel: panel !== null,
        runStatus: panel ? panel.getAttribute('data-run-status') : null,
        auth: panel ? panel.getAttribute('data-auth') : null,
        statusText: status ? status.innerText : null,
        runIdText: runIdEl ? runIdEl.innerText : null,
        sessionIdText: sessionEl ? sessionEl.innerText : null,
        errorCode: errorEl ? errorEl.getAttribute('data-error-code') : null,
        errorText: errorEl ? errorEl.innerText : null,
        eventCount: events.length,
        toolEventCount: events.filter(e => e.getAttribute('data-event-kind') === 'tool').length,
        textEventCount: events.filter(e => e.getAttribute('data-event-kind') === 'text').length,
        events: events.map(e => ({
          seq: e.getAttribute('data-event-seq'),
          kind: e.getAttribute('data-event-kind'),
          toolCallId: e.getAttribute('data-tool-call-id'),
          toolStatus: e.getAttribute('data-tool-status'),
          text: e.innerText,
        })),
        runPanelOuterHTML: panel ? panel.outerHTML : null,
        runPanelText: panel ? panel.innerText : null,
      };
    })()`);
    record('captureOnlyState', { runStatus: live.runStatus, eventCount: live.eventCount, toolEventCount: live.toolEventCount, textEventCount: live.textEventCount });
    result.run = live;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(evidenceDir, '08-desktop.png'), Buffer.from(shot.data, 'base64'));
    record('screenshot', { bytes: Buffer.from(shot.data, 'base64').length });
    collectConsole(cdp.events);
    result.console = consoleLines;
    result.phase = 'done';
    result.ok = true;
    writeFileSync(join(evidenceDir, 'T3-cdp-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    writeFileSync(join(evidenceDir, '09-desktop-console.txt'), `${consoleLines.join('\n')}\n`, 'utf8');
    cdp.close();
    process.stdout.write(`${JSON.stringify({ ok: true, mode: 'capture-only', runStatus: live.runStatus, statusText: live.statusText, runIdText: live.runIdText, sessionIdText: live.sessionIdText, eventCount: live.eventCount, toolEventCount: live.toolEventCount, textEventCount: live.textEventCount, events: live.events }, null, 2)}\n`);
    process.exit(0);
  }

  // 2) login with the synthetic account (devmode shows a "使用账号登录" entry)
  let loginState = panelState;
  if (!loginState.hasLoginPanel) {
    if (!loginState.hasLoginEntry) throw new Error('run-drive: no login panel and no login entry — cannot reach token auth');
    await cdp.evaluate(`(() => { document.querySelector('#dsh-login-entry').click(); return true; })()`);
    const loginDeadline = Date.now() + 20_000;
    while (Date.now() < loginDeadline) {
      const has = await cdp.evaluate(`document.querySelector('#dsh-login-email') !== null`);
      if (has) break;
      await sleep(200);
    }
  }
  await cdp.evaluate(`(() => {
    const el = document.querySelector('#dsh-login-email');
    if (el === null) return 'missing-email-input';
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(el, ${JSON.stringify(email)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`).then(value => record('fillEmail', value));
  await cdp.evaluate(`(() => {
    const el = document.querySelector('#dsh-login-password');
    if (el === null) return 'missing-password-input';
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(el, ${JSON.stringify(password)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.length;
  })()`).then(value => record('fillPasswordLength', value));
  await cdp.evaluate(`(() => { document.querySelector('#dsh-login-submit').click(); return true; })()`);
  record('loginSubmitted', true);

  const authDeadline = Date.now() + 30_000;
  let authState = null;
  while (Date.now() < authDeadline) {
    authState = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="dsh-run-panel"]');
      const error = document.querySelector('.dsh-login-error');
      return {
        hasRunPanel: panel !== null,
        auth: panel ? panel.getAttribute('data-auth') : null,
        loginErrorCode: error ? error.getAttribute('data-error-code') : null,
        loginErrorText: error ? error.innerText : null,
      };
    })()`);
    if (authState.auth === 'authenticated') break;
    if (authState.loginErrorCode !== null) break;
    await sleep(300);
  }
  record('authAfterLogin', authState);
  if (!authState || authState.auth !== 'authenticated') {
    throw new Error(`run-drive: login did not reach authenticated (auth=${authState?.auth}, error=${authState?.loginErrorCode})`);
  }

  // 3) type the synthetic prompt and submit
  const filled = await cdp.evaluate(`(() => {
    const el = document.querySelector('#dsh-run-input');
    if (el === null) return 'missing-run-input';
    const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    desc.set.call(el, ${JSON.stringify(PROMPT)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.length;
  })()`);
  record('fillPromptLength', filled);
  const submitState = await cdp.evaluate(`(() => {
    const button = document.querySelector('#dsh-run-submit');
    if (button === null) return { clicked: false, reason: 'missing-submit' };
    if (button.disabled) return { clicked: false, reason: 'submit-disabled' };
    button.click();
    return { clicked: true, reason: null };
  })()`);
  record('submit', submitState);
  if (!submitState.clicked) throw new Error(`run-drive: submit not clicked (${submitState.reason})`);
  const submittedAt = new Date().toISOString();

  // 4) poll the live DOM until the run reaches a terminal status
  const runDeadline = Date.now() + waitMs;
  let last = null;
  let terminal = false;
  const timeline = [];
  while (Date.now() < runDeadline) {
    last = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="dsh-run-panel"]');
      const status = document.querySelector('.dsh-status');
      const runIdEl = document.querySelector('.dsh-run-id');
      const sessionEl = document.querySelector('.dsh-session-id');
      const errorEl = document.querySelector('.dsh-error');
      // the panel renders <ol data-testid="dsh-run-events">, not an id
      const events = Array.from(document.querySelectorAll('[data-testid="dsh-run-events"] li'));
      return {
        status: panel ? panel.getAttribute('data-run-status') : null,
        auth: panel ? panel.getAttribute('data-auth') : null,
        statusText: status ? status.innerText : null,
        runIdText: runIdEl ? runIdEl.innerText : null,
        sessionIdText: sessionEl ? sessionEl.innerText : null,
        eventCount: events.length,
        lastEventKind: events.length > 0 ? events[events.length - 1].getAttribute('data-event-kind') : null,
        toolEventCount: events.filter(event => event.getAttribute('data-event-kind') === 'tool').length,
        textEventCount: events.filter(event => event.getAttribute('data-event-kind') === 'text').length,
        errorCode: errorEl ? errorEl.getAttribute('data-error-code') : null,
        errorText: errorEl ? errorEl.innerText : null,
        hasCloseButton: document.querySelector('#dsh-run-close') !== null,
      };
    })()`);
    timeline.push({ at: new Date().toISOString(), status: last.status, eventCount: last.eventCount, toolEventCount: last.toolEventCount, textEventCount: last.textEventCount, errorCode: last.errorCode });
    if (['done', 'failed', 'cancelled', 'expired'].includes(last.status)) { terminal = true; break; }
    await sleep(1000);
  }
  record('runTerminal', { terminal, lastStatus: last?.status, submittedAt });
  result.run = last;
  result.timeline = timeline;
  result.terminatedAt = new Date().toISOString();
  if (!terminal) throw new Error(`run-drive: run did not reach a terminal status within ${waitMs}ms (last=${last?.status})`);

  // 5) capture the panel DOM exactly as the user sees it
  result.dom = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="dsh-run-panel"]');
    const events = Array.from(document.querySelectorAll('[data-testid="dsh-run-events"] li')).map(event => ({
      seq: event.getAttribute('data-event-seq'),
      kind: event.getAttribute('data-event-kind'),
      toolCallId: event.getAttribute('data-tool-call-id'),
      toolStatus: event.getAttribute('data-tool-status'),
      text: event.innerText,
    }));
    return {
      runPanelOuterHTML: panel ? panel.outerHTML : null,
      runPanelText: panel ? panel.innerText : null,
      events,
      visibleEventKinds: Array.from(new Set(events.map(event => event.kind))),
    };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(evidenceDir, '08-desktop.png'), Buffer.from(shot.data, 'base64'));
  record('screenshot', { bytes: Buffer.from(shot.data, 'base64').length });

  collectConsole(cdp.events);
  result.console = consoleLines;
  result.phase = 'done';
  result.ok = true;
} catch (err) {
  result.reason = err instanceof Error ? err.message : String(err);
  result.phase = 'failed';
  if (cdp !== null) {
    try {
      collectConsole(cdp.events);
      result.console = consoleLines;
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(evidenceDir, '08-desktop-failure.png'), Buffer.from(shot.data, 'base64'));
    } catch { /* best effort while reporting the primary failure */ }
  }
} finally {
  writeFileSync(join(evidenceDir, 'T3-cdp-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeFileSync(join(evidenceDir, '09-desktop-console.txt'), `${consoleLines.join('\n')}\n`, 'utf8');
  if (cdp !== null) cdp.close();
}

process.stdout.write(`${JSON.stringify({
  ok: result.ok,
  phase: result.phase,
  reason: result.reason,
  runId: result.run?.runIdText ?? null,
  sessionId: result.run?.sessionIdText ?? null,
  status: result.run?.status ?? null,
  statusText: result.run?.statusText ?? null,
  eventCount: result.run?.eventCount ?? null,
  toolEventCount: result.run?.toolEventCount ?? null,
  textEventCount: result.run?.textEventCount ?? null,
  errorCode: result.run?.errorCode ?? null,
  steps: result.steps,
}, null, 2)}\n`);
if (!result.ok) process.exit(1);
