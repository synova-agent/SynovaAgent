/**
 * tests/contract/conformance/registry.ts — Q-9 conformance 登记表 ＋ 源码枚举 ＋ 两清单加载
 *
 * 设计哲学：登记表是唯一真源 —— 源码里能 `implements StorageBackend` 的类必须登记，
 * 清单里写的违约必须可核；**看不见（枚举 0／文件缺失／解析失败）一律当失败（`degraded:`），不当通过**。
 *
 * 契约真源：`.handbook/派单件/2026-10-24-规格-913-PR1-契约套件.md` §1 件 2／§2（裁 331）
 * 上游裁：两条 sqlite 违约（updatedAt-iso／keyPrefix-literal）标红不阻断、只减不增；枚举集合 ≡ 登记表。
 *
 * Source map：
 *   CONFORMANCE_REGISTRY        → interface／definedAt／implementations／suites／planned(DataConnector)
 *   enumerateStorageBackendImplementations(scanRoot?) → 源码枚举 `class X implements … StorageBackend`
 *   loadKnownDivergences()      → known-divergences.yaml（KNOWN_VIOLATION 登记；主测试消费）
 *   loadKnownRed()              → known-red.yaml（既有红登记；PR-3 ①g 消费，本批只落文件）
 *
 * @input  可选 scanRoot（默认 CONFORMANCE_REGISTRY.interface.scanRoot=`src`；
 *         可被 env `CONFORMANCE_SCAN_ROOT` 覆盖 —— E6 判别力演示：指向空目录 ⇒ 枚举 0 ⇒ 必红）
 * @output StorageBackendSourceHit[]／KnownDivergencesLedger／KnownRedLedger
 * @degraded 文件缺失、YAML 解析失败、schema_version 非 1、必填字段缺失、枚举为 0
 *           ⇒ 抛 RegistryError，message 以 `degraded: ` 开头并点名路径/字段（不静默 pass）
 * @exit   本模块不退出。三态由调用方承接：绿=0｜断言红=1｜检查自身失败（degraded）=红（不得当通过）
 *
 * 已知限制（Known Limitations）：
 *   - 枚举用**源码文本匹配**（行级正则）⇒ 动态/反射/工厂生成的实现会漏（与 G1 `T1` 同型盲区）；
 *     `planned` 项与 barrel 再导出需人工核对。
 *   - 只扫 `.ts`（不含 `.tsx`/`.d.ts`），只认「同一行 class 声明 + implements … StorageBackend」；
 *     跨行声明（`class X\n  implements Y`）会漏。
 *   - `definedAt` 是 `path:line` 快照；源码行号漂移会让 meta 红（有意的漂移告警，不自动跟随）。
 *   - 两清单只做**结构**校验，不判 expiry 是否过期（过期判据属 PR-3 ①g 消费侧）。
 *   - known-divergences 的 `evidence` 是自由文本，不做机器核验（人工复核项）。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { load as parseYaml } from 'js-yaml';

// ═══ Typed error（code 可判；fail loud） ═══

export type RegistryErrorCode =
  | 'REGISTRY_ENUMERATION_UNREADABLE'
  | 'REGISTRY_ENUMERATION_EMPTY'
  | 'REGISTRY_LEDGER_MISSING'
  | 'REGISTRY_LEDGER_PARSE_FAILED'
  | 'REGISTRY_LEDGER_SCHEMA_INVALID';

/** 登记表/枚举层错误：message 一律以 `degraded: ` 开头（三态：检查自身失败不得当通过） */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly phase: 'enumerate' | 'ledger';
  readonly retryable = false;

  /**
   * @param message - 必须以 `degraded: ` 开头，点名路径/字段
   * @param code - 机器可判错误码
   * @param phase - 出错阶段（枚举 / 清单加载）
   */
  constructor(message: string, code: RegistryErrorCode, phase: 'enumerate' | 'ledger') {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.phase = phase;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

// ═══ 登记表（唯一真源；meta.test.ts 逐项做结构校验） ═══

export interface StorageBackendImplementationRef {
  /** 类名（必须能在源码枚举里命中） */
  readonly name: string;
  /** 定义文件（workspace 相对路径；必须存在） */
  readonly file: string;
}

export interface ConformanceSuiteRef {
  readonly id: string;
  /** 被约束的接口名（必须等于 CONFORMANCE_REGISTRY.interface.name） */
  readonly interface: string;
  readonly contractFile: string;
  readonly testFile: string;
  /** 契约用例条数（必须等于 CONTRACT_CASE_IDS.length —— meta 核） */
  readonly caseCount: number;
}

export interface PlannedConformanceRef {
  readonly interface: string;
  readonly definedAt: { readonly file: string; readonly line: number };
  readonly note: string;
}

export interface ConformanceRegistry {
  readonly schemaVersion: number;
  readonly interface: {
    readonly name: string;
    /** 接口声明位置快照（path:line；meta 核该行确实声明 interface） */
    readonly definedAt: { readonly file: string; readonly line: number };
    /** 源码枚举默认扫描根（workspace 相对路径） */
    readonly scanRoot: string;
  };
  readonly implementations: readonly StorageBackendImplementationRef[];
  readonly suites: readonly ConformanceSuiteRef[];
  readonly planned: readonly PlannedConformanceRef[];
}

export const CONFORMANCE_REGISTRY: ConformanceRegistry = {
  schemaVersion: 1,
  interface: {
    name: 'StorageBackend',
    definedAt: { file: 'src/store/storage-backend.ts', line: 46 },
    scanRoot: 'src',
  },
  implementations: [
    { name: 'MemoryStorageBackend', file: 'src/store/storage-backend.ts' },
    { name: 'SqliteStorageBackend', file: 'src/store/storage-backend.ts' },
  ],
  suites: [
    {
      id: 'storage-backend',
      interface: 'StorageBackend',
      contractFile: 'tests/contract/conformance/storage-backend.contract.ts',
      testFile: 'tests/contract/storage-backend.conformance.test.ts',
      caseCount: 9,
    },
  ],
  planned: [
    {
      interface: 'DataConnector',
      definedAt: { file: 'src/connectors/types.ts', line: 61 },
      note: '连接器契约套件不在本批（PR-1 只做 StorageBackend）；PR-2/Q-10 另立，禁在本批空转',
    },
  ],
};

// ═══ 源码枚举：`class X implements [ …,] StorageBackend` ═══

export interface StorageBackendSourceHit {
  readonly className: string;
  /** workspace 相对路径（POSIX 分隔符） */
  readonly file: string;
  /** 1-based 行号 */
  readonly line: number;
}

const CLASS_IMPLEMENTS_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\s+implements\s+[^{]*\bStorageBackend\b/;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** 解析实际扫描根：显式参数 > env CONFORMANCE_SCAN_ROOT > 登记表默认（供 E6 判别力演示） */
export function resolveScanRoot(scanRoot?: string): string {
  const raw = scanRoot ?? process.env.CONFORMANCE_SCAN_ROOT ?? CONFORMANCE_REGISTRY.interface.scanRoot;
  return path.resolve(process.cwd(), raw);
}

function walkTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(abs));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(abs);
    }
  }
  return files.sort();
}

