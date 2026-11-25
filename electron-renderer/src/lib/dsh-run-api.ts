/**
 * lib/dsh-run-api.ts — I-2 DSH 运行四调用（Bearer）与 SSE 事件源
 *
 * 端点（以 `src/routes/dsh.ts` 实况为准，禁止猜字段）：
 *   POST /api/dsh/runs                       body {input}；202 {ok, runId, sessionId, status}
 *   GET  /api/dsh/runs/:runId/events         text/event-stream；`id:` = seq；支持 Last-Event-ID
 *   POST /api/dsh/runs/:runId/cancel        {ok, runId, status, cancelRequested}（不代表已终止）
 *   POST /api/dsh/sessions/:sessionId/close  {ok, sessionId, closed:true}
 *
 * 契约（铁律 47）:
 *   @input   input／runId／sessionId ＋ 可选 base/fetchImpl（测试注入）
 *   @output  统一归一：ok 数据 ｜ error（4xx typed）｜ degraded（网络/5xx/形状非法）
 *   @degraded 网络、非 JSON、非 2xx 5xx、形状非法 ⇒ console.warn ＋ degraded（不抛）
 *   @error   永不抛出异常；401 统一调用 expireSession（登录失效可见）
 *   @not-here 不把 token 写日志、不做 UI 状态机、不判「是否完成」（终态只认 run.completed/failed/cancelled 事件）
 */
import { getApiBase } from './api';
import { authHeader, expireSession, type AuthFetch, type AuthResponse } from './auth-session';
import { CUSTOMER_TEXT } from './words';

/** 输入长度上限（与 src/routes/dsh.ts MAX_INPUT_CHARS 一致；前端先校验） */
export const DSH_MAX_INPUT_CHARS = 100_000;

export interface DshErrorView {
  kind: 'error';
  httpStatus: number;
  code: string;
  phase: string;
  retryable: boolean;
  message: string;
}

export interface DshDegradedView {
  kind: 'degraded';
  reason: string;
  httpStatus?: number;
  code?: string;
  phase?: string;
  retryable?: boolean;
}

export type DshCallError = DshErrorView | DshDegradedView;

export interface DshRunStartData {
  kind: 'ok';
  runId: string;
  sessionId: string | null;
}

export type DshRunStartResult = DshRunStartData | DshCallError;

export interface DshCancelData {
  kind: 'ok';
  status: string;
  cancelRequested: boolean;
}

export type DshCancelResult = DshCancelData | DshCallError;

export type DshCloseResult = { kind: 'ok' } | DshCallError;

/** SSE 事件（seq 单调递增；type 为 run.started/session.created/text.delta/tool.started/... 之一） */
export interface DshEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

export interface DshEventHandlers {
  onEvent: (event: DshEvent) => void;
  onError: (failure: DshCallError) => void;
  onEnd: () => void;
}

export interface DshEventSource {
  close: () => void;
}

/** 本模块只依赖 fetch 响应的最小形状（JSON 调用 + 事件流 body） */
export interface DshResponse extends AuthResponse {
  body: ReadableStream<Uint8Array> | null;
}

export type DshFetch = (url: string, init: RequestInit) => Promise<DshResponse>;

