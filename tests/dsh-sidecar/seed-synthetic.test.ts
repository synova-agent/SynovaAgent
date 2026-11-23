/**
 * tests/dsh-sidecar/seed-synthetic.test.ts —— Issue #1458（#1457 core 门红的加做部分）
 *
 * 直接 import `scripts/dsh-sidecar/r3-chain/seed-synthetic.ts`（真实依赖边，见同目录
 * install-profile.test.ts 头注的长理由），并用 vitest 配置里的 `SYNOVA_DB_PATH=:memory:`
 * 在内存库里真跑种子 —— 不写仓库、不碰真实客户数据。
 */
import { describe, it, expect } from 'vitest';
import { seedSyntheticFixture } from '../../scripts/dsh-sidecar/r3-chain/seed-synthetic';

describe('seed-synthetic / seedSyntheticFixture', () => {
  it('首跑：落 ② 合成夹具（root + 2 neighbour + 2 edge），并用产品工具路径自验全绿', () => {
    const result = seedSyntheticFixture({ orgId: 'synth-org-test-1458a', problemId: 'synth-problem-test-1458a' });

    expect(result.ok).toBe(true);
    expect(result.createdThisRun).toBe(true);
    expect(result.rootId.length).toBeGreaterThan(0);
    expect(result.neighbourIds).toHaveLength(2);
    expect(result.edgeIds).toHaveLength(2);
    // 1 root + 2 neighbour 节点；2 条边
    expect(result.dbCounts.nodes).toBe(3);
    expect(result.dbCounts.edges).toBe(2);

    // 产品工具路径（buildContextSnapshot）的自验：7 条不变式必须全 true
    expect(result.toolSnapshotInvariant.syntheticIsFalse).toBe(true);
    expect(result.toolSnapshotInvariant.problemIdMatches).toBe(true);
    expect(result.toolSnapshotInvariant.countAtLeastTwo).toBe(true);
    expect(result.toolSnapshotInvariant.allItemsLayer2).toBe(true);
    expect(result.toolSnapshotInvariant.allItemsEnterpriseVisibility).toBe(true);
    expect(result.toolSnapshotInvariant.allItemsDomainApi).toBe(true);
    expect(result.toolSnapshotInvariant.allItemsPeriodDefVersion).toBe(true);
    expect(Object.values(result.toolSnapshotInvariant).every(Boolean)).toBe(true);

    // 跨租户探针 id 只是"不该被看到"的候选，不得混入本租户图
    expect(result.foreignGraphProbe).toBe('synth-org-test-1458a-other-tenant');
    expect(result.foreignGraphProbe).not.toBe(result.orgId);
  });

  it('重跑幂等：createdThisRun=false、rootId 不变、行数不涨（不造重复夹具）', () => {
    const first = seedSyntheticFixture({ orgId: 'synth-org-test-1458b', problemId: 'synth-problem-test-1458b' });
    const second = seedSyntheticFixture({ orgId: 'synth-org-test-1458b', problemId: 'synth-problem-test-1458b' });

    expect(first.createdThisRun).toBe(true);
    expect(second.createdThisRun).toBe(false);
    expect(second.rootId).toBe(first.rootId);
    expect(second.neighbourIds).toEqual(first.neighbourIds);
    expect(second.dbCounts).toEqual(first.dbCounts);
    // 边的幂等标记是**真实行为**：首跑返回新边 id，重跑返回 'existing'（不重复建边）
    expect(first.edgeIds.every(id => id !== 'existing')).toBe(true);
    expect(second.edgeIds).toEqual(['existing', 'existing']);
  });

  it('租户隔离：两个 orgId 各自 3 节点/2 边，且互不串号', () => {
    const alpha = seedSyntheticFixture({ orgId: 'synth-org-test-1458c', problemId: 'synth-problem-test-1458c' });
    const beta = seedSyntheticFixture({ orgId: 'synth-org-test-1458d', problemId: 'synth-problem-test-1458d' });

    expect(alpha.dbCounts).toEqual({ nodes: 3, edges: 2 });
    expect(beta.dbCounts).toEqual({ nodes: 3, edges: 2 });
    expect(beta.rootId).not.toBe(alpha.rootId);
    expect(beta.neighbourIds).not.toEqual(alpha.neighbourIds);
  });
});
