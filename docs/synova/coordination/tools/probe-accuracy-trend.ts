#!/usr/bin/env npx tsx
/**
 * probe-accuracy-trend.ts — #1049（2-7 overall 准度计量口径）判据探针（裁定 045：probe-* 归能力面）
 *
 * 【overall 准度计量口径 v1】（唯一计量点 = 本文件 computeAccuracyTrend；口径全文见同目录 准度计量口径-v1.md）:
 *   · 取自哪段时序: metric_readings（#1053/2-1a 真表）中 org+metric 指定的日度序列，
 *     窗口 = 全部观测覆盖的 [首日, 末日]；前半窗 = early，后半窗 = late。
 *   · 与什么比: early 窗均值 vs late 窗均值（同口径同度量，前后对照）。
 *   · 结论怎么算出来: trend = late均值 - early均值；trend >= MIN_TREND(0.02) 且两个半窗样本各 >= MIN_HALF(5)
 *     且相邻观测日间隔全部 <= MAX_GAP_DAYS(3)（时序完整）=> verdict="valid"（"越用越准" <=> trend>0）。
 *     任一前提不成立 => verdict="invalid" 且 trend=null —— **不给结论**（禁假绿）。
 *
 * 契约（铁律 47）:
 *   @input  — 无入参。仓库根自 cwd 上溯定位（须含 src/store/migrations/002-metric-readings.ts）。
 *             全程只在 os.tmpdir() 写临时库（不在主树/主库写；生产模块只读 import）。
 *   @output — S1-S5 分段报告 + 末行 SUMMARY
 *   @exit   — 0 = 全部断言通过；1 = 断言失败（fail-closed）；2 = 未实现/依赖缺失（禁假绿）
 *
 * 断言段（禁止"跑通即过"）:
 *   S1 表定义接线 — 真实 reconcileSchema 建出 metric_readings（PRAGMA 实测 17 列，2-1a）
 *   S2 写入接线   — 真实 createMetricSink 落 28 天日度序列 + 幂等（重复日 written=false）+ 非降级行数核对（2-1b）
 *   S3 证据链     — computeAccuracyTrend 出具结论，链上三要素（时序段/对照/公式代入）逐项可打印
 *   S4 自证       — 脱离链函数、直接从 SQL 行独立重算 early/late 均值与 trend，与链结论逐位一致（纪律8）
 *   S5 抽段反例   — 删去中段 6 天（在临时库副本上）=> verdict 必为 invalid（理由含"缺口"）且 trend=null
 */
import { existsSync, mkdtempSync, rmSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';

const MARKER = join('src', 'store', 'migrations', '002-metric-readings.ts');
function locateRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, MARKER))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return '';
}

// ═══ 口径 v1 常量 ═══
const MIN_HALF = 5;
const MAX_GAP_DAYS = 3;
const MIN_TREND = 0.02;

