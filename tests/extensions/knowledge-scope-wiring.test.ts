/**
 * tests/extensions/knowledge-scope-wiring.test.ts — #731 生产消费链**卡级判据**（卡 `task-4` / PR2）
 *
 * 判据来源（不是转述）:
 *   · 卡 `task-4` ①–④（结构 / 行为 / 可对账 / deny 两段式）
 *   · dev doc `.handbook/派单件/2026-10-27-devdoc-825-M7生产消费链接线.md`
 *     §2.1（T1/T2/T3 目标链）／§2.5（d-kb / d-perm / d-v4 / d-refresh / d-deny）／§4.1（#731 行）
 *   · 规格 `.handbook/派单件/2026-10-27-规格-825-M7前置缺口补齐.md` §2.1／§4.0
 *
 * 🔴 本件要杀的病: **declared-only** —— 数据面早在树（三件岗位 `knowledge-scope.yaml`）、
 *   D5 探针绿过，但**生产链不读它**（内容读者 = 0）。所以本件的断言对象**全部是生产链**：
 *
 *     真内容文件 → `src/init/preset-loader.ts` 的 `resolveRoleKnowledgeScope()`（T1 解析）
 *       → `src/middleware/auth.ts` 内联 provider 的 `conditions`（T3，**追加** scope 维）
 *       → `getCurrentFilterClause('KnowledgeChunk')`（路由真实入口）
 *       → `KnowledgeStore.search()` → `matchFilter`（真过滤引擎）
 *
 *   没有任何一处断言是"读源码"/"断言常量"。
 *
 * 退出/降级面（三态，逐条有用例）:
 *   · **正常**：文件在且内容可用 ⇒ 条件集 = sensitivity(第 0 位) ＋ scope IN ＋ N 条 deny NOT_EQ
 *   · **降级（fail-closed）**：文件在但 `scopes[]` 为空 ⇒ 条件集退化为 `{pkb_domain IN []}`
 *     （对每一行恒 false）⇒ **一行都看不到**，**绝不回落"不过滤"**
 *   · **反例（改坏必红）**：拔岗位 scope 文件 ⇒ scope 维整维消失、跨岗位隔离消失 ⇒ 本件必红；
 *     把 deny 的 id 同时写进 scopes（重叠样本）⇒ 排除**只能**来自 deny（防恒真断言）
 *
 * 设计哲学（一句）: **判据只观测生产链已经做过的事** —— 本件不生产条件、不替 store 过滤，
 *   只把"生产链到底有没有读那份内容文件"变成可红的断言。
 *
 * Known Limitations（已知限制；禁写"暂无"）:
 *   KL-1 🔴 **生产写侧目前无法表达 scope**（本卡 I-C8 勘误）: `KnowledgeStore.insert()` 的 INSERT
 *        列清单**不含** `pkb_domain`，`update()` 的 UPDATE 列清单也**不含**该列
 *        （`src/l4/knowledge-store.ts:150` / `:279-296`），生产种子 `src/l3/pkb-seed.ts:266` 同被丢弃
 *        ⇒ 现物 `pkb_domain` **全 NULL**（规格 §3-E11：1621/1621）。故本件的播种口径 =
 *        `insert()` 走生产写 API（拿真 id/真行）＋ 对**临时库同一句柄**直写
 *        `UPDATE knowledge_chunks SET pkb_domain=? WHERE id=?`（**仅此一列、仅前置数据、不是断言对象**）。
 *        **不得**据此宣称"生产写入已按 scope 分类"。
 *   KL-2 🔴 **接线后的预期后果**: 因为 KL-1，`pkb_domain` 全 NULL ⇒ `IN` 对 NULL 恒 false ⇒
 *        **finance/hr/sales 对现存语料检索为空**。这是 fail-closed 的正确方向（不是 bug），
 *        数据回填另立卡。**无 scope 文件的岗位**（admin/manager/employee/viewer/liaison/ga/未知）
 *        按 I-C4 不追加 scope 维 ⇒ **不受影响**。
 *   KL-3 本件**不覆盖 HTTP 层**：真路由 `POST /api/knowledge/search` 的端到端由 D5 探针
 *        `scripts/control-tower/probe-knowledge-scope.ts`（V2/V3/V4）承担（卡 ⑦）。
 *   KL-4 语料是 dev 形态最小样本（每 scope 一条 ＋ 一条跨岗位同源），不度量检索质量。
 *   KL-5 `tests/middleware` 与 `tests/security` 里既有判据用 `@synova/engine-auth` 的
 *        编译期基线（`KNOWLEDGE_SCOPES` = yaml 背书集 `{finance, people, market}`）；
 *        本件只**新增**断言，不改它们的语义。
 *
 * 铁律 48：每条用例都有真断言（expect ＋ 匹配器，无空壳）；覆盖正常 / 降级 / 反例三路径。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import {
  getKnowledgeScopes,
  isPermissionId,
  resolveGrants,
} from '@synova/engine-auth';
import {
  jwtAuthMiddleware,
  knowledgeScopeDimensionDisabledRegistrations,
  knowledgeScopeDimensionGate,
  signJwtToken,
} from '../../src/middleware/auth';
import { getCurrentFilterClause } from '../../src/services/request-context';
import { clearPresetCache, loadRolePacks, resolveRoleKnowledgeScope } from '../../src/init/preset-loader';
import { KnowledgeStore, type FilterClause } from '../../src/l4/knowledge-store';

// ════════════════════════════════════════════════════════════════
// 0. 环境硬前置 + 词表（写死，防"探针自造值"）
// ════════════════════════════════════════════════════════════════

const REPO_PRESETS = join(process.cwd(), 'extensions', 'presets');
/** 不含连字符：FTS5 把 `-` 当 NOT 运算符（实测会抛 `no such column`） */
const QUERY = 'synovawirescope';
const ROLES_UNITS = 3;

