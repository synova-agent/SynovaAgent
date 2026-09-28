/**
 * scripts/ci/golden-snapshot-runner.ts — D396 黄金用例快照执行器 (+ D474 黄金数据集门禁)
 *
 * 契约（铁律 47 — 契约优先，先定义再实现）:
 *   @input  — section: 各层快照段（ComputeSnapshotSection / FindingsSnapshotSection / ExpertReportSection）
 *   @output — SnapshotCheckResult { passed: boolean; degraded: boolean; diffs: string[] }
 *             纯函数，可单测；diffs 为人类可读的逐字段差异或错误清单
 *   @degraded — fixture 声明了快照段但缺 snapshot → passed:false + degraded:true + stderr（铁律 11 显式降级）
 *               compute/aggregate 执行抛错 → passed:false + degraded:true + stderr（铁律 24 不空吞）
 *   @error  — function 名未登记 → passed:false + degraded:false + "未登记"（不静默 skip，K3 验收锚点）
 *
 * D474 新增（黄金数据集门禁 — wani-baby 真实数据 + 期望诊断）:
 *   recordComputeSnapshot — keyless 快照录制（DSH snapshot 范式）: 跑真实函数生成冻结候选，
 *                            录制 ≠ 判定（人工确认后才写入 fixture，回放走 runComputeSnapshot）
 *   runGoldenDatasetCheck — 黄金数据集 severity 级对比: 对已登记 compute 纯函数跑真实代码
 *                            → signal vs dataset.sentinels[哨兵名].expected（severity 级 diff）
 *
 * 职责（K3 咨询 §4.3「神 = 可复现」）:
 *   真跑 compute 纯函数 / 哨兵 findings 聚合 / 专家报告结构断言，与冻结快照逐字段 diff。
 *   只做快照层，不碰 F1 判定逻辑（computeF1Score/deriveActual 在 golden-case-checker.ts，冻结）。
 */
import { computeCashRunway } from '../../extensions/sentinels/financing-constraint/computes/cash-runway';

// ═══ 类型定义 ═══

/** 快照检查统一结果（三层共用） */
export interface SnapshotCheckResult {
  passed: boolean;
  degraded: boolean;
  diffs: string[];
}

/** fixture.compute 段 — compute 快照契约 */
export interface ComputeSnapshotSection {
  function: string;
  input: unknown;
  snapshot?: Record<string, unknown>;
}

/** finding 快照条目（id/severity/title 三字段） */
export interface FindingSnapshot {
  id: string;
  severity: string;
  title: string;
}

/** fixture.findings 段 — findings 快照契约 */
export interface FindingsSnapshotSection {
  function: string;
  input: unknown;
  snapshot?: FindingSnapshot[];
}

/** 专家报告快照（结构化断言，不做 LLM 全文 diff） */
export interface ExpertReportSnapshot {
  expert: string;
  summary: string;
  confidence: number;
  checkedAt: string;
}

/** fixture.expertReport 段 — 专家报告结构断言契约 */
export interface ExpertReportSection {
  snapshot?: ExpertReportSnapshot;
}

/** findings 集合 diff 结果 */
export interface FindingsDiff {
  missing: string[];
  extra: string[];
  mismatched: string[];
}

// ═══ 函数登记表（增量登记 D355-D360 修复对象，本任务示范 compute 层） ═══

/**
 * computeFnRegistry — compute 函数名 → 真实纯函数映射。
 * 契约: 只映射"纯 compute 函数"（无 DB/无副作用），输入/输出由 fixture 的
 *       compute.input/snapshot 定义。未登记的 function 名 → runComputeSnapshot
 *       显式失败（不静默 skip）。
 */
export const computeFnRegistry: Record<string, (input: unknown) => unknown> = {
  computeCashRunway: (input) =>
    computeCashRunway(input as Array<{ cash: number; operatingExpense: number }>),
};

/**
 * findingsFnRegistry — 哨兵 aggregate 名 → 真实函数映射（增量登记）。
 * 本任务只示范 compute 层（spec §3.3: 全诊断管线端到端跑归 GSS D361+），
 * findings 层机制就位但登记表留空，后续 D355-D360 aggregate 按同契约登记。
 */
