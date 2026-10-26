/**
 * tests/acceptance/mvp1-m4-output-face.test.ts — #656（批 3 / M4）出口面验收
 *
 * 一条验收件串起 M4 三判据（规格 §4.1，逐字自 MVP v1.1 §三 M4）：
 *   ① 界面真调 API 渲染「测量值＋趋势」（T1 真 fetch → 真 express → 真文件库；T2 纯组件渲染）
 *   ② 一页纸接回（`data-testid="measurement-to-onepager"` 在场 ＋ RightPanel 回调 `setTab('report')` 源码断言）
 *   ③ 反例：摘掉 API（无效 base／HTTP 500／形状非法／服务端 degraded）⇒ 界面必红（T1 反例＋T2 真数据用例同红）
 *
 * 拆两层的原因（规格 §3.2a）：render 桥（test-support/render.ts）只服务纯函数组件树、不执行 hook，
 * 故「真 fetch」归 loader（lib/measurement-trends.ts，本件经真 express 验）、「渲染」归纯展示组件
 * （components/MeasurementTrendSection.tsx，本件经 render 桥验）、「接线」归源码断言（T3，不 import RightPanel
 * ——它拉入 react-markdown/zustand，root 依赖集不含）。容器（MeasurementTrendContainer.tsx）含 useEffect，
 * 由 T3 源码断言证「调 loader」；render 桥不执行 hook，故不在本件直接渲染。
 *
 * 契约（铁律 47；规格 §4.3）:
 *   @input   临时 DB（mkdtemp，经 SYNOVA_DB_PATH 指向；禁碰 data/synova.db）＋ 合成本地 express（listen 0）
 *            ＋ base 注入（loadMeasurementTrends(base)）＋ 纯组件 props（view/state/onOpenOnePager）
 *   @output  标签化输出 [BOOT]/[T1]/[T1-NEG]/[T2]/[T3]/[PASS]；真实断言点见各 it 标题
 *   @exit    vitest 语义：0=通过 ｜ 任一 expect 红=真红（1）｜ 环境/检查自身失败 ⇒ throw Error('[M4][ENV] …')（=2 语义）
 *   @degraded 测试自身不降级：环境不满足 ⇒ throw，不 skip（禁把"看不见"当"没问题"）
 *   @not-here 不改 src/**（只读复用 routes/sentinel.ts 与 writer/reader）；不改 M4-A 三文件；不建第二套 loader；
 *             不 mock 被测系统（无 vi.mock／mockFetch）；不经 render 桥证明 Electron/浏览器像素或交互视觉
 *
 * 已知限制:
 *   · render 桥（renderToStaticMarkup 零依赖等价实现）只证「渲染树含什么」，不证像素级/交互视觉/E2E；
 *     事件处理器不被桥执行 ⇒ 一页纸「点击可传出」由「元素在场」＋ T3 源码断言（onClick={onOpenOnePager}）共同证明。
 *   · app/**（Web UI）本批未动（规格 §2.1/§7.2：桌面端 = 同一界面，裁 149 裁4）；同源 Web 入口不在本件范围。
 *   · 容器 useEffect 取数路径不在 render 桥能力内 ⇒ 只证源码接线（T3），运行期取数由 loader（T1）覆盖。
 *   · CI `--changed` 可能跳过新 acceptance 件（裁 223）⇒ 以本地原始输出 + PR 为准。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { metricReadingsMigration } from '../../src/store/migrations/002-metric-readings';
import sentinelRoutes from '../../src/routes/sentinel';
import { loadMeasurementTrends, deriveTrendDirection } from '../../electron-renderer/src/lib/measurement-trends';
import type { MeasurementTrendsView } from '../../electron-renderer/src/lib/measurement-trends';
import { MeasurementTrendSection } from '../../electron-renderer/src/components/MeasurementTrendSection';
import type { MeasurementTrendState } from '../../electron-renderer/src/components/MeasurementTrendSection';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';

// ── [BOOT] 环境隔离：临时文件库（真落盘路径，非 :memory:）＋ JWT_SECRET；禁碰 data/synova.db ──
const dbDir = mkdtempSync(join(tmpdir(), 'synova-m4-'));
process.env.SYNOVA_DB_PATH = join(dbDir, 'synova.db');
process.env.JWT_SECRET = 'm4-acceptance-secret-0123456789abcdef';
process.env.DEV_MODE = 'false';

const repoRoot = resolve(__dirname, '../..');
if (!readFileSync(join(repoRoot, 'package.json'), 'utf-8').includes('"name"')) {
  throw new Error('[M4][ENV] 仓库根定位失败（package.json 不可读）—— 环境不满足，禁跳过');
}

/** 唯一锚点（防历史行冒充）：org/metric id 带 pid + 时间戳 */
const ANCHOR = `m4-org-${process.pid}-${Date.now()}`;
const METRIC_UP = `M4-REV-${ANCHOR}`;
const METRIC_DOWN = `M4-CASH-${ANCHOR}`;

