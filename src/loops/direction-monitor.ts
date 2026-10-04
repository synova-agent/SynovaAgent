/**
 * src/loops/direction-monitor.ts — 方向有效性监测 (D222 / D1143 参数层贯通)
 *
 * 附录 A v2.0 Gate 7 — 方向有效性监测。
 * 读取 42 边参数 + Goal 完成率 + 溢出状态 → 输出 direction_status。
 *
 * 契约:
 *   @input  — enterpriseId + EdgeStoreReader + 可选 MetricSeriesReader
 *   @output — DirectionReport { status, deviations[], warnings[], checkedAt }
 *   @degraded — 边参数不可用 → degraded + status=valid
 *
 * D1143 参数层贯通（把 computeEdgeBaseline 上那句"未来支持"注释变成代码）:
 *   · W2 — 预期范围不再恒为点基线 0.7：读边 `props.transfer_function`（结构化参数，
 *          **必须带 uncertainty**）→ 推导 [center ± kσ] 预期范围 → 偏离按 σ 归一化
 *          ⇒ "上次判错多少" 可算（deviationSigma）。
 *   · W1 — 同 (entity, metric) 的 ≥2 时序读数参与合成观测波动，进一步校准预期范围宽度。
 *   · 未标定（字段缺失 / 占位串 "TBD …" / 缺 uncertainty）→ 退回 DEFAULT_BASELINE 点基线，
 *     与 D1143 之前的行为逐位一致（零回归）。
 */
import { createLogger } from "@synova/logger";

const log = createLogger("loops/direction-monitor");

// ═══ 类型定义 ═══

/** 方向有效性状态 */
export type DirectionStatus = "valid" | "risk" | "invalid";

/** 维度分类 */
export type EdgeCategory = "capital" | "customer" | "talent";

/** 单条偏离记录 */
export interface EdgeDeviation {
  edgeId: string;
  edgeLabel: string;
  category: EdgeCategory;
  /** 当前值 (0-1 或权重) */
  currentValue: number;
  /** 基线值 — 即预期范围中心，保留 D222 原义 */
  baseline: number;
  /** 偏离百分比 — 越出预期范围的部分相对中心的比例 */
  deviationPercent: number;
  // ─── D1143 参数层追溯字段 ───
  /** 基线来源: transfer_function = 真读到参数; default = 未标定退回常量 */
  baselineSource: BaselineSource;
  /** 预期范围（由 transfer_function ± kσ 推导，可被时序观测波动加宽） */
  expectedRange: ExpectedRangeBounds;
  /** 生效的 1σ 不确定度（参数 σ 与观测波动合成）；无则 null */
  uncertainty: number | null;
  /** "上次判错多少" 的 σ 口径: 越界距离 / σ；无 σ 则 null */
  deviationSigma: number | null;
  /** 参与合成的时序读数条数（0 = 无时序数据） */
  seriesPoints: number;
}

/** 基线来源 */
export type BaselineSource = "transfer_function" | "default";

/** 预期范围边界 */
export interface ExpectedRangeBounds {
  low: number;
  high: number;
}

/**
 * 推导出的预期范围（D1143 内部结构）。
 * 未标定且无时序时 low=high=center（退化点基线，等价 D1143 之前）。
 */
export interface ExpectedRange extends ExpectedRangeBounds {
  /** 范围中心（= 推导基线） */
  center: number;
  /** 生效的 1σ（参数 σ 与观测波动合成）；无则 null */
  uncertainty: number | null;
  /** 中心来自参数还是退默认 */
  source: BaselineSource;
  /** 参与合成的时序读数条数 */
  seriesPoints: number;
}

/**
 * transfer_function 结构化参数（参数层契约, D1143）。
 *
 * 载体: EdgeStoreReader 返回边的 `props.transfer_function`（标定/进化回环写回的参数）。
 *
 * @input  — 标定产物: 期望值 + **不确定度(必填)** [+ 形式标签 + 样本量]
 * @output — 供 deriveExpectedRange() 推导 [expected ± kσ] 预期范围
 * @degraded — 缺 uncertainty / 非有限数 / 非 [0,1] → 判为不可用 → 退回 DEFAULT_BASELINE
 * @why uncertainty 必填 — 无不确定度则预期范围退化为点基线，
 *      "上次判错多少" 在数学上不可度量（本卡验收 ③）。
 */
