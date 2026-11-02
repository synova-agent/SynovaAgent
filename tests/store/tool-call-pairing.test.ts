/**
 * tests/store/tool-call-pairing.test.ts — #1257 P0-2a 判据 U-3（call/result 配对 + 悬空可检出）
 *
 * 判据源（唯一准绳）：handbook 派单件/2026-11-01-规格-1257-S1.5-P0快修.md §1.3／§3 U-3／§4-3/§4-7
 *
 * 🔴 U-3 形状（禁弱化）：
 *   ① **必须经 `ToolLoopExecutor` 真跑**（stub provider 一次返回 **2 个** toolCalls）——
 *      禁 `appendEvent` 手写 call/result 冒充（否则删掉 executor 的写入用例照样绿）；
 *   ② 正常态：2 条 `tool_call` ＋ 2 条 `tool_result`，每条 result 的 `source_event_seq`
 *      回指其 call 的 `seq`（**列**，不是 payload 字段），`listUnclosedToolCalls()` = `[]`；
 *   ③ 边界态：**物理删 1 条 `tool_result` 行** ⇒ `listUnclosedToolCalls()` 恰 `toEqual([该 callId])`
 *      （长度恰 1；已闭合的那条不在内）；
 *   ④ 降级态：call 的 payload 损坏 ⇒ 查询**不整批失败**、跳过坏行并置 `lastDegraded`（不静默）；
 *   ⑤ **生产订阅缝在位**（`import 'src/store/session-projection'` 安装原型 wrapper）：来源 seq 仍落列、
 *      配对仍闭合、payload_json 无保留键残留 —— 防"单测直连绿 / 生产列恒 NULL"的假绿复发。
 *
 * 覆盖三路径（铁律 48）：正常（U-3a/U-3c 两个循环）｜边界（U-3b）｜降级（U-3e）。
 * 改坏必红（承重点，H2 已真做并还原）：删 executor 的 `appendToolCallEvent` 调用 ⇒ U-3a/U-3b 红。
 *
 * 时钟口径：本文件不直取系统时钟；executor 侧耗时走既有 `performance.now()`（P12 时种棘轮）。
 * 零 `as any` 家族（铁律 38）；store 用真实 SessionStore（内存 DB），只替换 provider 外部边界（铁律 12）。
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ToolLoopExecutor } from '../../src/agent/tool-loop-executor';
import { ToolRegistry, type ToolDefinition } from '../../src/agent/tools';
import { SessionStore, SOURCE_EVENT_SEQ_KEY } from '../../src/store/session-store';
import type { EngineContext } from '../../src/agent/engine-context';
import type { DiagnosisEngine } from '../../src/l2-interfaces/diagnosis-engine';
import type { ChatResult, LLMMessage, LLMProvider, StreamCallback, ToolCall } from '../../src/providers/types';

// ═══ provider 替身（仅外部传输边界；其余全走生产代码）═══

function stubProvider(sequence: (callIndex: number) => ChatResult): LLMProvider {
  let callIndex = 0;
  return {
    name: 'stub-tool-pairing',
    baseUrl: 'https://stub.invalid',
    async chat(_messages: LLMMessage[]) {
      callIndex += 1;
      return sequence(callIndex);
    },
    async stream(_messages: LLMMessage[], _callback: StreamCallback): Promise<void> {
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

function probeTool(name: string): ToolDefinition {
  return {
    name,
    description: `probe tool ${name} for #1257 tool_call pairing`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({ ok: true, tool: name }),
  };
}

function toolCall(name: string, id: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

/** 一次返回 **2 个** toolCalls（U-3 硬要求；第 2 次调用给最终文本） */
function twoCallsThenFinal(): (callIndex: number) => ChatResult {
  return (callIndex: number): ChatResult => (
    callIndex === 1
      ? {
        content: '',
        model: 'stub-model',
        toolCalls: [toolCall('probe_pair_a', 'call_pair_a'), toolCall('probe_pair_b', 'call_pair_b')],
      }
      : { content: 'DONE', model: 'stub-model' }
  );
}

// ═══ 夹具 ═══

interface Fixture {
  db: Database.Database;
  store: SessionStore;
  sessionId: string;
  ctx: EngineContext;
}

function makeFixture(): Fixture {
  const db = new Database(':memory:');
  const store = new SessionStore(db);
  const sessionId = store.createSession('org-1257-pairing').id;
  const registry = new ToolRegistry();
  registry.register(probeTool('probe_pair_a'));
  registry.register(probeTool('probe_pair_b'));
  const ctx: EngineContext = {
    provider: stubProvider(twoCallsThenFinal()),
    messages: [{ role: 'system', content: 'sys' }],
    orgId: 'org-1257-pairing',
    sessionId,
    sessionStore: store,
    toolRegistry: registry,
    hookRunner: null,
    eventBus: null,
    evidenceCollector: null,
    corroborationEngine: null,
    graphBridge: null,
    graphStore: null,
    flags: { enableCommunityReports: false, enableEntityResolution: false },
    loggerPrefix: 'test-1257',
    diagnosisEngine: noopEngine(),
  };
  return { db, store, sessionId, ctx };
}

