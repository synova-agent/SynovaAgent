/**
 * report-assembler.ts — 四层报告组装器 + Tone后处理 + 一页纸渲染 (L2 → D57/D480)
 *
 * 将诊断结果按颗粒度切片:
 *   ceo: 瓶颈在哪 + 行动建议 (≤200字)
 *   flywheel: 三飞轮评分 + 瓶颈哨兵列表
 *   expert: 每位专家完整推理
 *   raw: 完整数据
 *
 * D57: return前调用 toneEnforcer.enforceReport(summary) 做散文化后处理。
 * D480: renderOnePager 消费 l3/report-templates 的 executive_summary 模板，
 *       输出老板可读的 markdown 一页纸（GS-08 报告可读）。
 *
 * 铁律24: catch + log + degraded
 */
import { createLogger } from '@synova/logger';
import type { DiagnosisReport } from '../l3/synova-diagnosis-engine';
import { getReportTemplateRegistry, type ReportData } from '../l3/report-templates';
import { enforceReport } from '../l3/tone-enforcer';
import {
  auditConclusionCoverage,
  buildReportPointer,
  collectSlotLines,
  stripPointers,
  DEGRADED_MARK,
  ONEPAGER_SLOT_TITLES,
  type PointerResolver,
} from './report-onepager-trace';
// D1051 W3: 呈现轴（L2 同层——`ReportDepth` 本就定义于本文件 `:31`，映射表零跨层边）
import {
  DETAILED_REPORT_CHAPTER_TITLES,
  VIEW_TO_ONEPAGER_DEPTH,
  type ReportViewDepth,
} from './report-depth';

const log = createLogger('agent/report-assembler');

export type ReportDepth = 'ceo' | 'flywheel' | 'expert' | 'raw';

export interface AssembledReport {
  reportId: string;
  teamId: string;
  depth: ReportDepth;
  summary: string;
  data: Record<string, unknown>;
}

/** CEO 摘要: 瓶颈 + 一个行动建议 */
function assembleCeo(report: DiagnosisReport): string {
  if (report.rootCauses.length === 0) return '诊断完成，未发现显著瓶颈。';

  const top = report.rootCauses[0];
  const rec = report.recommendations[0];
  let summary = `核心瓶颈: ${top.description}`;
  if (rec) summary += `。建议: ${rec.action}`;
  if (summary.length > 200) summary = summary.slice(0, 197) + '...';
  return summary;
}

/** 飞轮仪表盘: 维度评分 + 瓶颈 */
function assembleFlywheel(report: DiagnosisReport): Record<string, unknown> {
  const byExpert = new Map<string, number>();
  for (const er of report.expertReports) {
    byExpert.set(er.expert, er.confidence);
  }
  return {
    dimensions: Object.fromEntries(byExpert),
    rootCauses: report.rootCauses.map(rc => rc.description),
    recommendations: report.recommendations.map(r => r.action),
  };
}

/** 专家完整推理 */
function assembleExpert(report: DiagnosisReport): Record<string, unknown> {
  return {
    expertReports: report.expertReports,
    rootCauses: report.rootCauses,
    recommendations: report.recommendations,
  };
}

/** 原始完整数据 — D49: 注入系统健康审计 */
function assembleRaw(report: DiagnosisReport): Record<string, unknown> {
  const data = report as unknown as Record<string, unknown>;
  // D49: 异步注入 systemHealth (失败不阻断主报告)
  injectSystemHealth(data).catch((err: unknown) => {
    log.warn({ err }, 'systemHealth 注入失败');
  });
  return data;
}

/**
 * D49: 注入系统健康审计数据到 raw 报告。
 * 使用 SystemHealthAudit 收集 7 项指标。
 */
async function injectSystemHealth(data: Record<string, unknown>): Promise<void> {
  try {
    const { SystemHealthAudit } = await import('../monitoring/system-health');
    const auditor = new SystemHealthAudit();
    const healthReport = await auditor.audit();
    data.systemHealth = healthReport;
    log.debug({ available: !!healthReport.uptime30d }, '系统健康审计注入完成');
  } catch (err: unknown) {
    log.warn({ err }, '系统健康审计注入失败 — degraded');
    data.systemHealth = {
      error: '审计不可用',
      collectedAt: new Date().toISOString(),
    };
  }
}

/**
 * 按指定深度组装报告。
 * T11: 新增 mode:'preliminary' 用于无数据预诊断模式。
 */
