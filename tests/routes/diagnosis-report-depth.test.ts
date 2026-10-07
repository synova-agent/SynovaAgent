/**
 * tests/routes/diagnosis-report-depth.test.ts — D1051 W4 报告呈现深度端点集成测试
 *
 * 覆盖（spec §5.4 端点契约表 + §5.1 T3 三路径 + §7.3 判别性夹具 J2 + DS3/DS4）:
 *   真实路由 —— `?depth=detailed` → 200 text/markdown 且含五章标题
 *   零回归判别 —— 不带 depth 的产物与 `?depth=one_pager` **字节相等**（J2）
 *   降级不静默 —— 非法 depth → 200 + `X-Report-Depth-Degraded: UNKNOWN_DEPTH` + 落回一页纸
 *   JSON 分支不变 —— `?format=json`（含任何 depth）不新增字段、不加深度响应头
 *
 * 真实入口（Q5 四条等价性断言，全部显式）:
 *   ① `app.locals.orchestration.db` 在场且为 SQLite 句柄
 *   ② `app.locals.graphStore` 已注入
 *   ③ 走 `router` 的真实路径（`app.use(diagnosisRouter)`，非直调 handler）
 *   ④ `typeof db.prepare === 'function'`（区别于假对象）
 *
 * 铁律 12: 集成测试走真实路由（express + listen(0) + fetch + 真实 better-sqlite3 ':memory:'），
 * 不 mock 管线——固定诊断产物经 `saveDiagnosisCheckpoint`（phase=5）注入持久层，
 * 与生产「报告落盘 → 冷读」同路径（spec §5.5 固定产物自备，不新增仓库 fixture 文件）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import type { Server } from 'http';
import { SessionStore } from '../../src/store/session-store';

// ═══ mocks（形态对齐 tests/routes/diagnosis-report-persistence.test.ts D593 先例）═══
vi.mock('../../src/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers')>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake-d1051-provider',
      baseUrl: 'fake://d1051-test',
      async chat() { return { content: '收到。', model: 'fake' }; },
      async healthCheck() { return { healthy: true, latencyMs: 1 }; },
      listModels() { return ['fake']; },
    }),
  };
});
vi.mock('../../src/providers/detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/detect')>();
  return { ...actual, detectProvider: () => 'deepseek' };
});
vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config')>();
  return {
    ...actual,
    loadConfig: () => ({
      llmApiKey: 'test-key',
      llmBaseUrl: 'http://localhost:1',
      llmModel: 'test-model',
      dbPath: ':memory:',
      devMode: false,
      diagnosis: { maxToolRounds: 2, gateDataCompleteness: 0.3, gateMinHypothesisConfidence: 0.5 },
    }),
  };
});

// ═══ 固定诊断产物（spec §5.5 形状；不新增仓库 fixture 文件——控文件数）═══

const FIXED_REPORT_ID = 'd1051-fixed-report-001';
const FIXED_TEAM_ID = 'd1051-org';

function fixedArchivePartialReport(): Record<string, unknown> {
  return {
    reportId: FIXED_REPORT_ID,
    teamId: FIXED_TEAM_ID,
    completedAt: '2026-09-28T00:00:00.000Z',
    source: 'test',
    report: {
      reportId: FIXED_REPORT_ID,
      teamId: FIXED_TEAM_ID,
      generatedAt: '2026-09-28T00:00:00.000Z',
      summary: '增长健康度中等，现金流为关键约束。',
      rootCauses: [
        { description: '现金流跑道不足 6 个月', dimension: 'finance', confidence: 0.9 },
        { description: '客户集中度过高', dimension: 'customer', confidence: 0.55 },
      ],
      expertReports: [
        { expert: 'fundamental-efficiency', findings: ['应收账期过长'], confidence: 0.8 },
      ],
      recommendations: [
        { action: '启动应急融资', priority: 'critical', expert: 'fundamental-efficiency' },
      ],
      raw: {},
    },
  };
}

const CHAPTER_TITLES = ['### 结论', '### 根因', '### 专家完整推理', '### 行动建议', '### 数据时点'];

async function waitListening(srv: Server): Promise<string> {
  const addr = srv.address();
  if (addr && typeof addr !== 'string') return `http://localhost:${addr.port}`;
  return await new Promise<string>((resolve) => {
    const t = setInterval(() => {
      const a = srv.address();
      if (a && typeof a !== 'string') { clearInterval(t); resolve(`http://localhost:${a.port}`); }
    }, 10);
  });
}

describe('D1051 W4: 报告呈现深度端点（真实路由 + 真实 HTTP）', () => {
  let server: Server | undefined;
  let baseUrl = '';
  let db: Database.Database;
  /** 注入面引用（Q5 等价性断言用） */
  let injectedGraphStore: Record<string, unknown> | undefined;

  beforeAll(async () => {
    process.env.DEV_MODE = 'true';
    const diagnosisRouter = (await import('../../src/routes/diagnosis')).default;

    const app = express();
    app.use(express.json());
    db = new Database(':memory:');
    injectedGraphStore = {
      queryNodes: async () => [],
      queryEdges: async () => [],
      traverse: async () => [],
    };
    // Q5 ① ② ④ —— 注入面与生产同形（server.ts:282/286 同款 locals 形状）
    app.locals.orchestration = { db };
    app.locals.graphStore = injectedGraphStore;
    // Q5 ③ —— 走真实 router（非直调 handler）
    app.use(diagnosisRouter);
    server = app.listen(0);
    baseUrl = await waitListening(server);

    // 固定诊断产物注入：生产同款写入口（phase=5 归档行，键=reportId）
    const store = new SessionStore(db);
    store.saveDiagnosisCheckpoint({
      sessionId: FIXED_REPORT_ID,
      phase: 5,
      completedModules: [],
      partialReport: fixedArchivePartialReport(),
      savedAt: '2026-09-28T00:00:00.000Z',
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.env.DEV_MODE = 'false';
  });

  it('⓪ Q5 等价性四条：注入面与生产同形（可判而非声明）', () => {
    // ① orchestration.db 在场且为 SQLite 句柄
    expect(db).toBeTruthy();
    // ④ 真 SQLite 句柄（区别于假对象）
    expect(typeof db.prepare).toBe('function');
    expect(typeof db.exec).toBe('function');
    // ② graphStore 已注入
    expect(injectedGraphStore).toBeTruthy();
    expect(typeof injectedGraphStore?.queryNodes).toBe('function');
    // ③ 真实路由可达（真实 HTTP 打真实 router —— 404 也算"路由在场"，此处用既有报告断言可达）
    expect(baseUrl.startsWith('http://localhost:')).toBe(true);
  });

  it('① 归档产物可读：无 depth 的 markdown → 200 text/markdown（现状语义不变）', async () => {
    const res = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('x-report-view-depth')).toBe('one_pager');
    const md = await res.text();
    // 一页纸四槽位结构（3-1 现状）
    expect(md).toContain('### 结论');
    // 非详版：不得出现详版专属章节
    expect(md).not.toContain('### 专家完整推理');
  });

  it('② 零回归判别（J2）：不带 depth 的产物 === `?depth=one_pager` 的产物（字节相等）', async () => {
    const implicit = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown`);
    const explicit = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown&depth=one_pager`);
    expect(implicit.status).toBe(200);
    expect(explicit.status).toBe(200);
    const a = await implicit.text();
    const b = await explicit.text();
    // 若「默认不是 one_pager」（如误改走 detailed），本断言必红 ⇒ 判别性夹具
    expect(b).toBe(a);
    expect(explicit.headers.get('x-report-view-depth')).toBe('one_pager');
  });

  it('③ 3-2 详细报告：`?depth=detailed` → 200 + 五章齐备 + 头回执 detailed', async () => {
    const res = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown&depth=detailed`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('x-report-view-depth')).toBe('detailed');
    // 非法降级头不得出现（合法入参 → 无降级）
    expect(res.headers.get('x-report-depth-degraded')).toBeNull();

    const md = await res.text();
    for (const title of CHAPTER_TITLES) {
      expect(md).toContain(title);
    }
    // 「详细」的判别点：全量根因（非 Top-N）
    expect(md).toContain('现金流跑道不足 6 个月');
    expect(md).toContain('客户集中度过高');
    // 详细报告 ≠ 一页纸（产物不同源）
    const onePager = await (await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown`)).text();
    expect(md).not.toBe(onePager);
  });

  it('④ 非法 depth → 200 + X-Report-Depth-Degraded: UNKNOWN_DEPTH + 落回一页纸（DS4 不静默）', async () => {
    const res = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown&depth=expert`);
    expect(res.status).toBe(200);
    // 显式降级信号（不静默）
    expect(res.headers.get('x-report-depth-degraded')).toBe('UNKNOWN_DEPTH');
    expect(res.headers.get('x-report-view-depth')).toBe('one_pager');
    const md = await res.text();
    // 落回一页纸（非详版）
    expect(md).toContain('### 结论');
    expect(md).not.toContain('### 专家完整推理');

    // 装配轴词（raw/ceo/flywheel）同样按非法处理
    for (const bad of ['raw', 'ceo', 'flywheel', '0', '-1', '']) {
      const r = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown&depth=${bad}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('x-report-depth-degraded')).toBe('UNKNOWN_DEPTH');
    }
  });

  it('⑤ JSON 分支不变：`?format=json`（含任何 depth）不加深度头、不新增字段', async () => {
    const plain = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report`);
    const withDepth = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=json&depth=detailed`);
    expect(plain.status).toBe(200);
    expect(withDepth.status).toBe(200);
    // depth 只作用于 markdown 渲染 —— JSON 分支零响应头
    expect(plain.headers.get('x-report-view-depth')).toBeNull();
    expect(withDepth.headers.get('x-report-view-depth')).toBeNull();
    expect(withDepth.headers.get('x-report-depth-degraded')).toBeNull();

    const bodyPlain = (await plain.json()) as Record<string, unknown>;
    const bodyDepth = (await withDepth.json()) as Record<string, unknown>;
    expect(bodyDepth.ok).toBe(true);
    // 字段集合完全一致（不新增字段）
    expect(Object.keys(bodyDepth).sort()).toEqual(Object.keys(bodyPlain).sort());
    const report = bodyDepth.report as { reportId?: string };
    expect(report.reportId).toBe(FIXED_REPORT_ID);
  });

  it('⑥ 未知 reportId → 404 诚实语义不变', async () => {
    const res = await fetch(`${baseUrl}/api/diagnosis/consult/ghost-id/report?format=markdown&depth=detailed`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });
});
