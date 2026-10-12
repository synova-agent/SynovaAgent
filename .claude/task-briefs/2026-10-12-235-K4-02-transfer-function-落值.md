# Task Brief: #235 K4-02 — 52 条 `transfer_function` 落值（13 公式 + 39 unknown）

> 分支：`k4b3/234`（与 #234 同分支、**串行**：两卡共写同一探针）｜ base：`ba1b22a8b5` ｜ 工作树：`D:\k4b3-l2-234-235`
> 实施：impl-b ｜ 2026-10-12 ｜ 本件为**当日（2026-10-12）brief**，与 `2026-10-12-234-K4-01-值域迁移.md` 同型同日。

## Q0: 定位 — 项目拼图 + 文件审计

**a) 项目拼图**：本体层因果边（42 边 / 56 件 edge-type）的 `transfer_function`（传导函数）在 #987/#988 时被批量置为
`"TBD — to be defined in compute phase"`（52 条占位）。本卡把占位串**落成真值或显式未知**：能拿到仓内权威依据的照抄权威，
拿不到的显式 `unknown`（纪律「不许自填」）。层级 = 本体层（数据面 + 控制塔防线面）。

**b) 文件审计**（实测）：`extensions/ontology/edge-types/` = 56 件；`transfer_function` 占位串（TBD）= **52**；
非占位 4 件 = `brand_builds` / `couples` / `cumulative_learning`（真公式，非本权威来源）+ `goal_decomposition`（结构性 N/A）。

**c) 决策**：复用 #234 已建的探针（`scripts/control-tower/probe-ontology-values.ts`）扩一条判定面，
**运行时真读**权威01 第二章并**逐字**比对（不落冻结副本，防文档改版后静默漂移）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

**a)** 传导函数应可追溯到**单一权威源**；不可执行/未标定的取值必须**显式降级**而非留占位。
**b)** SPEC（权威01 第二章 `### E-NN: NAME` → `**transfer_function**：` 代码块）→ 测试（真读盘 + 逐字比对 + 反例造红）→ 实现 → 接线 → 验证。
**c)** memory 教训：铁律 11/24/31（静默降级禁止）；**纪律「不许自填」**（自填比 unknown 更危险）；
#235 口径 = **E 号名精确命中**，**禁语义近邻放宽**（与 #234 的「E 号覆盖」口径**不同源**，各自带口径名）。

## Q2: 范围

