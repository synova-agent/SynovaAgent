/**
 * tests/extensions/goal-alignment-multi-role.test.ts — #733 目标一致：两岗位 goal 追溯 ＋ 断边必红
 *
 * 依据锚（只引用，不重定义）:
 *   · dev doc `.handbook/派单件/2026-10-27-devdoc-825-M7生产消费链接线.md` §4.1（#733 行）
 *     —— 断言对象 = `src/l4/goal-alignment.ts:355` `traceGoalToCompany` ／ `:478` `listDecomposedGoals`；
 *     §4.3 回归（全量跑，禁 `--changed`）
 *   · 规格 `.handbook/派单件/2026-10-27-规格-825-M7前置缺口补齐.md` §4.3（#733 行）
 *   · 产品宪章 §2.7① —— 一致性 = **可对账**（≠ 相同输出）：两岗位各持目标，但对账到**同一**公司目标
 *   · 域守则 `tests/control-tower/AGENTS.md`（测试命名三档／禁空壳／vitest 零失败才合并）
 *
 * 契约（铁律 47；被断言对象自身的契约见 `src/l4/goal-alignment.ts:29-47`）:
 *   @input  — 临时图库（`mkdtemp` 下的 better-sqlite3 **文件**库，库路径不带 `file:` 以外的假设）
 *             ＋ 真生产写入口：
 *               `createGoal`（`src/growth/goal-store.ts:154`）建 GOAL 节点（实体 goalId 落 props）；
 *               `SqliteGraphStore.updateNode` 打层级标记（`Goal` 28 字段无 level，见 goal-alignment.ts:24 注释）；
 *               `SqliteGraphStore.createEdge` 建 `GOAL_DECOMPOSITION` 边（父 → 子，见
 *               `extensions/ontology/edge-types/goal_decomposition.json`）。
 *             🔴 **不造替身 store**：读侧断言对象 = 真 `SqliteGraphStore`；写侧 = 生产 API ＋ 图存储原语。
 *   @output — 三路径断言（见下「三路径」）；每条都断言 `path`/`hops` 的**可追溯性**与**岗位分辨力**。
 *   @degraded — 断言面：能力缺席 ⇒ `degraded:true` ＋ `errors[]`；数据面失败（缺边/缺图）⇒
 *             `satisfied:false` ＋ **显式 `errors[]`**（禁静默空数组）。两路都断言，不混为一谈。
 *
 * 三路径（铁律 48，非空壳）:
 *   正常 — 两岗位（finance/hr，取自内容面 `extensions/presets/roles/**` 实物）各自 `satisfied:true`
 *          且 `companyGoalId` 指向**同一**公司目标；边链经 `queryEdges` 与 `graph_triples` 直查双核；
 *          反向 `listDecomposedGoals` 取回两岗位目标。
 *   降级 — ① 能力缺席（`GoalAlignmentStore.queryEdges` 契约上可选）⇒ `degraded:true` ＋ errors 点名；
 *          ② 缺边（节点在、边不在）/ 缺图（图名不匹配）⇒ `satisfied:false` ＋ errors 明说"未抵达公司目标"
 *             /"目标不存在"——**不是静默空数组**。
 *   反例 — `deleteEdge(finance 的分解边)`（生产软删除原语）⇒ **同一次运行内** finance 追溯红、
 *          hr 仍绿（证明判据有岗位分辨力）；重建该边 ⇒ finance 转绿（证明断言不是恒红）。
 *
 * 设计哲学: 目标一致性不是"两个岗位输出相同"，而是**两条链各自可对账到同一个公司目标** ——
 *   所以本件的判据键是 `path`/`hops` 的可追溯性与断边后的分辨力，不是字符串相等。
 *
 * 已知限制（禁写"暂无"）:
 *   1. **写侧编排缺失**：`GOAL_DECOMPOSITION` 边在生产 `src/**` 中**无编排写入方**
 *      （`grep -rn "GOAL_DECOMPOSITION" --include=*.ts src/` 仅命中读侧 `goal-alignment.ts`
 *      与 `briefing-generator.ts` 的注释/文档串）⇒ 本件用图存储原语 `createEdge` 表达生产写入语义。
 *      本卡判据只指**读侧**追溯，故不阻断；但"谁来分解目标"仍是缺口，已在回执报 L1。
 *   2. **层级标记靠 `props.level`**：`Goal` 28 字段无 level（`src/growth/goal-types.ts:89-144`），
 *      故用 `updateNode` 打 `level`（与 `tests/l4/goal-alignment.test.ts` 同法）。生产是否存在
 *      真实写入方打该标记，本卡**未证**；读侧对此 fail-closed（无标记 ⇒ `unknown` ⇒ 不可追溯）。
 *   3. **命名档位口径差**：文件路径按派单件 §2.4 定为 `*.test.ts`；按铁律 33「真 SQLite ⇒
 *      `*.integration.test.ts`」本件形态属集成测试 —— 路径以 L1 派单为准，**未擅自改名**（已报回执）。
 *   4. **图名口径**：本件用 `'growth'`（`goal-store` 默认写入图，与 `tests/l4/goal-alignment.test.ts`
 *      同锚）；生产消费入口 `BriefingGenerator` 以 orgId 作图名（`src/l3/briefing-generator.ts:191`）
 *      —— 两条口径在真机上是否同图，本卡**未证**。
 *   5. **降级口径差**：`src/l4/goal-alignment.ts:42-44` 明确「数据问题（缺边/缺图）⇒ `satisfied:false`
 *      ＋ `errors[]`，`degraded` **仍 false**」，只有能力/环境故障才 `degraded:true`。本件两路都断言；
 *      与卡面「缺边/缺图 ⇒ degraded 可见」的**字面**表述有口径差，已报 L1（未改判据）。
 *   6. **本件不覆盖**：跨图（多租户）隔离、`BriefingGenerator` 汇总口径、边类型 JSON 内容校验
 *      —— 分别由 `tests/l4/goal-alignment.test.ts` / `tests/l4/*` 与 `tests/ontology/**` 覆盖，不重复建设。
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@synova/logger';
import { EdgeType } from '@synova/ontology';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createGoal } from '../../src/growth/goal-store';
import { loadRolePacks } from '../../src/init/preset-loader';
import {
  listDecomposedGoals,
  traceGoalToCompany,
  type GoalAlignmentStore,
} from '../../src/l4/goal-alignment';
import type { AuditStoreLike, Goal } from '../../src/growth/goal-types';

const log = createLogger('tests/extensions/goal-alignment-multi-role');

/** 与 `src/growth/goal-store.ts` 默认图名一致（写入图 = 读取图，见文件头已知限制 4） */
const GRAPH = 'growth';
/** 分解边 label —— 直接取共享契约包（不在本件留第二份字面量） */
const EDGE: string = EdgeType.GOAL_DECOMPOSITION;

