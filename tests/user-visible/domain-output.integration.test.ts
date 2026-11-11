import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { metricReadingsMigration } from '../../src/store/migrations/002-metric-readings';
import sentinelRoutes from '../../src/routes/sentinel';
import dataRoutes from '../../src/routes/data';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { loadMeasurementTrends } from '../../electron-renderer/src/lib/measurement-trends';
import { MeasurementTrendSection } from '../../electron-renderer/src/components/MeasurementTrendSection';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';
import { isRecord, listen, request, type RunningHttpServer } from './support/http';
import { saveEnvironment } from './support/environment';

const ORG_A = 'uv-domain-a';
const ORG_B = 'uv-domain-b';
const ORG_EMPTY = 'uv-domain-empty';
const METRICS = [
  'CASH-FLOW-NET-MARGIN', 'CASH-FLOW-GROSS-MARGIN',
  'CASH-FLOW-REVENUE-YOY-GROWTH', 'CASH-FLOW-RUNWAY-MONTHS',
] as const;
const EXPECTED = { net: 13 / 15, gross: 1, yoy: 1, runway: 9, previousNet: 4 / 5 } as const;
const restoreEnv = saveEnvironment(['DEV_MODE', 'JWT_SECRET', 'SYNOVA_ORG_ID']);
let tempDir = '';
let db: Database.Database;
let store: SqliteGraphStore;
let running: RunningHttpServer;
const realFetch = globalThis.fetch;

function erpRow(revenue: number, cash: number, period: string): Record<string, string | number> {
  return {
    营业收入: revenue, 经营现金流: Math.round(revenue * 0.12), 固定资产净值: 30,
    总负债: 40, 所有者权益: 60, 现金余额: cash, 毛利润: Math.round(revenue * 0.6),
    营业费用: 20, 总资产: revenue, 流动资产: Math.round(revenue / 2), 流动负债: 20,
    应收账款: 15, 存货: 5, 期间: period,
  };
}

function tokenFor(orgId: string): string {
  const token = signJwtToken({ sub: `uv-${orgId}`, role: 'admin', orgId });
  expect(token).not.toBeNull();
  return token ?? '';
}

function useIdentity(orgId: string): void {
  const token = tokenFor(orgId);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    return realFetch(input, { ...init, headers });
  });
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'synova-uv-domain-'));
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = 'uv-domain-secret-0123456789abcdef';
  process.env.SYNOVA_ORG_ID = ORG_A;
  db = new Database(join(tempDir, 'domain.db'));
  store = new SqliteGraphStore(db);
  metricReadingsMigration.up(db);
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.locals.orchestration = { db };
  app.locals.graphStore = store;
  app.use('/api/sentinel', sentinelRoutes);
  app.use(dataRoutes);
  running = await listen(app);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await running.close();
  db.close();
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('UV-05 经营数据到测量趋势', () => {
  it('两期真实上传经生产哨兵产生四个手算指标与前后趋势', async () => {
    const token = tokenFor(ORG_A);
    for (const row of [erpRow(100, 60, '2026-01'), erpRow(200, 120, '2026-02')]) {
      const uploaded = await request(running.baseUrl, 'POST', '/api/data/upload', {
        token, body: { mapping: 'erp-standard', rows: [row], graph: ORG_A },
      });
      expect(uploaded.status).toBe(200);
      expect(isRecord(uploaded.body) && uploaded.body.ok).toBe(true);
      expect(isRecord(uploaded.body) && uploaded.body.nodesCreated).toBe(1);
      expect(isRecord(uploaded.body) && uploaded.body.errors).toEqual([]);
      const checked = await cashFlowSentinel.check({
        db: store, rawDb: db, metricSink: createMetricSink(db), teamId: ORG_A, now: new Date(),
      });
      expect(checked.ok).toBe(true);
      expect(checked.degraded).toBe(false);
    }

    const rows = db.prepare(
      `SELECT metric_id, value, source_id FROM metric_readings WHERE org_id = ? ORDER BY rowid`,
    ).all(ORG_A) as Array<{ metric_id: string; value: number; source_id: string }>;
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((row) => row.metric_id))).toEqual(new Set(METRICS));
    expect(rows.every((row) => row.source_id === 'SENTINEL-CASH-FLOW-v1')).toBe(true);
    const latest = new Map(METRICS.map((id) => [id, rows.filter((row) => row.metric_id === id).at(-1)?.value]));
    expect(latest.get(METRICS[0])).toBeCloseTo(EXPECTED.net, 9);
    expect(latest.get(METRICS[1])).toBeCloseTo(EXPECTED.gross, 9);
    expect(latest.get(METRICS[2])).toBeCloseTo(EXPECTED.yoy, 9);
    expect(latest.get(METRICS[3])).toBeCloseTo(EXPECTED.runway, 9);

    const trends = await request(running.baseUrl, 'GET', '/api/sentinel/metrics/readings?view=trends', { token });
    expect(trends.status).toBe(200);
    const summary = isRecord(trends.body) && Array.isArray(trends.body.summary) ? trends.body.summary : [];
    const net = summary.find((item) => isRecord(item) && item.metricId === METRICS[0]);
    expect(isRecord(net) && net.latestValue).toBeCloseTo(EXPECTED.net, 9);
    expect(isRecord(net) && net.previousValue).toBeCloseTo(EXPECTED.previousNet, 9);
    expect(isRecord(net) && net.changeRatio).toBeCloseTo((EXPECTED.net - EXPECTED.previousNet) / EXPECTED.previousNet, 9);
  });
});

