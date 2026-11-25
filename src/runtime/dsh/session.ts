/**
 * src/runtime/dsh/session.ts — Synova API ↔ ACP 的**薄会话/运行适配**。
 *
 * 责任边界（1A 明确不做的事）：
 *   · 只做 createSession / runTurn / cancelRun / closeSession 的映射；
 *   · 不实现领域工具、不实现审批策略、不把 DSH 会话当事实/权限/决策账本；
 *   · 模型/工具循环、上下文与恢复由 DSH 负责；Synova 保留身份、权限、证据与结果权威。
 *
 * 契约（铁律 47）:
 *   @input   createClient（注入 ACP 客户端工厂：生产=真实子进程，测试=fake）＋ runTimeoutMs
 *   @output  RunRecord {runId, sessionId, status, stream(AgentEvent), stats,
 *            transportStatus／outcomeStatus（#1502 的两个正交状态位）}
 *   @degraded 无：任何失败都落 run.failed/run.cancelled 事件（带 code/phase/retryable），不空成功；
 *            领域工具结果不可读 ⇒ onDiagnostic('DOMAIN_CONTEXT_UNREADABLE')，上下文按未观察处理
 *   @error   身份/输入由路由校验；运行期错误转事件，不向 SSE 外抛
 */
import {
  AgentEventStream,
  contentDigest,
  type AgentEvent,
  type RunOutcomeStatus,
  type RunTransportStatus,
} from './events';
import { parseHypothesis, truncateHypothesisText } from './hypothesis-adapter';
import { DshError, isDshError, toDshError } from './errors';
import type {
  AcpClientOptions,
  AcpConfigOption,
  AcpInitializeResult,
  AcpPromptResult,
  AcpSessionNewResult,
  AcpSessionUpdate,
} from './acp-client';
import { spawnAcpProcess } from './acp-client';
import {
  assertSidecarProfile,
  buildDshInvocation,
  defaultProfileDir,
  installSidecarProfile,
  loadSidecarProfile,
  SIDECAR_PROFILE_NAME,
} from './profile';
import { defaultDshHome, defaultInstanceDir } from './sidecar';
import {
  assertInstalledDshVersion,
  defaultInstallDir,
  resolveExpectedDshVersion,
} from './pinned-version';

