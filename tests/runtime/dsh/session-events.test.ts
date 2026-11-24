/**
 * T2 验收：会话/事件/失败可见（RunManager 单元层，fake ACP）。
 *
 * 覆盖：正常、工具事件、模型失败、超时、取消、断流、空数据（显式 empty）、恢复（resume）、
 * runId 幂等、close ≠ stop process。所有断言基于 AgentEvent 序列与状态，不看实现内部字段。
 */
import { describe, expect, it } from 'vitest';
import { DshError } from '../../../src/runtime/dsh/errors';
import type { AgentEvent, AgentEventType } from '../../../src/runtime/dsh/events';
import {
  DshRunManager,
  type AcpClientLike,
  type McpServerSpec,
  type RunRecord,
} from '../../../src/runtime/dsh/session';
import type {
  AcpConfigOption,
  AcpInitializeResult,
  AcpPromptResult,
  AcpSessionNewResult,
  AcpSessionUpdate,
} from '../../../src/runtime/dsh/acp-client';

type FakeMode = 'ok' | 'tool' | 'fail' | 'hang' | 'cancel' | 'empty' | 'break' | 'refuse';

/** 内存 fake ACP：语义按 mode 决定，绝不发真实模型请求。 */
class FakeAcp implements AcpClientLike {
  readonly promptTexts: string[] = [];
  readonly cancelledSessions: string[] = [];
  readonly closedSessions: string[] = [];
  readonly resumedSessions: string[] = [];
  readonly receivedMcpServers: Array<McpServerSpec[] | undefined> = [];
  initializations = 0;
  disposed = false;
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private resolvePending: ((result: AcpPromptResult) => void) | null = null;
  private readonly mode: FakeMode;
  private sessionCounter = 0;

  constructor(mode: FakeMode) {
    this.mode = mode;
  }

  async initialize(): Promise<AcpInitializeResult> {
    this.initializations += 1;
    return {
      protocolVersion: 1,
      agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
      agentCapabilities: { mcpCapabilities: { http: true } },
    };
  }

  async newSession(params: { cwd: string; mcpServers?: McpServerSpec[] }): Promise<AcpSessionNewResult> {
    this.sessionCounter += 1;
    this.receivedMcpServers.push(params.mcpServers);
    return { sessionId: `sess-${this.sessionCounter}`, configOptions: [] as AcpConfigOption[] };
  }

  async resumeSession(params: { sessionId: string; cwd: string; mcpServers?: McpServerSpec[] }): Promise<{ configOptions?: AcpConfigOption[] }> {
    this.resumedSessions.push(params.sessionId);
    this.receivedMcpServers.push(params.mcpServers);
    return { configOptions: [] };
  }

  async closeSession(sessionId: string): Promise<void> {
    this.closedSessions.push(sessionId);
  }

  async prompt(params: { sessionId: string; text: string }): Promise<AcpPromptResult> {
    this.promptTexts.push(params.text);
    this.emit(params.sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
    if (this.mode === 'hang') {
      return new Promise<AcpPromptResult>(() => { /* 永不解决：由 cancel/超时路径结束 */ });
    }
    if (this.mode === 'cancel') {
      return new Promise<AcpPromptResult>(resolvePending => { this.resolvePending = resolvePending; });
    }
    if (this.mode === 'fail') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'run', 'fake model failure', { retryable: false });
    }
    if (this.mode === 'break') {
      throw new DshError('SIDECAR_SESSION_LOST', 'session', 'fake connection lost', { retryable: true });
    }
    if (this.mode === 'empty') {
      return { stopReason: 'end_turn' };
    }
    if (this.mode === 'refuse') {
      return { stopReason: 'refusal' };
    }
    this.emit(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
    if (this.mode === 'tool') {
      this.emit(params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'synova.context.get', status: 'in_progress' });
      this.emit(params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' });
    }
    return { stopReason: 'end_turn' };
  }

  cancel(sessionId: string): void {
    this.cancelledSessions.push(sessionId);
    if (this.resolvePending !== null) {
      const resolvePending = this.resolvePending;
      this.resolvePending = null;
      resolvePending({ stopReason: 'cancelled' });
    }
  }

  onSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void {
    this.handler = handler;
    return () => { this.handler = null; };
  }

  dispose(): void {
    this.disposed = true;
  }

  /** 模拟 DSH 侧通知（session/update）。 */
  emit(sessionId: string, update: Record<string, unknown> & { sessionUpdate: string }): void {
    this.handler?.({ sessionId, update });
  }
}

function makeManager(fake: FakeAcp, runTimeoutMs = 5_000): DshRunManager {
  return new DshRunManager({
    instanceDir: process.cwd(),
    createClient: () => fake,
    runTimeoutMs,
  });
}

/** 等待终态事件（轮询 snapshot，最多 3s）。 */
async function waitTerminal(record: RunRecord, timeoutMs = 3_000): Promise<AgentEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const terminal = record.stream.terminal;
    if (terminal !== null) return terminal;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  throw new Error(`run ${record.runId} 未在 ${timeoutMs}ms 内进入终态`);
}

function typesOf(record: RunRecord): AgentEventType[] {
  return record.stream.snapshot().map(event => event.type);
}

const baseRequest = {
  runId: 'run_00000000000000000000000000000001',
  enterpriseId: 'ent-1',
  userId: 'user-1',
  scope: 'admin',
  input: '今年增长卡在哪里？',
};