/** SQLite datetime('now') 同构格式（UTC，'YYYY-MM-DD HH:MM:SS'），保证 7 天窗口内且字符串可排序 */
function sqliteAt(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
}
const T_PREV = sqliteAt(2 * 24 * 60 * 60 * 1000); // 2 天前
const T_LATEST = sqliteAt(60 * 1000);             // 1 分钟前（最新）

let db: Database.Database;
let base = '';
let mainServer: Server | undefined;
let badBase = '';
let badServer: Server | undefined;
/** T1 真调结果 → T2「真数据渲染」用例复用（摘 API ⇒ 两个用例同红，规格 §4.2 反例①） */
let realView: MeasurementTrendsView | null = null;

function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = app.listen(0);
  return new Promise((res, rej) => {
    server.once('listening', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { rej(new Error('[M4][ENV] express 未取到端口')); return; }
      res({ server, base: `http://127.0.0.1:${addr.port}` });
    });
    server.once('error', rej);
  });
}

beforeAll(async () => {
  db = new Database(process.env.SYNOVA_DB_PATH as string); // 真文件库
  metricReadingsMigration.up(db);                          // 建真表（metric_readings 17 列）

  // ── 真写入：≥2 指标 × 2 次观测（changeRatio 可算、方向可判）；经唯一写入口 createMetricSink ──
  const sink = createMetricSink(db);
  const rows = [
    { metricId: METRIC_UP, value: 100, unit: 'ratio', observedAt: T_PREV },
    { metricId: METRIC_UP, value: 125, unit: 'ratio', observedAt: T_LATEST },
    { metricId: METRIC_DOWN, value: 80, unit: '月', observedAt: T_PREV },
    { metricId: METRIC_DOWN, value: 60, unit: '月', observedAt: T_LATEST },
  ] as const;
  for (const row of rows) {
    const wrote = sink({ orgId: ANCHOR, sourceType: 'compute', sourceId: 'M4-ACCEPTANCE', ...row });
    if (!wrote.written) throw new Error(`[M4][ENV] 测量值写入失败（${row.metricId}@${row.observedAt}）`);
  }

  // ── 真 express（只读复用真路由；不改 src）──
  const app = express();
  app.use(express.json());
  (app.locals as { orchestration?: unknown }).orchestration = { db };
  app.use('/api/sentinel', sentinelRoutes);
  const main = await listen(app);
  mainServer = main.server;
  base = main.base;

  // ── 反例服务器：同一 app 的四个挂载点（HTTP 500／形状非法／坏 JSON／服务端 ok:false 透传）──
  const badApp = express();
  badApp.use('/s500', (_req, res) => { res.status(500).json({ ok: false, code: 'M4_PROBE_500' }); });
  badApp.use('/sbad', (_req, res) => {
    res.json({ ok: true, count: 1, summary: [{ metricId: 'M4-BAD-SHAPE' }] }); // 项缺 entityId/count/latestAt/… ⇒ 形状非法
  });
  badApp.use('/sjunk', (_req, res) => { res.type('application/json').send('{not json'); });
  badApp.use('/sokfalse', (_req, res) => {
    res.json({ ok: false, degraded: true, summary: [], errors: ['SERVER_DEGRADED'] }); // 服务端 degraded 透传
  });
  const bad = await listen(badApp);
  badServer = bad.server;
  badBase = bad.base;

  console.log(`[BOOT] db=${process.env.SYNOVA_DB_PATH} anchor=${ANCHOR} base=${base} badBase=${badBase}`);
});

afterAll(() => {
  mainServer?.close();
  badServer?.close();
  db?.close();
  rmSync(dbDir, { recursive: true, force: true });
});

