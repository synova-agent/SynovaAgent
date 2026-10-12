# K4-b3-VERIFY-prereq-2026-10-12 — 队长冻结前提的独立复现（复现员：verifier / task-4）

> **读数时点** = 2026-10-12（本 session 机器时间 2026-10-12T12:3x +08:00）
> **diff 左端（基准）** = `ba1b22a8b5ff75833704bac22fcfcb47295dc970`（`git rev-parse ba1b22a8b5` 原样输出）
> base 提交信息原样：`Merge pull request 'P0收尾: 主树提交禁止门禁生效(D537r2) — guard接线+钩子硬拦+测试' (#459) from fix/main-tree-commit-gate into local-main`
> **工作目录** = `D:\k4b3-verify`（分支 `k4b3/verify`；`git rev-parse HEAD` = `ba1b22a8b5ff75833704bac22fcfcb47295dc970`，`git status --porcelain` 行数 = 0）
> **复现员身份** = `verifier`（独立复核员，未参与实施；未阅读任何实施员结论）
> **工具** = git 2.54.0.windows.1 / node v24.16.0 / Windows PowerShell 5.1.26100.9444

---

## 〇、方法与测量污染防护（先证明"我读的确实是 base"）

**口径**：不复用工作树字节，不 checkout。从 `ba1b22a8b5` 逐 blob 导出到临时目录，再用**独立实现的 git blob SHA-1**（`sha1("blob "+len+"\0"+bytes)`，纯 Node，不调 `git hash-object`）逐文件比对树内 blob 哈希。

```
命令：git -C D:\k4b3-verify ls-tree -r -z ba1b22a8b5 -- extensions/ontology cycles src/ > <tmp>\base-all-lstree.bin
      （经 cmd /c 原样字节重定向；PowerShell 5.1 的 `>` 会写 UTF-16LE BOM，实测首 8 字节 ff fe 31 00 30 00 30 00 ⇒ 已弃用）
命令：逐条 `git cat-file -p <sha> > <tmp>\k4b3-verify-base\<path>`（582 条，cmd 原样重定向）
校验：node m-verify-extract.mjs
```

原始输出（全文）：

```
CALIBER       = 逐文件 git blob SHA-1 比对（独立实现，非 git hash-object）
base tree 条目 = 582
临时副本文件数 = 582
SHA-1 一致     = 582
缺失(树有盘无) = 0 []
多出(盘有树无) = 0 []
哈希不一致     = 0 []
```

⇒ 后文所有数字均取自这份 **582/582 字节等同 base** 的副本。

### 〇bis、两个必须记录的取数陷阱（c 类：跑不通处）

**陷阱 1 — PowerShell 5.1 文本重定向自造 BOM（A1 类测量污染）。**
`git ls-tree ... > file` 实测首 8 字节 `ff fe 31 00 30 00 30 00`（UTF-16LE BOM），文件 23292 字节；改 `cmd /c "... > file"` 后首 8 字节 `31 30 30 36 34 34 20 62`（即 `100644 b`），11643 字节。**读文本类 blob 的中间产物一律走原样字节重定向。**

**陷阱 2 — `git archive` 会按 `core.autocrlf` 改写行尾，导出件≠blob 字节。**
- `git archive ... | tar -x` 在 PowerShell 5.1 下原生管道二进制被污染：`tar.exe: Damaged tar archive (bad header checksum)` ×N，导出 0 文件（跑不通）。
- `git archive -o <tar>` 再 `tar -xf` 可导出，但 115 件中 **78 件 SHA-1 不一致**；对 `goal_decomposition.json` / `cycle-types.ts` / `cash-cycle.cycle.json` 三件逐一诊断，输出均为 `VERDICT = CRLF_CONVERTED_BY_ARCHIVE`（导出件 35/109/34 行全 CRLF，去 CR 后 SHA-1 与 blob 完全一致）。
- 本机 `git config --get core.autocrlf` = `true`。

**⇒ 连带风险（属 L1 卡 #238 判据 ③ 的口径缺陷，见下方 a-3）**：工作树字节 ≠ blob 字节。实测：