/** 跑完 2 个 toolCalls（非流式循环） */
async function runPlainPairing(fx: Fixture): Promise<void> {
  const executor = new ToolLoopExecutor(fx.ctx);
  const reply = await executor.callLLMWithTools();
  expect(reply).toBe('DONE');
}

/** 跑完 2 个 toolCalls（流式循环） */
async function runStreamPairing(fx: Fixture): Promise<void> {
  const executor = new ToolLoopExecutor(fx.ctx);
  const reply = await executor.streamWithToolLoop(() => undefined);
  expect(reply).toBe('DONE');
}

/** call.seq → 该 call 的 toolCallId（payload 解析；解析失败即抛，不静默） */
function callIdBySeq(store: SessionStore, sessionId: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const event of store.getEvents(sessionId)) {
    if (event.eventType !== 'tool_call') continue;
    const parsed: unknown = JSON.parse(event.payloadJson);
    const toolCallId =
      typeof parsed === 'object' && parsed !== null && 'toolCallId' in parsed
        ? (parsed as { toolCallId?: unknown }).toolCallId
        : undefined;
    if (typeof toolCallId !== 'string') {
      throw new Error(`tool_call seq=${event.seq} 缺 toolCallId: ${event.payloadJson.slice(0, 80)}`);
    }
    map.set(event.seq, toolCallId);
  }
  return map;
}

/** 配对全闭合的不变量断言（正常态；两个循环共用） */
function expectAllPairsClosed(fx: Fixture): void {
  const events = fx.store.getEvents(fx.sessionId);
  const calls = events.filter((event) => event.eventType === 'tool_call');
  const results = events.filter((event) => event.eventType === 'tool_result');
  // 一次返回 2 个 toolCalls ⇒ 恰 2 call + 2 result（不是 0、不是 4）
  expect(calls).toHaveLength(2);
  expect(results).toHaveLength(2);
  const idsOfCalls = callIdBySeq(fx.store, fx.sessionId);
  expect([...idsOfCalls.values()]).toEqual(['call_pair_a', 'call_pair_b']);
  // 每条 result 回指**对应** call 的 seq（按 callId 对齐，防"指错配对"混过）
  for (const result of results) {
    expect(result.sourceEventSeq).not.toBeNull();
    const linkedCallId = idsOfCalls.get(result.sourceEventSeq ?? -1);
    expect(linkedCallId).toBeDefined();
    const payload: unknown = JSON.parse(result.payloadJson);
    const resultCallId =
      typeof payload === 'object' && payload !== null && 'toolCallId' in payload
        ? (payload as { toolCallId?: unknown }).toolCallId
        : undefined;
    expect(resultCallId).toBe(linkedCallId); // result 自报的 callId == 被回指 call 的 callId
    // 保留键落列后必须剥离：payload_json 不得残留（列 ≠ payload 字段）
    expect(result.payloadJson).not.toContain(SOURCE_EVENT_SEQ_KEY);
  }
  // call 侧自身不定源（round/toolCallId/name 三字段，无保留键）
  for (const call of calls) {
    expect(call.sourceEventSeq).toBeNull();
    expect(call.payloadJson).not.toContain(SOURCE_EVENT_SEQ_KEY);
    const parsed: unknown = JSON.parse(call.payloadJson);
    expect(parsed).toMatchObject({ round: 0 });
    expect(parsed).toHaveProperty('name');
    expect(parsed).toHaveProperty('toolCallId');
  }
  // 全部闭合 ⇒ 未闭合查询为空（正常态）
  expect(fx.store.listUnclosedToolCalls(fx.sessionId)).toEqual([]);
}

// ═══ U-3a：非流式循环（callLLMWithTools）═══