/** 每个临时内容根的清理登记（用例失败也必须清） */
const cleanupRoots: string[] = [];
let unitRoot = '';                      // 本文件主用例的内容根（实物拷贝）
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];

beforeAll(() => {
  process.env.JWT_SECRET = 'k731-knowledge-scope-wiring-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);

  unitRoot = mkdtempSync(join(tmpdir(), 'k731-presets-'));
  cleanupRoots.push(unitRoot);
  cpSync(REPO_PRESETS, unitRoot, { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = unitRoot;
  clearPresetCache();
});

afterAll(() => {
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
  clearPresetCache();
  for (const root of cleanupRoots) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败不影响判据结论 */ }
  }
});

// ════════════════════════════════════════════════════════════════
// 1. 夹具：真中间件链取真条件集 / 临时库播种（I-C8 口径）
// ════════════════════════════════════════════════════════════════

interface CapturedFilter {
  readonly conditions: ReadonlyArray<{ readonly field: string; readonly operator: string; readonly value: unknown }>;
}

function mockRes(): Response {
  const res: Record<string, unknown> = {};
  res['status'] = () => res as unknown as Response;
  res['json'] = () => res as unknown as Response;
  return res as unknown as Response;
}

/**
 * 走**真**中间件链取回 **真** provider 产出的 FilterClause。
 *
 * 链路与 `src/server.ts` 同序：`jwtAuthMiddleware`（验签 → `runWithContext`）⇒ 在其
 * 同步 `next()` 帧内调**路由用的同一个** `getCurrentFilterClause('KnowledgeChunk')`。
 * 不复制 `routes/knowledge.ts` 的任何逻辑，也不注入替身 provider。
 */
async function captureFilter(role: string, orgId = 'org-wire'): Promise<CapturedFilter> {
  const token = signJwtToken({ sub: `u-${role}`, role, orgId });
  expect(token, 'JWT_SECRET 未就位 ⇒ 判据无法起跑').toBeTruthy();
  const req = {
    path: '/api/knowledge/search',
    headers: { authorization: `Bearer ${String(token)}` },
  } as unknown as Request;

  return new Promise<CapturedFilter>((resolve, reject) => {
    jwtAuthMiddleware(req, mockRes(), () => {
      getCurrentFilterClause('KnowledgeChunk').then(
        (clause: FilterClause) => { resolve(clause as CapturedFilter); },
        (err: unknown) => { reject(err instanceof Error ? err : new Error(String(err))); },
      );
    });
  });
}

/** 取某 field/operator 的全部条件值 */
function valuesOf(filter: CapturedFilter, field: string, operator: string): unknown[] {
  return filter.conditions.filter((c) => c.field === field && c.operator === operator).map((c) => c.value);
}

/** 岗位声明的 scope id 列表（从**真内容文件**读，作为断言的期望值来源） */
function declaredScopes(presetsRoot: string, roleId: string): string[] {
  const abs = join(presetsRoot, 'roles', roleId, 'knowledge-scope.yaml');
  const doc: unknown = loadYaml(readFileSync(abs, 'utf8'));
  const scopes = (doc as Record<string, unknown>)['scopes'];
  expect(Array.isArray(scopes), `${roleId}/knowledge-scope.yaml 的 scopes 不是数组`).toBe(true);
  return (scopes as Array<Record<string, unknown>>).map((s) => String(s['id'])).sort();
}

/** 岗位声明的 deny id 列表 */
function declaredDenies(presetsRoot: string, roleId: string): string[] {
  const abs = join(presetsRoot, 'roles', roleId, 'knowledge-scope.yaml');
  const doc: unknown = loadYaml(readFileSync(abs, 'utf8'));
  const deny = (doc as Record<string, unknown>)['deny'];
  if (!Array.isArray(deny)) return [];
  return (deny as Array<Record<string, unknown>>).map((d) => String(d['id'])).sort();
}

/** 在给定内容根上临时切根（`SYNOVA_PRESETS_ROOT` 是 loader/engine-auth 的**既有**注入缝） */
async function withPresetsRoot<T>(root: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env['SYNOVA_PRESETS_ROOT'];
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  clearPresetCache();
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
    else process.env['SYNOVA_PRESETS_ROOT'] = previous;
    clearPresetCache();
  }
}

