/**
 * workspace-department-scope.integration.test.ts — E2 / 边卡对照表：部门越权判定（真消费方）
 *
 * 背景：#335 已把 resolveContext 接进请求路径（auth.ts）；本测试证明
 * `getCurrentDepartmentIds()` 在**真 express + 真 JWT + 真部门真源**下被
 * workspace-data 的守卫**真消费**（判据：非零真调用方 + 业务消费）。
 *
 * 覆盖：
 *  ① 有部门集（JWT departmentIds=['sales']，真源 extensions/departments/sales.yaml 存在）
 *     ⇒ 访问 deptId ∉ 部门集 且 ≠ orgId ⇒ 403 DEPARTMENT_SCOPE_DENIED
 *  ② deptId ∈ 部门集 ⇒ 不因部门被拒；③ deptId = orgId（dashboard 既有消费方）⇒ 不被拒
 *  ④ 无部门维度（JWT 无 departmentIds）⇒ 维持租户级行为（不误杀）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'e2-dept-scope-secret-0123456789abcdef';
process.env.DEV_MODE = 'false';

import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import workspaceDataRoutes from '../../src/routes/workspace-data';

let base = '';
let server: Server | undefined;

function token(departmentIds?: string[]): string {
  const t = signJwtToken({
    sub: 'u-scope', role: 'ga', orgId: 'org-1',
    ...(departmentIds ? { departmentIds } : {}),
  } as never);
  expect(t).toBeTruthy();
  return t as string;
}

async function call(path: string, bearer: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  app.use(workspaceDataRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
});
afterAll(() => server?.close());

describe('E2 部门越权判定（getCurrentDepartmentIds 真消费）', () => {
  it('有部门集 + 越权 deptId ⇒ 403 DEPARTMENT_SCOPE_DENIED', async () => {
    const r = await call('/api/workspace/dept-other', token(['sales']));
    expect(r.status).toBe(403);
    expect(r.body?.code).toBe('DEPARTMENT_SCOPE_DENIED');
  });
  it('deptId ∈ 部门集 ⇒ 不因部门被拒', async () => {
    const r = await call('/api/workspace/sales', token(['sales']));
    expect(r.body?.code).not.toBe('DEPARTMENT_SCOPE_DENIED');
  });
  it('deptId = orgId（dashboard 既有消费方）⇒ 不被拒', async () => {
    const r = await call('/api/workspace/org-1', token(['sales']));
    expect(r.body?.code).not.toBe('DEPARTMENT_SCOPE_DENIED');
  });
  it('无部门维度 ⇒ 维持租户级行为（不误杀）', async () => {
    const r = await call('/api/workspace/dept-other', token(undefined));
    expect(r.body?.code).not.toBe('DEPARTMENT_SCOPE_DENIED');
  });
});