```
文件 src/cycles/cycle-types.ts
  blob_sha_base     = 596e0a2d1738dcc03ac0f425dd26a6e76393c04c   （git rev-parse ba1b22a8b5:src/cycles/cycle-types.ts）
  git hash-object   = 596e0a2d1738dcc03ac0f425dd26a6e76393c04c   （一致）
  raw_worktree_sha1 = 3aedb6ff766714a6fcba62605806fec86034e603   （原始字节，不一致）
  crlf_lines= 109   bare_lf= 0
文件 cycles/builtin/cash-cycle.cycle.json
  blob_sha_base     = 411bcfc6bb4c75cbe2736cd55ca31062d47def04
  git hash-object   = 411bcfc6bb4c75cbe2736cd55ca31062d47def04
  raw_worktree_sha1 = d427398847231ce9d94d03364ea93b0583711eab
  crlf_lines= 34    bare_lf= 0
```

---

## 一、前提 1 — edge-types 件数 / `$id` distinct / `label` distinct

**口径**：`extensions/ontology/edge-types/` 目录直读 `.json` 文件（非递归）；`$id`/`label` 取顶层字段字符串原值，distinct = 去重集合大小。

```
.json 件数         = 56
全部 $id 可读且为字符串 = true
$id   总数=56  distinct=56
label 总数=56  distinct=56
$id 重复项 = []
label 重复项 = []
$id 形态非 edge/<snake> 的条目数 = 0 []     ← 见下方"口径订正"，该判据本身不成立
```

**与冻结前提对照**：件数 56 ✔（与 task-1/task-2/task-3 三张卡的「真基线 = 56 件（不是 55）」一致）；`$id` distinct 56 ✔；`label` distinct 56 ✔。

**逐件 `$id` / `label` 全列（56 行，原文不摘要）**：

```
assumption_triggered_reallocation.json	edge/assumption_triggered_reallocation	ASSUMPTION_TRIGGERED_REALLOCATION
augments.json	edge/augments	AUGMENTS
brand_building.json	edge/brand_building	BRAND_BUILDING
brand_builds.json	edge/brand_builds	BRAND_BUILDS
capital_acquisition.json	edge/capital_acquisition	CAPITAL_ACQUISITION
capital_allocation.json	edge/capital_allocation	CAPITAL_ALLOCATION
capital_source_mix.json	edge/capital_source_mix	CAPITAL_SOURCE_MIX
channel_delivery.json	edge/channel_delivery	CHANNEL_DELIVERY
competitive_positioning.json	edge/competitive_positioning	COMPETITIVE_POSITIONING
constrains.json	edge/constrains	CONSTRAINS
couples.json	edge/couples	COUPLES
cross_functional_synergy.json	edge/cross_functional_synergy	CROSS_FUNCTIONAL_SYNERGY
cumulative_learning.json	edge/cumulative_learning	CUMULATIVE_LEARNING
customer_data_loop.json	edge/customer_data_loop	CUSTOMER_DATA_LOOP
customer_lockin.json	edge/customer_lockin	CUSTOMER_LOCKIN
data_collection.json	edge/data_collection	DATA_COLLECTION
decision_authority.json	edge/decision_authority	DECISION_AUTHORITY
decision_concentrates.json	edge/decision-concentrates	DECISION_CONCENTRATES
demand_to_spec.json	edge/demand_to_spec	DEMAND_TO_SPEC
deploys.json	edge/deploys	DEPLOYS
efficiency_attraction.json	edge/efficiency_attraction	EFFICIENCY_ATTRACTION
environmental_scan.json	edge/environmental_scan	ENVIRONMENTAL_SCAN
equipment_acquisition.json	edge/equipment_acquisition	EQUIPMENT_ACQUISITION
external_assumption.json	edge/external-assumption	EXTERNAL_ASSUMPTION_BINDS
external_feedback.json	edge/external_feedback	EXTERNAL_FEEDBACK
funds.json	edge/funds	FUNDS
goal_decomposition.json	edge/goal_decomposition	GOAL_DECOMPOSITION
incentive_alignment.json	edge/incentive_alignment	INCENTIVE_ALIGNMENT
incentive_binds.json	edge/incentive-binds	INCENTIVE_BINDS
information_flow.json	edge/information_flow	INFORMATION_FLOW
innovation_output.json	edge/innovation_output	INNOVATION_OUTPUT
knowledge_reuse.json	edge/knowledge_reuse	KNOWLEDGE_REUSE
knowledge_sharing.json	edge/knowledge_sharing	KNOWLEDGE_SHARING
locks_in.json	edge/locks-in	LOCKS_IN
market_share_capture.json	edge/market_share_capture	MARKET_SHARE_CAPTURE
operational_execution.json	edge/operational_execution	OPERATIONAL_EXECUTION
organizational_learning.json	edge/organizational_learning	ORGANIZATIONAL_LEARNING
procurement_bargaining.json	edge/procurement_bargaining	PROCUREMENT_BARGAINING
produces.json	edge/produces	PRODUCES
profit_reinvestment.json	edge/profit_reinvestment	PROFIT_REINVESTMENT
reputation_attraction.json	edge/reputation_attraction	REPUTATION_ATTRACTION
reputation_flywheel.json	edge/reputation_flywheel	REPUTATION_FLYWHEEL
retention_protects_knowledge.json	edge/retention_protects_knowledge	RETENTION_PROTECTS_KNOWLEDGE
routine_rigidity.json	edge/routine_rigidity	ROUTINE_RIGIDITY
rule_constraint.json	edge/rule_constraint	RULE_CONSTRAINT
sensing_calibration.json	edge/sensing_calibration	SENSING_CALIBRATION
service_support.json	edge/service_support	SERVICE_SUPPORT
signal_transmits.json	edge/signal-transmits	SIGNAL_TRANSMITS
signal_upward_pass.json	edge/signal_upward_pass	SIGNAL_UPWARD_PASS
talent_acquisition.json	edge/talent_acquisition	TALENT_ACQUISITION
talent_deployment.json	edge/talent_deployment	TALENT_DEPLOYMENT
talent_filter.json	edge/talent_filter	TALENT_FILTER
talent_retention.json	edge/talent_retention	TALENT_RETENTION
tech_infrastructure.json	edge/tech_infrastructure	TECH_INFRASTRUCTURE
trust_friction_reduction.json	edge/trust_friction_reduction	TRUST_FRICTION_REDUCTION
value_pricing.json	edge/value_pricing	VALUE_PRICING
```

