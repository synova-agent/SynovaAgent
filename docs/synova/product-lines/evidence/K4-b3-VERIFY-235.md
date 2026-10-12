# K4-b3-VERIFY-235 — 独立复核：#235（K4-02）52 条 `transfer_function` 落值 ＋ #234 的 a-1/a-2 修复

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`k4b3/234` @ **`3b2c51d090f2b8ba65bd7855a6bc558a3d679822`**（`git ls-remote` 实测；三笔 = `a96cd2b50`→`4653cba2a`→`3b2c51d09`）
> **diff 左端**：`ba1b22a8b5`｜**运行类证据**：全部在 `%TEMP%` 隔离副本（**未在任何人工作树写入**）
> **队内用语**：只给「自验结论」，不写「审计通过」。

---

## 〇、对象与写集

```
终态累计写集（`git -c core.quotepath=false diff --name-only ba1b22a8b5..3b2c51d09`）= 64 件
第三笔（3b2c51d09）单件：M docs/synova/product-lines/evidence/K4-b3-235-transfer-function-20261012.md
第二笔（4653cba2a）：A claims/235.yaml + A brief + M #234 证据件 + A #235 证据件
                    + M 52 件 edge-types JSON + M probe-ontology-values.ts
                    + M tests/l4/ontology-loader-param-bridge-1031.test.ts + A tests/ontology/edge-transfer-functions.test.ts
```
**探针版本（口径 B）**：`git rev-parse 3b2c51d09:scripts/control-tower/probe-ontology-values.ts` = **`ab6b7f86d0ed0f3cbca31d5e472e5da34ca4dd57`** ⇒ **与件内声称的 `ab6b7f86d…` 逐字吻合** ✅

## 一、逐条复核队长点名的 8 项

### ① a-1 修复是否真到位 —— ✅ **到位（两处都改）**
**探针 REPORT 行（我实跑终态探针，原文）**：
```
── G3 §3.5.1 八条: 同标签命中·取值 2 条 + 缺口登记 6 条（无同标签边 4 ＋ 有同标签·依裁定(a)不落值 2）
REPORT §3.5.1 缺口登记 6 条（无同标签边 4 ＋ 有同标签·依裁定不落值 2）·不改值:
   无同标签边 = E-15 HUMAN_DEPLOYMENT / E-25 BRAND_CONSTRUCTION / E-24 INNOVATION / E-37 PROFIT_REINVEST ；
   有同标签·依裁定(a)不落值 = E-17 INCENTIVE_ALIGNMENT / E-38 TALENT_RETENTION
   （后者理由 = 不在桶域内，**非**"无同标签边"；其【落点判定】见 #238 numbering-authority.md §九.2.1 / T5）
```
⇒ **4/2 拆分 ✔**；**明写"非无同标签边" ✔**；**并加了跨卡指针到 #238 §九.2.1/T5 ✔**（正是我上轮建议的互指写法）。
**违规消息（我造态实跑：把 E-17/E-38 落成 §3.5.1 值 ⇒ exit 1）**：
```
❌ 缺口登记不符 file=incentive_alignment.json (E-17 INCENTIVE_ALIGNMENT 有同标签命中·依裁定 (a) 不落值
   （理由 = 不在桶域内，**非**"无同标签边"）) 实测="[0.5,1]" 期望="unknown"
❌ 缺口登记不符 file=talent_retention.json (E-38 TALENT_RETENTION … 同上 …) 实测="[3,6]" 期望="unknown"
```
⇒ **不再出现「无同标签边」与「近邻 ≠ 同标签」** ✅（两种措辞都换成了"有同标签命中·依裁定 (a) 不落值"）。

