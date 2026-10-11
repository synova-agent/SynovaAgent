/**
 * tests/sentinel/path-dependency-sentinel.test.ts
 * SYNOVA-IMPL-DSH-D379 — path-dependency 哨兵空壳补实现
 *
 * 覆盖（dev doc §4，10 用例 red→green）:
 *   1. detect.ts 存在且 export pathDependencySentinel（命名对齐，exportKey 命中）
 *   2. registerLoadedSentinels 全量注册（注册数 = extensions/sentinels 枚举数，动态；无 path-dependency entryPoint 报错）
 *   3. detectPathDependency 空图（0 节点）→ degraded: true
 *   4. detectPathDependency 空边（0 边）→ degraded: true
 *   5. detectPathDependency 有边 → value ∈ [0,1]
 *   6. 单节点零边 → 归一化不除零（Number.isFinite）
 *   7. check value=0.8 → critical（高集中图构造）
 *   8. check value∈[0.4,0.7) → warning（中集中图构造）
 *   9. check value=0.2 → 无 finding（分散图构造）
 *  10. 边界 value 恰好 0.4 → warning（阈值边界）
 *  11. check degraded → 不产出 finding（铁律 31）
 *  12. 命名对齐：loader 动态 import 后 mod['pathDependencySentinel'] 存在（exportKey 契约）
 *
 * 测试先行（铁律 0-2/48）: 每个用例含 expect() 断言，覆盖正常/降级/边界。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { clearSentinelCache } from '../../src/sentinel/sentinel-loader';
import { destroySentinelRegistry } from '../../src/sentinel/registry';

/**
 * 活跃哨兵数 = 文件系统独立枚举（引用纪律 2026-09-26：数量一律以脚本实况为准，禁手写）。
 * 口径与 sentinel-loader 一致：extensions/sentinels/ 下含 manifest.json 的目录，
 * 排除 _ 前缀（归档）与 shared（工具库）。
 */
function countActiveSentinels(): number {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'sentinels');
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'shared')
    .filter(e => existsSync(join(root, e.name, 'manifest.json')))
    .length;
}

// ═══ 契约（dev doc §4.5 决策 A: 阈值 0.4/0.7）═══
// 注意: worktree 基于 main，无 D356 的 injectSentinelManifest（未合并）。
// detect.ts 的 check 读 this.manifest（loader 注入）失败时 fallback 契约值 0.4/0.7 —— 双兼容。

// ═══ helpers ═══

type TestEdge = { id: string; type: string; from: string; to: string; weight: number; props: Record<string, unknown> };
type TestNode = { id: string; type: string; props: Record<string, unknown> };

/** 构造 GraphStoreReader mock（同步接口，graph-traversal.ts L13-15 契约） */
function makeStore(nodes: TestNode[], edges: TestEdge[]) {
  return {
    queryNodes: (_type?: string, _filters?: Record<string, unknown>, _graph?: string) => nodes,
    queryEdges: (_type?: string, _from?: string, _to?: string, _graph?: string) => edges,
    getNode: () => null,
  };
}

function edge(from: string, to: string, type = 'DEPENDS_ON'): TestEdge {
  return { id: `e-${from}-${to}`, type, from, to, weight: 1, props: {} };
}

let sentinel: { check(store: unknown, teamId: string): Promise<Array<{ severity: string }>> };

beforeEach(async () => {
  clearSentinelCache();
  destroySentinelRegistry();
  const mod = await import('../../extensions/sentinels/path-dependency/computes/detect');
  sentinel = mod.pathDependencySentinel;
});

// ═══ 用例 1: detect.ts 存在 + export 名对齐 ═══

