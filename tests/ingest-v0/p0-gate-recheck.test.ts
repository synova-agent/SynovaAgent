/**
 * tests/ingest-v0/p0-gate-recheck.test.ts — A 段：P0 六条接口**组合态复检**（#1492 / DEV DOC v2 §2 §3）
 *
 * 为什么另立本件：适配批 PR #1489 已合入 main，但四条适配（裁定 a/b/c/e）的**组合态**从未被整体验证；
 * 各适配件自带的单测只证"本件可跑"，不证"脚本落库 → 现有产品读得到"这条链能一起跑通。
 *
 * 六条判据（与任务书 a–f 逐条对应，期望值全部由本文件构造，不拿读表结果反推期望）：
 *   a) `createObject` 省略 `defVersion` ⇒ 成功且落库 `defVersion='ingest-v0'`；
 *      省略 `period` / 伪造 `period='2026-13'` ⇒ `GraphWriteError(VALIDATION, field=period)` 且**零写入**
 *   b) `persistFacts` 落对象+关系 ⇒ 成功；`synova_context_get` 对根对象 ⇒ `count>0`；
 *      绕过 `persistFacts` 直写 `scan_ontology_links` ⇒ 006 触发器 ABORT（原文可核）且**无脏行**
 *   c) 带 `period` 跑哨兵 ⇒ 不再出现 `S2_DEGRADED_NO_PERIOD`，且 `ctx.metricObservations.get` 读到**真实行**；
 *      不带 `period`（对照组）⇒ 该降级码仍出现
 *   d) `POST /api/dsh/runs` 带 `problemId` ⇒ token 上下文/`run.started` 收到该值，且**发给模型的 prompt 不含它**
 *   e) 域上下文工具未被本批破坏：`$id` 与 `businessKey` 双路径解析、快照稳定、条目字段来自真实行
 *   f) 桌面事件链未被本批破坏：`hypothesis.structured` 服务端发射点仍在（消费侧由 `tests/dsh-ui` 验证）
 *
 * 库口径（硬性）：**隔离库** `%TEMP%\ingest-v0\synova.db`（可用 `INGEST_V0_RECHECK_DB` 覆盖，但路径必须仍以
 *   `ingest-v0/synova.db` 结尾）。绝不碰 `data/synova.db` 与生产库；`beforeAll` 先断言路径再建库。
 * 网络：**零外发** —— 路由测试用 fake ACP（不 spawn 真实 dsh）＋ fake 回环 MCP（不监听端口）。
 * 铁律 33/38/48：`*.test.ts`；零 `as any`/`as never`/`as unknown as`；每个用例含 `expect()`。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDatabase, initEngineContext } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createObject, GraphWriteError } from '../../src/agent/graph-store-service';
import { EnterpriseScanStore } from '../../src/l4/enterprise-scan-store';
import type { PersistFactsInput } from '../../src/l4/enterprise-scan-store';
import { buildContextSnapshot } from '../../src/runtime/dsh/domain-context';
import { handleDomainToolCall, ToolTokenStore } from '../../src/runtime/dsh/tools';
import type { ContextSnapshot, ToolCallContext } from '../../src/runtime/dsh/tools';
import { DshRunManager } from '../../src/runtime/dsh/session';
import type { AcpClientLike, AcpSessionUpdate, RunRecord } from '../../src/runtime/dsh/session';
import { createDshRouter } from '../../src/routes/dsh';
import type { JwtPayload } from '../../src/middleware/auth';
import { destroySentinelRegistry, getSentinelRegistry } from '../../src/sentinel/registry';
import { runSentinelForTeam } from '../../src/sentinel/sentinel-runner';
import type { Sentinel, SentinelCheckResult, SentinelContext } from '../../src/sentinel/types';

// ═══ 隔离库路径（先断言、再建库；不碰 data/synova.db）═══════════════════════════

/** @input 无（读 `INGEST_V0_RECHECK_DB` 或系统临时目录）@output 复检库绝对路径 @degraded 无 @authority 本件独占 @not-here 不建库、不删库 @error 无 */
function resolveRecheckDbPath(): string {
  const override = process.env.INGEST_V0_RECHECK_DB;
  if (typeof override === 'string' && override.length > 0) return path.resolve(override);
  return path.join(os.tmpdir(), 'ingest-v0', 'synova.db');
}

