/**
 * tests/runtime/dsh/run-status-route.integration.test.ts — #1502 真实入口回归（真实 Express 路由 ＋ 真实 HTTP）。
 *
 * 入口：`POST /api/dsh/runs` → `GET /api/dsh/runs/:runId/events`（SSE）→ `GET /api/dsh/runs/:runId`。
 * 断言：终态载荷含 transportStatus／outcomeStatus，且 **SSE 终态帧 / 查询快照 / 运行时记录三处逐字一致**
 *      （＝与这一轮 DSH 事件日志同源，不是第二套判定）。
 * 依赖注入 fake ACP（不读凭据、不外发、不 spawn 真实 dsh）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Request } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JwtPayload } from '../../../src/middleware/auth';
import { createDshRouter } from '../../../src/routes/dsh';
import { DshError } from '../../../src/runtime/dsh/errors';
import type { AcpSessionUpdate } from '../../../src/runtime/dsh/acp-client';
import { DshRunManager, type AcpClientLike } from '../../../src/runtime/dsh/session';

const STRUCTURED_TEXT = JSON.stringify({
  hypothesis: '交付批次卡在交付团队产能',
  objects: ['team:delivery-a'],
  relations: ['edge/team_executes_activity'],
  evidence: ['delivery_batches.csv#L2'],
  uncertainty: ['③ 观测未接入'],
});

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

interface Script {
  text?: string;
  tool?: { status: 'completed' | 'failed'; resultText?: string };
  stopReason?: string;
}

/** 内存 fake ACP（与 session 侧测试同形，单独维护避免跨文件依赖）。 */
class ScriptedAcp implements AcpClientLike {
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private resolvePending: ((result: { stopReason: string }) => void) | null = null;
  private counter = 0;

  constructor(
    private readonly script: Script,
    private readonly hang = false,
  ) {}

  async initialize() {
    return { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } };
  }
  async newSession() {
    this.counter += 1;
    return { sessionId: `sess-${String(this.counter)}`, configOptions: [] };
  }
  async resumeSession(params: { sessionId: string }) {
    return { sessionId: params.sessionId, configOptions: [] };
  }
  async closeSession(_sessionId: string) {
    /* fake：无底层连接 */
  }
  async prompt(params: { sessionId: string }): Promise<{ stopReason: string }> {
    if (this.hang) {
      return new Promise<{ stopReason: string }>(resolvePending => { this.resolvePending = resolvePending; });
    }
    if (this.script.text !== undefined) {
      this.emit(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: this.script.text } });
    }
    if (this.script.tool !== undefined) {
      this.emit(params.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'synova_context_get',
        kind: 'other',
        status: 'in_progress',
      });
      const content = this.script.tool.resultText === undefined
        ? []
        : [{ type: 'content', content: { type: 'text', text: this.script.tool.resultText } }];
      this.emit(params.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: this.script.tool.status, content });
    }
    return { stopReason: this.script.stopReason ?? 'end_turn' };
  }
  cancel(_sessionId: string): void {
    const resolvePending = this.resolvePending;
    this.resolvePending = null;
    resolvePending?.({ stopReason: 'cancelled' });
  }
  onSessionUpdate(handler: (update: AcpSessionUpdate) => void) {
    this.handler = handler;
    return () => { this.handler = null; };
  }
  dispose() {
    /* fake：无底层连接 */
  }
  private emit(sessionId: string, update: Record<string, unknown> & { sessionUpdate: string }) {
    this.handler?.({ sessionId, update });
  }
}

interface Harness {
  server: Server;
  baseUrl: string;
  runtime: DshRunManager;
}

