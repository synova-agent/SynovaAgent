/**
 * tests/store/metric-readings-schema.test.ts — #1053（2-1a）表结构判据
 *
 * 判据身份：本文件是卡面 §⑥ `V1`（表结构）+ `V6`（删除安全）的**可复跑载体**。
 * 库口径：**临时库（:memory: + mkdtemp 真文件库）**，**禁 `data/synova.db`**
 *   （`data/` 被 `.gitignore:3` 排除 ⇒ 干净检出/评审环境跑不出来，R61/R87）。
 * 列口径：**17 列（含 id）**；「16 列（不含 id）」仅作集合说明，不作判据。
 *
 * 覆盖面（本卡边界，逐字）：**时序表已建**（覆盖面 = 表结构 + 3 索引 + 唯一约束 + 不变量 CHECK；
 *   **写入侧未接**（2-1b #1054）；**查询/聚合未接**）。
 *
 * 铁律 33: *.test.ts 单元测试（`:memory:` SQLite）
 * 铁律 38: 零不安全类型断言（只用内联结构类型）
 * 铁律 48: 全部用例含 expect()，覆盖正常 / 幂等 / 边界 / 删除安全
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';

let reconcileSchema: (db: Database.Database) => void;
let SCHEMA_VERSION: number;

async function loadModules() {
  const mod = await import('../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
  SCHEMA_VERSION = mod.SCHEMA_VERSION;
}

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

/** 临时**真文件**库（mkdtemp；照 `tests/growth/evolution-writeback-runtime.integration.test.ts` 形态） */
function createTempFileDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'metric-readings-schema-'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(join(dir, 'probe.db'));
}

/** 卡面口径：17 列（含 id），顺序即 DDL 顺序 */
const EXPECTED_COLUMNS = [
  'id', 'org_id', 'metric_id', 'entity_id', 'value', 'unit', 'observed_at',
  'source_type', 'source_id', 'is_estimated', 'confidence', 'evidence_ref',
  'degraded', 'created_at', 'run_id', 'input_digest', 'def_version',
] as const;

/** 10 个 NOT NULL 列（= 卡面 §③-7「必填 10 列」）；id 为 PK，SQLite 语义即非空 */
const EXPECTED_NOT_NULL = [
  'org_id', 'metric_id', 'entity_id', 'value', 'observed_at',
  'source_type', 'is_estimated', 'confidence', 'degraded', 'created_at',
] as const;

/** 6 个可空列（= archive/25 的 unit/source_id/evidence_ref + R4 三列） */
const EXPECTED_NULLABLE = [
  'unit', 'source_id', 'evidence_ref', 'run_id', 'input_digest', 'def_version',
] as const;

const EXPECTED_INDEXES = [
  'ux_metric_readings_key', 'ix_metric_readings_series', 'ix_metric_readings_source',
] as const;

interface TableInfoRow { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
interface IndexListRow { name: string; unique: number }
interface IndexInfoRow { name: string; seqno: number }
interface SqlRow { type: string; name: string; sql: string | null }

function tableInfo(db: Database.Database): TableInfoRow[] {
  return db.pragma('table_info(metric_readings)') as TableInfoRow[];
}

function indexList(db: Database.Database): IndexListRow[] {
  return db.pragma('index_list(metric_readings)') as IndexListRow[];
}

function indexColumns(db: Database.Database, indexName: string): string[] {
  const rows = db.pragma(`index_info(${indexName})`) as IndexInfoRow[];
  return rows.sort((a, b) => a.seqno - b.seqno).map(r => r.name);
}

function metricReadingsSql(db: Database.Database): SqlRow[] {
  return db.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%metric_readings%' ORDER BY type, name",
  ).all() as SqlRow[];
}

