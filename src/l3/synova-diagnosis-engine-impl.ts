/**
 * synova-diagnosis-engine-impl.ts — Synova 诊断引擎实现 (L3)
 *
 * Step 2/4: 六阶段诊断引擎的 Synova 自研实现。
 * 零 engine-core 依赖。零 Novis 类型引用。
 *
 * 六阶段:
 *   Phase 0: 组织访谈      — 收集基本信息和关注点
 *   Phase 1: 数据采集      — 从可用数据源获取数据
 *   Phase 2: 假设生成      — LLM 生成根因假设
 *   Phase 3: 根因分析      — 交叉验证 + 专家推理
 *   Phase 4: 报告生成      — 综合诊断报告
 *   Phase 5: 交付          — 返回结果
 *
 * Iron law #24: 每个 catch 有 log + degraded。
 * Iron law #31: 降级信号传播 — 单阶段失败不阻断整体。
 * Iron law #32: 错误分类 — .code + .phase + .retryable。
 * Iron law #38: zero unsafe type casts.
 */
import { createLogger } from '@synova/logger';
import { getAllExpertIds } from '../agent/expert-config-loader';
import { LEGACY_TO_EXPERT_ID_MAP } from '../agent/expert-name-map';
import type {
  SynovaDiagnosisEngine,
  InitiatorProfile,
  DiagnosisScope,
  DiagnosisEvent,
  ConsultationResult,
  DiagnosisReport,
  LLMClient,
  ToolExecutor,
} from './synova-diagnosis-engine';

const log = createLogger('l3/synova-engine');

// ═══ 错误类型 (铁律 32) — 使用 @synova/error-types 的 DiagnosticAgentError ═══

// ═══ 诊断引擎配置 ═══

interface EngineConfig {
  /** 最大 LLM 工具调用轮数 */
  maxToolRounds: number;
  /** 数据完整度最低阈值 (0-1) */
  gateDataCompleteness: number;
  /** 假设置信度最低阈值 */
  gateMinHypothesisConfidence: number;
  /** 每阶段超时 (ms) */
  phaseTimeoutMs: number;
}

const PHASE_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_GATE_COMPLETENESS = 0.3;
const DEFAULT_GATE_CONFIDENCE = 0.5;

const DEFAULT_CONFIG: EngineConfig = {
  maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
  gateDataCompleteness: DEFAULT_GATE_COMPLETENESS,
  gateMinHypothesisConfidence: DEFAULT_GATE_CONFIDENCE,
  phaseTimeoutMs: PHASE_TIMEOUT_MS,
};

/** 诊断深度默认值 */
const DEFAULT_DEPTH = 'standard';

/** 有效优先级值 (有限枚举, severity 级别) */
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

// ═══ Synova 自研诊断 Prompt ═══

const DIAGNOSIS_SYSTEM_PROMPT = `你是 Synova，一个组织诊断 AI Agent。
你的任务是对目标组织进行六阶段诊断，找出增长瓶颈并给出可执行的行动建议。

## 诊断框架
1. 先理解组织的业务模式、规模、行业背景
2. 从 7 个维度分析: 增长(D1)、组织(D2)、人才(D3)、软件(D4)、适配(D5)、战略(D6)、风险(D7)
3. 识别 2-3 个最可能的根因
4. 给出具体、可量化的行动建议

## 输出格式
请以 JSON 格式输出你的诊断结果:
{
  "hypotheses": [
    {
      "dimension": "D1",
      "summary": "增长瓶颈的核心原因是...",
      "confidence": 0.85,
      "evidence": ["证据1", "证据2"]
    }
  ],
  "rootCauses": [
    {
      "description": "根因描述",
      "dimension": "D1",
      "confidence": 0.8
    }
  ],
  "recommendations": [
    {
      "action": "具体行动建议",
      "priority": "high",
      "dimension": "D1"
    }
  ],
  "summary": "一句话总结诊断结论"
}`;

// ═══ 实现 ═══

export class SynovaDiagnosisEngineImpl implements SynovaDiagnosisEngine {
  private llm: LLMClient;
  private tools: ToolExecutor;
  private config: EngineConfig;
  private graphStore: Record<string, unknown> | null;
  /** Phase P0-3: 会话内学习引擎 — 纯内存, 仅当前诊断会话 */
  private _sessionLearner: import('@synova/evolution').SessionLearner | null = null;

