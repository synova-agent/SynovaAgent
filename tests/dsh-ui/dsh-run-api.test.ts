/**
 * tests/dsh-ui/dsh-run-api.test.ts — #1429 I-2 认证会话与 DSH 四调用＋SSE 事件源
 *
 * 覆盖（DEV DOC v1 §7 ＋ v2 变更 5）：
 *   · auth-session 双模式：默认 DevMode 不带头；真实 token 只在内存，header 精确 Bearer
 *   · startRun / cancelRun / closeSession：URL、method、body、Authorization 精确；错误归一不抛
 *   · openRunEvents：URL、last-event-id 精确；帧解析顺序；非 200 归一；401 失效；断流 onEnd
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authHeader,
  authSnapshot,
  expireSession,
  login,
  logout,
  type AuthFetch,
  type LoginResult,
} from '../../electron-renderer/src/lib/auth-session';
import {
  DSH_MAX_INPUT_CHARS,
  cancelRun,
  closeSession,
  openRunEvents,
  startRun,
  type DshCallError,
  type DshEvent,
  type DshFetch,
  type DshEventSource,
} from '../../electron-renderer/src/lib/dsh-run-api';

const API_BASE = 'http://localhost:18901';
const TOKEN = 'jwt-header.payload.signature';

const fetchMock = vi.fn<DshFetch>();
const authFetchMock = vi.fn<AuthFetch>();

/** 手写 SSE 流（仿 tests/electron/use-streaming-conversation.test.ts:73-90，零新依赖） */
function manualSSE() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    body: stream,
    frame: (event: { seq: number; type: string; data: Record<string, unknown> }) => {
      controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    },
    raw: (text: string) => { controller.enqueue(encoder.encode(text)); },
    close: () => { controller.close(); },
  };
}

function jsonResponse(status: number, payload: unknown): { ok: boolean; status: number; body: null; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, body: null, json: async () => payload };
}

function sseResponse(body: ReadableStream<Uint8Array>): { ok: boolean; status: number; body: ReadableStream<Uint8Array>; json: () => Promise<unknown> } {
  return { ok: true, status: 200, body, json: async () => ({}) };
}

function waitFor(condition: () => boolean, label = 'condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (condition()) { resolve(); return; }
      if (Date.now() - started > 2_000) { reject(new Error(`等待超时：${label}`)); return; }
      setTimeout(tick, 0);
    };
    tick();
  });
}

/** 发起一次成功的真实账登录（token 只存内存，供后续调用断言 Bearer） */
async function loginWithToken(): Promise<void> {
  authFetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN }) });
  const result: LoginResult = await login('staff@example.com', 'secret', { base: API_BASE, fetchImpl: authFetchMock });
  expect(result.kind).toBe('ok');
}

beforeEach(() => {
  logout();
  fetchMock.mockReset();
  authFetchMock.mockReset();
});

afterEach(() => {
  logout();
});

// ── 认证会话：双模式与内存 token ────────────────────────────────────────────

