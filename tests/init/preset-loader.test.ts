/**
 * tests/init/preset-loader.test.ts — `src/init/preset-loader.ts` 配对测试（铁律 48）
 *
 * 覆盖三路径（每路径 ≥1 真断言）：
 *   正常：临时内容根 ＋ 齐备 **v3** 角色包 ⇒ roles 含该角色、pieces 齐、degraded=false、
 *         `schemaValid:true`、`schemaVersion:3`、`validation.refsChecked > 0`；
 *         **审批门（#1075 P2-1）**：记录匹配 ⇒ `approval.status='approved'` ＋ 进 `usable[]`
 *   降级：内容根缺失 / roles 目录缺失 / 角色缺件 / **v3 结构或 refs 对账不过**（非法 JSON／schemaVersion 缺／
 *         $schema 错／refs 悬空／pieces 少一项）⇒ degraded=true + errors **点名**，且**不抛**（J3 契约）；
 *         **审批 `unverified` ⇒ 不生效 ＋ degraded=true ＋ errors 点名 `ROLE_PACK_APPROVAL_UNVERIFIED`**；
 *         无记录 ⇒ `pending`：不生效但**不计 degraded**（§4.5-C1 口径）
 *   边界：空 roles 目录 / 隐藏项 / 非目录项 / 零字节件 / "仅注释文件"（KL-T1-1）/ 覆盖缝 SYNOVA_PRESETS_ROOT /
 *         **N4（无 contentHash 不判审批）** / **J10（批准撤销即时生效，不调 clearPresetCache）**
 *
 * 🔴 隔离手法：用 `SYNOVA_PRESETS_ROOT` 指向 `tmpdir()` 夹具（仓库形状：`<fixture>/extensions/presets`），
 *   **不读也不改**仓库真实内容面；审批记录写在 `<fixture>/.synova/approvals`（= `resolve(root,'../..')`
 *   派生 —— 与生产 `approvalsRoot` 同一规则），**禁写真仓 `.synova/`**，afterEach 删整个 fixture。
 * 🔴 夹具自 #1075 P1-a 起迁 **v3**；自 P2-1 起角色 id 一律用**非出厂** id（`ops*`）：
 *   出厂三包只信代码锚（记录不得覆盖），测试无法用记录改写出厂批准 ⇒ 凡需"审批通过"的夹具必须是非出厂岗位。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  clearPresetCache,
  listRolePacks,
  loadRolePacks,
  resolveRoleKnowledgeScope,
} from '../../src/init/preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';

/** 六件（与 loader 的 `EXPECTED_PIECES` 同源语义；顺序即契约顺序） */
const PIECES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/** 最小合法 **v3** manifest（可被各用例覆盖） */
function minimalManifest(roleId: string): Record<string, unknown> {
  return {
    $schema: '../../schema/role-pack-v3.schema.json',
    schemaVersion: 3,
    name: `role-${roleId}`,
    version: '2.0.0',
    type: 'role-preset',
    displayName: roleId,
    entryPoint: './context-manifest.yaml',
    roleId,
    pieces: [...PIECES],
    refs: [{ kind: 'scope', name: `${roleId}.demo` }],
  };
}

/** 五件内容件的最小合法载荷（refs 与 contexts 对账一致） */
function minimalFiles(roleId: string): Readonly<Record<string, string>> {
  return {
    'knowledge-scope.yaml': `roleId: ${roleId}\nversion: 2\nscopes:\n  - id: ${roleId}.demo\n`,
    'context-manifest.yaml':
      `roleId: ${roleId}\nversion: 2\ncontexts:\n  - id: ${roleId}.demo\n    label: demo\n` +
      `    source: knowledge-scope.yaml#${roleId}.demo\nprompt:\n  systemAddendum: |\n    demo\n`,
    'output-template.ref': 'templateId: demo\nsections:\n  - id: summary\n    title: 摘要\n    must:\n      - 有结论\n',
    'capabilities.yaml': `roleId: ${roleId}\nversion: 2\ncapabilities:\n  - id: capability.demo\n    label: demo\n    enabled: true\n`,
    'acceptance-criteria.yaml': `roleId: ${roleId}\nversion: 2\ncriteria:\n  - id: ac.demo\n    text: demo\n`,
  };
}

/**
 * 内容根（`SYNOVA_PRESETS_ROOT` 指向它）—— 仓库形状：`<fixture>/extensions/presets`。
 * 审批根 = `resolve(root,'../..')/.synova/approvals` = `<fixture>/.synova/approvals`（生产同规则）。
 */
