/**
 * l3/report-templates.ts — 报告模板引擎 (Task 12)
 *
 * 简报/诊断报告的不同排版模板。可运行时注册新模板。
 * 当前提供: daily_briefing, weekly_summary, diagnosis_report, executive_summary
 */
import { createLogger } from '@synova/logger';

const log = createLogger('l3/report-templates');

// ═══ Types ═══

export interface ReportTemplate {
  name: string;
  description: string;
  /** 模板渲染函数 */
  render(data: ReportData): string;
}

export interface ReportData {
  orgId: string;
  date: string;
  goals: Array<{ name: string; progress: number; status: string; trend?: string }>;
  alerts: Array<{ description: string; priority: string; confidence: number }>;
  obstacles: Array<{ description: string; status: string }>;
  recommendations: string[];
  extra?: Record<string, unknown>;
  /**
   * D791 S1: 结论槽溯源指针（`[src:report:<reportId>#summary]`）。
   * 缺席 → 结论行不带指针（覆盖审计会把它计为 missingPointerLines，由 L2 装配保证非缺席）。
   */
  conclusionPointer?: string;
  /** D791 S2: 关键证据条目正文（不含 `- ` 前缀；每条自带 `[src:finding:...]` 指针）。 */
  keyEvidence?: string[];
  /** D791 S3: 各维度循环结论条目正文（不含 `- ` 前缀；每条自带 `[src:cycle:...]` 指针）。 */
  cycleConclusions?: string[];
  /** D791 S4: 行动建议条目正文（不含 `- ` 前缀；每条自带 `[src:report:...#recommendation:<i>]` 指针）。 */
  actionItems?: string[];
  /**
   * D1051 W2: 详细报告章节（结论 / 根因 / 专家完整推理 / 行动建议 / 数据时点）。
   *
   * **标题随数据走**（§4.5 Q7 子裁定 (i)）：`title` 与 `body` 同源，由 L2
   * （`src/agent/report-assembler.ts`）装配时一并写入；本文件（L3）只做哑渲染，
   * **不新增任何模块依赖**（不依赖 L2 的章节标题常量，避免 L3→L2 反向依赖成环）。
   * 条条 `[degraded]` 空态行由装配侧写入 `body`（本文件亦对空 `body` 兜底）。
   */
  chapters?: Array<{ title: string; body: string[] }>;
}

// ═══ Built-in Templates ═══

const DAILY_BRIEFING: ReportTemplate = {
  name: 'daily_briefing',
  description: '每日简报 — 目标+告警+问题+建议 (Markdown)',
  render(data: ReportData): string {
    const lines: string[] = [];
    lines.push(`## 📊 Synova 每日简报 — ${data.date}`);
    lines.push('');
    lines.push(`**${data.orgId}** · ${data.goals.length} 目标 · ${data.alerts.length} 告警 · ${data.obstacles.length} 问题`);
    lines.push('');

    if (data.goals.length > 0) {
      lines.push('### 📌 目标进度');
      for (const g of data.goals.slice(0, 5)) {
        const bar = '█'.repeat(Math.round(g.progress / 10)) + '░'.repeat(10 - Math.round(g.progress / 10));
        const icon = g.trend === 'up' ? '📈' : g.trend === 'down' ? '📉' : '➡️';
        lines.push(`- ${icon} ${g.name}: ${bar} ${g.progress}% [${g.status}]`);
      }
      lines.push('');
    }

    if (data.alerts.length > 0) {
      lines.push('### 🚨 活跃告警');
      for (const a of data.alerts.slice(0, 5)) {
        lines.push(`- ${a.priority === 'high' ? '🔴' : '🟡'} ${a.description} (置信度 ${Math.round(a.confidence * 100)}%)`);
      }
      lines.push('');
    }

    if (data.obstacles.length > 0) {
      lines.push('### 🔄 遗留问题');
      for (const o of data.obstacles.slice(0, 3)) {
        lines.push(`- ${o.description} [${o.status}]`);
      }
      lines.push('');
    }

    if (data.recommendations.length > 0) {
      lines.push('### 💡 建议');
      data.recommendations.forEach(r => lines.push(`- ${r}`));
    }

    return lines.join('\n');
  },
};

