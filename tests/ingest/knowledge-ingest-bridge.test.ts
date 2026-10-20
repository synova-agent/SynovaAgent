/**
 * tests/ingest/knowledge-ingest-bridge.test.ts — #667 悬挂边回归
 *
 * 判据（裁 275）:
 *   ① 接住 `createNode('Document')` 返回的 node id，MENTIONS 边 target 用它（不再用 `doc_${fileName}`）
 *   ② 边写入前断言 target 存在；不存在 ⇒ 结构化失败（errors[] + log.error），不静默
 *   ③ 反例：故意传不存在的 target ⇒ 必红
 *
 * 契约:
 *   @input  临时 SQLite（:memory: 仅测试基建）＋ 文本 fixture（引号人名 / 部门）
 *   @output 真 Document 节点；MENTIONS 边 `to` = 该 Document id；`graph_triples.object_type='Document'`
 *   @degraded 无——本件是回归测试；环境异常直接 throw（不 skip）
 *   @not-here 不改 src/adapters/sqlite-graph-store.ts（本卡写集只含 bridge + tests/ingest）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { ingestDocumentText, createMentionsEdge } from '../../src/ingest/knowledge-ingest-bridge';

const ORG = 'org-667';
const TEXT = '"张三" 部门：财务部。';

let db: Database.Database;
let store: SqliteGraphStore;

beforeAll(() => {
  db = new Database(':memory:');
  store = new SqliteGraphStore(db);
});

afterAll(() => {
  db.close();
});

describe('#667 · MENTIONS 边 target 必须是真实 Document 节点', () => {
  it('正例：ingestDocumentText 建边后 target 存在且 object_type=Document（不再 unknown）', async () => {
    const result = await ingestDocumentText(TEXT, 'm-667.md', ORG, store);
    expect(result.errors).toEqual([]);
    expect(result.nodesCreated).toBeGreaterThanOrEqual(2);
    expect(result.edgesCreated).toBeGreaterThanOrEqual(1);

    const docs = store.queryNodes('Document', undefined, ORG);
    const doc = docs.find((d) => d.props.name === 'm-667.md');
    expect(doc).toBeTruthy();
    expect(doc!.id).toBeTruthy();

    const edges = store.queryEdges('MENTIONS', undefined, undefined, ORG);
    expect(edges.length).toBeGreaterThanOrEqual(1);
    for (const edge of edges) {
      // 关键：edge target 必须等于真实 Document id，不是 `doc_${fileName}`
      expect(edge.to).toBe(doc!.id);
      const target = store.getNode(edge.to, ORG) as { type?: string } | null;
      expect(target).not.toBeNull();
      expect(target?.type).toBe('Document');
    }

    const row = db
      .prepare('SELECT object_type FROM graph_triples WHERE graph = ? AND object_id = ?')
      .get(ORG, doc!.id) as { object_type?: string } | undefined;
    expect(row?.object_type).toBe('Document');
  });

  it('反例：target 不存在 ⇒ createMentionsEdge 抛错且不落边（必红）', () => {
    const personId = store.createNode('Person', { name: '李四' }, ORG);
    expect(() => createMentionsEdge(store, personId, 'missing-target-667', ORG))
      .toThrow(/target not found/i);
    expect(store.queryEdges('MENTIONS', personId, 'missing-target-667', ORG)).toHaveLength(0);
    expect(store.getNode('missing-target-667', ORG)).toBeNull();
  });

  it('幂等：重复建同一 MENTIONS 边不抛、只保留一条', () => {
    const personId = store.createNode('Person', { name: '王五' }, ORG);
    const docId = store.createNode('Document', { name: 'm-667-idem.md', content: 'x' }, ORG);
    expect(createMentionsEdge(store, personId, docId, ORG)).toBe(true);
    expect(createMentionsEdge(store, personId, docId, ORG)).toBe(false);
    expect(store.queryEdges('MENTIONS', personId, docId, ORG)).toHaveLength(1);
  });
});
