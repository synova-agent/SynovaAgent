# Task Brief: #1408 静默错误值 —— 批 C2b（nodes ×2 + 标量 ×2 + 补空壳夹具）

> 卡: **#1408**（K3 · W1-时序 · p1）｜CTO 2026-10-08 放行批 C2b（8 文件）⇒ **本批为 #1408 收尾批（29/29）**
> 声明载体: `.claude/claims/1408.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
批 A/B/复查/C1/C2a 累计 23/29；C2b 覆盖剩余 6 个（nodes ×2｜标量 ×2）+ 补 `make-or-buy` 空壳夹具。

### b) 文件审计（实跑，ref=origin/main@b280c6b53）
- 三形态（CTO 已认）：params 对象型 ×3（C2a 已做）｜**nodes 数组型 ×2**｜**标量参数型 ×2**
- `model-consistency-score`：`nodes: Array<{type: string; props: Record<string, unknown>}>` ⇒ 用**存在性**（`type`/`props`）
  · 🔴 **数值字段按节点类型而异（不可覆盖登记）**：`type='BusinessModel' ⇒ props.valueProposition`｜`type='Capability' ⇒ props.capability`
    ｜另有 `props.revenue`/`props.pricing`（收入侧）与 `props.cost`/`props.costStructure`（成本侧）—— **均无 type 判别符**
- `make-or-buy-score`：`capabilities: Array<{category: string; inHouse: boolean}>` ⇒ **无数值字段**（string/boolean）⇒ **数值检查不适用**，存在性仍管
- 标量型：`knowledge-accessibility(docCount, knowledgeCount, capabilityCount, personCount)`｜`talent-density(personCount, highSkillCount)` ⇒ **入口显式命名成对象**
- 🔴 `tests/sentinels/make-or-buy.test.ts` 原为 **2 行空壳**（门禁发现第 16 条）⇒ **本批补齐**

### c) 决策
「**数值检查不适用 ≠ 不管**」：boolean/string 字段无数值可查，但"缺字段"仍必须有信号（用 `checkRequiredFields`）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 判据对象分类（#1416）：`isCallLine` **泛化**为同时匹配两个助手（`checkFiniteInputs`/`checkRequiredFields`）
- **误报也是错**：M2-d 证明"把 string 字段放进数值检查 ⇒ 正常入参被误报 ⇒ V2-e 红"
- **手写 + 可核**：补齐夹具使 `make-or-buy` 的声明可被核验

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- extensions/sentinels/business-model-coherence/computes/model-consistency-score.ts — `checkRequiredFields(nodes, ['type','props'])`
- extensions/sentinels/make-or-buy/computes/make-or-buy-score.ts — `checkRequiredFields(capabilities, ['category','inHouse'])`
- extensions/sentinels/knowledge-accessibility/computes/compute-knowledge-accessibility.ts — 标量 → 对象 + `checkFiniteInputs` + 接口扩 warnings?
- extensions/sentinels/talent-density/computes/compute-talent-density.ts — 同上
- tests/sentinels/make-or-buy.test.ts — **补齐空壳**（正常/降级/边界/缺字段四路径）
- tests/sentinel/silent-wrong-value.test.ts — V1-e/V2-e/V3-e + isCallLine 泛化
- .claude/claims/1408.yaml + .claude/task-briefs/2026-10-08-1408-silent-wrong-value-c2b.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/agent-deployment-maturity/computes/compute-agent-deployment-maturity.ts（C2a 已合）
- 不改 extensions/sentinels/ai-investment-return/computes/compute-ai-investment-return.ts（C2a 已合）
- 不改 extensions/sentinels/financing-constraint/computes/cash-runway.ts（C1 已合）
- 不改 src/sentinel/assert-finite-inputs.ts（C2a 已合；本批只调用）
- 不改 src/sentinel/metric-readings-writer.ts（批 A 已合）
- 不改 extensions/sentinels/margin-health/computes/compute-incentive-bind.ts（已登记"不适用"）

范围外约束（非文件级）：门禁发现第 16 条（存量空壳）⇒ 交门禁治理线。

## Q3: 验收 — 入口 → 交互 → 结果
入口：4 个 compute（经 aggregate / 真实哨兵路径）。
处理：入口显式调用（存在性或数值维度）；有问题 ⇒ `degraded:true` + `signals`/`warnings`。
结果：缺字段 ⇒ 有信号；正常 ⇒ 不误报。

## Q4 契约与测试:
- 契约：`checkRequiredFields`（存在性）｜`checkFiniteInputs`（数值/有限性）
- 测试：V1-e 行为（缺 `inHouse`/缺 `type` ⇒ 信号）｜V2-e 不误报｜V3-e 覆盖率（4 个）｜夹具四路径
- 反例：M1-e 去掉一个调用 ⇒ **V1-e + V3-e 红**｜**M2-d 数值检查误用于 string ⇒ V1-e + V2-e 红（误报）**
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes + `src/sentinel/**`（共享助手）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/silent-wrong-value.test.ts tests/sentinel/assert-finite-inputs.test.ts tests/sentinels/make-or-buy.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -rn "checkFiniteInputs(\|checkRequiredFields(" extensions/sentinels/*/computes/*.ts | grep -vE ":[0-9]+:\s*(//|\*|/\*)" | grep -vE ":[0-9]+:\s*import\b" | cut -d: -f1 | sort -u | wc -l'
- [ ] verify: npx tsc --noEmit
