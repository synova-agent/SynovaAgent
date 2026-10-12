/**
 * tests/cycles/valve-mapping.test.ts — #239（K4-06）五阀映射 ＋ 时滞**真消费**的机器化断言
 *
 * 契约:
 *   @input  — 只读：`cycles/**\/*.cycle.json`、`src/cycles/*.ts`
 *   @output — 断言通过 / 抛出；每个用例都有真 `expect()`，覆盖：正常路径 + 降级路径 + 边界
 *   @degraded — 原件缺失直接 fail（显式断言，不静默通过；铁律 11）
 *
 * 判别力（「删掉即报红」）:
 *   · 删任一 cycle 的任一阀字段 ⇒ §判据① 必红
 *   · 任一条 `actionEffectLag` 改成非法桶 ⇒ §判据③ 必红
 *   · **把 overflow-compute 的消费改回硬编码 ⇒ §「真消费」必红**（4 组对照：有/无 valves × 长/短时滞）
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { computeOverflow, computeValveLagProfile } from '../../src/cycles/overflow-compute';
import type { CycleConfig, EnterpriseTimeSeries } from '../../src/cycles/overflow-compute';
import { VALVE_KEYS, ACTION_EFFECT_LAG_RANGE_MONTHS } from '../../src/cycles/cycle-types';

const ROOT = process.cwd();
const CYCLES = join(ROOT, 'cycles');
const LAG_BUCKETS = Object.keys(ACTION_EFFECT_LAG_RANGE_MONTHS);
const EXPECTED_FILES = [
  'cycles/builtin/cash-cycle.cycle.json',
  'cycles/builtin/customer-cycle.cycle.json',
  'cycles/builtin/product-cycle.cycle.json',
  'cycles/builtin/talent-cycle.cycle.json',
  'cycles/industry/retail-ecommerce/store-replication.cycle.json',
  'cycles/industry/saas-tech/arr-growth.cycle.json',
];

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(full));
    else if (e.isFile() && e.name.endsWith('.cycle.json')) out.push(full);
  }
  return out;
}

describe('#239 判据①：六件 cycle 的五阀键齐备（逐字对齐 doc15 第一章 §3.4）', () => {
  it('恰 6 件，且路径集合与卡面写集一致', () => {
    const files = collect(CYCLES).map(f => f.split('\\').join('/').replace(ROOT.split('\\').join('/') + '/', ''));
    expect(files.sort()).toEqual([...EXPECTED_FILES].sort());
  });

  it('五阀键名逐字 = acquisition/allocation/conversion/delivery/recycleValve', () => {
    expect(VALVE_KEYS).toEqual([
      'acquisitionValve',
      'allocationValve',
      'conversionValve',
      'deliveryValve',
      'recycleValve',
    ]);
  });

  it('每件 5 键齐备、每阀 ≥1 条边、桶标签合法、edges[] 未被覆盖', () => {
    for (const rel of EXPECTED_FILES) {
      const p = join(ROOT, rel);
      expect(existsSync(p), `缺失: ${rel}`).toBe(true);
      const c = JSON.parse(readFileSync(p, 'utf-8')) as CycleConfig;
      // CTO 裁定：新 key 不覆盖既有 edges[]
      expect(Array.isArray(c.edges) && c.edges.length > 0, `${rel} edges[] 被覆盖/为空`).toBe(true);
      expect(c.valves, `${rel} valves 缺失`).toBeTruthy();
      for (const key of VALVE_KEYS) {
        const arr = c.valves![key];
        expect(Array.isArray(arr), `${rel}.valves.${key} 非数组`).toBe(true);
        expect(arr.length, `${rel}.valves.${key} 为空`).toBeGreaterThan(0);
        for (const e of arr) {
          expect(typeof e.edgeId, `${rel}.${key}.edgeId`).toBe('string');
          expect(e.edgeId.length).toBeGreaterThan(0);
          expect(LAG_BUCKETS, `${rel}.${key} 桶非法: ${String(e.actionEffectLag)}`).toContain(e.actionEffectLag);
        }
      }
    }
  });

  it('边界：桶集合恰 6 个，且含派单件曾漏掉的 `>12_months`', () => {
    expect(LAG_BUCKETS.length).toBe(6);
    expect(LAG_BUCKETS).toContain('>12_months');
    expect(ACTION_EFFECT_LAG_RANGE_MONTHS['>12_months']).toEqual({ minMonths: 12, maxMonths: null });
    expect(ACTION_EFFECT_LAG_RANGE_MONTHS.immediate).toEqual({ minMonths: 0, maxMonths: 0.5 });
  });

  it('桶口径锁定：规范 6 / 实用 5（`>12_months` 已定义、本轮 0 次使用）', () => {
    const hist = new Map<string, number>();
    for (const rel of EXPECTED_FILES) {
      const c = JSON.parse(readFileSync(join(ROOT, rel), 'utf-8')) as CycleConfig;
      for (const key of VALVE_KEYS) {
        for (const e of c.valves![key]) hist.set(e.actionEffectLag, (hist.get(e.actionEffectLag) ?? 0) + 1);
      }
    }
    expect(LAG_BUCKETS.length).toBe(6); // 规范 6 桶
    expect(hist.size).toBe(5); // 实用 5 桶
    expect(hist.has('>12_months')).toBe(false);
    expect(hist.get('1-3_months')).toBe(14);
    expect(hist.get('1_month')).toBe(10);
    expect(hist.get('3-6_months')).toBe(11);
    expect(hist.get('6-12_months')).toBe(5);
    expect(hist.get('immediate')).toBe(3);
    // 43 = 上述之和（与探针 TOTAL_valve_edges 同口径）
    expect([...hist.values()].reduce((a, b) => a + b, 0)).toBe(43);
  });
});

describe('#239 判据：computeValveLagProfile 读真值（不是空壳）', () => {
  const cash = JSON.parse(readFileSync(join(ROOT, EXPECTED_FILES[0]), 'utf-8')) as CycleConfig;

  it('cash-cycle 剖面：关键路径下界 = 6（来自 `6-12_months`），43 条边全局计数自洽', () => {
    const prof = computeValveLagProfile(cash);
    expect(prof.edgeCount).toBe(6);
    expect(prof.invalidEdgeCount).toBe(0);
    expect(prof.byValve.acquisitionValve).toBe(0); // E-05/E-06 immediate → min 0
    expect(prof.byValve.recycleValve).toBe(6); // E-37 6-12_months → min 6
    expect(prof.criticalPathMinMonths).toBe(6);
  });

  it('降级路径：valves 缺失 ⇒ 空剖面（不抛错、edgeCount=0、critical=null）', () => {
    const { valves, ...rest } = cash;
    void valves;
    const prof = computeValveLagProfile(rest as CycleConfig);
    expect(prof.edgeCount).toBe(0);
    expect(prof.criticalPathMinMonths).toBeNull();
    for (const k of VALVE_KEYS) expect(prof.byValve[k]).toBeNull();
  });

  it('降级路径：非法桶 ⇒ 计入 invalidEdgeCount，不抛错', () => {
    const broken = JSON.parse(JSON.stringify(cash)) as CycleConfig;
    (broken.valves!.recycleValve[0] as { actionEffectLag: string }).actionEffectLag = 'soon';
    const prof = computeValveLagProfile(broken);
    expect(prof.invalidEdgeCount).toBe(1);
    expect(prof.edgeCount).toBe(5);
    expect(prof.byValve.recycleValve).toBeNull();
  });

  it('全仓 6 件合计 43 条阀边（与探针 `TOTAL_valve_edges` 同口径）', () => {
    let total = 0;
    for (const rel of EXPECTED_FILES) {
      const c = JSON.parse(readFileSync(join(ROOT, rel), 'utf-8')) as CycleConfig;
      const prof = computeValveLagProfile(c);
      expect(prof.invalidEdgeCount).toBe(0);
      total += prof.edgeCount;
    }
    expect(total).toBe(43);
  });
});

describe('#239 判据：「接线了」≠「被执行」—— overflow-compute 真消费五阀（删掉即报红）', () => {
  const cash = JSON.parse(readFileSync(join(ROOT, EXPECTED_FILES[0]), 'utf-8')) as CycleConfig;

  /** 3 个月窗口的数据（`dataWindowMonths = 2 或 3`，均 < cash 的关键路径 6） */
  function series(months: number): EnterpriseTimeSeries {
    const dataPoints: Array<{ month: string; value: number }> = [];
    for (let i = months; i >= 0; i--) {
      const d = new Date(2026, 9 - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      dataPoints.push({ month, value: 100 - i });
    }
    return {
      dataPoints,
      currentNodeValues: { profit: -10, reinvestment: 3 },
      enterpriseId: 'test-org',
    };
  }

  it('有 valves + 短窗口 ⇒ 被消费：valveLagExceedsWindow=true、degraded=true', () => {
    const snap = computeOverflow(cash, series(3));
    expect(snap.valveLag).not.toBeNull();
    expect(snap.valveLag!.criticalPathMinMonths).toBe(6);
    expect(snap.dataWindowMonths).toBe(3);
    expect(snap.valveLagExceedsWindow).toBe(true);
    expect(snap.degraded).toBe(true);
  });

  it('【反例·硬编码】无 valves ⇒ 同一输入下 valveLagExceedsWindow=false、degraded=false', () => {
    const { valves, ...rest } = cash;
    void valves;
    const snap = computeOverflow(rest as CycleConfig, series(3));
    expect(snap.valveLag).toBeNull();
    expect(snap.valveLagExceedsWindow).toBe(false);
    expect(snap.degraded).toBe(false); // 若把消费改回硬编码（恒 false），本断言会与上一个用例一起失真
  });

  it('【反例·值被真读】把全部桶改成 immediate ⇒ 关键路径 0 ⇒ 同一输入不再降级', () => {
    const fast = JSON.parse(JSON.stringify(cash)) as CycleConfig;
    for (const k of VALVE_KEYS) {
      for (const e of fast.valves![k]) (e as { actionEffectLag: string }).actionEffectLag = 'immediate';
    }
    const snap = computeOverflow(fast, series(3));
    expect(snap.valveLag!.criticalPathMinMonths).toBe(0);
    expect(snap.valveLagExceedsWindow).toBe(false);
    expect(snap.degraded).toBe(false);
  });

  it('边界：窗口恰好等于关键路径 ⇒ 不降级（判据是 `<`，非 `≤`）', () => {
    const snap = computeOverflow(cash, series(6)); // 6 个间隔 = 6 个月
    expect(snap.dataWindowMonths).toBe(6);
    expect(snap.valveLagExceedsWindow).toBe(false);
    expect(snap.degraded).toBe(false);
  });
});
