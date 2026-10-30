/**
 * agent/conversation-engine.ts — 纯逻辑对话引擎 (Slice 1.1)
 *
 * 从 AgentConversation 中提取的核心对话逻辑，零 UI 依赖。
 * 不 import neo-blessed、readline、或任何 UI 框架。
 * TUI/Web/CLI 均为视图适配器，只负责接收输入和渲染输出。
 *
 * 状态机: Phase 0 (访谈) → Phase 1-5 (诊断流水线)
 *
 * Iron law #32: 错误统一通过 try/catch + log 处理，不静默吞。
 * Iron law #31: degraded 信号通过 ProcessResult 传播。
 *
 * #1075 P2-2（岗位包 v2 · 人设＋上下文消费）：系统提示词新增**岗位人设层**，位置在 L1 对话层
 *   之后、相位层之前 ⇒ 顺序契约 `L0 → L1 → 岗位设定 → 当前阶段 → 覆盖度`（判据 J1a）。
 *   · `EngineConfig.rolePack?` —— 构造期注入已解析的 `RolePackPersona`；缺省/null ⇒ 该层为空串，
 *     `filter(Boolean)` 后提示词**逐字**等于无包基线（J3：`LEN=1462`／`sha256=976ca69…fd33`）。
 *   · `setRolePack(persona|null)` —— **每轮刷新**入口（生产唯一调用方 = 路由缓存命中路径）；幂等；
 *     内部同时把运行期 `engineCtx.messages` 重新对齐到本引擎的消息数组（`fromState()` 恢复后二者会分叉，
 *     见该方法注释 —— 不对齐则 LLM 调用看不到重建的 system 层）。
 *   · `serialize()` 写入 `rolePackId` 的判据 = **绑定意图**真源 `boundRolePackId`（人设文本**不落库**，
 *     每轮从磁盘重解析）；未绑定会话**不写该键** —— 保 J3 基线形态（`'rolePackId' in state === false`）。
 *     降级轮（复核失败/撤岗后 `rolePack === null` 但已绑定）**照样写**绑定意图 —— 「已绑定 ≠ 已生效」：
 *     是否真正注入仍由每轮 `loadRolePackPersona()` 复核决定（#1169 修降级轮落库丢绑定；规格 §2.1-e／§10）。
 *   · `fromState(…, { rolePack })` —— 显式传 `persona`／`null` 才重建 system 层（`null` = 撤岗，
 *     必须把快照里的旧人设段刷掉）；不传（`undefined`）⇒ 既有恢复行为逐字不变（兼容旧调用方）。
 *
 *   @authority 人设文本真源 = `src/init/role-pack-persona.ts`（本文件只**消费**已解析的 `RolePackPersona`，
 *              不读磁盘、不判审批、不做限额 —— 判据与 HTTP 码映射分别归 persona 模块与路由）。
 *   @degraded 岗位层为空（无包／撤岗／`SYNOVA_ROLE_PACK_PERSONA=off`）⇒ 不注入，**不是错误**。
 *
 * #1075 P2-4a（工具白名单／权限生效 · 装配面）：本文件负责把"包声明的工具白名单"接到
 *   真实 `ToolRegistry` 执行门（编译与判定归 `src/init/role-pack-permissions.ts`）。
 *   · **唯一"是否已绑定"真源 = `boundRolePackId`**（`null` = 从未绑定）；`pendingRolePackId` 只是
 *     "待应用"标记。三路注入（构造期 `EngineConfig.rolePack`／`fromState(state.rolePackId)`／
 *     `setRolePack()`）**只记不即时算** —— 工具在路由的 `registerBuiltinTools()` 才注册，
 *     绑定早于注册（规格 D11）：此时若按空注册表算白名单，会把全部声明误判为未落地 ⇒ 首轮全拒。
 *   · 应用时机 = `processMessage()`／`processMessageStream()` **入口首行** `ensurePermissionsApplied()`；
 *     测试/守卫可调公开的 `refreshRolePackPermissions()`（幂等）。
 *   · `null` 两义（D12）：**从未绑定** ⇒ `setAllowedTools(null)`（恢复既有行为，无岗位会话零变化）；
 *     **已绑定但本轮人设复核失败/撤岗**（`rolePack === null` 且 `boundRolePackId !== null`）⇒
 *     `setAllowedTools([])`（fail-closed，不因降级而全放行）。
 *   · 回滚开关 `SYNOVA_ROLE_PACK_TOOLS=off` ⇒ `setAllowedTools(null)` ＋ warn（D8，显式降级）。
 *   · @not-here 不判审批 scope／capabilities 内容／限额（归权限编译模块）；P2-4a 不改 `serialize()` 的
 *     `rolePackId` 写法 —— 该写法由 **#1169** 修正（规格 §2.1-e／§10：只持久化**绑定意图**，是否生效
 *     仍由每轮复核决定；降级轮落库不再丢绑定）。
 */
import type { LLMProvider, LLMMessage, HealthCheckResult } from '../providers/types';
// D363: 运行时 failover 接线 — chain 包装 + 环境变量派生备用 provider
import { createProviderChain, detectProviderFromUrl } from '../providers/registry';
import { createProvider } from '../providers';
import type Database from 'better-sqlite3';
import { ToolRegistry, isToolAbortEnabled } from './tools';
import { getGlobalGracefulShutdown } from '../services/graceful-shutdown';
import { createLogger } from '@synova/logger';
import type { ViewAdapter } from '../l1-interaction/types';
import type { IntentRouter } from '../orchestrator/intent-router';
import type { DimensionRegistry } from '../orchestrator/dimension-registry';
import type { HookRunner } from '../orchestrator/hook-runner';
import type { PhaseStateMachine } from '../orchestrator/phase-state-machine';
import type { PIIScrubber } from '../security/pii-scrubber';
import type { SessionManager } from '../orchestrator/session-manager';
import type { EventBus } from '../orchestrator/event-bus';
import type { EvidenceCollector, CorroborationEngine } from '../evidence/index';
// EC-03: L2 只依赖 L4 类型 (接口契约), 运行时通过 diagnosis-launcher (L3) 调用
import type { GraphStore } from '../l4/graph-bridge';
import type { createGraphBridge } from '../l4/graph-bridge';
import type { ReportGraphAdapter } from '../l4/report-graph-adapter';
import type { DecisionInput, DecisionResult } from '../l4/decision-capture';
// V4.2.3: diagnosis-graph-query.ts 已删除 — L4 图查询类型移除
import type { Triple, ReflectionResult } from '../l4/triple-reflection';
import type { L3ResolutionResult } from '../l4/entity-resolver';
import type { CommunityReport } from '../l4/community-reports';
// P1-01: 子组件提取 — 单体引擎拆分为 3 个独立类
import { ToolLoopExecutor, TOOL_CANCELLED_REPLY } from './tool-loop-executor';
import { DiagnosisLauncher, type DiagnosisEvent, type ConsultationResult, type SessionStoreLike } from './diagnosis-launcher';
import { OntologySyncer, type OntologySyncResult } from './ontology-syncer';
import type { EngineContext } from './engine-context';
import { SqliteGraphStore } from '../adapters/sqlite-graph-store';
import { getGlobalSentinelRunner } from '../sentinel/runner';
import { ContextEngine } from '../orchestrator/context-engine';
// D594: 会话级上下文压缩引擎（DSH compaction-basic 范式借鉴，读源码自研零依赖）
import { ContextCompaction, ContextCompactionError, createProviderSummarizer, wrapProviderWithOverflowRecovery } from './context-compaction';
// #656 M2: conversation 链 ingest 调用点（复用现成 ingestDocumentText；不改 src/ingest/**）
import { ingestDocumentText } from '../ingest/knowledge-ingest-bridge';
// #1075 P2-2: 岗位人设层（规格 D3 —— 独立层，不改 buildContextLayer 的相位语义）。
// 值导入 `buildRoleLayer` 零 IO 纯核；类型导入 `RolePackPersona` 纯编译期 ⇒ 不引人设解析期依赖
// （磁盘读取/审批/限额只在路由侧经 `loadRolePackPersona()` 触发）。
import { buildRoleLayer, type RolePackPersona } from '../init/role-pack-persona';
// #1075 P2-4a: 岗位包工具权限编译（审批门＋六件快照＋capabilities 解析 → 白名单/禁用/未落地）。
// 只**消费**已编译结果；磁盘读取/审批/限额归该模块，白名单执行判定归 ToolRegistry。
import { loadRolePackPermissions } from '../init/role-pack-permissions';
// #1075 P2-4b-B: 角色会话知识过滤编译器（scope/deny ＋ 认证面同源敏感度 → L4 FilterClause）。
// 只**消费**已编译过滤面；YAML/scope/审批解析归 preset-loader，检索执行归 L4。
import { buildRoleKnowledgeFilter, buildRejectedKnowledgeFilter, type RoleKnowledgeFilter } from '../init/role-pack-knowledge-filter';
// #1075 P2-4b-B: 知识检索**系统工具**（不注册进 ToolRegistry；经 setSystemToolProvider 注入）
import { createKnowledgeSearchTool } from './builtin-tools';

const log = createLogger('agent/conversation-engine');

/** D594: 默认上下文窗口 token 预算（估算 ceil(chars/4) 惯例下的安全档；可用 EngineConfig 覆盖） */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 65536;

// ═══ Types ═══

// Re-export for backward compatibility (P1-01: 子组件提取)
export type { DiagnosisEvent, ConsultationResult, OntologySyncResult };

