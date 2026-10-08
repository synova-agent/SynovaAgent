# Task Brief: #1408 静默错误值 —— 批 C2a（params 对象型 ×3 + 助手存在性维度）

> 卡: **#1408**（K3 · W1-时序 · p1）｜CTO 2026-10-08 放行 C2a/C2b + **门禁发现第 16 条**
> 声明载体: `.claude/claims/1408.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
批 C1 累计 20/29；C2a 覆盖 **params 对象型 ×3**，并把"缺字段"维度**显式化**（供 C2b 的 nodes 数组型）。

### b) 文件审计（实跑，ref=origin/main@e6b86dc05）
- 三形态核对（CTO 已认）：**params 对象型 ×3**｜nodes 数组型 ×2｜标量参数型 ×2
- 本批 3 个的真实 params（逐字）：
  · `agent-deployment-maturity`：`agentCount/autonomyLevel/monitoredAgents/totalAgents/recentErrors/totalOperations`（6）
  · `ai-ecosystem-fit`：`apiCompatible/totalApis/platformsCovered/totalPlatforms/devEcosystemScore`（5）
  · `ai-investment-return`：`costSaved/revenueUplift/totalInvestment/paybackMonths`（4）
- 契约：3 个结果接口**无 `warnings`** ⇒ 扩 `warnings?: string[]`
- 🔴 **V4-d（端到端）本批不可判**（实测）：夹具 `Tool{tid,aiEnabled,costSaving,revenueUplift,investment}` ⇒ `queryNodes('Tool',{tid})`=1 ✓，
  但 `sentinel-ai-investment-return.check(...)` ⇒ `{ok:true, findings:0, degraded:true}` ⇒ **metric_readings 0 行**
  ⇒ 属**已知族**「**接线 ≠ 端到端可产出**」（同 #1375 B3b）⇒ 按 CTO 裁定"夹具/产出条件不足 ⇒ **停下报我，不硬凑**"⇒ **不写该判据，登记**

### c) 决策
- params 对象型 ⇒ **逐字段名声明 + `checkFiniteInputs(params, [...])`**（同前 20 个，无需新机制）
- 助手新增 **`checkRequiredFields`**（存在性维度）：**"缺字段"今天本就混在返回文案里 ⇒ 显式化 = 可单独断言**（CTO 裁 (a)）

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 判据对象分类（类级复查 #1416）：本批扫描沿用 `isCallLine`（排注释/排 import）
- **不适用 ≠ 不管**：boolean/string 字段无数值可查 ⇒ **存在性仍要管**（C2b 用 `checkRequiredFields`）
- **不写会永远通过的假判据**（R109）：V4-d 不可判 ⇒ **登记而非假过**

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- src/sentinel/assert-finite-inputs.ts — 新增 `checkRequiredFields<T extends object>(input, fields): string[]`（存在性维度；不改既有签名）
- tests/sentinel/assert-finite-inputs.test.ts — 加存在性维度用例（含 `false` 是合法值）
- extensions/sentinels/agent-deployment-maturity/computes/compute-agent-deployment-maturity.ts — 接线（6 字段）+ 接口扩 warnings?
- extensions/sentinels/ai-ecosystem-fit/computes/compute-ai-ecosystem-fit.ts — 接线（5 字段）+ 接口扩 warnings?
- extensions/sentinels/ai-investment-return/computes/compute-ai-investment-return.ts — 接线（4 字段）+ 接口扩 warnings?
- tests/sentinel/silent-wrong-value.test.ts — V1-d/V2-d/V3-d（+ V4-d 登记）
- .claude/claims/1408.yaml + .claude/task-briefs/2026-10-08-1408-silent-wrong-value-c2a.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/business-model-coherence/computes/model-consistency-score.ts（C2b）
- 不改 extensions/sentinels/make-or-buy/computes/make-or-buy-score.ts（C2b）
- 不改 extensions/sentinels/knowledge-accessibility/computes/compute-knowledge-accessibility.ts（C2b）
- 不改 extensions/sentinels/talent-density/computes/compute-talent-density.ts（C2b）
- 不改 tests/sentinels/make-or-buy.test.ts（空壳 ⇒ C2b 补齐）
- 不改 src/sentinel/metric-readings-writer.ts（批 A 已合）

范围外约束（非文件级）：门禁发现第 16 条（"新文件"限定 ⇒ 存量空壳永久存活）⇒ 交门禁治理线。

## Q3: 验收 — 入口 → 交互 → 结果
入口：3 个 params 对象型 compute（经 aggregate / 真实哨兵路径）。
处理：入口显式调用 `checkFiniteInputs(params, [...])`；有问题 ⇒ `degraded:true` + `warnings`。
结果：缺字段/NaN ⇒ 有信号；正常 ⇒ 不误报。（端到端产出行：本批 3 哨兵实测 0 行 ⇒ **另案**）

## Q4 契约与测试:
- 契约：`checkFiniteInputs`（数值维度，既有）｜`checkRequiredFields`（**存在性**维度，新增、同族、向后兼容）
- 测试：V1-d 行为（本批样例：NaN ⇒ 非有限数｜缺字段 ⇒ 缺字段）｜V2-d 不误报｜V3-d 覆盖率｜存在性维度单测
- 反例：M1-d 去掉一个调用 ⇒ **V1-d + V3-d 红**（已实测）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes + `src/sentinel/**`（共享助手）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/silent-wrong-value.test.ts tests/sentinel/assert-finite-inputs.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -rn "checkFiniteInputs(" extensions/sentinels/{agent-deployment-maturity,ai-ecosystem-fit,ai-investment-return}/computes/*.ts | grep -vE ":[0-9]+:\s*(//|\*|/\*)" | grep -vE ":[0-9]+:\s*import\b" | wc -l'
- [ ] verify: npx tsc --noEmit
