/**
 * T4：真实 Kimi Code 领域 API 的**停点证明**（本批不做真实一致验收）。
 *
 * 1A 过渡 Mandate 把「Kimi Code 真实领域 API 契约 / 真实模式验收」列为硬停点。
 * 本文件的职责不是冒充通过，而是证明：
 *   ① 生产路径没有真实适配器注入面（无 env 开关、无默认外发）；
 *   ② 工具输出带 `synthetic: true`，合成基线不得被当成真实结果；
 *   ③ 真实模式的「与直接领域调用一致」在本批 **UNVERIFIED**——缺失真实 API 契约与凭据，
 *      本文件不写任何「真实一致通过」的断言。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startReadonlyMcpServer, type ReadonlyMcpServer } from '../../../src/mcp/http';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';

let server: ReadonlyMcpServer;
let token: string;

beforeAll(async () => {
  server = await startReadonlyMcpServer();
  token = server.tokens.issue({ enterpriseId: 'ent-1', userId: 'user-1', scope: 'admin', runId: 'run_real_stop_001' });
});

afterAll(async () => {
  await server.close();
});

describe('T4 真实领域 API：停点与 fail-closed', () => {
  it('生产装配没有真实适配器/外发开关（默认路径只有合成基线）', () => {
    expect(process.env.SYNOVA_REAL_DOMAIN_ADAPTER).toBeUndefined();
    expect(process.env.SYNOVA_KIMI_CODE_API_KEY).toBeUndefined();
    expect(process.env.KIMI_CODE_BASE_URL).toBeUndefined();
  });

  it('工具输出显式 synthetic=true（合成不冒充真实）', async () => {
    const direct = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: 'problem-revenue-health-2026q3' })) as {
      synthetic: boolean;
      count: number;
      items: Array<{ source: { api: string } }>;
    };
    expect(direct.synthetic).toBe(true);
    expect(direct.count).toBe(3);
    expect(direct.items[0].source.api).toBe('synthetic-context-v1');

    const client = new Client({ name: 't4-real-stop', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const result = await client.callTool({ name: 'synova_context_get', arguments: { problemId: 'problem-revenue-health-2026q3' } });
    const content = result.content as Array<{ text?: string }>;
    const viaMcp = JSON.parse(content[0].text ?? '{}') as { synthetic: boolean };
    expect(viaMcp.synthetic).toBe(true);
    await client.close();
  });

  it('真实一致性 = UNVERIFIED：没有可用的真实领域 API 契约（如实记录，不写通过断言）', () => {
    const stopPoint = {
      item: 'readonly-tool-real.test.ts 的真实模式验收',
      status: 'UNVERIFIED' as const,
      reason: 'Kimi Code 真实领域 API 契约/凭据未提供（1A 过渡 Mandate §5 硬停点）',
    };
    expect(stopPoint.status).toBe('UNVERIFIED');
    expect(stopPoint.reason).toContain('硬停点');
  });
});
