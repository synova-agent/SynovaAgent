# K4-b3-VERIFY-238 — 独立复核：#238（K4-05 编号权威表 ＋ 引用对齐判据）

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`k4b3/238-239` @ **`a6e927a9a7f1f62f3100d69723ae8cae2055b1ae`**（`git ls-remote` 实测；分支已于复核期间出现）
> **diff 左端**：`ba1b22a8b5`
> **本件状态**：**结构面已核（§一）**；**判据面（末行口径 / 反例造红 / 接线 / 测试真断言）待下轮**——本轮不冒充已核。

---

## 一、结构面

### 1.1 对象与写集

```
$ git ls-remote --heads origin | grep k4b3/238-239
a6e927a9a7f1f62f3100d69723ae8cae2055b1ae	refs/heads/k4b3/238-239

$ git log --oneline ba1b22a8b5..origin/k4b3/238-239
a6e927a9a feat(238): K4-05 编号权威表 + 引用对齐判据（判据④ 末行 occurrences=45 distinct=15 hit=15 miss=0）

$ git diff --name-status ba1b22a8b5..origin/k4b3/238-239   （7 件）
A  .claude/claims/238.yaml
M  docs/synova/GLOSSARY.md
A  docs/synova/coordination/numbering-authority.md
A  docs/synova/product-lines/evidence/K4-b3-238-numbering-authority.md
A  memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
M  scripts/control-tower/probe-cycle-edges.ts
A  tests/coordination/numbering-authority.test.ts
```
- 与 task-1 声明写集的对照：`claims/238.yaml`、`GLOSSARY.md`、`coordination/numbering-authority.md`、`scripts/control-tower/probe-cycle-edges.ts`、`tests/coordination/numbering-authority.test.ts`、`evidence/K4-b3-238-*` **均在声明内** ✅。
- ⚠️ **`memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md` 不在 task-1 声明写集内**（见 §1.2，事出有因但另有更严重的问题）。
- **PR 预算**：7 件（≤12）✅；域 = `docs/` ＋ `scripts/control-tower/` ＋ `tests/` ＋ `.claude/claims/` ＋ `memory/notes/`（多域，但属"一卡一封"性质，按治理产物口径可议）。

### 1.2 🔴 a-1（须处置）**同路径跨分支异构**：`memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md` 在两个分支上是**不同内容**

```
$ git rev-parse origin/k4b3/lead:memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
c972f7f5b52ab3e17f110a1de6916c3776d470cb      ← 队长版（已含第四轮 5 处订正）
$ git rev-parse origin/k4b3/238-239:memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
199780539be6b1d557aadf1351d609260e892043      ← L1 版（= 我两轮前审过的**旧版**）

blob 相同 = False；逐行差异 = 8 行
  L1 版（旧，<=）缺失的内容正是队长本轮订正后的：
    · 「最长 **480 字符（多数态口径）**」（旧版写 485）
    · 「🔴 修正后的准确自陈」整段：机器读字段零变化 / note 去引号（201 十处 947→937、345 四处 544→539）
    · 「引号策略教训：应转义 `\"`」
    · 「🔴 越界声明：201/345 不属本批任何卡 ⇒ 需 CTO 追认」
