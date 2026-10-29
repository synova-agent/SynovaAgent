/**
 * tests/routes/role-approvals.test.ts — #1075 P3 审批 API ＋ 说明书页 ＋ 审批会话卡（真 HTTP）
 *
 * 断言对象 = **真实路由**（`src/routes/role-approvals.ts`／`src/routes/role-packs-page.ts`／
 *   `src/routes/conversations.ts` 的审批会话分支）：真 `express()` ＋ `listen(0)` ＋ `fetch` ＋
 *   真 `jwtAuthMiddleware`/`signJwtToken` ＋ 真 better-sqlite3 `:memory:` 审计（经 `AuditService`）＋
 *   真文件系统（临时内容根；**禁写真仓 `.synova/` 与 `data/`**）。铁律 12：集成测试走真实路由，不 mock 管线。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J1 身份与 org（401／403／白名单角色／org 不符）
 *   J2 批准落库＋审计＋即时生效（自绑定 approvalId 独立复算／0600 不在此断言（T1 已钉）／D9 unchanged 不新增审计）
 *   J3 冲突/出厂/穿越/不存在/scope/action/开关（每例断言**零写入零审计**或明确码）
 *   J4 撤销与幂等（记录删除＋usable 即时不含＋审计 1 条＋再撤 404）
 *   J5 scope 变更（同 hash ⇒ scope_changed 审计；权限待批标志翻转）
 *   J6 审计链＋详情 API（六件名齐／状态/scope/hash/permissionsPending／审计历史；篡改记录 ⇒ unverified）
 *   J7 审批会话卡（SSE open→approval_card→end；无 agent_message；互斥/无身份/越权/不存在）
 *   J8 说明书页壳（无 token 200＋锚点＋**不含夹具 roleId**；数据 API 无 token 401；server.ts 挂载顺序）
 *
 * 🔴 隔离手法（不落仓）：`mkdtempSync` 造**仓库形状**临时根 ——
 *   `<tmp>/extensions/presets/roles/qa-1075/` 六件（由真实包 `finance` 拷贝后把 `finance` 全文替换成
 *   `qa-1075` ⇒ 角色身份、scope id、refs 名、context source 路径一处改名、四处自洽）＋
 *   `<tmp>/extensions/ontology/outcome/financial.json`（`manifest.refs` 的 `kind:file` 目标）。
 *   `approvalsRoot = resolveApprovalsRoot(<tmp>/extensions/presets)` ＝ `<tmp>/.synova/approvals`。
 *
 * 环境前提：`DEV_MODE=false` ＋ `JWT_SECRET` 定值 ＋ `SYNOVA_ORG_ID` 定值（否则白名单分支自动 admin／
 *   org 单源不可判）。每个用例重置审计库（`:memory:` 新库 ＋ `AuditService.init`）与审批记录文件 ⇒ 计数可精确断言。
 *
 * @degraded 本文件不断言日志文案；降级面用"HTTP 码＋响应字段＋文件系统事实"判（可核）。
 * @authority 判据归属 #1075 P3（规格 §4 J1–J8）。
 *
 * 已知限制：
 *   ① 不证真实 LLM（审批会话分支按 D1 不跑 LLM；无 agent_message 即证据）。
 *   ② 不证签名/抗伪造（§10-L2：审计链只证事件序）——本文件只证"链在批准/撤销后 valid"。
 *   ③ 不测 Windows 文件权限位（0600 由 T1 单测覆盖；此处不做平台相关断言）。
 *   ④ body 16 KiB 上限只测"超限 413"；不测 express 全局 10mb 解析行为（不在本批写集）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { Socket } from 'net';
import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';
import { loadRolePacks, resolveApprovalsRoot } from '../../src/init/preset-loader';
import { AuditService } from '../../src/services/audit-service';

// ── logger 静音（不改变被测行为；本文件不断言日志文案）──
vi.mock('@synova/logger', () => {
  const make = () => () => undefined;
  const m = { info: make(), warn: make(), error: make(), debug: make() };
  return { logger: m, createLogger: () => m };
});

// ══════════════════════════════════════════════════════════════════════════════
// 夹具常量
// ══════════════════════════════════════════════════════════════════════════════

const REPO_ROOT = process.cwd();
/** 基线模板包（真实包拷过来改名 ⇒ 比手写六件更容易过 v3 结构 ＋ refs 三方对账） */
const TEMPLATE_ROLE_DIR = join(REPO_ROOT, 'extensions', 'presets', 'roles', 'finance');
/** `manifest.refs` 里 `kind:file` 的目标（路径相对仓库根；夹具里放在临时根的同名位置） */
const TEMPLATE_FILE_REF = join(REPO_ROOT, 'extensions', 'ontology', 'outcome', 'financial.json');

