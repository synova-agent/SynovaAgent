/**
 * probe-throwing-template.ts — D1051 T5 窄复核探针（成员 V，一次性只读探针，落 /tmp）
 *
 * 目的：独立验证成员 C 的三条关键信息之②：「注册一个『会抛的模板』不会触发 fallback
 *      （被 registry.render 吞成 `模板渲染失败: …` 字符串）」。
 *
 * 若「吞成字符串」为真且 report-assembler 侧有 `startsWith('模板渲染失败')` 判定，
 * 则**fallback 仍会被触发**（只是经字符串前缀路径而非异常路径）。
 * 本探针直接把该后果拿出来看：帧的 degraded / reason / markdown 文面。
 *
 * 运行: cd <worktree> && NODE_PATH=<repo>/node_modules npx tsx --tsconfig tsconfig.json /tmp/d1051v/probe-throwing-template.ts
 */
import express from 'express';
import Database from 'better-sqlite3';
import http from 'node:http';
import type { Server } from 'node:http';

const ROOT = process.cwd();
const ORG_ID = 'org-d1051-probe';
const REPORT_ID = 'rpt_d1051_probe_1';

async function main(): Promise<void> {
  const standIn: Server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c: Buffer) => { b += c.toString(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '收到。' } }] }));
    });
  });
  await new Promise<void>((r) => standIn.listen(0, '127.0.0.1', () => r()));
  const a = standIn.address();
  if (!a || typeof a === 'string') throw new Error('no port');
  process.env.DEV_MODE = 'false';
  process.env.SYNOVA_ORG_ID = ORG_ID;
  process.env.LLM_API_KEY = 'probe-standin';
  process.env.LLM_BASE_URL = `http://127.0.0.1:${a.port}`;
  process.env.LLM_MODEL = 'probe-model';

  const { default: conversationsRouter } = await import(`${ROOT}/src/routes/conversations.ts`);
  const { SessionStore } = await import(`${ROOT}/src/store/session-store.ts`);
  const { getReportTemplateRegistry } = await import(`${ROOT}/src/l3/report-templates.ts`);

  const db = new Database(':memory:');
  const store = new SessionStore(db);
  store.saveDiagnosisCheckpoint({
    sessionId: REPORT_ID,
    phase: 5,
    completedModules: [],
    partialReport: {
      reportId: REPORT_ID,
      report: {
        reportId: REPORT_ID, teamId: ORG_ID, generatedAt: '2026-09-28T10:00:00.000Z',
        summary: '探针：增长卡点在精加工工序产能。',
        expertReports: [{ expert: 'fundamental-efficiency', findings: ['产能利用率 96%'], confidence: 0.8 }],
        rootCauses: [{ description: '精加工工序产能不足', dimension: '效率', confidence: 0.77 }],
        recommendations: [{ action: '补足产能', priority: 'high', expert: 'fundamental-efficiency' }],
        raw: {},
      },
      teamId: ORG_ID, completedAt: '2026-09-28T10:00:00.000Z', source: 'probe',
    },
    savedAt: '2026-09-28T10:00:00.000Z',
  });

  // 注入面：注册一个「会抛的模板」覆盖 detailed_report（**不**覆写 registry.render 本身）
  const registry = getReportTemplateRegistry();
  registry.register({
    name: 'detailed_report',
    description: 'probe: always throws',
    render() { throw new Error('probe-throwing-template'); },
  });

  const app = express();
  app.use(express.json());
  app.locals.orchestration = { db };
  app.use(conversationsRouter);
  const server: Server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const sa = server.address();
  if (!sa || typeof sa === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${sa.port}`;

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    return { status: res.status, text: await res.text() };
  };
  const frames = (t: string) => t.split('\n\n').filter(b => b.includes('data: ')).map(b => {
    const lines = b.split('\n');
    return JSON.parse((lines.find(l => l.startsWith('data: ')) ?? '').replace('data: ', '')) as Record<string, unknown>;
  });

  const r1 = await post(`${base}/api/conversations`, { message: '我们是 50 人的制造企业', orgId: ORG_ID });
  const sid = (frames(r1.text).find(f => f.type === 'open')?.sessionId ?? '') as string;
  await post(`${base}/api/conversations/${sid}/messages`, { message: '团队分三块' });
  const r3 = await post(`${base}/api/conversations/${sid}/messages`, { message: '讲细一点' });
  const rv = frames(r3.text).find(f => f.type === 'report_view') as
    { degraded?: unknown; reason?: unknown; markdown?: unknown } | undefined;
  const md = typeof rv?.markdown === 'string' ? rv.markdown : '';
  const out = {
    probe: 'throwing-template（不覆写 registry.render）',
    httpStatus: r3.status,
    framePresent: rv !== undefined,
    degraded: rv?.degraded,
    reason: rv?.reason,
    markdownStartsWith: md.slice(0, 60),
    markdownHasDegradedMark: md.includes('（降级：'),
    markdownHasSwallowString: md.includes('模板渲染失败'),
    verdict: rv?.degraded === true ? 'FALLBACK 仍被触发（C 的「不会触发 fallback」不成立）' : 'fallback 未触发（C 的说法成立）',
  };
  console.log('[PROBE-RESULT] ' + JSON.stringify(out, null, 2));
  server.close(); standIn.close();
}

main().catch((e: unknown) => { console.error('[PROBE-FATAL]', e instanceof Error ? e.message : String(e)); process.exit(1); });
