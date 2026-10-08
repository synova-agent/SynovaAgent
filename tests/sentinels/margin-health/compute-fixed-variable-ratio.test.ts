/**
 * tests/sentinels/margin-health/compute-fixed-variable-ratio.test.ts — D358 配对测试（组 2b）
 *
 * 契约: computeFixedVariableRatio(financials: Array<{total_revenue, gross_margin, operating_expense, fixed_cost?}>)
 *   COGS = total_revenue − gross_margin（毛利润金额制）；总成本 = COGS + operating_expense
 *   正常: value = fixed_cost / total_cost
 *   降级: 空数组 / fixed_cost 缺失（扩展字段，契约外）/ 总成本=0
 *   边界: fixed_cost 显式 0 → value 0 且不降级
 */
import { describe, it, expect } from 'vitest';
import { computeFixedVariableRatio } from '../../../extensions/sentinels/margin-health/computes/compute-fixed-variable-ratio';

describe('D358 compute-fixed-variable-ratio（迁自 _extinct/cost-health）', () => {
  it('正常: fixed_cost 25 / 总成本 90 → 0.2778', () => {
    const r = computeFixedVariableRatio([
      { total_revenue: 100, gross_margin: 30, operating_expense: 20, fixed_cost: 25 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.value).toBeCloseTo(25 / 90, 4);
  });

  it('降级: 空数组 → degraded', () => {
    const r = computeFixedVariableRatio([]);
    expect(r.degraded).toBe(true);
    expect(r.value).toBe(0);
  });

  it('降级: fixed_cost 缺失（扩展字段不在 erp 契约）→ degraded', () => {
    const r = computeFixedVariableRatio([
      { total_revenue: 100, gross_margin: 30, operating_expense: 20 },
    ]);
    expect(r.degraded).toBe(true);
  });

  it('降级: 总成本=0（收入 0 且费用 0）→ degraded', () => {
    const r = computeFixedVariableRatio([
      { total_revenue: 0, gross_margin: 0, operating_expense: 0, fixed_cost: 10 },
    ]);
    expect(r.degraded).toBe(true);
  });

  it('边界: fixed_cost 显式 0 → value 0，不降级（无固定成本≠无数据）', () => {
    const r = computeFixedVariableRatio([
      { total_revenue: 100, gross_margin: 30, operating_expense: 20, fixed_cost: 0 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.value).toBe(0);
  });
});