const ORG = 'org-p3-approvals';
const JWT_SECRET_VALUE = 'p3-role-approvals-secret-0123456789abcdef';
/** 夹具岗位（**非出厂**：出厂三包只信代码锚） */
const ROLE = 'qa-1075';
const FACTORY_ROLE = 'finance';
const GHOST_ROLE = 'ghost-role';
/** 三角色各一次（J1-4） */
const ALLOWED_ROLES = ['admin', 'manager', 'ga'] as const;

const AUDIT_APPROVED = 'role_pack.approved';
const AUDIT_REVOKED = 'role_pack.revoked';
const AUDIT_SCOPE_CHANGED = 'role_pack.scope_changed';

let fixtureRoot = '';
let presetsRoot = '';
let server: Server;
let baseUrl = '';
let sockets: Socket[] = [];

type AuthModule = typeof import('../../src/middleware/auth');
let auth: AuthModule;

const ORIGINAL_ENV: Readonly<Record<string, string | undefined>> = {
  DEV_MODE: process.env['DEV_MODE'],
  JWT_SECRET: process.env['JWT_SECRET'],
  SYNOVA_ORG_ID: process.env['SYNOVA_ORG_ID'],
  SYNOVA_PRESETS_ROOT: process.env['SYNOVA_PRESETS_ROOT'],
  SYNOVA_APPROVAL_WRITE: process.env['SYNOVA_APPROVAL_WRITE'],
};

// ══════════════════════════════════════════════════════════════════════════════
// 夹具构造（临时根；禁写真仓）
// ══════════════════════════════════════════════════════════════════════════════

function approvalsRootOf(): string {
  return resolveApprovalsRoot(presetsRoot);
}

function approvalPathOf(roleId: string): string {
  return join(approvalsRootOf(), `${roleId}.json`);
}

/** 六件内容指纹（夹具审批记录/期望 hash；与生产同一纯核函数，raw bytes 语义） */
function contentHashOf(roleId: string): string {
  const roleDir = join(presetsRoot, 'roles', roleId);
  return computeRolePackContentHash(
    ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(roleDir, name)) })),
  );
}

/**
 * `apv1:` 自绑定的**测试侧独立实现**（不调生产私有函数）：
 * `'apv1:' + sha256(orgId|roleId|contentHash|scope|approvedAt|approverId|approverRole)[0:16]`。
 */
function approvalDigest(fields: {
  readonly roleId: string;
  readonly orgId: string;
  readonly contentHash: string;
  readonly scope: string;
  readonly approvedAt: string;
  readonly approverId: string;
  readonly approverRole: string;
}): string {
  const material = [
    fields.orgId,
    fields.roleId,
    fields.contentHash,
    fields.scope,
    fields.approvedAt,
    fields.approverId,
    fields.approverRole,
  ].join('|');
  return `apv1:${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)}`;
}

/** 造夹具岗位包：拷模板 → 六件全文把 `finance` 换成夹具 roleId（身份/scope/refs 一处改名、四处自洽）。 */
function buildFixtureRolePack(roleId: string): void {
  const target = join(presetsRoot, 'roles', roleId);
  cpSync(TEMPLATE_ROLE_DIR, target, { recursive: true });
  for (const name of ROLE_PACK_PIECES) {
    const file = join(target, name);
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.split('finance').join(roleId), 'utf8');
  }
}

