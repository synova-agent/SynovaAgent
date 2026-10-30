/**
 * tests/e2e/role-pack-lifecycle.e2e.test.ts — #1173 E2E 岗位包生命周期（生成→审批→会话生效→撤销→恢复）
 *
 * 用户流程（一条端到端旅程，**不是**五个孤立单测）:
 *   ① 生成：用真生成器 `generateConfigPack()` 在**临时 repo 形状根**造一个非出厂岗位包 `ops-e2e`
 *            （六件 v3 真写）⇒ 未审批 ⇒ `loadRolePacks().usable` 不含它（E-J1）。
 *   ② 审批：真 HTTP（真 `signJwtToken` admin JWT ＋ 真 `jwtAuthMiddleware`）⇒ `GET /api/role-packs`
 *            见 pending；`POST /api/role-packs/ops-e2e/approval`（approve ＋ 现场内容指纹）⇒ 200；
 *            `usable` 即时含；真审计链 `verifyChain(orgId).valid === true` 且 `role_pack.approved` 恰 1 条（E-J2）。
 *   ③ 会话生效：真 `ConversationEngine`（只把 LLM 传输边界换成 fake provider —— **捕获真出站 messages**）
 *            绑定 `rolePackId='ops-e2e'`；`listTools()` 含 `search_knowledge`；真 SQLite（better-sqlite3）
 *            的知识 chunk 经该工具只返回「scope 内 ∧ 敏感度允许 ∧ access_level 允许」的项；
 *            出站 system 层含 `## 岗位设定：ops-e2e` ＋ 人设正文（E-J3）。
 *   ④ 撤销：真 HTTP `{action:'revoke'}` ⇒ 200；`usable` 即时不含；下一轮人设复核失败 ⇒ **不注入**；
 *            `search_knowledge` 返回 0 条（拒绝型过滤，**不回落全库**）；审计 `role_pack.revoked` 恰 1 条（E-J4）。
 *   ⑤ 恢复：再 approve ⇒ 200；`serialize()` → JSON 落库形态 → `fromState(…, {rolePack})` 恢复后
 *            下一轮**重新注入**人设且知识工具回到 1 条（无 `degraded` 面）；审计计数正确（E-J5）。
 *
 * 判据归属（#1173 规格 §3；注释里的 `E-Jx` 即判据锚点）:
 *   E-J1 生成未批不可用 ｜ E-J2 审批 API 生效（200 ＋ usable ＋ 审计 1 条 ＋ verifyChain valid）
 *   E-J3 角色会话工具生效 ｜ E-J4 撤销降级 ｜ E-J5 恢复重新注入
 *   E-J6 失败可定位 ＋ 无 mock（真文件/真库/真链路，见下"无 mock 核验"）
 *   E-J8 回归 —— 本文件内锚点 = **隔离断言**（真实仓库零新文件）；完整回归由命令承担：
 *        `vitest run tests/e2e/role-pack-lifecycle.e2e.test.ts` ＋ `tsc --noEmit` ＋
 *        `vitest run tests/routes/role-approvals.test.ts tests/routes/conversations-role.test.ts`。
 *
 * 🔴 无 mock 核验（E-J6）：本文件**唯一**的 mock 是 `@synova/logger` 静音（第 81 行；不改变被测行为）。
 *   审批写路径（`role-pack-approval-write.ts`）、审批读路径（`role-pack-approval.ts`）、
 *   知识过滤（`role-pack-knowledge-filter.ts` ＋ `knowledge-store.ts`）**全部走生产实现**。
 *   可核命令（正则每个字面用字符类转义，否则本注释会被自己命中；实测只应命中 logger 一处）：
 *     `grep -nE "vi[.]mock|vi[.]spy[O]n|mock[I]mplementation|jest[.]mock" tests/e2e/role-pack-lifecycle.e2e.test.ts`
 *   ⇒ 只应命中 logger 一处（第 80 行附近）。旁证断言：审批记录真落盘、审计链真 `verifyChain`、三类越权 chunk 真被滤掉。
 *
 * 🔴 隔离手法（不写真仓）：`mkdtempSync` 造仓库形状临时根 ——
 *   `<tmp>/extensions/presets/roles/ops-e2e/`（生成器六件真写）；
 *   `SYNOVA_PRESETS_ROOT` 注入内容根 ⇒ 审批根由内容根派生 `resolve(root,'../..')/.synova/approvals`
 *   （`preset-loader.ts` 的 `resolveApprovalsRoot`，与生产同一派生，禁在测试里另写字面量）；
 *   会话库 = `<tmp>/e2e-1173.db`（`SYNOVA_DB_PATH`）；审计库 = better-sqlite3 `:memory:`。
 *   真实仓库 `extensions/presets/roles/ops-e2e` 与 `.synova/approvals/ops-e2e.json` 必须**不存在**（E-J8 断言）。
 *
 * @degraded 本文件不断言日志文案；降级面一律以「HTTP 码 ＋ 响应字段 ＋ 工具结果条数 ＋ 真文件事实」判（可核）。
 *           撤销轮的"降级"判据 = 人设段消失 ∧ 知识工具 0 条（引擎层口径；HTTP 层的
 *           `x-synova-role-pack: degraded` 归 `tests/routes/conversations-role.test.ts` J8，本文件不重复）。
 * @authority 判据归属 #1173（规格 §3 E-J1–E-J8）；本文件不改产品代码、不改判据。
 *
 * 已知限制（Known Limitations；禁写"暂不"）:
 *   ① **入口形状偏离（已由 L1 裁定）**：规格 §1/§2 建议用 `createServer()`（`src/server.ts:188`）取 HTTP；
 *      本件改用**裸 `express()` ＋ 真路由**（挂载顺序逐条镜像生产：`rolePacksPageRoutes` →
 *      `jwtAuthMiddleware` → `roleApprovalsRoutes`），原因两条可核证据：
 *        · `src/server.ts:199-205`：Bootstrap 失败即 `process.exit(1)` —— 本环境 `DEV_MODE=false` 下
 *          Phase 1 fatal（`MASTER_SECRET_MISSING`）⇒ worker 被 abort，该 suite 直接 FAIL（实测原文见回执）；
 *        · 仓内既有同结论先例 `tests/security/knowledge-audit-attribution.test.ts:19`
 *          「⚠️ **禁用 `createServer()`**（本仓实测：vitest worker 内调它会 abort，exit 134）」。
 *      ⇒ 换的是"取 HTTP 的手段"，判据 E-J1–E-J8 一字未改。
 *   ② 不证真实 LLM 语义（fake provider 定值回复）：只证"人设/工具真的进了出站 messages 与工具面"（规格 §4）。
 *   ③ 不证 HTTP 层的 `x-synova-role-pack: degraded` 响应头（归 conversations 路由测试 J8）；本件在引擎层证"降级不注入"。
 *   ④ 不证真实客户库/多租户隔离（单 org 定值）；不覆盖 UI 点击与上传文档历史回填（另批）。
 *   ⑤ 审计计数是**生命周期累计值**（本文件不逐用例重置审计库）：E-J2 断言 approved=1、E-J4 断言 revoked=1、
 *      E-J5 断言 approved=2 —— 累计计数正是"链未被重置"的判据，逐用例清空反而会掩盖链断裂。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateConfigPack, type RoleSeed } from '../../src/onboarding/config-pack-generator';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';
import { loadRolePacks, resolveApprovalsRoot } from '../../src/init/preset-loader';
import { loadRolePackPersona } from '../../src/init/role-pack-persona';
import { AuditService } from '../../src/services/audit-service';
import { ConversationEngine, type EngineState } from '../../src/agent/conversation-engine';
import { initEngineContext, getDatabase, closeEngineContext } from '../../src/init/engine-context';
import { KnowledgeStore } from '../../src/l4/knowledge-store';
import type { ToolCallResult } from '../../src/agent/tools';
import type { ChatResult, LLMMessage, LLMProvider, StreamCallback } from '../../src/providers/types';

// ── logger 静音（唯一 mock；不改变被测行为，本文件不断言日志文案 —— E-J6）──
vi.mock('@synova/logger', () => {
  const make = () => () => undefined;
  const m = { info: make(), warn: make(), error: make(), debug: make() };
  return { logger: m, createLogger: () => m };
});

// ══════════════════════════════════════════════════════════════════════════════
// 夹具常量与环境（**必须先于任何 src 取值调用落 env**）
// ══════════════════════════════════════════════════════════════════════════════

const ROLE = 'ops-e2e';
/** 知识 scope（须匹配生成器的 `SAFE_SCOPE_ID`：`^[a-z0-9][a-z0-9.-]{0,63}$`） */
const SCOPE = 'ops-e2e.statements';
const ORG = 'org-1173-e2e';
const JWT_SECRET_VALUE = 'e2e-1173-role-pack-lifecycle-secret-0123456789';
const ADMIN_SUB = 'admin-1173-e2e';

