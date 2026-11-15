/**
 * src/runtime/dsh/acp-client.ts — ACP stdio 客户端（newline-delimited JSON-RPC 2.0）。
 *
 * 协议事实来源（不是推断）：dsh 的 ACP 服务端用 `@agentclientprotocol/sdk` 的
 * `ndJsonStream`（`JSON.stringify(message) + "\n"`，按行读）。方法名/参数形状取自
 * dsh-acp 服务端实现（`session/new`、`session/list`、`session/resume`、`session/close`、
 * `session/prompt`、`session/cancel`、`session/update`、`session/request_permission`）。
 * 仓库内落点见证据文件 `1A-T1-DSH实物核验.md` 的「协议来源」节。
 *
 * 责任边界：
 *   · 只做**通用会话/运行**的协议搬运（initialize/new/list/resume/close/prompt/cancel）；
 *   · 不实现领域工具、不实现审批策略、不解析 dsh 内部对象；
 *   · 服务端→客户端请求只有 `session/request_permission` 被实现，默认**拒绝**
 *     （approval=ask 且离线无人应答 ⇒ fail-closed）；未知方法回 -32601。
 *
 * 契约（铁律 47）:
 *   @input   transport（可注入：真实子进程 stdio ｜ 测试用假 transport）
 *   @output  协议方法 → 解析后的 result；通知 → 订阅者
 *   @degraded 无：协议错误、超时、进程退出都抛 DshError（带 code/phase/retryable）
 *   @error   SIDECAR_PROTOCOL_ERROR（非法响应/未知状态）/ SIDECAR_START_TIMEOUT /
 *            RUN_TIMEOUT / TOOL_TIMEOUT / SIDECAR_SESSION_LOST（进程退出）
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { DshError, fromAcpRpcError } from './errors';

/** ACP JSON-RPC 消息（只声明本客户端消费的字段）。 */
interface AcpMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

/** 服务端→客户端请求：询审批（唯一实现的一条）。 */
export interface AcpPermissionRequest {
  sessionId: string;
  toolCall?: { toolCallId?: string; title?: string };
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
}

/** 审批应答：一次性选择（allow_once / reject_once）或取消。 */
export type AcpPermissionDecision = { optionId: string } | { cancelled: true };

