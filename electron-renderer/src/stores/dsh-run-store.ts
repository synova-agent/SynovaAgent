/**
 * stores/dsh-run-store.ts — I-2 DSH 运行状态机（事件归并／重连／取消／关闭）
 *
 * 契约（铁律 47）:
 *   @input  dependencies（四调用＋事件源＋认证快照；测试注入 fake）｜用户动作：setInput/submit/cancel/close/reconnect
 *   @output 状态 idle→starting→running→done/cancelled/failed/expired ＋
 *           runId/sessionId/lastEventId/events/error/empty/pending（未知事件留存，见下 P1）
 *   @degraded 失败一律落 error（httpStatus/code/message 可见）；断流 ⇒ STREAM_INTERRUPTED（可重连，绝不 done）
 *   @error  永不抛（依赖层已归一为 ok/error/degraded）
 *   @not-here 不改后端契约；不在前端编造事件；取消终态只认 SSE `run.cancelled`（不以 POST 返回为准）
 *
 * #1459 T-B（本文件本轮变更）:
 *   · 白名单增结构化假设：`hypothesis.structured` / `hypothesis.invalid` ⇒ events 增 `kind:'hypothesis'`
 *     （四要素严格校验，缺字段即 `structured:false`，前端不猜补）
 *   · P1 修复：顺序改为「处理并留痕 ⇒ 再推进 lastEventId」；未知事件留存进 `pending`
 *     （旧实现先推水位再 switch ⇒ 未知事件被 default 丢掉且重连不再补发 ⇒ 永久缺失）
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
 * 结构化瓶颈假设的可渲染视图（`hypothesis.structured` / `hypothesis.invalid` 载荷的归一结果）。
 *
 * 契约（铁律 47）:
 *   @input  事件 data：`{hypothesis, objects[], relations[], evidence[], uncertainty[], schemaVersion?, text?}`
 *           · objects     每项＝② 对象 `$id`（如 `team:delivery-a`）
 *           · relations   每项＝`graph_triples.predicate`（如 `edge/team_executes_activity`）
 *           · evidence    每项＝`scan_assertion_evidence.source_ref`（如 `delivery_batches.csv#L2`）
 *           · uncertainty 每项＝人话的「缺什么／假设了什么」
 *           四要素一律要求**非空字符串数组**（空白项也判非法）。
 *   @output 四要素原样保留（不裁剪、不改写、不排序）；`schemaVersion` 原样记录
 *   @degraded 任一要素缺失/空/元素非字符串 ⇒ `structured:false` ＋ `invalidReason`（列出缺哪项）；
 *             **不补默认值**（禁止猜补）——面板据此显式标「未结构化」，不渲染成卡片
 *   @not-here 不解析模型自由文本充当结构化假设；不按 `schemaVersion` 做投机分支（当前只有一版）
 */
export interface DshHypothesisView {
  /** 假设正文；缺失为 null */
  claim: string | null;
  /** ② 对象 `$id` 列表；缺失/非法 ⇒ []（structured=false 时不渲染） */
  objects: string[];
  /** 关系 predicate 列表 */
  relations: string[];
  /** 依据 `source_ref` 列表（可回来源） */
  evidence: string[];
  /** 不确定性（缺什么／假设了什么） */
  uncertainty: string[];
  /** 载荷声明的 schemaVersion（原样记录） */
  schemaVersion: string | null;
  /** 四要素齐全且服务端未判 invalid ⇒ true */
  structured: boolean;
  /** structured=false 的原因（缺哪项 或 服务端 reason）；true 时为 null */
  invalidReason: string | null;
  /** 服务端附带的原样文本（`hypothesis.invalid` 可能带）；没有就 null，不猜 */
  rawText: string | null;
}

/**
 * 未进入白名单的未知事件留存项（P1 修复）。
 * 只留 seq/type/data，**不渲染正文**（白名单投影不变）；目的是断流重连后事件仍可复查、不永久缺失。
 */
export interface DshPendingEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

/**
 * 面板可渲染的事件项（白名单投影）：文本增量按 seq 逐条保留；工具按 toolCallId 归并为一行；
 * 结构化假设一条一张卡。只含事件里真实存在的字段——事件里没有入参/结果，不得虚构。
 */
export type DshRunEventItem =
  | { seq: number; kind: 'text'; text: string }
  | { seq: number; kind: 'tool'; toolCallId: string | null; title: string | null; toolKind: string | null; status: string | null; isError: boolean }
  | { seq: number; kind: 'hypothesis'; hypothesis: DshHypothesisView };

/** 未知事件留存上限：超出丢最旧并由 `pendingDropped` 计数可见（不静默丢） */
const PENDING_LIMIT = 200;

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
  /** 未进入白名单的未知事件留存（P1：断流重连后仍可复查；不渲染正文） */
  pending: DshPendingEvent[];
  /** 因超出留存上限被丢弃的条数（可见，不静默丢） */
  pendingDropped: number;
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

/**
 * 读「非空字符串数组」：非数组／空数组／含非字符串或空白项 ⇒ null。
 * @input  事件载荷里的候选值
 * @output 原样数组（元素不改写、不裁剪、不排序）｜ null＝形状非法
 */
function readStringArrayExact(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) return null;
    values.push(item);
  }
  return values;
}

