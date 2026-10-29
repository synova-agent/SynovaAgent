#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-ontology-instances.ts — #1057 / K4-03 判据探针
 *   本体三面落点（Schema / 实例 / 扩展）**可被独立跑红**。
 *
 * 卡面（Done 真源）: `.claude/task-briefs/2026-10-11-236-K4-03-作业单元补两件-实例-评估属性.md`
 *   落点（CTO 冻结，实测 local-main 上均 0 件）:
 *     · 实例   `customer-config/ontology-instances/<orgId>/<node-type>.json`
 *     · 扩展   `extensions/ontology/extensions/<industry|profession>/<edge-or-node>.json`
 *     · 探针   本文件      · 判据件 `tests/ontology/instance-loading.test.ts`
 *
 * 四段（**逐段标注级别；禁把 L1-真读盘 报成 L2-生产链消费**）:
 *   ① SCHEMA    [L1] 真读盘 `extensions/ontology/activity/*.json`：恰 8 个类目、$id 逐条对齐；
 *                    且**不含** 10 个评估属性（本卡冻结口径：属性只在扩展层声明，Schema 层零重复）
 *   ② EXTENSION [L1] 真读盘 `extensions/ontology/extensions/**`（**递归**收集声明）：轴合法
 *                    （industry|profession）、`extends` 目标在 Schema 层存在（无悬空）、
 *                    10 个评估属性对**全部 8 个** activity 节点类型**名 + 型**全覆盖
 *   ③ INSTANCE  [L1] 真读盘 `customer-config/ontology-instances/<orgId>/*.json`：orgId == doc.graph、
 *                    type 在 Schema 层存在、10 个评估属性**逐条断言值**（不是"存在"）
 *   ④ LOAD      [L1] 用 ② 的扩展声明 + ① 的 Schema 层「加载」③ 的实例：逐属性校验归属与类型，
 *                    violations 必须为空（删掉扩展层 ⇒ ②④ 必红 ⇒ exit 1）
 *
 * 契约 (铁律 47):
 *   @input    — 无入参。仓库根 = `$SYNOVA_REPO_ROOT` ?? 自 `process.cwd()` 逐级上溯
 *               （须含 `extensions/ontology/activity`）；定位失败 ⇒ exit 2（不静默）
 *   @output   — stdout 四段报告 + 末行 `RESULT=`；末段打印 LIMITS（本探针**证不了**什么）
 *   @degraded — **无降级分支**：任一段失败 ⇒ `[FAIL]` 明细 + exit 1（fail-closed，禁静默放行）；
 *               探针自身异常（定位不到仓库根 / 目录不可读）⇒ exit 2
 *   退出码: 0 = 四段全绿 / 1 = 断言失败 / 2 = 探针自身异常
 *
 * LIMITS（诚实标注，防「接线了 ≠ 被执行」误读）:
 *   · 本探针是 **L1 真读盘**：它证明"三面落点在盘上存在、自洽、值可断言"，
 *     **不**证明任何生产代码路径消费了这两个新落点 —— 当前 `src/l4/ontology-loader.ts:80-97`
 *     只扫 `resource/activity/outcome` 平铺层 ∪ `extensions/industries/<id>/edge-types`，
 *     **不扫** `extensions/ontology/extensions/**` 与 `customer-config/**`；
 *     生产接线不在本卡写集（卡面禁碰 `src/l4/**`）⇒ 属遗留项（见证据件「遗留清单」）。
 *   · 生产 loader 的 L2 面（`loadOntology()` 真加载）由配套判据件
 *     `tests/ontology/instance-loading.test.ts` 承担（vitest 侧有 `@synova/logger` 别名解析）。
 *   · 全程**不读** `data/synova.db`：本文件不 import 任何 store / sqlite 模块，零 DB 依赖。
 *
 * 写集说明: 本文件属 #1057（K4-03）写集；`scripts/control-tower/**` 其余文件**只读不碰**。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ═══════════════════════════════════════════════════════════════════