export const findingsFnRegistry: Record<string, (input: unknown) => FindingSnapshot[]> = {};

// ═══ diff 工具 ═══

/** 类型守卫: 纯对象（非数组/非 null） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * diffObjects — 递归逐字段 diff（compute 全 diff 核心）。
 * 输出人类可读差异串，如 `signal: 期望 "critical" 实际 "warning"`。
 * 不抛错——任何形状的输入都能产出 diff 清单。
 */
function diffObjects(actual: unknown, expected: unknown, path: string, diffs: string[]): void {
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in actual)) {
        diffs.push(`${childPath}: 缺失（期望 ${JSON.stringify(expected[key])}）`);
      } else if (!(key in expected)) {
        diffs.push(`${childPath}: 多余（实际 ${JSON.stringify(actual[key])}）`);
      } else {
        diffObjects(actual[key], expected[key], childPath, diffs);
      }
    }
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      diffs.push(`${path}: 数组长度 期望 ${expected.length} 实际 ${actual.length}`);
    }
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i++) {
      diffObjects(actual[i], expected[i], `${path}[${i}]`, diffs);
    }
    return;
  }
  if (actual !== expected) {
    diffs.push(`${path}: 期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`);
  }
}

// ═══ 三层快照检查 ═══

/**
 * runComputeSnapshot — compute 全 diff（层 1）。
 * 查 registry 跑真实 compute 函数 → 输出 vs 冻结 snapshot 逐字段 deep-equal。
 */
export function runComputeSnapshot(section: ComputeSnapshotSection): SnapshotCheckResult {
  const fn = computeFnRegistry[section.function];
  if (!fn) {
    return {
      passed: false,
      degraded: false,
      diffs: [`compute function "${section.function}" 未登记（computeFnRegistry）`],
    };
  }
  if (!section.snapshot) {
    console.error(`[golden-snapshot-runner] compute.snapshot 缺失 (function=${section.function})`);
    return { passed: false, degraded: true, diffs: ['compute.snapshot 缺失 — 显式降级，不静默 pass'] };
  }
  let actual: unknown;
  try {
    actual = fn(section.input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[golden-snapshot-runner] compute "${section.function}" 执行失败: ${msg}`);
    return { passed: false, degraded: true, diffs: [`compute "${section.function}" 执行失败: ${msg}`] };
  }
  const diffs: string[] = [];
  diffObjects(actual, section.snapshot, '', diffs);
  return { passed: diffs.length === 0, degraded: false, diffs };
}

/**
 * diffFindings — findings 集合 diff（层 2 核心纯函数）。
 * 按 id 对账：missing（快照有实际无）/ extra（实际有快照无）/ mismatched（id 同但 severity/title 异）。
 */
export function diffFindings(actual: FindingSnapshot[], snapshot: FindingSnapshot[]): FindingsDiff {
  const actualById = new Map(actual.map((f) => [f.id, f]));
  const snapshotById = new Map(snapshot.map((f) => [f.id, f]));
  const missing: string[] = [];
  const extra: string[] = [];
  const mismatched: string[] = [];
  for (const id of snapshotById.keys()) {
    if (!actualById.has(id)) missing.push(id);
  }
  for (const id of actualById.keys()) {
    if (!snapshotById.has(id)) extra.push(id);
  }
  for (const id of snapshotById.keys()) {
    const a = actualById.get(id);
    const s = snapshotById.get(id);
    if (a && s && (a.severity !== s.severity || a.title !== s.title)) mismatched.push(id);
  }
  return { missing, extra, mismatched };
}

/**
 * runFindingsSnapshot — findings 全 diff（层 2）。
 * 查 findingsFnRegistry 跑真实 aggregate → findings 列表 vs 冻结快照（id/severity/title 集合 diff）。
 */
export function runFindingsSnapshot(section: FindingsSnapshotSection): SnapshotCheckResult {
  const fn = findingsFnRegistry[section.function];
  if (!fn) {
    return {
      passed: false,
      degraded: false,
      diffs: [`findings function "${section.function}" 未登记（findingsFnRegistry）`],
    };
  }
  if (!section.snapshot) {
    console.error(`[golden-snapshot-runner] findings.snapshot 缺失 (function=${section.function})`);
    return { passed: false, degraded: true, diffs: ['findings.snapshot 缺失 — 显式降级，不静默 pass'] };
  }
  let actual: FindingSnapshot[];
  try {
    actual = fn(section.input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[golden-snapshot-runner] findings "${section.function}" 执行失败: ${msg}`);
    return { passed: false, degraded: true, diffs: [`findings "${section.function}" 执行失败: ${msg}`] };
  }
  const d = diffFindings(actual, section.snapshot);
  const diffs: string[] = [
    ...d.missing.map((id) => `missing finding: ${id}`),
    ...d.extra.map((id) => `extra finding: ${id}`),
    ...d.mismatched.map((id) => `mismatched finding: ${id}`),
  ];
  return { passed: diffs.length === 0, degraded: false, diffs };
}

