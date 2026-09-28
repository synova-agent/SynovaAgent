/**
 * tests/agent/report-detailed.test.ts — D1051 W2+W3 详细报告渲染单测（铁律 33: *.test.ts = 单元）
 *
 * 覆盖（spec §5.1 T2 三路径 + §7.3 判别性夹具 J1/J6 + DS5/DS7）:
 *   正常路径 —— 五章俱全；根因/专家/建议**全量**（"详细"的判别点）；条目行带可解析溯源指针
 *   降级路径 —— 空 rootCauses / 空 expertReports → 该章 `[degraded]` 且**不抛**（J6）
 *             注入缺 `detailed_report` 的注册表 → 落 fallback 含降级标记（J1）
 *             注入抛错注册表 → 返回含降级标记的字符串（**不 throw**，whole-body 契约）
 *   边界条件 —— 确定性（同输入两次字节相等）；分发器两方向等价；reportId 空 → 指针省略
 *
 * 断言约定：降级标记一律 ASCII `[degraded]`；章节标题**在测试内独立重述**（spec §5.3 表原文），
 * 不从被测模块导入常量——避免"用被测代码验证被测代码"。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  renderDetailedReport,
  renderReportView,
  renderOnePager,
  isRenderableDiagnosisReport,
  VIEW_TO_ASSEMBLE_DEPTH,
  type OnePagerInputs,
} from '../../src/agent/report-assembler';
import { getReportTemplateRegistry, ReportTemplateRegistry, type ReportData } from '../../src/l3/report-templates';
import type { DiagnosisReport } from '../../src/l3/synova-diagnosis-engine';

// ═══ 章节标题独立重述（spec §5.3 章节表原文）═══

const CHAPTER_TITLES = [
  '### 结论', '### 根因', '### 专家完整推理', '### 行动建议', '### 数据时点',
] as const;

// ═══ Fixtures ═══

function makeReport(overrides?: Partial<DiagnosisReport>): DiagnosisReport {
  return {
    reportId: 'rpt-d1051-001',
    teamId: 'd1051-org',
    generatedAt: '2026-09-28T00:00:00.000Z',
    summary: '增长健康度中等，现金流为关键约束。',
    expertReports: [
      { expert: 'fundamental-efficiency', findings: ['应收账期过长'], confidence: 0.8 },
      { expert: 'customer-growth', findings: ['客户集中度偏高', '复购率下滑'], confidence: 0.65 },
    ],
    rootCauses: [
      { description: '现金流跑道不足 6 个月', dimension: 'finance', confidence: 0.9 },
      { description: '客户集中度过高', dimension: 'customer', confidence: 0.55 },
      { description: '关键岗位继任空白', dimension: 'talent', confidence: 0.72 },
    ],
    recommendations: [
      { action: '启动应急融资', priority: 'critical', expert: 'fundamental-efficiency' },
      { action: '建立关键岗位继任计划', priority: 'high', expert: 'organizational-capability' },
    ],
    raw: {},
    ...overrides,
  };
}

afterEach(() => {
  // 还原 singleton（构造器自动重注册全部 built-ins——文件内 singleton 跨用例持久）
  getReportTemplateRegistry(new ReportTemplateRegistry());
});

// ═══ 正常路径 ═══

describe('D1051 W3: 详细报告渲染——正常路径', () => {
  it('① 五章标题字面齐备 + 头行 + 尾行报告 ID', () => {
    const report = makeReport();
    const md = renderDetailedReport(report);

    for (const title of CHAPTER_TITLES) {
      expect(md).toContain(title);
    }
    expect(md).toContain('## d1051-org 诊断详细报告');
    expect(md).toContain('📎 报告 ID: rpt-d1051-001');
    // 正常路径不得出现中文「降级」（D480 既有断言语义）
    expect(md).not.toContain('降级');
  });

  it('② 「详细」的判别点：根因全量输出（3 条全出）+ 置信度降序', () => {
    const md = renderDetailedReport(makeReport());
    for (const rc of makeReport().rootCauses) {
      expect(md).toContain(rc.description);
    }
    // 降序：0.9 → 0.72 → 0.55
    const iHigh = md.indexOf('现金流跑道不足');
    const iMid = md.indexOf('关键岗位继任空白');
    const iLow = md.indexOf('客户集中度过高');
    expect(iHigh).toBeGreaterThan(-1);
    expect(iMid).toBeGreaterThan(iHigh);
    expect(iLow).toBeGreaterThan(iMid);
  });

  it('③ 专家完整推理：全部 findings 输出（含同专家多 finding）', () => {
    const md = renderDetailedReport(makeReport());
    expect(md).toContain('fundamental-efficiency');
    expect(md).toContain('应收账期过长');
    expect(md).toContain('customer-growth');
    // 同专家多 finding 全部保留（不被裁剪）
    expect(md).toContain('客户集中度偏高');
    expect(md).toContain('复购率下滑');
  });

  it('④ 行动建议全量 + 数据时点逐字透传（不换算、不解析）', () => {
    const md = renderDetailedReport(makeReport());
    expect(md).toContain('启动应急融资');
    expect(md).toContain('建立关键岗位继任计划');
    expect(md).toContain('优先级 critical');
    // 时点逐字
    expect(md).toContain('2026-09-28T00:00:00.000Z');
  });

  it('⑤ 条目行带可解析溯源指针 [src:report:<reportId>#…]（五类片段齐备）', () => {
    const md = renderDetailedReport(makeReport());
    // 章 1 结论（对齐一页纸 S1「结论可溯源」语义）
    expect(md).toContain('[src:report:rpt-d1051-001#summary]');
    expect(md).toContain('[src:report:rpt-d1051-001#rootcause:0]');
    expect(md).toContain('[src:report:rpt-d1051-001#expert:0]');
    expect(md).toContain('[src:report:rpt-d1051-001#recommendation:0]');
    expect(md).toContain('[src:report:rpt-d1051-001#recommendation:1]');
  });
});

// ═══ 降级路径 ═══

describe('D1051 W3: 详细报告渲染——降级路径', () => {
  it('⑥ 空 rootCauses / 空 expertReports / 空 recommendations → 各章 [degraded] 且不抛（J6）', () => {
    const report = makeReport({ rootCauses: [], expertReports: [], recommendations: [] });
    let md = '';
    expect(() => { md = renderDetailedReport(report); }).not.toThrow();

    // 五章仍齐备（降级不省略章节结构）
    for (const title of CHAPTER_TITLES) {
      expect(md).toContain(title);
    }
    expect(md).toContain('[degraded] 无根因记录');
    expect(md).toContain('[degraded] 无专家报告记录');
    expect(md).toContain('[degraded] 无行动建议记录');
  });

  it('⑦ 空 summary / 空 generatedAt → 结论章与时点章各自 [degraded]', () => {
    const report = makeReport({ summary: '', generatedAt: '' });
    const md = renderDetailedReport(report);
    expect(md).toContain('[degraded] 无结论内容可溯源');
    expect(md).toContain('[degraded] 报告缺数据时点');
  });

  it('⑧ 注册表缺 detailed_report → 落 fallback 并含降级标记（J1 判别性夹具）', () => {
    // 模拟「从注册表移除 detailed_report」：render 对该模板名返回未找到标记串
    class WithoutDetailedRegistry extends ReportTemplateRegistry {
      render(templateName: string, data: ReportData): string {
        if (templateName === 'detailed_report') return `未找到模板: ${templateName}`;
        return super.render(templateName, data);
      }
    }
    getReportTemplateRegistry(new WithoutDetailedRegistry());

    const md = renderDetailedReport(makeReport());
    // 必须落到纯文本 fallback（含降级标记），而非伪造章节
    expect(md).toContain('降级');
    // 判别点：若模板真实渲染，此字符串必然存在；fallback 不含章节标题 ⇒ 本断言报红即证明"接线了≠被执行"
    expect(md).not.toContain('### 根因');
    expect(md).not.toContain('### 专家完整推理');
  });

  it('⑨ registry.render 抛错 → 返回含降级标记的字符串，永不抛出（DS7）', () => {
    class ThrowingRegistry extends ReportTemplateRegistry {
      render(): string {
        throw new Error('mock: registry.render 爆炸');
      }
    }
    getReportTemplateRegistry(new ThrowingRegistry());

    let md = '';
    expect(() => { md = renderDetailedReport(makeReport()); }).not.toThrow();
    expect(md).toContain('降级');
    // 降级输出仍含核心信息（不产出空壳）
    expect(md).toContain('现金流跑道不足 6 个月');
  });

  it('⑩ 非完整形状经 isRenderableDiagnosisReport 拒绝（不伪造章节的准入面）', () => {
    expect(isRenderableDiagnosisReport(makeReport())).toBe(true);
    expect(isRenderableDiagnosisReport(null)).toBe(false);
    expect(isRenderableDiagnosisReport('x')).toBe(false);
    expect(isRenderableDiagnosisReport({})).toBe(false);
    // 缺 raw / 缺 rootCauses 数组 → 拒绝
    expect(isRenderableDiagnosisReport({ ...makeReport(), raw: undefined })).toBe(false);
    expect(isRenderableDiagnosisReport({ ...makeReport(), rootCauses: 'nope' })).toBe(false);
    // 归档形状（L5 只验 summary）不足 —— 必须被本谓词拦下
    expect(isRenderableDiagnosisReport({ reportId: 'r', teamId: 't', completedAt: 'c', report: { summary: 's' } })).toBe(false);
  });
});

// ═══ 边界条件 ═══

describe('D1051 W3: 详细报告渲染——边界条件', () => {
  it('⑪ 确定性：同输入两次渲染字节相等（禁渲染时刻——DS7）', () => {
    const report = makeReport();
    const first = renderDetailedReport(report);
    const second = renderDetailedReport(report);
    expect(second).toBe(first);
  });

  it('⑫ reportId 空 → 指针省略（不伪造），尾行显示 (缺省)', () => {
    const md = renderDetailedReport(makeReport({ reportId: '' }));
    expect(md).not.toContain('[src:report:');
    expect(md).toContain('📎 报告 ID: (缺省)');
    // 章节仍在（缺 reportId 不导致降级）
    expect(md).toContain('### 根因');
  });

  it('⑬ 分发器 renderReportView：detailed → 详版；one_pager → 与 renderOnePager(ceo) 同源同构', () => {
    const report = makeReport();
    const inputs: OnePagerInputs = {
      cycleConclusions: ['客户循环：溢出 [src:cycle:c@none]'],
      evidenceHighlights: ['现金跑道不足 [src:finding:s@2026-09-16T10:00:00.000Z]'],
    };

    // detailed 方向忽略 inputs（详版不需要四槽位入参）
    expect(renderReportView(report, 'detailed', inputs)).toBe(renderDetailedReport(report));
    // one_pager 方向 = 既有 renderOnePager 的 'ceo' 深度（3-1 零回归的路径保证）
    expect(renderReportView(report, 'one_pager', inputs)).toBe(renderOnePager(report, 'ceo', inputs));
    // 分发本身不改写产物：两方向产物不同源（判别性）
    expect(renderReportView(report, 'detailed')).not.toBe(renderReportView(report, 'one_pager'));
  });

  it('⑭ 装配轴映射表：one_pager→ceo / detailed→expert（两轴正交的唯一转换点）', () => {
    expect(VIEW_TO_ASSEMBLE_DEPTH.one_pager).toBe('ceo');
    expect(VIEW_TO_ASSEMBLE_DEPTH.detailed).toBe('expert');
    expect(Object.keys(VIEW_TO_ASSEMBLE_DEPTH).sort()).toEqual(['detailed', 'one_pager']);
  });

  it('⑮ 单元素/恰临界：1 根因 1 专家 1 建议不触发任何 [degraded]', () => {
    const report = makeReport({
      rootCauses: [{ description: '唯一根因', dimension: 'finance', confidence: 0.5 }],
      expertReports: [{ expert: 'solo', findings: ['唯一发现'], confidence: 0.5 }],
      recommendations: [{ action: '唯一建议', priority: 'low', expert: 'solo' }],
    });
    const md = renderDetailedReport(report);
    expect(md).not.toContain('[degraded]');
    expect(md).toContain('唯一根因');
    expect(md).toContain('唯一发现');
    expect(md).toContain('唯一建议');
  });
});
