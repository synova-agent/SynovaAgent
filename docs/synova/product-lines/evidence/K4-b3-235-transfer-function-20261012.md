# K4 批 3 · L2 · #235（K4-02）52 条 `transfer_function` 落值 — 交付证据

> 卡号：#235（K4-02）｜ 分支：`k4b3/234`（与 #234 同分支，**串行**：两卡共写同一探针）｜ base：`ba1b22a8b5`
> 实施：impl-b ｜ 日期：2026-10-12 (+08:00) ｜ 口径：**数字取自命令原始输出**；哈希 = **口径 W（工作树原始字节 SHA256）**

---

## §0 结论先行

52 条 `TBD` 全部落值：**13 条公式**（口径 = `label` 精确串 === 权威01 第二章 `### E-NN: NAME` 的 NAME，**运行时真读文档逐字比对**）+ **39 条显式 `unknown`**；`TBD=0`。4 件本卡前既有值（3 真公式 + 1 结构性 N/A）**原样登记、不动**。探针 exit 0；反例（改回 `TBD`）exit 1 后逐字节复原。**可提请独立审计**。

---

## §1 口径（两口径**不同源**，各自带口径名）

| 卡 | 口径 | 集合 |
|---|---|---|
| **#235（本卡）** | **E 号名精确命中**：`label` 精确串 === 权威01 第二章 `### E-NN: NAME` | **13 条**落公式 |
| #234（前一卡） | **E 号覆盖**：§3.5.1 八条 + 未覆盖三条 | 与 13 条**不是同一集合** |

🔴 **禁语义近邻放宽**：`talent_deployment`←E-15、`innovation_output`←E-24 之类**不进** #235（无同标签命中 ⇒ `unknown`）。
（实测断言：`talent_deployment.json` 的 `transfer_function` === `unknown`，且不在 `TFR_E_TO_FILE` 内。）

---

## §2 落值表（13 条公式，逐条锚点）

| 文件 | E 号 | 权威锚点 | 公式（归一化后，` ; ` 连接） |
|---|---|---|---|
| `capital_acquisition.json` | E-05 | 权威01 第二章 `### E-05: CAPITAL_ACQUISITION` | `C_available = equity_raised + debt_raised + retained_earnings ; cash_runway_months = C_available / monthly_burn` |
| `talent_acquisition.json` | E-07 | `### E-07: TALENT_ACQUISITION` | `T_inflow = hiring_efficiency * employer_attractiveness * market_talent_supply ; hiring_efficiency = hires_completed / open_positions_per_period ; employer_attractiveness = f(brand_strength, compensation_competitiveness, culture_health)` |
| `capital_allocation.json` | E-13 | `### E-13: CAPITAL_ALLOCATION` | `allocation_efficiency = Sum(budget_i * roi_i) / total_budget ; reallocation_frequency = 再分配次数 / 周期` |
| `incentive_alignment.json` | E-17 | `### E-17: INCENTIVE_ALIGNMENT` | `incentive_distortion = (1 - kpi_strategic_alignment) * (1 + kpi_conflict_count/10) * short_term_bias ; kpi_strategic_alignment = semantic_similarity(kpi_vector, strategy_vector)` |
| `rule_constraint.json` | E-18 | `### E-18: RULE_CONSTRAINT` | `rule_rigidity = compliance_burden * (1 - adaptation_speed) * (1 + brake_existence) ; brake_existence = (has_emergency_override ? 0.3 : 1.0)` |
| `knowledge_sharing.json` | E-20 | `### E-20: KNOWLEDGE_SHARING` | `knowledge_accessibility = sharing_channel_density * (1 - knowledge_silo_ratio) ; knowledge_silo_ratio = isolated_KC_count / total_KC_count ; cross_team_diffusion = KC_accessed_by_other_teams / total_KC_accesses` |
| `routine_rigidity.json` | E-22 | `### E-22: ROUTINE_RIGIDITY` | `rigidity_gap = environmental_change_rate - routine_mutation_rate ; lock_in_strength = routine_age * (1 - adaptation_frequency)` |
| `operational_execution.json` | E-23 | `### E-23: OPERATIONAL_EXECUTION` | `operational_output = efficiency_rate * (1 - defect_rate) * capacity_utilization ; efficiency_rate = output_units / input_time ; unit_cost = total_cost / output_units` |
| `cross_functional_synergy.json` | E-28 | `### E-28: CROSS_FUNCTIONAL_SYNERGY` | `synergy_score = cross_team_output / (sum(team_individual_output) + coordination_cost) ; internal_coordination_cost = coordination_cost / total_operating_cost` |
| `tech_infrastructure.json` | E-29 | `### E-29: TECH_INFRASTRUCTURE` | `infrastructure_health = 1 - (tech_debt_score * system_instability_ratio) / 2 ; tech_debt_score = avg(TOOL.version_age / current_version_age) ; system_stability = 1 / (1 + tech_incident_count_per_period)` |
| `talent_retention.json` | E-38 | `### E-38: TALENT_RETENTION` | `talent_retention_rate = stayed_count / total_count_start ; turnover_cost = avg_replacement_cost * departed_count ; compensation_competitiveness = avg_salary_enterprise / avg_salary_market` |
| `knowledge_reuse.json` | E-39 | `### E-39: KNOWLEDGE_REUSE` | `knowledge_reuse_rate = KC_reaccess_count / total_KC_count ; codification_rate = DOCUMENT_count / KC_count ; knowledge_decay = avg_days_since_last_access / 365` |
| `reputation_flywheel.json` | E-40 | `### E-40: REPUTATION_FLYWHEEL` | `flywheel_momentum = word_of_mouth_amplification * brand_damage_recovery_rate * growth_trajectory ; referral_prob = referred_clients / new_clients_total ; nps_proxy = (promoters - detractors) / total_responses` |

