/**
 * scripts/ingest-v0/lib/classify.mjs — 类型分类与路径安全判定（**纯函数，零 I/O**）。
 *
 * 为什么纯：发现层的判定（"这个文件算什么类型／这个 ZIP 条目能不能用"）必须能脱离文件系统单测，
 * 否则只有跑真实目录才能验证，而真实目录无法覆盖 `..`／盘符／绝对路径这些恶意形态。
 * I/O（读目录、读 ZIP 中央目录）一律在 `walk.mjs` / `zip-entries.mjs`。
 */

/**
 * 支持的源类型（任务书要求**至少**覆盖这 8 类；新增须同步 `EXTENSION_TO_TYPE` 与测试）。
 * @type {ReadonlyArray<string>}
 */
export const SUPPORTED_TYPES = Object.freeze(['docx', 'pptx', 'pdf', 'html', 'json', 'md', 'txt', 'zip']);

/**
 * 扩展名 → 类型映射（**大小写不敏感**；`.htm` 与 `.html` 同型 —— 同一格式的两种扩展名）。
 * 不在此表内的扩展名一律 `unsupported{reason:'unsupported_type'}`，**不猜类型**。
 */
const EXTENSION_TO_TYPE = Object.freeze({
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.pdf': 'pdf',
  '.html': 'html',
  '.htm': 'html',
  '.json': 'json',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
  '.zip': 'zip',
});

/**
 * 取小写扩展名（含点；无扩展名 ⇒ 空串）。
 *
 * @input  fileName —— 文件名或相对/绝对路径（只取末段，不解析目录语义词）
 * @output 形如 `'.docx'` 的小写扩展名；无扩展名或文件名以点结尾 ⇒ `''`
 * @degraded 无（纯字符串处理，不抛）
 * @authority 扩展名口径由本函数单一真源给出（分类与 byType 统计共用）
 * @not-here 不做真实文件类型嗅探（magic bytes）——**发现层不打开文件内容**
 * @error 无
 */
export function extensionOf(fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0) return '';
  const normalized = fileName.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

/**
 * 按扩展名分类（纯函数；分类结果 = `{type, supported, reason?}`）。
 *
 * @input  fileName —— 文件名（不要求是真实路径）
 * @output 命中支持表 ⇒ `{type, ext, supported:true}`；
 *         未命中 ⇒ `{type:'other', ext, supported:false, reason:'unsupported_type'}`
 * @degraded 无：未知扩展名**不是降级**，是明确的 unsupported 分类（不猜、不当支持）
 * @authority 支持表 = `SUPPORTED_TYPES` ＋ `EXTENSION_TO_TYPE`（本文件单一真源）
 * @not-here 不判断文件是否可读/是否加密/是否损坏（属 I/O 层：`walk.mjs` / `zip-entries.mjs`）
 * @error 无
 */
export function classifyFileName(fileName) {
  const ext = extensionOf(fileName);
  const type = EXTENSION_TO_TYPE[ext];
  if (type === undefined) {
    return { type: 'other', ext, supported: false, reason: 'unsupported_type' };
  }
  return { type, ext, supported: true };
}

/**
 * ZIP 条目名是否越界（`..` 上跳／绝对路径／盘符／UNC）—— 纯判定，不访问文件系统。
 *
 * 判据（任一命中即越界）：
 *   ① 规范化分隔符后以 `/` 开头（含 `//server/share` 形态的 UNC 绝对路径）；
 *   ② 以 `[A-Za-z]:` 开头（`C:/x`、`C:\\x`、`C:x` —— 盘符相对路径同属越界）；
 *   ③ 任一分段 `=== '..'`（`a/../b`、`../x`、`x/..`）。
 * **不解压**就无法确定落点，因此判据取"条目名形态"，宁严勿松（越界条目一律不进 supported）。
 *
 * @input  entryName —— ZIP 中央目录里记录的条目名（可为任意字符串）
 * @output `true` = 越界（调用方记 `skipped{reason:'path_traversal'}`）；`false` = 形态安全
 * @degraded 无（纯判定，不抛）
 * @authority 判据只由本函数给出（`zip-entries.mjs` 不得另写一套）
 * @not-here 不规范化/不改写条目名、不做解压、不判断落点是否真实存在
 * @error 无（非字符串/空串 ⇒ `false`，由上游按"空名条目"另行处理）
 */
export function isTraversalEntry(entryName) {
  if (typeof entryName !== 'string' || entryName.length === 0) return false;
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(normalized)) return true;
  return normalized.split('/').some(segment => segment === '..');
}

/**
 * 扩展名桶键（byType 统计用；无扩展名 ⇒ `'no_ext'`）。
 *
 * @input  fileName —— 文件名
 * @output 去点小写扩展名（`'html'`）或 `'no_ext'`
 * @degraded 无
 * @authority 统计口径只由本函数给出（report.totals.byType 的键）
 * @not-here 不做类型归类（那是 `classifyFileName` 的事）
 * @error 无
 */
export function extensionBucket(fileName) {
  const ext = extensionOf(fileName);
  return ext === '' ? 'no_ext' : ext.slice(1);
}
