import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { enterpriseScanMigration } from '../../src/store/migrations/006-enterprise-scan';
import { reconcileSchema, SchemaMigrationError, SCHEMA_VERSION } from '../../src/store/schema-migration';
import { seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

const GRAPH_DDL = `
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL, name TEXT,
  props TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT
);
CREATE TABLE graph_triples (
  id TEXT PRIMARY KEY, graph TEXT NOT NULL DEFAULT 'default', subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL, predicate TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0, props TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT
);
CREATE TABLE schema_version(version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO schema_version(version) VALUES (5);
`;

function v5Db(): Database.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(GRAPH_DDL);
  db.prepare("INSERT INTO graph_nodes(id, graph, type, name, props) VALUES ('old-node', 'org-a', 'resource/team', '旧团队', '{}')").run();
  return db;
}

describe('#1398 v6 真实迁移、约束与备份恢复', () => {
  it('空库到6、真实v5到6、重复迁移零变化且旧表DDL/旧行不变', () => {
    const empty = new BetterSqlite3(':memory:');
    reconcileSchema(empty);
    expect(empty.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 6 });
    expect(empty.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'scan_%'").get()).toEqual({ n: 11 });
    empty.close();

    const db = v5Db();
    const oldDdl = db.prepare("SELECT sql FROM sqlite_master WHERE name='graph_nodes'").get();
    const oldRow = db.prepare("SELECT * FROM graph_nodes WHERE id='old-node'").get();
    reconcileSchema(db);
    const firstHistory = db.prepare('SELECT COUNT(*) AS n FROM schema_version').get();
    reconcileSchema(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).toEqual(firstHistory);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='graph_nodes'").get()).toEqual(oldDdl);
    expect(db.prepare("SELECT * FROM graph_nodes WHERE id='old-node'").get()).toEqual(oldRow);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('迁移DDL失败整体回滚且schema_version保持5', () => {
    const db = v5Db();
    db.exec('CREATE TABLE scan_reports(incompatible TEXT)');
    expect(() => enterpriseScanMigration.up(db)).toThrow();
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 5 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='scan_runs'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='scan_assertions'").get()).toEqual({ n: 0 });
    db.close();
  });

  it('同graph合法关联成功，跨graph断言/证据/报告关联和②链接失败', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const root = writeFixtureRoot();
      seedManifest(db, { root });
      const { report } = await service.run(viewer(), 'manifest-golden', 'constraints');
      const assertionVersion = report.assertions[0].assertion_version_id;
      const evidenceVersion = report.sources[0].evidence_version_id;
      expect(typeof assertionVersion).toBe('string');
      expect(typeof evidenceVersion).toBe('string');
      db.prepare('INSERT INTO scan_assertion_evidence(graph, assertion_version_id, evidence_version_id, source_ref) VALUES (?, ?, ?, ?)')
        .run('org-a', assertionVersion, evidenceVersion, 'manual-same-graph');
      expect(() => db.prepare('INSERT INTO scan_assertion_evidence(graph, assertion_version_id, evidence_version_id, source_ref) VALUES (?, ?, ?, ?)')
        .run('org-b', assertionVersion, evidenceVersion, 'cross-graph')).toThrow();
      const objectId = report.ontology.objects[0].object_id;
      expect(() => db.prepare("INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES ('org-b', 'node', 'activity/delivery_batch', 'cross', ?)")
        .run(objectId)).toThrow(/graph\/type mismatch/);
      const reportId = db.prepare('SELECT report_id FROM scan_reports WHERE graph = ?').get('org-a') as { report_id: string };
      expect(() => db.prepare('INSERT INTO scan_report_assertions(graph, report_id, assertion_version_id) VALUES (?, ?, ?)')
        .run('org-b', reportId.report_id, assertionVersion)).toThrow();
      expect(db.pragma('foreign_key_check')).toEqual([]);
      const unique = db.pragma('index_list(scan_evidence_versions)') as Array<{ name: string; unique: number }>;
      expect(unique.some(index => index.unique === 1)).toBe(true);
    } finally { close(); }
  });

  it('旧构建读更高版本fail-closed，备份恢复v5后旧图行为可读', async () => {
    const tooNew = v5Db();
    tooNew.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION + 1);
    expect(() => reconcileSchema(tooNew)).toThrow(SchemaMigrationError);
    try { reconcileSchema(tooNew); } catch (error) { expect((error as SchemaMigrationError).code).toBe('SCHEMA_TOO_NEW'); }
    tooNew.close();

    const directory = mkdtempSync(join(tmpdir(), 'synova-1398-migration-backup-'));
    const livePath = join(directory, 'live.db');
    const backupPath = join(directory, 'v5.backup');
    const live = new BetterSqlite3(livePath);
    live.exec(GRAPH_DDL);
    live.prepare("INSERT INTO graph_nodes(id, graph, type, name, props) VALUES ('old-node', 'org-a', 'resource/team', '旧团队', '{}')").run();
    await live.backup(backupPath);
    reconcileSchema(live);
    expect(live.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 6 });
    live.close();
    const backup = new BetterSqlite3(backupPath);
    await backup.backup(livePath);
    backup.close();
    const restored = new BetterSqlite3(livePath);
    expect(restored.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 5 });
    expect(restored.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='scan_runs'").get()).toEqual({ n: 0 });
    expect(restored.prepare("SELECT type FROM graph_nodes WHERE id = 'old-node' AND graph = 'org-a'").get()).toEqual({ type: 'resource/team' });
    expect(restored.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 5 });
    restored.close();
  });
});