export function assembleReport(
  report: DiagnosisReport,
  depth: ReportDepth = 'flywheel',
  _layers?: string[],
  _mode?: 'standard' | 'preliminary',
): AssembledReport {
  const isPreliminary = _mode === 'preliminary';
  let summary: string;
  let data: Record<string, unknown>;

  try {
    switch (depth) {
      case 'ceo':
        summary = assembleCeo(report);
        if (isPreliminary) {
          summary = '【预诊断】此诊断为基于访谈数据的初步判断，部署后将基于真实数据进行精确诊断。\n\n' + summary;
        }
        data = { rootCause: report.rootCauses[0] || null };
        if (isPreliminary) {
          (data as Record<string, unknown>).dataSource = 'interview';
          (data as Record<string, unknown>).diagnosisType = 'preliminary';
        }
        break;
      case 'flywheel':
        summary = isPreliminary
          ? '【预诊断】此诊断为基于访谈数据的初步判断。' + (report.summary || '')
          : report.summary;
        data = assembleFlywheel(report);
        if (isPreliminary) {
          (data as Record<string, unknown>).dataSource = 'interview';
          (data as Record<string, unknown>).diagnosisType = 'preliminary';
        }
        break;
      case 'expert':
        summary = report.summary;
        data = assembleExpert(report);
        break;
      case 'raw':
      default:
        summary = report.summary;
        data = assembleRaw(report);
        break;
    }
  } catch (err: unknown) {
    log.warn({ err }, '报告组装失败 — degraded');
    summary = report.summary || '诊断完成';
    data = {};
  }

  // D57: Tone后处理 — 散文化
  const enforced = enforceReport(summary);
  summary = enforced.text;
  if (data.expertReports && Array.isArray(data.expertReports)) {
    data.expertReports = data.expertReports.map((er: Record<string, unknown>) => ({
      ...er,
      report: typeof er.report === 'string' ? enforceReport(er.report).text : er.report,
    }));
  }

  return {
    reportId: report.reportId,
    teamId: report.teamId,
    depth,
    summary,
    data,
  };
}

// ═══ D480: 一页纸渲染（GS-08 报告可读） ═══

/** executive_summary 模板名（report-templates.ts L116-139，本函数是其首个消费者） */
const ONE_PAGER_TEMPLATE = 'executive_summary';

/** 根因置信度达到该阈值映射为 high 告警（驱动模板「N 个高风险项」头行） */
const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/** D791 S4 行动建议条数上限（一页纸注意力预算，与 Top 3 对称；模板侧同步二次裁剪） */
const S4_ACTION_LIMIT = 3;

/** ceo 深度取 top2 根因（极简），flywheel 深度取 top5（全量） */
function onePagerAlertLimit(depth: 'ceo' | 'flywheel'): number {
  return depth === 'ceo' ? 2 : 5;
}

/**
 * D480: unknown 值收窄为 string[]（类型谓词，零 as 断言——铁律 38）。
 * assembleFlywheel 返回 Record<string, unknown>，recommendations 属性类型侧不保证，
 * 运行时由 assembleFlywheel 实现为 string[]（map(r => r.action)），此处防御性收窄。
 */
function toStringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * D791: unknown → string（非字符串 → 空串）。
 * 用于报告字段的防御性收窄（checkpoint 归档的 report 来自 JSON，不盲信运行时形状；
 * 铁律 38：用 unknown + 收窄，不用 `as any`）。
 */
function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * D791: 一页纸可选入参（第 3 参数——全可选，向后兼容 D480 两参调用）。
 * 内容由 L1（routes/diagnosis）装配，L2 只做映射与指针构造，**不取数据**。
 */
export interface OnePagerInputs {
  /** S3 各维度循环结论条目正文（`buildCycleConclusions().lines[].text`，每条自带 `[src:cycle:...]`） */
  cycleConclusions?: string[];
  /** S2 关键证据条目正文（哨兵 finding 摘要 + `[src:finding:...]`） */
  evidenceHighlights?: string[];
}

/**
 * D480: DiagnosisReport → ReportData 映射。
 *
 * 契约:
 *   @input report DiagnosisReport + depth（'ceo' | 'flywheel'）+ inputs（D791 可选槽位入参）
 *   @output ReportData（executive_summary 模板入参）
 *   @degraded 无 I/O 纯映射，不降级（异常由 renderOnePager whole-body catch 兜底）
 *
 * 映射说明:
 *   - goals/obstacles 恒空数组——诊断报告无目标进度/遗留问题数据，诚实空缺不编造
 *     （模板 footer 相应显示「0 目标」）。
 *   - alerts ← rootCauses 按置信度降序（clone 后 sort，不污染调用方报告），
 *     confidence >= 0.7 → 'high'。
 *   - recommendations: ceo → [assembleCeo(report)]（≤200 字瓶颈+建议单条）；
 *     flywheel → assembleFlywheel(report).recommendations 前 3 条（全量建议）。
 *   - D791 S1：结论行正文 = recommendations[0]（同上深度语义，既有字段零新造）；
 *     指针 `[src:report:<reportId>#summary]` 恒产出（reportId 缺失 → 空指针，由覆盖审计留痕）。
 *   - D791 S4：行动建议 ← 既有 report.recommendations[]（priority+expert+action），
 *     指针 `[src:report:<reportId>#recommendation:<i>]`（index 对齐 report.recommendations 下标）。
 *   - D791 S2/S3：来自 inputs（L1 装配）；inputs 缺席 → 字段不设置 → 模板渲染 `[degraded]` 诚实说明
 *     （不静默省略槽位，规范 §5.2 R2）。
 */
