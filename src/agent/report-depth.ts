/**
 * agent/report-depth.ts — 报告呈现粒度轴（D1051 W1，L2 编排层）
 *
 * 职责：单一事实源承载「报告以什么粒度呈现」（浅层一页纸 / 详细报告），以及
 *       「用户这句话要求哪个粒度」的**确定性**判别。
 *
 * 架构位（铁律 39，DR-1 裁定 A 案）：
 *   本模块落在 **L2**（`src/agent/`），**不是** L3。理由：深度词表 / 查询参数规范化 /
 *   对话话语判别全部是**编排层关注点**（解析入参、决定渲染策略），语义归属应看谁定义策略，
 *   而非看概念像谁。落 L2 后：L1 两路由经相邻依赖取用（L1→L2 合法），本模块对 L3 零可见性
 *   要求（章节标题随 `chapters[].title` 数据走，见 §4.5 Q7 子裁定 (i)）。
 *
 * 依赖方向（本模块的铁律 39 面）：**零 import** —— 不引 `src/l3/**`（不越层）、
 *   不引其他 `src/agent/**` 模块（不制造同层耦合）。`ReportDepth`（装配轴）与
 *   `VIEW_TO_ASSEMBLE_DEPTH` 均落在 `src/agent/report-assembler.ts`（同层，其 `:31` 定义处），
 *   因此本模块**不产生任何跨层边**。纯函数、零 I/O、零时刻、零随机。
 */

// ═══ 呈现粒度轴 ═══

/**
 * 报告呈现粒度轴取值域（**与装配轴 `ReportDepth`（ceo/flywheel/expert/raw）正交、不相通**）。
 * 装配轴决定「装配多少层数据」（产出 JSON），本轴决定「输出几章多少字」（产出 markdown）。
 */
export const REPORT_VIEW_DEPTHS = ['one_pager', 'detailed'] as const;

/** 呈现粒度（由 `REPORT_VIEW_DEPTHS` 派生——取值域唯一事实源）。 */
export type ReportViewDepth = (typeof REPORT_VIEW_DEPTHS)[number];

/** 浅层默认（3-1 是一页纸作为默认层；非法/缺席一律回退到本值）。 */
export const DEFAULT_REPORT_VIEW_DEPTH: ReportViewDepth = 'one_pager';

/**
 * 呈现轴 → 一页纸渲染深度（**唯一映射点**；决定页头 Top-N 全集宽度）。
 *
 * 说明：`detailed` 方向映射到 `'flywheel'` 仅为让详版页头的 Top-N 更全，
 * **不额外接线**（detailed 的正文由 `renderDetailedReport` 产出，不经一页纸渲染器）。
 */
export const VIEW_TO_ONEPAGER_DEPTH: Readonly<Record<ReportViewDepth, 'ceo' | 'flywheel'>> = {
  one_pager: 'ceo',
  detailed: 'flywheel',
};

/**
 * 详细报告章节标题（字面固定）。
 *
 * 归属（§4.5 Q7 子裁定 (i)）：本常量**定义在 L2、唯一消费者 = 同层
 * `src/agent/report-assembler.ts`**（装配 `chapters[].title` 时使用）。
 * `src/l3/report-templates.ts` **不依赖本常量**——章节标题随 `chapters[].title` 数据进 L3
 * （模板只做哑渲染），故本模块不产生 L3→L2 反向依赖（避免 L2↔L3 模块图成环）。
 * 漂移由 `tests/agent/report-depth.test.ts` 单测守护。
 */
export const DETAILED_REPORT_CHAPTER_TITLES = [
  '### 结论',
  '### 根因',
  '### 专家完整推理',
  '### 行动建议',
  '### 数据时点',
] as const;

// ═══ 深度规范化 ═══

/**
 * 规范化任意入参为呈现深度。
 *
 * 契约（铁律 47）:
 *   @input  — value: unknown（HTTP `?depth=` / 配置值 / 任意来源，不信任）
 *   @output — 'one_pager' | 'detailed' | undefined（undefined = 非法或非字符串；
 *             调用方据此回退默认 + 记降级，不静默）
 *   @degraded — 不降级（纯判定；判定失败以 undefined 表达，降级表达归调用方：
 *               log.warn + 回退默认 + 响应头 X-Report-Depth-Degraded，铁律 24/31）
 *   确定性：同输入同输出；零 I/O；零时刻。
 */
