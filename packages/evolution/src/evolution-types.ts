/**
 * evolution-types.ts — L0 自我进化引擎类型定义
 *
 * 三层进化结构:
 *   第一层: 会话内学习 (In-Session) — 仅内存，不持久化
 *   第二层: 组织自适应 (Org Adaptation) — 持久化到 AgentMemoryStore
 *   第三层: 全局进化 (Global Evolution) — 行业聚合 + 规则版本管理
 *
 * 所有 types 使用文件驱动，不硬编码枚举。
 * 新增进化维度 = 加 type 字符串，不改代码。
 */

// ═══ 通用 ═══

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  minCorrectionsForThresholdAdjustment: 3,
  thresholdAdjustmentRatio: 0.2,
  minOrgsForIndustryAggregation: 5,
};

export interface EvolutionConfig {
  /** 触发 org-adapter 的最小纠错次数 (默认 3) */
  minCorrectionsForThresholdAdjustment: number;
  /** 阈值上调幅度 (默认 0.2 = 20%) */
  thresholdAdjustmentRatio: number;
  /** 全局进化触发的最小同行业组织数 (默认 5) */
  minOrgsForIndustryAggregation: number;
}

// ═══ 第一层: 会话内学习 ═══

export interface SessionFeedback {
  diagnosisId: string;
  /** 用户显式反馈的假设/哨兵 ID */
  targetId: string;
  /** 反馈类型 */
  type: 'hypothesis_negated' | 'hypothesis_confirmed' | 'dimension_focus';
  /** 用户提供的理由 */
  reason?: string;
  /** 用户提供的替代值 (如 "实际现金流 500 万") */
  correctionValue?: string;
  /** 会话中情绪强度 (0-1) */
  intensity?: number;
}

export interface SessionWeight {
  targetId: string;
  weight: number;
  reason: string;
}

// ═══ 第二层: 组织自适应 ═══

export type CorrectionMemoryType =
  | 'user_correction'
  | 'threshold_adjustment'
  | 'industry_baseline'
  | 'evolution_snapshot';

export interface UserCorrection {
  sentinelId: string;
  findingId: string;
  correctedClaims: string[];
  /** 从 reason 解析出的结构化事实 */
  facts: ExtractedFact[];
  timestamp: string;
}

export interface ExtractedFact {
  /** 节点类型, 如 'Financial' */
  nodeType: string;
  /** 属性名, 如 'cash' */
  field: string;
  /** 属性值, 解析后的数值 */
  value: number | string;
  /** 用户原始表述 */
  rawText: string;
}

export interface ThresholdAdjustment {
  sentinelId: string;
  oldThreshold: { warning: number; critical: number };
  newThreshold: { warning: number; critical: number };
  correctionCount: number;
  reason: string;
  adjustedAt: string;
}

export interface OrgAdaptationResult {
  correctionsProcessed: number;
  factsWritten: number;
  ticketsClosed: number;
  thresholdsAdjusted: Array<{ sentinelId: string; old: number; new: number }>;
  errors: string[];
  degraded: boolean;
}

// ═══ 第三层: 全局进化 ═══

export interface PerSentinelStats {
  sentinelId: string;
  name: string;
  orgCount: number;
  values: number[];
  median: number;
  p25: number;
  p75: number;
}

export interface IndustryBaseline {
  industry: string;
  aggregatedAt: string;
  sentinelStats: PerSentinelStats[];
  /** 与通用阈值偏差显著的哨兵 */
  thresholdSuggestions: Array<{
    sentinelId: string;
    generalThreshold: { warning: number; critical: number };
    industryMedian: number;
    suggestion: string;
  }>;
}

export interface IndustryPattern {
  type: 'threshold_calibration' | 'common_pitfall' | 'knowledge_gap';
  sentinelId: string;
  evidence: string;
  suggestion: string;
  orgCount: number;
}

// ═══ Phase P2: 进化提案 ═══

