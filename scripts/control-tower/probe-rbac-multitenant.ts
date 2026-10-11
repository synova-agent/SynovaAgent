#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-rbac-multitenant.ts — K12-09 (#192 / 原 RB-01)
 * 多租户隔离**判据测量件**：跨 orgId 读必须被拒（含 DevMode 姿态）
 *
 * 判据来源（登记件 `RB-01`）:
 *   `npx tsx scripts/control-tower/probe-rbac-multitenant.ts --case cross-org` ⇒ expectExit 0
 *
 * 测什么（卡面 Q3 · V1–V5）:
 *   · V1/V2 **穿生产入口**：起真 express app，复现生产挂载顺序（`server.ts:396`
 *     `app.use(jwtAuthMiddleware)` 在路由之前），请求穿过**真实中间件**后落到一个
 *     静态的"读端点"——只看中间件有没有放行，不看端点内部（端点不是判据对象）。
 *   · V3 **DevMode 姿态**：`DEV_MODE=true` 且无 `JWT_SECRET` 时，跨 orgId 读**仍必须被拒**。
 *   · V5 **留痕**：每次拒绝必须带稳定 `code`（`CROSS_ORG_FORBIDDEN`）+ 归属
 *     （`declaredOrgId` / `authOrgId`），不得静默、不得伪装 404。
 *
 * 契约（铁律 47）:
 *   @input  — CLI: `--case <name>...`（用例名，可重复；缺省 = 全部）/ `--json`（机器可读输出）。
 *             环境: `JWT_SECRET` / `DEV_MODE` / `SYNOVA_ORG_ID` —— 探针按用例**临时改写**
 *             并在结束时逐个还原（不留副作用）。
 *   @output — stdout 逐用例 `[PASS]`/`[FAIL]` 行 + 末尾汇总 `N/M 用例符合预期`；HTTP 请求
 *             走 `127.0.0.1` 随机端口（仅回环，不对外）。退出码见下。
 *   @degraded — 无。探针本身不产生降级放行：任何"判定不可用"都按 `[FAIL]` 计入退出码 1，
 *             绝不静默跳过用例（真实加载/比对失败同样计入）。
 *
 * 退出码: 0 = 全部被测用例符合预期；1 = 有不符合 / 用例名不存在 / 零用例被执行（fail-closed）；
 *         2 = 探针自身异常（真 app 起不来等）
 *
 * @note 本文件为卡面 Q2 写集内的**新增探针**（`probe-rbac-multitenant.ts` 卡面明列）。
 *       不改任何既有门禁脚本、不改"哪条检查阻断合并"的语义。
 *       ⚠️ 仓规：`scripts/control-tower/probe-*.ts` 由 K12-21 (#205) 统一交付；
 *       本件由 #192 卡面 Q2 授权入库，从 `origin/fix/k12-21-probe-ladder` 取用的**其它**探针
 *       一律不进本分支（已写入 `.git/info/exclude`，见交付回执）。
 */
import express from 'express';
import { createServer, type Server } from 'http';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';

// ════════════════════════════════════════════════════════════════
// 用例模型
// ════════════════════════════════════════════════════════════════

/** 探针被测的两种姿态（卡面 V2 / V3） */
type Posture = 'prod' | 'devmode';

interface ProbeCase {
  /** `--case` 选用例的名字（唯一） */
  name: string;
  /** 判据意图（报告里逐条打印，便于审计对照卡面） */
  intent: string;
  posture: Posture;
  /** 实例组织（`SYNOVA_ORG_ID`），缺省由姿态表决定 */
  instanceOrgId?: string;
  /** 请求基座：验签身份的组织 */
  identityOrgId?: string;
  /** 是否附带一枚**无法验签**的 Bearer（DevMode 态下的姿态面） */
  withUnverifiableBearer?: boolean;
  /** 请求声明的目标组织（`X-Org-Id` 头） */
  declaredOrgId?: string;
  /** 期望 HTTP 状态码 */
  expectStatus: number;
  /** 期望的机器可读拒绝码（放行用例为 undefined） */
  expectCode?: string;
  /** 期望的归属字段（`authOrgId` / `declaredOrgId`），逐项断言 */
  expectAuthOrgId?: string;
  expectDeclaredOrgId?: string;
}

/** 探针不可用的凭据字面量：结构像 JWT 但签名不可验（`getSecret()` 也取不到密钥） */
const UNVERIFIABLE_BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.AAAA';

const PROD_SECRET = 'k12-09-probe-secret-0123456789abcdef';

const CASES: ProbeCase[] = [
  {
    name: 'single-tenant',
    intent: 'V2 正常路径: 同组织声明 ⇒ 放行（判据不得误伤单租户读写）',
    posture: 'prod',
    instanceOrgId: 'org-a',
    identityOrgId: 'org-a',
    declaredOrgId: 'org-a',
    expectStatus: 200,
  },
  {
    name: 'no-declaration',
    intent: 'V2 正常路径: 未声明目标组织 ⇒ 放行（原语义零回归）',
    posture: 'prod',
    instanceOrgId: 'org-a',
    identityOrgId: 'org-a',
    expectStatus: 200,
  },
  {
    name: 'cross-org',
    intent: 'V2 核心判据: 跨租户读声明 ⇒ **被拒**（403 + CROSS_ORG_FORBIDDEN + 归属）',
    posture: 'prod',
    instanceOrgId: 'org-a',
    identityOrgId: 'org-a',
    declaredOrgId: 'org-b',
    expectStatus: 403,
    expectCode: 'CROSS_ORG_FORBIDDEN',
    expectAuthOrgId: 'org-a',
    expectDeclaredOrgId: 'org-b',
  },
  {
    name: 'cross-org-reverse',
    intent: 'V2 对称性: 反向声明 ⇒ 同样被拒（判据不偏向任何一方）',
    posture: 'prod',
    instanceOrgId: 'org-b',
    identityOrgId: 'org-b',
    declaredOrgId: 'org-a',
    expectStatus: 403,
    expectCode: 'CROSS_ORG_FORBIDDEN',
    expectAuthOrgId: 'org-b',
    expectDeclaredOrgId: 'org-a',
  },
  {
    name: 'cross-org-dev-mode',
    intent: 'V3 姿态判据: DEV_MODE=true 且无 JWT_SECRET ⇒ 跨 orgId 读**仍必须被拒**',
    posture: 'devmode',
    instanceOrgId: 'org-a',
    declaredOrgId: 'org-b',
    expectStatus: 403,
    expectCode: 'CROSS_ORG_FORBIDDEN',
    expectAuthOrgId: 'org-a',
    expectDeclaredOrgId: 'org-b',
  },
  {
    name: 'dev-mode-same-tenant',
    intent: 'V3 正常路径: DevMode 同租户 ⇒ 放行（姿态只提权单租户内，不得误伤）',
    posture: 'devmode',
    instanceOrgId: 'org-a',
    declaredOrgId: 'org-a',
    expectStatus: 200,
  },
  {
    name: 'dev-mode-bad-bearer',
    intent: 'V3 姿态漏洞面: DevMode + 不可验签凭据 + 声明异组织 ⇒ 仍被拒（白名单/兜底不得开洞）',
    posture: 'devmode',
    instanceOrgId: 'org-a',
    withUnverifiableBearer: true,
    declaredOrgId: 'org-b',
    expectStatus: 403,
    expectCode: 'CROSS_ORG_FORBIDDEN',
    expectAuthOrgId: 'org-a',
  },
  {
    name: 'prod-no-identity',
    intent: 'V2 fail-closed: 非白名单路径 + 显式声明目标组织但无凭据 ⇒ 拒绝（401 认证层先拦，仍未放行）',
    posture: 'prod',
    instanceOrgId: 'org-a',
    declaredOrgId: 'org-b',
    // 说明（探针实测修正）: 非白名单路径上"无凭据"在**认证分支**即被拒（401 UNAUTHORIZED）——
    // 隔离判定位于验签之后，故本用例到不了 CROSS_ORG_FORBIDDEN。拒绝依然成立（fail-closed），
    // 只是拒绝理由由更早的闸给出。真正走到隔离判定的"无身份 + 有声明"情形见测试文件
    // 的 V2-⑥（白名单前缀路径 ⇒ 403 CROSS_ORG_FORBIDDEN）。
    expectStatus: 401,
    expectCode: 'UNAUTHORIZED',
  },
];

// ════════════════════════════════════════════════════════════════
// 环境与夹具
// ════════════════════════════════════════════════════════════════

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of keys) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** 按姿态安装环境（调用方负责用 `snapshotEnv`/`restoreEnv` 包住） */
function applyPosture(posture: Posture, instanceOrgId: string | undefined): void {
  process.env['SYNOVA_ORG_ID'] = instanceOrgId ?? 'default';
  process.env['LOG_LEVEL'] = 'silent';
  if (posture === 'prod') {
    process.env['JWT_SECRET'] = PROD_SECRET;
    delete process.env['DEV_MODE'];
  } else {
    // DevMode 姿态的**定义**就是"无 JWT_SECRET"（否则中间件不会走自动 admin 分支）
    delete process.env['JWT_SECRET'];
    process.env['DEV_MODE'] = 'true';
  }
}

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/** 起真 app（生产挂载顺序）并发一次请求；只回环监听 */
async function probeOnce(
  testCase: ProbeCase,
  tokenFor: (orgId: string) => string,
): Promise<HttpResult> {
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  // 静态"读端点"：判据对象是**中间件是否放行**，端点内部不参与判定
  app.all('/api/tenancy/probe-read', (_req, res) => {
    res.json({ ok: true, route: 'probe-read' });
  });

  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => { resolve(); });
    server.once('error', reject);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (testCase.withUnverifiableBearer) {
    headers['authorization'] = `Bearer ${UNVERIFIABLE_BEARER}`;
  } else if (testCase.identityOrgId) {
    headers['authorization'] = `Bearer ${tokenFor(testCase.identityOrgId)}`;
  }
  if (testCase.declaredOrgId) headers['x-org-id'] = testCase.declaredOrgId;

  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/tenancy/probe-read`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const parsed: unknown = await res.json();
    const body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  }
}

// ════════════════════════════════════════════════════════════════
// 判定
// ════════════════════════════════════════════════════════════════

interface CaseOutcome {
  name: string;
  intent: string;
  pass: boolean;
  problems: string[];
  observed: HttpResult | null;
}

/** 逐条比对期望与实际；**空 problems ⇒ 通过**（无"部分通过"这一态） */
function judge(testCase: ProbeCase, observed: HttpResult): string[] {
  const problems: string[] = [];
  if (observed.status !== testCase.expectStatus) {
    problems.push(`status: 期望 ${String(testCase.expectStatus)} 实测 ${String(observed.status)}`);
  }
  if (testCase.expectCode !== undefined && observed.body['code'] !== testCase.expectCode) {
    problems.push(`code: 期望 ${testCase.expectCode} 实测 ${String(observed.body['code'])}`);
  }
  if (testCase.expectAuthOrgId !== undefined && observed.body['authOrgId'] !== testCase.expectAuthOrgId) {
    problems.push(`authOrgId: 期望 "${testCase.expectAuthOrgId}" 实测 "${String(observed.body['authOrgId'])}"`);
  }
  if (testCase.expectDeclaredOrgId !== undefined && observed.body['declaredOrgId'] !== testCase.expectDeclaredOrgId) {
    problems.push(`declaredOrgId: 期望 "${testCase.expectDeclaredOrgId}" 实测 "${String(observed.body['declaredOrgId'])}"`);
  }
  return problems;
}

async function runCase(testCase: ProbeCase): Promise<CaseOutcome> {
  const snap = snapshotEnv(['JWT_SECRET', 'DEV_MODE', 'SYNOVA_ORG_ID', 'LOG_LEVEL']);
  try {
    applyPosture(testCase.posture, testCase.instanceOrgId);
    // 签发用密钥必须与"当前环境是否可验签"一致：prod 姿态用 PROD_SECRET；
    // devmode 姿态下**不存在**可验签凭据（这正是该姿态的定义），故不签发。
    const tokenFor = (orgId: string): string => {
      const token = signJwtToken({ sub: 'probe-user', role: 'admin', orgId });
      if (!token) throw new Error(`探针自证失败: signJwtToken 返回 null（orgId=${orgId}，posture=${testCase.posture}）`);
      return token;
    };
    const observed = await probeOnce(testCase, tokenFor);
    const problems = judge(testCase, observed);
    return { name: testCase.name, intent: testCase.intent, pass: problems.length === 0, problems, observed };
  } finally {
    restoreEnv(snap);
  }
}

// ════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════

function parseArgs(argv: string[]): { names: string[]; json: boolean } {
  const names: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--case') {
      const value = argv[i + 1];
      if (!value) throw new Error('--case 缺少用例名');
      names.push(value);
      i += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--list') {
      for (const c of CASES) process.stdout.write(`${c.name}\t${c.intent}\n`);
      process.exit(0);
    } else if (arg.startsWith('--case=')) {
      names.push(arg.slice('--case='.length));
    } else {
      throw new Error(`未识别参数: ${arg}（用法: --case <name>... / --json / --list）`);
    }
  }
  return { names, json };
}

async function main(): Promise<number> {
  let args: { names: string[]; json: boolean };
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err: unknown) {
    process.stderr.write(`探针入参错误: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const selected = args.names.length > 0 ? CASES.filter((c) => args.names.includes(c.name)) : CASES;
  if (selected.length === 0) {
    // fail-closed: 选不到用例 ≠ 通过（静默跳过 = 假绿）
    process.stderr.write(`未匹配任何用例，已注册: ${CASES.map((c) => c.name).join(', ')}\n`);
    return 1;
  }
  const unknown = args.names.filter((n) => !CASES.some((c) => c.name === n));
  if (unknown.length > 0) {
    process.stderr.write(`用例名不存在: ${unknown.join(', ')}（可用: ${CASES.map((c) => c.name).join(', ')}）\n`);
    return 1;
  }

  const outcomes: CaseOutcome[] = [];
  for (const testCase of selected) {
    /* eslint-disable no-await-in-loop */ // 真 HTTP + 进程级 env 改写 ⇒ 必须串行（并发会互相污染姿态）
    outcomes.push(await runCase(testCase));
  }

  const failed = outcomes.filter((o) => !o.pass);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      probe: 'probe-rbac-multitenant',
      issue: '#192 K12-09',
      total: outcomes.length,
      passed: outcomes.length - failed.length,
      failed: failed.length,
      cases: outcomes.map((o) => ({
        name: o.name,
        intent: o.intent,
        pass: o.pass,
        problems: o.problems,
        observed: o.observed,
      })),
    }, null, 2)}\n`);
  } else {
    process.stdout.write('=== probe-rbac-multitenant（K12-09 #192 / RB-01）===\n');
    for (const o of outcomes) {
      process.stdout.write(`${o.pass ? '[PASS]' : '[FAIL]'} ${o.name} — ${o.intent}\n`);
      if (o.observed) {
        process.stdout.write(`       实测: status=${String(o.observed.status)} code=${String(o.observed.body['code'] ?? '-')} authOrgId=${String(o.observed.body['authOrgId'] ?? '-')} declaredOrgId=${String(o.observed.body['declaredOrgId'] ?? '-')}\n`);
      } else {
        process.stdout.write('       实测: <未取得响应>\n');
      }
      for (const p of o.problems) process.stdout.write(`       ↳ 不符: ${p}\n`);
    }
    process.stdout.write(`\n${String(outcomes.length - failed.length)}/${String(outcomes.length)} 用例符合预期\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err: unknown) => {
    process.stderr.write(`探针自身异常: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 2;
  });
