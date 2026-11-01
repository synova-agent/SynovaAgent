/**
 * tests/security/org-source-http.test.ts — #1228 S0-2b · 自报租户点收口（PR-A 路由面）U-1／U-2／U-4
 *
 * 判据源：`.handbook/派单件/2026-10-31-规格-1228-S0-2b-自报租户点收口-v5.md` §3 U-1（14 行端点表）、
 *         §3 U-2（身份缺失，11 个白名单点）、§3 U-4（传导链已断）。
 *
 * 手法（铁律 0-2 / 铁律 12「不 mock 管线」）：
 *   真 `createServer()`（= 真 Bootstrap ＋ 真 app ＋ 真挂载顺序）＋ 真 HTTP（fetch）＋ 真 JWT（`signJwtToken`）。
 *   零 mock：不桩中间件、不桩 req/res —— 判据必须落在"被执行"上。
 *
 * 夹具口径（规格 §3 U-1 环境行）：
 *   `DEV_MODE=false` ＋ `JWT_SECRET=<≥16 字符>` ＋ `SYNOVA_ORG_ID='inst-org'` ＋ `SYNOVA_DB_PATH=':memory:'` ＋ `PORT=0`
 *
 * 契约（铁律 47）:
 *   @input  — 环境（上）＋ 请求（method/path/body/Bearer）；声明 orgId 出现在 body/query/path 三族
 *   @output — 声明 ≠ 来源 ⇒ 403 `CROSS_ORG_DENIED`（reason: `org_mismatch`｜`auth_org_missing`）；
 *             声明 = 来源（或无声明）⇒ 非 403（允许 200/201/400/404 业务前置）
 *   @degraded 无。拒绝路径带 code/reason 且服务端 `log.warn` 留痕；读路径**不**加 `degraded`（§〇.8-5）
 *
 * 铁律 38：零 `as any` / `as never` / `as unknown as`（请求/响应一律类型守卫窄化）。
 * 铁律 48：每条用例均有真断言（禁空壳）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

// ════════════════════════════════════════════════════════════════
// 夹具
// ════════════════════════════════════════════════════════════════

const ENV_KEYS = [
  'DEV_MODE', 'JWT_SECRET', 'CREDENTIAL_MASTER_KEY', 'SYNOVA_ORG_ID', 'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'PORT',
] as const;

/** 生产姿态签名密钥（≥16 字符，满足 getSecret() 有效性门槛） */
const SIGNING_SECRET = 'k1228-s0-2b-org-source-http-secret-0123456789';
const INST_ORG = 'inst-org';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const OTHER_ORG = 'other-org';

const RUN_TAG = `${Date.now()}-${process.pid}`;

let server: Server | undefined;
let baseUrl = '';
let tokenOrgA = '';
let tokenOrgB = '';
let tmpRoot = '';
const savedEnv = new Map<string, string | undefined>();

interface HttpResult {
  status: number;
  contentType: string;
  text: string;
  json: Record<string, unknown> | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function jsonOf(res: HttpResult): Record<string, unknown> {
  return res.json ?? {};
}

async function http(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) json = parsed;
  } catch {
    json = null; // HTML 路由（#7）不是 JSON —— 保留文本给 contentType/正文断言
  }
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', text, json };
}

/** 403 + `CROSS_ORG_DENIED`（U-1 逐行判据） */
function expectDenied(res: HttpResult): Record<string, unknown> {
  const body = jsonOf(res);
  expect(res.status).toBe(403);
  expect(body.ok).toBe(false);
  expect(body.code).toBe('CROSS_ORG_DENIED');
  return body;
}

/** 403 + reason='auth_org_missing'（U-2 身份缺失判据） */
function expectDeniedMissingIdentity(res: HttpResult): void {
  const body = expectDenied(res);
  expect(body.reason).toBe('auth_org_missing');
}

/** "非 403" 判据：允许 200/201/400/404（规格 U-1 明列的允许集） */
function expectNonForbidden(res: HttpResult): void {
  expect(res.status).not.toBe(403);
  expect([200, 201, 400, 404]).toContain(res.status);
}

