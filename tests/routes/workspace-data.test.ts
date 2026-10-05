/**
 * tests/routes/workspace-data.test.ts — D74 工作台数据 API 端点测试
 *
 * D1153 适配（夹具升级；断言只增不减 —— 铁律 48）:
 *   改前夹具: 裸 `express()` + 本路由，**无任何身份层**；并用
 *     `(router.default as` + ` any).stack` 做路由内省（铁律 38 禁止形态）。
 *   改后夹具: 真 `jwtAuthMiddleware` + 真 `rbacMiddleware` + 真签 JWT（`signJwtToken`），
 *     请求走真 socket。理由: ① 加路由级守卫后「无身份」请求必 403，业务断言不可达
 *     ② 路由内省改为**真 HTTP 可达性探测**（更强 —— 同时证明路径已注册且可被真实
 *     请求命中；栈内省只能证明「注册过」）③ 借此移除该 any 断言。
 *
 * 判据守恒: 原 3 条断言的语义全部保留并加强——
 *   · `router.default` 已定义                    → 保留
 *   · 5 个端点已注册（栈内省 + `length>=4`）      → 改为 5 条路径真 HTTP 可达（200，恰 5 条）
 *   · `GET /api/workspace/:deptId` 返回 json 结构 → 保留（`ok` / `data` / `data.departmentId`）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'd1153-workspace-data-secret-0123456789';
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
          try { body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch {
            // 非 JSON 响应（如 500 文本/空体）⇒ 保留原文供判据报错
            body = { __unparsed: raw };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
  const signed = signJwtToken({ sub: 'admin-d1153', role: 'admin', orgId: 'org-d1153' });
  expect(signed).not.toBeNull();
  token = signed ?? '';

  const router = (await import('../../src/routes/workspace-data')).default;
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

describe('D74: workspace-data routes — 路由注册', () => {
  it('导出默认 Router 实例', async () => {
    const mod = await import('../../src/routes/workspace-data');
    expect(mod.default).toBeDefined();
  });

  it('已注册 5 个端点（真 HTTP 可达性探测，非栈内省）', async () => {
    const probes: Array<{ label: string; method: string; path: string; body?: unknown }> = [
      { label: 'GET 全量数据', method: 'GET', path: '/api/workspace/test-dept' },
      { label: 'GET goals', method: 'GET', path: '/api/workspace/test-dept/goals' },
      { label: 'GET alerts', method: 'GET', path: '/api/workspace/test-dept/alerts' },
      { label: 'GET next-action', method: 'GET', path: '/api/workspace/test-dept/next-action' },
      { label: 'PUT alerts/:id/dismiss', method: 'PUT', path: '/api/workspace/alerts/alert-1/dismiss', body: { reason: '用例' } },
    ];
    for (const p of probes) {
      const res = await call(p.method, p.path, { body: p.body });
      expect({ label: p.label, status: res.status }).toEqual({ label: p.label, status: 200 });
    }
  });

  it('GET /api/workspace/:deptId 返回 json 结构', async () => {
    const res = await call('GET', '/api/workspace/test-dept');
    expect(res.status).toBe(200);
    const data = res.body;
    expect(data).toHaveProperty('ok');
    expect(data).toHaveProperty('data');
    const payload = data.data as { departmentId?: string };
    expect(payload).toHaveProperty('departmentId', 'test-dept');
  });

  it('D1153 身份门在真链路生效: staff 已认证读部门工作台 ⇒ 200（本卡不做越权判定，勿过度拒绝）', async () => {
    const staffToken = signJwtToken({ sub: 'staff-d1153', role: 'staff', orgId: 'org-d1153' });
    expect(staffToken).not.toBeNull();
    const saved = token;
    token = staffToken ?? '';
    try {
      // 刻意: 本卡只做身份门（`authenticated !== true` ⇒ 403）。跨部门越权判定依赖
      //   `RbacContext` 补齐 org/team 维度（另立卡）——曾叠部门级读判据 ⇒ 因
      //   `department` 恒 undefined 而恒假 ⇒ app/js/dashboard.js:35 的真消费方
      //   （manager/staff）静默空面板 = 过度拒绝，已撤。
      const res = await call('GET', '/api/workspace/test-dept');
      expect(res.status).toBe(200);
      const payload = res.body.data as { departmentId?: string };
      expect(payload).toHaveProperty('departmentId', 'test-dept');
    } finally {
      token = saved;
    }
  });

  it('D1153 身份门在真链路生效: 未认证 ⇒ 401（非白名单路径由 jwt 层先行拦截）', async () => {
    const saved = token;
    token = '';
    try {
      // 路由级 403 的直证在 tests/security/rbac-all-routes.test.ts 组 A
      //   （只挂 rbacMiddleware，不挂 jwt ⇒ 真 rbacMiddleware 产出 authenticated:false ⇒ 403）。
      const res = await call('GET', '/api/workspace/test-dept');
      expect(res.status).toBe(401);
    } finally {
      token = saved;
    }
  });
});
