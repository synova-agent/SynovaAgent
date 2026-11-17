import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';
import { ScanPanel, type ScanPanelProps } from '../../electron-renderer/src/components/ScanPanel';
import type { ScanReport } from '../../electron-renderer/src/lib/enterprise-scan-api';

function staffReport(): ScanReport {
  return {
    schema_version: 'enterprise-scan/v1',
    run: { run_id: 'run-staff', graph: 'org-a', operation: 'enterprise-scan', status: 'completed', manifest_id: 'manifest-a', client_request_id: 'request-staff' },
    sources: [{
      source_id: 'source-public', evidence_id: 'evidence-public', evidence_version_id: 'version-public', format: 'csv', sha256: 'abc',
      size: 42, observed_at: '2026-11-01T00:00:00.000Z', period: '2026-10', valid_from: '2026-10-01', valid_to: null,
      visibility: 'restricted', evidence_status: 'confirmed', instance_state: 'measured',
    }],
    checks: {
      source_internal: [{ source_id: 'source-public', source_ref: 'batches.csv#L2', businessKey: 'batch:a', field: 'accepted_count', status: 'conflict', values: [8, 9] }],
      dashboard: [{ period: '2026-10', metric: 'accepted_count', calculated: null, dashboard: null, calculation_match: null, difference: null }],
      cross_source: [{ status: 'conflict', businessKey: 'batch:a', field: 'accepted_count', values: [8, 9] }],
    },
    ontology: {
      objects: [{ type: 'activity/delivery_batch', businessKey: 'batch:a', name: '公开批次', validFrom: '2026-10-01', object_id: 'object-public' }],
      relations: [{ type: 'edge/team_executes_activity', businessKey: 'team:a->batch:a', fromBusinessKey: 'team:a', toBusinessKey: 'batch:a', validFrom: '2026-10-01', object_id: 'relation-public', from: 'team-public', to: 'object-public' }],
    },
    assertions: [{
      assertion_id: 'assertion-public', assertion_version_id: 'assertion-version-public',
      target: { kind: 'node', type: 'activity/delivery_batch', businessKey: 'batch:a' }, field: 'accepted_count',
      assertion_kind: 'statement', assertion_type: 'inference', value: 8, unit: 'count', denominator: null,
      evidence_status: 'conflict', instance_state: 'conflict', defVersion: 'delivery-v1', formulaRef: null,
      valid_from: '2026-10-01', valid_to: null, evidence: [{ evidenceVersionId: 'version-public', sourceRef: 'batches.csv#L2' }],
    }],
    evidence_gaps: [{ unknown_id: 'unknown-public', question: '公开材料缺少哪一项？', source_ref: 'batches.csv#L3', field: 'accepted_count', period: '2026-10', blocking: false }],
    supplement_requests: [{ unknown_id: 'unknown-public', required_source: 'batches.csv', field: 'accepted_count', period: '2026-10', recompute: '补齐后重新计算' }],
    partial_visibility: true,
  };
}

