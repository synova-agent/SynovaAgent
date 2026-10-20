/**
 * routes/conversations.ts — D590 对话 SSE 端点（ConversationEngine × HTTP 首次接线）
 *
 * POST /api/conversations              body {message, sessionId?, orgId?} → 单飞入口（sessionId 缺省即新建会话）
 * POST /api/conversations/:id/messages body {message}                     → 定向续轮（:id 不存在 → 404）
 * POST /api/conversations              body {message:'/ingest <资料>'}     → #656 M2 资料入口（JSON 回执，零 LLM）
 *
 * 持久化时序（cli.ts:228-244 权威模板 + 用户消息前置）:
 *   ① addMessage(user) → ② processMessageStream → ③ addMessage(assistant)
 *   → ④ updateSession(phase) → ⑤ saveState(serialize) → 下轮 loadState→fromState 恢复
 *
 * 契约（铁律 47）:
 *   @input    — message: string(1..8000) 必填；sessionId/orgId: string 可选；
 *               store 经 req.app.locals.orchestration.db 获取（D563 动态 import 范式：
 *               值与类型均来自动态 import 通道的推断 + isSqliteDatabase 谓词窄化，
 *               L1 零静态 L5 import——diagnosis.ts:182 同款）；
 *               `/ingest` 分支另读 `req.app.locals.graphStore`（Bootstrap 注入，缺席 ⇒ 503）
 *   @output   — SSE 流 open(sessionId 回声) → token×N → agent_message →
 *               [诊断事件 flat 透传 → complete] → end；心跳 ": ping" 15s；
 *               流前 JSON 错误：400/404/409/503
 *               ＋ `/ingest` 分支一律 JSON（非 SSE）：200 成功 / 400 INGEST_EMPTY /
 *               200 INGEST_FAILED / 503 STORE_UNAVAILABLE
 *   @degraded — db 缺失/非 SQLite → 503 {code:'STORE_UNAVAILABLE', degraded:true}
 *               （fail-closed：会话持久化是本端点的存在理由，静默不落库 = 假绿）；
 *               store 双写失败（lastDegraded）→ 流内 error 帧 {code:'STORE_DEGRADED', degraded:true}
 *               且流不中断（铁律 24/31）；客户端断开 → 停写停心跳，在途轮次自然 settle 后仍
 *               完整落库 ③④⑤（DSH 中断锚语义：已见前缀 ⊆ 落库内容）；同会话并发 → 409 SESSION_BUSY；
 *               `/ingest`：图存储缺失 → 503（fail-closed）；摄取失败 → 200
 *               {code:'INGEST_FAILED', degraded:true}（不阻断对话，铁律 11/31）
 *   @authority — `/ingest` 分支仅 **conversation 链**（`POST /api/conversations` 与
 *               `POST /api/conversations/:id/messages`）可触发；普通消息 SSE 语义不变，
 *               本分支**不新增公开 HTTP 字段**（接口变更须 CTO）
 *   @not-here  — 不做文件上传入口（PDF/DOCX/XLSX 仍走既有 TUI `/upload` → `ingestFile`）；
 *               不建第二套 store；`/ingest` 不调 LLM；不改 `GET /chat` 页面结构
 *
 * 已知限制（Known Limitations —— 做不到什么，不得改写成"已核过"）:
 *   a. 前缀**不做词边界**：`/ingested ...` 亦命中（资料文本 = 'ed'）；收紧属接口语义变更，
 *      须 CTO（本批按裁 225 方案 A 只承诺前缀语义）。
 *   b. 摄取失败返回 **200 + degraded:true**（不阻断对话）；客户端**必须**读 `degraded`/`code`，
 *      不得只看 HTTP 状态码。
 *   c. 图存储缺失 ⇒ **503 fail-closed**（不假装落库 = 假绿）。
 *   d. 本批只做 **dev/source 形态**；文件类资料入口（PDF/DOCX/XLSX）不在本批。
 *   e. **不新增 anchor 回执字段**：锚点只能从 `GET /api/ontology/graph/:orgId` 的
 *      `Document.props.name` 读回（防客户端依赖未批准的公开字段）。
 *
 * 决策记录（D333，完成报告 §5.4 可核）: phaseComplete 诊断桥走 L1→L2 公开 API
 * DiagnosisLauncher 直连（diagnosis.ts:200-217 同款装配），而非 conv.startDiagnosis——
 * fromState 恢复的引擎内部 diagnosisEngine 恒为 createNoopEngine（fromState wiring 无该
 * 槽位，L2 零修改红线下不可补），launcher 直连是恢复会话真跑诊断的唯一合法路径；
 * 可观测契约不变（同会话事件流 + SSE flat 透传 + complete 帧）。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { loadConfig } from '../config';
import { createProvider } from '../providers';
import { detectProvider } from '../providers/detect';
import {
  ConversationEngine,
  setDecisionRecordingSeam,
  INGEST_COMMAND_PREFIX,
  ingestConversationExcerpt,
  parseIngestMessage,
  type EngineState,
} from '../agent/conversation-engine';
import { DiagnosisLauncher, type SessionStoreLike } from '../agent/diagnosis-launcher';
import type { EngineContext } from '../agent/engine-context';
import type { DiagnosisEngine } from '../l2-interfaces/diagnosis-engine';
import { SessionManager } from '../orchestrator/session-manager';
import { registerBuiltinTools } from '../agent/builtin-tools';
import { ToolRegistry } from '../agent/tools';
import { WebViewAdapter } from '../l1-interaction/web-adapter';
import type { DecisionCapturePort } from '../deploy/bootstrap';
// #656 M2: 图存储类型只走 L2 出口（L1 零 l4/ import；ontology.ts:12 同款，铁律 39）
import type { SqliteGraphStore } from '../agent/graph-store-service';

const log = createLogger('routes/conversations');
const router = Router();

/**
 * K12-08(#191) V1/V6 — 决策台账装配口（**回调工厂**；装配层注入，本路由只消费）。
 *
 * 为什么走模块级注入位：本路由的引擎是**会话级**构造的（`sessionEngines` 缓存 / `fromState`
 * 恢复），无法在引擎构造器的 EngineConfig 里一次性传入。与 L1→L2 既有注入式缝同款
 * （`routes/overflow.ts:24 setOverflowGraphStore` / `routes/import.ts:19 setGraphBridge`）。
 *
 * 不变量：这里**只持回调**，不持 L4 图存储实例（EC-03 的 L2 侧约束在 L1 消费面同样遵守）。
 * 未注入 ⇒ 引擎回落既有 `recordDecision` 显式失败（`callback not configured`），不静默。
 */
