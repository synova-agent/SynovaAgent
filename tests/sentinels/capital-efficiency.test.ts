/**
 * capital-efficiency.test.ts — 资本效率 computes 组合回归
 * D584 对齐: retired capital-efficiency/computes → capital-health/computes live 契约。
 */
import { describe, it, expect } from 'vitest';
import { computeRoicWaccSpread } from '../../extensions/sentinels/capital-health/computes/roic-wacc-spread';
import { computeCapitalTurnover } from '../../extensions/sentinels/capital-health/computes/capital-turnover';

describe('computeRoicWaccSpread', () => {
  it('空列表 degraded', () => {
    expect(computeRoicWaccSpread([]).degraded).toBe(true);
  });

  it('高利润应产生正价差', () => {
    const r = computeRoicWaccSpread([
      { total_revenue: 1000, cogs: 400, operating_expense: 200, total_debt: 200, equity: 300 },
    ]);
    expect(r.roic).toBeGreaterThan(r.wacc);
    expect(r.degraded).toBe(false);
  });

  it('自定义 WACC（wacc_override）', () => {
    const r = computeRoicWaccSpread([
      { total_revenue: 100, cogs: 90, operating_expense: 20, total_debt: 50, equity: 50, wacc_override: 0.15 },
    ]);
    expect(r.wacc).toBe(0.15);
  });
});

describe('computeCapitalTurnover', () => {
  it('空列表 degraded', () => {
    expect(computeCapitalTurnover([]).degraded).toBe(true);
  });

  it('有营收有资本', () => {
    const r = computeCapitalTurnover([
      { total_revenue: 1000, total_debt: 200, equity: 300 },
    ]);
    expect(r.turnover).toBeCloseTo(1000 / 500, 2);
    expect(r.degraded).toBe(false);
  });
});