const AUDIT_APPROVED = 'role_pack.approved';
const AUDIT_REVOKED = 'role_pack.revoked';

/** 人设正文哨兵（证明"不止标题，正文也进了出站 messages"） */
const PERSONA_SENTINEL = 'E2E1173_PERSONA：所有结论必须标明口径来源，缺口径先追问。';
/** 知识检索关键词（四个 chunk 同词不同权限面 ⇒ 过滤判别力） */
const KEYWORD = 'E2E1173CASHFLOW';

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'e2e-1173-'));
const PRESETS_ROOT = join(FIXTURE_ROOT, 'extensions', 'presets');
const DB_FILE = join(FIXTURE_ROOT, 'e2e-1173.db');

process.env['DEV_MODE'] = 'false'; // 🔴 L1 硬条件①：不得为 true（否则 JWT 退化为自动 admin）
process.env['JWT_SECRET'] = JWT_SECRET_VALUE;
process.env['SYNOVA_ORG_ID'] = ORG;
process.env['SYNOVA_PRESETS_ROOT'] = PRESETS_ROOT;
process.env['SYNOVA_DB_PATH'] = DB_FILE;
process.env['PORT'] = '0';
process.env['SYNOVA_SKIP_MCP'] = '1';
// 回滚开关一律取默认（开）：本文件测的是默认生产语义
delete process.env['SYNOVA_APPROVAL_WRITE'];
delete process.env['SYNOVA_ROLE_PACK_TOOLS'];
delete process.env['SYNOVA_ROLE_KNOWLEDGE'];
delete process.env['SYNOVA_ROLE_PACK_PERSONA'];

