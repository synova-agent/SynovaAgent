/**
 * tests/sentinels/capital-health/debt-structure.test.ts — D358 配对测试（组 2b）
 *
 * 契约: computeDebtStructure(fin: {short_term_debt, total_debt}, thresholds)
 *   短债比 = short_term_debt / total_debt；阈值**由调用方传入**（#732 单源: manifest 基线 0.7/0.5），算法不改
 *   降级: total_debt<=0
 *   边界: 短债比恰好 0.7 → warning（>0.7 才 critical，0.7 落入 warning 档）
 */
import { describe, it, expect } from 'vitest';
import { computeDebtStructure } from '../../../extensions/sentinels/capital-health/computes/debt-structure';

/** 阈值单源（#732）：manifest.thresholds.short_term_debt_ratio 基线值，显式传入（compute 已无字面阈值） */
const THRESHOLDS = { warning: 0.5, critical: 0.7 };

describe('D358 compute-debt-structure（迁自 _extinct/capital-structure）', () => {
  it('正常: 60/100 → 0.6 → warning', () => {
    const r = computeDebtStructure({ short_term_debt: 60, total_debt: 100 }, THRESHOLDS);
    expect(r.degraded).toBe(false);
    expect(r.shortTermRatio).toBeCloseTo(0.6, 2);
    expect(r.signal).toBe('warning');
  });

  it('正常: 80/100 → 0.8 → critical', () => {
    const r = computeDebtStructure({ short_term_debt: 80, total_debt: 100 }, THRESHOLDS);
    expect(r.signal).toBe('critical');
  });

  it('正常: 30/100 → healthy', () => {
    const r = computeDebtStructure({ short_term_debt: 30, total_debt: 100 }, THRESHOLDS);
    expect(r.signal).toBe('healthy');
  });

  it('降级: total_debt=0 → degraded', () => {
    const r = computeDebtStructure({ short_term_debt: 10, total_debt: 0 }, THRESHOLDS);
    expect(r.degraded).toBe(true);
    expect(r.signal).toBe('healthy');
  });

  it('边界: 短债比恰好 0.7 → warning（>0.7 才是 critical）', () => {
    const r = computeDebtStructure({ short_term_debt: 70, total_debt: 100 }, THRESHOLDS);
    expect(r.degraded).toBe(false);
    expect(r.signal).toBe('warning');
  });
});
