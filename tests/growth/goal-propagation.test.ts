/**
 * tests/growth/goal-propagation.test.ts — K6-W2 / 1-4 目标传导到每个人
 *
 * 三路径（铁律 48，非空壳）:
 *   正常 — 3 名成员 → 3 个 GOAL_ASSIGNMENT 节点，coverage 3/3
 *   降级 — graph store 不可用 → log.error + degraded=true，不抛
 *   边界 — 目标不存在 / 成员空集 / 重复成员 → 拒绝码 + 去重
 * 另附:
 *   变异体判别 — 真实库上「GOAL_ASSIGNMENT 增量 = 成员数」（去掉传导调用即 0，测试必红）
 *   Done 判据 — 临时库上 `COUNT(graph_nodes WHERE type LIKE 'goal%') > 0`（原文列名 node_type
 *               不存在 + data/ 被 gitignore ⇒ 按 CTO §4.5 收窄为「语义不变 + 可跑」，见文末用例）
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createGoal, propagateGoalToMembers, listGoalAssignments, getGoalCoverage } from '../../src/growth/goal-store';
import { GOAL_ASSIGNMENT_NODE_TYPE } from '../../src/growth/goal-types';
import type { Goal, GoalMember, GraphBridgeLike, AuditStoreLike } from '../../src/growth/goal-types';

// ═══ 夹具 ═══

const audit: AuditStoreLike = {
  async write() { return 'audit-k6-w2'; },
};

const BASE_GOAL: Goal = {
  goalId: '',
  orgId: 'org-k6-w2',
  proposalId: 'prop-k6-w2',
  diagnosisId: 'diag-k6-w2',
  title: '把营收增长率提到 15%',
  description: 'K6-W2 目标传导夹具',
  priority: 'P1',
  status: 'active',
  ownerDeptId: 'dept-k6',
  assignedTo: 'u-1',
  createdAt: '2026-10-06T00:00:00.000Z',
  deadline: '2026-12-31T00:00:00.000Z',
  metrics: [
    { metricName: '营收增长率', currentValue: 5, targetValue: 15, unit: '%', computeContractId: 'COMPUTE-REVENUE-v1' },
  ],
  successCriteria: [
    { criterion: '月度营收 ≥ 500 万', verificationMethod: 'metric_threshold', verified: false },
  ],
  dependsOn: [],
  conflictsWith: [],
  reDiagnosisCount: 0,
  createdBy: { role: 'manager', departmentId: 'dept-k6' },
  lastModifiedAt: '2026-10-06T00:00:00.000Z',
  plannedDurationDays: 90,
};

const MEMBERS: GoalMember[] = [
  { userId: 'u-1', role: 'manager', deptId: 'dept-k6' },
  { userId: 'u-2', role: 'staff', deptId: 'dept-k6' },
  { userId: 'u-3', role: 'staff', deptId: 'dept-k6' },
];

interface CountRow { c: number }

function createStore(): { db: Database.Database; store: SqliteGraphStore } {
  const db = new Database(':memory:');
  const store = new SqliteGraphStore(db);
  return { db, store };
}

/** 全接口抛错：模拟 GraphStore 不可用（降级路径） */
function createUnavailableStore(): GraphBridgeLike {
  const boom = (): never => { throw new Error('graph store unavailable (fixture)'); };
  return {
    createNode: boom,
    getNode: boom,
    updateNode: boom,
    queryNodes: boom,
  };
}

/** 只在写入时抛错：模拟「目标可读、落库失败」的中断降级 */
function createWriteFailingStore(base: GraphBridgeLike): GraphBridgeLike {
  return {
    queryNodes: (type, filters, graph) => base.queryNodes(type, filters, graph),
    getNode: (id, graph) => base.getNode(id, graph),
    updateNode: (id, props, graph) => base.updateNode(id, props, graph),
    createNode: () => { throw new Error('disk I/O error (fixture)'); },
  };
}

function countByType(db: Database.Database, type: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM graph_nodes WHERE type = ?').get(type) as CountRow;
  return row.c;
}

// ═══ 正常路径 ═══

