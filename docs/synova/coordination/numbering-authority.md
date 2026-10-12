# 编号权威表 —— E 号 ↔ `$id`/`label` 双向对照（K4-05 / #238）

> **口径**：`as_of ba1b22a8b5`（本件首版基线；分支 `k4b3/l1-238-239`，base `ba1b22a8b5`）
> **生成**：2026-10-12 ｜ 执行：impl-a（K4 批 3 · L1 小队 #238）
> **上游卡面**：`.claude/task-briefs/2026-10-11-238-K4-05-编号权威表-引用对齐判据-新立.md`（① 定权威编号形态 ② E 号↔`$id`/`label` 双向对照 ③ 引用对齐判据 ④ 处理 golden/GLOSSARY 矛盾）
> **复算**：本件每一张表都有 §八 的可跑命令；`tests/coordination/numbering-authority.test.ts` 把这些表的核心断言机器化。

---

## 〇、先读这一节（不写代码也能读完）

仓库里同时存在**五套**编号，它们长得像、来源不同、互不换算。K4-05 之前，
「一条边的编号对不对」这件事**没有权威**：`cycles/**` 里 45 条引用写的是 `edge/<snake>`，
`extensions/ontology/edge-types/` 里 56 个 `$id` **全是** `edge/<snake>`（E 号在里面 0 命中），
而文档侧用的是两位式 `E-01…E-42`，历史数据（golden）用的又是 `E-x.y`。

本件做三件事：

1. **定权威**：代码面唯一真源 = `$id`（`edge/<snake>`）；文档面权威 E 号 = 权威文档01 的两位式 `E-01…E-42`；
   私有式 `E-x.y` 降为**历史别名**，只允许出现在历史数据里，**不得新写入**。
2. **给对照**：`E-01…E-42 → $id/label`（§三）与 `$id/label → E 号`（§四）双向成表，**每条标依据类型**。
3. **给判据**：`cycles/**` 的 45 条引用必须全部命中 `$id ∪ label` —— 机器可跑，见 §1.3。

**一句话结论**：**两张表能对上的只有 13 条（字符串层）**；其余 29 条权威 E 号**不能**靠名字直接落库，
其中 6 条有仓内交叉引用件依据、4 条两章命名打架、19 条**待 CTO 裁**。
**这不是本件的缺陷，是被测量的现状** —— 见 §3.5 待裁清单与 §7 缺口表。

---

## 一、权威编号：是什么、凭什么

### 1.1 五套编号并存矩阵

| # | 编号体系 | 形态 | 仓内载体 | 是否入册（宪章附录 E） | 本件判定 |
|---|---|---|---|---|---|
| 1 | 章节号 | `第N章` | `docs/**` | ✅ 已入册 | 沿用 |
| 2 | D 号 | `D123` | `memory/notes/**`、`docs/synova/**` | ✅ 已入册 | 沿用 |
| 3 | Issue 号 | `#238` | Gitea / GitHub | ✅ 已入册 | 沿用 |
| 4 | **权威两位式 E 号** | `E-01` … `E-42` | `docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/` 第二/四章 | ⚠️ 未入册但**是 E 号的唯一权威定义面** | **本件认定为权威 E 号体系** |
| 5 | **私有式 E-x.y** | `E-0.1` … `E-5.5`、`E-X.1` | `data/golden/wani-baby-v1.json`、`_patch_d66.cjs` | ❌ 未入册（K4 审计 §四称「第三套私有编号」） | **降为历史别名，不得新写入** |

代码侧另有两条并列命名：

| 键 | 形态 | 载体 | 说明 |
|---|---|---|---|
| `$id` | `edge/<snake>` | 每个 `extensions/ontology/edge-types/*.json` 一个 | **唯一真源** |
| `label` | `UPPER_SNAKE` | 同上文件内第二个键 | 同文件内与 `$id` 成对，**不是独立真源** |

**实测基数**（口径见 §二）：`edge-types` **56** 件 / `$id` distinct **56** / `label` distinct **56** —
两两 1:1，无重名、无重复 `$id`。目录内**全部 56 件**文件名均为 `<name>.json`，且 **56 个 `$id` 全部为 `edge/` 前缀**
（名字部分：**45 个含下划线 / 5 个含连字符 / 6 个无分隔符** ——
连字符 5 件为 `decision-concentrates`、`external-assumption`、`incentive-binds`、`locks-in`、`signal-transmits`；
无分隔符 6 件为 `augments`、`constrains`、`couples`、`deploys`、`funds`、`produces`）。
⚠️ **不得**把形态写成「全为 `edge/<snake>`」就假设全是下划线 —— 上列 5 件是连字符，按下划线切分会漏。
其中第 56 件是 `goal_decomposition.json`（`edge/goal_decomposition`）—— K4 审计定稿记的「55 件」是**该件入仓前**的旧基数。

### 1.2 本件的权威裁定（依据 = 卡面 §⑥① + 实测）

1. **代码面真源** = `$id`。任何新引用只准写 `$id`；`label` 是同文件的第二键，可读但不算第二真源。
2. **文档面权威 E 号** = 权威文档01 两位式 `E-01…E-42`。
   第二章（`### E-NN: NAME`）与第四章（`### E-NN NAME（…）`）**同名则确权**，**异名则登记为章间分歧**（§3.3）；
   第一章同类表在**正文表格**中（无 heading），实测与第四章同名 ⇒ 判定分歧时以「第一章 ∩ 第四章」对第二章。
3. **私有式 `E-x.y` = 历史别名**。它**不参与**任何新写入；存量（golden）经 `label` 中介换算（§五）。
4. ⚠️ **两套 E 号不能用形态区分**：`E-1.1` 归一后写作 `E-11`，与权威 `E-11` 形似而**所指不同**
   （golden `E-1.1` = `CAPITAL_ACQUISITION`；权威 `E-11` = `TRUST_CONSTRUCTION`）。
   归一化后形态相交 **24** 条 —— **这 24 条全是坑**，一律经 `label` 中介，禁形态推断。
5. **映射可以多对多**：一个权威 E 号可对应多条代码边（如 `E-13` ← `edge/capital_allocation`（同名）＋ `edge/funds`（交叉引用件）），
   一条代码边也可挂多个 E 号。**不得假设一一对应**。