describe('#1429 auth-session 双模式（默认 DevMode；token 仅内存）', () => {
  it('默认 DevMode：authSnapshot=devmode，authHeader 为空对象（不发 Authorization）', () => {
    expect(authSnapshot()).toEqual({ mode: 'devmode', token: null, state: 'devmode' });
    expect(authHeader()).toEqual({});
  });

  it('login 成功：POST /api/auth/login body={email,password}，token 只进内存快照，header 精确 Bearer', async () => {
    authFetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN }) });
    const result = await login('staff@example.com', 'secret', { base: API_BASE, fetchImpl: authFetchMock });
    expect(result).toEqual({ kind: 'ok', token: TOKEN });

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(String(authFetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/auth/login`);
    expect(authFetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(authFetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(authFetchMock.mock.calls[0]?.[1]?.body))).toEqual({ email: 'staff@example.com', password: 'secret' });

    expect(authSnapshot()).toEqual({ mode: 'token', token: TOKEN, state: 'authenticated' });
    expect(authHeader()).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('login 401：返回 AUTH_FAILED，state=unauthenticated，不发 Authorization（登录失败不回退 DevMode）', async () => {
    authFetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ ok: false, code: 'AUTH_FAILED', message: '账户不存在或密码错误' }) });
    const result = await login('staff@example.com', 'wrong', { base: API_BASE, fetchImpl: authFetchMock });
    expect(result).toMatchObject({ kind: 'error', httpStatus: 401, code: 'AUTH_FAILED', message: '账户不存在或密码错误' });
    expect(authSnapshot().state).toBe('unauthenticated');
    expect(authHeader()).toEqual({});
  });

  it('logout：清内存 token 并回到默认 DevMode', async () => {
    await loginWithToken();
    logout();
    expect(authSnapshot()).toEqual({ mode: 'devmode', token: null, state: 'devmode' });
    expect(authHeader()).toEqual({});
  });

  it('任一 DSH 调用 401 ⇒ expireSession：token 清空、state=expired、header 为空', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { ok: false, code: 'UNAUTHORIZED', phase: 'auth', retryable: false, message: '缺少验签身份' }));
    const result = await startRun('你好', { base: API_BASE, fetchImpl: fetchMock });
    expect(result).toMatchObject({ kind: 'error', httpStatus: 401, code: 'UNAUTHORIZED' });
    expect(authSnapshot()).toEqual({ mode: 'token', token: null, state: 'expired' });
    expect(authHeader()).toEqual({});
  });

  it('expireSession 幂等：重复调用不抛，state 保持 expired', () => {
    expireSession();
    expect(authSnapshot().state).toBe('expired');
    expireSession();
    expect(authSnapshot().state).toBe('expired');
  });
});

// ── startRun：真实四端点之一 ────────────────────────────────────────────────

describe('#1429 startRun（POST /api/dsh/runs，Bearer）', () => {
  it('成功 202：URL/body/Authorization 精确，解析 runId 与 sessionId=null', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { ok: true, runId: 'run_abc12345', sessionId: null, status: 'running', eventCount: 1, replayed: false }));
    const result = await startRun('分析本月销售', { base: API_BASE, fetchImpl: fetchMock });
    expect(result).toEqual({ kind: 'ok', runId: 'run_abc12345', sessionId: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/dsh/runs`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ input: '分析本月销售' });
  });

  it('成功 202 且响应带 sessionId → 解析为字符串', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { ok: true, runId: 'run_abc12345', sessionId: 'sess_abc12345', status: 'running' }));
    const result = await startRun('继续', { base: API_BASE, fetchImpl: fetchMock });
    expect(result).toEqual({ kind: 'ok', runId: 'run_abc12345', sessionId: 'sess_abc12345' });
  });

  it('本地先校验：空输入／超限 ⇒ 不发请求（fetch 0 次）', async () => {
    const empty = await startRun('   ', { base: API_BASE, fetchImpl: fetchMock });
    expect(empty).toMatchObject({ kind: 'error', httpStatus: 400, code: 'VALIDATION_ERROR' });
    const tooLong = await startRun('x'.repeat(DSH_MAX_INPUT_CHARS + 1), { base: API_BASE, fetchImpl: fetchMock });
    expect(tooLong).toMatchObject({ kind: 'error', httpStatus: 400, code: 'VALIDATION_ERROR' });
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { ok: true, runId: 'run_limit0001', sessionId: null, status: 'running' }));
    const limit = await startRun('x'.repeat(DSH_MAX_INPUT_CHARS), { base: API_BASE, fetchImpl: fetchMock });
    expect(limit).toMatchObject({ kind: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400/403/404/409 各自归一为 error 并保留服务端 code/message', async () => {
    await loginWithToken();
    const cases = [
      { status: 400, code: 'VALIDATION_ERROR', message: 'input 必须是非空字符串' },
      { status: 403, code: 'FORGED_IDENTITY', message: 'runId 已被其他企业使用' },
      { status: 404, code: 'RUN_NOT_FOUND', message: '未知 runId: run_x' },
      { status: 409, code: 'RUN_CONFLICT', message: '运行状态冲突' },
    ] as const;
    for (const item of cases) {
      fetchMock.mockResolvedValueOnce(jsonResponse(item.status, { ok: false, code: item.code, phase: 'request', retryable: false, message: item.message }));
      const result = await startRun('你好', { base: API_BASE, fetchImpl: fetchMock });
      expect(result).toMatchObject({ kind: 'error', httpStatus: item.status, code: item.code, message: item.message, retryable: false });
    }
  });

  it('5xx 与网络失败归一为 degraded（可重试且消息可见）', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { ok: false, code: 'RUN_FAILED', phase: 'run', retryable: true, message: 'sidecar 未启动' }));
    const server = await startRun('你好', { base: API_BASE, fetchImpl: fetchMock });
    expect(server).toMatchObject({ kind: 'degraded', httpStatus: 500, retryable: true });
    expect(server.kind === 'degraded' ? server.reason : '').toContain('sidecar 未启动');

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const network = await startRun('你好', { base: API_BASE, fetchImpl: fetchMock });
    expect(network).toMatchObject({ kind: 'degraded', retryable: true });
    expect(network.kind === 'degraded' ? network.reason : '').toContain('网络异常');
  });

  it('响应缺 runId ⇒ degraded（不把空对象当成功）', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { ok: true, sessionId: null }));
    const result = await startRun('你好', { base: API_BASE, fetchImpl: fetchMock });
    expect(result.kind).toBe('degraded');
  });
});