**口径订正（`$id` 命名形态，附加测量）**：

```
CALIBER = 对 $id 逐条套正则 ^edge/[a-z0-9]+(_[a-z0-9]+)*$ (snake) 与 ^edge/[a-z0-9]+(-[a-z0-9]+)*$ (kebab)
总件数            = 56
含连字符(非纯 snake) 的 $id 条数 = 5
  decision_concentrates.json	edge/decision-concentrates	DECISION_CONCENTRATES
  external_assumption.json	edge/external-assumption	EXTERNAL_ASSUMPTION_BINDS
  incentive_binds.json	edge/incentive-binds	INCENTIVE_BINDS
  locks_in.json	edge/locks-in	LOCKS_IN
  signal_transmits.json	edge/signal-transmits	SIGNAL_TRANSMITS
含下划线的 $id 条数 = 45
单字 $id 条数 = 6
label 不匹配 ^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$ 的件: （零行）
```

**结论**：`$id` 形态 **51/56 为 `edge/<snake>`，5/56 为连字符式**（`edge/decision-concentrates`、`edge/external-assumption`、`edge/incentive-binds`、`edge/locks-in`、`edge/signal-transmits`），另 6 条为单字无分隔符。**冻结前提「56 个 $id 全为 edge/<snake>」为不精确**（见 a-1）。

---

## 二、前提 2 — cycles 引用三口径 occurrences / distinct

**口径**：基准树内 `cycles/**/*.cycle.json` 递归；口径 A = `nodes[].edgeRefs[]` 数组元素；口径 B = `mapping[].edgeId` 字段值；口径 C = A∪B 去重集合。occurrences = 原始出现次数（含同一值跨文件重复），distinct = 去重集合大小。

**文件全列（6 件，原文不摘要）**：

```
cycles/builtin/cash-cycle.cycle.json
cycles/builtin/customer-cycle.cycle.json
cycles/builtin/product-cycle.cycle.json
cycles/builtin/talent-cycle.cycle.json
cycles/industry/retail-ecommerce/store-replication.cycle.json
cycles/industry/saas-tech/arr-growth.cycle.json
```

```
CALIBER_A = nodes[].edgeRefs 口径  : occurrences=22 distinct=15
CALIBER_B = mapping[].edgeId 口径  : occurrences=23 distinct=15
CALIBER_C = A∪B 并集口径           : occurrences=15 distinct=15
A∩B 交集 distinct = 15
只在 A 不在 B = []
只在 B 不在 A = []
A∪B(跨口径 occurrence 求和) = 45
```

