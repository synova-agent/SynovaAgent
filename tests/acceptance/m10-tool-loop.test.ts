/**
 * tests/acceptance/m10-tool-loop.test.ts — M10 · agent 工具循环验收（裁 219 / Issue #637）
 *
 * 目的：把「模型自主行为」的接线锁进验收，防下次重构删接线时静默坏掉。
 * 驱动：**替身 provider ＋ 构造 ToolCall** —— 不跑真模型
 *       （真模型端到端只做一次性人工冒烟，不计入 M10 完成标准）。
 *
 * 五条判据（全机器可判 · 离线可跑）：
 *   ① 请求体含 tools 且 ≥1 个内置工具（反例：摘 registerBuiltinTools ⇒ 红）
 *   ② 模型能调用并拿到真实结果（反例：handler 抛错 ⇒ 结果带 error ⇒ 红）
 *   ③ assistant.tool_calls[].id 与其后 role='tool'.tool_call_id 严格配对
 *      （反例：tool_call_id 改 randomUUID ⇒ **本文件内部断言失败** ⇒ 红；
 *        🔴 不靠真 API 的 400 —— 替身 provider 不会返回 400）
 *   ④ 多轮不断（≥2 轮工具调用后仍收敛；反例：SYNO_MAX_TOOL_ROUNDS=1 ⇒ 红）
 *      ④-c 另锁配置上界：SYNO_MAX_TOOL_ROUNDS=1000 ⇒ 钳到 10 轮（费用上界，裁 219 M10-3）
 *   ⑤ 空工具时**不写** tools 字段（反例：无条件写 tools: [] ⇒ 红）
 *
 * 跑法：npx vitest run tests/acceptance/m10-tool-loop.test.ts
 *
 * 契约（铁律 47）：
 *   @input  — 无（进程内构造 ConversationEngine ＋ 替身 provider）
 *   @output — vitest 断言；失败即红（含具体判据号）
 *   @degraded — 测试自身不降级：工具执行失败/缺消息一律 throw 或 expect 失败
 *
 * 已知限制（Known Limitations）：
 *   - 本件驱动 `callLLMWithTools`（非流式）路径。`streamWithToolLoop` 的 `MAX_ROUNDS`
 *     不在裁 219 的配置化范围（裁 219 只点名 `MAX_TOOL_ROUNDS`），故不在此锁定。
 *   - 请求面用替身 provider 捕获 `ChatOptions`，不是真实 HTTP 请求体；
 *     真实路由面（POST /api/conversations）由 D819 集成用例
 *     `tests/agent/tool-loop-tool-pairing.integration.test.ts` 覆盖。
 *   - 🔴 `vitest.config.ts` 在 `CI` 下排除 `tests/acceptance/**` ⇒ 本件当前**不进 CI**；
 *     已上报 CTO（见 PR 回执「例外清单」），修复面不在本卡写集内。
 *
 * 铁律 33/38/48：命名 `*.test.ts`；`as any` 零容忍；每用例必有 expect。
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConversationEngine } from '../../src/agent/conversation-engine';
import { registerBuiltinTools } from '../../src/agent/builtin-tools';
import { SessionStore } from '../../src/store/session-store';
import type {
  ChatOptions,
  ChatResult,
  LLMMessage,
  LLMProvider,
  ToolCall,
} from '../../src/providers/types';

const STUB_MODEL = 'm10-stub-model';
const REAL_TOOL = 'show_diagnosis_progress';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 与实现同源的上界（裁 219 M10-3：配置必须有上界，如 ≤10） */
const MAX_ROUNDS_UPPER_BOUND = 10;

interface CapturedRequest {
  messages: LLMMessage[];
  options?: ChatOptions;
}

/** 单轮脚本：拿到轮次与本次 ChatOptions，返回替身模型响应 */
type RoundScript = (round: number, options?: ChatOptions) => ChatResult;

