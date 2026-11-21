/**
 * tests/agent/stage2-s1-objects.test.ts — #1431（阶段 2 · S1）② 对象与关系真实落库判据
 *
 * 判据身份（DEV DOC v1 §5，Issue #1431 评论 14226）：
 *   [正常]   两节点 + 一条边：id 形态 / getObjectById 逐字段相等 / 边原始行两端类型 = 输入 type（非 'unknown'）
 *   [跨 org] 同一 nodeId 从另一 org 查 ⇒ null；跨 org 建边 ⇒ EDGE_ENDPOINT_MISSING
 *   [缺参]   缺 orgId/type/props/period/defVersion ⇒ VALIDATION，零写入（行数 +0、createNode 0 调用、getDatabase 0 调用）
 *   [边缺参] 边指向不存在节点 ⇒ EDGE_ENDPOINT_MISSING，零边写入
 *   [DB 异常] 库不可用 ⇒ 抛错（不吞、不返回假 id）
 *   [反例]   调用方自报 graph（第 4 实参）不改变分区 —— 物理行 graph 列 = orgId
 *
 * 期望值来源（独立于被测对象）：期望的 type/props 由测试构造的输入给出；边两端类型由**输入时指定的 type** 给出；
 *   不调用 getObjectById 的返回值去构造期望值（id 取写入返回，与 #1431 S5 卡同口径）。
 * 防止假绿三问：空对象？（逐字段 + 边行断言）/ 跳过？（无 skip/only，每用例含 expect）/ 同源？（期望来自输入）。
 * 库口径：`:memory:`（禁 `data/synova.db`）；表由 `SqliteGraphStore` 构造时的 `reconcileSchema` 建（迁移 007）。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createObject,
  createRelation,
  getObjectById,
  GraphWriteError,
} from '../../src/agent/graph-store-service';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { getDatabase } from '../../src/init/engine-context';

vi.mock('../../src/init/engine-context', () => ({
  getDatabase: vi.fn(),
}));

const mockedGetDatabase = vi.mocked(getDatabase);

// ═══ 测试构造的输入（期望值的唯一来源）═══
const ORG = 'org-s1-zhaopin';
const OTHER_ORG = 'org-s1-other';
const TYPE_TEAM = 'Team';
const TYPE_DEPT = 'Department';
const PERIOD = '2026-11';
const DEF_VERSION = 'v1';
const PROPS_TEAM: Record<string, unknown> = {
  name: '招聘团队',
  period: PERIOD,
  defVersion: DEF_VERSION,
  headcount: 12,
};
const PROPS_DEPT: Record<string, unknown> = {
  name: '研发中心',
  period: PERIOD,
  defVersion: DEF_VERSION,
};
const REL_TYPE = 'belongs_to';
const REL_PROPS: Record<string, unknown> = { since: '2026-11-01', note: '招聘团队归属研发中心' };

let db: Database.Database;
let store: SqliteGraphStore;

beforeEach(() => {
  db = new Database(':memory:');
  mockedGetDatabase.mockImplementation(() => db);
  // 构造即建 schema（graph_nodes / graph_triples / 迁移 007）；同时作为物理读取通道
  store = new SqliteGraphStore(db);
});

afterEach(() => {
  mockedGetDatabase.mockReset();
  try {
    db.close();
  } catch {
    /* DB 异常用例已关闭；不掩盖断言 */
  }
});

/** 物理行数（零写入判据的物理证据） */
function countNodes(): number {
  return db.prepare('SELECT id FROM graph_nodes').all().length;
}
function countEdges(): number {
  return db.prepare('SELECT id FROM graph_triples').all().length;
}

/** 捕获并窄化抛出的 GraphWriteError（供后续 code/phase/field 断言） */
function catchWriteError(fn: () => unknown): GraphWriteError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(GraphWriteError);
  return caught as GraphWriteError;
}

