# K4-b3-VERIFY-234 — 独立复核：#234（K4-01）`action_effect_lag` 值域迁移

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`k4b3/234` @ **`a96cd2b500e3f69a169d43c0d98b60a5d6b59530`**（`git ls-remote` 实测；父 = `ba1b22a8b5`，直挂 base）
> **diff 左端**：`ba1b22a8b5`｜**运行类证据**：全部在 `%TEMP%` 隔离副本完成（**未在任何人工作树写入**）
> **队内用语**：只给「自验结论」，不写「审计通过」。

---

## 〇、对象与写集

```
$ git log --oneline ba1b22a8b5..origin/k4b3/234
a96cd2b50 feat(k4-01): 234 action_effect_lag 值域迁移 — 5 条桶标签改数值区间 + 探针 + 判据件

写集 12 件（`git -c core.quotepath=false diff --name-only`）：
 A .claude/claims/234.yaml
 A .claude/task-briefs/2026-10-12-234-K4-01-值域迁移.md
 A docs/synova/product-lines/evidence/K4-b3-234-值域迁移-20261012.md
 M extensions/ontology/edge-types/{capital_acquisition,capital_allocation,cross_functional_synergy,
                                  operational_execution,talent_acquisition}.json      ← 5 件
 A memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
 A scripts/control-tower/probe-ontology-values.ts
 M tests/l4/edge-lag-unknown-degraded-1134.test.ts                                    ← 扩写集
 A tests/ontology/edge-lag-values.test.ts
```
- **12 件** 与队长回执一致 ✅；**不含 `claims/201.yaml` / `claims/345.yaml`** ✅（我实测 0 命中 —— 注：我第一遍用 `Select-String '201|345'` 得到 2 个"命中"，那是 **quotepath 八进制转义串里的数字**造成的**假阳**，改用 `-c core.quotepath=false` + 精确模式后 = 0。**我的口径错误，自陈**）
- 全部件 **BOM = none** ✅
- **跨线同路径（R15 家族）检查**：本分支的 `memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md` blob = **`b7fd9e1a0ab7536b46ae4129d4ec53439f6079f1`**，与 `k4b3/lead` / `k4b3/238-239` **同 blob** ✅ ⇒ **未复现过期快照问题**（L2 侧同步到位）。

## 一、三个口径点 ＋ 两条裁定 —— **逐条实测吻合** ✅

**① 5 件 JSON 的实际改动（`git diff` 原文）**：
```
capital_acquisition:      "immediate"   → "[0,0.5]"     ← CTO 明文换算 ✅
capital_allocation:       "1_month"     → "[0.5,1]"     ← 裁定 2 定稿值 ✅
cross_functional_synergy: "3-6_months"  → "[3,6]"       ← 桶图例换算 ✅
operational_execution:    "3-6_months"  → "[0,0.5]"     ← 🔴 与桶源相冲，按 §3.5.1 的 (0,0.5) 优先 ✅
talent_acquisition:       "1-3_months"  → "[1,3]"       ← 桶图例换算 ✅
```
- **口径点 1（桶数带口径）**：交付件 §0/§2.1 均写「迁移面 = 5 条桶标签」并给出分布 `immediate×1 / 1_month×1 / 1-3_months×1 / 3-6_months×2` ✅（与我 base 实测的桶分布**逐条一致**）。
- **口径点 2（`1_month` 定稿 `[0.5,1]`）**：实落值 = `[0.5,1]` ✅，且探针 `S351_UNCOVERED[E-13].basis` 把理由（保"区间→桶"换算唯一性）与"**无 CTO 明文 ⇒ 提请追认**"都写进依据字段 ✅（未冒充权威）。
- **口径点 3（E-25 排除迁移域）**：`brand_building.json` **不在**写集 ⇒ **值保持 `unknown`、未动** ✅（我实测 base 值 = `unknown`，且该文件不在 diff 中）。
- **裁定 4（迁移面 = 5 条桶标签；E-17/E-38 回退为 unknown）**：实测 `incentive_alignment.json` / `talent_retention.json` **均不在 diff 中**（0 改动）、base 值即为 `unknown` ⇒ **净值 = 保持 unknown** ✅（"回退"是过程描述；净交付 = 未改）。**"迁移面 = 5" 与 diff 完全一致** ✅
- **裁定 5（`registered=11`）**：见 §四（我拆解到**逐类**）。

