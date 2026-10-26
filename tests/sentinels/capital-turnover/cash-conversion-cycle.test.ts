/**
 * cash-conversion-cycle.test.ts — computeCashConversionCycle 契约测试
 * D584 对齐: retired capital-turnover/computes → capital-health/computes live 契约
 * （input: {cogs, inventory, receivables, accounts_payable, total_revenue}）。
 * #732 对齐: 阈值改由调用方传入（manifest 单源），本文件显式传 manifest 基线 120/90。
 */
import { describe, it, expect } from 'vitest';
import { computeCashConversionCycle } from '../../../extensions/sentinels/capital-health/computes/cash-conversion-cycle';

/** 阈值单源（#732）：manifest.thresholds.cash_conversion_cycle_days 基线值 */
const THRESHOLDS = { warning: 90, critical: 120 };

describe('computeCashConversionCycle', () => {
  it('标准输入: CCC 各分量 > 0 且不降级', () => {
    const r = computeCashConversionCycle({ cogs: 1000000, inventory: 200000, receivables: 150000, accounts_payable: 100000, total_revenue: 2000000 }, THRESHOLDS);
    expect(r.cccDays).toBeGreaterThan(0);
    expect(r.dio).toBeGreaterThan(0);
    expect(r.dso).toBeGreaterThan(0);
    expect(r.dpo).toBeGreaterThan(0);
    expect(r.degraded).toBe(false);
  });

  it('零营收/零成本 → degraded', () => {
    const r = computeCashConversionCycle({ cogs: 0, inventory: 0, receivables: 0, accounts_payable: 0, total_revenue: 0 }, THRESHOLDS);
    expect(r.degraded).toBe(true);
  });

  it('CCC > 120 天 → critical', () => {
    const r = computeCashConversionCycle({ cogs: 100000, inventory: 80000, receivables: 70000, accounts_payable: 10000, total_revenue: 200000 }, THRESHOLDS);
    expect(r.signal).toBe('critical');
    expect(r.cccDays).toBeGreaterThan(120);
  });
});
