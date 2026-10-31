/**
 * tests/l4/graph-scope-wiring.test.ts — #1211 · "数据存哪个图分区"口径一致（U-3 / U-4 / U-5）
 *
 * 判据来源：.handbook/派单件/2026-10-31-规格-1211-图命名空间口径统一.md §3
 *   U-3 非法 graph ⇒ 真 HTTP 400 ＋ 真库**零新增**
 *   U-4 **命门**：resolveGraph 建节点 / captureDecision 落账边 / listDecisionRows 读回 —— 三处同口径
 *   U-5 export manifest 的 graphCoverage 两格（含 graph==='default' ⇒ 0 的语义兜底）
 *
 * 手法（铁律 12 / 铁律 0-2）：**真 SqliteGraphStore(':memory:') ＋ 真 express ＋ 真 HTTP fetch**，
 *   不 mock 管线、不引 supertest、不数 grep。
 * 铁律 48：每条用例都有真 expect；铁律 38：零 as any / as unknown as。
 *
 * 注：每个用例结束显式 `db.close()` —— better-sqlite3 句柄若留到环境拆除后 GC，
 *     会触发 `Assertion failed: (env) != nullptr`（#1218 / #1225 的同族 flake），
 *     本文件不复制那个失败模式。
 */
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { SessionStore } from '../../src/store/session-store';
import { AgentMemoryStore } from '../../src/l4/agent-memory-store';
import { DataExporter } from '../../src/l4/data-exporter';
import { resolveGraph } from '../../src/l2/graph-scope';
import { captureDecision, type DecisionInput } from '../../src/l4/decision-capture';
import { listDecisionRows } from '../../src/l4/decision-ledger-readback';
import dataRouter from '../../src/routes/data';

interface Fixture {
  db: Database.Database;
  graphStore: SqliteGraphStore;
  sessionStore: SessionStore;
  memoryStore: AgentMemoryStore;
}

const openFixtures: Fixture[] = [];

/** 真 store 组（同一个 :memory: 库；三个 store 各自建自己的表） */
function makeStores(): Fixture {
  const db = new Database(':memory:');
  const fixture: Fixture = {
    db,
    graphStore: new SqliteGraphStore(db),
    sessionStore: new SessionStore(db),
    memoryStore: new AgentMemoryStore(db),
  };
  openFixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (openFixtures.length > 0) {
    const fixture = openFixtures.pop();
    if (fixture) fixture.db.close();
  }
});

/** 图里节点 ＋ 边的总行数（"零新增"用直连 SQL 计数，不经 store 的过滤面） */
function countGraphRows(db: Database.Database): number {
  const nodes = db.prepare('SELECT COUNT(*) AS c FROM graph_nodes').get() as { c: number };
  const edges = db.prepare('SELECT COUNT(*) AS c FROM graph_triples').get() as { c: number };
  return nodes.c + edges.c;
}

/** 起真 express（挂真路由 ＋ 注入真 store），返回端口 URL */
async function startApp(graphStore: SqliteGraphStore): Promise<{ server: Server; url: string }> {
  const app = express();
  app.use(express.json());
  app.locals.graphStore = graphStore;
  app.use(dataRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => { server.close(() => resolve()); });
}

/** 决策输入的完整五要素（与 tests/l4/decision-ledger-roundtrip.integration.test.ts 同形） */
function decisionInput(nodeId: string, userId: string): DecisionInput {
  return {
    nodeId,
    userId,
    action: 'confirmed',
    role: 'test-role',
    reason: 'acme 口径落账',
    context: { orgId: 'acme', taskRef: 'task-1211', summary: '图命名空间口径统一' },
    output: { kind: 'ticket-resolution', ref: 'ref-1211', digest: 'digest-1211' },
    presetVersion: 1,
    review: { verdict: 'pass', by: userId, reason: 'test' },
  };
}

