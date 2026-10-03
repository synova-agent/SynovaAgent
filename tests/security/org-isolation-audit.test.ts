/**
 * tests/security/org-isolation-audit.test.ts — D338 多租户数据隔离审计测试
 *
 * 铁律 0-2: spec → test → impl（本测试先写，隔离修复前必须失败 → red→green）
 * 铁律 33: *.test.ts 单元测试（静态断言 + 记录式 mock，无网络、无真实 DB 文件）
 * 铁律 47: 契约优先 — 每条断言即隔离契约
 * 铁律 48: 测试必须有 expect() 断言（10 用例全部真实断言，零空壳）
 * 铁律 38: 零 as any（预修复签名兼容用 as unknown as，见各注释）
 *
 * 契约（修复前后状态）:
 *   @input  — 内存 SQLite（:memory:）+ 记录式 GraphStore mock + 仓库文件系统（readFileStrict）
 *   @output — 断言:
 *     [red]  修复前: 缺租户上下文回落全局命名空间（'growth'/'overflow_snapshots'/省略 graph/空串 ''/'default' 回退）
 *             → 用例 1/4/5/6/7/8/9 失败
 *     [green]修复后: fail-closed（缺 orgId/enterpriseId → 拒绝 + degraded，绝不触碰全局命名空间）
 *             + 全部 graph 调用显式携带租户作用域
 *   @degraded — 静态文件读失败 → 抛错（不允许静默跳过）
 *
 * 10 用例（6 red + 4 绿守卫，对应 dev doc 缺陷 A/B/C/D/F）:
 *   1. feedback 租户契约 — 缺 enterpriseId 拒绝 + 成功路径 degraded:false    RED（缺陷 D）
 *   2. feedback 带 enterpriseId → 只返回该企业（形状无关守卫）              绿（回归守卫）
 *   3. getAggregatedSignals 全局聚合不变（D472 只读依赖，冻结；#976 起粒度 = per target_id） 绿（守卫）
 *   4. action-store 全部 graph 调用携带 orgId 派生图                        RED（缺陷 A/F）
 *   5. action-store 缺 orgId → fail-closed（零存储调用）                    RED（缺陷 A）
 *   6. graph-traversal 图查询非省略且非空串（含 '' bug + graphOverride）     RED（缺陷 B）
 *   7. DataPurger 全部 graph 调用携带显式租户图                             RED（缺陷 B）
 *   8. overflow-graph-bridge 图按 enterpriseId 作用域派生                   RED（缺陷 C）
 *   9. GA 路由无 'default' 回退 + ORG_REQUIRED 存在（静态）                 RED（缺陷 D 中国墙）
 *  10. 已隔离表逐表回归（静态）                                            绿（守卫）
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FeedbackCollector, FEEDBACK_DDL } from '../../src/growth/feedback-collector';
import type { FeedbackRecord, MiddleFeedbackInput } from '../../src/growth/feedback-collector';
import { ActionStore } from '../../src/growth/action-store';
import type { SentinelFinding } from '../../src/agent/proactive-push';
import { createGraphTraversal, type GraphStoreReader } from '../../src/l4/graph-traversal';
import { DataPurger } from '../../src/l4/data-purger';
import type { GraphStore } from '../../src/l4/graph-bridge';
import type { SessionStore } from '../../src/store/session-store';
import type { AgentMemoryStore } from '../../src/l4/agent-memory-store';
import { writeOverflowSnapshot, getCycleSnapshots } from '../../src/cycles/overflow-graph-bridge';
import type { OverflowSnapshot } from '../../src/cycles/overflow-compute';
import { resolveEntitiesL3 } from '../../src/l4/entity-resolver';
import { NodeType } from '@synova/ontology';
import { simulateInvestment } from '../../src/cycles/investment-advisor';
import type { CycleConfig } from '../../src/cycles/cycle-types';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** 读取文件内容（读失败 → 抛错，不允许静默降级） */
function readFileStrict(rel: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf-8');
}

/** 反馈输入夹具 */
function feedbackInput(enterpriseId: string, decision: MiddleFeedbackInput['decision'], targetId: string): MiddleFeedbackInput {
  return {
    enterpriseId, actorId: 'user-1', decision,
    targetType: 'sentinel_alert', targetId, reason: '误报',
  };
}

