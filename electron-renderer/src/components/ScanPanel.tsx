import React from 'react';
import type {
  JsonValue,
  ScanCheckEntry,
  ScanDegradedView,
  ScanErrorView,
  ScanManifestItem,
  ScanReport,
} from '../lib/enterprise-scan-api';
import type { ScanStatus } from '../stores/scan-store';

export interface ScanPanelProps {
  status: ScanStatus;
  items: ScanManifestItem[];
  selectedManifestId: string | null;
  clientRequestId: string | null;
  runId: string | null;
  report: ScanReport | null;
  replayed: boolean;
  error: ScanErrorView | null;
  degraded: ScanDegradedView | null;
  staleReport: boolean;
  onSelectManifest: (manifestId: string) => void;
  onStart: () => void;
  onRetryList: () => void;
  onRetryScan: () => void;
  onNewScan: () => void;
}

function nullable(value: string | number | boolean | null): string {
  return value === null ? '未知' : String(value);
}

function jsonText(value: JsonValue): string {
  return JSON.stringify(value);
}

function errorText(error: ScanErrorView): string {
  if (error.httpStatus === 401) return `认证失败，请重新登录：${error.message}`;
  if (error.httpStatus === 400) return `请求校验失败：${error.message}`;
  if (error.code === 'RUN_UNAVAILABLE') return '运行不存在或不可见';
  if (error.code === 'SCOPE_DENIED' || error.code === 'UNAUTHORIZED_PATH') return `服务端授权拒绝：${error.message}`;
  if (error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' || error.code === 'IDEMPOTENCY_KEY_UNAVAILABLE') {
    return `幂等键冲突：${error.message}；请使用原请求编号核对，或在对账完成后重新发起`;
  }
  if (error.code === 'IDEMPOTENCY_REPLAY_SCOPE_CHANGED') return `可见范围变化：${error.message}`;
  if (error.code === 'SOURCE_CHANGED_RERUN_REQUIRED' || error.code === 'FILE_CHANGED_BEFORE_COMMIT') {
    return `材料变化：${error.message}；请按原请求编号核对或在对账后重新发起`;
  }
  if (error.httpStatus === 415) return `材料格式问题：${error.message}`;
  if (error.httpStatus === 422) return `材料内容／映射问题：${error.message}`;
  return error.message;
}

const CheckEntries: React.FC<{ title: string; entries: ScanCheckEntry[] }> = ({ title, entries }) => (
  <div className="scan-check-group">
    <h5>{title}</h5>
    {entries.length === 0 ? <div>无记录</div> : entries.map((entry, index) => (
      <div className="scan-check-entry" key={`${entry.businessKey ?? entry.source_id ?? 'check'}-${index}`}>
        <span>状态：{entry.status}</span>
        {entry.businessKey ? <span>对象：{entry.businessKey}</span> : null}
        {entry.field ? <span>字段：{entry.field}</span> : null}
        {entry.source_ref ? <span>来源引用：{entry.source_ref}</span> : null}
        {entry.values ? <span>记录值：{jsonText(entry.values)}</span> : null}
      </div>
    ))}
  </div>
);

