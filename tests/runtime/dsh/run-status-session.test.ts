/**
 * tests/runtime/dsh/run-status-session.test.ts — #1502 六种情形 + 传输位（会话层，fake ACP）。
 *
 * 配对对象：`src/runtime/dsh/session.ts`（终态判定与事件载荷）
 * 覆盖：success／partial／failed／insufficient_data／invalid_output／no_output 六情形；
 *      取消／拒绝／超时／断连的传输位；运行中 = running/null（不预填 success）；
 *      兼容证明：stopReason／stats／empty 原样保留，事件类型集合未新增。
 */
import { describe, expect, it } from 'vitest';
import type {
  AcpConfigOption,
  AcpInitializeResult,
  AcpPromptResult,
  AcpSessionNewResult,
  AcpSessionUpdate,
} from '../../../src/runtime/dsh/acp-client';
import { DshError } from '../../../src/runtime/dsh/errors';
import type { AgentEvent } from '../../../src/runtime/dsh/events';
import {
  DshRunManager,
  type AcpClientLike,
  type McpServerSpec,
  type RunRecord,
} from '../../../src/runtime/dsh/session';

/** 合格的结构化假设文本（四要素齐全，能被 hypothesis-adapter 接受）。 */
const STRUCTURED_TEXT = JSON.stringify({
  hypothesis: '交付批次卡在交付团队产能',
  objects: ['team:delivery-a'],
  relations: ['edge/team_executes_activity'],
  evidence: ['delivery_batches.csv#L2'],
  uncertainty: ['③ 观测未接入'],
});

/** 领域快照（形状与 `domain-context.ts` 的 ContextSnapshot 一致）。 */
function snapshot(count: number, insufficient = false): Record<string, unknown> {
  const items = Array.from({ length: count }, (_, index) => ({
    layer: '②',
    $id: `team:delivery-${String(index)}`,
    period: '2026-11',
    defVersion: 'v1',
  }));
  const base: Record<string, unknown> = { synthetic: false, problemId: 'team:delivery-a', count, truncated: false, items };
  if (insufficient) base.insufficient = { code: 'INSUFFICIENT_CONTEXT', reason: '根对象没有任何 1 跳关系', missing: ['neighbors'] };
  return base;
}

/** 一轮脚本：按顺序发文本/工具事件，最后给 stopReason。 */
interface Script {
  text?: string;
  tool?: { status: 'completed' | 'failed'; title?: string; resultText?: string };
  stopReason?: string;
}

type Behavior = 'normal' | 'hang' | 'throw-disconnect';

/** 内存 fake ACP：只按脚本发 session/update，不读凭据、不外发。 */
class ScriptedAcp implements AcpClientLike {
  readonly promptTexts: string[] = [];
  readonly cancelledSessions: string[] = [];
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private resolvePending: ((result: AcpPromptResult) => void) | null = null;
  private counter = 0;

  constructor(
    private readonly script: Script,
    private readonly behavior: Behavior = 'normal',
  ) {}

  async initialize(): Promise<AcpInitializeResult> {
    return { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } };
  }

  async newSession(_params: { cwd: string; mcpServers?: McpServerSpec[] }): Promise<AcpSessionNewResult> {
    this.counter += 1;
    return { sessionId: `sess-${String(this.counter)}`, configOptions: [] as AcpConfigOption[] };
  }

  async resumeSession(params: { sessionId: string }): Promise<{ configOptions?: AcpConfigOption[] }> {
    return { sessionId: params.sessionId, configOptions: [] };
  }

  async closeSession(_sessionId: string): Promise<void> {
    /* fake：无底层连接 */
  }

  async prompt(params: { sessionId: string; text: string }): Promise<AcpPromptResult> {
    this.promptTexts.push(params.text);
    if (this.behavior === 'throw-disconnect') {
      throw new DshError('SIDECAR_SESSION_LOST', 'session', 'fake connection lost', { retryable: true });
    }
    if (this.behavior === 'hang') {
      return new Promise<AcpPromptResult>(resolvePending => { this.resolvePending = resolvePending; });
    }
    if (this.script.text !== undefined) {
      this.emit(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: this.script.text } });
    }
    if (this.script.tool !== undefined) {
      const toolCallId = 'call-1';
      this.emit(params.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: this.script.tool.title ?? 'synova_context_get',
        kind: 'other',
        status: 'in_progress',
      });
      const content = this.script.tool.resultText === undefined
        ? []
        : [{ type: 'content', content: { type: 'text', text: this.script.tool.resultText } }];
      this.emit(params.sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: this.script.tool.status,
        content,
      });
    }
    return { stopReason: this.script.stopReason ?? 'end_turn' };
  }

  cancel(sessionId: string): void {
    this.cancelledSessions.push(sessionId);
    const resolvePending = this.resolvePending;
    this.resolvePending = null;
    resolvePending?.({ stopReason: 'cancelled' });
  }

  onSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void {
    this.handler = handler;
    return () => { this.handler = null; };
  }

  dispose(): void {
    /* fake：无底层连接 */
  }

  private emit(sessionId: string, update: Record<string, unknown> & { sessionUpdate: string }): void {
    this.handler?.({ sessionId, update });
  }
}