export interface AccuracyRow { observedAt: string; value: number }
export interface AccuracyVerdict { verdict: 'valid' | 'invalid'; trend: number | null; earlyMean: number | null; lateMean: number | null; windowStart: string | null; windowEnd: string | null; sampleCount: number; reasons: string[] }

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** overall 准度趋势 —— 口径 v1（唯一计量点） */
export function computeAccuracyTrend(rows: AccuracyRow[]): AccuracyVerdict {
  const reasons: string[] = [];
  const sorted = [...rows].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const obs = sorted.filter(r => Number.isFinite(r.value));
  if (obs.length < MIN_HALF * 2) {
    reasons.push(`样本不足：${obs.length} 行 < 2×${MIN_HALF}`);
    return { verdict: 'invalid', trend: null, earlyMean: null, lateMean: null, windowStart: null, windowEnd: null, sampleCount: obs.length, reasons };
  }
  for (let i = 1; i < obs.length; i++) {
    const gap = dayDiff(obs[i - 1].observedAt, obs[i].observedAt);
    if (gap > MAX_GAP_DAYS) {
      reasons.push(`时序缺口：${obs[i - 1].observedAt} → ${obs[i].observedAt} 间隔 ${gap} 天 > ${MAX_GAP_DAYS}`);
    }
  }
  if (reasons.length > 0) {
    return { verdict: 'invalid', trend: null, earlyMean: null, lateMean: null, windowStart: obs[0].observedAt, windowEnd: obs[obs.length - 1].observedAt, sampleCount: obs.length, reasons };
  }
  const half = Math.floor(obs.length / 2);
  const early = obs.slice(0, half);
  const late = obs.slice(obs.length - half);
  const mean = (xs: AccuracyRow[]) => xs.reduce((s, x) => s + x.value, 0) / xs.length;
  const earlyMean = mean(early);
  const lateMean = mean(late);
  const trend = lateMean - earlyMean;
  if (early.length < MIN_HALF || late.length < MIN_HALF) {
    reasons.push('半窗样本不足');
    return { verdict: 'invalid', trend: null, earlyMean: null, lateMean: null, windowStart: obs[0].observedAt, windowEnd: obs[obs.length - 1].observedAt, sampleCount: obs.length, reasons };
  }
  return { verdict: trend >= MIN_TREND ? 'valid' : 'invalid', trend: trend >= MIN_TREND ? trend : null, earlyMean, lateMean, windowStart: obs[0].observedAt, windowEnd: obs[obs.length - 1].observedAt, sampleCount: obs.length, reasons: trend >= MIN_TREND ? [] : [`趋势不足：trend ${trend.toFixed(4)} < ${MIN_TREND}`] };
}

