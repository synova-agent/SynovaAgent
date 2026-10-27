/**
 * tests/onboarding/config-pack-generator.test.ts — 配对测试（铁律 48）
 *
 * #1075 P1-b（生成面）覆盖：
 *   正常：完整 seed ⇒ 6 件（`written.length === EXPECTED_PIECES.length` **且** === 6，两式并列）
 *        ＋ 六件内容断言（`scopes:`／`contexts:`＋`systemAddendum`／`templateId`／`criteria`／
 *          `capabilities`／`schemaVersion:2`＋`pieces`＋`refs`）
 *        ＋ **J4b**：生成后真 `loadRolePacks()` ⇒ `degraded:false`／`missing:[]`／`declared:true`
 *   降级：六块逐块缺项 ⇒ `rejected[]`（`ROLE_SEED_INCOMPLETE`，逐字段点名）＋**零部分写**；
 *        `contexts.source` 不可投影 ⇒ `ROLE_SEED_BAD_SOURCE`；roleId 非法 ⇒ `skipped`（不进 rejected）
 *   边界：dry-run 零落盘（planned=6）／缺项 dry-run 零计划／空角色零写入／幂等覆盖写
 *
 * 🔴 夹具纪律（#1075）：`contexts[].source` **只许** scope（本包 knowledge-scope 带锚）＋
 *   `profile.business-plan` 两类 —— 临时根里没有 `extensions/ontology/**`，file ref 必悬空
 *   （loader 的 `repoRoot` 取 `process.cwd()`）⇒ J4b 会假红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateConfigPack, type RoleSeed } from '../../src/onboarding/config-pack-generator';
import { EXPECTED_PIECES, loadRolePacks } from '../../src/init/preset-loader';

let root: string;
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-pack-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
});

/** 角色目录（临时根内） */
function roleDir(roleId: string): string {
  return join(root, 'extensions/presets/roles', roleId);
}

/** 读角色包某件 */
function readPiece(roleId: string, piece: string): string {
  return readFileSync(join(roleDir(roleId), piece), 'utf8');
}

