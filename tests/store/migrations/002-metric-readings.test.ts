/**
 * tests/store/migrations/002-metric-readings.test.ts — 迁移模块配对测试（#1053 / 2-1a）
 *
 * 身份：pre-commit 组 2「新文件配对」要求 `src/store/migrations/002-*.ts` 有同名测试；
 *   本文件与 `002-metric-readings.ts` 配对，直接测**迁移模块本体**（不经过 `reconcileSchema` 的版本门控）。
 * 与 `tests/store/metric-readings-schema.test.ts` 的分工：
 *   · 本文件 = 迁移对象本体（version/name/up 幂等、DDL 落地）
 *   · `metric-readings-schema.test.ts` = 卡面 §⑥ `V1`（17 列/3 索引/约束矩阵/删除安全）
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`，R61/R87）。
 *
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { metricReadingsMigration } from '../../../src/store/migrations/002-metric-readings';

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

interface TableInfoRow { name: string }
interface IndexListRow { name: string }

describe('迁移 002 metric-readings（模块本体）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createMemoryDb();
  });

  it('迁移元数据：version=3、name=metric-readings（与 SCHEMA_VERSION 递增约定一致）', () => {
    expect(metricReadingsMigration.version).toBe(3);
    expect(metricReadingsMigration.name).toBe('metric-readings');
  });

  it('up(db)：建 1 表 + 3 索引 + 17 列', () => {
    metricReadingsMigration.up(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='metric_readings'",
    ).all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const cols = db.pragma('table_info(metric_readings)') as TableInfoRow[];
    expect(cols.map(c => c.name)).toHaveLength(17);

    const idx = db.pragma('index_list(metric_readings)') as IndexListRow[];
    expect(idx.map(i => i.name).sort())
      .toEqual(['ix_metric_readings_series', 'ix_metric_readings_source', 'ux_metric_readings_key']);
  });

  it('up(db) 幂等：连跑两次不抛、结构不变（全部 IF NOT EXISTS）', () => {
    metricReadingsMigration.up(db);
    const before = (db.pragma('table_info(metric_readings)') as TableInfoRow[]).map(c => c.name);
    expect(() => metricReadingsMigration.up(db)).not.toThrow();
    const after = (db.pragma('table_info(metric_readings)') as TableInfoRow[]).map(c => c.name);
    expect(after).toEqual(before);
    expect((db.pragma('index_list(metric_readings)') as IndexListRow[])).toHaveLength(3);
  });

  it('up(db) 失败面：单条 DDL 抛错即上抛（fail-closed，由 reconcileSchema 阻断启动）', () => {
    // 用一个已存在的**同名视图**制造冲突：CREATE TABLE IF NOT EXISTS 不会覆盖视图 ⇒ 抛错
    db.exec('CREATE VIEW metric_readings AS SELECT 1 AS x');
    expect(() => metricReadingsMigration.up(db)).toThrow();
  });
});