describe('metric_readings 表结构（#1053 / 2-1a · V1）', () => {
  let db: Database.Database;

  beforeEach(async () => {
    await loadModules();
    db = createMemoryDb();
    reconcileSchema(db);
  });

  it('表存在且列集合与顺序 = 17 列（含 id 口径）', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='metric_readings'",
    ).all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const cols = tableInfo(db).map(c => c.name);
    expect(cols).toHaveLength(17);
    expect(cols).toEqual([...EXPECTED_COLUMNS]);
  });

  it('NOT NULL 集合 = 10 列；PK = id；可空集合 = 6 列', () => {
    const info = tableInfo(db);
    const notNull = info.filter(c => c.notnull === 1).map(c => c.name);
    expect(notNull.sort()).toEqual([...EXPECTED_NOT_NULL].sort());

    expect(info.filter(c => c.pk === 1).map(c => c.name)).toEqual(['id']);

    const nullable = info.filter(c => c.notnull === 0 && c.pk === 0).map(c => c.name);
    expect(nullable.sort()).toEqual([...EXPECTED_NULLABLE].sort());
  });

  it('默认值逐列正确（entity_id/*、is_estimated/0、confidence/medium、degraded/0、created_at/datetime）', () => {
    const byName = new Map(tableInfo(db).map(c => [c.name, c]));
    expect(byName.get('entity_id')?.dflt_value).toBe("'*'");
    expect(byName.get('is_estimated')?.dflt_value).toBe('0');
    expect(byName.get('confidence')?.dflt_value).toBe("'medium'");
    expect(byName.get('degraded')?.dflt_value).toBe('0');
    expect(byName.get('created_at')?.dflt_value).toContain("datetime('now')");
    // org_id 无默认值（宪章 H2：不留单租户假设）
    expect(byName.get('org_id')?.dflt_value).toBeNull();
  });

  it('三条 CHECK 在位（source_type 四值 / confidence 三值 / R4 三列不变量）', () => {
    const row = metricReadingsSql(db).find(r => r.type === 'table');
    expect(row?.sql).toBeTruthy();
    const sql = row?.sql ?? '';
    expect(sql).toContain("CHECK(source_type IN ('compute','42edge','manual','connector'))");
    expect(sql).toContain("CHECK(confidence IN ('high','medium','low'))");
    expect(sql).toContain('CHECK (degraded = 1 OR (run_id IS NOT NULL AND input_digest IS NOT NULL AND def_version IS NOT NULL))');
  });

  it('3 个索引齐全：1 唯一（业务键）+ 2 普通（序列/来源）', () => {
    const idx = indexList(db);
    expect(idx.map(i => i.name).sort()).toEqual([...EXPECTED_INDEXES].sort());
    expect(idx.filter(i => i.unique === 1).map(i => i.name)).toEqual(['ux_metric_readings_key']);
    expect(idx.filter(i => i.unique === 0).map(i => i.name).sort())
      .toEqual(['ix_metric_readings_series', 'ix_metric_readings_source']);
  });

  it('索引列与顺序逐条正确（唯一键四列 / 序列三列 / 来源两列）', () => {
    expect(indexColumns(db, 'ux_metric_readings_key'))
      .toEqual(['org_id', 'metric_id', 'entity_id', 'observed_at']);
    expect(indexColumns(db, 'ix_metric_readings_series'))
      .toEqual(['org_id', 'metric_id', 'observed_at']);
    expect(indexColumns(db, 'ix_metric_readings_source'))
      .toEqual(['source_type', 'source_id']);
  });

  it('序列索引带 DESC（时间窗主读路径）', () => {
    const row = metricReadingsSql(db).find(r => r.name === 'ix_metric_readings_series');
    expect(row?.sql ?? '').toMatch(/observed_at\s+DESC/i);
  });

  it('幂等：连续两次 reconcileSchema 不抛、结构不变', () => {
    const before = tableInfo(db).map(c => `${c.name}:${c.type}:${c.notnull}`);
    expect(() => reconcileSchema(db)).not.toThrow();
    const after = tableInfo(db).map(c => `${c.name}:${c.type}:${c.notnull}`);
    expect(after).toEqual(before);
    expect(indexList(db)).toHaveLength(3);
  });

  it('V6 删除安全：删表 ⇒ 查询报 no such table；再跑 reconcileSchema ⇒ 不抛（版本门控 no-op）', () => {
    db.exec('DROP TABLE metric_readings');
    expect(() => db.prepare('SELECT COUNT(*) FROM metric_readings').get())
      .toThrow(/no such table/i);
    // 迁移系统为版本门控：schema_version 已到当前版本 ⇒ 重跑是 no-op（不重建，也不抛）
    expect(() => reconcileSchema(db)).not.toThrow();
  });

  it('临时真文件库：同一 DDL 结果一致（mkdtemp；不碰 gitignored data/）', () => {
    const fileDb = createTempFileDb();
    try {
      reconcileSchema(fileDb);
      expect(tableInfo(fileDb)).toHaveLength(17);
      expect(indexList(fileDb)).toHaveLength(3);
      const sqlRows = metricReadingsSql(fileDb);
      expect(sqlRows).toHaveLength(4); // 1 表 + 3 索引
    } finally {
      fileDb.close();
    }
  });

  it('SCHEMA_VERSION 已含 002（= 3）', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('证据输出：schema SQL 原文（等价 .schema metric_readings）', () => {
    const rows = metricReadingsSql(db);
    for (const r of rows) {
      console.log(`[schema] ${r.type} ${r.name}: ${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
    }
    expect(rows).toHaveLength(4);
  });
});
