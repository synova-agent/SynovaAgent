/**
 * tests/routes/conversations-role-output.test.ts — #1075 P2-3 岗位输出标准接线判据（真 HTTP）
 *
 * 断言对象 = **真实路由**（`src/routes/conversations.ts` 的 `POST /api/conversations` 与
 *   `POST /api/conversations/:id/messages`）：真 `express()` ＋ `listen(0)` ＋ `fetch` ＋ 真
 *   `jwtAuthMiddleware`/`signJwtToken` ＋ 真 better-sqlite3 `:memory:` ＋ fake provider
 *   （铁律 12：集成测试走真实路由，不 mock 管线）。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J3 非阻断（接线证据）：ops 回复缺其 `machine` 要求词 ⇒ HTTP **200**、回复照常返回（原文含于 SSE）、
 *      `log.warn` 一条 `contractId='role:ops'`（带 codes／fieldPaths／errorCount）、失败台账
 *      （`SYNOVA_OUTPUT_CONTRACT_SINK` 指临时文件）**新增恰好 1 条**记录（字段 codes／fieldPaths／
 *      errorCount；**无 `causes`** —— 现类型 `ValidationFailureRecord` 没有该字段）。
 *      负例：合标回复 ⇒ 不落账、无 `role:` 前缀 warn（证明不是"每轮恒 warn"）。
 *   J5 撤销即时：第一轮 approved ⇒ 落账 1 条；删 `ops` 审批记录；第二轮 ⇒ **不校验**（sink 无新增、
 *      无新增 `role:` warn）且回复照常 200。
 *   J7 无岗位零副作用：不带 `rolePackId` 的会话（首轮／续轮）⇒ 回复 200、**无** `role:` 前缀 warn、
 *      sink 无记录（与改动前逐字一致）。
 *   G2 可见性：`unverifiable` 非空 ⇒ 路由侧 `log.info` 一条（带 `unverifiableIds`，禁静默丢弃）。
 *   D9 回滚开关：`SYNOVA_ROLE_PACK_OUTPUT=off` ⇒ 跳过校验 ＋ `log.warn(degraded:true)`、不落账。
 *   L9 台账不去重（规格 §10-L9）：同一会话连续两轮违标 ⇒ 每轮一条（本批不改台账语义，显式钉死）。
 *
 * 🔴 roleId 只用 **非出厂 `ops`**：出厂三包只信代码锚（`FACTORY_APPROVALS`）⇒ 删记录不改变 approved，
 *   无法用来测 pending／撤销（规格 §4 J4/J5 注）。
 *
 * 隔离手法（不落仓）：`mkdtempSync` 造**仓库形状**临时根 ——
 *   `<tmp>/extensions/presets/roles/ops/` 六件（由真实包 `finance` 拷贝后改写 roleId；
 *   `acceptance-criteria.yaml` 换成本文件自带的 `machine` 夹具）＋
 *   `<tmp>/extensions/ontology/outcome/financial.json`（`manifest.refs` 的 `kind:file` 目标）＋
 *   `<tmp>/.synova/approvals/ops.json`（P2-1 `ApprovalRecord` 形状；`apv1:` 自绑定由本文件
 *   **独立实现**算出 —— 生产实现写错则本文件必红，不同源自证）。
 *   失败台账与本测试的日志都落临时目录。**禁写真仓 `.synova/` 与 `data/`**。
 *
 * 环境前提：`DEV_MODE=false` ＋ `JWT_SECRET` 定值（白名单分支会尝试验签并注入 `req.auth`）。
 *
 * @degraded 本文件对降级面的判据 = "仍 200 ＋ 留痕存在/不存在"；日志文案不作逐字断言（只断结构字段）。
 * @authority 判据归属 #1075 P2-3（规格 §4 J3/J5/J7/J8-1）。
 *
 * 已知限制：
 *   ① 只证"标准被检查了、失败被留痕"，**不证**产出质量提升（规格 §10-L7）；
 *   ② 不测真实模型（fake provider 定值回复），不测多轮长会话开销（§10-L8）；
 *   ③ 审批记录是**夹具**直写（P3 才有人审批写入面），不证审批写路径；
 *   ④ 台账去重语义不在本批（§10-L9），本文件只钉死"当前每轮一条"。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { Socket } from 'net';
import type Database from 'better-sqlite3';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { computeRolePackContentHash, ROLE_PACK_PIECES } from '../../src/init/role-pack-schema';

// ═══ hoisted mock 状态（vi.mock 工厂提升后仍可读写）═══
const mocks = vi.hoisted(() => ({
  /** fake provider 返回的回复文本（各用例可改） */
  replyText: { value: '（fake）已按口径给出结论。' },
}));

