/**
 * tests/agent/tool-result-event.test.ts — #1165 E1（item ③：`tool_result` 写事件流，log-only）
 *
 * 判据源（唯一准绳）：
 *   handbook 派单件/2026-10-30-规格-1165-R引擎E1-会话账本不变量.md §4.3/§5-3/§9.2 C6
 *   handbook 派单件/2026-10-30-设计-1165-R引擎E1.md §2.3（6 写点 / payload 契约 / parity）
 *
 * 覆盖矩阵（铁律 48：每条必有 expect；铁律 12：不 mock 被测管线 —— 只替换 provider 外部边界，
 * store 用真实 SessionStore（内存 DB），hook 用真实 HookRunner）：
 *   T3a 执行完成（streamWithToolLoop）⇒ 恰 1 条 `tool_result`；payload 字段齐全、无 `content`、
 *       `resultPreview` ≤2048 字节且 UTF-8 安全（无 U+FFFD）、`resultBytes` = 全量 JSON 字节数
 *   T3b parity（callLLMWithTools）⇒ 同一次写入的"写前/写后" `deriveMessages` 与 `getMessages`
 *       完全相等（无 `content` 的 `tool_result` 是 log-only，模型可见消息零增量）
 *   T3c 落盘降级不阻断 ⇒ appendEvent 返回 degraded 时工具结果照常进 `messages`、返回原文、`log.warn({degraded:true})`
 *   T3d deny（TOOL_DENIED）/ block（TOOL_BLOCKED）也落事件，且**两个循环各覆盖一次**（6 写点全达）
 *   T3e `SYNO_TOOL_RESULT_EVENT=0` ⇒ 0 条事件（其余行为不变）
 *
 * 改坏探针（判据常驻）：删 `appendToolResultEvent` 调用 ⇒ T3a/T3d/T3e(正控) 红；
 *   删 `session-store.ts` 的「无 content 的 tool_result 投影跳过」⇒ T3b 红（写后多出空 assistant）。
 * 时种棘轮：被测文件不新增 `Date.now()` / `new Date()`（`durationMs` 用 `performance.now()`）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ToolLoopExecutor } from '../../src/agent/tool-loop-executor';
import { ToolRegistry, type ToolDefinition } from '../../src/agent/tools';
import { SessionStore, type MessageRow } from '../../src/store/session-store';
import { HookRunner } from '../../src/orchestrator/hook-runner';
import type { EngineContext } from '../../src/agent/engine-context';
import type { DiagnosisEngine } from '../../src/l2-interfaces/diagnosis-engine';
import type { ChatOptions, ChatResult, LLMMessage, LLMProvider, StreamCallback, ToolCall } from '../../src/providers/types';

// ═══ 日志运行期捕获（G2 判据：落盘降级必留痕；范式同 tests/agent/tool-permissions-role-pack.test.ts）═══

const logCalls = vi.hoisted(() => [] as { level: string; meta?: Record<string, unknown>; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const capture = (level: string) => (first?: unknown, second?: unknown) => {
    if (typeof first === 'object' && first !== null) {
      logCalls.push({ level, meta: first as Record<string, unknown>, msg: second });
    } else {
      logCalls.push({ level, msg: first ?? second });
    }
  };
  const m = {
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    debug: capture('debug'),
    fatal: capture('fatal'),
    trace: capture('trace'),
  };
  return { logger: m, createLogger: () => m };
});

// ═══ provider 替身（仅外部传输边界；其余全走生产代码）═══

interface RecordingProvider extends LLMProvider {
  chatCalls: number;
}

function stubProvider(impl: (messages: LLMMessage[], options?: ChatOptions) => Promise<ChatResult>): RecordingProvider {
  return {
    name: 'stub-tool-result',
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

// ═══ 夹具 ═══

interface Fixture {
  db: Database.Database;
  store: SessionStore;
  sessionId: string;
}

function makeFixture(): Fixture {
  const db = new Database(':memory:');
  const store = new SessionStore(db);
  const session = store.createSession('org-1165-e1-tool-result', 'e1-tester');
  return { db, store, sessionId: session.id };
}

function makeCtx(
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
  fixture: Fixture,
  hookRunner: HookRunner | null = null,
): EngineContext {
  return {
    provider,
    messages: [{ role: 'system', content: 'sys' }],
    orgId: 'org-1165-e1-tool-result',
    sessionId: fixture.sessionId,
    sessionStore: fixture.store,
    toolRegistry,
    hookRunner,
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

function probeTool(name: string, handler: ToolDefinition['handler']): ToolDefinition {
  return {
    name,
    description: `probe tool ${name} for #1165 E1 tool_result tests`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler,
  };
}

function toolCall(name: string, args: Record<string, unknown> = {}, id?: string): ToolCall {
  return {
    id: id ?? `call_${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** 读取全部 `tool_result` 事件 payload（按 seq 升序；JSON 解析失败即抛，不静默） */
