/**
 * synova-diagnosis-engine.ts — Synova 独立诊断引擎接口 (L3)
 *
 * 这是 SynovaAgent 自己的诊断引擎契约。不和 Novis engine-core 共享任何类型。
 * 五层架构：L1/L2 → 此接口 → L3 实现
 *
 * 设计原则 (Anthropic):
 *   1. 接口最小化 — 只定义调用方真正需要的
 *   2. 纯 ESM — 零 CJS require()
 *   3. 类型完整 —  discriminated union，编译器可验证
 *   4. 零外部依赖 — 不 import engine-core/Novis 的任何类型
 *
 * Iron law #38: zero unsafe type casts
 * Iron law #39: L3 接口，L2 只依赖此接口
 */

// ═══ 输入类型 ═══

/** 诊断发起人信息。所有字段来自 L1 用户输入，不从 engine-core 继承。 */
export interface InitiatorProfile {
  /** 发起人角色，如 '管理者' | 'GA' | '部门负责人' */
  role: string;
  /** 发起人名称 */
  name: string;
  /** 目标团队/组织标识 */
  teamId: string;
  /** 关注的核心问题列表 */
  concerns: string[];
}

/** 诊断深度控制 (string — 运行时校验，可扩展，实现阶段导出) */
export type DiagnosisDepth = string;

/** 诊断范围 */
export interface DiagnosisScope {
  /** 诊断深度 */
  depth?: DiagnosisDepth;
  /** 限定维度 (D1-D7)，不传 = 全维度 */
  dimensions?: string[];
  /** 限定专家，不传 = 全部 8 位 */
  experts?: string[];
  /** 报告颗粒度: ceo/flywheel/expert/raw */
  reportDepth?: 'ceo' | 'flywheel' | 'expert' | 'raw';
  /** 过滤诊断层: environment|capital|interface|technology|alignment|internal */
  layers?: string[];
  /** 报告语言 */
  language?: 'zh' | 'en';
  /** 限定哨兵 (按 sentinelId 过滤), 不传 = 全部 */
  sentinelIds?: string[];
  /** 历史对比基准: 'last_quarter' | 'last_month' | 'baseline' */
  compareWith?: 'last_quarter' | 'last_month' | 'baseline';
  /**
   * #1431 阶段 2 · S2b：④a 观测周期（`YYYY-MM`），**由调用方显式携带**。
   * 引擎/哨兵**不得**用 `new Date()` 派生；缺省 ⇒ 本轮不写 `metric_observations`
   * （降级码 `S2_DEGRADED_NO_PERIOD`）；非法形态 ⇒ 不写（`S2_DEGRADED_BAD_PERIOD`）。
   */
  period?: string;
  /**
   * #1431 阶段 2 · S2b：④a 观测对象的业务键（② `Team` 对象的幂等键，非空字符串）。
   * 缺省 ⇒ 本轮不写 ④a（`S2_DEGRADED_NO_OBJECT`），**不得回退写 `'*'`**。
   */
  objectKey?: string;
}

// ═══ 事件类型 (discriminated union) ═══

/** 阶段事件基类 */
interface BaseEvent {
  /** 事件发生的时间戳 (ISO 8601) */
  timestamp: string;
}

/** Phase 开始 */
export interface PhaseStartedEvent extends BaseEvent {
  type: 'phase_started';
  phase: number;
  label?: string;
}

/** Phase 完成 */
export interface PhaseCompletedEvent extends BaseEvent {
  type: 'phase_completed';
  phase: number;
  durationMs: number;
  degradedModules: string[];
}

/** 证据添加 */
export interface EvidenceAddedEvent extends BaseEvent {
  type: 'evidence_added';
  phase: number;
  moduleId: string;
  summary: string;
  confidence?: number;
}

/** 矛盾检测 */
export interface ContradictionDetectedEvent extends BaseEvent {
  type: 'contradiction_detected';
  phase: number;
  evidenceA: string;
  evidenceB: string;
  dimension: string;
}