// ═══ D474: 黄金数据集门禁（wani-baby 真实数据 + 期望诊断）═══

/**
 * GoldenDataset — wani-baby 黄金数据集契约（2026-08-22 实证 data/golden/wani-baby-v1.json）。
 * sentinels 是「哨兵名 → { expected, value }」结构（cash-runway → {expected:"critical", value:0.22}），
 * 非 FindingSnapshot[]（{id,severity,title}）——diff 契约是 **severity 级对比**。
 */
export interface GoldenDataset {
  datasetVersion: string;
  sentinels: Record<string, { expected: string; value: number }>;
  expectedDiagnosis?: {
    severity?: string;
    rootCauseEdges?: string[];
    primaryBlocker?: string;
    causalChain?: unknown[];
  };
}

/**
 * recordComputeSnapshot — keyless 快照录制（DSH snapshot 范式，D474）
 * 契约（铁律 47）:
 *   @input  — section: ComputeSnapshotSection（function + input，无 snapshot）
 *   @output — { snapshot?: Record<string, unknown>; error?: string }
 *             跑真实函数生成冻结候选；未登记 function → error（不静默）
 *   @degraded — function 未登记 → { error } + stderr（铁律 24，不静默）
 *   录制 ≠ 判定：返回的 snapshot 须人工确认后写入 fixture（冻结），回放走 runComputeSnapshot
 */
