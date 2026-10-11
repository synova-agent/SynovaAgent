/**
 * tests/l4/goal-alignment.test.ts — #190 / K12-07 目标一致（岗位 ↔ 公司，可追溯）
 *
 * 判据源: docs/synova/coordination/施工项登记.ts → K12-07（Issue #190）
 *   `npx vitest run tests/l4/goal-alignment.test.ts` ⇒ exit 0
 *
 * 覆盖（卡面 Q3 五条 + 铁律 48 三路径）:
 *   V1 端点矩阵（新边类型真从 JSON 进矩阵，不靠硬编码）
 *   V2 **可追溯（穿生产入口）**: 岗位目标 ⇒ 公司目标的**逐跳**链路
 *   V3 反向: 公司目标 ⇒ 分解到的岗位目标集合
 *   V4 **反例**: 断开分解边 ⇒ 必红（改回 ⇒ 全绿）
 *   V5 与建档: 建档产出的 GOAL 节点（`extensions/presets/roles/*` 岗位 ＋ conversation-engine
 *      字面量 `'Goal'` 的 Phase 0 访谈摘要）**接入本链路**
 *   降级 / 边界 / 确定性: 无 queryEdges 能力、读图抛错、目标不存在、无父边、成环、非目标端点
 *
 * 存储选择（**实测驱动**，非风格偏好）:
 *   本件按铁律 33 是**单元测试**（`*.test.ts` = 纯函数/无 I/O；真库形态属
 *   `.integration.test.ts`），故用**内存 GraphStore 实现**（与 `tests/l4/edges/*.test.ts` 同范式），
 *   忠实复刻真库语义: 节点 id 恒 `node-<n>`（实体 id 只落在 props 里）、`type` 比较**大小写敏感**、
 *   `deleteEdge/deleteNode` 为**软删**（查询不再可见）、`updateNode` 为 props **合并**。
 *   🔴 为什么不用真库 SqliteGraphStore（试过，实测数据在案）: better-sqlite3 的 Statement/Database
 *   析构器会在 **vitest worker 关闭期的 GC** 里调 `node::RemoveEnvironmentCleanupHook`，env 已拆
 *   ⇒ 断言失败 ⇒ **原生 abort（`Worker exited unexpectedly`，本文件 20 例全丢）**。
 *   实测: 真库写法 **3/6 崩**（补 `db.close()` 后仍 3/6；改共享句柄后 7/8）；内存实现 **0/8 崩**。
 *   代价（如实）: 存储层真实性下沉到探针 `scripts/control-tower/probe-goal-alignment.ts`
 *   （真 SqliteGraphStore ＋ 真 createGoal ＋ 真建档岗位，端到端跑一遍并打印逐跳链路）。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGoal } from '../../src/growth/goal-store';
import { BriefingGenerator } from '../../src/l3/briefing-generator';
import { validateEdgeEndpoints } from '../../src/l4/ontology-loader';
import {
  listDecomposedGoals,
  traceGoalToCompany,
  type GoalAlignmentStore,
} from '../../src/l4/goal-alignment';
import type { Goal, AuditStoreLike } from '../../src/growth/goal-types';
import { createLogger } from '@synova/logger';

const log = createLogger('tests/l4/goal-alignment');

/** 与 `src/growth/goal-store.ts` 默认图名一致（简报/目标同图才追得到） */
const GRAPH = 'growth';
/** 分解边 label —— 与 `extensions/ontology/edge-types/goal_decomposition.json` 逐字一致（改坏即红） */
const EDGE = 'GOAL_DECOMPOSITION';

const audit: AuditStoreLike = {
  async write() { return 'audit-k12-07'; },
};

// ═══ 夹具 ═══

/**
 * 内存 GraphStore —— 忠实复刻真 SqliteGraphStore 对本模块**可观测**的语义
 * （软删 / props 合并 / 大小写敏感的 type / `node-<n>` 主键），但**不引入原生句柄**
 * （理由与实测数据见文件头「存储选择」）。
 */
interface FakeNode {
  id: string;
  graph: string;
  type: string;
  props: Record<string, unknown>;
  deleted: boolean;
}

interface FakeEdge {
  id: string;
  graph: string;
  type: string;
  from: string;
  to: string;
  weight: number;
  props: Record<string, unknown>;
  deleted: boolean;
}

