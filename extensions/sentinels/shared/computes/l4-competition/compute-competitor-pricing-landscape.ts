/**
 * compute-competitor-pricing-landscape.ts — 竞争对手定价全景分析
 *
 * 契约ID: COMPUTE-COMPETITOR-PRICING-LANDSCAPE-v1
 * 模块: l4-competition
 * 消费边: SUBSTITUTES
 * 输入: competitors: Array<{ name: string; price: number; market_share?: number }>
 * 输出(正常): { value: PriceAnalysis, confidence:'high', evidence:[], degraded:false }
 */
export interface CompetitorPrice {
  name: string;
  price: number;
  market_share?: number;
}

export interface PriceAnalysis {
  averagePrice: number;
  priceRange: { min: number; max: number };
  pricePosition: 'premium' | 'competitive' | 'budget';
  priceDispersion: number;
}

export function computeCompetitorPricingLandscape(competitors: CompetitorPrice[], ownPrice?: number): {
  value: PriceAnalysis;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  degraded: boolean;
  warnings: string[];
  computedAt: string;
} {
  const warnings: string[] = [];
  const computedAt = new Date().toISOString();

  if (!competitors || competitors.length === 0) {
    return {
      value: { averagePrice: 0, priceRange: { min: 0, max: 0 }, pricePosition: 'competitive', priceDispersion: 0 },
      confidence: 'low', evidence: [], degraded: true, warnings: ['无竞争对手数据'], computedAt,
    };
  }

  const prices = competitors.map(c => c.price).filter(p => p > 0);
  if (prices.length === 0) {
    return {
      value: { averagePrice: 0, priceRange: { min: 0, max: 0 }, pricePosition: 'competitive', priceDispersion: 0 },
      confidence: 'low', evidence: [], degraded: true, warnings: ['所有竞争对手价格为0或负数'], computedAt,
    };
  }

  const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const variance = prices.reduce((s, p) => s + (p - avgPrice) ** 2, 0) / prices.length;
  const dispersion = avgPrice > 0 ? Math.sqrt(variance) / avgPrice : 0;

  let pricePosition: 'premium' | 'competitive' | 'budget' = 'competitive';
  if (ownPrice !== undefined) {
    pricePosition = ownPrice > avgPrice * 1.1 ? 'premium' : ownPrice < avgPrice * 0.9 ? 'budget' : 'competitive';
  }

  return {
    value: {
      averagePrice: Math.round(avgPrice * 100) / 100,
      priceRange: { min: minPrice, max: maxPrice },
      pricePosition,
      priceDispersion: Math.round(dispersion * 10000) / 10000,
    },
    confidence: competitors.length >= 5 ? 'high' : 'medium',
    evidence: [`竞品数: ${competitors.length}`, `均价: ${avgPrice.toFixed(2)}`, `价格区间: ${minPrice}-${maxPrice}`],
    degraded: false,
    warnings,
    computedAt,
  };
}
