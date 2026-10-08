/**
 * cash-runway.ts — F1 哨兵辅助 compute 函数
 *
 * 现金跑道评估: Runway = TotalCash / avg(近3月经营支出)
 * 来源: 公司理财(罗斯) Ch3 — 流动性分析
 *
 * 阈值: <6月严重 | 6-12月预警 | >12月健康
 * 本体映射: Financial::cash, Financial::operatingExpense(时序)
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface CashRunwayResult {
  runwayMonths: number;
  monthlyBurn: number;
  signal: 'critical' | 'warning' | 'healthy';
  degraded: boolean;
  warnings: string[];
}

export function computeCashRunway(
  financials: Array<{ cash: number; operatingExpense: number }>,
): CashRunwayResult {
  // #1408：输入有效性检查（本 compute 自己声明必需字段）
  const _inputIssues = checkFiniteInputs(financials, ['cash', 'operatingExpense']);
  if (_inputIssues.length > 0) return { runwayMonths: 0, monthlyBurn: 0, signal: 'critical', degraded: true, warnings: _inputIssues };
  const warnings: string[] = [];

  if (financials.length === 0) {
    return {
      runwayMonths: 0,
      monthlyBurn: 0,
      signal: 'critical',
      degraded: true,
      warnings: ['No financial data available'],
    };
  }

  const totalCash = financials.reduce((s, f) => s + Math.max(0, f.cash), 0);
  const totalOpExp = financials.reduce((s, f) => s + Math.max(0, f.operatingExpense), 0);
  const monthlyBurn = totalOpExp / financials.length;

  if (monthlyBurn <= 0) {
    warnings.push('Operating expense is zero or negative — runway calculation unreliable');
    return {
      runwayMonths: Infinity,
      monthlyBurn: 0,
      signal: 'healthy',
      degraded: true,
      warnings,
    };
  }

  const runwayMonths = totalCash / monthlyBurn;

  let signal: 'critical' | 'warning' | 'healthy';
  if (runwayMonths < 6) {
    signal = 'critical';
  } else if (runwayMonths < 12) {
    signal = 'warning';
  } else {
    signal = 'healthy';
  }

  if (runwayMonths > 60) {
    warnings.push('Runway exceeds 5 years — verify cash data accuracy');
  }

  return {
    runwayMonths: Math.round(runwayMonths * 10) / 10,
    monthlyBurn: Math.round(monthlyBurn * 100) / 100,
    signal,
    degraded: false,
    warnings,
  };
}
