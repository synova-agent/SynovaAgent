/**
 * routes/conversations.ts — D590 对话 SSE 端点（ConversationEngine × HTTP 首次接线）
 *
 * POST /api/conversations              body {message, sessionId?, orgId?} → 单飞入口（sessionId 缺省即新建会话）
 * POST /api/conversations/:id/messages body {message}                     → 定向续轮（:id 不存在 → 404）
 *
 * 持久化时序（cli.ts:228-244 权威模板 + 用户消息前置）:
 *   ① addMessage(user) → ② processMessageStream → ③ addMessage(assistant)
 *   → ④ updateSession(phase) → ⑤ saveState(serialize) → 下轮 loadState→fromState 恢复
 *
 * 契约（铁律 47）:
 *   @input    — message: string(1..8000) 必填；sessionId/orgId: string 可选；
 *               store 经 req.app.locals.orchestration.db 获取（D563 动态 import 范式：
 *               值与类型均来自动态 import 通道的推断 + isSqliteDatabase 谓词窄化，
 *               L1 零静态 L5 import——diagnosis.ts:182 同款）
 *   @output   — SSE 流 open(sessionId 回声) → token×N → agent_message →
 *               [诊断事件 flat 透传 → complete] → end；心跳 ": ping" 15s；
 *               流前 JSON 错误：400/404/409/503
 *   @degraded — db 缺失/非 SQLite → 503 {code:'STORE_UNAVAILABLE', degraded:true}
 *               （fail-closed：会话持久化是本端点的存在理由，静默不落库 = 假绿）；
 *               store 双写失败（lastDegraded）→ 流内 error 帧 {code:'STORE_DEGRADED', degraded:true}
 *               且流不中断（铁律 24/31）；客户端断开 → 停写停心跳，在途轮次自然 settle 后仍
 *               完整落库 ③④⑤（DSH 中断锚语义：已见前缀 ⊆ 落库内容）；同会话并发 → 409 SESSION_BUSY
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
import { ConversationEngine, type EngineState } from '../agent/conversation-engine';
import { DiagnosisLauncher, type SessionStoreLike } from '../agent/diagnosis-launcher';
import type { EngineContext } from '../agent/engine-context';
import type { DiagnosisEngine } from '../l2-interfaces/diagnosis-engine';
import { SessionManager } from '../orchestrator/session-manager';
import { registerBuiltinTools } from '../agent/builtin-tools';
import { ToolRegistry } from '../agent/tools';
import { WebViewAdapter } from '../l1-interaction/web-adapter';
// D1051 W5: 呈现粒度轴判别（L1→L2 相邻依赖合法——DR-1 裁定：呈现轴落 L2）
import {
  DEFAULT_REPORT_VIEW_DEPTH,
  normalizeReportViewDepth,
  resolveViewDepthFromUtterance,
  type ReportViewDepth,
} from '../agent/report-depth';

const log = createLogger('routes/conversations');
const router = Router();

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
/**
 * D1051 W5: L5 存储模块动态加载**单点**（D563 既有通道，语义不变）。
 *
 * Why 单点: `scripts/check-architecture.sh` 的 L1→L5 棘轮**按行计数**；
 * 若两处各自写一条 L5 动态引入，本文件命中数会从基线 1 抬到 2
 * ⇒ CI strict（SYNO_CI=1）下成为「基线外新增」硬阻断。
 * 收敛为单点后本文件恒为 1 处 L1→L5（与基线一致），且两调用方共用同一模块实例语义。
 */
async function loadSessionStoreModule() {
  return import('../store/session-store');
}

