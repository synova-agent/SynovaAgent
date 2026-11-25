import { getApiBase } from './api';
import { CUSTOMER_TEXT } from './words';

export interface ScanManifestItem {
  manifestId: string;
  displayName: string;
}

export interface ScanErrorView {
  kind: 'error';
  httpStatus: number;
  code: string;
  phase: string;
  retryable: boolean;
  message: string;
}

export interface ScanDegradedView {
  kind: 'degraded';
  reason: string;
  httpStatus?: number;
  code?: string;
  phase?: string;
  retryable?: boolean;
}

export type ManifestListViewData =
  | { kind: 'manifests'; items: ScanManifestItem[] }
  | ScanErrorView
  | ScanDegradedView;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ScanSource {
  source_id: string;
  evidence_id: string;
  evidence_version_id: string;
  format: string;
  sha256: string;
  size: number;
  observed_at: string;
  period: string | null;
  valid_from: string | null;
  valid_to: string | null;
  visibility: string;
  evidence_status: string;
  instance_state: string;
}

export interface ScanCheckEntry {
  status: string;
  source_id?: string;
  source_ref?: string;
  businessKey?: string;
  field?: string;
  valid_to?: string | null;
  values?: JsonValue[];
}

export interface ScanDashboardCheck {
  period: string;
  metric: string;
  calculated: number | null;
  dashboard: number | null;
  calculation_match: boolean | null;
  difference: number | null;
}

export interface ScanOntologyObject {
  type: string;
  businessKey: string;
  name: string;
  validFrom: string;
  object_id: string;
}

export interface ScanOntologyRelation {
  type: string;
  businessKey: string;
  fromBusinessKey: string;
  toBusinessKey: string;
  validFrom: string;
  object_id: string;
  from: string;
  to: string;
}

export interface ScanAssertion {
  assertion_id: string;
  assertion_version_id: string;
  target: { kind: string; type: string; businessKey: string };
  field: string;
  assertion_kind: string;
  assertion_type: string;
  value: JsonValue;
  unit: string | null;
  denominator: string | null;
  evidence_status: string;
  instance_state: string;
  defVersion: string | null;
  formulaRef: string | null;
  valid_from: string | null;
  valid_to: string | null;
  evidence: Array<{ evidenceVersionId: string; sourceRef: string }>;
}

export interface ScanEvidenceGap {
  unknown_id: string;
  question: string;
  source_ref: string;
  field: string;
  period: string | null;
  blocking: boolean;
}

export interface ScanSupplementRequest {
  unknown_id: string;
  required_source: string;
  field: string;
  period: string | null;
  recompute: string;
}

export interface ScanReport {
  schema_version: 'enterprise-scan/v1';
  run: {
    run_id: string;
    graph: string;
    operation: string;
    status: string;
    manifest_id: string;
    client_request_id: string;
  };
  sources: ScanSource[];
  checks: {
    source_internal: ScanCheckEntry[];
    dashboard: ScanDashboardCheck[];
    cross_source: ScanCheckEntry[];
  };
  ontology: { objects: ScanOntologyObject[]; relations: ScanOntologyRelation[] };
  assertions: ScanAssertion[];
  evidence_gaps: ScanEvidenceGap[];
  supplement_requests: ScanSupplementRequest[];
  partial_visibility: boolean;
}

export type ScanViewData =
  | { kind: 'report'; report: ScanReport; replayed: boolean }
  | ScanErrorView
  | ScanDegradedView;

export interface ScanRequestOptions {
  base?: string;
  fetchImpl?: typeof fetch;
}

type ResponseRead =
  | { kind: 'response'; response: Response; payload: unknown }
  | ScanDegradedView;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveBase(base: string | undefined): string {
  const raw = base === undefined ? getApiBase() : base;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function degrade(
  reason: string,
  details: Omit<Partial<ScanDegradedView>, 'kind' | 'reason'> = {},
): ScanDegradedView {
  console.warn(`[enterprise-scan] ${reason}`);
  return { kind: 'degraded', reason, ...details };
}

function required(record: Record<string, unknown>, field: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) throw new Error(`缺字段 ${field}`);
  return record[field];
}

