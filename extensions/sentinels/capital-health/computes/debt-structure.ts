/**
 * capital-health/computes/debt-structure.ts — 债务期限结构（D358 迁自 _extinct/capital-structure）
 *
 * 契约ID: COMPUTE-DEBT-STRUCTURE-v1（迁移版 — 算法冻结，字段名 snake 化）
 * 设计哲学一句：**算法是纯函数，尺子（阈值）由调用方给 —— 本文件不持有任何阈值字面量。**
 *
 * 契约（铁律 47）:
 *   @input  fin —— { short_term_debt; total_debt }
 *           thresholds —— **必传** 结构类型 `{ warning: number; critical: number }`（两档）；来源只允许
 *             `resolveThresholds('capital-health', orgKey)`（#732 / 裁 425 B1 单源），**禁字面回落/默认值**（裁 425 B2）
 *     短债比 = short_term_debt / total_debt
 *     来源: 公司理财(罗斯) Ch3 — 债务期限结构
 *   @output 正常: { shortTermRatio, signal: 'critical'|'warning'|'healthy', degraded: false, warnings }
 *           降级: total_debt<=0 → degraded + signal 'healthy'（degraded 不产阈值结论）
 *   @exit   判定只用入参两档，语义 `ratio > critical` ⇒ critical｜`> warning` ⇒ warning（等于线值不越级）
 *   @degraded 数据不可算 ⇒ degraded:true（不 throw）；**阈值缺参/非法 ⇒ throw typed error**
 *           `DEBT_STRUCTURE_THRESHOLDS_MISSING`（配置错误不降级、不猜默认值）
 *   边界: 短债比恰好 0.7 → warning（>0.7 才 critical）
 *   已知限制: 本函数**同步纯函数**（禁 await／禁 IO）；shortTermRatio 输出取两位小数，判定用未取整比值
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查

/** 阈值缺失/非法（铁律 32: .code + .phase + .retryable）。配置错误：retryable=false，禁回落默认值 */
export class DebtStructureThresholdsMissingError extends Error {
  readonly code = 'DEBT_STRUCTURE_THRESHOLDS_MISSING';
  readonly phase = 'threshold-resolution';
  readonly retryable = false;

  constructor(detail: string) {
    super(`computeDebtStructure 阈值不可用：${detail}（裁 425 B2 禁字面回落）`);
    this.name = 'DebtStructureThresholdsMissingError';
  }
}

export interface DebtStructureResult {
  shortTermRatio: number;
  signal: 'critical' | 'warning' | 'healthy';
  degraded: boolean;
  warnings: string[];
}

export function computeDebtStructure(fin: {
  short_term_debt: number;
  total_debt: number;
}, thresholds: { warning: number; critical: number }): DebtStructureResult {
  // #732 加严：阈值必传（配置错误 fail-loud，优先于数据降级 —— 否则配置缺口会被 degraded 掩盖）
  if (!thresholds) throw new DebtStructureThresholdsMissingError('入参 thresholds 未提供');
  if (!Number.isFinite(thresholds.warning) || !Number.isFinite(thresholds.critical)) {
    throw new DebtStructureThresholdsMissingError(`warning=${String(thresholds.warning)} / critical=${String(thresholds.critical)} 非有限数`);
  }
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

  // 短贷长投风险线由调用方给定（manifest 单源；本文件不再持有 0.7/0.5 字面量）
  let signal: 'critical' | 'warning' | 'healthy';
  if (ratio > thresholds.critical) {
    signal = 'critical';
  } else if (ratio > thresholds.warning) {
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