interface GraphNodeView {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

function nodesOf(res: HttpResult): GraphNodeView[] {
  const body = jsonOf(res);
  if (!Array.isArray(body.nodes)) return [];
  const out: GraphNodeView[] = [];
  for (const raw of body.nodes) {
    if (!isRecord(raw)) continue;
    out.push({
      id: typeof raw.id === 'string' ? raw.id : '',
      type: typeof raw.type === 'string' ? raw.type : '',
      props: isRecord(raw.props) ? raw.props : {},
    });
  }
  return out;
}

function nodeCountOf(res: HttpResult): number {
  const value = jsonOf(res).nodeCount;
  return typeof value === 'number' ? value : -1;
}

function docsWithContent(res: HttpResult, needle: string): GraphNodeView[] {
  return nodesOf(res).filter(
    n => n.type === 'Document' && String(n.props.content ?? '').includes(needle),
  );
}

// ════════════════════════════════════════════════════════════════
// 启动真 server（生产姿态）＋ 签发两枚身份
// ════════════════════════════════════════════════════════════════

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  tmpRoot = mkdtempSync(join(tmpdir(), 'synova-1228-u1-'));
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = SIGNING_SECRET;
  // 生产姿态启动的 fail-closed 前置（resolveMasterSecret：非 devMode 必须有主密钥，否则 Phase 1 拒启）
  process.env.CREDENTIAL_MASTER_KEY = 'k1228-s0-2b-master-key-0123456789abcdef0123456789abcdef';
  process.env.SYNOVA_ORG_ID = INST_ORG;
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_DATA_DIR = tmpRoot;
  process.env.PORT = '0';

  // 环境设置之后再动态导入（server/config 在 createServer() 调用时读 env）
  const { createServer } = await import('../../src/server');
  const { signJwtToken } = await import('../../src/middleware/auth');

  server = await createServer();
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('[1228][ENV] server.address() 未返回端口对象');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  // 依赖单例按生产契约初始化：#10 的 chat 路由只认 `getProposalManager()` 无参单例
  // （`src/l2/proposal-manager.ts:169`；生产启动当前未初始化它属 pre-existing，另卡，不在本批写集）。
  // 不初始化 ⇒ 命中声明一致的正例会抛 unhandledRejection（触发 runtime 全局致命处理器 → 进程退出环）。
  const { getProposalManager } = await import('../../src/l2/proposal-manager');
  const { getDatabase } = await import('../../src/init/engine-context');
  getProposalManager(getDatabase());

  const a = signJwtToken({ sub: 'u-1-a', role: 'admin', orgId: ORG_A });
  const b = signJwtToken({ sub: 'u-1-b', role: 'admin', orgId: ORG_B });
  if (a === null || b === null) {
    throw new Error('[1228][ENV] signJwtToken 返回 null（JWT_SECRET 未生效）');
  }
  tokenOrgA = a;
  tokenOrgB = b;
});