## 二、🔴 a-1（须改，归 impl-c/impl-b）：**探针把 E-17/E-38 说成「无同标签边」——与它自己的表矛盾，且会误导一切引用该行的人**

**证据 1（我实跑该 tip 的探针，原文）**：
```
REPORT §3.5.1 八条中无同标签边（缺口登记·**不改值**） 6 条: E-15 HUMAN_DEPLOYMENT / E-17 INCENTIVE_ALIGNMENT /
       E-38 TALENT_RETENTION / E-25 BRAND_CONSTRUCTION / E-24 INNOVATION / E-37 PROFIT_REINVEST
```
**证据 2（该探针自己的表，原文）**：`S351_TABLE` 里 **E-17 / E-38 的 `alignment` 字段 = `'exact_label'`**（basis 明确写「label=INCENTIVE_ALIGNMENT **精确同标签命中**，但**本卡不改其值**（队长裁定 (a)）」）⇒ **它们不是"无同标签边"，而是"有同标签、依裁定不落值"**。
**证据 3（连违规消息也串了 — 我把 E-17/E-38 落成 §3.5.1 值后实跑）**：
```
❌ 缺口登记不符 file=incentive_alignment.json (E-17 INCENTIVE_ALIGNMENT §3.5.1 无同标签边)
   实测="[0.5,1]" 期望="unknown"（近邻 ≠ 同标签 ⇒ 禁据以自填值）
❌ 缺口登记不符 file=talent_retention.json (E-38 TALENT_RETENTION §3.5.1 无同标签边)
   实测="[3,6]" 期望="unknown"（近邻 ≠ 同标签 ⇒ 禁据以自填值）
```
⇒ 对 E-17/E-38 而言，**「无同标签边」与「近邻 ≠ 同标签」两句都不成立**（它们是精确同标签）；真实理由是你裁定 (a) 的「不在桶域内 ⇒ 无可迁移之物」——探针的表里写对了、**打印出来的话是错的**。
**影响**：① 该行是 `registered=11` 里"6"的来源，被队长/交付件/PR 反复引用；② 卡面 Done 要求点名的"**4 条**无同标签边"与该行的"6 条"会长期打架（见 §三）；③ 任何人想统计"无同标签边"都会拿到 6。
**处置建议**：给 `expectation: 'register_gap'` 加**子类**（`no_same_label`（4）vs `exact_label_not_migrated`（2）），REPORT 行与违规消息**按子类分别措辞**（前者"无同标签边 ⇒ 禁自填"，后者"依裁定 (a) 不落值 ⇒ 期望 unknown"）；总数行建议写「缺口登记 6 条（其中无同标签边 4 ＋ 有同标签·依裁定不落值 2）」。

## 三、🔴 a-2（须改，归 impl-b）：交付件 §5.1 的"原始输出"块**与同 tip 实跑不一致**，且**块内自相矛盾**

**交付件 §5.1 原文（同一代码块内）**：
```
── G3 §3.5.1 八条: 精确同标签·取值 2 条 + 无同标签·缺口登记 6 条          ← 写 6
REPORT §3.5.1 八条中无同标签边（缺口登记·**不改值**） 4 条: E-15 … / E-25 … / E-24 … / E-37 …   ← 写 4
RESULT=files=56 causal=55 noncausal=1 interval=5 unknown=50 registered=11 violations=0
```
**我在同一 tip（`a96cd2b50`，隔离副本、`node` 原生运行）实跑**：
```
RESULT=files=56 causal=55 noncausal=1 interval=5 unknown=50 registered=11 violations=0    ← RESULT 行完全一致 ✅
REPORT … 无同标签边（缺口登记·不改值） 6 条: E-15 / E-17 / E-38 / E-25 / E-24 / E-37       ← **6 条**，非 4
```
⇒ **同一代码块里"6"与"4"并存**，而实跑是 **6** ⇒ 该块**不能按"原始输出"复算**（很可能捕获自探针前一版，但**未标捕获时点/版本**）。
**处置建议**：用**实跑输出**替换该 4 条行（或标注"捕获于 <probe 版本/SHA>，与 tip 输出差 2 条"），并顺带按 a-1 改措辞。**纪律**：标"原始输出"必须可复算；本批新规「值 + 口径 + 时点」在这里应落到"**探针版本/提交**"这一维。