/**
 * @input dbPath 候选库路径
 * @output 无（通过即返回）
 * @degraded 无
 * @authority 隔离口径由本函数钉死：**只允许** `ingest-v0/synova.db` 形态
 * @not-here 不做文件操作
 * @error Error —— 路径不是隔离库（防止误连 `data/synova.db` 或生产库）
 */
function assertIsolatedDbPath(dbPath: string): void {
  const normalized = dbPath.split(path.sep).join('/');
  if (!normalized.endsWith('/ingest-v0/synova.db')) {
    throw new Error(`P0 复检只允许隔离库 .../ingest-v0/synova.db，实得 ${dbPath}`);
  }
}

const RECHECK_DB = resolveRecheckDbPath();
assertIsolatedDbPath(RECHECK_DB);
fs.mkdirSync(path.dirname(RECHECK_DB), { recursive: true });
if (fs.existsSync(RECHECK_DB)) {
  // 只重建本件自己指定的隔离库（路径已断言）；不删任何目录、不碰其它文件
  console.warn(`[p0-recheck] 重建隔离库（上一次运行残留）：${RECHECK_DB}`);
  fs.rmSync(RECHECK_DB);
}
process.env.SYNOVA_DB_PATH = RECHECK_DB;

// ═══ log.warn 运行时捕获（判据 c：降级码必须可见）══════════════════════════════

const logCapture = vi.hoisted(() => ({ calls: [] as Array<{ level: string; meta?: Record<string, unknown> }> }));

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: Record<string, unknown>) => {
    logCapture.calls.push({ level, meta });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
    }),
  };
});

/** @input 无 @output 本轮捕获到的 warn 降级码清单 @degraded 无 @authority 本件 @not-here 不改日志行为 @error 无 */
function warnCodes(): string[] {
  const codes: string[] = [];
  for (const call of logCapture.calls) {
    if (call.level !== 'warn') continue;
    const code = call.meta?.['code'];
    if (typeof code === 'string') codes.push(code);
  }
  return codes;
}

// ═══ 本文件构造的期望值（唯一来源）═══════════════════════════════════════════

const A_ORG = 'org-1492-p0-a';
const B_ORG = 'org-1492-p0-b';
const C_ORG = 'org-1492-p0-c';
const D_ORG = 'org-1492-p0-d';
const PERIOD = '2026-10';
const FORGED_PERIOD = '2026-13';
const TEAM_KEY = 'team-1492-p0';
const BATCH_KEY = 'batch-1492-p0-1';
const REL_TYPE = 'edge/team_executes_activity';
const REL_KEY = 'rel-1492-p0-1';
const SENTINEL_ID = 'p0-recheck-probe';
const FINDINGS_COUNT = 2;
const CHECKED_AT = '2026-11-24T10:00:00.000Z';
const DT_SCOPE = 'admin';

let db: ReturnType<typeof getDatabase>;

// ═══ 公用取数（都从物理行读，不读缓存/自报值）════════════════════════════════

/** @input id/graph @output `graph_nodes.props` 解析后的普通对象 @degraded 无 @authority 物理行 @not-here 不解释业务语义 @error 缺行/JSON 非对象 ⇒ throw */
function readNodeProps(id: string, graph: string): Record<string, unknown> {
  const row = db.prepare('SELECT props FROM graph_nodes WHERE id = ? AND graph = ?').get(id, graph) as
    | { props: string }
    | undefined;
  if (row === undefined) throw new Error(`graph_nodes 缺行: ${id} @ ${graph}`);
  const parsed: unknown = JSON.parse(row.props);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`graph_nodes.props 不是 JSON 对象: ${id}`);
  }
  return parsed as Record<string, unknown>;
}

/** @input graph @output 该分区节点数 @degraded 无 @authority 物理行 @not-here 不做分页 @error SQL 失败原样抛 */
function nodeCount(graph: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes WHERE graph = ?').get(graph) as { n: number }).n;
}