/** 假设生成 */
export interface HypothesisGeneratedEvent extends BaseEvent {
  type: 'hypothesis_generated';
  phase: number;
  /** 假设内容摘要 */
  summary: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 来源专家 */
  expert: string;
  /** 关联维度 */
  dimension?: string;
}

/** 假设被推翻 */
export interface HypothesisRefutedEvent extends BaseEvent {
  type: 'hypothesis_refuted';
  hypothesisId: string;
  reason: string;
}

/** 根因识别 */
export interface RootCauseIdentifiedEvent extends BaseEvent {
  type: 'root_cause_identified';
  phase: number;
  rootCause: string;
  confidence: number;
  dimension: string;
}

/** 报告就绪 */
export interface ReportReadyEvent extends BaseEvent {
  type: 'report_ready';
  /** 报告可访问的 URL 或 ID */
  reportId: string;
}

/** 错误 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  code: string;
  message: string;
  /** 是否可恢复继续诊断 */
  recoverable: boolean;
}

/** 降级通知 */
export interface DegradedEvent extends BaseEvent {
  type: 'degraded';
  phase: number;
  moduleId: string;
  message: string;
}

/** 专家中间发现 (Slice 3 判断卡片的数据源) */
export interface ExpertHypothesisEvent extends BaseEvent {
  type: 'expert_hypothesis';
  phase: number;
  expert: string;
  message: string;
  findings?: Array<{
    moduleId: string;
    summary: string;
    confidence?: number;
  }>;
  confidence?: number;
}

/** 社区报告 */
export interface CommunityReportsEvent extends BaseEvent {
  type: 'community_reports';
  count: number;
  message: string;
  findings?: Array<{
    moduleId: string;
    summary: string;
    confidence?: number;
  }>;
}

/** 实体解析 */
export interface EntityResolutionEvent extends BaseEvent {
  type: 'entity_resolution';
  autoMerged: number;
  queuedForReview: number;
  message: string;
}

/** 图更新 */
export interface GraphUpdateEvent extends BaseEvent {
  type: 'graph_update';
  nodesCreated: number;
  edgesCreated: number;
}

/** 右边栏更新 (GNS v2.0) */
export interface RightColumnUpdateEvent extends BaseEvent {
  type: 'right_column_update';
  rightColumn: {
    goals: Array<{ id: string; name: string; progress: number; status: string }>;
    alerts: Array<{
      id: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
      confidence: number;
      raisedAt: string;
    }>;
    obstacles: Array<{
      id: string;
      description: string;
      status: 'tracking' | 'resolved' | 'stale';
      updatedAt: string;
    }>;
  };
}

/** LLM 响应预览 (调试用) */
export interface LLMResponseEvent extends BaseEvent {
  type: 'llm_response';
  phase: number;
  contentPreview: string;
  contentLength: number;
}

/** LLM 降级 */
export interface LLMFallbackEvent extends BaseEvent {
  type: 'llm_fallback';
  phase: number;
  reason: string;
  llmContentPreview: string;
}

/**
 * 诊断事件 — discriminated union。
 * 调用方通过 switch(event.type) 获得完整类型收窄。
 */
export type DiagnosisEvent =
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | EvidenceAddedEvent
  | ContradictionDetectedEvent
  | HypothesisGeneratedEvent
  | HypothesisRefutedEvent
  | RootCauseIdentifiedEvent
  | ReportReadyEvent
  | ErrorEvent
  | DegradedEvent
  | ExpertHypothesisEvent
  | CommunityReportsEvent
  | EntityResolutionEvent
  | GraphUpdateEvent
  | RightColumnUpdateEvent
  | LLMResponseEvent
  | LLMFallbackEvent;

/** 事件类型字符串字面量 */
export type DiagnosisEventType = DiagnosisEvent['type'];

/** 所有事件类型常量 (实现阶段导出，供运行时遍历) */
const DIAGNOSIS_EVENT_TYPES: readonly DiagnosisEventType[] = [
  'phase_started',
  'phase_completed',
  'evidence_added',
  'contradiction_detected',
  'hypothesis_generated',
  'hypothesis_refuted',
  'root_cause_identified',
  'report_ready',
  'error',
  'degraded',
  'expert_hypothesis',
  'community_reports',
  'entity_resolution',
  'graph_update',
  'right_column_update',
  'llm_response',
  'llm_fallback',
] as const;

