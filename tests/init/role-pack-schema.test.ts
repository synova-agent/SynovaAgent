/**
 * tests/init/role-pack-schema.test.ts — 岗位包 v2 校验面判据（#1075 P1-a：J1／J2／J3＋边界）
 *
 * 断言对象 = **生产路径**（`src/init/role-pack-schema.ts` 纯核／IO 壳 ＋ 真 `loadRolePacks()`）——
 *   禁 grep 当验收（规格 §4 V-02）；grep 只作辅证。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J1 随仓契约＋schemaVersion：三包 schemaVersion/$schema 常量、$schema 指向仓内真实文件、
 *      schema ↔ zod 的 drift（required／properties 键集）、**字段级豁免清单恰好五件**、$defs 五项。
 *   J2 refs 三方双向相等：三包 refs **逐字**等于规格 §2.5-C 字面数组（期望值人工写死，禁用被测投影函数生成）、
 *      kind=file 路径在仓库根存在、kind=scope 命中同包 scopes[].id、pieces(6) === 磁盘文件集。
 *   J3 loader fail-loud 且**不抛**：六种非法输入各一条，每条 `expect(() => loadRolePacks()).not.toThrow()`
 *      ＋ errors **点名**（具体 path／scope id／code；禁只断非空）。
 *   C2 边界值：schemaVersion 0/-1/3、pieces 空/1/7、refs 空（content 无 source 时过）、scope id 长度 64。
 *
 * 🔴 反例（改坏必红）由规格 §4-J7 的独立脚本在临时 worktree 副本里跑，不留在本仓：
 *   J1-②（schema.required 删 refs ⇒ J1-④ 红）｜J2-②（改 knowledge-scope.yaml 的 scope id ⇒ J2-③ 红）。
 *
 * 隔离手法：J3/C2 用 `mkdtempSync` 临时内容根 ＋ `SYNOVA_PRESETS_ROOT` 注入；真实内容面用例**只读**。
 *
 * ═══ #1104（P1-c）新增 A／C 两组（本文件既有 28 条**一字不改**）═══
 *   A · repoRoot 不依赖 cwd（规格 §10-L14）：夹具根 = 临时"仓库形状"
 *       （`<fixture>/extensions/presets/roles/**` 三包六件 ＋ `<fixture>/extensions/ontology/**` 五个被引用本体件），
 *       `process.chdir('/tmp')` 后真 `loadRolePacks()` 仍三包全绿。机制 = loader 由内容根派生 repoRoot
 *       （`resolve(root,'../..')`）。🔴 **红线**：若 repoRoot 回退 `process.cwd()`，cwd=/tmp 下
 *       **必现 5 条 `ROLE_PACK_REF_MISSING`**（financial／person／team／client／channel）。
 *   C · 角色目录不可读（规格 §4.5-C1 的 `ROLE_PACK_DIR_UNREADABLE`）：`chmod 0o111`（有 x 无 r
 *       ⇒ 按名读 `manifest.json` 仍可、`readdir` 必 EACCES）⇒ problems 点名目录 ＋ **不抛** ＋ `log.warn`
 *       **运行期捕获**（`vi.mock('@synova/logger')`，范式同 `tests/l4/ontology-loader-param-bridge-1031.test.ts:41-49`；
 *       禁 grep 当验收）。🔴 不用 `chmod 000`：那会在读 manifest 阶段早退成
 *       `ROLE_PACK_MANIFEST_UNREADABLE`，测不到本码。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { load as parseYaml } from 'js-yaml';
import {
  CONTENT_PIECES,
  FIELD_LEVEL_VALIDATION_EXEMPT_PIECES,
  ROLE_PACK_PIECES,
  ROLE_PACK_SCHEMA_POINTER,
  ROLE_PACK_SCHEMA_VERSION,
  projectContextSource,
  reconcileRefs,
  validateManifestDoc,
  validateRolePackDir,
} from '../../src/init/role-pack-schema';
import { EXPECTED_PIECES, loadRolePacks } from '../../src/init/preset-loader';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（C 用例判据；范式同 tests/l4/ontology-loader-param-bridge-1031.test.ts:41-49）
// 文件级 mock：既有 28 条用例不读日志 ⇒ 直通空实现不破坏其断言（不改其一字）。
// ══════════════════════════════════════════════════════════════════════════════

const logCalls = vi.hoisted(() => [] as { level: string; meta?: unknown; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const make = (level: string) => (meta?: unknown, msg?: unknown) => {
    logCalls.push({ level, meta, msg });
  };
  const m = { info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug'), fatal: make('fatal') };
  return { logger: m, createLogger: () => m };
});


// ══════════════════════════════════════════════════════════════════════════════
// 夹具与小工具（本文件自足；不引第二套契约实现）
// ══════════════════════════════════════════════════════════════════════════════

/** 仓库根（vitest 的 cwd = 仓库根）—— 只读真实内容面用 */
const REPO_ROOT = process.cwd();
const ROLES_ROOT = join(REPO_ROOT, 'extensions', 'presets', 'roles');
const SCHEMA_PATH = join(REPO_ROOT, 'extensions', 'presets', 'schema', 'role-pack-v2.schema.json');
/** 出厂三包（写死；从磁盘目录名推导会让"删一个包"变成静默通过） */
const ROLE_IDS = ['finance', 'hr', 'sales'] as const;