逐文件（口径：edgeRefs 条数 / edgeId 条数 / nodes 数 / mapping 数）：

```
cycles/builtin/cash-cycle.cycle.json	edgeRefs=3	edgeId=3	nodes=4	mapping=3
cycles/builtin/customer-cycle.cycle.json	edgeRefs=4	edgeId=4	nodes=4	mapping=4
cycles/builtin/product-cycle.cycle.json	edgeRefs=4	edgeId=4	nodes=4	mapping=4
cycles/builtin/talent-cycle.cycle.json	edgeRefs=4	edgeId=4	nodes=4	mapping=4
cycles/industry/retail-ecommerce/store-replication.cycle.json	edgeRefs=4	edgeId=4	nodes=4	mapping=4
cycles/industry/saas-tech/arr-growth.cycle.json	edgeRefs=3	edgeId=4	nodes=6	mapping=4
```

并集 distinct 全列（15 条，每值跨文件出现次数）：

```
edge/capital_allocation	×4	["cycles/builtin/cash-cycle.cycle.json","cycles/builtin/product-cycle.cycle.json","cycles/industry/retail-ecommerce/store-replication.cycle.json","cycles/industry/saas-tech/arr-growth.cycle.json"]
edge/channel_delivery	×2	["cycles/builtin/customer-cycle.cycle.json","cycles/industry/retail-ecommerce/store-replication.cycle.json"]
edge/cross_functional_synergy	×1	["cycles/builtin/product-cycle.cycle.json"]
edge/cumulative_learning	×1	["cycles/builtin/talent-cycle.cycle.json"]
edge/customer_lockin	×2	["cycles/builtin/customer-cycle.cycle.json","cycles/industry/saas-tech/arr-growth.cycle.json"]
edge/efficiency_attraction	×1	["cycles/industry/retail-ecommerce/store-replication.cycle.json"]
edge/equipment_acquisition	×1	["cycles/industry/retail-ecommerce/store-replication.cycle.json"]
edge/external_feedback	×1	["cycles/builtin/product-cycle.cycle.json"]
edge/knowledge_reuse	×1	["cycles/builtin/talent-cycle.cycle.json"]
edge/operational_execution	×1	["cycles/builtin/product-cycle.cycle.json"]
edge/profit_reinvestment	×1	["cycles/builtin/cash-cycle.cycle.json"]
edge/reputation_flywheel	×2	["cycles/builtin/customer-cycle.cycle.json","cycles/industry/saas-tech/arr-growth.cycle.json"]
edge/talent_acquisition	×1	["cycles/builtin/talent-cycle.cycle.json"]
edge/talent_retention	×1	["cycles/builtin/talent-cycle.cycle.json"]
edge/value_pricing	×3	["cycles/builtin/cash-cycle.cycle.json","cycles/builtin/customer-cycle.cycle.json","cycles/industry/saas-tech/arr-growth.cycle.json"]
```

命中 $id∪label：

```
并集 15 条中命中 $id∪label 的 distinct = 15
未命中项 = 0 []
未命中 $id∪label（A 口径）= []
未命中 $id∪label（B 口径）= []
```

**与冻结前提对照**：distinct 15/15/15 ✔；edgeRefs occurrences 22 + edgeId occurrences 23 = 45 ✔；未命中 0 ✔。

**口径必须钉死（否则判据字符串会漂）**：`occurrences=45` **只在**「两口径原始出现次数相加、跨口径不去重」这一口径下成立；**并集去重后 occurrences = 15**。同一件事三个合法读数：`22`（A 口径）/ `23`（B 口径）/ `45`（跨口径求和）/ `15`（并集集合大小）。见 a-2。

---

## 三、前提 3 — `extensions/ontology/` 内 E 号正则命中数

**口径**：对 `extensions/ontology/` 下全部文件按 UTF-8 文本整体匹配正则 `E-[0-9]+(\.[0-9]+)?`（含注释与字符串）。

```
扫描文件数 = 100
E 号 occurrences 命中总数 = 0
E 号 distinct 形态数      = 0
命中的 distinct 值 = []
有命中的文件数 = 0
附加口径(非要求)= 两位式 \bE-[0-9]{2}\b occurrences=0 distinct=0 []
```

**独立第二方法交叉验证**（`git grep` 直接搜 base 树 blob 内容，不经导出副本）：

