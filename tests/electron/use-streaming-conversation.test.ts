/**
 * tests/electron/use-streaming-conversation.test.ts — D591 conversation 模式集成测试
 *
 * 契约来源: SYNOVA-IMPL-DSH-D591-desktop-chat-wiring-20260908.md §3 Q4 / §5.2 / §7
 *   useStreaming.sendMessage(text, opts?):
 *     mode 缺省 'conversation' → POST {api}/api/conversations，body {message}（有 currentSessionId 时带 sessionId 续轮）
 *     mode 'diagnosis'         → POST {api}/api/diagnosis/consult，body {teamId, initiator}（与 main@b54a0fb6 逐字节等价）
 *   SSE 帧消费（conversation）: open→setCurrentSessionId(localStorage 持久化)；token→bufferRef+=text
 *     +16ms flush（真流式，逐字累积）；agent_message→assistant 全文落库+清 streamingText；end→phase done
 *   restoreMessages(payload) 纯函数: 只投影 role∈{user,assistant}，保序，畸形项跳过
 *   restoreLastSession(): 锚→GET /api/sessions/:id→投影落库；404/网络→console.warn+清锚+空态（不抛不阻断）
 *
 * 模式（沿 use-streaming-contract.test.ts 先例）: mock 全局 fetch（手工 ReadableStream 逐帧 push 构造
 * SSE 流）+ 真实 zustand store（getState() 前置 reset）+ fake timers 驱动 16ms flush。
 * 覆盖: 正常（URL/body/真流式/回声对账/全文/诊断透传）+ 降级（恢复 404/网络/解析失败/error 帧）
 * + 边界（abort 静默/无 window 守卫/clearSession 预留语义）+ 回归（diagnosis 模式逐字节等价）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStreamingController, type StreamingHost } from '../../electron-renderer/src/hooks/useStreaming';
import {
  useConversationStore,
  restoreMessages,
  readLastSessionId,
  LAST_SESSION_ID_STORAGE_KEY,
} from '../../electron-renderer/src/stores/conversation-store';
import { restoreLastSession } from '../../electron-renderer/src/components/CenterPanel';
import { useAppStore } from '../../electron-renderer/src/stores/app-store';

// ── 测试基建 ──────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:18901';

/** 真实 zustand store 前置 reset（不 mock 被测对象——铁律 12 精神） */
function resetStores(): void {
  useConversationStore.setState({
    messages: [], phase: 'idle', welcomeState: 'ready', errorMessage: null,
    phaseIndex: -1, phaseLabel: '', phaseTotal: 6,
    currentSessionId: null, draftPrefill: null, pendingIntent: null,
  });
  useAppStore.setState({ currentReportId: null });
}

interface MemoryStorage { map: Map<string, string> }

/** window 桩：localStorage（内存 Map）+ electronAPI.getServerUrl（生产 getApiBase 路径） */
function stubWindow(): MemoryStorage {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
  vi.stubGlobal('window', {
    localStorage,
    electronAPI: { getServerUrl: () => API_BASE },
  });
  return { map };
}

/** React 无关宿主桩（捕获 controller 的全部状态写入，供逐字累积断言） */
function createHostStub(): { state: { streaming: boolean; text: string; experts: string[] }; host: StreamingHost } {
  const state = { streaming: false, text: '', experts: [] as string[] };
  const host: StreamingHost = {
    setStreaming: (v) => { state.streaming = v; },
    appendStreaming: (t) => { state.text += t; },
    resetStreaming: () => { state.text = ''; },
    setExperts: (e) => { state.experts = e; },
  };
  return { state, host };
}

/** 手工 SSE 流：逐帧 push、可控时序（16ms flush 粒度断言依赖） */
function manualSSE() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    body: stream,
    push: (payload: Record<string, unknown>) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    },
    raw: (text: string) => { controller.enqueue(encoder.encode(text)); },
    close: () => { controller.close(); },
  };
}

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown>; body: ReadableStream<Uint8Array> | null };

