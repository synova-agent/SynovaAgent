# AGENTS.md · src/routes/（路由面）

> 归属：**产品线** ｜ 承载包：**K1/K7/K10**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR1/7）｜ 多对多冲突：包编号小者优先（🔴 约定，不是原则——可改，只换规则不改结构；裁定 089）

## 是什么
HTTP/MCP 对外路由域（锚下 53 文件，30 天 30 commits）：im/workspace/knowledge/actions-api/department-workspace/workspaces-api（K1）＋ diagnosis（K7）＋ healthz（K10）。

## 谁改
产品线。并档段（根件 §0 口径"含 middleware"）：**`src/middleware/**`**（auth/rbac）——同一"接线"性质，不另立件。

## 怎么算完成
- 新路由＝垂直切片：**入口→交互→结果三环节缺一不可**；`grep` 调用链零结果＝未接线（WIRE CHECK 硬门禁）。
- 验收跑**真实路由**集成测试（`tests/routes/**`、`tests/l1/**`），Mock 不算。
- 权限路由：`tests/security/rbac-all-routes.test.ts` 全路由覆盖。

## 红线
后端能力≠用户可用功能（追调用链）｜ 静默降级禁止｜ 类型断言零容忍（铁律 38：as-any 家族，原文见根件 §7）｜ 与根件零重复。
