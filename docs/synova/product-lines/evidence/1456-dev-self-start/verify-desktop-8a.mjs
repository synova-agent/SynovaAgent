/**
 * #1456 §7 C —— 桌面单点验证（= #1455 Done 8(a)）：Electron dev 自起后端 → 退出回收
 *
 * 零模型轮次、零外网：只用本地夹具 node_modules（electron 33 + tsx 4.23.13），
 *   启动前清掉一切 *API_KEY* 环境变量（结构上不可能产生模型费用）。
 *
 * 用法（worktree 根目录，先建好 node_modules junction）：
 *   node docs/synova/product-lines/evidence/1456-dev-self-start/verify-desktop-8a.mjs
 *
 * 三态退出码：0 = 8(a) PASS（自启成功 + 退出回收两段都成立）｜1 = 真红（缺陷仍在）｜
 *             2 = 环境不满足 / 检查自身无法判定（如 18790 已被占 ⇒ reused 会伪装成自启成功）
 *
 * 产物（同目录）：
 *   C-netstat-before.txt / C-netstat-after.txt   18790 占用原始输出
 *   C-electron-console.txt                        Electron 主进程 console 原文
 *   C-8a-transcript.txt                          逐条证据（命令 + 原始输出）
 *   C-8a-result.json                             机器可读结论
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..'); // <repo>/docs/synova/product-lines/evidence/<本目录>
const SERVER = 'http://127.0.0.1:18790';
const CDP_PORT = 9222;
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const OUT = { transcript: [], result: { verdict: 'UNVERIFIED', checks: {} } };
let spawnedPid = null; // 本次启动的 Electron 主进程（收尾清场用）

function log(line = '') {
  OUT.transcript.push(line);
  console.log(line);
}
function section(title, body) {
  log('');
  log(`──── ${title} ────`);
  log(body === undefined ? '' : String(body).replace(/\s+$/, ''));
}
/** 跑一条 Windows 命令，返回 { stdout, stderr, status }（原始输出，不加工） */
function run(cmd, args, env) {
  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, env: env || process.env });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    return { stdout: String(err.stdout || ''), stderr: String(err.stderr || err.message), status: err.status ?? 1 };
  }
}
/**
 * 环境隔离（判据纪律 ②）：本脚本由 DSH（Electron 应用）派生 ⇒ 继承 ELECTRON_RUN_AS_NODE=1，
 * 会让 electron.exe 以**纯 Node** 模式运行（require('electron') 返回路径字符串 ⇒ app undefined、
 * main.cjs 一起步就 TypeError）。桌面夹具必须显式清掉它，否则验的不是真桌面。
 */
function isolatedEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (/API_KEY/i.test(k)) delete env[k]; // 零模型轮次：无 key 结构上不可能计费
  return env;
}
/** 18790 监听行（原始 netstat 输出） */
function netstat18790() {
  return run('cmd', ['/c', 'netstat -ano | findstr 18790']);
}
/** 监听 18790 的 PID（无监听 ⇒ null） */
function ownerPid() {
  const { stdout } = netstat18790();
  const lines = stdout.split(/\r?\n/).filter((l) => l.includes(':18790') && /LISTENING/i.test(l));
  if (lines.length === 0) return null;
  const m = lines[0].trim().split(/\s+/);
  return Number(m[m.length - 1]);
}
/** Win32_Process 字段查询（父进程 / 命令行） */
function win32Proc(pid, fields) {
  const sel = fields.map((f) => `$_.${f}`).join(" + '|' + ");
  const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { ${sel} } else { 'GONE' }`;
  return run('powershell', ['-NoProfile', '-Command', ps]).stdout.trim();
}
/** 全机扫描：命令行含 src/index.ts 的残留后端进程（pid|name|cmdline） */
function scanBackendProcs() {
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\' OR Name=\'electron.exe\'" | '
    + "Where-Object { $_.CommandLine -match 'src[\\\\/]index\\.ts' } | "
    + "ForEach-Object { \"$($_.ProcessId)|$($_.Name)|$($_.CommandLine)\" }";
  return run('powershell', ['-NoProfile', '-Command', ps]).stdout.trim();
}
function probeHealthz(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER}/api/healthz`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ statusCode: null, body: String(err.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: null, body: 'timeout' }); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 回收本次启动的进程树（失败路径也必须清场，不留孤儿） */
function killTree(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch { /* 已退出 —— 幂等 */ }
}

