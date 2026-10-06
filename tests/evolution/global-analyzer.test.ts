/**
 * tests/evolution/global-analyzer.test.ts
 *
 * K6/3-12 用例集（三路径: 正常 / 降级 / 边界）:
 *   既有: aggregateIndustryBaseline / writeIndustryThresholds（原「空壳用例」已补实）
 *   E2  : discoverCrossCustomerPatterns —— 跨客户模式发现（自动枚举 org）
 *   E3  : exportFederatedStats / importFederatedStats —— 联邦匿名统计导出/导入
 *
 * 变异体锚点（改坏即红）:
 *   M3-12 —— 把「自动枚举 org」退回单组织（例如退回 ['default']）⇒ E2 首个用例的
 *            orgsConsidered / patterns 断言立刻变红（见回执里的绿/红两段原始输出）。
 *
 * 导入路径说明: index.ts 不在 K6/3-12 写集内（不越界改文件），故新增 API 走源文件深路径导入。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { aggregateIndustryBaseline, writeIndustryThresholds } from '@synova/evolution';
import type { AgentMemoryStoreLike, IndustryBaseline, PerSentinelStats } from '@synova/evolution';
import {
  discoverCrossCustomerPatterns,
  exportFederatedStats,
  importFederatedStats,
  FEDERATED_STATS_SCHEMA_VERSION,
} from '../../packages/evolution/src/global-analyzer';
import type {
  CrossCustomerDiscoveryResult,
  DiscoverCrossCustomerOptions,
  FederatedStatsBundle,
  ImportFederatedStatsResult,
  OrgEnumeratingStoreLike,
} from '../../packages/evolution/src/global-analyzer';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// ═══ 工作树卫生: writeIndustryThresholds 按 cwd 真实写 extensions/industries/** ═══
// 该函数没有目录注入缝（生产语义就是写真实扩展目录），测试运行会脏化被跟踪文件。
// 这里 beforeAll 快照、afterAll 还原 —— 保持工作树干净，且不改变被测语义。
const TOUCHED_THRESHOLD_FILES = [
  join(process.cwd(), 'extensions', 'industries', 'saas-tech', 'thresholds.json'),
  join(process.cwd(), 'extensions', 'industries', 'test-write', 'thresholds.json'),
];
const _thresholdSnapshots = new Map<string, string | null>();

beforeAll(() => {
  for (const file of TOUCHED_THRESHOLD_FILES) {
    _thresholdSnapshots.set(file, existsSync(file) ? readFileSync(file, 'utf-8') : null);
  }
});

afterAll(() => {
  for (const file of TOUCHED_THRESHOLD_FILES) {
    const snapshot = _thresholdSnapshots.get(file) ?? null;
    if (snapshot === null) {
      if (existsSync(file)) unlinkSync(file);
    } else {
      writeFileSync(file, snapshot, 'utf-8');
    }
  }
});

/**
 * 模拟 L3WriteAPI — 返回固定哨兵统计用于测试聚合逻辑。
 */
function mockL3(stats: Array<{ sentinelId: string; values: number[] }>) {
  return {
    closeTicket: async () => 0,
    getThreshold: async () => ({ warning: 0.5, critical: 1.0 }),
    updateThreshold: async () => {},
    getSentinelStats: async (industry: string) => {
      return stats.map(s => {
        const sorted = [...s.values].sort((a, b) => a - b);
        const n = sorted.length;
        return {
          sentinelId: s.sentinelId,
          name: s.sentinelId,
          orgCount: n,
          values: sorted,
          median: sorted[Math.floor(n / 2)] || 0,
          p25: sorted[Math.floor(n * 0.25)] || 0,
          p75: sorted[Math.floor(n * 0.75)] || 0,
        };
      });
    },
  };
}

