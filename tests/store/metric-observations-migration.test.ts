/**
 * tests/store/metric-observations-migration.test.ts — #1431（阶段 2 · T1）迁移 007 判据
 *
 * 判据身份（DEV DOC v2 §7-1）：
 *   · 旧表 `metric_readings` 结构与旧行 **零变化**（改坏必红⑤：迁移顺手改旧表 ⇒ 本文件红）
 *   · 新表 `metric_observations` 按 v2 §3 建表（15 列 / 3 CHECK / 1 唯一 + 2 普通索引）
 *   · **零回填**（新表 0 行）＋ `PRAGMA integrity_check` = ok
 *   · 唯一键 = `(org_id, object_id, metric_id, period)`，**`run_id` 不入唯一键**（改坏必红④）
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`）；v6 夹具用**旧迁移本体**建表（真 DDL）。
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { reconcileSchema, SCHEMA_VERSION } from '../../src/store/schema-migration';
import { metricReadingsMigration } from '../../src/store/migrations/002-metric-readings';
import { metricObservationsMigration } from '../../src/store/migrations/007-metric-observations';

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexInfoRow {
  seqno: number;
  name: string;
}

interface SqlRow {
  type: string;
  name: string;
  sql: string | null;
}

interface OldMetricReadingRow {
  id: number;
  org_id: string;
  metric_id: string;
  entity_id: string;
  value: number;
  unit: string | null;
  observed_at: string;
  source_type: string;
  source_id: string | null;
  is_estimated: number;
  confidence: string;
  evidence_ref: string | null;
  degraded: number;
  created_at: string;
  run_id: string | null;
  input_digest: string | null;
  def_version: string | null;
}

/** v2 §3 DDL 的列顺序（15 列，含 id） */
const EXPECTED_COLUMNS = [
  'id', 'org_id', 'object_id', 'metric_id', 'period', 'value', 'unit',
  'def_version', 'run_id', 'source_type', 'source_id', 'evidence_ref',
  'observed_at', 'degraded', 'created_at',
] as const;

/** NOT NULL 列（id 为 PK，SQLite `table_info` 中 notnull=0） */
const EXPECTED_NOT_NULL = [
  'org_id', 'object_id', 'metric_id', 'period', 'def_version', 'run_id',
  'source_type', 'observed_at', 'degraded', 'created_at',
] as const;

/** 可空列（`value` 可空 = 缺失；unit/source_id/evidence_ref 可空） */
const EXPECTED_NULLABLE = ['value', 'unit', 'source_id', 'evidence_ref'] as const;

const EXPECTED_INDEXES = [
  'ux_metric_observations_key', 'ix_metric_observations_series', 'ix_metric_observations_run',
] as const;

function tableInfo(db: Database.Database, table: string): TableInfoRow[] {
  return db.pragma(`table_info(${table})`) as TableInfoRow[];
}

function tableSql(db: Database.Database, table: string): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string } | undefined;
  return row?.sql ?? '';
}

function indexList(db: Database.Database, table: string): IndexListRow[] {
  return db.pragma(`index_list(${table})`) as IndexListRow[];
}

function indexColumns(db: Database.Database, indexName: string): string[] {
  const rows = db.pragma(`index_info(${indexName})`) as IndexInfoRow[];
  return rows.sort((a, b) => a.seqno - b.seqno).map(r => r.name);
}

