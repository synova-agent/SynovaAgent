# Task Brief: #1375（48 哨兵指标级接线）B3a

> 卡: **#1375**（K3 · W1-时序）｜CTO 裁 B3"全取 6"；实测 3 个为多 compute ⇒ 本批接 3 个单 compute
> 声明载体: `.claude/claims/1375.yaml`（S0，随批次更新）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
指标级接线第三批（A2 形态：哨兵只返回 metrics，loader 单点落盘）。

### b) 文件审计（实跑，ref=origin/main@65e805f15）
- 读取面复核（**按 #1393 后口径重算**：字面量有写入者 **或** 映射目标有写入者）⇒ 可读 **6**：
  `capital-health`｜`environment-rent-dependency`｜`financing-constraint`｜`growth-quality`｜`margin-health`｜`value-capture`（全部读 `Financial` ⇒ 经映射到 `resource/money`，csv-import 有写入者）
- 🔴 **形态分类**：单 compute **3**（`environment-rent-dependency`｜`financing-constraint`｜`value-capture`）｜**多 compute 3**（`capital-health`：wacc/spread/ct/de｜`growth-quality`：ccr/ogr｜`margin-health`：gm/fr/cph/pm 等）
- 数差口径（CTO 要求说明）：
  · **B2 口径** = `computes=1` 候选（当时 24 ⇒ 现 20）⇒ 含读不到 **18**（`Event 11/Tool 5/Client 5/Process 4`）
  · **B3 口径** = **全部未接线且有读取**（候选 31）⇒ 含读不到 **25**（`Event 13/Tool 8/Client 7/Process 5`）
  · ⇒ **同一判据、不同集合**（B3 放宽到含 computes≥2）⇒ 分项变大只因集合变大

### c) 决策
本批接 3 个单 compute；多 compute 3 个**待"哪个值作指标"的规则**（已报 CTO：a) 每 compute 一行 b) 只发主指标 c) 其他）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **判据随前置卡重算**（CTO 本轮立规）：#1393 落地 ⇒ "可读"定义变了 ⇒ 不许套用上一批判据
- R42：两组数必须能互相解释（本文已写口径）
- R178：短路声明（本批 V2①-b **有对象** ⇒ 非短路）

## Q2: 范围 — 正确的最简方案
做什么：
- extensions/sentinels/environment-rent-dependency/aggregate.ts — 返回 { findings, metrics }
- extensions/sentinels/financing-constraint/aggregate.ts — 同
- extensions/sentinels/value-capture/aggregate.ts — 同（含 degraded 早退转对象形态）
- tests/sentinel/metric-wiring-b3.test.ts — 新建（V1 含**跨批唯一**断言 / V2 / V2①-b）
- claim（更新）+ brief（新增）

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/capital-health/aggregate.ts（多 compute ⇒ 待规则）
- 不改 extensions/sentinels/growth-quality/aggregate.ts（同）
- 不改 extensions/sentinels/margin-health/aggregate.ts（同）
- 不改 src/sentinel/sentinel-loader.ts（单点落盘不变）
- 不改 src/sentinel/org-scope.ts（收口点 #1393 已合）

范围外约束（非文件级）：多 compute 的"指标选择规则"由 CTO 裁；(iii) 补写入者见 #1395。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册哨兵经 `check(context)`（真路径）。
处理：哨兵返回 { findings, metrics }；loader 生成 R4 + 统一写。
结果：metric 行落地（≥1 行 degraded=0），行级租户正确。

## Q4 契约与测试:
- 契约：沿用 B1 的 `MetricRow`（结构类型）；哨兵不碰库
- 测试：3 例（V1 覆盖面+形态+**跨批 metric_id 唯一** / 🔴 V2 真路径 + ≥1 行 degraded=0 / V2①-b 不编造）
- 反例（实测）：M1 哨兵不返回 metrics ⇒ **2 红**｜M2 metric_id 撞已接批次 ⇒ **1 红**（跨批断言）｜M3 降级分支发 metrics（编造）⇒ **1 红**
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
扩展哨兵（只返回数据）+ L3 loader（单点落盘，不变）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/metric-wiring-b3.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -c "metricsHolder" HEAD -- extensions/sentinels/value-capture/aggregate.ts | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
