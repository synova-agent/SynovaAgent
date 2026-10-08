/**
 * environment-rent-dependency/computes/rent-dependency-index.ts — 环境红利依赖指数
 *
 * 评估企业对政策补贴/资源禀赋/市场壁垒等外部红利的依赖程度。
 * 依赖程度高 = 环境变化时企业脆弱性高。
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408：输入有效性检查
export interface RentDependencyResult {
  index: number;  // 0-1, 越高越依赖
  signals: string[];
  degraded: boolean;
}

export interface FinancialIndicator {
  type: string;
  value: number;
}

export function computeRentDependencyIndex(financials: FinancialIndicator[]): RentDependencyResult {
  // #1408：输入有效性检查（本 compute 自己声明必需字段）
  const _inputIssues = checkFiniteInputs(financials, ['value']);   // FinancialIndicator = {type(字符串判别符), value(数值)} ⇒ 只声明【数值字段】（type 纳入会误报）
  if (_inputIssues.length > 0) return { index: 0.5, signals: _inputIssues, degraded: true };
  if (financials.length === 0) {
    return { index: 0.5, signals: ['无财务数据-默认中等依赖'], degraded: true };
  }

  const signals: string[] = [];
  let score = 0;
  let count = 0;

  // 检查补贴依赖
  const subsidies = financials.filter(f => f.type === 'subsidy' || f.type === 'government_grant');
  if (subsidies.length > 0) {
    const subsidyRatio = subsidies.reduce((s, f) => s + f.value, 0) / Math.max(financials.filter(f => f.type === 'revenue').reduce((s, f) => s + f.value, 0), 1);
    if (subsidyRatio > 0.2) { score += 0.6; signals.push(`补贴依赖高(${(subsidyRatio * 100).toFixed(0)}%营收)`); }
    count++;
  }

  // 检查资源垄断
  const resources = financials.filter(f => f.type === 'resource_rent' || f.type === 'monopoly_rent');
  if (resources.length > 0) {
    const totalRent = resources.reduce((s, f) => s + f.value, 0);
    if (totalRent > 0) { score += 0.4; signals.push(`资源/垄断租金: ${totalRent}`); }
    count++;
  }

  const index = count > 0 ? Math.min(score / count + 0.2, 1) : 0.2;
  return { index: Math.round(index * 100) / 100, signals, degraded: false };
}
