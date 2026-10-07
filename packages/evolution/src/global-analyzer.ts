/**
 * global-analyzer.ts — 全局进化引擎 (L0 进化层｜第三层)
 *
 * 每月触发。跨组织聚合学习 → 更新行业扩展 JSON 文件。
 * 人工审核门禁。灰度发布。可回滚 (由 rule-version-manager 管理)。
 *
 * 核心功能:
 *   1. aggregateIndustryBaseline() — 聚合行业哨兵阈值 → thresholds.json
 *   2. discoverIndustryPatterns() — 跨组织模式识别 → common-pitfalls.md
 *
 * 数据隐私: 只提取统计特征 (median/p25/p75), 不提取个体数据。
 * 文件驱动: 产出写入 extensions/industries/{name}/ 目录, 不改 TypeScript。
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';
import type {
  L3WriteAPI, PerSentinelStats, IndustryBaseline,
  AgentMemoryStoreLike, EvolutionProposal, ThresholdChange, ProposalStatus,
  IndustryPattern,
} from './evolution-types';
import { DEFAULT_EVOLUTION_CONFIG } from './evolution-types';
import { RuleVersionManager } from './rule-version-manager';

const log = createLogger('evolution/global-analyzer');

// ═══ 扩展目录 ═══

const INDUSTRIES_DIR = join(process.cwd(), 'extensions', 'industries');
const EVOLUTION_DIR = join(process.cwd(), 'extensions', 'evolution');
const THRESHOLDS_FILE = join(EVOLUTION_DIR, 'default-thresholds.json');

// ═══ 文件驱动阈值加载 ═══
// 优先读取 `extensions/evolution/default-thresholds.json`。
// 文件不存在或解析失败时静默降级到编译期默认值。
// 缓存到模块级变量，进程内复用。

interface ThresholdsFile {
  version: string;
  thresholds: Record<string, { warning: number; critical: number }>;
}

/** 编译期 fallback 阈值（JSON 文件不可用时的安全网） */
const THRESHOLDS_FALLBACK: Record<string, { warning: number; critical: number }> = {
  F1_KZ: { warning: 1.5, critical: 2.0 },
  F2_runway: { warning: 12, critical: 6 },
  F3_revenue_quality: { warning: 0.3, critical: 0.15 },
  F4_profit_quality: { warning: 0.3, critical: 0.15 },
  F5_cash_conversion: { warning: 0.5, critical: 0.3 },
  O1_info_distortion: { warning: 0.4, critical: 0.6 },
  O2_explore_exploit: { warning: 0.3, critical: 0.5 },
  O3_talent_density: { warning: 0.3, critical: 0.5 },
  T1_software_health: { warning: 0.4, critical: 0.6 },
  T2_connector_coverage: { warning: 0.3, critical: 0.5 },
};

/** 运行时缓存 */
let _thresholdsCache: Record<string, { warning: number; critical: number }> | null = null;

/**
 * 加载通用默认哨兵阈值。
 * 优先级：JSON 文件 > 编译期 fallback
 * 缓存：首次读取后缓存到进程结束
 */
function loadDefaultThresholds(): Record<string, { warning: number; critical: number }> {
  if (_thresholdsCache) return _thresholdsCache;

  try {
    if (existsSync(THRESHOLDS_FILE)) {
      const raw = readFileSync(THRESHOLDS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as ThresholdsFile;
      if (parsed.thresholds && Object.keys(parsed.thresholds).length > 0) {
        _thresholdsCache = parsed.thresholds;
        log.debug({ path: THRESHOLDS_FILE, count: Object.keys(parsed.thresholds).length }, '默认阈值已加载');
        return _thresholdsCache;
      }
      log.warn({ path: THRESHOLDS_FILE }, 'JSON 中 thresholds 为空 — 使用 fallback');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, path: THRESHOLDS_FILE }, '阈值 JSON 加载失败 — 使用 fallback');
  }

  _thresholdsCache = THRESHOLDS_FALLBACK;
  return _thresholdsCache;
}

// ═══ 核心函数 ═══

/**
 * 聚合指定行业的哨兵得分 → 计算行业中位数 → 与通用阈值对比 →
 * 写入行业专属 thresholds.json。
 *
 * @param industry 行业名称 (对应 extensions/industries/{name}/)
 * @param l3 L3WriteAPI 实例 (用于 getSentinelStats)
 * @returns 行业基线数据
 */