// 冻结口径（卡面 §C/§D，CTO 冻结；改口径 = 改卡，不许就地放宽）
// ═══════════════════════════════════════════════════════════════════

/** 8 个既有 activity 类目（卡面 §② 实测 8 个；本卡**不新增节点类型**，宪章 P4） */
export const ACTIVITY_CATEGORIES: readonly string[] = [
  'acquisition', 'compliance', 'coordination', 'governance',
  'innovation', 'learning', 'maintenance', 'production',
];

/** 10 个评估属性 + 类型口径（卡面 D-2 名单；批 1 实测 8/8 同名同型） */
export const EVAL_PROPS: readonly EvalProp[] = [
  { name: 'headcount', type: 'number' },
  { name: 'hours_per_run', type: 'number' },
  { name: 'runs_per_period', type: 'number' },
  { name: 'unit_labor_cost', type: 'number' },
  { name: 'error_rate', type: 'number' },
  { name: 'structuredness', type: 'number' },
  { name: 'error_tolerance', type: 'number' },
  { name: 'data_reachability', type: 'number' },
  { name: 'agent_readiness_score', type: 'number' },
  { name: 'agent_type_recommendation', type: 'string' },
];

/** 三面落点（仓库相对路径；扩展层与本探针内均为**目录扫描**口径，不写死文件名） */
export const SCHEMA_ACTIVITY_REL = 'extensions/ontology/activity';
export const EXTENSION_ROOT_REL = 'extensions/ontology/extensions';
export const INSTANCE_ROOT_REL = 'customer-config/ontology-instances';

/** 本卡第一个作业实例（搬自 `extensions/ontology/activity/instances/activity-production-wani-baby-001.json`） */
export const EXPECTED_INSTANCE = {
  orgId: 'wani-baby',
  nodeTypeId: 'activity/production',
  /** 逐条**字面值**断言（内容复用批 1 实例，不重写） */
  values: {
    headcount: 10,
    hours_per_run: 10,
    runs_per_period: 30,
    unit_labor_cost: 88,
    error_rate: 0.02,
    structuredness: 0.55,
    error_tolerance: 0.35,
    data_reachability: 0.2,
    agent_readiness_score: 0.45,
  } as Record<string, number>,
  /** 唯一 string 型属性：断言前缀（全串含全角破折号，逐字断言对控制台编码过敏） */
  agentTypeRecommendationPrefix: 'copilot',
} as const;

export interface EvalProp {
  name: string;
  type: 'number' | 'string';
}

export interface ActivitySchema {
  /** 仓库相对路径 */
  file: string;
  /** `activity/<cat>` */
  id: string;
  requiredProps: string[];
  optionalProps: Record<string, string>;
}

export interface SchemaLayer {
  categories: ActivitySchema[];
  /** 非空 ⇒ 降级可见（parse 失败 / 缺 $id / 件数与冻结口径不符） */
  errors: string[];
}

export interface ExtensionDecl {
  /** 仓库相对路径 */
  file: string;
  /** industry | profession */
  axis: string;
  axisId: string;
  /** 被扩展的节点/边 id 列表（本卡 = 8 个 activity 节点类型） */
  extendsIds: string[];
  optionalProps: Record<string, string>;
}

export interface ExtensionLayer {
  decls: ExtensionDecl[];
  errors: string[];
}

export interface InstanceDoc {
  /** 仓库相对路径 */
  file: string;
  /** 目录名 = 客户 orgId */
  orgId: string;
  type: string;
  graph: string;
  name: string;
  props: Record<string, unknown>;
}

export interface InstanceLayer {
  instances: InstanceDoc[];
  errors: string[];
}

interface JsonOk<T> { ok: true; value: T }
interface JsonErr { ok: false; error: string }

