/**
 * tests/sentinels/margin-health/compute-profit-margin-change.test.ts — D358 配对测试（组 2b）
 *
 * 契约: computeProfitMarginChange(financials: Array<{total_revenue, gross_margin, operating_expense}>)
 *   净利率 = (gross_margin − operating_expense) / total_revenue（毛利润金额制）
 *   名称保留「change」系迁移自 profit-health 的历史命名，实现语义为利润率水平（算法不改）
 *   正常: 值 ∈ [-1, 1] 可为负
 *   降级: 空数组 / total_revenue=0（分母 guard）
 *   边界: operating_expense 显式 0 → 纯毛利率
 */
import { describe, it, expect } from 'vitest';
import { computeProfitMarginChange } from '../../../extensions/sentinels/margin-health/computes/compute-profit-margin-change';

describe('D358 compute-profit-margin-change（迁自 _extinct/profit-health）', () => {
  it('正常: 毛利 30 − 费用 40 = −10 → 净利率 −0.1', () => {
    const r = computeProfitMarginChange([
      { total_revenue: 100, gross_margin: 30, operating_expense: 40 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.value).toBeCloseTo(-0.1, 4);
  });

  it('降级: 空数组 → degraded', () => {
    const r = computeProfitMarginChange([]);
    expect(r.degraded).toBe(true);
    expect(r.value).toBe(0);
  });

  it('降级: total_revenue=0 → degraded（分母 guard）', () => {
    const r = computeProfitMarginChange([
      { total_revenue: 0, gross_margin: 0, operating_expense: 10 },
    ]);
    expect(r.degraded).toBe(true);
  });

  it('边界: operating_expense 显式 0 → 净利率=毛利率 0.3', () => {
    const r = computeProfitMarginChange([
      { total_revenue: 100, gross_margin: 30, operating_expense: 0 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.value).toBeCloseTo(0.3, 4);
  });
});