/** 取一个「已关闭端口」的 base（连接必然被拒 ⇒ loader 走网络异常降级） */
async function closedPortBase(): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  await new Promise<void>((r) => server.close(() => r()));
  if (port === 0) throw new Error('[M4][ENV] 关闭端口探针未取到端口');
  return `http://127.0.0.1:${port}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// T1 · 真调 API（真 express ＋ 真文件库 ＋ 真 fetch）
// ═════════════════════════════════════════════════════════════════════════════

describe('#656 M4 · T1 真调 API（GET /api/sentinel/metrics/readings?view=trends）', () => {
  it('T1 正例 [BOOT]：真 express 路由返回本次锚点的趋势（latestValue/previousValue/changeRatio/unit/count 数值正确）', async () => {
    // 独立证据①：原始 HTTP 直取（不经 loader）
    const raw = await fetch(`${base}/api/sentinel/metrics/readings?view=trends`);
    expect(raw.status).toBe(200);
    const rawJson = (await raw.json()) as { ok: boolean; count: number; summary: unknown[] };
    console.log(`[T1] raw ok=${rawJson.ok} count=${rawJson.count}`);
    expect(rawJson.ok).toBe(true);

    // 独立证据②：被测 loader（真 fetch 打到上面的真 express）
    const view = await loadMeasurementTrends(base);
    realView = view; // 供 T2「真数据渲染」用例（摘 API ⇒ 两处同红）
    console.log(`[T1] loader ok=${view.ok} degraded=${view.degraded} summary=${view.summary.length} errors=${(view.errors ?? []).join('|')}`);
    expect(view.ok).toBe(true);
    expect(view.degraded).toBe(false);
    expect(view.errors ?? []).toEqual([]);

    const up = view.summary.find((s) => s.metricId === METRIC_UP);
    const down = view.summary.find((s) => s.metricId === METRIC_DOWN);
    expect(up, `trends 应含锚点指标 ${METRIC_UP}`).toBeDefined();
    expect(down, `trends 应含锚点指标 ${METRIC_DOWN}`).toBeDefined();

    // 期望值手算（见 seed）：up 100 → 125 ⇒ +25%；down 80 → 60 ⇒ -25%
    expect(up?.entityId).toBe('*');
    expect(up?.count).toBe(2);
    expect(up?.latestValue).toBe(125);
    expect(up?.previousValue).toBe(100);
    expect(up?.changeRatio).toBeCloseTo(0.25, 9);
    expect(up?.unit).toBe('ratio');
    expect(up?.latestAt).toBe(T_LATEST);

    expect(down?.latestValue).toBe(60);
    expect(down?.previousValue).toBe(80);
    expect(down?.changeRatio).toBeCloseTo(-0.25, 9);
    expect(down?.unit).toBe('月');

    // 方向推导与值一致（变异「恒 flat」⇒ 必红）
    expect(deriveTrendDirection(up?.changeRatio ?? null)).toBe('up');
    expect(deriveTrendDirection(down?.changeRatio ?? null)).toBe('down');
  });

  it('T1 反例 [T1-NEG]：无效 base（连接被拒／HTTP 500／形状非法／坏 JSON／服务端 degraded）⇒ 显式降级且不抛', async () => {
    // ① 网络异常：指向已关闭端口（断路由）
    const dead = await loadMeasurementTrends(await closedPortBase());
    console.log(`[T1-NEG] dead ok=${dead.ok} degraded=${dead.degraded} summary=${dead.summary.length} errors=${(dead.errors ?? []).join('|')}`);
    expect(dead.ok).toBe(false);
    expect(dead.degraded).toBe(true);
    expect(dead.summary).toEqual([]);
    expect((dead.errors ?? []).length).toBeGreaterThan(0);

    // ② HTTP 500
    const e500 = await loadMeasurementTrends(`${badBase}/s500`);
    console.log(`[T1-NEG] http500 ok=${e500.ok} degraded=${e500.degraded} errors=${(e500.errors ?? []).join('|')}`);
    expect(e500.ok).toBe(false);
    expect(e500.degraded).toBe(true);
    expect(e500.summary).toEqual([]);
    expect((e500.errors ?? []).length).toBeGreaterThan(0);

    // ③ 响应形状非法（summary 项缺字段）
    const badShape = await loadMeasurementTrends(`${badBase}/sbad`);
    console.log(`[T1-NEG] badShape ok=${badShape.ok} degraded=${badShape.degraded} errors=${(badShape.errors ?? []).join('|')}`);
    expect(badShape.ok).toBe(false);
    expect(badShape.degraded).toBe(true);
    expect(badShape.summary).toEqual([]);

    // ④ 坏 JSON（res.json() 抛错 ⇒ catch ⇒ 降级）
    const junk = await loadMeasurementTrends(`${badBase}/sjunk`);
    console.log(`[T1-NEG] junk ok=${junk.ok} degraded=${junk.degraded} errors=${(junk.errors ?? []).join('|')}`);
    expect(junk.ok).toBe(false);
    expect(junk.degraded).toBe(true);
    expect(junk.summary).toEqual([]);

    // ⑤ 服务端 200 + ok:false/degraded ⇒ 原样透传（不把"服务端降级"伪装成空数据）
    const serverDegraded = await loadMeasurementTrends(`${badBase}/sokfalse`);
    console.log(`[T1-NEG] serverDegraded ok=${serverDegraded.ok} degraded=${serverDegraded.degraded} errors=${(serverDegraded.errors ?? []).join('|')}`);
    expect(serverDegraded.ok).toBe(false);
    expect(serverDegraded.degraded).toBe(true);
    expect(serverDegraded.summary).toEqual([]);
    expect(serverDegraded.errors).toContain('SERVER_DEGRADED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T2 · 渲染「测量值＋趋势」（render 桥 + 纯展示组件）
// ═════════════════════════════════════════════════════════════════════════════

function renderSection(
  view: MeasurementTrendsView | null,
  state: MeasurementTrendState,
  onOpenOnePager?: () => void,
): string {
  return renderToStaticMarkup(MeasurementTrendSection({ view, state, onOpenOnePager }));
}

/** 三指标样本：up(+25%) / down(-25%) / flat(0)，覆盖方向三分支 */
const READY_VIEW: MeasurementTrendsView = {
  ok: true,
  degraded: false,
  summary: [
    {
      metricId: 'M4-REV-PROBE', entityId: '*', unit: 'ratio', count: 2,
      latestAt: '2026-10-20 09:00:00', latestValue: 125, previousValue: 100, changeRatio: 0.25,
    },
    {
      metricId: 'M4-CASH-PROBE', entityId: '*', unit: '月', count: 2,
      latestAt: '2026-10-20 08:00:00', latestValue: 60, previousValue: 80, changeRatio: -0.25,
    },
    {
      metricId: 'M4-FLAT-PROBE', entityId: '*', unit: null, count: 2,
      latestAt: '2026-10-20 07:00:00', latestValue: 42, previousValue: 42, changeRatio: 0,
    },
  ],
};

describe('#656 M4 · T2 渲染「测量值＋趋势」（纯组件 + render 桥）', () => {
  it('T2 ready：标题/根元素/每指标一条/值/单位/方向符号+data-trend/latestAt/一页纸入口全在场', () => {
    const out = renderSection(READY_VIEW, 'ready', () => {});
    console.log(`[T2] ready length=${out.length}`);
    expect(out).toContain('测量值＋趋势');
    expect(out).toContain('data-testid="measurement-trend-section"');
    expect((out.match(/data-testid="measurement-trend-item"/g) ?? []).length).toBe(3);

    // 指标标识与值/单位透传
    expect(out).toContain('M4-REV-PROBE');
    expect(out).toContain('125');
    expect(out).toContain('ratio');
    expect(out).toContain('月');
    expect(out).toContain('2026-10-20'); // latestAt（组件可格式化，但日期段必在）

    // 方向：>0 ↑ up ｜ <0 ↓ down ｜ =0 → flat（变异「恒 flat」⇒ 本段必红）
    expect(out).toContain('data-trend="up"');
    expect(out).toContain('data-trend="down"');
    expect(out).toContain('data-trend="flat"');
    expect(out).toContain('↑');
    expect(out).toContain('↓');
    expect(out).toContain('→');

    // 一页纸接回入口（稳定选择器；摘掉 ⇒ 本用例必红）
    expect(out).toContain('data-testid="measurement-to-onepager"');
  });

  it('T2 真数据：[BOOT] T1 的真 API 结果经纯组件渲染（摘 fetch/改错 URL ⇒ 本用例与 T1 同红）', () => {
    expect(realView, 'T1 真调结果缺席（loader 未取到真数据）').not.toBeNull();
    const view = realView as MeasurementTrendsView;
    const out = renderSection(view, 'ready', () => {});
    expect(out).toContain('测量值＋趋势');
    expect(out).toContain(METRIC_UP);
    expect(out).toContain(METRIC_DOWN);
    expect(out).toContain('125'); // 真库里 up 指标的最新值
    expect(out).toContain('60');  // 真库里 down 指标的最新值
    expect((out.match(/data-testid="measurement-trend-item"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('data-testid="measurement-to-onepager"');
  });

  it('T2 empty：空态是合法业务态——空态标记在场、零指标条目、零编造值', () => {
    const out = renderSection({ ok: true, degraded: false, summary: [] }, 'empty', () => {});
    console.log(`[T2] empty length=${out.length}`);
    expect(out).toContain('测量值＋趋势');
    expect(out).toContain('data-testid="measurement-trend-empty"');
    expect(out).not.toContain('data-testid="measurement-trend-item"');
    expect(out).not.toContain('↑');
    expect(out).not.toContain('↓');
    expect(out).toContain('data-testid="measurement-to-onepager"');
  });

  it('T2 degraded：降级条 + errors 文案在场（不白屏、不假装空）', () => {
    const out = renderSection(
      { ok: false, degraded: true, summary: [], errors: ['M4_DEGRADED_PROBE: 读回服务不可用'] },
      'degraded',
      () => {},
    );
    console.log(`[T2] degraded length=${out.length}`);
    expect(out).toContain('测量值＋趋势');
    expect(out).toContain('data-testid="measurement-trend-degraded"');
    expect(out).toContain('M4_DEGRADED_PROBE');
    expect(out).not.toContain('data-testid="measurement-trend-item"');
    expect(out).toContain('data-testid="measurement-to-onepager"');
  });

  it('T2 loading：加载态标记在场；无回调不渲按钮（无死按钮）', () => {
    const out = renderSection(null, 'loading');
    console.log(`[T2] loading length=${out.length}`);
    expect(out).toContain('测量值＋趋势');
    expect(out).toContain('data-testid="measurement-trend-loading"');
    expect(out).not.toContain('data-testid="measurement-to-onepager"');
    expect(() => renderSection(null, 'loading')).not.toThrow();
    expect(() => renderSection(READY_VIEW, 'ready')).not.toThrow();
  });

  it('T2 边界：changeRatio null⇒unknown／0⇒flat／正⇒up／负⇒down；latestValue null⇒未知；unit null 不显示单位', () => {
    // 纯函数边界（方向推导唯一真源）
    expect(deriveTrendDirection(0.25)).toBe('up');
    expect(deriveTrendDirection(-0.25)).toBe('down');
    expect(deriveTrendDirection(0)).toBe('flat');
    expect(deriveTrendDirection(null)).toBe('unknown');

    // 渲染边界：latestValue/previousValue/changeRatio 全 null + unit null
    const nullView: MeasurementTrendsView = {
      ok: true,
      degraded: false,
      summary: [{
        metricId: 'M4-NULL-PROBE', entityId: '*', unit: null, count: 1,
        latestAt: '2026-10-20 06:00:00', latestValue: null, previousValue: null, changeRatio: null,
      }],
    };
    const out = renderSection(nullView, 'ready', () => {});
    console.log(`[T2] boundary length=${out.length}`);
    expect(out).toContain('M4-NULL-PROBE');
    expect(out).toContain('data-trend="unknown"');
    expect(out).toContain('未知'); // 算不出 ⇒ 显式未知（禁编 0/假方向）
    expect(out).not.toContain('null'); // unit null ⇒ 不显示单位（也不得回显 null 字样）
    expect(out).not.toContain('↑');
    expect(out).not.toContain('↓');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// T3 · wiring 源码断言（不 import RightPanel —— 它拉入 react-markdown/zustand，root 依赖集不含）
// ═════════════════════════════════════════════════════════════════════════════

function readSource(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf-8');
}

describe('#656 M4 · T3 wiring（RightPanel 挂载＋一页纸回调＋容器调 loader）', () => {
  it('T3 RightPanel：真 import MeasurementTrendContainer ＋ GAWorkspaceTabs 内挂载 ＋ onOpenOnePager={() => setTab(\'report\')}', () => {
    const src = readSource('electron-renderer/src/components/RightPanel.tsx');
    // 真 import（非代理桥接）
    expect(src).toMatch(/import\s*\{[^}]*\bMeasurementTrendContainer\b[^}]*\}\s*from\s*'\.\/MeasurementTrendContainer'/);
    // 挂载点唯一且在 GAWorkspaceTabs 内、tabs 条之前（保证任何 tab 都可见）
    const tabsFn = src.indexOf('const GAWorkspaceTabs');
    const mount = src.indexOf('<MeasurementTrendContainer');
    const tabBar = src.indexOf('right-panel-tabs');
    console.log(`[T3] rightpanel tabsFn=${tabsFn} mount=${mount} tabBar=${tabBar}`);
    expect(tabsFn).toBeGreaterThanOrEqual(0);
    expect(mount).toBeGreaterThan(tabsFn);
    expect(mount).toBeLessThan(tabBar); // 在 tabs 条之前
    // 一页纸接回：挂载处回调指向既有 report tab（改成 setTab('action')/摘掉 ⇒ 本用例必红）
    const mountTag = src.slice(mount, mount + 200);
    expect(mountTag).toContain('onOpenOnePager');
    expect(mountTag).toContain("setTab('report')");
    // 不新增 tab、不重建一页纸：既有 tab 联合与 DiagnosisReportTab 原样
    expect(src).toContain("useState<'action' | 'sentinel' | 'pattern' | 'report'>('report')");
    expect(src).toContain('<DiagnosisReportTab />');
  });

  it('T3 容器与纯组件：容器调 loadMeasurementTrends（useEffect）＋ 纯组件持一页纸入口与回调', () => {
    const container = readSource('electron-renderer/src/components/MeasurementTrendContainer.tsx');
    expect(container).toContain('loadMeasurementTrends(');
    expect(container).toContain('useEffect(');
    expect(container).toContain('<MeasurementTrendSection');

    const section = readSource('electron-renderer/src/components/MeasurementTrendSection.tsx');
    expect(section).toContain('data-testid="measurement-to-onepager"');
    expect(section).toContain('onClick={onOpenOnePager}');
    expect(section).toContain('测量值＋趋势');
  });

  it('T3 loader：真 URL（view=trends）＋ getApiBase 复用 ＋ 降级留痕（console.warn）', () => {
    const lib = readSource('electron-renderer/src/lib/measurement-trends.ts');
    expect(lib).toContain('view=trends');
    expect(lib).toContain('/api/sentinel/metrics/readings');
    expect(lib).toContain('getApiBase');
    expect(lib).toContain('console.warn'); // 铁律 11/31：降级须留痕
    // 反例①的抓手：URL 被摘/改错 ⇒ T1 真调必红（此处只证"源码里有真 URL"）
    expect(lib).not.toMatch(/\bas\s+any\b|\bas\s+never\b|\bas\s+unknown\s+as\b/);
  });
});

describe('#656 M4 · 反例可红性自证（每条断言都有对应摘除点）', () => {
  it('断言非恒真：关键否定断言在同组内互斥（有值 vs 空态/降级），摘 API/摘入口会改变输出', () => {
    const ready = renderSection(READY_VIEW, 'ready', () => {});
    const empty = renderSection({ ok: true, degraded: false, summary: [] }, 'empty', () => {});
    const degraded = renderSection({ ok: false, degraded: true, summary: [], errors: ['X'] }, 'degraded', () => {});
    // 同一组件的三种 state 输出互不相同 ⇒ 状态分支真生效（恒真断言会三者相等）
    expect(ready).not.toBe(empty);
    expect(ready).not.toBe(degraded);
    expect(empty).not.toBe(degraded);
    expect(ready).toContain('data-testid="measurement-trend-item"');
    expect(empty).not.toContain('data-testid="measurement-trend-item"');
    // 三个状态都有入口 ⇒ 摘掉入口标记会同时使三处断言红（非只红一处）
    for (const out of [ready, empty, degraded]) {
      expect(out).toContain('data-testid="measurement-to-onepager"');
    }
    console.log('[PASS] M4 出口面：真调 API／渲染「测量值＋趋势」／一页纸接回／反例可红性 自证完成');
  });
});
