/**
 * src/onboarding/gap-questioner.ts — 追问由**本体缺口**驱动（建档第 3 步）
 *
 * 架构位置: **宪章 ⓪-b 人侧入口 · 引擎侧**（`src/onboarding/`）—— 读**本体**（架构块 ②）
 *   算缺口（未实例化的节点/边）⇒ 产出**追问表本体**：每条问题都带它对应的
 *   **待实例化节点/边 id**（「问题 → 来源」映射表，悬空 = 0）。
 *
 * 🔴 引擎侧判据（内容面规范 §2.2）: 删掉 `extensions/**` 下任何**内容包**（含 K12-02 的
 *   `extensions/onboarding/what-to-ask.yaml`），本模块照常工作 —— 本模块**只读本体**。
 *   与 K12-02 的分工（不许做重）: K12-02 的内容包 = 人写的**采集方法**（问什么/为什么）；
 *   本模块 = 机器按本体缺口算出的**待补清单**（每条可追到一个 id）。前者是"方法"，后者是"表"。
 *
 * 依据: 院方《02》§九 原则③「**追问由本体定义，有穷** —— 只问图里缺的节点/边，问完即止」；
 *   原则③下半句「没有本体，采集无处落、问询无边界」正是本卡要过的那道门槛。
 *
 * 契约（铁律 47）:
 *   @input  — `GapQuestionInput`：{
 *               observed?          已实例化类型（节点/边），命中口径 = 类型的 id（如 `resource/money`）
 *                                  或 label（如 `MONEY`）；**缺省空 ⇒ 空图 ⇒ 全量追问**（建档第 3 步的起点）,
 *               rootDir?           仓库根；缺省 `process.cwd()`,
 *               ontologyDir?       本体目录覆盖；缺省 `<rootDir>/extensions/ontology`,
 *               requiredSourceIds? 建档**必需落点**（内容面/宿主声明的"这些 id 必须有"）。
 *                                  本卡生产入口不传；不传 ⇒ 只做自检。
 *                                  判据侧（`tests/onboarding/gap-questioner.test.ts`）传它 ⇒
 *                                  「删掉来源节点」会真地让**悬空 > 0**（V2/V4 判据非空转）。
 *             }
 *   @output — `GapQuestionReport`：{
 *               questions    **有序**追问表：节点在前、边在后，各自按 id 升序；`order` = 0..n-1,
 *               mapping      「问题 → 来源节点/边」映射表（逐行 `resolved`）,
 *               dangling     不可追的来源 id（**健康本体恒空**：本条 = 自检不变式 +
 *                            `requiredSourceIds` 里本体查不到的 id）,
 *               gapCount / sourceCount / observedCount（有穷性可核：gapCount ≤ sourceCount）,
 *               degraded, errors
 *             }
 *   @degraded — 本体目录缺失 / 子目录缺失 / 单文件 JSON 解析失败 / 缺 `$id` 或 `label` /
 *             有 `requiredSourceIds` 在本体里查不到 ⇒ **不抛**：进 `errors[]`（带错误码）
 *             + `degraded:true` + `log.warn`（铁律 11/24/31）。坏文件**不静默通过**：
 *             逐文件登记错误码，其余文件照常产出。
 *
 * 🔴 本体 id 空间的口径（实测，勿按目录名推）: id = 文件里声明的 `$id`，**不是**文件路径。
 *   节点：`resource/money.json` ⇒ `$id: "resource/money"`（与目录同名，29 件全部成立）；
 *   边：`edge-types/produces.json` ⇒ `$id: "edge/produces"`（目录 `edge-types/`，**前缀不同**，
 *   且实测 3 件存在 `-`/`_` 差异：`incentive-binds` / `locks-in` / `signal-transmits`）。
 *   ⇒ 本模块**只认 `$id`**，不用路径反推 id（否则会把 55 条边全判成错，属噪声不是判据）。
 *   本体自身的命名不一致归 K12-07（`extensions/ontology/**` 写集），本卡只读、不改、不报假错。
 *
 * 有穷且闭合（V3）:
 *   · 有穷 —— 问题集 ⊆ 本体类型集（`gapCount ≤ sourceCount`），本体有限 ⇒ 问题有限；
 *   · 确定 —— 排序键 = (kind, id)，无随机、无时间、无 Map 迭代序；
 *   · 闭合 —— `observed` 覆盖全部类型 ⇒ `gapCount = 0`（缺口填满即不再问）。
 *
 * 为什么不复用 `src/l4/ontology-loader.ts`: 那份 loader 是**代码层 L4** 的职责（建 validator +
 *   端点矩阵），且 (a) 带进程级 cache、(b) 根目录写死 `process.cwd()` —— 无注入点时
 *   「改坏本体 ⇒ 判据必红」无法复跑。本模块只做**只读投影**（id/label/描述/属性名），
 *   不引 L4、不建 cache、目录可注入 ⇒ 反例可复跑。二者消费同一真源（`extensions/ontology/**`）。
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { createLogger } from '@synova/logger';

const log = createLogger('onboarding/gap-questioner');

/** 节点类型目录（与 `extensions/ontology/` 现状同构：29 节点 = resource ∪ activity ∪ outcome） */
const NODE_DIRS: readonly string[] = ['resource', 'activity', 'outcome'];

