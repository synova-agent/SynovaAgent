/**
 * compute-margin-vs-benchmark.test.ts — computeMarginVsBenchmark 契约测试
 * D584 对齐: cost-health/profit-health 已 D358 去灭绝并入 margin-health（自家 computes/ 计算），import 对齐 live 契约。
 * live 契约: (financials, {benchmark?}) → {profitMargin, benchmark, gap, degraded}; 默认基准 0.25。
 */
import { describe, it, expect } from 'vitest';
import { computeMarginVsBenchmark } from '../../../extensions/sentinels/margin-health/computes/compute-margin-vs-benchmark';

describe('computeMarginVsBenchmark', () => {
  it('should compute gap vs default benchmark (25%)', () => {
    const r = computeMarginVsBenchmark([
      { total_revenue: 200000, gross_margin: 120000, operating_expense: 40000 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.profitMargin).toBe(0.4);
    expect(r.gap).toBeCloseTo(0.15, 5); // 0.4 - 0.25
  });

  it('should compute with custom benchmark', () => {
    const r = computeMarginVsBenchmark([
      { total_revenue: 100000, gross_margin: 60000, operating_expense: 30000 },
    ], { benchmark: 0.15 });
    expect(r.degraded).toBe(false);
    expect(r.profitMargin).toBe(0.3);
    expect(r.gap).toBeCloseTo(0.15, 5);
  });

  it('should degrade on empty data', () => {
    const r = computeMarginVsBenchmark([]);
    expect(r.degraded).toBe(true);
    expect(r.gap).toBe(0); // 降级路径 gap = 0（live 契约）
  });
});
