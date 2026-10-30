/**
 * tests/routes/knowledge-ask.test.ts — 知识问答路由真实测试
 *
 * #1075 P2-4b-A（K12-11 权限项）: 本件新增**认证分支 grants 桥接**判据 J1–J4 ＋ J5-3（回滚开关）。
 *   既有 4 条 handler 用例（400 ／ 现金流 ／ 离职 ／ xyz123）**判据逐字未动** —— 它们同时是
 *   J2「匿名入口仍走两条 EQ」的回归面；响应新增 `authApplied` 为 **additive**（不破坏旧断言）。
 *
 * 🔴 夹具铁律（gate-A M2/N2 教训）:
 *   · 每个认证分支用例**开始前** `delete process.env.SYNOVA_GRANTS_BRIDGE` —— 防外部环境把
 *     桥接静默退回匿名分支（那样 J1 会假绿）。
 *   · 内容根一律 `mkdtemp` 临时根（**禁写仓内 `extensions/presets`**）；env 用完 `finally` 还原。
 *   · J3/J4 断言**字面值**，不写 `=== allowedSensitivitiesByGrants(同参)`（同义反复无牙）。
 *   · 🔴 handler 取不到 **必须红**：每个 handler 用例**先断言再调用**（取 handler 后先
 *     assert 其类型为 function，再 `await` 调用）；禁"取不到就 return"的静默早退
 *     （那会让用例**什么都没断言**地假绿，K3 P1-⑤）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Router } from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveGrants } from '@synova/engine-auth';
import { buildKnowledgeAskFilter, type KnowledgeAskFilter } from '../../src/routes/knowledge-ask';

// ════════════════════════════════════════════════════════════════
// #1075 P2-4b-A 夹具（临时内容根 ＋ env 注入缝；禁写真仓）
// ════════════════════════════════════════════════════════════════

/** 本文件创建的临时根（afterAll 清理） */
const fixtureRoots: string[] = [];

/** 临时内容根（**不写仓内** —— 内容面写集不含 extensions/presets/**） */
function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'p24b-knowledge-ask-'));
  fixtureRoots.push(root);
  return root;
}

/** 写一个角色包（只含授权面 `permissionGrants` 段；同 permission-grants.test.ts 夹具手法） */
function writeRolePack(
  root: string,
  roleId: string,
  grants: readonly string[],
  denies: readonly string[] = [],
): string {
  const dir = join(root, 'roles', roleId);
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

/** 把夹具根接到**生产判定点**（`SYNOVA_PRESETS_ROOT` 是显式注入缝）；返回 restore，必须 finally 调用 */
function usePresetsRoot(root: string): () => void {
  const prev = process.env['SYNOVA_PRESETS_ROOT'];
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  return () => {
    if (prev === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
    else process.env['SYNOVA_PRESETS_ROOT'] = prev;
  };
}

/** 桥接开关 hermetic 前置: 清掉外部 env；返回 restore（用例结束还原） */
function clearBridgeSwitch(): () => void {
  const prev = process.env['SYNOVA_GRANTS_BRIDGE'];
  delete process.env['SYNOVA_GRANTS_BRIDGE'];
  return () => {
    if (prev === undefined) delete process.env['SYNOVA_GRANTS_BRIDGE'];
    else process.env['SYNOVA_GRANTS_BRIDGE'] = prev;
  };
}

/** 取某字段条件的 operator（找不到 ⇒ undefined，用例再断言，不靠非空断言掩盖） */
function conditionOperator(filter: KnowledgeAskFilter, field: string): string | undefined {
  return filter.conditions.find((c) => c.field === field)?.operator;
}

/** 取某字段条件的 value（找不到 ⇒ undefined） */
function conditionValue(filter: KnowledgeAskFilter, field: string): string | string[] | undefined {
  return filter.conditions.find((c) => c.field === field)?.value;
}

afterAll(() => {
  for (const root of fixtureRoots) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败不影响判据 */ }
  }
  fixtureRoots.length = 0;
});

