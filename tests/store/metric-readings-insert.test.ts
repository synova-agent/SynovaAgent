/**
 * tests/store/metric-readings-insert.test.ts — #1053（2-1a）幂等 / 降级 / 边界判据
 *
 * 判据身份：本文件是卡面 §⑥ `V3`（幂等）的主载体，并承载 `M2`（run_id 改 NOT NULL ⇒ 必红）、
 *   `M3`（删 source_type CHECK ⇒ 必红）、`M4`（删不变量 CHECK ⇒ 必红）三条反例的**红点**。
 * 库口径：`:memory:` 临时库（**禁 `data/synova.db`**，R61/R87）。
 * 覆盖面（逐字）：**时序表已建**（表结构 + 3 索引 + 唯一约束 + 不变量 CHECK；**写入侧未接**（2-1b #1054）；查询/聚合未接）。
 *
 * 语义边界（诚实声明）：本文件只验证**表**允许/拒绝什么；**生产写入路径不存在**（2-1b 未开工），
 *   因此这里不宣称"测量值已能落盘"。
 *
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

let reconcileSchema: (db: Database.Database) => void;

async function loadModules() {
  const mod = await import('../../src/store/schema-migration');
  reconcileSchema = mod.reconcileSchema;
}

function createMemoryDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

/** 10 必填列（卡面 §③-7） */
const REQUIRED = {
  org_id: 'org-1',
  metric_id: 'METRIC-HHI-v1',
  entity_id: '*',
  value: 0.42,
  observed_at: '2026-10-08T00:00:00Z',
  source_type: 'compute',
  is_estimated: 0,
  confidence: 'medium',
  degraded: 0,
  created_at: '2026-10-08T00:00:01Z',
};

/** 带 R4 三列的完整 17 列行 */
const FULL_ROW = {
  ...REQUIRED,
  unit: '%',
  source_id: 'COMPUTE-HHI-v1',
  evidence_ref: 'evidence://x',
  run_id: 'run-1',
  input_digest: 'digest-1',
  def_version: 'v1',
};

interface ReadingRow {
  id: number; org_id: string; metric_id: string; entity_id: string; value: number;
  unit: string | null; observed_at: string; source_type: string; source_id: string | null;
  is_estimated: number; confidence: string; evidence_ref: string | null;
  degraded: number; created_at: string;
  run_id: string | null; input_digest: string | null; def_version: string | null;
}

function count(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM metric_readings').get() as { n: number };
  return row.n;
}

function insertRow(db: Database.Database, row: Record<string, unknown>, mode = ''): void {
  const cols = Object.keys(row);
  const sql = `INSERT ${mode} INTO metric_readings (${cols.join(', ')}) `
    + `VALUES (${cols.map(c => `@${c}`).join(', ')})`;
  db.prepare(sql).run(row);
}

