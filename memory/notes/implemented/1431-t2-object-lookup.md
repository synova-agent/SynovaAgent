# 2026-11-21 · #1431（阶段 2 · T2）②↔④a 对象对查：按图节点 id 取回 ② 节点

> **类型**：implemented ｜ **Issue**：#1431（阶段 2 · T2）｜ **DEV DOC**：v2（评论 14176）｜ **CTO 裁定**：评论 14175｜**定向复审**：评论 14195（可交付 coding）｜**Mandate**：评论 14196
> **基线**：`c794737f8d9bd0c51639f9174a32b74c8cd47ade`（= PR #1435 merge，T1 进 main）｜ **分支**：`feat/1431-t2-object-lookup`

## 为什么

T1 已交付 ④a 的严格链（`metric_observations`，`object_id` 列）。v2 §4 写死生产约定：**`metric_observations.object_id` 的含义＝ ② 节点的 `graph_nodes.id`（`node-<uuid>`）**，**不是业务键**。
但 ② 侧只有 `getNode(id, graph='default')`：① 图分区可能被调用方漏传而回落 `default`；② **catch → `log.warn` → `return null`**，使「查不到」与「查不了」不可区分。T2 需要一条**按 (orgId, nodeId) 可靠取回**、跨企业取不到、查不到与查出错可区分的读路径。

## 改了什么（5 件，见 `.claude/claims/1431.yaml`）

1. **`src/adapters/sqlite-graph-store.ts`（+68 行，纯新增）**
   - 新 `GraphLookupError`（同文件导出，铁律 32 三件齐）：码 `VALIDATION`（phase=validate, retryable=false）／`GRAPH_LOOKUP_FAILED`（phase=graph-lookup, retryable=true）。
   - 新 `getNodeStrict(id, graph)`：**与 `getNode` 同一 SQL**（`WHERE id = ? AND graph = ? AND valid_to IS NULL`，同一 `{id,type,props}` 形状）；`graph` **必填无默认值**；未找到 ⇒ `null`；SQL 失败／`props` 非法 JSON ⇒ `log.warn` 后抛 `GraphLookupError(GRAPH_LOOKUP_FAILED)`。
   - **`getNode` 零改动**（`git diff` 为纯插入；吞错返 null 语义原样保留）。
2. **`src/agent/graph-store-service.ts`（+46 行）**
   - 新 `getObjectById(orgId, nodeId)`：两次**非空字符串**校验（失败 ⇒ `VALIDATION`，且校验在 `createSystemGraphStore()` **之前** ⇒ 零查询、零 `getDatabase` 触达）→ `createSystemGraphStore().getNodeStrict(nodeId, orgId)`。
   - **签名无 graph 入参**：图分区只由 `orgId` 派生（`graph = orgId`），调用方无从自报、不回落 `default`。
   - 重导出 `GraphLookupError`（沿本文件既有「L1 类型出口」约定，路由层不必直连 adapters）。
3. **`tests/agent/graph-store-service.objects.test.ts`（新，8 用例）**：`vi.mock` engine-context 返回真实 `:memory:` db（真 `SqliteGraphStore` + `createNode` 造真 `node-<uuid>`）；覆盖同 org 命中／跨 org／默认分区不泄漏／缺参零查询（spy + `getDatabase` 0 调用）/DB 异常抛错／`getNode` 吞错回归／`getNodeStrict` 未找到 null／调用方自报 graph 被忽略。
4. **`.claude/claims/1431.yaml`**：本票 claim 重写为 T2（第 0 步核定结论入注释）。
5. **本 Note**。

## 第 0 步核定（DEV DOC §7-0，强制）

`git grep -n "GRAPH_\|LOOKUP_" src` ⇒ **21 行命中、`LOOKUP_` 0 行**；去重 9 个 token（3 个非码：`GRAPH_NAME_PATTERN`／`GRAPH_NAME_INVALID_CODE`／`GRAPH_TRAVERSE`）。真码 6 个：`GRAPH_NAME_INVALID`（已 typed：`GraphScopeError`）、`GRAPH_DB`／`GRAPH_QUERY_ERROR`／`GRAPH_STORE_SHAPE_MISMATCH`／`GRAPH_STORE_ABSENT`／`GRAPH_UNAVAILABLE`（仅 HTTP 响应码／日志字段）。
**结论**：无「查询失败」等价 **typed** 码 ⇒ CTO 确认（开工确认）按 fallback **新增 `GRAPH_LOOKUP_FAILED`**。近邻但不复用的理由：`GRAPH_QUERY_ERROR` 只是 `routes/ontology.ts:206` 的响应码（无 `.phase/.retryable` 契约）；T1 的 `READ_FAILED` 属 `metric_observations` 读侧专属类（复用会把 L2 服务耦合到 L3 指标域）。

## 钉死的语义（本卡不改）