let fixture: string;
let root: string;
const ORIGINAL_ENV = process.env['SYNOVA_PRESETS_ROOT'];

/** 审批租户字段（缺省 = `config.orgId` = `SYNOVA_ORG_ID || 'default'`；夹具不设 env ⇒ 'default'） */
const APPROVAL_ORG_ID = 'default';
const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_impl_loader';
const APPROVER_ROLE = 'super-admin';

/** 生产 `approvalsRoot` 同规则：`<内容根>/../..` = fixture 根 ⇒ `<fixture>/.synova/approvals` */
function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

/** 角色目录六件的生产指纹（夹具侧：用生产纯核算"记录应对应的 hash"，不是断言期望值） */
function roleContentHash(roleId: string): string {
  const dir = join(root, 'roles', roleId);
  const pieces = ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(dir, name)) }));
  return computeRolePackContentHash(pieces);
}

/**
 * 记录自绑定 id（规格 D9 公式的夹具侧实现；**被测对象是 loader 的折叠行为**，不是本公式 ——
 * 公式本身在 `tests/init/role-pack-approval.test.ts` 由 T2 钉死）。
 */
function selfBoundApprovalId(input: {
  readonly orgId: string;
  readonly roleId: string;
  readonly contentHash: string;
  readonly scope: 'content' | 'content+permissions';
}): string {
  const material = [
    input.orgId,
    input.roleId,
    input.contentHash,
    input.scope,
    APPROVED_AT,
    APPROVER_ID,
    APPROVER_ROLE,
  ].join('|');
  return `apv1:${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * 写一条审批记录（P3 写入器的测试替身；`contentHash` 缺省 = 按当前内容算）。
 * 🔴 `contentHash` 显式传入时用于造"记录与内容不符"的 unverified 夹具。
 */
function writeApprovalRecord(
  roleId: string,
  opts: { readonly contentHash?: string; readonly scope?: 'content' | 'content+permissions'; readonly orgId?: string } = {},
): void {
  const contentHash = opts.contentHash ?? roleContentHash(roleId);
  const scope = opts.scope ?? 'content+permissions';
  const orgId = opts.orgId ?? APPROVAL_ORG_ID;
  mkdirSync(approvalsRoot(), { recursive: true });
  writeFileSync(
    join(approvalsRoot(), `${roleId}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        roleId,
        orgId,
        approvalId: selfBoundApprovalId({ orgId, roleId, contentHash, scope }),
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

/** 撤销（删记录）—— J10 的 fail-open 检测动作 */
function removeApprovalRecord(roleId: string): void {
  rmSync(join(approvalsRoot(), `${roleId}.json`), { force: true });
}

/** 造一个齐备的 **v3** 角色目录（可省略件／覆盖 manifest／覆盖单件内容） */
function writeRole(
  rolesRoot: string,
  roleId: string,
  overrides: {
    readonly omit?: readonly string[];
    readonly manifest?: Record<string, unknown>;
    readonly files?: Readonly<Record<string, string>>;
  } = {},
): void {
  const dir = join(rolesRoot, roleId);
  mkdirSync(dir, { recursive: true });
  const manifest = overrides.manifest ?? minimalManifest(roleId);
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const files = { ...minimalFiles(roleId), ...(overrides.files ?? {}) };
  for (const piece of PIECES) {
    if (piece === 'manifest.json') continue;
    if (overrides.omit?.includes(piece) === true) continue;
    writeFileSync(join(dir, piece), files[piece], 'utf8');
  }
}

/**
 * 造一个"仅注释文件"角色目录（原夹具形态；KL-T1-1 语义的**单独降级用例**用）。
 * 空文档 = 未声明（不计内容错），但 manifest.json 不是 JSON ⇒ 结构问题必须点名。
 */
function writeCommentRole(rolesRoot: string, roleId: string): void {
  const dir = join(rolesRoot, roleId);
  mkdirSync(dir, { recursive: true });
  for (const piece of PIECES) {
    writeFileSync(join(dir, piece), `# ${roleId}/${piece}\n`, 'utf8');
  }
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'preset-loader-'));
  root = join(fixture, 'extensions', 'presets');
  mkdirSync(root, { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (ORIGINAL_ENV === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_ENV;
  clearPresetCache();
});

describe('preset-loader — 正常路径', () => {
  it('齐备的 v3 角色包（非出厂 id ＋ 匹配记录）⇒ roles 含该角色、六件齐、degraded=false、approved 可进 usable', () => {
    mkdirSync(join(root, 'roles'), { recursive: true });
    // 出厂三包只信代码锚 ⇒ "审批通过"的夹具必须用非出厂 id（ops），否则记录不得覆盖锚
    writeRole(join(root, 'roles'), 'ops');
    writeApprovalRecord('ops');

    const report = loadRolePacks();
    expect(report.degraded, report.errors.join('; ')).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.roles.map((r) => r.roleId)).toEqual(['ops']);
    expect(report.roles[0]?.missing).toEqual([]);
    expect([...(report.roles[0]?.pieces ?? [])].sort()).toEqual([...PIECES].sort());
    // #1075 P1-a additive 字段
    expect(report.roles[0]?.schemaVersion).toBe(3);
    expect(report.roles[0]?.schemaValid).toBe(true);
    expect(report.roles[0]?.validation.ok).toBe(true);
    expect(report.roles[0]?.validation.problems).toEqual([]);
    expect(report.roles[0]?.validation.refsChecked).toBe(2); // 1 条 refs ＋ 1 条 content source
    expect(report.roles[0]?.validation.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // #1075 P2-1 additive 字段
    expect(report.roles[0]?.approval.status).toBe('approved');
    expect(report.usable).toEqual(['ops']);
  });

  it('多角色 ⇒ roleId 字典序稳定（判据可比对）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'sales');
    writeRole(rolesRoot, 'finance');
    writeRole(rolesRoot, 'hr');

    expect(listRolePacks()).toEqual(['finance', 'hr', 'sales']);
  });

  it('listRolePacks() 零参返回角色 id 清单（探针观测面同源）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');

    expect(listRolePacks()).toContain('finance');
  });
});