async function startHarness(script: Script, hang = false): Promise<Harness> {
  const fake = new ScriptedAcp(script, hang);
  const runtime = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs: 5_000 });
  const app = express();
  app.use(express.json());
  // 模拟 jwtAuthMiddleware 的验签结果（生产由 src/server.ts 全局中间件注入 req.auth）
  app.use((req: Request, _res, next) => {
    const user = req.header('x-test-user');
    const org = req.header('x-test-org');
    if (typeof user === 'string' && typeof org === 'string') {
      (req as Request & { auth?: JwtPayload }).auth = { sub: user, orgId: org, role: 'admin', jti: 'test-jti' };
    }
    next();
  });
  app.use(createDshRouter({ runtime, heartbeatMs: 100, enableMcp: false }));
  const server = createServer(app);
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}`, runtime };
}

async function stopHarness(harness: Harness): Promise<void> {
  await harness.runtime.dispose();
  await new Promise<void>(resolveClose => harness.server.close(() => resolveClose()));
}

const AUTH = { 'x-test-user': 'user-1', 'x-test-org': 'ent-1', 'content-type': 'application/json' };

async function postRun(baseUrl: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/dsh/runs`, { method: 'POST', headers: AUTH, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

async function waitDone(baseUrl: string, runId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/dsh/runs/${runId}`, { headers: AUTH });
    const json = await response.json() as Record<string, unknown>;
    if (json.status !== 'running') return json;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
  }
  throw new Error(`run ${runId} 未在 5s 内结束`);
}

/** 读 SSE 到终态帧（或超时），返回事件序列。 */
async function readSseTerminal(baseUrl: string, runId: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/api/dsh/runs/${runId}/events`, { headers: AUTH, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('SSE 响应无 body');
    const decoder = new TextDecoder();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    let buffer = '';
    const terminal = new Set(['run.completed', 'run.failed', 'run.cancelled']);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const typeLine = frame.split('\n').find(line => line.startsWith('event: '));
        const dataLine = frame.split('\n').find(line => line.startsWith('data: '));
        if (typeLine !== undefined && dataLine !== undefined) {
          const envelope = JSON.parse(dataLine.slice('data: '.length)) as { type: string; data: Record<string, unknown> };
          events.push({ type: envelope.type, data: envelope.data });
        }
        boundary = buffer.indexOf('\n\n');
      }
      if (events.some(event => terminal.has(event.type))) {
        await reader.cancel();
        break;
      }
    }
    return events;
  } finally {
    clearTimeout(timer);
  }
}

describe('#1502 真实入口：POST /api/dsh/runs 的终态载荷含两字段', () => {
  let harness: Harness | null = null;

  afterAll(async () => {
    if (harness !== null) await stopHarness(harness);
  });

  it('success 一轮：POST 返回两字段 → 查询快照与 SSE 终态帧逐字一致', async () => {
    harness = await startHarness({ text: STRUCTURED_TEXT, tool: { status: 'completed', resultText: JSON.stringify(snapshot(2)) } });
    const created = await postRun(harness.baseUrl, { input: '增长卡在哪里？', runId: 'run_route_status_0001' });
    expect(created.status).toBe(202);
    // 发起即返回：两字段必须存在（运行中：running／null，不预填 success）
    expect(created.json.transportStatus).toBe('running');
    expect(created.json.outcomeStatus).toBeNull();

    const snapshotAfter = await waitDone(harness.baseUrl, 'run_route_status_0001');
    expect(snapshotAfter.status).toBe('completed');
    expect(snapshotAfter.transportStatus).toBe('stream_ended');
    expect(snapshotAfter.outcomeStatus).toBe('success');
    const terminal = snapshotAfter.terminal as { type: string; data: Record<string, unknown> };
    expect(terminal.type).toBe('run.completed');
    expect(terminal.data.transportStatus).toBe('stream_ended');
    expect(terminal.data.outcomeStatus).toBe('success');

    const events = await readSseTerminal(harness.baseUrl, 'run_route_status_0001');
    const sseTerminal = events.at(-1);
    expect(sseTerminal?.type).toBe('run.completed');
    // 三处一致：SSE 终态帧 == 查询快照的 terminal.data == 查询快照顶层字段
    expect(sseTerminal?.data.transportStatus).toBe(terminal.data.transportStatus);
    expect(sseTerminal?.data.outcomeStatus).toBe(terminal.data.outcomeStatus);
  });

  it('工具失败且无产物：真实入口终态 outcomeStatus=failed（B4 回归）', async () => {
    const failing = await startHarness({ tool: { status: 'failed', resultText: 'DOMAIN_EMPTY: 解析不到 problemId' } });
    try {
      const created = await postRun(failing.baseUrl, { input: 'boom', runId: 'run_route_status_0002' });
      expect(created.status).toBe(202);
      const done = await waitDone(failing.baseUrl, 'run_route_status_0002');
      expect(done.status).toBe('completed');
      expect(done.transportStatus).toBe('stream_ended');
      expect(done.outcomeStatus).toBe('failed');
    } finally {
      await stopHarness(failing);
    }
  });

  it('取消：真实入口返回 transportStatus=cancelled，且 outcomeStatus 不为 success', async () => {
    const hanging = await startHarness({}, true);
    try {
      const created = await postRun(hanging.baseUrl, { input: 'hang', runId: 'run_route_status_0003' });
      expect(created.status).toBe(202);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 30));
      const cancelled = await fetch(`${hanging.baseUrl}/api/dsh/runs/run_route_status_0003/cancel`, { method: 'POST', headers: AUTH });
      expect(cancelled.status).toBe(200);
      const done = await waitDone(hanging.baseUrl, 'run_route_status_0003');
      expect(done.status).toBe('cancelled');
      expect(done.transportStatus).toBe('cancelled');
      expect(done.outcomeStatus).not.toBe('success');
    } finally {
      await stopHarness(hanging);
    }
  });
});
