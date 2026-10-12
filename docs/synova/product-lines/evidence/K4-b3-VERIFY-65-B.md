# K4-b3-VERIFY-65-B — 独立复核：#65 A＋B（K4-05bis 边词表：目标层级边 ＋ 计划边）

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`k4b3/l3-65` @ **`a7437498c70235a7ef5eaef13b7de960b464dd20`**（`git ls-remote` 实测；10 笔；写集 **9 件 = 锁定写集，零多零缺**）
> **diff 左端**：`ba1b22a8b5`｜**vitest 实跑**（CTO 授权 · 串行）｜**临时 detached worktree ＋ junction**（同 `K4-b3-VERIFY-239.md` §〇 的方法；跑毕残留 = 0）
> **四元组随附**（值 + 口径 + 时点 + 版本）｜**队内用语**：只给「自验结论」。

---

## 〇、对象与写集（零多零缺）

```
$ git diff --name-status ba1b22a8b5..a7437498c        → 9 件（A×7 / M×2）
 A .claude/claims/1350.yaml
 A .claude/task-briefs/2026-10-11-1350-K4-05bis-边词表-目标层级边与计划边.md
 A docs/synova/product-lines/evidence/K4-b3-1350-edge-vocabulary.md
 A docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md
 A extensions/ontology/edge-types/goal_decomposes_to.json        ← 新件 1
 A extensions/ontology/edge-types/plan_commits_to.json           ← 新件 2
 M extensions/ontology/manifest.json
 M packages/ontology/src/edge-types.ts
 A tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts
claims/1350.yaml 的 `writeset:` 亦恰为这 9 条 ⇒ **逐条相等** ✅
```
**四元组（本件总）**：值 = 见下各条｜口径 = 逐条标注（blob 原始字节 / Object.keys 序列 / loader 实跑 / vitest）｜时点 = 2026-10-12（vitest 自报 17:5x +08:00）｜版本 = `a7437498c`（实测），探针类脚本无独立版本号（本轮不适用）

## 一、CTO 点名项逐条

### V1 计数 58 ＋ 同构 —— ✅
```
$ git ls-tree -r --name-only a7437498c -- extensions/ontology/edge-types/  → **58** 件（实测基数 56 ＋ 本卡 2；口径 = 全量枚举，非抽样）
$ 逐 blob `git cat-file -p` 读 Object.keys() 序列去重（口径 = 键序，非键集）
  distinct key-orders = **2**
    55 件 = 11 键 canonical 顺序
     3 件 = 12 键（= **既有 3 件** brand_builds / couples / cumulative_learning，非新增）
  bad（其它形态）= **0**
⇒ canon11=55 / canon12=3 / bad=0 ✅ 与件内声明逐字一致；**两新件落 11 键 canonical 组** ⇒ 同构 ✅
$ vitest：A1【V1】`loadOntology().edgeTypes.length === 58` ✅｜A3【V1】键序 `=== canonical 11 键`（两件均过）✅
```

### V2 加载器认领 ＋ 桥可读字段 —— ✅
```
$ vitest（同 tip，实跑）：
  test files: tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts → **20 passed (20)** / exit 0
  ✓ A1【V1】装载器读到 58 件（实测基数 56 ＋ 本卡 2）
  ✓ A2【V2】两新边被加载器**认领**（按 label 可查、各有真实文件名）= GOAL_DECOMPOSES_TO / PLAN_COMMITS_TO
  ✓ A6【V2】桥：action_effect_lag 槽 status=resolved / injectable=true / value='unknown'
  ✓ A7【V2】桥：transfer_function 槽 injectable=false，状态如实记录（= prose_formula，未伪造）
  ✓ A8 桥的 3 槽齐备（EDGE_PARAM_KEYS 顺序：transfer_function / causal_strength / action_effect_lag）
```