export interface EngineConfig {
  /** Phase 0 最大轮次 (默认 6) */
  maxTurns?: number;
  /** 组织 ID */
  orgId?: string;
  /** 编排层: IntentRouter (替换简单轮次计数) */
  intentRouter?: IntentRouter;
  /** 编排层: DimensionRegistry (维度覆盖追踪) */
  dimensionRegistry?: DimensionRegistry;
  /** 编排层: HookRunner (工具 pre/post hooks) */
  hookRunner?: HookRunner;
  /** 编排层: SessionManager (自动压缩) */
  sessionManager?: SessionManager;
  /** D487: SessionStore 装配 — 注入 engineCtx 后 DiagnosisLauncher 落诊断事件流到 session_events */
  sessionStore?: SessionStoreLike;
  /** 编排层: EventBus (事件追踪) */
  eventBus?: EventBus;
  /** 编排层: PhaseStateMachine (Batch 2: 状态机驱动 Phase 转换) */
  phaseStateMachine?: PhaseStateMachine;
  /** PII 脱敏: 用户输入出站到云 LLM 前脱敏 */
  piiScrubber?: PIIScrubber;
  /** 会话 ID (用于事件追踪) */
  sessionId?: string;
  /** D363: 备用 LLMProvider — 主 provider 失败时 chain 自动切换。undefined → 从环境变量派生（主 deepseek→备 openai，主非 deepseek→备 deepseek）；null → 显式禁用 failover */
  fallbackProvider?: LLMProvider | null;
  /** D594: 上下文窗口 token 预算 — 压缩 threshold=window×0.8 / retain=window×0.16（默认 65536） */
  contextWindowTokens?: number;
  /** L3: EvidenceCollector (Phase 0 证据采集) */
  evidenceCollector?: EvidenceCollector;
  /** L4: GraphBridge (Phase 1 自动写入本体图) */
  graphBridge?: ReturnType<typeof createGraphBridge>;
  /** L2: ExpertRouter (多专家路由协调者) */
  expertRouter?: import('../l2/expert-router').ExpertRouter;
  /** L4: ReportGraphAdapter (Phase 4 报告从图读取) */
  reportAdapter?: ReportGraphAdapter;
  /** L3: CorroborationEngine (Phase 3 矛盾检测+交叉验证) */
  corroborationEngine?: CorroborationEngine;
  /** L3: DecisionCapture callback (Phase 5 用户确认/驳回根因) */
  onDecision?: (decision: DecisionInput) => Promise<DecisionResult>;
  /** L4: GraphStore (for diagnosis graph queries + entity resolution) */
  graphStore?: GraphStore;
  /** L4: enable automated entity resolution after diagnosis (Phase 3a) */
  enableEntityResolution?: boolean;
  /** L4: enable community reports after GraphBridge sync (Phase 2b) */
  enableCommunityReports?: boolean;
  /** L4: enable triple reflection after diagnosis (Phase 3b) */
  enableTripleReflection?: boolean;
  /** 铁律 39: L2 通过 DiagnosisEngine 接口调用引擎 */
  diagnosisEngine?: import('../l2-interfaces/diagnosis-engine').DiagnosisEngine;
  /** v3.3: L4 AgentMemoryStore — 加载已确认判断 */
  memoryStore?: import('../l4/agent-memory-store').AgentMemoryStore;
  /** FED-001: 联邦进化适配器 */
  federalAdapter?: import('../adapters/federal-adapter').FederalAdapter;
  /** P1 Phase Gate Check: 证据和专家状态跟踪 (供 onPhaseEnter 回调读取) */
  phaseGateTracking?: { evidenceCount: number; expertResults: Array<{ expertType: string; confidence: number; hypothesis: string; degraded?: boolean }> };
  /**
   * #1075 P2-2: 岗位人设面（`loadRolePackPersona()` 产出的已解析包）。
   * 缺省 / `null` ⇒ 不注入岗位层（提示词逐字等于无包基线 —— 判据 J3）；**不传** ⇒ 与修复前行为一致。
   * 会话内变更走 `setRolePack()`（每轮刷新），不重建引擎。
   */
  rolePack?: RolePackPersona | null;
}

export interface ProcessResult {
  /** Agent 回复文本 */
  reply: string;
  /** Phase 0 是否完成，可以推进到 Phase 1 */
  phaseComplete: boolean;
}

export type EngineState = {
  orgId: string;
  phase: number;
  messages: LLMMessage[];
  startedAt: string;
  /**
   * #1075 P2-2: 会话绑定的岗位 id（**只存归属**，人设文本不落库 —— 每轮从磁盘重解析）。
   * 仅当引擎持有岗位人设时由 `serialize()` 写入；无包会话**不写该键**（保 J3 基线形态）。
   */
  rolePackId?: string;
}

/** @deprecated 使用 EngineState。保留用于 TUI/CLI 后向兼容。 */
export type ConversationState = EngineState;

// ═══ Hermes P0-2: 三层系统提示 — DeepSeek Prefix Cache 优化 ═══
//
// 层 1: 稳定层 — 会话期间不变 (Prefix Cache 命中)
// 层 2: 上下文层 — Phase 变化时更新
// 层 3: 易变层 — 每轮更新 (放在 user message 前, 不影响 Cache)
// 参考: Hermes system_prompt.py build_system_prompt() 三层组装
//
// Slice 0-2: L0 全局身份层移到 l0-global-prompt.ts，此文件只保留 L1 对话层。
// 构建时由 buildSystemPrompt() 自动将 L0 + L1 + 上下文拼接。

import { L0_GLOBAL_PROMPT } from '../l1/l0-global-prompt';

const L1_DIALOG_LAYER = `## 你的角色
你是 Synova 的前线交互界面。你的对话对象有两种：
1. GA（Growth Advisor，增长顾问）——专业用户，直接操作工具
2. 企业主/决策者——需要看到结论，不需要了解技术细节

## 三阶段对话流

### 阶段A：信息采集（八维度框架）
GA采访时你不在场。采访结束后GA上传记录文档，你做：
- 解析文档→按八维度提取关键信息
- 输出覆盖度报告（✅ 4/8够用 ⚠️ 2/8偏弱 ❌ 2/8缺失）
- 覆盖度不足→提示GA补充哪些维度
- 不要猜——信息不足的维度标注"待补充"而非用默认值填充

### 阶段B：诊断演示（GA和客户一起看）
- 六/七专家并行启动，过程对客户可见
- 每个专家输出结论摘要→综合器交叉验证→四层报告
- 演示结束后客户带走报告
- 客户可以对报告对话修改（调深度、删敏感、翻英文）

### 阶段C：持续监测（部署后）
- 哨兵 7×24 运行
- 异常信号→关联→推送到客户看板
- GA 定期回访

## 交互规则
- 对GA：简洁、高效、多客户管理视角。GA是专家用户。
- 对企业主：结论先行、解释后行、可对话修改报告
- 永远不让用户猜"系统还需要什么"——直接告诉他还差什么
- 对话中不要主动提及技术术语（"六维模型""测量器""D1-D6"）`;

function buildContextLayer(phase: number): string {
  switch (phase) {
    case 0:
      return `## 当前阶段：Phase 0（组织访谈）
你要做的是：
1. 了解组织名称、规模、行业
2. 了解当前最关心的问题/痛点
3. 了解组织架构（团队数量、关键角色）
4. 确认诊断深度和范围

## 对话规则
- 每个问题附带"为什么这么问"
- 形成假设时邀请反驳："我的初步判断是……但可能判断错了"
- 用户连续表达相似意思时，主动问"需要我开始诊断吗？"
- 覆盖 ≥4 维度可建议结束访谈`;
    case 1:
      return `## 当前阶段：Phase 1（数据采集）
系统正在从连接的数据源采集信息。继续与用户对话，引导提供更多细节。`;
    default:
      return `## 当前阶段：Phase ${phase}
继续诊断分析，基于已有信息推进。`;
  }
}

/** GNS: 根据维度覆盖生成动态追问提示 */
function buildCoverageContext(
  coverage: Map<string, { status: string; confidence: number; evidenceCount: number }>,
  dimensionRegistry?: { get(id: string): { name: string } | undefined } | null,
): string {
  if (!coverage || coverage.size === 0) return '';
  const covered = [...coverage.entries()].filter(([, v]) => v.status === 'covered');
  const partial = [...coverage.entries()].filter(([, v]) => v.status === 'partial');
  const uncovered = DIMENSION_NAMES.filter(d => !coverage.has(d));

  const lines: string[] = [];
  if (covered.length > 0) {
    lines.push(`已了解: ${covered.map(([k]) => dimensionRegistry?.get(k)?.name || k).join('、')}`);
  }
  if (partial.length > 0) {
    lines.push(`部分了解: ${partial.map(([k]) => dimensionRegistry?.get(k)?.name || k).join('、')}`);
  }
  if (uncovered.length > 0) {
    lines.push(`待了解: ${uncovered.map(k => dimensionRegistry?.get(k)?.name || k).join('、')}`);
  }
  if (covered.length >= 4) {
    lines.push('信息已较充分——可以建议用户开始诊断。');
  } else if (partial.length > 0 || uncovered.length > 0) {
    const next = partial[0]?.[0] || uncovered[0] || '';
    const name = dimensionRegistry?.get(next)?.name || next;
    lines.push(`优先追问: ${name}`);
  }
  return lines.join('\n');
}

/** 八维度名称 (fallback，无 DimensionRegistry 时使用) */
const DIMENSION_NAMES = [
  'mission_objectives', 'business_value', 'current_state',
  'resource_constraints', 'risk_bottlenecks', 'success_criteria',
  'market_positioning', 'digital_foundation',
];

function buildVolatileLayer(turnCount: number, phase: number, teamId?: string): string {
  let sentinelInfo = '';
  if (teamId && turnCount === 1) {
    try {
      const runner = getGlobalSentinelRunner();
      if (runner) {
        const stats = runner.getStats();
        if (stats.totalFindings > 0) {
          sentinelInfo = `\n[哨兵监测]: ${stats.totalFindings} 条发现 (critical: ${stats.criticalFindings}, warning: ${stats.warningFindings})`;
        }
      }
    } catch (err) { log.warn({ err }, '哨兵数据不可用 — degraded'); }
  }
  return `[轮次: ${turnCount}] [阶段: ${phase}/5]${sentinelInfo}`;
}

/**
 * Hermes P0-2 三层系统提示组装（稳定层 L0 ＋ 对话层 L1 ＋ [岗位层] ＋ 相位层 ＋ 覆盖度层）。
 *
 * #1075 P2-2: 岗位人设层插在 **L1 之后、相位层之前**（顺序契约，判据 J1a）。
 *   `buildRoleLayer()` 是纯核（零 IO／不抛）；`null`／`undefined` 入参由**本函数**挡在外面
 *   （该函数签名只收 `RolePackPersona`）—— 无包时数组项为 `''`，经 `filter(Boolean)` 消失
 *   ⇒ 分隔符不会多出一段（J3 逐字基线的成立前提）。
 *
 * @input  phase／turnCount／coverage／dimensionRegistry（既有语义不变）；rolePack——已解析人设面
 * @output system prompt 字符串（段间固定 `'\n\n---\n\n'`）
 * @degraded 岗位层为空（无包／撤岗／回滚开关 off）⇒ 该段缺席，不是错误
 */
function buildSystemPrompt(
  phase: number, turnCount: number,
  coverage?: Map<string, { status: string; confidence: number; evidenceCount: number }>,
  dimensionRegistry?: { get(id: string): { name: string } | undefined } | null,
  rolePack?: RolePackPersona | null,
): string {
  const context = buildContextLayer(phase);
  const covText = coverage ? buildCoverageContext(coverage, dimensionRegistry) : '';
  const roleLayer = rolePack ? buildRoleLayer(rolePack) : '';
  return [
    L0_GLOBAL_PROMPT,
    L1_DIALOG_LAYER,
    roleLayer,
    context,
    covText,
  ].filter(Boolean).join('\n\n---\n\n');
  // 易变层不放入 system prompt — 追加到 user message 末尾保护 Cache
}

// ═══ D363: Provider Failover 接线 ═══

