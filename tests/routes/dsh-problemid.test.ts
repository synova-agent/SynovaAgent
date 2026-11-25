/**
 * tests/routes/dsh-problemid.test.ts — #1486 裁定 e：`POST /api/dsh/runs` 的显式 `problemId` 入参位。
 *
 * 判据（Issue #1486「四条裁定 e」＋验收 e）：
 *   [正常]   body 带 `problemId` ⇒ ① 一次性 token 上下文收到它（工具侧数据面可证）；
 *            ② `run.started` 事件带它（事件可证）；③ `synova_context_get` 收到的就是它（不靠模型猜）
 *   [反例]   发给模型的 prompt 文本里 **grep 不到** 该 problemId（禁把 problemId 拼进自然语言 prompt）
 *   [优先]   `ctx.problemId` 优先于工具入参 `problemId`（确定性）；ctx 缺省时回退入参（既有形态不变）
 *   [失败]   `problemId` 空串/非字符串 ⇒ 400 `VALIDATION_ERROR`，且不签 token、不发起 run
 *   [边界]   problemId 指向不存在的对象 ⇒ 工具侧 `DOMAIN_EMPTY`（typed；路由层不冒充校验通过）
 *
 * 依赖注入 fake ACP（不 spawn 真实 dsh、不外发）＋ fake 回环 MCP（捕获 token 上下文，不监听端口）。
 * 库口径：`:memory:`（vitest env；beforeAll fail-fast）。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import type { JwtPayload } from '../../src/middleware/auth';
import { createDshRouter } from '../../src/routes/dsh';
import { getDatabase, initEngineContext } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { DshError } from '../../src/runtime/dsh/errors';
import { handleDomainToolCall, ToolTokenStore } from '../../src/runtime/dsh/tools';
import type { ContextSnapshot, ToolCallContext } from '../../src/runtime/dsh/tools';
import type { AcpClientLike, AcpSessionUpdate, RunRecord } from '../../src/runtime/dsh/session';
import { DshRunManager } from '../../src/runtime/dsh/session';

// ═══ 测试构造的输入（期望值的唯一来源）═══
const ENTERPRISE = 'ent-1486-e';
const PROBLEM = 'team-1486-e';
const NEIGHBOR = 'batch-1486-e-1';
const OTHER_PROBLEM = 'batch-1486-e-other';
const INPUT_TEXT = '请基于领域上下文给出瓶颈假设';

class FakeAcp implements AcpClientLike {
  readonly promptTexts: string[] = [];
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private counter = 0;

  async initialize() {
    return { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } };
  }
  async newSession() {
    this.counter += 1;
    return { sessionId: `sess-1486-${this.counter}`, configOptions: [] };
  }
  async resumeSession(params: { sessionId: string }) {
    return { sessionId: params.sessionId, configOptions: [] };
  }
  async closeSession() { /* fake：无底层连接 */ }
  async prompt(params: { sessionId: string; text: string }) {
    this.promptTexts.push(params.text);
    this.emit(params.sessionId);
    return { stopReason: 'end_turn' };
  }
  cancel() { /* fake：无进行中的轮次 */ }
  onSessionUpdate(handler: (update: AcpSessionUpdate) => void) {
    this.handler = handler;
    return () => { this.handler = null; };
  }
  dispose() { /* fake */ }

  private emit(sessionId: string) {
    this.handler?.({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } } });
  }
}

/** 捕获路由签发的一次性 token 上下文（不暴露 token 值本身）。 */
class CapturingTokenStore extends ToolTokenStore {
  readonly issued: ToolCallContext[] = [];
  issue(context: ToolCallContext): string {
    this.issued.push(context);
    return super.issue(context);
  }
}

let server: Server;
let baseUrl: string;
let runtime: DshRunManager;
let fake: FakeAcp;
let tokenStore: CapturingTokenStore;

const AUTH = { 'x-test-user': 'user-1486-e', 'x-test-org': ENTERPRISE, 'content-type': 'application/json' };

async function postRun(body: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/dsh/runs`, { method: 'POST', headers: AUTH, body: JSON.stringify(body) });
  const payload = (await response.json()) as Record<string, unknown>;
  return { status: response.status, payload };
}

async function waitTerminal(record: RunRecord): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (record.stream.terminal !== null) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('run 未在预期时间内进入终态');
}

beforeAll(async () => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`dsh-problemid.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const store = new SqliteGraphStore(getDatabase());
  const root = store.createNode(
    'resource/delivery_team',
    { businessKey: PROBLEM, name: '问题根', period: '2026-10', defVersion: 'delivery-v1' },
    ENTERPRISE,
  );
  const neighbor = store.createNode(
    'activity/delivery_batch',
    { businessKey: NEIGHBOR, name: '邻接批次', period: '2026-10', defVersion: 'delivery-v1' },
    ENTERPRISE,
  );
  store.createEdge('edge/team_executes_activity', root, neighbor, 1, {}, ENTERPRISE);

  fake = new FakeAcp();
  runtime = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs: 5_000 });
  tokenStore = new CapturingTokenStore();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header('x-test-user');
    const org = req.header('x-test-org');
    if (typeof user === 'string' && typeof org === 'string') {
      (req as Request & { auth?: JwtPayload }).auth = { sub: user, orgId: org, role: 'admin', jti: '1486-e' };
    }
    next();
  });
  app.use(createDshRouter({
    runtime,
    heartbeatMs: 200,
    mcpStarter: async () => ({ url: 'http://127.0.0.1:1/mcp', tokens: tokenStore, close: async () => { /* fake */ } }),
  }));
  server = createServer(app);
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await runtime.dispose();
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
});

