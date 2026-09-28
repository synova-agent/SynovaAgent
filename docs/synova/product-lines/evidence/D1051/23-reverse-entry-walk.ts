/**
 * 23-reverse-entry-walk.ts — D1051 独立复核 · 反向走入口 harness（成员 V，独立于编码成员 C）
 *
 * 目的：**不用 C 的调用方式**，自己从真实 HTTP 入口重走 D1051 四条用户可见路径：
 *   ① GET /api/diagnosis/consult/:id/report?format=markdown            → 默认一页纸（浅）
 *   ② GET 同端点 &depth=one_pager                                      → 与 ① 字节相等（零回归）
 *   ③ GET 同端点 &depth=detailed                                       → 详细报告五章
 *   ④ GET 同端点 &depth=<非法>                                          → 200 + X-Report-Depth-Degraded + 落回一页纸
 *   ⑤ GET 同端点 &format=json&depth=detailed                           → JSON 分支不受 depth 影响
 *   ⑥ POST /api/conversations/:id/messages「讲细一点」                   → SSE report_view depth=detailed
 *   ⑦ 同端点「说人话」                                                   → SSE report_view depth=one_pager
 *   ⑧ 同端点不含深度词                                                   → 无 report_view 帧（零行为变化）
 *   ⑨ GET 未知 id                                                       → 404 NOT_FOUND
 *
 * 方法（与 C 的测试无关的独立路径）：
 *   - 真实 express 路由 + 真实 better-sqlite3 ':memory:' + 真实 HTTP（listen(0) + fetch）
 *   - 固定诊断产物由**本脚本直写** `diagnosis_checkpoints`(phase=5)（不经引擎、不经 C 的 helper）
 *   - LLM 侧用本地 OpenAI 兼容替身（D592 范式），**不 mock 管线**
 *   - 真实 jwtAuthMiddleware 挂载（DEV_MODE=false 无 Authorization）→ 同时证白名单免 token 可达
 *
 * 证据口径：每个 HTTP 响应体记 `bodyBytes + bodySha256`（字节相等/相异可复算，不靠肉眼）；
 *           SSE 步骤额外记 report_view.markdown 的 bytes/sha256。
 *
 * 用法: cd <worktree> && npx tsx docs/synova/product-lines/evidence/D1051/23-reverse-entry-walk.ts [--out <path>]
 */
import express from 'express';
import Database from 'better-sqlite3';
import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

const ROOT = process.cwd();
const ORG_ID = 'org-d1051-v';
const REPORT_ID = 'rpt_d1051_verify_1';
const DETAILED_CHAPTERS = ['### 结论', '### 根因', '### 专家完整推理', '### 行动建议', '### 数据时点'];
/** 固定产物内容锚（证明断言对**内容**敏感，非只看章节骨架） */
const FIXTURE_CONTENT_MARKERS = ['精加工工序产能不足', '补足精加工工序产能（外协或增班）', 'fundamental-efficiency', '2026-09-28T10:00:00.000Z'];
/**
 * N1 负控开关（`D1051V_WRONG_FIXTURE=1`）：把固定产物的字段名故意写错
 * （`rootCauses[].description` → `.title`、`expertReports[].findings` → `.notes`）。
 * 期望：正文出现字面 `undefined` 或内容锚缺席 ⇒ S1/S3 必须**报红**（证明断言的判别力）。
 */
const WRONG_FIXTURE = process.env.D1051V_WRONG_FIXTURE === '1';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

interface StepRecord {
  id: string;
  title: string;
  request: { method: string; url: string; body?: unknown };
  status: number | null;
  responseHeaders: Record<string, string>;
  bodyBytes: number;
  bodySha256: string;
  reportViewMarkdown?: { bytes: number; sha256: string } | null;
  snippet: string;
  assertion: string;
  verdict: 'PASS' | 'FAIL';
  detail?: string;
}

