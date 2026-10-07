/**
 * tests/e2e/full-pipeline.integration.test.ts — D99 全管线端到端集成测试
 *
 * 这是整个项目最重要的测试。验证从原始数据 → 诊断报告 → Goal → 哨兵监控的完整链路。
 * 8 个阶段，每个阶段有 ≥2 个 expect() 断言。
 *
 * 所有 LLM 调用被 mock，不依赖真实 API。
 * 每个 stage 独立加载数据，避免 beforeAll 共享状态问题。
 */
import { describe, it, expect, vi } from 'vitest';

// ═══ Mock 数据 ═══

interface MockDiagnosisResponse {
  ceoSummary: string;
  keyFindings: Array<{ moduleId: string; finding: string; severity: string; confidence: number }>;
  actionRecommendations: Array<{ description: string; priority: string; riskLevel: string; expectedImpact: string; responsibleDepartment?: string }>;
  rootCauseTree: Record<string, unknown>;
  confidence: number;
}

function makeMockDiagnosisResponse(): MockDiagnosisResponse {
  return {
    ceoSummary: '哇呢宝贝作为一家母婴零售企业，面临线上渠道冲击和核心人才流失的双重挑战。当前净利润率仅5%，低于行业平均水平。建议优先优化成本结构并拓展线上渠道。',
    keyFindings: [
      { moduleId: 'financial', finding: '利润率偏低（5%）', severity: 'high', confidence: 0.85 },
      { moduleId: 'talent', finding: '核心人才流失风险', severity: 'high', confidence: 0.78 },
      { moduleId: 'market', finding: '线上渠道渗透不足', severity: 'medium', confidence: 0.72 },
    ],
    actionRecommendations: [
      { description: '优化成本结构，降低固定成本占比', priority: 'highest', riskLevel: 'medium', expectedImpact: '利润率提升2-3%', responsibleDepartment: 'finance' },
      { description: '建立线上渠道运营团队', priority: 'high', riskLevel: 'medium', expectedImpact: '线上营收增长30%', responsibleDepartment: 'marketing' },
      { description: '实施核心人才保留计划', priority: 'high', riskLevel: 'low', expectedImpact: '降低人才流失率50%', responsibleDepartment: 'hr' },
    ],
    rootCauseTree: { rootCauses: [{ dimension: 'financial', severity: 'critical', contributingEdges: ['E-23', 'E-05'] }] },
    confidence: 0.82,
  };
}

// ═══ LLM Mock ═══

const mockLLMProvider = {
  chat: vi.fn().mockResolvedValue({ content: JSON.stringify(makeMockDiagnosisResponse()) }),
  stream: vi.fn(),
  healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  listModels: vi.fn().mockReturnValue(['mock-model']),
};

vi.mock('../../src/providers', () => ({
  createProvider: () => mockLLMProvider,
}));

// ═══ 测试 ═══

