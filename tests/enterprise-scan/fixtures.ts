import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';

export const DELIVERY_BATCHES = `business_key,name,team_business_key,team_name,period,planned_count,delivered_count,accepted_count,valid_from,valid_to,definition_version
delivery_batch:B-2026-10-001,十月华东交付批次,team:delivery-a,交付一组,2026-10,10,10,8,2026-10-01,2026-10-31,delivery-v1
delivery_batch:B-2026-10-002,十月华南交付批次,team:delivery-a,交付一组,2026-10,5,5,5,2026-10-01,2026-10-31,delivery-v1
`;

export const DELIVERY_DASHBOARD = `period,metric,value,unit,definition_version
2026-10,planned_count,15,count,delivery-v1
2026-10,delivered_count,15,count,delivery-v1
2026-10,accepted_count,13,count,delivery-v1
`;

export const DELIVERY_POLICY = `# 交付验收口径
definition_version: delivery-v1
period: 2026-10
assertion: {"businessKey":"delivery_batch:B-2026-10-001","field":"acceptance_definition","value":"客户签署验收单后记为已验收","sourceRef":"delivery-policy.md#L4"}
`;

export const OPERATOR_STATEMENT = `{"statement_id":"stmt-001","speaker":{"user_id":"user-lead-a","role":"responsible","department_id":"dept-delivery"},"said_at":"2026-11-05T09:00:00+08:00","observed_period":"2026-10","about":{"businessKey":"delivery_batch:B-2026-10-001","field":"accepted_count"},"claim":{"value":8,"unit":"count","definition_version":"delivery-v1"},"note":"负责人说明两件交付尚未签署验收单。"}
`;

export const GOLDEN_FILES = {
  'delivery_batches.csv': DELIVERY_BATCHES,
  'delivery_dashboard.csv': DELIVERY_DASHBOARD,
  'delivery-policy.md': DELIVERY_POLICY,
  'operator-statement.json': OPERATOR_STATEMENT,
} as const;

export const SOURCE_IDS = {
  'delivery_batches.csv': 'src-delivery-batches',
  'delivery_dashboard.csv': 'src-delivery-dashboard',
  'delivery-policy.md': 'src-delivery-policy',
  'operator-statement.json': 'src-operator-statement',
} as const;

export function writeFixtureRoot(files: Record<string, string> = GOLDEN_FILES): string {
  const root = mkdtempSync(join(tmpdir(), 'synova-1398-fixtures-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content, { encoding: 'utf8', flag: 'wx' });
  return root;
}

export function seedManifest(
  db: Database.Database,
  options: { graph?: string; manifestId?: string; root: string; files?: Record<string, string>; restricted?: readonly string[]; requiredAsOf?: string },
): void {
  const graph = options.graph ?? 'org-a';
  const manifestId = options.manifestId ?? 'manifest-golden';
  const files = options.files ?? GOLDEN_FILES;
  const restricted = options.restricted ?? [];
  const insertSource = db.prepare(
    `INSERT INTO scan_sources(source_id, graph, source_kind, locator, visibility, read_scope_json, egress_scope_json, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAuthorization = db.prepare(
    `INSERT INTO scan_authorizations(graph, manifest_id, source_id, canonical_root, allowed_path, format, visibility, allowed_roles_json, allowed_users_json, allowed_departments_json, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [name, sourceId] of Object.entries(SOURCE_IDS)) {
    if (!(name in files)) continue;
    const format = name.endsWith('.csv') ? 'csv' : name.endsWith('.md') ? 'md' : 'json';
    const visibility = restricted.includes(name) ? 'restricted' : 'enterprise';
    const readScope = JSON.stringify({ required_as_of: options.requiredAsOf ?? null });
    insertSource.run(`${graph}:${sourceId}`, graph, format, join(options.root, name), visibility, readScope, JSON.stringify({ model: false }), 'seed', '2026-11-01T00:00:00.000Z');
    insertAuthorization.run(graph, manifestId, `${graph}:${sourceId}`, options.root, join(options.root, name), format, visibility,
      JSON.stringify(visibility === 'restricted' ? [] : ['responsible']), JSON.stringify([]),
      JSON.stringify(visibility === 'restricted' ? ['dept-other'] : ['dept-delivery']), 1);
  }
}

export const COUNTS_TABLES = [
  'scan_runs', 'scan_evidence', 'scan_evidence_versions', 'graph_nodes', 'graph_triples', 'scan_ontology_links',
  'scan_assertions', 'scan_assertion_versions', 'scan_assertion_evidence', 'scan_reports', 'scan_report_assertions',
] as const;

export function authorityCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries(COUNTS_TABLES.map(table => [table, (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
}