describe('D379 path-dependency 空壳补实现', () => {
  it('detect.ts 存在且 export pathDependencySentinel（exportKey 命中）', () => {
    const p = join(process.cwd(), 'extensions', 'sentinels', 'path-dependency', 'computes', 'detect.ts');
    expect(existsSync(p)).toBe(true);
    expect(typeof sentinel.check).toBe('function');
  });

  it('loader 动态 import 后 mod[exportKey] 命中（命名对齐契约）', async () => {
    const { pathToFileURL } = await import('url');
    const mod = await import(pathToFileURL(join(process.cwd(), 'extensions', 'sentinels', 'path-dependency', 'computes', 'detect.ts')).href);
    const obj = (mod as Record<string, unknown>)['pathDependencySentinel'];
    expect(obj).toBeTruthy();
    expect(typeof (obj as { check?: unknown }).check).toBe('function');
  });

  // ═══ 用例 2: 全量注册（N = 枚举实况）═══

  it(`registerLoadedSentinels 全量注册（${countActiveSentinels()}/${countActiveSentinels()}，N=extensions/sentinels 枚举），无 path-dependency entryPoint 报错`, async () => {
    const { registerLoadedSentinels } = await import('../../src/sentinel/sentinel-loader');
    clearSentinelCache();
    const { registered, errors } = await registerLoadedSentinels();
    expect(errors.filter(e => e.includes('path-dependency'))).toEqual([]);
    const expected = countActiveSentinels();
    expect(expected).toBeGreaterThan(0);
    expect(registered).toBe(expected);
  });

  // ═══ 用例 3-6: detectPathDependency 三态 ═══

  it('空图（0 节点）→ degraded: true', async () => {
    const mod = await import('../../extensions/sentinels/path-dependency/computes/detect');
    const r = await mod.detectPathDependency(makeStore([], []), 'team-1');
    expect(r.degraded).toBe(true);
    expect(r.value).toBe(0);
    expect(Array.isArray(r.evidence)).toBe(true);
  });

  it('空边（有节点但 0 边）→ degraded: true', async () => {
    const mod = await import('../../extensions/sentinels/path-dependency/computes/detect');
    const r = await mod.detectPathDependency(makeStore([{ id: 'n1', type: 'Tool', props: {} }], []), 'team-1');
    expect(r.degraded).toBe(true);
    expect(r.value).toBe(0);
  });

  it('有边 → value ∈ [0,1]', async () => {
    const mod = await import('../../extensions/sentinels/path-dependency/computes/detect');
    const r = await mod.detectPathDependency(
      makeStore([{ id: 'n1', type: 'Tool', props: {} }], [edge('s1', 't1'), edge('s2', 't1'), edge('s3', 't2')]),
      'team-1',
    );
    expect(r.degraded).toBe(false);
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThanOrEqual(1);
  });

  it('单节点零边 → 归一化不除零（HHI 分母 guard，不抛 NaN/Infinity）', async () => {
    const mod = await import('../../extensions/sentinels/path-dependency/computes/detect');
    // 单节点 + 0 边 → 走 degraded 分支，但必须不抛异常且 value 有限
    const r = await mod.detectPathDependency(makeStore([{ id: 'n1', type: 'Tool', props: {} }], []), 'team-1');
    expect(Number.isFinite(r.value)).toBe(true);
    expect(Number.isNaN(r.value)).toBe(false);
    expect(Number.isFinite(r.degraded ? 0 : r.value)).toBe(true);
  });

  // ═══ 用例 7-10: check 阈值（manifest 0.4/0.7）═══

  it('check 高集中图（value=0.8）→ critical', async () => {
    // 4 边：S1→T1 ×2, S2→T1 ×2 → inDegree 全集中 T1（h=1），maxOut=2/4（s=0.5）
    // score = 0.6*1 + 0.4*0.5 = 0.8 ≥ 0.7 → critical
    const findings = await sentinel.check(
      makeStore([{ id: 't1', type: 'Tool', props: {} }], [edge('s1', 't1'), edge('s1', 't1'), edge('s2', 't1'), edge('s2', 't1')]),
      'team-1',
    );
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('check 中集中图（value∈[0.4,0.7)）→ warning', async () => {
    // 8 边：T1 入度 7（3+4 来自两源），T2 入度 1 → hhiRaw=37/49≈0.755, n=2 → h≈0.51
    // maxOut=4/8=0.5 → score = 0.6*0.51 + 0.4*0.5 ≈ 0.506 ∈ [0.4,0.7) → warning
    const edges = [
      edge('a', 't1'), edge('a', 't1'), edge('a', 't1'),
      edge('b', 't1'), edge('b', 't1'), edge('b', 't1'), edge('b', 't1'),
      edge('c', 't2'),
    ];
    const findings = await sentinel.check(
      makeStore([{ id: 't1', type: 'Tool', props: {} }, { id: 't2', type: 'Tool', props: {} }], edges),
      'team-1',
    );
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('check 分散图（value≈0.13）→ 无 finding', async () => {
    // 3 边：S1→T1, S2→T2, S3→T3 → 入度均匀（h=0），maxOut=1/3（s≈0.33）
    // score = 0 + 0.4*0.33 ≈ 0.133 < 0.4 → 无 finding
    const findings = await sentinel.check(
      makeStore(
        [{ id: 't1', type: 'Tool', props: {} }, { id: 't2', type: 'Tool', props: {} }, { id: 't3', type: 'Tool', props: {} }],
        [edge('s1', 't1'), edge('s2', 't2'), edge('s3', 't3')],
      ),
      'team-1',
    );
    expect(findings).toEqual([]);
  });

  it('边界: value 恰好 0.4 → warning（阈值边界）', async () => {
    // 4 边全来自 S1，to T1..T4 各 1 → 入度均匀（h=0），maxOut=4/4=1（s=1）
    // score = 0 + 0.4*1 = 0.4 恰好 → warning（≥0.4）
    const findings = await sentinel.check(
      makeStore(
        [{ id: 't1', type: 'Tool', props: {} }, { id: 't2', type: 'Tool', props: {} }, { id: 't3', type: 'Tool', props: {} }, { id: 't4', type: 'Tool', props: {} }],
        [edge('s1', 't1'), edge('s1', 't2'), edge('s1', 't3'), edge('s1', 't4')],
      ),
      'team-1',
    );
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warning');
  });

  // ═══ 用例 11: degraded 不产出 finding ═══

  it('check degraded（空图）→ 不产出 critical（铁律 31）', async () => {
    const findings = await sentinel.check(makeStore([], []), 'team-1');
    expect(findings).toEqual([]);
  });
});