/**
 * D363: 将单 provider 包装为运行时 failover chain（保持 LLMProvider 契约）。
 *
 * 输入:
 *   primary  — 主 provider（构造时注入，保持原接口不变）
 *   fallback — 备用 provider；null/undefined → 不包装，原样返回 primary
 * 输出:
 *   LLMProvider — chain 包装（name=chain(主→备)，baseUrl 继承主）；无备用时 = primary 原实例
 * 降级:
 *   - 无备用 → 返回原 provider，行为与修复前完全一致（零包装开销）
 *   - chain 的 healthCheck 返回数组（多 provider 体检），本函数聚合为单值
 *     HealthCheckResult（LLMProvider 契约，context-engine.ts:274 isLLMAvailable
 *     依赖 result.healthy）— 任一 provider 健康即视为链可用（failover 语义），
 *     全不健康返回主 provider 的失败详情
 *   - 全部 provider 失败 → chat/stream 抛"所有 Provider 均失败"（含全部失败名，不静默）
 */
export function wrapProviderWithFailover(
  primary: LLMProvider,
  fallback: LLMProvider | null | undefined,
): LLMProvider {
  if (!fallback) return primary;
  const chain = createProviderChain([primary, fallback]);
  return {
    name: chain.name,
    baseUrl: chain.baseUrl,
    chat: chain.chat,
    stream: chain.stream,
    listModels: chain.listModels,
    // healthCheck 契约适配: chain 返回数组，LLMProvider 要求单值 HealthCheckResult
    healthCheck: async (): Promise<HealthCheckResult> => {
      const results = await chain.healthCheck();
      const ok = results.find(r => r.healthy);
      if (ok) return ok;
      return results[0] ?? { healthy: false, error: 'ProviderChain 无 provider 体检结果' };
    },
  };
}

/**
 * D363: 从环境变量派生备用 provider（主 provider 类型决定备用方向）。
 *
 * 输入:
 *   primary — 主 provider（按 baseUrl 经 detectProviderFromUrl 判定类型）
 * 输出:
 *   LLMProvider | null — 备用 provider；无凭据 → null
 * 规则:
 *   主 = deepseek → 备 = openai（需 OPENAI_API_KEY）
 *   主 ≠ deepseek（openai/qwen/gateway 等）→ 备 = deepseek（需 LLM_API_KEY 或 DEEPSEEK_API_KEY）
 * 降级: 备用凭据缺失 → 返回 null + log.info 显式记录（failover 未启用），绝不静默；
 *       调用方（constructor）保持单 provider 行为不变。
 */
export function buildFallbackProvider(primary: LLMProvider): LLMProvider | null {
  const primaryKind = detectProviderFromUrl(primary.baseUrl);
  if (primaryKind === 'deepseek') {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      log.info('无 OPENAI_API_KEY 备用凭据 — failover 未启用（保持单 provider）');
      return null;
    }
    return createProvider('openai', { apiKey: openaiKey });
  }
  const deepseekKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    log.info('无 DeepSeek 备用凭据 — failover 未启用（保持单 provider）');
    return null;
  }
  return createProvider('deepseek', { apiKey: deepseekKey });
}

// ═══ ConversationEngine ═══

export class ConversationEngine {
  private provider: LLMProvider;
  private messages: LLMMessage[];
  private phase: number;
  private orgId: string;
  private turnCount: number;
  private config: Required<EngineConfig>;
  private toolRegistry: ToolRegistry;
  private viewAdapter: ViewAdapter | null = null;

  // 编排层组件 (Iter 3-5 接线)
  private intentRouter: IntentRouter | null = null;
  private expertRouter: import('../l2/expert-router').ExpertRouter | null = null;
  private dimensionRegistry: DimensionRegistry | null = null;
  private hookRunner: HookRunner | null = null;
  private sessionManager: SessionManager | null = null;
  private eventBus: EventBus | null = null;
  private phaseStateMachine: PhaseStateMachine | null = null;
  private piiScrubber: PIIScrubber | null = null;
  private evidenceCollector: EvidenceCollector | null = null;
  private graphBridge: ReturnType<typeof createGraphBridge> | null = null;
  private reportAdapter: ReportGraphAdapter | null = null;
  private corroborationEngine: CorroborationEngine | null = null;
  private onDecision: ((decision: DecisionInput) => Promise<DecisionResult>) | null = null;
  private sessionId: string = '';
  private phaseGateTracking: { evidenceCount: number; expertResults: Array<{ expertType: string; confidence: number; hypothesis: string; degraded?: boolean }> } | null = null;
  // L4 本体层组件
  private graphStore: GraphStore | null = null;
  private memoryStore: import('../l4/agent-memory-store').AgentMemoryStore | null = null;
  private enableEntityResolution: boolean = false;
  private enableCommunityReports: boolean = false;
  private enableTripleReflection: boolean = false;
  /** 维度覆盖追踪 (Phase 0) */
  private dimensionCoverage: Map<string, { status: string; confidence: number; evidenceCount: number }> = new Map();

  /**
   * #1075 P2-2: 当前会话的岗位人设面（`null` = 无岗位/已撤岗）。
   * 构造期由 `EngineConfig.rolePack` 初始化，之后只经 `setRolePack()` 变更（幂等）。
   */
  private rolePack: RolePackPersona | null = null;

  /**
   * #1075 P2-4a: 本会话**已绑定**的岗位 id —— **唯一"是否已绑定"真源**（`null` = 从未绑定）。
   * 不依赖外部 state：`fromState()` 先从快照恢复本字段，再交 `setRolePack()` 处理人设三态。
   * `setRolePack(null)`（复核失败/撤岗）**不清空**本字段 —— D12 靠"已绑定 + persona=null"判 fail-closed。
   */
  private boundRolePackId: string | null = null;

  /**
   * #1075 P2-4a: 待应用白名单的岗位 id（惰性应用标记；`null` = 无待应用）。
   * 三路注入只置本标记，`ensurePermissionsApplied()`／`refreshRolePackPermissions()` 才真正编译＋下发。
   */
  private pendingRolePackId: string | null = null;

  /**
   * #1075 P2-4b-B: 角色会话知识过滤面（**运行期状态**；`null` = 本会话无系统知识工具）。
   *
   * 三态（规格 §2.2-D4/D7）:
   *   · 未绑定岗位（`boundRolePackId === null`）⇒ `null`（无 provider ⇒ 工具不存在，零变化）；
   *   · 已绑定且人设可用 ⇒ `buildRoleKnowledgeFilter(...)` 的编译结果（ok:false ⇒ 拒绝型）；
   *   · 已绑定但 persona=null（复核失败/撤岗）⇒ **拒绝型**（`pkb_domain IN []`：工具仍在，0 结果）。
   * 回滚开关 `SYNOVA_ROLE_KNOWLEDGE=off` ⇒ `null` ＋ provider 卸载（与 `SYNOVA_ROLE_PACK_TOOLS` 互相独立）。
   */
  private roleKnowledgeFilter: RoleKnowledgeFilter | null = null;

  // P1-01: 子组件提取
  private toolLoop: ToolLoopExecutor;
  private diagnosisLauncher: DiagnosisLauncher;
  private ontologySyncer: OntologySyncer;
  private contextEngine: ContextEngine;
  /** D594: 会话级上下文压缩（threshold/retain + 压缩事件 + 溢出恢复） */
  private readonly compaction: ContextCompaction;
  /**
   * 运行期共享上下文（ToolLoopExecutor／DiagnosisLauncher／OntologySyncer 同一实例）。
   * #1075 P2-2: 保留引用是为了 `setRolePack()` 能把 `engineCtx.messages` 重新对齐到
   * `this.messages` —— `fromState()` 恢复时会**换掉** `this.messages` 数组，不同步则
   * LLM 调用仍读旧数组（看不到重建的 system 层，人设注入在恢复会话上失效）。
   */
  private readonly engineCtx: EngineContext;

  constructor(provider: LLMProvider, config: EngineConfig = {}) {
    // D363: 运行时 failover 接线 — 注入的单 provider 包装为 failover chain。
    // tool-loop-executor 消费的 ctx.provider（经 engineCtx 注入）自动获得
    // "主 provider 失败 → 切换备用"能力；无备用（显式 null 或凭据缺失）时
    // 保持原 provider，行为与修复前完全一致。
    // D594: 上下文压缩 — 溢出恢复包装在 failover chain 内侧（registry chain 会把
    // provider 错误归一为普通 Error 重新抛出，wrapper 必须先于 chain 看到原始错误码）；
    // 摘要器惰性经 failover chain（this.provider 就绪后可用），复用同一 KV-cache 前缀。
    this.compaction = new ContextCompaction({
      contextWindowTokens: config.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
      summarizer: {
        summarize: (prefix) => createProviderSummarizer(this.provider).summarize(prefix),
      },
    });
    this.provider = wrapProviderWithFailover(
      wrapProviderWithOverflowRecovery(provider, this.compaction),
      config.fallbackProvider !== undefined ? config.fallbackProvider : buildFallbackProvider(provider),
    );
    this.phase = 0;
    this.orgId = typeof config.orgId === 'string' ? config.orgId : '';
    this.turnCount = 0;
    this.config = {
      maxTurns: config.maxTurns ?? 6,
      orgId: typeof config.orgId === 'string' ? config.orgId : '',
      contextWindowTokens: config.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    } as Required<EngineConfig>;
    // #1075 P2-2: 岗位人设必须在首条 system 组装**之前**就位（否则首轮提示词缺人设）
    this.rolePack = config.rolePack ?? null;
    // #1075 P2-4a: 构造期**只记绑定／待应用**，不即时编译白名单（D11：工具在 registerBuiltinTools()
    // 之后才注册，此刻注册表必为空 —— 按空表算会把声明全判未落地 ⇒ 首轮全拒）。
    this.boundRolePackId = config.rolePack?.roleId ?? null;
    this.pendingRolePackId = this.boundRolePackId;
    this.messages = [{ role: 'system', content: buildSystemPrompt(0, 0, this.dimensionCoverage, this.dimensionRegistry, this.rolePack) }];
    this.toolRegistry = new ToolRegistry();

    // 编排层接线: 接收可选组件
    this.intentRouter = config.intentRouter || null;
    this.expertRouter = config.expertRouter || null;
    this.dimensionRegistry = config.dimensionRegistry || null;
    this.hookRunner = config.hookRunner || null;
    this.sessionManager = config.sessionManager || null;
    this.eventBus = config.eventBus || null;
    this.phaseStateMachine = config.phaseStateMachine || null;
    this.piiScrubber = config.piiScrubber || null;
    this.evidenceCollector = config.evidenceCollector || null;
    this.graphBridge = config.graphBridge || null;
    this.reportAdapter = config.reportAdapter || null;
    this.corroborationEngine = config.corroborationEngine || null;
    this.onDecision = config.onDecision || null;
    this.sessionId = config.sessionId || '';
    // P1 Phase Gate Check: 证据/专家状态跟踪
    this.phaseGateTracking = config.phaseGateTracking || null;
    this.contextEngine = new ContextEngine({ provider: this.provider });
    // L4 本体层接线
    this.graphStore = config.graphStore || null;
    this.memoryStore = config.memoryStore || null;
    this.enableEntityResolution = config.enableEntityResolution ?? false;
    this.enableCommunityReports = config.enableCommunityReports ?? false;
    this.enableTripleReflection = config.enableTripleReflection ?? false;

    // P1-01: 构建共享上下文 + 实例化子组件
    const diagnosisEngine = config.diagnosisEngine || createNoopEngine();
    const engineCtx: EngineContext = {
      provider: this.provider,
      messages: this.messages,
      orgId: this.orgId,
      sessionId: this.sessionId,
      toolRegistry: this.toolRegistry,
      hookRunner: this.hookRunner,
      eventBus: this.eventBus,
      evidenceCollector: this.evidenceCollector,
      corroborationEngine: this.corroborationEngine,
      graphBridge: this.graphBridge,
      graphStore: this.graphStore,
      diagnosisEngine,
      createGraphStore: async (db) => new SqliteGraphStore(db as Database.Database),
      federalAdapter: config.federalAdapter,
      flags: {
        enableCommunityReports: this.enableCommunityReports,
        enableEntityResolution: this.enableEntityResolution,
      },
      loggerPrefix: 'agent',
    };
    // D487: 会话事件 store 注入 — launcher 经 ctx.sessionStore 落诊断事件流
    // （铁律 39: 内联类型注入，EngineContext 接口不加 L5 字段）
    (engineCtx as { sessionStore?: SessionStoreLike }).sessionStore = config.sessionStore;
    // #1075 P2-2: 保留共享上下文引用（`setRolePack()` 需要把 ctx.messages 与本引擎消息数组重新对齐）
    this.engineCtx = engineCtx;
    this.toolLoop = new ToolLoopExecutor(engineCtx);
    this.diagnosisLauncher = new DiagnosisLauncher(engineCtx, diagnosisEngine);
    this.ontologySyncer = new OntologySyncer(engineCtx);
  }