/**
 * 归一结构化假设载荷（严格校验：缺什么就是什么，不猜补）。
 * @input  data＝事件 data 原样；serverInvalidReason＝`hypothesis.invalid` 的 reason（非 invalid 事件传 null）
 * @output 四要素齐全且无服务端 invalid ⇒ `structured:true`；否则 `structured:false` ＋ `invalidReason`
 * @degraded 缺字段／空数组／元素非字符串 ⇒ structured:false（原因列出缺失项／服务端 reason）
 * @not-here 不用默认值填充任何要素；不把部分字段当真渲染
 */
function readHypothesis(data: Record<string, unknown>, serverInvalidReason: string | null): DshHypothesisView {
  const claim = readString(data.hypothesis);
  const objects = readStringArrayExact(data.objects);
  const relations = readStringArrayExact(data.relations);
  const evidence = readStringArrayExact(data.evidence);
  const uncertainty = readStringArrayExact(data.uncertainty);
  const missing: string[] = [];
  if (claim === null || claim.trim().length === 0) missing.push('hypothesis');
  if (objects === null) missing.push('objects');
  if (relations === null) missing.push('relations');
  if (evidence === null) missing.push('evidence');
  if (uncertainty === null) missing.push('uncertainty');
  const structured = missing.length === 0 && serverInvalidReason === null;
  return {
    claim,
    objects: objects ?? [],
    relations: relations ?? [],
    evidence: evidence ?? [],
    uncertainty: uncertainty ?? [],
    schemaVersion: readString(data.schemaVersion),
    structured,
    invalidReason: structured ? null : serverInvalidReason ?? `载荷缺少或为空：${missing.join('、')}`,
    rawText: readString(data.text),
  };
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

    /**
     * 处理一条事件并留痕——**不推进 lastEventId**（顺序由 applyEvent 保证，P1）。
     * @input  事件（seq/type/data）
     * @output 'rendered'＝已进 events；'pending'＝未知类型，须由调用方留存
     * @not-here 不推进续订水位；不把未知事件体渲染进界面
     */
    const handleEvent = (event: DshEvent): 'rendered' | 'pending' => {
      switch (event.type) {
        case 'session.created': {
          const sessionId = readString(event.data.sessionId);
          if (sessionId !== null) set({ sessionId });
          return 'rendered';
        }
        case 'text.delta': {
          const text = readString(event.data.text);
          if (text !== null && text.length > 0) {
            set((state) => ({ events: [...state.events, { seq: event.seq, kind: 'text', text }] }));
          }
          return 'rendered';
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
          return 'rendered';
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
          return 'rendered';
        }
        case 'hypothesis.structured':
        case 'hypothesis.invalid': {
          // 服务端已校验的事件才该进来；`invalid` 一律按未结构化呈现（服务端判定优先于本地形状）
          const serverInvalidReason = event.type === 'hypothesis.invalid'
            ? readString(event.data.reason) ?? '服务端标记为未结构化'
            : null;
          set((state) => ({
            events: [...state.events, {
              seq: event.seq,
              kind: 'hypothesis',
              hypothesis: readHypothesis(event.data, serverInvalidReason),
            }],
          }));
          return 'rendered';
        }
        case 'run.completed': {
          terminalSeen = true;
          finishStream();
          set({ status: 'done', empty: event.data.empty === true, cancelPending: false });
          return 'rendered';
        }
        case 'run.failed': {
          terminalSeen = true;
          finishStream();
          set({ status: 'failed', error: errorFromEvent(event.data), cancelPending: false });
          return 'rendered';
        }
        case 'run.cancelled': {
          terminalSeen = true;
          finishStream();
          set({ status: 'cancelled', cancelPending: false });
          return 'rendered';
        }
        default:
          // 白名单投影：未承诺/未知事件不渲染正文（不把未知事件体整段塞进界面），
          // 但**不得丢弃**——交给调用方留存在 pending（否则水位越过它 ⇒ 重连不补发 ⇒ 永久缺失）
          return 'pending';
      }
    };

    /**
     * 未知事件留存（P1）：断流重连后仍可复查，不渲染正文。
     * 超过 PENDING_LIMIT 时丢最旧，并把丢弃条数累加进 `pendingDropped`（可见，不静默丢）。
     */
    const retainPending = (event: DshEvent): void => {
      set((state) => {
        const next = [...state.pending, { seq: event.seq, type: event.type, data: event.data }];
        if (next.length <= PENDING_LIMIT) return { pending: next };
        const overflow = next.length - PENDING_LIMIT;
        return { pending: next.slice(overflow), pendingDropped: state.pendingDropped + overflow };
      });
    };

    /**
     * 归并一条事件：去重 ⇒ 处理并留痕 ⇒ **之后**才推进续订水位。
     *
     * P1（#1459）：旧实现先 `seen.add` ＋ 推进 `lastEventId`、再 switch ⇒ 未知事件被 `default` 丢弃，
     * 但水位已越过它 ⇒ 重连带 `last-event-id` ⇒ 服务端不再补发 ⇒ 该事件永久缺失。
     * 现顺序保证：事件先落进 events 或 pending，才推进 `lastEventId`；处理抛错则不推进
     * （`seen` 也未记录）⇒ 重连重放仍可恢复。
     */
    const applyEvent = (event: DshEvent): void => {
      if (!Number.isFinite(event.seq) || event.seq <= 0) return;
      if (seen.has(event.seq)) return;
      const retained = handleEvent(event);
      if (retained === 'pending') retainPending(event);
      seen.add(event.seq);
      set((state) => ({ lastEventId: Math.max(state.lastEventId, event.seq) }));
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
      pending: [],
      pendingDropped: 0,
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
          pending: [],
          pendingDropped: 0,
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