/** 两岗位：取自内容面实物的 roleId（下方 it 内断言其确实由生产 loader 读出） */
const ROLE_A = 'finance';
const ROLE_B = 'hr';

const AUDIT: AuditStoreLike = {
  async write() { return 'audit-733'; },
};

// ═══ 临时图库（真 SqliteGraphStore，mkdtemp；每例独立库，禁碰主树 data/）═══

interface Harness {
  readonly dir: string;
  readonly dbPath: string;
  readonly db: Database.Database;
  readonly store: SqliteGraphStore;
}

const opened: Harness[] = [];

function openTempGraph(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'goal-alignment-733-'));
  const dbPath = join(dir, 'graph.db');
  const db = new Database(dbPath);
  const store = new SqliteGraphStore(db);
  const h: Harness = { dir, dbPath, db, store };
  opened.push(h);
  return h;
}

afterEach(() => {
  // 逐个关闭并删临时目录；关闭失败不得静默（铁律 11：降级信号必须可见）
  for (const h of opened) {
    try {
      h.db.close();
    } catch (err: unknown) {
      log.warn({ dbPath: h.dbPath, err: err instanceof Error ? err.message : String(err) }, '临时图库关闭失败 — degraded');
    }
    rmSync(h.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  opened.length = 0;
});

// ═══ 播种（全走生产写入入口）═══

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    goalId: '',
    orgId: 'org-733',
    proposalId: 'prop-733',
    diagnosisId: 'diag-733',
    title: '#733 夹具目标',
    description: '#733 多岗位目标一致夹具',
    priority: 'P1',
    status: 'active',
    ownerDeptId: 'dept-733',
    createdAt: '2026-10-27T00:00:00.000Z',
    deadline: '2027-03-31T00:00:00.000Z',
    metrics: [
      { metricName: '目标达成', currentValue: 0, targetValue: 15, unit: '%', computeContractId: 'COMPUTE-GOAL-ACHIEVEMENT-v1' },
    ],
    successCriteria: [],
    dependsOn: [],
    conflictsWith: [],
    reDiagnosisCount: 0,
    createdBy: { role: 'manager', departmentId: 'dept-733' },
    lastModifiedAt: '2026-10-27T00:00:00.000Z',
    plannedDurationDays: 90,
    ...overrides,
  };
}

