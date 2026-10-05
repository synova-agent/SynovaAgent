/**
 * tests/agent/report-assembler.test.ts — D480 单元测试（铁律 33: *.test.ts = 单元）
 *
 * 覆盖 renderOnePager 三路径（正常/空根因优雅文案/降级纯文本）+ flywheel 深度边界
 * + assembleReport flywheel 回归守护（Stage 5a 同语义，D480 零行为改动）。
 *
 * 断言约定：全部用无 emoji 子串（模板输出行带 emoji 前缀，拷贝 emoji 脆弱）。
 * 断言勿用「降级」于用例②——该路径是模板优雅文案（✅ 运行平稳），非 degraded；
 * 「降级」标记仅属用例③ fallback 输出。
 */
import { describe, it, expect } from 'vitest';
import { assembleReport, renderOnePager } from '../../src/agent/report-assembler';
import { getReportTemplateRegistry, ReportTemplateRegistry } from '../../src/l3/report-templates';
import type { DiagnosisReport } from '../../src/l3/synova-diagnosis-engine';

// ═══ Fixture ═══

function makeReport(overrides?: Partial<DiagnosisReport>): DiagnosisReport {
  return {
    reportId: 'diag-test-001',
    teamId: 'client-a',
    generatedAt: '2026-08-23T10:00:00.000Z',
    summary: '现金流缺口与人才密度双重制约增长，建议先稳现金流再补关键岗位。',
    expertReports: [
      { expert: 'finance', findings: ['经营现金流连续 3 季度为负'], confidence: 0.8 },
      { expert: 'org', findings: ['关键岗位继任空白'], confidence: 0.6 },
    ],
    rootCauses: [
      { description: '现金流缺口扩大：经营现金流连续 3 季度为负', dimension: 'financial', confidence: 0.8 },
      { description: '核心人才密度不足', dimension: 'talent', confidence: 0.6 },
    ],
    recommendations: [
      { action: '压缩非核心固定成本 20%', priority: 'critical', expert: 'finance' },
      { action: '建立关键岗位继任计划', priority: 'high', expert: 'org' },
    ],
    raw: {},
    ...overrides,
  };
}

// ═══ D480: renderOnePager ═══

describe('D480: renderOnePager — 诊断报告一页纸渲染', () => {
  it('① 正常报告（ceo 深度）→ markdown 一页纸：含瓶颈+建议+高风险头行，消费 executive_summary 模板', () => {
    const report = makeReport();
    const md = renderOnePager(report, 'ceo');

    // markdown 结构（executive_summary 模板头行 `## ⚠️ ...`）
    expect(md).toContain('##');
    // 高置信根因（0.8 >= 0.7 → high）驱动模板高风险头行
    expect(md).toContain('1 个高风险项需立即关注');
    expect(md).toContain(report.teamId);
    // 根因经 🔴 告警行输出（ceo 深度 top2）
    expect(md).toContain(report.rootCauses[0].description);
    // assembleCeo ≤200 字瓶颈+建议经 💡 行输出
    expect(md).toContain('核心瓶颈');
    expect(md).toContain('建议');
    // footer 告警计数（ceo top2 → 2 告警）
    expect(md).toContain('2 告警');
    // 正常路径非降级输出
    expect(md).not.toContain('降级');
  });

  it('② 空 rootCauses → 优雅文案（运行平稳/未发现显著瓶颈），无高风险行、无降级标记', () => {
    const report = makeReport({ rootCauses: [], recommendations: [] });
    const md = renderOnePager(report, 'ceo');

    // 模板零高风险告警 → 运行平稳头行
    expect(md).toContain('运行平稳');
    // assembleCeo 空根因优雅文案经 💡 行输出
    expect(md).toContain('未发现显著瓶颈');
    expect(md).not.toContain('高风险项');
    // 此路径非 degraded——降级标记属用例③
    expect(md).not.toContain('降级');
  });

  it('③ registry.render 抛错 → 纯文本 fallback（含降级标记+核心瓶颈），不抛出', () => {
    // 机制注释（防后人"简化"）：ReportTemplateRegistry.render 内部吞模板异常并返回
    // 「模板渲染失败: ...」字符串（report-templates.ts L169-174）——注册 throwing template
    // 不会触发 fallback。必须覆写 registry.render 本身，经 getReportTemplateRegistry(inject)
    // seam（L181-185）注入，才能覆盖 registry 抛错降级路径。
    class ThrowingRegistry extends ReportTemplateRegistry {
      render(): string {
        throw new Error('mock: registry.render 爆炸');
      }
    }
    getReportTemplateRegistry(new ThrowingRegistry());
    try {
      const report = makeReport();
      const md = renderOnePager(report, 'ceo');

      // 纯文本降级标记
      expect(md).toContain('降级');
      // 降级输出仍含核心信息（assembleCeo 瓶颈+建议）
      expect(md).toContain('核心瓶颈');
      expect(md).toContain('建议');
      // 非模板输出
      expect(md).not.toContain('高风险项需立即关注');
    } finally {
      // 还原 singleton（构造器自动重注册全部 built-ins——文件内 singleton 跨用例持久）
      getReportTemplateRegistry(new ReportTemplateRegistry());
    }
  });

  it('④ flywheel 深度 → top5 根因计数 + 原始建议行动；ceo 深度 → top2 计数 + assembleCeo 摘要；默认 depth = ceo', () => {
    // 3 根因 fixture（2 高置信 + 1 低置信）——区分 ceo(top2) 与 flywheel(top5) 的告警计数
    const report = makeReport({
      rootCauses: [
        { description: '现金流缺口扩大：经营现金流连续 3 季度为负', dimension: 'financial', confidence: 0.8 },
        { description: '毛利率持续低于行业基准', dimension: 'financial', confidence: 0.75 },
        { description: '核心人才密度不足', dimension: 'talent', confidence: 0.6 },
      ],
    });

    const flywheelMd = renderOnePager(report, 'flywheel');
    // flywheel 取 top5 根因 → footer 计 3 告警（ceo 只取 top2）
    expect(flywheelMd).toContain('3 告警');
    // 模板 Top3 的 💡 行取 recommendations[0]——flywheel 传 assembleFlywheel 全量建议，
    // 模板渲染第一条原始行动（非 assembleCeo 摘要句式）
    expect(flywheelMd).toContain(report.recommendations[0].action);
    expect(flywheelMd).not.toContain('核心瓶颈');
    expect(flywheelMd).not.toContain('降级');

    const ceoMd = renderOnePager(report, 'ceo');
    // ceo 只取 top2 根因 → footer 计 2 告警；💡 行为 assembleCeo 摘要句式
    expect(ceoMd).toContain('2 告警');
    expect(ceoMd).toContain('核心瓶颈');

    // 默认参数契约：renderOnePager(report) === ceo 深度
    expect(renderOnePager(report)).toBe(ceoMd);
  });

  it('⑤ 回归守护：assembleReport flywheel 四层组装行为不变（Stage 5a 同语义）', () => {
    const report = makeReport();
    const assembled = assembleReport(report, 'flywheel');

    expect(assembled.reportId).toBe('diag-test-001');
    expect(assembled.depth).toBe('flywheel');
    expect(assembled.summary).toBeTruthy();
    const dimensions = assembled.data.dimensions as Record<string, number>;
    expect(dimensions['finance']).toBe(0.8);
    expect(Array.isArray(assembled.data.rootCauses)).toBe(true);
    expect((assembled.data.recommendations as string[]).length).toBe(2);
  });
});
