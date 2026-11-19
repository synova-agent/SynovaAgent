/**
 * 迁移 007 — 指标观测严格表 `metric_observations`（#1431 / 阶段 2 · T1）
 *
 * 依据（逐条可核）:
 *   1. DEV DOC v2（Issue #1431 评论 13555）§3「新表 DDL」—— 本文件 DDL **逐字**照抄；
 *   2. CTO 放行（评论 13556）：只放行 T1；旧表/旧 writer/旧 reader **零改动**（追加式实现）；
 *   3. 迁移号口径（v2 §2.6 / §8）：**现有最大号 + 1** ⇒ 开工实测 `ls src/store/migrations`
 *      最大为 `006-enterprise-scan.ts` ⇒ 本文件 = `007`，`version = 7`。
 *      （`005` 空号是 #1398 为避让未合入的 `#1258` 所留；`assertMigrationChain` 只校验
 *       版本连号 + 末条 == SCHEMA_VERSION，文件名序号不是契约。）
 *
 * 与旧表 `metric_readings` 的关系（v2 §1／§2.1）:
 *   · **旧表零改动、零回填**：本迁移只 `CREATE` 新表，不 `ALTER`/`DROP`/`INSERT ... SELECT`；
 *   · 旧表用 `entity_id`（缺省 `'*'`）且 **无 `period` 列** —— 无法承担"四键 + 周期"语义，
 *     故新表独立建（不在旧表上追加列）。
 *
 * 契约（铁律 47）:
 *   @input    — better-sqlite3 Database（全新库，或 v6 既有库）
 *   @output   — void；库内含 `metric_observations`（15 列）+ 1 唯一索引 + 2 普通索引（全部 `IF NOT EXISTS`）
 *   @degraded — 无（纯 DDL，不触网络/文件；表已存在 ⇒ no-op）
 *   @invariant ① 唯一键 = `(org_id, object_id, metric_id, period)`，**`run_id` 不入唯一键**（v2 §3）；
 *              ② `object_id <> '*'`（禁止通配替身）；`length(period) > 0`（禁止空周期）；
 *              ③ `value` 可空 = 缺失（**禁止 0 冒充**）；`source_type` ∈ 4 值域；
 *              ④ `observed_at` 必填（观测时间，不得用写入时间冒充）；`created_at` 仅写入时间；
 *              ⑤ 本迁移**零回填**（不回填旧表任何行）
 *   @not-here 不做写入/读取（写侧 = `src/sentinel/metric-observations-writer.ts`，读侧 = 同名 reader）；
 *             不改旧表结构；不做聚合表/指标定义表；不做 down migration
 *
 * 回滚：无自动 down migration；用迁移前 SQLite `.backup` 恢复 v6（禁 DROP 新表冒充回滚）。
 *
 * 铁律: 39（L5 存储层，仅依赖 better-sqlite3 类型）/ 38（零不安全断言）/ 24（无 IO ⇒ 异常上抛由
 *        `reconcileSchema` 阻断启动，与 001/002 先例一致）
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../schema-migration';

/**
 * 新表 DDL（15 列）—— **逐字**照 DEV DOC v2 §3。
 * 注意：**不导出** —— 唯一对外符号是 `metricObservationsMigration`。
 */
const METRIC_OBSERVATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS metric_observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        TEXT    NOT NULL,
  object_id     TEXT    NOT NULL CHECK (object_id <> '*'),
  metric_id     TEXT    NOT NULL,
  period        TEXT    NOT NULL CHECK (length(period) > 0),
  value         REAL,                                   -- NULL = 缺失，禁止 0 冒充
  unit          TEXT,
  def_version   TEXT    NOT NULL,
  run_id        TEXT    NOT NULL,
  source_type   TEXT    NOT NULL CHECK (source_type IN ('compute','42edge','manual','connector')),
  source_id     TEXT,
  evidence_ref  TEXT,
  observed_at   TEXT    NOT NULL,                       -- 观测时间，不得用写入时间冒充
  degraded      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);`;

/**
 * 3 个索引（逐条独立执行，便于失败定位）—— 逐字照 DEV DOC v2 §3。
 * ① 唯一：四键幂等（**run_id 不入唯一键** ⇒ 同周期重跑只保留首行）
 * ② 序列：按四键查询的主读路径（T1 reader 的 where 与它同列）
 * ③ 运行：按 run_id 追账
 */
const METRIC_OBSERVATIONS_INDEX_DDL: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_metric_observations_key
     ON metric_observations (org_id, object_id, metric_id, period);   -- run_id 不入唯一键`,
  `CREATE INDEX IF NOT EXISTS ix_metric_observations_series
     ON metric_observations (org_id, object_id, metric_id, period);`,
  `CREATE INDEX IF NOT EXISTS ix_metric_observations_run
     ON metric_observations (org_id, run_id);`,
];

/**
 * 迁移 007：建 `metric_observations` 表 + 3 索引。
 *
 * 幂等：全部 `IF NOT EXISTS` ⇒ 重复执行零副作用。
 * 失败：任一 DDL 抛错即向上抛 ⇒ `reconcileSchema` 阻断启动（fail-closed，同 001/002 先例）。
 */
export const metricObservationsMigration: Migration = {
  version: 7,
  name: 'metric-observations',
  up: (db: Database.Database): void => {
    db.transaction((): void => {
      db.exec(METRIC_OBSERVATIONS_TABLE_DDL);
      for (const indexDdl of METRIC_OBSERVATIONS_INDEX_DDL) {
        db.exec(indexDdl);
      }
    })();
  },
};
