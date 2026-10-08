/**
 * tests/sentinels/shared/assert-finite-inputs.test.ts — #1408 助手单测（配对：extensions/sentinels/shared/computes/x.ts → tests/sentinels/shared/x.test.ts）
 * 口径：被测对象 = **助手返回的问题清单**（纯函数，无副作用）。
 */
import { describe, it, expect } from 'vitest';
import { checkFiniteInputs, checkRequiredFields } from '../../src/sentinel/assert-finite-inputs';

describe('#1408 checkFiniteInputs（输入有效性检查助手）', () => {
  it('正常入参 ⇒ 空清单（**不得误报**）', () => {
    expect(checkFiniteInputs({ total_revenue: 1000, gross_margin: 400 }, ['total_revenue', 'gross_margin'])).toEqual([]);
  });
  it('缺字段 ⇒ 命中（逐字段点名）', () => {
    expect(checkFiniteInputs({ total_revenue: 1000 }, ['total_revenue', 'gross_margin'])).toEqual(['缺字段: gross_margin']);
  });
  it('NaN / Infinity ⇒ 命中（**纠错值也要管**）', () => {
    expect(checkFiniteInputs({ v: NaN }, ['v'])).toEqual(['非有限数: v=NaN']);
    expect(checkFiniteInputs({ v: Infinity }, ['v'])).toEqual(['非有限数: v=Infinity']);
  });
  it('行数组 ⇒ 逐行检查（带行号）+ 空数组 ⇒ 命中', () => {
    expect(checkFiniteInputs([{ v: 1 }, { v: NaN }], ['v'])).toEqual(['非有限数: #1.v=NaN']);
    // #1408 口径：**空数组不在此处报**（交回各 compute 自己的"无数据"守卫 ⇒ 不改既有降级语义）
    expect(checkFiniteInputs([], ['v'])).toEqual([]);
  });
  it('不抛异常（null/非对象行 ⇒ 记一条清单，不崩）', () => {
    expect(checkFiniteInputs([null as unknown as Record<string, unknown>], ['v'])).toEqual(['#0.入参非对象']);
  });
  it('🔴 存在性维度（checkRequiredFields）：缺 type/props ⇒ 有信号；**不要求数值**（boolean/string 亦可）', () => {
    expect(checkRequiredFields({ type: 'BusinessModel', props: {} }, ['type', 'props'])).toEqual([]);
    expect(checkRequiredFields({ props: {} }, ['type', 'props'])).toEqual(['缺字段: type']);
    expect(checkRequiredFields([{ category: 'core', inHouse: false }], ['category', 'inHouse']), 'false 是合法值（存在性只看 undefined/null）').toEqual([]);
    expect(checkRequiredFields([{ category: 'core' }], ['category', 'inHouse'])).toEqual(['缺字段: #0.inHouse']);
  });
});