/** 日志运行期捕获（G2：失败必 warn；unverifiable 必 info；隐私：正文不得入日志） */
const logCalls = vi.hoisted(() => [] as { level: string; meta?: Record<string, unknown>; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const make = (level: string) => (meta?: Record<string, unknown>, msg?: unknown) => {
    logCalls.push({ level, meta, msg });
  };
  const m = {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
  };
  return { logger: m, createLogger: () => m };
});

// ── mock ① providers：fake 流式 provider（形态对齐 tests/routes/conversations-role.test.ts）──
// importOriginal spread：server.ts import 链上 llm-config.ts 模块级消费 listProviderTypes()，
// 全量替换会炸模块装载 —— 只覆写 createProvider，其余导出保真
vi.mock('../../src/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers')>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake-p23-output-provider',
      baseUrl: 'fake://p23-role-output',
      async chat(messages: Array<{ role: string; content: unknown }>) {
        // 消费 messages 只为对齐 provider 契约（本文件不断言提示词内容）
        void messages.length;
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

// ── mock ② config：定值 ＋ 内存库 ＋ **orgId 定值**（审批判定的租户字段）──
// `resolveOrgId()` 读 `loadConfig().orgId` 并进程内缓存 ⇒ 夹具审批记录的 orgId 必须与它逐字相同。
vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config')>();
  return {
    ...actual,
    loadConfig: () => ({
      llmApiKey: 'test-key',
      llmBaseUrl: 'http://localhost:1',
      llmModel: 'test-model',
      dbPath: ':memory:',
      devMode: false,
      orgId: 'default',
    }),
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// SSE / 网络 helpers（照 tests/routes/conversations.test.ts 骨架）
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

/** 等待 server 就绪并返回 baseUrl */
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
/** 基线模板包（真实包拷过来改写 roleId，比手写六件更容易过 P2-1 的 v3 结构 ＋ refs 三方对账） */
const TEMPLATE_ROLE_DIR = join(REPO_ROOT, 'extensions', 'presets', 'roles', 'finance');
/** `manifest.refs` 里 `kind:file` 的目标（路径相对仓库根；夹具里放在临时根的同名位置） */
const TEMPLATE_FILE_REF = join(REPO_ROOT, 'extensions', 'ontology', 'outcome', 'financial.json');

const ORG = 'default';
const FIXED_AT = '2026-10-28T12:00:00.000Z';
const APPROVER_ID = 'u_p23_output';
const APPROVER_ROLE = 'super-admin';
/** 夹具岗位（**非出厂**：出厂三包只信代码锚，删记录不撤销） */
const ROLE = 'ops';
const JWT_SECRET_VALUE = 'p23-route-output-secret-0123456789abcdef';

/** 违标回复（不含「报告期」⇒ 命中 `ac.period-declared` 的 textPattern） */
const VIOLATING_REPLY = '（fake）已按口径给出结论，详见下表。';
/** 合标回复（含「报告期」） */
const COMPLIANT_REPLY = '报告期：2026-Q3。已按口径给出结论，详见下表。';

/** `ops` 的 acceptance-criteria.yaml（1 条 machine ＋ 1 条散文 ⇒ unverifiable 面可断言） */
const CRITERIA_YAML = `# ${ROLE}/acceptance-criteria.yaml — #1075 P2-3 夹具（machine 为 additive 字段）
roleId: ${ROLE}
version: 1.0.0
criteria:
  - id: ac.period-declared
    text: 每个结论都带报告期
    check: 正文含「报告期」
    machine:
      kind: textPattern
      pattern: '报告期'
  - id: ac.no-fabrication
    text: 数据不足时列出缺口，不编造
    check: emptyState 被遵守
`;

let fixtureRoot = '';
let presetsRoot = '';
let sinkPath = '';
let db: Database.Database;
let server: Server;
let baseUrl = '';
let sockets: Socket[] = [];

const ORIGINAL_DEV_MODE = process.env.DEV_MODE;
const ORIGINAL_JWT = process.env.JWT_SECRET;
const ORIGINAL_PRESETS_ROOT = process.env.SYNOVA_PRESETS_ROOT;
const ORIGINAL_SINK = process.env.SYNOVA_OUTPUT_CONTRACT_SINK;
const ORIGINAL_ROLLBACK = process.env.SYNOVA_ROLE_PACK_OUTPUT;

function trackConnections(srv: Server): void {
  srv.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('close', () => { sockets = sockets.filter((s) => s !== socket); });
  });
}