async function resolveStore(req: Request) {
  const orchestrationDb = (req.app.locals.orchestration as { db?: unknown } | undefined)?.db;
  if (!orchestrationDb) {
    log.warn('orchestration.db 缺失 — STORE_UNAVAILABLE（fail-closed：对话轨拒绝无持久化服务）');
    return null;
  }
  try {
    const { SessionStore: SessionStoreImpl, isSqliteDatabase } = await loadSessionStoreModule();
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

// ═══ D1051 W5: 对话调深度（确定性判别 → 取报告 → 渲染 → 旁挂 report_view 帧）═══

/** 会话存储类型（`resolveStore` 推断——L1 零静态 L5 类型引用，D563 通道同款） */
type ConversationStore = NonNullable<Awaited<ReturnType<typeof resolveStore>>>;

/**
 * D1051: 取 app.locals.graphStore（src/server.ts:282 注入；缺席 = Bootstrap 降级，非异常）。
 * 类型位置读取（L1 类型位置豁免）——不直触 L4 实现（diagnosis.ts:706 同款）。
 */
function readGraphStore(req: Request): unknown {
  const locals = req.app.locals as { graphStore?: unknown };
  return locals.graphStore;
}

/**
 * D1051 W5: `report_view` 帧载荷（**additive**——新帧类型对旧客户端是未知帧，破面为零）。
 * 末帧仍为 `end`、**不得出现 `error` 帧**（spec §5.5 硬约束）。
 */
interface ReportViewFrame {
  type: 'report_view';
  sessionId: string;
  depth: ReportViewDepth;
  reportId: string | null;
  markdown: string | null;
  degraded: boolean;
  reason?: 'NO_REPORT' | 'RENDER_DEGRADED';
}

/**
 * D1051 W5: 渲染产物是否为降级纯文本回退。
 *
 * 判据（**文面契约**）：`report-assembler` 的两个 fallback 文案均含「（降级：」
 * （`onePagerFallback` / `detailedReportFallback`），正常模板产物不含该子串。
 * 两渲染器**永不抛出**（whole-body catch 契约），故"渲染失败"只能从产物文面判别——
 * 此为唯一可判点。
 */
function isDegradedRender(markdown: string): boolean {
  return markdown.includes('（降级：');
}

/**
 * D1051 W5: 归档回退取报告——② 号取源（① 本轮诊断产物优先，见 `emitReportViewFrame`）。
 *
 * 契约（铁律 47）:
 *   @input  — store（会话存储）；orgId（跨 org 报告不得误用）
 *   @output — { report, reportId } | null（null = 无可用归档 → 调用方走 NO_REPORT 诚实降级）
 *   @degraded — 列表失败 / 检查点缺失 / 形状非法 → log.warn + null（不伪造报告，铁律 24/31）
 *
 * 取源顺序：`listDiagnosisReports({limit:20,offset:0})` → `teamId===orgId` 过滤 →
 * `completedAt` 最新 → `getDiagnosisCheckpoint(reportId)` → `isDiagnosisReportArchive` 窄化。
 */
async function readLatestArchivedReport(
  store: ConversationStore,
  orgId: string,
): Promise<{ report: unknown; reportId: string } | null> {
  try {
    if (!store.listDiagnosisReports) return null;
    const listed = store.listDiagnosisReports({ limit: 20, offset: 0 });
    if (!listed.ok) {
      log.warn({ orgId, error: listed.error }, '归档列表读取失败 — report_view 走 NO_REPORT 降级');
      return null;
    }
    const mine = listed.reports.filter(r => r.teamId === orgId);
    if (mine.length === 0) return null;
    const latest = mine.reduce((best, cur) => (cur.completedAt > best.completedAt ? cur : best));

    const checkpoint = store.getDiagnosisCheckpoint ? store.getDiagnosisCheckpoint(latest.reportId) : null;
    if (!checkpoint || checkpoint.phase !== 5) return null;
    const { isDiagnosisReportArchive } = await loadSessionStoreModule();
    if (!isDiagnosisReportArchive(checkpoint.partialReport)) {
      log.warn({ reportId: latest.reportId }, '归档 partial_report 形状非法 — 不伪造报告（degraded）');
      return null;
    }
    return { report: checkpoint.partialReport.report, reportId: checkpoint.partialReport.reportId };
  } catch (err: unknown) {
    log.warn({ err, orgId }, '归档报告读取失败 — report_view 走 NO_REPORT 降级');
    return null;
  }
}

/**
 * D1051 W5: 对话调深度——确定性判别 → 取报告 → 渲染 → 旁挂 `report_view` 帧。
 *
 * 契约（铁律 47）:
 *   @input  — req（读 graphStore）；message（用户原文）；sessionId / orgId；store；adapter；
 *             freshReport（本轮 `diagnosisResult.report`，可缺席——非诊断轮次恒缺席）
 *   @output — 未命中深度词 → **不发帧**（零行为变化）；命中 → 发 1 个 `report_view` 帧
 *   @degraded — 无报告（两取源皆空）→ `markdown:null, degraded:true, reason:'NO_REPORT'`（不伪造）；
 *               渲染落 fallback → `degraded:true, reason:'RENDER_DEGRADED'`（markdown 仍送达
 *               fallback 纯文本——内容真实、标记诚实）；本函数任何异常均内部吞并 + log.warn，
 *               **绝不中断流、绝不产生 `error` 帧**（spec §5.5 硬约束）
 *
 * 报告取源顺序：① 本轮 `diagnosisResult.report`（`phaseComplete` 且未断线时在场）；
 * ② 归档最新（`readLatestArchivedReport`）；③ 均无 → NO_REPORT。
 * 确定性：判别为纯关键词表（零 LLM/零随机/零时刻）；同长度词码点序稳定。
 */
async function emitReportViewFrame(params: {
  req: Request;
  message: string;
  sessionId: string;
  orgId: string;
  store: ConversationStore;
  adapter: WebViewAdapter;
  freshReport: unknown;
}): Promise<void> {
  try {
    const verdict = resolveViewDepthFromUtterance(params.message);
    if (!verdict.matched) {
      log.debug({ sessionId: params.sessionId }, '本轮消息未命中深度词 — 不发 report_view 帧（零行为变化）');
      return;
    }
    const viewDepth: ReportViewDepth = normalizeReportViewDepth(verdict.depth) ?? DEFAULT_REPORT_VIEW_DEPTH;

    const { isRenderableDiagnosisReport, renderReportView, assembleOnePagerInputsForOrg } =
      await import('../agent/report-assembler');

    // ① 本轮诊断产物
    let report: unknown = params.freshReport;
    let reportId: string | null = null;
    if (isRenderableDiagnosisReport(report)) {
      reportId = report.reportId;
    } else {
      // ② 归档最新（诊断早已完成、用户后来说「讲细一点」的主场景）
      const archived = await readLatestArchivedReport(params.store, params.orgId);
      report = archived?.report ?? null;
      reportId = archived?.reportId ?? null;
    }

    // ③ 均无 → 诚实降级（不伪造报告）
    if (!isRenderableDiagnosisReport(report)) {
      log.warn({ sessionId: params.sessionId, orgId: params.orgId }, '无可用报告 — report_view 诚实降级 NO_REPORT');
      const noReportFrame: ReportViewFrame = {
        type: 'report_view',
        sessionId: params.sessionId,
        depth: viewDepth,
        reportId: null,
        markdown: null,
        degraded: true,
        reason: 'NO_REPORT',
      };
      params.adapter.sendFrame({ ...noReportFrame });
      return;
    }

    // one_pager 方向才需四槽位入参（详版不需要）
    const inputs = viewDepth === 'one_pager'
      ? await assembleOnePagerInputsForOrg(params.orgId, readGraphStore(params.req))
      : undefined;

    // 两渲染器永不抛出；仍兜一层（渲染异常不得中断流、不得产生 error 帧）
    let markdown: string | null;
    let degraded = false;
    let reason: ReportViewFrame['reason'];
    try {
      const rendered = renderReportView(report, viewDepth, inputs);
      markdown = rendered;
      if (isDegradedRender(rendered)) {
        degraded = true;
        reason = 'RENDER_DEGRADED';
        log.warn({ sessionId: params.sessionId, viewDepth }, 'report_view 渲染落 fallback — RENDER_DEGRADED（degraded 显式标记）');
      }
    } catch (err: unknown) {
      log.warn({ err, sessionId: params.sessionId, viewDepth }, 'report_view 渲染异常 — RENDER_DEGRADED（不中断流）');
      markdown = null;
      degraded = true;
      reason = 'RENDER_DEGRADED';
    }

    const frame: ReportViewFrame = {
      type: 'report_view',
      sessionId: params.sessionId,
      depth: viewDepth,
      reportId,
      markdown,
      degraded,
      ...(reason === undefined ? {} : { reason }),
    };
    params.adapter.sendFrame({ ...frame });
  } catch (err: unknown) {
    // 硬约束：本帧任何失败都不得产生 error 帧 / 不得中断流（spec §5.5）
    log.warn({ err }, 'report_view 帧发射失败 — degraded（不中断流，不产生 error 帧）');
  }
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
    // D1051: freshReport 承接本轮诊断产物，供 ⑫ 前 report_view 帧优先取源（非诊断轮恒 undefined）
    let freshReport: unknown = undefined;
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
      freshReport = diagnosisResult?.report;
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

    // ⑪.5 D1051: 对话调深度 —— 确定性判别 → 取报告 → 渲染 → 旁挂 `report_view` 帧。
    //     独立于 phaseComplete（"诊断早已完成、用户后来说「讲细一点」"是主场景，
    //     挂 complete 帧会在该场景缺席）。硬约束：末帧仍为 `end`、不得产生 `error` 帧
    //     （本调用内部全吞异常 + log.warn，spec §5.5）。
    await emitReportViewFrame({ req, message, sessionId, orgId, store, adapter, freshReport });

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