/** 传输抽象：真实实现是子进程 stdio，测试实现是内存管道。 */
export interface AcpTransport {
  write(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

/** initialize 结果（只取本模块用到的字段）。 */
export interface AcpInitializeResult {
  protocolVersion: number;
  agentInfo: { name: string; version: string };
  agentCapabilities?: { mcpCapabilities?: { http?: boolean } };
}

export interface AcpConfigOption {
  id: string;
  currentValue?: string;
  options?: unknown;
}

export interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: AcpConfigOption[];
}

export interface AcpPromptResult {
  stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | string;
}

/** `session/update` 通知（字段按 acp 服务端发出的 sessionUpdate 类型放宽）。 */
export interface AcpSessionUpdate {
  sessionId: string;
  update: { sessionUpdate: string; [key: string]: unknown };
}

export interface AcpClientOptions {
  /** 单次 initialize 默认超时（启动窗口）。 */
  initializeTimeoutMs?: number;
  /** 普通请求默认超时。 */
  requestTimeoutMs?: number;
  /** 服务端请求审批时的策略（缺省全部拒绝，fail-closed）。 */
  decidePermission?: (request: AcpPermissionRequest) => Promise<AcpPermissionDecision> | AcpPermissionDecision;
  /** 协议通知 / 服务端请求的诊断日志（不写 stdout）。 */
  onProtocolEvent?: (event: { direction: 'in' | 'out'; method?: string; id?: number | string }) => void;
}

/** 生成一个 request id（客户端内单调递增即可）。 */
function nextIdFactory(): () => number {
  let next = 1;
  return () => next++;
}

/**
 * 客户端核心：请求/响应关联、通知分发、审批应答。
 * 不负责进程生命周期（由 sidecar.ts 管理）。
 */
class AcpClient {
  private readonly transport: AcpTransport;
  private readonly initializeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly decidePermission: (request: AcpPermissionRequest) => Promise<AcpPermissionDecision>;
  private readonly onProtocolEvent?: AcpClientOptions['onProtocolEvent'];
  private readonly nextId = nextIdFactory();
  private readonly pending = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: DshError) => void;
    timer: NodeJS.Timeout;
    phase: 'initialize' | 'session' | 'run' | 'tool';
  }>();
  private readonly notificationHandlers = new Set<(update: AcpSessionUpdate) => void>();
  private closedReason: string | null = null;
  private pendingClose: ((reason: string) => void) | null = null;

  constructor(transport: AcpTransport, options: AcpClientOptions = {}) {
    this.transport = transport;
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.decidePermission = async (request) => {
      if (options.decidePermission === undefined) return { optionId: 'reject-once' };
      return options.decidePermission(request);
    };
    this.onProtocolEvent = options.onProtocolEvent;
    transport.onMessage(message => this.handleMessage(message));
    transport.onClose(reason => this.handleClose(reason));
  }

  /** 订阅会话更新通知（`session/update`）。返回取消订阅函数。 */
  onSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  /**
   * ACP `initialize`。就绪判据：protocolVersion 为数字且 agentInfo.name 为 dsh ACP 服务端名。
   * @error SIDECAR_START_TIMEOUT（超时）/ SIDECAR_PROTOCOL_ERROR（形状不符）
   */
  async initialize(): Promise<AcpInitializeResult> {
    const raw = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'synova-sidecar-client', version: '1.0.0' },
    }, this.initializeTimeoutMs, 'initialize');
    if (raw === null || typeof raw !== 'object') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'initialize', 'initialize 返回非对象', { retryable: false });
    }
    const result = raw as Partial<AcpInitializeResult>;
    if (typeof result.protocolVersion !== 'number') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'initialize', 'initialize 缺少 protocolVersion', { retryable: false });
    }
    if (result.agentInfo === undefined || typeof result.agentInfo.name !== 'string') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'initialize', 'initialize 缺少 agentInfo.name', { retryable: false });
    }
    return result as AcpInitializeResult;
  }

  /** ACP `session/new`（cwd 必须是绝对路径；mcpServers 由调用方注入）。 */
  async newSession(params: {
    cwd: string;
    mcpServers?: Array<{ name: string; type: 'http'; url: string; headers?: Array<{ name: string; value: string }> }>;
  }): Promise<AcpSessionNewResult> {
    const raw = await this.request('session/new', {
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
    }, this.requestTimeoutMs, 'session');
    return readSessionResult(raw, 'session/new');
  }

  /** ACP `session/resume`（必须同时给 sessionId 与 cwd）。 */
  async resumeSession(params: {
    sessionId: string;
    cwd: string;
    mcpServers?: Array<{ name: string; type: 'http'; url: string; headers?: Array<{ name: string; value: string }> }>;
  }): Promise<{ configOptions?: AcpConfigOption[] }> {
    const raw = await this.request('session/resume', {
      sessionId: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
    }, this.requestTimeoutMs, 'session');
    if (raw === null || typeof raw !== 'object') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'session', 'session/resume 返回非对象', { retryable: false });
    }
    return raw as { configOptions?: AcpConfigOption[] };
  }

  /** ACP `session/list`（健康判据与恢复证据使用）。 */
  async listSessions(params: { cwd?: string } = {}): Promise<{ sessions: Array<{ sessionId: string; cwd: string }> }> {
    const raw = await this.request('session/list', params.cwd === undefined ? {} : { cwd: params.cwd }, this.requestTimeoutMs, 'session');
    if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as { sessions?: unknown }).sessions)) {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'session', 'session/list 缺少 sessions 数组', { retryable: false });
    }
    return raw as { sessions: Array<{ sessionId: string; cwd: string }> };
  }

  /** ACP `session/close`。注意：close 只结束会话，**不停止进程**。 */
  async closeSession(sessionId: string): Promise<void> {
    await this.request('session/close', { sessionId }, this.requestTimeoutMs, 'session');
  }

  /**
   * ACP `session/prompt`（一轮）。文本提示词走 text content block。
   * 取消：调用 `cancel(sessionId)`，服务端以 `stopReason: 'cancelled'` 结束本轮。
   * @error RUN_TIMEOUT / SIDECAR_SESSION_LOST
   */
  async prompt(params: { sessionId: string; text: string; timeoutMs?: number }): Promise<AcpPromptResult> {
    const raw = await this.request('session/prompt', {
      sessionId: params.sessionId,
      prompt: [{ type: 'text', text: params.text }],
    }, params.timeoutMs ?? this.requestTimeoutMs, 'run');
    if (raw === null || typeof raw !== 'object' || typeof (raw as { stopReason?: unknown }).stopReason !== 'string') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'run', 'session/prompt 缺少 stopReason', { retryable: false });
    }
    return raw as AcpPromptResult;
  }

  /** ACP `session/cancel`（notification，无响应）。 */
  cancel(sessionId: string): void {
    this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
  }

  /** 关闭传输（是否有真实进程由 transport 决定）。 */
  dispose(): void {
    this.transport.close();
  }

  /** 当前传输是否已关闭（用于区分「进程退出」与「协议错误」）。 */
  get closeReason(): string | null {
    return this.closedReason;
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private send(message: AcpMessage): void {
    if (this.closedReason !== null) {
      throw new DshError('SIDECAR_SESSION_LOST', 'session', `ACP 连接已关闭: ${this.closedReason}`, { retryable: true });
    }
    this.onProtocolEvent?.({ direction: 'out', method: message.method, id: message.id });
    this.transport.write(message);
  }

  private request(method: string, params: unknown, timeoutMs: number, phase: 'initialize' | 'session' | 'run' | 'tool'): Promise<unknown> {
    const id = this.nextId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = phase === 'initialize'
          ? new DshError('SIDECAR_START_TIMEOUT', 'initialize', `ACP ${method} 超时（${timeoutMs}ms）`, { retryable: true })
          : phase === 'run'
            ? new DshError('RUN_TIMEOUT', 'run', `ACP ${method} 超时（${timeoutMs}ms）`, { retryable: true })
            : new DshError('SIDECAR_PROTOCOL_ERROR', phase, `ACP ${method} 超时（${timeoutMs}ms）`, { retryable: true });
        reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, phase });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof DshError ? err : new DshError('SIDECAR_SESSION_LOST', phase, String(err), { retryable: true }));
      }
    });
  }

  private handleMessage(raw: unknown): void {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
    const message = raw as AcpMessage;
    this.onProtocolEvent?.({ direction: 'in', method: message.method, id: message.id });

    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(Number(message.id));
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      this.pending.delete(Number(message.id));
      if (message.error !== undefined) {
        pending.reject(fromAcpRpcError(message.error, pending.phase === 'initialize' ? 'initialize' : pending.phase));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && typeof message.method === 'string') {
      void this.answerServerRequest(message).catch(() => {
        // 连接在应答前关闭：服务端请求不再有接收方，由 exit/close 事件统一报会话丢失。
      });
      return;
    }

    if (typeof message.method === 'string') {
      if (message.method === 'session/update') {
        const params = message.params as Partial<AcpSessionUpdate> | undefined;
        if (params !== undefined && typeof params.sessionId === 'string' && params.update !== undefined) {
          for (const handler of this.notificationHandlers) handler(params as AcpSessionUpdate);
        }
      }
    }
  }

  /** 服务端→客户端请求：审批按策略应答；其余方法显式 -32601（不静默忽略）。 */
  private async answerServerRequest(message: AcpMessage): Promise<void> {
    const id = message.id;
    if (message.method === 'session/request_permission') {
      const params = (message.params ?? {}) as Partial<AcpPermissionRequest>;
      const request: AcpPermissionRequest = {
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
        toolCall: params.toolCall,
        options: params.options,
      };
      let decision: AcpPermissionDecision;
      try {
        decision = await this.decidePermission(request);
      } catch {
        decision = { cancelled: true };
      }
      const result = 'cancelled' in decision
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: decision.optionId } };
      this.send({ jsonrpc: '2.0', id, result });
      return;
    }
    this.send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `方法未实现: ${String(message.method)}` },
    });
  }

  private handleClose(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DshError('SIDECAR_SESSION_LOST', pending.phase === 'initialize' ? 'initialize' : 'session',
        `ACP 连接关闭: ${reason}`, { retryable: true }));
      this.pending.delete(id);
    }
    this.pendingClose?.(reason);
  }

  /** 进程退出后等待关闭（sidecar 生命周期用）。 */
  whenClosed(): Promise<string> {
    if (this.closedReason !== null) return Promise.resolve(this.closedReason);
    return new Promise<string>(resolve => { this.pendingClose = resolve; });
  }
}