// ── cancelRun / closeSession ────────────────────────────────────────────────

describe('#1429 cancelRun / closeSession', () => {
  it('cancel：POST /api/dsh/runs/:runId/cancel，Bearer 精确，返回 status/cancelRequested', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, runId: 'run_abc12345', status: 'cancelled', cancelRequested: true }));
    const result = await cancelRun('run_abc12345', { base: API_BASE, fetchImpl: fetchMock });
    expect(result).toEqual({ kind: 'ok', status: 'cancelled', cancelRequested: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/dsh/runs/run_abc12345/cancel`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('cancel 404 ⇒ error RUN_NOT_FOUND（不猜已取消）', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { ok: false, code: 'RUN_NOT_FOUND', phase: 'run', retryable: false, message: '未知 runId' }));
    const result = await cancelRun('run_gone', { base: API_BASE, fetchImpl: fetchMock });
    expect(result).toMatchObject({ kind: 'error', httpStatus: 404, code: 'RUN_NOT_FOUND' });
  });

  it('close：POST /api/dsh/sessions/:sessionId/close，ok=true 才算已关闭', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, sessionId: 'sess_abc12345', closed: true }));
    const result = await closeSession('sess_abc12345', { base: API_BASE, fetchImpl: fetchMock });
    expect(result).toEqual({ kind: 'ok' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/dsh/sessions/sess_abc12345/close`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('close 响应 ok 非 true ⇒ degraded（不伪造已关闭）', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sessionId: 'sess_abc12345' }));
    const result = await closeSession('sess_abc12345', { base: API_BASE, fetchImpl: fetchMock });
    expect(result.kind).toBe('degraded');
  });
});

// ── openRunEvents：SSE 事件源 ──────────────────────────────────────────────

