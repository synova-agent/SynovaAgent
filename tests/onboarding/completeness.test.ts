/**
 * tests/onboarding/completeness.test.ts — K12-02 建档内容包（L0/L1 采集方法）完整性判定
 *
 * 判据源: docs/synova/coordination/施工项登记.ts → K12-02（Issue #185）
 *   `npx vitest run tests/onboarding/completeness.test.ts` ⇒ exit 0
 *
 * 契约（铁律 47）:
 *   @input    — extensions/onboarding/{manifest.json, what-to-ask.yaml, completeness.yaml,
 *               industries/general-enterprise.yaml}
 *               ＋ 本体词表（只读真源）extensions/ontology/{resource,outcome,activity}/*.json ∪ edge-types/*.json
 *   @output   — Report { ok, degraded, problems[], questions[], layerCounts, uncoveredNodes[] }
 *                 · ok=false ⇔ problems 非空（**任何**问题项都不得让 ok 保持 true）
 *                 · problems[].code ∈ 闭合枚举（见 ProblemCode）
 *               ＋ nextQuestionIds(pack, filledOntologyIds) — 有穷且闭合：全填 ⇒ []
 *   @degraded — 缺文件 / 缺必需字段 / 悬空映射 / 配置自伤 ⇒ ok=false ＋ degraded=true
 *               ＋ problems 逐项列出「缺哪一项」（**禁静默通过**，铁律 11/24/31）；不抛错
 *
 * 覆盖（铁律 48）: 正常路径 / 降级路径（缺文件、缺字段、缺配置、坏语法）/ 边界（空集、单元素、
 *   重复 id、全填闭合、少填一个不复闭合）
 * 反例判别性（V-08 改坏即红）: 从任一采集项删掉一个必需字段 ⇒ 本文件必红；
 *   某项 mapsTo 指向不存在的本体 id ⇒ 必红（两条都在降级段实测）
 *
 * 说明: 本文件是 K12-02 的**机器真源**（本卡为纯内容包、不接线）——
 *   校验逻辑随判据同行，不建 src 侧 loader（宿主侧装配属 EXT-WIRE #1465 / K12-03 #186）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as parseYaml, dump as dumpYaml } from 'js-yaml';
import { createLogger } from '@synova/logger';

const log = createLogger('onboarding/completeness');

const REPO_ROOT = process.cwd();
const PKG_ROOT = join(REPO_ROOT, 'extensions', 'onboarding');
const ONTOLOGY_ROOT = join(REPO_ROOT, 'extensions', 'ontology');

const MANIFEST_FILE = 'manifest.json';
const WHAT_TO_ASK_FILE = 'what-to-ask.yaml';
const COMPLETENESS_FILE = 'completeness.yaml';
const INDUSTRY_DIR = 'industries';
const INDUSTRY_FILE = 'general-enterprise.yaml';

/** manifest 必填字段（与 pre-commit 第 8 组 check-file-driven.sh 同口径）。 */
const MANIFEST_REQUIRED_FIELDS = ['$schema', 'name', 'version', 'type', 'entryPoint'];

/** 本体节点族目录（节点词表真源）。 */
const NODE_FAMILIES = ['resource', 'outcome', 'activity'];
/** 本体边目录（边词表真源）。 */
const EDGE_FAMILY = 'edge-types';

type ProblemCode =
  | 'missing-file'
  | 'bad-syntax'
  | 'not-object'
  | 'bad-config'
  | 'missing-field'
  | 'empty-field'
  | 'duplicate-id'
  | 'bad-id'
  | 'unknown-layer'
  | 'missing-layer'
  | 'below-min'
  | 'dangling-mapping'
  | 'uncovered-node';

interface Problem {
  code: ProblemCode;
  file: string;
  detail: string;
}

interface AskItem {
  id: string;
  layer: string;
  ask: string;
  why: string;
  mapsTo: string[];
  required: boolean;
}

interface Vocabulary {
  nodes: string[];
  edges: string[];
  all: Set<string>;
}

interface LayerSpec {
  displayName: string;
  minQuestions: number;
}

interface PackConfig {
  requiredFields: string[];
  layers: Record<string, LayerSpec>;
  idPattern: string;
  coverageNodes: 'all' | 'partial';
  requiredIndustryFiles: string[];
}

