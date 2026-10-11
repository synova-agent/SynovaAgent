/**
 * tests/ontology/instance-loading.test.ts — #1057 / K4-03 判据件
 *
 * **搬家对偶**：本件取代 `tests/l4/activity-instance-1057.test.ts`（旧件删除，不并存）。
 *   旧件落点（`extensions/ontology/activity/*.json` 携带评估属性 + 旧实例 `instances/` 子目录）已被
 *   K4-03 卡面改写；旧件里依赖真机 SQLite 的段落（`SYNOVA_1057_INPLACE_DB` / `SYNOVA_1057_REAL_DB`）
 *   与 `data/synova.db` 写入路径断言一并撤除 —— 卡面要求「判据改为**仓内可复跑**」，
 *   且 `data/synova.db` **不在 git 跟踪内**。图存储写入路径属 K4-04 域（见证据件遗留清单）。
 *
 * 卡面（Done 真源）: `.claude/task-briefs/2026-10-11-236-K4-03-作业单元补两件-实例-评估属性.md`
 *
 * 覆盖（铁律 48：正常 / 降级 / 边界 三路径，非空壳）:
 *   正常路径 — ① 隔离 fixture（os.tmpdir() 下的自造仓）走**同一批 loader** 全绿
 *              ② 仓内真件（git 跟踪的交付物）走同一批 loader 全绿（只读盘，零 DB）
 *              ③ [L2] 生产 loader `loadOntology()` 真加载：activity 8 类目 + Schema 层零评估属性
 *   降级路径 — 扩展层/实例层目录缺失、JSON 损坏 ⇒ loader **不抛**，errors 显式可见（铁律 11/24/31）
 *   边界     — 空目录 / 悬空 extends 目标 / 类型错 / 属性缺失或置空 / 无归属属性 / 值不等
 *
 * 判别性夹具（改坏即红，非恒真断言）:
 *   · 从 fixture 删掉扩展件 ⇒ **同一** validateInstance 必报 10 条「未被扩展覆盖」
 *   · 改坏属性值 / 类型 / 归属 ⇒ 对应 violation 逐条出现
 *
 * 契约 (铁律 47):
 *   @input    — 无。仓库根 = `process.cwd()`（vitest cwd = 仓库根）
 *   @output   — vitest 断言；夹具全部落 `os.tmpdir()`，afterAll 清理
 *   @degraded — 无。本件是判据载体，失败即红；loader 的"降级"由返回的 errors 表达并被断言
 *   @零 DB    — 全程不 open 任何 SQLite 文件、不读 `data/synova.db`
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import {
  ACTIVITY_CATEGORIES,
  EVAL_PROPS,
  EXPECTED_INSTANCE,
  EXTENSION_ROOT_REL,
  INSTANCE_ROOT_REL,
  SCHEMA_ACTIVITY_REL,
  extensionPropsFor,
  loadExtensionLayer,
  loadInstanceLayer,
  loadSchemaLayer,
  validateInstance,
} from '../../scripts/control-tower/probe-ontology-instances';
import { loadOntology } from '../../src/l4/ontology-loader';

const REPO_ROOT = process.cwd();
const FIXTURE_BASE = mkdtempSync(join(tmpdir(), 'synova-1057-k4-03-'));
const FIXTURE_ROOT = join(FIXTURE_BASE, 'repo');
const FIXTURE_EXT_DIR = join(FIXTURE_ROOT, EXTENSION_ROOT_REL, 'general-enterprise');
const FIXTURE_INST_DIR = join(FIXTURE_ROOT, INSTANCE_ROOT_REL, EXPECTED_INSTANCE.orgId);

afterAll(() => {
  rmSync(FIXTURE_BASE, { recursive: true, force: true });
});

// ═══ 夹具工厂（隔离 fixture：临时目录自造仓，不依赖真机任何节点/库）═══

function writeJson(rel: string, doc: unknown): void {
  const abs = join(FIXTURE_ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
}

/** fixture 的 10 个评估属性声明（与卡面冻结口径同源：EVAL_PROPS） */
function fixtureEvalPropDecls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of EVAL_PROPS) out[p.name] = p.type;
  return out;
}

function fixtureExtensionDoc(): Record<string, unknown> {
  return {
    $schema: 'https://synova.dev/schemas/ontology-extension-v1.json',
    $id: 'extension/general-enterprise/activity',
    layer: 'extension',
    axis: 'industry',
    axisId: 'general-enterprise',
    extends: ACTIVITY_CATEGORIES.map((c) => `activity/${c}`),
    optionalProps: fixtureEvalPropDecls(),
  };
}

function fixtureInstanceDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'https://synova.dev/schemas/ontology-instance-v1.json',
    instanceVersion: `${EXPECTED_INSTANCE.nodeTypeId.replace('/', '-')}-${EXPECTED_INSTANCE.orgId}-001`,
    type: EXPECTED_INSTANCE.nodeTypeId,
    graph: EXPECTED_INSTANCE.orgId,
    name: '夹具作业单元',
    props: {
      name: '夹具作业单元',
      output_type: '夹具产出',
      ...EXPECTED_INSTANCE.values,
      agent_type_recommendation: `${EXPECTED_INSTANCE.agentTypeRecommendationPrefix} — 夹具占位`,
      ...overrides,
    },
  };
}

/** 造一个"最小可加载仓"：Schema 8 类目 + 扩展层 1 件 + 实例层 1 件 */
function buildValidFixture(): void {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  for (const cat of ACTIVITY_CATEGORIES) {
    writeJson(`${SCHEMA_ACTIVITY_REL}/${cat}.json`, {
      $id: `activity/${cat}`,
      label: cat.toUpperCase(),
      requiredProps: ['name'],
      optionalProps: cat === 'production' ? { output_type: 'string' } : {},
      description: `夹具类目 ${cat}`,
    });
  }
  writeJson(`${EXTENSION_ROOT_REL}/general-enterprise/activity.json`, fixtureExtensionDoc());
  writeJson(
    `${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-production.json`,
    fixtureInstanceDoc(),
  );
}

/** fixture 上的完整加载链（与探针 ④ 段同一实现） */
function loadFixtureChain() {
  const schema = loadSchemaLayer(FIXTURE_ROOT);
  const ext = loadExtensionLayer(FIXTURE_ROOT);
  const inst = loadInstanceLayer(FIXTURE_ROOT);
  const violations = inst.instances.flatMap((d) => validateInstance(d, schema, ext, EXPECTED_INSTANCE));
  return { schema, ext, inst, violations };
}