/** 读 JSON 件为普通记录（避免 `as any` 家族：逐键搬运） */
function readJsonRecord(roleId: string, piece: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readPiece(roleId, piece));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${piece} 不是 JSON 对象`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) out[key] = value;
  return out;
}

/** 六块齐的 seed（ASCII 串 ⇒ slug 非空；contexts 只 scope＋profile —— 见文件头夹具纪律） */
function completeSeed(overrides: Partial<RoleSeed> = {}): RoleSeed {
  return {
    roleId: 'finance',
    knowledgeScope: ['finance.statements'],
    capabilities: ['budget review'],
    acceptanceCriteria: ['monthly close within 5 days'],
    contexts: [
      {
        id: 'finance.statements-ref',
        label: '财务报表口径',
        source: 'extensions/presets/roles/finance/knowledge-scope.yaml#finance.statements',
        required: true,
      },
      { id: 'company.bp', label: '公司业务说明', source: 'profile.business-plan' },
    ],
    systemAddendum: '你在为财务岗提供支持。\n结论必须标明口径来源。',
    outputTemplate: {
      templateId: 'finance.standard',
      sections: [{ id: 'headline', title: '一句话结论', must: ['结论', '报告期'] }],
      emptyState: '数据不足时列出缺口。',
    },
    ...overrides,
  };
}

describe('config-pack-generator — J4 正常路径（六件）', () => {
  it('J4-1 完整 seed ⇒ written.length === EXPECTED_PIECES.length 且 === 6（两式并列）', () => {
    const r = generateConfigPack({ roles: [completeSeed()], rootDir: root });
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.rejected).toEqual([]);
    // 两式并列（防"两边一起改"双绿）
    expect(EXPECTED_PIECES.length).toBe(6);
    expect(r.written.length).toBe(EXPECTED_PIECES.length);
    expect(r.written.length).toBe(6);
    expect(r.written).toEqual([...r.written].sort());
    expect(r.written).toContain(join('extensions/presets/roles/finance', 'manifest.json'));
    // 磁盘实测 = 六件
    expect(readdirSync(roleDir('finance')).sort()).toEqual([...EXPECTED_PIECES].sort());
  });

  it('J4-2a knowledge-scope.yaml 顶层含 scopes: 且 scopes[].id 非空', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const body = readPiece('finance', 'knowledge-scope.yaml');
    expect(body).toMatch(/^scopes:\s*$/m);
    const ids = [...body.matchAll(/^\s+- id: "(.+)"$/gm)].map((match) => match[1]);
    expect(ids).toEqual(['finance.statements']);
    // 真缺陷回归：键名不得回退为 knowledgeScope
    expect(body).not.toContain('knowledgeScope:');
  });

  it('J4-2b context-manifest.yaml 含 contexts(≥1) 与 prompt.systemAddendum(非空)', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const body = readPiece('finance', 'context-manifest.yaml');
    expect(body).toContain('contexts:');
    expect([...body.matchAll(/^\s{2}- id: "/gm)].length).toBeGreaterThanOrEqual(1);
    expect(body).toContain('source: "extensions/presets/roles/finance/knowledge-scope.yaml#finance.statements"');
    expect(body).toContain('prompt:');
    expect(body).toContain('  systemAddendum: |');
    // 块标量正文非空（缩进 4 空格的第一行）
    expect(body).toMatch(/^ {4}你在为财务岗提供支持。$/m);
  });

  it('J4-2c output-template.ref 含 templateId 与 sections(≥1)', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const body = readPiece('finance', 'output-template.ref');
    expect(body).toContain('templateId: "finance.standard"');
    expect(body).toContain('sections:');
    expect(body).toContain('- id: "headline"');
    expect(body).toContain('must: [');
    expect(body).toContain('emptyState: "数据不足时列出缺口。"');
  });

  it('J4-2d acceptance-criteria.yaml 含 criteria(≥1)', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const body = readPiece('finance', 'acceptance-criteria.yaml');
    expect(body).toContain('criteria:');
    expect(body).toContain('- id: "ac.monthly-close-within-5-days"');
    expect(body).toContain('text: "monthly close within 5 days"');
  });

  it('J4-2e capabilities.yaml 含 capabilities(≥1) 且 id=capability.<slug>', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const body = readPiece('finance', 'capabilities.yaml');
    expect(body).toContain('capabilities:');
    expect(body).toContain('- id: "capability.budget-review"');
    expect(body).toContain('label: "budget review"');
    expect(body).toContain('enabled: true');
  });

  it('J4-2f manifest.json 含 schemaVersion:2／pieces(6)／refs（键集恰 10 键）', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const manifest = readJsonRecord('finance', 'manifest.json');
    expect(manifest['$schema']).toBe('../../schema/role-pack-v2.schema.json');
    expect(manifest['schemaVersion']).toBe(2);
    expect(manifest['name']).toBe('role-finance');
    expect(manifest['version']).toBe('2.0.0');
    expect(manifest['type']).toBe('role-preset');
    expect(manifest['displayName']).toBe('finance');
    expect(manifest['entryPoint']).toBe('context-manifest.yaml');
    expect(manifest['roleId']).toBe('finance');
    expect(manifest['pieces']).toEqual([...EXPECTED_PIECES]);
    expect(manifest['refs']).toEqual([
      { kind: 'profile', name: 'business-plan' },
      { kind: 'scope', name: 'finance.statements' },
    ]);
    // P1-a `MANIFEST_ZOD` 是 strictObject：键集必须恰为这 10 个（不写 note）
    expect(Object.keys(manifest).sort()).toEqual(
      [
        '$schema',
        'schemaVersion',
        'name',
        'version',
        'type',
        'displayName',
        'entryPoint',
        'roleId',
        'pieces',
        'refs',
      ].sort(),
    );
  });

  it('J4b 生成后真 loadRolePacks() ⇒ degraded:false、missing:[]、declared:true、scopeIds 非空', () => {
    generateConfigPack({ roles: [completeSeed()], rootDir: root });
    process.env['SYNOVA_PRESETS_ROOT'] = join(root, 'extensions/presets');
    const report = loadRolePacks();
    const pack = report.roles.find((role) => role.roleId === 'finance');
    expect(pack).toBeDefined();
    // 🔴 J4-② 红线（键名回退 ⇒ 这一条与 J4-2a 同时红）：内容声明的真判据
    expect(pack?.knowledgeScope.declared).toBe(true);
    expect(pack?.knowledgeScope.scopeIds).toEqual(['finance.statements']);
    expect(report.degraded).toBe(false);
    expect(report.errors).toEqual([]);
    expect(pack?.missing).toEqual([]);
    expect(pack?.schemaValid).toBe(true);
    expect(EXPECTED_PIECES.length).toBe(6);
  });
});

describe('config-pack-generator — 降级路径（rejected 零部分写）', () => {
  it('J4-3 缺 systemAddendum ⇒ rejected[0].code=ROLE_SEED_INCOMPLETE、missingParams 点名、written=[]、目录零文件', () => {
    const r = generateConfigPack({ roles: [completeSeed({ systemAddendum: undefined })], rootDir: root });
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0]?.code).toBe('ROLE_SEED_INCOMPLETE');
    expect(r.rejected[0]?.roleId).toBe('finance');
    expect(r.rejected[0]?.missingParams).toContain('systemAddendum');
    expect(r.written).toEqual([]);
    expect(r.degraded).toBe(true);
    // 人读摘要（机器判据读 rejected，摘要是可观测性）
    expect(r.errors.join(' ')).toContain('ROLE_SEED_INCOMPLETE');
    // 零部分写：目录都不该被创建
    expect(existsSync(roleDir('finance'))).toBe(false);
  });

  it('J4-4 六块逐块缺项 ⇒ missingParams 逐字段点名（表驱动；每行零写入）', () => {
    const cases: readonly { readonly label: string; readonly seed: RoleSeed; readonly param: string }[] = [
      { label: 'knowledgeScope 空', seed: completeSeed({ knowledgeScope: [] }), param: 'knowledgeScope' },
      { label: 'capabilities 空', seed: completeSeed({ capabilities: [] }), param: 'capabilities' },
      { label: 'acceptanceCriteria 空', seed: completeSeed({ acceptanceCriteria: [] }), param: 'acceptanceCriteria' },
      { label: 'contexts 空', seed: completeSeed({ contexts: [] }), param: 'contexts' },
      { label: 'systemAddendum 缺', seed: completeSeed({ systemAddendum: undefined }), param: 'systemAddendum' },
      {
        label: 'outputTemplate 整体缺',
        seed: completeSeed({ outputTemplate: undefined }),
        param: 'outputTemplate',
      },
      {
        label: 'outputTemplate.sections 空',
        seed: completeSeed({ outputTemplate: { templateId: 'x.standard', sections: [] } }),
        param: 'outputTemplate.sections',
      },
    ];
    for (const item of cases) {
      const r = generateConfigPack({ roles: [item.seed], rootDir: root });
      expect(r.rejected.length, item.label).toBe(1);
      expect(r.rejected[0]?.code, item.label).toBe('ROLE_SEED_INCOMPLETE');
      expect(r.rejected[0]?.missingParams, item.label).toContain(item.param);
      expect(r.written, item.label).toEqual([]);
      expect(existsSync(roleDir(item.seed.roleId)), item.label).toBe(false);
    }
  });

  it('J4-5 边界值（C2）：空白 systemAddendum 算缺；1 字符/1 节/1 条 ⇒ 过', () => {
    const blank = generateConfigPack({ roles: [completeSeed({ systemAddendum: '   ' })], rootDir: root });
    expect(blank.rejected[0]?.missingParams).toContain('systemAddendum');
    expect(blank.written).toEqual([]);

    const minimal = generateConfigPack({
      roles: [
        completeSeed({
          roleId: 'minimal',
          knowledgeScope: ['a.b'],
          capabilities: ['c'],
          acceptanceCriteria: ['d'],
          contexts: [{ id: 'ctx', label: 'ctx', source: 'profile.business-plan' }],
          systemAddendum: 'x',
          outputTemplate: { templateId: 'minimal.standard', sections: [{ id: 's', title: 's', must: ['m'] }] },
        }),
      ],
      rootDir: root,
    });
    expect(minimal.rejected).toEqual([]);
    expect(minimal.written.length).toBe(6);
  });

  it('J4-6 contexts.source 非 §2.4 四形态 ⇒ rejected code=ROLE_SEED_BAD_SOURCE 且零写入', () => {
    const sources = ['', '#anchor', 'profile.'];
    for (const source of sources) {
      const r = generateConfigPack({
        roles: [
          completeSeed({
            roleId: 'bad-source',
            contexts: [{ id: 'ctx', label: 'ctx', source }],
          }),
        ],
        rootDir: root,
      });
      expect(r.rejected.length, `source=${JSON.stringify(source)}`).toBe(1);
      expect(r.rejected[0]?.code, `source=${JSON.stringify(source)}`).toBe('ROLE_SEED_BAD_SOURCE');
      expect(r.rejected[0]?.missingParams, `source=${JSON.stringify(source)}`).toEqual(['contexts[0].source']);
      expect(r.written).toEqual([]);
      expect(existsSync(roleDir('bad-source'))).toBe(false);
    }
  });

  it('roleId 非法（路径穿越）⇒ 进 skipped 而非 rejected，合法角色照写 6 件', () => {
    const r = generateConfigPack({
      roles: [{ roleId: '../evil' }, completeSeed({ roleId: 'ok-role' })],
      rootDir: root,
    });
    expect(r.degraded).toBe(true);
    expect(r.skipped.join(' ')).toContain('../evil');
    expect(r.errors.join(' ')).toContain('roleId 非法');
    expect(r.rejected).toEqual([]);
    expect(existsSync(join(root, 'evil'))).toBe(false);
    expect(r.written.length).toBe(6);
    expect(r.written.join(' ')).toContain('ok-role');
  });

  it('空字符串 / 大写 / 下划线 roleId 一律非法（白名单正则）', () => {
    const r = generateConfigPack({
      roles: [{ roleId: '' }, { roleId: 'Finance' }, { roleId: 'a_b' }],
      rootDir: root,
    });
    expect(r.written).toEqual([]);
    expect(r.skipped.length).toBe(3);
    expect(r.rejected).toEqual([]);
  });
});

describe('config-pack-generator — 边界', () => {
  it('J4-7 dry-run 完整 seed ⇒ planned=6、written=[]、文件系统零写入', () => {
    const r = generateConfigPack({ roles: [completeSeed()], rootDir: root, dryRun: true });
    expect(r.written).toEqual([]);
    expect(r.planned.length).toBe(EXPECTED_PIECES.length);
    expect(r.planned.length).toBe(6);
    expect(existsSync(join(root, 'extensions'))).toBe(false);
    expect(r.degraded).toBe(false);
  });

  it('J4-8 dry-run 缺项 ⇒ rejected 非空且 planned=[]（零计划零落盘）', () => {
    const r = generateConfigPack({
      roles: [completeSeed({ contexts: [] })],
      rootDir: root,
      dryRun: true,
    });
    expect(r.planned).toEqual([]);
    expect(r.written).toEqual([]);
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0]?.code).toBe('ROLE_SEED_INCOMPLETE');
    expect(existsSync(join(root, 'extensions'))).toBe(false);
  });

  it('空角色数组 ⇒ 零写入且非 degraded（ENOENT 级正常默认）', () => {
    const r = generateConfigPack({ roles: [], rootDir: root });
    expect(r.written).toEqual([]);
    expect(r.planned).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('重复执行幂等（覆盖写，不报错、不重复计数）', () => {
    const first = generateConfigPack({ roles: [completeSeed()], rootDir: root });
    const second = generateConfigPack({ roles: [completeSeed()], rootDir: root });
    expect(second.written).toEqual(first.written);
    expect(second.errors).toEqual([]);
    expect(second.rejected).toEqual([]);
    expect(readdirSync(roleDir('finance')).length).toBe(6);
  });
});
