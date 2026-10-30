/**
 * src/output/contract-validator.ts — 产出契约校验器（K12-06 / #189）
 *
 * 架构位置: **交付面（⑤ 导航 → 交付）· 横切校验**（卡面 §「本卡在架构中的位置」）。
 *
 * 出处: 院方《02》§三 机制 3 原文 —— 「**"给格式"不等于"保障一致"—— 要给可校验的格式**」。
 *   本模块把"格式"从**建议**升级为**可机器校验**：产出提交时按产出类型加载契约
 *   （`extensions/reports/contracts/*.yaml`）→ 校验字段/章节/口径/引用 → 不合格**点名报错**。
 *
 * 第二职务（院方《02》§四 飞轮 · 卡面 V4）: 本校验器**同时是反馈采集器** ——
 *   每次校验失败**自动落一条**机器可读记录（JSONL）到失败台账，
 *   成为"下次预设包更新"（K12-08 `src/l4/decision-capture.ts`）的输入。
 *   ⇒ 失败不是终点，是回环的入口。
 *
 * DSH 依据（卡面 §Q1，两采一不采）:
 *   ✅ **schema 强校验 + 早失败** —— `packages/settings/settings/src/index.ts:7`
 *      （`import type z from '@deepseek-ai/schemastery'`；其 Config 用 `z.object(...)` 声明形状）。
 *      本模块同款：契约以**声明式 schema** 描述形状，不合法即失败（不"尽量解析"）。
 *   ✅ **失败可归因、机器可读** —— `@deepseek-ai/dsh-invariants/lib/index.js:11-13`
 *      （`InvariantError{code:'INVARIANT', packageName}`）。
 *      本模块同款：每条错误带**稳定 code**（`<contractId>.<kind>.<fieldPath>`）+ 归属
 *      （哪条契约的哪个字段），消费方可只按 code 分派，不含糊。
 *   ❌ **不采纳宿主统一校验** —— 同上 `:6-8`（package-owned：宿主只提供注册表）。
 *      ⇒ 校验器**随契约走**：schema 定义内联在各自的 `contracts/*.yaml` 里，
 *      本模块**不内置任何契约知识**（加一类产出 = 加一个 yaml，不改本文件）。
 *
 * 宪章 P9（只能追加不能覆盖）: 契约带 `version`；产物经
 *   `ValidationResult.contractVersion` **记录用了哪版**（V6 可版本化）。
 *
 * 契约（铁律 47）:
 *   @input  — ① `validateOutputContract(subject, opts?)`
 *             —— 一页纸产出**提交口自检**，被 `src/agent/report-assembler.ts` 的
 *             `renderOnePager` 调用（真实链：`src/routes/diagnosis.ts:552/812` → `renderOnePager`）。
 *             ② `validateContractObject(contract, subject, opts?)`（**#1075 P2-3 additive 导出**）
 *             —— **对象契约**入口：契约是**内存对象**（不落盘、不按 id 从磁盘加载）。
 *             生产唯一调用方 = `src/init/role-pack-output-standard.ts` 编译出的岗位输出标准，
 *             由 `src/routes/conversations.ts` 在**角色会话每轮 assistant 回复**上调用（非阻断留痕）。
 *             ③ `safeRegExp(pattern)`（**#1075 P2-3 additive 导出**）—— 建正则的唯一实现
 *             （非法模式 ⇒ `null` ＋ `log.warn`，不抛）：P2-3 编译期用它复核
 *             `criteria[].machine.pattern`（**禁**在别处 `new RegExp` 复制一份语义）。
 *             ⚠️ **按 id 从磁盘加载的通用实现 `validateOutput(contractId, subject, opts?)` 仍不导出** ——
 *             它是本模块内部实现（`validateOutput` 与 `validateContractObject` 共用同一校验主体）。
 *             卡面 Q3「按产出类型加载契约」的**磁盘侧消费方**（KPI 表 / 周报 / 诊断报告的提交口）
 *             尚未接线（K12-03 产出 / 报表交付链不在本卡写集内）⇒ 等那时再 `export`。
 *             ⚠️ 同理，`loadContract` / `recordValidationFailure` / `describeValidation` / `checkRules` **不导出**。
 *   @output — `validateOutputContract` 返回 `void`：产出方**无权**据校验结论改变产出
 *             （体检的职责是留痕，不是断路）。`validateOutput` / `validateContractObject` 返回
 *             `ValidationResult`（`ok` / `contractId` / `contractVersion` / `errors[]`），供**提交口**
 *             据此阻断提交；`safeRegExp` 返回 `RegExp | null`。
 *   @degraded — **全部函数永不抛出**（whole-body catch）。
 *             ① 契约文件缺失 / 目录缺失（ENOENT）= **正常默认** ⇒ `errors:[{code:'contract.not_found'}]`
 *                + `log.warn`；
 *             ② YAML 解析失败 / schema 结构非法 = **真错误** ⇒ `errors:[{code:'contract.load_failed'}]`
 *                + `log.error`（两类**不混**：ENOENT 与 parse/结构错误分别点名 —— 铁律 24 例外清单）；
 *             ③ 台账写入失败（磁盘满 / 权限）⇒ 校验结论**不受影响**（校验与留痕解耦）
 *                + `log.warn`。
 *             ④ `validateOutputContract` 自身异常 ⇒ `log.warn` 后**照常放行产出**
 *                （体检不得把可观测性问题升级为可用性问题）。
 *
 * 🔴 隐私约束: 落账记录**不写产出正文**（只写错误码 / 字段路径 / 契约版本）——
 *   契约用于 KPI 表等含敏感数字的产出，台账不得成为原始数据外泄通道
 *   （数据安全 L3「原始数据仅客户企业内部可见」）。
 *
 * 🔴 能力边界（不夸大）: 本模块校验**形状与口径**（字段/章节/单位/域/引用形态），
 *   **不判**：数字是否真确（无原始数据源可比）、被引用对象是否真存在（需 findings 注册表）、
 *   措辞话术（属文档审查域）。这些是契约的**边界**，不是本模块的缺陷。
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { load as parseYaml } from 'js-yaml';
import { createLogger } from '@synova/logger';

const log = createLogger('output/contract-validator');

// ═══ 常量 ═══

/** 契约目录（仓库相对）。环境变量 `SYNOVA_OUTPUT_CONTRACTS_ROOT` 可覆盖（测试注入缝 / 客户覆盖路径）。 */
const DEFAULT_CONTRACTS_ROOT = 'extensions/reports/contracts';

