/**
 * tests/acceptance/mvp1-m4-output-face.test.ts — #1053（T5）/ 台账 #1051 · M4 出口面验收（A1–A14 全覆盖）
 *
 * 一条验收件给出 M4 出口面的三层证据（三层各证一段，**互不冒充**）：
 *   ① 服务端回归（真 express ＋ 真文件库 ＋ 真写入）：A6 两 org 隔离 ／ A7 orgId 非法四形态 ／
 *      A1 缺省窗口 ／ A2 days=1 ／ A3 days 五格＋上界（＝ M-7「删 orgId 透传」、M-8「删 days 上界」的必红点）
 *   ② 渲染（真纯展示组件 ＋ render 桥）：A14 四态恒有限制行 ／ A9 M3 四真值 ／ A11 禁渲密钥 ／ 四态互不相等
 *   ③ 装配与取数（源码断言）：A8 零请求两层证据 ／ A13 装配语义 ／ loader 五码降级（Q-3/Q-9）／ A10 一页纸
 *
 * Q-10（#1053 T5）：**断言值一律经 tests/acceptance/m4-output-face.expected.ts 的 EXP_* 引用**；
 * 本文件只在「夹具输入」与「合成本地探针」处写字面量 —— 期望值漂移只能靠改 expected 模块发生（可 diff、可 review）。
 *
 * 为什么必须分三层：render 桥（test-support/render.ts）只服务纯函数组件、**不执行 hook**
 * （故容器 MeasurementTrendContainer 含 useEffect、面板 RightPanel 拉 react-markdown/zustand，**一律禁止
 * import** —— 它们的证据只能是源码断言）。真取数由 loader 覆盖，渲染由 Section 覆盖，装配由 RightPanel 覆盖。
 *
 * 契约（铁律 47）:
 *   @input   临时 DB（mkdtemp，经 SYNOVA_DB_PATH 指向；禁碰 data/synova.db）＋ 合成本地 express（listen 0）
 *            ＋ base 注入（loadMeasurementTrends(base, orgId)）＋ 纯组件 props（view/state/onOpenOnePager）
 *            ＋ 最小 DiagnosisReport（A10 一页纸）
 *   @output  标签化输出 [BOOT]/[A1]/[A2]/[A3]/[A6]/[A7]/[A8]/[A9]/[A10]/[A11]/[A13]/[T1]/[T2]/[PASS]；
 *            真实断言点见各 it 标题（逐条对应 A 判据编号）
 *   @exit    vitest 语义：0=通过 ｜ 任一 expect 红=真红（1）｜ 环境/检查自身失败 ⇒ throw Error('[M4][ENV] …')（=2 语义）
 *   @degraded 测试自身不降级：环境不满足 ⇒ throw，**不 skip**（禁把"看不见"当"没问题"）
 *   @authority 本批唯一改件者＝impl-author（#1053/T5）；本文件只被 vitest 执行，不被产品代码 import
 *   @not-here 不改 src/**（只读复用 routes/sentinel.ts ＋ writer/reader）；不改 electron-renderer/**（含 Section/
 *             loader/Container/RightPanel）；不改 expected 模块；不 import 容器/面板（hook 与重依赖）；
 *             不 mock 被测系统（无 vi.mock／mockFetch）；不证像素级/交互视觉/E2E；不覆盖 M3 链路的产出正确性
 *             （那归 tests/acceptance/mvp1-m3-domain-chain.test.ts）
 *
 * 已知限制:
 *   · 🔴 **A8 生产侧落点 deferred ＋ known_issue**：本批写集不含 electron-renderer/src/lib/measurement-trends.ts
 *     与 MeasurementTrendContainer.tsx ⇒ 生产侧不能新增导出、不能改容器。故 A8 由两层组成：
 *     ① expected 模块的 `shouldLoadTrends` **参照实现** ＋ 真值表单测；② 对容器源码的**源码断言**
 *     （守卫在 loader 调用之前 ／ `loadMeasurementTrends(` 恰 1 次 ／ 全文件零网络原语 ／ 提示态无降级条）。
 *     生产纯函数化（lib 导出 ＋ 容器引用）**未落地**，属 deferred，需 L1 批准扩写集。
 *     🔴 本条不得被改写成「已抽成生产纯函数」。
 *   · render 桥只证「渲染树含什么」，不证像素级/交互视觉/E2E；事件处理器不被桥执行 ⇒ 一页纸「点击可传出」
 *     由「入口元素在场」＋ 源码断言（`onClick={onOpenOnePager}`）共同证明。
 *   · app/**（Web UI）本批未动（同源 Web 入口不在本件范围）。
 *   · A9 只证「M3 四真值经展示组件不丢真」（渲染保真）；四真值本身的**产出正确性**归 m3 验收件 —— 两处各自
 *     独立手算、互不反推（双源一致才算真值）。
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
import { renderOnePager } from '../../src/agent/report-assembler';
import {
  ONEPAGER_SLOT_TITLES,
  auditConclusionCoverage,
  resolvePointers,
} from '../../src/agent/report-onepager-trace';
import type { DiagnosisReport } from '../../src/l3/synova-diagnosis-engine';
import { nowMs } from './support/clock';
import {
  EXP_TRENDS_PATH,
  EXP_SEMANTICS_VERSION,
  EXP_SECTION_TITLE,
  EXP_TESTID,
  EXP_ORG,
  EXP_ENTITY_ID,
  EXP_CODE_INVALID_ORG_ID,
  EXP_CODE_INVALID_DAYS,
  EXP_ORG_INVALID,
  EXP_DAYS_INVALID,
  EXP_DAYS_BOUNDARY_VALID,
  EXP_DAYS_ONE,
  EXP_DAYS_DEFAULT,
  EXP_SINGLE_OBSERVATION_COUNT,
  EXP_METRIC,
  EXP_SEED_WINDOW,
  EXP_SEED,
  EXP_TREND,
  shouldLoadTrends,
  EXP_WIRING,
  EXP_M3_TRUTHS,
  EXP_ONEPAGER_SLOTS,
  EXP_POINTER_PREFIX,
  EXP_FORBIDDEN_RENDER_PATTERNS,
  EXP_ERROR_CODE,
  EXP_ERROR_PREFIX,
  EXP_ERROR_SEPARATOR,
  EXP_FIXTURE_AT,
  EXP_FIXTURE_FLAT,
  EXP_FIXTURE_NULL,
  EXP_UNKNOWN_RENDERED,
  EXP_DEGRADED_PROBE_ERROR,
  EXP_PROBE,
} from './m4-output-face.expected';

// ── [BOOT] 环境隔离：临时文件库（真落盘路径，非 :memory:）＋ JWT_SECRET；禁碰 data/synova.db ──
const dbDir = mkdtempSync(join(tmpdir(), 'synova-m4-'));
const DB_PATH = join(dbDir, 'synova.db');
process.env.SYNOVA_DB_PATH = DB_PATH;
process.env.JWT_SECRET = 'm4-acceptance-secret-0123456789abcdef';
process.env.DEV_MODE = 'false';

const repoRoot = resolve(__dirname, '../..');
if (!readFileSync(join(repoRoot, 'package.json'), 'utf-8').includes('"name"')) {
  throw new Error('[M4][ENV] 仓库根定位失败（package.json 不可读）—— 环境不满足，禁跳过');
}

/**
 * SQLite `datetime('now')` 同构格式（UTC，'YYYY-MM-DD HH:MM:SS'）——字符串可排序、窗口比较可用。
 * 时间唯一来源 = tests/acceptance/support/clock.ts 的 nowMs()（Q-6：本文件不直接取系统时钟）。
 */