describe('global-analyzer', () => {
  describe('aggregateIndustryBaseline', () => {
    it('空数据 → 返回空基线 + 无建议', async () => {
      const result = await aggregateIndustryBaseline('test-industry', mockL3([]));
      expect(result.industry).toBe('test-industry');
      expect(result.sentinelStats).toEqual([]);
      expect(result.thresholdSuggestions).toEqual([]);
    });

    it('一个哨兵正常值 → 无调整建议（偏差 < 20%）', async () => {
      const result = await aggregateIndustryBaseline('saas-tech', mockL3([
        { sentinelId: 'F1_KZ', values: [1.8, 2.0, 1.9] },
      ]));
      // F1_KZ general critical = 2.0, median = 1.9, deviation = 5% → 不触发
      expect(result.thresholdSuggestions).toEqual([]);
    });

    it('一个哨兵显著偏离 → 生成调整建议', async () => {
      const result = await aggregateIndustryBaseline('saas-tech', mockL3([
        { sentinelId: 'F1_KZ', values: [1.0, 1.1, 1.2, 1.0, 1.1] },
      ]));
      // F1_KZ general critical = 2.0, median = 1.1, deviation = 45% → 触发
      expect(result.thresholdSuggestions.length).toBeGreaterThanOrEqual(1);
      if (result.thresholdSuggestions.length > 0) {
        expect(result.thresholdSuggestions[0].sentinelId).toBe('F1_KZ');
      }
    });
  });

  describe('writeIndustryThresholds', () => {
    it('正常路径: 写入扩展行业文件后读回 —— industry/aggregatedAt/建议值均落盘', () => {
      const baseline: IndustryBaseline = {
        industry: 'test-write',
        aggregatedAt: '2026-10-06T00:00:00.000Z',
        sentinelStats: [
          { sentinelId: 'F1_KZ', name: 'F1_KZ', orgCount: 6, values: [1, 1, 1, 1, 1, 1], median: 1, p25: 1, p75: 1 },
        ],
        thresholdSuggestions: [
          {
            sentinelId: 'F1_KZ',
            generalThreshold: { warning: 1.5, critical: 2.0 },
            industryMedian: 1,
            suggestion: '行业中位数偏离通用阈值',
          },
        ],
      };

      writeIndustryThresholds('test-write', baseline);

      const filePath = TOUCHED_THRESHOLD_FILES[1];
      expect(existsSync(filePath)).toBe(true);
      const written = JSON.parse(readFileSync(filePath, 'utf-8')) as {
        industry: string;
        aggregatedAt: string;
        thresholdOverrides: Record<string, { warning: number; critical: number }>;
      };
      expect(written.industry).toBe('test-write');
      expect(written.aggregatedAt).toBe('2026-10-06T00:00:00.000Z');
      // 建议值覆盖通用 critical —— 断言写盘内容与入参一致，而不是"函数没抛"
      expect(written.thresholdOverrides.F1_KZ.critical).toBe(1);
      expect(written.thresholdOverrides.F1_KZ.warning).toBe(1.5);
    });

    it('边界: 无哨兵统计 → thresholdOverrides 为空对象（不臆造哨兵）', () => {
      const baseline: IndustryBaseline = {
        industry: 'test-write',
        aggregatedAt: '2026-10-06T01:00:00.000Z',
        sentinelStats: [],
        thresholdSuggestions: [],
      };

      writeIndustryThresholds('test-write', baseline);

      const written = JSON.parse(readFileSync(TOUCHED_THRESHOLD_FILES[1], 'utf-8')) as {
        thresholdOverrides: Record<string, unknown>;
      };
      expect(Object.keys(written.thresholdOverrides)).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // K6/3-12 E2: 跨客户模式发现（自动枚举 org）
  // ═══════════════════════════════════════════════════════════════════

  describe('discoverCrossCustomerPatterns (K6/3-12 E2)', () => {
    it('正常路径: 未传 orgIds/enumerator，靠 store.listOrgs() 自动枚举 → 产出跨客户模式', async () => {
      const store = makeOrgStore({
        corrections: {
          'org-1': [correction('F1_KZ')],
          'org-2': [correction('F1_KZ')],
          'org-3': [correction('F1_KZ')],
          // 若「自动枚举」被退回单组织（旧语义 ['default']），这里返回空 ⇒ 模式数 0 ⇒ 本用例变红
          default: [],
        },
        listOrgs: () => ['org-1', 'org-2', 'org-3'],
      });

      const result: CrossCustomerDiscoveryResult = await discoverCrossCustomerPatterns(store);

      // 变异体 M3-12 锚点: 枚举账目必须等于被枚举到的 3 个组织
      expect(result.orgsConsidered).toEqual(['org-1', 'org-2', 'org-3']);
      expect(result.degraded).toBe(false);
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].sentinelId).toBe('F1_KZ');
      expect(result.patterns[0].orgCount).toBe(3);
      expect(result.patterns[0].orgIds).toEqual(['org-1', 'org-2', 'org-3']);
      expect(result.patterns[0].patternId).toBe('xcp_F1_KZ');
    });

    it('正常路径: 显式 orgIds 优先于 store.listOrgs()，门槛内多哨兵按确定性排序输出', async () => {
      const store = makeOrgStore({
        corrections: {
          'org-a': [correction('F1_KZ'), correction('T2_connector_coverage')],
          'org-b': [correction('F1_KZ'), correction('T2_connector_coverage')],
          'org-c': [correction('F1_KZ')],
        },
        listOrgs: () => ['should-not-be-used'],
      });

      const result = await discoverCrossCustomerPatterns(store, {
        orgIds: ['org-c', 'org-b', 'org-a'],
        minOrgs: 2,
      });

      expect(result.orgsConsidered).toEqual(['org-a', 'org-b', 'org-c']);
      expect(result.degraded).toBe(false);
      expect(result.patterns.map(p => p.sentinelId)).toEqual(['F1_KZ', 'T2_connector_coverage']);
      expect(result.patterns[0].orgCount).toBe(3);
      expect(result.patterns[1].orgCount).toBe(2);
    });

    it('正常路径: 注入式 orgEnumerator（异步）可用，且不再调用 store.listOrgs()', async () => {
      let listOrgsCalls = 0;
      const store = makeOrgStore({
        corrections: {
          'org-1': [correction('F1_KZ')],
          'org-2': [correction('F1_KZ')],
          'org-3': [correction('F1_KZ')],
        },
        listOrgs: () => { listOrgsCalls++; return ['org-1']; },
      });

      const result = await discoverCrossCustomerPatterns(store, {
        orgEnumerator: async () => ['org-1', 'org-2', 'org-3'],
      });

      expect(result.orgsConsidered).toEqual(['org-1', 'org-2', 'org-3']);
      expect(result.patterns).toHaveLength(1);
      expect(listOrgsCalls).toBe(0);
    });

    it('降级路径: 单个组织查询抛错 → degraded:true + orgsFailed 记录，其余组织照常产出', async () => {
      const store = makeOrgStore({
        corrections: {
          'org-1': [correction('F1_KZ')],
          'org-2': [correction('F1_KZ')],
          'org-3': [correction('F1_KZ')],
        },
        listOrgs: () => ['org-1', 'org-2', 'org-3', 'org-broken'],
        failOrgs: ['org-broken'],
      });

      const result = await discoverCrossCustomerPatterns(store);

      expect(result.degraded).toBe(true);
      expect(result.orgsFailed).toEqual(['org-broken']);
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].orgCount).toBe(3);
    });

    it('降级路径: orgEnumerator 抛错 → degraded:true，0 组织 0 模式，且不向外抛', async () => {
      const store = makeOrgStore({ corrections: {} });

      const result = await discoverCrossCustomerPatterns(store, {
        orgEnumerator: () => { throw new Error('enumerator down'); },
      });

      expect(result.degraded).toBe(true);
      expect(result.orgsConsidered).toEqual([]);
      expect(result.patterns).toEqual([]);
    });

    it('降级路径: 无任何组织枚举来源 → degraded:true（不再静默退化为单组织）', async () => {
      const store = makeOrgStore({
        corrections: { default: [correction('F1_KZ'), correction('F1_KZ'), correction('F1_KZ')] },
      });

      const result = await discoverCrossCustomerPatterns(store);

      expect(result.degraded).toBe(true);
      expect(result.orgsConsidered).toEqual([]);
      expect(result.patterns).toEqual([]);
    });

    it('降级路径: store.listOrgs() 返回空清单 → degraded:true，不猜组织', async () => {
      const store = makeOrgStore({ corrections: {}, listOrgs: () => [] });

      const result = await discoverCrossCustomerPatterns(store);

      expect(result.degraded).toBe(true);
      expect(result.orgsConsidered).toEqual([]);
      expect(result.patterns).toEqual([]);
    });

    it('边界: 2 个客户纠错（< 门槛 3）→ 不产出模式', async () => {
      const store = makeOrgStore({
        corrections: {
          'org-1': [correction('F1_KZ')],
          'org-2': [correction('F1_KZ')],
        },
        listOrgs: () => ['org-1', 'org-2'],
      });

      const result = await discoverCrossCustomerPatterns(store);

      expect(result.patterns).toEqual([]);
      expect(result.degraded).toBe(false);
    });

    it('边界: 组织清单含重复/空白 → 清洗为去重升序；corrupt 条目计数但不静默', async () => {
      const store = makeOrgStore({
        corrections: {
          'org-1': [correction('F1_KZ'), 'not-json', '{"findingId":"no-sentinel"}'],
          'org-2': [correction('F1_KZ')],
          'org-3': [correction('F1_KZ')],
        },
        listOrgs: () => ['org-3', 'org-1', 'org-2', 'org-1', '   '],
      });

      const result = await discoverCrossCustomerPatterns(store);

      expect(result.orgsConsidered).toEqual(['org-1', 'org-2', 'org-3']);
      expect(result.unparsableEntries).toBe(2);
      expect(result.patterns).toHaveLength(1);
    });

    it('边界: limitPerOrg / memoryType / tags 透传到 store.list()', async () => {
      const queries: Array<{ orgId: string; type?: string; tags?: string[]; limit?: number }> = [];
      const store = makeOrgStore({ corrections: {}, listOrgs: () => ['org-1'], listCalls: queries });

      const options: DiscoverCrossCustomerOptions = {
        limitPerOrg: 7,
        memoryType: 'user_correction',
        tags: ['k6'],
      };
      await discoverCrossCustomerPatterns(store, options);

      expect(queries).toHaveLength(1);
      expect(queries[0]).toEqual({ orgId: 'org-1', type: 'user_correction', tags: ['k6'], limit: 7 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // K6/3-12 E3: 联邦匿名统计导出/导入
  // ═══════════════════════════════════════════════════════════════════

  describe('exportFederatedStats (K6/3-12 E3)', () => {
    it('正常路径: 达门槛哨兵导出，未达门槛被丢弃；包内只有统计特征', () => {
      const result = exportFederatedStats({
        industry: 'saas-tech',
        sourceId: 'instance-w3',
        generatedAt: '2026-10-06T00:00:00.000Z',
        sentinelStats: [
          fedStat('F1_KZ', 6, 1.9),
          fedStat('T2_connector_coverage', 5, 0.42),
          fedStat('F3_revenue_quality', 2, 0.31), // 低于门槛 5 → 丢弃
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.degraded).toBe(false);
      const bundle: FederatedStatsBundle | null = result.bundle;
      if (!bundle) throw new Error('正常路径应产出 bundle');
      expect(bundle.schemaVersion).toBe(FEDERATED_STATS_SCHEMA_VERSION);
      expect(bundle.generatedAt).toBe('2026-10-06T00:00:00.000Z');
      expect(bundle.sourceId).toBe('instance-w3');
      expect(bundle.minOrgs).toBe(5);
      expect(bundle.sentinelStats.map(s => s.sentinelId)).toEqual(['F1_KZ', 'T2_connector_coverage']);
      // 匿名性: 条目只有统计特征字段，绝无 orgId / values / 客户标识
      expect(Object.keys(bundle.sentinelStats[0]).sort())
        .toEqual(['median', 'orgCount', 'p25', 'p75', 'sentinelId']);
      expect(JSON.stringify(bundle)).not.toContain('org-1');
    });

    it('正常路径: 导出的包可被 importFederatedStats 完整回读（导出→导入闭环）', () => {
      const exported = exportFederatedStats({
        industry: 'saas-tech',
        sourceId: 'instance-w3',
        sentinelStats: [fedStat('F1_KZ', 6, 1.9), fedStat('T2_connector_coverage', 5, 0.42)],
      });

      const imported: ImportFederatedStatsResult = importFederatedStats(exported.bundle);

      expect(imported.ok).toBe(true);
      expect(imported.applied).toBe(2);
      expect(imported.rejected).toBe(0);
      expect(imported.degraded).toBe(false);
      expect(imported.merged.map(s => s.sentinelId)).toEqual(['F1_KZ', 'T2_connector_coverage']);
      expect(imported.merged[0].median).toBe(1.9);
      expect(imported.merged[0].values).toEqual([]);
    });

    it('降级路径: 无统计 → EMPTY_STATS + degraded:true，bundle 为 null', () => {
      const result = exportFederatedStats({ industry: 'saas-tech', sentinelStats: [] });

      expect(result.ok).toBe(false);
      expect(result.bundle).toBeNull();
      expect(result.code).toBe('EMPTY_STATS');
      expect(result.degraded).toBe(true);
    });

    it('降级路径: 全部哨兵未达 k-匿名门槛 → K_ANONYMITY_TOO_LOW + degraded:true', () => {
      const result = exportFederatedStats({
        industry: 'saas-tech',
        sentinelStats: [fedStat('F1_KZ', 1, 1.9), fedStat('T2_connector_coverage', 4, 0.42)],
      });

      expect(result.ok).toBe(false);
      expect(result.bundle).toBeNull();
      expect(result.code).toBe('K_ANONYMITY_TOO_LOW');
      expect(result.degraded).toBe(true);
    });
  });

  describe('importFederatedStats (K6/3-12 E3)', () => {
    it('降级路径: 载荷不是对象（字符串）→ INVALID_BUNDLE + degraded:true，且不抛', () => {
      const result = importFederatedStats('not-a-bundle');

      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_BUNDLE');
      expect(result.applied).toBe(0);
      expect(result.rejected).toBe(0);
      expect(result.degraded).toBe(true);
    });

    it('降级路径: schema 版本不匹配 → SCHEMA_MISMATCH + degraded:true', () => {
      const result = importFederatedStats({
        schemaVersion: 'k6-federated-v0',
        sentinelStats: [fedStat('F1_KZ', 6, 1.9)],
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('SCHEMA_MISMATCH');
      expect(result.merged).toEqual([]);
      expect(result.degraded).toBe(true);
    });

    it('降级路径: sentinelStats 非数组 → INVALID_BUNDLE + degraded:true', () => {
      const result = importFederatedStats({
        schemaVersion: FEDERATED_STATS_SCHEMA_VERSION,
        sentinelStats: { F1_KZ: 1 },
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_BUNDLE');
      expect(result.degraded).toBe(true);
    });

    it('边界: 空数组 → EMPTY_BUNDLE（不是"成功导入 0 条"）', () => {
      const result = importFederatedStats({
        schemaVersion: FEDERATED_STATS_SCHEMA_VERSION,
        sentinelStats: [],
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('EMPTY_BUNDLE');
      expect(result.degraded).toBe(true);
    });

    it('边界: 单条未达 k-匿名门槛 → 该条被拒 + ALL_REJECTED + degraded:true', () => {
      const result = importFederatedStats({
        schemaVersion: FEDERATED_STATS_SCHEMA_VERSION,
        sentinelStats: [fedStat('F1_KZ', 4, 1.9)], // 4 < 5
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('ALL_REJECTED');
      expect(result.applied).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.degraded).toBe(true);
    });

    it('边界: 部分条目非法 → 部分采纳（ok:true）+ rejected 计数 + degraded:true', () => {
      const result = importFederatedStats({
        schemaVersion: FEDERATED_STATS_SCHEMA_VERSION,
        sentinelStats: [
          fedStat('F1_KZ', 6, 1.9),
          fedStat('T2_connector_coverage', 3, 0.42), // 未达门槛
          { sentinelId: 'NaN_stat', orgCount: 9, median: Number.NaN, p25: 0, p75: 1 }, // NaN
          'garbage', // 非对象
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.rejected).toBe(3);
      expect(result.degraded).toBe(true);
      expect(result.merged.map(s => s.sentinelId)).toEqual(['F1_KZ']);
    });
  });
});

// ═══ 夹具 ═══

type MemoryEntry = { value: string; tags: string[]; type: string; key: string };

interface FakeOrgStoreOptions {
  corrections: Record<string, string[]>;
  listOrgs?: () => string[];
  failOrgs?: string[];
  listCalls?: Array<{ orgId: string; type?: string; tags?: string[]; limit?: number }>;
}

/** 最小 AgentMemoryStoreLike 替身（+ 可选 listOrgs 能力探测）。 */
function makeOrgStore(
  opts: FakeOrgStoreOptions,
): AgentMemoryStoreLike & OrgEnumeratingStoreLike {
  const store: AgentMemoryStoreLike & OrgEnumeratingStoreLike = {
    remember: () => undefined,
    recall: () => null,
    forget: () => false,
    list: (query: { orgId: string; type?: string; tags?: string[]; limit?: number }): MemoryEntry[] => {
      opts.listCalls?.push(query);
      if (opts.failOrgs?.includes(query.orgId)) {
        throw new Error(`list failed for ${query.orgId}`);
      }
      return (opts.corrections[query.orgId] ?? []).map((value, index) => ({
        value,
        tags: ['user_correction'],
        type: 'enterprise_fact',
        key: `${query.orgId}-${index}`,
      }));
    },
  };
  if (opts.listOrgs) store.listOrgs = opts.listOrgs;
  return store;
}

/** user_correction 记忆的载荷形态（global-analyzer 只读 sentinelId）。 */
function correction(sentinelId: string): string {
  return JSON.stringify({ sentinelId, findingId: `finding-${sentinelId}`, correctedClaims: ['阈值过高'] });
}

/** PerSentinelStats 夹具。 */
function fedStat(sentinelId: string, orgCount: number, median: number): PerSentinelStats {
  return {
    sentinelId,
    name: sentinelId,
    orgCount,
    values: [],
    median,
    p25: median - 0.1,
    p75: median + 0.1,
  };
}
