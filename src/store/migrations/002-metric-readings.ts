/**
 * src/store/migrations/002-metric-readings.ts — 承重件 W1：测量值时序表 `metric_readings`（#1053 / 2-1a）
 *
 * 依据（三处，逐条可核）:
 *   1. **设计正本**：`archive/25-指标时序存储-设计v0.md` §2.1 主表 `metric_readings`（14 列 + 3 索引）
 *      —— ✳️ **库外件**：`~/山河研究院/04-技术研究/专题研究/CTO委托-基座治理/archive/`
 *   2. **CTO 裁定 R4**：列集合 = archive/25 的 14 列 ＋ `run_id`/`input_digest`/`def_version` 三个**可空降级列**
 *      ⇒ 共 **17 列（含 id）**（不含 id 为 16 列；本文件与判据一律用 17 列口径）
 *   3. **硬顺序【权】**：「指标时序存储必须先于参数标定」（`产品宪章.md:229`）
 *
 * 🔴 判据源冲突与裁定留痕（CTO 2026-10-08 裁；**不可省** —— 防下一个人再撞同一矛盾）:
 *   · **`unit` / `source_id` / `evidence_ref` = 可空**（本文件按此实施）。
 *     出处：设计正本 `archive/25` **行 51 / 55 / 59**（`unit TEXT,` / `source_id TEXT,` / `evidence_ref TEXT,`）。
 *     矛盾源：登记件 `docs/synova/coordination/施工项登记.ts:848-855` 把三者列入 `notNullFields`，
 *     **但同处 `:845` 注释写「其约束以 archive/25 的 DDL 为准」** ⇒ 自相矛盾。
 *     裁定理由（决定性）：创始人裁 A 立的原则是「不能表能建、写不进」，其 T9 物证正是
 *     `run_id` NOT NULL ⇒ 写入 `exit 19`；这三列的生产者在登记件 `fieldProducers` 中标注为
 *     `[known-gap] 待 2-1b 补` ⇒ 要求 NOT NULL = **要求写一个尚不存在的生产者**。
 *     登记件数组订正归下一轮回填。
 *   · **`id` = `INTEGER PRIMARY KEY AUTOINCREMENT`**（非 `TEXT PRIMARY KEY`）。
 *     出处：设计正本 `archive/25` **行 46**；登记件 `fieldProducers.id` 的「TEXT PRIMARY KEY +
 *     由写入侧生成 + 无需应用层生产者」**自相矛盾**（两者不可同时成立）⇒ 以设计正本为准。
 *     SQLite 中 `INTEGER PRIMARY KEY` 即 rowid 别名 ⇒ 写入侧零负担；业务唯一性由
 *     `ux_metric_readings_key` 承担，不需要应用层造 id。
 *   · **表级不变量（CTO 裁：加）**：`CHECK (degraded = 1 OR (三列全非空))`
 *     ⇒ R4 三列为空时**必须** `degraded = 1`（= 卡面 §③-6 的降级语义，铁律 24/31 禁静默）。
 *     为何现在加：**SQLite 改约束须重建表**，2-1b 再做代价高。
 *
 * 覆盖面（本迁移的边界，逐字）:
 *   **时序表已建**（覆盖面 = 表结构 + 3 索引 + 唯一约束 + 不变量 CHECK；**写入侧未接**（2-1b #1054）；
 *   **查询/聚合未接**）—— 本迁移**不写一行数据**，也不提供读写 API。
 *
 * 契约（铁律 47）:
 *   @input    — better-sqlite3 Database（全新库或既有库）
 *   @output   — void；库内含 `metric_readings`（17 列）+ 3 索引（幂等：`IF NOT EXISTS`）
 *   @degraded — 无（纯 DDL，不触网络/文件；表已存在 ⇒ no-op）
 *   @invariant— 业务键 `(org_id, metric_id, entity_id, observed_at)` 唯一；`org_id` **无默认值**（宪章 H2）；
 *               `source_type` ∈ {compute, 42edge, manual, connector}；`confidence` ∈ {high, medium, low}；
 *               R4 三列缺省为 NULL 时 `degraded` 必须为 1（表级 CHECK）
 *   @not-here — 写入语义 = 2-1b（#1054）；读取/趋势 = 2-2 / 2-7；聚合表、指标定义表、决策台账**均不建**（卡面 §③-8）
 *
 * 铁律: 39（L5 存储层，仅依赖 better-sqlite3 类型）/ 38（零不安全断言）/ 24（无 IO ⇒ 无降级分支；异常上抛由
 *        `reconcileSchema` 阻断启动，与 001 先例一致）
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../schema-migration';

/**
 * 表结构 DDL（17 列）。与 3 个索引**分开**声明，便于逐条执行与失败定位。
 * 注意：**不导出** —— 唯一对外符号是 `metricReadingsMigration`（接线审计：新 export 必须被生产引用）。
 */
const METRIC_READINGS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS metric_readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        TEXT    NOT NULL,
  metric_id     TEXT    NOT NULL,
  entity_id     TEXT    NOT NULL DEFAULT '*',
  value         REAL    NOT NULL,
  unit          TEXT,
  observed_at   TEXT    NOT NULL,
  source_type   TEXT    NOT NULL
                 CHECK(source_type IN ('compute','42edge','manual','connector')),
  source_id     TEXT,
  is_estimated  INTEGER NOT NULL DEFAULT 0,
  confidence    TEXT    NOT NULL DEFAULT 'medium'
                 CHECK(confidence IN ('high','medium','low')),
  evidence_ref  TEXT,
  degraded      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  run_id        TEXT,
  input_digest  TEXT,
  def_version   TEXT,
  CHECK (degraded = 1 OR (run_id IS NOT NULL AND input_digest IS NOT NULL AND def_version IS NOT NULL))
)`;

/**
 * 3 个索引（逐条独立执行，便于失败时定位）。
 * ① 唯一：业务键幂等（重复采集 REPLACE 或 IGNORE）
 * ② 序列：时间窗查询主读路径（observed_at DESC）
 * ③ 来源：按来源追账
 */
const METRIC_READINGS_INDEX_DDL: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_metric_readings_key
     ON metric_readings(org_id, metric_id, entity_id, observed_at)`,
  `CREATE INDEX IF NOT EXISTS ix_metric_readings_series
     ON metric_readings(org_id, metric_id, observed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_metric_readings_source
     ON metric_readings(source_type, source_id)`,
];

/**
 * 迁移 002：建 `metric_readings` 表 + 3 索引。
 *
 * 幂等：全部 `IF NOT EXISTS` ⇒ 重复执行零副作用（既有库/新库均可跑）。
 * 失败：任一 DDL 抛错即向上抛 ⇒ `reconcileSchema` 阻断启动（fail-closed，同 001 先例）。
 */
export const metricReadingsMigration: Migration = {
  version: 3,
  name: 'metric-readings',
  up: (db: Database.Database): void => {
    db.exec(METRIC_READINGS_TABLE_DDL);
    for (const indexDdl of METRIC_READINGS_INDEX_DDL) {
      db.exec(indexDdl);
    }
  },
};
