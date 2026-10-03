/**
 * tests/routes/ga-auth.test.ts — D551 共享 GA 认证 requireGa（ga-annotations L44-60 模式提取）
 *
 * 覆盖（正常/降级/边界，铁律 48）:
 *   - 401 无认证上下文 / 400 缺 orgId（D338 fail-closed）/ 403 非 ga-admin（三态）
 *   - ga / admin 角色放行（200 路径返回 true）
 *   - D947（L-18 迁移）: legacy x-synova-token 自报路径**已断** → 401。
 *     原契约「middleware/auth 既有语义放行，提取不回改验证」随 D947 默认安全姿态退役。
 *     该断开是**已登记功能回退**（派单件 §六 遗留 2，与 R5/REV-8 并列）——见文件末 §功能回退登记。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response } from 'express';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947）—— 夹具自证环境已就位，否则判空转
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});

describe('requireGa 共享认证（D551）', () => {
  async function loadRequireGa() {
    const mod = await import('../../src/routes/ga-auth');
    return mod.requireGa;
  }

  function makeRes(): { res: Response; status: () => number; body: () => Record<string, unknown> } {
    const captured: { code: number; json: Record<string, unknown> | undefined } = { code: 200, json: undefined };
    const res = {
      status(code: number): Response { captured.code = code; return res as unknown as Response; },
      json(b: unknown): Response { captured.json = b as Record<string, unknown>; return res as unknown as Response; },
    } as unknown as Response;
    return { res, status: () => captured.code, body: () => captured.json ?? {} };
  }

  function makeReq(auth?: unknown, headers?: Record<string, unknown>): Request {
    const req: Record<string, unknown> = { headers: headers ?? {} };
    if (auth !== undefined) req.auth = auth;
    return req as unknown as Request;
  }

  it('无认证上下文 → 401 UNAUTHORIZED + 返回 false', async () => {
    const requireGa = await loadRequireGa();
    const { res, status, body } = makeRes();
    const ok = requireGa(makeReq(), res);
    expect(ok).toBe(false);
    expect(status()).toBe(401);
    expect(body().code).toBe('UNAUTHORIZED');
  });

  it('auth 缺 orgId → 400 ORG_REQUIRED（D338 fail-closed，不回落 default）', async () => {
    const requireGa = await loadRequireGa();
    const { res, status, body } = makeRes();
    const ok = requireGa(makeReq({ sub: 'u1', role: 'ga', orgId: '' }), res);
    expect(ok).toBe(false);
    expect(status()).toBe(400);
    expect(body().code).toBe('ORG_REQUIRED');
  });

  it('非 ga/admin 角色 → 403 FORBIDDEN', async () => {
    const requireGa = await loadRequireGa();
    const { res, status, body } = makeRes();
    const ok = requireGa(makeReq({ sub: 'u1', role: 'staff', orgId: 'org-1' }), res);
    expect(ok).toBe(false);
    expect(status()).toBe(403);
    expect(body().code).toBe('FORBIDDEN');
  });

  it('ga 角色放行 → true（零响应写入）', async () => {
    const requireGa = await loadRequireGa();
    const { res, status, body } = makeRes();
    const ok = requireGa(makeReq({ sub: 'ga-1', role: 'ga', orgId: 'org-1' }), res);
    expect(ok).toBe(true);
    expect(status()).toBe(200);
    expect(body().ok).toBeUndefined();
  });

  it('admin 角色放行 → true（边界: admin 与 ga 同权）', async () => {
    const requireGa = await loadRequireGa();
    const { res, status } = makeRes();
    const ok = requireGa(makeReq({ sub: 'admin-1', role: 'admin', orgId: 'org-1' }), res);
    expect(ok).toBe(true);
    expect(status()).toBe(200);
  });

  // D947（L-18 迁移）: 原断言「legacy x-synova-token 放行（middleware/auth 既有语义不回改）」，
  // 现按 D947 默认安全姿态**反转为拒绝**——用例名保留原意图（legacy header 路径），仅改期望值。
  // 断言强度不降级：断言精确 401 + 错误码，而非 not.toBe(200) 之类弱断言。
  it('legacy x-synova-token header 路径: ga:org:userId → 401 UNAUTHORIZED（D947 自报通道已断，原为放行）', async () => {
    const requireGa = await loadRequireGa();
    const { res, status, body } = makeRes();
    const ok = requireGa(makeReq(undefined, { 'x-synova-token': 'ga:org-d551:ga-legacy' }), res);
    expect(ok).toBe(false);
    expect(status()).toBe(401);
    expect(body().code).toBe('UNAUTHORIZED');
  });
});

// ════════════════════════════════════════════════════════════════
// §功能回退登记（D947 / L-18）—— 不是「测试调整」，是产品面行为变更
//
// 断开的东西: `x-synova-token: <role>:<orgId>:<userId>` 自报身份通道。
// 原因: D947 默认安全姿态——不经验签的字符串不得作为身份来源（判据 P0）。
//
// 运行时后果（已实测的调用方，均返 401）:
//   · /api/solutions                     ← src/routes/solutions.ts:32/37/46 requireAuth
//   · 全部 requireGa 的 /api/ga/*         ← src/routes/ga-auth.ts:21
//     （ga-annotations / ga-corrections / ga-admin）
//   · /api/audit、/api/enterprise、/api/ga/calibration、/api/ga/corrections
// 受影响客户端: 桌面 GA 的 dev-seed 旁路
//   · electron-renderer/src/components/RightPanel.tsx:155-159（seed 存在时附该头）
//   · electron-renderer/src/stores/ga-collab.ts:44/92（getSeedToken 组装 role:orgId:userId）
//
// 登记去向: 派单件 §六 遗留 2「electron-renderer 的 dev-seed 旁路将失效…正确修法
// （改走正规登录）属 Mac 域，须另立卡」——与 R5 / REV-8 并列为第 2 条功能回退。
// **本 PR 不修**；功能下线（迁移到 Bearer JWT）+ 该卡登记须由 CTO 执行「另立卡」。
// ════════════════════════════════════════════════════════════════
