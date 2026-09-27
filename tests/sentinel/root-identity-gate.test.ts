/**
 * tests/sentinel/root-identity-gate.test.ts — D1027 哨兵读侧「根身份」硬门禁
 *
 * 契约（铁律 47/48；对应 task-1 正文 + brief Q3）:
 *   被测包装层 = src/sentinel/sentinel-loader.ts 的 registerLoadedSentinels() check wrapper。
 *   它在调用 aggregate **之前**对 manifest.dependsOn.nodeTypes 逐类型比对
 *   unfiltered = queryNodes(type) 与 filtered = queryNodes(type, { teamId }):
 *     · unfiltered > 0 且 filtered > 0  → 预检通过，无 root-identity finding（正常路径）
 *     · unfiltered > 0 且 filtered === 0 → 根身份不匹配: 显式 finding（severity warning，
 *        id `sentinel-<manifest.name>-root-identity`）+ result.degraded === true（触发路径）
 *     · unfiltered === 0                → 空态 ≠ 不匹配: 无 finding（边界）
 *     · store 无 queryNodes             → log.warn + 不抛 + 无 finding（降级路径）
 *     · 同一夹具把 teamId 写进 props     → finding 消失（成对反例）
 *
 * 铁律 12（不 mock 管线）: 夹具 = 真实 :memory: SQLite + 真实 SqliteGraphStore +
 *   真实 loader 装配（registerLoadedSentinels → registry → check wrapper）+
 *   真实 margin-health aggregate（manifest.dependsOn.nodeTypes = ["Financial"]）。
 *   mock 边界仅限日志旁路（@synova/logger）: 本卡契约要求「不静默」（log.error / log.warn
 *   必须可见），日志是**断言对象**，不是被 mock 掉的管线。
 *
 * 前提冻结（写在夹具内，可核）: 用例 2 先断言真实 store 的
 *   queryNodes('Financial').length === 1 且 queryNodes('Financial', { teamId }).length === 0
 *   —— 这正是「图里有节点、按身份过滤读不到」的物理前提，被测的正是它。
 *
 * 判别性证明（手动流程，回执内附原始输出）: 注释掉 check wrapper 内
 *   `const rootIdentity = rootIdentityPrecheck(...)` 调用 → 本文件触发路径用例必红。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// 日志旁路 mock（同类先例: tests/sentinel/ticket-store.test.ts:33）
const { logMock } = vi.hoisted(() => ({
  logMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));
vi.mock('@synova/logger', () => ({ logger: logMock, createLogger: vi.fn(() => logMock) }));

import { registerLoadedSentinels, clearSentinelCache } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry, destroySentinelRegistry } from '../../src/sentinel/registry';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import type { SentinelContext, SentinelCheckResult } from '../../src/sentinel/types';

/** 被测哨兵: manifest.dependsOn.nodeTypes = ["Financial"]（extensions/sentinels/margin-health/manifest.json） */
const SENTINEL_ID = 'sentinel-margin-health';
const SENTINEL_NAME = 'margin-health';
const GATE_ID = `sentinel-${SENTINEL_NAME}-root-identity`;
/** 本次运行身份（生产链路 = runner.executeSentinel 不传 teamId → 包装层落 'default'） */
const TEAM = 'wani-baby';

// ═══ 夹具 ═══

const openDbs: Database.Database[] = [];

/**
 * 真实 store 夹具: `:memory:` SQLite + SqliteGraphStore（非 mock）。
 * nodeProps === null ⇒ 图内零节点（边界用例）。
 */
function makeRealStore(nodeProps: Record<string, unknown> | null): SqliteGraphStore {
  const db = new Database(':memory:');
  openDbs.push(db);
  const store = new SqliteGraphStore(db);
  if (nodeProps !== null) store.createNode('Financial', nodeProps);
  return store;
}

/**
 * margin-health 入口必填字段组（total_revenue / gross_margin / operating_expense）齐全，
 * 使「有 / 无 teamId」成为成对夹具的**唯一差异**（见「成对反例」用例断言）。
 */
function financialProps(identityTeamId?: string): Record<string, unknown> {
  const props: Record<string, unknown> = {
    total_revenue: 100,
    gross_margin: 30,
    operating_expense: 40,
  };
  if (identityTeamId !== undefined) props.teamId = identityTeamId;
  return props;
}

function ctxOf(db: unknown): SentinelContext {
  return { db, now: new Date(), teamId: TEAM };
}

/** 取经真实 loader 装配的 margin-health 哨兵 */
function loadedMarginHealth() {
  const sentinel = getSentinelRegistry().get(SENTINEL_ID);
  expect(sentinel).toBeTruthy();
  return sentinel!;
}