function clearApprovalRecord(roleId: string): void {
  rmSync(approvalPathOf(roleId), { force: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP / SSE helpers（真 fetch；Bearer 可选）
// ══════════════════════════════════════════════════════════════════════════════

interface JsonResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function tokenFor(role: string, orgId: string = ORG): string {
  const signed = auth.signJwtToken({ sub: `${role}-p3`, role, orgId });
  expect(signed, `夹具失败：${role} token 签发返回 null（JWT_SECRET 未生效？）`).not.toBeNull();
  return signed ?? '';
}

function bearer(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

async function getJson(path: string, token?: string): Promise<JsonResult> {
  const res = await fetch(`${baseUrl}${path}`, { headers: bearer(token) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function postApproval(
  roleId: string,
  payload: Record<string, unknown>,
  token?: string,
): Promise<JsonResult> {
  const res = await fetch(`${baseUrl}/api/role-packs/${roleId}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * 原始 path 的 JSON 请求（`node:http`，不经 WHATWG URL 归一）。
 *
 * 🔴 为什么需要：`fetch()` 的 URL 解析会先把 `%2E%2E` 归一成路径段消解（`..`），
 *   请求到不了服务端 —— 那样测的是"客户端规范化"，不是"服务端穿越守卫"。
 *   本 helper 直接把原始 path 交给 HTTP 请求行，服务端才真正收到 `%2E%2E`。
 */
function rawJson(
  method: string,
  rawPath: string,
  token?: string,
  payload?: unknown,
): Promise<JsonResult> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(baseUrl);
    const headers: Record<string, string> = {};
    if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
    let bodyText = '';
    if (payload !== undefined) {
      bodyText = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(bodyText, 'utf8'));
    }
    const req = httpRequest(
      { host: parsedUrl.hostname, port: parsedUrl.port, method, path: rawPath, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          let body: Record<string, unknown> = {};
          try {
            body = data === '' ? {} : (JSON.parse(data) as Record<string, unknown>);
          } catch (err) {
            body = { __raw: data, __parseError: String(err) };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (bodyText !== '') req.write(bodyText);
    req.end();
  });
}

async function postConversation(payload: Record<string, unknown>, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify(payload),
  });
}

interface SseFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.includes('data: '))
    .map((block) => {
      const lines = block.split('\n');
      const event = (lines.find((line) => line.startsWith('event: ')) ?? '').replace('event: ', '').trim();
      const dataLine = lines.find((line) => line.startsWith('data: ')) ?? '';
      return { event, data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown> };
    });
}

function waitListening(srv: Server): Promise<string> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const addr = srv.address();
      if (addr && typeof addr !== 'string') {
        clearInterval(timer);
        resolve(`http://localhost:${addr.port}`);
      }
    }, 10);
  });
}

function trackConnections(srv: Server): void {
  srv.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('close', () => {
      sockets = sockets.filter((item) => item !== socket);
    });
  });
}

/** 列表里取某岗位（找不到 = 夹具/路由缺陷 ⇒ 直接非空断言失败） */
function packRow(body: Record<string, unknown>, roleId: string): Record<string, unknown> {
  const rows = body['rolePacks'];
  expect(Array.isArray(rows), '列表响应缺 rolePacks 数组').toBe(true);
  const found = (rows as Record<string, unknown>[]).find((row) => row['roleId'] === roleId);
  expect(found, `列表里找不到 ${roleId}`).toBeDefined();
  return found ?? {};
}

async function approveForTest(scope: 'content' | 'content+permissions' = 'content'): Promise<void> {
  const res = await postApproval(
    ROLE,
    { action: 'approve', scope, expectedContentHash: contentHashOf(ROLE) },
    tokenFor('admin'),
  );
  expect(res.status, `夹具审批失败：${JSON.stringify(res.body)}`).toBe(200);
}

// ══════════════════════════════════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // 生产态鉴权语义：DEV_MODE=false ＋ JWT_SECRET ＋ 实例 org（org 单源 = loadConfig().orgId）
  process.env['DEV_MODE'] = 'false';
  process.env['JWT_SECRET'] = JWT_SECRET_VALUE;
  process.env['SYNOVA_ORG_ID'] = ORG;

  // 夹具临时根（仓库形状；repoRoot = <tmp> ⇒ approvalsRoot = <tmp>/.synova/approvals）
  fixtureRoot = mkdtempSync(join(tmpdir(), 'p3-role-approvals-'));
  presetsRoot = join(fixtureRoot, 'extensions', 'presets');
  mkdirSync(join(presetsRoot, 'roles'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'extensions', 'ontology', 'outcome'), { recursive: true });
  cpSync(TEMPLATE_FILE_REF, join(fixtureRoot, 'extensions', 'ontology', 'outcome', 'financial.json'));
  buildFixtureRolePack(ROLE);
  process.env['SYNOVA_PRESETS_ROOT'] = presetsRoot;

  auth = await import('../../src/middleware/auth');
  const pageRouter = (await import('../../src/routes/role-packs-page')).default;
  const approvalRouter = (await import('../../src/routes/role-approvals')).default;
  const conversationsRouter = (await import('../../src/routes/conversations')).default;

  // 挂载顺序**镜像 src/server.ts**：页面壳先于 JWT、审批 API 后于 JWT（J8-3 单测另行钉死源文件顺序）
  const app = express();
  app.use(express.json());
  app.use(pageRouter);
  app.use(auth.jwtAuthMiddleware);
  app.use(approvalRouter);
  app.use(conversationsRouter);
  server = app.listen(0);
  trackConnections(server);
  baseUrl = await waitListening(server);
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  if (fixtureRoot !== '') rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // 每个用例：零审批记录 ＋ 全新审计库（:memory:）⇒ 计数/链断言可精确
  clearApprovalRecord(ROLE);
  clearApprovalRecord(FACTORY_ROLE);
  delete process.env['SYNOVA_APPROVAL_WRITE'];
  AuditService.resetInstance();
  AuditService.init(new Database(':memory:'));
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 · 身份与 org
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 身份与 org', () => {
  it('J1-1 无 Bearer ⇒ 401（/api/role-packs 不在 auth 白名单）', async () => {
    const res = await getJson('/api/role-packs');
    expect(res.status).toBe(401);
    expect(res.body['code']).toBe('UNAUTHORIZED');
  });

  it('J1-2 staff ⇒ 403（审批角色白名单）', async () => {
    const res = await getJson('/api/role-packs', tokenFor('staff'));
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('E_APPROVAL_ROLE_FORBIDDEN');
  });

  it('J1-3 liaison ⇒ 403', async () => {
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: contentHashOf(ROLE) },
      tokenFor('liaison'),
    );
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('E_APPROVAL_ROLE_FORBIDDEN');
  });

  it('J1-4 admin／manager／ga ⇒ 200（三角色各一次）', async () => {
    for (const role of ALLOWED_ROLES) {
      const res = await getJson('/api/role-packs', tokenFor(role));
      expect(res.status, `角色 ${role} 应可读列表`).toBe(200);
      expect(res.body['ok']).toBe(true);
      expect(res.body['orgId']).toBe(ORG);
    }
  });

  it('J1-5 身份 org ≠ SYNOVA_ORG_ID ⇒ 403 E_APPROVAL_ORG_MISMATCH（记录 org 单源）', async () => {
    const res = await getJson('/api/role-packs', tokenFor('admin', 'other-org'));
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('E_APPROVAL_ORG_MISMATCH');
    expect(JSON.stringify(res.body)).toContain('other-org');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · 批准落库 ＋ 审计 ＋ 即时生效
// ══════════════════════════════════════════════════════════════════════════════

describe('J2 批准落库＋审计＋即时生效', () => {
  it('J2-1 合法包＋正确 hash ⇒ 200／记录自绑定 approvalId／审计 1 条／usable 即时含', async () => {
    const hash = contentHashOf(ROLE);
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: hash },
      tokenFor('admin'),
    );

    expect(res.status).toBe(200);
    expect(res.body['ok']).toBe(true);
    expect(res.body['result']).toBe('approved');
    expect(res.body['unchanged']).toBe(false);
    expect(res.body['auditAction']).toBe(AUDIT_APPROVED);

    // ① 记录字段（§2.3-C）
    const record = res.body['record'] as Record<string, unknown>;
    expect(record['schemaVersion']).toBe(1);
    expect(record['roleId']).toBe(ROLE);
    expect(record['orgId']).toBe(ORG);
    expect(record['contentHash']).toBe(hash);
    expect(record['scope']).toBe('content');
    expect(record['approverId']).toBe('admin-p3');
    expect(record['approverRole']).toBe('admin');
    expect(typeof record['approvedAt']).toBe('string');

    // ② approvalId 自绑定：本文件独立复算（生产写错 ⇒ 此处必红）
    expect(record['approvalId']).toBe(
      approvalDigest({
        roleId: ROLE,
        orgId: ORG,
        contentHash: hash,
        scope: 'content',
        approvedAt: String(record['approvedAt']),
        approverId: 'admin-p3',
        approverRole: 'admin',
      }),
    );

    // ③ 文件真落盘（写模块原子写的结果）
    expect(existsSync(approvalPathOf(ROLE))).toBe(true);
    const onDisk = JSON.parse(readFileSync(approvalPathOf(ROLE), 'utf8')) as Record<string, unknown>;
    expect(onDisk['approvalId']).toBe(record['approvalId']);

    // ④ 审计：恰好 1 条，且只写 hash/scope/approvalId（禁六件正文）
    const entries = AuditService.query(ORG, { action: AUDIT_APPROVED });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetType).toBe('role_pack');
    expect(entries[0]?.targetId).toBe(ROLE);
    expect(entries[0]?.actorId).toBe('admin-p3');
    expect(entries[0]?.oldValue ?? null).toBeNull();
    expect(JSON.parse(entries[0]?.newValue ?? '{}')).toEqual({
      contentHash: hash,
      scope: 'content',
      approvalId: record['approvalId'],
    });

    // ⑤ 即时生效：写后重新装载 ⇒ usable 含 roleId；接口返回的 approval 也是 approved
    expect(loadRolePacks().usable).toContain(ROLE);
    const approval = res.body['approval'] as Record<string, unknown>;
    expect(approval['status']).toBe('approved');
    expect(approval['scope']).toBe('content');
    expect(approval['approvalId']).toBe(record['approvalId']);

    // ⑥ 链在写入后仍有效
    const chain = res.body['chain'] as Record<string, unknown>;
    expect(chain['valid']).toBe(true);
    expect(chain['totalRecords']).toBe(1);
  });

  it('J2-2 同 hash 同 scope 再批 ⇒ 200 {unchanged:true} 且审计不新增（D9）', async () => {
    await approveForTest('content');
    const before = AuditService.query(ORG, {}).length;
    expect(before).toBe(1);

    const again = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: contentHashOf(ROLE) },
      tokenFor('admin'),
    );
    expect(again.status).toBe(200);
    expect(again.body['unchanged']).toBe(true);
    expect(again.body['result']).toBe('unchanged');
    expect(again.body['auditAction']).toBeNull();
    expect(AuditService.query(ORG, {}).length).toBe(before);
  });

  it('J2-3 scope=content 且包声明 tools ⇒ permissionsPending:true（列表/详情/响应三面一致）', async () => {
    await approveForTest('content');

    const list = await getJson('/api/role-packs', tokenFor('admin'));
    expect(list.status).toBe(200);
    const row = packRow(list.body, ROLE);
    expect(row['status']).toBe('approved');
    expect(row['permissionsPending']).toBe(true);
    expect(row['usable']).toBe(true);
    expect(row['contentHash']).toBe(contentHashOf(ROLE));

    const detail = await getJson(`/api/role-packs/${ROLE}`, tokenFor('admin'));
    expect(detail.status).toBe(200);
    expect(detail.body['permissionsPending']).toBe(true);
    expect(detail.body['status']).toBe('approved');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 · 冲突／出厂／穿越／不存在／scope／开关
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 冲突／出厂／穿越／不存在／scope／开关', () => {
  it('J3-1 指纹不符 ⇒ 409 且零写入零审计', async () => {
    const wrongHash = 'a'.repeat(64);
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: wrongHash },
      tokenFor('admin'),
    );
    expect(res.status).toBe(409);
    expect(res.body['code']).toBe('E_APPROVAL_CONTENT_CHANGED');
    expect(existsSync(approvalPathOf(ROLE))).toBe(false);
    expect(AuditService.query(ORG, {}).length).toBe(0);
  });

  it('J3-2 出厂三包（finance）⇒ 403 E_APPROVAL_FACTORY_LOCKED 且零写入', async () => {
    const res = await postApproval(
      FACTORY_ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: contentHashOf(ROLE) },
      tokenFor('admin'),
    );
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('E_APPROVAL_FACTORY_LOCKED');
    expect(existsSync(approvalPathOf(FACTORY_ROLE))).toBe(false);
    expect(AuditService.query(ORG, {}).length).toBe(0);
  });

  it('J3-3 roleId 穿越/形状非法 ⇒ 400（详情与写面都拒；原始 path 直达服务端）', async () => {
    // %2E%2E ⇒ 服务端解码为 '..'（fetch 会在客户端把该段消解掉，故必须用原始 path）
    const detailDotDot = await rawJson('GET', '/api/role-packs/%2E%2E', tokenFor('admin'));
    expect(detailDotDot.status).toBe(400);
    expect(detailDotDot.body['code']).toBe('E_APPROVAL_ROLE_ID_INVALID');

    // 'a%2Fb' ⇒ 解码后含路径分隔符
    const detailSlash = await rawJson('GET', '/api/role-packs/a%2Fb', tokenFor('admin'));
    expect(detailSlash.status).toBe(400);
    expect(detailSlash.body['code']).toBe('E_APPROVAL_ROLE_ID_INVALID');

    const writeSlash = await rawJson(
      'POST',
      '/api/role-packs/a%2Fb/approval',
      tokenFor('admin'),
      { action: 'approve', scope: 'content', expectedContentHash: contentHashOf(ROLE) },
    );
    expect(writeSlash.status).toBe(400);
    expect(writeSlash.body['code']).toBe('E_APPROVAL_ROLE_ID_INVALID');
    expect(AuditService.query(ORG, {}).length).toBe(0);
  });

  it('J3-4 包不存在 ⇒ 404 E_APPROVAL_ROLE_NOT_FOUND（详情与批准）', async () => {
    const detail = await getJson(`/api/role-packs/${GHOST_ROLE}`, tokenFor('admin'));
    expect(detail.status).toBe(404);
    expect(detail.body['code']).toBe('E_APPROVAL_ROLE_NOT_FOUND');

    const write = await postApproval(
      GHOST_ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: 'b'.repeat(64) },
      tokenFor('admin'),
    );
    expect(write.status).toBe(404);
    expect(write.body['code']).toBe('E_APPROVAL_ROLE_NOT_FOUND');
    expect(AuditService.query(ORG, {}).length).toBe(0);
  });

  it('J3-5 scope 非法 ⇒ 422 E_APPROVAL_SCOPE_INVALID 且零写入', async () => {
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'all', expectedContentHash: contentHashOf(ROLE) },
      tokenFor('admin'),
    );
    expect(res.status).toBe(422);
    expect(res.body['code']).toBe('E_APPROVAL_SCOPE_INVALID');
    expect(existsSync(approvalPathOf(ROLE))).toBe(false);
    expect(AuditService.query(ORG, {}).length).toBe(0);
  });

  it('J3-6 action 非法 ⇒ 400 E_APPROVAL_ACTION_INVALID', async () => {
    const res = await postApproval(ROLE, { action: 'reset' }, tokenFor('admin'));
    expect(res.status).toBe(400);
    expect(res.body['code']).toBe('E_APPROVAL_ACTION_INVALID');
  });

  it('J3-7 body 超 16 KiB ⇒ 413 E_APPROVAL_BODY_TOO_LARGE（§2.2-D11）', async () => {
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: contentHashOf(ROLE), padding: 'x'.repeat(17 * 1024) },
      tokenFor('admin'),
    );
    expect(res.status).toBe(413);
    expect(res.body['code']).toBe('E_APPROVAL_BODY_TOO_LARGE');
    expect(AuditService.query(ORG, {}).length).toBe(0);
  });

  it('J3-8 SYNOVA_APPROVAL_WRITE=off ⇒ POST 503，读面不受影响（D10）', async () => {
    process.env['SYNOVA_APPROVAL_WRITE'] = 'off';
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: contentHashOf(ROLE) },
      tokenFor('admin'),
    );
    expect(res.status).toBe(503);
    expect(res.body['code']).toBe('E_APPROVAL_WRITE_DISABLED');
    expect(existsSync(approvalPathOf(ROLE))).toBe(false);

    const list = await getJson('/api/role-packs', tokenFor('admin'));
    expect(list.status).toBe(200);
    const detail = await getJson(`/api/role-packs/${ROLE}`, tokenFor('admin'));
    expect(detail.status).toBe(200);
    delete process.env['SYNOVA_APPROVAL_WRITE'];
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 · 撤销与幂等
// ══════════════════════════════════════════════════════════════════════════════