interface Harness {
  engine: ConversationEngine;
  calls: CapturedRequest[];
  close: () => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** 替身 provider：记录每次 chat 的 messages/options（快照），按脚本返回 */
function scriptedProvider(script: RoundScript): { provider: LLMProvider; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const provider: LLMProvider = {
    name: 'm10-stub-provider',
    baseUrl: 'stub://m10-tool-loop',
    async chat(messages, options): Promise<ChatResult> {
      calls.push({ messages: messages.map(m => ({ ...m })), options });
      return script(calls.length - 1, options);
    },
    async stream(messages, callback): Promise<void> {
      calls.push({ messages: messages.map(m => ({ ...m })), options: undefined });
      callback.onComplete?.(script(calls.length - 1));
    },
    async healthCheck() {
      return { healthy: true, latencyMs: 1 };
    },
    listModels() {
      return [STUB_MODEL];
    },
  };
  return { provider, calls };
}

/** 构造引擎；withBuiltinTools=true 时经**生产同一注册函数**注册内置工具 */
function harness(script: RoundScript, withBuiltinTools: boolean): Harness {
  const { provider, calls } = scriptedProvider(script);
  // fallbackProvider: null ⇒ 显式禁用 failover，确保只有替身 provider 被调用
  const engine = new ConversationEngine(provider, {
    orgId: 'm10-org',
    sessionId: 'm10-session',
    fallbackProvider: null,
  });
  const db = new Database(':memory:');
  if (withBuiltinTools) {
    const store = new SessionStore(db);
    registerBuiltinTools(
      engine.getToolRegistry(),
      store,
      'm10-session',
      () => engine.getPhase(),
      () => engine.getOrgId(),
    );
  }
  return { engine, calls, close: () => db.close() };
}

/** 全量配对校验：assistant.tool_calls[].id 与其后 role='tool'.tool_call_id 一一对应 */
function pairingOk(messages: LLMMessage[]): boolean {
  let pending: string[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (pending.length > 0) return false; // 上一轮 tool_calls 未被应答
      pending = (m.tool_calls ?? []).map(tc => tc.id ?? '(missing)');
    } else if (m.role === 'tool') {
      const id = m.tool_call_id;
      if (id === undefined) return false;
      const at = pending.indexOf(id);
      if (at === -1) return false;
      pending.splice(at, 1);
    }
  }
  return pending.length === 0;
}

function toolMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.filter(m => m.role === 'tool');
}

function payloadOf(message: LLMMessage): Record<string, unknown> {
  const parsed: unknown = JSON.parse(message.content);
  if (!isRecord(parsed)) throw new Error(`tool 消息内容不是 JSON 对象: ${message.content.slice(0, 120)}`);
  return parsed;
}

function withEnvMaxRounds(value: string | undefined): () => void {
  const previous = process.env.SYNO_MAX_TOOL_ROUNDS;
  if (value === undefined) delete process.env.SYNO_MAX_TOOL_ROUNDS;
  else process.env.SYNO_MAX_TOOL_ROUNDS = value;
  return () => {
    if (previous === undefined) delete process.env.SYNO_MAX_TOOL_ROUNDS;
    else process.env.SYNO_MAX_TOOL_ROUNDS = previous;
  };
}