/** 边类型目录（55 边） */
const EDGE_DIR = 'edge-types';

/** 问题文本里最多列几个属性名 / 端点（避免把整份 schema 灌进问题） */
const HINT_MAX = 4;

/** 来源是哪一族：节点还是边（V2「可追到一个待实例化节点/边」） */
export type GapSourceKind = 'node' | 'edge';

/** 本体里的一个类型（本模块只取判据需要的字段 —— 只读投影，不改本体） */
export interface OntologySource {
  /** 🔴 本体 id 空间的唯一口径 = 文件声明的 `$id`（如 `resource/money` / `edge/produces`） */
  readonly id: string;
  readonly label: string;
  readonly kind: GapSourceKind;
  readonly requiredProps: readonly string[];
  /** 属性名提示（取自 `optionalProps` 的键，确定性取前 N 个） */
  readonly propHint: readonly string[];
  /** 端点提示（边的 `allowedFrom` / `allowedTo`，确定性取前 N 个） */
  readonly endpointHint: readonly string[];
  readonly description: string;
}

/** 已实例化的类型集合（企业图现状） */
export interface ObservedTypes {
  readonly nodes?: readonly string[];
  readonly edges?: readonly string[];
}

/** 一条追问：文本 + 它对应的待实例化节点/边 id（本卡的核心交付物） */
export interface GapQuestion {
  /** 稳定 id（同输入恒等；由 kind + sourceId 派生，不含序号噪声） */
  readonly id: string;
  /** 有穷有序：0..n-1，节点在前、边在后，各自按 id 升序 */
  readonly order: number;
  readonly text: string;
  /** 🔴 来源 = 待实例化的节点/边 id（V2 的"可追"锚点） */
  readonly sourceId: string;
  readonly sourceKind: GapSourceKind;
}

/** 「问题 → 来源节点/边」映射表的一行 */
export interface GapMappingRow {
  readonly questionId: string;
  readonly sourceId: string;
  readonly sourceKind: GapSourceKind;
  /** 该来源在本体 id 空间里是否可解析（false ⇒ 悬空） */
  readonly resolved: boolean;
}

/** `buildQuestionTable()` 返回 */
export interface GapQuestionReport {
  readonly questions: readonly GapQuestion[];
  readonly mapping: readonly GapMappingRow[];
  /** 不可追的来源 id（健康本体恒空） */
  readonly dangling: readonly string[];
  readonly gapCount: number;
  readonly sourceCount: number;
  readonly observedCount: number;
  readonly degraded: boolean;
  readonly errors: readonly string[];
}

/** `buildQuestionTable()` 入参 */
export interface GapQuestionInput {
  readonly observed?: ObservedTypes;
  readonly rootDir?: string;
  readonly ontologyDir?: string;
  /** 建档必需落点（内容面/宿主声明）；本体里查不到 ⇒ 悬空 */
  readonly requiredSourceIds?: readonly string[];
}

/** 收窄成「像 JSON 对象的记录」（铁律 38：不用被禁的类型断言） */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 取字符串字段（非字符串 ⇒ 空串） */
function readString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

