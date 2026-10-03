/**
 * tests/loops/main-agent-binding.test.ts — #975 进程级绑定三态
 *
 * 覆盖: 未绑定（降级可观测，返回 null 不抛）· 绑定可读回同一实例 · 传 null 清除绑定
 */
import { describe, it, expect, afterEach } from 'vitest';
import { bindMainAgent, getBoundMainAgent, type LoopExecutorLike } from '../../src/loops/main-agent-binding';

function makeExecutor(status = 'stub'): LoopExecutorLike {
  return {
    executeLoopScale: async () => ({ status }),
    executeLoop: async () => ({ status: `${status}-fallback` }),
  };
}

describe('main-agent-binding (#975 0-1 循环点火)', () => {
  afterEach(() => { bindMainAgent(null); });

  it('未绑定 → null（调用方须 log.warn + 跳过，禁静默）', () => {
    bindMainAgent(null);
    expect(getBoundMainAgent()).toBeNull();
  });

  it('绑定后可读回同一实例（幂等，后写覆盖前写）', () => {
    const first = makeExecutor('first');
    const second = makeExecutor('second');
    bindMainAgent(first);
    expect(getBoundMainAgent()).toBe(first);
    bindMainAgent(second);
    expect(getBoundMainAgent()).toBe(second);
  });

  it('传 null 清除绑定（停机/测试复位）', () => {
    bindMainAgent(makeExecutor());
    expect(getBoundMainAgent()).not.toBeNull();
    bindMainAgent(null);
    expect(getBoundMainAgent()).toBeNull();
  });
});
