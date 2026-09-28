/**
 * settings-applies.ts — live/restart 设置分类内核（D1053，线25 25-8/25-9）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md §4.1/§5/§6
 * 范式来源（借范式自研，**零 DSH 代码依赖、零 @deepseek-ai 依赖**——红线 F11）:
 *   现验命令（行号**不写死**，随快照漂移）：
 *     git -C /Users/wane/src/deepseek-harness-017 grep -n 'applies' packages/settings/settings/lib/index.js
 *     git -C /Users/wane/src/deepseek-harness-017 grep -n 'applies' packages/settings/settings/lib/types/types.d.ts
 *   现验事实（快照 0.1.7-rc.1 @ 46a7f68b）：`applies` 在 lib/index.js 内**硬编码 `"live"`**（无注册期声明、
 *   无 `restart` 取值）；类型面只有字面量 `applies: 'live'`。⇒ 本卡**不接入** DSH 的 live|restart 分类
 *   （该能力在锁定快照不存在），而是「借范式自研 + **以 DSH 恒 live 为反例边界**」——DSH 的恒 live 默认
 *   正是 25-9 要防的「半生效」盲区。分类声明唯一真相源 = 本文件的代码 registry（R5）。
 *
 * 契约（铁律 47）——函数契约表见 spec §4.1，逐函数 JSDoc 见下：
 *   - declareSettings(spec)     : 声明期校验 + 登记（重复且内容全等 = 幂等）
 *   - loadSettingsSpec(opts)    : 读源 + 校验声明 ⇒ SettingsSpecBundle；**不冻结**；**M4 单元级直调入口**
 *   - bootSettingsRuntime(opts) : 纯工厂，每次返回**全新独立** runtime（新 bootId），冻结 restart 类
 *   - initSettingsBootFence(opts): **生产接线入口**（src/server.ts 的 createServer() 显式调用）
 *   - getSettingsRuntime()      : 读取已初始化的生效边界（未初始化 ⇒ 隐式初始化 + 显式告警）
 *   - getEffectiveRow(path)     : 单键行读取
 *
 * 分层（裁决 R5×R4）: `loadSettingsSpec` 对声明非法 **fail-closed 抛** `SettingsSpecError`；
 *   `initSettingsBootFence` **永不抛**（捕获 ⇒ degraded + log.warn）；`get*` 读取路径**永不抛**。
 *   ⇒ 单元级负控 = 非 0 exit；进程级 = degraded 不崩死（配置面故障不成为启动故障面，铁律 24/31）。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@synova/logger';
import { deepEqualJson, type LayerDoc } from './config-layers';
import { loadSettingsSource, type SettingsSourceResult } from './settings-source';

const log = createLogger('config/settings-applies');

// ═══════════════════════════════════════════════════════════════════════════
// D1053 受控例外（R4）——进程级生效边界，理由与边界逐条如下：
//   ① 为什么必须有：restart 类键的"半生效"防线需要**一个**跨请求稳定的冻结快照；
//      没有稳定的进程级边界，两次请求就会拿到两个不同的"生效值"（= 半生效本身）。
//   ② 与 D599 决策点 3 的关系：D599 禁的是"客户配置写入进程级状态"（per-org 数据面泄漏）；
//      本例外承载的是**本实例的生效边界元数据**（bootId/冻结快照），不承载任何 per-org 客户数据，
//      也不被客户层写入（settings.yaml 只提供值，见 R5）。
//   ③ 不做隐式单例：初始化**必须**由 createServer() 显式调用 initSettingsBootFence()（src/server.ts:124）；
//      模块 import 副作用**不得**初始化（禁 `let x = boot()` 形态）。
//   ④ 可重置/可观测：bootId 可核（HTTP 响应）、初始化失败降级不 process.exit、隐式初始化必打
//      SETTINGS_BOOT_IMPLICIT 警告。测试用 bootSettingsRuntime() 造独立实例，不依赖本边界。
// ═══════════════════════════════════════════════════════════════════════════

/** 生效边界：live = 下一次读取即新值；restart = 本进程 boot 冻结，重启后取新值。 */
export type SettingsApplies = 'live' | 'restart';

/** 数字域（JSON Schema 关键词，声明期 fail-closed 校验用）。 */
export interface SettingsDomain {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  integer?: boolean;
}

/** 既存例外登记项（裁决②：E1 LLM 凭证热重载 / E2 文件驱动 reload 通道）。 */
export interface SettingsException {
  id: 'llm-credential-hot-reload' | 'file-driven-reload-channel';
  reason: string;
  anchors: string[];
  since: string;
}