export interface ThresholdChange {
  sentinelId: string;
  from: { warning: number; critical: number };
  to: { warning: number; critical: number };
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied';

// ═══ K6-E9（#539）: 提案链 typed payload 通道 ═══
// 四类按层分型的回写载荷放在 typedChanges（① 循环 / ② 本体 / ④ 先验 / ⑤ 导航）；
// 既有 changes: ThresholdChange[] 字段契约**冻结不动**（③ 阈值通道，存量提案与
// global-analyzer approveProposal 的灰度链依赖其形态 —— 本卡写集不含 global-analyzer.ts）。
// 类型从 proposal-payloads.ts 声明（每类判据自声明，见 PAYLOAD_CONTRACTS）。

export interface EvolutionProposal {
  id: string;
  /** 提案类型: 阈值调整 / 模式发现 / K6-E9 四类层型回写 */
  type:
    | 'threshold_adjustment'
    | 'pattern_discovery'
    | 'loop_param'
    | 'ontology_change'
    | 'param_prior'
    | 'nav_weight';
  title: string;
  description: string;
  /** 关联行业 */
  industry: string;
  /** 具体的阈值变更列表（③ 阈值通道 —— 字段契约冻结） */
  changes: ThresholdChange[];
  /** K6-E9: 四类 typed payload（① loop-param / ② ontology / ④ param-prior / ⑤ nav-weight） */
  typedChanges?: Array<import('./proposal-payloads').TypedChange>;
  /** 风险评估: 影响多少个 org */
  risk: 'low' | 'medium' | 'high';
  /** 影响范围评估 */
  impactEstimate: { orgCount: number; sentinelIds: string[] };
  /** 证据 / 为什么需要此变更 */
  evidence: string;
  /** 状态机: pending → approved/rejected → applied */
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  /** 审批通过后被应用的快照 ID */
  appliedSnapshotId?: string;
  /** 灰度百分比历史 */
  rolloutPercentage?: number;
  /** K6-E9: applied 置位时间（谁置的/依据哪条 approve 见 appliedBy/approvedRef） */
  appliedAt?: string;
  /** K6-E9: 置位者（恒 'system:evolution-writeback' —— 引擎单写入口） */
  appliedBy?: string;
  /** K6-E9: 依据的批准记录引用（L0 ⇒ 'auto:L0:<proposalId>'；L1 ⇒ approve 记录 id） */
  approvedRef?: string;
}

// ═══ L3 Write API 类型 (由 sentinel/runner.ts 实现) ═══

export interface L3WriteAPI {
  closeTicket(orgId: string, sentinelId: string): Promise<number>;
  getThreshold(orgId: string, sentinelId: string): Promise<{ warning: number; critical: number } | null>;
  updateThreshold(orgId: string, sentinelId: string, threshold: { warning?: number; critical?: number }): Promise<void>;
  getSentinelStats(industry: string): Promise<PerSentinelStats[]>;
}

// ═══ L0 Engine 主类型 ═══

export interface EvolutionEngineOptions {
  l3: L3WriteAPI | null;
  l4: {
    graphStore: GraphStoreLike;
    memoryStore: AgentMemoryStoreLike;
    industryLoader: IndustryLoaderLike;
  };
  config?: Partial<EvolutionConfig>;
}

export interface GraphStoreLike {
  createNode(type: string, props: Record<string, unknown>, graph: string): string;
  updateNode(id: string, props: Record<string, unknown>, graph: string): void;
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; type: string; props: Record<string, unknown> }>;
  getNode(id: string, graph: string): unknown | null;
}

export interface AgentMemoryStoreLike {
  remember(entry: {
    orgId: string; key: string; value: string; type: string;
    confidence: number; source: string; tags: string[];
    expiresAt: string | null;
  }): unknown;
  recall(orgId: string, key: string): { value: string } | null;
  list(query: { orgId: string; type?: string; tags?: string[]; limit?: number }): Array<{ value: string; tags: string[]; type: string; key: string }>;
  forget(orgId: string, key: string): boolean;
}

export interface IndustryLoaderLike {
  getIndustry(name: string): { name: string; displayName: string; extends?: string } | null;
  listIndustries(): string[];
  clearIndustryCache(): void;
}