export interface TransferFunctionParam {
  /** 期望值（标定点估计），0-1 健康度口径 */
  expected: number;
  /** 不确定度（1σ），标定残差标准差；必填且 > 0 */
  uncertainty: number;
  /** 函数形式标签（可追溯，如 "linear" / "exp_decay"） */
  form?: string;
  /** 标定样本量（置信度依据） */
  sampleSize?: number;
}

/**
 * 解析探测结果 — 区分"没标定"与"标定坏了"。
 * 前者是常态（当前 55 个 edge-type JSON 中 46 个为 TBD 占位），不告警；
 * 后者是数据缺陷，必须 log.warn + 进 warnings（铁律 11 静默降级禁止）。
 */
export type TransferFunctionProbe =
  | { kind: "absent" }
  | { kind: "placeholder" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; param: TransferFunctionParam };

/** 维度偏离统计 */
export interface CategoryDeviation {
  category: EdgeCategory;
  totalEdges: number;
  deviatedEdges: number;
  deviationRate: number; // 0-1
  deviations: EdgeDeviation[];
}

/** 方向监测报告 */
export interface DirectionReport {
  status: DirectionStatus;
  /** 越阈偏离记录（deviationPercent > THRESHOLD_RISK） */
  deviations: EdgeDeviation[];
  /**
   * 全部参与统计的边记录（含未越阈）— D1143 参数层可观测面。
   * 存在的理由: "上次判错多少" 必须对每条被跟踪的边都可度量，
   * 不能只在已越阈的边上才看得到 σ 口径偏差。
   */
  trackedEdges: EdgeDeviation[];
  categories: CategoryDeviation[];
  warnings: string[];
  checkedAt: string;
  degraded: boolean;
}

/** 边存储读取器 — 最小接口，避免直接耦合 L4 GraphStore */
export interface EdgeStoreReader {
  queryEdges(
    type?: string,
    from?: string,
    to?: string,
    graph?: string,
  ): Array<{
    id: string;
    type: string;
    from: string;
    to: string;
    weight: number;
    props: Record<string, unknown>;
  }>;
}

/** 单条测量值读数 */
export interface MetricReading {
  value: number;
  /** ISO-8601 观测时刻 */
  observedAt: string;
}

/**
 * 测量值时序读取器 — 最小接口，避免直接耦合 L5 SQLite (D1143 W1)。
 *
 * @input  — entityId + metric（本文件用边类型名作 metric）+ 可选条数上限
 * @output — 按 observedAt 升序的读数序列（无数据 → 空数组，不抛）
 * @degraded — 读取失败 → 空数组 + 调用方按"无时序"处理（序列缺失不阻断诊断）
 */
export interface MetricSeriesReader {
  readSeries(entityId: string, metric: string, limit?: number): MetricReading[];
}

// ═══ 常量 ═══

/**
 * 42+ 边类型分类映射 (资本/客户/人才)。
 * 基于 edge-types JSON 文件命名和 allowedFrom/allowedTo 语义。
 */
const EDGE_CLASSIFICATION: Record<string, EdgeCategory> = {
  // ── 资本 (Capital) ──
  capital_acquisition: "capital",
  capital_allocation: "capital",
  capital_source_mix: "capital",
  profit_reinvestment: "capital",
  funds: "capital",
  equipment_acquisition: "capital",
  efficiency_attraction: "capital",
  value_pricing: "capital",
  procurement_bargaining: "capital",
  assumption_triggered_reallocation: "capital",

  // ── 客户 (Customer) ──
  customer_lockin: "customer",
  customer_data_loop: "customer",
  brand_building: "customer",
  brand_builds: "customer",
  demand_to_spec: "customer",
  channel_delivery: "customer",
  service_support: "customer",
  reputation_attraction: "customer",
  reputation_flywheel: "customer",
  competitive_positioning: "customer",
  market_share_capture: "customer",

  // ── 人才 (Talent) ──
  talent_acquisition: "talent",
  talent_deployment: "talent",
  talent_filter: "talent",
  talent_retention: "talent",
  knowledge_reuse: "talent",
  knowledge_sharing: "talent",
  organizational_learning: "talent",
  cross_functional_synergy: "talent",
  decision_authority: "talent",
  decision_concentrates: "talent",
  incentive_alignment: "talent",
  incentive_binds: "talent",
  trust_friction_reduction: "talent",
};

