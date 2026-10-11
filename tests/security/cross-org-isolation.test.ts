/**
 * tests/security/cross-org-isolation.test.ts — K12-09 (#192 / 原 RB-01)
 * 多租户隔离：**跨 orgId 读必须被拒（含 DevMode 姿态）**
 *
 * 判据来源（卡面 #192 · Q3 验收）：
 *   V2 **穿生产入口**：跨租户读声明 ⇒ **被拒**（非 200）
 *   V3 **DevMode 姿态**：`DEV_MODE=true` 且无 `JWT_SECRET` 时，跨 orgId 读**仍必须被拒**
 *      （DevMode 只提升**单租户内**权限，不跨租户）
 *   V4 反例：让隔离判定在任一姿态下失效 ⇒ 本文件必红
 *   V5 留痕：每次拒绝带 `code` + 归属
 *
 * 手法（铁律 0-2 / 铁律 12「不 mock 管线」）：
 *   起**真 express app + 真 HTTP 请求**，复现生产挂载顺序（`server.ts:396`
 *   `app.use(jwtAuthMiddleware)` 在路由之前），让请求**穿过真实中间件**。
 *   零 mock：不桩 `jwtAuthMiddleware`、不桩 `req`/`res`——判据必须落在"被执行"上，
 *   不是"被 import"上（历史事故：4 次接线失败 = 组件过单测但从未被生产代码调用）。
 *
 * 契约（铁律 47）:
 *   @input  — 环境（JWT_SECRET / DEV_MODE / SYNOVA_ORG_ID）+ HTTP 请求头
 *             `X-Org-Id`（或 `X-Tenant-Id`）= 请求**声明的目标组织**；`Authorization: Bearer <jwt>` = 验签身份
 *   @output — 判定表：同组织/未声明 ⇒ 放行（`ok:true` + `req.auth` 注入）；
 *             声明 ≠ 身份 ⇒ **403 `CROSS_ORG_FORBIDDEN`**，`next()` 不执行（下游零调用）
 *   @degraded — 无。隔离判定**不得有降级放行路径**：判据不可用（声明存在但身份无组织声明）
 *               ⇒ 收窄为拒绝（fail-closed），不是放行
 *
 * 铁律 48: 每组用例均有真 `expect()` 断言，覆盖正常路径 / 拒绝路径 / 边界（两姿态）。
 * 铁律 38: 零 `as any` / `as never` / `as unknown as`（请求对象用局部结构类型声明）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';

// ════════════════════════════════════════════════════════════════
// 夹具
// ════════════════════════════════════════════════════════════════

const PROJECT_ROOT = path.resolve(__dirname, '../..');
/** 隔离拒绝的稳定 code（V5 留痕判据；与 `src/middleware/auth.ts` 内常量同名同值） */
const CROSS_ORG_CODE = 'CROSS_ORG_FORBIDDEN';
/** 生产姿态用的密钥（≥16 字符，满足 `getSecret()` 的有效性门槛） */
const PROD_SIGNING_SECRET = 'k12-09-cross-org-test-secret-0123456789';
/** DevMode 用例临时签发凭据用的密钥（用后即还原，见 `signTokenWithTemporarySecret`） */
const DEV_MODE_SIGNING_SECRET = 'k12-09-dev-mode-signing-secret-0123456789';

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

/** 生产姿态：有 JWT_SECRET、无 DEV_MODE、实例组织 = org-a */
function enterProdEnv(): void {
  process.env['JWT_SECRET'] = PROD_SIGNING_SECRET;
  delete process.env['DEV_MODE'];
  process.env['SYNOVA_ORG_ID'] = 'org-a';
  process.env['LOG_LEVEL'] = 'silent';
}

/** 开发姿态：DEV_MODE=true 且**无 JWT_SECRET**（即卡面 §②「姿态漏洞」面） */
function enterDevModeEnv(): void {
  delete process.env['JWT_SECRET'];
  process.env['DEV_MODE'] = 'true';
  process.env['SYNOVA_ORG_ID'] = 'org-a';
  process.env['LOG_LEVEL'] = 'silent';
}

