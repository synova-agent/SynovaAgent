# Task Brief: #1408 静默错误值 —— 批 A（margin-health 5 个 compute）

> 卡: **#1408**（K3 · W1-时序 · p1）｜CTO 2026-10-08 裁：范围 (b) + 形态 (c) + 覆盖率判据 + **V4 必须绿**
> 声明载体: `.claude/claims/1408.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
"静默错误值"（缺字段/NaN ⇒ `NaN` 或**静默默认值**，而 `degraded=false`、`warnings=[]`）⇒ **必须有信号**。

### b) 文件审计（实跑，ref=origin/main@78b75e6b2）
- compute 共 **168 个**：含 `degraded` **168/168**｜含 `warnings[]` **118/168（70%，出口条件未触发）**
  ｜🔴 含 **NaN/有限性检查 仅 2/168（1.2%）** ⇒ **166 个（99%）缺同一道检查**
- **无公共入口**：`shared/computes/index.ts` = 104 行纯导出索引（`function`/`=>` 零命中）｜共享校验器零命中
- **范围（b）**：13 个已接指标级哨兵共 **29 个 compute** ⇒ 批 A = margin-health 7 个
  · 其中 **5 个有数值入参**（接线）｜**2 个是图遍历形态**（`store, {teamId, traversal}` ⇒ **不适用**，已登记）

### c) 决策（CTO 裁）
- 形态 **(c)**：共享助手 `checkFiniteInputs(input, fields)` —— **显式调用**、**不改返回值语义**、**不是统一包装器**
- **需求声明必须手写**（只有 compute 自己知道需要哪些字段）｜**覆盖率由扫描判**（清单手写会漂）

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **判据默认断言行为**（R192）；形态扫描**只证明形态**；**V4 = 本卡存在理由**（否则与"改少一点"无异）
- **M3「只查缺字段不查 NaN 值 ⇒ V1 红」**（守"修一半"）｜**V2「正常入参不得误报」**（防"一律 degraded"）
- 实测教训：**V3 首版只扫"出现"（含 import 行）⇒ M1 假绿** ⇒ 已改扫**调用**（排除 import）

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行；**含 CTO 裁 (A) 的落库侧收口**）：
- src/sentinel/metric-readings-writer.ts — **非有限值 ⇒ 跳过 + warn（含行标识）+ 计数留痕**（CTO 裁 (A) 约束一：**跳过，不落库**）
- src/sentinel/assert-finite-inputs.ts — 新建助手（纯函数，返回问题清单）
- tests/sentinel/assert-finite-inputs.test.ts — 配对单测
- extensions/sentinels/margin-health/computes/compute-cost-per-head.ts — 显式调用（`['total_cost','head_count']`）
- extensions/sentinels/margin-health/computes/compute-fixed-variable-ratio.ts — 显式调用（`['total_revenue','gross_margin']`）
- extensions/sentinels/margin-health/computes/compute-gross-margin.ts — 同上
- extensions/sentinels/margin-health/computes/compute-margin-vs-benchmark.ts — 同上（benchmark 可选，不列入）
- extensions/sentinels/margin-health/computes/compute-profit-margin-change.ts — 同上
- tests/sentinel/silent-wrong-value.test.ts — V1/V2/V3/V4
- .claude/claims/1408.yaml + .claude/task-briefs/2026-10-08-1408-silent-wrong-value-a.md


> 🔴 本 PR 内的两处移动（`git mv`；声明闸②按「删+增」看 ⇒ 旧路径也须列明）：
> - extensions/sentinels/shared/computes/assert-finite-inputs.ts → src/sentinel/assert-finite-inputs.ts
> - tests/sentinels/shared/assert-finite-inputs.test.ts → tests/sentinel/assert-finite-inputs.test.ts

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/margin-health/computes/compute-incentive-bind.ts（图遍历形态 ⇒ **不适用**，已登记）
- 不改 extensions/sentinels/margin-health/computes/compute-metric-bind-divergence.ts（同上）
- 不改 extensions/sentinels/shared/computes/index.ts（纯导出索引，非 compute）
- 不改 extensions/sentinels/capital-health/computes/roic-wacc-spread.ts（批 B）
- 不改 src/sentinel/sentinel-loader.ts（loader 面不变）
- 其余 139 个未接线 compute ⇒ 范围外（(b) 案），覆盖面逐条声明

范围外约束（非文件级）：批 B = capital-health 9｜批 C = 其余 13 个哨兵的 compute。

## Q2b: (A) 的两条约束（CTO 裁）
① **跳过 + warn（含行标识）+ 计数留痕** —— **不许静默跳过**
② **两条防线互相独立**：compute 侧检查了 ⇒ writer 侧**仍要查**（兜底必须独立）⇒ **M1（去掉 compute 调用）仍必须红**（已复验：红 3 条）

## Q3: 验收 — 入口 → 交互 → 结果
入口：各 compute（经 aggregate / 真实哨兵路径调用）。
处理：入口**显式调用** `checkFiniteInputs`；有问题 ⇒ `degraded:true` + `warnings` 追加。
结果：缺字段/NaN ⇒ **有信号**；正常 ⇒ **不误报**；哨兵产出**值均为有限数**。

## Q4 契约与测试:
- 契约：`checkFiniteInputs(input | rows, fields) => string[]`（**不改返回值语义**、**不抛**、**不猜字段名**）
- 测试：V1 行为（缺字段/NaN ⇒ 信号）｜V2 行为（正常 ⇒ 不误报）｜V3 形态（覆盖率扫**调用**）｜V4 行为（端到端**值为有限数**）
- 反例：M1 去掉调用 ⇒ **V1 + V3 红**｜M3 助手只查缺字段 ⇒ **V1 红**
- 零 `as any` / `as never` / `as unknown as`（`as unknown as` 仅用于测试构造非法入参，**已列明**）

## 架构层: 扩展 computes（`extensions/sentinels/shared/**` + `margin-health/**`）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/silent-wrong-value.test.ts tests/sentinel/assert-finite-inputs.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -rl "checkFiniteInputs(" extensions/sentinels/margin-health/computes/ | wc -l'
- [ ] verify: npx tsc --noEmit
