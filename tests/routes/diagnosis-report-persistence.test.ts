/**
 * tests/routes/diagnosis-report-persistence.test.ts — D593 报告落盘 + 读回 + 列表 + 白名单集成测试
 *
 * Spec: SYNOVA-IMPL-DSH-D593-report-persistence-20260908.md §7 用例表（1-10 + 增量 13）
 *   1. 落盘：consult 完成 → diagnosis_checkpoints phase=5 行存在，partial_report 含 reportId/report/teamId（SQL 断言）
 *   2. 读回（重启）：同 db 新 express app（vi.resetModules 清模块级内存 Map）→ GET /consult/{reportId}/report → 200
 *   3. 双 ID 兼容：进程内 consultId（内存键命中）→ 200；reportId（内存 miss → checkpoint 冷读）→ 200
 *   4. 未知 id：GET /consult/ghost/report → 404 {ok:false, code:'NOT_FOUND'}（语义保持）
 *   5. 列表：两次落盘 → GET /api/diagnosis/reports total=2、saved_at DESC、limit=1&offset=1 取第二条
 *   6. 白名单（P0-1 收尾）：无 Authorization 下四前缀非 401 + 非白名单对照探针 401；
 *      /api/solutions 以**真实 JWT Bearer** 验证可达性（D947/L-18：自报 x-synova-token 通道已断，
 *      见文件末 §功能回退登记）
 *   7. 降级：partial_report 损坏行跳过 + degraded:true + total 不缩水；db 缺失 → 503 STORE_UNAVAILABLE
 *   8. 对话桥落盘：conversations phaseComplete → checkpoint 行 source:'conversation'；同 db 重启后 GET 200
 *   9. 边界：limit=0 → 夹取 1；limit=1000 → 夹取 200；offset 负数 → 0
 *   10. markdown：checkpoint fallback 路径 ?format=markdown → text/markdown 200
 *   13.（增量，§7 L2c 行）FIFO 满后持久层仍可读：>50 次 consult 淘汰最旧内存条目 → 仍 GET 200
 *
 * 铁律 12: 集成测试走真实路由（express + listen(0) + fetch + 真实 better-sqlite3 ':memory:'），
 *          不 mock 管线——vi.mock 仅三处（providers / config / 诊断引擎工厂，spec §7 模式）。
 * "重启"模拟 = 同一 db 句柄 vi.resetModules() 后重新 import 路由构造新 express app 实例
 * （模块级 completedReports Map 清空，持久层保留——spec §7 声明的 D592 T9 测试内等价形态）。
 * red→green: 实现前本文件先存在且失败（列表路由 404 / reportId 404 / checkpoint 零行 / 白名单 401）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import type { Server } from 'http';
import { SessionStore } from '../../src/store/session-store';

// ════════════════════════════════════════════════════════════════
// N1 硬前置（D947）—— 夹具自证环境已就位，否则判空转
// 注：本文件描述块 beforeAll 会刻意切到「生产姿态」（DEV_MODE=false 且删 JWT_SECRET，
// 见 :184-185，对应用例 6 白名单 401 语义）；故用例 6 的 JWT 分支**就地重设并自证** N1。
// ════════════════════════════════════════════════════════════════

beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});

// ═══ hoisted mock 状态（vi.mock 工厂提升后仍可读写）═══
const mocks = vi.hoisted(() => ({
  /** 每次 fake 引擎完成的序号 → 确定性 reportId（rpt_d593_1, rpt_d593_2, ...） */
  consultSeq: { n: 0 },
}));

// ── mock ① 诊断引擎工厂：确定性发射事件 + 返回带 reportId 的报告（spec §7 模式）──
vi.mock('../../src/l3/synova-diagnosis-engine-impl', () => ({
  createSynovaDiagnosisEngine: () => ({
    async runConsultation(
      teamId: string,
      _initiator: unknown,
      _scope: unknown,
      onEvent?: (event: { type: string; phase: number; label?: string; message?: string; confidence?: number }) => void,
    ) {
      onEvent?.({ type: 'phase_started', phase: 1, label: '数据采集', confidence: 0.9 });
      onEvent?.({ type: 'interim_finding', phase: 2, message: '客户集中度过高', confidence: 0.7 });
      mocks.consultSeq.n += 1;
      return {
        teamId,
        report: { reportId: `rpt_d593_${mocks.consultSeq.n}`, summary: 'D593 测试诊断报告' },
        totalDurationMs: 7,
        degradedModules: [],
      };
    },
  }),
}));

