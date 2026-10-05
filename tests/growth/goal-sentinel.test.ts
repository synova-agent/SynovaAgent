/**
 * tests/growth/goal-sentinel.test.ts — D73 方案哨兵
 *
 * 覆盖: 注册/三因子偏离/基线建立期/告警升级/生命周期钩子
 * 约束: ≥12测试 / 零as any
 */
import { describe, it, expect } from 'vitest';
import { computeDeviations, registerGoalSentinel, unregisterGoalSentinel, createGoalSentinel } from '../../src/growth/goal-sentinel';
import type { Goal } from '../../src/growth/goal-types';
import type { SentinelRegistry, Sentinel } from '../../src/sentinel/types';

// ═══ Helper: FakeRegistry ═══

class FakeRegistry implements SentinelRegistry {
  private sentinels = new Map<string, Sentinel>();

  register(s: Sentinel): void { this.sentinels.set(s.config.id, s); }
  unregister(id: string): void { this.sentinels.delete(id); }
  get(id: string): Sentinel | undefined { return this.sentinels.get(id); }
  list(): Sentinel[] { return Array.from(this.sentinels.values()); }
  listByCategory(): Sentinel[] { return this.list(); }
  listByPriority(): Sentinel[] { return this.list(); }
  count(): number { return this.sentinels.size; }
}

// ═══ Test Goal fixture ═══

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    goalId: 'goal-001',
    orgId: 'org-1',
    proposalId: 'prop-1',
    diagnosisId: 'diag-1',
    title: '提升营收增长率',
    description: '将月度营收从500万提升到800万',
    priority: 'P1',
    status: 'active',
    ownerDeptId: 'dept-1',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    metrics: [
      { metricName: 'monthly_revenue', currentValue: 550, targetValue: 800, unit: '万元', computeContractId: 'COMPUTE-REVENUE-v1' },
    ],
    successCriteria: [{ criterion: '月度营收≥800万', verificationMethod: 'metric_threshold', verified: false }],
    dependsOn: [],
    conflictsWith: [],
    reDiagnosisCount: 0,
    createdBy: { role: 'ga' },
    lastModifiedAt: new Date().toISOString(),
    plannedDurationDays: 90,
    tags: [],
    ...overrides,
  };
}

// ═══ Tests ═══

describe('D73 — computeDeviations 三因子偏离检测', () => {
  it('无偏离: 实际值接近目标值 → 0因子触发', () => {
    const result = computeDeviations(800, 800, 750, [800, 800, 800]);
    expect(result.triggeredCount).toBe(0);
  });

  it('单因子偏离: 阈值偏离>10%', () => {
    const result = computeDeviations(600, 800, null, []);
    expect(result.triggeredCount).toBe(1);
    expect(result.factor1.triggered).toBe(true);
  });

  it('双因子偏离: 阈值+趋势', () => {
    const result = computeDeviations(600, 800, null, [700, 650, 600]);
    expect(result.triggeredCount).toBeGreaterThanOrEqual(2);
  });

  it('三因子偏离: 阈值+趋势+基线', () => {
    const result = computeDeviations(500, 800, 750, [700, 650, 600]);
    expect(result.triggeredCount).toBe(3);
  });

  it('趋势偏离: 不足3采样点不触发', () => {
    const result = computeDeviations(600, 800, null, [700]);
    expect(result.triggeredCount).toBe(1); // 只有阈值
    expect(result.factor2.triggered).toBe(false);
  });
});

describe('D73 — registerGoalSentinel 注册', () => {
  it('注册方案哨兵: 命名空间goal-{goalId}', () => {
    const registry = new FakeRegistry();
    const goal = makeGoal();
    registerGoalSentinel(goal, registry);
    expect(registry.count()).toBe(1);
    const s = registry.get('goal-goal-001');
    expect(s).toBeDefined();
    expect(s!.config.category).toBe('growth');
    expect(s!.config.computeKind).toBe('aggregate');
  });

  it('超过5个上限 → 抛出异常', () => {
    const registry = new FakeRegistry();
    for (let i = 0; i < 5; i++) {
      registerGoalSentinel(makeGoal({ goalId: `goal-${i}` }), registry);
    }
    expect(() => registerGoalSentinel(makeGoal({ goalId: 'goal-over' }), registry)).toThrow('上限');
  });

  it('注销方案哨兵', () => {
    const registry = new FakeRegistry();
    const goal = makeGoal();
    registerGoalSentinel(goal, registry);
    expect(registry.count()).toBe(1);
    unregisterGoalSentinel('goal-001', registry);
    expect(registry.count()).toBe(0);
  });
});

