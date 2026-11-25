/**
 * @input 已预检来源、确定性扫描模型、运行记录与 viewer 可见指纹。
 * @output 同一事务内持久化的运行及可见报告。
 * @degraded 无；任何约束、触发器或提交前复检失败均整体回滚。
 * @authority 所有读写带 graph；②身份复用既有 graphStore，跨表使用复合外键。
 * @not-here 不解析文件，不计算业务值，不异步执行事务，不写④。
 * @error 幂等冲突、②映射失败、文件变化与 SQLite 失败显式抛出。
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';
import type { SqliteGraphStore } from '../adapters/sqlite-graph-store';
import { systemClock, type Clock } from '../services/clock';
import { validateAndLog } from './sog-schema-validator';
import { EnterpriseScanError, asEnterpriseScanError } from '../connectors/enterprise-scan/errors';
import { stableId } from '../connectors/enterprise-scan/canonical';
import { recheckAuthorizedSource } from '../connectors/enterprise-scan/path-authorizer';
import { describeSource } from '../connectors/enterprise-scan/scanner';
import { isWorkspaceRole } from '../connectors/enterprise-scan/visibility';
import type {
  AssertionDraft,
  EnterpriseScanStorePort,
  OntologyObjectDraft,
  OntologyRelationDraft,
  PersistedScan,
  PersistScanInput,
  RunRecord,
  ScanAuthorization,
  ScanModel,
  ScanReport,
  ScanViewer,
} from '../connectors/enterprise-scan/types';

const log = createLogger('l4/enterprise-scan-store');

interface AuthorizationRow {
  graph: string;
  manifest_id: string;
  source_id: string;
  canonical_root: string;
  allowed_path: string;
  format: string;
  visibility: string;
  allowed_roles_json: string;
  allowed_users_json: string;
  allowed_departments_json: string;
  revision: number;
  read_scope_json?: string;
}

interface RunRow {
  run_id: string;
  graph: string;
  operation: string;
  created_by: string;
  client_request_id: string;
  request_fingerprint: string;
  status: string;
  manifest_id: string;
}

interface LinkRow { object_id: string }
interface ReportRow { report_json: string; visibility_fingerprint: string }

// ═══ #1486 裁定 b：通用事实持久化入口的输入/输出形状 ═══
//
// 为什么另立形状而不复用 `OntologyObjectDraft/OntologyRelationDraft`：
// 扫描模型把对象钉死在 3 类对象/1 类关系（`connectors/enterprise-scan/types.ts:78,86`），
// 而 ingest 抽到的事实类型由其本体映射决定 ⇒ 通用入口只约束**形状**，类型由调用方（资料）给出。
// ⚠️ 形状 ≠ 放宽不变量：键（graph/type/businessKey）仍强校验，落库仍走 ② 唯一 writer + 006 触发器。

/** 一条待落库的 ② 对象事实（#1486 裁定 b）。 */
export interface ScanFactObjectDraft {
  /** ② 对象类型（非空字符串；SOG 未覆盖类型按既有「放行 + 可见降级」处理，不阻断） */
  type: string;
  /** 业务键（非空；由本入口写入 `props.businessKey`，并登记 `scan_ontology_links` 幂等键） */
  businessKey: string;
  /** 对象属性（纯对象；`period` 等业务事实必须由调用方从资料给出 —— 本入口不派生、不补默认） */
  props: Record<string, unknown>;
  /** 生效起点（可选；缺省 = 注入时钟的当前 ISO 时间） */
  validFrom?: string;
}

/** 一条待落库的 ② 关系事实（端点必须在**同一次** `persistFacts` 的对象集合内）。 */
export interface ScanFactRelationDraft {
  /** 关系谓词（非空字符串，如 `edge/team_executes_activity`） */
  type: string;
  /** 关系业务键（非空；登记 `scan_ontology_links` 幂等键） */
  businessKey: string;
  /** 起点对象的业务键（必须在本批 `objects` 内命中） */
  fromBusinessKey: string;
  /** 终点对象的业务键（同上） */
  toBusinessKey: string;
  /** 边属性（可选） */
  props?: Record<string, unknown>;
  /** 生效起点（可选；缺省 = 注入时钟的当前 ISO 时间） */
  validFrom?: string;
}