const WEEKLY_SUMMARY: ReportTemplate = {
  name: 'weekly_summary',
  description: '周报 — 本周变化+趋势+对比上周',
  render(data: ReportData): string {
    const lines: string[] = [];
    lines.push(`## 📈 Synova 周报 — ${data.date}`);
    lines.push('');
    lines.push(`**${data.orgId}** · 本周对比上周`);
    lines.push('');

    const goalsUp = data.goals.filter(g => g.trend === 'up').length;
    const goalsDown = data.goals.filter(g => g.trend === 'down').length;
    lines.push(`### 目标趋势`);
    lines.push(`- 📈 改善: ${goalsUp} 项`);
    lines.push(`- 📉 下降: ${goalsDown} 项`);
    lines.push(`- ➡️ 持平: ${data.goals.length - goalsUp - goalsDown} 项`);
    lines.push('');

    if (data.alerts.length > 0) {
      lines.push('### 🚨 本周新增告警');
      data.alerts.slice(0, 5).forEach(a =>
        lines.push(`- ${a.description}`));
      lines.push('');
    }

    const resolved = data.obstacles.filter(o => o.status === 'resolved').length;
    const tracking = data.obstacles.filter(o => o.status === 'tracking').length;
    lines.push(`### 🔄 问题处理`);
    lines.push(`- 已解决: ${resolved}`);
    lines.push(`- 跟踪中: ${tracking}`);
    lines.push('');

    lines.push('### 💡 下周建议');
    data.recommendations.slice(0, 3).forEach(r => lines.push(`- ${r}`));

    return lines.join('\n');
  },
};

// ═══ D791: 一页纸四槽位版式基建 ═══

/**
 * D791 降级标记（**ASCII**——D480 既有 3 个用例断言正常路径 `not.toContain('降级')`；
 * 中文标记会误伤既有用例，spec §5.2 R2 明文）。
 * 字面与 `agent/report-onepager-trace.ts ` 的 DEGRADED_MARK 一致——L3 不 import L2（避免层间倒置），
 * 一致性由 `tests/agent/report-onepager.test.ts ` 的槽位一致性用例守护。
 */
const DEGRADED_MARK_S2 = '[degraded]';

/** D791 槽位条数二次裁剪上限（spec §5.2 可读性约束表；零新阈值——与 Top 3 对称 / 注册循环实测上限 6） */
const S2_LIMIT = 3;
const S3_LIMIT = 6;
const S4_LIMIT = 3;

/** D791 一页纸四槽位标题（字面固定——GS-08 断言与覆盖审计共同依赖；顺序即渲染顺序） */
export const EXECUTIVE_SUMMARY_SLOT_TITLES = [
  '### 结论',
  '### 关键证据',
  '### 各维度循环结论',
  '### 行动建议',
] as const;

/** 槽位空态文案（缺数据 / 缺入参两种——R2 降级显式，不得渲染正面结论措辞） */
const SLOT_EMPTY_TEXT: Readonly<Record<string, { empty: string; absent: string }>> = {
  '### 关键证据': { empty: '哨兵无 finding 记录', absent: '未提供关键证据（inputs 缺席）' },
  '### 各维度循环结论': { empty: '暂无已注册循环模型（cycles/ 无 .cycle.json）', absent: '未提供循环结论（inputs 缺席）' },
  '### 行动建议': { empty: '报告无行动建议条目', absent: '未提供行动建议（inputs 缺席）' },
};

