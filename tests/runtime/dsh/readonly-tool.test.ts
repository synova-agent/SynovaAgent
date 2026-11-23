/**
 * tests/runtime/dsh/readonly-tool.test.ts — T3 验收：回环 HTTP MCP 的**一个**只读领域工具（#1426 真实 ②）。
 *
 * 真实入口：MCP Streamable HTTP（`127.0.0.1`）＋ 一次性 bearer token → `synova_context_get`
 * → 结构化 JSON（与独立 golden 逐字段一致，golden 数据种在 :memory: 真图里）→ 与直接领域调用一致。
 * 反例：无 token、已撤销 token、伪造身份/路径、4 个写工具、未登记工具、未知 problemId（显式空）。
 *
 * 数据纪律：只连 `:memory:`（beforeAll fail-fast 断言）；节点/边用固定 id 种子（golden 需要静态 id），
 * 读取路径仍是真 `SqliteGraphStore`（不 mock 任何 store 方法）。
 *
 * #1459 T-A 语义变更（黄金件）：items 新增 `relation{type,direction,edgeId}`；本夹具无 `scan_assertions*`
 * 行 ⇒ `evidence` 字段不出现、`evidenceId` 仍为 null（有证据时才非空）。edge id 改为固定值以保持 golden 可比。
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { getDatabase, initEngineContext } from '../../../src/init/engine-context';
import { startReadonlyMcpServer, type ReadonlyMcpServer } from '../../../src/mcp/http';
import { SIDECAR_TOOLS } from '../../../src/mcp/tool-definitions';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';

const GOLDEN = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'runtime', 'dsh', 'fixtures', 'synova-context-get.json'), 'utf8'),
) as Record<string, unknown>;

const CONTEXT = { enterpriseId: 'ent-1', userId: 'user-1', scope: 'admin', runId: 'run_t3_0001' };
const PROBLEM = 'batch-1426-root';

let server: ReadonlyMcpServer;
let token: string;

beforeAll(async () => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`readonly-tool.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const db = getDatabase();
  const graph = CONTEXT.enterpriseId;
  // 先构造真 store（建 graph_nodes/graph_triples schema），再种固定 id 的 ② 节点
  new SqliteGraphStore(db);
  const insertNode = db.prepare('INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, ?, ?, ?, ?)');
  insertNode.run('node-1426-root', graph, 'activity/delivery_batch', '7月根批次',
    JSON.stringify({ businessKey: PROBLEM, name: '7月根批次', period: '2026-07', defVersion: 'def-2026.07' }));
  insertNode.run('node-1426-batch-a', graph, 'activity/delivery_batch', '交付批次A',
    JSON.stringify({ businessKey: 'batch-1426-a', name: '交付批次A', period: '2026-07', defVersion: 'def-2026.07' }));
  insertNode.run('node-1426-batch-b', graph, 'activity/delivery_batch', '交付批次B',
    JSON.stringify({ businessKey: 'batch-1426-b', name: '交付批次B', period: '2026-08', defVersion: 'def-2026.08' }));
  insertNode.run('node-1426-team', graph, 'resource/delivery_team', '交付一组',
    JSON.stringify({ businessKey: 'team-1426', name: '交付一组' }));

  // 边用**固定 id**（golden 逐字段比对需要稳定 edgeId）：root→A 为 out，B→root 为 in（in 方向用例）。
  const insertEdge = db.prepare(
    `INSERT INTO graph_triples (id, graph, subject_type, subject_id, predicate, object_type, object_id, weight, props)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, '{}')`,
  );
  insertEdge.run('edge-1426-root-to-batch-a', graph, 'activity/delivery_batch', 'node-1426-root',
    'edge/team_executes_activity', 'activity/delivery_batch', 'node-1426-batch-a');
  insertEdge.run('edge-1426-batch-b-to-root', graph, 'activity/delivery_batch', 'node-1426-batch-b',
    'edge/team_executes_activity', 'activity/delivery_batch', 'node-1426-root');
  insertEdge.run('edge-1426-team-to-root', graph, 'resource/delivery_team', 'node-1426-team',
    'edge/team_executes_activity', 'activity/delivery_batch', 'node-1426-root');

  server = await startReadonlyMcpServer();
  token = server.tokens.issue(CONTEXT);
});

afterAll(async () => {
  await server.close();
});

/** 建立一次 MCP 客户端连接（带 bearer token）。 */
async function connect(bearer: string | null): Promise<Client> {
  const client = new Client({ name: 'synova-1a-t3-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: bearer === null ? {} : { headers: { authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}

describe('T3 回环 HTTP MCP：只读、token、身份注入', () => {
  it('tools/list 只广告 1 个只读工具；4 个写工具不可见', async () => {
    const client = await connect(token);
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    expect(names).toEqual(['synova_context_get']);
    for (const writeTool of ['sentinel_run', 'sentinel_run_all', 'diagnose_organization', 'ingest_document']) {
      expect(names).not.toContain(writeTool);
    }
    expect(SIDECAR_TOOLS).toHaveLength(1);
    await client.close();
  });

  it('synova_context_get：MCP 结果与独立 golden 逐字段一致，count>0，且与直接领域调用一致', async () => {
    const client = await connect(token);
    const result = await client.callTool({ name: 'synova_context_get', arguments: { problemId: PROBLEM } });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0].type).toBe('text');
    const payload = JSON.parse(content[0].text ?? '{}') as Record<string, unknown>;
    expect(payload).toEqual(GOLDEN);
    expect(payload.synthetic).toBe(false);
    expect(payload.count).toBe(2);
    expect(payload.truncated).toBe(false);
    // 与直接领域调用一致（同一真 store、同一身份；独立 golden 提供期望）
    expect(payload).toEqual(JSON.parse(handleDomainToolCall('synova_context_get', { problemId: PROBLEM }, CONTEXT)));
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items.map(item => item.layer)).toEqual(['②', '②']);
    for (const item of items) {
      expect(typeof item.$id).toBe('string');
      expect(item.period).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof item.defVersion).toBe('string');
      expect(item.cycleVersion).toBeNull();   // 全仓零生产者
      expect(item.sentinelRun).toBeNull();    // ③ 不产
      expect(item.evidenceId).toBeNull();     // 本夹具无 scan_assertions* ⇒ 无证据
      expect(item.evidence).toBeUndefined();  // 无断言版本 ⇒ 字段缺失（不是空对象）
      expect(item.status).toBe('observed');
      expect(item.visibility).toBe('enterprise');
      expect(item.source).toEqual({ kind: 'synova.domain', api: 'synova.domain/v1' });
    }
    // 关系方向在真实入口上也可区分：root→A 命中 out，B→root 命中 in（#1459 钉子 2）
    expect(items.map(item => [item.$id, (item.relation as { direction: string }).direction])).toEqual([
      ['node-1426-batch-a', 'out'],
      ['node-1426-batch-b', 'in'],
    ]);
    await client.close();
  });

  it('4 个写工具调用一律 -32000 PERMISSION_DENIED', async () => {
    const client = await connect(token);
    for (const name of ['sentinel_run', 'sentinel_run_all', 'diagnose_organization', 'ingest_document']) {
      let caught: unknown = null;
      try {
        await client.callTool({ name, arguments: {} });
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught, `${name} 必须被拒绝`).toBeInstanceOf(McpError);
      expect((caught as McpError).code).toBe(-32000);
      expect((caught as McpError).message).toContain('PERMISSION_DENIED');
    }
    await client.close();
  });

  it('未登记工具 ⇒ -32601 方法不存在（不静默忽略）', async () => {
    const client = await connect(token);
    await expect(client.callTool({ name: 'decision_write', arguments: {} })).rejects.toMatchObject({ code: -32601 });
    await client.close();
  });

  it('伪造身份/路径参数 ⇒ 拒绝且错误里带稳定 code（不到达领域查询）', async () => {
    const client = await connect(token);
    for (const args of [
      { problemId: PROBLEM, enterpriseId: 'ent-2' },
      { problemId: PROBLEM, userId: 'user-2' },
      { problemId: PROBLEM, path: 'C:\\Windows' },
      { problemId: PROBLEM, evidenceId: 'ev-forged' },
    ]) {
      let caught: unknown = null;
      try {
        await client.callTool({ name: 'synova_context_get', arguments: args });
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(McpError);
      const message = (caught as McpError).message;
      expect(message).toMatch(/FORGED_IDENTITY|FORGED_PATH|VALIDATION_ERROR/);
      expect((caught as McpError).code).toBe(-32000);
    }
    await client.close();
  });

  it('无 token / 已撤销 token ⇒ 401（回环口不接受外部连入）', async () => {
    const anonymous = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(anonymous.status).toBe(401);
    const anonymousJson = await anonymous.json() as Record<string, unknown>;
    expect(anonymousJson.code).toBe('UNAUTHORIZED');

    const revoked = server.tokens.issue(CONTEXT);
    server.tokens.revoke(revoked);
    await expect(connect(revoked)).rejects.toBeDefined();
  });

  it('未知 problemId ⇒ 显式空（DOMAIN_EMPTY），零对象不算成功', async () => {
    const client = await connect(token);
    const result = await client.callTool({ name: 'synova_context_get', arguments: { problemId: 'problem-does-not-exist' } });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(result.isError).toBe(true);
    const payload = JSON.parse(content[0].text ?? '{}') as Record<string, unknown>;
    expect(payload.code).toBe('DOMAIN_EMPTY');
    expect(payload.ok).toBe(false);
    await client.close();
  });

});
