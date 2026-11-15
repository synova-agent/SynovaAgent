/**
 * #1408 验收 T-1 / T-2 / T-3 / T-4 / T-6 / T-7 —— **真实身份链**（v7 §7）
 *
 * 判据形态：
 *   · 身份一律仓内真 `signJwtToken()` 签发，经真 `jwtAuthMiddleware` HMAC 验签；
 *   · 服务器一律真 `createServer()` + 真 socket（`fetch`），不直调 handler、不手搓 `req.auth`；
 *   · 授权形状按 v7 §7 T-2 表逐行种植（`seedAuthorizationManifest`，同 `variants.test.ts` 的 SQL 先例）。
 *
 * 每行判别：单来源 manifest ⇒ 可见 = 201 且报告含 1 个来源；不可见 = 403 `SCOPE_DENIED` 且零写入。
 * （单来源是**加强**而不是放宽：T-2 关心「该来源是否可见」，单来源下不存在被其他来源掩盖的可能。）
 *
 * 补充断言（**不在此文件**，属直接构造 `ScanViewer`）：T-2 #12b（ga 纵深防御）、未知角色/跨企业
 * 的 `canViewSource` 直接判据 ⇒ `tests/enterprise-scan/visibility.test.ts`，回执逐条点名。
 */
import type { Server } from 'http';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwtToken } from '../../src/middleware/auth';
import { closeEngineContext, getDatabase } from '../../src/init/engine-context';
import {
  authorityCounts,
  seedAuthorizationManifest,
  writeFixtureRoot,
  type SeedAuthorizationEntry,
} from '../enterprise-scan/fixtures';

const ENV_KEYS = ['DEV_MODE', 'JWT_SECRET', 'CREDENTIAL_MASTER_KEY', 'SYNOVA_ORG_ID', 'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'PORT', 'SYNOVA_SKIP_MCP'] as const;
const saved = new Map<string, string | undefined>();
const ORG = 'org-a';
const T1_MANIFEST = 'manifest-t1-roles';

let server: Server;
let baseUrl = '';
let root = '';

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

/** 真签身份（真 HMAC；`departmentIds` 随签名载荷下发）。 */
function tokenFor(role: string, sub: string, departmentIds?: readonly string[]): string {
  const token = signJwtToken({ sub, role, orgId: ORG, departmentIds });
  if (!token) throw new Error('JWT签发失败（JWT_SECRET 未就位）');
  return token;
}

/**
 * 用**真 JWT_SECRET** 手工签一枚「缺 role」的 token（合法签名、缺必需字段）。
 *
 * 用途：`JWT_SECRET` 是测试自己的密钥 ⇒ 这不是绕过验签，而是精确构造
 * 「外部输入缺 role」这一形状，验证 `auth.ts:262` 的必需字段检查在真实链上拒（401）。
 */
function signTokenWithoutRole(sub: string): string {
  const secret = process.env.JWT_SECRET ?? '';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub, orgId: ORG, iat: now, exp: now + 3600, jti: `no-role-${sub}-${now}` })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** T-2 单行夹具：三个授权字段全部钉死（允许旧词表原样落库）。 */
interface MatrixRow {
  id: string;
  role: 'admin' | 'manager' | 'liaison' | 'staff' | 'ga' | 'root';
  visibility: 'enterprise' | 'restricted';
  allowedUsers: readonly string[];
  allowedRoles: readonly string[];
  allowedDepartments: readonly string[];
  viewerSub: string;
  viewerDepartments?: readonly string[];
  expected: 'visible' | 'denied';
  /** 布尔四元组 (usersHit, deptHit, declared, roleInRoles)，n/a = declared=false 时不可达 */
  booleans: string;
}

