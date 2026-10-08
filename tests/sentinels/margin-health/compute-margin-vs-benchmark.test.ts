/**
 * tests/sentinels/margin-health/compute-margin-vs-benchmark.test.ts — D358 配对测试（组 2b）
 *
 * 契约: computeMarginVsBenchmark(financials, input: {benchmark?})
 *   净利率同 compute-profit-margin-change；gap = profitMargin − benchmark（默认 0.25）
 *   降级: 空数组 / total_revenue=0 → gap=0 而非 −benchmark（D358 决策 6:
 *         修复原实现 degraded 时 gap=-benchmark 的假值——degraded 不得产阈值结论）
 *   边界: gap 恰好 0（利润率=基准）
 */
import { describe, it, expect } from 'vitest';
import { computeMarginVsBenchmark } from '../../../extensions/sentinels/margin-health/computes/compute-margin-vs-benchmark';

describe('D358 compute-margin-vs-benchmark（迁自 _extinct/profit-health）', () => {
  it('正常: 利润率 −0.1 vs 基准 0.25 → gap −0.35', () => {
    const r = computeMarginVsBenchmark(
      [{ total_revenue: 100, gross_margin: 30, operating_expense: 40 }],
      {},
    );
    expect(r.degraded).toBe(false);
    expect(r.profitMargin).toBeCloseTo(-0.1, 4);
    expect(r.gap).toBeCloseTo(-0.35, 4);
  });

  it('正常: 自定义 benchmark 0.1 → gap −0.2', () => {
    const r = computeMarginVsBenchmark(
      [{ total_revenue: 100, gross_margin: 30, operating_expense: 40 }],
      { benchmark: 0.1 },
    );
    expect(r.gap).toBeCloseTo(-0.2, 4);
  });

  it('降级: 空数组 → degraded，gap=0（非 −benchmark 假值）', () => {
    const r = computeMarginVsBenchmark([], {});
    expect(r.degraded).toBe(true);
    expect(r.gap).toBe(0);
  });

  it('降级: total_revenue=0 → degraded，gap=0', () => {
    const r = computeMarginVsBenchmark(
      [{ total_revenue: 0, gross_margin: 0, operating_expense: 0 }],
      {},
    );
    expect(r.degraded).toBe(true);
    expect(r.gap).toBe(0);
  });

  it('边界: 利润率恰等于基准 → gap 0，不降级', () => {
    // 毛利 45 − 费用 20 = 25 → 利润率 0.25 = 默认基准
    const r = computeMarginVsBenchmark(
      [{ total_revenue: 100, gross_margin: 45, operating_expense: 20 }],
      {},
    );
    expect(r.degraded).toBe(false);
    expect(r.gap).toBe(0);
  });
});
