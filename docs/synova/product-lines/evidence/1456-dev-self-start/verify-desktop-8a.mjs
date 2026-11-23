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
/** 沿 ParentProcessId 向上取进程链（最多 maxDepth 级）—— tsx CLI 会再 exec 一层 node，
 *  真正的后端（18790 owner）不是 Electron 的直接子进程，所以必须看"链"而不是"父母"。 */
function parentChain(pid, maxDepth = 6) {
  const chain = [];
  let cur = pid;
  for (let i = 0; i < maxDepth && cur && cur > 0; i += 1) {
    const raw = win32Proc(cur, ['Name', 'ParentProcessId']);
    if (!raw || raw === 'GONE') break;
    const [name, parentPid] = raw.split('|');
    chain.push({ pid: cur, name, parentPid: Number(parentPid) });
    cur = Number(parentPid);
  }
  return chain;
}
/** 监听 18790 的 PID（无监听 ⇒ null）。
 *  注意：必须看**本地地址列**并且只认 LISTENING —— 健康探活打出去的长连接会在
 *  `netstat` 里留 `[::1]:<随机端口> → [::1]:18790 TIME_WAIT` 这类行，那不是服务在跑。 */
function listeningPidOn18790() {
  const { stdout } = netstat18790();
  for (const line of stdout.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    // f = [proto, local, remote, state, pid]
    if (f.length >= 5 && f[1].endsWith(':18790') && /LISTENING/i.test(f[3])) return Number(f[4]);
  }
  return null;
}
/** 18790 上所有非 LISTENING 的残留行（TIME_WAIT 等，留证不隐藏） */
function nonListeningLines18790() {
  return netstat18790().stdout.split(/\r?\n/)
    .filter((l) => l.includes(':18790') && !/LISTENING/i.test(l))
    .map((l) => l.trim()).filter(Boolean);
}
/** Win32_Process 字段查询（父进程 / 命令行）。注意用 $p.<field>（$_ 只在管道上下文里绑定） */
function win32Proc(pid, fields) {
  const sel = fields.map((f) => `$p.${f}`).join(" + '|' + ");
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
  const preListening = listeningPidOn18790();
  const preNonListening = nonListeningLines18790();
  section('§7 D 启动前 netstat -ano | findstr 18790（必须无监听）', [
    before.stdout.trim() === '' ? '(findstr 原始输出为空)' : before.stdout.trim(),
    `LISTENING pid = ${preListening}（必须 null）`,
    `非 LISTENING 行（TIME_WAIT 等，不构成服务在跑）= ${JSON.stringify(preNonListening)}`,
  ].join('\n'));
  OUT.result.prePort = { raw: before.stdout.trim(), listeningPid: preListening, nonListening: preNonListening };
  OUT.result.checks.portFreeBefore = preListening === null;
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
  const env = isolatedEnv({ SYNOVA_DB_PATH: dbPath, DEV_MODE: 'true', SYNOVA_ORG_ID: 'org-1456-verify' });
  section('启动环境（隔离后）', [
    `SYNOVA_DB_PATH=${dbPath}`,
    `DEV_MODE=${env.DEV_MODE}`,
    `SYNOVA_ORG_ID=${env.SYNOVA_ORG_ID}`,
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
    const failListening = listeningPidOn18790();
    section('§7 C.4 收尾（boot 失败路径清场后）', [
      `netstat 18790 LISTENING pid = ${failListening}（必须 null）`,
      `netstat 原始 = ${JSON.stringify(afterFail.stdout.trim())}`,
      `残留 backend 进程（命令行含 src/index.ts）= ${JSON.stringify(leftoversFail)}（必须空）`,
    ].join('\n'));
    OUT.result.checks.portReleased = failListening === null;
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

  // ── C.3 PID：18790 owner + 进程链回到 Electron 主进程 + runtime = 系统 node + 命令行含 tsx 与 src/index.ts ──
  const pid = listeningPidOn18790();
  const chain = pid ? parentChain(pid) : [];
  const [procName, ppid, cmdline] = pid ? win32Proc(pid, ['Name', 'ParentProcessId', 'CommandLine']).split('|') : ['', '', ''];
  const chainText = chain.map((n, i) => `${'  '.repeat(i)}${i === 0 ? '' : '└─ '}${n.pid} ${n.name}（父 ${n.parentPid}）`).join('\n');
  section('§7 C.3 后端 PID / 进程链 / runtime / 命令行', [
    `18790 owner pid      = ${pid}（Name=${procName}）`,
    `进程链（自 owner 向上）:\n${chainText}`,
    `Electron 主进程 pid  = ${child.pid}`,
    `owner CommandLine    = ${cmdline}`,
    '',
    '注: tsx CLI 会再 exec 一层 node ⇒ 真正的后端是 Electron 的**孙进程**（链上能看到），',
    '    所以判据是"链回到 Electron"，不是"直接父子"。',
  ].join('\n'));
  OUT.result.backend = {
    pid, processName: procName, parentPid: Number(ppid), electronPid: child.pid, commandLine: cmdline, chain,
  };
  OUT.result.checks.backendPidExists = typeof pid === 'number' && pid > 0;
  OUT.result.checks.parentChainReachesElectron = chain.some((n) => n.pid === child.pid);
  // tsx 两种形态都要认：直接 `node <cli.mjs> src/index.ts`，或 tsx 再 exec 的 loader 形态
  OUT.result.checks.commandLineUsesTsxRuntime = typeof cmdline === 'string'
    && /tsx[\\/]/.test(cmdline) && cmdline.includes('src/index.ts');
  // CTO 裁定 1：dev runtime 必须是系统 node（不是 electron.exe / 不是 Electron-as-node）
  OUT.result.checks.backendRuntimeIsNodeExe = /^node(\.exe)?$/i.test(String(procName));
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
  const postListening = listeningPidOn18790();
  const postNonListening = nonListeningLines18790();
  section('§7 C.4 退出后回收', [
    `后端 pid ${pid} 仍存活 = ${alive}（必须 false）`,
    `netstat 18790 LISTENING pid = ${postListening}（必须 null = 端口已释放）`,
    `netstat 非 LISTENING 残留行 = ${JSON.stringify(postNonListening)}（TIME_WAIT 属已断开连接，不是监听）`,
    `残留 backend 进程（命令行含 src/index.ts）= ${JSON.stringify(leftovers)}（必须空）`,
  ].join('\n'));
  OUT.result.checks.backendPidGone = !alive;
  OUT.result.checks.portReleased = postListening === null;
  OUT.result.checks.noLeftoverBackendProcs = leftovers === '';
  OUT.result.reclaim = {
    backendAlive: alive,
    netstatRaw: after.stdout.trim(),
    listeningPid: postListening,
    nonListening: postNonListening,
    leftovers,
  };

  const passed = OUT.result.checks.healthz200 && OUT.result.checks.bootModeDevLog
    && OUT.result.checks.noDegradedLog && OUT.result.checks.backendPidExists
    && OUT.result.checks.parentChainReachesElectron && OUT.result.checks.commandLineUsesTsxRuntime
    && OUT.result.checks.backendRuntimeIsNodeExe
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