/** unknown → string（非字符串 → 空串，零断言——铁律 38） */
function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 渲染一个槽位段（标题 + 条目行 + 尾部空行）。
 *
 * @input  lines 输出行累加器；title 槽位标题；items 条目正文数组（undefined = 入参缺席）；
 *         limit 条数上限（二次裁剪）；table 空态文案表
 * @output 无（原地追加）
 * @degraded items 缺席 → `[degraded] <absent>`；items 为空/全空白 → `[degraded] <empty>`
 *           （两条路径都不静默省略槽位——R2）
 */
function pushSlot(
  lines: string[],
  title: string,
  items: unknown,
  limit: number,
): void {
  const table = SLOT_EMPTY_TEXT[title] ?? { empty: '无条目', absent: '未提供入参（inputs 缺席）' };
  lines.push(title);
  if (!Array.isArray(items)) {
    lines.push(`- ${DEGRADED_MARK_S2} ${table.absent}`);
    lines.push('');
    return;
  }
  const kept = items
    .map(item => toStringOrEmpty(item))
    .filter(item => item.trim() !== '')
    .slice(0, limit);
  if (kept.length === 0) {
    lines.push(`- ${DEGRADED_MARK_S2} ${table.empty}`);
  } else {
    for (const item of kept) lines.push(`- ${item}`);
  }
  lines.push('');
}

const EXECUTIVE_SUMMARY: ReportTemplate = {
  name: 'executive_summary',
  description: '高管摘要 — 结论先行四槽位（结论 / 关键证据 / 各维度循环结论 / 行动建议）+ Top3',
  render(data: ReportData): string {
    const criticalAlerts = data.alerts.filter(a => a.priority === 'high');
    const summaryLine = criticalAlerts.length > 0
      ? `⚠️ ${data.orgId}: ${criticalAlerts.length} 个高风险项需立即关注`
      : `✅ ${data.orgId}: 运行平稳`;

    const lines: string[] = [];
    // ── D480 既有头行（一字不改——回归红线 tests/agent/report-assembler.test.ts:44-62）──
    lines.push(`## ${summaryLine}`);
    lines.push('');

    // ── D791 S1 结论（正文 = recommendations[0]，由 L2 按深度映射: ceo=assembleCeo 摘要）──
    lines.push('### 结论');
    const conclusion = toStringOrEmpty(data.recommendations[0]);
    if (conclusion !== '') {
      lines.push(`- ${conclusion}${data.conclusionPointer ? ` ${data.conclusionPointer}` : ''}`);
    } else {
      lines.push(`- ${DEGRADED_MARK_S2} 无结论内容可溯源（recommendations 为空）`);
    }
    lines.push('');

    // ── D480 既有 Top 3 块（一字不改）──
    lines.push(`**Top 3:**`);
    const topItems = [
      ...data.alerts.slice(0, 2).map(a => `- 🔴 ${a.description}`),
      ...data.goals.filter(g => g.trend === 'down').slice(0, 1).map(g => `- 📉 ${g.name} (${g.progress}%)`),
      ...data.recommendations.slice(0, 1).map(r => `- 💡 ${r}`),
    ];
    topItems.slice(0, 3).forEach(l => lines.push(l));
    lines.push('');

    // ── D791 S2/S3/S4 三个新槽位（空数组 → 该槽位 [degraded] 说明行，不静默省略——R2）──
    pushSlot(lines, '### 关键证据', data.keyEvidence, S2_LIMIT);
    pushSlot(lines, '### 各维度循环结论', data.cycleConclusions, S3_LIMIT);
    pushSlot(lines, '### 行动建议', data.actionItems, S4_LIMIT);

    // ── D480 既有 footer（一字不改）──
    lines.push(`📎 完整报告: ${data.goals.length} 目标 · ${data.alerts.length} 告警`);
    return lines.join('\n');
  },
};

// ═══ D1051: 详细报告模板（第 4 个——完全诊断各章节）═══

