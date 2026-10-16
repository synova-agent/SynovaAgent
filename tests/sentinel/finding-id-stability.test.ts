/**
 * tests/sentinel/finding-id-stability.test.ts — D580 8-3: aggregate finding.id 稳定化（N14 残留修复）
 *
 * 契约（铁律 47/48）: aggregate 产出的 finding.id = 内容稳定键（类别前缀, 无时间戳后缀）。
 *   同输入双跑（时间推进 >1min）→ id 逐元素相等; 同一轮内 id 互异; 降级/error 路径产出的 id 同样稳定。
 *
 * red 基准（S-5, D354 dedup-key-stability 同款）: 修复前 id 以 `-${now.getTime()}` / `-${Date.now()}`
 *   结尾 → 双跑 id 必异（red）; 修复后同输入同 id（green）。
 *
 * 消费传导（spec §4.2, 铁律 9）: finding.id → runner L909 findingById 重放索引 → finding_transition
 *   重放 L919-926 → migrateFindingStatus L951。id 不稳定 = finding 生命周期状态跨轮失效。
 *
 * 探针策略: 44 个 aggregate（43 含时间戳 + revenue-health 已稳定, 全量回归护栏）逐一调用 check——
 *   ① 空库 ② 抛错库（catch/降级分支）③ 单节点数据库 ④ 数据库+图遍历（key-person-risk 的
 *   DECISION_CONCENTRATES 等仅遍历路径产 id）。revenue-health 需 loader 同款 manifest 注入
 *   （sentinel-loader.ts L204 先例: sentinelObj.manifest = manifest）才会产出 finding。
 *   每文件至少一个探针产出 finding（防空调通过）; 每探针双跑 id 逐元素相等。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SentinelFinding } from '../../src/sentinel/types';

const T0 = new Date('2026-09-06T10:00:00.000Z');

// 全量扫描 extensions/sentinels/*/aggregate.ts（单层通配, _extinct/ 嵌套目录不入; 共 44 文件）
const aggregateModules = import.meta.glob('../../extensions/sentinels/*/aggregate.ts', {
  eager: true,
}) as Record<string, Record<string, unknown>>;

// manifest 注入（对齐 loader: 有 manifest 槽位的 sentinel 对象喂入同目录 manifest.json）
const manifestModules = import.meta.glob('../../extensions/sentinels/*/manifest.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

interface SentinelLike {
  check: (...args: unknown[]) => Promise<unknown>;
  manifest?: unknown;
}

/** 模块内唯一带 check 方法的导出即 sentinel 对象（DEFAULT_THRESHOLDS/compute 函数无 check） */
function extractSentinel(mod: Record<string, unknown>): SentinelLike | null {
  for (const value of Object.values(mod)) {
    if (value && typeof value === 'object' && typeof (value as { check?: unknown }).check === 'function') {
      return value as SentinelLike;
    }
  }
  return null;
}

function moduleId(file: string): string {
  return file.replace('../../extensions/sentinels/', '').replace('/aggregate.ts', '');
}

// 组装: [文件路径, sentinel 实例]（manifest 槽位注入, 幂等可复跑）
// M1b（CTO 裁 157 选②）：两个合并壳（competitive-moat / competitive-position）的子哨兵已退役至
// _extinct/ 且编译期 import 边已断 ⇒ 恒零 finding，属已知降级（非空调通过），豁免本判据。
const M1B_SUB_RETIRED_SHELLS = new Set(['competitive-moat', 'competitive-position']);
const sentinels: Array<{ id: string; sentinel: SentinelLike }> = Object.entries(aggregateModules)
  .map(([file, mod]) => {
    const sentinel = extractSentinel(mod);
    if (!sentinel) return null;
    if (M1B_SUB_RETIRED_SHELLS.has(moduleId(file))) return null;
    if ('manifest' in sentinel) {
      const manifestPath = file.replace('aggregate.ts', 'manifest.json');
      if (manifestModules[manifestPath] !== undefined) {
        sentinel.manifest = manifestModules[manifestPath];
      }
    }
    return { id: moduleId(file), sentinel };
  })
  .filter((s): s is { id: string; sentinel: SentinelLike } => s !== null);

// ═══ 探针库（无状态, 双跑安全） ═══

interface Probe {
  name: string;
  store: unknown;
  traversal?: unknown;
}

const PROBES: Probe[] = [
  { name: 'empty', store: { queryNodes: (): unknown[] => [] } },
  {
    name: 'throwing',
    store: {
      queryNodes: (): never => {
        throw new Error('probe: store unavailable (degraded path)');
      },
    },
  },
  {
    name: 'data',
    store: {
      queryNodes: (): unknown[] => [
        { id: 'n1', type: 'CLIENT', props: { financialType: 'revenue', amount: 100, total_revenue: 100 } },
      ],
    },
  },
  {
    name: 'data+traversal',
    store: {
      queryNodes: (): unknown[] => [
        { id: 'n1', type: 'CLIENT', props: { financialType: 'revenue', amount: 100, total_revenue: 100 } },
      ],
    },
    traversal: {
      traverse: (): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } => ({
        nodes: [
          { id: 'n1', type: 'CLIENT', props: { financialType: 'revenue', amount: 100, total_revenue: 100 } },
        ],
        edges: [{ props: { concentration_index: 0.9, reversal_cost: 'high' } }],
      }),
    },
  },
];

