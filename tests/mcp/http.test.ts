/**
 * tests/mcp/http.test.ts — 回环只读 MCP 服务单测（真实 MCP 客户端连接）。
 *
 * 配对对象：src/mcp/http.ts
 * 覆盖：tools/list 只广告 1 个只读工具、tools/call 真实 ② 结果（#1426）、写工具 -32000、
 * 未登记工具 -32601、无/撤销 token 401、GET 方法 405、未知路径 404。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { getDatabase, initEngineContext } from '../../src/init/engine-context';
import { startReadonlyMcpServer, type ReadonlyMcpServer } from '../../src/mcp/http';

const CONTEXT = { enterpriseId: 'ent-http-1', userId: 'user-http-1', scope: 'admin', runId: 'run_http_0001' };
const PROBLEM = 'batch-1426-http-root';
let server: ReadonlyMcpServer;
let token: string;
/** ② 邻接条目 id（真 :memory: 图种子）。 */
let neighborIds: string[];

beforeAll(async () => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`http.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const store = new SqliteGraphStore(getDatabase());
  const root = store.createNode(
    'activity/delivery_batch',
    { businessKey: PROBLEM, name: 'HTTP 根批次', period: '2026-07', defVersion: 'def-2026.07' },
    CONTEXT.enterpriseId,
  );
  neighborIds = [
    store.createNode('activity/delivery_batch',
      { businessKey: 'batch-1426-http-a', name: 'HTTP 邻接A', period: '2026-07', defVersion: 'def-2026.07' }, CONTEXT.enterpriseId),
    store.createNode('activity/delivery_batch',
      { businessKey: 'batch-1426-http-b', name: 'HTTP 邻接B', period: '2026-08', defVersion: 'def-2026.08' }, CONTEXT.enterpriseId),
  ];
  for (const neighbor of neighborIds) {
    store.createEdge('edge/team_executes_activity', root, neighbor, 1, {}, CONTEXT.enterpriseId);
  }
  server = await startReadonlyMcpServer();
  token = server.tokens.issue(CONTEXT);
});

afterAll(async () => {
  await server.close();
});

async function connect(bearer: string | null): Promise<Client> {
  const client = new Client({ name: 'synova-http-unit', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: bearer === null ? {} : { headers: { authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}

describe('mcp/http: 工具面与只读强制', () => {
  it('tools/list 只含 synova_context_get，4 个写工具不可见', async () => {
    const client = await connect(token);
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    expect(names).toEqual(['synova_context_get']);
    for (const writeTool of ['sentinel_run', 'sentinel_run_all', 'diagnose_organization', 'ingest_document']) {
      expect(names).not.toContain(writeTool);
    }
    await client.close();
  });

  it('tools/call 返回真实 ② ContextSnapshot（synthetic=false，来源 synova.domain/v1）', async () => {
    const client = await connect(token);
    const result = await client.callTool({ name: 'synova_context_get', arguments: { problemId: PROBLEM } });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0].type).toBe('text');
    const payload = JSON.parse(content[0].text ?? '{}') as {
      synthetic: boolean;
      count: number;
      truncated: boolean;
      items: Array<{ layer: string; $id: string; source: { api: string } }>;
    };
    expect(payload.synthetic).toBe(false);
    expect(payload.count).toBe(2);
    expect(payload.truncated).toBe(false);
    expect(payload.items.map(item => item.layer)).toEqual(['②', '②']);
    expect(payload.items.map(item => item.$id).sort()).toEqual([...neighborIds].sort());
    expect(payload.items.every(item => item.source.api === 'synova.domain/v1')).toBe(true);
    await client.close();
  });

  it('写工具 ⇒ -32000；未登记工具 ⇒ -32601；伪造参数 ⇒ -32000 且带 code', async () => {
    const client = await connect(token);
    await expect(client.callTool({ name: 'sentinel_run', arguments: {} })).rejects.toMatchObject({ code: -32000 });
    await expect(client.callTool({ name: 'decision_write', arguments: {} })).rejects.toMatchObject({ code: -32601 });

    let caught: unknown = null;
    try {
      await client.callTool({ name: 'synova_context_get', arguments: { problemId: PROBLEM, enterpriseId: 'ent-2' } });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).message).toContain('FORGED_IDENTITY');
    await client.close();
  });
});

describe('mcp/http: 鉴权与传输边界', () => {
  it('无 token ⇒ 401 UNAUTHORIZED（回环口不接受外部连入）', async () => {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.code).toBe('UNAUTHORIZED');
  });

  it('已撤销 token ⇒ 连接失败（一次性 token 不复活）', async () => {
    const revoked = server.tokens.issue(CONTEXT);
    server.tokens.revoke(revoked);
    await expect(connect(revoked)).rejects.toBeDefined();
  });

  it('GET /mcp ⇒ 405；未知路径 ⇒ 404', async () => {
    const getResponse = await fetch(server.url, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
    expect(getResponse.status).toBe(405);
    const unknown = await fetch(server.url.replace('/mcp', '/other'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unknown.status).toBe(404);
  });
});