type AuthedRequest = express.Request & { auth?: { sub?: string; role?: string; orgId?: string } };

/** 注入身份回执（证明真中间件在**本用例**里被执行过，而非路由独立放行） */
interface AuthEcho {
  orgId: string | undefined;
  sub: string | undefined;
}

/** 起一个只在 127.0.0.1 监听的临时 app（生产挂载顺序：middleware 在前、路由在后） */
async function withServer(fn: (base: string, echo: AuthEcho[]) => Promise<void>): Promise<void> {
  const echo: AuthEcho[] = [];
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  // 三个探针端点（同一个中间件链，不改判据）:
  //   ① /api/sessions/echo   —— **白名单前缀路径**（`isWhitelisted()` 命中 ⇒ 走白名单分支）
  //   ② /api/knowledge/search —— 非白名单路径（走认证分支）
  //   ③ /health              —— 白名单精确路径
  const route = (name: string) => (req: express.Request, res: express.Response): void => {
    const authed = req as AuthedRequest;
    echo.push({ orgId: authed.auth?.orgId, sub: authed.auth?.sub });
    res.json({ ok: true, route: name, orgId: authed.auth?.orgId ?? null });
  };
  app.post('/api/sessions/echo', route('whitelist-prefix'));
  app.post('/api/knowledge/search', route('authed'));
  app.get('/health', route('whitelist-exact'));

  const server: Server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => { resolve(); });
    server.once('error', reject);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${String(port)}`, echo);
  } finally {
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  }
}

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

async function request(
  base: string,
  route: string,
  opts: { token?: string; orgId?: string; tenantId?: string; method?: 'GET' | 'POST' } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  if (opts.tenantId) headers['x-tenant-id'] = opts.tenantId;
  const res = await fetch(`${base}${route}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' ? undefined : '{}',
  });
  const parsed: unknown = await res.json();
  const body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return { status: res.status, body };
}

function signToken(orgId: string, sub = 'u-cross-org'): string {
  const token = signJwtToken({ sub, role: 'admin', orgId });
  if (!token) throw new Error('夹具自证失败: signJwtToken 返回 null（JWT_SECRET 不可用）');
  return token;
}

/**
 * 在**无 `JWT_SECRET`** 的姿态下取一枚验签凭据（DevMode 用例用）。
 *
 * 为何必须这样取（夹具真实性）: `signJwtToken` 的唯一签名源是 `process.env.JWT_SECRET`；
 * DevMode 姿态下它不可用 ⇒ 只能"临时置密钥→签发→还原"。绝不静态手写 JWT 字面量
 * （那会把夹具与实现的签名算法脱钩：实现换了算法而夹具仍"绿"= 假绿）。
 */
