/**
 * tests/routes/conversations-role.test.ts — #1075 P2-2 岗位面 HTTP 判据（J1b／J4／J5／J6／J7b／J7c／J8）
 *
 * 断言对象 = **真实路由**（`src/routes/conversations.ts` 的 `POST /api/conversations` 与
 *   `POST /api/conversations/:id/messages`）：真 `express()` ＋ `listen(0)` ＋ `fetch` ＋ 真
 *   `jwtAuthMiddleware`/`signJwtToken` ＋ 真 better-sqlite3 `:memory:` ＋ fake provider 捕获
 *   `messages`（铁律 12：集成测试走真实路由，不 mock 管线）。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J1b 人设注入（HTTP）：admin Bearer ＋ `rolePackId` ⇒ SSE 200，捕获的 system message 含
 *       `## 岗位设定：<id>` ＋ addendum 原文（与 unit 面 `conversation-engine-role.test.ts` 互证）。
 *   J4  创建门（流前）：`pending`（无审批记录）⇒ 409 `E_ROLE_PACK_NOT_APPROVED`；不存在 ⇒ 404；
 *       形状非法（大写/斜杠/65 字符/`..`/空串）⇒ 400 `E_ROLE_PACK_ID_INVALID`；**均非 SSE**。
 *   J5  身份与角色白名单（真实词表）：`admin`/`manager`/`ga` ⇒ 200；`staff`/`liaison` ⇒ 403
 *       `E_ROLE_PACK_FORBIDDEN`；**无 Bearer ＋ 岗位** ⇒ 403（免认证白名单 ≠ 可选岗，C3）；
 *       已绑定会话 ＋ 不传 rolePackId ＋ 无 Bearer ⇒ 403（有效岗位非空即需验签身份）。
 *   J6  换岗禁（流前）：已绑 `ops` 再传别的 id ⇒ 409 `E_ROLE_PACK_IMMUTABLE`（非 SSE）；
 *       历史会话（state 无 rolePackId）传岗位 ⇒ 409；**同值重传** ⇒ 200。
 *   J7b 缓存命中不丢：同 app 同 sessionId 第二轮（带 Bearer、不传 rolePackId）⇒ 捕获的 system
 *       message 仍含人设（证明 `setRolePack()` 每轮刷新生效，不是"只在构造时注入一次"）。
 *   J7c 生产恢复路径：`vi.resetModules()` → 重新 import 路由（**新的** `sessionEngines`）→ 新 express
 *       app（`app.locals.orchestration = { db }`，**同一个 db 句柄**）→ 同 sessionId、不传 rolePackId
 *       ⇒ cache-miss 走 `loadState → fromState(state.rolePackId)` ⇒ 捕获的 system message 含人设。
 *   J8  撤销：第一轮 approved 200；删审批记录；第二轮（不传 rolePackId、带 Bearer）⇒ **HTTP 200** ＋
 *       响应头 `x-synova-role-pack: degraded` ＋ 捕获的 system message **不含** `## 岗位设定：`
 *       （反例：撤销后仍注入 ⇒ 红；撤销后 409/500 ⇒ 红 —— N1「不锁死用户」）。
 *
 * 🔴 夹具（不落仓）：`mkdtempSync` 造**仓库形状**临时根 —— `<tmp>/extensions/presets/roles/<id>/` 六件
 *   ＋ `<tmp>/extensions/ontology/outcome/financial.json`（`manifest.refs` 的 `kind:file` 目标）
 *   ＋ `<tmp>/.synova/approvals/<id>.json`（P2-1 `ApprovalRecord` 形状，`approvalId` 由本文件
 *   **独立实现** `apv1:` 自绑定算出 —— 生产实现写错则本文件必红，不同源自证）。
 *   六个包文件由真实包 `extensions/presets/roles/finance` 拷贝后改写 roleId/context-manifest
 *   （比手写更容易过 P2-1 的 v3 结构＋refs 三方对账）。**禁写真仓 `.synova/`**。
 *
 * 环境前提：`DEV_MODE=false` ＋ `JWT_SECRET` 定值（白名单分支会**尝试**验签并注入 `req.auth`，
 *   D947/L-20）；`SYNOVA_PRESETS_ROOT` 指向临时内容根（afterAll 还原）。
 *
 * @degraded 本文件对降级面的判据只有 J8（200 ＋ 降级头 ＋ 不注入）；日志内容不作断言（跨进程 fd2 取证归 K3）。
 * @authority 判据归属 #1075 P2-2（规格 §4 J1b/J4/J5/J6/J7b/J7c/J8）。
 *
 * 已知限制：
 *   ① 集成侧**不做进程重启**（规格 §10-L7）：重启语义由 `fromState`（unit 面 J7a）覆盖，本文件只证缓存路径；
 *   ② 不测真实模型效果，只证"人设进了 provider 收到的 messages"（§10-L8）；
 *   ③ 不测 CORS `exposedHeaders`（`src/server.ts` 不在本批写集，规格 h）；
 *   ④ 审批记录是**夹具**直写（P3 才有人审批写入面），不证审批写路径。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Router } from 'express';
import type { Server } from 'http';
import type { Socket } from 'net';
import type Database from 'better-sqlite3';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { computeRolePackContentHash, ROLE_PACK_PIECES } from '../../src/init/role-pack-schema';

// ═══ hoisted mock 状态（vi.mock 工厂提升后仍可读写）═══
const mocks = vi.hoisted(() => ({
  /** 每次 fake provider.chat 收到的 messages 快照（断言 system 层是否带人设） */
  chatCalls: [] as Array<Array<{ role: string; content: string }>>,
  /** fake provider 返回的回复文本 */
  replyText: { value: '（fake）请补充报告期与口径来源。' },
}));

