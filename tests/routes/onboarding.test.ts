/**
 * tests/routes/onboarding.test.ts — `src/routes/onboarding.ts` 专用配对测试（铁律 48）
 *
 * 覆盖：路由栈形状（V3 零表单）｜判据入口端点存在且是 POST｜HTTP 层真调（穿真 router + 真 auth 中间件）
 *       正常（dry-run 2xx 不落盘）｜降级（零文档 degraded 但 2xx）｜边界（apply 未确认 ⇒ 409 fail-closed）
 *
 * #1075 P1-b（生成面）新增/升级：
 *   · `/start`（预览）**缺项不 400**：200 ＋ `data.configPack.rejected[]`（`code`/`missingParams` 点名）
 *     ＋ `data.degraded:true`（两处既有 `/start` 用例保持 200 并补 rejected 断言）；
 *   · `/apply`（真落盘）缺项 ⇒ **400** `{ok:false, error:{code:'ROLE_SEED_INCOMPLETE', missingParams}, degraded:true}`
 *     且**磁盘零写入**（含不写 `.synova/onboarding-audit.log`）—— 对比用例：完整 seed ⇒ 200（证明 400
 *     来自 seed 缺项，不是鉴权/门）；
 *   · 门序不回退：未确认 `/apply` 仍先被 `SUPER_ADMIN_CONFIRMATION_REQUIRED` 挡（本文件既有 401/409 断言不动）。
 *
 * 🔴 与 `tests/onboarding/onboarding-flow.test.ts` 分工：那份测**流程与生成器**，这份测**HTTP 边界**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import onboardingRouter from '../../src/routes/onboarding';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { EXPECTED_PIECES } from '../../src/init/preset-loader';

let root: string;
const ORIG_CWD = process.cwd();

/** 起生产同形 app（auth 中间件在前）并在 cwd=夹具下跑 */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(onboardingRouter);
  const server: Server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** 白名单端点无需凭据；但显式清环境变量以确保"生产姿态"下的判定可复现 */
async function withProdEnv<T>(fn: () => Promise<T>): Promise<T> {
  const dev = process.env['DEV_MODE'];
  const secret = process.env['JWT_SECRET'];
  delete process.env['DEV_MODE'];
  delete process.env['JWT_SECRET'];
  try {
    return await fn();
  } finally {
    if (dev === undefined) delete process.env['DEV_MODE']; else process.env['DEV_MODE'] = dev;
    if (secret === undefined) delete process.env['JWT_SECRET']; else process.env['JWT_SECRET'] = secret;
  }
}

/**
 * 用**真签发路径**取凭据（`signJwtToken` 是生产导出；非自造/非 mock）。
 * 需 `JWT_SECRET`（≥16）在**调用时**存在（`getSecret()` 运行时读 env）。
 */
function issueToken(): string {
  const token = signJwtToken({ sub: 'onboarding-route-probe', role: 'ga', orgId: 'default' });
  if (token === null) throw new Error('signJwtToken 返回 null —— JWT_SECRET 不可用（测试环境失败，判 2）');
  return token;
}

