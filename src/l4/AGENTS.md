# AGENTS.md · src/l4/（本体与知识权限代码域）

> 归属：**产品线** ｜ 承载包：**K4/K8/K12（＋RETIRED）**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR1/7）｜ 多对多冲突：包编号小者优先（🔴 约定，不是原则——可改，只换规则不改结构；裁定 089）

## 是什么
本体/因果边/图存储与 L4 权限过滤代码落点（锚下 27 文件）：`sqlite-graph-store`、`knowledge-store`、`sog-schema-validator`、`traversal-permission-filter`、`graph-bridge`、`decision-capture`、`goal-alignment`。

## 谁改
产品线。
⚠️ `src/l4/knowledge-store.ts` 与 `tests/l4/**` 含 **RETIRED 项**（保留 id 防撞号）——改动前先查登记件块归属，勿按目录名推断。

## 怎么算完成
- 图存储改动：`graph_nodes/graph_edges` 判据（`RowsGt`）＋`tests/adapters/**` 绿。
- 权限改动：`tests/l4/knowledge-scope`、`traversal-permission-filter` 两测绿（跨部门不可见为验收）。
- schema 变更：SOG validator 先红后绿（契约优先）。

## 红线
`check-architecture.sh` 五层边界（import 方向；≠宪章层）｜ 数据面回滚＝全量快照非包级（rollback.ts 账外，归块已裁 K10）｜ 与根件零重复。

## 🔗 改本域涉及的包（双向清单 · 2026-10-18）

P1

> 口径：与 `handbook 包/交叉矩阵-12守则×10包.md` 一致；`👁`=只读不改
