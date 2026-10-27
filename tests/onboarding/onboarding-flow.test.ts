/**
 * tests/onboarding/onboarding-flow.test.ts — K12-03 (#186) 建档通道配对测试（铁律 48）
 *
 * 覆盖三路径：
 *   正常：给了文档 + 六块齐的角色种子 + 超管确认 ⇒ 六步有序、配置包真落盘（2 角色 × 6 件）、
 *        留痕存在**且含 `pieces=12`**（#1075 P1-b）
 *   降级：零文档 / 无角色种子 / roleId 非法 / **seed 缺项 ⇒ rejected 透传不被吞** ⇒ degraded +
 *        errors 点名，**不抛**
 *   边界：dry-run **绝不落盘**（判据 V1）；未确认 ⇒ 不部署；fail-closed 权限交集；
 *         路径穿越 roleId 被拒；只读路由表**无 GET 表单页**（判据 V3）
 *
 * 🔴 隔离：一切写入都落 `mkdtempSync(tmpdir())` 夹具，**不碰**仓库真实内容面/`.synova`。
 * 🔴 #1075 P1-b 夹具纪律：seed 必须六块齐（knowledgeScope/capabilities/acceptanceCriteria/
 *   contexts/systemAddendum/outputTemplate）；`contexts[].source` 只许 scope（本包 knowledge-scope
 *   带锚）＋ `profile.business-plan` —— 临时根没有 `extensions/ontology/**`，file ref 必悬空。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runOnboardingFlow, ONBOARDING_STEPS } from '../../src/onboarding/onboarding-flow';
import { generateConfigPack, type RoleSeed } from '../../src/onboarding/config-pack-generator';
import { EXPECTED_PIECES } from '../../src/init/preset-loader';
import onboardingRouter from '../../src/routes/onboarding';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'onboarding-flow-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 六块齐的岗位种子（ASCII 串 ⇒ slug 非空；contexts 只 scope＋profile） */
function roleSeed(roleId: string, scopeId: string, capability: string): RoleSeed {
  return {
    roleId,
    knowledgeScope: [scopeId],
    capabilities: [capability],
    acceptanceCriteria: ['c1'],
    contexts: [
      {
        id: `${scopeId}-ref`,
        label: `${scopeId} 口径`,
        source: `extensions/presets/roles/${roleId}/knowledge-scope.yaml#${scopeId}`,
      },
      { id: 'company.bp', label: '公司业务说明', source: 'profile.business-plan' },
    ],
    systemAddendum: `${roleId} 岗：结论必须标明口径来源。`,
    outputTemplate: {
      templateId: `${roleId}.standard`,
      sections: [{ id: 'headline', title: '一句话结论', must: ['结论'] }],
    },
  };
}

/** 2 角色 × 6 件 = 12（断言用同一算式，防写死漂移） */
const ROLES: readonly RoleSeed[] = [roleSeed('finance', 'finance.reports', 'budget-review'), roleSeed('sales', 'sales.pipeline', 'forecast')];
const TWO_ROLE_PIECES = ROLES.length * EXPECTED_PIECES.length;