const ORIGINAL_ENV: Readonly<Record<string, string | undefined>> = {
  DEV_MODE: process.env['DEV_MODE'],
  JWT_SECRET: process.env['JWT_SECRET'],
  SYNOVA_ORG_ID: process.env['SYNOVA_ORG_ID'],
  SYNOVA_PRESETS_ROOT: process.env['SYNOVA_PRESETS_ROOT'],
  SYNOVA_DB_PATH: process.env['SYNOVA_DB_PATH'],
  PORT: process.env['PORT'],
  SYNOVA_SKIP_MCP: process.env['SYNOVA_SKIP_MCP'],
};

// ══════════════════════════════════════════════════════════════════════════════
// 生命周期共享状态（一条旅程串五个阶段）
// ══════════════════════════════════════════════════════════════════════════════

let server: Server | undefined;
let baseUrl = '';
let sockets: Socket[] = [];
/** 阶段①断言用的生成结果（written 六件） */
let writtenPieces: readonly string[] = [];
/** 阶段③起使用的会话引擎 */
let engine: ConversationEngine | undefined;
/** 阶段④降级轮的落库快照（阶段⑤用它做 fromState 恢复） */
let degradedState: EngineState | undefined;
/** 三块"应可见/应被滤掉"的知识 chunk（阶段③④⑤共用） */
let chunkVisible = '';
let chunkOutOfScope = '';
let chunkPrivate = '';
let chunkSensitive = '';

type AuthModule = typeof import('../../src/middleware/auth');
let auth: AuthModule;

// ══════════════════════════════════════════════════════════════════════════════
// 夹具（生成种子／路径／指纹；全部真函数，不硬写字面量派生）
// ══════════════════════════════════════════════════════════════════════════════

/** 六块齐的岗位种子（`contexts` 只走 scope ＋ profile 两类 —— 临时根没有 `extensions/ontology/**`） */
function opsSeed(): RoleSeed {
  return {
    roleId: ROLE,
    knowledgeScope: [SCOPE],
    capabilities: ['operations review'],
    acceptanceCriteria: ['weekly ops review within one day'],
    contexts: [
      {
        id: `${SCOPE}-ref`,
        label: '经营口径',
        source: `extensions/presets/roles/${ROLE}/knowledge-scope.yaml#${SCOPE}`,
        // 🔴 `why` 虽在 `RoleContextSeed` 里可选，但人设面（`role-pack-persona.ts`）把它当**必填**：
        //    缺 `why` ⇒ `E_ROLE_PACK_PERSONA_INVALID`（生成件能过 loader 校验，却过不了人设解析）
        why: '无统一口径的结论不可比对',
        required: true,
      },
      {
        id: 'company.bp',
        label: '公司业务说明',
        source: 'profile.business-plan',
        why: '结论要落回业务动作',
        required: false,
      },
    ],
    systemAddendum: `你在为运营岗提供支持。\n${PERSONA_SENTINEL}`,
    outputTemplate: {
      templateId: 'ops-e2e.standard',
      sections: [{ id: 'headline', title: '一句话结论', must: ['结论', '口径'] }],
      emptyState: '数据不足时列出缺口。',
    },
  };
}

function roleDirOf(roleId: string): string {
  return join(PRESETS_ROOT, 'roles', roleId);
}

/** 审批记录根 —— 走生产派生（`resolveApprovalsRoot`），禁在测试里另写 `.synova/approvals` 字面量 */
function approvalsRootOf(): string {
  return resolveApprovalsRoot(PRESETS_ROOT);
}

