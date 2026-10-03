/**
 * tests/routes/department-workspace.test.ts — 部门工作台真实测试
 *
 * D947 PR-2b 存量修订（P0 回归）:
 *   改前用例把「服务端信任未验签的 `x-synova-token` 头并从中派生部门名」当作**期望行为**
 *   （`expect(html).toContain('marketing')`，由 `headers['x-synova-token']='manager:marketing:alice'` 驱动）。
 *   该契约已退役（CTO 决策 ① / PR-1）：自报头不再参与身份派生。
 *   ⇒ 按新语义**改写期望**（不是删断言）：自报头在场时输出**必须与不带该头时逐字节相同**，
 *   且不得出现由自报串派生的部门名。
 *
 * 判别性（删掉即报红）: 若有人把 `department-workspace.ts` 的自报头读取恢复，
 *   「自报头三形态输出两两相同」这条会立刻变红。
 *
 * 铁律 48: 每条用例均有 expect 断言；覆盖正常路径 / 自报头拒绝路径 / 边界。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Router } from 'express';

/** express Router stack 最小类型（零 as any — 铁律 38） */
interface RouteLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown) => unknown }>;
  };
}
interface RouterLike {
  stack: RouteLayer[];
}

/** 被测 handler 的 mock 请求（最小结构，仅 headers/query 被读取） */
type MockReq = { headers: Record<string, string>; query: Record<string, string> };

describe('department-workspace route', () => {
  let router: Router;
  let handler: ((req: unknown, res: unknown) => unknown) | undefined;

  // ════════════════════════════════════════════════════════════════
  // D947 N1 硬前置 —— 夹具自证环境已就位，否则判空转（不算通过）
  // ════════════════════════════════════════════════════════════════

  beforeAll(async () => {
    process.env.JWT_SECRET = 'd947-test-secret-0123456789';
    process.env.DEV_MODE = 'false';
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
    expect(process.env.DEV_MODE).toBe('false');

    const mod = await import('../../src/routes/department-workspace');
    router = mod.default;
    // 从 router stack 取 GET /dept handler
    const stack = (router as unknown as RouterLike).stack;
    const route = stack.find((s) => s.route?.path === '/dept');
    handler = route?.route?.stack[0]?.handle;
  });

  /** 用给定 mock req 渲染一次 GET /dept，返回 HTML */
  async function renderDept(req: MockReq): Promise<string> {
    let html = '';
    const res = {
      send: (h: string) => { html = h; return res; },
    };
    await handler?.(req, res);
    return html;
  }

  it('模块导出Router', () => {
    expect(router).toBeDefined();
  });

  it('GET /dept 返回HTML骨架（含 workspace-list）', async () => {
    expect(handler, 'GET /dept handler 必须可提取（否则判空转）').toBeDefined();
    const html = await renderDept({ headers: {}, query: {} });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('workspace-list');
  });

  it('自报头不再派生部门名（P0 回归 — 改写期望，不删断言）', async () => {
    expect(handler).toBeDefined();
    // 改前: 该请求会让 dept='marketing'，HTML 含 'marketing'（旧契约，已退役）
    const html = await renderDept({ headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('workspace-list');
    // D947: 自报串派生的部门名**不得**出现在输出中
    expect(html).not.toContain('marketing');
    // 且回落到常量兜底（JWT 载荷无部门字段 ⇒ R5/REV-8 已登记功能回退）
    expect(html).toContain('dept部');
  });

  it('GET /dept 默认department为dept（无自报头边界）', async () => {
    expect(handler).toBeDefined();
    const html = await renderDept({ headers: {}, query: {} });
    expect(html).toContain('dept');
  });

  it('判别性: 自报头 / query.token 三形态对输出零影响（删改回自报读取即红）', async () => {
    expect(handler).toBeDefined();
    const withHeader = await renderDept({ headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} });
    const withQueryToken = await renderDept({ headers: {}, query: { token: 'manager:marketing:alice' } });
    const bare = await renderDept({ headers: {}, query: {} });

    expect(withHeader).toBe(bare);
    expect(withQueryToken).toBe(bare);
    // 反证: 三种形态都不得带出 'marketing'（若恢复任一路自报读取，本条即红）
    expect(withHeader).not.toContain('marketing');
    expect(withQueryToken).not.toContain('marketing');
    // 且三形态都不是空/未渲染
    expect(withHeader.length).toBeGreaterThan(0);
  });
});
