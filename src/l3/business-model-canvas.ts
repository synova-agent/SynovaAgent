/**
 * l3/business-model-canvas.ts — 商业模式画布计算引擎
 *
 * 基于 SOG 本体图计算商业模式画布九要素健康度。
 * 消费本体节点 (Financial, Goal, Client, Process, Capability, Tool, Team)
 * 输出结构化诊断报告供商业模式专家 (business_model) 使用。
 *
 * 铁律 39: L3 通过 L4 GraphStore 接口访问本体数据。
 */

import { createLogger } from '@synova/logger';
import type { GraphStore } from '../l4/graph-bridge';

const log = createLogger('l3/business-model-canvas');

// ═══ Types ═══

export interface CanvasElement<T = unknown> {
  /** 元素数据 */
  data: T;
  /** 健康度 0-1 */
  health: number;
  /** 发现的风险信号 */
  risks: string[];
}

export interface CustomerSegmentData {
  count: number;
  diversity: number;
  concentrationRisk: number;
  segments: string[];
}

export interface RevenueStreamData {
  financialNodes: Array<{ id: string; amount?: number; revenueType?: string }>;
  concentrationRisk: number;
  recurringRatio: number;
  totalSources: number;
}

export interface CostStructureData {
  fixedVsVariable: number;
  majorCostDrivers: string[];
  totalCostNodes: number;
  fixedCostRatio?: number;
}

export interface BusinessModelCanvasReport {
  /** 画布九要素 */
  canvas: {
    customerSegments: CanvasElement<CustomerSegmentData>;
    valuePropositions: CanvasElement<Array<{ id: string; description: string; goalType: string }>>;
    channels: CanvasElement<{ processCount: number; typeDistribution: Record<string, number> }>;
    customerRelationships: CanvasElement<{ interactionFrequencies: Record<string, number> }>;
    revenueStreams: CanvasElement<RevenueStreamData>;
    keyResources: CanvasElement<{ capabilities: string[]; tools: string[] }>;
    keyActivities: CanvasElement<{ processes: string[]; criticality: Record<string, string> }>;
    keyPartnerships: CanvasElement<{ partners: string[]; dependencyRisk: number }>;
    costStructure: CanvasElement<CostStructureData>;
  };
  /** 整体健康度 0-1 */
  overallHealth: number;
  /** 结构性矛盾 */
  contradictions: Array<{
    signal: string;
    severity: 'high' | 'medium' | 'low';
    involvedExperts: string[];
  }>;
  /** 创新机会 */
  innovationOpportunities: string[];
  /** 计算时间 */
  computedAt: string;
}

// ═══ Constants ═══

/** 收入集中度警告阈值 */
const REVENUE_CONCENTRATION_WARN = 0.5;

/** 固定成本占比警告阈值 */
const FIXED_COST_RATIO_WARN = 0.7;

/** 平台机会：最少客户细分种类 */
const PLATFORM_MIN_SEGMENTS = 3;

// ═══ Core Algorithm ═══

/**
 * 从本体图计算商业模式画布。
 * @param store — L4 GraphStore 接口
 * @param orgId — 组织/租户 ID
 */
