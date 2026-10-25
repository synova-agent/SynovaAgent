/**
 * tests/services/clock.test.ts — Q-6 配对测试：`src/services/clock.ts` 的 systemClock
 *
 * 判据来源：#915 Q-6 规格 v2（`2026-10-25-规格-915-Q6-时间可注入-v2.md` §2/§5.1）＋ 裁 365。
 * 配对实现：`src/services/clock.ts`（本文件只读它，不改 src）。
 *
 * 覆盖（S1 的"真实时钟"面，注入面在 tests/contract/clock-injection.test.ts）：
 *   U1 now() 与 Date.now() 同源（差值 ≤ 1000ms）
 *   U2 nowIso() 是 ISO-8601 UTC 严格形状，且解析回 epoch 与 now() 同源
 *   U3 默认时钟回归：导出面最小（仅 now/nowIso）、恒抛不抛、落在真实时间窗内
 *
 * 设计哲学：一个分离 ＋ 两条承诺 ——
 *   分离：本测试只依赖 `Clock` 的两个方法，不窥探实现内部、不 mock 全局时钟；
 *   承诺 ① 同源：`now()` 与 `nowIso()` 必须反映**同一**系统时钟（用可证的时间窗断言）；
 *   承诺 ② 稳定：`nowIso()` 恒为 ISO-8601 UTC（`toISOString` 语义），不随 TZ/LANG 变。
 *
 * @known-limitations
 *   - 系统时钟**非单调**：本文件只做 ±1000ms 窗口断言，不断言"严格递增"；
 *     真实 NTP 校时若在一次断言内步进 >1s，本测试会红（有意暴露环境异常，不静默放宽）。
 *   - 不校验 `nowIso()` 的时区无关性之外的格式化细节（locale 不影响 toISOString）。
 *   - 不覆盖注入行为（S2–S4）与棘轮（R1–R6）：分别在本目录外的两个契约测试里。
 */
import { describe, it, expect } from 'vitest';

import { systemClock } from '../../src/services/clock';

/** 同源容差（毫秒）：CI 抖动远小于此；单次调用间隔通常为 0–1ms */
const MAX_SKEW_MS = 1_000;

/** ISO-8601 UTC 严格形状：`YYYY-MM-DDTHH:mm:ss.sssZ`（`toISOString` 的固定 24 字符形） */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('U systemClock：真实系统时钟（全仓唯一允许直取处）', () => {
  it('U1 now() 与 Date.now() 同源（差值 ≤ 1000ms，epoch 毫秒整数）', () => {
    const before = Date.now();
    const got = systemClock.now();
    const after = Date.now();

    expect(typeof got).toBe('number');
    expect(Number.isFinite(got)).toBe(true);
    expect(Number.isInteger(got)).toBe(true); // epoch 毫秒：整数（Date 语义）
    // 不自证：与前后两侧真实读数都必须落在窗口内（不假设调用方向，避免时钟微步进导致假红）
    expect(Math.abs(got - before)).toBeLessThanOrEqual(MAX_SKEW_MS);
    expect(Math.abs(got - after)).toBeLessThanOrEqual(MAX_SKEW_MS);
  });

  it('U2 nowIso() 是 ISO-8601 UTC 严格形状，且解析回 epoch 与 now() 同源', () => {
    const iso = systemClock.nowIso();
    const epochFromIso = Date.parse(iso);

    expect(iso).toMatch(ISO_UTC_RE);
    expect(iso).toHaveLength(24); // toISOString 固定形，不含偏移量文本
    expect(iso.endsWith('Z')).toBe(true); // 恒 UTC（不做本地化/时区格式化）
    expect(Number.isFinite(epochFromIso)).toBe(true);
    // 同源取证：ISO 规范形往返不变，且与 now() 的差值在窗口内
    expect(new Date(iso).toISOString()).toBe(iso);
    expect(new Date(epochFromIso).getTime()).toBe(epochFromIso);
    expect(Math.abs(epochFromIso - systemClock.now())).toBeLessThanOrEqual(MAX_SKEW_MS);
  });

  it('U3 默认时钟回归：导出面只有 now/nowIso（注入契约最小面），且落在真实时间窗内', () => {
    expect(Object.keys(systemClock).sort()).toEqual(['now', 'nowIso']);
    expect(() => systemClock.now()).not.toThrow();
    expect(() => systemClock.nowIso()).not.toThrow();
    // 两次取值不倒退（同一进程内的真实时钟；容差内只证"活着且可用"）
    const t1 = systemClock.now();
    const t2 = systemClock.now();
    expect(t2).toBeGreaterThanOrEqual(t1);
    // 不可能是伪造的固定时间：真实时钟必然晚于 2020-01-01、早于 2100-01-01
    expect(systemClock.now()).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
    expect(systemClock.now()).toBeLessThan(Date.parse('2100-01-01T00:00:00Z'));
  });
});
