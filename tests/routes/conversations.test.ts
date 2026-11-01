/**
 * tests/routes/conversations.test.ts — D590 对话 SSE 端点集成测试
 *
 * Spec: SYNOVA-IMPL-DSH-D590-chat-sse-endpoint-20260908.md §7（12 用例表）+ 2 个增量用例
 *   ① 正常轮次（open/token/agent_message/end + store 落库）
 *   ② 多轮恢复（loadState→fromState 生效，fake provider 历史含首轮）
 *   ③ 白名单 P0-1（DEV_MODE=false 无 Authorization → 对话 200 / consult 非 401 / sessions 非 401；对照探针 401）
 *   ④ 会话读回（GET /api/sessions/:id 全轮次，读路径零改动回归锁定）
 *   ⑤ 断线不丢（abort 后 settle 落库完整回复，已见 token ⊆ 落库 content——中断锚语义）
 *   ⑥ 重建不变量（SSE 交付 ≡ 事件流投影 ≡ fromState 重建——log-reconstruction desync 断言）
 *   ⑦ 忙锁（同会话并发第二请求 409 SESSION_BUSY，完成后可再发）
 *   ⑧ 边界（空/超长 message 400、未知 sessionId 404，流前 JSON 非 SSE）
 *   ⑨ 降级 fail-closed（orchestration 缺失 → 503 STORE_UNAVAILABLE + degraded:true）
 *   ⑩ 410 下线（upload-v2 四路径 GONE + consult 活路由零误伤）
 *   ⑪ phaseComplete 桥（访谈完成轮 → flat 诊断事件 + complete 帧，fake 引擎真跑）
 *   ⑫ sse-contract 对话帧归约（在 use-streaming-contract.test.ts）
 *   ⑬ LLM 未配置 → 400 LLM_NOT_CONFIGURED（增量）
 *   ⑭ store 双写降级传播（appendEvent 失败 → 流内 error 帧 degraded:true，流不中断——增量）
 *
 * 铁律 12: 集成测试走真实路由（express + listen(0) + fetch + 真实 better-sqlite3 ':memory:'），
 *          不 mock 管线——vi.mock 仅三处（providers / config / 诊断引擎工厂，spec §7 模式）。
 * red→green: 实现前本文件先存在且失败（模块不存在 + uploadV2GoneRouter 未导出）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { Socket } from 'net';
import type Database from 'better-sqlite3';
import { SessionStore } from '../../src/store/session-store';

// ═══ hoisted mock 状态（vi.mock 工厂提升后仍可读写）═══
const mocks = vi.hoisted(() => ({
  /** 每次 fake provider.chat 收到的 messages 快照（重建不变量/多轮恢复断言用） */
  chatCalls: [] as Array<Array<{ role: string; content: string }>>,
  /** fake provider 返回的回复文本（按用例改写） */
  replyText: { value: '收到。请告诉我你们的团队规模，以及当前最影响增长的一个瓶颈是什么？' },
  /** 忙锁用例闸门：非 null 时 chat 挂起直到 resolve（可控"在途轮次"） */
  gate: { promise: null as Promise<void> | null },
  /** LLM 未配置注入：true 时 loadConfig 抛错 */
  configFail: { value: false },
}));

// ── mock ① providers：fake 流式 provider（形态对齐 tests/conversation-engine.test.ts）──
// importOriginal spread：server.ts import 链上 llm-config.ts 模块级消费 listProviderTypes()，
// 全量替换会炸模块装载——只覆写 createProvider，其余导出保真
vi.mock('../../src/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers')>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake-d590-provider',
      baseUrl: 'fake://d590-test',
      async chat(messages: Array<{ role: string; content: unknown }>, _opts?: unknown) {
        mocks.chatCalls.push(messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })));
        if (mocks.gate.promise) await mocks.gate.promise;
        return { content: mocks.replyText.value, model: 'fake' };
      },
      async healthCheck() { return { healthy: true, latencyMs: 1 }; },
      listModels() { return ['fake']; },
    }),
  };
});
vi.mock('../../src/providers/detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/detect')>();
  return {
    ...actual,
    detectProvider: () => 'deepseek',
  };
});