**归一化口径（两侧同用，声明式）**：按行切 → 逐行 `trim` → 丢空行 → 以 ` ; ` 连接。
⇒ 文件侧（单行）与文档侧（多行代码块）由此可比；**逐字比较**（改一个字符即红，见 §5 B3）。

**其余 39 条** = 显式 `unknown`（禁自填）。
**登记非权威 4 件**（原样保留）：`brand_builds.json` / `couples.json` / `cumulative_learning.json`（本卡前既有真公式，来源非权威01 第二章）+ `goal_decomposition.json`（非因果结构性边，字段语义 = 结构性从属说明）。

---

## §3 变更方式（最小 diff，**零重排**）

逐行替换 `"transfer_function": "TBD …",` 一行，其余字节不动。
**实测**：`git diff --stat -- extensions/ontology/edge-types/` ⇒ `52 files changed, 52 insertions(+), 52 deletions(-)`（**每件恰 1 行**）。

---

## §4 判据原始输出 + exit code

```
$ npx tsx scripts/control-tower/probe-ontology-values.ts
── H1–H4 transfer_function 面: 权威公式=13 unknown=39 登记非权威=4（合计 56 / 56）
── H2 禁 TBD 残留: TBD=0
REPORT transfer_function 面: 权威公式 13 + unknown 39 + 登记非权威 4 = 56 / 全部 56
REPORT 登记非权威值 file=brand_builds.json kind=prose_formula value="revenue_lift = brand_investment * f(awareness_lift, premium_ratio_change, ...)"
REPORT 登记非权威值 file=couples.json kind=prose_formula value="B_output_volatility = A_output_volatility * coupling_strength * e(...)"
REPORT 登记非权威值 file=cumulative_learning.json kind=prose_formula value="unit_cost_t = unit_cost_t0 * (cumulative_output)^(-learning_rate)"
REPORT 登记非权威值 file=goal_decomposition.json kind=structural_na value="N/A — 结构性从属边（非因果传导）：输出 = 父目标分解出的子目标集合，无时滞/无增益系数"

RESULT=files=56 causal=55 noncausal=1 interval=5 unknown=50 registered=11 violations=0 formula=13 tfr_unknown=39 tfr_registered=4 TBD=0
[OK] 值域迁移判定全绿
PROBE_EXIT=0
```
（`TBD=0` 在**末行** ⇒ 卡面 Done「探针末行含 `TBD=0`」满足。）

```
$ npx vitest run tests/ontology/edge-transfer-functions.test.ts
 Test Files  1 passed (1) / Tests  15 passed (15)          EXIT=0

$ npx vitest run tests/ontology/ tests/l4/
 Test Files  37 passed (37) / Tests  397 passed (397)       EXIT=0

$ bash scripts/control-tower/check-ontology-fields.sh
✅ 全部 56 件边类型关键字段齐全（action_effect_lag, transfer_function）   EXIT=0
```

---

## §5 反例造红 + 复原（口径 W）

**反例（卡面原文）：任一条改回 `TBD` ⇒ 探针必 exit 1**
```
$ npx tsx scripts/control-tower/probe-ontology-values.ts     # capital_acquisition.json 改回 TBD 后
❌ TBD 残留 file=capital_acquisition.json $id=edge/capital_acquisition value="TBD — to be defined in compute phase" ⇒ 本卡禁止 TBD 残留
RESULT=… formula=12 tfr_unknown=39 tfr_registered=4 TBD=1
[FAIL] 违规 1 条（逐条见上）
PROBE_EXIT=1
```
**复原 —— 四层并列**（**R20：报告复原必须说明是哪个层面复原**）：

1. **内容层（权威；结论 = 复原成功）**：`git status --porcelain -- extensions/ontology/edge-types/capital_acquisition.json` ⇒ **无输出**（= 工作树 == HEAD，**非 modified**）；该件本笔 diff = **恰 2 行**（`git diff --numstat ba1b22a8b5..HEAD` ⇒ `2	2`）。
2. **口径 B（git blob；比 raw-byte 更强，天然排除行尾/工具重写噪声）**：
```
git rev-parse HEAD:extensions/ontology/edge-types/capital_acquisition.json
  → c1e4cffa8cbd5c55eb4f0f3d44dead395217bdb3
git hash-object extensions/ontology/edge-types/capital_acquisition.json
  → c1e4cffa8cbd5c55eb4f0f3d44dead395217bdb3        # 两者相等 ⇒ 内容零漂移
```
3. **原始字节层（口径 W）**：`复原后 56 件口径W 比对：不一致 = 1 / 56`，唯一不一致件 = `capital_acquisition.json`。
   🔴 **成因定性 = 复原动作本身经编辑工具重写（即"我在执行的那个动作"），不是源仓被改坏** —— 由第 1/2 层独立证成；**不得**读成"复原失败"。
