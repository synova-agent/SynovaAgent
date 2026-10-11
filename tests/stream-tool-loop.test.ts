/**
 * stream-tool-loop.test.ts — Slice 0.1: 统一单次 LLM 调用测试 (iron law 0-2 Step 2)
 *
 * 验证: streamWithToolLoop 每条用户消息只调一次 LLM,
 *      从 single chat 结果的文本部分做流式输出,
 *      工具调用在同一个 chat 响应中处理。
 *
 * Given/When/Then 格式，fake provider 可控。
 *
 * 🔒 离线确定性（#351 · CTO 2026-10-12 裁甲）：本文件**每一处** `new ConversationEngine(...)`
 *   都显式传 `{ fallbackProvider: null }`，作用是**断掉构造函数对注入 fake 的自动接线** ——
 *   `ConversationEngine` 构造函数在 `config.fallbackProvider === undefined` 时调
 *   `buildFallbackProvider(provider)`；该函数只要环境里存在 `LLM_API_KEY` / `DEEPSEEK_API_KEY`，
 *   就会**派生一个真实 deepseek provider 挂进 failover chain**。
 *   （注入的 fake 的 `baseUrl = 'fake://test'` 经 `detectProviderFromUrl` 落到默认分支 `'openai'`
 *     ⇒ 走 else 支 ⇒ 去取 deepseek 凭据。实测见 evidence/351-*.md。）
 *   ⇒ 不显式置 null 时，**主 provider 抛错 ⇒ 链回退到真实 provider ⇒ 发出真实网络请求**，
 *      断言随模型输出漂移 ⇒ 测试非 hermetic（CI 上无差别翻红不相关 PR）。
 *
 * ⚠️ 措辞（CTO 明令）：这叫「**断掉构造函数对注入 fake 的自动接线**」，
 *   **不是**「注入 fake provider」—— 本文件自仓库引入起就在用 fake provider（`fakeProviderWithTools`），
 *   **夹具无需改动**。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationEngine } from '../src/agent/conversation-engine';
const AgentConversation = ConversationEngine;
import { ToolRegistry } from '../src/agent/tools';
import type { LLMProvider, ChatResult, StreamCallback } from '../src/providers/types';

// ═══ Fake Provider with controllable behavior ═══

interface FakeProviderOpts {
  /** Text content for the first chat call */
  firstContent?: string;
  /** Tool calls for the first chat call */
  firstToolCalls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
  /** Text content for the second chat call (after tool results) */
  secondContent?: string;
  /** Tool calls for the second chat call */
  secondToolCalls?: Array<{ id?: string; function: { name: string; arguments: string } }>;
  /** Make chat() throw after Nth call */
  throwAfterCalls?: number;
  /** Error to throw */
  throwError?: Error;
}

function fakeProviderWithTools(opts: FakeProviderOpts = {}): LLMProvider {
  let chatCount = 0;

  const provider: LLMProvider = {
    name: 'fake-tools',
    baseUrl: 'fake://test',

    async chat(_messages, _options): Promise<ChatResult> {
      chatCount++;
      if (typeof opts.throwAfterCalls === 'number' && chatCount > opts.throwAfterCalls) {
        throw opts.throwError || new Error('Simulated LLM failure');
      }

      if (chatCount === 1) {
        return {
          content: opts.firstContent || '这是回复文本。',
          model: 'fake',
          toolCalls: opts.firstToolCalls,
        };
      } else {
        return {
          content: opts.secondContent || '工具结果已收到，最终回复。',
          model: 'fake',
          toolCalls: opts.secondToolCalls,
        };
      }
    },

    async stream(_msgs: any, cb: StreamCallback): Promise<void> {
      // Stream API is NOT called in the new implementation
      // (this is the key fix: no more double LLM calls)
      throw new Error('stream() should not be called — single chat() only');
    },

    async healthCheck() {
      return { healthy: true, latencyMs: 1 };
    },

    listModels() {
      return ['fake'];
    },
  };

  return provider;
}

// ═══ Fake Tool Registry ═══

function setupToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'query_ontology',
    description: '查询本体图',
    parameters: {
      type: 'object',
      properties: { orgId: { type: 'string' } },
      required: ['orgId'],
    },
    handler: async (params: Record<string, unknown>) => {
      return { nodes: 5, edges: 3, orgId: params.orgId || 'unknown' };
    },
  });
  registry.register({
    name: 'fetch_document',
    description: '获取文档',
    parameters: {
      type: 'object',
      properties: { docId: { type: 'string' } },
      required: ['docId'],
    },
    handler: async (params: Record<string, unknown>) => {
      return { content: `Document ${params.docId} content`, docId: params.docId };
    },
  });
  return registry;
}

// ═══ Tests ═══