// ── mock ① providers：fake 流式 provider（形态对齐 tests/routes/conversations.test.ts）──
// importOriginal spread：server.ts import 链上 llm-config.ts 模块级消费 listProviderTypes()，
// 全量替换会炸模块装载 —— 只覆写 createProvider，其余导出保真
vi.mock('../../src/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers')>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake-p22-provider',
      baseUrl: 'fake://p22-role-test',
      async chat(messages: Array<{ role: string; content: unknown }>) {
        mocks.chatCalls.push(
          messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
        );
        return { content: mocks.replyText.value, model: 'fake' };
      },
      async healthCheck() { return { healthy: true, latencyMs: 1 }; },
      listModels() { return ['fake']; },
    }),
  };
});
vi.mock('../../src/providers/detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/detect')>();
  return { ...actual, detectProvider: () => 'deepseek' };
});

// ── mock ② config：定值 ＋ dbPath 指向内存库 ＋ **orgId 定值**（审批判定的租户字段）──
// `resolveOrgId()` 读 `loadConfig().orgId` 并**进程内缓存**（preset-loader KL-P2-4）⇒
// 夹具审批记录的 orgId 必须与它逐字相同，否则 E_APPROVAL_ORG_MISMATCH。
vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config')>();
  return {
    ...actual,
    loadConfig: () => ({
      llmApiKey: 'test-key',
      llmBaseUrl: 'http://localhost:1',
      llmModel: 'test-model',
      dbPath: process.env.SYNOVA_DB_PATH || ':memory:',
      devMode: false,
      orgId: 'default',
    }),
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// SSE / 网络 helpers（照搬 tests/routes/conversations.test.ts 的骨架）
// ══════════════════════════════════════════════════════════════════════════════

interface SseFrame { event: string; data: Record<string, unknown>; }

function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.includes('data: '))
    .map((block) => {
      const lines = block.split('\n');
      const event = (lines.find((l) => l.startsWith('event: ')) ?? '').replace('event: ', '').trim();
      const dataLine = lines.find((l) => l.startsWith('data: ')) ?? '';
      return { event, data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown> };
    });
}