export interface DshCallOptions {
  base?: string;
  fetchImpl?: DshFetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveBase(base: string | undefined): string {
  const raw = base === undefined ? getApiBase() : base;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function degrade(reason: string, details: Omit<Partial<DshDegradedView>, 'kind' | 'reason'> = {}): DshDegradedView {
  console.warn(`[dsh-run-api] ${reason}`);
  return { kind: 'degraded', reason, ...details };
}

function validationError(message: string): DshErrorView {
  return { kind: 'error', httpStatus: 400, code: 'VALIDATION_ERROR', phase: 'request', retryable: false, message };
}

function defaultCode(httpStatus: number): string {
  if (httpStatus === 401) return 'UNAUTHORIZED';
  if (httpStatus === 403) return 'FORBIDDEN';
  if (httpStatus === 404) return 'NOT_FOUND';
  if (httpStatus === 409) return 'CONFLICT';
  return httpStatus >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED';
}

/** 非 2xx 归一：401 ⇒ error＋失效；5xx ⇒ degraded；其余 4xx ⇒ error（保留服务端 code/phase/retryable）。 */
function normalizeFailure(payload: unknown, httpStatus: number): DshCallError {
  const body = isRecord(payload) ? payload : {};
  const message = typeof body.message === 'string' ? body.message : CUSTOMER_TEXT.serviceUnavailable;
  const code = typeof body.code === 'string' ? body.code : defaultCode(httpStatus);
  const phase = typeof body.phase === 'string' ? body.phase : 'request';
  const retryable = typeof body.retryable === 'boolean' ? body.retryable : httpStatus >= 500;
  if (httpStatus === 401) {
    expireSession();
    return { kind: 'error', httpStatus, code, phase, retryable: false, message };
  }
  if (httpStatus >= 500) {
    return degrade(`服务读取失败：${message}`, { httpStatus, code, phase, retryable: true });
  }
  if (httpStatus === 400 || httpStatus === 403 || httpStatus === 404 || httpStatus === 409 || httpStatus === 422) {
    return { kind: 'error', httpStatus, code, phase, retryable, message };
  }
  return degrade(CUSTOMER_TEXT.serviceUnavailable, { httpStatus, retryable: httpStatus >= 500 });
}

type JsonRead = { kind: 'response'; response: DshResponse; payload: unknown } | DshDegradedView;

async function readJson(url: string, init: RequestInit, fetchImpl: DshFetch): Promise<JsonRead> {
  let response: DshResponse;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    return degrade(`网络异常：${messageOf(error)}`, { retryable: true });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.warn(`[dsh-run-api] 响应非 JSON：${messageOf(error)}`);
    return degrade(CUSTOMER_TEXT.dataUnrecognized, { httpStatus: response.status, retryable: true });
  }
  return { kind: 'response', response, payload };
}

function resolveFetch(fetchImpl: DshFetch | undefined): DshFetch {
  return fetchImpl ?? ((url, init) => fetch(url, init));
}

/**
 * 发起一轮运行：`POST /api/dsh/runs`，body 恰为 `{input}`。
 * @input  非空且 ≤ DSH_MAX_INPUT_CHARS 的输入；超限/空 ⇒ 本地 VALIDATION_ERROR（零请求）
 * @output ok {runId, sessionId|null} ｜ error ｜ degraded；sessionId 可能为 null（以 SSE session.created 为准）
 * @error  永不抛
 */
export async function startRun(input: string, options: DshCallOptions = {}): Promise<DshRunStartResult> {
  if (input.trim().length === 0) return validationError('input 必须是非空字符串');
  if (input.length > DSH_MAX_INPUT_CHARS) return validationError(`input 超过 ${DSH_MAX_INPUT_CHARS} 字符上限`);
  const read = await readJson(`${resolveBase(options.base)}/api/dsh/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ input }),
  }, resolveFetch(options.fetchImpl));
  if (read.kind === 'degraded') return read;
  if (!read.response.ok) return normalizeFailure(read.payload, read.response.status);
  if (read.response.status !== 202 && read.response.status !== 200) {
    return degrade(`运行响应状态非法：${read.response.status}`, { httpStatus: read.response.status });
  }
  const payload = read.payload;
  const runId = isRecord(payload) && typeof payload.runId === 'string' && payload.runId.length > 0 ? payload.runId : null;
  if (runId === null) return degrade('运行响应缺少 runId', { httpStatus: read.response.status });
  const sessionId = isRecord(payload) && typeof payload.sessionId === 'string' && payload.sessionId.length > 0
    ? payload.sessionId
    : null;
  return { kind: 'ok', runId, sessionId };
}

/**
 * 取消一轮运行：`POST /api/dsh/runs/:runId/cancel`。
 * @output ok {status, cancelRequested}——**不代表已终止**；终态只认 SSE `run.cancelled`
 * @error  永不抛
 */
export async function cancelRun(runId: string, options: DshCallOptions = {}): Promise<DshCancelResult> {
  if (runId.trim().length === 0) return validationError(CUSTOMER_TEXT.analysisStartFailed);
  const read = await readJson(`${resolveBase(options.base)}/api/dsh/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { ...authHeader() },
  }, resolveFetch(options.fetchImpl));
  if (read.kind === 'degraded') return read;
  if (!read.response.ok) return normalizeFailure(read.payload, read.response.status);
  if (read.response.status !== 200) return degrade(`取消响应状态非法：${read.response.status}`, { httpStatus: read.response.status });
  const payload = read.payload;
  const ok = isRecord(payload) && payload.ok === true;
  const status = isRecord(payload) && typeof payload.status === 'string' ? payload.status : null;
  const cancelRequested = isRecord(payload) && typeof payload.cancelRequested === 'boolean' ? payload.cancelRequested : null;
  if (!ok || status === null || cancelRequested === null) return degrade('取消响应形状非法', { httpStatus: read.response.status });
  return { kind: 'ok', status, cancelRequested };
}

/**
 * 关闭会话：`POST /api/dsh/sessions/:sessionId/close`（close ≠ 停进程）。
 * @output ok 只在响应 `ok === true` 时返回（不伪造已关闭）
 * @error  永不抛
 */
