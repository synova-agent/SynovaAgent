/**
 * tests/routes/config.test.ts — D600: GET /api/config/dump 客户配置检查表面（--dump-config 三件套）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-D600-cfg-productize-first-command-20260908.md §4
 * 路径说明: 组2b 配对映射 src/routes/config.ts → tests/routes/config.test.ts（tests/routes/ 既有
 *          惯例 *.test.ts，D575 先例）——spec §3.1 原名 config-dump.test.ts 的登记偏差，§3.2 同 commit 回填。
 * 依赖: D599 resolveCustomerConfig（复用不重写）。
 *
 * 验证（修复前无 dump 端点 → 404/模块不存在 → red）:
 *   ① dump 返回逐层 provenance（default/industry/customer/workspace 来源 + contributedKeys）
 *   ② 泄漏键已剥离（顶层保留全局键不出现 + audit 上报 + degraded）
 *   ③ orgId 缺省返回 400
 *   ④ 无包 orgId → degraded 不抛（铁律 24/31）
 *   ⑤ 非法 orgId（路径逃逸尝试）→ 不逃逸、degraded 返回
 *
 * 铁律 12: 集成测试走真实路由（express app + listen(0) + fetch），不 mock 管线。
 * 测试夹具: cwd/customer-config/{orgId}/*.yml（afterAll 只删本测试 orgId 子目录，防并行竞态）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'http';

const ORG_FULL = 'd600-dump-full';
const ORG_LEAK = 'd600-dump-leak';
const CONFIG_ROOT = join(process.cwd(), 'customer-config');

interface DumpBody {
  ok?: boolean;
  orgId?: string;
  config?: Record<string, unknown>;
  provenance?: Array<{ layer?: string; present?: boolean; contributedKeys?: string[] }>;
  degraded?: boolean;
  reason?: string;
  audit?: Array<{ path?: string; kind?: string }>;
  code?: string;
  error?: string;
}

async function dump(baseUrl: string, query: string): Promise<{ status: number; body: DumpBody }> {
  // #838 E-2 ②: 路由现在要求「验签身份组织 == ?orgId」。测试用 `x-test-org` 模拟中间件注入
  //   （生产由 jwtAuthMiddleware 注入 req.auth；本文件只挂 config 路由，故自带注入缝）。
  const m = /orgId=([^&]*)/.exec(query);
  const declared = m ? decodeURIComponent(m[1] ?? '') : '';
  const res = await fetch(`${baseUrl}/api/config/dump${query}`, {
    headers: declared ? { 'x-test-org': declared } : {},
  });
  const body = (await res.json()) as DumpBody;
  return { status: res.status, body };
}

describe('D600: GET /api/config/dump 检查表面', () => {
  // ── #838 E-2 ②: 跨租户 fail-closed（两态）────────────────────────────────
  it('E2-②a 无身份（未注入 req.auth）⇒ 403 CROSS_ORG_DENIED / auth_org_missing', async () => {
    const res = await fetch(`${baseUrl}/api/config/dump?orgId=${ORG_FULL}`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as DumpBody;
    expect(body.code).toBe('CROSS_ORG_DENIED');
    expect(body.reason).toBe('auth_org_missing');
  });

  it('E2-②b 身份组织 != ?orgId ⇒ 403 CROSS_ORG_DENIED / org_mismatch', async () => {
    const res = await fetch(`${baseUrl}/api/config/dump?orgId=${ORG_FULL}`, {
      headers: { 'x-test-org': ORG_LEAK },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as DumpBody;
    expect(body.code).toBe('CROSS_ORG_DENIED');
    expect(body.reason).toBe('org_mismatch');
  });

  it('E2-②c 身份组织 == ?orgId ⇒ 200（正常路径不被误伤）', async () => {
    const { status, body } = await dump(baseUrl, `?orgId=${ORG_FULL}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // full 包: industry + customer(composition) + workspace 三层 + default(路由内置空对象)
    mkdirSync(join(CONFIG_ROOT, ORG_FULL), { recursive: true });
    writeFileSync(
      join(CONFIG_ROOT, ORG_FULL, 'industry.yml'),
      'industryKey: industry-value\ndiagnosis:\n  reportDepth: expert\n',
      'utf8',
    );
    writeFileSync(
      join(CONFIG_ROOT, ORG_FULL, 'config.yml'),
      'diagnosis:\n  reportDepth: ceo\n  template: flywheel\ncustomerKey: customer-value\n',
      'utf8',
    );
    writeFileSync(join(CONFIG_ROOT, ORG_FULL, 'workspace.yml'), 'workspaceKey: ws-value\n', 'utf8');
    // leak 包: 顶层保留全局键（剥离 + 审计 + degraded）
    mkdirSync(join(CONFIG_ROOT, ORG_LEAK), { recursive: true });
    writeFileSync(
      join(CONFIG_ROOT, ORG_LEAK, 'config.yml'),
      'process:\n  pid: 1\ndiagnosis:\n  reportDepth: ceo\n',
      'utf8',
    );

    const configRouter = (await import('../../src/routes/config')).default;
    const app = express();
    app.use(express.json());
    // #838 E-2 ② 注入缝：模拟 jwtAuthMiddleware 的 req.auth（生产路径由中间件注入）
    app.use((req, _res, next) => {
      const org = req.headers['x-test-org'];
      if (typeof org === 'string' && org.trim()) {
        (req as unknown as { auth?: { orgId: string } }).auth = { orgId: org.trim() };
      }
      next();
    });
    app.use(configRouter);
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') baseUrl = `http://localhost:${addr.port}`;
    });
    await new Promise<void>(resolve => { const t = setInterval(() => { if (baseUrl) { clearInterval(t); resolve(); } }, 10); });
  });

  afterAll(() => {
    for (const orgId of [ORG_FULL, ORG_LEAK]) {
      rmSync(join(CONFIG_ROOT, orgId), { recursive: true, force: true });
    }
    return new Promise<void>(resolve => { server.close(() => resolve()); });
  });

  it('① dump 返回逐层 provenance（default/industry/customer/workspace 顺序 + contributedKeys）', async () => {
    const { status, body } = await dump(baseUrl, `?orgId=${ORG_FULL}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.orgId).toBe(ORG_FULL);
    const layers = body.provenance?.map(l => l.layer) ?? [];
    expect(layers).toEqual(['default', 'industry', 'customer', 'workspace']);
    const industry = body.provenance?.find(l => l.layer === 'industry');
    expect(industry?.present).toBe(true);
    expect(industry?.contributedKeys).toContain('industryKey');
    // diagnosis 键被 customer 层覆盖 → owner 是 customer 而非 industry
    const customer = body.provenance?.find(l => l.layer === 'customer');
    expect(customer?.contributedKeys).toContain('customerKey');
    expect(industry?.contributedKeys).not.toContain('diagnosis');
  });

  it('② 泄漏键已剥离（config 干净 + audit 上报 + degraded）', async () => {
    const { status, body } = await dump(baseUrl, `?orgId=${ORG_LEAK}`);
    expect(status).toBe(200);
    expect(body.config?.process).toBeUndefined();
    expect(body.degraded).toBe(true);
    expect(body.audit?.some(e => e.path === '$.process')).toBe(true);
    expect(body.audit?.some(e => e.kind === 'reserved-global')).toBe(true);
    // 非泄漏键保留（剥离是 per 键 fail-closed，不整包丢弃）
    expect(body.config?.diagnosis).toBeDefined();
  });

  it('③ orgId 缺省返回 400（校验错误）', async () => {
    const { status, body } = await dump(baseUrl, '');
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('④ 无包 orgId → degraded 不抛（default 层兜底）', async () => {
    const { status, body } = await dump(baseUrl, '?orgId=d600-dump-none');
    expect(status).toBe(200);
    expect(body.degraded).toBe(true);
    expect(body.ok).toBe(true);
    expect(String(body.reason)).toContain('无客户配置包');
    expect(Object.keys(body.config ?? {}).length).toBe(0);
  });

  it('⑤ 非法 orgId（路径逃逸尝试）→ 不逃逸、degraded 返回', async () => {
    const { status, body } = await dump(baseUrl, '?orgId=..%2Fescape');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.orgId).toBe('../escape');
    expect(Object.keys(body.config ?? {}).length).toBe(0);
  });
});