/** 从 open 帧提取 sessionId（未拿到 = 测试自身缺陷，直接 fail） */
function requireSessionId(frames: SseFrame[]): string {
  const open = frames.find((f) => f.data.type === 'open');
  const sessionId = open !== undefined && typeof open.data.sessionId === 'string' ? open.data.sessionId : undefined;
  if (sessionId === undefined) {
    throw new Error(`open 帧缺失或无 sessionId: frames0=${JSON.stringify(frames[0])}`);
  }
  return sessionId;
}

/** 等待 server 就绪并返回 baseUrl（沿 diagnosis-consult-events.test.ts 先例） */
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

// ══════════════════════════════════════════════════════════════════════════════
// 夹具常量与构造器（临时根；禁写真仓）
// ══════════════════════════════════════════════════════════════════════════════

const REPO_ROOT = process.cwd();
/** 基线模板包（真实包拷过来改写，比手写六件更容易过 P2-1 的 v3 结构 ＋ refs 三方对账） */
const TEMPLATE_ROLE_DIR = join(REPO_ROOT, 'extensions', 'presets', 'roles', 'finance');
/** `manifest.refs` 里 `kind:file` 的目标（路径相对仓库根；夹具里放在临时根的同名位置） */
const TEMPLATE_FILE_REF = join(REPO_ROOT, 'extensions', 'ontology', 'outcome', 'financial.json');

const ORG = 'default';
const FIXED_AT = '2026-10-28T12:00:00.000Z';
const APPROVER_ID = 'u_p22';
const APPROVER_ROLE = 'super-admin';
/** 人设正文哨兵（证明注入的是**真 addendum 原文**，而不是"有标题没正文"） */
const SENTINEL = 'PERSONA_ADDENDUM_P22';
/** 已审批夹具岗位（六件齐全 ＋ `.synova/approvals/ops.json`） */
const ROLE = 'ops';
/** 未审批夹具岗位（六件齐全、**无**审批记录 ⇒ pending） */
const ROLE_UNAPPROVED = 'unapp';
/** 换岗目标（可以不存在：换岗判定先于加载 ⇒ 仍应 409 IMMUTABLE） */
const ROLE_OTHER = 'finance';

const JWT_SECRET_VALUE = 'p22-route-role-secret-0123456789abcdef';

let fixtureRoot = '';
let presetsRoot = '';
let db: Database.Database;
let server: Server;
let baseUrl = '';
let sockets: Socket[] = [];
/** 首份路由模块实例（J7c 的判别基准：`vi.resetModules()` 后必须拿到**另一个**实例） */
let initialRouter: Router;

function trackConnections(srv: Server): void {
  srv.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('close', () => { sockets = sockets.filter((s) => s !== socket); });
  });
}

/** 逐字替换文本文件内容（夹具改写；命中数不作断言 —— 改不到会在装载期被校验点名） */
function rewriteText(file: string, pairs: ReadonlyArray<readonly [string, string]>): void {
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of pairs) text = text.split(from).join(to);
  writeFileSync(file, text, 'utf8');
}

/**
 * 夹具 `context-manifest.yaml`（生成而非改写模板：要控制 contexts 条数与 addendum 原文）。
 * sources 与模板 `manifest.refs` 的三条一一对应（file／scope／profile）⇒ 三方对账通过：
 *   · `extensions/ontology/outcome/financial.json#requiredProps.period` ⇒ file
 *   · `extensions/presets/roles/<id>/knowledge-scope.yaml#finance.cost` ⇒ scope
 *   · `profile.business-plan` ⇒ profile
 */