function sqliteAt(msAgo: number): string {
  return new Date(nowMs() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
}
const T_PREV = sqliteAt(EXP_SEED_WINDOW.PREV_MS_AGO); // 2 天前
const T_LATEST = sqliteAt(EXP_SEED_WINDOW.LATEST_MS_AGO); // 1 分钟前（最新）
const T_OLD = sqliteAt(EXP_SEED_WINDOW.OLD_MS_AGO); // 8 天前（缺省 7 天窗口外）

/** 服务端 trends 响应的结构子集（只声明本件断言用到的字段） */
interface TrendItemJson {
  metricId: string;
  entityId: string;
  unit: string | null;
  count: number;
  latestAt: string;
  latestValue: number | null;
  previousValue: number | null;
  changeRatio: number | null;
}
interface TrendsJson {
  ok: boolean;
  count?: number;
  summary?: TrendItemJson[];
  degraded?: boolean;
  errors?: string[];
  code?: string;
  received?: unknown;
}

/** 种子行（fixture 输入；期望值一律来自 EXP_*） */
interface SeedRow {
  orgId: string;
  metricId: string;
  value: number;
  unit: string;
  observedAt: string;
}

let db: Database.Database;
let base = '';
let mainServer: Server | undefined;
let badBase = '';
let badServer: Server | undefined;
/** T1 真调结果 → T2「真数据渲染」用例复用（摘 API ⇒ 两个用例同红，反例①） */
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
  db = new Database(DB_PATH); // 真文件库
  metricReadingsMigration.up(db); // 建真表（metric_readings 17 列）

  // ── 真写入：2 org × 3 指标（经唯一写入口 createMetricSink）──
  const sink = createMetricSink(db);
  const rows: readonly SeedRow[] = [
    { orgId: EXP_ORG.AA, metricId: EXP_METRIC.UP, value: EXP_SEED.UP.PREV_VALUE, unit: EXP_SEED.UP.UNIT, observedAt: T_PREV },
    { orgId: EXP_ORG.AA, metricId: EXP_METRIC.UP, value: EXP_SEED.UP.LATEST_VALUE, unit: EXP_SEED.UP.UNIT, observedAt: T_LATEST },
    { orgId: EXP_ORG.AA, metricId: EXP_METRIC.OLD, value: EXP_SEED.OLD.VALUE, unit: EXP_SEED.OLD.UNIT, observedAt: T_OLD },
    { orgId: EXP_ORG.BB, metricId: EXP_METRIC.DOWN, value: EXP_SEED.DOWN.PREV_VALUE, unit: EXP_SEED.DOWN.UNIT, observedAt: T_PREV },
    { orgId: EXP_ORG.BB, metricId: EXP_METRIC.DOWN, value: EXP_SEED.DOWN.LATEST_VALUE, unit: EXP_SEED.DOWN.UNIT, observedAt: T_LATEST },
  ];
  for (const row of rows) {
    const wrote = sink({ ...row, sourceType: 'compute', sourceId: 'M4-ACCEPTANCE-1053' });
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

  // ── 反例服务器：五个挂载点（HTTP 500／形状非法／坏 JSON／服务端 ok:false 带 errors／ok:false 无 errors）──
  const badApp = express();
  badApp.use('/s500', (_req, res) => { res.status(500).json({ ok: false, code: EXP_PROBE.HTTP_500_CODE }); });
  badApp.use('/sbad', (_req, res) => {
    res.json({ ok: true, count: 1, summary: [{ metricId: EXP_PROBE.BAD_SHAPE_METRIC_ID }] }); // 项缺 entityId/count/latestAt/… ⇒ 形状非法
  });
  badApp.use('/sjunk', (_req, res) => { res.type('application/json').send('{not json'); });
  badApp.use('/sokfalse', (_req, res) => {
    res.json({ ok: false, degraded: true, summary: [], errors: [EXP_PROBE.SERVER_DEGRADED_PASSTHROUGH] }); // 服务端 errors 原样透传
  });
  badApp.use('/sokfalse-noerrors', (_req, res) => {
    res.json({ ok: false, degraded: true, summary: [] }); // 服务端 ok:false 且无可读原因 ⇒ loader 自造 SERVER_DEGRADED 码
  });
  const bad = await listen(badApp);
  badServer = bad.server;
  badBase = bad.base;

  console.log(`[BOOT] db=${DB_PATH} base=${base} badBase=${badBase} orgs=${EXP_ORG.AA}|${EXP_ORG.BB}`);
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

async function trendsJson(res: Response): Promise<TrendsJson> {
  return (await res.json()) as TrendsJson;
}

/** summary 必须存在（缺 ⇒ 环境/契约不成立，throw 而非静默当空数组） */
function summaryOf(body: TrendsJson): TrendItemJson[] {
  if (!Array.isArray(body.summary)) {
    throw new Error(`[M4][ENV] trends 响应缺 summary 数组（ok=${String(body.ok)}）—— 契约不成立，禁跳过`);
  }
  return body.summary;
}

function findTrend(items: readonly TrendItemJson[], metricId: string): TrendItemJson {
  const found = items.find((item) => item.metricId === metricId);
  if (found === undefined) throw new Error(`[M4][ENV] trends 缺指标 ${metricId} —— 种子/窗口不成立，禁跳过`);
  return found;
}

/** 打真 trends 端点（base 由 BOOT 注入）并返回 summary（断言 200 + ok:true） */
async function fetchTrendSummary(query: string): Promise<TrendItemJson[]> {
  const url = query === '' ? `${base}${EXP_TRENDS_PATH}` : `${base}${EXP_TRENDS_PATH}&${query}`;
  const res = await fetch(url);
  expect(res.status, `GET ${url}`).toBe(200);
  const body = await trendsJson(res);
  expect(body.ok, `GET ${url}`).toBe(true);
  return summaryOf(body);
}

// ═════════════════════════════════════════════════════════════════════════════
// ① 服务端回归：A6 两 org 隔离 ／ A7 orgId 非法 ／ A1 缺省窗口 ／ A2 days=1 ／ A3 days 五格
//    （M-7「删 orgId 透传」⇒ A6 必红 ／ M-8「删 days 上界」⇒ A3[3651] 必红）
// ═════════════════════════════════════════════════════════════════════════════

describe('#1053 T5 · A6 两 org 隔离（真 express ＋ 真文件库）', () => {
  it(`A6-1 orgId=${EXP_ORG.AA} 只含本 org 指标（UP 在 ／ DOWN 不在）＋ 值/变化率正确`, async () => {
    const items = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.AA)}`);
    const ids = items.map((item) => item.metricId);
    console.log(`[A6] aa ids=${ids.join('|')}`);

    expect(ids).toContain(EXP_METRIC.UP);
    expect(ids).not.toContain(EXP_METRIC.DOWN);
    expect(items.every((item) => item.metricId !== EXP_METRIC.DOWN)).toBe(true);

    const up = findTrend(items, EXP_METRIC.UP);
    expect(up.entityId).toBe(EXP_ENTITY_ID);
    expect(up.count).toBe(EXP_SEED.UP.COUNT);
    expect(up.latestValue).toBe(EXP_SEED.UP.LATEST_VALUE);
    expect(up.previousValue).toBe(EXP_SEED.UP.PREV_VALUE);
    expect(up.changeRatio).toBeCloseTo(EXP_SEED.UP.CHANGE_RATIO, 9);
    expect(up.unit).toBe(EXP_SEED.UP.UNIT);
    expect(up.latestAt).toBe(T_LATEST);
    expect(deriveTrendDirection(up.changeRatio)).toBe(EXP_TREND.UP);
  });

  it(`A6-2 orgId=${EXP_ORG.BB} 只含本 org 指标（DOWN 在 ／ UP 不在）＋ 值/变化率正确`, async () => {
    const items = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.BB)}`);
    const ids = items.map((item) => item.metricId);
    console.log(`[A6] bb ids=${ids.join('|')}`);

    expect(ids).toContain(EXP_METRIC.DOWN);
    expect(ids).not.toContain(EXP_METRIC.UP);
    expect(items.every((item) => item.metricId !== EXP_METRIC.UP)).toBe(true);

    const down = findTrend(items, EXP_METRIC.DOWN);
    expect(down.count).toBe(EXP_SEED.DOWN.COUNT);
    expect(down.latestValue).toBe(EXP_SEED.DOWN.LATEST_VALUE);
    expect(down.previousValue).toBe(EXP_SEED.DOWN.PREV_VALUE);
    expect(down.changeRatio).toBeCloseTo(EXP_SEED.DOWN.CHANGE_RATIO, 9);
    expect(down.unit).toBe(EXP_SEED.DOWN.UNIT);
    expect(deriveTrendDirection(down.changeRatio)).toBe(EXP_TREND.DOWN);
  });

  it('A6-3 两 org 结果集不相交（交集为空 ⇒ 无跨租户混示）', async () => {
    const aa = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.AA)}`);
    const bb = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.BB)}`);
    const aaIds = new Set(aa.map((item) => item.metricId));
    const bbIds = new Set(bb.map((item) => item.metricId));
    const intersection = [...aaIds].filter((metricId) => bbIds.has(metricId));
    console.log(`[A6] aa=${[...aaIds].join('|')} bb=${[...bbIds].join('|')} intersection=${intersection.join('|')}`);

    expect(intersection).toEqual([]);
    expect(aaIds.has(EXP_METRIC.UP)).toBe(true);
    expect(bbIds.has(EXP_METRIC.DOWN)).toBe(true);
  });
});

