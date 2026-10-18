#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-bundle-content.ts — M6b：bundle 形态「内容面」判据件（probe）
 *
 * @why 同 SHA 只换形态，dev（tsx）与 bundle（dist/backend.mjs，客户正式形态）读同一个
 *      GET /api/sentinel/health 的 .summary.total 与装载日志 —— 让「bundle 形态下内容面
 *      是否装得上」成为可独立跑红的判据。背景（CTO 裁定 161／162-D）：dev 形态文件驱动
 *      哨兵装载成功、bundle 形态装载失败 41 —— 但全仓此前不存在「bundle 形态真跑一次并数哨兵」
 *      的判据（哨兵测试走 vitest＝dev 规则；desktop-build 测试只断言文件存在）。
 *
 * 口径（CTO 2026-10-17 放行修正，三条）：
 *   ① 主判据：registered === E 且 errors === 0 为硬判；total >= E 为软判；
 *      不判 total === E —— dev 的 total 含 builtin（dev > E 是正常态），bundle 现 builtin=0，
 *      total==E 只是"恰好"；将来 builtin 修好会让原判据反红 ⇒ 判据不能阻止未来修复。
 *      探针另行打印 total 与 builtin 差（total − registered），单独记录。
 *   ② builtin 面单列：builtins.ts 按 import.meta.url 推 adapters/ ⇒ bundle 下 builtin=0，
 *      独立于内容面缺陷；C4 只修 extensions/ ⇒ 修好后 bundle.total = E+0 vs dev = E+4，
 *      两形态仍差 4 ⇒ M6b 只判内容面；builtin 面另立（本探针只打印差值，不判）。
 *   ③ 证据边界：当前红态下反例只能演示「已装载的那几个」−1（弱证明）；重建耗时与
 *      dist/backend.mjs 哈希、两形态实际端口必须打印。
 *
 * @契约（铁律 47）
 *   @input  无参。可选：--counterexample（判别力自检：临时移走一个已装载哨兵目录 ⇒ 计数 −1）
 *           --rebuild（强制重建 bundle）／--no-build（禁止重建；缺失/过期 ⇒ exit 2）
 *           --dev-timeout-ms=<n>／--bundle-timeout-ms=<n>
 *           仓库根 = SYNOVA_REPO_ROOT 或 cwd 逐级上溯（须含 src/index.ts ＋ synova.json ＋ extensions/sentinels/）。
 *   @output  stdout 证据行（DERIVED／DEV／BUNDLE／JUDGE／BUILTIN-GAP／COUNTEREXAMPLE／RESULT）
 *            ＋ .synova-out/m6b/ 下原始日志（每个形态一份）与 build 日志。
 *   @exit    三态（控制塔判据件口径）：
 *              0 = 判据全绿（hard 两条 ＋ soft 一条；或反例模式证明 −1）
 *              1 = 真红（测得数与判据不符 —— 当前 bundle 形态应为 1）
 *              2 = 探针自身判不了（看不到 / 解析不了 / 定标不一致 / E==0 / 反例不成立 / 环境失败）
 *   @degraded 无独立降级路径：一切"看不见"归 exit 2 ＋ 点名原始原因（禁把"看不见"当"没问题"）。
 *
 * 期望值 E 一律由目录集派生（裁定 150③ 教训：不许写死）：extensions/sentinels/ 顶层目录，
 *   排除 shared 与 _ 前缀（_extinct 属之），且每目录须有可解析 manifest.json。
 *   本文件不含任何期望值的硬编码字面量。
 *
 * 口径边界（防伪）：/api/sentinel/reports 恒空无判别力（dev/bundle 同为 ok:true 空数组），
 *   本探针不用它；HTTP 200 本身不是判据。
 *
 * 写集说明：M6b 写集仅本文件（＋卡面 brief）；src/**、extensions/**、package.json、
 *   build-backend.sh 一律不改；本探针不接 CI（接入时机 = P0 修法合并之后，CTO 裁 162-D）。
 *   --counterexample 的运行期临时移目录：worktree 私有 .synova-out/m6b/moved/，finally 必恢复
 *   ＋ 核 manifest 哈希；不提交任何文件。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { dirname, join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════
// 常量与类型
// ═══════════════════════════════════════════════════════════════════

/** 三态退出码（具名常量，禁在调用点写裸字面量） */
const EXIT_OK = 0;
const EXIT_RED = 1;
const EXIT_UNJUDGEABLE = 2;

const PROBE = '[M6b]';
const NL = '\n';

/** 探针证据目录（.gitignore 已忽略 .synova-out/；不进提交） */
const EVIDENCE_REL = join('.synova-out', 'm6b');

type FormName = 'dev' | 'bundle';
const FORM_DEV: FormName = 'dev';
const FORM_BUNDLE: FormName = 'bundle';

interface ProbeOptions {
  counterexample: boolean;
  rebuild: boolean;
  noBuild: boolean;
  devTimeoutMs: number;
  bundleTimeoutMs: number;
  help: boolean;
}

interface Derived {
  expected: number;
  sentinelsDir: string;
  dirs: string[];
  excluded: string[];
  nameToDir: Map<string, string>;
}

