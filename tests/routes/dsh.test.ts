/**
 * T2 真实入口验收：`POST /api/dsh/runs` → `GET /api/dsh/runs/:runId/events`（SSE）。
 *
 * 覆盖：401（无验签身份）、正常事件序列、输入校验、未知/跨企业 run、失败可见、
 * 取消、断流后重放、runId 幂等重试、close session ≠ 停进程。
 * 依赖注入 fake ACP（不读凭据、不外发、不 spawn 真实 dsh）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import type { JwtPayload } from '../../src/middleware/auth';
import { createDshRouter } from '../../src/routes/dsh';
import { DshError } from '../../src/runtime/dsh/errors';
import type { AcpSessionUpdate } from '../../src/runtime/dsh/acp-client';
import { DshRunManager, type AcpClientLike } from '../../src/runtime/dsh/session';

type FakeMode = 'ok' | 'fail' | 'hang';

/** 内存 fake ACP（与 session-events 测试同形，单独维护避免跨文件依赖）。 */
class FakeAcp implements AcpClientLike {
  promptTexts: string[] = [];
  cancelled: string[] = [];
  closed: string[] = [];
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private resolvePending: (() => void) | null = null;
  private counter = 0;
  constructor(private readonly mode: FakeMode) {}

  async initialize() {
    return { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } };
  }
  async newSession() {
    this.counter += 1;
    return { sessionId: `sess-${this.counter}`, configOptions: [] };
  }
  async resumeSession(params: { sessionId: string }) {
    return { sessionId: params.sessionId, configOptions: [] };
  }
  async closeSession(sessionId: string) {
    this.closed.push(sessionId);
  }
  async prompt(params: { sessionId: string; text: string }) {
    this.promptTexts.push(params.text);
    if (this.mode === 'fail') {
      throw new DshError('SIDECAR_PROTOCOL_ERROR', 'run', 'fake model failure', { retryable: false });
    }
    if (this.mode === 'hang') {
      return new Promise<{ stopReason: string }>(resolvePending => { this.resolvePending = () => resolvePending({ stopReason: 'cancelled' }); });
    }
    this.emit(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
    return { stopReason: 'end_turn' };
  }
  cancel(sessionId: string) {
    this.cancelled.push(sessionId);
    this.resolvePending?.();
    this.resolvePending = null;
  }
  onSessionUpdate(handler: (update: AcpSessionUpdate) => void) {
    this.handler = handler;
    return () => { this.handler = null; };
  }
  dispose() { /* fake：无底层连接 */ }
  private emit(sessionId: string, update: Record<string, unknown> & { sessionUpdate: string }) {
    this.handler?.({ sessionId, update });
  }
}

interface SseEvent {
  type: string;
  data: Record<string, unknown>;
  id: number;
}

const TERMINAL = new Set(['run.completed', 'run.failed', 'run.cancelled']);

let server: Server;
let baseUrl: string;
let runtime: DshRunManager;
let fake: FakeAcp;

beforeAll(async () => {
  fake = new FakeAcp('ok');
  runtime = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs: 5_000 });
  const app = express();
  app.use(express.json());
  // 模拟 jwtAuthMiddleware 的验签结果（生产由 src/server.ts 的全局中间件注入 req.auth）
  app.use((req, _res, next) => {
    const user = req.header('x-test-user');
    const org = req.header('x-test-org');
    if (typeof user === 'string' && typeof org === 'string') {
      (req as Request & { auth?: JwtPayload }).auth = {
        sub: user,
        orgId: org,
        role: 'admin',
        jti: 'test-jti',
      };
    }
    next();
  });
  app.use(createDshRouter({ runtime, heartbeatMs: 100, enableMcp: false }));
  server = createServer(app);
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await runtime.dispose();
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
});

const AUTH = { 'x-test-user': 'user-1', 'x-test-org': 'ent-1', 'content-type': 'application/json' };
const AUTH_OTHER_ORG = { 'x-test-user': 'user-2', 'x-test-org': 'ent-2', 'content-type': 'application/json' };

/** 读 SSE：收到终态即结束；`stopAfter` 用于断流用例（读到 N 条后主动断开）。 */
async function readSse(
  runId: string,
  headers: Record<string, string>,
  options: { stopAfter?: number; maxMs?: number } = {},
): Promise<{ status: number; events: SseEvent[]; raw: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.maxMs ?? 5_000);
  try {
    const response = await fetch(`${baseUrl}/api/dsh/runs/${runId}/events`, { headers, signal: controller.signal });
    if (response.status !== 200) {
      clearTimeout(timer);
      return { status: response.status, events: [], raw: await response.text() };
    }
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('SSE 响应无 body');
    const decoder = new TextDecoder();
    let raw = '';
    const events: SseEvent[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      let boundary = raw.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = raw.slice(0, boundary);
        raw = raw.slice(boundary + 2);
        const lines = frame.split('\n');
        const typeLine = lines.find(line => line.startsWith('event: '));
        const dataLine = lines.find(line => line.startsWith('data: '));
        const idLine = lines.find(line => line.startsWith('id: '));
        if (typeLine !== undefined && dataLine !== undefined) {
          events.push({
            type: typeLine.slice('event: '.length),
            data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
            id: idLine === undefined ? 0 : Number(idLine.slice('id: '.length)),
          });
        }
        boundary = raw.indexOf('\n\n');
      }
      if (options.stopAfter !== undefined && events.length >= options.stopAfter) {
        await reader.cancel();
        break;
      }
      if (events.some(event => TERMINAL.has(event.type))) {
        await reader.cancel();
        break;
      }
    }
    return { status: response.status, events, raw };
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') return { status: 0, events: [], raw: 'abort' };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function startRun(body: Record<string, unknown>, headers: Record<string, string> = AUTH): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/dsh/runs`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

