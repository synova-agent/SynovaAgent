/**
 * sentinel-metrics-readings.route.test.ts — E5 / #389：测量值读回**路由级**判据
 * （真 express + 真表 + 真路由；不依赖全进程 boot——本机 full-boot 有独立环境问题，见收口件）
 * 覆盖：① 读回逐字段 ② 标定供数口径（默认排除轮次级；includeRound=1 包含）
 *       ③ db 未注入 ⇒ 503 METRIC_READINGS_DB_NOT_WIRED（降级显式） ④ trends 视图
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import sentinelRoutes from '../../src/routes/sentinel';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { metricReadingsMigration } from '../../src/store/migrations/002-metric-readings';

process.env.JWT_SECRET = 'e5-route-secret-0123456789abcdef';
process.env.DEV_MODE = 'false';

let base = '';
let server: Server | undefined;
let db: Database.Database;

beforeAll(async () => {
  db = new Database(':memory:');
  metricReadingsMigration.up(db);
  const sink = createMetricSink(db);
  const base_row = { orgId: 'default', entityId: 'e-1', unit: '月', sourceType: 'compute' as const, runId: 'r', inputDigest: 'd', defVersion: 'v' };
  sink({ ...base_row, metricId: 'route.metric.a', value: 5, observedAt: new Date().toISOString() });
  sink({ ...base_row, metricId: 'SENTINEL-route-s', value: 1, observedAt: new Date().toISOString() });

  const app = express();
  app.use(express.json());
  (app.locals as { orchestration?: unknown }).orchestration = { db };
  app.use('/api/sentinel', sentinelRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
});
afterAll(() => { server?.close(); db.close(); });

async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('E5 GET /api/sentinel/metrics/readings（路由级）', () => {
  it('读回指标级行，逐字段匹配', async () => {
    const r = await get('/api/sentinel/metrics/readings?days=1');
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    const row = r.json.rows.find((x: any) => x.metric_id === 'route.metric.a');
    expect(row).toBeDefined();
    expect(row.value).toBe(5);
    expect(row.org_id).toBe('default');
  });
  it('标定供数口径：默认排除轮次级；includeRound=1 包含', async () => {
    const a = await get('/api/sentinel/metrics/readings?days=1');
    expect(a.json.rows.some((x: any) => x.metric_id.startsWith('SENTINEL-'))).toBe(false);
    const b = await get('/api/sentinel/metrics/readings?days=1&includeRound=1');
    expect(b.json.rows.some((x: any) => x.metric_id === 'SENTINEL-route-s')).toBe(true);
  });
  it('trends 视图：聚合含最新值', async () => {
    const r = await get('/api/sentinel/metrics/readings?view=trends&days=1');
    expect(r.json.ok).toBe(true);
    expect(r.json.summary.some((s: any) => s.metricId === 'route.metric.a' && s.latestValue === 5)).toBe(true);
  });
});

describe('E5 降级显式', () => {
  it('db 未注入 ⇒ 503 METRIC_READINGS_DB_NOT_WIRED', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/api/sentinel', sentinelRoutes);
    const s2 = app2.listen(0);
    await new Promise<void>((r) => s2.once('listening', r));
    const port = (s2.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/sentinel/metrics/readings`);
    const json: any = await res.json().catch(() => null);
    expect(res.status).toBe(503);
    expect(json?.code).toBe('METRIC_READINGS_DB_NOT_WIRED');
    s2.close();
  });
});