/** 内存图（每测试新建；无原生句柄 ⇒ 无关闭期析构风险） */
function createFakeGraph() {
  const nodes: FakeNode[] = [];
  const edges: FakeEdge[] = [];
  let nodeSeq = 0;
  let edgeSeq = 0;

  const visibleNodes = (graph: string): FakeNode[] =>
    nodes.filter((n) => n.graph === graph && !n.deleted);
  const visibleEdges = (graph: string): FakeEdge[] =>
    edges.filter((e) => e.graph === graph && !e.deleted);

  return {
    /** 真库恒生成 `node-<uuid>` 主键；实体 id 只落在 props 里（此处同构: `node-<n>`） */
    createNode(type: string, props: Record<string, unknown>, graph: string): string {
      nodeSeq += 1;
      const id = `node-${String(nodeSeq)}`;
      nodes.push({ id, graph, type, props: { ...props }, deleted: false });
      return id;
    },
    /** type 比较**大小写敏感**（同 SQLite `type = ?`）—— 'GOAL' 查不到 'Goal'，本卡 V5 靠它才可判 */
    queryNodes(type: string, filters?: Record<string, unknown>, graph = 'default') {
      let rows = visibleNodes(graph).filter((n) => n.type === type);
      if (filters !== undefined) {
        for (const [key, value] of Object.entries(filters)) {
          if (value === undefined || value === null) continue;
          rows = rows.filter((n) => String(n.props[key]) === String(value));
        }
      }
      return rows.map((n) => ({ id: n.id, type: n.type, props: { ...n.props } }));
    },
    createEdge(
      type: string,
      from: string,
      to: string,
      weight = 1,
      props: Record<string, unknown> = {},
      graph = 'default',
    ): string {
      edgeSeq += 1;
      const id = `edge-${String(edgeSeq)}`;
      edges.push({ id, graph, type, from, to, weight, props: { ...props }, deleted: false });
      return id;
    },
    queryEdges(type?: string, from?: string, to?: string, graph = 'default') {
      let rows = visibleEdges(graph);
      if (type !== undefined) rows = rows.filter((e) => e.type === type);
      if (from !== undefined) rows = rows.filter((e) => e.from === from);
      if (to !== undefined) rows = rows.filter((e) => e.to === to);
      return rows.map((e) => ({
        id: e.id, type: e.type, from: e.from, to: e.to, weight: e.weight, props: { ...e.props },
      }));
    },
    getNode(id: string, graph = 'default') {
      const hit = visibleNodes(graph).find((n) => n.id === id);
      return hit === undefined ? null : { id: hit.id, type: hit.type, props: { ...hit.props } };
    },
    /** props 合并（同真库 updateNode 语义） */
    updateNode(id: string, props: Record<string, unknown>, graph = 'default'): void {
      const hit = visibleNodes(graph).find((n) => n.id === id);
      if (hit === undefined) return;
      hit.props = { ...hit.props, ...props };
    },
    /** 软删（同真库: 置 valid_to，查询不再可见） */
    deleteEdge(id: string, graph = 'default'): void {
      const hit = edges.find((e) => e.id === id && e.graph === graph);
      if (hit !== undefined) hit.deleted = true;
    },
    deleteNode(id: string, graph = 'default'): void {
      const hit = nodes.find((n) => n.id === id && n.graph === graph);
      if (hit !== undefined) hit.deleted = true;
    },
  };
}

type FakeGraph = ReturnType<typeof createFakeGraph>;

function newStore(): FakeGraph {
  return createFakeGraph();
}

function makeGoalInput(overrides: Partial<Goal> = {}): Goal {
  return {
    goalId: '',
    orgId: 'org-1',
    proposalId: '',
    diagnosisId: '',
    title: '未命名目标',
    description: 'K12-07 目标一致夹具',
    priority: 'P1',
    status: 'draft',
    ownerDeptId: 'dept-1',
    createdAt: '2026-10-11T00:00:00.000Z',
    deadline: '2026-12-31T00:00:00.000Z',
    metrics: [
      { metricName: '目标达成', currentValue: 0, targetValue: 15, unit: '%', computeContractId: 'COMPUTE-GOAL-ACHIEVEMENT-v1' },
    ],
    successCriteria: [],
    dependsOn: [],
    conflictsWith: [],
    reDiagnosisCount: 0,
    createdBy: { role: 'manager', departmentId: 'dept-1' },
    lastModifiedAt: '2026-10-11T00:00:00.000Z',
    plannedDurationDays: 90,
    ...overrides,
  };
}