/** 一条键声明。`consumer` 是"谁读它"的机器可核锚点（file:line，实测填入）。 */
export interface SettingsKeySpec {
  /** kebab-case 命名空间（^[a-z][a-z0-9-]*$，≤64 字符）。 */
  ns: string;
  /**
   * 命名空间内的键名：**允许点分多段**（`^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$`）；每段须非空
   * ⇒ 禁前导/尾随/连续 `.` 与空段。≤64 字符。与常量 `KEY_PATTERN` 逐字一致（D1053 规格 §5.3
   * 裁定允许点分多段：`ns` 正则不容 `.`，故 `path = ns + '.' + key` 唯一可还原；且 §5.1 插件类
   * `extensions.skill.enabled` 必须以该形态覆盖）。
   */
  key: string;
  applies: SettingsApplies;
  /** 文件两层均未定义时采用的默认值（必须与 domain 相容）。 */
  defaultValue: unknown;
  domain?: SettingsDomain;
  /** 消费者锚点（file:line，实测；缺省 = 声明不完整，声明期抛错）。 */
  consumer: string;
  /** 既存例外：仅 E1 登记项可携带（E2 为内容文件通道，不绑定 settings 键）。 */
  exception?: SettingsException;
}

/** 逐键生效行（两个 HTTP 面共用的唯一形状）。 */
export interface SettingsEffectiveRow {
  ns: string;
  key: string;
  /** 全路径 = `${ns}.${key}`。 */
  path: string;
  applies: SettingsApplies;
  declared: boolean;
  /** live = 本次读取的现值；restart = boot 冻结值。 */
  effective: unknown;
  /** restart 且磁盘现值 ≠ effective 时 = 磁盘现值；否则 null。 */
  pending: unknown | null;
  changedOnDisk: boolean;
  /** workspace | home | declaration（两层文件均无 + 未声明 ⇒ 'none'）。 */
  sourceLayer: 'workspace' | 'home' | 'declaration' | 'none';
  defaultValue: unknown;
  consumer: string;
  exceptionId?: string;
}

/** rows() 过滤条件。 */
export interface SettingsRowFilter {
  ns?: string;
  key?: string;
  includeUndeclared?: boolean;
  limit?: number;
}

/** 生效边界（runtime）：一个 bootId 对应一套冻结值。 */
export interface SettingsRuntime {
  bootId: string;
  bootedAt: string;
  /** 已存在的源文件绝对路径（不存在则 null）。 */
  sourceFiles: { workspace: string | null; home: string | null };
  undeclared: string[];
  exceptions: SettingsException[];
  degraded: boolean;
  reason?: string;
  code?: string;
  row(path: string): SettingsEffectiveRow | null;
  rows(filter?: SettingsRowFilter): SettingsEffectiveRow[];
}

/** loadSettingsSpec 的输出：已校验的声明 + 已读源 + 已叠加值（未冻结）。 */
export interface SettingsSpecBundle {
  declarations: SettingsKeySpec[];
  source: SettingsSourceResult;
  /** 两层叠加结果（**唯一**来自 resolveLayers，禁由 layerOfPath 重算）。 */
  resolved: LayerDoc;
  layerOfPath: (path: string) => 'workspace' | 'home' | 'none';
  undeclared: string[];
  /** 类型失配键 → 强制回落值（坏文件值**不得**冒充生效值；查询一律先看此表）。 */
  fallbacks: Map<string, unknown>;
  degraded: boolean;
  reason?: string;
  code?: string;
}

/**
 * 设置声明错误（铁律 32: .code + .phase + .retryable）。
 * 声明非法 / yaml 携带 `applies` / domain 越界 ⇒ fail-closed 抛出；输入不修正则重试无意义。
 */
class SettingsSpecError extends Error {
  readonly code = 'SETTINGS_SPEC_INVALID';
  readonly phase: string;
  readonly retryable = false;
  constructor(phase: string, message: string) {
    super(`settings-applies: ${message}`);
    this.name = 'SettingsSpecError';
    this.phase = phase;
  }
}

/** kebab-case 命名空间（与 config-layers.configNamespace 同型规则）。 */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
 * 键名：非空、各段非空即可。
 *
 * ⚠ 规格缺陷处置（D1053-C 登记，待 S 在活规格修正其一）：§5.1 分类表要求键路径
 * `extensions.skill.enabled`（ns=`extensions` ⇒ key 必为 `skill.enabled`，**含 '.'**），
 * 而 §5.3 边界表写「`key` 含 '.' → 抛」。二者**不可同时满足**。
 * 本实现取「保留 §5.1 对外可见的声明路径」（V/证据链按该表核对），故允许 key 为**点分多段**；
 * §5.3 该行担心的"与 path 混淆"由「ns 恒为点分首段且不含 '.'」保证——`path = ns + '.' + key`
 * 仍可无损反解（见 buildRow 的 ns/key 切分）。
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** 例外 E1（裁决②ⓐ）：LLM 凭证热重载 —— 既有已验 live 行为，与本卡「鉴权类=restart」正面冲突。 */
const EXCEPTION_LLM_CREDENTIAL: SettingsException = {
  id: 'llm-credential-hot-reload',
  reason:
    '鉴权类按决定④=restart，但既有实现每请求重读凭证文件、保存后下一请求即生效（已在测已验）；登记为既存例外、不动既有路径',
  anchors: ['src/config.ts:76', 'tests/routes/llm-config.test.ts:165'],
  since: 'D575',
};

