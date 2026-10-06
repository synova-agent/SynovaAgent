/**
 * @synova/evolution — Synova L0 自我进化引擎
 *
 * 三层进化结构:
 *   第一层: 会话内学习 (SessionLearner) — 仅内存, 不持久化
 *   第二层: 组织自适应 (OrgAdapter) — 持久化到 AgentMemoryStore
 *   第三层: 全局进化 (GlobalAnalyzer) — 行业聚合 + 规则版本管理
 *
 * 架构定位: L0 横向切面, 不改变五层架构。
 * L0 读: L1 用户反馈, L3 哨兵结果/专家报告, L4 本体数据
 * L0 写: L3 阈值, L4 事实/基线, 扩展文件(行业模板/专家配置)
 */

// 类型导出
export type {
  // 通用
  EvolutionConfig,
  // 第一层
  SessionFeedback,
  SessionWeight,
  // 第二层
  CorrectionMemoryType,
  UserCorrection,
  ExtractedFact,
  ThresholdAdjustment,
  OrgAdaptationResult,
  // 第三层
  PerSentinelStats,
  IndustryBaseline,
  IndustryPattern,
  EvolutionProposal,
  ThresholdChange,
  ProposalStatus,
  // L0 接口
  L3WriteAPI,
  EvolutionEngineOptions,
  GraphStoreLike,
  AgentMemoryStoreLike,
  IndustryLoaderLike,
} from './evolution-types';

export { DEFAULT_EVOLUTION_CONFIG } from './evolution-types';

// feedback-collector 类型 + 函数导出
export type {
  FeedbackInput,
  FeedbackRecord,
} from './feedback-collector';

export {
  collectFeedback,
  getFeedbackByAction,
  getFeedbackByOrg,
} from './feedback-collector';

// org-adapter 导出
export { OrgAdapter } from './org-adapter';

// session-learner 导出
export { SessionLearner } from './session-learner';
export type { HypothesisFeedback, WeightEntry } from './session-learner';

// global-analyzer 导出
export {
  aggregateIndustryBaseline,
  writeIndustryThresholds,
  aggregateAllIndustries,
  discoverIndustryPatterns,
  // K6/3-12 E2/E3: 跨客户模式发现 + 联邦匿名统计（生产入口 src/routes/evolution.ts）
  discoverCrossCustomerPatterns,
  exportFederatedStats,
  importFederatedStats,
  generateThresholdProposal,
  listProposals,
  approveProposal,
  rejectProposal,
} from './global-analyzer';

// rule-version-manager 导出
export { RuleVersionManager } from './rule-version-manager';
export type { SnapshotEntry, RollbackResult, GradualRolloutInput } from './rule-version-manager';

// evolution-metrics 导出
export { EvolutionMetrics } from './evolution-metrics';
export type { MetricsSnapshot, OperationLogEntry } from './evolution-metrics';

// expert-evolution 导出
export {
  analyzeExpertCorrections,
  generateExpertProposal,
} from './expert-evolution';
export type { ExpertCorrectionStats, ExpertEvolutionAnalysis } from './expert-evolution';
export type { FeedbackEvent, CollectResult } from './feedback-collector';
export { collectAllFeedback } from './feedback-collector';
export { detectBehavioralValidation, aggregateExternalData, detectCostTemplateDrift, detectDiagnosisContradiction, updateSignalSourceWeight } from './org-adapter';
export type { GlobalAnalysisReport, NciGlobalPattern } from './global-analyzer';
export type {
  CrossCustomerPattern,
  CrossCustomerDiscoveryResult,
  DiscoverCrossCustomerOptions,
  FederatedSentinelStat,
  FederatedStatsBundle,
  ExportFederatedStatsInput,
  ExportFederatedStatsResult,
  ImportFederatedStatsOptions,
  ImportFederatedStatsResult,
} from './global-analyzer';
export { analyzeGlobalPatterns, detectNciGlobalPatterns } from './global-analyzer';