export async function aggregateIndustryBaseline(
  industry: string,
  l3: L3WriteAPI,
): Promise<IndustryBaseline> {
  const stats = await l3.getSentinelStats(industry);

  if (stats.length === 0) {
    log.warn({ industry }, '行业哨兵数据不足 — 跳过聚合');
    return {
      industry,
      aggregatedAt: new Date().toISOString(),
      sentinelStats: [],
      thresholdSuggestions: [],
    };
  }

  // 对比通用阈值, 生成调整建议
  const suggestions: IndustryBaseline['thresholdSuggestions'] = [];
  for (const stat of stats) {
    const general = loadDefaultThresholds()[stat.sentinelId];
    if (!general) continue;

    // 如果行业中位数与通用临界值偏差 > 20% → 建议调整
    const deviation = Math.abs(stat.median - general.critical) / general.critical;
    if (deviation > 0.2 && stat.orgCount >= DEFAULT_EVOLUTION_CONFIG.minOrgsForIndustryAggregation) {
      suggestions.push({
        sentinelId: stat.sentinelId,
        generalThreshold: general,
        industryMedian: stat.median,
        suggestion: `行业中位数 ${stat.median} 与通用阈值 ${general.critical} 偏差 ${(deviation * 100).toFixed(0)}% — 建议调整为 ${stat.median}`,
      });
    }
  }

  const baseline: IndustryBaseline = {
    industry,
    aggregatedAt: new Date().toISOString(),
    sentinelStats: stats,
    thresholdSuggestions: suggestions,
  };

  // 写入 JSON 文件
  writeIndustryThresholds(industry, baseline);

  log.info({
    industry,
    sentinelCount: stats.length,
    suggestions: suggestions.length,
  }, '行业基线聚合完成');

  return baseline;
}

/**
 * 将行业基线与阈值建议写入 extensions/industries/{name}/thresholds.json。
 */
export function writeIndustryThresholds(industry: string, baseline: IndustryBaseline): void {
  const dir = join(INDUSTRIES_DIR, industry);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, 'thresholds.json');
  const thresholds: Record<string, { warning: number; critical: number }> = {};

  // 从哨兵统计提取行业中位数作为阈值
  for (const stat of baseline.sentinelStats) {
    const defaultThreshold = loadDefaultThresholds()[stat.sentinelId];
    thresholds[stat.sentinelId] = {
      warning: defaultThreshold?.warning ?? 0.5,
      critical: defaultThreshold?.critical ?? 1.0,
    };
  }

  // 应用调整建议 (用行业中位数覆盖)
  for (const suggestion of baseline.thresholdSuggestions) {
    if (thresholds[suggestion.sentinelId]) {
      thresholds[suggestion.sentinelId] = {
        ...thresholds[suggestion.sentinelId],
        critical: suggestion.industryMedian,
      };
    }
  }

  const output = {
    industry,
    aggregatedAt: baseline.aggregatedAt,
    thresholdOverrides: thresholds,
  };

  writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
  log.info({ industry, path: filePath, thresholdCount: Object.keys(thresholds).length }, '行业阈值已写入');
}

/**
 * 批量聚合所有已注册行业的基线。
 * 由 Cron 定时触发 (每月)。
 */
export async function aggregateAllIndustries(
  l3: L3WriteAPI,
  industries: string[],
): Promise<IndustryBaseline[]> {
  const results: IndustryBaseline[] = [];

  for (const industry of industries) {
    try {
      const baseline = await aggregateIndustryBaseline(industry, l3);
      results.push(baseline);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, industry }, '行业聚合失败 — 降级继续');
    }
  }

  return results;
}

// ═══ Phase P2: 模式发现 ═══

/**
 * 跨组织模式发现。
 * 读取所有 user_correction 记忆，按 sentinelId 分组，
 * 统计每个 sentinel 被多少个不同组织纠错过。
 * 如果同一 sentinel 被 ≥3 个同行业组织纠错过 → 系统级模式。
 *
 * @param memoryStore AgentMemoryStore 实例
 * @param orgIds 已知组织 ID 列表（用于过滤）
 * @returns 发现的模式列表
 */
export async function discoverIndustryPatterns(
  memoryStore: AgentMemoryStoreLike,
  orgIds?: string[],
): Promise<IndustryPattern[]> {
  const patterns: IndustryPattern[] = [];
  const sentinelOrgs = new Map<string, Set<string>>();

  // 如果传入了 orgIds，逐个查询
  const queryOrgs = orgIds && orgIds.length > 0 ? orgIds : ['default'];
  for (const orgId of queryOrgs) {
    try {
      const corrections = memoryStore.list({
        orgId,
        type: 'enterprise_fact',
        tags: ['user_correction'],
        limit: 100,
      });
      for (const entry of corrections) {
        try {
          const parsed = JSON.parse(entry.value) as { sentinelId?: string };
          if (parsed.sentinelId) {
            if (!sentinelOrgs.has(parsed.sentinelId)) {
              sentinelOrgs.set(parsed.sentinelId, new Set());
            }
            sentinelOrgs.get(parsed.sentinelId)!.add(orgId);
          }
        } catch { /* skip corrupt */ }
      }
    } catch (err: unknown) {
      log.warn({ err, orgId }, '模式发现 — 组织查询失败（降级继续）');
    }
  }

  // 提取 ≥3 个组织都有纠错的哨兵
  for (const [sentinelId, orgs] of sentinelOrgs) {
    if (orgs.size >= DEFAULT_EVOLUTION_CONFIG.minCorrectionsForThresholdAdjustment) {
      patterns.push({
        type: 'threshold_calibration',
        sentinelId,
        evidence: `${orgs.size} 个组织纠错过此哨兵`,
        suggestion: `此哨兵被 ${orgs.size} 个组织纠错 — 建议检查通用阈值是否适用于所有组织`,
        orgCount: orgs.size,
      });
    }
  }

  if (patterns.length > 0) {
    log.info({ patternCount: patterns.length }, '模式发现完成');
  }
  return patterns;
}

