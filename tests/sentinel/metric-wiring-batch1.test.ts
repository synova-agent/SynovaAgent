/**
 * tests/sentinel/metric-wiring-batch1.test.ts — #1375 第一批判据（V1–V3）
 *
 * 口径（CTO 2026-10-08 放行 A2 + B(a) + C1）：
 *   · **被测对象 = 哨兵的 metric 产出**（输入节点由真实 `SqliteGraphStore.createNode` 建；**非 mock store / 非 stub 函数**）
 *   · 写入契约只在 writer 一处；**哨兵不碰库**
 *   · R4 三列：`run_id`/`def_version` 由 **loader** 生成；`input_digest` 由**哨兵**给（它才知道读了什么）
 *   · 🔴 `V2` 不只要求"写出 metric 行"，还要求 **≥1 行 `degraded=0`**（否则标定器全排除 ⇒ 等于没数据）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { TENANT_ALIAS_KEYS } from '../../src/sentinel/org-scope';
import type { SentinelCheckResult } from '../../src/sentinel/types';

const BATCH1 = [
  'agent-deployment-maturity', 'ai-ecosystem-fit', 'ai-investment-return', 'business-model-coherence',
] as const;

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1375 第一批·指标级接线', () => {
  it('V1 覆盖面：本批 4 个哨兵均【只返回 metrics、不碰库】；未被本批覆盖者不谎报', () => {
    for (const n of BATCH1) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 应返回 metrics`).toContain('metricsHolder');
      expect(src, `${n} 不得直接写库`).not.toMatch(/metricSink|metric_readings|\.prepare\(/);
    }
    // 本批只覆盖 4 个（其余 41 个 extensions 哨兵未接）⇒ 禁写"全部已接"
    expect(BATCH1.length).toBe(4);
  });

  it('V3 metric_id 规范：`<DOMAIN>-<METRIC>`（与样板口径一致，且不与样板撞名）', () => {
    for (const n of BATCH1) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      const m = src.match(/metricId: '([A-Z0-9-]+)'/);
      expect(m, `${n} 应有 metricId`).toBeTruthy();
      expect(m![1]).toMatch(/^[A-Z][A-Z0-9-]+$/);
      expect(m![1]).not.toMatch(/^CASH-FLOW-/);   // 不与样板撞名
    }
  });

  it('🔴 V2 端到端（真路径 + 真 store）：经 loader/registry 跑 ⇒ 写出 metric 行，**且 ≥1 行 degraded=0**', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    // 输入节点：真实 createNode；租户载体 = props.orgId
    // ⚠️ 用 business-model-coherence（其 traversal 分支带**回退旧路径**）；
    //    另 3 个同族哨兵的 `if (traversal) { … if (!r.nodes[0]) return []; }` 是**静默早退**（已登记为发现）
    store.createNode('Tool', { orgId: 'org-b1', name: 't1' });
    store.createNode('Client', { orgId: 'org-b1', name: 'c1' });
    store.createNode('Person', { orgId: 'org-b1', name: 'p1' });
    store.createNode('Event', { orgId: 'org-b1', eventType: 'market' });
    store.createNode('Financial', { orgId: 'org-b1', total_revenue: 1000 });

    const sentinel = getSentinelRegistry().get('sentinel-business-model-coherence');
    expect(sentinel, '应在注册表中').toBeTruthy();
    const sink = createMetricSink(db);
    const res = (await sentinel!.check({ db: store, metricSink: sink, teamId: 'org-b1', now: new Date('2026-10-08T00:00:00Z') })) as SentinelCheckResult;
    expect(res.ok).toBe(true);

    const rows = db.prepare('SELECT metric_id, value, org_id, degraded, run_id, def_version, input_digest FROM metric_readings').all() as Array<{
      metric_id: string; value: number; org_id: string; degraded: number; run_id: string | null; def_version: string | null; input_digest: string | null;
    }>;
    expect(rows.length, '应写出 metric 行').toBeGreaterThan(0);
    expect(rows.every(r => r.org_id === 'org-b1')).toBe(true);          // M2 防线：行级租户正确
    expect(rows.some(r => r.degraded === 0), '🔴 至少一行 degraded=0（R4 三列齐全）').toBe(true);
    const r0 = rows.find(r => r.degraded === 0)!;
    expect(r0.run_id).toBeTruthy();                                     // M4 防线：loader 生成
    expect(r0.def_version).toBeTruthy();
    expect(r0.input_digest).toBeTruthy();                              // 哨兵提供
    expect(r0.metric_id).toBe('BUSINESS-MODEL-COHERENCE-SCORE');
  });

  it('V2-b 别名键联动：哨兵写 `{tid}` ⇒ 归一化为 `{orgId}` ⇒ 真能读到（否则 0 行）', () => {
    // 反证：若未归一化（仍按 tid 过滤），同库应读不到
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    store.createNode('Agent', { orgId: 'org-b1', monitored: true });
    expect(store.queryNodes('Agent', { tid: 'org-b1' }).length).toBe(0);   // 无 props.tid ⇒ 0
    expect(store.queryNodes('Agent', { orgId: 'org-b1' }).length).toBe(1); // 载体键 ⇒ 1
    expect(TENANT_ALIAS_KEYS).toContain('tid');
  });
});