### 1.3 引用对齐判据（机器可跑，本件交付物）

**入口**：`node scripts/control-tower/probe-cycle-edges.ts`（Node ≥ 22 原生类型擦除；`npx tsx` 亦可）

**判据④（#238 新增）**：`cycles/**/*.cycle.json` 中 `nodes[].edgeRefs` ∪ `mapping[].edgeId` 的
**distinct 取值全部命中** 代码边 `$id` ∪ `label`。

**Done 口径（末行恒为单行机器可读摘要）**：

```
occurrences=45 distinct=15 hit=15 miss=0
```

**三个数各不相同，禁混用**：

| 数 | 口径 |
|---|---|
| `occurrences` | `nodes[].edgeRefs` 条数 **22** ＋ `mapping[].edgeId` 条数 **23** = **45** |
| `distinct` | 上述两处**取值去重**后的个数 = **15** |
| `hit` | distinct 中 ∈（`$id` ∪ `label`）的个数 |
| `miss` | `distinct − hit − unknown_distinct` |

🔴 **口径修正留痕**：工作令 §二① 写「三口径全为 **17**」，与仓内裁定件
`docs/synova/coordination/K4-审计定稿与卡面全套.md` **§三 第 1 行**相反。
该行逐字（稳定锚点：同一行内同时含 `45 条引用 distinct` 与 `一律用 15`）：

```
| 1 | 45 条引用 distinct **15** | 复核员 1 说「实测 17」—— 🔴 **该复核员错了**；第二个复核员 + CTO 自量（四口径）全为 **15** | **一律用 15**；并记教训：复核员之间会打架，只能以实测为准 |
```

⇒ **工作令 §二① 与该仓内裁定件相反，以裁定件＋实测为准：判据① 的 distinct 口径一律用 15。**
「17」是 `E-x.y` 私有编号时代的残值（#978 清编号之前的口径），与当前 `edge/<snake>` 口径无关。

---

## 二、口径名 · 依据类型 · 本件测不出什么

### 2.1 口径名表（每个数字都挂口径名）

| 口径名 | 定义 | 读数 |
|---|---|---|
| `edge-types` 件数 | `extensions/ontology/edge-types/*.json` 文件数 | 56 |
| `$id` distinct | 上述文件 `$id` 去重个数 | 56 |
| `label` distinct | 上述文件 `label` 去重个数 | 56 |
| `ch2-headings` | 第二章 `^### E-NN: NAME` 行数 | 42 |
| `ch4-headings` | 第四章 `^### E-NN NAME（` 行数 | 42 |
| `ch2-vs-ch4-name-diff` | 同 E 号、两章名字不同的条数 | 4 |
| `string-hit` | 权威名与 `label` **逐字相等**的 E 号数（第二章口径） | 13 |
| `golden-keys` | golden `edges` 对象键数（`E-x.y`） | 36 |
| `golden-label-hit` | golden 的 `label` 能在词表命中的键数 | 34 |
| `patch-d66-distinct` | `_patch_d66.cjs` 内 `E-\d+\.\d+` distinct 值数 | 34 |
| `shape-normalized-intersect` | `E-x.y` 去点后与 `E-01..E-42` 的形态交集 | 24 |
| `cycles-occurrences` | 判据④ 的 occurrences | 45 |
| `cycles-distinct` | 判据④ 的 distinct | 15 |

### 2.2 依据类型图例（**禁把语义映射静默写成字符串命中**）

| 标记 | 含义 | 强度 |
|---|---|---|
| `[字符串同义]` | 权威名与词表 `label` **逐字相等** | 最强（可直接落库） |
| `[语义同义·附仓内交叉引用件依据]` | 二者名字不同，但有**仓内 git 追踪的原件**给出对应关系 | 中（**效力低于权威01**，见下） |
| `[章间分歧·取第四章命名]` | 第二章/第四章名字不同，取**能对上词表**的那一版 | 中（**待 CTO 裁**） |
| `[章间分歧·待裁]` | 两版名字不同且**都对不上**词表 | 弱（**待 CTO 裁**） |
| `[待裁·名称层有同根候选]` | 名字含相同词根、可能同义，但**无仓内依据** | 弱（**不落地**） |
| `[待裁·名称层无同根]` | 名称层与词表 56 个 `label` **无任何共同词根** | 弱（**不落地**） |

> 标记用词说明：`取第四章命名` 沿用队长裁定用词。实测**第一章与第四章在这 4 条上同名**
> （第一章用表格 `| E-08 | TALENT_FILTER | 获取 | A4 |` 而非 `### E-NN` heading，故早期只扫 heading 会漏判），
> ⇒ 该标记的准确含义 = 「取**第一章 ∩ 第四章** 的命名」（= 非第二章命名的那个）。详见 §3.3。

`[语义同义·附仓内交叉引用件依据]` 的**效力声明**：
唯一依据件是 `docs/synova/research/跨文档一致性审计-20260727/txt/哨兵-计算-本体三维映射-20260710_SYNOVA-RESEARCH-路线A-哨兵边双向审计-20260710.txt`
（git 追踪身份证明见 §六）。它是**研究审计件，不是 CTO 裁定件**，效力**低于权威文档01**。
按队长裁定（2026-10-12）：**可采信但降级，且不得作为任一条映射的唯一依据** ——
本件为每一条这类映射**并联给出了该 `label` 在词表中的 `$id`**（可交叉验证），
两处冲突以权威01 为准并登记分歧。

### 2.3 ⚠️ 本件**测不出**什么（B2）

1. **测不出语义等价是否成立**。§三 里 `[待裁·*]` 的每一条都是「名字像 / 有共同词根」，
   **同义与否属裁定，不属计算** —— 本件**不代裁**，一律登记并上报。
2. **测不出该边在图上是否真被使用**。本件只测**编号/命名的可对应性**；
   「某条边有没有消费者」是 K4 审计 §一 的另一个问题（结论是「生产侧 0 消费」），本件不复述、不背书。
3. **测不出文档正文的语义漂移**。两章不同名只能说明**版本漂移已发生**，
   说明不了哪一章的**正文**更正确；本件只报「名字可用性」，不评判正文。