/** 哨兵信号夹具（与 tests/growth/action-store.test.ts 同形） */
const BASE_FINDING: SentinelFinding = {
  id: 'finding-1', sentinelId: 'cash-runway', sentinelName: '现金流哨兵',
  severity: 'critical', title: '现金流不足', detectedAt: new Date().toISOString(),
};

/** 溢出快照夹具（与 tests/cycles/overflow-graph-bridge.test.ts 同形） */
const BASE_SNAPSHOT: OverflowSnapshot = {
  cycleId: 'c1', month: '2026-07', overflowValue: 50, unit: '万',
  trend: '上升', trendDelta: 5, maturity: 'active', isIndustryBaseline: false,
  momChange: 5, momChangePercent: 10, yoyChange: 15, yoyChangePercent: 30,
  trendDirection: 'rising', consecutiveDirection: 3, degraded: false,
};

/**
 * 形状无关取值：修复前 queryFeedback 返回 FeedbackRecord[]，
 * 修复后返回 FeedbackQueryResult { entries, degraded }。
 * 本用例是「带 enterpriseId 过滤」的回归守卫，两种形态下断言均绿。
 */
function entriesOf(result: unknown): FeedbackRecord[] {
  if (Array.isArray(result)) return result as FeedbackRecord[];
  const shaped = result as { entries?: FeedbackRecord[] };
  return shaped.entries ?? [];
}

// ═══ 记录式 mock（捕获每次图操作的 graph 实参） ═══

interface GraphCall {
  op: string;
  graph: string | undefined;
}

/**
 * 预修复签名兼容说明（red 先行纪律）：
 * 构造器/函数新增的第 2/4 个参数在修复前尚不存在，直接传参会编译失败，
 * 整个测试文件将无法运行（连 4 个绿守卫也会被编译错误连坐）。
 * 因此用 `as unknown as`（铁律 38 合法替代，非 as any）扩签名——
 * 修复前运行时多余参数被忽略（行为即缺陷本身），断言照常失败；
 * 修复后直接命中真实新签名，断言转绿。
 */
const ActionStoreWithOrg = ActionStore as unknown as new (store?: unknown, orgId?: string) => ActionStore;
const createGraphTraversalWithGraph = createGraphTraversal as unknown as
  (store: GraphStoreReader, graph?: string) => {
    traverse(start: string[], edgeTypes: string[], maxDepth?: number, graphOverride?: string): unknown;
    scanOutliers(resourcePoolType: string, sigmaThreshold?: number): unknown[];
  };
const DataPurgerWithGraph = DataPurger as unknown as
  new (graphStore: GraphStore, sessionStore: SessionStore, memoryStore: AgentMemoryStore, graph?: string) => DataPurger;

/** ActionStore 记录式 mock — 捕获 4 个存储方法的 graph 实参 */
function createActionRecordingMock() {
  const calls: GraphCall[] = [];
  const nodes = new Map<string, { id: string; type: string; props: Record<string, unknown> }>();
  const store = {
    createNode(type: string, props: Record<string, unknown>, graph: string): string {
      calls.push({ op: 'createNode', graph });
      const id = (props.id as string) || 'n1';
      nodes.set(id, { id, type, props });
      return id;
    },
    getNode(id: string, graph: string): unknown | null {
      calls.push({ op: 'getNode', graph });
      return nodes.get(id) ?? null;
    },
    updateNode(id: string, props: Record<string, unknown>, graph: string): void {
      calls.push({ op: 'updateNode', graph });
      const existing = nodes.get(id);
      if (existing) nodes.set(id, { ...existing, props: { ...existing.props, ...props } });
    },
    queryNodes(type: string, _filters?: Record<string, unknown>, graph?: string): Array<{ id: string; type: string; props: Record<string, unknown> }> {
      calls.push({ op: 'queryNodes', graph });
      return [...nodes.values()].filter((n) => n.type === type);
    },
  };
  return { store, calls };
}

/** GraphTraversal 记录式 mock — 捕获 queryNodes/queryEdges/getNode 的 graph 实参 */
function createTraversalRecordingMock() {
  const calls: GraphCall[] = [];
  const store: GraphStoreReader = {
    queryNodes(_type: string, _filters?: Record<string, unknown>, graph?: string) {
      calls.push({ op: 'queryNodes', graph });
      return [];
    },
    queryEdges(_type?: string, _from?: string, _to?: string, graph?: string) {
      calls.push({ op: 'queryEdges', graph });
      // to: 'nX' 非任一次 traverse 的起点 → 两次 traverse 都会触发 getNode（起点预访问不会跳过）
      return [{ id: 'e1', type: 'DEPENDS_ON', from: 'n1', to: 'nX', weight: 1, props: {} }];
    },
    getNode(_id: string, graph: string) {
      calls.push({ op: 'getNode', graph });
      return null;
    },
  };
  return { store, calls };
}