function toOnePagerData(
  report: DiagnosisReport,
  depth: 'ceo' | 'flywheel',
  inputs?: OnePagerInputs,
): ReportData {
  const sorted = [...report.rootCauses].sort((a, b) => b.confidence - a.confidence);
  const alerts = sorted.slice(0, onePagerAlertLimit(depth)).map(rc => ({
    description: rc.description,
    priority: rc.confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'medium',
    confidence: rc.confidence,
  }));
  const recommendations = depth === 'ceo'
    ? [assembleCeo(report)]
    : toStringItems(assembleFlywheel(report).recommendations).slice(0, 3);

  const reportId = typeof report.reportId === 'string' ? report.reportId : '';
  const conclusionPointer = reportId === ''
    ? ''
    : buildReportPointer('report', `${reportId}#summary`);

  // S4 行动建议 = 既有 report.recommendations[]（index 与数组下标对齐——指针可回查）
  const actionItems = report.recommendations.slice(0, S4_ACTION_LIMIT).map((rec, i) => {
    const meta: string[] = [];
    const priority = toStringOrEmpty(rec.priority);
    const expert = toStringOrEmpty(rec.expert);
    if (priority !== '') meta.push(`优先级 ${priority}`);
    if (expert !== '') meta.push(expert);
    const head = toStringOrEmpty(rec.action);
    const metaPart = meta.length > 0 ? `（${meta.join('｜')}）` : '';
    return `${head}${metaPart}${buildReportPointer('report', `${reportId}#recommendation:${i}`)}`;
  });

  const base: ReportData = {
    orgId: report.teamId,
    date: report.generatedAt,
    goals: [],
    alerts,
    obstacles: [],
    recommendations,
    ...(conclusionPointer === '' ? {} : { conclusionPointer }),
    actionItems,
  };
  // inputs 缺席 → 不设置字段（模板据此渲染 [degraded] 空态行，而非静默省略槽位）
  if (inputs && Array.isArray(inputs.evidenceHighlights)) {
    base.keyEvidence = inputs.evidenceHighlights;
  }
  if (inputs && Array.isArray(inputs.cycleConclusions)) {
    base.cycleConclusions = inputs.cycleConclusions;
  }
  return base;
}

/**
 * D480: 一页纸降级文案——纯文本组装，含「降级」标记（铁律 24+31 降级信号传播）。
 */
function onePagerFallback(report: DiagnosisReport, depth: 'ceo' | 'flywheel'): string {
  const lines = [`# ${report.teamId} 诊断摘要（降级：模板渲染失败，纯文本输出）`, ''];
  lines.push(depth === 'ceo' ? assembleCeo(report) : (report.summary || '诊断完成'));
  if (depth === 'flywheel') {
    for (const r of report.recommendations.slice(0, 3)) lines.push(`- 建议: ${r.action}`);
  }
  return lines.join('\n');
}

/**
 * D480/D791: 渲染诊断报告一页纸（markdown）——消费 executive_summary 模板（GS-08 报告可读）。
 *
 * 契约:
 *   @input report DiagnosisReport；depth 'ceo'（top2 根因 + CEO 摘要单条，默认）
 *                | 'flywheel'（top5 根因 + 全量建议 top3）；
 *                inputs（D791 第 3 参，全可选）——S3 循环结论 / S2 关键证据条目正文。
 *                缺席 → 对应槽位渲染 `[degraded]` 诚实说明（不静默省略，规范 §5.2 R2）。
 *   @output markdown 字符串（结论先行四槽位 `### 结论` / `### 关键证据` /
 *                `### 各维度循环结论` / `### 行动建议` + 既有 `## 头行` + `**Top 3:**` + 📎 footer；
 *                每个条目行带可解析溯源指针 `[src:<kind>:<ref>]`）
 *   @degraded ① registry 抛错/不可用，或 registry.render 返回降级标记串
 *                （「模板渲染失败」/「未找到模板」前缀——模板文案后续修改可能引入
 *                运行时异常，registry 吞错返回标记串，此路兜底）
 *                → log.warn + onePagerFallback 纯文本（含「降级」标记）
 *             ② inputs 缺席（槽位空态行，见上）
 *             ③ 渲染成功但覆盖审计发现条目行缺指针 → log.warn（不改变输出；GS-08 断言把关）
 *   本函数永不抛出（whole-body catch——路由 GET 按需渲染路径依赖此契约）。
 *   确定性：输出**禁含渲染时刻**（同输入 → 字节级同输出，幂等重跑前提）。
 *   注：不走 tone-enforcer——一页纸是结构化 markdown 非散文（D57 只作用于 assembleReport）。
 */