// ── mock ② config：定值 + dbPath 指向内存库（initEngineContext 经此建库，供 sessionsRoutes 读回）──
// 同理 spread actual：server.ts import 链上其他模块可能消费 config 的非 loadConfig 导出
vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config')>();
  return {
    ...actual,
    loadConfig: () => {
      if (mocks.configFail.value) throw new Error('LLM API key 未配置');
      return {
        llmApiKey: 'test-key',
        llmBaseUrl: 'http://localhost:1',
        llmModel: 'test-model',
        dbPath: process.env.SYNOVA_DB_PATH || ':memory:',
        devMode: false,
        // #1228 S0-2b：config 契约必含 orgId（生产 = `src/config.ts:110` 的实例组织）。
        // 原 mock 漏此字段 ⇒ 路由取实例组织时读到 undefined；补成契约形态（不是放宽判据）。
        orgId: 'default',
      };
    },
  };
});

// ── mock ③ 诊断引擎工厂：确定性发射 阶段→发现 事件后返回报告（phaseComplete 桥用例）──
vi.mock('../../src/l3/synova-diagnosis-engine-impl', () => ({
  createSynovaDiagnosisEngine: () => ({
    async runConsultation(
      teamId: string,
      _initiator: unknown,
      _scope: unknown,
      onEvent?: (event: { type: string; phase: number; label?: string; message?: string; confidence?: number }) => void,
    ) {
      onEvent?.({ type: 'phase_started', phase: 1, label: '数据采集', confidence: 0.9 });
      onEvent?.({ type: 'interim_finding', phase: 2, message: '客户集中度过高', confidence: 0.7 });
      return { teamId, report: { reportId: 'rpt_d590_test', summary: 'D590 测试诊断报告' }, totalDurationMs: 7, degradedModules: [] };
    },
  }),
}));

// ═══ SSE helpers ═══

interface SseFrame { event: string; data: Record<string, unknown>; }

/** 解析 `event: X\ndata: {json}` 帧序列（本路由帧自描述对象载荷） */
function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter(block => block.includes('data: '))
    .map(block => {
      const lines = block.split('\n');
      const event = (lines.find(l => l.startsWith('event: ')) ?? '').replace('event: ', '').trim();
      const dataLine = lines.find(l => l.startsWith('data: ')) ?? '';
      return { event, data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown> };
    });
}

