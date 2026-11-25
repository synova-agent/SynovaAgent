/**
 * tests/dsh-ui/dsh-hypothesis-1459.test.ts — #1459 T-B 桌面消费结构化瓶颈假设 ＋ P1 不可逆丢弃修复
 *
 * 覆盖（编码指令 T-B 三条 ＋ DEV DOC §5 结构化通道 / §7 验收 4）：
 *   ① 白名单增 hypothesis 类事件：`hypothesis.structured` 进 events，四要素原样非空
 *   ② 缺字段 ⇒ `structured:false`（不猜补）＋ 面板显式标「未结构化」且不崩
 *   ③ `hypothesis.invalid` ⇒ 服务端 reason 优先，按未结构化呈现
 *   ④ P1：处理并留痕后才推进 lastEventId；未知事件留存进 pending，**断流重连后仍在**
 *   ⑤ 断开重连后结构化假设仍在（重放同 seq 不产生第二张卡）
 *
 * 注：渲染走 electron-renderer/src/test-support/render.ts（不执行 hook）⇒ 面板必须受控。
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';
import { DshRunPanel, type DshRunPanelProps } from '../../electron-renderer/src/components/DshRunPanel';
import {
  createDshRunStore,
  type DshRunDependencies,
  type DshRunEventItem,
} from '../../electron-renderer/src/stores/dsh-run-store';
import type {
  DshCancelResult,
  DshCloseResult,
  DshEvent,
  DshEventHandlers,
  DshEventSource,
  DshRunStartResult,
} from '../../electron-renderer/src/lib/dsh-run-api';
import type { AuthSnapshot } from '../../electron-renderer/src/lib/auth-session';

interface StreamCall {
  runId: string;
  lastEventId: number;
  handlers: DshEventHandlers;
  closed: boolean;
}

interface Harness {
  store: ReturnType<typeof createDshRunStore>;
  streams: StreamCall[];
  emit: (event: DshEvent) => void;
  endStream: () => void;
}

function harness(): Harness {
  const streams: StreamCall[] = [];
  const dependencies: DshRunDependencies = {
    startRun: async (): Promise<DshRunStartResult> => ({ kind: 'ok', runId: 'run_1459_tb', sessionId: null }),
    openRunEvents: (runId: string, lastEventId: number, handlers: DshEventHandlers): DshEventSource => {
      const call: StreamCall = { runId, lastEventId, handlers, closed: false };
      streams.push(call);
      return { close: () => { call.closed = true; } };
    },
    cancelRun: async (): Promise<DshCancelResult> => ({ kind: 'ok', status: 'cancelled', cancelRequested: true }),
    closeSession: async (): Promise<DshCloseResult> => ({ kind: 'ok' }),
    authSnapshot: (): AuthSnapshot => ({ mode: 'devmode', token: null, state: 'devmode' }),
  };
  const store = createDshRunStore(dependencies);
  const current = (): StreamCall | undefined => streams[streams.length - 1];
  return {
    store,
    streams,
    emit: (event) => current()?.handlers.onEvent(event),
    endStream: () => current()?.handlers.onEnd(),
  };
}

async function running(): Promise<Harness> {
  const h = harness();
  h.store.getState().setInput('我们增长卡在哪');
  await h.store.getState().submit();
  expect(h.store.getState().status).toBe('running');
  return h;
}

/** 合格四要素载荷（来源形态取自 DEV DOC §0 探针实测：$id / predicate / source_ref） */
function structuredData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hypothesis: '交付验收口径与实收不一致，卡在批次验收环节',
    objects: ['team:delivery-a', 'delivery_batch:B-2026-10-001'],
    relations: ['edge/team_executes_activity'],
    evidence: ['delivery_batches.csv#L2', 'acceptance_records.csv#L7'],
    uncertainty: ['仅覆盖 2026-10 一个期间', '假设批次验收记录完整'],
    schemaVersion: 'v1',
    ...overrides,
  };
}

type HypothesisItem = Extract<DshRunEventItem, { kind: 'hypothesis' }>;

function hypothesisItems(events: DshRunEventItem[]): HypothesisItem[] {
  return events.filter((item): item is HypothesisItem => item.kind === 'hypothesis');
}

