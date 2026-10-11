/**
 * tests/security/department-request-path.test.ts — K12-10-WIRE 请求路径部门身份判据
 *
 * 被测件: `src/middleware/auth.ts` 的 `jwtAuthMiddleware`（**请求路径唯一接线点**）
 *         ＋ `src/services/request-context.ts` 的 `getCurrentDepartmentIds`（消费面）
 *
 * 缺口（本卡要收的口，基线实测原始输出）:
 *   真 express ＋ 真中间件 ＋ 真 HTTP ⇒ `{"userSeen":"u-baseline","depts":[]}`
 *   ⇒ 请求上下文本身是通的，但**部门轴未进请求路径**（`resolved` 从未被塞进上下文）。
 *
 * 🔴 判据设计红线（创始人 2026-10-11 四条硬要求）:
 *   ① **不许词法扫描** —— 本文件**零**源码文本扫描、零 grep 断言。每条判据都
 *      **真跑流程 ＋ 断言真变化**（真 express app ＋ 真 `jwtAuthMiddleware` ＋
 *      真 HTTP 请求 ＋ 真 `getCurrentDepartmentIds()` 取值）。
 *   ② **「接上」≠「会跑」** —— 断言发生在**该请求的上下文内部**（由路由处理器在
 *      请求处理期间取值），不是"import 到了"或"boot 层验过了"。
 *   ③ **改坏即红** —— 每条判据都配一条**已实测的**反例（见文件内 `反例实测` 注释）。
 *   ④ **反例本身也要被验** —— 反例必须给出具体失败点。本卡实测中发现过一条
 *      **"永远绿的假反例"**（吞掉降级日志 ⇒ 其余判据全绿）⇒ 已改判据形态（见 V4 段）。
 *
 * 立场（本卡关键判断）: 部门身份**只**取受签名保护的 JWT 载荷，**不取请求头**。
 *   依据 = `src/middleware/auth.ts` 的 P0 不变量「注入 `req.auth`/上下文的只能是
 *   **验签身份**，任何自报值（header/query）永不进入」。V3 就是这条不变量在
 *   部门轴上的可执行判据（若实现改成从头取部门 ⇒ V3 必红，已实测）。
 *
 * 契约（铁律 47）:
 *   @input  — 环境（JWT_SECRET / DEV_MODE / SYNOVA_ORG_ID / LOG_LEVEL）＋
 *             JWT 载荷（`departmentIds`：**受签名保护**的部门声明，复数）
 *   @output — 判定表：载荷有部门 ⇒ 请求上下文内 `getCurrentDepartmentIds()` = 该集合
 *             （∩ 真源已知，按载荷顺序去重）；载荷无部门 / 未知部门 ⇒ **空集**；
 *             自报请求头 ⇒ **不被采纳**；过期载荷 ⇒ 401 且下游零调用；
 *             解析层异常 ⇒ 降级为空集且**请求仍 200**
 *   @degraded — 真源不可用 ⇒ 部门集为空 **且请求仍 200**（部门轴是**加性**的，
 *             **不得**把认证变成硬依赖）；降级标记由 `auth.ts` 记 `log.warn` 消费。
 *
 * ⚠️ 可观测性边界（诚实声明，实测所得）:
 *   `@synova/logger` 经 `pino.destination({dest:2})` **直写 fd 2**，且 level 在模块
 *   import 时绑定 ⇒ **进程内无法拦截**。本卡实测三种拦法**全部 0 命中**：
 *     ① `process.stderr.write` 赋值；② `process.stdout.write` 赋值；
 *     ③ `vi.spyOn(rootLogger.child(...), 'warn')` / `vi.spyOn(createLogger('auth'),'warn')`。
 *   ⇒ 故本文件**不对日志文本作任何断言**（写了也是假绿）。
 *   "降级被上报（非静默）"的取证形式 = **跨进程**：spawn 子进程 + 捕获真实 fd2，
 *   原始行含 `"code":"K12_10_DEPT_DEGRADED"` ＋ `"degradedReasons":["DEPT_SOURCE_MISSING: …"]`
 *   ＋ 同请求 `HTTP 200`（见交付回执 B②）。该取证**不进本文件**：它是取证，不是判据
 *   （判据必须在 CI 可复跑；spawn `tsx` 会引入子进程脆弱性）。
 *
 * 铁律 48: 每例真 `expect()` 断言，覆盖正常路径 / 负向路径 / 降级 / 边界。
 * 铁律 38: 零 `as any` / `as never` / `as unknown as`。
 * 铁律 12: 不 mock 管线 —— 真中间件、真 HTTP，零桩。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import { createHmac } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { getCurrentDepartmentIds } from '../../src/services/request-context';

// ════════════════════════════════════════════════════════════════
// 夹具
// ════════════════════════════════════════════════════════════════

const SIGNING_SECRET = 'k12-10-wire-request-path-secret-0123456789';

const ORIGINAL_ENV = {
  JWT_SECRET: process.env['JWT_SECRET'],
  DEV_MODE: process.env['DEV_MODE'],
  SYNOVA_ORG_ID: process.env['SYNOVA_ORG_ID'],
  LOG_LEVEL: process.env['LOG_LEVEL'],
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** 生产姿态：有 JWT_SECRET、无 DEV_MODE（本卡判据全部在此姿态下取） */
function enterProdEnv(): void {
  process.env['JWT_SECRET'] = SIGNING_SECRET;
  delete process.env['DEV_MODE'];
  process.env['SYNOVA_ORG_ID'] = 'org-a';
  process.env['LOG_LEVEL'] = 'silent';
}