/** 失败台账默认落点（`data/` 已 gitignore —— 运行期产物不入库）。 */
const DEFAULT_FAILURE_SINK = 'data/output-contract-failures.jsonl';

/** 台账落点环境变量。 */
const SINK_ENV = 'SYNOVA_OUTPUT_CONTRACT_SINK';
/** 契约根环境变量。 */
const ROOT_ENV = 'SYNOVA_OUTPUT_CONTRACTS_ROOT';

// ═══ 契约形状（契约文件自身的 schema —— 供本模块解析；不是被校验产出的 schema）═══

/** 单条字段声明 */
export interface ContractField {
  /** 字段路径。支持数组通配 `rows[].name`。 */
  readonly path: string;
  /** 是否必填。`true` ⇒ 缺席/空串/空数组即报错。 */
  readonly required?: boolean;
  readonly description?: string;
}

/** 单条检查声明 */
export interface ContractCheck {
  readonly id?: string;
  /** 检查种类：`idFormat` | `noPattern` | `textPattern` | `range` | `valueUnique` | `unitConsistency` */
  readonly kind: string;
  /** 被检查的路径（`unitConsistency` 用 `rows[]`，其余为具体路径）。 */
  readonly path?: string;
  /** `valueUnique` 的分组字段。 */
  readonly groupBy?: string;
  /** `unitConsistency` 的单位字段名。 */
  readonly unitField?: string;
  readonly pattern?: string;
  readonly min?: number;
  readonly max?: number;
  readonly message: string;
}

/** 章节声明（markdown 标题） */
export interface ContractSection {
  readonly title: string;
  readonly required?: boolean;
  readonly description?: string;
}

/** 引用声明（某章节内至少要 N 行匹配 pattern） */
export interface ContractPointer {
  readonly id?: string;
  readonly section: string;
  readonly min: number;
  readonly pattern: string;
  readonly message: string;
}

/** 契约实体声明（产出应提供的键） */
export interface ContractEntry {
  readonly name: string;
  readonly type: string;
  readonly required?: boolean;
  readonly description?: string;
}

/** 契约头 */
export interface ContractMeta {
  readonly id: string;
  readonly version: number;
  readonly title?: string;
  readonly format?: string;
  readonly generatedAt?: string;
}

/** 一条产出契约（= 一个 `contracts/*.yaml`） */
export interface OutputContract {
  readonly meta: ContractMeta;
  readonly entries: readonly ContractEntry[];
  readonly checks: readonly ContractCheck[];
  readonly fields: readonly ContractField[];
  readonly sections: readonly ContractSection[];
  readonly pointers: readonly ContractPointer[];
  /** 契约文件绝对路径（错误归属用） */
  readonly sourcePath: string;
}

// ═══ 校验结果 ═══

/**
 * 一条校验错误。
 *
 * `code` 是**稳定机器码**，形态 `<contractId>.<kind>.<fieldPath>`：
 *   - `<contractId>` —— 哪条契约（`one-pager`）
 *   - `<kind>`       —— 哪类规则（`field` / `section` / `pointer` / `unit` / `range` / `id` / `load`）
 *   - `<fieldPath>`  —— 哪个字段/章节（`orgId` / `### 结论`）
 * 加载类错误 `code` 为 `contract.not_found` / `contract.load_failed`（此路径未知 contractId）。
 */
export interface ContractError {
  readonly code: string;
  /** 契约 id（加载失败时可能为 null）。 */
  readonly contractId: string | null;
  /** 契约版本（加载失败时可能为 null）。 */
  readonly contractVersion: number | null;
  readonly kind: string;
  readonly fieldPath: string;
  readonly message: string;
  /** 契约文件绝对路径（可复跑定位）。 */
  readonly sourcePath: string | null;
}

/** 一次校验的落账记录（第二职务的数据载体） */
export interface ValidationFailureRecord {
  /** 记录时刻（ISO 8601） */
  readonly recordedAt: string;
  readonly contractId: string | null;
  readonly contractVersion: number | null;
  /** 错误码清单（不写正文 —— 隐私约束） */
  readonly codes: readonly string[];
  /** 字段/章节路径清单 */
  readonly fieldPaths: readonly string[];
  readonly errorCount: number;
  /** 失败台账落点（便于消费方定位原始行） */
  readonly sinkPath: string;
}

/** 台账写入结果 */
export interface RecordFailureOutcome {
  readonly recorded: boolean;
  readonly sinkPath: string;
  /** `recorded:false` 时的原因（不静默 —— 铁律 11） */
  readonly reason?: string;
}

/** 校验结论 */
export interface ValidationResult {
  readonly ok: boolean;
  readonly contractId: string | null;
  /** 产物**记录用了哪版契约**（V6）。加载失败时为 null。 */
  readonly contractVersion: number | null;
  readonly errors: readonly ContractError[];
  /** `ok:false` 时必有（第二职务）；`ok:true` 时为 null。 */
  readonly failureRecord: ValidationFailureRecord | null;
  /** 台账写入结果（`ok:true` 时为 null）。 */
  readonly recorded: RecordFailureOutcome | null;
}

