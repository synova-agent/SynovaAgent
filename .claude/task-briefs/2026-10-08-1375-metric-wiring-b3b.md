# Task Brief: #1375（48 哨兵指标级接线）B3b

> 卡: **#1375**（K3 · W1-时序）｜CTO 裁 (a)「每 compute 一行」+ 专项定位一轮（(b)，时间盒）
> 声明载体: `.claude/claims/1375.yaml`（S0，随批次更新）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
指标级接线第四批：**多 compute 哨兵**（每 compute 一行）。

### b) 文件审计（实跑，ref=origin/main@39264b8d2）
- 3 个多 compute 哨兵：`capital-health`（7 行）｜`growth-quality`（2 行）｜`margin-health`（5 行）
- 🔴 **专项定位（一轮内确证到 file:line）**：三处 **标识符形态返回** `return findings;`
  （`capital-health:444`｜`growth-quality:74`｜`margin-health:303`）—— 我的括号扫描只识别 `return [...]` 字面量形态
  ⇒ **该路径返回裸数组** ⇒ loader `Array.isArray(raw)` 分支 ⇒ `metrics = []` ⇒ **端到端 0 行**
  ⇒ 证据链：直调 compute ✓ 产出 ｜ 哨兵 finding ✓ 真实（`cost_per_head_critical`）｜`res.metrics` 缺键 ⇒ 定位到返回形态
- 夹具需同时满足：① 哨兵 `REQUIRED_FIELD_GROUPS`（margin-health: total_revenue/gross_margin/operating_expense）② 各 compute 输入契约

### c) 决策
按 CTO 裁 (a) 每 compute 一行；`metric_id` 命名依 **#1054 样板**（`CASH-FLOW-GROSS-MARGIN`）= `<哨兵域大写>-<FIELD 大写>`。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 规则：**对象复杂度决定端到端判据粒度**（多 compute ⇒ 先深测 + 结构面 + 显式登记）
- **闸门数 = 守卫组数 + compute 数**（入台账）
- R109 家族：判据要有真对象 ⇒ 夹具必须满足两层字段清单
- 我自己的**模式盲区**（只认 `return [` 字面量）⇒ 已列为教训：**grep 结论须分两层，且要枚举形态**

## Q2: 范围 — 正确的最简方案
做什么：
- extensions/sentinels/capital-health/aggregate.ts — 每 compute 一行 + 标识符返回转对象
- extensions/sentinels/growth-quality/aggregate.ts — 同
- extensions/sentinels/margin-health/aggregate.ts — 同
- tests/sentinel/metric-wiring-b3b.test.ts — 新建（V1 命名/唯一性 + 🔴 V2 **逐哨兵**端到端 + V2-空库）
- tests/sentinel/capital-health-degraded.test.ts — **必要连带**（包装函数归一化 object/array 两形态）
- claim + brief

不做什么（逐条含具体文件名）：
- 不改 src/sentinel/sentinel-loader.ts（loader 采集逻辑本身正确：读 `raw.metrics`）
- 不改 src/sentinel/org-scope.ts（收口点 #1393 已合）
- 不改 extensions/sentinels/knowledge-accessibility/aggregate.ts（B2 已改）
- 不改 extensions/sentinels/_extinct/**（归档）

范围外约束（非文件级）：三层字段不统一 ⇒ 另立卡（p1），**关系待核，不作 B3b 根因**（CTO 裁）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册哨兵经 `check(context)`（真路径）。
处理：每 compute 结果 ⇒ 一行 metric（degraded 的 compute 不发）；哨兵只返回数据。
结果：**逐哨兵 ≥1 行**、至少一个哨兵多行、≥1 行 `degraded=0`、行级租户正确。

## Q4 契约与测试:
- 契约：沿用 B1 `MetricRow`；命名合 #1054 样板（正则断言）
- 测试：3 例（V1 命名/同哨兵多行唯一/跨批唯一｜🔴 V2 逐哨兵端到端｜V2-空库不编造）
- 反例（实测）：M1 还原标识符返回（不带 metrics）⇒ **1 红**（逐哨兵断言）｜M2 metric_id 撞已接批次 ⇒ **1 红**｜M3 降级时发 metrics（编造）⇒ **2 红**
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
扩展哨兵（只返回数据）+ L3 loader（单点落盘，不变）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/metric-wiring-b3b.test.ts tests/sentinel/capital-health-degraded.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -c "metricsHolder.push" HEAD -- extensions/sentinels/margin-health/aggregate.ts | tr -d '\n')" -ge 5
- [ ] verify: npx tsc --noEmit
