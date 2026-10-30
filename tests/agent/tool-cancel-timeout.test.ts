/**
 * tests/agent/tool-cancel-timeout.test.ts — #1165 E1（item 4：内置工具 `timeoutMs` 声明 ＋ 逐字循环查 `signal`）
 *
 * 判据源（唯一准绳）：
 *   handbook 派单件/2026-10-30-规格-1165-R引擎E1-会话账本不变量.md §4.4/§5-4/§9.2 C9
 *   handbook 派单件/2026-10-30-设计-1165-R引擎E1.md §2.4（timeout 表 ＋ 3 处逐字循环）
 *
 * 覆盖矩阵（铁律 48：每条必有 expect；铁律 12：不 mock 被测管线，只替换 provider 外部边界）:
 *   T4a 声明表驱动：真实 `registerBuiltinTools` 收到的 8 个内置定义 ＋ `createKnowledgeSearchTool`
 *       的 `timeoutMs` 均等于预期正整数（删任一声明 ⇒ 对应用例红）
 *   T4b 机制：真实 `ToolRegistry.execute` 的 `withTimeout` 包裹 —— `timeoutMs:20` ＋ handler 永不
 *       settle ⇒ `<500ms` 内拿到 `error.code==='TOOL_TIMEOUT'`（cooperative：只通知不 kill）
 *   T4c 取消·无工具调用分支：~60 字文本，onToken 第 5 字时 abort ⇒ emitted < 全文、返回值以
 *       `TOOL_CANCELLED_REPLY` 结尾、onToken 前缀 ⊆ 返回值（Q-5 前缀不变量）
 *   T4d 取消·工具调用前文本分支（provider 返回 content＋toolCalls）⇒ 同上，且工具 handler 零调用
 *   T4e 取消·轮尽收尾分支（provider 前 3 轮恒返回 toolCalls，最终轮打字中 abort）⇒ 同上
 *
 * 改坏探针（判据常驻）：删 `builtin-tools.ts` 任一 `timeoutMs` ⇒ T4a 红；
 *   删 `tool-loop-executor.ts` 3 处循环内 `sig?.aborted` 检查 ⇒ T4c/T4d/T4e 红
 *   （emit 仍走完全文、返回值不含取消标记）。
 * 时种棘轮：本文件与被测文件均**不新增** `Date.now()` / `new Date()`（时长用 `performance.now()`）。
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { ToolLoopExecutor, TOOL_CANCELLED_REPLY } from '../../src/agent/tool-loop-executor';
import { ToolRegistry, type ToolDefinition } from '../../src/agent/tools';
import { registerBuiltinTools, createKnowledgeSearchTool } from '../../src/agent/builtin-tools';
import { SessionStore } from '../../src/store/session-store';
import type { EngineContext } from '../../src/agent/engine-context';
import type { DiagnosisEngine } from '../../src/l2-interfaces/diagnosis-engine';
import type { ChatOptions, ChatResult, LLMMessage, LLMProvider, StreamCallback, ToolCall } from '../../src/providers/types';

// ═══ provider 替身（仅外部传输边界；其余全走生产代码）═══

interface RecordingProvider extends LLMProvider {
  chatCalls: number;
}

function stubProvider(impl: (messages: LLMMessage[], options?: ChatOptions) => Promise<ChatResult>): RecordingProvider {
  return {
    name: 'stub-tool-cancel-timeout',
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
    orgId: 'org-1165-e1',
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

/** 只读探针工具（无 timeoutMs：本套件只测取消分支，超时另由 T4b 承重） */
function probeTool(name: string, handler: ToolDefinition['handler']): ToolDefinition {
  return {
    name,
    description: `probe tool ${name} for #1165 E1 cancel tests`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler,
  };
}

function toolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SYNO_TOOL_ABORT; // 回滚开关测试后恢复 env（判据内嵌，防污染后续用例）
});

// ═══ T4a：9 个工具的 timeoutMs 声明（真实注册表；删任一 ⇒ 红） ═══