describe('knowledge-ask route', () => {
  let router: Router;
  let getHandler: (req: any, res: any) => Promise<void> | void;

  beforeAll(async () => {
    const mod = await import('../../src/routes/knowledge-ask');
    router = mod.default;
    const routes = (router as any).stack || [];
    for (const s of routes) {
      if (s.route?.path === '/api/knowledge/ask' && s.route?.methods?.get) {
        getHandler = s.route.stack[0].handle;
      }
    }
  });

  it('模块导出Router', () => { expect(router).toBeDefined(); });

  it('GET ?q= 空 → 400', async () => {
    const h = getHandler;
    expect(h).toBeTypeOf('function');
    let status = 0; let body: any = null;
    const res = { status: (s: number) => { status = s; return { json: (b: any) => { body = b; } }; } };
    await h({ query: { q: '' } }, res);
    expect(status).toBe(400);
    expect(body.error).toContain('too short');
  });

  it('GET ?q=任意问题 → 200 + ok (PKB回退模板)', async () => {
    const h = getHandler;
    expect(h).toBeTypeOf('function');
    let body: any = null;
    const res = { json: (b: any) => { body = b; } };
    await h({ query: { q: '现金流' } }, res);
    expect(body.ok).toBe(true);
    expect(body.answer.length).toBeGreaterThan(20);
    // PKB为空时回退到模板——confidence为low是正确的
    expect(body.confidence).toBe('low');
  });

  it('GET ?q=离职 → 200 + 不含硬编码内容', async () => {
    const h = getHandler;
    expect(h).toBeTypeOf('function');
    let body: any = null;
    const res = { json: (b: any) => { body = b; } };
    await h({ query: { q: '离职' } }, res);
    expect(body.ok).toBe(true);
    // PKB检索——不再返回硬编码关键词匹配
    expect(body.confidence).toBe('low');
  });

  it('GET ?q=未知问题 → 200 + confidence=low', async () => {
    const h = getHandler;
    expect(h).toBeTypeOf('function');
    let body: any = null;
    const res = { json: (b: any) => { body = b; } };
    await h({ query: { q: 'xyz123' } }, res);
    expect(body.ok).toBe(true);
    expect(body.confidence).toBe('low');
  });

  // ══════════════════════════════════════════════════════════════
  // #1075 P2-4b-A（K12-11）判据 J1–J4 ＋ J5-3
  // ══════════════════════════════════════════════════════════════

  describe('J1 · 认证分支按 grants 收窄（access_level IN ＋ sensitivity 字面值）', () => {
    it('J1 admin＋denies ⇒ authApplied:true；access_level IN [public,team]；sensitivity 字面值 [normal,sensitive]', () => {
      const restoreSwitch = clearBridgeSwitch(); // 防外部 env 让认证分支静默退回匿名
      const root = makeFixtureRoot();
      writeRolePack(root, 'admin', [], ['knowledge.finance.read', 'knowledge.people.read']);
      const restoreRoot = usePresetsRoot(root);
      try {
        const filter = buildKnowledgeAskFilter({ role: 'admin', orgId: 'org-p24b-j1' });
        expect(filter.authApplied).toBe(true);
        // 顺序也是判据: access_level 在前，sensitivity 追加在后（D5）
        expect(filter.conditions).toHaveLength(2);
        expect(conditionOperator(filter, 'access_level')).toBe('IN');
        expect(conditionValue(filter, 'access_level')).toEqual(['public', 'team']);
        expect(conditionOperator(filter, 'access.sensitivity')).toBe('IN');
        // 🔴 字面值: restricted 被 denies 减掉（只有 role=admin 可达 2 级）
        expect(conditionValue(filter, 'access.sensitivity')).toEqual(['normal', 'sensitive']);
      } finally {
        restoreRoot();
        restoreSwitch();
      }
    });

    it('J1 反例 grants:[] 无 denies ⇒ admin 出厂全读 ⇒ 字面值三级（含 restricted）', () => {
      const restoreSwitch = clearBridgeSwitch();
      const root = makeFixtureRoot();
      writeRolePack(root, 'admin', []);
      const restoreRoot = usePresetsRoot(root);
      try {
        const filter = buildKnowledgeAskFilter({ role: 'admin', orgId: 'org-p24b-j1b' });
        expect(filter.authApplied).toBe(true);
        expect(conditionValue(filter, 'access.sensitivity')).toEqual(['normal', 'sensitive', 'restricted']);
      } finally {
        restoreRoot();
        restoreSwitch();
      }
    });
  });

  describe('J2 · 匿名分支逐字不变', () => {
    it('J2 无参 ⇒ authApplied:false ＋ conditions 深等于改前两条 EQ（public、team）', () => {
      const restoreSwitch = clearBridgeSwitch();
      try {
        const filter = buildKnowledgeAskFilter();
        expect(filter.authApplied).toBe(false);
        expect(filter.conditions).toEqual([
          { field: 'access_level', operator: 'EQ', value: 'public' },
          { field: 'access_level', operator: 'EQ', value: 'team' },
        ]);
      } finally {
        restoreSwitch();
      }
    });

    it('J2-b 匿名 handler 响应 additive authApplied === false（既有 4 条 handler 用例零改动）', async () => {
      const h = getHandler;
      expect(h).toBeTypeOf('function');
      const restoreSwitch = clearBridgeSwitch();
      try {
        let body: Record<string, unknown> | null = null;
        const res = { json: (b: Record<string, unknown>) => { body = b; } };
        await h({ query: { q: '现金流' } }, res);
        expect(body).not.toBeNull();
        expect(body?.ok).toBe(true);
        expect(body?.authApplied).toBe(false);
      } finally {
        restoreSwitch();
      }
    });
  });

  describe('J3 · 无包回落（hermetic 空临时根；断言字面值，不同义反复）', () => {
    it('J3 空根 ⇒ admin 字面值三级；employee 字面值 [normal]；两者 authApplied:true', () => {
      const restoreSwitch = clearBridgeSwitch();
      const root = makeFixtureRoot(); // 不落任何 roles/**
      const restoreRoot = usePresetsRoot(root);
      try {
        const admin = buildKnowledgeAskFilter({ role: 'admin', orgId: 'no-pack-org' });
        expect(admin.authApplied).toBe(true);
        expect(conditionValue(admin, 'access_level')).toEqual(['public', 'team']);
        expect(conditionValue(admin, 'access.sensitivity')).toEqual(['normal', 'sensitive', 'restricted']);

        const employee = buildKnowledgeAskFilter({ role: 'employee', orgId: 'no-pack-org' });
        expect(employee.authApplied).toBe(true);
        // 非 admin 档位上限 = normal（ByGrants 交集恒 [normal]）
        expect(conditionValue(employee, 'access.sensitivity')).toEqual(['normal']);
      } finally {
        restoreRoot();
        restoreSwitch();
      }
    });
  });

  describe('J4 · 降级不放宽（用 degraded 标志判，不靠输出等同）', () => {
    it('J4 同根坏 YAML ⇒ resolveGrants(...).degraded===true 且 filter 仍字面值三级', () => {
      const restoreSwitch = clearBridgeSwitch();
      const root = makeFixtureRoot();
      const dir = join(root, 'roles', 'admin');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'capabilities.yaml'), 'roleId: admin\nversion: 1.0.0\npermissionGrants: [unclosed\n', 'utf8');
      // 🔴 同一临时根须经 SYNOVA_PRESETS_ROOT 注入 —— buildKnowledgeAskFilter 只读 env，
      //    resolveGrants 的 {root} 与它是两条入口（gate-A R2）。
      const restoreRoot = usePresetsRoot(root);
      try {
        const resolved = resolveGrants('admin', { root });
        expect(resolved.degraded).toBe(true);
        expect(resolved.degradedReasons.length).toBeGreaterThan(0);

        const filter = buildKnowledgeAskFilter({ role: 'admin', orgId: 'org-p24b-j4' });
        expect(filter.authApplied).toBe(true);
        // 出厂交集（含 restricted）—— 降级不得放宽，也不得收窄
        expect(conditionValue(filter, 'access.sensitivity')).toEqual(['normal', 'sensitive', 'restricted']);
      } finally {
        restoreRoot();
        restoreSwitch();
      }
    });
  });

  describe('J5-3 · 回滚开关 SYNOVA_GRANTS_BRIDGE=off（D8 的可测化）', () => {
    it('off ⇒ 匿名两条 EQ＋authApplied:false；删除开关后无需重启即复绿', () => {
      const restoreSwitch = clearBridgeSwitch();
      const root = makeFixtureRoot();
      writeRolePack(root, 'admin', [], ['knowledge.finance.read', 'knowledge.people.read']);
      const restoreRoot = usePresetsRoot(root);
      try {
        process.env['SYNOVA_GRANTS_BRIDGE'] = 'off';
        const off = buildKnowledgeAskFilter({ role: 'admin', orgId: 'org-p24b-j5' });
        expect(off.authApplied).toBe(false);
        expect(off.conditions).toEqual([
          { field: 'access_level', operator: 'EQ', value: 'public' },
          { field: 'access_level', operator: 'EQ', value: 'team' },
        ]);

        // 复绿: env 在**函数内**读取 ⇒ 删除开关即生效（无需重新 import / 重启）
        delete process.env['SYNOVA_GRANTS_BRIDGE'];
        const restored = buildKnowledgeAskFilter({ role: 'admin', orgId: 'org-p24b-j5' });
        expect(restored.authApplied).toBe(true);
        expect(conditionValue(restored, 'access.sensitivity')).toEqual(['normal', 'sensitive']);
      } finally {
        restoreRoot();
        restoreSwitch();
      }
    });
  });
});