/** ACP 会话可挂载的 MCP 服务器（回环 HTTP MCP 由 T3 注入）。 */
export interface McpServerSpec {
  name: string;
  type: 'http';
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

/**
 * 会话层依赖的 ACP 形状。生产实现 = `AcpClient`；测试实现 = 内存 fake。
 * 只声明本层真正调用的方法（不复制 ACP 全量协议）。
 */
export interface AcpClientLike {
  initialize(): Promise<AcpInitializeResult>;
  newSession(params: { cwd: string; mcpServers?: McpServerSpec[] }): Promise<AcpSessionNewResult>;
  resumeSession(params: { sessionId: string; cwd: string; mcpServers?: McpServerSpec[] }): Promise<{ configOptions?: AcpConfigOption[] }>;
  closeSession(sessionId: string): Promise<void>;
  prompt(params: { sessionId: string; text: string; timeoutMs?: number }): Promise<AcpPromptResult>;
  cancel(sessionId: string): void;
  onSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void;
  dispose(): void;
}

/** 一轮运行的入参（身份由服务端注入，模型/工具参数不得携带）。 */
export interface RunRequest {
  runId: string;
  enterpriseId: string;
  userId: string;
  scope: string;
  input: string;
  /** 已存在的 ACP 会话（恢复路径）；缺省时新建。 */
  sessionId?: string;
  /**
   * #1486 裁定 e：**显式问题根**（本企业 ② 对象的 `businessKey` 或 `$id`），由调用方给定，
   * 经 `ToolCallContext` 直达 `synova_context_get`（工具侧优先使用它）。
   *
   * @invariant 只作**结构化入参**流动：不得拼进 `input`/发给模型的 prompt 文本
   *            （#1459 M2 实证：让模型猜 problemId ⇒ 10 条全空 + 750k tokens）
   * @not-here 本层不解析/不校验该对象是否存在（解析在 `domain-context.ts`，不存在 ⇒ `DOMAIN_EMPTY`）
   */
  problemId?: string;
}

/** 运行状态。 */
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 运行统计（防「零对象成功」：终态必须能报出可核对的计数）。 */
export interface RunStats {
  textDeltas: number;
  reasoningDeltas: number;
  toolCalls: number;
  chars: number;
}

/** 终态事件种类（判定输入的终态来源；运行中不调用判定函数）。 */
export type TerminalEventType = 'run.completed' | 'run.failed' | 'run.cancelled';

/**
 * 终态判定的**事实摘要**：全部是可观察的计数／枚举，不含自由文本。
 * 由 `DshRunManager` 从本 run 的事件流与终态路径整理后传入纯函数（I/O 与判定分离）。
 */
export interface TerminalRunFacts {
  /** 终态事件种类。 */
  terminal: TerminalEventType;
  /** ACP `stopReason`（run.completed／refusal 路径可观察；其余为 null）。 */
  stopReason: string | null;
  /** run.failed 的稳定错误码（其它终态为 null）。 */
  failureCode: string | null;
  /** 本轮模型文本增量条数（与 `stats.textDeltas` 同源）。 */
  textDeltas: number;
  /** 成功的工具结果数（`tool.finished` 且 status=completed）。 */
  toolSuccesses: number;
  /** 失败的工具结果数（`tool.finished` 且 status=failed ⇒ isError=true）。 */
  toolFailures: number;
  /** 模型文本校验结果：structured／invalid／none（无文本不发假设事件 ⇒ none）。 */
  hypothesis: 'structured' | 'invalid' | 'none';
  /** 领域上下文 `count`；null ⇒ **未观察**（工具未调用或结果不可读），不是 0。 */
  domainContextCount: number | null;
  /** 领域上下文显式标记不足（工具返回 `insufficient` 字段）。 */
  domainContextInsufficient: boolean;
}

/** 终态两字段（终态事件载荷与 run 查询共用同一份判定结果）。 */
export interface RunStatusBits {
  transportStatus: Exclude<RunTransportStatus, 'running'>;
  outcomeStatus: RunOutcomeStatus;
}

/** 超时/断连类错误码：传输位落 `disconnected`（其余失败是「流已收尾」）。 */
const DISCONNECTED_CODES: readonly string[] = [
  'RUN_TIMEOUT',
  'SIDECAR_SESSION_LOST',
  'SIDECAR_NOT_RUNNING',
  'SIDECAR_SPAWN_FAILED',
  'SIDECAR_START_TIMEOUT',
];

/**
 * 判定一轮 run 终态的**两个正交状态位**（纯函数：输入事件摘要 → 两字段）。
 *
 * #1502 根因修复：B4（工具 failed 却显示「运行完成」）与 B5（DOMAIN_EMPTY 被包装成假设）
 * 都是因为「传输结束」被当成「业务成功」。本函数把两件事拆成两个字段，UI 只消费、不推导。
 *
 * 契约（铁律 47）:
 *   @input  facts —— 终态事实摘要：terminal/stopReason/failureCode 来自终态路径；
 *           textDeltas/toolSuccesses/toolFailures/hypothesis 来自本 run 事件流；
 *           domainContextCount/insufficient 来自领域工具结果里**可读出的** ContextSnapshot
 *   @output RunStatusBits {transportStatus, outcomeStatus}：传输位与业务位各自独立取值，
 *           任何一方都不由另一方推导（禁止用一个字段表达两件事）
 *   @degraded 无：本函数不抛错也不吞错；事实缺项按「未观察」处理（domainContextCount=null），
 *            且**不默认 success**——结构化假设但上下文未获证实 ⇒ insufficient_data（fail-closed）
 *   @authority 判定优先级由本函数单点钉死：
 *            failed > partial > insufficient_data > invalid_output > no_output > success；
 *            调用方不得覆盖、不得补默认值
 *   @not-here 不发事件、不读 I/O、不解析假设文本（假设判定在 hypothesis-adapter）、
 *            不解释事件类型名、不判权限
 *   @error  无抛出：输入是纯值，结果恒落在固定枚举内
 */
export function deriveRunStatuses(facts: TerminalRunFacts): RunStatusBits {
  return {
    transportStatus: deriveTransportStatus(facts),
    outcomeStatus: deriveOutcomeStatus(facts),
  };
}

/** 传输位：取消 ⇒ cancelled；超时/断连类失败 ⇒ disconnected；其余 ⇒ stream_ended。 */
function deriveTransportStatus(facts: TerminalRunFacts): RunStatusBits['transportStatus'] {
  if (facts.terminal === 'run.cancelled') return 'cancelled';
  if (facts.terminal === 'run.failed' && facts.failureCode !== null && DISCONNECTED_CODES.includes(facts.failureCode)) {
    return 'disconnected';
  }
  return 'stream_ended';
}

/**
 * 业务位：按票面优先级逐条判定（高→低）。
 * 顺序即优先级，**不得重排**：任一高优先级事实成立就不再往下看。
 */
function deriveOutcomeStatus(facts: TerminalRunFacts): RunOutcomeStatus {
  const hasText = facts.textDeltas > 0;
  const hasToolProduct = facts.toolSuccesses > 0;
  const hasProduct = hasText || hasToolProduct;
  const contextEmpty = facts.domainContextInsufficient || facts.domainContextCount === 0;
  const contextPositive = facts.domainContextCount !== null && facts.domainContextCount > 0;

  // ① failed：拒绝回答 / 终态失败且无产物 / 工具失败且无产物
  if (facts.stopReason === 'refusal') return 'failed';
  if (facts.terminal === 'run.failed' && !hasProduct) return 'failed';
  if (facts.toolFailures > 0 && !hasProduct) return 'failed';

  // ② partial：有产物但不圆满（工具失败／运行失败／被取消，且已产出东西）
  if (facts.toolFailures > 0 && hasProduct) return 'partial';
  if (facts.terminal === 'run.failed' && hasProduct) return 'partial';
  if (facts.terminal === 'run.cancelled' && hasProduct) return 'partial';

  // ③ insufficient_data：域上下文显式为 0/不足（优先级高于 success），
  //    或结构化假设已产出但上下文**未获证实**（未观察 ≠ 有数据）
  if (contextEmpty) return 'insufficient_data';
  if (facts.hypothesis === 'structured' && !contextPositive) return 'insufficient_data';

  // ④ invalid_output：假设不合格且有文本
  if (facts.hypothesis === 'invalid' && hasText) return 'invalid_output';

  // ⑤ no_output：无文本且无工具产物
  if (!hasText && !hasToolProduct) return 'no_output';

  // ⑥ success：结构化假设成立且域上下文 count>0（唯一判成功的路径）
  if (facts.hypothesis === 'structured' && contextPositive) return 'success';

  // 兜底：有工具产物但无模型文本/假设（有产出未完整）⇒ partial，绝不判 success
  return 'partial';
}

/** 一次运行的完整记录（内存；1A 不建第二套持久账本）。 */
export interface RunRecord {
  runId: string;
  enterpriseId: string;
  userId: string;
  scope: string;
  sessionId: string | null;
  sessionCreated: boolean;
  status: RunStatus;
  cancelRequested: boolean;
  stats: RunStats;
  /**
   * 传输状态位（正交状态位 1，`events.ts` 定义）。运行中 = `running`；
   * 终态由 `deriveRunStatuses` 一次性判定，之后不再变化。
   */
  transportStatus: RunTransportStatus;
  /**
   * 业务结果位（正交状态位 2）。运行中 = `null`（未判定，**不是 success**）；
   * 终态必非 null，且与终态事件载荷里的同名字段逐字一致。
   */
  outcomeStatus: RunOutcomeStatus | null;
  stream: AgentEventStream;
}

/**
 * run 级判定事实（**不进 `stats`**：stats 是既有公开契约，改它会破坏存量消费方）。
 * 只记录本 run 可观察到的工具结果与领域上下文快照。
 */
interface RunObservation {
  toolSuccesses: number;
  toolFailures: number;
  domainContextCount: number | null;
  domainContextInsufficient: boolean;
  /** toolCallId → tool.started 的 title（用于认出领域工具，不猜别的工具的产物）。 */
  readonly toolTitles: Map<string, string | null>;
}

/** RunManager 依赖。 */
export interface DshRunManagerOptions {
  instanceDir: string;
  createClient: () => AcpClientLike;
  /** 单轮超时（缺省 120s）。 */
  runTimeoutMs?: number;
  /** 首轮前挂载到 ACP 会话的 MCP 服务器（T3 注入回环 HTTP MCP）。 */
  mcpServersFor?: (request: RunRequest) => McpServerSpec[];
  /** 诊断回调（不写 stdout）。 */
  onDiagnostic?: (event: { code?: string; message: string }) => void;
}

/**
 * 运行管理器：懒初始化 ACP 客户端，按 runId 幂等，事件落 AgentEventStream。
 * 线程模型：Node 单线程；同一客户端上的多个 run 串行由 ACP 服务端负责，
 * 本层只保证「同 runId 不重复发起 prompt」。
 */
export class DshRunManager {
  private readonly options: DshRunManagerOptions;
  private readonly runTimeoutMs: number;
  private readonly runs = new Map<string, RunRecord>();
  /** runId → 判定事实（工具结果/领域上下文）；随 run 创建，与 runs 同生命周期。 */
  private readonly observations = new Map<string, RunObservation>();
  private client: AcpClientLike | null = null;
  private initialized = false;
  private unsubscribeUpdates: (() => void) | null = null;
  private mcpProvider: ((request: RunRequest) => McpServerSpec[]) | null = null;