/** 例外 E2（裁决②）：文件驱动 reload 通道 —— 扩展内容文件不经 settings.yaml 语义。 */
const EXCEPTION_FILE_DRIVEN_RELOAD: SettingsException = {
  id: 'file-driven-reload-channel',
  reason:
    'extensions/**/manifest.json 与 locale JSON 等内容文件仍走既有 POST /api/reload 通道；settings.yaml 内插件类键=restart，不制造第二套生效机制',
  anchors: ['src/routes/reload.ts:21'],
  since: '既有通道（未追溯卡号）',
};

/** 全部既存例外（HTTP `exceptions[]` 的来源；boot 时逐条打印）。 */
const REGISTERED_EXCEPTIONS: SettingsException[] = [EXCEPTION_LLM_CREDENTIAL, EXCEPTION_FILE_DRIVEN_RELOAD];

/**
 * 内置键声明表（spec §5.1 逐字落成代码；`consumer` = 实测 file:line，实现期不得改写）。
 * 7 类覆盖：live 3 类（展示/阈值/文案）+ restart 4 类（连接/插件/数据源/鉴权）。
 *
 * 模块私有（D1053-C 收敛）：唯一消费者是本文件底部的注册循环；无跨文件调用方 ⇒ 不导出（铁律 37）。
 */
const BUILTIN_SETTINGS_DECLARATIONS: readonly SettingsKeySpec[] = [
  { ns: 'display', key: 'reportTemplate', applies: 'live', defaultValue: 'default.hbs',
    consumer: 'src/l3/report-template-loader.ts:137' },
  { ns: 'diagnosis', key: 'gateDataCompleteness', applies: 'live', defaultValue: 0.3,
    domain: { minimum: 0, maximum: 1 }, consumer: 'src/l3/synova-diagnosis-engine-impl.ts:52' },
  { ns: 'sentinel', key: 'findingCountRatioWarning', applies: 'live', defaultValue: 2.0,
    domain: { exclusiveMinimum: 0 }, consumer: 'src/sentinel/baseline-store.ts:157' },
  { ns: 'wording', key: 'locale', applies: 'live', defaultValue: 'zh-CN',
    consumer: 'src/locale/locale-loader.ts:54' },
  { ns: 'llm', key: 'baseUrl', applies: 'restart', defaultValue: 'https://api.deepseek.com/v1',
    consumer: 'src/config.ts:91' },
  { ns: 'server', key: 'port', applies: 'restart', defaultValue: 18790,
    domain: { minimum: 1, maximum: 65535, integer: true }, consumer: 'src/server.ts:476' },
  { ns: 'extensions', key: 'skill.enabled', applies: 'restart', defaultValue: true,
    consumer: 'src/skill/skill-loader.ts:120' },
  { ns: 'store', key: 'dbPath', applies: 'restart', defaultValue: './data/synova.db',
    consumer: 'src/init/engine-context.ts:66' },
  { ns: 'llm', key: 'apiKey', applies: 'restart', defaultValue: '',
    consumer: 'src/config.ts:77', exception: EXCEPTION_LLM_CREDENTIAL },
];

/**
 * 受 manifest 约束的取值集合（spec §5.3：`wording.locale` 必须是 locales manifest 的成员）。
 * 独立于 `SettingsDomain`（不改动已定死的数据类型），按路径小表登记。
 */
const ENUM_SOURCES: ReadonlyArray<{ path: string; file: string; jsonPath: string }> = [
  { path: 'wording.locale', file: join('extensions', 'locales', 'manifest.json'), jsonPath: 'languages' },
];

/** 声明表（进程级**静态**注册表：纯数据、无 I/O、无 per-org 内容；与 R4 的 runtime 边界不同物）。 */
const DECLARED = new Map<string, SettingsKeySpec>();

/** 是否 plain data object（局部助手，非第二套叠加实现）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 全路径 = `${ns}.${key}`。 */
function pathOf(spec: SettingsKeySpec): string {
  return `${spec.ns}.${spec.key}`;
}

/** 读声明面文档中的路径值（中间段非 plain object 或缺键 ⇒ found:false）。 */
function valueAt(doc: LayerDoc, path: string): { found: boolean; value: unknown } {
  let node: unknown = doc;
  for (const segment of path.split('.')) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, segment)) {
      return { found: false, value: undefined };
    }
    node = node[segment];
  }
  return { found: true, value: node };
}