describe('D99: Full Pipeline E2E — 完整管线集成测试', () => {
  it('Stage 0–1: 黄金数据加载 + 数据结构验证', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.join(process.cwd(), 'data', 'golden', 'wani-baby-v1.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    expect(data).toBeDefined();
    expect(data.enterprise).toBeDefined();
    expect(data.enterprise.name).toBe('哇呢宝贝');
    expect(typeof data.enterprise.headcount).toBe('number');
    expect(data.financial).toBeDefined();
    expect(Array.isArray(data.financial.revenue)).toBe(true);
    expect(data.financial.revenue.length).toBe(12);
    expect(data.client).toBeDefined();
    expect(data.personnel).toBeDefined();
    expect(data.edges).toBeDefined();
    expect(data.expectedDiagnosis).toBeDefined();
  });

  it('Stage 2: 5 个关键边 compute 函数调用', async () => {
    const fs = await import('fs');
    const raw = fs.readFileSync('data/golden/wani-baby-v1.json', 'utf-8');
    const golden = JSON.parse(raw);

    const path = await import('path');
    const filePath = path.join(process.cwd(), 'data', 'golden', 'wani-baby-v1.json');
    const fs2 = await import('fs');
    const golden2 = JSON.parse(fs2.readFileSync(filePath, 'utf-8'));

    // E-05: computeCapitalAcquisition — 验证所有5函数能正常执行返回
    const { computeCapitalAcquisition } = await import('../../extensions/sentinels/shared/computes/l1-input/compute-capital-acquisition');
    const capResult = computeCapitalAcquisition({ capitalRaised: 500, costOfCapital: 12, targetCapital: 1000 });
    expect(capResult).toBeDefined();
    expect(typeof capResult.value).toBe('number');

    // E-23: computeOperationalExecution
    const { computeOperationalExecution } = await import('../../extensions/sentinels/shared/computes/l3-output/compute-operational-execution');
    const avgRevenue = golden2.financial.revenue.reduce((a: number, b: number) => a + b, 0) / 12;
    const avgCost = golden2.financial.cost.reduce((a: number, b: number) => a + b, 0) / 12;
    const opResult = computeOperationalExecution({ revenue: avgRevenue, cost: avgCost, fixedCostRatio: golden2.financial.fixedCostRatio });
    expect(opResult).toBeDefined();
    expect(opResult.degraded).toBe(false);

    // E-31: computeCustomerLockin
    const { computeCustomerLockin } = await import('../../extensions/sentinels/shared/computes/l4-capture/compute-customer-lockin');
    const lockinResult = computeCustomerLockin({ ltvCacRatio: golden2.financial.ltvCacRatio, averageOrderValue: golden2.financial.averageOrderValue, churnRate: 0.15 });
    expect(lockinResult).toBeDefined();
    expect(typeof lockinResult.value).toBe('number');

    // E-33: computeCompetitivePositioning
    const { computeCompetitivePositioning: computeCP } = await import('../../extensions/sentinels/shared/computes/l4-capture/compute-competitive-positioning');
    const compResult = computeCP({ marketShare: 0.08, revenueGrowth: 0.12, customerCount: 5000 });
    expect(compResult).toBeDefined();
    expect(typeof compResult.value).toBe('number');

    // E-07: computeTalentAcquisition
    const { computeTalentAcquisition } = await import('../../extensions/sentinels/shared/computes/l1-input/compute-talent-acquisition');
    const talentResult = computeTalentAcquisition({ hiresCount: 5, avgQualityScore: 0.8, openPositions: 3 });
    expect(talentResult).toBeDefined();
    expect(typeof talentResult.value).toBe('number');
  });

  it('Stage 3: 哨兵 findings 结构验证', async () => {
    // 模拟 5 个哨兵的 finding 输出，验证 fields 完整性
    const sentinelResults = [
      {
        sentinelId: 'capital-health',
        findings: [{ id: 'F-cap-1', severity: 'warning' as const, title: '负债比率偏高', description: '当前负债比0.35', evidence: [], suggestion: '关注负债水平', detectedAt: new Date().toISOString() }],
      },
      {
        sentinelId: 'margin-health',
        findings: [{ id: 'F-mar-1', severity: 'critical' as const, title: '利润率偏低', description: '净利润率仅5%', evidence: [], suggestion: '审查成本结构', detectedAt: new Date().toISOString() }],
      },
      {
        sentinelId: 'competitive-position',
        findings: [{ id: 'F-cp-1', severity: 'warning' as const, title: '线上渠道不足', description: '线上营收占比低', evidence: [], suggestion: '加大线上投入', detectedAt: new Date().toISOString() }],
      },
      {
        sentinelId: 'talent-density',
        findings: [{ id: 'F-td-1', severity: 'warning' as const, title: '核心岗位空缺', description: '3个关键岗位空缺', evidence: [], suggestion: '启动招聘', detectedAt: new Date().toISOString() }],
      },
      {
        sentinelId: 'cash-runway',
        findings: [{ id: 'F-cr-1', severity: 'info' as const, title: '现金流充足', description: '可维持18个月', evidence: [], suggestion: '正常监控', detectedAt: new Date().toISOString() }],
      },
    ];

    sentinelResults.forEach((s) => {
      expect(Array.isArray(s.findings)).toBe(true);
      s.findings.forEach((f) => {
        expect(f.id).toBeTruthy();
        expect(f.severity).toMatch(/^(emergency|critical|warning|info)$/);
        expect(f.title).toBeTruthy();
        expect(f.description).toBeTruthy();
      });
    });
  });

  it('Stage 4: 信号聚合 — 交叉关联 + 升级', async () => {
    const { aggregateSignals } = await import('../../src/sentinel/signal-aggregator');

    const checkResults = [
      { sentinelId: 'margin-health', ok: true, findings: [{ id: 'F2', severity: 'critical' as const, title: '利润偏低', description: '', evidence: [], suggestion: '', detectedAt: new Date().toISOString() }], durationMs: 10, checkedAt: new Date().toISOString() },
      { sentinelId: 'capital-health', ok: true, findings: [{ id: 'F1', severity: 'warning' as const, title: '负债偏高', description: '', evidence: [], suggestion: '', detectedAt: new Date().toISOString() }], durationMs: 10, checkedAt: new Date().toISOString() },
    ];

    const aggregated = aggregateSignals(checkResults);
    expect(aggregated).toBeDefined();
    expect(Array.isArray(aggregated.signals)).toBe(true);
    expect(aggregated.stats).toBeDefined();
    expect(typeof aggregated.stats.aggregatedSignals).toBe('number');
  });

  it('Stage 5a: Report assembler — sentinel findings → 报告组装', async () => {
    const { assembleReport } = await import('../../src/agent/report-assembler');
    const mockResponse = makeMockDiagnosisResponse();

    const report = {
      reportId: 'diag-test-001',
      teamId: 'wani-baby',
      generatedAt: new Date().toISOString(),
      summary: mockResponse.ceoSummary,
      expertReports: mockResponse.keyFindings.map((f) => ({ expert: f.moduleId, findings: [f.finding], confidence: f.confidence })),
      rootCauses: [{ description: '利润率偏低导致经营风险', dimension: 'financial', confidence: 0.8 }],
      recommendations: mockResponse.actionRecommendations.map((a) => ({
        action: a.description,
        priority: a.priority === 'highest' ? 'critical' as const : 'high' as const,
        expert: a.responsibleDepartment || 'general',
      })),
      raw: {},
    };

    const assembled = assembleReport(report, 'flywheel');

    expect(assembled).toBeDefined();
    expect(assembled.summary).toBeTruthy();
    expect(assembled.summary.length).toBeGreaterThanOrEqual(50);
    expect(assembled.data).toBeDefined();
    // flywheel 模式的数据在 assembled.data 中
    if (assembled.data && typeof assembled.data === 'object') {
      expect(Object.keys(assembled.data).length).toBeGreaterThan(0);
    }
  });

  it('Stage 5b: 专家加载 — expert-registry.yaml enabled 专家 manifest + PROMPT.md', async () => {
    const fs = await import('fs');
    const path = await import('path');
    // D282 9→7 迁移后硬编码专家数恒失败（D480 上报）— 改为动态读 expert-registry.yaml
    // （声明式单一事实源），专家数再变时只改 yaml，测试自动跟随，不再漂移。
    // 轻量解析（dev doc §4.5 决策点 2）：enabled: true 条目数 + 2 空格缩进的专家键集合。
    // fail-closed: yaml 缺失 → readFileSync 抛错；yaml 为空/解析为 0 → 与目录数必不等 → 测试红。
    // 注: 不复用 src/agent/expert-config-loader 的 loadExpertConfig — 2026-08-28 实证其对
    // v2.0 嵌套格式恒解析 0 专家（parseSimpleYaml 专家键分支 /^  [a-z_]+:$/ && !includes(':')
    // 自相矛盾为死分支，expertCount:0，上游靠 expert-file-loader 文件扫描静默兜底），缺陷已单独
    // 上报；其修复后本测试可切回 loadExpertConfig 与生产同源。
    const registryPath = path.join(process.cwd(), 'expert', 'expert-registry.yaml');
    const registryContent = fs.readFileSync(registryPath, 'utf-8');
    const registryLines = registryContent.split('\n');
    const expectedExperts = registryLines.filter((line) => /^\s+enabled:\s*true\s*$/.test(line)).length;
    const declaredNames = registryLines
      .map((line) => /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]);

    const expertDir = path.join(process.cwd(), 'expert');
    const entries = fs.readdirSync(expertDir, { withFileTypes: true });
    const experts = entries.filter((e) => e.isDirectory() && !e.name.startsWith('_'));
    expect(experts.length).toBe(expectedExperts);
    // 目录集合与声明集合必须一致（仅比计数多一道交叉验证：计数相等但名单漂移也拦下）
    expect(experts.map((e) => e.name).sort()).toEqual([...declaredNames].sort());

    for (const exp of experts) {
      const manifestPath = path.join(expertDir, exp.name, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.name).toBeTruthy();
      expect(manifest.version).toBeTruthy();

      const promptPath = path.join(expertDir, exp.name, 'PROMPT.md');
      if (fs.existsSync(promptPath)) {
        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        expect(promptContent.length).toBeGreaterThan(100);
        expect(promptContent).not.toContain('{{');
        expect(promptContent).not.toContain('TODO');
        expect(promptContent).not.toContain('???');
      }
    }
  });

  it('Stage 5c: DiagnosisOrchestrator — 可实例化 with mock deps', async () => {
    // D317: engine-core 退役 — 编排器已迁移至 src/orchestrator/diagnosis-orchestrator
    const { DiagnosisOrchestrator } = await import('../../src/orchestrator/diagnosis-orchestrator');

    const mockClient = { consult: vi.fn().mockResolvedValue({ content: JSON.stringify(makeMockDiagnosisResponse()) }) };
    const mockTools = { execute: vi.fn().mockResolvedValue({ content: 'ok' }) };

    expect(typeof DiagnosisOrchestrator).toBe('function');

    const orch = new DiagnosisOrchestrator(mockClient, mockTools);
    expect(orch).toBeDefined();
    expect(typeof orch.withMaxIterations).toBe('function');
  });

  it('Stage 6: 报告结构验证 — ActionRecommendation / ceoSummary / findings', async () => {
    const mockResponse = makeMockDiagnosisResponse();

    expect(mockResponse.ceoSummary).toBeTruthy();
    expect(mockResponse.ceoSummary.length).toBeGreaterThanOrEqual(50);
    expect(Array.isArray(mockResponse.keyFindings)).toBe(true);
    expect(mockResponse.keyFindings.length).toBeGreaterThan(0);

    // ActionRecommendation 结构化验证（D77 类型）
    expect(Array.isArray(mockResponse.actionRecommendations)).toBe(true);
    expect(mockResponse.actionRecommendations.length).toBeGreaterThan(0);
    const first = mockResponse.actionRecommendations[0];
    expect(first.description).toBeTruthy();
    expect(first.priority).toMatch(/^(highest|high|medium|low)$/);
    expect(first.riskLevel).toMatch(/^(high|medium|low)$/);
    expect(first.expectedImpact).toBeTruthy();

    expect(mockResponse.rootCauseTree).toBeDefined();
    expect(mockResponse.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('Stage 7: Goal 创建 — Proposal → Goal 全链路', async () => {
    const { generateProposalFromDiagnosis, generateGoalFromProposal } = await import('../../src/growth/proposal-engine');
    const { updateProposalStatus, selectPath, confirmByGa, getProposal } = await import('../../src/growth/proposal-store');
    const { getGoal } = await import('../../src/growth/goal-store');
    const mockResponse = makeMockDiagnosisResponse();

    // 构建 mock store
    const nodes = new Map<string, Record<string, unknown>>();
    const store = {
      createNode: vi.fn((type: string, props: Record<string, unknown>) => {
        // GOAL 类型优先使用 goalId，PROPOSAL 使用 proposalId
        const nodeId = (
          type === 'GOAL' ? props.goalId :
          type === 'PROPOSAL' ? props.proposalId :
          props.proposalId || props.goalId || `node-${Date.now()}`
        ) as string;
        nodes.set(nodeId, { ...props });
        return nodeId;
      }),
      getNode: vi.fn((id: string) => {
        const props = nodes.get(id);
        return props ? { id, type: 'NODE', props } : null;
      }),
      updateNode: vi.fn((id: string, props: Record<string, unknown>) => {
        const existing = nodes.get(id);
        if (existing) nodes.set(id, { ...existing, ...props });
      }),
      queryNodes: vi.fn(() => []),
    } as any;
    const audit = { write: vi.fn().mockResolvedValue('audit-1') };

    // 生成 Proposal
    const proposal = generateProposalFromDiagnosis({
      diagnosisId: 'diag-wani-001',
      title: '哇呢宝贝综合诊断',
      department: 'operations',
      confidence: mockResponse.confidence,
      keyRisks: ['利润率偏低', '人才流失'],
      triggeringSentinels: ['margin-health', 'talent-density'],
      actionRecommendations: mockResponse.actionRecommendations,
    }, store, audit);

    expect(proposal).toBeDefined();
    expect(proposal.title).toBeTruthy();
    expect(proposal.paths).toHaveLength(3);

    // Proposal 状态流转到 confirmed
    updateProposalStatus(proposal.proposalId, 'pending_selection', 'system', {}, store, audit);
    selectPath(proposal.proposalId, 1, 'manager', store, audit);
    updateProposalStatus(proposal.proposalId, 'pending_ga_confirmation', 'system', {}, store, audit);
    confirmByGa(proposal.proposalId, 'ga-user', store, audit);

    const confirmedProposal = getProposal(proposal.proposalId, store);
    expect(confirmedProposal).not.toBeNull();
    expect(confirmedProposal!.status).toBe('confirmed');

    // 生成 Goal
    const goalIds = generateGoalFromProposal(confirmedProposal!, store, audit);
    expect(goalIds.length).toBeGreaterThan(0);

    const goal = getGoal(goalIds[0], store);
    expect(goal).not.toBeNull();
    expect(goal!.ownerDeptId).toBeTruthy();
    expect(goal!.status).toBe('draft');
  });

  it('Stage 8: Goal 哨兵监控 — createGoalSentinel + check()', async () => {
    const { createGoal } = await import('../../src/growth/goal-store');
    const { getGoal, updateGoalStatus } = await import('../../src/growth/goal-store');
    const nodes = new Map<string, Record<string, unknown>>();
    const store = {
      createNode: vi.fn((type: string, props: Record<string, unknown>) => {
        const nodeId = props.goalId as string || `node-${Date.now()}`;
        nodes.set(nodeId, { ...props });
        return nodeId;
      }),
      getNode: vi.fn((id: string) => {
        const props = nodes.get(id);
        return props ? { id, type: 'NODE', props } : null;
      }),
      updateNode: vi.fn((id: string, props: Record<string, unknown>) => {
        const existing = nodes.get(id);
        if (existing) nodes.set(id, { ...existing, ...props });
      }),
      queryNodes: vi.fn(() => []),
    } as any;
    const audit = { write: vi.fn().mockResolvedValue('audit-1') };

    // 创建 Goal (status = 'active')
    const goalId = createGoal({
      goalId: '', orgId: 'wani-baby', proposalId: 'prop-test', diagnosisId: 'diag-test',
      title: '提升利润率', description: '将净利润率从5%提升到8%',
      priority: 'P1', status: 'active', ownerDeptId: 'finance', assignedTo: '张三',
      createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
      deadline: new Date(Date.now() + 90 * 86400000).toISOString(),
      metrics: [{ metricName: '净利润率', currentValue: 5, targetValue: 8, unit: '%', computeContractId: 'C1' }],
      successCriteria: [{ criterion: '净利润率≥8%', verificationMethod: 'metric_threshold', verified: false }],
      dependsOn: [], conflictsWith: [],
      reDiagnosisCount: 0,
      createdBy: { role: 'manager' },
      lastModifiedAt: new Date().toISOString(),
      plannedDurationDays: 120,
    }, store, audit);

    // Goal 已创建为 active
    const goal = getGoal(goalId, store);
    expect(goal).not.toBeNull();
    expect(goal!.status).toBe('active');

    // 创建哨兵
    const { createGoalSentinel } = await import('../../src/growth/goal-sentinel');
    const sentinel = createGoalSentinel(goal!, {
      baselineStatus: 'active',
      samples: [{ value: 5, timestamp: new Date(Date.now() - 7 * 86400000).toISOString() }],
      sustainedAlertCycles: 1,
    });

    // 执行 check
    const checkResult = await sentinel.check({ db: {}, now: new Date() });
    expect(checkResult.ok).toBe(true);
    expect(Array.isArray(checkResult.findings)).toBe(true);
    expect(checkResult.sentinelId).toBeTruthy();

    if (checkResult.findings.length > 0) {
      const f = checkResult.findings[0];
      expect(f.id).toBeTruthy();
      expect(f.severity).toMatch(/^(emergency|critical|warning|info)$/);
      expect(f.title).toBeTruthy();
    }
  });
});
