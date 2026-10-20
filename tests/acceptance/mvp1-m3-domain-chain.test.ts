/**
 * tests/acceptance/mvp1-m3-domain-chain.test.ts — #656（批 2 / M3）领域链贯通验收
 *
 * 一条验收件串起 M3 五判据（规格 §4.1，逐字自 MVP v1.1 §三）：
 *   ① 真哨兵（非 SEED）经真链路产出测量值 ② 时序落库 + 趋势可读 ③ 1 条循环算一次
 *   ④ 参数层 ④b/c/d 接口存在性各一条（裁 153：存在 ≠ 实现）
 *
 * 契约（铁律 47；规格 §4.3）:
 *   @input  临时 DB（mkdtemp，经 SYNOVA_DB_PATH 指向；禁碰 data/synova.db）＋ 合成企业输入 ＋ env 隔离
 *   @output 标签化输出 [BOOT]/[SENTINEL]/[METRIC]/[TREND]/[CYCLE]/[PARAM-④b]/[PARAM-④c]/[PARAM-④d]/[PASS]
 *   @exit   vitest 语义：0=通过 ｜ 任一 expect 红=真红（1）｜ 环境/检查自身失败 ⇒ throw Error('[M3][ENV] …')（=2 语义）
 *   @degraded 测试自身不降级：环境不满足 ⇒ throw，不跳过
 *   @not-here 不做标定内容；不写第二套 store；不 mock 被测系统（④b 用真 store/真 readback；④c/④d 只读导入）；
 *             不断言 ④b 的 kind（裁 227 Step 1 未做）；不判 ④c/④d "已实现"
 *
 * 已知限制:
 *   · ④d `not_implemented` 是**合法通过态**（裁 153 只要求接口存在），本件只证"存在、未实现"。
 *   · ④c 证"接口在、未接线"（@deprecated/#1010 标记 + src/ 零调用点），不是"已接线"。
 *   · cash-flow 样板哨兵写的指标行无 R4 三列 ⇒ degraded=1（表级不变量），属预期，不作失败。
 *   · 反例变异验证（规格 §4.2 六项）由 T2 在本文件上执行，本文件不含变异。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import { metricReadingsMigration } from '../../src/store/migrations/002-metric-readings';
import sentinelRoutes from '../../src/routes/sentinel';
import { computeOverflow } from '../../src/cycles/overflow-compute';
import type { CycleConfig, EnterpriseTimeSeries } from '../../src/cycles/overflow-compute';
import { captureDecision } from '../../src/l4/decision-capture';
import type { DecisionInput } from '../../src/l4/decision-capture';
import { listDecisionRows } from '../../src/l4/decision-ledger-readback';
import { closeGoal, verifyEffect, transitionGoal } from '../../src/growth/goal-lifecycle';
import { calibrateThresholds } from '../../src/l3/pkb-lifecycle';

// ── [BOOT] 环境隔离：临时库（真文件 DB，非 :memory:，证真实落盘路径）──
const dbDir = mkdtempSync(join(tmpdir(), 'synova-m3-656-'));
process.env.SYNOVA_DB_PATH = join(dbDir, 'synova.db');
process.env.JWT_SECRET = 'm3-acceptance-secret-0123456789abcdef';
process.env.DEV_MODE = 'false';

const repoRoot = resolve(__dirname, '../..');
if (!readFileSync(join(repoRoot, 'package.json'), 'utf-8').includes('"name"')) {
  throw new Error('[M3][ENV] 仓库根定位失败（package.json 不可读）—— 环境不满足，禁跳过');
}

// 唯一锚点（防历史行冒充）：org id 带 pid + 时间戳
const ANCHOR = `m3-org-${process.pid}-${Date.now()}`;
const NOW = new Date(); // 真实当前时间（trends 的 days 过滤基于 datetime('now')）

let db: Database.Database;
let store: SqliteGraphStore;
let sink: ReturnType<typeof createMetricSink>;
let base = '';
let server: Server | undefined;

// ── 合成企业输入（期望值手算，见各断言注释；变异计算 ⇒ 值变 ⇒ 必红）──
// 两条财务条目（graph_nodes，类型 = 映射目标 resource/money；FINANCIAL→aliasOf Financial）
//   合计：revenue 300 ｜ cost 100 ｜ opex 30 ｜ cash 180
const ENTRIES = [
  { period: '2026-01', revenue: 100, cost: 40, operating_expenses: 10, cash_balance: 60 },
  { period: '2026-02', revenue: 200, cost: 60, operating_expenses: 20, cash_balance: 120 },
] as const;

beforeAll(async () => {
  db = new Database(process.env.SYNOVA_DB_PATH as string);
  store = new SqliteGraphStore(db); // 建真表（graph_nodes/graph_triples）
  metricReadingsMigration.up(db);   // 建真表（metric_readings 17 列）
  const ins = db.prepare(
    "INSERT INTO graph_nodes (graph, type, name, props) VALUES ('default', 'resource/money', ?, ?)",
  );
  for (const e of ENTRIES) ins.run(`fin-${e.period}`, JSON.stringify(e));
  sink = createMetricSink(db);

  const app = express();
  app.use(express.json());
  (app.locals as { orchestration?: unknown }).orchestration = { db };
  app.use('/api/sentinel', sentinelRoutes); // 真路由（只读复用，不改）
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('[M3][ENV] express 服务未起 —— 环境不满足');
  base = `http://127.0.0.1:${addr.port}`;
  console.log(`[BOOT] db=${process.env.SYNOVA_DB_PATH} anchor=${ANCHOR} base=${base}`);
});

afterAll(() => {
  server?.close();
  db?.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('#656 M3 · 领域链贯通（真哨兵 → 时序 → 趋势 → 循环 → ④b/c/d）', () => {
  it('判据①＋②前半 [SENTINEL][METRIC]：真哨兵（cash-flow，非 SEED）经真链路写 metric_readings，值随输入变', async () => {
    const res = await cashFlowSentinel.check({
      db: store, rawDb: db, metricSink: sink, teamId: ANCHOR, now: NOW,
    });
    console.log(`[SENTINEL] ok=${res.ok} degraded=${res.degraded} findings=${res.findings.length} org=${ANCHOR}`);
    expect(res.ok).toBe(true);
    expect(res.degraded).toBe(false); // 有数据 ⇒ 非降级（降级态在空输入反例里）

    // 直接 SQL 读真表（不经被测读口，作独立证据）
    const rows = db.prepare(
      'SELECT metric_id, value, unit, source_id FROM metric_readings WHERE org_id = ?',
    ).all(ANCHOR) as Array<{ metric_id: string; value: number; unit: string; source_id: string }>;
    console.log(`[METRIC] rows=${rows.length} metrics=${rows.map(r => r.metric_id).join(',')}`);
    expect(rows.length).toBeGreaterThanOrEqual(3); // 至少 net-margin/yoy/gross 三行（runway 本例有限也应有）

    // 期望值手算（变异 computeCashFlowMetrics ⇒ 必红）：
    const byId = new Map(rows.map(r => [r.metric_id, r]));
    //   netMargin = (300-100-30)/300 = 0.5666…
    expect(byId.get('CASH-FLOW-NET-MARGIN')?.value).toBeCloseTo(170 / 300, 9);
    //   grossMargin = (300-100)/300 = 0.6666…
    expect(byId.get('CASH-FLOW-GROSS-MARGIN')?.value).toBeCloseTo(200 / 300, 9);
    //   revenueYoY = (200-100)/100 = 1
    expect(byId.get('CASH-FLOW-REVENUE-YOY-GROWTH')?.value).toBeCloseTo(1, 9);
    //   runway（哨兵写点用的外层算法）= totalCash / (Σopex/count) = 180 / (30/2) = 12
    expect(byId.get('CASH-FLOW-RUNWAY-MONTHS')?.value).toBeCloseTo(12, 9);
    expect(byId.get('CASH-FLOW-NET-MARGIN')?.source_id).toBe('SENTINEL-CASH-FLOW-v1');
  });

  it('判据② [TREND]：GET /api/sentinel/metrics/readings?view=trends 可读到该指标（真 express + 真表）', async () => {
    const res = await fetch(`${base}/api/sentinel/metrics/readings?view=trends&days=7`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; count: number; summary: Array<{ metricId: string; latestValue: number | null; count: number }> };
    console.log(`[TREND] ok=${json.ok} count=${json.count}`);
    expect(json.ok).toBe(true);
    const nm = json.summary.find(s => s.metricId === 'CASH-FLOW-NET-MARGIN');
    expect(nm, 'trends 应含 CASH-FLOW-NET-MARGIN').toBeDefined();
    expect(nm!.latestValue).toBeCloseTo(170 / 300, 9);
    expect(nm!.count).toBeGreaterThanOrEqual(1);

    // 普通视图（非 trends）逐字段读回
    const plain = await fetch(`${base}/api/sentinel/metrics/readings?days=7&metricId=CASH-FLOW-NET-MARGIN`);
    const pj = (await plain.json()) as { ok: boolean; count: number; rows: Array<{ org_id: string; value: number; unit: string }> };
    expect(pj.ok).toBe(true);
    expect(pj.count).toBeGreaterThanOrEqual(1);
    expect(pj.rows.every(r => r.org_id === ANCHOR)).toBe(true); // 唯一锚点：库里只有本次写入的行
    expect(pj.rows[0].value).toBeCloseTo(170 / 300, 9);
    expect(pj.rows[0].unit).toBe('ratio');
  });

  it('判据③ [CYCLE]：computeOverflow 真算一次 ＋ 边界（空/单点/零分母/负值，禁 NaN 假值）', () => {
    const cycle: CycleConfig = {
      cycleId: 'm3-overflow', name: 'M3', description: '', version: '1.0.0',
      applicableIndustries: [],
      nodes: [
        { id: 'revenue', label: '营收', type: 'stock', initialValue: 100, unit: '万' },
        { id: 'reinvest', label: '再投资', type: 'flow', initialValue: 30, unit: '万' },
      ],
      edges: [{ from: 'revenue', to: 'reinvest', polarity: '+', weight: 0.5 }],
      overflowFormula: {
        condition: 'revenue > reinvest * 3', targetNode: 'reinvest',
        formula: '{{revenue}} * 0.3', minDataMaturity: 'medium',
      },
      dataMaturity: 'medium', mapping: [], crossCyclePropagation: [],
    };
    // 6 个月上升序列（80→100）⇒ rising；公式 100*0.3=30（变异 computeOverflow ⇒ 必红）
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const data: EnterpriseTimeSeries = {
      dataPoints: months.map((m, i) => ({ month: m, value: 80 + i * 4 })),
      currentNodeValues: { revenue: 100, reinvest: 30 },
      enterpriseId: 'm3-ent',
    };
    const snap = computeOverflow(cycle, data);
    console.log(`[CYCLE] overflowValue=${snap.overflowValue} trend=${snap.trendDirection} degraded=${snap.degraded}`);
    expect(snap.overflowValue).toBe(30); // 100 * 0.3，精确匹配（变异必红）
    expect(snap.trendDirection).toBe('rising');
    expect(snap.cycleId).toBe('m3-overflow');
    expect(snap.degraded).toBe(false);

    // 边界：空序列 ⇒ degraded 且无 NaN
    const empty = computeOverflow(cycle, { dataPoints: [], currentNodeValues: { revenue: 100 }, enterpriseId: 'e' });
    expect(empty.degraded).toBe(true);
    expect(Number.isFinite(empty.overflowValue)).toBe(true);
    expect(Number.isFinite(empty.momChangePercent)).toBe(true);
    // 边界：单点 ⇒ degraded
    const single = computeOverflow(cycle, { dataPoints: [{ month: '2026-10', value: 100 }], currentNodeValues: { revenue: 100 }, enterpriseId: 'e' });
    expect(single.degraded).toBe(true);
    // 边界：上期值为 0（零分母）⇒ momChangePercent = 0（禁 NaN/Infinity 假值）
    const zeroPrev = computeOverflow(cycle, {
      dataPoints: [{ month: '2026-09', value: 0 }, { month: '2026-10', value: 100 }],
      currentNodeValues: { revenue: 100 }, enterpriseId: 'e',
    });
    expect(Number.isFinite(zeroPrev.momChangePercent)).toBe(true);
    expect(zeroPrev.momChangePercent).toBe(0);
    // 边界：负值序列 ⇒ 全数值字段有限
    const neg = computeOverflow(cycle, {
      dataPoints: [{ month: '2026-09', value: -50 }, { month: '2026-10', value: -20 }],
      currentNodeValues: { revenue: -100 }, enterpriseId: 'e',
    });
    for (const v of [neg.overflowValue, neg.momChange, neg.momChangePercent]) {
      expect(Number.isFinite(v), `负值输入不得产生 NaN/Infinity（得 ${v}）`).toBe(true);
    }
  });

  it('判据④b [PARAM-④b]：决策台账写→读回逐字段匹配（真 store；不断言 kind——裁 227 Step 1 未做）', () => {
    const wdb = new Database(':memory:');
    const wstore = new SqliteGraphStore(wdb);
    wdb.prepare("INSERT INTO graph_nodes (graph, type, name, props) VALUES ('default', 'outcome/risk', 'n-m3', ?)")
      .run(JSON.stringify({ id: 'n-m3' })); // props 含 id（queryNodes 按 props 过滤，同 J5 集成测形态）
    const input: DecisionInput = {
      nodeId: 'n-m3', userId: 'u-m3', action: 'confirmed', role: 'm3-role',
      reason: 'm3-reason',
      context: { orgId: 'default', cycleId: 'm3-overflow', summary: 'm3-summary' },
      output: { kind: 'm3-artifact', ref: 'ref-m3', digest: 'digest-m3' },
      presetVersion: 1,
      review: { verdict: 'pass', by: 'u-m3', reason: 'm3-review' },
    };
    const wrote = captureDecision(wstore, 'default', input);
    console.log(`[PARAM-④b] recorded=${wrote.recorded} edgeType=${wrote.edgeType}`);
    expect(wrote.recorded).toBe(true);

    const read = listDecisionRows(wstore, { nodeId: 'n-m3' }, 'default');
    expect(read.ok).toBe(true);
    expect(read.entries.length).toBe(1);
    const row = read.entries[0].row;
    // 逐字段匹配（写什么读回什么）
    expect(row.who).toBe('u-m3');
    expect(row.role).toBe('m3-role');
    expect(row.output.ref).toBe('ref-m3');
    expect(row.output.digest).toBe('digest-m3');
    expect(row.presetVersion).toBe(1);
    expect(row.review.verdict).toBe('pass');
    expect(read.entries[0].edgeType).toBe('DECISION_CONFIRMED');
    expect(row.schema).toBe('decision-ledger/v1');
    expect(row.at).toBe(wrote.row.at);

    // 边界：读侧无 queryEdges ⇒ ok=false（显式降级，不静默空）
    const broken = listDecisionRows({ queryNodes: () => [] }, {}, 'default');
    expect(broken.ok).toBe(false);
    expect(broken.errors?.[0]).toContain('READ_PRIMITIVE_MISSING');
    wdb.close();
  });

  it('判据④c [PARAM-④c]：goal-lifecycle 三导出存在 ＋ @deprecated/#1010 标记在场 ＋ src/ 零调用点（存在≠实现）', () => {
    expect(typeof closeGoal).toBe('function');
    expect(typeof verifyEffect).toBe('function');
    expect(typeof transitionGoal).toBe('function');
    const src = readFileSync(join(repoRoot, 'src/growth/goal-lifecycle.ts'), 'utf-8');
    // 只认**文件头注释块**（前 20 行）且必须是独立 JSDoc 标注行（`* @deprecated`）——
    // 正文引用（如处置说明里提到"@deprecated 标注"）不算标记；去掉头部标注 ⇒ 必红
    const header = src.split('\n').slice(0, 20).join('\n');
    expect(header.match(/^\s*\*\s+@deprecated/m), '@deprecated 应为文件头 JSDoc 标注（去掉 ⇒ 必红）').not.toBeNull();
    expect(header, '#1010 接入点指针应在文件头（去掉 ⇒ 必红）').toContain('#1010');
    // src/ 零调用点：全 src 扫描，除模块自身外不得 import goal-lifecycle
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) { walk(p); continue; }
        if (!name.name.endsWith('.ts')) continue;
        if (p.endsWith(join('src/growth/goal-lifecycle.ts'))) continue;
        if (readFileSync(p, 'utf-8').match(/from\s+['"][^'"]*goal-lifecycle['"]/)) offenders.push(p);
      }
    };
    walk(join(repoRoot, 'src'));
    console.log(`[PARAM-④c] exports=3/3 marker=@deprecated+#1010 srcCallers=${offenders.length}`);
    expect(offenders, `src/ 内不得有 goal-lifecycle 调用点（命中：${offenders.join(',')}）`).toEqual([]);
  });

  it('判据④d [PARAM-④d]：calibrateThresholds 可调用且返回 not_implemented（合法通过态；存在≠实现）', () => {
    const r = calibrateThresholds('m3-industry');
    console.log(`[PARAM-④d] calibrated=${r.calibrated} status=${r.status}`);
    expect(r).toEqual({ calibrated: 0, status: 'not_implemented' });
  });
});
