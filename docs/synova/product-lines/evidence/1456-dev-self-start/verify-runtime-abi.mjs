/**
 * #1456 §7 C 附加：运行时 ABI 控制实验 —— 证明「后端起不来」的唯一阻断点是 executable 的 ABI
 *
 * 目的（DEV DOC §8「技术事实变化可修正实现但必须留原始证据」）：
 *   A. electron.exe + ELECTRON_RUN_AS_NODE=1 + tsx CLI → 能跑 JS，但**加载不了 dev node_modules 的
 *      better-sqlite3**（NODE_MODULE_VERSION 137 = 系统 Node 24；Electron 33 的 node 要 130）
 *   B. 系统 node.exe + 同一 tsx CLI → better-sqlite3 正常加载
 *   C. 系统 node.exe + 同一 tsx CLI + src/index.ts → 真实后端起来，healthz 200，kill 后回收干净
 *
 * 为什么这是"控制实验"而不是 8(a) 通过：8(a) 的入口是 `electron electron/main.cjs`（DEV DOC §1），
 *   本脚本 C 段是**手动起后端**，不是 Electron 自启 ⇒ 只能证明 argv/env/探活/回收那部分是对的。
 *
 * 三态退出码：0 = 结论成立（A 失败 + B/C 成功 = ABI 唯一阻断点）｜1 = 结论不成立｜2 = 环境不满足
 * 产物：C-runtime-abi-transcript.txt / C-runtime-abi-result.json
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SERVER = 'http://127.0.0.1:18790';
const OUT = { transcript: [], result: { verdict: 'UNVERIFIED', steps: {} } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(x = '') { OUT.transcript.push(x); console.log(x); }
function section(t, b) { log(''); log(`──── ${t} ────`); log(b === undefined ? '' : String(b).replace(/\s+$/, '')); }
function isolatedEnv(extra = {}) {
  const base = { ...process.env };
  delete base.ELECTRON_RUN_AS_NODE; // 先清继承（见 verify-desktop-8a.mjs 同名说明），再叠加显式 extra
  for (const k of Object.keys(base)) if (/API_KEY/i.test(k)) delete base[k];
  return { ...base, ...extra };
}
function run(cmd, args, env) {
  try {
    return { stdout: execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, env: env || isolatedEnv(), timeout: 180000 }), stderr: '', status: 0 };
  } catch (err) {
    return { stdout: String(err.stdout || ''), stderr: String(err.stderr || err.message), status: err.status ?? 1 };
  }
}
function netstat() { return run('cmd', ['/c', 'netstat -ano | findstr 18790']).stdout; }
function probeHealthz(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER}/api/healthz`, { timeout: timeoutMs }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ statusCode: null, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: null, body: 'timeout' }); });
  });
}
function killTree(pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* 幂等 */ } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '1456-abi-'));
const PROBE = path.join(tmp, 'sqlite-probe.mjs');
// 探针把结论写文件（不依赖 stdout —— electron.exe 是 GUI 子系统二进制，redirect 后实测零输出）
fs.writeFileSync(PROBE, [
  "import fs from 'node:fs';",
  "import { createRequire } from 'node:module';",
  "const out = process.argv[2];",
  `const require = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});`,
  "const rec = { node: process.version, electron: process.versions.electron || null, modules: process.versions.modules, sqlite: null, error: null };",
  "try { const D = require('better-sqlite3'); const db = new D(':memory:'); db.exec('create table t(x)'); rec.sqlite = 'OK'; db.close(); }",
  "catch (err) { rec.sqlite = 'FAIL'; rec.error = (err.code || '') + ' :: ' + String(err.message).split('\\n')[0]; }",
  "fs.writeFileSync(out, JSON.stringify(rec, null, 2));",
  "console.log('PROBE ' + JSON.stringify(rec));",
].join('\n'), 'utf8');

