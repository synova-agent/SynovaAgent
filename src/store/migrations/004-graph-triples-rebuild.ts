/**
 * src/store/migrations/004-graph-triples-rebuild.ts — #1455 (B2, P1): 图边表整表重建到 canonical
 *
 * 背景（#1455；出处 #1432 首跑烟测断点 B2 — 一轮哨兵跑 `no such column: props` × 50）
 *
 *   读面症状：`src/adapters/sqlite-graph-store.ts:245`
 *     `SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples …`
 *     对旧库抛 `no such column: props`，被 `:255-259` 的 catch 吞成 `[]`
 *     ⇒ 哨兵把"查询失败"当"无边" ⇒ 下游 compute 连环降级。
 *
 *   写面症状（本次实测，**比读面更硬**）：同文件 `:171-180` 的 `createEdge` 写
 *     `id = 'edge-<uuid>'`（TEXT）进旧库的 `id INTEGER PRIMARY KEY AUTOINCREMENT` 列
 *     ⇒ SQLite `datatype mismatch`（INTEGER PRIMARY KEY 是 rowid 别名，不接受非整数）。
 *
 *   🔴 因此 **`ALTER TABLE … ADD COLUMN props` 只能修好一半**：
 *        - 补列后读面转绿（`no such column` 消失）；
 *        - 但写面错误只是**换了张脸**：`no such column: props` → `datatype mismatch`
 *          ⇒ 表面上"props 列已修好"，实为**半修掩盖**。
 *      根因是**表形状漂移**（PK 类型 + 缺列），而 SQLite 无法 `ALTER` 列类型/主键
 *      ⇒ 唯一充分修法 = **整表重建到 canonical**。
 *
 *   canonical 定义来源：`src/adapters/sqlite-graph-store.ts` `SCHEMA_SQL:38-51`（+ 5 索引 `:52-56`），
 *   即"新库有 props、旧库只有 props_json"两侧差异的**权威侧**。本迁移**只把旧库对齐到代码已声明的形状**，
 *   不改 schema 定义、不改查询（卡面 §③ 约束）。
 *
 * 契约（铁律 47）:
 *   @input    — better-sqlite3 Database 实例（可能含漂移版 graph_triples）
 *   @output   — void；成功后 `graph_triples` 与 canonical **逐列同形**（`id TEXT PRIMARY KEY` + `props`）
 *               + 5 索引；旧行按列映射搬运（行数不丢，`props_json → props`，`id` CAST 为 TEXT 保身份稳定）
 *   @degraded — 表不存在（全新库，`initSchema` 会建 canonical 表）→ no-op；
 *               已是 canonical（`id` 为 TEXT 且含 `props`）→ no-op（**幂等**，重复执行安全）
 *   @error    — `graph_triples` 存在但不是 TABLE（视图等）→ 抛错；重建任一步失败 → **事务回滚**
 *               （fail-closed：迁移失败必须阻止启动，不留半成品表）
 *   @dropped  — 旧库多出的**非 canonical 列**（实测：`confidence` / `source` / `props_json`）在重建中
 *               **按 canonical 定义被移除**（`props_json` 的值已搬进 `props`）⇒ 属 schema 面取舍，
 *               **须 CTO 逐字批**（见交付件 DDL 待批清单）
 *
 * 铁律 39（L5 存储层，仅依赖 better-sqlite3 类型）/ 38（零不安全断言）/ 24（降级可解释）
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../schema-migration';

/**
 * canonical `graph_triples` DDL。
 * 🔴 与 `src/adapters/sqlite-graph-store.ts` `SCHEMA_SQL:38-51` **同形**（该文件被在飞分支
 *    `fix/1421-skills-type-assumption` 占用，不可导出/不可改 ⇒ 此处复制，并由
 *    `tests/store/migrations/004-*.test.ts` 的静态同形守卫钉死防漂移）。
 */
const CANONICAL_TRIPLES_DDL = `
CREATE TABLE graph_triples (
  id TEXT PRIMARY KEY,
  graph TEXT NOT NULL DEFAULT 'default',
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  props TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT
)`;

/** canonical 索引（名与定义逐字对齐 `SCHEMA_SQL:52-56`） */
const CANONICAL_TRIPLES_INDEXES = [
  `CREATE INDEX idx_gt_subject ON graph_triples(graph, subject_type, subject_id)`,
  `CREATE INDEX idx_gt_object ON graph_triples(graph, object_type, object_id)`,
  `CREATE INDEX idx_gt_predicate ON graph_triples(graph, predicate)`,
  `CREATE INDEX idx_gt_weight ON graph_triples(graph, predicate, weight)`,
  `CREATE INDEX idx_gt_valid ON graph_triples(graph, valid_from, valid_to)`,
];

/**
 * canonical 列名（顺序即 DDL 顺序）。
 * **落地承重**：重建 INSERT 的列清单由它生成（不是仅供测试的装饰常量）。
 */