function countRows(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function oldMetricReadingRows(db: Database.Database): OldMetricReadingRow[] {
  return db.prepare('SELECT * FROM metric_readings ORDER BY id').all() as OldMetricReadingRow[];
}

/**
 * v6 既有库夹具：`schema_version` 已记到 6 ＋ 旧表 `metric_readings`（迁移 002 本体真 DDL）
 * ＋ 一行旧数据。随后 `reconcileSchema` 只会跑 v7（迁移 007）。
 */
function createV6DbWithLegacyRow(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE schema_version (
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.prepare('INSERT INTO schema_version (version) VALUES (6)').run();
  metricReadingsMigration.up(db);
  db.prepare(`INSERT INTO metric_readings (
    org_id, metric_id, entity_id, value, unit, observed_at, source_type, source_id,
    is_estimated, confidence, evidence_ref, degraded, run_id, input_digest, def_version
  ) VALUES (
    'org-old', 'LEGACY-METRIC', 'entity-1', 7.5, 'ratio', '2026-10-01T00:00:00Z', 'compute', 'src-old',
    0, 'high', 'ev-old', 0, 'run-old', 'digest-old', 'v1'
  )`).run();
  return db;
}

describe('迁移 007：metric_observations（#1431 T1）', () => {
  let db: Database.Database;
  let legacyTableSqlBefore: string;
  let legacyTableInfoBefore: string;
  let legacyRowsBefore: OldMetricReadingRow[];

  beforeEach(() => {
    db = createV6DbWithLegacyRow();
    legacyTableSqlBefore = tableSql(db, 'metric_readings');
    legacyTableInfoBefore = JSON.stringify(tableInfo(db, 'metric_readings'));
    legacyRowsBefore = oldMetricReadingRows(db);
    reconcileSchema(db); // v6 ⇒ 只执行 v7
  });

  afterEach(() => {
    db.close();
  });

  it('迁移元数据：version=7、name=metric-observations；SCHEMA_VERSION=7', () => {
    expect(metricObservationsMigration.version).toBe(7);
    expect(metricObservationsMigration.name).toBe('metric-observations');
    expect(SCHEMA_VERSION).toBe(7);
  });

  it('新表按 v2 §3 建表：15 列且顺序逐字一致；NOT NULL / 可空集合正确', () => {
    const info = tableInfo(db, 'metric_observations');
    expect(info.map(c => c.name)).toEqual([...EXPECTED_COLUMNS]);

    const notNull = info.filter(c => c.notnull === 1).map(c => c.name).sort();
    expect(notNull).toEqual([...EXPECTED_NOT_NULL].sort());

    const nullable = info.filter(c => c.notnull === 0 && c.pk === 0).map(c => c.name).sort();
    expect(nullable).toEqual([...EXPECTED_NULLABLE].sort());

    expect(info.filter(c => c.pk === 1).map(c => c.name)).toEqual(['id']);
  });

  it('列默认值：degraded=0、created_at=datetime(\'now\')；org/object/metric/period/def_version/run_id/source_type/observed_at 无默认值', () => {
    const byName = new Map(tableInfo(db, 'metric_observations').map(c => [c.name, c]));
    expect(byName.get('degraded')?.dflt_value).toBe('0');
    expect(byName.get('created_at')?.dflt_value).toContain("datetime('now')");
    for (const field of ['org_id', 'object_id', 'metric_id', 'period', 'def_version', 'run_id', 'source_type', 'observed_at']) {
      expect(byName.get(field)?.dflt_value).toBeNull();
    }
  });

  it("三条 CHECK 在位（object_id <> '*' / length(period) > 0 / source_type 四值）", () => {
    const sql = tableSql(db, 'metric_observations');
    expect(sql).toContain("CHECK (object_id <> '*')");
    expect(sql).toContain('CHECK (length(period) > 0)');
    expect(sql).toContain("CHECK (source_type IN ('compute','42edge','manual','connector'))");
  });

  it('索引：1 唯一（四键，run_id 不在内）+ 2 普通（序列/运行）', () => {
    const indexes = indexList(db, 'metric_observations');
    expect(indexes.map(i => i.name).sort()).toEqual([...EXPECTED_INDEXES].sort());
    expect(indexes.filter(i => i.unique === 1).map(i => i.name)).toEqual(['ux_metric_observations_key']);

    const uniqueCols = indexColumns(db, 'ux_metric_observations_key');
    expect(uniqueCols).toEqual(['org_id', 'object_id', 'metric_id', 'period']);
    expect(uniqueCols).not.toContain('run_id');

    expect(indexColumns(db, 'ix_metric_observations_series'))
      .toEqual(['org_id', 'object_id', 'metric_id', 'period']);
    expect(indexColumns(db, 'ix_metric_observations_run')).toEqual(['org_id', 'run_id']);
  });

  it('反例 1：旧表结构零变化、旧行零变化、零回填、integrity_check=ok', () => {
    expect(tableSql(db, 'metric_readings')).toBe(legacyTableSqlBefore);
    expect(JSON.stringify(tableInfo(db, 'metric_readings'))).toBe(legacyTableInfoBefore);
    expect(oldMetricReadingRows(db)).toEqual(legacyRowsBefore);
    expect(legacyRowsBefore).toHaveLength(1);

    expect(countRows(db, 'metric_observations')).toBe(0); // 零回填

    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity).toHaveLength(1);
    expect(integrity[0].integrity_check).toBe('ok');
  });

  it('版本推进：schema_version 最大数值版本 = 7（v6 ⇒ v7，追加一行）', () => {
    const row = db.prepare(
      "SELECT MAX(version) AS v FROM schema_version WHERE typeof(version) = 'integer'",
    ).get() as { v: number };
    expect(row.v).toBe(7);
  });

  it('幂等：再跑 reconcileSchema ⇒ 不抛、新表仍空、旧行不变、索引进数不变', () => {
    expect(() => reconcileSchema(db)).not.toThrow();
    expect(countRows(db, 'metric_observations')).toBe(0);
    expect(oldMetricReadingRows(db)).toEqual(legacyRowsBefore);
    expect(indexList(db, 'metric_observations')).toHaveLength(3);
  });

  it('DDL 兜底：直插违反 CHECK 的三类行全部被拒（* / 空 period / 越界 source_type）', () => {
    const insert = db.prepare(`INSERT INTO metric_observations
      (org_id, object_id, metric_id, period, value, def_version, run_id, source_type, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    expect(() => insert.run('org-a', '*', 'm', '2026-10', 1, 'v1', 'r1', 'compute', 't')).toThrow(/CHECK constraint failed/i);
    expect(() => insert.run('org-a', 'obj-1', 'm', '', 1, 'v1', 'r1', 'compute', 't')).toThrow(/CHECK constraint failed/i);
    expect(() => insert.run('org-a', 'obj-1', 'm', '2026-10', 1, 'v1', 'r1', 'spreadsheet', 't')).toThrow(/CHECK constraint failed/i);
    expect(countRows(db, 'metric_observations')).toBe(0);
  });

  it('全新库：全量迁移后新表存在且为空（旧表也在，互不影响）', () => {
    const fresh = new Database(':memory:');
    try {
      reconcileSchema(fresh);
      expect(tableInfo(fresh, 'metric_observations').map(c => c.name)).toEqual([...EXPECTED_COLUMNS]);
      expect(countRows(fresh, 'metric_observations')).toBe(0);
      expect(tableInfo(fresh, 'metric_readings')).toHaveLength(17);
      const integrity = fresh.pragma('integrity_check') as Array<{ integrity_check: string }>;
      expect(integrity[0].integrity_check).toBe('ok');
    } finally {
      fresh.close();
    }
  });
});