/** 走生产写入口建目标（`createGoal` → `store.createNode('GOAL', …)`），返回**实体** goalId */
function seedGoal(store: SqliteGraphStore, overrides: Partial<Goal> = {}): string {
  return createGoal(makeGoal(overrides), store, AUDIT, GRAPH);
}

/** 实体 goalId → 图节点 id（真库主键恒 `node-<uuid>`，实体 id 只落在 props 里） */
function nodeIdOf(store: SqliteGraphStore, goalId: string): string {
  const rows = store.queryNodes('GOAL', { goalId }, GRAPH);
  expect(rows, `实体 goalId=${goalId} 应命中唯一图节点`).toHaveLength(1);
  return rows[0].id;
}

/** 打层级标记（模块不猜层级：`goalLevel`/`level`/`scope` 显式驱动，见 goal-alignment.ts:24） */
function markLevel(store: SqliteGraphStore, nodeId: string, level: string): void {
  store.updateNode(nodeId, { level }, GRAPH);
}

/** 建分解边（父 → 子），返回边 id（反例断边用） */
function linkParent(store: SqliteGraphStore, parentNodeId: string, childNodeId: string, decompositionType: string): string {
  return store.createEdge(EDGE, parentNodeId, childNodeId, 1.0, {
    decomposition_type: decompositionType,
    rationale: '#733 判据夹具：岗位目标对齐到公司目标',
  }, GRAPH);
}

interface Seeded {
  readonly companyGoal: string;
  readonly deptGoal: string;
  readonly financeGoal: string;
  readonly hrGoal: string;
  readonly companyNode: string;
  readonly deptNode: string;
  readonly financeNode: string;
  readonly hrNode: string;
  /** company → dept */
  readonly companyDeptEdge: string;
  /** dept → finance（反例要断的这一条） */
  readonly financeEdge: string;
  /** company → hr */
  readonly hrEdge: string;
}

/**
 * 两岗位种子图（三目标链）:
 *   公司(company) ← 部门(dept) ← 财务岗位(finance)      ← 两跳
 *   公司(company) ← 人力岗位(hr)                        ← 一跳
 * 两岗位 → 同一公司目标 ⇒ 正常路径可对账；断 dept→finance ⇒ 仅 finance 红（反例分辨力）。
 */
function seedTwoRoleChains(store: SqliteGraphStore): Seeded {
  const companyGoal = seedGoal(store, { title: '公司目标：三年营收翻倍', ownerDeptId: 'company' });
  const deptGoal = seedGoal(store, { title: '部门目标：回款周期减半', ownerDeptId: ROLE_A });
  const financeGoal = seedGoal(store, { title: `岗位目标（${ROLE_A}）：月度回款率 ≥ 85%`, ownerDeptId: ROLE_A });
  const hrGoal = seedGoal(store, { title: `岗位目标（${ROLE_B}）：核心岗留存率 ≥ 90%`, ownerDeptId: ROLE_B });

  const companyNode = nodeIdOf(store, companyGoal);
  const deptNode = nodeIdOf(store, deptGoal);
  const financeNode = nodeIdOf(store, financeGoal);
  const hrNode = nodeIdOf(store, hrGoal);

  markLevel(store, companyNode, 'company');
  markLevel(store, deptNode, 'dept');
  markLevel(store, financeNode, 'role');
  markLevel(store, hrNode, 'role');

  const companyDeptEdge = linkParent(store, companyNode, deptNode, 'company_to_dept');
  const financeEdge = linkParent(store, deptNode, financeNode, 'dept_to_role');
  const hrEdge = linkParent(store, companyNode, hrNode, 'company_to_role');

  return {
    companyGoal, deptGoal, financeGoal, hrGoal,
    companyNode, deptNode, financeNode, hrNode,
    companyDeptEdge, financeEdge, hrEdge,
  };
}

/** `graph_triples` 直查行（独立于 store 的读侧封装 —— 防"store 自己说自己有边"） */
interface TripleRow {
  predicate: string;
  subject_id: string;
  object_id: string;
  valid_to: string | null;
}

function rawTriples(h: Harness): TripleRow[] {
  return h.db
    .prepare('SELECT predicate, subject_id, object_id, valid_to FROM graph_triples WHERE graph = ? AND predicate = ? ORDER BY subject_id, object_id')
    .all(GRAPH, EDGE) as TripleRow[];
}

