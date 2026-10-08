/**
 * capital-health/computes/cash-conversion-cycle.ts — 现金转换周期（D358 迁自 _extinct/capital-turnover）
 *
 * 契约ID: COMPUTE-CASH-CONVERSION-CYCLE-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 输入: fin: { cogs; inventory; receivables; accounts_payable; total_revenue }
 *   CCC = DIO + DSO − DPO
 *   DIO = 365 / (COGS / Inventory)；DSO = 365 / (Revenue / AR)；DPO = 365 / (COGS / AP)
 *   来源: 公司理财(罗斯) Ch3; Soliman (2008)
 *   阈值在 compute 内部（D358 决策 3: manifest 无此 key，沿用内部常量）:
 *   > 120 天 critical / > 90 天 warning（制造/零售基线）
 * 输出(正常): { cccDays, dio, dso, dpo, signal, degraded: false, warnings: [...] }
 * 输出(降级): total_revenue<=0 且 cogs<=0 → degraded + signal 'healthy'
 *   （D358 降级传播修复: degraded 不产阈值结论；原实现 degraded 分支 signal 'critical'）
 * 边界: CCC 恰好 91（刚过 warning 线）→ warning
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface CCCResult {
  cccDays: number;
  dio: number;
  dso: number;
  dpo: number;
  signal: 'critical' | 'warning' | 'healthy';
  degraded: boolean;
  warnings: string[];
}

export function computeCashConversionCycle(fin: {
  cogs: number;
  inventory: number;
  receivables: number;
  accounts_payable: number;
  total_revenue: number;
}): CCCResult {
  // #1408：输入有效性检查（**显式声明本 compute 的必需字段**；缺字段/NaN/非有限 ⇒ 降级 + warnings）
  const _inputIssues = checkFiniteInputs(fin, ['cogs', 'inventory', 'receivables', 'accounts_payable', 'total_revenue']);
  if (_inputIssues.length > 0) return { cccDays: 0, dio: 0, dso: 0, dpo: 0, signal: 'healthy', degraded: true, warnings: _inputIssues };
  const warnings: string[] = [];

  if (fin.total_revenue <= 0 && fin.cogs <= 0) {
    return {
      cccDays: 0, dio: 0, dso: 0, dpo: 0,
      signal: 'healthy',
      degraded: true,
      warnings: ['Revenue and COGS both zero — cannot compute CCC'],
    };
  }

  // DIO = 365 / (COGS / Inventory)
  let dio = 0;
  if (fin.cogs > 0 && fin.inventory > 0) {
    dio = 365 / (fin.cogs / fin.inventory);
  } else {
    warnings.push(fin.inventory <= 0 ? 'Inventory is zero — DIO set to 0' : 'COGS is zero — DIO set to 0');
  }

  // DSO = 365 / (Revenue / AR)
  let dso = 0;
  if (fin.total_revenue > 0 && fin.receivables > 0) {
    dso = 365 / (fin.total_revenue / fin.receivables);
  } else {
    warnings.push(fin.receivables <= 0 ? 'Accounts receivable is zero — DSO set to 0' : 'Revenue is zero — DSO set to 0');
  }

  // DPO = 365 / (COGS / AP)
  let dpo = 0;
  if (fin.cogs > 0 && fin.accounts_payable > 0) {
    dpo = 365 / (fin.cogs / fin.accounts_payable);
  } else {
    warnings.push(fin.accounts_payable <= 0 ? 'Accounts payable is zero — DPO set to 0' : 'COGS is zero — DPO set to 0');
  }

  const cccDays = dio + dso - dpo;

  const degraded = (fin.total_revenue <= 0 || fin.cogs <= 0);
  if (degraded) {
    warnings.push('Partial data — CCC estimate may be unreliable');
  }

  // 制造/零售基线
  let signal: 'critical' | 'warning' | 'healthy';
  if (cccDays > 120) {
    signal = 'critical';
  } else if (cccDays > 90) {
    signal = 'warning';
  } else {
    signal = 'healthy';
  }

  return {
    cccDays: Math.round(cccDays),
    dio: Math.round(dio),
    dso: Math.round(dso),
    dpo: Math.round(dpo),
    signal,
    degraded,
    warnings,
  };
}
