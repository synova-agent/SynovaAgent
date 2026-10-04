/**
 * tests/loops/direction-monitor.metric-series.integration.test.ts — D1143 W1 时序表测试
 *
 * 真 SQLite（:memory:），不 mock 管线（铁律 12）。证明两件物理事实:
 *   ④ 同一 (entity, metric) 的 ≥2 时间点读数**被代码真读**，且影响输出
 *   ⑤ 落库后重跑同一诊断 ⇒ 输出**必须不同**（否则说明没真读）
 *
 * 反例自证: 表空时读取器确实被调用（调用计数 > 0），但输出与"不注入读取器"逐位一致
 * —— 证明差异来自数据，不是来自读取器存在本身。
 */
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  ensureMetricReadingsTable,
  recordMetricReading,
  readMetricSeries,
  createMetricSeriesReader,
} from "../../src/init/engine-context";
import {
  DirectionMonitor,
  type EdgeStoreReader,
  type DirectionReport,
} from "../../src/loops/direction-monitor";

// ═══ 夹具 ═══

const EDGE = "capital_acquisition";
const ENTITY = "ent-metric-1";

/** 单条资本边固定权重 0.45 —— 无参数时相对 0.7 点基线偏离 0.357 > 0.3 ⇒ risk */
function singleEdgeStore(weight = 0.45): EdgeStoreReader {
  return {
    queryEdges(type) {
      const key = (type || "").toLowerCase();
      if (key !== EDGE) return [];
      return [
        {
          id: `${key}-0`,
          type: key.toUpperCase(),
          from: "node-a",
          to: "node-b",
          weight,
          props: {},
        },
      ];
    },
  };
}

/** 带调用计数的读取器 —— 自证"真被调用" */
function countingReader(db: Database.Database) {
  const inner = createMetricSeriesReader(db);
  let calls = 0;
  return {
    reader: {
      readSeries(entityId: string, metric: string, limit?: number) {
        calls += 1;
        return inner.readSeries(entityId, metric, limit);
      },
    },
    calls: () => calls,
  };
}

/** 样本标准差 (n-1) —— 测试内独立算，不复用被测实现 */
function sampleStd(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1),
  );
}

/** 从 trackedEdges（含未越阈）里取该边的参数层追溯记录 */
function capitalDeviation(report: DirectionReport) {
  return report.trackedEdges.find((d) => d.edgeId === EDGE) ?? null;
}

// ═══ 生命周期 ═══

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  ensureMetricReadingsTable(db);
  return db;
}

afterEach(() => {
  if (db) {
    db.close();
    db = null;
  }
});

// ═══ 测试 ═══

