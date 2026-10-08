/**
 * tests/l4/sog-schema-validator.test.ts — #980 / 0-6 SOG schema 校验器"可见降级"（单元）
 *
 * 契约（铁律 47）:
 *   validateNodeProps(nodeType, props): ValidationError[]
 *     - 已覆盖（NODE_SCHEMAS 命中）: 行为与改造前逐字一致, 返回 0..N 条错误, 元素**不带** degraded 字段
 *     - 未覆盖（!NODE_SCHEMAS[nodeType]）: 登记模块级聚合器, 返回**单元素**数组
 *       [{ nodeType, field:'*', value:null, expected:'schema 未覆盖 — 放行 (degraded)', degraded:true }], 绝不抛
 *   validateAndLog(nodeType, props): boolean
 *     - 仅当硬错误（非 degraded）> 0 → false + 逐条 log.warn 含"校验失败"
 *     - 无错 或 **仅降级** → true（不阻断）；未覆盖路径**不得**出现"校验失败"文案  ← 自验 E2 高危缺口
 *   getUncoveredTypeStats(): { uncoveredTypes: string[]; count: number }  — 首见序, distinct 去重
 *   resetUncoveredTypeStats(): void                                        — 归零（测试隔离）
 *   聚合告警（边沿触发, 禁逐条刷屏）: 全局首个未覆盖类型 1 条 + 每新增 20 种汇总 1 条
 *
 * 铁律 48: 正常路径 U1 / 违规路径 U2 / 降级路径 U3-U6 / 边界与隔离 U7 — 全部真实 expect()
 * 铁律 38: 零 as any / as never / as unknown as（logger 单例经 vi.hoisted 共享, 不做强制断言取回）
 * 先例: tests/sentinel/ticket-store.test.ts:25-33（vi.hoisted + vi.mock('@synova/logger') 范式）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// logger mock 单例 — 被测模块与测试共享同一实例（createLogger 每次返回 logMock）
const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@synova/logger', () => ({ logger: logMock, createLogger: vi.fn(() => logMock) }));

import {
  validateNodeProps,
  validateAndLog,
  getUncoveredTypeStats,
  resetUncoveredTypeStats,
} from '../../src/l4/sog-schema-validator';

/** 全部 warn 的消息体（第 2 参数 = 判据子串所在位） */
function warnMessages(): string[] {
  return logMock.warn.mock.calls.map(c => String(c[1]));
}

function countMessages(needle: string): number {
  return warnMessages().filter(m => m.includes(needle)).length;
}

beforeEach(() => {
  resetUncoveredTypeStats();
  logMock.warn.mockClear();
});

describe('#980 SOG schema 校验器 — 已知 schema 路径（正常/违规）', () => {
  it('U1 已知 schema + 合法 props ⇒ 0 错误 / validateAndLog true / 无 degraded 元素 / 零告警', () => {
    const errors = validateNodeProps('GOAL', { name: 'g1', progress: 50 });

    expect(errors).toHaveLength(0);
    expect(errors.filter(e => e.degraded === true)).toHaveLength(0);
    expect(validateAndLog('GOAL', { name: 'g1', progress: 50 })).toBe(true);

    // 已知 schema 路径不得触碰聚合器 / 不得告警
    expect(getUncoveredTypeStats().count).toBe(0);
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('U2 已知 schema + 违规 props ⇒ 有错误 / 元素不含 degraded 字段 / validateAndLog false / warn 含 校验失败', () => {
    const errors = validateNodeProps('GOAL', { name: 'g1', progress: 150 });

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].nodeType).toBe('GOAL');
    for (const e of errors) {
      // "不含" 而非 "为 falsy"：字段必须不存在（契约 1: 已有 8 个 schema 的报错元素不得带该字段）
      expect('degraded' in e).toBe(false);
    }

    expect(validateAndLog('GOAL', { name: 'g1', progress: 150 })).toBe(false);
    expect(countMessages('校验失败')).toBeGreaterThanOrEqual(1);
    // 违规路径同样不登记聚合器
    expect(getUncoveredTypeStats().count).toBe(0);
  });
});

