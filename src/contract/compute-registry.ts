/**
 * src/contract/compute-registry.ts — compute 契约注册表（#1048 / 施工单 2-6 · 承重件 W4）
 *
 * 缺什么：compute 契约注册表不存在 —— 「契约 ID → 实现文件」没有解析器。
 * 本件：最小件。只覆盖 3 条真契约，不做全量铺开（全量口径另立卡）。
 *
 * 与 D215 `contract-store.ts` / `contract-gate.ts` 的分工（刻意并存、不合并）：
 *   - D215 = **符号契约**存档（ContractRecord: export_function / edge_id / file_path …），
 *     来源是 `.codex/contracts/*.json`，语义是「被抽取出来的代码符号声明」。
 *   - 本件 = **compute 契约**注册表（COMPUTE-*-vN → 实现文件 + 导出符号），
 *     来源是**仓内代码事实**（实现文件 JSDoc 里的 `契约ID:` + 全局注册表声明）。
 *
 * 契约:
 *   @input    — 契约 ID（string，形如 `COMPUTE-XXX-vN`）；可选 repoRoot（默认 process.cwd()）
 *   @output   — ComputeContractEntry（实现文件相对路径 / 导出符号 / 探针 fixture / 声明方清单）
 *   @degraded — **无降级分支**。ID 未注册 / 实现文件缺失 / 导出符号缺失 / 动态加载失败 /
 *               调用结果形状不符 ⇒ 抛 `ComputeContractError`（fail-closed）。
 *               ⚠️ 这与 铁律 11「显式降级」并不冲突：本件的正确语义是**缺失即红**——
 *               契约注册表的用途是让"不生效"可见，给它一条 `degraded: true` 的静默通过路径
 *               就等于把 W4 变回"注册表在但没人保证生效"的原状。调用方若需降级，
 *               必须在自己的 catch 里显式选择并记录（见 §调用方义务）。
 *
 * 调用方义务（@consumer）:
 *   捕获 `ComputeContractError` 后，调用方**必须**自行决定是阻断还是记 `degraded: true`
 *   并上报；本模块不替调用方吞掉错误。
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, relative } from 'path';
import { pathToFileURL } from 'url';
import { createLogger } from '@synova/logger';

const log = createLogger('contract/compute-registry');

// ═══ 错误分类（铁律 32: .code + .phase + .retryable） ═══

/**
 * 解析链相位。以常量数组派生（组 8 文件驱动门禁禁止在 src/ 新增字面量联合类型 ——
 * 同族的本体类型必须文件驱动；相位是错误分类的形状，非本体类型，故用派生式声明）。
 */
const COMPUTE_CONTRACT_PHASES = ['resolve', 'file', 'symbol', 'load', 'invoke'] as const;

export type ComputeContractPhase = (typeof COMPUTE_CONTRACT_PHASES)[number];

export class ComputeContractError extends Error {
  readonly code: string;
  readonly phase: ComputeContractPhase;
  readonly retryable: boolean;
  readonly contractId: string;

  constructor(phase: ComputeContractPhase, contractId: string, detail: string, retryable = false) {
    super(`[compute-contract:${phase}] ${contractId} — ${detail}`);
    this.name = 'ComputeContractError';
    this.code = `COMPUTE_CONTRACT_${phase.toUpperCase()}_FAILED`;
    this.phase = phase;
    this.contractId = contractId;
    this.retryable = retryable;
  }
}

// ═══ 注册表条目 ═══

export interface ComputeContractEntry {
  /** 契约 ID（卡面判据指名 `COMPUTE-HHI-v1`） */
  contractId: string;
  /** 实现文件（仓库相对路径，POSIX 分隔符） */
  file: string;
  /** 实现文件导出的函数名 */
  exportName: string;
  /** 探针调用用 fixture（按实现函数签名顺序） */
  fixture: readonly unknown[];
  /** 调用结果必须包含的字段（探针断言；空数组 = 只断言非 null 对象） */
  expectedKeys: readonly string[];
  /** 声明方（file:line 口径的人工锚；由 probe 复核存在性） */
  declaredBy: readonly string[];
}