```
命令：git grep -c -E 'E-[0-9]+' ba1b22a8b5 -- extensions/ontology/
输出：（无输出）  exit=1   （exit 1 = 零命中）
命令：git ls-tree -r --name-only ba1b22a8b5 -- extensions/ontology/ | wc 类计数
输出：FILES=100
```

**与冻结前提对照**：0 命中 ✔（两法一致）；另实测 `extensions/ontology/` 文件总数 = 100（与扫描数一致）。

> 注：E 号权威表（E-01..E-42）**不在** `extensions/ontology/` 内，本项只证明"该目录零命中"这一冻结前提成立，不证明权威文档里确有 42 条（那属阶段二逐卡复核范围）。

---

## 四、前提 4 — `action_effect_lag` 取值分布 / `transfer_function` TBD 数与总件数

**口径**：`edge-types/` 下 56 件 `.json` 顶层字段原值分组（不做任何归一化）；`transfer_function` 按大小写不敏感 `\bTBD\b` 同时计「件级」与「出现级」。

```
CALIBER = edge-types/ 下 56 件 .json 顶层字段 action_effect_lag 的字符串原值分组（不做归一化）
缺 action_effect_lag 字段的件 = 0 []
distinct 取值形态 = 6
--- 取值分布（原值 → 件数） ---
  "unknown"	50
  "3-6_months"	2
  "0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞"	1
  "1_month"	1
  "1-3_months"	1
  "immediate"	1
非数值区间形态的取值数 = 6 ["0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞","1-3_months","1_month","3-6_months","immediate","unknown"]
```

```
CALIBER = edge-types/ 下 .json 顶层 transfer_function，按大小写不敏感 \bTBD\b 计数（件级 + 出现级）
transfer_function 总件数 = 56
含 TBD 的件数            = 52
TBD 出现总次数(occurrence)= 52
不含 TBD 的件数          = 4
缺 transfer_function 字段 = 0
TBD 原文形态 distinct = 1
```

**不含 TBD 的 4 件 + 原值（原文不摘要）**：

```
brand_builds.json	:: "revenue_lift = brand_investment * f(awareness_lift, premium_ratio_change, repeat_purchase_lift, nps_change, lag_months)"
couples.json	:: "B_output_volatility = A_output_volatility * coupling_strength * exp(-coupling_lag/decay_constant)"
cumulative_learning.json	:: "unit_cost_t = unit_cost_t0 * (cumulative_output)^(-learning_rate)"
goal_decomposition.json	:: "N/A — 结构性从属边（非因果传导）：输出 = 父目标分解出的子目标集合，无时滞/无增益系数"
```

**含 TBD 的 52 件全列（原文不摘要）**：

```
assumption_triggered_reallocation.json
augments.json
brand_building.json
capital_acquisition.json
capital_allocation.json
capital_source_mix.json
channel_delivery.json
competitive_positioning.json
constrains.json
cross_functional_synergy.json
customer_data_loop.json
customer_lockin.json
data_collection.json
decision_authority.json
decision_concentrates.json
demand_to_spec.json
deploys.json
efficiency_attraction.json
environmental_scan.json
equipment_acquisition.json
external_assumption.json
external_feedback.json
funds.json
incentive_alignment.json
incentive_binds.json
information_flow.json
innovation_output.json
knowledge_reuse.json
knowledge_sharing.json
locks_in.json
market_share_capture.json
operational_execution.json
organizational_learning.json
procurement_bargaining.json
produces.json
profit_reinvestment.json
reputation_attraction.json
reputation_flywheel.json
retention_protects_knowledge.json
routine_rigidity.json
rule_constraint.json
sensing_calibration.json
service_support.json
signal_transmits.json
signal_upward_pass.json
talent_acquisition.json
talent_deployment.json
talent_filter.json
talent_retention.json
tech_infrastructure.json
trust_friction_reduction.json
value_pricing.json
```

**独立第二方法交叉验证**：

```
命令：git grep -c -E 'TBD' ba1b22a8b5 -- extensions/ontology/edge-types/
输出：HIT_FILES=52   exit=0
命令：git grep -c -E 'action_effect_lag' ba1b22a8b5 -- extensions/ontology/edge-types/
输出：HIT_FILES=56   exit=0
```