  /** Bind a ViewAdapter for L1 decoupling (Slice C). When set, Engine uses adapter for display. */
  setViewAdapter(adapter: ViewAdapter): void {
    this.viewAdapter = adapter;
  }

  /**
   * K12-08(#191) V1/V6: 注入决策台账回调（**回调，不是 store** —— EC-03 不变）。
   *
   * 用途：会话级引擎由 `fromState` 恢复时不经 `EngineConfig.onDecision`（`fromState` 的 wiring
   * 槽位不含该字段），故装配层需要一条与 `setViewAdapter` 同款的**后置注入**通道。
   * 本方法只存回调引用，不引入任何 L4 运行时依赖（`DecisionInput`/`DecisionResult` 仍是
   * `:34` 的 `import type`）。
   *
   * @input  handler — 装配层（bootstrap）构造的回调；`DecisionResult.recorded=false` 时由
   *                   `recordDecision` 原样回给调用方（失败不静默，铁律 24/31）
   * @output 无
   * @degraded 未注入 / 传 null ⇒ `recordDecision` 回落既有显式失败
   *           `{recorded:false, error:'DecisionCapture callback not configured'}`
   */
  setDecisionCapture(handler: ((decision: DecisionInput) => Promise<DecisionResult>) | null): void {
    this.onDecision = handler;
  }

  /** Phase 5: Record user decision on a root cause node */
  async recordDecision(decision: DecisionInput): Promise<DecisionResult> {
    if (this.onDecision) return this.onDecision(decision);
    return { recorded: false, error: 'DecisionCapture callback not configured' };
  }

  // EC-03: L4 运行时调用已从 ConversationEngine 移除。
  // 所有 L4 操作由 diagnosis-launcher.ts (L2→L3→L4 正确路径) 处理。

  // ═══ Public API ═══

  /** Get current phase (0-5) */
  getPhase(): number {
    return this.phase;
  }

  /** Get organization ID */
  getOrgId(): string {
    return this.orgId;
  }

  /** Set organization ID */
  setOrgId(id: string): void {
    this.orgId = id;
  }

  /** Advance to next phase (Hermes P0-2: 重建 system prompt 以更新上下文层) */
  advancePhase(): void {
    // P1 Loop Engineering: 通过 PhaseStateMachine 驱动，触发 Gate Check 回调
    if (this.phaseStateMachine && this.phaseStateMachine.getState() === 'running') {
      const result = this.phaseStateMachine.advance();
      this.phase = result.phase;
      log.info({ phase: result.phase, label: result.label }, 'PhaseStateMachine 推进 → Gate Check 已触发');
    } else {
      this.phase++;
      log.debug({ phase: this.phase }, 'Phase 推进 (无状态机, 降级)');
    }
    this.messages[0] = { role: 'system', content: buildSystemPrompt(this.phase, this.turnCount, this.dimensionCoverage, this.dimensionRegistry, this.rolePack) };
  }

  /**
   * #1075 P2-2: 刷新本会话的岗位人设并**就地重建** system 层（每轮可调；幂等）。
   *
   * 为什么需要这个方法（规格 §2.2-D8）：路由的会话级引擎缓存命中时不会重建引擎
   * （`src/routes/conversations.ts` 的 `sessionEngines`），若不提供刷新入口，"撤销岗位后
   * 仍一直带人设"与"批准后一直不生效"都无法收敛 —— 每轮重解析 + `setRolePack()` 是唯一落点。
   *
   * 契约：
   *   @input  persona — 已解析的岗位人设面；`null` = 撤岗（提示词回到无包基线）
   *   @output 无返回值。重建用**当前** phase／turnCount／coverage／dimensionRegistry（不重置会话状态）。
   *   @degraded `messages[0]` 非 `role:'system'` ⇒ `log.warn` 并**跳过重建**（不抛 —— 破坏性更小），
   *            同时仍更新 `this.rolePack`（下一轮相位重建会带上新人设）。
   *   @authority 生产唯一调用方 = `src/routes/conversations.ts` 的缓存命中路径；测试直调。
   */
  setRolePack(persona: RolePackPersona | null): void {
    this.rolePack = persona;
    // #1075 P2-4a: 只记绑定／待应用，**不**在此编译白名单（D11：本方法在 registerBuiltinTools() 之前
    // 被调用 ⇒ 按空注册表算会误判全拒；真正的应用在 process 入口 ensurePermissionsApplied()）。
    // persona===null 时**保留** boundRolePackId（D12：已绑定 + persona=null ⇒ 下一轮 fail-closed）；
    // 但"待应用"仍置位（= 已绑定 id），以便下一轮按"复核失败"重新下发（[] 全拒），不沿用旧白名单。
    if (persona !== null) {
      this.boundRolePackId = persona.roleId;
    }
    this.pendingRolePackId = this.boundRolePackId;
    const head = this.messages[0];
    if (head === undefined || head.role !== 'system') {
      log.warn(
        { sessionId: this.sessionId, roleId: persona?.roleId, degraded: true },
        'setRolePack: messages[0] 不是 system 层 — 跳过 system 重建（不抛；本轮不刷新人设）',
      );
      return;
    }
    this.messages[0] = {
      role: 'system',
      content: buildSystemPrompt(this.phase, this.turnCount, this.dimensionCoverage, this.dimensionRegistry, this.rolePack),
    };
    // 🔴 运行期视图对齐：`fromState()` 会把 `this.messages` 换成新数组，而子组件持有的是构造期
    //    engineCtx.messages（旧数组）。不同步 ⇒ 后续 LLM 调用读旧数组，重建的 system 层（含人设）
    //    对模型不可见（J7c 生产恢复路径即此形状）。同数组时本行是幂等 no-op。
    if (this.engineCtx.messages !== this.messages) this.engineCtx.messages = this.messages;
  }

  /**
   * #1075 P2-4a: 强制按**当前** `boundRolePackId` 重编译并下发工具白名单（公开，幂等；测试/守卫入口）。
   *
   * 为什么公开（规格 §2.3-D 末条）：`processMessage*` 入口的惰性应用不便在单测里驱动（要跑 LLM），
   *   `refreshRolePackPermissions()` 提供同一路径的显式触发点，行为与入口完全一致（同一私有实现）。
   *
   * @input  无（读 `boundRolePackId`／`rolePack`／环境开关）
   * @output 无返回值；副作用 = `ToolRegistry.setAllowedTools(...)`（含清 OpenAI 工具缓存）＋留痕日志。
   * @degraded 注册表仍空（本次无法编译）⇒ **保持 `null`（不误全拒）** ＋ `log.warn`，且 pending 保留待下次；
   *           失败/撤岗 ⇒ fail-closed `[]`（D12）＋ warn。
   * @error  永不抛（`loadRolePackPermissions` 同步不抛；本方法只做状态下发）
   */
  refreshRolePackPermissions(): void {
    // #1075 P2-4b-B: 系统知识工具 provider 与白名单**独立**（D9）—— 先注入，
    //   🔴 不得被下面的"注册表空 ⇒ 暂缓编译白名单"早退连带阻断（provider 不看注册表）。
    this.applyRoleKnowledgeProvider();
    // 注册表空（工具尚未注册）⇒ 不编译白名单：缺 knownTools 会把声明全判"未落地" ⇒ 误全拒。
    if (this.boundRolePackId !== null && this.toolRegistry.allToolNames().length === 0) {
      log.warn(
        { roleId: this.boundRolePackId, reason: 'tool-registry-empty', degraded: true },
        '岗位工具白名单暂缓应用 — 注册表仍为空（保持不限制，避免误全拒）',
      );
      return;
    }
    this.applyRolePackPermissions();
    this.pendingRolePackId = null;
  }

  /**
   * #1075 P2-4a: 惰性应用入口 —— `processMessage()`／`processMessageStream()` **首行**调用。
   *
   * @input  无（读 `pendingRolePackId`／`boundRolePackId`）
   * @output 无；`pendingRolePackId` 非空且注册表已注册 ⇒ 编译＋下发并清 pending。
   * @degraded 注册表仍空 ⇒ 保持 `null`（不误全拒）＋ warn，**pending 保留**（下次再试）；
   *           编译失败/撤岗 ⇒ fail-closed `[]`（D12）。
   * @error  永不抛
   */
  private ensurePermissionsApplied(): void {
    if (this.pendingRolePackId === null) return;
    // #1075 P2-4b-B: 系统知识工具 provider 与白名单独立（D9）—— 与注册表状态无关，先注入。
    this.applyRoleKnowledgeProvider();
    if (this.toolRegistry.allToolNames().length === 0) {
      log.warn(
        { roleId: this.pendingRolePackId, reason: 'tool-registry-empty', degraded: true },
        '岗位工具白名单暂缓应用 — 注册表仍为空（保持不限制，避免误全拒；pending 保留）',
      );
      return;
    }
    this.applyRolePackPermissions();
    this.pendingRolePackId = null;
  }

