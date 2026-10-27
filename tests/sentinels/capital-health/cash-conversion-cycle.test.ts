/**
 * tests/sentinels/capital-health/cash-conversion-cycle.test.ts — D358 配对测试（组 2b）
 *
 * 契约: computeCashConversionCycle(fin: {cogs, inventory, receivables, accounts_payable, total_revenue}, thresholds)
 *   CCC = DIO + DSO − DPO；阈值**由调用方传入**（#732 单源: manifest 基线 120/90），算法不改
 *   D358 接线: 旧 capital-turnover aggregate import 本函数却从不调用 = 死代码（铁律 37），
 *   本任务在新 aggregate 接线 signal 判定。
 *   降级: total_revenue<=0 且 cogs<=0
 *   边界: CCC 恰好 91（刚过 warning 线）
 */
import { describe, it, expect } from 'vitest';
import { computeCashConversionCycle } from '../../../extensions/sentinels/capital-health/computes/cash-conversion-cycle';

/** 阈值单源（#732）：manifest.thresholds.cash_conversion_cycle_days 基线值，显式传入（compute 已无字面阈值） */
const THRESHOLDS = { warning: 90, critical: 120 };

describe('D358 compute-cash-conversion-cycle（迁自 _extinct/capital-turnover，死代码接线）', () => {
  it('正常: CCC 43 天 → healthy', () => {
    // 原算法 verbatim: 未取整求和后 Math.round —— dio=91.25, dso=73, dpo=121.67 → 42.58 → round 43
    const r = computeCashConversionCycle({
      cogs: 120, inventory: 30, receivables: 20, accounts_payable: 40, total_revenue: 100,
    }, THRESHOLDS);
    expect(r.degraded).toBe(false);
    expect(r.cccDays).toBe(43);
    expect(r.signal).toBe('healthy');
  });

  it('正常: CCC 243 天 → critical', () => {
    // dio=91.25, dso=182.5, dpo=30.42 → 243.33 → round 243（signal 判定用未取整和 243.33 > 120）
    const r = computeCashConversionCycle({
      cogs: 120, inventory: 30, receivables: 50, accounts_payable: 10, total_revenue: 100,
    }, THRESHOLDS);
    expect(r.cccDays).toBe(243);
    expect(r.signal).toBe('critical');
  });

  it('降级: revenue<=0 且 cogs<=0 → degraded', () => {
    const r = computeCashConversionCycle({
      cogs: 0, inventory: 0, receivables: 0, accounts_payable: 0, total_revenue: 0,
    }, THRESHOLDS);
    expect(r.degraded).toBe(true);
  });

  it('边界: CCC 恰好 91（刚过 warning 线）→ warning', () => {
    // dio=365/(100/25)=91, dso/dpo=0 → ccc=91 >90
    const r = computeCashConversionCycle({
      cogs: 100, inventory: 25, receivables: 0, accounts_payable: 0, total_revenue: 100,
    }, THRESHOLDS);
    expect(r.degraded).toBe(false);
    expect(r.cccDays).toBe(91);
    expect(r.signal).toBe('warning');
  });
});