interface BuildInfo {
  path: string;
  sizeBytes: number;
  sha256: string;
  rebuilt: boolean;
  buildMs: number | null;
}

interface FormRun {
  form: FormName;
  port: number;
  readyMs: number;
  total: number;
  sentinelIds: string[];
  scanCount: number;
  scanErrors: number;
  registered: number;
  regErrors: number;
  importFailureLines: number;
  builtinUnavailable: boolean;
  logPath: string;
}

interface HealthShape {
  total: number;
  ids: string[];
}

interface LoaderLog {
  scanCount: number | null;
  scanErrors: number | null;
  registered: number | null;
  regErrors: number | null;
  importFailureLines: number;
  builtinUnavailable: boolean;
}

interface FormHandle {
  child: ChildProcess;
  form: FormName;
  port: number;
  logPath: string;
  text(): string;
  exited(): { code: number | null; signal: NodeJS.Signals | null } | null;
}

/** 判不了（exit 2）的具名原因 —— 必须点名，禁笼统失败 */
class Unjudgeable extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'Unjudgeable';
  }
}

// ═══════════════════════════════════════════════════════════════════
// 运行期状态（供信号处理/异常路径清理）
// ═══════════════════════════════════════════════════════════════════

const activeChildren = new Set<ChildProcess>();
let movedDir: { from: string; to: string; manifestSha256: string } | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ═══════════════════════════════════════════════════════════════════
// 仓库定位 / git 同 SHA 前提
// ═══════════════════════════════════════════════════════════════════

function lookLikeRepoRoot(dir: string): boolean {
  return (
    existsSync(join(dir, 'src', 'index.ts')) &&
    existsSync(join(dir, 'synova.json')) &&
    existsSync(join(dir, 'extensions', 'sentinels'))
  );
}

function locateRepoRoot(): string {
  const envRoot = process.env.SYNOVA_REPO_ROOT;
  if (envRoot !== undefined && envRoot.length > 0 && lookLikeRepoRoot(envRoot)) {
    return envRoot;
  }
  let cur = process.cwd();
  for (let depth = 0; depth < 12; depth += 1) {
    if (lookLikeRepoRoot(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Unjudgeable(
    'repo-root-not-found',
    '无法定位仓库根（已试 SYNOVA_REPO_ROOT 与 cwd 上溯 12 层）：须含 src/index.ts ＋ synova.json ＋ extensions/sentinels/',
  );
}

function gitHead(root: string): string {
  const res = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Unjudgeable(
      'git-unavailable',
      'git rev-parse HEAD 失败（status=' + String(res.status) + '）：' + String(res.stderr).trim(),
    );
  }
  const sha = String(res.stdout).trim();
  if (sha.length === 0) throw new Unjudgeable('git-unavailable', 'git rev-parse HEAD 输出为空');
  return sha;
}

/** 跟踪文件未提交改动（-uno：untracked 不算）—— 非空 ⇒「同 SHA」前提不成立 */
function gitTrackedDirty(root: string): string[] {
  const res = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Unjudgeable(
      'git-unavailable',
      'git status 失败（status=' + String(res.status) + '）：' + String(res.stderr).trim(),
    );
  }
  return String(res.stdout)
    .split(NL)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

// ═══════════════════════════════════════════════════════════════════
// 期望值派生（E）：目录集，排除 shared / _ 前缀，manifest 必须可解析
// ═══════════════════════════════════════════════════════════════════

function deriveExpected(root: string): Derived {
  const sentinelsDir = join(root, 'extensions', 'sentinels');
  const entries = readdirSync(sentinelsDir, { withFileTypes: true });
  const dirs: string[] = [];
  const excluded: string[] = [];
  const nameToDir = new Map<string, string>();
  const problems: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'shared' || entry.name.startsWith('_')) {
      excluded.push(entry.name);
      continue;
    }
    const manifestPath = join(sentinelsDir, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) {
      problems.push(entry.name + '（缺 manifest.json）');
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      problems.push(entry.name + '（manifest.json 解析失败：' + errorText(err) + '）');
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.name !== 'string' || parsed.name.length === 0) {
      problems.push(entry.name + '（manifest.name 非非空字符串）');
      continue;
    }
    const name = parsed.name;
    const existing = nameToDir.get(name);
    if (existing !== undefined) {
      problems.push(entry.name + '（manifest.name 与已有目录重复：' + name + ' ← ' + existing + '）');
      continue;
    }
    nameToDir.set(name, entry.name);
    dirs.push(entry.name);
  }

  if (problems.length > 0) {
    throw new Unjudgeable(
      'derivation-mismatch',
      ['目录集派生与装载器口径不一致（禁静默二选一）——以下目录无法计入：', ...problems.map((p) => '  ' + p)].join(NL),
    );
  }
  if (dirs.length === 0) {
    throw new Unjudgeable(
      'zero-signal',
      'extensions/sentinels/ 下可计入的哨兵目录为 0 ⇒ 判据无对象（信号量==0 不得当通过）',
    );
  }
  dirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  excluded.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { expected: dirs.length, sentinelsDir, dirs, excluded, nameToDir };
}