// ═══ 输出类型 ═══

/** 诊断报告 (Synova 自有，结构在实现中定义) */
export interface DiagnosisReport {
  /** 报告唯一 ID */
  reportId: string;
  /** 目标团队 */
  teamId: string;
  /** 生成时间 (ISO 8601) */
  generatedAt: string;
  /** 综合判断摘要 */
  summary: string;
  /** 各专家报告 */
  expertReports: Array<{
    expert: string;
    findings: string[];
    confidence: number;
  }>;
  /** 根因列表 */
  rootCauses: Array<{
    description: string;
    dimension: string;
    confidence: number;
  }>;
  /** 行动建议 */
  recommendations: Array<{
    action: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    expert: string;
  }>;
  /** 原始报告 (向后兼容，可存放完整 JSON) */
  raw: Record<string, unknown>;
}

/** 诊断结果 */
export interface ConsultationResult {
  /** 目标团队 ID */
  teamId: string;
  /** 诊断报告 */
  report: DiagnosisReport;
  /** 总耗时 (ms) */
  totalDurationMs: number;
  /** 降级的模块 ID 列表 */
  degradedModules: string[];
}

// ═══ 引擎接口 (L3 契约) ═══

/**
 * Synova 诊断引擎接口。
 *
 * L1/L2 只依赖此接口，不知道底层实现。
 * 实现类在 src/l3/ 下，可以在不修改调用方的情况下替换整个引擎。
 *
 * @example
 * ```ts
 * const engine: SynovaDiagnosisEngine = new SynovaDiagnosisEngineImpl(llm, tools);
 * const result = await engine.runConsultation('team-1', {
 *   role: '管理者', name: '张三', teamId: 'team-1', concerns: ['增长放缓'],
 * }, (event) => {
 *   switch (event.type) {
 *     case 'hypothesis_generated':
 *       console.log(`[${event.expert}] ${event.summary} (${event.confidence})`);
 *       break;
 *     case 'phase_completed':
 *       console.log(`Phase ${event.phase} done in ${event.durationMs}ms`);
 *       break;
 *   }
 * });
 * ```
 */
export interface SynovaDiagnosisEngine {
  /**
   * 执行六阶段诊断。
   *
   * @param teamId - 目标团队/组织标识
   * @param initiator - 发起人信息
   * @param scope - 诊断范围控制 (可选)
   * @param onEvent - 事件回调 (可选)，用于 SSE 流式推送
   * @returns 诊断结果
   *
   * 阶段: 0=访谈 → 1=数据采集 → 2=假设生成 → 3=根因分析 → 4=报告生成 → 5=交付
   */
  runConsultation(
    teamId: string,
    initiator: InitiatorProfile,
    scope?: DiagnosisScope,
    onEvent?: (event: DiagnosisEvent) => void,
  ): Promise<ConsultationResult>;
}

// ═══ 引擎工厂 (L2 使用) ═══

/** LLM 调用接口 — Synova 自有，不依赖 engine-core */
export interface LLMClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    options?: { tools?: Array<Record<string, unknown>> },
  ): Promise<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  }>;
}

/** 工具执行器接口 */
export interface ToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<{ result: unknown }>;
  listTools(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

/**
 * 创建诊断引擎实例。
 * L2 调用此工厂函数，注入 LLM 和工具依赖。
 */
export type DiagnosisEngineFactory = (
  llm: LLMClient,
  tools: ToolExecutor,
  options?: {
    /** 最大工具调用轮数 */
    maxToolRounds?: number;
    /** 数据完整度阈值 (0-1) */
    gateDataCompleteness?: number;
    /** 最小假设置信度 */
    gateMinHypothesisConfidence?: number;
    /** L4 GraphStore — 哨兵数据源 */
    graphStore?: Record<string, unknown>;
  },
) => SynovaDiagnosisEngine;