  /**
   * #1075 P2-4b-B: 构建/下发角色会话知识过滤面与**系统工具 provider**（私有；幂等）。
   *
   * 与 `applyRolePackPermissions()` **互相独立**（规格 §2.2-D9）:
   *   · 白名单（`SYNOVA_ROLE_PACK_TOOLS`）只管"岗位声明面内的工具"；
   *   · 本方法（`SYNOVA_ROLE_KNOWLEDGE`）只管系统知识工具 —— 不读 allowlist，也不被 allowlist 为空阻断
   *     （D4b：权限待批时系统知识工具仍可用，敏感度由认证面漏斗天然收窄）。
   *
   * @input  无（读 `boundRolePackId`／`rolePack`／`orgId`／环境开关）
   * @output 无；副作用 = `this.roleKnowledgeFilter` ＋ `setSystemToolProvider(...)`（含清 OpenAI 工具缓存）
   * @degraded 编译失败 ⇒ 拒绝型过滤面（`pkb_domain IN []`，工具可见但 0 结果，不静默）；
   *           回滚开关 off ⇒ provider 卸载（与白名单开关互不替代）
   * @error  永不抛（编译器不抛；本方法只做状态下发）
   */
  private applyRoleKnowledgeProvider(): void {
    // D8 回滚开关：只关角色知识工具（白名单不受影响，反之亦然）
    if (process.env['SYNOVA_ROLE_KNOWLEDGE'] === 'off') {
      this.roleKnowledgeFilter = null;
      this.toolRegistry.setSystemToolProvider(null);
      log.warn(
        { roleId: this.boundRolePackId, switch: 'SYNOVA_ROLE_KNOWLEDGE=off', degraded: true },
        '角色会话知识工具已回滚关闭（D8）— 卸载系统工具 provider',
      );
      return;
    }

    // D4: **从未绑定岗位** ⇒ 无系统知识工具（无岗位会话零变化）
    if (this.boundRolePackId === null) {
      this.roleKnowledgeFilter = null;
      this.toolRegistry.setSystemToolProvider(null);
      return;
    }

    // D7: 已绑定但本轮人设复核失败/撤岗 ⇒ 拒绝型（工具仍在、0 结果），不回落全库
    if (this.rolePack === null) {
      this.roleKnowledgeFilter = buildRejectedKnowledgeFilter('persona-unverified');
      this.toolRegistry.setSystemToolProvider(() => [createKnowledgeSearchTool(() => this.roleKnowledgeFilter)]);
      log.warn(
        { roleId: this.boundRolePackId, reason: 'persona-unverified', degraded: true },
        '岗位已绑定但人设复核失败 — 角色知识过滤面为拒绝型（工具可见、0 结果，D7）',
      );
      return;
    }

    const roleId = this.rolePack.roleId;
    const built = buildRoleKnowledgeFilter(roleId, this.orgId);
    this.roleKnowledgeFilter = built.ok ? built.filter : buildRejectedKnowledgeFilter(`${built.code}: ${built.reason}`);
    this.toolRegistry.setSystemToolProvider(() => [createKnowledgeSearchTool(() => this.roleKnowledgeFilter)]);
    log.info(
      {
        roleId,
        orgId: this.orgId,
        scopes: this.roleKnowledgeFilter.scopes,
        sensitivity: this.roleKnowledgeFilter.sensitivity,
        degraded: this.roleKnowledgeFilter.degraded,
      },
      '角色会话知识工具已注入（系统工具：不进 allowlist／allToolNames，D1）',
    );
  }

  /**
   * #1075 P2-4a: 白名单编译＋下发（私有；入参只读字段，无外部状态）。
   *
   * 判定顺序（规格 §2.2）：D8 回滚开关 → 未绑定（D12 恢复）→ 已绑定复核失败（D12 fail-closed）→
   *   编译（`knownTools` **必须**是原始清单 `allToolNames()`，禁 `listTools()` —— 后者被白名单过滤，
   *   会把"声明且已注册"误判未落地，规格 §2.3-B.5）→ ok 下发 allowlist／失败 fail-closed。
   *
   * @input  无
   * @output 无；副作用 = `setAllowedTools(allowlist | [] | null)` ＋ 留痕
   * @degraded permissionsPending（D4）⇒ allowlist 已为空（模块保证），本方法另留一条"权限待批" warn；
   *           disabled／declaredUnavailable 非空 ⇒ 各一条 warn（显式可见，不静默丢弃）。
   * @error  永不抛
   */
  private applyRolePackPermissions(): void {
    // D8 回滚开关：全局关闭包模式（显式降级，铁律 11/31）
    if (process.env['SYNOVA_ROLE_PACK_TOOLS'] === 'off') {
      this.toolRegistry.setAllowedTools(null);
      log.warn(
        { roleId: this.boundRolePackId, switch: 'SYNOVA_ROLE_PACK_TOOLS=off', degraded: true },
        '岗位工具白名单已回滚关闭（D8）— 恢复既有执行门行为',
      );
      return;
    }

    // D12 两义之一：**从未绑定** ⇒ 恢复既有行为（无岗位会话零变化，J6）
    if (this.boundRolePackId === null) {
      this.toolRegistry.setAllowedTools(null);
      return;
    }

    // D12 两义之二：**已绑定**但本轮人设复核失败／撤岗（persona===null）⇒ fail-closed（不得全放行）
    if (this.rolePack === null) {
      this.toolRegistry.setAllowedTools([]);
      log.warn(
        { roleId: this.boundRolePackId, reason: 'persona-unverified', degraded: true },
        '岗位已绑定但人设复核失败 — 工具白名单 fail-closed（全拒，D12）',
      );
      return;
    }

    const result = loadRolePackPermissions(this.boundRolePackId, {
      knownTools: this.toolRegistry.allToolNames(),
    });
    if (!result.ok) {
      // 审批未过／内容变更／能力非法 ⇒ 不生效（fail-closed），与 P2-2 同级降级：不抛
      this.toolRegistry.setAllowedTools([]);
      log.warn(
        { roleId: this.boundRolePackId, code: result.code, reason: result.reason, degraded: true },
        '岗位工具权限编译失败 — fail-closed（全拒，D12）',
      );
      return;
    }

    const permissions = result.permissions;
    this.toolRegistry.setAllowedTools(permissions.allowlist);
    // D4：权限待批（内容已批、权限未批）⇒ allowlist 已空；另留一条点名，避免"静默全拒"
    if (permissions.permissionsPending) {
      log.warn(
        { roleId: permissions.roleId, scope: permissions.scope, permissionsPending: true, degraded: true },
        '岗位权限待批 — 工具白名单为空（D4：内容已批，权限未批）',
      );
    }
    // 禁用项：硬拒且点名能力 id（J3）；未落地项：显式可见、不放行（J4 口径，engine 侧同源留痕）
    if (permissions.disabled.length > 0) {
      log.warn(
        { roleId: permissions.roleId, disabled: permissions.disabled, count: permissions.disabled.length },
        '岗位包禁用能力 — 硬拒（disabled 优先，不静默放行）',
      );
    }
    if (permissions.declaredUnavailable.length > 0) {
      log.warn(
        { roleId: permissions.roleId, declaredUnavailable: permissions.declaredUnavailable, degraded: true },
        '岗位包声明的工具未落地 — 显式可见但不放行（内容批待跟进）',
      );
    }
    log.info(
      { roleId: permissions.roleId, scope: permissions.scope, allowlist: permissions.allowlist },
      '岗位工具白名单已应用（只放行声明∩已注册）',
    );
  }

  /** Get message history (shallow copy) */
  getMessages(): LLMMessage[] {
    return [...this.messages];
  }

  /** Get tool registry for registration/inspection */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  // ═══ GNS v2.0: Phase 0 访谈摘要持久化 ═══

  private async persistInterviewSummary(coveredCount: number): Promise<void> {
    if (!this.graphStore) return;
    try {
      const dimensions: Record<string, { summary: string; keyPoints: string[]; confidence: number }> = {};
      for (const [id, cov] of this.dimensionCoverage) {
        const msgs = this.messages
          .filter(m => m.role === 'user')
          .map(m => m.content);
        dimensions[id] = {
          summary: msgs.slice(-3).join('; ').slice(0, 200),
          keyPoints: msgs.filter(m => m.includes(id)).slice(0, 3),
          confidence: cov.confidence,
        };
      }
      // Use GOAL node as InterviewSummary carrier (v2.0: type='InterviewSummary')
      this.graphStore.createNode(
        'Goal' as unknown as Parameters<typeof this.graphStore.createNode>[0],
        {
          name: `Phase0_Interview_${this.orgId}_${Date.now().toString(36)}`,
          description: `Phase 0 访谈摘要 — ${coveredCount}/6 维度已覆盖`,
          goalType: 'mission' as unknown as string,
          progress: coveredCount / 6,
        },
        typeof this.orgId === 'string' && this.orgId !== '' ? this.orgId : 'default',
      );
      log.info({ coveredCount, orgId: this.orgId }, 'Phase 0 访谈摘要已持久化');
    } catch (err: any) {
      log.warn({ err }, 'InterviewSummary 持久化失败');
    }
  }

  // ═══ SOG Ontology Sync (delegated to OntologySyncer) ═══

  async syncToSOG(): Promise<OntologySyncResult> {
    return this.ontologySyncer.syncToSOG();
  }

  /** Get current ontology summary (for TUI side panel) */
  getOntologySummary(): OntologySyncResult {
    // Return cached last-sync result
    return this._lastOntologyResult || { persons: 0, teams: 0, teamCount: 0, created: false };
  }

  private _lastOntologyResult: OntologySyncResult | null = null;