/** DataPurger 记录式 mock — 捕获 5 个图操作方法的 graph 实参 */
function createPurgerRecordingMock() {
  const calls: GraphCall[] = [];
  const nodes: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];

  const graphStore = {
    createNode: (type: string, props: Record<string, unknown>) => {
      const id = `n_${nodes.length + 1}`;
      nodes.push({ id, type, props });
      return id;
    },
    createNodes: () => [],
    queryNodes: (type: string, _filters?: Record<string, unknown>, graph?: string) => {
      calls.push({ op: 'queryNodes', graph });
      return nodes.filter((n) => n.type === type).map((n) => ({ id: n.id, type: n.type, props: { ...n.props } }));
    },
    getNode: (id: string) => nodes.find((n) => n.id === id) || null,
    updateNode: (id: string, props: Record<string, unknown>, graph?: string) => {
      calls.push({ op: 'updateNode', graph });
      const node = nodes.find((n) => n.id === id);
      if (node) node.props = { ...node.props, ...props };
    },
    deleteNode: (id: string, graph?: string) => {
      calls.push({ op: 'deleteNode', graph });
      const idx = nodes.findIndex((n) => n.id === id);
      if (idx >= 0) nodes.splice(idx, 1);
    },
    deleteEdge: (id: string, graph?: string) => {
      calls.push({ op: 'deleteEdge', graph });
    },
    queryEdges: (_type?: string, _from?: string, _to?: string, graph?: string) => {
      calls.push({ op: 'queryEdges', graph });
      return [{ id: 'e1', type: 'EDGE', from: 'a', to: 'b', weight: 1, props: {} }];
    },
    createEdge: () => '',
    createEdges: () => [],
    traverse: () => null,
    findPaths: () => [],
    queryTriples: () => [],
    getNodeAtTime: () => null,
  } as unknown as GraphStore;

  const sessionStore = {
    listSessions: () => [],
    getMessages: () => [],
    deleteSession: () => {},
    getSession: () => null,
    listSessionsWithState: () => [],
    searchSessions: () => [],
  } as unknown as SessionStore;

  const memoryStore = {
    list: () => [],
    forget: () => false,
    recall: () => null,
    listByType: () => [],
    search: () => [],
    searchMemory: () => [],
    getStats: () => ({ totalEntries: 0, byType: {}, byOrg: {}, expiredCount: 0 }),
    purgeExpired: () => 0,
  } as unknown as AgentMemoryStore;

  return { graphStore, sessionStore, memoryStore, calls };
}

/** OverflowGraphBridge 记录式 mock — 捕获 createNode/queryNodes 的 graph 实参 */
function createOverflowRecordingMock() {
  const calls: GraphCall[] = [];
  let stored: OverflowSnapshot | null = null;
  const store = {
    createNode: (_type: string, props: Record<string, unknown>, graph?: string) => {
      calls.push({ op: 'createNode', graph });
      stored = props as unknown as OverflowSnapshot;
      return 'n1';
    },
    queryNodes: (type: string, _filters?: Record<string, unknown>, graph?: string) => {
      calls.push({ op: 'queryNodes', graph });
      return stored ? [{ id: 'n1', type, props: stored as unknown as Record<string, unknown> }] : [];
    },
    getNode: () => null, updateNode: () => {}, createNodes: () => [], createEdge: () => '',
    createEdges: () => [], queryEdges: () => [], deleteNode: () => {}, deleteEdge: () => {},
    traverse: () => null, findPaths: () => [], queryTriples: () => [], getNodeAtTime: () => null,
  } as unknown as GraphStore;
  return { store, calls };
}

// ═══ 用例 ═══

