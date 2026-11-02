/**
 * tests/agent/tool-loop-tool-pairing.integration.test.ts — D819
 * 「工具接线三修」的穿真实入口集成用例（正常 / 降级 / 边界三路径）
 *
 * 铁律 12 + 验收标准《穿真实入口 v1》：
 *   - 真实 bootstrap（src/server.ts createServer）+ 真实 express 路由
 *     （POST /api/conversations → src/routes/conversations.ts handleConversationMessage）
 *   - 真实 ConversationEngine → ToolLoopExecutor → callWithResilience → provider.chat
 *     （src/providers/base.ts）
 *   - **零 mock 管线**：唯一被替换的是「模型本身」——tests/helpers/fake-llm-upstream.ts
 *     起一个 127.0.0.1 的 OpenAI 兼容假上游（只读复用，不修改）
 *   - 上游指向走既有配置缝：SYNOVA_DATA_DIR/llm-credentials.json（setLlmCredential）→
 *     config.ts 每请求重读（零缓存）→ routes/conversations.ts createProvider({baseUrl})
 *
 * 三修对应断言：
 *   ① 出站请求体含 tools 且长度 == **同一注册函数进程内复算**的注册工具数（不硬编码）
 *   ② 第二轮请求出现 role='tool' 且 tool_call_id === assistant.tool_calls[].id（模型给的 id 原样透传）
 *   ③ 第二轮角色序**精确等于** ['system','user','assistant','tool']（无连续 assistant、不缺 tool）
 *
 * 证据落盘：docs/synova/product-lines/evidence/D819-capture-20260919.json
 *   afterAll 统一写（机器生成；剥离端口 / sessionId / 毫秒时间戳等易变面，两次运行 sha256 一致）
 *
 * #1257 P0-2a（配对回归，本批追加）：executor 现在还会写 `tool_call`/`tool_result` 事件
 * （`source_event_seq` 配对）。本文件断言**出站消息配对不退化**：每个请求的
 * `assistant.tool_calls[].id` 序列必须与 `tool.tool_call_id` 序列逐位相等（证据文件里同源落盘）。
 * 🔴 为什么不在此断言事件流：本用例的库是 `SYNOVA_DB_PATH=':memory:'`，SessionStore 实例在
 *   createServer 内部、HTTP 层拿不到句柄 ⇒ 事件级配对由 tests/store/tool-call-pairing.test.ts（U-3）承载；
 *   此处守"用户可见面"（模型收到的工具对话结构）不因写事件而回归。
 *
 * 铁律 24/31/33/47/48；红线：不在 src/** 加测试专用分支，不改 D817 的 helper 与断言口径。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server';
import { setLlmCredential } from '../../src/services/llm-credential-store';
import { ToolRegistry } from '../../src/agent/tools';
import { registerBuiltinTools } from '../../src/agent/builtin-tools';
import { SessionStore } from '../../src/store/session-store';
import { startFakeLlmUpstream, type CapturedRequest, type FakeLlmUpstream, type ScriptedRound } from '../helpers/fake-llm-upstream';

/** 证据落盘路径（D819 自己的文件；D817 那份由 D819 用例运行后还原，不提交重写） */
const EVIDENCE_PATH = join(process.cwd(), 'docs/synova/product-lines/evidence/D819-capture-20260919.json');

const FAKE_API_KEY = 'd819-fake-key-not-a-real-secret';
const FAKE_MODEL = 'd819-fake-model';
/** 真实存在的内置工具（src/agent/builtin-tools.ts register）——工具循环必须真的执行到它 */
const REAL_TOOL = 'show_diagnosis_progress';
const UNKNOWN_TOOL = 'd819_no_such_tool';

/** 环境隔离：逐个 delete 会让 detectProvider / buildFallbackProvider 落到真实 provider */
const ENV_KEYS = [
  'DEV_MODE', 'PORT', 'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'SYNOVA_SKIP_MCP', 'SYNOVA_ORG_ID',
  'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'OPENAI_API_KEY',
  'QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'GLM_API_KEY', 'ZHIPU_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY',
  'YI_API_KEY', 'LINGYI_API_KEY', 'MINIMAX_API_KEY', 'STEP_API_KEY', 'ERNIE_API_KEY', 'ERNIE_SECRET_KEY',
  'OPENCLAW_GATEWAY_HOST', 'ENGINE_TOKENS',
] as const;

