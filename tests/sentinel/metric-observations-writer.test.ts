/**
 * tests/sentinel/metric-observations-writer.test.ts — #1431（阶段 2 · T1）严格 writer 判据
 *
 * 判据身份（DEV DOC v2 §7 逐条）：
 *   反例 2（缺任一必填键／objectId='*'／period='' ⇒ 抛错且新表行数 +0）
 *   反例 3（value:null 允许、不写成 0、读回 null）
 *   反例 4（同四键写两次 ⇒ {written:false,duplicate:true}，行数不变）
 *   反例 1 的 DDL 兜底（object_id <> '*' 的 CHECK 在库 —— 改坏必红①）
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`），表由 `reconcileSchema` 建（迁移 007）。
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { reconcileSchema } from '../../src/store/schema-migration';
import {
  MetricObservationError,
  METRIC_OBSERVATION_SOURCE_TYPES,
  writeMetricObservation,
  type MetricObservationInput,
  type MetricObservationSourceType,
} from '../../src/sentinel/metric-observations-writer';

function createMemoryDb(): Database.Database {
  return new Database(':memory:');
}

/** 合法基线行（各用例按需覆盖） */
function baseInput(overrides: Partial<MetricObservationInput> = {}): MetricObservationInput {
  return {
    orgId: 'org-a',
    objectId: 'obj-1',
    metricId: 'gross-margin',
    period: '2026-10',
    value: 42,
    defVersion: 'v1',
    runId: 'run-1',
    sourceType: 'compute',
    observedAt: '2026-11-19T10:00:00Z',
    ...overrides,
  };
}

/** 删掉一个必填键（模拟"缺键"调用方；运行时形状坏、TS 类型仍是输入类型） */
function withoutKey(field: keyof MetricObservationInput): MetricObservationInput {
  const copy: Partial<MetricObservationInput> = { ...baseInput() };
  delete copy[field];
  return copy as MetricObservationInput;
}

/** 断言抛 MetricObservationError，并返回它（便于查 code/phase） */
function catchError(fn: () => unknown): MetricObservationError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(MetricObservationError);
  return caught as MetricObservationError;
}

function rowCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM metric_observations').get() as { n: number };
  return row.n;
}

function selectRow(db: Database.Database, metricId = 'gross-margin'): {
  org_id: string; object_id: string; metric_id: string; period: string; value: number | null;
  unit: string | null; def_version: string; run_id: string; source_type: string;
  source_id: string | null; evidence_ref: string | null; observed_at: string;
  degraded: number; created_at: string;
} {
  const row = db.prepare('SELECT * FROM metric_observations WHERE metric_id = ?').get(metricId);
  expect(row).toBeDefined();
  return row as {
    org_id: string; object_id: string; metric_id: string; period: string; value: number | null;
    unit: string | null; def_version: string; run_id: string; source_type: string;
    source_id: string | null; evidence_ref: string | null; observed_at: string;
    degraded: number; created_at: string;
  };
}