/** 校验选项 */
export interface ValidateOptions {
  /** 契约根（默认 `DEFAULT_CONTRACTS_ROOT`，环境变量可覆盖） */
  readonly contractsRoot?: string;
  /** 失败台账落点（默认 `DEFAULT_FAILURE_SINK` / 环境变量）。传 `null` ⇒ 只校验不落账。 */
  readonly sinkPath?: string | null;
  /** 记录时刻注入缝（测试可确定性断言） */
  readonly now?: string;
}

// ═══ 契约加载 ═══

const contractCache = new Map<string, OutputContract>();

/**
 * 相对路径挂到 `process.cwd()`；**绝对路径原样返回**。
 *
 * 🔴 为什么必须判 `isAbsolute`：`join(cwd, '/var/folders/…')` 会拼成
 *   `<cwd>/var/folders/…`（Node `path.join` 不认"绝对路径覆盖前缀"）⇒ 落点静默偏移到
 *   仓库内的伪路径，而调用方按原绝对路径去读 ⇒ **读到不存在**。
 *   这是"测试用临时目录"与"客户自定义绝对路径"共同的必踩点，故在此收口。
 */
function resolveAgainstCwd(p: string): string {
  return isAbsolute(p) ? p : join(process.cwd(), p);
}

/** 契约根解析：显式入参 > 环境变量 > 默认（仓库相对）。绝对路径原样使用。 */
function resolveContractsRoot(explicit?: string): string {
  const fromEnv = process.env[ROOT_ENV];
  const root = explicit ?? (fromEnv !== undefined && fromEnv !== '' ? fromEnv : DEFAULT_CONTRACTS_ROOT);
  return resolveAgainstCwd(root);
}

/** 台账落点解析：显式入参 > 环境变量 > 默认。绝对路径原样使用。 */
function resolveSinkPath(explicit?: string | null): string | null {
  if (explicit === null) return null;
  const fromEnv = process.env[SINK_ENV];
  const sink = explicit ?? (fromEnv !== undefined && fromEnv !== '' ? fromEnv : DEFAULT_FAILURE_SINK);
  return resolveAgainstCwd(sink);
}

/** 契约 id 白名单（防路径穿越：`../` 不可进 `contracts/*.yaml` 之外的路径）。 */
const CONTRACT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 契约文件路径解析 */
function contractFilePath(contractId: string, contractsRoot: string): string {
  return join(contractsRoot, `${contractId}.yaml`);
}

/** unknown → 对象（零断言，铁律 38） */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** unknown → 字符串（非字符串 → 空串） */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** unknown → 有限数（否则 undefined） */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 把契约文件的原始对象解析成 `OutputContract`；结构非法 ⇒ 返回原因串（不是异常）。 */
function buildContract(raw: unknown, sourcePath: string): { contract: OutputContract | null; problem: string | null } {
  const root = asRecord(raw);
  if (root === null) return { contract: null, problem: '契约文件顶层不是映射（object）' };

  const metaRaw = asRecord(root['contract']);
  if (metaRaw === null) return { contract: null, problem: '缺少 `contract:` 段（契约头）' };
  const id = asString(metaRaw['id']);
  const version = asFiniteNumber(metaRaw['version']);
  if (id === '') return { contract: null, problem: '`contract.id` 缺失或非字符串' };
  if (version === undefined) return { contract: null, problem: '`contract.version` 缺失或非有限数（宪章 P9：契约必须带版本）' };

  const schemaRaw = asRecord(root['schema']);
  const entriesRaw = schemaRaw === null ? [] : schemaRaw['entries'];
  const entries: ContractEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const e of entriesRaw) {
      const er = asRecord(e);
      if (er === null) continue;
      const name = asString(er['name']);
      if (name === '') continue;
      entries.push({
        name,
        type: asString(er['type']),
        required: er['required'] === true,
        description: asString(er['description']) || undefined,
      });
    }
  }

  const checks: ContractCheck[] = [];
  const fields: ContractField[] = [];
  const sections: ContractSection[] = [];
  const pointers: ContractPointer[] = [];

  const pushCheck = (c: unknown): void => {
    const cr = asRecord(c);
    if (cr === null) return;
    const kind = asString(cr['kind']);
    const message = asString(cr['message']);
    if (kind === '' || message === '') return;
    checks.push({
      id: asString(cr['id']) || undefined,
      kind,
      path: asString(cr['path']) || undefined,
      groupBy: asString(cr['groupBy']) || undefined,
      unitField: asString(cr['unitField']) || undefined,
      pattern: asString(cr['pattern']) || undefined,
      min: asFiniteNumber(cr['min']),
      max: asFiniteNumber(cr['max']),
      message,
    });
  };

  if (Array.isArray(root['checks'])) for (const c of root['checks']) pushCheck(c);

  if (Array.isArray(root['fields'])) {
    for (const f of root['fields']) {
      const fr = asRecord(f);
      if (fr === null) continue;
      const path = asString(fr['path']);
      if (path === '') continue;
      fields.push({ path, required: fr['required'] === true, description: asString(fr['description']) || undefined });
    }
  }

  if (Array.isArray(root['sections'])) {
    for (const s of root['sections']) {
      const sr = asRecord(s);
      if (sr === null) continue;
      const title = asString(sr['title']);
      if (title === '') continue;
      sections.push({ title, required: sr['required'] === true, description: asString(sr['description']) || undefined });
    }
  }

  if (Array.isArray(root['pointers'])) {
    for (const p of root['pointers']) {
      const pr = asRecord(p);
      if (pr === null) continue;
      const section = asString(pr['section']);
      const pattern = asString(pr['pattern']);
      const message = asString(pr['message']);
      const min = asFiniteNumber(pr['min']);
      if (section === '' || pattern === '' || message === '' || min === undefined) continue;
      pointers.push({ id: asString(pr['id']) || undefined, section, min, pattern, message });
    }
  }

  return {
    contract: {
      meta: { id, version, title: asString(metaRaw['title']) || undefined,
        format: asString(metaRaw['format']) || undefined,
        generatedAt: asString(metaRaw['generated_at']) || undefined },
      entries,
      checks,
      fields,
      sections,
      pointers,
      sourcePath,
    },
    problem: null,
  };
}