interface Pack {
  root: string;
  manifest: Record<string, unknown> | null;
  config: PackConfig | null;
  questions: AskItem[];
  vocabulary: Vocabulary;
  problems: Problem[];
}

interface Report {
  ok: boolean;
  degraded: boolean;
  problems: Problem[];
  questions: AskItem[];
  layerCounts: Record<string, number>;
  uncoveredNodes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (!isNonEmptyString(v)) return null;
    out.push(v);
  }
  return out;
}

/** 读 JSON/YAML → 记录；失败一律落 problems（不抛）。 */
function readRecordFile(
  file: string,
  label: string,
  kind: 'json' | 'yaml',
  problems: Problem[],
): Record<string, unknown> | null {
  if (!existsSync(file)) {
    problems.push({ code: 'missing-file', file: label, detail: `文件不存在: ${label}` });
    return null;
  }
  let raw: unknown;
  try {
    const text = readFileSync(file, 'utf-8');
    raw = kind === 'json' ? JSON.parse(text) : parseYaml(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    problems.push({ code: 'bad-syntax', file: label, detail: `解析失败: ${msg}` });
    return null;
  }
  if (!isRecord(raw)) {
    problems.push({ code: 'not-object', file: label, detail: `顶层不是对象（实测 ${typeof raw}）` });
    return null;
  }
  return raw;
}

/** 本体词表（29 节点族 + 边族）—— 只读真源，非本包内容；从磁盘实读，非硬编码。 */
function loadVocabulary(problems: Problem[], ontologyRoot: string = ONTOLOGY_ROOT): Vocabulary {
  const nodes: string[] = [];
  const edges: string[] = [];

  const collect = (dir: string, label: string, sink: string[]): void => {
    if (!existsSync(dir)) {
      problems.push({ code: 'missing-file', file: label, detail: `本体词表目录不存在: ${label}` });
      return;
    }
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const rec = readRecordFile(join(dir, name), `${label}/${name}`, 'json', problems);
      const id = rec === null ? undefined : rec['$id'];
      if (isNonEmptyString(id)) sink.push(id);
      else problems.push({ code: 'bad-config', file: `${label}/${name}`, detail: '本体文件缺少 $id' });
    }
  };

  for (const family of NODE_FAMILIES) collect(join(ontologyRoot, family), `extensions/ontology/${family}`, nodes);
  collect(join(ontologyRoot, EDGE_FAMILY), `extensions/ontology/${EDGE_FAMILY}`, edges);

  const nodeSet = [...new Set(nodes)].sort();
  const edgeSet = [...new Set(edges)].sort();
  return { nodes: nodeSet, edges: edgeSet, all: new Set([...nodeSet, ...edgeSet]) };
}

/** completeness.yaml → 判定口径；自身缺字段 ⇒ bad-config（不得退化为「无口径 = 通过」）。 */
function parseConfig(doc: Record<string, unknown> | null, problems: Problem[]): PackConfig | null {
  if (doc === null) return null;

  const requiredFields = asStringArray(doc.requiredFields);
  if (requiredFields === null || requiredFields.length === 0) {
    problems.push({ code: 'bad-config', file: COMPLETENESS_FILE, detail: '缺少 requiredFields（判定口径自伤）' });
    return null;
  }

  const rawLayers = doc.layers;
  if (!isRecord(rawLayers) || Object.keys(rawLayers).length === 0) {
    problems.push({ code: 'bad-config', file: COMPLETENESS_FILE, detail: '缺少 layers（判定口径自伤）' });
    return null;
  }
  const layers: Record<string, LayerSpec> = {};
  for (const [name, spec] of Object.entries(rawLayers)) {
    if (!isRecord(spec) || typeof spec.minQuestions !== 'number' || !isNonEmptyString(spec.displayName)) {
      problems.push({ code: 'bad-config', file: COMPLETENESS_FILE, detail: `层 ${name} 缺少 displayName/minQuestions` });
      continue;
    }
    layers[name] = { displayName: spec.displayName, minQuestions: spec.minQuestions };
  }
  if (Object.keys(layers).length === 0) return null;

  const idPattern = isNonEmptyString(doc.idPattern) ? doc.idPattern : '^q-[a-z0-9-]+$';

  let coverageNodes: 'all' | 'partial' = 'partial';
  if (isRecord(doc.coverage) && doc.coverage.nodes === 'all') coverageNodes = 'all';

  let requiredIndustryFiles: string[] = [];
  if (isRecord(doc.industryOverlays)) {
    const listed = asStringArray(doc.industryOverlays.required);
    if (listed !== null) requiredIndustryFiles = listed;
  }

  return { requiredFields, layers, idPattern, coverageNodes, requiredIndustryFiles };
}