/** 收集设置面内全部叶子路径（非 plain object 值即叶子；数组视为叶子），字典序。 */
function leafPaths(doc: LayerDoc): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      if (isPlainObject(value)) walk(value, path);
      else out.push(path);
    }
  };
  walk(doc, '');
  return out.sort();
}

/** 类型同类性（与声明默认值比较；null/undefined 视为失配）。 */
function sameKind(value: unknown, reference: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === typeof reference;
}

/** 数字域校验（仅当 reference 为 number 时生效）。 */
function assertDomain(path: string, value: unknown, domain: SettingsDomain | undefined): void {
  if (domain === undefined || typeof value !== 'number') return;
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new SettingsSpecError('spec', `${path}: 值必须是有限数字，收到 ${String(value)}`);
  }
  if (domain.integer === true && !Number.isInteger(value)) {
    throw new SettingsSpecError('spec', `${path}: 值必须是整数，收到 ${String(value)}`);
  }
  if (domain.minimum !== undefined && value < domain.minimum) {
    throw new SettingsSpecError('spec', `${path}: 值 ${String(value)} 小于下界 ${String(domain.minimum)}`);
  }
  if (domain.maximum !== undefined && value > domain.maximum) {
    throw new SettingsSpecError('spec', `${path}: 值 ${String(value)} 大于上界 ${String(domain.maximum)}`);
  }
  if (domain.exclusiveMinimum !== undefined && value <= domain.exclusiveMinimum) {
    throw new SettingsSpecError('spec', `${path}: 值 ${String(value)} 未超过开下界 ${String(domain.exclusiveMinimum)}`);
  }
  if (domain.exclusiveMaximum !== undefined && value >= domain.exclusiveMaximum) {
    throw new SettingsSpecError('spec', `${path}: 值 ${String(value)} 未低于开上界 ${String(domain.exclusiveMaximum)}`);
  }
}

/** manifest 取值集合成员校验（§5.3 `wording.locale`）；manifest 不可读 ⇒ 返回 null（由调用方降级）。 */
function enumMembers(path: string): readonly string[] | null {
  const source = ENUM_SOURCES.find((entry) => entry.path === path);
  if (source === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), source.file), 'utf8'));
    const list = isPlainObject(parsed) ? parsed[source.jsonPath] : undefined;
    if (!Array.isArray(list)) return null;
    return list.filter((item): item is string => typeof item === 'string');
  } catch (error: unknown) {
    // manifest 缺失/坏 JSON ⇒ 该键的成员约束**不可判**：显式告警后放弃约束（不静默，铁律 24）
    const detail = error instanceof Error ? error.message : String(error);
    log.warn({ path, file: source.file, detail }, 'settings-applies: 取值集合 manifest 不可读 — 跳过成员校验（不静默）');
    return null;
  }
}

/**
 * 声明一条设置键（声明期校验，fail-closed）。
 *
 * 重复登记：同 path 且**内容全等** ⇒ 幂等静默返回；同 path 但内容不等 ⇒ 抛。
 *
 * 模块私有（D1053-C 收敛）：唯一消费者是本文件底部的 `BUILTIN_SETTINGS_DECLARATIONS` 注册循环，
 * 无跨文件调用方 ⇒ 不导出；声明面改动的**唯一入口**是代码 registry（R5）。
 * @param spec - 待登记的单条键声明。
 * @returns void；成功即进声明表。
 * @error SettingsSpecError（phase='declare'）：非法 ns/key、非法 applies、缺 consumer、
 *        defaultValue 与 domain 不相容、同 path 重复声明且内容不等。
 */
function declareSettings(spec: SettingsKeySpec): void {
  validateSpec(spec, 'declare');
  const path = pathOf(spec);
  const existing = DECLARED.get(path);
  if (existing === undefined) {
    DECLARED.set(path, spec);
    return;
  }
  if (JSON.stringify(existing) === JSON.stringify(spec)) return; // 幂等：内容全等
  throw new SettingsSpecError('declare', `${path}: 重复声明且内容不等（同 path 只允许一条声明）`);
}