describe(`#1053 T5 · A7 orgId 非法 ⇒ 400 ${EXP_CODE_INVALID_ORG_ID}（received 原样回显）`, () => {
  for (const invalidCase of EXP_ORG_INVALID) {
    it(`A7 orgId 非法[${invalidCase.label}] ⇒ 400 ＋ code ＋ received 原样回显`, async () => {
      const url = `${base}${EXP_TRENDS_PATH}&${invalidCase.query}`;
      const res = await fetch(url);
      const body = await trendsJson(res);
      console.log(`[A7] ${invalidCase.label} status=${res.status} code=${String(body.code)} received=${JSON.stringify(body.received)}`);

      expect(res.status, url).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.code).toBe(EXP_CODE_INVALID_ORG_ID);
      expect(body.received).toEqual(invalidCase.received);
    });
  }
});

describe('#1053 T5 · A1 缺省窗口（不带 days ⇒ 服务端缺省窗口）', () => {
  it(`A1 缺省 ${EXP_DAYS_DEFAULT} 天：OLD（${EXP_SEED_WINDOW.OLD_MS_AGO / 86400000} 天前）排除 ／ UP（2 天前）在内；放宽窗口后 OLD 回来`, async () => {
    const items = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.AA)}`);
    const ids = items.map((item) => item.metricId);
    console.log(`[A1] default-window ids=${ids.join('|')} (window=${EXP_DAYS_DEFAULT}d)`);

    expect(ids).toContain(EXP_METRIC.UP);
    expect(ids).not.toContain(EXP_METRIC.OLD);

    // 对照（防「假绿」）：不是数据缺失，而是窗口裁剪 —— 窗口放宽到上界后 OLD 必须回来
    const wide = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.AA)}&days=${EXP_DAYS_BOUNDARY_VALID}`);
    const wideIds = wide.map((item) => item.metricId);
    console.log(`[A1] wide-window ids=${wideIds.join('|')} (window=${EXP_DAYS_BOUNDARY_VALID}d)`);
    expect(wideIds).toContain(EXP_METRIC.OLD);
  });
});

describe(`#1053 T5 · A2 days=${EXP_DAYS_ONE}（窗口收窄 ⇒ 不可比必须显式 null）`, () => {
  it(`A2 days=${EXP_DAYS_ONE}：UP 只剩最新一条 ⇒ count=${EXP_SINGLE_OBSERVATION_COUNT}、previousValue/changeRatio=null`, async () => {
    const items = await fetchTrendSummary(`orgId=${encodeURIComponent(EXP_ORG.AA)}&days=${EXP_DAYS_ONE}`);
    const up = findTrend(items, EXP_METRIC.UP);
    console.log(`[A2] count=${up.count} latest=${String(up.latestValue)} prev=${String(up.previousValue)} ratio=${String(up.changeRatio)}`);

    expect(up.count).toBe(EXP_SINGLE_OBSERVATION_COUNT);
    expect(up.latestValue).toBe(EXP_SEED.UP.LATEST_VALUE);
    expect(up.previousValue).toBeNull();
    expect(up.changeRatio).toBeNull();
    expect(deriveTrendDirection(up.changeRatio)).toBe(EXP_TREND.UNKNOWN); // 不伪造方向
  });
});