function contextManifestFor(roleId: string): string {
  return `# ${roleId}/context-manifest.yaml — #1075 P2-2 夹具（只注入清单指针，不注入内容）
roleId: ${roleId}
version: 1.0.0
contexts:
  - id: ${roleId}.period
    label: 报告期
    source: extensions/ontology/outcome/financial.json#requiredProps.period
    why: 无报告期的指标不可比较
    required: true
  - id: ${roleId}.cost
    label: 成本基线
    source: extensions/presets/roles/${roleId}/knowledge-scope.yaml#finance.cost
    why: 成本判断需要基线
    required: false
  - id: company.bp
    label: 公司业务说明
    source: profile.business-plan
    why: 结论要落回业务动作
    required: false
prompt:
  systemAddendum: |
    ${SENTINEL}：所有结论必须标明报告期与口径来源；缺报告期先追问，不得用「大概」替代。
`;
}

/** 六件内容指纹（夹具审批记录用；与 P2-1 生产同一纯核函数，raw bytes 语义） */
function contentHashOf(roleDir: string): string {
  return computeRolePackContentHash(
    ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(roleDir, name)) })),
  );
}

/**
 * `apv1:` 自绑定的**测试侧独立实现**（不调 `src/init/role-pack-approval.ts` 的私有函数）：
 * `'apv1:' + sha256(orgId|roleId|contentHash|scope|approvedAt|approverId|approverRole)[0:16]`。
 * 生产实现若写错，夹具记录过不了自绑定复算 ⇒ 本文件 J1b/J5/J6/J7b/J7c 全红（信号正确）。
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

function approvalPath(roleId: string): string {
  return join(fixtureRoot, '.synova', 'approvals', `${roleId}.json`);
}

/** 写审批记录（P2-1 `ApprovalRecord` 形状；`scope=content+permissions`） */
function writeApprovalRecord(roleId: string): void {
  const roleDir = join(presetsRoot, 'roles', roleId);
  const fields = {
    roleId,
    orgId: ORG,
    contentHash: contentHashOf(roleDir),
    scope: 'content+permissions',
    approvedAt: FIXED_AT,
    approverId: APPROVER_ID,
    approverRole: APPROVER_ROLE,
  };
  mkdirSync(join(fixtureRoot, '.synova', 'approvals'), { recursive: true });
  writeFileSync(
    approvalPath(roleId),
    JSON.stringify({ schemaVersion: 1, ...fields, approvalId: approvalDigest(fields) }),
    'utf8',
  );
}

function removeApprovalRecord(roleId: string): void {
  rmSync(approvalPath(roleId), { force: true });
}

/** 造一个夹具岗位包（拷模板 → 改写 roleId/context-manifest → 可选写审批记录） */
function writeRolePack(roleId: string, opts: { readonly approved: boolean }): void {
  const roleDir = join(presetsRoot, 'roles', roleId);
  cpSync(TEMPLATE_ROLE_DIR, roleDir, { recursive: true });
  rewriteText(join(roleDir, 'manifest.json'), [['"roleId": "finance"', `"roleId": "${roleId}"`]]);
  rewriteText(join(roleDir, 'knowledge-scope.yaml'), [['roleId: finance', `roleId: ${roleId}`]]);
  rewriteText(join(roleDir, 'capabilities.yaml'), [['roleId: finance', `roleId: ${roleId}`]]);
  rewriteText(join(roleDir, 'acceptance-criteria.yaml'), [['roleId: finance', `roleId: ${roleId}`]]);
  writeFileSync(join(roleDir, 'context-manifest.yaml'), contextManifestFor(roleId), 'utf8');
  if (opts.approved) writeApprovalRecord(roleId);
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP helpers（真 fetch；Bearer 可选）
// ══════════════════════════════════════════════════════════════════════════════

type AuthModule = typeof import('../../src/middleware/auth');
let auth: AuthModule;

function tokenFor(role: string): string {
  const signed = auth.signJwtToken({ sub: `${role}-p22`, role, orgId: ORG });
  expect(signed, `夹具失败：${role} token 签发返回 null（JWT_SECRET 未生效？）`).not.toBeNull();
  return signed ?? '';
}

function authHeader(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

async function postConversation(
  body: Record<string, unknown>,
  token: string | undefined,
  url: string = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(body),
  });
}