describe('建档六步 — 正常路径', () => {
  it('六步**有序**且逐段可观测（每步有 name/status/detail）', () => {
    const report = runOnboardingFlow({ documents: ['roster.md'], roles: ROLES, rootDir: root });
    expect(report.steps.map((s) => s.name)).toEqual([...ONBOARDING_STEPS]);
    expect(report.steps.every((s) => s.detail.length > 0)).toBe(true);
  });

  it('给了文档 + 六块齐的角色种子 ⇒ config-pack 步为 ok（2 角色 × 6 件 = 12）', () => {
    const report = runOnboardingFlow({ documents: ['roster.md', 'orgchart.md'], roles: ROLES, rootDir: root });
    const packStep = report.steps.find((s) => s.name === 'config-pack');
    expect(packStep?.status).toBe('ok');
    expect(TWO_ROLE_PIECES).toBe(12);
    expect(packStep?.detail).toContain(String(TWO_ROLE_PIECES)); // 12 件
  });

  it('超管确认 ⇒ 物理留痕真落盘（判据 V4）且含 pieces=12（#1075 P1-b）', () => {
    const report = runOnboardingFlow({
      documents: ['roster.md'],
      roles: ROLES,
      rootDir: root,
      superAdminConfirmed: true,
    });
    expect(report.auditTrail.length).toBe(1);
    const audit = join(root, '.synova', 'onboarding-audit.log');
    expect(existsSync(audit)).toBe(true);
    const body = readFileSync(audit, 'utf8');
    expect(body).toContain('SUPER_ADMIN_CONFIRMED');
    expect(body).toContain(`pieces=${String(TWO_ROLE_PIECES)}`);
    expect(body).toContain('granted=');
  });

  it('配置包真落盘到 extensions/presets/roles/{id}/（判据 V2 的形状；六件）', () => {
    const report = runOnboardingFlow({
      documents: ['roster.md'],
      roles: ROLES,
      rootDir: root,
      superAdminConfirmed: true,
    });
    const written = report.configPack?.written ?? [];
    expect(written.length).toBe(TWO_ROLE_PIECES);
    expect(written).toContain(join('extensions/presets/roles/finance', 'knowledge-scope.yaml'));
    expect(written).toContain(join('extensions/presets/roles/finance', 'manifest.json'));
    expect(written).toContain(join('extensions/presets/roles/finance', 'context-manifest.yaml'));
    expect(written).toContain(join('extensions/presets/roles/finance', 'output-template.ref'));
    expect(written).toContain(join('extensions/presets/roles/sales', 'capabilities.yaml'));
  });
});

