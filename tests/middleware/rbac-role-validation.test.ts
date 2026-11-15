/**
 * #1408 验收 T-9 —— 全局 RBAC 边界双向回归（v7 §5.4 / §7 T-9）
 *
 * 双向断言：
 *   ① **合法枚举角色**（5 个）经真实 JWT ⇒ `authenticated:true`，且 `canAccessWorkspace`
 *      对 ws 矩阵 `[{sensitivity:'S1'},{sensitivity:'S3'},{sensitivity:undefined}]` 与**基线逐格一致**；
 *   ② **非枚举 / 缺失角色** ⇒ `authenticated:false` + 审计 `reason:'invalid_role'`
 *      （**不得**复用 `no_authenticated_context`）。
 *
 * 基线口径（v7 §7 T-9）：先在 `gitea/main = 8b662ba0`（改动前）用一次性临时探针跑同一矩阵并保存
 * 原始输出（探针不入库不提交、跑完即删），下表逐字取自该次输出：
 *   ```
 *   [BASELINE-GRID] as_of=8b662ba0
 *   admin	authenticated=true	effectiveRole=admin	grid=T,T,T
 *   manager	authenticated=true	effectiveRole=manager	grid=F,F,F
 *   liaison	authenticated=true	effectiveRole=liaison	grid=T,T,T
 *   staff	authenticated=true	effectiveRole=staff	grid=F,F,F
 *   ga	authenticated=true	effectiveRole=ga	grid=T,F,T
 *   [/BASELINE-GRID]
 *   ```
 * 该基线**冻结**在此：任何合法角色的既有授权行为变化 ⇒ 本文件必红（`D-v` 停工判据的可执行形式）。
 */
import { describe, expect, it, vi } from 'vitest';

/** 捕获审计日志（`reason` 区分是本次新增判据的核心）。 */
const captured = vi.hoisted(() => [] as Array<{ level: string; meta?: Record<string, unknown> }>);

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: Record<string, unknown>) => { captured.push({ level, meta }); };
  return {
    ...actual,
    createLogger: () => ({ info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') }),
  };
});

import { signJwtToken, verifyJwtToken } from '../../src/middleware/auth';
import { canAccessWorkspace, extractRbacContext } from '../../src/middleware/rbac';

process.env.JWT_SECRET = 't9-role-validation-secret-0123456789';
process.env.DEV_MODE = 'false';

const WS_MATRIX = [{ sensitivity: 'S1' }, { sensitivity: 'S3' }, { sensitivity: undefined }] as const;
const BASELINE_GRID: Record<string, string> = {
  admin: 'T,T,T',
  manager: 'F,F,F',
  liaison: 'T,T,T',
  staff: 'F,F,F',
  ga: 'T,F,T',
};

/** 真签 + 真验签 ⇒ 取回验签后的 payload（不手搓 JwtPayload）。 */
function verifiedPayload(role: string): Parameters<typeof extractRbacContext>[0]['auth'] {
  const token = signJwtToken({ sub: `t9-${role}`, role, orgId: 'org-t9' });
  expect(token, `t9-${role} token 签发失败`).toBeTruthy();
  const verified = verifyJwtToken(String(token));
  expect(verified.error).toBeUndefined();
  const payload = verified.payload;
  if (!payload) throw new Error('JWT 验签失败：payload 为空');
  return payload;
}

function rbacDenialsSince(mark: number): Array<Record<string, unknown>> {
  return captured.slice(mark)
    .filter(entry => entry.meta?.code === 'RBAC_DENIED')
    .map(entry => entry.meta ?? {});
}

describe('#1408 T-9 全局 RBAC 边界', () => {
  it.each(['admin', 'manager', 'liaison', 'staff', 'ga'])(
    '合法角色 %s 经真实 JWT：authenticated=true 且 canAccessWorkspace 网格与基线逐格一致',
    (role) => {
      const ctx = extractRbacContext({ auth: verifiedPayload(role) });
      expect(ctx.authenticated).toBe(true);
      expect(ctx.role).toBe(role);
      expect(ctx.userId).toBe(`t9-${role}`);
      const grid = WS_MATRIX.map(ws => (canAccessWorkspace(ctx, ws) ? 'T' : 'F')).join(',');
      expect({ role, grid }).toEqual({ role, grid: BASELINE_GRID[role] });
    },
  );

  it('非枚举角色（真实 JWT `root`）⇒ authenticated=false + reason=invalid_role（不复用 no_authenticated_context）', () => {
    const mark = captured.length;
    const ctx = extractRbacContext({ auth: verifiedPayload('root') });
    // 先取「提取期」审计（canAccessWorkspace 的拒绝日志 reason 是 unauthenticated_context，另一条）
    const denials = rbacDenialsSince(mark);
    expect(ctx.authenticated).toBe(false);
    expect(ctx.userId).toBe('unauthenticated');
    expect(ctx.role).not.toBe('root');

    expect(denials).toHaveLength(1);
    expect(denials[0].reason).toBe('invalid_role');
    expect(denials.some(meta => meta.reason === 'no_authenticated_context')).toBe(false);
    expect(denials.some(meta => meta.reason === 'unauthenticated_context')).toBe(false);

    expect(canAccessWorkspace(ctx, { visibility: 'global' })).toBe(false);
  });

  it('缺失角色（外部载荷无 role 字段）⇒ authenticated=false + reason=invalid_role', () => {
    // 外部输入来自 JSON.parse，编译期无约束 ⇒ 此处断言仅构造「缺 role」形状。
    const auth = { sub: 't9-missing', orgId: 'org-t9' } as { sub: string; role: string; orgId: string };
    const mark = captured.length;
    const ctx = extractRbacContext({ auth });
    expect(ctx.authenticated).toBe(false);
    expect(ctx.userId).toBe('unauthenticated');
    const denials = rbacDenialsSince(mark);
    expect(denials).toHaveLength(1);
    expect(denials[0].reason).toBe('invalid_role');
  });

  it('无认证上下文仍记 no_authenticated_context（两个 reason 必须可区分）', () => {
    const mark = captured.length;
    const ctx = extractRbacContext({});
    expect(ctx.authenticated).toBe(false);
    const denials = rbacDenialsSince(mark);
    expect(denials).toHaveLength(1);
    expect(denials[0].reason).toBe('no_authenticated_context');
  });
});