/**
 * 磁盘上的部门定义真源 id（与 `resolveContext` 同一根：`process.cwd()`）。
 *
 * 为什么不硬编码部门名：真源是**文件驱动**的（加文件即生效）⇒ 判据必须从磁盘取当前
 * 事实，否则"加一个部门文件"就会让判据变成假绿/假红。
 */
function departmentIdsOnDisk(): string[] {
  const dir = join(process.cwd(), 'extensions', 'departments');
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ya?ml|json)$/i.test(e.name) && !/^manifest\.json$/i.test(e.name))
    .map((e) => e.name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

/** 进程内工具里绝不应存在的部门 id（用于"未知部门不得生效"） */
const ABSENT_DEPARTMENT = '__k12wire_no_such_department__';

/** 路由在一次请求内观测到的上下文事实（**在请求处理期间取值**，非事后） */
interface ContextProbe {
  /** 该请求上下文内 `getCurrentDepartmentIds()` 的返回值 */
  departments: string[];
  /** 取值是否抛异常（`getCurrentDepartmentIds` 契约：纯读、不抛） */
  threw: boolean;
}

/** 一次真实 HTTP 往返的结果 */
interface ProbeResult {
  status: number;
  body: unknown;
  /** 路由处理器是否被调用过（⇒ 中间件确实放行到下游） */
  routeReached: boolean;
}

let server: Server | null = null;
let baseUrl = '';

beforeAll(async () => {
  enterProdEnv();
  const app = express();
  app.use(express.json());
  // 生产挂载顺序：认证中间件在路由之前（server.ts 同型）
  app.use(jwtAuthMiddleware);
  app.get('/api/k12wire/probe', (_req, res) => {
    const probe: ContextProbe = { departments: [], threw: false };
    try {
      probe.departments = [...getCurrentDepartmentIds()];
    } catch (probeErr: unknown) {
      // 契约：`getCurrentDepartmentIds` 是纯读、不抛（见其 JSDoc @degraded: 不适用）。
      // 真抛 = 契约被破坏 ⇒ 如实标记，由断言暴露（铁律 24：不空吞）。
      probe.threw = true;
      console.warn('[k12-10-wire] getCurrentDepartmentIds 抛出（契约破坏）:', probeErr);
    }
    res.json(probe);
  });
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, '127.0.0.1', resolve);
  });
  const address = server?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('测试服务器未取得监听端口');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  restoreEnv();
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
});