describe('D338 缺陷 D — feedback 租户契约 fail-closed', () => {
  function setup(): { collector: FeedbackCollector; db: Database.Database } {
    const collector = new FeedbackCollector();
    const db = new Database(':memory:');
    db.exec(FEEDBACK_DDL);
    collector.setDatabase(db);
    return { collector, db };
  }

  it('1. 缺 enterpriseId → 拒绝（degraded:true，零返回）；成功路径 degraded:false', () => {
    const { collector, db } = setup();
    try {
      collector.collectFeedback(feedbackInput('e1', 'reject', 'alert-1'));
      collector.collectFeedback(feedbackInput('e2', 'modify', 'goal-1'));

      // 缺 enterpriseId → fail-closed（修复前 WHERE 1=1 返回全量 2 条 → RED）
      const missing = collector.queryFeedback({}) as unknown as { entries: FeedbackRecord[]; degraded: boolean };
      expect(missing.degraded).toBe(true);
      expect(missing.entries).toEqual([]);

      // 成功路径 → degraded:false + 只含该企业
      const ok = collector.queryFeedback({ enterpriseId: 'e1' }) as unknown as { entries: FeedbackRecord[]; degraded: boolean };
      expect(ok.degraded).toBe(false);
      expect(ok.entries).toHaveLength(1);
      expect(ok.entries[0].enterpriseId).toBe('e1');
    } finally {
      db.close();
    }
  });

  it('2. 带 enterpriseId → 只返回该企业（形状无关守卫，修复前后均绿）', () => {
    const { collector, db } = setup();
    try {
      collector.collectFeedback(feedbackInput('e1', 'reject', 'alert-1'));
      collector.collectFeedback(feedbackInput('e2', 'modify', 'goal-1'));

      const e1 = entriesOf(collector.queryFeedback({ enterpriseId: 'e1' }));
      expect(e1).toHaveLength(1);
      expect(e1[0].enterpriseId).toBe('e1');
      expect(e1[0].decision).toBe('reject');

      const e2 = entriesOf(collector.queryFeedback({ enterpriseId: 'e2' }));
      expect(e2).toHaveLength(1);
      expect(e2[0].enterpriseId).toBe('e2');
    } finally {
      db.close();
    }
  });

  it('3. getAggregatedSignals 全局聚合不变（D472 只读依赖冻结；#976 起聚合粒度 = per target_id）', () => {
    const { collector, db } = setup();
    try {
      // 跨企业同 decision × 同 target_id × 3 → 全局聚合（无租户过滤，D472 冻结语义不变）count=3
      collector.collectFeedback(feedbackInput('e1', 'reject', 'F1_KZ'));
      collector.collectFeedback(feedbackInput('e1', 'reject', 'F1_KZ'));
      collector.collectFeedback(feedbackInput('e2', 'reject', 'F1_KZ'));

      const signals = collector.getAggregatedSignals(3);
      expect(signals).toHaveLength(1);
      expect(signals[0].decision).toBe('reject');
      expect(signals[0].count).toBe(3);
      expect(signals[0].targetIds).toEqual(['F1_KZ']); // #976: 聚合键 = 真 target_id

      // #976（0-2 反馈键）: 不同 target_id 不再跨键合并（旧复合键口径已废）——
      // 判别性: 每键 1 次 < 阈值 3 ⇒ 阈值 3 零聚合，阈值 1 各成一信号
      collector.collectFeedback(feedbackInput('e1', 'modify', 'goal-1'));
      collector.collectFeedback(feedbackInput('e1', 'modify', 'goal-2'));
      collector.collectFeedback(feedbackInput('e1', 'modify', 'goal-3'));
      expect(collector.getAggregatedSignals(3).filter((s) => s.decision === 'modify')).toHaveLength(0);
      expect(
        collector.getAggregatedSignals(1).filter((s) => s.decision === 'modify').map((s) => s.key).sort(),
      ).toEqual(['goal-1', 'goal-2', 'goal-3']);
    } finally {
      db.close();
    }
  });
});

describe('D338 缺陷 A/F — action-store 图作用域', () => {
  it('4. 全部 6 处图调用携带 orgId 派生图', () => {
    const mock = createActionRecordingMock();
    const store = new ActionStoreWithOrg(mock.store, 'org-a');

    const action = store.createAction(BASE_FINDING, 'user-1', 'dept-sales');
    store.updateLifecycle(action.id, 'assigned');
    store.getActionsBySignal('finding-1');
    store.getActionsByDepartment('dept-sales');
    store.getActionsByLoop('loop-1', 'exec-1');

    // 6 处: createNode + getNode + updateNode + queryNodes ×3
    expect(mock.calls).toHaveLength(6);
    expect(mock.calls.every((c) => c.graph === 'org-a:growth')).toBe(true);
  });

  it('5. 缺 orgId → fail-closed（绝不触碰存储）', () => {
    const mock = createActionRecordingMock();
    const store = new ActionStore(mock.store); // 不传 orgId

    // 内存降级仍有返回
    const action = store.createAction(BASE_FINDING);
    expect(action.id).toBeTruthy();
    expect(action.lifecycle).toBe('created');

    // 查询拒绝 + 生命周期抛错
    expect(store.getActionsBySignal('finding-1')).toEqual([]);
    expect(() => store.updateLifecycle('any-id', 'assigned')).toThrow();

    // 缺 orgId → 零存储调用（修复前 createAction 已写入 'growth' → RED）
    expect(mock.calls).toHaveLength(0);
  });
});

