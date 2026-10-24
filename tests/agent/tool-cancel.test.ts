/**
 * tests/agent/tool-cancel.test.ts — #915 Q-5 工具取消语义（signal 贯穿＋副作用前 throwIfAborted）
 *
 * 被测对象 = **真实生产类** ToolRegistry / ToolLoopExecutor / ConversationEngine / WebViewAdapter，
 * 不 mock 管线（铁律 12）：只替换 provider 这一外部传输边界
 * （照 tests/agent/tool-loop-executor-resilience.integration.test.ts 形态）。
 *
 * 覆盖规格 §5.1 S1–S11（铁律 48：每条必有 expect）:
 *   S1 已 abort signal ⇒ BEFORE_DISPATCH 且 handler 零调用
 *   S2 handler 内 await 后 throwIfAborted ⇒ ABORTED 且副作用零调用
 *   S3 无 signal ⇒ 正常执行（防"全取消"假绿）
 *   S4 SYNO_TOOL_ABORT=0 ⇒ 回旧行为（测试后恢复 env）
 *   S5 循环入场前 abort ⇒ TOOL_CANCELLED_REPLY 且不发 LLM
 *   S6 工具执行中 abort ⇒ 第 2 轮不发 LLM、第 2 个工具零调用、已生成前缀 ⊆ 返回内容
 *   S7 流式版 S6（onToken 前缀 ⊆ 返回内容，中断锚不变量）
 *   S8 executeParallel + aborted ⇒ 两工具均 BEFORE_DISPATCH
 *   S9 handler 收到的 ctx.signal 身份 === 传入 signal（严格相等）
 *   S10 WebViewAdapter 假 res emit('close') ⇒ signal.aborted + reason.message
 *   S11 引擎 processMessage 入场 abort ⇒ 取消文案且 chatCalls===0
 *
 * 改坏探针（判据常驻，规格 §5.3 M1–M4 — 改坏任一项 ⇒ 对应用例必红）:
 *   M1 删 src/agent/tools.ts execute 里 `signal?.throwIfAborted()`（dispatch 前）
 *      ⇒ S1 期望 BEFORE_DISPATCH 实得正常执行 ⇒ 红；S5 仍绿（循环层另有检查）但 S1 红。
 *   M2 删 src/agent/tools.ts local 分支把 ctx 传给 handler 的那一步
 *      （`tool.handler(params, { signal })` 改 `tool.handler(params)`）
 *      ⇒ S2 ctx 为 undefined（throwIfAborted 不触发 → 副作用被执行）/ S9 严格相等失败 ⇒ 红。
 *   M3 删 src/agent/tool-loop-executor.ts callLlm 调用里的 `signal: sig` 透传
 *      ⇒ S6 第 2 轮 LLM 照发（chatCalls=2 ≠ 1）⇒ 红。
 *   M4 闸 R6 规则删除 ⇒ T18 期望 rc=1 实得 0 ⇒ tests/control-tower/check-tool-args-delta.test.sh 红。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';
import { ToolLoopExecutor, TOOL_CANCELLED_REPLY } from '../../src/agent/tool-loop-executor';
import { ConversationEngine } from '../../src/agent/conversation-engine';
import { ToolRegistry, type ToolDefinition } from '../../src/agent/tools';
import { WebViewAdapter } from '../../src/l1-interaction/web-adapter';
import type { EngineContext } from '../../src/agent/engine-context';
import type { DiagnosisEngine } from '../../src/l2-interfaces/diagnosis-engine';
import type { ChatOptions, ChatResult, LLMMessage, LLMProvider, StreamCallback, ToolCall } from '../../src/providers/types';

// ═══ provider 替身（仅外部传输边界；其余全走生产代码）═══

interface RecordingProvider extends LLMProvider {
  chatCalls: number;
}

function stubProvider(impl: (messages: LLMMessage[], options?: ChatOptions) => Promise<ChatResult>): RecordingProvider {
  return {
    name: 'stub-tool-cancel',
    baseUrl: 'https://stub.invalid',
    chatCalls: 0,
    async chat(messages, options) {
      this.chatCalls += 1;
      return impl(messages, options);
    },
    async stream(_messages: LLMMessage[], _callback: StreamCallback, _options?: ChatOptions): Promise<void> {
      throw new Error('stream not used in this suite');
    },
    listModels: () => ['stub-model'],
    healthCheck: async () => ({ ok: true }),
  };
}

function noopEngine(): DiagnosisEngine {
  return {
    async runConsultation(teamId) {
      return { teamId, report: {}, totalDurationMs: 0, degradedModules: [] };
    },
  };
}

function makeCtx(provider: LLMProvider, toolRegistry: ToolRegistry): EngineContext {
  return {
    provider,
    messages: [{ role: 'system', content: 'sys' }],
    orgId: 'org-915q5',
    sessionId: '',
    toolRegistry,
    hookRunner: null,
    eventBus: null,
    evidenceCollector: null,
    corroborationEngine: null,
    graphBridge: null,
    graphStore: null,
    flags: { enableCommunityReports: false, enableEntityResolution: false },
    loggerPrefix: 'test',
    diagnosisEngine: noopEngine(),
  };
}

/** 只读探针工具：spy 计 handler/副作用调用（operationType 缺省 = 可并行） */
function probeTool(name: string, handler: ToolDefinition['handler']): ToolDefinition {
  return {
    name,
    description: `probe tool ${name} for #915 Q-5 cancel tests`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler,
  };
}

function toolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SYNO_TOOL_ABORT; // S4 测试后恢复 env（判据内嵌）
});

// ═══ S1–S4 / S8 / S9：ToolRegistry.execute 取消语义 ═══

describe('#915 Q-5 ToolRegistry.execute — 取消语义', () => {
  it('S1 已 abort 的 signal ⇒ AbortError + TOOL_ABORTED_BEFORE_DISPATCH，handler 零调用', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled before dispatch'));
    const handlerSpy = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_write', handlerSpy));

    const result = await registry.execute('probe_write', {}, { signal: controller.signal });

    expect(result.error).toMatchObject({
      name: 'AbortError',
      code: 'TOOL_ABORTED_BEFORE_DISPATCH',
    });
    expect(handlerSpy).toHaveBeenCalledTimes(0); // 副作用前拦截，handler 零调用
  });

  it('S2 handler 内 await 后 ctx.signal.throwIfAborted() ⇒ TOOL_ABORTED，副作用零调用', async () => {
    const controller = new AbortController();
    const sideEffectSpy = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_mid', async (_params, ctx) => {
      await gate; // 模拟多步操作的中途检查点（abort 由测试在 await 期间触发）
      ctx?.signal?.throwIfAborted(); // 副作用前的自校（R4 闸判据的运行时面）
      sideEffectSpy(); // 副作用（取消后绝不可达）
      return { ok: true };
    }));

    const pending = registry.execute('probe_mid', {}, { signal: controller.signal });
    controller.abort(new Error('cancelled mid handler'));
    release();
    const result = await pending;

    expect(result.error).toMatchObject({ name: 'AbortError', code: 'TOOL_ABORTED' });
    expect(sideEffectSpy).toHaveBeenCalledTimes(0); // 检查在副作用前
  });

  it('S3 无 signal ⇒ 正常返回且 handler 被调用（防"全取消"假绿）', async () => {
    const handlerSpy = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_plain', handlerSpy));

    const result = await registry.execute('probe_plain', {});

    expect(result).toEqual({ ok: true });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it('S4 SYNO_TOOL_ABORT=0 + 已 abort signal ⇒ 回旧行为（handler 被调用且无 AbortError）', async () => {
    const prev = process.env.SYNO_TOOL_ABORT;
    process.env.SYNO_TOOL_ABORT = '0';
    try {
      const controller = new AbortController();
      controller.abort(new Error('rollback mode ignores signal'));
      const handlerSpy = vi.fn(async () => ({ ok: true }));
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_rollback', handlerSpy));

      const result = await registry.execute('probe_rollback', {}, { signal: controller.signal });

      expect(handlerSpy).toHaveBeenCalledTimes(1);
      expect(result.error).toBeUndefined(); // 无 AbortError（回旧行为）
    } finally {
      if (prev === undefined) delete process.env.SYNO_TOOL_ABORT;
      else process.env.SYNO_TOOL_ABORT = prev;
    }
  });

  it('S8 executeParallel([a,b], aborted signal) ⇒ 两工具均 BEFORE_DISPATCH 且 spy 各 0', async () => {
    const controller = new AbortController();
    controller.abort(new Error('parallel cancel'));
    const spyA = vi.fn(async () => ({ ok: true }));
    const spyB = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_pa', spyA));
    registry.register(probeTool('probe_pb', spyB));

    const results = await registry.executeParallel(
      [{ name: 'probe_pa', params: {} }, { name: 'probe_pb', params: {} }],
      { signal: controller.signal },
    );

    expect(results.get('probe_pa')?.error).toMatchObject({ name: 'AbortError', code: 'TOOL_ABORTED_BEFORE_DISPATCH' });
    expect(results.get('probe_pb')?.error).toMatchObject({ name: 'AbortError', code: 'TOOL_ABORTED_BEFORE_DISPATCH' });
    expect(spyA).toHaveBeenCalledTimes(0);
    expect(spyB).toHaveBeenCalledTimes(0);
  });

  it('S9 handler 收到的 ctx.signal 身份 === 传入 signal（链路贯穿物理证据）', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_identity', async (_params, ctx) => {
      received = ctx?.signal;
      return { ok: true };
    }));

    await registry.execute('probe_identity', {}, { signal: controller.signal });

    expect(received).toBe(controller.signal); // 严格相等（非 merely equal）
  });
});

// ═══ S5–S7：ToolLoopExecutor 取消语义（stub provider，真实类） ═══