describe('UV-07 桌面测量值与趋势输出', () => {
  it('真实 API→loader→Section 只展示当前组织真值，空组织显示空态而非降级', async () => {
    const isolated = createMetricSink(db)({
      orgId: ORG_B, metricId: 'UV-B-ONLY', value: 999, unit: 'ratio', sourceType: 'compute', sourceId: 'UV-ISOLATION-FIXTURE',
      observedAt: new Date().toISOString(),
    });
    expect(isolated.written).toBe(true);
    useIdentity(ORG_A);
    const view = await loadMeasurementTrends(running.baseUrl, ORG_A);
    expect(view.ok).toBe(true);
    expect(view.degraded).toBe(false);
    const net = view.summary.find((item) => item.metricId === METRICS[0]);
    expect(net?.latestValue).toBeCloseTo(EXPECTED.net, 9);
    expect(net?.previousValue).toBeCloseTo(EXPECTED.previousNet, 9);
    expect(view.summary.some((item) => item.metricId === 'UV-B-ONLY')).toBe(false);

    const html = renderToStaticMarkup(MeasurementTrendSection({ view, state: 'ready', onOpenOnePager: () => undefined }));
    expect(html).toContain('测量值＋趋势');
    expect(html).toContain(METRICS[0]);
    expect(html).toContain(String(EXPECTED.net));
    expect(html).toContain('data-trend="up"');
    expect(html).toContain('data-testid="measurement-to-onepager"');
    expect(html).not.toContain('UV-B-ONLY');
    expect(html).not.toContain('999 ratio');

    useIdentity(ORG_EMPTY);
    const empty = await loadMeasurementTrends(running.baseUrl, ORG_EMPTY);
    expect(empty.ok).toBe(true);
    expect(empty.degraded).toBe(false);
    expect(empty.summary).toEqual([]);
    const emptyHtml = renderToStaticMarkup(MeasurementTrendSection({ view: empty, state: 'empty' }));
    expect(emptyHtml).toContain('data-testid="measurement-trend-empty"');
    expect(emptyHtml).not.toContain('data-testid="measurement-trend-degraded"');
    expect(emptyHtml).not.toContain('data-testid="measurement-trend-item"');
  });
});
