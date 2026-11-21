# 2026-11-21 · #1431（阶段 2 · S1）② 对象与关系真实落库：createObject / createRelation

> **类型**：implemented ｜ **Issue**：#1431（阶段 2 · S1）｜ **六节卡**：评论 14225 ｜ **DEV DOC v1（含编码指令）**：评论 14226
> **基线**：`4a78be9cf51a690c4a15f89570a0ca4b5193fa28`（= PR #1449 merge，T2 进 main）｜ **分支**：`feat/1431-s1-objects`
> **交付形态**：PR（不 merge）｜ **库口径**：`:memory:`（不触 `data/synova.db`）

## 为什么

T2/S3 只交付了 ② 的**读**路径（`getObjectById` / `getNodeStrict`），T1 的 `metric_observations.object_id` 语义又明确＝ ② 节点的 `graph_nodes.id`（`node-<uuid>`）——**② 侧没有任何"把真实业务实体写成对象与关系"的服务入口**。S1 补两个写原语：对象落 `graph=orgId` 分区、关系两端必须同 org，且都能按 id 读回。这是 §5 阶段 2 第 1 条"至少一个真实 ② 对象及关系"的正面对应卡；没有它，④a 的 `object_id` 无处可指。

## 第 0 步核定（开工前实读 @`4a78be9cf`）

| 前提 | 证据（实读） | 结论 |
|---|---|---|
| `createNode(type, props, graph='default'): string`，返回 `node-<uuid>` | `src/adapters/sqlite-graph-store.ts:182-199`；id 由 `:207` 生成 | 可复用，无需改 adapter |
| `standardKeyGuard` 是否拒绝 `period`/`defVersion` | `src/adapters/standard-key-guard.ts:30-31`：仅 `props.standardKey` 存在时先查后写，否则 `originalCreate` 直通 | **不拒绝** ⇒ 两键直通，props 原样落库；**不 opt-out** |
| `name` 列取值 | `sqlite-graph-store.ts:208`：`props.name \|\| props.label \|\| type` | 测试**显式给 `name`**，不依赖回落 |
| `createEdge` 对不存在节点的行为 | `sqlite-graph-store.ts:234-237`：`getNode` 取不到 ⇒ 两端类型记 `"unknown"`（既有静默降级，本卡**不修**） | 写边前必须自查两端，否则会落 `"unknown"` 边 |
| `getNodeStrict` 可用（T2 已合） | `sqlite-graph-store.ts:397-424`；服务层 `graph-store-service.ts:46-65` | 关系端点存在性检查复用它（未找到 → null；介质失败 → 抛 `GRAPH_LOOKUP_FAILED`） |

## 改了什么（4 件，见 `.claude/claims/1431.yaml`）

1. **`src/agent/graph-store-service.ts`（+148 行，纯新增；既有 `createSystemGraphStore`/`getObjectById` 零改动）**
   - 新 `GraphWriteError`（同文件导出，铁律 32 三件齐：`.code`/`.phase`/`.retryable`，另带 `.field`）：码 `VALIDATION`（phase=validate, retryable=false）／`EDGE_ENDPOINT_MISSING`（phase=validate, retryable=false）。介质层写入异常**不套本错误**，由 adapter 记日志后原样上抛。
   - 新 `createObject(orgId, type, props): string`：校验 `orgId`/`type` 非空字符串、`props` 为纯对象、`props.period` 匹配 `YYYY-MM`、`props.defVersion` 非空字符串；**全部校验先于 `createSystemGraphStore()`** ⇒ 违约零写入、零 `getDatabase` 触达；通过后 `createNode(type, props, orgId)`。
   - 新 `createRelation(orgId, type, fromId, toId, props?): string`：校验入参（含可选 `props` 纯对象）→ `getNodeStrict(fromId, orgId)` / `getNodeStrict(toId, orgId)`，任一为 null ⇒ `EDGE_ENDPOINT_MISSING`（**零写入**）→ `createEdge(type, fromId, toId, undefined, props ?? {}, orgId)`。
   - 两个函数**签名都没有 graph 入参** ⇒ 图分区只由 `orgId` 派生，调用方无从自报、不回落 `'default'`。
2. **`tests/agent/stage2-s1-objects.test.ts`（新，7 用例）**：`vi.mock` engine-context 返回真实 `:memory:` 库 + `beforeEach` 新库；覆盖正常（两节点一边、读回逐字段、边原始行两端类型）、跨 org 读 null、跨 org 建边、缺参零写入（行数 +0 / `createNode` 0 调用 / `getDatabase` 0 调用）、边指向不存在节点抛错且零边写入、DB 异常抛错、调用方自报 graph 被忽略（物理 `graph` 列 = orgId）。
3. **`.claude/claims/1431.yaml`**：本票 claim 重写为 S1（第 0 步核定结论入注释）。
4. **本 Note**。

## 钉死的语义（本卡不改）

