/**
 * tests/loops/direction-monitor.transfer-function.test.ts — D1143 W2 参数层消费者测试
 *
 * 本文件的任务不是"函数存在"，而是证明三件物理事实:
 *   ① 消费者在判断路径上（baselineSource 真从 default 翻成 transfer_function）
 *   ② 同一输入，有 transfer_function vs 无 ⇒ 输出**必须不同**（给对照）
 *   ③ 参数必须带不确定度（缺 uncertainty 即判不可用）——否则"上次判错多少"不可度量
 *
 * 另兼作 D222 存量行为的回归闸: 无参数路径必须与点基线 0.7 逐位一致。
 */
import { describe, it, expect } from "vitest";
import {
  DirectionMonitor,
  parseTransferFunctionParam,
  type EdgeStoreReader,
  type DirectionReport,
} from "../../src/loops/direction-monitor";

// ═══ 夹具 ═══

/**
 * 构造 Mock EdgeStore:
 *   weights[edgeType]  → 该边类型的权重列表
 *   params[edgeType]   → 写到每条实例 props.transfer_function 上的参数
 */
function mockStore(
  edgeWeights: Record<string, number[]>,
  params: Record<string, unknown> = {},
): EdgeStoreReader {
  return {
    queryEdges(type) {
      const key = (type || "").toLowerCase();
      const weights = edgeWeights[key] || [];
      const param = params[key];
      return weights.map((w, i) => ({
        id: `${key}-${i}`,
        type: key.toUpperCase(),
        from: "node-a",
        to: "node-b",
        weight: w,
        props: param === undefined ? {} : { transfer_function: param },
      }));
    },
  };
}

/** 给所有边统一权重 — 让对照只有一个自变量（参数） */
function uniformWeights(weight: number): Record<string, number[]> {
  const all = [
    "capital_acquisition", "capital_allocation", "capital_source_mix",
    "profit_reinvestment", "funds", "equipment_acquisition",
    "efficiency_attraction", "value_pricing", "procurement_bargaining",
    "assumption_triggered_reallocation",
    "customer_lockin", "customer_data_loop", "brand_building", "brand_builds",
    "demand_to_spec", "channel_delivery", "service_support",
    "reputation_attraction", "reputation_flywheel", "competitive_positioning",
    "market_share_capture",
    "talent_acquisition", "talent_deployment", "talent_filter", "talent_retention",
    "knowledge_reuse", "knowledge_sharing", "organizational_learning",
    "cross_functional_synergy", "decision_authority", "decision_concentrates",
    "incentive_alignment", "incentive_binds", "trust_friction_reduction",
  ];
  const out: Record<string, number[]> = {};
  for (const e of all) out[e] = [weight];
  return out;
}

const CAPITAL_EDGES = [
  "capital_acquisition", "capital_allocation", "capital_source_mix",
  "profit_reinvestment", "funds", "equipment_acquisition",
  "efficiency_attraction", "value_pricing", "procurement_bargaining",
  "assumption_triggered_reallocation",
];

/** 取某条边的参数层追溯记录（trackedEdges 含未越阈的边） */
function findDeviation(report: DirectionReport, edgeId: string) {
  return report.trackedEdges.find((d) => d.edgeId === edgeId) ?? null;
}

// ═══ 测试 ═══