/** 从一份 what-to-ask 形状的文档抽采集项；缺字段项**照样上报**（不静默丢弃）。 */
function parseQuestions(
  doc: Record<string, unknown> | null,
  label: string,
  config: PackConfig | null,
  problems: Problem[],
): AskItem[] {
  if (doc === null) return [];
  const required = config === null ? ['id', 'layer', 'ask', 'why', 'mapsTo', 'required'] : config.requiredFields;
  const raw = doc.questions;
  if (!Array.isArray(raw)) {
    problems.push({ code: 'missing-field', file: label, detail: `${label}.questions 缺失或不是数组` });
    return [];
  }

  const items: AskItem[] = [];
  const seen = new Map<string, number>();
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push({ code: 'not-object', file: label, detail: `questions[${index}] 不是对象` });
      return;
    }
    const itemId = isNonEmptyString(entry.id) ? entry.id : `questions[${index}]`;

    for (const field of required) {
      if (!(field in entry)) {
        problems.push({ code: 'missing-field', file: label, detail: `缺必需字段: ${itemId}.${field}` });
        continue;
      }
      const value = entry[field];
      const empty =
        value === null || value === undefined || (typeof value === 'string' && value.trim().length === 0) ||
        (Array.isArray(value) && value.length === 0);
      if (empty) {
        problems.push({ code: 'empty-field', file: label, detail: `必需字段为空: ${itemId}.${field}` });
      }
    }

    const mapsTo = asStringArray(entry.mapsTo);
    if (mapsTo === null) {
      problems.push({ code: 'missing-field', file: label, detail: `${itemId}.mapsTo 必须是非空字符串数组` });
    }
    if (!isNonEmptyString(entry.id) || !isNonEmptyString(entry.layer)) return;

    seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
    if (seen.get(entry.id) === 2) {
      problems.push({ code: 'duplicate-id', file: label, detail: `采集项 id 重复: ${entry.id}` });
    }
    if (config !== null && !new RegExp(config.idPattern).test(entry.id)) {
      problems.push({ code: 'bad-id', file: label, detail: `id 不符合形态 ${config.idPattern}: ${entry.id}` });
    }
    if (config !== null && !(entry.layer in config.layers)) {
      problems.push({ code: 'unknown-layer', file: label, detail: `未知层: ${entry.id} → ${entry.layer}` });
    }

    items.push({
      id: entry.id,
      layer: entry.layer,
      ask: isNonEmptyString(entry.ask) ? entry.ask : '',
      why: isNonEmptyString(entry.why) ? entry.why : '',
      mapsTo: mapsTo ?? [],
      required: entry.required === true,
    });
  });
  return items;
}

/** 行业覆盖层：同规则（悬空 / 缺字段 / 未知层一律不完整）。 */
function loadIndustryQuestions(
  root: string,
  config: PackConfig | null,
  problems: Problem[],
): AskItem[] {
  const dir = join(root, INDUSTRY_DIR);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort() : [];
  const required = config === null ? [] : config.requiredIndustryFiles;
  for (const want of required) {
    if (!names.includes(`${want}.yaml`)) {
      problems.push({ code: 'missing-file', file: `${INDUSTRY_DIR}/${want}.yaml`, detail: `行业覆盖层缺失: ${want}` });
    }
  }
  const items: AskItem[] = [];
  for (const name of names) {
    const label = `${INDUSTRY_DIR}/${name}`;
    const doc = readRecordFile(join(dir, name), label, 'yaml', problems);
    const overlayRaw = doc === null ? undefined : doc.overlayQuestions;
    if (!Array.isArray(overlayRaw)) {
      problems.push({ code: 'missing-field', file: label, detail: `${label}.overlayQuestions 缺失或不是数组` });
      continue;
    }
    for (const item of parseQuestions({ questions: overlayRaw }, label, config, problems)) items.push(item);
  }
  return items;
}

