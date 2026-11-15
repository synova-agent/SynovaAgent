/**
 * src/runtime/dsh/sidecar.ts — 固定版本 dsh Sidecar 的**生命周期**（start/stop/status/logs）。
 *
 * 为什么需要 supervisor 进程：dsh 的 ACP 应用在 stdin EOF 时会自行退出（`exitOnStdinEnd`），
 * 所以"启动后让父进程退出"留不住 Sidecar。`start` 因此拉起一个**独立 supervisor**
 * （同一文件的 `--action supervise`），由它持有 ACP 的 stdin/stdout，并把就绪状态、
 * 控制端口、pid 写进 `<dshHome>/run/synova-sidecar.json`；`status`/`stop` 通过
 * 回环控制口（带一次性 token）与 supervisor 对话。PS 脚本只是薄包装。
 *
 * 契约（铁律 47）:
 *   @input   dshHome（per-instance）｜ instanceDir（= 子进程 cwd，workspaceRoot 的契约值）
 *            ｜ installDir（固定版本安装目录）｜ profileDir（仓库内 profile 四件）
 *   @output  SidecarStatus { running, ready, supervisorPid, acpPid, workspaceRoot, logPath, ... }
 *   @degraded 进程活着但控制口不可达 ⇒ ready:false + code=SIDECAR_CONTROL_UNAVAILABLE（显式可见）
 *   @error   SIDECAR_NOT_RUNNING / SIDECAR_START_TIMEOUT / SIDECAR_PROTOCOL_ERROR /
 *            SIDECAR_SPAWN_FAILED / PROFILE_*（由 profile.ts 抛）
 *   @边界   `close session ≠ stop process`：stop 先做 ACP dispose（关 stdin）再杀进程，
 *            并**验证进程确实消失**；只关会话不会结束 supervisor。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { systemClock } from '../../services/clock';
import { spawnAcpProcess, type AcpClientOptions } from './acp-client';
import { DshError, isDshError, isDshErrorCode, isDshErrorPhase, toDshError } from './errors';
import {
  buildChildEnv,
  buildDshInvocation,
  defaultProfileDir,
  installSidecarProfile,
  loadSidecarProfile,
  assertSidecarProfile,
  resolveWorkspaceRoot,
  SIDECAR_PROFILE_NAME,
} from './profile';

/** 状态文件 schema 版本（改字段必须同时升版本，避免读到半截旧文件）。 */
const STATE_SCHEMA_VERSION = 1;

/** 状态文件（supervisor 写，status/stop 读）。 */
export interface SidecarState {
  schemaVersion: number;
  profile: string;
  dshHome: string;
  instanceDir: string;
  workspaceRoot: string;
  installDir: string;
  supervisorPid: number;
  acpPid: number | null;
  controlPort: number;
  controlToken: string;
  ready: boolean;
  protocolVersion: number | null;
  agentName: string | null;
  startedAt: string;
  logPath: string;
  /** supervisor 启动失败时的稳定错误（父进程据此抛同类错误，而不是笼统 spawn failed）。 */
  failure: { code: string; phase: string; retryable: boolean; message: string } | null;
}

/** 对外的状态视图（status.ps1 的 JSON）。 */
export interface SidecarStatus extends SidecarState {
  ok: boolean;
  running: boolean;
  /** 控制口最近一次健康检查结果；进程活着但控制口失败时为 false（degraded 可见）。 */
  controlReachable: boolean;
  sessions: number;
  lastHealthAt: string | null;
  code: string | null;
  phase: string | null;
  retryable: boolean | null;
  message: string | null;
}

/** 公共选项。 */
export interface SidecarOptions {
  dshHome?: string;
  instanceDir?: string;
  installDir?: string;
  profileDir?: string;
  /** 显式 ACP 启动命令（离线测试/探针用；缺省用固定版本 dsh 安装目录）。 */
  acpCommand?: string;
  acpArgs?: string[];
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** 控制口鉴权 token（supervisor 内部生成；外部一般不需要传）。 */
  controlToken?: string;
}