let decisionCapturePort: DecisionCapturePort | null = null;

/** 装配层（server.ts）下放决策台账装配口 —— 幂等，缺省不注入。 */
export function setDecisionCapturePort(port: DecisionCapturePort): void {
  decisionCapturePort = port;
  log.info('K12-08 决策台账装配口已注入（onDecision 回调可用）');
}

/** 读取当前装配口（测试/自检面：证"装配层真注入了"而不是"字段存在"） */
export function getDecisionCapturePort(): DecisionCapturePort | null {
  return decisionCapturePort;
}

/**
 * 把装配口接进引擎的 `onDecision` 接缝（`conversation-engine.ts:98`）。
 * @input  engine — 会话级 ConversationEngine 实例（新建或 fromState 恢复的均适用）
 *         orgId  — 图名（组织/租户）；缺省 'default'
 * @output 无（装配口缺席 ⇒ 不调用，引擎保持既有显式失败语义）
 */
function wireDecisionCapture(engine: ConversationEngine, orgId: string): void {
  if (!decisionCapturePort) return;
  engine.setDecisionCapture(decisionCapturePort(orgId));
  // K12-08 C3（工单关闭的人工裁决）：同一接缝注册为**进程级**，供**无会话**的生产路径复用。
  // 为什么不另建引擎：见 `conversation-engine.ts` `setDecisionRecordingSeam` 的 JSDoc
  // （L1 路由里重装 provider 会在请求路径引入无关构造风险）。此处注册的是**同一实例**，
  // 故无会话路径写台账与有会话路径写台账走的是**同一个 onDecision**（单一接缝，不分裂）。
  setDecisionRecordingSeam(engine);
}

/** message 输入上界（spec §5.2-A；借鉴 dsh-api-gateway 输入边界校验范式） */
const MESSAGE_MAX = 8000;

/** 模块级 per-session 忙锁——防双引擎同会话交错写 state_json（409 SESSION_BUSY） */
const busySessions = new Set<string>();