/** 声明校验（phase 由调用方给：declareSettings='declare' / loadSettingsSpec='spec'）。 */
function validateSpec(spec: SettingsKeySpec, phase: string): void {
  if (typeof spec.ns !== 'string' || spec.ns === '' || !NAMESPACE_PATTERN.test(spec.ns) || spec.ns.length > 64) {
    throw new SettingsSpecError(phase, `命名空间非法（需 ^[a-z][a-z0-9-]*$ 且 ≤64）: ${JSON.stringify(spec.ns)}`);
  }
  if (typeof spec.key !== 'string' || spec.key === '' || !KEY_PATTERN.test(spec.key) || spec.key.length > 64) {
    throw new SettingsSpecError(
      phase,
      `键名非法（需点分多段 [A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*，禁前导/尾随/连续 '.' 与空段，≤64）: ${JSON.stringify(spec.key)}`,
    );
  }
  if (spec.applies !== 'live' && spec.applies !== 'restart') {
    throw new SettingsSpecError(
      phase,
      `${pathOf(spec)}: applies 必须是 'live' | 'restart'，收到 ${JSON.stringify(spec.applies)}（禁隐式默认；分类唯一真相源 = 本 registry）`,
    );
  }
  if (typeof spec.consumer !== 'string' || spec.consumer.trim() === '') {
    throw new SettingsSpecError(phase, `${pathOf(spec)}: 缺 consumer 锚点（声明不完整）`);
  }
  if (spec.defaultValue !== undefined) {
    const reference = spec.defaultValue;
    assertDomain(pathOf(spec), reference, spec.domain);
    const members = enumMembers(pathOf(spec));
    if (members !== null && typeof reference === 'string' && !members.includes(reference)) {
      throw new SettingsSpecError(phase, `${pathOf(spec)}: 默认值 ${reference} 不在允许集合 [${members.join(', ')}]`);
    }
  }
}

// 内置声明注册循环（生产调用方：declareSettings 的真实接线点）
for (const spec of BUILTIN_SETTINGS_DECLARATIONS) declareSettings(spec);

/**
 * 读源 + 校验声明（**不冻结**；冻结是 boot 的职责）。
 *
 * 这是 M4 负控的**单元级直调入口**：声明非法（applies 非法、ns/key 非法、domain 越界、
 * **yaml 出现 `applies` 字段**）⇒ fail-closed 抛 `SettingsSpecError`（非 0 exit）。
 * @param options - 可选已读源（缺省 = `loadSettingsSource()`）；可选 registry 覆盖（缺省 = 内置声明表）。
 * @returns `{ declarations, source, resolved, layerOfPath, undeclared, degraded, reason?, code? }`。
 * @degraded 源层解析失败 / 文件值类型失配 ⇒ bundle 携 `degraded:true`（**不因此抛**，铁律 24/31）。
 * @error SettingsSpecError（phase='spec'）：声明非法或 yaml 携带 `applies` ⇒ fail-closed。
 */
function loadSettingsSpec(
  options?: { source?: SettingsSourceResult; registry?: readonly SettingsKeySpec[] },
): SettingsSpecBundle {
  const source = options?.source ?? loadSettingsSource();
  const registry = options?.registry ?? [...DECLARED.values()];

  const declarations: SettingsKeySpec[] = [];
  const seen = new Set<string>();
  for (const raw of registry) {
    validateSpec(raw, 'spec');
    const path = pathOf(raw);
    if (seen.has(path)) {
      throw new SettingsSpecError('spec', `${path}: registry 内重复声明（同 path 只允许一条）`);
    }
    seen.add(path);
    declarations.push(raw);
  }

  // R5: yaml 只提供值 ⇒ 出现 `applies` 字段即拒载（fail-closed，显式指向 registry）
  const offending = yamlAppliesPaths(source.doc);
  if (offending.length > 0) {
    throw new SettingsSpecError(
      'spec',
      `settings.yaml 不得携带 applies（分类唯一真相源 = 代码 registry）——涉事路径: ${offending.join(', ')}`,
    );
  }

  const reasons: string[] = [];
  if (source.degraded) reasons.push(...source.errors);

  const declaredPaths = new Set(declarations.map(pathOf));
  const undeclared = leafPaths(source.doc).filter((path) => !declaredPaths.has(path));
  const fallbacks = new Map<string, unknown>();
  const resolvedDeclarations: SettingsKeySpec[] = [];
  for (const spec of declarations) {
    const path = pathOf(spec);
    const located = valueAt(source.doc, path);
    if (!located.found) {
      resolvedDeclarations.push(spec);
      continue;
    }
    if (!sameKind(located.value, spec.defaultValue)) {
      const reason = `SETTINGS_VALUE_TYPE_MISMATCH ${path}: 期望 ${typeof spec.defaultValue}，实得 ${typeof located.value}（回落 defaultValue）`;
      reasons.push(reason);
      fallbacks.set(path, spec.defaultValue);
      log.warn({ path, expected: typeof spec.defaultValue, actual: typeof located.value },
        'settings-applies: 文件值类型与声明不符 — 回落默认值（degraded）');
      resolvedDeclarations.push(spec);
      continue;
    }
    assertDomain(path, located.value, spec.domain);
    const members = enumMembers(path);
    if (members !== null && typeof located.value === 'string' && !members.includes(located.value)) {
      throw new SettingsSpecError('spec', `${path}: 值 ${located.value} 不在允许集合 [${members.join(', ')}]`);
    }
    resolvedDeclarations.push(spec);
  }

  const degraded = reasons.length > 0;
  const code = degraded ? codeFromReason(reasons[0]) : undefined;
  return {
    declarations: resolvedDeclarations,
    source,
    resolved: source.doc,
    layerOfPath: source.layerOfPath,
    undeclared,
    fallbacks,
    degraded,
    ...(degraded ? { reason: reasons.join(' | '), code } : {}),
  };
}