const BASE = {
  runId: 'run_status_0001',
  enterpriseId: 'ent-1',
  userId: 'user-1',
  scope: 'admin',
  input: '今年增长卡在哪里？',
};

async function waitTerminal(record: RunRecord, timeoutMs = 3_000): Promise<AgentEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const terminal = record.stream.terminal;
    if (terminal !== null) return terminal;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  throw new Error(`run ${record.runId} 未在 ${timeoutMs}ms 内进入终态`);
}

async function runScript(script: Script, behavior: Behavior = 'normal', runTimeoutMs = 5_000): Promise<RunRecord> {
  const fake = new ScriptedAcp(script, behavior);
  const manager = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs });
  const record = await manager.run({ ...BASE, runId: `run_status_${String(Math.random()).slice(2, 10)}` });
  await waitTerminal(record);
  return record;
}

describe('#1502 六种情形（会话层：终态事件载荷 + run 记录）', () => {
  it('success：结构化假设 + 域上下文 count>0', async () => {
    const record = await runScript({ text: STRUCTURED_TEXT, tool: { status: 'completed', resultText: JSON.stringify(snapshot(2)) } });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.transportStatus).toBe('stream_ended');
    expect(terminal.data.outcomeStatus).toBe('success');
    // 事件载荷与 run 记录同源（一次判定，不两处各算）
    expect(record.transportStatus).toBe('stream_ended');
    expect(record.outcomeStatus).toBe('success');
    expect(record.stream.snapshot().map(event => event.type)).toContain('hypothesis.structured');
  });

  it('partial：工具失败但有产物', async () => {
    const record = await runScript({ text: 'answer', tool: { status: 'failed', resultText: 'DOMAIN_EMPTY: 解析不到 problemId' } });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.outcomeStatus).toBe('partial');
    expect(terminal.data.transportStatus).toBe('stream_ended');
  });

  it('failed：工具失败且无有效产物', async () => {
    const record = await runScript({ tool: { status: 'failed', resultText: 'DOMAIN_EMPTY: 解析不到 problemId' } });
    const terminal = await waitTerminal(record);
    expect(terminal.data.outcomeStatus).toBe('failed');
    expect(terminal.data.empty).toBe(false); // 工具被调用过 ⇒ 不是「空运行」，但业务失败
  });

  it('insufficient_data：域上下文 insufficient/count=0（优先级高于 success）', async () => {
    const record = await runScript({
      text: STRUCTURED_TEXT,
      tool: { status: 'completed', resultText: JSON.stringify(snapshot(0, true)) },
    });
    const terminal = await waitTerminal(record);
    expect(terminal.data.outcomeStatus).toBe('insufficient_data');
    expect(terminal.data.outcomeStatus).not.toBe('success');
  });

  it('invalid_output：假设不合格且文本非空', async () => {
    const record = await runScript({ text: 'answer', tool: { status: 'completed', resultText: JSON.stringify(snapshot(1)) } });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.outcomeStatus).toBe('invalid_output');
    expect(record.stream.snapshot().map(event => event.type)).toContain('hypothesis.invalid');
  });

  it('no_output：无文本且无工具产物', async () => {
    const record = await runScript({});
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.outcomeStatus).toBe('no_output');
    expect(terminal.data.empty).toBe(true);
  });
});

describe('#1502 传输位：取消／拒绝／超时／断连／运行中', () => {
  it('取消：transportStatus=cancelled，outcome 不得为 success', async () => {
    const fake = new ScriptedAcp({ text: STRUCTURED_TEXT, tool: { status: 'completed', resultText: JSON.stringify(snapshot(2)) } }, 'hang');
    const manager = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs: 5_000 });
    const record = await manager.run({ ...BASE, runId: 'run_status_cancel_0001' });
    await new Promise(resolveDelay => setTimeout(resolveDelay, 30));
    await manager.cancel(record.runId);
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.cancelled');
    expect(terminal.data.transportStatus).toBe('cancelled');
    expect(terminal.data.reason).toBe('client cancel');
    expect(terminal.data.outcomeStatus).not.toBe('success');
  });

  it('拒绝回答：stopReason=refusal ⇒ transportStatus=stream_ended ＋ outcomeStatus=failed', async () => {
    const record = await runScript({ text: STRUCTURED_TEXT, stopReason: 'refusal' });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.transportStatus).toBe('stream_ended');
    expect(terminal.data.outcomeStatus).toBe('failed');
  });

  it('超时：transportStatus=disconnected ＋ outcomeStatus=failed', async () => {
    const record = await runScript({}, 'hang', 200);
    const terminal = await waitTerminal(record, 2_000);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.code).toBe('RUN_TIMEOUT');
    expect(terminal.data.transportStatus).toBe('disconnected');
    expect(terminal.data.outcomeStatus).toBe('failed');
  });

  it('断连：SIDECAR_SESSION_LOST ⇒ transportStatus=disconnected', async () => {
    const record = await runScript({}, 'throw-disconnect');
    const terminal = await waitTerminal(record);
    expect(terminal.data.code).toBe('SIDECAR_SESSION_LOST');
    expect(terminal.data.transportStatus).toBe('disconnected');
  });

  it('运行中：transportStatus=running 且 outcomeStatus=null（不预填 success）', async () => {
    const fake = new ScriptedAcp({}, 'hang');
    const manager = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs: 5_000 });
    const record = await manager.run({ ...BASE, runId: 'run_status_running_0001' });
    expect(record.transportStatus).toBe('running');
    expect(record.outcomeStatus).toBeNull();
    await manager.cancel(record.runId);
    await waitTerminal(record);
  });
});

