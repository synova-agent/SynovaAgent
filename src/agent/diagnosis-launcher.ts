/**
 * agent/diagnosis-launcher.ts — 诊断启动器 (ConversationEngine 子组件)
 *
 * 铁律 39: L2 通过 DiagnosisEngine 接口调用引擎，不直接 import engine-core。
 * 职责: startDiagnosis() → 委托给 DiagnosisEngine → L4 后处理 (GraphBridge/CommunityReports/EntityResolver)
 */
import type { EngineContext } from './engine-context';
import type { DiagnosisEngine, DiagnosisEvent, ConsultationResult } from '../l2-interfaces/diagnosis-engine';
import { createLogger } from '@synova/logger';
// L4 访问: 运行时动态 import — 避免静态跨层依赖 (铁律 39, 审计 P0-20260618)
import { ContractGate } from "../contract/contract-gate";
import { ContractStore } from "../contract/contract-store";
import { runSafetyGate } from '../security/safety-guardrails';
import { getFaultRecovery } from '../services/fault-recovery';
// V4.4.4 T7b: L3 诊断模块 — 外部假设监控 + 平台依赖检查
import { checkExternalAssumptions } from '../l3/assumption-monitor';
import { checkPlatformDependencies } from '../l3/platform-dependency-check';
// D292: L2→L3 适配层 — L2 禁触 L4 (铁律 39)
import { createGraphTraversal } from '../l3/graph-traversal-adapter';
// V4.2.4: 内联 SessionStore 类型 — 避免 L2→L5 直接 import (铁律 39)
// D487: 导出 + 扩展 appendEvent 形状（事件类型内联联合 = SessionEventType 结构等价，
// SessionStore 可直接赋值；属性函数语法下严格派生须参数逆变一致），
// ConversationEngine.sessionStore / EngineConfig 复用此类型做装配。
export type SessionStoreLike = {
  saveDiagnosisCheckpoint?: (cp: { sessionId: string; phase: number; completedModules: string[]; partialReport: unknown; savedAt: string }) => void;
  appendEvent?: (
    sessionId: string,
    // 'tool_call' 与 session-store 的 SESSION_EVENT_TYPES 同步（#1257；转 type-only 需另裁）
    eventType: 'message' | 'tool_result' | 'tool_call' | 'system' | 'diagnosis_phase' | 'diagnosis_module' | 'diagnosis_report',
    payload: unknown,
  ) => { ok: true; seq: number } | { ok: false; degraded: true; error: string };
};

// 诊断检查点 — 每个 Phase 完成后保存状态到 SessionStore
interface DiagnosisCheckpoint {
  sessionId: string;
  phase: number;
  completedModules: string[];
  partialReport: unknown;
  savedAt: string;
}

const log = createLogger('agent/diagnosis-launcher');
// Fault recovery singleton for phase-level error handling
const faultRecovery = getFaultRecovery();

// Re-export for backward compat
export type { DiagnosisEvent, ConsultationResult };

export interface DiagnosisReport {
  keyFindings?: Array<{
    entity?: string; roleId?: string; riskLevel?: string;
    domains?: string[]; busFactor?: number;
  }>;
  [key: string]: unknown;
}

export class DiagnosisLauncher {
  private ctx: EngineContext;
  private engine: DiagnosisEngine;

  constructor(ctx: EngineContext, engine: DiagnosisEngine) {
    this.ctx = ctx;
    this.engine = engine;
  }

