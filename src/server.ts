/**
 * server.ts — SynovaAgent HTTP 服务
 *
 * 最小 Express 服务器，只挂载必要路由。
 * 初始化逻辑委托给 Bootstrap (src/deploy/bootstrap.ts)。
 * 不引入 Novis 的任何依赖。
 */
import express, { Router } from 'express';
import * as path from 'path';
import cors from 'cors';
import type { Server } from 'http';
import { MemoryMonitor } from './services/memory-monitor';
import { logger } from '@synova/logger';
// C2+C3+C4: 编排层接线 (审计 P0-20260604)
import { initFileDrivenLoaders } from './init/file-driven-loaders'; // v3.6 Batch 1 — 文件驱动加载器
import { ToolRegistry } from './agent/tools';
import { KnowledgeInjector, KnowledgeConflictHandler, AtomicWriter } from './agent/index';
import { BossMailbox } from './agent/boss-mailbox';
import { rbacMiddleware } from './middleware/rbac'; // D947: 仅保留中间件；装配期空调用已删（见 244 区注释）
import { jwtAuthMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import { buildInheritedContext, detectConflicts } from './agent/workspace-service';
// Code Review A1+A3: 凭证加密 + L5 事件总线初始化
import { CredentialVault } from './security/credential-vault';
// D603 跨层修复（簇5）: OntologyEventBus 初始化已集中 Bootstrap Phase 1c（deploy/bootstrap.ts:759-760
// 动态装配）；server.ts 的静态 import 为死引用，直接移除（铁律 39: L1 不直触 l5/）。
import homeRoutes from './routes/home';
import chatRoutes from './routes/chat';
import workspaceRoutes from './routes/workspace';
import workspaceDataRoutes from './routes/workspace-data'; // D74 — 工作台数据 API
import workspacesApiRoutes from './routes/workspaces-api';
import gaDiagnosisRoutes from './routes/ga-diagnosis';
import knowledgeAskRoutes from './routes/knowledge-ask';
import deptWorkspaceRoutes from './routes/department-workspace';
import actionsApiRoutes from './routes/actions-api';
import healthRoutes from './routes/health';
import healthzRoutes from './routes/healthz';
import evolutionRoutes from './routes/evolution';
import gaEvolutionRoutes from './routes/ga-evolution';
import ontologyRoutes from './routes/ontology';
import ontologyAdminRoutes from './routes/ontology-admin';
import diagnosisRoutes from './routes/diagnosis';
import configRoutes from './routes/config'; // D600 — GET /api/config/dump 客户配置检查表面（--dump-config）
import sessionsRoutes from './routes/sessions';
import conversationsRoutes from './routes/conversations'; // D590 — 对话 SSE 端点（ConversationEngine × HTTP 接线）
import metricsRoutes from './monitoring/routes';
import reviewRoutes from './routes/review';
import expertRoutes from './routes/expert';
import agentObserverRoutes from './routes/agent-observer';
import imRoutes from './routes/im';
import knowledgeRoutes from './routes/knowledge';
import credentialRoutes from './routes/credentials';
import { llmConfigRoutes } from './routes/llm-config';
import { onLlmCredentialChanged } from './services/llm-credential-store';
import documentRoutes from './routes/documents';
import permissionRoutes from './routes/permissions';
import sentinelHealthRoutes from './routes/sentinel-health';
import sentinelRoutes from './routes/sentinel';
import dataRoutes from './routes/data'; // V4.2.9 — 数据上传 API
import dataLifecycleRoutes from './routes/data-lifecycle'; // D40 — GDPR 可携带权+被遗忘权
import reloadRoutes from './routes/reload';
import adaptersRoutes from './routes/adapters';
import auditRoutes from './routes/audit';
import adminKnowledgeRoutes from "./routes/admin-knowledge";
import gaAdminRoutes from './routes/ga-admin';
import gaCorrectionsRoutes from './routes/ga-corrections';
import gaAnnotationsRoutes from './routes/ga-annotations';
import gaCalibrationRoutes from './routes/ga-calibration'; // D551 — GA 诊断校准/手动信号注入/效用仪表
import solutionsRoutes from './routes/solutions';
import notificationsRoutes from './routes/notifications';
import backupRoutes from './routes/backup';
import selfOpsRoutes from './routes/self-ops';
import overflowRoutes, { setOverflowGraphStore } from './routes/overflow'; // D478 — 挂载 + graphStore 生产注入
import loopRoutes from "./routes/loops";
import enterpriseRoutes from './routes/enterprise'; // D103
import importRoutes from './routes/import'; // D231
import cockpitRoutes from './routes/cockpit'; // D220-PHASE3
import type { ServiceContainer } from './services/container';
// Phase 0.1: 全局错误兜底 — uncaughtException + unhandledRejection
import { setMainAgent } from "./routes/loops";
import { setGraphBridge } from "./routes/import"; // D231
import { MainAgent } from "./agent/main-agent";
import { LOOP_TRIGGER_MATRIX } from "./loops/loop-trigger-config";
import { registerGlobalErrorHandlers, unregisterGlobalErrorHandlers } from './services/runtime-global-handlers';

import { Bootstrap } from './deploy/bootstrap';
import type { BootstrapResult } from './deploy/bootstrap';

// ═══ D590 裁决②: upload-v2 下线 — 410 Gone 显式（非静默 404），指路替代入口 ═══
// 活路由零撞路径（L1 审计 §4.3 已证 /consult* 与 upload 五路径零交集，精确匹配零误伤）。
// 模块级导出便于集成测试直接挂载验证（tests/routes/conversations.test.ts 用例⑩）。
export const uploadV2GoneRouter: Router = Router().all(
  ['/api/diagnosis/upload', '/api/diagnosis/interview', '/api/diagnosis/status/:jobId', '/api/diagnosis/report/:jobId'],
  (_req, res) => {
    res.status(410).json({
      ok: false,
      code: 'GONE',
      message: '文档诊断 upload-v2 已下线——请改用 POST /api/diagnosis/consult（SSE 六阶段诊断）或对话端点 POST /api/conversations',
    });
  },
);

// ═══ D716/1-5: D283 旧 Web 安装引导下线 — 410 Gone 显式（非静默 404），指路唯一入口 ═══
// 形态对齐 D590 先例（uploadV2GoneRouter）。挂载点必须早于 /app 静态挂载（createServer 内
// 顺序即优先级；否则 cwd=仓库根时 static 命中胜出，退场退化为 cwd 巧合）——挂载顺序由
// tests/routes/setup-guide-retired.test.ts 源码断言 + 行为断言锁定，不靠注释约定。
// 契约（铁律 47）：
// @input — 任意方法/任意查询串的 /app/setup.html（all 覆盖 GET/POST/HEAD）
// @output — HTTP 410 + Content-Type: text/html + body 人话三段：
//           ① 此页已下线 ② 唯一入口 = 双击安装包（桌面端首诊页） ③ 开发者路径见 runbook
// @degraded — 无（纯静态响应，无 IO，不抛）
export const setupGuideGoneRouter: Router = Router().all(
  '/app/setup.html',
  (_req, res) => {
    res.status(410).type('html').send(
      '<h1>此安装引导已下线</h1>'
      + '<p>旧 Web 安装引导（四步向导）已随桌面端单一入口收敛下线（D716 验收点 1-5）。</p>'
      + '<p>唯一入口：双击安装包启动 SynovaAgent 桌面端——首次启动将在窗口内直接进入配置引导（首诊页）。</p>'
      + '<p>开发者路径见 docs/synova/runbooks/desktop-dev-prod.md（用户唯一路径 = 安装包双击；命令行路径仅开发）。</p>',
    );
  },
);

export async function createServer(): Promise<Server> {
  // ═══ D83: Bootstrap 启动序列 — 6 Phase 统一初始化 ═══
  // 替代原有的 ~300 行内联初始化代码
  const boot = new Bootstrap();
  const result: BootstrapResult = await boot.run();

  if (!result.ok) {
    logger.error({
      aborted: result.aborted,
      phases: result.phaseResults.map((r) => ({
        name: r.name,
        status: r.status,
        durationMs: r.durationMs,
        errors: r.errors,
      })),
      degraded: result.services.degradedModules,
    }, 'Bootstrap 启动失败 — 服务器将终止');
    process.exit(1);
  }

  if (result.degraded) {
    logger.warn({
      degradedModules: result.services.degradedModules,
    }, 'Bootstrap 启动完成 — 部分模块降级运行');
  }

  // ═══ 从 Bootstrap 获取已初始化服务 ═══
  const services = result.services;
  const config = services.config;
  const db = services.db;
  const eventBus = services.eventBus;
  const hookRunner = services.hookRunner;
  const sessionManager = services.sessionManager;
  const stateMachine = services.stateMachine;
  const wiring = services.wiring;
  const federalAdapter = services.federalAdapter;
  const graphStore = services.graphStore;
  const agentMemory = services.agentMemory;
  const connectorToolRegistry = services.connectorToolRegistry;
  const credentialVault = services.credentialVault;
  const credentialPool = services.credentialPool;
  const piiScrubber = services.piiScrubber;

  // Phase 4.2: 配置恢复验证 — 启动时检查配置文件完整性
  // (已在 Bootstrap Phase 4 中执行)
  logger.info('Bootstrap 服务已就绪，开始 Express 设置');

  // Phase 4.1: 注册 Electron 通知适配器
  try {
    const { ElectronNotificationAdapter } = await import('./notifications/electron-adapter');
    const { registerNotificationAdapter } = await import('./notifications/registry');
    registerNotificationAdapter(new ElectronNotificationAdapter());
    logger.info('Electron 通知适配器已注册');
  } catch (err: unknown) {
    logger.warn({ err }, 'Electron 通知适配器注册失败 — degraded');
  }

  // ═══ v2.1: 知识注入器 + 冲突处理器 + 原子写入 — 已在 Bootstrap Phase 4 初始化 ═══
  // (server.ts 中保留这些引用供后续路由使用)
  // 如果 bootstrap 未提供知识服务，在这里 fallback
  const knowledgeInjector = new KnowledgeInjector(process.cwd());
  const knowledgeConflicts = new KnowledgeConflictHandler(db);
  const atomicWriter = new AtomicWriter(process.cwd());
  atomicWriter.cleanup();

  // BossMailbox — 已在 Bootstrap Phase 5 初始化
  // 此处保持 setInterval 逻辑
  const bossMailbox = new BossMailbox(); // PRD v1.6 Slice 5
  // v3.5 PRD §12.4: 老板信箱定时推送 (周一 9:00) — V4.2.1: 注入真实信号+行动数据
  setInterval(async () => {
    try {
      const now = new Date();
      if (now.getDay() !== 1 || now.getHours() !== 9 || now.getMinutes() !== 0) return;
      const webhookUrl = process.env.FEISHU_WEBHOOK_URL || '';
      if (!webhookUrl) return;

      // 从哨兵系统获取信号
      let signals: Array<{ severity: 'critical' | 'warning' | 'info'; title: string; description: string; trend: 'improving' | 'stable' | 'worsening' }> = [];
      try {
        const { getSentinelRegistry } = await import('./sentinel/registry');
        const { aggregateSignals } = await import('./sentinel/signal-aggregator');
        const findings = await getSentinelRegistry().runAll({ db, now: new Date(), registry: getSentinelRegistry() });
        if (findings.length > 0) {
          const checkResults: import('./sentinel/types').SentinelCheckResult[] = [{
            sentinelId: 'boss-mailbox',
            ok: true,
            findings,
            durationMs: 0,
            checkedAt: new Date().toISOString(),
          }];
          const aggregated = aggregateSignals(checkResults);
          signals = aggregated.signals.map(s => ({ severity: s.severity, title: s.title, description: s.title, trend: 'stable' as const }));
        }
      } catch (err: unknown) { logger.warn({ err }, '老板信箱获取信号失败 — degraded'); }

      // 从 AgentMemoryStore 获取行动项
      let actions: Array<{ title: string; status: 'completed' | 'in_progress' | 'stalled'; detail: string }> = [];
      try {
        const am = agentMemory;
        if (am) {
          // AgentMemoryStore recall 接口
          const records: Array<{ value: string }> = [];
          if (records && records.length > 0) {
            actions = records.map(r => {
              try {
                const item = JSON.parse(r.value) as { title?: string; description: string; status: string };
                return { title: item.title || item.description, status: item.status === 'completed' ? 'completed' as const : item.status === 'in_progress' ? 'in_progress' as const : 'stalled' as const, detail: item.description };
              } catch (e) { logger.warn({ err: e }, '解析行动项失败 — degraded'); return { title: '行动项', status: 'in_progress' as const, detail: '' }; }
            });
          }
        }
      } catch (err: unknown) { logger.warn({ err }, '老板信箱获取行动项失败 — degraded'); }

      const report = bossMailbox.generateReport('Synova', `W${Math.ceil(now.getDate()/7)}`, signals, actions);
      bossMailbox.pushToFeishu(report, webhookUrl).catch((err: unknown) => {
        logger.warn({ err }, '老板信箱飞书推送失败');
      });
    } catch (err: unknown) { logger.warn({ err }, '老板信箱推送失败 — degraded'); }
  }, 60000); // 每分钟检查

  // PRD v1.6 Slice 7: workspace-service 接线
  buildInheritedContext({ parentId: 'init', department: 'dept', title: 'init', source: 'boss_assigned', parentSummary: 'init' });
  detectConflicts([]); // Slice 7 冲突检测初始化
  // D947/P7: 装配期 RBAC「自欺块」（原 :247-249 —— 硬编码管理员身份字面量 + 两处 `void` 丢弃判定结果）已删除；
  // 真实责任在 rbacMiddleware 注入 req.rbac（下方路由区）+ 路由级守卫消费 req.rbac（P3）。

  const app = express();

  // ═══ P0 Phase Gate Check — 诊断质量门禁 ═══
  const phaseGateTracking = { evidenceCount: 0, expertResults: [] as Array<{ expertType: string; confidence: number; hypothesis: string; degraded?: boolean }> };
  app.locals.phaseGateTracking = phaseGateTracking;
  const { registerPhaseGateChecks } = await import('./orchestrator/phase-gate-check');
  registerPhaseGateChecks(
    stateMachine,
    { minEvidenceCount: 3, minHypothesisConfidence: 0.5, minExpertsPassed: 4 },
    () => phaseGateTracking.evidenceCount,
    () => phaseGateTracking.expertResults,
  );

  // ═══ P2 DI 深化: 统一服务容器 (单例生命周期管理) ═══
  const container: ServiceContainer = {
    db,
    eventBus, hookRunner, sessionManager, stateMachine,
    piiScrubber: piiScrubber as never,
    credentialVault: credentialVault as never,
    credentialPool: credentialPool as never,
    federalAdapter: federalAdapter as never,
    expertRegistry: new (await import('./l3/expert-registry')).ExpertRegistry(),
    proposalManager: new (await import('./l2/proposal-manager')).ProposalManager(db),
    reportTemplates: new (await import('./l3/report-templates')).ReportTemplateRegistry(),
    llmCache: new (await import('./services/llm-cache')).LLMCache(),
    faultRecovery: new (await import('./services/fault-recovery')).FaultRecovery(),
    mcpBridge: new (await import('./mcp/bridge')).MCPBridge(),
  };
  // 可选组件
  if (connectorToolRegistry) container.connectorToolRegistry = connectorToolRegistry;
  app.locals.container = container;
  if (graphStore) app.locals.graphStore = graphStore;
  // D603 跨层修复（簇4）: 注入 Bootstrap Phase 0 单例 SessionStore — routes/sessions
  // 消费注入实例（未注入环境回退 L2 兜底装配），L1 不再自建 SessionStore(getDatabase())。
  app.locals.sessionStore = services.sessionStore;
  app.locals.orchestration = { eventBus, hookRunner, sessionManager, stateMachine, wiring, db, eventStore: services.eventStore };
  app.locals.federalAdapter = federalAdapter;
  if (connectorToolRegistry) app.locals.connectorToolRegistry = connectorToolRegistry;
  if (credentialVault) app.locals.credentialVault = credentialVault;
  if (credentialPool) app.locals.credentialPool = credentialPool;
  if (piiScrubber) app.locals.piiScrubber = piiScrubber;
  if (agentMemory) app.locals.agentMemory = agentMemory;

  // ═══ C2 上下文预算追踪器 ═══
  const { getBudgetTracker } = await import('./services/context-budget-tracker');
  app.locals.budgetTracker = getBudgetTracker();

  // ═══ P0 AgentMemoryStore — Agent 级记忆系统 ═══
  if (agentMemory) {
    app.locals.agentMemory = agentMemory;
  }

  // ═══ Phase 0: 文件优先范式 — 文件扫描 + 专家文件加载 ═══
  const { FileScanner } = await import('./agent/file-scanner');
  const fileScanner = new FileScanner();
  app.locals.fileScanner = fileScanner;
  const { ExpertFileLoader } = await import('./agent/expert-file-loader');
  const expertFileLoader = new ExpertFileLoader();
  app.locals.expertFileLoader = expertFileLoader;
  try {
    const index = fileScanner.scan();
    const loadResult = expertFileLoader.loadFromIndex(index, {});
    logger.info({ fromFiles: loadResult.fromFiles, total: loadResult.loaded.length },
      'Phase 0 专家文件加载完成');
  } catch (err: unknown) {
    logger.warn({ err }, 'Phase 0 文件加载失败 — degraded, 使用代码默认 prompt');
  }

  // 基础中间件
  // D716/1-5: 旧安装引导 410 显式下线——挂载必须早于下方 /app 静态挂载（顺序即优先级），
  // 且先于 JWT（D590 同纪律：下线信号对未认证客户端也显式）。顺序由
  // tests/routes/setup-guide-retired.test.ts 锁定。
  app.use(setupGuideGoneRouter);
  // D96: 静态文件服务 — 前端 UI (login/dashboard/reports)
  app.use('/app', express.static(path.join(process.cwd(), 'app')));
  app.get('/', (_req, res) => res.redirect('/app/index.html'));
  app.get('/login', (_req, res) => res.redirect('/app/login.html'));

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // P1-1.3: 输入脱敏检查
  const { sanitizeCheckMiddleware } = await import('./middleware/sanitize-check');
  app.use(sanitizeCheckMiddleware);

  // Phase 0.1: JWT 认证中间件
  // D575: llmConfigRoutes 必须挂载在本行之前——首启向导在无用户系统时必须可用
  // （spec §6 决策 5: 无认证，对齐 credentials.ts 语义；credentials.ts 本体在 L34x 挂载点
  // 位于 auth 之后，生产态被全局 JWT 拦截——其"无认证"仅路由层成立，本卡实测发现，
  // 已在 evidence/D575/ 登记。/api/llm/* 走"先于 JWT 挂载"路径实现同等语义）。
  app.use(llmConfigRoutes);
  // D590 裁决②: 410 拦截先于 JWT——下线信号对所有客户端显式（含未认证的 ga 页轮询器，
  // 否则未认证客户端看到 401，裁决②的"显式下线 + 轮询止停"对它们不生效）
  app.use(uploadV2GoneRouter);
  app.use(jwtAuthMiddleware);

  // Phase 0.1: JWT 认证路由
  app.use(authRoutes);

  // Phase 3.1: 三层速率限制
  const { createFixedWindowLimiter } = await import('./middleware/rate-limit');
  const rateLimitMiddleware = createFixedWindowLimiter(100, 60_000);
  app.use(rateLimitMiddleware);

  // 路由
  app.get('/api/status/budget', (req, res) => {
    try {
      const tracker = req.app.locals.budgetTracker;
      if (!tracker) return res.json({ ok: false, degraded: true, message: '预算追踪器未初始化' });
      res.json({ ok: true, ...tracker.snapshot() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg, degraded: true });
    }
  });
  // D947/P4: RBAC 注入点前移（原 :373 → 此处；仍晚于 jwtAuthMiddleware 与 rateLimitMiddleware）
  app.use(rbacMiddleware);
  // ── D947/P4 前移理由与不变量（供 K3 核对）─────────────────────────────
  // ① 前移前 rbac 位于 workspacesApiRoutes 之后 ⇒ 该路由组永远拿不到 req.rbac ⇒ 路由级守卫必然 fail-closed。
  // ② 前移后本行之前仅剩 5 个路由注册（豁免集，均有既有文档依据）：
  //    setupGuideGoneRouter(D716 410) · llmConfigRoutes(D575 首启向导) · uploadV2GoneRouter(D590② 410) ·
  //    authRoutes(登录入口) · 内联 GET /api/status/budget。判据 = P4 判别谓词（非 REV-6 字面 awk）。
  // ③ 不变量 I4：rbac 不得早于 jwtAuthMiddleware —— 唯一可信来源是 req.auth（验签后注入）。
  // ④ rbacMiddleware 本体语义不变（仅注入 req.rbac + next()，不做拦截）：/api/knowledge/ask(:372→本行后)、
  //    /health 与 /api/healthz 均在本行之后，只有「不拦截」时其直达语义才成立；
  //    拦截责任在路由级守卫（P3），本文件不新增第二份白名单（auth.ts:82 唯一源）。
  app.use(homeRoutes);
  app.use(chatRoutes);
  app.use(workspaceRoutes);
  app.use(workspaceDataRoutes); // D74 — 工作台数据 API
  app.use(workspacesApiRoutes);
  app.use(gaDiagnosisRoutes);
  app.use(knowledgeAskRoutes);
  app.use(deptWorkspaceRoutes);
  app.use(actionsApiRoutes);
  app.use(dataRoutes);
  app.use(dataLifecycleRoutes);
  app.use(healthRoutes);
  app.use(healthzRoutes);
  app.use(evolutionRoutes);
  app.use(gaEvolutionRoutes);
  app.use(ontologyRoutes);
  app.use(ontologyAdminRoutes);
  app.use(diagnosisRoutes);
  app.use(configRoutes); // D600 — config/dump 挂载（逐层 provenance 检查表面）
  app.use(sessionsRoutes);
  app.use(conversationsRoutes); // D590 — 对话 SSE 端点（sessionsRoutes 旁，spec §5.1）
  app.use(metricsRoutes);
  app.use(reviewRoutes);
  app.use(expertRoutes);
  app.use(agentObserverRoutes);
  app.use(imRoutes);
  app.use(knowledgeRoutes);
  app.use(credentialRoutes);
  app.use(documentRoutes);
  app.use(permissionRoutes);
  app.use('/api/sentinel', sentinelHealthRoutes);
  app.use('/api/sentinel', sentinelRoutes);
  app.use(reloadRoutes);
  app.use(adaptersRoutes);
  app.use(auditRoutes);
  app.use(gaAdminRoutes);
  app.use(adminKnowledgeRoutes);
  app.use(gaCorrectionsRoutes);
  app.use(gaAnnotationsRoutes);
  app.use(gaCalibrationRoutes); // D551 — /api/ga/calibration 端点族
  app.use(solutionsRoutes);
  app.use(notificationsRoutes);
  app.use(backupRoutes);
  app.use(selfOpsRoutes);
  app.use(enterpriseRoutes); // D103 — 企业路由
  app.use(importRoutes); // D231
  app.use(loopRoutes); // D20 — 循环状态 API
  app.use(cockpitRoutes); // D220-PHASE3 — 创始人仪表盘
  app.use(overflowRoutes); // D478 — 溢出仪表盘 API（D476 认证+隔离已就绪；修复 D90 仅 import 未挂载）

  // ═══ D575: LLM 凭证变更热生效（A4 onChanged）═══
  // 按请求解析架构（routes 每请求 loadConfig + createProvider）——凭证更新无需重建任何
  // 客户端单例，下一请求即用新 key；本订阅只落一条 config/llm-changed 审计日志（进程不重启）。
  onLlmCredentialChanged((info) => {
    logger.info({
      event: 'config/llm-changed',
      provider: info.provider,
      maskedKey: info.maskedKey,
      pid: process.pid,
    }, 'LLM 凭证已更新 — 热生效（进程不重启，下一请求按新 key 解析）');
  });

  // ═══ A2: Connector Pipeline — 手动触发 ═══
  app.post('/api/connector/sync', async (req, res) => {
    try {
      const { module: moduleName, orgId } = req.body as { module?: string; orgId?: string };
      if (!moduleName || !orgId) {
        return res.status(400).json({ ok: false, error: 'module 和 orgId 必填', code: 'VALIDATION_ERROR' });
      }
      const { runConnectorPipeline } = await import('./l5/connector-pipeline');
      const vault = req.app.locals.credentialVault;
      const credentials = vault
        ? vault.decryptForSubprocess(moduleName) || '{}'
        : '{}';
      const creds: Record<string, string> = JSON.parse(credentials);
      const result = await runConnectorPipeline(moduleName, orgId, creds);
      res.json({ ok: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg, code: 'PIPELINE_ERROR', degraded: true });
    }
  });

  // Cron 调度器 + 定时任务 — 已在 Bootstrap Phase 5 初始化

  // 404
  app.use((_req, res) => {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Not Found' });
  });

  return new Promise((resolve, reject) => {
    // D20: 注入 MainAgent 到 loops 路由
    try {
      const mainAgent = new MainAgent();
      for (const loopConfig of LOOP_TRIGGER_MATRIX) {
        mainAgent.registerLoop(loopConfig);
      }
      setMainAgent(mainAgent);
      setGraphBridge(graphStore); // D231
      // D478: overflow 路由 graphStore 生产注入。services.graphStore 为 unknown（BootstrapServices），
      // 判空守卫 + 显式收窄到 GraphStore（类型源与 setter 形参同源，非 any 断言，铁律 38 合规）。
      // graphStore 缺席（Bootstrap 降级）→ 跳过注入，路由侧既有 if (!graphStore) 503 degraded 语义保持（铁律 31）。
      if (graphStore) {
        setOverflowGraphStore(graphStore as import('./l4/graph-bridge').GraphStore);
      }
    } catch (err: unknown) {
      logger.warn({ err }, "MainAgent 初始化失败 — loops 路由降级");
    }

    const server = app.listen(config.port, () => {
      logger.info({ port: config.port }, `Synova-Agent → http://localhost:${config.port}`);

      // P0-5.3: 优雅关闭时加密数据库
      const encryptionConfig = {
        masterSecret: process.env.CREDENTIAL_MASTER_KEY || config.engineTokens || (config.devMode ? 'synova-dev-secret' : ''),
        salt: config.dbPath,
        dbPath: config.dbPath,
      };

      const shutdown = (signal: string) => {
        const forensics = {
          signal,
          pid: process.pid,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
        };
        logger.info({ forensics }, 'shutdown forensics');

        unregisterGlobalErrorHandlers();
        // 关闭时加密数据库
        import('./services/db-encryption').then(({ autoEncryptOnShutdown }) => {
          autoEncryptOnShutdown(encryptionConfig);
        }).catch((err: unknown) => {
          logger.error({ err }, 'Database encryption on shutdown failed');
        });
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000);
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));

      resolve(server);
    });
    server.on('error', reject);

    // Phase 5.3: 内存监控（每 5 分钟）
    const memoryMonitor = new MemoryMonitor();
    memoryMonitor.start();

    // Phase 0.1: 全局错误兜底
    registerGlobalErrorHandlers(server);
  });
}