/** 仓库根（本文件位于 src/runtime/dsh/）。 */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** Windows 默认 DSH_HOME：%LOCALAPPDATA%\Synova\dsh-sidecar\home。 */
export function defaultDshHome(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData.length > 0) {
    return join(localAppData, 'Synova', 'dsh-sidecar', 'home');
  }
  return join(homedir(), '.synova', 'dsh-sidecar', 'home');
}

/** 默认实例目录：与 DSH_HOME 同级（cwd=instanceDir ⇒ workspaceRoot=instanceDir）。 */
export function defaultInstanceDir(): string {
  return join(dirname(defaultDshHome()), 'instance');
}

/** 默认固定版本安装目录（部署侧可用 SYNOVA_DSH_INSTALL_DIR 覆盖）。 */
function defaultInstallDir(): string {
  const fromEnv = process.env.SYNOVA_DSH_INSTALL_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData.length > 0) {
    return join(localAppData, 'Programs', 'DeepSeek Harness');
  }
  return join(homedir(), 'Programs', 'DeepSeek Harness');
}

/** 解析后的路径集合。 */
export interface ResolvedSidecarOptions {
  dshHome: string;
  instanceDir: string;
  installDir: string;
  profileDir: string;
  acpCommand: string | null;
  acpArgs: string[];
  startTimeoutMs: number;
  stopTimeoutMs: number;
  controlToken: string;
}

/** 把可选项收敛成绝对路径（全部校验，避免相对路径落到任意目录）。 */
function resolveSidecarOptions(options: SidecarOptions = {}): ResolvedSidecarOptions {
  const dshHome = resolve(options.dshHome ?? defaultDshHome());
  const instanceDir = resolve(options.instanceDir ?? defaultInstanceDir());
  const installDir = resolve(options.installDir ?? defaultInstallDir());
  const profileDir = resolve(options.profileDir ?? defaultProfileDir());
  if (!isAbsolute(dshHome) || !isAbsolute(instanceDir)) {
    throw new DshError('VALIDATION_ERROR', 'profile', 'dshHome/instanceDir 必须是绝对路径', { retryable: false });
  }
  return {
    dshHome,
    instanceDir,
    installDir,
    profileDir,
    acpCommand: options.acpCommand ?? null,
    acpArgs: options.acpArgs ?? [],
    startTimeoutMs: options.startTimeoutMs ?? 60_000,
    stopTimeoutMs: options.stopTimeoutMs ?? 15_000,
    controlToken: options.controlToken ?? randomBytes(24).toString('hex'),
  };
}

/** 状态文件路径。 */
function stateFilePath(dshHome: string): string {
  return join(dshHome, 'run', `${SIDECAR_PROFILE_NAME}.json`);
}

/** 日志路径（按日）。 */
function logFilePath(dshHome: string, nowIso: string = systemClock.nowIso()): string {
  const day = nowIso.slice(0, 10).replaceAll('-', '');
  return join(dshHome, 'logs', `sidecar-${day}.log`);
}

/** 结构化日志：原文行 + `{time,level,component,code?,phase?,retryable?,message}`。 */
function appendLog(logPath: string, level: 'info' | 'warn' | 'error', component: string, message: string, extra: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const time = systemClock.nowIso();
    const line = `${time} ${level.toUpperCase()} ${component} ${message}\n`;
    const structured = `${JSON.stringify({ time, level, component, ...extra, message })}\n`;
    appendFileSync(logPath, line + structured, 'utf8');
  } catch {
    // 日志不可写不阻断生命周期（写 stderr 会被 supervisor 的 stdio=ignore 丢弃，
    // 因此只保证：调用方仍能通过 status/异常看到失败本身）。
  }
}

/** 读取状态文件；不存在/非法返回 null（status 用 NOT_RUNNING 表达）。 */
function readState(dshHome: string): SidecarState | null {
  const path = stateFilePath(dshHome);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const state = parsed as Partial<SidecarState>;
    if (state.schemaVersion !== STATE_SCHEMA_VERSION) return null;
    if (typeof state.supervisorPid !== 'number' || typeof state.controlPort !== 'number') return null;
    return state as SidecarState;
  } catch {
    return null;
  }
}

