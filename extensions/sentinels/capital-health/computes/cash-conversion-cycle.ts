/**
 * capital-health/computes/cash-conversion-cycle.ts — 现金转换周期（D358 迁自 _extinct/capital-turnover）
 *
 * 契约ID: COMPUTE-CASH-CONVERSION-CYCLE-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 设计哲学一句：**算法是纯函数，尺子（阈值）由调用方给 —— 本文件不持有任何阈值字面量。**
 *
 * 契约（铁律 47）:
 *   @input  fin —— { cogs; inventory; receivables; accounts_payable; total_revenue }
 *           thresholds —— **必传** 结构类型 `{ warning: number; critical: number }`（两档）；来源只允许
 *             `resolveThresholds('capital-health', orgKey)`（#732 / 裁 425 B1 单源），**禁字面回落/默认值**（裁 425 B2）
 *     CCC = DIO + DSO − DPO
 *     DIO = 365 / (COGS / Inventory)；DSO = 365 / (Revenue / AR)；DPO = 365 / (COGS / AP)
 *     来源: 公司理财(罗斯) Ch3; Soliman (2008)
 *   @output 正常: { cccDays, dio, dso, dpo, signal, degraded: false, warnings: [...] }
 *           降级: total_revenue<=0 且 cogs<=0 → degraded + signal 'healthy'
 *           （D358 降级传播修复: degraded 不产阈值结论）
 *   @exit   判定只用入参两档，语义 `cccDays > critical` ⇒ critical｜`> warning` ⇒ warning（等于线值不越级）
 *   @degraded 数据不可算 ⇒ degraded:true + warnings（不 throw）；**阈值缺参/非法 ⇒ throw typed error**
 *           `CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING`（配置错误不降级、不猜默认值）
 *   边界: CCC 恰好 91（刚过 warning 线）→ warning
 *   已知限制: 本函数**同步纯函数**（禁 await／禁 IO）；partial data（revenue 或 cogs 为 0）仍给 estimate + warnings
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查

/** 阈值缺失/非法（铁律 32: .code + .phase + .retryable）。配置错误：retryable=false，禁回落默认值 */
export class CccThresholdsMissingError extends Error {
  readonly code = 'CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING';
  readonly phase = 'threshold-resolution';
  readonly retryable = false;

  constructor(detail: string) {
    super(`computeCashConversionCycle 阈值不可用：${detail}（裁 425 B2 禁字面回落）`);
    this.name = 'CccThresholdsMissingError';
  }
}

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
}, thresholds: { warning: number; critical: number }): CCCResult {
  // #732 加严：阈值必传（配置错误 fail-loud，优先于数据降级 —— 否则配置缺口会被 degraded 掩盖）
  if (!thresholds) throw new CccThresholdsMissingError('入参 thresholds 未提供');
  if (!Number.isFinite(thresholds.warning) || !Number.isFinite(thresholds.critical)) {
    throw new CccThresholdsMissingError(`warning=${String(thresholds.warning)} / critical=${String(thresholds.critical)} 非有限数`);
  }
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

  // 制造/零售基线由调用方给定（manifest 单源；本文件不再持有 120/90 字面量）
  let signal: 'critical' | 'warning' | 'healthy';
  if (cccDays > thresholds.critical) {
    signal = 'critical';
  } else if (cccDays > thresholds.warning) {
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
