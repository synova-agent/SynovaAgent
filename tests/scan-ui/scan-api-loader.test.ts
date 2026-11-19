import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getScan,
  loadManifests,
  startScan,
  type ScanReport,
} from '../../electron-renderer/src/lib/enterprise-scan-api';

function reportFixture(): ScanReport {
  return {
    schema_version: 'enterprise-scan/v1',
    run: {
      run_id: 'run-a', graph: 'org-a', operation: 'enterprise-scan', status: 'completed',
      manifest_id: 'manifest-a', client_request_id: 'request-a',
    },
    sources: [{
      source_id: 'source-public', evidence_id: 'evidence-public', evidence_version_id: 'version-public',
      format: 'csv', sha256: 'abc123', size: 42, observed_at: '2026-11-01T00:00:00.000Z',
      period: '2026-10', valid_from: '2026-10-01', valid_to: null,
      visibility: 'restricted', evidence_status: 'confirmed', instance_state: 'measured',
    }],
    checks: {
      source_internal: [{ source_id: 'source-public', source_ref: 'batches.csv#L2', businessKey: 'batch:a', field: 'accepted_count', status: 'conflict', valid_to: null, values: [8, 9] }],
      dashboard: [{ period: '2026-10', metric: 'accepted_count', calculated: 8, dashboard: 9, calculation_match: false, difference: 1 }],
      cross_source: [{ status: 'conflict', businessKey: 'batch:a', field: 'accepted_count', values: [8, 9] }],
    },
    ontology: {
      objects: [{ type: 'activity/delivery_batch', businessKey: 'batch:a', name: '批次 A', validFrom: '2026-10-01', object_id: 'object-a' }],
      relations: [{ type: 'edge/team_executes_activity', businessKey: 'team:a->batch:a', fromBusinessKey: 'team:a', toBusinessKey: 'batch:a', validFrom: '2026-10-01', object_id: 'relation-a', from: 'team-id', to: 'batch-id' }],
    },
    assertions: [{
      assertion_id: 'assertion-a', assertion_version_id: 'assertion-version-a',
      target: { kind: 'node', type: 'activity/delivery_batch', businessKey: 'batch:a' },
      field: 'accepted_count', assertion_kind: 'direct', assertion_type: 'fact', value: 8,
      unit: 'count', denominator: null, evidence_status: 'confirmed', instance_state: 'measured',
      defVersion: 'delivery-v1', formulaRef: null, valid_from: '2026-10-01', valid_to: null,
      evidence: [{ evidenceVersionId: 'version-public', sourceRef: 'batches.csv#L2' }],
    }],
    evidence_gaps: [{ unknown_id: 'unknown-a', question: '哪一项缺失？', source_ref: 'batches.csv#L2', field: 'accepted_count', period: '2026-10', blocking: false }],
    supplement_requests: [{ unknown_id: 'unknown-a', required_source: 'batches.csv', field: 'accepted_count', period: null, recompute: '补齐后重算' }],
    partial_visibility: true,
  };
}

function rawReport(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(reportFixture())) as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('fixture 不是对象');
  return value as Record<string, unknown>;
}

type FixtureContainer = Record<string, unknown> | unknown[];

function container(value: unknown): FixtureContainer {
  if (typeof value !== 'object' || value === null) throw new Error('fixture 不是容器');
  return value as FixtureContainer;
}

function parentAt(root: Record<string, unknown>, path: string): { parent: FixtureContainer; key: string } {
  const parts = path.split('.');
  const key = parts.pop();
  if (!key) throw new Error('fixture 路径为空');
  let current: FixtureContainer = root;
  for (const part of parts) {
    const value: unknown = Array.isArray(current) ? current[Number(part)] : current[part];
    current = container(value);
  }
  return { parent: current, key };
}

function deleteAt(root: Record<string, unknown>, path: string): void {
  const { parent, key } = parentAt(root, path);
  if (Array.isArray(parent)) delete parent[Number(key)];
  else delete parent[key];
}