/** 收集设置面内出现 `applies` 键的路径（R5 拒载判据；含任意深度）。 */
function yamlAppliesPaths(doc: LayerDoc): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      if (key === 'applies') out.push(path);
      walk(value, path);
    }
  };
  walk(doc, '');
  return out;
}

/** 由原因串推首个错误码（保留源层码，便于 HTTP 面精确判别）。 */
function codeFromReason(reason: string | undefined): string {
  if (reason === undefined) return 'SETTINGS_SOURCE_UNPARSABLE';
  const matched = /^(SETTINGS_[A-Z_]+)/.exec(reason);
  return matched?.[1] ?? 'SETTINGS_SOURCE_UNPARSABLE';
}

/** boot 状态（runtime 内部结构；不导出）。 */
interface BootState {
  bootId: string;
  bootedAt: string;
  declarations: SettingsKeySpec[];
  bootSource: SettingsSourceResult;
  frozen: Map<string, unknown>;
  frozenLayer: Map<string, 'workspace' | 'home' | 'declaration' | 'none'>;
  frozenDefault: Map<string, unknown>;
  /** 类型失配键 → 强制回落值（来自 loadSettingsSpec；查询优先于任何文件值）。 */
  fallbacks: Map<string, unknown>;
  undeclared: string[];
  degraded: boolean;
  reason?: string;
  code?: string;
  /** 声明级失败（fail-closed 被捕获）：rows() 返回空 —— 涉事键不得以默认值充当正常行。 */
  specFailed: boolean;
}

/** 组装一条生效行。 */
function buildRow(state: BootState, path: string, fresh: SettingsSourceResult): SettingsEffectiveRow | null {
  const spec = state.declarations.find((entry) => pathOf(entry) === path);
  const isUndeclared = spec === undefined;
  if (isUndeclared && !state.undeclared.includes(path)) return null;

  const applies: SettingsApplies = isUndeclared ? 'restart' : spec.applies;
  const frozen = state.frozen.get(path);
  const forced = state.fallbacks.get(path);
  const declaredSpec = spec; // 窄化助手：以下 live/declared 分支必为已声明键
  if (applies === 'live' && declaredSpec !== undefined) {
    if (state.fallbacks.has(path)) {
      // 类型失配 ⇒ 生效值 = 声明默认值（坏文件值不冒充生效值）
      return {
        ns: path.slice(0, path.indexOf('.')),
        key: path.slice(path.indexOf('.') + 1),
        path,
        applies,
        declared: true,
        effective: forced,
        pending: null,
        changedOnDisk: false,
        sourceLayer: 'declaration',
        defaultValue: forced,
        consumer: declaredSpec.consumer,
        ...(declaredSpec.exception === undefined ? {} : { exceptionId: declaredSpec.exception.id }),
      };
    }
    const located = valueAt(fresh.doc, path);
    const layer = fresh.layerOfPath(path);
    return {
      ns: path.slice(0, path.indexOf('.')),
      key: path.slice(path.indexOf('.') + 1),
      path,
      applies,
      declared: true,
      effective: located.found ? located.value : frozen,
      pending: null,
      changedOnDisk: false,
      sourceLayer: layer === 'none' ? 'declaration' : layer,
      defaultValue: state.frozenDefault.get(path) ?? null, // DEV-1: live 行取声明默认值，非 boot 冻结值
      consumer: declaredSpec.consumer,
      ...(declaredSpec.exception === undefined ? {} : { exceptionId: declaredSpec.exception.id }),
    };
  }

  const located = valueAt(fresh.doc, path);
  const pending = !state.fallbacks.has(path) && located.found && !deepEqualJson(located.value, frozen)
    ? located.value
    : null;
  const nsEnd = path.indexOf('.');
  return {
    ns: path.slice(0, nsEnd),
    key: path.slice(nsEnd + 1),
    path,
    applies,
    declared: !isUndeclared,
    effective: frozen,
    pending,
    changedOnDisk: pending !== null,
    sourceLayer: state.frozenLayer.get(path) ?? 'none',
    defaultValue: state.frozenDefault.get(path) ?? null,
    consumer: spec?.consumer ?? '(undeclared)',
    ...(spec?.exception === undefined ? {} : { exceptionId: spec.exception.id }),
  };
}

