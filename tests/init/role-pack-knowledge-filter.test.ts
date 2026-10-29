/**
 * tests/init/role-pack-knowledge-filter.test.ts — #1075 P2-4b-B **B-J1/B-J2/B-J4** 判据
 *
 * 判据对象 = `src/init/role-pack-knowledge-filter.ts` 的 `buildRoleKnowledgeFilter`：
 *   把「岗位包 `knowledge-scope.yaml` 的 scope/deny」＋「认证面同源敏感度」编译成 L4 `FilterClause`。
 *
 * 🔴 形态（铁律 12：不 mock 管线）:
 *   · 真 better-sqlite3 `:memory:` ＋ 真 `KnowledgeStore`（search/matchFilter 全走生产实现）；
 *   · 真 `resolveRoleKnowledgeScope`（读**临时仓库形状根**，非 cwd）＋ 真 `allowedSensitivitiesByGrants`；
 *   · 判据断言**真实检索结果**（不是"条件数组长得像"），条件形状另有一组显式断言（顺序/operator/value）。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   B-J1 scope/deny：条件第 0=敏感度、第 1=pkb_domain IN scopes、随后逐 deny NOT_EQ；真 search 只返 scope 内条目。
 *        反例（**删 scope 条件**）⇒ 域外条目可见 ⇒ 证明 scope 条件是**承重**的（不是装饰）。
 *   B-J2 敏感度：非 admin 档位∩grants ⇒ 字面值 `['normal']`；`sensitive` 条目检索不可见、`normal` 可见。
 *        反例（**换 `sensitivityWhitelistFromGrants`** 的更宽集合）⇒ `sensitive` 可见 ⇒ 证明漏斗是有牙的。
 *   B-J4 fail-closed：scope 缺件／空文档／坏 YAML／审批缺失（pending）⇒ 拒绝型 `pkb_domain IN []` ⇒ 0 行；
 *        未打标（`pkb_domain = NULL`）条目恒不可见（不回落全库）。
 *
 * 夹具铁律：`SYNOVA_PRESETS_ROOT` 指 `mkdtemp` 的**仓库形状根**（`<tmp>/extensions/presets`，
 *   审批根 = `<tmp>/.synova/approvals`）；每个用例新建/删除；**禁写真仓** `extensions/presets`。
 *   六件内容指纹用生产纯核现算（`computeRolePackContentHash`）——手写 hex 必撞 CONTENT_CHANGED。
 *
 * @degraded 本文件对降级面的判据 = "拒绝型条件 ＋ 0 结果"（不逐字断日志文案）。
 * @authority 判据归属 #1075 P2-4b-B（规格 §4 B-J1/B-J2/B-J4）。
 *
 * 已知限制：
 *   ① 只覆盖 sensitivity ＋ pkb_domain 两维（同实现，规格 §2.2-D3）；
 *   ② 审批记录是**夹具**直写（生产审批写入面归 P3），不证审批写路径；
 *   ③ 不测真实 LLM（检索面为纯 L4）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { buildRoleKnowledgeFilter, type RoleKnowledgeFilter } from '../../src/init/role-pack-knowledge-filter';
import { clearPresetCache } from '../../src/init/preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';
import { allowedSensitivities, allowedSensitivitiesByGrants } from '../../src/middleware/auth';
import { sensitivityWhitelistFromGrants, resolveGrants } from '@synova/engine-auth';
import { KnowledgeStore } from '../../src/l4/knowledge-store';

// ══════════════════════════════════════════════════════════════════════════════
// 夹具常量
// ══════════════════════════════════════════════════════════════════════════════

/** 非出厂角色 id（出厂三包只信代码锚 ⇒ 只能用非出厂 id 测审批态） */
const ROLE = 'ops';
const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_p24bb_filter_fixture';
const APPROVER_ROLE = 'super-admin';
const APPROVAL_ORG_ID = 'default';
/** refs 用的 scope 名 —— 🔴 必须**命中同包 `scopes[].id`**（loader 的 IO 壳会核，否则 ROLE_PACK_REF_MISSING） */
const REF_SCOPE = 'finance.statements';