function text(record: Record<string, unknown>, field: string): string {
  const value = required(record, field);
  if (typeof value !== 'string') throw new Error(`${field} 应为 string`);
  return value;
}

function nullableText(record: Record<string, unknown>, field: string): string | null {
  const value = required(record, field);
  if (value !== null && typeof value !== 'string') throw new Error(`${field} 应为 string|null`);
  return value;
}

function finiteNumber(record: Record<string, unknown>, field: string): number {
  const value = required(record, field);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} 应为有限 number`);
  return value;
}

function nullableNumber(record: Record<string, unknown>, field: string): number | null {
  const value = required(record, field);
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${field} 应为 number|null`);
  return value;
}

function bool(record: Record<string, unknown>, field: string): boolean {
  const value = required(record, field);
  if (typeof value !== 'boolean') throw new Error(`${field} 应为 boolean`);
  return value;
}

function nullableBool(record: Record<string, unknown>, field: string): boolean | null {
  const value = required(record, field);
  if (value !== null && typeof value !== 'boolean') throw new Error(`${field} 应为 boolean|null`);
  return value;
}

function objectField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = required(record, field);
  if (!isRecord(value)) throw new Error(`${field} 应为对象`);
  return value;
}

function arrayField(record: Record<string, unknown>, field: string): unknown[] {
  const value = required(record, field);
  if (!Array.isArray(value)) throw new Error(`${field} 应为数组`);
  return value;
}