  /**
   * Process a user message synchronously (non-streaming).
   *
   * Phase 0: structured interview with turn limit.
   * Phase 1-5: tool-call loop.
   *
   * #915 Q-5 契约扩展（铁律 47）:
   *   @input  userInput；opts?: { signal?: AbortSignal }（取消信号；SYNO_TOOL_ABORT=0
   *           ⇒ 引擎忽略 signal 且不传给工具循环 = 回旧行为，单一谓词 isToolAbortEnabled）
   *   @output 入场已取消 ⇒ { reply: TOOL_CANCELLED_REPLY, phaseComplete: false }（不发 LLM，S11）
   *   @degraded 取消是控制流：不设 degraded；log.info 留痕一次
   *   @error  不抛（取消结果化）
   *
   * @returns ProcessResult with reply text and phase completion signal
   */
  async processMessage(userInput: string, opts?: { signal?: AbortSignal }): Promise<ProcessResult> {
    // #1075 P2-4a: 入口首行惰性应用岗位工具白名单（D11：绑定早于工具注册，注册表已就绪才编译）
    this.ensurePermissionsApplied();
    // #915 Q-5: 入口取消检查（开关关 ⇒ signal 视同未传，回旧行为）
    const signal = isToolAbortEnabled() ? opts?.signal : undefined;
    if (signal?.aborted) {
      log.info({ code: 'TOOL_ABORTED' }, 'processMessage 入场即取消 — 返回取消文案（控制流，非降级）');
      return { reply: TOOL_CANCELLED_REPLY, phaseComplete: false };
    }
    // Phase 1.2: 注册活跃会话到优雅关闭追踪
    if (this.sessionId) {
      try { getGlobalGracefulShutdown().noteActive(this.sessionId, { orgId: this.orgId, phase: this.phase }); }
      catch (err) { log.warn({ err }, '优雅关闭注册失败 — 非阻断'); }
    }
    this.turnCount++;
    // PII 脱敏: 出站到云 LLM 前脱敏 (S4移除 + S3脱敏 + S2角色掩盖)
    const input = this.piiScrubber?.scrub(userInput, 'S2').cleaned ?? userInput;
    // Hermes P0-2: 易变层追加到 user message — 保护 Prefix Cache
    this.messages.push({ role: 'user', content: `${input}\n\n${buildVolatileLayer(this.turnCount, this.phase)}` });

    // D594: 长会话压力压缩（DSH agent/pre-step 范式）— 超阈值先压缩再调用 LLM。
    // 失败 warn 降级继续本轮（铁律 24/31: 不阻断对话）。
    try {
      const compacted = await this.compaction.compactIfNeeded(this.messages, 'pressure');
      if (compacted) {
        log.info({ shadowedMessageCount: compacted.shadowedMessageCount, shadowedTokenCount: compacted.shadowedTokenCount }, '长会话触发上下文压缩');
      }
    } catch (err) {
      const code = err instanceof ContextCompactionError ? err.code : 'UNKNOWN';
      log.warn({ err, code }, '压力压缩失败 — 继续本轮对话（降级不阻断）');
    }

    // G1: 上下文可插拔引擎 — 文件驱动策略，LLM 不可用降级
    const estimatedTokens = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    if (this.contextEngine.shouldCompress(this.messages, estimatedTokens)) {
      try {
        const confirmedFacts = await this.loadConfirmedFacts();
        const result = await this.contextEngine.compress(this.messages, estimatedTokens, confirmedFacts);
        // D594: 原地替换 — engineCtx.messages 与 this.messages 共享同一数组引用，
        // reassign 会脱钩（toolLoop / 压缩引擎将看到旧数组）
        this.messages.splice(0, this.messages.length, ...result.messages);
        log.debug({
          before: result.messages.length + result.stats.discardedCount,
          after: result.messages.length,
          degraded: result.stats.degraded,
        }, '上下文已压缩');
      } catch (err: unknown) {
        log.warn({ err }, '上下文压缩失败 — 非阻断');
      }
    }

    // L3 接线: EvidenceCollector — Phase 0 证据自动采集
    if (this.phase === 0 && this.evidenceCollector) {
      this.evidenceCollector.collectFromInterview(
        typeof this.orgId === 'string' && this.orgId !== '' ? this.orgId : 'default', this.sessionId, [userInput],
      );
    }

    // Phase 0: 顾问式访谈 (Iter 3 接线 — 意图路由 + 维度覆盖)
    if (this.phase === 0) {
      // 意图分类 (9分支) — LLM驱动的顾问式对话
      if (this.intentRouter) {
        try {
          const intent = await this.intentRouter.classify(
            userInput,
            this.messages.filter(m => m.role === 'user').map(m => m.content),
          );
          if (intent.category === 'diagnostic' && intent.signals && this.dimensionRegistry) {
            const dims = this.dimensionRegistry.selectBySignals(intent.signals);
            for (const d of dims) {
              const existing = this.dimensionCoverage.get(d.id);
              if (!existing || existing.status === 'uncovered') {
                this.dimensionCoverage.set(d.id, { status: 'partial', confidence: 0.5, evidenceCount: 1 });
              } else {
                existing.evidenceCount++;
                if (existing.evidenceCount >= 2) {
                  existing.status = 'covered';
                  existing.confidence = Math.min(1, existing.confidence + 0.25);
                }
              }
            }
            // D500: 传 sessionId 使事件可归属（model-visible⟺logged 根基；无 id 时走内存态兼容）
            this.sessionManager?.addMessage({ role: 'user', content: userInput }, this.sessionId);
          }
        } catch (err: any) { log.warn({ err: err.message }, '意图分类失败，降级为原有轮次逻辑'); }
      }

      const coveredCount = [...this.dimensionCoverage.values()].filter(d => d.status === 'covered').length;
      const explicitComplete = this.detectPhaseComplete(userInput);
      const turnLimitReached = this.turnCount >= this.config.maxTurns;
      // 无 IntentRouter 时跳过维度覆盖要求 — 纯轮次+显式完成判断
      const dimensionsReady = this.intentRouter ? coveredCount >= 4 : true;
      const minTurns = this.intentRouter ? Math.min(3, this.config.maxTurns) : 2;

      // 用户想结束但维度不够 → 告知缺失，不结束
      if (explicitComplete && !dimensionsReady && this.turnCount >= minTurns) {
        const missing = [...this.dimensionCoverage.entries()]
          .filter(([, v]) => v.status !== 'covered').slice(0, 3)
          .map(([k]) => this.dimensionRegistry?.get(k)?.name || k).join('、');
        const reply = `感谢分享！诊断之前还想了解${missing || '一些补充信息'}——这对更准确的诊断结果很重要。`;
        this.messages.push({ role: 'assistant', content: reply });
        return { reply, phaseComplete: false };
      }

      if ((explicitComplete || turnLimitReached) && dimensionsReady && this.turnCount >= minTurns) {
        this.eventBus?.emit({
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
          type: 'phase.completed', consultationId: this.sessionId, phase: 0,
          data: { coveredDimensions: coveredCount, totalRounds: this.turnCount },
          traceId: this.sessionId, spanId: this.sessionId.slice(0, 16),
          timestamp: new Date().toISOString(),
        });

        const reply = '感谢你提供的信息！我已收集到足够的组织概况。现在开始运行六阶段诊断分析...';
        this.messages.push({ role: 'assistant', content: reply });
        // Batch 2: PhaseStateMachine 驱动 — 替代硬编码 phase=1
        if (this.phaseStateMachine) {
          const next = this.phaseStateMachine.advance();
          this.phase = next.phase;
          log.info({ nextPhase: next.phase, label: next.label }, '状态机推进 → Phase 0 完成');
        } else {
          this.phase = 1;
        }

        // GNS v2.0: Phase 0 完成 → 持久化 InterviewSummary 到 GraphStore
        this.persistInterviewSummary(coveredCount).catch(err => {
          log.warn({ err }, 'InterviewSummary 持久化失败 — degraded');
        });
        // Slice 5.1: 自动同步 SOG 本体
        this.syncToSOG().then(r => { this._lastOntologyResult = r; }).catch((err) => {
          log.warn({ err }, 'SOG 本体同步失败 — degraded');
        });

        // 审计 P0-20260620: Phase 0 完成后自动启动诊断管线
        // D487: 发起人表述统一 GA（Growth Advisor，增长顾问）；前身称谓已退役
        this.startDiagnosis('GA', '用户').then(result => {
          if (result) {
            log.info({ teamId: result.teamId, durationMs: result.totalDurationMs }, '诊断管线已完成');
          }
        }).catch(err => {
          log.warn({ err }, '诊断管线启动失败 — degraded');
        });

        return { reply, phaseComplete: true };
      }

      const reply = await this.callLLMWithTools(signal);
      this.messages.push({ role: 'assistant', content: reply });
      return { reply, phaseComplete: false };
    }

    // Phase 1-5: 工具调用循环
    const reply = await this.callLLMWithTools(signal);
    this.messages.push({ role: 'assistant', content: reply });
    return { reply, phaseComplete: false };
  }

  /**
   * Process a user message with streaming token output.
   *
   * Each token is pushed to onToken() as it arrives.
   * Tool calls are executed inline — tool names are streamed as annotations.
   *
   * @param userInput - Raw user input text
   * @param onToken   - Callback invoked for each text/tool token
   * @param opts      - #915 Q-5: { signal?: AbortSignal }（SYNO_TOOL_ABORT=0 ⇒ 忽略 = 回旧行为；
   *                    入场已取消 ⇒ 返回 TOOL_CANCELLED_REPLY，不发 LLM；取消不设 degraded）
   * @returns ProcessResult with full reply and phase completion signal
   */
  async processMessageStream(
    userInput: string,
    onToken: (token: string) => void,
    opts?: { signal?: AbortSignal },
  ): Promise<ProcessResult> {
    // #1075 P2-4a: 入口首行惰性应用岗位工具白名单（与 processMessage 同源：D11）
    this.ensurePermissionsApplied();
    // #915 Q-5: 入口取消检查（开关关 ⇒ signal 视同未传，回旧行为）
    const signal = isToolAbortEnabled() ? opts?.signal : undefined;
    if (signal?.aborted) {
      log.info({ code: 'TOOL_ABORTED' }, 'processMessageStream 入场即取消 — 返回取消文案（控制流，非降级）');
      return { reply: TOOL_CANCELLED_REPLY, phaseComplete: false };
    }
    this.turnCount++;
    // PII 脱敏: 出站到云 LLM 前脱敏 (S4移除 + S3脱敏 + S2角色掩盖)
    const input = this.piiScrubber?.scrub(userInput, 'S2').cleaned ?? userInput;
    // Hermes P0-2: 易变层追加到 user message — 保护 Prefix Cache
    this.messages.push({ role: 'user', content: `${input}\n\n${buildVolatileLayer(this.turnCount, this.phase)}` });

    // D594: 长会话压力压缩（与 processMessage 同一背压语义 — 流式入口同样先压缩再调用 LLM）
    try {
      const compacted = await this.compaction.compactIfNeeded(this.messages, 'pressure');
      if (compacted) {
        log.info({ shadowedMessageCount: compacted.shadowedMessageCount, shadowedTokenCount: compacted.shadowedTokenCount }, '长会话触发上下文压缩');
      }
    } catch (err) {
      const code = err instanceof ContextCompactionError ? err.code : 'UNKNOWN';
      log.warn({ err, code }, '压力压缩失败 — 继续本轮对话（降级不阻断）');
    }

    // L1 decoupling: onToken 已处理 TUI 显示，不再重复调用 viewAdapter
    const display = (token: string) => {
      onToken(token);
    };

    if (this.phase === 0) {
      const phaseComplete =
        this.turnCount >= this.config.maxTurns ||
        this.detectPhaseComplete(userInput);
      const minTurns = Math.min(3, this.config.maxTurns);

      if (phaseComplete && this.turnCount >= minTurns) {
        const reply = '感谢你的信息！访谈完成。现在开始运行六阶段诊断分析...';
        for (const ch of reply) {
          display(ch);
          await sleep(5); // P3-06: 20ms→5ms 更流畅的流式体验
        }
        this.viewAdapter?.showAgentMessage(reply);
        this.messages.push({ role: 'assistant', content: reply });
        this.phase = 1;
        return { reply, phaseComplete: true };
      }

      const reply = await this.streamWithToolLoop(display, signal);
      this.messages.push({ role: 'assistant', content: reply });
      return { reply, phaseComplete: false };
    }

    const reply = await this.streamWithToolLoop(display, signal);
    this.messages.push({ role: 'assistant', content: reply });
    return { reply, phaseComplete: false };
  }