// ═══════════════════════════════════════════════════════════════
describe('#1057 正常路径 — 隔离 fixture（临时目录自造仓）走同一批 loader', () => {
  it('Schema 面：8 类目、$id 对齐、零 parse 错误', () => {
    buildValidFixture();
    const schema = loadSchemaLayer(FIXTURE_ROOT);
    expect(schema.errors).toEqual([]);
    expect(schema.categories.length).toBe(ACTIVITY_CATEGORIES.length);
    expect(schema.categories.map((c) => c.id).sort()).toEqual(
      ACTIVITY_CATEGORIES.map((c) => `activity/${c}`).sort(),
    );
  });

  it('扩展面：单件声明 → 10 属性 × 8 个 activity 节点类型 全覆盖（名 + 型）', () => {
    buildValidFixture();
    const ext = loadExtensionLayer(FIXTURE_ROOT);
    expect(ext.errors).toEqual([]);
    expect(ext.decls.length).toBe(1);
    for (const cat of ACTIVITY_CATEGORIES) {
      const merged = extensionPropsFor(ext.decls, `activity/${cat}`);
      expect(EVAL_PROPS.filter((p) => !(p.name in merged))).toEqual([]);
      for (const p of EVAL_PROPS) expect(merged[p.name]).toBe(p.type);
    }
  });

  it('实例面 + 加载链：orgId 不变式成立、violations 为空（同实现，非两条码）', () => {
    buildValidFixture();
    const { inst, violations } = loadFixtureChain();
    expect(inst.errors).toEqual([]);
    expect(inst.instances.length).toBe(1);
    expect(inst.instances[0].orgId).toBe(EXPECTED_INSTANCE.orgId);
    expect(inst.instances[0].type).toBe(EXPECTED_INSTANCE.nodeTypeId);
    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('#1057 正常路径 — 仓内真件（git 跟踪交付物，只读盘零 DB）', () => {
  it('真件三面：Schema 8 类目 / 扩展层非空 / 实例在位，且加载链零 violations', () => {
    const schema = loadSchemaLayer(REPO_ROOT);
    const ext = loadExtensionLayer(REPO_ROOT);
    const inst = loadInstanceLayer(REPO_ROOT);
    expect(schema.errors).toEqual([]);
    expect(ext.errors).toEqual([]);
    expect(inst.errors).toEqual([]);
    expect(schema.categories.length).toBe(ACTIVITY_CATEGORIES.length);
    expect(ext.decls.length).toBeGreaterThanOrEqual(1);

    const target = inst.instances.find(
      (d) => d.type === EXPECTED_INSTANCE.nodeTypeId && d.orgId === EXPECTED_INSTANCE.orgId,
    );
    expect(target, `缺冻结作业实例（${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/）`).toBeDefined();
    expect(validateInstance(target!, schema, ext, EXPECTED_INSTANCE)).toEqual([]);
  });

  it('真件实例值：9 个 number 逐条字面相等 + agent_type_recommendation 前缀', () => {
    const inst = loadInstanceLayer(REPO_ROOT);
    const target = inst.instances.find((d) => d.type === EXPECTED_INSTANCE.nodeTypeId)!;
    for (const [name, want] of Object.entries(EXPECTED_INSTANCE.values)) {
      expect(target.props[name], `属性 ${name} 字面值`).toBe(want);
    }
    expect(typeof target.props['agent_type_recommendation']).toBe('string');
    expect(String(target.props['agent_type_recommendation']))
      .toMatch(new RegExp(`^${EXPECTED_INSTANCE.agentTypeRecommendationPrefix}`));
  });

  it('真件 Schema 层零评估属性（属性只在扩展层 —— 本卡冻结口径）', () => {
    const schema = loadSchemaLayer(REPO_ROOT);
    for (const c of schema.categories) {
      const leaked = EVAL_PROPS.filter((p) => p.name in c.optionalProps).map((p) => p.name);
      expect(leaked, `${c.file} 仍在 Schema 层携带评估属性`).toEqual([]);
    }
  });

  it('[L2] 生产 loader 真加载：degraded=false 且 activity 恰好 8 个类型', () => {
    const { ontology, degraded } = loadOntology();
    const activityTypes = ontology.nodeTypes.filter((n) => n.$id.startsWith('activity/'));
    expect(degraded).toBe(false);
    expect(activityTypes.length).toBe(ACTIVITY_CATEGORIES.length);
    expect(activityTypes.map((t) => t.$id).sort()).toEqual(
      ACTIVITY_CATEGORIES.map((c) => `activity/${c}`).sort(),
    );
    // 旧件断言「loader 里 8 类目各带 10 属性」已随落点改写撤除：属性现在**只在扩展层**声明。
    for (const t of activityTypes) {
      const leaked = EVAL_PROPS.filter((p) => p.name in t.optionalProps).map((p) => p.name);
      expect(leaked, `loader 加载到的 ${t.$id} 仍带评估属性`).toEqual([]);
    }
  });

  it('平铺扫描不递归：实例落点不再被生产 loader 当成第 9 个节点类型', () => {
    const { ontology } = loadOntology();
    const ids = ontology.nodeTypes.map((n) => n.$id);
    for (const p of EVAL_PROPS) expect(ids).not.toContain(p.name); // 属性名不是节点类型
    expect(ids.filter((id) => id.startsWith('activity/')).length).toBe(ACTIVITY_CATEGORIES.length);
    expect(ids).not.toContain('activity-production-wani-baby-001');
    // 旧落点已搬走（搬家对偶）：extensions/ontology/activity/instances/ 不再有实例件
    expect(existsSync(join(REPO_ROOT, SCHEMA_ACTIVITY_REL, 'instances'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('#1057 判别性夹具 — 改坏即红（同一判据函数，非恒真断言）', () => {
  it('删掉扩展件 ⇒ 同一 validateInstance 必报 10 条「未被扩展声明覆盖」', () => {
    buildValidFixture();
    const before = loadFixtureChain();
    expect(before.violations).toEqual([]);

    rmSync(FIXTURE_EXT_DIR, { recursive: true, force: true });

    const { ext, violations } = loadFixtureChain();
    const missing = violations.filter((s) => s.includes('未被任何扩展声明覆盖'));
    expect(missing.length).toBe(EVAL_PROPS.length);
    for (const p of EVAL_PROPS) {
      expect(missing.some((s) => s.includes(`'${p.name}'`))).toBe(true);
    }
    expect(ext.decls).toEqual([]);
    expect(ext.errors.some((e) => e.includes('零件'))).toBe(true);
  });

  it('删掉实例件 ⇒ 实例层显式报缺（errors 可见，不静默返回空）', () => {
    buildValidFixture();
    rmSync(FIXTURE_INST_DIR, { recursive: true, force: true });
    const { inst, violations } = loadFixtureChain();
    expect(inst.instances).toEqual([]);
    expect(inst.errors.length).toBeGreaterThan(0);
    expect(violations).toEqual([]); // 零实例 ⇒ 零 violations：**由实例面的 errors 判红**，不是靠 LOAD 段静默通过
  });

  it('改坏属性值 ⇒ 值断言必红（headcount 10 → 42）', () => {
    buildValidFixture();
    writeJson(
      `${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-production.json`,
      fixtureInstanceDoc({ headcount: 42 }),
    );
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("'headcount'") && s.includes('≠ 冻结值'))).toBe(true);
  });

  it('改坏属性类型 ⇒ 类型 + 值双红（structuredness 0.55 → "0.55"）', () => {
    buildValidFixture();
    writeJson(
      `${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-production.json`,
      fixtureInstanceDoc({ structuredness: '0.55' }),
    );
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("'structuredness'") && s.includes('实参类型 string'))).toBe(true);
    expect(violations.some((s) => s.includes("'structuredness'") && s.includes('≠ 冻结值'))).toBe(true);
  });

  it('抹掉一个评估属性 ⇒ 缺失必红（error_rate 删除）', () => {
    buildValidFixture();
    const doc = fixtureInstanceDoc();
    const props = doc['props'] as Record<string, unknown>;
    delete props['error_rate'];
    writeJson(`${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-production.json`, doc);
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("'error_rate'") && s.includes('缺失/为空'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('#1057 降级路径 — loader 不抛异常，errors 显式可见（铁律 11/24/31）', () => {
  it('扩展层目录整个缺失 ⇒ 不抛，errors 点名「零件」且声明为零', () => {
    buildValidFixture();
    rmSync(join(FIXTURE_ROOT, EXTENSION_ROOT_REL), { recursive: true, force: true });
    expect(() => loadExtensionLayer(FIXTURE_ROOT)).not.toThrow();
    const ext = loadExtensionLayer(FIXTURE_ROOT);
    expect(ext.decls).toEqual([]);
    expect(ext.errors.length).toBeGreaterThan(0);
    expect(ext.errors.some((e) => e.includes('零件'))).toBe(true);
  });

  it('扩展件 JSON 损坏 ⇒ 记 errors、跳过该件，不抛', () => {
    buildValidFixture();
    writeFileSync(join(FIXTURE_EXT_DIR, 'broken.json'), '{ "axis": "industry", ', 'utf-8');
    expect(() => loadExtensionLayer(FIXTURE_ROOT)).not.toThrow();
    const ext = loadExtensionLayer(FIXTURE_ROOT);
    expect(ext.decls.length).toBe(1); // 完好件仍被收
    expect(ext.errors.some((e) => e.includes('broken.json'))).toBe(true);
  });

  it('实例件 JSON 损坏 ⇒ 记 errors、实例为零，不抛', () => {
    buildValidFixture();
    writeFileSync(join(FIXTURE_INST_DIR, 'broken.json'), '{ "type": ', 'utf-8');
    expect(() => loadInstanceLayer(FIXTURE_ROOT)).not.toThrow();
    const inst = loadInstanceLayer(FIXTURE_ROOT);
    expect(inst.errors.some((e) => e.includes('broken.json'))).toBe(true);
    expect(inst.instances.every((d) => d.props !== undefined)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('#1057 边界 — 空目录 / 悬空目标 / 无归属 / 轴非法 / 空值', () => {
  it('三面目录全空（自造空仓）⇒ 每面都显式报错，零抛异常', () => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    mkdirSync(join(FIXTURE_ROOT, SCHEMA_ACTIVITY_REL), { recursive: true });
    mkdirSync(join(FIXTURE_ROOT, EXTENSION_ROOT_REL), { recursive: true });
    mkdirSync(join(FIXTURE_ROOT, INSTANCE_ROOT_REL), { recursive: true });
    const schema = loadSchemaLayer(FIXTURE_ROOT);
    const ext = loadExtensionLayer(FIXTURE_ROOT);
    const inst = loadInstanceLayer(FIXTURE_ROOT);
    expect(schema.categories).toEqual([]);
    expect(schema.errors.some((e) => e.includes('零件'))).toBe(true);
    expect(ext.errors.some((e) => e.includes('零件'))).toBe(true);
    expect(inst.errors.some((e) => e.includes('零个'))).toBe(true);
  });

  it('扩展声明悬空 extends 目标 ⇒ 该节点类型拿不到扩展属性 ⇒ 10 条覆盖 violation', () => {
    buildValidFixture();
    const doc = fixtureExtensionDoc();
    doc['extends'] = ['activity/nonexistent'];
    writeJson(`${EXTENSION_ROOT_REL}/general-enterprise/activity.json`, doc);
    const { ext, violations } = loadFixtureChain();
    expect(extensionPropsFor(ext.decls, EXPECTED_INSTANCE.nodeTypeId)).toEqual({});
    expect(violations.filter((s) => s.includes('未被任何扩展声明覆盖')).length).toBe(EVAL_PROPS.length);
  });

  it('扩展声明轴非法（axis="team"）⇒ errors 点名', () => {
    buildValidFixture();
    const doc = fixtureExtensionDoc();
    doc['axis'] = 'team';
    writeJson(`${EXTENSION_ROOT_REL}/general-enterprise/activity.json`, doc);
    const ext = loadExtensionLayer(FIXTURE_ROOT);
    expect(ext.errors.some((e) => e.includes("axis='team' 非法"))).toBe(true);
  });

  it('扩展件 axisId 与目录名不一致 ⇒ errors 点名', () => {
    buildValidFixture();
    const doc = fixtureExtensionDoc();
    doc['axisId'] = 'manufacturing';
    writeJson(`${EXTENSION_ROOT_REL}/general-enterprise/activity.json`, doc);
    const ext = loadExtensionLayer(FIXTURE_ROOT);
    expect(ext.errors.some((e) => e.includes("axisId='manufacturing'"))).toBe(true);
  });

  it('实例含无归属属性（Schema/扩展均未声明）⇒ violation 点名', () => {
    buildValidFixture();
    const doc = fixtureInstanceDoc();
    (doc['props'] as Record<string, unknown>)['shadow_metric'] = 1;
    writeJson(`${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-production.json`, doc);
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("'shadow_metric'") && s.includes('无归属'))).toBe(true);
  });

  it('评估属性置空串 / 目录 orgId 与 graph 不一致 ⇒ 各自 violation 点名', () => {
    buildValidFixture();
    const doc = fixtureInstanceDoc({ unit_labor_cost: '' });
    doc['graph'] = 'other-org';
    writeJson(`${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-production.json`, doc);
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("'unit_labor_cost'") && s.includes('缺失/为空'))).toBe(true);
    expect(violations.some((s) => s.includes("orgId=") && s.includes('doc.graph'))).toBe(true);
  });

  it('Schema 层回潮（评估属性又写回 optionalProps）⇒ violation 点名「只在扩展层声明」', () => {
    buildValidFixture();
    const productionPath = `${SCHEMA_ACTIVITY_REL}/production.json`;
    const schemaDoc = JSON.parse(readFileSync(join(FIXTURE_ROOT, productionPath), 'utf-8')) as Record<string, unknown>;
    schemaDoc['optionalProps'] = { output_type: 'string', headcount: 'number' };
    writeJson(productionPath, schemaDoc);
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("'headcount'") && s.includes('出现在 Schema 层'))).toBe(true);
  });

  it('实例件数 ≥1 但缺冻结作业实例（type 变了）⇒ 面级 errors 不报、加载链靠 type 断言报', () => {
    buildValidFixture();
    const doc = fixtureInstanceDoc();
    doc['type'] = 'activity/learning';
    writeJson(`${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/activity-learning.json`, doc);
    rmSync(join(FIXTURE_INST_DIR, 'activity-production.json'), { force: true });
    const { violations } = loadFixtureChain();
    expect(violations.some((s) => s.includes("≠ 冻结作业单元 'activity/production'"))).toBe(true);
  });

  it('实例落点命名规则：<orgId>/<node-type>.json 一层目录（自造仓实测文件集）', () => {
    buildValidFixture();
    const orgs = readdirSync(join(FIXTURE_ROOT, INSTANCE_ROOT_REL), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(orgs).toEqual([EXPECTED_INSTANCE.orgId]);
    const files = readdirSync(join(FIXTURE_ROOT, INSTANCE_ROOT_REL, EXPECTED_INSTANCE.orgId));
    expect(files).toEqual(['activity-production.json']);
  });
});
