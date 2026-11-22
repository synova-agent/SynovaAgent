/**
 * electron/backend-spawn.cjs — D504 Electron 服务自启核心
 *
 * 职责: 探活后端 → 不可达则 spawn 拉起 → 探活轮询 → 重启限次 → 退出回收。
 * 纯 Node 模块（不 require('electron')）——可在 CI 无头环境直接单测。
 *
 * 契约（铁律 47，dev doc §3.5）:
 *   ensureBackend(options)
 *     @input  options: {
 *       serverUrl: string;                  // 探活目标（GET /api/healthz）
 *       cwd: string;                        // spawn 工作目录（亦为 #1456 tsx CLI 解析起点）
 *       mode: 'dev' | 'prod';               // dev: win32=本地 tsx CLI（ELECTRON_RUN_AS_NODE）/ POSIX=npx tsx；
 *                                           //      prod: 包内 Electron 以 node 模式跑 dist/backend.mjs（D518）
 *       dbPath?: string;                    // prod: 注入 SYNOVA_DB_PATH（userData 数据目录，L1-7）
 *       logFile?: string;                   // 后端 stdout/stderr 落盘
 *       maxRestarts?: number;               // 默认 3（10min 窗口语义——计数器+时间戳）
 *       command?: { bin, args, env?, error? }; // 测试注入覆盖默认命令；env 最后生效；error 非空 ⇒ 直接 degraded
 *       probeTimeoutMs?: number;            // 单轮探活窗口，默认 60000
 *       pollIntervalMs?: number;            // 探活轮询间隔，默认 1000
 *       graceMs?: number;                    // D522: SIGTERM→SIGKILL 升级窗口，默认 5000（可注入缩短供测试）
 *     }
 *     @output { started, pid?, reused?, degraded?, error?, stop }
 *       started=true  → 探活失败 → spawn → 探活成功
 *       reused=true   → 探活成功（已有服务在跑，不重复 spawn——端口冲突安全网）
 *       degraded=true → spawn 未启动（命令解析失败 / 同步抛 / error 事件 ⇒ 立即返回，不空转探活窗口）
 *                       或 spawn 后探活仍失败 / 重启超限（显式标记，铁律 24/31 不静默）
 *       stop()        → 进程树回收（D522: Win taskkill /T /F；POSIX kill(-pid) 进程组 + SIGTERM→graceMs→SIGKILL 升级；幂等）
 *     @error — 无（内部全捕获，返回对象；不抛）
 *
 * @state: real — D504 交付，main.cjs whenReady 集成；#1456 修复 Windows dev 自启（npx → 本地 tsx CLI）
 */

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

