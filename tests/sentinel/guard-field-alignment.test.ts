/**
 * tests/sentinel/guard-field-alignment.test.ts — #1398 批 2 判据：**守卫字段 ↔ 真源对齐**
 *
 * CTO 2026-10-08 裁 (a)：守卫 = **显式声明所需字段 + 判据强制对齐真源**
 *   （原裁定"从 compute 契约派生"**不可执行** —— 实测：compute 契约【不可机读】，只有 JSDoc/TS 类型）
 * 🔴 **判据边界（CTO 要求的诚实声明）**：
 *   本判据是【**单向**】的 —— 正向：守卫字段 ∈ 真源 props（不许有"读不到的字段"）✓
 *   **反向不可判**：**哪些真源字段【该被守卫却不在清单里】？** 它判不出来（因 compute 契约不可机读）
 *   ⇒ 那需要 (b)「给 compute 加可机读契约」⇒ 已登记为**将来方向**（挂 #1408；**它才能防"漏"**）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const TRUTH_PROPS = new Set<string>([
  ...Object.keys(JSON.parse(readFileSync('extensions/ontology/outcome/financial.json', 'utf-8')).optionalProps ?? {}),
  ...Object.keys(JSON.parse(readFileSync('extensions/ontology/resource/money.json', 'utf-8')).optionalProps ?? {}),
]);

/** 守卫字段：**从源码读真实清单**（避免"测试清单 vs 代码清单"两套 —— 今天母题） */
function readGuards(sentinel: string): string[] {
  const src = readFileSync(`extensions/sentinels/${sentinel}/aggregate.ts`, 'utf-8');
  const fields = new Set<string>();
  for (const m of src.matchAll(/fields:\s*\[([^\]]*)\]/g)) {
    for (const f of m[1].matchAll(/'([^']+)'/g)) fields.add(f[1]);
  }
  return [...fields];
}
const GUARDS: Record<string, string[]> = {
  'capital-health': readGuards('capital-health'),
  'margin-health': readGuards('margin-health'),
};

describe('#1398 批 2 · 守卫字段对齐真源（(a) 案；**反向不可判**已声明）', () => {
  it('V3【形态扫描·只证明形态】每个守卫字段 ∈ 真源 props；不在者必须登记（禁静默过滤）', () => {
    const unregistered: string[] = [];
    for (const [sentinel, fields] of Object.entries(GUARDS)) {
      for (const f of fields) {
        if (!TRUTH_PROPS.has(f)) unregistered.push(`${sentinel}.${f}`);
      }
    }
    // 🔴 静默过滤 = 静默降级的一种：不在真源 ⇒ **必须显式登记**（此断言即"登记口"）
    expect(GUARDS['capital-health'].length + GUARDS['margin-health'].length, '守卫清单不应为空（防扫空假过）').toBeGreaterThan(0);
    expect(unregistered, `守卫字段不在真源且未登记（禁静默过滤）：${unregistered.join(', ')}`).toEqual([]);
  });

  it('V3-b【形态·只证明形态】真源两侧并集已装载（防"夹具/真源读空"导致假绿）', () => {
    expect(TRUTH_PROPS.size, '真源 props 并集不应为空（防扫空文件假过）').toBeGreaterThan(30);
    expect(TRUTH_PROPS.has('operating_expense'), '真源应声明 operating_expense（单数）').toBe(true);
    expect(TRUTH_PROPS.has('operating_expenses'), '真源**不含**复数形态（这正是本批改名原因）').toBe(false);
  });
});
