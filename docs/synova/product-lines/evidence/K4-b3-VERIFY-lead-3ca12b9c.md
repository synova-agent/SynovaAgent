# K4-b3-VERIFY-lead-3ca12b9c — 独立复核：队长治理件（K4 批 3 收尾段）

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：分支 `k4b3/lead`，`git ls-remote` 实测 tip = `3ca12b9c227ce013ed443934aed83252d00b2cd5`
> **diff 左端**：`ba1b22a8b5`（所有读数在该 SHA 上取；工作树口径问题见被审件自身 §七 自纠）
> **性质**：被审件是**本批的治理依据**，且是**复核员自己的上级（队长）的产物** ⇒ 本件按同一标准审，不因其作者而放宽。
> **队内用语**：只给「自验结论」，不写「审计通过」。

---

## 〇、对象与字节

```
$ git ls-remote --heads origin | grep k4b3/lead
3ca12b9c227ce013ed443934aed83252d00b2cd5	refs/heads/k4b3/lead

$ git -c core.quotepath=false diff --name-status ba1b22a8b5..3ca12b9c2   （6 条，全 A，全在 evidence/）
A  docs/synova/product-lines/evidence/K4-b3-correction-238-distinct.md      (5765 B)
A  docs/synova/product-lines/evidence/K4-b3-crosswalk-238.mjs              (9552 B)
A  docs/synova/product-lines/evidence/K4-b3-crosswalk-238.record.mjs       (1845 B)
A  docs/synova/product-lines/evidence/K4-b3-crosswalk-238.txt              (6179 B)
A  docs/synova/product-lines/evidence/K4-b3-lead-closeout-20261012.md     (15129 B)
A  docs/synova/product-lines/evidence/K4-b3-premise-freeze-20261012.md    (20627 B)
```
- **独立 SHA-1 比对：6/6 一致**；**BOM 全 none**（含 `crosswalk-238.txt` ⇒ 队长"无 BOM"自述**成立**）。
- 写集**零越界**：无 `src/`、无 `tests/`、无 `extensions/`。
- 口径注：队长回执称"写集 **8 条**（5 笔提交）"，实测 **6 件 / 7 笔提交**（`git log --oneline ba1b22a8b5..3ca12b9c2` = 7 行）。**件数是 6 不是 8**；回执数与实测数不一致（不影响内容）。

### 底稿可复算性 —— **逐字节复现成功（强证据）**

```
$ cd <base 的干净副本>            # 含 edge-types/ cycles/ docs/ data/golden/ _patch_d66.cjs
$ node docs/synova/product-lines/evidence/K4-b3-crosswalk-238.record.mjs
written: docs/synova/product-lines/evidence/K4-b3-crosswalk-238.txt
$ sha256(复算产物) = 03C3E8AF28637B16A0656D8F8E20E4F71B7B45123DE360B96CE5BECCD72AEF66
$ sha256(队长提交件) = 03C3E8AF28637B16A0656D8F8E20E4F71B7B45123DE360B96CE5BECCD72AEF66
逐字节相同 = True
```
⇒ "生成方式（可复算）"**名实相符**（不是事后手写）。

---

## 一、引用真实性 —— 逐条复核**为真**

| # | 件中引用 | 我的实测 |
|---|---|---|
| 1 | blob `59c9a838c` | `git rev-parse ba1b22a8b5:docs/synova/coordination/K4-审计定稿与卡面全套.md` → **`59c9a838ce202d18bff4c1b444e3d33d7f1b2b71`** ✅ |
| 2 | `§三 第 1 行` 逐字 | 该文件 **L48** = 件中引文**逐字一致**（含「复核员之间会打架，只能以实测为准」） ✅ |
| 3 | commit `0780c6da1c39e0c87439e8d9d40b5addcaeb99e5` | `git cat-file -t` = **commit**；`git ls-remote origin` → **`refs/heads/docs/k4-final`** ＋ **`refs/pull/248/head`** ✅ **真实且远端可达** |

