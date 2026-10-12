/**
 * tests/security/permission-grants.test.ts — K12-11 (#194 / RB-03) 权限**项**模型判据
 *
 * 主题: 权限是「**一项一项勾**」（能看到什么 / 能做什么），**不是"五档套餐"**。
 *   五档 = **出厂默认（L0）**；客户可配包 = **L2**；**覆盖不是替换**（宪章 5.2）。
 *   档位制太粗 ⇒ 客户只好"给高一级" ⇒ **权限只会越来越松**（创始人 2026-10-05 原话场景）。
 *
 * 本件覆盖两面（缺一即"接线了但没被执行"）:
 *   ① 模型面（`packages/engine-auth/src/permission-grants.ts`）—— 按项授予 / 分层合成 / 回落
 *   ② **生产接线面**（`src/middleware/auth.ts` 的授权判定点）—— 真 `jwtAuthMiddleware`
 *      ＋ 真 `runWithContext` ＋ 真 provider 取 FilterClause，断言客户配包**确实改变了**产出
 *
 * 🔴 反例（改坏即红）: 把判定点退回**纯档位**（`allowedSensitivities(payload.role, ...)`，
 *   不看项）⇒ 客户包里的 `grants/denies` 不再生效 ⇒ 本件「同岗位名、两客户、权限集合不同」
 *   与「包内 denies 真生效」两组**必红**。带门控的显式反例见文件末
 *   `SYNOVA_MUTATION_FORCE_ITEM_MODEL_OFF=1`。
 *
 * 铁律 48: 每条用例均有 expect 断言；覆盖正常路径 / 回落路径 / 降级路径 / 边界。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Request, Response } from 'express';
import {
  PERMISSION_CATALOG,
  resolveGrants,
  permissionsForRole,
  hasPermission,
  isPermissionId,
  sensitivityWhitelistFromGrants,
  expandPermissionId,
  factoryPermissionsForRole,
} from '@synova/engine-auth';
import {
  jwtAuthMiddleware,
  signJwtToken,
  allowedSensitivities,
  allowedSensitivitiesByGrants,
} from '../../src/middleware/auth';
import { getCurrentAuthProvider, getCurrentUser } from '../../src/services/request-context';
import type { FilterClause } from '../../src/l4/knowledge-store';

// ════════════════════════════════════════════════════════════════
// 夹具
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'k12-11-permission-grants-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
});

/** 夹具内容根（临时目录；**不写仓内** —— 内容面写集只含三个真角色包） */
function makeFixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), 'k12-11-grants-'));
}
/** 写一个角色包（只有 `permissionGrants` 段 —— 本卡只关心授权面） */
function writeRolePack(
  root: string,
  roleId: string,
  grants: readonly string[],
  denies: readonly string[] = [],
  /** 额外写进 `permissionGrants` 段的键（如 `inherits`）—— 段外键不参与解析 */
  extra: Record<string, string> = {},
): string {
  const dir = join(root, 'roles', roleId);
  mkdirSync(dir, { recursive: true });
  const lines = ['roleId: ' + roleId, 'version: 1.0.0', 'permissionGrants:'];
  lines.push('  grants:');
  for (const g of grants) lines.push(`    - ${g}`);
  if (denies.length > 0) {
    lines.push('  denies:');
    for (const d of denies) lines.push(`    - ${d}`);
  }
  for (const [k, v] of Object.entries(extra)) lines.push(`  ${k}: ${v}`);
  const abs = join(dir, 'capabilities.yaml');
  writeFileSync(abs, lines.join('\n') + '\n', 'utf8');
  return abs;
}

/** 写一个**客户槽**角色包（`roles/<roleId>/tenant/<tenantId>/capabilities.yaml`） */
function writeTenantPack(
  root: string,
  roleId: string,
  tenantId: string,
  grants: readonly string[],
  denies: readonly string[] = [],
): string {
  const dir = join(root, 'roles', roleId, 'tenant', tenantId);
  mkdirSync(dir, { recursive: true });
  const lines = ['roleId: ' + roleId, 'version: 1.0.0', 'permissionGrants:', '  grants:'];
  for (const g of grants) lines.push(`    - ${g}`);
  if (denies.length > 0) {
    lines.push('  denies:');
    for (const d of denies) lines.push(`    - ${d}`);
  }
  const abs = join(dir, 'capabilities.yaml');
  writeFileSync(abs, lines.join('\n') + '\n', 'utf8');
  return abs;
}

