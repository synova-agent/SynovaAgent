/**
 * tests/sentinel/traversal-fallback-b2.test.ts — #1387 **B2** 判据（机制③，5 哨兵；照 B1 已验模板）
 *
 * 口径：被测对象 = **哨兵的产出与留痕**（输入由真实 `SqliteGraphStore.createNode` 建）。
 *   ① 无匹配边 ⇒ 退回旧路径（不早退）+ 留痕（warn，不置 degraded）
 *   ② 退回后读空 ⇒ 归 #1379 V3（degraded + **不发 metrics**；禁编造）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

const B2 = ['api-coverage', 'data-health', 'explore-exploit-balance', 'human-agent-boundary', 'make-or-buy'] as const;

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1387 B2 · traversal 早退守卫（机制③）', () => {
  it('V1 逐哨兵点名：5 个已改；旧静默早退【零残留】（regex）；边界注释在位', () => {
    for (const n of B2) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 应有留痕`).toMatch(/log\.warn\(\{[^}]*reason: 'traversal-no-edge'/);
      expect(src, `${n} 应捕获遍历异常并 warn 退回`).toMatch(/log\.warn\(\{[^}]*reason: 'traversal-error'/);
      expect(src, `${n} 不应再有静默早退`).not.toMatch(/if \(!r\.nodes\[0\]\) return \[\];/);
      expect(src).toContain('不置 `result.degraded`');
    }
  });

  it('🔴 V2① 无匹配边 ⇒ **不早退**（5 个均不抛、可执行）+ 留痕路径生效', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const sink = createMetricSink(db);
    for (const n of B2) {
      const s = getSentinelRegistry().get(`sentinel-${n}`);
      expect(s, `${n} 应在注册表`).toBeTruthy();
      const res = await s!.check({ db: store, metricSink: sink, teamId: 'org-b2', now: new Date('2026-10-08T00:00:00Z') });
      expect(res.ok, `${n} 应正常返回（不抛）`).toBe(true);
    }
  });

  it('🔴 V2①-b（M3 防线）退回 ≠ 造假：**库空** ⇒ 不得【编造】metric 行', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const sink = createMetricSink(db);
    for (const n of B2) {
      await getSentinelRegistry().get(`sentinel-${n}`)!.check({ db: store, metricSink: sink, teamId: 'org-b2', now: new Date('2026-10-08T00:00:00Z') });
    }
    const rows = db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get() as { n: number };
    expect(rows.n, '库空 ⇒ 不得编造 metric 行').toBe(0);
  });

  it('🔴 V2② 【不早退】的行为探针：无匹配边时哨兵**仍继续读**（对照改前：静默 return [] ⇒ 0 次读）', async () => {
    const db = new Database(':memory:');
    const real = new SqliteGraphStore(db);
    // 数据面：无任何边（触发守卫路径）；租户载体 = props.orgId
    real.createNode('Tool', { orgId: 'org-b2', name: 't1' });
    real.createNode('Process', { orgId: 'org-b2', name: 'p1' });
    real.createNode('Document', { orgId: 'org-b2', name: 'd1' });
    real.createNode('Event', { orgId: 'org-b2', eventType: 'market' });
    real.createNode('Person', { orgId: 'org-b2', name: 'zhang' });
    let reads = 0;
    const counting = {
      queryNodes: (t: string, f?: Record<string, unknown>, g?: string) => { reads++; return real.queryNodes(t, f, g) as unknown[]; },
    };
    const sink = createMetricSink(db);
    for (const n of B2) {
      const before = reads;
      await getSentinelRegistry().get(`sentinel-${n}`)!.check({ db: counting, metricSink: sink, teamId: 'org-b2', now: new Date('2026-10-08T00:00:00Z') });
      // 改前：无匹配边 ⇒ 静默 return [] ⇒ 该哨兵【一次读都没有】
      expect(reads, `${n} 无匹配边时应继续读（不早退）`).toBeGreaterThan(before);
    }
  });
});
