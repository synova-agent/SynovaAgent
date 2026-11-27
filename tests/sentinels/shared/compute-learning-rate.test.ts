import { describe, it, expect } from 'vitest';
import {
  computeLearningRate,
  type LearningRateInput,
} from '../../../extensions/sentinels/shared/computes/l2-value/compute-learning-rate';

type NonFiniteField = 'unitCostT0' | 'unitCostT' | 'cumulativeOutput';

/** 有限输入基线：100/60/1000 → 学习率 0.0739（用于钉住公式与舍入） */
const FINITE_BASELINE: LearningRateInput = { unitCostT0: 100, unitCostT: 60, cumulativeOutput: 1000 };

const NON_FINITE_CASES: ReadonlyArray<{ field: NonFiniteField; value: number; label: string }> = [
  { field: 'unitCostT0', value: Number.NaN, label: 'NaN' },
  { field: 'unitCostT0', value: Number.POSITIVE_INFINITY, label: '+Infinity' },
  { field: 'unitCostT0', value: Number.NEGATIVE_INFINITY, label: '-Infinity' },
  { field: 'unitCostT', value: Number.NaN, label: 'NaN' },
  { field: 'unitCostT', value: Number.POSITIVE_INFINITY, label: '+Infinity' },
  { field: 'unitCostT', value: Number.NEGATIVE_INFINITY, label: '-Infinity' },
  { field: 'cumulativeOutput', value: Number.NaN, label: 'NaN' },
  { field: 'cumulativeOutput', value: Number.POSITIVE_INFINITY, label: '+Infinity' },
  { field: 'cumulativeOutput', value: Number.NEGATIVE_INFINITY, label: '-Infinity' },
];

/** 深度收集结果对象中的所有非有限数值（NaN / ±Infinity），用于"不产出脏数据"断言 */
function collectNonFiniteNumbers(value: unknown, path = 'result'): string[] {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [] : [`${path}=${String(value)}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectNonFiniteNumbers(item, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectNonFiniteNumbers(v, `${path}.${k}`));
  }
  return [];
}

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

  describe('非有限输入 → 提前降级', () => {
    it.each(NON_FINITE_CASES)(
      '$field=$label ⇒ degraded=true、warnings 点名非有限字段、结果不含脏数据',
      ({ field, value }) => {
        const r = computeLearningRate({ ...FINITE_BASELINE, [field]: value });

        expect(r.degraded, `${field}=${String(value)} ⇒ 必须降级`).toBe(true);
        expect(r.warnings[0], 'warnings 文案须明确写「非有限输入」').toContain('非有限输入');
        expect(r.warnings.slice(1), '复用 checkFiniteInputs ⇒ 逐字段留痕非有限数').toEqual([
          `非有限数: ${field}=${String(value)}`,
        ]);
        expect(r.learningRate).toBe(0);
        expect(r.experienceElasticity).toBe(0);
        expect(r.confidence).toBe('low');
        expect(r.evidence).toEqual([]);
        expect(collectNonFiniteNumbers(r), '返回结果不得含 NaN/Infinity').toEqual([]);
        expect(r.economicInterpretation.learningRateInterpretation).toBe('negative');
      },
    );

    it('三个字段同时非有限 ⇒ 三处问题全部留痕，不吞任一字段', () => {
      const r = computeLearningRate({ unitCostT0: Number.NaN, unitCostT: Infinity, cumulativeOutput: -Infinity });

      expect(r.degraded).toBe(true);
      expect(r.warnings[0]).toContain('非有限输入');
      expect(r.warnings).toHaveLength(4);
      expect(r.warnings).toContain('非有限数: unitCostT0=NaN');
      expect(r.warnings).toContain('非有限数: unitCostT=Infinity');
      expect(r.warnings).toContain('非有限数: cumulativeOutput=-Infinity');
      expect(collectNonFiniteNumbers(r)).toEqual([]);
    });

    it('-Infinity 回归：cumulativeOutput=-Infinity 走「非有限输入」降级，而非旧的 <2 分支', () => {
      const r = computeLearningRate({ ...FINITE_BASELINE, cumulativeOutput: Number.NEGATIVE_INFINITY });

      expect(r.degraded).toBe(true);
      expect(r.warnings[0]).toContain('非有限输入');
      expect(r.warnings).toContain('非有限数: cumulativeOutput=-Infinity');
      expect(r.warnings.some(w => w.includes('<2')), '不得落入旧的「累计产出<2」分支').toBe(false);
      expect(r.learningRate).toBe(0);
      expect(r.experienceElasticity).toBe(0);
      expect(collectNonFiniteNumbers(r)).toEqual([]);
    });

    it('有限输入基线：公式、舍入与输出字段保持不变', () => {
      const r = computeLearningRate(FINITE_BASELINE);

      expect(r).toEqual({
        learningRate: 0.0739,
        experienceElasticity: 0.05,
        routine_rigidity: 0.5,
        confidence: 'medium',
        evidence: [
          'unitCostT0=100, unitCostT=60',
          'cumulativeOutput=1000',
          'learningRate=0.0739',
          'experienceElasticity=0.0500',
        ],
        economicInterpretation: {
          learningRateInterpretation: 'moderate',
          costReductionForecast: '累计产出翻倍时成本预计下降5.0%',
          organizationalImplication: '学习效应正常发挥，可继续当前生产组织方式',
        },
        degraded: false,
        warnings: [],
      });
    });
  });
});
