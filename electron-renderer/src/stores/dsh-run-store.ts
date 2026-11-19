/**
 * stores/dsh-run-store.ts — I-2 DSH 运行状态机（事件归并／重连／取消／关闭）
 *
 * 契约（铁律 47）:
 *   @input  dependencies（四调用＋事件源＋认证快照；测试注入 fake）｜用户动作：setInput/submit/cancel/close/reconnect
 *   @output 状态 idle→starting→running→done/cancelled/failed/expired ＋ runId/sessionId/lastEventId/events/error/empty
 *   @degraded 失败一律落 error（httpStatus/code/message 可见）；断流 ⇒ STREAM_INTERRUPTED（可重连，绝不 done）
 *   @error  永不抛（依赖层已归一为 ok/error/degraded）
 *   @not-here 不改后端契约；不在前端编造事件；取消终态只认 SSE `run.cancelled`（不以 POST 返回为准）
 */
import { create } from 'zustand';
import { authSnapshot, type AuthSnapshot, type DshAuthState } from '../lib/auth-session';
import {
  DSH_MAX_INPUT_CHARS,
  cancelRun,
  closeSession,
  openRunEvents,
  startRun,
  type DshCallError,
  type DshCancelResult,
  type DshCloseResult,
  type DshEvent,
  type DshEventHandlers,
  type DshEventSource,
  type DshRunStartResult,
} from '../lib/dsh-run-api';

export type DshRunStatus = 'idle' | 'starting' | 'running' | 'done' | 'cancelled' | 'failed' | 'expired';

/**
 * 面板可渲染的事件项（白名单投影）：文本增量按 seq 逐条保留；工具按 toolCallId 归并为一行。
 * 只含 title/kind/status/isError——事件里没有入参/结果，不得虚构。
 */
export type DshRunEventItem =
  | { seq: number; kind: 'text'; text: string }
  | { seq: number; kind: 'tool'; toolCallId: string | null; title: string | null; toolKind: string | null; status: string | null; isError: boolean };

export interface DshRunError {
  httpStatus: number | null;
  code: string;
  phase: string | null;
  retryable: boolean;
  message: string;
  canReconnect: boolean;
}

export interface DshRunDependencies {
  startRun: (input: string) => Promise<DshRunStartResult>;
  openRunEvents: (runId: string, lastEventId: number, handlers: DshEventHandlers) => DshEventSource;
  cancelRun: (runId: string) => Promise<DshCancelResult>;
  closeSession: (sessionId: string) => Promise<DshCloseResult>;
  authSnapshot: () => AuthSnapshot;
}

export interface DshRunState {
  /** 输入框（受控来源；面板无 hook） */
  input: string;
  inputError: string | null;
  status: DshRunStatus;
  auth: DshAuthState;
  runId: string | null;
  sessionId: string | null;
  lastEventId: number;
  events: DshRunEventItem[];
  error: DshRunError | null;
  /** run.completed.data.empty === true（空成功可见为「无结果」） */
  empty: boolean;
  cancelPending: boolean;
  /** close 成功后为 true（会话已关闭可见；close ≠ 停进程） */
  sessionClosed: boolean;

  syncAuth: () => void;
  setInput: (value: string) => void;
  submit: () => Promise<void>;
  cancel: () => Promise<void>;
  close: () => Promise<void>;
  reconnect: () => void;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toRunError(failure: DshCallError): DshRunError {
  if (failure.kind === 'error') {
    return {
      httpStatus: failure.httpStatus,
      code: failure.code,
      phase: failure.phase,
      retryable: failure.retryable,
      message: failure.message,
      canReconnect: false,
    };
  }
  return {
    httpStatus: failure.httpStatus ?? null,
    code: failure.code ?? 'DEGRADED',
    phase: failure.phase ?? null,
    retryable: failure.retryable ?? true,
    message: failure.reason,
    canReconnect: false,
  };
}

/** run.failed 的事件体（DshError.toPayload：code/phase/retryable/message）投影为可见错误 */
function errorFromEvent(data: Record<string, unknown>): DshRunError {
  return {
    httpStatus: null,
    code: readString(data.code) ?? 'RUN_FAILED',
    phase: readString(data.phase),
    retryable: data.retryable === true,
    message: readString(data.message) ?? '运行失败',
    canReconnect: false,
  };
}

/** tool.finished 归并到同 toolCallId 的 tool.started（没有对应 started 时追加一行状态） */
function mergeToolFinish(
  events: DshRunEventItem[],
  finish: { seq: number; toolCallId: string | null; status: string | null; isError: boolean },
): DshRunEventItem[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const item = events[index];
    if (item.kind !== 'tool') continue;
    if (item.toolCallId !== finish.toolCallId) continue;
    const merged: DshRunEventItem = {
      ...item,
      status: finish.status ?? item.status,
      isError: finish.isError,
    };
    return [...events.slice(0, index), merged, ...events.slice(index + 1)];
  }
  return [...events, {
    seq: finish.seq,
    kind: 'tool',
    toolCallId: finish.toolCallId,
    title: null,
    toolKind: null,
    status: finish.status,
    isError: finish.isError,
  }];
}

