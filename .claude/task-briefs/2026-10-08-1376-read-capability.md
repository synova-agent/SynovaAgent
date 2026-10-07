# Task Brief: #1376（runner 侧读路径契约错配）

> 卡: **#1376**（模块 K3；服务承重件 W1-时序；p1）｜CTO 2026-10-08 放行（方案 A + rawDb 结构类型 + discoverTeams 并入）
> 声明载体: `.claude/claims/1376.yaml`（S0）+ 本 brief（组 6 载体）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
`src/sentinel/`（L3）的**读能力契约**：`runner` 把 `context.db` 设为 GraphStore 包装，而部分哨兵按 **raw `prepare`** 读
⇒ runner 路径下这些哨兵走"降级 return" ⇒ **cron 侧 0 行**（#1371 的 warn 修复暴露）。

### b) 文件审计（实跑，as_of 2026-10-08）
- **形态盘点**（分母现场取）：`extensions/sentinels/**` 活跃 **45**：仅 `queryNodes` **43**｜**raw prepare 0**｜两者都无 2（`sentinel-forecast-accuracy` / `sentinel-pricing-strategy`，点名）
- `src/` 侧 6 个 Sentinel 实现：`cash-flow`(prepare 1)｜`goal-alignment`(prepare 2)｜`integration-health`(prepare 1)｜**`helpers.discoverTeams`**(prepare 1)｜`cpc`(0，聚合器)｜`goal-sentinel`(0)
- ⇒ **raw 依赖 = 少数（3 哨兵 + 1 helper = 4 调用点，全在 `src/sentinel/adapters/`）** ⇒ A 案范围小（无需改判 B）

### c) 决策
方案 A（**显式契约**）：ctx 暴露 `graphStore` + `rawDb`（**结构类型**，只声明用到的成员）；哨兵**按需显式取用**；缺 ⇒ warn + 降级。
**拒 C**（组合对象 = 隐式形状猜测）；**B（统一读层）归 #1375**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 三约束：不改 `context.db` 形状（⇒ 旧隐式写法**继续失败、不被掩盖**）｜能力名**可静态 grep 点名**｜缺席即降级
- 铁律 11/24（不静默降级）；R61（空结果 ≠ 成功）；R143（失败要留痕）
- 铁律 38：结构类型 + 条件收窄，**无 `as any`/`as unknown as`**（沿用既有形状断言的写法）
- DSH 借鉴：**能力按名暴露，不靠隐式形状猜测**

## Q2: 范围 — 正确的最简方案
做什么：
- src/sentinel/types.ts — `SentinelContext.graphStore` / `rawDb`（结构类型 + 契约 JSDoc）
- src/sentinel/runner.ts — ctx 注入 `graphStore` / `rawDb`（生产 cron 路径）
- src/sentinel/sentinel-loader.ts — 按需路径注入（结构检测；缺席即显式 undefined）
- src/sentinel/adapters/cash-flow-sentinel.ts — 改 `context.rawDb` 显式取用
- src/sentinel/adapters/goal-alignment-sentinel.ts — 同上（2 处）
- src/sentinel/adapters/integration-health-sentinel.ts — 同上
- src/sentinel/adapters/helpers.ts — `discoverTeams` 同上（CTO 裁并入）
- tests/sentinel/read-capability.test.ts — 新建（V2/V3/边界）
- tests/sentinel/org-registry.test.ts — **必要连带**（ctxFor 路由 rawDb 桩）
- tests/sentinel/metric-readings-writer.test.ts — **必要连带**（样板 ctx +rawDb 桩）
- .claude/claims/1376.yaml
- .claude/task-briefs/2026-10-08-1376-read-capability.md

不做什么（逐条含具体文件名）：
- 不改 src/l4/data-exporter.ts（无 raw 依赖）
- 不改 src/store/migrations/002-metric-readings.ts（表定义）
- 不改 src/store/migrations/003-orgs.ts（迁移内容）
- 不改 src/security/file-guard.ts（文件写门禁）
- 不改 extensions/sentinels/**（43 个走 queryNodes ⇒ 与 GraphStore 兼容；统一读层 B 归 #1375）

范围外约束（非文件级）：`extensions/sentinels/**` 的读路径统一（B）归 #1375；哨兵类型大小写不一致（见 PR 发现）另登记。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`SentinelRunner`（cron 作业体 → `runOrgWriteRound`）。
处理：ctx 注入 `rawDb`（生产路径 this.db 是 raw 句柄）⇒ 哨兵显式取用 ⇒ 读到 `graph_nodes`。
结果：**经 runner 真路径写出 ≥1 行**（修前 0 行）且行级租户正确。

## Q4 契约与测试:
- 契约：`SentinelContext.graphStore/rawDb` 结构类型 + JSDoc（@field/@invariant/@not-here）
- 测试：3 例（V3 静态点名 / V2 runner 真路径 ≥1 行 / 边界：rawDb 缺席 ⇒ 显式降级）
- 反例（实测填表）：M1 还原错配 ⇒ 2/3 红（V3+V2）；M2 静默降级 ⇒ 1/3 红（仅边界）；M3 只加契约不注入 ⇒ **1/3 红（仅 V2，V3 保持绿）**
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
L3（`src/sentinel/`）—— 能力以**结构类型**声明（不 import better-sqlite3 类型）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/read-capability.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/
- [ ] verify: test "$(git grep -n 'context.db as { prepare' HEAD -- src/sentinel/ | wc -l)" -eq 0
- [ ] verify: npx tsc --noEmit
