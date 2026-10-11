/**
 * tests/middleware/onboarding-whitelist.test.ts — K12-03 (#186) 白名单**窄口径**反例测试
 *
 * 目的（创始人裁定 2 明令）：「未带 token 打其他 POST ⇒ **仍 401**」——
 *   证明 `/api/onboarding/start` 的豁免**没有**把同族端点一起放开（否则等于开面）。
 *
 * 判据来源: `src/middleware/auth.ts` 的 `isWhitelisted()`（K12-03 条目）。
 * 手法: 真调 `jwtAuthMiddleware`（不 mock），用最小 express app 复现生产挂载顺序
 *   （`app.use(jwtAuthMiddleware)` 在前，路由在后）——与 `probe-onboarding.ts:196` 同形。
 */
import { describe, expect, it } from 'vitest';
import express from 'express';
import type { Request, Response } from 'express';
import { createServer, type Server } from 'http';
import { jwtAuthMiddleware } from '../../src/middleware/auth';

/** 起一个只在 127.0.0.1 监听的临时 app（生产挂载顺序） */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  // 两个探针端点：一个白名单、一个非白名单
  app.post('/api/onboarding/start', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  app.post('/api/onboarding/apply', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  const server: Server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** 在无 DEV_MODE / 无 JWT_SECRET 的"生产姿态"下跑（fail-closed 才是判据） */
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

describe('K12-03 白名单窄口径', () => {
  it('未带 token 打白名单端点 /api/onboarding/start ⇒ **放行**（非 401）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: true, documents: [] }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      });
    });
  });

  it('🔴 反例：未带 token 打**同族非白名单**端点 /api/onboarding/apply ⇒ **仍 401**', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: false, documents: [] }),
        });
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code?: string };
        expect(body.code).toBe('UNAUTHORIZED');
      });
    });
  });

  it('反例：未带 token 打任意陌生 POST ⇒ 仍 401（豁免未越界成前缀）', async () => {
    await withProdEnv(async () => {
      const app = express();
      app.use(express.json());
      app.use(jwtAuthMiddleware);
      app.post('/api/onboarding/start-extra', (_req: Request, res: Response) => res.json({ ok: true }));
      const server = app.listen(0);
      await new Promise<void>((r) => server.once('listening', () => r()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      try {
        const res = await fetch(`http://127.0.0.1:${String(port)}/api/onboarding/start-extra`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        expect(res.status).toBe(401);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  it('白名单路径带**无效 Bearer** ⇒ 照旧放行，但不注入身份（D947 语义：不要求 ≠ 忽略）', async () => {
    await withProdEnv(async () => {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-token' },
          body: JSON.stringify({ dryRun: true, documents: [] }),
        });
        expect(res.status).toBe(200);
      });
    });
  });
});