const ReportView: React.FC<{ report: ScanReport }> = ({ report }) => {
  const conflicts = report.assertions.filter(item => item.evidence_status === 'conflict' || item.instance_state === 'conflict');
  return (
    <div className="scan-report" data-testid="scan-report">
      {report.partial_visibility ? <div className="scan-partial">部分可见：仅展示当前身份可见内容</div> : null}
      <section>
        <h4>运行信息</h4>
        <div>运行编号：{report.run.run_id}</div>
        <div>清单：{report.run.manifest_id}</div>
        <div>请求编号：{report.run.client_request_id}</div>
        <div>状态：{report.run.status}</div>
      </section>

      <section>
        <h4>来源与证据状态</h4>
        {report.sources.length === 0 ? <div>无记录</div> : report.sources.map(source => (
          <div className="scan-source" key={source.source_id}>
            <strong>{source.source_id}</strong>
            <span>证据：{source.evidence_id}</span>
            <span>证据状态：{source.evidence_status}</span>
            <span>实例状态：{source.instance_state}</span>
            <span>格式：{source.format}</span>
            <span>期间：{nullable(source.period)}</span>
          </div>
        ))}
      </section>

      <section>
        <h4>源内／看板／跨来源核对</h4>
        <CheckEntries title="源内核对" entries={report.checks.source_internal} />
        <div className="scan-check-group">
          <h5>看板核对</h5>
          {report.checks.dashboard.length === 0 ? <div>无记录</div> : report.checks.dashboard.map((check, index) => (
            <div key={`${check.period}-${check.metric}-${index}`}>
              <strong>{check.period} / {check.metric}</strong>
              <div>计算值：{nullable(check.calculated)}</div>
              <div>看板值：{nullable(check.dashboard)}</div>
              <div>计算一致：{nullable(check.calculation_match)}</div>
              <div>差异：{nullable(check.difference)}</div>
            </div>
          ))}
        </div>
        <CheckEntries title="跨来源核对" entries={report.checks.cross_source} />
        <div>calculation_match 仅表示计算一致，不代表业务事实。</div>
      </section>

      <section>
        <h4>冲突</h4>
        {conflicts.length === 0 ? <div>无记录</div> : conflicts.map(assertion => (
          <div key={assertion.assertion_version_id}>
            {assertion.target.businessKey} / {assertion.field}：{jsonText(assertion.value)}（不作裁决）
          </div>
        ))}
      </section>

      <section>
        <h4>缺失与证据缺口</h4>
        {report.evidence_gaps.length === 0 ? <div>无记录</div> : report.evidence_gaps.map(gap => (
          <div key={gap.unknown_id}>
            <strong>{gap.question}</strong>
            <span>字段：{gap.field}</span>
            <span>期间：{nullable(gap.period)}</span>
            <span>来源引用：{gap.source_ref}</span>
            <span>阻断：{String(gap.blocking)}</span>
          </div>
        ))}
      </section>

      <section>
        <h4>补充材料请求</h4>
        {report.supplement_requests.length === 0 ? <div>无记录</div> : report.supplement_requests.map(request => (
          <div key={request.unknown_id}>
            <strong>{request.required_source}</strong>
            <span>字段：{request.field}</span>
            <span>期间：{nullable(request.period)}</span>
            <div>{request.recompute}</div>
          </div>
        ))}
      </section>

      <section>
        <h4>② 对象与关系</h4>
        {report.ontology.objects.length === 0 ? <div>无对象记录</div> : report.ontology.objects.map(object => (
          <div key={object.object_id}>
            <strong>{object.name}</strong>
            <span>{object.type}</span>
            <span>{object.businessKey}</span>
            <span>生效：{object.validFrom}</span>
          </div>
        ))}
        {report.ontology.relations.length === 0 ? <div>无关系记录</div> : report.ontology.relations.map(relation => (
          <div key={relation.object_id}>
            <strong>{relation.businessKey}</strong>
            <span>{relation.type}</span>
            <span>{relation.fromBusinessKey} → {relation.toBusinessKey}</span>
          </div>
        ))}
      </section>

      <section>
        <h4>断言与最小报告</h4>
        <div>statement 仅表示某人说过；fact／inference／unknown 按服务端类型原样呈现。</div>
        {report.assertions.length === 0 ? <div>无记录</div> : report.assertions.map(assertion => (
          <div className="scan-assertion" key={assertion.assertion_version_id}>
            <strong>{assertion.target.businessKey} / {assertion.field}</strong>
            <div>值：{jsonText(assertion.value)} {nullable(assertion.unit)}</div>
            <div>类型：{assertion.assertion_kind} / {assertion.assertion_type}</div>
            <div>证据状态：{assertion.evidence_status}；实例状态：{assertion.instance_state}</div>
            <div>定义版本：{nullable(assertion.defVersion)}；公式：{nullable(assertion.formulaRef)}</div>
            {assertion.evidence.map(evidence => <div key={`${evidence.evidenceVersionId}-${evidence.sourceRef}`}>来源引用：{evidence.sourceRef}</div>)}
          </div>
        ))}
      </section>
    </div>
  );
};

export const ScanPanel: React.FC<ScanPanelProps> = props => {
  const {
    status, items, selectedManifestId, clientRequestId, runId, report, replayed,
    error, degraded, staleReport, onSelectManifest, onStart, onRetryList, onRetryScan, onNewScan,
  } = props;
  const hasScanRequest = clientRequestId !== null || runId !== null;
  const retry = hasScanRequest ? onRetryScan : onRetryList;
  const retryable = error?.retryable === true || degraded?.retryable === true;

  return (
    <section className="scan-panel" data-testid="scan-panel" style={{ padding: 24, overflow: 'auto' }}>
      <header>
        <h2>企业扫描</h2>
        <p>选择当前身份有权使用的材料清单，查看来源、核对结果与最小报告。</p>
      </header>

      {status === 'idle' ? <div>尚未加载扫描清单</div> : null}
      {status === 'loading-list' ? <div>正在加载扫描清单…</div> : null}
      {status === 'ready' && items.length === 0 ? <div className="scan-empty">当前没有可发起的扫描清单</div> : null}
      {status === 'ready' && items.length > 0 ? (
        <div className="scan-manifest-picker">
          <label htmlFor="scan-manifest">授权材料清单</label>
          <select
            id="scan-manifest"
            name="scan-manifest"
            value={selectedManifestId ?? ''}
            onChange={event => onSelectManifest(event.target.value)}
          >
            <option data-manifest-id="" value="">请选择扫描清单</option>
            {items.map(item => <option data-manifest-id={item.manifestId} value={item.manifestId} key={item.manifestId}>{item.displayName}</option>)}
          </select>
          <button type="button" onClick={onStart} disabled={selectedManifestId === null}>开始扫描</button>
        </div>
      ) : null}

      {status === 'running' ? (
        <div className="scan-running" data-testid="scan-running">
          <strong>处理中</strong>
          <div>预检→解析→映射→报告</div>
          <div>扫描完成后将在此显示结果；离开此视图仍继续等待原请求。</div>
        </div>
      ) : null}

      {error ? (
        <div className="scan-error" role="alert">
          <strong>扫描请求未完成</strong>
          <div>{errorText(error)}</div>
        </div>
      ) : null}
      {degraded ? (
        <div className="scan-degraded" role="alert">
          <strong>扫描服务降级</strong>
          <div>{degraded.reason}</div>
        </div>
      ) : null}
      {(status === 'error' || status === 'degraded') && retryable ? <button type="button" onClick={retry}>重试</button> : null}

      {staleReport && report ? <div className="scan-stale">当前展示此前结果，刷新失败</div> : null}
      {status === 'report' && replayed ? <div className="scan-replayed">已返回此前结果</div> : null}
      {report && (status === 'report' || staleReport) ? <ReportView report={report} /> : null}
      {status === 'report' && report ? <button type="button" onClick={onNewScan}>新扫描</button> : null}
    </section>
  );
};