- `nodeId` ＝ **`graph_nodes.id`**（`node-<uuid>`），**不是业务键**；业务键 ↔ 节点 id 的解析**另票**（需映射载体），本卡**未实现**。
- `graph` 只由 `orgId` 派生；**禁默认 `default`、禁调用方自报**。
- 缺参 ⇒ `VALIDATION` 且**零查询**；未找到 ⇒ `null`；DB 异常 ⇒ **抛错**（不沿用 `getNode` 吞错）。

## 验证（原始输出）

| 命令 | 结果 |
|---|---|
| `npx vitest run --pool=threads tests/agent/graph-store-service.objects.test.ts`（TDD 先红） | exit 1｜`8 tests \| 7 failed`｜`TypeError: getObjectById is not a function` |
| 同上（实现后） | exit 0｜`1 file / 8 tests passed` |
| `npx tsc --noEmit` | exit 0（无输出） |
| `npx vitest run --pool=threads tests/agent tests/store`（DEV DOC 原文验收） | exit 1｜`79 files / 740 tests`：`3 failed \| 76 passed` 文件、`14 failed \| 726 passed` 用例 |
| 同上（排除 3 个**基线已红**文件） | **exit 0｜76 files / 693 tests passed** |
| `npx vitest run --pool=threads <那 3 个文件>` @ **基线 `c794737f`**（scratch worktree，diff 后删除） | exit 1｜`3 failed (3) / 14 failed \| 33 passed (47)` —— 与改动后**逐字同数** ⇒ 预存在，非本改动 |

预存在红的 3 个文件与根因：`tests/agent/skill-lazy-loader.test.ts`（`EPERM: mkdir 'D:\tmp\...'`）、`tests/store/session-seq-concurrency.test.ts`（`spawn EPERM`）、`tests/agent/context-compaction.test.ts`（`Promise returned by expect(...).resolves ... was not awaited`）。前两条是**沙箱**禁写仓外/禁 spawn 管道，第三条是测试自身未 await 断言（vitest 5.0.2 与 `package.json` 声明一致）。

## 改坏必红（4 条，逐条留原始失败行后恢复，恢复后 8/8 复绿）

| # | 改坏 | 原始失败行（节选） |
|---|---|---|
| ① | 不传 graph（回落 `'default'`） | `tests \| 4 failed \| 4 passed`；`[跨 org/默认分区] ... AssertionError: expected { …(3) } to be null`（另：同 org 命中 `expected null not to be null`） |
| ② | 允许调用方自报 graph（签名加 `graph?: string` 并用 `graph ?? orgId`） | `1 failed \| 7 passed`；`[反例] 调用方自报 graph 被忽略 ... AssertionError: expected null not to be null` |
| ③ | 改用 `getNode`（吞错） | `1 failed \| 7 passed`；`[DB 异常] ... AssertionError: expected undefined to be an instance of GraphLookupError` |
| ④ | 跳过入参校验（两个 `if` 改 `if (false)`） | `1 failed \| 7 passed`；`[缺参零查询] ... AssertionError: expected undefined to be an instance of GraphLookupError` |

每次改坏后 `src/agent/graph-store-service.ts` SHA256 恢复为 `AF5C2735…`（与改坏前一致）。

## 与 DEV DOC 的偏差（如实记录）

1. **验收命令的环境前缀**：沙箱禁 piped child stdio（`exec`/`fork` ⇒ EPERM），Vite 加载配置时 `exec('net use')` 必失败；测试一律用本地 preload shim（仅拦 `net use`，不动产品/依赖文件）＋ `--pool=threads`。**零产品代码影响**。
2. **worktree 位置**：`synova-agent/.agents/worktrees/1431-t2-object-lookup`（DSH 托管）。沙箱拒写仓外路径（`git worktree add D:/…/.synova-wt-1431-t2` ⇒ `Permission denied`），**主树零写入**。
3. **DEV DOC §8「①不传 graph ⇒ 反例 2 红」的落点**：实际先红的是「同 org 命中」＋「跨 org/默认分区」等 4 条；`graph_nodes.id` 是 PRIMARY KEY（同一 id 不可能同时存在于两个 graph），故「同一 id 在另一 org」本身无法区分 `default` 回落——判别力来自**默认分区不泄漏**用例（节点落 `default`，从 org 查必须为 null）。两场景都在 §8-2 的跨 org 用例内。
4. **额外 1 条用例**「调用方自报 graph 被忽略」：为使改坏②有判别力而加（`Reflect.apply` 传第 3 实参，不写 `as`），仍在同一测试文件内，未扩写集。

## NOT DONE / 未验证

- 业务键（businessKey）↔ 节点 id 解析：另票，本卡未实现、未造映射载体。
- ⑤建议、①快照（T3）、多用户（T4）：未动。
- 生产库真实 `object_id` 取值：未接客户库（v2 §9 已标未核实）。
- 真实路由接线：本卡只交付服务原语，未新增/改路由（写集内无 routes 件）。

## 回滚

回退本 PR 即恢复：`getObjectById`／`getNodeStrict`／`GraphLookupError` 消失，`getNode` 与既有测试本就没动。无迁移、无数据写入。