function approvalPathOf(roleId: string): string {
  return join(approvalsRootOf(), `${roleId}.json`);
}

/** 六件内容指纹（纯核，与审批 API 的 `expectedContentHash` 同源） */
function contentHashOf(roleId: string): string {
  const dir = roleDirOf(roleId);
  return computeRolePackContentHash(
    ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(dir, name)) })),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// fake LLM provider —— **捕获真出站 messages**（阶段③④⑤的人设判据来源）
// ══════════════════════════════════════════════════════════════════════════════

let outboundTurns: LLMMessage[][] = [];

function fakeProvider(reply: string): LLMProvider {
  return {
    name: 'fake-1173-lifecycle',
    baseUrl: 'fake://1173-lifecycle',
    async chat(messages: LLMMessage[]): Promise<ChatResult> {
      outboundTurns.push(messages.map((message) => ({ role: message.role, content: message.content })));
      return { content: reply, model: 'fake' };
    },
    async stream(_messages: LLMMessage[], cb: StreamCallback): Promise<void> {
      cb.onComplete?.({ content: reply, model: 'fake' });
    },
    async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
      return { healthy: true, latencyMs: 1 };
    },
    listModels(): string[] {
      return ['fake'];
    },
  };
}

/** 最近一次出站 system 层正文（空 ⇒ 非空断言失败，不静默取空串） */
function lastOutboundSystem(): string {
  const last = outboundTurns[outboundTurns.length - 1];
  expect(last, '本轮必须真的调过 provider（outboundTurns 为空 = 没跑真实链路）').toBeDefined();
  const head = (last ?? [])[0];
  expect(head?.role, '出站 messages[0] 必须是 system 层').toBe('system');
  return head?.content ?? '';
}

function requireEngine(): ConversationEngine {
  expect(engine, '阶段③必须先建好会话引擎').toBeDefined();
  if (engine === undefined) throw new Error('engine 未建立');
  return engine;
}