/** 写状态文件（先写临时文件再改名，避免读到半截 JSON）。 */
function writeState(dshHome: string, state: SidecarState): void {
  const path = stateFilePath(dshHome);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeFileSync(path, readFileSync(temp, 'utf8'), 'utf8');
  rmSync(temp, { force: true });
}

/**
 * supervisor 在建立状态文件之前失败时，也把稳定错误落到状态文件：
 * 父进程只读状态文件，不解析 stderr（supervisor 的 stdio 是 ignore）。
 */
function writeFailureState(options: SidecarOptions, err: unknown): void {
  const error = toDshError(err, { code: 'SIDECAR_SPAWN_FAILED', phase: 'spawn' });
  const dshHome = resolve(options.dshHome ?? defaultDshHome());
  const instanceDir = resolve(options.instanceDir ?? defaultInstanceDir());
  const existing = readState(dshHome);
  const state: SidecarState = existing ?? {
    schemaVersion: STATE_SCHEMA_VERSION,
    profile: SIDECAR_PROFILE_NAME,
    dshHome,
    instanceDir,
    workspaceRoot: existsSync(instanceDir) ? resolveWorkspaceRoot(instanceDir) : instanceDir,
    installDir: resolve(options.installDir ?? defaultInstallDir()),
    supervisorPid: process.pid,
    acpPid: null,
    controlPort: 0,
    controlToken: '',
    ready: false,
    protocolVersion: null,
    agentName: null,
    startedAt: systemClock.nowIso(),
    logPath: logFilePath(dshHome),
    failure: null,
  };
  state.ready = false;
  state.failure = {
    code: error.code,
    phase: error.phase,
    retryable: error.retryable,
    message: error.message,
  };
  writeState(dshHome, state);
}

/** 进程是否存活（EPERM 视为存活：存在但无权限）。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

/**
 * 把 supervisor 写下的 failure 转回同一 code/phase 的 DshError。
 * 为什么不在父进程猜：启动失败可能发生在 profile 装载、spawn、initialize 任一段，
 * 只有 supervisor 知道真实原因；父进程只负责透传（不把 PROFILE_INVALID 说成 spawn failed）。
 */
function stateFailureError(state: SidecarState, dshHome: string): DshError {
  const failure = state.failure;
  rmSync(stateFilePath(dshHome), { force: true });
  if (failure === null) {
    return new DshError('SIDECAR_SPAWN_FAILED', 'spawn', 'supervisor 失败（状态文件无 failure 详情）', { retryable: true });
  }
  const code = isDshErrorCode(failure.code) ? failure.code : 'SIDECAR_SPAWN_FAILED';
  const phase = isDshErrorPhase(failure.phase) ? failure.phase : 'spawn';
  return new DshError(code, phase, failure.message, { retryable: failure.retryable });
}

