# Task Brief: #1398 三层字段真源对齐 —— 批 1a

> 卡: **#1398**（K3 · W1-时序 · p1）｜CTO 2026-10-08 裁 (a)(b) + 两条要求
> 声明载体: `.claude/claims/1398.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
字段命名的**真源统一**：真源 = **本体 schema**（CTO 裁 (b)）；compute 是消费者，应适配真源。

### b) 文件审计（实跑，ref=origin/main@f86445c9c）
- **分类清单（三类全覆盖，90 unique 字段）**：snake 16｜camel 30｜其它 44
  ⇒ **A 类（camel 但真源有 snake 对应，需改）= 6（+1 待确认）**｜B 24｜C 23（已对齐）｜D **0**｜E 44
- **A 类逐字段**：`churnRisk→churn_risk`｜`tenureMonths→tenure_months`（`shared/.../compute-customer-value-score.ts`）
  ｜`marketShare→market_share`（2 文件）｜`defectRate→defect_rate`（2 文件）｜`routineRigidity→routine_rigidity`（2 文件）
  ｜**`operatingExpenses→operating_expense`（人工确认 = A 类；真源单数；从 props 取值 ⇒ 改名只对齐契约名，不改行为）**
- **改名影响面**（实测）：7 computes + **4 tests** ⇒ 超预算 ⇒ **拆 1a/1b**
- **真源例外**：`resource/person.teamId`（真源内唯一 camel，是租户别名键）⇒ 保留 + `_note` 登记

### c) 决策（CTO 裁）
范围坍缩 ⇒ **A 类改名 + 守卫派生 + 一致性判据**；**去掉运行时归一化**（其余 camel 不从数据 props 取值）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **"先改到一致"优于"加一层转换"**（同 #1376 拒代理 / #1381 拒规范化层 / #1395 拒多目标写入）
- **R192**：判据默认行为断言；形态扫描写明"只证明形态"；豁免**逐条登记**（禁静默排除）
- **自动分类要留人工确认口**（`operatingExpenses` 复数未命中 ⇒ 人工并回 A 类）
- **测量假象**：`JSON.stringify(NaN)` → `null` ⇒ 首测"null"是假象，实为 **NaN**（已更正）

## Q2: 范围 — 正确的最简方案
做什么（逐文件显式列全；**本批 = 1a**：A 类 3 字段）：
- extensions/sentinels/shared/computes/l2-value/compute-customer-value-score.ts — `churnRisk→churn_risk`｜`tenureMonths→tenure_months`
- extensions/sentinels/shared/computes/l1-production/compute-quality-traceability.ts — `defectRate→defect_rate`
- extensions/sentinels/shared/computes/l3-output/compute-operational-execution.ts — `defectRate→defect_rate`（含告警文案）
- extensions/ontology/resource/person.json — 加顶层 `_note`（`teamId` 历史例外）
- tests/sentinels/shared/compute-customer-value-score.test.ts — 调用方同步（必要连带）
- tests/sentinels/shared/compute-operational-execution.test.ts — 调用方同步（必要连带）
- tests/sentinel/field-name-alignment.test.ts — 新建（V1 形态/V2 行为/V3 形态+豁免）
- .claude/claims/1398.yaml + .claude/task-briefs/2026-10-08-1398-field-truth-source.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts（批 1b：`marketShare`）
- 不改 extensions/sentinels/shared/computes/l4-competition/compute-competitor-pricing-landscape.ts（批 1b）
- 不改 extensions/sentinels/shared/computes/l2-internal/compute-routine-rigidity.ts（批 1b：`routineRigidity`）
- 不改 extensions/sentinels/shared/computes/l2-value/compute-learning-rate.ts（批 1b）
- 不改 extensions/sentinels/capital-health/aggregate.ts（批 2：`operatingExpenses`）
- 不改 extensions/sentinels/margin-health/aggregate.ts（批 2）
- 不改 src/sentinel/org-scope.ts（**不加运行时归一化** —— 裁 (a)）

范围外约束（非文件级）：守卫派生（`REQUIRED_FIELD_GROUPS` → compute 契约 ∩ 真源 props）⇒ 批 2；批 1b/批 2 随后。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`computeCustomerValueScore(...)` / `computeOperationalExecution(...)`（经真实调用方/测试）。
处理：入参字段名 = **真源 props 名**。
结果：**有数值结果**（对照旧名 ⇒ NaN）。

## Q4 契约与测试:
- 契约：字段名**以真源为准**；compute 入参 = 真源 props 名（此批 3 个）
- 测试：**V1 形态（标"只证明形态"）**：本批字段 == 真源名、无 camel 残留（豁免逐条登记）｜
  **V2 行为（实测样例）**：真源名 ⇒ 79 / 0.784；**旧名 ⇒ 实测 NaN 且 degraded=false、warnings 空（静默）**｜
  **V3 形态**：`extensions/**` 零残留（排除 `_extinct/`、`/skills/`，逐条登记）
- 反例：M1 只改 JSDoc/类型回退 ⇒ **V1 红**｜M2 改 compute 不改调用方 ⇒ **调用方测试红**（必要连带的证明）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展 computes（`extensions/sentinels/shared/**`）+ 真源注记（`extensions/ontology/**`）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/field-name-alignment.test.ts tests/sentinels/shared/
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/e2e/
- [ ] verify: bash -c 'git grep -n -E "\b(churnRisk|tenureMonths|defectRate)\b" HEAD -- extensions/ | grep -v "_extinct/" | grep -v "/skills/" | wc -l'
- [ ] verify: npx tsc --noEmit