/** @input graph @output 该分区链接行数 @degraded 无 @authority 物理行 @not-here 不做分页 @error SQL 失败原样抛 */
function linkCount(graph: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM scan_ontology_links WHERE graph = ?').get(graph) as { n: number }).n;
}

/** @input fn @output 捕获到的异常（断言类型用） @degraded 无 @authority 本件 @not-here 不吞成成功 @error 无（未捕获时为 undefined） */
function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err: unknown) {
    return err;
  }
}

/**
 * emit — 把该条判据的**原始观测值**打到 stdout（任务书要求"每条给命令+原文+结论"；断言仍由 `expect` 负责）。
 *
 * @input label 判据标号；value 可 JSON 化的原始观测（含 SQL 返回值、错误原文、快照 JSON）
 * @output 无（副作用：stdout 一行 `[p0-recheck] <label> <json>`）
 * @degraded 无（序列化失败 ⇒ 回落 String(value)，不静默丢失）
 * @authority 本件
 * @not-here 不做断言、不改被测状态
 * @error 无
 */
function emit(label: string, value: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  console.info(`[p0-recheck] ${label} ${text}`);
}

beforeAll(() => {
  initEngineContext();
  db = getDatabase();
  console.info(`[p0-recheck] 隔离库 = ${RECHECK_DB}`);
});

afterAll(() => {
  // 不删隔离库（留证可重跑）；只还原进程内环境，避免污染同 worker 的其它测试文件
  process.env.SYNOVA_DB_PATH = ':memory:';
});

// ═══ a) 对象写入：defVersion 可缺省 / period 强制 ══════════════════════════════

describe('a) createObject：省略 defVersion 成功、省略/伪造 period 必须被拒', () => {
  it('[正常] 省略 defVersion ⇒ 成功且落库 defVersion=ingest-v0', () => {
    const inputProps: Record<string, unknown> = { name: '交付团队（P0 复检）', period: PERIOD };
    const nodeId = createObject(A_ORG, 'Team', inputProps);

    expect(nodeId).toMatch(/^node-[0-9a-f-]{36}$/);
    const landed = readNodeProps(nodeId, A_ORG);
    expect(landed.defVersion).toBe('ingest-v0');
    expect(landed.period).toBe(PERIOD);
    expect(landed.name).toBe('交付团队（P0 复检）');
    // 入参不被就地改写（系统默认值只进落库副本）
    expect('defVersion' in inputProps).toBe(false);
    emit('a1', { nodeId, landedProps: landed, inputProps });
  });

  it('[失败] 省略 period ⇒ VALIDATION(field=period) 且零写入', () => {
    const before = nodeCount(A_ORG);
    const err = caught(() => createObject(A_ORG, 'Team', { name: '无期间' }));

    expect(err).toBeInstanceOf(GraphWriteError);
    const writeErr = err as GraphWriteError;
    expect(writeErr.code).toBe('VALIDATION');
    expect(writeErr.field).toBe('period');
    expect(writeErr.phase).toBe('validate');
    expect(writeErr.retryable).toBe(false);
    expect(nodeCount(A_ORG)).toBe(before);
    emit('a2-omit-period', { code: writeErr.code, field: writeErr.field, phase: writeErr.phase, message: writeErr.message, nodesBefore: before, nodesAfter: nodeCount(A_ORG) });
  });

  it('[失败] 伪造 period=2026-13 ⇒ VALIDATION(field=period) 且零写入', () => {
    const before = nodeCount(A_ORG);
    const err = caught(() => createObject(A_ORG, 'Team', { name: '伪造期间', period: FORGED_PERIOD }));

    expect(err).toBeInstanceOf(GraphWriteError);
    const writeErr = err as GraphWriteError;
    expect(writeErr.code).toBe('VALIDATION');
    expect(writeErr.field).toBe('period');
    expect(writeErr.message).toContain(FORGED_PERIOD);
    expect(nodeCount(A_ORG)).toBe(before);
    emit('a3-forged-period', { code: writeErr.code, field: writeErr.field, message: writeErr.message, nodesBefore: before, nodesAfter: nodeCount(A_ORG) });
  });
});