/**
 * 契约加载失败的**结构化原因**（供调用方分类，不靠错误文案前缀嗅探）。
 *
 * 🔴 为什么要有这个：第一版用 `problem.startsWith('契约文件不存在')` 分类 ENOENT / 真错误 ——
 *   `startsWith` 依赖**文案措辞**，改了文案就静默改判（"契约 id 形态非法…" 不以该前缀开头
 *   ⇒ 被误判成 `load_failed`）。分类是**语义**，必须结构化，不能靠字符串形状。
 */
export type ContractLoadReason =
  | 'ok'
  | 'invalid-id'      // 契约 id 形态非法 ⇒ 该契约不可能存在（含路径穿越尝试）
  | 'missing-file'    // ENOENT = 正常默认（未声明该契约）
  | 'parse-failed'    // YAML 解析失败 = 真错误
  | 'schema-invalid'; // 结构非法（缺 contract.id / contract.version 等）= 真错误

/** `loadContract` 返回面 */
export interface ContractLoadResult {
  contract: OutputContract | null;
  problem: string | null;
  reason: ContractLoadReason;
  degraded: boolean;
}

/**
 * 加载一条产出契约。
 *
 * 契约:
 *   @input  contractId — 契约 id（`^[a-z0-9][a-z0-9-]{0,63}$`；不合形态即 `invalid-id`，防路径穿越）
 *           contractsRoot — 可选；默认 `DEFAULT_CONTRACTS_ROOT`（环境变量 `SYNOVA_OUTPUT_CONTRACTS_ROOT` 覆盖）
 *   @output `ContractLoadResult` —— `contract` 为 null 时 `problem` 非空点名原因，
 *           且 `reason` **结构化**给出分类（不靠文案嗅探）
 *   @degraded 见 `ContractLoadReason` 各值注释。本函数永不抛出。
 */
function loadContract(
  contractId: string,
  contractsRoot?: string,
): ContractLoadResult {
  const root = resolveContractsRoot(contractsRoot);
  const cacheKey = `${root}::${contractId}`;
  const cached = contractCache.get(cacheKey);
  if (cached !== undefined) return { contract: cached, problem: null, reason: 'ok', degraded: false };

  if (!CONTRACT_ID_RE.test(contractId)) {
    // 形态非法 ⇒ 该契约**不可能存在**（且天然挡住路径穿越：id 里禁 `/`）⇒ 归 not_found 一侧，
    // 不归 load_failed 一侧（后者专指"文件在、但读/解析不了"的真错误 —— 两类不混）。
    const problem = `契约 id 形态非法（须匹配 ${CONTRACT_ID_RE.source}）⇒ 该契约不存在: ${JSON.stringify(contractId)}`;
    log.warn({ contractId, root }, `契约加载失败 — ${problem}`);
    return { contract: null, problem, reason: 'invalid-id', degraded: true };
  }

  const file = contractFilePath(contractId, root);
  if (!existsSync(file)) {
    // ENOENT = 正常默认（未声明该契约 ⇒ 不强行校验），非异常
    const problem = `契约文件不存在: ${file}`;
    log.warn({ contractId, file }, '契约未声明 — degraded（ENOENT，未声明即不校验）');
    return { contract: null, problem, reason: 'missing-file', degraded: true };
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf-8'));
  } catch (err: unknown) {
    const problem = `契约 YAML 解析失败: ${file}`;
    log.error({ err, contractId, file }, '契约解析失败 — 真错误（区别于 ENOENT）');
    return { contract: null, problem, reason: 'parse-failed', degraded: true };
  }

  const built = buildContract(raw, file);
  if (built.contract === null) {
    log.error({ contractId, file, problem: built.problem }, '契约结构非法 — 真错误');
    return { contract: null, problem: built.problem, reason: 'schema-invalid', degraded: true };
  }

  contractCache.set(cacheKey, built.contract);
  return { contract: built.contract, problem: null, reason: 'ok', degraded: false };
}


// ═══ 取值（数组通配）═══

/**
 * 按路径取值。支持 `a.b` 与数组通配 `rows[].name`。
 *
 * **通配语义 = 逐元素取值（pluck）**，不是"把整个数组交回来"：
 *   `rows[].period` ⇒ 每行的 `period` 值组成的数组。
 *   ⇒ 这是"口径"能被机器判的前提（期间唯一 / 单位一致 / 数值域都要**逐行**看）。
 *   ⚠️ `rows[].x` 与 `rows` 是**两个不同的路径**：
 *      · `rows`          ⇒ 整个数组（用于"数组本身在不在"）
 *      · `rows[].period` ⇒ 逐行 pluck（用于"每行都有 period 吗"）
 *
 * 返回 `undefined` = 路径不存在；返回 `[]` = 通配路径下**没有任何元素**。
 */
