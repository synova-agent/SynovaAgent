/**
 * tests/l4/activity-instance-1057.test.ts — #1057「作业单元缺两件（实例 + 评估属性）」判据载体
 *
 * 卡：GitHub issue #1057（本地镜像 .k4-cards/card-1057.md）｜基线 origin/main = 5a6591c4a
 *
 * 契约（铁律 47）:
 *   @input  — ① extensions/ontology/activity/*.json（8 个既有类目，扩 optionalProps）
 *             ② extensions/ontology/activity/instances/*.json（第一个作业实例）
 *             ③ 旧形态 SQLite 库（graph_nodes 用 props_json 列、无 props 列、无 schema_version 表）
 *   @output — 与卡面 §⑥ 三条判据一一对应:
 *             判据① 真实写入路径把实例写入 graph_nodes ⇒ `type LIKE 'activity/%'` 计数 ≥ 1
 *             判据② 10 个评估属性在 8 个类目 optionalProps 全覆盖，且实例写回后 10 个属性原样读得到
 *             判据③ 判别性夹具（改坏即红）: 属性缺失 ⇒ 覆盖断言必红；旧库未迁移 ⇒ 同一 INSERT 必抛
 *                    `no such column: props`（证明判据走的是真实写入路径，不是静态 grep）
 *   @degraded — 无。本文件是判据载体，失败即红。仅「真机快照口径」段落无 SYNOVA_1057_REAL_DB 时跳过。
 *
 * 真机口径 A（判据① 卡面字面路径 data/synova.db，**在位**；队长 2026-10-09 裁定授权）:
 *   SYNOVA_1057_INPLACE_DB="D:\\novis-backup-20260526\\Novis\\synova-agent\\data\\synova.db" \
 *     npx vitest run tests/l4/activity-instance-1057.test.ts
 *   ⇒ 开库即打印 before（PRAGMA / schema_version / 计数）→ 走生产路径 `new SqliteGraphStore(db)`（构造自带
 *     reconcileSchema，一次性迁移是应用自身行为，非手工 hack）→ createNode → 打印 after。
 *     ⚠️ 该模式**会写库**（ADD COLUMN props + 回填 + 建 3 表 + 3 行版本）；真机库已 gitignore（data/），
 *     且执行前必须先落一致性快照作回滚件（见下）。
 *   ⚠️ 本机**没有 sqlite3 CLI**（`command -v sqlite3` NOT_FOUND）⇒ 卡面 §⑥ 的 sqlite3 命令**语义不变、工具替换**
 *      为 python3 内置 sqlite3（只读 mode=ro 做查询）。交付件已明写该替换。
 *
 * 真机口径 B（一致性快照，原件零写入对照）:
 *   SYNOVA_1057_REAL_DB=<真机库路径> [SYNOVA_1057_KEEP_SNAPSHOT=1] npx vitest run ...
 *   ⇒ 只读打开原件 → VACUUM INTO 快照到 <worktree>/data/1057-snapshot/（data/ 已 gitignore，不进 git）。
 *
 * 新库对照（hermetic，恒跑）: `:memory:` 新库 → initSchema 建表即含 props（迁移 001 no-op）。
 * 三轮读数分别贴，不合并成一句「通过」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadOntology } from '../../src/l4/ontology-loader';

// 卡面 §① 的 10 个评估属性（名单以卡面为准；类型口径见 read-card-confirm §6-2 —— 9 number + 1 string）
const EVAL_PROPS: Record<string, 'number' | 'string'> = {
  headcount: 'number',
  hours_per_run: 'number',
  runs_per_period: 'number',
  unit_labor_cost: 'number',
  error_rate: 'number',
  structuredness: 'number',
  error_tolerance: 'number',
  data_reachability: 'number',
  agent_readiness_score: 'number',
  agent_type_recommendation: 'string',
};
const EVAL_NAMES = Object.keys(EVAL_PROPS);

const REPO_ROOT = process.cwd();
const ACTIVITY_DIR = join(REPO_ROOT, 'extensions', 'ontology', 'activity');
const INSTANCE_DIR = join(ACTIVITY_DIR, 'instances');
const INSTANCE_FILE = join(INSTANCE_DIR, 'activity-production-wani-baby-001.json');

/** 既有 8 个 activity 类目（卡面 §② 实测 8 个） */
const ACTIVITY_CATEGORIES = [
  'acquisition', 'compliance', 'coordination', 'governance',
  'innovation', 'learning', 'maintenance', 'production',
];