async function postToSession(
  sessionId: string,
  body: Record<string, unknown>,
  token: string | undefined,
  url: string = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/conversations/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(body),
  });
}

/** 最近一次 provider.chat 收到的 system 层内容（缺 system ⇒ 测试自身缺陷，直接 fail） */
function lastSystemContent(): string {
  const call = mocks.chatCalls.at(-1);
  expect(call, '本轮没有 provider.chat 调用（fake provider 未被触发）').toBeDefined();
  const system = call?.find((m) => m.role === 'system');
  expect(system, 'provider.chat 收到的 messages 缺 system 层').toBeDefined();
  return system?.content ?? '';
}

/** 建一个**已绑定岗位**的会话（第一轮成功 ⇒ 落库带 rolePackId） */
async function createBoundSession(roleId: string = ROLE): Promise<string> {
  const res = await postConversation({ message: '创建岗位会话：请按岗位口径回答', rolePackId: roleId }, tokenFor('admin'));
  expect(res.status, `建绑定会话失败：${String(res.status)}`).toBe(200);
  const sessionId = requireSessionId(parseSse(await res.text()));
  return sessionId;
}

// ══════════════════════════════════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // 生产态鉴权语义：白名单分支会尝试验签并注入 req.auth ⇒ 必须关掉 DevMode auto-admin
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = JWT_SECRET_VALUE;

  // 夹具临时根（仓库形状；repoRoot = <tmp>，故 approvalsRoot = <tmp>/.synova/approvals）
  fixtureRoot = mkdtempSync(join(tmpdir(), 'p22-route-role-'));
  presetsRoot = join(fixtureRoot, 'extensions', 'presets');
  mkdirSync(join(presetsRoot, 'roles'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'extensions', 'ontology', 'outcome'), { recursive: true });
  cpSync(TEMPLATE_FILE_REF, join(fixtureRoot, 'extensions', 'ontology', 'outcome', 'financial.json'));
  writeRolePack(ROLE, { approved: true });
  writeRolePack(ROLE_UNAPPROVED, { approved: false });
  process.env.SYNOVA_PRESETS_ROOT = presetsRoot;

  // 真 sqlite :memory:（engine-context 建库；路由经 app.locals.orchestration.db 消费同一句柄）
  const { initEngineContext, getDatabase } = await import('../../src/init/engine-context');
  initEngineContext();
  db = getDatabase();

  auth = await import('../../src/middleware/auth');
  const conversationsRouter = (await import('../../src/routes/conversations')).default;
  initialRouter = conversationsRouter; // J7c 判别基准（resetModules 后必须换成**另一个**实例）

  const app = express();
  app.use(express.json());
  app.locals.orchestration = { db };
  app.use(auth.jwtAuthMiddleware);
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
  // 还原 env（不泄漏到其他测试文件）
  delete process.env.SYNOVA_PRESETS_ROOT;
  process.env.DEV_MODE = 'true';
  delete process.env.JWT_SECRET;
  if (fixtureRoot !== '') rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.chatCalls.length = 0;
  mocks.replyText.value = '（fake）请补充报告期与口径来源。';
});

