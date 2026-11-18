import type { WorkspaceRole } from '../../middleware/rbac';

/**
 * 扫描可见性消费的**唯一角色真源**（#1408 / 创始人裁定 Gitea #1408 评论 12607）。
 *
 * `satisfies readonly WorkspaceRole[]` 是**单向绑定**：`WorkspaceRole` 仍是产品 RBAC 的
 * 定义方（`src/middleware/rbac.ts:13`），本数组只声明「扫描侧认这些值」并让 `tsc` 在
 * 产品角色增删时**编译期报警**。禁止反向把 `WorkspaceRole` 定义为本数组的元素类型
 * （会引入 `rbac.ts → types.ts` 的运行时边与跨模块类型环，v7 §5.1 明令本票不做）。
 */
export const WORKSPACE_ROLES = ['admin', 'manager', 'liaison', 'staff', 'ga'] as const satisfies readonly WorkspaceRole[];

/** 扫描可见性角色 = 上述唯一真源的联合类型。 */
export type ScanRole = typeof WORKSPACE_ROLES[number];

export type EvidenceStatus = 'confirmed' | 'pending' | 'stale' | 'conflict';
export type InstanceState = 'measured' | 'derived' | 'estimated' | 'partial' | 'stale' | 'conflict' | 'missing';
export type AssertionType = 'fact' | 'inference' | 'unknown';
export type AssertionKind = 'direct' | 'derived' | 'statement';
export type SourceFormat = 'csv' | 'md' | 'json';

export interface ScanViewer {
  sub: string;
  /** #1408：只接受 `WorkspaceRole` 枚举（编译期）；运行时由 `toScanViewer` 校验。 */
  role: ScanRole;
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
  /** 已过滤为合法 `WorkspaceRole` 的角色清单（角色闸只作用部门路径，见 visibility.ts）。 */
  allowedRoles: readonly ScanRole[];
  /**
   * 角色清单是否**被声明**：取 `allowed_roles_json` **成功解析后的原始数组长度 > 0**
   * （`src/l4/enterprise-scan-store.ts` 读路径）。**不得**用过滤后长度 —— 否则
   * 「只写了旧词表（如 `["responsible"]`）」会被折成「未声明」，让角色闸整体失效（fail-open）。
   */
  allowedRolesDeclared: boolean;
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