/** 走**生产写入路径**建目标（`createGoal` → `store.createNode('GOAL', …)`），返回实体 goalId */
function seedGoal(store: FakeGraph, overrides: Partial<Goal> = {}): string {
  return createGoal(makeGoalInput(overrides), store, audit, GRAPH);
}

/** 实体 goalId → 图节点 id（真库主键恒 `node-<uuid>`，实体 id 只落在 props 里） */
function nodeIdOf(store: FakeGraph, goalId: string): string {
  const rows = store.queryNodes('GOAL', { goalId }, GRAPH);
  expect(rows, `实体 goalId=${goalId} 应命中唯一图节点`).toHaveLength(1);
  return rows[0].id;
}

/**
 * 打层级标记（公司级/岗位级的**显式**标记 —— 本模块不猜）。
 * `Goal` 28 字段无 level 字段 ⇒ 走 store 原语 `updateNode`（props 合并语义，sqlite-graph-store:318-332）。
 */
function markLevel(store: FakeGraph, nodeId: string, level: string): void {
  store.updateNode(nodeId, { level }, GRAPH);
}

/** 建分解边（父 → 子）；返回边 id（V4 断边用） */
function linkParent(
  store: FakeGraph,
  parentNodeId: string,
  childNodeId: string,
  decompositionType = 'company_to_role',
): string {
  return store.createEdge(EDGE, parentNodeId, childNodeId, 1.0, { decomposition_type: decompositionType }, GRAPH);
}

/** 三段链夹具：公司目标 ← 部门目标 ← 岗位目标（两跳） */
function seedTwoHopChain(store: FakeGraph): {
  companyGoal: string; deptGoal: string; roleGoal: string;
  companyNode: string; deptNode: string; roleNode: string;
} {
  const companyGoal = seedGoal(store, { title: '公司目标：营收翻倍', orgId: 'org-1' });
  const deptGoal = seedGoal(store, { title: '部门目标：销售翻倍', ownerDeptId: 'sales' });
  const roleGoal = seedGoal(store, { title: '岗位目标：月签 10 单', ownerDeptId: 'sales' });
  const companyNode = nodeIdOf(store, companyGoal);
  const deptNode = nodeIdOf(store, deptGoal);
  const roleNode = nodeIdOf(store, roleGoal);
  markLevel(store, companyNode, 'company');
  markLevel(store, deptNode, 'dept');
  markLevel(store, roleNode, 'role');
  linkParent(store, companyNode, deptNode, 'company_to_dept');
  linkParent(store, deptNode, roleNode, 'dept_to_role');
  return { companyGoal, deptGoal, roleGoal, companyNode, deptNode, roleNode };
}

// ═══ V1: 端点矩阵 ═══

describe('K12-07 V1 — 目标分解边类型（本体真源 → 端点矩阵）', () => {
  it('端点矩阵放行 GOAL/Goal 两侧（新建 JSON 真被 ontology-loader 加载）', () => {
    expect(validateEdgeEndpoints(EDGE, 'GOAL', 'GOAL')).toBe(true);
    expect(validateEdgeEndpoints(EDGE, 'GOAL', 'Goal')).toBe(true);
    expect(validateEdgeEndpoints(EDGE, 'Goal', 'GOAL')).toBe(true);
  });

  it('端点矩阵拒非目标端点（矩阵不是"什么都能连"）', () => {
    expect(validateEdgeEndpoints(EDGE, 'GOAL', 'outcome/financial')).toBe(false);
    expect(validateEdgeEndpoints(EDGE, 'TEAM', 'GOAL')).toBe(false);
    expect(validateEdgeEndpoints('NOT_A_REAL_EDGE', 'GOAL', 'GOAL')).toBe(false);
  });
});

// ═══ V2: 可追溯（向上逐跳）═══