/** 单次探活: GET /api/healthz，statusCode 200 = 健康（healthz 200=healthy/degraded, 503=down） */
function probeOnce(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/healthz`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * 探活轮询: 窗口内每 pollIntervalMs 试一次。
 * #1456: 每轮前后检查 shouldAbort —— spawn 同步抛 / error 事件 ⇒ 立即收手，
 *        不再把 60s 窗口空转完（最坏多等一个 pollIntervalMs）。
 * @param {string} url 服务地址
 * @param {number} windowMs 探活窗口
 * @param {number} pollIntervalMs 轮询间隔
 * @param {() => boolean} [shouldAbort] 返回 true ⇒ 立即结束探活（已确定 spawn 失败）
 */
async function probeUntil(url, windowMs, pollIntervalMs, shouldAbort) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    if (shouldAbort && shouldAbort()) return false;
    if (await probeOnce(url, Math.min(5000, pollIntervalMs * 2))) return true;
    if (shouldAbort && shouldAbort()) return false;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}

/** tsx CLI 相对包根的路径（#1456: 与 node_modules/tsx/package.json 的 bin 一致，devDependency 固定版本） */
const TSX_CLI_REL = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');

/**
 * 解析本地 tsx CLI 入口（#1456）。
 * 背景（实测，DEV DOC §2.2）: Windows 上 `spawn('npx', …, {shell:false})` → ENOENT；
 *   `spawn('npx.cmd', …, {shell:false})` → 同步抛 EINVAL ⇒ 唯一稳的 shell-free 形态＝
 *   真 executable（Electron 以 node 模式跑）+ 真实 JS 入口文件（本地 tsx CLI）。
 * 契约:
 *   @input  ctx.cwd?    解析起点（缺省 process.cwd()；main.cjs dev 下传仓根）
 *           ctx.exists? 存在性探测（缺省 fs.existsSync；测试注入用于模拟 CLI 缺失）
 *   @output { cli, tried } — cli = 命中的绝对路径；cli=null 表示未找到（tried 为已尝试路径，供 actionable 报错）
 *   @degraded 不抛、不联网、不回退 npx —— 找不到由调用方转 degraded
 */
function resolveTsxCli(ctx = {}) {
  const exists = typeof ctx.exists === 'function' ? ctx.exists : fs.existsSync;
  const roots = [ctx.cwd || process.cwd(), path.resolve(__dirname, '..')];
  const tried = [];
  for (const root of roots) {
    if (!root) continue;
    const cli = path.resolve(root, TSX_CLI_REL);
    if (tried.includes(cli)) continue;
    tried.push(cli);
    if (exists(cli)) return { cli, tried };
  }
  return { cli: null, tried };
}

/**
 * 双模式默认命令（导出供测试直测）。
 * D518 prod 运行时修复（实测三重阻塞后的定案，runbook desktop-dev-prod.md §五）:
 *   ① dist/src/*.js 是 ESM 无扩展名 import——裸 node 直接 ERR_MODULE_NOT_FOUND（main 存量）
 *   ② 打包产物依赖在 app.asar 内，裸 node 的 node_modules 解析不可达
 *   ③ 原生模块（better-sqlite3/bcrypt）在产物内为 Electron ABI——任何外部 node 都 ABI 不匹配
 *   且 GA 机器无 Node 前提（北星 §二）。
 *   → prod = 包内 Electron 二进制以 node 模式跑 esbuild 单文件 bundle（dist/backend.mjs，
 *     externals 原生模块经 extraResources 落 resources/node_modules，ESM 向上解析可达 + ABI 一致）。
 * #1456 win32 dev:
 *   → bin = process.execPath（Electron 二进制）+ ELECTRON_RUN_AS_NODE=1 跑本地 tsx CLI（实测量过的形态），
 *     与 prod 同一 executable 前提（GA 机器无 Node 也一样成立）。
 *   契约:
 *     @input  mode: 'prod' | 'dev'
 *             ctx.cwd?       dev 下 tsx CLI 解析起点（缺省 process.cwd()）
 *             ctx.platform?  平台覆盖（缺省 process.platform；仅供测试在任意宿主验证两分支）
 *             ctx.exists?    存在性探测注入（见 resolveTsxCli）
 *     @output { bin, args, env?, error? }
 *       prod            → { bin: process.execPath, args: ['dist/backend.mjs'] }（逐字不变）
 *       win32 dev       → { bin: process.execPath, args: [<abs tsx cli.mjs>, 'src/index.ts'],
 *                           env: { ELECTRON_RUN_AS_NODE: '1' } }
 *       win32 dev 未解析到 CLI → { bin: '', args: [], error: '<可操作提示>' }（不回退 npx、不联网）
 *       POSIX dev       → { bin: 'npx', args: ['tsx', 'src/index.ts'] }（逐字不变）
 */
function buildCommand(mode, ctx = {}) {
  if (mode === 'prod') {
    return { bin: process.execPath, args: ['dist/backend.mjs'] };
  }
  const platform = ctx.platform || process.platform;
  if (platform === 'win32') {
    const { cli, tried } = resolveTsxCli(ctx);
    if (!cli) {
      return {
        bin: '',
        args: [],
        error: 'Windows dev 模式找不到本地 tsx CLI（' + TSX_CLI_REL + '）：请先在仓根执行 npm ci '
          + '安装依赖（已尝试: ' + tried.join(' | ') + '）；本命令不回退 npx、不联网取包',
      };
    }
    return { bin: process.execPath, args: [cli, 'src/index.ts'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { bin: 'npx', args: ['tsx', 'src/index.ts'] };
}

/**
 * Win 进程树终止（D522，借鉴 DSH taskkillProcessTree 范式自研，非 copy）。
 * 契约: taskkill /PID <pid> /T /F；pid≤0 no-op；taskkill 二进制缺失/非零状态 → log.warn + 继续（幂等，铁律 11/24）。
 * @param {number} pid 目标进程 pid
 * @param {(pid: number) => void} [taskkill] 可注入的 taskkill runner（测试用；缺省 spawnSync taskkill）
 */
function taskkillProcessTree(pid, taskkill) {
  if (!pid || pid <= 0) return;
  const run = taskkill || ((p) => {
    spawnSync('taskkill', ['/PID', String(p), '/T', '/F'], { stdio: 'ignore' });
  });
  try {
    run(pid);
  } catch (err) {
    console.warn(`[backend-spawn] taskkill 失败（幂等继续）: ${err.message}`);
  }
}

/**
 * 跨平台信号树（D522，借鉴 DSH signalTree 范式自研）。
 * 契约: win32 → taskkillProcessTree；POSIX → kill(-pid)（进程组，spawn detached 后子进程自建进程组）
 *        失败回退 child.kill(sig)；pid≤0 no-op；全程不抛（幂等）。
 * @param {string} platform 'win32' | 其他（POSIX）
 * @param {number} pid 目标 pid（POSIX 下即进程组 id——spawn detached 保证）
 * @param {string} sig NodeJS 信号名
 * @param {import('child_process').ChildProcess | null} child 回退 kill 用的 child 句柄
 * @param {(pid: number) => void} [taskkill] 可注入 taskkill runner（测试）
 */
function signalTree(platform, pid, sig, child, taskkill) {
  if (platform === 'win32') { taskkillProcessTree(pid, taskkill); return; }
  if (!pid || pid <= 0) return;
  try {
    process.kill(-pid, sig); // 进程组信号（覆盖孙进程）
  } catch {
    try { if (child) child.kill(sig); } catch { /* already gone — 幂等 */ }
  }
}

/**
 * teardown 构造器（D522，借鉴 DSH terminate 范式自研）。
 * 契约: 首次调用 signalTree(SIGTERM) → graceMs 后 signalTree(SIGKILL) 升级；定时器 unref 不阻塞退出；
 *        幂等（stopped/child.killed/pid≤0 短路，重复调用无副作用）。
 * @returns {() => void} stop 函数
 */
function makeStop(platform, pid, child, graceMs = 5000) {
  let stopped = false;
  return () => {
    if (stopped || (child && child.killed) || !pid || pid <= 0) return; // 幂等短路
    stopped = true;
    signalTree(platform, pid, 'SIGTERM', child);
    const t = setTimeout(() => signalTree(platform, pid, 'SIGKILL', child), graceMs);
    if (t.unref) t.unref(); // 不阻塞应用退出
  };
}

/** 日志流: 后端 stdout/stderr 追加写 logFile（degraded 可见，铁律 11/24） */
function attachLogStream(child, logFile) {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const stream = fs.createWriteStream(logFile, { flags: 'a' });
    stream.write(`\n===== backend spawn ${new Date().toISOString()} pid=${child.pid} =====\n`);
    child.stdout?.on('data', (d) => stream.write(d));
    child.stderr?.on('data', (d) => stream.write(d));
    child.on('exit', () => stream.end(`===== backend exit ${new Date().toISOString()} =====\n`));
  } catch (err) {
    console.warn(`[backend-spawn] 日志文件打开失败 — 降级为无日志: ${err.message}`);
  }
}

/**
 * 确保后端服务在跑（探活 → spawn → 限次重启）。
 * 契约见文件头 JSDoc；任何异常路径返回 degraded（不抛、不静默）。
 */
async function ensureBackend(options) {
  const {
    serverUrl,
    cwd,
    mode = 'dev',
    dbPath,
    logFile,
    maxRestarts = 3,
    command,
    probeTimeoutMs = 60000,
    pollIntervalMs = 1000,
    graceMs = 5000, // D522: SIGTERM→SIGKILL 升级窗口（可注入缩短供测试）
  } = options;

  // 1. 探活 — 已有健康服务 → reused（端口冲突安全网，不重复 spawn）
  if (await probeOnce(serverUrl)) {
    return { started: false, reused: true };
  }

  // 2. 命令解析（#1456: 解析失败 ⇒ 立即 degraded，不进入探活窗口、不回退 npx）
  const cmd = command || buildCommand(mode, { cwd });
  if (cmd.error) {
    // 解析失败 ≠ spawn 失败 —— 单独可见（铁律 11/24），error 原样透传（已含可操作提示）
    console.error(`[backend-spawn] 启动命令解析失败（degraded）: ${cmd.error}`);
    return { started: false, degraded: true, error: cmd.error };
  }

  // 3. env：{...process.env} ← prod 注入 ← cmd.env（#1456: cmd.env 最后生效）
  const env = { ...process.env };
  if (mode === 'prod') {
    // 包内 Electron 以 node 模式执行 backend.mjs（见 buildCommand 注释；GA 零 Node 前提）
    env.ELECTRON_RUN_AS_NODE = '1';
    if (dbPath) {
      env.SYNOVA_DB_PATH = dbPath; // src/config.ts:90 只读消费（Win 领地零改动）
    }
  }
  if (cmd.env) Object.assign(env, cmd.env);

  let child = null;
  let spawnError = null; // #1456: 同步抛 / error 事件 → 快失败标记（不再空转探活窗口）
  let lastError = null;
  const startedAt = Date.now();
  const restartWindowMs = 10 * 60 * 1000; // maxRestarts 语义: 10min 窗口内
  const restarts = [];

  /**
   * 记录 spawn 失败（#1456 快失败）：log 原文（§3.3 逐字 `[backend-spawn] spawn 失败: <code> <message>`）
   * + 供返回对象的 actionable error。置 spawnError 后探活循环立即收手。
   */
  const recordSpawnError = (err) => {
    const code = err && err.code ? String(err.code) : 'SPAWN_ERROR';
    const message = err && err.message ? String(err.message) : String(err);
    console.error(`[backend-spawn] spawn 失败: ${code} ${message}`);
    spawnError = `${code} ${message}（后端可执行文件无法启动: ${cmd.bin || '命令解析失败'}；mode=${mode}；`
      + '请确认 node_modules 已安装（npm ci）后重试）';
    return spawnError;
  };

  const spawnOnce = () => {
    // D518 修复: 无 logFile 时用 inherit 而非 pipe——pipe 无人读取会写满 64KB 缓冲导致子进程
    // 阻塞在 stdout 写、探活永不转健康（实测: dev 模式 spawn 后 60s 窗口 ×4 全超时，直跑 25s 即健康）。
    // inherit = 共享 Electron 进程 stdout（自动排空 + 后端日志直接可见=运行证据）。铁律 24: 不静默。
    const stdio = logFile ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'];
    // D522: POSIX 下 detached 让子进程自建进程组——kill(-pid) 可及孙进程（无孤儿）
    const c = spawn(cmd.bin, cmd.args, {
      cwd,
      env,
      stdio,
      detached: process.platform !== 'win32',
    });
    attachLogStream(c, logFile);
    c.on('error', (err) => {
      // #1456: 不再只记 lastError —— 置快失败标记，probeUntil 下一轮即收手
      recordSpawnError(err);
    });
    return c;
  };

  /**
   * 起子进程（#1456: 同步抛 → 立即降级，不再进入探活循环）。
   * Windows 实测: spawn('.cmd', …, {shell:false}) 同步抛 EINVAL（连 error 事件都到不了）。
   * @returns {boolean} true=已启动；false=已记录 spawnError
   */
  const startChild = () => {
    try {
      child = spawnOnce();
      return true;
    } catch (err) {
      recordSpawnError(err);
      return false;
    }
  };

  if (!startChild()) {
    console.error(`[backend-spawn] 后端自启降级 — spawn 未启动: ${spawnError}`);
    return { started: false, degraded: true, error: spawnError };
  }

  let attempt = 0;
  while (attempt < Math.max(1, maxRestarts) + 1) {
    const healthy = await probeUntil(serverUrl, probeTimeoutMs, pollIntervalMs, () => spawnError !== null);
    if (spawnError) {
      // #1456: spawn 本身失败 ⇒ 立即降级（不空转 60s×(maxRestarts+1) 探活窗口）
      console.error(`[backend-spawn] 后端自启降级 — spawn 未启动: ${spawnError}`);
      return { started: false, degraded: true, error: spawnError };
    }
    if (healthy) {
      // D522: stop = signalTree(SIGTERM) → graceMs → SIGKILL 升级（幂等，进程组回收）
      const stop = makeStop(process.platform, child.pid, child, graceMs);
      return { started: true, pid: child.pid, stop, child };
    }
    // 探活失败 — 记录重启（窗口外重置计数）
    const now = Date.now();
    restarts.push(now);
    while (restarts.length > 0 && now - restarts[0] > restartWindowMs) restarts.shift();
    lastError = lastError || `后端探活在 ${probeTimeoutMs}ms 内未转健康（mode=${mode}）`;
    attempt += 1;
    if (restarts.length > maxRestarts || attempt > maxRestarts + 1 || child.exitCode !== null) {
      // 超限 / 子进程已死且不可再拉 — degraded 显式（铁律 24/31：不静默）
      console.error(`[backend-spawn] 后端自启降级 — 重启 ${restarts.length} 次未恢复: ${lastError}`);
      makeStop(process.platform, child.pid, child, graceMs)(); // D522: degraded 清理统一走进程树回收
      return { started: false, degraded: true, error: lastError };
    }
    // #1456: 重启时同样可能同步抛 —— 走同一快失败出口
    if (!startChild()) {
      console.error(`[backend-spawn] 后端自启降级 — spawn 未启动: ${spawnError}`);
      return { started: false, degraded: true, error: spawnError };
    }
  }

  return { started: false, degraded: true, error: lastError || 'unreachable' };
}

module.exports = { ensureBackend, buildCommand, probeOnce, signalTree, taskkillProcessTree, makeStop };