function objectItem(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where} 应为对象`);
  return value;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (isRecord(value)) {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonValue(item);
    return output;
  }
  throw new Error('数据格式不符合约定');
}

function optionalText(record: Record<string, unknown>, field: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) return undefined;
  return text(record, field);
}

function optionalNullableText(record: Record<string, unknown>, field: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) return undefined;
  return nullableText(record, field);
}

function parseCheckEntry(value: unknown): ScanCheckEntry {
  const raw = objectItem(value, 'check');
  const output: ScanCheckEntry = { status: text(raw, 'status') };
  const sourceId = optionalText(raw, 'source_id');
  const sourceRef = optionalText(raw, 'source_ref');
  const businessKey = optionalText(raw, 'businessKey');
  const field = optionalText(raw, 'field');
  const validTo = optionalNullableText(raw, 'valid_to');
  if (sourceId !== undefined) output.source_id = sourceId;
  if (sourceRef !== undefined) output.source_ref = sourceRef;
  if (businessKey !== undefined) output.businessKey = businessKey;
  if (field !== undefined) output.field = field;
  if (validTo !== undefined) output.valid_to = validTo;
  if (Object.prototype.hasOwnProperty.call(raw, 'values')) {
    const values = required(raw, 'values');
    if (!Array.isArray(values)) throw new Error('数据格式不符合约定');
    output.values = values.map(jsonValue);
  }
  return output;
}

function parseSource(value: unknown): ScanSource {
  const raw = objectItem(value, 'source');
  return {
    source_id: text(raw, 'source_id'), evidence_id: text(raw, 'evidence_id'),
    evidence_version_id: text(raw, 'evidence_version_id'), format: text(raw, 'format'),
    sha256: text(raw, 'sha256'), size: finiteNumber(raw, 'size'), observed_at: text(raw, 'observed_at'),
    period: nullableText(raw, 'period'), valid_from: nullableText(raw, 'valid_from'),
    valid_to: nullableText(raw, 'valid_to'), visibility: text(raw, 'visibility'),
    evidence_status: text(raw, 'evidence_status'), instance_state: text(raw, 'instance_state'),
  };
}

function parseDashboardCheck(value: unknown): ScanDashboardCheck {
  const raw = objectItem(value, 'dashboard check');
  return {
    period: text(raw, 'period'), metric: text(raw, 'metric'), calculated: nullableNumber(raw, 'calculated'),
    dashboard: nullableNumber(raw, 'dashboard'), calculation_match: nullableBool(raw, 'calculation_match'),
    difference: nullableNumber(raw, 'difference'),
  };
}

function parseObject(value: unknown): ScanOntologyObject {
  const raw = objectItem(value, 'ontology object');
  return {
    type: text(raw, 'type'), businessKey: text(raw, 'businessKey'), name: text(raw, 'name'),
    validFrom: text(raw, 'validFrom'), object_id: text(raw, 'object_id'),
  };
}

function parseRelation(value: unknown): ScanOntologyRelation {
  const raw = objectItem(value, 'ontology relation');
  return {
    type: text(raw, 'type'), businessKey: text(raw, 'businessKey'),
    fromBusinessKey: text(raw, 'fromBusinessKey'), toBusinessKey: text(raw, 'toBusinessKey'),
    validFrom: text(raw, 'validFrom'), object_id: text(raw, 'object_id'),
    from: text(raw, 'from'), to: text(raw, 'to'),
  };
}

function parseAssertion(value: unknown): ScanAssertion {
  const raw = objectItem(value, 'assertion');
  const target = objectField(raw, 'target');
  return {
    assertion_id: text(raw, 'assertion_id'), assertion_version_id: text(raw, 'assertion_version_id'),
    target: { kind: text(target, 'kind'), type: text(target, 'type'), businessKey: text(target, 'businessKey') },
    field: text(raw, 'field'), assertion_kind: text(raw, 'assertion_kind'), assertion_type: text(raw, 'assertion_type'),
    value: jsonValue(required(raw, 'value')), unit: nullableText(raw, 'unit'), denominator: nullableText(raw, 'denominator'),
    evidence_status: text(raw, 'evidence_status'), instance_state: text(raw, 'instance_state'),
    defVersion: nullableText(raw, 'defVersion'), formulaRef: nullableText(raw, 'formulaRef'),
    valid_from: nullableText(raw, 'valid_from'), valid_to: nullableText(raw, 'valid_to'),
    evidence: arrayField(raw, 'evidence').map(item => {
      const evidence = objectItem(item, 'assertion evidence');
      return { evidenceVersionId: text(evidence, 'evidenceVersionId'), sourceRef: text(evidence, 'sourceRef') };
    }),
  };
}

function parseGap(value: unknown): ScanEvidenceGap {
  const raw = objectItem(value, 'evidence gap');
  return {
    unknown_id: text(raw, 'unknown_id'), question: text(raw, 'question'), source_ref: text(raw, 'source_ref'),
    field: text(raw, 'field'), period: nullableText(raw, 'period'), blocking: bool(raw, 'blocking'),
  };
}

function parseSupplement(value: unknown): ScanSupplementRequest {
  const raw = objectItem(value, 'supplement request');
  return {
    unknown_id: text(raw, 'unknown_id'), required_source: text(raw, 'required_source'),
    field: text(raw, 'field'), period: nullableText(raw, 'period'), recompute: text(raw, 'recompute'),
  };
}

function parseReport(payload: unknown): ScanReport {
  if (!isRecord(payload) || payload.schema_version !== 'enterprise-scan/v1') throw new Error(CUSTOMER_TEXT.dataVersionMismatch);
  const run = objectField(payload, 'run');
  const checks = objectField(payload, 'checks');
  const ontology = objectField(payload, 'ontology');
  return {
    schema_version: 'enterprise-scan/v1',
    run: {
      run_id: text(run, 'run_id'), graph: text(run, 'graph'), operation: text(run, 'operation'),
      status: text(run, 'status'), manifest_id: text(run, 'manifest_id'), client_request_id: text(run, 'client_request_id'),
    },
    sources: arrayField(payload, 'sources').map(parseSource),
    checks: {
      source_internal: arrayField(checks, 'source_internal').map(parseCheckEntry),
      dashboard: arrayField(checks, 'dashboard').map(parseDashboardCheck),
      cross_source: arrayField(checks, 'cross_source').map(parseCheckEntry),
    },
    ontology: {
      objects: arrayField(ontology, 'objects').map(parseObject),
      relations: arrayField(ontology, 'relations').map(parseRelation),
    },
    assertions: arrayField(payload, 'assertions').map(parseAssertion),
    evidence_gaps: arrayField(payload, 'evidence_gaps').map(parseGap),
    supplement_requests: arrayField(payload, 'supplement_requests').map(parseSupplement),
    partial_visibility: bool(payload, 'partial_visibility'),
  };
}

function parseManifests(payload: unknown): ScanManifestItem[] {
  if (!isRecord(payload) || payload.schema_version !== 'enterprise-scan-manifests/v1') throw new Error(CUSTOMER_TEXT.dataVersionMismatch);
  const seen = new Set<string>();
  return arrayField(payload, 'manifests').map(value => {
    const raw = objectItem(value, 'manifest');
    const manifestId = text(raw, 'manifest_id');
    const displayName = text(raw, 'display_name');
    if (manifestId.length === 0 || displayName.length === 0 || seen.has(manifestId)) throw new Error('清单 id 为空或重复');
    seen.add(manifestId);
    return { manifestId, displayName };
  });
}

async function readJson(
  url: string,
  init: RequestInit,
  options: ScanRequestOptions,
  unknownResult: boolean,
): Promise<ResponseRead> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    return degrade(`${unknownResult ? '结果状态未知，将使用原请求编号核对；' : ''}${CUSTOMER_TEXT.serviceUnavailable}（网络异常：${messageOf(error)}）`, { retryable: true });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return degrade(`${unknownResult ? '结果状态未知，将使用原请求编号核对；' : ''}${CUSTOMER_TEXT.dataUnrecognized}（原文：${messageOf(error)}）`, {
      httpStatus: response.status,
      retryable: true,
    });
  }
  return { kind: 'response', response, payload };
}

function normalizeError(payload: unknown, httpStatus: number, unknownResult: boolean): ScanErrorView | ScanDegradedView {
  if (httpStatus !== 404 && isRecord(payload) && payload.ok === false
    && typeof payload.code === 'string' && typeof payload.message === 'string'
    && typeof payload.phase === 'string' && typeof payload.retryable === 'boolean') {
    const details = {
      httpStatus,
      code: payload.code,
      phase: payload.phase,
      retryable: payload.retryable,
    };
    if (httpStatus >= 500) {
      return degrade(`${unknownResult ? '结果状态未知，将使用原请求编号核对；' : '服务读取失败；'}${payload.message}`, details);
    }
    return { kind: 'error', message: payload.message, ...details };
  }
  return degrade(`${unknownResult ? '结果状态未知，将使用原请求编号核对；' : ''}${CUSTOMER_TEXT.serviceUnavailable}（状态码 ${httpStatus}）`, {
    httpStatus,
    retryable: httpStatus >= 500,
  });
}

/**
 * @input 可选 API base 与 fetchImpl；身份由服务端认证链决定，不接收角色或 seed。
 * @output 服务端顺序的清单、typed error 或 degraded；空数组只在合法 200 返回。
 * @degraded 网络、非 JSON、非法形状、重复 id、意外 404 与 5xx 均 warn＋degraded。
 * @authority 可见清单完全由 GET /api/enterprise-scan/manifests 的服务端授权决定。
 * @not-here 不过滤、排序、去重、计数，不发送 x-synova-token，不发起扫描。
 * @error 永不抛；401/403 等合法错误信封保留 httpStatus/code/phase/retryable。
 */
export async function loadManifests(options: ScanRequestOptions = {}): Promise<ManifestListViewData> {
  const read = await readJson(`${resolveBase(options.base)}/api/enterprise-scan/manifests`, { method: 'GET', headers: {} }, options, false);
  if (read.kind === 'degraded') return read;
  if (!read.response.ok) return normalizeError(read.payload, read.response.status, false);
  if (read.response.status !== 200) return degrade(`清单响应状态非法：${read.response.status}`, { httpStatus: read.response.status });
  try {
    return { kind: 'manifests', items: parseManifests(read.payload) };
  } catch (error) {
    return degrade(`清单响应形状非法：${messageOf(error)}`, { httpStatus: 200 });
  }
}

/**
 * @input 当前清单中的 manifestId、持久 clientRequestId，以及可选 base/fetchImpl。
 * @output 201 新报告或 200 原键重放报告；typed error 或结果未知 degraded。
 * @degraded 网络、非 JSON、非法报告与 5xx 不声称未写入，提示使用原请求编号核对。
 * @authority 服务端重新校验授权、材料和幂等；loader 不把旧清单当权限凭证。
 * @not-here 不生成或更换幂等键，不读取 seed，不发送自报身份头，不做进度或取消。
 * @error 永不抛；400/401/403/409/415/422 保留完整服务端错误信封。
 */
export async function startScan(manifestId: string, clientRequestId: string, options: ScanRequestOptions = {}): Promise<ScanViewData> {
  if (manifestId.trim() === '' || clientRequestId.trim() === '') {
    return { kind: 'error', httpStatus: 400, code: 'VALIDATION_ERROR', phase: 'request', retryable: false, message: CUSTOMER_TEXT.analysisStartFailed };
  }
  const read = await readJson(`${resolveBase(options.base)}/api/enterprise-scan/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan_manifest_id: manifestId, client_request_id: clientRequestId }),
  }, options, true);
  if (read.kind === 'degraded') return read;
  if (!read.response.ok) return normalizeError(read.payload, read.response.status, true);
  if (read.response.status !== 200 && read.response.status !== 201) {
    return degrade(`结果状态未知，将使用原请求编号核对；扫描响应状态非法：${read.response.status}`, { httpStatus: read.response.status, retryable: true });
  }
  try {
    return { kind: 'report', report: parseReport(read.payload), replayed: read.response.status === 200 };
  } catch (error) {
    return degrade(`结果状态未知，将使用原请求编号核对；报告形状非法：${messageOf(error)}`, { httpStatus: read.response.status, retryable: true });
  }
}