/** 从日志 mock 里取匹配的 warn 元数据（本卡契约含「不静默」，日志是可断言对象） */
function warnsMatching(messageIncludes: string): Array<Record<string, unknown>> {
  const hits: Array<Record<string, unknown>> = [];
  for (const call of logMock.warn.mock.calls) {
    const meta: unknown = call[0];
    const message: unknown = call[1];
    if (typeof message === 'string' && message.includes(messageIncludes) && typeof meta === 'object' && meta !== null) {
      hits.push(meta as Record<string, unknown>);
    }
  }
  return hits;
}

function gateFindings(result: SentinelCheckResult) {
  return result.findings.filter(f => f.id === GATE_ID);
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearSentinelCache();
  destroySentinelRegistry();
  const { registered, errors } = await registerLoadedSentinels();
  expect(registered).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
  clearSentinelCache();
  destroySentinelRegistry();
});

// ═══ 五条路径 ═══

describe('D1027 读侧根身份硬门禁（真实 store + 真实 loader 装配）', () => {
  it('正常路径: unfiltered > 0 且 filtered > 0 ⇒ 无 root-identity finding（既有行为不变）', async () => {
    const store = makeRealStore(financialProps(TEAM));
    // 前提冻结: 同一身份写、同一身份读 → 两条路径都看得见
    expect(store.queryNodes('Financial').length).toBe(1);
    expect(store.queryNodes('Financial', { teamId: TEAM }).length).toBe(1);

    const result = await loadedMarginHealth().check(ctxOf(store));

    expect(result.ok).toBe(true);
    expect(gateFindings(result)).toEqual([]);
    expect(result.degraded).toBeUndefined();
  });

  it('触发: unfiltered > 0 且 filtered === 0（节点 props 无 teamId）⇒ finding + degraded === true', async () => {
    const store = makeRealStore(financialProps()); // 无 teamId —— 生产 ingest 的实际形态
    // 前提冻结: 图里有 1 个 Financial 节点，但按本次身份过滤读到 0（断裂在本用例内物理复现）
    expect(store.queryNodes('Financial').length).toBe(1);
    expect(store.queryNodes('Financial', { teamId: TEAM }).length).toBe(0);

    const result = await loadedMarginHealth().check(ctxOf(store));

    expect(result.ok).toBe(true);
    const gate = gateFindings(result);
    expect(gate).toHaveLength(1);
    expect(gate[0].severity).toBe('warning');
    expect(gate[0].evidence).toContain(`nodeType=Financial unfiltered=1 filtered=0 teamId=${TEAM}`);
    expect(gate[0].title).toContain(TEAM);
    expect(gate[0].description).toContain('不是空库基线');
    expect(gate[0].detectedAt).toBeTruthy();
    expect(result.degraded).toBe(true);
    // 聚合层确实看不见任何节点（无 mh-* 业务 finding）——「静默空返」被换成了显式告警
    expect(result.findings.filter(f => f.id.startsWith('mh-'))).toEqual([]);
    // 契约要求 log.error 可见（不静默）
    expect(logMock.error).toHaveBeenCalled();
  });

  it('边界: unfiltered === 0（真空库）⇒ 无 finding（空态 ≠ 不匹配）', async () => {
    const store = makeRealStore(null);
    expect(store.queryNodes('Financial').length).toBe(0);

    const result = await loadedMarginHealth().check(ctxOf(store));

    expect(result.ok).toBe(true);
    expect(gateFindings(result)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.degraded).toBeUndefined();
  });

  it('降级: store 无 queryNodes ⇒ log.warn + 不抛 + 无 finding', async () => {
    const result = await loadedMarginHealth().check(ctxOf({})); // 无 queryNodes 的 store

    expect(result.ok).toBe(true);
    expect(gateFindings(result)).toEqual([]);
    // 不静默（铁律 11）：跳过必须留痕，且元数据可定位到哨兵与身份
    const warns = warnsMatching('根身份预检跳过');
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.some(w => w.sentinel === SENTINEL_NAME && w.teamId === TEAM)).toBe(true);
  });

  it('成对反例: 同一夹具把 teamId 写进 props ⇒ finding 消失（唯一差异 = teamId 一个属性）', async () => {
    const withoutIdentity = financialProps();
    const withIdentity = financialProps(TEAM);

    // 成对性证明: 两份 props 的键集合只差 teamId，共有键取值逐一相同
    const keysA = Object.keys(withoutIdentity).sort();
    const keysB = Object.keys(withIdentity).sort();
    expect(keysB).toEqual([...keysA, 'teamId'].sort());
    for (const key of keysA) expect(withIdentity[key]).toEqual(withoutIdentity[key]);

    const blindResult = await loadedMarginHealth().check(ctxOf(makeRealStore(withoutIdentity)));
    const seenResult = await loadedMarginHealth().check(ctxOf(makeRealStore(withIdentity)));

    expect(gateFindings(blindResult)).toHaveLength(1);
    expect(gateFindings(seenResult)).toEqual([]);
    expect(blindResult.degraded).toBe(true);
    expect(seenResult.degraded).toBeUndefined();
  });
});
