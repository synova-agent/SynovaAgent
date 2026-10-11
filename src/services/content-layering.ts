/**
 * src/services/content-layering.ts — 岗位内容分层解析服务（K12-20 / #203 / RB-06）
 *
 * 一句话: 让**同一个事实，在不同部门看到各自该看到的样子**（财务看到的与销售看到的
 * 表述 / 工具 / 知识不同），而**底层是同一份企业状态** —— 不是各存一份副本。
 *
 * 边界（2026-10-07 定）: 权限层答「**能不能看**」（RB-01..05）；本件答「**看到什么样**」。
 *   本件**不改可见性** —— 不能看的数据仍然看不到。
 *
 * 🔴 内容面纪律（宪章 §5.6 / 4.1）: 分层依据是**部门轴**，载体是**数据文件**
 *   （`extensions/content-layers/**`），引擎侧只做解析 ⇒ **改部门层文件即生效，不改代码**。
 *   故本件每次调用**真读文件**、不做进程级缓存：缓存会让「加文件即生效」失效。
 *   调用方如需缓存，属调用方决策（本件不隐藏全局单例）。
 *
 * 🔴 概念区分（V6，防"把内部作业预设当客户岗位预设"）: 本件读的是
 *   `extensions/content-layers/**` = **客户岗位预设内容面**；
 *   **≠** 仓内 `docs/synova/presets/**`（synova-cto / synova-k3-audit / synova-squad-lead）
 *   = **我们自己的内部作业预设**，与客户岗位无关。
 *
 * 契约（铁律 47）:
 *   @input    — ContentLayeringInput:
 *               · `departmentIds?: string[]`（部门身份，复数；`departments` 为等价别名，
 *                 两者并存时 departmentIds 在前）
 *               · `question?: string`（问题文本 —— **真参数**：命中内容层
 *                 `questionOverrides[].match` 子串时，采用该层声明的覆盖值；
 *                 不命中 ⇒ 用该层基础值。本件**不回显** question 原文）
 *               · `rootDir?: string`（内容层仓根；缺省 `process.cwd()`。
 *                 仅作依赖注入缝供确定性测试，生产不传）
 *   @output   — LayeredContent:
 *               · `prompt`  —— 单值，**覆盖语义**（部门层胜过企业层）
 *               · `tools` / `knowledge` —— **并集语义**（企业层在前，去重；
 *                 「同一份企业状态，不是各存一份副本」）
 *               · `appliedLayers` —— 实际生效的层 id（企业层为 `enterprise`，
 *                 部门层为其部门 id；**只列命中的部门** —— 未知部门不列，防身份回显）
 *               · `degraded` / `degradedReasons` —— 见下
 *   @degraded — 两态**分开**，不混为一谈（探针 V5 判据正建立在此区分上）:
 *               · **正常回落**（`degraded` 保持 false、**不记 reason**）:
 *                 部门层文件缺失 / 未知部门 id ⇒ 逐字回落企业层。
 *                 未知部门是**预期路径**，不是故障 —— 记 reason 会污染"回落 ≡ 基线"判据，
 *                 并让差异回追（探针 V3）看到假差异。
 *               · **真降级**（`degraded: true` + reason + `log.warn`，铁律 24/31）:
 *                 内容层根目录不存在 / 企业层文件读不到 / 文件解析失败 / 部门层目录不可读。
 *                 单层失败**只跳过该层**并回落，不抛出、不阻断（不静默吞）。
 *
 * 与判据探针的口径对齐（probe-content-layering.ts 是判据源，本件按其声明面实现）:
 *   · 服务路径 = `src/services/content-layering.ts`（探针 CANDIDATE_PATHS 唯一候选）
 *   · 导出名 = `resolveContent`（探针 ENTRY_NAMES 之一）
 *   · 入参形态 = 单个对象（探针依次试 `{departmentIds,question}` / `{departmentIds}` / `{departments,question}`）
 *   · 载体布局 = `extensions/content-layers/{enterprise.yaml, departments/<id>.yaml}`；
 *     部门 id = 文件名去扩展名；企业层文件候选顺序与探针一致
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';
import { createLogger } from '@synova/logger';

const log = createLogger('services/content-layering');

/** 内容层目录名（仓内 `extensions/<本名>`；判据探针 LAYER_ROOT 同口径） */
const CONTENT_LAYERS_DIR = 'content-layers';

