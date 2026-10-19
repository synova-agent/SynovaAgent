/**
 * src/l4/ontology-loader.ts — 本体类型加载器
 *
 * 从 extensions/ontology/resource/*.json + activity/*.json + outcome/*.json + edge-types/*.json 加载类型定义。
 * 动态构建 NODE_VALIDATORS / EDGE_VALIDATORS / EDGE_ENDPOINT_MAP。
 *
 * V4.3.0 — 本体层重建: 从 resource/activity/outcome/edge-types 四目录加载
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';

const log = createLogger('l4/ontology-loader');

export interface NodeTypeDef {
  $id: string;
  label: string;
  tags: string[];
  requiredProps: string[];
  optionalProps: Record<string, unknown>;
  description: string;
}

export interface EdgeTypeDef {
  $id: string;
  label: string;
  tags: string[];
  allowedFrom: string[];
  allowedTo: string[];
  requiredProps?: string[];
  /**
   * 可选属性声明表。注意 `causal_strength` 的**权威归属就在这里**
   * （#1031 实测 as_of 5a6591c4a：55/55 落在 `optionalProps` 内，顶层无此键）
   * ⇒ 参数桥按 `optionalProps.causal_strength` 取源，不设顶层回退。
   */
  optionalProps?: Record<string, unknown>;
  consumed_by_sentinels?: string[];
  description: string;
  /**
   * #1031 参数桥：`transfer_function` 参数槽（实测 55/55 位于顶层）。
   * 类型为 `unknown` —— 值来自 JSON 反序列化，必须运行时做类型守卫（铁律 38：不用 any 谎报类型）。
   */
  transfer_function?: unknown;
  /**
   * #1031 参数桥：`action_effect_lag` 时滞（实测 55/55 位于顶层）。
   * 值域收口属卡 #1134，本桥只做非空字符串原样透传。
   */
  action_effect_lag?: unknown;
}

export interface LoadedOntology {
  nodeTypes: NodeTypeDef[];
  edgeTypes: EdgeTypeDef[];
  /** 从 nodeTypes 动态构建的端点矩阵 */
  edgeEndpointMap: Record<string, { from: string[]; to: string[] }>;
}

const ONTOLOGY_DIR = join(process.cwd(), 'extensions', 'ontology');

// ═══ Cache ═══
let cache: LoadedOntology | null = null;

function readJSON<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch (err: any) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "本体文件存在检查");
    // JSON 解析失败 — 跳过损坏文件
    return null;
  }
}

function scanDir<T>(dir: string): T[] {
  const results: T[] = [];
  if (!existsSync(dir)) return results;
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const item = readJSON<T>(join(dir, file));
    if (item) results.push(item);
  }
  return results;
}

/**
 * 加载本体类型定义。
 */
