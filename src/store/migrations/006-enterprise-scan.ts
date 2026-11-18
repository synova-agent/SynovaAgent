/**
 * 迁移 006 — 企业扫描（#1398 / 1B）：11 张 scan_* 表、索引、触发器。
 *
 * 🔴 文件序号为什么是 006（CTO 裁定 12522 D-3）：
 *   `#1258`（分支 `ct/1258a*`，**尚未合 main**）已占用 `005-session-events-v2.ts` 且声明 `version = 6`。
 *   本卡为**避让文件名撞车**取 006，`version` 仍保持 §6 契约的 **6**（`SCHEMA_VERSION = 6`）。
 *   `assertMigrationChain` 只校验「版本连号 `[2,3,4,5,6]` + 末条 == SCHEMA_VERSION」，
 *   文件序号 `NNN+1` 是历史惯例、不是契约 ⇒ 序号与 version 不同步**不会**被门禁误判。
 *
 * 🔴 合入顺序约束（在案）：若 `#1258` **晚于**本票合入，则 `#1258` 必须自行改为 `007 / v7` 并重跑；
 *   禁止二者以同号 `v6` 并存（`assertMigrationChain` 会在**模块 import 期**抛
 *   `MIGRATION_DUPLICATE_VERSION` / `MIGRATION_CHAIN_GAP` ⇒ 启动即红，不是运行时才炸）。
 *   若顺序反转（`#1258` 先合），本文件须重编号为 `007 / v7` 并同步 `SCHEMA_VERSION`。
 *
 * 回滚：无自动 down migration；用迁移前 SQLite `.backup` 恢复 v5（禁 DROP 新表冒充回滚）。
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../schema-migration';

const ENTERPRISE_SCAN_DDL = `
CREATE TABLE scan_runs (
  run_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_by TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(graph, run_id),
  UNIQUE(graph, operation, client_request_id)
);
CREATE TABLE scan_sources (
  source_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  locator TEXT NOT NULL,
  visibility TEXT NOT NULL,
  read_scope_json TEXT NOT NULL,
  egress_scope_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(graph, source_id)
);
CREATE TABLE scan_evidence (
  evidence_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  source_id TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  UNIQUE(graph, evidence_id),
  UNIQUE(graph, source_id),
  FOREIGN KEY(graph, source_id) REFERENCES scan_sources(graph, source_id)
);
CREATE TABLE scan_evidence_versions (
  evidence_version_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  observed_at TEXT NOT NULL,
  period TEXT,
  valid_from TEXT,
  valid_to TEXT,
  parse_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(graph, evidence_version_id),
  UNIQUE(graph, evidence_id, sha256),
  FOREIGN KEY(graph, evidence_id) REFERENCES scan_evidence(graph, evidence_id)
);
CREATE TABLE scan_authorizations (
  graph TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  canonical_root TEXT NOT NULL,
  allowed_path TEXT NOT NULL,
  format TEXT NOT NULL,
  visibility TEXT NOT NULL,
  allowed_roles_json TEXT NOT NULL,
  allowed_users_json TEXT NOT NULL,
  allowed_departments_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(graph, manifest_id, source_id),
  UNIQUE(graph, manifest_id, source_id)
);
CREATE TABLE scan_ontology_links (
  graph TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('node', 'edge')),
  type TEXT NOT NULL,
  business_key TEXT NOT NULL,
  object_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(graph, subject_kind, type, business_key),
  UNIQUE(graph, subject_kind, type, business_key)
);
CREATE TABLE scan_assertions (
  assertion_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  assertion_key TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('node', 'edge')),
  target_object_id TEXT NOT NULL,
  field TEXT NOT NULL,
  assertion_kind TEXT NOT NULL CHECK(assertion_kind IN ('direct', 'derived', 'statement')),
  assertion_type TEXT NOT NULL CHECK(assertion_type IN ('fact', 'inference', 'unknown')),
  def_version TEXT,
  formula_ref TEXT,
  UNIQUE(graph, assertion_id),
  UNIQUE(graph, assertion_key)
);
CREATE TABLE scan_assertion_versions (
  assertion_version_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  assertion_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  value_json TEXT,
  unit TEXT,
  denominator TEXT,
  evidence_status TEXT NOT NULL CHECK(evidence_status IN ('confirmed', 'pending', 'stale', 'conflict')),
  instance_state TEXT NOT NULL CHECK(instance_state IN ('measured', 'derived', 'estimated', 'partial', 'stale', 'conflict', 'missing')),
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(graph, assertion_version_id),
  UNIQUE(graph, assertion_id, source_fingerprint),
  CHECK(value_json IS NOT NULL OR instance_state IN ('missing', 'conflict', 'stale', 'partial')),
  FOREIGN KEY(graph, assertion_id) REFERENCES scan_assertions(graph, assertion_id)
);
CREATE TABLE scan_assertion_evidence (
  graph TEXT NOT NULL,
  assertion_version_id TEXT NOT NULL,
  evidence_version_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  PRIMARY KEY(graph, assertion_version_id, evidence_version_id, source_ref),
  UNIQUE(graph, assertion_version_id, evidence_version_id, source_ref),
  FOREIGN KEY(graph, assertion_version_id) REFERENCES scan_assertion_versions(graph, assertion_version_id),
  FOREIGN KEY(graph, evidence_version_id) REFERENCES scan_evidence_versions(graph, evidence_version_id)
);
CREATE TABLE scan_reports (
  report_id TEXT PRIMARY KEY,
  graph TEXT NOT NULL,
  run_id TEXT NOT NULL,
  viewer_user_id TEXT NOT NULL,
  visibility_fingerprint TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  partial_visibility INTEGER NOT NULL CHECK(partial_visibility IN (0, 1)),
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(graph, report_id),
  UNIQUE(graph, run_id, viewer_user_id, visibility_fingerprint),
  FOREIGN KEY(graph, run_id) REFERENCES scan_runs(graph, run_id)
);
CREATE TABLE scan_report_assertions (
  graph TEXT NOT NULL,
  report_id TEXT NOT NULL,
  assertion_version_id TEXT NOT NULL,
  PRIMARY KEY(graph, report_id, assertion_version_id),
  UNIQUE(graph, report_id, assertion_version_id),
  FOREIGN KEY(graph, report_id) REFERENCES scan_reports(graph, report_id),
  FOREIGN KEY(graph, assertion_version_id) REFERENCES scan_assertion_versions(graph, assertion_version_id)
);
CREATE INDEX idx_scan_evidence_versions_graph_evidence ON scan_evidence_versions(graph, evidence_id);
CREATE INDEX idx_scan_assertion_versions_graph_assertion ON scan_assertion_versions(graph, assertion_id);
CREATE INDEX idx_scan_reports_graph_run ON scan_reports(graph, run_id);

CREATE TRIGGER scan_ontology_links_node_insert
BEFORE INSERT ON scan_ontology_links
WHEN NEW.subject_kind = 'node'
  AND NOT EXISTS(SELECT 1 FROM graph_nodes WHERE id = NEW.object_id AND graph = NEW.graph AND type = NEW.type AND valid_to IS NULL)
BEGIN SELECT RAISE(ABORT, 'scan ontology node graph/type mismatch'); END;
CREATE TRIGGER scan_ontology_links_edge_insert
BEFORE INSERT ON scan_ontology_links
WHEN NEW.subject_kind = 'edge'
  AND NOT EXISTS(SELECT 1 FROM graph_triples WHERE id = NEW.object_id AND graph = NEW.graph AND predicate = NEW.type AND valid_to IS NULL)
BEGIN SELECT RAISE(ABORT, 'scan ontology edge graph/type mismatch'); END;
CREATE TRIGGER scan_assertions_target_insert
BEFORE INSERT ON scan_assertions
WHEN NOT EXISTS(
  SELECT 1 FROM scan_ontology_links
  WHERE graph = NEW.graph AND object_id = NEW.target_object_id AND subject_kind = NEW.target_kind
)
BEGIN SELECT RAISE(ABORT, 'scan assertion target graph mismatch'); END;
`;

export const enterpriseScanMigration: Migration = {
  version: 6,
  name: 'enterprise-scan',
  up: (db: Database.Database): void => {
    db.transaction((): void => {
      db.exec(ENTERPRISE_SCAN_DDL);
    })();
  },
};