describe('metric_readings 写入语义（#1053 / 2-1a · V3 + 边界/降级）', () => {
  let db: Database.Database;

  beforeEach(async () => {
    await loadModules();
    db = createMemoryDb();
    reconcileSchema(db);
  });

  it('正常：17 列全填 ⇒ 可写入且读回一致', () => {
    insertRow(db, FULL_ROW);
    expect(count(db)).toBe(1);
    const back = db.prepare('SELECT * FROM metric_readings').get() as ReadingRow;
    expect(back.org_id).toBe('org-1');
    expect(back.metric_id).toBe('METRIC-HHI-v1');
    expect(back.value).toBe(0.42);
    expect(back.unit).toBe('%');
    expect(back.run_id).toBe('run-1');
    expect(back.def_version).toBe('v1');
  });

  it('正常：可空 6 列缺省 + degraded=1 ⇒ 可写入，读回 NULL', () => {
    insertRow(db, { ...REQUIRED, degraded: 1 });
    const back = db.prepare('SELECT * FROM metric_readings').get() as ReadingRow;
    expect(back.unit).toBeNull();
    expect(back.source_id).toBeNull();
    expect(back.evidence_ref).toBeNull();
    expect(back.run_id).toBeNull();
    expect(back.input_digest).toBeNull();
    expect(back.def_version).toBeNull();
    expect(back.degraded).toBe(1);
  });

  it('正常：不同 observed_at ⇒ 2 行，可按时间序读回', () => {
    insertRow(db, { ...FULL_ROW, observed_at: '2026-10-08T00:00:00Z' });
    insertRow(db, { ...FULL_ROW, observed_at: '2026-10-09T00:00:00Z' });
    expect(count(db)).toBe(2);
    const series = db.prepare(
      'SELECT observed_at FROM metric_readings WHERE org_id = ? AND metric_id = ? ORDER BY observed_at',
    ).all('org-1', 'METRIC-HHI-v1') as Array<{ observed_at: string }>;
    expect(series.map(r => r.observed_at))
      .toEqual(['2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z']);
  });

  it('V3 幂等：同 (org_id, metric_id, entity_id, observed_at) 连写两次 + OR IGNORE ⇒ 行数 1，保留首值', () => {
    insertRow(db, { ...REQUIRED, degraded: 1, value: 1 }, 'OR IGNORE');
    insertRow(db, { ...REQUIRED, degraded: 1, value: 999 }, 'OR IGNORE');
    expect(count(db)).toBe(1);
    const back = db.prepare('SELECT value FROM metric_readings').get() as { value: number };
    expect(back.value).toBe(1);
  });

  it('幂等对照：同一业务键 + OR REPLACE ⇒ 仍 1 行（值被覆盖；rowid 会变 —— 写入侧推荐 IGNORE，选型归 2-1b）', () => {
    insertRow(db, { ...FULL_ROW, value: 1 });
    const first = db.prepare('SELECT id FROM metric_readings').get() as { id: number };
    insertRow(db, { ...FULL_ROW, value: 2 }, 'OR REPLACE');
    expect(count(db)).toBe(1);
    const after = db.prepare('SELECT id, value FROM metric_readings').get() as { id: number; value: number };
    expect(after.value).toBe(2);
    expect(after.id).not.toBe(first.id); // REPLACE = delete + insert（只追加语义下不推荐）
  });

  it('边界：缺 org_id ⇒ NOT NULL 拒绝（且 org_id 无默认值，宪章 H2）', () => {
    const { org_id: _drop, ...withoutOrg } = { ...REQUIRED, degraded: 1 };
    expect(() => insertRow(db, withoutOrg)).toThrow(/NOT NULL constraint failed: metric_readings\.org_id/i);
  });

  it('边界：source_type 非法值 ⇒ CHECK 拒绝（M3 红点）', () => {
    expect(() => insertRow(db, { ...FULL_ROW, source_type: 'bogus' }))
      .toThrow(/CHECK constraint failed/i);
  });

  it('边界：confidence 非法值 ⇒ CHECK 拒绝', () => {
    expect(() => insertRow(db, { ...FULL_ROW, confidence: 'bogus' }))
      .toThrow(/CHECK constraint failed/i);
  });

  it('降级不变量：R4 三列缺省且 degraded=0 ⇒ CHECK 拒绝（M4 红点）', () => {
    expect(() => insertRow(db, { ...REQUIRED, degraded: 0 }))
      .toThrow(/CHECK constraint failed/i);
  });

  it('降级不变量：三列全填且 degraded=0 ⇒ 放行（不变量只约束"缺列"一侧）', () => {
    insertRow(db, { ...FULL_ROW, degraded: 0 });
    expect(count(db)).toBe(1);
  });

  it('只追加语义（表侧可核）：无 UPDATE/DELETE 触发器的前提下，行数只随 INSERT 增长', () => {
    for (let i = 0; i < 3; i++) {
      insertRow(db, { ...FULL_ROW, observed_at: `2026-10-08T0${i}:00:00Z` });
    }
    expect(count(db)).toBe(3);
  });
});