/** 设计稿 §2.4 表（8 内置工具；值标"待实测校准"，此处锁定声明存在性与当前保守值） */
const EXPECTED_TIMEOUTS: Array<[string, number]> = [
  ['query_ontology', 35000],
  ['show_diagnosis_progress', 3000],
  ['explain_finding', 15000],
  ['list_sessions', 10000],
  ['read_document', 35000],
  ['schedule_task', 5000],
  ['list_scheduled_tasks', 5000],
  ['install_skill', 30000],
];

describe('T4a 内置工具 timeoutMs 声明（表驱动）', () => {
  let db: Database.Database;
  let registry: ToolRegistry;

  beforeAll(() => {
    db = new Database(':memory:');
    const store = new SessionStore(db);
    registry = new ToolRegistry();
    registerBuiltinTools(registry, store, 'e1-timeout-probe-session', () => 0, () => 'e1-timeout-probe-org');
  });

  afterAll(() => {
    db.close();
  });

  it.each(EXPECTED_TIMEOUTS)('T4a %s ⇒ timeoutMs=%i（正整数声明）', (name, expected) => {
    const tool = registry.getTool(name);
    expect(tool).toBeDefined();
    if (!tool) throw new Error(`内置工具 ${name} 未注册（真实 registerBuiltinTools 未产出该定义）`);
    expect(tool.timeoutMs).toBe(expected); // 删声明 ⇒ undefined ≠ expected ⇒ 红
    expect(Number.isInteger(tool.timeoutMs)).toBe(true);
    expect((tool.timeoutMs ?? 0) > 0).toBe(true);
  });

  it('T4a search_knowledge（createKnowledgeSearchTool 工厂）⇒ timeoutMs=15000', () => {
    const tool = createKnowledgeSearchTool(() => null);
    expect(tool.name).toBe('search_knowledge');
    expect(tool.timeoutMs).toBe(15000);
    expect(Number.isInteger(tool.timeoutMs)).toBe(true);
    expect((tool.timeoutMs ?? 0) > 0).toBe(true);
  });
});

// ═══ T4b：withTimeout 机制（真实 ToolRegistry.execute） ═══