describe('#980 SOG schema 校验器 — 未覆盖类型路径（降级）', () => {
  it('U3 未覆盖类型 ⇒ 单元素 degraded / validateAndLog true（E2 关键）/ 登记聚合器 / 无假失败告警', () => {
    const errors = validateNodeProps('resource/money', {});

    expect(errors).toHaveLength(1);
    expect(errors[0].nodeType).toBe('resource/money');
    expect(errors[0].field).toBe('*');
    expect(errors[0].value).toBeNull();
    expect(errors[0].expected).toBe('schema 未覆盖 — 放行 (degraded)');
    expect(errors[0].degraded).toBe(true);

    // E2 关键断言：未覆盖类型必须放行（true），不得被判为"校验失败"而阻断
    expect(validateAndLog('resource/money', {})).toBe(true);
    expect(countMessages('校验失败')).toBe(0);

    // 二次调用仍为同一类型 ⇒ distinct 不增长
    const stats = getUncoveredTypeStats();
    expect(stats.count).toBe(1);
    expect(stats.uncoveredTypes).toEqual(['resource/money']);

    // 首次命中告警的 extra 载荷（V3 定位用）
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    const extra = logMock.warn.mock.calls[0][0] as {
      nodeType?: string;
      uncoveredTypes?: unknown;
      uncoveredTypesCount?: number;
    };
    expect(extra.nodeType).toBe('resource/money');
    expect(Array.isArray(extra.uncoveredTypes)).toBe(true);
    expect(extra.uncoveredTypes).toEqual(['resource/money']);
    expect(extra.uncoveredTypesCount).toBe(1);
  });

  it('U4 去重聚合 ⇒ 同类型 ×5 + 另 1 种 = count 2（不是 6）/ 首见序', () => {
    for (let i = 0; i < 5; i++) validateNodeProps('resource/money', {});
    validateNodeProps('resource/person', {});

    const stats = getUncoveredTypeStats();
    expect(stats.count).toBe(2);
    expect(stats.uncoveredTypes).toHaveLength(2);
    expect(stats.uncoveredTypes).toEqual(['resource/money', 'resource/person']); // Map 首见序
  });

  it('U5 文案与假失败守卫 ⇒ 出现模板插值的 "未覆盖类型 20 个" 且"校验失败"出现 0 次', () => {
    for (let i = 0; i < 20; i++) validateNodeProps(`uncovered/type-${i}`, {});

    const summary = warnMessages().filter(m => /未覆盖类型 \d+ 个/.test(m));
    expect(summary.length).toBeGreaterThanOrEqual(1);
    // 模板字面量插值真实生效（非硬编码 "未覆盖类型 N 个"）
    expect(summary.some(m => m === '未覆盖类型 20 个')).toBe(true);

    // E2 守卫：整段未覆盖路径下不得出现任何"校验失败"文案
    expect(countMessages('校验失败')).toBe(0);
    expect(getUncoveredTypeStats().count).toBe(20);
  });

  it('U6 不刷屏上界 ⇒ 40 种 distinct 各 1 次 = 恰好 3 条 warn（1 + ceil(40/20)）', () => {
    for (let i = 0; i < 40; i++) validateNodeProps(`uncovered/type-${i}`, {});

    expect(getUncoveredTypeStats().count).toBe(40);
    const calls = logMock.warn.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3);
    expect(calls).toBe(3); // 1（全局首次）+ 20 个汇总 + 40 个汇总

    // 逐条刷屏反证：每条 warn 都含判据子串, 且无假失败
    for (const m of warnMessages()) expect(m).toContain('未覆盖类型');
    expect(countMessages('校验失败')).toBe(0);
  });

  it('U7 隔离 ⇒ reset 后计数归零、类型清单清空、再次写入从 1 重新开始', () => {
    validateNodeProps('resource/money', {});
    validateNodeProps('resource/person', {});
    expect(getUncoveredTypeStats().count).toBe(2);

    resetUncoveredTypeStats();
    expect(getUncoveredTypeStats().count).toBe(0);
    expect(getUncoveredTypeStats().uncoveredTypes).toEqual([]);

    logMock.warn.mockClear();
    validateNodeProps('resource/knowledge', {});
    expect(getUncoveredTypeStats().count).toBe(1);
    expect(getUncoveredTypeStats().uncoveredTypes).toEqual(['resource/knowledge']);
    // reset 后视为全新的"首次命中" ⇒ 再次告警
    expect(warnMessages().some(m => m.includes('未覆盖类型'))).toBe(true);
  });
});