export function computeCanvas(store: GraphStore, orgId: string): BusinessModelCanvasReport {
  const graph = orgId || 'default';

  // ── 1. 客户细分 ──
  const clientNodes = store.queryNodes('Client', {}, graph);
  const clientNames = clientNodes.map(n => (n.props as Record<string, unknown>)?.name as string || n.id);
  // 按 entityType 分组计算多样性
  const entityTypes = new Set(clientNodes.map(n => (n.props as Record<string, unknown>)?.entityType));
  const diversity = entityTypes.size;
  // 收入集中度通过 REVENUE_FROM 边计算
  const revenueEdges = store.queryEdges('REVENUE_FROM', undefined, undefined, graph);
  const maxShare = revenueEdges.length > 0
    ? Math.max(...revenueEdges.map(e => (e.props as Record<string, unknown>)?.share as number || 0))
    : 0;
  const concentrationRisk = Math.max(maxShare, clientNodes.length <= 1 ? 0.8 : clientNodes.length <= 3 ? 0.4 : 0.1);
  const customerSegmentsHealth = 1 - concentrationRisk;

  // ── 2. 价值主张 ──
  const goalNodes = store.queryNodes('GOAL', {}, graph);
  const valueProps = goalNodes.map(n => ({
    id: n.id,
    description: (n.props as Record<string, unknown>)?.description as string || '',
    goalType: (n.props as Record<string, unknown>)?.goalType as string || 'mission',
  }));
  // 检查价值主张是否有对应的收入来源 (VALUE_PROPOSITION 边)
  const vpEdges = store.queryEdges('VALUE_PROPOSITION', undefined, undefined, graph);
  const monetizedRatio = vpEdges.filter(
    e => (e.props as Record<string, unknown>)?.monetized === true
  ).length / Math.max(vpEdges.length, 1);
  const valuePropsHealth = goalNodes.length > 0 ? (0.5 + 0.5 * monetizedRatio) : 0.3;

  // ── 3. 渠道通路 ──
  const processNodes = store.queryNodes('Process', {}, graph);
  const channelProcesses = processNodes.filter(n => {
    const pt = (n.props as Record<string, unknown>)?.processType;
    return pt === 'approval' || pt === 'deployment' || pt === 'other';
  });
  const typeDist: Record<string, number> = {};
  for (const p of channelProcesses) {
    const pt = (p.props as Record<string, unknown>)?.processType as string || 'other';
    typeDist[pt] = (typeDist[pt] || 0) + 1;
  }
  const channelsHealth = channelProcesses.length > 0 ? Math.min(1, channelProcesses.length / 5) : 0.4;

  // ── 4. 客户关系 ──
  const interactionEdges = store.queryEdges('INTERACTS_WITH', undefined, undefined, graph);
  const interactionFreq: Record<string, number> = {};
  for (const e of interactionEdges) {
    const ch = (e.props as Record<string, unknown>)?.channel as string || 'other';
    interactionFreq[ch] = (interactionFreq[ch] || 0) + 1;
  }
  const relationshipsHealth = interactionEdges.length > 0
    ? Math.min(1, Object.keys(interactionFreq).length / 3)
    : 0.3;

  // ── 5. 收入来源 ──
  const financialNodes = store.queryNodes('Financial', {}, graph);
  const revenueNodes = financialNodes.filter(n => {
    const ft = (n.props as Record<string, unknown>)?.financialType;
    return ft === 'revenue' || ft === 'token_account';
  });
  const revenueData: RevenueStreamData = {
    financialNodes: revenueNodes.map(n => ({
      id: n.id,
      amount: (n.props as Record<string, unknown>)?.amount as number | undefined,
      revenueType: (n.props as Record<string, unknown>)?.financialType as string,
    })),
    concentrationRisk: revenueNodes.length <= 1 ? 0.8 : maxShare,
    recurringRatio: 0, // 通过 PKB 行业基准判断，暂无动态计算
    totalSources: revenueNodes.length,
  };
  const revenueHealth = revenueNodes.length === 0 ? 0.1
    : revenueNodes.length === 1 ? 0.5
    : Math.min(1, 0.6 + 0.2 * Math.min(revenueNodes.length, 3) - concentrationRisk);

  // ── 6. 核心资源 ──
  const capabilityNodes = store.queryNodes('Capability', {}, graph);
  const toolNodes = store.queryNodes('Tool', {}, graph);
  const resourcesHealth = (capabilityNodes.length + toolNodes.length) > 0
    ? Math.min(1, (capabilityNodes.length + toolNodes.length) / 6)
    : 0.3;

  // ── 7. 关键业务 ──
  const keyProcesses = processNodes.filter(n => {
    const edges = store.queryEdges('OWNS', n.id, undefined, graph);
    return edges.length > 0;
  });
  const activitiesHealth = keyProcesses.length > 0 ? Math.min(1, keyProcesses.length / 4) : 0.4;

  // ── 8. 重要伙伴 ──
  const teamNodes = store.queryNodes('Team', {}, graph);
  const partnerEdges = store.queryEdges('PROVIDES', undefined, undefined, graph);
  // 外部伙伴 = 有 PROVIDES 边进入但不属于当前组织的 Team/Client
  const dependencyRisk = teamNodes.length > 0 ? Math.min(1, 1 / teamNodes.length) : 0.5;
  const partnersHealth = teamNodes.length > 0 ? 0.7 : 0.3;

  // ── 9. 成本结构 ──
  const costNodes = financialNodes.filter(n => {
    const ft = (n.props as Record<string, unknown>)?.financialType;
    return ft === 'cost' || ft === 'cost_center';
  });
  // 通过 COST_DRIVEN_BY 边识别固定/变动成本
  const costEdges = store.queryEdges('COST_DRIVEN_BY', undefined, undefined, graph);
  const fixedCosts = costEdges.filter(
    e => (e.props as Record<string, unknown>)?.costType === 'fixed'
  ).length;
  const fixedRatio = costEdges.length > 0 ? fixedCosts / costEdges.length : 0.5;
  const costHealth = costNodes.length > 0
    ? (fixedRatio > FIXED_COST_RATIO_WARN ? 0.4 : 0.8)
    : 0.3;

  // ── 整体健康度 ──
  const elements = [
    customerSegmentsHealth, valuePropsHealth, channelsHealth,
    relationshipsHealth, revenueHealth, resourcesHealth,
    activitiesHealth, partnersHealth, costHealth,
  ];
  const overallHealth = elements.reduce((s, h) => s + h, 0) / elements.length;

  // ── 矛盾检测 ──
  const contradictions: BusinessModelCanvasReport['contradictions'] = [];

  // 1. 价值-收入矛盾
  if (valueProps.length > 0 && revenueNodes.length === 0) {
    contradictions.push({
      signal: '存在价值主张但未检测到收入来源 — 价值-收入结构性矛盾',
      severity: 'high',
      involvedExperts: ['business_model', 'strategy', 'finance'],
    });
  }

  // 2. 收入集中风险
  if (concentrationRisk > REVENUE_CONCENTRATION_WARN) {
    contradictions.push({
      signal: `收入集中度过高 (${(concentrationRisk * 100).toFixed(0)}%) — 单一来源依赖风险`,
      severity: concentrationRisk > 0.7 ? 'high' : 'medium',
      involvedExperts: ['business_model', 'finance'],
    });
  }

  // 3. 成本-收入模式错配
  if (fixedRatio > FIXED_COST_RATIO_WARN && revenueNodes.length <= 2) {
    contradictions.push({
      signal: `固定成本占比 ${(fixedRatio * 100).toFixed(0)}% 但收入来源单一 — 结构性亏损风险`,
      severity: 'high',
      involvedExperts: ['business_model', 'finance', 'strategy'],
    });
  }

  // 4. 平台机会识别
  if (clientNodes.length >= PLATFORM_MIN_SEGMENTS && teamNodes.length > 0) {
    contradictions.push({
      signal: `多边客户存在 (${clientNodes.length} 种细分) — 平台化机会未开发`,
      severity: 'medium',
      involvedExperts: ['business_model', 'strategy', 'tech'],
    });
  }

  // ── 创新机会 ──
  const opportunities: string[] = [];
  if (clientNodes.length >= PLATFORM_MIN_SEGMENTS) {
    opportunities.push('多边市场平台化: 为不同客户细分创建价值交换平台');
  }
  if (revenueNodes.length === 1 && clientNodes.length > 1) {
    opportunities.push('收入模式多元化: 当前仅单一收入来源，可探索订阅/服务/平台等新模式');
  }
  if (fixedRatio > FIXED_COST_RATIO_WARN) {
    opportunities.push('变动成本转型: 通过外包/云化/SaaS降低固定成本占比');
  }
  if (valueProps.length > 2 && monetizedRatio < 0.5) {
    opportunities.push('价值定价: 多条价值主张未通过收入兑现，存在定价权提升空间');
  }

  // ── 组装报告 ──
  return {
    canvas: {
      customerSegments: {
        data: { count: clientNodes.length, diversity, concentrationRisk, segments: clientNames },
        health: customerSegmentsHealth,
        risks: concentrationRisk > REVENUE_CONCENTRATION_WARN ? ['收入集中度偏高'] : [],
      },
      valuePropositions: {
        data: valueProps,
        health: valuePropsHealth,
        risks: monetizedRatio < 0.5 ? ['价值主张货币化不足'] : [],
      },
      channels: {
        data: { processCount: channelProcesses.length, typeDistribution: typeDist },
        health: channelsHealth,
        risks: channelProcesses.length === 0 ? ['未检测到渠道流程'] : [],
      },
      customerRelationships: {
        data: { interactionFrequencies: interactionFreq },
        health: relationshipsHealth,
        risks: interactionEdges.length === 0 ? ['未检测到客户交互'] : [],
      },
      revenueStreams: {
        data: revenueData,
        health: revenueHealth,
        risks: revenueNodes.length <= 1 ? ['收入来源单一'] : [],
      },
      keyResources: {
        data: {
          capabilities: capabilityNodes.map(n => ((n.props as Record<string, unknown>)?.name as string) || n.id),
          tools: toolNodes.map(n => ((n.props as Record<string, unknown>)?.name as string) || n.id),
        },
        health: resourcesHealth,
        risks: (capabilityNodes.length + toolNodes.length) === 0 ? ['未检测到核心资源'] : [],
      },
      keyActivities: {
        data: {
          processes: keyProcesses.map(n => ((n.props as Record<string, unknown>)?.name as string) || n.id),
          criticality: {},
        },
        health: activitiesHealth,
        risks: keyProcesses.length === 0 ? ['未检测到关键业务'] : [],
      },
      keyPartnerships: {
        data: {
          partners: teamNodes.map(n => ((n.props as Record<string, unknown>)?.name as string) || n.id),
          dependencyRisk,
        },
        health: partnersHealth,
        risks: teamNodes.length === 0 ? ['未检测到伙伴关系'] : [],
      },
      costStructure: {
        data: {
          fixedVsVariable: fixedRatio,
          majorCostDrivers: costNodes.slice(0, 5).map(
            n => ((n.props as Record<string, unknown>)?.name as string) || `Financial[${(n.props as Record<string, unknown>)?.financialType || 'cost'}]`
          ),
          totalCostNodes: costNodes.length,
          fixedCostRatio: fixedRatio,
        },
        health: costHealth,
        risks: fixedRatio > FIXED_COST_RATIO_WARN ? ['固定成本占比过高'] : [],
      },
    },
    overallHealth,
    contradictions,
    innovationOpportunities: opportunities,
    computedAt: new Date().toISOString(),
  };
}