- `graph` **只由 `orgId` 派生**（`graph = orgId`）；禁默认 `'default'`、禁调用方自报。
- `createObject.props` **必须**含 `period`（`YYYY-MM`）与 `defVersion`（非空字符串）。**比 T1 更严的一点**：T1 的 `period` 只判"非空"，本卡判 `YYYY-MM` 形态——依据是本卡 DEV DOC 明文 `period(YYYY-MM)`，不是我的推测。
- `createRelation` 两端**必须存在且同 org**（`getNodeStrict(id, orgId)` null ⇒ 缺失；跨 org 同判）；**先查后写** ⇒ 不产出 `"unknown"` 类型边。
- `props` 原样落库（不注入 `data_versions`/`has_conflict`——那两个键只在 `props.standardKey` 存在时由守卫追加）。
- DB 异常 ⇒ **抛出**（不吞、不返回假 id）。

## 验证（原始输出）

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/agent/stage2-s1-objects.test.ts` | exit 0｜`Test Files 1 passed (1)`｜`Tests 7 passed (7)` |
| `npx vitest run tests/agent`（**改动前，base `4a78be9cf`**） | exit 1｜`Test Files 1 failed \| 60 passed (61)`｜`Tests 2 failed \| 559 passed (561)`；两条均为 `tests/agent/context-compaction.test.ts`（`:95` / `:410` 的 `expect(...).resolves...` 未 await） |
| `npx vitest run tests/agent`（**改动后**） | exit 1｜`Test Files 1 failed \| 61 passed (62)`｜`Tests 2 failed \| 566 passed (568)`；**同两条、同因**（新增本卡 7 用例全绿） |
| `npx tsc --noEmit`（改动前） | exit 0，零输出 |
| `npx tsc --noEmit`（改动后） | exit 0，零输出 |

## 改坏必红（3 条，逐条留原始失败行后恢复；恢复后 7/7 复绿）

| # | 改坏 | 原始失败行（节选） | 结果 |
|---|---|---|---|
| ① | `createObject` 落库 graph 改用 `'default'` | `[正常] ... GraphWriteError: 关系端点在该 org 分区内不存在（不得跨 org）: fromId=node-…; toId=node-…`（`graph-store-service.ts:180`，测试 `:99`）；`[跨 org] AssertionError: expected null not to be null`；`[反例] AssertionError: expected { graph: 'default' } to deeply equal { graph: 'org-s1-zhaopin' }`；`[边/缺参] AssertionError: expected 'fromId' to be 'toId'` | `Tests 4 failed \| 3 passed (7)` |
| ② | 跳过 `props.period`/`defVersion` 校验（两个 `if` 改 `false`） | `[缺参零写入] AssertionError: expected undefined to be an instance of GraphWriteError`（测试 `:175` → `catchWriteError` `:91`） | `Tests 1 failed \| 6 passed (7)` |
| ③ | 删除关系端点存在性检查（允许指向不存在节点） | `[跨 org/边] ... expected undefined to be an instance of GraphWriteError`（测试 `:146`）；`[边/缺参] ... expected undefined to be an instance of GraphWriteError`（测试 `:196`） | `Tests 2 failed \| 5 passed (7)` |

每次恢复后 `src/agent/graph-store-service.ts` 的 SHA256 均回到 `ECD7310C4EDC4088B23DDA8D3202A52A601A80488289E01ED0830E4D4CC37D6B`（改坏前值），随后 `7/7` 复绿。

## 与 DEV DOC 的偏差（如实记录）

1. **测试环境**：独立 worktree 无 `node_modules` ⇒ 建 junction 到共享安装 `.synova-wt-1444-r2/node_modules`（前序 T2 session 的 worktree 同款做法）。**零产品代码影响**；主树未写。
2. **`tests/agent` 全量不是全绿，且改动前就不是**：`tests/agent/context-compaction.test.ts` 在 base `4a78be9cf` 即有 2 条红（`expect(...).resolves...` 未 `await`），与本改动无关、本卡不修（写集外）。改动后同两条、同因，用例总数 `+7` 全绿。
3. **DEV DOC §5「改坏③ ⇒ 边两端非 unknown 用例红」的落点**：实际判别落在 `[边/缺参]`（删除端点检查后不抛错）与 `[跨 org/边]`，均报 `expected undefined to be an instance of GraphWriteError`；**正例的两端是真实存在的节点**，无论是否预检，其边两端类型都非 `unknown` ⇒ 正例不可能因该改坏变红。故断言口径 = "该抛错时抛错 + 零边写入"，而非正例变色。
4. **全量跑产生一个仓内未跟踪文件**：`tests/agent-observer/report.integration.test.ts` 运行会写出 `docs/synova/product-lines/evidence/D819-capture-20260919.json`（基线跑同样产生）。本 PR **不提交、不删除**（不属写集；`git status` 可见）。

## NOT DONE / 未验证

- **生产调用方未接**：路由/扫描链/哨兵链均未调用 `createObject`/`createRelation`（写集无 `routes/**`、`src/l4/**`、`src/sentinel/**`）。本卡只交付服务原语，接线另票。
- 业务键（businessKey）↔ 节点 id 解析：未实现（另票，需映射载体）。
- SOG schema 校验（`validateAndLog`）、多租户、①快照（S4）、④a 生产者（S2）：未动。
- 真实客户库/生产 db：未接（只用 `:memory:`）。

## 回滚

删除 `createObject` / `createRelation` / `GraphWriteError`（及本 Note）即回到基线；无迁移、无既有函数语义变更、无数据写入。