/** 读取 session 返回结果（new 必须有 sessionId）。 */
function readSessionResult(raw: unknown, method: string): AcpSessionNewResult {
  if (raw === null || typeof raw !== 'object') {
    throw new DshError('SIDECAR_PROTOCOL_ERROR', 'session', `${method} 返回非对象`, { retryable: false });
  }
  const sessionId = (raw as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new DshError('SIDECAR_PROTOCOL_ERROR', 'session', `${method} 缺少 sessionId`, { retryable: false });
  }
  return raw as AcpSessionNewResult;
}

/**
 * 子进程 stdio 传输：ACP 用 newline-delimited JSON，stdout 纯协议、stderr 是日志。
 * @input  child（已带 pipe 的 stdio）
 * @output AcpTransport（close 只关 stdin，不杀进程）
 */
function createProcessTransport(child: ChildProcessWithoutNullStreams): AcpTransport {
  let buffer = '';
  const messageHandlers: Array<(message: unknown) => void> = [];
  const closeHandlers: Array<(reason: string) => void> = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '').trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (err: unknown) {
          closeHandlers.forEach(handler => handler(`非法 JSON 行: ${String(err)}`));
          return;
        }
        messageHandlers.forEach(handler => handler(parsed));
      }
      newline = buffer.indexOf('\n');
    }
  });

  child.on('exit', (code, signal) => {
    const reason = `进程退出 code=${String(code)} signal=${String(signal)}`;
    closeHandlers.forEach(handler => handler(reason));
  });
  child.on('error', err => {
    closeHandlers.forEach(handler => handler(`进程错误: ${err.message}`));
  });
  child.stdin.on('error', () => {
    // stdin 在子进程退出后写会 EPIPE；由 exit 事件统一报会话丢失。
  });

  return {
    write(message: unknown): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    onMessage(handler: (message: unknown) => void): void {
      messageHandlers.push(handler);
    },
    onClose(handler: (reason: string) => void): void {
      closeHandlers.push(handler);
    },
    close(): void {
      child.stdin.end();
    },
  };
}

/**
 * 启动 ACP 子进程并返回客户端 + 进程句柄。
 * @input  command/args/cwd/env（由 profile.ts 生成）
 * @output {client, child}
 * @error  SIDECAR_SPAWN_FAILED（spawn 同步失败）
 */
export function spawnAcpProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  clientOptions?: AcpClientOptions;
  onStderr?: (line: string) => void;
  onStdoutRaw?: (line: string) => void;
}): { client: AcpClient; child: ChildProcessWithoutNullStreams } {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err: unknown) {
    throw new DshError('SIDECAR_SPAWN_FAILED', 'spawn', `无法启动 ACP 子进程: ${String(err)}`, {
      retryable: true,
      cause: err,
    });
  }

  if (options.onStderr !== undefined) {
    child.stderr.setEncoding('utf8');
    let stderrBuffer = '';
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      let newline = stderrBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = stderrBuffer.slice(0, newline);
        stderrBuffer = stderrBuffer.slice(newline + 1);
        if (line.length > 0) options.onStderr?.(line);
        newline = stderrBuffer.indexOf('\n');
      }
    });
  }

  const transport = createProcessTransport(child);
  const client = new AcpClient(transport, options.clientOptions);
  return { client, child };
}