function readPath(subject: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = subject;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const wildcard = segment.endsWith('[]');
    const key = wildcard ? segment.slice(0, -2) : segment;

    const container = asRecord(current);
    if (container === null) return undefined;
    if (!(key in container)) return undefined;

    const value = container[key];
    if (!wildcard) {
      current = value;
      continue;
    }

    // 通配段：value 必须是数组
    if (!Array.isArray(value)) return undefined;
    const rest = segments.slice(i + 1).join('.');
    if (rest === '') return value;                       // 通配在末尾 ⇒ 整个数组
    // 通配在中间/带尾 ⇒ 逐元素 pluck。
    // 🔴 任一行取不到 rest ⇒ 整体返回 `undefined`（**缺席信号**），不是 `[undefined, …]`：
    //    后者是"有值的数组"，会让 `isPresent` 判为已填 ⇒ **静默漏掉必填缺失**（就是本行要防的洞）。
    //    这里返回 undefined 后，`fields[].required` 一条就能点名 `rows[].x` 缺席（归因唯一）。
    const plucked: unknown[] = [];
    for (const item of value) {
      const itemRecord = asRecord(item);
      if (itemRecord === null) return undefined;
      const got = readPath(itemRecord, rest);
      if (got === undefined) return undefined;
      plucked.push(got);
    }
    return plucked;
  }

  return current;
}

/**
 * 值是否"已填"。
 *
 * 🔴 `[]` 算**已填**（不是缺席）—— 理由是"没填"与"填了但没有"必须机器可分：
 *   周报的 `blocked: []` = **如实写了"本周无阻塞"**；若判缺席 ⇒ 逼人编一条假阻塞，
 *   或让"没填"与"没阻塞"不可分（正是本卡要消灭的那类歧义）。
 *   ⇒ 想禁空数组的契约用 `minItems` 检查**显式**声明（如 KPI 表的 `rows`），
 *     而不是靠"空数组一律算缺席"这种隐式全局规则（隐式规则是口径漂移之源）。
 */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

// ═══ 错误构造 ═══

function makeError(
  contract: OutputContract | null,
  kind: string,
  fieldPath: string,
  message: string,
): ContractError {
  const contractId = contract === null ? null : contract.meta.id;
  const contractVersion = contract === null ? null : contract.meta.version;
  const code = contract === null ? `contract.${kind}` : `${contractId}.${kind}.${fieldPath}`;
  return {
    code,
    contractId,
    contractVersion,
    kind,
    fieldPath,
    message: `[${code}] ${contract === null ? '(未加载契约)' : `${contractId}@${contractVersion}`} ${fieldPath}: ${message}`,
    sourcePath: contract === null ? null : contract.sourcePath,
  };
}

// ═══ 校验 ═══

/** 章节标题是否在正文中作为**独立行**出现（`### 结论` 形态；避免子串误命中）。 */
function hasSectionLine(text: string, title: string): boolean {
  return text.split('\n').some((line) => line.trim() === title);
}

/** 取某章节的正文行（从该标题行到下一个同级/更高级标题之前）。 */
function sectionLines(text: string, title: string): string[] {
  const lines = text.split('\n');
  const heads = lines.reduce<number[]>((acc, line, i) => {
    if (line.trim() === title) acc.push(i);
    return acc;
  }, []);
  if (heads.length === 0) return [];

  const start = heads[heads.length - 1] + 1;
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    out.push(lines[i]);
  }
  return out;
}

/**
 * 建正则（**本模块唯一实现**）：模式非法 ⇒ 返回 `null`（不抛出，由调用方降级）。
 *
 * 🔴 **#1075 P2-3 additive 导出**的理由：岗位输出标准编译期须复核 `criteria[].machine.pattern`
 *   是否为合法正则（规格 §2.3-C 末条）。若在编译侧另写一个 `new RegExp` try/catch，
 *   就会出现**第二套正则语义**（非法模式的判定/留痕两处漂移）⇒ 故导出本函数供复用
 *   （生产调用方 = `src/init/role-pack-output-standard.ts`；本文件内部调用点不变）。
 *
 * @param pattern - 正则源串（调用方负责长度上限；本函数不限额）
 * @returns 编译结果；非法模式 ⇒ `null` ＋ 一条 `log.warn`（不静默、不抛）
 */
export function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch (err: unknown) {
    log.warn({ err, pattern }, '契约中的正则模式非法 — 该条检查降级跳过');
    return null;
  }
}

/** 逐字段必填检查 */
function checkFields(
  contract: OutputContract,
  subject: Record<string, unknown>,
  errors: ContractError[],
): void {
  for (const field of contract.fields) {
    if (field.required !== true) continue;
    const value = readPath(subject, field.path);
    // 通配路径语义（`readPath` 保证）：`rows[].x`
    //   · 任一行缺 `x`（或 `rows` 不是数组）⇒ `readPath` 返回 `undefined` ⇒ **点名缺席**（逐行必填）
    //   · `rows: []`（零行）     ⇒ `readPath` 返回 `[]` ⇒ 空数组算"已填但为空"，
    //                              想禁空表由契约用 `minItems` **显式**声明（如 kpi-table）
    if (!isPresent(value)) {
      errors.push(makeError(contract, 'field', field.path, '必填字段缺席或为空 —— 产出不得提交'));
    }
  }
}

/** 章节齐备检查 */
function checkSections(
  contract: OutputContract,
  text: string | null,
  errors: ContractError[],
): void {
  for (const section of contract.sections) {
    if (section.required !== true) continue;
    if (text === null) {
      errors.push(makeError(contract, 'section', section.title, '缺少可校验正文（subject.text 非字符串）—— 无法判定章节'));
      continue;
    }
    if (!hasSectionLine(text, section.title)) {
      errors.push(makeError(contract, 'section', section.title, '必填章节缺席 —— 固定结构已破'));
    }
  }
}

