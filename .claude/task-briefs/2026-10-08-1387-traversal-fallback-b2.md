# Task Brief: #1387（traversal 早退守卫 · 机制③）B2

> 卡: **#1387**（K3 · W1-时序 · p1）｜依 **B1 已验模板**（CTO 放宽停等：改法固化 ⇒ 可连做，但每批报）
> 声明载体: `.claude/claims/1387b2.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
机制③（代码路径主动返回空）的**第二批**：照 B1 模板（try 包 traverse ⇒ 失败 warn 退回；未命中 **不早退** + 留痕）。

### b) 文件审计（实跑，ref=origin/main@d09cc8f3d）
- 余下静默早退 **14 个**（17 − B1 已改 3）；**形态核验**：14 个全部为**纯"预检门"**（守卫后即 `queryNodes` 读；`usedTraversal=0`）⇒ **未触发停下条件 ①**
- 边名：全部 `['DEPLOYS']`（13 个 `[teamId]` 起始｜3 个 `[tid]` 起始）
- 本批 5 个：`api-coverage`｜`data-health`｜`explore-exploit-balance`｜`human-agent-boundary`（`[tid]` 起始）｜`make-or-buy`

### c) 决策
照 B1 模板逐文件替换守卫（含**边界注释**：① warn 不置 degraded｜② 读空才置 degraded）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 放宽停等：改法已固化（模板 + 边界注释 + 判据三件在 B1 验过）⇒ 重复劳动不需重复审批
- **三条停下条件**不可松：① 形态不同 ② 判据全红 ③ 无覆盖面
- 判据要**行为可测**（不只看源码字符串）：B2 新增**计数读探针**（"不早退 = 它继续读了"）

## Q2: 范围 — 正确的最简方案
做什么：
- extensions/sentinels/api-coverage/aggregate.ts — 守卫替换
- extensions/sentinels/data-health/aggregate.ts — 同
- extensions/sentinels/explore-exploit-balance/aggregate.ts — 同
- extensions/sentinels/human-agent-boundary/aggregate.ts — 同
- extensions/sentinels/make-or-buy/aggregate.ts — 同
- tests/sentinel/traversal-fallback-b2.test.ts — 新建（V1/V2①/V2①-b/V2②）
- .claude/claims/1387b2.yaml
- .claude/task-briefs/2026-10-08-1387-traversal-fallback-b2.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/agent-deployment-maturity/aggregate.ts（B1 已改，勿动）
- 不改 extensions/sentinels/business-model-coherence/aggregate.ts（参照实现）
- 不改 src/sentinel/sentinel-loader.ts（loader 行为不变）
- 不改 src/l4/graph-traversal.ts（遍历实现不变）
- 不改 src/store/migrations/002-metric-readings.ts（表定义）

范围外约束（非文件级）：余 9 个静默早退 ⇒ B3…；指标级接线归 #1375 批次。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册的哨兵经 `check(context)`（真路径，loader 总传 traversal）。
处理：traverse 未命中 ⇒ warn(reason='traversal-no-edge') + **继续读**。
结果：无匹配边不再空转；空库不编造。

## Q4 契约与测试:
- 契约：留痕粒度边界入实现注释（warn 不置 degraded；读空才置）
- 测试：4 例（V1 零残留 regex / V2① 5 个不抛 / **V2② 计数读探针（不早退）** / V2①-b 不编造）
- 反例（实测）：M1 还原静默早退 ⇒ 2 红（V1+V2②）｜M2 删 warn（最小注入）⇒ 1 红（V1）
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
扩展哨兵（读路径行为与留痕）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/traversal-fallback-b2.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -c "traversal-no-edge" HEAD -- extensions/sentinels/api-coverage/aggregate.ts | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