/**
 * 企业层文件候选（按序取**首个存在者** —— 与探针 `ENTERPRISE_CANDIDATES` 同口径）。
 * 只列本件认得的四种：`manifest.json` 是扩展自描述件、不是企业层内容，故不收。
 */
const ENTERPRISE_FILE_CANDIDATES: readonly string[] = [
  'enterprise.yaml',
  'enterprise.yml',
  'enterprise.json',
  'base.yaml',
];

/** 部门层目录候选（与探针 `DEPARTMENT_DIRS` 同口径） */
const DEPARTMENT_DIR_CANDIDATES: readonly string[] = ['departments', 'department'];

/** 部门层文件扩展名（与探针口径一致：id = 文件名去扩展名） */
const DEPARTMENT_FILE_RE = /\.(ya?ml|json)$/i;

/** 企业层在 `appliedLayers` 中的层 id */
const ENTERPRISE_LAYER_ID = 'enterprise';

// ══════════════════════════════════════════════════════════════════════════════
// 一、类型与守卫（铁律 38：禁 any 型断言 —— 一律类型守卫收窄）
// ══════════════════════════════════════════════════════════════════════════════

/** `resolveContent` 入参（见文件头 @input） */
export interface ContentLayeringInput {
  /** 部门身份（复数）。未知/缺失 ⇒ 回落企业层（预期路径，非降级） */
  readonly departmentIds?: readonly string[];
  /** 部门身份的等价别名（探针第三入参形态 `{departments, question}`） */
  readonly departments?: readonly string[];
  /** 问题文本；命中内容层 `questionOverrides[].match` 时采用该层覆盖值 */
  readonly question?: string;
  /** 内容层仓根（依赖注入缝，缺省 `process.cwd()`） */
  readonly rootDir?: string;
}

/** 分层合成后的内容（见文件头 @output） */
export interface LayeredContent {
  readonly prompt: string;
  readonly tools: readonly string[];
  readonly knowledge: readonly string[];
  readonly appliedLayers: readonly string[];
  readonly degraded: boolean;
  readonly degradedReasons: readonly string[];
}

/** 单层内容声明（内容层文件的解析结果） */
interface LayerDefinition {
  readonly prompt: string | undefined;
  readonly tools: readonly string[];
  readonly knowledge: readonly string[];
  readonly overrides: readonly QuestionOverride[];
}

/** 问法覆盖声明（`questionOverrides[]`） */
interface QuestionOverride {
  /** 命中判据：`question.includes(match)` */
  readonly match: string;
  readonly prompt: string | undefined;
  readonly tools: readonly string[];
  readonly knowledge: readonly string[];
}

const EMPTY_LAYER: LayerDefinition = { prompt: undefined, tools: [], knowledge: [], overrides: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** 字符串数组收窄：只留非空字符串并去重（非数组/含异物 ⇒ 该位置忽略，不抛） */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = optionalString(item);
    if (text !== undefined && !out.includes(text)) out.push(text);
  }
  return out;
}

/** 就地并集（保序、去重） */
function pushUnique(target: string[], extra: readonly string[]): void {
  for (const item of extra) if (!target.includes(item)) target.push(item);
}