/** 引用检查（某章节内至少有 min 行匹配 pattern） */
function checkPointers(
  contract: OutputContract,
  text: string | null,
  errors: ContractError[],
): void {
  for (const pointer of contract.pointers) {
    const label = pointer.id ?? pointer.section;
    if (text === null) {
      errors.push(makeError(contract, 'pointer', label, '缺少可校验正文（subject.text 非字符串）—— 无法判定引用'));
      continue;
    }
    const re = safeRegExp(pointer.pattern);
    if (re === null) continue; // 模式非法已在 safeRegExp 内 log.warn，此处跳过（不静默：已有告警）
    const body = sectionLines(text, pointer.section);
    const hits = body.filter((line) => re.test(line)).length;
    if (hits < pointer.min) {
      errors.push(makeError(
        contract, 'pointer', label,
        `${pointer.message}（章节「${pointer.section}」实际命中 ${hits} 行 < 要求 ${pointer.min} 行）`,
      ));
    }
  }
}

/** 检查项：通用规则 */
function checkRules(
  contract: OutputContract,
  subject: Record<string, unknown>,
  text: string | null,
  errors: ContractError[],
): void {
  for (const check of contract.checks) {
    const label = check.id ?? check.kind;
    switch (check.kind) {
      case 'idFormat':
      case 'textPattern': {
        const targetPath = check.path ?? '';
        const isText = check.kind === 'textPattern';
        // 通配路径（`rows[].metricId`）取值是**数组** ⇒ 逐元素判，且**缺席元素跳过**：
        // "某行没填这个字段"由 `fields[].required` 那条唯一负责点名，此处再报一次
        // 就会让同一缺陷产生两条错误码（`field.rows[].x` + `id.rows[].x`）—— 归因失真。
        const raw = isText ? text : readPath(subject, targetPath);
        const values: unknown[] = Array.isArray(raw) ? raw : [raw];
        const re = safeRegExp(check.pattern ?? '');
        if (re === null) break;

        // 先判"值形态"（必须字符串），再判"值内容"（必须匹配 pattern）。
        // 🔴 两条都要覆盖**通配路径**（`rows[].metricId`）：`required` 只管"值在不在"，
        //    不管"值是不是对的类型" —— 只覆盖单值路径 ⇒ `metricId: 123` 被**静默接受**
        //    （"校验器看着在跑，却放过非法类型"正是本卡要消灭的洞）。
        //    每条路径只报一条（不因多行同型错刷屏）⇒ found 标记后跳出。
        let found = false;
        for (const value of values) {
          if (typeof value !== 'string') {
            if (isText) continue;
            found = true;
            break;
          }
          if (!isPresent(value)) continue;   // 缺席由 `fields[].required` 唯一负责
          if (!re.test(value)) {
            found = true;
            break;
          }
        }
        if (found) {
          // textPattern 是**文档级**检查（无字段可归属）⇒ 用 check id 做归属；
          // idFormat 是**字段级** ⇒ 用字段路径做归属。两者都保持"哪条契约·哪条规则/字段"。
          const attr = isText ? label : (targetPath === '' ? label : targetPath);
          errors.push(makeError(contract, isText ? 'text' : 'id', attr, check.message));
        }
        break;
      }
      case 'noPattern': {
        if (text === null) break;
        const re = safeRegExp(check.pattern ?? '');
        if (re === null) break;
        if (re.test(text)) {
          errors.push(makeError(contract, 'text', label, check.message));
        }
        break;
      }
      case 'range': {
        const targetPath = check.path ?? '';
        const raw = readPath(subject, targetPath);
        const values = Array.isArray(raw) ? raw : [raw];
        for (const value of values) {
          const num = asFiniteNumber(value);
          if (num === undefined) {
            errors.push(makeError(contract, 'range', targetPath, `${check.message}（值非有限数）`));
            break;
          }
          if ((check.min !== undefined && num < check.min) || (check.max !== undefined && num > check.max)) {
            errors.push(makeError(contract, 'range', targetPath, `${check.message}（实际 ${num}）`));
            break;
          }
        }
        break;
      }
      case 'minItems': {
        const targetPath = check.path ?? '';
        const raw = readPath(subject, targetPath);
        const min = check.min ?? 1;
        if (!Array.isArray(raw)) {
          errors.push(makeError(contract, 'minItems', targetPath, `${check.message}（该字段不是数组或缺席）`));
          break;
        }
        if (raw.length < min) {
          errors.push(makeError(
            contract, 'minItems', targetPath,
            `${check.message}（实际 ${raw.length} 项 < 要求 ${min} 项）`,
          ));
        }
        break;
      }
      case 'valueUnique': {
        const targetPath = check.path ?? '';
        const raw = readPath(subject, targetPath);
        if (!Array.isArray(raw)) break;
        const seen = new Set<string>();
        for (const value of raw) {
          const s = typeof value === 'string' ? value : JSON.stringify(value);
          if (s === undefined) continue;
          seen.add(s);
        }
        if (seen.size > 1) {
          errors.push(makeError(
            contract, 'unique', targetPath,
            `${check.message}（实际出现 ${seen.size} 个不同取值: ${[...seen].sort().join(' / ')}）`,
          ));
        }
        break;
      }
      case 'unitConsistency': {
        const targetPath = check.path ?? 'rows[]';
        const rowsRaw = readPath(subject, targetPath);
        if (!Array.isArray(rowsRaw)) break;
        const groupBy = check.groupBy ?? 'metricId';
        const unitField = check.unitField ?? 'unit';
        const byGroup = new Map<string, Set<string>>();
        for (const row of rowsRaw) {
          const r = asRecord(row);
          if (r === null) continue;
          const group = asString(r[groupBy]);
          const unit = asString(r[unitField]);
          if (group === '' || unit === '') continue;
          const set = byGroup.get(group) ?? new Set<string>();
          set.add(unit);
          byGroup.set(group, set);
        }
        for (const [group, units] of byGroup) {
          if (units.size > 1) {
            errors.push(makeError(
              contract, 'unit', `${group}.${unitField}`,
              `${check.message}（${group} 出现 ${units.size} 种单位: ${[...units].sort().join(' / ')}）`,
            ));
          }
        }
        break;
      }
      default:
        log.warn({ contractId: contract.meta.id, kind: check.kind }, '契约声明了未知检查种类 — 该条降级跳过');
        break;
    }
  }
}