// ═══ b) 事实落库：persistFacts → synova_context_get ═══════════════════════════

describe('b) persistFacts 落库 ⇒ synova_context_get 读得到；直写 scan_* ⇒ 触发器 ABORT', () => {
  /** @input 无 @output 一批合法事实（对象带资料期间与定义版本，关系 team→batch） @degraded 无 @authority 本件构造 @not-here 不读库 @error 无 */
  function baseFacts(): PersistFactsInput {
    return {
      graph: B_ORG,
      objects: [
        {
          type: 'resource/delivery_team',
          businessKey: TEAM_KEY,
          props: { name: '交付团队 B', period: PERIOD, defVersion: 'ingest-v0' },
        },
        {
          type: 'activity/delivery_batch',
          businessKey: BATCH_KEY,
          // SOG 必填属性由本体定义要求（`activity/delivery_batch.teamBusinessKey`），由调用方从资料给出
          props: { name: '批次 B-1', period: PERIOD, defVersion: 'ingest-v0', teamBusinessKey: TEAM_KEY },
        },
      ],
      relations: [
        { type: REL_TYPE, businessKey: REL_KEY, fromBusinessKey: TEAM_KEY, toBusinessKey: BATCH_KEY },
      ],
    };
  }

  it('[正常] 落对象+关系成功，且 synova_context_get 对根对象 count>0 并引用刚写入的物理行', () => {
    const scanStore = new EnterpriseScanStore(db, new SqliteGraphStore(db));
    const persisted = scanStore.persistFacts(baseFacts());

    const nodes = persisted.facts.filter(fact => fact.kind === 'node');
    const edges = persisted.facts.filter(fact => fact.kind === 'edge');
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(nodes.every(fact => fact.replayed === false)).toBe(true);
    expect(edges[0].objectId).toMatch(/^edge-[0-9a-f-]{36}$/);

    // 物理行确实在库里（不是"接口说写成功了"）
    const batchId = nodes.find(fact => fact.businessKey === BATCH_KEY)?.objectId;
    expect(typeof batchId).toBe('string');
    expect(readNodeProps(String(batchId), B_ORG).period).toBe(PERIOD);

    const ctx: ToolCallContext = { enterpriseId: B_ORG, userId: 'user-1492-b', scope: DT_SCOPE, runId: 'run_1492_b' };
    // 既有形态：工具入参给 problemId（ctx 无 run 级 problemId 时兜底）
    const snapshot = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: TEAM_KEY }, ctx)) as ContextSnapshot;
    expect(snapshot.synthetic).toBe(false);
    expect(snapshot.count).toBeGreaterThan(0);
    expect(snapshot.items[0].$id).toBe(batchId);
    expect(snapshot.items[0].period).toBe(PERIOD);
    expect(snapshot.items[0].defVersion).toBe('ingest-v0');
    expect(snapshot.items[0].relation?.type).toBe(REL_TYPE);
    emit('b1-persistFacts', { facts: persisted.facts, snapshot, batchProps: readNodeProps(String(batchId), B_ORG) });
  });

  it('[反例] 绕过 persistFacts 直写 scan_ontology_links ⇒ 006 触发器 ABORT，且无脏行', () => {
    const before = linkCount(B_ORG);
    const fakeObjectId = 'node-00000000-0000-4000-8000-000000000000';
    const err = caught(() => {
      db.prepare(
        'INSERT INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id) VALUES (?, ?, ?, ?, ?)',
      ).run(B_ORG, 'node', 'resource/delivery_team', 'direct-write-1492', fakeObjectId);
    });

    expect(err).toBeInstanceOf(Error);
    const message = err instanceof Error ? err.message : '';
    expect(message).toContain('scan ontology node graph/type mismatch');
    expect(linkCount(B_ORG)).toBe(before);
    const dirty = db.prepare('SELECT COUNT(*) AS n FROM scan_ontology_links WHERE business_key = ?')
      .get('direct-write-1492') as { n: number };
    expect(dirty.n).toBe(0);
    emit('b2-direct-write', { triggerError: message, linksBefore: before, linksAfter: linkCount(B_ORG), dirtyRows: dirty.n });
  });

  it('[边界] props 缺 defVersion 的对象仍落库，但不产出域上下文条目（不补零、不编常量）', () => {
    const scanStore = new EnterpriseScanStore(db, new SqliteGraphStore(db));
    const facts: PersistFactsInput = {
      graph: `${B_ORG}-nodef`,
      objects: [
        { type: 'resource/delivery_team', businessKey: 'team-1492-p0-nodef', props: { name: '根', period: PERIOD, defVersion: 'ingest-v0' } },
        { type: 'activity/delivery_batch', businessKey: 'batch-1492-p0-nodef', props: { name: '邻接', period: PERIOD, teamBusinessKey: 'team-1492-p0-nodef' } },
      ],
      relations: [{ type: REL_TYPE, businessKey: 'rel-1492-p0-nodef', fromBusinessKey: 'team-1492-p0-nodef', toBusinessKey: 'batch-1492-p0-nodef' }],
    };
    scanStore.persistFacts(facts);

    const ctx: ToolCallContext = { enterpriseId: `${B_ORG}-nodef`, userId: 'user-1492-b', scope: DT_SCOPE, runId: 'run_1492_b_nodef' };
    const snapshot = buildContextSnapshot(ctx, 'team-1492-p0-nodef');
    expect(snapshot.count).toBe(0);
    expect(snapshot.insufficient?.code).toBe('INSUFFICIENT_CONTEXT');
    expect(snapshot.insufficient?.missing).toContain('defVersion');
    emit('b3-no-defVersion', { snapshot });
  });
});