/**
 * 规格 §2.5-C 的**字面数组**（人工写死；🔴 **禁止**用被测的 `projectContextSource()` 生成期望值 —— 防同源派生）。
 */
const EXPECTED_REFS: Readonly<Record<string, readonly unknown[]>> = {
  finance: [
    { kind: 'file', path: 'extensions/ontology/outcome/financial.json' },
    { kind: 'scope', name: 'finance.cost' },
    { kind: 'profile', name: 'business-plan' },
  ],
  hr: [
    { kind: 'file', path: 'extensions/ontology/resource/person.json' },
    { kind: 'file', path: 'extensions/ontology/resource/team.json' },
    { kind: 'scope', name: 'people.policy' },
    { kind: 'profile', name: 'business-plan' },
  ],
  sales: [
    { kind: 'file', path: 'extensions/ontology/resource/client.json' },
    { kind: 'file', path: 'extensions/ontology/resource/channel.json' },
    { kind: 'scope', name: 'market.pipeline' },
    { kind: 'profile', name: 'business-plan' },
  ],
};

/** `unknown` 收窄为记录（铁律 38 替代式：内联类型 ＋ 类型守卫，不用 `as` 断言） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 读一份 JSON 为记录（失败即抛 —— 测试夹具不该静默） */
function readJsonRecord(absPath: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(readFileSync(absPath, 'utf8'));
  if (!isRecord(raw)) throw new Error(`${absPath}: 顶层不是对象`);
  return raw;
}

/** 读角色 manifest */
function readManifest(roleId: string): Record<string, unknown> {
  return readJsonRecord(join(ROLES_ROOT, roleId, 'manifest.json'));
}

/** 读随仓 schema */
function readSchema(): Record<string, unknown> {
  return readJsonRecord(SCHEMA_PATH);
}

/** 取 manifest.refs 的条目（保持顺序；非法条目视为测试夹具错误） */
function refsOf(manifest: Record<string, unknown>): readonly Record<string, unknown>[] {
  const raw = manifest['refs'];
  if (!Array.isArray(raw)) throw new Error('manifest.refs 不是数组');
  return raw.filter(isRecord);
}

/** 读某角色包的 `scopes[].id`（测试侧本地读法，仅用于 J2-③ 的期望值） */
function scopeIdsOf(roleId: string): readonly string[] {
  const raw: unknown = parseYaml(readFileSync(join(ROLES_ROOT, roleId, 'knowledge-scope.yaml'), 'utf8'));
  if (!isRecord(raw)) return [];
  const scopes = raw['scopes'];
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(isRecord).map((entry) => String(entry['id']));
}

/** 最小合法 v2 manifest（J3/C2 夹具的基底） */
function baseManifest(roleId: string): Record<string, unknown> {
  return {
    $schema: ROLE_PACK_SCHEMA_POINTER,
    schemaVersion: ROLE_PACK_SCHEMA_VERSION,
    name: `role-${roleId}`,
    version: '2.0.0',
    type: 'role-preset',
    displayName: roleId,
    entryPoint: './context-manifest.yaml',
    roleId,
    pieces: [...ROLE_PACK_PIECES],
    refs: [{ kind: 'scope', name: `${roleId}.demo` }],
  };
}

