# Task Brief: #1398 字段真源对齐 —— 批 2

> 卡: **#1398**（K3 · W1-时序 · p1）｜CTO 2026-10-08 裁 (a)（守卫 = 显式声明 + 强制对齐真源）｜(b) 登记为将来方向
> 声明载体: `.claude/claims/1398.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
字段真源对齐**收尾批**：`operatingExpenses → operating_expense`（真源 `outcome/financial` 作单数）。

### b) 文件审计（实跑，ref=origin/main@b022f5646）
- **改名对象**：`operatingExpenses`（camel/复数）→ `operating_expense`（真源名）
- 🔴 **声明面实测 = 21 文件**（远超预期清单 7）：
  · 产品：capital-health（aggregate + roic-wacc-spread）｜margin-health（aggregate + 4 computes）
  · **src 侧调用方**：`src/sentinel/adapters/cash-flow-sentinel.ts`（5 处）
  · **12 个调用方测试**（`tests/sentinels/**`：capital-health｜cost-health｜margin-health｜profit-health｜capital-efficiency…）
  · 判据 2 + claim/brief
- **本批自己的实测样例**：`computeFixedVariableRatio` 真源名 ⇒ 0.1875；旧名 ⇒ **NaN**（degraded=false、warnings=[]）
  ｜`computeRoicWaccSpread` 真源名 ⇒ **-0.075**；旧名 ⇒ **-0.05**（**错数，非 NaN**，degraded=false）⇒ **"看起来合理的错值"**
- **守卫**：capital-health 5 + margin-health 3 字段**全部 ∈ 真源 props**（不在者 0）

### c) 决策
- 守卫按 CTO 裁 (a)：**显式声明 + 判据强制对齐真源**（原裁定"从 compute 契约派生"**不可执行**：实测契约不可机读）
- 🔴 覆盖面须写 **"反向不可判"**（哪些真源字段该被守卫却不在清单 ⇒ 本判据判不出；需 (b) 可机读契约 ⇒ 已登记）

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **实测推翻 CTO 裁定**（契约不可机读）⇒ 以实测为准（R100）
- **静默错误值**（#1408）：本批实测到**两种**（NaN ｜ 错数）⇒ 两者 `degraded=false`
- 判据边界要写明（"证明什么、不证明什么"）；豁免逐条登记

## Q2: 范围 — 正确的最简方案
做什么（**21 文件**，逐条已在 claim 列全）：
- extensions/sentinels/capital-health/aggregate.ts｜computes/roic-wacc-spread.ts
- extensions/sentinels/margin-health/aggregate.ts｜computes/{compute-cost-per-head,compute-fixed-variable-ratio,compute-margin-vs-benchmark,compute-profit-margin-change}.ts
- src/sentinel/adapters/cash-flow-sentinel.ts（**src 侧调用方**）
- 12 × tests/sentinels/**（调用方测试；含 capital-efficiency / cost-health / profit-health / margin-health）
- tests/sentinel/field-name-alignment.test.ts（作用域切批 2）｜tests/sentinel/guard-field-alignment.test.ts（新）
- .claude/claims/1398.yaml + 本 brief

不做什么（逐条含具体文件名）：
- 不改 tests/contract/l4-contract.test.ts（🔴 **在 main 上已红**（5 failed）—— 属 **#1395 遗留**，本批**不并入**，已另行报 CTO）
- 不改 extensions/sentinels/_extinct/**（归档；其中仍是旧名）
- 不改 extensions/ontology/**/*.json 的 props 命名（**真源不改**）
- 不改 src/sentinel/org-scope.ts（不加运行时归一化）

范围外约束（非文件级）：(b) 可机读契约 ⇒ 将来方向（挂 #1408）；l4-contract 遗留红 ⇒ 另裁。

## Q3: 验收 — 入口 → 交互 → 结果
入口：capital-health / margin-health 的 compute 调用（含 `src/sentinel/adapters/cash-flow-sentinel.ts`）。
处理：入参字段名 = 真源名 `operating_expense`。
结果：产出正常（对照旧名：NaN 或错数，且无信号）。

## Q4 契约与测试:
- 契约：字段名以真源为准；**守卫显式声明 + 强制对齐**
- 测试：V1（形态·只证明形态：本批字段 == 真源名）｜🔴 V2（行为·本批实测样例：0.1875 vs NaN；-0.075 vs -0.05）｜V3（守卫 ∈ 真源 props；**反向不可判**已声明）｜M1/M2
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes + 真源对齐；src/sentinel/adapters（调用方同步）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/field-name-alignment.test.ts tests/sentinel/guard-field-alignment.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/e2e/
- [ ] verify: bash -c 'grep -rl operatingExpenses --include="*.ts" src/ tests/ extensions/ | grep -v _extinct | wc -l'
- [ ] verify: npx tsc --noEmit