4. **测不出 `label` 与 `$id` 之外的本体形态**（如 `packages/ontology/src/**` 那套 TS 常量词表 —— 属另案，见 K4 审计 §五）。
5. **测不出历史数据的正确性**。golden 的 `E-x.y` 与 `_patch_d66.cjs` 的 `E-x.y` 各说各话，
   本件只做**中介换算**，不判历史标注对错。

---

## 三、表 A：权威两位式 `E-01…E-42` → 词表（出向）

**列义**：`$id` 栏在**两章命名分歧**时取「能对上词表的那一版」；分歧条**不得静默选一个**，见 §3.3。

| E号 | 第二章名 | 第四章名 | `$id`（代码真源） | `label` | 依据类型 | 依据锚点（稳定串，非行号） |
|---|---|---|---|---|---|---|
| E-01 | ACTIVE_SCANNING | ACTIVE_SCANNING | — | — | `[待裁·名称层无同根]` | 见 §3.5 |
| E-02 | PASSIVE_SIGNAL | PASSIVE_SIGNAL | — | — | `[待裁·名称层有同根候选]` | 候选 `SIGNAL_TRANSMITS`/`SIGNAL_UPWARD_PASS`（仅共词根） |
| E-03 | EXTERNAL_ECHO | EXTERNAL_ECHO | — | — | `[待裁·名称层有同根候选]` | 候选 `EXTERNAL_ASSUMPTION_BINDS`/`EXTERNAL_FEEDBACK` |
| E-04 | PERCEPTION_LEARNING | PERCEPTION_LEARNING | — | — | `[待裁·名称层有同根候选]` | 候选 `CUMULATIVE_LEARNING`/`ORGANIZATIONAL_LEARNING` |
| E-05 | CAPITAL_ACQUISITION | CAPITAL_ACQUISITION | `edge/capital_acquisition` | `CAPITAL_ACQUISITION` | `[字符串同义]` | 第二章 `### E-05: CAPITAL_ACQUISITION` ＋ `capital_acquisition.json` 的 `label` |
| E-06 | FINANCING_MIX | FINANCING_MIX | — | — | `[待裁·名称层有同根候选]` | 候选 `CAPITAL_SOURCE_MIX` |
| E-07 | TALENT_ACQUISITION | TALENT_ACQUISITION | `edge/talent_acquisition` | `TALENT_ACQUISITION` | `[字符串同义]` | 第二章 `### E-07: TALENT_ACQUISITION` ＋ `talent_acquisition.json` |
| **E-08** | RESOURCE_ACQUISITION | **TALENT_FILTER** | `edge/talent_filter` | `TALENT_FILTER` | `[章间分歧·取第四章命名]` | 第四章 `### E-08 TALENT_FILTER（`；**第一章同名**（表 `\| E-08 \| TALENT_FILTER \|`） |
| E-09 | DATA_ACQUISITION | DATA_ACQUISITION | — | — | `[待裁·名称层有同根候选]` | 候选 `DATA_COLLECTION` 等 5 项（仅共词根） |
| **E-10** | DECISION_ALLOCATION | **EQUIPMENT_DEPLOYMENT** | （候选 `edge/equipment_acquisition`） | — | `[章间分歧·待裁]` | 第四章 `### E-10 EQUIPMENT_DEPLOYMENT（`；候选**非**字符串命中 |
| **E-11** | TRUST_CONSTRUCTION | **REPUTATION_ATTRACTION** | `edge/reputation_attraction` | `REPUTATION_ATTRACTION` | `[章间分歧·取第四章命名]` | 第四章 `### E-11 REPUTATION_ATTRACTION（`；**第一章同名**（表 `\| E-11 \| REPUTATION_ATTRACTION \|`） |
| **E-12** | POWER_DISTRIBUTION | **EFFICIENCY_FINANCING** | （候选 `edge/efficiency_attraction`） | — | `[章间分歧·待裁]` | 第四章 `### E-12 EFFICIENCY_FINANCING（`；候选**非**字符串命中 |
| E-13 | CAPITAL_ALLOCATION | CAPITAL_ALLOCATION | `edge/capital_allocation` | `CAPITAL_ALLOCATION` | `[字符串同义]` | 第二章 `### E-13: CAPITAL_ALLOCATION`；**另**＋`edge/funds`（见 §四） |
| E-14 | DECISION_POWER | DECISION_POWER | `edge/decision-concentrates` | `DECISION_CONCENTRATES` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `DECISION_CONCENTRATES E-14 DECISION_POWER` |
| E-15 | HUMAN_DEPLOYMENT | HUMAN_DEPLOYMENT | `edge/deploys` | `DEPLOYS` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `DEPLOYS E-15 HUMAN_DEPLOYMENT` |
| E-16 | INFO_TRANSMISSION | INFO_TRANSMISSION | `edge/signal-transmits` | `SIGNAL_TRANSMITS` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `SIGNAL_TRANSMITS E-16 INFO_TRANSMISSION` |
| E-17 | INCENTIVE_ALIGNMENT | INCENTIVE_ALIGNMENT | `edge/incentive_alignment` | `INCENTIVE_ALIGNMENT` | `[字符串同义]` | 第二章 `### E-17: INCENTIVE_ALIGNMENT`；**另**＋`edge/incentive-binds` |
| E-18 | RULE_CONSTRAINT | RULE_CONSTRAINT | `edge/rule_constraint` | `RULE_CONSTRAINT` | `[字符串同义]` | 第二章 `### E-18: RULE_CONSTRAINT`；**另**＋`edge/constrains` |
| E-19 | ORG_LEARNING | ORG_LEARNING | `edge/cumulative_learning` | `CUMULATIVE_LEARNING` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `CUMULATIVE_LEARNING E-19 ORG_LEARNING` |
| E-20 | KNOWLEDGE_SHARING | KNOWLEDGE_SHARING | `edge/knowledge_sharing` | `KNOWLEDGE_SHARING` | `[字符串同义]` | 第二章 `### E-20: KNOWLEDGE_SHARING` |
| E-21 | ORG_TRUST | ORG_TRUST | — | — | `[待裁·名称层有同根候选]` | 候选 `TRUST_FRICTION_REDUCTION` |
| E-22 | ROUTINE_RIGIDITY | ROUTINE_RIGIDITY | `edge/routine_rigidity` | `ROUTINE_RIGIDITY` | `[字符串同义]` | 第二章 `### E-22: ROUTINE_RIGIDITY` |
| E-23 | OPERATIONAL_EXECUTION | OPERATIONAL_EXECUTION | `edge/operational_execution` | `OPERATIONAL_EXECUTION` | `[字符串同义]` | 第二章 `### E-23: OPERATIONAL_EXECUTION`；**另**＋`edge/produces` |
| E-24 | INNOVATION | INNOVATION | — | — | `[待裁·名称层有同根候选]` | 候选 `INNOVATION_OUTPUT` |
| E-25 | BRAND_CONSTRUCTION | BRAND_CONSTRUCTION | `edge/brand_builds` | `BRAND_BUILDS` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `BRAND_BUILDS E-25 BRAND_CONSTRUCTION` |
| E-26 | PRODUCT_DEFINITION | PRODUCT_DEFINITION | — | — | `[待裁·名称层无同根]` | 见 §3.5 |
| E-27 | SERVICE_DELIVERY | SERVICE_DELIVERY | — | — | `[待裁·名称层有同根候选]` | 候选 `CHANNEL_DELIVERY`/`SERVICE_SUPPORT` |
| E-28 | CROSS_FUNCTIONAL_SYNERGY | CROSS_FUNCTIONAL_SYNERGY | `edge/cross_functional_synergy` | `CROSS_FUNCTIONAL_SYNERGY` | `[字符串同义]` | 第二章 `### E-28: CROSS_FUNCTIONAL_SYNERGY`；**另**＋`edge/couples` |
| E-29 | TECH_INFRASTRUCTURE | TECH_INFRASTRUCTURE | `edge/tech_infrastructure` | `TECH_INFRASTRUCTURE` | `[字符串同义]` | 第二章 `### E-29: TECH_INFRASTRUCTURE`；**另**＋`edge/augments` |
| E-30 | PRICING | PRICING | — | — | `[待裁·名称层有同根候选]` | 候选 `VALUE_PRICING` |
| E-31 | CLIENT_RETENTION | CLIENT_RETENTION | `edge/locks-in` | `LOCKS_IN` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `LOCKS_IN E-31 CLIENT_RETENTION` |
| E-32 | CHANNEL_EFFICIENCY | CHANNEL_EFFICIENCY | — | — | `[待裁·名称层有同根候选]` | 候选 `CHANNEL_DELIVERY`/`EFFICIENCY_ATTRACTION` |
| E-33 | MARKET_COMPETITION | MARKET_COMPETITION | — | — | `[待裁·名称层有同根候选]` | 候选 `MARKET_SHARE_CAPTURE` |
| E-34 | PROCUREMENT_POWER | PROCUREMENT_POWER | — | — | `[待裁·名称层有同根候选]` | 候选 `PROCUREMENT_BARGAINING` |
| E-35 | CUSTOMER_DATA_FEEDBACK | CUSTOMER_DATA_FEEDBACK | — | — | `[待裁·名称层有同根候选]` | 候选 `CUSTOMER_DATA_LOOP` 等 4 项 |
| E-36 | COMPETITIVE_POSITION | COMPETITIVE_POSITION | — | — | `[待裁·名称层有同根候选]` | 候选 `COMPETITIVE_POSITIONING` |
| E-37 | PROFIT_REINVEST | PROFIT_REINVEST | — | — | `[待裁·名称层有同根候选]` | 候选 `PROFIT_REINVESTMENT` |
| E-38 | TALENT_RETENTION | TALENT_RETENTION | `edge/talent_retention` | `TALENT_RETENTION` | `[字符串同义]` | 第二章 `### E-38: TALENT_RETENTION` |
| E-39 | KNOWLEDGE_REUSE | KNOWLEDGE_REUSE | `edge/knowledge_reuse` | `KNOWLEDGE_REUSE` | `[字符串同义]` | 第二章 `### E-39: KNOWLEDGE_REUSE` |
| E-40 | REPUTATION_FLYWHEEL | REPUTATION_FLYWHEEL | `edge/reputation_flywheel` | `REPUTATION_FLYWHEEL` | `[字符串同义]` | 第二章 `### E-40: REPUTATION_FLYWHEEL` |
| E-41 | TALENT_PROTECTION | TALENT_PROTECTION | — | — | `[待裁·名称层有同根候选]` | 候选 `TALENT_*` 4 项 |
| E-42 | ASSUMPTION_LINKAGE | ASSUMPTION_LINKAGE | — | — | `[待裁·名称层有同根候选]` | 候选 `ASSUMPTION_TRIGGERED_REALLOCATION`/`EXTERNAL_ASSUMPTION_BINDS` |