**与冻结前提对照**：50 unknown + `3-6_months`×2 + `immediate`/`1_month`/`1-3_months` 各 1 + `goal_decomposition.json` 散文值×1 ✔（合计 50+2+1+1+1+1=56，与件数闭合）；TBD 52 / 总 56 ✔（两法一致）；非 TBD 4 件点名 `brand_builds`/`couples`/`cumulative_learning`/`goal_decomposition` ✔。

---

## 五、前提 5 — `src/cycles/` 内 `Valve` / `valves` / `actionEffectLag` 命中数

**口径**：`src/cycles/` 下全部文件（递归）按 UTF-8 文本整体匹配，逐模式独立计数（大小写敏感 + 大小写不敏感各跑）。

```
扫描文件数 = 9
  src/cycles/cross-scale-validator.ts
  src/cycles/cycle-loader.ts
  src/cycles/cycle-registry.ts
  src/cycles/cycle-types.ts
  src/cycles/index.ts
  src/cycles/investment-advisor.ts
  src/cycles/overflow-compute.ts
  src/cycles/overflow-dashboard.ts
  src/cycles/overflow-graph-bridge.ts

PATTERN "Valve (case-sensitive)"            => occurrences=0
PATTERN "valves (case-sensitive)"           => occurrences=0
PATTERN "valve (case-insensitive)"          => occurrences=0
PATTERN "actionEffectLag (case-sensitive)"  => occurrences=0
PATTERN "valves (case-insensitive)"         => occurrences=0
PATTERN "五阀|阀 (CJK)"                      => occurrences=0
```

**附加口径（非要求）：base 树 `src/` 全域（476 文件）同模式扫描**：

```
PATTERN "Valve (case-sensitive)"            => 命中文件数=0 []
PATTERN "valves (case-sensitive)"           => 命中文件数=0 []
PATTERN "valve (case-insensitive)"          => 命中文件数=0 []
PATTERN "actionEffectLag (case-sensitive)"  => 命中文件数=0 []
PATTERN "valves (case-insensitive)"         => 命中文件数=0 []
PATTERN "五阀|阀 (CJK)"                      => 命中文件数=0 []
```

**独立第二方法交叉验证**：

```
命令：git grep -l -E 'Valve|valves|actionEffectLag' ba1b22a8b5 -- src/cycles/
输出：（无输出）  exit=1   （exit 1 = 零命中）
命令：git grep -l -E 'Valve|valves|actionEffectLag' ba1b22a8b5 -- src/
输出：（无输出）  exit=1   （exit 1 = 零命中）
```

**与冻结前提对照**：全 0 命中 ✔（导出副本 + `git grep` 二法一致，且扩到 `src/` 全域仍为 0）。
**注**：本项证明的是「基线无该符号」这一**接线缺口为真**，**不**证明任何实施员「已接线/已消费」；后者属阶段二，须有「删掉即报红」的判别性夹具方可采信。

---

## 六、固定输出四项

### a. 与实测不一致处（附命令）

**a-1（口径级·不精确）冻结前提「56 个 $id 全为 edge/<snake>」不成立。**
命令：`node m-idform.mjs <base-copy>`（正则 `^edge/[a-z0-9]+(-[a-z0-9]+)*$` + 连字符判定）
实测：含连字符的 `$id` = **5/56** —— `edge/decision-concentrates`、`edge/external-assumption`、`edge/incentive-binds`、`edge/locks-in`、`edge/signal-transmits`（余 45 条含下划线、6 条单字）。
影响面：① L1 #238「E 号 → `$id`/`label` 双向映射」若以「label 小写+下划线转 `$id`」推断，这 5 条永远映射不上；② L3 #65「两个新边文件与既有 56 件**同构**」判据下，既有件本身形态不统一（51 snake + 5 kebab + 6 单字），"同构"未指明以哪一形态为准 ⇒ 判据不可判定。
建议处置：把前提改写为「`$id` 一律以 `edge/` 前缀 + 小写单词，分隔符既有 `_` 亦有 `-`（5 条）」；#238/#65 需显式声明新件的分隔符口径。