function signTokenWithTemporarySecret(orgId: string, sub: string): string {
  const saved = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = DEV_MODE_SIGNING_SECRET;
  try {
    return signToken(orgId, sub);
  } finally {
    if (saved === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = saved;
  }
}

// ════════════════════════════════════════════════════════════════
// ① 生产姿态：跨 orgId 读必须被拒
// ════════════════════════════════════════════════════════════════

describe('K12-09 V2 — 生产姿态（DEV_MODE=false）: 跨 orgId 读必须被拒', () => {
  beforeAll(() => { enterProdEnv(); });
  afterAll(() => { restoreEnv(); });

  it('V2-① 同组织声明 ⇒ 放行（真中间件被执行: req.auth 注入 org-a）', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search', { token: signToken('org-a'), orgId: 'org-a' });
      expect(res.status).toBe(200);
      expect(res.body['ok']).toBe(true);
      // 证明本用例确实穿过了真 jwtAuthMiddleware（不是夹具旁路）
      expect(echo.length).toBe(1);
      expect(echo[0]?.orgId).toBe('org-a');
    });
  });

  it('V2-② 未声明目标组织 ⇒ 放行（原语义不变，零回归）', async () => {
    await withServer(async (base) => {
      const res = await request(base, '/api/knowledge/search', { token: signToken('org-a') });
      expect(res.status).toBe(200);
      expect(res.body['orgId']).toBe('org-a');
    });
  });

  it('V2-③ org-a 身份 + 声明 org-b ⇒ 403 被拒，且下游路由零调用', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search', { token: signToken('org-a'), orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['ok']).toBe(false);
      // V5 留痕: 稳定 code + 归属（声明组织 / 身份组织）
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(res.body['declaredOrgId']).toBe('org-b');
      expect(res.body['authOrgId']).toBe('org-a');
      expect(res.body['degraded']).toBeUndefined();
      // 非静默 404（卡面 §⑦ DSH 可借点）: 显式 403 + code，不得伪装成"不存在"
      expect(res.status).not.toBe(404);
      // next() 未执行 ⇒ 路由处理器零调用（"接线了 ≠ 被执行"的判别性断言）
      expect(echo.length).toBe(0);
    });
  });

  it('V2-④ 反向：org-b 身份 + 声明 org-a ⇒ 同样 403（判据对称，不偏向任何一方）', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search', { token: signToken('org-b'), orgId: 'org-a' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(res.body['declaredOrgId']).toBe('org-a');
      expect(res.body['authOrgId']).toBe('org-b');
      expect(echo.length).toBe(0);
    });
  });

  it('V2-⑤ 白名单前缀路径（/api/sessions/**）: 声明 ≠ 身份 ⇒ 仍 403（墙不因白名单开洞）', async () => {
    // 白名单语义 = 「**不要求**认证」，不等于「跨租户可读」。带**验签凭据**的请求，
    // 其声明的目标组织必须与身份一致 —— 否则白名单就成了绕过墙的通道。
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo', { token: signToken('org-a'), orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(echo.length).toBe(0);
    });
  });

  it('V2-⑥ 边界：白名单前缀路径 + **显式声明**目标组织但无凭据可验 ⇒ 403（声明必须能验证，fail-closed）', async () => {
    // 关键语义: 「显式声明了目标组织」本身就是一次跨租户诉求。非 DevMode 下无凭据 ⇒
    // 没有任何身份可与声明比对 ⇒ 判据不可用 ⇒ **收窄为拒绝**（拒绝 > 放行）。
    // 这不削弱白名单：**未声明**目标组织的无凭据请求照旧可达（见 V2-⑦）。
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo', { orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      // 无身份可比 ⇒ 归属字段为空串（如实标注"判据不可用"，不伪装成"身份不一致"）
      expect(res.body['authOrgId']).toBe('');
      expect(echo.length).toBe(0);
    });
  });

  it('V2-⑥b 回归：白名单前缀路径无凭据且**未声明**目标组织 ⇒ 照旧可达（K12-03/D947 语义不变）', async () => {
    // 白名单「不要求认证」语义零回归的判别性用例：缺了这一条，V2-⑥ 的加固就可能
    // 顺手把白名单整个关死（打红 K12-03 #186 已合判据 /
    // `tests/middleware/onboarding-whitelist.test.ts`）。
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo');
      expect(res.status).toBe(200);
      expect(res.body['ok']).toBe(true);
      // 无凭据 ⇒ 不注入身份（P0 不变量：注入的只能是验签身份）
      expect(echo[0]?.orgId).toBeUndefined();
    });
  });

  it('V2-⑦ 边界：白名单前缀路径 + 同组织凭据 ⇒ 放行并注入身份（D947/L-20 语义不变）', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo', { token: signToken('org-a'), orgId: 'org-a' });
      expect(res.status).toBe(200);
      expect(echo.length).toBe(1);
      expect(echo[0]?.orgId).toBe('org-a');
    });
  });

  it('V2-⑧ 别名头 X-Tenant-Id 同样受判据约束（不得只防一个头名）', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search', { token: signToken('org-a'), tenantId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(res.body['declaredOrgId']).toBe('org-b');
      expect(echo.length).toBe(0);
    });
  });

  it('V2-⑨ 判据不可用：身份缺组织声明 + 请求声明了目标组织 ⇒ 收窄为拒绝（fail-closed）', async () => {
    // orgId 为空串 = 身份缺组织声明（`verifyJwtToken` 只强校验 sub/role/jti，
    // `orgId` 可能缺失）⇒ 有声明却无身份可比 ⇒ 收窄为拒绝（fail-closed，绝不放宽）。
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search', { token: signToken(''), orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(echo.length).toBe(0);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// ② DevMode 姿态：跨 orgId 读**仍必须被拒**（卡面 V3）
// ════════════════════════════════════════════════════════════════

describe('K12-09 V3 — DevMode 姿态（DEV_MODE=true 且无 JWT_SECRET）: 跨 orgId 读仍必须被拒', () => {
  beforeAll(() => { enterDevModeEnv(); });
  afterAll(() => { restoreEnv(); });

  it('V3-① 无凭据 + 声明异组织 ⇒ 403（DevMode 自动 admin 不跨租户）', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search', { orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(res.body['authOrgId']).toBe('org-a'); // 身份 = 实例组织 SYNOVA_ORG_ID
      expect(res.body['declaredOrgId']).toBe('org-b');
      expect(echo.length).toBe(0);
    });
  });

  it('V3-② 无凭据 + 未声明 ⇒ 放行（DevMode 原语义保留，零回归）', async () => {
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/knowledge/search');
      expect(res.status).toBe(200);
      expect(res.body['orgId']).toBe('org-a'); // DevMode 身份 = SYNOVA_ORG_ID
      expect(echo[0]?.sub).toBe('dev-admin');
    });
  });

  it('V3-③ 白名单前缀路径 + **不可验签**凭据 + 声明异组织 ⇒ 403（DevMode 身份兜底仍须过墙）', async () => {
    // 姿态事实（实测断言，非假设）: 「纯 DevMode」= 无 JWT_SECRET ⇒ **任何** Bearer 都不可验签
    // （`getSecret()` 返回 null ⇒ `verifyJwtToken` 恒判 `JWT_SECRET not configured`）。
    // 因此 DevMode 下"身份权威 = 凭据"这一路径**不可达**；可达的身份源只有实例组织。
    // 判别点: 请求带无法验签的 Bearer + 声明 org-b（≠ 实例组织 org-a）⇒ 必须 403。
    // 反例: 若白名单分支按"有 Bearer 就走凭据分支、验签失败即照旧放行"（本卡修前的形态），
    // 本条即红 —— 那正是「DevMode + 白名单」双姿态叠加出的绕过通道。
    const unverifiable = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.AAAA';
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo', { token: unverifiable, orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(res.body['authOrgId']).toBe('org-a');
      expect(echo.length).toBe(0);
    });
  });

  it('V3-③b 同型放行侧：不可验签凭据 + 声明 = 实例组织 ⇒ 放行（白名单可达性不变）', async () => {
    await withServer(async (base, echo) => {
      const unverifiable = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.AAAA';
      const res = await request(base, '/api/sessions/echo', { token: unverifiable, orgId: 'org-a' });
      expect(res.status).toBe(200);
      // 不可验签 ⇒ 不注入身份（P0 不变量：注入的只能是验签身份）
      expect(echo[0]?.orgId).toBeUndefined();
    });
  });

  it('V3-④ 白名单前缀路径无凭据 + 声明异组织 ⇒ 403（DevMode 身份源与认证路径同源）', async () => {
    // DevMode 下中间件**自带**一个隐式身份（实例组织 `SYNOVA_ORG_ID`）—— 它是本卡最危险的
    // 姿态面：若白名单前缀路径不消费它，`DEV_MODE=true` 就等于"白名单 + 跨租户可读"。
    // 判据: 声明 org-b ≠ 实例组织 org-a ⇒ 403（DevMode 的 admin 只在**单租户内**生效）。
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo', { orgId: 'org-b' });
      expect(res.status).toBe(403);
      expect(res.body['code']).toBe(CROSS_ORG_CODE);
      expect(res.body['authOrgId']).toBe('org-a');
      expect(echo.length).toBe(0);
    });
  });

  it('V3-④b 回归：白名单前缀路径无凭据且**未声明**目标组织 ⇒ 照旧可达（可达性不变）', async () => {
    // 与 V3-④ 成对：证明加固只拦"显式跨租户诉求"，没有把白名单前缀路径整个关死。
    await withServer(async (base, echo) => {
      const res = await request(base, '/api/sessions/echo');
      expect(res.status).toBe(200);
      expect(echo[0]?.orgId).toBeUndefined();
    });
  });

  it('V3-⑤ 边界：实例组织未配置（SYNOVA_ORG_ID 缺失）⇒ 回落 default 且仍拒异组织', async () => {
    const saved = process.env['SYNOVA_ORG_ID'];
    delete process.env['SYNOVA_ORG_ID'];
    try {
      await withServer(async (base, echo) => {
        const res = await request(base, '/api/knowledge/search', { orgId: 'org-b' });
        expect(res.status).toBe(403);
        expect(res.body['authOrgId']).toBe('default');
        expect(echo.length).toBe(0);
      });
    } finally {
      process.env['SYNOVA_ORG_ID'] = saved;
    }
  });

  it('V3-⑥ 边界：相同声明 + 身份一致 ⇒ 放行，且注入的是**凭据身份**而非 dev-admin 兜底', async () => {
    // 前置事实: `jwtAuthMiddleware` 的 DevMode 兜底分支仅在**无 JWT_SECRET**时可入；
    // 验签分支需要 JWT_SECRET 才能校验凭据 —— 两者互斥。故本用例显式装回密钥
    // （= 从"纯 DevMode"切到"DevMode + 真凭据"，这正是要判的场景），用后还原。
    // 判据: 身份注入必须来自**凭据**（sub=u-real），不是 dev-admin 兜底。
    const savedSecret = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = PROD_SIGNING_SECRET;
    try {
      await withServer(async (base, echo) => {
        const res = await request(base, '/api/sessions/echo', { token: signToken('org-a', 'u-real'), orgId: 'org-a' });
        expect(res.status).toBe(200);
        expect(echo[0]?.sub).toBe('u-real');
        expect(echo[0]?.orgId).toBe('org-a');
      });
    } finally {
      if (savedSecret === undefined) delete process.env['JWT_SECRET'];
      else process.env['JWT_SECRET'] = savedSecret;
    }
  });
});