async function waitDone(runId: string, headers = AUTH): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/dsh/runs/${runId}`, { headers });
    const json = await response.json() as Record<string, unknown>;
    if (json.status !== 'running') return json;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
  }
  throw new Error(`run ${runId} 未在 5s 内结束`);
}

describe('T2 路由：认证 + SSE 真实入口', () => {
  it('无验签身份 ⇒ 401 UNAUTHORIZED（POST/SSE/GET 三条路径一致）', async () => {
    const post = await fetch(`${baseUrl}/api/dsh/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'x' }) });
    expect(post.status).toBe(401);
    const postJson = await post.json() as Record<string, unknown>;
    expect(postJson.code).toBe('UNAUTHORIZED');

    const sse = await readSse('run_missing_0001', {});
    expect(sse.status).toBe(401);

    const status = await fetch(`${baseUrl}/api/dsh/runs/run_missing_0001`);
    expect(status.status).toBe(401);
  });

  it('正常一轮：POST 202 ⇒ SSE 事件序列完整且 run.completed（count>0）', async () => {
    const created = await startRun({ input: '增长卡在哪里？', runId: 'run_route_ok_0001' });
    expect(created.status).toBe(202);
    expect(created.json.ok).toBe(true);
    expect(created.json.runId).toBe('run_route_ok_0001');

    const sse = await readSse('run_route_ok_0001', AUTH);
    expect(sse.status).toBe(200);
    expect(sse.events.length).toBeGreaterThan(0);
    const types = sse.events.map(event => event.type);
    expect(types[0]).toBe('run.started');
    expect(types.includes('egress.recorded')).toBe(true);
    expect(types.includes('text.delta')).toBe(true);
    expect(types.at(-1)).toBe('run.completed');
    const completed = sse.events.at(-1);
    const completedPayload = (completed?.data ?? {}) as { data?: { stats?: unknown; empty?: unknown } };
    expect(completedPayload.data?.stats).toMatchObject({ textDeltas: 1 });
    expect(completedPayload.data?.empty).toBe(false);

    const snapshot = await waitDone('run_route_ok_0001');
    expect(snapshot.status).toBe('completed');
    expect(snapshot.eventCount).toBeGreaterThan(0);
  });

  it('输入校验：空 input ⇒ 400；非法 runId ⇒ 400（不静默降级）', async () => {
    const empty = await startRun({ input: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.json.code).toBe('VALIDATION_ERROR');

    const badId = await startRun({ input: 'x', runId: 'bad id!' });
    expect(badId.status).toBe(400);
    expect(badId.json.code).toBe('VALIDATION_ERROR');
  });

  it('未知 run 与跨企业 run ⇒ 404 RUN_NOT_FOUND（不泄露存在性）', async () => {
    const unknown = await fetch(`${baseUrl}/api/dsh/runs/run_no_such_0001`, { headers: AUTH });
    expect(unknown.status).toBe(404);
    expect((await unknown.json() as Record<string, unknown>).code).toBe('RUN_NOT_FOUND');

    await startRun({ input: 'org A only', runId: 'run_cross_org_0001' });
    const cross = await fetch(`${baseUrl}/api/dsh/runs/run_cross_org_0001`, { headers: AUTH_OTHER_ORG });
    expect(cross.status).toBe(404);
    expect((await cross.json() as Record<string, unknown>).code).toBe('RUN_NOT_FOUND');

    const crossSse = await readSse('run_cross_org_0001', AUTH_OTHER_ORG);
    expect(crossSse.status).toBe(404);
  });

  it('失败可见：SSE 终态 run.failed 带稳定 code/phase/retryable', async () => {
    const failing = new DshRunManager({
      instanceDir: process.cwd(),
      createClient: () => new FakeAcp('fail'),
      runTimeoutMs: 5_000,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { auth?: JwtPayload }).auth = { sub: 'u', orgId: 'ent-fail', role: 'admin', jti: 'j' };
      next();
    });
    app.use(createDshRouter({ runtime: failing, heartbeatMs: 100, enableMcp: false }));
    const failServer = createServer(app);
    await new Promise<void>(resolveListen => failServer.listen(0, '127.0.0.1', () => resolveListen()));
    const failAddress = failServer.address() as AddressInfo;
    try {
      const created = await fetch(`http://127.0.0.1:${failAddress.port}/api/dsh/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'boom', runId: 'run_route_fail_0001' }),
      });
      expect(created.status).toBe(202);
      const sse = await fetch(`http://127.0.0.1:${failAddress.port}/api/dsh/runs/run_route_fail_0001/events`);
      const text = await sse.text();
      expect(text).toContain('event: run.failed');
      expect(text).toContain('SIDECAR_PROTOCOL_ERROR');
      expect(text).toContain('"retryable":false');
    } finally {
      await failing.dispose();
      await new Promise<void>(resolveClose => failServer.close(() => resolveClose()));
    }
  });

  it('取消：POST cancel ⇒ SSE run.cancelled；Sidecar 仍可继续新 run', async () => {
    const cancelling = new DshRunManager({
      instanceDir: process.cwd(),
      createClient: () => new FakeAcp('hang'),
      runTimeoutMs: 30_000,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { auth?: JwtPayload }).auth = { sub: 'u', orgId: 'ent-cancel', role: 'admin', jti: 'j' };
      next();
    });
    app.use(createDshRouter({ runtime: cancelling, heartbeatMs: 100, enableMcp: false }));
    const cancelServer = createServer(app);
    await new Promise<void>(resolveListen => cancelServer.listen(0, '127.0.0.1', () => resolveListen()));
    const cancelAddress = cancelServer.address() as AddressInfo;
    const cancelBase = `http://127.0.0.1:${cancelAddress.port}`;
    try {
      const created = await fetch(`${cancelBase}/api/dsh/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'hang', runId: 'run_route_cancel_0001' }),
      });
      expect(created.status).toBe(202);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 30));
      const cancelled = await fetch(`${cancelBase}/api/dsh/runs/run_route_cancel_0001/cancel`, { method: 'POST' });
      expect(cancelled.status).toBe(200);
      expect((await cancelled.json() as Record<string, unknown>).cancelRequested).toBe(true);
      const sse = await fetch(`${cancelBase}/api/dsh/runs/run_route_cancel_0001/events`);
      const text = await sse.text();
      expect(text).toContain('event: run.cancelled');
      const snapshot = await fetch(`${cancelBase}/api/dsh/runs/run_route_cancel_0001`);
      expect((await snapshot.json() as Record<string, unknown>).status).toBe('cancelled');
    } finally {
      await cancelling.dispose();
      await new Promise<void>(resolveClose => cancelServer.close(() => resolveClose()));
    }
  });

  it('断流：读到首事件即断开，重连后拿到含终态的全量重放', async () => {
    await startRun({ input: 'slow replay', runId: 'run_route_replay_0001' });
    // 首连可能发生在 run 已结束之后：快照重放会一次写出全部事件（这正是重放语义）。
    // 这里断言"首帧一定是 run.started"，而不是断言只收到 1 条。
    const first = await readSse('run_route_replay_0001', AUTH, { stopAfter: 1 });
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.events[0].type).toBe('run.started');
    await waitDone('run_route_replay_0001');
    const replay = await readSse('run_route_replay_0001', AUTH);
    expect(replay.events.length).toBeGreaterThanOrEqual(first.events.length);
    expect(replay.events.at(-1)?.type).toBe('run.completed');
    expect(replay.events[0].id).toBe(1);
  });

  it('runId 幂等：同 runId 重试返回 200 replayed=true，不重复创建对象', async () => {
    const first = await startRun({ input: 'idem', runId: 'run_route_idem_0001' });
    expect(first.status).toBe(202);
    await waitDone('run_route_idem_0001');
    const second = await startRun({ input: 'idem', runId: 'run_route_idem_0001' });
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    const snapshot = await waitDone('run_route_idem_0001');
    expect(snapshot.eventCount).toBeGreaterThan(0);
  });

  it('close session ≠ 停进程：close 后新会话继续完成', async () => {
    const created = await startRun({ input: 'session-close', runId: 'run_route_close_0001' });
    expect(created.status).toBe(202);
    const done = await waitDone('run_route_close_0001');
    const sessionId = String(done.sessionId);
    expect(sessionId.length).toBeGreaterThan(0);
    const closed = await fetch(`${baseUrl}/api/dsh/sessions/${sessionId}/close`, { method: 'POST', headers: AUTH });
    expect(closed.status).toBe(200);
    expect(fake.closed).toContain(sessionId);

    const next = await startRun({ input: 'after close', runId: 'run_route_close_0002' });
    expect(next.status).toBe(202);
    const nextDone = await waitDone('run_route_close_0002');
    expect(nextDone.status).toBe('completed');
    expect(nextDone.sessionId).not.toBe(sessionId);
  });
});
