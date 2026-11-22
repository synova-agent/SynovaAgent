# 2026-11-21 · #1431（阶段 2 · S2）哨兵轮次 → ④a 真实指标生产者

> **类型**：implemented ｜ **Issue**：#1431（阶段 2 · S2）｜ **S2 卡 v2**：评论 14333 ｜ **Mandate**：评论 14335
> **基线**：`b4c1ec5ee87e20ca3800e12fd8d158e59c9b2a1c`（= PR #1452 merge，S1 进 main）｜ **分支**：`feat/1431-s2-producer`
> **交付形态**：PR（不 merge）｜ **库口径**：`:memory:`（不触 `data/synova.db`）

## 为什么

T1 只交付了严格表与 writer/reader（表 `metric_observations` 的唯一键 = `(org_id, object_id, metric_id, period)`，`object_id <> '*'`），S1 只交付了 ② 对象写入原语。**链路上没有任何生产者**：哨兵轮次至今只写旧表 `metric_readings`（`entity_id='*'`、无 period），而 `period` 在 `src/sentinel/types.ts` 全文 0 命中 —— 不可能从现有上下文合规推导。本卡把「哨兵轮次 → ④a」这条真实路径接上：调用方显式给 period/objectKey ⇒ 轮次结果落新表，`object_id` 指向 `resolveOrCreate` 得到的真实 ② 节点；缺任一 ⇒ **不写**并留机器可过滤的降级码（禁 `now()` 派生、禁写 `'*'`）。

## 第 0 步核定（开工前实读 @`b4c1ec5ee`；与 Mandate「已核事实」逐条一致）

| 前提 | 证据（实读） | 结论 |
|---|---|---|
| `runSentinelForTeam(teamId, store, options?)` 原无 period/objectKey | `src/sentinel/sentinel-runner.ts:30-34` | 需新增可选参数并透传到轮次写入 |
| 上下文只有 `now: new Date()` | 同文件 `:57` | `observedAt` 可用注入时钟；`period` 不可 |
| `org_id` 就是 `teamId` | `sentinel-runner.ts:37-38`；`registry.ts` 轮次写入传 `context.teamId` | ④a 的 `org_id` = `context.teamId` |
| 旧 writer 支持 `entityId?`，轮次级写死 `'*'` | `metric-readings-writer.ts:68` / `:196` | 旧链不动；新链走 T1 严格 writer |
| `types.ts` 无 `period` | 全文 0 命中 | period 只能由**调用方显式**传入 |
| `createObject` 必填 `props.period`(YYYY-MM)+`defVersion` | `graph-store-service.ts:128-135` | 新建 Team 节点必须带这两键 |
| `SqliteGraphStore` 构造即 `reconcileSchema` | `sqlite-graph-store.ts:148-156` | `:memory:` 库里 `graph_nodes` 与 `metric_observations`（迁移 007）同库可断言 |
| 旧链轮次写入点在 `registry.runAll` | `registry.ts:102`（基线） | 追加新表写入；旧调用**逐字保留**（旧链零改动） |

## 改了什么（6 件，见 `.claude/claims/1431.yaml`）

1. **`src/sentinel/sentinel-runner.ts`（+32/-10）**
   - 新导出 `RunSentinelForTeamOptions { metricSink?, period?, objectKey? }`（原内联 `{metricSink?}` 扩成命名类型，**不扩 `SentinelContext`**）。
   - 仅当调用方**尝试了 ④a**（给了 period 或 objectKey 任一）才多取一次引擎库句柄 `db`；旧调用点不传 options ⇒ 不多一次 `getDatabase`，行为逐字不变。
   - `registry.runAll(context, { period, objectKey, db })` 透传。
2. **`src/sentinel/registry.ts`（+194/-2）**
   - 新导出 `SentinelRoundObservationOptions { period?, objectKey?, db? }`；`runAll(context, observation?)` 第二参可选（既有 `runAll(context)` 调用点 `src/server.ts:278` 零改动）。
   - 轮次写入顺序：旧链 `writeRoundReadings(...)`（**逐字保留**）→ 新链 `writeRoundObservations(...)`（`writeMetricObservation` 落 `metric_observations`）。
   - `resolveRoundObservationTarget`：period 缺 ⇒ `S2_DEGRADED_NO_PERIOD`；非 `YYYY-MM` ⇒ `S2_DEGRADED_BAD_PERIOD`；objectKey 缺 ⇒ `S2_DEGRADED_NO_OBJECT`；无 teamId ⇒ `S2_DEGRADED_NO_ORG`；db 缺 ⇒ `S2_DEGRADED_NO_DB`；`resolveOrCreate` 抛错 ⇒ `S2_DEGRADED_OBJECT_FAILED`。任一命中 ⇒ **本轮不写 ④a**（`target=null`），**不中断**哨兵轮次。
   - 每哨兵 2 行：`SENTINEL-FINDINGS-<id>`（findings 条数）＋`SENTINEL-DURATION-<id>`（durationMs，unit=ms）；`def_version` = 哨兵 `config.version`；`run_id` 每轮 `run-<uuid>`（不入唯一键）；`observed_at` = `result.checkedAt`，缺失时用**注入的** `context.now`（新代码不直取系统时钟）。单行写失败 ⇒ `S2_DEGRADED_WRITE_FAILED`，不伪造成功。
