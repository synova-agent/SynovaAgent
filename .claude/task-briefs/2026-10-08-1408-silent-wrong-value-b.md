# Task Brief: #1408 静默错误值 —— 批 B（capital-health 9 个 compute）

> 卡: **#1408**（K3 · W1-时序 · p1）｜CTO 2026-10-08 放行批 B｜形态沿用 (c)：共享助手 + 显式调用 + 覆盖率判据
> 声明载体: `.claude/claims/1408.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
批 A 已建立形态（`src/sentinel/assert-finite-inputs.ts` 共享助手 + writer 侧落库闸）；批 B 按同形态覆盖 capital-health。

### b) 文件审计（实跑，ref=origin/main@9493640f9）
- capital-health 的 compute = **9 个**（asset-turnover｜capital-turnover｜cash-conversion-cycle｜debt-equity-ratio｜
  debt-structure｜interest-coverage｜receivable-turnover｜roic-wacc-spread｜wacc）⇒ **全部有数值入参**（无"不适用"）
- 入参形态：**7 个取 `financials` 数组**｜**2 个取对象**（`cash-conversion-cycle.fin`｜`debt-structure.fin`）
- 契约缺口：**5 个结果接口无 `warnings`**（asset-turnover｜capital-turnover｜debt-equity-ratio｜interest-coverage｜receivable-turnover）
  ⇒ 小幅扩契约 `warnings?: string[]`（使信号可观测；不改变既有字段语义）

### c) 决策
逐 compute 显式声明必需字段（"需求声明必须手写"）；覆盖率由扫描判（"清单不手写"）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 沿用批 A 已裁形态（(c) + 覆盖率）；**本批自己的实测样例**（不复用批 A 的数）
- 教训沿用：**扫"调用"而非"出现"**（import 行会假绿）；**空数组不报**（交回各 compute 自己的"无数据"守卫）

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- extensions/sentinels/capital-health/computes/asset-turnover.ts — 接线（['total_revenue','total_assets']）+ 接口扩 warnings?
- extensions/sentinels/capital-health/computes/capital-turnover.ts — 接线（['total_revenue']）+ 接口扩 warnings?
- extensions/sentinels/capital-health/computes/cash-conversion-cycle.ts — 接线（fin：['cogs','inventory','receivables','accounts_payable','total_revenue']）
- extensions/sentinels/capital-health/computes/debt-equity-ratio.ts — 接线（['total_debt','equity']）+ 接口扩 warnings?
- extensions/sentinels/capital-health/computes/debt-structure.ts — 接线（fin：['short_term_debt','total_debt']）
- extensions/sentinels/capital-health/computes/interest-coverage.ts — 接线（['operating_cashflow','interest_expense']）+ 接口扩 warnings?
- extensions/sentinels/capital-health/computes/receivable-turnover.ts — 接线（['total_revenue','receivables']）+ 接口扩 warnings?
- extensions/sentinels/capital-health/computes/roic-wacc-spread.ts — 接线（['total_revenue','cogs','operatingExpenses']）
- extensions/sentinels/capital-health/computes/wacc.ts — 接线（['equity','total_debt','tax_rate']）
- tests/sentinel/silent-wrong-value.test.ts — 加 V1-b/V2-b/V3-b/V4-b
- .claude/claims/1408.yaml + .claude/task-briefs/2026-10-08-1408-silent-wrong-value-b.md

不做什么（逐条含具体文件名）：
- 不改 src/sentinel/assert-finite-inputs.ts（批 A 已合 9493640f9；本批只调用）
- 不改 src/sentinel/metric-readings-writer.ts（批 A 已合；落库闸不需改）
- 不改 extensions/sentinels/margin-health/computes/compute-gross-margin.ts（批 A 已接线）
- 不改 extensions/sentinels/capital-health/aggregate.ts（聚合面不变）
- 不改 extensions/sentinels/shared/computes/index.ts（纯导出索引）
- 不改 extensions/sentinels/capital-health/computes/*.test.ts（既有测试不动；新判据在 tests/sentinel/）

范围外约束（非文件级）：批 C = 其余 11 个已接哨兵的 compute（13 个，再拆 C1/C2）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：capital-health 的 compute（经 aggregate / 真实哨兵路径）。
处理：入口显式调用 `checkFiniteInputs`；有问题 ⇒ `degraded:true` + `warnings`。
结果：缺字段/NaN ⇒ 有信号；正常 ⇒ 不误报；哨兵产出值均为有限数。

## Q4 契约与测试:
- 契约：5 个接口 + `warnings?: string[]`（**可选**，不改变既有字段；JSDoc 已注明 #1408 来源）
- 测试：V1-b 行为（本批样例）｜V2-b 行为（不误报）｜V3-b 形态（覆盖率扫**调用**）｜V4-b 行为（端到端有限数）
- 反例：M1-b 去掉一个调用 ⇒ **V1-b + V3-b 红**（已实测）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes（`extensions/sentinels/capital-health/**`）；助手在 `src/sentinel/**`（批 A 已合）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/silent-wrong-value.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -rl "checkFiniteInputs(" extensions/sentinels/capital-health/computes/ | wc -l'
- [ ] verify: npx tsc --noEmit