// ═══ c) 指标 → 哨兵：period 透传 + 读路径 ═════════════════════════════════════

describe('c) metric_observations 带 period ⇒ 无 S2_DEGRADED_NO_PERIOD 且 reader 读真实行', () => {
  const seen: Array<{ period: string | undefined; hasReader: boolean; readValue: number | null }> = [];
  let readObjectId = '';

  /** @input 无 @output 探针哨兵（记录 period/读路径，读上一轮真实行） @degraded 无 @authority 本件构造 @not-here 不写库 @error 无 */
  function makeProbeSentinel(): Sentinel {
    return {
      config: {
        id: SENTINEL_ID,
        name: 'c 组探针',
        description: '记录 period 透传与读路径，且读真实观测行',
        category: 'growth',
        priority: 'P1',
        mode: 'manual',
        requiredDataSources: [],
        confidenceModel: 'deterministic',
        version: '1.0.0',
      },
      async check(context: SentinelContext): Promise<SentinelCheckResult> {
        const hasReader = context.metricObservations !== undefined;
        let readValue: number | null = null;
        if (hasReader && readObjectId !== '') {
          const row = context.metricObservations?.get(readObjectId, `SENTINEL-FINDINGS-${SENTINEL_ID}`);
          readValue = row === null || row === undefined ? null : row.value;
        }
        seen.push({ period: context.period, hasReader, readValue });
        return {
          sentinelId: SENTINEL_ID,
          ok: true,
          findings: Array.from({ length: FINDINGS_COUNT }, (_, i) => ({
            id: `${SENTINEL_ID}-f-${i + 1}`,
            severity: 'warning' as const,
            title: `发现 ${i + 1}`,
            description: 'P0 复检构造',
            evidence: [],
            suggestion: '无',
            detectedAt: CHECKED_AT,
          })),
          durationMs: 3,
          checkedAt: CHECKED_AT,
        };
      },
    };
  }

  it('[正常] 带 period 跑完无 S2_DEGRADED_NO_PERIOD，reader 读到真实行（对照组同跑）', async () => {
    destroySentinelRegistry();
    getSentinelRegistry().register(makeProbeSentinel());
    logCapture.calls.length = 0;
    seen.length = 0;
    readObjectId = '';

    // 第 1 轮：真实写入 ④a 行（value = findings 条数）
    const store = new SqliteGraphStore(db);
    await runSentinelForTeam(C_ORG, store, { period: PERIOD, objectKey: 'team-1492-p0-c' });
    const written = db.prepare(
      'SELECT object_id, value, period FROM metric_observations WHERE org_id = ? AND metric_id = ? AND period = ?',
    ).get(C_ORG, `SENTINEL-FINDINGS-${SENTINEL_ID}`, PERIOD) as { object_id: string; value: number; period: string } | undefined;
    expect(written).toBeDefined();
    expect(written?.value).toBe(FINDINGS_COUNT);
    readObjectId = String(written?.object_id);

    // 第 2 轮：探针读第 1 轮落下的真实行
    logCapture.calls.length = 0;
    seen.length = 0;
    await runSentinelForTeam(C_ORG, store, { period: PERIOD, objectKey: 'team-1492-p0-c' });

    expect(warnCodes()).not.toContain('S2_DEGRADED_NO_PERIOD');
    expect(seen).toHaveLength(1);
    expect(seen[0].period).toBe(PERIOD);
    expect(seen[0].hasReader).toBe(true);
    expect(seen[0].readValue).toBe(FINDINGS_COUNT);
    emit('c1-with-period', {
      sqlRow: written,
      writtenRow: db.prepare('SELECT org_id, object_id, metric_id, period, value FROM metric_observations WHERE org_id = ? AND metric_id = ?').all(C_ORG, `SENTINEL-FINDINGS-${SENTINEL_ID}`),
      probe: seen[0],
      warnCodes: warnCodes(),
    });

    // 对照组：不带 period ⇒ 该降级码仍出现（行为未放宽）
    logCapture.calls.length = 0;
    seen.length = 0;
    await runSentinelForTeam(C_ORG, store, { objectKey: 'team-1492-p0-c' });
    expect(warnCodes()).toContain('S2_DEGRADED_NO_PERIOD');
    expect(seen[0].period).toBeUndefined();
    expect(seen[0].hasReader).toBe(false);
    emit('c2-control-no-period', { probe: seen[0], warnCodes: warnCodes() });

    destroySentinelRegistry();
  });
});