/** 控制口请求（带 bearer token）。 */
async function controlRequest(
  state: SidecarState,
  method: 'GET' | 'POST',
  path: string,
  timeoutMs = 3_000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}${path}`, {
      method,
      headers: { authorization: `Bearer ${state.controlToken}` },
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};
    if (parsed === null || typeof parsed !== 'object') {
      throw new DshError('SIDECAR_CONTROL_UNAVAILABLE', 'control', '控制口返回非对象', { retryable: true });
    }
    if (!response.ok) {
      const payload = parsed as { code?: unknown; message?: unknown };
      const detail = typeof payload.code === 'string' ? `[${payload.code}] ` : '';
      throw new DshError(
        'SIDECAR_CONTROL_UNAVAILABLE',
        'control',
        `${detail}${typeof payload.message === 'string' ? payload.message : `控制口 HTTP ${response.status}`}`,
        { retryable: true },
      );
    }
    return parsed as Record<string, unknown>;
  } catch (err: unknown) {
    if (isDshError(err)) throw err;
    throw new DshError('SIDECAR_CONTROL_UNAVAILABLE', 'control', `控制口不可达: ${String(err)}`, {
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 校验 instanceDir 存在（不存在就创建，仅限 sidecar 自己的实例目录）。 */
function ensureInstanceDir(instanceDir: string): void {
  mkdirSync(instanceDir, { recursive: true });
}

/**
 * 启动 Sidecar（拉起 supervisor 并等待就绪）。
 * @output 就绪状态（ready=true）
 * @error  SIDECAR_START_TIMEOUT（超时）/ SIDECAR_SPAWN_FAILED（安装目录缺失）
 */
async function startSidecar(options: SidecarOptions = {}): Promise<SidecarStatus> {
  const resolved = resolveSidecarOptions(options);
  ensureInstanceDir(resolved.instanceDir);

  const profile = loadSidecarProfile(resolved.profileDir);
  assertSidecarProfile(profile);

  const existing = readState(resolved.dshHome);
  if (existing !== null && isProcessAlive(existing.supervisorPid)) {
    const status = await statusSidecar(options);
    return status;
  }
  if (existing !== null) rmSync(stateFilePath(resolved.dshHome), { force: true });

  const logPath = logFilePath(resolved.dshHome);
  appendLog(logPath, 'info', 'sidecar', 'start requested', {
    instanceDir: resolved.instanceDir,
    workspaceRoot: resolveWorkspaceRoot(resolved.instanceDir),
    dshHome: resolved.dshHome,
    profile: SIDECAR_PROFILE_NAME,
  });

  const supervisor = buildSupervisorInvocation(resolved);
  const child = spawn(supervisor.command, supervisor.args, {
    cwd: repoRoot(),
    env: supervisor.env,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();

  const deadline = systemClock.now() + resolved.startTimeoutMs;
  while (systemClock.now() < deadline) {
    await delay(100);
    const state = readState(resolved.dshHome);
    if (state !== null && state.failure !== null) {
      throw stateFailureError(state, resolved.dshHome);
    }
    if (state !== null && state.ready) {
      return {
        ...state,
        ok: true,
        running: true,
        controlReachable: true,
        sessions: 0,
        lastHealthAt: null,
        code: null,
        phase: null,
        retryable: null,
        message: null,
      };
    }
    if (child.pid !== undefined && !isProcessAlive(child.pid)) {
      const failedState = readState(resolved.dshHome);
      if (failedState !== null && failedState.failure !== null) {
        throw stateFailureError(failedState, resolved.dshHome);
      }
      rmSync(stateFilePath(resolved.dshHome), { force: true });
      let tail = '';
      try {
        tail = readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
      } catch {
        tail = '<无日志>';
      }
      throw new DshError(
        'SIDECAR_SPAWN_FAILED',
        'spawn',
        `supervisor 进程提前退出（pid=${child.pid}）: ${tail}`,
        { retryable: true },
      );
    }
  }
  const state = readState(resolved.dshHome);
  if (state !== null && isProcessAlive(state.supervisorPid)) {
    process.kill(state.supervisorPid);
  }
  if (child.pid !== undefined && isProcessAlive(child.pid)) {
    try { process.kill(child.pid); } catch { /* 已退出 */ }
  }
  rmSync(stateFilePath(resolved.dshHome), { force: true });
  throw new DshError(
    'SIDECAR_START_TIMEOUT',
    'initialize',
    `Sidecar 在 ${resolved.startTimeoutMs}ms 内未就绪（日志: ${logPath}）`,
    { retryable: true },
  );
}

/** 查询状态；进程不存在 ⇒ SIDECAR_NOT_RUNNING（exit 1 的可见错误）。 */
async function statusSidecar(options: SidecarOptions = {}): Promise<SidecarStatus> {
  const resolved = resolveSidecarOptions(options);
  const state = readState(resolved.dshHome);
  if (state === null) {
    throw new DshError('SIDECAR_NOT_RUNNING', 'control', `Sidecar 未运行（无状态文件: ${stateFilePath(resolved.dshHome)}）`, {
      retryable: false,
    });
  }
  if (!isProcessAlive(state.supervisorPid)) {
    rmSync(stateFilePath(resolved.dshHome), { force: true });
    throw new DshError('SIDECAR_NOT_RUNNING', 'control', `Sidecar 未运行（pid ${state.supervisorPid} 已退出）`, {
      retryable: false,
    });
  }
  try {
    const health = await controlRequest(state, 'GET', '/status');
    return {
      ...state,
      ok: true,
      running: true,
      controlReachable: true,
      sessions: typeof health.sessions === 'number' ? health.sessions : 0,
      lastHealthAt: typeof health.lastHealthAt === 'string' ? health.lastHealthAt : null,
      code: null,
      phase: null,
      retryable: null,
      message: null,
    };
  } catch (err: unknown) {
    const error = toDshError(err, { code: 'SIDECAR_CONTROL_UNAVAILABLE', phase: 'control' });
    return {
      ...state,
      ok: false,
      running: true,
      controlReachable: false,
      sessions: 0,
      lastHealthAt: null,
      code: error.code,
      phase: error.phase,
      retryable: error.retryable,
      message: error.message,
    };
  }
}

/** 优雅停止；验证进程确实消失（不把「关会话」当「停进程」）。 */
async function stopSidecar(options: SidecarOptions = {}): Promise<{ ok: true; stopped: boolean; supervisorPid: number }> {
  const resolved = resolveSidecarOptions(options);
  const state = readState(resolved.dshHome);
  if (state === null || !isProcessAlive(state.supervisorPid)) {
    if (state !== null) rmSync(stateFilePath(resolved.dshHome), { force: true });
    throw new DshError('SIDECAR_NOT_RUNNING', 'control', 'Sidecar 未运行，无法停止', { retryable: false });
  }
  const logPath = state.logPath;
  appendLog(logPath, 'info', 'sidecar', 'stop requested', { supervisorPid: state.supervisorPid });
  try {
    await controlRequest(state, 'POST', '/stop');
  } catch (err: unknown) {
    // 控制口不可达 ⇒ 退回信号；仍然要求「进程消失」才算停止成功。
    appendLog(logPath, 'warn', 'sidecar', `控制口停止失败，退回信号: ${isDshError(err) ? err.code : String(err)}`);
    try { process.kill(state.supervisorPid); } catch { /* 已退出 */ }
  }

  const deadline = systemClock.now() + resolved.stopTimeoutMs;
  while (systemClock.now() < deadline) {
    if (!isProcessAlive(state.supervisorPid)) break;
    await delay(100);
  }
  if (isProcessAlive(state.supervisorPid)) {
    try { process.kill(state.supervisorPid, 'SIGKILL'); } catch { /* 已退出 */ }
    await delay(500);
  }
  if (isProcessAlive(state.supervisorPid)) {
    throw new DshError('SIDECAR_CONTROL_UNAVAILABLE', 'shutdown', `无法停止 supervisor pid=${state.supervisorPid}`, {
      retryable: true,
    });
  }
  rmSync(stateFilePath(resolved.dshHome), { force: true });
  appendLog(logPath, 'info', 'sidecar', 'stopped', { supervisorPid: state.supervisorPid });
  return { ok: true, stopped: true, supervisorPid: state.supervisorPid };
}

/** 读取日志尾部（logs.ps1）。 */
function readSidecarLogs(options: SidecarOptions = {}, lines = 80): { logPath: string; lines: string[] } {
  const resolved = resolveSidecarOptions(options);
  const logPath = logFilePath(resolved.dshHome);
  if (!existsSync(logPath)) {
    throw new DshError('SIDECAR_NOT_RUNNING', 'control', `日志文件不存在: ${logPath}`, { retryable: false });
  }
  const content = readFileSync(logPath, 'utf8').split(/\r?\n/).filter(line => line.length > 0);
  return { logPath, lines: content.slice(Math.max(0, content.length - lines)) };
}

/** supervisor 启动参数（同一文件的 `--action supervise`）。 */
function buildSupervisorInvocation(resolved: ResolvedSidecarOptions): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const self = fileURLToPath(import.meta.url);
  const isTypeScript = self.endsWith('.ts');
  const args = isTypeScript
    ? ['--import', 'tsx', self, '--action', 'supervise']
    : [self, '--action', 'supervise'];
  args.push('--dsh-home', resolved.dshHome, '--instance-dir', resolved.instanceDir, '--install-dir', resolved.installDir,
    '--profile-dir', resolved.profileDir, '--control-token', resolved.controlToken,
    '--start-timeout-ms', String(resolved.startTimeoutMs), '--stop-timeout-ms', String(resolved.stopTimeoutMs));
  if (resolved.acpCommand !== null) {
    args.push('--acp-command', resolved.acpCommand);
    for (const arg of resolved.acpArgs) args.push('--acp-arg', arg);
  }
  return { command: process.execPath, args, env: { ...process.env, SYNOVA_SIDECAR_SUPERVISOR: '1' } };
}

/** supervisor：持有 ACP 子进程 + 回环控制口，直到 stop 或子进程退出。 */
async function supervise(resolved: ResolvedSidecarOptions): Promise<void> {
  ensureInstanceDir(resolved.instanceDir);
  const workspaceRoot = resolveWorkspaceRoot(resolved.instanceDir);
  const logPath = logFilePath(resolved.dshHome);
  const state: SidecarState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    profile: SIDECAR_PROFILE_NAME,
    dshHome: resolved.dshHome,
    instanceDir: resolved.instanceDir,
    workspaceRoot,
    installDir: resolved.installDir,
    supervisorPid: process.pid,
    acpPid: null,
    controlPort: 0,
    controlToken: resolved.controlToken,
    ready: false,
    protocolVersion: null,
    agentName: null,
    startedAt: systemClock.nowIso(),
    logPath,
    failure: null,
  };

  const profile = loadSidecarProfile(resolved.profileDir);
  assertSidecarProfile(profile);
  const installedProfile = installSidecarProfile({ profileDir: resolved.profileDir, dshHome: resolved.dshHome });

  const invocation = resolved.acpCommand === null
    ? buildDshInvocation({ installDir: resolved.installDir, dshHome: resolved.dshHome })
    : { command: resolved.acpCommand, args: resolved.acpArgs, env: buildChildEnv(resolved.dshHome) };
  appendLog(logPath, 'info', 'sidecar', 'spawning acp app', {
    command: invocation.command,
    profile: installedProfile,
    cwd: resolved.instanceDir,
  });

  const clientOptions: AcpClientOptions = {
    initializeTimeoutMs: resolved.startTimeoutMs,
    onProtocolEvent: event => appendLog(logPath, 'info', 'acp', `${event.direction} ${event.method ?? ''}`.trim(), {
      id: event.id ?? null,
    }),
  };
  const { client, child } = spawnAcpProcess({
    command: invocation.command,
    args: invocation.args,
    cwd: resolved.instanceDir,
    env: invocation.env,
    clientOptions,
    onStderr: line => appendLog(logPath, 'warn', 'acp-stderr', line),
  });
  state.acpPid = child.pid ?? null;

  let stopping = false;
  let sessions = 0;
  let lastHealthAt: string | null = null;

  const writeCurrentState = (): void => {
    writeState(resolved.dshHome, state);
  };

  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    appendLog(logPath, 'info', 'sidecar', `shutdown: ${reason}`);
    try { client.dispose(); } catch { /* 已关闭 */ }
    await delay(50);
    if (state.acpPid !== null && isProcessAlive(state.acpPid)) {
      try { process.kill(state.acpPid); } catch { /* 已退出 */ }
    }
    await delay(100);
    if (state.acpPid !== null && isProcessAlive(state.acpPid)) {
      try { process.kill(state.acpPid, 'SIGKILL'); } catch { /* 已退出 */ }
    }
    rmSync(stateFilePath(resolved.dshHome), { force: true });
    appendLog(logPath, 'info', 'sidecar', 'shutdown complete', { code: 'SIDECAR_NOT_RUNNING', phase: 'shutdown', retryable: false });
    process.exit(0);
  };

  const server = createServer((request, response) => {
    void handleControl(request, response, state, {
      getControlReachable: () => true,
      getSessions: () => sessions,
      getLastHealthAt: () => lastHealthAt,
      requestStop: () => { void shutdown('control stop'); },
    }).catch((err: unknown) => {
      const error = toDshError(err, { code: 'SIDECAR_CONTROL_UNAVAILABLE', phase: 'control' });
      response.writeHead(error.httpStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(error.toPayload()));
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  state.controlPort = address !== null && typeof address === 'object' ? address.port : 0;
  writeCurrentState();

  // 健康检查：进程存活 + ACP session/list；失败只降级（ready 保持，不谎报成功）
  const healthTimer = setInterval(() => {
    void (async () => {
      if (stopping) return;
      try {
        if (state.acpPid === null || !isProcessAlive(state.acpPid)) {
          throw new DshError('SIDECAR_SESSION_LOST', 'session', 'ACP 子进程已退出', { retryable: true });
        }
        const listed = await client.listSessions({ cwd: resolved.instanceDir });
        sessions = listed.sessions.length;
        lastHealthAt = systemClock.nowIso();
      } catch (err: unknown) {
        const error = toDshError(err, { code: 'SIDECAR_SESSION_LOST', phase: 'session' });
        appendLog(logPath, 'warn', 'sidecar', `health check failed: ${error.code}`, {
          code: error.code, phase: error.phase, retryable: error.retryable,
        });
      }
    })();
  }, 15_000);
  healthTimer.unref();

  try {
    const initialized = await client.initialize();
    if (initialized.agentInfo.name !== 'deepseek-harness-acp') {
      throw new DshError(
        'SIDECAR_PROTOCOL_ERROR',
        'initialize',
        `initialize agentInfo.name=${initialized.agentInfo.name}，期望 deepseek-harness-acp`,
        { retryable: false },
      );
    }
    state.ready = true;
    state.protocolVersion = initialized.protocolVersion;
    state.agentName = initialized.agentInfo.name;
    writeCurrentState();
    appendLog(logPath, 'info', 'sidecar', 'ready', {
      protocolVersion: initialized.protocolVersion,
      agent: initialized.agentInfo.name,
      workspaceRoot,
      controlPort: state.controlPort,
    });
  } catch (err: unknown) {
    const error = toDshError(err, { code: 'SIDECAR_PROTOCOL_ERROR', phase: 'initialize' });
    appendLog(logPath, 'error', 'sidecar', `startup failed: ${error.code}`, {
      code: error.code, phase: error.phase, retryable: error.retryable,
    });
    state.ready = false;
    state.failure = { code: error.code, phase: error.phase, retryable: error.retryable, message: error.message };
    writeState(resolved.dshHome, state);
    if (child.pid !== undefined) {
      try { process.kill(child.pid); } catch { /* 已退出 */ }
    }
    process.exit(1);
  }

  child.on('exit', (code, signal) => {
    if (stopping) return;
    appendLog(logPath, 'error', 'sidecar', `acp child exited unexpectedly code=${String(code)} signal=${String(signal)}`, {
      code: 'SIDECAR_SESSION_LOST', phase: 'session', retryable: true,
    });
    state.ready = false;
    writeCurrentState();
    void shutdown('acp child exited');
  });

  const onSignal = (): void => { void shutdown('signal'); };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

/** 回环控制口的三个端点：GET /status、POST /stop、（可选）GET /logs。 */
async function handleControl(
  request: IncomingMessage,
  response: ServerResponse,
  state: SidecarState,
  view: {
    getControlReachable: () => boolean;
    getSessions: () => number;
    getLastHealthAt: () => string | null;
    requestStop: () => void;
  },
): Promise<void> {
  const auth = request.headers.authorization;
  if (auth !== `Bearer ${state.controlToken}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', phase: 'control', retryable: false, message: 'invalid control token' }));
    return;
  }
  const url = request.url ?? '/';
  if (request.method === 'GET' && url === '/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      ready: state.ready,
      supervisorPid: state.supervisorPid,
      acpPid: state.acpPid,
      workspaceRoot: state.workspaceRoot,
      sessions: view.getSessions(),
      lastHealthAt: view.getLastHealthAt(),
      controlReachable: view.getControlReachable(),
    }));
    return;
  }
  if (request.method === 'POST' && url === '/stop') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, stopping: true }));
    // 应答写完后由 supervisor 的 shutdown 退出（先 ACP dispose，再杀子进程，最后删状态文件）
    setImmediate(() => { view.requestStop(); });
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', phase: 'control', retryable: false, message: `unknown path: ${url}` }));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