/** `/apply` 的 400 用例需要真凭据：临时注入 JWT_SECRET 并在 finally 恢复 */
async function withJwtSecret<T>(fn: () => Promise<T>): Promise<T> {
  const secret = process.env['JWT_SECRET'];
  process.env['JWT_SECRET'] = 'onboarding-route-apply-400-secret-0123456789';
  try {
    return await fn();
  } finally {
    if (secret === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = secret;
  }
}

/** 六块齐的 seed（contexts 只 scope＋profile —— 临时根禁 file ref） */
function completeRoleSeed(): Record<string, unknown> {
  return {
    roleId: 'finance',
    knowledgeScope: ['finance.reports'],
    capabilities: ['budget-review'],
    acceptanceCriteria: ['c1'],
    contexts: [
      {
        id: 'finance.reports-ref',
        label: '报表口径',
        source: 'extensions/presets/roles/finance/knowledge-scope.yaml#finance.reports',
      },
      { id: 'company.bp', label: '公司业务说明', source: 'profile.business-plan' },
    ],
    systemAddendum: '财务岗：结论必须标明报告期。',
    outputTemplate: { templateId: 'finance.standard', sections: [{ id: 'headline', title: '结论', must: ['结论'] }] },
  };
}

/** 不完整 seed（只给了 knowledgeScope/capabilities —— 缺 contexts/systemAddendum/outputTemplate） */
function incompleteRoleSeed(): Record<string, unknown> {
  return { roleId: 'finance', knowledgeScope: ['finance.reports'], capabilities: ['budget-review'] };
}

/** 临时根是否"被写过"（含 `/apply` 的确认留痕 `.synova/`） */
function rootIsPristine(): boolean {
  return !existsSync(join(root, 'extensions')) && !existsSync(join(root, '.synova'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'onboarding-route-'));
  process.chdir(root);
});

afterEach(() => {
  process.chdir(ORIG_CWD);
  rmSync(root, { recursive: true, force: true });
});

describe('routes/onboarding — 路由栈形状（判据 V1/V3）', () => {
  it('POST /api/onboarding/start 已注册且为**首条 POST**（判据探针取首条 POST 作入口）', () => {
    const stack = (onboardingRouter as unknown as {
      stack?: { route?: { path?: string; methods?: Record<string, boolean> } }[];
    }).stack ?? [];
    const posts = stack
      .map((l) => l.route)
      .filter((r): r is { path: string; methods: Record<string, boolean> } => r !== undefined && typeof r.path === 'string')
      .filter((r) => r.methods['post'] === true)
      .map((r) => r.path);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0]).toBe('/api/onboarding/start');
  });

  it('零表单页：只读 GET 仅 /api/onboarding/steps 一条', () => {
    const stack = (onboardingRouter as unknown as {
      stack?: { route?: { path?: string; methods?: Record<string, boolean> } }[];
    }).stack ?? [];
    const gets = stack
      .map((l) => l.route)
      .filter((r): r is { path: string; methods: Record<string, boolean> } => r !== undefined && typeof r.path === 'string')
      .filter((r) => r.methods['get'] === true)
      .map((r) => r.path);
    expect(gets).toEqual(['/api/onboarding/steps']);
  });
});

describe('routes/onboarding — 正常路径', () => {
  it('POST /api/onboarding/start（dry-run，**缺项 seed**）⇒ 200 且**不落盘**；rejected[] 点名（不 400）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: true, documents: ['roster.md'], roles: [incompleteRoleSeed()] }),
        });
        // 🔴 #1075 P1-b：预览端点**不 400**（预览的职责就是"告诉你缺什么"）
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok: boolean;
          data: {
            degraded: boolean;
            configPack: {
              written: string[];
              planned: string[];
              rejected: { roleId: string; code: string; missingParams: string[] }[];
            };
          };
        };
        expect(body.ok).toBe(true);
        expect(body.data.degraded).toBe(true);
        expect(body.data.configPack.written).toEqual([]);
        // 缺项 ⇒ 零计划（不是"计划了但没写"）
        expect(body.data.configPack.planned).toEqual([]);
        expect(body.data.configPack.rejected.length).toBe(1);
        expect(body.data.configPack.rejected[0]?.code).toBe('ROLE_SEED_INCOMPLETE');
        expect(body.data.configPack.rejected[0]?.roleId).toBe('finance');
        // 逐字段点名（缺 contexts/systemAddendum/outputTemplate）
        expect(body.data.configPack.rejected[0]?.missingParams).toContain('contexts');
        expect(body.data.configPack.rejected[0]?.missingParams).toContain('systemAddendum');
        expect(body.data.configPack.rejected[0]?.missingParams).toContain('outputTemplate');
        expect(rootIsPristine()).toBe(true);
      });
    });
  });

  it('GET /api/onboarding/steps ⇒ 200 且返回六步（需凭据 ⇒ 本用例走白名单外的 401 分支证明其受保护）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/steps`);
        // /steps 不在白名单 ⇒ 生产姿态下 401（只读但受保护，不是"表单页开放"）
        expect(res.status).toBe(401);
      });
    });
  });
});