const defaultDependencies: DshRunDependencies = {
  startRun: (input) => startRun(input),
  openRunEvents: (runId, lastEventId, handlers) => openRunEvents(runId, lastEventId, handlers),
  cancelRun: (runId) => cancelRun(runId),
  closeSession: (sessionId) => closeSession(sessionId),
  authSnapshot,
};

/**
 * 创建独立状态机实例（测试注入依赖；生产用下方 useDshRunStore 单例）。
 * @input 可覆盖任意依赖
 * @output zustand store（状态＋动作）
 */
export function createDshRunStore(overrides: Partial<DshRunDependencies> = {}) {
  const dependencies: DshRunDependencies = { ...defaultDependencies, ...overrides };
  // 模块级（每次 create 独立）：事件流句柄、已见 seq、是否已见终态
  let source: DshEventSource | null = null;
  let terminalSeen = false;
  const seen = new Set<number>();

  return create<DshRunState>()((set, get) => {
    const finishStream = (): void => {
      if (source !== null) {
        source.close();
        source = null;
      }
    };

    const applyEvent = (event: DshEvent): void => {
      if (!Number.isFinite(event.seq) || event.seq <= 0) return;
      if (seen.has(event.seq)) return;
      seen.add(event.seq);
      set((state) => ({ lastEventId: Math.max(state.lastEventId, event.seq) }));
      switch (event.type) {
        case 'session.created': {
          const sessionId = readString(event.data.sessionId);
          if (sessionId !== null) set({ sessionId });
          return;
        }
        case 'text.delta': {
          const text = readString(event.data.text);
          if (text !== null && text.length > 0) {
            set((state) => ({ events: [...state.events, { seq: event.seq, kind: 'text', text }] }));
          }
          return;
        }
        case 'tool.started': {
          set((state) => ({
            events: [...state.events, {
              seq: event.seq,
              kind: 'tool',
              toolCallId: readString(event.data.toolCallId),
              title: readString(event.data.title),
              toolKind: readString(event.data.kind),
              status: readString(event.data.status),
              isError: false,
            }],
          }));
          return;
        }
        case 'tool.finished': {
          set((state) => ({
            events: mergeToolFinish(state.events, {
              seq: event.seq,
              toolCallId: readString(event.data.toolCallId),
              status: readString(event.data.status),
              isError: event.data.isError === true,
            }),
          }));
          return;
        }
        case 'run.completed': {
          terminalSeen = true;
          finishStream();
          set({ status: 'done', empty: event.data.empty === true, cancelPending: false });
          return;
        }
        case 'run.failed': {
          terminalSeen = true;
          finishStream();
          set({ status: 'failed', error: errorFromEvent(event.data), cancelPending: false });
          return;
        }
        case 'run.cancelled': {
          terminalSeen = true;
          finishStream();
          set({ status: 'cancelled', cancelPending: false });
          return;
        }
        default:
          // 白名单投影：未承诺/未知事件不进 UI（不把未知事件体整段塞进界面）
          return;
      }
    };

    const openStream = (runId: string): void => {
      finishStream();
      source = dependencies.openRunEvents(runId, get().lastEventId, {
        onEvent: applyEvent,
        onError: (failure) => {
          source = null;
          if (terminalSeen) return;
          const expiredNow = failure.kind === 'error' && failure.httpStatus === 401;
          set({
            status: expiredNow ? 'expired' : 'failed',
            error: toRunError(failure),
            cancelPending: false,
            auth: dependencies.authSnapshot().state,
          });
        },
        onEnd: () => {
          source = null;
          if (terminalSeen) return;
          // 断流：没有终态事件 ⇒ 不能显示完成；可重连（带 last-event-id）
          set({
            status: 'failed',
            cancelPending: false,
            error: {
              httpStatus: null,
              code: 'STREAM_INTERRUPTED',
              phase: 'stream',
              retryable: true,
              message: '连接中断，可重连',
              canReconnect: true,
            },
            auth: dependencies.authSnapshot().state,
          });
        },
      });
    };

    return {
      input: '',
      inputError: null,
      status: 'idle',
      auth: dependencies.authSnapshot().state,
      runId: null,
      sessionId: null,
      lastEventId: 0,
      events: [],
      error: null,
      empty: false,
      cancelPending: false,
      sessionClosed: false,

      syncAuth: () => set({ auth: dependencies.authSnapshot().state }),

      setInput: (input) => set({ input, inputError: null }),

      submit: async () => {
        const current = get();
        const text = current.input;
        if (current.status === 'starting' || current.status === 'running') return;
        if (text.trim().length === 0) {
          set({ inputError: '请输入要发送的内容' });
          return;
        }
        if (text.length > DSH_MAX_INPUT_CHARS) {
          set({ inputError: `输入超过 ${DSH_MAX_INPUT_CHARS} 字符上限` });
          return;
        }
        const auth = dependencies.authSnapshot();
        set({ auth: auth.state });
        if (auth.state === 'unauthenticated' || auth.state === 'expired') return; // 未登录不发 run
        seen.clear();
        terminalSeen = false;
        finishStream();
        set({
          status: 'starting',
          inputError: null,
          error: null,
          events: [],
          lastEventId: 0,
          empty: false,
          cancelPending: false,
          sessionClosed: false,
          runId: null,
          sessionId: null,
        });
        const result = await dependencies.startRun(text);
        set({ auth: dependencies.authSnapshot().state });
        if (result.kind !== 'ok') {
          const expiredNow = result.kind === 'error' && result.httpStatus === 401;
          set({ status: expiredNow ? 'expired' : 'failed', error: toRunError(result) });
          return;
        }
        set({ runId: result.runId, sessionId: result.sessionId, status: 'running' });
        openStream(result.runId);
      },

      cancel: async () => {
        const current = get();
        if (current.runId === null || current.status !== 'running') return;
        if (current.cancelPending) return;
        set({ cancelPending: true });
        const result = await dependencies.cancelRun(current.runId);
        set({ auth: dependencies.authSnapshot().state });
        if (result.kind !== 'ok') {
          const expiredNow = result.kind === 'error' && result.httpStatus === 401;
          set({ cancelPending: false, status: expiredNow ? 'expired' : 'failed', error: toRunError(result) });
          return;
        }
        // 以 SSE run.cancelled 为准：POST 返回不代表已终止，状态保持 running 直到事件到达
      },

      close: async () => {
        const current = get();
        if (current.sessionId === null || current.sessionClosed) return;
        const result = await dependencies.closeSession(current.sessionId);
        set({ auth: dependencies.authSnapshot().state });
        if (result.kind === 'ok') {
          set({ sessionClosed: true });
          return;
        }
        if (result.kind === 'error' && result.httpStatus === 401) {
          set({ status: 'expired', error: toRunError(result) });
          return;
        }
        set({ error: toRunError(result) });
      },

      reconnect: () => {
        const current = get();
        if (current.runId === null) return;
        if (current.status === 'failed' && current.error?.canReconnect !== true) return;
        if (current.status !== 'failed' && current.status !== 'running') return;
        terminalSeen = false;
        set({ status: 'running', error: null, cancelPending: false });
        openStream(current.runId);
      },
    };
  });
}

export const useDshRunStore = createDshRunStore();
