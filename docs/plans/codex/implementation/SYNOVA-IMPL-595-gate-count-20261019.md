---
status: proposed
日期: 2026-10-19
任务: #595（门禁组数口径纠偏：真值 12 组；文档＋脚本＋夹具同批）
撰写: P4（门禁包负责人）· **独立于实现者**
依据: CTO 2026-10-19 卡（A 类）｜L1 复核事实（本件 §3，全部带命令）｜`dev-doc-spec` v2｜`pre-plan-thinking` 9 问
批次规模: 改 13 文件 ＋ 新建 3（自证脚本／Note／豁免件）；预估 +120/−110 行
---

# SYNOVA-IMPL-595 · 门禁组数口径纠偏（真值 12 组）

> 🔴 **本件是执行小队的唯一规格源**。**只改计数口径**：不增删、不重排、不改任何一组的内容与顺序。
> 🔴 **禁补第 11 组**：组 11 已并入组 4（`scripts/pre-commit-check.sh:822`「# 组 4: 接线完整性 (原 5, 11 合并)」）⇒ 这是**计数口径错**，不是功能缺失。
> 🔴 **历史件不改**：`CHRONICLE.md`、已冻结 dev doc、`memory/notes/**` 引述 —— 一律不碰（改历史 = 造假）。

---

## 封面 · 四行开场包

