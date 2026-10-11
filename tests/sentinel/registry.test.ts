/**
 * tests/sentinel/registry.test.ts — SentinelRegistry 单元测试 (P1-1)
 *
 * 铁律 0-2 Step 2: 先写测试, 再接线。
 * 铁律 33: *.test.ts → 单元测试 (纯函数, 无 I/O)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SentinelRegistryImpl,
  getSentinelRegistry,
  destroySentinelRegistry,
} from '../../src/sentinel';
import type { Sentinel, SentinelConfig, SentinelCheckResult, SentinelContext } from '../../src/sentinel';

// ═══ Test Helpers ═══

function makeConfig(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
  return {
    id: 'test-sentinel',
    name: '测试哨兵',
    description: '单元测试用哨兵',
    category: 'health',
    priority: 'P1',
    mode: 'cron',
    cron: '0 */6 * * *',
    requiredDataSources: [],
    confidenceModel: 'deterministic',
    version: '1.0.0',
    ...overrides,
  };
}

function makeSentinel(overrides: Partial<SentinelConfig> = {}): Sentinel {
  const config = makeConfig(overrides);
  return {
    config,
    async check(_ctx: SentinelContext): Promise<SentinelCheckResult> {
      return {
        sentinelId: config.id,
        ok: true,
        findings: [],
        durationMs: 0,
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

// ═══ Tests ═══

describe('SentinelRegistryImpl', () => {
  let registry: SentinelRegistryImpl;

  beforeEach(() => {
    registry = new SentinelRegistryImpl();
  });

  it('Given empty registry, When count, Then returns 0', () => {
    expect(registry.count()).toBe(0);
  });

  it('Given registered sentinel, When get, Then returns sentinel', () => {
    const s = makeSentinel({ id: 'health-check' });
    registry.register(s);
    expect(registry.count()).toBe(1);
    expect(registry.get('health-check')).toBe(s);
  });

  it('Given registered sentinel, When unregister, Then count returns 0', () => {
    const s = makeSentinel({ id: 'temp' });
    registry.register(s);
    registry.unregister('temp');
    expect(registry.count()).toBe(0);
    expect(registry.get('temp')).toBeUndefined();
  });

  // #1463 B7（2026-10-09）：语义由「覆盖旧实例」翻转为「显式跳过 + 计数」。
  // 旧断言是 `get('dup').config.name === 'v2'`（= 二次注册覆盖了首登实例）；
  // 该语义在真实生产里让 45 次重复注册**对注册面不可见**，故按 #1463 §判据 V2 翻转。
  it('Given duplicate registration, When register again, Then skips (idempotent) and counts', () => {
    const s1 = makeSentinel({ id: 'dup', name: 'v1' });
    const s2 = makeSentinel({ id: 'dup', name: 'v2' });
    registry.register(s1);
    registry.register(s2);
    expect(registry.count()).toBe(1);
    expect(registry.get('dup')).toBe(s1);              // 首登实例保留（修前此处 = s2）
    expect(registry.get('dup')!.config.name).toBe('v1');
    expect(registry.getDuplicateSkipCount()).toBe(1);  // 跳过可观测
  });

  it('Given multiple sentinels, When listByCategory, Then returns filtered', () => {
    registry.register(makeSentinel({ id: 'h1', category: 'health' }));
    registry.register(makeSentinel({ id: 'r1', category: 'risk' }));
    registry.register(makeSentinel({ id: 'h2', category: 'health' }));

    expect(registry.listByCategory('health').length).toBe(2);
    expect(registry.listByCategory('risk').length).toBe(1);
    expect(registry.listByCategory('compliance').length).toBe(0);
  });

  it('Given mixed priorities, When listByPriority, Then returns filtered', () => {
    registry.register(makeSentinel({ id: 'p0', priority: 'P0' }));
    registry.register(makeSentinel({ id: 'p1', priority: 'P1' }));
    registry.register(makeSentinel({ id: 'p2', priority: 'P2' }));

    expect(registry.listByPriority('P0').length).toBe(1);
  });

  it('Given cron-mode sentinels, When listCronSentinels, Then returns only cron', () => {
    registry.register(makeSentinel({ id: 'c1', mode: 'cron', cron: '0 * * * *' }));
    registry.register(makeSentinel({ id: 'e1', mode: 'event', cron: undefined }));
    registry.register(makeSentinel({ id: 'c2', mode: 'cron', cron: '*/30 * * * *' }));

    const cronList = registry.listCronSentinels();
    expect(cronList.length).toBe(2);
    expect(cronList.map(c => c.sentinel.config.id).sort()).toEqual(['c1', 'c2']);
  });

  it('Given sentinel.check, When check succeeds, Then returns ok=true with findings', async () => {
    const s: Sentinel = {
      config: makeConfig({ id: 'check-test' }),
      async check(_ctx) {
        return {
          sentinelId: 'check-test',
          ok: true,
          findings: [{
            id: 'f1',
            severity: 'warning',
            title: '测试发现',
            description: '发现了一个测试问题',
            evidence: ['证据1'],
            suggestion: '修复它',
            detectedAt: new Date().toISOString(),
          }],
          durationMs: 42,
          checkedAt: new Date().toISOString(),
        };
      },
    };
    const result = await s.check({ db: null, now: new Date() });
    expect(result.ok).toBe(true);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].severity).toBe('warning');
    expect(result.durationMs).toBe(42);
  });

  it('Given sentinel.check fails, When check, Then returns ok=false (never throws)', async () => {
    const s: Sentinel = {
      config: makeConfig({ id: 'fail-test' }),
      async check(_ctx) {
        return {
          sentinelId: 'fail-test',
          ok: false,
          findings: [],
          durationMs: 100,
          checkedAt: new Date().toISOString(),
          error: '数据库连接失败',
        };
      },
    };
    const result = await s.check({ db: null, now: new Date() });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('数据库连接失败');
    expect(result.findings).toHaveLength(0);
  });
});

describe('Global SentinelRegistry singleton', () => {
  beforeEach(() => {
    destroySentinelRegistry();
  });

  it('Given no registry, When getSentinelRegistry, Then creates singleton', () => {
    const r1 = getSentinelRegistry();
    const r2 = getSentinelRegistry();
    expect(r1).toBe(r2);
    expect(r1.count()).toBe(0);
  });

  it('Given registry with sentinels, When destroyed and recreated, Then fresh', () => {
    const r1 = getSentinelRegistry();
    r1.register(makeSentinel({ id: 'test' }));
    expect(r1.count()).toBe(1);

    destroySentinelRegistry();
    const r2 = getSentinelRegistry();
    expect(r2.count()).toBe(0);
  });
});
