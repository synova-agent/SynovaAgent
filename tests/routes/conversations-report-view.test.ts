/**
 * tests/routes/conversations-report-view.test.ts — D1051 W5 对话调深度帧集成测试
 *
 * 覆盖（spec §5.5 帧契约 + §5.1 T4 + §7.3 判别性夹具 J3/J5 + DS9/DS11/DS12）:
 *   3-3 正常 —— 归档报告注入后发「讲细一点」→ 流内出现 `report_view` 且 `depth='detailed'`
 *   3-3 反向 —— 发「说人话」→ `depth='one_pager'`
 *   零回归判别 —— 不含深度词 → **无 `report_view` 帧**（J5）
 *   不伪造 —— 无可用报告 → `degraded:true, reason:'NO_REPORT'`（DS12）
 *   硬约束 —— 末帧仍为 `end`、全程**无 `error` 帧**；`complete` 帧既有字段不动（DS10）
 *   同源同构 —— 帧内 markdown ≡ HTTP `?depth=` 同深度产物（DS11，同一 `renderReportView`）
 *
 * 真实入口：express + listen(0) + 真实 fetch + 真实 better-sqlite3 ':memory:'；
 * 固定诊断产物经生产同款写入口 `saveDiagnosisCheckpoint`（phase=5）注入。
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
      name: 'fake-d1051-conv-provider',
      baseUrl: 'fake://d1051-conv-test',
      async chat() { return { content: '收到。请继续。', model: 'fake' }; },
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

// ═══ helpers ═══

interface SseFrame { type: string; data: Record<string, unknown> }

function parseSseFrames(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter(block => block.includes('data: '))
    .map(block => {
      const dataLine = block.split('\n').find(l => l.startsWith('data: ')) ?? '';
      const data = JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>;
      return { type: typeof data.type === 'string' ? data.type : '', data };
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

// ═══ 固定诊断产物（spec §5.5 形状）═══

const FIXED_REPORT_ID = 'd1051-conv-report-001';
const ORG_WITH_REPORT = 'd1051-org';
const ORG_WITHOUT_REPORT = 'd1051-empty-org';

function fixedArchivePartialReport(): Record<string, unknown> {
  return {
    reportId: FIXED_REPORT_ID,
    teamId: ORG_WITH_REPORT,
    completedAt: '2026-09-28T00:00:00.000Z',
    source: 'conversation',
    report: {
      reportId: FIXED_REPORT_ID,
      teamId: ORG_WITH_REPORT,
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

describe('D1051 W5: 对话调深度（report_view 帧，真实路由 + 真实 HTTP）', () => {
  let server: Server | undefined;
  let baseUrl = '';
  let db: Database.Database;

  /** 开一个会话并返回 sessionId（open 帧回声） */
  async function openSession(orgId: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我们是一家 50 人的制造企业', orgId }),
    });
    expect(res.status).toBe(200);
    const frames = parseSseFrames(await res.text());
    const open = frames.find(f => f.type === 'open');
    const sessionId = open?.data.sessionId;
    expect(typeof sessionId).toBe('string');
    return sessionId as string;
  }

  /**
   * 向已有会话发一条消息，返回全部 SSE 帧。
   * orgId 必须随每轮传入——路由按请求体解析 orgId（不随会话持久化），
   * 缺省会退化为 'default' 而使归档按 orgId 过滤落空。
   */
  async function sendMessage(sessionId: string, message: string, orgId: string): Promise<SseFrame[]> {
    const res = await fetch(`${baseUrl}/api/conversations/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, orgId }),
    });
    expect(res.status).toBe(200);
    return parseSseFrames(await res.text());
  }

  beforeAll(async () => {
    process.env.DEV_MODE = 'true';
    const diagnosisRouter = (await import('../../src/routes/diagnosis')).default;
    const conversationsRouter = (await import('../../src/routes/conversations')).default;

    const app = express();
    app.use(express.json());
    db = new Database(':memory:');
    app.locals.orchestration = { db };
    app.locals.graphStore = { queryNodes: async () => [], queryEdges: async () => [], traverse: async () => [] };
    app.use(diagnosisRouter);
    app.use(conversationsRouter);
    server = app.listen(0);
    baseUrl = await waitListening(server);

    // 固定诊断产物注入（生产同款写入口，phase=5 归档行）
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

  it('① 「讲细一点」→ report_view 帧，depth=detailed，markdown 含详版章节（3-3 正向）', async () => {
    const sessionId = await openSession(ORG_WITH_REPORT);
    const frames = await sendMessage(sessionId, '讲细一点', ORG_WITH_REPORT);

    const view = frames.find(f => f.type === 'report_view');
    expect(view).toBeTruthy();
    expect(view?.data.depth).toBe('detailed');
    expect(view?.data.sessionId).toBe(sessionId);
    expect(view?.data.reportId).toBe(FIXED_REPORT_ID);
    expect(view?.data.degraded).toBe(false);

    const markdown = view?.data.markdown as string;
    expect(typeof markdown).toBe('string');
    expect(markdown).toContain('### 专家完整推理');
    expect(markdown).toContain('### 数据时点');

    // 硬约束：末帧 end、无 error 帧
    expect(frames[frames.length - 1].type).toBe('end');
    expect(frames.filter(f => f.type === 'error')).toHaveLength(0);
  });

  it('② 「说人话」→ report_view 帧，depth=one_pager，markdown 为四槽位一页纸（3-3 反向）', async () => {
    const sessionId = await openSession(ORG_WITH_REPORT);
    const frames = await sendMessage(sessionId, '说人话', ORG_WITH_REPORT);

    const view = frames.find(f => f.type === 'report_view');
    expect(view).toBeTruthy();
    expect(view?.data.depth).toBe('one_pager');
    expect(view?.data.degraded).toBe(false);

    const markdown = view?.data.markdown as string;
    expect(markdown).toContain('### 结论');
    // 一页纸 ≠ 详版（判别性：若两方向产物相同，本断言报红）
    expect(markdown).not.toContain('### 专家完整推理');

    expect(frames[frames.length - 1].type).toBe('end');
    expect(frames.filter(f => f.type === 'error')).toHaveLength(0);
  });

  it('③ 零回归判别（J5）：不含深度词 → 无 report_view 帧', async () => {
    const sessionId = await openSession(ORG_WITH_REPORT);
    const frames = await sendMessage(sessionId, '我们下一季度的招聘计划需要重新评估一下', ORG_WITH_REPORT);

    expect(frames.filter(f => f.type === 'report_view')).toHaveLength(0);
    // 既有帧序列不受影响
    expect(frames[frames.length - 1].type).toBe('end');
    expect(frames.filter(f => f.type === 'error')).toHaveLength(0);
  });

  it('④ 不伪造（DS12）：无可用报告 → degraded:true + reason=NO_REPORT + markdown=null', async () => {
    const sessionId = await openSession(ORG_WITHOUT_REPORT);
    const frames = await sendMessage(sessionId, '讲细一点', ORG_WITHOUT_REPORT);

    const view = frames.find(f => f.type === 'report_view');
    expect(view).toBeTruthy();
    expect(view?.data.degraded).toBe(true);
    expect(view?.data.reason).toBe('NO_REPORT');
    expect(view?.data.markdown).toBeNull();
    expect(view?.data.reportId).toBeNull();
    expect(view?.data.depth).toBe('detailed');

    expect(frames[frames.length - 1].type).toBe('end');
    expect(frames.filter(f => f.type === 'error')).toHaveLength(0);
  });

  it('⑤ 同源同构（DS11）：帧内 markdown ≡ HTTP `?depth=detailed` 产物', async () => {
    const sessionId = await openSession(ORG_WITH_REPORT);
    const frames = await sendMessage(sessionId, '讲细一点', ORG_WITH_REPORT);
    const view = frames.find(f => f.type === 'report_view');
    const frameMarkdown = view?.data.markdown as string;

    const httpRes = await fetch(`${baseUrl}/api/diagnosis/consult/${FIXED_REPORT_ID}/report?format=markdown&depth=detailed`);
    expect(httpRes.status).toBe(200);
    const httpMarkdown = await httpRes.text();

    // 两入口共用 renderReportView ⇒ 同深度产物字节相等
    expect(frameMarkdown).toBe(httpMarkdown);
  });

  it('⑥ 幂等：同一会话连发两次「讲细一点」→ 两帧 markdown 字节相等（无时刻污染）', async () => {
    const sessionId = await openSession(ORG_WITH_REPORT);
    const first = (await sendMessage(sessionId, '讲细一点', ORG_WITH_REPORT)).find(f => f.type === 'report_view');
    const second = (await sendMessage(sessionId, '讲细一点', ORG_WITH_REPORT)).find(f => f.type === 'report_view');
    expect(typeof first?.data.markdown).toBe('string');
    expect(second?.data.markdown).toBe(first?.data.markdown);
  });
});
