# K4-b3-VERIFY-1350 — 独立复核：#1350（= 板卡 #65 / K4-05bis）**A 段**卡面 ＋ claim

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：分支 `k4b3/l3-65` @ `afa582cd8034309b2866e1a5c6086f2bbf819d15`（`git ls-remote` 实测）
> **diff 左端**：`ba1b22a8b5`（所有读数在该 SHA 上取）
> **被审件**：`.claude/task-briefs/2026-10-11-1350-K4-05bis-边词表-目标层级边与计划边.md`（49044 B，562 行）＋ `.claude/claims/1350.yaml`（4059 B）
> **范围声明**：**本件只审 A 段（卡面 ＋ claim ＋ 核验件）**。**B 段（写 `extensions/ontology/edge-types/`）尚未开工** ⇒ V1/V2/V3 判据**无可复核物**。

---

## 〇、对象与字节

```
$ git ls-remote --heads origin | grep k4b3/l3-65
afa582cd8034309b2866e1a5c6086f2bbf819d15	refs/heads/k4b3/l3-65

claim.writeset 三件:
  .claude/claims/1350.yaml
  .claude/task-briefs/2026-10-11-1350-K4-05bis-边词表-目标层级边与计划边.md
  docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md

$ git -c core.quotepath=false diff --name-only ba1b22a8b5..afa582cd8   → 同上 3 条（逐条相等）
独立 SHA-1 比对 3/3 一致｜BOM 全 none
```
⇒ **claim.writeset ≡ 实 diff ≡ 3 件**，**零预授权、零越界**（无 `src/`、无 `extensions/`、无 `packages/`）。这一点做得对。

---

## 一、claim 的 6 条 `done:` 判据 —— **逐条实跑，6/6 通过**

| # | claim 声明（原文摘） | 我的实测命令与结果 | 判 |
|---|---|---|---|
| 1 | `git diff --name-only ba1b22a8b5..HEAD \| grep -c "^src/" \|\| true` ⇒ `0` | 实测 `^src/` 命中 = **0** | ✅ |
| 2 | `git ls-tree -r --name-only ba1b22a8b5 -- extensions/ontology/edge-types/ \| wc -l` ⇒ `56` | 实测 **56** | ✅ |
| 3 | `merge-base --is-ancestor 0b0601fac … && … 1ab0cbb33 … && echo BOTH_ANCESTOR` | 两条 `--is-ancestor` 均 **exit 0** ⇒ `BOTH_ANCESTOR` | ✅ |
| 4 | brief 六字段计数 ⇒ `6` | `^## Q0:\|^## Q1:\|^## Q2:\|^## Q3:\|^## 架构层:\|^## Done 标准` 命中 = **6**（逐行：Q0/Q1/Q2/Q3/架构层/Done 标准） | ✅ |
| 5 | `grep -c "^#CRITERIA: B"` ⇒ `1` | 命中 = **1** | ✅ |
| 6 | 禁入项（`edge-lag-unknown-degraded-1134` / `ontology-loader-param-bridge-1031`）⇒ `0` | 实测命中 = **0** | ✅ |

**判别力提示（供自验员/收件闸用）**：上表 **#2 / #3 / #6 三条对本段恒真** —— 它们断的是 **base 的目录计数 / base 的祖先链 / 本段不含某两件**，**不随 A 段产物变化**，因此**不得**当作"A 段成果"计入。真正有判别力的是 **#1（`src/` 前缀计数）、#4（六字段）、#5（#CRITERIA）** 三条（反证：#1 同一 grep 打 `1ab0cbb33^1..1ab0cbb33` 得 **1**）。
**归属**：impl-c / #1350 A 段（非缺陷，属口径分层，已同步记入 `K4-b3-VERIFY-1412.md` a-3）。

---

## 二、🔴 a-1（须队长处置）**B 段实际写面 > 任务板写集声明，也 > 队长的扩写集清单**

impl-c 在 brief 里**如实登记**了"卡面原写集不含这些件、是否纳入由队长裁定"（**不擅自扩，做法正确**）；claim 注释里也把 B 段计划件列为"**不预授权**"。但**任务板 `task-3` 的 `write_scopes` 与队长件 D4/R7 的扩写集声明尚未跟上**：