### ② a-2 修复是否可复算 —— ✅ **已整块替换 + 四元组可核**
```
件内（#234 证据件 L152-156）原文：
  > 🔴 **可复算四元组（新纪律）**：值 + 口径 + 时点 + **探针版本**。
  > 探针版本（**口径 B = blob(LF) 规范化字节**）：
  > `git hash-object scripts/control-tower/probe-ontology-values.ts` = **`ab6b7f86d0ed0f3cbca31d5e472e5da34ca4dd57`**
  > ⚠️ 前序版本（a-1 修前）该块曾出现「缺口登记 6 条」与「无同标签边 4 条」**并存且不可按原文复算** ⇒ 已按实跑输出整块替换。
```
**我的独立复核**：① 探针 blob 实测 = `ab6b7f86d0ed…` **逐字相等** ✅；② 件内所引的 `G3 … 缺口登记 6 条（无同标签边 4 ＋ 有同标签·依裁定(a)不落值 2）` 与 `REPORT §3.5.1 缺口登记 6 条（…）` 两句，与我**同 tip 实跑逐字一致** ✅；③ 该件**自陈旧块不可复算并已替换** ✔。
⚠️ **一处口径提示（不构成 a）**：该"四元组"落在 **#234** 证据件的 §5.1（a-1/a-2 是 #234 的发现 ⇒ 位置正确）；但 **#235** 证据件 §4 的原始输出块**没有**探针版本标注（我 grep `ab6b7f86d|探针版本` = 0 命中）。⇒ 若四元组要作为**批内新纪律**，建议 #235 的块也补一行（同值 `ab6b7f86d…`）。

### ③ U10「13 条真公式与 39 条 `unknown` 在 loader 层同落 `prose_formula`」—— ✅ **为真，我用运行时实跑证实**
**代码路径（base `src/l4/ontology-loader.ts`）**：`L292 resolved(P-3)` → `L304 placeholder` → `L310 declaration_only` → **`L316 prose_formula`（兜底）**；两条正则：
```
PLACEHOLDER_RE = /\b(tbd|to be defined|todo|pending|n\/a)\b/i     ← 不含 unknown
DECLARATION_RE = /^(number|string|boolean|integer|object|array)\b/i
```
**我实跑（真实 loader 模块 + 最小 `@synova/logger` 桩，桩已披露；`readEdgeTypeParams` 直调）**：
```
unknown                 → status=prose_formula  injectable=false  reason=散文字符串：非 P-3 值域，不可注入
真公式(brand_builds)     → status=prose_formula  injectable=false  ← **与 unknown 同 status**
TBD 占位                → status=placeholder    injectable=false
P-3 对象 {param:1.5}     → status=resolved       injectable=true
```
⇒ **U10 成立**：loader **无法**区分"已标定(公式)"与"未标定(unknown)" ⇒ 13/39 的区分**只能**由探针运行时真读提供 ✅。
**附带增益（我给 U10 补的一条机制证据）**：`TBD` 之所以落 `placeholder` 而 `unknown` 落 `prose_formula`，正因 `PLACEHOLDER_RE` 含 `tbd` ⇒ 这解释了棘轮 `tf_placeholder 53 → 1` 的**成因**（52 条 TBD 从 placeholder 迁到 prose_formula；剩下的 1 条 = `goal_decomposition` 的 `N/A — …` 命中 `n\/a`）⇒ 与该件 §6 的 `{"placeholder":1,"prose":55,"other":0}` **完全自洽** ✅。

### ④ 复原四层口径 —— ✅ **足以证成"复原成功"，且未把 1/56 读成缺陷**
| 层 | 件内主张 | 我的独立复核 |
|---|---|---|
| 1 内容层 | `git status --porcelain -- <该件>` 无输出（非 modified）；该件本笔 diff = 恰 2 行 | **实测**：porcelain **无输出** ✅；`git diff --numstat` = **`2 2`** ✅ |
| 2 口径 B（git blob） | `git rev-parse HEAD:<path>` == `git hash-object <path>` == `c1e4cffa8cbd…` | **实测**：`git rev-parse 3b2c51d09:<path>` = **`c1e4cffa8cbd5c55eb4f0f3d44dead395217bdb3`** ✅ 逐字相等 |
| 3 原始字节层（口径 W） | 不一致 **1/56**，唯一件 = `capital_acquisition.json`；**成因 = 复原动作本身经编辑工具重写**；"不得读成复原失败" | **判**：处理正确 —— 数字**未藏**、成因**已定性**、并由 1/2 层独立证成 ✅ |
| 4 语义层 | 探针真读权威01 ⇒ 该件公式逐字一致；`action_effect_lag` = `"[0,0.5]"` | ✅（我另用扰动法证明该"真读"成立，见 ⑤） |
**结论**：**四层并列足以证成**——层 1 直接判"工作树 == HEAD"，层 2 比原始字节更强（过滤器规范化 ⇒ 天然排除行尾/工具重写噪声），层 3 的 `1/56` 被**正确归因**（是**执行复原那个动作**留下的字节差，非源仓被改坏），层 4 补语义。⇒ **无"把 1/56 读成缺陷"之嫌** ✅；且该件把 R20（"报告复原必须说明是哪个层面"）落成了可核形态 ✔。