/** 造一个内容根（实物拷贝 + 可选改写）—— 破坏只在临时根上做，仓库零改动 */
function makeVariantRoot(mutate?: (rolesRoot: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'k731-variant-'));
  cleanupRoots.push(root);
  cpSync(REPO_PRESETS, root, { recursive: true });
  if (mutate !== undefined) mutate(join(root, 'roles'));
  return root;
}

/** 改写某岗位 scope 文件的 scopes[]（返回改写后的 id 列表） */
function rewriteScopes(rolesRoot: string, roleId: string, ids: readonly string[]): void {
  const abs = join(rolesRoot, roleId, 'knowledge-scope.yaml');
  const doc = loadYaml(readFileSync(abs, 'utf8')) as Record<string, unknown>;
  doc['scopes'] = ids.map((id) => ({ id, label: `(夹具) ${id}`, collections: [`c-${id}`] }));
  writeFileSync(abs, dumpYaml(doc), 'utf8');
}

interface Seeded {
  readonly db: Database.Database;
  readonly store: KnowledgeStore;
  /** scope id → 该 scope 下那一条语料的 id */
  readonly idByScope: ReadonlyMap<string, string>;
  readonly close: () => void;
}

/**
 * 播种（**I-C8** 口径）: `insert()` 走生产写 API 拿真行，再对**同一句柄**直写 `pkb_domain`。
 *
 * 🔴 为什么必须直写（KL-1）：`insert()` 的 INSERT 列清单与 `update()` 的 UPDATE 列清单**都不含**
 *   `pkb_domain` ⇒ 生产写 API 当前无法表达 scope（`src/l3/pkb-seed.ts:266` 同被丢弃）。
 *   直写只用于**前置数据**，断言对象全在读侧生产链。
 *
 * 两岗位的**第一条** scope 各播一条**同 `source_id`** 的语料 ⇒ ③ 可对账的最小样本。
 */
function seedStore(
  scopeIds: readonly string[],
  sharedSourceId: string,
  sharedScopeIds: readonly string[] = [],
): Seeded {
  const db = new Database(':memory:');
  const store = new KnowledgeStore(db);
  const idByScope = new Map<string, string>();
  for (const scopeId of scopeIds) {
    const id = store.insert({
      text: `${QUERY} scope=${scopeId}`,
      sourceType: 'document',
      sourceId: sharedScopeIds.includes(scopeId) ? sharedSourceId : `wire:${scopeId}`,
      authorityLevel: 'reference',
      accessLevel: 'private',
      accessSensitivity: 'normal',
    });
    // I-C8：仅此一列、仅前置数据（不是断言对象）
    db.prepare('UPDATE knowledge_chunks SET pkb_domain = ? WHERE id = ?').run(scopeId, id);
    idByScope.set(scopeId, id);
  }
  return { db, store, idByScope, close: () => { db.close(); } };
}

/** 按 id 回临时库反查 `source_id`（d-v4：路由/`SearchResult` 之外的字段只能回库对账） */
function lookupSources(seeded: Seeded, ids: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = seeded.db
    .prepare(`SELECT id, source_id FROM knowledge_chunks WHERE id IN (${placeholders})`)
    .all(...ids) as Array<Record<string, unknown>>;
  for (const row of rows) map.set(String(row['id']), String(row['source_id']));
  return map;
}

/** 一次检索（真引擎：`KnowledgeStore.search` → `matchFilter`） */
function searchIds(seeded: Seeded, filter: FilterClause): string[] {
  const { results } = seeded.store.search(QUERY, filter, 50);
  return results.map((r) => r.id).sort();
}

// ════════════════════════════════════════════════════════════════
// 2. T1 —— 装载期**解析内容**（不再是"只判存在且非空"）
// ════════════════════════════════════════════════════════════════

