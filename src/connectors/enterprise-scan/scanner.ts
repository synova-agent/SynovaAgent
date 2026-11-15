import { canonicalJson, fingerprint, stableId } from './canonical';
import { EnterpriseScanError } from './errors';
import { authorizedFileName } from './path-authorizer';
import {
  parseDashboard,
  parseDeliveryBatches,
  parseOperatorStatement,
  parsePolicy,
  type DashboardRow,
  type DeliveryBatchRow,
  type OperatorStatement,
  type PolicyAssertion,
} from './parsers';
import type {
  AssertionDraft,
  DashboardCheck,
  EvidenceGap,
  EvidenceLink,
  EvidenceStatus,
  InstanceState,
  OntologyObjectDraft,
  OntologyRelationDraft,
  PreflightSource,
  ScanModel,
  SourceDescriptor,
  SourceReport,
  SupplementRequest,
} from './types';

interface AssertionInput {
  key: string;
  targetType: string;
  targetBusinessKey: string;
  field: string;
  kind: 'direct' | 'derived' | 'statement';
  type: 'fact' | 'inference' | 'unknown';
  defVersion?: string | null;
  formulaRef?: string | null;
  value: unknown;
  unit?: string | null;
  denominator?: string | null;
  evidenceStatus: EvidenceStatus;
  instanceState: InstanceState;
  validFrom?: string | null;
  validTo?: string | null;
  evidence: EvidenceLink[];
  fingerprintMaterial: unknown;
}

/**
 * 来源身份（`sourceId` / `evidenceId` / `evidenceVersionId`）的**单一真源**。
 *
 * 🔴 导出原因（1B 复核阻塞项 1）：L4 持久化层必须为「**全部授权来源**」落证据版本，
 *   而不能只落创建者可见集 —— 否则更宽可见者 GET 时 `scan_assertion_evidence` 的复合外键
 *   找不到父行。两条路径必须用**同一公式**推 ID，故此处导出、由 store 复用，禁止第二份公式。
 */
export function describeSource(graph: string, preflight: PreflightSource): SourceDescriptor {
  const sourceId = preflight.authorization.sourceId;
  const evidenceId = stableId('evidence', graph, sourceId);
  return {
    sourceId,
    fileName: authorizedFileName(preflight.authorization),
    evidenceId,
    evidenceVersionId: stableId('evidence-version', graph, evidenceId, preflight.sha256),
    preflight,
  };
}

function evidenceLink(source: SourceDescriptor, sourceRef: string): EvidenceLink {
  return { evidenceVersionId: source.evidenceVersionId, sourceRef };
}

function assertion(graph: string, input: AssertionInput): AssertionDraft {
  const assertionId = stableId('assertion', graph, input.key);
  const sourceFingerprint = fingerprint(input.fingerprintMaterial);
  return {
    assertionId,
    assertionVersionId: stableId('assertion-version', graph, assertionId, sourceFingerprint),
    assertionKey: input.key,
    targetKind: 'node',
    targetType: input.targetType,
    targetBusinessKey: input.targetBusinessKey,
    field: input.field,
    assertionKind: input.kind,
    assertionType: input.type,
    defVersion: input.defVersion ?? null,
    formulaRef: input.formulaRef ?? null,
    sourceFingerprint,
    value: input.value,
    unit: input.unit ?? null,
    denominator: input.denominator ?? null,
    evidenceStatus: input.evidenceStatus,
    instanceState: input.instanceState,
    validFrom: input.validFrom ?? null,
    validTo: input.validTo ?? null,
    evidence: input.evidence,
  };
}

function isStale(validTo: string, requiredAsOf?: string): boolean {
  return requiredAsOf !== undefined && validTo < requiredAsOf;
}

function distinctValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const output: unknown[] = [];
  for (const value of values) {
    const key = canonicalJson(value);
    if (!seen.has(key)) { seen.add(key); output.push(value); }
  }
  return output;
}

