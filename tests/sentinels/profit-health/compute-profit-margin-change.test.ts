/**
 * compute-profit-margin-change.test.ts — computeProfitMarginChange 契约测试
 * D584 对齐: cost-health/profit-health 已 D358 去灭绝并入 margin-health（自家 computes/ 计算），import 对齐 live 契约。
 * live 契约: input {total_revenue, gross_margin, operating_expense}[]; value = 净利率（D358 语义: 净利润/营收）。
 */
import { describe, it, expect } from 'vitest';
import { computeProfitMarginChange } from '../../../extensions/sentinels/margin-health/computes/compute-profit-margin-change';

describe('computeProfitMarginChange', () => {
  it('should compute positive profit margin', () => {
    const r = computeProfitMarginChange([
      { total_revenue: 200000, gross_margin: 120000, operating_expense: 40000 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.value).toBe(0.4); // (120k-40k)/200k = 0.4
  });

  it('should degrade on empty data', () => {
    const r = computeProfitMarginChange([]);
    expect(r.degraded).toBe(true);
    expect(r.warnings.some(w => w.includes('无财务数据'))).toBe(true);
  });

  it('should handle negative profit margin (loss)', () => {
    const r = computeProfitMarginChange([
      { total_revenue: 100000, gross_margin: 30000, operating_expense: 80000 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.value).toBeLessThan(0);
    expect(r.value).toBe(-0.5);
  });
});
