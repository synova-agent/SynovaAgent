/**
 * decision-ledger-roundtrip.integration.test.ts — J5 / #405：④ 台账「写 → 读回」集成判据
 *
 * 覆盖（对应卡 #405 判据①③④）：
 *   1. captureDecision 写入（经 SqliteGraphStore 真表）→ listDecisionRows 读回，逐字段匹配
 *   2. 读原语缺席（store 无 queryEdges）⇒ ok=false + READ_PRIMITIVE_MISSING（降级显式，不静默空数组）
 *   3. userId/nodeId 过滤与倒序（多条落账后按 at 倒序、按人/按节点过滤）
 *
 * 端到端（真实 HTTP 入口）版本见 scripts/integration/e2e-decision-roundtrip.ts（CI/治理线入口）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { captureDecision, listDecisionRows } from '../../src/l4/decision-capture';
import type { DecisionInput } from '../../src/l4/decision-capture';

let db: Database.Database;
let store: SqliteGraphStore;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE graph_nodes (
    id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL,
    name TEXT, props TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT)`);
  db.exec(`CREATE TABLE graph_triples (
    id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default',
    subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, predicate TEXT NOT NULL,
    object_type TEXT NOT NULL, object_id TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
    props TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT)`);
  store = new SqliteGraphStore(db);
});

afterAll(() => { db.close(); });

function input(nodeId: string, userId: string, atSuffix: string): DecisionInput {
  return {
    nodeId, userId, action: 'confirmed', role: 'test-role', reason: `test-${atSuffix}`,
    context: { orgId: 'default', taskRef: `task-${atSuffix}`, summary: `summary-${atSuffix}` },
    output: { kind: 'ticket-resolution', ref: `ref-${atSuffix}`, digest: `digest-${atSuffix}` },
    presetVersion: 1,
    review: { verdict: 'pass', by: userId, reason: 'test' },
  };
}

describe('J5 决策台账写读回环（#405）', () => {
  it('写入后能按 nodeId 读回，且逐字段匹配（判据①）', () => {
    db.prepare(`INSERT INTO graph_nodes (id, type, props) VALUES ('n1', 'outcome/risk', ?)`)
      .run(JSON.stringify({ id: 'n1' }));
    const wrote = captureDecision(store, 'default', input('n1', 'u1', 'a1'));
    expect(wrote.recorded).toBe(true);

    const read = listDecisionRows(store, { nodeId: 'n1' }, 'default');
    expect(read.ok).toBe(true);
    expect(read.entries.length).toBe(1);
    const row = read.entries[0].row;
    expect(row.who).toBe('u1');
    expect(row.role).toBe('test-role');
    expect(row.output.ref).toBe('ref-a1');
    expect(row.presetVersion).toBe(1);
    expect(read.entries[0].edgeType).toBe('DECISION_CONFIRMED');
  });

  it('多条落账按时间倒序；userId 过滤生效', async () => {
    db.prepare(`INSERT INTO graph_nodes (id, type, props) VALUES ('n2', 'outcome/risk', ?)`)
      .run(JSON.stringify({ id: 'n2' }));
    expect(captureDecision(store, 'default', input('n2', 'u1', 'b1')).recorded).toBe(true);
    await new Promise((r) => setTimeout(r, 20)); // 保证 at 可分辨
    expect(captureDecision(store, 'default', input('n2', 'u2', 'b2')).recorded).toBe(true);

    const all = listDecisionRows(store, { nodeId: 'n2' }, 'default');
    expect(all.ok).toBe(true);
    expect(all.entries.length).toBe(2);
    expect(all.entries[0].row.who).toBe('u2'); // 倒序：最新的在前
    const byUser = listDecisionRows(store, { nodeId: 'n2', userId: 'u1' }, 'default');
    expect(byUser.entries.length).toBe(1);
    expect(byUser.entries[0].row.output.ref).toBe('ref-b1');
  });

  it('store 无 queryEdges 原语 ⇒ 显式降级（判据④：不静默返回空）', () => {
    const broken = { queryNodes: () => [] } as unknown;
    const read = listDecisionRows(broken, {}, 'default');
    expect(read.ok).toBe(false);
    expect(read.entries).toEqual([]);
    expect(read.errors?.[0]).toContain('READ_PRIMITIVE_MISSING');
  });
});
