# 2026-11-19 · #1426（I-1）DSH 只读工具接真实领域结构（② 层）

> **类型**：implemented ｜ **Issue**：#1426（I-1）｜ **DEV DOC**：v3（评论 13350）｜ **Mandate**：评论 13352
> **基线**：`main = 70f38a9d3d91cad471a4d9ac9661f7de82812720` ｜ **分支**：`feat/1426-dsh-domain-context`

## 为什么

`synova_context_get` 之前返回**合成基线**（`synthetic:true`、`api:'synthetic-context-v1'`、3 条写死条目），
模型在 DSH 会话里读到的是假数据。1A 的锚要求「模型能读到企业真值」——本切片把这条工具接到**自己的领域结构**
（`graph_nodes`/`graph_triples`），但**只做能证明的事**：只产 ② 本体结构，③ 观测／④ 依据显式 NOT DONE。

## 改了什么（13 件，见 `.claude/claims/1426.yaml`）

1. **`src/runtime/dsh/domain-context.ts`（新）**：`buildContextSnapshot(ctx, problemId)` 只读 ②。
   - 根解析：本企业 graph 内先按 `$id`（`graph_nodes.id`），再枚举类型走 `SqliteGraphStore.queryNodes`
     按 `props.businessKey`；解析不到 ⇒ `DOMAIN_EMPTY`（不泄露跨企业存在性）。
   - 条目：根对象 **1 跳邻接节点**（出边对端＋入边对端；去重、升序、**不含根**）；**仅当**
     `props.period` 与 `props.defVersion` 同时为非空字符串才产出（不补零、不编常量）。
   - 有界：`count` = 命中总数，`items` ≤ 200，`truncated = count > items.length`；同输入两次调用 JSON 逐字相等。
   - 逐字段来源表写进文件头 JSDoc（`cycleVersion/sentinelRun/evidenceId` 恒 null 并注明原因）。
   - `visibility`：走既有判据 `toScanViewer`（`connectors/enterprise-scan/visibility.ts`）确认企业域，
     ga／未知角色／缺 sub|orgId ⇒ fail-closed（既有码 `FORBIDDEN`，403）；图必须等于判据产物 `viewer.orgId`。
2. **`src/runtime/dsh/tools.ts`**：`handleDomainToolCall(toolName, args, ctx)` 加 ctx；**args 校验先于 ctx 检查**
   （`security-cases.test.ts` 顺序守护，未改仍绿）；缺 ctx ⇒ `UNAUTHORIZED`（401，不写成 FORGED_IDENTITY）；
   删除合成基线；`ContextSnapshotItem` 可空字段/`status` 收窄、`ContextSnapshot` 加 `truncated` 且 `synthetic:false`。
3. **`src/mcp/http.ts`**：回环 MCP 工具调用传入 token 解析出的 `context`（身份不再丢）。
4. **`src/mcp/tool-definitions.ts`**：`synova_context_get` 在通用/stdio 分派**没有身份面** ⇒ fail-closed 抛
   `UNAUTHORIZED`（不造身份、不读领域数据）；同步 SIDECAR 工具描述/instructions 去掉“合成基线”文案。
5. **测试（5 改 1 新 + 夹具）**：`domain-context.test.ts`（新，:memory: 真 store 矩阵）、
   `tools.test.ts`、`isolation.test.ts`、`readonly-tool.test.ts`、`readonly-tool-real.test.ts`、
   `tests/mcp/http.test.ts` 全部改真实 ② 断言；golden 夹具去掉 synthetic 语义。
   `security-cases.test.ts`、`src/runtime/dsh/errors.ts` **未改**（禁改项；errors.ts 与未合并 #1412 解耦）。

## 本切片 NOT DONE（如实记录，不计通过）

- **③ 哨兵观测**：`sentinel_events` 无企业列/period/defVersion/status，无真实读取面 ⇒ 条目恒 0。
- **④ 参数依据**：`metric_readings` 生产者 `entity_id` 恒 `'*'`，与 ② 无连接键；无 `period` 列 ⇒ 条目恒 0。
- **`cycleVersion`**：全仓零生产者 ⇒ 恒 `null`（不作为可证字段）。
- **`evidenceId`**：④ 不产；② 的 `props.sourceIds` 指向 `scan_evidence`，与 ④ `evidenceId` 三套语义未定 ⇒ 恒 `null`。
- **`status='stale'`**：无判据 ⇒ 从契约取消（只保留 `observed|partial`；本切片产出条目恒 `observed`）。
- **真实客户库/生产部署**：未授权 ⇒ 只在 `:memory:` 验证；真实库 `props.period/defVersion` 分布未核实。

## 错误码选择（未新增码；errors.ts 未改）

- **DB 异常 ⇒ `PERSISTENCE_ERROR`**（phase `persist`，HTTP 500，`retryable:true`）：存储层失败的既有码，
  与工具逻辑错误（`TOOL_ERROR`）区分；`retryable=true` 对应 SQLite 瞬时锁/忙碌的既有语义。
- **可见性判据拒绝 ⇒ `FORBIDDEN`**（HTTP 403，`retryable:false`）：`toScanViewer` 的 `SCOPE_DENIED` 在本层
  稳定映射到既有码，不把 `EnterpriseScanError` 漏成协议层 `-32603`。

## 验证（原始输出留档 D:\tmp\cto1411\）

- `npx vitest run tests/runtime/dsh tests/mcp/http.test.ts` ⇒ **17 files / 101 tests passed**。
- `npx tsc --noEmit` ⇒ **exit 0**。
- 7 条改坏必红（逐条留原始红后恢复复绿）：①摘 graph 过滤⇒跨企业/多条红；②ctx 缺省 `'default'`⇒UNAUTHORIZED 红；
  ③`period` 常量⇒真实值/缺字段红；④`synthetic` 恒 true⇒真实来源红；⑤去掉 `truncated`⇒截断红；
  ⑥未知 problemId 返回空快照⇒DOMAIN_EMPTY 红；⑦args 校验挪到 ctx 后⇒`security-cases.test.ts` 红。

## 已知限制

- `SqliteGraphStore.queryNodes/queryEdges/getNode` 内部把 SQL 异常吞成 `[]`/`null`（既有 fail-open，不在写集），
  因此“查询层内部错误”不能在本模块区分；本模块的 `PERSISTENCE_ERROR` 覆盖取库/建 store/直查类型清单。
- 1 跳邻接只取节点（不含边信息）；`$id` 是 `graph_nodes.id`（scan 写入为 `node-<uuid>`，非业务 `$id` 词表）。