const CATEGORY_NAMES: Record<EdgeCategory, string> = {
  capital: "资本",
  customer: "客户",
  talent: "人才",
};

const CATEGORY_EDGES = Object.keys(EDGE_CLASSIFICATION);

/** 判定阈值 */
const THRESHOLD_RISK = 0.3; // 30% 偏离 → risk
const THRESHOLD_INVALID = 0.5; // 50% 偏离 → invalid
const INVALID_CATEGORY_COUNT = 2; // 2+ 类别 ≥50% → invalid
const DEFAULT_BASELINE = 0.7; // 默认基线健康值（未标定时的退路）

/** D1143: 预期范围的 σ 倍数（1σ 覆盖带） */
const RANGE_SIGMA_FACTOR = 1;
/** D1143: 观测波动至少需要几个时序读数才纳入合成（< 2 无法算标准差） */
const MIN_SERIES_POINTS_FOR_VOLATILITY = 2;
/** D1143: 单次诊断每 (entity, metric) 最多读多少条读数 */
const METRIC_SERIES_LIMIT = 90;

/** 把数值钳制到 [0, 1] */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * 校验并解析 transfer_function 参数（参数层门禁, D1143）。
 *
 * @input  — 未知值（来自边 props.transfer_function）
 * @output — Probe: valid{param} | invalid{reason} | absent
 * @degraded — 缺 uncertainty / 非有限数 / expected 越界 → invalid（调用方退回默认基线 + 告警）
 * @why uncertainty 必填 — 无 σ 则"上次判错多少"不可度量（本卡验收 ③）
 */
export function parseTransferFunctionParam(raw: unknown): TransferFunctionProbe {
  if (raw === undefined || raw === null) return { kind: "absent" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "absent" }; // 串/其它标量 = 未标定，非坏数据
  }

  const obj = raw as Record<string, unknown>;
  const expected = obj["expected"];
  const uncertainty = obj["uncertainty"];

  if (typeof expected !== "number" || !Number.isFinite(expected)) {
    return { kind: "invalid", reason: "expected 缺失或非有限数" };
  }
  if (expected < 0 || expected > 1) {
    return { kind: "invalid", reason: `expected=${expected} 越界 [0,1]` };
  }
  if (typeof uncertainty !== "number" || !Number.isFinite(uncertainty)) {
    return { kind: "invalid", reason: "uncertainty 缺失或非有限数（无不确定度无法度量判错幅度）" };
  }
  if (uncertainty <= 0) {
    return { kind: "invalid", reason: `uncertainty=${uncertainty} 必须 > 0` };
  }

  const param: TransferFunctionParam = { expected, uncertainty };
  const form = obj["form"];
  if (typeof form === "string" && form.length > 0) param.form = form;
  const sampleSize = obj["sampleSize"];
  if (typeof sampleSize === "number" && Number.isFinite(sampleSize) && sampleSize > 0) {
    param.sampleSize = sampleSize;
  }
  return { kind: "valid", param };
}

/** 样本标准差 (n-1)；不足 2 点 → 0 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ═══ DirectionMonitor ═══

/**
 * 方向有效性监测器。
 *
 * 读取 42 边参数（通过 EdgeStoreReader）→ 按资本/客户/人才分类统计偏离率
 * → 输出 direction_status（valid/risk/invalid）。
 *
 * 判定规则:
 *   - 2+ 类别偏离率 ≥50% → invalid
 *   - 任一类别偏离率 ≥30% → risk
 *   - 全部 <30% → valid
 */