function toolResultPayloads(store: SessionStore, sessionId: string): Array<Record<string, unknown>> {
  return store.getEvents(sessionId)
    .filter((event) => event.eventType === 'tool_result')
    .map((event) => {
      const parsed: unknown = JSON.parse(event.payloadJson);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`tool_result payload 不是对象: ${event.payloadJson.slice(0, 80)}`);
      }
      return parsed as Record<string, unknown>;
    });
}

function requireSnapshot(snapshot: MessageRow[] | undefined, label: string): MessageRow[] {
  if (snapshot === undefined) throw new Error(`parity 快照未捕获：${label}`);
  return snapshot;
}

/** 真实 HookRunner + 永不放行的 deny hook（不 mock 管线） */
function denyHookRunner(): HookRunner {
  const runner = new HookRunner();
  runner.registerPreToolUse({
    name: 'e1-deny-probe',
    async onPreToolUse() {
      return { action: 'deny', reason: 'E1_TEST_DENY' };
    },
  });
  return runner;
}

/** 一次工具调用后收尾：provider 第 1 次给 toolCalls，第 2 次给最终文本 */
function oneToolCallThenFinal(name: string): (callIndex: number) => ChatResult {
  return (callIndex: number): ChatResult => (
    callIndex === 1
      ? { content: '', model: 'stub-model', toolCalls: [toolCall(name)] }
      : { content: 'DONE', model: 'stub-model' }
  );
}

