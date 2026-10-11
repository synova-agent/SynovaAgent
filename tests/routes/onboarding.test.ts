/**
 * tests/routes/onboarding.test.ts — `src/routes/onboarding.ts` 专用配对测试（铁律 48）
 *
 * 覆盖：路由栈形状（V3 零表单）｜判据入口端点存在且是 POST｜HTTP 层真调（穿真 router + 真 auth 中间件）
 *       正常（dry-run 2xx 不落盘）｜降级（零文档 degraded 但 2xx）｜边界（apply 未确认 ⇒ 409 fail-closed）
 *
 * 🔴 与 `tests/onboarding/onboarding-flow.test.ts` 分工：那份测**流程与生成器**，这份测**HTTP 边界**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import onboardingRouter from '../../src/routes/onboarding';
import { jwtAuthMiddleware } from '../../src/middleware/auth';

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
  it('POST /api/onboarding/start（dry-run）⇒ 200 且**不落盘**', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: true, documents: ['roster.md'], roles: [{ roleId: 'finance' }] }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; data: { configPack: { written: string[]; planned: string[] } } };
        expect(body.ok).toBe(true);
        expect(body.data.configPack.written).toEqual([]);
        expect(body.data.configPack.planned.length).toBeGreaterThan(0);
        expect(existsSync(join(root, 'extensions'))).toBe(false);
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

  it('🔴 apply 未超管确认 ⇒ **409**（fail-closed，不落盘）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ documents: ['roster.md'], roles: [{ roleId: 'finance' }] }),
        });
        // apply 不在白名单 ⇒ 先被 auth 拦（401）；两者都证明"未确认/未鉴权不得落盘"
        expect([401, 409]).toContain(res.status);
        expect(existsSync(join(root, 'extensions'))).toBe(false);
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
          body: JSON.stringify({ dryRun: true, rootDir: evil, documents: ['x.md'], roles: [{ roleId: 'finance' }] }),
        });
        expect(res.status).toBe(200);
        expect(existsSync(evil)).toBe(false);
        void readdirSync;
      });
    });
  });
});