describe('#915 Q-5 ToolLoopExecutor — 循环取消（S5–S7）', () => {
  it('S5 callLLMWithTools(signal) 入场前已 abort ⇒ TOOL_CANCELLED_REPLY 且不发 LLM', async () => {
    const provider = stubProvider(async () => ({ content: 'unused', model: 'stub-model' }));
    const registry = new ToolRegistry();
    const executor = new ToolLoopExecutor(makeCtx(provider, registry));
    const controller = new AbortController();
    controller.abort(new Error('entry cancel'));

    const reply = await executor.callLLMWithTools(controller.signal);

    expect(reply).toBe(TOOL_CANCELLED_REPLY);
    expect(provider.chatCalls).toBe(0); // 不发 LLM
  });

  it('S6 工具执行中 abort ⇒ 第 2 轮不发 LLM、第 2 个工具零调用、前缀 ⊆ 返回内容', async () => {
    const controller = new AbortController();
    const spySecond = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_mid_loop', async (_params, ctx) => {
      controller.abort(new Error('cancel during tool')); // handler 执行中 abort
      ctx?.signal?.throwIfAborted();
      return { ok: true };
    }));
    registry.register(probeTool('probe_next', spySecond));
    const provider = stubProvider(async () => ({
      content: 'PREFIX_PART_',
      model: 'stub-model',
      toolCalls: [toolCall('probe_mid_loop'), toolCall('probe_next')],
    }));
    const executor = new ToolLoopExecutor(makeCtx(provider, registry));

    const reply = await executor.callLLMWithTools(controller.signal);

    expect(provider.chatCalls).toBe(1); // 第 2 轮不再发 LLM
    expect(spySecond).toHaveBeenCalledTimes(0); // 第 2 个工具 spy=0
    expect(reply.startsWith('PREFIX_PART_')).toBe(true); // 已生成前缀 ⊆ 返回内容（中断锚）
    expect(reply.endsWith(TOOL_CANCELLED_REPLY)).toBe(true);
  });

  it('S7 streamWithToolLoop(onToken, signal) 同 S6 — onToken 前缀 ⊆ 返回内容', async () => {
    const controller = new AbortController();
    const spySecond = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_mid_stream', async (_params, ctx) => {
      controller.abort(new Error('cancel during stream tool'));
      ctx?.signal?.throwIfAborted();
      return { ok: true };
    }));
    registry.register(probeTool('probe_next_stream', spySecond));
    const provider = stubProvider(async () => ({
      content: 'AB',
      model: 'stub-model',
      toolCalls: [toolCall('probe_mid_stream'), toolCall('probe_next_stream')],
    }));
    const executor = new ToolLoopExecutor(makeCtx(provider, registry));
    const tokens: string[] = [];
    const onToken = (token: string): void => { tokens.push(token); };

    const reply = await executor.streamWithToolLoop(onToken, controller.signal);

    expect(provider.chatCalls).toBe(1); // 第 2 轮不再发 LLM
    expect(spySecond).toHaveBeenCalledTimes(0);
    expect(reply.startsWith(tokens.join(''))).toBe(true); // onToken 收到的 token 前缀 ⊆ 返回内容
    expect(reply.endsWith(TOOL_CANCELLED_REPLY)).toBe(true);
  });
});

// ═══ S10：WebViewAdapter 断线 ⇒ signal abort ═══

describe('#915 Q-5 WebViewAdapter — 断线取消信号', () => {
  it('S10 假 res emit(close) ⇒ signal.aborted 且 reason.message=CLIENT_DISCONNECTED', () => {
    const closeHandlers: Array<() => void> = [];
    /** 假 express Response（只实现 WebViewAdapter 实际消费的面：setHeader/flushHeaders/on/write/end） */
    const fakeRes = {
      setHeader: () => undefined,
      flushHeaders: () => undefined,
      on: (event: string, fn: () => void) => { if (event === 'close') closeHandlers.push(fn); },
      write: () => undefined,
      end: () => undefined,
    } as Response;

    const adapter = new WebViewAdapter(fakeRes);

    expect(adapter.signal.aborted).toBe(false); // 未断线

    for (const fn of closeHandlers) fn(); // 触发 res 'close'

    expect(adapter.signal.aborted).toBe(true);
    expect(adapter.signal.reason).toBeInstanceOf(Error);
    expect((adapter.signal.reason as Error).message).toBe('CLIENT_DISCONNECTED');
  });
});

// ═══ S11：ConversationEngine 入口早停 ═══

describe('#915 Q-5 ConversationEngine — 入口早停', () => {
  it('S11 processMessage(x, {signal: aborted}) ⇒ 取消文案且 chatCalls===0', async () => {
    const provider = stubProvider(async () => ({ content: 'unused', model: 'stub-model' }));
    // fallbackProvider: null ⇒ 显式禁用 failover（禁从环境变量派生真实备用 provider）
    const engine = new ConversationEngine(provider, { fallbackProvider: null, orgId: 'org-915q5' });
    const controller = new AbortController();
    controller.abort(new Error('engine entry cancel'));

    const result = await engine.processMessage('x', { signal: controller.signal });

    expect(result.reply).toBe(TOOL_CANCELLED_REPLY);
    expect(provider.chatCalls).toBe(0);
  });
});
