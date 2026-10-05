/**
 * tests/sentinel/builtins.test.ts — 内置哨兵注册测试
 *
 * Iron Law 33: *.test.ts = 单元测试
 *
 * 测试:
 *   Given: 扫描 adapters/ 目录 → 注册发现的哨兵
 *   Given: 注册后 → Then: 每个哨兵有唯一 ID、有效 cron、明确类别
 *
 * #977 回归护栏 (2026-10-04):
 *   修前实测 registered=0 / scanned=4 —— 4 个内置适配器全部注册失败（导出名 ≠ 文件名推导键）。
 *   而本文件原有的「每个哨兵有唯一 ID 和有效类别」断言在**空列表**上循环 ⇒ **空转绿**，
 *   所以 0 哨兵也能全绿通过。现在是「发现 N 个适配器文件 ⇒ 必须注册上 N 个」，
 *   空转与漏注册都必红。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync } from 'fs';

import { getSentinelRegistry, destroySentinelRegistry } from '../../src/sentinel/registry';
import { registerBuiltinSentinels } from '../../src/sentinel/builtins';

/** adapters/ 下的 4 个内置适配器 —— 其真实导出名与文件名词干**不一致**（#977 根因） */
const BUILTIN_ADAPTER_IDS = [
  'sentinel-cash-flow',          // cash-flow-sentinel.ts          → cashFlowSentinel
  'sentinel-cpc',                // cpc-sentinel.ts                → cpcSentinel
  'sentinel-goal-alignment',     // goal-alignment-sentinel.ts     → goalalignmentSentinel (小写 L)
  'sentinel-integration-health', // integration-health-sentinel.ts → integrationHealthSentinel
];

/** 与 builtins.ts 的磁盘扫描口径逐字一致（同一 filter，同一目录） */
function adapterFileCount(): number {
  const dir = new URL('../../src/sentinel/adapters/', import.meta.url);
  return readdirSync(dir).filter(f => f.endsWith('-sentinel.ts') || f.endsWith('-sentinel.js')).length;
}

describe('registerBuiltinSentinels', () => {
  beforeEach(() => {
    destroySentinelRegistry();
  });

  it('Given 生产入口 registerBuiltinSentinels → 4 个内置适配器必须全部真注册上 (#977 回归护栏)', async () => {
    const scanned = adapterFileCount();
    expect(scanned).toBeGreaterThan(0); // 目录空了本身就是坏点

    await registerBuiltinSentinels();
    const ids = getSentinelRegistry().list().map(s => s.config.id);

    expect(ids.length).toBeGreaterThan(0);              // 防「空列表空转绿」
    for (const expected of BUILTIN_ADAPTER_IDS) {
      expect(ids).toContain(expected);                  // 退回「只按文件名推导」在此必红
    }
    // 发现 N 个文件就必须注册上 N 个 —— 漏注册一个即红
    expect(getSentinelRegistry().count()).toBe(scanned);
  });

  it('Given 注册后 → 每个哨兵有唯一 ID 和有效类别', async () => {
    await registerBuiltinSentinels();
    const list = getSentinelRegistry().list();
    expect(list.length).toBeGreaterThan(0); // #977: 空列表曾使本断言空转通过

    const ids = new Set<string>();
    const validCategories = new Set(['collaboration', 'capability', 'strategy', 'risk', 'health', 'data-quality', 'growth']);
    for (const s of list) {
      expect(ids.has(s.config.id)).toBe(false);
      ids.add(s.config.id);
      expect(s.config.id).toMatch(/^sentinel-/);
      expect(validCategories.has(s.config.category)).toBe(true);
      expect(s.config.mode).toBe('cron');
      expect(s.config.cron).toBeTruthy();
    }
  });

  it('Given 两次调用 registerBuiltinSentinels → 覆盖旧哨兵不抛异常', async () => {
    await registerBuiltinSentinels();
    const afterFirst = getSentinelRegistry().count();
    expect(afterFirst).toBeGreaterThan(0); // #977: 0 → 0 也是「相等」，不加这条就是空转绿
    await registerBuiltinSentinels();
    expect(getSentinelRegistry().count()).toBe(afterFirst);
  });
});