export function loadOntology(): { ontology: LoadedOntology; degraded: boolean; errors: string[] } {
  const errors: string[] = [];
  if (cache) return { ontology: cache, degraded: false, errors: [] };

  try {
    // 1. 加载新本体实体 (extensions/ontology/resource/ + activity/ + outcome/)
    const nodeTypes: NodeTypeDef[] = [];
    const ENTITY_DIRS = ['resource', 'activity', 'outcome'];
    for (const dir of ENTITY_DIRS) {
      const entities = scanDir<NodeTypeDef>(join(ONTOLOGY_DIR, dir));
      nodeTypes.push(...entities);
    }
    const edgeTypes = scanDir<EdgeTypeDef>(join(ONTOLOGY_DIR, 'edge-types'));

    // 2. 加载行业扩展类型 (extensions/industries/{name}/edge-types/)
    // 注意: 行业模板使用新实体 ID 空间，不读旧 node-types/ 目录
    const INDUSTRIES_DIR = join(process.cwd(), 'extensions', 'industries');
    if (existsSync(INDUSTRIES_DIR)) {
      const industryDirs = readdirSync(INDUSTRIES_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
      for (const dir of industryDirs) {
        const indEdgeTypes = scanDir<EdgeTypeDef>(join(INDUSTRIES_DIR, dir, 'edge-types'));
        edgeTypes.push(...indEdgeTypes);
      }
    }

    // 3. 从 edgeTypes 动态构建 EDGE_ENDPOINT_MAP
    const edgeEndpointMap: Record<string, { from: string[]; to: string[] }> = {};
    for (const e of edgeTypes) {
      edgeEndpointMap[e.label] = {
        from: e.allowedFrom,
        to: e.allowedTo,
      };
    }

    const ontology: LoadedOntology = { nodeTypes, edgeTypes, edgeEndpointMap };
    log.info({ nodes: nodeTypes.length, edges: edgeTypes.length }, '本体类型加载完成');
    cache = ontology;
    return { ontology, degraded: errors.length > 0, errors };
  } catch (err: any) {
    log.error({ err }, '本体类型加载失败 — degraded');
    errors.push(`本体类型加载失败: ${err.message}`);
    return { ontology: { nodeTypes: [], edgeTypes: [], edgeEndpointMap: {} }, degraded: true, errors };
  }
}

/**
 * 按标签查询节点/边类型。
 */
export function getTypesByTags(tags: string[], matchMode: 'any' | 'all' = 'any'): { nodes: NodeTypeDef[]; edges: EdgeTypeDef[] } {
  const { ontology } = loadOntology();
  const matchFn = matchMode === 'all'
    ? (t: string[]) => tags.every(tag => t.includes(tag))
    : (t: string[]) => tags.some(tag => t.includes(tag));

  return {
    nodes: ontology.nodeTypes.filter(n => matchFn(n.tags)),
    edges: ontology.edgeTypes.filter(e => matchFn(e.tags)),
  };
}

/**
 * 验证端点约束。
 */
export function validateEdgeEndpoints(edgeLabel: string, fromLabel: string, toLabel: string): boolean {
  const { ontology } = loadOntology();
  const rule = ontology.edgeEndpointMap[edgeLabel];
  if (!rule) return false;
  return rule.from.includes(fromLabel) && rule.to.includes(toLabel);
}

// ═══════════════════════════════════════════════════════════════════════════════
// #1031 参数桥：类型层（EdgeTypeDef）→ 实例层（edge.props）
//
// 背景：本 loader 读全 55 个边类型 JSON，但历史上只取 label/allowedFrom/allowedTo
//   三个字段（见下方 edgeEndpointMap 构建）⇒ `transfer_function` / `causal_strength` /
//   `action_effect_lag` 停留在类型层，**到不了边实例的 props**（声明层 ↔ 实例层无桥）。
//
// 契约（铁律 47；全文 docs/synova/product-lines/evidence/1031-injection-contract.md）：
//   注入点 — 读取时按 label 查类型层（不碰 createEdge / 不碰 EdgeStoreReader 实现）
//   谁注入 — 本 loader 暴露的读取面 + 纯注入函数
//   形状   — 同形透传（identity），不包装 / 不改名 / 不换算
//   降级   — 非 resolved 一律 **不写入 props**（键保持不存在）+ degraded + 显式 log.warn
//            ⇒ 与读取方（D1143 `edge.props ? edge.props[key] : undefined`）的降级行为兼容：
//              本桥只增不减、只写真值，不写 null、不伪造结构化空对象。
//
// 🔴 覆盖力边界（乙案显式降档，不许当成"下游输出已改变"）：
//   本桥覆盖「参数**落到哪**」，**不覆盖**「参数**改变下游计算**」——后者需 DirectionMonitor
//   接入调度（第三卡）。原卡判据②（DirectionMonitor 输出必须不同）在 main 上不可执行：
//   src/loops/direction-monitor.ts 在 main 仅 291 行，读取路径所属分支 feat/D1143-param-consumer-w2
//   （PR #1029）未合入 main（实测 as_of 5a6591c4a）。
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * P-3 值域 —— 因果/强度参数的合法值形态。
 *
 * 🔴 出处声明：派单件引证的 `docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md:93`（"G-3"）
 * 经实测**不存在**（该目录同名家族仅 `CTO-固化-最终方向与在制任务-20260924.md`，全文 67 行，零命中）
 * ⇒ 本值域**由卡 #1031 提出 + 待治理线/K3 确认**，不冒用 G-3 出处。
 */
export type ParamValue = number | { param: number } | { ref: string };

/** 参数桥读取的键（顺序固定；as_of 5a6591c4a 实测 55/55 三者齐备）。 */
export const EDGE_PARAM_KEYS = ['transfer_function', 'causal_strength', 'action_effect_lag'] as const;

export type EdgeParamKey = typeof EDGE_PARAM_KEYS[number];

/**
 * 单字段解析状态（六态穷举）：
 * - `resolved`         合法的 P-3 值（或 action_effect_lag 非空字符串）⇒ 注入
 * - `placeholder`      占位串（TBD / to be defined …）⇒ 不注入，等标定（真值属另卡）
 * - `declaration_only` 描述类型/值域的声明串（如 causal_strength 的 `number (0-1) — …`）⇒ 槽存在、值待标定
 * - `prose_formula`    散文公式串（非 P-3 值域）⇒ 不注入
 * - `absent`           类型层无此键
 * - `malformed`        出现但不是上述任何一类（null / 数组 / 缺 param|ref 的对象 / 空串 …）
 */
export type EdgeParamStatus =
  | 'resolved'
  | 'placeholder'
  | 'declaration_only'
  | 'prose_formula'
  | 'absent'
  | 'malformed';

/**
 * **标定态**（#477）—— 与 `status` **正交**的第二轴：
 * - `status`      回答「**值域合法吗 / 能不能注入**」
 * - `calibration` 回答「**这条边把该参数标定了没有**」：
 *     · `formula`           **已标定**：串是形如 `<标识符> = <非空右侧>` 的**赋值式**（散文公式）
 *     · `declared_unknown`  **未标定**：**边文件自己声明**该值未知（串**全串**等于 `unknown`）
 *     · `other`             上两类之外的一切（占位串 / 声明串 / 结构说明 / P-3 值域 / 缺键 / 非法形态 …）
 *
 * 🔴 **为什么加轴而不改 `status`**：`status` 是**既有消费面** —— 例
 *   `tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts:257` 逐字断言 `unknown ⇒ prose_formula`；
 *   本卡属**读路径**（卡面 Q2）⇒ 只**加轴**、不动既有语义 ⇒ 消费面零破坏。
 *   （`prose_formula` 仍是散文桶的整体标签；本轴只回答「散文桶里哪类算**已标定**」。）
 *
 * 🔴 **判据边界（不许外推）**：
 *   ① 只判**形态**（赋值式 / 全串 equals `unknown`）—— **不判**公式的数学或语义正确性；
 *   ② 未登记形态一律落 `other`（**不猜**：不给"看起来像散文"的串发"已标定"证）；
 *   ③ `other` 是**兜底桶**（含 `resolved`），调用方若要区分"可注入"必须**同时**读 `status`。
 */
export type EdgeParamCalibration =
  | 'formula'
  | 'declared_unknown'
  | 'other';

export interface EdgeParamResolution {
  key: EdgeParamKey;
  status: EdgeParamStatus;
  /** 标定态（#477）：与 `status` 正交 —— 见 `EdgeParamCalibration` 的口径与边界 */
  calibration: EdgeParamCalibration;
  /** 仅 `resolved` 为 true —— 唯一允许进实例层的情况 */
  injectable: boolean;
  /** 仅 `injectable` 时存在 —— 将写入 `edge.props[key]` 的值（同形透传） */
  value?: ParamValue | string;
  /** 类型层原值，原样保留（永不丢失，供审计/标定） */
  raw?: unknown;
  /** 声明串 / 占位串 / 散文原文 —— 标定靶与降级诊断用 */
  declaredAs?: string;
  /** 人可读判定理由（审计可核） */
  reason: string;
}

export interface EdgeTypeParams {
  label: string;
  /** 恒 3 条，顺序 = EDGE_PARAM_KEYS（缺字段也报 absent，不漏项） */
  params: EdgeParamResolution[];
  /** 仅 resolved 的键值对 —— 可直接并入 edge.props */
  props: Record<string, unknown>;
  degraded: boolean;
  /** 未解析项逐条点名（`<label>.<key>: <status> — <reason>`） */
  issues: string[];
}

/** 占位族：命中即 `placeholder`（大小写与空白归一后判定） */
const PLACEHOLDER_RE = /\b(tbd|to be defined|todo|pending|n\/a)\b/i;

/** 声明族：串首为类型关键字 ⇒ 描述的是「类型/值域」而非「值」 */
const DECLARATION_RE = /^(number|string|boolean|integer|object|array)\b/i;

/**
 * **未标定声明族**（#477）：**全串**等于 `unknown`（大小写与空白归一后判定）。
 * 🔴 只认**全串相等** —— **不做子串匹配**（`unknown_v2` / `not_unknown` / `已知 unknown` 一律**不**算声明；
 * 防 `MISS ⊂ TRANSMISSION` 那类子串假阳）。
 */
const DECLARED_UNKNOWN_RE = /^unknown$/i;

/**
 * **已标定·公式族**（#477）：形如 `<标识符> = <非空右侧>` 的**赋值式**形态。
 * 🔴 只判**形态**，不判数学/语义正确性（见 `EdgeParamCalibration` 的判据边界）。
 * 🔴 未命中一律落 `other` —— 不给"像公式的散文"发已标定证。
 */
const FORMULA_SHAPE_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/;

/** 标定态判定（纯函数）：只对**字符串**值有区分力；非字符串 / 空串由调用方直接给 `'other'`。 */
function classifyCalibration(text: string): EdgeParamCalibration {
  if (DECLARED_UNKNOWN_RE.test(text)) return 'declared_unknown';
  if (FORMULA_SHAPE_RE.test(text)) return 'formula';
  return 'other';
}

/** P-3 值域运行时类型守卫（不谎报类型：JSON 反序列化结果一律先过守卫） */
function isValidParamValue(raw: unknown): raw is ParamValue {
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  const hasParam = 'param' in obj;
  const hasRef = 'ref' in obj;
  // 两者都有 = 歧义形态；两者都无 = 既非形参也非引用 ⇒ 都不是 P-3 值域
  if (hasParam === hasRef) return false;
  if (hasParam) {
    const v = obj.param;
    return typeof v === 'number' && Number.isFinite(v);
  }
  const v = obj.ref;
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 按字段的**实测归属位置**取原值 —— 三个字段归属不同，不可用一条通用逻辑糊过去：
 * `transfer_function` / `action_effect_lag` 在顶层；`causal_strength` 在 `optionalProps` 内。
 */
function readRawParam(def: EdgeTypeDef, key: EdgeParamKey): unknown {
  if (key === 'transfer_function') return def.transfer_function;
  if (key === 'action_effect_lag') return def.action_effect_lag;
  const op = def.optionalProps;
  return op ? op.causal_strength : undefined;
}

/** 单字段解析（纯函数：无 IO / 无时钟 / 无随机） */
function resolveParam(def: EdgeTypeDef, key: EdgeParamKey): EdgeParamResolution {
  const raw = readRawParam(def, key);

  if (raw === undefined) {
    return { key, status: 'absent', calibration: 'other', injectable: false, reason: '类型层无此字段（键不存在）' };
  }

  // action_effect_lag —— 时滞枚举，非空字符串即合法（值域收口属 #1134，本桥不裁定）
  if (key === 'action_effect_lag') {
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return {
        key, status: 'resolved', calibration: classifyCalibration(raw.trim()), injectable: true, value: raw, raw,
        reason: '时滞枚举：非空字符串原样透传（值域收口属 #1134）',
      };
    }
    return { key, status: 'malformed', calibration: 'other', injectable: false, raw, reason: '时滞须为非空字符串' };
  }

  // transfer_function / causal_strength —— P-3 值域
  if (isValidParamValue(raw)) {
    return {
      key, status: 'resolved', calibration: 'other', injectable: true, value: raw, raw,
      reason: 'P-3 值域：number | {param:number} | {ref:string}（可注入性看本 status；标定轴只细分散文桶）',
    };
  }

  if (typeof raw === 'string') {
    const text = raw.trim();
    const calibration = classifyCalibration(text);
    if (text.length === 0) {
      return { key, status: 'malformed', calibration: 'other', injectable: false, raw: text, reason: '空字符串' };
    }
    if (PLACEHOLDER_RE.test(text)) {
      return {
        key, status: 'placeholder', calibration, injectable: false, raw: text, declaredAs: text,
        reason: '占位串：待标定替换为 P-3 值域（真值属另卡，本桥不伪造）',
      };
    }
    if (DECLARATION_RE.test(text)) {
      return {
        key, status: 'declaration_only', calibration, injectable: false, raw: text, declaredAs: text,
        reason: '声明串：描述类型/值域而非值（槽存在、值待标定）',
      };
    }
    // 🔴 #477 散文桶细分：`declared_unknown`（边文件**显式声明**未标定）／`formula`（赋值式 ⇒ 已标定）／`other`
    return {
      key, status: 'prose_formula', calibration, injectable: false, raw: text, declaredAs: text,
      reason:
        calibration === 'declared_unknown'
          ? '散文桶·未标定：边文件显式声明 `unknown`（已标定/未标定自此可分辨，#477）'
          : calibration === 'formula'
            ? '散文桶·已标定：赋值式形态的散文公式（非 P-3 值域，不可注入）'
            : '散文字符串：非 P-3 值域，不可注入（规范化待治理线裁定）',
    };
  }

  return {
    key, status: 'malformed', calibration: 'other', injectable: false, raw,
    reason: '非 P-3 值域（须为 number | {param:number} | {ref:string}）',
  };
}

/**
 * 读取面（纯）：把单个边类型定义的参数解析为「类型层 → 实例层」可注入的形态。
 *
 * @input  def — 单个边类型定义（来自 edge-types JSON，或测试构造的 mock）
 * @output label / params（恒 3 条）/ props（仅 resolved）/ degraded / issues
 * @degrade 任一字段非 resolved ⇒ `degraded:true` + `issues[]` + **一条聚合 `log.warn`**（不静默）
 * @invariant 纯函数；不改入参；不写假值；缺字段也报 `absent`
 */
export function readEdgeTypeParams(def: EdgeTypeDef): EdgeTypeParams {
  const params = EDGE_PARAM_KEYS.map(key => resolveParam(def, key));

  const props: Record<string, unknown> = {};
  const issues: string[] = [];
  for (const p of params) {
    if (p.injectable) props[p.key] = p.value;
    else issues.push(`${def.label}.${p.key}: ${p.status} — ${p.reason}`);
  }

  const degraded = issues.length > 0;
  if (degraded) {
    log.warn(
      { label: def.label, issues },
      '边类型参数未解析 — 不注入实例层（degraded，非静默）',
    );
  }

  return { label: def.label, params, props, degraded, issues };
}

/** 按 label 的结果记忆化（与 `cache` 同生命周期，由 `clearOntologyCache()` 一并失效） */
const paramCache = new Map<string, EdgeTypeParams>();

/**
 * 读取面（按 label 查类型层）—— 卡面 §步骤1 a) 选定的注入点。
 *
 * @input  label — 边类型 label（如 `'CONSTRAINS'`）
 * @output 该 label 的 `EdgeTypeParams`；label 在类型层不存在 ⇒ `null`
 * @degrade 同 `readEdgeTypeParams`；结果按 label 记忆化 ⇒ 同一 label 只告警一次
 */
export function getEdgeTypeParams(label: string): EdgeTypeParams | null {
  const hit = paramCache.get(label);
  if (hit) return hit;

  const { ontology } = loadOntology();
  const def = ontology.edgeTypes.find(e => e.label === label);
  if (!def) return null;

  const result = readEdgeTypeParams(def);
  paramCache.set(label, result);
  return result;
}

/**
 * 注入面（纯）：把类型层参数并入一份既有边实例 props。
 *
 * @input  props — 既有边实例 props（**不被修改**）；def — 边类型定义
 * @output `{ props: 新对象, injected: 注入的键名[], degraded, issues }`
 * @degrade 同 `readEdgeTypeParams`；未解析字段**不写入** ⇒ 对应键保持不存在
 *          （读取方 `edge.props ? edge.props[key] : undefined` 的降级行为因此不变）
 * @invariant 差值只来自参数：纯函数、无时钟/无顺序/无随机，且非参数键原样保留
 */
export function applyEdgeTypeParams(
  props: Record<string, unknown>,
  def: EdgeTypeDef,
): { props: Record<string, unknown>; injected: string[]; degraded: boolean; issues: string[] } {
  const resolved = readEdgeTypeParams(def);
  return {
    props: { ...props, ...resolved.props },
    injected: Object.keys(resolved.props),
    degraded: resolved.degraded,
    issues: resolved.issues,
  };
}

export function clearOntologyCache(): void {
  cache = null;
  paramCache.clear();
}