  constructor(options: DshRunManagerOptions) {
    this.options = options;
    this.runTimeoutMs = options.runTimeoutMs ?? 120_000;
  }

  /** 查询一次运行（路由 status/SSE 用）。 */
  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  /** 设置按 run 的 MCP 服务器提供者（路由在回环 MCP 就绪后调用；缺省不挂 MCP）。 */
  setMcpServersProvider(provider: ((request: RunRequest) => McpServerSpec[]) | null): void {
    this.mcpProvider = provider;
  }

  /** 全部运行快照（路由做归属校验用；1A 无跨进程全量查询需求）。 */
  listRuns(): RunRecord[] {
    return [...this.runs.values()];
  }

  /**
   * 发起一轮运行（幂等：同 runId 已存在 ⇒ 返回原记录，不重复 prompt）。
   *
   * #1486 裁定 e：`request.problemId` **只**进 `run.started` 事件（可证）与 MCP token 上下文，
   * **不拼进** `client.prompt` 的文本（模型文本 = `request.input` 逐字）。
   *
   * 契约（铁律 47）:
   *   @input  request —— RunRequest（身份/输入由路由校验；`problemId` 可选、结构化）
   *   @output 运行记录（status=running；终态由事件流推进；同 runId 幂等返回既有记录）
   *   @degraded 无：执行失败落 `run.failed`/`run.cancelled` 事件（带 code/phase/retryable），不空成功
   *   @authority 身份字段由服务端注入（模型/工具参数不得携带）；problemId 不改变 prompt 文本
   *   @not-here 不解析 problemId 指向的对象、不校验企业归属（工具侧 `domain-context` 负责）
   *   @error  不抛：运行期错误转事件（`run.failed`）
   */
  async run(request: RunRequest): Promise<RunRecord> {
    const existing = this.runs.get(request.runId);
    if (existing !== undefined) return existing;

    const record: RunRecord = {
      runId: request.runId,
      enterpriseId: request.enterpriseId,
      userId: request.userId,
      scope: request.scope,
      sessionId: request.sessionId ?? null,
      sessionCreated: false,
      status: 'running',
      cancelRequested: false,
      stats: { textDeltas: 0, reasoningDeltas: 0, toolCalls: 0, chars: 0 },
      // 正交两字段：传输位＝运行中；业务位＝未判定（null，**不预填 success**）
      transportStatus: 'running',
      outcomeStatus: null,
      stream: new AgentEventStream(request.runId),
    };
    this.observations.set(request.runId, {
      toolSuccesses: 0,
      toolFailures: 0,
      domainContextCount: null,
      domainContextInsufficient: false,
      toolTitles: new Map<string, string | null>(),
    });
    this.runs.set(request.runId, record);
    record.stream.append('run.started', {
      runId: request.runId,
      enterpriseId: request.enterpriseId,
      userId: request.userId,
      scope: request.scope,
      sessionId: record.sessionId,
      // #1486 e：显式问题根的**可证入口**（事件可观察；prompt 文本不含它）
      problemId: request.problemId ?? null,
    });
    void this.execute(record, request);
    return record;
  }