function setAt(root: Record<string, unknown>, path: string, value: unknown): void {
  const { parent, key } = parentAt(root, path);
  if (Array.isArray(parent)) parent[Number(key)] = value;
  else parent[key] = value;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#1413 manifest loader', () => {
  it('200 正常清单保持服务端顺序并做白名单投影，不发送自报身份头', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      schema_version: 'enterprise-scan-manifests/v1',
      manifests: [
        { manifest_id: 'manifest-z', display_name: '清单 Z', graph: 'secret-graph', total: 99 },
        { manifest_id: 'manifest-a', display_name: '清单 A', allowed_path: '/private/a' },
      ],
    })) as typeof fetch;
    const result = await loadManifests({ base: 'http://scan.test/', fetchImpl });
    expect(result).toEqual({ kind: 'manifests', items: [
      { manifestId: 'manifest-z', displayName: '清单 Z' },
      { manifestId: 'manifest-a', displayName: '清单 A' },
    ] });
    expect(JSON.stringify(result)).not.toContain('secret-graph');
    expect(JSON.stringify(result)).not.toContain('/private/a');
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('http://scan.test/api/enterprise-scan/manifests');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({});
  });

  it('200 空数组是精确空态', async () => {
    const result = await loadManifests({ fetchImpl: fetchReturning(jsonResponse(200, { schema_version: 'enterprise-scan-manifests/v1', manifests: [] })) });
    expect(result).toEqual({ kind: 'manifests', items: [] });
  });

  const errorCases = [
    { status: 400, code: 'VALIDATION_ERROR' },
    { status: 401, code: 'UNAUTHORIZED' },
    { status: 403, code: 'SCOPE_DENIED' },
  ] as const;
  it.each(errorCases)('$status typed error 保留状态与信封', async testCase => {
    const result = await loadManifests({ fetchImpl: fetchReturning(jsonResponse(testCase.status, {
      ok: false, code: testCase.code, message: '服务端原因', phase: 'request', retryable: false,
    })) });
    expect(result).toEqual({ kind: 'error', httpStatus: testCase.status, code: testCase.code, message: '服务端原因', phase: 'request', retryable: false });
  });

  it('500 typed error 为 degraded＋warn＋retryable，不折成空清单', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await loadManifests({ fetchImpl: fetchReturning(jsonResponse(500, {
      ok: false, code: 'SCAN_STORE_FAILED', message: '读取失败', phase: 'report', retryable: true,
    })) });
    expect(result).toMatchObject({ kind: 'degraded', httpStatus: 500, code: 'SCAN_STORE_FAILED', retryable: true });
    expect(warn).toHaveBeenCalled();
  });

  const degradedCases = [
    { name: '网络', response: () => { throw new Error('offline'); } },
    { name: '非JSON', response: () => new Response('not-json', { status: 200 }) },
    { name: '意外404', response: () => jsonResponse(404, { message: 'proxy missing' }) },
    { name: '未知错误形状', response: () => jsonResponse(503, { ok: false }) },
    { name: 'schema错误', response: () => jsonResponse(200, { schema_version: 'other', manifests: [] }) },
    { name: '缺manifests', response: () => jsonResponse(200, { schema_version: 'enterprise-scan-manifests/v1' }) },
    { name: '重复id', response: () => jsonResponse(200, { schema_version: 'enterprise-scan-manifests/v1', manifests: [{ manifest_id: 'a', display_name: 'a' }, { manifest_id: 'a', display_name: 'a' }] }) },
    { name: '空id', response: () => jsonResponse(200, { schema_version: 'enterprise-scan-manifests/v1', manifests: [{ manifest_id: '', display_name: 'a' }] }) },
    { name: '缺名称', response: () => jsonResponse(200, { schema_version: 'enterprise-scan-manifests/v1', manifests: [{ manifest_id: 'a' }] }) },
  ] as const;
  it.each(degradedCases)('$name 永不抛且返回 degraded＋warn', async testCase => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => testCase.response()) as typeof fetch;
    await expect(loadManifests({ fetchImpl })).resolves.toMatchObject({ kind: 'degraded' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('#1413 扫描 loader 成功与错误契约', () => {
  it('POST 201／200 replay 进入同一报告槽，body 精确且无身份头', async () => {
    for (const testCase of [{ status: 201, replayed: false }, { status: 200, replayed: true }] as const) {
      const fetchImpl = vi.fn(async () => jsonResponse(testCase.status, reportFixture())) as typeof fetch;
      const result = await startScan('manifest-a', 'request-a', { base: 'http://scan.test', fetchImpl });
      expect(result).toEqual({ kind: 'report', report: reportFixture(), replayed: testCase.replayed });
      const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
      expect(url).toBe('http://scan.test/api/enterprise-scan/runs');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init?.body).toBe(JSON.stringify({ scan_manifest_id: 'manifest-a', client_request_id: 'request-a' }));
    }
  });

  it('GET 200 返回报告且 replayed=false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, reportFixture())) as typeof fetch;
    await expect(getScan('run/a', { base: 'http://scan.test', fetchImpl })).resolves.toEqual({ kind: 'report', report: reportFixture(), replayed: false });
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe('http://scan.test/api/enterprise-scan/runs/run%2Fa');
  });

  const errors = [
    { status: 400, code: 'VALIDATION_ERROR' },
    { status: 401, code: 'UNAUTHORIZED' },
    { status: 403, code: 'SCOPE_DENIED' },
    { status: 403, code: 'UNAUTHORIZED_PATH' },
    { status: 403, code: 'RUN_UNAVAILABLE' },
    { status: 409, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' },
    { status: 409, code: 'IDEMPOTENCY_KEY_UNAVAILABLE' },
    { status: 409, code: 'IDEMPOTENCY_REPLAY_SCOPE_CHANGED' },
    { status: 409, code: 'SOURCE_CHANGED_RERUN_REQUIRED' },
    { status: 409, code: 'FILE_CHANGED_BEFORE_COMMIT' },
    { status: 415, code: 'UNSUPPORTED_FORMAT' },
    { status: 422, code: 'EMPTY_CONTENT' },
    { status: 422, code: 'SOURCE_VALIDATION_FAILED' },
    { status: 422, code: 'SCHEMA_MAPPING_FAILED' },
  ] as const;
  it.each(errors)('$status/$code 保留 typed error', async testCase => {
    const result = await startScan('manifest-a', 'request-a', { fetchImpl: fetchReturning(jsonResponse(testCase.status, {
      ok: false, code: testCase.code, message: `${testCase.code} 文案`, phase: 'request', retryable: false,
    })) });
    expect(result).toEqual({ kind: 'error', httpStatus: testCase.status, code: testCase.code, message: `${testCase.code} 文案`, phase: 'request', retryable: false });
  });

  it.each(['SCAN_STORE_FAILED', 'TRANSACTION_ABORTED'])('500/%s 为结果未知 degraded＋warn', async code => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await startScan('manifest-a', 'request-a', { fetchImpl: fetchReturning(jsonResponse(500, {
      ok: false, code, message: '事务结果需核对', phase: 'transaction', retryable: true,
    })) });
    expect(result).toMatchObject({ kind: 'degraded', httpStatus: 500, code, retryable: true });
    expect(result.kind === 'degraded' && result.reason).toContain('结果状态未知');
    expect(warn).toHaveBeenCalled();
  });

  it('网络失败显示结果状态未知，不声称未写入', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as typeof fetch;
    const result = await startScan('manifest-a', 'request-a', { fetchImpl });
    expect(result.kind).toBe('degraded');
    if (result.kind !== 'degraded') throw new Error('应降级');
    expect(result.reason).toContain('结果状态未知');
    expect(result.reason).not.toContain('未产生新结果');
    expect(result.retryable).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    new Response('not-json', { status: 201 }),
    jsonResponse(404, { message: 'proxy missing' }),
    jsonResponse(200, { ok: false }),
  ])('非JSON／意外404／未知错误形状均 degraded', async response => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(startScan('manifest-a', 'request-a', { fetchImpl: fetchReturning(response) })).resolves.toMatchObject({ kind: 'degraded' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('#1413 完整报告递归形状守卫', () => {
  const requiredPaths = [
    'run.run_id', 'run.graph', 'run.operation', 'run.status', 'run.manifest_id', 'run.client_request_id',
    'sources.0.source_id', 'sources.0.evidence_id', 'sources.0.evidence_version_id', 'sources.0.format', 'sources.0.sha256',
    'sources.0.size', 'sources.0.observed_at', 'sources.0.period', 'sources.0.valid_from', 'sources.0.valid_to',
    'sources.0.visibility', 'sources.0.evidence_status', 'sources.0.instance_state',
    'checks.source_internal.0.status', 'checks.dashboard.0.period', 'checks.dashboard.0.metric', 'checks.dashboard.0.calculated',
    'checks.dashboard.0.dashboard', 'checks.dashboard.0.calculation_match', 'checks.dashboard.0.difference', 'checks.cross_source.0.status',
    'ontology.objects.0.type', 'ontology.objects.0.businessKey', 'ontology.objects.0.name', 'ontology.objects.0.validFrom', 'ontology.objects.0.object_id',
    'ontology.relations.0.type', 'ontology.relations.0.businessKey', 'ontology.relations.0.fromBusinessKey', 'ontology.relations.0.toBusinessKey',
    'ontology.relations.0.validFrom', 'ontology.relations.0.object_id', 'ontology.relations.0.from', 'ontology.relations.0.to',
    'assertions.0.assertion_id', 'assertions.0.assertion_version_id', 'assertions.0.target.kind', 'assertions.0.target.type',
    'assertions.0.target.businessKey', 'assertions.0.field', 'assertions.0.assertion_kind', 'assertions.0.assertion_type',
    'assertions.0.value', 'assertions.0.unit', 'assertions.0.denominator', 'assertions.0.evidence_status', 'assertions.0.instance_state',
    'assertions.0.defVersion', 'assertions.0.formulaRef', 'assertions.0.valid_from', 'assertions.0.valid_to',
    'assertions.0.evidence.0.evidenceVersionId', 'assertions.0.evidence.0.sourceRef',
    'evidence_gaps.0.unknown_id', 'evidence_gaps.0.question', 'evidence_gaps.0.source_ref', 'evidence_gaps.0.field',
    'evidence_gaps.0.period', 'evidence_gaps.0.blocking', 'supplement_requests.0.unknown_id', 'supplement_requests.0.required_source',
    'supplement_requests.0.field', 'supplement_requests.0.period', 'supplement_requests.0.recompute', 'partial_visibility',
  ] as const;

  it.each(requiredPaths)('删除被消费字段 %s ⇒ degraded＋warn', async path => {
    const body = rawReport();
    deleteAt(body, path);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(startScan('manifest-a', 'request-a', { fetchImpl: fetchReturning(jsonResponse(201, body)) })).resolves.toMatchObject({ kind: 'degraded' });
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    'sources', 'checks', 'checks.source_internal', 'checks.dashboard', 'checks.cross_source', 'ontology',
    'ontology.objects', 'ontology.relations', 'assertions', 'evidence_gaps', 'supplement_requests',
  ] as const)('删除顶层／数组容器 %s ⇒ degraded', async path => {
    const body = rawReport();
    deleteAt(body, path);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getScan('run-a', { fetchImpl: fetchReturning(jsonResponse(200, body)) })).resolves.toMatchObject({ kind: 'degraded' });
  });

  it.each([
    'sources.0.period', 'sources.0.valid_from', 'sources.0.valid_to', 'checks.dashboard.0.calculated',
    'checks.dashboard.0.dashboard', 'checks.dashboard.0.calculation_match', 'checks.dashboard.0.difference',
    'assertions.0.unit', 'assertions.0.denominator', 'assertions.0.defVersion', 'assertions.0.formulaRef',
    'assertions.0.valid_from', 'assertions.0.valid_to', 'evidence_gaps.0.period', 'supplement_requests.0.period',
  ] as const)('nullable 边界 %s 接受 null', async path => {
    const body = rawReport();
    setAt(body, path, null);
    await expect(getScan('run-a', { fetchImpl: fetchReturning(jsonResponse(200, body)) })).resolves.toMatchObject({ kind: 'report' });
  });

  it.each([
    { path: 'sources.0.size', value: '42' }, { path: 'sources.0.period', value: 0 },
    { path: 'checks.dashboard.0.calculated', value: '8' }, { path: 'checks.dashboard.0.calculation_match', value: 0 },
    { path: 'assertions.0.unit', value: 0 }, { path: 'assertions.0.evidence.0', value: null },
    { path: 'evidence_gaps.0.blocking', value: 'false' }, { path: 'partial_visibility', value: 'true' },
  ] as const)('错误嵌套类型 $path ⇒ degraded', async testCase => {
    const body = rawReport();
    setAt(body, testCase.path, testCase.value);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getScan('run-a', { fetchImpl: fetchReturning(jsonResponse(200, body)) })).resolves.toMatchObject({ kind: 'degraded' });
  });

  it.each(['sources', 'checks.dashboard', 'ontology.objects', 'ontology.relations', 'assertions', 'evidence_gaps', 'supplement_requests'] as const)('数组 %s 含非法项 ⇒ degraded', async path => {
    const body = rawReport();
    setAt(body, `${path}.0`, null);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getScan('run-a', { fetchImpl: fetchReturning(jsonResponse(200, body)) })).resolves.toMatchObject({ kind: 'degraded' });
  });

  it('只有 schema/status 不完整报告不得进入成功槽', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getScan('run-a', { fetchImpl: fetchReturning(jsonResponse(200, { schema_version: 'enterprise-scan/v1', run: { status: 'completed' } })) }))
      .resolves.toMatchObject({ kind: 'degraded' });
  });

  it('额外敏感字段不进入白名单报告', async () => {
    const body = rawReport();
    body.allowed_path = '/private/material.csv';
    if (!Array.isArray(body.sources)) throw new Error('fixture sources 不是数组');
    record(body.sources[0]).hidden_count = 9;
    const result = await getScan('run-a', { fetchImpl: fetchReturning(jsonResponse(200, body)) });
    expect(result.kind).toBe('report');
    expect(JSON.stringify(result)).not.toContain('/private/material.csv');
    expect(JSON.stringify(result)).not.toContain('hidden_count');
  });
});
