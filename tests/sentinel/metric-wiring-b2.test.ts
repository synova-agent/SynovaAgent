/**
 * tests/sentinel/metric-wiring-b2.test.ts — #1375 **B2** 判据（3 哨兵）
 *
 * ⚠️ **批次组成的修正（开工前复核发现）**：原拟 5 个，经复核**收为 3 个** ——
 *   映射层（#1381）**只被 `src/sentinel/adapters/cash-flow-sentinel.ts` 消费**；
 *   **extensions 哨兵（45 个）一律直读【字面量】类型** ⇒ 对它们而言，"可读" = **字面量有写入者**。
 *   `environment-rent-dependency` / `value-capture` 读 `Financial`（字面量**无写入者**）⇒ 移出本批（避免"接出 0 行"）。
 * 短路声明（R178）：本批无"对象不具备"的判据；V2①-b（不编造）对本批**有对象**（已接线）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

const B2 = ['knowledge-accessibility', 'make-or-buy', 'talent-density'] as const;

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1375 B2 · 指标级接线（3 哨兵）', () => {
  it('V1 覆盖面 + 形态：3 个只返回 metrics（不碰库）；metric_id 合规范', () => {
    const ids: string[] = [];
    for (const n of B2) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 应返回 metrics`).toContain('metricsHolder');
      expect(src, `${n} 不得直接写库`).not.toMatch(/metricSink|metric_readings|\.prepare\(/);
      const m = src.match(/metricId: '([A-Z0-9-]+)'/);
      expect(m, `${n} 应有 metricId`).toBeTruthy();
      ids.push(m![1]);
    }
    expect(new Set(ids).size, 'metric_id 不得重名').toBe(ids.length);
    expect(B2.length).toBe(3);
  });

  it('🔴 V2 端到端（真路径 + 真 store）：经 loader/registry ⇒ 写出 metric 行 + ≥1 行 degraded=0', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    // 输入节点：真实 createNode；租户载体 = props.orgId（各哨兵读 Document/Person，字面量有写入者 ✓）
    store.createNode('Document', { orgId: 'org-b2', title: 'd1', accessibility: 'public' });
    store.createNode('Person', { orgId: 'org-b2', name: 'zhang', skills: ['ai'], skillLevel: 0.8 });
    store.createNode('Person', { orgId: 'org-b2', name: 'li', skills: ['ops'], skillLevel: 0.3 });
    const sink = createMetricSink(db);
    for (const n of B2) {
      const s = getSentinelRegistry().get(`sentinel-${n}`);
      expect(s, `${n} 应在注册表`).toBeTruthy();
      const res = await s!.check({ db: store, metricSink: sink, teamId: 'org-b2', now: new Date('2026-10-08T00:00:00Z') });
      expect(res.ok).toBe(true);
    }
    const rows = db.prepare('SELECT metric_id, org_id, degraded, run_id, def_version, input_digest FROM metric_readings').all() as Array<{ metric_id: string; org_id: string; degraded: number; run_id: string | null; def_version: string | null; input_digest: string | null }>;
    expect(rows.length, '应写出 metric 行').toBeGreaterThan(0);
    expect(rows.every(r => r.org_id === 'org-b2')).toBe(true);
    expect(rows.some(r => r.degraded === 0), '🔴 至少一行 degraded=0').toBe(true);
    const r0 = rows.find(r => r.degraded === 0)!;
    expect(r0.run_id).toBeTruthy();
    expect(r0.def_version).toBeTruthy();
  });

  it('🔴 V2①-b（不编造）：**库空**时不得编造 metric 行（本批**有对象** ⇒ 非空判据）', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const sink = createMetricSink(db);
    for (const n of B2) {
      await getSentinelRegistry().get(`sentinel-${n}`)!.check({ db: store, metricSink: sink, teamId: 'org-empty', now: new Date('2026-10-08T00:00:00Z') });
    }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get() as { n: number }).n;
    expect(n, '库空 ⇒ 不得编造').toBe(0);
  });
});