> **方法学提示（我自己第一遍误判过）**：`git log -1 0780c6da1` 在本克隆返回 **`fatal: ambiguous argument`**（该对象不在任何**已取**的本地 ref 上），但 `git cat-file -t` 为 commit、`ls-remote` 可见其 ref ⇒ **"log 取不到" ≠ "对象不存在"**。凡核 SHA，用 `cat-file -t` **或** `ls-remote` 正向枚举，别用 `log <abbrev>` 的失败当"不存在"（与队长 §六 自纠同族）。

---

## 二、5 次改口径 —— **全部留痕，且未抹掉原事实**（判：成立）

| # | 改了什么 | 留痕位置（现行原文） | 原事实是否保留 |
|---|---|---|---|
| 1 | §二① 口径 17→15 | 前提件 §〇前提1 ＋ `K4-b3-correction-238-distinct.md` | ✅ 引 blob ＋ §三第 1 行逐字为反证 |
| 2 | 自纠 1（doc15 第三章在仓内） | 前提件 **§六** 标题「🔴 队长自纠：本件 U2 的原判为假」 | ✅ **原文引旧判**（"本件 §五 U2 曾写「…不在本仓」。**该判定为假**"） |
| 3 | 自纠 2（`$id` 非全 snake） | 前提件 前提2 段内嵌 **🔴 措辞订正** 注 | ✅ 引旧措辞"原文「56 个 `$id` 全是 `edge/<name>` 形式」**不精确**" ＋ 45/5/6 实测 |
| 4 | a-7（13/42 章依赖） | 底稿 A 段 `⚠️ 口径警告（a-7）` | ✅ 明写「E-08/E-11 用第二章名对不上，改用第一章 §1.9 / 第四章的名字**均可命中** ⇒ 存在 **15/42** 的合法变体读法」 |
| 5 | a-8（`_patch_d66` 0 vs 34） | 底稿 B/E2 段 | ✅ 明写「结构化解析未取得（0）；**正则可取得 34 distinct**（occurrences=119）」 |
| 6 | c-8（工作树取数） | 收尾件 **§七 队长读数口径自纠** | ✅ 引实测差异（`…/activity.json` 仅 base 有）＋ 归因 **A8 变体** ＋ 新口径「一律 `git <cmd> ba1b22a8b5 -- <path>`」 |

**口径 C 的措辞已按 `a-2` 修正且更清楚**（现行原文）：
```
#   口径C = A∪B（**跨口径求和**：22 + 23 = 45；注意 set-union 去重后的 occurrences 是 15，不是 45）
口径C A∪B（跨口径求和）    occurrences=45 distinct=15
```
⇒ 我早先报的"并集二字会误导复算者"**已被根治**（连 set-union 反例都写进去了）。

**判**：git 层确有**原位改写**（5 笔提交里 4 笔含删除行），但每一处都**在文件内保留了旧事实**（引原文或加订正注）⇒ 「**留痕且不改写历史**」**实质成立**。

---

## 三、裁决清单 D1–D9 逐条对照实测