function loadPack(root: string = PKG_ROOT, ontologyRoot: string = ONTOLOGY_ROOT): Pack {
  const problems: Problem[] = [];
  const vocabulary = loadVocabulary(problems, ontologyRoot);
  const manifest = readRecordFile(join(root, MANIFEST_FILE), MANIFEST_FILE, 'json', problems);
  if (manifest !== null) {
    for (const field of MANIFEST_REQUIRED_FIELDS) {
      if (!isNonEmptyString(manifest[field])) {
        problems.push({ code: 'missing-field', file: MANIFEST_FILE, detail: `manifest 缺必填字段: ${field}` });
      }
    }
  }
  const completeness = readRecordFile(join(root, COMPLETENESS_FILE), COMPLETENESS_FILE, 'yaml', problems);
  const config = parseConfig(completeness, problems);
  const whatToAsk = readRecordFile(join(root, WHAT_TO_ASK_FILE), WHAT_TO_ASK_FILE, 'yaml', problems);
  const questions = parseQuestions(whatToAsk, WHAT_TO_ASK_FILE, config, problems);
  const overlay = loadIndustryQuestions(root, config, problems);
  return { root, manifest, config, questions: [...questions, ...overlay], vocabulary, problems };
}

function validate(pack: Pack): Report {
  const problems: Problem[] = [...pack.problems];
  const config = pack.config;
  const layerCounts: Record<string, number> = {};

  for (const item of pack.questions) {
    layerCounts[item.layer] = (layerCounts[item.layer] ?? 0) + 1;
    for (const ref of item.mapsTo) {
      if (!pack.vocabulary.all.has(ref)) {
        problems.push({ code: 'dangling-mapping', file: item.id, detail: `mapsTo 指向不存在的本体 id: ${ref}（${item.id}）` });
      }
    }
  }

  if (config !== null) {
    for (const [name, spec] of Object.entries(config.layers)) {
      const count = layerCounts[name] ?? 0;
      if (count === 0) {
        problems.push({ code: 'missing-layer', file: WHAT_TO_ASK_FILE, detail: `层 ${name} 无任何采集项（要求 ≥${spec.minQuestions}）` });
      } else if (count < spec.minQuestions) {
        problems.push({ code: 'below-min', file: WHAT_TO_ASK_FILE, detail: `层 ${name} 仅 ${count} 项，低于最小题量 ${spec.minQuestions}` });
      }
    }
  }

  const mappedNodes = new Set<string>();
  for (const item of pack.questions) {
    for (const ref of item.mapsTo) if (pack.vocabulary.nodes.includes(ref)) mappedNodes.add(ref);
  }
  const uncoveredNodes = pack.vocabulary.nodes.filter((n) => !mappedNodes.has(n));
  if (config !== null && config.coverageNodes === 'all' && uncoveredNodes.length > 0) {
    for (const node of uncoveredNodes) {
      problems.push({ code: 'uncovered-node', file: WHAT_TO_ASK_FILE, detail: `本体节点未被任何采集项命中: ${node}` });
    }
  }

  return {
    ok: problems.length === 0,
    degraded: problems.length > 0,
    problems,
    questions: pack.questions,
    layerCounts,
    uncoveredNodes,
  };
}

/** 有穷且闭合: 给定「已填本体 id」，返回仍需追问的 item id（升序 ⇒ 确定性）。 */
function nextQuestionIds(pack: Pack, filledOntologyIds: readonly string[]): string[] {
  const filled = new Set(filledOntologyIds);
  return pack.questions
    .filter((item) => !item.mapsTo.every((ref) => filled.has(ref)))
    .map((item) => item.id)
    .sort();
}

function allMappedRefs(pack: Pack): string[] {
  const refs = new Set<string>();
  for (const item of pack.questions) for (const ref of item.mapsTo) refs.add(ref);
  return [...refs].sort();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 夹具: 临时副本（用于降级路径；真包只读，绝不被测试改动）
// ═══════════════════════════════════════════════════════════════════════════════
const TEMP_DIRS: string[] = [];

function clonePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'k12-02-onboarding-'));
  cpSync(PKG_ROOT, dir, { recursive: true });
  TEMP_DIRS.push(dir);
  return dir;
}

function writeYamlAt(file: string, doc: Record<string, unknown>): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, dumpYaml(doc), 'utf-8');
}

function readRealDoc(file: string): Record<string, unknown> {
  const raw: unknown = parseYaml(readFileSync(join(PKG_ROOT, file), 'utf-8'));
  if (!isRecord(raw)) throw new Error(`夹具前置失败: ${file} 顶层不是对象`);
  return raw;
}

