/**
 * lib/measurement-trends.ts — M4「测量值＋趋势」取数 loader（真 fetch，base 可注入）
 *
 * 设计哲学：一个分离 ＋ 两条承诺 —— 取数（本文件）与展示（MeasurementTrendSection）彻底分离，
 *   承诺 ① **永不抛**（一切失败转 degraded view，铁律 11/31）；
 *   承诺 ② **永不编数**（形状非法即降级，不猜、不补默认值）。
 *
 * 契约（铁律 47）:
 *   @input   base?: string — API 源。缺省 getApiBase()（Electron serverUrl；浏览器 dev 走 vite proxy
 *            的相对路径 ''）。测试注入真 express/base（禁 mock 冒充真调）。
 *   @input   orgId?: string | null — 企业作用域；非空 ⇒ 追加 &orgId=<encodeURIComponent>；null/undefined/'' ⇒ 不带
 *   @output  MeasurementTrendsView { ok, degraded, summary: MetricTrendItem[], errors? }
 *            summary 字段语义逐项对齐服务端 MetricTrendSummary
 *            （src/sentinel/metric-readings-reader.ts:59-69；只读复用，不新增 API 字段）。
 *   @degraded !res.ok ／ 响应非合法 JSON ／ 形状非法（根非对象、缺 summary 数组、summary 项缺字段）
 *            ／ 网络异常 ⇒ { ok:false, degraded:true, summary:[], errors:['<CODE>: <原因>'] }，
 *            并 console.warn 留痕；服务端 ok:false ⇒ 原样透传 degraded + errors（summary 置空：
 *            不确定的数据不交给渲染层）。
 *            400 ⇒ 走 METRIC_TRENDS_HTTP_ERROR，errors 保留 status
 *   @authority 只读 GET /api/sentinel/metrics/readings?view=trends；调用方仅渲染进程
 *            （MeasurementTrendContainer / 验收件）。不写 metric_readings、不做标定、不引新依赖。
 *   @not-here 不做写侧/参数标定；不重建报告链；不做轮询、缓存、重试（容器只取一次）。
 *
 * 已知限制（DSH 代码标准 C）:
 *   · 不暴露 days/limit/metricId 查询参数（M4 只要默认窗口的「测量值＋趋势」；扩参须另批）。
 *   · 无超时/AbortController —— 上游挂死时容器停在 loading（不白屏，但也不自动降级）。
 *   · 趋势方向是客户端由 changeRatio 推导（规格 §7.4：API 出正式 trend 字段后改读该字段）。
 *   · errors 为字符串数组（L2 冻结契约）⇒ 错误码以 `<CODE>: ` 前缀携带，不改变字段类型。
 *   · renderer 侧只证明「真 fetch 命中真路由＋渲染树结构」，不证明像素/交互视觉（规格 §7.3）。
 */
import { getApiBase } from './api';

/** 趋势方向（由 changeRatio 推导，不读服务端额外字段） */
export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

/** loader 降级原因分类（铁律 32：错误带 code，不以裸字符串混同） */
export type MeasurementTrendsErrorCode =
  | 'METRIC_TRENDS_HTTP_ERROR'
  | 'METRIC_TRENDS_NETWORK_ERROR'
  | 'METRIC_TRENDS_INVALID_JSON'
  | 'METRIC_TRENDS_INVALID_SHAPE'
  | 'METRIC_TRENDS_SERVER_DEGRADED';

/** 单指标趋势摘要（与服务端 MetricTrendSummary 同形） */
export interface MetricTrendItem {
  metricId: string;
  entityId: string;
  unit: string | null;
  count: number;
  latestAt: string;
  latestValue: number | null;
  previousValue: number | null;
  changeRatio: number | null;
}

/** loader 输出视图（ok=false 时 summary 必为空数组，errors 必非空） */
export interface MeasurementTrendsView {
  ok: boolean;
  degraded: boolean;
  summary: MetricTrendItem[];
  errors?: string[];
}

/** 趋势端点（相对 API 源；view=trends 是本批唯一消费的形态） */
const TRENDS_PATH = '/api/sentinel/metrics/readings?view=trends';

/** 趋势区口径版本（与上游导出口径对齐；展示层消费同一常量，禁在组件内另写一份字面量） */
export const TREND_SEMANTICS_VERSION = 'cost0-v1';
/** 已知限制文案（规格 §5.2 逐字；展示层在任何 state 恒显示在标题下） */
export const TREND_SEMANTICS_NOTE = '已知限制：本区只显示已落库的真实读数（不补数、不猜数）。当前口径 cost0-v1——上游导出不含营业成本，毛利率/净利率为公式产物，与客户账本可能不一致。';

/**
 * 趋势方向推导。
 * @param changeRatio - (latest - previous) / |previous|；null ⇒ 不可比
 * @returns 'up'（>0）／'down'（<0）／'flat'（===0）／'unknown'（null 或非有限数）
 */
export function deriveTrendDirection(changeRatio: number | null): TrendDirection {
  if (changeRatio === null || !Number.isFinite(changeRatio)) return 'unknown';
  if (changeRatio > 0) return 'up';
  if (changeRatio < 0) return 'down';
  return 'flat';
}

/** typed error：内部校验失败用，在 loadMeasurementTrends 边界统一转 degraded（铁律 32） */
class MeasurementTrendsError extends Error {
  readonly code: MeasurementTrendsErrorCode;

  constructor(code: MeasurementTrendsErrorCode, message: string) {
    super(message);
    this.name = 'MeasurementTrendsError';
    this.code = code;
  }