describe('streamWithToolLoop — single LLM call per user message', () => {
  let conv: AgentConversation;

  beforeEach(() => {
    conv = new AgentConversation(
      fakeProviderWithTools({ firstContent: '你好！请告诉我你的组织情况。' }),
      { fallbackProvider: null },
    );
  });

  // ── Happy path: no tool calls ──

  it('Given no tool calls needed, When processMessageStream, Then returns reply with exactly 1 chat call', async () => {
    let chatCalls = 0;
    const provider = fakeProviderWithTools({ firstContent: '好的，我已了解。' });
    const spy = vi.spyOn(provider, 'chat');
    const conv2 = new AgentConversation(provider, { fallbackProvider: null });

    const tokens: string[] = [];
    const result = await conv2.processMessageStream('我的组织叫测试公司', (t) => tokens.push(t));

    expect(result.reply).toBe('好的，我已了解。');
    expect(result.phaseComplete).toBe(false);
    // All tokens from content should be streamed
    expect(tokens.join('')).toBe('好的，我已了解。');
    // Exactly 1 chat call — no double call
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // ── Tool call path: single chat returns tool_calls ──

  it('Given LLM returns tool_calls, When processMessageStream, Then executes tools and does second round', async () => {
    const toolExecLog: string[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'test_tool',
      description: 'Test tool',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        toolExecLog.push('executed');
        return { result: 'ok' };
      },
    });
    // Register tools into conv's own ToolRegistry (public API)
    const convToolReg = conv.getToolRegistry();
    convToolReg.register({
      name: 'test_tool',
      description: 'Test tool',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        toolExecLog.push('executed');
        return { result: 'ok' };
      },
    });

    const provider = fakeProviderWithTools({
      firstContent: '需要查询数据库。',
      firstToolCalls: [
        { function: { name: 'test_tool', arguments: '{}' } },
      ],
      secondContent: '查询结果显示一切正常。',
    });
    const spy = vi.spyOn(provider, 'chat');
    const conv2 = new AgentConversation(provider, { fallbackProvider: null });
    // Register same tool into conv2's registry
    const conv2ToolReg = conv2.getToolRegistry();
    conv2ToolReg.register({
      name: 'test_tool',
      description: 'Test tool',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        toolExecLog.push('executed');
        return { result: 'ok' };
      },
    });

    const tokens: string[] = [];
    const result = await conv2.processMessageStream('检查系统状态', (t) => tokens.push(t));

    expect(result.reply).toBe('查询结果显示一切正常。');
    // Tool was executed
    expect(toolExecLog).toContain('executed');
    // 2 chat calls: first with tool_calls, second after tool results
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── Error path: chat() throws ──

  it('Given chat throws an error, When processMessageStream, Then returns error message', async () => {
    const provider = fakeProviderWithTools({
      throwAfterCalls: -1,
      throwError: new Error('Network timeout'),
    });
    const conv2 = new AgentConversation(provider, { fallbackProvider: null });

    const tokens: string[] = [];
    const result = await conv2.processMessageStream('测试错误', (t) => tokens.push(t));

    // Should contain error indication
    expect(result.reply).toContain('失败');
  });

  // ── Max rounds: 3 rounds of tool calls ──

  it('Given persistent tool calls for 3 rounds, When processMessageStream, Then returns final reply on 4th round', async () => {
    const provider = fakeProviderWithTools({
      firstContent: 'Round 1',
      firstToolCalls: [{ function: { name: 'query_ontology', arguments: '{"orgId":"t1"}' } }],
      secondContent: 'Round 2',
      secondToolCalls: [{ function: { name: 'fetch_document', arguments: '{"docId":"d1"}' } }],
    });
    const conv2 = new AgentConversation(provider, { fallbackProvider: null });
    const registry = setupToolRegistry();
    (conv2 as any).toolRegistry = registry;

    const result = await conv2.processMessageStream('测试', () => {});

    // After 3 tool rounds, falls through to final chat without tools
    expect(result.reply).toBeTruthy();
  });

  // ── Streaming integrity: tokens match final content ──

  it('Given a long reply, When streamed, Then all tokens concatenate to final reply', async () => {
    const longText = '这是一个较长的回复，包含多字节字符、英文混合 content，' +
      '用于验证流式输出的完整性。每个 token 都应被正确传递到 onToken 回调。';
    const provider = fakeProviderWithTools({ firstContent: longText });
    const conv2 = new AgentConversation(provider, { fallbackProvider: null });

    const tokens: string[] = [];
    const result = await conv2.processMessageStream('你好', (t) => tokens.push(t));

    expect(tokens.join('')).toBe(longText);
    expect(result.reply).toBe(longText);
  });
});

describe('streamWithToolLoop — tool_call_id fix', () => {
  it('Given a tool call, When tool result injected, Then tool_call_id equals the model-provided id (paired, not random UUID)', async () => {
    const toolNames: string[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'my_special_tool',
      description: 'Test',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        toolNames.push('called');
        return { ok: true };
      },
    });

    const provider = fakeProviderWithTools({
      firstContent: 'Calling tool...',
      firstToolCalls: [
        { id: 'call_test_1', function: { name: 'my_special_tool', arguments: '{}' } },
      ],
      secondContent: 'Tool done.',
    });
    const conv = new AgentConversation(provider, { fallbackProvider: null });
    // Register tool via public API
    const convToolReg = conv.getToolRegistry();
    convToolReg.register({
      name: 'my_special_tool',
      description: 'Test',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        toolNames.push('called');
        return { ok: true };
      },
    });

    await conv.processMessage('test',);

    // Tool was called
    expect(toolNames).toContain('called');

    // Check that tool message in history uses the model-provided id (D819: 不再用随机 UUID)
    const msgs = conv.getMessages() as any[];
    const toolMsg = msgs.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    // tool_call_id should NOT be the function name
    expect(toolMsg.tool_call_id).not.toBe('my_special_tool');
    // D819: 必须等于模型给的 tc.id —— assistant.tool_calls[].id 与 tool.tool_call_id 同源
    expect(toolMsg.tool_call_id).toBe('call_test_1');
    // 且不再是随机 UUID 形态（旧实现 crypto.randomUUID）
    expect(toolMsg.tool_call_id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // assistant 中间态消息带同 id 的 tool_calls（配对的结构前提）
    const assistantWithCalls = msgs.find((m: { role?: string; tool_calls?: Array<{ id?: string }> }) =>
      m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(assistantWithCalls?.tool_calls?.[0]?.id).toBe('call_test_1');
  });
});