/**
 * 落一条失败记录到台帐（第二职务的物理载体）。
 *
 * 契约:
 *   @input  record — `ValidationFailureRecord`；sinkPath — 显式落点（`null` ⇒ 不落）
 *   @output `{ recorded, sinkPath, reason? }`
 *   @degraded 写失败（权限 / 磁盘）⇒ `{ recorded:false, reason }` + `log.warn`，**永不抛出**。
 *             写入 1 行 JSON + `\n`（JSONL，追加语义 —— 台账只增不改）。
 */
function recordValidationFailure(
  record: ValidationFailureRecord,
  sinkPath?: string | null,
): RecordFailureOutcome {
  const sink = resolveSinkPath(sinkPath);
  if (sink === null) {
    return { recorded: false, sinkPath: '', reason: '落账显式关闭（sinkPath=null）' };
  }
  try {
    mkdirSync(dirname(sink), { recursive: true });
    appendFileSync(sink, `${JSON.stringify(record)}\n`, 'utf-8');
    return { recorded: true, sinkPath: sink };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ err, sink }, '失败台账写入失败 — 校验结论不受影响（校验与留痕解耦，铁律 24）');
    return { recorded: false, sinkPath: sink, reason };
  }
}

/**
 * 组结果 ＋ 失败落账 ＋ 留痕（`validateOutput` 与 `validateContractObject` 的**唯一**收口）。
 *
 * 抽出来的理由：两条入口的差别只在"契约从哪来"（磁盘按 id 加载 vs 内存对象），
 * **结果形状/落账/日志必须逐字一致** —— 各写一份就是两套口径（改一处漏一处）。
 *
 * @param contract - 已加载/已建好的契约；`null` ⇒ 加载失败分支（`contractIdForLog` 用入参 id 记日志）
 * @param contractIdForLog - 日志里的契约标识（加载失败时用入参 id；成功时 = `contract.meta.id`）
 * @param errors - 校验错误累加器（**调用方持有**，本函数只读）
 * @param opts - `sinkPath` / `now` 注入缝
 * @returns `ValidationResult`；`ok:true` ⇒ 不落账、字段 `failureRecord`／`recorded` 均为 `null`
 * @degraded 落账失败 ⇒ 校验结论不变（`recorded.reason` 点名，铁律 24）；**永不抛出**
 */
function finalizeValidation(
  contract: OutputContract | null,
  contractIdForLog: string,
  errors: readonly ContractError[],
  opts: ValidateOptions,
): ValidationResult {
  const result: ValidationResult = {
    ok: errors.length === 0,
    contractId: contract === null ? null : contract.meta.id,
    contractVersion: contract === null ? null : contract.meta.version,
    errors,
    failureRecord: null,
    recorded: null,
  };

  if (result.ok) return result;

  const sink = resolveSinkPath(opts.sinkPath);
  const record: ValidationFailureRecord = {
    recordedAt: opts.now ?? new Date().toISOString(),
    contractId: result.contractId,
    contractVersion: result.contractVersion,
    codes: errors.map((e) => e.code),
    fieldPaths: errors.map((e) => e.fieldPath),
    errorCount: errors.length,
    sinkPath: sink ?? '',
  };
  const recorded = recordValidationFailure(record, opts.sinkPath);

  log.warn(
    {
      contractId: contractIdForLog, contractVersion: result.contractVersion,
      codes: record.codes, fieldPaths: record.fieldPaths,
      recorded: recorded.recorded,
    },
    '产出契约校验失败 — 已拒绝 + 落账（第二职务：成为下次预设包更新的输入）',
  );

  return { ...result, failureRecord: record, recorded };
}

/**
 * 校验一份**内存对象契约**（#1075 P2-3 导出的对象入口）。
 *
 * 契约:
 *   @input  contract — 已建好的 `OutputContract`（**不从磁盘加载**；调用方负责其来源与可信性）
 *           subject  — 产出本体（同 `validateOutput`：`text` 键为正文时章节/引用可判）
 *           opts     — `sinkPath` / `now`（`contractsRoot` 对对象入口**不适用**，忽略；见 `ValidateOptions`）
 *   @output `ValidationResult` —— 与 `validateOutput` **同形同义**（`ok` / `errors[]` / `failureRecord` / `recorded`）
 *   @degraded 同 `validateOutput`：永不抛出；失败自动落账（`sinkPath` 缺省走 env／默认落点），
 *             落账失败不影响校验结论。
 *   @authority 生产唯一调用方 = `src/routes/conversations.ts`（经
 *             `src/init/role-pack-output-standard.ts` 编译出的岗位输出标准）。
 *             本函数**不做**"该不该校验"的判断（审批门/开关归编译侧）——它只校验、只留痕。
 *   ⚠️ 与 `validateOutput` 的行为等价性由 `tests/output/contract-validator.test.ts`（33 用例，改前基线）
 *      钉死：`validateOutput` 的契约存在分支改为调用本函数，故两条路径共用同一校验主体。
 */
export function validateContractObject(
  contract: OutputContract,
  subject: Record<string, unknown>,
  opts: ValidateOptions = {},
): ValidationResult {
  const errors: ContractError[] = [];
  const rawText = subject['text'];
  const text = typeof rawText === 'string' ? rawText : null;

  checkFields(contract, subject, errors);
  checkSections(contract, text, errors);
  checkPointers(contract, text, errors);
  checkRules(contract, subject, text, errors);

  return finalizeValidation(contract, contract.meta.id, errors, opts);
}

