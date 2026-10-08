import { describe, it, expect } from 'vitest';
import { computeLearningRate } from '../../../extensions/sentinels/shared/computes/l2-value/compute-learning-rate';

describe('computeLearningRate', () => {
  it('正常: 典型学习曲线 → 正学习率', () => {
    // 初始成本100，累计1000单位后成本降至60
    // learning_rate = log(100/60) / log(1000) ≈ 0.5108 / 6.9078 ≈ 0.074
    const r = computeLearningRate({
      unitCostT0: 100,
      unitCostT: 60,
      cumulativeOutput: 1000,
    });
    expect(r.degraded).toBe(false);
    expect(r.learningRate).toBeGreaterThan(0);
    expect(r.learningRate).toBeLessThan(0.5);
    expect(r.experienceElasticity).toBeGreaterThan(0);
    expect(r.experienceElasticity).toBeLessThan(1);
    expect(r.routine_rigidity).toBe(0.5); // default
    expect(r.confidence).toBe('medium');
  });

  it('降级: cumulativeOutput<2 → degraded', () => {
    const r = computeLearningRate({
      unitCostT0: 100,
      unitCostT: 90,
      cumulativeOutput: 1,
    });
    expect(r.degraded).toBe(true);
    expect(r.learningRate).toBe(0);
    expect(r.warnings.some(w => w.includes('<2'))).toBe(true);
  });

  it('降级: 无效成本 → degraded', () => {
    const r = computeLearningRate({
      unitCostT0: 0,
      unitCostT: 100,
      cumulativeOutput: 1000,
    });
    expect(r.degraded).toBe(true);
    expect(r.warnings.some(w => w.includes('成本数据无效'))).toBe(true);
  });

  it('负学习率: 成本上升 → degraded', () => {
    const r = computeLearningRate({
      unitCostT0: 50,
      unitCostT: 80,
      cumulativeOutput: 1000,
    });
    expect(r.degraded).toBe(true); // learning_rate < 0
    expect(r.learningRate).toBeLessThan(0);
    expect(r.warnings.some(w => w.includes('负') || w.includes('成本在上升'))).toBe(true);
  });

  it('高惯例刚性 + 低学习率 → 警告', () => {
    const r = computeLearningRate({
      unitCostT0: 100,
      unitCostT: 98,
      cumulativeOutput: 10000,
      routine_rigidity: 0.9,
    });
    expect(r.degraded).toBe(false);
    expect(r.learningRate).toBeGreaterThan(0);
    expect(r.learningRate).toBeLessThan(0.05);
    expect(r.warnings.some(w => w.includes('惯例刚性'))).toBe(true);
    expect(r.confidence).toBe('high');
  });
});