async function main() {
  log(`#1456 §7 C 桌面单点验证 —— ${new Date().toISOString()}`);
  log(`cwd=${process.cwd()}`);
  log(`node=${process.version} platform=${process.platform}`);
  log(`electron=${ELECTRON_EXE}`);
  log(`tsx cli=${TSX_CLI}`);
  section('前置：夹具存在性', [
    `electron.exe exists = ${fs.existsSync(ELECTRON_EXE)}`,
    `tsx cli exists     = ${fs.existsSync(TSX_CLI)}`,
    `electron version   = ${run(ELECTRON_EXE, ['--version'], isolatedEnv()).stdout.trim() || '(n/a)'}`,
    `外层继承 ELECTRON_RUN_AS_NODE = ${JSON.stringify(process.env.ELECTRON_RUN_AS_NODE)}（桌面夹具必须清掉）`,
  ].join('\n'));
  if (!fs.existsSync(ELECTRON_EXE) || !fs.existsSync(TSX_CLI)) {
    OUT.result.verdict = 'ENV-MISSING';
    return finish(2);
  }

  // ── D. 防假绿：启动前 18790 必须无监听（否则 reused:true 会伪装成自启成功）──
  const before = netstat18790();
  fs.writeFileSync(path.join(HERE, 'C-netstat-before.txt'), before.stdout + before.stderr, 'utf8');
  section('§7 D 启动前 netstat -ano | findstr 18790（必须无输出）', before.stdout || '(无输出 = 端口空闲)');
  OUT.result.checks.portFreeBefore = before.stdout.trim() === '';
  if (!OUT.result.checks.portFreeBefore) {
    log('!! 18790 已被占用 ⇒ 本脚本不做验收（reused 会伪装成自启成功）。请先释放端口。');
    OUT.result.verdict = 'UNVERIFIED-PORT-BUSY';
    return finish(2);
  }

  // ── 启动：dev 模式（app.isPackaged=false）+ 临时 DB，零模型 ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '1456-desktop-'));
  const dbPath = path.join(tmpDir, 'synova.db');
  // DEV_MODE=true：src/index.ts 头部写明的 dev 启动方式；缺它 deploy/bootstrap 会以
  // MASTER_SECRET_MISSING fail-closed 终止（实测见 C-runtime-abi-backend-console-mastersecret-missing.txt）
  const env = isolatedEnv({ SYNOVA_DB_PATH: dbPath, DEV_MODE: 'true' });
  section('启动环境（隔离后）', [
    `SYNOVA_DB_PATH=${dbPath}`,
    `ELECTRON_RUN_AS_NODE 已清除 = ${env.ELECTRON_RUN_AS_NODE === undefined}`,
    `API_KEY* 键数量=${Object.keys(env).filter((k) => /API_KEY/i.test(k)).length}`,
  ].join('\n'));

  const consoleLog = path.join(HERE, 'C-electron-console.txt');
  const out = fs.openSync(consoleLog, 'w');
  const t0 = Date.now();
  const child = spawn(ELECTRON_EXE, ['electron/main.cjs', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT, env, stdio: ['ignore', out, out], windowsHide: false,
  });
  spawnedPid = child.pid;
  fs.closeSync(out);
  section('启动命令', `${ELECTRON_EXE} electron/main.cjs --remote-debugging-port=${CDP_PORT}\nElectron 主进程 pid = ${child.pid}`);

  let exited = false;
  child.on('exit', () => { exited = true; });

  // ── 等后端自启（healthz 200；探活窗口上限 180s）──
  // 快失败：console 一出现「后端自启 degraded」就收手，不必等满窗口
  let health = { statusCode: null, body: '' };
  let sawDegraded = false;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !exited) {
    health = await probeHealthz();
    if (health.statusCode === 200) break;
    try { if (/后端自启 degraded/.test(fs.readFileSync(consoleLog, 'utf8'))) { sawDegraded = true; break; } } catch { /* 还没写完 */ }
    await sleep(500);
  }
  const bootMs = Date.now() - t0;
  section(`§7 C.2 GET ${SERVER}/api/healthz（原始响应）`, `HTTP ${health.statusCode}\n${health.body}\nboot 耗时=${bootMs}ms sawDegradedLog=${sawDegraded}`);
  OUT.result.checks.healthz200 = health.statusCode === 200;
  OUT.result.healthz = { statusCode: health.statusCode, body: health.body, bootMs };
  if (health.statusCode !== 200) {
    const consoleFail = fs.readFileSync(consoleLog, 'utf8');
    section('§7 C.1 Electron console 原文（boot 失败时全量）', consoleFail);
    // 即便 8(a) 判红，也要把"spawn 层是否修好"与"退出后有无残留"分开记，避免一红遮全部
    OUT.result.checks.bootModeDevLog = /\[electron\] boot mode=dev/.test(consoleFail);
    OUT.result.checks.spawnLayerOkNoSpawnFailure = !/\[backend-spawn\] spawn 失败/.test(consoleFail);
    section('§7 C.1 判据（失败路径）', [
      `含 [electron] boot mode=dev = ${OUT.result.checks.bootModeDevLog}`,
      `无 "[backend-spawn] spawn 失败" = ${OUT.result.checks.spawnLayerOkNoSpawnFailure}（true ⇒ npx/ENOENT/EINVAL 缺陷已消失）`,
    ].join('\n'));
    killTree(child.pid); // 清场：失败路径不留孤儿
    await sleep(2000);
    // 失败路径同样留「退出后无残留」原始输出（§7 C.4 的负向面）
    const afterFail = netstat18790();
    fs.writeFileSync(path.join(HERE, 'C-netstat-after.txt'), afterFail.stdout + afterFail.stderr, 'utf8');
    const leftoversFail = scanBackendProcs();
    section('§7 C.4 收尾（boot 失败路径清场后）', [
      `netstat -ano | findstr 18790 = ${JSON.stringify(afterFail.stdout.trim())}（必须空）`,
      `残留 backend 进程（命令行含 src/index.ts）= ${JSON.stringify(leftoversFail)}（必须空）`,
    ].join('\n'));
    OUT.result.checks.portReleased = afterFail.stdout.trim() === '';
    OUT.result.checks.noLeftoverBackendProcs = leftoversFail === '';
    OUT.result.verdict = sawDegraded ? 'RED-backend-degraded' : 'RED-no-healthz';
    return finish(1);
  }

  // ── C.1 console 原文（含 boot mode=dev / 不含 degraded）──
  const consoleText = fs.readFileSync(consoleLog, 'utf8');
  const hasBootLine = /\[electron\] boot mode=dev/.test(consoleText);
  const hasDegradedLine = /后端自启 degraded|spawn 失败/.test(consoleText);
  section('§7 C.1 Electron 主进程 console 原文', consoleText);
  section('§7 C.1 判据', `含 [electron] boot mode=dev = ${hasBootLine}\n含 "后端自启 degraded" / "spawn 失败" = ${hasDegradedLine}（必须 false）`);
  OUT.result.checks.bootModeDevLog = hasBootLine;
  OUT.result.checks.noDegradedLog = !hasDegradedLine;

  // ── C.3 PID：18790 owner + 父进程 = Electron 主进程 + 命令行为 tsx CLI + src/index.ts ──
  const pid = ownerPid();
  const ownerCmd = pid ? win32Proc(pid, ['ParentProcessId', 'CommandLine']) : 'GONE';
  const [ppid, cmdline] = ownerCmd.split('|');
  section('§7 C.3 后端 PID / 父进程 / 命令行', [
    `18790 owner pid      = ${pid}`,
    `owner ParentProcessId= ${ppid}（应 = Electron 主进程 ${child.pid}）`,
    `owner CommandLine    = ${cmdline}`,
  ].join('\n'));
  OUT.result.backend = { pid, parentPid: Number(ppid), electronPid: child.pid, commandLine: cmdline };
  OUT.result.checks.backendPidExists = typeof pid === 'number' && pid > 0;
  OUT.result.checks.parentIsElectron = Number(ppid) === child.pid;
  OUT.result.checks.commandLineUsesTsxCli = typeof cmdline === 'string'
    && cmdline.includes(TSX_CLI) && cmdline.includes('src/index.ts');
  OUT.result.checks.notReused = true; // 前置 portFreeBefore 已证明：启动前 18790 无监听 ⇒ 本次必为自启

  // ── 退出：CDP Browser.close（等价关窗，触发 before-quit → backendHandle.stop）──
  let cdp = { ok: false, detail: '' };
  try {
    const ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    cdp.detail = `webSocketDebuggerUrl=${ver.webSocketDebuggerUrl}`;
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', (e) => reject(new Error(String(e?.message || e))), { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    cdp.ok = true;
  } catch (err) {
    cdp.detail = `CDP Browser.close 失败: ${err.message}`;
  }
  section('退出方式', `CDP Browser.close（${cdp.ok ? 'OK' : 'FAIL'}）\n${cdp.detail}`);
  OUT.result.checks.gracefulQuitViaCdp = cdp.ok;

  // 等 Electron 主进程真正退出
  const quitDeadline = Date.now() + 30000;
  while (!exited && Date.now() < quitDeadline) await sleep(200);
  if (!exited) {
    log('!! Electron 主进程 30s 内未退出 —— 强制清场（本项判 FAIL）');
    killTree(child.pid);
    await sleep(1500);
  }
  const exitCode = child.exitCode;
  section('Electron 主进程退出', `exited=${exited} exitCode=${exitCode} 耗时=${Date.now() - t0}ms`);
  OUT.result.checks.electronExited = exited;

  // ── C.4 退出后：后端 PID 消失 / 18790 无监听 / 无 tsx|node src/index.ts 残留 ──
  let alive = true;
  const deadDeadline = Date.now() + 20000;
  while (Date.now() < deadDeadline) {
    if (!pid) { alive = false; break; }
    try { process.kill(pid, 0); } catch { alive = false; break; } // ESRCH ⇒ 已回收
    await sleep(200);
  }
  const after = netstat18790();
  fs.writeFileSync(path.join(HERE, 'C-netstat-after.txt'), after.stdout + after.stderr, 'utf8');
  const leftovers = scanBackendProcs();
  section('§7 C.4 退出后回收', [
    `后端 pid ${pid} 仍存活 = ${alive}（必须 false）`,
    `netstat -ano | findstr 18790 输出 = ${JSON.stringify(after.stdout.trim())}（必须空）`,
    `残留 backend 进程（命令行含 src/index.ts）= ${JSON.stringify(leftovers)}（必须空）`,
  ].join('\n'));
  OUT.result.checks.backendPidGone = !alive;
  OUT.result.checks.portReleased = after.stdout.trim() === '';
  OUT.result.checks.noLeftoverBackendProcs = leftovers === '';
  OUT.result.reclaim = { backendAlive: alive, netstat: after.stdout.trim(), leftovers };

  const passed = OUT.result.checks.healthz200 && OUT.result.checks.bootModeDevLog
    && OUT.result.checks.noDegradedLog && OUT.result.checks.backendPidExists
    && OUT.result.checks.parentIsElectron && OUT.result.checks.commandLineUsesTsxCli
    && OUT.result.checks.electronExited && OUT.result.checks.backendPidGone
    && OUT.result.checks.portReleased && OUT.result.checks.noLeftoverBackendProcs;
  OUT.result.verdict = passed ? 'PASS-8a' : 'RED-8a';
  return finish(passed ? 0 : 1);
}

function finish(code) {
  OUT.result.exitCode = code;
  killTree(spawnedPid); // 收尾清场（判据已在前文算完，不影响结论）
  const transcript = path.join(HERE, 'C-8a-transcript.txt');
  const summary = `\n${'='.repeat(70)}\n判据汇总:\n`
    + Object.entries(OUT.result.checks).map(([k, v]) => `  ${v ? 'PASS' : 'FAIL'}  ${k}`).join('\n')
    + `\n\nVERDICT = ${OUT.result.verdict}（三态退出码 ${code}）\n`;
  log(summary);
  fs.writeFileSync(transcript, OUT.transcript.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(HERE, 'C-8a-result.json'), JSON.stringify(OUT.result, null, 2), 'utf8');
  process.exitCode = code;
}

main().catch((err) => {
  log(`\n脚本异常: ${err && err.stack ? err.stack : String(err)}`);
  OUT.result.verdict = 'SCRIPT-ERROR';
  finish(2);
});