describe("D1143 W2: transfer_function 消费者 — 参数改变输出", () => {
  // ════════════════════════════════════════════════════════════════════
  // ② 核心对照: 同一输入，有参数 vs 无参数 ⇒ 输出必须不同
  // ════════════════════════════════════════════════════════════════════

  it("② 同一输入: 无参数 → valid；有 transfer_function → risk（输出必须不同）", async () => {
    const weights = uniformWeights(0.5);

    // ── A: 无参数（未标定） ──
    const withoutParam = await new DirectionMonitor(mockStore(weights)).checkDirection("ent-1");

    // ── B: 同一权重，资本边带 transfer_function {expected:0.9, σ:0.05} ──
    const params: Record<string, unknown> = {};
    for (const e of CAPITAL_EDGES) params[e] = { expected: 0.9, uncertainty: 0.05, form: "linear" };
    const withParam = await new DirectionMonitor(
      mockStore(weights, params),
    ).checkDirection("ent-1");

    // ── 对照证据（失败时可直接看到差异） ──
    const contrast = {
      withoutParam: {
        status: withoutParam.status,
        deviations: withoutParam.deviations.length,
        capitalEdges: withoutParam.categories.find((c) => c.category === "capital"),
      },
      withParam: {
        status: withParam.status,
        deviations: withParam.deviations.length,
        capitalEdges: withParam.categories.find((c) => c.category === "capital"),
      },
    };
    console.log("[D1143 对照]", JSON.stringify(contrast, null, 2));

    // ── 硬断言: 输出必须不同 ──
    expect(withParam).not.toEqual(withoutParam);
    expect(withParam.status).not.toBe(withoutParam.status);
    expect(withoutParam.status).toBe("valid");
    expect(withParam.status).toBe("risk");
    expect(withoutParam.deviations.length).toBe(0);
    expect(withParam.deviations.length).toBe(CAPITAL_EDGES.length);

    // 同一输入（currentValue 相同）——自变量只有参数
    const capA = withoutParam.categories.find((c) => c.category === "capital")!;
    const capB = withParam.categories.find((c) => c.category === "capital")!;
    expect(capA.deviations[0]).toBeUndefined();
    expect(capB.deviations[0].currentValue).toBeCloseTo(0.5, 10);
    expect(capB.deviations[0].baseline).toBeCloseTo(0.9, 10); // 基线被参数改写
  });

  it("② 参数反向对照: 预期范围被 σ 加宽 → 同一权重下假警报消失（valid ← risk）", async () => {
    // 只有资本维度偏离，避免触发"2+ 类别 ≥50% → invalid"
    const weights = uniformWeights(0.7);
    for (const e of CAPITAL_EDGES) weights[e] = [0.2];

    const withoutParam = await new DirectionMonitor(mockStore(weights)).checkDirection("ent-2");

    // 中心不变(0.7)，但 σ=0.6 把预期范围加宽到 [0.1, 1.0] → 0.2 落带内
    const params: Record<string, unknown> = {};
    for (const e of CAPITAL_EDGES) params[e] = { expected: 0.7, uncertainty: 0.6 };
    const withParam = await new DirectionMonitor(
      mockStore(weights, params),
    ).checkDirection("ent-2");

    console.log("[D1143 对照·加宽]", JSON.stringify({
      without: { status: withoutParam.status, deviations: withoutParam.deviations.length },
      with: { status: withParam.status, deviations: withParam.deviations.length },
    }));

    expect(withoutParam.status).toBe("risk");
    expect(withParam.status).toBe("valid");
    expect(withoutParam.deviations.length).toBe(CAPITAL_EDGES.length);
    expect(withParam.deviations.length).toBe(0);
  });

  // ════════════════════════════════════════════════════════════════════
  // ① 消费者在判断路径上 — 可追溯字段翻面
  // ════════════════════════════════════════════════════════════════════

  it("① baselineSource 真翻面: default → transfer_function（不是注释/静态可达）", async () => {
    const weights = { capital_acquisition: [0.1] };

    const withoutParam = await new DirectionMonitor(mockStore(weights)).checkDirection("ent-3");
    const withParam = await new DirectionMonitor(
      mockStore(weights, { capital_acquisition: { expected: 0.9, uncertainty: 0.05 } }),
    ).checkDirection("ent-3");

    // 同一 currentValue，两条记录都在 deviations 里 → 可直接逐字段对照
    const a = findDeviation(withoutParam, "capital_acquisition");
    const b = findDeviation(withParam, "capital_acquisition");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.currentValue).toBeCloseTo(b!.currentValue, 10);

    // 无参数: 退默认点基线，无 σ
    expect(a!.baselineSource).toBe("default");
    expect(a!.baseline).toBeCloseTo(0.7, 10);
    expect(a!.expectedRange.low).toBeCloseTo(0.7, 10);
    expect(a!.expectedRange.high).toBeCloseTo(0.7, 10);
    expect(a!.uncertainty).toBeNull();
    expect(a!.deviationSigma).toBeNull();

    // 有参数: 真读到 → 来源翻面 + 范围/σ 落到输出上
    expect(b!.baselineSource).toBe("transfer_function");
    expect(b!.expectedRange.low).toBeCloseTo(0.85, 10);
    expect(b!.expectedRange.high).toBeCloseTo(0.95, 10);
    expect(b!.uncertainty).toBeCloseTo(0.05, 10);
    expect(b!.deviationSigma).not.toBeNull();

    // 输出必须不同（同一输入）
    expect(a!.baseline).not.toBeCloseTo(b!.baseline, 10);
    expect(a!.deviationPercent).not.toBeCloseTo(b!.deviationPercent, 10);
  });

  // ════════════════════════════════════════════════════════════════════
  // ③ 参数必须带不确定度 — 否则"上次判错多少"不可算
  // ════════════════════════════════════════════════════════════════════

  it("③ deviationSigma 可算: 越界距离/σ = 7σ（'上次判错多少'的度量口径）", async () => {
    const weights = { capital_acquisition: [0.5] };
    const report = await new DirectionMonitor(
      mockStore(weights, { capital_acquisition: { expected: 0.9, uncertainty: 0.05 } }),
    ).checkDirection("ent-4");

    const d = findDeviation(report, "capital_acquisition");
    expect(d).not.toBeNull();
    // 越界 = 0.5 - (0.9 - 0.05) = 0.5 - 0.85 = 0.35；0.35 / 0.05 = 7
    expect(d!.deviationSigma).toBeCloseTo(7, 10);
    expect(d!.deviationPercent).toBeCloseTo(0.35 / 0.9, 10);
    expect(d!.uncertainty).toBeCloseTo(0.05, 10);
  });

  it("③ 缺 uncertainty ⇒ 判为不可用 + 退回默认基线 + 告警（不静默吞）", async () => {
    const weights = { capital_acquisition: [0.5] };
    // 有 expected 但无 uncertainty —— 典型"未标定完的半成品参数"
    const report = await new DirectionMonitor(
      mockStore(weights, { capital_acquisition: { expected: 0.9 } }),
    ).checkDirection("ent-5");

    const cat = report.categories.find((c) => c.category === "capital")!;
    // 退回默认 0.7 点基线 → 偏离 0.2857 < 0.3 → 不计偏离
    expect(cat.deviations.length).toBe(0);
    expect(report.status).toBe("valid");
    // 但坏参数必须可见（铁律 11）
    expect(report.warnings.some((w) => w.includes("transfer_function 参数不可用"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("uncertainty"))).toBe(true);
  });

  it("③ parseTransferFunctionParam 边界: 越界/非有限/σ≤0 → invalid；缺失 → absent", () => {
    expect(parseTransferFunctionParam(undefined).kind).toBe("absent");
    expect(parseTransferFunctionParam(null).kind).toBe("absent");
    expect(parseTransferFunctionParam("TBD — to be defined in compute phase").kind).toBe("absent");
    expect(parseTransferFunctionParam(0.9).kind).toBe("absent");
    expect(parseTransferFunctionParam([]).kind).toBe("absent");

    expect(parseTransferFunctionParam({ expected: 1.5, uncertainty: 0.1 }).kind).toBe("invalid");
    expect(parseTransferFunctionParam({ expected: -0.1, uncertainty: 0.1 }).kind).toBe("invalid");
    expect(parseTransferFunctionParam({ expected: 0.5, uncertainty: NaN }).kind).toBe("invalid");
    expect(parseTransferFunctionParam({ expected: 0.5, uncertainty: 0 }).kind).toBe("invalid");
    expect(parseTransferFunctionParam({ expected: 0.5, uncertainty: -0.1 }).kind).toBe("invalid");
    expect(parseTransferFunctionParam({ expected: Number.POSITIVE_INFINITY, uncertainty: 0.1 }).kind).toBe("invalid");
    expect(parseTransferFunctionParam({ uncertainty: 0.1 }).kind).toBe("invalid");

    const ok = parseTransferFunctionParam({ expected: 0.6, uncertainty: 0.12, form: "linear", sampleSize: 30 });
    expect(ok.kind).toBe("valid");
    if (ok.kind === "valid") {
      expect(ok.param.expected).toBeCloseTo(0.6, 10);
      expect(ok.param.uncertainty).toBeCloseTo(0.12, 10);
      expect(ok.param.form).toBe("linear");
      expect(ok.param.sampleSize).toBe(30);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 降级 / 回归: 未标定路径必须与 D222 逐位一致
  // ════════════════════════════════════════════════════════════════════

  it("降级: 占位串 'TBD …' ⇒ 静默退回默认（未标定是常态，不刷告警）", async () => {
    const weights = { capital_acquisition: [0.1] };
    const report = await new DirectionMonitor(
      mockStore(weights, { capital_acquisition: "TBD — to be defined in compute phase" }),
    ).checkDirection("ent-6");

    const d = findDeviation(report, "capital_acquisition");
    expect(d).not.toBeNull();
    expect(d!.baselineSource).toBe("default");
    expect(d!.baseline).toBeCloseTo(0.7, 10);
    expect(d!.deviationPercent).toBeCloseTo(0.6 / 0.7, 10); // 与 D222 同式
    expect(d!.uncertainty).toBeNull(); // 未标定 ⇒ 无 σ
    expect(d!.deviationSigma).toBeNull();
    expect(report.warnings.some((w) => w.includes("transfer_function 参数不可用"))).toBe(false);
  });

  it("回归: 未标定时点基线语义与 D222 逐位一致（0.7 基线 → 0% 偏离）", async () => {
    const weights = uniformWeights(0.7);
    const report = await new DirectionMonitor(mockStore(weights)).checkDirection("ent-7");

    expect(report.status).toBe("valid");
    expect(report.deviations.length).toBe(0);
    expect(report.degraded).toBe(false);
    for (const cat of report.categories) {
      expect(cat.deviationRate).toBe(0);
    }
  });
});
