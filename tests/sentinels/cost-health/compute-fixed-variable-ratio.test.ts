/**
 * compute-fixed-variable-ratio.test.ts — computeFixedVariableRatio 契约测试
 * D584 对齐: cost-health/profit-health 已 D358 去灭绝并入 margin-health（自家 computes/ 计算），import 对齐 live 契约。
 * live 契约: input {total_revenue, gross_margin, operating_expense, fixed_cost?}[]; value = fixedCost/totalCost。
 */
import { describe, it, expect } from 'vitest';
import { computeFixedVariableRatio } from '../../../extensions/sentinels/margin-health/computes/compute-fixed-variable-ratio';

describe('computeFixedVariableRatio', () => {
  it('should compute fixed ratio correctly', () => {
    const r = computeFixedVariableRatio([
      { total_revenue: 100000, gross_margin: 40000, operating_expense: 30000, fixed_cost: 70000 },
    ]);
    // cogs = 100000-40000 = 60000; totalCost = 60000+30000 = 90000; value = 70000/90000
    expect(r.degraded).toBe(false);
    expect(r.fixedCost).toBe(70000);
    expect(r.totalCost).toBe(90000);
    expect(r.value).toBeCloseTo(70000 / 90000, 3);
  });

  it('should degrade on empty data', () => {
    const r = computeFixedVariableRatio([]);
    expect(r.degraded).toBe(true);
  });

  it('fixed_cost 缺失 → degraded（erp 契约外扩展字段 guard）', () => {
    const r = computeFixedVariableRatio([
      { total_revenue: 100000, gross_margin: 40000, operating_expense: 30000 },
    ]);
    expect(r.degraded).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