function sseResponse(body: ReadableStream<Uint8Array>, ok = true): FakeResponse {
  return { ok, status: ok ? 200 : 500, json: async () => ({}), body };
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<FakeResponse>>();
let storage: MemoryStorage;

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  storage = stubWindow();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 驱动一轮：发消息 → 推帧 → 收流（fake timers 推进微任务与 flush 定时器） */
async function runTurn(
  ctrl: ReturnType<typeof createStreamingController>,
  text: string,
  frames: Array<(s: ReturnType<typeof manualSSE>) => void>,
  opts?: { mode: 'conversation' | 'diagnosis' },
): Promise<void> {
  const s = manualSSE();
  fetchMock.mockResolvedValueOnce(sseResponse(s.body));
  const p = opts ? ctrl.sendMessage(text, opts) : ctrl.sendMessage(text);
  await vi.advanceTimersByTimeAsync(0);
  for (const step of frames) step(s);
  await vi.advanceTimersByTimeAsync(20);
  s.close();
  await p;
}

/** 读取第 N 次 fetch 调用的请求体 JSON（类型化取参，零 as） */
function fetchBody(callIndex: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex]?.[1];
  return JSON.parse(String(init?.body ?? '')) as Record<string, unknown>;
}

// ── 用例 1: conversation 模式 URL 与 body（首条消息无 sessionId） ─────────