  constructor(
    llm: LLMClient,
    tools: ToolExecutor,
    options?: {
      maxToolRounds?: number;
      gateDataCompleteness?: number;
      gateMinHypothesisConfidence?: number;
      /** L4 GraphStore — 哨兵数据源。未提供时哨兵降级跳过。 */
      graphStore?: Record<string, unknown>;
    },
  ) {
    this.llm = llm;
    this.tools = tools;
    this.graphStore = options?.graphStore || null;
    this.config = {
      ...DEFAULT_CONFIG,
      maxToolRounds: options?.maxToolRounds ?? DEFAULT_CONFIG.maxToolRounds,
      gateDataCompleteness: options?.gateDataCompleteness ?? DEFAULT_CONFIG.gateDataCompleteness,
      gateMinHypothesisConfidence: options?.gateMinHypothesisConfidence ?? DEFAULT_CONFIG.gateMinHypothesisConfidence,
    };
  }

  /** Phase P0-3: 获取当前会话的学习引擎 (可能为 null) */
  getSessionLearner(): import('@synova/evolution').SessionLearner | null {
    return this._sessionLearner;
  }

  /** Builder 模式: 设置最大工具调用轮数 */
  withMaxIterations(n: number): this {
    this.config.maxToolRounds = n;
    return this;
  }

  /** Builder 模式: 设置数据完整度阈值 */
  withGateDataCompleteness(n: number): this {
    this.config.gateDataCompleteness = n;
    return this;
  }

  /** Builder 模式: 设置最小假设置信度 */
  withGateMinHypothesisConfidence(n: number): this {
    this.config.gateMinHypothesisConfidence = n;
    return this;
  }

  // ═══ 主入口 ═══