| # | 裁决 | 我的复核 |
|---|---|---|
| D1 | 交付仓 = `D:\synova-wt`；base 钉 `ba1b22a8b5` | base 部分 ✅（`origin/local-main` = `ba1b22a8b5`，我的克隆同证实）。"novis-backup 仓指向 GitHub 且账号挂起"**未独立核实**（需外网/GitHub 凭据）⇒ **b 类** |
| D2 | #66 不实施（PR #392 (C) 案已落地） | ✅ **由我独立复核**：`1ab0cbb33` 是 base 祖先、写集 5 条、`standardKeyGuard !== false` 默认开、生产 opt-out = 0（见 `K4-b3-VERIFY-1412.md` §二） |
| D3 | #238 判据① = `occurrences=45 distinct=15 hit=15 miss=0` | ✅ 我独立实测：A occ22/dist15、B occ23/dist15、跨口径和 45、并集去重 15、miss 0 |
| D4 | 扩写集 2 件归 L2 先改，L3 禁动 | ⚠️ **未独立复核**（impl-b 未推送；"7 处红 + `:376` 构造性必红"我无对象可验）⇒ **b 类** |
| D5 | #234 按 E 号覆盖；#235 用 E 号名精确命中（13 公式 / 39 `unknown`） | ✅ **算术自洽**：crosswalk A 的 13 条命中项 → 对应 13 个词表文件，**13/13 全在 TBD-52 集合内** ⇒ 52 = 13 + 39 |
| D6 | 新边初值 `unknown`（不用 `TBD`） | ✅ 与实测一致（TBD 现 52 件；#235 判据要求末行 `TBD=0`） |
| D7 | 测量口径 W / B 二选一 | ✅ **已采纳我的 a-3**：现行原文 =「`core.autocrlf=true`；**`.gitattributes` 存在（27 行）但无规则覆盖本批路径**（实测 `git check-attr text eol` 对 `cycles/**`、`extensions/ontology/edge-types/**` 均 `unspecified`）」——我实测 `.gitattributes` **存在**（27 行）、三条受关注路径 `text/eol` 均 **unspecified** ⇒ **逐字吻合** |
| D8 | 禁把 `hash-object` 写成"逐字节一致" | ✅ 口径要求正确（工作树 CRLF vs blob LF 已实测，见 prereq 件 §〇bis） |
| D9 | 证据件落 `evidence/`，命名 `K4-b3-<卡号>-*` | ✅ 本次被审 6 件全部符合 |

## 四、遗留清单 R1–R10 —— 三条我点名过的**全部登记**，且新增声称**实测为真**

| # | 复核 |
|---|---|
| **R1** | ✅ 三源分歧已改「**3 源 2 值**」；**新增声称「第二章对 E-12 自身自相矛盾」—— 我实测为真**：<br>`第二章 L408: ### E-12: POWER_DISTRIBUTION`（标题）<br>vs 同章正文 `**后置边**：…，E-12 EFFICIENCY_FINANCING（效率→外部融资信号）`<br>而第一章 §1.9 / 第四章均为 `E-12 EFFICIENCY_FINANCING` ⇒ 第二章**自相矛盾**，且"少数派"正是它的标题行 |
| R2 | ✅ 与 §3.5.1 一手原文一致（L425/440 主张对象形态 `{minMonths,maxMonths}`；两道门禁要求非空字符串，我已独立复核 `check-ontology-fields.sh:80` = `isinstance(d[fld], str)`、`ontology-loader.ts:280` 注释） |
| R3 | ✅ **定稿 `[0.5,1]` 与我的论证一致**：取 `[0,1]` 会使 `immediate[0,0.5] ⊂ 1_month[0,1]` 重叠 ⇒「区间→桶」不再唯一。件已**明标"推导值，CTO 明文只给 `immediate ⇒ [0,0.5]`"** ⇒ 口径诚实（未冒充权威） |
| R4 | ✅ 与 `K4-b3-VERIFY-1412.md` 的实测一致（`engine-context` 不构造 store；`ingest/index` 1 处） |
| R5 | ⚠️ `#1350 W3 允许 TBD` 与 `#235 全域 TBD=0` 的冲突：**未独立复核**（需读 #1350 W3 原文；我未核）⇒ b 类 |
| R6 | ⚠️ **事实部分我已核**（见 a-1）；**处置部分有写集缺口**（见 a-1） |
| R7 | ⚠️ 同 a-1：登记为 2 件，**实际 B 段写面 6 件** |
| R8 | ⚠️ `claims/201.yaml` / `345.yaml` 被 `claim_store` 报 invalid：**未独立复核**（未跑该工具）⇒ b 类 |
| **R9** | ✅ **实测为真**：doc15 内 `actionEffectLag` 确有**三源**（第三章 §3.5.1 8 条／第一章 §3.4＋cycle 示例 22 条／第一章 附录A 25 条），跨源互斥 **3 条 = E-23 / E-25 / E-37**（我上一轮报的 a-9） |
| **R10** | ✅ **实测为真**：附录A 中文名与权威表英文 label 至少 2 处不可对应（附录A `E-20 技术创新`、`E-22 知识管理`；权威表 E-20 = KNOWLEDGE_SHARING、E-22 = ROUTINE_RIGIDITY） |