function props(overrides: Partial<DshRunPanelProps> = {}): DshRunPanelProps {
  return {
    input: '',
    inputError: null,
    status: 'running',
    auth: 'devmode',
    runId: 'run_1459_tb',
    sessionId: null,
    events: [],
    error: null,
    empty: false,
    cancelPending: false,
    sessionClosed: false,
    onInputChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<DshRunPanelProps> = {}): string {
  return renderToStaticMarkup(React.createElement(DshRunPanel, props(overrides)));
}

/** 从 store 取到 hypothesis 项后直接渲染面板（避免各用例重复取 state） */
function renderStoreEvents(store: ReturnType<typeof createDshRunStore>): string {
  const state = store.getState();
  return render({ status: state.status, events: state.events });
}

describe('#1459 T-B 白名单：hypothesis.structured 进 events 且四要素非空', () => {
  it('合格载荷 ⇒ events 增 kind=hypothesis，四要素原样保留（不裁剪/不改写/不排序）', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'hypothesis.structured', data: structuredData() });

    const state = h.store.getState();
    expect(state.events).toHaveLength(1);
    const [item] = hypothesisItems(state.events);
    expect(item).toBeDefined();
    expect(item.hypothesis.structured).toBe(true);
    expect(item.hypothesis.invalidReason).toBe(null);
    expect(item.hypothesis.claim).toBe('交付验收口径与实收不一致，卡在批次验收环节');
    expect(item.hypothesis.objects).toEqual(['team:delivery-a', 'delivery_batch:B-2026-10-001']);
    expect(item.hypothesis.relations).toEqual(['edge/team_executes_activity']);
    expect(item.hypothesis.evidence).toEqual(['delivery_batches.csv#L2', 'acceptance_records.csv#L7']);
    expect(item.hypothesis.uncertainty).toEqual(['仅覆盖 2026-10 一个期间', '假设批次验收记录完整']);
    expect(item.hypothesis.schemaVersion).toBe('v1');
    expect(item.hypothesis.objects.length).toBeGreaterThan(0);
    expect(item.hypothesis.relations.length).toBeGreaterThan(0);
    expect(item.hypothesis.evidence.length).toBeGreaterThan(0);
    expect(item.hypothesis.uncertainty.length).toBeGreaterThan(0);
  });

  it('渲染：四要素各自成段可见，标题为「瓶颈假设」，依据标「依据」', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'hypothesis.structured', data: structuredData() });

    const html = renderStoreEvents(h.store);
    expect(html).toContain('瓶颈假设');
    expect(html).toContain('data-hypothesis-structured="true"');
    for (const field of ['objects', 'relations', 'evidence', 'uncertainty']) {
      expect(html, `缺字段段 ${field}`).toContain(`data-hypothesis-field="${field}"`);
    }
    expect(html).toContain('对象');
    expect(html).toContain('关系');
    expect(html).toContain('依据');
    expect(html).toContain('还不确定的部分');
    // 取值原样可见（依据可回来源 ⇒ source_ref 必须渲染出来）
    expect(html).toContain('team:delivery-a');
    expect(html).toContain('delivery_batch:B-2026-10-001');
    expect(html).toContain('edge/team_executes_activity');
    expect(html).toContain('delivery_batches.csv#L2');
    expect(html).toContain('acceptance_records.csv#L7');
    expect(html).toContain('仅覆盖 2026-10 一个期间');
    expect(html).not.toContain('未结构化');
    // UI 只呈现不判断：不得出现裁决式措辞
    expect(html).not.toContain('诊断结论');
    expect(html).not.toContain('确诊');
  });
});