describe('createObject / createRelation — ② 对象与关系真实落库（#1431 S1）', () => {
  it('[正常] 两节点 + 一条边：getObjectById 逐字段相等，边两端类型非 unknown', () => {
    const idA = createObject(ORG, TYPE_TEAM, PROPS_TEAM);
    const idB = createObject(ORG, TYPE_DEPT, PROPS_DEPT);
    const edgeId = createRelation(ORG, REL_TYPE, idA, idB, REL_PROPS);

    // id 形态（node-<uuid> / edge-<uuid>）+ 两节点互异
    expect(idA).toMatch(/^node-[0-9a-f-]{36}$/);
    expect(idB).toMatch(/^node-[0-9a-f-]{36}$/);
    expect(idA).not.toBe(idB);
    expect(edgeId).toMatch(/^edge-[0-9a-f-]{36}$/);

    // 按 id 读回 ⇒ 与测试构造的输入逐字段相等（期望值来自输入，不来自读取结果）
    const nodeA = getObjectById(ORG, idA);
    expect(nodeA).not.toBeNull();
    expect(nodeA).toEqual({ id: idA, type: TYPE_TEAM, props: PROPS_TEAM });

    const nodeB = getObjectById(ORG, idB);
    expect(nodeB).toEqual({ id: idB, type: TYPE_DEPT, props: PROPS_DEPT });

    // 边的原始行（queryTriples 返回真列）：两端类型必须是输入指定的 type，不是 'unknown'
    const rows = store.queryTriples({ subject_id: idA, object_id: idB }, ORG);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.predicate).toBe(REL_TYPE);
    expect(row.subject_type).toBe(TYPE_TEAM);
    expect(row.object_type).toBe(TYPE_DEPT);
    expect(row.subject_type).not.toBe('unknown');
    expect(row.object_type).not.toBe('unknown');
    expect(row.subject_id).toBe(idA);
    expect(row.object_id).toBe(idB);
    expect(JSON.parse(String(row.props))).toEqual(REL_PROPS);

    // 物理分区：graph 列 = orgId（不是默认 'default'）
    expect(db.prepare('SELECT graph FROM graph_nodes WHERE id = ?').get(idA)).toEqual({ graph: ORG });
    expect(db.prepare('SELECT graph FROM graph_nodes WHERE id = ?').get(idB)).toEqual({ graph: ORG });
    expect(db.prepare('SELECT graph FROM graph_triples WHERE id = ?').get(edgeId)).toEqual({ graph: ORG });
  });

  it('[跨 org] 同一 nodeId 从另一 org 查 ⇒ null（跨企业不可见）', () => {
    const id = createObject(ORG, TYPE_TEAM, PROPS_TEAM);

    expect(getObjectById(OTHER_ORG, id)).toBeNull();
    expect(getObjectById(ORG, id)).not.toBeNull();
  });

  it('[跨 org/边] 端点属于别的 org ⇒ EDGE_ENDPOINT_MISSING 且零边写入', () => {
    const idA = createObject(ORG, TYPE_TEAM, PROPS_TEAM);
    const idB = createObject(ORG, TYPE_DEPT, PROPS_DEPT);
    const beforeEdges = countEdges();

    const err = catchWriteError(() => createRelation(OTHER_ORG, REL_TYPE, idA, idB, REL_PROPS));

    expect(err.code).toBe('EDGE_ENDPOINT_MISSING');
    expect(err.phase).toBe('validate');
    expect(err.retryable).toBe(false);
    expect(countEdges()).toBe(beforeEdges);
  });

  it('[缺参零写入] 缺 orgId/type/props/period/defVersion ⇒ VALIDATION，零写入且未触达数据库', () => {
    // 基线：先落一个合法对象，证明"零写入"是对比出来的
    createObject(ORG, TYPE_TEAM, PROPS_TEAM);
    const beforeNodes = countNodes();
    mockedGetDatabase.mockClear();
    const createNodeSpy = vi.spyOn(SqliteGraphStore.prototype, 'createNode');
    try {
      const invalidCalls: Array<() => unknown> = [
        () => createObject('', TYPE_TEAM, PROPS_TEAM),
        () => createObject(ORG, '', PROPS_TEAM),
        () => Reflect.apply(createObject, undefined, [ORG, TYPE_TEAM, undefined]),
        () => Reflect.apply(createObject, undefined, [ORG, TYPE_TEAM, null]),
        () => Reflect.apply(createObject, undefined, [ORG, TYPE_TEAM, []]),
        () => createObject(ORG, TYPE_TEAM, { name: '缺 period', defVersion: DEF_VERSION }),
        () => createObject(ORG, TYPE_TEAM, { name: '非法 period', period: '2026-13', defVersion: DEF_VERSION }),
        () => createObject(ORG, TYPE_TEAM, { name: '非串 period', period: 202611, defVersion: DEF_VERSION }),
        () => createObject(ORG, TYPE_TEAM, { name: '缺 defVersion', period: PERIOD }),
        () => createObject(ORG, TYPE_TEAM, { name: '空 defVersion', period: PERIOD, defVersion: '' }),
      ];

      for (const call of invalidCalls) {
        const err = catchWriteError(call);
        expect(err.code).toBe('VALIDATION');
        expect(err.phase).toBe('validate');
        expect(err.retryable).toBe(false);
      }

      expect(createNodeSpy).toHaveBeenCalledTimes(0);
      expect(mockedGetDatabase).toHaveBeenCalledTimes(0);
      expect(countNodes()).toBe(beforeNodes);
    } finally {
      createNodeSpy.mockRestore();
    }
  });

  it('[边/缺参] 端点不存在或入参缺失 ⇒ 抛错，零边/零节点写入', () => {
    const idA = createObject(ORG, TYPE_TEAM, PROPS_TEAM);
    const beforeNodes = countNodes();
    const beforeEdges = countEdges();
    const createEdgeSpy = vi.spyOn(SqliteGraphStore.prototype, 'createEdge');
    try {
      // 端点不存在（toId 指向未创建节点）⇒ 必须在写入前抛错，不得产出 'unknown' 类型的边
      const missingEndpoint = catchWriteError(() =>
        createRelation(ORG, REL_TYPE, idA, 'node-00000000-0000-4000-8000-000000000000', REL_PROPS),
      );
      expect(missingEndpoint.code).toBe('EDGE_ENDPOINT_MISSING');
      expect(missingEndpoint.field).toBe('toId');

      const invalidCalls: Array<() => unknown> = [
        () => createRelation('', REL_TYPE, idA, idA),
        () => createRelation(ORG, '', idA, idA),
        () => createRelation(ORG, REL_TYPE, '', idA),
        () => createRelation(ORG, REL_TYPE, idA, ''),
        () => Reflect.apply(createRelation, undefined, [ORG, REL_TYPE, idA, idA, []]),
      ];
      for (const call of invalidCalls) {
        const err = catchWriteError(call);
        expect(err.code).toBe('VALIDATION');
        expect(err.phase).toBe('validate');
      }

      expect(createEdgeSpy).toHaveBeenCalledTimes(0);
      expect(countEdges()).toBe(beforeEdges);
      expect(countNodes()).toBe(beforeNodes);
    } finally {
      createEdgeSpy.mockRestore();
    }
  });

  it('[DB 异常] 库不可用 ⇒ 抛错，不返回假 id（不吞、不降级）', () => {
    db.close();

    expect(() => createObject(ORG, TYPE_TEAM, PROPS_TEAM)).toThrow();
  });

  it('[反例] 调用方自报 graph 被忽略：第 4 实参不改变分区', () => {
    const id = String(Reflect.apply(createObject, undefined, [ORG, TYPE_TEAM, PROPS_TEAM, 'default']));

    expect(db.prepare('SELECT graph FROM graph_nodes WHERE id = ?').get(id)).toEqual({ graph: ORG });
    expect(getObjectById('default', id)).toBeNull();
    expect(getObjectById(ORG, id)).not.toBeNull();
  });
});