---

## 五、本轮新发现（2 条，均须收件闸前处置）

### 🔴 a-1（写集缺口，与 L3 的 B 段合看）R6 决定「同步常量 52→54」，但 `packages/ontology/**` **不在任何任务的 write scope**

```
$ git grep -n "ALL_EDGE_TYPES" ba1b22a8b5 -- packages/ src/
packages/ontology/src/edge-types.ts:100:export const ALL_EDGE_TYPES: readonly EdgeType[] = [
packages/ontology/src/index.ts:20:  ALL_EDGE_TYPES,
src/l4/data-exporter.ts:12,:183  ｜ src/l4/data-purger.ts:14,:267  ｜ src/l4/entity-resolver.ts:14,:215
⇒ src/ 消费方 = 3 个文件（与 R6 记「3 个」一致）
⇒ 该文件对象键 52 / 数组条目 52 / 注释自述 "All 52 edge types"（R6 的「52」正确；K4 定稿件的「51」陈旧）
⇒ src/l4/entity-resolver.ts:215 = `ALL_EDGE_TYPES.map(...)` ⇒ 向量维随数组长度 ⇒ 52→54 属**行为变化**（与 R6 一致）
```
**问题**：这条"同步"要改 `packages/ontology/src/edge-types.ts`（跨包），而 **5 个任务的 write scopes 里都没有它**；且 **R7/D4 的扩写集只登记 2 件**。与 L3 的 B 段需求（另一件 `extensions/ontology/manifest.json`）合看，**实际写面 ≥ 8 件、跨 3 个域**（`extensions/`、`packages/`、`tests/`）。
**处置建议**：放行前把写面补进任务板 `write_scopes` ＋ 扩写集清单，并**显式判定 L3 的 PR 是否仍算"单域"**（若否 ⇒ 拆 PR，PR ≤12 文件 + 单域）。
**归属**：**lead（任务板 + 扩写集）**；impl-c 已在 brief/claim 如实登记，非其缺陷（详见 `K4-b3-VERIFY-1350.md` a-1）。

### 🔴 a-2（口径和解，必须写明）「桶标签实为 **5** 条」与我的「**6** 桶」都对 —— 但**必须带口径名**

队长回执称"#234 落值面…桶标签实为 5 条"；我在 a-6 报的是"6 桶"。**实测两边都不错，是两个不同口径**：
```
CALIBER = doc15 第一章 §3.4 图例表（| 值 | 含义 | 场景 |）——「规范定义」口径
  L188 immediate | L189 1_month | L190 1-3_months | L191 3-6_months | L192 6-12_months | L193 >12_months
  ⇒ 规范定义 distinct = 6

CALIBER = 第一章全文 "actionEffectLag" JSON 值去重 ——「实际使用」口径
  1-3_months ×16 ｜ 1_month ×12 ｜ 3-6_months ×13 ｜ 6-12_months ×6 ｜ immediate ×4
  ⇒ 实际使用 distinct = 5；已定义但未被使用 = [">12_months"]
```
**处置建议**：#234 的值域判据须**显式声明** `>12_months` **是否在域内** —— 若域定义为 5 条，则该桶值一旦出现即"值域违规"（未来缺口）；若定义为 6 条，则校验须接受它（但不得凭空给它赋数值区间，因为 §3.5.1/换算规则都未覆盖）。**归属 lead（前提件 + R3/R9 口径行）**。

---

## 五bis、🔴 a-3（口径/归属，队长点名要核的那条）E-25「只登记不动值」——**与 CTO 裁定的关系需你确认**

队长回执：「**E-25 三源互斥**：我实测 `brand_building.json`（E-25 对应件）`action_effect_lag` = `unknown` ⇒ 本轮**不动值**；R9 只登记冲突来源。**请核这个"不动值"是否与 CTO 裁定一致**」。