```
① 批次名：P4-组数口径-12组
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - scripts/pre-commit-check.sh                      （12 个标签去 /13；汇总行改运行时计数；自承注释同批改）
   - scripts/doc-system/check-doc-truth.sh            （C2 真值改为"数横幅"，不读硬编码字串；全 6 处声明可判）
   - AGENTS.md（:5/:230/:300）｜LOOP.md（:15/:39/:53） （6 处声明改 12；措辞归一为 C2 可提取的规范形态）
   - tests/control-tower/precommit-groups-injection.test.sh｜fastlane-bypass-only.test.sh｜check-pr-budget.test.sh
     ｜gate-failopen-net.test.sh｜ci-deps-step-sim.test.sh （5 个夹具同批改齐）
   - .gitea/workflows/local-gates.yml（:57 step 名 ＋ :63/:96 注释 → 12）
   - scripts/control-tower/synova-commit（7 处）｜scripts/control-tower/merge_writeset_gate.py:9
     ｜scripts/check-content-coupling.sh:689｜agents/P4-门禁/AGENTS.md:155 （其余现行声明）
   - <新建> tests/control-tower/gate-count-acceptance.test.sh（自证脚本，裁 210 硬要求）
   - <新建> memory/notes/proposed/2026-10-19-gate-count.md（四态 Note）
   - <新建·创始人作者> gate-exemptions/2026-10-19-gate-count-595.md（①d 豁免，见 §7 P2）
③ 判据（含改坏必红）：
   - bash scripts/pre-commit-check.sh ⇒ exit 0，且末段打印 `全部 12 组通过`（运行时算出来的，不是字串）
   - bash scripts/doc-system/check-doc-truth.sh ⇒ exit 0（C2 绿）
   - grep -c '组 [0-9]+/13' scripts/pre-commit-check.sh ⇒ 0；grep -c '全部 [0-9]+ 组通过' ⇒ 0
   - 反例：沙箱删掉任一分组块（含其横幅）⇒ **C2 必红**；恢复 ⇒ 绿（原始输出入证据）
   - 反例：把任一处文档声明改回 13 ⇒ C2 必红；把 `全部 ${N} 组通过` 改回硬编码 ⇒ 自证必红
④ 域守则指针（必须显式 read）：scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ .gitea/AGENTS.md ｜ memory/notes/AGENTS.md
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | **CTO 2026-10-19 新卡**（A 类：提案已批，P4 实现）；Issue **#595** |
| 2 | 归属包 | **P4 门禁**（治理域）｜域：`scripts/control-tower/`、`tests/control-tower/`、`.gitea/` |
| 3 | 写集 | 见 §2（W1–W6 ＋ 新建 3） |
| 4 | 判据 | 见 §4（正常/降级/三条反例）＋ DS-1…DS-12 |
| 5 | 依赖 | S1 已合（`23a4f5a38`）；**①d 已生效 ⇒ 本卡 PR 需创始人作者豁免**（§7 P2） |
| 6 | 不做什么 | 见 §1 非目标（逐条路径） |
| 7 | 回执 | 见 §8（R2 ≤10 行 ＋ 三信号；证据原始输出，禁截断） |

## 权威件回执（动笔前实读）

| 件 | as_of | 读了什么 |
|---|---|---|
| CTO 2026-10-19 卡 | 本会话 | 真值 12／组 11 已并入组 4／6 处声明／C2 自指／夹具依赖／5 条判据／边界／顺序 |
| `scripts/pre-commit-check.sh` | `23a4f5a38` | 12 个横幅（657/711/818/831/890/976/1243/1397/1427/1505/1578/1871）；`:77` 自承"12 个标签 + 全部 13 组通过"；`:822` 并组注释；`:2087` 汇总行 |
| `scripts/doc-system/check-doc-truth.sh` | `23a4f5a38` | `:62` `TRUTH_GROUPS=$(grep -oE '全部 [0-9]+ 组通过' …)`（自指）；claim 提取三条正则 |
| `AGENTS.md` / `LOOP.md` | `23a4f5a38` | 6 处 13 组声明（行号见 §3） |
| 5 个夹具 | `23a4f5a38` | 各自依赖的字面量（见 §3 F5） |
| 域守则 4 份 | `23a4f5a38` | 三态退出码／零失败才合并／改门禁只认 `.gitea`／四态 Note |

---

## §〇pre · `pre-plan-thinking` 9 问（逐问有证据）

| # | 问 | 证据（命令 ⇒ 输出摘要） | 落点 |
|---|---|---|---|
| ① | 问题 | 文档/脚本自称 13 组、实际执行 12 组；C2 拿脚本字串当真相 ⇒ 文档与脚本写同一错数即恒绿 | §1／§3 |
| ② | 现状 | 12 个横幅（命令见 §3 F1）；`组 11/13` 标签 0；`:822` 并组注释；C2 在 `scripts/doc-system/check-doc-truth.sh:62` | §3 |
| ③ | 有没有现成 | `tests/control-tower/hooks-install.test.sh:105` 已用「锚定 `全部 N 组通过` 信号而非具体组数」范式（可复用）；`DOC_TRUTH_ROOT` 注入缝已存在（自证反例可直接指向沙箱）；**无**"数横幅"的现成实现 | §6 |
| ④ | 最小改动 | 12 标签去分母 ＋ 汇总行运行时计数 ＋ C2 数横幅 ＋ 6 声明 ＋ 5 夹具 ＋ 其余现行声明；**不新增组、不改组内容** | §2 |
| ⑤ | 最危险假设 | ①「补第 11 组」是错解（`:822` 证）②「改字符串就够」错——C2 仍读字串 ⇒ 必须同时改 C2 ③「夹具只 2 个」错——实测 4 个直接依赖 ＋ 1 个依赖 step 名（§3 F5）④「文档改了 C2 就绿」错——C2 的 claim 正则不覆盖 AGENTS.md:230/:300 ⇒ 需措辞归一 | §2／§4 |
| ⑥ | 失败路径 | 见 §4 三条反例（删分组块 ⇒ C2 红；文档回 13 ⇒ 红；硬编码回潮 ⇒ 自证红） | §4 |
| ⑦ | 边界 | 不增删/重排组；不改组内容；不碰 `scripts/audit/**`、`.github/**`、其它门禁数字；历史件不改 | §1／§7 |
| ⑧ | 可观测 | 两条命令：`pre-commit-check.sh`（exit 0 ＋ `全部 12 组通过`）／`check-doc-truth.sh`（exit 0）；＋ `grep` 两条零命中 | §4 |
| ⑨ | 拆步 | W1 脚本标签与汇总 → W2 C2 → W3 六声明 → W4 五夹具 → W5 workflow step 名 → W6 其余声明 → 自证脚本 → Note／豁免 → PR | §8 |

---

## §1 做什么

**目标**：让"组数"只有**一个真值来源**（脚本实际会执行的横幅数 = 12），文档、脚本、夹具、CI step 名全部与它一致；C2 从"读字串"改为"数横幅"，并对删组/改数**必红**。

**可观测结果**：
1. `pre-commit-check.sh` 末段打印 `全部 12 组通过`（运行时变量，非字面量）；
2. `check-doc-truth.sh` C2 绿（6 处声明 == 12）；
3. 全仓现行声明无 `13 组`（历史件除外）；`组 N/13` 与 `全部 N 组通过` 字面量零命中。

**非目标（逐条路径）**：
- ❌ **不补第 11 组**（`:822`：已并入组 4）｜❌ 不增删/重排/改任何组的内容与顺序
- ❌ `scripts/audit/**`（K3）｜❌ `.github/**`｜❌ 其它门禁数字（专家数 6、铁律 47 条等）
- ❌ 历史件：`CHRONICLE.md`、`docs/plans/codex/implementation/**` 已冻结件、`memory/notes/**` 引述
- ❌ 平台配置（S2 域）｜2.3／2.4 存量

---

## §2 在哪做（file:line ＋ 写集）

### W1 `scripts/pre-commit-check.sh`

| 改动点 | 现状 ⇒ 目标 |
|---|---|
| 12 个横幅（657/711/818/831/890/976/1243/1397/1427/1505/1578/1871） | `── 组 N/13: <名> ──` ⇒ `── 组 N: <名> ──`（**组号不重排**；去掉分母，避免再出现硬编码总数） |
| `:2087` 汇总行 | `✅ 全部 13 组通过` ⇒ `✅ 全部 ${GROUP_DONE} 组通过`；每个组块执行时 `GROUP_DONE=$((GROUP_DONE+1))`（放在横幅之后/组块内），**禁保留任何字面总数** |
| `:77` 自承注释 | 改写为"12 个 `── 组 N` 标签、汇总行为运行时计数"（删掉"13 组通过"字样） |
| `:23` 头部、`:643` banner、`:365/:396/:407/:1464/:1611/:1887/:1900/:1901/:1937/:1943/:1969/:2027` 注释 | 其中的"13 组"按语义改为"12 组"或改为不写数字（如"全量组"）；**不得改变注释所描述的机制** |

### W2 `scripts/doc-system/check-doc-truth.sh`（C2 改造）

- `:62` 真值：`TRUTH_GROUPS=$(grep -oE '全部 [0-9]+ 组通过' "$PCC" …)` ⇒ **`TRUTH_GROUPS=$(grep -cE '── 组 [0-9]+:' "$PCC")`**（数横幅；`grep -c` 无命中为 0）。
- 新增两条硬断言（同文件内，C2 段）：
  - `grep -cE '全部 [0-9]+ 组通过' "$PCC"` **必须为 0**（防硬编码回潮）；否则 C2 红。
  - `TRUTH_GROUPS` **必须 > 0**；为 0 ⇒ C2 **硬失败**（信号量==0，禁当通过）。
- claim 提取：沿用现有三条正则，但 6 处文档统一为**可提取的规范形态**（见 W3），保证 6/6 都被 C2 覆盖（现状 AGENTS.md:230/:300 不被提取）。

### W3 `AGENTS.md` ×3 ＋ `LOOP.md` ×3（全部改 12，措辞归一到 C2 可提取）

| 文件:行 | 现状 | 目标（规范形态） |
|---|---|---|
| `AGENTS.md:5` | `**13 组 pre-commit**` | `**12 组 pre-commit**` |
| `AGENTS.md:230` | `**13 组**（本地软提示）` | `**12 组 pre-commit**（本地软提示）` |
| `AGENTS.md:300` | `# 13 组门禁（本地）` | `# 12 组 pre-commit 门禁（本地）` |
| `LOOP.md:15` | `13 组硬阻断（…）` | `12 组硬阻断（…）` |
| `LOOP.md:39` | `13 组硬阻断门禁` | `12 组硬阻断门禁` |
| `LOOP.md:53` | `47 条铁律 + 13 组 pre-commit` | `47 条铁律 + 12 组 pre-commit` |

> 🔴 只改数字与必要措辞；**不得改语义**（仍写"本地软提示/CI 权威"等）。

### W4 五个夹具（同批改齐）

| 夹具 | 依赖 | 改法 |
|---|---|---|
| `tests/control-tower/precommit-groups-injection.test.sh` | `LBL_g1..g13` 常量（`:196-207`）、`:395`、`:535` | 常量去 `/13`（`── 组 1: …`）；含"组 11 不存在"的注释**保留**（事实不变） |
| `tests/control-tower/fastlane-bypass-only.test.sh` | `:38` 断言 `组 1/13` | 改 `组 1:` |
| `tests/control-tower/check-pr-budget.test.sh` | `:397` 断言 `全部 13 组通过` | 改为**锚定信号**：`全部 [0-9]+ 组通过`（不锁具体数，复用 `tests/control-tower/hooks-install.test.sh:105` 范式） |
| `tests/control-tower/gate-failopen-net.test.sh` | `:34` 注释/断言 `全部 13 组通过` | 同上 |
| `tests/control-tower/ci-deps-step-sim.test.sh` | `:51` `s.index('      - name: ① 13 组门禁')` | 与 W5 的 step 名同步改 `① 12 组门禁` |

### W5 `.gitea/workflows/local-gates.yml`（step 名与注释）

- `:57` `- name: ① 13 组门禁（唯一的阻断门）` ⇒ `① 12 组门禁（唯一的阻断门）`
- `:63`、`:96` 注释里的"13 组" ⇒ "12 组"
- **不动** job 名（`gates`）与任何 step 的 `run:`；job 名是 required status context 的产出者，step 名不影响 context。

### W6 其余现行声明（L1 补充：你清单外的 5 处，理由=现行用户可见/可读声明）

- `scripts/control-tower/synova-commit`：`:6/:283/:338/:344/:447/:454/:753/:781`（含两处**用户可见** echo：`pre-commit 13 组` / `✅ 全部 13 组检查通过`）⇒ 改 12
- `scripts/control-tower/merge_writeset_gate.py:9`（注释）⇒ 12
- `scripts/check-content-coupling.sh:689`（注释）⇒ 12
- `agents/P4-门禁/AGENTS.md:155`（P4 包守则里的"pre-commit 是 **13 组**"）⇒ 12
- 🔴 **不改**：`CHRONICLE.md`（历史）、已冻结 dev doc、memory/notes 引述

### 新建

- `tests/control-tower/gate-count-acceptance.test.sh`（**新建**；自证脚本，见 §4）
- `memory/notes/proposed/2026-10-19-gate-count.md`（**新建**；四态 Note）
- `gate-exemptions/2026-10-19-gate-count-595.md`（**必须创始人作者**，理由＋裁定号；覆盖本 PR 触碰的受保护路径，见 §7 P2）

---

## §3 凭什么做（事实，全部可复跑）

| # | 事实 | 命令 ⇒ 原始输出（摘要） |
|---|---|---|
| F1 | 真值 = 12 个横幅 | `grep -nE '── 组 [0-9]+/[0-9]+' scripts/pre-commit-check.sh` ⇒ 12 行（657/711/818/831/890/976/1243/1397/1427/1505/1578/1871）；组号 1–10,12,13 |
| F2 | 组 11 不存在（不是缺功能） | `组 11/13` 标签命中 **0**；`scripts/pre-commit-check.sh:822` `# 组 4: 接线完整性 (原 5, 11 合并)`；"组 11"文字命中 5 处，**全在** `tests/control-tower/precommit-groups-injection.test.sh` 注释（`:25-27` 明写"组 11 不存在"、`:195`、`:553`）⇒ **不能当"缺组"证据** |
| F3 | 6 处文档声明 | `AGENTS.md:5/:230/:300`；`LOOP.md:15/:39/:53`（均为 `13 组`） |
| F4 | 脚本内字面量与自承 | `:2087` `✅ 全部 13 组通过`；12 个 `/13` 标签；`:77` 自承"12 个 `── 组 N/13` 标签、`全部 13 组通过`" |
| F5 | 夹具依赖（实测 5 个） | `全部 13 组通过`：`tests/control-tower/check-pr-budget.test.sh:397`、`tests/control-tower/gate-failopen-net.test.sh:34`；`组 N/13`：`tests/control-tower/precommit-groups-injection.test.sh:196-207/:395/:535`、`tests/control-tower/fastlane-bypass-only.test.sh:38`；**第 5 个**：`tests/control-tower/ci-deps-step-sim.test.sh:51`（依赖 workflow step 名） |
| F6 | C2 自指 | `scripts/doc-system/check-doc-truth.sh:62` `TRUTH_GROUPS=$(grep -oE '全部 [0-9]+ 组通过' "$PCC" \| grep -oE '[0-9]+' \| head -1)` |
| F7 | C2 覆盖不全 | claim 正则仅 `[0-9]+ 组 pre-commit`／`pre-commit [0-9]+ 组`／`[0-9]+ 组硬阻断` ⇒ 现状 `AGENTS.md:230`（`**13 组**`）与 `:300`（`# 13 组门禁`）**不被提取** |
| F8 | 其余现行声明 | `synova-commit` 8 处；`scripts/control-tower/merge_writeset_gate.py:9`；`scripts/check-content-coupling.sh:689`；`agents/P4-门禁/AGENTS.md:155`；`.gitea/workflows/local-gates.yml:57/:63/:96` |
| F9 | 历史件（不改） | `CHRONICLE.md:152/:159/:164/:189`（历史记录，改了=造假） |

> 🔴 **与你清单的 3 处偏差**（以实测为准）：
> 1. "组 11 全仓 0 命中" ⇒ 精确说：**标签/组块 0**；**文字 5 处，全在夹具注释**（且正是"组 11 不存在"的证据）。
> 2. C2 自指行号 = **:62**（不是 :60）。
> 3. 夹具是 **4 个直接依赖 ＋ 1 个 step 名依赖（`ci-deps-step-sim`）**；`notes-four-state.test.sh` 实测**不引用**组数（它自己的"组 1–5"是测试内部分节，不是 pre-commit 组）。
> 另：你清单外的 5 处现行声明（F8）已列入 W5/W6（同批改，否则 CI 日志与用户可见 echo 仍写 13）。

**若 F1–F9 任一不成立 ⇒ 停，退回 L1。**

---

## §4 怎么算做完（三路径 ＋ 反例 ＋ DS）

### 正常

```bash
bash scripts/pre-commit-check.sh; echo "exit=$?"            # 期望 0，末段「✅ 全部 12 组通过」
bash scripts/doc-system/check-doc-truth.sh; echo "exit=$?"   # 期望 0（C2 绿）
echo -n "横幅数="; grep -cE '── 组 [0-9]+:' scripts/pre-commit-check.sh          # 期望 12
echo -n "/13 残留="; grep -cE '组 [0-9]+/13' scripts/pre-commit-check.sh          # 期望 0
echo -n "硬编码汇总="; grep -cE '全部 [0-9]+ 组通过' scripts/pre-commit-check.sh   # 期望 0
bash tests/control-tower/precommit-groups-injection.test.sh; echo "exit=$?"       # 期望 0
bash tests/control-tower/gate-count-acceptance.test.sh; echo "exit=$?"            # 期望 0（自证）
```

### 降级

```bash
# PCC 不存在 ⇒ C2 degraded（既有 warn 行为保留），不得静默当绿
DOC_TRUTH_ROOT=$(mktemp -d) bash scripts/doc-system/check-doc-truth.sh; echo "exit=$?"   # 期望 0 ＋ ⚠️（C2 degraded）
```

### 🔴 反例（改坏必红，三条）

```bash
# R1 删组必红：沙箱复制仓库相关文件，删掉一个组的分组块（含横幅），跑 C2 ⇒ 必红；恢复 ⇒ 绿
#    （doc-truth 支持 DOC_TRUTH_ROOT 注入；沙箱夹具可复用 tests/doc-system/check-doc-truth.test.sh 的做法）
# R2 改数必红：把 AGENTS.md 或 LOOP.md 任一声明改回 13 ⇒ C2 必红
# R3 硬编码回潮必红：把 ${GROUP_DONE} 改回字面 12/13 ⇒ 自证脚本的「硬编码汇总=0」断言必红
```

### DS（交付声明，逐条可核验）

| # | 声明 | 核验 |
|---|---|---|
| DS-1 | 真值 = 数出来的 12 | `grep -cE '── 组 [0-9]+:'` = 12 |
| DS-2 | 汇总行运行时计数 | `grep -cE '全部 \[0-9\]+ 组通过'` = 0 且 `grep -c '\${GROUP_DONE}'` ≥1 |
| DS-3 | 6 处声明全 12 且被 C2 覆盖 | `check-doc-truth.sh` exit 0，且逐文件打印 `12 = 12` |
| DS-4 | 无 `/13` 标签 | `grep -cE '组 [0-9]+/13'`（脚本＋5 夹具）= 0 |
| DS-5 | 删组必红 | R1 沙箱：C2 exit 1；恢复 exit 0（原始输出入证据） |
| DS-6 | 改数必红 | R2：C2 exit 1 |
| DS-7 | 硬编码回潮必红 | R3：自证 exit 1 |
| DS-8 | 5 个夹具全绿 | 逐个 exit 0 |
| DS-9 | step 名与夹具同步 | `grep -c '① 12 组门禁' .gitea/workflows/local-gates.yml` =1；`ci-deps-step-sim` exit 0 |
| DS-10 | 其余现行声明无 13 | `grep -rn '13 组'`（排除历史件）命中 0 |
| DS-11 | 未增删/重排组 | 组号集合仍 = {1..10,12,13}；diff 中无组块移位 |
| DS-12 | 双命令 exit 0 | `pre-commit-check.sh` 与 `check-doc-truth.sh` 均 exit 0 |

---

## §5 怎么跑

```bash
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-gcnt-impl-1019 -B ct/p4-gate-count-1019 gitea/local-main
cd /Users/wane/SynovaAgent/.synova-wt-gcnt-impl-1019
# 依赖：无（bash + git + grep；无服务、端口）；pre-commit 全量约 50s（自证只跑一次）
# 证据：docs/evidence/p4-gate-count/（.gitignore:81 evidence/ 覆盖，不入库不脏树；原始输出禁 head 截断）
# 自检环境：bash --version | head -1 && git rev-parse --short HEAD
```

---

## §6 有什么基础（禁重复建设）

| 能力 | 证据 | 结论 |
|---|---|---|
| 「锚定信号不锁数」范式 | `tests/control-tower/hooks-install.test.sh:105`（历史教训：改 12→13 曾致断言永久红） | **复用**（check-pr-budget / gate-failopen-net 改锚定） |
| C2 注入缝 | `DOC_TRUTH_ROOT`（`scripts/doc-system/check-doc-truth.sh:23`）＋ 夹具 `tests/doc-system/check-doc-truth.test.sh` 已用 | **复用**（反例 R1/R2 直接指向沙箱） |
| 三态退出码／degraded | `scripts/control-tower/AGENTS.md`；`check-doc-truth.sh` 的 `check/warn` 语义 | 复用（C2 硬失败走 `check … 1`；缺失走 warn 不变） |
| CT-40 配对 | 自证脚本是新测试件，不与 `scripts/control-tower/*` 配对；`check-doc-truth.sh` 已有配对测试 | 复用 |
| 门禁本体豁免（①d） | S1 已交付：`gate-exemptions/*.md`＋APPROVERS 作者校验 | **必须使用**（本 PR 触碰受保护路径，见 §7 P2） |
| 「数横幅」实现 | 无现成 | 新建（C2 内一行 `grep -c`，不新增机制族） |

---

## §7 前置与红线

**前置（硬）**

| # | 前置 | 判据 | 未满足 |
|---|---|---|---|
| P1 | S1 已合 | `git merge-base --is-ancestor 23a4f5a38 gitea/local-main` ⇒ 0 | 停（实际已满足） |
| P2 | **创始人作者豁免**：本 PR 触碰受保护路径（`scripts/pre-commit-check.sh`、`scripts/doc-system/**`、`tests/control-tower/**`、`.gitea/workflows/**`、`scripts/control-tower/**`、`agents/**/AGENTS.md`）⇒ ①d 会要求豁免 | `gate-exemptions/2026-10-19-gate-count-595.md` 存在、每行 `- <路径> — <理由> — 裁定号`、**最后提交作者 = `huangxuesongvip@163.com`（创始人网页提交）** | ①d 红 ⇒ PR 不合 |
| P3 | 组号集合不变 | {1..10,12,13}；无第 11 组 | 停 |
| P4 | 历史件零改动 | `git diff --name-only` 不含 `CHRONICLE.md`／已冻结 dev doc／`memory/notes/**` | 停 |

**红线**

```
❌ 不增删/重排/改任何组的内容与顺序（只改计数口径）
❌ scripts/audit/**｜.github/**｜其它门禁数字（专家 6／铁律 47）
❌ 不改历史件（CHRONICLE／冻结 dev doc／memory 引述）
❌ 平台配置（S2 域）｜2.3／2.4
❌ 主树禁写｜禁 --no-verify｜禁 force push｜禁 git stash
```

**Known Limitations（必须写进交付件）**

1. C2 只核 `AGENTS.md`/`LOOP.md` 两处文档；其余现行声明（W5/W6）靠自证脚本的 grep 断言，不在 C2 内。
2. 删组反例（R1）依赖"删整块（含横幅）"；若只删块体不删横幅，横幅数不变 ⇒ **不红**（口径边界，DS-11 用组号集合兜底）。
3. 历史件保留 13 组（有意）：`grep '13 组'` 全仓仍有命中，判据必须显式排除历史路径。

---

## §8 交什么（给 L1）

```
 R2 指针 ≤10 行：批次名 ｜ 写集（逐文件）｜ 自验结论 ｜ 证据路径 ｜ 未决项
 证据：docs/evidence/p4-gate-count/（原始输出全量，禁截断）
 三信号：① 判据通过率 ② 例外清单 ③ 在飞数
 🔴 自证脚本必须进 PR（含 R1/R2/R3 三条反例）；不进 ⇒ 视为未自证 ⇒ 独立复核不受理
 🔴 不判"通过"：只能给 自验结论 / 可提请独立复核 / 退回（附失败点原文）
```

**合并**：四条件自合（CI 全绿 pending=0 ／ 零写集重叠 ／ **独立复核 = L1 复跑 PASS** ／ 串行）；PR 提交后停下报 L1，PASS 前不得合。

---

## C1 契约（脚本/C2 改动 ⇒ 必填）

```
 C2（check-doc-truth.sh）：
   @input  <root>/scripts/pre-commit-check.sh；<root>/AGENTS.md、<root>/LOOP.md；DOC_TRUTH_ROOT 可覆盖根
   @truth  TRUTH_GROUPS = grep -cE '── 组 [0-9]+:' <PCC>（数横幅；非字串）
   @checks ① TRUTH_GROUPS > 0（=0 ⇒ 硬失败）② 无 '全部 [0-9]+ 组通过' 字面量 ③ 每份文档 claim == TRUTH_GROUPS
   @exit   0 = 全过；1 = 硬失败（含 C2）；缺失 PCC ⇒ degraded warn（既有行为）
 pre-commit-check.sh：
   @summary GROUP_DONE 运行时计数；末行 '✅ 全部 ${GROUP_DONE} 组通过'；禁字面总数
   @labels  12 个 '── 组 N: <名> ──'；组号不重排
```

## C2 边界值

| 边界 | 期望 |
|---|---|
| 横幅数 0（脚本被掏空） | C2 **硬失败**（信号量==0） |
| PCC 缺失 | C2 degraded（warn），不静默绿 |
| 文档缺声明 | C2 warn（既有行为） |
| 声明=12、横幅=12 | 绿 |
| 声明=13、横幅=12 | 红（R2） |
| 删整块（含横幅） | 横幅=11 ⇒ 红（R1） |
| 只删块体留横幅 | 横幅仍 12 ⇒ 不红（Known Limitations 2） |
| `全部 ${GROUP_DONE} 组通过` | 允许（运行时） |
| `全部 12 组通过` 字面量 | 红（防回潮） |

## C3 失效条件

- **何时可撤**：若将来组数需要频繁变动，且 C2 改为"运行时执行一次取真实计数"（更贵）⇒ 本口径升级；或门禁重构为配置化组表（组数从配置派生）⇒ 本卡口径整体退役。
- **前提变更不得带病续跑**：任何增删组的 PR 必须同批更新 6 处声明与夹具（本卡建立的纪律）；否则 C2 红——这是**有意设计**。

---

## 附录 · 派单内部一致性自检（教训：同一单两条要求对同一路径互斥）

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | W1–W6 全在 §2；非目标是**不同路径**（audit／.github／历史件／平台）⇒ 零互斥 |
| "改字符串" vs "C2 数横幅" | 同批改：脚本去字面量 ⇒ C2 改数横幅；顺序上先改脚本再改 C2 会让 C2 短暂红（单 PR 内可接受，CI 以最终态为准） |
| 夹具改法 vs 判据 | 4 个夹具改字面量、2 个改锚定（不锁数）——判据 DS-4/DS-8 分别核 ⇒ 不互斥 |
| 删组反例 vs 不增删组 | R1 只在**沙箱**删（不碰仓库）；DS-11 用组号集合兜底 ⇒ 不互斥 |
| 豁免件 vs 写集 | 豁免件由**创始人网页提交**（作者校验），L2 不写；不占 L2 写集 |
| 历史件 vs 全仓 grep | DS-10 显式排除历史路径（CHRONICLE／冻结 dev doc／memory）⇒ 不互斥 |
