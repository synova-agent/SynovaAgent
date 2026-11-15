import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwtToken } from '../../src/middleware/auth';
import { closeEngineContext, getDatabase } from '../../src/init/engine-context';
import { authorityCounts, seedManifest, writeFixtureRoot } from '../enterprise-scan/fixtures';

const ENV_KEYS = ['DEV_MODE', 'JWT_SECRET', 'CREDENTIAL_MASTER_KEY', 'SYNOVA_ORG_ID', 'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'PORT', 'SYNOVA_SKIP_MCP'] as const;
const saved = new Map<string, string | undefined>();
let server: Server;
let baseUrl = '';
let root = '';
let ownerToken = '';
let otherOrgToken = '';

async function request(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  root = writeFixtureRoot();
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = 'synova-1398-route-secret-0123456789abcdef';
  process.env.CREDENTIAL_MASTER_KEY = 'synova-1398-master-key-0123456789abcdef0123456789abcdef';
  process.env.SYNOVA_ORG_ID = 'org-a';
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_DATA_DIR = root;
  process.env.PORT = '0';
  process.env.SYNOVA_SKIP_MCP = '1';
  const { createServer } = await import('../../src/server');
  server = await createServer();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('真实服务器未返回端口');
  baseUrl = `http://127.0.0.1:${address.port}`;
  seedManifest(getDatabase(), { root });
  ownerToken = signJwtToken({ sub: 'owner-a', role: 'owner', orgId: 'org-a', departmentIds: ['dept-delivery'] }) ?? '';
  otherOrgToken = signJwtToken({ sub: 'owner-b', role: 'owner', orgId: 'org-b', departmentIds: [] }) ?? '';
  if (!ownerToken || !otherOrgToken) throw new Error('JWT签发失败');
}, 90_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  closeEngineContext();
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('#1398 真实createServer扫描API', () => {
  it('POST 201→重放200→GET 200，跨graph统一403', async () => {
    const payload = { scan_manifest_id: 'manifest-golden', client_request_id: 'route-golden' };
    const created = await request('POST', '/api/enterprise-scan/runs', ownerToken, payload);
    expect(created.status).toBe(201);
    expect(created.body.schema_version).toBe('enterprise-scan/v1');
    expect(created.body.ontology).toMatchObject({ objects: expect.arrayContaining([expect.objectContaining({ type: 'outcome/delivery_result' })]) });
    const runId = (created.body.run as { run_id: string }).run_id;
    const replay = await request('POST', '/api/enterprise-scan/runs', ownerToken, payload);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(created.body);
    const read = await request('GET', `/api/enterprise-scan/runs/${runId}`, ownerToken);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
    const cross = await request('GET', `/api/enterprise-scan/runs/${runId}`, otherOrgToken);
    expect(cross.status).toBe(403);
    expect(cross.body.code).toBe('RUN_UNAVAILABLE');
  });

  it('无/空/无效token均401 UNAUTHORIZED且零写入', async () => {
    const before = authorityCounts(getDatabase());
    const missing = await request('POST', '/api/enterprise-scan/runs', undefined, { scan_manifest_id: 'manifest-golden', client_request_id: 'no-token' });
    const empty = await request('POST', '/api/enterprise-scan/runs', '', { scan_manifest_id: 'manifest-golden', client_request_id: 'empty-token' });
    const invalid = await request('POST', '/api/enterprise-scan/runs', 'invalid.token.value', { scan_manifest_id: 'manifest-golden', client_request_id: 'bad-token' });
    for (const response of [missing, empty, invalid]) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    }
    expect(authorityCounts(getDatabase())).toEqual(before);
  });

  it('请求体拒绝企业身份/权限/路径字段', async () => {
    const before = authorityCounts(getDatabase());
    const response = await request('POST', '/api/enterprise-scan/runs', ownerToken, {
      scan_manifest_id: 'manifest-golden', client_request_id: 'forged', orgId: 'org-b', allowed_path: root,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(authorityCounts(getDatabase())).toEqual(before);
  });
});