describe("D1143 W1: 测量值时序 — 同 (entity, metric) 序列真读且改变输出", () => {
  // ════════════════════════════════════════════════════════════════════
  // ⑤ 核心: 落库后重跑同一诊断 ⇒ 输出必须不同
  // ════════════════════════════════════════════════════════════════════

  it("⑤ 落库后重跑同一诊断 ⇒ 输出必须不同（真读时序，不是静态可达）", async () => {
    const database = freshDb();

    // ── 第 1 次: 表空 → 无时序 → 点基线 0.7 → 偏离 0.357 → risk ──
    const before = await new DirectionMonitor(
      singleEdgeStore(),
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);

    // ── 落库: 同一 (entity, metric) 的 3 个时间点读数 ──
    const values = [0.45, 0.75, 0.45];
    const times = ["2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"];
    values.forEach((v, i) => {
      recordMetricReading(database, {
        entityId: ENTITY,
        metric: EDGE,
        value: v,
        observedAt: times[i],
        source: "test",
      });
    });

    // ── 第 2 次: 同一输入，只多了时序数据 ──
    const after = await new DirectionMonitor(
      singleEdgeStore(),
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);

    console.log("[D1143 W1 对照]", JSON.stringify({
      before: {
        status: before.status,
        deviations: before.deviations.length,
        deviation: capitalDeviation(before),
      },
      after: {
        status: after.status,
        deviations: after.deviations.length,
        deviation: capitalDeviation(after),
      },
    }, null, 2));

    // ── 硬断言: 输出必须不同 ──
    expect(after).not.toEqual(before);
    expect(before.status).toBe("risk");
    expect(after.status).toBe("valid");
    expect(before.deviations.length).toBe(1);
    expect(after.deviations.length).toBe(0);

    // 差异真的来自时序（边界被观测波动加宽）
    const sigma = sampleStd(values); // ≈ 0.1732
    const catBefore = before.categories.find((c) => c.category === "capital")!;
    const catAfter = after.categories.find((c) => c.category === "capital")!;
    expect(catBefore.deviations[0].seriesPoints).toBe(0);
    expect(catBefore.deviations[0].expectedRange).toEqual({ low: 0.7, high: 0.7 });

    expect(catAfter.totalEdges).toBe(1);
    expect(catAfter.deviationRate).toBe(0);
  });

  // ════════════════════════════════════════════════════════════════════
  // ④ ≥2 时间点读数被真读 + 影响输出
  // ════════════════════════════════════════════════════════════════════

  it("④ 同一 (entity, metric) 的 3 个时间点被真读: seriesPoints=3 且预期范围按观测波动加宽", async () => {
    const database = freshDb();
    const values = [0.45, 0.75, 0.45];
    values.forEach((v, i) => {
      recordMetricReading(database, {
        entityId: ENTITY,
        metric: EDGE,
        value: v,
        observedAt: `2026-10-0${i + 1}T00:00:00Z`,
      });
    });

    // 读出序列本身（DB 层往返）
    const series = readMetricSeries(database, ENTITY, EDGE);
    expect(series.length).toBe(3);
    expect(series.map((p) => p.value)).toEqual(values);
    // 时序语义: 旧 → 新
    expect(series[0].observedAt < series[2].observedAt).toBe(true);

    // 端到端: 序列进了诊断
    const report = await new DirectionMonitor(
      singleEdgeStore(),
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);

    const cat = report.categories.find((c) => c.category === "capital")!;
    // 偏离 0.1097 < 0.3 → 不进 deviations，但预期范围必被加宽
    expect(cat.deviationRate).toBe(0);
    expect(report.status).toBe("valid");

    // 用另一组夹具取到偏差记录内的追溯字段
    const wideStore: EdgeStoreReader = singleEdgeStore(0.2);
    const report2 = await new DirectionMonitor(
      wideStore,
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);
    const d2 = capitalDeviation(report2);
    expect(d2).not.toBeNull();
    expect(d2!.seriesPoints).toBe(3);

    const sigma = sampleStd(values);
    expect(d2!.uncertainty).toBeCloseTo(sigma, 10);
    expect(d2!.expectedRange.low).toBeCloseTo(0.7 - sigma, 10);
    expect(d2!.expectedRange.high).toBeCloseTo(0.7 + sigma, 10);
    expect(d2!.baselineSource).toBe("default"); // 中心仍来自默认基线
    expect(d2!.deviationSigma).not.toBeNull(); // 有 σ ⇒ "上次判错多少"可算

    // 未越阈的边也必须可度量（trackedEdges 存在理由）
    const belowThreshold = capitalDeviation(report)!; // 0.45 落加宽后的带内 → 未越阈
    expect(belowThreshold).not.toBeNull();
    expect(belowThreshold.seriesPoints).toBe(3);
    expect(belowThreshold.uncertainty).toBeCloseTo(sigma, 10);
    expect(report.deviations.length).toBe(0); // 不在越阈清单里
    expect(report.trackedEdges.length).toBe(1); // 但在可观测面里
  });

  it("④ 时序 + transfer_function 合成: σ = √(σ_param² + σ_obs²)", async () => {
    const database = freshDb();
    const values = [0.45, 0.75, 0.45];
    values.forEach((v, i) => {
      recordMetricReading(database, {
        entityId: ENTITY,
        metric: EDGE,
        value: v,
        observedAt: `2026-10-0${i + 1}T00:00:00Z`,
      });
    });

    const paramStore: EdgeStoreReader = {
      queryEdges(type) {
        const key = (type || "").toLowerCase();
        if (key !== EDGE) return [];
        return [
          {
            id: `${key}-0`,
            type: key.toUpperCase(),
            from: "node-a",
            to: "node-b",
            weight: 0.45,
            props: { transfer_function: { expected: 0.9, uncertainty: 0.05, form: "linear" } },
          },
        ];
      },
    };

    const report = await new DirectionMonitor(
      paramStore,
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);
    const d = capitalDeviation(report);
    expect(d).not.toBeNull();

    const sigmaObs = sampleStd(values);
    const expectedSigma = Math.sqrt(0.05 * 0.05 + sigmaObs * sigmaObs);

    expect(d!.baselineSource).toBe("transfer_function");
    expect(d!.baseline).toBeCloseTo(0.9, 10); // 中心来自参数
    expect(d!.seriesPoints).toBe(3);
    expect(d!.uncertainty).toBeCloseTo(expectedSigma, 10); // 两路 σ 合成
    expect(d!.deviationSigma).toBeCloseTo(
      (0.9 - expectedSigma - 0.45) / expectedSigma,
      10,
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // 反例自证: 空表 ⇒ 读取器真被调用，但输出与"不注入读取器"逐位一致
  // ════════════════════════════════════════════════════════════════════

  it("反例自证: 表空时读取器被调用但零影响（差异来自数据，不是读取器存在）", async () => {
    const database = freshDb();
    const { reader, calls } = countingReader(database);

    const noReader = await new DirectionMonitor(singleEdgeStore()).checkDirection(ENTITY);
    const emptyReader = await new DirectionMonitor(singleEdgeStore(), reader).checkDirection(ENTITY);

    expect(calls()).toBeGreaterThan(0); // 真被调用（34 个边类型）
    expect(emptyReader.deviations).toEqual(noReader.deviations);
    expect(emptyReader.status).toBe(noReader.status);
    const d = capitalDeviation(emptyReader)!;
    expect(d.seriesPoints).toBe(0);
    expect(d.uncertainty).toBeNull();
    expect(d.expectedRange).toEqual({ low: 0.7, high: 0.7 });
  });

  // ════════════════════════════════════════════════════════════════════
  // 边界 / 降级
  // ════════════════════════════════════════════════════════════════════

  it("边界: 单点读数 (n=1) 不参与合成 — 无法算标准差，seriesPoints=1 且 σ 仍 null", async () => {
    const database = freshDb();
    recordMetricReading(database, {
      entityId: ENTITY,
      metric: EDGE,
      value: 0.45,
      observedAt: "2026-10-01T00:00:00Z",
    });

    const report = await new DirectionMonitor(
      singleEdgeStore(),
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);
    const d = capitalDeviation(report)!;

    expect(d.seriesPoints).toBe(1);
    expect(d.uncertainty).toBeNull();
    expect(d.expectedRange).toEqual({ low: 0.7, high: 0.7 });
    expect(report.status).toBe("risk"); // 单点不改变判定
  });

  it("边界: 不同 entity / 不同 metric 的读数互不串台", async () => {
    const database = freshDb();
    for (const [entity, metric] of [
      [ENTITY, EDGE],
      ["other-entity", EDGE],
      [ENTITY, "capital_allocation"],
    ]) {
      recordMetricReading(database, {
        entityId: entity,
        metric,
        value: 0.5,
        observedAt: "2026-10-01T00:00:00Z",
      });
      recordMetricReading(database, {
        entityId: entity,
        metric,
        value: 0.9,
        observedAt: "2026-10-02T00:00:00Z",
      });
    }

    // 目标 (ENTITY, EDGE) 只有 2 条，其它组合不掺进来
    const series = readMetricSeries(database, ENTITY, EDGE);
    expect(series.length).toBe(2);

    const report = await new DirectionMonitor(
      singleEdgeStore(),
      createMetricSeriesReader(database),
    ).checkDirection(ENTITY);
    const d = capitalDeviation(report)!;
    expect(d.seriesPoints).toBe(2);
  });

  it("降级: 读取器抛错 ⇒ 按无时序处理 + 告警可见（不静默吞，不阻断诊断）", async () => {
    const brokenReader = {
      readSeries(): never {
        throw new Error("db gone");
      },
    };

    const report = await new DirectionMonitor(singleEdgeStore(), brokenReader).checkDirection(ENTITY);

    expect(report.degraded).toBe(false); // 诊断照跑
    expect(report.status).toBe("risk"); // 退化为无时序判定
    expect(report.warnings.some((w) => w.includes("时序读取失败"))).toBe(true);
    const d = capitalDeviation(report)!;
    expect(d.seriesPoints).toBe(0);
    expect(d.uncertainty).toBeNull();
  });

  it("DB 层: limit 取最近 N 条并按时间升序返回", async () => {
    const database = freshDb();
    for (let i = 0; i < 5; i += 1) {
      recordMetricReading(database, {
        entityId: ENTITY,
        metric: EDGE,
        value: i / 10,
        observedAt: `2026-10-0${i + 1}T00:00:00Z`,
      });
    }

    const all = readMetricSeries(database, ENTITY, EDGE);
    expect(all.length).toBe(5);
    expect(all.map((p) => p.value)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);

    const recent2 = readMetricSeries(database, ENTITY, EDGE, 2);
    expect(recent2.length).toBe(2);
    expect(recent2.map((p) => p.value)).toEqual([0.3, 0.4]); // 最近 2 条，升序
  });
});