function sumMetric(groups: Map<string, DeliveryBatchRow[]>, metric: 'planned' | 'delivered' | 'accepted'): { value: number | null; conflict: boolean; missing: boolean } {
  if (groups.size === 0) return { value: null, conflict: false, missing: true };
  let total = 0;
  let conflict = false;
  let missing = false;
  for (const rows of groups.values()) {
    const values = distinctValues(rows.map(row => row[metric]));
    if (values.length !== 1) {
      conflict = true;
      continue;
    }
    const value = values[0];
    if (value === null) { missing = true; continue; }
    if (typeof value !== 'number') throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', '汇总遇到非数值');
    total += value;
  }
  return { value: conflict || missing ? null : total, conflict, missing };
}

function sourcePeriod(source: SourceDescriptor, batches: DeliveryBatchRow[], dashboard: DashboardRow[], policies: PolicyAssertion[], statement?: OperatorStatement): string | null {
  if (batches.length > 0) return batches[0].period;
  if (dashboard.length > 0) return dashboard[0].period;
  if (policies.length > 0) return policies[0].period;
  if (statement && source.fileName === 'operator-statement.json') return statement.observedPeriod;
  return null;
}

export function buildScanModel(graph: string, preflights: PreflightSource[], partialVisibility: boolean): ScanModel {
  const descriptors = preflights.map(preflight => describeSource(graph, preflight));
  const byName = new Map(descriptors.map(item => [item.fileName, item]));
  const batchSource = byName.get('delivery_batches.csv');
  const dashboardSource = byName.get('delivery_dashboard.csv');
  const policySource = byName.get('delivery-policy.md');
  const statementSource = byName.get('operator-statement.json');
  const batches = batchSource ? parseDeliveryBatches(batchSource.preflight.content) : [];
  const dashboard = dashboardSource ? parseDashboard(dashboardSource.preflight.content) : [];
  const policies = policySource ? parsePolicy(policySource.preflight.content) : [];
  const statement = statementSource ? parseOperatorStatement(statementSource.preflight.content) : undefined;

  const objects = new Map<string, OntologyObjectDraft>();
  const relations = new Map<string, OntologyRelationDraft>();
  const assertions: AssertionDraft[] = [];
  const gaps: EvidenceGap[] = [];
  const supplements: SupplementRequest[] = [];
  const internal: Array<Record<string, unknown>> = [];
  const crossSource: Array<Record<string, unknown>> = [];

  const groups = new Map<string, DeliveryBatchRow[]>();
  for (const row of batches) {
    const group = groups.get(row.business_key) ?? [];
    group.push(row);
    groups.set(row.business_key, group);
    if (!objects.has(row.team_business_key)) {
      objects.set(row.team_business_key, {
        type: 'resource/delivery_team',
        businessKey: row.team_business_key,
        name: row.team_name,
        props: { businessKey: row.team_business_key, name: row.team_name, sourceIds: batchSource ? [batchSource.evidenceId] : [] },
        validFrom: row.valid_from,
      });
    } else {
      const team = objects.get(row.team_business_key);
      if (team && team.name !== row.team_name) {
        const names = distinctValues([team.name, row.team_name]);
        team.props.name_conflicts = names;
      }
    }
    if (!objects.has(row.business_key)) {
      objects.set(row.business_key, {
        type: 'activity/delivery_batch',
        businessKey: row.business_key,
        name: row.name,
        props: {
          businessKey: row.business_key,
          name: row.name,
          teamBusinessKey: row.team_business_key,
          period: row.period,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          defVersion: row.definition_version,
          sourceIds: batchSource ? [batchSource.evidenceId] : [],
        },
        validFrom: row.valid_from,
      });
    } else {
      const batch = objects.get(row.business_key);
      if (batch && batch.name !== row.name) batch.props.name_conflicts = distinctValues([batch.name, row.name]);
    }
    const relationKey = `${row.team_business_key}->${row.business_key}`;
    if (!relations.has(relationKey)) {
      relations.set(relationKey, {
        type: 'edge/team_executes_activity',
        businessKey: relationKey,
        fromBusinessKey: row.team_business_key,
        toBusinessKey: row.business_key,
        props: { businessKey: relationKey, period: row.period, sourceIds: batchSource ? [batchSource.evidenceId] : [] },
        validFrom: row.valid_from,
      });
    }
    if (isStale(row.valid_to, batchSource?.preflight.authorization.requiredAsOf)) {
      internal.push({ source_id: batchSource?.sourceId, source_ref: `${batchSource?.fileName}#L${row.line}`, status: 'stale', valid_to: row.valid_to });
    }
  }

  const resultKey = 'delivery_result:2026-10';
  const resultPeriod = batches[0]?.period ?? dashboard[0]?.period ?? policies[0]?.period ?? statement?.observedPeriod;
  if (resultPeriod) {
    const dynamicResultKey = `delivery_result:${resultPeriod}`;
    const sourceIds = [batchSource?.evidenceId, dashboardSource?.evidenceId].filter((value): value is string => value !== undefined);
    objects.set(dynamicResultKey, {
      type: 'outcome/delivery_result',
      businessKey: dynamicResultKey,
      name: `${resultPeriod} 交付结果`,
      props: { businessKey: dynamicResultKey, name: `${resultPeriod} 交付结果`, period: resultPeriod, sourceIds },
      validFrom: `${resultPeriod}-01`,
    });
  }
  const actualResultKey = resultPeriod ? `delivery_result:${resultPeriod}` : resultKey;

  if (batchSource) {
    for (const [businessKey, rows] of groups) {
      const first = rows[0];
      const values = distinctValues(rows.map(row => row.accepted));
      const stale = rows.some(row => isStale(row.valid_to, batchSource.preflight.authorization.requiredAsOf));
      const missing = values.length === 1 && values[0] === null;
      const conflict = values.length > 1;
      const value = conflict ? values : values[0];
      const links = rows.map(row => evidenceLink(batchSource, `${batchSource.fileName}#L${row.line}`));
      assertions.push(assertion(graph, {
        key: `batch:${businessKey}:accepted_count`,
        targetType: 'activity/delivery_batch', targetBusinessKey: businessKey, field: 'accepted_count',
        kind: 'direct', type: missing ? 'unknown' : 'fact', defVersion: first.definition_version,
        value, unit: 'count', evidenceStatus: conflict ? 'conflict' : stale ? 'stale' : missing ? 'pending' : 'confirmed',
        instanceState: conflict ? 'conflict' : stale ? 'stale' : missing ? 'missing' : 'measured',
        validFrom: first.valid_from, validTo: first.valid_to, evidence: links,
        fingerprintMaterial: { evidenceVersionId: batchSource.evidenceVersionId, rows: rows.map(row => row.line) },
      }));
      if (conflict) internal.push({ source_id: batchSource.sourceId, businessKey, field: 'accepted_count', status: 'conflict', values });
      if (missing) {
        const unknownId = stableId('unknown', graph, businessKey, 'accepted_count');
        gaps.push({ unknown_id: unknownId, question: `${businessKey} 的 accepted_count 缺失`, source_ref: `${batchSource.fileName}#L${first.line}`, field: 'accepted_count', period: first.period, blocking: false });
        supplements.push({ unknown_id: unknownId, required_source: batchSource.fileName, field: 'accepted_count', period: first.period, recompute: '补齐源列后重新计算 delivery_result accepted_count 与看板对账' });
      }
    }
  }

  if (dashboardSource) {
    for (const row of dashboard) {
      assertions.push(assertion(graph, {
        key: `dashboard:${row.period}:${row.metric}`,
        targetType: 'outcome/delivery_result', targetBusinessKey: actualResultKey, field: `dashboard_${row.metric}`,
        kind: 'direct', type: 'fact', defVersion: row.definitionVersion, value: row.value, unit: row.unit,
        evidenceStatus: 'confirmed', instanceState: 'measured', validFrom: `${row.period}-01`,
        evidence: [evidenceLink(dashboardSource, `${dashboardSource.fileName}#L${row.line}`)],
        fingerprintMaterial: { evidenceVersionId: dashboardSource.evidenceVersionId, row: row.line },
      }));
    }
  }

  const dashboardChecks: DashboardCheck[] = [];
  for (const metric of ['planned_count', 'delivered_count', 'accepted_count'] as const) {
    const shortMetric = metric.replace('_count', '') as 'planned' | 'delivered' | 'accepted';
    const sum = sumMetric(groups, shortMetric);
    const dashboardRow = dashboard.find(row => row.metric === metric);
    const period = dashboardRow?.period ?? resultPeriod ?? '';
    const dashboardValue = dashboardRow?.value ?? null;
    const match = sum.value === null || dashboardValue === null ? null : sum.value === dashboardValue;
    const difference = sum.value === null || dashboardValue === null ? null : dashboardValue - sum.value;
    dashboardChecks.push({ period, metric, calculated: sum.value, dashboard: dashboardValue, calculation_match: match, difference });
    const evidence: EvidenceLink[] = [];
    if (batchSource) evidence.push(evidenceLink(batchSource, `${batchSource.fileName}#L2-L${batches.length + 1}`));
    if (dashboardSource && dashboardRow) evidence.push(evidenceLink(dashboardSource, `${dashboardSource.fileName}#L${dashboardRow.line}`));
    const stale = batches.some(row => isStale(row.valid_to, batchSource?.preflight.authorization.requiredAsOf));
    assertions.push(assertion(graph, {
      key: `derived:${period}:${metric}`,
      targetType: 'outcome/delivery_result', targetBusinessKey: actualResultKey, field: metric,
      kind: 'derived', type: sum.value === null ? 'unknown' : 'fact', defVersion: dashboardRow?.definitionVersion ?? batches[0]?.definition_version,
      formulaRef: `sum(delivery_batches.${metric})`, value: sum.value, unit: dashboardRow?.unit ?? 'count',
      denominator: '全部可见 delivery_batch 自然键分组，每组仅接受唯一值；缺失或冲突不补零',
      evidenceStatus: match === false || sum.conflict ? 'conflict' : stale ? 'stale' : sum.value === null ? 'pending' : 'confirmed',
      instanceState: match === false || sum.conflict ? 'conflict' : stale ? 'stale' : sum.value === null ? 'missing' : 'derived',
      validFrom: period ? `${period}-01` : null,
      evidence,
      fingerprintMaterial: { metric, inputs: evidence.map(link => link.evidenceVersionId).sort(), groupValues: [...groups.values()].map(rows => rows.map(row => row[shortMetric])) },
    }));
  }

  if (policySource) {
    for (const [index, policy] of policies.entries()) {
      if (!objects.has(policy.businessKey)) throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', `文档断言指向不存在对象: ${policy.businessKey}`);
      assertions.push(assertion(graph, {
        key: `policy:${policy.businessKey}:${policy.field}`,
        targetType: 'activity/delivery_batch', targetBusinessKey: policy.businessKey, field: policy.field,
        kind: 'direct', type: 'fact', defVersion: policy.definitionVersion, value: policy.value,
        evidenceStatus: 'confirmed', instanceState: 'measured', validFrom: `${policy.period}-01`,
        evidence: [evidenceLink(policySource, policy.sourceRef)],
        fingerprintMaterial: { evidenceVersionId: policySource.evidenceVersionId, assertion: index },
      }));
    }
  }

  if (statementSource && statement) {
    if (!objects.has(statement.about.businessKey)) throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', `人的说明指向不存在对象: ${statement.about.businessKey}`);
    assertions.push(assertion(graph, {
      key: `statement-event:${statement.statementId}`,
      targetType: 'activity/delivery_batch', targetBusinessKey: statement.about.businessKey, field: `statement:${statement.statementId}`,
      kind: 'statement', type: 'fact', defVersion: statement.claim.definitionVersion,
      value: { speaker: statement.speaker, said_at: statement.saidAt, observed_period: statement.observedPeriod, about: statement.about, claim: statement.claim, note: statement.note },
      evidenceStatus: 'confirmed', instanceState: 'measured', validFrom: statement.saidAt,
      evidence: [evidenceLink(statementSource, 'operator-statement.json')],
      fingerprintMaterial: { evidenceVersionId: statementSource.evidenceVersionId, event: statement.statementId },
    }));
    const direct = assertions.find(item => item.assertionKey === `batch:${statement.about.businessKey}:${statement.about.field}`);
    const differs = direct !== undefined && canonicalJson(direct.value) !== canonicalJson(statement.claim.value);
    if (differs && direct) {
      direct.evidenceStatus = 'conflict';
      direct.instanceState = 'conflict';
      direct.evidence.push(evidenceLink(statementSource, 'operator-statement.json'));
      direct.sourceFingerprint = fingerprint({ previous: direct.sourceFingerprint, statementEvidenceVersionId: statementSource.evidenceVersionId });
      direct.assertionVersionId = stableId('assertion-version', graph, direct.assertionId, direct.sourceFingerprint);
      crossSource.push({ status: 'conflict', businessKey: statement.about.businessKey, field: statement.about.field, values: [direct.value, statement.claim.value] });
    }
    assertions.push(assertion(graph, {
      key: `statement-claim:${statement.statementId}`,
      targetType: 'activity/delivery_batch', targetBusinessKey: statement.about.businessKey, field: statement.about.field,
      kind: 'statement', type: 'inference', defVersion: statement.claim.definitionVersion,
      value: statement.claim.value, unit: statement.claim.unit,
      evidenceStatus: differs ? 'conflict' : 'pending', instanceState: differs ? 'conflict' : 'estimated',
      validFrom: statement.saidAt,
      evidence: [evidenceLink(statementSource, 'operator-statement.json')],
      fingerprintMaterial: { evidenceVersionId: statementSource.evidenceVersionId, claim: statement.statementId },
    }));
  }

  const sources: SourceReport[] = descriptors.map(source => {
    const stale = source === batchSource && batches.some(row => isStale(row.valid_to, source.preflight.authorization.requiredAsOf));
    return {
      source_id: source.sourceId,
      evidence_id: source.evidenceId,
      evidence_version_id: source.evidenceVersionId,
      format: source.preflight.authorization.format,
      sha256: source.preflight.sha256,
      size: source.preflight.size,
      observed_at: new Date(source.preflight.mtimeMs).toISOString(),
      period: sourcePeriod(source, source === batchSource ? batches : [], source === dashboardSource ? dashboard : [], source === policySource ? policies : [], statement),
      valid_from: source === batchSource ? batches[0]?.valid_from ?? null : null,
      valid_to: source === batchSource ? batches[0]?.valid_to ?? null : null,
      visibility: source.preflight.authorization.visibility,
      evidence_status: stale ? 'stale' : 'confirmed',
      instance_state: stale ? 'stale' : 'measured',
    };
  });

  if (objects.size === 0 || assertions.length === 0) {
    throw new EnterpriseScanError('SCHEMA_MAPPING_FAILED', 'mapping', '可见来源未形成任何②对象或断言，禁止空扫描成功');
  }

  return {
    sources,
    objects: [...objects.values()],
    relations: [...relations.values()],
    assertions,
    checks: { source_internal: internal, dashboard: dashboardChecks, cross_source: crossSource },
    evidenceGaps: gaps,
    supplementRequests: supplements,
    partialVisibility,
  };
}