describe('1-4 目标传导：正常路径', () => {
  it('Given 3 名成员, When propagateGoalToMembers, Then 3 个 GOAL_ASSIGNMENT 节点 + coverage 3/3', () => {
    const { db, store } = createStore();
    try {
      const goalId = createGoal({ ...BASE_GOAL }, store, audit);
      const result = propagateGoalToMembers(goalId, MEMBERS, store);

      expect(result.ok).toBe(true);
      expect(result.code).toBe('OK');
      expect(result.degraded).toBe(false);
      expect(result.expectedMembers).toBe(3);
      expect(result.assignments).toHaveLength(3);
      expect(result.assignments.every(a => a.goalId === goalId && a.status === 'pending')).toBe(true);

      const listed = listGoalAssignments(goalId, store);
      expect(listed).toHaveLength(3);
      expect(listed.map(a => a.userId).sort()).toEqual(['u-1', 'u-2', 'u-3']);

      const coverage = getGoalCoverage(goalId, MEMBERS, store);
      expect(coverage.expected).toBe(3);
      expect(coverage.assigned).toBe(3);
      expect(coverage.ratio).toBe(1);
      expect(coverage.missingUserIds).toEqual([]);
      expect(coverage.degraded).toBe(false);

      // 落库物理事实（等价列名 type；判据原文列名 node_type 不存在，见 PLAN-K6 §0）
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE)).toBe(3);
      const goalLike = db.prepare(`SELECT COUNT(*) AS c FROM graph_nodes WHERE type LIKE 'goal%'`).get() as CountRow;
      expect(goalLike.c).toBeGreaterThanOrEqual(4);
    } finally {
      db.close();
    }
  });

  it('Given 成员清单含重复 userId, When propagateGoalToMembers, Then 去重后只派发一次', () => {
    const { db, store } = createStore();
    try {
      const goalId = createGoal({ ...BASE_GOAL }, store, audit);
      const duplicated: GoalMember[] = [...MEMBERS, { userId: 'u-1', role: 'staff' }];
      const result = propagateGoalToMembers(goalId, duplicated, store);

      expect(result.ok).toBe(true);
      expect(result.expectedMembers).toBe(3);
      expect(result.assignments).toHaveLength(3);
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE)).toBe(3);
    } finally {
      db.close();
    }
  });
});

// ═══ 降级路径 ═══