**a-2（口径级·判据字符串有歧义）`occurrences=45` 只在一种口径下成立。**
命令：`node m-caliber.mjs <base-copy>`
实测：`22`（A 口径 occurrences）/ `23`（B 口径 occurrences）/ `45`（跨口径求和）/ `15`（A∪B 去重集合大小）/ distinct 一律 `15`。
影响面：L1 #238 判据②要求探针末行**逐字**含 `occurrences=45 distinct=15 hit=15 miss=0`。若实施员把 occurrences 实现为「并集去重后计数」，正常实现会输出 `occurrences=15` 而被判红；更危险的是**反向拟合**——为了让末行等于目标串而把计数写成 `22+23` 硬编码，形成「恒真判据＝假绿」。
建议处置：判据必须写明定义「occurrences = `nodes[].edgeRefs` 元素数 + `mapping[].edgeId` 字段数（跨口径不去重）」，并加**判别性反例**：删 1 条 edgeRefs ⇒ 末行必须从 45 变 44 且探针非零退出；否则不得以该末行作为验收。

**a-3（口径级·自相矛盾）L1 #238 判据③「复原后逐字节一致（用 git hash-object 比，声明口径=工作树字节）」内部冲突。**
命令：见本文 §〇bis 陷阱 2 的实测块（`git hash-object` 与原始字节 SHA-1 并排比对）
实测：`git hash-object` 对工作树文件**会施加 clean 过滤**，输出 = blob 哈希 `596e0a2d…`；而工作树**原始字节** SHA-1 = `3aedb6ff…`（109 行全 CRLF，`core.autocrlf=true`）。
⇒ `git hash-object` 一致只证明「git 规范化后一致」，**不能**证明「工作树字节一致」；两个口径在同一判据里被写成同义词。
建议处置：判据二选一并写明——(i)「git 规范化后与 base blob 哈希一致」= `git rev-parse ba1b22a8b5:<path>` == `git hash-object <path>`；或 (ii)「工作树原始字节一致」= 原始字节 SHA-1/`fc` 比对（本机 autocrlf=true 下二者必然不等，不可混用）。

**a-4（口径级·前提未覆盖）`occurrences` 的读数与文件级重复有关，逐文件计数须留档。**
命令：见 §二逐文件表
实测：`arr-growth.cycle.json` 的 `edgeRefs`=3 而 `edgeId`=4（两口径条数不等），是 `22/23` 差异的唯一来源。
影响面：仅用于 #238 交付件解释差异来源；不构成不一致，但交付件若不解释 22≠23，#239 复现者会重复此疑问。

### b. 无法核实处

**b-1** 冻结前提所引「权威文档01 第二章 42 条因果边 / 第一章 五断裂点穷举」**内容未核**：本阶段仅核 `extensions/ontology/` 内 E 号为 0，**未**核实 E-01..E-42 是否确有 42 条、编号是否两位式、`E-4.1/E-4.2` 与两位式是否真冲突（GLOSSARY.md:74 亦未读）。归属：L1 impl-a / 卡 #238 判据①④，阶段二核。
**b-2** `transfer_function` 的 52 条是「TBD 字面残留」已核，但**「哪些条应落 `unknown`、哪些条有仓内依据可落公式」无法核实**：需比对权威文档15 §3.5.1/§3.5 原件，而该原件不在本仓（task-2 描述亦自述"第三章正文不在本仓"）。归属：L2 impl-b / 卡 #235。
**b-3** 本阶段**没有任何实施员交付物**，故「已消费/已接线/删掉即报红」类声称**一律未被核实**（记录为 b，阶段二按「判别性夹具」判）。§五的 0 命中恰是接线缺口的**基线**证据，不是任何实施成果。
**b-4** 前提「`extensions/ontology/` 内 E 号 = 0」的**语义后果**未能核实：无法判定 #238 的「编号权威表」应落在该目录内（会引入 E 号，可能撞上某条现有门禁/判据）还是仅落 docs/。归属：L1 impl-a / 卡 #238 写集决策，须由队长确认写集边界。

### c. 跑不通处

**c-1** `git archive ... | tar -x` 在本机 PowerShell 5.1 下**跑不通**：原生管道二进制被污染 ⇒ `tar.exe: Damaged tar archive (bad header checksum)`（重复多次），导出文件数 = **0**。绕过：`git archive -o <tar>` + `tar -xf`，或逐 blob `git cat-file -p`（本次采用后者）。
**c-2** `git archive -o` 虽可导出，但**不可作为 blob 字节比对源**：115 件中 78 件哈希不一致，诊断全部为 `CRLF_CONVERTED_BY_ARCHIVE`（`core.autocrlf=true`）。⇒ 任何"从 git 导出文件再比哈希"的复核路径在本机都会**假红**。归属：全军共用环境风险，建议写入复核须知。
**c-3** PowerShell 5.1 的 `>`/`Out-File`/`Set-Content` 默认 UTF-16LE+BOM（实测首 8 字节 `ff fe …`），**凡经此路径的取数都属 A1 类测量污染**。本次已全程改用 `cmd /c "… > file"` 原样字节重定向。归属：全军共用环境风险。
**c-4** 未跑的项（诚实声明）：`vitest`/`tsc`/全量门禁**未跑**（本阶段为只读前提复现，且重型验证按纪律串行、当前实施线正在跑）；`git fetch`/远端对比**未做**（读数时点本机 `ba1b22a8b5` 即工作树 HEAD，未验证远端同刻是否有更新）。