/**
 * 校验一份产出（**按 id 从磁盘加载**的内部口；不导出）。
 *
 * 契约:
 *   @input  contractId — 契约 id（`contracts/<id>.yaml`）
 *           subject    — 产出本体（已解码对象；`text` 键为 markdown 正文时章节/引用可判）
 *           opts       — `contractsRoot` / `sinkPath` / `now`（见 `ValidateOptions`）
 *   @output `ValidationResult` —— `ok` + `contractId` + **`contractVersion`（产物记录用了哪版）**
 *            + `errors[]`（每条带稳定 code，点名契约+字段）+ `failureRecord` + `recorded`
 *   @degraded 契约未声明 / 解析失败 ⇒ `ok:false` + 一条 `contract.not_found`（或 `contract.load_failed`）
 *             错误；**校验失败不抛异常**（产出提交链不应因校验崩溃）。
 *             失败自动落账；落账失败不影响校验结论。
 *   ⚠️ `ok:false` 的语义 = **产出被拒**（提交链据此阻断），不是"校验器崩了"。
 *      调用方须读 `errors[].fieldPath` 点名缺哪个字段（V6 判据）。
 *   🔴 #1075 P2-3：契约存在分支**改为调用 `validateContractObject`**（行为等价；既有 33 用例全绿是硬门）。
 */
function validateOutput(
  contractId: string,
  subject: Record<string, unknown>,
  opts: ValidateOptions = {},
): ValidationResult {
  const loaded = loadContract(contractId, opts.contractsRoot);

  if (loaded.contract !== null) {
    return validateContractObject(loaded.contract, subject, opts);
  }

  // 分类走**结构化 reason**，不靠文案前缀嗅探（文案改一个字就静默改判 = 口径漂移之源）
  const isNotFound = loaded.reason === 'invalid-id' || loaded.reason === 'missing-file';
  const kind = isNotFound ? 'not_found' : 'load_failed';
  const errors: ContractError[] = [
    {
      code: `contract.${kind}`,
      contractId: null,
      contractVersion: null,
      kind,
      fieldPath: contractId,
      message: `[contract.${kind}] (未加载契约) ${contractId}: ${loaded.problem ?? '未知原因'}`,
      sourcePath: null,
    },
  ];

  return finalizeValidation(null, contractId, errors, opts);
}

/**
 * 便捷入口：校验失败时返回**直接可展示**的点名串（"缺哪个字段"一行说清）。
 *
 * @input  同 `validateOutput`
 * @output `{ ok, contractVersion, code, message }` —— `ok:true` 时 `message` 为空串
 * @degraded 同 `validateOutput`（永不抛出）；契约未声明 ⇒ `ok:false` + `contract.not_found`
 */
function describeValidation(
  contractId: string,
  subject: Record<string, unknown>,
  opts: ValidateOptions = {},
): { ok: boolean; contractVersion: number | null; codes: string[]; message: string } {
  const result = validateOutput(contractId, subject, opts);
  return {
    ok: result.ok,
    contractVersion: result.contractVersion,
    codes: result.errors.map((e) => e.code),
    message: result.errors.map((e) => e.message).join('\n'),
  };
}

/**
 * 一页纸产出的**提交口自检**（生产调用的唯一收口 —— 交付面横切）。
 *
 * 为什么要有这一层（而不是让产出方各自 `validateOutput`）:
 *   ① **单一收口**：一页纸有三个入口（`renderOnePager` 的 ceo / flywheel 深度 +
 *      `diagnosis.ts:812` 的按需渲染路径）。收口到一个函数 ⇒ 加一个入口不必重复接线。
 *   ② **绝不阻断**：本函数**永不抛出、永不改变产出**（`@output void`）。
 *      产出链的职责是产出；体检的职责是**留痕**。把体检做成断路 = 把"报告出来了但被拒"
 *      变成"报告出不来"——那是把可观测性问题升级成可用性问题（违反方向锚"让准度可测量"）。
 *   ③ **它同时是第二职务的触发点**：失败经 `validateOutput` **自动落账**
 *      （`data/output-contract-failures.jsonl`），成为下次预设包更新的输入（院方 §四 飞轮）。
 *
 * 契约:
 *   @input  subject — `{ text, orgId, generatedAt }`（一页纸产出的三要素）；
 *                     `text` = `renderOnePager` 的 markdown 返回值（那正是**当前这行代码
 *                     正在交出去的**东西 ⇒ 校验的是真产出，不是副本）
 *           opts    — 透传 `ValidateOptions`（测试注入 `sinkPath` / `now`）
 *   @output 无（`void`）——**不返回**校验结论，因为产出方**无权**据此改变产出
 *   @degraded 校验器不可用 / 契约缺失 / 落账失败 ⇒ **静默降级为"只 log.warn"**，
 *             产出照常返回。区分：契约缺失（ENOENT = 正常默认）与解析失败（真错误）
 *             已在校验器内部各自点名；本层不再二次判定。
 *             本函数**永不抛出**（whole-body catch —— 与 `renderOnePager` 同款语义）。
 */
export function validateOutputContract(
  subject: Record<string, unknown>,
  opts: ValidateOptions = {},
): void {
  const contractId = 'one-pager';
  try {
    const described = describeValidation(contractId, subject, opts);
    if (described.ok) return;
    log.warn(
      {
        contractId,
        contractVersion: described.contractVersion,
        codes: described.codes,
        // 点名串 = "缺哪个字段"一行说清（台帐里另存结构化 codes/fieldPaths）
        fields: described.message,
      },
      '一页纸产出未过输出契约 — 已留痕（不阻断产出；失败记录进预设更新输入）',
    );
  } catch (err: unknown) {
    // 体检自身故障**绝不**升级为产出故障（whole-body 语义，铁律 11/24/31：不静默 + 不放大）
    log.warn({ err, contractId }, '产出契约自检异常 — 忽略（体检不阻断产出）');
  }
}
