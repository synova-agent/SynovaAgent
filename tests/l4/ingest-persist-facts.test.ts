/**
 * tests/l4/ingest-persist-facts.test.ts — #1486 裁定 b：通用 `persistFacts()` 入口（不接受脚本直写 scan_*）。
 *
 * 判据（Issue #1486「四条裁定 b」＋验收 b）：
 *   [正常]   `persistFacts` 落 ② 对象 + 1 跳关系 ⇒ `synova_context_get` **能读到**（count>0，条目值来自刚写入的物理行）
 *   [幂等]   重复调用同批 ⇒ `replayed=true`、objectId 相同、`graph_nodes`/`graph_triples` 不增
 *   [失败]   关系端点不在本批 ⇒ `SCHEMA_MAPPING_FAILED`，**整批回滚**（对象也不落库）
 *   [失败]   入参违约（graph 空 / type 空 / businessKey 空 / props 非对象 / 同批重复业务键）⇒ `VALIDATION_ERROR`，零写入
 *   [反例]   **绕过 persistFacts 直写 `scan_ontology_links`** ⇒ 006 触发器 ABORT（一致性断言红）；
 *            且直写后库内不会出现"链接指向假对象"的脏行
 *
 * 期望值来源：期望的 type/businessKey/period/defVersion 由本文件构造的输入给出；不拿读表结果反推期望。
 * 库口径：`:memory:`（vitest env `SYNOVA_DB_PATH=':memory:'`；beforeAll fail-fast），不碰 `data/synova.db`。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getDatabase, initEngineContext } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { EnterpriseScanStore } from '../../src/l4/enterprise-scan-store';
import type { PersistFactsInput, PersistedFacts } from '../../src/l4/enterprise-scan-store';
import { EnterpriseScanError } from '../../src/connectors/enterprise-scan/errors';
import { buildContextSnapshot } from '../../src/runtime/dsh/domain-context';
import { handleDomainToolCall } from '../../src/runtime/dsh/tools';
import type { ContextSnapshot, ToolCallContext } from '../../src/runtime/dsh/tools';

// ═══ 测试构造的输入（期望值的唯一来源）═══
const GRAPH = 'org-1486-b';
const PERIOD = '2026-10';
const DEF_VERSION = 'delivery-v1';
const TEAM_KEY = 'team-1486-b';
const BATCH_KEY = 'batch-1486-b-1';
const REL_TYPE = 'edge/team_executes_activity';
const REL_KEY = 'rel-1486-b-1';
const CTX: ToolCallContext = { enterpriseId: GRAPH, userId: 'user-1486-b', scope: 'admin', runId: 'run_1486_b' };

/** 一批合法事实（对象带资料期间，关系一端 team 一端 batch） */
function baseFacts(): PersistFactsInput {
  return {
    graph: GRAPH,
    objects: [
      {
        type: 'resource/delivery_team',
        businessKey: TEAM_KEY,
        props: { name: '交付团队 B', period: PERIOD, defVersion: DEF_VERSION },
      },
      {
        type: 'activity/delivery_batch',
        // SOG schema 必填（`activity/delivery_batch.teamBusinessKey`）：persistFacts 复用既有 schema 硬校验，
        // 调用方必须给出本体定义要求的属性 —— 这正是"不经由 scan_* 直写"要保留的不变量。
        businessKey: BATCH_KEY,
        props: { name: '批次 B-1', period: PERIOD, defVersion: DEF_VERSION, teamBusinessKey: TEAM_KEY },
      },
    ],
    relations: [
      { type: REL_TYPE, businessKey: REL_KEY, fromBusinessKey: TEAM_KEY, toBusinessKey: BATCH_KEY },
    ],
  };
}

let scanStore: EnterpriseScanStore;

