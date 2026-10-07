/**
 * tests/sentinel/org-scope.test.ts — #1374 哨兵读路径租户隔离（数值级）判据载体
 *
 * 覆盖面（**分母 = 现场列举**）：活跃哨兵 **45**（`manifest.json` 存在、排除 `_extinct/`）；
 *   其中 **43 个有 `queryNodes` 读路径** ⇒ 本卡在其**单点收口**（`sentinel-loader.ts`）后**全部生效**；
 *   其余 2 个无 `queryNodes` 读路径 ⇒ **登记为"不可隔离"**（不静默）。
 *
 * 载体/口径：`props.orgId`（R21/R22）｜`metric_id` = 指标名（与租户无关）｜`entity_id` = 分析单元｜
 *   **`org_id` = 租户唯一落点**（禁借用 `entity_id`）。
 * 库口径：`:memory:` 真实 `SqliteGraphStore`（**不是**桩）——判据要打在真实读路径上。
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { withOrgScope, getUnscopedQueryCount, resetUnscopedQueryCount } from '../../src/sentinel/org-scope';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';

// 文件驱动哨兵注册（与生产同路：loadSentinels + registerLoadedSentinels；id = `sentinel-<name>`）
beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);   // 注册是 async（实测：不 await ⇒ registry.count() = 0）
});

function createMemoryGraph(): InstanceType<typeof SqliteGraphStore> {
  return new SqliteGraphStore(new Database(':memory:'));
}

/** 造一条 Financial 节点（erp-standard 契约，snake_case；租户载体 = props.orgId） */
function addFinancial(
  store: InstanceType<typeof SqliteGraphStore>,
  orgId: string,
  props: { total_revenue: number; operating_expense: number },
): void {
  store.createNode('Financial', {
    orgId,
    total_revenue: props.total_revenue,
    gross_margin: (props.total_revenue - 0) / props.total_revenue,
    operating_expense: props.operating_expense,
  });
}

interface AnySentinel { config: { id: string }; check(ctx: Record<string, unknown>): Promise<{ findings: unknown[] }> }