describe('M10 · agent 工具循环验收（裁 219 · 离线 · 替身 provider）', () => {
  const closers: Array<() => void> = [];

  afterEach(() => {
    while (closers.length > 0) closers.pop()?.();
  });

  function make(script: RoundScript, withBuiltinTools: boolean): Harness {
    const h = harness(script, withBuiltinTools);
    closers.push(h.close);
    return h;
  }

  it('① 请求体含 tools 且 ≥1 内置工具', async () => {
    const { engine, calls } = make(
      () => ({ content: '你好', model: STUB_MODEL }),
      true,
    );
    await engine.processMessage('你好');

    expect(calls).toHaveLength(1);
    const options = calls[0].options;
    expect(options).toBeDefined();
    const tools = options?.tools ?? [];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(tools.map(t => t.function.name)).toContain(REAL_TOOL);
    for (const t of tools) {
      expect(t.type).toBe('function');
      expect(typeof t.function.name).toBe('string');
      expect(typeof t.function.description).toBe('string');
    }
  });

  it('② 模型能调用并拿到真实结果（内置 handler 的真实产物，不是空壳）', async () => {
    const { engine, calls } = make(
      (round, options) => {
        if (options?.tools === undefined) return { content: '进度已拿到', model: STUB_MODEL };
        if (round === 0) {
          return {
            content: '我先查进度',
            model: STUB_MODEL,
            toolCalls: [toolCall('call_m10_real_1', REAL_TOOL)],
          };
        }
        return { content: '进度已拿到', model: STUB_MODEL };
      },
      true,
    );

    const result = await engine.processMessage('查一下诊断进度');
    expect(result.reply).toBe('进度已拿到');
    expect(calls).toHaveLength(2);

    const [toolMsg] = toolMessages(calls[1].messages);
    expect(toolMsg).toBeDefined();
    if (toolMsg === undefined) throw new Error('第二轮请求缺 role=tool 消息');
    const payload = payloadOf(toolMsg);
    // 真实 handler（builtin-tools.ts show_diagnosis_progress）的产物字段
    expect(payload.error).toBeUndefined();
    expect(payload.totalPhases).toBe(5);
    expect(payload.percent).toBe(0);
    expect(payload.label).toBe('组织访谈');
  });

  it('③ tool_call_id 配对正确（assistant id == tool.tool_call_id，非随机 UUID）', async () => {
    const { engine, calls } = make(
      (round, options) => {
        if (options?.tools === undefined) return { content: '已拿到', model: STUB_MODEL };
        if (round === 0) {
          return {
            content: '',
            model: STUB_MODEL,
            toolCalls: [toolCall('call_m10_pair_1', REAL_TOOL)],
          };
        }
        return { content: '已拿到', model: STUB_MODEL };
      },
      true,
    );
    await engine.processMessage('配对检查');

    expect(calls).toHaveLength(2);
    const second = calls[1].messages;
    const assistant = second.find(m => m.role === 'assistant' && (m.tool_calls ?? []).length > 0);
    const [toolMsg] = toolMessages(second);
    expect(assistant).toBeDefined();
    expect(toolMsg).toBeDefined();
    if (assistant === undefined || toolMsg === undefined) throw new Error('配对场景缺 assistant/tool 消息');

    // 同一个 id：assistant 出站与 tool 回填必须同源（P0-2 回归锁）
    expect(assistant.tool_calls?.[0]?.id).toBe('call_m10_pair_1');
    expect(toolMsg.tool_call_id).toBe('call_m10_pair_1');
    expect(toolMsg.tool_call_id).not.toMatch(UUID_RE);
    expect(pairingOk(second)).toBe(true);
    expect(toolMessages(second)).toHaveLength(1);
  });

  it('④ 多轮不断：两轮工具调用后仍收敛（默认预算 3 轮）', async () => {
    const { engine, calls } = make(
      (round, options) => {
        if (options?.tools === undefined) return { content: 'M10 完成', model: STUB_MODEL };
        if (round === 0) {
          return { content: 'r1', model: STUB_MODEL, toolCalls: [toolCall('call_m10_r1', REAL_TOOL)] };
        }
        if (round === 1) {
          return {
            content: '',
            model: STUB_MODEL,
            toolCalls: [toolCall('call_m10_r2', REAL_TOOL, { probe: 2 })],
          };
        }
        return { content: 'M10 完成', model: STUB_MODEL };
      },
      true,
    );

    const result = await engine.processMessage('连续调两次工具');
    expect(result.reply).toBe('M10 完成');
    expect(calls).toHaveLength(3); // 2 工具轮 + 1 收敛轮
    expect(toolMessages(calls[2].messages)).toHaveLength(2);
    expect(pairingOk(calls[2].messages)).toBe(true);
  });

  it('④-b 配置生效：SYNO_MAX_TOOL_ROUNDS=1 ⇒ 第二轮被截断（证明 ④ 的依赖真实存在）', async () => {
    const restore = withEnvMaxRounds('1');
    try {
      const { engine, calls } = make(
        (round, options) => {
          if (options?.tools === undefined) return { content: 'M10 完成', model: STUB_MODEL };
          if (round === 0) {
            return { content: 'r1', model: STUB_MODEL, toolCalls: [toolCall('call_m10_cfg_1', REAL_TOOL)] };
          }
          return {
            content: '',
            model: STUB_MODEL,
            toolCalls: [toolCall('call_m10_cfg_2', REAL_TOOL, { probe: 2 })],
          };
        },
        true,
      );

      const result = await engine.processMessage('只给 1 轮预算');
      expect(calls).toHaveLength(2); // 1 工具轮 + 1 收尾轮（第二轮工具调用被截断）
      expect(toolMessages(calls[1].messages)).toHaveLength(1);
      expect(result.reply).toBe('M10 完成');
      expect(pairingOk(calls[1].messages)).toBe(true);
    } finally {
      restore();
    }
  });

  it('④-c 配置上界：SYNO_MAX_TOOL_ROUNDS=1000 ⇒ 钳到 10 轮（费用上界）', async () => {
    const restore = withEnvMaxRounds('1000');
    try {
      const { engine, calls } = make(
        (round, options) => {
          if (options?.tools === undefined) return { content: '上界收敛', model: STUB_MODEL };
          return {
            content: '',
            model: STUB_MODEL,
            toolCalls: [toolCall(`call_m10_cap_${round}`, REAL_TOOL, { probe: round })],
          };
        },
        true,
      );

      const result = await engine.processMessage('把轮数配到 1000');
      expect(result.reply).toBe('上界收敛');
      // 上界 10 ⇒ 10 工具轮 + 1 收尾轮；无上界时为 1001 次
      expect(calls).toHaveLength(MAX_ROUNDS_UPPER_BOUND + 1);
      expect(toolMessages(calls[calls.length - 1].messages)).toHaveLength(MAX_ROUNDS_UPPER_BOUND);
    } finally {
      restore();
    }
  });

  it('⑤ 空工具时不写 tools 字段（provider 契约）', async () => {
    const { engine, calls } = make(
      () => ({ content: '没有工具也能答', model: STUB_MODEL }),
      false, // 不注册任何工具 ⇒ 工具列表为空
    );
    const result = await engine.processMessage('你好');

    expect(result.reply).toBe('没有工具也能答');
    expect(calls).toHaveLength(1);
    const options = calls[0].options;
    expect(options).toBeDefined();
    if (options === undefined) throw new Error('替身 provider 未收到 ChatOptions');
    // 反例：无条件写 tools: [] ⇒ hasOwnProperty('tools') === true ⇒ 本断言红
    expect(Object.prototype.hasOwnProperty.call(options, 'tools')).toBe(false);
    expect(options.tools).toBeUndefined();
  });
});
