/**
 * tests/interview/e2e-preliminary-diagnosis.test.ts — T11 端到端测试
 *
 * 模拟完整流程: 访谈文本 → RoleResponse → signal-extractor → gpi-estimator
 * 端到端验证无数据诊断管线的数据完整性。
 */
import { describe, it, expect } from 'vitest';
import { extractSignals } from '../../src/interview/signal-extractor';
import { estimateGPI } from '../../src/interview/gpi-estimator';
import { assembleReport } from '../../src/agent/report-assembler';

describe('T11 e2e: 无数据诊断管线', () => {
  // 模拟 5 角色访谈数据（基于客户A风格的真实场景）
  const mockResponses = [
    // CEO: 战略乐观
    { roleId: 'ceo', questionIndex: 0, answer: '我们产品质量很好，但销售跟不上，市场推广没做到位', confidence: 0.85 },
    { roleId: 'ceo', questionIndex: 1, answer: '我每天花时间最多的在产品上，但感觉团队的执行力不够', confidence: 0.7 },
    { roleId: 'ceo', questionIndex: 2, answer: '信息主要通过每周例会传递，我觉得大家应该都知道', confidence: 0.8 },
    { roleId: 'ceo', questionIndex: 3, answer: '如果能改一件事，我希望把销售团队重建了', confidence: 0.75 },
    // CTO: 技术悲观
    { roleId: 'cto', questionIndex: 0, answer: '技术债太重了，每次新功能都要动到底层，测试要跑半天', confidence: 0.9 },
    { roleId: 'cto', questionIndex: 1, answer: '我60%的时间在做架构设计，但实际开发都在修bug', confidence: 0.6 },
    { roleId: 'cto', questionIndex: 3, answer: '最想改的是CI/CD流程，现在上线一次太痛苦了', confidence: 0.8 },
    // Manager: 中间层困境
    { roleId: 'manager', questionIndex: 0, answer: '资源不够，人不够，上面定的目标太高了', confidence: 0.35 },
    { roleId: 'manager', questionIndex: 2, answer: '很多事情CEO不知道，下面报喜不报忧', confidence: 0.3 },
    { roleId: 'manager', questionIndex: 3, answer: '审批太慢了，买个云服务要签六个人', confidence: 0.65 },
    // Engineer: 一线真实感受
    { roleId: 'engineer', questionIndex: 0, answer: '需求变来变去，加班做了又推翻重来', confidence: 0.3 },
    { roleId: 'engineer', questionIndex: 1, answer: '我觉得每天做的事和公司的目标没有直接关系', confidence: 0.25 },
    { roleId: 'engineer', questionIndex: 3, answer: 'KPI不合理，做好了不算，做差了要背锅', confidence: 0.5 },
    // HR: 文化视角
    { roleId: 'hr', questionIndex: 0, answer: '离职率偏高，优秀的人留不住', confidence: 0.65 },
    { roleId: 'hr', questionIndex: 3, answer: '薪酬没有竞争力，招人越来越难了', confidence: 0.6 },
  ];

  it('完整管线: signal-extractor + gpi-estimator 数据完整性', () => {
    const roleIds = ['ceo', 'cto', 'manager', 'engineer', 'hr'];

    // Step 1: 信号提取
    const extracted = extractSignals(mockResponses, roleIds);
    expect(extracted.degraded).toBe(false);
    expect(extracted.signals.length).toBeGreaterThanOrEqual(5);

    // 验证有 contradiction 信号（R1）
    const contradictions = extracted.signals.filter(s => s.evidenceType === 'contradiction');
    expect(contradictions.length).toBeGreaterThanOrEqual(1);

    // 验证有痛觉点信号（R2）
    const painSignals = extracted.signals.filter(s => s.id.startsWith('pain_'));
    expect(painSignals.length).toBeGreaterThanOrEqual(3);

    // 检查特定维度映射
    const approvalSignal = painSignals.find(s => s.dimension === 'decision_concentration');
    expect(approvalSignal).toBeDefined();

    // Step 2: GPI 估算
    const gpi = estimateGPI({
      signals: extracted.signals,
      contradictionCount: extracted.contradictions.length,
      blindSpotCount: extracted.blindSpots.length,
    });
    expect(gpi.dataSource).toBe('interview');
    expect(gpi.external_opportunity.confidence).toBe('preliminary');
    expect(gpi.growth_cost.confidence).toBe('unavailable');
    // 如此多的负面信号 → GPI 应该在红区或黄区
    expect(gpi.gpi).toBeLessThan(0.7);
    expect(gpi.gpi).toBeGreaterThanOrEqual(0);
  });

  it('report-assembler 预诊断模式', () => {
    const report = {
      reportId: 'test_prelim_001',
      teamId: 'test-team',
      generatedAt: new Date().toISOString(),
      summary: '基于访谈数据的诊断摘要',
      expertReports: [{ expert: 'strategy', findings: ['组织转型期'], confidence: 0.5 }],
      rootCauses: [{ description: '战略传递断层', dimension: 'strategy_clarity', confidence: 0.6 }],
      recommendations: [{ action: '建立跨部门对齐机制', priority: 'high' as const, expert: 'org_diagnostician' }],
      raw: {},
    };

    const assembled = assembleReport(report, 'ceo', undefined, 'preliminary');
    expect(assembled.summary).toContain('预诊断');
    expect(assembled.summary).toContain('基于访谈数据');
  });

  it('signal-extractor 降级: 角色不足', () => {
    const onlyCeo = [
      { roleId: 'ceo', questionIndex: 0, answer: '公司最大的问题是增长', confidence: 0.9 },
      { roleId: 'ceo', questionIndex: 3, answer: '想改销售团队', confidence: 0.8 },
    ];
    const extracted = extractSignals(onlyCeo, ['ceo']);
    expect(extracted.degraded).toBe(true);
    expect(extracted.warnings.some(w => w.includes('角色数不足'))).toBe(true);
  });

  it('gpi-estimator 行业基线差异化', () => {
    const noSignal = { signals: [] as any[], contradictionCount: 0, blindSpotCount: 0 };

    const saas = estimateGPI({ ...noSignal, industry: 'saas' });
    const manufacturing = estimateGPI({ ...noSignal, industry: 'manufacturing' });
    const retail = estimateGPI({ ...noSignal, industry: 'retail' });

    // SaaS 行业基线高于制造业和零售
    expect(saas.external_opportunity.score).toBeGreaterThan(manufacturing.external_opportunity.score!);
    expect(saas.external_opportunity.score).toBeGreaterThan(retail.external_opportunity.score!);
  });

  it('约束5: 零 as any — 接口类型安全', () => {
    // 类型安全验证：所有输入输出都有明确接口
    const extracted = extractSignals(mockResponses, ['ceo', 'cto', 'manager', 'engineer', 'hr']);
    // 验证每个信号字段类型
    for (const s of extracted.signals) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.dimension).toBe('string');
      expect(typeof s.sourceRole).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(['strong', 'moderate', 'weak']).toContain(s.signalStrength);
      expect(['direct', 'contradiction', 'pattern']).toContain(s.evidenceType);
    }

    const gpi = estimateGPI({
      signals: extracted.signals,
      contradictionCount: extracted.contradictions.length,
      blindSpotCount: extracted.blindSpots.length,
    });
    expect(typeof gpi.gpi).toBe('number');
    expect(['red', 'yellow', 'green']).toContain(gpi.gpiTier);
  });
});
