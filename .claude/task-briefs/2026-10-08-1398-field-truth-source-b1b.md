# Task Brief: #1398 字段真源对齐 —— 批 1b

> 卡: **#1398**（K3 · W1-时序 · p1）｜CTO 2026-10-08 批 1b（机械重复 + **作用域切 1b** + **本批自己的实测对照**）
> 声明载体: `.claude/claims/1398.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
字段命名真源统一（真源 = 本体 schema）；本批 = A 类余下 2 字段。

### b) 文件审计（实跑，ref=origin/main@dfac2ef66）
- 本批 A 类：`marketShare→market_share`｜`routineRigidity→routine_rigidity`
- 影响面（实测）：**3 computes + 2 tests**（`compute-hhi.ts` **无字段问题**：入参 `number[]` ⇒ 不在批次内，已核）
- 本批**自己的实测对照**（CTO 要求，不复用 1a 的数）：
  · `computeLearningRate`：真源名 ⇒ `routine_rigidity=0.3`；**旧名 ⇒ 实测 `0.5`（默认值）且 `degraded=false`** ⇒ **静默替代**
  · `computeCompetitorPricingLandscape`：真源名 vs 旧名 ⇒ **返回值实测无分歧**（该字段本次未影响产出）⇒ **如实登记**

### c) 决策
同 1a 形态：改名对齐真源；**不加运行时归一化**（裁 (a)）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **"静默 NaN"已被 CTO 升格为本日第四种静默形态**（前三种：#1376 能力缺席｜#1379 读空｜#1387 traversal 早退）
  ⇒ 本批补一个同族形态：**"静默默认值"**（旧名 ⇒ 取不到 ⇒ 落默认 0.5，**无任何信号**）
- R192（行为优先 + 形态标注）｜豁免逐条登记｜每批自证

## Q2: 范围 — 正确的最简方案
做什么（逐文件显式列全；**本批 = 1b**）：
- extensions/sentinels/shared/computes/l4-competition/compute-competitor-pricing-landscape.ts — `marketShare→market_share`
- extensions/sentinels/shared/computes/l2-internal/compute-routine-rigidity.ts — `routineRigidity→routine_rigidity`
- extensions/sentinels/shared/computes/l2-value/compute-learning-rate.ts — 同上（含 JSDoc/类型/函数体 11 处）
- tests/sentinels/shared/compute-learning-rate.test.ts — 必要连带
- tests/e2e/full-pipeline.integration.test.ts — 必要连带
- tests/sentinel/field-name-alignment.test.ts — 作用域切 1b + 本批实测样例
- .claude/claims/1398.yaml + .claude/task-briefs/2026-10-08-1398-field-truth-source-b1b.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts（**入参 number[]，无字段名** —— 已核）
- 不改 extensions/sentinels/shared/computes/l2-value/compute-customer-value-score.ts（批 1a 已合）
- 不改 extensions/sentinels/shared/computes/l1-production/compute-quality-traceability.ts（批 1a 已合）
- 不改 extensions/sentinels/shared/computes/l3-output/compute-operational-execution.ts（批 1a 已合）
- 不改 extensions/sentinels/capital-health/aggregate.ts（批 2：`operatingExpenses` + 守卫派生）
- 不改 extensions/sentinels/margin-health/aggregate.ts（批 2）
- 不改 src/sentinel/org-scope.ts（**不加运行时归一化**）

范围外约束（非文件级）：守卫派生 + `operating_expenses` ⇒ 批 2；"compute 对缺失/NaN 入参无信号" ⇒ **另立卡（p1，草案已报 CTO）**。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`computeLearningRate(...)` / `computeCompetitorPricingLandscape(...)`（经真实调用方/测试）。
处理：入参字段名 = 真源 props 名。
结果：真源名 ⇒ 用传入值（0.3）；旧名 ⇒ 实测落默认（0.5，无信号）。

## Q4 契约与测试:
- 契约：字段名以真源为准（本批 2 个）
- 测试：V1 形态（标"只证明形态"）｜**V2 行为（本批实测样例）**｜V3 形态（零残留 + 豁免逐条登记）
- 反例：M1 只改 JSDoc/类型回退 ⇒ V1 红｜M2 改 compute 不改调用方 ⇒ 调用方测试红
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes（`extensions/sentinels/shared/**`）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/field-name-alignment.test.ts tests/sentinels/shared/ tests/e2e/
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/e2e/
- [ ] verify: bash -c 'git grep -n -E "\b(marketShare|routineRigidity)\b" HEAD -- extensions/ | grep -v "_extinct/" | grep -v "/skills/" | wc -l'
- [ ] verify: npx tsc --noEmit
