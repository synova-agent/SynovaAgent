/**
 * T3 验收：回环 HTTP MCP 的**一个**合成只读领域工具。
 *
 * 真实入口：MCP Streamable HTTP（`127.0.0.1`）＋ 一次性 bearer token → `synova_context_get`
 * → 结构化 JSON（与独立 golden 逐字段一致）→ 与直接领域调用一致。
 * 反例：无 token、已撤销 token、伪造身份/路径、4 个写工具、未登记工具、未知 problemId（显式空）、
 * 真实模式未配置（fail-closed）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { startReadonlyMcpServer, type ReadonlyMcpServer } from '../../../src/mcp/http';
import { SIDECAR_TOOLS } from '../../../src/mcp/tool-definitions';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';

const GOLDEN = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'runtime', 'dsh', 'fixtures', 'synova-context-get.json'), 'utf8'),
) as Record<string, unknown>;

const CONTEXT = { enterpriseId: 'ent-1', userId: 'user-1', scope: 'admin', runId: 'run_t3_0001' };

let server: ReadonlyMcpServer;
let token: string;

beforeAll(async () => {
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
  it('tools/list 只广告 1 个合成只读工具；4 个写工具不可见', async () => {
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
    const result = await client.callTool({ name: 'synova_context_get', arguments: { problemId: 'problem-revenue-health-2026q3' } });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0].type).toBe('text');
    const payload = JSON.parse(content[0].text ?? '{}') as Record<string, unknown>;
    expect(payload).toEqual(GOLDEN);
    expect(Number(payload.count)).toBeGreaterThan(0);
    // 与直接领域调用一致（同一合成基线，独立 golden 提供期望）
    expect(payload).toEqual(JSON.parse(handleDomainToolCall('synova_context_get', { problemId: 'problem-revenue-health-2026q3' })));
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items.map(item => item.layer)).toEqual(['②', '③', '④']);
    for (const item of items) {
      for (const field of ['$id', 'cycleVersion', 'sentinelRun', 'period', 'defVersion', 'evidenceId', 'status', 'visibility', 'source']) {
        expect(item[field], `${String(item.$id)} 缺 ${field}`).toBeDefined();
      }
    }
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
      { problemId: 'problem-revenue-health-2026q3', enterpriseId: 'ent-2' },
      { problemId: 'problem-revenue-health-2026q3', userId: 'user-2' },
      { problemId: 'problem-revenue-health-2026q3', path: 'C:\\Windows' },
      { problemId: 'problem-revenue-health-2026q3', evidenceId: 'ev-forged' },
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