// ── mock ② providers：importOriginal spread（server import 链上 llm-config 消费其他导出）──
vi.mock('../../src/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers')>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake-d593-provider',
      baseUrl: 'fake://d593-test',
      async chat(_messages: unknown, _opts?: unknown) {
        return { content: '收到。', model: 'fake' };
      },
      async healthCheck() { return { healthy: true, latencyMs: 1 }; },
      listModels() { return ['fake']; },
    }),
  };
});
vi.mock('../../src/providers/detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/detect')>();
  return { ...actual, detectProvider: () => 'deepseek' };
});

// ── mock ③ config：定值（spread actual 保真其余导出）──
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

// ═══ helpers ═══

interface SseFrame { data: Record<string, unknown> }

function parseSseFrames(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter(block => block.includes('data: '))
    .map(block => {
      const dataLine = block.split('\n').find(l => l.startsWith('data: ')) ?? '';
      return { data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown> };
    });
}

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

/** 跑一次 consult，返回 {consultId, reportId}（complete 帧 report.reportId） */
async function runConsult(baseUrl: string, teamId: string): Promise<{ consultId: string; reportId: string }> {
  const res = await fetch(`${baseUrl}/api/diagnosis/consult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, initiator: { role: 'GA', name: '测试GA' } }),
  });
  expect(res.status).toBe(200);
  const consultId = res.headers.get('X-Consult-Id');
  expect(consultId).toBeTruthy();
  const frames = parseSseFrames(await res.text());
  const complete = frames.find(f => f.data.type === 'complete');
  const report = complete?.data.report as { reportId?: string } | undefined;
  expect(typeof report?.reportId).toBe('string');
  return { consultId: consultId as string, reportId: report?.reportId as string };
}

interface ReportListItem {
  reportId: string;
  teamId: string;
  completedAt: string;
  summary: string | null;
  onePagerAvailable: boolean;
}
interface ReportListResponse {
  ok: boolean;
  total: number;
  reports: ReportListItem[];
  degraded?: boolean;
  code?: string;
}

interface CheckpointRow {
  session_id: string;
  phase: number;
  partial_report: string;
  saved_at: string;
}

/** 构造"重启后"的 express app：vi.resetModules() 清模块级内存 Map，同 db 重新挂路由 */
async function buildReplayApp(db: Database.Database): Promise<{ app: express.Express }> {
  vi.resetModules();
  const mod = await import('../../src/routes/diagnosis');
  const app = express();
  app.use(express.json());
  app.locals.orchestration = { db };
  app.use(mod.default);
  return { app };
}

// ═══ tests ═══

describe('D593: 报告落盘 + 读回 + 列表 + 白名单（spec §7 用例表）', () => {
  let server: Server | undefined;
  let serverNoDb: Server | undefined;
  let serverAuth: Server | undefined;
  let serverReplay: Server | undefined;
  let baseUrl = '';
  let noDbUrl = '';
  let authUrl = '';
  let replayUrl = '';
  let db: Database.Database;

  beforeAll(async () => {
    // 白名单用例生产态语义（conversations.test.ts 用例③先例）：DEV_MODE=false 让 JWT 中间件真实拦截
    process.env.DEV_MODE = 'false';
    delete process.env.JWT_SECRET;

    const diagnosisRouter = (await import('../../src/routes/diagnosis')).default;
    const conversationsRouter = (await import('../../src/routes/conversations')).default;
    const { jwtAuthMiddleware } = await import('../../src/middleware/auth');

    // appMain: orchestration.db 在场（落盘目标库）——consult + 对话桥 + 列表主战场
    const app = express();
    app.use(express.json());
    db = new Database(':memory:');
    app.locals.orchestration = { db };
    app.use(diagnosisRouter);
    app.use(conversationsRouter);
    server = app.listen(0);
    baseUrl = await waitListening(server);

    // appNoDb: orchestration 缺失（db 缺失 → 列表 503 STORE_UNAVAILABLE，用例 7b）
    const appNoDb = express();
    appNoDb.use(express.json());
    appNoDb.use(diagnosisRouter);
    serverNoDb = appNoDb.listen(0);
    noDbUrl = await waitListening(serverNoDb);

    // appAuth: 真实 jwtAuthMiddleware + 五前缀路由 + 非白名单对照探针（用例 6）
    const gaAdminRoutes = (await import('../../src/routes/ga-admin')).default;
    const solutionsRoutes = (await import('../../src/routes/solutions')).default;
    const notificationsRoutes = (await import('../../src/routes/notifications')).default;
    const appAuth = express();
    appAuth.use(express.json());
    appAuth.locals.orchestration = { db };
    appAuth.use(jwtAuthMiddleware);
    appAuth.use(diagnosisRouter);
    appAuth.use(gaAdminRoutes);
    appAuth.use(solutionsRoutes);
    appAuth.use(notificationsRoutes);
    appAuth.get('/api/d593-probe', (_req, res) => res.json({ ok: true })); // 非白名单对照探针
    serverAuth = appAuth.listen(0);
    authUrl = await waitListening(serverAuth);
  });

  afterAll(async () => {
    const servers = [server, serverNoDb, serverAuth, serverReplay].filter((s): s is Server => s !== undefined);
    await Promise.all(servers.map(srv =>
      new Promise<void>(resolve => srv.close(() => resolve())),
    ));
    // 恢复 vitest 全局 env（不泄漏到其他测试文件）
    process.env.DEV_MODE = 'true';
  });

  it('用例 1: 落盘——consult 完成 → diagnosis_checkpoints phase=5 行存在（partial_report 含 reportId/report/teamId）', async () => {
    const { reportId } = await runConsult(baseUrl, 'org-d593-a');

    const rows = db.prepare(
      'SELECT session_id, phase, partial_report, saved_at FROM diagnosis_checkpoints WHERE phase = 5',
    ).all() as CheckpointRow[];
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe(reportId);

    const partial = JSON.parse(rows[0].partial_report) as {
      reportId?: string; teamId?: string; consultId?: string;
      report?: { summary?: string }; completedAt?: string; source?: string;
    };
    expect(partial.reportId).toBe(reportId);
    expect(partial.teamId).toBe('org-d593-a');
    expect(partial.consultId).toBeTruthy();
    expect(partial.report?.summary).toBe('D593 测试诊断报告');
    expect(typeof partial.completedAt).toBe('string');
    expect(partial.source).toBe('consult');
  });

  it('用例 2: 读回（重启）——同 db 新 app 实例（内存 Map 清空）→ GET /consult/{reportId}/report → 200', async () => {
    const { reportId } = await runConsult(baseUrl, 'org-d593-b');

    const { app } = await buildReplayApp(db);
    if (serverReplay) {
      await new Promise<void>(resolve => serverReplay.close(() => resolve()));
    }
    serverReplay = app.listen(0);
    replayUrl = await waitListening(serverReplay);

    const rep = await fetch(`${replayUrl}/api/diagnosis/consult/${reportId}/report`);
    expect(rep.status).toBe(200);
    const body = (await rep.json()) as { ok: boolean; teamId: string; report: { reportId?: string; summary?: string } };
    expect(body.ok).toBe(true);
    expect(body.report.reportId).toBe(reportId);
    expect(body.teamId).toBe('org-d593-b');
  });

  it('用例 3: 双 ID 兼容——进程内 consultId（内存命中）→ 200；reportId（内存 miss → checkpoint 冷读）→ 200', async () => {
    const { consultId, reportId } = await runConsult(baseUrl, 'org-d593-c');

    const byConsult = await fetch(`${baseUrl}/api/diagnosis/consult/${consultId}/report`);
    expect(byConsult.status).toBe(200);
    const bodyConsult = (await byConsult.json()) as { ok: boolean; report: { reportId?: string } };
    expect(bodyConsult.ok).toBe(true);
    expect(bodyConsult.report.reportId).toBe(reportId);

    const byReport = await fetch(`${baseUrl}/api/diagnosis/consult/${reportId}/report`);
    expect(byReport.status).toBe(200);
    const bodyReport = (await byReport.json()) as { ok: boolean; report: { reportId?: string } };
    expect(bodyReport.ok).toBe(true);
    expect(bodyReport.report.reportId).toBe(reportId);
  });

  it('用例 4: 未知 id → 404（形状 {ok:false, code:"NOT_FOUND"}，语义保持）', async () => {
    const rep = await fetch(`${baseUrl}/api/diagnosis/consult/ghost/report`);
    expect(rep.status).toBe(404);
    const body = (await rep.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('用例 5: 列表——两次落盘 → total=2、saved_at DESC、limit=1&offset=1 取第二条', async () => {
    const first = await runConsult(baseUrl, 'org-d593-e1');
    const second = await runConsult(baseUrl, 'org-d593-e2');
    expect(first.reportId).not.toBe(second.reportId);

    const all = await fetch(`${baseUrl}/api/diagnosis/reports`);
    expect(all.status).toBe(200);
    const bodyAll = (await all.json()) as ReportListResponse;
    expect(bodyAll.ok).toBe(true);
    expect(bodyAll.total).toBeGreaterThanOrEqual(2);
    expect(bodyAll.reports.length).toBeGreaterThanOrEqual(2);
    // 最新（第二次 consult）在列表首位（saved_at DESC + rowid 稳定决 streak）
    expect(bodyAll.reports[0].reportId).toBe(second.reportId);
    expect(bodyAll.reports[0].teamId).toBe('org-d593-e2');
    expect(typeof bodyAll.reports[0].completedAt).toBe('string');
    expect(bodyAll.reports[0].summary).toBe('D593 测试诊断报告');
    expect(typeof bodyAll.reports[0].onePagerAvailable).toBe('boolean');

    const page = await fetch(`${baseUrl}/api/diagnosis/reports?limit=1&offset=1`);
    expect(page.status).toBe(200);
    const bodyPage = (await page.json()) as ReportListResponse;
    expect(bodyPage.ok).toBe(true);
    expect(bodyPage.reports.length).toBe(1);
    expect(bodyPage.reports[0].reportId).toBe(first.reportId);
  });

  it('用例 6: 白名单（P0-1 收尾）——无 Authorization：五前缀非 401 + 对照探针 401', async () => {
    // 四前缀：零凭证直达（白名单生效即非 401）
    const bare: Array<{ method: string; path: string }> = [
      { method: 'GET', path: '/api/diagnosis/reports' },
      { method: 'GET', path: '/api/notifications' },
      { method: 'GET', path: '/api/ga/clients' },
      { method: 'POST', path: '/api/ga/switch/org-x' },
    ];
    for (const { method, path } of bare) {
      const res = await fetch(`${authUrl}${path}`, { method });
      expect(res.status, `${method} ${path} 不应 401（D593 白名单五前缀）`).not.toBe(401);
      await res.text().catch(() => '');
    }
    // solutions：白名单只解决 jwtAuthMiddleware 层——solutions.ts:36/93 路由内还有 requireAuth
    // （extractAuthFromRequest）。
    //
    // D947（L-18 迁移）: 原用例用「桌面 seed 头 x-synova-token: ga:org-d593:u1」，该自报通道
    // 已随 D947 默认安全姿态断开（详见文件末 §功能回退登记）。本用例的真实意图是
    // 「P0-1 白名单收尾后 GA 仍可达 /api/solutions」——改用**真实 JWT Bearer** 才测到意图本身。
    // 断言强度**提高**：精确 200 + ok:true + solutions 为数组（原文仅为 not.toBe(401) 弱断言）。
    const jwtSecretPrev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'd947-test-secret-0123456789'; // N1：真实可验签密钥（就地重设并自证）
    process.env.DEV_MODE = 'false';
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
    expect(process.env.DEV_MODE).toBe('false');
    try {
      const { signJwtToken } = await import('../../src/middleware/auth');
      const gaJwt = signJwtToken({ sub: 'u1', role: 'ga', orgId: 'org-d593' });
      expect(gaJwt).toBeTruthy();

      const solutions = await fetch(`${authUrl}/api/solutions`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${gaJwt}` },
      });
      expect(solutions.status, 'GET /api/solutions 携带真实 JWT 应 200').toBe(200);
      const solBody = await solutions.json() as { ok: boolean; solutions: unknown[] };
      expect(solBody.ok).toBe(true);
      expect(Array.isArray(solBody.solutions)).toBe(true);
    } finally {
      if (jwtSecretPrev === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = jwtSecretPrev;
    }
    // 对照探针：非白名单路径仍 401（白名单没有因此被放宽）
    const probe = await fetch(`${authUrl}/api/d593-probe`);
    expect(probe.status).toBe(401);
  });

  it('用例 7a: 降级——partial_report 损坏行跳过 + degraded:true + total 恒准（不 500）', async () => {
    const { reportId } = await runConsult(baseUrl, 'org-d593-g');
    // 直接损坏该行（行级 JSON 损坏模拟——SessionStore.corruptLastEventPayload 同型手段）
    const before = db.prepare('SELECT partial_report FROM diagnosis_checkpoints WHERE session_id = ?').get(reportId) as { partial_report: string };
    db.prepare("UPDATE diagnosis_checkpoints SET partial_report='{broken' WHERE session_id = ?").run(reportId);

    const res = await fetch(`${baseUrl}/api/diagnosis/reports`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportListResponse;
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    // 损坏行跳过：列表中不含它
    expect(body.reports.find(r => r.reportId === reportId)).toBeUndefined();
    // total 恒为 phase=5 行计数（不因跳过缩水）
    const countRow = db.prepare('SELECT COUNT(*) AS c FROM diagnosis_checkpoints WHERE phase = 5').get() as { c: number };
    expect(body.total).toBe(countRow.c);
    // 其余行仍正常列出
    expect(body.reports.length).toBe(countRow.c - 1);
    // 还原该行（损坏仅限本用例作用域，不污染用例 9/13 的行计数断言）
    db.prepare('UPDATE diagnosis_checkpoints SET partial_report=? WHERE session_id = ?').run(before.partial_report, reportId);
  });

  it('用例 7b: 降级——db 缺失 → 列表 503 STORE_UNAVAILABLE（fail-closed）', async () => {
    const res = await fetch(`${noDbUrl}/api/diagnosis/reports`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; code?: string; degraded?: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('STORE_UNAVAILABLE');
    expect(body.degraded).toBe(true);
  });

  it('用例 8: 对话桥落盘——phaseComplete 诊断 → checkpoint source=conversation；同 db 重启后 GET 200', async () => {
    // 三轮访谈命中完成信号（detectPhaseComplete：'没有了' + turnCount>=3，conversations.test.ts ⑪ 先例）
    const r1 = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我们是 50 人的制造企业' }),
    });
    const frames1 = parseSseFrames(await r1.text());
    const open = frames1.find(f => f.data.type === 'open');
    const sessionId = typeof open?.data.sessionId === 'string' ? open.data.sessionId : undefined;
    expect(sessionId).toBeTruthy();

    await (await fetch(`${baseUrl}/api/conversations/${sessionId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '团队分生产/销售/研发三块' }),
    })).text();

    const r3 = await fetch(`${baseUrl}/api/conversations/${sessionId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '没有了，开始诊断' }),
    });
    expect(r3.status).toBe(200);
    const frames3 = parseSseFrames(await r3.text());
    const complete = frames3.find(f => f.data.type === 'complete');
    const report = complete?.data.report as { reportId?: string } | undefined;
    expect(typeof report?.reportId).toBe('string');
    const reportId = report?.reportId as string;

    // checkpoint 行存在且 source=conversation（对话路线无 consultId）
    const row = db.prepare(
      'SELECT session_id, partial_report FROM diagnosis_checkpoints WHERE session_id = ? AND phase = 5',
    ).get(reportId) as CheckpointRow | undefined;
    expect(row).toBeTruthy();
    const partial = JSON.parse((row as CheckpointRow).partial_report) as {
      source?: string; teamId?: string; consultId?: string; report?: { summary?: string };
    };
    expect(partial.source).toBe('conversation');
    expect(partial.teamId).toBeTruthy();
    expect(partial.consultId).toBeUndefined();
    expect(partial.report?.summary).toBe('D593 测试诊断报告');

    // 同 db 重启后（内存 Map 无此键——对话路线从不写内存）GET report 200
    const { app } = await buildReplayApp(db);
    const srv = app.listen(0);
    try {
      const url = await waitListening(srv);
      const rep = await fetch(`${url}/api/diagnosis/consult/${reportId}/report`);
      expect(rep.status).toBe(200);
      const body = (await rep.json()) as { ok: boolean; report: { reportId?: string } };
      expect(body.ok).toBe(true);
      expect(body.report.reportId).toBe(reportId);
    } finally {
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
  });

  it('用例 9: 边界——limit=0 夹取 1；limit=1000 夹取 200；offset 负数 → 0', async () => {
    await runConsult(baseUrl, 'org-d593-i');

    const r0 = await fetch(`${baseUrl}/api/diagnosis/reports?limit=0`);
    expect(r0.status).toBe(200);
    const b0 = (await r0.json()) as ReportListResponse;
    expect(b0.ok).toBe(true);
    expect(b0.reports.length).toBe(1); // 未夹取时 LIMIT 0 会返回 0 行

    const rBig = await fetch(`${baseUrl}/api/diagnosis/reports?limit=1000`);
    expect(rBig.status).toBe(200);
    const bBig = (await rBig.json()) as ReportListResponse;
    expect(bBig.ok).toBe(true);
    expect(bBig.reports.length).toBe(bBig.total); // 上限 200 内全量返回

    const rNeg = await fetch(`${baseUrl}/api/diagnosis/reports?offset=-5`);
    expect(rNeg.status).toBe(200);
    const bNeg = (await rNeg.json()) as ReportListResponse;
    expect(bNeg.ok).toBe(true);
    expect(bNeg.reports.length).toBeGreaterThanOrEqual(1); // 负 offset 按 0 处理，不全空
  });

  it('用例 10: markdown——checkpoint fallback 路径 ?format=markdown → text/markdown 200', async () => {
    const { reportId } = await runConsult(baseUrl, 'org-d593-j');
    const rep = await fetch(`${baseUrl}/api/diagnosis/consult/${reportId}/report?format=markdown`);
    expect(rep.status).toBe(200);
    expect(rep.headers.get('content-type')).toContain('text/markdown');
    const text = await rep.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('用例 13（增量 §7 L2c）: FIFO 满后持久层仍可读——51 次 consult 淘汰最旧内存条目 → GET 200', async () => {
    const oldest = await runConsult(baseUrl, 'org-d593-fifo');
    // 再跑 50 次（总 51 > COMPLETED_REPORTS_MAX=50）→ 最旧条目被 FIFO 淘汰
    for (let i = 0; i < 50; i++) {
      await runConsult(baseUrl, `org-d593-fifo-${i}`);
    }
    // 最旧 reportId 已不在内存 Map（键=consultId 也从未命中 reportId 查询）——
    // 但持久层仍在：GET 200 = 冷读 fallback 生效（防线语义：FIFO 上限不再等于报告丢失）
    const rep = await fetch(`${baseUrl}/api/diagnosis/consult/${oldest.reportId}/report`);
    expect(rep.status).toBe(200);
    const body = (await rep.json()) as { ok: boolean; report: { reportId?: string } };
    expect(body.ok).toBe(true);
    expect(body.report.reportId).toBe(oldest.reportId);
  });
});