describe('建档六步 — 降级路径', () => {
  it('零文档 ⇒ intake degraded + 不抛', () => {
    const report = runOnboardingFlow({ documents: [], roles: ROLES, rootDir: root });
    expect(report.steps.find((s) => s.name === 'intake')?.status).toBe('degraded');
    expect(report.degraded).toBe(true);
  });

  it('无角色种子 ⇒ ontology-align degraded，且不写任何文件', () => {
    const report = runOnboardingFlow({ documents: ['roster.md'], rootDir: root, superAdminConfirmed: true });
    expect(report.steps.find((s) => s.name === 'ontology-align')?.status).toBe('degraded');
    expect(report.configPack?.written).toEqual([]);
  });

  it('roleId 非法（路径穿越）⇒ 跳过 + errors 点名，**不抛**；合法角色照写 6 件', () => {
    const report = runOnboardingFlow({
      documents: ['roster.md'],
      roles: [{ roleId: '../evil' }, roleSeed('ok-role', 'ok.scope', 'ok-cap')],
      rootDir: root,
      superAdminConfirmed: true,
    });
    expect(report.configPack?.skipped.join(' ')).toContain('../evil');
    expect(report.errors.join(' ')).toContain('roleId 非法');
    // 合法那个仍写（单角色 = 6 件）
    expect(report.configPack?.written.length).toBe(EXPECTED_PIECES.length);
    expect(report.configPack?.written.join(' ')).toContain('ok-role');
    // 穿越目标**未**被创建
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  it('#1075 P1-b 缺项透传：seed 缺块 ⇒ configPack.rejected 点名且 errors 不被吞（零写入）', () => {
    const report = runOnboardingFlow({
      documents: ['roster.md'],
      roles: [roleSeed('finance', 'finance.reports', 'budget-review')],
      rootDir: root,
      superAdminConfirmed: true,
    });
    // 上面是完整 seed（本用例防夹具回归）；下面才造缺项
    expect(report.configPack?.rejected).toEqual([]);

    const incomplete: RoleSeed = { roleId: 'hr', knowledgeScope: ['hr.policy'], capabilities: ['x'] };
    const rejectedReport = runOnboardingFlow({
      documents: ['roster.md'],
      roles: [incomplete],
      rootDir: root,
      superAdminConfirmed: true,
    });
    expect(rejectedReport.configPack?.rejected.length).toBe(1);
    expect(rejectedReport.configPack?.rejected[0]?.code).toBe('ROLE_SEED_INCOMPLETE');
    expect(rejectedReport.configPack?.rejected[0]?.missingParams).toContain('contexts');
    expect(rejectedReport.configPack?.written).toEqual([]);
    expect(rejectedReport.errors.join(' ')).toContain('ROLE_SEED_INCOMPLETE');
    expect(rejectedReport.degraded).toBe(true);
    expect(existsSync(join(root, 'extensions/presets/roles/hr'))).toBe(false);
  });
});

describe('建档六步 — 边界', () => {
  it('🔴 dry-run **绝不落盘**（判据 V1）+ 报 planned（2 角色 × 6 = 12）', () => {
    const report = runOnboardingFlow({ documents: ['roster.md'], roles: ROLES, rootDir: root, dryRun: true });
    expect(report.configPack?.written).toEqual([]);
    expect((report.configPack?.planned ?? []).length).toBe(TWO_ROLE_PIECES);
    expect(existsSync(join(root, 'extensions'))).toBe(false);
  });

  it('未超管确认 ⇒ confirm 步 skipped 且 deploy 步 skipped（fail-closed，不自动确认）', () => {
    const report = runOnboardingFlow({ documents: ['roster.md'], roles: ROLES, rootDir: root, dryRun: true });
    expect(report.steps.find((s) => s.name === 'super-admin-confirm')?.status).toBe('skipped');
    expect(report.steps.find((s) => s.name === 'deploy')?.status).toBe('skipped');
  });

  it('🔴 权限 fail-closed：请求了但文档没写 ⇒ **不给**；文档写了且请求了 ⇒ 才给', () => {
    const report = runOnboardingFlow({
      documents: ['roster.md'],
      roles: ROLES,
      rootDir: root,
      requestedPermissions: ['view.finance', 'admin.all'],
      documentedPermissions: ['view.finance'],
    });
    expect(report.grantedPermissions).toEqual(['view.finance']);
    expect(report.grantedPermissions).not.toContain('admin.all');
  });

  it('文档侧权限为空 ⇒ 实授为空（默认不给）', () => {
    const report = runOnboardingFlow({
      documents: ['roster.md'],
      roles: ROLES,
      rootDir: root,
      requestedPermissions: ['view.finance'],
    });
    expect(report.grantedPermissions).toEqual([]);
  });

  it('generateConfigPack 空角色 ⇒ 零写入、非 degraded', () => {
    const r = generateConfigPack({ roles: [], rootDir: root });
    expect(r.written).toEqual([]);
    expect(r.degraded).toBe(false);
  });

  it('🔴 判据 V3「零表单」：router 栈只允许一条只读 GET（/steps），无表单页', () => {
    const stack = (onboardingRouter as unknown as { stack?: { route?: { path?: string; methods?: Record<string, boolean> } }[] }).stack ?? [];
    const routes = stack
      .map((l) => l.route)
      .filter((r): r is { path: string; methods: Record<string, boolean> } => r !== undefined && typeof r.path === 'string')
      .map((r) => ({ path: r.path, method: Object.keys(r.methods ?? {}).find((m) => r.methods[m] === true) ?? '?' }));
    const gets = routes.filter((r) => r.method === 'get').map((r) => r.path);
    expect(gets).toEqual(['/api/onboarding/steps']);
    const posts = routes.filter((r) => r.method === 'post').map((r) => r.path);
    // 首条 POST 必须是判据探针驱动的入口
    expect(posts[0]).toBe('/api/onboarding/start');
  });

  it('六步清单常量非空且唯一', () => {
    expect(ONBOARDING_STEPS.length).toBe(6);
    expect(new Set(ONBOARDING_STEPS).size).toBe(6);
  });
});