/**
 * 枚举源码中所有 `implements StorageBackend` 的类。
 *
 * @param scanRoot - 扫描根（相对 cwd）；缺省读 env `CONFORMANCE_SCAN_ROOT`，再缺省读登记表
 * @returns 命中列表（按文件/行排序）
 * @throws RegistryError —— 扫描根不可读／0 个 .ts／0 个实现（`degraded:` 前缀；禁把看不见当通过）
 */
export function enumerateStorageBackendImplementations(scanRoot?: string): StorageBackendSourceHit[] {
  const root = resolveScanRoot(scanRoot);
  let files: string[];
  try {
    files = walkTypeScriptFiles(root);
  } catch (err) {
    throw new RegistryError(
      `degraded: 枚举扫描根不可读: ${root}（${describeError(err)}）`,
      'REGISTRY_ENUMERATION_UNREADABLE',
      'enumerate',
    );
  }

  if (files.length === 0) {
    throw new RegistryError(
      `degraded: 枚举扫描根内 0 个 .ts 文件: ${root} —— 禁把看不见当通过`,
      'REGISTRY_ENUMERATION_EMPTY',
      'enumerate',
    );
  }

  const hits: StorageBackendSourceHit[] = [];
  for (const abs of files) {
    const rel = path.relative(process.cwd(), abs).split(path.sep).join('/');
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (err) {
      throw new RegistryError(
        `degraded: 枚举时源文件不可读: ${rel}（${describeError(err)}）`,
        'REGISTRY_ENUMERATION_UNREADABLE',
        'enumerate',
      );
    }
    text.split(/\r?\n/).forEach((lineText, index) => {
      const match = CLASS_IMPLEMENTS_RE.exec(lineText);
      if (match !== null) {
        hits.push({ className: match[1], file: rel, line: index + 1 });
      }
    });
  }

  if (hits.length === 0) {
    throw new RegistryError(
      `degraded: 源码枚举 0 个 \`implements StorageBackend\`（扫描 ${files.length} 个 .ts，根: ${root}）—— 禁把看不见当通过`,
      'REGISTRY_ENUMERATION_EMPTY',
      'enumerate',
    );
  }

  return hits;
}