  // ═══ Diagnosis Orchestrator Integration (delegated to DiagnosisLauncher) ═══

  async startDiagnosis(
    initiatorRole: string,
    initiatorName: string,
    onEvent?: (event: DiagnosisEvent) => void,
  ): Promise<ConsultationResult | null> {
    // L2 ExpertRouter: 根据 Phase 选择专家策略
    if (this.expertRouter) {
      const selection = await this.expertRouter.route(initiatorName, {
        phase: this.phase,
        orgSize: this.orgId,
      });
      // 将 ExpertSelection 传给 diagnosisLauncher（SubAgentCoordinator 消费）
      (this.diagnosisLauncher as { setExpertSelection?: (s: unknown) => void }).setExpertSelection?.(selection);
    }
    return this.diagnosisLauncher.startDiagnosis(initiatorRole, initiatorName, onEvent);
  }

  // ═══ Serialization ═══

  /**
   * Serialize current engine state for storage/restore.
   * LLMProvider is NOT serialized — caller must provide provider on restore.
   *
   * #1075 P2-2 / #1169（规格 §2.1-e／§10）：写入 `rolePackId` 的判据 = **绑定意图**真源
   * `boundRolePackId`，**不是**运行期 `rolePack`。两者语义必须分清：
   *   · **已绑定** = 本会话归属某岗位包 ⇒ 落库（跨重启/缓存逐出可恢复归属，J7a/J7c/R-J4）；
   *   · **已生效** = 本轮人设复核通过并注入 ⇒ **不由本方法表达**，仍由每轮 `loadRolePackPersona()`
   *     决定。降级轮（`rolePack === null` 但 `boundRolePackId !== null`）只落归属，不落"已生效"。
   * 人设文本不落库（每轮从磁盘重解析）。
   * 未绑定会话**不写该键** —— `'rolePackId' in state === false` 是 J3/J7a 的基线判据（零变化）。
   *
   * @output `EngineState`（`rolePackId` 为可选键；`boundRolePackId !== null` 时写入）
   * @authority 绑定真源 = 本实例 `boundRolePackId`（唯一"是否已绑定"真源，见 P2-4a 段注释）
   */
  serialize(): EngineState {
    const state: EngineState = {
      orgId: this.orgId,
      phase: this.phase,
      messages: [...this.messages],
      startedAt: new Date().toISOString(),
    };
    // #1169：真源 = 绑定意图。`rolePack` 只表达"本轮是否生效"，撤岗/复核失败时为 null ⇒
    //        旧写法（rolePack !== null）会把已绑定会话的归属丢掉，重启后复核不可达。
    if (this.boundRolePackId !== null) state.rolePackId = this.boundRolePackId;
    return state;
  }

  /**
   * Restore engine from a previously serialized state.
   * Provider must be supplied (not stored in state).
   * D487: wiring — 恢复会话时可传 sessionManager/sessionStore（诊断事件流续写同一会话）。
   *
   * #1075 P2-2: wiring 追加 `rolePack` —— 语义是**三态**，不是布尔：
   *   · `persona` ⇒ 恢复后重建 system 层，注入人设（J7a/J7c）
   *   · `null`    ⇒ **也**重建（撤岗：必须把快照 `state.messages[0]` 里的旧人设段刷掉）
   *   · `undefined`（不传）⇒ 保持既有恢复行为**逐字不变**（旧调用方不受影响）
   *
   * @input  provider／state／wiring（可选）
   * @output 恢复后的引擎实例（phase＋messages 来自 state）
   * @degraded `rolePack` 传 null 时不注入 —— 显式撤岗，不是错误
   * @authority 生产调用方 = `src/routes/conversations.ts` 的缓存未命中路径（恢复会话）
   */
  static fromState(
    provider: LLMProvider,
    state: EngineState,
    wiring?: {
      sessionManager?: SessionManager;
      sessionStore?: SessionStoreLike;
      sessionId?: string;
      /**
       * #1075 P2-2: 恢复时显式传入的人设面（`null` = 撤岗，`undefined` = 不干预）。
       * 路由恒显式传（persona 或 null），以便"撤销后不再注入"在恢复路径上同样成立。
       */
      rolePack?: RolePackPersona | null;
    },
  ): ConversationEngine {
    const engine = new ConversationEngine(provider, {
      orgId: state.orgId,
      sessionId: wiring?.sessionId,
      sessionManager: wiring?.sessionManager,
      sessionStore: wiring?.sessionStore,
    });
    engine.phase = state.phase;
    engine.messages = [...state.messages];
    // #1075 P2-4a / #1169: 先从快照恢复绑定真源（`state.rolePackId` = serialize 落下的**绑定意图**，
    //   降级轮也在 ⇒ 归属不丢；是否生效仍由本轮 wiring.rolePack 与每轮复核决定）
    engine.boundRolePackId = state.rolePackId ?? null;
    engine.pendingRolePackId = engine.boundRolePackId;
    // 删除人设段 / 注入人设都由 setRolePack 统一完成（它还会把 engineCtx.messages 对齐到新数组）。
    if (wiring?.rolePack !== undefined) engine.setRolePack(wiring.rolePack);
    return engine;
  }

  /** v3.3: 从企业事实层加载本工作区的已确认判断 */
  private async loadConfirmedFacts(): Promise<string[] | undefined> {
    if (!this.memoryStore || !this.orgId) return undefined;
    try {
      // v3.5: 从最近消息提取tags → 传递给Bridge做跨区匹配
      const recentMsgs = this.messages.slice(-5).map(m => typeof m.content === 'string' ? m.content : '').join(' ');
      const tags = recentMsgs.split(/[\s,，。！？]+/).filter(w => w.length >= 2).slice(0, 5);
      const { WorkspaceContextBridge } = await import('./workspace-context-bridge');
      const bridge = new WorkspaceContextBridge(this.memoryStore);
      const ctx = await bridge.loadContextForWorkspace(this.orgId, tags);
      const facts = [...ctx.ownFacts, ...ctx.relatedFacts];
      if (facts.length === 0) return undefined;
      return facts;
    } catch (err) { log.warn({ err }, 'memoryStore 不可用 — degraded'); return undefined; }
  }

  // ═══ Private: LLM + Tool Loop (delegated to ToolLoopExecutor) ═══

  private async callLLMWithTools(signal?: AbortSignal): Promise<string> {
    return this.toolLoop.callLLMWithTools(signal);
  }

  private async streamWithToolLoop(onToken: (token: string) => void, signal?: AbortSignal): Promise<string> {
    return this.toolLoop.streamWithToolLoop(onToken, signal);
  }

  // ═══ Private: Helpers ═══

  /**
   * Detect if user input signals readiness to end Phase 0.
   * Uses simple keyword matching — not LLM.
   */
  private detectPhaseComplete(input: string): boolean {
    const signals = [
      '没有了', '就这些', '差不多了', '可以了',
      '开始诊断', '开始分析', '好的', 'ok', '没问题',
    ];
    return signals.some(s => input.toLowerCase().includes(s));
  }
}

// ═══ Utility ═══

import type { DiagnosisEngine } from '../l2-interfaces/diagnosis-engine';