async function postConversation(baseUrl: string, body: object): Promise<Response> {
  return fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postToSession(baseUrl: string, sessionId: string, body: object): Promise<Response> {
  return fetch(`${baseUrl}/api/conversations/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** 从 open 帧提取 sessionId（未拿到 = 测试自身缺陷，直接 fail） */
function requireSessionId(frames: SseFrame[]): string {
  const open = frames.find(f => f.data.type === 'open');
  const sessionId = open !== undefined && typeof open.data.sessionId === 'string' ? open.data.sessionId : undefined;
  if (sessionId === undefined) {
    throw new Error(`open 帧缺失或无 sessionId: frames0=${JSON.stringify(frames[0])}`);
  }
  return sessionId;
}

// ═══ Test apps ═══

describe('D590: 对话 SSE 端点 + SessionStore 持久化 + 鉴权落地', () => {
  let server: Server;
  let serverNoAuth: Server;
  let serverNoDb: Server;
  let server410: Server;
  let baseUrl = '';
  let noAuthUrl = '';
  let noDbUrl = '';
  let goneUrl = '';
  let db: Database.Database;
  let sockets: Socket[] = [];

  /** 收集底层连接，afterAll 统一 destroy（abort 用例的半开连接防悬挂） */
  function trackConnections(srv: Server): void {
    srv.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('close', () => { sockets = sockets.filter(s => s !== socket); });
    });
  }

  beforeAll(async () => {
    // 生产态鉴权语义（用例 ③）：DEV_MODE 必须为 false（vitest env 默认 true 会让 JWT 中间件 auto-admin，
    // 白名单用例就空转了）+ 无 JWT_SECRET
    process.env.DEV_MODE = 'false';
    delete process.env.JWT_SECRET;

    // engine-context 建库（config mock dbPath=':memory:'）——sessionsRoutes 的 getDatabase() 与
    // conversations 的 orchestration.db 共用同一实例（读回一致性）
    const { initEngineContext } = await import('../../src/init/engine-context');
    initEngineContext();
    const { getDatabase } = await import('../../src/init/engine-context');
    db = getDatabase();

    const conversationsRouter = (await import('../../src/routes/conversations')).default;
    const sessionsRoutes = (await import('../../src/routes/sessions')).default;
    const diagnosisRoutes = (await import('../../src/routes/diagnosis')).default;
    const { jwtAuthMiddleware } = await import('../../src/middleware/auth');
    const { uploadV2GoneRouter } = await import('../../src/server');

    // app1: 主 app——orchestration.db 在场（持久化目标库）+ sessions 读回路由
    const app = express();
    app.use(express.json());
    app.locals.orchestration = { db };
    app.use(conversationsRouter);
    app.use(sessionsRoutes);
    server = app.listen(0);
    trackConnections(server);
    baseUrl = await waitListening(server);

    // app2: 鉴权 app——真实 jwtAuthMiddleware + 白名单断言（对照组探针 401）
    const appNoAuth = express();
    appNoAuth.use(express.json());
    appNoAuth.locals.orchestration = { db };
    appNoAuth.use(jwtAuthMiddleware);
    appNoAuth.use(conversationsRouter);
    appNoAuth.use(diagnosisRoutes);
    appNoAuth.use(sessionsRoutes);
    appNoAuth.get('/api/d590-probe', (_req, res) => res.json({ ok: true })); // 非白名单对照探针
    serverNoAuth = appNoAuth.listen(0);
    trackConnections(serverNoAuth);
    noAuthUrl = await waitListening(serverNoAuth);

    // app3: 无 orchestration——fail-closed 503 用例
    const appNoDb = express();
    appNoDb.use(express.json());
    appNoDb.use(conversationsRouter);
    serverNoDb = appNoDb.listen(0);
    trackConnections(serverNoDb);
    noDbUrl = await waitListening(serverNoDb);

    // app4: 410 拦截 + consult 活路由（零误伤回归）
    const app410 = express();
    app410.use(express.json());
    app410.locals.orchestration = { db };
    app410.use(uploadV2GoneRouter);
    app410.use(diagnosisRoutes);
    server410 = app410.listen(0);
    trackConnections(server410);
    goneUrl = await waitListening(server410);
  });

  afterAll(async () => {
    // 先销毁 keep-alive 连接再 close（undici fetch 持有长连接，先 close 会等满超时）
    for (const socket of sockets) socket.destroy();
    await Promise.all([server, serverNoAuth, serverNoDb, server410].map(srv =>
      new Promise<void>(resolve => srv.close(() => resolve())),
    ));
    // 恢复 vitest 全局 env（不泄漏到其他测试文件）
    process.env.DEV_MODE = 'true';
  });

  beforeEach(() => {
    mocks.chatCalls.length = 0;
    mocks.gate.promise = null;
    mocks.configFail.value = false;
    mocks.replyText.value = '收到。请告诉我你们的团队规模，以及当前最影响增长的一个瓶颈是什么？';
  });

  // ── 用例 ①: 正常轮次 ──
  it('① 正常轮次：POST /api/conversations → open(sessionId)/token×N/agent_message/end + store 落 user+assistant', async () => {
    const res = await postConversation(baseUrl, { message: '我们是一家 30 人的 SaaS 公司' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = parseSse(await res.text());
    const types = frames.map(f => f.data.type);
    expect(types[0]).toBe('open');
    const open = frames[0].data as { sessionId?: string; phase?: number };
    expect(open.sessionId).toMatch(/^sess_/);
    expect(open.phase).toBe(0);
    expect(types).toContain('token');
    expect(types).toContain('agent_message');
    expect(types[types.length - 1]).toBe('end');

    // token 串 ≡ agent_message 全文（帧协议自洽）
    const tokens = frames.filter(f => f.data.type === 'token')
      .map(f => (f.data as { text: string }).text).join('');
    const agentMessage = frames.find(f => f.data.type === 'agent_message')?.data as { content: string };
    expect(tokens).toBe(agentMessage.content);
    expect(tokens).toBe(mocks.replyText.value);

    // store 落库（user 前置 + assistant 全文，事件流投影）
    const store = new SessionStore(db);
    const msgs = store.getMessages(open.sessionId as string);
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0]?.content).toBe('我们是一家 30 人的 SaaS 公司');
    expect(msgs[1]?.content).toBe(agentMessage.content);
  });

  // ── 用例 ②: 多轮恢复 ──
  it('② 多轮恢复：同 sessionId 第二条消息 → provider 收到首轮 user/assistant 历史（loadState→fromState 生效）', async () => {
    const r1 = await postConversation(baseUrl, { message: '第一轮：我们做企业服务，成立三年' });
    const frames1 = parseSse(await r1.text());
    const sessionId = requireSessionId(frames1);
    const reply1 = frames1.find(f => f.data.type === 'agent_message')?.data as { content: string };

    const callsBefore = mocks.chatCalls.length;
    const r2 = await postToSession(baseUrl, sessionId, { message: '第二轮：团队 50 人，分产品/销售/研发' });
    expect(r2.status).toBe(200);
    const frames2 = parseSse(await r2.text());
    // :id 路由 sessionId 回声一致
    expect(requireSessionId(frames2)).toBe(sessionId);

    // fake provider 第二轮收到的历史含第一轮 user/assistant（引擎状态真恢复了，不是每次全新会话）
    const secondCall = mocks.chatCalls[callsBefore];
    expect(secondCall).toBeDefined();
    expect(secondCall.some(m => m.role === 'user' && m.content.startsWith('第一轮：我们做企业服务'))).toBe(true);
    expect(secondCall.some(m => m.role === 'assistant' && m.content === reply1.content)).toBe(true);
  });

  // ── 用例 ③: 白名单（P0-1 闭环）──
  it('③ 白名单：DEV_MODE=false 无 Authorization → 对话端点流式 200；consult 非 401；sessions 非 401；对照探针 401', async () => {
    const res = await fetch(`${noAuthUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '白名单直连：无凭证应可达' }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());
    expect(frames[0]?.data.type).toBe('open');
    const sessionId = requireSessionId(frames);

    // consult 非空 401（spec：400/200 均 Pass，禁 401——配置 mock 下应 200）
    const consult = await fetch(`${noAuthUrl}/api/diagnosis/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'org-d590-wl', initiator: { role: 'GA', name: '测试GA' } }),
    });
    expect(consult.status).not.toBe(401);
    await consult.text(); // drain SSE

    // sessions 读非 401
    const sess = await fetch(`${noAuthUrl}/api/sessions/${sessionId}`);
    expect(sess.status).not.toBe(401);

    // 对照组：非白名单端点仍被 JWT 中间件拦截（证明中间件真实在岗，而非全关）
    const probe = await fetch(`${noAuthUrl}/api/d590-probe`);
    expect(probe.status).toBe(401);
  });

  // ── 用例 ④: 会话读回（读路径零改动，回归锁定）──
  it('④ 会话读回：GET /api/sessions/:id 返回全轮次 user+assistant', async () => {
    const res = await postConversation(baseUrl, { message: '读回测试：组织名叫 Example' });
    const sessionId = requireSessionId(parseSse(await res.text()));

    const read = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    expect(read.status).toBe(200);
    const body = await read.json() as { ok: boolean; session: { id: string }; messages: Array<{ role: string; content: string }> };
    expect(body.ok).toBe(true);
    expect(body.session.id).toBe(sessionId);
    expect(body.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(body.messages[0]?.content).toBe('读回测试：组织名叫 Example');
  });

  // ── 用例 ⑤: 断线不丢（中断锚语义）──
  it('⑤ 断线：中途 abort fetch → settle 后 store 含完整回复；已见 token 串 ⊆ 落库 assistant content', async () => {
    mocks.replyText.value = '断线锚语义验证。'.repeat(40); // ~400 字符 × 5ms/char ≈ 2s 流，留出 abort 窗口
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '断线测试：请长篇回答' }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let seen = '';
    // chunk 可能在任意字节处切开——循环读到 token 帧出现（open 帧必然已在 seen 中完整落地）
    for (; ;) {
      const { done, value } = await reader!.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      if (seen.includes('"type":"token"')) { controller.abort(); break; }
    }
    expect(seen).toContain('"type":"open"');

    // 提取 abort 前已完整收到的 token 文本（半截帧由正则自然截住，仍是 content 前缀）
    const seenTokens = [...seen.matchAll(/"type":"token","text":"([^"]*)"/g)].map(m => m[1]).join('');
    expect(seenTokens.length).toBeGreaterThan(0);

    const sessionId = (seen.match(/"sessionId":"(sess_[a-z0-9_]+)"/) ?? [])[1];
    expect(sessionId).toBeDefined();

    // settle 轮询：断线后路由仍执行 ③④⑤（完整回复落库）
    const store = new SessionStore(db);
    let msgs: Array<{ role: string; content: string }> = [];
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      msgs = store.getMessages(sessionId as string);
      if (msgs.some(m => m.role === 'assistant')) break;
    }
    const assistant = msgs.find(m => m.role === 'assistant');
    expect(assistant).toBeDefined();
    // 中断锚：已见前缀 ⊆ 落库内容（重连不丢已见内容）
    expect((assistant as { content: string }).content.startsWith(seenTokens)).toBe(true);
  });

  // ── 用例 ⑥: 重建不变量（log-reconstruction desync 断言）──
  it('⑥ 重建不变量：两轮后 SSE 交付 ≡ 事件流投影 ≡ fromState 重建', async () => {
    const m1 = '不变量第一轮：收入结构是项目制';
    const m2 = '不变量第二轮：毛利率大约 40%';
    const r1 = await postConversation(baseUrl, { message: m1 });
    const frames1 = parseSse(await r1.text());
    const sessionId = requireSessionId(frames1);
    const a1 = (frames1.find(f => f.data.type === 'agent_message')?.data as { content: string }).content;
    const r2 = await postToSession(baseUrl, sessionId, { message: m2 });
    const frames2 = parseSse(await r2.text());
    const a2 = (frames2.find(f => f.data.type === 'agent_message')?.data as { content: string }).content;

    // 不变量 1：SSE 交付的 token 串 ≡ agent_message 全文（每轮）
    for (const [frames, reply] of [[frames1, a1], [frames2, a2]] as const) {
      const tokens = frames.filter(f => f.data.type === 'token')
        .map(f => (f.data as { text: string }).text).join('');
      expect(tokens).toBe(reply);
    }

    // 不变量 2：事件流投影 ≡ 交付序列（user 原文 + assistant 全文，严格交替）
    const store = new SessionStore(db);
    const projected = store.getMessages(sessionId).map(m => ({ role: m.role, content: m.content }));
    expect(projected).toEqual([
      { role: 'user', content: m1 },
      { role: 'assistant', content: a1 },
      { role: 'user', content: m2 },
      { role: 'assistant', content: a2 },
    ]);

    // 不变量 3：loadState→fromState 快照往返保真（log-reconstruction desync 断言——
    // dsh-agent-loop invariant 范式：重建结果必须严格等于持久日志快照）。
    // 注：引擎消息里 assistant 会出现连续重复（L2 既有行为：tool-loop 与引擎各 push 一次，
    // CLI 同样存在；store 交付面不受影响——本用例断言 1/2 已锁「SSE ≡ 事件流投影」），
    // 故这里断言「重建 ≡ 快照」而非「重建 ≡ 去重后的交付序列」。
    const state = store.loadState(sessionId);
    expect(state).toBeTruthy();
    const { ConversationEngine } = await import('../../src/agent/conversation-engine');
    const fakeProvider = {
      name: 'fake-rebuild', baseUrl: 'fake://rebuild',
      async chat() { return { content: '', model: 'fake' }; },
      async healthCheck() { return { healthy: true, latencyMs: 1 }; },
      listModels() { return ['fake']; },
    };
    const rebuilt = ConversationEngine.fromState(fakeProvider as Parameters<typeof ConversationEngine.fromState>[0], state as NonNullable<typeof state>, { sessionId });
    expect(rebuilt.getPhase()).toBe((state as { phase: number }).phase);
    // 重建消息 ≡ 快照消息（逐条深比，含顺序）
    const rebuiltMsgs = rebuilt.getMessages().map(m => ({ role: m.role, content: m.content }));
    const stateMsgs = (state as { messages: Array<{ role: string; content: string }> }).messages
      .map(m => ({ role: m.role, content: m.content }));
    expect(rebuiltMsgs).toEqual(stateMsgs);
    // 重建含两轮交付全文（内容不丢失）
    const rebuiltJoined = rebuiltMsgs.map(m => m.content).join('\n');
    expect(rebuiltJoined).toContain(a1);
    expect(rebuiltJoined).toContain(a2);
    expect(rebuiltJoined).toContain(m1);
    expect(rebuiltJoined).toContain(m2);
  });

  // ── 用例 ⑦: 忙锁 ──
  it('⑦ 忙锁：同 sessionId 并发第二请求 → 409 SESSION_BUSY；首请求完成后可再发', async () => {
    let resolveGate!: () => void;
    mocks.gate.promise = new Promise<void>(resolve => { resolveGate = resolve; });

    const first = await postConversation(baseUrl, { message: '忙锁第一请求' });
    expect(first.status).toBe(200);
    const reader = first.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let openText = '';
    // chunk 可能在任意字节处切开——读到 open 帧数据完整出现为止
    for (let i = 0; i < 100; i++) {
      const { done, value } = await reader!.read();
      if (done) break;
      openText += decoder.decode(value, { stream: true });
      if (openText.includes('"type":"open"')) break;
    }
    const sessionId = (openText.match(/"sessionId":"(sess_[a-z0-9_]+)"/) ?? [])[1];
    expect(sessionId).toBeDefined(); // open 帧已发 = 锁已持有

    // 同会话第二请求 → 409 流前 JSON
    const second = await postToSession(baseUrl, sessionId as string, { message: '忙锁第二请求' });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe('SESSION_BUSY');

    // 放行首请求 → 流完整结束（end 帧）→ 锁释放
    resolveGate();
    let tail = openText;
    for (;;) {
      const { done, value: chunk } = await reader!.read();
      if (done) break;
      tail += decoder.decode(chunk, { stream: true });
    }
    expect(parseSse(tail).at(-1)?.data.type).toBe('end');

    // 完成后同会话可再发（锁已释放）
    const third = await postToSession(baseUrl, sessionId as string, { message: '忙锁解除后的请求' });
    expect(third.status).toBe(200);
    expect(parseSse(await third.text()).at(-1)?.data.type).toBe('end');
  });

  // ── 用例 ⑧: 边界 ──
  it('⑧ 边界：空 message/超长 message → 400；未知 sessionId → 404（均流前 JSON 非 SSE）', async () => {
    const empty = await postConversation(baseUrl, { message: '' });
    expect(empty.status).toBe(400);
    expect(empty.headers.get('content-type')).toContain('application/json');
    expect(((await empty.json()) as { code: string }).code).toBe('VALIDATION_ERROR');

    const tooLong = await postConversation(baseUrl, { message: 'x'.repeat(8001) });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { code: string }).code).toBe('VALIDATION_ERROR');

    const nonString = await postConversation(baseUrl, { message: 42 });
    expect(nonString.status).toBe(400);

    const unknown = await postToSession(baseUrl, 'sess_never_created_d590', { message: '你好' });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('NOT_FOUND');

    // body.sessionId 指向不存在会话同样 404（不静默新建续写）
    const unknownBody = await postConversation(baseUrl, { message: '你好', sessionId: 'sess_never_created_d590' });
    expect(unknownBody.status).toBe(404);
  });

  // ── 用例 ⑨: 降级 fail-closed ──
  it('⑨ 降级：orchestration 缺失 → 503 STORE_UNAVAILABLE + degraded:true（fail-closed 不静默不落库）', async () => {
    const res = await postConversation(noDbUrl, { message: '你好' });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as { code: string; degraded: boolean };
    expect(body.code).toBe('STORE_UNAVAILABLE');
    expect(body.degraded).toBe(true);
  });

  // ── 用例 ⑩: 410 下线（裁决 ②）──
  it('⑩ 410 下线：upload-v2 四路径 → 410 GONE；consult 活路由零误伤', async () => {
    const upload = await fetch(`${goneUrl}/api/diagnosis/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }),
    });
    expect(upload.status).toBe(410);
    const uploadBody = await upload.json() as { ok: boolean; code: string };
    expect(uploadBody.ok).toBe(false);
    expect(uploadBody.code).toBe('GONE');

    for (const [method, path] of [['GET', '/api/diagnosis/status/job-1'], ['GET', '/api/diagnosis/report/job-1'], ['POST', '/api/diagnosis/interview']] as const) {
      const res = await fetch(`${goneUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(res.status).toBe(410);
    }

    // consult 活路由零误伤（mock 引擎 200 SSE）
    const consult = await fetch(`${goneUrl}/api/diagnosis/consult`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'org-d590-gone', initiator: { role: 'GA', name: '测试GA' } }),
    });
    expect(consult.status).toBe(200);
    expect(consult.status).not.toBe(410);
    await consult.text();
  });

  // ── 用例 ⑪: phaseComplete 桥 ──
  it('⑪ phaseComplete 桥：访谈完成轮 → 流内 flat 诊断事件 + complete 帧 + end（诊断事件落同一会话事件流）', async () => {
    const r1 = await postConversation(baseUrl, { message: '我们是 50 人的制造企业' });
    const sessionId = requireSessionId(parseSse(await r1.text()));
    await (await postToSession(baseUrl, sessionId, { message: '团队分生产/销售/研发三块' })).text();

    // 第三轮命中完成信号（detectPhaseComplete：'没有了'）且 turnCount>=minTurns(3) → phaseComplete
    const r3 = await postToSession(baseUrl, sessionId, { message: '没有了，开始诊断' });
    expect(r3.status).toBe(200);
    const frames = parseSse(await r3.text());
    const types = frames.map(f => f.data.type);

    // 访谈完成的回复照常流式（引擎固定文案）
    expect(types).toContain('agent_message');
    // fake 诊断引擎事件 flat 透传（引擎原始字段在载荷顶层，桌面 sse-contract 零改动可解）
    expect(types).toContain('phase_started');
    expect(types).toContain('interim_finding');
    const finding = frames.find(f => f.data.type === 'interim_finding')?.data as { message?: string };
    expect(finding.message).toBe('客户集中度过高');
    // complete 帧（sseClose 形状 + sessionId 回声）
    const complete = frames.find(f => f.data.type === 'complete')?.data as { report?: { reportId?: string }; sessionId?: string };
    expect(complete.report?.reportId).toBe('rpt_d590_test');
    expect(complete.sessionId).toBe(sessionId);
    expect(types[types.length - 1]).toBe('end');

    // 诊断事件落同一会话事件流（launcher sessionStore 接线）
    const store = new SessionStore(db);
    const eventTypes = store.getEvents(sessionId).map(e => e.eventType);
    expect(eventTypes).toContain('diagnosis_phase');
    expect(eventTypes).toContain('diagnosis_report');
  });

  // ── 用例 ⑬（增量）: LLM 未配置 ──
  it('⑬ LLM 未配置：loadConfig 抛错 → 400 LLM_NOT_CONFIGURED 指路 D575 向导（流前 JSON，不建孤儿会话）', async () => {
    mocks.configFail.value = true;
    const sessionsBefore = (db.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get() as { n: number }).n;
    const res = await postConversation(baseUrl, { message: '你好' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as { code: string; message: string };
    expect(body.code).toBe('LLM_NOT_CONFIGURED');
    // 不留孤儿会话（配置校验先于 createSession）
    const sessionsAfter = (db.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get() as { n: number }).n;
    expect(sessionsAfter).toBe(sessionsBefore);
  });

  // ── 用例 ⑭（增量）: store 双写降级传播 ──
  it('⑭ 双写降级：appendEvent 失败 → 流内 error 帧 STORE_DEGRADED + degraded:true，流不中断到 end', async () => {
    // 注入 appendEvent 失败（trigger RAISE ABORT——比 DROP 表更精准，SessionStore 构造器 IF NOT EXISTS 会自愈 DROP）
    db.exec("CREATE TRIGGER d590_fail_event_insert BEFORE INSERT ON session_events BEGIN SELECT RAISE(ABORT, 'd590-injected-degradation'); END");
    try {
      const res = await postConversation(baseUrl, { message: '降级传播测试' });
      expect(res.status).toBe(200);
      const frames = parseSse(await res.text());
      const types = frames.map(f => f.data.type);
      const degradedErr = frames.find(f => f.data.type === 'error')?.data as { code?: string; degraded?: boolean };
      expect(degradedErr.code).toBe('STORE_DEGRADED');
      expect(degradedErr.degraded).toBe(true);
      // 降级诚实但不崩流：agent_message 照常交付，终帧 end
      expect(types).toContain('agent_message');
      expect(types[types.length - 1]).toBe('end');
    } finally {
      db.exec('DROP TRIGGER d590_fail_event_insert');
    }
  });
});

/** 等待 server 就绪并返回 baseUrl（沿 diagnosis-consult-events.test.ts 先例） */
function waitListening(srv: Server): Promise<string> {
  return new Promise(resolve => {
    const t = setInterval(() => {
      const addr = srv.address();
      if (addr && typeof addr !== 'string') {
        clearInterval(t);
        resolve(`http://localhost:${addr.port}`);
      }
    }, 10);
  });
}