export class DirectionMonitor {
  private edgeStore: EdgeStoreReader | null;
  private metricSeries: MetricSeriesReader | null;

  constructor(edgeStore?: EdgeStoreReader, metricSeries?: MetricSeriesReader) {
    this.edgeStore = edgeStore ?? null;
    this.metricSeries = metricSeries ?? null;
  }

  /**
   * 执行方向有效性检查。
   *
   * @param enterpriseId — 企业 ID
   * @returns DirectionReport
   */
  async checkDirection(enterpriseId: string): Promise<DirectionReport> {
    const warnings: string[] = [];
    const checkedAt = new Date().toISOString();

    // ─── 降级: 无 EdgeStore → valid + degraded ───
    if (!this.edgeStore) {
      log.warn({ enterpriseId }, "EdgeStore 未注入 — 方向监测降级 (valid)");
      return {
        status: "valid",
        deviations: [],
        trackedEdges: [],
        categories: [],
        warnings: ["EdgeStore 未注入 — 使用降级模式"],
        checkedAt,
        degraded: true,
      };
    }

    // ─── 读取边数据 ───
    const allDeviations: EdgeDeviation[] = [];
    const trackedEdges: EdgeDeviation[] = [];
    const categoryBuckets: Record<EdgeCategory, EdgeDeviation[]> = {
      capital: [],
      customer: [],
      talent: [],
    };

    for (const edgeType of CATEGORY_EDGES) {
      const category = EDGE_CLASSIFICATION[edgeType];
      try {
        const edges = this.edgeStore.queryEdges(
          edgeType.toUpperCase(),
          undefined,
          undefined,
          enterpriseId,
        );

        // 只处理有实例的边 — 无实例的边不参与统计（非缺失数据降级）
        if (edges.length === 0) continue;

        const currentValue = this.computeEdgeCurrentValue(edges);

        // ─── D1143 W2: 读 transfer_function 参数 → 推导预期范围 ───
        const probe = this.probeTransferFunction(edges);
        if (probe.kind === "invalid") {
          // 标定产物存在但不可用 — 不静默吞（铁律 11）
          log.warn(
            { edgeType, reason: probe.reason },
            "transfer_function 参数不可用 — 退回默认基线",
          );
          warnings.push(`${edgeType}: transfer_function 参数不可用 (${probe.reason})`);
        } else if (probe.kind === "valid") {
          log.debug(
            { edgeType, expected: probe.param.expected, uncertainty: probe.param.uncertainty },
            "transfer_function 参数已生效",
          );
        }

        // ─── D1143 W1: 读同 (entity, metric) 时序 → 合成观测波动 ───
        const series = this.readMetricSeries(enterpriseId, edgeType, warnings);

        const range = this.deriveExpectedRange(probe, series);
        const { deviationPercent, deviationSigma } = this.computeDeviation(currentValue, range);

        const deviation: EdgeDeviation = {
          edgeId: edgeType,
          edgeLabel: edgeType.replace(/_/g, " "),
          category,
          currentValue,
          baseline: range.center,
          deviationPercent,
          baselineSource: range.source,
          expectedRange: { low: range.low, high: range.high },
          uncertainty: range.uncertainty,
          deviationSigma,
          seriesPoints: range.seriesPoints,
        };

        if (deviationPercent > THRESHOLD_RISK) {
          allDeviations.push(deviation);
        }
        categoryBuckets[category].push(deviation);
        trackedEdges.push(deviation);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, edgeType }, "边参数查询失败 — 跳过");
        warnings.push(`${edgeType}: 查询失败 (${msg})`);
      }
    }

    // ─── 按类别统计偏离率 ───
    const categories: CategoryDeviation[] = [];
    for (const cat of ["capital", "customer", "talent"] as EdgeCategory[]) {
      const bucket = categoryBuckets[cat];
      const deviated = bucket.filter((d) => d.deviationPercent > THRESHOLD_RISK);
      categories.push({
        category: cat,
        totalEdges: bucket.length,
        deviatedEdges: deviated.length,
        deviationRate: bucket.length > 0 ? deviated.length / bucket.length : 0,
        deviations: deviated,
      });
    }

    // ─── 判定 status ───
    const totalTrackedEdges = categories.reduce((s, c) => s + c.totalEdges, 0);

    // 无数据 → 降级
    if (totalTrackedEdges === 0) {
      log.warn({ enterpriseId }, "方向监测降级 — 无边实例数据");
      return {
        status: "valid",
        deviations: [],
        trackedEdges,
        categories,
        warnings: ["无边实例数据 — 使用降级模式"],
        checkedAt,
        degraded: true,
      };
    }

    const highDeviationCategories = categories.filter(
      (c) => c.deviationRate >= THRESHOLD_INVALID,
    );

    let status: DirectionStatus;
    if (highDeviationCategories.length >= INVALID_CATEGORY_COUNT) {
      status = "invalid";
      warnings.push(
        `方向可能已失效: ${highDeviationCategories.length} 个维度偏离率≥${THRESHOLD_INVALID * 100}%`,
      );
      log.warn(
        { enterpriseId, categories: highDeviationCategories.map((c) => c.category) },
        "方向无效 — 多维度严重偏离基线",
      );
    } else if (categories.some((c) => c.deviationRate >= THRESHOLD_RISK)) {
      status = "risk";
      log.warn(
        { enterpriseId, categories: categories.filter((c) => c.deviationRate >= THRESHOLD_RISK).map((c) => c.category) },
        "方向风险 — 存在偏离维度",
      );
    } else {
      status = "valid";
      log.info({ enterpriseId }, "方向有效 — 全部维度在基线范围内");
    }

    // ─── 写入系统日志 ───
    log.info(
      { enterpriseId, status, checkedAt, deviationCount: allDeviations.length },
      `方向监测完成: ${status}`,
    );

    return {
      status,
      deviations: allDeviations,
      trackedEdges,
      categories,
      warnings,
      checkedAt,
      degraded: false,
    };
  }

  // ─── 内部方法 ───

  /**
   * 计算边的当前值。
   * 从 GraphStore 返回的边数据中推导健康评分 (0-1)。
   * 有多条实例时取平均权重；无实例时默认 0（完全偏离）。
   */
  private computeEdgeCurrentValue(
    edges: Array<{ weight: number; props: Record<string, unknown> }>,
  ): number {
    if (edges.length === 0) return 0;
    // 取权重平均值，钳制到 [0, 1]
    const avg = edges.reduce((s, e) => s + (e.weight || 0), 0) / edges.length;
    return Math.max(0, Math.min(1, avg));
  }

  /**
   * 探测边实例上的 transfer_function 参数（D1143 W2 — 参数层入口）。
   *
   * @input  — 边实例数组（props.transfer_function 为标定产物）
   * @output — Probe: absent | placeholder | invalid{reason} | valid{param}
   * @degraded — 未标定(absent/placeholder) → 静默退默认；标定坏(invalid) → 调用方 log.warn + warnings
   */
  private probeTransferFunction(
    edges: Array<{ props: Record<string, unknown> }>,
  ): TransferFunctionProbe {
    let sawPlaceholder = false;
    let firstInvalid: string | null = null;

    for (const edge of edges) {
      const raw = edge.props ? edge.props["transfer_function"] : undefined;
      if (raw === undefined || raw === null) continue;

      // 人读串（"TBD — to be defined in compute phase" / 公式串）不是可用参数
      if (typeof raw === "string") {
        sawPlaceholder = true;
        continue;
      }

      const parsed = parseTransferFunctionParam(raw);
      if (parsed.kind === "valid") return parsed;
      if (parsed.kind === "invalid" && firstInvalid === null) firstInvalid = parsed.reason;
      if (parsed.kind === "absent") sawPlaceholder = true;
    }

    if (firstInvalid !== null) return { kind: "invalid", reason: firstInvalid };
    if (sawPlaceholder) return { kind: "placeholder" };
    return { kind: "absent" };
  }

  /**
   * 读同 (entity, metric) 的测量值时序（D1143 W1）。
   * metric 取边类型名（与 EDGE_CLASSIFICATION 的键同口径）。
   *
   * @input  — enterpriseId + metric + 条数上限
   * @output — MetricReading[]（无 reader / 无数据 / 读失败 → 空数组）
   * @degraded — 读失败 → 空数组 + log.warn + warnings（不阻断诊断，但可见）
   */
  private readMetricSeries(
    enterpriseId: string,
    metric: string,
    warnings: string[],
  ): MetricReading[] {
    if (!this.metricSeries) return [];
    try {
      const series = this.metricSeries.readSeries(enterpriseId, metric, METRIC_SERIES_LIMIT);
      return Array.isArray(series) ? series : [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, metric }, "测量值时序读取失败 — 按无时序处理");
      warnings.push(`${metric}: 时序读取失败 (${msg})`);
      return [];
    }
  }

  /**
   * 推导预期范围（D1143 — 把"未来支持从 transfer_function 推导预期范围"变成代码）。
   *
   * 中心 = transfer_function.expected，未标定则 DEFAULT_BASELINE；
   * 半宽 = kσ，σ = √(参数σ² + 观测波动σ²)（独立高斯合成）。
   *
   * @input  — Probe（参数）+ 时序读数
   * @output — { center, low, high, uncertainty, source, seriesPoints }
   * @degraded — 未标定且无时序 → center=low=high=DEFAULT_BASELINE（与 D1143 前逐位一致）
   */
  private deriveExpectedRange(
    probe: TransferFunctionProbe,
    series: MetricReading[],
  ): ExpectedRange {
    const hasParam = probe.kind === "valid";
    const center = hasParam ? probe.param.expected : DEFAULT_BASELINE;

    const usable = series.filter((r) => Number.isFinite(r.value));
    const hasVolatility = usable.length >= MIN_SERIES_POINTS_FOR_VOLATILITY;
    const observedSigma = hasVolatility ? standardDeviation(usable.map((r) => r.value)) : 0;

    const paramSigma = hasParam ? probe.param.uncertainty : 0;
    const uncertainty =
      paramSigma > 0 || observedSigma > 0
        ? Math.sqrt(paramSigma * paramSigma + observedSigma * observedSigma)
        : null;

    // 未标定且无时序 → 点基线（退化行为，等价 D1143 之前）
    if (uncertainty === null) {
      return {
        center,
        low: center,
        high: center,
        uncertainty: null,
        source: "default",
        seriesPoints: usable.length,
      };
    }

    const halfWidth = RANGE_SIGMA_FACTOR * uncertainty;
    return {
      center,
      low: clamp01(center - halfWidth),
      high: clamp01(center + halfWidth),
      uncertainty,
      source: hasParam ? "transfer_function" : "default",
      seriesPoints: usable.length,
    };
  }

  /**
   * 计算偏离（D1143 — 由"相对点基线"升级为"相对预期范围 + σ 口径"）。
   *
   * deviationPercent = 越界距离 / 中心（落在范围内 = 0）；中心为 0 且越界 → 1（原边界语义）。
   * deviationSigma   = 越界距离 / σ —— 即"上次判错多少"的可度量口径；无 σ 则 null。
   */
  private computeDeviation(
    currentValue: number,
    range: ExpectedRange,
  ): { deviationPercent: number; deviationSigma: number | null } {
    const excess =
      currentValue < range.low
        ? range.low - currentValue
        : currentValue > range.high
          ? currentValue - range.high
          : 0;

    let deviationPercent: number;
    if (excess === 0) {
      deviationPercent = 0;
    } else if (range.center > 0) {
      deviationPercent = excess / range.center;
    } else {
      deviationPercent = 1;
    }

    const deviationSigma =
      range.uncertainty !== null && range.uncertainty > 0 ? excess / range.uncertainty : null;

    return { deviationPercent, deviationSigma };
  }
}