/** 铁律 39: 无 engine 注入时的安全降级 — 返回明确错误而非崩溃 */
function createNoopEngine(): DiagnosisEngine {
  return {
    async runConsultation(_teamId, _initiator, onEvent) {
      onEvent?.({ type: 'error', phase: 0, label: '引擎未配置', message: 'DiagnosisEngine 未注入 — 请使用 createSynovaDiagnosisEngine 配置引擎' });
      return { teamId: _teamId, report: { error: '引擎未配置' }, totalDurationMs: 0, degradedModules: ['engine'] };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ═══ K12-08(#T) 进程级决策落账接缝 ═══

/**
 * 决策落账接缝的**最小面**（进程级）。
 *
 * 只需 `recordDecision` 一个方法 ⇒ 调用方不必持有 `ConversationEngine` 的完整构造参数
 * （provider / sessionManager / …），也**不新增任何 L4 运行时依赖**（EC-03 不变）。
 * 结构形态：真实 `ConversationEngine` 天然满足本接口，无需断言、无需适配层。
 */
export interface DecisionRecordingSeam {
  /**
   * @input  decision — 决策输入（谁/做什么/理由；五要素其余项由落账入口补默认）
   * @output DecisionResult — recorded=true 时带台账行；失败时带 error（**不抛**）
   * @degraded 未接 `onDecision` ⇒ `{recorded:false, error:'DecisionCapture callback not configured'}`
   */
  recordDecision(decision: DecisionInput): Promise<DecisionResult>;
}

/**
 * 进程级接缝位 —— 供**无会话**的生产路径（如工单关闭的人工裁决，K12-08 C3）复用同一 L2 接缝。
 *
 * 为什么需要它：`ConversationEngine` 是**会话级**实例（`routes/conversations.ts` 的
 * `sessionEngines` 缓存），而工单关闭（`POST /api/sentinel/tickets/:id/transition`）**没有会话**，
 * 取不到那批实例。若在 L1 路由里临时 `new ConversationEngine(...)`，既要把 provider 重新
 * 装一遍（failover 链 + 上下文压缩，含环境变量派生），又在请求路径上引入无关构造风险。
 * 故：把**已由装配层注入好 `onDecision` 的引擎**存一个进程级引用，无会话路径直接复用同一接缝。
 *
 * 不变量：这里**只持接缝引用**，不持 L4 图存储实例 —— 写台账的运行时依赖仍在装配层
 * （`deploy/bootstrap.ts` 的真图存储实例）里，本文件仍是 `import type`（EC-03 不破）。
 */
let decisionRecordingSeam: DecisionRecordingSeam | null = null;

/**
 * 注册进程级决策落账接缝（由 L1 装配点调用；**可选**，不调则无会话路径显式失败）。
 *
 * @input  seam — 已接好 `onDecision` 的引擎接缝；传 null ⇒ 注销（测试复位用）
 * @output 无
 * @degraded 未注册 ⇒ `getDecisionRecordingSeam()` 返回 null，调用方据此**显式跳过并 log**，
 *           不静默假装落账（铁律 24/31）
 */
export function setDecisionRecordingSeam(seam: DecisionRecordingSeam | null): void {
  decisionRecordingSeam = seam;
}

/**
 * 读取进程级决策落账接缝。
 *
 * @output 已注册的接缝；未注册 ⇒ null（调用方须显式降级，不得假设可用）
 */
export function getDecisionRecordingSeam(): DecisionRecordingSeam | null {
  return decisionRecordingSeam;
}

// ═══ J5 / #405：④ 台账读回接缝的 L2 出口（铁律 39：L1 不直触 L4）═══
// 实现与语义（含降级）全在 `src/l4/decision-capture.ts`（写读同源）；此处仅转发，
// 与上方写侧接缝同宿，L1 消费面只有一个可指的 L2 符号。
export { getDecisionLedgerReader } from '../l4/decision-ledger-readback';
export type { DecisionLedgerQuery, DecisionLedgerEntry, DecisionLedgerReadResult } from '../l4/decision-ledger-readback';

// ═══ #656 M2 · 对话链 `/ingest` 入口（判据②：conversation 链 ingest 调用点 ≥1）═══
//
// 设计哲学：**一个前缀分离 ＋ 三条承诺** —— ① 触发与落点锚只在 L2 定义一次（L1 只转发）；
// ② 零 LLM 依赖（`/ingest` 不碰 provider/config，避免费用与 LLM_NOT_CONFIGURED 挡路）；
// ③ 摄取失败只降级不阻断（degraded 显式传播，普通对话路径零改动）。
//
// 契约（铁律 47）:
//   @input    message: string（route 边界已校验 1..MESSAGE_MAX）｜orgId: string
//             ｜store: ConversationIngestStore（**参数注入**：本模块不建第二套 store、不直连 L5）
//             ｜entry: 'route'|'engine'（仅日志归因，不改变语义）
//   @output   ConversationIngestOutcome { ingested, nodesCreated, edgesCreated, degraded,
//             code?: 'INGEST_TRIGGER_NONE'|'INGEST_EMPTY'|'INGEST_FAILED' }
//   @degraded 摄取 errors 非空 / 调用抛错 ⇒ ingested=false + degraded=true + code='INGEST_FAILED'
//             + log.warn（铁律 11/31）；**不阻断**普通对话（本函数不在普通消息路径上）
//   @authority 仅 conversation 链可调（`routes/conversations.ts` 的 `/ingest` 分支经
//             `ingestConversationExcerpt` 转发）；**不新增公开 HTTP 字段**（接口变更须 CTO）
//   @not-here 不写 metric_readings ｜ 不改 46 哨兵 ｜ 不做标定 ｜ 不建第二套 store ｜ 不调 LLM
//
// 落点：`ingestDocumentText` 建 `Document` 节点，`name = anchor`、`content = text.slice(0,5000)`、
//       `source = 'upload'`（src/ingest/knowledge-ingest-bridge.ts:55-57）⇒ 读回侧按 props.name 断锚点。
//
// 已知限制（Known Limitations）:
//   1. 触发只按前缀 `startsWith('/ingest')`，**不做词边界** ⇒ `/ingested ...` 亦命中（text='ed'）。
//      规格（裁 225）方案 A 只要求前缀语义；收紧属接口语义变更，须 CTO。
//   2. 实体抽取仍是 `ingestDocumentText` 的启发式（引号人名/部门关键词）；落点证明用
//      Document.name=anchor（不依赖启发式实体）——见批规格 §7.3。
//   3. 锚点时间戳用 UTC ISO（`new Date().toISOString()`，含 `:`/`.`），非文件名安全字符；
//      本批只做 Document 落点读回，不落文件系统。
//   4. 同进程并发两次摄取由模块级 seq 同步自增保证锚点不同；跨进程靠 pid 段区分，
//      不维护全局唯一性注册表（本批不需要）。
//   5. **接口面刻意收窄**：`ConversationIngestStore` 只声明本接缝实际触达的 2 个方法
//      （`ingestDocumentText` 只调 createNode/createEdge —— knowledge-ingest-bridge.ts:36/:47/:55/:63），
//      比 `GraphStore`（14 方法）窄 ⇒ `src/adapters/**` 的实现（SqliteGraphStore 仅 9 个接口方法 + 构造器）
//      也能直接注入，**不必补桩、不必 as unknown as**。`GraphStore` 比本接缝宽，本批**不改**
//      `src/adapters/**`（不在写集）；两者关系见下方 `store as GraphStore` 的单层断言注释。

/** `/ingest` 命令前缀（route 与引擎共用的唯一真源；改名即接口语义变更） */
export const INGEST_COMMAND_PREFIX = '/ingest';

/**
 * 本接缝实际触达的图存储面（**比 GraphStore 窄**）。
 *
 * 为什么要单独的接口、而不是直接吃 `GraphStore`：
 * `ingestDocumentText` 的形参声明为完整 GraphStore（knowledge-ingest-bridge.ts:25），
 * 但其函数体只调用 `createNode`/`createEdge`（同文件 :36/:47/:55/:63）；
 * 注入实例（`adapters/sqlite-graph-store`）只实现 GraphStore 的 9 个方法（共 10 个成员，含构造器），
 * 与 14 方法的 GraphStore **不结构兼容**（单层断言实测 TS2352）⇒ 用触达面接口收口，
 * L1 传真实例零断言，断言集中在本 L2 既有 L2↔L4 例外层（见调用点注释）。
 */
export interface ConversationIngestStore {
  createNode(type: string, props: Record<string, unknown>, graph: string): string;
  createEdge(
    type: string, from: string, to: string, weight?: number,
    props?: Record<string, unknown>, graph?: string,
  ): string;
}

/** 模块级单调计数（进程内从 1 起）——保证同进程两次摄取锚点不同（批规格 §4.4 边界值） */
let ingestAnchorSeq = 0;

/** /ingest 摄取的归一化结果（契约 @output 的 TypeScript 载体；语义见本文件头 @output 与 ingestConversationExcerpt 的 @returns） */
export interface ConversationIngestOutcome {
  ingested: boolean;
  nodesCreated: number;
  edgesCreated: number;
  degraded: boolean;
  code?: 'INGEST_TRIGGER_NONE' | 'INGEST_EMPTY' | 'INGEST_FAILED';
}

/**
 * 解析 `/ingest` 前缀消息（纯函数，无副作用——可直接单测边界）。
 *
 * @param message - 用户输入原文（调用方已做 1..MESSAGE_MAX 边界校验）
 * @returns triggered=true 时 `text` = 前缀后 trim 的资料文本（可能为空串）；否则 `text=''`
 * @degraded 无（纯函数不降级）
 */
export function parseIngestMessage(message: string): { triggered: boolean; text: string } {
  if (!message.startsWith(INGEST_COMMAND_PREFIX)) return { triggered: false, text: '' };
  return { triggered: true, text: message.slice(INGEST_COMMAND_PREFIX.length).trim() };
}

/**
 * 生成一次摄取的唯一锚点：`inge-<ISO8601>-<pid>-<seq>`。
 * 同时作为 `ingestDocumentText` 的 fileName ⇒ Document.name（落点读回的唯一依据）。
 * @output 本进程内单调唯一锚点（seq 自增；pid 区分进程）
 */
function nextIngestAnchor(): string {
  ingestAnchorSeq += 1;
  return `inge-${new Date().toISOString()}-${process.pid}-${ingestAnchorSeq}`;
}

/**
 * 摄取一段对话资料进本体图（conversation 链唯一 ingest 调用点）。
 *
 * @param message - 用户输入原文（`/ingest` 前缀消息；非前缀 ⇒ INGEST_TRIGGER_NONE）
 * @param orgId - 图名（租户）；本函数只写该 orgId（跨租户隔离由读回侧按 orgId 过滤）
 * @param store - ConversationIngestStore（**参数注入**；本模块不构造第二套 store）
 * @param entry - 调用来源（'route' = POST /api/conversations 分支；'engine' = 引擎内调用），仅日志归因
 * @returns 摄取结果；失败一律走 degraded 字段（**不裸 throw**，铁律 11/31/32）
 * @degraded 摄取 errors 非空或调用抛错 ⇒ `{ingested:false, degraded:true, code:'INGEST_FAILED'}` + log.warn
 */
export async function ingestConversationExcerpt(
  message: string, orgId: string, store: ConversationIngestStore, entry: 'route' | 'engine',
): Promise<ConversationIngestOutcome> {
  const parsed = parseIngestMessage(message);
  if (!parsed.triggered) {
    return { ingested: false, nodesCreated: 0, edgesCreated: 0, degraded: false, code: 'INGEST_TRIGGER_NONE' };
  }
  if (parsed.text.length === 0) {
    // 空资料是**用户输入错误**而非降级：不调 ingestDocumentText、不写图（批规格 §4.4）
    log.warn({ entry, orgId }, '/ingest 缺少资料文本 — INGEST_EMPTY（未落库）');
    return { ingested: false, nodesCreated: 0, edgesCreated: 0, degraded: false, code: 'INGEST_EMPTY' };
  }
  const anchor = nextIngestAnchor();
  try {
    // 单层断言：`GraphStore`(14 方法) ⊇ `ConversationIngestStore`(2 方法) ⇒ 反向断言语义合法；
    // 断言集中在本 L2（既有 L2↔L4 例外层，见文件头 import 注释），**不下放 L1**。
    // 依据：ingestDocumentText 只触达 createNode/createEdge（knowledge-ingest-bridge.ts:36/47/55/63）。
    const result = await ingestDocumentText(parsed.text, anchor, orgId, store as GraphStore);
    if (result.errors.length > 0) {
      log.warn(
        { entry, orgId, anchor, errors: result.errors },
        '/ingest 摄取降级 — 已记日志，不阻断对话（铁律 11/31）',
      );
      return {
        ingested: false,
        nodesCreated: result.nodesCreated,
        edgesCreated: result.edgesCreated,
        degraded: true,
        code: 'INGEST_FAILED',
      };
    }
    log.info(
      { entry, orgId, anchor, nodes: result.nodesCreated, edges: result.edgesCreated },
      '/ingest 资料已入本体图（Document.name=anchor）',
    );
    return {
      ingested: true,
      nodesCreated: result.nodesCreated,
      edgesCreated: result.edgesCreated,
      degraded: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ entry, orgId, anchor, err: msg }, '/ingest 摄取抛错 — 降级为 INGEST_FAILED（不阻断对话）');
    return { ingested: false, nodesCreated: 0, edgesCreated: 0, degraded: true, code: 'INGEST_FAILED' };
  }
}
