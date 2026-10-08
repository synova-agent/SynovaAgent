/**
 * compute-customer-value-score.ts — 客户价值评分
 *
 * 契约ID: COMPUTE-CUSTOMER-VALUE-SCORE-v1
 * 模块: l2-value
 * 消费边: PRODUCES, SUBSTITUTES
 * 输入: revenue: number, tenure_months: number, churn_risk: number(0-1), referralCount: number
 * 输出(正常): { value: number(0-100), confidence:'high', evidence:[], degraded:false }
 */
export interface CustomerProfile {
  revenue: number;
  tenure_months: number;
  churn_risk: number;
  referralCount: number;
}

export function computeCustomerValueScore(customer: CustomerProfile): {
  value: number;
  components: { revenueScore: number; loyaltyScore: number; retentionScore: number; referralScore: number };
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  degraded: boolean;
  warnings: string[];
  computedAt: string;
} {
  const warnings: string[] = [];
  const computedAt = new Date().toISOString();

  if (!customer || customer.revenue < 0 || customer.tenure_months < 0) {
    return { value: 0, components: { revenueScore: 0, loyaltyScore: 0, retentionScore: 0, referralScore: 0 }, confidence: 'low', evidence: [], degraded: true, warnings: ['客户数据无效'], computedAt };
  }

  // Revenue score (0-40): log scale
  const revenueScore = customer.revenue > 0 ? Math.min(40, Math.log10(customer.revenue) * 10) : 0;
  // Loyalty score (0-25): tenure-based
  const loyaltyScore = Math.min(25, customer.tenure_months / 2);
  // Retention score (0-20): inverse of churn risk
  const retentionScore = Math.max(0, 20 * (1 - Math.min(customer.churn_risk, 1)));
  // Referral score (0-15)
  const referralScore = Math.min(15, customer.referralCount * 3);

  const total = revenueScore + loyaltyScore + retentionScore + referralScore;

  const degraded = customer.revenue === 0 && customer.tenure_months === 0;
  if (degraded) warnings.push('客户收入和 tenure 均为0 — 评分可能不准确');

  return {
    value: Math.round(total * 100) / 100,
    components: {
      revenueScore: Math.round(revenueScore * 100) / 100,
      loyaltyScore: Math.round(loyaltyScore * 100) / 100,
      retentionScore: Math.round(retentionScore * 100) / 100,
      referralScore: Math.round(referralScore * 100) / 100,
    },
    confidence: degraded ? 'low' : 'high',
    evidence: [`收入: ${customer.revenue}`, `在籍: ${customer.tenure_months}月`, `流失风险: ${(customer.churn_risk * 100).toFixed(0)}%`],
    degraded,
    warnings,
    computedAt,
  };
}