// ══════════════════════════════════════════════════════════════════════════════
// J1b · 人设注入（HTTP 面）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1b 人设注入（真实路由 ＋ fake provider）', () => {
  it('J1b-1 admin Bearer ＋ rolePackId ⇒ SSE 200，捕获的 system message 含「## 岗位设定：ops」＋ addendum 原文', async () => {
    const res = await postConversation({ message: '第一轮：请按财务岗位口径回答', rolePackId: ROLE }, tokenFor('admin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = parseSse(await res.text());
    expect(frames[0]?.data.type).toBe('open');
    expect(requireSessionId(frames)).toMatch(/^sess_/);

    const system = lastSystemContent();
    expect(system).toContain('## 岗位设定：ops');
    expect(system).toContain(SENTINEL);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 · 创建门（审批 / 存在性 / 形状；全部流前）
// ══════════════════════════════════════════════════════════════════════════════

describe('J4 创建门（流前；非 SSE）', () => {
  it('J4-1 pending（无审批记录）⇒ 409 E_ROLE_PACK_NOT_APPROVED，且 content-type 非 event-stream', async () => {
    const res = await postConversation({ message: '未审批岗位', rolePackId: ROLE_UNAPPROVED }, tokenFor('admin'));
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('E_ROLE_PACK_NOT_APPROVED');
    // 流前拒绝 ⇒ 未产生 provider 调用（没有任何注入发生）
    expect(mocks.chatCalls.length).toBe(0);
  });

  it('J4-2 不存在的 roleId ⇒ 404 E_ROLE_PACK_NOT_FOUND', async () => {
    const res = await postConversation({ message: '不存在的岗位', rolePackId: 'ghost-role' }, tokenFor('admin'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    expect(((await res.json()) as { code: string }).code).toBe('E_ROLE_PACK_NOT_FOUND');
  });

  it('J4-3 形状非法（大写／斜杠／65 字符／`..` 越权形态／空串）⇒ 400 E_ROLE_PACK_ID_INVALID', async () => {
    // 判据口径 = 规格 §2.1-a 的**逐字正则** `^[a-z0-9][a-z0-9.-]{0,63}$`：
    // 首字符必须小写字母/数字 ⇒ 裸 `..`、`../etc/passwd` 被拒；总长 ≤64；只允许小写字母/数字/`.`/`-`。
    const badShapes = ['OPS', 'a/b', 'x'.repeat(65), '..', '../etc/passwd', ''] as const;
    for (const shape of badShapes) {
      const res = await postConversation({ message: `形状非法：${shape}`, rolePackId: shape }, tokenFor('admin'));
      expect(res.status, `rolePackId=${JSON.stringify(shape)} 应 400`).toBe(400);
      expect(res.headers.get('content-type')).not.toContain('text/event-stream');
      expect(((await res.json()) as { code: string }).code).toBe('E_ROLE_PACK_ID_INVALID');
    }
    // 非字符串同样 400（形状校验对 unknown 生效）
    const nonString = await postConversation({ message: '形状非法：非字符串', rolePackId: 42 }, tokenFor('admin'));
    expect(nonString.status).toBe(400);
    expect(((await nonString.json()) as { code: string }).code).toBe('E_ROLE_PACK_ID_INVALID');

    // 边界（正向）：内部含 `..` 的 `a..b` **符合** 规格正则（首字符合法、长度合法）⇒ 不判形状错，
    // 只在装载期判"不存在"⇒ 404。钉死"实现没有比规格更严/更松"。
    const dotInside = await postConversation({ message: '形状合法：内部点', rolePackId: 'a..b' }, tokenFor('admin'));
    expect(dotInside.status).toBe(404);
    expect(((await dotInside.json()) as { code: string }).code).toBe('E_ROLE_PACK_NOT_FOUND');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J5 · 身份与角色白名单（真实词表 admin|manager|liaison|staff|ga）
// ══════════════════════════════════════════════════════════════════════════════

describe('J5 身份与角色白名单', () => {
  it('J5-1 manager／ga ⇒ 200（并真实注入人设）', async () => {
    for (const role of ['manager', 'ga'] as const) {
      const res = await postConversation({ message: `${role} 选岗`, rolePackId: ROLE }, tokenFor(role));
      expect(res.status, `${role} 应放行`).toBe(200);
      const frames = parseSse(await res.text());
      expect(requireSessionId(frames)).toMatch(/^sess_/);
      expect(lastSystemContent(), `${role} 会话应带人设`).toContain('## 岗位设定：ops');
    }
  });

  it('J5-2 staff／liaison ⇒ 403 E_ROLE_PACK_FORBIDDEN（白名单外）', async () => {
    for (const role of ['staff', 'liaison'] as const) {
      const res = await postConversation({ message: `${role} 选岗`, rolePackId: ROLE }, tokenFor(role));
      expect(res.status, `${role} 应 403`).toBe(403);
      expect(res.headers.get('content-type')).not.toContain('text/event-stream');
      expect(((await res.json()) as { code: string }).code).toBe('E_ROLE_PACK_FORBIDDEN');
    }
  });

  it('J5-3 无 Bearer ＋ rolePackId ⇒ 403（免认证白名单 ≠ 可选岗）', async () => {
    const res = await postConversation({ message: '无凭据选岗', rolePackId: ROLE }, undefined);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    expect(((await res.json()) as { code: string }).code).toBe('E_ROLE_PACK_FORBIDDEN');
    expect(mocks.chatCalls.length).toBe(0);
  });

  it('J5-4 已绑定会话 ＋ 不传 rolePackId ＋ 无 Bearer ⇒ 403（有效岗位非空即需验签身份，C3）', async () => {
    const sessionId = await createBoundSession();
    mocks.chatCalls.length = 0;
    const res = await postToSession(sessionId, { message: '续轮但不带凭据' }, undefined);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('E_ROLE_PACK_FORBIDDEN');
    expect(mocks.chatCalls.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J6 · 换岗禁（流前）
// ══════════════════════════════════════════════════════════════════════════════

describe('J6 换岗禁（一会话一岗）', () => {
  it('J6-1 已绑 ops 再传 finance ⇒ 409 E_ROLE_PACK_IMMUTABLE（非 SSE）', async () => {
    const sessionId = await createBoundSession();
    const res = await postToSession(sessionId, { message: '换岗请求', rolePackId: ROLE_OTHER }, tokenFor('admin'));
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    expect(((await res.json()) as { code: string }).code).toBe('E_ROLE_PACK_IMMUTABLE');
  });

  it('J6-2 历史会话（state 无 rolePackId）传岗位 ⇒ 409 IMMUTABLE；同值重传 ⇒ 200', async () => {
    // 历史会话：第一轮不带岗位（无岗位路径）⇒ 落库 state 无 rolePackId
    const first = await postConversation({ message: '历史会话第一轮（无岗位）' }, undefined);
    expect(first.status).toBe(200);
    const sessionId = requireSessionId(parseSse(await first.text()));

    // 旧状态会话上"补绑"被拒（一会话一岗）
    const bindLater = await postToSession(sessionId, { message: '补绑岗位', rolePackId: ROLE }, tokenFor('admin'));
    expect(bindLater.status).toBe(409);
    expect(((await bindLater.json()) as { code: string }).code).toBe('E_ROLE_PACK_IMMUTABLE');

    // 同值重传（已绑定会话重复声明同一岗位）⇒ 放行并继续注入
    const boundSession = await createBoundSession();
    const sameValue = await postToSession(boundSession, { message: '同值重传', rolePackId: ROLE }, tokenFor('admin'));
    expect(sameValue.status).toBe(200);
    const frames = parseSse(await sameValue.text());
    expect(requireSessionId(frames)).toBe(boundSession);
    expect(lastSystemContent()).toContain('## 岗位设定：ops');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J7b · 缓存命中不丢人设
// ══════════════════════════════════════════════════════════════════════════════

describe('J7b 缓存命中路径（setRolePack 每轮刷新）', () => {
  it('J7b-1 同 app 同 sessionId 第二轮（带 Bearer、不传 rolePackId）⇒ system message 仍含人设', async () => {
    const sessionId = await createBoundSession();
    expect(lastSystemContent()).toContain('## 岗位设定：ops');

    const second = await postToSession(sessionId, { message: '第二轮：沿用人设' }, tokenFor('admin'));
    expect(second.status).toBe(200);
    await second.text(); // drain（SSE 必须读完，否则连接悬挂）
    const system = lastSystemContent();
    expect(system).toContain('## 岗位设定：ops');
    expect(system).toContain(SENTINEL);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J7c · 生产恢复路径（cache-miss → loadState → fromState）
// ══════════════════════════════════════════════════════════════════════════════

describe('J7c 生产恢复路径（新进程内缓存 ＋ 同一 db 句柄）', () => {
  it('J7c-1 vi.resetModules() 后重新 import 路由（空 sessionEngines）＋ 同 sessionId ⇒ fromState 恢复人设', async () => {
    const sessionId = await createBoundSession();
    expect(lastSystemContent()).toContain('## 岗位设定：ops');

    // 清空模块缓存 ⇒ 重新拿一份**全新的**路由模块（其 sessionEngines 为空 ⇒ 必然 cache-miss）
    vi.resetModules();
    const freshRouter = (await import('../../src/routes/conversations')).default;
    // 防"假 cache-miss"：若复用旧 app 的旧 sessionEngines，下面 3 条断言也会过
    // 判别力：resetModules 后必须拿到**另一个**路由实例（新模块 ⇒ 新私有 sessionEngines）
    expect(freshRouter).not.toBe(initialRouter);
    const { jwtAuthMiddleware: freshAuthMiddleware } = await import('../../src/middleware/auth');
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.locals.orchestration = { db }; // 同一个 db 句柄 ⇒ 同一份会话状态
    freshApp.use(freshAuthMiddleware);
    freshApp.use(freshRouter);
    const freshServer = freshApp.listen(0);
    trackConnections(freshServer);
    const freshUrl = await waitListening(freshServer);

    mocks.chatCalls.length = 0;
    try {
      const res = await postToSession(sessionId, { message: '恢复会话续轮（不传 rolePackId）' }, tokenFor('admin'), freshUrl);
      expect(res.status).toBe(200);
      const frames = parseSse(await res.text());
      expect(requireSessionId(frames)).toBe(sessionId);
      const system = lastSystemContent();
      expect(system, '缓存未命中恢复后 system 层必须仍带人设（fromState wiring）').toContain('## 岗位设定：ops');
      expect(system).toContain(SENTINEL);
    } finally {
      await new Promise<void>((resolve) => freshServer.close(() => resolve()));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J8 · 撤销（同一 cached engine 第二轮）
// ══════════════════════════════════════════════════════════════════════════════

describe('J8 撤销：审批记录删除后不再注入（200 ＋ 降级头）', () => {
  it('J8-1 第一轮 approved 200 ⇒ 删记录 ⇒ 第二轮 200 ＋ x-synova-role-pack: degraded ＋ 不注入', async () => {
    const sessionId = await createBoundSession();
    expect(lastSystemContent()).toContain('## 岗位设定：ops');

    removeApprovalRecord(ROLE);
    try {
      mocks.chatCalls.length = 0;
      const second = await postToSession(sessionId, { message: '撤销后第二轮' }, tokenFor('admin'));
      // 不锁死用户：仍是 200（不是 409/500）
      expect(second.status).toBe(200);
      expect(second.headers.get('content-type')).toContain('text/event-stream');
      expect(second.headers.get('x-synova-role-pack')).toBe('degraded');
      await second.text(); // drain

      const system = lastSystemContent();
      expect(system, '撤销后不得再注入岗位设定段').not.toContain('## 岗位设定：');
      expect(system).not.toContain(SENTINEL);
    } finally {
      // 还原审批记录（后续用例/重跑需要同一夹具状态）
      writeApprovalRecord(ROLE);
    }
  });
});
