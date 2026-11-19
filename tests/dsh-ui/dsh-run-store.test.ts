/**
 * tests/dsh-ui/dsh-run-store.test.ts — #1429 I-2 DSH 运行状态机
 *
 * 覆盖（DEV DOC v1 §5／§7 ＋ v2 变更 5）：
 *   · 输入先校验（空／超限本地拒绝、零请求）；未登录零请求
 *   · 发起（starting→running）、sessionId 只来自 SSE session.created
 *   · 事件归并（同 seq 不重复、tool.finished 归并到 tool.started）
 *   · 断流（不显示完成、可重连、重连带最后 seq、重放不重复）
 *   · 终态：run.completed（含 empty）／run.failed／run.cancelled（取消以事件为准）
 *   · 401 → expired；close 成败可见
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createDshRunStore,
  type DshRunDependencies,
} from '../../electron-renderer/src/stores/dsh-run-store';
import type {
  DshCallError,
  DshCancelResult,
  DshCloseResult,
  DshEvent,
  DshEventHandlers,
  DshEventSource,
  DshRunStartResult,
} from '../../electron-renderer/src/lib/dsh-run-api';
import type { DshAuthState, AuthSnapshot } from '../../electron-renderer/src/lib/auth-session';

interface StreamCall {
  runId: string;
  lastEventId: number;
  handlers: DshEventHandlers;
  closed: boolean;
}

interface Harness {
  store: ReturnType<typeof createDshRunStore>;
  startRun: ReturnType<typeof vi.fn>;
  openRunEvents: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
  closeSession: ReturnType<typeof vi.fn>;
  streams: StreamCall[];
  emit: (event: DshEvent) => void;
  endStream: () => void;
  failStream: (failure: DshCallError) => void;
  setAuth: (state: DshAuthState) => void;
}

function harness(options: {
  auth?: DshAuthState;
  start?: DshRunStartResult | (() => Promise<DshRunStartResult>);
  cancel?: DshCancelResult;
  close?: DshCloseResult;
  onStart?: () => void;
} = {}): Harness {
  let authState: DshAuthState = options.auth ?? 'devmode';
  const streams: StreamCall[] = [];
  const startRun = vi.fn(async (_input: string): Promise<DshRunStartResult> => {
    options.onStart?.();
    if (typeof options.start === 'function') return options.start();
    return options.start ?? { kind: 'ok', runId: 'run_abc12345', sessionId: null };
  });
  const openRunEvents = vi.fn((runId: string, lastEventId: number, handlers: DshEventHandlers): DshEventSource => {
    const call: StreamCall = { runId, lastEventId, handlers, closed: false };
    streams.push(call);
    return { close: () => { call.closed = true; } };
  });
  const cancelRun = vi.fn(async (_runId: string): Promise<DshCancelResult> => options.cancel ?? { kind: 'ok', status: 'cancelled', cancelRequested: true });
  const closeSession = vi.fn(async (_sessionId: string): Promise<DshCloseResult> => options.close ?? { kind: 'ok' });
  const dependencies: DshRunDependencies = {
    startRun: startRun as DshRunDependencies['startRun'],
    openRunEvents: openRunEvents as DshRunDependencies['openRunEvents'],
    cancelRun: cancelRun as DshRunDependencies['cancelRun'],
    closeSession: closeSession as DshRunDependencies['closeSession'],
    authSnapshot: (): AuthSnapshot => ({
      mode: authState === 'devmode' ? 'devmode' : 'token',
      token: authState === 'authenticated' ? 'jwt-memory-only' : null,
      state: authState,
    }),
  };
  const store = createDshRunStore(dependencies);
  const current = (): StreamCall | undefined => streams[streams.length - 1];
  return {
    store, startRun, openRunEvents, cancelRun, closeSession, streams,
    emit: (event) => current()?.handlers.onEvent(event),
    endStream: () => current()?.handlers.onEnd(),
    failStream: (failure) => current()?.handlers.onError(failure),
    setAuth: (state) => { authState = state; },
  };
}

describe('#1429 dsh-run-store 输入校验与未登录零请求', () => {
  it('空／纯空白输入本地拒绝：inputError 可见且零 startRun', async () => {
    const h = harness();
    h.store.getState().setInput('   ');
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledTimes(0);
    expect(h.store.getState().inputError).toContain('请输入');
    expect(h.store.getState().status).toBe('idle');
  });

  it('超过 100,000 字符本地拒绝；恰好 100,000 允许（边界）', async () => {
    const h = harness();
    h.store.getState().setInput('x'.repeat(100_001));
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledTimes(0);
    expect(h.store.getState().inputError).toContain('100000');

    h.store.getState().setInput('x'.repeat(100_000));
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledTimes(1);
  });

  it('未登录（token 模式无 token）不发 run：零 startRun，状态保持 idle', async () => {
    const h = harness({ auth: 'unauthenticated' });
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledTimes(0);
    expect(h.store.getState().status).toBe('idle');
    expect(h.store.getState().auth).toBe('unauthenticated');
  });

  it('登录过期（expired）同样不发 run', async () => {
    const h = harness({ auth: 'expired' });
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledTimes(0);
    expect(h.store.getState().status).toBe('idle');
  });
});

describe('#1429 dsh-run-store 发起、sessionId 与事件归并', () => {
  it('DevMode 发起：startRun(input) → running，随后以 runId/0 打开事件流', async () => {
    const h = harness();
    h.store.getState().setInput('分析本月销售');
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledWith('分析本月销售');
    expect(h.store.getState()).toMatchObject({ status: 'running', runId: 'run_abc12345', lastEventId: 0, events: [] });
    expect(h.openRunEvents).toHaveBeenCalledTimes(1);
    expect(h.streams[0]).toMatchObject({ runId: 'run_abc12345', lastEventId: 0 });
  });

  it('运行中重复 submit 不产生第二次 startRun', async () => {
    const h = harness();
    h.store.getState().setInput('第一轮');
    await h.store.getState().submit();
    h.store.getState().setInput('第二轮');
    await h.store.getState().submit();
    expect(h.startRun).toHaveBeenCalledTimes(1);
  });

  it('sessionId 只来自 SSE session.created（POST 响应 sessionId=null 不解成字符串 null）', async () => {
    const h = harness();
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    expect(h.store.getState().sessionId).toBe(null);
    h.emit({ seq: 1, type: 'session.created', data: { sessionId: 'sess_abc12345' } });
    expect(h.store.getState().sessionId).toBe('sess_abc12345');
    expect(h.store.getState().lastEventId).toBe(1);
  });

  it('同 seq 事件不重复追加；lastEventId 取最大 seq', async () => {
    const h = harness();
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    h.emit({ seq: 1, type: 'text.delta', data: { text: '你' } });
    h.emit({ seq: 2, type: 'tool.started', data: { toolCallId: 'call_1', title: '读取清单', kind: 'read', status: 'pending' } });
    h.emit({ seq: 2, type: 'tool.started', data: { toolCallId: 'call_1', title: '读取清单', kind: 'read', status: 'pending' } });
    expect(h.store.getState().events).toHaveLength(2);
    expect(h.store.getState().lastEventId).toBe(2);
  });

  it('tool.finished 归并到同 toolCallId 的 tool.started（不新增第二行），状态/isError 更新', async () => {
    const h = harness();
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    h.emit({ seq: 1, type: 'tool.started', data: { toolCallId: 'call_1', title: '读取清单', kind: 'read', status: 'pending' } });
    h.emit({ seq: 2, type: 'tool.finished', data: { toolCallId: 'call_1', status: 'failed', isError: true } });
    const events = h.store.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'tool', toolCallId: 'call_1', title: '读取清单', toolKind: 'read', status: 'failed', isError: true });
    expect(h.store.getState().lastEventId).toBe(2);
  });

  it('未承诺事件（reasoning.delta／egress.recorded）不进事件列表（白名单投影）', async () => {
    const h = harness();
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    h.emit({ seq: 1, type: 'reasoning.delta', data: { text: '思考' } });
    h.emit({ seq: 2, type: 'egress.recorded', data: { sha256: 'abc' } });
    expect(h.store.getState().events).toEqual([]);
  });
});

describe('#1429 dsh-run-store 断流、重连与终态', () => {
  async function running(): Promise<Harness> {
    const h = harness();
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    return h;
  }

  it('断流：推非终态后 stream onEnd ⇒ failed＋「连接中断」＋可重连，绝不 done', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'text.delta', data: { text: '半截' } });
    h.endStream();
    const state = h.store.getState();
    expect(state.status).toBe('failed');
    expect(state.status).not.toBe('done');
    expect(state.error?.code).toBe('STREAM_INTERRUPTED');
    expect(state.error?.message).toContain('连接中断');
    expect(state.error?.canReconnect).toBe(true);
  });

  it('重连携带已收最后 seq；重放旧事件不重复；随后 run.cancelled 才转 cancelled', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'text.delta', data: { text: '半截' } });
    h.endStream();
    h.store.getState().reconnect();
    expect(h.openRunEvents).toHaveBeenCalledTimes(2);
    expect(h.streams[1]).toMatchObject({ runId: 'run_abc12345', lastEventId: 1 });
    expect(h.store.getState().status).toBe('running');

    h.emit({ seq: 1, type: 'text.delta', data: { text: '半截' } });
    expect(h.store.getState().events).toHaveLength(1);
    h.emit({ seq: 2, type: 'run.cancelled', data: { reason: 'client cancel' } });
    expect(h.store.getState().status).toBe('cancelled');
  });

  it('run.completed 且 empty=true ⇒ done＋empty 标记（面板显示无结果而非成功）', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'run.completed', data: { stopReason: 'end_turn', stats: { textDeltas: 0, toolCalls: 0 }, empty: true } });
    expect(h.store.getState()).toMatchObject({ status: 'done', empty: true });
  });

  it('run.completed 且 empty=false ⇒ done 且 empty=false', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'text.delta', data: { text: '结果' } });
    h.emit({ seq: 2, type: 'run.completed', data: { stopReason: 'end_turn', stats: { textDeltas: 1, toolCalls: 0 }, empty: false } });
    expect(h.store.getState()).toMatchObject({ status: 'done', empty: false });
  });

  it('run.failed ⇒ failed＋服务端 code/phase/retryable 原样可见', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'run.failed', data: { code: 'RUN_FAILED', phase: 'run', retryable: true, message: '进程未启动' } });
    const state = h.store.getState();
    expect(state.status).toBe('failed');
    expect(state.error).toMatchObject({ code: 'RUN_FAILED', phase: 'run', retryable: true, message: '进程未启动', canReconnect: false });
  });

  it('取消：POST 返回 cancelled 也不改状态（等 SSE run.cancelled）', async () => {
    const h = await running();
    await h.store.getState().cancel();
    expect(h.cancelRun).toHaveBeenCalledWith('run_abc12345');
    expect(h.store.getState().status).toBe('running');
    expect(h.store.getState().cancelPending).toBe(true);
    h.emit({ seq: 1, type: 'run.cancelled', data: { reason: 'client cancel' } });
    expect(h.store.getState()).toMatchObject({ status: 'cancelled', cancelPending: false });
  });

  it('取消接口失败（409）⇒ failed＋错误可见，不伪造已取消', async () => {
    const h = harness({ cancel: { kind: 'error', httpStatus: 409, code: 'RUN_CONFLICT', phase: 'run', retryable: false, message: '运行已结束' } });
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    await h.store.getState().cancel();
    expect(h.store.getState().status).toBe('failed');
    expect(h.store.getState().error).toMatchObject({ httpStatus: 409, code: 'RUN_CONFLICT' });
  });

  it('发起 401 ⇒ status=expired 且 auth=expired（登录失效可见，不空成功）', async () => {
    const h: Harness = harness({
      auth: 'authenticated',
      start: { kind: 'error', httpStatus: 401, code: 'UNAUTHORIZED', phase: 'auth', retryable: false, message: '缺少验签身份' },
      onStart: () => { h.setAuth('expired'); },
    });
    h.store.getState().setInput('你好');
    await h.store.getState().submit();
    expect(h.store.getState().status).toBe('expired');
    expect(h.store.getState().auth).toBe('expired');
    expect(h.openRunEvents).toHaveBeenCalledTimes(0);
  });

  it('close 成功 ⇒ sessionClosed=true；close 失败 ⇒ 错误可见且不显示已关闭', async () => {
    const ok = harness();
    ok.store.getState().setInput('你好');
    await ok.store.getState().submit();
    ok.emit({ seq: 1, type: 'session.created', data: { sessionId: 'sess_abc12345' } });
    await ok.store.getState().close();
    expect(ok.closeSession).toHaveBeenCalledWith('sess_abc12345');
    expect(ok.store.getState().sessionClosed).toBe(true);

    const failed = harness({ close: { kind: 'degraded', reason: '关闭失败：网络异常', retryable: true } });
    failed.store.getState().setInput('你好');
    await failed.store.getState().submit();
    failed.emit({ seq: 1, type: 'session.created', data: { sessionId: 'sess_abc12345' } });
    await failed.store.getState().close();
    expect(failed.store.getState().sessionClosed).toBe(false);
    expect(failed.store.getState().error?.message).toContain('关闭失败');
  });
});