describe('#1257 U-3 call/result 配对（经 ToolLoopExecutor 真跑，2 个 toolCalls）', () => {
  it('U-3a callLLMWithTools：2 call + 2 result、source_event_seq 逐条回指、未闭合为空', async () => {
    const fx = makeFixture();
    try {
      await runPlainPairing(fx);
      expectAllPairsClosed(fx);
    } finally {
      fx.db.close();
    }
  });

  // ═══ U-3b：边界 —— 物理删 1 条 tool_result ═══

  it('U-3b 删 1 条 tool_result 行 ⇒ listUnclosedToolCalls() 恰 toEqual([该 callId])（长度 1）', async () => {
    const fx = makeFixture();
    try {
      await runPlainPairing(fx);
      expectAllPairsClosed(fx);

      // 取第 1 个 result 行（按 seq 升序）⇒ 它回指的 call 应成为唯一未闭合
      const target = fx.db.prepare(
        `SELECT seq, source_event_seq FROM session_events
          WHERE session_id=? AND event_type='tool_result' ORDER BY seq ASC LIMIT 1`,
      ).get(fx.sessionId) as { seq: number; source_event_seq: number } | undefined;
      if (target === undefined) throw new Error('夹具前置失败：没有 tool_result 行');
      const expectedCallId = callIdBySeq(fx.store, fx.sessionId).get(target.source_event_seq);
      if (expectedCallId === undefined) throw new Error('被删 result 的 source_event_seq 找不到对应 call');

      const deleted = fx.db.prepare(
        "DELETE FROM session_events WHERE session_id=? AND event_type='tool_result' AND seq=?",
      ).run(fx.sessionId, target.seq);
      expect(deleted.changes).toBe(1); // 真删了 1 行（不是"没删成也绿"）

      // 判据形状：恰 1 个，且 == 被删 result 回指的那个 callId（另一条已闭合的不在内）
      const unclosed = fx.store.listUnclosedToolCalls(fx.sessionId);
      expect(unclosed).toHaveLength(1);
      expect(unclosed).toEqual([expectedCallId]);
    } finally {
      fx.db.close();
    }
  });

  // ═══ U-3c：两个循环都写（流式同样配对）═══

  it('U-3c streamWithToolLoop：同一配对不变量成立（两循环都写 call）', async () => {
    const fx = makeFixture();
    try {
      await runStreamPairing(fx);
      expectAllPairsClosed(fx);
    } finally {
      fx.db.close();
    }
  });

  // ═══ U-3e：降级 —— call 的 payload 损坏 ═══

  it('U-3e 未闭合 call 的 payload 损坏 ⇒ 跳过坏行不整批失败 + lastDegraded=true（不静默）', async () => {
    const fx = makeFixture();
    try {
      await runPlainPairing(fx);
      // 删掉全部 result（两组都未闭合）后把其中 1 条 call 的 payload 写成非法 JSON
      fx.db.prepare("DELETE FROM session_events WHERE session_id=? AND event_type='tool_result'").run(fx.sessionId);
      const firstCall = fx.db.prepare(
        "SELECT seq FROM session_events WHERE session_id=? AND event_type='tool_call' ORDER BY seq ASC LIMIT 1",
      ).get(fx.sessionId) as { seq: number } | undefined;
      if (firstCall === undefined) throw new Error('夹具前置失败：没有 tool_call 行');
      fx.db.prepare("UPDATE session_events SET payload_json='{broken' WHERE session_id=? AND seq=?")
        .run(fx.sessionId, firstCall.seq);

      const unclosed = fx.store.listUnclosedToolCalls(fx.sessionId);
      expect(unclosed).toEqual(['call_pair_b']); // 只有可解析的那条被报出
      expect(fx.store.lastDegraded).toBe(true); // 降级信号传播（铁律 31），不是静默跳过
    } finally {
      fx.db.close();
    }
  });

  // ═══ 生产缝在位回归（防假绿复发；本用例必须最后跑 —— import 即安装原型 wrapper）═══

  it('U-3f 生产订阅缝在位（session-projection 已安装）⇒ 保留键仍落列、配对闭合、无键残留', async () => {
    // 副作用导入：安装 SessionStore.prototype.appendEvent 的三参 wrapper
    //（生产由 src/deploy/bootstrap.ts:27 同款副作用导入；wrapper 只转发 payload 对象 ⇒ 保留键仍在）
    await import('../../src/store/session-projection');
    const fx = makeFixture();
    try {
      await runPlainPairing(fx);
      expectAllPairsClosed(fx);
      // 列真有值（不是 NULL）——即"生产路径"下 listUnclosedToolCalls 仍可检出
      const linked = fx.db.prepare(
        "SELECT COUNT(*) AS n FROM session_events WHERE session_id=? AND event_type='tool_result' AND source_event_seq IS NOT NULL",
      ).get(fx.sessionId) as { n: number };
      expect(linked.n).toBe(2);
    } finally {
      fx.db.close();
    }
  });

  it('U-3g 只读：listUnclosedToolCalls 不写库（前后事件零变化）', async () => {
    const fx = makeFixture();
    try {
      await runPlainPairing(fx);
      const before = fx.db.prepare('SELECT * FROM session_events WHERE session_id=? ORDER BY seq').all(fx.sessionId);
      expect(fx.store.listUnclosedToolCalls(fx.sessionId)).toEqual([]);
      const after = fx.db.prepare('SELECT * FROM session_events WHERE session_id=? ORDER BY seq').all(fx.sessionId);
      expect(after).toEqual(before);
    } finally {
      fx.db.close();
    }
  });
});
