/**
 * tests/routes/evolution-rbac.test.ts — D1196 / P0-2: evolution 10 个端点 RBAC 守卫（fail-closed）
 *
 * 判据（派单 §一 P0-2）：
 *   ① 10 个端点**逐个**：无认证上下文请求 ⇒ 断言 403 + `code:'RBAC_DENIED'`
 *   ② 改坏即红：删掉任一端点的 `requireEvolutionRbac` 守卫 ⇒ 该端点必放行（不再 403）⇒ 本夹具红
 *
 * 手法（照仓库既有直证形态 tests/security/rbac-all-routes.test.ts）：
 *   裸 express + **只挂 `rbacMiddleware`（不挂 jwt）** ⇒ `req.rbac.authenticated === false`
 *   ⇒ 路由级守卫必须 fail-closed 拒绝。🔴 本夹具**不重算身份**，走真实中间件注入的 `req.rbac`。
 */
import express from 'express';
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rbacMiddleware } from '../../src/middleware/rbac';
import evolutionRoutes from '../../src/routes/evolution';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(rbacMiddleware); // 只挂 rbac（不挂 jwt）⇒ authenticated:false ⇒ 守卫必须 403
  app.use(evolutionRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 10 个端点全覆盖（派单端点清单） */
const ENDPOINTS: Array<[string, string]> = [
  ['get', '/api/evolution/proposals'],
  ['get', '/api/evolution/status'],
  ['post', '/api/evolution/proposals/p-1/approve'],
  ['post', '/api/evolution/proposals/p-1/reject'],
  ['post', '/api/evolution/aggregate/saas-tech'],
  ['post', '/api/evolution/feedback/collect'],
  ['post', '/api/evolution/signal/update-weight'],
  ['get', '/api/evolution/global/analyze'],
  ['get', '/api/evolution/cross-customer/patterns'],
  ['post', '/api/evolution/federation/import'],
];

describe('D1196/P0-2: evolution 端点 RBAC 守卫（fail-closed，10/10）', () => {
  it('端点清单恰好 10 个（防夹具静默漏测）', () => {
    expect(ENDPOINTS).toHaveLength(10);
  });

  it.each(ENDPOINTS)('%s %s 无认证上下文 ⇒ 403 + code=RBAC_DENIED', async (method, path) => {
    const res = await fetch(`${base}${path}`, {
      method: method.toUpperCase(),
      headers: { 'content-type': 'application/json' },
      ...(method === 'post' ? { body: '{}' } : {}),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('RBAC_DENIED');
  });
});
