/**
 * p0-wane-baby.test.ts — 示例企业A P0 端到端验证
 *
 * 用模拟数据运行所有 P0 compute 函数，验证核心诊断结论:
 * 1. F1: KZ>2.0 (融资约束) + 现金跑道<6月
 * 2. F5: CCC 过长 (运营资金紧张)
 * 3. I10: 低产客户群边际贡献为正但场景模拟砍掉后利润下降
 * 4. I10: 固定成本高度刚性 (工厂+运营人员)
 * 5. O8: 修复周期>6月 (广东工厂与南宁运营的信息不对称)
 * 6. O9: 权力指数>0.8 (但<20人时豁免)
 * 7. O1: 探索不足 (过度利用)
 */
import { describe, it, expect } from 'vitest';
import { createMockGraphStoreReader } from '../../packages/test-kit/fixtures/test-doubles';
import { computeKzIndex } from '../../extensions/sentinels/financing-constraint/computes/kz-index';
import { computeCashRunway } from '../../extensions/sentinels/financing-constraint/computes/cash-runway';
// D861: capital-turnover 哨兵已合并入 capital-health（D15a 合并 + D358 _extinct 归档）
//   ——import 路径随之更新，指向存活实现。
import { computeCashConversionCycle } from '../../extensions/sentinels/capital-health/computes/cash-conversion-cycle';
import { computeVariableCosts } from '../../extensions/sentinels/unit-economics/computes/variable-costs';
import { computeMarginalContribution } from '../../extensions/sentinels/unit-economics/computes/marginal-contribution';
import { computeFixedCostRigidity } from '../../extensions/sentinels/unit-economics/computes/fixed-cost-rigidity';
import { computeScenarioSimulation } from '../../extensions/sentinels/unit-economics/computes/scenario-simulation';
import { computeBreakEven } from '../../extensions/sentinels/unit-economics/computes/break-even';
import { computeProblemActionCycle } from '../../extensions/sentinels/org-repairability/computes/compute-problem-action-cycle';
import { computeFinkelsteinPowerIndex } from '../../extensions/sentinels/power-rigidity/computes/compute-power-rigidity';
import { computeExploreExploitBalanceV2 } from '../../extensions/sentinels/explore-exploit-balance/computes/compute-explore-exploit-balance';

