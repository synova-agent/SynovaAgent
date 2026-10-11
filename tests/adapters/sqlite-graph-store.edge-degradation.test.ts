/**
 * tests/adapters/sqlite-graph-store.edge-degradation.test.ts — #345（K4-04 Done④）**边路径**日志级别判据
 *
 * 卡面判据（CTO 2026-10-11 裁定，Done④）：
 *   「`queryEdges()` 读路径失败不得静默 —— 与 `queryNodes()` 同款 D355 口径」
 *   D355 口径 = 识别 `"no such column"` ⇒ `log.error`（不再是 `log.warn`）+ **仍返回 `[]`**（返回值语义不变）
 *
 * 为什么自建本件：全库**零**「边路径日志级别」断言——
 *   ① 字面「查询图边失败」在 `tests/` 全库命中 **0**（扫描基数：`tests/` 全部文件，其中 *.test.ts(x)/*.spec.ts(x) 688）；
 *   ② 严口径（对**日志级别**做断言）∩ 引用 `queryEdges` 的件 = 1 = `tests/contract/l4-contract.test.ts`，
 *      而该件断言的是**节点路径**（`查询图节点失败`），`queryEdges` 在其中仅为 `queryEdges: () => []` **mock 桩**。
 *   ⇒ 本件是**全库第一条边路径日志级别断言**。
 *
 * 照抄的**节点版先例形态**（锚点 = 测试标题，非行号）：
 *   `tests/contract/l4-contract.test.ts` 的「schema 漂移（props 列缺失）→ log.error 显式失效，非静默 warn」
 *   与「查询失败（非 schema 漂移）同样升级 log.error」：mock logger 单例 ⇒ 断言 `log.error` **真被调用** + 消息含锚。
 *
 * 射程声明（#345 交付件口径，CTO 定死）：
 *   **本件只覆盖 `tests/adapters/`**；**未覆盖** `src/` 引用 `queryEdges` 的 **15 个调用方** 与
 *   `tests/` 引用 `queryEdges` 的 **55 个引用件**。两个数经独立复核（命令原始输出）。
 *   base 钉 SHA（声明时点）：`1ab0cbb331702fdac21ee3a2ec68127793d6a869`。
 *
 * 铁律 33（`*.test.ts` 单元）/ 47（契约在源侧）/ 48（非空壳：正常 + 降级 + 边界）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// ═══ mock logger 单例：被测模块与测试共享同一实例 ⇒ 可断言 log.error / log.warn 调用（照抄节点版先例）═══
const h = vi.hoisted(() => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log };
});

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  return { ...actual, createLogger: vi.fn(() => h.log) };
});

import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';

/** 只取日志第二参（消息），便于逐条断言（照抄节点版先例的 `loggedMessages` 形态） */
function loggedMessages(spy: typeof h.log.error): string[] {
  return spy.mock.calls.map((call) => String(call[1]));
}

/** 取日志第一参（结构化字段），用于断言字段名口径（`predicate` 而非 `type`） */
function loggedPayloads(spy: typeof h.log.error): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => (call[0] ?? {}) as Record<string, unknown>);
}

/** canonical 存储：ctor 内 `initSchema()` → `reconcileSchema()` ⇒ 建成 canonical 形状 */
function createCanonicalStore(): { db: Database.Database; store: SqliteGraphStore } {
  const db = new Database(':memory:');
  const store = new SqliteGraphStore(db);
  return { db, store };
}

/**
 * 制造「边表 schema 漂移」：删表重建为**无 `props` 列**（且**不带 `props_json`** 可回填）
 * ⇒ `SELECT … props FROM graph_triples` 报 `no such column: props`，命中 D355 漂移分支。
 */
function driftEdgeTableWithoutProps(db: Database.Database): void {
  db.exec('DROP TABLE graph_triples');
  db.exec(`
    CREATE TABLE graph_triples (
      id TEXT PRIMARY KEY,
      graph TEXT NOT NULL DEFAULT 'default',
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      valid_from TEXT NOT NULL DEFAULT (datetime('now')),
      valid_to TEXT
    )
  `);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('#345 Done④ — 边路径读失败不得静默（D355 同款口径）', () => {
  it('🔴 ①【漂移态 · 行为断言】props 列缺失 ⇒ `log.error` **真被调用** + 消息含「图边 schema 漂移」+ 仍返回 []', () => {
    const { db, store } = createCanonicalStore();
    driftEdgeTableWithoutProps(db);

    const edges = store.queryEdges();

    // 返回值语义不变（仍 fail-open 返回空数组，不抛）
    expect(edges).toEqual([]);
    // 🔴 Done① 的核心：不是"不抛"，而是 **log.error 真被调用**
    expect(h.log.error).toHaveBeenCalled();
    const msgs = loggedMessages(h.log.error);
    expect(msgs.some((m) => m.includes('图边 schema 漂移'))).toBe(true);
    // 文案点名表名 + 列名（CTO 口径）
    expect(msgs.some((m) => m.includes('graph_triples'))).toBe(true);
    expect(msgs.some((m) => m.includes('props'))).toBe(true);
    // 🔴 反例面：旧口径的 warn 路径**不得**再承载边查询失败
    const warns = loggedMessages(h.log.warn);
    expect(warns.some((m) => m.includes('查询图边失败'))).toBe(false);
  });

  it('🔴 ②【字段名口径】结构化字段用 `predicate`，**不得**沿用 `type`（与 queryNodes 故意不同）', () => {
    const { db, store } = createCanonicalStore();
    driftEdgeTableWithoutProps(db);

    store.queryEdges();

    const payloads = loggedPayloads(h.log.error);
    expect(payloads.length).toBeGreaterThan(0);
    // 至少一条命中了漂移分支，且其字段名为 predicate
    const drift = payloads.find((p) => String(p['err'] ?? '').includes('no such column'));
    expect(drift, '应有一条 err 含 no such column 的 error 记录').toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(drift, 'predicate')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(drift, 'type')).toBe(false);
  });

  it('🔴 ③【非漂移态】整表缺失（`no such table`）⇒ 同样升级 `log.error`，消息含「查询图边失败」', () => {
    const { db, store } = createCanonicalStore();
    db.exec('DROP TABLE graph_triples'); // 整表不存在 ⇒ 走非漂移分支

    const edges = store.queryEdges();

    expect(edges).toEqual([]);
    expect(h.log.error).toHaveBeenCalled();
    const msgs = loggedMessages(h.log.error);
    expect(msgs.some((m) => m.includes('查询图边失败'))).toBe(true);
    // 非漂移态不得误报"schema 漂移"
    expect(msgs.some((m) => m.includes('图边 schema 漂移'))).toBe(false);
  });

  it('④【正常态 · 边界】无漂移时边查询路径不得产生任何 error / warn（防"常态也报错"的过宽实现）', () => {
    const { store } = createCanonicalStore();

    const edges = store.queryEdges();

    expect(edges).toEqual([]); // 空库：无边
    // 🔴 口径（照抄节点版先例）：构造器会**合法地**打一条 WAL 降级 warn
    //    （`WAL 不可用 — 降级到 DELETE 模式`）⇒ **不能**断言"warn 一次都不许有"（那是过宽断言，
    //    会把构造器的正常降级误判为失败）；要按**消息内容**判：边查询路径不得产生 error / warn。
    expect(h.log.error).not.toHaveBeenCalled();
    const warns = loggedMessages(h.log.warn);
    expect(warns.some((m) => m.includes('查询图边失败'))).toBe(false);
    expect(warns.some((m) => m.includes('图边 schema 漂移'))).toBe(false);
  });
});
