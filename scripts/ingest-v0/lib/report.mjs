/**
 * scripts/ingest-v0/lib/report.mjs — 报告构造与摘要行（**纯函数，零 I/O**）。
 *
 * 为什么纯：报告形状是验收判据（`{supported, unsupported, skipped, totals:{files,bytes,byType}}`），
 * 必须能脱离磁盘单测；否则"报告字段对不对"只能靠跑真实目录看，而真实目录覆盖不到边界形态。
 *
 * 状态口径（硬性，任务书 B 段验收）：**「全部 unsupported」不得算成功**。
 * `deriveStatus` 只在 `supported.length > 0` 时给 `'ok'`；否则给 `'no_supported_input'`（退出码非 0），
 * 以免下游把"什么都没认出来"当成"扫描成功"。
 */

import { extensionBucket } from './classify.mjs';

/**
 * 报告 schema 版本（形状变更必须递增；下游据此判断字段可用性）。
 */
export const REPORT_SCHEMA_VERSION = 'ingest-v0.discover.v1';

/**
 * 由扫描结果派生总状态（纯）。
 *
 * @input  input.supportedCount —— 支持的文件数；input.error —— 已发生的 typed error（可空）
 * @output `'ok'`（有支持项且无错误）｜`'resource_limit'`（超限停止，已有 error）｜
 *         `'failed'`（其它已发生的 error）｜`'no_supported_input'`（零支持项，**不算成功**）
 * @degraded 无
 * @authority 状态判据只由本函数给出（CLI 不另写 if 分支）
 * @not-here 不决定退出码（`discover.mjs` 依 status/code 映射）
 * @error 无
 */
export function deriveStatus(input) {
  if (input.error !== null && input.error !== undefined) {
    return input.error.code === 'E_RESOURCE_LIMIT' ? 'resource_limit' : 'failed';
  }
  return input.supportedCount > 0 ? 'ok' : 'no_supported_input';
}

/**
 * 构造 report.json 对象（纯）。
 *
 * @input  input.source —— `--source` 绝对值（报告只记路径，不记文件内容）
 *         input.status —— `deriveStatus` 结果
 *         input.files —— `walk.scanTree().files`（含 supported 与 unsupported，按 relPath 升序）
 *         input.extraSkipped —— ZIP 层的 skipped 条目（`{path, reason, detail?}`）
 *         input.walkSkipped —— `walk.scanTree().skipped`
 *         input.limits —— 生效的资源上限（便于复现）
 *         input.startedAt／finishedAt —— ISO 字符串；input.error —— `IngestError | null`
 * @output 报告对象：`{schemaVersion, source, status, supported[], unsupported[], skipped[], totals, limits,
 *         startedAt, finishedAt, durationMs, error?}`；
 *         `totals = {files, bytes, byType, supported, unsupported, skipped}`（`byType` 按扩展名桶计数）
 * @degraded 无：不裁剪、不抽样、不改写条目（**报告即观测**；任何跳过都必须有 reason）
 * @authority `totals` 口径 = 全部**发现的常规文件**（含 unsupported/skipped），不是只算 supported
 * @not-here 不读文件、不写文件；不判断 supported 的条目是否真的可解析（抽取层的事）
 * @error 无（纯构造）
 */
export function buildReport(input) {
  const supported = [];
  const unsupported = [];
  const totals = {
    files: 0,
    bytes: 0,
    byType: {},
    supported: 0,
    unsupported: 0,
    skipped: 0,
  };

  for (const file of input.files) {
    totals.files += 1;
    totals.bytes += file.size;
    const bucket = extensionBucket(file.relPath);
    totals.byType[bucket] = (totals.byType[bucket] ?? 0) + 1;
    if (file.supported) {
      const item = { path: file.relPath, type: file.type, size: file.size, depth: file.depth };
      if (file.zip !== undefined) item.zip = file.zip;
      supported.push(item);
    } else {
      unsupported.push({
        path: file.relPath,
        type: file.type,
        size: file.size,
        depth: file.depth,
        reason: file.reason ?? 'unsupported_type',
      });
    }
  }

  const skipped = [...(input.walkSkipped ?? []), ...(input.extraSkipped ?? [])]
    .map(entry => {
      const item = { path: entry.path, reason: entry.reason };
      if (entry.detail !== undefined) item.detail = entry.detail;
      return item;
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  totals.supported = supported.length;
  totals.unsupported = unsupported.length;
  totals.skipped = skipped.length;

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    source: input.source,
    status: input.status,
    supported,
    unsupported,
    skipped,
    totals,
    limits: input.limits,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
  };
  if (input.error !== null && input.error !== undefined) {
    report.error = typeof input.error.toJSON === 'function' ? input.error.toJSON() : input.error;
  }
  return report;
}

/**
 * 一行摘要（stdout 契约；`INGEST-DISCOVER` 前缀便于日志检索与 CI 断言）。
 *
 * @input  report —— `buildReport` 产物；outputPath —— report.json 落盘绝对路径
 * @output 单行字符串：`INGEST-DISCOVER status=<s> files=<n> supported=<n> unsupported=<n> skipped=<n>
 *         bytes=<n> out=<path>[ code=<E_...>]`
 * @degraded 无
 * @authority 字段名固定（下游 grep 依赖它）
 * @not-here 不加时间戳（摘要需可复现比对；时间在报告里）
 * @error 无
 */
export function summarize(report, outputPath) {
  const parts = [
    'INGEST-DISCOVER',
    `status=${report.status}`,
    `files=${String(report.totals.files)}`,
    `supported=${String(report.totals.supported)}`,
    `unsupported=${String(report.totals.unsupported)}`,
    `skipped=${String(report.totals.skipped)}`,
    `bytes=${String(report.totals.bytes)}`,
    `out=${outputPath}`,
  ];
  if (report.error !== undefined && report.error !== null) parts.push(`code=${String(report.error.code)}`);
  return parts.join(' ');
}
