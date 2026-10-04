/**
 * scenario-simulation.ts — I10 哨兵 compute 函数
 *
 * 模拟砍掉边际贡献最低的N个客户群后的盈亏变化。
 * 依赖: computeMarginalContribution + computeFixedCostRigidity
 *
 * 示例企业A案例:
 *   模拟砍掉N家低产月子中心 → 利润反而下降X万
 *   因为固定成本(工厂N人、运营M人)无法随客户群缩减而减少
 *
 * 来源: 管理经济学(托马斯) Ch6 — 决策分析
 *
 * 契约:
 *   @input — scenarios: Array<{name:string, assumptions:object}>, baseline(object)
 *   @output — ScenarioSimulationResult { scenarios, recommended, sensitivity }
 *   @degraded — scenarios.length===0 -> degraded:true + warnings
 */
export interface ScenarioResult {
  dropCount: number;
  droppedGroupIds: string[];
  remainingRevenue: number;
  remainingContribution: number;
  totalFixedAfterCut: number;
  newProfit: number;
  profitChange: number;
  description: string;
}

export interface ScenarioSimulationResult {
  scenarios: ScenarioResult[];
  bestScenario: ScenarioResult | null;
  profitImprovementPossible: boolean;
  degraded: boolean;
  warnings: string[];
}

export interface MarginalGroup {
  groupId: string;
  revenue: number;
  variableCost: number;
  marginalContribution: number;
  mcRatio: number;
  isPositive: boolean;
}

export interface RigidityItem {
  name: string;
  amount: number;
  reducible: boolean;
  reductionPercent: number;
}

export function computeScenarioSimulation(
  mcGroups: MarginalGroup[],
  rigidCosts: RigidityItem[],
  currentProfit: number,
): ScenarioSimulationResult {
  const warnings: string[] = [];

  if (mcGroups.length === 0) {
    return {
      scenarios: [],
      bestScenario: null,
      profitImprovementPossible: false,
      degraded: true,
      warnings: ['No marginal contribution data — cannot simulate'],
    };
  }

  // 按 mcRatio 升序排列 (最差的在前)
  const sorted = [...mcGroups].sort((a, b) => a.mcRatio - b.mcRatio);

  // 计算最大可削减固定成本
  const totalReducible = rigidCosts.reduce((s, c) => {
    if (c.reducible) return s + c.amount * (c.reductionPercent / 100);
    return s;
  }, 0);

  const totalFixed = rigidCosts.reduce((s, c) => s + Math.max(0, c.amount), 0);
  const fixedAfterMaxCut = totalFixed - totalReducible;

  const scenarios: ScenarioResult[] = [];
  let bestScenario: ScenarioResult | null = null;
  let bestProfit = currentProfit;

  // 模拟砍掉前 N 个最差群 (N = 1, 2, ..., up to half)
  const maxDrop = Math.max(1, Math.floor(sorted.length / 2));

  for (let n = 1; n <= maxDrop; n++) {
    const dropped = sorted.slice(0, n);
    const remaining = sorted.slice(n);

    const droppedIds = dropped.map(g => g.groupId);
    const droppedContribution = dropped.reduce((s, g) => s + g.marginalContribution, 0);
    const droppedRevenue = dropped.reduce((s, g) => s + g.revenue, 0);
    const remainingContribution = remaining.reduce((s, g) => s + g.marginalContribution, 0);

    // 砍掉 N 个群后，固定成本可缩减的比例 ≈ N / totalGroups
    const reductionFraction = n / sorted.length;
    const fixedReduction = totalReducible * Math.min(reductionFraction, 1);
    const newFixed = totalFixed - fixedReduction;

    const newProfit = remainingContribution - newFixed;
    const profitChange = newProfit - currentProfit;

    scenarios.push({
      dropCount: n,
      droppedGroupIds: droppedIds,
      remainingRevenue: Math.round((mcGroups.reduce((s, g) => s + g.revenue, 0) - droppedRevenue) * 100) / 100,
      remainingContribution: Math.round(remainingContribution * 100) / 100,
      totalFixedAfterCut: Math.round(newFixed * 100) / 100,
      newProfit: Math.round(newProfit * 100) / 100,
      profitChange: Math.round(profitChange * 100) / 100,
      description: `Cut ${n} worst group(s): profit ${profitChange >= 0 ? '+' : ''}${Math.round(profitChange * 100) / 100}`,
    });

    if (newProfit > bestProfit) {
      bestProfit = newProfit;
      bestScenario = scenarios[scenarios.length - 1];
    }
  }

  // 最后加一个"砍掉所有亏损群"的场景 (只保留 mcRatio > 0 的群)
  const positiveGroups = sorted.filter(g => g.isPositive);
  if (positiveGroups.length < sorted.length) {
    const negativeGroups = sorted.filter(g => !g.isPositive);
    const negContribution = negativeGroups.reduce((s, g) => s + g.marginalContribution, 0);
    const posContribution = positiveGroups.reduce((s, g) => s + g.marginalContribution, 0);
    const fixedReductionAll = totalReducible * (negativeGroups.length / sorted.length);
    const newFixedAll = totalFixed - fixedReductionAll;
    const profitAll = posContribution - newFixedAll;
    const changeAll = profitAll - currentProfit;

    scenarios.push({
      dropCount: negativeGroups.length,
      droppedGroupIds: negativeGroups.map(g => g.groupId),
      remainingRevenue: Math.round(positiveGroups.reduce((s, g) => s + g.revenue, 0) * 100) / 100,
      remainingContribution: Math.round(posContribution * 100) / 100,
      totalFixedAfterCut: Math.round(newFixedAll * 100) / 100,
      newProfit: Math.round(profitAll * 100) / 100,
      profitChange: Math.round(changeAll * 100) / 100,
      description: `Cut all ${negativeGroups.length} negative-MC group(s)`,
    });

    if (profitAll > bestProfit) {
      bestProfit = profitAll;
      bestScenario = scenarios[scenarios.length - 1];
    }
  }

  const profitImprovementPossible = scenarios.some(s => s.profitChange > 0);

  if (!profitImprovementPossible) {
    warnings.push('No scenario improves profit — fixed costs are too rigid to cut proportionally');
  }

  return {
    scenarios,
    bestScenario,
    profitImprovementPossible,
    degraded: false,
    warnings,
  };
}