// ═══ 零类型断言工具（铁律 38） ═══

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function recordArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function stringField(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' ? v : undefined;
}

function messagesOf(req: CapturedRequest): Array<Record<string, unknown>> {
  return recordArray(req.body.messages);
}

function rolesOf(req: CapturedRequest): string[] {
  return messagesOf(req).map(m => stringField(m, 'role') ?? 'unknown');
}

function toolCallIdsOf(msg: Record<string, unknown>): string[] {
  return recordArray(msg.tool_calls)
    .map(tc => stringField(tc, 'id'))
    .filter((id): id is string => typeof id === 'string');
}

function toolsCountOf(req: CapturedRequest): number {
  return recordArray(req.body.tools).length;
}

/** 全量配对校验：assistant.tool_calls[].id 与其后 role='tool'.tool_call_id 一一对应 */
function pairingOk(msgs: Array<Record<string, unknown>>): boolean {
  let pending: string[] = [];
  for (const m of msgs) {
    const role = stringField(m, 'role');
    if (role === 'assistant') {
      if (pending.length > 0) return false; // 上一轮 tool_calls 未被应答（缺 tool 消息）
      const ids = toolCallIdsOf(m);
      if (ids.length > 0) pending = ids.slice();
    } else if (role === 'tool') {
      const id = stringField(m, 'tool_call_id');
      if (id === undefined) return false;
      const at = pending.indexOf(id);
      if (at === -1) return false;
      pending.splice(at, 1);
    }
  }
  return pending.length === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SSE 帧解析（web-adapter.ts 契约：`event: <type>` + `data: {json}` + 空行） */
function parseSseFrames(text: string): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  for (const block of text.split('\n\n')) {
    const dataLine = block.split('\n').find(l => l.startsWith('data: '));
    if (dataLine === undefined) continue;
    const raw = dataLine.slice(6);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error(`SSE data 行不是 JSON 对象: ${raw.slice(0, 120)}`);
    frames.push(parsed);
  }
  return frames;
}

function frameTypes(frames: Array<Record<string, unknown>>): string[] {
  return frames.map(f => (typeof f.type === 'string' ? f.type : '(no-type)'));
}

// ═══ 证据落盘（机器生成、确定性） ═══

interface ScenarioRecord {
  id: string;
  name: string;
  registered_tool_count: number;
  requests: Array<{
    index: number;
    body_keys: string[];
    messages_roles: string[];
    has_tools_field: boolean;
    tools_len: number;
    assistant_tool_call_ids: string[];
    tool_message_ids: string[];
    pairing_ok: boolean;
  }>;
  sse_converged: boolean;
  sse_error_frames: string[];
}

const evidenceScenarios: ScenarioRecord[] = [];
let entryBaseUrl = '';

/** 上游装配缝（写进证据文件的 entry.upstream_seam；与 afterAll/末用例同源，禁两处字面量分叉） */
const ENTRY_UPSTREAM_SEAM = 'SYNOVA_DATA_DIR/llm-credentials.json → src/config.ts loadConfig()（每请求重读）→ src/routes/conversations.ts createProvider({baseUrl}) → src/providers/base.ts fetch';