// ═══ 正常路径：两岗位各自追溯成功且边链可查 ═══

describe('#733 目标一致 — 正常路径（两岗位 → 同一公司目标）', () => {
  it('两岗位 goal 经 traceGoalToCompany 真跑：各自 satisfied:true、companyGoalId 同一、边链可查', () => {
    // 岗位来源 = 生产内容装载器（不是手写常量）：内容面缺岗位 ⇒ 本步先红
    const report = loadRolePacks();
    const roleIds = report.roles.map((r) => r.roleId);
    expect(report.errors).toEqual([]);
    expect(roleIds).toContain(ROLE_A);
    expect(roleIds).toContain(ROLE_B);
    expect(roleIds.length, '需 ≥2 个岗位（卡面判据）').toBeGreaterThanOrEqual(2);

    const h = openTempGraph();
    const s = seedTwoRoleChains(h.store);

    // ① 财务岗位：两跳链 finance ← dept ← company
    const financeTrace = traceGoalToCompany(h.store, s.financeGoal, GRAPH);
    expect(financeTrace.degraded, `errors=${financeTrace.errors.join(' | ')}`).toBe(false);
    expect(financeTrace.satisfied).toBe(true);
    expect(financeTrace.companyGoalId).toBe(s.companyGoal);
    expect(financeTrace.path.map((n) => n.goalId)).toEqual([s.financeGoal, s.deptGoal, s.companyGoal]);
    expect(financeTrace.hops).toHaveLength(2);
    expect(financeTrace.hops[0]).toMatchObject({ parentId: s.deptNode, childId: s.financeNode, parentLevel: 'dept', childLevel: 'role' });
    expect(financeTrace.hops[1]).toMatchObject({ parentId: s.companyNode, childId: s.deptNode, parentLevel: 'company', childLevel: 'dept' });

    // ② 人力岗位：一跳链 hr ← company
    const hrTrace = traceGoalToCompany(h.store, s.hrGoal, GRAPH);
    expect(hrTrace.degraded, `errors=${hrTrace.errors.join(' | ')}`).toBe(false);
    expect(hrTrace.satisfied).toBe(true);
    expect(hrTrace.companyGoalId).toBe(s.companyGoal);
    expect(hrTrace.path.map((n) => n.goalId)).toEqual([s.hrGoal, s.companyGoal]);
    expect(hrTrace.hops).toHaveLength(1);
    expect(hrTrace.hops[0]).toMatchObject({ parentId: s.companyNode, childId: s.hrNode });

    // ③ 两岗位 → **同一**公司目标（宪章 §2.7①：一致性 = 可对账，不是输出相同）
    expect(financeTrace.companyGoalId).toBe(hrTrace.companyGoalId);
    expect(financeTrace.companyNodeId).toBe(hrTrace.companyNodeId);
    // 但起点不同 ⇒ 判据确实是"按岗位"判的（不是把两岗位算成一个）
    expect(financeTrace.startNodeId).toBe(s.financeNode);
    expect(hrTrace.startNodeId).toBe(s.hrNode);
    expect(financeTrace.startNodeId).not.toBe(hrTrace.startNodeId);

    // ④ 边链可查（store 读侧 + graph_triples 直查双核，原始输出落日志）
    const chain = h.store.queryEdges(EDGE, undefined, undefined, GRAPH);
    console.log('[733-EVIDENCE] store.queryEdges(GOAL_DECOMPOSITION) 原始返回:', JSON.stringify(chain));
    const triples = rawTriples(h);
    console.log('[733-EVIDENCE] graph_triples 直查原始输出:', JSON.stringify(triples));

    expect(chain).toHaveLength(3);
    expect(triples).toHaveLength(3);
    expect(triples.every((r) => r.valid_to === null)).toBe(true);
    // 断边反例要断的那条边，此刻**在**链上（父子 id 逐字一致，不是"存在任意边"）
    expect(chain.some((e) => e.id === s.financeEdge && e.from === s.deptNode && e.to === s.financeNode)).toBe(true);
    expect(chain.some((e) => e.id === s.hrEdge && e.from === s.companyNode && e.to === s.hrNode)).toBe(true);

    // ⑤ 反向：公司目标 ⇒ 分解集合 = 两岗位（+ 中层部门目标），角色集合点名两岗位
    const decomposed = listDecomposedGoals(h.store, s.companyGoal, GRAPH);
    expect(decomposed.degraded, `errors=${decomposed.errors.join(' | ')}`).toBe(false);
    expect(decomposed.companyGoalId).toBe(s.companyGoal);
    expect(decomposed.goals.map((g) => g.goalId).sort()).toEqual([s.deptGoal, s.financeGoal, s.hrGoal].sort());
    // roleGoals = 全部**非公司级**下级 ⇒ 部门目标（dept）＋ 两岗位目标（role），逐 id 点名
    expect(decomposed.roleGoals.map((g) => g.goalId).sort())
      .toEqual([s.deptGoal, s.financeGoal, s.hrGoal].sort());
    expect(decomposed.roleGoals.every((g) => g.level === 'dept' || g.level === 'role')).toBe(true);
    expect(decomposed.hops).toHaveLength(3);
  });
});