/**
 * 建立一个**全新独立**的生效边界（纯工厂；每次调用返回新 `bootId`，不写任何进程级单例）。
 *
 * 冻结全部 restart 类（含未声明项）的 boot 值；并按 §六/dialog 触发条件打印三行启动日志：
 * 未声明清单 + 枚举范围边界 + 既存例外（三者皆不得静默）。
 * @param options - 可选已读源 / registry 覆盖 / `now` 注入缝。
 * @returns 全新 runtime（degraded 时仍可用：live 键照常、restart 键用冻结值或默认值）。
 * @degraded 源层解析失败/类型失配 ⇒ runtime `degraded:true` + `reason` + `code`。
 * @error SettingsSpecError：内部 `loadSettingsSpec()` 的 fail-closed 异常**向上抛**（供单元级负控）。
 */
function bootSettingsRuntime(
  options?: { source?: SettingsSourceResult; registry?: readonly SettingsKeySpec[]; now?: () => Date },
): SettingsRuntime {
  const bundle = loadSettingsSpec(options);
  const now = options?.now ?? (() => new Date());

  const frozen = new Map<string, unknown>();
  const frozenLayer = new Map<string, 'workspace' | 'home' | 'declaration' | 'none'>();
  const frozenDefault = new Map<string, unknown>();
  for (const spec of bundle.declarations) {
    const path = pathOf(spec);
    // DEV-1: frozenDefault 对**所有**声明键填充（defaultValue 是声明属性，与 applies 无关）
    frozenDefault.set(path, spec.defaultValue);
    if (spec.applies !== 'restart') continue;
    if (bundle.fallbacks.has(path)) {
      // 类型失配 ⇒ 回落声明默认值，不把坏文件值冻结为生效值
      frozen.set(path, bundle.fallbacks.get(path));
      frozenLayer.set(path, 'declaration');
      continue;
    }
    const located = valueAt(bundle.resolved, path);
    const layer = located.found ? bundle.layerOfPath(path) : 'declaration';
    frozen.set(path, located.found ? located.value : spec.defaultValue);
    frozenLayer.set(path, layer === 'none' ? 'declaration' : layer);
  }
  for (const path of bundle.undeclared) {
    const located = valueAt(bundle.resolved, path);
    frozen.set(path, located.value);
    frozenLayer.set(path, bundle.layerOfPath(path));
  }

  const state: BootState = {
    bootId: randomUUID(),
    bootedAt: now().toISOString(),
    declarations: bundle.declarations,
    bootSource: bundle.source,
    frozen,
    frozenLayer,
    frozenDefault,
    fallbacks: bundle.fallbacks,
    undeclared: bundle.undeclared,
    degraded: bundle.degraded,
    ...(bundle.degraded ? { reason: bundle.reason, code: bundle.code } : {}),
    specFailed: false,
  };

  logBootLines(state, bundle.source);
  return runtimeOf(state);
}

/** 打印启动清单（§六 ④ 触发条件：面为空 ⇒ 只打例外行；面非空 ⇒ 三行全打）。 */
function logBootLines(state: BootState, source: SettingsSourceResult): void {
  const faceEmpty = source.files.workspace === null && source.files.home === null;
  const count = state.undeclared.length;
  if (!faceEmpty) {
    log.warn({ count, undeclared: state.undeclared },
      'SETTINGS_UNUSED_UNDECLARED 未声明分类项（默认安全 = 强制 restart）');
    log.warn({ scope: 'settings.yaml' },
      'SETTINGS_UNDECLARED_SCOPE 枚举范围 = settings.yaml 内未声明键；既有 env 键不在本卡枚举范围（D1053 §3.3 / R8）');
  }
  log.warn({ count: REGISTERED_EXCEPTIONS.length, exceptions: REGISTERED_EXCEPTIONS.map((entry) => entry.id) },
    'SETTINGS_EXCEPTION_ACTIVE 既存例外（不按声明面自动生效，见 D1053 §6）');
  void state;
}

/** 由 BootState 构造对外的 SettingsRuntime（读取路径一律不抛）。 */
function runtimeOf(state: BootState): SettingsRuntime {
  const readFresh = (): SettingsSourceResult => {
    try {
      return loadSettingsSource();
    } catch {
      // loadSettingsSource 契约内不抛；此路兜底为「空源」，读取路径不成为故障面（铁律 31）
      return {
        doc: {}, files: { workspace: null, home: null },
        layerOfPath: () => 'none', degraded: true, reason: 'SETTINGS_SOURCE_READ_FAILED', code: 'SETTINGS_SOURCE_IO', errors: [],
      };
    }
  };
  return {
    bootId: state.bootId,
    bootedAt: state.bootedAt,
    sourceFiles: { workspace: state.bootSource.files.workspace, home: state.bootSource.files.home },
    undeclared: [...state.undeclared],
    exceptions: REGISTERED_EXCEPTIONS,
    degraded: state.degraded,
    ...(state.degraded ? { reason: state.reason, code: state.code } : {}),
    row(path: string): SettingsEffectiveRow | null {
      if (state.specFailed) return null;
      return buildRow(state, path, readFresh());
    },
    rows(filter?: SettingsRowFilter): SettingsEffectiveRow[] {
      if (state.specFailed) return [];
      const fresh = readFresh();
      const includeUndeclared = filter?.includeUndeclared !== false;
      const paths = [
        ...state.declarations.map(pathOf),
        ...(includeUndeclared ? state.undeclared : []),
      ];
      const filtered = paths.filter((path) => {
        if (filter?.ns !== undefined && !path.startsWith(`${filter.ns}.`)) return false;
        if (filter?.key !== undefined && !path.endsWith(`.${filter.key}`)) return false;
        return true;
      });
      const limit = filter?.limit ?? 100;
      return filtered
        .slice(0, limit)
        .map((path) => buildRow(state, path, fresh))
        .filter((entry): entry is SettingsEffectiveRow => entry !== null);
    },
  };
}