/** 部门身份提取：departmentIds 在前、departments 为别名，去重、丢空值 */
function requestedDepartmentIds(input: ContentLayeringInput): string[] {
  const out: string[] = [];
  for (const source of [input.departmentIds, input.departments]) {
    if (!Array.isArray(source)) continue;
    for (const raw of source) {
      const id = optionalString(raw);
      if (id !== undefined && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 二、内容层文件读取（真读文件；读不到/解析失败 ⇒ 记 reason + log.warn，不静默吞）
// ══════════════════════════════════════════════════════════════════════════════

type FileLoad =
  | { readonly kind: 'ok'; readonly doc: LayerDefinition }
  | { readonly kind: 'absent' }
  | { readonly kind: 'error'; readonly message: string };

/** 解析结果 → 层声明（字段缺失/类型不符 ⇒ 该字段当作未声明，不抛） */
function toLayerDefinition(raw: unknown): LayerDefinition {
  if (!isRecord(raw)) return EMPTY_LAYER;

  const overrides: QuestionOverride[] = [];
  if (Array.isArray(raw.questionOverrides)) {
    for (const item of raw.questionOverrides) {
      if (!isRecord(item)) continue;
      const match = optionalString(item.match);
      if (match === undefined) continue;
      overrides.push({
        match,
        prompt: optionalString(item.prompt),
        tools: stringList(item.tools),
        knowledge: stringList(item.knowledge),
      });
    }
  }

  return {
    prompt: optionalString(raw.prompt),
    tools: stringList(raw.tools),
    knowledge: stringList(raw.knowledge),
    overrides,
  };
}

/**
 * 读取并解析单份内容层文件。
 *
 * @input  — 绝对路径 ｜ @output — ok / absent / error 三态 ｜ @degraded — error 态带单行 message + log.warn
 */
function loadLayerDefinition(absPath: string): FileLoad {
  if (!existsSync(absPath)) return { kind: 'absent' };
  try {
    const text = readFileSync(absPath, 'utf8');
    const parsed: unknown = /\.json$/i.test(absPath) ? JSON.parse(text) : parseYaml(text);
    return { kind: 'ok', doc: toLayerDefinition(parsed) };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    log.warn({ err: detail, file: absPath }, '内容层文件读取/解析失败 — 跳过该层（降级，回落上层）');
    return { kind: 'error', message: `内容层文件读取或解析失败: ${absPath}（${detail}）` };
  }
}

/** 部门层索引：部门 id → 文件绝对路径（部门 id = 文件名去扩展名，与探针同口径） */
function readDepartmentIndex(deptDir: string, reasons: string[]): Map<string, string> {
  const index = new Map<string, string>();
  try {
    for (const entry of readdirSync(deptDir, { withFileTypes: true })) {
      if (!entry.isFile() || !DEPARTMENT_FILE_RE.test(entry.name)) continue;
      index.set(entry.name.replace(DEPARTMENT_FILE_RE, ''), join(deptDir, entry.name));
    }
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn({ err: detail, dir: deptDir }, '部门层目录不可读 — 无法解析任何部门层（降级）');
    reasons.push(`部门层目录不可读: ${deptDir}（${detail}）`);
  }
  return index;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、分层解析（唯一公开入口）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 按部门身份解析「该看到的内容」（企业层 → 部门层覆盖）。
 *
 * 算法（契约见文件头）:
 *   ① 企业层基线（候选文件按序取首个存在者；缺失/坏 ⇒ 记 reason，基线为空）
 *   ② 逐部门匹配 `departments/<id>.{yaml,yml,json}`；**未命中 ⇒ 跳过（预期回落，不记 reason）**
 *   ③ 合并：prompt 覆盖（后命中者胜，部门层胜过企业层）；
 *      tools / knowledge 并集去重（企业层在前）
 *   ④ question 覆盖：企业层 + 命中部门层（按序）中 `match` 命中者依次应用，
 *      后命中者胜 ⇒ 部门层比企业层更具体
 *   ⑤ 每次调用**真读文件**（无缓存）⇒ 改内容层文件即生效
 *
 * @input  — ContentLayeringInput（缺省 ⇒ 企业层基线）
 * @output — LayeredContent；无身份或未知身份时为**企业层基线**（非空）
 * @degraded — 见文件头：正常回落（未知部门）与真降级（文件层故障）严格分开
 */
export function resolveContent(input: ContentLayeringInput = {}): LayeredContent {
  const root = input.rootDir ?? process.cwd();
  const layerRoot = join(root, 'extensions', CONTENT_LAYERS_DIR);
  const reasons: string[] = [];

  if (!existsSync(layerRoot)) {
    const message = `内容层根目录不存在: extensions/${CONTENT_LAYERS_DIR}（root=${root}）`;
    log.warn({ layerRoot }, '内容层根目录不存在 — 返回空内容（降级）');
    return {
      prompt: '',
      tools: [],
      knowledge: [],
      appliedLayers: [],
      degraded: true,
      degradedReasons: [message],
    };
  }

  // ① 企业层基线
  let enterprise = EMPTY_LAYER;
  let enterpriseFound = false;
  for (const candidate of ENTERPRISE_FILE_CANDIDATES) {
    const abs = join(layerRoot, candidate);
    if (!existsSync(abs)) continue;
    enterpriseFound = true;
    const loaded = loadLayerDefinition(abs);
    if (loaded.kind === 'ok') {
      enterprise = loaded.doc;
    } else if (loaded.kind === 'error') {
      reasons.push(loaded.message);
    }
    break; // 按序取首个存在者（与判据探针同口径）
  }
  if (!enterpriseFound) {
    const message = `企业层文件缺失（${ENTERPRISE_FILE_CANDIDATES.join(' / ')} 均不存在）: extensions/${CONTENT_LAYERS_DIR}`;
    log.warn({ layerRoot }, '企业层文件缺失 — 基线为空（降级）');
    reasons.push(message);
  }

  // ② 部门层匹配
  const deptDir = DEPARTMENT_DIR_CANDIDATES.map((dir) => join(layerRoot, dir)).find((abs) => existsSync(abs));
  const departmentIndex = deptDir === undefined ? new Map<string, string>() : readDepartmentIndex(deptDir, reasons);

  const appliedDocuments: LayerDefinition[] = [];
  const appliedLayers: string[] = [];
  if (enterpriseFound) appliedLayers.push(ENTERPRISE_LAYER_ID);

  for (const id of requestedDepartmentIds(input)) {
    const abs = departmentIndex.get(id);
    if (abs === undefined) continue; // 未知部门 ⇒ 正常回落企业层（预期路径，不记 reason）
    const loaded = loadLayerDefinition(abs);
    if (loaded.kind === 'ok') {
      appliedDocuments.push(loaded.doc);
      appliedLayers.push(id);
    } else if (loaded.kind === 'error') {
      reasons.push(loaded.message); // 真降级：坏层跳过，回落上层
    }
  }

  // ③ 合并（prompt 覆盖；tools / knowledge 并集）
  let prompt = enterprise.prompt ?? '';
  const tools: string[] = [...enterprise.tools];
  const knowledge: string[] = [...enterprise.knowledge];
  for (const layer of appliedDocuments) {
    if (layer.prompt !== undefined) prompt = layer.prompt;
    pushUnique(tools, layer.tools);
    pushUnique(knowledge, layer.knowledge);
  }

  // ④ question 覆盖（企业层在前 ⇒ 部门层胜出）
  const question = optionalString(input.question);
  if (question !== undefined) {
    const sources: LayerDefinition[] = enterpriseFound ? [enterprise, ...appliedDocuments] : [...appliedDocuments];
    for (const layer of sources) {
      for (const override of layer.overrides) {
        if (!question.includes(override.match)) continue;
        if (override.prompt !== undefined) prompt = override.prompt;
        pushUnique(tools, override.tools);
        pushUnique(knowledge, override.knowledge);
      }
    }
  }

  return {
    prompt,
    tools,
    knowledge,
    appliedLayers,
    degraded: reasons.length > 0,
    degradedReasons: reasons,
  };
}