  /**
   * 取消一轮运行。取消只作用于该 run 对应的 ACP 会话轮次，**不停止 Sidecar 进程**。
   * @error RUN_NOT_FOUND（未知 runId）
   */
  async cancel(runId: string): Promise<RunRecord> {
    const record = this.runs.get(runId);
    if (record === undefined) {
      throw new DshError('RUN_NOT_FOUND', 'run', `未知 runId: ${runId}`, { retryable: false });
    }
    if (record.status !== 'running') return record;
    record.cancelRequested = true;
    if (record.sessionId !== null) {
      this.ensureClientSync()?.cancel(record.sessionId);
    } else {
      this.finishCancelled(record);
    }
    return record;
  }

  /**
   * 关闭一个 ACP 会话。**close ≠ stop process**：关闭后 Sidecar 仍可用新会话继续服务。
   * @error SESSION_NOT_FOUND / SIDECAR_NOT_RUNNING
   */
  async closeSession(sessionId: string): Promise<void> {
    const client = this.ensureClientSync();
    if (client === null) {
      throw new DshError('SIDECAR_NOT_RUNNING', 'session', 'Sidecar 未启动，无法关闭会话', { retryable: false });
    }
    try {
      await client.closeSession(sessionId);
    } catch (err: unknown) {
      const error = toDshError(err, { code: 'SESSION_NOT_FOUND', phase: 'session' });
      throw error;
    }
  }