export function renderOnePager(
  report: DiagnosisReport,
  depth: 'ceo' | 'flywheel' = 'ceo',
  inputs?: OnePagerInputs,
): string {
  try {
    const rendered = getReportTemplateRegistry().render(
      ONE_PAGER_TEMPLATE,
      toOnePagerData(report, depth, inputs),
    );
    if (rendered.startsWith('模板渲染失败') || rendered.startsWith('未找到模板')) {
      log.warn({ template: ONE_PAGER_TEMPLATE, depth }, '一页纸模板渲染降级返回 — fallback 纯文本');
      return onePagerFallback(report, depth);
    }
    // D791: 指针覆盖审计（R1 条条带指针）——只告警不改写输出（机器判定在 GS-08 断言 6）
    const coverage = auditConclusionCoverage(rendered);
    if (coverage.degraded || coverage.missingPointerLines > 0) {
      log.warn(
        { depth, ...coverage },
        '一页纸结论行溯源指针覆盖不足 — degraded（R1 违规，覆盖审计留痕，铁律 24/31）',
      );
    }
    return rendered;
  } catch (err: unknown) {
    log.warn({ err, depth }, '一页纸渲染失败 — degraded（纯文本降级）');
    return onePagerFallback(report, depth);
  }
}

// ═══ D791: S2 关键证据构造 + 一页纸可读性审计 ═══

/** 哨兵 finding 消费面（`getSentinelExpertReports().reports[]` 元素的结构子集） */
export interface SentinelFindingLike {
  sentinelId: string;
  summary: string;
  confidence: number;
  checkedAt: string;
}

/** S2 条数上限（一页纸注意力预算，与 Top 3 对称；模板侧同步二次裁剪） */
export const EVIDENCE_HIGHLIGHT_LIMIT = 3;

/**
 * D791 S2: 关键证据条目正文构造（finding 摘要 + 置信度 + 溯源指针）。
 * 时间由指针 `@<checkedAt>` 承载（零重复，宽度预算友好）。
 *
 * 契约:
 *   @input  reports 哨兵专家报告数组（结构子集；非数组 → 空结果）；limit 条数上限
 *   @output string[]（条目**正文**，不含 `- ` 前缀；每条自带 `[src:finding:<sentinelId>@<checkedAt>]`）
 *   @degraded 元素字段缺失（摘要/哨兵 id/时间任一为空）→ 跳过该条 + log.warn（不编造）；
 *             全部被跳过/空数组 → 空结果（模板渲染 `[degraded]` 空态行，不静默省略槽位）
 */
export function buildEvidenceHighlights(reports: unknown, limit: number = EVIDENCE_HIGHLIGHT_LIMIT): string[] {
  if (!Array.isArray(reports) || limit <= 0) return [];
  const out: string[] = [];
  for (const raw of reports) {
    if (out.length >= limit) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as { sentinelId?: unknown; summary?: unknown; confidence?: unknown; checkedAt?: unknown };
    const summary = toStringOrEmpty(rec.summary).trim();
    const sentinelId = toStringOrEmpty(rec.sentinelId).trim();
    const checkedAt = toStringOrEmpty(rec.checkedAt).trim();
    if (summary === '' || sentinelId === '' || checkedAt === '') {
      log.warn({ sentinelId }, 'finding 记录字段缺失 — 跳过该条证据（不编造，degraded）');
      continue;
    }
    const confidence = typeof rec.confidence === 'number' && Number.isFinite(rec.confidence)
      ? `（置信度 ${rec.confidence}）`
      : '';
    out.push(`${summary}${confidence}${buildReportPointer('finding', `${sentinelId}@${checkedAt}`)}`);
  }
  return out;
}

/** 一页纸可读性约束阈值（spec §5.2；budget = 去空白字符数上限） */
export const ONEPAGER_CHAR_BUDGET = 1200;
export const ONEPAGER_CONCLUSION_MAX_CHARS = 200;
export const ONEPAGER_MAX_LINE_CHARS = 60;

export interface OnePagerReadability {
  /** 去空白字符数 */
  charCount: number;
  /** S2/S3/S4 条目行的**人类可见宽度**最大值（已剥离 `[src:…]` 指针） */
  maxLineChars: number;
  /** S1 结论行的**人类可见宽度**（剥离指针后） */
  conclusionChars: number;
  slotCount: number;
  slotsOk: boolean;
  budgetOk: boolean;
  conclusionCharsOk: boolean;
  maxLineOk: boolean;
  degraded: boolean;
  reason?: string;
}

/**
 * 一页纸可读性审计（机器可判的三约束 + 槽位齐备）。
 *
 * 契约:
 *   @input  markdown 一页纸全文（非字符串 → 全 false + degraded + reason）
 *   @output OnePagerReadability
 *   @degraded 输入非字符串 → degraded:true + 全布尔 false（不抛；绝不 fail-open 判通过）
 *
 * 口径（spec §5.2 的**两条独立约束**——已消解原表同列歧义，见 spec §5.2 回填）:
 *   conclusionChars / conclusionCharsOk —— S1 结论行 ≤ 200 字符（沿用 D480 assembleCeo 既有上限）；
 *   maxLineChars / maxLineOk            —— S2/S3/S4 条目行 ≤ 60 字符（移动端窄屏不折行）。
 *   S1 不参与 maxLineChars：其自身约束即 200 字符（原表两行必为互斥作用域，否则 200 行是死条文）。
 *   宽度均**剥离 `[src:…]` 指针后**计量——指针是审计元数据（单条 30-55 字符），非老板阅读面；
 *   计入则 60 字符约束在spec 自定的行文案格式下数学上不可满足（实测 ≥67，见 spec §5.2 回填）。
 */
