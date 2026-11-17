/**
 * @input 验签 viewer、服务端 manifest id 与客户端幂等键。
 * @output 可见范围内的扫描报告或原幂等报告。
 * @degraded 无静默降级；来源不可见、损坏或变化均返回 typed error。
 * @authority graph 与可见范围只来自验签身份及服务端授权。
 * @not-here 不构造 L4/L5，不写④，不判断瓶颈，不调用 DSH 或模型。
 * @error 权限、格式、解析、幂等、文件竞态与事务失败均带机器可读 code。
 */
import { randomUUID } from 'crypto';
import { EnterpriseScanError } from '../connectors/enterprise-scan/errors';
import { preflightSources } from '../connectors/enterprise-scan/preflight';
import { buildScanModel } from '../connectors/enterprise-scan/scanner';
import { canViewSource, visibilityFingerprint } from '../connectors/enterprise-scan/visibility';
import type { EnterpriseScanStorePort, PersistedScan, PreflightSource, RunRecord, ScanAuthorization, ScanManifestSummary, ScanReport, ScanViewer } from '../connectors/enterprise-scan/types';
import { scanRequestFingerprint } from '../connectors/enterprise-scan/request-fingerprint';

export class EnterpriseScanService {
  constructor(private readonly store: EnterpriseScanStorePort) {}

  /**
   * @input 已由认证边界收窄的 viewer。
   * @output 当前身份至少有一个可见来源的清单摘要；无可见清单返回空数组。
   * @degraded 授权损坏按既有 listAuthorizations fail-closed 跳过；读取失败显式抛出，不伪造空清单。
   * @authority 企业只取 viewer.orgId，可见性只由服务端授权与 canViewSource 判定。
   * @not-here 不做 preflight、文件 IO、来源计数、业务写入或材料内容读取。
   * @error 存储错误交由路由归一为 SCAN_STORE_FAILED；viewer 拒绝由路由统一处理。
   */
  listManifests(viewer: ScanViewer): ScanManifestSummary[] {
    const manifests: ScanManifestSummary[] = [];
    for (const manifestId of this.store.listManifestIds(viewer.orgId)) {
      const authorizations = this.store.listAuthorizations(viewer.orgId, manifestId);
      if (authorizations.length > 0 && authorizations.some(item => canViewSource(viewer, item))) {
        manifests.push({ manifestId, displayName: manifestId });
      }
    }
    return manifests;
  }

  async run(viewer: ScanViewer, manifestId: string, clientRequestId: string): Promise<PersistedScan> {
    const authorizations = this.store.listAuthorizations(viewer.orgId, manifestId);
    if (authorizations.length === 0) throw new EnterpriseScanError('SCOPE_DENIED', 'request', '扫描清单不存在、损坏或不可见');
    const preflights = await preflightSources(authorizations);
    this.assertTotalSize(preflights);
    const visible = preflights.filter(item => canViewSource(viewer, item.authorization));
    if (visible.length === 0) throw new EnterpriseScanError('SCOPE_DENIED', 'preflight', '当前身份无可见来源');
    const requestFingerprint = this.requestFingerprint(manifestId, authorizations, preflights);
    const visibility = visibilityFingerprint(visible);
    const model = buildScanModel(viewer.orgId, visible, visible.length < preflights.length);
    const record: RunRecord = {
      runId: randomUUID(), graph: viewer.orgId, operation: 'enterprise-scan', createdBy: viewer.sub,
      clientRequestId, requestFingerprint, status: 'completed', manifestId,
    };
    return this.store.persistScan({
      record, viewer, authorizationRevision: this.authorizationRevision(authorizations), visibilityFingerprint: visibility,
      preflights, model,
    });
  }

  async get(viewer: ScanViewer, runId: string): Promise<ScanReport> {
    const record = this.store.getRun(viewer.orgId, runId);
    if (!record) throw new EnterpriseScanError('RUN_UNAVAILABLE', 'report', '扫描运行不存在或完全不可见');
    const authorizations = this.store.listAuthorizations(record.graph, record.manifestId);
    if (authorizations.length === 0) throw new EnterpriseScanError('RUN_UNAVAILABLE', 'report', '扫描授权不可用');
    const preflights = await preflightSources(authorizations);
    this.assertTotalSize(preflights);
    const currentFingerprint = this.requestFingerprint(record.manifestId, authorizations, preflights);
    if (currentFingerprint !== record.requestFingerprint) {
      throw new EnterpriseScanError('SOURCE_CHANGED_RERUN_REQUIRED', 'report', '来源哈希或授权已变化，必须重新运行');
    }
    const visible = preflights.filter(item => canViewSource(viewer, item.authorization));
    if (visible.length === 0) throw new EnterpriseScanError('RUN_UNAVAILABLE', 'report', '扫描运行不存在或完全不可见');
    const visibility = visibilityFingerprint(visible);
    const existing = this.store.getReport(record.graph, record.runId, viewer.sub, visibility);
    if (existing) return existing;
    const model = buildScanModel(record.graph, visible, visible.length < preflights.length);
    return this.store.persistViewerReport(record, viewer, visibility, model);
  }

  private authorizationRevision(authorizations: ScanAuthorization[]): number {
    return Math.max(...authorizations.map(item => item.revision));
  }

  private requestFingerprint(manifestId: string, authorizations: ScanAuthorization[], preflights: PreflightSource[]): string {
    return scanRequestFingerprint({
      manifestId,
      authorizationRevision: this.authorizationRevision(authorizations),
      sourceIds: authorizations.map(item => item.sourceId),
      sourceContentHashes: preflights.map(item => item.sha256),
    });
  }

  private assertTotalSize(preflights: PreflightSource[]): void {
    const total = preflights.reduce((sum, item) => sum + item.size, 0);
    if (total > 4 * 1024 * 1024) throw new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', '来源总大小超过 4MiB');
  }
}