const SCOPES = ['finance.statements'] as const;
const DENIES = ['finance.salaries'] as const;

let fixture: string;
let root: string;
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];
const ORIGINAL_ORG_ID = process.env['SYNOVA_ORG_ID'];

function rolesRoot(): string {
  return join(root, 'roles');
}

function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

// ══════════════════════════════════════════════════════════════════════════════
// 角色包夹具（仓库形状；六件；refs 与 context-manifest 投影对账）
// ══════════════════════════════════════════════════════════════════════════════

function manifestDoc(roleId: string): Record<string, unknown> {
  return {
    $schema: '../../schema/role-pack-v3.schema.json',
    schemaVersion: 3,
    name: `role-${roleId}`,
    version: '2.0.0',
    type: 'role-preset',
    displayName: roleId,
    entryPoint: './context-manifest.yaml',
    roleId,
    pieces: [...ROLE_PACK_PIECES],
    refs: [{ kind: 'scope', name: REF_SCOPE }],
  };
}

interface RolePackOptions {
  /** `knowledge-scope.yaml` 原文覆盖（缺件/坏件场景）；`null` ⇒ 不写该文件 */
  readonly scopeYaml?: string | null;
  /** `capabilities.yaml` 是否加 `permissionGrants`（B-J2 反例用） */
  readonly grants?: readonly string[];
}

/** 造一个齐备角色包（默认 scope=SCOPES、deny=DENIES） */
function writeRolePack(options: RolePackOptions = {}): void {
  const dir = join(rolesRoot(), ROLE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifestDoc(ROLE), null, 2)}\n`, 'utf8');
  writeFileSync(
    join(dir, 'context-manifest.yaml'),
    [
      `roleId: ${ROLE}`,
      'version: 2',
      'contexts:',
      '  - id: ops.demo',
      '    label: 三表口径',
      `    source: knowledge-scope.yaml#${REF_SCOPE}`,
      '    why: 判断必须建立在同一套口径上',
      '    required: true',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(join(dir, 'output-template.ref'), 'templateId: demo\nsections:\n  - id: summary\n    title: 摘要\n', 'utf8');
  const caps: string[] = [`roleId: ${ROLE}`, 'version: 2', 'capabilities: []'];
  if (options.grants !== undefined) {
    caps.push('permissionGrants:', '  grants:');
    for (const g of options.grants) caps.push(`    - ${g}`);
  }
  writeFileSync(join(dir, 'capabilities.yaml'), `${caps.join('\n')}\n`, 'utf8');
  writeFileSync(join(dir, 'acceptance-criteria.yaml'), `roleId: ${ROLE}\nversion: 2\ncriteria:\n  - id: ac.demo\n    text: demo\n`, 'utf8');

  const scopeYaml = options.scopeYaml === undefined ? defaultScopeYaml() : options.scopeYaml;
  if (scopeYaml !== null) writeFileSync(join(dir, 'knowledge-scope.yaml'), scopeYaml, 'utf8');
}

function defaultScopeYaml(): string {
  const lines = [`roleId: ${ROLE}`, 'version: 2', 'scopes:'];
  for (const scope of SCOPES) lines.push(`  - id: ${scope}`);
  lines.push('deny:');
  for (const deny of DENIES) lines.push(`  - id: ${deny}`);
  return `${lines.join('\n')}\n`;
}

/** 单件字节（缺件 ⇒ 空 buffer：缺件用例也要能写出审批记录，否则夹具自身先抛 ENOENT） */
function pieceBytes(name: string): Buffer {
  try {
    return readFileSync(join(rolesRoot(), ROLE, name));
  } catch {
    return Buffer.alloc(0);
  }
}

/** 六件内容指纹（生产纯核现算；与 loader 同源） */
function roleContentHash(): string {
  return computeRolePackContentHash(ROLE_PACK_PIECES.map((name) => ({ name, bytes: pieceBytes(name) })));
}

/** 自绑定 approvalId（`role-pack-approval.ts:223` 公式的夹具侧实现） */
function selfBoundApprovalId(contentHash: string, scope: 'content' | 'content+permissions'): string {
  const material = [APPROVAL_ORG_ID, ROLE, contentHash, scope, APPROVED_AT, APPROVER_ID, APPROVER_ROLE].join('|');
  const digest = createHash('sha256').update(material, 'utf8').digest('hex');
  return `apv1:${digest.slice(0, 16)}`;
}

