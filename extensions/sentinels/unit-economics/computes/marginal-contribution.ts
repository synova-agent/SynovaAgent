/**
 * marginal-contribution.ts — I10 哨兵核心 compute 函数
 *
 * 按客户群计算边际贡献 (Marginal Contribution):
 * MC_group = Revenue_group - VariableCost_group
 * MC_Ratio = MC / Revenue
 *
 * D59 ME Enhance: 追加 economic_interpretation 字段
 *
 * 示例企业A验证: N家低产会所的MC为正（覆盖变动成本后仍有边际贡献）
 * 来源: 管理经济学(托马斯) Ch6 — 边际分析
 *
 * 本体映射: Client节点按segment分组 | REVENUE_FROM::share | COST_DRIVEN_BY
 *
 * 契约:
 *   @input — groups: Array<{groupId:string, revenue:number, variableCost:number}>
 *   @output — MarginalContributionResult { groups, totalContribution, avgMcRatio, negativeMcGroups, economicInterpretation }
 *   @degraded — groups.length===0 -> degraded:true + warnings
 */
export interface MarginalGroup {
  groupId: string;
  revenue: number;
  variableCost: number;
  marginalContribution: number;
  mcRatio: number;
  isPositive: boolean;
}

/** 管理经济学语义解读 */
export interface MarginalContributionInterpretation {
  /** 规模经济诊断: economies_of_scale / diseconomies / mixed / unknown */
  scaleEconomyDiagnosis: string;
  /** 最优产量区间估计 */
  optimalVolumeEstimate: string;
  /** 成本结构调整建议 */
  costStructureAdvice: string;
}

export interface MarginalContributionResult {
  groups: MarginalGroup[];
  totalContribution: number;
  avgMcRatio: number;
  negativeMcGroups: number;
  /** D59: 管理经济学语义解读 */
  economicInterpretation: MarginalContributionInterpretation;
  degraded: boolean;
  warnings: string[];
}

export function computeMarginalContribution(
  groups: Array<{ groupId: string; revenue: number; variableCost: number }>,
): MarginalContributionResult {
  const warnings: string[] = [];

  if (groups.length === 0) {
    return {
      groups: [],
      totalContribution: 0,
      avgMcRatio: 0,
      negativeMcGroups: 0,
      economicInterpretation: {
        scaleEconomyDiagnosis: 'unknown',
        optimalVolumeEstimate: '无客户群数据，无法估计最优产量',
        costStructureAdvice: '建议收集客户群数据以进行边际分析',
      },
      degraded: true,
      warnings: ['No client group data available'],
    };
  }

  const marginalGroups: MarginalGroup[] = [];
  let totalContribution = 0;
  let negativeCount = 0;

  for (const g of groups) {
    const mc = g.revenue - g.variableCost;
    const mcRatio = g.revenue > 0 ? mc / g.revenue : 0;

    marginalGroups.push({
      groupId: g.groupId,
      revenue: Math.round(g.revenue * 100) / 100,
      variableCost: Math.round(g.variableCost * 100) / 100,
      marginalContribution: Math.round(mc * 100) / 100,
      mcRatio: Math.round(mcRatio * 10000) / 10000,
      isPositive: mc > 0,
    });

    totalContribution += mc;
    if (mc <= 0) negativeCount++;
  }

  const avgMcRatio = marginalGroups.reduce((s, g) => s + g.mcRatio, 0) / marginalGroups.length;

  if (negativeCount > 0) {
    warnings.push(`${negativeCount} client group(s) have non-positive marginal contribution`);
  }

  // D59: 管理经济学语义解读
  const scaleEconomyDiagnosis = avgMcRatio > 0.4 ? 'economies_of_scale' :
    avgMcRatio > 0.2 ? 'mixed' : 'diseconomies';
  const economicInterpretation: MarginalContributionInterpretation = {
    scaleEconomyDiagnosis,
    optimalVolumeEstimate: negativeCount === 0
      ? `所有客户群边际贡献均为正，平均MC比率${(avgMcRatio * 100).toFixed(1)}%，建议维持当前产量组合`
      : `${negativeCount}个客户群边际贡献为负，建议优化或淘汰低效客户群`,
    costStructureAdvice: avgMcRatio < 0.2
      ? '平均边际贡献率偏低(<20%)，需审查变动成本结构，寻找降本空间'
      : '边际贡献率在健康范围，关注固定成本的覆盖能力',
  };

  return {
    groups: marginalGroups,
    totalContribution: Math.round(totalContribution * 100) / 100,
    avgMcRatio: Math.round(avgMcRatio * 10000) / 10000,
    negativeMcGroups: negativeCount,
    economicInterpretation,
    degraded: false,
    warnings,
  };
}