**计数核对**：`[字符串同义]` **13** ｜ `[语义同义·附仓内交叉引用件依据]` **6**（E-14/15/16/19/25/31）
｜ `[章间分歧·取第四章命名]` **2**（E-08/E-11）｜ `[章间分歧·待裁]` **2**（E-10/E-12）
｜ `[待裁·名称层有同根候选]` **17** ｜ `[待裁·名称层无同根]` **2**（E-01/E-26）
⇒ 13+6+2+2+17+2 = **42** ✅

### 3.3 章间分歧（4 条，**不得静默选一个**）

实测：**第二章**与「**第一章 ∩ 第四章**」对同一个 `E-NN` 给了**不同的名字**，分歧恰为 4 条：

| E号 | 第二章名（锚点 `### E-08: RESOURCE_ACQUISITION` 等） | 第一章名 / 第四章名（两章**一致**） | 词表可用性 | 本件取用 | 状态 |
|---|---|---|---|---|---|
| E-08 | RESOURCE_ACQUISITION | TALENT_FILTER | 第一章/第四章名 = 词表 `label` 逐字命中；第二章名落空 | 取该名 → `edge/talent_filter` | 🔴 **待 CTO 裁** |
| E-10 | DECISION_ALLOCATION | EQUIPMENT_DEPLOYMENT | 两版**都**不逐字命中（第四章名近 `EQUIPMENT_ACQUISITION`） | **不落库**（候选仅登记） | 🔴 **待 CTO 裁** |
| E-11 | TRUST_CONSTRUCTION | REPUTATION_ATTRACTION | 第一章/第四章名 = 词表 `label` 逐字命中；第二章名落空 | 取该名 → `edge/reputation_attraction` | 🔴 **待 CTO 裁** |
| E-12 | POWER_DISTRIBUTION | EFFICIENCY_FINANCING | 两版**都**不逐字命中（第四章名近 `EFFICIENCY_ATTRACTION`） | **不落库**（候选仅登记） | 🔴 **待 CTO 裁** |