describe('D591-① conversation 模式 URL 与 body（接线: CenterPanel→useStreaming→/api/conversations）', () => {
  it("sendMessage('你好') 缺省 mode → POST {api}/api/conversations，body 恰为 {message:'你好'}", async () => {
    const { host } = createHostStub();
    const ctrl = createStreamingController(host);
    await runTurn(ctrl, '你好', [
      (s) => s.push({ type: 'open', sessionId: 'sess_c1' }),
      (s) => s.push({ type: 'agent_message', content: '你好！' }),
      (s) => s.push({ type: 'end' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/conversations`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchBody(0)).toEqual({ message: '你好' });
  });
});

// ── 用例 2: 真流式——token 帧逐字累积（16ms flush 粒度） ──────────────────

describe('D591-② 真流式（bufferRef += text + scheduleFlush，逐字累积非整块）', () => {
  it('3 个 token 帧 → streamingText 中间态逐字累积: 你 → 你好呀', async () => {
    const { state, host } = createHostStub();
    const ctrl = createStreamingController(host);
    const s = manualSSE();
    fetchMock.mockResolvedValue(sseResponse(s.body));
    const p = ctrl.sendMessage('你好');
    await vi.advanceTimersByTimeAsync(0);

    s.push({ type: 'open', sessionId: 'sess_t2' });
    s.push({ type: 'token', text: '你' });
    await vi.advanceTimersByTimeAsync(20);
    expect(state.text).toBe('你'); // 第一个 16ms flush 周期只见到第一个 token

    s.push({ type: 'token', text: '好' });
    s.push({ type: 'token', text: '呀' });
    await vi.advanceTimersByTimeAsync(20);
    expect(state.text).toBe('你好呀'); // 逐字累积

    s.push({ type: 'agent_message', content: '你好呀' });
    s.push({ type: 'end' });
    s.close();
    await p;
  });
});

// ── 用例 3: 提交回声 + open 帧 sessionId 对账 + 续轮携带 ─────────────────

describe('D591-③ 提交回声对账（open 帧 sessionId 落 store + localStorage；续轮 body 携带）', () => {
  it('open 帧 → currentSessionId + localStorage 落键；第二条消息 body 带 sessionId', async () => {
    const { host } = createHostStub();
    const ctrl = createStreamingController(host);

    // 第一轮: 新建会话
    await runTurn(ctrl, '你好', [
      (s) => s.push({ type: 'open', sessionId: 'sess_x' }),
      (s) => s.push({ type: 'agent_message', content: '你好！' }),
      (s) => s.push({ type: 'end' }),
    ]);
    expect(useConversationStore.getState().currentSessionId).toBe('sess_x');
    expect(storage.map.get(LAST_SESSION_ID_STORAGE_KEY)).toBe('sess_x');

    // 第二轮: 续轮——body 必须携带 sessionId
    await runTurn(ctrl, '第二条', [
      (s) => s.push({ type: 'open', sessionId: 'sess_x' }),
      (s) => s.push({ type: 'agent_message', content: '收到' }),
      (s) => s.push({ type: 'end' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchBody(1)).toEqual({ message: '第二条', sessionId: 'sess_x' });
  });
});

// ── 用例 4: agent_message 全文兜底 + 终态 ─────────────────────────────────

describe('D591-④ agent_message 帧 → assistant 全文落库 + streamingText 清空 + 终态', () => {
  it('全文落 messages；streamingText 清空；isStreaming=false、phase=done', async () => {
    const { state, host } = createHostStub();
    const ctrl = createStreamingController(host);
    await runTurn(ctrl, '介绍你自己', [
      (s) => s.push({ type: 'open', sessionId: 'sess_c4' }),
      (s) => s.push({ type: 'token', text: '我是' }),
      (s) => s.push({ type: 'agent_message', content: '我是 Synova，你的增长导航系统。' }),
      (s) => s.push({ type: 'end' }),
    ]);

    const msgs = useConversationStore.getState().messages;
    const last = msgs[msgs.length - 1];
    expect(last.type).toBe('assistant');
    expect(last.type === 'assistant' && last.content).toBe('我是 Synova，你的增长导航系统。');
    expect(state.text).toBe('');
    expect(state.streaming).toBe(false);
    expect(useConversationStore.getState().phase).toBe('done');
  });
});

// ── 用例 5: 诊断事件 flat 透传回归（conversation 流内诊断管道不变） ────────

describe('D591-⑤ 诊断事件 flat 透传（phase_started/degraded/complete 既有管道零改动）', () => {
  it('conversation 流内诊断事件 → 进度落 store、降级系统消息、reportId 落 app-store', async () => {
    const { host } = createHostStub();
    const ctrl = createStreamingController(host);
    await runTurn(ctrl, '你好', [
      (s) => s.push({ type: 'open', sessionId: 'sess_c5' }),
      (s) => s.push({ type: 'phase_started', phase: 0, label: '组织访谈' }),
      (s) => s.push({ type: 'degraded', moduleId: 'finance' }),
      (s) => s.push({ type: 'complete', report: { reportId: 'rpt_d591', summary: '完成' } }),
      (s) => s.push({ type: 'end' }),
    ]);

    const store = useConversationStore.getState();
    expect(store.phaseIndex).toBe(0);
    expect(store.phaseLabel).toBe('组织访谈');
    const degradedMsg = store.messages.find((m) => m.type === 'system' && m.content.includes('部分功能暂不可用'));
    expect(degradedMsg).toBeDefined();
    expect(store.messages.some((m) => m.type === 'system' && m.content.includes('finance'))).toBe(false);
    expect(store.messages.some((m) => m.type === 'system' && m.content.includes('诊断完成'))).toBe(true);
    expect(useAppStore.getState().currentReportId).toBe('rpt_d591');
  });
});

// ── 用例 6: restoreMessages 纯函数（投影/跳过/畸形/非形状） ────────────────

describe('D591-⑥ restoreMessages 纯函数（user/assistant 投影保序；非对话角色与畸形项跳过）', () => {
  it('user/assistant 保序投影；system/tool 跳过', () => {
    const out = restoreMessages({
      ok: true,
      session: { id: 'sess_p' },
      messages: [
        { role: 'user', content: '问题A', timestamp: '2026-09-08T10:00:00Z' },
        { role: 'assistant', content: '回答B' },
        { role: 'system', content: '系统提示' },
        { role: 'tool', content: '工具输出' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: 'user', content: '问题A', timestamp: '2026-09-08T10:00:00Z' });
    expect(out[1]).toEqual({ type: 'assistant', content: '回答B', timestamp: expect.any(String) });
  });

  it('畸形项（null/数字/缺 content/非 string content/空 content）逐项跳过不抛', () => {
    const out = restoreMessages({
      messages: [
        null,
        42,
        'str',
        { role: 'user' },
        { role: 'user', content: 123 },
        { role: 'assistant', content: '' },
        { role: 'user', content: '唯一有效' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: 'user', content: '唯一有效', timestamp: expect.any(String) });
  });

  it('非 {messages:[]} 形状（null/字符串/缺 messages）→ 空数组诚实空态', () => {
    expect(restoreMessages(null)).toEqual([]);
    expect(restoreMessages('unexpected')).toEqual([]);
    expect(restoreMessages({ foo: 1 })).toEqual([]);
    expect(restoreMessages({ messages: 'not-array' })).toEqual([]);
  });
});

// ── 用例 7: restoreLastSession（恢复 + 降级 + 空态） ──────────────────────

describe('D591-⑦ restoreLastSession（恢复投影 / 404+网络降级 / 无锚空态）', () => {
  it('有锚 + 200 → 投影落库 + sessionId 锚定（restored）', async () => {
    storage.map.set(LAST_SESSION_ID_STORAGE_KEY, 'sess_r1');
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        ok: true,
        messages: [
          { role: 'user', content: '早上好' },
          { role: 'assistant', content: '早上好！今天想聊什么？' },
          { role: 'system', content: '系统消息不投影' },
        ],
      }),
    });
    const r = await restoreLastSession();
    expect(r).toBe('restored');
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/api/sessions/${'sess_r1'}`);
    const store = useConversationStore.getState();
    expect(store.messages).toHaveLength(2);
    expect(store.messages[0].type).toBe('user');
    expect(store.messages[1].type === 'assistant' && store.messages[1].content).toBe('早上好！今天想聊什么？');
    expect(store.currentSessionId).toBe('sess_r1');
  });

  it('404 → console.warn + localStorage 键清除 + messages 保持空（degraded，不抛不阻断）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.map.set(LAST_SESSION_ID_STORAGE_KEY, 'sess_gone');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ ok: false }) });
    const r = await restoreLastSession();
    expect(r).toBe('degraded');
    expect(warn).toHaveBeenCalled();
    expect(storage.map.has(LAST_SESSION_ID_STORAGE_KEY)).toBe(false);
    expect(useConversationStore.getState().messages).toEqual([]);
    expect(useConversationStore.getState().currentSessionId).toBe(null);
    warn.mockRestore();
  });

  it('网络失败（fetch reject）→ 同样 degraded：warn + 清锚 + 空态', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.map.set(LAST_SESSION_ID_STORAGE_KEY, 'sess_net');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const r = await restoreLastSession();
    expect(r).toBe('degraded');
    expect(warn).toHaveBeenCalled();
    expect(storage.map.has(LAST_SESSION_ID_STORAGE_KEY)).toBe(false);
    expect(useConversationStore.getState().messages).toEqual([]);
    warn.mockRestore();
  });

  it('无本地锚 → empty：零 fetch、零副作用', async () => {
    const r = await restoreLastSession();
    expect(r).toBe('empty');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual([]);
  });
});

// ── 用例 8: diagnosis 模式回归（与 main@b54a0fb6 逐字节等价） ─────────────

describe('D591-⑧ diagnosis 模式回归（consult URL + 诊断 payload 形状不变）', () => {
  it("sendMessage(text, {mode:'diagnosis'}) → POST consult，body {teamId, initiator}", async () => {
    const { host } = createHostStub();
    const ctrl = createStreamingController(host);
    await runTurn(ctrl, '现金流恶化', [
      (s) => s.push({ type: 'complete', report: { reportId: 'rpt_dx', summary: '完成' } }),
      (s) => s.push({ type: 'end' }),
    ], { mode: 'diagnosis' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${API_BASE}/api/diagnosis/consult`);
    expect(fetchBody(0)).toEqual({
      teamId: '现金流恶化',
      initiator: { role: '管理者', name: '用户', concerns: ['现金流恶化'] },
    });
    // diagnosis 轮不落会话锚（conversation 专属语义）
    expect(useConversationStore.getState().currentSessionId).toBe(null);
  });
});

// ── 用例 9: 边界——abort 静默 + 解析失败跳帧不断流 + error 帧进错误条 ──────

describe('D591-⑨ 边界与降级（abort 静默 / JSON 解析失败 warn 跳帧 / error 帧落错误条数据）', () => {
  it('abort 中断 → AbortError 静默返回（无 error 落库、无异常抛出）', async () => {
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<FakeResponse>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const { state, host } = createHostStub();
    const ctrl = createStreamingController(host);
    const p = ctrl.sendMessage('你好');
    await vi.advanceTimersByTimeAsync(0);
    ctrl.cancelStreaming();
    await expect(p).resolves.toBeUndefined();
    expect(useConversationStore.getState().errorMessage).toBe(null);
    expect(useConversationStore.getState().phase).toBe('idle');
    expect(state.streaming).toBe(false);
  });

  it('SSE data JSON 解析失败 → console.warn 跳帧，后续合法帧继续消费（不断流）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = createHostStub();
    const ctrl = createStreamingController(host);
    await runTurn(ctrl, '你好', [
      (s) => s.raw('data: {broken-json-frame\n\n'),
      (s) => s.push({ type: 'token', text: '仍' }),
      (s) => s.push({ type: 'agent_message', content: '仍然可达' }),
      (s) => s.push({ type: 'end' }),
    ]);
    expect(warn).toHaveBeenCalled(); // 铁律 24: 不静默
    expect(useConversationStore.getState().messages.some((m) => m.type === 'assistant' && m.content === '仍然可达')).toBe(true);
    warn.mockRestore();
  });

  it('error 帧 → setError + phase=error（CenterPanel 错误条数据源，铁律 31）', async () => {
    const { host } = createHostStub();
    const ctrl = createStreamingController(host);
    await runTurn(ctrl, '你好', [
      (s) => s.push({ type: 'error', code: 'CONVERSATION_ERROR', message: 'LLM 不可用' }),
      (s) => s.push({ type: 'end' }),
    ]);
    expect(useConversationStore.getState().errorMessage).toBe('LLM 不可用');
    expect(useConversationStore.getState().phase).toBe('error');
  });
});

// ── 补充: store 单元语义（锚持久化守卫 + clearSession 预留 API） ──────────

describe('D591-⑩ conversation-store 锚持久化与预留 API', () => {
  it('setCurrentSessionId(null) → 清 store + 清 localStorage 键', () => {
    useConversationStore.getState().setCurrentSessionId('sess_a');
    expect(storage.map.get(LAST_SESSION_ID_STORAGE_KEY)).toBe('sess_a');
    useConversationStore.getState().setCurrentSessionId(null);
    expect(useConversationStore.getState().currentSessionId).toBe(null);
    expect(storage.map.has(LAST_SESSION_ID_STORAGE_KEY)).toBe(false);
  });

  it('readLastSessionId: 有键读键，无键 null', () => {
    expect(readLastSessionId()).toBe(null);
    storage.map.set(LAST_SESSION_ID_STORAGE_KEY, 'sess_b');
    expect(readLastSessionId()).toBe('sess_b');
  });

  it('无 window 环境（node/SSR 守卫）→ setCurrentSessionId 不抛、readLastSessionId null', () => {
    vi.unstubAllGlobals();
    expect(() => useConversationStore.getState().setCurrentSessionId('sess_c')).not.toThrow();
    expect(readLastSessionId()).toBe(null);
    stubWindow(); // 恢复桩，避免影响后续断言
  });

  it('clearSession（§8 登记的预留 API）→ messages/sessionId/预填/意图全清 + 键删除', () => {
    useConversationStore.getState().setCurrentSessionId('sess_d');
    useConversationStore.getState().addMessage({ type: 'user', content: '历史', timestamp: new Date().toISOString() });
    useConversationStore.getState().setDraftPrefill('预填');
    useConversationStore.getState().setPendingIntent('diagnosis');
    useConversationStore.getState().clearSession();
    const store = useConversationStore.getState();
    expect(store.messages).toEqual([]);
    expect(store.currentSessionId).toBe(null);
    expect(store.draftPrefill).toBe(null);
    expect(store.pendingIntent).toBe(null);
    expect(storage.map.has(LAST_SESSION_ID_STORAGE_KEY)).toBe(false);
  });

  it('store.restoreMessages 批量替换（恢复路径专用）并注入 _id 供渲染 key', () => {
    useConversationStore.getState().restoreMessages([
      { type: 'user', content: 'r1', timestamp: 't' },
      { type: 'assistant', content: 'r2', timestamp: 't' },
    ]);
    const msgs = useConversationStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]._id).toBeDefined();
    expect(msgs[1]._id).toBeDefined();
  });
});