4. **语义层**：探针运行时真读权威01 第二章比对 ⇒ 该件 `transfer_function` 与权威公式**逐字一致**；`action_effect_lag` = `"[0,0.5]"` 与登记期望值一致。

---

## §6 棘轮同步（`tests/l4/ontology-loader-param-bridge-1031.test.ts`，队长扩写集件）

实测（`node -e` 逐件按 loader 分类器计算）：
```
{"placeholder":1,"prose":55,"other":0}      # 唯一 placeholder = goal_decomposition.json
```
⇒ `BASELINE_TALLY` 更新：`tf_placeholder 53 → 1`、`tf_prose 3 → 55`（`tf_resolved`/`tf_other` 不变）；`CONSTRAINS` 断言 `placeholder → prose_formula` + `raw === 'unknown'`。
**同步理由（可核）**：#235 把 52 条 `TBD` 换成公式/`unknown` ⇒ 占位串计数**必然**漂移。

🔴 **U10（登记）**：`unknown` 在 loader 分类里落 **`prose_formula`**（非 `placeholder`）。
经查 `src/l4/ontology-loader.ts` 原文，`prose_formula` 的 `injectable: false` ⇒ **不会**被注入实例 props ⇒ **无下游注入风险**。
但它意味着 真公式/`unknown` 两类在 loader 眼里同属"散文字符串" ⇒ **无法从分类上区分"已标定"与"未标定"**（语义缺口，归 CTO）。

### §6.1 🔴 B2「这条判据**测不出**什么」（队长 2026-10-12 要求逐字加入）

> 「loader 的 `tf_prose` / `prose_formula` 分类**测不出**"已标定 vs 未标定"：**13 条真公式与 39 条 `unknown` 在 loader 层同落 `prose_formula`** ⇒ 本卡的 13/39 区分**仅由探针的运行时真读 + 逐字比对提供**，**不得**引用 loader 分类作为证据（例：`tf_prose 3 → 55` **不等于**"55 条都有公式"）。」

⇒ **Loader 分类面（`-1031` 棘轮）与探针判定面（本卡主判据）是两个不同的证据源**：前者证明"占位串已清零"，**不**证明"哪几条是公式、哪几条是 `unknown`"；后者才是。

---

## §7 写集对账

见 `.claude/claims/235.yaml`（逐条裸路径）。本卡增量 = 52 件边 JSON + 探针 + 新判据件 + `-1031` 棘轮件 + 证据件 + claim + `234.yaml`（联署更新）。
**202/345 未纳入**（队长归属件，未提交）。

---

## §8 未决项 + 归属

| # | 未决项 | 归属 |
|---|---|---|
| U10 | `unknown` 与"真公式"在 loader 分类里同落 `prose_formula`（`injectable:false`，无注入风险，但**无法区分已标定/未标定**）⇒ 本卡 13/39 的区分**只由探针真读比对提供**（见 §6.1） | **CTO**（判据/schema 域） |
| U11 | 39 条 `unknown` 的**真公式缺失**（无仓内依据 ⇒ 不填）；公式执行面（compute 消费）**零消费方** | **另卡**（"不许自填"纪律的必然结果） |
| U12 | 归一化口径（` ; ` 连接）为**本卡声明**，权威文档未规定字段承载形态 | **CTO 追认** |
| **U13** | 🔴 **规则申请（同类第二次 ⇒ 提请立规则）**：门禁依赖的**声明载体（task brief）不在执行者写集内** —— #234 与 #235 **两次**都撞此墙（#234 组 6「今日无 brief」+ 组 12「Q2 无写集」；#235 同型）。**同型第 2 次应用** = 新建 `2026-10-12-235-K4-02-transfer-function-落值.md`（队长 2026-10-12 授权，同型第 2 次）。<br>**提请立规则**（二选一或并用）：**(a)** 当日 brief 的**创建权显式归属执行者**（附写集自动同步）；**(b)** 组 6/12 在「claim 已含逐条 writeset」时**免 brief Q2 逐条**要求。 | **CTO（立规则）** |

---

## §9 LIMITS

1. 公式「与权威文档逐字一致」**不等于**「生产可执行」——实测 `src/` + `packages/` 无 compute 消费方。
2. 探针**真读**权威01 第二章（文档改版即判红）；但 E 号 ↔ 文件名映射为**冻结表**（13 条，逐条带锚点）。
3. 39 条 `unknown` **不是**"已标定"，是"**无仓内依据、不猜**"的显式降级（纪律「不许自填」）。
