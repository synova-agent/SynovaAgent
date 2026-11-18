/**
 * tests/runtime/dsh/readonly-tool-real.test.ts — #1426：真实领域读取（:memory: 真 store）与真实数据停点。
 *
 * 1A 过渡期本文件曾是「Kimi Code 真实领域 API 契约」的停点证明；#1426（I-1）已把 DSH 只读工具
 * 接到**自己的领域结构**（`graph_nodes`/`graph_triples`，只产 ②）。本文件现在证明：
 *   ① 生产装配没有外部真实适配器/外发开关（工具读的是本机领域库，不出网）；
 *   ② 工具输出带真实来源（`synthetic:false`、`source.api='synova.domain/v1'`），值等于库内 props；
 *   ③ 「真实客户数据 / 生产部署」一致性仍 **UNVERIFIED**（未授权），不写通过断言。
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { getDatabase, initEngineContext } from '../../../src/init/engine-context';
import { startReadonlyMcpServer, type ReadonlyMcpServer } from '../../../src/mcp/http';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';

const CONTEXT = { enterpriseId: 'ent-real-1426', userId: 'user-real-1426', scope: 'admin', runId: 'run_real_1426' };
const PROBLEM = 'batch-1426-real-root';

let server: ReadonlyMcpServer;
let token: string;
/** ② 邻接条目 id（真 :memory: 图种子）。 */
let neighborId: string;

beforeAll(async () => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`readonly-tool-real.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const store = new SqliteGraphStore(getDatabase());
  const root = store.createNode(
    'activity/delivery_batch',
    { businessKey: PROBLEM, name: '真实根批次', period: '2026-07', defVersion: 'def-2026.07' },
    CONTEXT.enterpriseId,
  );
  neighborId = store.createNode(
    'activity/delivery_batch',
    { businessKey: 'batch-1426-real-neighbor', name: '真实邻接批次', period: '2026-08', defVersion: 'def-2026.08' },
    CONTEXT.enterpriseId,
  );
  store.createEdge('edge/team_executes_activity', root, neighborId, 1, {}, CONTEXT.enterpriseId);

  server = await startReadonlyMcpServer();
  token = server.tokens.issue(CONTEXT);
});

afterAll(async () => {
  await server.close();
});

interface SnapshotShape {
  synthetic: boolean;
  count: number;
  items: Array<{ $id: string; period: string; defVersion: string; source: { api: string } }>;
}

describe('T4 真实领域读取：停点与 fail-closed', () => {
  it('生产装配没有外部真实适配器/外发开关（工具只读本机领域库）', () => {
    expect(process.env.SYNOVA_REAL_DOMAIN_ADAPTER).toBeUndefined();
    expect(process.env.SYNOVA_KIMI_CODE_API_KEY).toBeUndefined();
    expect(process.env.KIMI_CODE_BASE_URL).toBeUndefined();
  });

  it('工具输出真实领域来源：synthetic=false、source.api=synova.domain/v1、period/defVersion 等于库内 props', async () => {
    const direct = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: PROBLEM }, CONTEXT)) as SnapshotShape;
    expect(direct.synthetic).toBe(false);
    expect(direct.count).toBe(1);
    expect(direct.items[0].$id).toBe(neighborId);
    expect(direct.items[0].period).toBe('2026-08');
    expect(direct.items[0].defVersion).toBe('def-2026.08');
    expect(direct.items[0].source.api).toBe('synova.domain/v1');

    const client = new Client({ name: 't4-real-read', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const result = await client.callTool({ name: 'synova_context_get', arguments: { problemId: PROBLEM } });
    const content = result.content as Array<{ text?: string }>;
    const viaMcp = JSON.parse(content[0].text ?? '{}') as SnapshotShape;
    expect(viaMcp.synthetic).toBe(false);
    expect(viaMcp).toEqual(direct); // 真 HTTP 入口 ≡ 直接领域调用（同一身份、同一真 store）
    await client.close();
  });

  it('真实客户数据 / 生产部署 = UNVERIFIED（如实记录，不写通过断言）', () => {
    const stopPoint = {
      item: 'synova_context_get 的真实客户库/生产部署一致性',
      status: 'UNVERIFIED' as const,
      reason: '真实客户数据与生产部署未授权（DESIGN：本测试只连 :memory:；真实库数据分布未核实）',
    };
    expect(stopPoint.status).toBe('UNVERIFIED');
    expect(stopPoint.reason).toContain('未授权');
    // 结构性证明：本文件运行在 :memory:（不触碰真实库）
    expect(process.env.SYNOVA_DB_PATH).toBe(':memory:');
  });
});