/** `persistFacts` 入参。 */
export interface PersistFactsInput {
  /** 企业图分区（非空字符串；由服务端决定，不接受客户端自报） */
  graph: string;
  /** 本批对象事实（按数组顺序写入；同批业务键必须唯一） */
  objects: readonly ScanFactObjectDraft[];
  /** 本批关系事实（可选；端点按 `objects` 的业务键解析） */
  relations?: readonly ScanFactRelationDraft[];
}

/** 单条已落库事实的回执（幂等重放时 `replayed=true` 且 `objectId` 为既有 id）。 */
export interface PersistedFact {
  kind: 'node' | 'edge';
  type: string;
  businessKey: string;
  /** ② 节点 id（`node-<uuid>`）或边 id（`edge-<uuid>`） */
  objectId: string;
  /** true = 该 (graph, kind, type, businessKey) 已存在 ⇒ 复用既有 id（不新建、不改属性） */
  replayed: boolean;
}

/** `persistFacts` 出参（逐条回执，顺序与入参一致：先 objects 后 relations）。 */
export interface PersistedFacts {
  facts: PersistedFact[];
}

/** 入参违约的 typed error（机器可读 code：`VALIDATION_ERROR`）。 */
function factValidation(message: string): EnterpriseScanError {
  return new EnterpriseScanError('VALIDATION_ERROR', 'request', message);
}

/** 诊断用：字符串带引号，其余只报类别（不遍历对象） */
function describeFactValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  return typeof value;
}

function stringArray(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) return null;
    return parsed;
  } catch { return null; }
}

function requiredAsOf(row: AuthorizationRow): string | undefined {
  if (typeof row.read_scope_json !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(row.read_scope_json);
    if (typeof parsed !== 'object' || parsed === null || !('required_as_of' in parsed)) return undefined;
    const value = (parsed as { required_as_of?: unknown }).required_as_of;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch { return undefined; }
}

function runRecord(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    graph: row.graph,
    operation: 'enterprise-scan',
    createdBy: row.created_by,
    clientRequestId: row.client_request_id,
    requestFingerprint: row.request_fingerprint,
    status: 'completed',
    manifestId: row.manifest_id,
  };
}