  /** 关闭底层 ACP 客户端（不负责杀进程：进程生命周期归 sidecar.ts）。 */
  async dispose(): Promise<void> {
    if (this.unsubscribeUpdates !== null) this.unsubscribeUpdates();
    this.unsubscribeUpdates = null;
    if (this.client !== null) this.client.dispose();
    this.client = null;
    this.initialized = false;
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private ensureClientSync(): AcpClientLike | null {
    return this.client;
  }

  private async ensureClient(): Promise<AcpClientLike> {
    if (this.client === null) {
      this.client = this.options.createClient();
      this.unsubscribeUpdates = this.client.onSessionUpdate(update => this.handleUpdate(update));
    }
    if (!this.initialized) {
      const initialized = await this.client.initialize();
      if (initialized.agentInfo.name !== 'deepseek-harness-acp') {
        throw new DshError(
          'SIDECAR_PROTOCOL_ERROR',
          'initialize',
          `initialize agentInfo.name=${initialized.agentInfo.name}，期望 deepseek-harness-acp`,
          { retryable: false },
        );
      }
      this.initialized = true;
    }
    return this.client;
  }

  private async execute(record: RunRecord, request: RunRequest): Promise<void> {
    let client: AcpClientLike | null = null;
    try {
      client = await this.ensureClient();
      const mcpServers = this.mcpProvider?.(request) ?? this.options.mcpServersFor?.(request);
      if (record.sessionId === null) {
        const created = await client.newSession({ cwd: this.options.instanceDir, mcpServers });
        record.sessionId = created.sessionId;
        record.sessionCreated = true;
        record.stream.append('session.created', { sessionId: created.sessionId });
      } else {
        await client.resumeSession({ sessionId: record.sessionId, cwd: this.options.instanceDir, mcpServers });
        record.stream.append('session.resumed', { sessionId: record.sessionId });
      }

      if (record.cancelRequested) {
        this.finishCancelled(record);
        return;
      }

      const digest = contentDigest(request.input);
      record.stream.append('egress.recorded', {
        purpose: 'run.prompt',
        destination: 'dsh-acp',
        sha256: digest.sha256,
        chars: digest.chars,
      });

      const promptResult = await this.withTimeout(
        client.prompt({ sessionId: record.sessionId, text: request.input, timeoutMs: this.runTimeoutMs }),
      );
      this.finishFromStopReason(record, promptResult);
    } catch (err: unknown) {
      const error = isDshError(err) ? err : toDshError(err, { code: 'RUN_FAILED', phase: 'run' });
      if (error.code === 'RUN_TIMEOUT' && client !== null && record.sessionId !== null) {
        // 超时后主动取消该轮，避免服务端继续跑一个已无意义的长任务。
        try { client.cancel(record.sessionId); } catch { /* 连接已断：由 run.failed 事件暴露 */ }
      }
      this.finishFailed(record, error);
    }
  }

  /** 本地兜底超时：即使客户端未实现 timeoutMs，也必须给出 RUN_TIMEOUT。 */
  private async withTimeout(promise: Promise<AcpPromptResult>): Promise<AcpPromptResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new DshError('RUN_TIMEOUT', 'run', `run 超过 ${this.runTimeoutMs}ms 未结束`, { retryable: true }));
        }, this.runTimeoutMs);
        timer.unref?.();
      });
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * #1459 T-C：把本轮模型文本校验成结构化假设并按结果发事件。
   * 文本为空 ⇒ 不发事件（本轮没尝试出假设），但通过 onDiagnostic 留可见记录，不静默丢。
   *
   * @output 本轮假设判定结果（structured／invalid／none）——供终态判定使用，不另存一份状态
   */
  private emitHypothesis(record: RunRecord): 'structured' | 'invalid' | 'none' {
    const turnText = record.stream
      .snapshot()
      .filter((event) => event.type === 'text.delta')
      .map((event) => (typeof event.data.text === 'string' ? event.data.text : ''))
      .join('');

    if (turnText.trim() === '') {
      this.options.onDiagnostic?.({
        code: 'HYPOTHESIS_SKIPPED_EMPTY_TURN',
        message: 'run 无模型文本（未尝试产出假设），不发 hypothesis 事件',
      });
      return 'none';
    }

    const parsed = parseHypothesis(turnText);
    if (parsed.ok) {
      record.stream.append('hypothesis.structured', { ...parsed.payload });
      return 'structured';
    }
    const truncated = truncateHypothesisText(turnText);
    record.stream.append('hypothesis.invalid', {
      reason: { ...parsed.reason },
      text: truncated.text,
      truncated: truncated.truncated,
    });
    return 'invalid';
  }

  private finishFromStopReason(record: RunRecord, result: AcpPromptResult): void {
    if (result.stopReason === 'cancelled') {
      this.finishCancelled(record);
      return;
    }
    if (result.stopReason === 'refusal') {
      this.finishFailed(
        record,
        new DshError('RUN_FAILED', 'run', '模型拒绝回答（stopReason=refusal）', { retryable: false }),
        'refusal',
      );
      return;
    }
    record.status = 'completed';
    // #1459 T-C：在 run.completed 之前把这一轮的模型文本校验成结构化假设。
    // run ≡ 一轮（每次 run 只 prompt 一次）⇒ 直接聚合 text.delta 即无损重建。
    const hypothesis = this.emitHypothesis(record);
    // #1502：两字段先算后发，事件载荷与 run 记录共用同一次判定（不许两处各算一套）。
    const bits = this.applyTerminalStatus(record, {
      terminal: 'run.completed',
      stopReason: result.stopReason,
      failureCode: null,
      hypothesis,
    });
    record.stream.append('run.completed', {
      stopReason: result.stopReason,
      stats: record.stats,
      empty: record.stats.textDeltas === 0 && record.stats.toolCalls === 0,
      ...bits,
    });
  }

  private finishCancelled(record: RunRecord): void {
    if (record.status !== 'running') return;
    record.status = 'cancelled';
    const bits = this.applyTerminalStatus(record, {
      terminal: 'run.cancelled',
      stopReason: null,
      failureCode: null,
      hypothesis: 'none',
    });
    record.stream.append('run.cancelled', { reason: 'client cancel', ...bits });
  }

  private finishFailed(record: RunRecord, err: unknown, stopReason: string | null = null): void {
    if (record.status !== 'running') return;
    const error = isDshError(err)
      ? err
      : toDshError(err, { code: 'RUN_FAILED', phase: 'run' });
    record.status = 'failed';
    const bits = this.applyTerminalStatus(record, {
      terminal: 'run.failed',
      stopReason,
      failureCode: error.code,
      hypothesis: 'none',
    });
    record.stream.append('run.failed', { ...error.toPayload(), ...bits });
    this.options.onDiagnostic?.({ code: error.code, message: error.message });
  }

  /**
   * 终态一次性判定：把本 run 的**可观察事实**交给纯函数 `deriveRunStatuses`，
   * 结果同时写入 run 记录与调用方（供终态事件载荷）。判定只做一次，之后不再重算。
   */
  private applyTerminalStatus(
    record: RunRecord,
    facts: Pick<TerminalRunFacts, 'terminal' | 'stopReason' | 'failureCode' | 'hypothesis'>,
  ): RunStatusBits {
    const observation = this.observations.get(record.runId);
    const bits = deriveRunStatuses({
      terminal: facts.terminal,
      stopReason: facts.stopReason,
      failureCode: facts.failureCode,
      textDeltas: record.stats.textDeltas,
      toolSuccesses: observation?.toolSuccesses ?? 0,
      toolFailures: observation?.toolFailures ?? 0,
      hypothesis: facts.hypothesis,
      domainContextCount: observation?.domainContextCount ?? null,
      domainContextInsufficient: observation?.domainContextInsufficient ?? false,
    });
    record.transportStatus = bits.transportStatus;
    record.outcomeStatus = bits.outcomeStatus;
    return bits;
  }

  private handleUpdate(update: AcpSessionUpdate): void {
    for (const record of this.runs.values()) {
      if (record.sessionId !== update.sessionId || record.status !== 'running') continue;
      const payload = update.update;
      if (payload.sessionUpdate === 'agent_message_chunk') {
        const text = readText(payload.content);
        if (text !== null) {
          record.stats.textDeltas += 1;
          record.stats.chars += text.length;
          record.stream.append('text.delta', { text });
        }
        continue;
      }
      if (payload.sessionUpdate === 'agent_thought_chunk') {
        const text = readText(payload.content);
        if (text !== null) {
          record.stats.reasoningDeltas += 1;
          record.stream.append('reasoning.delta', { text });
        }
        continue;
      }
      if (payload.sessionUpdate === 'tool_call') {
        record.stats.toolCalls += 1;
        const toolCallId = readString(payload.toolCallId);
        if (toolCallId !== null) {
          // 记住工具名：只有领域工具的结果才据以判定上下文 count（不拿别的工具产物凑数）
          this.observations.get(record.runId)?.toolTitles.set(toolCallId, readString(payload.title));
        }
        record.stream.append('tool.started', {
          toolCallId,
          title: readString(payload.title),
          kind: readString(payload.kind),
          status: readString(payload.status),
        });
        continue;
      }
      if (payload.sessionUpdate === 'tool_call_update') {
        const toolCallId = readString(payload.toolCallId);
        const status = readString(payload.status);
        record.stream.append('tool.finished', {
          toolCallId,
          status,
          isError: status === 'failed',
        });
        this.recordToolResult(record, toolCallId, status, payload);
      }
    }
  }

  /**
   * 记录一次工具结果（判定事实，不进 stats / 不新增事件）。
   * · `status` 非 completed/failed 的中间态 ⇒ 不算一次工具产物（不提前计成功）；
   * · 只有**领域工具**（`synova_context_get`）的结果才解析 ContextSnapshot 的 count/insufficient；
   * · 解析不出来 ⇒ 上下文按「未观察」处理并发诊断（不猜、不默认 success）。
   */
  private recordToolResult(
    record: RunRecord,
    toolCallId: string | null,
    status: string | null,
    payload: { sessionUpdate: string; [key: string]: unknown },
  ): void {
    const observation = this.observations.get(record.runId);
    if (observation === undefined) return;
    if (status === 'failed') {
      observation.toolFailures += 1;
      return;
    }
    if (status !== 'completed') return;
    observation.toolSuccesses += 1;
    if (toolCallId === null) return;
    if (!isDomainContextToolTitle(observation.toolTitles.get(toolCallId) ?? null)) return;
    const text = readToolResultText(payload.content) ?? readToolResultText(payload.rawOutput);
    const snapshot = text === null ? null : readContextSnapshot(text);
    if (snapshot === null) {
      this.options.onDiagnostic?.({
        code: 'DOMAIN_CONTEXT_UNREADABLE',
        message: `run ${record.runId} 的领域工具结果不可读，无法确认上下文 count（不按成功处理）`,
      });
      return;
    }
    observation.domainContextCount = snapshot.count;
    observation.domainContextInsufficient = snapshot.insufficient;
  }
}