async function main(): Promise<number> {
  const root = locateRepoRoot();
  if (!root) { console.error('[NOT-IMPLEMENTED] 无法定位仓库根（缺 src/store/migrations/002-metric-readings.ts）'); return 2; }
  process.chdir(root);
  console.log('probe-self:', resolve('docs/synova/coordination/tools/probe-accuracy-trend.ts'), '（判据自证：本文件即计量点）');
  const fails: string[] = [];
  const ok = (m: string) => console.log('  [PASS] ' + m);
  const bad = (m: string) => { fails.push(m); console.log('  [FAIL] ' + m); };
  let tmp: string | null = null;
  try {
    const Database = (await import('better-sqlite3')).default;
    const { reconcileSchema } = await import(pathToFileURL(join(root, 'src/store/schema-migration.ts')).href);
    const { createMetricSink } = await import(pathToFileURL(join(root, 'src/sentinel/metric-readings-writer.ts')).href);
    tmp = mkdtempSync(join(tmpdir(), 'accuracy-trend-'));
    const dbPath = join(tmp, 'probe.db');
    const db = new Database(dbPath);

    // ── S1 表定义接线（2-1a）──
    reconcileSchema(db);
    const cols = db.prepare("PRAGMA table_info(metric_readings)").all() as Array<{ name: string }>;
    if (cols.length === 17) ok(`S1 reconcileSchema 建表 metric_readings，PRAGMA 实测 ${cols.length} 列（#1053 口径）`);
    else bad(`S1 列数 ${cols.length} != 17`);

    // ── S2 写入接线（2-1b，经真实 sink）──
    const sink = createMetricSink(db);
    const ORG = "probe-org";
    const METRIC = "OVERALL_F1";
    const base = Date.parse("2026-09-01T00:00:00Z");
    let written = 0;
    for (let d = 0; d < 28; d++) {
      const day = new Date(base + d * 86400000).toISOString().slice(0, 10);
      // 越用越准场景：日度 overall f1 由 0.55 线性爬升到 ~0.82（叠加 ±0.01 抖动）
      const v = Math.round((0.55 + (d / 27) * 0.27 + ((d % 3) - 1) * 0.005) * 1000) / 1000;
      const r = sink({ orgId: ORG, metricId: METRIC, value: v, observedAt: day, sourceType: "manual", unit: "ratio", sourceId: "probe-accuracy-trend", evidenceRef: "probe", runId: "probe-run", inputDigest: "digest-" + day, defVersion: "v1" });
      if (r.written && !r.degraded) written++;
    }
    const dup = sink({ orgId: ORG, metricId: METRIC, value: 0.9, observedAt: "2026-09-01", sourceType: "manual", unit: "ratio", sourceId: "x", evidenceRef: "x", runId: "r", inputDigest: "d", defVersion: "v1" });
    const dbRows = db.prepare("SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = ? AND metric_id = ? AND degraded = 0").get(ORG, METRIC) as { n: number };
    if (written === 28 && dup.written === false && dbRows.n === 28) ok(`S2 真实 sink 落 ${written} 行非降级 + 幂等（重复日 written=false）`);
    else bad(`S2 写入异常: written=${written} dup=${dup.written} rows=${dbRows.n}`);

    const rows = (db.prepare("SELECT observed_at AS observedAt, value FROM metric_readings WHERE org_id = ? AND metric_id = ? AND degraded = 0 ORDER BY observed_at").all(ORG, METRIC) as AccuracyRow[]);

    // ── S3 证据链 ──
    const chain = computeAccuracyTrend(rows);
    if (chain.verdict === "valid" && chain.trend !== null && chain.windowStart && chain.windowEnd && chain.reasons.length === 0) {
      ok(`S3 证据链成立：窗口 ${chain.windowStart}..${chain.windowEnd}（${chain.sampleCount} 行）｜对照 early=${chain.earlyMean?.toFixed(4)} vs late=${chain.lateMean?.toFixed(4)}｜公式 trend=late-early=${chain.trend?.toFixed(4)} ≥ ${MIN_TREND}`);
    } else bad(`S3 证据链不成立: ${JSON.stringify(chain)}`);

    // ── S4 自证（纪律8：独立重算一致）──
    const half = Math.floor(rows.length / 2);
    const m = (xs: AccuracyRow[]) => xs.reduce((s, x) => s + x.value, 0) / xs.length;
    const indepTrend = m(rows.slice(rows.length - half)) - m(rows.slice(0, half));
    if (chain.trend !== null && Math.abs(indepTrend - chain.trend) < 1e-12) ok(`S4 独立重算 trend=${indepTrend.toFixed(6)} 与链结论逐位一致（判据跑的是自己）`);
    else bad(`S4 独立重算不一致: indep=${indepTrend} chain=${chain.trend}`);

    // ── S5 抽段反例（副本上抽掉中段 6 天 ⇒ 证据链必须失效）──
    const copyPath = join(tmp, "probe-gap.db");
    copyFileSync(dbPath, copyPath);
    const db2 = new Database(copyPath);
    db2.prepare("DELETE FROM metric_readings WHERE org_id = ? AND metric_id = ? AND observed_at BETWEEN ? AND ?").run(ORG, METRIC, "2026-09-10", "2026-09-15");
    const rows2 = db2.prepare("SELECT observed_at AS observedAt, value FROM metric_readings WHERE org_id = ? AND metric_id = ? AND degraded = 0 ORDER BY observed_at").all(ORG, METRIC) as AccuracyRow[];
    const broken = computeAccuracyTrend(rows2);
    if (broken.verdict === "invalid" && broken.trend === null && broken.reasons.some(r => r.includes("时序缺口"))) {
      ok(`S5 抽掉中段 6 天 ⇒ 证据链失效：verdict=invalid trend=null reasons=${JSON.stringify(broken.reasons)}`);
    } else bad(`S5 抽段后仍给结论（假绿！）: ${JSON.stringify(broken)}`);

    db.close(); db2.close();
    if (fails.length > 0) { console.error(`SUMMARY: ${fails.length} 断言失败`); return 1; }
    console.log("SUMMARY: 准度计量口径探针全绿（S1-S5）");
    return 0;
  } catch (err) {
    console.error('[NOT-IMPLEMENTED] 探针自身异常:', err instanceof Error ? err.stack ?? err.message : String(err));
    return 2;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(code => { process.exit(code); }).catch(err => {
  console.error('[NOT-IMPLEMENTED]', err);
  process.exit(2);
});
