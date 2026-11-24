/**
 * scripts/ingest-v0/lib/budget.mjs — 资源上限账本（**纯函数，零 I/O**，时间由调用方注入）。
 *
 * 为什么纯 + 注入时钟：限额判定的边界（第 N 个文件、第 N 字节、第 N 毫秒）必须能确定性单测；
 * 若内部读 `Date.now()`，时长上限就只能靠"真等 10 分钟"验证，等于无法验证。
 *
 * 判据分两类（与任务书 §3／§6 对齐，**不要混用**）：
 *   · 累计型上限（文件数／总字节／递归深度／总时长）⇒ 超限**立即停**并抛 `E_RESOURCE_LIMIT`
 *     （上限是"防跑飞"的保险丝，不是逐条筛选条件）；
 *   · 单文件上限 ⇒ **不中断**，该文件记 `skipped{reason:'oversized'}` 后继续
 *     （任务书 §6 明确要求"超大 ⇒ 显式 skipped，逐条原因"；一个 60 MB 的 docx 不该让整目录放弃）。
 */

import { INGEST_ERROR_CODES, IngestError } from './errors.mjs';

/**
 * 默认资源上限（任务书 §3 原值；全部可经 CLI 参数覆盖）。
 * 单位：字节为 B，时长为 ms。
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 5000,
  maxTotalBytes: 500 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxDepth: 8,
  maxDurationMs: 10 * 60 * 1000,
});

/**
 * 建账本（纯对象，不读时钟）。
 *
 * @input  overrides —— 覆盖项（只允许 `DEFAULT_LIMITS` 的键；未给的用默认值）
 *         startedAtMs —— 起点毫秒（由调用方注入；缺省 0，此时时长检查等价"相对起点已过 ms"）
 * @output `{limits, files, bytes, startedAtMs}` 可变账本（`admitFile`/`checkDepth` 就地累加）
 * @degraded 无
 * @authority 默认值 = `DEFAULT_LIMITS`（本文件单一真源）
 * @not-here 不校验参数合法性（CLI 负责 `E_BAD_ARGS`）；不读时钟
 * @error 无
 */
export function createBudget(overrides = {}, startedAtMs = 0) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return { limits, files: 0, bytes: 0, startedAtMs };
}

/**
 * 判一条资源上限是否已破（纯判定）。
 *
 * @input  budget —— `createBudget` 产物；kind —— `'maxFiles'|'maxTotalBytes'|'maxDepth'|'maxDurationMs'`；
 *         actual —— 实测值（该判据的量）；context —— 归因信息（path／depth 等，进错误 detail）
 * @output 无（未超限即返回）
 * @degraded 无：超限**不降级**，直接 fail loud（`E_RESOURCE_LIMIT`）
 * @authority 比较口径只由本函数给出（`expect <= limit`）
 * @not-here 不累加计数（累加在 `admitFile`/`checkDepth`）、不决定退出码
 * @error `IngestError(E_RESOURCE_LIMIT, phase='scan')` —— 超限；detail 带 `limit/limitValue/actual/context`
 */
export function assertWithinLimit(budget, kind, actual, context = {}) {
  const limitValue = budget.limits[kind];
  if (typeof limitValue !== 'number' || Number.isNaN(limitValue)) return;
  if (actual <= limitValue) return;
  throw new IngestError(
    INGEST_ERROR_CODES.RESOURCE_LIMIT,
    'scan',
    `超资源上限 ${kind}: 实测 ${actual} > 上限 ${limitValue}${context.path ? `（${String(context.path)}）` : ''}`,
    { detail: { limit: kind, limitValue, actual, context } },
  );
}

/**
 * 登记一个常规文件（累加计数/字节；单文件超大 ⇒ 返回 oversized，不抛）。
 *
 * @input  budget —— 账本；file —— `{size, path}`（size 为 lstat 的字节数，非负整数）
 *         nowMs —— 当前毫秒（注入；用于时长上限检查）
 * @output `{accepted:true}` ⇒ 可继续处理；`{accepted:false, reason:'oversized', size, maxFileBytes}`
 *         ⇒ 该文件应记 skipped 并继续
 * @degraded 无：超大文件走显式 skipped（不是静默跳过，调用方必须落进 `skipped[]`）
 * @authority 累计口径：**每个常规文件**都计入 files（含 unsupported/skipped），
 *            bytes 也按实测 size 累计 ⇒ 限额反映"扫描面"，不因分类结果而变化
 * @not-here 不读文件、不判断类型
 * @error `IngestError(E_RESOURCE_LIMIT)` —— 文件数/总字节/时长超限（**先累计后判定**前的顺序见实现）
 */
export function admitFile(budget, file, nowMs) {
  budget.files += 1;
  assertWithinLimit(budget, 'maxFiles', budget.files, { path: file.path });
  budget.bytes += file.size;
  assertWithinLimit(budget, 'maxTotalBytes', budget.bytes, { path: file.path, size: file.size });
  assertWithinLimit(budget, 'maxDurationMs', nowMs - budget.startedAtMs, { path: file.path });

  if (file.size > budget.limits.maxFileBytes) {
    return { accepted: false, reason: 'oversized', size: file.size, maxFileBytes: budget.limits.maxFileBytes };
  }
  return { accepted: true };
}

/**
 * 检查即将进入的子目录深度（`root` 的深度 = 0）。
 *
 * @input  budget —— 账本；depth —— 目标目录深度（整数）；path —— 归因用相对路径
 * @output 无（未超限即返回）
 * @degraded 无
 * @authority 深度口径 = "相对 --source 的目录层数"，由 `walk.mjs` 传入
 * @not-here 不遍历目录
 * @error `IngestError(E_RESOURCE_LIMIT)` —— 深度超限（**不静默剪枝**：剪枝会让人以为目录已扫完）
 */
export function checkDepth(budget, depth, path) {
  assertWithinLimit(budget, 'maxDepth', depth, { path, depth });
}

/**
 * 检查累计耗时（每处理一个条目调用一次）。
 *
 * @input  budget —— 账本；nowMs —— 当前毫秒（注入）
 * @output 无（未超限即返回）
 * @degraded 无
 * @authority 时长口径 = `nowMs - budget.startedAtMs`
 * @not-here 不读系统时钟
 * @error `IngestError(E_RESOURCE_LIMIT)` —— 总时长超限
 */
export function checkDuration(budget, nowMs) {
  assertWithinLimit(budget, 'maxDurationMs', nowMs - budget.startedAtMs, {});
}