  async startDiagnosis(
    initiatorRole: string,
    initiatorName: string,
    onEvent?: (event: DiagnosisEvent) => void,
  ): Promise<ConsultationResult | null> {
    const teamId = this.ctx.orgId || 'default';
    const { eventBus, sessionId, graphBridge, graphStore, flags } = this.ctx;

    // ═══ D487: 诊断事件落流 — 阶段/模块/报告事件写 session_events（D500 地基装配） ═══
    // 契约:
    //   @input  — eventType ∈ diagnosis_phase|diagnosis_module|diagnosis_report + payload
    //   @output — void；store 未装配 → 跳过（可选依赖）；写入失败 → log.warn + 诊断继续（铁律 24/31）
    //   诊断事件 log-only: deriveMessages 投影跳过，不影响消息历史
    const persistEvent = (
      eventType: 'diagnosis_phase' | 'diagnosis_module' | 'diagnosis_report',
      payload: Record<string, unknown>,
    ): void => {
      try {
        const store: SessionStoreLike | undefined = (this.ctx as { sessionStore?: SessionStoreLike }).sessionStore;
        // 无 sessionId（引擎未装配会话 id）→ 跳过，事件不落 '' 桶（与 L622 addMessage 内存态兼容语义一致）
        if (!this.ctx.sessionId) return;
        if (!store?.appendEvent) return;
        const res = store.appendEvent(this.ctx.sessionId, eventType, payload);
        if (!res.ok) {
          log.warn({ sessionId: this.ctx.sessionId, eventType, error: res.error }, '诊断事件落流失败 — degraded');
        }
      } catch (err) {
        log.warn({ err, eventType }, '诊断事件落流异常 — degraded');
      }
    };
    // onEvent 透传 + 双写：phase_* → diagnosis_phase，其余（模块/发现/降级/错误）→ diagnosis_module
    const persistingOnEvent = (event: DiagnosisEvent): void => {
      onEvent?.(event);
      if (event.type === 'phase_started' || event.type === 'phase_completed') {
        persistEvent('diagnosis_phase', { type: event.type, phase: event.phase, label: event.label ?? null });
      } else {
        persistEvent('diagnosis_module', { type: event.type, phase: event.phase, label: event.label ?? null, message: event.message ?? null });
      }
    };

    try {
      // ═══ Batch 2: 六阶段追踪 — 每阶段发射 phase_started 事件 ═══
      // D215: 契约门禁 — 启动前验证接口契约
    try {
      const gate = new ContractGate(new ContractStore());
      const validation = await gate.validateAll();
      if (!validation.pass && !validation.degraded) {
        throw new Error(`D215 契约门禁未通过: ${validation.failures.length} 项失败`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "D215 契约门禁跳过 — 降级");
    }

    const phaseLabels = [
        '组织访谈', '数据采集', '假设生成', '根因分析', '报告生成', '交付',
      ];
      // Phase 0 完成信号 (ConversationEngine 已在 Phase 0 完成后调用 startDiagnosis)
      persistingOnEvent({ type: 'phase_started', phase: 1, label: phaseLabels[1], confidence: 0.9 });

      log.info({ teamId, initiatorRole }, '启动六阶段诊断');

      // P1-3: EvidenceManager 接线 — 加载证据 + 矛盾检测
      let evidenceSummary = '';
      if (this.ctx.evidenceCollector && this.ctx.corroborationEngine) {
        try {
          const allEvidence = this.ctx.evidenceCollector.query({ orgId: teamId, limit: 50 });
          if (allEvidence.length > 0) {
            evidenceSummary = allEvidence.map(e =>
              `[${e.type}|conf:${e.confidence}] ${e.content.slice(0, 150)}`
            ).join('\n');

            // 矛盾检测 — 标记高价值信号
            const contradictions = this.ctx.corroborationEngine.detectContradictions({ orgId: teamId });
            if (contradictions.length > 0) {
              log.info({ count: contradictions.length }, '证据矛盾检测完成');
              persistingOnEvent({ type: 'evidence_contradictions', phase: 1, message: `发现 ${contradictions.length} 处证据矛盾`, findings: contradictions.slice(0, 3).map(c => ({ moduleId: c.evidenceA?.id || 'evidence', summary: c.description || '矛盾信号', confidence: 1 - Math.min(c.scoreDifference, 1) })), confidence: 0.85 });
            }
          }
        } catch (err: any) {
          log.warn({ err }, '证据加载失败 — degraded, 诊断继续');
        }
      }

      // NRA 安全门禁 — 诊断前检查阶段覆盖+诚实标记
      const gate = runSafetyGate({
        diagnosisPhase: 1,
        completedPhases: new Set([0]),
        confidence: 0.5,
        auditEnabled: !!this.ctx.eventBus,
      });
      if (!gate.passed) {
        persistingOnEvent({ type: 'degraded', phase: 0, label: '安全门禁', message: gate.blockReasons.join('; ') });
      }

      // 诊断检查点保存 — 每个 Phase 完成后写入 SessionStore
      const saveCheckpoint = (phase: number, modules: string[], report: unknown) => {
        try {
          const store: SessionStoreLike | undefined = (this.ctx as { sessionStore?: SessionStoreLike }).sessionStore;
          if (store) {
            store.saveDiagnosisCheckpoint?.({
              sessionId: this.ctx.sessionId, phase, completedModules: modules,
              partialReport: report, savedAt: new Date().toISOString(),
            });
          }
        } catch (err) { log.warn({ err }, '检查点保存失败 — degraded'); }
      };

      // 铁律 39: L2 → DiagnosisEngine 接口 (不直接 import engine-core)
      const result = await this.engine.runConsultation(teamId, {
        role: initiatorRole,
        name: initiatorName,
        teamId,
        concerns: this.ctx.messages.filter(m => m.role === 'user').map(m => m.content.slice(0, 200)),
      }, persistingOnEvent);

      log.info({ teamId, durationMs: result.totalDurationMs, degraded: result.degradedModules.length }, '诊断完成');

      // D487: 报告事件落流 — 回放流的终点（阶段→模块→报告顺序）
      persistEvent('diagnosis_report', {
        teamId,
        phase: 5,
        summary: (result.report as { summary?: string } | undefined)?.summary ?? null,
        totalDurationMs: result.totalDurationMs,
        degradedModules: result.degradedModules,
      });

      // T7b: L3 诊断模块 — 外部假设监控 + 平台依赖检查 (通过 runModules 消费)
      if (graphStore && typeof graphStore.queryNodes === 'function') {
        const store = graphStore as Parameters<typeof checkExternalAssumptions>[0];
        // D338: 绑定 teamId 作为租户图 — 诊断遍历绝不回落全局 'default' 图
        const traversal = createGraphTraversal(store, teamId);
        checkExternalAssumptions(store, teamId, traversal)
          .then(ar => log.info({ teamId, totalAssumptions: ar.totalAssumptions, findings: ar.findings.length }, '外部假设监控完成'))
          .catch(err => log.warn({ err, teamId }, '[assumption-monitor] 异步失败'));
        checkPlatformDependencies(store, teamId, traversal)
          .then(pr => log.info({ teamId, totalDependencies: pr.totalDependencies, findings: pr.findings.length }, '平台依赖检查完成'))
          .catch(err => log.warn({ err, teamId }, '[platform-dependency-check] 异步失败'));
      }

      // FED-001: 联邦进化 — 诊断完成后上报质量信号 (差分隐私+加密)
      if (this.ctx.federalAdapter) {
        this.ctx.federalAdapter.reportQuality({
          diagnosisId: `diag_${teamId}_${Date.now().toString(36)}`,
          teamId,
          confirmRate: 0.8,
          adoptionRate: 0.7,
          phaseDurationMs: result.totalDurationMs,
          moduleCount: result.degradedModules.length,
        }).catch(err => log.warn({ err }, '联邦上报失败 — degraded'));
      }

      // L4 接线: GraphBridge — 诊断结果自动同步到本体图
      if (graphBridge) {
        const report = result.report as DiagnosisReport;
        try {
          if (report.keyFindings) {
            const risks = report.keyFindings
              .filter(f => f.riskLevel)
              .map(f => ({ roleId: f.entity || f.roleId || '', riskLevel: f.riskLevel || 'medium', knowledgeDomains: f.domains || [], busFactor: f.busFactor || 1 }));
            if (risks.length > 0) graphBridge.upsertFromKeyPersonRisk(risks);
          }
        } catch (err: any) {
          log.warn({ err }, 'GraphBridge sync failed — degraded');
        }

        // C6: 接入剩余 5 个 upsert 方法 (审计 P0-20260604)
        // 每个独立 try/catch — 单个数据段失败不影响其他

        // HONA — V4.2.4: hona 哨兵已删除 — 跳过

        // FinancialImpact — 财务影响分析
        try {
          const finData = (report as { financialImpact?: any; financial?: any }).financialImpact
            || (report as { financial?: any }).financial;
          if (finData?.items?.length > 0) {
            const result = graphBridge.upsertFromFinancialImpact(finData.items);
            if (result.errors.length > 0) log.warn({ errors: result.errors }, 'FinancialImpact sync — some errors');
            log.debug({ nodes: result.nodesCreated }, 'FinancialImpact 已同步到本体图');
          }
        } catch (err: any) { log.warn({ err }, 'FinancialImpact GraphBridge sync failed — degraded'); }

        // CapabilityGap — 能力缺口分析
        try {
          const capData = (report as { capabilityGap?: any; capabilities?: any }).capabilityGap
            || (report as { capabilities?: any }).capabilities;
          if (capData?.gaps?.length > 0) {
            const result = graphBridge.upsertFromCapabilityGap(capData.gaps);
            if (result.errors.length > 0) log.warn({ errors: result.errors }, 'CapabilityGap sync — some errors');
            log.debug({ nodes: result.nodesCreated }, 'CapabilityGap 已同步到本体图');
          }
        } catch (err: any) { log.warn({ err }, 'CapabilityGap GraphBridge sync failed — degraded'); }

        // SevenPowers — 七力战略分析
        try {
          const stratData = (report as { sevenPowers?: any; strategy?: any }).sevenPowers
            || (report as { strategy?: any }).strategy;
          if (stratData?.powers?.length > 0) {
            const result = graphBridge.upsertFromSevenPowers(stratData.powers);
            if (result.errors.length > 0) log.warn({ errors: result.errors }, 'SevenPowers sync — some errors');
            log.debug({ nodes: result.nodesCreated }, 'SevenPowers 已同步到本体图');
          }
        } catch (err: any) { log.warn({ err }, 'SevenPowers GraphBridge sync failed — degraded'); }

        // CPC — 关键流程链
        try {
          const cpcData = (report as { cpc?: any; processes?: any }).cpc
            || (report as { processes?: any }).processes;
          if (cpcData?.processes?.length > 0) {
            const result = graphBridge.upsertFromCPC(cpcData.processes);
            if (result.errors.length > 0) log.warn({ errors: result.errors }, 'CPC sync — some errors');
            log.debug({ nodes: result.nodesCreated, edges: result.edgesCreated }, 'CPC 已同步到本体图');
          }
        } catch (err: any) { log.warn({ err }, 'CPC GraphBridge sync failed — degraded'); }

        if (flags.enableCommunityReports && graphStore) {
          try {
            const { generateCommunityReports: genCR } = await import('../l3/community-reports-adapter');
            const communities = genCR(graphStore, teamId);
            log.info({ communityCount: communities.length }, '社区报告已生成');
            persistingOnEvent({ type: 'community_reports', phase: 2, message: `发现 ${communities.length} 个协作圈`, findings: communities.slice(0, 3).map((c: any) => ({ moduleId: c.id || 'community', summary: c.label || `协作圈 ${c.size || 0} 人`, confidence: c.confidence || 0.7 })), confidence: 0.7 });
          } catch (err: any) {
            log.warn({ err }, 'CommunityReports failed — degraded');
          }
        }
      }

      if (flags.enableEntityResolution && graphStore) {
        try {
          const { resolveEntitiesL3: resolveL3 } = await import('../l3/entity-resolver-adapter');
          const resolution = await resolveL3(graphStore, teamId);
          log.info({ autoMerged: resolution.autoMerged, queued: resolution.queuedForReview }, 'L3 实体解析完成');
          if (resolution.autoMerged > 0 || resolution.queuedForReview > 0) {
            persistingOnEvent({ type: 'entity_resolution', phase: 3,
              message: `发现 ${resolution.autoMerged} 对重复实体(自动合并), ${resolution.queuedForReview} 对待审核`,
              confidence: 0.8 });
          }
        } catch (err: any) {
          log.warn({ err }, 'EntityResolution failed — degraded');
        }
      }

      // Hermes 项目 10 接线: 诊断完成后触发后台质量审查 (fire-and-forget)
      if (this.ctx.provider) {
        import('../services/background-review').then(({ launchBackgroundReview }) => {
          launchBackgroundReview(this.ctx.provider, result.report, teamId);
        }).catch((err) => { log.warn({ err }, '后台审查启动失败 — degraded'); });
      }

      return {
        teamId: result.teamId,
        report: result.report,
        totalDurationMs: result.totalDurationMs,
        degradedModules: result.degradedModules,
      };
    } catch (err: any) {
      log.error({ err, teamId }, '诊断引擎启动失败');
      // D487: 失败也落流（回放可见失败诊断；persistingOnEvent 内部降级，不再抛出）
      persistingOnEvent({ type: 'error', phase: 0, label: '引擎错误', message: `诊断引擎不可用: ${err.message}` });
      return null;
    }
  }
}