// ═══ 降级路径：能力缺席 ⇒ degraded 可见；缺边/缺图 ⇒ 显式 errors（不静默空）═══

describe('#733 目标一致 — 降级路径（可见，不是静默空数组）', () => {
  it('能力缺席: store 无 queryEdges ⇒ degraded:true + errors 点名「无 queryEdges」', () => {
    const h = openTempGraph();
    const s = seedTwoRoleChains(h.store);

    // `GoalAlignmentStore.queryEdges` 契约上**可选**（goal-alignment.ts:100-104）：
    // 只暴露 queryNodes 的**窄面**（读仍委托真 store，不伪造任何数据）⇒ 触发模块声明的降级支路。
    const narrow: GoalAlignmentStore = {
      queryNodes: (type, filters, graph) => h.store.queryNodes(type, filters, graph),
    };

    const trace = traceGoalToCompany(narrow, s.financeGoal, GRAPH);
    expect(trace.satisfied).toBe(false);
    expect(trace.degraded, '能力缺席必须显式降级（铁律 11/24/31）').toBe(true);
    expect(trace.errors.length).toBeGreaterThan(0);
    expect(trace.errors.join(' | ')).toContain('无 queryEdges');
    expect(trace.path).toHaveLength(0); // 空是**有原因的**：errors 已点名（下方断言）
    console.log('[733-EVIDENCE] 降级(无 queryEdges) trace:', JSON.stringify({
      satisfied: trace.satisfied, degraded: trace.degraded, errors: trace.errors,
    }));

    const decomposed = listDecomposedGoals(narrow, s.companyGoal, GRAPH);
    expect(decomposed.degraded).toBe(true);
    expect(decomposed.errors.join(' | ')).toContain('无 queryEdges');
    expect(decomposed.goals).toHaveLength(0);
  });

  it('缺边: 节点与层级齐备但无分解边 ⇒ satisfied:false + errors 明说「未抵达公司目标」（非静默空）', () => {
    const h = openTempGraph();
    const companyGoal = seedGoal(h.store, { title: '公司目标：无分解', ownerDeptId: 'company' });
    const roleGoal = seedGoal(h.store, { title: `岗位目标（${ROLE_A}）：孤立`, ownerDeptId: ROLE_A });
    markLevel(h.store, nodeIdOf(h.store, companyGoal), 'company');
    markLevel(h.store, nodeIdOf(h.store, roleGoal), 'role');

    const trace = traceGoalToCompany(h.store, roleGoal, GRAPH);
    expect(trace.satisfied).toBe(false);
    expect(trace.companyGoalId).toBeNull();
    expect(trace.path).toHaveLength(0);
    // 「可见」= 有具体失败点，不是空数组了事（宪章 §8.1 判据三问 ③ 证据）
    expect(trace.errors.length).toBeGreaterThan(0);
    expect(trace.errors.join(' | ')).toContain('未抵达公司目标');
    console.log('[733-EVIDENCE] 降级(缺边) trace:', JSON.stringify({
      satisfied: trace.satisfied, degraded: trace.degraded, errors: trace.errors,
    }));
  });

  it('缺图: 图名不匹配（该图零 GOAL 节点）⇒ errors 点名「目标不存在」，不静默', () => {
    const h = openTempGraph();
    const s = seedTwoRoleChains(h.store);

    const trace = traceGoalToCompany(h.store, s.financeGoal, 'org-733-no-such-graph');
    expect(trace.startNodeId).toBeNull();
    expect(trace.satisfied).toBe(false);
    expect(trace.errors.length).toBeGreaterThan(0);
    expect(trace.errors.join(' | ')).toContain('目标不存在');

    const decomposed = listDecomposedGoals(h.store, s.companyGoal, 'org-733-no-such-graph');
    expect(decomposed.company).toBeNull();
    expect(decomposed.goals).toHaveLength(0);
    expect(decomposed.errors.join(' | ')).toContain('公司目标不存在');
  });
});