afterEach(() => {
  enterProdEnv();
});

/** 真 HTTP 往返（注入通道 = 请求头；身份载荷由 `signJwtToken` 签出） */
async function probeRequest(headers: Record<string, string>): Promise<ProbeResult> {
  const response = await fetch(`${baseUrl}/api/k12wire/probe`, { headers });
  const body: unknown = await response.json();
  const routeReached = Array.isArray((body as ContextProbe).departments);
  return { status: response.status, body, routeReached };
}

// ════════════════════════════════════════════════════════════════
// V1 — 请求路径真带部门身份（本卡核心判据）
// ════════════════════════════════════════════════════════════════

describe('K12-10-WIRE V1 — 请求路径真带部门身份', () => {
  /**
   * 反例实测（R1，摘掉接线）:
   *   AssertionError: expected [] to deeply equal [ 'delivery' ]
   */
  it('载荷声明 1 个已知部门 ⇒ **该请求上下文内** getCurrentDepartmentIds() 真拿到它', async () => {
    const onDisk = departmentIdsOnDisk();
    expect(onDisk.length).toBeGreaterThanOrEqual(1);
    const [dept] = onDisk;

    const token = signJwtToken({ sub: 'u-v1', role: 'admin', orgId: 'org-a', departmentIds: [dept] });
    expect(token).toBeTypeOf('string');

    const result = await probeRequest({ Authorization: `Bearer ${token ?? ''}` });

    // ① 请求真穿过中间件到路由（否则下面的非空断言可能只是"路由没跑"造成的假绿）
    expect(result.routeReached).toBe(true);
    expect(result.status).toBe(200);
    // ② 本卡核心：**在该请求上下文内**部门身份非空且等于载荷声明 ∩ 真源
    const probe = result.body as ContextProbe;
    expect(probe.threw).toBe(false);
    expect(probe.departments).toEqual([dept]);
  });

  it('无请求上下文时 getCurrentDepartmentIds() 为空（对照：证明上面非空是**请求内**取得的）', () => {
    // 本条是 V1 的对照项：同一函数、同一进程，**不在**请求上下文里 ⇒ 空集。
    // ⇒ V1 里取到非空，只能是"该请求上下文真的带了部门身份"，不是函数恒返非空。
    expect([...getCurrentDepartmentIds()]).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════
// V2 — 复数并集（一人 2 部门 ⇒ 都在，非覆盖）
// ════════════════════════════════════════════════════════════════

describe('K12-10-WIRE V2 — 复数并集（非覆盖）', () => {
  /**
   * 反例实测（R2，覆盖型实现：只留首个部门）:
   *   AssertionError: expected [ 'delivery' ] to deeply equal [ 'delivery', 'finance' ]
   */
  it('载荷声明 2 个已知部门 ⇒ 两部门**都**生效（顺序 = 载荷顺序）', async () => {
    const onDisk = departmentIdsOnDisk();
    expect(onDisk.length).toBeGreaterThanOrEqual(2);
    const [first, second] = onDisk;

    const token = signJwtToken({
      sub: 'u-v2',
      role: 'admin',
      orgId: 'org-a',
      departmentIds: [first, second],
    });
    const result = await probeRequest({ Authorization: `Bearer ${token ?? ''}` });

    expect(result.status).toBe(200);
    const probe = result.body as ContextProbe;
    // 并集语义：不是"末位胜"、不是"只留首个"
    expect(probe.departments).toEqual([first, second]);
    expect(probe.departments.length).toBe(2);
  });

  it('载荷含未知部门 ⇒ 未知者**不生效**，已知者仍生效（不是"有未知就全丢"）', async () => {
    const onDisk = departmentIdsOnDisk();
    const [known] = onDisk;

    const token = signJwtToken({
      sub: 'u-v2b',
      role: 'admin',
      orgId: 'org-a',
      departmentIds: [known, ABSENT_DEPARTMENT],
    });
    const result = await probeRequest({ Authorization: `Bearer ${token ?? ''}` });

    const probe = result.body as ContextProbe;
    expect(probe.departments).toEqual([known]);
    expect(probe.departments).not.toContain(ABSENT_DEPARTMENT);
  });
});

// ════════════════════════════════════════════════════════════════
// V3 — 负向：未验签的自报值永不进入身份面（防"从头取部门"的错实现）
// ════════════════════════════════════════════════════════════════

describe('K12-10-WIRE V3 — 自报请求头不得成为部门身份来源', () => {
  /**
   * 反例实测（R3，载荷为空时回落到 `x-department-ids` 头 —— 现实错实现形态）:
   *   AssertionError: expected [ 'delivery' ] to deeply equal []
   */
  it('载荷**未**声明部门、但请求头自报部门 ⇒ 不被采纳（空集）', async () => {
    const onDisk = departmentIdsOnDisk();
    const [dept] = onDisk;

    const token = signJwtToken({ sub: 'u-v3', role: 'admin', orgId: 'org-a' });
    const result = await probeRequest({
      Authorization: `Bearer ${token ?? ''}`,
      'X-Department-Ids': dept,
      'X-Department-Id': dept,
    });

    const probe = result.body as ContextProbe;
    // 若实现改成从请求头取部门 ⇒ 本条**必红**（头是未验签自报值，等于自助授予部门）
    expect(probe.departments).toEqual([]);
  });

  it('载荷声明 A、请求头自报 B ⇒ 生效的只能是 A（头不得覆盖/追加）', async () => {
    const onDisk = departmentIdsOnDisk();
    expect(onDisk.length).toBeGreaterThanOrEqual(2);
    const [signedDept, headerOnlyDept] = onDisk;

    const token = signJwtToken({
      sub: 'u-v3b',
      role: 'admin',
      orgId: 'org-a',
      departmentIds: [signedDept],
    });
    const result = await probeRequest({
      Authorization: `Bearer ${token ?? ''}`,
      'X-Department-Ids': headerOnlyDept,
      'X-Tenant-Id': 'org-a',
    });

    const probe = result.body as ContextProbe;
    expect(probe.departments).toEqual([signedDept]);
    expect(probe.departments).not.toContain(headerOnlyDept);
  });
});

// ════════════════════════════════════════════════════════════════
// V4 — 降级：部门轴是**加性**的，不得成为认证的硬依赖
// ════════════════════════════════════════════════════════════════

describe('K12-10-WIRE V4 — 降级不阻断', () => {
  /**
   * 反例实测（V4 段形态的由来 —— 一条**被实测否证**的反例）:
   *   最初把"降级不静默"写成对日志文本的断言。实测：让 `auth.ts` 的 degraded 分支短路
   *   （静默吞掉），**其余判据 10/11 全绿** ⇒ 那是一条**永远绿的假反例**。
   *   改判据形态后（② 真源不可用仍 200；③ 解析层异常仍 200）：
   *   ③ 的反例 = 移除 `resolveContext` 调用的 try/catch ⇒ 句柄被当成未处理错误 ⇒ 必红。
   */
  it('① 载荷**完全无**部门声明 ⇒ 空集（不得退化为"默认给全量"＝越权）', async () => {
    const token = signJwtToken({ sub: 'u-v4b', role: 'admin', orgId: 'org-a' });
    const result = await probeRequest({ Authorization: `Bearer ${token ?? ''}` });

    const probe = result.body as ContextProbe;
    expect(probe.departments).toEqual([]);
    expect(result.status).toBe(200);
  });

  it('② 部门定义真源不可用 ⇒ 部门集为空，但请求仍 200 且路由被调用', async () => {
    const realCwd = process.cwd();
    // 让 `resolveContext` 的缺省根（`process.cwd()`）落在一个**没有** extensions/departments 的目录
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(join(realCwd, 'node_modules'));
    try {
      const token = signJwtToken({ sub: 'u-v4', role: 'admin', orgId: 'org-a', departmentIds: ['finance'] });
      const result = await probeRequest({ Authorization: `Bearer ${token ?? ''}` });

      const probe = result.body as ContextProbe;
      expect(probe.departments).toEqual([]);
      // 🔴 关键：不可用 ≠ 阻断。认证面照常（req.auth 不缺），请求必须仍然可达。
      expect(result.status).toBe(200);
      expect(result.routeReached).toBe(true);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  /**
   * ③ 解析层**失败**（`resolveContext` 内部未捕获异常）⇒ 请求仍 200 且部门集为空
   *   （认证不得因部门轴崩掉）。
   *
   * ⚠️ **本用例不构成"改坏即红"的独立反例，不得据此声称已覆盖 try/catch**（实测否证）：
   *   本卡先后试了两种"改坏"形态，**都验不出红**，故如实标注：
   *     ① 拆掉 `auth.ts` 中 `await resolveContext` 的 try/catch ⇒ 仍 11 passed。
   *        原因（实测取得）：`resolveContext` **自身吸收**了 cwd 层故障（内部 try/catch
   *        ⇒ 返回 `degraded:true` 结果而非抛出）⇒ 那个 try/catch 在**当前契约**下不可达。
   *     ② 让 `auth.ts` degraded 分支短路 ⇒ 仍 10 passed（本卡因此改写了判据形态）。
   *   本用例的**真实功效**只有一条：证明"解析层失败时请求仍可达"（部门轴是加性的）。
   *   对应的红证据是 R4（把 `resolveContext` 改成真抛 ⇒ 4 条判据红，见交付回执 B②）——
   *   它证明的是"接线断了必红"，**不是**"try/catch 被删必红"。
   */
  it('③ 解析层失败 ⇒ 请求仍 200 且部门集为空（认证不得因部门轴崩掉）', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockImplementation((): string => {
      throw new Error('K12WIRE_INDUCED_CWD_FAILURE');
    });
    try {
      const token = signJwtToken({ sub: 'u-v4c', role: 'admin', orgId: 'org-a', departmentIds: ['finance'] });
      const result = await probeRequest({ Authorization: `Bearer ${token ?? ''}` });

      expect(result.status).toBe(200);
      expect(result.routeReached).toBe(true);
      expect((result.body as ContextProbe).departments).toEqual([]);
    } finally {
      cwdSpy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// V5 — 边界：过期/缺失凭据 ⇒ 401 且下游零调用
// ════════════════════════════════════════════════════════════════

describe('K12-10-WIRE V5 — 边界：过期/缺失凭据', () => {
  it('过期 token ⇒ 401 且路由**零调用**（部门身份不得从无效凭据产生）', async () => {
    const token = signJwtToken({ sub: 'u-v5', role: 'admin', orgId: 'org-a', departmentIds: ['finance'] });
    expect(token).toBeTypeOf('string');
    const parts = (token ?? '').split('.');
    expect(parts.length).toBe(3);

    // 手工重签已过期载荷（保持签名有效 ⇒ 走到"过期检查"分支，而不是"签名无效"）
    const expiredPayload = {
      sub: 'u-v5', role: 'admin', orgId: 'org-a', departmentIds: ['finance'],
      iat: 1, exp: 2, jti: 'k12wire-expired',
    };
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const sig = createHmac('sha256', SIGNING_SECRET).update(`${header}.${body}`).digest('base64url');
    const expiredToken = `${header}.${body}.${sig}`;

    const result = await probeRequest({ Authorization: `Bearer ${expiredToken}` });

    expect(result.status).toBe(401);
    expect(result.routeReached).toBe(false);
    expect((result.body as { code?: string }).code).toBe('UNAUTHORIZED');
  });

  it('无凭据 ⇒ 401 且路由零调用', async () => {
    const result = await probeRequest({});
    expect(result.status).toBe(401);
    expect(result.routeReached).toBe(false);
  });
});