export function recordComputeSnapshot(
  section: ComputeSnapshotSection,
): { snapshot?: Record<string, unknown>; error?: string } {
  const fn = computeFnRegistry[section.function];
  if (!fn) {
    const msg = `compute function "${section.function}" 未登记（computeFnRegistry）`;
    console.error(`[golden-snapshot-runner] recordComputeSnapshot: ${msg}`);
    return { error: msg };
  }
  try {
    const result = fn(section.input);
    if (result === null || typeof result !== 'object') {
      return { error: `compute "${section.function}" 输出非对象，无法录制快照` };
    }
    return { snapshot: result as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[golden-snapshot-runner] recordComputeSnapshot: compute "${section.function}" 执行失败: ${msg}`);
    return { error: msg };
  }
}

/**
 * computeSentinelSignal — 从 compute 输出提取哨兵 severity 信号（D474 severity 级对比核心）。
 * 契约:
 *   @input  — computeResult: unknown（computeFnRegistry 函数真实输出）
 *   @output — severity 字符串（'critical' | 'warning' | 'healthy' | 'high' | 'medium' | 'low'）或 null
 *   compute 输出带 signal 字段（cash-runway 契约）→ 取 signal；否则取 severity 字段；
 *   两者皆无 → null（该哨兵无 severity 信号，跳过对比）
 */
function computeSentinelSignal(computeResult: unknown): string | null {
  if (computeResult === null || typeof computeResult !== 'object') return null;
  const record = computeResult as Record<string, unknown>;
  const signal = record.signal;
  if (typeof signal === 'string' && signal.length > 0) return signal;
  const severity = record.severity;
  if (typeof severity === 'string' && severity.length > 0) return severity;
  return null;
}

/**
 * runGoldenDatasetCheck — 黄金数据集门禁（wani-baby 真实数据 + 期望诊断，D474）
 * 契约（实证 data/golden/wani-baby-v1.json 结构）:
 *   @input  — dataset: GoldenDataset
 *             sentinels: Record<哨兵名, { expected: severity, value: number }>
 *             expectedDiagnosis: { rootCauseEdges, primaryBlocker, severity, causalChain }
 *             computeInputs: Record<哨兵名, unknown> — 每个已登记哨兵的 compute 输入
 *               （哨兵 value 是 0-1 打分，不是 compute 函数入参；compute 入参由调用方
 *               按哨兵语义提供，如 cash-runway → [{cash, operatingExpense}]）
 *   @output — SnapshotCheckResult：
 *             ① 对每个「已登记在 computeFnRegistry 的哨兵 compute 纯函数」跑真实代码
 *                → 产出 severity → 与 dataset.sentinels[哨兵名].expected 对比（severity 级 diff）
 *             ② expectedDiagnosis.severity 与 dataset 声明的全局严重度对比
 *   @degraded — 数据集缺 sentinels → degraded:true + stderr（铁律 11/24，不静默 pass）
 *   ⚠️ 数据集 sentinels 是「哨兵名 → {expected, value}」结构（cash-runway → {expected:"critical", value:0.22}），
 *      不是 FindingSnapshot[]（{id,severity,title}）——diff 契约是 **severity 级对比**，
 *      不做 findings 集合 diff（findingsFnRegistry 契约是 FindingSnapshot[]，两者不混用，D474 S-10 descope）
 *   ⚠️ 未登记 compute 的哨兵 → 跳过（registry 登记什么查什么，不因未登记全量红，L2c 边界契约）
 *   ⚠️ 已登记但未提供 computeInputs 的哨兵 → 跳过（无法跑真实代码不硬判红，L2c）
 *
 * 哨兵名 → compute 函数名映射（命名约定）:
 *   哨兵名 'cash-runway' → compute 函数名 'computeCashRunway'（去 'compute' 前缀 + kebab-case 转 PascalCase）
 *   registry 登记什么查什么；未登记哨兵跳过不误杀。
 */
export function runGoldenDatasetCheck(
  dataset: GoldenDataset,
  computeInputs: Record<string, unknown> = {},
): SnapshotCheckResult {
  if (!dataset || typeof dataset !== 'object') {
    console.error('[golden-snapshot-runner] 黄金数据集为空或非法');
    return { passed: false, degraded: true, diffs: ['黄金数据集为空 — 显式降级，不静默 pass'] };
  }
  if (!dataset.sentinels || typeof dataset.sentinels !== 'object' || Object.keys(dataset.sentinels).length === 0) {
    console.error('[golden-snapshot-runner] 黄金数据集缺 sentinels');
    return { passed: false, degraded: true, diffs: ['黄金数据集缺 sentinels — 显式降级，不静默 pass'] };
  }

  const diffs: string[] = [];
  let checked = 0;
  let skipped = 0;

  // ① 已登记 compute 哨兵的 severity 级对比
  for (const [sentinelName, sentinel] of Object.entries(dataset.sentinels)) {
    if (!sentinel || typeof sentinel !== 'object' || typeof sentinel.expected !== 'string') {
      diffs.push(`${sentinelName}: sentinels 条目缺 expected 字段（结构异常）`);
      continue;
    }
    const computeFnName = computeFnForSentinel(sentinelName);
    const fn = computeFnRegistry[computeFnName];
    if (!fn) {
      // 未登记 compute → 跳过（registry 登记什么查什么，不因未登记全量红，L2c）
      skipped++;
      continue;
    }
    if (!(sentinelName in computeInputs)) {
      // 已登记但未提供 input → 跳过（无法跑真实代码不硬判红，L2c）
      skipped++;
      continue;
    }
    let actual: unknown;
    try {
      actual = fn(computeInputs[sentinelName]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diffs.push(`${sentinelName}: compute "${computeFnName}" 执行失败: ${msg}`);
      continue;
    }
    const signal = computeSentinelSignal(actual);
    if (signal === null) {
      diffs.push(`${sentinelName}: compute "${computeFnName}" 输出无 severity 信号（signal/severity 字段缺失）`);
      continue;
    }
    checked++;
    if (signal !== sentinel.expected) {
      diffs.push(`${sentinelName}: severity 期望 "${sentinel.expected}" 实际 "${signal}"`);
    }
  }

  // ② expectedDiagnosis.severity 结构断言（D474 复核修正: 放宽为"存在 + 合法值域"）
  // 原实现做"全局 severity ∈ 已登记哨兵期望集合"匹配——过度约束:
  //   全局严重度是综合诊断结果（跨哨兵聚合），未必等于任一单哨兵 expected；
  //   未来 wani-baby 数据集重建或哨兵登记变化会误伤（代码正确但门禁红）。
  //   修正: 只断言字段存在 + 值域合法（critical|high|medium|low|warning|healthy），
  //   不做跨哨兵匹配（dev doc 无此对比的测试锚点，S-10 保守 descope）。
  const expectedDiagnosis = dataset.expectedDiagnosis;
  if (expectedDiagnosis && typeof expectedDiagnosis === 'object' && typeof expectedDiagnosis.severity === 'string') {
    const globalSeverity = expectedDiagnosis.severity;
    const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'warning', 'healthy']);
    if (!VALID_SEVERITIES.has(globalSeverity)) {
      diffs.push(`expectedDiagnosis.severity="${globalSeverity}" 非合法 severity 值（critical|high|medium|low|warning|healthy）`);
    }
  }

  // D1056 ①: 覆盖度可见 — checked/skipped 原本只在 checked===0 的失败分支里被读到，
  // 通过时"到底查了几个、跳了几个"对读者完全不可见（D1046: 覆盖不足 + 覆盖度不可见）。
  // 本行无条件打印，使绿态也能看到真实覆盖面（不是让读者假定 11 个哨兵全查了）。
  console.log(`[golden-snapshot-runner] 黄金数据集 compute 覆盖: 实际检查 ${checked} 个 / 跳过 ${skipped} 个（registry 已登记 ${Object.keys(computeFnRegistry).length} 个 / 数据集哨兵 ${Object.keys(dataset.sentinels).length} 个）`);
  if (checked === 0) {
    diffs.push(`已登记 compute 哨兵实际检查数为 0（跳过 ${skipped} 个）— 黄金数据集未覆盖任何可执行 computeFnRegistry 检查`);
  }

  if (diffs.length > 0) {
    return { passed: false, degraded: false, diffs };
  }
  return { passed: true, degraded: false, diffs: [] };
}

/**
 * computeFnForSentinel — 哨兵名 → compute 函数名（D474 命名约定映射）。
 * 'cash-runway' → 'computeCashRunway'（去 'compute' 前缀 + kebab-case 转 PascalCase）。
 * 纯字符串转换，不查 registry（未登记由调用方跳过）。
 */
export function computeFnForSentinel(sentinelName: string): string {
  const pascal = sentinelName
    .split('-')
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
  return `compute${pascal}`;
}

/**
 * runExpertReportAssertion — 专家报告结构断言（层 3）。
 * 断言字段存在性 + 值域（expert/summary 非空、confidence ∈ [0,1]、checkedAt 合法 ISO）。
 * 不做 LLM 全文 diff（K3 原文: 模型非确定性部分用结构化断言）。
 */
export function runExpertReportAssertion(section: ExpertReportSection): SnapshotCheckResult {
  if (!section.snapshot) {
    console.error('[golden-snapshot-runner] expertReport.snapshot 缺失');
    return { passed: false, degraded: true, diffs: ['expertReport.snapshot 缺失 — 显式降级，不静默 pass'] };
  }
  const { expert, summary, confidence, checkedAt } = section.snapshot;
  const diffs: string[] = [];
  if (typeof expert !== 'string' || expert.trim().length === 0) {
    diffs.push('expert 非空字符串断言失败');
  }
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    diffs.push('summary 非空字符串断言失败');
  }
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    diffs.push(`confidence ∈ [0,1] 断言失败: ${String(confidence)}`);
  }
  if (typeof checkedAt !== 'string' || Number.isNaN(Date.parse(checkedAt))) {
    diffs.push(`checkedAt 合法 ISO 时间戳断言失败: ${String(checkedAt)}`);
  }
  return { passed: diffs.length === 0, degraded: false, diffs };
}