/**
 * 会话级引擎缓存——进程内同一会话复用同一引擎实例（模型上下文 + turnCount 跨请求连续），
 * 缓存未命中（进程重启/逐出）才走 loadState→fromState 恢复。
 *
 * 决策记录（D333，完成报告可核）: spec §5.2-A"每请求实例"与 §7 用例⑪ 物理矛盾——
 * EngineState 不含 turnCount，per-request 实例的 turnCount 恒为 1，minTurns=3 永不可达，
 * phaseComplete 在 HTTP 面永不触发；且实测 fromState 存在 L2 侧缺陷（构造器把 this.messages
 * 引用注入 ToolLoopExecutor，fromState 以赋值替换数组致恢复会话模型上下文丢失）。会话级复用
 * 是两条语义的唯一可达路径；"无共享态"取其"无跨请求竞态"意图——同会话并发已由忙锁单飞防。
 * 缓存有界（插入序 FIFO 逐出，对齐 diagnosis.ts report 缓存范式）。
 */
const sessionEngines = new Map<string, ConversationEngine>();
const SESSION_ENGINE_CACHE_MAX = 200;

type ConversationBody = {
  message?: unknown;
  sessionId?: unknown;
  orgId?: unknown;
};

/** 引擎快照最小形状守卫——loadState 的 JSON.parse 结果不盲信（铁律 38：类型守卫替代断言） */
function isEngineStateLike(v: unknown): v is EngineState {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { orgId?: unknown }).orgId === 'string' &&
    typeof (v as { phase?: unknown }).phase === 'number' &&
    typeof (v as { startedAt?: unknown }).startedAt === 'string' &&
    Array.isArray((v as { messages?: unknown }).messages)
  );
}

/**
 * 从 req.app.locals.orchestration.db 解析会话存储（D563 既有范式：diagnosis.ts:175-194）。
 * @returns SessionStore 实例；db 缺失/谓词窄化失败/构造抛错 → null（调用方 503 fail-closed）
 */
// 返回类型由动态 import 推断（完整 SessionStore 类），零静态 L5 类型引用
async function resolveStore(req: Request) {
  const orchestrationDb = (req.app.locals.orchestration as { db?: unknown } | undefined)?.db;
  if (!orchestrationDb) {
    log.warn('orchestration.db 缺失 — STORE_UNAVAILABLE（fail-closed：对话轨拒绝无持久化服务）');
    return null;
  }
  try {
    const { SessionStore: SessionStoreImpl, isSqliteDatabase } = await import('../store/session-store');
    if (!isSqliteDatabase(orchestrationDb)) {
      log.warn('orchestration.db 非 SQLite 句柄（D563 谓词窄化失败）— STORE_UNAVAILABLE');
      return null;
    }
    return new SessionStoreImpl(orchestrationDb);
  } catch (err: unknown) {
    log.warn({ err }, 'SessionStore 装配失败 — STORE_UNAVAILABLE（fail-closed）');
    return null;
  }
}

/** 组装诊断引擎（diagnosis.ts:138-170 同款：L1 经 DiagnosisEngine 接口调用 L3 引擎工厂） */
async function buildDiagnosisEngine(): Promise<DiagnosisEngine> {
  const config = loadConfig();
  const provider = createProvider(detectProvider(), {
    apiKey: config.llmApiKey,
    baseUrl: config.llmBaseUrl,
    gatewayHost: config.gatewayHost,
    model: config.llmModel,
  });
  const toolRegistry = new ToolRegistry();
  const { createSynovaDiagnosisEngine } = await import('../l3/synova-diagnosis-engine-impl');
  const newEngine = createSynovaDiagnosisEngine(
    {
      async chat(messages, opts) {
        const result = await provider.chat(
          messages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
          opts as Record<string, unknown> | undefined,
        );
        return {
          content: result.content || '',
          toolCalls: result.toolCalls?.map(tc => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          })),
        };
      },
    },
    {
      async execute(name, args) { const r = await toolRegistry.execute(name, args); return { result: r }; },
      listTools() { return toolRegistry.listTools().map(t => ({ name: t.name, description: t.description, parameters: (t.parameters || {}) as Record<string, unknown> })); },
    },
    {
      maxToolRounds: config.diagnosis?.maxToolRounds ?? 4,
      gateDataCompleteness: config.diagnosis?.gateDataCompleteness ?? 0.3,
      gateMinHypothesisConfidence: config.diagnosis?.gateMinHypothesisConfidence ?? 0.5,
      graphStore: undefined,
    },
  );
  const engine: DiagnosisEngine = {
    async runConsultation(teamId, initiator, onEvent) {
      return newEngine.runConsultation(teamId, initiator, undefined, onEvent as Parameters<typeof newEngine.runConsultation>[3]);
    },
  };
  return engine;
}