3. **`src/agent/graph-store-service.ts`（+45）**：新 `resolveOrCreate(orgId, businessKey, type, props?)` —— 先 `queryNodes(type, { businessKey }, orgId)` 查；命中复用 id（不改 props）；未命中走 `createObject`（props 必须含 period/defVersion），`props.businessKey` 由本函数注入 ⇒ 同 `(orgId, type, businessKey)` 幂等。既有 `getObjectById`/`createObject`/`createRelation` 零改动。
4. **`tests/sentinel/stage2-s2-producer.test.ts`（新，6 用例）**：正例（2 行、五键齐、object_id 在 graph_nodes 可查、旧表仍 2 行）／缺 period／缺 objectKey／period 形态／幂等（同 objectKey×3 次含跨 period ⇒ Team 恒 1 个、object_id 唯一）／`resolveOrCreate` 边界（缺参零写入、命中不再校验 props）。
5. **`.claude/claims/1431.yaml`**：本票 claim 改为 S2。
6. **本 Note**。

## 钉死的语义（本卡不改）

- `period` 由调用方显式传入，形态 `YYYY-MM`；**禁止 `now()` 派生/写入时间顶替**（registry 侧另加形态校验，防绕过 T1 只判非空）。
- `object_id` **禁止 `'*'`**：要么是 `resolveOrCreate` 返回的 `node-<uuid>`，要么本轮不写。
- 旧表 `metric_readings` 的写入调用**逐字保留**（旧链零改动）；新表写入是**追加**。
- 旧 `metric-readings-writer`/`reader`、迁移 007、`src/store/**`、`src/adapters/**`、routes、renderer、scripts、门禁：**零改动**。

## 验证（原始输出）

| 命令 | 改动前（base `b4c1ec5ee`，同 worktree） | 改动后 |
|---|---|---|
| `npx vitest run tests/sentinel/stage2-s2-producer.test.ts` | （新文件不存在） | exit 0｜`Tests 6 passed (6)` |
| `npx vitest run tests/sentinel tests/agent` | exit 1｜`Test Files 5 failed \| 294 passed \| 1 skipped (300)`｜`Tests 11 failed \| 1655 passed \| 1 skipped (1667)` | exit 1｜`Test Files 5 failed \| 295 passed \| 1 skipped (301)`｜`Tests 11 failed \| 1661 passed \| 1 skipped (1673)`（**同 5 文件、同 11 条**既有失败；新增 6 全绿） |
| `npx tsc --noEmit` | exit 0 | exit 0（零输出） |
| `CI=1 npx vitest run tests/contract tests/user-visible`（CI 必跑面） | — | `Test Files 16 passed (16)`｜`Tests 102 passed (102)` |

既有 11 条失败（`b4c1ec5ee` 上就红，同因，非本卡引入）：`tests/agent/context-compaction.test.ts` 2｜`tests/sentinel/d752-type-net-gate.integration.test.ts` 4｜`tests/sentinel/field-name-alignment.test.ts` 1｜`tests/sentinel/metric-readings-reader.integration.test.ts` 3｜`tests/sentinel/tenant-filter-keys.test.ts` 1（`businessKey` 未登记为业务键，来自 #1426 的 `src/runtime/dsh/domain-context.ts:85`，本卡沿用同形先例但未改该测试）。

## 改坏必红（3 条，逐条留原始失败行后恢复；恢复后 6/6 复绿）

