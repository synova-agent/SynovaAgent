/**
 * tests/sentinel/stage2-s2-producer.test.ts — #1431（阶段 2 · S2）哨兵轮次 → ④a 真实指标生产者判据
 *
 * 判据身份（S2 卡 v2 §验收，Issue #1431 评论 14333 ／ Mandate 评论 14335）：
 *   [正例]  注入 `period='2026-11'` + `objectKey` ⇒ `metric_observations` 新增行：五键齐、
 *           `object_id` 形如 `node-<uuid>`，且能在 `graph_nodes` 查到同一行（graph=orgId、type=Team、
 *           `props.businessKey` = 注入的 objectKey）；旧链 `metric_readings` 仍写 2 行（零改动证据）。
 *   [反例1] 缺 `period` ⇒ 新表 0 行 + `log.warn` 码 `S2_DEGRADED_NO_PERIOD`；不建 Team 节点。
 *   [反例2] 缺 `objectKey` ⇒ 新表 0 行 + `log.warn` 码 `S2_DEGRADED_NO_OBJECT`（不回退 `'*'`）。
 *   [反例3] `period` 非 `YYYY-MM` ⇒ 新表 0 行 + `log.warn` 码 `S2_DEGRADED_BAD_PERIOD`。
 *   [反例4] 缺 `teamId`（`''` 或 `undefined`）⇒ 新表 0 行 + `log.warn` 码 `S2_DEGRADED_NO_ORG`（fail-closed）。
 *   [反例5] 引擎库不可用（不注入 db）⇒ 新表 0 行 + `log.warn` 码 `S2_DEGRADED_NO_DB`。
 *   [幂等]  同 `objectKey` 跑多次（含跨 period）⇒ `graph_nodes` 中 Team 节点恒为 1 个，
 *           且各期观测行的 `object_id` 全部相同（`resolveOrCreate` 同 (orgId,type,businessKey) 复用）。
 *
 * 期望值来源（独立于被测对象）：期望的 period / objectKey / findings 条数 / durationMs / 哨兵版本 /
 *   checkedAt 全部由本文件构造的输入给出；不拿「读表结果」反向构造期望，也不调用被测函数产出期望。
 *
 * 防假绿三问：空对象？（逐字段断言 + 物理行数）/ 跳过？（无 skip/only，每用例含 expect）/
 *   同源？（期望来自测试常量）。改坏必红见交付回执（entityId='*'／period 用 now()／去掉幂等）。
 *
 * 库口径：`:memory:`（禁 `data/synova.db`）；`SqliteGraphStore` 构造即 `reconcileSchema`（建 graph_nodes /
 *   graph_triples / metric_readings / metric_observations 全部迁移表）。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { runSentinelForTeam } from '../../src/sentinel/sentinel-runner';
import { getSentinelRegistry, destroySentinelRegistry } from '../../src/sentinel/registry';
import { resolveOrCreate, GraphWriteError } from '../../src/agent/graph-store-service';
import type { Sentinel, SentinelCheckResult, SentinelFinding } from '../../src/sentinel/types';

vi.mock('../../src/init/engine-context', () => ({
  getDatabase: vi.fn(),
}));

/** `log.warn` 运行时捕获（判据：降级码必须可见，铁律 11/24/31）——范式同 tests/cron/parse-cron-field.test.ts:22-38 */
const logCapture = vi.hoisted(() => {
  const calls: Array<{ level: string; meta?: Record<string, unknown>; msg?: unknown }> = [];
  return { calls };
});

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: Record<string, unknown>, msg?: unknown) => {
    logCapture.calls.push({ level, meta, msg });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
    }),
  };
});

const mockedGetDatabase = vi.mocked(getDatabase);

// ═══ 测试构造的输入（期望值的唯一来源）═══
const ORG = 'org-s2-zhaopin';
const PERIOD = '2026-11';
const OTHER_PERIOD = '2026-12';
const OBJECT_KEY = 'team-s2-zhaopin';
const SENTINEL_ID = 'stage2-s2-probe';
const SENTINEL_VERSION = '9.9.9';
const FINDINGS_COUNT = 3;
const DURATION_MS = 17;
const CHECKED_AT = '2026-11-20T08:30:00.000Z';
/** `node-<uuid>`（与 sqlite-graph-store 的 id 生成同形；同 S1 判据口径） */
const NODE_ID_PATTERN = /^node-[0-9a-f-]{36}$/;