## 四、`registered=11` 口径拆解（队长点名项）—— **= 2 + 6 + 3**，我逐类复算并三点交叉验证

**来源（探针源码的三个累加点，原文行号）**：
```
L405 registeredCount += 1   ← expectation === 'align_value' 且值 == §3.5.1 期望
L414 registeredCount += 1   ← 非 align_value 且值 == 'unknown'（缺口登记）
L427 registeredCount += 1   ← S351_UNCOVERED（未覆盖项）且值 == 注册区间
```
**拆解**：
| 项 | 条数 | 成员 | 依据 |
|---|---|---|---|
| §3.5.1 **精确同标签且已对齐** | **2** | E-07 `talent_acquisition` `[1,3]`、E-23 `operational_execution` `[0,0.5]` | L405 |
| **缺口登记·保持 `unknown`** | **6** | E-15、E-17、E-38、E-25、E-24、E-37 | L414（其中 **4 = 真无同标签边**（E-15/E-25/E-24/E-37）＋ **2 = 有同标签依裁定不落值**（E-17/E-38））|
| §3.5.1 **未覆盖项·按 §3.4 换算落地** | **3** | E-05 `[0,0.5]`（rule）、E-13 `[0.5,1]`（derivation）、E-28 `[3,6]`（rule） | L427 |
| **合计** | **11** | | |
**三点交叉验证（我实跑）**：
```
迁移后（L2 tip 数据）        → registered=11   ← = 2 + 6 + 3 ✅
未迁移（base 数据）          → registered=6    ← 只剩"6"（另两组因未落值而不计数）✅ 自洽
模拟把 E-17/E-38 落成 §3.5.1 值 → registered=9  ← 11 − 2 ✅ 自洽
```
⇒ **`registered=11` 不是"聚合数缺口径"，它可被逐类复算**；但**它的"6"里混了两类**（= a-1），这才是需要修的地方。**归属：impl-b**（在交付件里把 11 拆成 2/6/3，并标 6 的子类）。

## 五、`interval=5` 判别性（队长点名项）—— **可分辨，且三态实测** ✅

```
迁移后（L2 tip）          → interval=5  unknown=50 registered=11 violations=0  EXIT=0   ✅
反例①（capital_acquisition 改回 immediate）      → interval=4 registered=10 violations=3 EXIT=1 ✅
反例②（operational_execution 改回 3-6_months）   → interval=4 registered=10 violations=3 EXIT=1
        且报**三连**：桶标签残留 ＋ 值域违规 ＋ 与 §3.5.1 相冲（＝卡面要求的"值域违规 **+** 与 §3.5.1 相冲"双报）✅
模拟"回退不执行"（E-17/E-38 落成 §3.5.1 值）      → interval=7  unknown=48 registered=9 violations=2 EXIT=1 ✅
复原（口径 W = Get-FileHash 原始字节 SHA256）      → 逐字节一致 = True，回 EXIT=0 / interval=5 ✅
```
⇒ **`interval` 是活计数**：5（正确态）／4（少迁一条）／7（多迁两条）三态可分辨，**不是硬编码**；`registered` 同步 11／10／9 ✅。
⇒ **对队长的"若回退不执行则为 7"：我独立复现为真**（且探针会红 exit 1，不会静默通过）。

## 六、跨卡口径核对（队长点名要判）：**E-25 在 #234「无同标签边」里 vs #238/#239「T5 不可判」——我判「不构成 F1」** ✅（同意你的倾向）