describe('#1502 兼容证明：stopReason／stats／empty 原样保留，事件类型不新增', () => {
  it('run.completed 载荷仍带 stopReason／stats／empty，且 stats 键集合不变', async () => {
    const record = await runScript({ text: STRUCTURED_TEXT, tool: { status: 'completed', resultText: JSON.stringify(snapshot(2)) } });
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.stopReason).toBe('end_turn');
    expect(terminal.data.empty).toBe(false);
    expect(terminal.data.stats).toEqual({
      textDeltas: 1,
      reasoningDeltas: 0,
      toolCalls: 1,
      chars: STRUCTURED_TEXT.length,
    });
    // stats 是既有公开契约：不因新增两字段而多键
    expect(Object.keys(record.stats)).toEqual(['textDeltas', 'reasoningDeltas', 'toolCalls', 'chars']);
    // 终态载荷＝既有三字段 + 新增两字段，无其它键
    expect(Object.keys(terminal.data).sort()).toEqual(
      ['empty', 'outcomeStatus', 'stats', 'stopReason', 'transportStatus'].sort(),
    );
  });

  it('run.failed 载荷仍带 code／phase／retryable／message，并追加两字段', async () => {
    const record = await runScript({}, 'throw-disconnect');
    const terminal = await waitTerminal(record);
    expect(terminal.type).toBe('run.failed');
    expect(terminal.data.code).toBe('SIDECAR_SESSION_LOST');
    expect(terminal.data.phase).toBe('session');
    expect(terminal.data.retryable).toBe(true);
    expect(typeof terminal.data.message).toBe('string');
    expect(terminal.data.transportStatus).toBe('disconnected');
    expect(terminal.data.outcomeStatus).toBe('failed');
  });

  it('事件类型集合未新增（只有既有类型出现）', async () => {
    const record = await runScript({ text: 'answer', tool: { status: 'completed', resultText: JSON.stringify(snapshot(1)) } });
    await waitTerminal(record);
    const allowed = new Set([
      'run.started',
      'session.created',
      'session.resumed',
      'text.delta',
      'reasoning.delta',
      'tool.started',
      'tool.finished',
      'egress.recorded',
      'run.completed',
      'run.failed',
      'run.cancelled',
      'hypothesis.structured',
      'hypothesis.invalid',
    ]);
    for (const event of record.stream.snapshot()) {
      expect(allowed.has(event.type), `未登记事件类型: ${event.type}`).toBe(true);
    }
  });

  it('领域工具结果不可读 ⇒ onDiagnostic 可见，且结构化假设不判 success', async () => {
    const diagnostics: string[] = [];
    const fake = new ScriptedAcp({
      text: STRUCTURED_TEXT,
      tool: { status: 'completed', resultText: '不是 JSON（模拟结果被截断）' },
    });
    const manager = new DshRunManager({
      instanceDir: process.cwd(),
      createClient: () => fake,
      runTimeoutMs: 5_000,
      onDiagnostic: event => { diagnostics.push(event.code ?? ''); },
    });
    const record = await manager.run({ ...BASE, runId: 'run_status_unreadable_0001' });
    const terminal = await waitTerminal(record);
    expect(diagnostics).toContain('DOMAIN_CONTEXT_UNREADABLE');
    expect(terminal.data.outcomeStatus).toBe('insufficient_data');
    expect(terminal.data.outcomeStatus).not.toBe('success');
  });

  it('非领域工具的 count 不被当作域上下文（不张冠李戴）', async () => {
    const record = await runScript({
      text: STRUCTURED_TEXT,
      tool: { status: 'completed', title: 'other_tool', resultText: JSON.stringify(snapshot(7)) },
    });
    const terminal = await waitTerminal(record);
    expect(terminal.data.outcomeStatus).toBe('insufficient_data');
  });
});