**做什么**（**逐条裸路径**，禁 glob；= `.claude/claims/235.yaml` 的 writeset，**63 条**）：
- .claude/claims/234.yaml
- .claude/claims/235.yaml
- .claude/task-briefs/2026-10-12-234-K4-01-值域迁移.md
- docs/synova/product-lines/evidence/K4-b3-234-值域迁移-20261012.md
- docs/synova/product-lines/evidence/K4-b3-235-transfer-function-20261012.md
- extensions/ontology/edge-types/assumption_triggered_reallocation.json
- extensions/ontology/edge-types/augments.json
- extensions/ontology/edge-types/brand_building.json
- extensions/ontology/edge-types/capital_acquisition.json
- extensions/ontology/edge-types/capital_allocation.json
- extensions/ontology/edge-types/capital_source_mix.json
- extensions/ontology/edge-types/channel_delivery.json
- extensions/ontology/edge-types/competitive_positioning.json
- extensions/ontology/edge-types/constrains.json
- extensions/ontology/edge-types/cross_functional_synergy.json
- extensions/ontology/edge-types/customer_data_loop.json
- extensions/ontology/edge-types/customer_lockin.json
- extensions/ontology/edge-types/data_collection.json
- extensions/ontology/edge-types/decision_authority.json
- extensions/ontology/edge-types/decision_concentrates.json
- extensions/ontology/edge-types/demand_to_spec.json
- extensions/ontology/edge-types/deploys.json
- extensions/ontology/edge-types/efficiency_attraction.json
- extensions/ontology/edge-types/environmental_scan.json
- extensions/ontology/edge-types/equipment_acquisition.json
- extensions/ontology/edge-types/external_assumption.json
- extensions/ontology/edge-types/external_feedback.json
- extensions/ontology/edge-types/funds.json
- extensions/ontology/edge-types/incentive_alignment.json
- extensions/ontology/edge-types/incentive_binds.json
- extensions/ontology/edge-types/information_flow.json
- extensions/ontology/edge-types/innovation_output.json
- extensions/ontology/edge-types/knowledge_reuse.json
- extensions/ontology/edge-types/knowledge_sharing.json
- extensions/ontology/edge-types/locks_in.json
- extensions/ontology/edge-types/market_share_capture.json
- extensions/ontology/edge-types/operational_execution.json
- extensions/ontology/edge-types/organizational_learning.json
- extensions/ontology/edge-types/procurement_bargaining.json
- extensions/ontology/edge-types/produces.json
- extensions/ontology/edge-types/profit_reinvestment.json
- extensions/ontology/edge-types/reputation_attraction.json
- extensions/ontology/edge-types/reputation_flywheel.json
- extensions/ontology/edge-types/retention_protects_knowledge.json
- extensions/ontology/edge-types/routine_rigidity.json
- extensions/ontology/edge-types/rule_constraint.json
- extensions/ontology/edge-types/sensing_calibration.json
- extensions/ontology/edge-types/service_support.json
- extensions/ontology/edge-types/signal_transmits.json
- extensions/ontology/edge-types/signal_upward_pass.json
- extensions/ontology/edge-types/talent_acquisition.json
- extensions/ontology/edge-types/talent_deployment.json
- extensions/ontology/edge-types/talent_filter.json
- extensions/ontology/edge-types/talent_retention.json
- extensions/ontology/edge-types/tech_infrastructure.json
- extensions/ontology/edge-types/trust_friction_reduction.json
- extensions/ontology/edge-types/value_pricing.json
- memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
- scripts/control-tower/probe-ontology-values.ts
- tests/l4/edge-lag-unknown-degraded-1134.test.ts
- tests/l4/ontology-loader-param-bridge-1031.test.ts
- tests/ontology/edge-lag-values.test.ts
- tests/ontology/edge-transfer-functions.test.ts
- verify: npx tsx scripts/control-tower/probe-ontology-values.ts
- verify: npx vitest run tests/ontology/edge-transfer-functions.test.ts
- verify: npx vitest run tests/ontology/edge-lag-values.test.ts
- verify: npx vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts tests/l4/ontology-loader-param-bridge-1031.test.ts
- verify: npx vitest run tests/ontology/ tests/l4/
- verify: bash scripts/control-tower/check-ontology-fields.sh
- verify: npx tsc --noEmit

**不做什么**：
- 不改 .claude/claims/201.yaml
- 不改 .claude/claims/345.yaml
- 不改 extensions/ontology/tags.json
- 不改 src/l4/ontology-loader.ts
- 不改 scripts/control-tower/check-ontology-fields.sh

> 「不改 201/345」= 队长归属的工作区修复件（未 stage、未提交）；
> 「不改 tags.json」= 队长裁定（补标签 = 放宽检查面 = 门禁语义变更 ⇒ 归 CTO）；
> 「不改 ontology-loader.ts / check-ontology-fields.sh」= 写集外门禁件（改语义须上报表）。

## Q3: 验收 — 入口 → 交互 → 结果

**入口**：`npx tsx scripts/control-tower/probe-ontology-values.ts`
**交互**：真读权威01 第二章抽取 42 个 E 号的公式块 → 与 56 件的 `transfer_function` 按归一化口径（按行 trim/丢空/` ; ` 连接）**逐字**比对
**结果**：末行 `RESULT=… formula=13 tfr_unknown=39 tfr_registered=4 TBD=0` + `[OK]`；exit 0；配套判据件真断言全绿。

## 架构层: 本体层（L4 数据面 + 控制塔防线面，宪章 §0.4/§4.1）

#CRITERIA: B

## Done 标准

- [x] 探针 exit 0 且末行含 TBD=0：verify: npx tsx scripts/control-tower/probe-ontology-values.ts
- [x] 13 条公式逐字 === 权威01 第二章（运行时真读）：verify: npx vitest run tests/ontology/edge-transfer-functions.test.ts
- [x] 39 条显式 unknown、禁 TBD 残留：verify: npx vitest run tests/ontology/edge-transfer-functions.test.ts
- [x] 反例：任一条改回 TBD ⇒ 探针 exit 1：verify: npx tsx scripts/control-tower/probe-ontology-values.ts
- [x] 棘轮同步件全绿：verify: npx vitest run tests/l4/ontology-loader-param-bridge-1031.test.ts
- [x] 既有字段门禁保持绿：verify: bash scripts/control-tower/check-ontology-fields.sh
- [x] 影响面回归：verify: npx vitest run tests/ontology/ tests/l4/
