/**
 * #1408 可见性契约与**补充断言**（v7 §5.1 / §5.3 / §7 T-2 #12b / T-6）
 *
 * ⚠️ 本文件的 `canViewSource` 直接判据均为**补充断言**（非真实身份链）：
 *   真实 `signJwtToken + createServer + HTTP` 的 6×2 / 21 行矩阵在
 *   `tests/routes/enterprise-scan.roles.integration.test.ts`。
 *   这里只覆盖「真实入口走不到」的纵深防御分支（ga / 未知角色 / 跨企业）与纯函数契约。
 */
import { describe, expect, it } from 'vitest';
import { EnterpriseScanError } from '../../src/connectors/enterprise-scan/errors';
import { canViewSource, isWorkspaceRole, toScanViewer } from '../../src/connectors/enterprise-scan/visibility';
import type { ScanAuthorization, ScanRole, ScanViewer } from '../../src/connectors/enterprise-scan/types';

function source(overrides: Partial<ScanAuthorization> = {}): ScanAuthorization {
  return {
    graph: 'org-a',
    manifestId: 'manifest-m',
    sourceId: 'org-a:manifest-m:operator-statement.json',
    canonicalRoot: '/root',
    allowedPath: '/root/operator-statement.json',
    format: 'json',
    visibility: 'restricted',
    allowedRoles: ['staff'],
    allowedRolesDeclared: true,
    allowedUsers: [],
    allowedDepartments: ['dept-a'],
    revision: 1,
    ...overrides,
  };
}

function scanViewer(overrides: Partial<ScanViewer> = {}): ScanViewer {
  return { sub: 'staff-a', role: 'staff', orgId: 'org-a', departmentIds: ['dept-a'], ...overrides };
}

describe('#1408 isWorkspaceRole：唯一角色真源', () => {
  it('5 个 WorkspaceRole 全为 true', () => {
    for (const role of ['admin', 'manager', 'liaison', 'staff', 'ga']) {
      expect({ role, ok: isWorkspaceRole(role) }).toEqual({ role, ok: true });
    }
  });

  it('旧扫描词表 / 未知值 / 非字符串全为 false（fail-closed）', () => {
    const invalid: unknown[] = ['owner', 'operator', 'responsible', 'root', 'Admin', '', undefined, null, 1, {}, ['admin']];
    for (const value of invalid) {
      expect({ value: String(value), ok: isWorkspaceRole(value) }).toEqual({ value: String(value), ok: false });
    }
  });
});

describe('#1408 toScanViewer：验签身份收窄（v7 §5.1 穷举三种失败）', () => {
  function expectDenied(fn: () => unknown, messagePart: string): void {
    try {
      fn();
      throw new Error(`预期拦截（含「${messagePart}」），实际成功`);
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseScanError);
      const classified = error as EnterpriseScanError;
      expect(classified.code).toBe('SCOPE_DENIED');
      expect(classified.status).toBe(403);
      expect(classified.message).toContain(messagePart);
    }
  }

  it('缺 sub / 缺 orgId ⇒ 403 SCOPE_DENIED「缺少验签企业身份」', () => {
    expectDenied(() => toScanViewer(undefined), '缺少验签企业身份');
    expectDenied(() => toScanViewer({ role: 'staff', orgId: 'org-a' }), '缺少验签企业身份');
    expectDenied(() => toScanViewer({ sub: 'staff-a', role: 'staff' }), '缺少验签企业身份');
  });

  it('role 缺失 / 非枚举 / 旧词表 ⇒ 403 SCOPE_DENIED「未知角色」', () => {
    expectDenied(() => toScanViewer({ sub: 'staff-a', orgId: 'org-a' }), '未知角色');
    expectDenied(() => toScanViewer({ sub: 'staff-a', role: '', orgId: 'org-a' }), '未知角色');
    expectDenied(() => toScanViewer({ sub: 'staff-a', role: 'root', orgId: 'org-a' }), '未知角色');
    expectDenied(() => toScanViewer({ sub: 'staff-a', role: 'responsible', orgId: 'org-a' }), '未知角色');
  });

  it('role=ga ⇒ 403 SCOPE_DENIED + **固定 message**「GA 本切片未接入来源级授权约束」', () => {
    expectDenied(() => toScanViewer({ sub: 'ga-a', role: 'ga', orgId: 'org-a' }), 'GA 本切片未接入来源级授权约束');
  });

  it('合法角色 ⇒ 原样收窄（字段零改写，含 departmentIds 透传）', () => {
    const viewer = toScanViewer({ sub: 'staff-a', role: 'staff', orgId: 'org-a', departmentIds: ['dept-a', 'dept-b'] });
    expect(viewer).toEqual({ sub: 'staff-a', role: 'staff', orgId: 'org-a', departmentIds: ['dept-a', 'dept-b'] });
  });
});

