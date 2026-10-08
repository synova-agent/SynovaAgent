/**
 * roic-wacc-spread.test.ts — computeRoicWaccSpread 契约测试
 * D584 对齐: 原引用 retired capital-efficiency/computes（D15a 并入 capital-health），指向 live 契约
 * （input: total_revenue/cogs/operating_expense/total_debt/equity/wacc_override；result: spread/roic/wacc/degraded/warnings）。
 */
import { describe, it, expect } from 'vitest';
import { computeRoicWaccSpread } from '../../../extensions/sentinels/capital-health/computes/roic-wacc-spread';

describe('computeRoicWaccSpread', () => {
  it('空列表 degraded', () => {
    expect(computeRoicWaccSpread([]).degraded).toBe(true);
  });
  it('盈利产生正价差', () => {
    const r = computeRoicWaccSpread([
      { total_revenue: 500, cogs: 200, operating_expense: 100, total_debt: 100, equity: 200 },
    ]);
    expect(r.roic).toBeGreaterThan(r.wacc);
    expect(r.degraded).toBe(false);
  });
});