/** 最小合法六件内容（J3/C2 夹具；refs 与 contexts 对账一致） */
function baseFiles(roleId: string): Readonly<Record<string, string>> {
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

let tempRoot: string | undefined;

beforeEach(() => {
  delete process.env['SYNOVA_PRESETS_ROOT'];
});

afterEach(() => {
  delete process.env['SYNOVA_PRESETS_ROOT'];
  if (tempRoot !== undefined) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

/** 建临时内容根并切过去（返回 roles 目录） */
function useTempPresetsRoot(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'role-pack-schema-'));
  const rolesRoot = join(tempRoot, 'roles');
  mkdirSync(rolesRoot, { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = tempRoot;
  return rolesRoot;
}

/** 在临时内容根里造一个角色包（默认最小合法 v2；可覆盖 manifest／单件内容／省略件） */
function seedPack(
  rolesRoot: string,
  roleId: string,
  overrides: {
    readonly manifest?: Record<string, unknown>;
    readonly omit?: readonly string[];
    readonly files?: Readonly<Record<string, string>>;
  } = {},
): void {
  const dir = join(rolesRoot, roleId);
  mkdirSync(dir, { recursive: true });
  const manifest = overrides.manifest ?? baseManifest(roleId);
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const files = { ...baseFiles(roleId), ...(overrides.files ?? {}) };
  for (const piece of ROLE_PACK_PIECES) {
    if (piece === 'manifest.json') continue;
    if (overrides.omit?.includes(piece) === true) continue;
    const content = files[piece];
    if (content === undefined) throw new Error(`夹具缺 ${piece} 内容`);
    writeFileSync(join(dir, piece), content, 'utf8');
  }
}

/** 跑装载并断言"不抛"（J3 的每条降级用例都必须先过这一关） */
function loadOrFail(): ReturnType<typeof loadRolePacks> {
  expect(() => loadRolePacks()).not.toThrow();
  return loadRolePacks();
}

// ══════════════════════════════════════════════════════════════════════════════
// J1 · 随仓契约 ＋ schemaVersion（正常路径 ＋ drift）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 随仓契约＋schemaVersion', () => {
  it('J1-① 三包 schemaVersion === 2（禁"缺省当 2"）', () => {
    for (const roleId of ROLE_IDS) {
      const manifest = readManifest(roleId);
      expect(manifest['schemaVersion'], `${roleId}: schemaVersion 应为 2`).toBe(ROLE_PACK_SCHEMA_VERSION);
      expect(typeof manifest['schemaVersion'], `${roleId}: schemaVersion 必须是数字`).toBe('number');
    }
  });

  it('J1-② 三包 $schema === 随仓常量（相对包目录）', () => {
    for (const roleId of ROLE_IDS) {
      expect(readManifest(roleId)['$schema'], `${roleId}: $schema 常量`).toBe(ROLE_PACK_SCHEMA_POINTER);
      expect(ROLE_PACK_SCHEMA_POINTER).toBe('../../schema/role-pack-v2.schema.json');
    }
  });

  it('J1-③ $schema 从仓库根解析命中真实文件且 JSON.parse 成功（"随仓"由测试钉住）', () => {
    for (const roleId of ROLE_IDS) {
      const pointer = readManifest(roleId)['$schema'];
      expect(typeof pointer, `${roleId}: $schema 必须是字符串`).toBe('string');
      if (typeof pointer !== 'string') throw new Error(`${roleId}: $schema 非字符串`);
      const abs = resolve(ROLES_ROOT, roleId, pointer);
      expect(existsSync(abs), `${roleId}: 随仓 schema 应存在 ${abs}`).toBe(true);
      expect(() => JSON.parse(readFileSync(abs, 'utf8')), `${roleId}: schema 应是合法 JSON`).not.toThrow();
    }
  });

  it('J1-④ drift：schema.required === zod 必填键集（唯一真源 = zod，schema 是镜像）', () => {
    const schema = readSchema();
    expect(Array.isArray(schema['required']), 'schema.required 应是数组').toBe(true);
    const requiredKeys = Array.isArray(schema['required']) ? schema['required'].map(String).sort() : [];

    // zod 必填性由**行为**观测（删某键 ⇒ 是否被拒），不从 zod 抄一份键集常量（防"两边一起改"双绿）
    const properties = schema['properties'];
    expect(isRecord(properties), 'schema.properties 应是对象').toBe(true);
    const propertyKeys = isRecord(properties) ? Object.keys(properties) : [];
    const behaviorallyRequired: string[] = [];
    for (const key of propertyKeys) {
      const doc = baseManifest('finance');
      doc['note'] = 'x';
      delete doc[key];
      if (!validateManifestDoc(doc, { roleId: 'finance' }).ok) behaviorallyRequired.push(key);
    }

    expect(behaviorallyRequired.sort(), 'schema.required 应逐字等于 zod 的必填行为').toEqual(requiredKeys);
    // 关键必填项单列断言（点名可 grep；drift 失败时能直接指出缺哪一项）
    expect(requiredKeys).toContain('refs');
    expect(requiredKeys).toContain('pieces');
    expect(requiredKeys).toContain('$schema');
    expect(requiredKeys).toContain('schemaVersion');
  });

  it('J1-⑤ drift：schema.properties 键集 === zod 键集（含 optional note；未知键被拒）', () => {
    const schema = readSchema();
    const properties = schema['properties'];
    expect(isRecord(properties), 'schema.properties 应是对象').toBe(true);
    const propertyKeys = isRecord(properties) ? Object.keys(properties).sort() : [];
    expect(propertyKeys).toEqual(
      ['$schema', 'displayName', 'entryPoint', 'name', 'note', 'pieces', 'refs', 'roleId', 'schemaVersion', 'type', 'version'],
    );

    // ① zod 认识 properties 的**全部**键：全键在场（含 optional note）⇒ 通过
    const full = baseManifest('finance');
    full['note'] = 'x';
    expect(validateManifestDoc(full, { roleId: 'finance' }).ok).toBe(true);
    // ② zod 不认识 properties 之外的键（strict）：未知键 ⇒ 拒且点名
    const extra: Record<string, unknown> = { ...full, __unknown_key__: 1 };
    const extraResult = validateManifestDoc(extra, { roleId: 'finance' });
    expect(extraResult.ok).toBe(false);
    expect(extraResult.problems.map((p) => p.code)).toContain('ROLE_PACK_MANIFEST_INVALID');
    expect(extraResult.problems.map((p) => p.message).join(' ')).toContain('__unknown_key__');
    // ③ note 是 optional：删掉仍通过
    const withoutNote = baseManifest('finance');
    expect(validateManifestDoc(withoutNote, { roleId: 'finance' }).ok).toBe(true);
  });

  it('J1-⑥ 字段级豁免清单 === 恰好五件（防"悄悄扩大豁免面"）', () => {
    expect([...FIELD_LEVEL_VALIDATION_EXEMPT_PIECES].sort()).toEqual(
      ['acceptance-criteria.yaml', 'capabilities.yaml', 'context-manifest.yaml', 'knowledge-scope.yaml', 'output-template.ref'],
    );
    expect(FIELD_LEVEL_VALIDATION_EXEMPT_PIECES.length).toBe(5);
    // 豁免面 = 五件内容件本身（尚无内容件进入字段级 zod 校验；P2 接读者时才移除）
    expect([...FIELD_LEVEL_VALIDATION_EXEMPT_PIECES].sort()).toEqual([...CONTENT_PIECES].sort());
    // 六件里唯一**有**结构校验的是 manifest 自身
    expect(CONTENT_PIECES.includes('manifest.json'), 'manifest 不在豁免清单内').toBe(false);
    expect(ROLE_PACK_PIECES.length).toBe(6);
  });

  it('J1-⑦ schema.$defs 恰定义五件内容件的最小声明（契约；本批不执行）', () => {
    const schema = readSchema();
    const defs = schema['$defs'];
    expect(isRecord(defs), 'schema.$defs 应是对象').toBe(true);
    expect(isRecord(defs) ? Object.keys(defs).sort() : []).toEqual([
      'acceptanceCriteria',
      'capabilities',
      'contextManifest',
      'knowledgeScope',
      'outputTemplate',
    ]);
    expect(CONTENT_PIECES.length).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · refs 三方双向相等
// ══════════════════════════════════════════════════════════════════════════════

describe('J2 refs 三方双向相等', () => {
  it('J2-① 三包 refs 逐字等于 §2.5-C 字面数组（期望值人工写死，禁投影函数生成）', () => {
    for (const roleId of ROLE_IDS) {
      expect(readManifest(roleId)['refs'], `${roleId}: refs 应逐字等于 §2.5-C`).toEqual(EXPECTED_REFS[roleId]);
    }
  });

  it('J2-② 三包 kind=file refs 的 path 在仓库根存在（声明→磁盘）', () => {
    for (const roleId of ROLE_IDS) {
      const fileRefs = refsOf(readManifest(roleId)).filter((ref) => ref['kind'] === 'file');
      expect(fileRefs.length, `${roleId}: 应有 kind=file 引用`).toBeGreaterThan(0);
      for (const ref of fileRefs) {
        const path = ref['path'];
        expect(typeof path, `${roleId}: refs 的 file.path 必须是字符串`).toBe('string');
        if (typeof path !== 'string') throw new Error(`${roleId}: file.path 非字符串`);
        expect(existsSync(resolve(REPO_ROOT, path)), `${roleId}: refs 悬空 ${path}`).toBe(true);
      }
    }
  });

  it('J2-③ 三包 kind=scope refs 命中同包 scopes[].id（§2.4 scope 优先投影的前提）', () => {
    for (const roleId of ROLE_IDS) {
      const scopeRefs = refsOf(readManifest(roleId)).filter((ref) => ref['kind'] === 'scope');
      expect(scopeRefs.length, `${roleId}: 应有 kind=scope 引用`).toBeGreaterThan(0);
      const scopeIds = scopeIdsOf(roleId);
      for (const ref of scopeRefs) {
        const name = ref['name'];
        expect(typeof name, `${roleId}: refs 的 scope.name 必须是字符串`).toBe('string');
        expect(scopeIds, `${roleId}: scope ref 应命中 scopes[].id`).toContain(name);
      }
    }
  });

  it('J2-④ 三包 pieces（6）=== 磁盘文件集（双向相等）', () => {
    for (const roleId of ROLE_IDS) {
      const pieces = readManifest(roleId)['pieces'];
      expect(Array.isArray(pieces), `${roleId}: pieces 应是数组`).toBe(true);
      const declared = Array.isArray(pieces) ? pieces.map(String).sort() : [];
      const onDisk = [...ROLE_PACK_PIECES].sort();
      expect(declared, `${roleId}: pieces 应与磁盘六件相等`).toEqual(onDisk);
      expect(EXPECTED_PIECES.length).toBe(6);
      expect(onDisk.length).toBe(6);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 · loader fail-loud 且不抛（六种非法输入）
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 loader fail-loud 且不抛（六种非法输入各一条，errors 点名）', () => {
  it('J3-正常 三包出厂包 ⇒ degraded:false／errors:[]／schemaValid:true／missing:[]', () => {
    const report = loadOrFail();
    expect(report.degraded).toBe(false);
    expect(report.errors).toEqual([]);
    expect(report.roles.map((role) => role.roleId)).toEqual(['finance', 'hr', 'sales']);
    for (const role of report.roles) {
      expect(role.missing, `${role.roleId}: missing 应为空`).toEqual([]);
      expect(role.schemaValid, `${role.roleId}: schemaValid 应为 true`).toBe(true);
      expect(role.schemaVersion, `${role.roleId}: schemaVersion 应为 2`).toBe(ROLE_PACK_SCHEMA_VERSION);
      expect(role.validation.ok).toBe(true);
      expect(role.validation.refsChecked, `${role.roleId}: refsChecked 应 > 0`).toBeGreaterThan(0);
    }
  });

  it('J3-① 缺件（omit output-template.ref）⇒ degraded、errors 点名该件、不抛', () => {
    const rolesRoot = useTempPresetsRoot();
    seedPack(rolesRoot, 'demo', { omit: ['output-template.ref'] });

    const report = loadOrFail();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('demo');
    expect(text).toContain('output-template.ref');
    expect(report.roles[0]?.missing).toEqual(['output-template.ref']);
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('J3-② schemaVersion 错（=1）⇒ ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED、点名实际值、不抛', () => {
    const rolesRoot = useTempPresetsRoot();
    const manifest = baseManifest('demo');
    manifest['schemaVersion'] = 1;
    seedPack(rolesRoot, 'demo', { manifest });

    const report = loadOrFail();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('demo');
    expect(text).toContain('ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED');
    expect(text).toContain('schemaVersion=1');
    expect(report.roles[0]?.schemaVersion).toBe(1);
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('J3-③ $schema 常量错（仓外 URL）⇒ ROLE_PACK_SCHEMA_POINTER_INVALID、点名、不抛', () => {
    const rolesRoot = useTempPresetsRoot();
    const badPointer = 'https://synova.dev/schemas/extension-manifest-v1.json';
    const manifest = baseManifest('demo');
    manifest['$schema'] = badPointer;
    seedPack(rolesRoot, 'demo', { manifest });

    const report = loadOrFail();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_SCHEMA_POINTER_INVALID');
    expect(text).toContain(badPointer);
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('J3-④ pieces 与磁盘不等（磁盘多出未声明文件 notes.md）⇒ ROLE_PACK_PIECES_MISMATCH、点名该件、不抛', () => {
    const rolesRoot = useTempPresetsRoot();
    seedPack(rolesRoot, 'demo');
    // 声明仍是六件且结构合法；磁盘多出一个未声明文件 ⇒ 只有"磁盘→声明"这一面能抓到
    writeFileSync(join(rolesRoot, 'demo', 'notes.md'), '# 未声明的散落文件\n', 'utf8');

    const report = loadOrFail();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_PIECES_MISMATCH');
    expect(text).toContain('notes.md');
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('J3-⑤ refs 悬空（指向不存在文件，且内容侧同步声明）⇒ ROLE_PACK_REF_MISSING、点名 path、不抛', () => {
    const rolesRoot = useTempPresetsRoot();
    const missingPath = 'extensions/ontology/__absent__/nope.json';
    const manifest = baseManifest('demo');
    manifest['refs'] = [
      { kind: 'scope', name: 'demo.demo' },
      { kind: 'file', path: missingPath },
    ];
    seedPack(rolesRoot, 'demo', {
      manifest,
      files: {
        'context-manifest.yaml':
          'roleId: demo\nversion: 2\ncontexts:\n  - id: demo.demo\n    label: demo\n' +
          '    source: knowledge-scope.yaml#demo.demo\n  - id: demo.onto\n    label: 本体\n' +
          `    source: ${missingPath}\nprompt:\n  systemAddendum: |\n    demo\n`,
      },
    });

    const report = loadOrFail();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_REF_MISSING');
    expect(text).toContain(missingPath);
    expect(report.roles[0]?.schemaValid).toBe(false);
  });

  it('J3-⑥ refs 与 source 不等（refs=[] 但内容有 source）⇒ ROLE_PACK_REF_UNDECLARED、点名 scope、不抛', () => {
    const rolesRoot = useTempPresetsRoot();
    const manifest = baseManifest('demo');
    manifest['refs'] = [];
    seedPack(rolesRoot, 'demo', { manifest });

    const report = loadOrFail();
    expect(report.degraded).toBe(true);
    const text = report.errors.join(' ');
    expect(text).toContain('ROLE_PACK_REF_UNDECLARED');
    expect(text).toContain('demo.demo');
    expect(report.roles[0]?.schemaValid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C2 · 边界值（空／单元素／恰临界／超限／零负）
// ══════════════════════════════════════════════════════════════════════════════

describe('C2 边界值', () => {
  it('C2-① schemaVersion：缺 ⇒ 拒；0／-1／3 ⇒ 拒（UNSUPPORTED，禁向上兼容猜测）', () => {
    const ctx = { roleId: 'finance' };
    const missing = baseManifest('finance');
    delete missing['schemaVersion'];
    const missingResult = validateManifestDoc(missing, ctx);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.schemaVersion).toBeNull();
    expect(missingResult.problems.map((p) => p.code)).toContain('ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED');
    expect(missingResult.problems.map((p) => p.message).join(' ')).toContain('缺失');

    for (const badVersion of [0, -1, 3]) {
      const doc = baseManifest('finance');
      doc['schemaVersion'] = badVersion;
      const result = validateManifestDoc(doc, ctx);
      expect(result.ok, `schemaVersion=${String(badVersion)} 应被拒`).toBe(false);
      expect(result.problems.map((p) => p.code), `schemaVersion=${String(badVersion)} 的码`).toContain(
        'ROLE_PACK_SCHEMA_VERSION_UNSUPPORTED',
      );
    }
  });

  it('C2-② pieces：空／1 项／7 项 ⇒ 拒（结构层）；7 项 vs 磁盘 6 ⇒ PIECES_MISMATCH', () => {
    const ctx = { roleId: 'finance' };
    for (const badPieces of [[], ['manifest.json'], [...ROLE_PACK_PIECES, 'notes.md']]) {
      const doc = baseManifest('finance');
      doc['pieces'] = badPieces;
      const result = validateManifestDoc(doc, ctx);
      expect(result.ok, `pieces=${JSON.stringify(badPieces)} 应被拒`).toBe(false);
      expect(result.problems.map((p) => p.code)).toContain('ROLE_PACK_MANIFEST_INVALID');
    }

    const seven = baseManifest('finance');
    seven['pieces'] = [...ROLE_PACK_PIECES, 'notes.md'];
    const reconciled = reconcileRefs(seven, ROLE_PACK_PIECES, ['knowledge-scope.yaml#finance.demo']);
    expect(reconciled.ok).toBe(false);
    expect(reconciled.problems.map((p) => p.code)).toContain('ROLE_PACK_PIECES_MISMATCH');
    expect(reconciled.problems.map((p) => p.message).join(' ')).toContain('notes.md');
  });

  it('C2-③ refs：空 ＋ content 无 source ⇒ 过（refs 空只在"没有内容引用"时合法）', () => {
    const doc = baseManifest('finance');
    doc['refs'] = [];
    const result = reconcileRefs(doc, ROLE_PACK_PIECES, []);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.refsChecked).toBe(0);
  });

  it('C2-④ scope id 长度 64 ⇒ 过（本批不设 63 上限，不误拒）', () => {
    const longId = 'a'.repeat(64);
    const doc = baseManifest('finance');
    doc['refs'] = [{ kind: 'scope', name: longId }];
    const result = reconcileRefs(doc, ROLE_PACK_PIECES, [`knowledge-scope.yaml#${longId}`]);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.refsChecked).toBe(2);
  });

  it('C2-⑤ refs 多一条（内容侧无对应 source）⇒ ROLE_PACK_REF_ORPHAN、点名该条', () => {
    const doc = baseManifest('finance');
    doc['refs'] = [
      { kind: 'scope', name: 'finance.demo' },
      { kind: 'profile', name: 'business-plan' },
    ];
    const result = reconcileRefs(doc, ROLE_PACK_PIECES, ['knowledge-scope.yaml#finance.demo']);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('ROLE_PACK_REF_ORPHAN');
    expect(result.problems.map((p) => p.message).join(' ')).toContain('profile:business-plan');
  });

  it('C2-⑥ manifest 非对象 ⇒ ROLE_PACK_MANIFEST_INVALID（不抛）', () => {
    for (const badDoc of [null, [], 'x', 42]) {
      const result = validateManifestDoc(badDoc, { roleId: 'finance' });
      expect(result.ok).toBe(false);
      expect(result.problems.map((p) => p.code)).toContain('ROLE_PACK_MANIFEST_INVALID');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2.4 · refs 投影规则（唯一实现；P1-b 生成器复用同一函数）
// ══════════════════════════════════════════════════════════════════════════════

describe('§2.4 refs 投影规则（projectContextSource 唯一实现）', () => {
  it('§2.4-① 四种形态逐条：无锚路径／带锚路径／profile／本包 knowledge-scope.yaml#scope', () => {
    expect(projectContextSource('extensions/ontology/outcome/financial.json', 'finance')).toEqual({
      ok: true,
      ref: { kind: 'file', path: 'extensions/ontology/outcome/financial.json' },
    });
    expect(
      projectContextSource('extensions/ontology/outcome/financial.json#requiredProps.period', 'finance'),
    ).toEqual({ ok: true, ref: { kind: 'file', path: 'extensions/ontology/outcome/financial.json' } });
    expect(projectContextSource('profile.business-plan', 'finance')).toEqual({
      ok: true,
      ref: { kind: 'profile', name: 'business-plan' },
    });
    // ③ scope 优先：**不同时**记 file（否则 J2-② 反例恒绿）
    expect(
      projectContextSource('extensions/presets/roles/finance/knowledge-scope.yaml#finance.cost', 'finance'),
    ).toEqual({ ok: true, ref: { kind: 'scope', name: 'finance.cost' } });
    expect(projectContextSource('knowledge-scope.yaml#finance.cost', 'finance')).toEqual({
      ok: true,
      ref: { kind: 'scope', name: 'finance.cost' },
    });
  });

  it('§2.4-② 其它 knowledge-scope 形态（带 ./ 前缀）不升级为 scope，按 file 处理（规则不得放宽）', () => {
    expect(projectContextSource('./knowledge-scope.yaml#finance.cost', 'finance')).toEqual({
      ok: true,
      ref: { kind: 'file', path: './knowledge-scope.yaml' },
    });
    // 别的角色的 knowledge-scope 不是"本包"，同样是 file
    expect(projectContextSource('extensions/presets/roles/hr/knowledge-scope.yaml#people.policy', 'finance')).toEqual({
      ok: true,
      ref: { kind: 'file', path: 'extensions/presets/roles/hr/knowledge-scope.yaml' },
    });
  });

  it('§2.4-③ 非法形态 ⇒ ROLE_SEED_BAD_SOURCE（生成期拒绝，禁静默丢弃）', () => {
    for (const badSource of ['', '   ', '#only-anchor', 'profile.']) {
      const result = projectContextSource(badSource, 'finance');
      expect(result.ok, `source「${badSource}」应被拒`).toBe(false);
      if (result.ok) throw new Error(`source「${badSource}」不应投影成功`);
      expect(result.code).toBe('ROLE_SEED_BAD_SOURCE');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 交叉验证：真仓库根下的 IO 壳（与 loader 同一入口的另一种观测面）
// ══════════════════════════════════════════════════════════════════════════════

describe('IO 壳 validateRolePackDir（真仓库根）', () => {
  it('三包 problems === []（与 loadRolePacks 的 schemaValid:true 互证）', () => {
    for (const roleId of ROLE_IDS) {
      const validation = validateRolePackDir(join(ROLES_ROOT, roleId), { repoRoot: REPO_ROOT });
      expect(validation.problems, `${roleId}: ${JSON.stringify(validation.problems)}`).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(validation.schemaVersion).toBe(ROLE_PACK_SCHEMA_VERSION);
      expect(validation.refsChecked).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// A · repoRoot 不依赖 cwd（#1104 / 规格 §10-L14；改坏必红目标）
// ══════════════════════════════════════════════════════════════════════════════

/** 三包 refs 引用的 5 个本体件（内容不判，只判存在；路径相对仓库根） */
const ONTOLOGY_REF_PATHS = [
  'extensions/ontology/outcome/financial.json',
  'extensions/ontology/resource/person.json',
  'extensions/ontology/resource/team.json',
  'extensions/ontology/resource/client.json',
  'extensions/ontology/resource/channel.json',
] as const;

/**
 * 造一个**仓库形状**的临时根：`<fixture>/extensions/presets/roles/<三包六件>` ＋ `<fixture>/extensions/ontology/**`。
 *
 * 🔴 逐件**读＋写**（不软链、不写主树）：内容根 = `<fixture>/extensions/presets` ⇒ loader 派生的
 *   `repoRoot = resolve(root,'../..') = <fixture>`，与被引用的 `extensions/ontology/**` 同构。
 */
function buildRepoShapedFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), 'role-pack-repo-'));
  for (const roleId of ROLE_IDS) {
    const srcDir = join(ROLES_ROOT, roleId);
    const dstDir = join(fixture, 'extensions', 'presets', 'roles', roleId);
    mkdirSync(dstDir, { recursive: true });
    for (const piece of ROLE_PACK_PIECES) {
      writeFileSync(join(dstDir, piece), readFileSync(join(srcDir, piece), 'utf8'), 'utf8');
    }
  }
  for (const relPath of ONTOLOGY_REF_PATHS) {
    const abs = join(fixture, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '{}\n', 'utf8');
  }
  return fixture;
}

describe('A · loader 的 repoRoot 由内容根派生（不依赖 cwd；#1104 / 规格 §10-L14）', () => {
  it('A-① cwd=/tmp 时夹具根下三包仍全绿（若 repoRoot 回退 cwd ⇒ 必现 5 条 ROLE_PACK_REF_MISSING）', () => {
    const fixture = buildRepoShapedFixture();
    const originalCwd = process.cwd();
    try {
      process.env['SYNOVA_PRESETS_ROOT'] = join(fixture, 'extensions', 'presets');
      process.chdir('/tmp'); // 关键：cwd 离开仓库根
      const cwd = process.cwd();

      // 红线前置：cwd 下确实没有那 5 个被引用件 ⇒ "回退 cwd" 必然判悬空（本条才有判别力）
      for (const relPath of ONTOLOGY_REF_PATHS) {
        expect(existsSync(join(cwd, relPath)), `cwd 下不应存在 ${relPath}（否则本用例失去判别力）`).toBe(false);
      }

      const report = loadOrFail();
      expect(report.root).toBe(join(fixture, 'extensions', 'presets'));
      expect(report.roles.map((role) => role.roleId)).toEqual([...ROLE_IDS]);
      for (const role of report.roles) {
        expect(role.missing, `${role.roleId}: missing 应为空`).toEqual([]);
        expect(role.schemaValid, `${role.roleId}: schemaValid 应为 true`).toBe(true);
        expect(role.validation.problems, `${role.roleId}: problems 应为空`).toEqual([]);
        expect(role.knowledgeScope.degraded, `${role.roleId}: knowledgeScope.degraded 应为 false`).toBe(false);
      }
      expect(report.degraded).toBe(false);
      expect(report.errors).toEqual([]);
    } finally {
      process.chdir(originalCwd); // 必须在 finally 恢复：否则同文件后续用例的 cwd 全漂
      delete process.env['SYNOVA_PRESETS_ROOT'];
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('A-② 同夹具删掉一个本体件 ⇒ ROLE_PACK_REF_MISSING 点名该 path（证明 A-① 的存在性检查是活的）', () => {
    const fixture = buildRepoShapedFixture();
    const missingRel = 'extensions/ontology/resource/team.json';
    rmSync(join(fixture, missingRel));
    const originalCwd = process.cwd();
    try {
      process.env['SYNOVA_PRESETS_ROOT'] = join(fixture, 'extensions', 'presets');
      process.chdir('/tmp');

      const report = loadOrFail();
      expect(report.degraded).toBe(true);
      const text = report.errors.join(' ');
      expect(text).toContain('ROLE_PACK_REF_MISSING');
      expect(text).toContain(missingRel);
      // 逐包归因：只有引用 team.json 的 hr 降级，finance／sales 不受牵连
      expect(report.errors.length, `应只有 hr 一条错（实际 ${text}）`).toBe(1);
      expect(report.errors.every((err) => err.startsWith('hr: ')), '错误应点名 hr').toBe(true);
      expect(report.roles.find((role) => role.roleId === 'hr')?.schemaValid).toBe(false);
      expect(report.roles.find((role) => role.roleId === 'finance')?.schemaValid).toBe(true);
      expect(report.roles.find((role) => role.roleId === 'sales')?.schemaValid).toBe(true);
    } finally {
      process.chdir(originalCwd);
      delete process.env['SYNOVA_PRESETS_ROOT'];
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C · 角色目录不可读 ⇒ ROLE_PACK_DIR_UNREADABLE（#1104 / 规格 §4.5-C1；改坏必红目标）
// ══════════════════════════════════════════════════════════════════════════════

describe('C · 角色目录不可读 ⇒ ROLE_PACK_DIR_UNREADABLE（点名＋不抛＋log.warn）', () => {
  it('C-① chmod 0o111（有 x 无 r）：readdir 必 EACCES ⇒ problems 点名目录、不抛、warn 带 code', () => {
    const rolesRoot = useTempPresetsRoot();
    seedPack(rolesRoot, 'finance');
    const roleDir = join(rolesRoot, 'finance');
    logCalls.length = 0; // 只观测本用例产生的日志
    chmodSync(roleDir, 0o111);
    try {
      // 🔴 0o111：按名读 manifest.json／context-manifest.yaml 仍可（不会早退成 MANIFEST_UNREADABLE），
      //    但 readdirSync 必 EACCES ⇒ 必进 listRoleDirFiles 的 catch（这正是本判据的物理机制）
      expect(() => validateRolePackDir(roleDir, { repoRoot: REPO_ROOT })).not.toThrow();
      const validation = validateRolePackDir(roleDir, { repoRoot: REPO_ROOT });

      expect(validation.ok).toBe(false);
      const problem = validation.problems.find((candidate) => candidate.code === 'ROLE_PACK_DIR_UNREADABLE');
      expect(
        problem,
        `problems 应含 ROLE_PACK_DIR_UNREADABLE（实际 ${JSON.stringify(validation.problems.map((p) => p.code))}）`,
      ).toBeDefined();
      expect(problem?.message).toContain(roleDir); // 点名目录（不是笼统"读失败"）
      // 目录本身还在：不可读是 IO 根因，不能被误报成"缺件"
      expect(validation.problems.map((candidate) => candidate.code)).toContain('ROLE_PACK_PIECES_MISMATCH');

      // 日志必须**运行期捕获**（禁 grep）：warn 的 meta.code 恰为本码且点名 roleDir
      const warnings = logCalls.filter((call) => call.level === 'warn');
      expect(warnings.length, `应至少一条 warn（实际 ${JSON.stringify(logCalls)}）`).toBeGreaterThan(0);
      const codedWarn = warnings.find((call) => isRecord(call.meta) && call.meta['code'] === 'ROLE_PACK_DIR_UNREADABLE');
      if (codedWarn === undefined || !isRecord(codedWarn.meta)) {
        throw new Error(`未捕获到 meta.code=ROLE_PACK_DIR_UNREADABLE 的 warn（实际 ${JSON.stringify(logCalls)}）`);
      }
      expect(codedWarn.meta['roleDir']).toBe(roleDir);
    } finally {
      chmodSync(roleDir, 0o755); // 必须先恢复权限再让 afterEach rmSync 清理
    }
  });

  it('C-② 对照：同一夹具权限正常（0o755）⇒ 无 DIR_UNREADABLE、无该码 warn（证明 C-① 不是恒真）', () => {
    const rolesRoot = useTempPresetsRoot();
    seedPack(rolesRoot, 'finance');
    const roleDir = join(rolesRoot, 'finance');
    logCalls.length = 0;

    const validation = validateRolePackDir(roleDir, { repoRoot: REPO_ROOT });
    expect(validation.ok).toBe(true);
    expect(validation.problems.map((candidate) => candidate.code)).not.toContain('ROLE_PACK_DIR_UNREADABLE');
    expect(
      logCalls.some((call) => call.level === 'warn' && isRecord(call.meta) && call.meta['code'] === 'ROLE_PACK_DIR_UNREADABLE'),
    ).toBe(false);
  });
});