export function auditOnePagerReadability(markdown: unknown): OnePagerReadability {
  if (typeof markdown !== 'string') {
    return {
      charCount: 0,
      maxLineChars: 0,
      conclusionChars: 0,
      slotCount: 0,
      slotsOk: false,
      budgetOk: false,
      conclusionCharsOk: false,
      maxLineOk: false,
      degraded: true,
      reason: 'input-not-string',
    };
  }

  const charCount = markdown.replace(/\s+/g, '').length;
  const lines = markdown.split(/\r?\n/).map(l => l.trim());
  const slotCount = ONEPAGER_SLOT_TITLES.filter(title => lines.includes(title)).length;

  const slotLines = collectSlotLines(markdown);
  const conclusionWidths = slotLines
    .filter(line => line.slot === ONEPAGER_SLOT_TITLES[0] && !line.isDegraded)
    .map(line => stripPointers(line.text).length);
  const itemWidths = slotLines
    .filter(line => line.slot !== ONEPAGER_SLOT_TITLES[0])
    .map(line => stripPointers(line.text).length);

  const conclusionChars = conclusionWidths.length > 0 ? Math.max(...conclusionWidths) : 0;
  const maxLineChars = itemWidths.length > 0 ? Math.max(...itemWidths) : 0;

  return {
    charCount,
    maxLineChars,
    conclusionChars,
    slotCount,
    slotsOk: slotCount === ONEPAGER_SLOT_TITLES.length,
    budgetOk: charCount <= ONEPAGER_CHAR_BUDGET,
    conclusionCharsOk: conclusionChars > 0 && conclusionChars <= ONEPAGER_CONCLUSION_MAX_CHARS,
    maxLineOk: maxLineChars > 0 && maxLineChars <= ONEPAGER_MAX_LINE_CHARS,
    degraded: false,
  };
}

/**
 * D791: 一页纸 inputs 组装——「**空即缺席**」规则的单源实现。
 *
 * 契约:
 *   @input  findingReports: unknown（`getSentinelExpertReports().reports` 原样，未信任）；
 *           cycleLines: readonly unknown[]（`buildCycleConclusions().lines[].text`）
 *   @output OnePagerInputs —— 字段**仅在非空时设置**
 *   @degraded 来源为空/非法 → 对应字段缺席 → 模板渲染「入参缺席」空态行（与"有源但为空"语义不同，
 *             两者都是显式 [degraded]，绝不静默省略槽位）
 *
 * Why 单源: L1（routes/diagnosis 的 inputs 装配）与 GS-08 场景驱动必须产出**同一形状**的 inputs，
 * 否则"生产 HTTP 产物 ≡ 本地同输入渲染"的端到端等价性断言失真（D791 实测：空数组会让 S2 走
 * "无 finding 记录"文案而非"inputs 缺席"文案，5 字符差）。
 */
export function assembleOnePagerInputs(
  findingReports: unknown,
  cycleLines: readonly unknown[],
): OnePagerInputs {
  const inputs: OnePagerInputs = {};
  const highlights = buildEvidenceHighlights(findingReports);
  if (highlights.length > 0) inputs.evidenceHighlights = highlights;
  const conclusions = toStringItems(cycleLines);
  if (conclusions.length > 0) inputs.cycleConclusions = conclusions;
  return inputs;
}

/**
 * D791: finding 指针解析器工厂（`resolvePointers` 注入用——S2 指针的外部可溯源判据）。
 *
 * 契约:
 *   @input  reports 哨兵专家报告数组（结构子集；非数组 → null）
 *   @output PointerResolver | null —— `ref === '<sentinelId>@<checkedAt>'` 存在则 true；
 *           非数组（无法判定基准）→ **null**（调用方据此不下发该 kind 解析器 → 指针计 unknown，
 *           "判不了" ≠ "判过了"，铁律 24/31）
 *   @degraded reports 非数组 → null + log.warn
 */
export function buildFindingPointerResolver(reports: unknown): PointerResolver | null {
  if (!Array.isArray(reports)) {
    log.warn('finding 报告源非数组 — 不下发 finding 解析器（该 kind 计 unknown，不 fail-open）');
    return null;
  }
  const keys = new Set<string>();
  for (const raw of reports) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as { sentinelId?: unknown; checkedAt?: unknown };
    const sentinelId = toStringOrEmpty(rec.sentinelId).trim();
    const checkedAt = toStringOrEmpty(rec.checkedAt).trim();
    if (sentinelId !== '' && checkedAt !== '') keys.add(`${sentinelId}@${checkedAt}`);
  }
  return (_kind, ref) => keys.has(ref);
}