/** 进程级生效边界（**唯一**受控例外，见文件头 R4 注释）。 */
let bootFence: SettingsRuntime | null = null;

/**
 * 初始化（或返回）本 server 实例的生效边界 —— **生产接线入口**，由 `src/server.ts` 的
 * `createServer()`（`src/server.ts:124`）显式调用。
 *
 * 幂等：已初始化且未要求重建 ⇒ 返回同一实例（`bootId` 不变）。`force:true` 用于显式重建
 * 生效边界（重新加载分类面 ⇒ 新 `bootId`；测试以生产入口模拟"重启"）。
 * @param options - 可选已读源 / registry 覆盖 / `now` 注入缝 / `force` 重建开关。
 * @returns 生效边界 runtime。
 * @degraded **失败不 process.exit**：规格异常被捕获 ⇒ `log.warn` + runtime `degraded:true`
 *           （`code` 保留底层错误码，`reason` 含 `SETTINGS_BOOT_FAILED` 供启动失败可观测）。
 * @error 不向调用方抛（配置面故障不成为启动故障面，铁律 24/31）。
 */
export function initSettingsBootFence(
  options?: { source?: SettingsSourceResult; registry?: readonly SettingsKeySpec[]; now?: () => Date; force?: boolean },
): SettingsRuntime {
  if (bootFence !== null && options?.force !== true) return bootFence;
  try {
    bootFence = bootSettingsRuntime(options);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = error instanceof SettingsSpecError ? error.code : 'SETTINGS_BOOT_FAILED';
    log.warn({ err: error, code }, 'SETTINGS_BOOT_FAILED 生效边界初始化失败 — degraded，服务照常起（铁律 24/31）');
    bootFence = degradedRuntime(detail, code);
  }
  return bootFence;
}

/** 构造一个"初始化失败"的降级 runtime（可观测、不崩死；rows() 为空）。 */
function degradedRuntime(detail: string, code: string): SettingsRuntime {
  return {
    bootId: randomUUID(),
    bootedAt: new Date().toISOString(),
    sourceFiles: { workspace: null, home: null },
    undeclared: [],
    exceptions: REGISTERED_EXCEPTIONS,
    degraded: true,
    reason: `SETTINGS_BOOT_FAILED ${detail}`,
    code,
    row: () => null,
    rows: () => [],
  };
}

/**
 * 读取已初始化的生效边界（消费方唯一入口：两个 HTTP 面都经此取同一 runtime ⇒ 天然同值）。
 *
 * 未初始化（非生产装配路径，如直接消费本模块）⇒ **隐式初始化一次**并显式告警 + 标 degraded，
 * 不隐藏该异常路径（可观测优先于静默）。
 * @returns 生效边界 runtime。
 * @degraded 隐式初始化路径 ⇒ `degraded:true` + `code:'SETTINGS_BOOT_IMPLICIT'`。
 * @error 不抛（隐式路径的声明异常同样转为 degraded）。
 */
export function getSettingsRuntime(): SettingsRuntime {
  if (bootFence !== null) return bootFence;
  log.warn({}, 'SETTINGS_BOOT_IMPLICIT 生效边界未经 createServer() 显式初始化 — 隐式初始化（degraded）');
  let runtime: SettingsRuntime;
  try {
    runtime = bootSettingsRuntime();
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = error instanceof SettingsSpecError ? error.code : 'SETTINGS_BOOT_FAILED';
    runtime = degradedRuntime(detail, code);
  }
  bootFence = { ...runtime, degraded: true, code: 'SETTINGS_BOOT_IMPLICIT', reason: runtime.reason };
  return bootFence;
}

/**
 * 读取单键生效行。
 * @param path - 全路径 `ns.key`。
 * @returns 生效行；未声明但存在于源 ⇒ `applies:'restart'` + `declared:false`；既未声明也不存在 ⇒ `null`。
 * @degraded 透传底层 runtime 的 degraded（行本身仍返回，不抛）。
 * @error 无（读取路径不抛）。
 */
export function getEffectiveRow(path: string): SettingsEffectiveRow | null {
  return getSettingsRuntime().row(path);
}
