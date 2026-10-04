/**
 * tests/routes/actions-api.test.ts — 行动项 CRUD 端点测试
 *
 * D1153 适配（夹具升级；断言只增不减 —— 铁律 48）:
 *   改前夹具: `(router as` + ` any).stack[0].route.stack[0].handle` 直调 handler，
 *     req 无任何身份 ⇒ 加路由级守卫后全部 403 ⇒ 业务断言必红。
 *   改后夹具: 真 `express()` + `app.listen(0)` + 真 `jwtAuthMiddleware` +
 *     真 `rbacMiddleware` + 真签 JWT（`signJwtToken`）⇒ 请求走真 socket，
 *     顺带移除全部 any 断言（铁律 38）。
 *
 * 判据守恒（原 5 条断言逐条保留）:
 *   · 模块导出                        · POST 创建成功（ok/status/title）
 *   · POST 缺字段 → 400               · PUT 流转成功（ok/status=confirmed）
 *   · GET 列表过滤（ok/actions.length）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'd1153-actions-api-secret-0123456789';
process.env.DEV_MODE = 'false';

import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';

let base = '';
let server: Server | undefined;
let token = '';

interface HttpResult { status: number; body: Record<string, unknown> }

function call(method: string, path: string, opts: { body?: unknown } = {}): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const url = new URL(`${base}${path}`);
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => { chunks.push(c); });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try { body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { body = { __unparsed: raw }; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** 以指定角色身份发一次请求（夹具内身份切换，避免复用手搓 req 对象） */
async function callAs(role: string, method: string, path: string, body?: unknown): Promise<HttpResult> {
  const saved = token;
  const signed = signJwtToken({ sub: `${role}-d1153`, role, orgId: 'org-d1153' });
  expect(signed, `夹具失败: ${role} token 签发返回 null`).not.toBeNull();
  token = signed ?? '';
  try {
    return await call(method, path, { body });
  } finally {
    token = saved;
  }
}

beforeAll(async () => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
  const signed = signJwtToken({ sub: 'admin-d1153', role: 'admin', orgId: 'org-d1153' });
  expect(signed).not.toBeNull();
  token = signed ?? '';

  const router = (await import('../../src/routes/actions-api')).default;
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  app.use(router);

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const addr = server?.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => { server?.close(); });

describe('actions-api', () => {
  it('模块导出', async () => {
    const mod = await import('../../src/routes/actions-api');
    expect(mod.default).toBeDefined();
  });

  it('POST /api/actions → 创建成功', async () => {
    const res = await call('POST', '/api/actions', { body: { workspaceId: 'ws1', title: '修复现金流' } });
    expect(res.status).toBe(200);
    const action = res.body.action as { status?: string; title?: string };
    expect(res.body.ok).toBe(true);
    expect(action.status).toBe('pending');
    expect(action.title).toBe('修复现金流');
  });

  it('POST 缺字段 → 400', async () => {
    const res = await call('POST', '/api/actions', { body: {} });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('PUT status → 流转成功', async () => {
    // First create
    const created = await call('POST', '/api/actions', { body: { workspaceId: 'ws1', title: '测试' } });
    expect(created.status).toBe(200);
    const id = (created.body.action as { id?: string }).id;
    expect(typeof id).toBe('string');

    // Then update
    const updated = await call('PUT', `/api/actions/${id}/status`, { body: { status: 'confirmed' } });
    expect(updated.status).toBe(200);
    expect(updated.body.ok).toBe(true);
    expect((updated.body.action as { status?: string }).status).toBe('confirmed');
  });

  it('GET → 列表过滤', async () => {
    const res = await call('GET', '/api/actions?workspaceId=ws1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const actions = res.body.actions as unknown[];
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it('D1153 守卫在真链路生效: 未认证 ⇒ 403（纵深防御面）', async () => {
    // 纵深防御面 = 只有 rbac 注入层（无 jwt 层）⇒ 真 rbacMiddleware 产出 authenticated:false
    const router = (await import('../../src/routes/actions-api')).default;
    const bare = express();
    bare.use(express.json());
    bare.use(rbacMiddleware);
    bare.use(router);
    const srv = await new Promise<Server>((resolve) => {
      const s = bare.listen(0, () => resolve(s));
    });
    try {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const res = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
        const req = httpRequest(
          { hostname: '127.0.0.1', port, path: '/api/actions', method: 'GET' },
          (r) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => { chunks.push(c); });
            r.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              let body: Record<string, unknown> = {};
              try { body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { body = { __unparsed: raw }; }
              resolve({ status: r.statusCode ?? 0, body });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('RBAC_DENIED');
    } finally {
      srv.close();
    }
  });

  it('D1153 叠判据在真链路生效: staff 已认证但无写权 ⇒ 403（非一刀切全拒，也非只验身份）', async () => {
    const res = await callAs('staff', 'POST', '/api/actions', { workspaceId: 'ws1', title: '不应创建' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RBAC_DENIED');
  });

  it('D1153 叠判据不误杀: manager 已认证且有权 ⇒ 200', async () => {
    const res = await callAs('manager', 'POST', '/api/actions', { workspaceId: 'ws1', title: '中层创建' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