export function normalizeReportViewDepth(value: unknown): ReportViewDepth | undefined {
  if (typeof value !== 'string') return undefined;
  for (const depth of REPORT_VIEW_DEPTHS) {
    if (depth === value) return depth;
  }
  return undefined;
}

// ═══ 对话话语 → 呈现深度（3-3 判别链）═══

/** 要求「更细」的词（指向 detailed）。 */
const DETAILED_UTTERANCE_KEYWORDS = [
  '讲细一点',
  '再详细一点',
  '详细',
  '细一点',
  '展开',
  '深一点',
  '再深',
  '完整报告',
  '全量',
] as const;

/** 要求「更浅」的词（指向 one_pager）。 */
const ONE_PAGER_UTTERANCE_KEYWORDS = [
  '说人话',
  '一句话',
  '概览',
  '简单说',
  '太长了',
  '看不懂',
  '简短',
  '总结一下',
] as const;

interface UtteranceKeywordEntry {
  readonly keyword: string;
  readonly depth: ReportViewDepth;
}

/**
 * 词表排序比较器：(长度 desc, 码点字典序 asc)。
 *
 * 字典序取**码点比较**（非 `localeCompare`）——后者随宿主 locale 变化，
 * 会破坏「同输入同输出」的确定性契约。
 */
function compareUtteranceEntries(a: UtteranceKeywordEntry, b: UtteranceKeywordEntry): number {
  if (a.keyword.length !== b.keyword.length) return b.keyword.length - a.keyword.length;
  if (a.keyword === b.keyword) return 0;
  return a.keyword < b.keyword ? -1 : 1;
}

/**
 * 判别词表（**单源**）——两方向合并后按 (长度 desc, 字典序 asc) 排序。
 * 合并排序而非分方向判别，是「最长匹配优先」的实现前提：
 * 逐条 `includes`、首个命中即判定，故 `讲细一点`（4 字）先于 `细一点`（3 字）命中 detailed。
 */
const UTTERANCE_KEYWORD_TABLE: readonly UtteranceKeywordEntry[] = [
  ...DETAILED_UTTERANCE_KEYWORDS.map((keyword): UtteranceKeywordEntry => ({ keyword, depth: 'detailed' })),
  ...ONE_PAGER_UTTERANCE_KEYWORDS.map((keyword): UtteranceKeywordEntry => ({ keyword, depth: 'one_pager' })),
].sort(compareUtteranceEntries);

/**
 * 对话话语 → 呈现深度（3-3 判别链；**确定性关键词表，禁 LLM 判意图**）。
 *
 * 契约（铁律 47）:
 *   @input  — text: unknown（用户消息原文，不信任）
 *   @output — { depth: ReportViewDepth; matched: true; keyword: string }
 *             | { depth: ReportViewDepth; matched: false }
 *             （未命中返回默认值 + matched:false —— 调用方据此**不切换**，零行为变化，
 *               不静默改写；日志侧由调用方记 log.debug）
 *   @degraded — 不降级（纯判别）；非字符串/空串 → matched:false（调用方零行为变化）
 *   判定规则：词表按 (长度 desc, 字典序 asc) 排序后逐条 includes，**首个命中即返回**（最长匹配优先）。
 *   确定性：同输入同输出；零 I/O；零随机；零时刻。
 */
export function resolveViewDepthFromUtterance(
  text: unknown,
): { depth: ReportViewDepth; matched: true; keyword: string } | { depth: ReportViewDepth; matched: false } {
  if (typeof text !== 'string' || text === '') {
    return { depth: DEFAULT_REPORT_VIEW_DEPTH, matched: false };
  }
  for (const entry of UTTERANCE_KEYWORD_TABLE) {
    if (text.includes(entry.keyword)) {
      return { depth: entry.depth, matched: true, keyword: entry.keyword };
    }
  }
  return { depth: DEFAULT_REPORT_VIEW_DEPTH, matched: false };
}