describe('#1408 canViewSource 纵深防御（补充断言，真实链在 roles.integration.test.ts）', () => {
  it('T-2 #12b：ga 直接构造 viewer ⇒ enterprise 与 restricted 均 false（canViewSource 仍拒绝）', () => {
    const ga = scanViewer({ sub: 'ga-a', role: 'ga' });
    expect(canViewSource(ga, source({ visibility: 'enterprise' }))).toBe(false);
    // restricted 三个字段都给到最宽，仍然 false（不是「因为没授权」才 false）
    expect(canViewSource(ga, source({ allowedUsers: ['ga-a'], allowedRoles: ['ga'], allowedDepartments: ['dept-a'] }))).toBe(false);
  });

  it('未知/缺失角色直接构造 viewer ⇒ 企业级与「个人+部门全命中」的 restricted 均 false', () => {
    const unknown = scanViewer({ role: 'root' as ScanRole });
    const missing = { sub: 'staff-a', orgId: 'org-a', departmentIds: ['dept-a'] } as ScanViewer;
    const widest = source({ allowedUsers: ['staff-a'], allowedRoles: ['staff'], allowedDepartments: ['dept-a'] });
    for (const viewer of [unknown, missing]) {
      expect(canViewSource(viewer, source({ visibility: 'enterprise' }))).toBe(false);
      expect(canViewSource(viewer, widest)).toBe(false);
    }
  });

  it('跨企业：admin 也不得越过 graph 边界（org-b viewer × org-a source ⇒ false）', () => {
    expect(canViewSource(scanViewer({ role: 'admin', orgId: 'org-b' }), source({ visibility: 'enterprise' }))).toBe(false);
    expect(canViewSource(scanViewer({ role: 'admin', orgId: 'org-b' }), source())).toBe(false);
    // 同企业 admin 不受来源级字段约束（对照，证明上面的 false 不是「admin 一律 false」）
    expect(canViewSource(scanViewer({ role: 'admin' }), source({ allowedUsers: [], allowedRoles: ['manager'], allowedDepartments: ['dept-other'] }))).toBe(true);
  });

  it('T-6 补充：部门缺失/空/不相关/来源侧空 ⇒ staff 的 restricted 不可见', () => {
    const noDepartments = [undefined, [] as string[], ['dept-other']];
    for (const departmentIds of noDepartments) {
      expect({ departmentIds, visible: canViewSource(scanViewer({ departmentIds }), source({ allowedRoles: [], allowedRolesDeclared: false })) })
        .toEqual({ departmentIds, visible: false });
    }
    expect(canViewSource(scanViewer(), source({ allowedRoles: [], allowedRolesDeclared: false, allowedDepartments: [] }))).toBe(false);
  });

  it('个人短路不被角色闸否决（#6bis 的直接判据）：个人命中 + 部门命中 + 角色清单不含本人 ⇒ true', () => {
    expect(canViewSource(scanViewer(), source({ allowedUsers: ['staff-a'], allowedRoles: ['manager'], allowedDepartments: ['dept-a'] }))).toBe(true);
  });
});
