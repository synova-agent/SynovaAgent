/**
 * capital-health/computes/debt-structure.ts — 债务期限结构（D358 迁自 _extinct/capital-structure）
 *
 * 契约ID: COMPUTE-DEBT-STRUCTURE-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: fin: { short_term_debt; total_debt }
 *   短债比 = short_term_debt / total_debt
 *   来源: 公司理财(罗斯) Ch3 — 债务期限结构
 *   阈值在 compute 内部（D358 决策 3: manifest 无此 key，沿用 T7b 内部常量模式）:
 *   > 0.7 critical / > 0.5 warning / 其余 healthy（短贷长投风险）
 * 输出(正常): { shortTermRatio, signal: 'critical'|'warning'|'healthy', degraded: false }
 * 输出(降级): total_debt<=0 → degraded + signal 'healthy'（degraded 不产阈值结论）
 * 边界: 短债比恰好 0.7 → warning（>0.7 才 critical）
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface DebtStructureResult {
  shortTermRatio: number;
  signal: 'critical' | 'warning' | 'healthy';
  degraded: boolean;
  warnings: string[];
}

export function computeDebtStructure(fin: {
  short_term_debt: number;
  total_debt: number;
}): DebtStructureResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(fin, ['short_term_debt', 'total_debt']);
  if (_inputIssues.length > 0) return { shortTermRatio: 0, signal: 'healthy', degraded: true, warnings: _inputIssues };
  const warnings: string[] = [];

  if (fin.total_debt <= 0) {
    return {
      shortTermRatio: 0,
      signal: 'healthy',
      degraded: true,
      warnings: ['Total debt is zero — cannot compute debt structure'],
    };
  }

  const ratio = fin.short_term_debt / fin.total_debt;

  let signal: 'critical' | 'warning' | 'healthy';
  if (ratio > 0.7) {
    signal = 'critical';
  } else if (ratio > 0.5) {
    signal = 'warning';
  } else {
    signal = 'healthy';
  }

  if (signal !== 'healthy') {
    warnings.push(`Short-term debt is ${(ratio * 100).toFixed(0)}% of total — risk of short-term borrowing for long-term investment`);
  }

  return {
    shortTermRatio: Math.round(ratio * 100) / 100,
    signal,
    degraded: false,
    warnings,
  };
}