describe('U-3 非法 graph ⇒ 400 ＋ 真库零新增（真 express ＋ 真 HTTP ＋ 真 store）', () => {
  it("POST /api/data/upload {graph:'../evil'} ⇒ 400 + code=GRAPH_NAME_INVALID，且图库行数不变", async () => {
    const { db, graphStore } = makeStores();
    // 先落 1 个良性节点，证明计数是"相对"而非"空库恒 0"
    graphStore.createNode('outcome/risk', { id: 'seed-1', orgId: 'acme' }, 'acme');
    const before = countGraphRows(db);

    const { server, url } = await startApp(graphStore);
    try {
      const response = await fetch(`${url}/api/data/upload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapping: 'x', rows: [{ period: '2026Q1', name: '样本' }], graph: '../evil' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { ok?: boolean; error?: string; code?: string };
      expect(body.ok).toBe(false);
      expect(body.code).toBe('GRAPH_NAME_INVALID');
      // 真库零新增（节点 ＋ 边）
      expect(countGraphRows(db)).toBe(before);
    } finally {
      await closeServer(server);
    }
  });

  it('合法 graph 走真路径 ⇒ 200 且节点落 acme（证明 400 不是"一律拒"）', async () => {
    const { db, graphStore } = makeStores();
    const before = countGraphRows(db);
    const { server, url } = await startApp(graphStore);
    try {
      const response = await fetch(`${url}/api/data/upload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapping: 'crm-standard',
          rows: [{ 收入: 1000, 客户状态: 'active', 期间: '2026Q1' }],
          graph: 'acme',
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { nodesCreated?: number };
      expect(body.nodesCreated).toBe(1);
      // 派生出的 graph 真的下传到了介质层：acme 有、default 没有
      expect(graphStore.queryNodes('resource/client', {}, 'acme').length).toBe(1);
      expect(graphStore.queryNodes('resource/client', {}, 'default').length).toBe(0);
      expect(countGraphRows(db)).toBeGreaterThan(before);
    } finally {
      await closeServer(server);
    }
  });
});

describe('U-4 命门 —— 三处消费点同口径（真 SqliteGraphStore）', () => {
  it("resolveGraph({orgId:'acme'}) 建节点 ⇒ 台账边也落 acme，按 default 查不到；listDecisionRows 读得回", () => {
    const { graphStore } = makeStores();

    // ① 口径唯一来源派生图名
    const graph = resolveGraph({ orgId: 'acme' });
    expect(graph).toBe('acme');

    // ② 节点落 acme（存在性闸按 props.id 判 ⇒ 域内 id 必须与 decision.nodeId 同源，
    //    见 decision-capture.ts:341-343；行 id 是存储内部 uuid，不作判据）
    const decisionNodeId = 'n-acme';
    graphStore.createNode('outcome/risk', { id: decisionNodeId, name: '口径验证风险节点' }, graph);
    expect(graphStore.queryNodes('outcome/risk', { id: decisionNodeId }, 'acme').length).toBe(1);
    expect(graphStore.queryNodes('outcome/risk', { id: decisionNodeId }, 'default').length).toBe(0);

    // ③ 台账边落同一图（否则"台账读不到自己刚写的账"）
    const wrote = captureDecision(graphStore, graph, decisionInput(decisionNodeId, 'u1'));
    expect(wrote.recorded).toBe(true);
    expect(wrote.edgeType).toBe('DECISION_CONFIRMED');
    expect(graphStore.queryEdges(undefined, undefined, undefined, 'acme').length).toBe(1);
    expect(graphStore.queryEdges(undefined, undefined, undefined, 'default').length).toBe(0);

    // ④ 读回同口径
    const readAcme = listDecisionRows(graphStore, { nodeId: decisionNodeId }, 'acme');
    expect(readAcme.ok).toBe(true);
    expect(readAcme.entries.length).toBe(1);
    expect(readAcme.entries[0].row.who).toBe('u1');

    const readDefault = listDecisionRows(graphStore, { nodeId: decisionNodeId }, 'default');
    expect(readDefault.entries.length).toBe(0);
  });

  it('图名写错位 ⇒ 读回为空（反证：三处不同口径时本判据必红）', () => {
    const { graphStore } = makeStores();
    const decisionNodeId = 'n-mis';
    graphStore.createNode('outcome/risk', { id: decisionNodeId }, resolveGraph({ orgId: 'acme' }));
    expect(captureDecision(graphStore, 'acme', decisionInput(decisionNodeId, 'u2')).recorded).toBe(true);
    // 用 default 读 acme 写的账 ⇒ 必须读不到
    expect(listDecisionRows(graphStore, { nodeId: decisionNodeId }, 'default').entries.length).toBe(0);
  });
});

describe('U-5 导出"图覆盖"可断言（manifest.graphCoverage）', () => {
  it("graph='acme' ⇒ graphs 含 'acme'；default 图 N=3 节点 ⇒ defaultGraphCount=3", async () => {
    const { graphStore, sessionStore, memoryStore } = makeStores();
    // acme 图 1 节点（导出目标）
    graphStore.createNode('outcome/risk', { id: 'a1', orgId: 'acme' }, 'acme');
    // default 图 3 节点（历史存量，未随本次导出）
    graphStore.createNode('outcome/risk', { id: 'd1' }, 'default');
    graphStore.createNode('outcome/risk', { id: 'd2' }, 'default');
    graphStore.createNode('activity/production', { id: 'd3' }, 'default');

    const exporter = new DataExporter(graphStore, sessionStore, memoryStore);
    const { manifest } = await exporter.export('acme');

    expect(manifest.graphCoverage.graphs).toContain('acme');
    expect(manifest.graphCoverage.defaultGraphCount).toBe(3);
    // 导出内容确实只含 acme 图
    expect(manifest.summary.nodes).toBe(1);
  });

  it("graph==='default'（默认装机）⇒ defaultGraphCount 恒 0（防语义反转）", async () => {
    const { graphStore, sessionStore, memoryStore } = makeStores();
    // 默认装机：唯一的图就是 default，3 个节点**本次全部导出**
    graphStore.createNode('outcome/risk', { id: 'd1' }, 'default');
    graphStore.createNode('outcome/risk', { id: 'd2' }, 'default');
    graphStore.createNode('activity/production', { id: 'd3' }, 'default');

    const exporter = new DataExporter(graphStore, sessionStore, memoryStore);
    const { manifest } = await exporter.export('default');

    expect(manifest.graphCoverage.graphs).toContain('default');
    // 🔴 若把"已导出的 default 节点"算成"未随本次导出"，这里会是 3
    expect(manifest.graphCoverage.defaultGraphCount).toBe(0);
    expect(manifest.summary.nodes).toBe(3);
  });
});