function mockRes(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
  res.status = (code: number) => { res.statusCode = code; return res as unknown as Response; };
  res.json = (body: unknown) => { res.body = body; return res as unknown as Response; };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

/** 走**真**中间件链取回漏斗产出（同 D947/P2 夹具的观测面） */
async function runMiddlewareAndCaptureFilter(role: string, orgId = 'org-1'): Promise<FilterClause> {
  const token = signJwtToken({ sub: `u-${role}`, role, orgId });
  expect(token).toBeTruthy();
  const req: Record<string, unknown> & { path: string; headers: Record<string, string> } = {
    path: '/api/knowledge/search',
    headers: { authorization: `Bearer ${token}` },
  };
  const res = mockRes();
  return new Promise<FilterClause>((resolve, reject) => {
    jwtAuthMiddleware(req as unknown as Request, res as unknown as Response, () => {
      const provider = getCurrentAuthProvider();
      const user = getCurrentUser();
      if (!provider || !user) {
        reject(new Error('request-context 未建立：runWithContext 未生效'));
        return;
      }
      provider
        .getPermissionFilter(user, 'KnowledgeChunk', 'read')
        .then((f) => resolve(f as unknown as FilterClause))
        .catch(reject);
    });
  });
}

/** 取 FilterClause 里的敏感度白名单 */
function sensitivityOf(filter: FilterClause): unknown {
  return filter.conditions.find((c) => c.field === 'access.sensitivity')?.value;
}

let cleanupRoots: string[] = [];
afterAll(() => {
  for (const r of cleanupRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* 清理失败不影响判据 */ }
  }
  cleanupRoots = [];
});

/**
 * 把夹具内容根接到**生产判定点**（`SYNOVA_PRESETS_ROOT` 是显式注入缝，同 preset-loader 惯例）。
 * 返回 restore()，调用方**必须**在 finally 里还原 —— 否则污染同进程其它用例/探针。
 */