/** 从 ACP content block 里取文本（不认识的形状返回 null，不猜）。 */
function readText(content: unknown): string | null {
  if (content === null || typeof content !== 'object') return null;
  const text = (content as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}

/** 从 update 字段里安全取字符串。 */
function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 是否是领域上下文工具（`synova_context_get`；容忍 `synova.context.get` 这类分隔符写法）。
 * 只用于「要不要解析该工具结果里的 count」，认不出 ⇒ 不解析（不猜别的工具的产物）。
 */
function isDomainContextToolTitle(title: string | null): boolean {
  if (title === null) return false;
  const flattened = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  return flattened.includes('synovacontextget') || flattened.includes('contextget');
}

/**
 * 取工具结果里的文本（ACP `ToolCallContent[]`：`{type:'content', content:{type:'text', text}}`，
 * 兼容直接文本块与 `rawOutput` 字符串）。取不到 ⇒ null（不猜）。
 */
function readToolResultText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const block = item as { type?: unknown; content?: unknown; text?: unknown };
    if (block.type === 'content') {
      const inner = block.content;
      if (inner !== null && typeof inner === 'object') {
        const text = (inner as { text?: unknown }).text;
        if (typeof text === 'string') parts.push(text);
      }
      continue;
    }
    if (typeof block.text === 'string') parts.push(block.text);
  }
  return parts.length === 0 ? null : parts.join('');
}