/**
 * v7 §7 T-2 全表（21 行；第 9 行 `manager` 按 CTO 裁定 12680 展开为**布尔空间镜像**的 7 行，
 * 三字段实际值逐行写出、禁用「same as #N」继承写法）：
 *   · `#4/#5/#6/#6bis/#7` 的 `allowedRoles` 是相对 **staff** 写的 `['manager']`（不含 staff ⇒ 角色闸拒绝）；
 *     镜像到 manager 时 `staff`↔`manager` 互换 ⇒ `['staff']`（不含 manager ⇒ 同一语义）；
 *   · `#7bis` 相对 staff 写 `['staff']`（角色闸放行）⇒ 镜像 manager 时 `['manager']`；
 *   · `#5bis` 保持旧词表 `['responsible']`（解析成功 ⇒ declared=true，过滤后为空 ⇒ 角色闸拒绝）。
 */
const MATRIX: readonly MatrixRow[] = [
  // ── 企业级来源 ──────────────────────────────────────────────────────────────
  { id: '#1', role: 'admin', visibility: 'enterprise', allowedUsers: [], allowedRoles: [], allowedDepartments: [], viewerSub: 'admin-a', expected: 'visible', booleans: '(n/a,n/a,F,n/a)' },
  { id: '#3', role: 'staff', visibility: 'enterprise', allowedUsers: [], allowedRoles: [], allowedDepartments: [], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(n/a,n/a,F,n/a)' },
  { id: '#14', role: 'manager', visibility: 'enterprise', allowedUsers: [], allowedRoles: [], allowedDepartments: [], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(n/a,n/a,F,n/a)' },
  { id: '#15', role: 'liaison', visibility: 'enterprise', allowedUsers: [], allowedRoles: [], allowedDepartments: [], viewerSub: 'liaison-a', expected: 'visible', booleans: '(n/a,n/a,F,n/a)' },
  // ── restricted：admin（#2 不受三个字段约束，viewer 无部门）────────────────────
  { id: '#2', role: 'admin', visibility: 'restricted', allowedUsers: [], allowedRoles: ['manager'], allowedDepartments: ['dept-other'], viewerSub: 'admin-a', expected: 'visible', booleans: '(F,F,T,n/a·admin)' },
  // ── restricted：staff 8 格 ─────────────────────────────────────────────────
  { id: '#4', role: 'staff', visibility: 'restricted', allowedUsers: ['staff-a'], allowedRoles: [], allowedDepartments: ['dept-other'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,F,F,n/a)' },
  { id: '#5', role: 'staff', visibility: 'restricted', allowedUsers: [], allowedRoles: [], allowedDepartments: ['dept-a'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(F,T,F,n/a)' },
  { id: '#5bis', role: 'staff', visibility: 'restricted', allowedUsers: [], allowedRoles: ['responsible'], allowedDepartments: ['dept-a'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,T,T,F)' },
  { id: '#6', role: 'staff', visibility: 'restricted', allowedUsers: ['staff-a'], allowedRoles: ['manager'], allowedDepartments: ['dept-other'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,F,T,F)' },
  { id: '#6bis', role: 'staff', visibility: 'restricted', allowedUsers: ['staff-a'], allowedRoles: ['manager'], allowedDepartments: ['dept-a'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,T,T,F)' },
  { id: '#7', role: 'staff', visibility: 'restricted', allowedUsers: [], allowedRoles: ['manager'], allowedDepartments: ['dept-a'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,T,T,F)' },
  { id: '#7bis', role: 'staff', visibility: 'restricted', allowedUsers: [], allowedRoles: ['staff'], allowedDepartments: ['dept-a'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(F,T,T,T)' },
  { id: '#7ter', role: 'staff', visibility: 'restricted', allowedUsers: [], allowedRoles: ['staff'], allowedDepartments: ['dept-other'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,F,T,T)' },
  { id: '#8', role: 'staff', visibility: 'restricted', allowedUsers: [], allowedRoles: [], allowedDepartments: ['dept-other'], viewerSub: 'staff-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,F,F,n/a)' },
  // ── #9：manager 7 行（布尔空间镜像；三字段逐行写出，无继承写法）─────────────────
  //    镜像规则：users 的 staff-a → manager-a；roles 的 staff ↔ manager 互换；其余字段逐字一致。
  { id: '#9a(同#4)', role: 'manager', visibility: 'restricted', allowedUsers: ['manager-a'], allowedRoles: [], allowedDepartments: ['dept-other'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,F,F,n/a)' },
  { id: '#9b(同#5)', role: 'manager', visibility: 'restricted', allowedUsers: [], allowedRoles: [], allowedDepartments: ['dept-a'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(F,T,F,n/a)' },
  { id: '#9c(同#6)', role: 'manager', visibility: 'restricted', allowedUsers: ['manager-a'], allowedRoles: ['staff'], allowedDepartments: ['dept-other'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,F,T,F)' },
  { id: '#9d(同#6bis)', role: 'manager', visibility: 'restricted', allowedUsers: ['manager-a'], allowedRoles: ['staff'], allowedDepartments: ['dept-a'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,T,T,F)' },
  { id: '#9e(同#7)', role: 'manager', visibility: 'restricted', allowedUsers: [], allowedRoles: ['staff'], allowedDepartments: ['dept-a'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,T,T,F)' },
  { id: '#9f(同#7bis)', role: 'manager', visibility: 'restricted', allowedUsers: [], allowedRoles: ['manager'], allowedDepartments: ['dept-a'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(F,T,T,T)' },
  { id: '#9g(同#7ter)', role: 'manager', visibility: 'restricted', allowedUsers: [], allowedRoles: ['manager'], allowedDepartments: ['dept-other'], viewerSub: 'manager-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,F,T,T)' },
  // ── restricted：liaison 3 格 ───────────────────────────────────────────────
  { id: '#10', role: 'liaison', visibility: 'restricted', allowedUsers: ['liaison-a'], allowedRoles: ['manager'], allowedDepartments: ['dept-other'], viewerSub: 'liaison-a', viewerDepartments: ['dept-a'], expected: 'visible', booleans: '(T,F,T,n/a·liaison个人)' },
  { id: '#11', role: 'liaison', visibility: 'restricted', allowedUsers: [], allowedRoles: ['liaison'], allowedDepartments: ['dept-a'], viewerSub: 'liaison-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,T,T,T·liaison不认)' },
  { id: '#11bis', role: 'liaison', visibility: 'restricted', allowedUsers: [], allowedRoles: [], allowedDepartments: ['dept-a'], viewerSub: 'liaison-a', viewerDepartments: ['dept-a'], expected: 'denied', booleans: '(F,T,F,n/a·liaison不认)' },
  // ── ga / 未知（#12b 补充断言在 visibility.test.ts）──────────────────────────
  { id: '#12e', role: 'ga', visibility: 'enterprise', allowedUsers: ['ga-a'], allowedRoles: ['staff'], allowedDepartments: ['dept-a'], viewerSub: 'ga-a', expected: 'denied', booleans: '(n/a)' },
  { id: '#12r', role: 'ga', visibility: 'restricted', allowedUsers: ['ga-a'], allowedRoles: ['ga'], allowedDepartments: ['dept-a'], viewerSub: 'ga-a', expected: 'denied', booleans: '(n/a)' },
  { id: '#13', role: 'root', visibility: 'enterprise', allowedUsers: ['root-a'], allowedRoles: ['admin'], allowedDepartments: ['dept-a'], viewerSub: 'root-a', expected: 'denied', booleans: '(n/a)' },
];

function slug(id: string): string {
  return id.replace(/[#()·]/g, '').replace(/同/g, 'mirror-');
}

/**
 * 基线来源：`delivery_batches.csv`（企业级）。
 *
 * 为什么每行都要它：`buildScanModel` 的 `scanner.ts:368` 在「可见来源未形成任何②对象或断言」
 * 时抛 `SCHEMA_MAPPING_FAILED`（禁止空扫描成功）—— 单文件 manifest 里 md/json 只产生「断言」，
 * 对象来自 batches。故每行 = batches（对象供给）＋被测来源（可见性判据），
 * 「被测来源是否可见」由报告 `sources` 是否含其 `source_id` 判定（比 403 更精确）。
 */
const BASE_ENTRY: SeedAuthorizationEntry = {
  fileName: 'delivery_batches.csv',
  visibility: 'enterprise',
  allowedRoles: [],
  allowedUsers: [],
  allowedDepartments: [],
};

function entryFor(row: MatrixRow): SeedAuthorizationEntry {
  return {
    fileName: row.visibility === 'enterprise' ? 'delivery-policy.md' : 'operator-statement.json',
    visibility: row.visibility,
    allowedRoles: row.allowedRoles,
    allowedUsers: row.allowedUsers,
    allowedDepartments: row.allowedDepartments,
  };
}

function testedSourceId(manifestId: string, row: MatrixRow): string {
  return `${ORG}:${manifestId}:${entryFor(row).fileName}`;
}

beforeAll(async () => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  root = writeFixtureRoot();
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = 'synova-1408-role-secret-0123456789abcdef';
  process.env.CREDENTIAL_MASTER_KEY = 'synova-1408-master-key-0123456789abcdef0123456789abcdef';
  process.env.SYNOVA_ORG_ID = ORG;
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_DATA_DIR = root;
  process.env.PORT = '0';
  process.env.SYNOVA_SKIP_MCP = '1';
  const { createServer } = await import('../../src/server');
  server = await createServer();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('真实服务器未返回端口');
  baseUrl = `http://127.0.0.1:${address.port}`;
  // T-1：同一 manifest 内两条来源 —— enterprise（batches）+ restricted（statement）。
  // restricted 三种授权路径并存：liaison 走 allowedUsers、manager/staff 走 allowedDepartments、
  // admin 走全域旁路；batches 同时为模型提供②对象（见 BASE_ENTRY 说明）。
  seedAuthorizationManifest(getDatabase(), {
    manifestId: T1_MANIFEST,
    root,
    entries: [
      BASE_ENTRY,
      { fileName: 'operator-statement.json', visibility: 'restricted', allowedRoles: [], allowedUsers: ['liaison-a'], allowedDepartments: ['dept-delivery'] },
    ],
  });
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

describe('#1408 T-1 真实身份链 6×2（signJwtToken + createServer + 真实 HTTP）', () => {
  const identifiers = [
    { role: 'admin', sub: 'admin-a', departments: undefined },
    { role: 'manager', sub: 'manager-a', departments: ['dept-delivery'] },
    { role: 'liaison', sub: 'liaison-a', departments: [] as string[] },
    { role: 'staff', sub: 'staff-a', departments: ['dept-delivery'] },
    { role: 'ga', sub: 'ga-a', departments: undefined },
    { role: 'root', sub: 'root-a', departments: undefined },
  ] as const;

  it.each(identifiers)('$role × {enterprise, restricted}', async ({ role, sub, departments }) => {
    const token = tokenFor(role, sub, departments === undefined ? undefined : [...departments]);
    const before = authorityCounts(getDatabase());
    const response = await request('POST', '/api/enterprise-scan/runs', token, { scan_manifest_id: T1_MANIFEST, client_request_id: `t1-${role}` });

    if (role === 'admin' || role === 'manager' || role === 'liaison' || role === 'staff') {
      expect({ role, status: response.status }).toEqual({ role, status: 201 });
      const sources = response.body.sources as Array<{ source_id: string; visibility: string }> | undefined;
      expect(Array.isArray(sources)).toBe(true);
      // enterprise 格与 restricted 格分别断言（6×2 的 2）
      expect({ role, cell: 'enterprise', visible: (sources ?? []).some(s => s.visibility === 'enterprise') }).toEqual({ role, cell: 'enterprise', visible: true });
      expect({ role, cell: 'restricted', visible: (sources ?? []).some(s => s.visibility === 'restricted') }).toEqual({ role, cell: 'restricted', visible: true });
      expect((sources ?? []).length, '单一 manifest 两句来源必须都可下载').toBe(2);
      return;
    }

    // ga：固定 message；unknown：未知角色 message；两者均 403 + 零写入 ⇒ enterprise/restricted 两格都不可见
    expect({ role, status: response.status }).toEqual({ role, status: 403 });
    expect(response.body.code).toBe('SCOPE_DENIED');
    expect(response.body.message).toContain(role === 'ga' ? 'GA 本切片未接入来源级授权约束' : '未知角色');
    expect(response.body.sources, '拒绝响应不得携带任何来源（两格皆不可见）').toBeUndefined();
    expect(authorityCounts(getDatabase()), '拒绝路径必须零写入').toEqual(before);
  });
});

describe('#1408 T-2 矩阵逐格（真实 HTTP；21 行 / manager 镜像展开为 27 格）', () => {
  it.each(MATRIX)('T-2 $id $role × $visibility ⇒ $expected', async row => {
    const manifestId = `manifest-t2-${slug(row.id)}`;
    seedAuthorizationManifest(getDatabase(), { manifestId, root, entries: [BASE_ENTRY, entryFor(row)] });
    const before = authorityCounts(getDatabase());
    const testedId = testedSourceId(manifestId, row);
    const token = tokenFor(row.role, row.viewerSub, row.viewerDepartments);
    const response = await request('POST', '/api/enterprise-scan/runs', token, { scan_manifest_id: manifestId, client_request_id: `t2-${slug(row.id)}` });

    // #12 / #13：ga 与未知角色在 `toScanViewer` 就被拒 ⇒ 403 + 固定 message + **零写入**（两格皆不可见）
    if (row.role === 'ga' || row.role === 'root') {
      expect({ id: row.id, status: response.status }).toEqual({ id: row.id, status: 403 });
      expect({ id: row.id, code: response.body.code }).toEqual({ id: row.id, code: 'SCOPE_DENIED' });
      expect(String(response.body.message)).toContain(row.role === 'ga' ? 'GA 本切片未接入来源级授权约束' : '未知角色');
      expect({ id: row.id, sources: response.body.sources }).toEqual({ id: row.id, sources: undefined });
      expect(authorityCounts(getDatabase()), `T-2 ${row.id} 被拒路径零写入`).toEqual(before);
      return;
    }

    // 其余行：batches 对企业级角色恒可见 ⇒ 请求成功；被测来源是否可见由 sources 判定
    expect({ id: row.id, status: response.status }).toEqual({ id: row.id, status: 201 });
    const sourceIds = (response.body.sources as Array<{ source_id: string }>).map(item => item.source_id);
    const hasTested = sourceIds.includes(testedId);
    if (row.expected === 'visible') {
      expect({ id: row.id, partial: response.body.partial_visibility }).toEqual({ id: row.id, partial: false });
      expect({ id: row.id, testedSourceVisible: hasTested }).toEqual({ id: row.id, testedSourceVisible: true });
      expect({ id: row.id, sourceCount: sourceIds.length }).toEqual({ id: row.id, sourceCount: 2 });
      return;
    }
    expect({ id: row.id, partial: response.body.partial_visibility }).toEqual({ id: row.id, partial: true });
    expect({ id: row.id, testedSourceVisible: hasTested }).toEqual({ id: row.id, testedSourceVisible: false });
    expect({ id: row.id, sourceCount: sourceIds.length }).toEqual({ id: row.id, sourceCount: 1 });
  });
});

describe('#1408 T-3 未知／空／缺失角色（真实链拒绝 + 零写入）', () => {
  it('role="" 的真实签名 token ⇒ 401（auth.ts 必需字段检查先于路由）且零写入', async () => {
    const empty = signJwtToken({ sub: 'empty-role-a', role: '', orgId: ORG });
    expect(empty).toBeTruthy();
    const before = authorityCounts(getDatabase());
    const response = await request('POST', '/api/enterprise-scan/runs', String(empty), { scan_manifest_id: T1_MANIFEST, client_request_id: 't3-empty-role' });
    expect({ status: response.status, code: response.body.code }).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    expect(authorityCounts(getDatabase())).toEqual(before);
  });

  it('缺 role 字段的真实签名 token ⇒ 401 且零写入', async () => {
    const before = authorityCounts(getDatabase());
    const response = await request('POST', '/api/enterprise-scan/runs', signTokenWithoutRole('missing-role-a'), { scan_manifest_id: T1_MANIFEST, client_request_id: 't3-missing-role' });
    expect({ status: response.status, code: response.body.code }).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    expect(authorityCounts(getDatabase())).toEqual(before);
  });

  it('role="root"（非枚举、非空）⇒ 403 SCOPE_DENIED + 未知角色 + 零写入（真实链，矩阵 #13 的单点复述）', async () => {
    const token = tokenFor('root', 'root-t3', ['dept-a']);
    const before = authorityCounts(getDatabase());
    const response = await request('POST', '/api/enterprise-scan/runs', token, { scan_manifest_id: T1_MANIFEST, client_request_id: 't3-root' });
    expect({ status: response.status, code: response.body.code }).toEqual({ status: 403, code: 'SCOPE_DENIED' });
    expect(String(response.body.message)).toContain('未知角色');
    expect(authorityCounts(getDatabase())).toEqual(before);
  });
});

describe('#1408 T-4 跨企业（真实链 + 零写入）', () => {
  it('org-b 身份 POST org-a 清单 ⇒ 403 SCOPE_DENIED 零写入', async () => {
    const foreign = signJwtToken({ sub: 'foreign-admin', role: 'admin', orgId: 'org-b', departmentIds: [] });
    expect(foreign).toBeTruthy();
    const before = authorityCounts(getDatabase());
    const response = await request('POST', '/api/enterprise-scan/runs', String(foreign), { scan_manifest_id: T1_MANIFEST, client_request_id: 't4-cross-post' });
    expect({ status: response.status, code: response.body.code }).toEqual({ status: 403, code: 'SCOPE_DENIED' });
    expect(authorityCounts(getDatabase())).toEqual(before);
  });

  it('org-b 身份 GET org-a 运行 ⇒ 403 RUN_UNAVAILABLE', async () => {
    const ownerToken = tokenFor('admin', 'admin-t4', ['dept-delivery']);
    const created = await request('POST', '/api/enterprise-scan/runs', ownerToken, { scan_manifest_id: T1_MANIFEST, client_request_id: 't4-owner-run' });
    expect(created.status).toBe(201);
    const runId = (created.body.run as { run_id: string }).run_id;
    const foreign = signJwtToken({ sub: 'foreign-admin', role: 'admin', orgId: 'org-b' });
    const read = await request('GET', `/api/enterprise-scan/runs/${runId}`, String(foreign));
    expect({ status: read.status, code: read.body.code }).toEqual({ status: 403, code: 'RUN_UNAVAILABLE' });
  });
});

describe('#1408 T-6 缺失／空／不相关部门不命中（真实链）', () => {
  const cases = [
    { label: 'departmentIds=undefined', departments: undefined, allowedDepartments: ['dept-a'] },
    { label: 'departmentIds=[]', departments: [] as string[], allowedDepartments: ['dept-a'] },
    { label: 'departmentIds=[dept-other]（不相关）', departments: ['dept-other'], allowedDepartments: ['dept-a'] },
    { label: 'allowedDepartments=[]（来源侧空）', departments: ['dept-a'], allowedDepartments: [] as string[] },
  ];

  it.each(cases)('staff + $label ⇒ restricted 不可见', async testCase => {
    const manifestId = `manifest-t6-${testCase.label.replace(/[^a-z0-9]/gi, '')}`;
    seedAuthorizationManifest(getDatabase(), {
      manifestId,
      root,
      entries: [
        BASE_ENTRY,
        { fileName: 'operator-statement.json', visibility: 'restricted', allowedRoles: [], allowedUsers: [], allowedDepartments: testCase.allowedDepartments },
      ],
    });
    const token = tokenFor('staff', 'staff-t6', testCase.departments);
    const response = await request('POST', '/api/enterprise-scan/runs', token, { scan_manifest_id: manifestId, client_request_id: `t6-${manifestId}` });
    expect({ label: testCase.label, status: response.status }).toEqual({ label: testCase.label, status: 201 });
    expect({ label: testCase.label, partial: response.body.partial_visibility }).toEqual({ label: testCase.label, partial: true });
    const sourceIds = (response.body.sources as Array<{ source_id: string }>).map(item => item.source_id);
    expect({ label: testCase.label, sourceCount: sourceIds.length }).toEqual({ label: testCase.label, sourceCount: 1 });
    expect({ label: testCase.label, restrictedVisible: sourceIds.some(id => id.includes('operator-statement')) })
      .toEqual({ label: testCase.label, restrictedVisible: false });
  });
});