/** 形状自适应调用: check(store, teamId, traversal?, thresholds?) 形参 ≥2 / check({db, now}) 单形参 */
async function invokeCheck(sentinel: SentinelLike, probe: Probe): Promise<SentinelFinding[]> {
  const raw: unknown =
    sentinel.check.length >= 2
      ? await sentinel.check(probe.store, 'team-probe', probe.traversal)
      : await sentinel.check({ db: probe.store, now: new Date() });
  if (Array.isArray(raw)) return raw as SentinelFinding[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { findings?: unknown }).findings)) {
    return (raw as { findings: SentinelFinding[] }).findings;
  }
  return [];
}

/** 一轮全探针: 返回 [sentinelId][probeIdx] → id 数组 */
async function probeRound(): Promise<string[][][]> {
  const out: string[][][] = [];
  for (const { sentinel } of sentinels) {
    const perProbe: string[][] = [];
    for (const probe of PROBES) {
      const findings = await invokeCheck(sentinel, probe);
      perProbe.push(findings.map((f) => f.id));
    }
    out.push(perProbe);
  }
  return out;
}

describe('D580 8-3 — aggregate finding.id 稳定性（44 文件全量扫描）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('每个 aggregate 在至少一个探针下产出 finding（防空调通过）', async () => {
    const round = await probeRound();
    const empty = sentinels.filter((_, i) => round[i].every((ids) => ids.length === 0)).map((s) => s.id);
    expect(empty, `以下 aggregate 所有探针均未产出 finding: ${empty.join(', ')}`).toEqual([]);
  });

  it('双跑同 id: fake timer 推进 2 分钟后逐元素相等（N14 修复的物理证明）', async () => {
    const round1 = await probeRound();
    vi.setSystemTime(new Date(T0.getTime() + 2 * 60 * 1000));
    const round2 = await probeRound();
    for (let i = 0; i < sentinels.length; i++) {
      for (let p = 0; p < PROBES.length; p++) {
        if (round1[i][p].length === 0) continue; // 该探针无产出（其他探针已覆盖）
        expect(
          round2[i][p],
          `${sentinels[i].id} 探针[${PROBES[p].name}] 双跑 id 不相等（时间戳后缀残留?）`,
        ).toEqual(round1[i][p]);
      }
    }
  });

  it('单轮内 id 互异: Set 尺寸 = 数组长度（回归护栏, spec §5.3 互斥分支兜底）', async () => {
    const round = await probeRound();
    for (let i = 0; i < sentinels.length; i++) {
      for (let p = 0; p < PROBES.length; p++) {
        expect(
          new Set(round[i][p]).size,
          `${sentinels[i].id} 探针[${PROBES[p].name}] 单轮内 id 重复`,
        ).toBe(round[i][p].length);
      }
    }
  });

  it('降级/error 路径产出的 id 同样稳定（抛错库探针双跑）', async () => {
    const throwingIdx = PROBES.findIndex((p) => p.name === 'throwing');
    const round1: string[][] = [];
    for (const { sentinel } of sentinels) {
      round1.push((await invokeCheck(sentinel, PROBES[throwingIdx])).map((f) => f.id));
    }
    vi.setSystemTime(new Date(T0.getTime() + 5 * 60 * 1000));
    for (let i = 0; i < sentinels.length; i++) {
      if (round1[i].length === 0) continue; // 抛错探针无产出（其他探针已覆盖该文件）
      const r2 = await invokeCheck(sentinels[i].sentinel, PROBES[throwingIdx]);
      expect(
        r2.map((f) => f.id),
        `${sentinels[i].id} 降级路径 id 双跑不一致`,
      ).toEqual(round1[i]);
    }
  });
});