/** 从真实文档里删掉某一项的某个字段（V-08 改坏即红夹具）。 */
function stripFieldFromItem(doc: Record<string, unknown>, itemId: string, field: string): Record<string, unknown> {
  const raw = doc.questions;
  if (!Array.isArray(raw)) throw new Error('夹具前置失败: questions 不是数组');
  const next = raw.map((entry) => {
    if (!isRecord(entry) || entry.id !== itemId) return entry;
    const copy: Record<string, unknown> = { ...entry };
    delete copy[field];
    return copy;
  });
  return { ...doc, questions: next };
}

/** 把某一项的 mapsTo 换成悬空引用（V4 反例夹具）。 */
function breakMapping(doc: Record<string, unknown>, itemId: string, bogusRef: string): Record<string, unknown> {
  const raw = doc.questions;
  if (!Array.isArray(raw)) throw new Error('夹具前置失败: questions 不是数组');
  const next = raw.map((entry) => {
    if (!isRecord(entry) || entry.id !== itemId) return entry;
    return { ...entry, mapsTo: [bogusRef] };
  });
  return { ...doc, questions: next };
}

afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('K12-02 建档内容包 — 正常路径（真包）', () => {
  const pack = loadPack();
  const report = validate(pack);

  it('真包完整: ok=true 且 problems 为空（缺任一必需字段即非空 ⇒ 改坏必红）', () => {
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.degraded).toBe(false);
  });

  it('本体词表真从磁盘读（节点 29 族 / 边 55 族，非硬编码）', () => {
    expect(pack.vocabulary.nodes.length).toBe(29);
    expect(pack.vocabulary.edges.length).toBe(55);
    expect(pack.vocabulary.nodes).toContain('outcome/financial');
    expect(pack.vocabulary.nodes).toContain('resource/person');
    expect(pack.vocabulary.edges).toContain('edge/produces');
  });

  it('V2 映射表: 每一项都追到本体节点或边，悬空 = 0（打印映射表）', () => {
    const rows = pack.questions.map((q) => `${q.id} → ${q.mapsTo.join(' , ')}`);
    for (const row of rows) log.info(`映射: ${row}`);
    const dangling = pack.questions.flatMap((q) => q.mapsTo.filter((ref) => !pack.vocabulary.all.has(ref)));
    log.info(`映射表 ${rows.length} 项；悬空 ${dangling.length}`);
    expect(dangling).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it('V2 反向: 本体 29 节点被采集项全覆盖（悬空=0 之外还要覆盖=全）', () => {
    expect(report.uncoveredNodes).toEqual([]);
  });

  it('分层题量达标（L0/L1 各自 ≥ 口径下限）', () => {
    expect(report.layerCounts['L0']).toBeGreaterThanOrEqual(15);
    expect(report.layerCounts['L1']).toBeGreaterThanOrEqual(8);
  });

  it('行业覆盖层同规则合格（general-enterprise）', () => {
    const overlay = pack.questions.filter((q) => q.id.startsWith('q-l0-scale-boundary') || q.id.startsWith('q-l0-founderkpi') || q.id.startsWith('q-l1-plan-credibility'));
    expect(overlay.length).toBe(3);
    for (const item of overlay) {
      expect(item.mapsTo.length).toBeGreaterThan(0);
      for (const ref of item.mapsTo) expect(pack.vocabulary.all.has(ref)).toBe(true);
    }
  });
});

describe('K12-02 建档内容包 — V3 有穷且闭合', () => {
  const pack = loadPack();

  it('确定性: 同一输入跑两次 ⇒ 同一组问题（含顺序）', () => {
    const first = nextQuestionIds(pack, []);
    const second = nextQuestionIds(loadPack(), []);
    expect(second).toEqual(first);
    expect(first).toEqual([...first].sort());
    expect(first.length).toBe(pack.questions.length);
  });

  it('闭合: 缺口填满 ⇒ 不再问（剩余 = 0）', () => {
    const filled = allMappedRefs(pack);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.filter((ref) => pack.vocabulary.edges.includes(ref)).length).toBeGreaterThan(0);
    expect(nextQuestionIds(pack, filled)).toEqual([]);
  });

  it('闭合边界: 只填节点、不填边 ⇒ 恰好剩「引用了边」的那些问题（闭合按边也填满判）', () => {
    const referencesEdge = pack.questions
      .filter((q) => q.mapsTo.some((ref) => pack.vocabulary.edges.includes(ref)))
      .map((q) => q.id)
      .sort();
    const remaining = nextQuestionIds(pack, pack.vocabulary.nodes);
    expect(referencesEdge.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(pack.questions.length);
    expect(remaining).toEqual(referencesEdge);
  });

  it('闭合判别性: 少填一个本体 id ⇒ 恰好只剩依赖它的那些问题（非恒空）', () => {
    const filled = allMappedRefs(pack);
    const victim = filled[0];
    const remaining = nextQuestionIds(pack, filled.filter((ref) => ref !== victim));
    expect(remaining.length).toBeGreaterThan(0);
    const expected = pack.questions.filter((q) => q.mapsTo.includes(victim)).map((q) => q.id).sort();
    expect(remaining).toEqual(expected);
  });
});

describe('K12-02 建档内容包 — 降级路径（不得静默通过）', () => {
  it('缺文件: 删掉 what-to-ask.yaml ⇒ ok=false + degraded=true + 列出缺哪个文件（不抛）', () => {
    const dir = clonePackage();
    rmSync(join(dir, WHAT_TO_ASK_FILE));
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.degraded).toBe(true);
    const missing = report.problems.filter((p) => p.code === 'missing-file');
    expect(missing.map((p) => p.file)).toContain(WHAT_TO_ASK_FILE);
    // 基础清单整份丢失 ⇒ 基础项一条都不许在（行业覆盖层是另一个文件，仍可独立存在）
    expect(report.questions.some((q) => q.id === 'q-l0-identity')).toBe(false);
    expect(report.layerCounts['L0']).toBeLessThan(15);
  });

  it('缺必需字段: 删掉 q-l0-identity.ask ⇒ ok=false 且逐项列出缺哪一项', () => {
    const dir = clonePackage();
    const broken = stripFieldFromItem(readRealDoc(WHAT_TO_ASK_FILE), 'q-l0-identity', 'ask');
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), broken);
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.degraded).toBe(true);
    const fields = report.problems.filter((p) => p.code === 'missing-field').map((p) => p.detail);
    expect(fields).toContain('缺必需字段: q-l0-identity.ask');
  });

  it('缺必需字段: 删掉 mapsTo ⇒ 同样必红（且不因缺字段而丢项）', () => {
    const dir = clonePackage();
    const broken = stripFieldFromItem(readRealDoc(WHAT_TO_ASK_FILE), 'q-l1-cash-runway', 'mapsTo');
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), broken);
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    const details = report.problems.map((p) => p.detail);
    expect(details.some((d) => d.includes('q-l1-cash-runway.mapsTo'))).toBe(true);
    expect(report.questions.some((q) => q.id === 'q-l1-cash-runway')).toBe(true);
  });

  it('悬空映射（Q3 V4 反例）: mapsTo 指向不存在的本体 id ⇒ 必红且列出悬空项', () => {
    const dir = clonePackage();
    const broken = breakMapping(readRealDoc(WHAT_TO_ASK_FILE), 'q-l0-clients', 'resource/does-not-exist');
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), broken);
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    const dangling = report.problems.filter((p) => p.code === 'dangling-mapping');
    expect(dangling.length).toBeGreaterThan(0);
    expect(dangling[0].detail).toContain('resource/does-not-exist');
  });

  it('未知层: 采集项 layer=L9 ⇒ 必红（层枚举闭合）', () => {
    const dir = clonePackage();
    const doc = readRealDoc(WHAT_TO_ASK_FILE);
    const raw = doc.questions;
    if (!Array.isArray(raw)) throw new Error('夹具前置失败: questions 不是数组');
    const next = raw.map((entry) => (isRecord(entry) && entry.id === 'q-l0-identity' ? { ...entry, layer: 'L9' } : entry));
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), { ...doc, questions: next });
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'unknown-layer')).toBe(true);
  });

  it('配置自伤: completeness.yaml 缺 requiredFields ⇒ 必红（不得退化为「无口径 = 通过」）', () => {
    const dir = clonePackage();
    const doc = readRealDoc(COMPLETENESS_FILE);
    delete doc.requiredFields;
    writeYamlAt(join(dir, COMPLETENESS_FILE), doc);
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'bad-config')).toBe(true);
  });

  it('坏语法: what-to-ask.yaml 非法 ⇒ bad-syntax 且不抛', () => {
    const dir = clonePackage();
    writeFileSync(join(dir, WHAT_TO_ASK_FILE), 'questions: [unclosed\n', 'utf-8');
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'bad-syntax')).toBe(true);
  });

  it('行业覆盖层缺文件 ⇒ 必红（口径声明了 required 就必须在）', () => {
    const dir = clonePackage();
    rmSync(join(dir, INDUSTRY_DIR, INDUSTRY_FILE));
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'missing-file' && p.file.includes(INDUSTRY_FILE))).toBe(true);
  });
});