### d. 能否据此独立开工/决策

**能。** 五项冻结前提中 **4 项完全复现**（edge-types 56/56/56、cycles 15/15/15 且 22+23=45 且 miss=0、E 号 0 命中、lag/TBD 分布 50+2+1+1+1+1=56 与 52/56、`src/cycles` 与 `src/` 全域 Valve/valves/actionEffectLag 全 0），且全部有**独立第二方法**（`git grep` 直搜 base blob）交叉验证；导出副本 **582/582 字节等同 base**。

**但 3 条口径级缺陷（a-1/a-2/a-3）必须先修判据再开工**，否则 L1 #238 的验收判据会同时存在「不可判定」与「反向拟合即假绿」两种失效模式：
- a-1 ⇒ `$id` 形态前提改为「51 snake + 5 kebab + 6 单字」，L1/L3 显式声明分隔符口径；
- a-2 ⇒ `occurrences=45` 必须钉死定义 + 配判别性反例（删 1 条 ⇒ 44 且非零退出）；
- a-3 ⇒ 「逐字节一致」与「git 规范化一致」二选一，写明哪个。

**结论用语：本次前提复现部分 —— 可提请独立审计**（限「五项前提复现」这一事实；a-1/a-2/a-3 三条口径缺陷请队长先行裁决/改判据后放行实施；阶段二三线交付物复核**尚未开始**，届时另出 `K4-b3-VERIFY-<issue>.md`）。

---

## 七、归属收口（问题 → 成员 / 卡 / 判据）

| 编号 | 问题 | 归属成员 | 卡 | 判据/条款 | 处置建议 |
|---|---|---|---|---|---|
| a-1 | `$id` 形态前提不精确（5/56 kebab） | lead（前提冻结） | L1 #238 / L3 #65 / L2 #234 | #238①、#65 V1「同构」 | 改前提文字 + 卡面显式声明分隔符口径 |
| a-2 | `occurrences=45` 口径有歧义 | lead（前提冻结） | L1 #238 | #238② 末行字符串 | 钉死定义 + 加判别性反例，禁硬编码 45 |
| a-3 | 「逐字节一致（用 git hash-object 比）」自相矛盾 | lead（判据措辞） | L1 #238 | #238③ 复原校验 | 二选一并写明口径；本机 autocrlf=true |
| a-4 | 22≠23 差异来源未在前提中说明 | lead（前提冻结） | L1 #238 | #238② | 交付件须解释 `arr-growth` edgeRefs=3/edgeId=4 |
| b-1 | 权威文档01 内容未核 | impl-a | #238①④ | E 号表/E-4.1 冲突 | 阶段二核 |
| b-2 | 52 条 TBD 的落值依据不在本仓 | impl-b | #235 | 落值判据 | 阶段二核；须显式声明来源局限 |
| b-3 | 无交付物，「已消费/已接线」未核 | 全体实施员 | 三线 | 铁律 0-2 接线 | 阶段二凭「删掉即报红」夹具判 |
| b-4 | E 号权威表落盘目录未定 | impl-a / lead | #238 | 写集边界 | 队长确认写集 |
| c-1/c-2/c-3 | 取数环境陷阱（archive/CRLF/BOM） | 环境（全军） | — | 复核须知 | 写入复核须知，避免假红/污染 |

## 八、一句话自验结论

在字节等同 base（582/582）的副本上、以两套独立方法复现队长冻结的 5 项前提，4 项逐字吻合、1 项（`$id` 全为 snake）不精确，另发现 2 条判据口径缺陷（`occurrences=45` 歧义、「逐字节一致」与 `git hash-object` 混用）；本前提复现部分 **可提请独立审计**，三条口径缺陷建议队长先裁决再放行实施。