/**
 * 最小覆盖面 = 3 条真契约（卡面「先覆盖 3 条真被调用的契约」）。
 * 选取口径（证据见 docs/synova/product-lines/evidence/D1048-contract-registry-20261008.md）：
 *   ① 实现文件在仓内存在且含 `契约ID: <ID>` JSDoc 行；
 *   ② 该 ID 在 sentinel manifest 的 `compute` 字段被声明（非纯文档引用）；
 *   ③ 该 ID 在 `scripts/workflow/system-registry.json` 的 computes 段被声明。
 */
export const COMPUTE_CONTRACTS: readonly ComputeContractEntry[] = [
  {
    contractId: 'COMPUTE-HHI-v1',
    file: 'extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts',
    exportName: 'computeHHI',
    fixture: [[0.4, 0.3, 0.2, 0.1]],
    expectedKeys: ['hhi', 'firmCount', 'top3Share', 'economicInterpretation', 'degraded', 'warnings'],
    declaredBy: [
      'extensions/sentinels/competitive-position/manifest.json:55',
      'scripts/workflow/system-registry.json:104',
    ],
  },
  {
    contractId: 'COMPUTE-DOL-v1',
    file: 'extensions/sentinels/shared/computes/l2-value/compute-dol.ts',
    exportName: 'computeDOL',
    fixture: [1000, 400, 400],
    expectedKeys: ['dol', 'contributionMargin', 'ebit', 'fixedCostRatio', 'economicInterpretation', 'degraded', 'warnings'],
    declaredBy: [
      'extensions/sentinels/capital-health/manifest.json:68',
      'scripts/workflow/system-registry.json:102',
    ],
  },
  {
    contractId: 'COMPUTE-NPV-v1',
    file: 'extensions/sentinels/shared/computes/l2-internal/compute-npv.ts',
    exportName: 'computeNPV',
    fixture: [500, [150, 200, 250], 0.1],
    expectedKeys: ['npv', 'irr', 'paybackPeriod', 'economicInterpretation', 'degraded', 'warnings'],
    declaredBy: [
      'extensions/sentinels/capital-health/manifest.json:73',
      'scripts/workflow/system-registry.json:115',
    ],
  },
];

/** 卡面判据指名的契约（探针按此断言"必须已注册"，缺一即红）。 */
export const REQUIRED_COMPUTE_CONTRACT_IDS: readonly string[] = ['COMPUTE-HHI-v1'];

// ═══ 解析与校验 ═══

function resolveRepoRoot(repoRoot?: string): string {
  return repoRoot && repoRoot.length > 0 ? repoRoot : process.cwd();
}

function toRepoRelative(absOrRel: string, repoRoot: string): string {
  return isAbsolute(absOrRel) ? relative(repoRoot, absOrRel).split('\\').join('/') : absOrRel;
}

/**
 * 解析契约 ID → 注册表条目。
 * @throws ComputeContractError(phase='resolve') ID 未注册
 */
export function resolveComputeContract(contractId: string): ComputeContractEntry {
  const entry = COMPUTE_CONTRACTS.find((c) => c.contractId === contractId);
  if (!entry) {
    const known = COMPUTE_CONTRACTS.map((c) => c.contractId).join(', ') || '(空注册表)';
    throw new ComputeContractError('resolve', contractId, `ID 未注册；已注册: ${known}`);
  }
  return entry;
}

export interface ImplementationHit {
  contractId: string;
  /** 绝对路径 */
  absPath: string;
  /** 仓库相对路径 */
  relPath: string;
  exportName: string;
  /** 导出符号所在行号（1-based） */
  sourceLine: number;
  /** `契约ID:` JSDoc 所在行号（1-based；缺失时为 0） */
  declaredAtLine: number;
}

/**
 * 断言实现文件与导出符号真实存在（**静态**校验，不加载模块）。
 * @throws ComputeContractError(phase='file') 文件不存在
 * @throws ComputeContractError(phase='symbol') 导出符号不在实现文件中
 */