/** 逐字替换文本文件内容（夹具改写；命中数不作断言） */
function rewriteText(file: string, pairs: ReadonlyArray<readonly [string, string]>): void {
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of pairs) text = text.split(from).join(to);
  writeFileSync(file, text, 'utf8');
}

/**
 * 夹具 `context-manifest.yaml`（生成而非改写模板：要控制 contexts 条数）。
 * sources 与模板 `manifest.refs` 的三条一一对应（file／scope／profile）⇒ 三方对账通过。
 */
function contextManifestFor(roleId: string): string {
  return `# ${roleId}/context-manifest.yaml — #1075 P2-3 夹具（只注入清单指针，不注入内容）
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
    P23_OUTPUT_ADDENDUM：所有结论必须标明报告期与口径来源。
`;
}

/** 六件内容指纹（夹具审批记录用；与 P2-1 生产同一纯核函数，raw bytes 语义） */
function contentHashOf(roleDir: string): string {
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

/** 造夹具岗位包（拷模板 → 改写 roleId → 换 criteria → 写审批记录） */
function writeRolePack(roleId: string): void {
  const roleDir = join(presetsRoot, 'roles', roleId);
  cpSync(TEMPLATE_ROLE_DIR, roleDir, { recursive: true });
  rewriteText(join(roleDir, 'manifest.json'), [['"roleId": "finance"', `"roleId": "${roleId}"`]]);
  rewriteText(join(roleDir, 'knowledge-scope.yaml'), [['roleId: finance', `roleId: ${roleId}`]]);
  rewriteText(join(roleDir, 'capabilities.yaml'), [['roleId: finance', `roleId: ${roleId}`]]);
  writeFileSync(join(roleDir, 'context-manifest.yaml'), contextManifestFor(roleId), 'utf8');
  // 🔴 判据来源换成夹具自带的 machine（真实 finance 的 machine 由 T1 同批落入，本文件不依赖其具体 pattern）
  writeFileSync(join(roleDir, 'acceptance-criteria.yaml'), CRITERIA_YAML, 'utf8');
  writeApprovalRecord(roleId);
}

// ══════════════════════════════════════════════════════════════════════════════
// 台账／日志 helpers
// ══════════════════════════════════════════════════════════════════════════════

/** 读失败台账（JSONL）；不存在 ⇒ `[]` */
function sinkRecords(): Record<string, unknown>[] {
  if (!existsSync(sinkPath)) return [];
  const text = readFileSync(sinkPath, 'utf8').trim();
  if (text === '') return [];
  return text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * **路由接线留痕**的 warn（`audit:'rolePackOutput'` 标记）。
 *
 * 🔴 为什么加标记：`validateContractObject()` 内部也会打一条同 `contractId` 的**引擎通用留痕**
 *   （"已拒绝 + 落账" = 契约引擎既有第二职务）。J3 数的是**接线留痕**这一条；引擎那条另有断言
 *   （证明落账路径真的被走到）。两者业务码/字段一致 —— 见 `conversations.ts` 已知限制 l.。
 */
function outputStandardWarns(): { level: string; meta?: Record<string, unknown>; msg?: unknown }[] {
  return logCalls.filter(
    (call) => call.level === 'warn' && call.meta?.['audit'] === 'rolePackOutput',
  );
}

/** 引擎侧通用留痕（证明"失败→落账"第二职务被走到） */
function engineValidationWarns(): { level: string; meta?: Record<string, unknown>; msg?: unknown }[] {
  return logCalls.filter(
    (call) =>
      call.level === 'warn' &&
      call.meta?.['audit'] === undefined &&
      String(call.meta?.['contractId']).startsWith('role:') &&
      Array.isArray(call.meta?.['codes']),
  );
}

/** 是否出现过 `role:` 前缀的 warn（J7 零副作用判据；路由侧与引擎侧都算） */
function hasRolePrefixedWarn(): boolean {
  return logCalls.some(
    (call) => call.level === 'warn' && String(call.meta?.['contractId']).startsWith('role:'),
  );
}

/** 路由侧 unverifiable 可见性 info（带 `unverifiableIds` 与 `rolePackId`） */
function unverifiableInfos(): { level: string; meta?: Record<string, unknown>; msg?: unknown }[] {
  return logCalls.filter(
    (call) =>
      call.level === 'info' &&
      call.meta?.['rolePackId'] === ROLE &&
      Array.isArray(call.meta?.['unverifiableIds']),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP helpers（真 fetch；Bearer 可选）
// ══════════════════════════════════════════════════════════════════════════════

type AuthModule = typeof import('../../src/middleware/auth');
let auth: AuthModule;

function tokenFor(role: string): string {
  const signed = auth.signJwtToken({ sub: `${role}-p23`, role, orgId: ORG });
  expect(signed, `夹具失败：${role} token 签发返回 null（JWT_SECRET 未生效？）`).not.toBeNull();
  return signed ?? '';
}

function authHeader(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

async function postConversation(
  body: Record<string, unknown>,
  token: string | undefined,
): Promise<Response> {
  return fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(body),
  });
}

async function postToSession(
  sessionId: string,
  body: Record<string, unknown>,
  token: string | undefined,
): Promise<Response> {
  return fetch(`${baseUrl}/api/conversations/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(body),
  });
}

/** 建一个**已绑定岗位**的会话（第一轮成功 ⇒ 落库带 rolePackId） */
async function createBoundSession(): Promise<string> {
  const res = await postConversation({ message: '创建岗位会话：请按岗位口径回答', rolePackId: ROLE }, tokenFor('admin'));
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
  fixtureRoot = mkdtempSync(join(tmpdir(), 'p23-route-output-'));
  presetsRoot = join(fixtureRoot, 'extensions', 'presets');
  sinkPath = join(fixtureRoot, 'output-contract-failures.jsonl');
  mkdirSync(join(presetsRoot, 'roles'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'extensions', 'ontology', 'outcome'), { recursive: true });
  cpSync(TEMPLATE_FILE_REF, join(fixtureRoot, 'extensions', 'ontology', 'outcome', 'financial.json'));
  writeRolePack(ROLE);
  process.env.SYNOVA_PRESETS_ROOT = presetsRoot;
  process.env.SYNOVA_OUTPUT_CONTRACT_SINK = sinkPath;

  // 真 sqlite :memory:（engine-context 建库；路由经 app.locals.orchestration.db 消费同一句柄）
  const { initEngineContext, getDatabase } = await import('../../src/init/engine-context');
  initEngineContext();
  db = getDatabase();

  auth = await import('../../src/middleware/auth');
  const conversationsRouter = (await import('../../src/routes/conversations')).default;

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
  for (const [key, original] of [
    ['DEV_MODE', ORIGINAL_DEV_MODE],
    ['JWT_SECRET', ORIGINAL_JWT],
    ['SYNOVA_PRESETS_ROOT', ORIGINAL_PRESETS_ROOT],
    ['SYNOVA_OUTPUT_CONTRACT_SINK', ORIGINAL_SINK],
    ['SYNOVA_ROLE_PACK_OUTPUT', ORIGINAL_ROLLBACK],
  ] as const) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  if (fixtureRoot !== '') rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.replyText.value = VIOLATING_REPLY;
  logCalls.length = 0;
  // 每例从"零台账"起步（J3 断言"恰好 1 条"的基线）
  rmSync(sinkPath, { force: true });
  // 审批记录幂等复位（J5 的撤销不污染后续用例）
  writeApprovalRecord(ROLE);
  delete process.env.SYNOVA_ROLE_PACK_OUTPUT;
});

afterEach(() => {
  delete process.env.SYNOVA_ROLE_PACK_OUTPUT;
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 · 非阻断（接线证据：200 ＋ 回复照常 ＋ warn ＋ 落账恰好 1 条）
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 非阻断接线（真实路由 ＋ fake provider）', () => {
  it('J3-1 违标回复 ⇒ 200／回复照常／warn contractId=role:ops／落账恰好 1 条（无 causes）', async () => {
    const res = await postConversation({ message: '第一轮：请按岗位口径回答', rolePackId: ROLE }, tokenFor('admin'));

    // ① 非阻断：仍是 200 ＋ SSE，且回复原文照常出现在流里（未被拒、未被改写）
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain(VIOLATING_REPLY);

    // ② 留痕：一条 `contractId='role:ops'` 的 warn，带 codes／fieldPaths／errorCount
    const warns = outputStandardWarns();
    expect(warns).toHaveLength(1);
    const meta = warns[0]?.meta ?? {};
    expect(meta['contractId']).toBe(`role:${ROLE}`);
    expect(meta['codes']).toEqual([`role:${ROLE}.text.role.ac.period-declared`]);
    expect(meta['fieldPaths']).toEqual(['role.ac.period-declared']);
    expect(meta['errorCount']).toBe(1);
    expect(meta['degraded']).toBe(true);
    // 隐私：日志不带回复正文
    expect(JSON.stringify(meta)).not.toContain('已按口径给出结论');

    // ③ 落账：新增恰好 1 条；字段＝codes／fieldPaths／errorCount；**无 causes**（现类型没有该字段）
    const records = sinkRecords();
    expect(records).toHaveLength(1);
    const record = records[0] ?? {};
    expect(record['codes']).toEqual([`role:${ROLE}.text.role.ac.period-declared`]);
    expect(record['fieldPaths']).toEqual(['role.ac.period-declared']);
    expect(record['errorCount']).toBe(1);
    expect('causes' in record).toBe(false);
    // 隐私：台账不写产出正文
    expect(JSON.stringify(record)).not.toContain('已按口径给出结论');

    // ④ 引擎通用留痕也被走到（"失败 → 落账"第二职务；同一业务码）
    const engineWarns = engineValidationWarns();
    expect(engineWarns).toHaveLength(1);
    expect(engineWarns[0]?.meta?.['contractId']).toBe(`role:${ROLE}`);
    expect(engineWarns[0]?.meta?.['codes']).toEqual([`role:${ROLE}.text.role.ac.period-declared`]);
  });

  it('J3-2 合标回复 ⇒ 不落账、无 `role:` 前缀 warn（负例：不是"每轮恒 warn"）', async () => {
    mocks.replyText.value = COMPLIANT_REPLY;

    const res = await postConversation({ message: '合标一轮', rolePackId: ROLE }, tokenFor('admin'));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(COMPLIANT_REPLY);
    expect(sinkRecords()).toEqual([]);
    expect(hasRolePrefixedWarn()).toBe(false);
  });

  it('J3-3 unverifiable 可见 ⇒ 路由侧 log.info 一条（带 unverifiableIds；禁静默丢弃）', async () => {
    const res = await postConversation({ message: '可见性一轮', rolePackId: ROLE }, tokenFor('admin'));
    expect(res.status).toBe(200);
    await res.text(); // drain

    const infos = unverifiableInfos();
    expect(infos.length).toBeGreaterThanOrEqual(1);
    expect(infos[0]?.meta?.['unverifiableIds']).toContain('ac.no-fabrication');
    expect(infos[0]?.meta?.['contractId']).toBe(`role:${ROLE}`);
  });

  it('J3-4 回滚开关 SYNOVA_ROLE_PACK_OUTPUT=off ⇒ 跳过 ＋ warn(degraded) ＋ 不落账', async () => {
    process.env.SYNOVA_ROLE_PACK_OUTPUT = 'off';

    const res = await postConversation({ message: '开关关闭一轮', rolePackId: ROLE }, tokenFor('admin'));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(VIOLATING_REPLY);
    // 显式降级：有一条带 env ＋ degraded:true 的 warn
    const rollbackWarns = logCalls.filter(
      (call) => call.level === 'warn' && call.meta?.['env'] === 'SYNOVA_ROLE_PACK_OUTPUT',
    );
    expect(rollbackWarns).toHaveLength(1);
    expect(rollbackWarns[0]?.meta?.['degraded']).toBe(true);
    // 跳过 = 不编译也不校验 ⇒ 无台账、无 `role:` 前缀 warn
    expect(sinkRecords()).toEqual([]);
    expect(hasRolePrefixedWarn()).toBe(false);
  });

  it('J3-5 连续两轮违标 ⇒ 每轮一条（规格 §10-L9：台账不去重，本批不改语义）', async () => {
    const sessionId = await createBoundSession();
    expect(sinkRecords()).toHaveLength(1);

    const second = await postToSession(sessionId, { message: '违标第二轮' }, tokenFor('admin'));
    expect(second.status).toBe(200);
    await second.text(); // drain

    expect(sinkRecords()).toHaveLength(2);
    expect(outputStandardWarns()).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J5 · 撤销即时（非出厂 ops；出厂包恒 approved，不能用来测撤销）
// ══════════════════════════════════════════════════════════════════════════════

describe('J5 撤销即时（删审批记录 ⇒ 下一轮不再校验）', () => {
  it('J5-1 第一轮 approved ⇒ 落账 1 条；删记录 ⇒ 第二轮无新增 sink／无新增 warn 且 200', async () => {
    const sessionId = await createBoundSession();
    expect(sinkRecords()).toHaveLength(1);

    removeApprovalRecord(ROLE);
    logCalls.length = 0;

    const second = await postToSession(sessionId, { message: '撤销后第二轮' }, tokenFor('admin'));
    const body = await second.text();
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain(VIOLATING_REPLY);
    // 撤销即时：本轮不校验（台账不新增、无 `role:` 前缀 warn）
    expect(sinkRecords()).toHaveLength(1);
    expect(hasRolePrefixedWarn()).toBe(false);
    expect(unverifiableInfos()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J7 · 无岗位零副作用（与改动前逐字一致）
// ══════════════════════════════════════════════════════════════════════════════

describe('J7 无岗位会话零副作用', () => {
  it('J7-1 首轮不带 rolePackId ⇒ 200、无 `role:` 前缀 warn、台账无记录', async () => {
    const res = await postConversation({ message: '无岗位首轮' }, undefined);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain(VIOLATING_REPLY);
    expect(hasRolePrefixedWarn()).toBe(false);
    expect(outputStandardWarns()).toHaveLength(0);
    expect(sinkRecords()).toEqual([]);
    expect(unverifiableInfos()).toHaveLength(0);
  });

  it('J7-2 无岗位会话续轮 ⇒ 同样零副作用（无编译、无校验、无留痕）', async () => {
    const first = await postConversation({ message: '无岗位首轮' }, undefined);
    expect(first.status).toBe(200);
    const sessionId = requireSessionId(parseSse(await first.text()));
    logCalls.length = 0;

    const second = await postToSession(sessionId, { message: '无岗位续轮' }, undefined);

    expect(second.status).toBe(200);
    expect(await second.text()).toContain(VIOLATING_REPLY);
    expect(sinkRecords()).toEqual([]);
    expect(outputStandardWarns()).toHaveLength(0);
  });
});