| 件 | 出现在何处 | 是否已在任务板 write scope | 是否已在队长扩写集（D4/R7） |
|---|---|---|---|
| `extensions/ontology/edge-types/goal_decomposes_to.json`（名待 N3/N4 认领） | claim 注释 L10 | ❌（task-3 说"放行时追加"） | ❌ |
| `extensions/ontology/edge-types/plan_commits_to.json`（同上） | claim 注释 L11 | ❌ | ❌ |
| `tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts` | claim 注释 L12 | ❌ | ❌ |
| **`extensions/ontology/manifest.json`** | brief **R-3「✅ 纳入本卡写集」**（队长裁定） | ❌ | ❌ |
| **`packages/ontology/src/edge-types.ts`** | brief L296/L304「**有生产消费方 ⇒ 纳入写集**」；claim 注释 L14 | ❌ | ❌ |
| `docs/synova/product-lines/evidence/K4-b3-1350-edge-vocabulary.md` | claim 注释 L15 | ❌ | ❌ |

**我独立复核了 `packages/ontology/src/edge-types.ts` 的"有生产消费方"这一前提（实测）**：
```
$ git grep -n "ALL_EDGE_TYPES" ba1b22a8b5 -- packages/ src/
packages/ontology/src/edge-types.ts:100:export const ALL_EDGE_TYPES: readonly EdgeType[] = [
packages/ontology/src/index.ts:20:  ALL_EDGE_TYPES,
src/l4/data-exporter.ts:12 / :183   ✔ 消费
src/l4/data-purger.ts:14   / :267   ✔ 消费
src/l4/entity-resolver.ts:14 / :215: return ALL_EDGE_TYPES.map(et => typeCounts.get(et) || 0);
⇒ 消费方 = 3 个 src/ 文件（与队长 R6 记「3 个」一致）
⇒ 该文件对象键数 = 52 / 数组条目数 = 52 / 注释自述 "All 52 edge types"（与 R6 的「52 条」一致，K4 定稿件的「51」为陈旧）
⇒ src/l4/entity-resolver.ts:215 使「向量维 = 数组长度」⇒ 52→54 **属行为变化**（与 R6 描述一致）
```
**风险（写给收件闸）**：若 B 段按 brief 落地，L3 的 PR 将包含 **6 件**（2 边件 ＋ 1 测试 ＋ manifest.json ＋ `packages/ontology/src/edge-types.ts` ＋ 1 evidence），且 `packages/ontology/**` 是**跨包**改动。任务板写集若不同步更新，会同时撞两件事：**M2「写集互斥/逐文件声明」** 与 **PR ≤12 文件 + 单域** 的判定口径（跨包 = 跨域）。
**处置建议**：放行 B 段**之前**，队长先 (a) 把上述件补进 `task-3` 的 `write_scopes`，(b) 在 D4/R7 的扩写集清单里显式登记，(c) 声明 L3 的 PR 是否仍算"单域"（若否 ⇒ 拆 PR）。
**归属**：**lead（任务板 + 扩写集声明）**；impl-c 已尽登记义务，**非 impl-c 缺陷**。

---

## 三、a-2（轻）brief 内部对 `packages/ontology/src/edge-types.ts` 的处置表述不一致

```
L219: packages/ontology/src/edge-types.ts （下游同步见「未决项」，未获写集前不动）
L296: **A. `packages/ontology/src/edge-types.ts`（`EdgeType` 常量 ＋ `ALL_EDGE_TYPES`）—— 有生产消费方 ⇒ 纳入写集**
L304: ⇒ **结论（按队长 D 裁定）**：**被生产代码消费（非文档）⇒ 纳入写集**。
```
⇒ L219 与 L296/L304 一处说"未获写集前不动"、一处说"纳入写集"。语义可调和（"纳入"= 已登记待放行），但**字面互斥**会让执行者两种读法都成立。
**归属**：impl-c / brief；处置 = L219 改为「已登记入写集，待队长放行后同 PR 追加」。

---

## 四、b 类（无法核实）

| # | 项 | 说明 |
|---|---|---|
| b-1 | **V1 / V2 / V3 判据** | B 段未开工 ⇒ **无可复核物**。其中 V1「与既有 56 件**同构**」仍缺**分隔符口径**（既有件 `$id` = 51 snake ＋ 5 kebab ＋ 6 单字，见 `K4-b3-VERIFY-prereq-2026-10-12.md` a-1）⇒ "同构"若按"统一下划线"实现，会与既有 5 件不一致。**须在 B 段开工前钉口径** |
| b-2 | 「#1031 的桥可读其字段」（V2 后半） | 依赖 B 段落地的字段形态；同时受 §3.5.1「对象形态 vs 字符串」争议影响（见 `K4-b3-VERIFY-lead-3ca12b9c.md`） |
| b-3 | brief 里 CTO 受理裁定**九项**的逐字性 | 本件只核其**存在与内部一致性**（#CRITERIA: B=1、六字段齐）；**未**逐字比对裁定原件（原件不在本仓，同 #66 核验件的 b-1 限制） |

---

## 五、c 类（跑不通）