function recordScenario(
  id: string,
  name: string,
  fake: FakeLlmUpstream,
  sseText: string,
): ScenarioRecord {
  const frames = parseSseFrames(sseText);
  const record: ScenarioRecord = {
    id,
    name,
    // D819 修正（task-4 L1）: 与顶层 writeEvidence(expectedToolCount) 同源——同一份进程内复算真值
    registered_tool_count: expectedToolCount,
    requests: fake.requests.map(r => {
      const msgs = messagesOf(r);
      return {
        index: r.index,
        body_keys: r.bodyKeys,
        messages_roles: rolesOf(r),
        has_tools_field: r.hasToolsField,
        tools_len: toolsCountOf(r),
        assistant_tool_call_ids: msgs
          .filter(m => stringField(m, 'role') === 'assistant')
          .flatMap(m => toolCallIdsOf(m)),
        tool_message_ids: msgs
          .filter(m => stringField(m, 'role') === 'tool')
          .map(m => stringField(m, 'tool_call_id') ?? '(missing)'),
        pairing_ok: pairingOk(msgs),
      };
    }),
    sse_converged: frames.length > 0 && frameTypes(frames)[frames.length - 1] === 'end',
    sse_error_frames: frames.filter(f => f.type === 'error').map(f => String(f.code ?? 'unknown')),
  };
  evidenceScenarios.push(record);
  return record;
}

/** 写入证据文件（确定性：无端口 / sessionId / 毫秒时间戳） */
function writeEvidence(registeredToolCount: number, entryUpstreamSeam: string): void {
  const evidence = {
    schema: 1,
    record_type: 'production-entry-capture',
    task: 'D819',
    title: '工具接线三修：出站带 tools + 响应侧 tool_calls 映射 + assistant 不重复',
    captured_date: new Date().toISOString().slice(0, 10),
    generated_by: 'tests/agent/tool-loop-tool-pairing.integration.test.ts',
    volatile_fields_excluded: ['mock 端口', 'session_id', '毫秒时间戳'],
    entry: {
      server: 'src/server.ts createServer()（真实 bootstrap）',
      routes: ['POST /api/conversations', 'POST /api/conversations/:id/messages'],
      listen: 'PORT=0 + server.address()（OS 分配随机端口）',
      upstream_seam: entryUpstreamSeam,
      pipeline: 'ConversationEngine → ToolLoopExecutor → callWithResilience → provider.chat → base.ts fetch（零 mock 管线；唯一替身是模型本身）',
    },
    registered_tool_count: registeredToolCount,
    reference_ids: {
      real_tool: REAL_TOOL,
      unknown_tool: UNKNOWN_TOOL,
      sse_tool_annotation: '[工具调用: ',
    },
    scenarios: [...evidenceScenarios].sort((a, b) => a.id.localeCompare(b.id)),
  };
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');
}

// ═══ 探针：注册工具数（与 routes/conversations.ts 同一注册函数，进程内复算） ═══

function registeredToolCount(): number {
  const db = new Database(':memory:');
  try {
    const store = new SessionStore(db);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, store, 'd819-probe-session', () => 0, () => 'd819-probe-org');
    return registry.listTools().length;
  } finally {
    db.close();
  }
}

// ═══ 测试主体 ═══

let server: Server;
let base = '';
let bootstrapFake: FakeLlmUpstream;
let tmpDataDir = '';
let expectedToolCount = 0;
const savedEnv = new Map<string, string | undefined>();

async function startScenarioUpstream(script: ScriptedRound[]): Promise<FakeLlmUpstream> {
  const fake = await startFakeLlmUpstream({ script });
  // 既有配置缝：每请求 loadConfig() 重读凭证文件（config.ts:76 注释 + llm-credential-store 零缓存）
  setLlmCredential({ provider: 'deepseek', apiKey: FAKE_API_KEY, model: FAKE_MODEL, baseUrl: fake.baseUrl });
  return fake;
}

/** 一轮对话 = 一个新会话的首条消息（POST /api/conversations）。返回 SSE 原文 */
async function postEntryTurn(message: string): Promise<{ status: number; contentType: string; text: string }> {
  const res = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', text };
}