// ════════════════════════════════════════════════════════════════
// §功能回退登记（D947 / L-18）—— 不是「测试调整」，是产品面行为变更
//
// 断开的东西: `x-synova-token: <role>:<orgId>:<userId>` 自报身份通道。
// 原因: D947 默认安全姿态——不经验签的字符串不得作为身份来源（判据 P0）。
//
// 运行时后果（已实测的调用方，均返 401）:
//   · /api/solutions                     ← src/routes/solutions.ts:32/37/46 requireAuth
//   · 全部 requireGa 的 /api/ga/*         ← src/routes/ga-auth.ts:21
//     （ga-annotations / ga-corrections / ga-admin）
//   · /api/audit、/api/enterprise、/api/ga/calibration、/api/ga/corrections
// 受影响客户端: 桌面 GA 的 dev-seed 旁路
//   · electron-renderer/src/components/RightPanel.tsx:155-159（seed 存在时附该头）
//   · electron-renderer/src/stores/ga-collab.ts:44/92（getSeedToken 组装 role:orgId:userId）
//
// 登记去向: 派单件 §六 遗留 2「electron-renderer 的 dev-seed 旁路将失效…正确修法
// （改走正规登录）属 Mac 域，须另立卡」——与 R5 / REV-8 并列为第 2 条功能回退。
// **本 PR 不修**；功能下线（迁移到 Bearer JWT）+ 该卡登记须由 CTO 执行「另立卡」。
// ════════════════════════════════════════════════════════════════