describe('D338 缺陷 B — graph-traversal 图作用域', () => {
  it("6. traverse/scanOutliers 图查询非省略且非空串（含空串 bug + graphOverride）", () => {
    const mock = createTraversalRecordingMock();
    const gt = createGraphTraversalWithGraph(mock.store, 'org-b');

    gt.traverse(['n1'], ['DEPENDS_ON'], 1);
    gt.scanOutliers('RESOURCE_POOL');
    gt.traverse(['n2'], ['DEPENDS_ON'], 1, 'org-override');

    // 调用序: queryEdges + getNode（traverse#1，绑定图）+ queryNodes（scanOutliers，绑定图）
    //        + queryEdges + getNode（traverse#2，覆盖图）
    expect(mock.calls).toHaveLength(5);
    expect(mock.calls.slice(0, 3).every((c) => c.graph === 'org-b')).toBe(true);
    expect(mock.calls.slice(3).every((c) => c.graph === 'org-override')).toBe(true);
    // 全局护栏: 任何图查询不得省略 graph 或传空串（修复前 undefined/'' → RED）
    expect(mock.calls.every((c) => typeof c.graph === 'string' && c.graph.length > 0)).toBe(true);
  });
});

describe('D338 缺陷 B — DataPurger 图作用域', () => {
  it('7. 全部图调用显式携带租户图（无省略、无空串）', async () => {
    const mock = createPurgerRecordingMock();
    mock.graphStore.createNode('resource/person', { name: '张三', orgId: 'tenant-x' });

    const purger = new DataPurgerWithGraph(mock.graphStore, mock.sessionStore, mock.memoryStore, 'tenant-x');
    await purger.purge('tenant-x', true); // immediate=true 走完 SafetyLock → Cascade → Verify

    // 5 个泄漏点全部被触达
    const ops = [...new Set(mock.calls.map((c) => c.op))];
    expect(ops).toEqual(expect.arrayContaining(['queryNodes', 'updateNode', 'deleteNode', 'queryEdges', 'deleteEdge']));

    // 每个图操作都必须显式携带 'tenant-x'（修复前 undefined/'' → RED）
    expect(mock.calls.length).toBeGreaterThan(0);
    expect(mock.calls.every((c) => c.graph === 'tenant-x')).toBe(true);
  });
});

describe('D338 缺陷 C — overflow-graph-bridge 图作用域', () => {
  it('8. 图按 enterpriseId 作用域派生（写 + 读）', () => {
    const mock = createOverflowRecordingMock();

    writeOverflowSnapshot('e1', 'c1', BASE_SNAPSHOT, mock.store);
    const snapshots = getCycleSnapshots('e1', 'c1', mock.store);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].cycleId).toBe('c1');

    const createCalls = mock.calls.filter((c) => c.op === 'createNode');
    const queryCalls = mock.calls.filter((c) => c.op === 'queryNodes');
    expect(createCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(1);
    // 修复前 'overflow_snapshots'（全局图）→ RED
    expect(mock.calls.every((c) => c.graph === 'e1:cycles')).toBe(true);
  });
});

describe('D338 缺陷 D 中国墙 — GA 路由 fail-closed（静态）', () => {
  it('9. GA 标注/纠错路由无 default 回退 + ORG_REQUIRED 门禁存在', () => {
    const gaAnnotations = readFileStrict('src/routes/ga-annotations.ts');
    const gaCorrections = readFileStrict('src/routes/ga-corrections.ts');

    // 修复前 ga-annotations 4 处 + ga-corrections 3 处 `auth.orgId || 'default'` → RED
    expect(gaAnnotations).not.toContain("auth.orgId || 'default'");
    expect(gaCorrections).not.toContain("auth.orgId || 'default'");
    // fail-closed 门禁（修复前不存在 → RED）
    expect(gaAnnotations).toContain("'ORG_REQUIRED'");
    expect(gaCorrections).toContain("'ORG_REQUIRED'");
  });
});

