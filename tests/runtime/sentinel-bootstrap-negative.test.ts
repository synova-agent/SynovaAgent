/**
 * tests/runtime/sentinel-bootstrap-negative.test.ts — M5 卡1（#704）单测级负例（**非全链路**）
 *
 * 为什么单独成文件：`vi.mock` 是**文件级 hoist**（对齐 tests/sentinel/sentinel-service-closure.test.ts:16
 * 已验证的手法）—— 本文件把 `src/sentinel/registry` 整体换成"访问即抛"，用来证明自举／清单在
 * registry 不可用时**诚实报错**，而不是抛异常或把 0 条当成功。
 *
 * 契约:
 *   @input  — src/agent/sentinel-service.ts `ensureSentinelRegistryLoaded()` / `listSentinels()`
 *   @output — 2 条用例：
 *             ④ ensure ⇒ ok:false ∧ code='SENTINEL_BOOTSTRAP_FAILED' ∧ errors 非空（从不抛）
 *             ⑤ listSentinels ⇒ { ok:false, total:0, sentinels:[] }
 *   @degraded — 两条都断言降级信号（ok:false ＋ degraded 语义由形状体现，铁律 24/31）
 *   @error  — 无（两个入口契约都不抛；抛即测试红）
 *
 * 层级标注：单测级（registry 被 mock）—— **不得**用本文件冒充全链路负例；
 * 全链路负例在 tests/mcp/server-smoke.test.ts 的 S9（spawn 真子进程 + 不可用 fixture 目录）。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/sentinel/registry', () => ({
  getSentinelRegistry: () => {
    throw new Error('REGISTRY_UNAVAILABLE');
  },
  destroySentinelRegistry: () => {
    /* noop — 负例不需要隔离真实 registry（本文件从不装载它） */
  },
  SentinelRegistryImpl: class {
    /* 形状占位：被测入口只经 getSentinelRegistry() 访问注册表 */
  },
}));

describe('单测级，非全链路：registry 不可用', () => {
  it('④ 单测级，非全链路：registry 抛错 ⇒ ensureSentinelRegistryLoaded() ok:false（code=FAILED）', async () => {
    const { ensureSentinelRegistryLoaded } = await import('../../src/agent/sentinel-service');
    const result = await ensureSentinelRegistryLoaded();

    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.code).toBe('SENTINEL_BOOTSTRAP_FAILED');
    expect(result.errors.length).toBeGreaterThan(0);
    // 错误信息来源可核：原始异常消息被收进 errors（不吞异常原因）
    expect(result.errors.join(' | ')).toContain('REGISTRY_UNAVAILABLE');
    // registry 不可用 ⇒ 计数保持 0（不虚构数字）
    expect(result.total).toBe(0);
    expect(result.dirCount).toBe(0);
    expect(result.builtinCount).toBe(0);
  });

  it('⑤ 单测级，非全链路：registry 抛错 ⇒ listSentinels() ⇒ {ok:false,total:0,sentinels:[]}', async () => {
    const { listSentinels } = await import('../../src/agent/sentinel-service');
    const result = await listSentinels();

    expect(result).toEqual({ ok: false, total: 0, sentinels: [] });
    expect(result.ok).toBe(false);
    expect(result.total).toBe(0);
    expect(result.sentinels).toHaveLength(0);
  });
});