// ═══ 反例：断一个岗位的 goal 边 ⇒ 该岗位红、另一岗位仍绿（岗位分辨力）═══

describe('#733 目标一致 — 反例（断一岗位的 goal 边必须红）', () => {
  it('断前两侧皆绿 → 删 finance 的分解边 → finance 红 / hr 绿 → 重建边 → finance 复绿', () => {
    const h = openTempGraph();
    const s = seedTwoRoleChains(h.store);

    // ① 断前（两侧皆绿）—— 反例的基线，必须先有绿
    const beforeFinance = traceGoalToCompany(h.store, s.financeGoal, GRAPH);
    const beforeHr = traceGoalToCompany(h.store, s.hrGoal, GRAPH);
    expect(beforeFinance.satisfied).toBe(true);
    expect(beforeHr.satisfied).toBe(true);
    console.log('[733-EVIDENCE] 断前:', JSON.stringify({
      finance: { satisfied: beforeFinance.satisfied, hops: beforeFinance.hops.length },
      hr: { satisfied: beforeHr.satisfied, hops: beforeHr.hops.length },
    }));

    // ② 断边：生产软删除原语（valid_to 置时间，查询不再可见；非物理删除）
    h.store.deleteEdge(s.financeEdge, GRAPH);

    const chainAfterDelete = h.store.queryEdges(EDGE, s.deptNode, s.financeNode, GRAPH);
    expect(chainAfterDelete).toHaveLength(0);
    const triplesAfterDelete = rawTriples(h);
    const broken = triplesAfterDelete.filter((r) => r.subject_id === s.deptNode && r.object_id === s.financeNode);
    expect(broken, '被断的边必须仍在表里但 valid_to 已置（软删，可审计）').toHaveLength(1);
    expect(broken[0].valid_to).not.toBeNull();
    console.log('[733-EVIDENCE] 断边后 graph_triples 原始返回:', JSON.stringify(triplesAfterDelete));

    // ③ 同一次运行内：finance 红、hr 仍绿 ⇒ 判据有岗位分辨力（不是"整体一起红/一起绿"）
    const afterFinance = traceGoalToCompany(h.store, s.financeGoal, GRAPH);
    const afterHr = traceGoalToCompany(h.store, s.hrGoal, GRAPH);
    console.log('[733-EVIDENCE] 断边后:', JSON.stringify({
      finance: { satisfied: afterFinance.satisfied, companyGoalId: afterFinance.companyGoalId, errors: afterFinance.errors },
      hr: { satisfied: afterHr.satisfied, companyGoalId: afterHr.companyGoalId },
    }));

    expect(afterFinance.satisfied, 'finance 的目标边被断 ⇒ 追溯必须红').toBe(false);
    expect(afterFinance.companyGoalId).toBeNull();
    expect(afterFinance.errors.join(' | ')).toContain('未抵达公司目标');
    expect(afterHr.satisfied, 'hr 的目标边未动 ⇒ 必须仍绿').toBe(true);
    expect(afterHr.companyGoalId).toBe(s.companyGoal);

    // 反向分解同样有分辨力：finance 掉了，hr 还在
    const decomposed = listDecomposedGoals(h.store, s.companyGoal, GRAPH);
    const roleGoalIds = decomposed.roleGoals.map((g) => g.goalId);
    expect(roleGoalIds).toContain(s.hrGoal);
    expect(roleGoalIds).not.toContain(s.financeGoal);

    // ④ 恢复：重建该边 ⇒ finance 复绿（证明上面那次红是"边被断"造成的，不是断言恒红）
    const restoredEdge = linkParent(h.store, s.deptNode, s.financeNode, 'dept_to_role');
    expect(restoredEdge).not.toBe(s.financeEdge); // 新边 id：软删不复活旧行（append-only 语义）
    const restored = traceGoalToCompany(h.store, s.financeGoal, GRAPH);
    expect(restored.satisfied).toBe(true);
    expect(restored.companyGoalId).toBe(s.companyGoal);
    expect(restored.hops).toHaveLength(2);
    console.log('[733-EVIDENCE] 重建边后 finance 回溯:', JSON.stringify({
      satisfied: restored.satisfied, companyGoalId: restored.companyGoalId, hops: restored.hops.length,
    }));
  });
});
