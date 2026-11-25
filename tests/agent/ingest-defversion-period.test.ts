/**
 * tests/agent/ingest-defversion-period.test.ts — #1486 裁定 a：`defVersion` 可缺省、`period` 绝不放宽。
 *
 * 判据（Issue #1486「四条裁定 a」＋验收 a）：
 *   [正常]   `props.defVersion` 缺省 ⇒ 可写；落库属性由系统赋 `ingest-v0`；`period` 逐字 = 入参资料期间
 *   [正常]   `resolveOrCreate` 新建路径同判据（幂等键 `businessKey` 仍由本函数统一写入）
 *   [失败]   缺 `period` ⇒ `GraphWriteError(VALIDATION)`，**零写入**（物理行数不变、未触达 getDatabase）
 *   [反例]   伪造 `period`（日期形态 / 非补零月份 / 非法月份 / 非字符串）⇒ 必须被抓（VALIDATION，零写入）
 *   [边界]   `defVersion` 显式给出 ⇒ 原样保留；显式空串/非字符串 ⇒ 仍 VALIDATION（只放宽"缺省"）
 *   [边界]   注入不修改调用方入参对象（系统只在自己的书面副本上加键）
 *
 * 期望值来源：`INGEST_DEF_VERSION`（被测模块导出的唯一常量）＋本文件构造的 period；不拿"读表结果"反推期望。
 * 库口径：`:memory:`（`getDatabase` 由本文件 mock 到内存库，绝不连 `data/synova.db`）。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createObject,
  resolveOrCreate,
  GraphWriteError,
  INGEST_DEF_VERSION,
} from '../../src/agent/graph-store-service';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { getDatabase } from '../../src/init/engine-context';

vi.mock('../../src/init/engine-context', () => ({
  getDatabase: vi.fn(),
}));

const mockedGetDatabase = vi.mocked(getDatabase);

// ═══ 测试构造的输入（期望值的唯一来源）═══
const ORG = 'org-1486-a';
const TYPE_TEAM = 'Team';
const PERIOD = '2026-10';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  mockedGetDatabase.mockImplementation(() => db);
  // 构造即 reconcileSchema（建 graph_nodes / graph_triples / scan_* / metric_observations）
  new SqliteGraphStore(db);
});

afterEach(() => {
  mockedGetDatabase.mockReset();
  try {
    db.close();
  } catch {
    /* 已关闭不掩盖断言 */
  }
});

function countNodes(): number {
  return db.prepare('SELECT id FROM graph_nodes').all().length;
}

function propsOf(id: string): Record<string, unknown> {
  const row = db.prepare('SELECT props FROM graph_nodes WHERE id = ?').get(id) as { props: string };
  return JSON.parse(row.props) as Record<string, unknown>;
}

function catchWriteError(fn: () => unknown): GraphWriteError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(GraphWriteError);
  return caught as GraphWriteError;
}

describe('#1486 a · defVersion 可缺省（系统赋 ingest-v0）／period 仍强制', () => {
  it('[正常] defVersion 缺省 ⇒ 可写；落库 defVersion=ingest-v0，period 来自入参', () => {
    const input: Record<string, unknown> = { name: '招聘团队', period: PERIOD };
    const id = createObject(ORG, TYPE_TEAM, input);

    const props = propsOf(id);
    expect(props.defVersion).toBe(INGEST_DEF_VERSION);
    expect(props.defVersion).toBe('ingest-v0');
    expect(props.period).toBe(PERIOD);
    expect(props.name).toBe('招聘团队');
    // [边界] 系统只在书面副本上加键 —— 调用方入参对象不被修改
    expect('defVersion' in input).toBe(false);
  });

  it('[正常] resolveOrCreate 新建路径：defVersion 缺省同样系统赋 ingest-v0，businessKey 由入口统一写入', () => {
    const businessKey = 'team-1486-a';
    const id = resolveOrCreate(ORG, businessKey, TYPE_TEAM, { name: '团队 A', period: PERIOD });

    const props = propsOf(id);
    expect(props.defVersion).toBe(INGEST_DEF_VERSION);
    expect(props.period).toBe(PERIOD);
    expect(props.businessKey).toBe(businessKey);
    // 幂等：同键再调用复用同一节点（命中后不再要求 props）
    expect(resolveOrCreate(ORG, businessKey, TYPE_TEAM)).toBe(id);
  });

  it('[失败] 缺 period ⇒ VALIDATION（零写入、零 getDatabase 调用）', () => {
    mockedGetDatabase.mockClear();
    const before = countNodes();

    const err = catchWriteError(() => createObject(ORG, TYPE_TEAM, { name: '没有期间' }));

    expect(err.code).toBe('VALIDATION');
    expect(err.field).toBe('period');
    expect(err.phase).toBe('validate');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('period');
    expect(countNodes()).toBe(before);
    expect(mockedGetDatabase).toHaveBeenCalledTimes(0);
  });

  it('[反例] 伪造 period ⇒ 必被抓（VALIDATION，零写入）', () => {
    const before = countNodes();
    const forged: unknown[] = ['2026-10-01', '2026-1', '2026-13', '2026/10', 202610, null];
    for (const period of forged) {
      const err = catchWriteError(() => createObject(ORG, TYPE_TEAM, { name: '伪造期间', period }));
      expect(err.code).toBe('VALIDATION');
      expect(err.field).toBe('period');
    }
    expect(countNodes()).toBe(before);
  });

  it('[边界] defVersion 显式给出 ⇒ 原样保留；空串/非字符串 ⇒ 仍 VALIDATION（只放宽缺省）', () => {
    const explicit = createObject(ORG, TYPE_TEAM, { name: '显式版本', period: PERIOD, defVersion: 'delivery-v1' });
    expect(propsOf(explicit).defVersion).toBe('delivery-v1');

    const before = countNodes();
    for (const defVersion of ['', 7, null]) {
      const err = catchWriteError(() => createObject(ORG, TYPE_TEAM, { name: '乱填版本', period: PERIOD, defVersion }));
      expect(err.code).toBe('VALIDATION');
      expect(err.field).toBe('defVersion');
    }
    expect(countNodes()).toBe(before);
  });
});