export class EnterpriseScanStore implements EnterpriseScanStorePort {
  constructor(
    private readonly db: Database.Database,
    private readonly graphStore: SqliteGraphStore,
    private readonly clock: Clock = systemClock,
  ) {
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * @input 服务端 graph。
   * @output 该企业去重、按 manifest_id 升序的 id；不返回路径或授权字段。
   * @degraded 无；SQLite 读取失败显式抛出，不以空清单冒充成功。
   * @authority graph 是强制查询条件，不接受客户端企业参数。
   * @not-here 不做角色过滤、preflight、文件 IO 或任何业务写入。
   * @error 数据库错误交由路由归一为 SCAN_STORE_FAILED。
   */
  listManifestIds(graph: string): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT manifest_id FROM scan_authorizations WHERE graph = ? ORDER BY manifest_id',
    ).all(graph) as Array<{ manifest_id: string }>;
    return rows.map(row => row.manifest_id);
  }

  listAuthorizations(graph: string, manifestId: string): ScanAuthorization[] {
    const rows = this.db.prepare(
      `SELECT a.*, s.read_scope_json FROM scan_authorizations a
       LEFT JOIN scan_sources s ON s.graph = a.graph AND s.source_id = a.source_id
       WHERE a.graph = ? AND a.manifest_id = ? ORDER BY a.source_id`,
    ).all(graph, manifestId) as AuthorizationRow[];
    const output: ScanAuthorization[] = [];
    for (const row of rows) {
      const rawRoles = stringArray(row.allowed_roles_json);
      const users = stringArray(row.allowed_users_json);
      const departments = stringArray(row.allowed_departments_json);
      if (!rawRoles || !users || !departments) return [];
      const roles = rawRoles.filter(isWorkspaceRole);
      if (roles.length !== rawRoles.length) {
        // #1408：非 WorkspaceRole 值被过滤（如旧词表 'responsible'）。degraded 只进日志、不进 HTTP 响应；
        // 「每请求每源至多一条 warn」是已接受的取舍 —— 本循环天然每来源一条，禁模块级 Set（会跨请求携带状态）。
        log.warn(
          { reason: 'invalid_workspace_role', dropped: rawRoles.length - roles.length, degraded: true },
          '扫描授权角色清单含非 WorkspaceRole 值，已按角色闸口径过滤（allowedRolesDeclared 仍按原始长度）',
        );
      }
      if (row.visibility !== 'enterprise' && row.visibility !== 'restricted') return [];
      if (!Number.isInteger(row.revision) || row.revision < 1) return [];
      output.push({
        graph: row.graph,
        manifestId: row.manifest_id,
        sourceId: row.source_id,
        canonicalRoot: row.canonical_root,
        allowedPath: row.allowed_path,
        format: row.format,
        visibility: row.visibility,
        allowedRoles: roles,
        allowedRolesDeclared: rawRoles.length > 0,
        allowedUsers: users,
        allowedDepartments: departments,
        revision: row.revision,
        requiredAsOf: requiredAsOf(row),
      });
    }
    return output;
  }

  getRun(graph: string, runId: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM scan_runs WHERE graph = ? AND run_id = ?').get(graph, runId) as RunRow | undefined;
    return row ? runRecord(row) : null;
  }

  findRunByRequest(graph: string, operation: 'enterprise-scan', clientRequestId: string): RunRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM scan_runs WHERE graph = ? AND operation = ? AND client_request_id = ?',
    ).get(graph, operation, clientRequestId) as RunRow | undefined;
    return row ? runRecord(row) : null;
  }

  getReport(graph: string, runId: string, viewerUserId: string, visibility: string): ScanReport | null {
    const row = this.db.prepare(
      'SELECT report_json, visibility_fingerprint FROM scan_reports WHERE graph = ? AND run_id = ? AND viewer_user_id = ? AND visibility_fingerprint = ?',
    ).get(graph, runId, viewerUserId, visibility) as ReportRow | undefined;
    if (!row) return null;
    return JSON.parse(row.report_json) as ScanReport;
  }

  persistScan(input: PersistScanInput): PersistedScan {
    try {
      return this.db.transaction((): PersistedScan => {
        const existing = this.findRunByRequest(input.record.graph, 'enterprise-scan', input.record.clientRequestId);
        if (existing) {
          if (existing.createdBy !== input.viewer.sub) throw new EnterpriseScanError('IDEMPOTENCY_KEY_UNAVAILABLE', 'request', '幂等键已被其他创建人使用');
          if (existing.requestFingerprint !== input.record.requestFingerprint) throw new EnterpriseScanError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'request', '同一幂等键对应不同规范化载荷');
          const previousScope = this.db.prepare(
            'SELECT report_json, visibility_fingerprint FROM scan_reports WHERE graph = ? AND run_id = ? AND viewer_user_id = ?',
          ).get(existing.graph, existing.runId, input.viewer.sub) as ReportRow | undefined;
          if (!previousScope || previousScope.visibility_fingerprint !== input.visibilityFingerprint) {
            throw new EnterpriseScanError('IDEMPOTENCY_REPLAY_SCOPE_CHANGED', 'request', '重放时可见范围已变化');
          }
          return { record: existing, report: JSON.parse(previousScope.report_json) as ScanReport, replayed: true };
        }

        this.db.prepare(
          `INSERT INTO scan_runs(run_id, graph, operation, created_by, client_request_id, request_fingerprint, status, manifest_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(input.record.runId, input.record.graph, input.record.operation, input.record.createdBy,
          input.record.clientRequestId, input.record.requestFingerprint, input.record.status, input.record.manifestId, this.clock.nowIso());

        this.writeEvidence(input);
        const objectIds = this.writeObjects(input.record.graph, input.model.objects);
        const relationIds = this.writeRelations(input.record.graph, input.model.relations, objectIds);
        this.writeAssertions(input.record.graph, input.model.assertions, new Map([...objectIds, ...relationIds]));
        const report = this.writeReport(input.record, input.viewer, input.visibilityFingerprint, input.model, objectIds, relationIds);
        for (const preflight of input.preflights) recheckAuthorizedSource(preflight);
        return { record: input.record, report, replayed: false };
      })();
    } catch (error) {
      throw asEnterpriseScanError(error, 'TRANSACTION_ABORTED');
    }
  }

  /**
   * persistFacts — **通用事实持久化入口**（#1486 裁定 b；来自 ingest 的自动抽取结果必须经此入口）。
   *
   * 为什么必须有它：脚本直写 `scan_*` 会绕开 ② writer 与 006 触发器（`scan_ontology_links` 的
   * node/edge graph·type 一致性、`scan_assertions` 的目标外键），等于造第二条影子链。
   *
   * 契约（铁律 47）:
   *   @input  input.graph —— 企业图分区（非空字符串；服务端决定）
   *           input.objects —— 对象事实（type/businessKey 非空、props 纯对象；同批业务键唯一）
   *           input.relations —— 关系事实（端点按本批 `objects` 的 businessKey 解析）
   *   @output 逐条回执（先 objects 后 relations）：`{kind,type,businessKey,objectId,replayed}`；
   *           幂等重放 ⇒ `replayed=true` 且 `objectId` 为既有 id（不新建、不改属性）
   *   @degraded 无：单事务严格写入；任一步失败整体回滚（不留半批），不静默跳过、不伪造成功
   *   @authority ② 节点/边只经既有 writer（`SqliteGraphStore.createNode/createEdge`）写入；
   *              `scan_ontology_links` 的 graph/type 一致性由 **006 触发器**校验（本入口不绕过）；
   *              幂等键 = `(graph, kind, type, businessKey)`（与 `findLink` 同形）；`props.businessKey` 由本入口统一写入
   *   @not-here 不解析文件、不计算业务值、不写 `scan_runs/scan_reports/scan_assertions`；
   *             不派生/补全 `period`、`defVersion`（业务事实由调用方从资料给出）
   *   @error  `EnterpriseScanError(VALIDATION_ERROR, phase=request)` —— 入参违约（**校验先于写入** ⇒ 零写入）；
   *           `EnterpriseScanError(SCHEMA_MAPPING_FAILED, phase=mapping)` —— SOG schema 硬校验失败 / 关系端点缺失；
   *           `EnterpriseScanError(TRANSACTION_ABORTED, phase=transaction)` —— 介质/约束失败（含触发器拒绝）
   */
  persistFacts(input: PersistFactsInput): PersistedFacts {
    try {
      return this.db.transaction((): PersistedFacts => {
        if (typeof input.graph !== 'string' || input.graph === '') {
          throw factValidation(`input.graph 必须是非空字符串（实得 ${describeFactValue(input.graph)}）`);
        }
        if (!Array.isArray(input.objects)) {
          throw factValidation('input.objects 必须是数组');
        }
        const facts: PersistedFact[] = [];
        /** `linkKey(node,type,businessKey)` → 节点 id（关系端点的第一解析源） */
        const objectIds = new Map<string, string>();
        /** businessKey → 节点 id（同批业务键必须唯一，否则关系端点无法无歧义解析） */
        const byBusinessKey = new Map<string, string>();

        for (const object of input.objects) {
          if (typeof object.type !== 'string' || object.type === '') {
            throw factValidation(`对象 type 必须是非空字符串（实得 ${describeFactValue(object.type)}）`);
          }
          if (typeof object.businessKey !== 'string' || object.businessKey === '') {
            throw factValidation(`对象 businessKey 必须是非空字符串（实得 ${describeFactValue(object.businessKey)}）`);
          }
          if (typeof object.props !== 'object' || object.props === null || Array.isArray(object.props)) {
            throw factValidation(`对象 props 必须是普通对象（businessKey=${object.businessKey}）`);
          }
          const key = this.linkKey('node', object.type, object.businessKey);
          if (objectIds.has(key) || byBusinessKey.has(object.businessKey)) {
            throw factValidation(`同批业务键重复: ${object.businessKey}`);
          }

          // ② 唯一 writer + 既有幂等链接：命中 ⇒ 复用（不新建、不改属性）
          let objectId = this.findLink(input.graph, 'node', object.type, object.businessKey);
          const replayed = objectId !== null;
          if (objectId === null) {
            const props: Record<string, unknown> = { ...object.props, businessKey: object.businessKey };
            if (!validateAndLog(object.type, props)) {
              throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', `②Schema 校验失败: ${object.businessKey}`);
            }
            objectId = this.graphStore.createNode(object.type, props, input.graph);
            this.db.prepare('UPDATE graph_nodes SET valid_from = ? WHERE id = ? AND graph = ?')
              .run(object.validFrom ?? this.clock.nowIso(), objectId, input.graph);
            // 006 触发器 `scan_ontology_links_node_insert` 校验 graph_nodes 行存在且 graph/type 一致
            this.db.prepare(
              'INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES (?, ?, ?, ?, ?)',
            ).run(input.graph, 'node', object.type, object.businessKey, objectId);
          }
          objectIds.set(key, objectId);
          byBusinessKey.set(object.businessKey, objectId);
          facts.push({ kind: 'node', type: object.type, businessKey: object.businessKey, objectId, replayed });
        }

        for (const relation of input.relations ?? []) {
          if (typeof relation.type !== 'string' || relation.type === '') {
            throw factValidation(`关系 type 必须是非空字符串（实得 ${describeFactValue(relation.type)}）`);
          }
          if (typeof relation.businessKey !== 'string' || relation.businessKey === '') {
            throw factValidation(`关系 businessKey 必须是非空字符串（实得 ${describeFactValue(relation.businessKey)}）`);
          }
          const from = byBusinessKey.get(relation.fromBusinessKey);
          const to = byBusinessKey.get(relation.toBusinessKey);
          if (from === undefined || to === undefined) {
            const missing: string[] = [];
            if (from === undefined) missing.push(`fromBusinessKey=${relation.fromBusinessKey}`);
            if (to === undefined) missing.push(`toBusinessKey=${relation.toBusinessKey}`);
            throw new EnterpriseScanError(
              'SCHEMA_MAPPING_FAILED',
              'mapping',
              `关系端点不在本批对象内: ${missing.join('; ')}`,
            );
          }

          let edgeId = this.findLink(input.graph, 'edge', relation.type, relation.businessKey);
          const replayed = edgeId !== null;
          if (edgeId === null) {
            edgeId = this.graphStore.createEdge(relation.type, from, to, 1, relation.props ?? {}, input.graph);
            this.db.prepare('UPDATE graph_triples SET valid_from = ? WHERE id = ? AND graph = ?')
              .run(relation.validFrom ?? this.clock.nowIso(), edgeId, input.graph);
            // 006 触发器 `scan_ontology_links_edge_insert` 校验 graph_triples 行存在且 graph/predicate 一致
            this.db.prepare(
              'INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES (?, ?, ?, ?, ?)',
            ).run(input.graph, 'edge', relation.type, relation.businessKey, edgeId);
          }
          facts.push({ kind: 'edge', type: relation.type, businessKey: relation.businessKey, objectId: edgeId, replayed });
        }

        return { facts };
      })();
    } catch (error) {
      throw asEnterpriseScanError(error, 'TRANSACTION_ABORTED');
    }
  }

  persistViewerReport(record: RunRecord, viewer: ScanViewer, visibility: string, model: ScanModel): ScanReport {
    try {
      return this.db.transaction((): ScanReport => {
        const existingObjects = new Map<string, string>();
        for (const object of model.objects) {
          const id = this.findLink(record.graph, 'node', object.type, object.businessKey);
          if (!id) throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'report', `既有运行缺少②对象: ${object.businessKey}`);
          existingObjects.set(this.linkKey('node', object.type, object.businessKey), id);
        }
        const relationIds = new Map<string, string>();
        for (const relation of model.relations) {
          const id = this.findLink(record.graph, 'edge', relation.type, relation.businessKey);
          if (!id) throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'report', `既有运行缺少②关系: ${relation.businessKey}`);
          relationIds.set(this.linkKey('edge', relation.type, relation.businessKey), id);
        }
        this.writeAssertions(record.graph, model.assertions, new Map([...existingObjects, ...relationIds]));
        return this.writeReport(record, viewer, visibility, model, existingObjects, relationIds);
      })();
    } catch (error) {
      throw asEnterpriseScanError(error, 'TRANSACTION_ABORTED');
    }
  }

  private writeEvidence(input: PersistScanInput): void {
    const now = this.clock.nowIso();
    // 🔴 反序 GET 修复（1B 复核阻塞项 1）：证据版本按「**全部授权来源**」随 run 落库。
    //   旧实现只在 `input.model.sources`（= **创建者**可见集）里找来源，找不到即 `continue`
    //   ⇒ 不可见来源的证据版本从未落库 ⇒ 更宽可见者 GET 时 `scan_assertion_evidence` 的
    //   复合外键 `(graph, evidence_version_id)` 找不到父行 ⇒ TRANSACTION_ABORTED（HTTP 500）。
    //
    //   「落库」≠「回显」：这些行不进入任何 viewer 的报告 —— 报告仍只由 `model.sources`
    //   （当前 viewer 可见集）生成，因此不改变可见范围语义（DEV DOC §9）。
    //   身份（sourceId/evidenceId/evidenceVersionId）一律取自 `describeSource()` 单一真源。
    for (const preflight of input.preflights) {
      const described = describeSource(input.record.graph, preflight);
      const visible = input.model.sources.find(item => item.source_id === described.sourceId);
      this.db.prepare(
        `INSERT INTO scan_sources(source_id, graph, source_kind, locator, visibility, read_scope_json, egress_scope_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_id) DO NOTHING`,
      ).run(described.sourceId, input.record.graph, preflight.authorization.format,
        preflight.authorization.allowedPath, preflight.authorization.visibility,
        JSON.stringify({ required_as_of: preflight.authorization.requiredAsOf ?? null }), JSON.stringify({ model: false }), input.viewer.sub, now);
      this.db.prepare(
        'INSERT INTO scan_evidence(evidence_id, graph, source_id, registered_by, registered_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(evidence_id) DO NOTHING',
      ).run(described.evidenceId, input.record.graph, described.sourceId, input.viewer.sub, now);
      this.db.prepare(
        `INSERT INTO scan_evidence_versions(evidence_version_id, graph, evidence_id, sha256, size, mtime_ms, observed_at, period, valid_from, valid_to, parse_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(graph, evidence_id, sha256) DO NOTHING`,
      ).run(described.evidenceVersionId, input.record.graph, described.evidenceId,
        preflight.sha256, preflight.size, preflight.mtimeMs,
        visible?.observed_at ?? new Date(preflight.mtimeMs).toISOString(),
        // 不可见来源不参与本次建模 ⇒ 期间/时态/证据态未知：留 NULL，`parse_status` 记 `pending`（未确立），
        // 不冒充 confirmed，也不据此影响任何可见性计算或派生值。
        visible?.period ?? null, visible?.valid_from ?? null, visible?.valid_to ?? null,
        visible?.evidence_status ?? 'pending', now);
    }
  }

  private linkKey(kind: 'node' | 'edge', type: string, businessKey: string): string {
    return `${kind}\u0000${type}\u0000${businessKey}`;
  }

  private findLink(graph: string, kind: 'node' | 'edge', type: string, businessKey: string): string | null {
    const row = this.db.prepare(
      'SELECT object_id FROM scan_ontology_links WHERE graph = ? AND subject_kind = ? AND type = ? AND business_key = ?',
    ).get(graph, kind, type, businessKey) as LinkRow | undefined;
    return row?.object_id ?? null;
  }

  private writeObjects(graph: string, objects: OntologyObjectDraft[]): Map<string, string> {
    const output = new Map<string, string>();
    for (const object of objects) {
      let id = this.findLink(graph, 'node', object.type, object.businessKey);
      if (!id) {
        if (!validateAndLog(object.type, object.props)) {
          throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', `②Schema 校验失败: ${object.businessKey}`);
        }
        id = this.graphStore.createNode(object.type, object.props, graph);
        this.db.prepare('UPDATE graph_nodes SET valid_from = ? WHERE id = ? AND graph = ?').run(object.validFrom, id, graph);
        this.db.prepare(
          'INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES (?, ?, ?, ?, ?)',
        ).run(graph, 'node', object.type, object.businessKey, id);
      }
      output.set(this.linkKey('node', object.type, object.businessKey), id);
    }
    return output;
  }

  private writeRelations(graph: string, relations: OntologyRelationDraft[], objectIds: Map<string, string>): Map<string, string> {
    const output = new Map<string, string>();
    for (const relation of relations) {
      const from = objectIds.get(this.linkKey('node', 'resource/delivery_team', relation.fromBusinessKey));
      const to = objectIds.get(this.linkKey('node', 'activity/delivery_batch', relation.toBusinessKey));
      if (!from || !to) throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', `关系端点缺失: ${relation.businessKey}`);
      let id = this.findLink(graph, 'edge', relation.type, relation.businessKey);
      if (!id) {
        id = this.graphStore.createEdge(relation.type, from, to, 1, relation.props, graph);
        this.db.prepare('UPDATE graph_triples SET valid_from = ? WHERE id = ? AND graph = ?').run(relation.validFrom, id, graph);
        this.db.prepare(
          'INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES (?, ?, ?, ?, ?)',
        ).run(graph, 'edge', relation.type, relation.businessKey, id);
      }
      output.set(this.linkKey('edge', relation.type, relation.businessKey), id);
    }
    return output;
  }

  private writeAssertions(graph: string, assertions: AssertionDraft[], ids: Map<string, string>): void {
    const now = this.clock.nowIso();
    for (const assertion of assertions) {
      const target = ids.get(this.linkKey(assertion.targetKind, assertion.targetType, assertion.targetBusinessKey));
      if (!target) throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', `断言目标缺失: ${assertion.assertionKey}`);
      this.db.prepare(
        `INSERT INTO scan_assertions(assertion_id, graph, assertion_key, target_kind, target_object_id, field, assertion_kind, assertion_type, def_version, formula_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(graph, assertion_key) DO NOTHING`,
      ).run(assertion.assertionId, graph, assertion.assertionKey, assertion.targetKind, target, assertion.field,
        assertion.assertionKind, assertion.assertionType, assertion.defVersion, assertion.formulaRef);
      this.db.prepare(
        `INSERT INTO scan_assertion_versions(assertion_version_id, graph, assertion_id, source_fingerprint, value_json, unit, denominator, evidence_status, instance_state, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(graph, assertion_id, source_fingerprint) DO NOTHING`,
      ).run(assertion.assertionVersionId, graph, assertion.assertionId, assertion.sourceFingerprint,
        assertion.value === null ? null : JSON.stringify(assertion.value), assertion.unit, assertion.denominator,
        assertion.evidenceStatus, assertion.instanceState, assertion.validFrom, assertion.validTo, now);
      for (const evidence of assertion.evidence) {
        try {
          this.db.prepare(
            `INSERT INTO scan_assertion_evidence(graph, assertion_version_id, evidence_version_id, source_ref) VALUES (?, ?, ?, ?)
             ON CONFLICT(graph, assertion_version_id, evidence_version_id, source_ref) DO NOTHING`,
          ).run(graph, assertion.assertionVersionId, evidence.evidenceVersionId, evidence.sourceRef);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const assertionParent = this.db.prepare('SELECT COUNT(*) AS n FROM scan_assertion_versions WHERE graph = ? AND assertion_version_id = ?').get(graph, assertion.assertionVersionId) as { n: number };
          const evidenceParent = this.db.prepare('SELECT COUNT(*) AS n FROM scan_evidence_versions WHERE graph = ? AND evidence_version_id = ?').get(graph, evidence.evidenceVersionId) as { n: number };
          // 🔴 内部标识不得外泄（复核阻塞项 1 附带项）：路由 `respondError` 把本 message 原样写进
          //   500 响应体，故此处**只**保留 SQLite 原始原因与父行计数（计数不是标识，不指向具体对象）。
          throw new Error(`证据关联失败: ${message}; assertionParent=${assertionParent.n}; evidenceParent=${evidenceParent.n}`);
        }
      }
    }
  }

  private writeReport(
    record: RunRecord,
    viewer: ScanViewer,
    visibility: string,
    model: ScanModel,
    objectIds: Map<string, string>,
    relationIds: Map<string, string>,
  ): ScanReport {
    const objectOutput = model.objects.map(object => ({
      ...object,
      object_id: objectIds.get(this.linkKey('node', object.type, object.businessKey)) ?? '',
    }));
    const relationOutput = model.relations.map(relation => ({
      ...relation,
      object_id: relationIds.get(this.linkKey('edge', relation.type, relation.businessKey)) ?? '',
      from: objectIds.get(this.linkKey('node', 'resource/delivery_team', relation.fromBusinessKey)) ?? '',
      to: objectIds.get(this.linkKey('node', 'activity/delivery_batch', relation.toBusinessKey)) ?? '',
    }));
    const report: ScanReport = {
      schema_version: 'enterprise-scan/v1',
      run: {
        run_id: record.runId, graph: record.graph, operation: record.operation,
        status: record.status, manifest_id: record.manifestId, client_request_id: record.clientRequestId,
      },
      sources: model.sources,
      checks: model.checks,
      ontology: { objects: objectOutput, relations: relationOutput },
      assertions: model.assertions.map(assertion => ({
        assertion_id: assertion.assertionId,
        assertion_version_id: assertion.assertionVersionId,
        target: { kind: assertion.targetKind, type: assertion.targetType, businessKey: assertion.targetBusinessKey },
        field: assertion.field,
        assertion_kind: assertion.assertionKind,
        assertion_type: assertion.assertionType,
        value: assertion.value,
        unit: assertion.unit,
        denominator: assertion.denominator,
        evidence_status: assertion.evidenceStatus,
        instance_state: assertion.instanceState,
        defVersion: assertion.defVersion,
        formulaRef: assertion.formulaRef,
        valid_from: assertion.validFrom,
        valid_to: assertion.validTo,
        evidence: assertion.evidence,
      })),
      evidence_gaps: model.evidenceGaps,
      supplement_requests: model.supplementRequests,
      partial_visibility: model.partialVisibility,
    };
    const reportId = stableId('report', record.graph, record.runId, viewer.sub, visibility);
    this.db.prepare(
      `INSERT INTO scan_reports(report_id, graph, run_id, viewer_user_id, visibility_fingerprint, request_fingerprint, partial_visibility, report_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reportId, record.graph, record.runId, viewer.sub, visibility, record.requestFingerprint,
      model.partialVisibility ? 1 : 0, JSON.stringify(report), this.clock.nowIso());
    for (const assertion of model.assertions) {
      this.db.prepare(
        'INSERT INTO scan_report_assertions(graph, report_id, assertion_version_id) VALUES (?, ?, ?)',
      ).run(record.graph, reportId, assertion.assertionVersionId);
    }
    return report;
  }
}
