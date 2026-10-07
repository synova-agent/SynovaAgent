/**
 * tests/l4/sog-schema-validator.integration.test.ts — #980 / 0-6 可见降级（真 SQLite 集成, R26 强制）
 *
 * 覆盖（铁律 48）:
 *   I1 不阻断 + 读回 — 未覆盖类型经生产桥接入口 createNode 返回非空 nodeId, 且用**返回值** getNode 非 null（R25）
 *   I2 distinct 口径   — ALL_NODE_TYPES 去重后逐条建节点 ⇒ 聚合器 count = distinct 数, 集合相等; GOAL 负例对照
 *   I3 判别性          — 同一次运行确实收到 ≥1 条含"未覆盖类型"的 warn（告警真的发生, 非只断数组长度）
 *   I4 副作用自查      — extensions/industries/* /thresholds.json sha256 写入前后完全相同（R28）
 *
 * 生产入口: src/l4/graph-bridge.ts:81 用包装器改写 store.createNode → :82 validateAndLog(type, props)。
 *   注: createGraphBridge() 的返回对象只有 6 个 upsert* 方法, **没有 createNode**（卡面 I1/I2 的
 *   `bridge.createNode` 与实况不符, 已由队长批准走等价生产路径）—— 本文件一律在 createGraphBridge()
 *   之后调用 store.createNode(), 命中的是同一个生产校验包装器。
 *
 * 铁律 38: 零 as any / as never / as unknown as。生产侧用 `as unknown as GraphBridgeLike` 绕过 store 结构
 *   约束（src/agent/post-diagnosis-processor.ts:108），本测试**不**沿用该断言, 改为用 TestGraphStore
 *   显式补齐 GraphStore 比 SqliteGraphStore 多出的 5 个成员（见下）。
 * 临时库: mkdtempSync(tmpdir()) per-test（本仓惯例; Windows 下 `'/tmp'` 解析依赖当前盘符, 不采用）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ALL_NODE_TYPES } from '@synova/ontology';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import type { GraphStore } from '../../src/l4/graph-bridge';
import { createGraphBridge } from '../../src/l4/graph-bridge';
import { getUncoveredTypeStats, resetUncoveredTypeStats } from '../../src/l4/sog-schema-validator';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@synova/logger', () => ({ logger: logMock, createLogger: vi.fn(() => logMock) }));

const GRAPH = 'org-980';

/**
 * 夹具: GraphStore（src/l4/graph-bridge.ts:30-47）比 SqliteGraphStore 的实际方法面多 5 个成员。
 * 继承真实 SqliteGraphStore（真 SQLite 文件库, 非内存 mock）, 只补齐结构约束缺口:
 *   - createNodes / createEdges: 真实委托（走继承的真实实现）
 *   - traverse / findPaths / getNodeAtTime: 本测试不覆盖 → fail-closed 抛错（若被误调用立即红,
 *     不静默返回空数组假绿）。本测试**不对**这 3 个成员作任何断言, 也不声称它们被验证过。
 */
class TestGraphStore extends SqliteGraphStore implements GraphStore {
  createNodes(nodes: Array<{ type: string; props: Record<string, unknown> }>, graph: string): string[] {
    return nodes.map(n => this.createNode(n.type, n.props, graph));
  }

  createEdges(
    edges: Array<{ type: string; from: string; to: string; weight?: number; props?: Record<string, unknown> }>,
    graph: string,
  ): string[] {
    return edges.map(e => this.createEdge(e.type, e.from, e.to, e.weight, e.props, graph));
  }

  traverse(): never {
    throw new Error('TestGraphStore.traverse 未实现 — 本集成测试不覆盖路径遍历（补齐仅为满足 GraphStore 结构约束）');
  }

  findPaths(): never {
    throw new Error('TestGraphStore.findPaths 未实现 — 本集成测试不覆盖路径查找（补齐仅为满足 GraphStore 结构约束）');
  }

  getNodeAtTime(): never {
    throw new Error('TestGraphStore.getNodeAtTime 未实现 — SqliteGraphStore 无历史视图（补齐仅为满足 GraphStore 结构约束）');
  }
}

/** extensions/industries/* /thresholds.json 的 sha256 快照（有序, 便于 toEqual 对比） */
const INDUSTRIES_DIR = join(process.cwd(), 'extensions', 'industries');