function props(overrides: Partial<ScanPanelProps> = {}): ScanPanelProps {
  return {
    status: 'idle', items: [], selectedManifestId: null, clientRequestId: null, runId: null,
    report: null, replayed: false, error: null, degraded: null, staleReport: false,
    onSelectManifest: vi.fn(), onStart: vi.fn(), onRetryList: vi.fn(), onRetryScan: vi.fn(), onNewScan: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<ScanPanelProps> = {}): string {
  return renderToStaticMarkup(React.createElement(ScanPanel, props(overrides)));
}

describe('#1413 ScanPanel 清单、等待与错误', () => {
  it('loading-list 与合法空清单分别呈现，空清单不显示开始按钮', () => {
    expect(render({ status: 'loading-list' })).toContain('正在加载扫描清单');
    const empty = render({ status: 'ready', items: [] });
    expect(empty).toContain('当前没有可发起的扫描清单');
    expect(empty).not.toContain('开始扫描');
  });

  it('清单只显示 displayName，选择对应 manifestId，未选择时开始按钮 disabled', () => {
    const html = render({ status: 'ready', items: [
      { manifestId: 'manifest-a', displayName: '授权材料 A' },
      { manifestId: 'manifest-b', displayName: '授权材料 B' },
    ] });
    expect(html).toContain('授权材料 A');
    expect(html).toContain('授权材料 B');
    expect(html).toContain('data-manifest-id="manifest-a"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('total');
    expect(html).not.toContain('allowed_');
  });

  it('running 只有处理中与静态流程，无假进度、实时、SSE 或取消', () => {
    const html = render({ status: 'running', selectedManifestId: 'manifest-a', clientRequestId: 'request-a' });
    expect(html).toContain('处理中');
    expect(html).toContain('预检→解析→映射→报告');
    expect(html).not.toMatch(/progress|\d+%|实时|取消|EventSource|断流/);
  });

  it('401／403／degraded 与空清单文案严格区分', () => {
    expect(render({ status: 'error', error: { kind: 'error', httpStatus: 401, code: 'UNAUTHORIZED', phase: 'request', retryable: false, message: '登录失效' } })).toContain('请重新登录');
    expect(render({ status: 'error', error: { kind: 'error', httpStatus: 403, code: 'SCOPE_DENIED', phase: 'request', retryable: false, message: 'GA 不可见' } })).toContain('GA 不可见');
    expect(render({ status: 'degraded', degraded: { kind: 'degraded', reason: '清单网络失败', retryable: true } })).toContain('清单网络失败');
    for (const html of [
      render({ status: 'error', error: { kind: 'error', httpStatus: 401, code: 'UNAUTHORIZED', phase: 'request', retryable: false, message: '登录失效' } }),
      render({ status: 'error', error: { kind: 'error', httpStatus: 403, code: 'SCOPE_DENIED', phase: 'request', retryable: false, message: '拒绝' } }),
      render({ status: 'degraded', degraded: { kind: 'degraded', reason: '网络失败', retryable: true } }),
    ]) expect(html).not.toContain('当前没有可发起的扫描清单');
  });

  it('RUN_UNAVAILABLE 统一文案；意外 404 degraded 不解释成材料不存在', () => {
    expect(render({ status: 'error', error: { kind: 'error', httpStatus: 403, code: 'RUN_UNAVAILABLE', phase: 'report', retryable: false, message: '不可见' } })).toContain('运行不存在或不可见');
    const html = render({ status: 'degraded', degraded: { kind: 'degraded', reason: 'HTTP 404 错误形状未知', httpStatus: 404 } });
    expect(html).toContain('HTTP 404');
    expect(html).not.toContain('材料不存在');
  });

  it('400／409／415／422／500／网络各有可诊断文案，retryable=false 不出现重试', () => {
    const cases = [
      { error: { kind: 'error', httpStatus: 400, code: 'VALIDATION_ERROR', phase: 'request', retryable: false, message: '字段错误' }, expected: '请求校验失败' },
      { error: { kind: 'error', httpStatus: 409, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', phase: 'request', retryable: false, message: '载荷不同' }, expected: '幂等键冲突' },
      { error: { kind: 'error', httpStatus: 409, code: 'IDEMPOTENCY_REPLAY_SCOPE_CHANGED', phase: 'request', retryable: false, message: '范围变化' }, expected: '可见范围变化' },
      { error: { kind: 'error', httpStatus: 409, code: 'SOURCE_CHANGED_RERUN_REQUIRED', phase: 'report', retryable: false, message: '材料变化' }, expected: '材料变化' },
      { error: { kind: 'error', httpStatus: 415, code: 'UNSUPPORTED_FORMAT', phase: 'preflight', retryable: false, message: '格式错误' }, expected: '材料格式' },
      { error: { kind: 'error', httpStatus: 422, code: 'EMPTY_CONTENT', phase: 'parse', retryable: false, message: '空内容' }, expected: '材料内容' },
    ] as const;
    for (const testCase of cases) {
      const html = render({ status: 'error', error: testCase.error, clientRequestId: 'request-a' });
      expect(html).toContain(testCase.expected);
      expect(html).not.toContain('>重试<');
    }
    const server = render({ status: 'degraded', clientRequestId: 'request-a', degraded: { kind: 'degraded', reason: '结果状态未知，将使用原请求编号核对；SCAN_STORE_FAILED', httpStatus: 500, retryable: true } });
    expect(server).toContain('结果状态未知');
    expect(server).toContain('>重试<');
    expect(server).not.toContain('未产生新结果');
    const network = render({ status: 'degraded', clientRequestId: 'request-a', degraded: { kind: 'degraded', reason: '结果状态未知，将使用原请求编号核对；网络异常', retryable: true } });
    expect(network).toContain('原请求编号核对');
    expect(network).not.toContain('未产生新结果');
  });
});

describe('#1413 ScanPanel 合成 staff 报告与最小输出', () => {
  it('呈现 sources/evidence、checks、冲突、缺失、②、断言与补充请求；null 不补零', () => {
    const report = staffReport();
    const sourceIds = report.sources.map(item => item.source_id);
    const evidenceIds = report.sources.map(item => item.evidence_id);
    const assertionValues = report.assertions.map(item => item.value);
    expect(sourceIds).toEqual(['source-public']);
    expect(evidenceIds).toEqual(['evidence-public']);
    expect(assertionValues.every(value => value !== 120)).toBe(true);

    const html = render({ status: 'report', report, clientRequestId: 'request-staff', runId: 'run-staff' });
    for (const expected of [
      '来源与证据状态', 'source-public', 'confirmed', '源内／看板／跨来源核对', '计算一致：未知',
      '冲突', '缺失与证据缺口', '公开材料缺少哪一项？', '补充材料请求', '② 对象与关系',
      '公开批次', 'team:a-&gt;batch:a', '断言与最小报告', 'statement 仅表示某人说过', '部分可见',
      '计算值：未知', '看板值：未知', '差异：未知',
    ]) expect(html).toContain(expected);
    expect(html).not.toContain('计算值：0');
    expect(html).not.toContain('隐藏数量');
    expect(html).not.toContain('来源总数');
    expect(html).not.toContain('全部可见');
    expect(html).not.toContain('private-evidence');
    expect(html).not.toContain('/private');
  });

  it('200 replay 显示此前结果；旧报告刷新失败同时保留报告和失败提示', () => {
    const replay = render({ status: 'report', report: staffReport(), replayed: true });
    expect(replay).toContain('已返回此前结果');
    const stale = render({ status: 'degraded', report: staffReport(), runId: 'run-staff', staleReport: true, degraded: { kind: 'degraded', reason: '报告刷新失败：网络异常', retryable: true } });
    expect(stale).toContain('当前展示此前结果，刷新失败');
    expect(stale).toContain('公开批次');
    expect(stale).toContain('报告刷新失败');
  });

  it('伪造额外 total/path/hidden_count 字段不被面板消费', () => {
    const malicious = { ...staffReport(), total: 99, hidden_count: 8, allowed_path: '/private/staff.csv' };
    const html = render({ status: 'report', report: malicious });
    expect(html).not.toContain('99');
    expect(html).not.toContain('hidden_count');
    expect(html).not.toContain('/private/staff.csv');
  });
});