describe('#1459 T-B 缺字段 ⇒ 未结构化（不猜补、不崩）', () => {
  const cases: Array<{ missing: string; payload: Record<string, unknown> }> = [
    { missing: 'hypothesis', payload: structuredData({ hypothesis: undefined }) },
    { missing: 'objects', payload: structuredData({ objects: undefined }) },
    { missing: 'relations', payload: structuredData({ relations: undefined }) },
    { missing: 'evidence', payload: structuredData({ evidence: undefined }) },
    { missing: 'uncertainty', payload: structuredData({ uncertainty: undefined }) },
  ];

  it.each(cases)('缺 $missing ⇒ structured=false 且 invalidReason 点名缺项；事件仍进 events（不丢）', async ({ missing, payload }) => {
    const h = await running();
    h.emit({ seq: 1, type: 'hypothesis.structured', data: payload });

    const state = h.store.getState();
    expect(state.events).toHaveLength(1);
    const [item] = hypothesisItems(state.events);
    expect(item.hypothesis.structured).toBe(false);
    expect(item.hypothesis.invalidReason).toContain(missing);
    expect(item.hypothesis.schemaVersion).toBe('v1');
  });

  it('空数组／元素非字符串／空白项／非数组 一律判未结构化（拒绝"看起来像"的载荷）', async () => {
    const payloads: Array<Record<string, unknown>> = [
      structuredData({ objects: [] }),
      structuredData({ relations: [42] }),
      structuredData({ evidence: ['   '] }),
      structuredData({ uncertainty: 'not-an-array' }),
    ];
    for (const payload of payloads) {
      const h = await running();
      h.emit({ seq: 1, type: 'hypothesis.structured', data: payload });
      const [item] = hypothesisItems(h.store.getState().events);
      expect(item.hypothesis.structured, JSON.stringify(payload)).toBe(false);
      expect(item.hypothesis.invalidReason).not.toBe(null);
    }
  });

  it('渲染：缺字段 ⇒ 显示「未结构化」＋原因，不崩、不画四要素段、不凭空补要素', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'hypothesis.structured', data: structuredData({ relations: undefined, evidence: undefined }) });

    const html = renderStoreEvents(h.store);
    expect(html).toContain('未结构化');
    expect(html).toContain('data-hypothesis-structured="false"');
    expect(html).toContain('relations');
    expect(html).toContain('evidence');
    for (const field of ['objects', 'relations', 'evidence', 'uncertainty']) {
      expect(html, `未结构化却渲染了 ${field} 段`).not.toContain(`data-hypothesis-field="${field}"`);
    }
    expect(html).not.toContain('edge/team_executes_activity');
  });

  it('hypothesis.invalid ⇒ 服务端 reason 优先，按未结构化呈现（原样文本可选）', async () => {
    const h = await running();
    // 即便远端误把四要素填全，只要事件是 invalid，就不得渲染成卡片
    h.emit({
      seq: 1,
      type: 'hypothesis.invalid',
      data: { reason: '四要素缺 evidence', text: '模型原样输出', ...structuredData() },
    });
    const [item] = hypothesisItems(h.store.getState().events);
    expect(item.hypothesis.structured).toBe(false);
    expect(item.hypothesis.invalidReason).toBe('四要素缺 evidence');
    expect(item.hypothesis.rawText).toBe('模型原样输出');

    const html = renderStoreEvents(h.store);
    expect(html).toContain('未结构化');
    expect(html).toContain('四要素缺 evidence');
    expect(html).toContain('模型原样输出');
    expect(html).not.toContain('data-hypothesis-structured="true"');
  });

  it('hypothesis.invalid 无 reason ⇒ 给出可见默认原因，不静默', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'hypothesis.invalid', data: {} });
    const [item] = hypothesisItems(h.store.getState().events);
    expect(item.hypothesis.structured).toBe(false);
    expect(item.hypothesis.invalidReason).toBe('服务端标记为未结构化');
    expect(renderStoreEvents(h.store)).toContain('未结构化');
  });
});

