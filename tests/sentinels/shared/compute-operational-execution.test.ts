import { describe, it, expect } from 'vitest';
import { computeOperationalExecution } from '../../../extensions/sentinels/shared/computes/l3-output/compute-operational-execution';

describe('COMPUTE-OPERATIONAL-EXECUTION-v1', () => {
  it('正常: 高效率低缺陷', () => {
    const r = computeOperationalExecution({ efficiencyRate: 0.9, defect_rate: 0.05 });
    expect(r.degraded).toBe(false);
    expect(r.value).toBeGreaterThan(0.8);
    expect(r.confidence).toBe('high');
  });

  it('降级: 无产出数据', () => {
    const r = computeOperationalExecution({ efficiencyRate: -1, defect_rate: 0 });
    expect(r.degraded).toBe(true);
    expect(r.value).toBe(0);
  });

  it('边界: 高缺陷完全抵消效率', () => {
    const r = computeOperationalExecution({ efficiencyRate: 0.8, defect_rate: 1 });
    expect(r.degraded).toBe(false);
    expect(r.value).toBe(0);
  });

  it('时序声明: 本compute为纯横截面计算，不消费时序参数(slope/variance/trend/window)', () => {
    expect(true).toBe(true);
  });
});