describe('#731 / T1 — preset-loader 装载期真解析 knowledge-scope.yaml 内容', () => {
  it('正常路径: 三件岗位 scope 文件被真解析 ⇒ scopeIds/denyIds 与文件一致，装载无 error', () => {
    const report = loadRolePacks();
    expect(report.errors).toEqual([]);
    expect(report.degraded).toBe(false);
    const ids = report.roles.map((r) => r.roleId).sort();
    expect(ids).toEqual(['finance', 'hr', 'sales']);          // 集合相等（不是 ≥1）
    for (const pack of report.roles) {
      const decl = pack.knowledgeScope;
      expect(decl.declared, `${pack.roleId} 的 scope 内容未被解析`).toBe(true);
      expect(decl.scopeIds.slice().sort()).toEqual(declaredScopes(unitRoot, pack.roleId));
      expect(decl.denyIds.slice().sort()).toEqual(declaredDenies(unitRoot, pack.roleId));
      expect(decl.problems).toEqual([]);
      expect(decl.degraded).toBe(false);
    }
  });

  it('降级路径: 内容坏（YAML 语法坏）⇒ degraded ＋ errors 点名该文件（不静默当齐备）', () => {
    const root = makeVariantRoot((rolesRoot) => {
      writeFileSync(join(rolesRoot, 'finance', 'knowledge-scope.yaml'), 'scopes: [unclosed\n', 'utf8');
    });
    return withPresetsRoot(root, () => {
      const report = loadRolePacks();
      expect(report.degraded).toBe(true);
      expect(report.errors.join(' ')).toContain('finance');
      expect(report.errors.join(' ')).toContain('YAML 解析失败');
    });
  });

  it('降级路径: `scopes` 为空 / 非数组 ⇒ 逐条点名（fail-closed，不回落"不过滤"）', () => {
    const root = makeVariantRoot((rolesRoot) => {
      writeFileSync(
        join(rolesRoot, 'finance', 'knowledge-scope.yaml'),
        'roleId: finance\nversion: 1.0.0\nscopes: []\n',
        'utf8',
      );
      writeFileSync(
        join(rolesRoot, 'hr', 'knowledge-scope.yaml'),
        'roleId: hr\nversion: 1.0.0\nscopes: 5\n',
        'utf8',
      );
    });
    return withPresetsRoot(root, () => {
      const report = loadRolePacks();
      const joined = report.errors.join(' ');
      expect(joined).toContain('scopes');
      expect(joined).toContain('finance');
      expect(joined).toContain('hr');
      expect(report.degraded).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 3. T2 —— 命名空间文件派生（d-perm：hr/sales 自然消失）
// ════════════════════════════════════════════════════════════════

describe('#731 / T2 — 权限命名空间由内容文件派生（d-perm）', () => {
  it('现物派生结果 = yaml 背书集 {finance, people, market}；hr/sales 不在其中', () => {
    return withPresetsRoot(unitRoot, () => {
      const scopes = getKnowledgeScopes();
      expect(scopes).toContain('finance');
      expect(scopes).toContain('people');
      expect(scopes).toContain('market');
      // d-perm 语义修正：hr/sales 无任何 knowledge-scope.yaml 背书 ⇒ 不出现
      expect(scopes).not.toContain('hr');
      expect(scopes).not.toContain('sales');
    });
  });

  it('🔴 迁移面: knowledge.hr.read / knowledge.sales.read 变未知名 ⇒ 丢弃 ＋ 点名（不静默提权）', () => {
    return withPresetsRoot(unitRoot, () => {
      expect(isPermissionId('knowledge.people.read')).toBe(true);
      expect(isPermissionId('knowledge.hr.read')).toBe(false);
      expect(isPermissionId('knowledge.sales.read')).toBe(false);
      const resolved = resolveGrants('hr', { root: unitRoot });
      // hr capabilities 同时声明 hr.read（:21）与 people.read（:22）⇒ 前者被判未知名丢弃，
      //   后者生效 ⇒ 项模型对 hr **仍发声**（不回落放宽到档位默认）
      expect(resolved.items).toContain('knowledge.people.read');
      expect(resolved.degradedReasons.join(' ')).toContain('knowledge.hr.read');
    });
  });

  it('文件驱动: 新增一个岗位目录里的新命名空间 ⇒ 立刻可授（不改代码）', () => {
    const root = makeVariantRoot((rolesRoot) => {
      const dir = join(rolesRoot, 'ops');
      cpSync(join(rolesRoot, 'finance'), dir, { recursive: true });
      writeFileSync(
        join(dir, 'knowledge-scope.yaml'),
        'roleId: ops\nversion: 1.0.0\nscopes:\n  - id: ops.logistics\n    label: 物流\n    collections: [shipment]\n',
        'utf8',
      );
      writeFileSync(join(dir, 'capabilities.yaml'), 'roleId: ops\nversion: 1.0.0\npermissionGrants:\n  grants:\n    - knowledge.ops.read\n', 'utf8');
    });
    return withPresetsRoot(root, () => {
      expect(getKnowledgeScopes()).toContain('ops');
      expect(isPermissionId('knowledge.ops.read')).toBe(true);
      const resolved = resolveGrants('ops', { root });
      expect(resolved.items).toEqual(['knowledge.ops.read']);
    });
  });

  it('d-refresh: 同一路径改内容（mtime/size 变）⇒ 下一次解析即生效（禁进程级常量）', async () => {
    const root = makeVariantRoot();
    await withPresetsRoot(root, () => {
      const before = resolveRoleKnowledgeScope('finance');
      expect(before.scopeIds).not.toContain('finance.probe-extra');
      rewriteScopes(join(root, 'roles'), 'finance', [...before.scopeIds, 'finance.probe-extra']);
      const after = resolveRoleKnowledgeScope('finance');
      expect(after.scopeIds).toContain('finance.probe-extra');
      expect(after.scopeIds.length).toBe(before.scopeIds.length + 1);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 4. ① 结构 —— 真 provider 的条件集里有 scope 维 IN（改坏删掉 ⇒ 本组红）
// ════════════════════════════════════════════════════════════════

describe('#731 / ① 结构面: 真 provider 的条件集出现 scope 维（declared-only 已消除）', () => {
  it('finance / hr 的条件集都含 {pkb_domain IN <文件派生 scopes>}，且两岗位集合不同', async () => {
    const finance = await captureFilter('finance');
    const hr = await captureFilter('hr');

    const financeValues = valuesOf(finance, 'pkb_domain', 'IN');
    const hrValues = valuesOf(hr, 'pkb_domain', 'IN');
    expect(financeValues.length, '真 provider 条件集无 pkb_domain IN ⇒ 生产链未消费 scopes（declared-only）').toBe(1);
    expect(hrValues.length, '真 provider 条件集无 pkb_domain IN ⇒ 生产链未消费 scopes（declared-only）').toBe(1);

    expect(financeValues[0]).toEqual(declaredScopes(unitRoot, 'finance'));
    expect(hrValues[0]).toEqual(declaredScopes(unitRoot, 'hr'));
    // 两岗位差异**只**由内容文件决定 ⇒ 集合必然不同
    expect(financeValues[0]).not.toEqual(hrValues[0]);
  });

  it('I-C3 不回退: 条件集**第 0 位**仍是 sensitivity（scope 维是追加，不是替换）', async () => {
    for (const role of ['finance', 'hr', 'sales']) {
      const filter = await captureFilter(role);
      const first = filter.conditions[0];
      expect({ role, field: first?.field }).toEqual({ role, field: 'access.sensitivity' });
      expect({ role, op: first?.operator }).toEqual({ role, op: 'IN' });
      // 追加 ⇒ 长度只增不减（≥ 1 条 sensitivity ＋ 1 条 scope ＋ N 条 deny）
      expect(filter.conditions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('I-C4 可观测: 无 scope 文件的岗位（admin）⇒ 不追加 scope 维，但条件集仍非空（不 fail-open）', async () => {
    const root = makeVariantRoot((rolesRoot) => {
      rmSync(join(rolesRoot, 'finance'), { recursive: true, force: true });
      rmSync(join(rolesRoot, 'hr'), { recursive: true, force: true });
      rmSync(join(rolesRoot, 'sales'), { recursive: true, force: true });
    });
    await withPresetsRoot(root, async () => {
      const filter = await captureFilter('admin');
      expect(valuesOf(filter, 'pkb_domain', 'IN')).toEqual([]);
      expect(filter.conditions.length).toBe(1);            // 只剩 sensitivity
      expect(filter.conditions[0]?.field).toBe('access.sensitivity');
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 5. ② 行为 + ③ 可对账 —— 真引擎下两岗位结果集不同且同源可追
// ════════════════════════════════════════════════════════════════

describe('#731 / ② 行为面 + ③ 可对账: 同 query 两岗位结果不同，且同一事实指向同一源行', () => {
  it('两岗位同 query ⇒ id 集合不同；且两集合都能回临时库反查到 source_id，交集非空', async () => {
    const financeScopes = declaredScopes(unitRoot, 'finance');
    const hrScopes = declaredScopes(unitRoot, 'hr');
    expect(financeScopes.length).toBe(ROLES_UNITS);
    expect(hrScopes.length).toBe(ROLES_UNITS);

    // 两岗位的**第一条** scope 各播一条同 `source_id` 的语料 ⇒ ③ 可对账的最小样本
    const seeded = seedStore(
      [...financeScopes, ...hrScopes],
      'wire:shared-fact',
      [financeScopes[0] ?? '', hrScopes[0] ?? ''],
    );
    try {
      const finance = await captureFilter('finance');
      const hr = await captureFilter('hr');
      const financeIds = searchIds(seeded, finance as FilterClause);
      const hrIds = searchIds(seeded, hr as FilterClause);

      // ② 两岗位结果集**不同**，且各自非空（否则"scope 生效"与"库为空"不可分辨）
      expect(financeIds.length).toBe(ROLES_UNITS);
      expect(hrIds.length).toBe(ROLES_UNITS);
      expect(financeIds).not.toEqual(hrIds);
      // 差异**只由内容文件**决定：finance 一条 hr 的 scope 都看不到，反之亦然
      const hrIdSet = new Set(hrIds);
      for (const scopes of hrScopes) {
        expect(hrIdSet.has(seeded.idByScope.get(scopes) ?? '')).toBe(true);
      }
      for (const scopes of financeScopes) {
        expect(hrIdSet.has(seeded.idByScope.get(scopes) ?? '')).toBe(false);
      }

      // ③ 可对账（一致性 = 可对账 ≠ 相同输出）：回临时库反查 source_id，两岗位指向同一源行
      const financeSources = lookupSources(seeded, financeIds);
      const hrSources = lookupSources(seeded, hrIds);
      expect(financeSources.size).toBe(financeIds.length);
      expect(hrSources.size).toBe(hrIds.length);
      const sharedSources = [...financeSources.values()].filter((sid) => [...hrSources.values()].includes(sid));
      expect(sharedSources).toContain('wire:shared-fact');
    } finally {
      seeded.close();
    }
  });

  it('🔴 fail-closed（自验抓到的真 fail-open 修复）: 角色目录在而 scope 文件被拔 ⇒ 整岗**一件都看不到**', async () => {
    const root = makeVariantRoot((rolesRoot) => {
      rmSync(join(rolesRoot, 'finance', 'knowledge-scope.yaml'), { force: true });
    });
    const allScopes = [...declaredScopes(unitRoot, 'finance'), ...declaredScopes(unitRoot, 'hr')];
    const seeded = seedStore(allScopes, 'wire:shared-fact');
    try {
      // 🔴 必须切到**变体内容根**：否则读的还是 unitRoot（finance 文件在）⇒ 这条反例就成了空断言
      const [finance, hr] = await withPresetsRoot(root, async () => [
        await captureFilter('finance'),
        await captureFilter('hr'),
      ]);
      // 诊断面：声明被折成 degraded（fail-closed 的入口条件）
      const decl = await withPresetsRoot(root, () => resolveRoleKnowledgeScope('finance'));
      expect(decl.degraded).toBe(true);
      expect(decl.scopeIds).toEqual([]);

      // 条件面：退化为拒绝型 `pkb_domain IN []`（**不是**"少一维"）
      expect(valuesOf(finance, 'pkb_domain', 'IN')).toEqual([[]]);
      // 第 0 位仍是 sensitivity（K12-11 不回退）
      expect(finance.conditions[0]?.field).toBe('access.sensitivity');

      // 行为面：**一行都检索不到**（旧实现此处是 6/6 全见 = fail-open，本用例就是它的牙）
      const financeIds = searchIds(seeded, finance as FilterClause);
      expect(financeIds).toEqual([]);
      // 对照：hr 不受影响（证明收的是"该岗位"，不是"全站")
      const hrIds = searchIds(seeded, hr as FilterClause);
      expect(hrIds.length).toBe(ROLES_UNITS);
    } finally {
      seeded.close();
    }
  });

  it('两条分支分界: 角色目录在缺文件 ⇒ fail-closed；角色目录不存在 ⇒ 不追加但条件仍非空（不 fail-open）', async () => {
    const root = makeVariantRoot((rolesRoot) => {
      // ① 目录在、文件缺 ⇒ 必须 fail-closed
      rmSync(join(rolesRoot, 'hr', 'knowledge-scope.yaml'), { force: true });
      // ② 目录整个不存在 ⇒ I-C4（不追加），且不得与 ① 混为一谈
      rmSync(join(rolesRoot, 'sales'), { recursive: true, force: true });
    });
    await withPresetsRoot(root, async () => {
      // ① 有目录缺文件
      const hrNoFile = resolveRoleKnowledgeScope('hr');
      expect(hrNoFile.degraded).toBe(true);
      expect(hrNoFile.problems.join(' ')).toContain('knowledge-scope.yaml');
      // ② 无目录
      const salesNoDir = resolveRoleKnowledgeScope('sales');
      expect(salesNoDir.degraded).toBe(false);
      expect(salesNoDir.declared).toBe(false);
      expect(salesNoDir.problems).toEqual([]);

      const hrFilter = await captureFilter('hr');
      expect(valuesOf(hrFilter, 'pkb_domain', 'IN')).toEqual([[]]);   // ① fail-closed
      const salesFilter = await captureFilter('sales');
      expect(valuesOf(salesFilter, 'pkb_domain', 'IN')).toEqual([]);  // ② 不追加
      expect(salesFilter.conditions.length).toBe(1);                  // 仍非空（sensitivity 在）
      expect(salesFilter.conditions[0]?.field).toBe('access.sensitivity');
    });
  });

  it('同样 fail-closed: 角色目录在而 scope 文件为**空文档/仅注释** ⇒ 整岗一件都看不到', async () => {
    const root = makeVariantRoot((rolesRoot) => {
      writeFileSync(join(rolesRoot, 'finance', 'knowledge-scope.yaml'), '# 只有注释，没有任何声明\n', 'utf8');
    });
    const seeded = seedStore(declaredScopes(unitRoot, 'finance'), 'wire:shared-fact');
    try {
      const finance = await withPresetsRoot(root, () => captureFilter('finance'));
      expect(valuesOf(finance, 'pkb_domain', 'IN')).toEqual([[]]);
      expect(searchIds(seeded, finance as FilterClause)).toEqual([]);
    } finally {
      seeded.close();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 6. ④ deny 两段式 —— (i) 结构 (ii) 语义（防恒真）
// ════════════════════════════════════════════════════════════════

describe('#731 / ④ V6 deny 两段式：结构有 NOT_EQ，语义上 deny 是唯一排除项', () => {
  it('(i) 结构: 每个 deny[].id 都有一条 {pkb_domain NOT_EQ id}（逐 id 展开）', async () => {
    for (const role of ['finance', 'hr', 'sales']) {
      const denies = declaredDenies(unitRoot, role);
      expect({ role, hasDeny: denies.length > 0 }).toEqual({ role, hasDeny: true });
      const filter = await captureFilter(role);
      const excluded = valuesOf(filter, 'pkb_domain', 'NOT_EQ').map((v) => String(v)).sort();
      expect(excluded).toEqual(denies);
    }
  });

  it('(ii) 语义（防恒真）: 把 deny 的 id 同时写进 scopes ⇒ IN 允许它、NOT_EQ 排除它，且该行**看不到**', async () => {
    const financeDenies = declaredDenies(unitRoot, 'finance');
    const denyId = financeDenies[0];
    expect(denyId).toBeTruthy();
    // 现物三件里 deny 与 scopes **无重叠** ⇒ 不构造就只能是恒真式（dev doc §2.5 d-deny）
    expect(declaredScopes(unitRoot, 'finance')).not.toContain(denyId);

    const root = makeVariantRoot((rolesRoot) => {
      rewriteScopes(rolesRoot, 'finance', [...declaredScopes(unitRoot, 'finance'), String(denyId)]);
    });
    await withPresetsRoot(root, async () => {
      const filter = await captureFilter('finance');
      const allowed = valuesOf(filter, 'pkb_domain', 'IN')[0] as string[];
      const excluded = valuesOf(filter, 'pkb_domain', 'NOT_EQ').map((v) => String(v));
      expect(allowed, '构造没生效：deny id 未进 scope IN').toContain(denyId);
      expect(excluded, 'deny 无牙齿：IN 允许但无 NOT_EQ 排除').toContain(denyId);

      // 行为面铁证：该 scope 下**确实播了语料**，却仍检索不到 ⇒ 排除只能来自 deny
      const seeded = seedStore([...allowed, String(denyId)], 'wire:shared-fact');
      try {
        const ids = searchIds(seeded, filter as FilterClause);
        expect(ids).not.toContain(seeded.idByScope.get(String(denyId)));
        expect(ids.length).toBe(ROLES_UNITS);            // 其余 3 个 scope 照常可见
      } finally {
        seeded.close();
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 7. 三态降级 —— I-C6 fail-closed（文件在但内容不可用 ⇒ 一行都看不到）
// ════════════════════════════════════════════════════════════════

describe('#731 / 三态降级: 内容坏 ⇒ fail-closed 拒绝型条件集（绝不回落"不过滤"）', () => {
  it('finance 的 scopes 改空 ⇒ 条件集退化为 {pkb_domain IN []} ⇒ 一行都检索不到', async () => {
    const root = makeVariantRoot((rolesRoot) => {
      rewriteScopes(rolesRoot, 'finance', []);
    });
    await withPresetsRoot(root, async () => {
      const filter = await captureFilter('finance');
      // 第 0 位仍必须是 sensitivity（K12-11 不回退）
      expect(filter.conditions[0]?.field).toBe('access.sensitivity');
      // scope 维退化为"拒绝型"：IN 空数组 ⇒ matchFilter 对每一行恒 false
      expect(valuesOf(filter, 'pkb_domain', 'IN')).toEqual([[]]);

      const seeded = seedStore(declaredScopes(unitRoot, 'finance'), 'wire:shared-fact');
      try {
        expect(searchIds(seeded, filter as FilterClause)).toEqual([]);
      } finally {
        seeded.close();
      }
    });
  });

  it('finance 的 scope 文件 YAML 语法坏 ⇒ 同样 fail-closed（日志侧带 KNOWLEDGE_SCOPE_INVALID）', async () => {
    const root = makeVariantRoot((rolesRoot) => {
      writeFileSync(join(rolesRoot, 'finance', 'knowledge-scope.yaml'), 'scopes: [unclosed\n', 'utf8');
    });
    await withPresetsRoot(root, async () => {
      const decl = resolveRoleKnowledgeScope('finance');
      expect(decl.degraded).toBe(true);
      expect(decl.problems.length).toBeGreaterThan(0);
      const filter = await captureFilter('finance');
      expect(valuesOf(filter, 'pkb_domain', 'IN')).toEqual([[]]);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 8. 裁 425 / A1 —— scope 维**紧急回滚开关**（默认严开；关必留痕，禁静默关）
// ════════════════════════════════════════════════════════════════

/**
 * 开关判据的**顺序无关**前提（自验员会按"单例跑 / 整文件跑"两序对撞）:
 *   · 每个用例自带 `withScopeSwitch(...)` 的 `try/finally` 复位 ⇒ 判据①的"默认环境=严开"
 *     不会被上一个用例的 `off` 污染（否则绿得可疑）。另配 `afterEach` 兜底复位。
 *   · 降级登记取**增量**而非绝对值，且登记与日志 memo 解耦 ⇒ 无论本文件先前跑过多少
 *     `off` 用例，"一次关闭判定 = +1"恒定成立。
 *   · 日志侧的"登记行"由**跨进程** fd 2 原始输出取证（`@synova/logger` 直写 fd 2，
 *     进程内拦不到 —— 见 `tests/security/department-request-path.test.ts:37-48`）。
 */
const SCOPE_SWITCH_ENV = 'SYNOVA_KNOWLEDGE_SCOPE_DIM';
const ORIGINAL_SWITCH_ENV = process.env[SCOPE_SWITCH_ENV];

/** 在指定开关取值下执行，退出时**必定**复位（改 `process.env` ⇒ 必须 try/finally） */
async function withScopeSwitch<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env[SCOPE_SWITCH_ENV];
  if (value === undefined) delete process.env[SCOPE_SWITCH_ENV];
  else process.env[SCOPE_SWITCH_ENV] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[SCOPE_SWITCH_ENV];
    else process.env[SCOPE_SWITCH_ENV] = previous;
  }
}

afterEach(() => {
  // 兜底：即使某用例断言中途抛错，也不把开关值漏给后续用例
  if (ORIGINAL_SWITCH_ENV === undefined) delete process.env[SCOPE_SWITCH_ENV];
  else process.env[SCOPE_SWITCH_ENV] = ORIGINAL_SWITCH_ENV;
});

describe('#731 / 裁425-A1: scope 维紧急回滚开关（默认严开；关必留痕，禁静默关）', () => {
  it('正常路径（默认环境）: 未设开关 ⇒ scope 维照常展开，且**零**关闭登记（不是"常开也报降级"）', async () => {
    await withScopeSwitch(undefined, async () => {
      const before = knowledgeScopeDimensionDisabledRegistrations();
      const filter = await captureFilter('finance');
      const after = knowledgeScopeDimensionDisabledRegistrations();

      // 严开 = PR2 默认姿态：真 provider 条件集仍含 {pkb_domain IN 文件派生 scopes}
      expect(valuesOf(filter, 'pkb_domain', 'IN')).toEqual([declaredScopes(unitRoot, 'finance')]);
      expect(after, '严开态不得产生关闭登记（否则降级信号失效）').toBe(before);

      const gate = knowledgeScopeDimensionGate();
      expect(gate).toEqual({
        enabled: true,
        degraded: false,
        code: null,
        phase: 'knowledge-scope-dim',
        retryable: false,
      });
    });
  });

  it('🔴 降级路径（开关=off）: 条件集只剩 sensitivity 维 ＋ degraded:true ＋ code ＋ 登记 +1', async () => {
    await withScopeSwitch('off', async () => {
      const before = knowledgeScopeDimensionDisabledRegistrations();
      const finance = await captureFilter('finance');
      const after = knowledgeScopeDimensionDisabledRegistrations();

      // (a) 条件面：scope 维**整维消失**（不是只少一条），但条件集**仍非空**（不 fail-open）
      expect(valuesOf(finance, 'pkb_domain', 'IN')).toEqual([]);
      expect(valuesOf(finance, 'pkb_domain', 'NOT_EQ')).toEqual([]);
      expect(finance.conditions.length).toBe(1);
      expect(finance.conditions[0]?.field).toBe('access.sensitivity');   // I-C3 第 0 位不回退

      // (b) 降级面：degraded:true ＋ typed code ＋ 相位 ＋ 可自愈（**禁静默关**）
      const gate = knowledgeScopeDimensionGate();
      expect({ enabled: gate.enabled, degraded: gate.degraded }).toEqual({ enabled: false, degraded: true });
      expect(gate.code).toBe('KNOWLEDGE_SCOPE_DIM_DISABLED');
      expect(gate.phase).toBe('knowledge-scope-dim');
      expect(gate.retryable).toBe(true);
      // 登记项（确定性增量；与日志 memo 解耦 ⇒ 单跑/整跑同结论）
      expect(after - before, '关闭判定未登记 ⇒ 这就是"静默关"（判据②(b) 的红态）').toBe(1);

      // (c) 行为面：维度真被撤 —— 真引擎下 finance 现在能看到 hr 的语料
      //     （若实现只是"少派生一条条件"而库里另有过滤，这里会红）
      const seeded = seedStore(
        [...declaredScopes(unitRoot, 'finance'), ...declaredScopes(unitRoot, 'hr')],
        'wire:shared-fact',
      );
      try {
        expect(searchIds(seeded, finance as FilterClause).length).toBe(ROLES_UNITS * 2);
      } finally {
        seeded.close();
      }
    });
  });

  it('边界: 仅 `off` 关闭（大小写/空白归一）；空串与其它值一律**严开**（禁"设错就放开"）', async () => {
    const table: ReadonlyArray<{ readonly value: string | undefined; readonly off: boolean }> = [
      { value: undefined, off: false },
      { value: '', off: false },
      { value: '   ', off: false },
      { value: 'on', off: false },
      { value: '0', off: false },
      { value: 'disabled', off: false },
      { value: 'OFF', off: true },
      { value: ' Off ', off: true },
    ];
    for (const { value, off } of table) {
      await withScopeSwitch(value, async () => {
        const gate = knowledgeScopeDimensionGate();
        const label = JSON.stringify(value ?? null);
        expect({ label, enabled: gate.enabled }, `开关取值 ${label} 的展开判定`).toEqual({
          label,
          enabled: !off,
        });
        expect({ label, degraded: gate.degraded }, `开关取值 ${label} 的降级判定`).toEqual({
          label,
          degraded: off,
        });
        expect({ label, code: gate.code }, `开关取值 ${label} 的 code`).toEqual({
          label,
          code: off ? 'KNOWLEDGE_SCOPE_DIM_DISABLED' : null,
        });
      });
    }
  });

  it('解除回滚无需重启: 同进程内 off ⇒ 恢复默认**即刻**严开（判定每次现读，禁进程级常量）', async () => {
    const financeScopes = declaredScopes(unitRoot, 'finance');
    const offFilter = await withScopeSwitch('off', () => captureFilter('finance'));
    expect(valuesOf(offFilter, 'pkb_domain', 'IN')).toEqual([]);

    const onFilter = await withScopeSwitch(undefined, () => captureFilter('finance'));
    expect(valuesOf(onFilter, 'pkb_domain', 'IN')).toEqual([financeScopes]);
  });
});
