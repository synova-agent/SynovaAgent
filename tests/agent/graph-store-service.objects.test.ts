/**
 * tests/agent/graph-store-service.objects.test.ts — #1431（阶段 2 · T2）②↔④a 对象对查判据
 *
 * 判据身份（DEV DOC v2 §8，Issue #1431 评论 14176）：
 *   §8-1 同 org 命中：`createNode` 造真节点（取返回的 `node-<uuid>`）⇒ 返回该节点，type/props 与库一致
 *   §8-2 跨 org 为空：同一 nodeId 在另一 org 查 ⇒ `null`（含"默认分区不泄漏"——禁默认 `default` 的判别力）
 *   §8-3 缺参零查询：空串／非字符串 ⇒ VALIDATION，`getNode`/`getNodeStrict` spy 调用 0，且未触达 getDatabase
 *   §8-4 DB 异常抛错：读路径异常 ⇒ 抛 `GraphLookupError(GRAPH_LOOKUP_FAILED)`，**不是 null**
 *   §8-5 既有语义未变：同一损坏行 `getNode` 仍返回 null（吞错语义原样保留）
 *   反例「调用方自报 graph 被忽略」：第 3 个实参不得改变查询分区（经 Reflect.apply 传入，绕开函数签名）
 *
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`）；表由 `SqliteGraphStore` 构造时的 `reconcileSchema` 建（迁移 007）。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getObjectById } from '../../src/agent/graph-store-service';
import { SqliteGraphStore, GraphLookupError } from '../../src/adapters/sqlite-graph-store';
import { getDatabase } from '../../src/init/engine-context';

vi.mock('../../src/init/engine-context', () => ({
  getDatabase: vi.fn(),
}));

const mockedGetDatabase = vi.mocked(getDatabase);

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  mockedGetDatabase.mockImplementation(() => db);
});

afterAll(() => {
  try {
    db.close();
  } catch {
    /* 已关闭不掩盖断言 */
  }
});

/** 捕获并窄化抛出的 GraphLookupError（供后续 code/phase/retryable 断言） */
function catchLookupError(fn: () => unknown): GraphLookupError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(GraphLookupError);
  return caught as GraphLookupError;
}

describe('getObjectById — 按图节点 id 取回 ② 节点（#1431 T2）', () => {
  it('[正常] 同 org 命中：真节点 id 取回 id/type/props，与库一致', () => {
    const store = new SqliteGraphStore(db);
    const id = store.createNode('Company', { name: '甲公司', revenue: 1200 }, 'org-alpha');
    expect(id).toMatch(/^node-/);

    const node = getObjectById('org-alpha', id);
    expect(node).not.toBeNull();
    if (!node) throw new Error('同 org 真节点应命中，却返回 null');
    expect(node.id).toBe(id);
    expect(node.type).toBe('Company');
    expect(node.props).toEqual({ name: '甲公司', revenue: 1200 });
  });

  it('[跨 org] 同一 nodeId 从另一 org 查 ⇒ null（精确 null，不是空对象）', () => {
    const store = new SqliteGraphStore(db);
    const id = store.createNode('Company', { name: '乙公司' }, 'org-alpha');

    expect(getObjectById('org-beta', id)).toBeNull();
  });

  it('[跨 org/默认分区] 默认分区里的节点不得被任何 org 取回 ⇒ null（禁默认 default 的判别力）', () => {
    const store = new SqliteGraphStore(db);
    // 不传 graph ⇒ 落默认分区 'default'（历史/未归属数据形态）
    const id = store.createNode('Company', { name: '旧数据' });

    expect(getObjectById('org-alpha', id)).toBeNull();
  });

  it('[缺参零查询] 空串／非字符串 ⇒ VALIDATION，store 零调用且未触达数据库', () => {
    mockedGetDatabase.mockClear();
    const getNodeSpy = vi.spyOn(SqliteGraphStore.prototype, 'getNode');
    const strictSpy = vi.spyOn(SqliteGraphStore.prototype, 'getNodeStrict');
    try {
      const cases: Array<[unknown, unknown]> = [
        ['', 'node-00000000-0000-4000-8000-000000000000'],
        ['org-alpha', ''],
        [null, 'node-x'],
        ['org-alpha', undefined],
        [123, 'node-x'],
        ['org-alpha', { id: 'node-x' }],
      ];

      for (const [orgId, nodeId] of cases) {
        const err = catchLookupError(() =>
          Reflect.apply(getObjectById, undefined, [orgId, nodeId]),
        );
        expect(err.code).toBe('VALIDATION');
        expect(err.phase).toBe('validate');
        expect(err.retryable).toBe(false);
      }

      expect(getNodeSpy).toHaveBeenCalledTimes(0);
      expect(strictSpy).toHaveBeenCalledTimes(0);
      expect(mockedGetDatabase).toHaveBeenCalledTimes(0);
    } finally {
      getNodeSpy.mockRestore();
      strictSpy.mockRestore();
    }
  });

  it('[DB 异常] 读路径异常 ⇒ 抛 GRAPH_LOOKUP_FAILED（不是 null）', () => {
    const id = 'node-corrupt-props-0001';
    db.prepare(
      'INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, ?, ?, ?, ?)',
    ).run(id, 'org-alpha', 'Corrupted', 'corrupted', '{not-json');

    const err = catchLookupError(() => getObjectById('org-alpha', id));
    expect(err.code).toBe('GRAPH_LOOKUP_FAILED');
    expect(err.phase).toBe('graph-lookup');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain(id);
  });

  it('[回归] 同一损坏行 getNode 仍吞错返 null（既有语义零改动）', () => {
    const store = new SqliteGraphStore(db);

    expect(store.getNode('node-corrupt-props-0001', 'org-alpha')).toBeNull();
  });

  it('[契约] getNodeStrict 未找到 ⇒ null（未找到与出错可区分）', () => {
    const store = new SqliteGraphStore(db);

    expect(store.getNodeStrict('node-not-exists', 'org-alpha')).toBeNull();
  });

  it('[反例] 调用方自报 graph 被忽略：第 3 个实参不得改变查询分区', () => {
    const store = new SqliteGraphStore(db);
    const id = store.createNode('Company', { name: '丙公司' }, 'org-alpha');

    const node = Reflect.apply(getObjectById, undefined, ['org-alpha', id, 'default']);
    expect(node).not.toBeNull();
    expect(node.id).toBe(id);
  });
});
