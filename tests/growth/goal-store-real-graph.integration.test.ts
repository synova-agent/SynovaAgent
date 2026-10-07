/**
 * tests/growth/goal-store-real-graph.integration.test.ts — #1322 B1 判据件（真库）
 *
 * 主题: **实体 id（props.goalId）≠ 图节点 id（真库 `node-<uuid>`）** 这一断裂的回归守护。
 *
 * 为什么必须新开一件（而不是加进 goal-store.test.ts）:
 *   既有 `tests/growth/goal-store.test.ts` 的 mock `createNode` **用 props.goalId 当节点 id**
 *   (`tests/growth/goal-store.test.ts:48`) ⇒ 结构上不可能复现真库的 id 语义差异。
 *   本件一律使用**真 `SqliteGraphStore`**（单连接 `:memory:`，与 `goal-propagation.test.ts` 同源范式）。
 *
 * 三路径（铁律 48，非空壳）:
 *   正常 — createGoal → getGoal 命中；updateGoalStatus 同状态 + extraProps 真写入
 *   降级 — store 每次调用都抛 ⇒ getGoal 返回 null（不抛）；updateGoalStatus 抛「不存在」且留 log
 *   边界 — 同名不同 id / 空 id / 两个 org 互不串（props.orgId 各自正确）
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createGoal, getGoal, listGoalsByOrg, updateGoalStatus } from '../../src/growth/goal-store';
import type { Goal, GraphBridgeLike, AuditStoreLike } from '../../src/growth/goal-types';

// ═══ 夹具 ═══

const audit: AuditStoreLike = {
  async write() { return 'audit-1322-t1'; },
};

/** store 每次调用都抛（模拟图存储不可用）——降级路径用 */
const brokenStore: GraphBridgeLike = {
  createNode(): string { throw new Error('graph down'); },
  getNode(): unknown { throw new Error('graph down'); },
  updateNode(): void { throw new Error('graph down'); },
  queryNodes(): Array<{ id: string; type: string; props: Record<string, unknown> }> { throw new Error('graph down'); },
};

function newStore(): SqliteGraphStore {
  return new SqliteGraphStore(new Database(':memory:'));
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    goalId: '',
    orgId: 'org-a',
    proposalId: 'prop-1',
    diagnosisId: 'diag-1',
    title: '盯住现金流',
    description: '账期拉长',
    priority: 'P1',
    status: 'draft',
    ownerDeptId: 'dept-fin',
    createdAt: '2026-10-08T00:00:00.000Z',
    deadline: '2026-12-31T00:00:00.000Z',
    metrics: [
      { metricName: '目标达成', currentValue: 0, targetValue: 15, unit: '%', computeContractId: 'COMPUTE-GOAL-ACHIEVEMENT-v1' },
    ],
    successCriteria: [],
    dependsOn: [],
    conflictsWith: [],
    reDiagnosisCount: 0,
    createdBy: { role: 'manager', departmentId: 'dept-fin' },
    lastModifiedAt: '2026-10-08T00:00:00.000Z',
    plannedDurationDays: 90,
    ...overrides,
  };
}

describe('#1322 B1 — Goal 侧真库 id 语义（getGoal / updateGoalStatus）', () => {
  it('正常: createGoal 后 getGoal 命中，且图节点 id ≠ 实体 goalId', () => {
    const store = newStore();
    const goalId = createGoal(makeGoal(), store, audit);

    // 真库主键恒为 node-<uuid>；实体 id 只落在 props 里（本条钉住该语义）
    const rows = store.queryNodes('GOAL', { goalId }, 'growth');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(goalId);
    expect(rows[0].id.startsWith('node-')).toBe(true);
    expect((rows[0].props as { goalId?: string }).goalId).toBe(goalId);

    // 改前（用 getNode(goalId)）此处恒 null
    const got = getGoal(goalId, store, 'growth');
    expect(got).not.toBeNull();
    expect(got?.goalId).toBe(goalId);
    expect(got?.title).toBe('盯住现金流');

    // 租户读侧（R21 载体 = props.orgId）
    expect(listGoalsByOrg('org-a', store, 'growth')).toHaveLength(1);
    expect(listGoalsByOrg('org-b', store, 'growth')).toHaveLength(0);
  });

  it('正常: updateGoalStatus 同状态 + extraProps 真写入 metrics（节点 id 定位）', () => {
    const store = newStore();
    const goalId = createGoal(makeGoal(), store, audit);

    expect(() => updateGoalStatus(goalId, 'draft', store, audit, 'growth', {
      metrics: [{ metricName: '目标达成', currentValue: 0, targetValue: 42, unit: '%', computeContractId: 'COMPUTE-GOAL-ACHIEVEMENT-v1' }],
    })).not.toThrow();

    const after = getGoal(goalId, store, 'growth');
    expect(after?.metrics[0]?.targetValue).toBe(42);
    // 状态未变、lastModifiedAt 已刷新（同状态转换合法：goal-store.ts isValidTransition）
    expect(after?.status).toBe('draft');
    expect(after?.lastModifiedAt).not.toBe('2026-10-08T00:00:00.000Z');
  });

  it('降级: store 不可用 ⇒ getGoal 返回 null（不抛）；updateGoalStatus 抛「不存在」', () => {
    expect(getGoal('any-id', brokenStore, 'growth')).toBeNull();
    expect(() => updateGoalStatus('any-id', 'draft', brokenStore, audit, 'growth'))
      .toThrowError(/不存在/);
  });

  it('边界: 同名不同 id 的节点不得被误命中（fail-closed，不猜）', () => {
    const store = newStore();
    createGoal(makeGoal({ title: '同名' }), store, audit);
    const other = createGoal(makeGoal({ title: '同名' }), store, audit);

    // 凭空造一个「存在同名节点但无此 id」的查询
    const ghosts = store.queryNodes('GOAL', {}, 'growth').filter(r => (r.props as { goalId?: string }).goalId === other);
    expect(ghosts).toHaveLength(1);
    expect(getGoal('no-such-goal-id', store, 'growth')).toBeNull();
  });

  it('边界: 空 goalId ⇒ null（不匹配任何节点）', () => {
    const store = newStore();
    createGoal(makeGoal(), store, audit);
    expect(getGoal('', store, 'growth')).toBeNull();
  });

  it('边界: 两个 org 的 GOAL 互不串（props.orgId 各自正确）', () => {
    const store = newStore();
    const a = createGoal(makeGoal({ orgId: 'org-a', title: 'A 的目标' }), store, audit);
    const b = createGoal(makeGoal({ orgId: 'org-b', title: 'B 的目标' }), store, audit);

    const ofA = listGoalsByOrg('org-a', store, 'growth');
    const ofB = listGoalsByOrg('org-b', store, 'growth');
    expect(ofA.map(g => g.goalId)).toEqual([a]);
    expect(ofB.map(g => g.goalId)).toEqual([b]);
    expect(getGoal(b, store, 'growth')?.orgId).toBe('org-b');
  });
});
