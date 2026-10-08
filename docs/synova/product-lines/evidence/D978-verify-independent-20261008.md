# D978 独立自验件（三轮一致性） — 循环编号映射（卡 0-4 / #978）

> ⚠️ **本件由独立自验位产出，非被验方。**
> 自验位：`sra-smoke`（小队独立成员位，**不参与** #978 的编码与证据撰写）
> 被验方：`sra-map`（分支 `fix/978-cycle-id-map`）
> 性质：**自验结论**（≠ 审计通过；通过与否归 K3 / 独立复核终审）
> 自验日期：2026-10-08 ｜ 自验轮次：**三轮**（R1 主交付 → R2 证据更正 → R3 窄口径更正）
> 自验树：`D:\novis-backup-20260526\Novis\.synova-wt-978-verify`（**detached HEAD，只读**；原始输出落 `%TEMP%\synova-verify-978\`）
> 本件为**合并件**：把三轮结论文档（`2026-10-08.md` / `forward-2026-10-08.md` / `forward3-2026-10-08.md`）合并落库，供 K3 按件复跑。

---

## 一、被验对象：三枚 commit 链

| # | commit | 内容 | 自验轮次 |
|---|---|---|---|
| 1 | `5b73b4763e687cabd4d2710f85d10ae6aa603a15` | 主交付（6 个 `*.cycle.json` 的 `E-x.y` → 代码边 `$id`）+ probe | R1 |
| 2 | `e0e3833e699d07c160288032cfa0be0550fab1b2` | 证据更正（R4/R5/R6 + C1–C5 + L8/L9） | R2 |
| 3 | `955a98e3dbce296a402a05a72d6ab5d9bc043dc0` | 窄口径更正（口径图例 / §2.1(b) / L8 三处） | R3 |

分支 `fix/978-cycle-id-map`；`git ls-remote` 实测三枚链顶 = `955a98e3d…`（R3 收口时）。

## 二、自验方法与纪律

- **只读**：未 commit / 未 push / 未改被验分支；**未碰 `scripts/audit/**`**；所有产物落 `%TEMP%\synova-verify-978\`（自验树 `git status --porcelain` 三轮**均为空**）。
- **独立复跑**：判据与词表均用**独立脚本**重算（不经被验方的 probe 断言），probe 只作为**被验对象**另行运行。
- **判别性要求**：反例必须**红 → 绿成对**（只贴红证不算判别性）；复原用 `git checkout -- <file>`，并核 6 个 `*.cycle.json` 的 **SHA256 自验前后一致**。
- **数字**：一律命令原始输出；给"共 N 处"计数。

## 三、前提（R3 复跑）—— **成立**

```
[前提1] git diff --stat 5b73b4763 955a98e3d -- cycles/ scripts/control-tower/probe-cycle-edges.ts ⇒ 0 行（空）
[前提2] git diff --name-only 5b73b4763 955a98e3d
        ⇒ docs/synova/product-lines/evidence/D978-cycle-id-map-20261008.md（共 1 文件）
[加强核] git diff --name-only 5b73b4763 955a98e3d -- src/     ⇒ 0 文件
         git diff --name-only 5b73b4763 955a98e3d -- cycles/  ⇒ 0 文件
         git diff --name-only 5b73b4763 955a98e3d -- scripts/ ⇒ 0 文件
[subject] R3: subject_bytes=85（≤140 字节口径）；全文 '?' 个数 = 0
          subject = fix(978): correct evidence addendum source-comparison (patch 源 == 落地态 13/13)
```
⇒ **可执行件（6 个 cycle.json + probe + src/）在三枚 commit 之间逐字节未变**，三枚只改证据件。

## 四、★ 三轮一致性表（"多轮更正后验证仍成立"的论证）

| 复跑项 | `5b73b4763`（R1） | `e0e3833e6`（R2） | `955a98e3d`（R3） |
|---|---|---|---|
| 判据① `git grep -ohE "E-[0-9]+\.[0-9]+" HEAD -- cycles/ \| wc -l` | 0 | 0 | **0** |
| 判据① 同命令 `origin/main -- cycles/` | 45 | 45 | **45** |
| 判据① distinct（`origin/main`） | 17 | — | **17** |
| probe `legacy_occurrences` | 0 | 0 | **0** |
| probe exit code | 0 | 0 | **0** |
| probe 词表 `code_edge_$id_count / label_count` | 55 / 55 | 55 / 55 | **55 / 55** |
| probe 键计数 `edgeRefs / mapping.edgeId / 合计` | 22 / 23 / 45 | 同 | **同** |
| 反例（红 → 绿） | 1 → 0 | 1 → 0（抽样 1 条） | 未重跑（见下） |
| **L1 定级（零消费者）** | 正确 | 正确 | **正确** |
| probe 判定句 | `✅ 判据① 旧编号 = 0；判据② 全部取值 ∈ 代码边 $id ∪ label ∪ {unknown}；exit 0` | 同 | **同** |

**L1 可迁移性**：由前提/加强核保证 —— `src/`、`cycles/`、`scripts/` 三目录**全链 0 变更** ⇒ 不可能新增消费者。
**R3 未重跑反例的理由**：可执行件三枚间 0 变更 ⇒ R2 的抽样反例结论继续有效（**若 K3 要求，可在 `955a98e3d` 上补跑，约 1 分钟**）。

## 五、判据②（值域合法）—— 独立核，**成立**（R1 实测，R2/R3 由"可执行件未变"承接）

独立脚本 **直读 JSON**（不经 probe 断言）：

```
EDGE_TYPE_FILES = 55    $id_COUNT = 55    label_COUNT = 55
USED_TOTAL = 45（22 edgeRefs + 23 mapping[].edgeId）
USED_NOT_IN_VOCAB（判据② 违例） = 0
USED_unknown = 0
USED_DISTINCT = 15
LEGACY_E_XY_IN_FILES = 0
```
**漏改覆盖核**：`edgeRefs` 键 22 处 / `mapping[].edgeId` 键 23 处，**两侧 HEAD 与 origin/main 键数一致** ⇒ 是**改值**而非删键；值域中 `E-x.y` 残留 = 0 ⇒ **两个数组同批改完**。

## 六、反例（判别性 · 红绿成对）—— **成立**（R1 全量 / R2 抽样）

| 阶段 | exit | `legacy_occurrences` |
|---|---|---|
| 基线 | **0** | 0 |
| 反例 A：`cash-cycle` 一个 `edgeRefs` 置回 `E-1.1` | **1** | **1** |
| A 复原（`git checkout --`）后 | **0** | 0 |
| 反例 B：只改 `edgeRefs`、`mapping[].edgeId` 保留 origin/main 旧值（`product-cycle` 4 节点） | **1** | **4** |
| B 复原后 | **0** | 0 |

原始输出（节选）：

```
CE_A_PROBE_EXIT=1     legacy_occurrences = 1     ❌ 结论：2 项违规 — exit 1
STATUS_AFTER_RESTORE=[]
GREEN_A_PROBE_EXIT=0  legacy_occurrences = 0     ✅ 结论：…；exit 0

PATCHED_EDGERefs_NODES=4  mapping 仍为旧值 ⇒ 文件内 E-x.y 残留=4
CE_B_PROBE_EXIT=1     legacy_occurrences = 4     ❌ 结论：5 项违规 — exit 1
STATUS_AFTER_RESTORE2=[]
GREEN_B_PROBE_EXIT=0
```
**红证不残留**：`FINAL_STATUS=[]`；6 个 `*.cycle.json` 的**磁盘 SHA256 自验前后逐字节一致**（`SHA256_IDENTICAL=yes`），且与 `git show HEAD:<file>` 侧哈希一致。

## 七、零消费者 / L1 定级 —— **定级正确**

| 搜面 | 结果 |
|---|---|
| `edgeRefs` @ `src/**`（新 HEAD） | **仅 1 处**：`src/cycles/cycle-types.ts:29`（类型声明 `edgeRefs?: string[]`） |
| `mapping` @ `src/cycles/**`（新 HEAD） | **仅 1 处**：`src/cycles/cycle-types.ts:99`（类型声明） |
| `edgeRefs` 全仓（排 `docs/`） | 除 6 个数据文件自身与 **probe 自身**外，**零消费者** |
| `cycle-loader.ts` 读的字段 | 只校验 `cycle.nodes`(:103) 与 `cycle.overflowFormula.condition`(:107-108) —— **不读 `edgeRefs` / `mapping`** |

**对照组核**（同载体兄弟字段确被消费）：`src/cycles/overflow-compute.ts:82` `const formula = cycle.overflowFormula;` 真消费；`cycle-loader.ts` 真加载 6 个被检文件（probe 报 `loader_visible=yes`）。
⇒ **L1 静态可达**定级**正确**；未发现被漏掉的运行时消费者（若有即应升 L2/L3）。

## 八、依据链核（R2 追加项）

### 8.1 `E-1.5`（R4）—— 两条反证**均成立**，取值**不受影响**

```
origin/main: NODE {"id":"hiring","label":"人才招聘","unit":"人/季度","edgeRefs":["E-1.5"]}
             MAPPING {"nodeId":"hiring","edgeId":"E-1.5","weight":0.7}
HEAD:        hiring → edge/talent_acquisition
golden:      data/golden/wani-baby-v1.json:93  "E-1.5": { "label": "SENSING_CALIBRATION", "value": 0.40, "confidence": "low" }
D66 聚类:    'check-data-source-health'（L7 自保层） edges: ['E-1.5','E-0.1','E-0.2']
```
⇒ 两条信号都指向"感知"，而该编号在循环里挂在**人才招聘**节点 ⇒ **更可能旧编号 `E-1.5` 自身写错（D88 期）**；目标值以**节点语义**为准成立（卡面候选·高 + `talent_acquisition.json` description 字面「招聘新员工的输入阀」）。**不改判据②**。

### 8.2 `E-5.2`（R5）—— D66 与卡面/golden **双矛盾**，自陈成立

```
卡面候选: edge/talent_retention（高）
golden:   "E-5.2": { "label": "TALENT_RETENTION", "value": 0.20, "confidence": "high" }
D66:      E-5.2 => [acquire-financial-data]   ← 唯一聚类，财务/感知簇
```

### 8.3 §2 表引用 D66 的 13 行机械核对 —— **12 行属实 + 1 行（`E-3.1`）表述偏弱**

用 `vm` 从 `_patch_d66.cjs` 的 `DEPENDENCIES` 提真值，逐行比对声明：

```
OK   E-1.1(3) E-1.6(1) E-1.8(2) E-2.1(5) E-2.7(3) E-3.6(2) E-4.1(5)
     E-4.2(2) E-4.3(1) E-5.1(3) E-5.3(4) E-5.4(3)
WEAK E-3.1 未列可核 skill（仅簇描述）  真聚类 = 9 个（以 pricing/margin 为主）
--- 提及聚类的行: 13 | OK 12 | 违例 0 | 仅簇描述(弱) 1
```
**补充发现**：`E-3.1` 真聚类实为 **pricing/margin 为主**（`analyze-price-elasticity` / `prescribe-pricing-strategy` / `diagnose-margin-erosion` / `analyze-operating-leverage` / `analyze-break-even` / `track-execution-progress` / `detect-plan-deviation` / `acquire-operational-data`），"运营/产出簇"既无 skill 可核、方向亦偏；但该条取值来自**卡面候选**（非 D66）⇒ **不影响判据②**。被验方已在 R2 按「依据不足，取卡面候选」作废该引用，并**如实注明"由独立自验指出"**（已核，非自称自查）。

### 8.4 golden 翻译表 12/5 分裂 —— 独立重算，**与 R6 / C1–C5 同源一致**

```
golden_edges_keys = 36 | cycles_distinct_E_N_M = 17 | golden_covered = 17/17（未覆盖 0）
一致 = 12   E-1.6 E-1.8 E-2.1 E-2.7 E-3.6 E-4.1 E-4.2 E-4.3 E-5.1 E-5.2 E-5.3 E-5.4
不一致 = 5  E-1.1 / E-1.5 / E-3.1 / E-3.7 / E-4.6
```
**C1–C5 目标合法性（独立核）**：`edge/capital_acquisition` / `edge/sensing_calibration` / `edge/produces` / `edge/tech_infrastructure` / `edge/customer_data_loop` —— **5/5 `exists=true`**（词表 55/55/55）⇒ 任何裁决都不会使判据②失效。

## 九、R3 文字核对结果 —— **属实**

| 位置 | 现状 | 判定 |
|---|---|---|
| `:80` 口径图例 | 「落地态…与 patch 源**逐字一致 13/13**（成员数与成员名全同）⇒ **两数据源无差异**；本表所列成员是 patch 源集合的**子集**（**3 行与全集相同、10 行为子集摘录**）⇒ 差异只在**本证据件的摘录口径**」 | ✅ |
| `:137` §2.1(b) | 标题改为「**本文件摘录口径的更正（独立自验抓出，本版更正）**」+ 同口径 | ✅ |
| `:447` L8 | 「patch 源集合的**子集摘录**…**落地态与 patch 源逐字一致 13/13，两数据源无差异**…」 | ✅ |
| `:448` L9 | 「路线 (b) 代价的实证样本（**独立自验建议**）」 —— 在位 | ✅ |
| 「超集」残留 | `grep -n '超集'` ⇒ **全文 1 处（`:138`）**，且为**否定式留痕**（"初版本节曾写…**该结论错误**…一并作废"） | ✅ 与自陈一致 |
| 「两口径给出不同成员集」推论 | 仅存于 `:138` 同句"一并作废"表述，**无生效声明** | ✅ 已作废 |

**独立复算（patch 源 vs 落地态）**：
```
patch_source_skill_count = 41 | builtin_manifest_count = 41
13 行逐字一致 13 / 不同 0   （成员数与成员名全同）
IDENTICAL_ROWS = E-1.1 E-1.6 E-1.8 E-2.1 E-2.7 E-3.1 E-3.6 E-4.1 E-4.2 E-4.3 E-5.1 E-5.3 E-5.4
```
（另一口径：**§2 表所列成员（子集） vs patch 源全集** = **3 一致 / 10 不同**，一致 3 行 = `E-1.6` / `E-4.3` / `E-5.3` —— 这正是被验方 `10/3` 数字的来源口径，属**摘录口径**而非"两数据源差异"。）

## 十、不可核项（**明示，不掩盖**）

被验方 R3 新增根因句自陈：「对 `_patch_d66.cjs` 用单行正则只捕获 **30/50** 个条目块、漏 11 个；改用稳健解析后为 **41/41**」。自验位独立复现：

```
ROBUST_skill_entries = 41                      ← 「41/41」✅ 可复现
ROBUST_skills_with_edges = 31 | ROBUST_total_edge_tokens = 127
SINGLELINE_regex_entry_headers = 50            ← `'name': {` 形态单行正则命中 50（**过**计数，非漏）
SINGLELINE_edges_arrays_on_one_line = 41       ← `edges: [...]` 单行法**全捕获 41 个数组**
SINGLELINE_edge_tokens_captured = 127          ← 127 个 token **一个不漏**
```

- ✅ **实质结论可复现**：稳健解析 41/41、**两源逐字相等 13/13**、旧"超集"结论错误。
- 🔴 **机制数字「30/50、漏 11」不可复现**：可复现的对照是 `naive 条目头 50 / 稳健 41`（**过计数**），其中**没有 30**；`edges:` 单行法在现文件**完整捕获**，看不到"漏 11"的形态。该数字为被验方自陈、**未留原始命令** ⇒ **按不可核处理**（K3 可令其补命令，或改为不绑定数字的定性表述）。

## 十一、自验位的两处**自我证伪留档**（自验位自己的错，一并留痕）

1. **首轮「11/6」误判（我的脚本 bug）**：R1 我用 `byNode[nodeId] → 新值` 的**跨文件**聚合，而 `retention` 在 `customer-cycle` 与 `talent-cycle` **重名** ⇒ `E-4.2` 被错误地拿 `talent-cycle:retention` 的新值比较，得「一致 11 / 不一致 6」。改为 **per-file 键**（`file + ':' + nodeId`）后为 **一致 12 / 不一致 5**，与被验方 R6/C1–C5 一致。**以修正后为准**；原始对照脚本与输出留在 `%TEMP%\synova-verify-978\f3-recheck.*`。
2. **本轮「30/50」复现失败**：见 §十 —— 我先按"过计数 50"测得与被验方"漏 11"方向相反，故**不采信任何一方数字为已证**，只报"我实测到的对照 + 该项不可核"。

## 十二、边界与未做

- **未做**：R3 未重跑反例（理由见 §四）；未做 C1–C5 的取值变更（不属自验范围，属 CTO 裁决）；未审 4 个未在被检体清单内的 `*.cycle.json`；未做桌面端/运行时链路复跑（L1 定级即"零消费者"的结论）。
- **未受影响项**：subject `?`（R1 的污染）已于 R2 修复，`?` 计数 = 0（已核）；R3 subject 含中文但 85 B ≤ 140 B ⇒ 属**实测未踩坑的例外**（走 `write` 工具 UTF-8 → `bash cat`，未经 PowerShell `Out-File -Encoding ascii` 通道）。
- 本件**只增一个文件**，未改任何其他件。

## 十三、复跑命令清单（供 K3 按件复跑）

```bash
cd <repo>                                   # 任意 origin/main 系工作树
git worktree add /tmp/v978 --detach 955a98e3d     # 或 git checkout --detach 955a98e3d

# 判据①
git grep -ohE "E-[0-9]+\.[0-9]+" HEAD -- cycles/ | wc -l          # ⇒ 0
git grep -ohE "E-[0-9]+\.[0-9]+" origin/main -- cycles/ | wc -l   # ⇒ 45

# probe（勿用裸 npx tsx —— 无 node_modules 时 npx 会尝试拉包并失败）
node node_modules/tsx/dist/cli.mjs scripts/control-tower/probe-cycle-edges.ts   # ⇒ legacy 0 / exit 0

# 反例（红→绿成对）
node -e "const fs=require('fs');const p='cycles/builtin/cash-cycle.cycle.json';const j=JSON.parse(fs.readFileSync(p,'utf-8'));j.nodes[0].edgeRefs[0]='E-1.1';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
node node_modules/tsx/dist/cli.mjs scripts/control-tower/probe-cycle-edges.ts   # ⇒ 红 exit 1 / legacy 1
git checkout -- cycles/builtin/cash-cycle.cycle.json
node node_modules/tsx/dist/cli.mjs scripts/control-tower/probe-cycle-edges.ts   # ⇒ 绿 exit 0
git status --porcelain                                                          # ⇒ 空

# 零消费者
git grep -n 'edgeRefs' HEAD -- src/          # ⇒ 仅 src/cycles/cycle-types.ts:29
git grep -n 'mapping'  HEAD -- src/cycles/   # ⇒ 仅 src/cycles/cycle-types.ts:99
```

## 十四、自验结论（一句话）

**三枚 commit（`5b73b4763` → `e0e3833e6` → `955a98e3d`）上，判据①（0/45）、判据②（45 值里违例 0 / unknown 0 / distinct 15 / 两数组键数 22·23 同批改完）、probe（`legacy_occurrences=0` / exit 0 / 词表 55·55）与 **L1 静态可达**定级**逐字一致**；反例红绿成对且红证不残留；R4/R5/R6 三处自陈经独立核成立，C1–C5 目标 5/5 为合法边；R3 三处文字更正与「超集」残留性质（1 处否定式）属实；**唯一不可核项 = 新增根因句的机制数字「30/50、漏 11」**（其实质结论"两源相等 13/13"可复现）。本件为**独立自验位**产出，**可提请独立复核 / K3 终审**；通过与否归 K3，本件不构成"审计通过"。**