// ═══════════════════════════════════════════════════════════════════
// 端口 / 子进程环境 / bundle 产物（同 SHA 保证）
// ═══════════════════════════════════════════════════════════════════

function readConfiguredPort(root: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, 'synova.json'), 'utf8'));
  } catch (err) {
    throw new Unjudgeable('config-unreadable', 'synova.json 读取/解析失败：' + errorText(err));
  }
  if (!isRecord(parsed) || !isRecord(parsed.server)) {
    throw new Unjudgeable('config-unreadable', 'synova.json 缺 server 段 ⇒ 端口基准取不到');
  }
  const port = numberOrNull(parsed.server.port);
  if (port === null || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Unjudgeable('config-unreadable', 'synova.json server.port 非法：' + String(parsed.server.port));
  }
  return port;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createTcpServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(startAt: number): Promise<number> {
  for (let offset = 0; offset < 40; offset += 1) {
    const port = startAt + offset;
    if (port > 65535) break;
    if (await isPortFree(port)) return port;
  }
  throw new Unjudgeable('no-free-port', '从 ' + String(startAt) + ' 起 40 个端口均被占用 ⇒ 无法起服务（环境失败）');
}

function childEnv(root: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const nodeDir = dirname(process.execPath);
  const sep = process.platform === 'win32' ? ';' : ':';
  const basePath = process.env.PATH ?? '';
  const mergedPath = basePath.length > 0 ? nodeDir + sep + basePath : nodeDir;
  return {
    ...process.env,
    PATH: mergedPath,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    SYNOVA_REPO_ROOT: root,
    ...extra,
  };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walkNewestMtime(dir: string): number {
  let newest = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, walkNewestMtime(full));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

/** bundle 产物依赖面 = src/** + packages/** + 构建脚本/配置；extensions/** 是运行期内容面，不进产物 */
function newestBundleInputMtime(root: string): number {
  let newest = 0;
  for (const sub of ['src', 'packages']) {
    const dir = join(root, sub);
    if (existsSync(dir)) newest = Math.max(newest, walkNewestMtime(dir));
  }
  for (const file of ['build-backend.sh', 'tsconfig.json', 'package.json']) {
    const path = join(root, file);
    if (existsSync(path)) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

interface CommandResult {
  code: number | null;
  timedOut: boolean;
  output: string;
}

function runCommandCapture(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: string[] = [];
    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (err) {
        chunks.push('（超时杀进程失败：' + errorText(err) + '）');
      }
      finish({ code: null, timedOut: true, output: chunks.join('') });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString('utf8'));
    });
    child.once('exit', (code) => {
      finish({ code, timedOut: false, output: chunks.join('') });
    });
    child.once('error', (err) => {
      chunks.push('（spawn 失败：' + err.message + '）');
      finish({ code: null, timedOut: false, output: chunks.join('') });
    });
  });
}

function textTail(text: string, lines: number): string {
  const all = text.split(NL).filter((line) => line.trim().length > 0);
  return all.slice(-lines).join(NL);
}

async function ensureBundle(root: string, opts: ProbeOptions, evidenceDir: string): Promise<BuildInfo> {
  const bundlePath = join(root, 'dist', 'backend.mjs');
  const exists = existsSync(bundlePath);
  const bundleMtime = exists ? statSync(bundlePath).mtimeMs : 0;
  const sourceMtime = newestBundleInputMtime(root);
  const missing = !exists;
  const stale = exists && bundleMtime < sourceMtime;
  const needBuild = opts.rebuild || missing || stale;

  if (needBuild && opts.noBuild) {
    throw new Unjudgeable(
      'bundle-stale',
      '--no-build 但 dist/backend.mjs ' +
        (missing ? '不存在' : '比 src/packages 源码旧') +
        ' ⇒ 无法声称「同 SHA 换形态」（请先 npm run build:bundle）',
    );
  }

  let buildMs: number | null = null;
  if (needBuild) {
    const startedAt = Date.now();
    const result = await runCommandCapture(
      'bash',
      [join(root, 'scripts', 'desktop', 'build-backend.sh')],
      root,
      childEnv(root, { SYNO_M6B_PROBE: '1' }),
      600000,
    );
    buildMs = Date.now() - startedAt;
    const buildLog = join(evidenceDir, 'build-backend-' + String(startedAt) + '.log');
    appendFileSync(buildLog, result.output);
    if (result.timedOut) {
      throw new Unjudgeable('bundle-build-timeout', 'build-backend.sh 超时（600s）——日志: ' + buildLog);
    }
    if (result.code !== 0) {
      throw new Unjudgeable(
        'bundle-build-failed',
        'build-backend.sh exit=' + String(result.code) + '（日志: ' + buildLog + '）' + NL + '--- 尾部 ---' + NL + textTail(result.output, 12),
      );
    }
  }

  if (!existsSync(bundlePath)) {
    throw new Unjudgeable('bundle-missing', '构建后仍无 dist/backend.mjs ⇒ 构建链断');
  }
  const sizeBytes = statSync(bundlePath).size;
  if (sizeBytes <= 0) {
    throw new Unjudgeable('bundle-empty', 'dist/backend.mjs 大小为 0 ⇒ 构建链断');
  }
  return {
    path: bundlePath,
    sizeBytes,
    sha256: sha256File(bundlePath),
    rebuilt: needBuild,
    buildMs,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 形态启动 / 就绪等待 / 日志解析 / 收尾
// ═══════════════════════════════════════════════════════════════════

function spawnForm(root: string, form: FormName, port: number, evidenceDir: string): FormHandle {
  const dataDir = join(evidenceDir, 'data-' + form);
  mkdirSync(dataDir, { recursive: true });
  const logPath = join(evidenceDir, form + '-run-' + String(Date.now()) + '.log');
  appendFileSync(logPath, '');

  const args =
    form === FORM_DEV
      ? [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts']
      : [join(root, 'dist', 'backend.mjs')];
  const env = childEnv(root, {
    DEV_MODE: 'true',
    PORT: String(port),
    SYNOVA_DATA_DIR: dataDir,
    SYNOVA_DB_PATH: join(dataDir, 'synova.db'),
  });

  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChildren.add(child);

  const chunks: string[] = [];
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const write = (chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    chunks.push(text);
    appendFileSync(logPath, text);
  };
  child.stdout?.on('data', write);
  child.stderr?.on('data', write);
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal };
    activeChildren.delete(child);
  });
  child.once('error', (err) => {
    chunks.push('（子进程 spawn 失败：' + err.message + '）');
    activeChildren.delete(child);
  });

  return {
    child,
    form,
    port,
    logPath,
    text: () => chunks.join(''),
    exited: () => exitInfo,
  };
}