describe('#1459 T-B P1：未知事件不再被不可逆丢弃', () => {
  it('未知事件留存进 pending（仍不进 events 白名单投影），且处理后才推进 lastEventId', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'reasoning.delta', data: { text: '思考中' } });
    h.emit({ seq: 2, type: 'egress.recorded', data: { sha256: 'abc', chars: 3 } });

    const state = h.store.getState();
    // 白名单投影不变：不把未知事件体渲染进界面
    expect(state.events).toEqual([]);
    // 但不得丢弃：留存可见（含原样 data，便于复查）
    expect(state.pending).toHaveLength(2);
    expect(state.pending[0]).toMatchObject({ seq: 1, type: 'reasoning.delta', data: { text: '思考中' } });
    expect(state.pending[1]).toMatchObject({ seq: 2, type: 'egress.recorded' });
    expect(state.pendingDropped).toBe(0);
    expect(state.lastEventId).toBe(2);
  });

  it('断流重连后未知事件仍在（旧实现：水位已越过 ⇒ 重放也不再补发 ⇒ 永久缺失）', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'reasoning.delta', data: { text: '思考中' } });
    h.emit({ seq: 2, type: 'text.delta', data: { text: '半截' } });
    expect(h.store.getState().pending).toHaveLength(1);

    h.endStream();
    expect(h.store.getState().error?.canReconnect).toBe(true);

    h.store.getState().reconnect();
    expect(h.streams).toHaveLength(2);
    expect(h.streams[1]).toMatchObject({ runId: 'run_1459_tb', lastEventId: 2 });

    const after = h.store.getState();
    // 关键断言：重连后该未知事件仍在 store 里（不再"永久缺失"）
    expect(after.pending).toHaveLength(1);
    expect(after.pending[0]).toMatchObject({ seq: 1, type: 'reasoning.delta', data: { text: '思考中' } });
    // 服务端若仍重发 seq 1，按 seq 去重：不重复留存
    h.emit({ seq: 1, type: 'reasoning.delta', data: { text: '思考中' } });
    expect(h.store.getState().pending).toHaveLength(1);
  });

  it('留存上限内逐条可见；超限丢最旧且丢弃条数可见（不静默丢）', async () => {
    const h = await running();
    for (let seq = 1; seq <= 205; seq += 1) {
      h.emit({ seq, type: 'reasoning.delta', data: { text: `片段 ${seq}` } });
    }
    const state = h.store.getState();
    expect(state.pending).toHaveLength(200);
    expect(state.pendingDropped).toBe(5);
    expect(state.pending[0].seq).toBe(6);
    expect(state.pending[199].seq).toBe(205);
  });

  it('新一次运行清空 pending（不与上一轮混淆）', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'reasoning.delta', data: { text: '上一轮' } });
    expect(h.store.getState().pending).toHaveLength(1);

    h.emit({ seq: 2, type: 'run.completed', data: { empty: false } });
    h.store.getState().setInput('再跑一轮');
    await h.store.getState().submit();
    expect(h.store.getState().pending).toEqual([]);
    expect(h.store.getState().pendingDropped).toBe(0);
  });

  it('非法 seq 不推进水位；合法事件推进后续订值与之相等', async () => {
    const h = await running();
    h.emit({ seq: 0, type: 'text.delta', data: { text: '非法 seq' } });
    h.emit({ seq: Number.NaN, type: 'text.delta', data: { text: '非法 seq' } });
    expect(h.store.getState().lastEventId).toBe(0);
    expect(h.store.getState().events).toEqual([]);

    h.emit({ seq: 3, type: 'hypothesis.structured', data: structuredData() });
    expect(h.store.getState().lastEventId).toBe(3);
    h.endStream();
    h.store.getState().reconnect();
    expect(h.streams[1].lastEventId).toBe(3);
  });
});

describe('#1459 T-B 断开重连后结构化假设仍在（验收第三条）', () => {
  it('假设事件在重连后仍渲染四要素；服务端重放同 seq 不产生第二张卡', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'text.delta', data: { text: '正在读取本体…' } });
    h.emit({ seq: 2, type: 'hypothesis.structured', data: structuredData() });

    h.endStream();
    expect(h.store.getState().status).toBe('failed');
    h.store.getState().reconnect();
    expect(h.streams[1].lastEventId).toBe(2);

    // 服务端重放已见 seq ⇒ 去重后不得重复
    h.emit({ seq: 1, type: 'text.delta', data: { text: '正在读取本体…' } });
    h.emit({ seq: 2, type: 'hypothesis.structured', data: structuredData() });

    const state = h.store.getState();
    expect(hypothesisItems(state.events)).toHaveLength(1);
    expect(state.events).toHaveLength(2);

    const html = renderStoreEvents(h.store);
    expect(html).toContain('瓶颈假设');
    expect(html).toContain('delivery_batches.csv#L2');
    expect(html).toContain('还不确定的部分');
  });

  it('重连后仍可判终态：run.completed ⇒ done，假设仍在', async () => {
    const h = await running();
    h.emit({ seq: 1, type: 'hypothesis.structured', data: structuredData() });
    h.endStream();
    h.store.getState().reconnect();
    h.emit({ seq: 2, type: 'run.completed', data: { empty: false } });

    const state = h.store.getState();
    expect(state.status).toBe('done');
    expect(hypothesisItems(state.events)).toHaveLength(1);
    expect(renderStoreEvents(h.store)).toContain('team:delivery-a');
  });
});
