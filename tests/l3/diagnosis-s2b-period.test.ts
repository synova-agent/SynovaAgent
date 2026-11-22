/**
 * tests/l3/diagnosis-s2b-period.test.ts — #1431（阶段 2 · S2b）诊断运行透传 period/objectKey → ④a 真落行
 *
 * 判据身份（S2b 卡 §七，Issue #1431 评论 14354 ／ Mandate 评论 14357）：
 *   [正例·真实入口] `POST /api/diagnosis/consult` 带 `scope.period='2026-11'` + `scope.objectKey`
 *     ⇒ `metric_observations` 真落行：`org_id`=请求 teamId、`period`=入参、`object_id` 形如 `node-<uuid>`；
 *     诊断仍正常返回（SSE `complete` 帧 + 报告 summary 来自假 LLM 的固定产出）。
 *   [正例·非当期] `scope.period='2034-06'`（固定，且不等于本测试运行时当月）
 *     ⇒ 行 `period` 精确等于入参 —— **防「引擎内 `new Date()` 派生 period」假绿**：
 *     时钟派生值不可能等于该入参（改动前的实现即用 `undefined`，改坏成时钟派生 ⇒ 本条必红）。
 *   [反例1] 请求不带 `scope`（默认调用形态）⇒ 新表 0 行 + `log.warn` 码 `S2_DEGRADED_NO_PERIOD`。
 *   [反例2] 带 `period` 不带 `objectKey` ⇒ 新表 0 行 + `S2_DEGRADED_NO_OBJECT`（不回退写 `'*'`）。
 *   [反例3] `period='2026-13'`（非 `YYYY-MM`）⇒ 新表 0 行 + `S2_DEGRADED_BAD_PERIOD`（复用 S2 码，不新增）。
 *
 * 期望值来源（独立于被测对象）：teamId / period / objectKey / 哨兵 findings 条数 / durationMs /
 *   checkedAt 全部来自本文件构造的请求体与探针哨兵；**不拿读表结果反向构造期望**，也不调用被测函数产出期望。
 *
 * 防假绿三问：空对象？（逐字段断言 + 物理行数）/ 跳过？（无 skip/only，每用例含 expect）/
 *   同源？（期望来自测试常量）。改坏必红见交付回执（①引擎内 new Date() 派生 period／②丢掉 scope 透传）。
 *
 * 铁律 12：集成测试走真实路由（express app + listen(0) + fetch）——被测管线（路由→L3 引擎→哨兵轮次→
 *   ④a 写入）全部为真实实现；仅 mock LLM provider/config（测试密闭，不触真实网关）、
 *   `engine-context.getDatabase`（把引擎库指到 `:memory:`）与 logger（捕获降级码）。
 * 库口径：只连 `:memory:`（`SqliteGraphStore` 构造即 `reconcileSchema`；不触碰 data/synova.db）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import type { Server } from 'http';
import { getDatabase } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { getSentinelRegistry, destroySentinelRegistry } from '../../src/sentinel/registry';
import type { Sentinel, SentinelCheckResult } from '../../src/sentinel/types';

// ═══ Mock：引擎库句柄（:memory: 注入点） ═══
vi.mock('../../src/init/engine-context', () => ({
  getDatabase: vi.fn(),
}));

// ═══ Mock：LLM provider / config（路由构造 provider，真实引擎调用假 chat —— 不触真实网关） ═══
vi.mock('../../src/providers', () => ({
  createProvider: () => ({
    name: 'fake-s2b-provider',
    async chat() {
      return {
        content: JSON.stringify({
          hypotheses: [
            { dimension: 'D1', summary: 'S2b 测试假设', confidence: 0.8, evidence: ['固定证据'] },
          ],
          rootCauses: [{ description: 'S2b 测试根因', dimension: 'D1', confidence: 0.8 }],
          recommendations: [{ action: 'S2b 测试建议', priority: 'high', dimension: 'D1' }],
          summary: 'S2b 测试诊断报告',
        }),
        model: 'test-model',
      };
    },
  }),
}));
vi.mock('../../src/providers/detect', () => ({
  detectProvider: () => 'deepseek',
}));
vi.mock('../../src/config', () => ({
  loadConfig: () => ({
    llmApiKey: 'test-key',
    llmBaseUrl: 'http://localhost:1',
    llmModel: 'test-model',
    diagnosis: { maxToolRounds: 2, gateDataCompleteness: 0.3, gateMinHypothesisConfidence: 0.5 },
  }),
}));

// ═══ Mock：logger（降级码必须可见，铁律 11/24/31；范式同 tests/sentinel/stage2-s2-producer.test.ts） ═══
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
/** 请求 body 里的 teamId（= ④a 的 org 维度） */
const TEAM_ID = 'org-s2b-zhaopin';
/** 正例 1 的 period：卡面字面值（请求显式携带） */
const PERIOD = '2026-11';
/** 正例 2 的 period：固定历史/未来期间，不可能等于运行时当月 ⇒ 时钟派生必被本条打红 */
const OFF_CLOCK_PERIOD = '2034-06';
/** 请求显式携带的对象业务键（② Team 节点幂等键） */
const OBJECT_KEY = 'team-x';
const SENTINEL_ID = 's2b-probe-sentinel';
const SENTINEL_VERSION = '7.7.7';
const FINDINGS_COUNT = 2;
const DURATION_MS = 11;
const CHECKED_AT = '2026-11-20T08:30:00.000Z';
/** `node-<uuid>`（与 sqlite-graph-store 的 id 生成同形；同 S1/S2 判据口径） */
const NODE_ID_PATTERN = /^node-[0-9a-f-]{36}$/;

