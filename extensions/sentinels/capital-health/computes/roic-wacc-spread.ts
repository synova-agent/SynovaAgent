/**
 * capital-health/computes/roic-wacc-spread.ts — ROIC/WACC 差距计算（D358 迁自 _extinct/capital-efficiency）
 *
 * 契约ID: COMPUTE-ROIC-WACC-SPREAD-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: financials: Array<{ total_revenue; cogs; operating_expense; total_debt?; equity?; wacc_override? }>
 *   ROIC = NOPAT / 投入资本；NOPAT ≈ total_revenue − cogs − operating_expense（简化）
 *   WACC = wacc_override ?? 0.10（默认行业值）
 * 输出(正常): { spread: roic − wacc, roic, wacc, degraded: false, warnings: [...] }
 * 输出(降级): 空数组 / total_revenue=0 / 投入资本=0 → degraded
 *   D358 决策 5: 投入资本 0 不再 fallback nopat/totalRev（原实现营收近似假值）；
 *   分母 0 → degrade，aggregate 门控 !degraded。
 * 边界: spread 恰好 0（ROIC=WACC）→ 不降级
 */
export interface RoicWaccResult {
  /** ROIC − WACC */
  spread: number;
  roic: number;
  wacc: number;
  degraded: boolean;
  warnings: string[];
}

export function computeRoicWaccSpread(financials: Array<{
  total_revenue: number;
  cogs: number;
  operating_expense: number;
  total_debt?: number;
  equity?: number;
  wacc_override?: number;
}>): RoicWaccResult {
  if (financials.length === 0) {
    return { spread: 0, roic: 0, wacc: 0, degraded: true, warnings: ['无财务数据'] };
  }

  const totalRev = financials.reduce((s, f) => s + f.total_revenue, 0);
  const totalCost = financials.reduce(
    (s, f) => s + f.cogs + (f.operating_expense || 0), 0,
  );
  const totalCapital = financials.reduce(
    (s, f) => s + (f.total_debt || 0) + (f.equity || 0), 0,
  );

  const warnings: string[] = [];
  if (totalRev === 0) {
    warnings.push('总收入为 0 — ROIC 无意义（分母 guard）');
    return { spread: 0, roic: 0, wacc: 0, degraded: true, warnings };
  }
  if (totalCapital === 0) {
    warnings.push('投入资本为 0 — 不再使用营收近似（D358 决策 5）');
    return { spread: 0, roic: 0, wacc: 0, degraded: true, warnings };
  }

  const nopat = totalRev - totalCost; // 简化: NOPAT ≈ 总收入 - 总成本
  const roic = nopat / totalCapital;

  // WACC: 优先使用用户提供的覆盖值，否则默认 10%
  const waccInput = financials.find(f => f.wacc_override !== undefined)?.wacc_override;
  const wacc = waccInput !== undefined ? waccInput : 0.10;
  if (waccInput === undefined) warnings.push('WACC 使用默认值 10%');

  const spread = roic - wacc;

  return {
    spread: Math.round(spread * 10000) / 10000,
    roic: Math.round(roic * 10000) / 10000,
    wacc: Math.round(wacc * 10000) / 10000,
    degraded: false,
    warnings,
  };
}