// ═══ Phase P2: 提案管理 ═══

function generateProposalId(): string {
  return `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 将阈值调整建议包装为 EvolutionProposal。
 * 每个提案包含具体的变更列表、影响评估、和证据。
 *
 * @param industry 关联行业
 * @param suggestions 阈值调整建议列表
 * @param memoryStore 可选 — 用于评估影响范围
 * @returns 提案
 */
export async function generateThresholdProposal(
  industry: string,
  suggestions: IndustryBaseline['thresholdSuggestions'],
  memoryStore?: AgentMemoryStoreLike,
): Promise<EvolutionProposal> {
  const now = new Date().toISOString();
  const changes: ThresholdChange[] = suggestions.map(s => ({
    sentinelId: s.sentinelId,
    from: s.generalThreshold,
    to: { warning: s.generalThreshold.warning, critical: s.industryMedian },
  }));

  const orgCount = 0; // 影响评估需要跨组织查询，当前简化处理
  const sentinelIds = changes.map(c => c.sentinelId);
  const highRisk = changes.some(c => Math.abs(c.to.critical - c.from.critical) / c.from.critical > 0.5);
  const severity = changes.length >= 3 ? 'high' : changes.length >= 1 ? 'medium' : 'low';

  const proposal: EvolutionProposal = {
    id: generateProposalId(),
    type: 'threshold_adjustment',
    title: `${industry} 行业阈值校准 — ${changes.length} 个哨兵`,
    description: `基于 ${suggestions.length} 个行业中位数与通用阈值的偏差分析`,
    industry,
    changes,
    risk: highRisk ? 'high' : severity as 'low' | 'medium' | 'high',
    impactEstimate: { orgCount, sentinelIds },
    evidence: suggestions.map(s => s.suggestion).join('; '),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  // 持久化到 AgentMemoryStore
  if (memoryStore) {
    try {
      memoryStore.remember({
        orgId: 'global',
        key: `proposal_${proposal.id}`,
        value: JSON.stringify(proposal),
        type: 'enterprise_fact',
        confidence: 0.8,
        source: 'global_analyzer',
        tags: ['proposal', industry, proposal.status],
        expiresAt: null,
      });
      log.info({ proposalId: proposal.id, industry, changes: changes.length }, '提案已创建');
    } catch (err: unknown) {
      log.warn({ err }, '提案持久化失败 — 降级返回内存提案');
    }
  }

  return proposal;
}

/**
 * 列出提案，可选按状态过滤。
 *
 * @param memoryStore AgentMemoryStore 实例
 * @param status 可选 — 按状态过滤
 * @returns 提案列表
 */
export function listProposals(
  memoryStore: AgentMemoryStoreLike,
  status?: ProposalStatus,
): EvolutionProposal[] {
  try {
    const entries = memoryStore.list({
      orgId: 'global',
      type: 'enterprise_fact',
      tags: ['proposal'],
      limit: 100,
    });

    const proposals: EvolutionProposal[] = [];
    for (const entry of entries) {
      try {
        const p = JSON.parse(entry.value) as EvolutionProposal;
        if (p.id && p.status) {
          if (!status || p.status === status) {
            proposals.push(p);
          }
        }
      } catch { /* skip corrupt */ }
    }

    // 按创建时间降序
    proposals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return proposals;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, 'listProposals 失败 — degraded');
    return [];
  }
}

/**
 * 审批通过一个提案。
 * 流程：快照 → 渐灰发布 → 标记 applied
 *
 * @param memoryStore AgentMemoryStore 实例
 * @param proposalId 提案 ID
 * @param l3 L3WriteAPI 实例
 * @param rvm RuleVersionManager 实例
 * @param orgPool 可选 — 灰度发布的目标组织池
 * @returns 更新后的提案
 */
export async function approveProposal(
  memoryStore: AgentMemoryStoreLike,
  proposalId: string,
  l3: L3WriteAPI,
  rvm: RuleVersionManager,
  orgPool?: string[],
): Promise<EvolutionProposal | null> {
  try {
    const stored = memoryStore.recall('global', `proposal_${proposalId}`);
    if (!stored) {
      log.warn({ proposalId }, '提案不存在');
      return null;
    }

    const proposal = JSON.parse(stored.value) as EvolutionProposal;
    if (proposal.status !== 'pending') {
      log.warn({ proposalId, status: proposal.status }, '提案状态不允许审批');
      return null;
    }

    // 1. 创建快照
    const snapshotId = await rvm.createSnapshot(`approve:${proposalId} — ${proposal.title}`);
    if (!snapshotId) {
      log.warn({ proposalId }, '快照创建失败 — 审批中止');
      return null;
    }

    // 2. 渐灰发布阈值变更
    const pool = orgPool && orgPool.length > 0 ? orgPool : ['default'];
    const thresholdInput = proposal.changes.map(c => ({
      sentinelId: c.sentinelId,
      warning: c.to.warning,
      critical: c.to.critical,
    }));

    // 第一阶段: 10% 灰度
    await rvm.gradualRollout({ orgPool: pool, percentage: 10, thresholds: thresholdInput });

    // 3. 更新提案状态
    proposal.status = 'approved';
    proposal.updatedAt = new Date().toISOString();
    proposal.appliedSnapshotId = snapshotId;
    proposal.rolloutPercentage = 10;

    memoryStore.remember({
      orgId: 'global',
      key: `proposal_${proposalId}`,
      value: JSON.stringify(proposal),
      type: 'enterprise_fact',
      confidence: 0.9,
      source: 'global_analyzer',
      tags: ['proposal', proposal.industry, 'approved'],
      expiresAt: null,
    });

    log.info({
      proposalId, snapshotId, changes: proposal.changes.length,
      rolloutPercentage: 10,
    }, '提案已审批 — 10% 灰度发布中');

    return proposal;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId }, '提案审批失败');
    return null;
  }
}

/**
 * 拒绝一个提案。仅 pending 状态的提案可拒绝。
 *
 * @returns 更新后的提案，或 null（不存在/状态不匹配）
 */
export async function rejectProposal(
  memoryStore: AgentMemoryStoreLike,
  proposalId: string,
): Promise<EvolutionProposal | null> {
  try {
    const stored = memoryStore.recall('global', `proposal_${proposalId}`);
    if (!stored) {
      log.warn({ proposalId }, '提案不存在');
      return null;
    }

    const proposal = JSON.parse(stored.value) as EvolutionProposal;
    if (proposal.status !== 'pending') {
      log.warn({ proposalId, status: proposal.status }, '提案状态不允许拒绝');
      return null;
    }

    proposal.status = 'rejected';
    proposal.updatedAt = new Date().toISOString();

    memoryStore.remember({
      orgId: 'global',
      key: `proposal_${proposalId}`,
      value: JSON.stringify(proposal),
      type: 'enterprise_fact',
      confidence: 1.0,
      source: 'global_analyzer',
      tags: ['proposal', proposal.industry, 'rejected'],
      expiresAt: null,
    });

    log.info({ proposalId }, '提案已拒绝');
    return proposal;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, proposalId }, '提案拒绝失败');
    return null;
  }
}

// ═══ v3 新增 ═══
export interface GlobalAnalysisReport { analyzedAt: string; industryCount: number; proposals: EvolutionProposal[]; nciPatterns: NciGlobalPattern[]; degraded: boolean; }
export interface NciGlobalPattern { patternId: string; description: string; affectedIndustries: string[]; severity: 'info' | 'warning' | 'critical'; }

export function analyzeGlobalPatterns(options?: { since?: string; industries?: string[] }): GlobalAnalysisReport {
  try { log.info({ options }, 'analyzeGlobalPatterns triggered'); } catch (err: unknown) { log.warn({ err }, 'analyzeGlobalPatterns failed'); }
  return { analyzedAt: new Date().toISOString(), industryCount: options?.industries?.length || 0, proposals: [], nciPatterns: [], degraded: false };
}
export function detectNciGlobalPatterns(): NciGlobalPattern[] { return []; }

// ═══ K6/3-12: 跨客户模式发现 (E2) + 联邦匿名统计 (E3) ═══
//
// 卡面 3-12「跨客户/联邦回环」:
//   E2 —— 模式发现不再依赖调用方逐个传 orgId（自动枚举组织）。既有 discoverIndustryPatterns
//         在未传 orgIds 时退化为 ['default']（只看到一个客户），结构上不可能产出跨客户模式。
//   E3 —— 单实例把自己的行业统计匿名导出、并从别处导入（联邦学习最小闭环）。
//
// 诚实边界（卡面失效条件 4）: 本模块不联网、不读密钥、不引入外部依赖。
// E3 的传输（文件/HTTP/消息队列）由调用方负责；本模块只做「匿名包构造 → 校验 → 采纳」，
// 即"注入式联邦源"：入参就是数据源。这样联邦闭环在没有网络凭据的机器上也能被真实执行与验证。

/** K6/3-12 E2: 组织枚举接缝 —— 见 discoverCrossCustomerPatterns 契约。 */
export type OrgEnumerator = () => string[] | Promise<string[]>;

/**
 * K6/3-12 E2: store 的可选组织枚举能力（能力探测，不修改 AgentMemoryStoreLike 契约，
 * 因此不破坏既有实现与既有调用方）。
 */
export interface OrgEnumeratingStoreLike {
  /** @output 组织 ID 列表（可含重复/空串，调用方会清洗）；抛错 ⇒ 调用方 log.warn + degraded:true */
  listOrgs?: () => string[];
}

/**
 * K6/3-12 E2: 一条跨客户模式。
 *
 * 🔴 D1195/P0-1 边界（创始人红线「A 客户不能读 B 客户数据」）：本结构**只带客户数量**
 * （`orgCount`），**绝不回传客户标识** —— 贡献客户清单仅存在于 `discoverCrossCustomerPatterns`
 * 的内部局部变量中，不进任何返回值/日志。
 */
export interface CrossCustomerPattern {
  /** 稳定 ID：`xcp_<sentinelId>`（同一哨兵在一次分析中只产出一条） */
  patternId: string;
  type: IndustryPattern['type'];
  sentinelId: string;
  /** 贡献该模式的组织（去重、字典序升序） */
  /** 参与该模式的客户数（k-匿名：**不回传客户标识**，见 discoverCrossCustomerPatterns 契约） */
  orgCount: number;
  evidence: string;
  suggestion: string;
}

/** K6/3-12 E2: 发现结果。含组织枚举账目，使"自动枚举真的发生了"可对账（变异体锚点）。 */
export interface CrossCustomerDiscoveryResult {
  /** 按 orgCount 降序、同数按 sentinelId 升序（确定性输出） */
  patterns: CrossCustomerPattern[];
  /**
   * 实际枚举到并尝试查询的客户**数量**（k-匿名：客户标识仅存在于内部局部变量，
   * **绝不进返回体/日志** —— 创始人红线「A 客户不能读 B 客户数据」）
   */
  orgsConsideredCount: number;
  /** 查询失败被跳过的客户**数量**（> 0 即 degraded；同样不回传标识） */
  orgsFailedCount: number;
  /** 无法解析的记忆条目数（corrupt —— 计数 + log.warn，不静默） */
  unparsableEntries: number;
  degraded: boolean;
}

/** K6/3-12 E2: 选项。 */
export interface DiscoverCrossCustomerOptions {
  /** 显式组织清单（最高优先；运维/测试用） */
  orgIds?: string[];
  /** 注入式枚举器（次优先；无网络，来源由调用方决定） */
  orgEnumerator?: OrgEnumerator;
  /** 跨客户门槛，默认 DEFAULT_EVOLUTION_CONFIG.minCorrectionsForThresholdAdjustment (=3) */
  minOrgs?: number;
  /** 每个组织读取条目上限，默认 100 */
  limitPerOrg?: number;
  /** 记忆类型过滤，默认 'enterprise_fact' */
  memoryType?: string;
  /** 记忆标签过滤，默认 ['user_correction'] */
  tags?: string[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 清洗组织清单：去空 → 去重 → 字典序升序（确定性）。 */
function normalizeOrgIds(orgIds: string[]): string[] {
  const cleaned = orgIds
    .filter(id => typeof id === 'string' && id.trim().length > 0)
    .map(id => id.trim());
  return [...new Set(cleaned)].sort();
}

/**
 * K6/3-12 E2 内部: 解析组织清单（显式 orgIds > 注入 orgEnumerator > store 的 listOrgs 能力探测）。
 *
 * 契约（铁律 47）:
 *   @input  — memoryStore（含可选 listOrgs 能力）、options（见 DiscoverCrossCustomerOptions）
 *   @output — { ok: true, orgIds } 正常；{ ok: false, orgIds: [], reason } 无可用来源或枚举抛错/为空
 *   @degraded — ok=false 时调用方置 degraded；本函数内已 log.warn（不静默，铁律 24/31）
 */
async function resolveCrossCustomerOrgs(
  memoryStore: AgentMemoryStoreLike & OrgEnumeratingStoreLike,
  options: DiscoverCrossCustomerOptions,
): Promise<{ ok: boolean; orgIds: string[]; reason?: string }> {
  if (options.orgIds && options.orgIds.length > 0) {
    return { ok: true, orgIds: normalizeOrgIds(options.orgIds) };
  }

  if (options.orgEnumerator) {
    try {
      const enumerated = await options.orgEnumerator();
      const orgIds = normalizeOrgIds(Array.isArray(enumerated) ? enumerated : []);
      if (orgIds.length === 0) {
        log.warn({}, '跨客户模式 — 注入的组织枚举器返回空清单（degraded，0 组织）');
        return { ok: false, orgIds: [], reason: 'orgEnumerator returned empty' };
      }
      return { ok: true, orgIds };
    } catch (err: unknown) {
      log.warn({ err: errorMessage(err) }, '跨客户模式 — 组织枚举器抛错（degraded，0 组织）');
      return { ok: false, orgIds: [], reason: 'orgEnumerator threw' };
    }
  }

  if (typeof memoryStore.listOrgs === 'function') {
    try {
      const orgIds = normalizeOrgIds(memoryStore.listOrgs());
      if (orgIds.length === 0) {
        log.warn({}, '跨客户模式 — store.listOrgs() 返回空清单（degraded，0 组织）');
        return { ok: false, orgIds: [], reason: 'listOrgs returned empty' };
      }
      return { ok: true, orgIds };
    } catch (err: unknown) {
      log.warn({ err: errorMessage(err) }, '跨客户模式 — store.listOrgs() 抛错（degraded，0 组织）');
      return { ok: false, orgIds: [], reason: 'listOrgs threw' };
    }
  }

  log.warn({}, '跨客户模式 — 无组织枚举来源（未传 orgIds/orgEnumerator 且 store 无 listOrgs）⇒ 0 组织（degraded）');
  return { ok: false, orgIds: [], reason: 'no org enumeration source' };
}

/**
 * K6/3-12 E2: 跨客户模式发现 —— 自动枚举组织，找出被 ≥ minOrgs 个不同客户纠错过的哨兵。
 *
 * 与 discoverIndustryPatterns 的差别: 后者未传 orgIds 时退化为 ['default']（单客户，结构上
 * 不可能产出跨客户模式）；本函数要求"自动枚举"能力显式存在，并把枚举账目写进返回值。
 *
 * 契约（铁律 47）:
 *   @input  — memoryStore: AgentMemoryStoreLike（+ 可选 listOrgs() 能力）；
 *             options.orgIds 显式清单 / options.orgEnumerator 注入枚举器 / options.minOrgs 门槛
 *             （默认 3）/ options.limitPerOrg（默认 100）/ options.memoryType、tags 记忆过滤
 *   @output — CrossCustomerDiscoveryResult；patterns 按 orgCount 降序 + sentinelId 升序（确定性）
 *   @degraded — true ⇔ 组织枚举来源不可用/抛错/为空，或 ≥1 个组织查询失败（两者都 log.warn）。
 *               单组织失败不阻断其它组织（降级继续）；corrupt 条目计入 unparsableEntries 并 log.warn
 *   @throws  — 不抛（内部全部收敛为 degraded 结果）
 */
export async function discoverCrossCustomerPatterns(
  memoryStore: AgentMemoryStoreLike & OrgEnumeratingStoreLike,
  options: DiscoverCrossCustomerOptions = {},
): Promise<CrossCustomerDiscoveryResult> {
  const minOrgs = options.minOrgs ?? DEFAULT_EVOLUTION_CONFIG.minCorrectionsForThresholdAdjustment;
  const limitPerOrg = options.limitPerOrg ?? 100;
  const memoryType = options.memoryType ?? 'enterprise_fact';
  const tags = options.tags ?? ['user_correction'];

  const orgs = await resolveCrossCustomerOrgs(memoryStore, options);
  const degradedByEnumeration = !orgs.ok;
  const orgsFailed: string[] = [];
  const sentinelOrgs = new Map<string, Set<string>>();
  let unparsableEntries = 0;

  for (const orgId of orgs.orgIds) {
    try {
      const entries = memoryStore.list({ orgId, type: memoryType, tags, limit: limitPerOrg });
      for (const entry of entries) {
        try {
          const parsed = JSON.parse(entry.value) as { sentinelId?: unknown };
          const sentinelId = typeof parsed.sentinelId === 'string' ? parsed.sentinelId.trim() : '';
          if (!sentinelId) {
            unparsableEntries++;
            continue;
          }
          const seen = sentinelOrgs.get(sentinelId) ?? new Set<string>();
          seen.add(orgId);
          sentinelOrgs.set(sentinelId, seen);
        } catch (err: unknown) {
          unparsableEntries++;
          log.warn(
            { err: errorMessage(err), orgId },
            '跨客户模式 — 记忆条目无法解析（该条跳过，已计数）',
          );
        }
      }
    } catch (err: unknown) {
      orgsFailed.push(orgId);
      log.warn({ err: errorMessage(err), orgId }, '跨客户模式 — 组织查询失败（降级继续）');
    }
  }

  const patterns: CrossCustomerPattern[] = [];
  for (const [sentinelId, seen] of sentinelOrgs) {
    const orgIds = [...seen].sort();
    if (orgIds.length < minOrgs) continue;
    patterns.push({
      patternId: `xcp_${sentinelId}`,
      type: 'threshold_calibration',
      sentinelId,
      orgCount: orgIds.length,
      evidence: `${orgIds.length} 个不同客户纠错过此哨兵`,
      suggestion: `此哨兵被 ${orgIds.length} 个客户纠错 — 建议检查通用阈值是否适用于全部客户`,
    });
  }
  patterns.sort((a, b) => b.orgCount - a.orgCount || a.sentinelId.localeCompare(b.sentinelId));

  if (unparsableEntries > 0) {
    log.warn({ unparsableEntries }, '跨客户模式 — 存在无法解析的记忆条目（已计数，未静默跳过）');
  }

  const degraded = degradedByEnumeration || orgsFailed.length > 0;
  log.info(
    { orgs: orgs.orgIds.length, failed: orgsFailed.length, patterns: patterns.length, degraded },
    '跨客户模式发现完成',
  );

  return {
    patterns,
    orgsConsideredCount: orgs.orgIds.length,
    orgsFailedCount: orgsFailed.length,
    unparsableEntries,
    degraded,
  };
}

// ═══ K6/3-12 E3: 联邦匿名统计导出/导入 ═══

/** K6/3-12 E3: 联邦匿名统计包的 schema 版本（导入侧据此拒绝异构包）。 */
export const FEDERATED_STATS_SCHEMA_VERSION = 'k6-federated-v1';

/**
 * K6/3-12 E3: 单个哨兵的统计特征。
 * 匿名性由形状保证：只有中位数/分位数/参与组织数，没有个体值、没有 orgId、没有客户标识。
 */
export interface FederatedSentinelStat {
  sentinelId: string;
  orgCount: number;
  median: number;
  p25: number;
  p75: number;
}

/** K6/3-12 E3: 可跨实例传递的匿名统计包。 */
export interface FederatedStatsBundle {
  schemaVersion: string;
  generatedAt: string;
  /** 来源实例标识（匿名；不得是 orgId/客户名 —— 导出侧不读取任何客户标识） */
  sourceId: string;
  industry: string;
  /** 导出时采用的 k-匿名门槛（导入侧据此复核，但不信任来源值） */
  minOrgs: number;
  sentinelStats: FederatedSentinelStat[];
}

/** K6/3-12 E3: 导出入参。 */
export interface ExportFederatedStatsInput {
  industry: string;
  sentinelStats: PerSentinelStats[];
  /** 缺省 'anonymous-instance' */
  sourceId?: string;
  /** k-匿名门槛，默认 DEFAULT_EVOLUTION_CONFIG.minOrgsForIndustryAggregation (=5) */
  minOrgs?: number;
  /** 便于测试注入时间；缺省 new Date().toISOString() */
  generatedAt?: string;
}

export type ExportFederatedStatsCode = 'EMPTY_STATS' | 'K_ANONYMITY_TOO_LOW';

/** K6/3-12 E3: 导出结果（ok=false 时 bundle=null + code + reason，degraded=true）。 */
export interface ExportFederatedStatsResult {
  ok: boolean;
  bundle: FederatedStatsBundle | null;
  code?: ExportFederatedStatsCode;
  reason?: string;
  degraded: boolean;
}

/**
 * K6/3-12 E3: 把本地行业统计构造成匿名联邦包（不联网，纯函数）。
 *
 * 契约（铁律 47）:
 *   @input  — industry + sentinelStats（PerSentinelStats[]）+ 可选 sourceId/minOrgs/generatedAt
 *   @output — { ok: true, bundle } 正常；bundle.sentinelStats 仅含 orgCount >= minOrgs 的哨兵，
 *             按 sentinelId 升序（确定性），字段只有统计特征（匿名性由形状保证）
 *   @degraded — true ⇔ 无统计（EMPTY_STATS）或全部哨兵未达 k-匿名门槛（K_ANONYMITY_TOO_LOW）；
 *               两种都 log.warn（不静默，铁律 24/31）
 *   @throws  — 不抛
 */
export function exportFederatedStats(input: ExportFederatedStatsInput): ExportFederatedStatsResult {
  const minOrgs = input.minOrgs ?? DEFAULT_EVOLUTION_CONFIG.minOrgsForIndustryAggregation;
  const all = Array.isArray(input.sentinelStats) ? input.sentinelStats : [];

  if (all.length === 0) {
    log.warn({ industry: input.industry }, '联邦导出 — 无统计可导出（EMPTY_STATS，degraded）');
    return { ok: false, bundle: null, code: 'EMPTY_STATS', reason: 'sentinelStats 为空', degraded: true };
  }

  const qualifying = all.filter(s => s.orgCount >= minOrgs);
  if (qualifying.length === 0) {
    log.warn(
      { industry: input.industry, minOrgs, maxOrgCount: Math.max(...all.map(s => s.orgCount)) },
      '联邦导出 — 全部哨兵未达 k-匿名门槛（K_ANONYMITY_TOO_LOW，degraded）',
    );
    return {
      ok: false,
      bundle: null,
      code: 'K_ANONYMITY_TOO_LOW',
      reason: `无哨兵满足 orgCount >= ${minOrgs}`,
      degraded: true,
    };
  }

  const sourceId = input.sourceId && input.sourceId.trim().length > 0
    ? input.sourceId.trim()
    : 'anonymous-instance';

  const bundle: FederatedStatsBundle = {
    schemaVersion: FEDERATED_STATS_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceId,
    industry: input.industry,
    minOrgs,
    sentinelStats: qualifying
      .map(s => ({
        sentinelId: s.sentinelId,
        orgCount: s.orgCount,
        median: s.median,
        p25: s.p25,
        p75: s.p75,
      }))
      .sort((a, b) => a.sentinelId.localeCompare(b.sentinelId)),
  };

  log.info(
    {
      industry: bundle.industry,
      exported: bundle.sentinelStats.length,
      dropped: all.length - qualifying.length,
      minOrgs,
    },
    '联邦匿名统计导出完成',
  );
  return { ok: true, bundle, degraded: false };
}

export type ImportFederatedStatsCode =
  | 'INVALID_BUNDLE'
  | 'SCHEMA_MISMATCH'
  | 'EMPTY_BUNDLE'
  | 'ALL_REJECTED';

/** K6/3-12 E3: 导入结果（applied/rejected 逐条可对账；rejected>0 ⇒ degraded）。 */
export interface ImportFederatedStatsResult {
  ok: boolean;
  /** 通过校验并采纳的哨兵数 */
  applied: number;
  /** 被拒的哨兵数（k-匿名不达标或形状不合法） */
  rejected: number;
  /** 采纳后的统计；values: [] —— 匿名包不含个体值，median/p25/p75 即全部信息 */
  merged: PerSentinelStats[];
  code?: ImportFederatedStatsCode;
  reason?: string;
  degraded: boolean;
}

/** K6/3-12 E3: 导入选项。 */
export interface ImportFederatedStatsOptions {
  /** k-匿名门槛（不信任来源自带值），默认 DEFAULT_EVOLUTION_CONFIG.minOrgsForIndustryAggregation (=5) */
  minOrgs?: number;
  /** 期望 schema 版本，默认 FEDERATED_STATS_SCHEMA_VERSION */
  expectedSchemaVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * K6/3-12 E3: 校验并采纳一个联邦匿名包（不联网；调用方把"从哪拿到的包"作为入参传入）。
 *
 * 契约（铁律 47）:
 *   @input  — raw: unknown（未信任输入，可能是任意 JSON）+ 可选 minOrgs/expectedSchemaVersion。
 *             不信任包自带的 minOrgs：k-匿名门槛由导入侧重算。
 *   @output — { ok, applied, rejected, merged, code?, reason? }；merged 为 PerSentinelStats[]
 *             （values: []，name=sentinelId），按 sentinelId 升序
 *   @degraded — true ⇔ 任一哨兵被拒（rejected>0）或整包不可采纳；逐条 log.warn（不静默）
 *   @throws  — 不抛（未知形状一律收敛为 INVALID_BUNDLE）
 */
export function importFederatedStats(
  raw: unknown,
  options: ImportFederatedStatsOptions = {},
): ImportFederatedStatsResult {
  const minOrgs = options.minOrgs ?? DEFAULT_EVOLUTION_CONFIG.minOrgsForIndustryAggregation;
  const expectedSchemaVersion = options.expectedSchemaVersion ?? FEDERATED_STATS_SCHEMA_VERSION;

  if (!isRecord(raw)) {
    log.warn({ receivedType: typeof raw }, '联邦导入 — 载荷不是对象（INVALID_BUNDLE，degraded）');
    return {
      ok: false, applied: 0, rejected: 0, merged: [],
      code: 'INVALID_BUNDLE', reason: '载荷不是对象', degraded: true,
    };
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'string' || schemaVersion !== expectedSchemaVersion) {
    log.warn(
      { schemaVersion: typeof schemaVersion === 'string' ? schemaVersion : null, expectedSchemaVersion },
      '联邦导入 — schema 版本不匹配（SCHEMA_MISMATCH，degraded）',
    );
    return {
      ok: false, applied: 0, rejected: 0, merged: [],
      code: 'SCHEMA_MISMATCH', reason: `期望 schemaVersion=${expectedSchemaVersion}`, degraded: true,
    };
  }

  const rawStats = raw.sentinelStats;
  if (!Array.isArray(rawStats)) {
    log.warn({ receivedType: typeof rawStats }, '联邦导入 — sentinelStats 不是数组（INVALID_BUNDLE，degraded）');
    return {
      ok: false, applied: 0, rejected: 0, merged: [],
      code: 'INVALID_BUNDLE', reason: 'sentinelStats 不是数组', degraded: true,
    };
  }

  if (rawStats.length === 0) {
    log.warn({ industry: raw.industry }, '联邦导入 — 空包（EMPTY_BUNDLE，degraded）');
    return {
      ok: false, applied: 0, rejected: 0, merged: [],
      code: 'EMPTY_BUNDLE', reason: 'sentinelStats 为空', degraded: true,
    };
  }

  const merged: PerSentinelStats[] = [];
  let rejected = 0;

  for (const entry of rawStats) {
    if (!isRecord(entry)) {
      rejected++;
      log.warn({ entryType: typeof entry }, '联邦导入 — 条目不是对象（拒绝该条）');
      continue;
    }

    const sentinelId = typeof entry.sentinelId === 'string' ? entry.sentinelId.trim() : '';
    const orgCount = entry.orgCount;
    const median = entry.median;
    const p25 = entry.p25;
    const p75 = entry.p75;

    if (sentinelId.length === 0
      || !isFiniteNumber(orgCount)
      || !isFiniteNumber(median)
      || !isFiniteNumber(p25)
      || !isFiniteNumber(p75)) {
      rejected++;
      log.warn({ sentinelId, orgCount, median }, '联邦导入 — 条目字段不合法（拒绝该条）');
      continue;
    }

    if (orgCount < minOrgs) {
      rejected++;
      log.warn(
        { sentinelId, orgCount, minOrgs },
        '联邦导入 — 条目未达 k-匿名门槛（拒绝该条，防小样本反推）',
      );
      continue;
    }

    merged.push({
      sentinelId,
      name: sentinelId,
      orgCount,
      // 匿名包不含个体值 —— 显式留空，避免伪造出"看起来有原始数据"的形状
      values: [],
      median,
      p25,
      p75,
    });
  }

  merged.sort((a, b) => a.sentinelId.localeCompare(b.sentinelId));

  if (merged.length === 0) {
    log.warn(
      { candidateCount: rawStats.length, rejected, minOrgs },
      '联邦导入 — 全部条目被拒（ALL_REJECTED，degraded）',
    );
    return {
      ok: false, applied: 0, rejected, merged: [],
      code: 'ALL_REJECTED', reason: `全部 ${rejected} 条被拒`, degraded: true,
    };
  }

  if (rejected > 0) {
    log.warn({ applied: merged.length, rejected, minOrgs }, '联邦导入 — 部分条目被拒（部分采纳，degraded）');
  } else {
    log.info({ applied: merged.length, industry: raw.industry }, '联邦匿名统计导入完成');
  }

  return {
    ok: true,
    applied: merged.length,
    rejected,
    merged,
    degraded: rejected > 0,
  };
}