function makeProbeSentinel(): Sentinel {
  return {
    config: {
      id: SENTINEL_ID,
      name: 'S2b 探针哨兵',
      description: '固定输入：2 条 findings / 11ms',
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
        findings: Array.from({ length: FINDINGS_COUNT }, (_, i) => ({
          id: `${SENTINEL_ID}-finding-${i + 1}`,
          severity: 'warning' as const,
          title: `发现 ${i + 1}`,
          description: '测试构造的发现',
          evidence: [],
          suggestion: '无',
          detectedAt: CHECKED_AT,
        })),
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
}

function observationRows(db: Database.Database): ObservationRow[] {
  return db.prepare(
    `SELECT org_id, object_id, metric_id, period, value, unit, def_version
       FROM metric_observations ORDER BY metric_id`,
  ).all() as ObservationRow[];
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

function parseSseFrames(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .filter(chunk => chunk.startsWith('data: '))
    .map(chunk => JSON.parse(chunk.replace(/^data: /, '')) as Record<string, unknown>);
}

interface ConsultBody {
  teamId: string;
  initiator: { role: string; name: string };
  scope?: { period?: string; objectKey?: string };
}

describe('#1431 S2b · 诊断运行显式携带 period/objectKey → ④a 真落行', () => {
  let server: Server;
  let baseUrl = '';
  let app: ReturnType<typeof express>;
  let db: Database.Database;
  let store: SqliteGraphStore;

  async function postConsult(body: ConsultBody): Promise<{ status: number; frames: Array<Record<string, unknown>> }> {
    const res = await fetch(`${baseUrl}/api/diagnosis/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const frames = parseSseFrames(await res.text());
    return { status: res.status, frames };
  }

  beforeAll(async () => {
    // 先备好 :memory: 句柄再 import 路由：路由链上的模块在 import 期若取引擎库，也必须拿到有效句柄
    db = new Database(':memory:');
    store = new SqliteGraphStore(db);
    mockedGetDatabase.mockImplementation(() => db);

    const diagnosisRouter = (await import('../../src/routes/diagnosis')).default;
    app = express();
    app.use(express.json());
    app.locals.orchestration = { db: new Database(':memory:') };
    app.locals.graphStore = store;
    app.use(diagnosisRouter);
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') baseUrl = `http://localhost:${addr.port}`;
    });
    await new Promise<void>((resolve) => {
      const t = setInterval(() => { if (baseUrl) { clearInterval(t); resolve(); } }, 10);
    });
  });

  beforeEach(() => {
    destroySentinelRegistry();
    logCapture.calls.length = 0;
    db = new Database(':memory:');
    store = new SqliteGraphStore(db);
    mockedGetDatabase.mockImplementation(() => db);
    app.locals.graphStore = store;
    getSentinelRegistry().register(makeProbeSentinel());
  });

  afterEach(() => {
    destroySentinelRegistry();
    try {
      db.close();
    } catch {
      /* 已关闭的库不掩盖断言（与 S1/S2 先例一致） */
    }
  });

  afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

  it('[正例·真实入口] POST /consult 带 scope.period/objectKey ⇒ ④a 落行，period/object_id 来自入参', async () => {
    const { status, frames } = await postConsult({
      teamId: TEAM_ID,
      initiator: { role: 'GA', name: '测试GA' },
      scope: { period: PERIOD, objectKey: OBJECT_KEY },
    });

    // 诊断仍正常返回（SSE complete 帧；报告 summary 来自假 LLM 的固定产出）
    expect(status).toBe(200);
    const complete = frames.find(f => f.type === 'complete');
    expect(complete).toBeDefined();
    expect((complete?.['report'] as { summary?: string } | undefined)?.summary).toBe('S2b 测试诊断报告');

    // ④a 物理行：1 个探针哨兵 × 2 个轮次级指标
    const rows = observationRows(db);
    expect(rows).toHaveLength(2);
    const findingsRow = rows.find(r => r.metric_id === `SENTINEL-FINDINGS-${SENTINEL_ID}`);
    const durationRow = rows.find(r => r.metric_id === `SENTINEL-DURATION-${SENTINEL_ID}`);
    if (!findingsRow || !durationRow) throw new Error('期望的两行缺一');
    expect(durationRow).toBeDefined();

    // 期望值 = 请求入参（teamId / period / objectKey），不是读表反填
    expect(findingsRow.org_id).toBe(TEAM_ID);
    expect(findingsRow.period).toBe(PERIOD);
    expect(findingsRow.object_id).toMatch(NODE_ID_PATTERN);
    expect(findingsRow.object_id).not.toBe('*');
    expect(findingsRow.value).toBe(FINDINGS_COUNT);
    expect(findingsRow.def_version).toBe(SENTINEL_VERSION);
    expect(durationRow.period).toBe(PERIOD);
    expect(durationRow.object_id).toBe(findingsRow.object_id);
    expect(durationRow.value).toBe(DURATION_MS);
    expect(durationRow.unit).toBe('ms');

    // object_id 指向请求 objectKey 对应的真实 ② 节点（graph=teamId、type=Team、businessKey=入参）
    const node = db.prepare('SELECT graph, type, props FROM graph_nodes WHERE id = ?').get(findingsRow.object_id) as
      | { graph: string; type: string; props: string }
      | undefined;
    if (!node) throw new Error('object_id 在 graph_nodes 查不到');
    expect(node.graph).toBe(TEAM_ID);
    expect(node.type).toBe('Team');
    expect((JSON.parse(node.props) as Record<string, unknown>)['businessKey']).toBe(OBJECT_KEY);
  });

  it('[正例·非当期] period 不等于运行时当月 ⇒ 行 period 精确等于入参（时钟派生必红）', async () => {
    const { status, frames } = await postConsult({
      teamId: TEAM_ID,
      initiator: { role: 'GA', name: '测试GA' },
      scope: { period: OFF_CLOCK_PERIOD, objectKey: OBJECT_KEY },
    });

    expect(status).toBe(200);
    expect(frames.some(f => f.type === 'complete')).toBe(true);

    const rows = observationRows(db);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // 引擎若用 new Date() 派生 period，这里是当月（≠ 2034-06）⇒ 本断言打红
      expect(row.period).toBe(OFF_CLOCK_PERIOD);
      expect(row.org_id).toBe(TEAM_ID);
      expect(row.object_id).toMatch(NODE_ID_PATTERN);
    }
  });

  it('[反例1] 请求不带 scope ⇒ 新表 0 行 + S2_DEGRADED_NO_PERIOD（诊断仍正常返回）', async () => {
    const { status, frames } = await postConsult({
      teamId: TEAM_ID,
      initiator: { role: 'GA', name: '测试GA' },
    });

    expect(status).toBe(200);
    expect(frames.some(f => f.type === 'complete')).toBe(true);
    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_NO_PERIOD');
    // 旧链（metric_readings）不受影响：该轮照常写 2 行
    const legacy = db.prepare('SELECT COUNT(*) AS n FROM metric_readings WHERE org_id = ?').get(TEAM_ID) as { n: number };
    expect(legacy.n).toBe(2);
  });

  it('[反例2] 带 period 不带 objectKey ⇒ 新表 0 行 + S2_DEGRADED_NO_OBJECT（不回退写 *）', async () => {
    const { status, frames } = await postConsult({
      teamId: TEAM_ID,
      initiator: { role: 'GA', name: '测试GA' },
      scope: { period: PERIOD },
    });

    expect(status).toBe(200);
    expect(frames.some(f => f.type === 'complete')).toBe(true);
    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_NO_OBJECT');
    const starRows = db.prepare("SELECT COUNT(*) AS n FROM metric_observations WHERE object_id = '*'").get() as { n: number };
    expect(starRows.n).toBe(0);
  });

  it('[反例3] period 非 YYYY-MM ⇒ 新表 0 行 + S2_DEGRADED_BAD_PERIOD（复用 S2 码）', async () => {
    const { status, frames } = await postConsult({
      teamId: TEAM_ID,
      initiator: { role: 'GA', name: '测试GA' },
      scope: { period: '2026-13', objectKey: OBJECT_KEY },
    });

    expect(status).toBe(200);
    expect(frames.some(f => f.type === 'complete')).toBe(true);
    expect(observationRows(db)).toHaveLength(0);
    expect(warnCodes()).toContain('S2_DEGRADED_BAD_PERIOD');
    // 非法 period 在解析对象之前就挡住 ⇒ 一个 Team 节点都不建
    const teamNodes = db.prepare("SELECT COUNT(*) AS n FROM graph_nodes WHERE graph = ? AND type = 'Team'").get(TEAM_ID) as { n: number };
    expect(teamNodes.n).toBe(0);
  });
});
