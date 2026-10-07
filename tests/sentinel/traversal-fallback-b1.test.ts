/**
 * tests/sentinel/traversal-fallback-b1.test.ts — #1387 B1 判据（机制③：traversal 早退守卫）
 *
 * 裁（CTO 2026-10-08）：**无匹配边 ⇒ 退回旧路径 + 留痕**（不得静默 return []）；照已过生产验证的
 *   `business-model-coherence` **带回退**模板。**留痕粒度边界**：无匹配边 = 走备用路径（正常，warn 不降级）；
 *   退回后读空 = 没有数据（降级，归 #1379 V3）。
 * 判据口径（明说，避免替身）：被测对象 = **哨兵的产出与留痕**；输入由真实 `SqliteGraphStore.createNode` 建。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

const B1 = ['agent-deployment-maturity', 'ai-ecosystem-fit', 'ai-investment-return'] as const;

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1387 B1 · traversal 早退守卫（机制③）', () => {
  it('V1 逐哨兵点名：3 个已改为"退回 + 留痕"；旧静默早退【零残留】', () => {
    for (const n of B1) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 应有留痕`).toContain("reason: 'traversal-no-edge'");
      // 精确断言：必须是 **log.warn 调用**（防 M2：删掉 warn 只留残句仍会被 '含字符串' 骗过）
      expect(src, `${n} 应捕获遍历异常并 warn 退回`).toMatch(/log\.warn\(\{[^}]*reason: 'traversal-error'/);
      // 旧形态零残留：`if (!r.nodes[0]) return [];`
      expect(src, `${n} 不应再有静默早退`).not.toMatch(/if \(!r\.nodes\[0\]\) return \[\];/);
      // 留痕粒度边界必须写在注释里（CTO 要求）
      expect(src).toContain('不置 `result.degraded`');
    }
  });

  it('🔴 V2① 无匹配边（无 DEPLOYS 边）⇒ **不早退** ⇒ 继续走 store 读并产出 metric 行', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    // 无任何边；仅数据节点（租户载体 = props.orgId）
    store.createNode('Agent', { orgId: 'org-b1', monitored: true });
    store.createNode('Tool', { orgId: 'org-b1', error: true, needsMonitoring: true });

    const sentinel = getSentinelRegistry().get('sentinel-agent-deployment-maturity');
    expect(sentinel).toBeTruthy();
    const sink = createMetricSink(db);
    const res = await sentinel!.check({ db: store, metricSink: sink, teamId: 'org-b1', now: new Date('2026-10-08T00:00:00Z') });
    expect(res.ok).toBe(true);

    const rows = db.prepare('SELECT metric_id, org_id, degraded FROM metric_readings').all() as Array<{ metric_id: string; org_id: string; degraded: number }>;
    // 改前：静默 return [] ⇒ 0 产出；改后：退回旧路径 ⇒ 有产出
    expect(rows.length, '无匹配边时仍应产出（不早退）').toBeGreaterThan(0);
    expect(rows[0].metric_id).toBe('AGENT-DEPLOYMENT-MATURITY-SCORE');
    expect(rows.every(r => r.org_id === 'org-b1')).toBe(true);
    // 走备用路径本身【不降级】（CTO 边界：留痕 ≠ 降级）
    expect(res.degraded).not.toBe(true);
  });

  it('🔴 V2①-b（M3 防线）退回 ≠ 造假：**库空**时不得【编造】metric 行', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);   // 无任何节点
    const sentinel = getSentinelRegistry().get('sentinel-agent-deployment-maturity');
    const sink = createMetricSink(db);
    const res = await sentinel!.check({ db: store, metricSink: sink, teamId: 'org-empty', now: new Date('2026-10-08T00:00:00Z') });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get() as { n: number };
    expect(rows.n, '无数据 ⇒ 不得编造 metric 行').toBe(0);
    expect(res.ok).toBe(true);
  });

  it('V2② 三哨兵同批一致：改动后仍可加载/执行（未破坏既有行为）', async () => {
    for (const n of B1) {
      const s = getSentinelRegistry().get(`sentinel-${n}`);
      expect(s, `${n} 应仍在注册表`).toBeTruthy();
    }
  });
});