// ═══ CLI（PS 薄包装的调用面）════════════════════════════════════════════════

interface CliArgs {
  action: 'start' | 'stop' | 'status' | 'logs' | 'supervise';
  dshHome?: string;
  instanceDir?: string;
  installDir?: string;
  profileDir?: string;
  acpCommand?: string;
  acpArgs: string[];
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  controlToken?: string;
  lines: number;
  json: boolean;
}

const CLI_ACTIONS = ['start', 'stop', 'status', 'logs', 'supervise'] as const;

/** action 取值守卫（不做裸类型断言）。 */
function isCliAction(value: string): value is CliArgs['action'] {
  return (CLI_ACTIONS as readonly string[]).includes(value);
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = { action: 'status', acpArgs: [], lines: 80, json: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new DshError('VALIDATION_ERROR', 'request', `缺少参数值: ${arg}`, { retryable: false });
      index += 1;
      return value;
    };
    if (arg === '--action') {
      const value = next();
      if (!isCliAction(value)) throw new DshError('VALIDATION_ERROR', 'request', `未知 action: ${value}`, { retryable: false });
      result.action = value;
    } else if (arg === '--dsh-home') { result.dshHome = next(); }
    else if (arg === '--instance-dir') { result.instanceDir = next(); }
    else if (arg === '--install-dir') { result.installDir = next(); }
    else if (arg === '--profile-dir') { result.profileDir = next(); }
    else if (arg === '--acp-command') { result.acpCommand = next(); }
    else if (arg === '--acp-arg') { result.acpArgs.push(next()); }
    else if (arg === '--control-token') { result.controlToken = next(); }
    else if (arg === '--start-timeout-ms') { result.startTimeoutMs = Number(next()); }
    else if (arg === '--stop-timeout-ms') { result.stopTimeoutMs = Number(next()); }
    else if (arg === '--lines') { result.lines = Number(next()); }
    else if (arg === '--no-json') { result.json = false; }
    else throw new DshError('VALIDATION_ERROR', 'request', `未知参数: ${arg}`, { retryable: false });
  }
  return result;
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function printError(err: unknown): void {
  const error = toDshError(err, { code: 'RUN_FAILED', phase: 'request' });
  printJson(error.toPayload());
}