**未发现。** 注：验 `#CRITERIA: B` 与六字段时，PowerShell 5.1 的 `$B`/`$b` **大小写不敏感**曾导致变量互相覆盖（路径变 `0`）—— 复核时变量名须带前缀。

---

## 六、d 类：结论用语

- **A 段（卡面 ＋ claim ＋ #66 核验件）—— `可提请独立审计`**：写集 ≡ diff（3 件）、6 条 done 全部实跑通过、三处已知漂移（基数 55→57 改 56→58；卡面【边界】与受理裁定的冲突；#1134 前置解除）均已显式处置，且**claim 明确"不预授权"**（好做法）。
- **B 段暂不可复核**，且**放行前须先补写集**（a-1）与钉"同构"分隔符口径（b-1）。
- 本件共 2 处须改（a-1 归 lead、a-2 归 impl-c），均不动 A 段结论。

---

# 七、第二轮：交付件 `K4-b3-1350-edge-vocabulary.md` 复核

> **对象**：`k4b3/l3-65` @ `0160b220313878b27cdaf2756b5280999ab3114b`（`git ls-remote` 实测）
> **被审件 blob** = `f6ab7e84db436b3216320bc5fb0571e7f80f1293`（14188 B，146 行，**BOM = none**）
> **diff 左端** = `ba1b22a8b5`；凡"逐件"读数一律**在 SHA 上取**（`git cat-file -p` 直读 blob，不经工作树）

## 7.1 前提表 P-1…P-12 —— **逐条复核，全部吻合**

| # | 件中声明 | 我的独立实测 | 判 |
|---|---|---|---|
| P-1 | `edge-types/` = **56** 件 | `git ls-tree -r --name-only ba1b22a8b5 -- extensions/ontology/edge-types/` 计 `.json` = **56** | ✅ |
| P-2 | E 号在本体目录 **0 命中** | `git grep -c -E "E-[0-9]" -- extensions/ontology/` → 无输出 **exit 1** | ✅ |
| P-3 | `$id` distinct **56**，全 `edge/` 前缀 | 逐件读 → **56 / 56**，前缀断言 `True` | ✅ |
| P-4 | `label` distinct **56** | 逐件读 → **56** | ✅ |
| P-5 | 分隔符三态 **45/5/6**；连字符 5 件 | 逐件正则 → **45 下划线 / 5 连字符 / 6 单字**；5 件名单与件内 §P-5 明细**逐字一致**（`decision_concentrates` / `external_assumption` / `incentive_binds` / `locks_in` / `signal_transmits`） | ✅ |
| **P-6** | **key-order distinct = 2**：53 件 11 键 canonical；3 件多插 `diagnostic_signals` | 逐件 `Object.keys()` 去重 → **distinct = 2**；**53 件 = 11 键**（`$id,label,tags,allowedFrom,allowedTo,requiredProps,optionalProps,consumed_by_sentinels,action_effect_lag,transfer_function,description`）＋ **3 件 = 12 键**（在 `transfer_function` 与 `description` 之间插 `diagnostic_signals`）= `brand_builds` / `couples` / `cumulative_learning`；`git grep -l diagnostic_signals` 命中也恰为这 3 件 | ✅ **精确吻合** |
| P-7 | `requiredProps` 无空 | 未复跑（低风险，件给逐件计数 `0/56`） | — |
| P-8 | 两新边名各 **2** 处，**零实现** | `GOAL_DECOMPOSES_TO` = **2 处**、`PLAN_COMMITS_TO` = **2 处**，均落在 `docs/.../1134-edge-lag-unknown-degraded-20261009.md:635` 与 `tests/l4/edge-lag-unknown-degraded-1134.test.ts:126`（**说明性文本/注释**）⇒ "零实现"成立 | ✅ |
| P-9 | 块级门禁改前基线 exit 0 | 未复跑（属重型/门禁类；且我上一轮已用同类门禁做过独立复跑，方法一致） | — |
| P-10 | `autocrlf=true`；`check-attr` 空；工作树 **56/56 CRLF** | `core.autocrlf` = `true`；**工作树逐件实测 56/56 含 CRLF、0 件纯 LF** | ✅ |
| P-11 | `'GOAL'` ← `goal-store.ts`；`'Goal'` ← `conversation-engine.ts` | `src/growth/goal-store.ts:169` = `store.createNode('GOAL', …)`；`src/agent/conversation-engine.ts:562` = `'Goal' as unknown as Parameters<typeof this.graphStore.createNode>[0],` **两处唯一串均逐字命中** | ✅ |
| P-12 | `PLAN` 在 `src/` 共 **3** 处**全为注释** | `git grep -n "PLAN" ba1b22a8b5 -- src/` = **3 处**：`goal-types.ts:206`（`PLAN-K6 §0`）、`evidence-retention.ts:10/11`（`#PLAN-expireold-wiring` / `#PLAN-d660-data-lifecycle`）⇒ **全为注释**、`'PLAN'` 字面量不存在 | ✅ |