**我实测的两半**：
```
$ node: brand_building.json → label = BRAND_BUILDING ; action_effect_lag = "unknown"          ✔ 现值确为 unknown
$ git grep -n "E-25" ba1b22a8b5 -- docs/synova/coordination/K4-审计定稿与卡面全套.md
  L59:  · §3.5.1（数值区间）：… E-38(3,6) **E-25(6,12)** E-24(6,18) E-37(3,9)
  L152: 权威文档15 §3.5.1 给了 **8 条**（E-07/E-15/E-17/E-23/E-38/**E-25**/E-24/E-37）…
```
⇒ **E-25 明确属 §3.5.1 的 8 条之一**，裁定值为 **`(6,12)`**。

**两个需要你裁定的点（我不自裁）**：
1. **「E-25 ↔ `brand_building.json`」是语义推断，不是名字命中。** 我独立复跑 crosswalk 底稿的 A 段口径（按第二章名归一匹配）时，`E-25 BRAND_CONSTRUCTION` 被列为 **MISS ⇒ 词表无同名项**；而被指为"对应件"的 `brand_building.json` 其 `label` = **`BRAND_BUILDING`**（不是 `BRAND_CONSTRUCTION`）。⇒ 该映射靠"品牌建设≈BRAND_BUILDING"的**语义判断**成立，而**本批底稿自己声明"测不出语义等价（需裁定，非计算）"**。若映射有误，则"不动值"动的是**错误的文件**。
2. **若 E-25 属迁移域，则"不动值"可能与 #234 卡面判据相冲。** D5 定「#234 迁移域 = **按 E 号覆盖**」；E-25 在 §3.5.1 的 8 条内 ⇒ 按此口径应在迁移域内、应落 `(6,12)` 的数值区间。而 R9 判"不动值" ⇒ 该条**可能无法满足「值域全为 §3.5.1 数值区间」**。二者只能取一：**(a)** 把 E-25 明确排除出迁移域（须写明理由：对应件不可判定 ⇒ 无落点，与 E-10/E-12 同型处置），或 **(b)** 纳入并把 `brand_building.json` 的 `action_effect_lag` 落成 `[6,12]`（并在交付件登记"桶源主张 3-6_months，以 §3.5.1 为准"）。
> 注：就冲突登记本身而言，R9 的**处置方向（S1 优先 + 登记冲突来源）与 CTO 裁定一致** ✅；**待定的是 E-25 到底在不在迁移域**。

**归属**：**lead（R9 需补一句"E-25 ∈/∉ 迁移域"）＋ impl-b（按裁定落/不落值）**。

---

## 六、b / c 类

**b 类（未独立核实，逐条点名，不假装满足）**：b-1 D1 的 GitHub 账号挂起/`local-main` 不存在（需外网）；b-2 D4 的"7 处红 + `:376` 构造性必红"（impl-b 未推送，无对象）；b-3 R5 的 #1350 W3 `TBD` 口径原文；b-4 R8 的 `claim_store` status=invalid；b-5 前提件 §一/§二 里关于 `D:\synova-wt` 工作树 HEAD/领先落后数（我未在 `synova-wt` 取数，只做了只读诊断）。
**c 类**：**未发现跑不通项**。两条复核环境提示：① `git diff --name-only` 须 `-c core.quotepath=false`（否则 CJK 路径成八进制）；② PS 5.1 变量名大小写不敏感（`$B`/`$b` 互覆，我实测踩中）。

---

## 七、d 类：结论用语

- **队长治理件（6 件 @ `3ca12b9c2`）—— `可提请独立审计`**：字节 6/6 一致、无 BOM、**底稿可由脚本逐字节复算**、3 处引用（blob/commit/§三第 1 行）**全部为真**、**5 次改口径全部留痕且未抹旧事实**、D3/D5/D6/D7/D9 **逐条与实测吻合**、D2 **经我独立复核支持**、R1/R2/R4/R9/R10 **登记准确**（其中 R1 新增的"第二章 E-12 自相矛盾"**实测为真**）。
- **须在收件闸前处置 2 条**：a-1 写集缺口（`packages/ontology/**` 无主）＋ a-2 桶标签 6/5 口径声明。
- **5 条 b 类**（D1/D4/R5/R8/§一工作树数）未独立核实，**不得**在收尾件里被读作"已核"。
