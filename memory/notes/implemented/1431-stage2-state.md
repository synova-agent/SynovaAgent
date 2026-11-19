# 2026-11-19 · #1431（阶段 2 · T1）②①④a 最小状态面：metric_observations 严格链

> **类型**：implemented ｜ **Issue**：#1431（阶段 2 · T1）｜ **DEV DOC**：v2（评论 13555）｜ **放行**：评论 13556
> **基线**：`d0312a0057a91f0924f478c691a48eda4557b723` ｜ **分支**：`feat/1431-stage2-state`
> **迁移号**：**007**（开工实测 `src/store/migrations` 最大 = `006-enterprise-scan.ts`；`005` 为 #1398 避让空号）

## 为什么

旧表 `metric_readings` 承担不了阶段 2 的"状态"语义：`entity_id` 缺省 `'*'`（通配替身）、**无 `period` 列**；
旧 writer 契约是"**永不抛**"（返回 `{written,degraded,reason}` + `log.warn`）。
阶段 2 需要的是「四键 + 显式 period + 严格失败」的最小状态面，且**不得**把旧链合同改掉 ⇒ 追加式新建。

## 改了什么（13 件，见 `.claude/claims/1431.yaml`）

1. **`src/store/migrations/007-metric-observations.ts`（新）**：表 `metric_observations` 15 列 + 1 唯一 + 2 普通索引，
   DDL **逐字**照 v2 §3。唯一键 `(org_id, object_id, metric_id, period)`，**`run_id` 不入唯一键**；
   `CHECK (object_id <> '*')`、`CHECK (length(period) > 0)`、`source_type` 四值 CHECK；`value REAL` 可空（NULL = 缺失）。
   **零回填**，不 `ALTER`/`DROP` 旧表。
2. **`src/store/schema-migration.ts`（仅登记）**：import + 数组追加 + `SCHEMA_VERSION` 6 → 7
   （`assertMigrationChain` 要求末条 == 版本）。
3. **`src/sentinel/metric-observations-writer.ts`（新）**：严格链。缺 `orgId/objectId/metricId/period/defVersion/runId/
   observedAt`、`objectId === '*'`、`period === ''`、非法 `sourceType`、非有限 `value` ⇒
   `MetricObservationError(VALIDATION)` 且**零写入**（校验先于 INSERT）。存储失败 ⇒ `WRITE_FAILED`（抛错，不降级）。
   幂等：`ON CONFLICT(org_id, object_id, metric_id, period) DO NOTHING` ⇒ `{written:false, duplicate:true}`，不覆盖首行。
4. **`src/sentinel/metric-observations-reader.ts`（新）**：只做四键精确读回（行 / `null`）；读侧与写侧共用
   `assertMetricObservationKey`；表缺失/查询失败 ⇒ `READ_FAILED`（**不静默返回 null**）。
5. **测试 3 新**：writer 13 例 / reader 8 例 / migration 10 例，全部 `:memory:`；覆盖 v2 §7 的 6 条正反例与 5 条改坏必红。
6. **4 件既有版本常量同步（越界，见下节）**：`tests/store/schema-migration.test.ts`、`tests/store/metric-readings-schema.test.ts`、
   `tests/store/migrations/003-orgs.test.ts`、`tests/enterprise-scan/migration.test.ts`。

## 🔴 与派单写集的偏差（需 CTO 裁定）

- **事实**：派单写集 = 9 件；新增迁移把 `SCHEMA_VERSION` 6 → 7 后，**4 个既有测试硬编码版本 6**（均不在「禁改」清单内）：
  - `tests/store/metric-readings-schema.test.ts:206-207` `expect(SCHEMA_VERSION).toBe(6)` → 红：`expected 7 to be 6`
  - `tests/store/schema-migration.test.ts:80-81` 同上
  - `tests/store/migrations/003-orgs.test.ts:65-70` 同上
  - `tests/enterprise-scan/migration.test.ts:39,107` `SELECT MAX(version)` 断言 `{v:6}` → 红（v5 库 reconcile 后 = 7）