function expectSseConverged(text: string): Array<Record<string, unknown>> {
  const frames = parseSseFrames(text);
  expect(frames.length).toBeGreaterThan(0);
  const types = frameTypes(frames);
  expect(types[0]).toBe('open');
  expect(types).toContain('token');
  expect(types[types.length - 1]).toBe('end');
  expect(frames.filter(f => f.type === 'error')).toEqual([]);
  return frames;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    savedEnv.set(k, process.env[k]);
    delete process.env[k];
  }
  process.env.DEV_MODE = 'true';
  process.env.PORT = '0';
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_SKIP_MCP = '1';
  tmpDataDir = mkdtempSync(join(tmpdir(), 'synova-d819-'));
  process.env.SYNOVA_DATA_DIR = tmpDataDir;

  expectedToolCount = registeredToolCount();
  if (expectedToolCount <= 0) throw new Error('探针注册工具数为 0 —— 注册函数缝失效（禁止弱替身）');

  // bootstrap 假上游：仅承接 createServer 启动期的健康检查（GET /models）；场景各自另起实例
  bootstrapFake = await startFakeLlmUpstream({ fallbackContent: 'D819 bootstrap' });
  setLlmCredential({ provider: 'deepseek', apiKey: FAKE_API_KEY, model: FAKE_MODEL, baseUrl: bootstrapFake.baseUrl });

  server = await createServer();
  const addr = server.address() as AddressInfo | null;
  if (addr === null || typeof addr === 'string') throw new Error('createServer 未返回可解析的监听地址');
  base = `http://127.0.0.1:${addr.port}`;
  entryBaseUrl = bootstrapFake.baseUrl;
}, 60_000);

afterAll(async () => {
  writeEvidence(expectedToolCount, ENTRY_UPSTREAM_SEAM);
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  await bootstrapFake.close();
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
});