/**
 * @input 已知 runId 与可选 base/fetchImpl。
 * @output 完整白名单报告、typed error 或 degraded；GET 成功 replayed=false。
 * @degraded 网络、非 JSON、非法嵌套、意外 404 与 5xx 均 warn＋degraded，不补字段。
 * @authority 运行可见性和报告内容由服务端决定；runId 只做 URL 编码。
 * @not-here 不推断运行状态，不生成新扫描，不接 SSE/DSH，不发送自报身份头。
 * @error 永不抛；合法非 2xx 错误信封保留状态，非法报告不进入成功槽。
 */
export async function getScan(runId: string, options: ScanRequestOptions = {}): Promise<ScanViewData> {
  if (runId.trim() === '') {
    return { kind: 'error', httpStatus: 400, code: 'VALIDATION_ERROR', phase: 'request', retryable: false, message: CUSTOMER_TEXT.analysisStartFailed };
  }
  const read = await readJson(`${resolveBase(options.base)}/api/enterprise-scan/runs/${encodeURIComponent(runId)}`, { method: 'GET', headers: {} }, options, false);
  if (read.kind === 'degraded') return read;
  if (!read.response.ok) return normalizeError(read.payload, read.response.status, false);
  if (read.response.status !== 200) return degrade(`报告响应状态非法：${read.response.status}`, { httpStatus: read.response.status });
  try {
    return { kind: 'report', report: parseReport(read.payload), replayed: false };
  } catch (error) {
    return degrade(`报告刷新失败：${messageOf(error)}`, { httpStatus: 200, retryable: true });
  }
}