describe('K12-02 建档内容包 — 边界', () => {
  it('空集: questions = [] ⇒ 必红（低于下限 / 缺层 / 节点全未覆盖），绝不静默通过', () => {
    const dir = clonePackage();
    const doc = readRealDoc(WHAT_TO_ASK_FILE);
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), { ...doc, questions: [] });
    const pack = loadPack(dir);
    const report = validate(pack);
    expect(report.ok).toBe(false);
    expect(report.questions.some((q) => q.id === 'q-l0-identity')).toBe(false);
    const layerGate = report.problems.filter((p) => p.code === 'missing-layer' || p.code === 'below-min');
    expect(layerGate.length).toBeGreaterThanOrEqual(2);
    const coveredAfter = new Set(pack.questions.flatMap((q) => q.mapsTo.filter((ref) => pack.vocabulary.nodes.includes(ref))));
    expect(report.uncoveredNodes).toEqual(pack.vocabulary.nodes.filter((n) => !coveredAfter.has(n)));
    expect(report.uncoveredNodes.length).toBeGreaterThan(20);
    expect(nextQuestionIds(pack, [])).toEqual(
      pack.questions.map((q) => q.id).sort(),
    );
  });

  it('单元素: 只留一条 ⇒ 能解析该条（不崩），但仍判不完整', () => {
    const dir = clonePackage();
    const doc = readRealDoc(WHAT_TO_ASK_FILE);
    const raw = doc.questions;
    if (!Array.isArray(raw)) throw new Error('夹具前置失败: questions 不是数组');
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), { ...doc, questions: raw.slice(0, 1) });
    const pack = loadPack(dir);
    const report = validate(pack);
    expect(pack.questions.some((q) => q.id === 'q-l0-identity')).toBe(true);
    expect(pack.questions.length).toBeLessThan(validate(loadPack()).questions.length);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'below-min')).toBe(true);
  });

  it('重复 id: 同 id 两条 ⇒ duplicate-id 必红', () => {
    const dir = clonePackage();
    const doc = readRealDoc(WHAT_TO_ASK_FILE);
    const raw = doc.questions;
    if (!Array.isArray(raw) || raw.length < 2 || !isRecord(raw[0])) throw new Error('夹具前置失败: questions 形状异常');
    const dup = { ...raw[0] };
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), { ...doc, questions: [...raw, dup] });
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'duplicate-id')).toBe(true);
  });

  it('id 形态: q-unknown-shape ⇒ bad-id 必红（idPattern 生效）', () => {
    const dir = clonePackage();
    const doc = readRealDoc(WHAT_TO_ASK_FILE);
    const raw = doc.questions;
    if (!Array.isArray(raw)) throw new Error('夹具前置失败: questions 不是数组');
    const next = raw.map((entry) => (isRecord(entry) && entry.id === 'q-l0-identity' ? { ...entry, id: 'q-UNKNOWN-Shape' } : entry));
    writeYamlAt(join(dir, WHAT_TO_ASK_FILE), { ...doc, questions: next });
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'bad-id')).toBe(true);
  });

  it('manifest 必填字段: 缺 entryPoint ⇒ 必红（与 pre-commit 第 8 组同口径）', () => {
    const dir = clonePackage();
    const raw: unknown = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf-8'));
    if (!isRecord(raw)) throw new Error('夹具前置失败: manifest 不是对象');
    const copy: Record<string, unknown> = { ...raw };
    delete copy.entryPoint;
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(copy, null, 2), 'utf-8');
    const report = validate(loadPack(dir));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'missing-field' && p.detail.includes('entryPoint'))).toBe(true);
  });
});