/**
 * 获取画布报告的纯文本摘要（供 LLM 消费）。
 */
export function formatCanvasSummary(report: BusinessModelCanvasReport): string {
  const c = report.canvas;
  const lines: string[] = [
    `商业模式画布健康度: ${(report.overallHealth * 100).toFixed(0)}%`,
    '',
    '--- 九要素 ---',
    `客户细分: ${c.customerSegments.data.count} 种, 集中度 ${(c.customerSegments.data.concentrationRisk * 100).toFixed(0)}%`,
    `价值主张: ${c.valuePropositions.data.length} 条, 健康度 ${(c.valuePropositions.health * 100).toFixed(0)}%`,
    `渠道通路: ${c.channels.data.processCount} 条流程`,
    `客户关系: ${Object.keys(c.customerRelationships.data.interactionFrequencies).length} 种交互渠道`,
    `收入来源: ${c.revenueStreams.data.totalSources} 个, 集中度 ${(c.revenueStreams.data.concentrationRisk * 100).toFixed(0)}%`,
    `核心资源: ${c.keyResources.data.capabilities.length} 能力 + ${c.keyResources.data.tools.length} 工具`,
    `关键业务: ${c.keyActivities.data.processes.length} 个`,
    `重要伙伴: ${c.keyPartnerships.data.partners.length} 个, 依赖风险 ${(c.keyPartnerships.data.dependencyRisk * 100).toFixed(0)}%`,
    `成本结构: 固定/变动比 ${(c.costStructure.data.fixedVsVariable * 100).toFixed(0)}%, ${c.costStructure.data.totalCostNodes} 个成本节点`,
  ];

  if (report.contradictions.length > 0) {
    lines.push('', '--- 结构性矛盾 ---');
    for (const con of report.contradictions) {
      lines.push(`[${con.severity.toUpperCase()}] ${con.signal}`);
    }
  }

  if (report.innovationOpportunities.length > 0) {
    lines.push('', '--- 创新机会 ---');
    for (const opp of report.innovationOpportunities) {
      lines.push(`• ${opp}`);
    }
  }

  return lines.join('\n');
}