**三章各自的证据（稳定锚点，非行号）**：

| 章 | 该章的 E 号定义形态 | 对 E-08/E-10/E-11/E-12 的命名 |
|---|---|---|
| 第一章 · 五断裂点穷举 | **无 `### E-NN` heading**；用**表格**与 `- **对应的边**：` 项目符号 | `| E-08 | TALENT_FILTER | 获取 | A4 |`、`| E-10 | EQUIPMENT_DEPLOYMENT | 获取 | A6 |`、`| E-11 | REPUTATION_ATTRACTION | 获取 | A7 |`、`| E-12 | EFFICIENCY_FINANCING | 获取（跨点） | A8 |`（**与第四章一致**） |
| 第二章 · 42条因果边权威定义 | `### E-NN: NAME`（42 条） | `### E-08: RESOURCE_ACQUISITION`、`### E-10: DECISION_ALLOCATION`、`### E-11: TRUST_CONSTRUCTION`、`### E-12: POWER_DISTRIBUTION` |
| 第四章 · 边节点映射矩阵 | `### E-NN NAME（…）`（42 条） | `### E-08 TALENT_FILTER（`、`### E-10 EQUIPMENT_DEPLOYMENT（`、`### E-11 REPUTATION_ATTRACTION（`、`### E-12 EFFICIENCY_FINANCING（` |

⚠️ **第二章自身亦不自洽**：第二章正文里 `E-12` 同时被写成两个名字 ——
heading `### E-12: POWER_DISTRIBUTION`，而同一章第七条边的后置边行又写
`E-12 EFFICIENCY_FINANCING（效率→外部融资信号）`。⇒ **第二章的 E-12 有两处互斥用法**（同一文件内）。

**实质**：第一章与第四章的这 4 个名字**恰好落在词表的命名面**上（`TALENT_FILTER`、`REPUTATION_ATTRACTION` 是词表现存 `label`），
第二章的 4 个名字则**对不上词表**，且第二章内部自相矛盾。⇒ 两套命名是**版本漂移**的产物，
且 **`E-08`/`E-11` 一侧（第一章＋第四章）对词表更"可用"**。
本件按「取能对上词表的那一版」处理 `$id` 栏，**同时把 4 条全部登记为待裁**（不静默、不代裁）。

### 3.5 待裁清单（19 条，**本件不落地**，上报 CTO）

**A 类（17 条）· 名称层有同根候选 —— 可能有同义边，但无仓内依据**：

```
E-02 PASSIVE_SIGNAL · E-03 EXTERNAL_ECHO · E-04 PERCEPTION_LEARNING · E-06 FINANCING_MIX ·
E-09 DATA_ACQUISITION · E-21 ORG_TRUST · E-24 INNOVATION · E-27 SERVICE_DELIVERY ·
E-30 PRICING · E-32 CHANNEL_EFFICIENCY · E-33 MARKET_COMPETITION · E-34 PROCUREMENT_POWER ·
E-35 CUSTOMER_DATA_FEEDBACK · E-36 COMPETITIVE_POSITION · E-37 PROFIT_REINVEST ·
E-41 TALENT_PROTECTION · E-42 ASSUMPTION_LINKAGE
```

**B 类（2 条）· 名称层与词表 56 个 `label` 无任何共同词根**：

```
E-01 ACTIVE_SCANNING · E-26 PRODUCT_DEFINITION
```

⚠️ B 类**只说明"名称层无同根"**，**不说明语义层无对应** —— 例如
`E-01 ACTIVE_SCANNING` 与词表 `ENVIRONMENTAL_SCAN`、`SENSING_CALIBRATION` 语义相近但无共同词根。
⇒ B 类同样进待裁清单，**不建议**直接登记为"词表确无此项"。

### 3.6 K4-01 前置：权威15 §3.5.1 那 8 条的字符串命中情况

| §3.5.1 的 E 号 | 本表依据类型 | 是否有**同标签**代码边 |
|---|---|---|
| E-07 | `[字符串同义]` | ✅ `edge/talent_acquisition` |
| E-17 | `[字符串同义]` | ✅ `edge/incentive_alignment` |
| E-23 | `[字符串同义]` | ✅ `edge/operational_execution` |
| E-38 | `[字符串同义]` | ✅ `edge/talent_retention` |
| E-15 | `[语义同义·附仓内交叉引用件依据]` | ❌ 无同标签边（可跨到 `edge/deploys`，**非同名**） |
| E-24 | `[待裁·名称层有同根候选]` | ❌ 无同标签边（候选 `INNOVATION_OUTPUT`） |
| E-25 | `[语义同义·附仓内交叉引用件依据]` | ❌ 无同标签边（可跨到 `edge/brand_builds`，**非同名**） |
| E-37 | `[待裁·名称层有同根候选]` | ❌ 无同标签边（候选 `PROFIT_REINVESTMENT`） |

⇒ **字符串同义 4 条 / 无同标签边 4 条**，与 K4-01 卡面 §Done④ 的「4 条」计数**同数**。
本件**只提供编号侧事实**，不代判 §3.5.1 的值域落法（属 K4-01 域）。

---

## 四、表 B：词表 56 件 → E 号（反查 · 入向）

**列义**：`同名字段` = 第二章/第四章中与之**逐字同名**的 E 号；`交叉引用件` = §2.2 那件给出的对应。