function parseHealth(body: unknown): HealthShape | null {
  if (!isRecord(body) || !isRecord(body.summary)) return null;
  const total = numberOrNull(body.summary.total);
  if (total === null) return null;
  const rawSentinels = body.sentinels;
  const ids: string[] = [];
  if (Array.isArray(rawSentinels)) {
    for (const item of rawSentinels) {
      if (isRecord(item) && typeof item.id === 'string') ids.push(item.id);
    }
  }
  return { total, ids };
}

async function fetchHealth(port: number): Promise<HealthShape | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 3000);
  try {
    const url = 'http://127.0.0.1:' + String(port) + '/api/sentinel/health';
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return parseHealth(body);
  } catch (err) {
    // 未就绪（连接拒绝/超时/JSON 半截）⇒ 返回 null 由调用方轮询；不静默当通过
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function logTail(logPath: string, lines: number): string {
  if (!existsSync(logPath)) return '（日志不存在：' + logPath + '）';
  return textTail(readFileSync(logPath, 'utf8'), lines);
}

async function waitForHealth(handle: FormHandle, timeoutMs: number): Promise<{ health: HealthShape; readyMs: number }> {
  const startedAt = Date.now();
  let lastReason = '尚无 HTTP 响应';
  while (Date.now() - startedAt < timeoutMs) {
    const exited = handle.exited();
    if (exited !== null) {
      throw new Unjudgeable(
        'form-exited',
        handle.form +
          ' 形态在就绪前退出（code=' +
          String(exited.code) +
          ' signal=' +
          String(exited.signal) +
          '）' +
          NL +
          '--- 日志尾部 ---' +
          NL +
          logTail(handle.logPath, 15),
      );
    }
    const health = await fetchHealth(handle.port);
    if (health !== null) return { health, readyMs: Date.now() - startedAt };
    lastReason = 'GET /api/sentinel/health 未返回可解析 JSON（127.0.0.1:' + String(handle.port) + '）';
    await sleep(1000);
  }
  throw new Unjudgeable(
    'form-timeout',
    handle.form +
      ' 形态 ' +
      String(timeoutMs) +
      'ms 内未就绪：' +
      lastReason +
      NL +
      '--- 日志尾部 ---' +
      NL +
      logTail(handle.logPath, 15),
  );
}

/** 解析装载日志：扫描数 / 注册数 / 注册错误数 / 动态 import 失败行数 / builtin 不可读 */
function parseLoaderLog(text: string): LoaderLog {
  const result: LoaderLog = {
    scanCount: null,
    scanErrors: null,
    registered: null,
    regErrors: null,
    importFailureLines: 0,
    builtinUnavailable: false,
  };
  const registerCandidates: Array<{ registered: number; skipped: number; errors: number }> = [];

  for (const rawLine of text.split(NL)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.includes('[builtins] adapters/ 目录不可读')) result.builtinUnavailable = true;
    if (!line.startsWith('{')) {
      if (line.includes('动态模块加载失败')) result.importFailureLines += 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      // 非 JSON 行（npm 前缀/截断）⇒ 跳过；是否解析到目标行由末尾统一判废
      continue;
    }
    if (!isRecord(parsed)) continue;
    const msg = typeof parsed.msg === 'string' ? parsed.msg : '';
    if (msg === '哨兵加载完成') {
      const count = numberOrNull(parsed.count);
      const errors = numberOrNull(parsed.errors);
      if (count !== null) result.scanCount = count;
      if (errors !== null) result.scanErrors = errors;
    } else if (msg === '文件驱动哨兵已注册') {
      const registered = numberOrNull(parsed.registered);
      const skipped = numberOrNull(parsed.skipped);
      const errors = numberOrNull(parsed.errors);
      if (registered !== null) {
        registerCandidates.push({ registered, skipped: skipped ?? 0, errors: errors ?? 0 });
      }
    } else if (msg.includes('动态模块加载失败')) {
      result.importFailureLines += 1;
    } else if (msg.includes('[builtins] adapters/ 目录不可读')) {
      result.builtinUnavailable = true;
    }
  }

  const zeroSkip = registerCandidates.filter((candidate) => candidate.skipped === 0);
  if (zeroSkip.length > 0) {
    result.registered = zeroSkip[0].registered;
    result.regErrors = zeroSkip[0].errors;
  } else if (registerCandidates.length > 0) {
    let best = registerCandidates[0];
    for (const candidate of registerCandidates) {
      if (candidate.registered > best.registered) best = candidate;
    }
    result.registered = best.registered;
    result.regErrors = best.errors;
  }
  return result;
}