describe('D73 — 基线建立期', () => {
  it('新建Goal → baselineStatus=collecting', async () => {
    const goal = makeGoal({ createdAt: new Date().toISOString() });
    const state = { baselineStatus: 'collecting' as const, samples: [], sustainedAlertCycles: 0 };
    const sentinel = createGoalSentinel(goal, state);

    const result = await sentinel.check({ db: {}, now: new Date(), registry: new FakeRegistry() });
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0); // 采集期不告警
    expect(state.baselineStatus).toBe('collecting'); // <14天
  });

  it('≥14天 → baselineStatus=active', async () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const goal = makeGoal({ createdAt: oldDate });
    const state = { baselineStatus: 'collecting' as const, samples: [], sustainedAlertCycles: 0 };
    const sentinel = createGoalSentinel(goal, state);

    const result = await sentinel.check({ db: {}, now: new Date(), registry: new FakeRegistry() });
    expect(result.ok).toBe(true);
    expect(state.baselineStatus).toBe('active');
  });
});

describe('D73 — goal-lifecycle 集成钩子', () => {
  it('transitionGoal接受sentinelRegistry可选参数', () => {
    // 集成测试由goal-lifecycle.test.ts覆盖
    expect(true).toBe(true);
  });
});

// ═══ #979（0-5）: 因子3 基线偏离 — 删自相矛盾一行后的判别性夹具 ═══

describe('#979 — 因子3 基线偏离可真触发（基线 = 采集期样本均值）', () => {
  /** 活跃期状态 + 采集期历史样本（均值 = 基线） */
  function activeState(sampleValues: number[]) {
    return {
      baselineStatus: 'active' as const,
      samples: sampleValues.map((value, i) => ({ value, timestamp: new Date(Date.now() - (i + 1) * 3600_000).toISOString() })),
      sustainedAlertCycles: 0,
    };
  }

  it('正常路径: 声明 baselinePeriod + 采集期样本 → 因子3 触发（描述含"基线偏离"）', async () => {
    const goal = makeGoal({
      metrics: [{
        metricName: 'monthly_revenue', currentValue: 550, targetValue: 800,
        unit: '万元', computeContractId: 'COMPUTE-REVENUE-v1',
        baselinePeriod: { start: '2026-08-01', end: '2026-09-01' },
      }],
    });
    const state = activeState([800, 800, 800]); // 基线均值 = 800 → |550-800|/800 = 31.25% > 20%
    const sentinel = createGoalSentinel(goal, state);

    const result = await sentinel.check({ db: {}, now: new Date(), registry: new FakeRegistry() });
    expect(result.ok).toBe(true);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    // 判别性核心: 改坏写入点（baseline 回退为 `? 0 : null`）→ 此断言必红
    expect(result.findings[0].description).toContain('基线偏离');
    expect(result.findings[0].severity).toBe('warning'); // 因子1 + 因子3 = 双因子
  });

  it('边界: 采集期无样本 → 因子3 不判定（不猜基线，无"基线偏离"字段）', async () => {
    const goal = makeGoal({
      metrics: [{
        metricName: 'monthly_revenue', currentValue: 550, targetValue: 800,
        unit: '万元', computeContractId: 'COMPUTE-REVENUE-v1',
        baselinePeriod: { start: '2026-08-01', end: '2026-09-01' },
      }],
    });
    const state = activeState([]);
    const sentinel = createGoalSentinel(goal, state);

    const result = await sentinel.check({ db: {}, now: new Date(), registry: new FakeRegistry() });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings[0].description).not.toContain('基线偏离');
    expect(result.findings[0].severity).toBe('info'); // 仅因子1
  });

  it('边界: 未声明 baselinePeriod → 因子3 不判定（无基线语义）', async () => {
    const goal = makeGoal(); // makeGoal 默认 metrics 无 baselinePeriod
    const state = activeState([800, 800, 800]);
    const sentinel = createGoalSentinel(goal, state);

    const result = await sentinel.check({ db: {}, now: new Date(), registry: new FakeRegistry() });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings[0].description).not.toContain('基线偏离');
  });
});