| `$id` | `label` | 同名 E 号（第二章＝第四章，已确权） | 交叉引用件 E 号 | 依据类型 |
|---|---|---|---|---|
| `edge/assumption_triggered_reallocation` | ASSUMPTION_TRIGGERED_REALLOCATION | — | — | 缺口（无对应 E 号） |
| `edge/augments` | AUGMENTS | — | E-29 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/brand_building` | BRAND_BUILDING | — | — | 缺口 |
| `edge/brand_builds` | BRAND_BUILDS | — | E-25 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/capital_acquisition` | CAPITAL_ACQUISITION | E-05 | — | `[字符串同义]` |
| `edge/capital_allocation` | CAPITAL_ALLOCATION | E-13 | — | `[字符串同义]` |
| `edge/capital_source_mix` | CAPITAL_SOURCE_MIX | — | — | 缺口（E-06 待裁候选） |
| `edge/channel_delivery` | CHANNEL_DELIVERY | — | — | 缺口（E-27/E-32 待裁候选） |
| `edge/competitive_positioning` | COMPETITIVE_POSITIONING | — | — | 缺口（E-36 待裁候选） |
| `edge/constrains` | CONSTRAINS | — | E-18 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/couples` | COUPLES | — | E-28 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/cross_functional_synergy` | CROSS_FUNCTIONAL_SYNERGY | E-28 | — | `[字符串同义]` |
| `edge/cumulative_learning` | CUMULATIVE_LEARNING | — | E-19 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/customer_data_loop` | CUSTOMER_DATA_LOOP | — | — | 缺口（E-35 待裁候选） |
| `edge/customer_lockin` | CUSTOMER_LOCKIN | — | — | 缺口 |
| `edge/data_collection` | DATA_COLLECTION | — | — | 缺口（E-09 待裁候选） |
| `edge/decision_authority` | DECISION_AUTHORITY | — | — | 缺口（E-10/E-14 待裁候选） |
| `edge/decision-concentrates` | DECISION_CONCENTRATES | — | E-14 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/demand_to_spec` | DEMAND_TO_SPEC | — | — | 缺口 |
| `edge/deploys` | DEPLOYS | — | E-15 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/efficiency_attraction` | EFFICIENCY_ATTRACTION | — | — | 缺口（E-12 待裁候选） |
| `edge/environmental_scan` | ENVIRONMENTAL_SCAN | — | — | 缺口（E-01 待裁候选·仅语义） |
| `edge/equipment_acquisition` | EQUIPMENT_ACQUISITION | — | — | 缺口（E-10 待裁候选） |
| `edge/external-assumption` | EXTERNAL_ASSUMPTION_BINDS | — | — | 缺口（E-42 待裁候选） |
| `edge/external_feedback` | EXTERNAL_FEEDBACK | — | — | 缺口（E-03 待裁候选） |
| `edge/funds` | FUNDS | — | E-13 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/goal_decomposition` | GOAL_DECOMPOSITION | — | — | 缺口（第 56 件，非 `edge-` 命名族） |
| `edge/incentive_alignment` | INCENTIVE_ALIGNMENT | E-17 | — | `[字符串同义]` |
| `edge/incentive-binds` | INCENTIVE_BINDS | — | E-17 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/information_flow` | INFORMATION_FLOW | — | — | 缺口（E-16 待裁候选） |
| `edge/innovation_output` | INNOVATION_OUTPUT | — | — | 缺口（E-24 待裁候选） |
| `edge/knowledge_reuse` | KNOWLEDGE_REUSE | E-39 | — | `[字符串同义]` |
| `edge/knowledge_sharing` | KNOWLEDGE_SHARING | E-20 | — | `[字符串同义]` |
| `edge/locks-in` | LOCKS_IN | — | E-31 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/market_share_capture` | MARKET_SHARE_CAPTURE | — | — | 缺口（E-33 待裁候选） |
| `edge/operational_execution` | OPERATIONAL_EXECUTION | E-23 | — | `[字符串同义]` |
| `edge/organizational_learning` | ORGANIZATIONAL_LEARNING | — | — | 缺口（E-19 待裁候选） |
| `edge/procurement_bargaining` | PROCUREMENT_BARGAINING | — | — | 缺口（E-34 待裁候选） |
| `edge/produces` | PRODUCES | — | E-23 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/profit_reinvestment` | PROFIT_REINVESTMENT | — | — | 缺口（E-37 待裁候选） |
| `edge/reputation_attraction` | REPUTATION_ATTRACTION | — | — | 缺口（**第四章 E-11**，待裁） |
| `edge/reputation_flywheel` | REPUTATION_FLYWHEEL | E-40 | — | `[字符串同义]` |
| `edge/retention_protects_knowledge` | RETENTION_PROTECTS_KNOWLEDGE | — | — | 缺口 |
| `edge/routine_rigidity` | ROUTINE_RIGIDITY | E-22 | — | `[字符串同义]` |
| `edge/rule_constraint` | RULE_CONSTRAINT | E-18 | — | `[字符串同义]` |
| `edge/sensing_calibration` | SENSING_CALIBRATION | — | — | 缺口（E-01 待裁候选·仅语义） |
| `edge/service_support` | SERVICE_SUPPORT | — | — | 缺口（E-27 待裁候选） |
| `edge/signal-transmits` | SIGNAL_TRANSMITS | — | E-16 | `[语义同义·附仓内交叉引用件依据]` |
| `edge/signal_upward_pass` | SIGNAL_UPWARD_PASS | — | — | 缺口（E-02 待裁候选） |
| `edge/talent_acquisition` | TALENT_ACQUISITION | E-07 | — | `[字符串同义]` |
| `edge/talent_deployment` | TALENT_DEPLOYMENT | — | — | 缺口（E-15 待裁候选） |
| `edge/talent_filter` | TALENT_FILTER | — | — | 缺口（**第四章 E-08**，待裁） |
| `edge/talent_retention` | TALENT_RETENTION | E-38 | — | `[字符串同义]` |
| `edge/tech_infrastructure` | TECH_INFRASTRUCTURE | E-29 | — | `[字符串同义]` |
| `edge/trust_friction_reduction` | TRUST_FRICTION_REDUCTION | — | — | 缺口（E-21 待裁候选） |
| `edge/value_pricing` | VALUE_PRICING | — | — | 缺口（E-30 待裁候选） |

**反查计数核对**：56 件 = 同名命中 **13** ＋ 交叉引用件命中 **12** ＋ 缺口 **31**；
两个命中集合**无交集**（同名命中的 13 条与交叉引用件的 12 条是**不同的文件** ——
例如 `E-18` 的同名件是 `edge/rule_constraint`，交叉件是 `edge/constrains`）。
13 + 12 = **25** 件有 E 号依据，25 + 31 = **56** ✅
⇒ 同一 E 号可挂**多条**代码边（多对多），已在上表如实并列，**不得据此推断一一对应**。

---

## 五、表 C：私有式 `E-x.y` → `$id`（经 `label` 中介，golden）

**中介链**：golden `edges["E-x.y"].label` → 词表 `label` → `$id`。
**禁**用形态归一（§1.2 第 4 条）。

| `E-x.y` | golden `label` | `$id` |
|---|---|---|
| E-0.1 | ENVIRONMENTAL_SCAN | `edge/environmental_scan` |
| E-0.2 | SIGNAL_UPWARD_PASS | `edge/signal_upward_pass` |
| E-0.3 | EXTERNAL_FEEDBACK | `edge/external_feedback` |
| **E-0.4** | **ASSUMPTION_LINKAGE** | **—（词表无此 label）** |
| **E-X.1** | **EXTERNAL_ASSUMPTION** | **—（词表无此 label；词表是 `EXTERNAL_ASSUMPTION_BINDS`）** |
| E-1.1 | CAPITAL_ACQUISITION | `edge/capital_acquisition` |
| E-1.2 | CAPITAL_SOURCE_MIX | `edge/capital_source_mix` |
| E-1.5 | SENSING_CALIBRATION | `edge/sensing_calibration` |
| E-1.6 | EQUIPMENT_ACQUISITION | `edge/equipment_acquisition` |
| E-1.8 | EFFICIENCY_ATTRACTION | `edge/efficiency_attraction` |
| E-2.1 | CAPITAL_ALLOCATION | `edge/capital_allocation` |
| E-2.2 | DECISION_AUTHORITY | `edge/decision_authority` |
| E-2.3 | TALENT_DEPLOYMENT | `edge/talent_deployment` |
| E-2.4 | INFORMATION_FLOW | `edge/information_flow` |
| E-2.5 | INCENTIVE_ALIGNMENT | `edge/incentive_alignment` |
| E-2.6 | RULE_CONSTRAINT | `edge/rule_constraint` |
| E-2.7 | CUMULATIVE_LEARNING | `edge/cumulative_learning` |
| E-2.8 | KNOWLEDGE_SHARING | `edge/knowledge_sharing` |
| E-2.9 | TRUST_FRICTION_REDUCTION | `edge/trust_friction_reduction` |
| E-2.10 | ROUTINE_RIGIDITY | `edge/routine_rigidity` |
| E-3.1 | PRODUCES | `edge/produces` |
| E-3.5 | SERVICE_SUPPORT | `edge/service_support` |
| E-3.6 | CROSS_FUNCTIONAL_SYNERGY | `edge/cross_functional_synergy` |
| E-3.7 | TECH_INFRASTRUCTURE | `edge/tech_infrastructure` |
| E-4.1 | **VALUE_PRICING** | `edge/value_pricing` |
| E-4.2 | **CUSTOMER_LOCKIN** | `edge/customer_lockin` |
| E-4.3 | CHANNEL_DELIVERY | `edge/channel_delivery` |
| E-4.4 | COMPETITIVE_POSITIONING | `edge/competitive_positioning` |
| E-4.5 | PROCUREMENT_BARGAINING | `edge/procurement_bargaining` |
| E-4.6 | CUSTOMER_DATA_LOOP | `edge/customer_data_loop` |
| E-4.7 | MARKET_SHARE_CAPTURE | `edge/market_share_capture` |
| E-5.1 | PROFIT_REINVESTMENT | `edge/profit_reinvestment` |
| E-5.2 | TALENT_RETENTION | `edge/talent_retention` |
| E-5.3 | KNOWLEDGE_REUSE | `edge/knowledge_reuse` |
| E-5.4 | REPUTATION_FLYWHEEL | `edge/reputation_flywheel` |
| E-5.5 | RETENTION_PROTECTS_KNOWLEDGE | `edge/retention_protects_knowledge` |

**计数**：36 键 ｜ 命中 **34** ｜ 未命中 **2**（`E-0.4`、`E-X.1`）✅

---

## 六、`_patch_d66.cjs` 的表态（**不许不表态**）

**实测**：

| 口径名 | 读数 | 口径 |
|---|---|---|
| `patch-d66-distinct` | **34** | 文件内 `E-\d+\.\d+` 去重个数 |
| `patch-d66-occurrences` | **119** | 文件内 `E-\d+\.\d+` 出现总次数 |
| `patch-d66-label-present` | **0 / 56** | 词表 56 个 `label` 在该文件内出现的个数 |

**结论（三句话）**：

1. `_patch_d66.cjs` 是 `E-x.y` 编号的**系统性载体**（34 distinct / 119 处），
   形态如 `'acquire-financial-data': { edges: ['E-1.1', 'E-1.2', 'E-5.1', 'E-5.2'], … }`。
2. 它**不含任何 `label`**（56 个 code `label` 在其中 **0 命中**），
   ⇒ **不能**作为 `E-x.y → $id` 的依据。**唯一**依据是 golden 的 `label`（§五）。
3. ⇒ 它的定位是「**编号集合载体**」，不是「映射依据」。**本件不改它、不进写集。**

**仓内可引原件身份证明**（B4）：见 §八 `ls-files` / `hash-object` 原始输出。

---

## 七、golden ↔ `GLOSSARY.md` 的矛盾：**已显式标注**

### 7.1 矛盾事实（实测）

| 位置 | 写着 | 与之冲突的仓内原件 |
|---|---|---|
| `docs/synova/GLOSSARY.md` 映射 4「决策集中」行 | `E-4.1 decision_centralization, E-4.2 info_flow` | golden：`"E-4.1": { "label": "VALUE_PRICING"`、`"E-4.2": { "label": "CUSTOMER_LOCKIN"` |
| 同上，映射 1 行 | 把 `E-3.5 fixed_cost_ratio` 标注为「**权威01**」 | 权威文档01 用两位式 `E-01…E-42`，**没有** `E-3.5` 形态 |
| 同上，第 156 行「因果边」定义行 | 把 `E-{大版本}.{小版本}` 定义为因果边 ID | 权威文档01 的定义面是 `E-NN`；词表定义面是 `$id` |

⇒ `GLOSSARY.md` 用的是**私有式 `E-x.y`**，且**与 golden 的同一编号指向不同的边**
（`E-4.1`：GLOSSARY 说 `decision_centralization`，golden 说 `VALUE_PRICING`）。**两处都无权威授权。**

### 7.2 处置（本件实际动作）

1. 在 `GLOSSARY.md` §二 表头加一条**显式注记**：本节 `E-a.b` 是私有历史编号、非权威，
   并指明权威编号与本件路径；把「（权威01）」改标为「（私有编号，非权威01）」。
2. **不改写**旧的 `E-a.b` 值 —— 因为**把 `E-4.1` 改成什么，本身需要裁定**（要么改成权威 `E-NN`，要么改成 `$id`），
   本件不代裁（属「要改卡面判据」类 ⇒ 已上报队长转 CTO）。
3. 矛盾**不静默**：本节即其登记处 + `GLOSSARY.md` 内的注记。

### 7.3 附带发现：`GLOSSARY.md` 的两处 E 号在词表里各有更近的候选（**仅为候选，不落库**）

```
GLOSSARY  E-4.1 decision_centralization  ↔ 词表 edge/decision-concentrates (DECISION_CONCENTRATES) → 交叉件 E-14
GLOSSARY  E-4.2 info_flow                ↔ 词表 edge/information_flow      (INFORMATION_FLOW)      → 无 E 号依据
```

---

## 八、复算方法（每条判据都可重跑）

```bash
# ① 引用对齐判据（本件 §1.3）—— 末行应为 occurrences=45 distinct=15 hit=15 miss=0
cd <repo> && node scripts/control-tower/probe-cycle-edges.ts          # exit 0

# ② 词表基数（应 56/56/56）
git ls-tree -r --name-only HEAD -- extensions/ontology/edge-types/ | wc -l
git ls-tree -r HEAD -- extensions/ontology/edge-types/ \
  | grep -oE '"edge/[a-z_-]+"' | sort -u | wc -l

# ③ 两章 heading 数（应各 42）
CH2=docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/SYNOVA-RESEARCH-第二章-42条因果边权威定义-v1-0-20260714.md
CH4=docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/SYNOVA-RESEARCH-第四章-边节点映射矩阵-v1-0-20260714.md
grep -cE '^### E-[0-9]{2}: ' "$CH2"     # 42
grep -cE '^### E-[0-9]{2} '  "$CH4"     # 42

# ④ golden 键数（36）/ label 命中（34）—— 用 tests/coordination/numbering-authority.test.ts 断言，或：
node -e "const j=require('./data/golden/wani-baby-v1.json');console.log(Object.keys(j.edges).length)"

# ⑤ _patch_d66.cjs（34 distinct / 119 处 / 0 个 code label）
RA=docs/synova/research/跨文档一致性审计-20260727/txt/哨兵-计算-本体三维映射-20260710_SYNOVA-RESEARCH-路线A-哨兵边双向审计-20260710.txt

# ⑥ 本件引用的逐件「可引身份证明」
git ls-files --full-name -- "$CH2" "$CH4" "$RA"
git cat-file -e ba1b22a8b5:"$CH2" && echo ok-ch2
git rev-parse ba1b22a8b5:"$CH2"          # blob(LF) 口径，见下表
```

**三件仓内原件的身份证明（实测原始输出）**：

| 原件 | `git ls-files` | `git cat-file -e ba1b22a8b5:<路径>` | blob @ `ba1b22a8b5`（`git rev-parse`） |
|---|---|---|---|
| 权威文档01 第二章 | 命中（git 追踪，mode 100644） | exit 0 | `6771008dc080082939f2bea7bfaf625a93faefb7` |
| 权威文档01 第四章 | 命中（git 追踪，mode 100644） | exit 0 | `0a61b40d7422dd73a8898d550189e0329aea57ba` |
| 路线A 交叉引用件 | 命中（git 追踪，mode 100644） | exit 0 | `afead721c4dfa3e5c201c908f63d47668fa8ce02` |
| （对照）golden | 命中（git 追踪） | exit 0 | `612dda6080236eafe94f96a668219469e7022f4f` |
| （对照）`_patch_d66.cjs` | 命中（git 追踪） | exit 0 | `c61b8cdded27d3e92cfc4ae3d74ffb81e970554b` |

⚠️ **哈希口径必须声明**：本 worktree 的 `core.autocrlf=true`，同一文件存在两个合法哈希：

| 口径 | 命令 | 适用 |
|---|---|---|
| **blob(LF) 字节** | `git rev-parse ba1b22a8b5:<路径>` | **本件引用外部原件时一律用这个口径**（与库内存储一致，跨机可比） |
| 工作树原始字节 | `git hash-object --no-filters -- <路径>` | 仅在讨论工作树磁盘字节时用 |

（实测差异示例：`cycles/builtin/cash-cycle.cycle.json` 的 blob(LF) = `411bcfc6bb4c75cbe2736cd55ca31062d47def04`，
工作树原始字节 = `d427398847231ce9d94d03364ea93b0583711eab` —— 两者不同，**混用即读数不实**。）

---

## 九、给下游的交接（K4-06 / K4-01）

1. **K4-06（五阀映射）**：五阀的 `edgeId` 写哪个编号 —— 本件裁定 = **写 `$id`**（`edge/<snake>`）。
   权威15 §3.4 示例里的 `E-05`/`E-13` 等是**文档侧 E 号**，落库前须经 §三 换算；
   换算不出来的（§3.5 那 19 条 + §3.3 那 4 条）**不得凭形态猜**。
2. **K4-01（`action_effect_lag` 值域）**：§3.6 给出 8 条 E 号的**字符串命中情况**（4 有 / 4 无），供其判据引用。
3. **编号纪律（新增）**：任何新写入的编号**只准** `$id`（`edge/<snake>`）；
   文档引用若必须用 E 号，须是两位式 `E-NN` 且在本件 §三 有 `[字符串同义]` 或已裁定的 `$id` 行。
   **禁**新写入 `E-x.y`。

---

## 十、留痕

- 基线：`ba1b22a8b5`（`k4b3/l1-238-239` 分支 base）。
- 本件为 **K4-05 / #238** 交付物之一；配套件 = `scripts/control-tower/probe-cycle-edges.ts`（判据④）、
  `tests/coordination/numbering-authority.test.ts`（本件核心断言的机器化）、
  `docs/synova/product-lines/evidence/K4-b3-238-*.md`（原始输出与反例造红证据）。
- 待裁项（§3.3 的 4 条 + §3.5 的 19 条）**已上报队长转 CTO**，不是本件的沉默缺口。