/** 读 + parse；失败**不抛**（返回错误串，由调用方记进 errors —— 铁律 11/24：降级必须可见） */
function readJson<T>(file: string): JsonOk<T> | JsonErr {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf-8')) as T };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${file}: JSON 读取/解析失败 — ${msg}` };
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `Record<string, unknown>` → `Record<string, string>`（值非 string 者原样 JSON 化，类型错由上层判） */
function asStringMap(src: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}

/** 递归收集目录下 `*.json`（相对仓库根、正斜杠、字典序） */
function listJsonFilesRecursive(root: string, relDir: string): string[] {
  const abs = join(root, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), childRel);
      else if (entry.name.endsWith('.json')) out.push(childRel);
    }
  };
  walk(abs, relDir);
  return out;
}

/** 平铺收集目录下 `*.json`（**不递归** —— 与 `src/l4/ontology-loader.ts:59-68` 的 scanDir 同口径） */
function listJsonFilesFlat(root: string, relDir: string): string[] {
  const abs = join(root, relDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `${relDir}/${f}`);
}

/** ① 真读盘 Schema 面：`extensions/ontology/activity/*.json`（平铺 8 件） */
export function loadSchemaLayer(root: string): SchemaLayer {
  const errors: string[] = [];
  const categories: ActivitySchema[] = [];
  const files = listJsonFilesFlat(root, SCHEMA_ACTIVITY_REL);
  if (files.length === 0) {
    errors.push(`Schema 面: ${SCHEMA_ACTIVITY_REL} 零件（或目录不存在）`);
  }
  if (files.length !== ACTIVITY_CATEGORIES.length) {
    errors.push(
      `Schema 面: ${SCHEMA_ACTIVITY_REL} JSON 件数 ${files.length} ≠ 冻结口径 ${ACTIVITY_CATEGORIES.length}`,
    );
  }
  const seen = new Set<string>();
  for (const file of files) {
    const parsed = readJson<Record<string, unknown>>(join(root, file));
    if (!parsed.ok) { errors.push(`Schema 面: ${parsed.error}`); continue; }
    const doc = parsed.value;
    const id = typeof doc['$id'] === 'string' ? doc['$id'] : '';
    if (id === '') { errors.push(`Schema 面: ${file} 缺 $id`); continue; }
    if (seen.has(id)) errors.push(`Schema 面: $id 重复 ${id}（${file}）`);
    seen.add(id);
    const optionalProps = isPlainObject(doc['optionalProps']) ? asStringMap(doc['optionalProps']) : {};
    const requiredProps = Array.isArray(doc['requiredProps'])
      ? (doc['requiredProps'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    categories.push({ file, id, requiredProps, optionalProps });
  }
  const expected = ACTIVITY_CATEGORIES.map((c) => `activity/${c}`).sort();
  const actual = categories.map((c) => c.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `Schema 面: activity $id 集与冻结口径不等 —— 期望 [${expected.join(', ')}] 实测 [${actual.join(', ')}]`,
    );
  }
  return { categories, errors };
}

/** ② 真读盘扩展面：`extensions/ontology/extensions/**`（递归收集声明） */
export function loadExtensionLayer(root: string): ExtensionLayer {
  const errors: string[] = [];
  const decls: ExtensionDecl[] = [];
  const files = listJsonFilesRecursive(root, EXTENSION_ROOT_REL);
  if (files.length === 0) {
    errors.push(
      `扩展面: ${EXTENSION_ROOT_REL}/ 零件（或目录不存在）—— 卡面 Done ② 的反例点（删掉扩展层 ⇒ 本段必红）`,
    );
  }
  for (const file of files) {
    const parsed = readJson<Record<string, unknown>>(join(root, file));
    if (!parsed.ok) { errors.push(`扩展面: ${parsed.error}`); continue; }
    const doc = parsed.value;
    const axis = typeof doc['axis'] === 'string' ? doc['axis'] : '';
    const axisId = typeof doc['axisId'] === 'string' ? doc['axisId'] : '';
    const extendsIds = Array.isArray(doc['extends'])
      ? (doc['extends'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const optionalProps = isPlainObject(doc['optionalProps']) ? asStringMap(doc['optionalProps']) : {};
    if (axis !== 'industry' && axis !== 'profession') {
      errors.push(`扩展面: ${file} axis='${axis}' 非法（须 industry|profession）`);
    }
    const dirAxisId = file.split('/').slice(-2, -1)[0] ?? ''; // <axisId>/<file>.json
    if (axisId === '') errors.push(`扩展面: ${file} 缺 axisId`);
    else if (axisId !== dirAxisId) errors.push(`扩展面: ${file} axisId='${axisId}' ≠ 目录名 '${dirAxisId}'`);
    if (extendsIds.length === 0) errors.push(`扩展面: ${file} extends 为空（无扩展目标）`);
    if (Object.keys(optionalProps).length === 0) errors.push(`扩展面: ${file} optionalProps 为空`);
    decls.push({ file, axis, axisId, extendsIds, optionalProps });
  }
  return { decls, errors };
}

/** 合并扩展声明 → 某节点类型可见的扩展属性（同一属性被多份声明覆盖 ⇒ 后者按文件字典序） */
export function extensionPropsFor(decls: ExtensionDecl[], nodeTypeId: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const d of decls) {
    if (!d.extendsIds.includes(nodeTypeId)) continue;
    for (const [k, v] of Object.entries(d.optionalProps)) merged[k] = v;
  }
  return merged;
}

/** ③ 真读盘实例面：`customer-config/ontology-instances/<orgId>/*.json`（一层 orgId + 平铺件） */
export function loadInstanceLayer(root: string): InstanceLayer {
  const errors: string[] = [];
  const instances: InstanceDoc[] = [];
  const absRoot = join(root, INSTANCE_ROOT_REL);
  if (!existsSync(absRoot)) {
    errors.push(`实例面: ${INSTANCE_ROOT_REL}/ 不存在（或零件）`);
    return { instances, errors };
  }
  const orgDirs = readdirSync(absRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (orgDirs.length === 0) errors.push(`实例面: ${INSTANCE_ROOT_REL}/ 下零个 <orgId>/ 目录`);
  for (const orgId of orgDirs) {
    const files = listJsonFilesFlat(root, `${INSTANCE_ROOT_REL}/${orgId}`);
    if (files.length === 0) errors.push(`实例面: ${INSTANCE_ROOT_REL}/${orgId}/ 零件`);
    for (const file of files) {
      const parsed = readJson<Record<string, unknown>>(join(root, file));
      if (!parsed.ok) { errors.push(`实例面: ${parsed.error}`); continue; }
      const doc = parsed.value;
      const props = isPlainObject(doc['props']) ? doc['props'] : {};
      instances.push({
        file,
        orgId,
        type: typeof doc['type'] === 'string' ? doc['type'] : '',
        graph: typeof doc['graph'] === 'string' ? doc['graph'] : '',
        name: typeof doc['name'] === 'string' ? doc['name'] : '',
        props,
      });
    }
  }
  return { instances, errors };
}

/**
 * ④ 加载链校验：用 Schema 面 + 扩展面「加载」实例，返回 violations（空 = 通过）。
 *
 * 判据（每条都可单点改坏 ⇒ 红）:
 *   · `type` 必须在 Schema 面的 $id 集里（实例不得新造节点类型 —— 宪章 P4）
 *   · orgId 必须 == doc.graph（命名规则 `<orgId>/<node-type>.json` 的内容侧不变式）
 *   · 实例每个 prop 必须**有归属**：Schema 的 requiredProps ∪ optionalProps ∪ 该节点类型的扩展属性
 *   · 10 个评估属性必须**来自扩展层**（Schema 层零声明 —— 本卡冻结口径）
 *   · 10 个评估属性的实参类型必须与「扩展声明类型」和「冻结类型」一致，且非空
 *   · `expected` 给出的字面值必须逐条相等（断言值，不是断言存在）
 */
export function validateInstance(
  inst: InstanceDoc,
  schema: SchemaLayer,
  ext: ExtensionLayer,
  expected?: typeof EXPECTED_INSTANCE,
): string[] {
  const v: string[] = [];
  const schemaIds = new Set(schema.categories.map((c) => c.id));
  const cat = schema.categories.find((c) => c.id === inst.type);

  if (!schemaIds.has(inst.type)) {
    v.push(`${inst.file}: type='${inst.type}' 不在 Schema 层 $id 集（禁新造节点类型）`);
  }
  if (inst.graph === '') v.push(`${inst.file}: graph 为空`);
  if (inst.orgId !== inst.graph) {
    v.push(`${inst.file}: 目录 orgId='${inst.orgId}' ≠ doc.graph='${inst.graph}'`);
  }
  if (cat === undefined) return v;

  const extProps = extensionPropsFor(ext.decls, inst.type);
  const declared = new Set<string>([...cat.requiredProps, ...Object.keys(cat.optionalProps), ...Object.keys(extProps)]);

  for (const key of Object.keys(inst.props)) {
    if (!declared.has(key)) {
      v.push(`${inst.file}: prop '${key}' 在 Schema 层与扩展层均无声明（无归属）`);
    }
  }

  for (const spec of EVAL_PROPS) {
    const value = inst.props[spec.name];
    const fromSchema = spec.name in cat.optionalProps;
    const fromExt = spec.name in extProps;
    if (fromSchema) {
      v.push(`${inst.file}: 评估属性 '${spec.name}' 出现在 Schema 层（本卡冻结口径：只在扩展层声明）`);
    }
    if (!fromExt) {
      v.push(`${inst.file}: 评估属性 '${spec.name}' 未被任何扩展声明覆盖（${inst.type}）`);
    } else if (extProps[spec.name] !== spec.type) {
      v.push(`${inst.file}: 扩展声明 '${spec.name}' 类型 ${extProps[spec.name]} ≠ 冻结口径 ${spec.type}`);
    }
    if (value === undefined || value === null || value === '') {
      v.push(`${inst.file}: 评估属性 '${spec.name}' 缺失/为空`);
      continue;
    }
    if (typeof value !== spec.type) {
      v.push(`${inst.file}: 评估属性 '${spec.name}' 实参类型 ${typeof value} ≠ 冻结口径 ${spec.type}`);
    }
  }

  if (expected !== undefined) {
    if (inst.type !== expected.nodeTypeId) {
      v.push(`${inst.file}: type='${inst.type}' ≠ 冻结作业单元 '${expected.nodeTypeId}'`);
    }
    if (inst.orgId !== expected.orgId) {
      v.push(`${inst.file}: orgId='${inst.orgId}' ≠ 冻结 orgId '${expected.orgId}'`);
    }
    for (const [name, want] of Object.entries(expected.values)) {
      if (inst.props[name] !== want) {
        v.push(`${inst.file}: 属性 '${name}' 实参 ${JSON.stringify(inst.props[name])} ≠ 冻结值 ${JSON.stringify(want)}`);
      }
    }
    const rec = inst.props['agent_type_recommendation'];
    if (typeof rec !== 'string' || !rec.startsWith(expected.agentTypeRecommendationPrefix)) {
      v.push(
        `${inst.file}: agent_type_recommendation 实参 ${JSON.stringify(rec)} 不以 ` +
        `'${expected.agentTypeRecommendationPrefix}' 开头（冻结值口径）`,
      );
    }
  }
  return v;
}

/** 仓库根定位：`$SYNOVA_REPO_ROOT` ?? 自 cwd 上溯（须含 Schema 面目录） */
export function locateRepoRoot(startDir: string = process.cwd()): string {
  const candidates: string[] = [];
  if (process.env['SYNOVA_REPO_ROOT']) candidates.push(process.env['SYNOVA_REPO_ROOT']);
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const c of candidates) {
    if (existsSync(join(c, SCHEMA_ACTIVITY_REL))) return c;
  }
  throw new Error(
    `无法定位仓库根（已试 ${candidates.length} 个候选：${candidates.join(' | ')}）；` +
      '请设 SYNOVA_REPO_ROOT 或在仓库内运行',
  );
}

// ═══════════════════════════════════════════════════════════════════
// 探针主流程
// ═══════════════════════════════════════════════════════════════════

const SECTIONS: string[] = [];
const FAILURES: string[] = [];

function section(title: string): void {
  SECTIONS.push(title);
  console.log(`\n── ${title} ──`);
}

function ok(msg: string): void {
  console.log(`  [ok]   ${msg}`);
}

function fail(msg: string): void {
  FAILURES.push(msg);
  console.log(`  [FAIL] ${msg}`);
}

function note(msg: string): void {
  console.log(`  [note] ${msg}`);
}

async function main(): Promise<number> {
  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    console.error(`[FAIL] probe-bootstrap: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  console.log(`PROBE_REPO_ROOT: ${root}`);
  console.log(`PROBE_LANDINGS: schema=${SCHEMA_ACTIVITY_REL} extension=${EXTENSION_ROOT_REL}/** instance=${INSTANCE_ROOT_REL}/<orgId>/`);

  // ═══ ① SCHEMA [L1] ═══
  section('① SCHEMA [L1] — activity 8 类目 × 零评估属性（属性只在扩展层）');
  const schema = loadSchemaLayer(root);
  for (const e of schema.errors) fail(e);
  console.log(`  activity 类目件数: ${schema.categories.length} / 冻结口径 ${ACTIVITY_CATEGORIES.length}`);
  console.log(`  $id: ${schema.categories.map((c) => c.id).join(', ')}`);
  if (schema.errors.length === 0) ok('8 类目齐全、$id 与冻结口径逐条对齐');
  for (const c of schema.categories) {
    const leaked = EVAL_PROPS.filter((p) => p.name in c.optionalProps).map((p) => p.name);
    if (leaked.length > 0) {
      fail(`${c.file}: Schema 层仍含评估属性 [${leaked.join(', ')}]（本卡口径：已搬到扩展层）`);
    }
  }
  if (FAILURES.length === 0) ok('Schema 层零评估属性（已回退 trunk 原样）');

  // ═══ ② EXTENSION [L1] ═══
  section('② EXTENSION [L1] — 扩展面声明：轴合法 / 无悬空 / 10 属性 × 8 节点全覆盖');
  const ext = loadExtensionLayer(root);
  for (const e of ext.errors) fail(e);
  console.log(`  扩展声明件数: ${ext.decls.length}`);
  const schemaIds = new Set(schema.categories.map((c) => c.id));
  for (const d of ext.decls) {
    console.log(`  · ${d.file} axis=${d.axis} axisId=${d.axisId} extends=[${d.extendsIds.join(', ')}] props=${Object.keys(d.optionalProps).length}`);
    for (const id of d.extendsIds) {
      if (!schemaIds.has(id)) fail(`${d.file}: extends 目标 '${id}' 不在 Schema 层（悬空扩展）`);
    }
  }
  const coverageRows: string[] = [];
  for (const id of ACTIVITY_CATEGORIES.map((c) => `activity/${c}`)) {
    const merged = extensionPropsFor(ext.decls, id);
    const missing = EVAL_PROPS.filter((p) => !(p.name in merged)).map((p) => p.name);
    const wrong = EVAL_PROPS.filter((p) => p.name in merged && merged[p.name] !== p.type)
      .map((p) => `${p.name}:${merged[p.name]}≠${p.type}`);
    if (missing.length > 0) fail(`${id}: 扩展层缺评估属性 [${missing.join(', ')}]`);
    if (wrong.length > 0) fail(`${id}: 扩展层类型口径不符 [${wrong.join(', ')}]`);
    coverageRows.push(`${id}=${EVAL_PROPS.length - missing.length}/10`);
  }
  console.log(`  覆盖: ${coverageRows.join('  ')}`);
  if (ext.decls.length > 0 && coverageRows.every((r) => r.endsWith('10/10'))) {
    ok('10 评估属性 × 8 个 activity 节点类型 全覆盖（名 + 型）');
  }

  // ═══ ③ INSTANCE [L1] ═══
  section('③ INSTANCE [L1] — 实例面：orgId 不变式 / 归属 / 逐条断言值');
  const inst = loadInstanceLayer(root);
  for (const e of inst.errors) fail(e);
  console.log(`  实例件数: ${inst.instances.length}`);
  for (const doc of inst.instances) {
    console.log(`  · ${doc.file} orgId=${doc.orgId} type=${doc.type} graph=${doc.graph} props=${Object.keys(doc.props).length}`);
  }
  const target = inst.instances.find(
    (d) => d.type === EXPECTED_INSTANCE.nodeTypeId && d.orgId === EXPECTED_INSTANCE.orgId,
  );
  if (target === undefined) {
    fail(`实例面: 未找到冻结作业实例（${INSTANCE_ROOT_REL}/${EXPECTED_INSTANCE.orgId}/ + type=${EXPECTED_INSTANCE.nodeTypeId}）`);
  } else {
    const rows = EVAL_PROPS.map((p) => `${p.name}=${JSON.stringify(target.props[p.name])}`);
    console.log(`  断言值: ${rows.join(' ')}`);
    ok(`冻结作业实例在位: ${target.file}（name='${target.name}'）`);
  }

  // ═══ ④ LOAD [L1] ═══
  section('④ LOAD [L1] — 用 Schema + 扩展「加载」实例：归属 / 类型 / 值 三关');
  const violations: string[] = [];
  for (const doc of inst.instances) {
    violations.push(...validateInstance(doc, schema, ext, EXPECTED_INSTANCE));
  }
  if (violations.length > 0) {
    for (const s of violations) fail(`LOAD: ${s}`);
  } else {
    ok(`加载链零 violations（${inst.instances.length} 件实例 × Schema ${schema.categories.length} 类目 × 扩展声明 ${ext.decls.length} 件）`);
  }

  // ═══ SUMMARY ═══
  console.log('\n── LIMITS（本探针证不了什么）──');
  note('本探针是 L1 真读盘：三面落点存在/自洽/值可断言 —— **不**证明生产链已消费这两个新落点');
  note('生产 loader（src/l4/ontology-loader.ts:80-97）当前只扫 resource/activity/outcome 平铺层 ∪ industries/*/edge-types；');
  note('  不扫 extensions/ontology/extensions/** 与 customer-config/** ⇒ 生产接线属遗留项（本卡写集禁碰 src/l4/**）');
  note('全程零 DB：本探针不 import 任何 store/sqlite 模块，不读 data/synova.db');

  console.log(`\nSUMMARY: sections=${SECTIONS.length} failures=${FAILURES.length}`);
  if (FAILURES.length > 0) {
    console.log('FAILURES:');
    for (const f of FAILURES) console.log(`  - ${f}`);
    console.log('RESULT=FAIL');
    return 1;
  }
  console.log('RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）');
  return 0;
}

/** 直接执行（`npx tsx <本文件>`）才跑 main；被 vitest import 时不跑（判据件复用同一批 loader） */
function isDirectRun(): boolean {
  const arg = process.argv[1];
  if (arg === undefined || arg === '') return false;
  try {
    return statSync(arg).isFile() && fileURLToPath(import.meta.url) === arg;
  } catch {
    // argv[1] 不是可读文件（例如 vitest 运行时）⇒ 判「非直接执行」，不是错误；
    // 此处不 log：判定结果由调用点决定，且探针的失败语义走 exit code（铁律 11 的"降级可见"不适用于"非直接执行"这一正常分支）
    return false;
  }
}

if (isDirectRun()) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(`[FAIL] probe-bootstrap 未捕获异常: ${err instanceof Error ? err.stack : String(err)}`);
      process.exit(2);
    });
}
