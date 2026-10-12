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
import { validateOutputContract } from '../output/contract-validator';
import {
  auditConclusionCoverage,
  buildReportPointer,
  collectSlotLines,
  stripPointers,
  ONEPAGER_SLOT_TITLES,
  type PointerResolver,
} from './report-onepager-trace';

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
    // K12-06（#189）: 一页纸**提交口自检** —— 产出即体检（缺字段/缺章节/缺溯源指针 ⇒
    // 点名留痕 + 落账为预设更新输入）。**只留痕，不阻断、不改写返回**：
    // 本行是"接线了 == 被执行了"的物理证据，摘掉它 tests/output/contract-validator.test.ts
    // 的「接线」用例必红。
    validateOutputContract({ text: rendered, orgId: report.teamId, generatedAt: report.generatedAt });
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