async function runProbe(label, bin, args, extraEnv = {}) {
  const outFile = path.join(tmp, `probe-result-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  // 注意：electron.exe 以 launch 进程返回后 node 模式进程可能仍在跑（实测 execFileSync 早退、结果文件晚到）
  //   ⇒ 轮询结果文件而不是只看退出码。
  // stdio ?? inherit?Electron(GUI ???) ? stdio ? null ????? exit 0 ??????? console ??????
  const child = spawn(bin, [...args, outFile], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: isolatedEnv(extraEnv) });
  let rec = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { rec = JSON.parse(fs.readFileSync(outFile, 'utf8')); break; } catch { /* 结果还没写 */ }
    await sleep(200);
  }
  if (child.exitCode === null) killTree(child.pid); // 幂等清场
  section(label, rec
    ? `${JSON.stringify(rec, null, 2)}\n(exitCode=${child.exitCode})`
    : `(探针未产出结果) exitCode=${child.exitCode}`);
  return { ok: !!rec && rec.sqlite === 'OK', record: rec };
}

async function main() {
  log(`#1456 运行时 ABI 控制实验 —— ${new Date().toISOString()}`);
  log(`node=${process.version} platform=${process.platform}`);
  section('夹具', `electron=${ELECTRON_EXE}\ntsx=${TSX_CLI}\nprobe=${PROBE}`);
  if (!fs.existsSync(ELECTRON_EXE) || !fs.existsSync(TSX_CLI)) { OUT.result.verdict = 'ENV-MISSING'; return finish(2); }

  // A. electron-as-node（DEV DOC §2.2 form D 的形态）→ 加载 better-sqlite3
  const a = await runProbe('A. electron.exe + ELECTRON_RUN_AS_NODE=1 + tsx CLI → 探针',
    ELECTRON_EXE, [TSX_CLI, PROBE], { ELECTRON_RUN_AS_NODE: '1' });
  OUT.result.steps.electronAsNodeLoadsSqlite = a.ok;

  // B. 系统 node（DEV DOC §2.2 form C 的形态）→ 同一探针
  const b = await runProbe('B. 系统 node.exe + 同一 tsx CLI → 探针',
    process.execPath, [TSX_CLI, PROBE]);
  OUT.result.steps.systemNodeLoadsSqlite = b.ok;

  if (netstat().trim() !== '') {
    section('前置失败', '18790 已被占用 ⇒ C 段不做'); OUT.result.verdict = 'UNVERIFIED-PORT-BUSY'; return finish(2);
  }

  // C. 系统 node.exe 跑真实后端（同一 argv 形状 + 临时 DB + 零模型）
  // 注：DEV_MODE=true 是 src/index.ts 头部写明的 dev 启动方式（否则 deploy/bootstrap 以
  //     MASTER_SECRET_MISSING fail-closed 终止 —— 见 A/B/C 首次运行的 C-runtime-abi-backend-console 记录）。
  const dbPath = path.join(tmp, 'synova.db');
  const env = isolatedEnv({ SYNOVA_DB_PATH: dbPath, DEV_MODE: 'true' });
  const consoleFile = path.join(HERE, 'C-runtime-abi-backend-console.txt');
  const fd = fs.openSync(consoleFile, 'w');
  const t0 = Date.now();
  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], { cwd: ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  spawnedPid = child.pid;
  section('C. 启动命令（= buildCommand win32 dev 的 argv/env 形状，但 bin 用系统 node）',
    `${process.execPath} ${TSX_CLI} src/index.ts\ncwd=${ROOT}\nSYNOVA_DB_PATH=${dbPath}\npid=${child.pid}`);
  let exited = false;
  child.on('exit', () => { exited = true; });
  let health = { statusCode: null, body: '' };
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !exited) {
    health = await probeHealthz();
    if (health.statusCode === 200) break;
    await sleep(500);
  }
  const bootMs = Date.now() - t0;
  section(`C.2 GET ${SERVER}/api/healthz`, `HTTP ${health.statusCode}\n${health.body}\nboot=${bootMs}ms`);
  OUT.result.steps.systemNodeBackendHealthy = health.statusCode === 200;
  OUT.result.healthz = { statusCode: health.statusCode, body: health.body, bootMs };
  OUT.result.backend = { pid: child.pid, bin: process.execPath };

  // C.4 回收
  killTree(child.pid);
  let alive = true;
  const dd = Date.now() + 20000;
  while (Date.now() < dd) {
    try { process.kill(child.pid, 0); } catch { alive = false; break; }
    await sleep(200);
  }
  const after = netstat().trim();
  const leftovers = run('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -match \'src[\\\\/]index\\.ts\' } | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }']).stdout.trim();
  section('C.4 回收（kill 后）', `后端 pid 仍存活=${alive}（必须 false）\nnetstat 18790=${JSON.stringify(after)}（必须空）\n残留=${JSON.stringify(leftovers)}（必须空）`);
  OUT.result.steps.reclaimed = !alive && after === '' && leftovers === '';
  OUT.result.consoleTail = fs.existsSync(consoleFile) ? fs.readFileSync(consoleFile, 'utf8').split(/\r?\n/).slice(-6).join('\n') : '';

  const verdictOk = !a.ok && b.ok && health.statusCode === 200 && OUT.result.steps.reclaimed;
  OUT.result.verdict = verdictOk ? 'ABI-IS-THE-ONLY-BLOCKER' : 'INCONCLUSIVE';
  return finish(verdictOk ? 0 : 1);
}

let spawnedPid = null;
function finish(code) {
  OUT.result.exitCode = code;
  killTree(spawnedPid);
  const summary = `\n${'='.repeat(70)}\n结论:\n`
    + Object.entries(OUT.result.steps).map(([k, v]) => `  ${v ? 'YES' : 'NO'}  ${k}`).join('\n')
    + `\n\nVERDICT = ${OUT.result.verdict}（三态退出码 ${code}）\n`;
  log(summary);
  fs.writeFileSync(path.join(HERE, 'C-runtime-abi-transcript.txt'), OUT.transcript.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(HERE, 'C-runtime-abi-result.json'), JSON.stringify(OUT.result, null, 2), 'utf8');
  process.exitCode = code;
}

main().catch((err) => { log(`脚本异常: ${err && err.stack ? err.stack : String(err)}`); OUT.result.verdict = 'SCRIPT-ERROR'; finish(2); });