describe('#1429 openRunEvents（GET /api/dsh/runs/:runId/events）', () => {
  function open(fetchImpl: DshFetch, lastEventId = 0, handlersOverride?: Partial<{ onEvent: (event: DshEvent) => void; onEnd: () => void; onError: (failure: DshCallError) => void }>): {
    source: DshEventSource;
    events: DshEvent[];
    state: { ended: boolean; failure: DshCallError | null };
  } {
    const events: DshEvent[] = [];
    const state: { ended: boolean; failure: DshCallError | null } = { ended: false, failure: null };
    const source = openRunEvents('run_abc12345', lastEventId, {
      onEvent: (event) => { events.push(event); },
      onEnd: () => { state.ended = true; },
      onError: (failure) => { state.failure = failure; },
      ...handlersOverride,
    }, { base: API_BASE, fetchImpl });
    return { source, events, state };
  }

  it('URL 与请求头精确：Accept 事件流 + Bearer；首连不带 last-event-id', async () => {
    await loginWithToken();
    const s = manualSSE();
    fetchMock.mockResolvedValueOnce(sseResponse(s.body));
    const { source, state } = open(fetchMock);
    await waitFor(() => fetchMock.mock.calls.length === 1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/dsh/runs/run_abc12345/events`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: 'text/event-stream',
      Authorization: `Bearer ${TOKEN}`,
    });
    s.close();
    await waitFor(() => state.ended);
    source.close();
  });

  it('重连请求头 last-event-id == 已收最后事件 seq（精确相等）', async () => {
    await loginWithToken();
    const s = manualSSE();
    fetchMock.mockResolvedValueOnce(sseResponse(s.body));
    const { source } = open(fetchMock, 7);
    await waitFor(() => fetchMock.mock.calls.length === 1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: 'text/event-stream',
      Authorization: `Bearer ${TOKEN}`,
      'last-event-id': '7',
    });
    s.close();
    source.close();
  });

  it('SSE 帧按序解析：session.created → text.delta → tool.started → tool.finished 的 data 原样', async () => {
    await loginWithToken();
    const s = manualSSE();
    fetchMock.mockResolvedValueOnce(sseResponse(s.body));
    const { source, events, state } = open(fetchMock);
    await waitFor(() => fetchMock.mock.calls.length === 1);

    s.frame({ seq: 1, type: 'session.created', data: { sessionId: 'sess_abc12345' } });
    s.frame({ seq: 2, type: 'text.delta', data: { text: '你' } });
    s.frame({ seq: 3, type: 'tool.started', data: { toolCallId: 'call_1', title: '读取清单', kind: 'read', status: 'pending' } });
    s.frame({ seq: 4, type: 'tool.finished', data: { toolCallId: 'call_1', status: 'completed', isError: false } });
    await waitFor(() => events.length === 4);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(events[0]?.type).toBe('session.created');
    expect(events[0]?.data).toEqual({ sessionId: 'sess_abc12345' });
    expect(events[1]?.data).toEqual({ text: '你' });
    expect(events[2]?.data).toEqual({ toolCallId: 'call_1', title: '读取清单', kind: 'read', status: 'pending' });
    expect(events[3]?.data).toEqual({ toolCallId: 'call_1', status: 'completed', isError: false });

    s.close();
    await waitFor(() => state.ended);
    source.close();
  });

  it('非法 JSON 帧：console.warn 跳过，后续合法帧继续消费（不断流）', async () => {
    await loginWithToken();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = manualSSE();
    fetchMock.mockResolvedValueOnce(sseResponse(s.body));
    const { source, events } = open(fetchMock);
    await waitFor(() => fetchMock.mock.calls.length === 1);
    s.raw('id: 9\nevent: text.delta\ndata: {broken-json\n\n');
    s.frame({ seq: 10, type: 'text.delta', data: { text: '仍可达' } });
    await waitFor(() => events.length === 1);
    expect(events[0]?.seq).toBe(10);
    expect(warn).toHaveBeenCalled();
    s.close();
    await waitFor(() => events.length === 1);
    source.close();
    warn.mockRestore();
  });

  it('非 200：404 归一 error（RUN_NOT_FOUND），500 归一 degraded；不把错误当流', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { ok: false, code: 'RUN_NOT_FOUND', phase: 'run', retryable: false, message: '未知 runId' }));
    const notFound = open(fetchMock);
    await waitFor(() => notFound.state.failure !== null);
    expect(notFound.state.failure).toMatchObject({ kind: 'error', httpStatus: 404, code: 'RUN_NOT_FOUND' });

    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { ok: false, code: 'RUN_FAILED', phase: 'run', retryable: true, message: '事件流失败' }));
    const serverError = open(fetchMock);
    await waitFor(() => serverError.state.failure !== null);
    expect(serverError.state.failure).toMatchObject({ kind: 'degraded', httpStatus: 500, retryable: true });
  });

  it('SSE 401 ⇒ expireSession（登录失效可见），不再继续消费', async () => {
    await loginWithToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { ok: false, code: 'UNAUTHORIZED', phase: 'auth', retryable: false, message: '缺少验签身份' }));
    const { state } = open(fetchMock);
    await waitFor(() => state.failure !== null);
    expect(state.failure).toMatchObject({ kind: 'error', httpStatus: 401 });
    expect(authSnapshot().state).toBe('expired');
  });

  it('流被服务端结束（无终态事件）⇒ onEnd，由上层判定「断流」而不是完成', async () => {
    await loginWithToken();
    const s = manualSSE();
    fetchMock.mockResolvedValueOnce(sseResponse(s.body));
    const { source, state } = open(fetchMock);
    s.frame({ seq: 1, type: 'text.delta', data: { text: '半截' } });
    s.close();
    await waitFor(() => state.ended);
    expect(state.failure).toBe(null);
    source.close();
  });

  it('close()：主动中止后不再回调 onEvent/onEnd；不触发 onError', async () => {
    await loginWithToken();
    const s = manualSSE();
    fetchMock.mockResolvedValueOnce(sseResponse(s.body));
    const { source, events, state } = open(fetchMock);
    await waitFor(() => fetchMock.mock.calls.length === 1);
    source.close();
    s.frame({ seq: 1, type: 'text.delta', data: { text: '迟到帧' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([]);
    expect(state.ended).toBe(false);
    expect(state.failure).toBe(null);
    s.close();
  });
});