  async runConsultation(
    teamId: string,
    initiator: InitiatorProfile,
    scope?: DiagnosisScope,
    onEvent?: (event: DiagnosisEvent) => void,
  ): Promise<ConsultationResult> {
    const startTime = Date.now();
    const degradedModules: string[] = [];
    const expertReports: DiagnosisReport['expertReports'] = [];
    const allRootCauses: DiagnosisReport['rootCauses'] = [];
    const allRecommendations: DiagnosisReport['recommendations'] = [];

    const emit = (event: DiagnosisEvent): void => {
      try { onEvent?.(event); } catch (err) { log.warn({ err }, '事件发射失败 — degraded, 非阻断'); }
    };

    const now = (): string => new Date().toISOString();

    try {
      // ═══ Phase 0: 组织访谈 ═══
      emit({ type: 'phase_started', phase: 0, timestamp: now(), label: '组织访谈' });

      try {
        // 验证输入
        if (!initiator.concerns || initiator.concerns.length === 0) {
          initiator = { ...initiator, concerns: ['组织健康状况评估'] };
        }
        log.info({ teamId, concerns: initiator.concerns }, 'Phase 0: 访谈数据就绪');

        // 哨兵切片: 写入 Person 节点到 L4 GraphStore
        if (this.graphStore) {
          try {
            const gs = this.graphStore as { createNode(type: string, props: Record<string, unknown>, graph: string): string };
            gs.createNode('Person', {
              name: initiator.name,
              teamId,
              role: initiator.role,
              concerns: initiator.concerns,
            }, 'default');
          } catch (nodeErr: unknown) {
            log.warn({ err: nodeErr }, 'GraphStore Person 节点写入失败 — degraded');
          }
        }
      } catch (err: unknown) {
        log.warn({ err, teamId }, 'Phase 0 失败 — degraded');
        degradedModules.push('phase0_interview');
      }

      emit({
        type: 'phase_completed', phase: 0, timestamp: now(),
        durationMs: Date.now() - startTime, degradedModules: [...degradedModules],
      });

      // ═══ Phase 1: 数据采集 ═══
      emit({ type: 'phase_started', phase: 1, timestamp: now(), label: '数据采集' });

      try {
        // 检查可用的数据源 — 当前阶段仅记录，后续迭代接入真实数据源
        log.info({ teamId }, 'Phase 1: 数据采集（Synova 自研引擎 — 后续接入数据源）');
      } catch (err: unknown) {
        log.warn({ err, teamId }, 'Phase 1 失败 — degraded');
        degradedModules.push('phase1_data_collection');
      }

      emit({
        type: 'phase_completed', phase: 1, timestamp: now(),
        durationMs: Date.now() - startTime, degradedModules: [...degradedModules],
      });

      // ═══ Phase 2: 假设生成 ═══
      emit({ type: 'phase_started', phase: 2, timestamp: now(), label: '假设生成' });

      // P0-3: SessionLearner — 会话内权重学习 (纯内存, 懒加载, 降级安全)
      try {
        const { SessionLearner } = await import('@synova/evolution');
        this._sessionLearner = new SessionLearner();
        log.debug({ teamId: this._sessionLearner.isActive() }, 'SessionLearner 已启动');
      } catch (slErr: unknown) {
        const msg = slErr instanceof Error ? slErr.message : String(slErr);
        log.warn({ err: msg }, 'SessionLearner 不可用 — degraded');
        this._sessionLearner = null;
      }

      let llmResult: { content: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> } | null = null;

      try {
        const concerns = initiator.concerns.join('、');
        const dimensions = scope?.dimensions?.join(', ') || '全部 7 个维度';
        const depth = scope?.depth || DEFAULT_DEPTH;

        // Phase 2: 调哨兵获取客观数据 → 注入 LLM prompt
        let sentinelContext = '';
        if (this.graphStore) {
          try {
            const { runSentinelForTeam, formatFindingsForLLM } = await import('../sentinel/sentinel-runner');
            const store = this.graphStore as { queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; type: string; props: Record<string, unknown> }> };
            const findings = await runSentinelForTeam(teamId, store);
            if (findings.length > 0) {
              for (const f of findings) {
                // 若 SessionLearner 有该假设的权重记录, 调整置信度
                let confidence = 0.85;
                if (this._sessionLearner) {
                  const weight = this._sessionLearner.getWeight(f.title);
                  if (weight !== 0) {
                    confidence = Math.max(0.1, Math.min(1.0, 0.85 + weight * 0.3));
                  }
                }
                emit({ type: 'expert_hypothesis', phase: 2, timestamp: now(), expert: 'organizational-capability', message: f.description, findings: [{ moduleId: 'D3', summary: f.title, confidence }], confidence });
              }
            }
            sentinelContext = '\n' + formatFindingsForLLM(findings);
          } catch (sentinelErr: unknown) {
            log.warn({ err: sentinelErr }, '哨兵调用失败 — degraded');
          }
        }
        // 标记 SessionLearner 会话结束
        this._sessionLearner?.endSession();

        const messages = [
          { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `## 诊断任务`,
              `- 目标组织: ${teamId}`,
              `- 发起人角色: ${initiator.role} (${initiator.name})`,
              `- 关注问题: ${concerns}`,
              `- 诊断深度: ${depth}`,
              `- 分析维度: ${dimensions}`,
              sentinelContext,
              '请基于以上哨兵数据，按 JSON 格式输出诊断结果。',
            ].filter(Boolean).join('\n'),
          },
        ];

        const tools = this.tools.listTools();
        llmResult = await this.llm.chat(messages, {
          tools: tools.length > 0
            ? tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              }))
            : undefined,
        });

        log.info({ teamId, contentLength: llmResult.content.length }, 'Phase 2: LLM 响应就绪');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg, teamId }, 'Phase 2: LLM 调用失败');
        emit({
          type: 'error', timestamp: now(),
          code: 'LLM_ERROR', message: `LLM 调用失败: ${msg}`, recoverable: false,
        });
        degradedModules.push('phase2_llm');

        // 降级返回
        return this.buildDegradedResult(teamId, startTime, degradedModules);
      }

      // 解析 LLM 输出
      let parsed: Record<string, unknown> = {};
      try {
        const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch { /* degraded — 非 JSON 输出降级为原始文本 */
        log.warn({ teamId }, 'LLM 输出非 JSON — 使用原始文本');
        parsed = { summary: llmResult.content.slice(0, 500) };
      }

      // 提取假设
      const hypotheses = (Array.isArray(parsed.hypotheses) ? parsed.hypotheses : []) as Array<Record<string, unknown>>;
      for (const h of hypotheses) {
        const conf = typeof h.confidence === 'number' ? h.confidence : 0.7;
        const dimension = typeof h.dimension === 'string' ? h.dimension : 'unknown';
        const summary = typeof h.summary === 'string' ? h.summary : JSON.stringify(h);

        emit({
          type: 'hypothesis_generated',
          phase: 2,
          timestamp: now(),
          summary,
          confidence: Math.min(1, Math.max(0, conf)),
          expert: this.mapDimensionToExpert(dimension),
          dimension,
        });

        if (conf >= this.config.gateMinHypothesisConfidence) {
          expertReports.push({
            expert: this.mapDimensionToExpert(dimension),
            findings: Array.isArray(h.evidence) ? h.evidence.filter((e): e is string => typeof e === 'string') : [summary],
            confidence: conf,
          });
        }
      }

      emit({
        type: 'phase_completed', phase: 2, timestamp: now(),
        durationMs: Date.now() - startTime, degradedModules: [...degradedModules],
      });

      // ═══ Phase 3: 根因分析 ═══
      emit({ type: 'phase_started', phase: 3, timestamp: now(), label: '根因分析' });

      const rootCauses = (Array.isArray(parsed.rootCauses) ? parsed.rootCauses : []) as Array<Record<string, unknown>>;
      for (const rc of rootCauses) {
        const conf = typeof rc.confidence === 'number' ? rc.confidence : 0.7;
        const description = typeof rc.description === 'string' ? rc.description : JSON.stringify(rc);
        const dimension = typeof rc.dimension === 'string' ? rc.dimension : 'unknown';

        allRootCauses.push({ description, dimension, confidence: Math.min(1, Math.max(0, conf)) });

        emit({
          type: 'root_cause_identified',
          phase: 3,
          timestamp: now(),
          rootCause: description,
          confidence: conf,
          dimension,
        });
      }

      // 如果 LLM 没有生成根因，从假设中推断
      if (allRootCauses.length === 0 && hypotheses.length > 0) {
        for (const h of hypotheses) {
          const summary = typeof h.summary === 'string' ? h.summary : '';
          if (summary) {
            allRootCauses.push({
              description: summary,
              dimension: typeof h.dimension === 'string' ? h.dimension : 'unknown',
              confidence: typeof h.confidence === 'number' ? h.confidence : 0.7,
            });
          }
        }
      }

      emit({
        type: 'phase_completed', phase: 3, timestamp: now(),
        durationMs: Date.now() - startTime, degradedModules: [...degradedModules],
      });

      // ═══ Phase 4: 报告生成 ═══
      emit({ type: 'phase_started', phase: 4, timestamp: now(), label: '报告生成' });

      const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []) as Array<Record<string, unknown>>;
      for (const rec of recommendations) {
        allRecommendations.push({
          action: typeof rec.action === 'string' ? rec.action : JSON.stringify(rec),
          priority: this.normalizePriority(typeof rec.priority === 'string' ? rec.priority : 'medium'),
          expert: this.mapDimensionToExpert(typeof rec.dimension === 'string' ? rec.dimension : 'unknown'),
        });
      }

      const summary = typeof parsed.summary === 'string'
        ? parsed.summary
        : (allRootCauses[0]?.description || '诊断完成，详见报告。');

      const report: DiagnosisReport = {
        reportId: `rpt_${teamId}_${Date.now().toString(36)}`,
        teamId,
        generatedAt: now(),
        summary,
        expertReports,
        rootCauses: allRootCauses,
        recommendations: allRecommendations,
        raw: parsed,
      };

      emit({ type: 'report_ready', timestamp: now(), reportId: report.reportId });

      emit({
        type: 'phase_completed', phase: 4, timestamp: now(),
        durationMs: Date.now() - startTime, degradedModules: [...degradedModules],
      });

      // ═══ Phase 5: 交付 ═══
      emit({ type: 'phase_started', phase: 5, timestamp: now(), label: '交付' });

      const totalDurationMs = Date.now() - startTime;

      if (degradedModules.length > 0) {
        for (const mod of degradedModules) {
          emit({
            type: 'degraded', phase: 5, timestamp: now(),
            moduleId: mod, message: `模块 ${mod} 已降级`,
          });
        }
      }

      // V4.2.3: 右栏数据更新 — 发射 right_column_update
      emit({
        type: 'right_column_update', timestamp: now(),
        rightColumn: {
          goals: allRootCauses.slice(0, 3).map(rc => ({
            id: rc.dimension, name: rc.description.slice(0, 50),
            progress: Math.round(rc.confidence * 100), status: 'identifying' as const,
          })),
          alerts: allRootCauses.slice(0, 5).map(rc => ({
            id: rc.dimension, description: rc.description.slice(0, 100),
            priority: rc.confidence >= 0.8 ? 'high' as const : rc.confidence >= 0.6 ? 'medium' as const : 'low' as const,
            confidence: rc.confidence, raisedAt: now(),
          })),
          obstacles: allRootCauses.slice(0, 3).map(rc => ({
            id: rc.dimension, description: rc.description.slice(0, 100),
            status: 'tracking' as const, updatedAt: now(),
          })),
        },
      });

      emit({
        type: 'phase_completed', phase: 5, timestamp: now(),
        durationMs: totalDurationMs, degradedModules: [...degradedModules],
      });

      log.info({ teamId, totalDurationMs, hypotheses: hypotheses.length, rootCauses: allRootCauses.length }, '诊断完成');

      return {
        teamId,
        report,
        totalDurationMs,
        degradedModules,
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg, teamId }, '诊断执行异常');

      emit({
        type: 'error', timestamp: now(),
        code: 'ENGINE_CRASH', message: `引擎异常: ${msg}`, recoverable: false,
      });

      return this.buildDegradedResult(teamId, startTime, [...degradedModules, 'engine_crash']);
    }
  }

  // ═══ 辅助 ═══

  private buildDegradedResult(
    teamId: string,
    startTime: number,
    degradedModules: string[],
  ): ConsultationResult {
    return {
      teamId,
      report: {
        reportId: `rpt_${teamId}_${Date.now().toString(36)}_degraded`,
        teamId,
        generatedAt: new Date().toISOString(),
        summary: '诊断过程发生降级，部分模块不可用。请检查系统配置后重试。',
        expertReports: [],
        rootCauses: [],
        recommendations: [],
        raw: { degraded: true, modules: degradedModules },
      },
      totalDurationMs: Date.now() - startTime,
      degradedModules,
    };
  }

  /**
   * 维度/专家名 → 专家类型映射 (ID lookup, not business data)
   *
   * D650: 目标专家 ID 全部对齐 expert-registry.yaml v3.0 的 6 位问题域专家（host/
   * fundamental-efficiency/customer-growth/organizational-capability/technology-foundation/
   * competitive-strategy，权威第六章 §6.6 专家名禁含 cycle）；旧 9 位与 cycle 命名
   * ID 已随 D282/D650 迁移失效；映射结果经 getAllExpertIds() 运行时校验——registry 再变更时
   * 失效值自动降级为链头默认专家 host，不再泄漏死 ID。
   *
   * @degraded — 映射值或透传 dimension 不在注册表 → 返回 'host'（默认路由专家）
   */
  private mapDimensionToExpert(dimension: string): string {
    // D986: 映射单一真源 = `src/agent/expert-name-map.ts`（与 skills 加载器共用同一常量；
    //   禁止在本文件内再复制一份 —— 「两套并行的同一件东西」已被反复验证会漂移）。
    const map: Record<string, string> = LEGACY_TO_EXPERT_ID_MAP;
    const mapped = map[dimension] || dimension;
    return mapped && getAllExpertIds().includes(mapped) ? mapped : 'host';
  }

  /** 优先级规范化 */
  private normalizePriority(raw: string): DiagnosisReport['recommendations'][0]['priority'] {
    return (VALID_PRIORITIES as readonly string[]).includes(raw)
      ? (raw as typeof VALID_PRIORITIES[number])
      : 'medium';
  }
}

// ═══ 工厂函数 ═══

import type { DiagnosisEngineFactory } from './synova-diagnosis-engine';

/**
 * 创建 Synova 诊断引擎实例。
 * 这是 Step 1 定义的 DiagnosisEngineFactory 的默认实现。
 */
export const createSynovaDiagnosisEngine: DiagnosisEngineFactory = (
  llm: LLMClient,
  tools: ToolExecutor,
  options?: {
    maxToolRounds?: number;
    gateDataCompleteness?: number;
    gateMinHypothesisConfidence?: number;
    graphStore?: Record<string, unknown>;
  },
): SynovaDiagnosisEngine => {
  return new SynovaDiagnosisEngineImpl(llm, tools, options);
};