/** 两条路由共用的对话 handler（spec §5.2-A：单 handler，入口差异仅在 sessionId 来源） */
async function handleConversationMessage(req: Request, res: Response, pathSessionId?: string): Promise<void> {
  // ① 输入边界（流前 JSON，违规不进 SSE）
  const body = (req.body ?? {}) as ConversationBody;
  const message = body.message;
  if (typeof message !== 'string' || message.length < 1 || message.length > MESSAGE_MAX) {
    res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: `message 必填且为 1..${MESSAGE_MAX} 字符` });
    return;
  }
  const bodySessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : undefined;
  const sessionIdInput = pathSessionId ?? bodySessionId;
  const orgId = (typeof body.orgId === 'string' && body.orgId) || process.env.SYNOVA_ORG_ID || 'default';

  // ①-b `/ingest` 资料入口分支（#656 M2 判据①；**零 LLM 依赖**：先于 ②store 与 ④loadConfig）。
  //      回执一律 JSON（非 SSE）；普通消息不进本分支 ⇒ 既有 SSE 语义零改动。
  //      位置依据：批规格 §2「输入校验后、store/LLM 配置之前」；失败只降级不阻断对话主链。
  if (message.startsWith(INGEST_COMMAND_PREFIX)) {
    // 输入边界：`/ingest` 后无资料 ⇒ 400（不落库、不调 LLM、不建会话）
    const parsedIngest = parseIngestMessage(message);
    if (parsedIngest.text.length === 0) {
      log.warn({ code: 'INGEST_EMPTY', orgId }, '/ingest 缺少资料文本 — 400（未落库）');
      res.status(400).json({
        ok: false,
        code: 'INGEST_EMPTY',
        ingested: false,
        degraded: false,
        message: '/ingest 后缺少资料文本',
      });
      return;
    }
    // 图存储 fail-closed（无持久化 ⇒ 拒绝，禁假装落库 = 假绿）。
    // 注入：`app.locals.graphStore ← server.ts:398` Bootstrap Phase 1c；L1 类型只走 L2 出口
    // （ontology.ts:12 同款，零 l4/ import）。注入实例 createNode/createEdge 与本接缝逐字兼容
    // ⇒ **直接传、零断言**（断言集中在 L2 `ingestConversationExcerpt` 内，见其调用点注释）。
    const graphStore = (req.app.locals as { graphStore?: SqliteGraphStore }).graphStore;
    if (!graphStore) {
      log.warn({ code: 'STORE_UNAVAILABLE', orgId }, '/ingest 图存储不可用 — 503（fail-closed）');
      res.status(503).json({
        ok: false,
        code: 'STORE_UNAVAILABLE',
        degraded: true,
        message: '图存储不可用——/ingest 拒绝无持久化服务（fail-closed）',
      });
      return;
    }
    // 摄取（唯一调用点：conversation 链 → ingestConversationExcerpt → ingestDocumentText）
    const outcome = await ingestConversationExcerpt(message, orgId, graphStore, 'route');
    if (outcome.ingested) {
      res.status(200).json({
        ok: true,
        ingested: true,
        nodesCreated: outcome.nodesCreated,
        edgesCreated: outcome.edgesCreated,
        degraded: false,
      });
      return;
    }
    // 摄取失败：显式降级回执（200 + degraded:true，不阻断对话；**禁**把失败当成功）
    if (outcome.code !== 'INGEST_FAILED') {
      log.warn(
        { code: outcome.code ?? 'INGEST_UNEXPECTED', orgId },
        '/ingest 分支收到非预期 outcome — 仍按 INGEST_FAILED 回执（fail loud）',
      );
    }
    res.status(200).json({
      ok: false,
      code: 'INGEST_FAILED',
      ingested: false,
      degraded: true,
      nodesCreated: outcome.nodesCreated,
      edgesCreated: outcome.edgesCreated,
      message: '资料摄取失败（已记日志，不阻断对话）',
    });
    return;
  }

  // ② Store fail-closed（对话轨的存在理由就是落库——静默降级 = 假绿，spec §5.2-A）
  const store = await resolveStore(req);
  if (!store) {
    res.status(503).json({
      ok: false,
      code: 'STORE_UNAVAILABLE',
      degraded: true,
      message: '会话存储不可用——对话端点拒绝无持久化服务（fail-closed）',
    });
    return;
  }

  // ③ sessionId 存在性校验（未知会话 404，不静默新建续写）
  if (sessionIdInput && !store.getSession(sessionIdInput)) {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `会话不存在: ${sessionIdInput}` });
    return;
  }

  // ④ LLM 配置（diagnosis.ts:127-133 同款；D575 热生效语义自动继承；未配置 400 指路向导，
  //    先于 createSession——不留孤儿会话）
  let provider: ReturnType<typeof createProvider>;
  try {
    const config = loadConfig();
    provider = createProvider(detectProvider(), {
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      gatewayHost: config.gatewayHost,
      model: config.llmModel,
    });
  } catch (err: unknown) {
    log.warn({ err }, 'LLM 配置缺失 — 400 LLM_NOT_CONFIGURED（D575 向导未完成）');
    res.status(400).json({ ok: false, code: 'LLM_NOT_CONFIGURED', message: '请先完成 LLM 配置（D575 向导）' });
    return;
  }

  // ⑤ 会话定位 + 忙锁（spec §5.2-D：防双引擎同会话交错写 state_json）
  const sessionId = sessionIdInput ?? store.createSession(orgId).id;
  if (busySessions.has(sessionId)) {
    res.status(409).json({ ok: false, code: 'SESSION_BUSY', message: '该会话正在处理上一条消息——请等待完成后再发' });
    return;
  }
  busySessions.add(sessionId);

  // ⑥ SSE 流建立（此后错误一律走流内 error 帧，不再改状态码）
  const adapter = new WebViewAdapter(res);
  let disconnected = false;
  adapter.setOnClosed(() => {
    if (disconnected) return;
    disconnected = true;
    log.warn({ sessionId }, '客户端断开 — 在途轮次自然 settle，回复仍完整落库（中断锚语义）');
  });

  try {
    // ⑦ 引擎装配（会话级缓存命中直接复用；未命中走 loadState→fromState 官方 API 恢复——
    //    禁 im-inbound 的 as never 形态）
    let conv = sessionEngines.get(sessionId);
    if (!conv) {
      const savedState: unknown = sessionIdInput ? store.loadState(sessionId) : null;
      const restored = isEngineStateLike(savedState) ? savedState : null;
      if (savedState !== null && restored === null) {
        log.warn({ sessionId }, '会话快照形状非法 — 忽略快照按新会话继续（不静默，铁律 24）');
      }
      const sessionManager = new SessionManager({}, store);
      conv = restored
        ? ConversationEngine.fromState(provider, restored, { sessionManager, sessionStore: store, sessionId })
        : new ConversationEngine(provider, { sessionId, orgId, sessionManager, sessionStore: store });
      // K12-08(#191) V1/V6: 决策台账接缝装配（新建与 fromState 恢复两条路都要接 ——
      // 缓存未命中才会走到这里，故每个进程内每个会话恰好接一次）。
      wireDecisionCapture(conv, orgId);
      if (sessionEngines.size >= SESSION_ENGINE_CACHE_MAX) {
        const oldest = sessionEngines.keys().next().value;
        if (oldest !== undefined) sessionEngines.delete(oldest);
      }
      sessionEngines.set(sessionId, conv);
    }
    // 能力对齐 CLI（cli.ts:134 先例）
    registerBuiltinTools(conv.getToolRegistry(), store, sessionId, () => conv.getPhase(), () => conv.getOrgId());
    conv.setViewAdapter(adapter);

    // open 帧（sessionId 回声 = 提交回声语义，客户端据此对账）
    adapter.sendFrame({ type: 'open', sessionId, phase: conv.getPhase() });

    // ⑧ 持久化时序 ①：用户消息引擎处理前落库（崩溃安全；双写自动进事件流）
    store.addMessage(sessionId, 'user', message);

    // ⑨ 引擎流式轮次（onToken → adapter token 帧；断线后 adapter 自动停写，轮次自然 settle）
    const result = await conv.processMessageStream(message, (token) => adapter.appendToken(token));

    // ⑩ 持久化时序 ③④⑤（断线也执行——完整回复落库，重连不丢）
    store.addMessage(sessionId, 'assistant', result.reply);
    store.updateSession(sessionId, { phase: conv.getPhase() });
    store.saveState(sessionId, conv.serialize());

    // 铁律 31：双写降级显式传播（流内 error 帧，不静默、不中断服务）
    if (store.lastDegraded) {
      log.error({ sessionId }, 'store 双写降级（lastDegraded）— 流内 error 帧 STORE_DEGRADED');
      adapter.sendFrame({ type: 'error', code: 'STORE_DEGRADED', message: '会话落库降级——本轮回复可能未完整持久化', degraded: true });
    }

    // agent_message 全文回声（非流式消费者兜底）。phaseComplete 轮由引擎经
    // viewAdapter.showAgentMessage 已发（conversation-engine.ts:734），路由不重发
    if (!result.phaseComplete) {
      adapter.sendFrame({ type: 'agent_message', content: result.reply });
    }

    // ⑪ phaseComplete → 诊断桥（spec §5.4 决策 6：不桥接 = 引擎回复文案假绿 M2 模式）。
    //    断线后不再启动诊断（客户端已离场，避免孤儿 LLM 消耗；已落库内容不丢）。
    if (result.phaseComplete && !disconnected) {
      const diagnosisEngine = await buildDiagnosisEngine();
      const engineCtx: EngineContext = {
        provider,
        messages: [],
        orgId,
        sessionId,
        toolRegistry: new ToolRegistry(),
        hookRunner: null,
        eventBus: null,
        evidenceCollector: null,
        corroborationEngine: null,
        graphBridge: null,
        graphStore: null,
        flags: { enableCommunityReports: false, enableEntityResolution: false },
        loggerPrefix: 'routes/conversations',
        diagnosisEngine,
      };
      // 诊断事件落同一会话事件流（launcher 经 ctx.sessionStore appendEvent，D487 机制）
      (engineCtx as { sessionStore?: SessionStoreLike }).sessionStore = store;
      const launcher = new DiagnosisLauncher(engineCtx, diagnosisEngine);
      const diagnosisResult = await launcher.startDiagnosis(orgId, 'GA', (evt) => adapter.emitDiagnosisEvent(evt));
      // D593: 对话桥报告落盘（写路径第二路线，spec §5.1/§5.2-A）——与 consult 路线同形
      // （checkpoint 表 phase=5 行，键=reportId），source='conversation'（无 consultId——
      // 对话会话无该概念）。写失败 log.warn 不阻断 SSE（报告已随 complete 帧送达，铁律 24/31）。
      if (diagnosisResult) {
        // 内联类型窄化读 reportId（铁律 38 替代形态——双段断言禁用）
        const reportIdCandidate: unknown = (diagnosisResult.report as { reportId?: unknown }).reportId;
        const conversationReportId = typeof reportIdCandidate === 'string' ? reportIdCandidate : '';
        if (conversationReportId === '') {
          log.warn({ sessionId }, '对话桥报告 reportId 缺失 — 跳过落盘（degraded，complete 帧不受影响）');
        } else {
          try {
            const completedAtIso = new Date().toISOString();
            store.saveDiagnosisCheckpoint({
              sessionId: conversationReportId,
              phase: 5,
              completedModules: [],
              partialReport: {
                reportId: conversationReportId,
                report: diagnosisResult.report,
                teamId: diagnosisResult.teamId,
                completedAt: completedAtIso,
                source: 'conversation',
              },
              savedAt: completedAtIso,
            });
          } catch (persistErr: unknown) {
            log.warn({ err: persistErr, sessionId, reportId: conversationReportId }, '对话桥报告落盘失败 — degraded（complete 帧已送达）');
          }
        }
      }
      // complete 帧（对齐 diagnosis.ts:82-91 sseClose 形状 + sessionId 回声）
      adapter.sendFrame({
        type: 'complete',
        sessionId,
        teamId: diagnosisResult?.teamId ?? orgId,
        totalDurationMs: diagnosisResult?.totalDurationMs ?? 0,
        degradedModules: diagnosisResult?.degradedModules ?? [],
        report: diagnosisResult?.report ?? null,
      });
    } else if (result.phaseComplete && disconnected) {
      log.warn({ sessionId }, '访谈完成但客户端已断开 — 跳过诊断启动（回复已落库）');
    }

    // ⑫ 终帧 + 关流（心跳随 close 清除）
    adapter.sendFrame({ type: 'end' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, sessionId, disconnected }, '对话轮次失败 — 流内 error 帧');
    if (!disconnected) {
      adapter.sendFrame({ type: 'error', code: 'CONVERSATION_ERROR', message: msg, degraded: true });
      adapter.sendFrame({ type: 'end' });
    }
  } finally {
    adapter.close();
    busySessions.delete(sessionId);
  }
}

// POST /api/conversations — 单飞入口（sessionId 缺省即新建）
router.post('/api/conversations', (req: Request, res: Response) => {
  void handleConversationMessage(req, res);
});

// POST /api/conversations/:id/messages — 定向续轮
router.post('/api/conversations/:id/messages', (req: Request, res: Response) => {
  void handleConversationMessage(req, res, req.params.id as string);
});

export default router;