const CANONICAL_TRIPLES_COLUMNS = [
  'id', 'graph', 'subject_type', 'subject_id', 'predicate', 'object_type',
  'object_id', 'weight', 'props', 'created_at', 'valid_from', 'valid_to',
] as const;

/** 重建期中间表名（带后缀，绝不与既有表撞名） */
const REBUILD_SCRATCH_TABLE = 'graph_triples_1455_legacy';

export const graphTriplesRebuildMigration: Migration = {
  version: 5,
  name: 'graph-triples-rebuild',
  up: (db: Database.Database): void => {
    // ① 存在性 + 对象类型守卫（视图/索引同名 → fail-closed）
    const obj = db
      .prepare('SELECT type FROM sqlite_master WHERE name = ?')
      .get('graph_triples') as { type?: string } | undefined;
    if (!obj) return; // 全新库: SCHEMA_SQL 会创建 canonical 表
    if (obj.type !== 'table') {
      throw new Error(`graph_triples 存在但不是 TABLE（type=${obj.type}）—— 迁移无法安全重建`);
    }

    // ② 幂等 + 漂移判定：canonical ⇔ `id` 为 TEXT 且含 `props`
    const cols = db.pragma('table_info(graph_triples)') as Array<{ name: string; type: string }>;
    const typeOf = (n: string): string => (cols.find((c) => c.name === n)?.type ?? '').toUpperCase();
    const has = (n: string): boolean => cols.some((c) => c.name === n);
    const isCanonical = has('id') && has('props') && typeOf('id') === 'TEXT';
    if (isCanonical) return; // 幂等: 重复执行安全（含"上一版只补列"的中间态由 ③ 兜住）

    // ③ 逐列构造搬运表达式 —— 对旧表**缺列**鲁棒（缺列则用 canonical 默认值）
    const plain = (n: string, fallback: string): string => (has(n) ? n : fallback);
    const textOf = (n: string): string => `COALESCE(CAST(${n} AS TEXT), '')`;
    /**
     * 属性源：canonical 命名 `props` 优先；漂移库 `props_json` 回退；都没有则默认 `{}`。
     * `NULLIF(…, '')` 与 001 同语义：**空串视同未设置** ⇒ 落 canonical 默认 `'{}'`
     * （canonical 列是 `props TEXT NOT NULL DEFAULT '{}'`，存空串违反其默认语义）。
     */
    const propsExpr = has('props')
      ? `COALESCE(NULLIF(props, ''), '{}')`
      : has('props_json')
        ? `COALESCE(NULLIF(props_json, ''), '{}')`
        : `'{}'`;
    /** `valid_from` 缺失时退回 `created_at`，再退 `now()`，保持时间线语义 */
    const validFromExpr = has('valid_from')
      ? `COALESCE(valid_from, ${plain('created_at', `datetime('now')`)}, datetime('now'))`
      : `COALESCE(${plain('created_at', `datetime('now')`)}, datetime('now'))`;

    const selectList = [
      has('id') ? `CAST(id AS TEXT)` : `'edge-' || lower(hex(randomblob(16)))`,
      `COALESCE(${plain('graph', `'default'`)}, 'default')`,
      has('subject_type') ? textOf('subject_type') : `''`,
      has('subject_id') ? textOf('subject_id') : `''`,
      has('predicate') ? textOf('predicate') : `''`,
      has('object_type') ? textOf('object_type') : `''`,
      has('object_id') ? textOf('object_id') : `''`,
      `COALESCE(${plain('weight', '1.0')}, 1.0)`,
      propsExpr,
      `COALESCE(${plain('created_at', `datetime('now')`)}, datetime('now'))`,
      validFromExpr,
      plain('valid_to', 'NULL'),
    ].join(', ');

    // ④ 事务内重建（SQLite DDL 可事务 ⇒ 任一步失败整体回滚，不留半成品）
    const rebuild = db.transaction((): void => {
      db.exec(`DROP TABLE IF EXISTS ${REBUILD_SCRATCH_TABLE}`);
      db.exec(`ALTER TABLE graph_triples RENAME TO ${REBUILD_SCRATCH_TABLE}`);
      db.exec(CANONICAL_TRIPLES_DDL);
      db.exec(
        `INSERT INTO graph_triples
           (${CANONICAL_TRIPLES_COLUMNS.join(', ')})
         SELECT ${selectList} FROM ${REBUILD_SCRATCH_TABLE}`,
      );
      // 先删旧表释放 `idx_gt_*` 索引名（索引随表 drop 而消失），再建 canonical 索引。
      // 顺序反了会因**同名冲突**让 `CREATE INDEX` 失败。
      db.exec(`DROP TABLE ${REBUILD_SCRATCH_TABLE}`);
      for (const indexDdl of CANONICAL_TRIPLES_INDEXES) db.exec(indexDdl);
    });

    rebuild();
  },
};