function useFixtureRootAsPresetsRoot(root: string): () => void {
  const prev = process.env['SYNOVA_PRESETS_ROOT'];
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  return () => {
    if (prev === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
    else process.env['SYNOVA_PRESETS_ROOT'] = prev;
  };
}

/**
 * 🔴 **判据 hermetic 化**（本件实测踩到）: 生产判定点读 `SYNOVA_PRESETS_ROOT`，
 * 未设时回落到**真实仓**的 `extensions/presets/**`。若不隔离，「出厂默认」用例就会被
 * **仓内内容面**（含并发会话正在写的客户槽）静默影响 ⇒ 判据随别人的改动忽红忽绿、不可复跑。
 *
 * 本夹具 = 全量出厂面（等价于"没有客户包命中"）：`admin` 包只写全库读项、不减任何项。
 * 返回 `{ root, restore }`；`restore` 必须在 finally 调用。
 */
function withFactoryOnlyRoot(): { root: string; restore: () => void } {
  const root = makeFixtureRoot();
  cleanupRoots.push(root);
  writeRolePack(root, 'admin', ['knowledge.*.read']);
  return { root, restore: useFixtureRootAsPresetsRoot(root) };
}

/**
 * 把**真仓** `extensions/presets/**` 与**夹具根**叠加（夹具优先，仓内容面兜底）。
 *
 * 用途: 既证明「真角色包在判定点上生效」，又不把判据绑死在某个并发会话可能改动的内容面上。
 * 优先级: `roles/<id>/tenant/<tenant>/capabilities.yaml`（夹具）→
 *        `roles/<id>/tenant/<tenant>/capabilities.yaml`（仓）→
 *        `roles/<id>/capabilities.yaml`（夹具）→ `roles/<id>/capabilities.yaml`（仓）→ 出厂默认。
 */
function layeredRoot(fixtureRoot: string): string {
  const base = makeFixtureRoot();
  const root = join(base, 'presets');
  const layers = join(root, 'roles');
  mkdirSync(layers, { recursive: true });
  // 仓内容面（真件）作为**低优先**层
  for (const entry of ['finance', 'hr', 'sales']) {
    const from = join(process.cwd(), 'extensions', 'presets', 'roles', entry);
    if (!existsSync(from)) continue;
    try { symlinkSync(from, join(layers, entry), 'dir'); } catch { /* 已存在则跳过 */ }
  }
  // 夹具包作为**高优先**层（同名直接覆盖）
  const fx = join(fixtureRoot, 'roles');
  if (existsSync(fx)) {
    for (const entry of readdirSync(fx)) {
      const target = join(layers, entry);
      try { rmSync(target, { recursive: true, force: true }); } catch { /* noop */ }
      symlinkSync(join(fx, entry), target, 'dir');
    }
  }
  return root;
}

// ════════════════════════════════════════════════════════════════
// 一、模型面: 项模型本身
// ════════════════════════════════════════════════════════════════

describe('K12-11 / 模型面 — 权限项（PermissionId）', () => {
  it('项模型是"一堆可选项"，不是"五档": 目录里没有任何档位名，只有项', () => {
    const ids = PERMISSION_CATALOG.map((i) => i.id);
    expect(ids.length).toBeGreaterThan(0);
    // 目录里不得出现档位名（档位只是出厂打包，不是类型）
    for (const tier of ['admin', 'manager', 'employee', 'viewer', 'external']) {
      expect(ids).not.toContain(tier);
    }
    // 每一项都是"资源.动作"形（knowledge.<scope>.read 等）
    for (const id of ids) {
      expect(id).toMatch(/^(knowledge\.[a-z*]+\.(read|write)|tool\.[a-z.]+|mcp\.[a-z.]+|admin\.[a-z.]+)$/);
    }
  });

  it('白名单校验: 拼错的项**不是**合法项（fail-closed）', () => {
    expect(isPermissionId('knowledge.finance.read')).toBe(true);
    expect(isPermissionId('knowledge.finance.reed')).toBe(false);
    expect(isPermissionId('admin')).toBe(false);
    expect(isPermissionId(123)).toBe(false);
  });

  it('通配展开: knowledge.*.read ⇒ 每个范围一条具体项', () => {
    const expanded = expandPermissionId('knowledge.*.read');
    expect(expanded.length).toBeGreaterThan(1);
    for (const e of expanded) expect(e).toMatch(/^knowledge\.[a-z]+\.read$/);
    expect(expanded).toContain('knowledge.finance.read');
  });

  it('V6 按项授予: 给自定义角色授**单项** ⇒ 仅该能力生效（不是整档放行）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    writeRolePack(root, 'finance-analyst', ['knowledge.hr.read']);

    const items = permissionsForRole('finance-analyst', { root });
    expect(items).toEqual(['knowledge.hr.read']);
    expect(hasPermission('knowledge.hr.read', items)).toBe(true);
    expect(hasPermission('knowledge.finance.read', items)).toBe(false);
    expect(hasPermission('knowledge.sales.read', items)).toBe(false);
    expect(hasPermission('knowledge.hr.write', items)).toBe(false);
    expect(hasPermission('tool.export.raw', items)).toBe(false);
  });

  it('V7 五档＝出厂默认: 角色包不存在 ⇒ **正常回落**（fallback，非降级、不报错）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    const r = resolveGrants('employee', { root });
    expect(r.fallback).toBe(true);
    expect(r.degraded).toBe(false);
    expect(r.packFile).toBeNull();
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.sources.packGrants).toEqual([]);
  });

  it('L2 覆盖不是替换: 包只**加项/减项**，出厂默认仍在（不整包重写）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    // manager 出厂含 knowledge.*.read 展开集；包只减一项
    writeRolePack(root, 'manager', [], ['knowledge.finance.read']);
    const items = permissionsForRole('manager', { root });
    expect(items).not.toContain('knowledge.finance.read');
    // 其余出厂项仍在 ⇒ 证明是"减项"而不是"整包替换成空"
    expect(items).toContain('knowledge.hr.read');
    expect(items).toContain('tool.analysis.invoke');
  });

  it('未知项: 不授予 + 记 reason（fail-closed，禁"认不出就放行"）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    writeRolePack(root, 'typo-role', ['knowledge.finance.reed']);
    const r = resolveGrants('typo-role', { root });
    expect(r.items).toEqual([]);            // 未授予
    expect(r.degraded).toBe(true);
    expect(r.degradedReasons.join(' ')).toContain('knowledge.finance.reed');
  });

  it('降级: 包解析失败 ⇒ degraded + 回落出厂默认（**不抛**）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    const dir = join(root, 'roles', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'capabilities.yaml'), 'permissionGrants: [unclosed\n', 'utf8');
    const r = resolveGrants('broken', { root });
    expect(r.degraded).toBe(true);
    expect(r.degradedReasons.length).toBeGreaterThan(0);
  });

  it('降级: 字段类型非法（grants 非数组）⇒ degraded，不静默当空', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    const dir = join(root, 'roles', 'bad-type');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'capabilities.yaml'), 'permissionGrants:\n  grants: knowledge.hr.read\n', 'utf8');
    const r = resolveGrants('bad-type', { root });
    expect(r.degraded).toBe(true);
    expect(r.degradedReasons.join(' ')).toMatch(/grants/);
  });

  it('V8 客户可配: **加文件即生效，不改代码**（新角色目录 ⇒ 立刻可解析）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    // 加文件之前: 该角色不存在 ⇒ 回落出厂（空项）
    expect(permissionsForRole('brand-new-role', { root })).toEqual([]);
    // 只加一个文件（零代码改动）
    const abs = writeRolePack(root, 'brand-new-role', ['knowledge.market.read', 'tool.analysis.invoke']);
    const items = permissionsForRole('brand-new-role', { root });
    expect(items).toEqual(['knowledge.market.read', 'tool.analysis.invoke']);
    expect(resolveGrants('brand-new-role', { root }).packFile).toBe(abs);
  });

  it('同一岗位名、两个客户 ⇒ **权限集合不同**（创始人原话场景）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    writeTenantPack(root, 'market-director', 'customer-a', ['knowledge.finance.read', 'knowledge.market.read']);
    writeTenantPack(root, 'market-director', 'customer-b', ['knowledge.market.read']);

    const a = permissionsForRole('market-director', { root, tenantId: 'customer-a' });
    const b = permissionsForRole('market-director', { root, tenantId: 'customer-b' });
    expect(a).toEqual(['knowledge.finance.read', 'knowledge.market.read']);
    expect(b).toEqual(['knowledge.market.read']);
    expect(a).not.toEqual(b);   // 同岗位名，不同客户 ⇒ 权限集合不同（档位制做不到）
  });

  it('继承: inherits 指名的父包项并入（目录名推导，无硬编码角色表）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    writeRolePack(root, 'base-role', ['knowledge.finance.read']);
    writeRolePack(root, 'derived-role', ['knowledge.sales.read'], [], { inherits: 'base-role' });
    const items = permissionsForRole('derived-role', { root });
    expect(items).toEqual(['knowledge.finance.read', 'knowledge.sales.read']);
  });

  it('边界: 无「读知识」项 ⇒ 项模型**不说话**（返回 null，交调用方回落）', () => {
    expect(sensitivityWhitelistFromGrants([])).toBeNull();
    expect(sensitivityWhitelistFromGrants(['tool.analysis.invoke'])).toBeNull();
    expect(sensitivityWhitelistFromGrants(['knowledge.finance.read'])).toEqual(['normal', 'sensitive']);
  });
});