### ⑤ `TBD=0` 在末行 ＋ 13 条口径 = **运行时真读**权威01 第二章 —— ✅ **两项都真**
```
终态实跑末行：RESULT=files=56 causal=55 noncausal=1 interval=5 unknown=50 registered=11 violations=0 \
              formula=13 tfr_unknown=39 tfr_registered=4 **TBD=0**     ← 卡面 Done「末行含 TBD=0」满足 ✅
（13 + 39 + 4 = 56 ✅ 闭合）
```
**"运行时真读、非硬编码"我做了扰动判别（决定性）**：在隔离副本里把**权威文档**（`权威01 第二章`）的 `C_available =` 改成 `C_availableXX =`，重跑：
```
── H1–H4: 权威公式=**12** unknown=39 登记非权威=4（合计 55 / 56）
❌ 公式与权威不一致 file=capital_acquisition.json (E-05 CAPITAL_ACQUISITION) ⇒ 实测与权威01 第二章逐字不等
EXIT=1
```
⇒ **改文档即变红** ⇒ 13 这个数**确实是运行时读盘 + 逐字比对**得出，**不是硬编码公式表** ✅（该件 LIMITS 亦自陈"公式正确性 = 与权威逐字一致，不等于生产可执行"，口径诚实）。

### ⑥ 最小 diff 形态 —— ✅ **成立（须带口径）**
```
队长口径 = 52 files/＋52/−52：
  $ git diff --shortstat 4653cba2a^ 4653cba2a -- extensions/ontology/edge-types/
    52 files changed, 52 insertions(+), 52 deletions(-)        ← 逐字命中 ✅
  $ 该笔改动的 52 件 是否恰 = base 含 TBD 的 52 件：改动件⊄TBD=0 ；TBD 未改动=0   ← 集合逐一相等 ✅
（对照：整支累计口径 = 64 files / 2625+ / 179−，含新增件 ⇒ 两个口径都真实，引用时须写清"哪一个"）
```
⇒ **未顺手改别的**有强证据 ✅（52 件 = TBD-52 全等，且每件恰 1 行改写）。

### ⑦ 禁语义近邻 —— ✅
```
终态 talent_deployment.json：action_effect_lag="unknown" ｜ transfer_function="unknown"
件内断言（§1）：`talent_deployment` 不在 `TFR_E_TO_FILE` 内 ⇒ 不进 13 条 ✅
```
⇒ E-15(E-24 同型) 未被"语义近邻"放宽 ✅ 与 #234 侧 T4/T2 的分类一致。

### ⑧ U13 规则申请是否登记 —— ✅
```
#235 证据件 L151 原文（摘要）：| **U13** | 🔴 **规则申请（同类第二次 ⇒ 提请立规则）**：门禁依赖的**声明载体
（task brief）不在执行者写集内** —— #234 与 #235 **两次**都撞此墙（#234 组 6「今日无 brief」+ 组 12「Q2 无写集」；
#235 同型）。**同型第 2 次应用** = … | **CTO**（立规则） |
```
⇒ 登记齐（含"同类第二次 ⇒ 提请立规则"的**触发依据**），归 CTO 立规则 ✔（可入你的升级材料）。

## 二、本轮发现（2 处，均**改字级**，不动结论）