export function assertImplementationExists(
  entry: ComputeContractEntry,
  repoRoot?: string,
): ImplementationHit {
  const root = resolveRepoRoot(repoRoot);
  const absPath = join(root, entry.file);

  if (!existsSync(absPath)) {
    throw new ComputeContractError(
      'file',
      entry.contractId,
      `实现文件不存在: ${entry.file}（解析根 ${root}）`,
    );
  }

  let lines: string[];
  try {
    lines = readFileSync(absPath, 'utf-8').split(/\r?\n/);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComputeContractError('file', entry.contractId, `实现文件不可读: ${entry.file} — ${msg}`, true);
  }

  const symbolPattern = new RegExp(`\\bexport\\s+(function|const|class)\\s+${entry.exportName}\\b`);
  const symbolIdx = lines.findIndex((l) => symbolPattern.test(l));
  if (symbolIdx < 0) {
    throw new ComputeContractError(
      'symbol',
      entry.contractId,
      `实现文件未导出符号 ${entry.exportName}: ${entry.file}`,
    );
  }

  const declaredIdx = lines.findIndex((l) => l.includes('契约ID') && l.includes(entry.contractId));

  return {
    contractId: entry.contractId,
    absPath,
    relPath: toRepoRelative(absPath, root),
    exportName: entry.exportName,
    sourceLine: symbolIdx + 1,
    declaredAtLine: declaredIdx >= 0 ? declaredIdx + 1 : 0,
  };
}

type ComputeFn = (...args: unknown[]) => unknown;

/**
 * 动态加载实现模块并取回导出函数（模块内部实现，不对外导出 —— 对外入口是
 * `invokeComputeContract`，避免出现"导出了但 src/ 内无消费者"的空悬符号）。
 * @throws ComputeContractError(phase='load') 模块加载失败
 * @throws ComputeContractError(phase='symbol') 导出项不是函数
 */
async function loadComputeImplementation(
  entry: ComputeContractEntry,
  repoRoot?: string,
): Promise<ComputeFn> {
  const hit = assertImplementationExists(entry, repoRoot);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(hit.absPath).href)) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComputeContractError('load', entry.contractId, `动态加载失败: ${entry.file} — ${msg}`, true);
  }

  const candidate = mod[entry.exportName];
  if (typeof candidate !== 'function') {
    throw new ComputeContractError(
      'symbol',
      entry.contractId,
      `导出项 ${entry.exportName} 不是函数（实际 typeof = ${typeof candidate}）`,
    );
  }
  return candidate as ComputeFn;
}

export interface ComputeInvocationResult {
  contractId: string;
  hit: ImplementationHit;
  /** 调用返回值（原样，供探针打印/断言） */
  value: Record<string, unknown>;
}

/**
 * 真调用：resolve → 静态校验 → 动态加载 → 带 fixture 调用。
 * @throws ComputeContractError(phase='invoke') 返回值非对象 / 缺 expectedKeys
 */
export async function invokeComputeContract(
  contractId: string,
  repoRoot?: string,
): Promise<ComputeInvocationResult> {
  const entry = resolveComputeContract(contractId);
  const fn = await loadComputeImplementation(entry, repoRoot);
  const hit = assertImplementationExists(entry, repoRoot);

  let raw: unknown;
  try {
    raw = fn(...entry.fixture);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComputeContractError('invoke', contractId, `调用抛错: ${msg}`);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ComputeContractError(
      'invoke',
      contractId,
      `调用返回值不是对象（typeof = ${Array.isArray(raw) ? 'array' : typeof raw}）`,
    );
  }

  const value = raw as Record<string, unknown>;
  const missing = entry.expectedKeys.filter((k) => !(k in value));
  if (missing.length > 0) {
    throw new ComputeContractError('invoke', contractId, `返回值缺字段: ${missing.join(', ')}`);
  }
  if (typeof value.degraded !== 'boolean') {
    throw new ComputeContractError(
      'invoke',
      contractId,
      `返回值 degraded 不是 boolean（实际 ${typeof value.degraded}）`,
    );
  }

  log.info({ contractId, file: hit.relPath, sourceLine: hit.sourceLine }, 'compute 契约调用成功');
  return { contractId, hit, value };
}