### V3 删任一新边 ⇒ 计数回落 ＋ B5 自足造红 —— ✅
```
$ vitest 同次的 B 组（我实跑）：
  ✓ B0 阴性对照：完整沙箱 = 58 件（证明**沙箱机制本身不改变计数**）        ← 这一条很关键，排除"沙箱自己把数改掉"
  ✓ B1 删 goal_decomposes_to.json ⇒ 沙箱磁盘 57、装载回落 **57**（期望"红"）
  ✓ B2 删 plan_commits_to.json    ⇒ 沙箱磁盘 57、装载回落 **57**
  ✓ B3 两件都删 ⇒ 回到引入本卡前的基数 **56**（净增量 +2 可判）
  ✓ B4 沙箱删除后**确无该文件**（磁盘判据，防"删了但文件还在"）
  ✓ B5 🔴 "夹具会红"的**自足证明**：把 A1 的同一条断言施加到「删了一件」的沙箱 ⇒ **必抛（= 红）**
  ✓ C1 沙箱缺 edge-types/ 目录 ⇒ 计数 = 0（不抛，如实归零）｜C2 两新件 requiredProps 非空｜
  ✓ C3 判别性：把沙箱新件的 requiredProps 清空 ⇒ C2 同判据会红（证明 C2 非恒绿）
  Tests  20 passed (20)   Duration 5.33s
```
⇒ **V3 不是"恒真夹具"**：B0（阴性对照）＋ B5（自足造红）＋ C3（判别性）三层齐 ✅

### 新件 blob 落组实测（**不得当既定**）—— ✅ 实测 = LF 组 48/58
```
口径 = 逐 blob `git cat-file -p` 原始字节 @ a7437498c（全量 58 件）
  blob 含 CRLF = **10** ｜ 纯 LF = **48**
  goal_decomposes_to.json : bytes=2262 CRLF=0 裸LF=29 ⇒ **LF 组** ✅
  plan_commits_to.json    : bytes=2179 CRLF=0 裸LF=33 ⇒ **LF 组** ✅
⇒ 与 impl-c 报「2 件 blob 纯 LF ⇒ 落 LF 组 48/58」**逐值吻合**；且与"多数态 = LF"的**推断一致**（本条是**实测**，未把推断当既定 ✅）
```
⚠️ **口径提示（轻）**：交付件 **W-9** 行仍写「10 件含 CRLF / **46 件纯 LF**（全量普查 **56/56**）」—— 那是 **base 的 56 件**口径（已自标 `56/56`）；本卡 +2 后实际为 **10/48（58 件）**。建议在 W-9 行补一句「（本卡 +2 后 = 10 / 48）」，避免被读成"当前树 46"。

### 跨域单 PR 声明 —— ✅ 已登记且逐字进件
```
交付件 W-11（原文）：本件跨域：B 段写面 ≥8 件、跨 3 个路径域（extensions/ / packages/ / tests/）…
   ✅ 队长裁：单 PR ＋ 跨域显式声明 ＋ 不拆分（拆开会人为制造"常量与 JSON 不对称"的中间态，比跨域更坏）
交付件另设「🆕 W-11 跨域声明（队长要求逐字进 PR 正文与本交付件）」节 ✅
```
⇒ 声明**在**（口径 = 逻辑域同一性：本体边词表），不构成"静默跨域" ✅。

### `ALL_EDGE_TYPES` 52→54 的行为变化登记（W-8）—— ✅ 已登记
```
$ 我在 tip 实测 packages/ontology/src/edge-types.ts：
  对象键 = **54** ｜ ALL_EDGE_TYPES 数组内条目 = **54** ｜ 自述 = "All 54 edge types"
  ⇒ 52 → 54（净 +2 ✅；既有 52 条未动，与件内声明一致）
交付件 W-8 登记段（原文要点）：EntityResolver 邻居类型余弦相似度**向量维度 52→54，为行为变化**；
  影响面 = 余弦相似度值轻微改变；**无持久化面**（vecA/vecB 为函数内局部）⇒ 队长裁 (a) 成对落地 ＋ 必写登记段 ✅
```

### `manifest.json` 的 `edgeTypes` 16→58 —— ✅（含 N1 交叉核）
```
$ git diff ba1b22a8b5..a7437498c -- extensions/ontology/manifest.json
   numstat = 1  1     ← **仅 2 行（-16 / +58）**，其余一字未动 ✅
   diff 原文：-  "edgeTypes": 16,   /   +  "edgeTypes": 58,
$ 消费者交叉核（我实测，口径 = 全仓 grep `edgeTypes`）：
   scripts/migrate-ontology-manifests.py:138  old_edges = data.get("edgeTypes", 0)
   scripts/migrate-ontology-manifests.py:141  data["edgeTypes"] = edge_count        ← **派生自目录实数**
   其余命中均**无关**：packages/sog-core 自身 Map/字段（sog-schema-registry.ts / sog-metadata.ts）、
   scripts/pre-doc-audit.sh（grep 文档字符串）、scripts/workflow/gen_impl_ch0_1.py（HTML 文案）
   ⇒ **src/ / packages/ 无运行时消费者** ⇒ 属**文档值**（与队长 N1 结论一致 ✅）
```