describe('T4b 超时机制（withTimeout 包裹生效）', () => {
  it('T4b timeoutMs:20 ＋ handler 永不 settle ⇒ <500ms 内返回 TOOL_TIMEOUT，handler 已 dispatch', async () => {
    // cooperative 语义：超时只返回结构化错误，handler 继续挂起（DSH timeout-policy 同款，设计稿 §6-5）
    const handlerSpy = vi.fn(() => new Promise<Record<string, unknown>>(() => undefined));
    const registry = new ToolRegistry();
    registry.register({
      name: 'probe_slow',
      description: '#1165 E1 超时探针（handler 永不 resolve）',
      parameters: { type: 'object', properties: {} },
      timeoutMs: 20,
      handler: handlerSpy,
    });

    const startedAt = performance.now();
    const result = await registry.execute('probe_slow', {});
    const elapsedMs = performance.now() - startedAt;

    expect(result.error).toMatchObject({ name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' });
    expect(handlerSpy).toHaveBeenCalledTimes(1); // 已进 handler（不是派发前取消假绿）
    expect(elapsedMs).toBeLessThan(500); // 删声明（timeoutMs 缺失）⇒ 永不 settle ⇒ 本用例超时/红
  });
});

// ═══ T4c–T4e：逐字动画循环内查 signal（真实 ToolLoopExecutor） ═══

describe('T4c–T4e 逐字动画循环内查取消', () => {
  it('T4c 无工具调用分支：第 5 字 abort ⇒ emitted < 全文、返回值以取消标记结尾', async () => {
    const FULL_TEXT = 'X'.repeat(60);
    const controller = new AbortController();
    const tokens: string[] = [];
    const provider = stubProvider(async () => ({ content: FULL_TEXT, model: 'stub-model' }));
    const executor = new ToolLoopExecutor(makeCtx(provider, new ToolRegistry()));

    const reply = await executor.streamWithToolLoop((token) => {
      tokens.push(token);
      if (tokens.length === 5) controller.abort(new Error('cancel mid typing'));
    }, controller.signal);

    expect(tokens.length).toBe(5); // abort 后不再 emit 剩余字符（删循环内检查 ⇒ 60）
    expect(tokens.join('').length).toBeLessThan(FULL_TEXT.length);
    expect(reply.endsWith(TOOL_CANCELLED_REPLY)).toBe(true);
    expect(reply.startsWith(tokens.join(''))).toBe(true); // onToken 前缀 ⊆ 返回内容（Q-5 前缀不变量）
    expect(provider.chatCalls).toBe(1);
  });

  it('T4d 工具调用前文本分支：第 5 字 abort ⇒ emitted < 全文、工具 handler 零调用', async () => {
    const FULL_TEXT = 'Y'.repeat(60);
    const controller = new AbortController();
    const tokens: string[] = [];
    const toolHandlerSpy = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    registry.register(probeTool('probe_after_text', toolHandlerSpy));
    const provider = stubProvider(async () => ({
      content: FULL_TEXT,
      model: 'stub-model',
      toolCalls: [toolCall('probe_after_text')],
    }));
    const executor = new ToolLoopExecutor(makeCtx(provider, registry));

    const reply = await executor.streamWithToolLoop((token) => {
      tokens.push(token);
      if (tokens.length === 5) controller.abort(new Error('cancel before tool'));
    }, controller.signal);

    expect(tokens.length).toBe(5);
    expect(tokens.join('').length).toBeLessThan(FULL_TEXT.length);
    expect(reply.endsWith(TOOL_CANCELLED_REPLY)).toBe(true);
    expect(reply.startsWith(tokens.join(''))).toBe(true);
    expect(toolHandlerSpy).toHaveBeenCalledTimes(0); // 打字中断 ⇒ 工具不再执行
    expect(provider.chatCalls).toBe(1);
  });

  it('T4e 轮尽收尾分支：3 轮工具调用后最终轮打字中 abort ⇒ emitted < 全文、返回值以取消标记结尾', async () => {
    const FINAL_CONTENT = 'Z'.repeat(60);
    const controller = new AbortController();
    const tokens: string[] = [];
    let finalCharsEmitted = 0;
    let providerCall = 0;
    const toolHandlerSpy = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry();
    // 声明 seq 入参（additionalProperties:false ⇒ 未声明字段会被入参校验拦成 INVALID_ARGS）
    registry.register({
      name: 'probe_round',
      description: 'probe tool probe_round for #1165 E1 max-rounds typing cancel',
      parameters: {
        type: 'object',
        properties: { seq: { type: 'integer' } },
        additionalProperties: false,
      },
      handler: toolHandlerSpy,
    });
    const provider = stubProvider(async () => {
      providerCall += 1;
      if (providerCall <= 3) {
        // 每轮入参不同 ⇒ 避开 ToolGuard 循环检测（同工具＋同参数第 3 次会被 block，属另一判据）
        return { content: '', model: 'stub-model', toolCalls: [toolCall('probe_round', { seq: providerCall })] };
      }
      return { content: FINAL_CONTENT, model: 'stub-model' };
    });
    const executor = new ToolLoopExecutor(makeCtx(provider, registry));

    const reply = await executor.streamWithToolLoop((token) => {
      tokens.push(token);
      // 只对最终轮正文字符计数（前 3 轮的工具调用标记不是 'Z'）
      if (token === 'Z') {
        finalCharsEmitted += 1;
        if (finalCharsEmitted === 5) controller.abort(new Error('cancel during final typing'));
      }
    }, controller.signal);

    expect(provider.chatCalls).toBe(4); // 3 轮工具调用 ＋ 1 最终轮
    expect(toolHandlerSpy).toHaveBeenCalledTimes(3);
    expect(finalCharsEmitted).toBe(5); // 删收尾循环内检查 ⇒ 60 ⇒ 红
    expect(reply.endsWith(TOOL_CANCELLED_REPLY)).toBe(true);
    const finalCharsInReply = reply.split('Z').length - 1;
    expect(finalCharsInReply).toBeLessThan(FINAL_CONTENT.length);
  });
});