/** 取字符串数组字段（非数组项丢弃） */
function readStringList(rec: Record<string, unknown>, key: string): string[] {
  const v = rec[key];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * 解析本体目录（可注入 —— 判据反例靠它复跑，不靠改仓库本体）。
 *
 * @input  — `GapQuestionInput`（`ontologyDir` 优先；相对路径按 `rootDir` 解析）
 * @output — 本体目录绝对/相对路径（`<rootDir>/extensions/ontology` 为缺省）
 * @degraded — 不适用（纯路径解析，不读盘、不抛）
 */
function resolveOntologyDir(input: GapQuestionInput): string {
  const dir = input.ontologyDir;
  if (typeof dir === 'string' && dir.length > 0) {
    return isAbsolute(dir) ? dir : resolve(input.rootDir ?? process.cwd(), dir);
  }
  return join(input.rootDir ?? process.cwd(), 'extensions', 'ontology');
}

/**
 * 读本体 → 只读投影成来源清单（节点 ∪ 边）。
 *
 * @input  — `ontologyDir`：本体根目录（其下 `resource/` `activity/` `outcome/` `edge-types/`）
 * @output — `{ sources, errors }`：`sources` 每个 = 一个类型；`errors` 每条带错误码
 * @degraded — 目录/子目录缺失、JSON 解析失败、缺 `$id`/`label` ⇒ 记 `errors` + `log.warn`，
 *             **不抛**；`$id` 与路径不一致 ⇒ 记 errors 但**仍收录**（由悬空判定收口，不静默丢）
 */
function loadOntologySources(ontologyDir: string): { sources: OntologySource[]; errors: string[] } {
  const errors: string[] = [];
  const sources: OntologySource[] = [];

  if (!existsSync(ontologyDir)) {
    errors.push(`[ONTOLOGY_DIR_MISSING] ${ontologyDir}`);
    log.warn({ ontologyDir }, '本体目录不存在 — 追问表降级为空（不抛，铁律 24/31）');
    return { sources, errors };
  }

  const plan: ReadonlyArray<{ dir: string; kind: GapSourceKind }> = [
    ...NODE_DIRS.map((dir) => ({ dir, kind: 'node' as GapSourceKind })),
    { dir: EDGE_DIR, kind: 'edge' as GapSourceKind },
  ];

  for (const { dir, kind } of plan) {
    const abs = join(ontologyDir, dir);
    if (!existsSync(abs)) {
      errors.push(`[ONTOLOGY_SUBDIR_MISSING] ${dir}/`);
      log.warn({ dir }, '本体子目录缺失 — 该族类型无法成为来源');
      continue;
    }
    // 排序 ⇒ 读取顺序确定（确定性是 V3 的一条判据，不能依赖 readdir 顺序）
    const files = readdirSync(abs).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(abs, file), 'utf-8'));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push(`[ONTOLOGY_JSON_INVALID] ${dir}/${file}: ${detail}`);
        log.warn({ file, detail }, '本体文件 JSON 解析失败 — 跳过该文件（不静默）');
        continue;
      }
      const rec = asRecord(parsed);
      const declared = rec === null ? '' : readString(rec, '$id');
      const label = rec === null ? '' : readString(rec, 'label');
      if (rec === null || declared.length === 0 || label.length === 0) {
        errors.push(`[ONTOLOGY_SHAPE_INVALID] ${dir}/${file}: 缺 $id 或 label — 来源不可追`);
        log.warn({ file }, '本体文件缺 $id/label — 跳过（显式登记，不静默通过）');
        continue;
      }
      const optionalProps = asRecord(rec['optionalProps']);
      const propHint = optionalProps === null ? [] : Object.keys(optionalProps).slice(0, HINT_MAX);
      const endpointHint = [
        ...readStringList(rec, 'allowedFrom').slice(0, 2),
        ...readStringList(rec, 'allowedTo').slice(0, 2),
      ];
      sources.push({
        id: declared,
        label,
        kind,
        requiredProps: readStringList(rec, 'requiredProps'),
        propHint,
        endpointHint,
        description: readString(rec, 'description'),
      });
    }
  }

  return { sources, errors };
}

/** 已实例化集合（id 与 label 都算命中 —— 企业图既可能存 id 也可能存 label） */
function observedSet(observed: ObservedTypes | undefined): Set<string> {
  const set = new Set<string>();
  for (const v of observed?.nodes ?? []) set.add(v);
  for (const v of observed?.edges ?? []) set.add(v);
  return set;
}

/**
 * 算缺口：本体里有、企业图里没有的类型（**纯函数**，无 I/O）。
 *
 * @input  — `sources` 本体来源清单；`seen` 已实例化集合
 * @output — 未实例化的来源（保持 `sources` 原序；排序由调用方收口）
 * @degraded — 不适用（纯函数；`sources` 为空 ⇒ 返回空，即"本体不可读 ⇒ 不问"由 report 的 degraded 表达）
 */