- **先例**：加 v6 的提交 `cb7e488b9` 同步改的正是前 3 件（`+2 -2` 各一行）；第 4 件 `enterprise-scan/migration.test.ts`
  是 #1398 自己的验收件。
- **不改会破坏什么**：全量测试/CI 红 ⇒ PR 不可合；而这 4 件不在「禁改」清单内，属**版本常量簿记**，不是产品方向。
- **请求裁定**：把 4 件补入 T1 写集（或在本 PR 回执中追认）。**未改**任何旧链语义文件、routes、renderer、runtime、门禁。

## 本切片 NOT DONE（如实记录，不计通过）

- **T2（②↔④a 连接）/ T3（① 快照）/ T4（多用户共享面）**：未动（评论 13556 只放行 T1）。
- **哨兵侧接线**：新 writer 尚未被哨兵/流程调用（v2 §6：T2/T3 另票）——本切片只交"严格原语 + 迁移"。
- **聚合/趋势/时间窗**：reader 只有四键精确读回；列表/趋势不在本卡。
- **`degraded` 列**：DDL 有默认 0；v2 §5 的新链接口未暴露 `degraded`，本切片不写非 0 值（严格链无降级路径）。

## 验证（原始输出）

- `npx vitest run tests/sentinel/metric-observations-writer.test.ts tests/sentinel/metric-observations-reader.test.ts tests/store/metric-observations-migration.test.ts`
  ⇒ **3 files / 31 tests passed**，exit 0。
- `npx tsc --noEmit` ⇒ **exit 0**。
- 旧链回归：`metric-readings-writer.test.ts` 12 绿、`metric-wiring-b2/b3/b3b` 各 3 绿、源文件与测试文件 `git diff --quiet` **零改动**。
- 5 条改坏必红（逐条留原始失败后恢复复绿）：
  ① 去 `object_id <> '*'` CHECK ⇒ migration 2 条 + writer 1 条红；
  ② 缺键静默 return ⇒ writer 5 条红（`expected undefined to be an instance of MetricObservationError`）；
  ③ `value` 缺失写 0 ⇒ writer/reader 各 1 条红（`expected +0 to be null`）；
  ④ 唯一键加 `run_id` ⇒ migration 1 条 + writer 5 条红（`ON CONFLICT` 目标失配 ⇒ `WRITE_FAILED`）；
  ⑤ 迁移顺手 `ALTER metric_readings` ⇒ migration 3 条红（旧表 SQL/旧行/列数 18≠17）。
- 恢复后上述 31 测试**复跑全绿**。

## 已知限制 / 预存在红（非本改动）

- **`tests/sentinel/metric-readings-reader.integration.test.ts` 3 红（预存在）**：该文件写入 `2026-10-11/12` 的行，
  reader 用 `observed_at >= datetime('now','-30 days')`；实测 `now=2026-11-19 12:12:58`、窗口起点 `2026-10-20`、
  `legacy_row_in_window=0` ⇒ 时间窗过期。该文件与 writer/reader/002 迁移 `git diff --quiet` 均为 0（与 T1 无关），
  且属**禁改**清单 ⇒ 未改。
- **广度回归中的 shell 类红（环境）**：`tests/sentinel/d752-type-net-gate.integration.test.ts`（exit 127 = 子进程找不到 `bash`）、
  `field-name-alignment` / `standard-key-guard`（`grep`/`git grep` 子进程不可用）、`tenant-filter-keys`（存量 `businessKey` 漂移）
  —— 均与本改动无 import 关系；单跑 `silent-wrong-value` / `enterprise-scan/variants` 均绿。
- **`value: undefined`**（JS 调用方越类型）⇒ `VALIDATION`（接口要求 `value: number | null`）；
  `value: null` 才表示缺失。

## 回滚

- 迁移无自动 down；用迁移前 SQLite `.backup` 恢复 v6（禁 DROP 新表冒充回滚）。
- 代码：回退本 PR 即回到 v6（旧表/旧链本就零改动）。
