/**
 * tests/init/preset-loader.test.ts — `src/init/preset-loader.ts` 配对测试（铁律 48）
 *
 * 覆盖三路径（每路径 ≥1 真断言）：
 *   正常：临时内容根 ＋ 齐备 **v2** 角色包 ⇒ roles 含该角色、pieces 齐、degraded=false、
 *         `schemaValid:true`、`schemaVersion:2`、`validation.refsChecked > 0`
 *   降级：内容根缺失 / roles 目录缺失 / 角色缺件 / **v2 结构或 refs 对账不过**（非法 JSON／schemaVersion 缺／
 *         $schema 错／refs 悬空／pieces 少一项）⇒ degraded=true + errors **点名**，且**不抛**（J3 契约）
 *   边界：空 roles 目录 / 隐藏项 / 非目录项 / 零字节件 / "仅注释文件"（KL-T1-1）/ 覆盖缝 SYNOVA_PRESETS_ROOT
 *
 * 🔴 隔离手法：用 `SYNOVA_PRESETS_ROOT` 指向 `tmpdir()` 夹具，**不读也不改**仓库真实内容面
 *   （`extensions/presets/**` 属内容面交付物，本卡只改三个出厂 manifest —— 另有一条"真实内容面"用例**只读**）。
 * 🔴 夹具自 #1075 P1-a 起迁 **v2**：manifest 合法 v2 JSON ＋ 五件内容件最小合法载荷；六件与 refs 对账一致。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearPresetCache, listRolePacks, loadRolePacks } from '../../src/init/preset-loader';

/** 六件（与 loader 的 `EXPECTED_PIECES` 同源语义；顺序即契约顺序） */
const PIECES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/** 最小合法 v2 manifest（可被各用例覆盖） */
function minimalManifest(roleId: string): Record<string, unknown> {
  return {
    $schema: '../../schema/role-pack-v2.schema.json',
    schemaVersion: 2,
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

/** 造一个齐备的 **v2** 角色目录（可省略件／覆盖 manifest／覆盖单件内容） */
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
 * 空文档 = 未声明（不计内容错），但 manifest.json 不是 JSON ⇒ 结构问题必须点名（v2 契约）。
 */
function writeCommentRole(rolesRoot: string, roleId: string): void {
  const dir = join(rolesRoot, roleId);
  mkdirSync(dir, { recursive: true });
  for (const piece of PIECES) {
    writeFileSync(join(dir, piece), `# ${roleId}/${piece}\n`, 'utf8');
  }
}

let root: string;
const ORIGINAL_ENV = process.env['SYNOVA_PRESETS_ROOT'];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'preset-loader-'));
  process.env['SYNOVA_PRESETS_ROOT'] = root;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (ORIGINAL_ENV === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_ENV;
});

describe('preset-loader — 正常路径', () => {
  it('齐备的 v2 角色包 ⇒ roles 含该角色、六件齐、degraded=false、schemaValid=true', () => {
    mkdirSync(join(root, 'roles'), { recursive: true });
    writeRole(join(root, 'roles'), 'finance');

    const report = loadRolePacks();
    expect(report.degraded).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.roles.map((r) => r.roleId)).toEqual(['finance']);
    expect(report.roles[0]?.missing).toEqual([]);
    expect([...(report.roles[0]?.pieces ?? [])].sort()).toEqual([...PIECES].sort());
    // #1075 P1-a additive 字段
    expect(report.roles[0]?.schemaVersion).toBe(2);
    expect(report.roles[0]?.schemaValid).toBe(true);
    expect(report.roles[0]?.validation.ok).toBe(true);
    expect(report.roles[0]?.validation.problems).toEqual([]);
    expect(report.roles[0]?.validation.refsChecked).toBe(2); // 1 条 refs ＋ 1 条 content source
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
    expect(report.errors).toEqual([]); // ENOENT 不算错误
  });

  it('roles 子目录缺失 ⇒ degraded=true、roles 空、不抛', () => {
    // root 存在但无 roles/
    const report = loadRolePacks();
    expect(report.degraded).toBe(true);
    expect(report.roles).toEqual([]);
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
    // 但 manifest.json 不是 JSON ⇒ v2 结构问题必须点名（不许因"仅注释"而静默）
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

describe('preset-loader — v2 schema 失败路径（不抛 + errors 点名）', () => {
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
    // 本条**只读**真实内容面（不写不删），确认出厂三包的 v2 契约与 loader 契约一致
    delete process.env['SYNOVA_PRESETS_ROOT'];
    const report = loadRolePacks();
    const ids = report.roles.map((r) => r.roleId);
    expect(ids).toContain('finance');
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(report.degraded, report.errors.join('; ')).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.roles.every((r) => r.missing.length === 0)).toBe(true);
    expect(report.roles.every((r) => r.schemaValid)).toBe(true);
  });
});