function computeGaps(sources: readonly OntologySource[], seen: ReadonlySet<string>): OntologySource[] {
  return sources.filter((s) => !seen.has(s.id) && !seen.has(s.label));
}

/** 确定性排序键：节点在前、边在后，各自按 id 升序（不用 localeCompare —— 避免语言环境依赖） */
function byKindThenId(a: OntologySource, b: OntologySource): number {
  if (a.kind !== b.kind) return a.kind === 'node' ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 问题 id：`gq-<kind>-<sanitized sourceId>`（同输入恒等） */
function questionIdOf(source: OntologySource): string {
  const slug = source.id.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `gq-${source.kind}-${slug}`;
}

/** 问题文本：**全部由本体字段派生**（label/description/属性名/端点），不写死任何问题清单 */
function questionTextOf(source: OntologySource): string {
  const desc = source.description.length > 0 ? source.description : '（本体未给描述）';
  if (source.kind === 'node') {
    const hint = source.propHint.length > 0 ? `，需覆盖属性：${source.propHint.join('、')} 等` : '';
    return `需补全节点「${source.label}」：${desc}请说明贵公司在这方面的实际情况${hint}。`;
  }
  const ends = source.endpointHint.length > 0 ? `（本体端点：${source.endpointHint.join('、')}）` : '';
  return `需补全关系「${source.label}」：${desc}请说明贵公司中该关系是否存在、连接哪些对象${ends}。`;
}

/**
 * 生成追问表（本卡的唯一对外入口）。
 *
 * 🔴 有穷且闭合: `questions` 永远 ⊆ 本体类型集；`observed` 覆盖全部类型 ⇒ 空表（不再问）。
 *
 * @input  — `GapQuestionInput`（`observed` / `rootDir` / `ontologyDir`，见文件头契约）
 * @output — `GapQuestionReport`（有序追问表 + 映射表 + 悬空清单 + 三计数 + degraded/errors）
 * @degraded — 本体不可读/坏文件 ⇒ `degraded:true` + `errors[]` + `log.warn`，**不抛**；
 *             来源不可追 ⇒ 进 `dangling`（判据红），不静默丢
 */
export function buildQuestionTable(input: GapQuestionInput = {}): GapQuestionReport {
  const ontologyDir = resolveOntologyDir(input);
  const { sources, errors } = loadOntologySources(ontologyDir);
  const seen = observedSet(input.observed);
  const gaps = computeGaps(sources, seen);
  const ordered = [...gaps].sort(byKindThenId);

  const questions: GapQuestion[] = ordered.map((s, index) => ({
    id: questionIdOf(s),
    order: index,
    text: questionTextOf(s),
    sourceId: s.id,
    sourceKind: s.kind,
  }));

  // 🔴 本体 id 空间的唯一索引 = 文件声明的 `$id`（不用路径反推 —— 边目录名与 id 前缀不同）
  const resolvable = new Set<string>(sources.map((s) => s.id));
  const mapping: GapMappingRow[] = questions.map((q) => ({
    questionId: q.id,
    sourceId: q.sourceId,
    sourceKind: q.sourceKind,
    resolved: resolvable.has(q.sourceId),
  }));
  const unresolvedQuestions = mapping.filter((r) => !r.resolved).map((r) => r.sourceId);
  const missingRequired = (input.requiredSourceIds ?? []).filter((id) => id.length > 0 && !resolvable.has(id));
  if (missingRequired.length > 0) {
    errors.push(`[ONTOLOGY_REQUIRED_MISSING] 必备落点不在本体: ${missingRequired.join(', ')}`);
    log.warn({ missingRequired }, '建档必需落点在本体中查不到 — 判悬空（degraded）');
  }
  const dangling = [...unresolvedQuestions, ...missingRequired];

  const degraded = errors.length > 0 || dangling.length > 0;
  if (dangling.length > 0) {
    log.warn({ dangling }, '追问表存在不可追来源 — 判悬空（degraded）');
  }
  if (errors.length > 0) {
    log.warn({ errors: errors.length, ontologyDir }, '本体读取有降级项 — 追问表仍产出（不抛）');
  }
  log.info(
    { ontologyDir, sourceCount: sources.length, gapCount: questions.length, dangling: dangling.length },
    '追问表生成完成（本体缺口驱动）',
  );

  return {
    questions,
    mapping,
    dangling,
    gapCount: questions.length,
    sourceCount: sources.length,
    observedCount: sources.length - gaps.length,
    degraded,
    errors,
  };
}
