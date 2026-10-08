/**
 * financing-constraint/computes/kz-index.ts — KZ 融资约束指数
 *
 * KZ = -1.002 * (CF/K) + 3.139 * (Debt/TC) - 1.315 * (Cash/K)
 * 来源: Lamont, Polk, Saá-Requejo (2001)
 *
 * 阈值: >2.0 = 确定受约束; 1.0-2.0 = 可能约束; <0 = 不受约束
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface KzIndexResult {
  kzIndex: number;
  cfRatio: number;     // CF/K
  leverage: number;     // Debt/TC
  cashRatio: number;    // Cash/K
  degraded: boolean;
  warnings: string[];
}

export function computeKzIndex(financials: Array<{
  operatingCashFlow: number;
  netPpe: number;
  totalDebt: number;
  equity: number;
  cash: number;
}>): KzIndexResult {
  // #1408：输入有效性检查（本 compute 自己声明必需字段）
  const _inputIssues = checkFiniteInputs(financials, ['operatingCashFlow', 'netPpe', 'totalDebt', 'equity', 'cash']);
  if (_inputIssues.length > 0) return { ...{ kzIndex: 0, cfRatio: 0, leverage: 0, cashRatio: 0, degraded: true }, warnings: _inputIssues };
  if (financials.length === 0) {
    return { kzIndex: 0, cfRatio: 0, leverage: 0, cashRatio: 0, degraded: true, warnings: ['无财务数据'] };
  }

  const totalCf = financials.reduce((s, f) => s + (f.operatingCashFlow || 0), 0);
  const totalPpe = financials.reduce((s, f) => s + (f.netPpe || 0), 0);
  const totalDebt = financials.reduce((s, f) => s + (f.totalDebt || 0), 0);
  const totalEquity = financials.reduce((s, f) => s + (f.equity || 0), 0);
  const totalCash = financials.reduce((s, f) => s + (f.cash || 0), 0);
  const totalCapital = totalDebt + totalEquity;

  const warnings: string[] = [];
  if (totalPpe === 0) warnings.push('净固定资产为0，使用总资产近似');
  if (totalCapital === 0) warnings.push('总资本为0，杠杆率设为0');

  const ppe = totalPpe || financials.reduce((s, f) => s + (f.netPpe || 0) + (f.cash || 0), 0) || 1;
  const cfRatio = ppe > 0 ? totalCf / ppe : 0;
  const leverage = totalCapital > 0 ? totalDebt / totalCapital : 0;
  const cashRatio = ppe > 0 ? totalCash / ppe : 0;

  // KZ = -1.002 * CF/K + 3.139 * Debt/TC - 1.315 * Cash/K
  const kzIndex = -1.002 * cfRatio + 3.139 * leverage - 1.315 * cashRatio;

  return { kzIndex: Math.round(kzIndex * 1000) / 1000, cfRatio: Math.round(cfRatio * 1000) / 1000, leverage: Math.round(leverage * 1000) / 1000, cashRatio: Math.round(cashRatio * 1000) / 1000, degraded: false, warnings };
}
