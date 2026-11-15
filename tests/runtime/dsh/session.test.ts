/**
 * tests/runtime/dsh/session.test.ts — DshRunManager 会话/运行适配单测（注入 fake ACP）。
 *
 * 配对对象：src/runtime/dsh/session.ts
 * 覆盖：create/resume/close 映射、事件推进、MCP provider 注入、失败终态、未知 runId。
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
import {
  DshRunManager,
  type AcpClientLike,
  type McpServerSpec,
  type RunRecord,
} from '../../../src/runtime/dsh/session';

class FakeAcp implements AcpClientLike {
  initializations = 0;
  disposed = false;
  readonly createdWithMcp: Array<McpServerSpec[] | undefined> = [];
  readonly resumed: string[] = [];
  readonly closed: string[] = [];
  readonly prompts: string[] = [];
  failPrompt = false;
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private counter = 0;

  async initialize(): Promise<AcpInitializeResult> {
    this.initializations += 1;
    return { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } };
  }

  async newSession(params: { cwd: string; mcpServers?: McpServerSpec[] }): Promise<AcpSessionNewResult> {
    this.counter += 1;
    this.createdWithMcp.push(params.mcpServers);
    return { sessionId: `sess-${this.counter}`, configOptions: [] as AcpConfigOption[] };
  }

  async resumeSession(params: { sessionId: string; mcpServers?: McpServerSpec[] }): Promise<{ configOptions?: AcpConfigOption[] }> {
    this.resumed.push(params.sessionId);
    this.createdWithMcp.push(params.mcpServers);
    return { configOptions: [] };
  }

  async closeSession(sessionId: string): Promise<void> {
    this.closed.push(sessionId);
  }

  async prompt(params: { sessionId: string; text: string }): Promise<AcpPromptResult> {
    this.prompts.push(params.text);
    if (this.failPrompt) throw new DshError('SIDECAR_PROTOCOL_ERROR', 'run', 'fake provider failure');
    this.emit(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
    return { stopReason: 'end_turn' };
  }

  cancel(): void { /* fake：无可取消轮次 */ }

  onSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void {
    this.handler = handler;
    return () => { this.handler = null; };
  }

  dispose(): void {
    this.disposed = true;
  }

  private emit(sessionId: string, update: Record<string, unknown> & { sessionUpdate: string }): void {
    this.handler?.({ sessionId, update });
  }
}

function makeManager(fake: FakeAcp, overrides: Partial<ConstructorParameters<typeof DshRunManager>[0]> = {}): DshRunManager {
  return new DshRunManager({
    instanceDir: process.cwd(),
    createClient: () => fake,
    runTimeoutMs: 2_000,
    ...overrides,
  });
}

const BASE = {
  runId: 'run_session_0001',
  enterpriseId: 'ent-1',
  userId: 'user-1',
  scope: 'admin',
  input: 'question',
};

async function waitTerminal(record: RunRecord): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (record.stream.terminal === null && Date.now() < deadline) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 5));
  }
  expect(record.stream.terminal).not.toBeNull();
}

describe('session: DshRunManager', () => {
  it('新会话：事件推进到 run.completed，且 MCP provider 注入 mcpServers', async () => {
    const fake = new FakeAcp();
    const manager = makeManager(fake);
    manager.setMcpServersProvider(() => [{ name: 'synova-sidecar', type: 'http', url: 'http://127.0.0.1:9/mcp' }]);

    const record = await manager.run(BASE);
    await waitTerminal(record);

    expect(record.status).toBe('completed');
    expect(record.sessionId).toBe('sess-1');
    expect(fake.initializations).toBe(1);
    expect(fake.prompts).toEqual(['question']);
    expect(fake.createdWithMcp[0]?.[0]?.name).toBe('synova-sidecar');
    const types = record.stream.snapshot().map(event => event.type);
    expect(types[0]).toBe('run.started');
    expect(types).toContain('session.created');
    expect(types).toContain('egress.recorded');
    expect(types.at(-1)).toBe('run.completed');
  });

  it('恢复会话：带 sessionId 走 resumeSession 并记 session.resumed', async () => {
    const fake = new FakeAcp();
    const manager = makeManager(fake);
    const record = await manager.run({ ...BASE, runId: 'run_session_0002', sessionId: 'sess-existing' });
    await waitTerminal(record);
    expect(fake.resumed).toEqual(['sess-existing']);
    expect(record.sessionCreated).toBe(false);
    expect(record.stream.snapshot().map(event => event.type)).toContain('session.resumed');
  });

  it('失败可见：prompt 抛错 ⇒ run.failed（code 保留）', async () => {
    const fake = new FakeAcp();
    fake.failPrompt = true;
    const manager = makeManager(fake);
    const record = await manager.run({ ...BASE, runId: 'run_session_0003' });
    await waitTerminal(record);
    expect(record.status).toBe('failed');
    expect(record.stream.terminal?.data.code).toBe('SIDECAR_PROTOCOL_ERROR');
  });

  it('closeSession/dispose：close ≠ stop，dispose 关闭客户端', async () => {
    const fake = new FakeAcp();
    const manager = makeManager(fake);
    const record = await manager.run({ ...BASE, runId: 'run_session_0005' });
    await waitTerminal(record);
    await manager.closeSession('sess-1');
    expect(fake.closed).toEqual(['sess-1']);
    expect(fake.disposed).toBe(false); // close ≠ stop
    await manager.dispose();
    expect(fake.disposed).toBe(true);
  });

  it('未知 runId 取消 ⇒ RUN_NOT_FOUND；同 runId 幂等不重复 prompt', async () => {
    const fake = new FakeAcp();
    const manager = makeManager(fake);
    await expect(manager.cancel('run_session_missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });

    const first = await manager.run({ ...BASE, runId: 'run_session_0004' });
    await waitTerminal(first);
    const second = await manager.run({ ...BASE, runId: 'run_session_0004' });
    expect(second).toBe(first);
    expect(fake.prompts).toHaveLength(1);
    expect(manager.listRuns()).toHaveLength(1);
  });
});