const steps: StepRecord[] = [];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const outPath = argValue('--out') ?? 'docs/synova/product-lines/evidence/D1051/21-verify-entry-reverse.json';

  // ── ① LLM 替身（OpenAI 兼容 /chat/completions）──
  const standIn: Server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const content = '收到，我已记录，请继续介绍团队情况。';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  await new Promise<void>((r) => standIn.listen(0, '127.0.0.1', () => r()));
  const addr = standIn.address();
  if (!addr || typeof addr === 'string') throw new Error('LLM 替身端口获取失败');
  const llmPort = addr.port;

  process.env.DEV_MODE = 'false';
  process.env.SYNOVA_ORG_ID = ORG_ID;
  process.env.LLM_API_KEY = 'd1051-verify-standin';
  process.env.LLM_BASE_URL = `http://127.0.0.1:${llmPort}`;
  process.env.LLM_MODEL = 'd1051-verify-standin-model';
  delete process.env.OPENCLAW_GATEWAY_HOST;

  // ── ② 真实路由 + 真实 SQLite + 真实 jwtAuthMiddleware ──
  const { default: diagnosisRouter } = await import(`${ROOT}/src/routes/diagnosis.ts`);
  const { default: conversationsRouter } = await import(`${ROOT}/src/routes/conversations.ts`);
  const { jwtAuthMiddleware } = await import(`${ROOT}/src/middleware/auth.ts`);
  const { SessionStore } = await import(`${ROOT}/src/store/session-store.ts`);

  const db = new Database(':memory:');
  const store = new SessionStore(db);

  // ── ③ 固定诊断产物（本脚本直写 checkpoint，不经引擎）──
  const fixtureReport = {
    reportId: REPORT_ID,
    teamId: ORG_ID,
    generatedAt: '2026-09-28T10:00:00.000Z',
    summary: '增长卡点在精加工工序产能：订单交付周期长于同行，客户复购承压。',
    expertReports: WRONG_FIXTURE
      ? [{ expert: 'fundamental-efficiency', notes: ['精加工工序产能利用率 96%，为全链瓶颈'], confidence: 0.82 }]
      : [
          { expert: 'fundamental-efficiency', findings: ['精加工工序产能利用率 96%，为全链瓶颈', '外协比例 8%，低于同行 21%'], confidence: 0.82 },
          { expert: 'customer-growth', findings: ['复购率 31%，较上季下降 4pt'], confidence: 0.71 },
        ],
    rootCauses: WRONG_FIXTURE
      ? [{ title: '精加工工序产能不足', dimension: '效率', confidence: 0.77 }]
      : [
          { description: '精加工工序产能不足', dimension: '效率', confidence: 0.77 },
          { description: '客户成功动作缺失（无交付后回访）', dimension: '客户', confidence: 0.63 },
          { description: '关键工序无二供', dimension: '供应链', confidence: 0.55 },
        ],
    recommendations: [
      { action: '补足精加工工序产能（外协或增班）', priority: 'high', expert: 'fundamental-efficiency' },
      { action: '建立交付后 7 日回访 SOP', priority: 'medium', expert: 'customer-growth' },
    ],
    raw: { note: 'D1051 verify fixture (成员 V 自备)' },
  };
  store.saveDiagnosisCheckpoint({
    sessionId: REPORT_ID,
    phase: 5,
    completedModules: [],
    partialReport: {
      reportId: REPORT_ID,
      report: fixtureReport,
      teamId: ORG_ID,
      completedAt: '2026-09-28T10:00:00.000Z',
      source: 'verify-fixture',
    },
    savedAt: '2026-09-28T10:00:00.000Z',
  });

  const app = express();
  app.use(express.json());
  app.locals.orchestration = { db };
  app.use(jwtAuthMiddleware);
  app.use(diagnosisRouter);
  app.use(conversationsRouter);
  app.get('/api/d1051v-probe', (_req, res) => { res.json({ ok: true }); }); // 非白名单对照探针
  const server: Server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const saddr = server.address();
  if (!saddr || typeof saddr === 'string') throw new Error('服务端口获取失败');
  const base = `http://127.0.0.1:${saddr.port}`;

  const rec = (s: StepRecord): void => {
    steps.push(s);
    console.log(`[V-STEP] ${s.verdict} ${s.id} ${s.title} status=${s.status} bytes=${s.bodyBytes} sha=${s.bodySha256.slice(0, 12)}`);
  };

  const get = async (url: string, headers?: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    const hs: Record<string, string> = {};
    res.headers.forEach((v, k) => { hs[k] = v; });
    return { status: res.status, headers: hs, text, sha: sha256(text) };
  };

  const postSse = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    return { status: res.status, text, sha: sha256(text) };
  };

  // ── S0 对照探针（非白名单 → 401，证 jwtAuthMiddleware 真在链上）──
  const probe = await get(`${base}/api/d1051v-probe`);
  rec({
    id: 'S0', title: '对照探针（非白名单，期望 401——证鉴权中间件真挂载）',
    request: { method: 'GET', url: '/api/d1051v-probe' },
    status: probe.status, responseHeaders: probe.headers, bodyBytes: probe.text.length, bodySha256: probe.sha,
    snippet: probe.text.slice(0, 200),
    assertion: 'status === 401', verdict: probe.status === 401 ? 'PASS' : 'FAIL',
    ...(probe.status === 401 ? {} : { detail: `实际 status=${probe.status}` }),
  });

  // ── S1 默认（无 depth）markdown → 一页纸 ──
  const s1 = await get(`${base}/api/diagnosis/consult/${REPORT_ID}/report?format=markdown`);
  const s1Content = ['精加工工序产能不足', '补足精加工工序产能（外协或增班）'].filter(m => !s1.text.includes(m));
  const s1Ok = s1.status === 200 && (s1.headers['content-type'] ?? '').includes('text/markdown')
    && s1.headers['x-report-view-depth'] === 'one_pager'
    && s1Content.length === 0 && !s1.text.includes('undefined');
  rec({
    id: 'S1', title: '默认取报告（markdown，无 depth）→ 应得一页纸（浅）',
    request: { method: 'GET', url: `/api/diagnosis/consult/${REPORT_ID}/report?format=markdown` },
    status: s1.status, responseHeaders: s1.headers, bodyBytes: s1.text.length, bodySha256: s1.sha,
    snippet: s1.text.slice(0, 400),
    assertion: "200 + content-type text/markdown + 头 X-Report-View-Depth=one_pager",
    verdict: s1Ok ? 'PASS' : 'FAIL', ...(s1Ok ? {} : { detail: `ct=${s1.headers['content-type']} depth=${s1.headers['x-report-view-depth']}` }),
  });

  // ── S2 显式 depth=one_pager → 与 S1 字节相等 ──
  const s2 = await get(`${base}/api/diagnosis/consult/${REPORT_ID}/report?format=markdown&depth=one_pager`);
  const s2Ok = s2.status === 200 && s2.text === s1.text;
  rec({
    id: 'S2', title: '显式 depth=one_pager → 与默认产物字节相等（零回归判别夹具）',
    request: { method: 'GET', url: `/api/diagnosis/consult/${REPORT_ID}/report?format=markdown&depth=one_pager` },
    status: s2.status, responseHeaders: s2.headers, bodyBytes: s2.text.length, bodySha256: s2.sha,
    snippet: s2.text.slice(0, 400),
    assertion: '200 且 body === S1.body（字节相等；sha256 相等可复算）',
    verdict: s2Ok ? 'PASS' : 'FAIL',
    ...(s2Ok ? {} : { detail: `bytes S1=${s1.text.length} S2=${s2.text.length}` }),
  });

  // ── S3 显式 depth=detailed → 详细报告五章 ──
  const s3 = await get(`${base}/api/diagnosis/consult/${REPORT_ID}/report?format=markdown&depth=detailed`);
  const missing = DETAILED_CHAPTERS.filter(c => !s3.text.includes(c));
  const missingMarkers = FIXTURE_CONTENT_MARKERS.filter(m => !s3.text.includes(m));
  const s3Ok = s3.status === 200 && s3.headers['x-report-view-depth'] === 'detailed' && missing.length === 0
    && s3.text.includes('诊断详细报告') && s3.text.includes(`📎 报告 ID: ${REPORT_ID}`)
    && missingMarkers.length === 0 && !s3.text.includes('undefined');
  rec({
    id: 'S3', title: '显式 depth=detailed → 详细报告（五章齐备 + 内容锚齐备；sha256 与 S1 相异）',
    request: { method: 'GET', url: `/api/diagnosis/consult/${REPORT_ID}/report?format=markdown&depth=detailed` },
    status: s3.status, responseHeaders: s3.headers, bodyBytes: s3.text.length, bodySha256: s3.sha,
    snippet: s3.text.slice(0, 400),
    assertion: '200 + 头 X-Report-View-Depth=detailed + 五章标题齐备 + 尾行报告 ID + 内容锚齐备 + 无字面 undefined + sha256 ≠ S1.sha256',
    verdict: s3Ok && s3.sha !== s1.sha ? 'PASS' : 'FAIL',
    ...(s3Ok && s3.sha !== s1.sha ? {} : { detail: `depth=${s3.headers['x-report-view-depth']} 缺章=${JSON.stringify(missing)} 缺内容锚=${JSON.stringify(missingMarkers)} shaEqual=${s3.sha === s1.sha}` }),
  });

  // ── S4 非法 depth → 200 + 降级头 + 落回一页纸 ──
  const s4 = await get(`${base}/api/diagnosis/consult/${REPORT_ID}/report?format=markdown&depth=expert`);
  const s4Ok = s4.status === 200 && s4.headers['x-report-depth-degraded'] === 'UNKNOWN_DEPTH'
    && s4.headers['x-report-view-depth'] === 'one_pager' && s4.text === s1.text;
  rec({
    id: 'S4', title: '非法 depth（expert，属装配轴词）→ 显式降级 + 落回一页纸',
    request: { method: 'GET', url: `/api/diagnosis/consult/${REPORT_ID}/report?format=markdown&depth=expert` },
    status: s4.status, responseHeaders: s4.headers, bodyBytes: s4.text.length, bodySha256: s4.sha,
    snippet: s4.text.slice(0, 400),
    assertion: '200 + 头 X-Report-Depth-Degraded=UNKNOWN_DEPTH + 头 X-Report-View-Depth=one_pager + sha256 === S1.sha256',
    verdict: s4Ok ? 'PASS' : 'FAIL',
    ...(s4Ok ? {} : { detail: `degraded=${s4.headers['x-report-depth-degraded']} depth=${s4.headers['x-report-view-depth']} bytes=${s4.text.length}` }),
  });

  // ── S5 JSON 分支不受 depth 影响 ──
  const s5 = await get(`${base}/api/diagnosis/consult/${REPORT_ID}/report?format=json&depth=detailed`);
  let s5Json: { ok?: boolean; report?: { reportId?: string } } = {};
  try { s5Json = JSON.parse(s5.text) as typeof s5Json; } catch { s5Json = {}; }
  const s5Ok = s5.status === 200 && s5.headers['x-report-view-depth'] === undefined
    && s5.headers['x-report-depth-degraded'] === undefined && s5Json.report?.reportId === REPORT_ID;
  rec({
    id: 'S5', title: 'JSON 分支：?format=json&depth=detailed → 不加深度头、不新增字段（现状不变）',
    request: { method: 'GET', url: `/api/diagnosis/consult/${REPORT_ID}/report?format=json&depth=detailed` },
    status: s5.status, responseHeaders: s5.headers, bodyBytes: s5.text.length, bodySha256: s5.sha,
    snippet: s5.text.slice(0, 400),
    assertion: '200 + 无 X-Report-View-Depth/X-Report-Depth-Degraded 头 + report.reportId === fixture id',
    verdict: s5Ok ? 'PASS' : 'FAIL',
    ...(s5Ok ? {} : { detail: `viewDepth=${s5.headers['x-report-view-depth']} reportId=${String(s5Json.report?.reportId)}` }),
  });

  // ── S6/S7/S8 对话调深度（真实 SSE）──
  const parseFrames = (text: string): Array<{ event: string; data: Record<string, unknown> }> =>
    text.split('\n\n').filter(b => b.includes('data: ')).map(b => {
      const lines = b.split('\n');
      const event = (lines.find(l => l.startsWith('event: ')) ?? '').replace('event: ', '').trim();
      const dataLine = lines.find(l => l.startsWith('data: ')) ?? '';
      return { event, data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown> };
    });

  const t1 = await postSse(`${base}/api/conversations`, { message: '我们是 50 人的制造企业', orgId: ORG_ID });
  const f1 = parseFrames(t1.text);
  const openFrame = f1.find(f => f.data.type === 'open');
  const sessionId = typeof openFrame?.data.sessionId === 'string' ? openFrame.data.sessionId : '';
  rec({
    id: 'S6a', title: '对话第 1 轮建会话（open 帧取 sessionId）',
    request: { method: 'POST', url: '/api/conversations', body: { message: '我们是 50 人的制造企业', orgId: ORG_ID } },
    status: t1.status, responseHeaders: {}, bodyBytes: t1.text.length, bodySha256: t1.sha,
    snippet: t1.text.slice(0, 300),
    assertion: '200 + open 帧含 sessionId', verdict: t1.status === 200 && sessionId !== '' ? 'PASS' : 'FAIL',
    ...(sessionId === '' ? { detail: '未取到 sessionId' } : {}),
  });

  const t2 = await postSse(`${base}/api/conversations/${sessionId}/messages`, { message: '团队分生产/销售/研发三块' });
  rec({
    id: 'S6b', title: '对话第 2 轮（无深度词——零行为变化对照）',
    request: { method: 'POST', url: `/api/conversations/${sessionId}/messages`, body: { message: '团队分生产/销售/研发三块' } },
    status: t2.status, responseHeaders: {}, bodyBytes: t2.text.length, bodySha256: t2.sha,
    snippet: t2.text.slice(0, 200),
    assertion: '200 + 末帧 end + 无 report_view 帧',
    verdict: t2.status === 200 && !t2.text.includes('report_view') ? 'PASS' : 'FAIL',
    ...(t2.text.includes('report_view') ? { detail: '未命中深度词却出现 report_view 帧' } : {}),
  });

  const t3 = await postSse(`${base}/api/conversations/${sessionId}/messages`, { message: '讲细一点' });
  const f3 = parseFrames(t3.text);
  const rv3 = f3.find(f => f.data.type === 'report_view')?.data as
    | { depth?: string; markdown?: string | null; reportId?: string | null; degraded?: boolean }
    | undefined;
  const md3 = typeof rv3?.markdown === 'string' ? rv3.markdown : '';
  const t3Ok = t3.status === 200 && rv3?.depth === 'detailed'
    && DETAILED_CHAPTERS.every(c => md3.includes(c))
    && f3[f3.length - 1]?.data.type === 'end' && !f3.some(f => f.data.type === 'error');
  rec({
    id: 'S6', title: '对话「讲细一点」→ SSE report_view 帧 depth=detailed（详版章节）',
    request: { method: 'POST', url: `/api/conversations/${sessionId}/messages`, body: { message: '讲细一点' } },
    status: t3.status, responseHeaders: {}, bodyBytes: t3.text.length, bodySha256: t3.sha,
    reportViewMarkdown: { bytes: md3.length, sha256: sha256(md3) },
    snippet: `frames=${JSON.stringify(f3.map(f => f.data.type))} report_view=${JSON.stringify({ depth: rv3?.depth, reportId: rv3?.reportId, degraded: rv3?.degraded, bytes: md3.length }).slice(0, 300)}`,
    assertion: '200 + report_view.depth=detailed + markdown 含五章 + 末帧 end + 无 error 帧',
    verdict: t3Ok ? 'PASS' : 'FAIL',
    ...(t3Ok ? {} : { detail: `depth=${String(rv3?.depth)} 末帧=${String(f3[f3.length - 1]?.data.type)} 有error=${f3.some(f => f.data.type === 'error')}` }),
  });

  const t4 = await postSse(`${base}/api/conversations/${sessionId}/messages`, { message: '说人话' });
  const f4 = parseFrames(t4.text);
  const rv4 = f4.find(f => f.data.type === 'report_view')?.data as { depth?: string; markdown?: string | null } | undefined;
  const md4 = typeof rv4?.markdown === 'string' ? rv4.markdown : '';
  const t4Ok = t4.status === 200 && rv4?.depth === 'one_pager' && md4.length > 0
    && md4 !== md3 && f4[f4.length - 1]?.data.type === 'end' && !f4.some(f => f.data.type === 'error');
  rec({
    id: 'S7', title: '对话「说人话」→ SSE report_view 帧 depth=one_pager（回一页纸）',
    request: { method: 'POST', url: `/api/conversations/${sessionId}/messages`, body: { message: '说人话' } },
    status: t4.status, responseHeaders: {}, bodyBytes: t4.text.length, bodySha256: t4.sha,
    reportViewMarkdown: { bytes: md4.length, sha256: sha256(md4) },
    snippet: `frames=${JSON.stringify(f4.map(f => f.data.type))} report_view=${JSON.stringify({ depth: rv4?.depth, bytes: md4.length }).slice(0, 200)}`,
    assertion: '200 + report_view.depth=one_pager + markdown 非空且 ≠ 详版 + 末帧 end + 无 error 帧',
    verdict: t4Ok ? 'PASS' : 'FAIL',
    ...(t4Ok ? {} : { detail: `depth=${String(rv4?.depth)} bytes=${md4.length}` }),
  });

  const t5 = await postSse(`${base}/api/conversations/${sessionId}/messages`, { message: '今天先聊到这里' });
  const f5 = parseFrames(t5.text);
  const t5Ok = t5.status === 200 && !f5.some(f => f.data.type === 'report_view') && f5[f5.length - 1]?.data.type === 'end';
  rec({
    id: 'S8', title: '对话不含深度词 → 无 report_view 帧（零行为变化判别夹具）',
    request: { method: 'POST', url: `/api/conversations/${sessionId}/messages`, body: { message: '今天先聊到这里' } },
    status: t5.status, responseHeaders: {}, bodyBytes: t5.text.length, bodySha256: t5.sha,
    snippet: `frames=${JSON.stringify(f5.map(f => f.data.type))}`,
    assertion: '200 + 帧序列无 report_view + 末帧 end',
    verdict: t5Ok ? 'PASS' : 'FAIL',
  });

  // ── S9 未知 id → 404 ──
  const s9 = await get(`${base}/api/diagnosis/consult/ghost-d1051/report?format=markdown`);
  rec({
    id: 'S9', title: '未知 reportId → 404 NOT_FOUND（诚实语义不变）',
    request: { method: 'GET', url: '/api/diagnosis/consult/ghost-d1051/report?format=markdown' },
    status: s9.status, responseHeaders: s9.headers, bodyBytes: s9.text.length, bodySha256: s9.sha,
    snippet: s9.text.slice(0, 200),
    assertion: '404 + code NOT_FOUND', verdict: s9.status === 404 ? 'PASS' : 'FAIL',
  });

  server.close();
  standIn.close();

  const failed = steps.filter(s => s.verdict === 'FAIL');
  const payload = {
    artifact: 'D1051 反向走入口（独立复核，成员 V）',
    method: '真实 express 路由 + 真实 better-sqlite3 :memory: + 真实 HTTP(listen(0)+fetch) + 本地 OpenAI 兼容 LLM 替身；固定诊断产物由本脚本直写 diagnosis_checkpoints(phase=5)，不经引擎、不经编码成员 helper',
    generatedAt: new Date().toISOString(),
    head: String(process.env.D1051_HEAD ?? ''),
    node: process.version,
    orgId: ORG_ID,
    fixtureReportId: REPORT_ID,
    fixtureMode: WRONG_FIXTURE ? 'N1 负控：字段名故意写错（description→title / findings→notes）' : 'canonical（与 DiagnosisReport 契约同形）',
    shaCrossCheck: {
      note: '一页纸三态（S1 默认 / S2 显式 / S4 非法回退）应同 sha256；详版 S3 应与之相异',
      s1_body: s1.sha, s2_body: s2.sha, s3_body: s3.sha, s4_body: s4.sha,
      onePagerConsistent: s1.sha === s2.sha && s2.sha === s4.sha,
      detailedDiffers: s3.sha !== s1.sha,
    },
    totals: { steps: steps.length, pass: steps.length - failed.length, fail: failed.length },
    steps,
  };
  fs.mkdirSync(outPath.split('/').slice(0, -1).join('/'), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[V-SUMMARY] steps=${steps.length} pass=${steps.length - failed.length} fail=${failed.length}`);
  console.log(`[V-OUT] ${outPath}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[V-FATAL]', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