// ═══ d) problemId：显式入参位（不进 prompt）══════════════════════════════════

/** fake ACP：记录 prompt 原文，不 spawn 真实 dsh（零外发）。`replyText` = 本轮模型文本。 */
class FakeAcp implements AcpClientLike {
  readonly promptTexts: string[] = [];
  private handler: ((update: AcpSessionUpdate) => void) | null = null;
  private counter = 0;

  constructor(private readonly replyText: string = 'answer') {}

  async initialize() {
    return { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } };
  }
  async newSession() {
    this.counter += 1;
    return { sessionId: `sess-1492-${this.counter}`, configOptions: [] };
  }
  async resumeSession(params: { sessionId: string }) {
    return { sessionId: params.sessionId, configOptions: [] };
  }
  async closeSession() { /* fake：无底层连接 */ }
  async prompt(params: { sessionId: string; text: string }) {
    this.promptTexts.push(params.text);
    this.handler?.({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: this.replyText } } });
    return { stopReason: 'end_turn' };
  }
  cancel() { /* fake：无进行中的轮次 */ }
  onSessionUpdate(handler: (update: AcpSessionUpdate) => void) {
    this.handler = handler;
    return () => { this.handler = null; };
  }
  dispose() { /* fake */ }
}

/** 捕获路由签发的一次性 token 上下文（不暴露 token 值）。 */
class CapturingTokenStore extends ToolTokenStore {
  readonly issued: ToolCallContext[] = [];
  issue(context: ToolCallContext): string {
    this.issued.push(context);
    return super.issue(context);
  }
}

interface RunServerHarness {
  baseUrl: string;
  runtime: DshRunManager;
  fake: FakeAcp;
  tokenStore: CapturingTokenStore;
  postRun: (body: Record<string, unknown>) => Promise<{ status: number; payload: Record<string, unknown> }>;
  close: () => Promise<void>;
}