// ═══ D1051 W3: 详细报告（3-2）+ 呈现轴分发器（3-3）+ 装配映射 ═══

/** 详细报告模板名（注册在 `src/l3/report-templates.ts` 的第 4 个模板） */
const DETAILED_REPORT_TEMPLATE = 'detailed_report';

/**
 * 装配轴映射表唯一落点（`ReportDepth` 定义于本文件 `:31`——与 W1 同层取值，**零跨层边**）。
 * 呈现轴（几章多少字）与装配轴（装配多少层数据）正交，本表是两者唯一的转换点。
 */
export const VIEW_TO_ASSEMBLE_DEPTH: Readonly<Record<ReportViewDepth, ReportDepth>> = {
  one_pager: 'ceo',
  detailed: 'expert',
};

/**
 * D1051 W3: 完整诊断报告形状守卫（渲染边界自查——checkpoint 归档的 report 可能来自
 * JSON 反序列化，不盲信形状，铁律 38）。数组项内部字段交由渲染器 whole-body catch 兜底。
 *
 * 契约（铁律 47）:
 *   @input  — v: unknown（任意来源，不信任）
 *   @output — 类型谓词；true = 可安全交给 renderReportView 渲染
 *   @degraded — false（形状不符）→ 调用方转译为诚实降级文案/404，不伪造章节
 */
export function isRenderableDiagnosisReport(v: unknown): v is DiagnosisReport {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.reportId === 'string' &&
    typeof o.teamId === 'string' &&
    typeof o.generatedAt === 'string' &&
    typeof o.summary === 'string' &&
    Array.isArray(o.expertReports) &&
    Array.isArray(o.rootCauses) &&
    Array.isArray(o.recommendations) &&
    typeof o.raw === 'object' && o.raw !== null
  );
}

/** reportId 缺失 → 空串（指针省略，不伪造——`conclusionPointer` 同源先例）。 */
function detailedPointer(reportId: string, fragment: string): string {
  return reportId === '' ? '' : buildReportPointer('report', `${reportId}#${fragment}`);
}

/**
 * D1051: DiagnosisReport → 详细报告 ReportData 映射（**章节数据源 100% 既有字段**，
 * 零新指标 / 零新窗口 / 零新比率）。
 *
 * 契约（铁律 47）:
 *   @input  — report: DiagnosisReport
 *   @output — ReportData（`chapters` 承载五章，标题取自 `DETAILED_REPORT_CHAPTER_TITLES` 单源；
 *             `extra.reportId` 供模板尾行；其余必填字段给中性空值——本模板不消费它们）
 *   @degraded — 无 I/O 纯映射（单章数据缺失 → 该章 `body` 写入 `[degraded]` 说明行，不静默，
 *               铁律 24/31）；异常由 renderDetailedReport whole-body catch 兜底
 */