describe('preset-loader — 降级路径', () => {
  it('内容根不存在 ⇒ degraded=true、roles 空、**不抛**（ENOENT = 正常默认，不进 errors）', () => {
    process.env['SYNOVA_PRESETS_ROOT'] = join(root, '__absent__');

    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles).toEqual([]);
    expect(report.usable).toEqual([]); // #1075 P2-1：additive 字段在早期返回也必须就位
    expect(report.errors).toEqual([]); // ENOENT 不算错误
  });

  it('roles 子目录缺失 ⇒ degraded=true、roles 空、不抛', () => {
    // root 存在但无 roles/
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles).toEqual([]);
    expect(report.usable).toEqual([]);
  });

  it('角色缺件 ⇒ degraded=true 且 errors 逐条点名缺哪几件（不静默）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance', { omit: ['capabilities.yaml', 'acceptance-criteria.yaml'] });

    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles[0]?.missing).toEqual(['capabilities.yaml', 'acceptance-criteria.yaml']);
    expect(report.errors.join(' ')).toContain('finance');
    expect(report.errors.join(' ')).toContain('capabilities.yaml');
  });

  it('空 roles 目录 ⇒ degraded=true（无角色即降级），但无 error', () => {
    mkdirSync(join(root, 'roles'), { recursive: true });

    const report = loadRolePacks();
    expect(report.roles).toEqual([]);
    expect(report.degraded).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('"仅注释文件"（KL-T1-1）⇒ 空文档不计内容错，但 manifest 坏 ⇒ 结构问题点名、不抛', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeCommentRole(rolesRoot, 'finance');

    expect(() => loadRolePacks()).not.toThrow();
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    // 文件都在且非空 ⇒ 不算缺件；空文档 = 未声明（KL-T1-1）
    expect(report.roles[0]?.missing).toEqual([]);
    expect(report.roles[0]?.knowledgeScope.declared).toBe(false);
    // 但 manifest.json 不是 JSON ⇒ v3 结构问题必须点名（不许因"仅注释"而静默）
    const text = report.errors.join(' ');
    expect(text).toContain('finance');
    expect(text).toContain('ROLE_PACK_MANIFEST_UNREADABLE');
    expect(text).toContain('manifest.json');
    expect(report.roles[0]?.schemaValid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// #1075 P1-a：schema 失败路径（每条都断言 errors 点名且**不抛** —— J3 契约）
// ══════════════════════════════════════════════════════════════════════════════

describe('preset-loader — v3 schema 失败路径（不抛 + errors 点名）', () => {
  it('manifest 非法 JSON ⇒ ROLE_PACK_MANIFEST_UNREADABLE、点名 manifest.json、不抛', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');
    writeFileSync(join(rolesRoot, 'finance', 'manifest.json'), '{ not json }\n', 'utf8');

    expect(() => loadRolePacks()).not.toThrow();
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_MANIFEST_UNREADABLE');
    expect(text).toContain('manifest.json');
    expect(text).toContain('JSON');
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('schemaVersion 缺失 ⇒ ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED、点名"缺失"、不抛', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    const manifest = minimalManifest('finance');
    delete manifest['schemaVersion'];
    writeRole(rolesRoot, 'finance', { manifest });

    expect(() => loadRolePacks()).not.toThrow();
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED');
    expect(text).toContain('schemaVersion 缺失');
    expect(report.roles[0]?.schemaVersion).toBeNull();
  });

  it('$schema 错（仓外 URL）⇒ ROLE_PACK_SCHEMA_POINTER_INVALID、点名实际值、不抛', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    const manifest = minimalManifest('finance');
    manifest['$schema'] = 'https://synova.dev/schemas/extension-manifest-v1.json';
    writeRole(rolesRoot, 'finance', { manifest });

    expect(() => loadRolePacks()).not.toThrow();
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_SCHEMA_POINTER_INVALID');
    expect(text).toContain('https://synova.dev/schemas/extension-manifest-v1.json');
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('refs 悬空（指向不存在文件，内容侧同步声明）⇒ ROLE_PACK_REF_MISSING、点名 path、不抛', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    const missingPath = 'extensions/ontology/__absent__/nope.json';
    const manifest = minimalManifest('finance');
    manifest['refs'] = [
      { kind: 'scope', name: 'finance.demo' },
      { kind: 'file', path: missingPath },
    ];
    writeRole(rolesRoot, 'finance', {
      manifest,
      files: {
        'context-manifest.yaml':
          'roleId: finance\nversion: 2\ncontexts:\n  - id: finance.demo\n    label: demo\n' +
          '    source: knowledge-scope.yaml#finance.demo\n  - id: finance.onto\n    label: 本体\n' +
          `    source: ${missingPath}\nprompt:\n  systemAddendum: |\n    demo\n`,
      },
    });

    expect(() => loadRolePacks()).not.toThrow();
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_REF_MISSING');
    expect(text).toContain(missingPath);
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('pieces 少一项（声明 5 项 vs 磁盘 6 件）⇒ MANIFEST_INVALID 点名 pieces、不抛', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    const manifest = minimalManifest('finance');
    manifest['pieces'] = PIECES.filter((piece) => piece !== 'acceptance-criteria.yaml');
    writeRole(rolesRoot, 'finance', { manifest });

    expect(() => loadRolePacks()).not.toThrow();
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_MANIFEST_INVALID');
    expect(text).toContain('pieces');
    expect(report.roles[0]?.schemaValid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// #1075 P2-1：审批门（装载期折叠 ＋ 请求路径 fail-closed ＋ 缓存即时生效）
// ══════════════════════════════════════════════════════════════════════════════

describe('preset-loader — #1075 P2-1 审批门（装载期）', () => {
  it('审批通过（记录匹配）⇒ usable 含该包；permissionsPending 按 capabilities[].tool 口径', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    // (a) 记录 scope='content' 且包内**无** tool 声明 ⇒ permissionsPending=false
    writeRole(rolesRoot, 'ops-plain');
    writeApprovalRecord('ops-plain', { scope: 'content' });
    // (b) 记录 scope='content' 且包内**有** tool 声明 ⇒ permissionsPending=true（权限仍未批）
    writeRole(rolesRoot, 'ops-tools', {
      files: {
        'capabilities.yaml':
          'roleId: ops-tools\nversion: 2\ncapabilities:\n  - id: capability.tool\n    label: tool\n' +
          '    enabled: true\n    tool: knowledge.search\n',
      },
    });
    writeApprovalRecord('ops-tools', { scope: 'content' });

    const report = loadRolePacks();
    expect(report.degraded, report.errors.join('; ')).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.usable).toEqual(['ops-plain', 'ops-tools']);
    const plain = report.roles.find((role) => role.roleId === 'ops-plain');
    const tools = report.roles.find((role) => role.roleId === 'ops-tools');
    expect(plain?.approval.status).toBe('approved');
    expect(plain?.approval.scope).toBe('content');
    expect(plain?.approval.permissionsPending).toBe(false);
    expect(tools?.approval.status).toBe('approved');
    expect(tools?.approval.permissionsPending).toBe(true);
  });

  it('无记录（非出厂）⇒ pending：不生效、不进 usable、**不计 degraded**、点名 ROLE_PACK_APPROVAL_PENDING', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'ops-pending'); // 不写记录

    const report = loadRolePacks();
    expect(report.roles[0]?.approval.status).toBe('pending');
    expect(report.roles[0]?.approval.code).toBe('ROLE_PACK_APPROVAL_PENDING');
    expect(report.usable).toEqual([]);
    // §4.5-C1 口径：pending = 默认状态，**不计 degraded**、不进 errors
    expect(report.degraded).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it('记录与内容不符（contentHash 全 0）⇒ unverified：不进 usable、degraded=true、errors 点名两个 code', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'ops-tampered');
    writeApprovalRecord('ops-tampered', { contentHash: '0'.repeat(64) });

    const report = loadRolePacks();
    expect(report.roles[0]?.approval.status).toBe('unverified');
    expect(report.roles[0]?.approval.code).toBe('E_APPROVAL_CONTENT_CHANGED');
    expect(report.usable).toEqual([]);
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_APPROVAL_UNVERIFIED'); // 装载期 problem 码
    expect(text).toContain('E_APPROVAL_CONTENT_CHANGED'); // 判定侧 typed code
  });

  it('N4：包校验未通过（无 contentHash）⇒ **不判审批**，approval 沿用 validation 首个 code', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    const manifest = minimalManifest('ops-badschema');
    manifest['schemaVersion'] = 2; // v3 契约拒收 ⇒ validateRolePackDir 早退，无 contentHash
    writeRole(rolesRoot, 'ops-badschema', { manifest });
    // 🔴 故意**写**一条匹配记录：若实现无视 N4 去判审批，会得到 approved/pending；
    //    实际上"无 hash 不判"⇒ 只能沿用 validation 的 code（不是 E_APPROVAL_*）
    writeApprovalRecord('ops-badschema');

    const report = loadRolePacks();
    const pack = report.roles[0];
    expect(pack?.approval.status).toBe('unverified');
    expect(pack?.approval.code).toBe('ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED');
    expect(pack?.approval.code).not.toMatch(/^E_APPROVAL_/);
    expect(pack?.validation.contentHash).toBeUndefined();
    expect(report.usable).toEqual([]);
    expect(report.degraded).toBe(true);
    // N4 的归因已由 validation 的 code 承担（一包一码；不重复追加审批错误行）——
    // 若实现无视 N4 去判审批，会落成 approved（记录匹配）/E_APPROVAL_*，上面的断言即红。
    expect(report.errors.join(' ')).toContain('ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED');
    expect(report.errors.join(' ')).not.toContain('ROLE_PACK_APPROVAL_UNVERIFIED');
    expect(report.errors.join(' ')).not.toContain('ROLE_PACK_APPROVAL_PENDING');
  });
});

describe('preset-loader — #1075 P2-1 请求路径（J9a / J10）', () => {
  it('J10：批准／撤销**即时**生效（同一进程，**不调** clearPresetCache）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'ops-j10');

    // 1) 无记录 ⇒ pending ⇒ fail-closed（J9a 口径：degraded 而不是 declared:false/degraded:false）
    const pending = resolveRoleKnowledgeScope('ops-j10');
    expect(pending.degraded).toBe(true);
    expect(pending.problems.join(' ')).toContain('ROLE_PACK_APPROVAL_PENDING');

    // 2) 写记录（不碰任何内容文件）⇒ 下一次调用即批准（**不经 clearPresetCache**）
    writeApprovalRecord('ops-j10');
    const approved = resolveRoleKnowledgeScope('ops-j10');
    expect(approved.degraded, approved.problems.join('; ')).toBe(false);
    expect(approved.declared).toBe(true);
    expect(approved.scopeIds).toEqual(['ops-j10.demo']);

    // 3) 删记录（撤销）⇒ 下一次调用立即失败关闭（fail-open 检测）
    removeApprovalRecord('ops-j10');
    const revoked = resolveRoleKnowledgeScope('ops-j10');
    expect(revoked.degraded).toBe(true);
    expect(revoked.scopeIds).toEqual([]);
    expect(revoked.problems.join(' ')).toContain('ROLE_PACK_APPROVAL_PENDING');

    // 4) 再次批准 ⇒ 立即恢复（同一进程，缓存按审查指纹自失效）
    writeApprovalRecord('ops-j10');
    const reapproved = resolveRoleKnowledgeScope('ops-j10');
    expect(reapproved.degraded).toBe(false);
    expect(reapproved.scopeIds).toEqual(['ops-j10.demo']);
  });

  it('J9a：unverified ⇒ degraded:true ＋ problems 含 ROLE_PACK_APPROVAL_UNVERIFIED（不是 I-C4）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'ops-unverified');
    writeApprovalRecord('ops-unverified', { orgId: 'other-org' }); // 租户不符 ⇒ ORG_MISMATCH

    const decl = resolveRoleKnowledgeScope('ops-unverified');
    expect(decl.degraded).toBe(true);
    expect(decl.declared).toBe(false);
    expect(decl.scopeIds).toEqual([]);
    expect(decl.problems.join(' ')).toContain('ROLE_PACK_APPROVAL_UNVERIFIED');
    expect(decl.problems.join(' ')).toContain('E_APPROVAL_ORG_MISMATCH');
  });

  it('I-C4 不回退：角色目录不存在 ⇒ declared:false, degraded:false（不追加 scope 维）', () => {
    const decl = resolveRoleKnowledgeScope('manager');
    expect(decl.declared).toBe(false);
    expect(decl.degraded).toBe(false);
    expect(decl.problems).toEqual([]);
  });
});

describe('preset-loader — 边界', () => {
  it('忽略隐藏项与非目录项（.DS_Store / 散落文件不成为角色）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');
    writeFileSync(join(rolesRoot, '.DS_Store'), 'x', 'utf8');
    writeFileSync(join(rolesRoot, 'README.md'), '# not a role\n', 'utf8');

    const report = loadRolePacks();
    expect(report.roles.map((r) => r.roleId)).toEqual(['finance']);
  });

  it('零字节件视为缺失（非空判定）', () => {
    const rolesRoot = join(root, 'roles');
    mkdirSync(rolesRoot, { recursive: true });
    writeRole(rolesRoot, 'finance');
    writeFileSync(join(rolesRoot, 'finance', 'capabilities.yaml'), '', 'utf8');

    const report = loadRolePacks();
    expect(report.roles[0]?.missing).toEqual(['capabilities.yaml']);
  });

  it('clearPresetCache() 幂等且不抛（无缓存可清的显式声明）', () => {
    expect(() => {
      clearPresetCache();
      clearPresetCache();
    }).not.toThrow();
  });

  it('真实内容面（extensions/presets）在本仓可用 —— 3 个出厂包 degraded:false／errors:[]／missing:[]', () => {
    // 本条**只读**真实内容面（不写不删），确认出厂三包的 v3 契约与 loader 契约一致
    delete process.env['SYNOVA_PRESETS_ROOT'];
    clearPresetCache();
    const report = loadRolePacks();
    const ids = report.roles.map((r) => r.roleId);
    expect(ids).toContain('finance');
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(report.degraded, report.errors.join('; ')).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.roles.every((r) => r.missing.length === 0)).toBe(true);
    expect(report.roles.every((r) => r.schemaValid)).toBe(true);
    // #1075 P2-1：出厂三包靠代码锚批准（记录侧为空也必须 approved）
    expect(report.roles.every((r) => r.approval.status === 'approved')).toBe(true);
  });

  it('出厂三包真跑三次：每次都 approved、usable 含三包、无降级（真实内容面只读）', () => {
    delete process.env['SYNOVA_PRESETS_ROOT'];
    clearPresetCache();
    for (let round = 1; round <= 3; round += 1) {
      const report = loadRolePacks();
      expect(report.degraded, `round=${String(round)} errors=${report.errors.join('; ')}`).toBe(false);
      expect(report.errors).toEqual([]);
      expect(report.usable).toEqual(['finance', 'hr', 'sales']);
      for (const pack of report.roles) {
        expect({ round, roleId: pack.roleId, status: pack.approval.status }).toEqual({
          round,
          roleId: pack.roleId,
          status: 'approved',
        });
        expect(pack.approval.scope).toBe('content+permissions');
        expect(pack.approval.permissionsPending).toBe(false);
        expect(pack.validation.ok).toBe(true);
        expect(pack.validation.contentHash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