/**
 * 起一个**真实 express 服务**（真实 `POST /api/dsh/runs` 入口）；只把模型侧 ACP 换成 fake（零外发）。
 *
 * @input org 企业身份（测试构造）／replyText 本轮"模型文本"／jti 身份票据标识
 * @output 夹具：baseUrl、run 管理器、fake、token 捕获器、postRun、close
 * @degraded 无（起不来即 throw，测试直接红）
 * @authority 身份由中间件从 header 注入（与生产同路径）；不 spawn 真 dsh、不监听外部端口
 * @not-here 不做断言（断言在各用例）
 * @error 端口绑定失败等 ⇒ throw
 */
async function startRunServer(org: string, replyText: string, jti: string): Promise<RunServerHarness> {
  const fake = new FakeAcp(replyText);
  const runtime = new DshRunManager({ instanceDir: process.cwd(), createClient: () => fake, runTimeoutMs: 5_000 });
  const tokenStore = new CapturingTokenStore();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header('x-test-user');
    const headerOrg = req.header('x-test-org');
    if (typeof user === 'string' && typeof headerOrg === 'string') {
      (req as Request & { auth?: JwtPayload }).auth = { sub: user, orgId: headerOrg, role: 'admin', jti };
    }
    next();
  });
  app.use(createDshRouter({
    runtime,
    heartbeatMs: 200,
    mcpStarter: async () => ({ url: 'http://127.0.0.1:1/mcp', tokens: tokenStore, close: async () => { /* fake */ } }),
  }));
  const server: Server = createServer(app);
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    runtime,
    fake,
    tokenStore,
    postRun: async (body) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dsh/runs`, {
        method: 'POST',
        headers: { 'x-test-user': `user-${jti}`, 'x-test-org': org, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      return { status: response.status, payload };
    },
    close: async () => {
      await runtime.dispose();
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    },
  };
}

/** 等 run 进终态（事件流 terminal 就位）；超时即 throw（不静默） */
async function waitTerminal(record: RunRecord): Promise<void> {
  for (let i = 0; i < 100 && record.stream.terminal === null; i += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  if (record.stream.terminal === null) throw new Error(`run 未在预期时间内进入终态: ${record.runId}`);
}

describe('d) POST /api/dsh/runs 带 problemId ⇒ ctx 收到；prompt 文本不含它', () => {
  const PROBLEM = 'team-1492-p0-d';
  const INPUT_TEXT = '请基于领域上下文给出瓶颈假设';
  let harness: RunServerHarness;

  beforeAll(async () => {
    const store = new SqliteGraphStore(db);
    const root = store.createNode(
      'resource/delivery_team',
      { businessKey: PROBLEM, name: '复检问题根', period: PERIOD, defVersion: 'ingest-v0' },
      D_ORG,
    );
    const neighbor = store.createNode(
      'activity/delivery_batch',
      { businessKey: 'batch-1492-p0-d', name: '复检邻接', period: PERIOD, defVersion: 'ingest-v0' },
      D_ORG,
    );
    store.createEdge(REL_TYPE, root, neighbor, 1, {}, D_ORG);
    harness = await startRunServer(D_ORG, 'answer', '1492-d');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('[正常] 带 problemId ⇒ token 上下文/run.started 收到该值，prompt 不含它', async () => {
    const { status } = await harness.postRun({ input: INPUT_TEXT, problemId: PROBLEM, runId: 'run_1492_d_ok' });
    expect(status).toBe(202);

    const record = harness.runtime.getRun('run_1492_d_ok');
    expect(record).toBeDefined();
    if (record === undefined) throw new Error('run 记录缺失');
    await waitTerminal(record);

    const ctx = harness.tokenStore.issued[harness.tokenStore.issued.length - 1];
    expect(ctx.problemId).toBe(PROBLEM);
    expect(record.stream.snapshot()[0].data.problemId).toBe(PROBLEM);

    // 反例断言：prompt 文本 = input 逐字，**不含** problemId
    expect(harness.fake.promptTexts).toHaveLength(1);
    expect(harness.fake.promptTexts[0]).toBe(INPUT_TEXT);
    expect(harness.fake.promptTexts[0].includes(PROBLEM)).toBe(false);

    // 工具侧确实收到同一个 problemId（端到端同一值）
    const snapshot = JSON.parse(handleDomainToolCall('synova_context_get', {}, ctx)) as ContextSnapshot;
    expect(snapshot.problemId).toBe(PROBLEM);
    expect(snapshot.count).toBeGreaterThan(0);
    emit('d1-problemId', {
      tokenCtx: ctx,
      runStarted: record.stream.snapshot()[0],
      promptTexts: harness.fake.promptTexts,
      promptIncludesProblemId: harness.fake.promptTexts.map(text => text.includes(PROBLEM)),
      snapshot,
    });
  });
});

// ═══ e) 域上下文工具未被本批破坏（$id / businessKey 双路径 + 快照稳定）═════════

describe('e) 域上下文工具：$id 与 businessKey 双路径、快照稳定', () => {
  it('同一根用 $id 与 businessKey 解析到同一快照；两次调用逐字相等', () => {
    const ctx: ToolCallContext = { enterpriseId: B_ORG, userId: 'user-1492-e', scope: DT_SCOPE, runId: 'run_1492_e' };
    const byKey = buildContextSnapshot(ctx, TEAM_KEY);
    expect(byKey.count).toBeGreaterThan(0);

    const rootId = String(byKey.items[0].$id);
    expect(rootId).toMatch(/^node-/);

    const again = buildContextSnapshot(ctx, TEAM_KEY);
    expect(JSON.stringify(again)).toBe(JSON.stringify(byKey));

    // 根自身也可用 $id 解析：以邻接节点 id 为根 ⇒ 仍能读到根（1 跳对称）
    const byId = buildContextSnapshot(ctx, rootId);
    expect(byId.problemId).toBe(rootId);
    expect(byId.count).toBeGreaterThan(0);
    emit('e1-domain-context', { byKey, byId, stable: JSON.stringify(again) === JSON.stringify(byKey) });
  });
});
// ═══ f) 桌面事件链未被本批破坏（经真实入口 POST /api/dsh/runs 真跑）═════════════

describe('f) 桌面事件链：经真实入口发起 run ⇒ 事件流出现 hypothesis.structured（四要素非空）', () => {
  it('模型文本为合格假设 JSON ⇒ hypothesis.structured 带四要素，且顺序在 run.completed 之前', async () => {
    // 四要素载荷（来源形态取自 DEV DOC §0 探针实测：$id / predicate / source_ref）
    const payload = {
      hypothesis: '交付验收口径与实收不一致，卡在批次验收环节',
      objects: ['team:delivery-a', 'delivery_batch:B-2026-10-001'],
      relations: ['edge/team_executes_activity'],
      evidence: ['delivery_batches.csv#L2', 'acceptance_records.csv#L7'],
      uncertainty: ['仅覆盖 2026-10 一个期间'],
    };
    const harness = await startRunServer(D_ORG, JSON.stringify(payload), '1492-f');
    try {
      // 真实用户入口：HTTP → 路由 → run 管理器 → 事件流
      const { status } = await harness.postRun({ input: '基于领域上下文给出瓶颈假设', runId: 'run_1492_f' });
      expect(status).toBe(202);

      const record = harness.runtime.getRun('run_1492_f');
      expect(record).toBeDefined();
      if (record === undefined) throw new Error('run 记录缺失');
      await waitTerminal(record);

      const events = record.stream.snapshot();
      const structured = events.find(event => event.type === 'hypothesis.structured');
      expect(structured).toBeDefined();
      const data = structured?.data ?? {};
      expect(data.hypothesis).toBe(payload.hypothesis);
      expect(data.objects).toEqual(payload.objects);
      expect(data.relations).toEqual(payload.relations);
      expect(data.evidence).toEqual(payload.evidence);
      expect(data.uncertainty).toEqual(payload.uncertainty);
      // 事件顺序：假设在 run.completed 之前（桌面据此先画卡再收尾）
      const types = events.map(event => event.type);
      expect(types.indexOf('hypothesis.structured')).toBeLessThan(types.indexOf('run.completed'));
      emit('f1-hypothesis-chain', { entry: 'POST /api/dsh/runs', eventTypes: types, structured: structured?.data ?? null });
    } finally {
      await harness.close();
    }
  });
});