async function waitChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(value);
    };
    const onExit = (): void => {
      finish(true);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (err) {
    // 进程组不存在（可能已退出）⇒ 退化为单进程信号；仍失败则交给 waitChildExit 判超时
    try {
      child.kill(signal);
    } catch (inner) {
      // 已退出：无需处理（显式注释，禁静默）
    }
  }
}

async function killForm(handle: FormHandle): Promise<void> {
  if (handle.exited() !== null) return;
  killGroup(handle.child, 'SIGTERM');
  const exited = await waitChildExit(handle.child, 10000);
  if (!exited) {
    killGroup(handle.child, 'SIGKILL');
    await waitChildExit(handle.child, 5000);
  }
}

async function runForm(
  root: string,
  form: FormName,
  port: number,
  timeoutMs: number,
  evidenceDir: string,
): Promise<FormRun> {
  const handle = spawnForm(root, form, port, evidenceDir);
  try {
    const ready = await waitForHealth(handle, timeoutMs);
    await sleep(300);
    const log = parseLoaderLog(handle.text());
    if (log.scanCount === null) {
      throw new Unjudgeable(
        'log-scan-unparseable',
        form + ': 日志缺「哨兵加载完成」行 ⇒ 看不到扫描数（禁把看不见当没问题）。日志: ' + handle.logPath,
      );
    }
    if (log.registered === null) {
      throw new Unjudgeable(
        'log-register-unparseable',
        form + ': 日志缺「文件驱动哨兵已注册」行 ⇒ 看不到注册数（禁把看不见当没问题）。日志: ' + handle.logPath,
      );
    }
    return {
      form,
      port,
      readyMs: ready.readyMs,
      total: ready.health.total,
      sentinelIds: ready.health.ids,
      scanCount: log.scanCount,
      scanErrors: log.scanErrors ?? -1,
      registered: log.registered,
      regErrors: log.regErrors ?? -1,
      importFailureLines: log.importFailureLines,
      builtinUnavailable: log.builtinUnavailable,
      logPath: handle.logPath,
    };
  } finally {
    await killForm(handle);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 反例（判别力自检）：移走一个当前已装载的哨兵目录 ⇒ 计数 −1
// ═══════════════════════════════════════════════════════════════════

function restoreMovedDir(): void {
  if (movedDir === null) return;
  const current = movedDir;
  movedDir = null;
  if (existsSync(current.to)) {
    if (existsSync(current.from)) {
      throw new Unjudgeable(
        'restore-conflict',
        '反例恢复冲突：' + current.from + ' 与 ' + current.to + ' 同时存在 —— 需人工核对后再跑',
      );
    }
    renameSync(current.to, current.from);
  }
  if (!existsSync(current.from)) {
    throw new Unjudgeable('restore-missing', '反例恢复失败：' + current.from + ' 不存在');
  }
  const restoredSha = sha256File(join(current.from, 'manifest.json'));
  if (restoredSha !== current.manifestSha256) {
    throw new Unjudgeable(
      'restore-hash-mismatch',
      '反例恢复后 manifest 哈希不一致（before=' + current.manifestSha256 + ' after=' + restoredSha + '）—— 需人工核对',
    );
  }
  console.log(PROBE + ' COUNTEREXAMPLE: 已恢复 ' + current.from + '（manifest sha256 核对一致）');
}

/** 启动前清理上次异常退出遗留的被移目录（不会静默覆盖） */
function recoverLeftovers(evidenceDir: string, sentinelsDir: string): void {
  const movedRoot = join(evidenceDir, 'moved');
  if (!existsSync(movedRoot)) return;
  for (const entry of readdirSync(movedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = join(sentinelsDir, entry.name);
    const to = join(movedRoot, entry.name);
    if (existsSync(from)) {
      throw new Unjudgeable(
        'leftover-conflict',
        '上次运行残留：' + entry.name + ' 同时存在于 extensions/sentinels 与 ' + movedRoot + ' —— 需人工核对',
      );
    }
    renameSync(to, from);
    console.log(PROBE + ' RECOVER: 已恢复上次运行残留的被移目录 ' + entry.name);
  }
}

async function runCounterexample(
  root: string,
  derived: Derived,
  opts: ProbeOptions,
  evidenceDir: string,
  basePort: number,
): Promise<number> {
  console.log(PROBE + ' COUNTEREXAMPLE: 基线 bundle（改前）…');
  const before = await runForm(root, FORM_BUNDLE, await findFreePort(basePort), opts.bundleTimeoutMs, evidenceDir);
  printForm('BUNDLE(ce-before)', before);

  if (before.total <= 0) {
    throw new Unjudgeable(
      'zero-signal',
      'bundle 基线 total=0 ⇒ 无法演示「移目录 ⇒ −1」（禁把看不见当没问题）',
    );
  }

  let targetDir: string | null = null;
  let targetId = '';
  for (const id of before.sentinelIds) {
    const name = id.startsWith('sentinel-') ? id.slice('sentinel-'.length) : id;
    const dir = derived.nameToDir.get(name);
    if (dir !== undefined) {
      targetDir = dir;
      targetId = id;
      break;
    }
  }
  if (targetDir === null) {
    throw new Unjudgeable(
      'no-mapped-sentinel',
      'bundle 已装载哨兵里没有能映射回 extensions/sentinels/ 目录的项（ids=' + before.sentinelIds.join(',') + '）',
    );
  }

  const from = join(derived.sentinelsDir, targetDir);
  const to = join(evidenceDir, 'moved', targetDir);
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) {
    throw new Unjudgeable('leftover-conflict', '反例暂存路径已存在：' + to + ' —— 需人工核对');
  }
  const manifestSha256 = sha256File(join(from, 'manifest.json'));
  renameSync(from, to);
  movedDir = { from, to, manifestSha256 };
  console.log(PROBE + ' COUNTEREXAMPLE: 临时移走 ' + targetDir + '（' + targetId + '）→ ' + to);

  try {
    console.log(PROBE + ' COUNTEREXAMPLE: 重跑 bundle（改后）…');
    const after = await runForm(
      root,
      FORM_BUNDLE,
      await findFreePort(basePort + 2),
      opts.bundleTimeoutMs,
      evidenceDir,
    );
    printForm('BUNDLE(ce-after)', after);

    const totalDelta = after.total - before.total;
    const registeredDelta = after.registered - before.registered;
    const scanDelta = after.scanCount - before.scanCount;
    console.log(
      PROBE +
        ' COUNTEREXAMPLE: before{total=' +
        String(before.total) +
        ',registered=' +
        String(before.registered) +
        ',scan=' +
        String(before.scanCount) +
        '} → after{total=' +
        String(after.total) +
        ',registered=' +
        String(after.registered) +
        ',scan=' +
        String(after.scanCount) +
        '} ｜ delta total=' +
        String(totalDelta) +
        ' registered=' +
        String(registeredDelta) +
        ' scan=' +
        String(scanDelta),
    );
    const strong = before.total >= derived.expected;
    console.log(
      PROBE +
        ' COUNTEREXAMPLE-STRENGTH: ' +
        (strong
          ? '强证明（改前在册数 >= E）'
          : '弱证明（改前在册数 ' +
            String(before.total) +
            ' < E=' +
            String(derived.expected) +
            ' —— 只能证明「移目录 ⇒ −1」通路；强证明待 P0 修法合并后复跑）'),
    );

    if (totalDelta !== -1 || registeredDelta !== -1) {
      throw new Unjudgeable(
        'counterexample-not-proven',
        '移走 ' +
          targetDir +
          ' 后计数未各 −1（total delta=' +
          String(totalDelta) +
          '，registered delta=' +
          String(registeredDelta) +
          '）⇒ 探针判别力不成立',
      );
    }
    console.log(PROBE + ' RESULT: COUNTEREXAMPLE PROVEN（移目录 ⇒ total/registered 各 −1；exit 0）');
    return EXIT_OK;
  } finally {
    restoreMovedDir();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 判据（hard：registered==E 且 errors==0；soft：total>=E；不判 total==E）
// ═══════════════════════════════════════════════════════════════════

function printForm(label: string, run: FormRun): void {
  const builtinGap = run.total - run.registered;
  console.log(
    PROBE +
      ' ' +
      label +
      ': total=' +
      String(run.total) +
      ' registered=' +
      String(run.registered) +
      ' errors=' +
      String(run.regErrors) +
      ' scan=' +
      String(run.scanCount) +
      ' scanErrors=' +
      String(run.scanErrors) +
      ' builtinGap=' +
      String(builtinGap) +
      ' builtinUnavailable=' +
      String(run.builtinUnavailable) +
      ' importFailureLines=' +
      String(run.importFailureLines) +
      ' readyMs=' +
      String(run.readyMs) +
      ' port=' +
      String(run.port) +
      ' log=' +
      run.logPath,
  );
}

function judge(dev: FormRun, bundle: FormRun, derived: Derived): number {
  const calibration: Array<{ name: string; pass: boolean; detail: string }> = [
    {
      name: 'dev.scanCount == E',
      pass: dev.scanCount === derived.expected,
      detail: 'dev.scanCount=' + String(dev.scanCount) + ' E=' + String(derived.expected),
    },
    {
      name: 'dev.registered == E',
      pass: dev.registered === derived.expected,
      detail: 'dev.registered=' + String(dev.registered) + ' E=' + String(derived.expected),
    },
    { name: 'dev.errors == 0', pass: dev.regErrors === 0, detail: 'dev.errors=' + String(dev.regErrors) },
    { name: 'dev.scanErrors == 0', pass: dev.scanErrors === 0, detail: 'dev.scanErrors=' + String(dev.scanErrors) },
  ];
  for (const item of calibration) {
    console.log(PROBE + ' CALIBRATION ' + (item.pass ? 'OK ' : 'FAIL') + ' ' + item.name + '（' + item.detail + '）');
  }
  const calibrationFailures = calibration.filter((item) => !item.pass);
  if (calibrationFailures.length > 0) {
    throw new Unjudgeable(
      'calibration-failed',
      [
        '定标不成立：dev 形态与目录集派生值不一致 ⇒ 尺子本身口径不成立（禁把尺子坏了当被测对象坏了）：',
        ...calibrationFailures.map((item) => '  ' + item.name + '（' + item.detail + '）'),
      ].join(NL),
    );
  }

  const hardRegistered = bundle.registered === derived.expected;
  const hardErrors = bundle.regErrors === 0;
  const softTotal = bundle.total >= derived.expected;

  console.log(
    PROBE +
      ' JUDGE hard#1 registered==E: bundle.registered=' +
      String(bundle.registered) +
      ' E=' +
      String(derived.expected) +
      ' ⇒ ' +
      (hardRegistered ? 'PASS' : 'FAIL'),
  );
  console.log(
    PROBE +
      ' JUDGE hard#2 errors==0: bundle.errors=' +
      String(bundle.regErrors) +
      ' ⇒ ' +
      (hardErrors ? 'PASS' : 'FAIL'),
  );
  console.log(
    PROBE +
      ' JUDGE soft total>=E: bundle.total=' +
      String(bundle.total) +
      ' E=' +
      String(derived.expected) +
      ' ⇒ ' +
      (softTotal ? 'PASS' : 'FAIL') +
      '（软判；不判 total===E —— dev 含 builtin，total>E 属正常）',
  );

  const devBuiltinGap = dev.total - dev.registered;
  const bundleBuiltinGap = bundle.total - bundle.registered;
  console.log(
    PROBE +
      ' BUILTIN-GAP: dev(total−registered)=' +
      String(devBuiltinGap) +
      ' ｜ bundle=' +
      String(bundleBuiltinGap) +
      ' ⇒ bundle 相对 dev 缺 ' +
      String(devBuiltinGap - bundleBuiltinGap) +
      ' 个 builtin（已知缺口，独立于内容面；M6b 只判内容面，builtin 面另立）',
  );
  console.log(PROBE + ' BUILTIN-NOTE: bundle 侧 builtin 不可读证据（adapters/ 目录不可读）=' + String(bundle.builtinUnavailable));

  const pass = hardRegistered && hardErrors && softTotal;
  if (pass) {
    console.log(PROBE + ' RESULT: PASS —— bundle 形态内容面成立（registered==E 且 errors==0 且 total>=E）');
    return EXIT_OK;
  }
  console.log(
    PROBE + ' RESULT: RED —— bundle 形态内容面不成立（当前记录现状；本探针不修任何东西，exit ' + String(EXIT_RED) + '）',
  );
  return EXIT_RED;
}

// ═══════════════════════════════════════════════════════════════════
// CLI / 主流程 / 清理
// ═══════════════════════════════════════════════════════════════════

function parseIntArg(raw: string, name: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Unjudgeable('bad-arg', '--' + name + ' 需要正整数毫秒，收到：' + raw);
  }
  return value;
}

function parseArgs(argv: string[]): ProbeOptions {
  const opts: ProbeOptions = {
    counterexample: false,
    rebuild: false,
    noBuild: false,
    devTimeoutMs: 120000,
    bundleTimeoutMs: 240000,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--counterexample') {
      opts.counterexample = true;
    } else if (arg === '--rebuild') {
      opts.rebuild = true;
    } else if (arg === '--no-build') {
      opts.noBuild = true;
    } else if (arg.startsWith('--dev-timeout-ms=')) {
      opts.devTimeoutMs = parseIntArg(arg.slice('--dev-timeout-ms='.length), 'dev-timeout-ms');
    } else if (arg.startsWith('--bundle-timeout-ms=')) {
      opts.bundleTimeoutMs = parseIntArg(arg.slice('--bundle-timeout-ms='.length), 'bundle-timeout-ms');
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Unjudgeable('bad-arg', '未知参数：' + arg + '（--help 看用法）');
    }
  }
  if (opts.rebuild && opts.noBuild) {
    throw new Unjudgeable('bad-arg', '--rebuild 与 --no-build 互斥');
  }
  return opts;
}

function printUsage(): void {
  console.log(
    [
      '用法：npx tsx scripts/control-tower/probe-bundle-content.ts [选项]',
      '',
      'M6b：同 SHA 换形态跑 dev（tsx）与 bundle（dist/backend.mjs），',
      '判 bundle 形态的内容面：hard = registered==E 且 errors==0；soft = total>=E（不判 total==E）。',
      'E 由 extensions/sentinels/ 目录集派生（排除 shared 与 _ 前缀；每目录须有 manifest.json）。',
      '',
      '选项：',
      '  --counterexample        判别力自检：临时移走一个当前已装载的哨兵目录 ⇒ 重跑 ⇒ 计数 −1',
      '  --rebuild               强制重建 dist/backend.mjs（保证同 SHA）',
      '  --no-build              禁止重建（缺失/过期 ⇒ exit 2）',
      '  --dev-timeout-ms=<n>    dev 就绪等待（默认 120000）',
      '  --bundle-timeout-ms=<n> bundle 就绪等待（默认 240000）',
      '  --help                  本帮助',
      '',
      '退出码：0 全绿 ｜ 1 真红（当前 bundle 形态应报此）｜ 2 探针自身判不了（看不到/解析不了/定标不一致/反例不成立）',
    ].join(NL),
  );
}

function cleanupSync(): void {
  for (const child of activeChildren) {
    killGroup(child, 'SIGTERM');
  }
  try {
    restoreMovedDir();
  } catch (err) {
    console.error(PROBE + ' CLEANUP: 恢复被移目录失败：' + errorText(err));
  }
}

function installSignalHandlers(): void {
  const handle = (signal: NodeJS.Signals): void => {
    console.error(PROBE + ' 收到 ' + signal + ' —— 清理子进程/恢复被移目录后退出（exit ' + String(EXIT_UNJUDGEABLE) + '）');
    cleanupSync();
    process.exit(EXIT_UNJUDGEABLE);
  };
  process.once('SIGINT', () => {
    handle('SIGINT');
  });
  process.once('SIGTERM', () => {
    handle('SIGTERM');
  });
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return EXIT_OK;
  }
  installSignalHandlers();

  const root = locateRepoRoot();
  const evidenceDir = join(root, EVIDENCE_REL);
  mkdirSync(evidenceDir, { recursive: true });

  const sha = gitHead(root);
  const dirty = gitTrackedDirty(root);
  const derived = deriveExpected(root);
  recoverLeftovers(evidenceDir, derived.sentinelsDir);

  console.log(PROBE + ' PROBE: bundle-content（M6b；同 SHA 换形态；不接 CI）');
  console.log(PROBE + ' ROOT: ' + root);
  console.log(
    PROBE +
      ' SHA: ' +
      sha +
      '（git status --porcelain -uno：' +
      (dirty.length === 0 ? '空' : String(dirty.length) + ' 项未提交') +
      '）',
  );
  console.log(PROBE + ' NODE: ' + process.version + ' exe=' + process.execPath);
  console.log(
    PROBE +
      ' DERIVED expected=' +
      String(derived.expected) +
      '（extensions/sentinels/ 顶层目录集；排除=' +
      (derived.excluded.length > 0 ? derived.excluded.join(',') : '无') +
      '；manifest 齐全=' +
      String(derived.dirs.length) +
      '）',
  );
  if (dirty.length > 0) {
    throw new Unjudgeable(
      'dirty-worktree',
      [
        '跟踪文件有未提交改动（' + String(dirty.length) + ' 项）⇒ 无法声称「同 SHA 换形态」（先提交/还原）：',
        ...dirty.slice(0, 10).map((line) => '  ' + line),
      ].join(NL),
    );
  }

  const basePort = await findFreePort(readConfiguredPort(root));
  const buildInfo = await ensureBundle(root, opts, evidenceDir);
  console.log(
    PROBE +
      ' BUNDLE-ARTIFACT: ' +
      buildInfo.path +
      ' sha256=' +
      buildInfo.sha256 +
      ' sizeBytes=' +
      String(buildInfo.sizeBytes) +
      ' rebuilt=' +
      String(buildInfo.rebuilt) +
      ' buildMs=' +
      (buildInfo.buildMs === null ? 'N/A' : String(buildInfo.buildMs)),
  );

  if (opts.counterexample) {
    return await runCounterexample(root, derived, opts, evidenceDir, basePort);
  }

  const devPort = basePort;
  const bundlePort = await findFreePort(basePort + 1);
  console.log(PROBE + ' PORT: dev=' + String(devPort) + ' bundle=' + String(bundlePort) + '（基准来自 synova.json；自动避占用）');

  console.log(PROBE + ' RUN: dev（tsx src/index.ts）…');
  const dev = await runForm(root, FORM_DEV, devPort, opts.devTimeoutMs, evidenceDir);
  printForm('DEV', dev);

  console.log(PROBE + ' RUN: bundle（node dist/backend.mjs）…');
  const bundle = await runForm(root, FORM_BUNDLE, bundlePort, opts.bundleTimeoutMs, evidenceDir);
  printForm('BUNDLE', bundle);

  return judge(dev, bundle, derived);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof Unjudgeable) {
      console.error(PROBE + ' UNJUDGEABLE(' + err.code + '): ' + err.message);
    } else {
      console.error(PROBE + ' UNJUDGEABLE(unexpected): ' + (err instanceof Error ? err.stack ?? err.message : String(err)));
    }
    process.exitCode = EXIT_UNJUDGEABLE;
  })
  .finally(() => {
    cleanupSync();
  });