afterAll(async () => {
  if (server) {
    const s = server;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  // 关库（m2 同款）：better-sqlite3 的 Statement 在环境析构期析构会触发 Node 24 原生 assert
  // （baseline 已实测的 `Statement::~Statement` abort）——显式关库把 statement 生命周期收在本进程内。
  try {
    const { closeEngineContext } = await import('../../src/init/engine-context');
    closeEngineContext();
  } catch {
    // 关库失败不掩盖断言结果（本文件已无 DB 依赖）
  }
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (tmpRoot !== '' && tmpRoot.startsWith(tmpdir())) rmSync(tmpRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════
// U-1 · 14 行端点表：身份 org-a ＋ 声明 org-b ⇒ 403；声明 org-a ⇒ 非 403
// ════════════════════════════════════════════════════════════════

describe('#1228 U-1 · 请求值不决定组织（14 行，真 HTTP）', () => {
  it('#1 POST /api/conversations（白名单前缀）', async () => {
    expectDenied(await http('POST', '/api/conversations', {
      token: tokenOrgA,
      body: { message: `/ingest U1-1 ${RUN_TAG}`, orgId: ORG_B },
    }));
    const matched = await http('POST', '/api/conversations', {
      token: tokenOrgA,
      body: { message: `/ingest U1-1 ${RUN_TAG}`, orgId: ORG_A },
    });
    expect(matched.status).toBe(200);
    expect(jsonOf(matched).ingested).toBe(true);
    // 正例副作用：落库组织 = 身份组织（org-a），不是声明之外的任何组织
    const read = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(read.status).toBe(200);
    expect(docsWithContent(read, `U1-1 ${RUN_TAG}`).length).toBeGreaterThanOrEqual(1);
  });

  it('#2 GET /api/sentinel/metrics/readings（白名单前缀）', async () => {
    expectDenied(await http('GET', `/api/sentinel/metrics/readings?orgId=${ORG_B}`, { token: tokenOrgA }));
    expectNonForbidden(await http('GET', `/api/sentinel/metrics/readings?orgId=${ORG_A}`, { token: tokenOrgA }));
  });

  it('#3 GET /api/sentinel/tickets/:id/decisions（白名单前缀）', async () => {
    expectDenied(await http('GET', `/api/sentinel/tickets/tk-u1/decisions?orgId=${ORG_B}`, { token: tokenOrgA }));
    // 归属闸先于工单查找 ⇒ 声明一致时才会走到 404 TICKET_NOT_FOUND（允许集内）
    expectNonForbidden(await http('GET', `/api/sentinel/tickets/tk-u1/decisions?orgId=${ORG_A}`, { token: tokenOrgA }));
  });

  it('#4 POST /api/sentinel/tickets/:id/transition（白名单前缀；写路径不得先改状态再拒）', async () => {
    expectDenied(await http('POST', '/api/sentinel/tickets/tk-u1/transition', {
      token: tokenOrgA,
      body: { to: 'acknowledged', orgId: ORG_B },
    }));
    const before = await http('GET', '/api/sentinel/tickets', { token: tokenOrgA });
    // 形状校验（to 非法 ⇒ 400）先于归属闸 —— 允许集内的正例
    expectNonForbidden(await http('POST', '/api/sentinel/tickets/tk-u1/transition', {
      token: tokenOrgA,
      body: { to: 'bogus', orgId: ORG_A },
    }));
    const after = await http('GET', '/api/sentinel/tickets', { token: tokenOrgA });
    // 被拒请求不得产生任何状态迁移副作用（列表前后逐字一致）
    expect(after.status).toBe(before.status);
    expect(jsonOf(after)).toEqual(jsonOf(before));
  });

  it('#5 POST /api/sessions（白名单前缀）', async () => {
    expectDenied(await http('POST', '/api/sessions', { token: tokenOrgA, body: { orgId: ORG_B } }));
    const matched = await http('POST', '/api/sessions', { token: tokenOrgA, body: { orgId: ORG_A } });
    expect(matched.status).toBe(201);
    const session = jsonOf(matched).session;
    expect(isRecord(session)).toBe(true);
    expect(isRecord(session) ? session.orgId : null).toBe(ORG_A);
  });

  it('#6 POST /api/ontology/ingest（白名单精确匹配；写路径不得先写再拒）', async () => {
    const before = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(before.status).toBe(200);
    const beforeCount = nodeCountOf(before);
    expectDenied(await http('POST', '/api/ontology/ingest', {
      token: tokenOrgA,
      body: { orgId: ORG_B, name: `U1-6-reject-${RUN_TAG}`, type: 'Document', content: '拒绝分支不得落库' },
    }));
    const afterDenied = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(nodeCountOf(afterDenied)).toBe(beforeCount); // 真库零新增
    const matched = await http('POST', '/api/ontology/ingest', {
      token: tokenOrgA,
      body: { orgId: ORG_A, name: `U1-6-ok-${RUN_TAG}`, type: 'Document', content: '正例落库' },
    });
    expectNonForbidden(matched);
    expect(matched.status).toBe(200);
    const afterOk = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(nodeCountOf(afterOk)).toBe(beforeCount + 1);
  });

  it('#7 GET /api/ontology/graph/:orgId.html（白名单前缀）', async () => {
    expectDenied(await http('GET', `/api/ontology/graph/${ORG_B}.html`, { token: tokenOrgA }));
    const matched = await http('GET', `/api/ontology/graph/${ORG_A}.html`, { token: tokenOrgA });
    expect(matched.status).toBe(200);
    expect(matched.contentType).toContain('text/html');
  });

  it('#8 GET /api/ontology/graph/:orgId（白名单前缀）', async () => {
    expectDenied(await http('GET', `/api/ontology/graph/${ORG_B}`, { token: tokenOrgA }));
    const matched = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(matched.status).toBe(200);
    // 响应形状回归（U-2 亦复用）：键集合固定，且读路径不出现 degraded
    expect(Object.keys(jsonOf(matched)).sort()).toEqual(
      ['edgeCount', 'edges', 'nodeCount', 'nodes', 'ok', 'orgId'],
    );
    expect('degraded' in jsonOf(matched)).toBe(false);
  });

  it('#9 GET /api/ontology/graph/:orgId/summary（白名单前缀）', async () => {
    expectDenied(await http('GET', `/api/ontology/graph/${ORG_B}/summary`, { token: tokenOrgA }));
    expectNonForbidden(await http('GET', `/api/ontology/graph/${ORG_A}/summary`, { token: tokenOrgA }));
  });

  it('#10 POST /api/proposal/:id/resolve（非白名单 ⇒ 身份在场才有判据）', async () => {
    expectDenied(await http('POST', '/api/proposal/p-u1/resolve', {
      token: tokenOrgA,
      body: { action: 'confirm', orgId: ORG_B },
    }));
    // 提案不存在的 404 在归属闸之后（允许集内；反例：闸放到 resolve 之后 ⇒ 此处 404 而非 403）
    expectNonForbidden(await http('POST', '/api/proposal/p-u1/resolve', {
      token: tokenOrgA,
      body: { action: 'confirm', orgId: ORG_A },
    }));
  });

  it('#11 POST /api/admin/knowledge/:id/mark-shareable（非白名单）', async () => {
    expectDenied(await http('POST', '/api/admin/knowledge/k-u1/mark-shareable', {
      token: tokenOrgA,
      body: { text: 'U1-11', orgId: ORG_B },
    }));
    const matched = await http('POST', '/api/admin/knowledge/k-u1/mark-shareable', {
      token: tokenOrgA,
      body: { text: 'U1-11', orgId: ORG_A },
    });
    expectNonForbidden(matched);
    expect(matched.status).toBe(201);
  });

  it('#12 POST /api/connector/sync（非白名单；服务器级 app 路由）', async () => {
    expectDenied(await http('POST', '/api/connector/sync', {
      token: tokenOrgA,
      body: { module: '__u1_probe__', orgId: ORG_B },
    }));
    // 管线内部 catch ⇒ 200 degraded（连接器不可用不阻断回执）；若实测 500/503 ⇒ 按规格停工规则停，回报
    expectNonForbidden(await http('POST', '/api/connector/sync', {
      token: tokenOrgA,
      body: { module: '__u1_probe__', orgId: ORG_A },
    }));
  });

  it('#13 GET /api/ontology/graph/:orgId/brokers（声明点，只上闸）', async () => {
    expectDenied(await http('GET', `/api/ontology/graph/${ORG_B}/brokers`, { token: tokenOrgA }));
    const matched = await http('GET', `/api/ontology/graph/${ORG_A}/brokers`, { token: tokenOrgA });
    expect(matched.status).toBe(200);
    expect(jsonOf(matched).ok).toBe(true);
  });

  it('#14 GET /api/ontology/graph/:orgId/diff（声明点，只上闸）', async () => {
    expectDenied(await http('GET', `/api/ontology/graph/${ORG_B}/diff`, { token: tokenOrgA }));
    const matched = await http('GET', `/api/ontology/graph/${ORG_A}/diff`, { token: tokenOrgA });
    expect(matched.status).toBe(200);
    expect(jsonOf(matched).ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// U-2 · 身份缺失（11 个白名单点 = 9 source ＋ 2 声明）
//   匿名 + 声明 other-org ⇒ 403 auth_org_missing；匿名 + 无声明/声明=inst-org ⇒ 非 403 且落账=inst-org
// ════════════════════════════════════════════════════════════════

describe('#1228 U-2 · 身份缺失（只覆盖 11 个白名单点）', () => {
  it('匿名 + 声明 other-org ⇒ 11 点全部 403 reason=auth_org_missing', async () => {
    // #1 body
    expectDeniedMissingIdentity(await http('POST', '/api/conversations', {
      body: { message: `/ingest U2-reject ${RUN_TAG}`, orgId: OTHER_ORG },
    }));
    // #2 / #3 query
    expectDeniedMissingIdentity(await http('GET', `/api/sentinel/metrics/readings?orgId=${OTHER_ORG}`));
    expectDeniedMissingIdentity(await http('GET', `/api/sentinel/tickets/tk-u2/decisions?orgId=${OTHER_ORG}`));
    // #4 body（to 合法 ⇒ 走到归属闸）
    expectDeniedMissingIdentity(await http('POST', '/api/sentinel/tickets/tk-u2/transition', {
      body: { to: 'acknowledged', orgId: OTHER_ORG },
    }));
    // #5 / #6 body
    expectDeniedMissingIdentity(await http('POST', '/api/sessions', { body: { orgId: OTHER_ORG } }));
    expectDeniedMissingIdentity(await http('POST', '/api/ontology/ingest', {
      body: { orgId: OTHER_ORG, name: `U2-reject-${RUN_TAG}`, type: 'Document', content: 'x' },
    }));
    // #7 / #8 / #9 / #13 / #14 path
    expectDeniedMissingIdentity(await http('GET', `/api/ontology/graph/${OTHER_ORG}.html`));
    expectDeniedMissingIdentity(await http('GET', `/api/ontology/graph/${OTHER_ORG}`));
    expectDeniedMissingIdentity(await http('GET', `/api/ontology/graph/${OTHER_ORG}/summary`));
    expectDeniedMissingIdentity(await http('GET', `/api/ontology/graph/${OTHER_ORG}/brokers`));
    expectDeniedMissingIdentity(await http('GET', `/api/ontology/graph/${OTHER_ORG}/diff`));
  });

  it('匿名 + 无声明/声明=inst-org ⇒ 写路径落账 = inst-org（回落实例配置不是降级）', async () => {
    // #1 对话 /ingest（无声明）
    const conv = await http('POST', '/api/conversations', {
      body: { message: `/ingest U2-instance ${RUN_TAG}` },
    });
    expectNonForbidden(conv);
    expect(conv.status).toBe(200);
    expect(jsonOf(conv).ingested).toBe(true);
    // #6 本体 ingest（orgId 必填 ⇒ 声明 = inst-org）
    const ingest = await http('POST', '/api/ontology/ingest', {
      body: { orgId: INST_ORG, name: `U2-instance-${RUN_TAG}`, type: 'Document', content: '实例组织写入' },
    });
    expectNonForbidden(ingest);
    expect(ingest.status).toBe(200);
    // #5 会话（orgId 必填 ⇒ 声明 = inst-org）
    const session = await http('POST', '/api/sessions', { body: { orgId: INST_ORG } });
    expectNonForbidden(session);
    expect(session.status).toBe(201);
    const sessionBody = jsonOf(session).session;
    expect(isRecord(sessionBody) ? sessionBody.orgId : null).toBe(INST_ORG);

    // 读回：匿名读实例组织 ⇒ 200，且两条写入都在 inst-org（不在 org-a/org-b）
    const read = await http('GET', `/api/ontology/graph/${INST_ORG}`);
    expect(read.status).toBe(200);
    expect(docsWithContent(read, `U2-instance ${RUN_TAG}`).length).toBeGreaterThanOrEqual(1);
    const byName = nodesOf(read).filter(
      n => n.type === 'Document' && String(n.props.name ?? '') === `U2-instance-${RUN_TAG}`,
    );
    expect(byName.length).toBe(1);
    // 形状回归：键集合与改前一致，且读路径没有 degraded
    expect(Object.keys(jsonOf(read)).sort()).toEqual(
      ['edgeCount', 'edges', 'nodeCount', 'nodes', 'ok', 'orgId'],
    );
    expect('degraded' in jsonOf(read)).toBe(false);
  });

  it('匿名 + 无声明 ⇒ 其余读路径/形状校验点非 403（不因"无身份"被误拦）', async () => {
    expectNonForbidden(await http('GET', '/api/sentinel/metrics/readings'));
    expectNonForbidden(await http('GET', '/api/sentinel/tickets/tk-u2/decisions'));
    expectNonForbidden(await http('POST', '/api/sentinel/tickets/tk-u2/transition', { body: { to: 'bogus' } }));
    expectNonForbidden(await http('GET', `/api/ontology/graph/${INST_ORG}.html`));
    expectNonForbidden(await http('GET', `/api/ontology/graph/${INST_ORG}/summary`));
    expectNonForbidden(await http('GET', `/api/ontology/graph/${INST_ORG}/brokers`));
    expectNonForbidden(await http('GET', `/api/ontology/graph/${INST_ORG}/diff`));
  });

  it('非白名单 3 点（#10/#11/#12）匿名 ⇒ 401（不测"身份缺失"的 403）', async () => {
    expect((await http('POST', '/api/proposal/p-u2/resolve', { body: { action: 'confirm', orgId: OTHER_ORG } })).status).toBe(401);
    expect((await http('POST', '/api/admin/knowledge/k-u2/mark-shareable', { body: { text: 'x', orgId: OTHER_ORG } })).status).toBe(401);
    expect((await http('POST', '/api/connector/sync', { body: { module: 'x', orgId: OTHER_ORG } })).status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// U-4 · 传导链已断：ConversationEngine 的 orgId 来自身份，不来自请求体
// ════════════════════════════════════════════════════════════════

describe('#1228 U-4 · 传导链已断（组织来自身份）', () => {
  it('身份 org-a + 声明 org-a 的 /ingest ⇒ 落 org-a，读回 Document（props.name 以 inge- 开头）', async () => {
    const ingest = await http('POST', '/api/conversations', {
      token: tokenOrgA,
      body: { message: `/ingest U4-A ${RUN_TAG}`, orgId: ORG_A },
    });
    expect(ingest.status).toBe(200);
    expect(jsonOf(ingest).ingested).toBe(true);

    const read = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(read.status).toBe(200);
    const docs = docsWithContent(read, `U4-A ${RUN_TAG}`);
    expect(docs.length).toBeGreaterThanOrEqual(1);
    const anchor = docs[0].props.name;
    expect(typeof anchor).toBe('string');
    expect(String(anchor)).toMatch(/^inge-/);
  });

  it('身份 org-b 抢声明 org-a ⇒ 403 且 org-a 图节点数不增加（跨租户写入不落地）', async () => {
    const before = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(before.status).toBe(200);
    const beforeCount = nodeCountOf(before);

    expectDenied(await http('POST', '/api/conversations', {
      token: tokenOrgB,
      body: { message: `/ingest U4-B ${RUN_TAG}`, orgId: ORG_A },
    }));

    const after = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(nodeCountOf(after)).toBe(beforeCount);
    expect(docsWithContent(after, `U4-B ${RUN_TAG}`).length).toBe(0);
  });

  it('身份 org-a + **无声明** ⇒ 落 org-a（不是实例组织 inst-org）——这是"来自身份"的强判据', async () => {
    const ingest = await http('POST', '/api/conversations', {
      token: tokenOrgA,
      body: { message: `/ingest U4-nodecl ${RUN_TAG}` },
    });
    expect(ingest.status).toBe(200);
    expect(jsonOf(ingest).ingested).toBe(true);

    // 身份组织 org-a 里能读到
    const readA = await http('GET', `/api/ontology/graph/${ORG_A}`, { token: tokenOrgA });
    expect(docsWithContent(readA, `U4-nodecl ${RUN_TAG}`).length).toBeGreaterThanOrEqual(1);
    // 实例组织 inst-org 里读不到（改前：请求无声明 ⇒ 回落 env=inst-org；本件证明已改成"身份优先"）
    const readInst = await http('GET', `/api/ontology/graph/${INST_ORG}`);
    expect(readInst.status).toBe(200);
    expect(docsWithContent(readInst, `U4-nodecl ${RUN_TAG}`).length).toBe(0);
  });
});