function providerFromSequence(sequence: (callIndex: number) => ChatResult): RecordingProvider {
  let callIndex = 0;
  return stubProvider(async () => {
    callIndex += 1;
    return sequence(callIndex);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SYNO_TOOL_RESULT_EVENT;
  delete process.env.SYNO_TOOL_ABORT;
});

// ═══ T3a：执行完成写点（streamWithToolLoop）═══

describe('T3a 执行完成 ⇒ tool_result 事件', () => {
  it('T3a 一次工具调用 ⇒ 恰 1 条 tool_result；字段齐全、无 content、预览 ≤2048B 且 UTF-8 安全', async () => {
    const fx = makeFixture();
    try {
      // 结果 JSON ~6KB（含多字节字符）⇒ 预览必须被截断、且不切坏字符
      const toolHandlerSpy = vi.fn(async () => ({ blob: '数'.repeat(2000), value: 42 }));
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_big', toolHandlerSpy));
      const provider = providerFromSequence(oneToolCallThenFinal('probe_big'));
      const executor = new ToolLoopExecutor(makeCtx(provider, registry, fx));

      const reply = await executor.streamWithToolLoop(() => undefined);

      expect(reply).toBe('DONE');
      expect(toolHandlerSpy).toHaveBeenCalledTimes(1);
      // 全新会话：事件流里只有这一条 tool_result（ToolLoopExecutor 不写 message 事件）
      const allEvents = fx.store.getEvents(fx.sessionId);
      expect(allEvents.length).toBe(1);
      expect(allEvents[0].eventType).toBe('tool_result');

      const payloads = toolResultPayloads(fx.store, fx.sessionId);
      expect(payloads.length).toBe(1);
      const payload = payloads[0];
      expect(payload.toolCallId).toBe('call_probe_big');
      expect(payload.name).toBe('probe_big');
      expect(payload.ok).toBe(true);
      expect(payload.code).toBeUndefined();
      expect(typeof payload.durationMs).toBe('number');
      expect(payload.durationMs as number).toBeGreaterThanOrEqual(0);
      expect('content' in payload).toBe(false); // log-only：payload 不含 content
      expect(typeof payload.resultBytes).toBe('number');
      expect(payload.resultBytes as number).toBeGreaterThan(2048); // 全量结果确实超上限（预览才需截断）

      const preview = payload.resultPreview;
      expect(typeof preview).toBe('string');
      if (typeof preview !== 'string') throw new Error(`resultPreview 不是字符串: ${String(preview)}`);
      expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(2048);
      expect(preview.includes('\uFFFD')).toBe(false); // UTF-8 安全截断（不切坏多字节字符）
      expect(preview.startsWith('{"blob":"数')).toBe(true); // 预览是结果 JSON 的前缀
    } finally {
      fx.db.close();
    }
  });
});

// ═══ T3b：parity（写前/写后投影相等；callLLMWithTools）═══

describe('T3b parity：log-only 不改变模型可见消息', () => {
  it('T3b 写前/写后 deriveMessages 与 getMessages 完全相等（同一次 append 调用内抓快照）', async () => {
    const fx = makeFixture();
    try {
      const seeded = fx.store.addMessage(fx.sessionId, 'user', 'E1 parity seed');
      expect(seeded.ok).toBe(true);

      const registry = new ToolRegistry();
      registry.register(probeTool('probe_parity', async () => ({ value: 7 })));
      const provider = providerFromSequence(oneToolCallThenFinal('probe_parity'));
      const executor = new ToolLoopExecutor(makeCtx(provider, registry, fx));

      // seam：拦截真实 appendEvent，在 tool_result 写入**前后**各抓一次投影（不改被测实现）
      const originalAppend = fx.store.appendEvent;
      let beforeDerived: MessageRow[] | undefined;
      let afterDerived: MessageRow[] | undefined;
      let beforeMessages: MessageRow[] | undefined;
      let afterMessages: MessageRow[] | undefined;
      fx.store.appendEvent = (sessionId, eventType, payload) => {
        if (eventType !== 'tool_result') return originalAppend.call(fx.store, sessionId, eventType, payload);
        if (beforeDerived === undefined) {
          beforeDerived = fx.store.deriveMessages(sessionId);
          beforeMessages = fx.store.getMessages(sessionId);
        }
        const result = originalAppend.call(fx.store, sessionId, eventType, payload);
        afterDerived = fx.store.deriveMessages(sessionId);
        afterMessages = fx.store.getMessages(sessionId);
        return result;
      };

      const reply = await executor.callLLMWithTools();
      expect(reply).toBe('DONE');

      const derivedBefore = requireSnapshot(beforeDerived, '写前 deriveMessages');
      const derivedAfter = requireSnapshot(afterDerived, '写后 deriveMessages');
      const messagesBefore = requireSnapshot(beforeMessages, '写前 getMessages');
      const messagesAfter = requireSnapshot(afterMessages, '写后 getMessages');

      expect(toolResultPayloads(fx.store, fx.sessionId).length).toBe(1); // 事件确实写了，parity 才有意义
      expect(derivedBefore.length).toBe(1); // 前置：种子 user 消息（非空数组，排除"空==空"假绿）
      expect(derivedAfter).toEqual(derivedBefore); // 写前/写后逐字段相等
      expect(messagesAfter).toEqual(messagesBefore);
    } finally {
      fx.db.close();
    }
  });
});

// ═══ T3c：落盘降级不阻断 ═══

describe('T3c appendEvent 降级 ⇒ 不阻断本轮', () => {
  it('T3c 落盘 degraded ⇒ 工具结果照常进 messages、返回原文、log.warn({degraded:true})', async () => {
    logCalls.length = 0;
    const fx = makeFixture();
    try {
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_degraded', async () => ({ value: 42 })));
      const provider = providerFromSequence(oneToolCallThenFinal('probe_degraded'));
      const ctx = makeCtx(provider, registry, fx);
      // 落盘缝降级替身（只替 store 这一外部持久化边界；工具管线全真）
      ctx.sessionStore = {
        appendEvent: () => ({ ok: false, degraded: true, error: 'SIMULATED_DEGRADED' }),
      };
      const executor = new ToolLoopExecutor(ctx);

      const reply = await executor.streamWithToolLoop(() => undefined);

      expect(reply).toBe('DONE'); // 返回原文
      const toolMessages = ctx.messages.filter((message) => message.role === 'tool');
      expect(toolMessages.length).toBe(1); // 工具结果照常进模型消息
      expect(toolMessages[0].content).toContain('"value":42');
      const degradedWarn = logCalls.find(
        (call) => call.level === 'warn' && call.meta?.degraded === true && String(call.msg).includes('tool_result'),
      );
      expect(degradedWarn).toBeDefined(); // 降级留痕（不静默）
    } finally {
      fx.db.close();
    }
  });
});

// ═══ T3d：deny / block 写点（两个循环各覆盖）═══

describe('T3d Hook deny / ToolGuard block 也落事件', () => {
  it('T3d-1 deny（streamWithToolLoop）⇒ 1 条 code=TOOL_DENIED、ok=false', async () => {
    const fx = makeFixture();
    try {
      const toolHandlerSpy = vi.fn(async () => ({ ok: true }));
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_deny_stream', toolHandlerSpy));
      const provider = providerFromSequence(oneToolCallThenFinal('probe_deny_stream'));
      const executor = new ToolLoopExecutor(makeCtx(provider, registry, fx, denyHookRunner()));

      const reply = await executor.streamWithToolLoop(() => undefined);

      expect(reply).toBe('DONE');
      expect(toolHandlerSpy).toHaveBeenCalledTimes(0); // deny ⇒ handler 零调用
      const payloads = toolResultPayloads(fx.store, fx.sessionId);
      expect(payloads.length).toBe(1);
      expect(payloads[0]).toMatchObject({ name: 'probe_deny_stream', ok: false, code: 'TOOL_DENIED' });
      expect(payloads[0].toolCallId).toBe('call_probe_deny_stream');
    } finally {
      fx.db.close();
    }
  });

  it('T3d-2 deny（callLLMWithTools）⇒ 1 条 code=TOOL_DENIED、ok=false', async () => {
    const fx = makeFixture();
    try {
      const toolHandlerSpy = vi.fn(async () => ({ ok: true }));
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_deny_plain', toolHandlerSpy));
      const provider = providerFromSequence(oneToolCallThenFinal('probe_deny_plain'));
      const executor = new ToolLoopExecutor(makeCtx(provider, registry, fx, denyHookRunner()));

      const reply = await executor.callLLMWithTools();

      expect(reply).toBe('DONE');
      expect(toolHandlerSpy).toHaveBeenCalledTimes(0);
      const payloads = toolResultPayloads(fx.store, fx.sessionId);
      expect(payloads.length).toBe(1);
      expect(payloads[0]).toMatchObject({ name: 'probe_deny_plain', ok: false, code: 'TOOL_DENIED' });
    } finally {
      fx.db.close();
    }
  });

  it('T3d-3 block（streamWithToolLoop，同工具同参数第 3 次）⇒ 2 ok ＋ 1 条 code=TOOL_BLOCKED', async () => {
    const fx = makeFixture();
    try {
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_block_stream', async () => ({ ok: true })));
      const provider = providerFromSequence((callIndex: number) => (callIndex <= 3
        ? { content: '', model: 'stub-model', toolCalls: [toolCall('probe_block_stream')] }
        : { content: 'DONE', model: 'stub-model' }));
      const executor = new ToolLoopExecutor(makeCtx(provider, registry, fx));

      const reply = await executor.streamWithToolLoop(() => undefined);

      expect(reply).toBe('DONE');
      const payloads = toolResultPayloads(fx.store, fx.sessionId);
      expect(payloads.length).toBe(3); // 2 次执行完成 ＋ 1 次 block
      expect(payloads.filter((payload) => payload.ok === true).length).toBe(2);
      const blocked = payloads.filter((payload) => payload.code === 'TOOL_BLOCKED');
      expect(blocked.length).toBe(1);
      expect(blocked[0]).toMatchObject({ name: 'probe_block_stream', ok: false });
    } finally {
      fx.db.close();
    }
  });

  it('T3d-4 block（callLLMWithTools）⇒ 2 ok ＋ 1 条 code=TOOL_BLOCKED', async () => {
    const fx = makeFixture();
    try {
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_block_plain', async () => ({ ok: true })));
      const provider = providerFromSequence((callIndex: number) => (callIndex <= 3
        ? { content: '', model: 'stub-model', toolCalls: [toolCall('probe_block_plain')] }
        : { content: 'DONE', model: 'stub-model' }));
      const executor = new ToolLoopExecutor(makeCtx(provider, registry, fx));

      const reply = await executor.callLLMWithTools();

      expect(reply).toBe('DONE');
      const payloads = toolResultPayloads(fx.store, fx.sessionId);
      expect(payloads.length).toBe(3);
      expect(payloads.filter((payload) => payload.ok === true).length).toBe(2);
      expect(payloads.filter((payload) => payload.code === 'TOOL_BLOCKED').length).toBe(1);
    } finally {
      fx.db.close();
    }
  });
});

// ═══ T3e：回滚开关 ═══

describe('T3e SYNO_TOOL_RESULT_EVENT=0 ⇒ 不写', () => {
  it('T3e 开关关闭 ⇒ 0 条 tool_result 事件，但工具结果照常进 messages', async () => {
    const fx = makeFixture();
    process.env.SYNO_TOOL_RESULT_EVENT = '0';
    try {
      const registry = new ToolRegistry();
      registry.register(probeTool('probe_switch_off', async () => ({ value: 42 })));
      const provider = providerFromSequence(oneToolCallThenFinal('probe_switch_off'));
      const ctx = makeCtx(provider, registry, fx);
      const executor = new ToolLoopExecutor(ctx);

      const reply = await executor.streamWithToolLoop(() => undefined);

      expect(reply).toBe('DONE');
      expect(fx.store.getEvents(fx.sessionId).length).toBe(0); // 一步回旧行为：事件流零写入
      expect(ctx.messages.some((message) => message.role === 'tool' && message.content.includes('"value":42'))).toBe(true);
    } finally {
      delete process.env.SYNO_TOOL_RESULT_EVENT;
      fx.db.close();
    }
  });
});