// ════════════════════════════════════════════════════════════════
// ③ 静态守卫：判定必须挂在**两条姿态路径**上（防"只防一半"）
// ════════════════════════════════════════════════════════════════

describe('K12-09 V4 — 内核双路径接线守卫（静态）', () => {
  /** 读源码正文，剥掉行注释——防止"注释里写了判定"骗过守卫 */
  function authSourceBody(): string {
    return fs
      .readFileSync(path.join(PROJECT_ROOT, 'src/middleware/auth.ts'), 'utf-8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
  }

  it('V4-① 判定函数存在，且在认证路径与 DevMode 路径各被调用 ≥1 次', () => {
    const body = authSourceBody();
    expect(body).toContain('evaluateCrossOrgAccess');
    // 调用点 ≥2 —— 只挂一条路径（如只挂认证路径）= 「DevMode 姿态漏洞」未修
    const callSites = body.match(/evaluateCrossOrgAccess\(/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(2);
  });

  it('V4-② 拒绝分支返回 403 + CROSS_ORG_FORBIDDEN（不静默、不改码）', () => {
    const body = authSourceBody();
    expect(body).toContain('CROSS_ORG_FORBIDDEN');
    expect(body).toContain('403');
    expect(body).toMatch(/log\.(warn|error)\(/);
  });

  it('V4-③ 源码不含任何"跨租户放行"的注释式豁免（禁静默降级）', () => {
    const body = authSourceBody();
    expect(body).not.toMatch(/cross[- _]?org[^\n]*(allow|bypass|放行)/i);
  });

  it('V4-④ 反向护栏：既有白名单段未被改写（K12-03 #186 判据面）', () => {
    const body = authSourceBody();
    // 白名单唯一源仍在（K12-03 已合；K12-09 不得动其函数体）
    expect(body).toContain("path === '/api/onboarding/start'");
    // 敏感度过滤链仍在（K12-05 已修；K12-09 不得动其逻辑）
    expect(body).toContain('access.sensitivity');
    expect(body).toContain('allowedSensitivities');
  });
});