function toDetailedReportData(report: DiagnosisReport): ReportData {
  const reportId = typeof report.reportId === 'string' ? report.reportId : '';
  const titles = DETAILED_REPORT_CHAPTER_TITLES;

  const chapters: Array<{ title: string; body: string[] }> = [];

  // ── 章 1: 结论（report.summary，经 enforceReport 散文化——与一页纸 S1 语义对齐：结论可溯源）──
  const summaryText = enforceReport(toStringOrEmpty(report.summary)).text;
  chapters.push({
    title: titles[0],
    body: summaryText.trim() === ''
      ? [`${DEGRADED_MARK} 无结论内容可溯源`]
      : [`${summaryText}${detailedPointer(reportId, 'summary')}`],
  });

  // ── 章 2: 根因（**降序全量**，非 Top-N——这是「详细」的判别点）──
  const rootCauses = [...report.rootCauses].sort((a, b) => b.confidence - a.confidence);
  const rootLines: string[] = [];
  rootCauses.forEach((rc, i) => {
    const description = toStringOrEmpty(rc.description).trim();
    if (description === '') return;
    rootLines.push(`${description}（维度 ${toStringOrEmpty(rc.dimension)}，置信度 ${rc.confidence}）${detailedPointer(reportId, `rootcause:${i}`)}`);
  });
  chapters.push({
    title: titles[1],
    body: rootLines.length === 0 ? [`${DEGRADED_MARK} 无根因记录`] : rootLines,
  });

  // ── 章 3: 专家完整推理（expert + 全部 findings + confidence）──
  const expertLines: string[] = [];
  report.expertReports.forEach((er, i) => {
    const expert = toStringOrEmpty(er.expert).trim();
    const findings = Array.isArray(er.findings) ? er.findings.map(f => toStringOrEmpty(f)).filter(f => f.trim() !== '') : [];
    const head = expert === '' ? '（未署名专家）' : expert;
    const body = findings.length === 0 ? '无 finding 记录' : findings.join('；');
    expertLines.push(`${head}（置信度 ${er.confidence}）：${body}${detailedPointer(reportId, `expert:${i}`)}`);
  });
  chapters.push({
    title: titles[2],
    body: expertLines.length === 0 ? [`${DEGRADED_MARK} 无专家报告记录`] : expertLines,
  });

  // ── 章 4: 行动建议（**全量**，含 priority / expert）──
  const actionLines: string[] = [];
  report.recommendations.forEach((rec, i) => {
    const action = toStringOrEmpty(rec.action).trim();
    if (action === '') return;
    const meta: string[] = [];
    const priority = toStringOrEmpty(rec.priority);
    const expert = toStringOrEmpty(rec.expert);
    if (priority !== '') meta.push(`优先级 ${priority}`);
    if (expert !== '') meta.push(expert);
    const metaPart = meta.length > 0 ? `（${meta.join('｜')}）` : '';
    actionLines.push(`${action}${metaPart}${detailedPointer(reportId, `recommendation:${i}`)}`);
  });
  chapters.push({
    title: titles[3],
    body: actionLines.length === 0 ? [`${DEGRADED_MARK} 无行动建议记录`] : actionLines,
  });

  // ── 章 5: 数据时点（`generatedAt` **逐字透传**——不解析、不换算、不主张 3-9 时间窗口径）──
  const generatedAt = toStringOrEmpty(report.generatedAt).trim();
  chapters.push({
    title: titles[4],
    body: generatedAt === ''
      ? [`${DEGRADED_MARK} 报告缺数据时点`]
      : [
          `报告数据时点：${generatedAt}`,
          '本行为既有字段透传，不主张 3-9 时间窗口径（周/月聚合视图归 D828）。',
        ],
  });

  return {
    orgId: toStringOrEmpty(report.teamId),
    date: generatedAt,
    goals: [],
    alerts: [],
    obstacles: [],
    recommendations: [],
    extra: { reportId },
    chapters,
  };
}

/**
 * 详细报告条目行缺指针计数（§5.3 ③ 留痕用——只 `log.warn`，不改写输出）。
 *
 * 口径：末章「数据时点」按设计**不带指针**（既有字段透传），不参与计数；
 * `[degraded]` 空态行是降级说明而非条目，亦不参与。
 *
 * @input markdown 渲染产物；pointerlessChapterTitle 免检章标题（由装配产物的末章标题传入，
 *        不在此处重复引用章节标题常量——保证本函数对章序变化免疫）
 * @output 缺指针条目行数（0 = 全覆盖）
 */
function countPointerlessItemLines(markdown: string, pointerlessChapterTitle: string): number {
  let missing = 0;
  let inPointerlessChapter = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('### ')) {
      inPointerlessChapter = line === pointerlessChapterTitle;
      continue;
    }
    if (inPointerlessChapter) continue;
    if (!line.startsWith('- ')) continue;
    if (line.includes(DEGRADED_MARK)) continue;
    if (!line.includes('[src:')) missing += 1;
  }
  return missing;
}

/**
 * D1051: 详细报告纯文本降级文案（含「降级」标记——铁律 24/31 降级信号传播）。
 * 与 `onePagerFallback` 同构；**不伪造章节**（诚实说明模板不可用）。
 */
function detailedReportFallback(report: DiagnosisReport): string {
  const lines = [`# ${report.teamId} 诊断详细报告（降级：模板渲染失败，纯文本输出）`, ''];
  lines.push(report.summary || '诊断完成');
  for (const rc of report.rootCauses.slice(0, 5)) lines.push(`- 根因: ${rc.description}`);
  for (const rec of report.recommendations.slice(0, 5)) lines.push(`- 建议: ${rec.action}`);
  return lines.join('\n');
}

/**
 * D1051: 渲染详细报告（完整诊断各章节，markdown）。
 *
 * 契约（铁律 47）:
 *   @input  — report: DiagnosisReport（完整引擎形状；调用方须先经 isRenderableDiagnosisReport 窄化）
 *   @output — markdown 字符串（`## <teamId> 诊断详细报告` 头行 + `DETAILED_REPORT_CHAPTER_TITLES`
 *             五章；每章非空或含 `[degraded]` 说明行；条目行带可解析溯源指针
 *             `[src:report:<reportId>#…]`；`📎 报告 ID: <reportId>` 尾行）
 *   @degraded — ① registry 抛错 / 返回「模板渲染失败」/「未找到模板」→ log.warn + 纯文本 fallback
 *                （含「降级」标记）
 *             ② 单章数据缺失 → 该章 `[degraded]` 说明行（其余章照常）
 *             ③ 渲染成功但条目行缺指针 → log.warn（不改写输出）
 *   本函数永不抛出（whole-body catch——路由与对话帧两处消费点依赖此契约）。
 *   确定性：输出**禁含渲染时刻**（同输入 → 字节级同输出，幂等重跑前提）。
 *   不走 tone-enforcer 于整体产物（结构化 markdown 非散文，同 renderOnePager 先例；
 *   仅章 1 的正文经 `enforceReport` 散文化，与既有 `assembleReport` 语义一致）。
 */
