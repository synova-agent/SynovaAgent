# Task Brief: #1031 本体参数桥 — 类型层参数到边实例 props（CTO 乙案）

> 卡号 #1031 | 触发: K4 本体·因果边 —— ontology-loader 只取 3 字段 ⇒ transfer_function 进不了 edge.props（W2 前置） | 基线 main 5a6591c4a

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L4 本体层。声明层 = `extensions/ontology/edge-types/*.json`（55 件边类型定义）；实例层 = 边的 `props`。
`src/l4/ontology-loader.ts` 是两者唯一的类型层读取器。本任务补「声明层 → 实例层」的参数桥（读面 + 注入面），不做标定（真值属另卡）。

### b) 文件审计
实测 as_of 5a6591c4a：
- `src/l4/ontology-loader.ts:101-106` 仅取 `label`/`allowedFrom`/`allowedTo` 三字段 ⇒ 桥确实不存在。
- `EdgeTypeDef`（`:24-34`）实为 **9** 字段，且 `transfer_function`/`action_effect_lag`/`causal_strength` 三者均未声明 ⇒ 桥须连 interface 一起补。
- 三字段归属不同：`transfer_function` 顶层 55/55（占位串 52 + 散文公式 3）、`action_effect_lag` 顶层 55/55、`causal_strength` 在 `optionalProps` 内 55/55（全为描述串，类型层无数值）。
- 全仓 `grep transfer_function src/` 仅 1 处注释（`src/loops/direction-monitor.ts:312`），该文件在 main 仅 291 行 ⇒ 无既有消费者可复用。

### c) 决策
按 CTO 乙案落地：注入点取「读取时按 label 查类型层」（唯一不越界落点）；写集显式剔除 `src/loops/direction-monitor.ts`（在飞 PR #1029）。
判据②改落点为「注入面断言」，覆盖力降档写进交付件。

## Q1: 调研 — 业界最佳实践 / memory 历史教训
参考：Anthropic/DeepSeek/第一性原理 + 结论 —— 声明与数值分离，读取面返回「结构化状态」而非伪造值。
铁律 47（契约优先：先冻结 @input/@output/@degrade 再写实现）、铁律 11/24（禁静默降级：catch/降级必须 log + degraded 标记）、
铁律 38（禁 any 谎报类型，用 unknown + 运行时类型守卫）、铁律 48（测试须有 expect 且覆盖正常/降级/边界）。
历史教训：卡面引证的 G-3 出处文件不存在 ⇒ 不冒用权威出处，schema 自署名。

## Q2: 范围 — 正确的最简方案
做什么：
- src/l4/ontology-loader.ts
- tests/l4/ontology-loader-param-bridge-1031.test.ts
- docs/synova/product-lines/evidence/1031-injection-contract.md
- docs/synova/product-lines/evidence/1031-delivery.md

不做什么：
- 不改 src/loops/direction-monitor.ts
- 不改 src/adapters/sqlite-graph-store.ts
- 不改 src/init/file-driven-loaders.ts
- 不改 src/init/engine-context.ts
- 不改 src/server.ts
- 不改 src/loops/loop-scheduler.ts
- 不改 scripts/control-tower/check-ontology-fields.sh
- 不改 extensions/ontology/edge-types/constrains.json

## Q3: 验收 — 入口 → 交互 → 结果
入口：`src/l4/ontology-loader.ts` 新增 `readEdgeTypeParams`（纯）/ `getEdgeTypeParams`（按 label）/ `applyEdgeTypeParams`（纯注入）。
处理：从 edge-types JSON 读三字段 ⇒ 按 P-3 值域分类 ⇒ 仅 resolved 写入实例 props，其余走 degraded + log.warn。
结果：mock 定义下注入后 props 值正确（V1）；同 weight 同 edgeType 注入前后值不同且差值只来自参数（V2）；
真实 55 件过桥分类计数与逐件实测一致（V5/L2-真跑）；拆掉注入或拆掉 log ⇒ 必红（V4）。

## 架构层: L4（本体层）

## Done 标准
- [x] verify: npx vitest run tests/l4/ontology-loader-param-bridge-1031.test.ts 期望 23 passed / exit 0
- [x] verify: 拆掉注入（V4-BREAK-A）后重跑同上 期望 10 failed / exit 1；复原 期望 23 passed / exit 0
- [x] verify: 拆掉 log.warn（V4-BREAK-B）后重跑同上 期望 5 failed / exit 1；复原 期望 23 passed / exit 0
- [x] verify: npx tsc --noEmit 期望改动文件 0 错误（存量错误不计）
- [x] verify: git diff --cached --numstat 期望 ≤12 文件且单域（src/l4 + tests/l4 + docs/evidence）
