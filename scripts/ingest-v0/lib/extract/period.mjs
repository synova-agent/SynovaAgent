/**
 * scripts/ingest-v0/lib/extract/period.mjs — 资料期间（`YYYY-MM`）的**规则识别**（纯函数，零 I/O）。
 *
 * 为什么单独一件：C2 要求「每个对象的 period 必须来自资料，拿不到就不落库」，
 * 所以「期间从哪来」只能有一个判据源；抽取层各处（HTML/docx/pptx/pdf/文本）都问本模块，
 * 不允许各自写一套日期正则（否则「同一份资料两个期间」无从归因）。
 *
 * 边界（C1：不用大模型）：
 *   · 只做确定性正则匹配；匹配不到 ⇒ `null`（**不猜、不用当前月顶替**）；
 *   · **不做相对日期推导**（"昨日/本月"不换算 —— 那需要外部时钟，等于编造期间）；
 *   · 期间取**首个**命中（按 `PERIOD_PATTERNS` 先后顺序），并返回命中位置便于 sourceRef 取证。
 */

/** 合法期间上下界（防御资料里的乱码年份被当成业务期间）。 */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * 期间模式（**顺序即优先级**；首个命中即采用）。
 *
 * 每条模式的第 1 组 = 年、第 2 组 = 月；`match` 用于定位命中文本（locator 取证）。
 * 覆盖本票已见资料形态：`数据周期 2026-08-01 ~ 08-26`、`经营周期 2026年8月起`、
 * `2026-08-01`、`2026/8`、`20260807`（文件名/正文时间戳，仅当带上下文时才采用）。
 */
const PERIOD_PATTERNS = Object.freeze([
  // 「数据周期/经营周期/统计周期/期间」后跟明确年月日（最强证据；避免把生成时间当周期）
  { name: 'cycle-label', regex: /(?:数据周期|经营周期|统计周期|数据期间|报告期间)\s*[:：]?\s*(\d{4})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*\d{1,2})?/g },
  // 显式年月（带「年/月」字样）
  { name: 'year-month-cn', regex: /(\d{4})\s*年\s*(\d{1,2})\s*月/g },
  // ISO 日期（取年月；日可省略）
  { name: 'iso-date', regex: /(\d{4})-(\d{1,2})-\d{1,2}(?!\d)/g },
  { name: 'iso-year-month', regex: /(\d{4})[-/](\d{1,2})(?!\d)/g },
  // 紧凑时间戳（仅接受 8 位 `YYYYMMDD`；6 位 `YYYYMM` 太容易误命中，不采用）
  { name: 'compact-date', regex: /(?:^|[^\d])(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g },
]);

/**
 * 计算 1-based 行号（locator 取证用；纯函数）。
 *
 * @input  text —— 原文；offset —— 字符偏移
 * @output 1-based 行号（越界 ⇒ 1）
 * @degraded 无
 * @authority 行号口径只由本函数给出
 * @not-here 不做文本解码/换行归一
 * @error 无
 */
export function lineAtOffset(text, offset) {
  if (typeof text !== 'string' || text.length === 0) return 1;
  const safe = Math.max(0, Math.min(offset, text.length));
  let lines = 1;
  for (let index = 0; index < safe; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

/**
 * 把年月收窄为合法 `YYYY-MM`。
 *
 * @input  yearText/monthText —— 正则捕获的字符串
 * @output `YYYY-MM`（合法）或 `null`（月份/年份越界）
 * @degraded 无：越界 ⇒ null，**不夹取、不四舍五入**
 * @authority 合法性判据只由本函数给出
 * @not-here 不做时区换算
 * @error 无
 */
export function normalizePeriod(yearText, monthText) {
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * 从文本里识别**首个**资料期间。
 *
 * @input  text —— 已解码的资料文本（HTML 去标签后 / docx 段落拼接 / PDF 抽取文本等）
 * @output 命中 ⇒ `{period, pattern, matched, offset, line}`；未命中 ⇒ `null`
 * @degraded 无：未命中就是 null（调用方据此计入 `missingPeriod`，**禁止回退当前月**）
 * @authority 期间判据 = `PERIOD_PATTERNS`（本文件单一真源）
 * @not-here 不提取"第几周/第几季度"（本票只认月）；不判断资料是否过期
 * @error 无（纯匹配，不抛）
 */
export function detectPeriod(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  for (const pattern of PERIOD_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const period = normalizePeriod(match[1], match[2]);
      if (period !== null) {
        return {
          period,
          pattern: pattern.name,
          matched: match[0],
          offset: match.index,
          line: lineAtOffset(text, match.index),
        };
      }
      if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
    }
  }
  return null;
}