beforeAll(() => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`ingest-persist-facts.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const db = getDatabase();
  scanStore = new EnterpriseScanStore(db, new SqliteGraphStore(db));
});

function nodeCount(): number {
  return (getDatabase().prepare('SELECT COUNT(*) AS n FROM graph_nodes WHERE graph = ?').get(GRAPH) as { n: number }).n;
}

function edgeCount(): number {
  return (getDatabase().prepare('SELECT COUNT(*) AS n FROM graph_triples WHERE graph = ?').get(GRAPH) as { n: number }).n;
}

function linkCount(): number {
  return (getDatabase().prepare('SELECT COUNT(*) AS n FROM scan_ontology_links WHERE graph = ?').get(GRAPH) as { n: number }).n;
}

function catchScanError(fn: () => unknown): EnterpriseScanError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(EnterpriseScanError);
  return caught as EnterpriseScanError;
}

describe('#1486 b · persistFacts 通用落库入口 → synova_context_get 可读', () => {
  it('[正常] 落对象+关系 ⇒ synova_context_get count>0，条目引用刚写入的物理行', () => {
    const persisted: PersistedFacts = scanStore.persistFacts(baseFacts());

    const nodeFacts = persisted.facts.filter(fact => fact.kind === 'node');
    const edgeFacts = persisted.facts.filter(fact => fact.kind === 'edge');
    expect(nodeFacts).toHaveLength(2);
    expect(edgeFacts).toHaveLength(1);
    expect(nodeFacts.map(fact => fact.type).sort()).toEqual(['activity/delivery_batch', 'resource/delivery_team']);
    expect(nodeFacts.every(fact => fact.replayed === false)).toBe(true);
    expect(edgeFacts[0].objectId).toMatch(/^edge-[0-9a-f-]{36}$/);

    const snapshot: ContextSnapshot = buildContextSnapshot(CTX, TEAM_KEY);
    expect(snapshot.synthetic).toBe(false);
    expect(snapshot.count).toBe(1);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].$id).toBe(nodeFacts.find(fact => fact.businessKey === BATCH_KEY)?.objectId);
    expect(snapshot.items[0].period).toBe(PERIOD);
    expect(snapshot.items[0].defVersion).toBe(DEF_VERSION);
    expect(snapshot.items[0].relation?.type).toBe(REL_TYPE);
    expect(snapshot.items[0].relation?.direction).toBe('out');

    // 真实工具入口（不是只测内部函数）：同 ctx 读同一根 ⇒ 同一快照
    const viaTool = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: TEAM_KEY }, CTX)) as ContextSnapshot;
    expect(viaTool).toEqual(snapshot);
  });

  it('[幂等] 重复落同批 ⇒ replayed=true、id 复用、图与链接不增', () => {
    const first = scanStore.persistFacts(baseFacts());
    const nodes = nodeCount();
    const edges = edgeCount();
    const links = linkCount();

    const second = scanStore.persistFacts(baseFacts());
    expect(second.facts.every(fact => fact.replayed)).toBe(true);
    expect(second.facts.map(fact => fact.objectId)).toEqual(first.facts.map(fact => fact.objectId));
    expect(nodeCount()).toBe(nodes);
    expect(edgeCount()).toBe(edges);
    expect(linkCount()).toBe(links);
  });

  it('[失败] 关系端点不在本批 ⇒ SCHEMA_MAPPING_FAILED + 整批回滚（对象也不落库）', () => {
    const before = { nodes: nodeCount(), edges: edgeCount(), links: linkCount() };
    const input = baseFacts();
    const broken: PersistFactsInput = {
      graph: GRAPH,
      objects: input.objects,
      relations: [{ type: REL_TYPE, businessKey: 'rel-broken', fromBusinessKey: TEAM_KEY, toBusinessKey: 'batch-does-not-exist' }],
    };

    const err = catchScanError(() => scanStore.persistFacts(broken));

    expect(err.code).toBe('SCHEMA_MAPPING_FAILED');
    expect(err.phase).toBe('mapping');
    expect(err.message).toContain('toBusinessKey=batch-does-not-exist');
    expect(nodeCount()).toBe(before.nodes);
    expect(edgeCount()).toBe(before.edges);
    expect(linkCount()).toBe(before.links);
  });

  it('[失败] 入参违约 ⇒ VALIDATION_ERROR 且零写入', () => {
    const before = { nodes: nodeCount(), edges: edgeCount(), links: linkCount() };
    const facts = baseFacts();
    // props 必须是普通对象：数组形态用 Reflect.apply 走运行期真实形态（不引入 as-any 家族，铁律 38）
    const invalidCalls: Array<() => unknown> = [
      () => scanStore.persistFacts({ graph: '', objects: facts.objects }),
      () => scanStore.persistFacts({ graph: GRAPH, objects: [{ type: '', businessKey: 'k', props: {} }] }),
      () => scanStore.persistFacts({ graph: GRAPH, objects: [{ type: 'Team', businessKey: '', props: {} }] }),
      () => Reflect.apply(scanStore.persistFacts, scanStore, [
        { graph: GRAPH, objects: [{ type: 'Team', businessKey: 'k', props: [] }] },
      ]),
      // 同批重复业务键（关系端点会无法无歧义解析 ⇒ 必须显式拒绝）
      () => scanStore.persistFacts({
        graph: GRAPH,
        objects: [
          { type: 'Team', businessKey: 'dup-key', props: {} },
          { type: 'Department', businessKey: 'dup-key', props: {} },
        ],
      }),
    ];

    for (const call of invalidCalls) {
      const err = catchScanError(call);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.phase).toBe('request');
    }
    expect(nodeCount()).toBe(before.nodes);
    expect(edgeCount()).toBe(before.edges);
    expect(linkCount()).toBe(before.links);
  });

  it('[反例] 绕过 persistFacts 直写 scan_ontology_links ⇒ 006 触发器 ABORT（一致性断言红）', () => {
    const db = getDatabase();
    const fakeObjectId = 'node-00000000-0000-4000-8000-000000000000';

    let caught: unknown;
    try {
      db.prepare(
        'INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES (?, ?, ?, ?, ?)',
      ).run(GRAPH, 'node', 'resource/delivery_team', 'direct-write-bypass', fakeObjectId);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : '').toContain('scan ontology node graph/type mismatch');
    // 直写没留脏行（触发器是 BEFORE INSERT ⇒ 拒绝，不落库）
    expect(db.prepare('SELECT COUNT(*) AS n FROM scan_ontology_links WHERE business_key = ?')
      .get('direct-write-bypass')).toEqual({ n: 0 });
  });
});