## 7.2 🔴 a-1（须改）P-13 的**聚合数错**：不是「53 件存 CRLF」，实测 **10 件存 CRLF / 46 件存 LF**

件中 P-13 原文：「**blob 层：53 件存 CRLF / 第 56 件 `goal_decomposition.json` 存 LF**」。

**我的独立实测（口径 = 逐 blob `git cat-file -p <sha>` 原始字节，56 件全量）**：
```
blob 层含 CRLF 的件 = 10
blob 层纯 LF 的件   = 46
含 CRLF 的 10 件（全列，不截断）：
  augments.json            (CRLF=54, bareLF=0, bytes=1299)
  constrains.json          (CRLF=45, bareLF=0, bytes=1171)
  decision_concentrates.json (CRLF=39, bareLF=0, bytes=1030)
  deploys.json             (CRLF=70, bareLF=0, bytes=1714)
  external_assumption.json (CRLF=44, bareLF=0, bytes=1187)
  funds.json               (CRLF=54, bareLF=0, bytes=1223)
  incentive_binds.json     (CRLF=42, bareLF=0, bytes=1095)
  locks_in.json            (CRLF=41, bareLF=0, bytes=1031)
  produces.json            (CRLF=48, bareLF=0, bytes=1199)
  signal_transmits.json    (CRLF=56, bareLF=0, bytes=1437)
```
- **件里引用的 4 个样本逐个复算，全部吻合**：`augments` 1299 B / CRLF 54 ✔、`locks_in` 1031 B / CRLF 41 ✔、`signal_transmits` 1437 B / CRLF 56 ✔、`goal_decomposition` 1653 B / CRLF 0・裸 LF 35 ✔（⇒ "第 56 件存 LF" 这一半**成立**）。
- **错在聚合**：把"4 个样本里有 3 个 CRLF"外推成"53 件 CRLF"。
- **为什么样本没抓到**：件里选的 3 个 CRLF 样本恰好**全在那 10 件之内**（三件都是 legacy 组），而 46 件 LF 的大多数一件没采 ⇒ **样本支持假设、总体不支持假设**（典型抽样盲区）。
- **疑似串号线索（供定位，不作定论）**：`53` 这个数**同时出现在 P-6**（53 件 = 11 键 canonical 顺序）——两行可能串了。
- **正确表述建议**：「blob 层 **10 件存 CRLF / 46 件存 LF**（含 `goal_decomposition.json`）；工作树层 **56/56 CRLF**（autocrlf）⇒ **两层不一致确实存在**」——注意：**修正后结论方向不变**（两层不一致仍成立，因为 46 件 blob 为 LF 而工作树全 CRLF），故本条属**数字错、结论不倒**，但 **B 段"新件落哪一组"的依据必须换成 10/46**。
- **归属**：impl-c / 交付件 §一 P-13（**须改数**）；并建议对"聚合数"类判据补一条纪律：**给出 n 时须给"n 是抽样还是全量"**（本例 4 样本 vs 56 全量）。

## 7.3 其余复核（结构面，未逐条跑）

- §三「B 段待填清单」：**明确标注"本件当前不含以下内容"＋待放行** ⇒ 与"B 段冻结"一致 ✅（无"声称已做"）。
- §五「A 段写集全列（提交后复跑）」＋「未提交项（逐字登记）」：**登记未提交项**是为防"引用了不存在的件"，做法正确 ✅。
- §四 **W-11 跨域声明**：与本轮 a-1（写集缺口）呼应，方向正确 ✅。
- **未复核**：P-7 / P-9（未复跑）、§二 F 组完整分析（我已在 `K4-b3-VERIFY-1412.md` 独立复核过同组，此处未重跑）。

## 7.4 d 类：本轮结论用语

**交付件 `K4-b3-1350-edge-vocabulary.md`（A 段骨架）—— `可提请独立审计`**，附 **1 处必改（a-1：P-13 聚合数 53 → 10/46；样本明细本身正确）**。
**11 条前提（P-1…P-12 中我复跑的 10 条）逐条吻合，其中 P-6（key-order 2/53/3）与 P-12（`PLAN` 3 处全注释）精确到件名与行号** ⇒ 该件的前提实测**方法可靠**；唯一失分点是"用 4 个样本外推 56 件"。
**B 段仍不可复核**（写集未补、放行信号未到）；放行前请把 P-13 的数改掉，否则 B 段"新件落哪一组"会建在错数上。
