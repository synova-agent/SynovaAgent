/**
 * margin-health/computes/compute-margin-vs-benchmark.ts — 利润率 vs 行业基准（D358 迁自 _extinct/profit-health）
 *
 * 契约ID: COMPUTE-MARGIN-VS-BENCHMARK-v1（迁移版 — 算法冻结，数据获取上移 aggregate）
 * 输入: financials（同 compute-profit-margin-change）, input: { benchmark? }（默认 0.25）
 *   gap = profitMargin − benchmark
 * 输出(正常): { profitMargin, benchmark, gap, degraded: false }
 * 输出(降级): 空数组 / total_revenue=0 → { gap: 0, degraded: true }
 *   D358 决策 6: 修复原实现 degraded 时 gap=−benchmark 的假值——
 *   degraded 不得产出阈值结论（gap 恒 0，aggregate 门控 !degraded 双保险）。
 * 边界: gap 恰好 0（利润率=基准）→ 不降级
 */
import { computeProfitMarginChange } from './compute-profit-margin-change';

export interface MarginVsBenchmarkResult {
  /** 净利率（同 compute-profit-margin-change） */
  profitMargin: number;
  /** 行业基准（默认 0.25） */
  benchmark: number;
  /** 利润率 − 基准 */
  gap: number;
  degraded: boolean;
  warnings: string[];
}

export function computeMarginVsBenchmark(
  financials: Array<{
    total_revenue: number;
    gross_margin: number;
    operating_expense: number;
  }>,
  input: { benchmark?: number } = {},
): MarginVsBenchmarkResult {
  const margin = computeProfitMarginChange(financials);
  const benchmark = input.benchmark ?? 0.25;

  if (margin.degraded) {
    return {
      profitMargin: 0,
      benchmark,
      gap: 0,
      degraded: true,
      warnings: margin.warnings,
    };
  }

  const gap = margin.value - benchmark;

  return {
    profitMargin: margin.value,
    benchmark,
    gap: Math.round(gap * 10000) / 10000,
    degraded: false,
    warnings: [],
  };
}
