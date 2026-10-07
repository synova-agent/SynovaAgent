# Task Brief: #1387（traversal 早退守卫 · 机制③）B1

> 卡: **#1387**（模块 K3；服务承重件 W1-时序；p1）｜CTO 2026-10-08 放行（(b) 退回 + 留痕）
> 声明载体: `.claude/claims/1387.yaml`（S0）+ 本 brief（组 6 载体）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
静默空读的**第三种机制**：代码路径**主动返回空**（`if (!r.nodes[0]) return []`）。
前两种已修：① 能力缺席 ⇒ #1376｜② 读空 ⇒ #1379 V3。

### b) 文件审计（实跑，ref=origin/main@f795a0dc7）
- 含 `traversal.traverse` 的活跃哨兵 **44**；**静默早退 17 个**；**带回退 17 个**（参照实现）
- loader **总是**构造并传入 traversal（`sentinel-loader.ts:283`）⇒ 守卫**总被求值**
- 本批 3 个（与 #1375 第一批对齐）：`agent-deployment-maturity`｜`ai-ecosystem-fit`｜`ai-investment-return`（守卫行各 1，形态完全相同）
- 🔴 关键观察：这 3 个的 traversal 只是**预检门**（数据随后一律来自 `s.queryNodes(…)`）⇒ 早退**没有理由**

### c) 决策
照 **`business-model-coherence` 的"带回退"模板**（已过生产验证）：try 包住 traverse ⇒ 失败 warn + 退回；未命中 **不早退** + 留痕。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 边界：**留痕 ≠ 降级**（走备用路径正常 ⇒ warn；没数据才 degraded）
- 参照实现优先（不另造回退风格 —— 今天是"两套"的教训）
- 内联 vs 抽工具：3 处内联；**>5 处再抽 `src/sentinel/`**（阈值化，不是"以后再说"）
- 第 12 类「判据对象是替身」⇒ 明说被测对象 = **哨兵的产出与留痕**

## Q2: 范围 — 正确的最简方案
做什么：
- extensions/sentinels/agent-deployment-maturity/aggregate.ts — 守卫替换（退回 + 留痕 + 空读守卫）
- extensions/sentinels/ai-ecosystem-fit/aggregate.ts — 同
- extensions/sentinels/ai-investment-return/aggregate.ts — 同
- tests/sentinel/traversal-fallback-b1.test.ts — 新建（V1/V2①/V2①-b/V2②）
- .claude/claims/1387.yaml
- .claude/task-briefs/2026-10-08-1387-traversal-fallback-b1.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/business-model-coherence/aggregate.ts（**参照实现**，不动作）
- 不改 src/sentinel/sentinel-loader.ts（loader 行为不变）
- 不改 src/l4/graph-traversal.ts（遍历实现不变）
- 不改 src/store/migrations/002-metric-readings.ts（表定义）
- 不改 extensions/sentinels/_extinct/**（归档）

范围外约束（非文件级）：其余 14 个静默早退哨兵 ⇒ B2… 批次另开卡；共享守卫工具（>5 处重复时）另议。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册的哨兵经 `check(context)`（真路径；loader 总传 traversal）。
处理：traverse 未命中 ⇒ **warn + 退回旧路径**（不早退）；退回后读空 ⇒ **warn + degraded + 不发 metrics**。
结果：无匹配边仍有产出（若 store 有数据）；库空 ⇒ **不编造** metric 行。

## Q4 契约与测试:
- 契约：留痕粒度边界写入实现注释（warn 不置 degraded；读空才置）
- 测试：4 例（V1 零残留 + 边界注释 / V2① 不早退且产出 / V2①-b 空库不编造 / V2② 三哨兵可加载）
- 反例（实测）：M1 还原静默早退 ⇒ 2 红（V1+V2①）｜M2 删 warn（最小注入）⇒ 1 红（V1）｜M3 删空读守卫 ⇒ 1 红（V2①-b）
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
扩展哨兵（只改读路径行为与留痕；不改架构）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/traversal-fallback-b1.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -c "traversal-no-edge" HEAD -- extensions/sentinels/agent-deployment-maturity/aggregate.ts | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