interface ActivitySchema {
  $id: string;
  label: string;
  tags: string[];
  requiredProps: string[];
  optionalProps: Record<string, string>;
  description: string;
}

interface ActivityInstanceFile {
  $schema: string;
  instanceVersion: string;
  type: string;
  graph: string;
  name: string;
  sourceRef: string;
  props: Record<string, unknown>;
  _provenance: Record<string, string>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadInstance(path: string = INSTANCE_FILE): ActivityInstanceFile {
  if (!existsSync(path)) throw new Error(`[1057] 实例文件不存在: ${path}`);
  return readJson<ActivityInstanceFile>(path);
}

const readActivitySchema = (category: string): ActivitySchema =>
  readJson<ActivitySchema>(join(ACTIVITY_DIR, `${category}.json`));

/** 缺失/空的评估属性（判据② 唯一判据函数 —— 夹具与真断言共用同一实现，防「夹具与断言两条码」） */
function missingEvalProps(props: Record<string, unknown>): string[] {
  return EVAL_NAMES.filter((name) => {
    const v = props[name];
    return v === undefined || v === null || v === '';
  });
}

/** 旧形态库 DDL —— 逐列对齐真机 data/synova.db 的 PRAGMA table_info 读数（graph_nodes 无 props 列） */
const LEGACY_DDL = `
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  graph TEXT NOT NULL DEFAULT 'default',
  name TEXT DEFAULT '',
  confidence REAL DEFAULT 1.0,
  props_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT
);
CREATE TABLE graph_triples (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  graph TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  props_json TEXT DEFAULT '{}',
  confidence REAL DEFAULT 1.0,
  source TEXT,
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

interface SqliteHandle {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  pragma(sql: string): unknown;
  close(): void;
}

/** better-sqlite3 是 CJS 包：沿用仓库既有 l4 测试的 require 取用方式（同 tests/l4/synova-graph-store.test.ts） */
const BetterSqlite3 = require('better-sqlite3');

function openLegacyDb(dbPath: string): SqliteHandle {
  const db = new BetterSqlite3(dbPath) as SqliteHandle;
  db.exec(LEGACY_DDL);
  return db;
}

const columnsOf = (db: SqliteHandle, table: string): string[] =>
  (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

const tableNames = (db: SqliteHandle): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
    .map((r) => r.name);

const activityCount = (db: SqliteHandle): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE type LIKE 'activity/%'").get() as { c: number }).c;

describe('#1057 作业单元：8 类目评估属性覆盖（判据② 面 1：schema）', () => {
  it('前置：仓库根定位正确（否则 loader 的 process.cwd() 口径不成立）', () => {
    expect(existsSync(ACTIVITY_DIR)).toBe(true);
    expect(readdirSync(ACTIVITY_DIR).filter((f) => f.endsWith('.json')).length).toBe(8);
  });

  it('8 个 activity 类目各自可选属性含全部 10 个评估属性，且类型口径一致', () => {
    const report: string[] = [];
    for (const category of ACTIVITY_CATEGORIES) {
      const schema = readActivitySchema(category);
      expect(schema.$id).toBe(`activity/${category}`);
      const optional = schema.optionalProps;
      const missing = EVAL_NAMES.filter((n) => !(n in optional));
      expect(missing, `${category}.json 缺评估属性: ${missing.join(',')}`).toEqual([]);
      for (const [name, type] of Object.entries(EVAL_PROPS)) {
        expect(optional[name], `${category}.json 的 ${name} 类型口径`).toBe(type);
      }
      report.push(`${category}: optionalProps=${Object.keys(optional).length} 含 10/10`);
    }
    console.log('[1057][判据② schema 面]', JSON.stringify(report));
  });

  it('类型面未新增节点类型：activity/* $id 恰为 8 个（宪章 P4）', () => {
    const ids = readdirSync(ACTIVITY_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readActivitySchema(f.replace(/\.json$/, '')).$id);
    expect(ids.filter((id) => id.startsWith('activity/')).length).toBe(8);
    expect(ids).toEqual(ACTIVITY_CATEGORIES.map((c) => `activity/${c}`));
  });

  it('生产链真实加载：loadOntology() 里 activity/* 类型数 = 8 且带 10 属性（接线 ≠ 被执行，这里真调）', () => {
    const { ontology, degraded } = loadOntology();
    const activityTypes = ontology.nodeTypes.filter((n) => n.$id.startsWith('activity/'));
    expect(degraded).toBe(false);
    expect(activityTypes.length).toBe(8);
    for (const t of activityTypes) {
      expect(missingEvalProps(t.optionalProps)).toEqual([]);
    }
    console.log('[1057][loader 实测] activityTypes =', activityTypes.map((t) => t.$id).join(','));
  });

  it('实例文件不会被 loader 当成第 9 个节点类型（平铺扫描不递归 ⇒ instances/ 隔离生效）', () => {
    const { ontology } = loadOntology();
    const ids = ontology.nodeTypes.map((n) => n.$id);
    expect(ids).not.toContain('activity-production-wani-baby-001');
    expect(ids.filter((id) => id.startsWith('activity/')).length).toBe(8);
    expect(existsSync(INSTANCE_FILE)).toBe(true);
  });
});

describe('#1057 第一个作业实例（判据② 面 2：实例属性）', () => {
  it('实例引用既有 $id（不新建类型）、10 个评估属性非空、含逐字段来源标注', () => {
    const inst = loadInstance();
    expect(inst.type).toBe('activity/production');
    expect(ACTIVITY_CATEGORIES).toContain(inst.type.split('/')[1]);
    expect(missingEvalProps(inst.props)).toEqual([]);
    for (const name of EVAL_NAMES) {
      expect(inst._provenance[name], `${name} 缺来源标注`).toBeTruthy();
      expect(typeof inst.props[name]).toBe(EVAL_PROPS[name]);
    }
    console.log('[1057][实例属性]', JSON.stringify({
      type: inst.type,
      graph: inst.graph,
      name: inst.name,
      evalProps: EVAL_NAMES.map((n) => `${n}=${String(inst.props[n])}`),
    }));
  });

  it('判别性夹具（改坏即红）：抹掉任一评估属性 ⇒ 同一判据函数必报缺失', () => {
    const inst = loadInstance();
    for (const drop of ['agent_readiness_score', 'headcount']) {
      const damaged: Record<string, unknown> = { ...inst.props };
      delete damaged[drop];
      expect(missingEvalProps(damaged), `删 ${drop} 后必须报缺失`).toEqual([drop]);
      const emptied: Record<string, unknown> = { ...inst.props, [drop]: '' };
      expect(missingEvalProps(emptied), `${drop} 置空后必须报缺失`).toEqual([drop]);
    }
  });

  it('判别性夹具（改坏即红）：实例文件缺失 ⇒ 加载必抛', () => {
    expect(() => loadInstance(join(INSTANCE_DIR, '__deleted-by-fixture__.json'))).toThrow(/实例文件不存在/);
  });
});

describe('#1057 判据① 真实写入路径（hermetic：旧形态库 → 迁移 → 写入 → 查询）', () => {
  it('判别性反证：旧形态库无 props 列 ⇒ 卡面同款 INSERT 必抛 no such column: props', () => {
    const tmp = join(tmpdir(), `synova-1057-legacy-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    const db = openLegacyDb(join(tmp, 'legacy.db'));
    try {
      const cols = columnsOf(db, 'graph_nodes');
      expect(cols).toContain('props_json');
      expect(cols).not.toContain('props');
      expect(tableNames(db)).not.toContain('schema_version');
      // 未迁移 ⇒ 真实写入路径的两种报错面都必须出现（证明"能否写进去"由迁移决定，与属性内容无关）
      //   ① 写侧: better-sqlite3 INSERT 报文 = `table graph_nodes has no column named props`
      //   ② 读侧: SELECT props 报文 = `no such column: props`（#1455 同类根因的原始文案）
      expect(() => db.prepare(
        'INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, ?, ?, ?, ?)',
      ).run('probe', 'wani-baby', 'activity/production', 'probe', '{}'))
        .toThrow(/has no column named props|no such column: props/);
      expect(() => db.prepare('SELECT id, type, props FROM graph_nodes WHERE type = ?').all('activity/production'))
        .toThrow(/no such column: props/);
      expect(activityCount(db)).toBe(0);
      console.log('[1057][判别性反证] 旧形态库列 =', cols.join(','),
        '| INSERT 与 SELECT props 双双报错 | 插入 activity/* 前计数 = 0');
    } finally {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('真实路径：SqliteGraphStore 构造即迁移（props_json→props）+ 写入实例 + 判据 SQL 计数 = 1 + 10 属性读回', () => {
    const tmp = join(tmpdir(), `synova-1057-real-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    const db = openLegacyDb(join(tmp, 'legacy.db'));
    try {
      const colsBefore = columnsOf(db, 'graph_nodes');
      const countBefore = activityCount(db);

      const store = new SqliteGraphStore(db); // ← 构造即 initSchema + reconcileSchema（迁移 001）

      const colsAfter = columnsOf(db, 'graph_nodes');
      expect(colsAfter).toContain('props');
      expect(colsAfter).toContain('props_json'); // 迁移是加列 + 回填，不删旧列
      const migrations = (db.prepare(
        "SELECT version FROM schema_version WHERE typeof(version) = 'integer' ORDER BY version",
      ).all() as Array<{ version: number }>).map((r) => r.version);
      expect(migrations.length).toBeGreaterThan(0);

      const inst = loadInstance();
      const nodeId = store.createNode(inst.type, inst.props, inst.graph);
      expect(nodeId).toMatch(/^node-/);

      // 卡面 §⑥ 判据① 的 SQL（逐字）
      const countAfter = activityCount(db);
      expect(countAfter).toBe(1);

      const nodes = store.queryNodes(inst.type, undefined, inst.graph);
      expect(nodes.length).toBe(1);
      expect(missingEvalProps(nodes[0].props)).toEqual([]);
      for (const name of EVAL_NAMES) {
        expect(nodes[0].props[name], `${name} 未原样读回`).toEqual(inst.props[name]);
      }
      expect(nodes[0].props.name).toBe(inst.props.name);

      console.log('[1057][判据① 真实写入路径]', JSON.stringify({
        colsBefore,
        countBefore,
        colsAfter,
        migrations,
        nodeId,
        cardSql: "SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'",
        countAfter,
        readBackEvalProps: EVAL_NAMES.map((n) => `${n}=${String(nodes[0].props[n])}`),
      }));
    } finally {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ═══ 新库对照（hermetic，恒跑）：initSchema 建表直含 props ⇒ 迁移 001 空转 ═══
describe('#1057 判据① 新库对照（:memory: 全新库）', () => {
  it('全新库：initSchema 建表即含 props 列 ⇒ 同一写入路径计数 = 1（对照真机库需要 001 真加列）', () => {
    const db = new BetterSqlite3(':memory:') as SqliteHandle;
    try {
      const store = new SqliteGraphStore(db);
      const cols = columnsOf(db, 'graph_nodes');
      expect(cols).toContain('props');
      const migrations = (db.prepare(
        "SELECT version FROM schema_version WHERE typeof(version) = 'integer' ORDER BY version",
      ).all() as Array<{ version: number }>).map((r) => r.version);
      const inst = loadInstance();
      const nodeId = store.createNode(inst.type, inst.props, inst.graph);
      const count = activityCount(db);
      console.log('[1057][新库对照]', JSON.stringify({
        kind: ':memory: 全新库', cols, migrations, nodeId, countAfter: count,
        note: '迁移 001 在全新库上是 no-op（表由 initSchema 建，已含 props 列）',
      }));
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  });
});

// ═══ 真机口径 A：在位（队长 2026-10-09 裁定授权；生产路径自愈式迁移）═══
const INPLACE_DB = process.env.SYNOVA_1057_INPLACE_DB;
const inplaceIt = INPLACE_DB ? it : it.skip;

describe('#1057 判据① 真机在位（data/synova.db；before/after 原始读数）', () => {
  inplaceIt('真机在位：before → 生产路径构造（自愈迁移）→ createNode → after 判据 SQL', () => {
    const db = new BetterSqlite3(INPLACE_DB as string) as SqliteHandle;
    try {
      const before = {
        cols: columnsOf(db, 'graph_nodes'),
        hasSchemaVersionTable: tableNames(db).includes('schema_version'),
        schemaVersionRows: tableNames(db).includes('schema_version')
          ? (db.prepare("SELECT version FROM schema_version ORDER BY rowid").all() as Array<{ version: number }>).map((r) => r.version)
          : [],
        activityCount: activityCount(db),
        totalNodes: (db.prepare('SELECT COUNT(*) AS c FROM graph_nodes').get() as { c: number }).c,
      };
      console.log('[1057][真机在位·before]', JSON.stringify(before));

      // 生产路径：构造即 initSchema + reconcileSchema（一次性 schema 迁移 = 应用自身行为）
      const store = new SqliteGraphStore(db);

      const afterMigrate = {
        cols: columnsOf(db, 'graph_nodes'),
        schemaVersionRows: (db.prepare("SELECT version FROM schema_version ORDER BY rowid").all() as Array<{ version: number }>).map((r) => r.version),
      };
      console.log('[1057][真机在位·迁移后]', JSON.stringify(afterMigrate));

      const inst = loadInstance();
      const nodeId = store.createNode(inst.type, inst.props, inst.graph);

      const after = {
        cols: columnsOf(db, 'graph_nodes'),
        activityCount: activityCount(db),
        cardSql: "SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'",
        rows: (db.prepare("SELECT id, type, name, graph FROM graph_nodes WHERE type LIKE 'activity/%'").all() as
          Array<{ id: string; type: string; name: string; graph: string }>).map((r) => ({ id: r.id, type: r.type, name: r.name, graph: r.graph })),
      };
      console.log('[1057][真机在位·after]', JSON.stringify({ nodeId, ...after }));

      expect(afterMigrate.cols).toContain('props');
      expect(after.activityCount).toBe(before.activityCount + 1);
      expect(after.rows.some((r) => r.type === 'activity/production')).toBe(true);
      expect(missingEvalProps(inst.props)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

// ═══ 真机口径 B：一致性快照（原件只读零写入对照）═══
const REAL_DB = process.env.SYNOVA_1057_REAL_DB;
const realIt = REAL_DB ? it : it.skip;

describe('#1057 判据① 真机口径（一致性快照；原件只读零写入）', () => {
  realIt('真机 data/synova.db → VACUUM INTO 快照 → 迁移 → 真实写入 → 判据 SQL 计数 ≥ 1', async () => {
    const src = new BetterSqlite3(REAL_DB as string, { readonly: true, fileMustExist: true }) as SqliteHandle & {
      backup(dest: string): Promise<void>;
    };
    const snapDir = join(REPO_ROOT, 'data', '1057-snapshot');
    mkdirSync(snapDir, { recursive: true });
    const snap = join(snapDir, 'snapshot-1057.db');
    if (existsSync(snap)) rmSync(snap, { force: true });

    const beforeCols = columnsOf(src, 'graph_nodes');
    const beforeCount = activityCount(src);
    console.log('[1057][真机原件·只读]', JSON.stringify({
      path: REAL_DB,
      cols: beforeCols,
      activityCountBefore: beforeCount,
      hasSchemaVersionTable: tableNames(src).includes('schema_version'),
    }));

    try {
      src.exec(`VACUUM INTO '${snap.replace(/\\/g, '/')}'`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[1057][快照] VACUUM INTO 不可用 → 回退 backup() API:', msg);
      await src.backup(snap);
    }
    src.close();
    expect(existsSync(snap)).toBe(true);
    const sha = createHash('sha256').update(readFileSync(snap)).digest('hex');

    const db = new BetterSqlite3(snap) as SqliteHandle;
    try {
      const store = new SqliteGraphStore(db);
      const inst = loadInstance();
      const nodeId = store.createNode(inst.type, inst.props, inst.graph);
      const afterCount = activityCount(db);
      const rows = db.prepare(
        "SELECT id, type, name, graph, props FROM graph_nodes WHERE type LIKE 'activity/%'",
      ).all() as Array<{ id: string; type: string; name: string; graph: string; props: string }>;
      console.log('[1057][真机快照·写入后]', JSON.stringify({
        snapshotSha256: sha,
        nodeId,
        activityCountAfter: afterCount,
        rows: rows.map((r) => ({ id: r.id, type: r.type, name: r.name, graph: r.graph })),
        readBack: Object.keys(JSON.parse(rows[0].props)),
      }));
      expect(afterCount).toBe(1);
      expect(rows.length).toBe(1);
      expect(missingEvalProps(JSON.parse(rows[0].props) as Record<string, unknown>)).toEqual([]);
    } finally {
      db.close();
      if (process.env.SYNOVA_1057_KEEP_SNAPSHOT !== '1') rmSync(snap, { force: true });
    }
  });
});
