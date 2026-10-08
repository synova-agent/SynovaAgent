# Task Brief: #1408 静默错误值 —— 批 C1（6 个 compute）

> 卡: **#1408**（K3 · W1-时序 · p1）｜CTO 2026-10-08 放行批 C（拆 C1/C2）
> 声明载体: `.claude/claims/1408.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
批 A/B 建立形态；批 C 覆盖其余 11 个已接哨兵。**C1 = 6 个**（financing-constraint 2｜growth-quality 2｜value-capture 1｜environment-rent-dependency 1）。

### b) 文件审计（实跑，ref=origin/main@a2a2c31c3）
- 13 个待接线 compute ⇒ **全部可接线**（无"图遍历形态"；含标量参数型 ×2 ⇒ 归 C2）
- 🔴 **本批踩到并修正 5 处"声明字段与真实契约不符"**（由 tsc + 既有测试夹具作 oracle）：
  | compute | 我首版声明（错） | 真实契约 |
  |---|---|---|
  | kz-index | `ebitda/total_debt/total_assets/cash` | `operatingCashFlow/netPpe/totalDebt/equity/cash` |
  | cash-runway | `operating_expense` | `operatingExpense` |
  | cash-conversion-rate | `operating_cashflow/net_income` | `operatingCashFlow/netIncome/revenue` |
  | organic-growth-pct | `total_revenue` | `revenue/previousRevenue/acquisitionRevenue` |
  | rent-dependency-index | `total_debt/equity/total_revenue` | `value`（`FinancialIndicator={type,value}` ⇒ **type 是字符串判别符，纳入会误报**） |
- 契约：3 个接口扩 `warnings?: string[]`（CashConversionResult｜OrganicGrowthResult｜CashRunwayResult 已有）｜rent-dependency-index 用既有 `signals` 承载（不新增字段）
- 🔴 助手签名 **泛型化**：`FinancialIndicator[]`（interface ⇒ **无隐式索引签名**）不可赋给 `Record<string,unknown>[]` ⇒ 改 `<T extends object>(input: T | ReadonlyArray<T>, …)`，内部**单点**窄化（普通 `as`，**非 `as unknown as`**）

### c) 决策
字段声明必须**逐字对上真实契约**（"需求声明必须手写"——**且必须写对**）；由 tsc + 既有测试当 oracle。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 存在性判断精度：本批扫描**沿用** 类级复查的 `isCallLine()`（排注释/排 import）——CTO 裁"批 C 起每批自查，不必再单独一轮"
- 教训：**声明字段写错 ⇒ 既有测试立刻红**（这是"声明面必须可被物理核验"的正面例子：夹具就是核验器）

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- src/sentinel/assert-finite-inputs.ts — 签名泛型化（接受 interface 类型）
- extensions/sentinels/financing-constraint/computes/cash-runway.ts — 接线（['cash','operatingExpense']）
- extensions/sentinels/financing-constraint/computes/kz-index.ts — 接线（['operatingCashFlow','netPpe','totalDebt','equity','cash']）
- extensions/sentinels/growth-quality/computes/cash-conversion-rate.ts — 接线（['operatingCashFlow','netIncome','revenue']）+ 接口扩 warnings?
- extensions/sentinels/growth-quality/computes/organic-growth-pct.ts — 接线（['revenue','previousRevenue','acquisitionRevenue']）+ 接口扩 warnings?
- extensions/sentinels/value-capture/computes/value-capture-score.ts — 接线（['revenue','cost','netProfit','previousRevenue']）
- extensions/sentinels/environment-rent-dependency/computes/rent-dependency-index.ts — 接线（['value']；type 不列入）
- tests/sentinel/silent-wrong-value.test.ts — 加 V1-c/V2-c/V3-c/V4-c
- .claude/claims/1408.yaml + .claude/task-briefs/2026-10-08-1408-silent-wrong-value-c1.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/agent-deployment-maturity/computes/compute-agent-deployment-maturity.ts（批 C2）
- 不改 extensions/sentinels/ai-ecosystem-fit/computes/compute-ai-ecosystem-fit.ts（批 C2）
- 不改 extensions/sentinels/ai-investment-return/computes/compute-ai-investment-return.ts（批 C2）
- 不改 extensions/sentinels/business-model-coherence/computes/model-consistency-score.ts（批 C2）
- 不改 extensions/sentinels/knowledge-accessibility/computes/compute-knowledge-accessibility.ts（批 C2，标量参数型）
- 不改 extensions/sentinels/talent-density/computes/compute-talent-density.ts（批 C2，标量参数型）
- 不改 src/sentinel/metric-readings-writer.ts（批 A 已合）
- 不改 extensions/sentinels/margin-health/computes/compute-incentive-bind.ts（已登记"图遍历形态：不适用"）

范围外约束（非文件级）：批 C2 = 剩余 7 个（params 对象型 ×3｜nodes 数组型 ×2｜标量参数型 ×2）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：上述 6 个 compute（经 aggregate / 真实哨兵路径）。
处理：入口显式调用 `checkFiniteInputs`；有问题 ⇒ `degraded:true` + `warnings`/`signals`。
结果：缺字段/NaN ⇒ 有信号；正常 ⇒ 不误报；哨兵产出值均为有限数。

## Q4 契约与测试:
- 契约：`checkFiniteInputs<T extends object>(input, fields)`（泛型；不改返回值语义；不抛；不猜字段名）
- 测试：V1-c 行为（本批样例）｜V2-c 行为（不误报）｜V3-c 形态（覆盖率扫调用）｜V4-c 行为（端到端有限数）
- 反例：M1-c 去掉一个调用 ⇒ **V1-c + V3-c 红**（已实测）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes + `src/sentinel/**`（共享助手）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/silent-wrong-value.test.ts tests/sentinel/assert-finite-inputs.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -rn "checkFiniteInputs(" extensions/sentinels/{financing-constraint,growth-quality,value-capture,environment-rent-dependency}/computes/*.ts | grep -vE ":[0-9]+:\s*(//|\*|/\*)" | grep -vE ":[0-9]+:\s*import\b" | wc -l'
- [ ] verify: npx tsc --noEmit