// ════════════════════════════════════════════════════════════════
// 二、生产接线面: 真中间件 ⇒ 真 FilterClause
// ════════════════════════════════════════════════════════════════

describe('K12-11 / 接线面 — 项模型在授权判定点生效', () => {
  it('回归锁: 出厂档位行为**逐字不变**（staff/manager/liaison/ga/unknown ⇒ [normal]）', async () => {
    const { root, restore } = withFactoryOnlyRoot();
    try {
      for (const role of ['staff', 'manager', 'liaison', 'ga', 'unknown-role']) {
        const filter = await runMiddlewareAndCaptureFilter(role, 'org-nobody');
        expect({ role, root, value: sensitivityOf(filter) }).toEqual({ role, root, value: ['normal'] });
        expect(filter.conditions.length).toBeGreaterThan(0);
      }
    } finally {
      restore();
    }
  });

  it('回归锁: admin 白名单**逐字等于**档位派生值（项模型只收窄，永不越权放宽）', async () => {
    // 🔴 hermetic: 空夹具根 + 不存在的客户槽 ⇒ 只按**出厂默认**判定。
    //   （本件实测踩到: 不隔离时会读到真实仓 `roles/admin/tenant/**` 的客户包 —— 那是**并发会话**
    //     正在写的内容面，会让"出厂默认"用例随别人的改动忽红忽绿 ⇒ 判据不可复跑。）
    const { root, restore } = withFactoryOnlyRoot();
    try {
      const filter = await runMiddlewareAndCaptureFilter('admin', 'org-k12-11-absent');
      const expected = allowedSensitivitiesByGrants('admin', 'normal', 'org-k12-11-absent');
      // 出厂默认（admin 含 knowledge.*.read 全库）⇒ 交集 = 档位派生值本身
      expect(expected).toEqual(allowedSensitivities('admin', 'normal'));
      expect(sensitivityOf(filter)).toEqual(expected);
      expect(sensitivityOf(filter)).toEqual(['normal', 'sensitive', 'restricted']);
      // 且该客户槽确实没有自己的包（命中夹具里"全量出厂面"的岗位默认包 ⇒ 等价于没客户配置）
      expect(resolveGrants('admin', { tenantId: 'org-k12-11-absent', root }).fallback).toBe(false);
      expect(permissionsForRole('admin', { tenantId: 'org-k12-11-absent' }))
        .toContain('knowledge.finance.read');   // 夹具包未减任何项 ⇒ 出厂面完整
    } finally {
      restore();
    }
  });

  it('🔴 判别性 A: 客户包减项 ⇒ admin 白名单真被收窄（改坏回纯档位 ⇒ 本组红）', async () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    // admin 出厂含 knowledge.*.read（全库）⇒ 客户包减掉 finance + hr 两个范围
    writeRolePack(root, 'admin', [], ['knowledge.finance.read', 'knowledge.hr.read']);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      const filter = await runMiddlewareAndCaptureFilter('admin', 'org-single');
      expect(sensitivityOf(filter)).toEqual(['normal', 'sensitive']);
      // 纯档位实现恒返全三级 ⇒ 与项模型产出必然不同（判别性所在）
      expect(sensitivityOf(filter)).not.toEqual(allowedSensitivities('admin', 'normal'));
    } finally {
      restore();
    }
  });

  it('🔴 判别性 B: 客户包减掉**全部**读项 ⇒ 项面兜底最窄 [normal]（fail-closed，绝不放宽）', async () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    writeRolePack(root, 'admin', [],
      ['knowledge.finance.read', 'knowledge.hr.read', 'knowledge.sales.read',
       'knowledge.people.read', 'knowledge.market.read']);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      const filter = await runMiddlewareAndCaptureFilter('admin', 'org-none-read');
      expect(sensitivityOf(filter)).toEqual(['normal']);   // 收到最窄，而不是全三级
      expect(sensitivityOf(filter)).not.toContain('restricted');
      expect(sensitivityOf(filter)).not.toContain('sensitive');
    } finally {
      restore();
    }
  });

  it('🔴 判别性 C: **真角色包**（仓内 finance）被判定点真读 ⇒ 项与 denies 真在生效', async () => {
    // 🔴 本组读**真书**（仓内 `extensions/presets/roles/finance/capabilities.yaml`，非夹具）:
    //   root 显式指仓根，客户槽用不存在的 id ⇒ 判定只能来自 L0 出厂 + L2 内容面**真件**。
    const repoRoot = join(process.cwd(), 'extensions', 'presets');
    const org = 'k12-11-org-not-present';
    const resolved = resolveGrants('finance', { tenantId: org, root: repoRoot });
    expect(resolved.packFile).toBeTruthy();                       // 命中的是**岗位默认层**（真件）
    expect(resolved.packFile).toContain(join('roles', 'finance'));
    expect(resolved.fallback).toBe(false);
    // 真件真在生效: 它声明的项进了生效集、它声明的 denies 被减去
    expect(resolved.items).toContain('knowledge.finance.read');    // 真包 grants 项生效
    expect(resolved.sources.packDenies).toContain('knowledge.finance.write');
    expect(resolved.items).not.toContain('knowledge.finance.write');
    // 按项授予的**边界**: 真包只勾了"财务库读"这一项 ⇒ 别库读项**不因岗位而自动获得**
    expect(resolved.items).not.toContain('knowledge.hr.read');
    expect(resolved.items).not.toContain('knowledge.market.read');
    // 且未勾任何工具项 ⇒ 不整档放行
    expect(resolved.items).not.toContain('tool.export.raw');
    expect(resolved.items).not.toContain('tool.analysis.invoke');
  });

  it('V1 项模型在**真请求**上生效: 自定义角色 ⇒ 产出与项模型推导一致（含回落）', async () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    const role = 'k12-11-custom-role';
    writeRolePack(root, role, ['knowledge.hr.read']);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      const filter = await runMiddlewareAndCaptureFilter(role);
      // 真请求产出 = 项模型推导值（不是档位回声）
      expect(sensitivityOf(filter)).toEqual(allowedSensitivitiesByGrants(role, 'normal'));
      expect(filter.conditions.length).toBeGreaterThan(0);

      // 对照组: 该角色**没有**别的项 ⇒ 真请求产出不含 restricted（按项收窄）
      expect(sensitivityOf(filter)).not.toContain('restricted');
    } finally {
      restore();
    }
  });

  it('🔴 判别性: 客户包内 denies 真的改变**真请求**产出（改坏回纯档位 ⇒ 本组红）', async () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    // admin 出厂含 knowledge.*.read（覆盖 restricted）；客户包减掉 finance 读项 ⇒ 项面收窄
    writeRolePack(root, 'admin', [], ['knowledge.finance.read']);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      const filter = await runMiddlewareAndCaptureFilter('admin');
      expect(sensitivityOf(filter)).toEqual(['normal', 'sensitive']);
      // 纯档位实现恒返全三级 ⇒ 与项模型产出**必然不同**（这就是判别性）
      expect(sensitivityOf(filter)).not.toEqual(allowedSensitivities('admin', 'normal'));
    } finally {
      restore();
    }
  });

  it('客户槽隔离: 同一岗位名、不同客户 ⇒ 授权集合不同（同一份出厂默认，真读客户槽包）', () => {
    // 🔴 用 layeredRoot（专用 base 层：仓内容面只经 symlink 进入，**没有** `roles/admin`）
    //   ⇒ 判据不会被并发会话写进 `roles/admin/**` 的内容影响。
    const fixture = makeFixtureRoot(); cleanupRoots.push(fixture);
    writeTenantPack(fixture, 'admin', 'org-1', [], ['knowledge.finance.read']);           // 客户 A: 只减 finance 读
    writeTenantPack(fixture, 'admin', 'org-2', [],
      ['knowledge.finance.read', 'knowledge.market.read', 'tool.export.raw']);            // 客户 B: 另减 market 读 + 工具项
    // 🔴 叠加顺序: 先写夹具、再 overlay ⇒ 夹具的 `roles/admin` 独占，仓内并发写入影响不到本判据
    const root = layeredRoot(fixture); cleanupRoots.push(root);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      const a = permissionsForRole('admin', { tenantId: 'org-1' });
      const b = permissionsForRole('admin', { tenantId: 'org-2' });
      const factory = factoryPermissionsForRole('admin');   // L0 出厂基线（不读磁盘）

      // 同一岗位名、同一份出厂默认 ⇒ 两个客户**授权集合不同**
      expect(a).not.toEqual(b);
      // A 只减 finance 读 ⇒ 其余出厂项**逐项保留**（按项，不整档）
      expect(a).toEqual(factory.filter((i) => i !== 'knowledge.finance.read'));
      expect(a).toContain('knowledge.finance.write');      // 同库**写**项不受牵连
      expect(a).toContain('knowledge.hr.read');
      expect(a).toContain('knowledge.market.read');
      expect(a).toContain('tool.export.raw');
      // B 另减 market 读 + 工具项 ⇒ 与 A 的集合不同（同岗位名、不同客户）
      expect(b).toEqual(factory.filter((i) =>
        i !== 'knowledge.finance.read' && i !== 'knowledge.market.read' && i !== 'tool.export.raw'));
      expect(b).toContain('knowledge.hr.read');
      expect(b).not.toContain('tool.export.raw');
      expect(a.length - b.length).toBe(2);                 // 差异 = market.read + export.raw
      // 两者都是"出厂默认的子集"（覆盖不是替换 ⇒ 出厂项仍在，只是被减）
      for (const item of a) expect(factory).toContain(item);
      for (const item of b) expect(factory).toContain(item);
      expect(a.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('fail-closed: 项被减 ⇒ 白名单 ⊆ 档位派生值（只收窄，永不放宽）', () => {
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    // 减掉一个**知识范围**的读项（这是白名单的输入）＋ 一个工具项（不影响白名单）
    writeRolePack(root, 'admin', [], ['knowledge.finance.read', 'tool.export.raw']);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      const items = permissionsForRole('admin', { tenantId: 'org-1' });
      expect(items).not.toContain('knowledge.finance.read');   // 范围读项被减
      expect(items).toContain('knowledge.finance.write');      // 同库写项不受牵连（按项）
      expect(items).not.toContain('tool.export.raw');          // 工具项被减
      // 交集只收窄: 白名单 ⊆ 档位派生值；且范围被减 ⇒ 不再覆盖全库
      const tier = allowedSensitivities('admin', 'restricted');
      const w = allowedSensitivitiesByGrants('admin', 'restricted', 'org-1');
      expect(w.every((l) => tier.includes(l))).toBe(true);
      expect(w).toEqual(['normal', 'sensitive']);
    } finally {
      restore();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 三、V4 反例（门控）: 退回档位制 ⇒ 本件必红
// ════════════════════════════════════════════════════════════════

/**
 * 🔴 门控反例（**自证伪**）—— **默认不跑**（默认全绿是 V2 的硬要求）。
 *
 * 一条命令，无需手改任何文件:
 *   `SYNOVA_MUTATION_FORCE_ITEM_MODEL_OFF=1 npx vitest run tests/security/permission-grants.test.ts`
 *   ⇒ 本组 2 条**必红**（它们断言"项模型生效"，而本组自己把项模型关掉了）。
 *
 * 语义: 本组**自己模拟"项模型不存在"**（`vi.doMock` 把 `permissionsForRole` 打成 `[]`、
 *   `itemModelSpeaksForRole` 打成 false ⇒ 等价于判定点退回**纯档位**），然后断言
 *   「本文件其它用例赖以成立的判别性结论」**不再成立** ⇒ 证明那些断言**有牙**（不是永远绿）。
 *
 * 🔴 为什么从"手改真件"改成"自证伪"（reviewer-b 2026-10-12 复核意见，lead 裁 Z=做）:
 *   旧写法要人手改 `src/middleware/auth.ts` 再记得改回来 ⇒ 判据的**可执行性与它的名字不符**
 *   （flag 单独打开**不可能变红** = 不能自证伪）。现改为一条命令 ⇒ **可进 CI、可被后人复跑**。
 *   （手改真件的等价实测仍留在交付回执 V4 证据里，两者互为交叉验证。）
 */
const FORCE_MUTATION = process.env['SYNOVA_MUTATION_FORCE_ITEM_MODEL_OFF'] === '1';

/**
 * 把项模型**模拟关掉**（等价于判定点退回纯档位），返回**重新加载**的 auth 模块。
 * 必须 `resetModules()` + `doMock()` + **动态 import** —— 否则拿到的是缓存里已绑好真模型的模块
 * （那样 mock 不生效 ⇒ 本组会"假绿"；若实测如此，本组会**显式报红并说明**，见下）。
 */
async function importAuthWithItemModelOff(): Promise<{
  allowedSensitivitiesByGrants: (role: string, clearance: string, tenantId?: string | null) => string[];
}> {
  vi.resetModules();
  vi.doMock('@synova/engine-auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@synova/engine-auth')>();
    return {
      ...actual,
      // 「模型不存在」: 无任何项 + 模型不为该角色发声 ⇒ 判定点只能回落档位默认
      permissionsForRole: () => [] as string[],
      itemModelSpeaksForRole: () => false,
    };
  });
  const mod = await import('../../src/middleware/auth');
  return { allowedSensitivitiesByGrants: mod.allowedSensitivitiesByGrants };
}

/** 撤销 mock（避免污染同进程其它用例） */
function undoItemModelMock(): void {
  vi.doUnmock('@synova/engine-auth');
  vi.resetModules();
}

describe.skipIf(!FORCE_MUTATION)('K12-11 / V4 反例（门控·自证伪）: 项模型关掉 ⇒ 本文件判别性结论必红', () => {
  afterAll(() => {
    undoItemModelMock();
  });

  it('前提自证（对照组，必过）: 真模型 + 同夹具 ⇒ 确实收窄为两级', () => {
    // 对照组走**真**模块（顶层的原引用，未被 mock 影响），且必须自带夹具
    //   —— 否则会去读真实仓的内容面（并发会话可改）⇒ 判据不自洽（本件已踩过这个坑）
    const root = makeFixtureRoot(); cleanupRoots.push(root);
    writeRolePack(root, 'admin', [], ['knowledge.finance.read', 'knowledge.hr.read']);
    const restore = useFixtureRootAsPresetsRoot(root);
    try {
      expect(allowedSensitivitiesByGrants('admin', 'normal', 'org-1'))
        .toEqual(['normal', 'sensitive']);
    } finally {
      restore();
    }
  });

  it('🔴 模型关掉 ⇒ 该收窄消失（本组必红 = 断言有牙）', async () => {
    const { allowedSensitivitiesByGrants: withModelOff } = await importAuthWithItemModelOff();
    const produced = withModelOff('admin', 'normal', 'org-1');
    // 🔴 这一行**注定失败**：模型关掉后只能回落档位默认（全三级），
    //    而本文件其它用例一致断言"收窄为两级" ⇒ 反证那些断言不是永远绿。
    expect(produced, '模型关掉后仍收窄 ⇒ 说明本文件的判别性断言是假的（永远绿）').toEqual(['normal', 'sensitive']);
  });

  it('🔴 模型关掉 ⇒ 「减干净读项 ⇒ 最窄」也消失（本组必红）', async () => {
    const { allowedSensitivitiesByGrants: withModelOff } = await importAuthWithItemModelOff();
    // 模型关掉后读不出"读项被减干净"这件事 ⇒ 回落全三级
    expect(withModelOff('admin', 'normal', 'org-1')).toEqual(['normal']);
  });

  it('自检: mock 必须**真的**生效（否则本组是"永远绿"的假反例）', async () => {
    const { allowedSensitivitiesByGrants: withModelOff } = await importAuthWithItemModelOff();
    // 生效判据: 模型关掉后产出 = 纯档位派生值（全三级）。若 mock 未生效 ⇒ 这里会红 ⇒ 如实暴露
    expect(withModelOff('admin', 'normal', 'org-1')).toEqual(['normal', 'sensitive', 'restricted']);
  });
});
