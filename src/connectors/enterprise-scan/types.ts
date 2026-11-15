export type EvidenceStatus = 'confirmed' | 'pending' | 'stale' | 'conflict';
export type InstanceState = 'measured' | 'derived' | 'estimated' | 'partial' | 'stale' | 'conflict' | 'missing';
export type AssertionType = 'fact' | 'inference' | 'unknown';
export type AssertionKind = 'direct' | 'derived' | 'statement';
export type SourceFormat = 'csv' | 'md' | 'json';

export interface ScanViewer {
  sub: string;
  role: string;
  orgId: string;
  departmentIds?: readonly string[];
}

export interface ScanAuthorization {
  graph: string;
  manifestId: string;
  sourceId: string;
  canonicalRoot: string;
  allowedPath: string;
  format: string;
  visibility: 'enterprise' | 'restricted';
  allowedRoles: readonly string[];
  allowedUsers: readonly string[];
  allowedDepartments: readonly string[];
  revision: number;
  requiredAsOf?: string;
}

export interface FileIdentity {
  dev: string;
  ino: string;
}

export interface PathIdentity extends FileIdentity {
  path: string;
}

export interface PreflightSource {
  authorization: ScanAuthorization;
  canonicalPath: string;
  identity: FileIdentity;
  pathChain: PathIdentity[];
  sha256: string;
  size: number;
  mtimeMs: number;
  content: string;
}

export interface EvidenceLink {
  evidenceVersionId: string;
  sourceRef: string;
}

export interface OntologyObjectDraft {
  type: 'activity/delivery_batch' | 'resource/delivery_team' | 'outcome/delivery_result';
  businessKey: string;
  name: string;
  props: Record<string, unknown>;
  validFrom: string;
}

export interface OntologyRelationDraft {
  type: 'edge/team_executes_activity';
  businessKey: string;
  fromBusinessKey: string;
  toBusinessKey: string;
  props: Record<string, unknown>;
  validFrom: string;
}

export interface AssertionDraft {
  assertionId: string;
  assertionVersionId: string;
  assertionKey: string;
  targetKind: 'node' | 'edge';
  targetType: string;
  targetBusinessKey: string;
  field: string;
  assertionKind: AssertionKind;
  assertionType: AssertionType;
  defVersion: string | null;
  formulaRef: string | null;
  sourceFingerprint: string;
  value: unknown;
  unit: string | null;
  denominator: string | null;
  evidenceStatus: EvidenceStatus;
  instanceState: InstanceState;
  validFrom: string | null;
  validTo: string | null;
  evidence: EvidenceLink[];
}

export interface SourceReport {
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
  visibility: 'enterprise' | 'restricted';
  evidence_status: EvidenceStatus;
  instance_state: InstanceState;
}

export interface DashboardCheck {
  period: string;
  metric: string;
  calculated: number | null;
  dashboard: number | null;
  calculation_match: boolean | null;
  difference: number | null;
}

export interface EvidenceGap {
  unknown_id: string;
  question: string;
  source_ref: string;
  field: string;
  period: string | null;
  blocking: boolean;
}

export interface SupplementRequest {
  unknown_id: string;
  required_source: string;
  field: string;
  period: string | null;
  recompute: string;
}

export interface ScanModel {
  sources: SourceReport[];
  objects: OntologyObjectDraft[];
  relations: OntologyRelationDraft[];
  assertions: AssertionDraft[];
  checks: {
    source_internal: Array<Record<string, unknown>>;
    dashboard: DashboardCheck[];
    cross_source: Array<Record<string, unknown>>;
  };
  evidenceGaps: EvidenceGap[];
  supplementRequests: SupplementRequest[];
  partialVisibility: boolean;
}

export interface ScanReport {
  schema_version: 'enterprise-scan/v1';
  run: {
    run_id: string;
    graph: string;
    operation: 'enterprise-scan';
    status: 'completed';
    manifest_id: string;
    client_request_id: string;
  };
  sources: SourceReport[];
  checks: ScanModel['checks'];
  ontology: {
    objects: Array<OntologyObjectDraft & { object_id: string }>;
    relations: Array<OntologyRelationDraft & { object_id: string; from: string; to: string }>;
  };
  assertions: Array<Record<string, unknown>>;
  evidence_gaps: EvidenceGap[];
  supplement_requests: SupplementRequest[];
  partial_visibility: boolean;
}

export interface RunRecord {
  runId: string;
  graph: string;
  operation: 'enterprise-scan';
  createdBy: string;
  clientRequestId: string;
  requestFingerprint: string;
  status: 'completed';
  manifestId: string;
}

export interface PersistScanInput {
  record: RunRecord;
  viewer: ScanViewer;
  authorizationRevision: number;
  visibilityFingerprint: string;
  preflights: PreflightSource[];
  model: ScanModel;
}

export interface PersistedScan {
  record: RunRecord;
  report: ScanReport;
  replayed: boolean;
}

export interface EnterpriseScanStorePort {
  listAuthorizations(graph: string, manifestId: string): ScanAuthorization[];
  getRun(graph: string, runId: string): RunRecord | null;
  findRunByRequest(graph: string, operation: 'enterprise-scan', clientRequestId: string): RunRecord | null;
  persistScan(input: PersistScanInput): PersistedScan;
  getReport(graph: string, runId: string, viewerUserId: string, visibilityFingerprint: string): ScanReport | null;
  persistViewerReport(record: RunRecord, viewer: ScanViewer, visibilityFingerprint: string, model: ScanModel): ScanReport;
}

export interface SourceDescriptor {
  sourceId: string;
  fileName: string;
  evidenceId: string;
  evidenceVersionId: string;
  preflight: PreflightSource;
}