/** 引擎层一轮（phase 0 是访谈分支 ⇒ 先推进到 1，走工具循环；本文件只关心 system 层与工具面） */
async function runTurn(current: ConversationEngine, message: string): Promise<void> {
  const result = await current.processMessage(message);
  expect(typeof result.reply, '一轮必须真的返回回复（fake provider 定值）').toBe('string');
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP helpers（真 fetch ＋ 真 Bearer）
// ══════════════════════════════════════════════════════════════════════════════

interface JsonResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function tokenFor(role: string, orgId: string = ORG): string {
  const signed = auth.signJwtToken({ sub: `${role}-1173`, role, orgId });
  expect(signed, `夹具失败：${role} token 签发返回 null（JWT_SECRET 未生效？）`).not.toBeNull();
  return signed ?? '';
}

async function getJson(path: string, token: string): Promise<JsonResult> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function postApproval(
  roleId: string,
  payload: Record<string, unknown>,
  token: string,
): Promise<JsonResult> {
  const res = await fetch(`${baseUrl}/api/role-packs/${roleId}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function waitListening(srv: Server): Promise<string> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const addr = srv.address();
      if (addr !== null && typeof addr !== 'string') {
        clearInterval(timer);
        resolve(`http://127.0.0.1:${addr.port}`);
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

/** 列表响应里取某岗位行（找不到 = 夹具/路由缺陷 ⇒ 直接失败，不静默 {}） */
function packRow(body: Record<string, unknown>, roleId: string): Record<string, unknown> {
  const rows = body['rolePacks'];
  expect(Array.isArray(rows), '列表响应缺 rolePacks 数组').toBe(true);
  const found = (rows as Record<string, unknown>[]).find((row) => row['roleId'] === roleId);
  expect(found, `列表里找不到 ${roleId}`).toBeDefined();
  return found ?? {};
}

/** 工具结果里的 `results[].id` 清单（结构化读，禁 as any 家族） */
function resultIds(result: ToolCallResult): string[] {
  const raw = result['results'];
  expect(Array.isArray(raw), 'search_knowledge 必须返回 results 数组').toBe(true);
  return (raw as Record<string, unknown>[]).map((row) => String(row['id']));
}

// ══════════════════════════════════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // 临时 repo 形状根：`<tmp>/extensions/presets/roles/`（生成器自己 mkdir 角色目录）
  mkdirSync(join(PRESETS_ROOT, 'roles'), { recursive: true });

  // 真 SQLite（会话/知识库）＋ 真审计库（`:memory:`）
  initEngineContext();
  const store = new KnowledgeStore(getDatabase());
  chunkVisible = store.insert({
    text: `${KEYWORD} 经营口径：范围内的现金流口径说明`,
    sourceType: 'document',
    sourceId: 'doc-1173-visible',
    authorityLevel: 'reference',
    accessLevel: 'team',
    accessSensitivity: 'normal',
    pkbDomain: SCOPE,
    orgId: ORG,
  });
  chunkOutOfScope = store.insert({
    text: `${KEYWORD} 市场定价口径：范围外`,
    sourceType: 'document',
    sourceId: 'doc-1173-out-of-scope',
    authorityLevel: 'reference',
    accessLevel: 'team',
    accessSensitivity: 'normal',
    pkbDomain: 'market.pricing',
    orgId: ORG,
  });
  chunkPrivate = store.insert({
    text: `${KEYWORD} 私人笔记：access_level=private`,
    sourceType: 'document',
    sourceId: 'doc-1173-private',
    authorityLevel: 'reference',
    accessLevel: 'private',
    accessSensitivity: 'normal',
    pkbDomain: SCOPE,
    orgId: ORG,
  });
  chunkSensitive = store.insert({
    text: `${KEYWORD} 薪资明细：access_sensitivity=sensitive`,
    sourceType: 'document',
    sourceId: 'doc-1173-sensitive',
    authorityLevel: 'reference',
    accessLevel: 'team',
    accessSensitivity: 'sensitive',
    pkbDomain: SCOPE,
    orgId: ORG,
  });

  AuditService.resetInstance();
  AuditService.init(new Database(':memory:'));

  // 真路由 ＋ 真中间件；挂载顺序**逐条镜像 src/server.ts**（页面壳 → JWT → 审批 API）
  auth = await import('../../src/middleware/auth');
  const pageRouter = (await import('../../src/routes/role-packs-page')).default;
  const approvalRouter = (await import('../../src/routes/role-approvals')).default;
  const app = express();
  app.use(express.json());
  app.use(pageRouter);
  app.use(auth.jwtAuthMiddleware);
  app.use(approvalRouter);
  server = app.listen(0);
  trackConnections(server);
  baseUrl = await waitListening(server);
}, 60_000);

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
  closeEngineContext();
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// 阶段① 生成（E-J1）
// ══════════════════════════════════════════════════════════════════════════════

describe('阶段①生成 · 真生成器造 ops-e2e 六件 v3，未审批 ⇒ 不可用', () => {
  it('E-J1 生成后六件真落盘；loadRolePacks().usable 不含；状态 pending（+ 真 HTTP 列表亦 pending）', async () => {
    console.info('[E2E-1173][阶段①生成] generateConfigPack(ops-e2e) → loadRolePacks → GET /api/role-packs');
    const outcome = generateConfigPack({ roles: [opsSeed()], rootDir: FIXTURE_ROOT });
    writtenPieces = outcome.written;
    expect(outcome.rejected, '六块齐的种子不得被拒').toEqual([]);
    expect(outcome.written.length, '六件 v3 真写').toBe(6);
    // 磁盘真值（不看返回值自证）：六件都在
    for (const name of ROLE_PACK_PIECES) {
      expect(existsSync(join(roleDirOf(ROLE), name)), `${name} 必须真落盘`).toBe(true);
    }

    const report = loadRolePacks();
    const pack = report.roles.find((item) => item.roleId === ROLE);
    expect(pack, '生成件必须可被装载（否则夹具没真写）').toBeDefined();
    expect(pack?.schemaValid, '六件结构必须 v3 合法').toBe(true);
    expect(pack?.approval.status, 'E-J1 无审批记录 ⇒ pending').toBe('pending');
    // 🔴 E-J1 核心：未审批不可用
    expect(report.usable, 'E-J1 未审批 ⇒ usable 不含').not.toContain(ROLE);
    expect(report.degraded, 'pending 不计 degraded').toBe(false);

    // E-J1 另一半：真 HTTP 列表里状态 = pending
    const res = await getJson('/api/role-packs', tokenFor('admin'));
    expect(res.status).toBe(200);
    const row = packRow(res.body, ROLE);
    expect(row['status']).toBe('pending');
    expect(row['usable']).toBe(false);
    expect(String(approvalPathOf(ROLE))).not.toBe('');
    expect(existsSync(approvalPathOf(ROLE)), '未审批 ⇒ 审批记录文件必须不存在').toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 阶段② 审批（E-J2 ＋ E-J6 真文件/真链）
// ══════════════════════════════════════════════════════════════════════════════

describe('阶段②审批 · 真 HTTP approve ⇒ 200 ＋ usable 即时含 ＋ 审计链 valid', () => {
  it('E-J2（+E-J6）approve 200；usable 含；审计 role_pack.approved 恰 1 条；verifyChain(orgId).valid === true；记录真落盘', async () => {
    console.info('[E2E-1173][阶段②审批] POST /api/role-packs/ops-e2e/approval {action:approve}');
    const hash = contentHashOf(ROLE);
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: hash },
      tokenFor('admin'),
    );
    expect(res.status, `审批必须 200：${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body['ok']).toBe(true);
    expect(res.body['result']).toBe('approved');
    expect(res.body['auditAction']).toBe(AUDIT_APPROVED);

    // ① 生效面：loadRolePacks().usable 即时含（零缓存语义）
    const report = loadRolePacks();
    expect(report.usable, 'E-J2 批准后 usable 必含').toContain(ROLE);
    const pack = report.roles.find((item) => item.roleId === ROLE);
    expect(pack?.approval.status).toBe('approved');
    // `RolePack.approval` 视图只带 status/approvalId/scope/permissionsPending（不含 contentHash）——
    // 指纹判据落在下面 ④ 的**磁盘记录**上（同一份真值，不重复造字段）
    expect(pack?.approval.scope).toBe('content');
    expect(typeof pack?.approval.approvalId).toBe('string');

    // ② 审计：恰 1 条 role_pack.approved，且 targetType 正确
    const approvedEntries = AuditService.query(ORG, { action: AUDIT_APPROVED });
    expect(approvedEntries, 'E-J2 审计 role_pack.approved 恰 1 条').toHaveLength(1);
    expect(approvedEntries[0]?.targetType).toBe('role_pack');

    // ③ 审计链：真 store.verifyChain（禁 mock）；valid===true 且记录数 ≥ 1
    const auditStore = AuditService.getStore();
    expect(auditStore, '审计库必须已初始化（否则 verifyChain 无从校验）').not.toBeNull();
    const chain = auditStore?.verifyChain(ORG);
    expect(chain, 'E-J2 verifyChain 必须返回结果').toBeDefined();
    expect(chain?.valid, 'E-J2 审计链必须 valid').toBe(true);
    expect(chain?.totalRecords, '链里至少 1 条').toBeGreaterThanOrEqual(1);
    // 路由响应里的 chain 与直读一致（同源判据，两处独立断言）
    const chainInBody = res.body['chain'] as Record<string, unknown> | undefined;
    expect(chainInBody?.['valid']).toBe(true);

    // ④ E-J6 无 mock 旁证：审批记录**真落盘**（生产写模块原子写的结果）
    expect(existsSync(approvalPathOf(ROLE)), 'E-J6 审批记录必须真写入磁盘').toBe(true);
    const onDisk: unknown = JSON.parse(readFileSync(approvalPathOf(ROLE), 'utf8'));
    expect(typeof onDisk).toBe('object');
    const record = onDisk as Record<string, unknown>;
    expect(record['schemaVersion']).toBe(1);
    expect(record['roleId']).toBe(ROLE);
    expect(record['orgId']).toBe(ORG);
    expect(record['contentHash']).toBe(hash);
    expect(typeof record['approvalId']).toBe('string');
    expect(String(record['approvalId'])).toMatch(/^apv1:[0-9a-f]{16}$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 阶段③ 会话生效（E-J3）
// ══════════════════════════════════════════════════════════════════════════════

describe('阶段③会话生效 · 真引擎绑定资格 ＋ 真 SQLite 知识过滤 ＋ 出站 system 含人设', () => {
  it('E-J3（+E-J6）listTools 含 search_knowledge；只返回 scope 内∧normal∧team；出站 messages 含「## 岗位设定：ops-e2e」＋正文', async () => {
    console.info('[E2E-1173][阶段③会话生效] setRolePack + listTools + search_knowledge + 一轮真出站');
    const personaResult = loadRolePackPersona(ROLE);
    // 失败时把 typed code 带进断言消息（E-J6：失败可定位到阶段与原因，不只给 exit 1）
    expect(personaResult.ok ? 'ok' : `${personaResult.code}: ${personaResult.reason}`,
      'E-J3 批准后必须能解析人设面（否则会话无从生效）').toBe('ok');
    if (!personaResult.ok) throw new Error(`人设解析失败：${personaResult.code} ${personaResult.reason}`);

    const current = new ConversationEngine(fakeProvider('（fake）已按岗位口径给出结论。'), {
      orgId: ORG,
      sessionId: 'e2e-1173-session',
      fallbackProvider: null,
    });
    engine = current;
    current.setRolePack(personaResult.persona);
    current.advancePhase(); // phase 0 = 访谈分支；推到 1 走工具循环
    current.refreshRolePackPermissions();

    // ① 工具面：角色会话可见 search_knowledge（系统工具，不进 allToolNames）
    const toolNames = current.getToolRegistry().listTools().map((tool) => tool.name);
    expect(toolNames, 'E-J3 listTools 含 search_knowledge').toContain('search_knowledge');
    expect(current.getToolRegistry().allToolNames(), '系统工具不得被注册进原始清单').not.toContain(
      'search_knowledge',
    );

    // ② 真 SQLite 过滤：只有 scope 内 ∧ sensitivity=normal ∧ access_level=team 那一条可见
    const search = await current.getToolRegistry().execute('search_knowledge', { query: KEYWORD });
    expect(search.error, `E-J3 检索不得报错：${JSON.stringify(search.error)}`).toBeUndefined();
    expect(search['count'], 'E-J3 只允许 1 条可见').toBe(1);
    expect(resultIds(search)).toEqual([chunkVisible]);
    const ids = resultIds(search);
    expect(ids, 'E-J3 scope 外不得可见').not.toContain(chunkOutOfScope);
    expect(ids, 'E-J3 access_level=private 不得可见').not.toContain(chunkPrivate);
    expect(ids, 'E-J3 access_sensitivity=sensitive 不得可见').not.toContain(chunkSensitive);

    // ③ 真出站 messages（fake provider 捕获）：人设标题 ＋ 正文都进了 system 层
    await runTurn(current, '本轮请按岗位口径说明现金流');
    const system = lastOutboundSystem();
    expect(system, 'E-J3 出站 system 必须含岗位设定段').toContain(`## 岗位设定：${ROLE}`);
    expect(system, 'E-J3 人设正文必须真进提示词（不是只有标题）').toContain(PERSONA_SENTINEL);
    expect(current.getMessages()[0]?.content, '引擎内存视图与出站一致').toContain(PERSONA_SENTINEL);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 阶段④ 撤销（E-J4）
// ══════════════════════════════════════════════════════════════════════════════

describe('阶段④撤销 · 真 HTTP revoke ⇒ 200 ＋ usable 不含 ＋ 下一轮不注入 ＋ 知识工具 0 条', () => {
  it('E-J4 revoke 200；usable 不含；下一轮 system 无岗位设定段；search_knowledge 0 条；审计 revoked 恰 1 条；落库仍保留绑定意图', async () => {
    console.info('[E2E-1173][阶段④撤销] POST /api/role-packs/ops-e2e/approval {action:revoke}');
    const current = requireEngine();
    const res = await postApproval(ROLE, { action: 'revoke' }, tokenFor('admin'));
    expect(res.status, `撤销必须 200：${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body['ok']).toBe(true);
    expect(res.body['result']).toBe('revoked');
    expect(res.body['auditAction']).toBe(AUDIT_REVOKED);

    // ① 生效面即时失效
    expect(loadRolePacks().usable, 'E-J4 撤销后 usable 不含').not.toContain(ROLE);
    expect(existsSync(approvalPathOf(ROLE)), '撤销 = 记录删除（审计保留）').toBe(false);

    // ② 审计：revoked 恰 1 条；链仍 valid
    expect(AuditService.query(ORG, { action: AUDIT_REVOKED }), 'E-J4 审计 role_pack.revoked 恰 1 条').toHaveLength(1);
    expect(AuditService.getStore()?.verifyChain(ORG).valid, '撤销后链仍须 valid（撤销不等于断链）').toBe(true);

    // ③ 下一轮：人设复核失败 ⇒ 显式撤岗（引擎层"降级"判据）
    const personaResult = loadRolePackPersona(ROLE);
    expect(personaResult.ok, '撤销后必须解析失败（不再生效）').toBe(false);
    if (personaResult.ok) throw new Error('撤销后人设仍解析成功 —— 生效面没真失效');
    expect(['E_ROLE_PACK_NOT_APPROVED', 'E_ROLE_PACK_NOT_FOUND']).toContain(personaResult.code);

    outboundTurns = [];
    current.setRolePack(null); // 生产同形：每轮复核失败 ⇒ 传 null（不注入，但绑定意图保留）
    current.refreshRolePackPermissions();
    await runTurn(current, '撤销后本轮请继续');
    const system = lastOutboundSystem();
    expect(system, 'E-J4 撤销后不得再注入岗位设定段').not.toContain('## 岗位设定：');
    expect(system, 'E-J4 撤销后人设正文也不得残留').not.toContain(PERSONA_SENTINEL);

    // ④ 知识工具：拒绝型过滤（可见但 0 条），不回落全库
    const search = await current.getToolRegistry().execute('search_knowledge', { query: KEYWORD });
    expect(search.error, '工具本身仍可见（D7），不得报"未知工具"').toBeUndefined();
    expect(search['count'], 'E-J4 撤销后必须 0 条（拒绝型，不回落全库）').toBe(0);
    expect(resultIds(search)).toEqual([]);

    // ⑤ #1169 语义：降级轮落库**仍带绑定意图**（阶段⑤可用它恢复）
    degradedState = current.serialize();
    expect(degradedState.rolePackId, '降级轮落库不得丢绑定').toBe(ROLE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 阶段⑤ 恢复（E-J5）
// ══════════════════════════════════════════════════════════════════════════════

describe('阶段⑤恢复 · 再 approve ⇒ 200 ＋ 落库快照恢复后重新注入且无 degraded', () => {
  it('E-J5 再 approve 200；approved 累计 2 / revoked 1；serialize→fromState 后 system 再含人设；知识工具回到 1 条且无 degraded 标记', async () => {
    console.info('[E2E-1173][阶段⑤恢复] 再 approve → serialize/fromState 落库恢复 → 一轮真出站');
    const hash = contentHashOf(ROLE);
    const res = await postApproval(
      ROLE,
      { action: 'approve', scope: 'content', expectedContentHash: hash },
      tokenFor('admin'),
    );
    expect(res.status, `恢复审批必须 200：${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body['result']).toBe('approved');
    expect(loadRolePacks().usable, 'E-J5 恢复后 usable 再含').toContain(ROLE);

    // 审计计数（生命周期累计：approved 2 / revoked 1）
    expect(AuditService.query(ORG, { action: AUDIT_APPROVED }), 'E-J5 approved 累计 2 条').toHaveLength(2);
    expect(AuditService.query(ORG, { action: AUDIT_REVOKED }), 'E-J5 revoked 仍恰 1 条').toHaveLength(1);
    expect(AuditService.getStore()?.verifyChain(ORG).valid, 'E-J5 恢复后链仍 valid').toBe(true);

    // 落库恢复路径：serialize() → JSON（= state_json 形态）→ fromState（生产缓存未命中路径同形）
    expect(degradedState, '阶段④必须先产出落库快照').toBeDefined();
    const persisted: unknown = JSON.parse(JSON.stringify(degradedState));
    expect(typeof persisted).toBe('object');
    const state = persisted as EngineState;
    expect(state.rolePackId, '落库快照的绑定意图必须能在恢复时读到').toBe(ROLE);

    const personaResult = loadRolePackPersona(ROLE);
    expect(personaResult.ok, 'E-J5 恢复后必须能再解析人设面').toBe(true);
    if (!personaResult.ok) throw new Error(`恢复后人设解析失败：${personaResult.code} ${personaResult.reason}`);

    const restored = ConversationEngine.fromState(fakeProvider('（fake）恢复轮结论。'), state, {
      rolePack: personaResult.persona,
      sessionId: 'e2e-1173-session',
    });
    engine = restored;
    restored.refreshRolePackPermissions();

    outboundTurns = [];
    await runTurn(restored, '恢复审批后本轮请继续');
    const system = lastOutboundSystem();
    expect(system, 'E-J5 恢复后必须重新注入岗位设定段').toContain(`## 岗位设定：${ROLE}`);
    expect(system, 'E-J5 恢复后人设正文必须回来').toContain(PERSONA_SENTINEL);

    // 无 degraded：知识工具回到 1 条，且结果**不带** degraded 标记
    const search = await restored.getToolRegistry().execute('search_knowledge', { query: KEYWORD });
    expect(search.error, 'E-J5 恢复后检索不得报错').toBeUndefined();
    expect(search['count'], 'E-J5 恢复后知识面回到 1 条').toBe(1);
    expect(resultIds(search)).toEqual([chunkVisible]);
    expect(search['degraded'], 'E-J5 恢复轮不得是降级过滤面').toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E-J8 隔离锚点（完整回归由命令承担，见文件头）
// ══════════════════════════════════════════════════════════════════════════════

describe('E-J8 隔离 · 全程零写入真实仓库（回归的"不污染"锚点）', () => {
  it('E-J8 真实仓库 extensions/presets/roles/ops-e2e 与 .synova/approvals/ops-e2e.json 全程不存在', () => {
    const repoRoot = process.cwd();
    expect(
      existsSync(join(repoRoot, 'extensions', 'presets', 'roles', ROLE)),
      'E-J8 不得在真实仓库造岗位包（隔离红线）',
    ).toBe(false);
    expect(
      existsSync(join(repoRoot, '.synova', 'approvals', `${ROLE}.json`)),
      'E-J8 不得在真实仓库写审批记录（隔离红线）',
    ).toBe(false);
    // 夹具根内确实存在（否则上面的"不存在"是假绿）
    expect(existsSync(join(roleDirOf(ROLE), 'manifest.json'))).toBe(true);
    expect(existsSync(approvalPathOf(ROLE)), '生命周期末态 = 已恢复审批 ⇒ 记录在夹具根内').toBe(true);
  });
});