describe('J4 撤销与幂等', () => {
  it('J4-1 已批 ⇒ revoke 200／记录删除／usable 即时不含／审计 1 条', async () => {
    await approveForTest('content');
    expect(existsSync(approvalPathOf(ROLE))).toBe(true);

    const revoked = await postApproval(ROLE, { action: 'revoke' }, tokenFor('manager'));
    expect(revoked.status).toBe(200);
    expect(revoked.body['result']).toBe('revoked');
    expect(revoked.body['auditAction']).toBe(AUDIT_REVOKED);

    // ① 记录文件已删
    expect(existsSync(approvalPathOf(ROLE))).toBe(false);

    // ② 即时失效
    expect(loadRolePacks().usable).not.toContain(ROLE);
    const list = await getJson('/api/role-packs', tokenFor('admin'));
    const row = packRow(list.body, ROLE);
    expect(row['status']).toBe('pending');
    expect(row['usable']).toBe(false);

    // ③ 审计 revoked 恰好 1 条（批准那条**不删** ⇒ 事件序保留）
    const revokedEntries = AuditService.query(ORG, { action: AUDIT_REVOKED });
    expect(revokedEntries).toHaveLength(1);
    expect(revokedEntries[0]?.actorId).toBe('manager-p3');
    const revokedOldValue = JSON.parse(revokedEntries[0]?.oldValue ?? '{}') as Record<string, unknown>;
    expect(revokedOldValue['contentHash']).toBe(contentHashOf(ROLE));
    expect(revokedOldValue['scope']).toBe('content');
    expect(typeof revokedOldValue['approvalId']).toBe('string');
    expect(AuditService.query(ORG, { action: AUDIT_APPROVED })).toHaveLength(1);

    // ④ 批/撤之后链仍 valid
    const chain = revoked.body['chain'] as Record<string, unknown>;
    expect(chain['valid']).toBe(true);
    expect(chain['totalRecords']).toBe(2);
  });

  it('J4-2 再撤销 ⇒ 404 E_APPROVAL_NOT_FOUND（非 200 幂等，§10-L5）', async () => {
    await approveForTest('content');
    const first = await postApproval(ROLE, { action: 'revoke' }, tokenFor('admin'));
    expect(first.status).toBe(200);

    const second = await postApproval(ROLE, { action: 'revoke' }, tokenFor('admin'));
    expect(second.status).toBe(404);
    expect(second.body['code']).toBe('E_APPROVAL_NOT_FOUND');
    expect(AuditService.query(ORG, { action: AUDIT_REVOKED })).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J5 · scope 变更
// ══════════════════════════════════════════════════════════════════════════════

describe('J5 scope 变更', () => {
  it('J5-1 content → content+permissions（同 hash）⇒ 200 scope_changed ＋ 审计 1 条 ＋ permissionsPending 翻转', async () => {
    await approveForTest('content');
    const before = JSON.parse(readFileSync(approvalPathOf(ROLE), 'utf8')) as Record<string, unknown>;
    expect(before['scope']).toBe('content');

    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content+permissions', expectedContentHash: contentHashOf(ROLE) },
      tokenFor('admin'),
    );
    expect(res.status).toBe(200);
    expect(res.body['result']).toBe('scope_changed');
    expect(res.body['unchanged']).toBe(false);
    expect(res.body['auditAction']).toBe(AUDIT_SCOPE_CHANGED);

    // ① 记录 scope 已更新
    const after = JSON.parse(readFileSync(approvalPathOf(ROLE), 'utf8')) as Record<string, unknown>;
    expect(after['scope']).toBe('content+permissions');
    expect(after['contentHash']).toBe(before['contentHash']);

    // ② 权限待批标志翻转：content+permissions ⇒ false
    const approval = res.body['approval'] as Record<string, unknown>;
    expect(approval['scope']).toBe('content+permissions');
    expect(approval['permissionsPending']).toBe(false);

    // ③ 审计 scope_changed 1 条，old/new 都只含三字段
    const entries = AuditService.query(ORG, { action: AUDIT_SCOPE_CHANGED });
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]?.oldValue ?? '{}')['scope']).toBe('content');
    expect(JSON.parse(entries[0]?.newValue ?? '{}')['scope']).toBe('content+permissions');
    expect(AuditService.query(ORG, { action: AUDIT_APPROVED })).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J6 · 审计链 ＋ 详情 API
// ══════════════════════════════════════════════════════════════════════════════

describe('J6 审计链＋详情 API', () => {
  it('J6-1 批准后链 valid；详情 API 六件名齐＋状态/scope/hash/permissionsPending＋审计历史', async () => {
    await approveForTest('content');
    const hash = contentHashOf(ROLE);

    // ① 链校验（直接驱动 AuditService 暴露的 store）
    const store = AuditService.getStore();
    expect(store).not.toBeNull();
    expect(store?.verifyChain(ORG).valid).toBe(true);

    // ② 详情 API
    const res = await getJson(`/api/role-packs/${ROLE}`, tokenFor('admin'));
    expect(res.status).toBe(200);
    expect(res.body['ok']).toBe(true);
    expect(res.body['roleId']).toBe(ROLE);
    expect(res.body['status']).toBe('approved');
    expect(res.body['scope']).toBe('content');
    expect(res.body['contentHash']).toBe(hash);
    expect(res.body['validationHash']).toBe(hash);
    expect(res.body['permissionsPending']).toBe(true);
    expect(res.body['usable']).toBe(true);

    // ③ 六件名齐（与现场基线集合一致）
    const pieces = res.body['pieces'] as Array<Record<string, unknown>>;
    expect(Array.isArray(pieces)).toBe(true);
    expect(pieces.map((piece) => piece['name'])).toEqual([...ROLE_PACK_PIECES]);
    for (const piece of pieces) {
      expect(typeof piece['text']).toBe('string');
      expect(piece['truncated']).toBe(false);
      expect(String(piece['text']).length).toBeGreaterThan(0);
    }

    // ④ 记录 ＋ 审计历史 ＋ 链
    const record = res.body['record'] as Record<string, unknown>;
    expect(record['approvalId']).toBeTypeOf('string');
    const audit = res.body['audit'] as Array<Record<string, unknown>>;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.['action']).toBe(AUDIT_APPROVED);
    expect(audit[0]?.['targetId']).toBe(ROLE);
    const chain = res.body['chain'] as Record<string, unknown>;
    expect(chain['valid']).toBe(true);
    expect(chain['totalRecords']).toBe(1);
  });

  it('J6-2 篡改记录 hash ⇒ 下一轮 unverified，且审计链仍 valid（链证事件序，不证文件）', async () => {
    await approveForTest('content');
    const record = JSON.parse(readFileSync(approvalPathOf(ROLE), 'utf8')) as Record<string, unknown>;
    // 只改 contentHash（approvalId 不重算）⇒ 自绑定复算不符
    record['contentHash'] = 'b'.repeat(64);
    writeFileSync(approvalPathOf(ROLE), JSON.stringify(record), 'utf8');

    const list = await getJson('/api/role-packs', tokenFor('admin'));
    expect(list.status).toBe(200);
    const row = packRow(list.body, ROLE);
    expect(row['status']).toBe('unverified');
    expect(row['usable']).toBe(false);

    const detail = await getJson(`/api/role-packs/${ROLE}`, tokenFor('admin'));
    expect(detail.status).toBe(200);
    expect(detail.body['status']).toBe('unverified');
    const chain = detail.body['chain'] as Record<string, unknown>;
    expect(chain['valid']).toBe(true);
    expect(loadRolePacks().usable).not.toContain(ROLE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J7 · 审批会话卡（SSE；不建会话/不落库/不跑 LLM）
// ══════════════════════════════════════════════════════════════════════════════

describe('J7 审批会话卡（approvalRoleId）', () => {
  it('J7-1 未批包 ⇒ SSE open→approval_card→end；卡字段齐、无 agent_message', async () => {
    const res = await postConversation({ approvalRoleId: ROLE }, tokenFor('admin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = parseSse(await res.text());
    expect(frames.map((frame) => frame.data['type'])).toEqual(['open', 'approval_card', 'end']);

    // 不建会话（open 帧显式 sessionId:null ＋ mode=approval）／不跑 LLM（无 agent_message）
    const open = frames[0]?.data ?? {};
    expect(open['sessionId']).toBeNull();
    expect(open['mode']).toBe('approval');

    const card = frames[1]?.data ?? {};
    expect(card['roleId']).toBe(ROLE);
    expect(card['status']).toBe('pending');
    // 非 approved ⇒ scope/permissionsPending 为 null（不谎报 false）
    expect(card['scope']).toBeNull();
    expect(card['permissionsPending']).toBeNull();
    expect(card['contentHash']).toBe(contentHashOf(ROLE));
    expect(card['detailPath']).toBe(`/role-packs/${ROLE}`);

    const buttons = card['buttons'] as Array<Record<string, unknown>>;
    expect(Array.isArray(buttons)).toBe(true);
    expect(buttons.map((button) => button['id'])).toEqual(['approve', 'revoke', 'detail']);
    for (const button of buttons) expect(typeof button['label']).toBe('string');
  });

  it('J7-2 已批包同样出卡，status=approved ＋ 真实 scope/permissionsPending', async () => {
    await approveForTest('content');
    const res = await postConversation({ approvalRoleId: ROLE }, tokenFor('admin'));
    expect(res.status).toBe(200);

    const frames = parseSse(await res.text());
    expect(frames.map((frame) => frame.data['type'])).toEqual(['open', 'approval_card', 'end']);
    const card = frames[1]?.data ?? {};
    expect(card['status']).toBe('approved');
    expect(card['scope']).toBe('content');
    expect(card['permissionsPending']).toBe(true);
    expect(card['contentHash']).toBe(contentHashOf(ROLE));
  });

  it('J7-3 approvalRoleId 与 rolePackId 同给 ⇒ 400 E_APPROVAL_SESSION_CONFLICT', async () => {
    const res = await postConversation({ approvalRoleId: ROLE, rolePackId: ROLE }, tokenFor('admin'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('E_APPROVAL_SESSION_CONFLICT');
  });

  it('J7-4 无 Bearer ⇒ 401（白名单路径由分支自查，不依赖中间件）', async () => {
    const res = await postConversation({ approvalRoleId: ROLE });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('UNAUTHORIZED');
  });

  it('J7-5 staff ⇒ 403（分支自查角色白名单）', async () => {
    const res = await postConversation({ approvalRoleId: ROLE }, tokenFor('staff'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('E_ROLE_PACK_FORBIDDEN');
  });

  it('J7-6 包不存在 ⇒ 404（SSE 前 JSON，不开流）', async () => {
    const res = await postConversation({ approvalRoleId: GHOST_ROLE }, tokenFor('admin'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('E_ROLE_PACK_NOT_FOUND');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J8 · 说明书页（壳，不含数据）＋ 挂载顺序
// ══════════════════════════════════════════════════════════════════════════════

describe('J8 说明书页壳＋挂载顺序', () => {
  it('J8-1 无 token 页面 ⇒ 200 HTML 壳（含锚点，且不含夹具 roleId）', async () => {
    for (const path of ['/role-packs', `/role-packs/${ROLE}`]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const html = await res.text();
      expect(html).toContain('id="role-packs-app"');
      expect(html).toContain('data-testid="token-gate"');
      expect(html).toContain("sessionStorage.getItem('synova.token')");
      // 🔴 壳＝无数据：夹具 roleId 不得内联进 HTML
      expect(html).not.toContain(ROLE);
    }
  });

  it('J8-2 无 token 数据 API ⇒ 401（页面公开 ≠ 数据公开）', async () => {
    const res = await getJson('/api/role-packs');
    expect(res.status).toBe(401);

    const detail = await fetch(`${baseUrl}/api/role-packs/${ROLE}`);
    expect(detail.status).toBe(401);
  });

  it('J8-3 src/server.ts 挂载顺序：页面 < jwtAuthMiddleware < 审批 API', () => {
    const lines = readFileSync(join(REPO_ROOT, 'src', 'server.ts'), 'utf8').split('\n');
    const lineOf = (prefix: string): number => {
      const index = lines.findIndex((line) => line.trim().startsWith(prefix));
      expect(index, `src/server.ts 找不到挂载行：${prefix}`).toBeGreaterThanOrEqual(0);
      return index + 1;
    };
    const pageLine = lineOf('app.use(rolePacksPageRoutes);');
    const jwtLine = lineOf('app.use(jwtAuthMiddleware);');
    const apiLine = lineOf('app.use(roleApprovalsRoutes);');

    // 页面必须先于 JWT（否则无 token 页面 401）；API 必须后于 JWT（数据必须鉴权）
    expect(pageLine).toBeLessThan(jwtLine);
    expect(jwtLine).toBeLessThan(apiLine);
  });
});