export async function closeSession(sessionId: string, options: DshCallOptions = {}): Promise<DshCloseResult> {
  if (sessionId.trim().length === 0) return validationError(CUSTOMER_TEXT.analysisStartFailed);
  const read = await readJson(`${resolveBase(options.base)}/api/dsh/sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
    headers: { ...authHeader() },
  }, resolveFetch(options.fetchImpl));
  if (read.kind === 'degraded') return read;
  if (!read.response.ok) return normalizeFailure(read.payload, read.response.status);
  if (read.response.status !== 200) return degrade(`关闭响应状态非法：${read.response.status}`, { httpStatus: read.response.status });
  if (!isRecord(read.payload) || read.payload.ok !== true) return degrade('关闭确认非法：响应缺少 ok=true', { httpStatus: read.response.status });
  return { kind: 'ok' };
}

/** 解析一帧 SSE（`id:`／`event:`／`data:`）；形状非法 ⇒ console.warn 跳过该帧，不断流。 */
function dispatchFrame(frame: string, handlers: DshEventHandlers): void {
  if (frame.trim() === '') return; // 空帧（含心跳注释结尾）
  let seq = 0;
  let type = '';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(':')) continue; // 心跳/注释行
    if (line.startsWith('id:')) {
      const value = Number(line.slice(3).trim());
      if (Number.isFinite(value)) seq = value;
      continue;
    }
    if (line.startsWith('event:')) { type = line.slice(6).trim(); continue; }
    if (line.startsWith('data:')) { dataLines.push(line.slice(5).replace(/^ /, '')); }
  }
  if (dataLines.length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join('\n'));
  } catch (error) {
    console.warn(`[dsh-run-api] SSE data 解析失败，跳过该帧：${messageOf(error)}`);
    return;
  }
  if (!isRecord(parsed)) {
    console.warn('[dsh-run-api] SSE data 不是对象，跳过该帧');
    return;
  }
  const rawSeq = typeof parsed.seq === 'number' && Number.isFinite(parsed.seq) ? parsed.seq : seq;
  const eventType = typeof parsed.type === 'string' && parsed.type.length > 0 ? parsed.type : type;
  if (!Number.isFinite(rawSeq) || rawSeq <= 0 || eventType.length === 0) {
    console.warn('[dsh-run-api] SSE 事件缺少 seq/type，跳过该帧');
    return;
  }
  const data = isRecord(parsed.data) ? parsed.data : {};
  handlers.onEvent({ seq: rawSeq, type: eventType, data });
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  handlers: DshEventHandlers,
  isClosed: () => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!isClosed()) {
      const { done, value } = await reader.read();
      if (done) break;
      if (isClosed()) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        dispatchFrame(frame, handlers);
        index = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (error) {
      // 读取锁已被取消时释放会抛：不影响已派发事件，warn 留痕（铁律 24 不静默）
      console.warn(`[dsh-run-api] 事件流读取锁释放失败：${messageOf(error)}`);
    }
  }
}

/**
 * 打开运行事件流：`GET /api/dsh/runs/:runId/events`（fetch + ReadableStream，支持 Bearer 与 Last-Event-ID）。
 * @input  runId；lastEventId（>0 时作为 `last-event-id` 头，重放定位）；handlers
 * @output 事件源句柄 {close()}——close 后不再回调任何 handler
 * @degraded 非 2xx ⇒ onError（401 同时 expireSession）；网络/断流 ⇒ onEnd（由上层判定是否中断）
 * @error  永不抛
 */
export function openRunEvents(
  runId: string,
  lastEventId: number,
  handlers: DshEventHandlers,
  options: DshCallOptions = {},
): DshEventSource {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const controller = new AbortController();
  let closed = false;
  const headers: Record<string, string> = { Accept: 'text/event-stream', ...authHeader() };
  if (Number.isFinite(lastEventId) && lastEventId > 0) headers['last-event-id'] = String(lastEventId);
  void (async () => {
    try {
      const response = await fetchImpl(`${resolveBase(options.base)}/api/dsh/runs/${encodeURIComponent(runId)}/events`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch (error) {
          console.warn(`[dsh-run-api] 事件流错误响应非 JSON：${messageOf(error)}`);
        }
        if (!closed) handlers.onError(normalizeFailure(payload, response.status));
        return;
      }
      if (response.body === null) {
        if (!closed) handlers.onError(degrade('运行事件流不可读', { httpStatus: response.status }));
        return;
      }
      await consumeStream(response.body, handlers, () => closed);
      if (!closed) handlers.onEnd();
    } catch (error) {
      if (closed) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      handlers.onError(degrade(`事件流读取失败：${messageOf(error)}`, { retryable: true }));
    }
  })();
  return {
    close: (): void => {
      closed = true;
      controller.abort();
    },
  };
}