describe('metric_observations 严格写入（#1431 T1）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createMemoryDb();
    reconcileSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('正常：合法行落库，列值逐字段正确（degraded 默认 0、created_at 由 DB 生成）', () => {
    const result = writeMetricObservation(db, baseInput({ unit: 'ratio', sourceId: 'src-1', evidenceRef: 'ev-1' }));

    expect(result).toEqual({ written: true, duplicate: false });
    expect(rowCount(db)).toBe(1);

    const row = selectRow(db);
    expect(row.org_id).toBe('org-a');
    expect(row.object_id).toBe('obj-1');
    expect(row.metric_id).toBe('gross-margin');
    expect(row.period).toBe('2026-10');
    expect(row.value).toBe(42);
    expect(row.unit).toBe('ratio');
    expect(row.def_version).toBe('v1');
    expect(row.run_id).toBe('run-1');
    expect(row.source_type).toBe('compute');
    expect(row.source_id).toBe('src-1');
    expect(row.evidence_ref).toBe('ev-1');
    expect(row.observed_at).toBe('2026-11-19T10:00:00Z');
    expect(row.degraded).toBe(0);
    expect(typeof row.created_at).toBe('string');
    expect(row.created_at.length).toBeGreaterThan(0);
  });

  it('反例 2a：缺任一必填键 ⇒ 抛 VALIDATION 且新表行数 +0（7 个必填键逐个验）', () => {
    const requiredKeys: Array<keyof MetricObservationInput> = [
      'orgId', 'objectId', 'metricId', 'period', 'defVersion', 'runId', 'observedAt',
    ];
    for (const field of requiredKeys) {
      const err = catchError(() => writeMetricObservation(db, withoutKey(field)));
      expect(err.code).toBe('VALIDATION');
      expect(err.phase).toBe('validate');
      expect(err.retryable).toBe(false);
      expect(rowCount(db)).toBe(0);
    }
  });

  it("反例 2b：objectId === '*' ⇒ 抛 VALIDATION 且零写入", () => {
    const err = catchError(() => writeMetricObservation(db, baseInput({ objectId: '*' })));
    expect(err.code).toBe('VALIDATION');
    expect(err.field).toBe('objectId');
    expect(rowCount(db)).toBe(0);
  });

  it('反例 2c：period === \'\' ⇒ 抛 VALIDATION 且零写入（period 只能由调用方显式给）', () => {
    const err = catchError(() => writeMetricObservation(db, baseInput({ period: '' })));
    expect(err.code).toBe('VALIDATION');
    expect(err.field).toBe('period');
    expect(rowCount(db)).toBe(0);
  });

  it('反例 3：value:null 允许 ⇒ 落库为 SQL NULL（不是 0），读回 null', () => {
    const result = writeMetricObservation(db, baseInput({ value: null }));
    expect(result).toEqual({ written: true, duplicate: false });

    const row = selectRow(db);
    expect(row.value).toBeNull();

    const raw = db.prepare('SELECT value, value IS NULL AS is_null FROM metric_observations').get() as {
      value: number | null; is_null: number;
    };
    expect(raw.value).toBeNull();
    expect(raw.is_null).toBe(1);
  });

  it('边界：value:0 是**真实零值**，必须落 0 而不是 NULL（与缺失可区分）', () => {
    writeMetricObservation(db, baseInput({ metricId: 'zero-metric', value: 0 }));
    const raw = db.prepare('SELECT value, value IS NULL AS is_null FROM metric_observations WHERE metric_id = ?').get('zero-metric') as {
      value: number | null; is_null: number;
    };
    expect(raw.value).toBe(0);
    expect(raw.is_null).toBe(0);
  });

  it('反例 4：同四键写两次 ⇒ {written:false,duplicate:true}，行数不变且首行不被覆盖', () => {
    expect(writeMetricObservation(db, baseInput({ value: 42 }))).toEqual({ written: true, duplicate: false });
    expect(writeMetricObservation(db, baseInput({ value: 999, runId: 'run-2' }))).toEqual({
      written: false,
      duplicate: true,
    });

    expect(rowCount(db)).toBe(1);
    const row = selectRow(db);
    expect(row.value).toBe(42);
    expect(row.run_id).toBe('run-1'); // run_id 不入唯一键 ⇒ 第二次只算重复
  });

  it('反例 4 判别性：换 object/metric/period 任一键 ⇒ 是新行（唯一键确实是四键）', () => {
    writeMetricObservation(db, baseInput());
    writeMetricObservation(db, baseInput({ objectId: 'obj-2' }));
    writeMetricObservation(db, baseInput({ metricId: 'net-margin' }));
    writeMetricObservation(db, baseInput({ period: '2026-11' }));
    expect(rowCount(db)).toBe(4);
  });

  it('反例 2d：sourceType 不在取值域 ⇒ 抛 VALIDATION 且零写入', () => {
    const bad = { ...baseInput(), sourceType: 'spreadsheet' as MetricObservationSourceType };
    const err = catchError(() => writeMetricObservation(db, bad));
    expect(err.code).toBe('VALIDATION');
    expect(err.field).toBe('sourceType');
    expect(rowCount(db)).toBe(0);
    expect(METRIC_OBSERVATION_SOURCE_TYPES).toEqual(['compute', '42edge', 'manual', 'connector']);
  });

  it('反例 2e：value=NaN/Infinity ⇒ 抛 VALIDATION 且零写入（不让脏数入库）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const err = catchError(() => writeMetricObservation(db, baseInput({ value: bad })));
      expect(err.code).toBe('VALIDATION');
      expect(err.field).toBe('value');
      expect(rowCount(db)).toBe(0);
    }
  });

  it('严格链失败面：表不存在 ⇒ 抛 WRITE_FAILED（不静默降级、不返回假成功）', () => {
    const bare = createMemoryDb(); // 未跑 reconcileSchema
    try {
      const err = catchError(() => writeMetricObservation(bare, baseInput()));
      expect(err.code).toBe('WRITE_FAILED');
      expect(err.phase).toBe('persist');
      expect(err.retryable).toBe(true);
    } finally {
      bare.close();
    }
  });

  it("DDL 兜底（改坏必红①）：绕过 writer 直插 object_id='*' ⇒ 被表 CHECK 拒", () => {
    const insert = db.prepare(`INSERT INTO metric_observations
      (org_id, object_id, metric_id, period, value, def_version, run_id, source_type, observed_at)
      VALUES ('org-a', '*', 'm', '2026-10', 1, 'v1', 'r1', 'compute', '2026-11-19T10:00:00Z')`);
    expect(() => insert.run()).toThrow(/CHECK constraint failed/i);
    expect(rowCount(db)).toBe(0);
  });

  it('DDL 兜底：period 为空串 / source_type 越界 直插 ⇒ 被表 CHECK 拒', () => {
    const insertWithPeriod = db.prepare(`INSERT INTO metric_observations
      (org_id, object_id, metric_id, period, value, def_version, run_id, source_type, observed_at)
      VALUES ('org-a', 'obj-1', 'm', '', 1, 'v1', 'r1', 'compute', '2026-11-19T10:00:00Z')`);
    expect(() => insertWithPeriod.run()).toThrow(/CHECK constraint failed/i);

    const insertWithSource = db.prepare(`INSERT INTO metric_observations
      (org_id, object_id, metric_id, period, value, def_version, run_id, source_type, observed_at)
      VALUES ('org-a', 'obj-1', 'm', '2026-10', 1, 'v1', 'r1', 'spreadsheet', '2026-11-19T10:00:00Z')`);
    expect(() => insertWithSource.run()).toThrow(/CHECK constraint failed/i);
    expect(rowCount(db)).toBe(0);
  });
});
