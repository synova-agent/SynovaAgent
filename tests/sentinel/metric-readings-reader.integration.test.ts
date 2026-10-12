/**
 * metric-readings-reader.integration.test.ts — E5 / #389：④a 测量值「写→读回」集成判据
 * 覆盖：① 写（writer 单一写入口）→ 读回逐字段匹配 ② 标定供数口径（默认排除轮次级）
 *       ③ includeRound 显式包含 ④ 表缺失 ⇒ 显式降级（#22 同面） ⑤ 趋势聚合（最新/环比）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createMetricSink, type MetricReadingInput } from '../../src/sentinel/metric-readings-writer';
import { metricReadingsMigration } from '../../src/store/migrations/002-metric-readings';
import { listRecentReadings, summarizeMetricTrends } from '../../src/sentinel/metric-readings-reader';

let db: Database.Database;


const sink = () => createMetricSink(db);
function row(metricId: string, at: string, value: number, orgId = 'org-t'): MetricReadingInput {
  return {
    orgId, metricId, entityId: 'entity-1', observedAt: at,
    value, unit: '月',
    sourceType: 'compute', runId: 'r1', inputDigest: 'd1', defVersion: 'v1',
  };
}

beforeAll(() => {
  db = new Database(':memory:');
  metricReadingsMigration.up(db); // 真库表结构：用迁移本体建表（判据②）
});
afterAll(() => db.close());

describe('E5 ④a 测量值写读回环（#389）', () => {
  it('写入后能读回，逐字段匹配（判据②真库表结构+①业务读者）', () => {
    expect(sink()(row('cash.runway', '2026-10-11T09:00:00Z', 12.5)).written).toBe(true);
    const read = listRecentReadings(db, { orgId: 'org-t', days: 30 });
    expect(read.ok).toBe(true);
    expect(read.rows.length).toBe(1);
    const r = read.rows[0];
    expect(r.metric_id).toBe('cash.runway');
    expect(r.value).toBe(12.5);
    expect(r.org_id).toBe('org-t');
    expect(r.degraded).toBe(0);
  });

  it('标定供数口径：默认排除轮次级（SENTINEL-*），includeRound 显式包含', () => {
    expect(sink()(row('SENTINEL-s1', '2026-10-11T10:00:00Z', 3, 'org-t')).written).toBe(true);
    const withoutRound = listRecentReadings(db, { orgId: 'org-t', days: 30 });
    expect(withoutRound.rows.map(r => r.metric_id)).not.toContain('SENTINEL-s1');
    const withRound = listRecentReadings(db, { orgId: 'org-t', days: 30, includeRound: true });
    expect(withRound.rows.map(r => r.metric_id)).toContain('SENTINEL-s1');
  });

  it('趋势聚合：最新值/上一次值/环比（判据① 周报消费形态）', () => {
    expect(sink()(row('cash.runway', '2026-10-12T09:00:00Z', 9.0)).written).toBe(true);
    const trends = summarizeMetricTrends(db, { orgId: 'org-t', days: 30 });
    expect(trends.ok).toBe(true);
    const t = trends.summary.find(s => s.metricId === 'cash.runway');
    expect(t).toBeDefined();
    expect(t!.latestValue).toBe(9.0);
    expect(t!.previousValue).toBe(12.5);
    expect(t!.changeRatio).toBeCloseTo((9.0 - 12.5) / 12.5, 6);
  });

  it('表缺失 ⇒ 显式降级（不静默空数组；#22 同观测面）', () => {
    const empty = new Database(':memory:');
    const read = listRecentReadings(empty, {});
    expect(read.ok).toBe(false);
    expect(read.rows).toEqual([]);
    expect(read.errors?.[0]).toContain('TABLE_MISSING');
    empty.close();
  });
});