describe('#1486 e · POST /api/dsh/runs 显式 problemId 入参位', () => {
  it('[正常] 带 problemId ⇒ token 上下文 + run.started 事件可证；prompt 文本不含它', async () => {
    const before = tokenStore.issued.length;
    const { status, payload } = await postRun({ input: INPUT_TEXT, problemId: PROBLEM, runId: 'run_1486_e_ok' });
    expect(status).toBe(202);
    expect(payload.ok).toBe(true);

    const record = runtime.getRun('run_1486_e_ok');
    expect(record).toBeDefined();
    if (record === undefined) throw new Error('run 记录缺失');
    await waitTerminal(record);

    // ① token 上下文收到显式 problemId（工具侧数据面可证）
    expect(tokenStore.issued.length).toBe(before + 1);
    const ctx = tokenStore.issued[tokenStore.issued.length - 1];
    expect(ctx.problemId).toBe(PROBLEM);

    // ② 事件可证
    const started = record.stream.snapshot()[0];
    expect(started.type).toBe('run.started');
    expect(started.data.problemId).toBe(PROBLEM);

    // ③ 反例：prompt 文本 = input 逐字，**不含** problemId（禁拼进自然语言）
    expect(fake.promptTexts).toHaveLength(1);
    expect(fake.promptTexts[0]).toBe(INPUT_TEXT);
    expect(fake.promptTexts[0].includes(PROBLEM)).toBe(false);

    // ④ synova_context_get 收到的就是它（工具入参为空也能解析到同一根）
    const snapshot = JSON.parse(handleDomainToolCall('synova_context_get', {}, ctx)) as ContextSnapshot;
    expect(snapshot.problemId).toBe(PROBLEM);
    expect(snapshot.count).toBe(1);
    expect(snapshot.items[0].$id).not.toBe('');
  });

  it('[优先] ctx.problemId 优先于工具入参；ctx 缺省时回退入参（既有形态不变）', () => {
    const withCtx: ToolCallContext = {
      enterpriseId: ENTERPRISE, userId: 'user-1486-e', scope: 'admin', runId: 'run_1486_e_prio', problemId: PROBLEM,
    };
    const fromCtx = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: OTHER_PROBLEM }, withCtx)) as ContextSnapshot;
    expect(fromCtx.problemId).toBe(PROBLEM);

    const withoutCtx: ToolCallContext = {
      enterpriseId: ENTERPRISE, userId: 'user-1486-e', scope: 'admin', runId: 'run_1486_e_fallback',
    };
    const fromArgs = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: PROBLEM }, withoutCtx)) as ContextSnapshot;
    expect(fromArgs.problemId).toBe(PROBLEM);
    expect(fromArgs.count).toBe(1);
  });

  it('[失败] problemId 空串/非字符串 ⇒ 400 VALIDATION_ERROR，且不签 token、不发起 run', async () => {
    const tokensBefore = tokenStore.issued.length;
    const runsBefore = runtime.listRuns().length;

    for (const problemId of ['', 123, null]) {
      const { status, payload } = await postRun({ input: INPUT_TEXT, problemId, runId: 'run_1486_e_bad' });
      expect(status).toBe(400);
      expect(payload.code).toBe('VALIDATION_ERROR');
      expect(payload.phase).toBe('request');
    }
    expect(tokenStore.issued.length).toBe(tokensBefore);
    expect(runtime.listRuns().length).toBe(runsBefore);
  });

  it('[边界] problemId 指向不存在的对象 ⇒ 工具侧 DOMAIN_EMPTY（路由不冒充校验通过）', async () => {
    const { status } = await postRun({ input: INPUT_TEXT, problemId: 'team-does-not-exist', runId: 'run_1486_e_missing' });
    expect(status).toBe(202);
    const ctx = tokenStore.issued[tokenStore.issued.length - 1];
    expect(ctx.problemId).toBe('team-does-not-exist');

    let caught: unknown;
    try {
      handleDomainToolCall('synova_context_get', {}, ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DshError);
    expect((caught as DshError).code).toBe('DOMAIN_EMPTY');
  });

  it('[兼容] 不带 problemId ⇒ token 上下文无该键（既有调用形态不回归）', async () => {
    const before = tokenStore.issued.length;
    const { status } = await postRun({ input: INPUT_TEXT, runId: 'run_1486_e_none' });
    expect(status).toBe(202);
    expect(tokenStore.issued.length).toBe(before + 1);
    expect('problemId' in tokenStore.issued[tokenStore.issued.length - 1]).toBe(false);
  });
});