describe('D819 工具接线（真实 createServer + 真实路由 + 假上游，零 mock 管线）', () => {
  it('A 正常路径：tools 进请求体 + assistant.tool_calls 与 tool.tool_call_id 严格配对', async () => {
    const fake = await startScenarioUpstream([
      { content: 'A 首轮', toolCalls: [{ name: REAL_TOOL, arguments: '{}', id: 'call_d819_ok_1' }] },
      { content: 'A 续轮', },
    ]);
    try {
      const turn = await postEntryTurn('D819 A：正常路径');
      expect(turn.status).toBe(200);
      expect(turn.contentType).toContain('text/event-stream');
      const frames = expectSseConverged(turn.text);
      recordScenario('A', '正常路径', fake, turn.text);

      // 请求 1 = 工具轮，请求 2 = 工具结果喂回后的续轮
      expect(fake.requests.length).toBe(2);
      const [first, second] = fake.requests;

      // ① tools 进请求体：长度 == 进程内同源复算的注册工具数
      expect(first.bodyKeys).toContain('tools');
      expect(toolsCountOf(first)).toBe(expectedToolCount);
      expect(toolsCountOf(second)).toBe(expectedToolCount);
      const toolNames = recordArray(first.body.tools)
        .map(t => (isRecord(t.function) ? stringField(t.function, 'name') : undefined))
        .filter((n): n is string => typeof n === 'string');
      expect(toolNames).toContain(REAL_TOOL);
      for (const t of recordArray(first.body.tools)) {
        expect(t.type).toBe('function');
        expect(isRecord(t.function)).toBe(true);
        expect(typeof (isRecord(t.function) ? t.function.name : undefined)).toBe('string');
      }

      // 角色序：工具轮 [system,user]；续轮精确 [system,user,assistant,tool]
      expect(rolesOf(first)).toEqual(['system', 'user']);
      expect(rolesOf(second)).toEqual(['system', 'user', 'assistant', 'tool']);

      // ② assistant 带 tool_calls（id/name/arguments 齐）且 id == 模型给的 id
      const secondMsgs = messagesOf(second);
      const assistant = secondMsgs.find(m => stringField(m, 'role') === 'assistant');
      expect(assistant).toBeDefined();
      if (assistant === undefined) throw new Error('续轮缺 assistant 消息');
      const callIds = toolCallIdsOf(assistant);
      expect(callIds).toEqual(['call_d819_ok_1']);
      const call0 = recordArray(assistant.tool_calls)[0];
      expect(isRecord(call0.function)).toBe(true);
      expect(isRecord(call0.function) ? call0.function.name : undefined).toBe(REAL_TOOL);
      expect(isRecord(call0.function) ? call0.function.arguments : undefined).toBe('{}');

      // ③ tool 消息 tool_call_id == assistant.tool_calls[].id，且不再是随机 UUID
      const toolMsg = secondMsgs.find(m => stringField(m, 'role') === 'tool');
      expect(toolMsg).toBeDefined();
      if (toolMsg === undefined) throw new Error('续轮缺 role=tool 消息');
      expect(stringField(toolMsg, 'tool_call_id')).toBe('call_d819_ok_1');
      expect(stringField(toolMsg, 'tool_call_id')).not.toMatch(UUID_RE);
      expect(pairingOk(secondMsgs)).toBe(true);

      // 工具被真实执行：产物字段来自 builtin-tools 的真实 handler（不是空壳）
      const toolPayload: unknown = JSON.parse(stringField(toolMsg, 'content') ?? '{}');
      expect(isRecord(toolPayload)).toBe(true);
      if (!isRecord(toolPayload)) throw new Error('tool 消息内容不是 JSON 对象');
      expect(toolPayload.error).toBeUndefined();
      expect(typeof toolPayload.totalPhases).toBe('number');
      expect(typeof toolPayload.percent).toBe('number');

      // SSE 面：工具注解随 token 帧流出
      const streamed = frames.filter(f => f.type === 'token').map(f => String(f.text ?? '')).join('');
      expect(streamed).toContain('[工具调用: ');
    } finally {
      await fake.close();
    }
  }, 30_000);

  it('B 降级路径：非规范上游缺 id → 确定性兜底且配对仍合法；未知工具失败不阻断对话', async () => {
    // B-turn1：模型给的 id 为空串（非规范上游）→ 必须确定性兜底（禁随机 UUID），配对仍合法
    const fakeMissingId = await startScenarioUpstream([
      { content: 'B1 首轮', toolCalls: [{ name: REAL_TOOL, arguments: '{}', id: '' }] },
      { content: 'B1 续轮' },
    ]);
    let synthesizedA = '';
    try {
      const turn = await postEntryTurn('D819 B1：缺 id 降级');
      expect(turn.status).toBe(200);
      expectSseConverged(turn.text);
      recordScenario('B1', '降级：上游 tool_call 缺 id', fakeMissingId, turn.text);

      expect(fakeMissingId.requests.length).toBe(2);
      const msgs = messagesOf(fakeMissingId.requests[1]);
      const assistant = msgs.find(m => stringField(m, 'role') === 'assistant');
      const toolMsg = msgs.find(m => stringField(m, 'role') === 'tool');
      expect(assistant).toBeDefined();
      expect(toolMsg).toBeDefined();
      if (assistant === undefined || toolMsg === undefined) throw new Error('缺 id 场景缺 assistant/tool 消息');
      const ids = toolCallIdsOf(assistant);
      expect(ids.length).toBe(1);
      synthesizedA = ids[0];
      expect(synthesizedA.length).toBeGreaterThan(0);
      expect(synthesizedA).toMatch(/^call_resp_\d+$/); // 确定性兜底形态（base.ts provider 边界）
      expect(synthesizedA).not.toMatch(UUID_RE);
      expect(stringField(toolMsg, 'tool_call_id')).toBe(synthesizedA);
      expect(pairingOk(msgs)).toBe(true);
    } finally {
      await fakeMissingId.close();
    }

    // B-turn1 复跑：同一脚本 → 同一兜底 id（确定性，不是随机）
    const fakeMissingIdRepeat = await startScenarioUpstream([
      { content: 'B1 首轮', toolCalls: [{ name: REAL_TOOL, arguments: '{}', id: '' }] },
      { content: 'B1 续轮' },
    ]);
    try {
      const turn = await postEntryTurn('D819 B1：缺 id 降级（复跑）');
      expectSseConverged(turn.text);
      const repeatIds = toolCallIdsOf(
        messagesOf(fakeMissingIdRepeat.requests[1]).find(m => stringField(m, 'role') === 'assistant') ?? {},
      );
      expect(repeatIds[0]).toBe(synthesizedA);
    } finally {
      await fakeMissingIdRepeat.close();
    }

    // B-turn2：未知工具 → 工具执行失败仍必须配对，且失败显式传播（不静默）
    const fakeUnknownTool = await startScenarioUpstream([
      { content: 'B2 首轮', toolCalls: [{ name: UNKNOWN_TOOL, arguments: '{}', id: 'call_d819_unknown_1' }] },
      { content: 'B2 续轮' },
    ]);
    try {
      const turn = await postEntryTurn('D819 B2：未知工具降级');
      expect(turn.status).toBe(200);
      expectSseConverged(turn.text);
      recordScenario('B2', '降级：未知工具执行失败', fakeUnknownTool, turn.text);

      expect(fakeUnknownTool.requests.length).toBe(2);
      const msgs = messagesOf(fakeUnknownTool.requests[1]);
      const assistant = msgs.find(m => stringField(m, 'role') === 'assistant');
      const toolMsg = msgs.find(m => stringField(m, 'role') === 'tool');
      expect(assistant).toBeDefined();
      expect(toolMsg).toBeDefined();
      if (assistant === undefined || toolMsg === undefined) throw new Error('未知工具场景缺 assistant/tool 消息');
      expect(toolCallIdsOf(assistant)).toEqual(['call_d819_unknown_1']);
      expect(stringField(toolMsg, 'tool_call_id')).toBe('call_d819_unknown_1');
      const content = stringField(toolMsg, 'content') ?? '';
      expect(content).toContain('未知工具');
      expect(pairingOk(msgs)).toBe(true);
    } finally {
      await fakeUnknownTool.close();
    }
  }, 40_000);

  it('C1 边界：content 为空 + tool_calls 非空 → 不抛 EMPTY_RESPONSE，配对不丢', async () => {
    const fake = await startScenarioUpstream([
      { content: '', toolCalls: [{ name: REAL_TOOL, arguments: '{}', id: 'call_d819_empty_content_1' }] },
      { content: 'C1 续轮' },
    ]);
    try {
      const turn = await postEntryTurn('D819 C1：空 content + tool_calls');
      expect(turn.status).toBe(200);
      const frames = expectSseConverged(turn.text);
      recordScenario('C1', '边界：空 content + tool_calls', fake, turn.text);

      // 未被 EMPTY_RESPONSE 打断 → 仍有第 2 个请求
      expect(fake.requests.length).toBe(2);
      const msgs = messagesOf(fake.requests[1]);
      expect(rolesOf(fake.requests[1])).toEqual(['system', 'user', 'assistant', 'tool']);
      const assistant = msgs.find(m => stringField(m, 'role') === 'assistant');
      expect(assistant).toBeDefined();
      if (assistant === undefined) throw new Error('空 content 场景缺 assistant 消息');
      expect(stringField(assistant, 'content')).toBe('');
      expect(toolCallIdsOf(assistant)).toEqual(['call_d819_empty_content_1']);
      const toolMsg = msgs.find(m => stringField(m, 'role') === 'tool');
      expect(stringField(toolMsg ?? {}, 'tool_call_id')).toBe('call_d819_empty_content_1');
      expect(pairingOk(msgs)).toBe(true);
      expect(frames.filter(f => f.type === 'error')).toEqual([]);
    } finally {
      await fake.close();
    }
  }, 30_000);

  it('C2 边界：MAX_ROUNDS 用尽 → 收尾轮不带 tools，3 轮 tool_calls 各自配对且角色序精确', async () => {
    const fake = await startScenarioUpstream([
      { content: 'C2 r0', toolCalls: [{ name: REAL_TOOL, arguments: '{}', id: 'call_d819_r0' }] },
      { content: 'C2 r1', toolCalls: [{ name: UNKNOWN_TOOL, arguments: '{}', id: 'call_d819_r1' }] },
      // r2 与 r0 同工具但不同参数：避开 D473 ToolGuard「同工具+同参数」提醒路径
      // （该路径会为同一次调用多推一条 reminder tool 消息 —— 既有设计，非 D819 修复面）
      { content: 'C2 r2', toolCalls: [{ name: REAL_TOOL, arguments: '{"probe":"r2"}', id: 'call_d819_r2' }] },
      { content: 'C2 收尾' },
    ]);
    try {
      const turn = await postEntryTurn('D819 C2：MAX_ROUNDS 边界');
      expect(turn.status).toBe(200);
      expectSseConverged(turn.text);
      recordScenario('C2', '边界：MAX_ROUNDS 用尽', fake, turn.text);

      // 3 轮工具调用 + 1 次无 tools 收尾
      expect(fake.requests.length).toBe(4);
      const finalReq = fake.requests[3];
      expect(finalReq.bodyKeys).not.toContain('tools');
      expect(rolesOf(finalReq)).toEqual([
        'system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool',
      ]);
      const sequenced = [
        [],
        ['call_d819_r0'],
        ['call_d819_r0', 'call_d819_r1'],
        ['call_d819_r0', 'call_d819_r1', 'call_d819_r2'],
      ];
      // 逐请求校验：assistant.tool_calls[].id 与 tool.tool_call_id 按序一一对应
      for (let i = 0; i < fake.requests.length; i += 1) {
        const msgs = messagesOf(fake.requests[i]);
        const callIds = msgs
          .filter(m => stringField(m, 'role') === 'assistant')
          .flatMap(m => toolCallIdsOf(m));
        const toolIds = msgs
          .filter(m => stringField(m, 'role') === 'tool')
          .map(m => stringField(m, 'tool_call_id') ?? '(missing)');
        expect(toolIds).toEqual(callIds);
        expect(pairingOk(msgs)).toBe(true);
        if (sequenced[i].length > 0) expect(callIds).toEqual(sequenced[i]);
      }
      // 收尾回复来自末轮脚本（流式 token 拼接）
      const frames = parseSseFrames(turn.text);
      const streamed = frames.filter(f => f.type === 'token').map(f => String(f.text ?? '')).join('');
      expect(streamed).toContain('C2 收尾');
    } finally {
      await fake.close();
    }
  }, 40_000);

  it('证据文件机器生成（体例自证）：文件存在、scenario 数 == 已记录场景数、每场景工具数与复算真值同源', () => {
    // 显式落盘一次（afterAll 亦会做最终 flush）——让断言针对「真的被写出来的文件」，而不是内存对象
    writeEvidence(expectedToolCount, ENTRY_UPSTREAM_SEAM);
    const parsed: unknown = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf-8'));
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) throw new Error('证据文件不是 JSON 对象');

    // 顶层与断言同源（D819 修正 task-4 L1：每场景字段也曾恒为 0，与顶层自相矛盾）
    expect(parsed.registered_tool_count).toBe(expectedToolCount);
    expect(typeof parsed.registered_tool_count).toBe('number');

    const scenarios = recordArray(parsed.scenarios);
    // scenario 数 == 本用例内已记录的场景数（用例数与记录数一致，防漏写/少写）
    expect(scenarios.length).toBe(evidenceScenarios.length);
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    expect(scenarios.map(s => stringField(s, 'id'))).toEqual(['A', 'B1', 'B2', 'C1', 'C2']);
    for (const s of scenarios) {
      // 每场景必须写真实复算值（不是初始化的 0），与顶层同源
      expect(s.registered_tool_count).toBe(expectedToolCount);
    }
    // #1257 P0-2a：配对回归 —— 证据里每个请求的 assistant.tool_calls[].id 与 tool.tool_call_id
    // 必须逐位相等且 pairing_ok（写 tool_call/tool_result 事件后，出站结构不得退化）
    let requestsChecked = 0;
    for (const record of evidenceScenarios) {
      expect(record.requests.length).toBeGreaterThan(0);
      for (const request of record.requests) {
        expect(request.pairing_ok).toBe(true);
        expect(request.tool_message_ids).toEqual(request.assistant_tool_call_ids);
        requestsChecked += 1;
      }
    }
    expect(requestsChecked).toBeGreaterThanOrEqual(5); // 防"零请求也绿"（至少 A/B1/B2/C1×2/C2×4）
    expect(expectedToolCount).toBeGreaterThan(0);
    // 上游缝确实指向 127.0.0.1 假上游（配置缝生效，非真实 provider）
    expect(entryBaseUrl.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
