/**
 * tests/sentinels/make-or-buy.test.ts — make-or-buy-score 夹具
 * 🔴 本文件原为 **2 行空壳**（只有 import、无 `it()`）—— 门禁发现第 16 条（"新文件"限定 ⇒ 存量空壳永久存活）
 *    ⇒ #1408 批 C2b **补齐**（铁律 48：正常路径 + 降级路径 + 边界条件）
 *    同时它使 `computeMakeOrBuyScore` 的**声明可被核验**（CTO：手写 + 可核）
 */
import { describe, it, expect } from 'vitest';
import { computeMakeOrBuyScore } from '../../extensions/sentinels/make-or-buy/computes/make-or-buy-score';

describe('computeMakeOrBuyScore（#1408 批 C2b 补齐夹具）', () => {
  it('正常路径：核心能力自研 ⇒ health 0.8，outsourcedCore 空', () => {
    const r = computeMakeOrBuyScore([
      { category: 'core_competence', inHouse: true },
      { category: 'context', inHouse: false },
    ]);
    expect(r.degraded).toBe(false);
    expect(r.health).toBe(0.8);
    expect(r.outsourcedCore).toEqual([]);
    expect(r.totalCapabilities).toBe(2);
  });

  it('降级路径：空数组 ⇒ degraded + health 0.5', () => {
    const r = computeMakeOrBuyScore([]);
    expect(r.degraded).toBe(true);
    expect(r.health).toBe(0.5);
  });

  it('边界：核心能力外包 ⇒ health 下降且被点名', () => {
    const r = computeMakeOrBuyScore([{ category: 'core', inHouse: false }]);
    expect(r.outsourcedCore).toEqual(['core']);
    expect(r.health).toBeLessThan(0.8);
  });

  it('🔴 存在性维度（#1408）缺 `inHouse` ⇒ 有信号 + 降级（**不适用 ≠ 不管**）', () => {
    const r = computeMakeOrBuyScore([{ category: 'core' } as unknown as { category: string; inHouse: boolean }]);
    expect(r.degraded, '缺字段 ⇒ 必须降级').toBe(true);
    expect(r.signals?.join(' ') ?? '', '缺字段 ⇒ 必须留痕').toContain('缺字段');
  });
});