| # | 改坏 | 原始失败行（节选） | 结果 |
|---|---|---|---|
| ① | 新表写入 `objectId` 改成 `'*'` | `AssertionError: expected [] to have a length of 2 but got +0`（正例，`tests/sentinel/stage2-s2-producer.test.ts:183`）；`AssertionError: expected [] to have a length of 4 but got +0`（幂等） | `Tests 2 failed \| 4 passed (6)` |
| ② | `period` 缺省时用 `new Date()` 派生 | `AssertionError: expected [ { …(12) }, { …(12) } ] to have a length of +0 but got 2`（反例1：缺 period 仍写了 2 行） | `Tests 1 failed \| 5 passed (6)` |
| ③ | `resolveOrCreate` 去掉先查后建（无幂等） | `AssertionError: expected 3 to be 1 // Object.is equality`（幂等：3 次跑出 3 个 Team 节点）；`GraphWriteError: props.period 必须是 YYYY-MM 形态字符串（实得 undefined）`（边界：第二次调用试图新建） | `Tests 2 failed \| 4 passed (6)` |

恢复后 SHA256：`src/sentinel/registry.ts` = `A387350109F805FAC632251A9188DBC9F73C7472E9E1458D9A6E9FBEE3D20799`；`src/agent/graph-store-service.ts` = `5D1557CD6B07F5B021934D8A5E12F8EFCCF8D84B5356A81CFB87F1C123EEA2CD`（均回到改坏前值），`6 passed (6)`。

## 与 DEV DOC／Mandate 的偏差（如实记录，需 CTO 裁定）

1. **`objectKey` 按「必填」实现（严格口径）**：Mandate 契约 3 钉死「缺 period **或 objectKey** ⇒ 不写 ④a + `S2_DEGRADED_NO_OBJECT`」；但契约 2 又写 `businessKey = objectKey||teamId`（回落 teamId）。两处冲突；本卡取**更严格的契约 3**（缺 objectKey 即不写，`||teamId` 回落不启用），否则 `S2_DEGRADED_NO_OBJECT` 永不可达、且会把调用方未指定的对象当目标。
2. **幂等键含 `type`**：契约 5 写 `(orgId, businessKey)`；`queryNodes` 必须带 type ⇒ 实现为 `(orgId, type, businessKey)`，与既有 `scan_ontology_links` 的 `(graph, kind, type, business_key)` 同形（先例 `src/runtime/dsh/domain-context.ts:85`）。同 businessKey 不同 type 会建两个节点；若要求跨 type 唯一，需要新的查询载体（`src/adapters/**` 在禁止写集内，另票）。
3. **「改走新表」按「追加」实现**：Mandate 同时钉「旧 `metric_readings` 链零改动」。旧链的轮次写入点是 `registry.runAll` 里那一行，删掉即改变旧链行为，并会让既有判据 `tests/sentinel/metric-readings-writer.test.ts:175-194`（A2）变红（该文件不在写集）⇒ 新表写入**追加**、旧调用逐字保留；新测试同时断言旧表仍写 2 行。
4. **`observed_at` 兜底用注入时钟**：旧 writer 用 `new Date()` 兜底；`tests/contract/time-injection.test.ts` 禁止新代码直取系统时钟（改坏首版确实被它点名 `src/sentinel/registry.ts: 期望 [0,0] 实得 [0,1]`）⇒ 改为 `context.now.toISOString()`（注入值），未新增系统时钟直取。
5. **测试环境**：独立 worktree 无 `node_modules` ⇒ 建 junction 指向 `.synova-wt-1431-stage2/node_modules`（package.json 与 base 零 diff）。**零产品代码影响**；主树未写。

## NOT DONE / 未验证

- **period 的生产者（调度接入）未接**：谁按周期调用 `runSentinelForTeam(..., { period, objectKey })` 归 **S2b**（卡 v2 停点）。当前生产调用点（`src/l3/synova-diagnosis-engine-impl.ts:261`、`src/server.ts:278`）都不传 options ⇒ 只记 `S2_DEGRADED_NO_PERIOD`，**不写 ④a**（这正是本卡要暴露的缺口）。
- **真实客户库/生产 db 未验**：只用 `:memory:`；`metric_observations` 在生产库的迁移由 T1 负责（007）。
- **CI affected 面的本机复现**：`CI=1 vitest run --changed b4c1ec5ee` 在本机选 137 文件、14 条失败；其中 12 条与 base 同因（threshold-single-source 9 / mvp1-m9 2 / onboarding-mount 1，均为 Windows 权限或夹具形态），另 2 条（`probe-content-reload` / `sentinel-bootstrap` 的哨兵目录 46→45）为并行时序 flaky（隔离跑与 base 均通过）。**CI（win-ci）实跑结果为准**，本 Note 不代为声称绿。

## 回滚

还原 3 个源文件（删 `resolveOrCreate`、`registry` 的 ④a 段与 `runAll` 第二参、runner 的 options 扩展）即回到基线；无迁移、无既有函数语义变更、无数据写入；旧链全程未被改动。