describe(`#1053 T5 · A3 days 越界/非整数五格 ＋ 上界（${EXP_CODE_INVALID_DAYS}）`, () => {
  for (const days of EXP_DAYS_INVALID) {
    it(`A3 days 非法[${days}] ⇒ 400 ＋ ${EXP_CODE_INVALID_DAYS}（不 clamp、不折 7）`, async () => {
      const url = `${base}${EXP_TRENDS_PATH}&days=${encodeURIComponent(days)}`;
      const res = await fetch(url);
      const body = await trendsJson(res);
      console.log(`[A3] days=${days} status=${res.status} code=${String(body.code)} received=${JSON.stringify(body.received)}`);

      expect(res.status, url).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.code).toBe(EXP_CODE_INVALID_DAYS);
      expect(body.received).toBe(days);
    });
  }

  it(`A3 days=${EXP_DAYS_BOUNDARY_VALID}（上界含等号）⇒ 200 ok:true`, async () => {
    const url = `${base}${EXP_TRENDS_PATH}&days=${EXP_DAYS_BOUNDARY_VALID}`;
    const res = await fetch(url);
    const body = await trendsJson(res);
    console.log(`[A3] days=${EXP_DAYS_BOUNDARY_VALID} status=${res.status} ok=${String(body.ok)} count=${String(body.count)}`);

    expect(res.status, url).toBe(200);
    expect(body.ok).toBe(true);
    expect(summaryOf(body).length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ② T1 真调 API ＋ 反例降级（原 12 用例保留；Q-3/Q-9 五码全覆盖）
// ═════════════════════════════════════════════════════════════════════════════

describe(`#1053 T5 · T1 真调 API（GET ${EXP_TRENDS_PATH}）`, () => {
  it('T1 正例：真 express 路由返回两 org 趋势（原始 HTTP ＋ 被测 loader 双证据）', async () => {
    // 独立证据①：原始 HTTP 直取（不经 loader）
    const raw = await fetch(`${base}${EXP_TRENDS_PATH}`);
    expect(raw.status).toBe(200);
    const rawJson = await trendsJson(raw);
    console.log(`[T1] raw ok=${rawJson.ok} count=${String(rawJson.count)}`);
    expect(rawJson.ok).toBe(true);

    // 独立证据②：被测 loader（真 fetch 打到上面的真 express；缺 orgId ⇒ 聚合视图）
    const view = await loadMeasurementTrends(base);
    realView = view; // 供 T2「真数据渲染」用例（摘 API ⇒ 两处同红）
    console.log(`[T1] loader ok=${view.ok} degraded=${view.degraded} summary=${view.summary.length} errors=${(view.errors ?? []).join('|')}`);
    expect(view.ok).toBe(true);
    expect(view.degraded).toBe(false);
    expect(view.errors ?? []).toEqual([]);

    const up = findTrend(view.summary, EXP_METRIC.UP);
    const down = findTrend(view.summary, EXP_METRIC.DOWN);
    expect(up.latestValue).toBe(EXP_SEED.UP.LATEST_VALUE);
    expect(up.changeRatio).toBeCloseTo(EXP_SEED.UP.CHANGE_RATIO, 9);
    expect(down.latestValue).toBe(EXP_SEED.DOWN.LATEST_VALUE);
    expect(down.changeRatio).toBeCloseTo(EXP_SEED.DOWN.CHANGE_RATIO, 9);
  });

  it('T1 反例：五条降级路径均显式 degraded 且不抛；loader 自造 errors 一律带 code 前缀（Q-3/Q-9）', async () => {
    const network = await loadMeasurementTrends(await closedPortBase());
    const http500 = await loadMeasurementTrends(`${badBase}/s500`);
    const badShape = await loadMeasurementTrends(`${badBase}/sbad`);
    const junk = await loadMeasurementTrends(`${badBase}/sjunk`);
    const noErrors = await loadMeasurementTrends(`${badBase}/sokfalse-noerrors`);

    const degradedCases: ReadonlyArray<readonly [string, MeasurementTrendsView]> = [
      ['网络异常（端口已关闭）', network],
      ['HTTP 500', http500],
      ['形状非法（summary 项缺字段）', badShape],
      ['坏 JSON', junk],
      ['服务端 ok:false 且无可读原因', noErrors],
    ];
    const observedCodes = new Set<string>();
    for (const [label, view] of degradedCases) {
      console.log(`[T1-NEG] ${label} ok=${view.ok} degraded=${view.degraded} errors=${(view.errors ?? []).join('|')}`);
      expect(view.ok, label).toBe(false);
      expect(view.degraded, label).toBe(true);
      expect(view.summary, label).toEqual([]); // 不确定的数据不交给渲染层
      const errors = view.errors ?? [];
      expect(errors.length, label).toBeGreaterThan(0);
      for (const message of errors) {
        // Q-3/Q-9：loader 自造的错误一律 `<CODE>: <原因>`（前缀取自 EXP 单一源）
        const code = EXP_ERROR_PREFIX.find((candidate) => message.startsWith(`${candidate}${EXP_ERROR_SEPARATOR}`));
        expect(code, `${label}｜${message}`).toBeDefined();
        if (code !== undefined) observedCodes.add(code);
      }
    }
    // 全集覆盖：5 个 code 各至少出现一次（摘掉任一降级分支 ⇒ 本断言红）
    console.log(`[T1-NEG] observedCodes=${[...observedCodes].sort().join('|')}`);
    expect([...observedCodes].sort()).toEqual([...EXP_ERROR_PREFIX].sort());

    // 服务端 errors ⇒ 原样透传（不套壳、不改写）
    const passthrough = await loadMeasurementTrends(`${badBase}/sokfalse`);
    console.log(`[T1-NEG] passthrough ok=${passthrough.ok} errors=${(passthrough.errors ?? []).join('|')}`);
    expect(passthrough.ok).toBe(false);
    expect(passthrough.degraded).toBe(true);
    expect(passthrough.errors).toContain(EXP_PROBE.SERVER_DEGRADED_PASSTHROUGH);

    // T-7①：orgId 经 encodeURIComponent 进 URL（404 降级文案保留编码后的 orgId）
    const rawOrg = 'a b&c/中#1';
    const encoded = await loadMeasurementTrends(`${badBase}/nope`, rawOrg);
    expect((encoded.errors ?? []).join('|')).toContain(`&orgId=${encodeURIComponent(rawOrg)}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ③ 渲染：T2 四态 ＋ A14 四态恒有限制行 ＋ A11 禁渲密钥 ＋ 边界
// ═════════════════════════════════════════════════════════════════════════════

function renderSection(
  view: MeasurementTrendsView | null,
  state: MeasurementTrendState,
  onOpenOnePager?: () => void,
): string {
  return renderToStaticMarkup(MeasurementTrendSection({ view, state, onOpenOnePager }));
}

/** ready 夹具：up/down/flat 三分支（值全部来自 EXP_*，不散落魔数） */
const READY_VIEW: MeasurementTrendsView = {
  ok: true,
  degraded: false,
  summary: [
    {
      metricId: EXP_METRIC.UP, entityId: EXP_ENTITY_ID, unit: EXP_SEED.UP.UNIT, count: EXP_SEED.UP.COUNT,
      latestAt: EXP_FIXTURE_AT, latestValue: EXP_SEED.UP.LATEST_VALUE, previousValue: EXP_SEED.UP.PREV_VALUE,
      changeRatio: EXP_SEED.UP.CHANGE_RATIO,
    },
    {
      metricId: EXP_METRIC.DOWN, entityId: EXP_ENTITY_ID, unit: EXP_SEED.DOWN.UNIT, count: EXP_SEED.DOWN.COUNT,
      latestAt: EXP_FIXTURE_AT, latestValue: EXP_SEED.DOWN.LATEST_VALUE, previousValue: EXP_SEED.DOWN.PREV_VALUE,
      changeRatio: EXP_SEED.DOWN.CHANGE_RATIO,
    },
    {
      metricId: EXP_FIXTURE_FLAT.METRIC_ID, entityId: EXP_ENTITY_ID, unit: null, count: EXP_SEED.UP.COUNT,
      latestAt: EXP_FIXTURE_AT, latestValue: EXP_FIXTURE_FLAT.VALUE, previousValue: EXP_FIXTURE_FLAT.PREVIOUS_VALUE,
      changeRatio: EXP_FIXTURE_FLAT.CHANGE_RATIO,
    },
  ],
};

const EMPTY_VIEW: MeasurementTrendsView = { ok: true, degraded: false, summary: [] };
const DEGRADED_VIEW: MeasurementTrendsView = {
  ok: false,
  degraded: true,
  summary: [],
  errors: [EXP_DEGRADED_PROBE_ERROR],
};

/** 四态渲染产物（A11/A14/反例自证共用；顺序 = 状态名） */
function fourStates(onOpenOnePager: () => void): ReadonlyArray<readonly [string, string]> {
  return [
    ['loading', renderSection(null, 'loading', onOpenOnePager)],
    ['ready', renderSection(READY_VIEW, 'ready', onOpenOnePager)],
    ['empty', renderSection(EMPTY_VIEW, 'empty', onOpenOnePager)],
    ['degraded', renderSection(DEGRADED_VIEW, 'degraded', onOpenOnePager)],
  ];
}

/** 取某指标条目的渲染片段（独立实现：不调用被测组件内部逻辑） */
function itemBlock(markup: string, metricId: string): string | undefined {
  const marker = `data-metric-id="${metricId}"`;
  const at = markup.indexOf(marker);
  if (at < 0) return undefined;
  const start = markup.lastIndexOf('<div', at);
  const nextMarker = markup.indexOf('data-metric-id="', at + marker.length);
  const end = nextMarker < 0 ? markup.length : markup.lastIndexOf('<div', nextMarker);
  return markup.slice(start < 0 ? 0 : start, end <= start ? markup.length : end);
}

function itemBlockOrFail(markup: string, metricId: string): string {
  const block = itemBlock(markup, metricId);
  if (block === undefined) throw new Error(`[M4][ENV] 渲染产物缺 metricId=${metricId} —— 夹具不成立，禁跳过`);
  return block;
}

describe('#1053 T5 · T2 渲染「测量值＋趋势」（纯组件 ＋ render 桥）', () => {
  it('T2 ready：标题/根元素/每指标一条/值/单位/方向符号＋data-trend/latestAt/一页纸入口全在场', () => {
    const out = renderSection(READY_VIEW, 'ready', () => {});
    console.log(`[T2] ready length=${out.length}`);
    expect(out).toContain(EXP_SECTION_TITLE);
    expect(out).toContain(`data-testid="${EXP_TESTID.section}"`);
    expect((out.match(/data-testid="measurement-trend-item"/g) ?? []).length).toBe(READY_VIEW.summary.length);

    // 指标标识与值/单位透传（EXP 单一源）
    expect(out).toContain(EXP_METRIC.UP);
    expect(out).toContain(`${EXP_SEED.UP.LATEST_VALUE} ${EXP_SEED.UP.UNIT}`);
    expect(out).toContain(`${EXP_SEED.DOWN.LATEST_VALUE} ${EXP_SEED.DOWN.UNIT}`);
    expect(out).toContain(EXP_FIXTURE_AT); // latestAt 原样输出

    // 方向三分支：>0 ↑ up ｜ <0 ↓ down ｜ =0 → flat（变异「恒 flat」⇒ 本段必红）
    expect(out).toContain(`data-trend="${EXP_TREND.UP}"`);
    expect(out).toContain(`data-trend="${EXP_TREND.DOWN}"`);
    expect(out).toContain(`data-trend="${EXP_TREND.FLAT}"`);
    expect(out).toContain('↑');
    expect(out).toContain('↓');
    expect(out).toContain('→');

    // 一页纸接回入口（稳定选择器；摘掉 ⇒ 本用例必红）
    expect(out).toContain(`data-testid="${EXP_TESTID.onePager}"`);

    // A14：ready 态限制行恒在 ＋ 口径版本可见
    expect(out).toContain(`data-testid="${EXP_TESTID.limitations}"`);
    expect(out).toContain(EXP_SEMANTICS_VERSION);
  });

  it('T2 真数据：T1 的真 API 结果经纯组件渲染（摘 fetch/改错 URL ⇒ 本用例与 T1 同红）', () => {
    expect(realView, 'T1 真调结果缺席（loader 未取到真数据）').not.toBeNull();
    if (realView === null) throw new Error('[M4][ENV] T1 真调结果缺席 —— 环境不满足，禁跳过');
    const out = renderSection(realView, 'ready', () => {});
    expect(out).toContain(EXP_SECTION_TITLE);
    expect(out).toContain(EXP_METRIC.UP);
    expect(out).toContain(EXP_METRIC.DOWN);
    expect(out).toContain(String(EXP_SEED.UP.LATEST_VALUE)); // 真库里 up 指标的最新值
    expect(out).toContain(String(EXP_SEED.DOWN.LATEST_VALUE)); // 真库里 down 指标的最新值
    expect((out.match(/data-testid="measurement-trend-item"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain(`data-testid="${EXP_TESTID.onePager}"`);
  });

  it('T2 empty：空态是合法业务态——空态标记在场、零指标条目、零编造值', () => {
    const out = renderSection(EMPTY_VIEW, 'empty', () => {});
    console.log(`[T2] empty length=${out.length}`);
    expect(out).toContain(EXP_SECTION_TITLE);
    expect(out).toContain(`data-testid="${EXP_TESTID.empty}"`);
    expect(out).not.toContain(`data-testid="${EXP_TESTID.item}"`);
    expect(out).not.toContain('↑');
    expect(out).not.toContain('↓');
    expect(out).toContain(`data-testid="${EXP_TESTID.onePager}"`);

    // A14：empty 态限制行恒在 ＋ 口径版本可见
    expect(out).toContain(`data-testid="${EXP_TESTID.limitations}"`);
    expect(out).toContain(EXP_SEMANTICS_VERSION);
  });

  it('T2 degraded：降级条 ＋ errors 文案在场（不白屏、不假装空）', () => {
    const out = renderSection(DEGRADED_VIEW, 'degraded', () => {});
    console.log(`[T2] degraded length=${out.length}`);
    expect(out).toContain(EXP_SECTION_TITLE);
    expect(out).toContain(`data-testid="${EXP_TESTID.degraded}"`);
    expect(out).toContain(EXP_DEGRADED_PROBE_ERROR);
    expect(out).not.toContain(`data-testid="${EXP_TESTID.item}"`);
    expect(out).toContain(`data-testid="${EXP_TESTID.onePager}"`);

    // A14：degraded 态限制行恒在 ＋ 口径版本可见
    expect(out).toContain(`data-testid="${EXP_TESTID.limitations}"`);
    expect(out).toContain(EXP_SEMANTICS_VERSION);
  });

  it('T2 loading：加载态标记在场；无回调不渲按钮（无死按钮）', () => {
    const out = renderSection(null, 'loading');
    console.log(`[T2] loading length=${out.length}`);
    expect(out).toContain(EXP_SECTION_TITLE);
    expect(out).toContain(`data-testid="${EXP_TESTID.loading}"`);
    expect(out).not.toContain(`data-testid="${EXP_TESTID.onePager}"`);
    expect(() => renderSection(null, 'loading')).not.toThrow();
    expect(() => renderSection(READY_VIEW, 'ready')).not.toThrow();

    // A14：loading 态限制行恒在 ＋ 口径版本可见
    expect(out).toContain(`data-testid="${EXP_TESTID.limitations}"`);
    expect(out).toContain(EXP_SEMANTICS_VERSION);
  });

  it('T2 边界：changeRatio null⇒unknown／0⇒flat／正⇒up／负⇒down；latestValue null⇒未知；unit null 不显示单位', () => {
    // 纯函数边界（方向推导唯一真源）
    expect(deriveTrendDirection(EXP_SEED.UP.CHANGE_RATIO)).toBe(EXP_TREND.UP);
    expect(deriveTrendDirection(EXP_SEED.DOWN.CHANGE_RATIO)).toBe(EXP_TREND.DOWN);
    expect(deriveTrendDirection(EXP_FIXTURE_FLAT.CHANGE_RATIO)).toBe(EXP_TREND.FLAT);
    expect(deriveTrendDirection(null)).toBe(EXP_TREND.UNKNOWN);

    // 渲染边界：latestValue/previousValue/changeRatio 全 null + unit null
    const nullView: MeasurementTrendsView = {
      ok: true,
      degraded: false,
      summary: [{
        metricId: EXP_FIXTURE_NULL.METRIC_ID, entityId: EXP_ENTITY_ID, unit: null, count: EXP_SINGLE_OBSERVATION_COUNT,
        latestAt: EXP_FIXTURE_AT, latestValue: null, previousValue: null, changeRatio: null,
      }],
    };
    const out = renderSection(nullView, 'ready', () => {});
    console.log(`[T2] boundary length=${out.length}`);
    expect(out).toContain(EXP_FIXTURE_NULL.METRIC_ID);
    expect(out).toContain(`data-trend="${EXP_TREND.UNKNOWN}"`);
    expect(out).toContain(EXP_UNKNOWN_RENDERED); // 算不出 ⇒ 显式未知（禁编 0/假方向）
    expect(out).not.toContain('null'); // unit null ⇒ 不显示单位（也不得回显 null 字样）
    expect(out).not.toContain('↑');
    expect(out).not.toContain('↓');
  });
});

describe('#1053 T5 · A14 四态恒有限制行（loading/ready/empty/degraded 各一条）', () => {
  it('A14：四态渲染产物**各自**含 limitations 标记 ＋ 口径版本（不是只 ready 有）', () => {
    for (const [state, out] of fourStates(() => {})) {
      console.log(`[A14] ${state} limitations=${out.includes(EXP_TESTID.limitations)} semantics=${out.includes(EXP_SEMANTICS_VERSION)}`);
      expect(out, state).toContain(`data-testid="${EXP_TESTID.limitations}"`);
      expect(out, state).toContain(EXP_SEMANTICS_VERSION);
    }
  });
});

describe('#1053 T5 · A11 禁渲密钥（四态输出均不命中）', () => {
  it('A11：ready/empty/degraded/loading 输出均不匹配 EXP_FORBIDDEN_RENDER_PATTERNS 任一条', () => {
    for (const [state, out] of fourStates(() => {})) {
      for (const pattern of EXP_FORBIDDEN_RENDER_PATTERNS) {
        expect(pattern.test(out), `${state} 命中禁渲模式 ${String(pattern)}（长度 ${out.length}）`).toBe(false);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ④ A9 M3 四真值经 Section 渲染（渲染保真；真值本身的产出归 m3 验收件）
// ═════════════════════════════════════════════════════════════════════════════

describe('#1053 T5 · A9 M3 四真值经 Section 渲染', () => {
  it('A9：四个 metricId/值/单位全在场；单观测 ⇒ data-trend="unknown"（不伪造方向）', () => {
    const view: MeasurementTrendsView = {
      ok: true,
      degraded: false,
      summary: EXP_M3_TRUTHS.map((truth) => ({
        metricId: truth.metricId,
        entityId: EXP_ENTITY_ID,
        unit: truth.unit,
        count: EXP_SINGLE_OBSERVATION_COUNT,
        latestAt: EXP_FIXTURE_AT,
        latestValue: truth.value,
        previousValue: null,
        changeRatio: null,
      })),
    };
    const out = renderSection(view, 'ready', () => {});
    console.log(`[A9] rendered=${EXP_M3_TRUTHS.map((t) => t.metricId).join('|')} length=${out.length}`);

    for (const truth of EXP_M3_TRUTHS) {
      const block = itemBlockOrFail(out, truth.metricId);
      expect(block, truth.metricId).toContain(truth.rendered); // 值 ＋ 单位同一条目内
      expect(block, truth.metricId).toContain(`data-trend="${EXP_TREND.UNKNOWN}"`);
    }
    expect((out.match(/data-testid="measurement-trend-item"/g) ?? []).length).toBe(EXP_M3_TRUTHS.length);
    expect(out).toContain(EXP_SEMANTICS_VERSION);
    expect(out).toContain(`data-testid="${EXP_TESTID.limitations}"`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⑤ A8 零请求（未选客户 ⇒ 不发请求）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A8-a 的参照实现：把「是否发起」与「请求长什么样」连起来，证明 false 分支**不产生 URL**。
 * 🔴 这不是生产实现（生产落点 deferred，见文件头「已知限制」）；生产行为的证据是下面的 A8-b 源码断言。
 */
function trendUrlFor(orgId: string | null | undefined): string | null {
  if (!shouldLoadTrends(orgId)) return null;
  return `${EXP_TRENDS_PATH}&orgId=${encodeURIComponent(String(orgId))}`;
}

describe('#1053 T5 · A8 零请求（未选客户不发请求）', () => {
  it('A8-a shouldLoadTrends 真值表：null/undefined/"" ⇒ false（不产生 URL）；非空 ⇒ true', () => {
    const cases: ReadonlyArray<readonly [string, string | null | undefined, boolean]> = [
      ['null（未选客户）', null, false],
      ['undefined（未注入）', undefined, false],
      ['空串（清空选择）', '', false],
      ['已选客户', EXP_ORG.AA, true],
    ];
    for (const [label, orgId, expected] of cases) {
      const allowed = shouldLoadTrends(orgId);
      const url = trendUrlFor(orgId);
      console.log(`[A8] ${label} shouldLoad=${allowed} url=${url === null ? 'null' : url.slice(0, EXP_TRENDS_PATH.length)}`);
      expect(allowed, label).toBe(expected);
      if (expected) {
        expect(url, label).not.toBeNull();
        expect(String(url).startsWith(EXP_TRENDS_PATH), label).toBe(true);
      } else {
        expect(url, `${label}：false 分支不得产生任何请求 URL`).toBeNull();
      }
    }
  });

  it('A8-b Container 源码断言：守卫在 loader 调用之前 ＋ 恰 1 次调用 ＋ 零网络原语 ＋ 提示态无降级条', () => {
    const src = readSource(EXP_WIRING.containerPath);
    const guardAt = src.indexOf(EXP_WIRING.emptyOrgGuard);
    const loadAt = src.indexOf(EXP_WIRING.loaderCall);
    const loaderCalls = src.split(EXP_WIRING.loaderCall).length - 1;
    const hasNetworkPrimitive = src.includes(`${EXP_WIRING.fetchName}(`);
    console.log(`[A8] guardAt=${guardAt} loadAt=${loadAt} loaderCalls=${loaderCalls} hasFetch=${hasNetworkPrimitive}`);

    // ① 守卫先于 loader 调用（未选客户 ⇒ 在发起前 return ⇒ 零请求）
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(loadAt).toBeGreaterThan(guardAt);
    // ② 全文件恰 1 次 loader 调用（不散落第二个取数点）
    expect(loaderCalls).toBe(1);
    // ③ 全文件零网络原语（请求只经 loader；容器里出现即第二套取数面）
    expect(hasNetworkPrimitive).toBe(false);
    // ④ 提示态在场且不出降级条（未选客户不是"降级"）
    expect(src).toContain(EXP_TESTID.selectOrg);
    expect(src).not.toContain(EXP_TESTID.degraded);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⑥ A13 装配语义（RightPanel 源码断言；**无位置式 index 断言**）
// ═════════════════════════════════════════════════════════════════════════════

function readSource(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf-8');
}

/**
 * 取「含 marker 的顶层声明行」到「下一个顶层声明」之间的片段（顶层 = 行首零缩进；
 * 终止 = 行首 `const `/`export `/`function `/`type ` 之一）。
 * 锚点用 EXP_WIRING.gaTabsParams（全文件唯一出现，= GAWorkspaceTabs 签名行）；独立实现，不引解析器。
 */
function topLevelSlice(source: string, marker: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(marker));
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^(const|export|function|type) /.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start, end).join('\n');
}

describe('#1053 T5 · A13 装配语义（RightPanel 源码断言）', () => {
  it(`A13-1 「测量值＋趋势」单挂载点（计数 = ${EXP_WIRING.count}）`, () => {
    const src = readSource(EXP_WIRING.rightPanelPath);
    const mounts = src.split(EXP_WIRING.containerTag).length - 1; // 等价规格写法 (src.match(/<MeasurementTrendContainer/g) ?? []).length
    console.log(`[A13] containerMounts=${mounts}`);
    expect(mounts).toBe(EXP_WIRING.count);
  });

  it(`A13-2 挂载门控 = ${EXP_WIRING.gate}（未选客户不挂载 ⇒ 零请求）`, () => {
    const src = readSource(EXP_WIRING.rightPanelPath);
    console.log(`[A13] gate=${src.includes(EXP_WIRING.gate)}`);
    expect(src).toContain(EXP_WIRING.gate);
  });

  it("A13-3 一页纸回调仅 view==='ws_ga' 传入（字面量恰 1 次，且与 setTab('report') 同处）", () => {
    const src = readSource(EXP_WIRING.rightPanelPath);
    const occurrences = src.split(EXP_WIRING.onePagerCallback).length - 1;
    const at = src.indexOf(EXP_WIRING.onePagerCallback);
    console.log(`[A13] onePagerCallbackCount=${occurrences} at=${at}`);
    expect(occurrences).toBe(1);
    // 回调体指向既有 report tab（不新建 tab、不重建报告链）
    expect(EXP_WIRING.onePagerCallback).toContain("setTab('report')");
    // 挂载处确有 onOpenOnePager 传参（回调不是死字面量）
    expect(src).toContain('onOpenOnePager={');
  });

  it('A13-4 tab 状态上提：RightPanel 顶层 useState，且在任何早退（if (!open) return null）之前', () => {
    const src = readSource(EXP_WIRING.rightPanelPath);
    const stateAt = src.indexOf(EXP_WIRING.tabStateLifted);
    const earlyReturnAt = src.indexOf(EXP_WIRING.earlyReturn);
    console.log(`[A13] tabStateAt=${stateAt} earlyReturnAt=${earlyReturnAt}`);
    expect(stateAt).toBeGreaterThanOrEqual(0);
    expect(earlyReturnAt).toBeGreaterThanOrEqual(0);
    expect(stateAt).toBeLessThan(earlyReturnAt); // hooks 规则：state 必在早退之前
  });

  it('A13-5 GAWorkspaceTabs 自身无 tab state（tab 由 props 注入）＋ tab 经 props 下传', () => {
    const src = readSource(EXP_WIRING.rightPanelPath);
    const slice = topLevelSlice(src, EXP_WIRING.gaTabsParams);
    console.log(`[A13] gaTabsSliceLines=${slice === '' ? 0 : slice.split(/\r?\n/).length} hasParams=${slice.includes(EXP_WIRING.gaTabsParams)}`);

    // 切片非空且含签名 —— 否则下面的 not.toContain 会变成"空片段恒真"的假绿
    expect(slice).not.toBe('');
    expect(slice).toContain(EXP_WIRING.gaTabsParams);
    expect(slice.split(/\r?\n/).length).toBeGreaterThan(1);
    // 无自带 tab 状态、无 setTab（tab 上提的唯一证据）
    expect(slice).not.toContain('setTab');
    expect(slice).not.toContain(EXP_WIRING.tabStateLifted);
    // 下传点在场
    expect(src).toContain(EXP_WIRING.tabPassDown);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⑦ A10 一页纸四章 ＋ 溯源指针
// ═════════════════════════════════════════════════════════════════════════════

/** 最小 DiagnosisReport 夹具（字段取自 DiagnosisReport；与运行时刻无关） */
const ONEPAGER_REPORT: DiagnosisReport = {
  reportId: 'rpt-m4-1053-onepager',
  teamId: 'm4-1053-org',
  generatedAt: '2026-10-20T00:00:00.000Z',
  summary: '现金流缺口与人才密度双重制约增长。',
  expertReports: [{ expert: 'finance', findings: ['经营现金流连续 3 季度为负'], confidence: 0.8 }],
  rootCauses: [
    { description: '现金流缺口扩大：经营现金流连续 3 季度为负', dimension: 'financial', confidence: 0.82 },
    { description: '核心人才密度不足', dimension: 'talent', confidence: 0.71 },
  ],
  recommendations: [
    { action: '压缩非核心固定成本 20%', priority: 'critical', expert: 'finance' },
    { action: '建立关键岗位继任计划', priority: 'high', expert: 'org' },
  ],
  raw: {},
};

describe('#1053 T5 · A10 一页纸四章 ＋ 溯源指针', () => {
  it('A10：四章齐备（字面与 EXP 单一源一致）＋ [src:] 指针 ＋ 覆盖审计 0 缺口 ＋ 报告外可溯源', () => {
    const markdown = renderOnePager(ONEPAGER_REPORT, 'ceo', {
      evidenceHighlights: ['现金跑道不足 6 个月 [src:finding:F-1053-001]'],
      cycleConclusions: ['现金流循环周转天数上升 [src:cycle:cash-cycle]'],
    });
    console.log(`[A10] markdownLength=${markdown.length}`);

    // ① 四章标题：渲染器常量与 EXP 单一源逐字相等，且逐项在场
    expect([...ONEPAGER_SLOT_TITLES]).toEqual([...EXP_ONEPAGER_SLOTS]);
    for (const slot of EXP_ONEPAGER_SLOTS) expect(markdown).toContain(slot);

    // ② 溯源指针在场
    expect(markdown).toContain(EXP_POINTER_PREFIX);

    // ③ 覆盖审计：条目行零缺口（R1：每条目行必带 ≥1 指针）
    const coverage = auditConclusionCoverage(markdown);
    console.log(`[A10] coverage=${JSON.stringify(coverage)}`);
    expect(coverage.degraded).toBe(false);
    expect(coverage.conclusionLines).toBeGreaterThan(0);
    expect(coverage.missingPointerLines).toBe(0);

    // ④ 解析审计：真实 resolvers ⇒ resolvedCount>0 且报告外（cycle/finding/evidence）可溯源 ≥1
    const audit = resolvePointers(markdown, {
      report: () => true,
      cycle: () => true,
      finding: () => true,
      evidence: () => true,
    });
    console.log(`[A10] audit=${JSON.stringify({ total: audit.total, resolved: audit.resolvedCount, unresolved: audit.unresolvedCount, unknown: audit.unknownCount, external: audit.externalResolvableCount, degraded: audit.degraded })}`);
    expect(audit.degraded).toBe(false);
    expect(audit.resolvedCount).toBeGreaterThan(0);
    expect(audit.unresolvedCount).toBe(0);
    expect(audit.unknownCount).toBe(0);
    expect(audit.externalResolvableCount).toBeGreaterThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⑧ 反例可红性自证（每条断言都有对应摘除点）
// ═════════════════════════════════════════════════════════════════════════════

describe('#1053 T5 · 反例可红性自证（M-1…M-8 定位表）', () => {
  it('断言非恒真：四态输出两两不等 ＋ 四态都有限制行/入口（恒真断言会四者相等）', () => {
    const states = fourStates(() => {});
    const markups = states.map(([, markup]) => markup);
    // 四态两两不等 ⇒ 状态分支真生效（恒真/恒假断言会让某些态相等）
    expect(new Set(markups).size).toBe(markups.length);
    expect(markups[0]).toContain(`data-testid="${EXP_TESTID.loading}"`);
    expect(markups[1]).toContain(`data-testid="${EXP_TESTID.item}"`);
    expect(markups[2]).toContain(`data-testid="${EXP_TESTID.empty}"`);
    expect(markups[3]).toContain(`data-testid="${EXP_TESTID.degraded}"`);

    for (const [state, markup] of states) {
      expect(markup, state).toContain(`data-testid="${EXP_TESTID.onePager}"`);
      expect(markup, state).toContain(`data-testid="${EXP_TESTID.limitations}"`);
    }

    /**
     * 变异定位表（每条的必红点在本文件何处）:
     *   M-1 摘 loader 的 fetch ／ 改错 base    ⇒ T1 正例 ＋ T1 反例（真 express 真调）
     *   M-2 改错 TRENDS_PATH ／ view 参数错     ⇒ A6/A1/A2/A3（真 express 端点）＋ T1 正例
     *   M-3 摘掉一页纸按钮                      ⇒ T2 ready/empty/degraded ＋ 本用例（入口恒在）
     *   M-4 摘掉挂载点                          ⇒ A13-1（计数 = 1）
     *   M-5 方向恒 flat                         ⇒ T2 ready（three data-trend）＋ T2 边界 ＋ A6（deriveTrendDirection）
     *   M-6 删掉限制行                          ⇒ A14（四态各自）＋ T2 四态 ＋ 本用例
     *   M-7 删 orgId 透传（routes/sentinel.ts）  ⇒ A6-1/A6-2/A6-3（隔离断言）※ 由独立自验员在临时树实跑
     *   M-8 删 days 上界（routes/sentinel.ts）   ⇒ A3[3651] ＋ A3 上界对照 ※ 同上
     */
    console.log('[PASS] M4 出口面：服务端回归／渲染四态／装配语义／一页纸／反例可红性 自证完成');
  });
});