export function renderDetailedReport(report: DiagnosisReport): string {
  try {
    const data = toDetailedReportData(report);
    const rendered = getReportTemplateRegistry().render(DETAILED_REPORT_TEMPLATE, data);
    if (rendered.startsWith('模板渲染失败') || rendered.startsWith('未找到模板')) {
      log.warn({ template: DETAILED_REPORT_TEMPLATE }, '详细报告模板渲染降级返回 — fallback 纯文本');
      return detailedReportFallback(report);
    }
    // 末章（数据时点）按设计不带指针——免检章标题取自装配产物，对章序变化免疫
    const chapters = Array.isArray(data.chapters) ? data.chapters : [];
    const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1] : undefined;
    const missing = countPointerlessItemLines(rendered, lastChapter === undefined ? '' : lastChapter.title);
    if (missing > 0) {
      log.warn(
        { missingPointerLines: missing },
        '详细报告条目行溯源指针覆盖不足 — degraded（覆盖审计留痕，铁律 24/31）',
      );
    }
    return rendered;
  } catch (err: unknown) {
    log.warn({ err }, '详细报告渲染失败 — degraded（纯文本降级）');
    return detailedReportFallback(report);
  }
}

/**
 * D1051: 呈现深度分发器（3-2 端点 / 3-3 对话帧两入口共用——**保证两入口同深度同产物**）。
 *
 * 契约（铁律 47）:
 *   @input  — report；viewDepth: ReportViewDepth（呈现轴，非装配轴）；inputs?: OnePagerInputs
 *             （仅 `one_pager` 方向消费；`detailed` 方向忽略——详版不需要四槽位入参）
 *   @output — markdown 字符串（one_pager → renderOnePager 产物；detailed → renderDetailedReport 产物）
 *   @degraded — 透传被分发渲染器的降级语义（两渲染器均**永不抛出**）
 *   确定性：同输入同输出；分发本身零逻辑分支副作用。
 */
export function renderReportView(
  report: DiagnosisReport,
  viewDepth: ReportViewDepth,
  inputs?: OnePagerInputs,
): string {
  if (viewDepth === 'detailed') return renderDetailedReport(report);
  return renderOnePager(report, VIEW_TO_ONEPAGER_DEPTH[viewDepth], inputs);
}

/**
 * D1051: S2/S3 装配（**唯一实现**——消除 L1 两路由各自装配的重复面，F4）。
 *
 * 契约（铁律 47）:
 *   @input  — orgId: string（= 报告 teamId）；graphStore?: unknown（缺席 → S3 槽位降级）
 *   @output — Promise<OnePagerInputs>（两字段各自独立可选——缺席即模板侧 `[degraded]` 空态行）
 *   @degraded — 任一来源失败/为空 → 对应字段不设置 + log.warn（不静默、不阻断渲染，铁律 24/31）
 *
 * 分层：本函数属 L2；S2 经 L2 只读面 `getSentinelExpertReports`（模块单例，无需 req）、
 * S3 经 L2 派生服务 `buildCycleConclusions`（L1 不再直触 cycles/l4，铁律 39）。
 * 两依赖走**动态 import**：与既有 L1 装配点同款通道，且不改变本模块静态依赖图。
 */
export async function assembleOnePagerInputsForOrg(
  orgId: string,
  graphStore?: unknown,
): Promise<OnePagerInputs> {
  let findingReports: unknown = [];
  try {
    const sentinel = await import('./sentinel-service');
    findingReports = sentinel.getSentinelExpertReports().reports;
  } catch (err: unknown) {
    log.warn({ err, orgId }, '关键证据来源读取失败 — S2 槽位降级（输入缺席 → [degraded] 空态行）');
  }

  let cycleLines: string[] = [];
  try {
    const cycleService = await import('./cycle-conclusion-service');
    const conclusions = await cycleService.buildCycleConclusions(orgId, graphStore);
    cycleLines = conclusions.lines.map(line => line.text);
    if (cycleLines.length === 0) {
      log.warn({ orgId, reason: conclusions.reason }, '循环结论为空 — S3 槽位走 [degraded] 空态行');
    }
  } catch (err: unknown) {
    log.warn({ err, orgId }, '循环结论派生失败 — S3 槽位降级（输入缺席 → [degraded] 空态行）');
  }

  // 「空即缺席」规则单源在 assembleOnePagerInputs（保证「生产 HTTP 产物 ≡ 本地同输入渲染」等价）
  const inputs = assembleOnePagerInputs(findingReports, cycleLines);
  if (inputs.evidenceHighlights === undefined) {
    log.warn({ orgId }, '哨兵无 finding 记录 — S2 槽位走 [degraded] 空态行（不静默省略）');
  }
  return inputs;
}