/**
 * D1051 W2: `detailed_report` —— 详细报告（完整诊断各章节，markdown）。
 *
 * 契约（铁律 47）:
 *   @input  — data: ReportData（`chapters` 承载章节；`orgId` 作头行；`extra.reportId` 作尾行）
 *   @output — markdown：`## <orgId> 诊断详细报告` 头行 + 逐章（标题 + 条目行）+ `📎 报告 ID:` 尾行
 *   @degraded — ① `chapters` 缺席/空 → 单行 `[degraded]` 说明（不静默产出空壳报告）
 *               ② 单章 `title` 缺失 → 占位标题；单章 `body` 空 → 该章 `[degraded]` 说明行
 *               ③ `extra.reportId` 缺失 → 尾行显示「(缺省)」（不伪造 ID）
 *   哑渲染器：本模板**不新增任何模块依赖**（除文件既有 logger），章节标题完全来自
 *   `chapters[].title` 数据（§4.5 Q7 子裁定 (i)）——L3 零新增依赖。
 *   确定性：不含渲染时刻；同输入 → 同输出。
 */
const DETAILED_REPORT: ReportTemplate = {
  name: 'detailed_report',
  description: '详细报告 — 完整诊断各章节（结论 / 根因 / 专家完整推理 / 行动建议 / 数据时点）',
  render(data: ReportData): string {
    const lines: string[] = [];
    lines.push(`## ${data.orgId} 诊断详细报告`);
    lines.push('');

    const rawChapters: unknown = data.chapters;
    const chapters: unknown[] = Array.isArray(rawChapters) ? rawChapters : [];
    if (chapters.length === 0) {
      lines.push(`- ${DEGRADED_MARK_S2} 无章节数据（chapters 缺席或为空）`);
      lines.push('');
    } else {
      for (const raw of chapters) {
        // 内联类型窄化（铁律 38 替代形态）——注册表数据可能来自 JSON 归档，不盲信形状
        const chapter = typeof raw === 'object' && raw !== null
          ? (raw as { title?: unknown; body?: unknown })
          : {};
        const title = toStringOrEmpty(chapter.title);
        lines.push(title !== '' ? title : '### （未命名章节）');
        const body: unknown[] = Array.isArray(chapter.body) ? chapter.body : [];
        const kept = body
          .map(item => toStringOrEmpty(item))
          .filter(item => item.trim() !== '');
        if (kept.length === 0) {
          lines.push(`- ${DEGRADED_MARK_S2} 本章无内容`);
        } else {
          for (const item of kept) lines.push(`- ${item}`);
        }
        lines.push('');
      }
    }

    const reportId = toStringOrEmpty(data.extra?.reportId);
    lines.push(`📎 报告 ID: ${reportId !== '' ? reportId : '(缺省)'}`);
    return lines.join('\n');
  },
};

// ═══ ReportTemplateRegistry ═══

export class ReportTemplateRegistry {
  private templates = new Map<string, ReportTemplate>();

  constructor() {
    for (const t of [DAILY_BRIEFING, WEEKLY_SUMMARY, EXECUTIVE_SUMMARY, DETAILED_REPORT]) {
      this.templates.set(t.name, t);
    }
  }

  register(template: ReportTemplate): void {
    this.templates.set(template.name, template);
    log.info({ name: template.name }, '报告模板已注册');
  }

  get(name: string): ReportTemplate | undefined {
    return this.templates.get(name);
  }

  list(): ReportTemplate[] {
    return [...this.templates.values()];
  }

  /** Render a report using the named template */
  render(templateName: string, data: ReportData): string {
    const template = this.templates.get(templateName);
    if (!template) return `未找到模板: ${templateName}`;
    try {
      return template.render(data);
    } catch (err: any) {
      log.warn({ err, template: templateName }, '模板渲染失败');
      return `模板渲染失败: ${err.message}`;
    }
  }
}

// ═══ Singleton ═══

let _instance: ReportTemplateRegistry | null = null;
export function getReportTemplateRegistry(inject?: ReportTemplateRegistry): ReportTemplateRegistry {
  if (inject) { _instance = inject; return inject; }
  if (!_instance) _instance = new ReportTemplateRegistry();
  return _instance;
}