/**
 * 从工具结果文本里读出 `ContextSnapshot` 的 `count` 与 `insufficient`。
 * 只认领域快照形状（`synthetic===false` ＋ 数值 `count` ＋ `items` 数组），
 * 形状不符／JSON 截断 ⇒ null（**未观察**，不是 count=0）。
 */
function readContextSnapshot(text: string): { count: number; insufficient: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const snapshot = parsed as Record<string, unknown>;
  if (snapshot.synthetic !== false) return null;
  if (!Array.isArray(snapshot.items)) return null;
  const count = snapshot.count;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
  return {
    count,
    insufficient: snapshot.insufficient !== undefined && snapshot.insufficient !== null,
  };
}

/**
 * 生产用默认 RunManager：固定版本 dsh Sidecar（profile 四件装到 per-instance DSH_HOME）。
 * 失败（安装目录缺失/profile 不合规）在首次 run 时以 typed error 出现在 run.failed，
 * 不会让进程启动失败。
 */
export function createDefaultDshRunManager(overrides: {
  dshHome?: string;
  instanceDir?: string;
  installDir?: string;
  profileDir?: string;
  runTimeoutMs?: number;
  mcpServersFor?: DshRunManagerOptions['mcpServersFor'];
} = {}): DshRunManager {
  const envDshHome = process.env.SYNOVA_DSH_HOME ?? overrides.dshHome;
  const envInstanceDir = process.env.SYNOVA_DSH_INSTANCE_DIR ?? overrides.instanceDir;
  const profileDir = overrides.profileDir ?? defaultProfileDir();
  const instanceDir = envInstanceDir ?? defaultInstanceDir();
  const dshHome = envDshHome ?? defaultDshHome();
  // 生产会话只锁 PINNED_DSH_VERSION：不接受、不传播 expected-version（rc.1 回退只在 start.ps1 显式路径）。
  // 安装目录与 buildDshInvocation 同值（含版本）；版本不符即 DSH_VERSION_MISMATCH，不 spawn。
  const installDir = process.env.SYNOVA_DSH_INSTALL_DIR ?? overrides.installDir ?? defaultInstallDir();
  const expectedVersion = resolveExpectedDshVersion();

  const createClient = (): AcpClientLike => {
    assertInstalledDshVersion(expectedVersion.version, installDir);
    const profile = loadSidecarProfile(profileDir);
    assertSidecarProfile(profile);
    installSidecarProfile({ profileDir, dshHome });
    const invocation = buildDshInvocation({ installDir, dshHome });
    const clientOptions: AcpClientOptions = {
      initializeTimeoutMs: 60_000,
      decidePermission: () => ({ optionId: 'reject-once' }),
    };
    const spawned = spawnAcpProcess({
      command: invocation.command,
      args: invocation.args,
      cwd: instanceDir,
      env: invocation.env,
      clientOptions,
    });
    return spawned.client;
  };

  return new DshRunManager({
    instanceDir,
    createClient,
    runTimeoutMs: overrides.runTimeoutMs ?? (process.env.SYNOVA_DSH_RUN_TIMEOUT_MS === undefined
      ? 120_000
      : Number(process.env.SYNOVA_DSH_RUN_TIMEOUT_MS)),
    mcpServersFor: overrides.mcpServersFor,
  });
}
