import type { Server } from 'http';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { signJwtToken } from '../../src/middleware/auth';
import { closeEngineContext, getDatabase } from '../../src/init/engine-context';
import { getScan, loadManifests, startScan } from '../../electron-renderer/src/lib/enterprise-scan-api';
import {
  authorityCounts,
  seedAuthorizationManifest,
  seedManifest,
  writeFixtureRoot,
  type SeedAuthorizationEntry,
} from '../enterprise-scan/fixtures';
import { createScanHarness } from '../enterprise-scan/test-helpers';

const ENV_KEYS = ['DEV_MODE', 'JWT_SECRET', 'CREDENTIAL_MASTER_KEY', 'SYNOVA_ORG_ID', 'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'PORT', 'SYNOVA_SKIP_MCP'] as const;
const ORG = 'org-a';
const ADMIN_IDS = [
  'manifest-a-enterprise',
  'manifest-b-personal-staff',
  'manifest-c-personal-manager',
  'manifest-d-dept-allow',
  'manifest-e-dept-role-deny',
  'manifest-f-dept-no-role',
  'manifest-g-personal-liaison',
  'manifest-h-dept-liaison',
  'manifest-i-partial',
  'manifest-j-hidden',
  'manifest-k-missing-path',
] as const;

function expectedManifests(ids: readonly string[]): unknown {
  return {
    schema_version: 'enterprise-scan-manifests/v1',
    manifests: ids.map(manifest_id => ({ manifest_id, display_name: manifest_id })),
  };
}

function manifestIds(body: Record<string, unknown>): string[] {
  const manifests = (body as { manifests?: Array<{ manifest_id: string }> }).manifests ?? [];
  return manifests.map(item => item.manifest_id);
}

async function request(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
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

function addressOf(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('真实服务器未返回端口');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server | undefined, closeEngine: () => void = closeEngineContext): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  closeEngine();
}

function signPayload(payload: Record<string, unknown>): string {
  const secret = process.env.JWT_SECRET ?? '';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600, jti: `1413-${now}-${Math.random()}`, ...payload })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${encoded}`).digest('base64url');
  return `${header}.${encoded}.${signature}`;
}

function enterpriseEntry(): SeedAuthorizationEntry {
  return { fileName: 'delivery_batches.csv', visibility: 'enterprise', allowedRoles: [], allowedUsers: [], allowedDepartments: [] };
}

function restrictedEntry(allowedUsers: readonly string[], allowedRoles: readonly string[], allowedDepartments: readonly string[]): SeedAuthorizationEntry {
  return { fileName: 'operator-statement.json', visibility: 'restricted', allowedUsers, allowedRoles, allowedDepartments };
}

function seedMatrix(root: string): void {
  const db = getDatabase();
  const seed = (manifestId: string, entries: readonly SeedAuthorizationEntry[], graph = ORG): void => {
    seedAuthorizationManifest(db, { graph, manifestId, root, entries });
  };
  seed('manifest-a-enterprise', [enterpriseEntry()]);
  seed('manifest-b-personal-staff', [restrictedEntry(['staff-a'], ['manager'], ['dept-other'])]);
  seed('manifest-c-personal-manager', [restrictedEntry(['manager-a'], [], [])]);
  seed('manifest-d-dept-allow', [restrictedEntry([], ['staff'], ['dept-a'])]);
  seed('manifest-e-dept-role-deny', [restrictedEntry([], ['manager'], ['dept-a'])]);
  seed('manifest-f-dept-no-role', [restrictedEntry([], [], ['dept-a'])]);
  seed('manifest-g-personal-liaison', [restrictedEntry(['liaison-a'], [], [])]);
  seed('manifest-h-dept-liaison', [restrictedEntry([], ['liaison'], ['dept-a'])]);
  seed('manifest-i-partial', [enterpriseEntry(), restrictedEntry(['staff-a'], [], [])]);
  seed('manifest-j-hidden', [restrictedEntry(['someone-else'], [], [])]);
  seed('manifest-k-missing-path', [enterpriseEntry()]);
  db.prepare('UPDATE scan_authorizations SET allowed_path = ? WHERE graph = ? AND manifest_id = ?')
    .run(join(root, 'synthetic-not-present.csv'), ORG, 'manifest-k-missing-path');
  seed('manifest-l-invalid-json', [enterpriseEntry()]);
  db.prepare('UPDATE scan_authorizations SET allowed_users_json = ? WHERE graph = ? AND manifest_id = ?')
    .run('{broken', ORG, 'manifest-l-invalid-json');
  seed('manifest-m-invalid-visibility', [enterpriseEntry()]);
  db.prepare('UPDATE scan_authorizations SET visibility = ? WHERE graph = ? AND manifest_id = ?')
    .run('private', ORG, 'manifest-m-invalid-visibility');
  seed('manifest-n-invalid-revision', [enterpriseEntry()]);
  db.prepare('UPDATE scan_authorizations SET revision = 0 WHERE graph = ? AND manifest_id = ?')
    .run(ORG, 'manifest-n-invalid-revision');
  seed('manifest-only-hidden', [restrictedEntry(['someone-else'], [], [])], 'org-empty');
}

describe('#1413 manifest 真实 JWT 路由与权限矩阵', () => {
  const saved = new Map<string, string | undefined>();
  let server: Server | undefined;
  let baseUrl = '';
  let root = '';

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    root = writeFixtureRoot();
    process.env.DEV_MODE = 'false';
    process.env.JWT_SECRET = 'synova-1413-route-secret-0123456789abcdef';
    process.env.CREDENTIAL_MASTER_KEY = 'synova-1413-master-key-0123456789abcdef0123456789abcdef';
    process.env.SYNOVA_ORG_ID = ORG;
    process.env.SYNOVA_DB_PATH = ':memory:';
    process.env.SYNOVA_DATA_DIR = root;
    process.env.PORT = '0';
    process.env.SYNOVA_SKIP_MCP = '1';
    const { createServer } = await import('../../src/server');
    server = await createServer();
    baseUrl = addressOf(server);
    seedMatrix(root);
  }, 90_000);

  afterAll(async () => {
    await closeServer(server);
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function tokenFor(role: string, sub: string, departments?: readonly string[], orgId = ORG): string {
    const token = signJwtToken({ sub, role, orgId, departmentIds: departments });
    if (!token) throw new Error('JWT签发失败');
    return token;
  }

  it('store.listManifestIds 只返回指定 graph 的去重升序 id', () => {
    const harness = createScanHarness();
    try {
      seedAuthorizationManifest(harness.db, { graph: 'org-a', manifestId: 'shared-id', root, entries: [enterpriseEntry(), restrictedEntry([], [], [])] });
      seedAuthorizationManifest(harness.db, { graph: 'org-b', manifestId: 'foreign-id', root, entries: [enterpriseEntry()] });
      seedAuthorizationManifest(harness.db, { graph: 'org-a', manifestId: 'a-first', root, entries: [enterpriseEntry()] });
      expect(harness.store.listManifestIds('org-a')).toEqual(['a-first', 'shared-id']);
    } finally {
      harness.close();
    }
  });

  it('admin 得到精确白名单形状、去重升序清单，损坏授权 fail-closed，缺失路径不 preflight', async () => {
    const before = authorityCounts(getDatabase());
    const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', tokenFor('admin', 'admin-a'));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedManifests(ADMIN_IDS));
    expect(manifestIds(response.body)).toEqual([...ADMIN_IDS]);
    expect(response.body).not.toHaveProperty('total');
    expect(response.body).not.toHaveProperty('count');
    expect(JSON.stringify(response.body)).not.toContain(root);
    expect(JSON.stringify(response.body)).not.toContain('synthetic-not-present.csv');
    expect(JSON.stringify(response.body)).not.toContain('十月华东交付批次');
    expect(manifestIds(response.body)).not.toContain('manifest-l-invalid-json');
    expect(manifestIds(response.body)).not.toContain('manifest-m-invalid-visibility');
    expect(manifestIds(response.body)).not.toContain('manifest-n-invalid-revision');
    expect(authorityCounts(getDatabase())).toEqual(before);
  });

  const roleCases = [
    { role: 'manager', sub: 'manager-a', departments: ['dept-a'], ids: ['manifest-a-enterprise', 'manifest-c-personal-manager', 'manifest-e-dept-role-deny', 'manifest-f-dept-no-role', 'manifest-i-partial', 'manifest-k-missing-path'] },
    { role: 'staff', sub: 'staff-a', departments: ['dept-a'], ids: ['manifest-a-enterprise', 'manifest-b-personal-staff', 'manifest-d-dept-allow', 'manifest-f-dept-no-role', 'manifest-i-partial', 'manifest-k-missing-path'] },
    { role: 'staff', sub: 'staff-a', departments: undefined, ids: ['manifest-a-enterprise', 'manifest-b-personal-staff', 'manifest-i-partial', 'manifest-k-missing-path'] },
    { role: 'staff', sub: 'staff-a', departments: ['dept-other'], ids: ['manifest-a-enterprise', 'manifest-b-personal-staff', 'manifest-i-partial', 'manifest-k-missing-path'] },
    { role: 'liaison', sub: 'liaison-a', departments: ['dept-a'], ids: ['manifest-a-enterprise', 'manifest-g-personal-liaison', 'manifest-i-partial', 'manifest-k-missing-path'] },
  ] as const;

  it.each(roleCases)('$role/$sub/departments=$departments 只得到服务端授权清单', async testCase => {
    const before = authorityCounts(getDatabase());
    const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', tokenFor(testCase.role, testCase.sub, testCase.departments));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedManifests(testCase.ids));
    expect(response.body).not.toHaveProperty('partial_visibility');
    expect(response.body).not.toHaveProperty('hidden_count');
    expect(authorityCounts(getDatabase())).toEqual(before);
  });

  it('同企业全部不可见与跨企业无自有清单均为精确空数组', async () => {
    for (const token of [
      tokenFor('staff', 'staff-empty', ['dept-a'], 'org-empty'),
      tokenFor('admin', 'admin-b', [], 'org-b'),
    ]) {
      const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', token);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expectedManifests([]));
      expect(manifestIds(response.body)).not.toContain('manifest-a-enterprise');
    }
  });

  it('GA 与合法签名未知角色为 403，拒绝体无清单', async () => {
    for (const role of ['ga', 'root']) {
      const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', tokenFor(role, `${role}-a`));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('manifests');
    }
  });

  it('无／空／无效 token 与真 HTTP 缺 sub 均 401，缺 orgId 为 403', async () => {
    const cases = [
      { token: undefined, status: 401 },
      { token: '', status: 401 },
      { token: 'invalid.token.value', status: 401 },
      { token: signPayload({ role: 'admin', orgId: ORG }), status: 401 },
      { token: signPayload({ sub: 'missing-org', role: 'admin' }), status: 403 },
    ] as const;
    for (const testCase of cases) {
      const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', testCase.token);
      expect(response.status).toBe(testCase.status);
      expect(response.body.code).toBe(testCase.status === 401 ? 'UNAUTHORIZED' : 'SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('manifests');
    }
  });

  it('伪造身份与权限 query 为 400，不返回清单', async () => {
    const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests?orgId=org-b&role=admin&allowed_path=%2Ftmp', tokenFor('admin', 'admin-a'));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body).not.toHaveProperty('manifests');
  });

  it('不可见 id 与跨企业 id 直接 POST 均 403 且零写入', async () => {
    for (const testCase of [
      { token: tokenFor('staff', 'staff-a', ['dept-a']), manifestId: 'manifest-j-hidden', key: 'hidden-post' },
      { token: tokenFor('admin', 'admin-b', [], 'org-b'), manifestId: 'manifest-a-enterprise', key: 'cross-post' },
    ]) {
      const before = authorityCounts(getDatabase());
      const response = await request(baseUrl, 'POST', '/api/enterprise-scan/runs', testCase.token, { scan_manifest_id: testCase.manifestId, client_request_id: testCase.key });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SCOPE_DENIED');
      expect(authorityCounts(getDatabase())).toEqual(before);
    }
  });

  it('部分可见清单只列出一次，POST 报告仍携带 partial_visibility', async () => {
    const token = tokenFor('liaison', 'liaison-a', ['dept-a']);
    const list = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', token);
    expect(manifestIds(list.body).filter(id => id === 'manifest-i-partial')).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('partial_visibility');
    const created = await request(baseUrl, 'POST', '/api/enterprise-scan/runs', token, { scan_manifest_id: 'manifest-i-partial', client_request_id: 'partial-post' });
    expect(created.status).toBe(201);
    expect(created.body.partial_visibility).toBe(true);
  });

  it('未知读取失败为 500 SCAN_STORE_FAILED，且不泄露清单', async () => {
    const db = getDatabase();
    db.prepare('ALTER TABLE scan_authorizations RENAME TO scan_authorizations_saved').run();
    try {
      const response = await request(baseUrl, 'GET', '/api/enterprise-scan/manifests', tokenFor('admin', 'admin-a'));
      expect(response.status).toBe(500);
      expect(response.body.code).toBe('SCAN_STORE_FAILED');
      expect(response.body).not.toHaveProperty('manifests');
    } finally {
      db.prepare('ALTER TABLE scan_authorizations_saved RENAME TO scan_authorizations').run();
    }
  });
});

describe('#1413 DevMode 自动 admin 与 renderer loader 真 socket 全链', () => {
  const saved = new Map<string, string | undefined>();
  let server: Server | undefined;
  let baseUrl = '';
  let devDatabase: Database.Database;
  let closeDevEngine: () => void = closeEngineContext;

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    const root = writeFixtureRoot();
    process.env.DEV_MODE = 'true';
    delete process.env.JWT_SECRET;
    process.env.CREDENTIAL_MASTER_KEY = 'synova-1413-dev-master-key-0123456789abcdef0123456789abcdef';
    process.env.SYNOVA_ORG_ID = 'org-dev';
    process.env.SYNOVA_DB_PATH = ':memory:';
    process.env.SYNOVA_DATA_DIR = root;
    process.env.PORT = '0';
    process.env.SYNOVA_SKIP_MCP = '1';
    vi.resetModules();
    const [{ createServer }, devContext] = await Promise.all([
      import('../../src/server'),
      import('../../src/init/engine-context'),
    ]);
    devDatabase = devContext.getDatabase;
    closeDevEngine = devContext.closeEngineContext;
    server = await createServer();
    baseUrl = addressOf(server);
    seedManifest(devDatabase(), { graph: 'org-dev', manifestId: 'manifest-dev', root });
  }, 90_000);

  afterAll(async () => {
    await closeServer(server, closeDevEngine);
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('无 seed／无自报身份头完成清单 GET→POST 201→replay 200→GET 报告', async () => {
    const list = await loadManifests({ base: baseUrl });
    expect(list).toEqual({ kind: 'manifests', items: [{ manifestId: 'manifest-dev', displayName: 'manifest-dev' }] });
    expect(devDatabase().prepare('SELECT COUNT(*) AS n FROM scan_runs').get()).toEqual({ n: 0 });

    const created = await startScan('manifest-dev', 'dev-request-1413', { base: baseUrl });
    expect(created.kind).toBe('report');
    if (created.kind !== 'report') throw new Error('DevMode POST 未返回报告');
    expect(created.replayed).toBe(false);
    expect(created.report.run.client_request_id).toBe('dev-request-1413');

    const replayed = await startScan('manifest-dev', 'dev-request-1413', { base: baseUrl });
    expect(replayed).toEqual({ kind: 'report', report: created.report, replayed: true });
    expect(devDatabase().prepare('SELECT COUNT(*) AS n FROM scan_runs').get()).toEqual({ n: 1 });

    const read = await getScan(created.report.run.run_id, { base: baseUrl });
    expect(read).toEqual({ kind: 'report', report: created.report, replayed: false });
  });
});
