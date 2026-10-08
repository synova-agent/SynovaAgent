/**
 * margin-health/computes/compute-cost-per-head.ts — 人均成本计算（D358 迁自 _extinct/cost-health）
 *
 * 契约ID: COMPUTE-COST-PER-HEAD-v1（迁移版 — 算法冻结，数据获取上移 aggregate）
 * 输入: input: { total_cost: number; head_count: number }
 *   数据获取（Financial 节点总成本归一化 + Person 节点计数）由 aggregate 层完成，
 *   本函数为纯函数。total_cost = COGS + operating_expense。
 * 输出(正常): { value: 人均成本, evidence: ['总成本: N', '人数: N'], degraded: false, warnings: [] }
 * 输出(降级): head_count=0 → { value: 0, degraded: true, warnings: [...] }
 *   分母 0 → degrade（D358 决策 5: 堵 0/0 假值）
 * 边界: total_cost 显式 0 → value 0 且不降级（零成本≠无数据）
 */
export interface CostPerHeadResult {
  /** 人均成本 */
  value: number;
  totalCost: number;
  headCount: number;
  evidence: string[];
  degraded: boolean;
  warnings: string[];
}

export function computeCostPerHead(input: {
  total_cost: number;
  head_count: number;
}): CostPerHeadResult {
  if (input.head_count === 0) {
    return {
      value: 0, totalCost: input.total_cost, headCount: 0,
      evidence: [], degraded: true,
      warnings: ['人数为 0 — 无法计算人均成本（分母 guard）'],
    };
  }

  const costPerHead = input.total_cost / input.head_count;

  return {
    value: Math.round(costPerHead * 100) / 100,
    totalCost: input.total_cost,
    headCount: input.head_count,
    evidence: [`总成本: ${input.total_cost}`, `人数: ${input.head_count}`],
    degraded: false,
    warnings: [],
  };
}
