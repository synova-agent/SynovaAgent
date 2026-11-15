/**
 * #1408 store 读路径：角色清单的 raw-vs-filtered 口径与 fail-closed（v7 §5.2）
 *
 * 判据（改坏即红）：
 *   · `allowedRolesDeclared` 取**成功解析的原始数组长度**（不是过滤后长度）⇒ 旧词表
 *     `["responsible"]` 必须 declared=true + allowedRoles=[]（T-2 #5bis 的数据形状）；
 *   · 解析失败（非法 JSON / 非数组 / 含非字符串）⇒ **整份来源清单不可见**（`?? []` 会假绿）；
 *   · 每请求每源至多一条 warn（重复调用 ⇒ 每次仍各出一条，证明没有模块级 Set 抑制）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScanHarness } from './test-helpers';

/** 捕获 warn（store 的非法角色过滤日志）。 */
const captured = vi.hoisted(() => [] as Array<{ level: string; meta?: Record<string, unknown> }>);

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: Record<string, unknown>) => { captured.push({ level, meta }); };
  return {
    ...actual,
    createLogger: () => ({ info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') }),
  };
});

import { createScanHarness } from './test-helpers';
import { seedManifest, writeFixtureRoot } from './fixtures';

function harnessWithRestricted(): ScanHarness & { root: string } {
  const harness = createScanHarness();
  const root = writeFixtureRoot();
  seedManifest(harness.db, { root, restricted: ['operator-statement.json'] });
  return { ...harness, root };
}

describe('#1408 store 读路径（allowedRolesDeclared 口径）', () => {
  it('旧词表 raw `["responsible"]` ⇒ declared=true、allowedRoles=[]、每源一条 warn', () => {
    const { db, store, close } = harnessWithRestricted();
    try {
      db.prepare("UPDATE scan_authorizations SET allowed_roles_json = ? WHERE source_id LIKE '%operator-statement'").run(JSON.stringify(['responsible']));
      const mark = captured.length;
      const authorizations = store.listAuthorizations('org-a', 'manifest-golden');
      expect(authorizations).toHaveLength(4);
      const restricted = authorizations.find(item => item.sourceId.includes('operator-statement'));
      expect(restricted).toBeDefined();
      expect(restricted?.allowedRoles).toEqual([]);
      expect(restricted?.allowedRolesDeclared, 'declared 取原始长度（过滤前）').toBe(true);
      expect(restricted?.allowedUsers).toEqual([]);
      expect(restricted?.allowedDepartments).toEqual(['dept-other']);

      const warns = captured.slice(mark).filter(entry => entry.level === 'warn');
      expect(warns).toHaveLength(1);
      expect(warns[0].meta).toMatchObject({ reason: 'invalid_workspace_role', dropped: 1, degraded: true });

      // 第二次读取（= 下一次请求）⇒ 再出一条：证明没有模块级 Set 跨请求抑制
      store.listAuthorizations('org-a', 'manifest-golden');
      expect(captured.slice(mark).filter(entry => entry.level === 'warn')).toHaveLength(2);
    } finally { close(); }
  });

  it('合法新词表：declared=true 且清单保留；restricted 空清单 ⇒ declared=false', () => {
    const { store, close } = harnessWithRestricted();
    try {
      const authorizations = store.listAuthorizations('org-a', 'manifest-golden');
      const enterprise = authorizations.filter(item => item.visibility === 'enterprise');
      const restricted = authorizations.filter(item => item.visibility === 'restricted');
      expect(enterprise.length).toBeGreaterThan(0);
      expect(enterprise.every(item => item.allowedRolesDeclared && item.allowedRoles.length === 1 && item.allowedRoles[0] === 'staff')).toBe(true);
      expect(restricted).toHaveLength(1);
      expect(restricted[0].allowedRolesDeclared).toBe(false);
      expect(restricted[0].allowedRoles).toEqual([]);
    } finally { close(); }
  });

  it.each([
    ['非法 JSON', 'not-json'],
    ['非数组', JSON.stringify({ admin: true })],
    ['含非字符串元素', JSON.stringify(['staff', 1])],
  ])('%s ⇒ 整份来源清单不可见（fail-closed，禁用 ?? []）', async (_label, rawRoles) => {
    const { db, store, service, close } = harnessWithRestricted();
    try {
      db.prepare("UPDATE scan_authorizations SET allowed_roles_json = ? WHERE source_id LIKE '%operator-statement'").run(rawRoles);
      expect(store.listAuthorizations('org-a', 'manifest-golden')).toEqual([]);
      await expect(service.run({ sub: 'admin-a', role: 'admin', orgId: 'org-a', departmentIds: [] }, 'manifest-golden', `broken-${String(_label)}`))
        .rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    } finally { close(); }
  });
});
