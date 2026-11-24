# P0 接口门结论（ingest v0 施工前门）— 回执转写

> ⚠️ **来源声明（必读）**：本件**不是探针原始产出**。执行会话 2026-11-24 的 P0 门回执以对话形式交付，其声称的两份原始证据
> （`P0-ingest-gate-v0.md` / `P0-ingest-gaps-v0.md`）经 CTO 全盘检索（`D:\novis-backup-20260526\Novis` depth 5）**未在磁盘上找到**。
> 为防结论丢失，本件**按回执内容转写**并保留全部 `path:line`；**转写不等于原始观测**，原始件应由执行会话重新落盘后覆盖本件。

- 探针 base：`gitea/main b84f8dd`｜主树 HEAD 前后一致 `77eb430…`
- 探针性质：**只读**（未改产品代码、未落库、未联网）
- 未验证项（原回执如实登记）：未跑测试（本机无 node_modules）；未启动 API/桌面/DSH；隔离库不存在
- **结论：触发停手 —— 6 条接口中 4 条需最小适配（a/b/c/e），2 条可直接复用（d/f）⇒ 不启动 v1**

## 六行结论

| 接口 | 结论 | 关键证据 | 若需适配，最小改动 |
|---|---|---|---|
| **a) 对象/关系写入** | **需最小适配** | `src/agent/graph-store-service.ts:128-135` 硬要 `props.period`（YYYY-MM）＋`props.defVersion`，违约零写入；`:159-189` `createRelation` props 可选；反例 `tests/agent/stage2-s1-objects.test.ts:154-187` | 放宽/派生两字段；或 ingest 逐对象显式提供（资料无期间时不成立） |
| **b) 扫描断言/来源** | **需最小适配** | 表/触发器可接受：`src/store/migrations/006-enterprise-scan.ts:93,176-182`；writer `src/l4/enterprise-scan-store.ts:286-358`；但类型钉死 3 类对象/1 类关系（`src/connectors/enterprise-scan/types.ts:78,86`），端点写死（`enterprise-scan-store.ts:308-309`） | 通用 `writeAssertions`/`persistFacts` 入口；或接受脚本直写 `scan_*`（**已由 CTO 否决**） |
| **c) 指标** | **需最小适配** | 列名/写原语 `src/store/migrations/007-metric-observations.ts:42-57`、`src/sentinel/metric-observations-writer.ts:176-216`；读原语 `src/sentinel/metric-observations-reader.ts:69-89` **无生产调用方**；`SentinelContext` 无 period（`src/sentinel/types.ts:185-230`）；生产诊断调用未传 options（`src/l3/synova-diagnosis-engine-impl.ts:261`） | 给哨兵加 period 与 metric_observations 读路径（现仅"落库"可用） |
| **d) 上下文工具** | **可直接复用** | `src/runtime/dsh/domain-context.ts:127-138` 根按 `$id`/`businessKey`；`:152-165` 只返回 1 跳邻接；`:223-256` 条目需 period+defVersion；`:319-329` count=0 ⇒ insufficient；验收 `tests/runtime/dsh/domain-context-scan.test.ts:91-142` | 无需改码；ingest 须让根可解析、被返回邻接对象带 period+defVersion |
| **e) DSH 运行链** | **需最小适配** | `src/routes/dsh.ts:142-150` body 只接受 `input/runId/sessionId`；`src/runtime/dsh/session.ts:66-74` `RunRequest` 无 problemId；`src/runtime/dsh/tools.ts:26-31` `ToolCallContext` 无 problemId；M1 现状只能拼 prompt（`docs/synova/product-lines/evidence/1459-t5-realjwt/runner/m1m2-drive.mjs:61`） | 加显式 problemId 入参位（route→RunRequest→tool ctx）；**禁用 prompt 传递** |
| **f) 桌面事件链** | **可直接复用** | `src/runtime/dsh/session.ts:327-337` 发 `hypothesis.structured`；`electron-renderer/src/stores/dsh-run-store.ts:326-340` 消费；`tests/dsh-ui/dsh-hypothesis-1459.test.ts:128-176`；T-B `69d737893` / T-C `082b74093` 已在 base | 无需改码（只证链路，不证内容回指） |

## CTO 四条裁定（已写入适配票正文）

1. **只放宽 `defVersion`（系统赋 `ingest-v0`），绝不放宽 `period`**（期间必须来自资料，拿不到就不写对象）；
2. **不接受脚本直写 `scan_*`**，改为给 store 加通用 `persistFacts()`；
3. **只补哨兵读路径 + period 透传**，不改阈值判据与既有降级码；
4. **必须加 `problemId` 显式入参位**，禁止拼进 prompt（#1459 M2：让模型猜 ⇒ 10 条全空、烧 750k tokens）。

## 对本件的处置要求

执行会话应把**原始**两份证据重新落盘并替换本件；届时本件的"转写"声明随之删除。
在此之前，本件只作为**缺口与结论的存证**，不得被引用为"原始观测"。
