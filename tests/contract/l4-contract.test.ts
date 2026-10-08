/**
 * tests/contract/l4-contract.test.ts — D355 L4 数据契约收敛契约测试
 *
 * 铁律 33: *.test.ts 单元测试 (使用 :memory: SQLite)
 * 铁律 48: 真实断言 — 正常路径 + 降级路径 + 边界条件
 *
 * 契约锚点 = financial.json ontology schema（cash / operating_expense / receivables）
 *   (Client / Person / Financial / cash / operating_expense)
 *   （D355 曾误锚 compute 读侧 camelCase cashBalance/operatingExpenses，本修复已改为本体 schema snake_case）
 * 覆盖:
 *   1. 写侧映射 JSON 与读侧锚点一致（缺陷 B 修复回归）
 *   2. 上传→查询 roundtrip（写读闭环，缺陷 B 场景 2 复现）
 *   3. 旧库 props_json 构造自动迁移（缺陷 A 场景 1 复现 + 修复验证）
 *   4. 查询 fail-open 升级 log.error（非静默 warn，P0-3 修复验证）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';
import { withOrgScope } from '../../src/sentinel/org-scope';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import type { GraphStoreReader } from '../../src/l4/graph-traversal';
import { revenueHealthSentinel } from '../../extensions/sentinels/revenue-health/aggregate';
import { computeCashRunwayMonths } from '../../extensions/sentinels/cash-runway/computes/compute-cash-runway-months';

// D355: mock logger 单例 — 被测模块与测试共享同一 mock 实例, 可断言 log.error/log.warn 调用
vi.mock('@synova/logger', () => {
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return { createLogger: () => log };
});

interface MockLog {
  warn: Mock;
  error: Mock;
  info: Mock;
  debug: Mock;
}

const log = createLogger('test') as unknown as MockLog;

const MAPPINGS_DIR = join(process.cwd(), 'extensions', 'ontology', 'field-mappings');

interface FieldMappingConfig {
  name: string;
  label: string;
  targetNodeType: string;
  mappings: Array<{ externalField: string; prop: string; type: string }>;
}

function loadMapping(name: string): FieldMappingConfig {
  const raw = readFileSync(join(MAPPINGS_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(raw) as FieldMappingConfig;
}

function createDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3');
  return new BetterSqlite3(':memory:') as Database.Database;
}

/** 旧库 graph_nodes: 有 props_json 列、无 props 列（K3 P0-3 实测形态） */
function createLegacyGraphNodes(db: Database.Database): void {
  db.exec(`
    CREATE TABLE graph_nodes (
      id TEXT PRIMARY KEY,
      graph TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL,
      name TEXT,
      props_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      valid_from TEXT NOT NULL DEFAULT (datetime('now')),
      valid_to TEXT
    )
  `);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('D355 L4 契约 — 写侧映射 vs 读侧锚点（缺陷 B）', () => {
  it('crm-standard 写侧 targetNodeType == 本体轴 `resource/client`（#1395 后；读侧字典 Client → resource/client）', () => {
    expect(loadMapping('crm-standard').targetNodeType).toBe('resource/client');
  });

  it('hr-standard 写侧 targetNodeType == 本体轴 `resource/person`（#1395 后）', () => {
    expect(loadMapping('hr-standard').targetNodeType).toBe('resource/person');
  });

  it('erp-standard 写侧 targetNodeType == 本体轴 `outcome/financial`（#1395 后）', () => {
    expect(loadMapping('erp-standard').targetNodeType).toBe('outcome/financial');
  });

  it('erp-standard 写侧 prop 对齐 financial schema cash/operating_expense（断裂名清零）', () => {
    const props = loadMapping('erp-standard').mappings.map((m) => m.prop);
    expect(props).toContain('cash');
    expect(props).toContain('operating_expense');
    expect(props).not.toContain('cashBalance');
    expect(props).not.toContain('operatingExpenses');
  });
});

describe('D355 L4 契约 — 上传→查询 roundtrip（缺陷 B 场景 2）', () => {
  it('按 crm 映射写 `resource/client` ⇒ 本体轴直查命中 + **经收口点用遗留名 `Client` 也命中**（#1393 并集读）', () => {
    const db = createDb();
    const store = new SqliteGraphStore(db);
    const mapping = loadMapping('crm-standard');
    const props: Record<string, unknown> = {};
    for (const m of mapping.mappings) props[m.prop] = m.type === 'number' ? 1 : '2026Q1';

    const id = store.createNode(mapping.targetNodeType, props, 'enterprise');
    // 写侧：本体轴直查
    const axisNodes = store.queryNodes('resource/client', {}, 'enterprise');
    expect(axisNodes, '写侧应落在本体轴 `resource/client`').toHaveLength(1);
    // 读侧：经**收口点**（#1393 并集读）用遗留名 `Client` 也能读到 ⇒ 读写两侧锚点连通
    const nodes = withOrgScope(store, undefined).queryNodes('Client', {}, 'enterprise') as Array<{ id: string; props: Record<string, unknown> }>;
    expect(nodes, '经收口点读遗留名 `Client` 应命中本体轴节点').toHaveLength(1);
    expect(nodes[0].id).toBe(id);
    expect(nodes[0].props.churn_rate).toBe(1);
  });

  it('按 erp 映射写 `outcome/financial` ⇒ 本体轴直查命中 + 经收口点用 `Financial` 也命中', () => {
    const db = createDb();
    const store = new SqliteGraphStore(db);
    const mapping = loadMapping('erp-standard');
    const props: Record<string, unknown> = {};
    for (const m of mapping.mappings) props[m.prop] = m.type === 'number' ? 2 : '2026Q1';

    store.createNode(mapping.targetNodeType, props, 'enterprise');
    expect(store.queryNodes('outcome/financial', {}, 'enterprise'), '写侧应落在本体轴').toHaveLength(1);
    const nodes = withOrgScope(store, undefined).queryNodes('Financial', {}, 'enterprise') as Array<{ props: Record<string, unknown> }>;
    expect(nodes, '经收口点读遗留名 `Financial` 应命中').toHaveLength(1);
    expect(nodes[0].props.cash).toBe(2);
    expect(nodes[0].props.operating_expense).toBe(2);
  });
});

describe('D355 L4 契约 — 旧库 props_json 构造自动迁移（缺陷 A 场景 1）', () => {
  it('旧库数据经构造迁移后查询可见（不再静默空）', () => {
    const db = createDb();
    createLegacyGraphNodes(db);
    db.prepare("INSERT INTO graph_nodes (id, graph, type, props_json) VALUES ('legacy-1', 'default', 'Client', ?)").run('{"churn_rate":0.12}');

    const store = new SqliteGraphStore(db); // 构造即迁移
    const nodes = store.queryNodes('Client');

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('legacy-1');
    expect(nodes[0].props.churn_rate).toBe(0.12);
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('D355 L4 契约 — 查询 fail-open 升级（P0-3 修复）', () => {
  it('schema 漂移（props 列缺失）→ log.error 显式失效，非静默 warn', () => {
    const db = createDb();
    const store = new SqliteGraphStore(db); // 正常 schema 构造
    // 构造后发生 schema 漂移: 删表重建为无 props 列（且无 props_json 可回填）
    db.exec('DROP TABLE graph_nodes');
    db.exec(`
      CREATE TABLE graph_nodes (
        id TEXT PRIMARY KEY,
        graph TEXT NOT NULL DEFAULT 'default',
        type TEXT NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        valid_from TEXT NOT NULL DEFAULT (datetime('now')),
        valid_to TEXT
      )
    `);

    const nodes = store.queryNodes('Client');

    expect(nodes).toEqual([]);
    expect(log.error).toHaveBeenCalled();
    const errorMessages = (log.error.mock.calls as unknown[][]).map((c) => String(c[1]));
    expect(errorMessages.some((m) => m.includes('schema 漂移'))).toBe(true);
    // 静默 fail-open 的 warn 路径必须不再出现（构造器 WAL 降级 warn 与查询无关）
    const warnMessages = (log.warn.mock.calls as unknown[][]).map((c) => String(c[1]));
    expect(warnMessages.some((m) => m.includes('查询图节点失败'))).toBe(false);
  });

  it('查询失败（非 schema 漂移）同样升级 log.error', () => {
    const db = createDb();
    const store = new SqliteGraphStore(db);
    db.exec('DROP TABLE graph_nodes'); // 整表缺失 → 任意查询失败
    // 不重建: SELECT 报 no such table → no such table 分支
    const nodes = store.queryNodes('Client');
    expect(nodes).toEqual([]);
    expect(log.error).toHaveBeenCalled();
    const errorMessages = (log.error.mock.calls as unknown[][]).map((c) => String(c[1]));
    expect(errorMessages.some((m) => m.includes('查询图节点失败'))).toBe(true);
  });
});

/**
 * D803 读侧消费契约 — 四资本哨兵读名 ⊆ 写侧能力集（10-2 / 10-4 回归守卫）
 *
 * 缺陷背景（K3 20260813 三重缺陷定罪 §2.2 断裂②）: 写侧锚本体 schema snake_case
 * （D355 方向），读侧曾用 camelCase（cashBalance/operatingExpenses）→ 消费方读不到
 * 上传数据。D355 修了写侧锚，但**读侧消费名没有回归守卫**——下一次改动可无声复发。
 *
 * 本 describe 双轨守卫:
 *   A. 静态闭包 — 四资本哨兵源码里的 `props.X` 读名必须 ⊆ 写侧能力集
 *      （erp-standard mapping props ∪ ingest 生成属性 ∪ 冻结的遗留别名/边属性登记表）。
 *      新读名若两侧都没有 → 红（要求登记或改名），防止"读一个永远写不出来的字段"。
 *   B. 运行时行为 — 真实上传形态（financialType='erp-standard'，非 'revenue'）必须被
 *      消费方吃到，不得因硬编码值域判空（revenue-health/aggregate.ts 回退分支断裂）。
 *
 * 双轨都是**针对性断言**（S-5：red 覆盖失败模式，非仅 happy path）——修复前必红。
 */
function stripComments(src: string): string {
  // 去块注释 + 行注释，避免注释里的 props.X 造成误报
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 递归收集目录下全部 .ts/.tsx 源码 */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 抽源码里全部「读名」——`props.X` 字面读 + `*_PROP_CHAIN` 字段链字面量（保守过近似，不产生假阴性） */
function readPropNames(files: string[]): string[] {
  const names = new Set<string>();
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf-8'));
    for (const m of src.matchAll(/\bprops\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
    // D803 切片③: 字段链常量（`const X_PROP_CHAIN = ['a','b'] as const`）经动态键 `props[k]` 读取，
    // `props.X` 正则抽不到 → 必须显式解析链字面量。否则「往现金链里塞 total_revenue」这类
    // 断裂对本守卫失明（正是本卡要防的 K3 断裂②）。
    for (const m of src.matchAll(/[A-Z_]*PROP_CHAIN\s*=\s*\[([^\]]*)\]/g)) {
      for (const s of m[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
        names.add(s[1] || s[2]);
      }
    }
  }
  return [...names].sort();
}

/**
 * 冻结的遗留读名登记表（D803 S2 表逐行登记；**本卡不清**——清理属独立任务）。
 *
 * 两类来源，逐条注明性质:
 *  - 节点遗留别名: 图遍历分支的历史命名（非 erp-standard 写侧产物），保留为回退链；
 *  - 边属性: CONSTRAINS / REPLENISHES 等边上的 props，不属 Financial 节点 schema。
 *
 * 任何**新增**的未登记读名都会让本 describe 变红 —— 这是设计意图（要求显式登记或改名）。
 * 任何**清理**导致这里的条目不再被读到，同样变红 —— 要求同步收紧登记表（防止表变成橡皮图章）。
 */
const FROZEN_UNREGISTERED_READS: Record<string, string> = {
  // — cash-runway: 节点遗留别名 —
  cash_balance: 'compute-cash-runway-months.ts:50 / compute-receivable-overdue-rate.ts:36 遍历分支遗留别名',
  monthly_burn: 'compute-cash-runway-months.ts:51 遍历分支遗留别名',
  total_cost: 'compute-cash-runway-months.ts:51 遍历分支遗留别名',
  amount: 'compute-cash-runway-months.ts:63 / revenue-health:43 遗留别名（S2 行2 显式登记不清）',
  accounts_receivable: 'compute-receivable-overdue-rate.ts:37 遍历分支遗留别名（本卡切片③补 || receivables 对齐）',
  // — cash-runway: 边属性（非 Financial 节点 schema） —
  magnitude: 'compute-constraint-impact.ts:32 CONSTRAINS 边属性',
  constraint_type: 'compute-constraint-impact.ts:34 CONSTRAINS 边属性',
  reinvestment_rate: 'compute-replenish-rate.ts:32 REPLENISHES 边属性',
  // — margin-health —
  divergence_from_cash: 'margin-health 专属指标字段（非线10 V1 断言域）',
  fixed_cost: 'margin-health 固定成本字段（非线10 V1 断言域）',
  metric_behavior_gap: 'margin-health 指标行为差字段（非线10 V1 断言域）',
  metric_type: 'margin-health 指标类型判别字段（非线10 V1 断言域）',
  // — capital-health —
  accounts_payable: 'capital-health 应付账款（非 erp-standard mapping 字段）',
  interest_expense: 'capital-health 利息支出（非 erp-standard mapping 字段）',
  long_term_debt: 'capital-health 长期负债（erp-standard 只有 total_debt）',
  short_term_debt: 'capital-health 短期负债（erp-standard 只有 total_debt）',
  tax_rate: 'capital-health 税率（非 erp-standard mapping 字段）',
  wacc: 'capital-health 加权平均资本成本（派生指标，非原始写侧字段）',
};

const CAPITAL_SENTINEL_DIRS = ['cash-runway', 'revenue-health', 'margin-health', 'capital-health'];

describe('D803 读侧消费契约 — 四资本哨兵读名 ⊆ 写侧能力集（10-2）', () => {
  it('静态闭包: 源码 props.X 读名 ⊆ mapping props ∪ ingest 生成 ∪ 冻结登记表', () => {
    const writeSideProps = loadMapping('erp-standard').mappings.map((m) => m.prop);
    // ingest 生成属性（data-ingest-service.ts:164 financialType / :191 pii_scrubbed / :208 standardKey / mapping period）
    const ingestGenerated = ['financialType', 'standardKey', 'pii_scrubbed'];
    const producible = new Set([...writeSideProps, ...ingestGenerated]);

    const files = CAPITAL_SENTINEL_DIRS.flatMap((d) =>
      collectSources(join(process.cwd(), 'extensions', 'sentinels', d)));
    expect(files.length).toBeGreaterThan(0); // 正控: 真的读到了源码

    const reads = readPropNames(files);
    expect(reads.length).toBeGreaterThan(0); // 正控: 真的抽到了读名

    const unregistered = reads.filter((r) => !producible.has(r));
    // 双向精确契约: 未登记集合必须**恰好**等于冻结表（多一个 = 新断裂；少一个 = 表已过期）
    expect(unregistered).toEqual(Object.keys(FROZEN_UNREGISTERED_READS).sort());
  });

  it('静态闭包: 写侧 mapping 的每个 prop 都在本体 schema 里（写侧锚点不漂）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'extensions', 'ontology', 'outcome', 'financial.json'), 'utf-8'),
    ) as { requiredProps?: string[] | Record<string, unknown>; optionalProps?: Record<string, unknown> };
    // requiredProps 是数组形态（["period"]），optionalProps 是对象形态（{cash:'number'}）——两种都要吃
    const required = Array.isArray(schema.requiredProps)
      ? schema.requiredProps
      : Object.keys(schema.requiredProps || {});
    const schemaProps = new Set([...required, ...Object.keys(schema.optionalProps || {})]);
    const mappingProps = loadMapping('erp-standard').mappings.map((m) => m.prop);
    const missing = mappingProps.filter((p) => !schemaProps.has(p));
    expect(missing).toEqual([]);
  });

  it('运行时: 上传形态 financialType=erp-standard + total_revenue 必须被 revenue-health 吃到（非判空）', async () => {
    const queried: string[] = [];
    // 显式标注 GraphStoreReader（铁律 38: 不用 as unknown as 绕过类型检查）
    const store: GraphStoreReader = {
      queryNodes: (type: string) => {
        queried.push(type);
        if (type === 'Financial') {
          return [{ id: 'fin-erp-1', type: 'Financial', props: { financialType: 'erp-standard', total_revenue: 1200000, period: '2026-Q2' } }];
        }
        return [];
      },
      queryEdges: () => [],
      getNode: () => null,
    };

    const findings = await revenueHealthSentinel.check(store, 'team1');

    // 正控: 回退分支真的跑了两次 queryNodes（Financial + Client），不是提前 return
    expect(queried).toContain('Financial');
    expect(queried).toContain('Client');
    // 断裂检测: 硬编码 financialType === 'revenue' 会让所有上传数据判空 → 日志出现「无收入数据」
    expect(log.info).not.toHaveBeenCalledWith(expect.anything(), '无收入数据');
    expect(Array.isArray(findings)).toBe(true);
  });

  it('运行时: compute-cash-runway-months 现金链不得挪用 total_revenue（守 10-4 / K3 断裂②指纹）', async () => {
    // 撕裂点: 现金链曾是 `cash_balance || total_revenue`——把收入当现金，
    // 32 天现金 / 12 万月耗（真 runway 0.25 → critical）会被 120 万收入伪装成 10 个月（warning）。
    // 修复后: 现金链全缺 → 诚实降级，绝不产出被收入污染的跑道数字。
    const store: GraphStoreReader = {
      queryNodes: () => [{
        id: 'fin-erp-1',
        type: 'Financial',
        props: { financialType: 'erp-standard', total_revenue: 1200000, operating_expense: 120000, period: '2026-Q2' },
      }],
      queryEdges: () => [],
      getNode: () => null,
    };

    const runway = await computeCashRunwayMonths(store, { teamId: 'team1' });

    expect(runway.degraded).toBe(true);
    expect(runway.warnings.some((w) => w.includes('现金字段缺失'))).toBe(true);
    // 反证: 若 total_revenue 被当现金 → 1200000/120000 = 10（非降级，值 10）
    expect(runway.value).not.toBe(10);
  });
});