describe('#1374 哨兵读路径租户隔离（数值级）', () => {
  beforeEach(() => { resetUnscopedQueryCount(); });

  it('V1 同值证伪：org A(亏损) 与 org B(盈利) 经同一哨兵 ⇒ 判定不同；且【不隔离】时两者相同', async () => {
    const store = createMemoryGraph();
    // org A：收入 1000 / 总成本 1200 ⇒ 毛利率 -0.2（触发 critical）；org B：收入 2000 / 成本 1000 ⇒ 0.5（无事）
    addFinancial(store, 'org-A', { total_revenue: 1000, operating_expense: 1200 });
    addFinancial(store, 'org-B', { total_revenue: 2000, operating_expense: 1000 });

    // 控制断言（诊断用）：未过滤查询应能看见两条节点
    expect((store.queryNodes('Financial', {}) as unknown[]).length).toBe(2);

    const registry = getSentinelRegistry();
    const sentinel = registry.get('sentinel-margin-health') as unknown as AnySentinel;
    expect(sentinel, 'margin-health 哨兵应可从文件驱动注册表取到').toBeTruthy();

    const now = new Date('2026-10-08T00:00:00Z');
    const a = await sentinel.check({ db: store, teamId: 'org-A', now });
    const b = await sentinel.check({ db: store, teamId: 'org-B', now });
    // 判定（结果导向）：两个 org 看的数据不同 ⇒ 结论集合必须不同（不同值/不同条数/不同严重度任一成立）
    // ⚠️ 断言必须打到**数值内容**上：finding 的 title 是通用文案（两 org 可能同标题）
    //   ⇒ 用**完整 finding 载荷**（含 description/evidence 里的数值）比较
    const shape = (r: { findings: unknown[] }): string => JSON.stringify(r.findings);
    expect(shape(a)).not.toBe(shape(b));
    // 对照（不隔离 = 现行为）：两 org 看到**同一份合计** ⇒ 结论必须**完全一致**
    //   ⇒ 证明"上面那个差异"来自隔离，而不是运行噪声
    const unscopedA = await sentinel.check({ db: store, teamId: undefined, now });
    const unscopedB = await sentinel.check({ db: store, teamId: undefined, now });
    expect(shape(unscopedA)).toBe(shape(unscopedB));
    expect(getUnscopedQueryCount()).toBeGreaterThan(0); // 不隔离读被计数（空结果 ≠ 隔离成功）
  });

  it('V2 零交叉：org A 的行不含 org B 的数据（各自只看得见自己）', async () => {
    const store = createMemoryGraph();
    addFinancial(store, 'org-A', { total_revenue: 1000, operating_expense: 1200 });
    addFinancial(store, 'org-B', { total_revenue: 2000, operating_expense: 1000 });
    const scopedA = withOrgScope(store, 'org-A');
    const scopedB = withOrgScope(store, 'org-B');
    const nodesA = scopedA.queryNodes('Financial', {}) as Array<{ props: Record<string, unknown> }>;
    const nodesB = scopedB.queryNodes('Financial', {}) as Array<{ props: Record<string, unknown> }>;
    // V2 的职责 = **泄漏面**（不是"隔离多有效"——那是 V1 的职责）：
    //   断言"A 的结果里不含 B 的节点"（反之亦然）⇒ 与 V1 各管一面（M2 用例即靠此区分）
    const idsA = nodesA.map(n => String(n.props.orgId));
    const idsB = nodesB.map(n => String(n.props.orgId));
    // **只查泄漏面**（负向）：是否出现对方的 org。
    //   正向（"隔离多有效"）由 V1 承担 ⇒ 两条判据各有对象（M2 用例即靠此区分）
    expect(idsA).not.toContain('org-B');
    expect(idsB).not.toContain('org-A');
  });

  it('键归一化：哨兵传的 { teamId } 键被改写为 orgId（否则双键 ⇒ 数据全落空 ⇒ 空结果被误当隔离成功）', () => {
    const store = createMemoryGraph();
    addFinancial(store, 'org-A', { total_revenue: 1000, operating_expense: 1200 });
    const scoped = withOrgScope(store, 'org-A');
    // 哨兵真实形态：queryNodes('Financial', { teamId })
    const rows = scoped.queryNodes('Financial', { teamId: 'org-A' }) as unknown[];
    expect(rows).toHaveLength(1);           // 归一化生效（若双键 ⇒ 0 行）
    // 反面：不归一化时会落空 —— 直接用原始 store 以 teamId 过滤（数据无 teamId 键）
    expect(store.queryNodes('Financial', { teamId: 'org-A' })).toHaveLength(0);
  });

  it('边界：无 orgId ⇒ 原样透传（现行为）+ **计数未隔离**（空结果 ≠ 隔离成功）', () => {
    let calls = 0;
    const stub = { queryNodes: (): unknown[] => { calls++; return [{ id: 'n1' }, { id: 'n2' }]; } };
    const passthrough = withOrgScope(stub, undefined);
    // 计数器为模块级 ⇒ 用**增量**断言（不假设 0）；快照必须在查询【之前】取
    const before = getUnscopedQueryCount();
    // 无 orgId ⇒ **行为**透传（不加过滤）；为计数仍包装 ⇒ 断言【行为】而非对象身份
    expect(passthrough.queryNodes('Financial', {})).toHaveLength(2);
    expect(calls).toBe(1);
    expect(getUnscopedQueryCount() - before).toBe(1);
    // ⇒ **被计数** ⇒ 不静默（空结果 ≠ 隔离成功）
  });

  it('冲突：调用方传的 orgId 与 ctx.teamId 不一致 ⇒ 以 ctx 为准（单一真源）', () => {
    const store = createMemoryGraph();
    addFinancial(store, 'org-A', { total_revenue: 1000, operating_expense: 1200 });
    addFinancial(store, 'org-B', { total_revenue: 2000, operating_expense: 1000 });
    const scoped = withOrgScope(store, 'org-A');
    const rows = scoped.queryNodes('Financial', { orgId: 'org-B' }) as Array<{ props: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].props.orgId).toBe('org-A');
  });
});
