/**
 * tests/sentinels/capital-health/roic-wacc-spread.test.ts — D358 配对测试（组 2b）
 *
 * 契约: computeRoicWaccSpread(financials: Array<{total_revenue, cogs, operating_expense, total_debt?, equity?, wacc_override?}>)
 *   ROIC = NOPAT / 投入资本；NOPAT ≈ total_revenue − cogs − operating_expense
 *   WACC = wacc_override ?? 0.10（默认行业值）
 *   降级: 空数组 / total_revenue=0 / 投入资本=0（D358 决策 5: 分母 0 → degrade，
 *         修复原实现 fallback nopat/totalRev 的假值）
 *   边界: spread 恰好 0（ROIC=WACC）
 */
import { describe, it, expect } from 'vitest';
import { computeRoicWaccSpread } from '../../../extensions/sentinels/capital-health/computes/roic-wacc-spread';

describe('D358 compute-roic-wacc-spread（迁自 _extinct/capital-efficiency）', () => {
  it('正常: NOPAT 5 / 资本 100 → ROIC 0.05，默认 WACC 0.10 → spread −0.05', () => {
    const r = computeRoicWaccSpread([
      { total_revenue: 100, cogs: 75, operating_expense: 20, total_debt: 50, equity: 50 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.roic).toBeCloseTo(0.05, 4);
    expect(r.wacc).toBeCloseTo(0.10, 4);
    expect(r.spread).toBeCloseTo(-0.05, 4);
  });

  it('正常: wacc_override 0.08 → spread −0.03', () => {
    const r = computeRoicWaccSpread([
      { total_revenue: 100, cogs: 75, operating_expense: 20, total_debt: 50, equity: 50, wacc_override: 0.08 },
    ]);
    expect(r.wacc).toBeCloseTo(0.08, 4);
    expect(r.spread).toBeCloseTo(-0.03, 4);
  });

  it('降级: 空数组 → degraded', () => {
    const r = computeRoicWaccSpread([]);
    expect(r.degraded).toBe(true);
  });

  it('降级: 投入资本=0 → degraded（分母 guard，修复原营收近似假值）', () => {
    const r = computeRoicWaccSpread([
      { total_revenue: 100, cogs: 80, operating_expense: 10, total_debt: 0, equity: 0 },
    ]);
    expect(r.degraded).toBe(true);
  });

  it('边界: ROIC 恰等于 WACC → spread 0，不降级', () => {
    // NOPAT 10 / 资本 100 → ROIC 0.10 = 默认 WACC
    const r = computeRoicWaccSpread([
      { total_revenue: 100, cogs: 70, operating_expense: 20, total_debt: 50, equity: 50 },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.spread).toBe(0);
  });
});