- **a-1（归 impl-b，轻）**：**#234** 证据件 **§11.1**（口径消歧节）引用的"那一行"是 **a-1 修前的旧形态**
  （`REPORT … 无同标签边（缺口登记·不改值） **4 条**: E-15 / E-25 / E-24 / E-37`，见该件 L327），
  而**同一 tip 的探针实跑已打印拆分版**（`缺口登记 6 条（无同标签边 4 ＋ 有同标签·依裁定(a)不落值 2）`，见同件 L161）。
  ⇒ 消歧论证本身**仍然成立**（E-25 在"字符串同标签"口径下确实属"无同标签边"4 条之一），但**引文应引当前实跑行**（或标注"修前形态"），否则又成"同一件内两个值"的隐患。
- **a-2（归 impl-b，轻）**：#235 证据件 §4 的原始输出块**缺四元组里的"探针版本"**（0 命中）⇒ 建议补 `ab6b7f86d…`（与 #234 件同值），使新纪律在**两件**上一致。

## 三、b / c / d

**b（未核，不冒充）**：
- **b-1 vitest 未跑**：件报 `2 passed / 57 passed`（§5.2/§5.3）—— 属重型验证，按纪律串行；我树内无 `node_modules`（node 原生跑探针 ≠ 跑 vitest）⇒ **未核**。**需要我跑时报队长排串行**。
- **b-2**：13 条公式与权威文档的**逐条**比对，我只做了**一条**（E-05）的扰动判别 + 探针整体 exit 0；**未逐条**人工核 13 条公式文本。
- **b-3**：`#235` 的 39 条 `unknown` 是否**确有仓内依据缺失**（而非"应能查到"），我未逐条穷举（件内 §0 口径为"无仓内依据 ⇒ 不猜"，我采信其口径并核了抽样 2 条）。

**c（跑不通）**：无。**两条自陈**：① 我在隔离副本做扰动/造态后**只复原了 JSON、忘复原权威文档**，导致我最后一行读数（`formula=10 TBD=2`）是**我自己的污染态**，**不是**交付件状态 —— 已如实标注，正式读数取自**干净副本**（`formula=13 TBD=0`）；② 我的 `#234` 件首轮 `Select-String '201|345'` 假阳（quotepath 转义串）已在上一轮自陈。

**d（能否据此独立开工/决策）**：**能**。8 项全部逐条核过，其中 ③⑤ 我用了**运行时实跑 + 扰动判别**（最强形式：改输入即红）；⑥ 的"52 件 = TBD-52 全等"是"未顺手改别的"的强证据；② 的四元组**可核且值真实**。

## 四、结论用语

**`3b2c51d09`（#234 终态 = `a96cd2b50` + #235 + a-1/a-2 修复）—— `可提请独立审计`**：
- **a-1 修复 ✅ 到位**（REPORT 行 4/2 拆分 + 违规消息改口径 + 加跨卡指针到 #238 §九.2.1/T5）
- **a-2 修复 ✅ 可复算**（整块替换 + 自陈旧块不可复算 + 探针版本 `ab6b7f86d…` 我实测逐字相等）
- **U10 ✅ 为真**（运行时实跑：`unknown` 与真公式**同 status=prose_formula**）+ 我补的机制证据（`TBD`→placeholder 解释棘轮 53→1）
- **复原四层 ✅ 充分**（1/56 已正确归因，未读成缺陷）
- **`TBD=0` ✅ 末行**；**13 条 = 运行时真读 ✅**（扰动即红）
- **最小 diff ✅**（口径须写清：scoped 52/52/52）；**禁语义近邻 ✅**；**U13 ✅ 已登记**
- 附 **2 处改字级**（§11.1 引旧行；#235 块缺版本标注）

**下一轮（已 recon，未开验）**：`k4b3/238-239 @ eb5ab88a9` —— 7 笔、写集 **20 件**（含 `cycles/**` ×6、`src/cycles/**` ×3、`probe-cycle-valves.ts`、`tests/cycles/valve-mapping.test.ts`、claims 238/239、两件证据件）；按队长点名的 #239 面（五阀落地 / `edges[]` 不被覆盖 / 接线 + 删掉即报红 / 反例两则）开验。