## 二、claim 的 8 条 `done:` —— 逐条实测
| # | 命令 | 实测 |
|---|---|---|
| 1 | `npx vitest run tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts` ⇒ 20 passed | ✅ **20 passed (20) / exit 0**（我实跑） |
| 2 | `bash scripts/control-tower/check-ontology-fields.sh` ⇒ `✅ 全部 58 件…` / exit 0 | ✅ **`✅ 全部 58 件边类型关键字段齐全（action_effect_lag, transfer_function）` / GATE_EXIT=0**（**用 Git Bash 全路径**跑通，见 §三提示） |
| 3 | `git ls-tree … \| wc -l` ⇒ 58 | ✅ 58 |
| 4 | `git grep -c GOAL_DECOMPOSES_TO -- packages/…/edge-types.ts extensions/…/goal_decomposes_to.json` ⇒ 两处 ≥1 | ✅ `edge-types.ts:3` ＋ `goal_decomposes_to.json:1`（成对落地） |
| 5 | 同上（`PLAN_COMMITS_TO`） | ✅ `edge-types.ts:3` ＋ `plan_commits_to.json:1` |
| 6 | 禁入项（1134 / 1031 两测试件）⇒ 0 | ✅（该卡写集 9 件，无此二件） |
| 7 | `git diff --name-only … \| grep -c "^src/"` ⇒ 0 | ✅（9 件中无 `src/`） |
| 8 | `npx tsc --noEmit` ⇒ 与 BASE 同为 29 条、差异为空 | ⚠️ **未跑（b 类）** —— 属重型类型检查，本轮我只跑 CTO 指定的 vitest 范围；如需我可申请串行补跑 |
⇒ **7/8 实跑通过，1 条未跑（b）**。

## 三、口径/环境提示（与 `K4-b3-VERIFY-239.md` §三 同源，此处为实证）
1. **本机 `bash` = WSL 存根（无发行版）⇒ `bash scripts/….sh` 直接跑必失败**（我实测 `GATE_EXIT=255` ＋ 未安装发行版提示）；改用 **Git Bash 全路径** `& 'C:\Program Files\Git\bin\bash.exe' -lc "cd /d/<dir> && bash <script>"` ⇒ 正常（`58 件齐全 / exit 0`）。**claim done #2 的命令在本机默认环境下不可直接复算**。
   🔴 **单源声明（订正）**：该事实**已载于团队技能 `dsh-env-setup`**（「六类故障与修法」第 1 行）⇒ **本件不另立条文、以该技能为单一真源**；我首轮报成"新发现"实为**重复发现**（根因 = 未先加载该技能，已自陈）。
   **同技能另有一条本件已当场自证**：`python3` 若为 WindowsApps 假别名 ⇒ **门禁静默空转**（断言全看到"通过"）。本机实测 = `…\Python313\python3.exe`（**3.13.13** 真解释器）⇒ §二 的门禁 ✅ **非假绿**；该脚本为三级探测 ＋ fail-closed。
2. **vitest 报告器名**：`--reporter=basic` 在 vitest 5 不存在（会以"报告器加载失败"退出，易被误读为测试红）。
3. **junction 必须用 `rmdir` 解除、禁 `rm -rf` 跟随**（否则会删到 `D:\synova-wt\node_modules` 实体）。

## 四、结论用语

**`a7437498c`（#65 A＋B 终态）—— `可提请独立审计`**：
- **写集 9 件 = 锁定写集，零多零缺** ✅；claim writeset 逐条相等 ✅
- **V1 ✅**（58 件；canon11=55 / canon12=3 / bad=0；两新件落 11 键 canonical 组）｜**V2 ✅**（loader 认领 2 件 + 桥三槽可读）｜**V3 ✅**（删件 57/57/56 + **B0 阴性对照** + **B5 自足造红** + C3 判别性）
- **新件 blob 落组 ✅ 实测 = LF 组（48/58）**（未把推断当既定）
- **跨域单 PR 声明 ✅**｜**W-8（52→54 行为变化）✅ 已登记**｜**manifest `edgeTypes` 16→58：diff 仅 2 行 ✅、无运行时消费者 ✅**（与 N1 交叉一致）
- **claim done 7/8 实跑通过**，第 8 条（`tsc --noEmit`）**未跑，记 b**
- 附 2 条**口径/环境提示**（W-9 的 56 vs 58 口径；本机 `bash`=WSL ⇒ verify 命令复现缺口）