```
**风险（这是本条的要害）**：两条支**同时新增同一路径且内容不同** ⇒ 无论哪条后合入，都会**覆盖**先合入者；若 `k4b3/238-239` 后合，则**第四轮的订正内容被静默回退**（400 行左右的订正段落消失，且不会报冲突或报错——同一路径新增在合并时通常表现为"后者覆盖/需人工裁决"）。
**为什么不是 L1 的孤立失误**：该 Note 是为**满足 `scripts/control-tower/**` 的 Note 引用门禁**而存在；L1 需要它（其改的是 `probe-cycle-edges.ts`），但它**从未落 main**，L1 只能拿到某个快照 ⇒ **快照过期**。⇒ 属**跨分支单源文件的同步缺陷**。
**归属**：**lead（分支/单源治理）＋ impl-a（取了过期快照）**。
**处置建议（三选一，请队长裁）**：
1. **收敛到一条线**：Note 只由 `k4b3/lead` 携带，L1 分支**移除该文件**（改名后其 probe 仍在 `scripts/control-tower/`，会触发 Note 门禁 ⇒ 需同时确认门禁对该 PR 如何取 Note：若门禁只看**同 PR diff 内**是否有 Note，则 L1 必须自带一份 ⇒ 走方案 2/3）。
2. **两条线都带，但强制取队长版**：在 L1 分支上用 `git checkout origin/k4b3/lead -- <path>` 取**最新 blob**（`c972f7f5…`），并在 PR 正文声明"该件真源 = `k4b3/lead`"。
3. **先把 Note 合入 main**（单点落地），此后各线**引用 main 上的件**、不再各自新增 —— 这也符合 M 纪律「不引用未落 main 的路径」。
> 我倾向 **3 → 2**（先落 main 最省事且根治；短期按 2 保证不回退）。

### 1.3 待核（下轮，本件不冒充已核）

| # | 待核项 | 判据（我打算怎么测） |
|---|---|---|
| V-1 | 判据④ 末行字符串 `occurrences=45 distinct=15 hit=15 miss=0` | **必须在 `ba1b22a8b5` 上实跑 probe，取其原始输出末行**；并核 **`occurrences` 定义 = 跨口径求和（22+23）**，不得硬编码 |
| V-2 | 「删除即报红」判别性夹具 | 在 /tmp 副本删 1 条引用 ⇒ 末行应 `44` 且**非零退出**；复原后哈希一致（**口径 W：`Get-FileHash` 原始字节**） |
| V-3 | 编号权威表 `numbering-authority.md` 的**双向映射完整性** | 42 条 E 号是否**逐条**有 `$id`/`label` 对应或显式标"无落点"；**E-10/E-12 必须显式写"两版候选均 ∉ 词表"**；三源分歧**须并列三源**（不是两栏） |
| V-4 | GLOSSARY.md 改动 | `E-4.1/E-4.2`（L74）与两位式冲突是否**显式标注或解决**（不许留着不说）；改动是否只在这两行 |
| V-5 | 测试件 `numbering-authority.test.ts` | 有真 `expect()`；**覆盖正常/降级/边界**；且**不是"恒真"断言**（我对每一条 expect 做一次"改动输入是否变红"的反证选择） |
| V-6 | 接线（铁律 0-2） | probe 是否被**真实调用链**消费（`scripts/control-tower/**` 是否被 pre-commit/CI 调用）；只有 grep 命中不算 |

---

## 二、本轮结论用语

**`a6e927a9a`（#238 首笔）—— 结构面：1 条须处置（a-1 同路径跨分支异构）＋ 1 条越界登记（Note 不在声明写集）；判据面 6 项待核，本件不冒充已核。**
**a-1 的隐患等级高于"写集越界"**：它会在合并时**静默回退已完成的订正内容**，且不报错 —— 建议在收件闸前先定单源方案（§1.2 三选一）。

---

# 三、第二轮：判据面 8 项 ＋ 两条新问（全量实测）

> **对象**：`k4b3/238-239` @ **`0ff23b28c66c88c45bf4281d07e7c5f7eccc9fa4`**（`git ls-remote` 实测；含 Note 刷新笔）
> 全部读数在 `ba1b22a8b5` 或该 tip 上取；运行类证据在**独立副本**做（不入任何人的工作树）

## 3.1 ✅ 前置澄清：原 R15（同路径跨分支异构）**已消除**

```
$ git rev-parse origin/k4b3/lead:memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
b7fd9e1a0ab7536b46ae4129d4ec53439f6079f1
$ git rev-parse origin/k4b3/238-239:<同路径>
b7fd9e1a0ab7536b46ae4129d4ec53439f6079f1        ← 同一 blob ✅
$ git -C <各工作树> hash-object <该文件>
L1 / L2 / L3 三个工作树 = b7fd9e1a0a…（同 blob）✅；`D:\synova-wt`（主树）**不存在**该件
```
⇒ **两 ref ＋ 三工作树同 blob**；且该 blob 已含 **a-7 口径修订**（我实测 L19 现含「口径 = 规范定义 / 实际使用 = 5」）⇒ **合并前静默回退面已消除（截至本时点）**。
**我给的验证步骤（收件闸/合并前各跑一次）**：
1. `git ls-remote --heads origin | grep k4b3` 取双方 tip（**禁记忆值**）；
2. `git rev-parse <tipA>:<path>` 与 `git rev-parse <tipB>:<path>` **比 blob 相等**；
3. 若不等 ⇒ **先统一**（`git checkout <真源tip> -- <path>` 并提交）再合；
4. PR 正文声明**真源 = `k4b3/lead`**（该件作者线），其余线为副本。
**结构性残留（不构成 a，供你决策）**：该件只要仍在两条线上，就**每次编辑都会重新漂移**（本轮已实证一次）⇒ 建议走 §1.2 方案 ③（先单点落 main）。

## 3.2 V-1 ✅ 判据④ 末行 —— **我独立跑出，与件内声明逐字一致**

**方法**：把 base 的 `cycles/`＋`extensions/ontology/` 与该 probe 复制到**隔离副本**，用 Node v24 原生类型擦除运行（`node scripts/control-tower/probe-cycle-edges.ts`；该 probe **不调用 git**，我核过其无 `child_process`）。
```
PROBE_EXIT=0
align_occurrences = 45   align_distinct = 15   align_hit = 15   align_miss = 0
align_unknown_distinct = 0   align_vocabulary_id = 56   align_vocabulary_label = 56
✅ 结论：判据① 旧编号 = 0；判据② 全部取值 ∈ 代码边 $id ∪ label ∪ {unknown}；判据④ 引用对齐全命中；exit 0
occurrences=45 distinct=15 hit=15 miss=0        ← 末行逐字命中
```
- 与我独立口径一致（`edgeRefs` 22 ＋ `edgeId` 23 = 45；distinct 15）✅
- probe 头部**已把三个数的口径写死**（occurrences = 两类条数之和；distinct = 取值去重；hit = ∈($id∪label)）⇒ **非硬编码**（我另核：把一条改成不存在的 `$id` 后 distinct 变 16、hit 仍 15，见 V-2）✅

## 3.3 V-2 ✅ 判别性夹具（"删掉即报红"）—— **成立**，且复原用**口径 W**

```
反例前  Get-FileHash SHA256(cash-cycle.cycle.json 原始字节) = 7966B26BEBCD33426847752F97D2336939052CCC00F8654C4DF762C26138B8C5
造红    "edge/value_pricing" → "edge/does_not_exist_xyz"（1 处）
        运行 ⇒ align_miss = 1｜align_miss_values = edge/does_not_exist_xyz
               occurrences=45 distinct=16 hit=15 miss=1｜RED_EXIT = 1        ← 期望 1 ✅
复原    从 base 副本拷回 ⇒ Get-FileHash SHA256 = 7966B26B…（**逐字节一致 = True**）
        重跑 ⇒ occurrences=45 distinct=15 hit=15 miss=0｜GREEN_EXIT = 0     ← 期望 0 ✅
```
⇒ **判据可证伪（非恒真）＋ 三态齐（绿/红/复原绿）＋ 复原口径为原始字节（口径 W）** ✅

## 3.4 V-3 编号权威表 —— 主体成立，**1 处须同步**（见 a-1）

- 表 A **42 行全列**，六类依据类型齐；**计数核对** 13＋6＋2＋2＋17＋2 = **42** ✅（我复算：字符串同义 13 ✔、语义同义 6 ✔、章间分歧取第四章名 2 ✔、章间分歧待裁 2 ✔、待裁·有同根 17 ✔、待裁·无同根 2 ✔）。
- **章间分歧 4 条**：**三章并列**（第一章/第二章/第四章各自的定义形态与名字都给），并明写 E-10/E-12 **"不落库（候选仅登记）"** ✅ —— 与我实测的三源结论一致（且纠正了我第一轮"两栏"的表述）。
- **第二章自身不自洽**（E-12 同文件两名）已登记 ✅（与我实测一致）。
- §3.5 待裁 **19 条**（A 17 ＋ B 2）✅，并**显式声明 B 类"名称层无同根 ≠ 语义层无对应"** ✅（口径诚实）。
- 🔴 **a-1（须同步）**：**E-25 在件内自相矛盾**——
```
L191（表 A）：E-25 BRAND_CONSTRUCTION → `edge/brand_builds`｜[语义同义·附仓内交叉引用件依据]
L275（§3.6）：E-25｜[语义同义…]｜❌ 无同标签边（可跨到 `edge/brand_builds`，**非同名**）
L292（表 B）：`edge/brand_builds` ← E-25｜[语义同义…]
而你 2026-10-12 的裁定 = **E-25 无干净落点**（已移出 T2）
```
⇒ 同一件内「有 `$id`」与「无同标签边」并存，且**与你刚下的裁定相反** ⇒ **正是你报的 E-25 冲突的 #238 侧落点**（我判 **F1 同族**，见 §3.9）。**归属 impl-a（表 A/§3.6 需按裁定同步）＋ lead（裁定来源）**。

## 3.5 V-4 ✅ GLOSSARY 改动 —— 范围受控 + 冲突**已显式标注**（且所引 golden 事实为真）

```
diff 仅 2 处 hunk：① 第三节表头新增「编号口径注记」② 命名规范表「因果边」行加标注
L51 注记原文：例：本节映射 4 写 `E-4.1 decision_centralization`，而 golden 写 `"E-4.1": { "label": "VALUE_PRICING"`。**两处都无权威授权。**
我独立核 golden：E-4.1 = {"label":"VALUE_PRICING","value":0.4,"confidence":"medium"}   ← 注记所述**为真** ✅
             E-4.2 = {"label":"CUSTOMER_LOCKIN",…}
L83 旧行 `E-4.1 decision_centralization, E-4.2 info_flow` **保留原样**（未代改）✅（合"解决或显式标注"）
```
⇒ 冲突**未静默**，且未越权改写需 CTO 裁定的编号 ✅

## 3.6 V-5 测试件 —— 结构面合格；⚠️ **我未跑 vitest（见 b）**

```
行数=359  expect()=75  describe=8  it=19
覆盖（逐条读）：原件存在 fail-closed｜词表 56/56/56｜两章 heading 各 42 且集合相同｜
  章间分歧恰 4 条并逐条钉两章名字｜第二章自身不自洽(E-12)｜表 A 命中恰 13｜
  ★降级路径：29 条未命中**不得**被计为命中（含 4 条章间分歧）｜§3.5.1 的 8 条中命中恰 4｜
  golden 34/36 且未命中就是 E-0.4/E-X.1｜形态交集 24｜patch 34 distinct/119 处/0 个 code label｜
  判据④ 末行｜GLOSSARY 已显式标注｜19 条待裁逐条在件｜B2「测不出什么」五条在件
```
⇒ **有真断言 + 显式降级路径 + 边界项**（非空壳，铁律 48 形态合规）✅

## 3.7 V-6 ⚠️ 接线：**判据物存在，但无任何自动执行链**

```
$ git grep -n "probe-cycle-edges" ba1b22a8b5 -- scripts/pre-commit-check.sh .github/ .gitea/   → 零命中（exit 1）
引用面只有三类：① claims 的 verify 文本 ② `docs/synova/coordination/施工项登记.ts`（`{ run: 'npx tsx …', expectExit: 0 }`）
              ③ docs/evidence
$ git grep -n -E "execSync|spawnSync|run:|expectExit" ba1b22a8b5 -- scripts/control-tower/check-registry-invariants.ts → 零命中
```
⇒ 该登记件的消费方（`check-registry-invariants.ts` / `probe-delivery-hygiene.sh` / `probe-packaging.sh`）**校验登记而不执行其中的 `run:`**；pre-commit / CI 也不调用它 ⇒ **"判据存在但无人跑"**。
**判定**：**不构成 #238 卡面 Done 违背**（卡面要求探针存在且 exit 0），但属**"恒绿"隐患**：判据只在人手动跑时才有约束力。**建议（另案）**：把 probe 挂进 pre-commit 或 CI 的相应组（与 `check-content-coupling.sh` 同级）。**归属：CTO/控制塔（另案）**。

## 3.8 新问 (a)：`valves[].edgeId` 用 `E-NN` —— **"8 个"可复现，但必须挂口径**

**我实测（口径 = 6 件 WIP cycle 的 `valves[*][*].edgeId` 全量去重）**：
```
distinct edgeId = 21                                    ← 与「§3.4 用到的 21 个 E 号」一致 ✅
严格字符串口径（只认 $id 或 label 逐字命中）⇒ 可映射 10 / 不可映射 11
表 A 口径（含 4 条「语义同义·附仓内交叉引用件依据」）且 E-25 已剔 ⇒ 21 − 13 = 不可映射 8
   8 = {E-01, E-04, E-06, E-25, E-30, E-34, E-35, E-37}
```
- **锚点真实性我已独立核（6/6 存在）**：`DECISION_CONCENTRATES E-14`、`DEPLOYS E-15`、`SIGNAL_TRANSMITS E-16`、`CUMULATIVE_LEARNING E-19`（2 处）、`BRAND_BUILDS E-25`（2 处）、`LOCKS_IN E-31` 全部命中，位于 `docs/synova/research/跨文档一致性审计-20260727/txt/*` ⇒ **不是凭形态猜**（impl-a 的抗辩成立）。
- **与 §3.5 的 19 条对账**：8 个中 **7 个在 19 条内**（E-01/04/06/30/34/35/37）；**E-25 不在**（它由你的新裁定单列）⇒ **差集 = E-25，已另有裁定** ⇒ 对账**成立**，但"19 条"与"8 个"之间**缺一句解释**。
- ⚠️ **a-2（口径未标，归 impl-a/lead）**：同一个数在**两套合法口径**下是 **11（严格字符串）** 与 **8（表 A 含语义同义锚点 + E-25 剔除）** ⇒ 按本批新规「值 + 口径 + 时点」，交接注记里的「8 个换算不出 `$id`」**必须挂口径**，否则不可复核。
- **对 lead 的两条疑虑（E-15→`deploys`、E-31→`locks-in`）的独立判定**：**锚点能拿到** ⇒ 按你"拿不到锚点即并入待裁"的规则，这两条**不满足并入条件**；但**"有锚点 ≠ 语义等价成立"**（锚点是某审计文档的对照表，属**二级依据**）⇒ 建议维持「语义同义 + 标依据类型 + 保留疑虑为待裁」，**不要**因"更像"改判（那会变成形态推断）。

## 3.9 新问 (b)：`valves` 是否**逐字**来自 doc15 第一章 §五 —— ✅ **6/6 逐条一致**

```
§五「出厂商内置循环模板」共 6 块（按 `"name"`）：现金流循环 / 客户循环 / **人才循环** / **产品循环** / 门店复制循环 / ARR增长循环
按 **name ↔ cycleId** 配对后逐阀比对（阀名集合 + 每阀 (edgeId|actionEffectLag) 序列）：
  cash-cycle ↔ 现金流循环 ✅｜customer-cycle ↔ 客户循环 ✅｜product-cycle ↔ 产品循环 ✅
  talent-cycle ↔ 人才循环 ✅｜store-replication ↔ 门店复制循环 ✅｜arr-growth ↔ ARR增长循环 ✅
  ⇒ 六件全部逐条一致 = true（条数 6/6/6/7/9/9 ＝ 43 条；distinct edgeId = 21）
```
**方法学自陈（我的第一次比对是错的）**：首轮我按**位置**配对（假设 §五 顺序 = cash/customer/product/talent/…），得出"产品/人才两件全阀不一致"的**假差异**；改用 **name ↔ cycleId 配对**后 6/6 一致。⇒ 教训：**跨文档比对必须先钉配对键，禁按位置**（与"抽样→总体"同族的方法错）。
**归属**：impl-a 的"逐字"声明**成立** ✅；我未发现差异。

## 3.10 顺带发现（a-3，风险提示，归 lead/impl-a）

`D:\k4b3-l1-238-239` 工作树 `git status` 显示 **`M .claude/claims/201.yaml` / `M .claude/claims/345.yaml`**（即你那笔 **R11 越界修复**的内容在 L1 工作树里**未提交**地存在）。
⇒ 风险：**#239 提交时若 `git add -A`，会把你那笔跨卡修复一并带上**（越界传播）⇒ 请要求 impl-a **只 add 自己写集内的件**（并在提交前 `git status` 逐条核对）。**与 R15 同源（跨线同路径）。**

## 3.11 结论用语（#238 判据面）

**`0ff23b28c`（#238 交付，含 Note 刷新笔）—— 判据面 `可提请独立审计`**：
- **V-1 ✅／V-2 ✅**（我独立跑出末行逐字命中；删引用即报红 exit 1；复原口径 W 逐字节一致）
- **V-3 ✅ 主体**（42 行全列、计数 42 自洽、三章并列、E-10/E-12 明标不落库）＋ **a-1（E-25 件内自相矛盾且与裁定相反，须同步）**
- **V-4 ✅**（范围受控、冲突显式标注、所引 golden 事实为真）｜**V-5 ✅ 结构**（75 expect/含降级；**未跑 vitest**）｜**V-6 ⚠️**（无自动执行链，另案）
- **新问 (a) ✅ 8 可复现但须挂口径（a-2）**；**(b) ✅ 6/6 逐字一致**（我的首轮配对错误已自陈）
- **a-3**：#239 提交时勿把 201/345 的未提交改动带入。
**全程未在任何实施工作树写入；运行类证据均在 `%TEMP%` 隔离副本完成。**

---

# 四、第三轮：tip 前移后的复核（`932c9db50`）—— **a-1 / a-2 均已解决，且解法比我报的更细**

> **时点**：`k4b3/238-239` 在我第二轮复核期间由 `0ff23b28c` 前移至 **`932c9db5054fe0905e1ad75e69bb322bcc9262f3`**（1 笔：`docs(238): §九 交接注记订正 —— 五阀 edgeId 口径改为 E-NN（原写 $id，作废）`）。
> ⇒ §三 的判定**只对 `0ff23b28c` 有效**；本节独立复核新笔。

## 4.1 a-1（E-25 件内矛盾）—— **已解决（多了一个形态）**

```
新件 L530：| **T5** | **落点两依据相冲 ⇒ 不可判** | **1** | `E-25` `BRAND_CONSTRUCTION` |
新件 L534-541：### 2.1 ⚠️ `E-25` 的落点（**不可判**，订正痕迹见下）
              · 前一版（本件 §三 表 A）把 `E-25` 记为 [语义同义…] → edge/brand_builds；**本条订正为「不可判·待裁」**，理由 = 依据相冲
              · 依据甲（交叉件）指 edge/brand_builds；权威中文名「品牌建设」亦指 brand_builds
              · 但类型列 = 转化、权威01 给的是 BRAND_CONSTRUCTION 的 tf 雏形 ⇒ 不可判
新件 L559：T5 的 E-25 ∉ 19 条、∉ 4 条章间分歧 ⇒ 属【本件新增的第 5 类】（依据相冲型）
```
⇒ **订正留痕（不抹旧）＋ 给 E-25 找到了归属类（T5）＋ 算了它对下游的后果**（「待裁不是纸面问题，它已卡住 6 件循环里的 7 个阀位」）。**我报的 a-1 已闭** ✅。
**残留 1 处（轻微，供你决定是否改）**：**表 A 的那一行（L191）本身仍写 `edge/brand_builds`**，只有 §九.2.1 写了"前一版表 A 已订正" ⇒ **只看表 A 的读者仍会取到已作废的 `$id`**。建议在该行加一个内联指针（如 `[订正→§九.2.1]`），与你在 §七bis 用的"原陈述保留＋指针"同法。

## 4.2 a-2（"8 个"缺口径）—— **已解决，且改成了自检分解表**

新件用 **T1–T5 五类分解**取代了孤立的"8"：
```
| T1 | [字符串同义]（权威名 = 词表 label 逐字）              | 9 | E-05 07 13 17 20 22 23 38 40 |
| T2 | [候选] 依据 = 路线A交叉引用件（效力低于权威01 ⇒ 只是候选，不是落点） | 3 | E-15/deploys、E-19/cumulative_learning、E-31/locks-in |
| T3 | [章间分歧·取第四章命名]（有 $id 但落点待裁）           | 1 | E-08→edge/talent_filter |
| T4 | 无 $id 落点（§三 $id 栏为 —）                          | 7 | E-01 04 06 30 34 35 37 |
| T5 | 落点两依据相冲 ⇒ 不可判                                | 1 | E-25 |
自检：9 + 3 + 1 + 7 + 1 = 21 ✅（口径 = 6 件 cycle 的 valves[*][].edgeId 去重）
```
**我的独立复算（逐类比对，全部吻合）**：
- distinct edgeId = **21** ✅；**T4 的 7 条 = 我算出的「不可映射且 ∈ §3.5 的 19 条」那 7 条，逐条一致** ✅
- T1 = 我的严格字符串命中 10 条 **减去** T3 的 E-08 ⇒ 9 ✅（口径差已被 T3 显式承接）
- T2 = 3 ✅（E-14/E-16 虽同为依据相冲型但**不在** valves 集合内，故不出现，计数自洽）
- **口径已写**（"口径 = 6 件 cycle 的 valves[*][].edgeId 去重"）⇒ **a-2 闭** ✅
- **对账成立**：T4 的 7 条 ⊆ §3.5 的 19 条（我逐条核过）；T5 单列为第 5 类 ⇒ **"19 条"与"不可映射数"的差集已有解释** ⇒ 不再构成 F1 形态 ✅
- **副作用自查也为真**：新件称「#238 判据① 的正则是 `E-[0-9]+\.[0-9]+`（**带小数点**），`E-NN` 不匹配 ⇒ 写 `E-NN` 不会让 `legacy_occurrences` 变红」—— 我核 probe 头与该正则：确为带小数点的私有式；`E-05` 无小数点 ⇒ 不匹配 ✅（**这条自检很有价值：它避免了下游"写 E-NN ⇒ 把 #238 判据① 打红"的连锁**）

## 4.3 结论用语（第三轮）

**`932c9db50`（#238 §九 订正笔）—— `可提请独立审计`**：a-1、a-2 **两处均已闭合**，且以"五类分解 + 自检 = 21 + 副作用自查"的方式闭合，**优于我原报的处置建议**；口径已挂、订正留痕完整。
**残留**：① 表 A L191 建议加内联指针（§4.1）；② §三 其余判定（V-1/V-2/V-4/V-5/V-6）**未在新 tip 上重跑**——其中 **V-1/V-2 依赖 probe 与 cycles**（新笔未触及）⇒ 结论可平移；**V-5 测试件同样未触及**；**V-6（无自动执行链）不变**。

---

# 五、第四轮：队长点名要核的一问（`MISS` 是否曾用于 E-25）—— **答案：从未**

> 队长问：「核一句：**impl-a 件里是否出现过 `MISS` 字样用于 E-25**（grep 全件）？」
> 若从未 ⇒ F1 第 4 例**仍成立**，但归属应写「**队长底稿 / impl-a**」而不是「#238 vs #239 内部矛盾」。

## 5.1 答案：**从未出现**（且全件唯一 `MISS` 命中是假阳）

```
$ git grep -n "MISS" <每个 tip> -- docs/synova/coordination/numbering-authority.md \
      docs/.../K4-b3-238-numbering-authority.md tests/coordination/numbering-authority.test.ts .claude/claims/238.yaml
tip a6e927a9a  → 1 处
tip 0ff23b28c  → 1 处
tip 932c9db50  → 1 处
三处均为同一行：numbering-authority.md:182

$ 打印该行全文（168 字符，逐字）：
| E-16 | INFO_TRANSMISSION | INFO_TRANSMISSION | `edge/signal-transmits` | `SIGNAL_TRANSMITS` | `[语义同义·附仓内交叉引用件依据]` | 交叉引用件串 `SIGNAL_TRANSMITS E-16 INFO_TRANSMISSION` |

⇒ 该行**并不含 MISS 标记** —— 命中来自单词 **TRANSMISSION** 里的子串 `…SMISSION…`，
  我实测：`/MISS/.test('TRANSMISSION') === true`（**假阳**）。
```
**结论**：impl-a 的 #238 全件**从未**使用 `MISS` 标记（对 E-25 没有，对其他 E 号也没有）。**impl-a 的抗辩成立** ✅。
**我的方法学披露**：我第一次做的是 `git grep "MISS"` 得「1 处」，若只看计数就会误判为"用过一次"；**必需打印命中行全文才能发现是子串假阳** ⇒ 与 F2（判据自身缺陷）同族：**子串匹配必须带边界**（此处的 "边界" = 词边界或人工看全文）。

## 5.2 但 **F1 第 4 例仍成立** —— 且证据基础可**不依赖任何 WIP**

我原判的两个"值"其实来自两处**已提交件**（复核后更硬）：
```
值A（队长底稿，已提交于 k4b3/lead，至 60518b4d0 仍在）：
   docs/synova/product-lines/evidence/K4-b3-crosswalk-238.txt  L50
   → MISS E-25 BRAND_CONSTRUCTION  ⇒ 词表无同名项                     （= 不可判）
值B（impl-a 件，已提交于 L1 的 a6e927a9a / 0ff23b28c）：
   docs/synova/coordination/numbering-authority.md  L191
   → | E-25 | BRAND_CONSTRUCTION | BRAND_CONSTRUCTION | `edge/brand_builds` | `BRAND_BUILDS` | `[语义同义·附仓内交叉引用件依据]` |
      （= 可落，且给了 $id）
```
⇒ **同一 E 号、两个值、两件均已落库** ⇒ **F1（同一事实两处取值不同）成立**，**归属 = 队长底稿 / impl-a**（照你的修正）✅。
**并且我撤回一个不精的表述**：我上一轮写「`#238` crosswalk A 把 E-25 判 MISS，而 `#239` T2 把 E-25 当…可落」——**crosswalk A 是你的底稿**（我全程按你的件核），但"#238 … vs #239 …"的框易被读成**两张卡内部矛盾**。**该框应改为「队长底稿 vs L1 件」**。我认这条表述不精确。
**另**：**#239 的 T2 内容至今仍是 WIP（未提交）** —— 我实测 L1 工作树 `git status` 仍是 `?? scripts/control-tower/probe-cycle-valves.ts` / `?? tests/cycles/valve-mapping.test.ts` / `M cycles/**` ⇒ 按纪律**未提交内容不得作为交付物证据** ⇒ **F1-4 只用上面两处已提交值即可，无需引用 WIP**（这比原判更干净）。

## 5.3 顺带时点观察（供你排程）

```
D:\k4b3-l1-238-239  git status（我实测，只读）
 M  docs/synova/coordination/numbering-authority.md      ← 已 **staged**（应为 a-1 残留的内联指针笔）
 M  .claude/claims/201.yaml / 345.yaml                   ← **仍未 stage 的越界传播面**（a-3 风险仍在）
 M  cycles/**×6 ；M src/cycles/{cycle-loader,cycle-types,overflow-compute}.ts   ← #239 WIP
 ?? scripts/control-tower/probe-cycle-valves.ts ；?? tests/cycles/valve-mapping.test.ts
```
⇒ ① a-1 残留那笔**已在暂存区**（你压 #239 放行到它之后，方向对）；② **a-3 风险仍未消除**（201/345 仍在工作树里未 stage 地存在）⇒ 放行条件里的"**禁 `git add -A`**"必须保留并当面核一次。

## 5.4 本轮结论用语

**队长本轮请我核的一问 —— 答案明确：`MISS` 从未用于 E-25（全件唯一命中是 `TRANSMISSION` 子串假阳）**；⇒ **F1 第 4 例仍成立，归属改为「队长底稿 / impl-a」**（我背书你的修正），且证据基础**只用两处已提交值**、不依赖 #239 WIP。
**我的两条自陈**：① "MISS 1 处"若不打印全文即会误判（子串必须带边界）；② 我上轮的"#238 vs #239"框**表述不精**，应为"队长底稿 vs L1 件"。