/** 写审批记录（approved）；不调用 = pending（B-J4 第 4 例） */
function writeApprovalRecord(scope: 'content' | 'content+permissions' = 'content+permissions'): void {
  const contentHash = roleContentHash();
  mkdirSync(approvalsRoot(), { recursive: true });
  writeFileSync(
    join(approvalsRoot(), `${ROLE}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        roleId: ROLE,
        orgId: APPROVAL_ORG_ID,
        approvalId: selfBoundApprovalId(contentHash, scope),
        contentHash,
        approverId: APPROVER_ID,
        approverRole: APPROVER_ROLE,
        approvedAt: APPROVED_AT,
        scope,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 真 SQLite（`:memory:`）＋ 条目夹具
// ══════════════════════════════════════════════════════════════════════════════

interface StoreFixture {
  readonly store: KnowledgeStore;
  close: () => void;
}

function makeStore(): StoreFixture {
  const db = new Database(':memory:');
  return { store: new KnowledgeStore(db), close: () => db.close() };
}

/** 插一条知识块（`pkbDomain` 缺省 = NULL，模拟"未打标"历史数据）；返回**真实行 id** */
function insertChunk(
  store: KnowledgeStore,
  label: string,
  domain: string | null,
  sensitivity: 'normal' | 'sensitive' = 'normal',
): string {
  return store.insert({
    text: `${label} 现金流 口径说明`,
    sourceType: 'document',
    sourceId: `doc-${label}`,
    authorityLevel: 'reference',
    accessLevel: 'team',
    accessSensitivity: sensitivity,
    ...(domain === null ? {} : { pkbDomain: domain }),
  });
}

/** 检索并把结果 id 排序返回（判据只看集合，不看顺序） */
function searchIds(store: KnowledgeStore, filter: RoleKnowledgeFilter): string[] {
  const found = store.search('现金流', { conditions: filter.conditions }, 10);
  return found.results.map((r) => r.id).sort();
}

/** 取某字段的全部条件（顺序断言用） */
function conditionsOf(filter: RoleKnowledgeFilter, field: string): Array<{ operator: string; value: unknown }> {
  return filter.conditions.filter((c) => c.field === field).map((c) => ({ operator: c.operator, value: c.value }));
}

// ══════════════════════════════════════════════════════════════════════════════
// 每用例隔离
// ══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'p24bb-filter-'));
  root = join(fixture, 'extensions', 'presets');
  mkdirSync(rolesRoot(), { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  delete process.env['SYNOVA_ORG_ID'];
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
  if (ORIGINAL_ORG_ID === undefined) delete process.env['SYNOVA_ORG_ID'];
  else process.env['SYNOVA_ORG_ID'] = ORIGINAL_ORG_ID;
  clearPresetCache();
});

// ══════════════════════════════════════════════════════════════════════════════
// B-J1 scope / deny
// ══════════════════════════════════════════════════════════════════════════════

describe('B-J1 · scope/deny 编译（条件顺序 ＋ 真检索）', () => {
  it('B-J1-1 条件顺序：第 0 敏感度 IN、第 1 pkb_domain IN scopes、随后逐 deny NOT_EQ；degraded=false', () => {
    writeRolePack();
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j1');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const filter = built.filter;
    expect(filter.degraded).toBe(false);
    // 顺序是判据：sensitivity 恒第 0（L4 侧 fail-open 短路防线）、scope 第 1、deny 追加在后
    expect(filter.conditions).toHaveLength(3);
    expect(filter.conditions[0]).toEqual({ field: 'access.sensitivity', operator: 'IN', value: ['normal'] });
    expect(filter.conditions[1]).toEqual({ field: 'pkb_domain', operator: 'IN', value: [...SCOPES] });
    expect(filter.conditions[2]).toEqual({ field: 'pkb_domain', operator: 'NOT_EQ', value: DENIES[0] });
    expect(filter.scopes).toEqual([...SCOPES]);
    expect(filter.sensitivity).toEqual(['normal']);
  });

  it('B-J1-2 真检索：scope 内条目返回；域外条目与 deny 域条目都不返回', () => {
    writeRolePack();
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j1');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { store, close } = makeStore();
    try {
      const a = insertChunk(store, 'chunk-a-statements', 'finance.statements');
      insertChunk(store, 'chunk-b-market', 'market.pricing');
      insertChunk(store, 'chunk-c-salaries', 'finance.salaries');
      expect(searchIds(store, built.filter)).toEqual([a]);
    } finally {
      close();
    }
  });

  it('B-J1-3 反例（删 scope 条件）：域外条目 market.pricing 立即可见 ⇒ 证明 scope 条件是承重的', () => {
    writeRolePack();
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j1');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { store, close } = makeStore();
    try {
      insertChunk(store, 'chunk-a-statements', 'finance.statements');
      const b = insertChunk(store, 'chunk-b-market', 'market.pricing');
      const c = insertChunk(store, 'chunk-c-salaries', 'finance.salaries');
      // 反例 = 只保留敏感度＋deny，**去掉 pkb_domain IN scopes**（= 改坏实现的条件）
      const withoutScope = built.filter.conditions.filter((c) => c.field !== 'pkb_domain' || c.operator !== 'IN');
      const ids = store
        .search('现金流', { conditions: withoutScope }, 10)
        .results.map((r) => r.id)
        .sort();
      expect(ids).toContain(b);     // 域外可见 ⇒ 上面"只返 A"才有牙
      expect(ids).not.toContain(c); // deny 仍在生效
    } finally {
      close();
    }
  });

  it('B-J1-4 多 scope／多 deny：条件数 = 1 敏感度 ＋ 1 scope ＋ N deny，deny 顺序保留', () => {
    writeRolePack({
      scopeYaml: `roleId: ${ROLE}\nversion: 2\nscopes:\n  - id: finance.statements\n  - id: finance.reports\ndeny:\n  - id: finance.salaries\n  - id: finance.bonus\n`,
    });
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j1');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const filter = built.filter;
    expect(filter.conditions).toHaveLength(4);
    expect(conditionsOf(filter, 'pkb_domain')).toEqual([
      { operator: 'IN', value: ['finance.statements', 'finance.reports'] },
      { operator: 'NOT_EQ', value: 'finance.salaries' },
      { operator: 'NOT_EQ', value: 'finance.bonus' },
    ]);
    const { store, close } = makeStore();
    try {
      const a = insertChunk(store, 'chunk-a', 'finance.statements');
      const b = insertChunk(store, 'chunk-b', 'finance.reports');
      insertChunk(store, 'chunk-c', 'finance.salaries');
      insertChunk(store, 'chunk-d', 'finance.bonus');
      insertChunk(store, 'chunk-e', 'market.pricing');
      expect(searchIds(store, filter)).toEqual([a, b].sort());
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B-J2 敏感度（认证面同源）
// ══════════════════════════════════════════════════════════════════════════════

describe('B-J2 · 敏感度用认证面唯一漏斗（档位∩grants）', () => {
  it('B-J2-1 非 admin 档位 ∩ grants ⇒ 字面值 [normal]（且与 allowedSensitivitiesByGrants 同值）', () => {
    writeRolePack();
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j2');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // 字面值断言（不同义反复）；同源对照单独一行给出证据
    expect(built.filter.sensitivity).toEqual(['normal']);
    expect(built.filter.conditions[0]).toEqual({ field: 'access.sensitivity', operator: 'IN', value: ['normal'] });
    expect(built.filter.sensitivity).toEqual(allowedSensitivitiesByGrants(ROLE, 'normal', 'org-b-j2'));
  });

  it('B-J2-2 真检索：normal 条目可见、sensitive 条目不可见（同 scope 同文本）', () => {
    writeRolePack();
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j2');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { store, close } = makeStore();
    try {
      const normal = insertChunk(store, 'chunk-normal', 'finance.statements', 'normal');
      insertChunk(store, 'chunk-sensitive', 'finance.statements', 'sensitive');
      expect(searchIds(store, built.filter)).toEqual([normal]);
    } finally {
      close();
    }
  });

  it('B-J2-3 反例（换 sensitivityWhitelistFromGrants 的宽集合）：sensitive 条目立即可见 ⇒ 漏斗有牙', () => {
    // 给该角色一条「读全库」项 ⇒ whitelist 侧 = 三级（比档位∩grants 更宽）
    writeRolePack({ grants: ['knowledge.*.read'] });
    writeApprovalRecord();
    const items = resolveGrants(ROLE, { root, tenantId: null }).items;
    const wider = sensitivityWhitelistFromGrants(items) ?? allowedSensitivities(ROLE, 'normal');
    expect(wider).toEqual(['normal', 'sensitive', 'restricted']); // 反例集合确实更宽

    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j2');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.filter.sensitivity).toEqual(['normal']); // 本实现仍被档位收窄

    const { store, close } = makeStore();
    try {
      const normal = insertChunk(store, 'chunk-normal', 'finance.statements', 'normal');
      const sensitive = insertChunk(store, 'chunk-sensitive', 'finance.statements', 'sensitive');
      // 用宽集合建条件（= 改坏实现的形态）⇒ sensitive 可见
      const wide = store
        .search('现金流', {
          conditions: [
            { field: 'access.sensitivity', operator: 'IN', value: wider },
            { field: 'pkb_domain', operator: 'IN', value: [...SCOPES] },
          ],
        }, 10)
        .results.map((r) => r.id)
        .sort();
      expect(wide).toEqual([normal, sensitive].sort());
      // 本实现下 sensitive 不可见
      expect(searchIds(store, built.filter)).toEqual([normal]);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B-J4 fail-closed
// ══════════════════════════════════════════════════════════════════════════════

describe('B-J4 · 不可判定 ⇒ 拒绝型（pkb_domain IN []）⇒ 0 行', () => {
  /** 断言：拒绝型形状（恰 1 条条件，且是 pkb_domain IN []）＋ 真检索 0 行 */
  function expectRejectedAndEmpty(filter: RoleKnowledgeFilter): void {
    expect(filter.degraded).toBe(true);
    expect(filter.conditions).toEqual([{ field: 'pkb_domain', operator: 'IN', value: [] }]);
    expect(filter.scopes).toEqual([]);
    const { store, close } = makeStore();
    try {
      insertChunk(store, 'chunk-a', 'finance.statements');
      insertChunk(store, 'chunk-b', 'market.pricing');
      expect(searchIds(store, filter)).toEqual([]);
    } finally {
      close();
    }
  }

  it('B-J4-1 scope 文件缺件 ⇒ 拒绝型（0 行，不回落全库）', () => {
    writeRolePack({ scopeYaml: null });
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j4');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectRejectedAndEmpty(built.filter);
  });

  it('B-J4-2 scope 空文档（无 scopes）⇒ 拒绝型（0 行）', () => {
    writeRolePack({ scopeYaml: `roleId: ${ROLE}\nversion: 2\n` });
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j4');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectRejectedAndEmpty(built.filter);
  });

  it('B-J4-3 scope 坏 YAML ⇒ 拒绝型（0 行）', () => {
    writeRolePack({ scopeYaml: `roleId: ${ROLE}\nversion: 2\nscopes: [unclosed\n` });
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j4');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectRejectedAndEmpty(built.filter);
  });

  it('B-J4-4 审批缺失（pending）⇒ 拒绝型（0 行；未审批 ≠ 不限制）', () => {
    writeRolePack();
    // 不写审批记录
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j4');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectRejectedAndEmpty(built.filter);
  });

  it('B-J4-5 未打标条目（pkb_domain = NULL）恒不可见（fail-closed，不回落全库）', () => {
    writeRolePack();
    writeApprovalRecord();
    const built = buildRoleKnowledgeFilter(ROLE, 'org-b-j5');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { store, close } = makeStore();
    try {
      const labeled = insertChunk(store, 'chunk-labeled', 'finance.statements');
      insertChunk(store, 'chunk-unlabeled', null);
      expect(searchIds(store, built.filter)).toEqual([labeled]);
    } finally {
      close();
    }
  });
});