describe('T2 RunManager 事件与失败路径（fake ACP）', () => {
  it('正常路径：run.started → session.created → egress.recorded → text.delta → hypothesis.invalid → run.completed', async () => {
    const fake = new FakeAcp('ok');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_ok_0001' });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.stopReason).toBe('end_turn');
    expect(terminal.data.empty).toBe(false);
    // #1459 T-C：新增假设事件 ⇒ 序列「扩展」而非放宽——fake 返回的 'answer' 不是 JSON，
    // 因此必须落在 hypothesis.invalid（而非静默不发）。
    expect(typesOf(record)).toEqual([
      'run.started',
      'session.created',
      'egress.recorded',
      'reasoning.delta',
      'text.delta',
      'hypothesis.invalid',
      'run.completed',
    ]);
    expect(record.stats.textDeltas).toBe(1);
    expect(record.stats.chars).toBe('answer'.length);
    expect(fake.initializations).toBe(1);
    expect(fake.promptTexts).toEqual([baseRequest.input]);
  });

  it('工具事件：tool.started → tool.finished 映射并计数', async () => {
    const fake = new FakeAcp('tool');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_tool_0001' });
    await waitTerminal(record);
    expect(typesOf(record)).toContain('tool.started');
    expect(typesOf(record)).toContain('tool.finished');
    expect(record.stats.toolCalls).toBe(1);
  });

  it('模型失败：run.failed 带稳定 code/phase/retryable（不空成功）', async () => {
    const fake = new FakeAcp('fail');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_fail_0001' });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.code).toBe('SIDECAR_PROTOCOL_ERROR');
    expect(terminal.data.phase).toBe('run');
    expect(terminal.data.retryable).toBe(false);
    expect(record.status).toBe('failed');
  });

  it('断流：连接丢失 ⇒ run.failed SIDECAR_SESSION_LOST（retryable=true）', async () => {
    const fake = new FakeAcp('break');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_break_0001' });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.code).toBe('SIDECAR_SESSION_LOST');
    expect(terminal.data.retryable).toBe(true);
  });

  it('超时：未在 runTimeoutMs 结束 ⇒ run.failed RUN_TIMEOUT，并主动 cancel 该轮', async () => {
    const fake = new FakeAcp('hang');
    const manager = makeManager(fake, 300);
    const record = await manager.run({ ...baseRequest, runId: 'run_timeout_0001' });
    const terminal = await waitTerminal(record, 2_000);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.code).toBe('RUN_TIMEOUT');
    expect(terminal.data.retryable).toBe(true);
    expect(fake.cancelledSessions).toContain(record.sessionId);
  });

  it('取消：cancel(runId) ⇒ run.cancelled，且事件序列在取消后不再新增 text.delta', async () => {
    const fake = new FakeAcp('cancel');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_cancel_0001' });
    await new Promise(resolveDelay => setTimeout(resolveDelay, 30));
    const cancelled = await manager.cancel(record.runId);
    expect(cancelled.cancelRequested).toBe(true);
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.cancelled');
    expect(record.status).toBe('cancelled');
    expect(fake.cancelledSessions).toContain(record.sessionId);
    expect(typesOf(record)).not.toContain('text.delta');
  });

  it('空数据：没有文本/工具时 run.completed 显式 empty=true（零对象不算成功）', async () => {
    const fake = new FakeAcp('empty');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_empty_0001' });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.empty).toBe(true);
    expect(record.stats.textDeltas).toBe(0);
  });

  it('拒绝回答：stopReason=refusal ⇒ run.failed（不伪装成完成）', async () => {
    const fake = new FakeAcp('refuse');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_refuse_0001' });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.code).toBe('RUN_FAILED');
  });

  it('恢复：带 sessionId 时走 session/resume，事件含 session.resumed', async () => {
    const fake = new FakeAcp('ok');
    const manager = makeManager(fake);
    const record = await manager.run({ ...baseRequest, runId: 'run_resume_0001', sessionId: 'sess-existing' });
    await waitTerminal(record);
    expect(fake.resumedSessions).toEqual(['sess-existing']);
    expect(typesOf(record)).toContain('session.resumed');
    expect(record.sessionId).toBe('sess-existing');
    expect(record.sessionCreated).toBe(false);
  });

  it('runId 幂等：同 runId 重试返回同一记录且只发一次 prompt', async () => {
    const fake = new FakeAcp('ok');
    const manager = makeManager(fake);
    const first = await manager.run({ ...baseRequest, runId: 'run_idem_0001' });
    await waitTerminal(first);
    const second = await manager.run({ ...baseRequest, runId: 'run_idem_0001' });
    expect(second).toBe(first);
    expect(fake.promptTexts).toHaveLength(1);
    expect(second.status).toBe('completed');
  });

  it('close ≠ stop process：关闭会话后 Sidecar 仍可开新会话继续运行', async () => {
    const fake = new FakeAcp('ok');
    const manager = makeManager(fake);
    const first = await manager.run({ ...baseRequest, runId: 'run_close_0001' });
    await waitTerminal(first);
    const sessionId = first.sessionId;
    expect(sessionId).not.toBeNull();
    if (sessionId === null) throw new Error('sessionId 缺失');
    await manager.closeSession(sessionId);
    expect(fake.closedSessions).toEqual([sessionId]);
    expect(fake.disposed).toBe(false);

    const second = await manager.run({ ...baseRequest, runId: 'run_close_0002' });
    await waitTerminal(second);
    expect(second.status).toBe('completed');
    expect(second.sessionId).not.toBe(sessionId);
  });

  it('未知 runId 取消 ⇒ RUN_NOT_FOUND（稳定错误）', async () => {
    const fake = new FakeAcp('ok');
    const manager = makeManager(fake);
    await expect(manager.cancel('run_missing_0001')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', retryable: false });
  });
});