// ═══ 两清单加载（known-divergences／known-red） ═══

export const KNOWN_DIVERGENCES_PATH = 'tests/contract/known-divergences.yaml';
export const KNOWN_RED_PATH = 'tests/contract/known-red.yaml';

/** known-divergences 单条：已登记的 KNOWN_VIOLATION（裁 331：只减不增） */
export interface KnownDivergenceEntry {
  /** 登记身份名（规格 §1/§3.2 用名，如 keyPrefix-literal） */
  readonly id: string;
  /**
   * 对应契约用例 id（必须 ∈ CONTRACT_CASE_IDS）。
   * 规格存在"登记名 ≠ 用例名"双轨（keyPrefix-literal ↔ query-prefix）⇒ 清单可用 `case:` 显式映射；
   * 省略时默认等于 id。
   */
  readonly case: string;
  /** 违约实现类名（必须 ∈ 登记表 implementations） */
  readonly implementation: string;
  readonly owner: string;
  /** YYYY-MM-DD；上游未修前一直标红 */
  readonly expiry: string;
  readonly ruling: string;
  /** 现场证据（自由文本；人工复核项） */
  readonly evidence: string;
}

export interface KnownDivergencesLedger {
  readonly schema_version: number;
  readonly meta: { readonly as_of: string; readonly ruling: string; readonly interface: string };
  readonly divergences: readonly KnownDivergenceEntry[];
}

/** known-red 单条：既有红测试（PR-3 ①g 消费；本批只落文件） */
export interface KnownRedEntry {
  /** 测试文件路径（必须存在） */
  readonly test: string;
  readonly reason: string;
  readonly owner: string;
  readonly expiry: string;
  readonly ruling: string;
}

export interface KnownRedLedger {
  readonly schema_version: number;
  readonly meta: { readonly as_of: string; readonly ruling: string; readonly policy: string };
  readonly entries: readonly KnownRedEntry[];
}

function requireRecord(value: unknown, what: string, ledgerName: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RegistryError(
      `degraded: ${ledgerName} 的 ${what} 必须是映射（实际: ${typeof value}）`,
      'REGISTRY_LEDGER_SCHEMA_INVALID',
      'ledger',
    );
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, what: string, ledgerName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new RegistryError(
      `degraded: ${ledgerName} 的 ${what} 必须是数组（实际: ${typeof value}）`,
      'REGISTRY_LEDGER_SCHEMA_INVALID',
      'ledger',
    );
  }
  return value;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  what: string,
  ledgerName: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RegistryError(
      `degraded: ${ledgerName} 的 ${what}.${field} 缺失或不是非空字符串`,
      'REGISTRY_LEDGER_SCHEMA_INVALID',
      'ledger',
    );
  }
  return value;
}

function readLedgerDoc(filePath: string, ledgerName: string): Record<string, unknown> {
  const abs = path.resolve(process.cwd(), filePath);
  if (!existsSync(abs)) {
    throw new RegistryError(
      `degraded: ${ledgerName} 缺失: ${filePath}`,
      'REGISTRY_LEDGER_MISSING',
      'ledger',
    );
  }
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new RegistryError(
      `degraded: ${ledgerName} 不可读: ${filePath}（${describeError(err)}）`,
      'REGISTRY_LEDGER_MISSING',
      'ledger',
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new RegistryError(
      `degraded: ${ledgerName} 解析失败: ${filePath}（${describeError(err)}）`,
      'REGISTRY_LEDGER_PARSE_FAILED',
      'ledger',
    );
  }
  const doc = requireRecord(parsed, '顶层', ledgerName);
  if (doc.schema_version !== 1) {
    throw new RegistryError(
      `degraded: ${ledgerName} schema_version 必须为 1（实际: ${JSON.stringify(doc.schema_version)}）: ${filePath}`,
      'REGISTRY_LEDGER_SCHEMA_INVALID',
      'ledger',
    );
  }
  return doc;
}

