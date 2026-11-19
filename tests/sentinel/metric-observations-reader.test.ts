/**
 * tests/sentinel/metric-observations-reader.test.ts — #1431（阶段 2 · T1）四键读回判据
 *
 * 判据身份（DEV DOC v2 §7 逐条）：
 *   §7-3（value:null 读回 null、0 不被当缺失）
 *   §7-5 反例 5 / T4（两用户同 org 读同一 `(object,metric,period)` ⇒ 命中**同一 id**；跨 org ⇒ 空）
 *   严格链读侧：非法四键 ⇒ VALIDATION；表缺失 ⇒ READ_FAILED（**不静默空**）
 * 库口径：`:memory:` 临时库（禁 `data/synova.db`），表由 `reconcileSchema` 建（迁移 007）。
 * 铁律 33/38/48：单元测试 + 零不安全断言 + 全用例含 expect()
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { reconcileSchema } from '../../src/store/schema-migration';
import {
  MetricObservationError,
  writeMetricObservation,
  type MetricObservationInput,
  type MetricObservationKey,
} from '../../src/sentinel/metric-observations-writer';
import {
  getMetricObservation,
  type MetricObservationRow,
} from '../../src/sentinel/metric-observations-reader';

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

function keyFor(orgId: string, overrides: Partial<MetricObservationKey> = {}): MetricObservationKey {
  return { orgId, objectId: 'obj-1', metricId: 'gross-margin', period: '2026-10', ...overrides };
}

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

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  reconcileSchema(db);
});

afterAll(() => {
  db.close();
});

describe('metric_observations 四键读回（#1431 T1）', () => {
  it('写入后按四键读回：列值逐字段匹配（含 id / observed_at / source_type）', () => {
    expect(writeMetricObservation(db, baseInput({ unit: 'ratio', sourceId: 'src-1' }))).toEqual({
      written: true,
      duplicate: false,
    });

    const row = getMetricObservation(db, keyFor('org-a'));
    expect(row).not.toBeNull();
    const hit = row as MetricObservationRow;
    expect(typeof hit.id).toBe('number');
    expect(hit.org_id).toBe('org-a');
    expect(hit.object_id).toBe('obj-1');
    expect(hit.metric_id).toBe('gross-margin');
    expect(hit.period).toBe('2026-10');
    expect(hit.value).toBe(42);
    expect(hit.unit).toBe('ratio');
    expect(hit.def_version).toBe('v1');
    expect(hit.run_id).toBe('run-1');
    expect(hit.source_type).toBe('compute');
    expect(hit.source_id).toBe('src-1');
    expect(hit.observed_at).toBe('2026-11-19T10:00:00Z');
    expect(hit.degraded).toBe(0);
  });

  it('T4：两用户（同 org）读同一 (object,metric,period) ⇒ 命中**同一 id**', () => {
    const userA = { userId: 'user-a', orgId: 'org-a' };
    const userB = { userId: 'user-b', orgId: 'org-a' };
    const readAs = (user: { userId: string; orgId: string }): MetricObservationRow | null =>
      getMetricObservation(db, keyFor(user.orgId));

    const first = readAs(userA);
    const second = readAs(userB);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.id).toBe(second?.id);
    expect(userA.userId).not.toBe(userB.userId);
  });

  it('跨 org ⇒ 查不到（null），不是读到别家行', () => {
    expect(getMetricObservation(db, keyFor('org-b'))).toBeNull();
  });

  it('四键任一不同 ⇒ 未命中（object / metric / period 三个维度各验一次）', () => {
    expect(getMetricObservation(db, keyFor('org-a', { objectId: 'obj-2' }))).toBeNull();
    expect(getMetricObservation(db, keyFor('org-a', { metricId: 'net-margin' }))).toBeNull();
    expect(getMetricObservation(db, keyFor('org-a', { period: '2026-11' }))).toBeNull();
  });

  it('§7-3：value:null 读回 null；value:0 读回 0（两者可区分）', () => {
    expect(writeMetricObservation(db, baseInput({ metricId: 'null-metric', value: null }))).toEqual({
      written: true,
      duplicate: false,
    });
    expect(writeMetricObservation(db, baseInput({ metricId: 'zero-metric', value: 0 }))).toEqual({
      written: true,
      duplicate: false,
    });

    expect(getMetricObservation(db, keyFor('org-a', { metricId: 'null-metric' }))?.value).toBeNull();
    expect(getMetricObservation(db, keyFor('org-a', { metricId: 'zero-metric' }))?.value).toBe(0);
  });

  it("严格读侧：objectId='*' / period='' / orgId='' ⇒ 抛 VALIDATION", () => {
    const star = catchError(() => getMetricObservation(db, keyFor('org-a', { objectId: '*' })));
    expect(star.code).toBe('VALIDATION');
    expect(star.field).toBe('objectId');

    const emptyPeriod = catchError(() => getMetricObservation(db, keyFor('org-a', { period: '' })));
    expect(emptyPeriod.code).toBe('VALIDATION');
    expect(emptyPeriod.field).toBe('period');

    const emptyOrg = catchError(() => getMetricObservation(db, keyFor('')));
    expect(emptyOrg.code).toBe('VALIDATION');
    expect(emptyOrg.field).toBe('orgId');
  });

  it('严格读侧：表不存在 ⇒ 抛 READ_FAILED（不静默返回 null 冒充"没有行"）', () => {
    const bare = new Database(':memory:');
    try {
      const err = catchError(() => getMetricObservation(bare, keyFor('org-a')));
      expect(err.code).toBe('READ_FAILED');
      expect(err.phase).toBe('read');
      expect(err.retryable).toBe(true);
    } finally {
      bare.close();
    }
  });

  it('幂等联动：duplicate 写入后读回首行值（不覆盖）', () => {
    expect(writeMetricObservation(db, baseInput({ metricId: 'idem-metric', value: 7 }))).toEqual({
      written: true,
      duplicate: false,
    });
    expect(writeMetricObservation(db, baseInput({ metricId: 'idem-metric', value: 9, runId: 'run-2' }))).toEqual({
      written: false,
      duplicate: true,
    });
    expect(getMetricObservation(db, keyFor('org-a', { metricId: 'idem-metric' }))?.value).toBe(7);
  });
});