  /** 供 errors: string[] 消费的稳定形态（code 前置，便于日志/断言分类） */
  format(): string {
    return `${this.code}: ${this.message}`;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 失败 → 降级视图（唯一出口：保证 console.warn 留痕，铁律 11） */
function degrade(code: MeasurementTrendsErrorCode, message: string): MeasurementTrendsView {
  const error = new MeasurementTrendsError(code, message);
  console.warn(`[measurement-trends] 降级 — ${error.format()}`);
  return { ok: false, degraded: true, summary: [], errors: [error.format()] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function requireString(record: Record<string, unknown>, field: string, where: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', `${where}.${field} 应为 string`);
  }
  return value;
}

function requireNullableString(record: Record<string, unknown>, field: string, where: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', `${where}.${field} 应为 string|null`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, field: string, where: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', `${where}.${field} 应为有限 number`);
  }
  return value;
}

function requireNullableNumber(record: Record<string, unknown>, field: string, where: string): number | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', `${where}.${field} 应为 number|null`);
  }
  return value;
}

/** summary 单项校验（缺字段 / 类型不符 ⇒ INVALID_SHAPE，不做默认值填充） */
function parseMetricTrendItem(raw: unknown, index: number): MetricTrendItem {
  const where = `summary[${index}]`;
  if (!isRecord(raw)) {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', `${where} 不是对象`);
  }
  const fields = ['metricId', 'entityId', 'unit', 'count', 'latestAt', 'latestValue', 'previousValue', 'changeRatio'];
  for (const field of fields) {
    if (!hasField(raw, field)) {
      throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', `${where} 缺字段 ${field}`);
    }
  }
  return {
    metricId: requireString(raw, 'metricId', where),
    entityId: requireString(raw, 'entityId', where),
    unit: requireNullableString(raw, 'unit', where),
    count: requireNumber(raw, 'count', where),
    latestAt: requireString(raw, 'latestAt', where),
    latestValue: requireNullableNumber(raw, 'latestValue', where),
    previousValue: requireNullableNumber(raw, 'previousValue', where),
    changeRatio: requireNullableNumber(raw, 'changeRatio', where),
  };
}

/** 服务端 errors 透传（非字符串项剔除；全缺 ⇒ 标为 SERVER_DEGRADED） */
function parseServerErrors(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const kept = raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (kept.length > 0) return kept;
  }
  return [new MeasurementTrendsError('METRIC_TRENDS_SERVER_DEGRADED', '服务端 ok=false 且未给出可读原因').format()];
}

/** 响应体 → 视图（ok=true 才逐项校验；形状非法抛 typed error，由 loader 转降级） */
function normalizeView(payload: unknown): MeasurementTrendsView {
  if (!isRecord(payload)) {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', '响应根应为对象');
  }
  if (!hasField(payload, 'ok') || typeof payload.ok !== 'boolean') {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', '响应缺 boolean 字段 ok');
  }
  if (payload.ok === false) {
    return {
      ok: false,
      degraded: typeof payload.degraded === 'boolean' ? payload.degraded : true,
      summary: [],
      errors: parseServerErrors(payload.errors),
    };
  }
  if (!Array.isArray(payload.summary)) {
    throw new MeasurementTrendsError('METRIC_TRENDS_INVALID_SHAPE', '响应缺 summary 数组');
  }
  return { ok: true, degraded: false, summary: payload.summary.map(parseMetricTrendItem) };
}

/** API 源（缺省 getApiBase；尾部斜杠剥除以避免双斜杠） */
function resolveBase(base: string | undefined): string {
  const raw = base === undefined ? getApiBase() : base;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * 真调 `GET {base}/api/sentinel/metrics/readings?view=trends` 并返回测量值＋趋势视图。
 * @param base - API 源；缺省 getApiBase()（Electron serverUrl / dev proxy）
 * @param orgId - 企业作用域；非空 ⇒ 追加 &orgId=<encodeURIComponent(orgId)>；null/undefined/'' ⇒ 不带
 * @returns MeasurementTrendsView —— 永不抛：任何失败均为 ok=false + degraded=true + errors
 */
export async function loadMeasurementTrends(base?: string, orgId?: string | null): Promise<MeasurementTrendsView> {
  const scope = typeof orgId === 'string' && orgId !== '' ? `&orgId=${encodeURIComponent(orgId)}` : '';
  const url = `${resolveBase(base)}${TRENDS_PATH}${scope}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    return degrade('METRIC_TRENDS_NETWORK_ERROR', `GET ${url} 网络异常：${errorMessage(err)}`);
  }

  if (!response.ok) {
    return degrade('METRIC_TRENDS_HTTP_ERROR', `GET ${url} → HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err: unknown) {
    return degrade('METRIC_TRENDS_INVALID_JSON', `GET ${url} 响应非合法 JSON：${errorMessage(err)}`);
  }

  let view: MeasurementTrendsView;
  try {
    view = normalizeView(payload);
  } catch (err: unknown) {
    if (err instanceof MeasurementTrendsError) return degrade(err.code, err.message);
    return degrade('METRIC_TRENDS_INVALID_SHAPE', `GET ${url} 响应形状非法：${errorMessage(err)}`);
  }

  if (!view.ok) {
    // 服务端显式降级 ⇒ 原样透传内容，但同样留痕（铁律 11：不静默）
    console.warn(`[measurement-trends] 服务端降级 — ${(view.errors ?? []).join(' | ')}`);
  }
  return view;
}