/**
 * 加载 known-divergences.yaml（KNOWN_VIOLATION 登记表）。
 *
 * @param filePath - 清单路径（默认 tests/contract/known-divergences.yaml；meta 三态测试可传临时坏文件）
 * @returns 已做 schema_version／meta／条目必填字段校验的清单
 * @throws RegistryError —— 缺失/解析失败/结构非法（`degraded:` 前缀并点名文件与字段）
 */
export function loadKnownDivergences(filePath: string = KNOWN_DIVERGENCES_PATH): KnownDivergencesLedger {
  const ledgerName = 'known-divergences.yaml';
  const doc = readLedgerDoc(filePath, ledgerName);
  const meta = requireRecord(doc.meta, 'meta', ledgerName);
  const asOf = requireString(meta, 'as_of', 'meta', ledgerName);
  const ruling = requireString(meta, 'ruling', 'meta', ledgerName);
  const iface = requireString(meta, 'interface', 'meta', ledgerName);
  const rawEntries = requireArray(doc.divergences, 'divergences', ledgerName);
  const divergences = rawEntries.map((item, index): KnownDivergenceEntry => {
    const what = `divergences[${index}]`;
    const entry = requireRecord(item, what, ledgerName);
    const id = requireString(entry, 'id', what, ledgerName);
    let caseId = id;
    if (entry.case !== undefined) {
      if (typeof entry.case !== 'string' || entry.case.trim().length === 0) {
        throw new RegistryError(
          `degraded: ${ledgerName} 的 ${what}.case 必须是非空字符串（省略时默认等于 id）`,
          'REGISTRY_LEDGER_SCHEMA_INVALID',
          'ledger',
        );
      }
      caseId = entry.case;
    }
    return {
      id,
      case: caseId,
      implementation: requireString(entry, 'implementation', what, ledgerName),
      owner: requireString(entry, 'owner', what, ledgerName),
      expiry: requireString(entry, 'expiry', what, ledgerName),
      ruling: requireString(entry, 'ruling', what, ledgerName),
      evidence: requireString(entry, 'evidence', what, ledgerName),
    };
  });
  return { schema_version: 1, meta: { as_of: asOf, ruling, interface: iface }, divergences };
}

/**
 * 加载 known-red.yaml（既有红测试登记表；本批只落文件，不被消费）。
 *
 * @param filePath - 清单路径（默认 tests/contract/known-red.yaml；meta 三态测试可传临时坏文件）
 * @returns 已做 schema_version／meta／条目必填字段校验的清单
 * @throws RegistryError —— 缺失/解析失败/结构非法（`degraded:` 前缀并点名文件与字段）
 */
export function loadKnownRed(filePath: string = KNOWN_RED_PATH): KnownRedLedger {
  const ledgerName = 'known-red.yaml';
  const doc = readLedgerDoc(filePath, ledgerName);
  const meta = requireRecord(doc.meta, 'meta', ledgerName);
  const asOf = requireString(meta, 'as_of', 'meta', ledgerName);
  const ruling = requireString(meta, 'ruling', 'meta', ledgerName);
  const policy = requireString(meta, 'policy', 'meta', ledgerName);
  const rawEntries = requireArray(doc.entries, 'entries', ledgerName);
  const entries = rawEntries.map((item, index): KnownRedEntry => {
    const what = `entries[${index}]`;
    const entry = requireRecord(item, what, ledgerName);
    return {
      test: requireString(entry, 'test', what, ledgerName),
      reason: requireString(entry, 'reason', what, ledgerName),
      owner: requireString(entry, 'owner', what, ledgerName),
      expiry: requireString(entry, 'expiry', what, ledgerName),
      ruling: requireString(entry, 'ruling', what, ledgerName),
    };
  });
  return { schema_version: 1, meta: { as_of: asOf, ruling, policy }, entries };
}