function makeFindings(count: number): SentinelFinding[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${SENTINEL_ID}-finding-${i + 1}`,
    severity: 'warning' as const,
    title: `发现 ${i + 1}`,
    description: '测试构造的发现',
    evidence: [],
    suggestion: '无',
    detectedAt: CHECKED_AT,
  }));
}

function makeProbeSentinel(): Sentinel {
  return {
    config: {
      id: SENTINEL_ID,
      name: 'S2 探针哨兵',
      description: '固定输入：3 条 findings / 17ms',
      category: 'growth',
      priority: 'P1',
      mode: 'manual',
      requiredDataSources: [],
      confidenceModel: 'deterministic',
      version: SENTINEL_VERSION,
    },
    async check(): Promise<SentinelCheckResult> {
      return {
        sentinelId: SENTINEL_ID,
        ok: true,
        findings: makeFindings(FINDINGS_COUNT),
        durationMs: DURATION_MS,
        checkedAt: CHECKED_AT,
      };
    },
  };
}

/** `metric_observations` 物理行（判据只看真实列） */
interface ObservationRow {
  org_id: string;
  object_id: string;
  metric_id: string;
  period: string;
  value: number | null;
  unit: string | null;
  def_version: string;
  run_id: string;
  source_type: string;
  source_id: string | null;
  evidence_ref: string | null;
  observed_at: string;
}

function observationRows(db: Database.Database): ObservationRow[] {
  return db.prepare(
    `SELECT org_id, object_id, metric_id, period, value, unit, def_version, run_id,
            source_type, source_id, evidence_ref, observed_at
       FROM metric_observations ORDER BY period, metric_id`,
  ).all() as ObservationRow[];
}

function oldChainRowCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = ?').get(ORG) as { n: number };
  return row.n;
}

function teamNodeCount(db: Database.Database): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM graph_nodes WHERE graph = ? AND type = 'Team'",
  ).get(ORG) as { n: number };
  return row.n;
}

/** 捕获到的 `log.warn` 降级码（断言用；只取字符串 code） */
function warnCodes(): string[] {
  const codes: string[] = [];
  for (const call of logCapture.calls) {
    if (call.level !== 'warn') continue;
    const code = call.meta?.['code'];
    if (typeof code === 'string') codes.push(code);
  }
  return codes;
}

describe('#1431 S2 · 哨兵轮次 → metric_observations 真实生产者', () => {
  let db: Database.Database;
  let store: SqliteGraphStore;

  beforeEach(() => {
    destroySentinelRegistry();
    logCapture.calls.length = 0;
    db = new Database(':memory:');
    mockedGetDatabase.mockImplementation(() => db);
    // 构造即 reconcileSchema（建全部迁移表：graph_nodes / metric_readings / metric_observations）
    store = new SqliteGraphStore(db);
    getSentinelRegistry().register(makeProbeSentinel());
  });

  afterEach(() => {
    destroySentinelRegistry();
    mockedGetDatabase.mockReset();
    try {
      db.close();
    } catch {
      /* 已关闭的库不掩盖断言（与 S1 先例一致） */
    }
  });

  it('[正例] period + objectKey ⇒ 新表新增行、五键齐、object_id 指向真实 Team 节点', async () => {
    await runSentinelForTeam(ORG, store, { period: PERIOD, objectKey: OBJECT_KEY });

    const rows = observationRows(db);
    // 期望行数 = 1 个哨兵 × 2 个轮次级指标（FINDINGS / DURATION）—— 由测试构造的哨兵数量决定
    expect(rows).toHaveLength(2);

    const findingsRow = rows.find(r => r.metric_id === `SENTINEL-FINDINGS-${SENTINEL_ID}`);
    const durationRow = rows.find(r => r.metric_id === `SENTINEL-DURATION-${SENTINEL_ID}`);
    expect(findingsRow).toBeDefined();
    expect(durationRow).toBeDefined();
    if (!findingsRow || !durationRow) throw new Error('期望的两行缺一');

    // 五键齐（org_id / object_id / metric_id / period / value）：值来自测试传入的输入
    expect(findingsRow.org_id).toBe(ORG);
    expect(findingsRow.period).toBe(PERIOD);
    expect(findingsRow.metric_id).toBe(`SENTINEL-FINDINGS-${SENTINEL_ID}`);
    expect(findingsRow.object_id).toMatch(NODE_ID_PATTERN);
    expect(findingsRow.object_id).not.toBe('*');
    expect(findingsRow.value).toBe(FINDINGS_COUNT);

    // 其余列同契约
    expect(durationRow.org_id).toBe(ORG);
    expect(durationRow.period).toBe(PERIOD);
    expect(durationRow.metric_id).toBe(`SENTINEL-DURATION-${SENTINEL_ID}`);
    expect(durationRow.object_id).toBe(findingsRow.object_id);
    expect(durationRow.value).toBe(DURATION_MS);
    expect(durationRow.unit).toBe('ms');
    expect(findingsRow.def_version).toBe(SENTINEL_VERSION);
    expect(findingsRow.run_id).not.toBe('');
    expect(findingsRow.source_type).toBe('compute');
    expect(findingsRow.source_id).toBe(`SENTINEL-${SENTINEL_ID}`);
    expect(findingsRow.evidence_ref).toBe(`sentinel:${SENTINEL_ID}`);
    expect(findingsRow.observed_at).toBe(CHECKED_AT);

    // object_id 指向真实 ② 节点：能在 graph_nodes 物理行查到，且分区/类型/属性对得上注入值
    const node = db.prepare('SELECT graph, type, props FROM graph_nodes WHERE id = ?').get(findingsRow.object_id) as
      | { graph: string; type: string; props: string }
      | undefined;
    expect(node).toBeDefined();
    if (!node) throw new Error('object_id 在 graph_nodes 查不到');
    expect(node.graph).toBe(ORG);
    expect(node.type).toBe('Team');
    const nodeProps = JSON.parse(node.props) as Record<string, unknown>;
    expect(nodeProps.businessKey).toBe(OBJECT_KEY);
    expect(nodeProps.period).toBe(PERIOD);

    // 旧链零改动：同一轮次仍向 metric_readings 写 2 行（双写证据；改坏此处 ⇒ 旧链回归）
    expect(oldChainRowCount(db)).toBe(2);
  });

  it('[反例1] 缺 period ⇒ 新表 0 行 + S2_DEGRADED_NO_PERIOD（不建对象、旧链仍写）', async () => {
    await runSentinelForTeam(ORG, store, { objectKey: OBJECT_KEY });

    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_NO_PERIOD');
    // period 缺失 ⇒ 连 Team 对象都不该建（④a 整条路径不启动）
    expect(teamNodeCount(db)).toBe(0);
    // 旧链（metric_readings）零改动：该轮照常写 2 行
    expect(oldChainRowCount(db)).toBe(2);
  });

  it('[反例2] 缺 objectKey ⇒ 新表 0 行 + S2_DEGRADED_NO_OBJECT（不回退写 *）', async () => {
    await runSentinelForTeam(ORG, store, { period: PERIOD });

    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_NO_OBJECT');
    // 新表物理上不允许 object_id='*'；这里断言的是"连写入都没发生"
    const starRows = db.prepare("SELECT COUNT(*) AS n FROM metric_observations WHERE object_id = '*'").get() as { n: number };
    expect(starRows.n).toBe(0);
  });

  it('[反例3] period 非 YYYY-MM ⇒ 新表 0 行 + S2_DEGRADED_BAD_PERIOD', async () => {
    await runSentinelForTeam(ORG, store, { period: '2026-13', objectKey: OBJECT_KEY });

    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_BAD_PERIOD');
    expect(teamNodeCount(db)).toBe(0);
  });

  it("[反例4] 缺 teamId（'' 或 undefined）⇒ 新表 0 行 + S2_DEGRADED_NO_ORG（fail-closed）", async () => {
    // 空串：org 维度为空 —— 不得写错租户行
    await runSentinelForTeam('', store, { period: PERIOD, objectKey: OBJECT_KEY });
    // undefined：类型系统要求 string，这里用 Reflect.apply 走**运行期**形态（不引入 as any 家族，铁律 38）
    await Reflect.apply(runSentinelForTeam, undefined, [undefined, store, { period: PERIOD, objectKey: OBJECT_KEY }]);

    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_NO_ORG');
    // 缺 org 在解析对象之前就挡住 ⇒ 一个 Team 节点都不建
    expect(teamNodeCount(db)).toBe(0);
  });

  it('[反例5] 引擎库不可用（不注入 db）⇒ 新表 0 行 + S2_DEGRADED_NO_DB', async () => {
    // 运行期真实形态：未 initEngineContext 时 getDatabase() 抛错（引擎侧唯一失败出口）
    mockedGetDatabase.mockImplementation(() => {
      throw new Error('数据库未初始化，请先调用 initEngineContext()');
    });

    await runSentinelForTeam(ORG, store, { period: PERIOD, objectKey: OBJECT_KEY });

    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_NO_DB');
    // db 缺失在解析对象之前就挡住 ⇒ 不建 Team 节点
    expect(teamNodeCount(db)).toBe(0);
  });

  it('[幂等] 同 objectKey 多次（含跨 period）⇒ Team 节点恒 1 个，观测行共用同一 object_id', async () => {
    await runSentinelForTeam(ORG, store, { period: PERIOD, objectKey: OBJECT_KEY });
    await runSentinelForTeam(ORG, store, { period: PERIOD, objectKey: OBJECT_KEY });
    await runSentinelForTeam(ORG, store, { period: OTHER_PERIOD, objectKey: OBJECT_KEY });

    // 同 (orgId, type, businessKey) ⇒ 只建一个 Team 节点（第 2、3 次复用第 1 次）
    expect(teamNodeCount(db)).toBe(1);

    // 同一 period 重跑 ⇒ 四键幂等（2 行不增）；换 period ⇒ 另一期的 2 行
    const rows = observationRows(db);
    expect(rows).toHaveLength(4);
    expect(rows.filter(r => r.period === PERIOD)).toHaveLength(2);
    expect(rows.filter(r => r.period === OTHER_PERIOD)).toHaveLength(2);

    // 各期、各指标行的 object_id 全部相同（跨 period 仍指向同一个对象）
    const objectIds = new Set(rows.map(r => r.object_id));
    expect(objectIds.size).toBe(1);
    const onlyObjectId = [...objectIds][0];
    expect(onlyObjectId).toMatch(NODE_ID_PATTERN);
    expect(db.prepare('SELECT id FROM graph_nodes WHERE id = ?').get(onlyObjectId)).toBeDefined();
  });

  it('[resolveOrCreate 边界] 缺参/新建 props 违约 ⇒ VALIDATION 零写入；命中既有对象不再校验 props', () => {
    const props = { name: OBJECT_KEY, period: PERIOD, defVersion: 'v1' };
    const invalidCalls: Array<() => string> = [
      () => resolveOrCreate('', OBJECT_KEY, 'Team', props),
      () => resolveOrCreate(ORG, '', 'Team', props),
      () => resolveOrCreate(ORG, OBJECT_KEY, '', props),
      () => resolveOrCreate(ORG, OBJECT_KEY, 'Team'), // 新建时缺 props.period / props.defVersion
    ];
    for (const call of invalidCalls) {
      let caught: unknown;
      try {
        call();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphWriteError);
      const writeError = caught as GraphWriteError;
      expect(writeError.code).toBe('VALIDATION');
      expect(writeError.phase).toBe('validate');
      expect(writeError.retryable).toBe(false);
    }
    // 全部违约 ⇒ 零节点写入（校验先于写入）
    expect(teamNodeCount(db)).toBe(0);

    const first = resolveOrCreate(ORG, OBJECT_KEY, 'Team', props);
    expect(first).toMatch(NODE_ID_PATTERN);
    // 命中既有对象 ⇒ 直接复用 id，不再校验 props（不写库就不需要 period/defVersion）
    expect(resolveOrCreate(ORG, OBJECT_KEY, 'Team', { name: '第二次' })).toBe(first);
    expect(teamNodeCount(db)).toBe(1);
  });
});