/** CLI 入口（tsx 直接运行本文件时执行）。 */
async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err: unknown) {
    printError(err);
    return 1;
  }
  const options: SidecarOptions = {
    dshHome: args.dshHome,
    instanceDir: args.instanceDir,
    installDir: args.installDir,
    profileDir: args.profileDir,
    acpCommand: args.acpCommand,
    acpArgs: args.acpArgs,
    startTimeoutMs: args.startTimeoutMs,
    stopTimeoutMs: args.stopTimeoutMs,
    controlToken: args.controlToken,
  };
  try {
    if (args.action === 'start') {
      const status = await startSidecar(options);
      printJson({ ...status, action: 'start' });
      return 0;
    }
    if (args.action === 'status') {
      const status = await statusSidecar(options);
      printJson({ ...status });
      return status.ready ? 0 : 2;
    }
    if (args.action === 'stop') {
      const result = await stopSidecar(options);
      printJson({ ...result, action: 'stop' });
      return 0;
    }
    if (args.action === 'logs') {
      const log = readSidecarLogs(options, args.lines);
      printJson({ ok: true, action: 'logs', logPath: log.logPath, lines: log.lines });
      return 0;
    }
    if (args.action === 'supervise') {
      try {
        await supervise(resolveSidecarOptions(options));
        return 0;
      } catch (err: unknown) {
        // supervisor 在写状态文件之前就可能失败（profile/安装目录）——把稳定错误落盘，
        // 父进程（start.ps1）才能抛同一 code，而不是笼统的 spawn failed。
        writeFailureState(options, err);
        throw err;
      }
    }
    throw new DshError('VALIDATION_ERROR', 'request', `未知 action: ${String(args.action)}`, { retryable: false });
  } catch (err: unknown) {
    printError(err);
    return 1;
  }
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url) || entry.endsWith('sidecar.ts') || entry.endsWith('sidecar.js');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main(process.argv.slice(2)).then(code => {
    // supervisor 常驻时 main 不返回；其它 action 返回码即退出码。
    if (!process.env.SYNOVA_SIDECAR_SUPERVISOR) process.exit(code);
  });
}