function hashIndustryThresholds(): Array<{ file: string; sha256: string }> {
  const out: Array<{ file: string; sha256: string }> = [];
  for (const entry of readdirSync(INDUSTRIES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = join(INDUSTRIES_DIR, entry.name, 'thresholds.json');
    if (!existsSync(p)) continue;
    out.push({
      file: `${entry.name}/thresholds.json`,
      sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function warnMessages(): string[] {
  return logMock.warn.mock.calls.map(c => String(c[1]));
}

describe('#980 SOG 校验器可见降级 — 真 SQLite 集成', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;
  let store: TestGraphStore;

  beforeEach(() => {
    resetUncoveredTypeStats();
    logMock.warn.mockClear();

    tmpDir = mkdtempSync(join(tmpdir(), 'synova-980-'));
    dbPath = join(tmpDir, 'sog-980.db');
    // 观测点: 临时库绝对路径（供外部核验"确实未落在仓库内"）
    console.log(`[980-integration] tmp db = ${dbPath}`);

    db = new Database(dbPath);
    store = new TestGraphStore(db);          // 真 SQLite 文件库（非 :memory:）
    createGraphBridge(store, GRAPH);         // 生产包装器改写 store.createNode → validateAndLog
  });

  afterEach(() => {
    db.close();
    // 只清理 tmpdir 下的临时目录（前缀校验, 防误删）
    if (tmpDir && tmpDir.startsWith(tmpdir())) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('I1 不阻断 + 读回：未覆盖类型 createNode 返回非空 nodeId, getNode(返回值) 非 null', () => {
    const nodeId = store.createNode('outcome/market', {}, GRAPH);

    expect(typeof nodeId).toBe('string');
    expect(nodeId.length).toBeGreaterThan(0);

    // R25: 必须用**返回值**读回（禁用 props 里的实体 id 当节点 id）
    const back = store.getNode(nodeId, GRAPH);
    expect(back).not.toBeNull();
    expect(back?.id).toBe(nodeId);
    expect(back?.type).toBe('outcome/market');

    // 未覆盖类型 ⇒ 放行写入 + 登记聚合器（count 而非次数）
    const stats = getUncoveredTypeStats();
    expect(stats.count).toBe(1);
    expect(stats.uncoveredTypes).toEqual(['outcome/market']);
  });

  it('I2 distinct 口径：ALL_NODE_TYPES 去重后逐条 createNode ⇒ count = distinct；GOAL 负例对照', () => {
    const distinct = [...new Set(ALL_NODE_TYPES)];
    expect(ALL_NODE_TYPES.length).toBe(45); // 原始 45 条（8+8+13+9+6+1, 含 pool/activity 字面量 ×6）
    expect(distinct.length).toBe(40);       // 去重后 40 distinct

    for (const t of distinct) {
      const id = store.createNode(t, {}, GRAPH);
      expect(id.length).toBeGreaterThan(0);
    }

    const stats = getUncoveredTypeStats();
    expect(stats.count).toBe(40);
    expect(stats.uncoveredTypes).toHaveLength(40);
    expect(new Set(stats.uncoveredTypes)).toEqual(new Set(distinct));
    expect(stats.uncoveredTypes[0]).toBe(distinct[0]); // 首见序

    // 负例对照: 已覆盖 schema 类型 GOAL 不进未覆盖清单, 且不增长计数（判别性, 非平凡成立）
    expect(stats.uncoveredTypes).not.toContain('GOAL');
    expect(stats.uncoveredTypes).not.toContain('goal');
    const goalId = store.createNode('GOAL', { name: 'g-980' }, GRAPH);
    expect(goalId.length).toBeGreaterThan(0);
    expect(getUncoveredTypeStats().count).toBe(40);
    expect(getUncoveredTypeStats().uncoveredTypes).not.toContain('GOAL');
  });

  it('I3 判别性：同一次运行确实收到 ≥1 条含"未覆盖类型"的 warn（告警真的发生）', () => {
    store.createNode('resource/tool', {}, GRAPH);

    const msgs = warnMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.filter(m => m.includes('未覆盖类型')).length).toBeGreaterThanOrEqual(1);

    // 告警载荷: nodeType + 类型清单数组（V3 定位用）
    const extra = logMock.warn.mock.calls[0][0] as {
      nodeType?: string;
      uncoveredTypes?: unknown;
      uncoveredTypesCount?: number;
    };
    expect(extra.nodeType).toBe('resource/tool');
    expect(Array.isArray(extra.uncoveredTypes)).toBe(true);
    expect(extra.uncoveredTypesCount).toBe(1);

    // 未覆盖路径不得产生"校验失败"假告警（E2）
    expect(msgs.filter(m => m.includes('校验失败')).length).toBe(0);
  });

  it('I4 副作用自查：extensions/industries/*/thresholds.json sha256 写入前后完全相同（R28）', () => {
    const before = hashIndustryThresholds();
    expect(before.length).toBeGreaterThanOrEqual(6); // 实测 6 个（5 行业 + test-write）
    for (const h of before) expect(h.sha256).toHaveLength(64);

    store.createNode('resource/channel', {}, GRAPH);
    store.createNode('pool/capital', {}, GRAPH);

    const after = hashIndustryThresholds();
    expect(after).toEqual(before);
  });
});