describe('K12-07 V2 — 岗位目标 ⇒ 公司目标（逐跳）', () => {
  it('两跳链路：岗位 ← 部门 ← 公司，逐跳可核', () => {
    const store = newStore();
    const { companyGoal, deptGoal, roleGoal, companyNode, deptNode, roleNode } = seedTwoHopChain(store);

    const trace = traceGoalToCompany(store, roleGoal, GRAPH);

    expect(trace.satisfied).toBe(true);
    expect(trace.degraded).toBe(false);
    expect(trace.startNodeId).toBe(roleNode);
    expect(trace.companyGoalId).toBe(companyGoal);
    expect(trace.companyNodeId).toBe(companyNode);
    expect(trace.hops).toHaveLength(2);
    // hops[] 按遍历序（起点在下）：第 1 跳 = 部门→岗位，第 2 跳 = 公司→部门
    expect(trace.hops.map((h) => [h.parentId, h.childId])).toEqual([
      [deptNode, roleNode],
      [companyNode, deptNode],
    ]);
    expect(trace.hops.map((h) => h.parentLevel)).toEqual(['dept', 'company']);
    expect(trace.hops.map((h) => h.childLevel)).toEqual(['role', 'dept']);
    expect(trace.path.map((n) => n.goalId)).toEqual([roleGoal, deptGoal, companyGoal]);
    expect(trace.errors).toEqual([]);

    // 逐跳原始输出（可复核证据）
    const chain = trace.path.map((n) => `${n.title}[${n.level}]`).join('  ←  ');
    log.info(`V2 链路（${trace.hops.length} 跳）: ${chain}`);
    log.info(`V2 逐跳: ${trace.hops.map((h) => `${h.parentId} --${h.edgeId}--> ${h.childId}`).join(' | ')}`);
  });

  it('起点本身即公司级 ⇒ satisfied 且 hops 为空（不硬凑跳数）', () => {
    const store = newStore();
    const companyGoal = seedGoal(store, { title: '公司目标' });
    const companyNode = nodeIdOf(store, companyGoal);
    markLevel(store, companyNode, 'company');

    const trace = traceGoalToCompany(store, companyGoal, GRAPH);

    expect(trace.satisfied).toBe(true);
    expect(trace.hops).toEqual([]);
    expect(trace.companyGoalId).toBe(companyGoal);
    expect(trace.companyNodeId).toBe(companyNode);
  });

  it('实体 goalId 与图节点 id 两种入参等价（真库两层 id 语义）', () => {
    const store = newStore();
    const { roleGoal, roleNode } = seedTwoHopChain(store);

    const byEntity = traceGoalToCompany(store, roleGoal, GRAPH);
    const byNodeId = traceGoalToCompany(store, roleNode, GRAPH);

    expect(byEntity.satisfied).toBe(true);
    expect(byNodeId.satisfied).toBe(true);
    expect(byNodeId.startNodeId).toBe(roleNode);
    expect(byNodeId.companyGoalId).toBe(byEntity.companyGoalId);
  });

  it('确定性：同输入两次运行逐字节一致（BFS 最短链 + 排序键）', () => {
    const store = newStore();
    const { roleGoal } = seedTwoHopChain(store);

    const first = traceGoalToCompany(store, roleGoal, GRAPH);
    const second = traceGoalToCompany(store, roleGoal, GRAPH);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

// ═══ V3: 反向（向下集合）═══

describe('K12-07 V3 — 公司目标 ⇒ 分解到的岗位目标集合', () => {
  it('两跳下级全部返回，公司目标自身不在集合内', () => {
    const store = newStore();
    const { companyGoal, deptGoal, roleGoal } = seedTwoHopChain(store);

    const decomposed = listDecomposedGoals(store, companyGoal, GRAPH);

    expect(decomposed.degraded).toBe(false);
    expect(decomposed.companyGoalId).toBe(companyGoal);
    expect(decomposed.goals.map((g) => g.goalId).sort()).toEqual([deptGoal, roleGoal].sort());
    expect(decomposed.roleGoals.map((g) => g.goalId).sort()).toEqual([deptGoal, roleGoal].sort());
    expect(decomposed.hops).toHaveLength(2);
    expect(decomposed.errors).toEqual([]);
    log.info(`V3 反查集合: ${decomposed.roleGoals.map((g) => g.title).join(' , ')}`);
  });

  it('边界: 起点非公司级 ⇒ fail-closed 空集 + 显式错误（不用中层目标冒充公司目标）', () => {
    const store = newStore();
    const { deptGoal } = seedTwoHopChain(store);

    const decomposed = listDecomposedGoals(store, deptGoal, GRAPH);

    expect(decomposed.goals).toEqual([]);
    expect(decomposed.roleGoals).toEqual([]);
    expect(decomposed.degraded).toBe(false);
    expect(decomposed.errors.join(' ')).toContain('非公司级');
  });

  it('边界: 目标不存在 ⇒ 空集 + 显式错误（fail-closed，不猜）', () => {
    const store = newStore();
    seedTwoHopChain(store);

    const decomposed = listDecomposedGoals(store, 'no-such-goal', GRAPH);

    expect(decomposed.companyGoalId).toBe('no-such-goal');
    expect(decomposed.goals).toEqual([]);
    expect(decomposed.errors.join(' ')).toContain('公司目标不存在');
  });
});

// ═══ V4: 反例（断开分解边 ⇒ 必红）═══

describe('K12-07 V4 — 断开分解边 ⇒ 追溯必红', () => {
  it('断边 ⇒ satisfied:false + 链顶报错；改回 ⇒ 全绿', () => {
    const store = newStore();
    const companyGoal = seedGoal(store, { title: '公司目标' });
    const roleGoal = seedGoal(store, { title: '岗位目标' });
    const companyNode = nodeIdOf(store, companyGoal);
    const roleNode = nodeIdOf(store, roleGoal);
    markLevel(store, companyNode, 'company');
    markLevel(store, roleNode, 'role');
    const edgeId = linkParent(store, companyNode, roleNode, 'company_to_role');

    // ① 绿
    expect(traceGoalToCompany(store, roleGoal, GRAPH).satisfied).toBe(true);

    // ② 断开分解边（软删；queryEdges 不再返回）⇒ 必红
    store.deleteEdge(edgeId, GRAPH);
    const broken = traceGoalToCompany(store, roleGoal, GRAPH);
    log.info(`V4 断边后: satisfied=${String(broken.satisfied)} errors=${broken.errors.join(' | ')}`);
    expect(broken.satisfied).toBe(false);
    expect(broken.companyGoalId).toBeNull();
    expect(broken.hops).toEqual([]);
    expect(broken.errors.join(' ')).toContain('未抵达公司目标');

    // ③ 改回 ⇒ 全绿（证明红是"边"造成的，不是"路径恰好为空"）
    linkParent(store, companyNode, roleNode, 'company_to_role');
    expect(traceGoalToCompany(store, roleGoal, GRAPH).satisfied).toBe(true);
  });

  it('链顶无公司级标记 ⇒ 不追认为公司目标（V4 可红的前提）', () => {
    const store = newStore();
    const parentGoal = seedGoal(store, { title: '未标记的上层目标' });
    const roleGoal = seedGoal(store, { title: '岗位目标' });
    const parentNode = nodeIdOf(store, parentGoal);
    const roleNode = nodeIdOf(store, roleGoal);
    markLevel(store, roleNode, 'role'); // 父节点刻意不打标记
    linkParent(store, parentNode, roleNode, 'company_to_role');

    const trace = traceGoalToCompany(store, roleGoal, GRAPH);

    expect(trace.satisfied).toBe(false);
    expect(trace.companyGoalId).toBeNull();
    expect(trace.errors.join(' ')).toContain('公司级标记');
  });

  it('非目标端点（TEAM 节点当父）⇒ 端点矩阵拒绝遍历', () => {
    const store = newStore();
    const roleGoal = seedGoal(store, { title: '岗位目标' });
    const roleNode = nodeIdOf(store, roleGoal);
    markLevel(store, roleNode, 'role');
    const teamNode = store.createNode('TEAM', { name: '销售一队' }, GRAPH);
    linkParent(store, teamNode, roleNode, 'company_to_role');

    const trace = traceGoalToCompany(store, roleGoal, GRAPH);

    expect(trace.satisfied).toBe(false);
    expect(trace.errors.join(' ')).toContain('不是 GOAL/Goal 节点');
  });

  it('边界: 分解边成环 ⇒ 有界终止 + 显式记账（不挂死、不静默）', () => {
    const store = newStore();
    const goalA = seedGoal(store, { title: '目标 A' });
    const goalB = seedGoal(store, { title: '目标 B' });
    const nodeA = nodeIdOf(store, goalA);
    const nodeB = nodeIdOf(store, goalB);
    markLevel(store, nodeA, 'role');
    markLevel(store, nodeB, 'role');
    linkParent(store, nodeB, nodeA, 'dept_to_role');
    linkParent(store, nodeA, nodeB, 'dept_to_role');

    const trace = traceGoalToCompany(store, goalA, GRAPH);

    expect(trace.satisfied).toBe(false);
    expect(trace.errors.some((e) => e.includes('成环'))).toBe(true);
  });
});

// ═══ V5: 与建档 ═══

describe('K12-07 V5 — 建档产出的 GOAL 节点接入本链路', () => {
  it('建档产出的岗位（extensions/presets/roles/*）+ Phase 0 访谈摘要（字面量 Goal）都可追溯', () => {
    const store = newStore();
    const companyGoal = seedGoal(store, { title: '公司目标：三年十倍' });
    const companyNode = nodeIdOf(store, companyGoal);
    markLevel(store, companyNode, 'company');

    // ① 建档产出的岗位（真读内容面目录 —— K12-01/03 的落点），每个岗位一个岗位目标
    const roleIds = readdirSync(join(process.cwd(), 'extensions', 'presets', 'roles'))
      .filter((name) => !name.startsWith('.'))
      .sort();
    expect(roleIds.length).toBeGreaterThanOrEqual(3);
    const roleGoalByRole = new Map<string, string>();
    for (const roleId of roleIds) {
      const goalId = seedGoal(store, { title: `岗位目标：${roleId}`, ownerDeptId: roleId });
      const nodeId = nodeIdOf(store, goalId);
      markLevel(store, nodeId, 'role');
      linkParent(store, companyNode, nodeId, 'company_to_role');
      roleGoalByRole.set(roleId, goalId);
    }

    // ② 建档 Phase 0 访谈摘要节点：字面量 'Goal'（载荷逐字取自 src/agent/conversation-engine.ts:543-551）
    const interviewNodeId = store.createNode('Goal', {
      name: 'Phase0_Interview_org-1_k1207',
      description: 'Phase 0 访谈摘要 — 6/6 维度已覆盖',
      goalType: 'mission',
      progress: 1,
    }, GRAPH);
    linkParent(store, companyNode, interviewNodeId, 'company_to_role');

    // ③ 反向：公司目标 ⇒ 分解集合 = 全部建档岗位 + 访谈摘要节点
    const decomposed = listDecomposedGoals(store, companyGoal, GRAPH);
    expect(decomposed.degraded).toBe(false);
    expect(decomposed.goals.map((g) => g.goalId).sort())
      .toEqual([...roleGoalByRole.values(), interviewNodeId].sort());
    expect(decomposed.roleGoals).toHaveLength(roleIds.length + 1);
    log.info(`V5 分解集合(${decomposed.roleGoals.length}): ${decomposed.roleGoals.map((g) => g.title).join(' , ')}`);

    // ④ 向上：每个建档岗位目标都能逐跳追到公司目标
    for (const [roleId, goalId] of roleGoalByRole) {
      const trace = traceGoalToCompany(store, goalId, GRAPH);
      expect(trace.satisfied, `岗位 ${roleId} 应可追溯到公司目标（errors=${trace.errors.join('|')}）`).toBe(true);
      expect(trace.companyGoalId).toBe(companyGoal);
      expect(trace.hops).toHaveLength(1);
    }

    // ⑤ 访谈摘要节点（字面量 'Goal'）同样可追溯 —— 且它在 `queryNodes('GOAL')` 下**不可见**，
    //    证明"类型轴兼容"不是装饰：少枚举 'Goal' 这一个字面量，本步必红
    expect(store.queryNodes('GOAL', {}, GRAPH).some((n) => n.id === interviewNodeId)).toBe(false);
    const interviewTrace = traceGoalToCompany(store, interviewNodeId, GRAPH);
    expect(interviewTrace.satisfied).toBe(true);
    expect(interviewTrace.companyGoalId).toBe(companyGoal);
  });
});

// ═══ 生产入口（穿 BriefingGenerator）═══

describe('K12-07 生产入口 — 每日简报汇总目标一致', () => {
  it('BriefingGenerator.generate(): 可追溯 1 / 未接入 1 / 公司目标分解 1', async () => {
    const store = newStore();
    const companyGoal = seedGoal(store, { title: '公司目标', status: 'active' });
    const roleGoal = seedGoal(store, { title: '岗位目标', status: 'active', ownerDeptId: 'sales' });
    const orphanGoal = seedGoal(store, { title: '孤岛目标', status: 'active', ownerDeptId: 'hr' });
    const companyNode = nodeIdOf(store, companyGoal);
    markLevel(store, companyNode, 'company');
    markLevel(store, nodeIdOf(store, roleGoal), 'role');
    markLevel(store, nodeIdOf(store, orphanGoal), 'role');
    linkParent(store, companyNode, nodeIdOf(store, roleGoal), 'company_to_role');

    const briefing = await new BriefingGenerator(store).generate(GRAPH);

    expect(briefing.goalAlignment.degraded).toBe(false);
    expect(briefing.goalAlignment.traceable).toBe(1);
    expect(briefing.goalAlignment.orphan).toBe(1);
    expect(briefing.goalAlignment.orphanTitles).toContain('孤岛目标');
    expect(briefing.goalAlignment.companyGoals).toHaveLength(1);
    expect(briefing.goalAlignment.companyGoals[0].roleGoals).toBe(1);
    expect(briefing.recommendations.join(' ')).toContain('未接入公司目标链路');
    log.info(`生产入口简报: traceable=${String(briefing.goalAlignment.traceable)} orphan=${String(briefing.goalAlignment.orphan)}`);
  });

  it('降级传播: 简报 store 无 queryEdges 能力 ⇒ goalAlignment.degraded=true + 原因随简报返回', async () => {
    const noEdgesStore = {
      queryNodes: (type: string) => (
        type === 'GOAL'
          ? [{ id: 'node-x', props: { goalId: 'g-x', title: '无边的目标', status: 'active', level: 'role' } }]
          : []
      ),
    };

    const briefing = await new BriefingGenerator(noEdgesStore).generate(GRAPH);

    expect(briefing.goalAlignment.degraded).toBe(true);
    expect(briefing.goalAlignment.errors.join(' ')).toContain('queryEdges');
  });
});

// ═══ 降级路径（模块侧）═══

describe('K12-07 降级 — 能力/环境失败必须显式（铁律 11/24/31）', () => {
  it('store 无 queryEdges ⇒ degraded:true + 原因进 errors（不当成"没有分解边"）', () => {
    const noEdges: GoalAlignmentStore = {
      queryNodes: (type: string) => (
        type === 'GOAL'
          ? [{ id: 'node-no-edge', props: { goalId: 'g-1', title: '角色目标', level: 'role' } }]
          : []
      ),
    };

    const trace = traceGoalToCompany(noEdges, 'g-1', GRAPH);

    expect(trace.degraded).toBe(true);
    expect(trace.satisfied).toBe(false);
    expect(trace.errors.join(' ')).toContain('queryEdges');
  });

  it('queryNodes 抛错 ⇒ degraded:true + 不抛异常（不假装"没有目标"）', () => {
    const broken: GoalAlignmentStore = {
      queryNodes: () => { throw new Error('graph down'); },
      queryEdges: () => [],
    };

    const trace = traceGoalToCompany(broken, 'g-1', GRAPH);

    expect(trace.degraded).toBe(true);
    expect(trace.startNodeId).toBeNull();
    expect(trace.errors.join(' ')).toContain('graph down');
  });

  it('queryEdges 抛错 ⇒ degraded:true + 原因进 errors', () => {
    const flaky: GoalAlignmentStore = {
      queryNodes: (type: string) => (
        type === 'GOAL'
          ? [{ id: 'node-flaky', props: { goalId: 'g-flaky', title: '目标', level: 'role' } }]
          : []
      ),
      queryEdges: () => { throw new Error('triples table locked'); },
    };

    const trace = traceGoalToCompany(flaky, 'g-flaky', GRAPH);

    expect(trace.degraded).toBe(true);
    expect(trace.errors.join(' ')).toContain('triples table locked');
  });

  it('边界: 反查目标不存在 ⇒ 空集 + 显式错误，degraded=false（数据问题 ≠ 模块故障）', () => {
    const noEdges: GoalAlignmentStore = {
      queryNodes: () => [],
    };

    const decomposed = listDecomposedGoals(noEdges, 'nobody', GRAPH);

    expect(decomposed.goals).toEqual([]);
    expect(decomposed.degraded).toBe(false);
    expect(decomposed.errors.join(' ')).toContain('公司目标不存在');
  });
});