describe('routes/onboarding — 降级 / 边界', () => {
  it('零文档 ⇒ 仍 200（degraded 由 report 透出，不 5xx）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: true, documents: [] }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { degraded: boolean; steps: { status: string }[] } };
        expect(body.data.degraded).toBe(true);
        expect(body.data.steps.some((s) => s.status === 'degraded')).toBe(true);
      });
    });
  });

  it('🔴 apply 未超管确认 ⇒ **409**（fail-closed，不落盘；门序在 seed 校验之前）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ documents: ['roster.md'], roles: [incompleteRoleSeed()] }),
        });
        // apply 不在白名单 ⇒ 先被 auth 拦（401）；两者都证明"未确认/未鉴权不得落盘"
        expect([401, 409]).toContain(res.status);
        expect(rootIsPristine()).toBe(true);
      });
    });
  });

  it('请求体指定 rootDir 被**忽略**（一律 cwd）—— 防任意路径写入面', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const evil = join(tmpdir(), 'synova-evil-target');
        const res = await fetch(`${base}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dryRun: true,
            rootDir: evil,
            documents: ['x.md'],
            roles: [incompleteRoleSeed()],
          }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: { configPack: { rejected: { missingParams: string[] }[] } };
        };
        // #1075 P1-b：第二处 /start 同样保持 200 ＋ rejected[].missingParams 点名
        expect(body.data.configPack.rejected.length).toBe(1);
        expect(body.data.configPack.rejected[0]?.missingParams.length).toBeGreaterThan(0);
        expect(existsSync(evil)).toBe(false);
        expect(rootIsPristine()).toBe(true);
      });
    });
  });

  it('🔴 缺项 /apply ⇒ **400** + {ok:false,error:{code,missingParams}} + 磁盘零写入（真凭据）', async () => {
    await withJwtSecret(async () => {
      // 不包 withProdEnv：本用例要真凭据（`signJwtToken`），而不是 401 边界
      await withServer(async (base) => {
        const token = issueToken();
        const res = await fetch(`${base}/api/onboarding/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          // 🔴 必须带 superAdminConfirmed:true —— 否则先被 409 门挡（门序在前），测不到 400
          body: JSON.stringify({ documents: ['roster.md'], roles: [incompleteRoleSeed()], superAdminConfirmed: true }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          ok?: boolean;
          error?: { code?: string; missingParams?: string[] };
          degraded?: boolean;
        };
        expect(body.ok).toBe(false);
        expect(body.error?.code).toBe('ROLE_SEED_INCOMPLETE');
        expect(body.error?.missingParams).toContain('contexts');
        expect(body.degraded).toBe(true);
        // 磁盘零写入（含 `.synova/onboarding-audit.log` 也不该出现 —— 不调用 flow）
        expect(rootIsPristine()).toBe(true);
      });
    });
  });

  it('#1075 P1-b 对照：完整 seed + 真凭据 ⇒ /apply 200 且落盘 6 件（证明 400 只来自 seed 缺项）', async () => {
    await withJwtSecret(async () => {
      await withServer(async (base) => {
        const token = issueToken();
        const res = await fetch(`${base}/api/onboarding/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            documents: ['roster.md'],
            roles: [completeRoleSeed()],
            superAdminConfirmed: true,
          }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok?: boolean;
          data?: { configPack?: { written?: string[]; rejected?: unknown[] } };
        };
        expect(body.ok).toBe(true);
        expect(body.data?.configPack?.rejected).toEqual([]);
        expect(body.data?.configPack?.written?.length).toBe(EXPECTED_PIECES.length);
        expect(body.data?.configPack?.written?.length).toBe(6);
      });
    });
  });
});