describe('1-4 目标传导：降级路径（graph store 不可用）', () => {
  it('Given graph store 全接口不可用, When propagateGoalToMembers, Then degraded=true 且不抛', () => {
    const result = propagateGoalToMembers('goal-x', MEMBERS, createUnavailableStore());

    expect(result.ok).toBe(false);
    expect(result.code).toBe('STORE_UNAVAILABLE');
    expect(result.degraded).toBe(true);
    expect(result.assignments).toEqual([]);
    expect(result.reason).toContain('unavailable');
  });

  it('Given 目标可读但写入抛错, When propagateGoalToMembers, Then 中断降级且已写入部分如实保留', () => {
    const { db, store } = createStore();
    try {
      const goalId = createGoal({ ...BASE_GOAL }, store, audit);
      const result = propagateGoalToMembers(goalId, MEMBERS, createWriteFailingStore(store));

      expect(result.ok).toBe(false);
      expect(result.code).toBe('STORE_UNAVAILABLE');
      expect(result.degraded).toBe(true);
      expect(result.expectedMembers).toBe(3);
      expect(result.assignments).toHaveLength(0);
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('Given graph store 不可用, When listGoalAssignments / getGoalCoverage, Then 空列表 + degraded 标记（不伪装成已覆盖）', () => {
    const unavailable = createUnavailableStore();

    expect(listGoalAssignments('goal-x', unavailable)).toEqual([]);

    const coverage = getGoalCoverage('goal-x', MEMBERS, unavailable);
    expect(coverage.degraded).toBe(true);
    expect(coverage.assigned).toBe(0);
    expect(coverage.expected).toBe(3);
    expect(coverage.missingUserIds).toEqual(['u-1', 'u-2', 'u-3']);
  });
});

// ═══ 边界条件 ═══

describe('1-4 目标传导：边界条件', () => {
  it('Given 目标不存在, When propagateGoalToMembers, Then 拒绝并给 GOAL_NOT_FOUND 错误码', () => {
    const { db, store } = createStore();
    try {
      const result = propagateGoalToMembers('goal-不存在', MEMBERS, store);

      expect(result.ok).toBe(false);
      expect(result.code).toBe('GOAL_NOT_FOUND');
      expect(result.degraded).toBe(false);
      expect(result.assignments).toEqual([]);
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('Given 成员空集, When propagateGoalToMembers, Then 拒绝并给 EMPTY_MEMBERS 错误码', () => {
    const { db, store } = createStore();
    try {
      const goalId = createGoal({ ...BASE_GOAL }, store, audit);
      const result = propagateGoalToMembers(goalId, [], store);

      expect(result.ok).toBe(false);
      expect(result.code).toBe('EMPTY_MEMBERS');
      expect(result.degraded).toBe(false);
      expect(result.expectedMembers).toBe(0);
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('Given 成员 userId 全为空白, When propagateGoalToMembers, Then 视为空集拒绝', () => {
    const { db, store } = createStore();
    try {
      const goalId = createGoal({ ...BASE_GOAL }, store, audit);
      const result = propagateGoalToMembers(goalId, [{ userId: '   ' }, { userId: '' }], store);

      expect(result.code).toBe('EMPTY_MEMBERS');
      expect(result.degraded).toBe(false);
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('Given 3 人应派发但只派发 2 人, When getGoalCoverage, Then ratio=2/3 且 missing 点名', () => {
    const { db, store } = createStore();
    try {
      const goalId = createGoal({ ...BASE_GOAL }, store, audit);
      propagateGoalToMembers(goalId, MEMBERS.slice(0, 2), store);

      const coverage = getGoalCoverage(goalId, MEMBERS, store);
      expect(coverage.expected).toBe(3);
      expect(coverage.assigned).toBe(2);
      expect(coverage.ratio).toBeCloseTo(2 / 3);
      expect(coverage.missingUserIds).toEqual(['u-3']);
      expect(coverage.degraded).toBe(false);
    } finally {
      db.close();
    }
  });
});

// ═══ Done 判据（可跑形态：临时库，不依赖 gitignored 路径）═══

// 判据形态（CTO §4.5）: 不得依赖 gitignored 路径（data/ 被 .gitignore:3 排除 ⇒ 干净检出无该文件，
// 那是「平凡红」）。故本用例自建**临时库**并把同一断言跑起来 —— 语义不变（传导后确实存在
// type LIKE 'goal%' 的节点），形态可跑。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'k6-1-4-propagation-'));
const TMP_DB_PATH = path.join(TMP_DIR, 'goal-propagation.db');

describe('1-4 判据：真实 data/synova.db', () => {
  it('Given 真实库, When 传导到 3 人, Then GOAL_ASSIGNMENT 增量=3 且 type LIKE goal% 计数 > 0', () => {
    const db = new Database(TMP_DB_PATH);
    try {
      const store = new SqliteGraphStore(db);
      const runTag = `k6-w2-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const goalId = createGoal({ ...BASE_GOAL, orgId: runTag, title: `K6-W2 传导判据 ${runTag}` }, store, audit);
      const before = countByType(db, GOAL_ASSIGNMENT_NODE_TYPE);

      const result = propagateGoalToMembers(goalId, MEMBERS, store);

      expect(result.ok).toBe(true);
      expect(countByType(db, GOAL_ASSIGNMENT_NODE_TYPE) - before).toBe(3);

      // 判据语义等价式（原文列名 node_type 不存在 ⇒ 实测列名 type，见 PLAN-K6 §0；形态待 V4 提案定稿对齐）
      const goalLike = db.prepare(`SELECT COUNT(*) AS c FROM graph_nodes WHERE type LIKE 'goal%'`).get() as CountRow;
      expect(goalLike.c).toBeGreaterThan(0);

      const coverage = getGoalCoverage(goalId, MEMBERS, store);
      expect(coverage.ratio).toBe(1);
      expect(listGoalAssignments(goalId, store)).toHaveLength(3);
    } finally {
      db.close();
      fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