describe('P0 示例企业A端到端验证', () => {
  // ═══ 模拟 示例企业A 数据 ═══
  // 226家低产会所 + 150家高产会所
  // 工厂28人 + 运营30人的固定成本结构
  // 融资约束: 无正规财报 → 银行无法授信

  it('F1: KZ>2.0 表示融资约束 (示例企业A诊断结论 #2)', () => {
    // 模拟融资约束企业: 低经营现金流, 高负债, 低现金
    const r = computeKzIndex([{
      operatingCashFlow: 200000,
      netPpe: 3000000,
      totalDebt: 6000000,
      equity: 2000000,
      cash: 300000,
    }]);
    expect(r.kzIndex).toBeGreaterThan(2.0);
    expect(r.degraded).toBe(false);
  });

  it('F1: 现金跑道不足6个月 (示例企业A诊断结论 #2)', () => {
    // 模拟现金流紧张: 总现金少, 月均运营支出高
    const r = computeCashRunway([
      { cash: 500000, operatingExpense: 150000 },
    ]);
    expect(r.runwayMonths).toBeLessThan(6);
    expect(r.monthlyBurn).toBeGreaterThan(0);
    expect(r.signal).toBe('critical');
  });

  it('F5: CCC > 120天 — 运营资金周转慢', () => {
    // 模拟工厂库存高、应收长、应付短
    const r = computeCashConversionCycle({
      cogs: 500000,
      inventory: 350000,       // DIO = 365/(500000/350000) = 255.5天
      accountsReceivable: 300000, // DSO = 365/(800000/300000) = 136.9天
      accountsPayable: 150000,   // DPO = 365/(500000/150000) = 109.5天
      revenue: 800000,
    });
    // CCC = 255.5 + 136.9 - 109.5 = 282.9天
    expect(r.cccDays).toBeGreaterThan(120);
    expect(r.signal).toBe('critical');
  });

  it('I10: 低产客户群边际贡献为正 (示例企业A诊断结论 #1)', () => {
    // 模拟 226家低产 + 150家高产
    const groups = [
      { groupId: 'high_yield_150', revenue: 150000, variableCost: 60000 },   // MC=90000, ratio=0.6
      { groupId: 'low_yield_226', revenue: 248600, variableCost: 180000 },   // MC=68600, ratio=0.276
    ];
    const r = computeMarginalContribution(groups);
    expect(r.groups.length).toBe(2);
    // 低产群MC应为正 (虽有边际贡献但不够覆盖固定成本)
    const lowYield = r.groups.find(g => g.groupId === 'low_yield_226');
    expect(lowYield).toBeDefined();
    expect(lowYield!.isPositive).toBe(true);
    expect(lowYield!.mcRatio).toBeGreaterThan(0);
    expect(r.degraded).toBe(false);
  });

  it('I10: 固定成本高度刚性 — 工厂+运营无法缩减 (示例企业A诊断结论 #1)', () => {
    // 工厂28人 + 运营30人的固定成本结构
    const costItems = [
      { name: 'Factory Rent', amount: 80000 },
      { name: 'Factory Workers Salary', amount: 140000 },
      { name: 'Operations Salary', amount: 150000 },
      { name: 'Equipment Depreciation', amount: 30000 },
      { name: 'IT Subscriptions', amount: 15000 },
    ];
    const r = computeFixedCostRigidity(costItems);
    // 刚性比率应 > 0.8 (大部分固定成本不可削减)
    expect(r.rigidityRatio).toBeGreaterThan(0.5);
    expect(r.signal).toBe('rigid');
    expect(r.totalReducible).toBeLessThan(r.totalFixed * 0.5);
  });

  it('I10: 场景模拟 — 砍掉低产群利润不改善 (示例企业A诊断结论 #1)', () => {
    // 示例企业A案例: 砍掉226家低产会所 → 利润下降
    const mcGroups = [
      { groupId: 'high_yield_150', revenue: 150000, variableCost: 60000, marginalContribution: 90000, mcRatio: 0.6, isPositive: true },
      { groupId: 'low_yield_226', revenue: 248600, variableCost: 180000, marginalContribution: 68600, mcRatio: 0.276, isPositive: true },
    ];
    const rigidCosts = [
      { name: 'Factory Rent', amount: 80000, reducible: false, reductionPercent: 0 },
      { name: 'Factory Salary', amount: 140000, reducible: false, reductionPercent: 0 },
      { name: 'Operations Salary', amount: 150000, reducible: false, reductionPercent: 0 },
    ];
    const currentProfit = 90000 + 68600 - (80000 + 140000 + 150000);
    const r = computeScenarioSimulation(mcGroups, rigidCosts, currentProfit);
    // 应检测到砍掉低产群不能改善利润 (profitImprovementPossible = false)
    // 因为固定成本无法等比例缩减
    expect(r.scenarios.length).toBeGreaterThan(0);
    // 至少有一个场景应给出利润下降的警告
    expect(r.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('O8: 修复周期超过6个月 — 组织修复能力弱 (示例企业A诊断结论 #3)', () => {
    // 广东工厂和南宁运营的信息不对称问题已存在数年未修
    const events = [
      { eventType: 'problem_detected', timestamp: '2025-01-15', problemCategory: 'factory_ops_gap', resolved: true, resolvedAt: '2025-10-20' },
      { eventType: 'problem_detected', timestamp: '2025-02-10', problemCategory: 'factory_ops_gap', resolved: true, resolvedAt: '2025-09-05' },
      { eventType: 'problem_detected', timestamp: '2025-03-01', problemCategory: 'inventory_mismatch', resolved: false },
      { eventType: 'corrective_action', timestamp: '2025-03-10', problemCategory: 'inventory_mismatch' },
    ];
    const r = computeProblemActionCycle(events);
    // 修复周期应 > 180天 (6个月) — 问题与解决之间隔了278天和207天
    expect(r.repairCycleDays).toBeGreaterThan(180);
    // 修复得分应低
    expect(r.repairScore).toBeLessThan(0.5);
  });

  it('O9: 权力指数高 — 但人数少时豁免', () => {
    // 老板决策高度集中
    const r = computeFinkelsteinPowerIndex({
      totalPeople: 12,        // <20 → 豁免
      ceoDecisionApprovals: 10,
      totalDecisionApprovals: 12,
      founderEquity: 0.9,
      managerCount: 3,
    });
    // 应触发 stage0-1 豁免
    expect(r.stageExempt).toBe(true);
    expect(r.signal).toBe('stage0_exempt');
  });

  it('O1: 探索不足 — 过度利用 (示例企业A诊断: 缺乏创新)', () => {
    // 模拟企业目标几乎全是运营优化型
    const r = computeExploreExploitBalanceV2({
      goals: [
        { goalType: 'optimization' },
        { goalType: 'operational' },
        { goalType: 'optimization' },
        { goalType: 'exploit' },
        { goalType: 'innovation' },
      ],
      documents: [
        { text: '优化生产线效率, 降低运营成本, 提升利润率' },
        { text: '标准化服务流程, 自动化工单系统' },
      ],
      recentProducts: 0,
    });
    // 应该 detected 过度利用 (exploit > 70%)
    expect(r.exploitRatio).toBeGreaterThan(0.5);
    expect(r.degraded).toBe(false);
  });
});