**判据（沿用我上一轮的分族标准 = 对策是否相同 ＋ 失效形态是否成立）**：
| | #234 的命题 | #238/#239 的命题 |
|---|---|---|
| 问的是什么 | 「**有没有一个 label 与权威名逐字相同的边**」 | 「**E 号的落点（哪条边）可不可判**」 |
| E-25 的取值 | **无**（`BRAND_CONSTRUCTION` ∉ 56 labels） | **不可判**（两依据相冲：交叉件指 `brand_builds`、类型列/权威01 指另一面） |
| 是否正确 | ✅ 正确（同标签层面确实没有） | ✅ 正确（落点层面确实两依据相冲） |
⇒ **两个命题问的是不同问题**，各自取值都正确 ⇒ **失效形态（"同一事实两个值"）不成立** ⇒ **不构成 F1**；属**口径缺口**（对策 = 补口径名 ＋ 互相点名，与 F1 的对策之一重合，但不足以归族）。
**但有一处必须一并改（这是本轮的实质收获）**：你引用的前提句「4 条：E-15/E-25/E-24/E-37」**用的是旧数**；**同 tip 探针实跑是 6 条**（含 E-17/E-38）⇒ 该 4 条行是 §三 的 a-2，**先把 a-2 改对**，再谈跨卡点名（否则互相点名会点到错数上）。
**建议的互相点名写法**：
- #234 侧：`E-25 BRAND_CONSTRUCTION：按【字符串同标签口径】= 无同标签边 ⇒ 期望 unknown（不改值）；其【落点判定】见 #238 §九.2.1 / T5（不可判·待裁）`
- #238/#239 侧：`E-25：按【E 号落点口径】= 两依据相冲 ⇒ 不可判；其【同标签面】见 #234＝无同标签边`
⇒ **R16 计数维持 4**（不因本条改 5），**但请在材料里写明"本次比对是口径差异、非 F1"**，否则下一位复核员会重走一遍。

## 七、其余复核

- **扩写集件 `tests/l4/edge-lag-unknown-degraded-1134.test.ts`**（213+/117−）：把"允许集"从**桶标签枚举**换成**字符串形区间域**，并在头注写明**必要性**（「否则本件会把 11 条已迁移的合法区间值全部误报成规范违规（实测：迁移后 **7** 条断言转红）」）⇒ **棘轮同步有据、非放宽**；且把"单源 = 探针的 `isInLagDomain`（K3 R1 禁第二套口径）"写死 ✅（**方向正确**）。
- **U8（口径缺口）已登记** ✅：E-17/E-38 有 §3.5.1 权威值但依裁定 (a) 未落值，且**反方依据未被埋掉**（"如实登记，未埋掉"）⇒ 处置得当。**⚠️ 提醒**：这是**卡面 Done（"值域全为 §3.5.1 数值区间"）与队长裁定 (a)（只迁 5 条桶标签）之间**的口径缺口，**归 CTO 追认**（你已登记，我仅确认其属"须追认"而非"可实现项"）。
- **b 类（未核）**：① **我未跑 vitest**（交付件 §5.2/§5.3 报 `2 passed / 57 passed`）—— 属重型验证，按纪律串行且我树内无 `node_modules` ⇒ **不冒充已跑**；② 探针的 `S351_TABLE` 与 §3.5.1 一手原文的**逐字一致性**我未逐行比对（我核的是"E 号↔文件↔期望值"三层与我的独立口径一致）。
- **c 类**：无跑不通项。两条自陈：① 我第一遍 `Select-String '201|345'` 命中 quotepath 转义串 ⇒ **假阳**（已改 `-c core.quotepath=false`）；② 我第一次写反例时用 `node -e` 内联脚本，被 PowerShell 引号处理吞掉（`ReferenceError: c is not defined`）⇒ 造红**未生效却报了 EXIT=0**；改**独立脚本文件**后重做才得到真红。⇒ **教训：造红必须用脚本文件 + 必须核"替换确实发生"**（我第二次加了 `NOT_REPLACED` 保护）。

## 八、结论用语

**`a96cd2b50`（#234 值域迁移）—— `可提请独立审计`**，附 **2 处必改**：
1. **a-1**：探针把 E-17/E-38 标为「无同标签边」（REPORT 行 ＋ 违规消息），与它自己的 `alignment='exact_label'` 矛盾 ⇒ 加子类并按子类措辞。**归属 impl-b**。
2. **a-2**：交付件 §5.1"原始输出"块内 **6/4 并存**，且与同 tip 实跑（**6**）不一致 ⇒ 用实跑替换或标捕获时点/版本。**归属 impl-b**。

**已证实为真**：三个口径点（5 件迁移值逐条对上／`1_month=[0.5,1]`／E-25 未动值）✅；裁定 4（迁移面 = 5、E-17/E-38 保持 unknown）✅；`registered=11` **= 2+6+3 可逐类复算**（三点交叉验证自洽）✅；`interval=5` **三态可分辨**（4/5/7 皆实测）✅；两条反例造红 + 口径 W 复原 ✅；跨线同路径 Note **同 blob**（未复现 R15）✅。
**跨卡 E-25：不构成 F1**（口径缺口；R16 维持 4）。
**未核**：vitest 实跑（b-1）；§3.5.1 逐行比对（b-2）。