describe('D338 已隔离表逐表回归（静态守卫）', () => {
  it('10. session/audit/graph/feedback 存储层已含租户列', () => {
    expect(readFileStrict('src/store/session-store.ts')).toContain('org_id');
    expect(readFileStrict('src/l4/audit-store.ts')).toContain('org_id');
    expect(readFileStrict('src/adapters/sqlite-graph-store.ts')).toContain('graph = ?');
    expect(readFileStrict('src/growth/feedback-collector.ts')).toContain('enterprise_id');
  });
});

describe('D338 缺口 E — entity-resolver 图转发（check-architecture 5 告警清零）', () => {
  it('11. resolveEntitiesL3 将收到的 graph 转发给每次图查询', async () => {
    const calls: Array<{ op: string; graph: unknown }> = [];
    const store = {
      queryNodes(_type: string, _filters?: Record<string, unknown>, graph?: string) {
        calls.push({ op: 'queryNodes', graph });
        if (_type === NodeType.RESOURCE_PERSON) {
          return [
            { id: 'p1', type: _type, props: { name: 'Alice', email: 'alice@example.com' } },
            { id: 'p2', type: _type, props: { name: 'Alice', email: 'alice@example.com' } },
          ];
        }
        return [];
      },
      queryEdges(_type?: string, _from?: string, _to?: string, graph?: string) {
        calls.push({ op: 'queryEdges', graph });
        return [];
      },
    };
    await resolveEntitiesL3(store, 'tenant-x');
    // 图查询确实发生（22 种节点类型 × queryNodes + 同名对触发 queryEdges）
    expect(calls.some(c => c.op === 'queryNodes')).toBe(true);
    expect(calls.some(c => c.op === 'queryEdges')).toBe(true);
    // 每次图查询都必须转发收到的租户图 —— 任何 undefined/'' 都是回落全局命名空间
    for (const c of calls) expect(c.graph).toBe('tenant-x');
  });
});

describe('D338 缺陷 C 消费侧 — investment-advisor 租户透传', () => {
  // 修复前签名无 enterpriseId（6 参）→ cast 扩签名（铁律 38 合法替代，非 as any）；
  // JS 忽略多余实参 → 内部硬编码 'default' → 记录式 mock 捕获 'default:cycles' → RED
  const simulateInvestmentWithTenant = simulateInvestment as unknown as (
    enterpriseId: string,
    cycleId: string,
    amount: number,
    direction: string,
    cycle: unknown,
    store: unknown,
    allCycles: unknown[],
  ) => { cycleId: string; investmentAmount: number; commitments: unknown[]; constraints: unknown[] };

  const TEST_CYCLE: CycleConfig = {
    cycleId: 'test-cycle', name: '测试循环', description: '', version: '1.0.0',
    applicableIndustries: [],
    nodes: [{ id: 'n1', label: '节点1', type: 'stock', initialValue: 100 }],
    edges: [{ from: 'n1', to: 'n1', polarity: '+', delay: 1, weight: 0.5 }],
    overflowFormula: { condition: 'n1 > 100', targetNode: 'n1', formula: 'n1*0.5', minDataMaturity: 'medium' },
    dataMaturity: 'medium', mapping: [], crossCyclePropagation: [],
  };

  it('12. simulateInvestment 将 enterpriseId 透传给快照查询（不再硬编码 default）', () => {
    const graphCalls: Array<{ op: string; graph: unknown }> = [];
    const store = {
      queryNodes(_type: string, _filters?: Record<string, unknown>, graph?: string) {
        graphCalls.push({ op: 'queryNodes', graph });
        return [];
      },
    };
    const result = simulateInvestmentWithTenant('e1', 'test-cycle', 100, '扩大产能', TEST_CYCLE, store, [TEST_CYCLE]);
    expect(result.cycleId).toBe('test-cycle');
    // 快照读取确实发生（latest + 列表 × 本循环 + allCycles 排序）
    expect(graphCalls.length).toBeGreaterThan(0);
    // 每次快照查询都必须落在 `${enterpriseId}:cycles` —— 'default:cycles' 即跨租户命名空间错误
    for (const c of graphCalls) expect(c.graph).toBe('e1:cycles');
  });
});
