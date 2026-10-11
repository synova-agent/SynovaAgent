# #1057 证据件 — 作业单元「补两件」（实例 + 评估属性）

> ## ⚠️ 落点版本说明（K4-03 批 2 · 2026-10-11）
> 本件**同时承载两批**，读之前先看这一行：
> - **§A（本文件顶部，权威）**：K4-03 / 批 2 —— 落点按 CTO 冻结的「Schema / 实例 / 扩展」三件拆分**改写后**的交付与验证。
> - **§B（下方原 §1–§9，批 1 历史记录，未删改）**：批 1 的读数**在其时真实**；其**落点**已被 K4-03 卡面改写：
>   · `extensions/ontology/activity/*.json` 携带 10 属性 → **已回退 local-main 原样**（8 件）；
>   · `extensions/ontology/activity/instances/*.json` → **已搬到 `customer-config/ontology-instances/<orgId>/`**；
>   · `tests/l4/activity-instance-1057.test.ts` → **已搬到 `tests/ontology/instance-loading.test.ts`**（旧件删除，不并存）；
>   · 10 个属性的**声明** → **已搬到 `extensions/ontology/extensions/<industry>/<node>.json`**。
>   ⇒ 读 §B 时请当作"历史读数"，**不得**当作当前落点事实。

---

# §A K4-03 / 批 2 —— 落点改写后的交付与验证

- **卡面（Done 真源）**：`.claude/task-briefs/2026-10-11-236-K4-03-作业单元补两件-实例-评估属性.md`（CTO 亲撰，local-main 上可读）
- **执行**：`coder-k4-03`｜**工作树**：`D:\synova-wt-b2-1057`｜**分支**：`fix/1057-activity-instance-props`
- **基线**：`origin/local-main = e52499ddd6a1320435abd44f24323b5865d4caa1`（rebase/复跑前先 `lanfetch.bat`；rebase 当刻 tip）
- **等级声明**：探针 = **L1 真读盘**；判据件含 **L2**（`loadOntology()` 真加载）。**本件不含"审计通过"字样**；队内结论只为「自验结论」。

## §A.0 前提冻结（逐条实测；输出为命令原始读数）

| # | 前提（卡面/任务书原文） | 命令 | 输出摘要 | 判定 |
|---|---|---|---|---|
| P1 | 4 处落点在 local-main 上均 **0 件** | `git -c credential.helper= -c safe.directory=* ls-tree -r --name-only origin/local-main -- customer-config extensions/ontology/extensions scripts/control-tower/probe-ontology-instances.ts tests/ontology` | 仅 1 行 `tests/ontology/adapter-user.test.ts`（既有件，不冲突）⇒ 4 落点 = 0 件成立 | ✅ |
| P2 | 8 个 `activity/*.json` **全被批 1 改动** | `git -c … diff --stat origin/local-main...HEAD -- extensions/ontology/activity` | `8 files changed, 8 insertions(+), 8 deletions(-)` ＋ 旧实例件 `59 ++++` | ✅ |
| P3 | 10 属性在 8 件里**同名同型**（不一致须停报） | `python3 …/check-eval-props.py`（脚本文本见 §A.9） | `CONSISTENCY_ACROSS_8_FILES: SAME_NAME_SAME_TYPE (8/8)`；`ABSENT_SLOTS: none (10/10 x 8 files)` | ✅ 无缺口 |
| P4 | 旧件在位（搬家对偶起点） | `if exist` / `dir` | 旧判据件 464 行、旧实例件 59 行、旧证据 275 行 | ✅ |
| P5 | 新落点**零既有消费者 / 零撞车** | grep（`*.ts/tsx/js/mjs/cjs/json/py/sh/yml/yaml` 全仓）`ontology-instances|ontology/extensions|probe-ontology-instances|instance-loading` | **No matches found（共 0 处）** | ✅ |
| P6 | 基线可解析 | `lanfetch.bat D:\synova-wt-b2-1057` → `rev-parse` / `rev-list` | `FETCH_EXIT=0`；`origin/local-main = e52499ddd6a1320435abd44f24323b5865d4caa1`；`HEAD = d5eb341b`；`0\t6` | ✅ |
| P7 | 工作树开工态干净 | `git status --porcelain=v1` | 无输出（clean） | ✅ |

**落点（CTO 冻结，未自定）**：实例 `customer-config/ontology-instances/<orgId>/<node-type>.json`｜扩展 `extensions/ontology/extensions/<industry|profession>/<edge-or-node>.json`｜探针 `scripts/control-tower/probe-ontology-instances.ts`｜判据件 `tests/ontology/instance-loading.test.ts`。

## §A.1 判据审计表（Done 逐条 → 用例名 → 行号）

行号为**交付 blob 的行号**（`grep -n` 原始读数；探针 = `scripts/control-tower/probe-ontology-instances.ts`，判据件 = `tests/ontology/instance-loading.test.ts`）。

| # | 判据（卡面 Done / 本批硬要求） | 载体 | 用例 / 段名 | 行号 |
|---|---|---|---|---|
| ① | 探针 ⇒ exit 0，且**不依赖 `data/synova.db`** | 探针 | `main()` 四段（SCHEMA/EXTENSION/INSTANCE/LOAD）＋末行 `RESULT=` | 441（main）/ 453 / 468 / 495 / 514 |
| ② | 反例：**删掉扩展层 ⇒ 探针必 exit 1** | 探针 | ② 段「扩展层缺评估属性」+ ④ 段「无归属 / 未被扩展声明覆盖」 | 468–494 / 514–540 |
| ③ | 作业单元的评估属性**在 fixture 上有断言**（不是空壳） | 判据件 | `Schema 面：8 类目…` / `扩展面：单件声明…` / `实例面 + 加载链…` | 132 / 142 / 154 |
| 补 | 仓内**真件**三面（只读盘、零 DB） | 判据件 | `真件三面：Schema 8 类目 / 扩展层非空 / 实例在位…` | 167 |
| 补 | 真件实例**逐条断言值**（9 number + 1 string 前缀） | 判据件 | `真件实例值：9 个 number 逐条字面相等 + agent_type_recommendation 前缀` | 184 |
| 补 | Schema 层**零评估属性**（本卡冻结口径：只在扩展层） | 判据件 | `真件 Schema 层零评估属性（属性只在扩展层 —— 本卡冻结口径）` | 195 |
| 补 | **[L2]** 生产 loader 真加载（`loadOntology()`） | 判据件 | `[L2] 生产 loader 真加载：degraded=false 且 activity 恰好 8 个类型` | 203 |
| 补 | 平铺扫描不递归（实例落点不成为第 9 个类型） | 判据件 | `平铺扫描不递归：实例落点不再被生产 loader 当成第 9 个节点类型` | 218 |
| 补 | **判别性夹具**（改坏即红，5 条） | 判据件 | `#1057 判别性夹具 — 改坏即红…` 组内 5 条 `it` | 230 / 231 / 248 / 257 / 267 / 278 |
| 补 | **降级路径**（loader 不抛 + errors 显式可见） | 判据件 | `#1057 降级路径…` 组内 3 条 `it` | 290 / 291 / 301 / 310 |
| 补 | **边界**（空目录 / 悬空 / 轴非法 / 无归属 / 空值 / 回潮） | 判据件 | `#1057 边界…` 组内 11 条 `it` | 321–405 |

**审计发现的缺口与补法**（"有缺口先补测试"）：
1. 批 1 的旧判据件（`tests/l4/activity-instance-1057.test.ts`）判的是**旧落点**（Schema 层带 10 属性 + 旧 `instances/` 目录），且含 `data/synova.db` env-gated 段落 ⇒ 对新落点**零覆盖** ⇒ 本卡**先写新判据件 + 探针**（见 §A.2 先红），**再**动落点数据。
2. 「删掉扩展层 ⇒ 红」在旧件里不存在（旧件没有扩展层概念）⇒ 本卡新增 ②/④ 两段 + 判据件 `删掉扩展件…` 用例承载。
3. 旧件的 DB 写入路径断言（`SqliteGraphStore` 迁移、`graph_nodes` 计数）**撤除**：卡面要求判据仓内可复跑、不得依赖 `data/synova.db`；该面属图存储域（K4-04）⇒ 记入遗留清单（§A.8）。

## §A.2 先红（新判据件先落盘、落点数据尚未创建时的原始输出）

命令：`cd /d D:\synova-wt-b2-1057 && npx vitest run tests/ontology/instance-loading.test.ts`

```
 ❯ tests/ontology/instance-loading.test.ts (25 tests | 5 failed) 640ms
     ✓ Schema 面：8 类目、$id 对齐、零 parse 错误
     ✓ 扩展面：单件声明 → 10 属性 × 8 个 activity 节点类型 全覆盖（名 + 型）
     ✓ 实例面 + 加载链：orgId 不变式成立、violations 为空（同实现，非两条码）
     × 真件三面：Schema 8 类目 / 扩展层非空 / 实例在位，且加载链零 violations
     × 真件实例值：9 个 number 逐条字面相等 + agent_type_recommendation 前缀
     × 真件 Schema 层零评估属性（属性只在扩展层 —— 本卡冻结口径）
     × [L2] 生产 loader 真加载：degraded=false 且 activity 恰好 8 个类型
     × 平铺扫描不递归：实例落点不再被生产 loader 当成第 9 个节点类型
     …（其余 20 条 fixture/降级/边界/判别性用例 ✓）
 Test Files  1 failed (1)
      Tests  5 failed | 20 passed (25)
```

关键失败原文（逐条，未截断）：
```
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ "扩展面: extensions/ontology/extensions/ 零件（或目录不存在）—— 卡面 Done ② 的反例点（删掉扩展层 ⇒ 本段必红）" ]
AssertionError: extensions/ontology/activity/acquisition.json 仍在 Schema 层携带评估属性: expected [ 'headcount', 'hours_per_run', …(8) ] to deeply equal []
AssertionError: loader 加载到的 activity/acquisition 仍带评估属性: expected [ 'headcount', 'hours_per_run', …(8) ] to deeply equal []
AssertionError: expected true to be false  // instances/ 旧目录仍在
```
⇒ 5 条红**全部落在"真件/落点"上**（不是语法/收集失败），且收集数 = 25（非 `no tests`）⇒ 判别性成立。
`VITEST_EXIT=1`。

## §A.3 反例（Done ②）：删掉扩展层 ⇒ 探针必 exit 1（原始输出）

**做法**（可逆、字节等价）：`ren extensions\ontology\extensions\general-enterprise\activity.json activity.json.bak`（扩展层有效声明数 = 0）——**不是**改判据、不是改探针。

```
── ② EXTENSION [L1] — … ──
  [FAIL] 扩展面: extensions/ontology/extensions/ 零件（或目录不存在）—— 卡面 Done ② 的反例点（删掉扩展层 ⇒ 本段必红）
  扩展声明件数: 0
  [FAIL] activity/acquisition: 扩展层缺评估属性 [headcount, hours_per_run, runs_per_period, unit_labor_cost, error_rate, structuredness, error_tolerance, data_reachability, agent_readiness_score, agent_type_recommendation]
  …（**共 8 处**：8 个 activity 类目逐条点名）
  覆盖: activity/acquisition=0/10  activity/compliance=0/10  activity/coordination=0/10  activity/governance=0/10  activity/innovation=0/10  activity/learning=0/10  activity/maintenance=0/10  activity/production=0/10
── ④ LOAD [L1] — … ──
  [FAIL] LOAD: …: prop 'headcount' 在 Schema 层与扩展层均无声明（无归属）
  …（**共 10 处**无归属）
  [FAIL] LOAD: …: 评估属性 'headcount' 未被任何扩展声明覆盖（activity/production）
  …（**共 10 处**覆盖缺失）
SUMMARY: sections=4 failures=29
RESULT=FAIL
```
```
PROBE_EXIT=1
```
判据件同步红（同一反例、同一时刻）：`Tests 1 failed | 24 passed (25)`，失败点 = `真件三面：…`（`VITEST_RED_EXIT=1`）。

> 口径诚实标注：本反例证明「扩展层缺失 ⇒ ② 覆盖判据 + ④ 加载链判据必红」。**首次尝试用"改目录名"造红时探针黑红的原因是 `axisId ≠ 目录名`（非本判据）⇒ 已重做**，最终读数即上文（避免"假红"被当成判别性成立）。

## §A.4 恢复绿 + 红证不残留（原始输出）

**复原**：`ren … activity.json.bak activity.json` → `REN_BACK=0`
```
===HASH_AFTER===
9fd753cd4b11656b04611d53bc4b3d591e1ac8896345262a0ac48665e5f043fd     ← 与造红前 HASH_BEFORE 逐字一致
===EXT_LAYER===
D:\synova-wt-b2-1057\extensions\ontology\extensions\general-enterprise\activity.json
```
**复跑（恢复绿）**：
```
$ npx tsx scripts/control-tower/probe-ontology-instances.ts
SUMMARY: sections=4 failures=0
RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）
PROBE_EXIT=0

$ npx vitest run tests/ontology/instance-loading.test.ts
 Test Files  1 passed (1)
      Tests  25 passed (25)
VITEST_EXIT=0
```
**红证不残留**：`git status --porcelain=v1` 无 `*.bak`、无多余项（见 §A.5 同一读数；`.bak` 曾出现的唯一时刻已被 §A.3 记录）。

## §A.5 交付清单（命令原始输出）

```
$ git -c credential.helper= -c safe.directory=* status --porcelain=v1
M  extensions/ontology/activity/acquisition.json
M  extensions/ontology/activity/compliance.json
M  extensions/ontology/activity/coordination.json
M  extensions/ontology/activity/governance.json
M  extensions/ontology/activity/innovation.json
D  extensions/ontology/activity/instances/activity-production-wani-baby-001.json
M  extensions/ontology/activity/learning.json
M  extensions/ontology/activity/maintenance.json
M  extensions/ontology/activity/production.json
D  tests/l4/activity-instance-1057.test.ts
?? customer-config/
?? extensions/ontology/extensions/
?? scripts/control-tower/probe-ontology-instances.ts
?? tests/ontology/instance-loading.test.ts
```
```
$ git -c … diff --stat origin/local-main -- extensions/ontology/activity
（空输出 —— 8 个类目 + 旧实例目录**逐字节回到 local-main**）
```
**搬家对偶（PR 内为"删 + 增"，非并存）**：
- 删 `extensions/ontology/activity/instances/activity-production-wani-baby-001.json` → 增 `customer-config/ontology-instances/wani-baby/activity-production.json`（内容复用；仅 `_notes` 中**落点注记**两行改写，其余逐字不变）
- 删 `tests/l4/activity-instance-1057.test.ts` → 增 `tests/ontology/instance-loading.test.ts`

**PR 预算口径**（`scripts/control-tower/check-pr-budget.sh`，基线 `origin/local-main`）：
- 增/改件：4 新（实例 / 扩展 / 探针 / 判据件）+ 治理产物（证据 / claim / brief）—— **纯新增件不计入预算**（CTO 2026-10-11 裁定②，脚本 L605-624 显式点名）
- 计入预算的只有 **2 件删除**（`D`，脚本 L197-201 把 D 计入 COUNT_PATHS）⇒ **2 ≤ 12** ✔
- 单域：② 本体层（含其判据载体）✔

## §A.6 三面落点与冻结口径

| 件 | 落点（本卡实测） | 说明 |
|---|---|---|
| Schema（未动，已回退） | `extensions/ontology/activity/*.json`（8 件） | 与 local-main **逐字节一致**；10 属性**不再**出现在 Schema 层 |
| 实例 | `customer-config/ontology-instances/wani-baby/activity-production.json` | orgId = 目录名 = `doc.graph` = `wani-baby`；`type` = 既有 `$id` `activity/production`（**不新造类型**，宪章 P4） |
| 扩展 | `extensions/ontology/extensions/general-enterprise/activity.json` | `axis=industry` / `axisId=general-enterprise`；`extends` 逐条列 8 个 `activity/*`；10 属性**声明（名 + 型）唯一位** |
| 探针 | `scripts/control-tower/probe-ontology-instances.ts` | 纯 fs、零 DB；末行 `RESULT=`；四段独立可红 |
| 判据件 | `tests/ontology/instance-loading.test.ts` | 隔离 fixture（`os.tmpdir()`）+ 仓内真件 + 降级 + 边界 + 判别性 |

**两处需 CTO/队长知悉的"依据 + 可一票改"口径**：
1. **扩展件粒度**：8 个类目共用同一组 10 属性 ⇒ 落 **1 件族级声明**（`extends` 逐条列 8 个 `$id`），而非"每节点一件"（8 件）。依据：卡面命名规则只给到 `<industry|profession>/<edge-or-node>.json`，未给粒度；单件使 PR 变更件数 6（原始口径）且语义单源。**可被 CTO 一票改**（改 8 件 = 每节点一件 + 探针/判据件零改动，因其按**目录扫描合并**口径实现）。
2. **行业轴取值**：`general-enterprise`（`extensions/industries/` 既有 6 个 id 之一：general-enterprise / manufacturing / retail-ecommerce / saas-tech / financial-services / test-write），属队长倾向；`profession` 轴未被本卡采用。

## §A.7 诚实边界（LIMITS —— 防「接线了 ≠ 被执行」误读）

1. 探针是 **L1 真读盘**：证明三面落点存在 / 自洽 / 值可断言；**不**证明生产链消费了这两个新落点。当前 `src/l4/ontology-loader.ts:80-97` 只扫 `resource/activity/outcome` 平铺层 ∪ `extensions/industries/<id>/edge-types`，**不扫** `extensions/ontology/extensions/**` 与 `customer-config/**`；生产接线**不在本卡写集**（卡面明禁 `src/l4/**`）⇒ 见 §A.8 遗留 1。
2. **[L2] 面由判据件承担**（`loadOntology()` 真加载 8 类目、`degraded=false`）——因 vitest 侧有 `@synova/logger` 别名解析；探针刻意不 import `src/**`（保持"干净 clone 上可跑"的鲁棒性）。
3. 本卡**未**把 10 属性声明并入 Schema 层（冻结口径），也**未**新增节点/边类型（`nodes:29 edges:56` 原始 logger 行可核）。

## §A.8 遗留清单（未解决项，直说）

1. 🔴 **生产未接线**：无任何生产代码读 `extensions/ontology/extensions/**` 或 `customer-config/ontology-instances/**` ⇒ 需要一张后续卡（`src/l4/ontology-loader.ts` 增扩展层合并 + 实例加载器）；本卡只落盘 + 落判据。
2. 🔴 **旧判据件的 DB 写入路径断言已撤除**：`SqliteGraphStore` 迁移 / `graph_nodes.props` / `activity/*` 计数属图存储域（K4-04 / #1455）⇒ 本卡不再承载；**若 CTO 认为必须保留，请另行指定落点**（本卡不得把 DB 断言写进本体判据件，卡面要求仓内可复跑）。
3. ⚠️ **`activity` 标签不在 `extensions/ontology/tags.json`**：8 个类目件的 `tags:["activity",…]` 属 local-main 存量（本卡回退后与基线逐字节一致）⇒ `check-file-driven.sh` 的 tags 组本地为**软提示**、CI 侧空暂存区不触发。本卡**不碰** `tags.json`（#1436 独占，写集外）。扩展件**刻意不含 `tags` 字段**以避开该组。⇒ 提议另立卡收口（存量标签 vs tags.json 合法性）。
4. ⚠️ **旧 brief 保留**：`.claude/task-briefs/2026-10-09-1057-activity-instance-props.md`（批 1）保留为历史件，其落点已被 K4-03 卡面取代；D708 声明链的 S3 仍会命中它 ⇒ 本卡以 **S0 claim** 为准（writeset 为**并集**口径）。
5. `extensions/ontology/manifest.json`（`nodeTypes:29` / `edgeTypes:16`）**未随扩展层更新**：该字段语义是 Schema 层的类型计数，本卡新增的是扩展层声明（非节点类型）⇒ 未改（也不在写集内）。
6. 实例值多为**手填占位**（`_provenance` 的 `handfill:`）——沿用批 1 状态，待访谈核实。

## §A.9 复核用原始命令（可重跑；脚本文本随附）

```bash
# 前提 P3 的脚本（本卡实测用；输出见 §A.0）
python3 check-eval-props.py          # 内容 = 读 8 个 activity/*.json → 逐属性打印 name:type + 一致性判定
# 判据（本卡）
npx tsx scripts/control-tower/probe-ontology-instances.ts        # 期望 RESULT=OK / exit 0
npx vitest run tests/ontology/instance-loading.test.ts           # 期望 25 passed / exit 0
# 反例（§A.3；改完必须复原）
ren extensions\ontology\extensions\general-enterprise\activity.json activity.json.bak
npx tsx scripts/control-tower/probe-ontology-instances.ts        # 期望 RESULT=FAIL / exit 1
ren extensions\ontology\extensions\general-enterprise\activity.json.bak activity.json
git -c credential.helper= -c safe.directory=* status --porcelain=v1   # 期望无 *.bak 残留
```

## §A.10 提交后复跑 / 干净 clone / 门禁复跑 / token 复核（原始输出）

**提交**：`e064182492e9708f4df43c7bc6906338d2b1cf02`（分支 `fix/1057-activity-instance-props`；提交内 15 files changed；vs `origin/local-main` 见 A.10.3 = **7 件纯新增**）

### A.10.1 提交后复跑（committed tree）
```
$ npx tsx scripts/control-tower/probe-ontology-instances.ts
SUMMARY: sections=4 failures=0
RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）
PROBE_EXIT=0

$ npx vitest run tests/ontology/instance-loading.test.ts
 Test Files  1 passed (1)
      Tests  25 passed (25)
VITEST_EXIT=0
```

### A.10.2 干净 clone（`data/synova.db` **不存在**）⇒ Done ①
```
$ git -c … clone --no-hardlinks D:\synova-wt-b2-1057 <TMP>\clean-clone-1057   → CLONE_EXIT=0
$ dir /b data                                    → golden        （仅 golden 冻结数据集）
$ (if exist data\synova.db …)                    → DB_MISSING    （干净 clone 内零 synova.db）
$ mklink /J node_modules D:\…\synova-agent\node_modules → Junction created
$ npx tsx scripts/control-tower/probe-ontology-instances.ts → RESULT=OK / PROBE_EXIT=0
$ npx vitest run tests/ontology/instance-loading.test.ts    → Tests 25 passed (25) / VITEST_EXIT=0
```

### A.10.3 PR 变更集（vs `origin/local-main`，命令原始输出）
```
$ git -c … diff --name-status --find-renames origin/local-main...HEAD
A	.claude/claims/1057.yaml
A	.claude/task-briefs/2026-10-09-1057-activity-instance-props.md
A	customer-config/ontology-instances/wani-baby/activity-production.json
A	docs/synova/product-lines/evidence/1057-activity-instance-props.md
A	extensions/ontology/extensions/general-enterprise/activity.json
A	scripts/control-tower/probe-ontology-instances.ts
A	tests/ontology/instance-loading.test.ts
$ git -c … diff --stat origin/local-main...HEAD
 7 files changed, 1696 insertions(+)
```
（批 1 对 8 个 `activity/*.json` 的改动 + 旧件新增，被本卡"回退 / 搬家"**抵消** ⇒ PR 内 = **7 件纯新增**，删除侧不出现在 PR 变更集里。PR 预算：纯新增按 CTO 2026-10-11 裁定② 不计入，计入件 = **0 ≤ 12** ✔；单域 = ② 本体层 ✔。）

### A.10.4 门禁复跑（**同一 staged 集**，两种开关配置的差分 ⇒ 见结论③）
```
$ bash scripts/pre-commit-check.sh                         → DEFAULT_EXIT=1
  ❌ 声明闸① brief schema（Q1–Q3/架构层/Done/骨架/Q0c；D1220 退时间戳+Q0）: 1 处 [硬阻断]
      今日无 task brief。请先运行: bash scripts/workflow/task-start.sh "任务描述"
  ❌ 声明闸② brief↔代码一致性（Q2 写集/排除项/可解析；D1148 合并 15→3）: 12 处 [硬阻断]
      customer-config/ontology-instances/wani-baby/activity-production.json (不在 Q2 范围内)
      extensions/ontology/activity/{acquisition,compliance,coordination,governance,innovation,learning,maintenance}… (不在 Q2 范围内)
  ❌ 2 组未通过 — 提交已拒绝
$ SYNO_CLAIM_V2=1 bash scripts/pre-commit-check.sh         → CLAIMV2_EXIT=0
  ℹ️  组 6: 声明载体 = claim（.claude/claims/1057.yaml）→ ✅ 声明闸① brief schema
  ℹ️  组 12 claim 载体: 15 条 claim（并集）；覆盖 14/14 个暂存文件 → ✅ 全部暂存文件均被 claim 覆盖（legacy 判定无对象）
  ✅ 全部 13 组通过        ⚠ V5: 1 项软提示（详情见 A.10.5）
```
**结论③（必须让 CTO 看见，属门禁/流程域，本卡不改）**：本卡（issue 号 + claim 载体）在**未设 `SYNO_CLAIM_V2`** 的默认态会被声明闸①/② **硬拦**，根因不是交付内容而是**载体开关默认值**：
- `scripts/pre-commit-check.sh:1040-1043` 的 `case` 对**未设**值落 `*) CLAIM_V2=0`（= 默认关）；
- 但 `memory/notes/implemented/2026-10-08-1423-claim-default-on.md`（卡 #1423）与 `scripts/control-tower/claim_store.py:110` 注释均写「**默认开**」⇒ **脚本实现与其决策 Note 不一致**；
- `.github/workflows/ci.yml:196-199` 跑 `bash scripts/pre-commit-check.sh`（`SYNO_CI=1`）且**未注入** `SYNO_CLAIM_V2` ⇒ **同样的红会出现在 PR CI**；
- 另：`brief_parser.py --q2-include .claude/task-briefs/2026-10-11-236-K4-03-….md` ⇒ **空输出**（卡面 Q2「做什么」是散文、写集在单独 `## 写集` 段；D1231 要求「裸路径、独立成行」）⇒ 今日窗口内**没有任何 legacy brief 认领本卡文件**。
⇒ 归 CTO 裁（① ci.yml 注入开关；② 修默认值；③ 或要求今日窗口 legacy brief）。**本卡不碰门禁脚本**（写集外）。

### A.10.5 唯一软提示（绿腿告警，可见 + 有据）
```
⚠️ tags 引用完整性: extensions/ontology/activity/*.json 标签 'activity'（8 处）/ 'routine'（1 处）不在 tags.json 合法值中
```
口径：这 8 件**逐字节等于 local-main 存量**（`git diff origin/local-main -- extensions/ontology/activity` ⇒ **空输出**）⇒ 属**基线存量**标签问题，本卡未引入该标签；`extensions/ontology/tags.json` 由 #1436 独占（本卡写集外，**禁碰**）。本卡新增的扩展件**刻意不含 `tags` 字段**，故不会给该组添新红。⇒ 记入遗留 3。

### A.10.6 D708 合并级写集对账（原始输出）
```
$ python3 scripts/control-tower/merge_writeset_gate.py --base origin/local-main --head HEAD \
      --branch fix/1057-activity-instance-props --repo-root .
✅ 结论: pass — 提交文件集 ⊆ 声明写集（无夹带）
   身份来源: claim → #1057（.claude\claims\1057.yaml）
   变更集: 13 个文件（merge-base e52499dd）｜声明写集 17 条（多源并集，逐条 S0:claim.writeset）
   豁免 1 条: .claude/claims/1057.yaml ← [claim-self] 本 PR 自身的声明文件（对账输入，非交付物）
D708_EXIT=0

$ git -c … diff --cached --name-only | python3 scripts/control-tower/claim_store.py --coverage
{"status": "ok", "claims": 15, "uncovered": [], "broken": [], "degraded": false,
 "reason": "15 条 claim（并集）；覆盖 15/15 个暂存文件"}
```

### A.10.7 环境事实：本克隆**未安装 git hooks**（提交未触发 hook 链）
```
$ dir /b .git\hooks                      → 仅 *.sample（无 pre-commit / commit-msg / pre-push / post-commit）
$ git config --get core.hooksPath        → 未设（exit 1）
```
⇒ 本次 `git commit` **没有**经过 hook 链：门禁不是被"绕过"，而是本地**未安装**（需显式跑 `scripts/install-hooks.sh`；本卡未执行、也未改 `.git/**`）。因此 A.10.4/A.10.6 的证据 = **手动跑同一批脚本**（与 CI 同源、同 staged 集）。
⚠️ 附注（供 CTO）：`scripts/commit-msg-check.sh:249` 的 D395-a Note 引用门禁把 `scripts/control-tower/**`（除 `*.test.sh`）列为治理脚本区 ⇒ 一旦装上 hooks，本卡 commit **需在 message 引用 `memory/notes/` Note**；本卡写集**不含** `memory/notes/**` ⇒ 若要求装 hooks，请 CTO 指定可引用的既有 Note，或授权新增 Note（本卡不自选、不自造）。

### A.10.8 token 0 处复核（命令 + 退出码；不回显 token 值）
```
$ set /p TOK=<D:\win-push.token                                    （仅内存变量）
$ git -c … grep -l "<TOK>" HEAD                                    → 无输出 / GIT_GREP_EXIT=1     （0 处）
$ findstr /s /m /c:"<TOK>" <本卡 6 个交付件>                        → 无输出 / FINDSTR_EXIT=1      （0 处）
$ git -c … log -1 --format=%B | findstr /c:"<TOK>"                  → 无输出 / MSG_EXIT=1          （0 处）
$ git -c … remote get-url origin  → http://192.168.1.7:3000/synova-agent/SynovaAgent.git（URL 不含 token）
```
（token 未写入任何文件 / commit / 证据件 / PR 体；仅作命令行内"有无"判定。）

## §A.11 收尾三件索引（实施席口径）+ 自验归属声明

| 收尾件（RUNBOOK §4 / M6） | 本件落点 | 说明 |
|---|---|---|
| **diff** | §A.10.3（`diff --name-status` / `diff --stat` vs `origin/local-main`）+ §A.5（提交内 `status` / `diff --stat`） | 均为命令原始输出；PR 内 = 7 件纯新增 |
| **复跑读数**（实施席） | §A.10.1（提交后复跑）+ §A.10.2（干净 clone，`data/synova.db` DB_MISSING） | 探针 `RESULT=OK`/exit 0；判据件 `25 passed`/exit 0 |
| **遗留清单** | §A.8（6 条）+ §A.10.5（tags 存量软提示）+ §A.10.4 结论③（载体开关默认值） | 无隐瞒项 |

**自验归属（M3 铁律）**：本件**不含「自验结论」三态判定**（也不含「审计通过」字样）——**自验不得由编码兼任**。上面全部读数的性质是「**实施席复跑证据**」（探针 = L1 真读盘、判据件 = L1/L2），**不构成**独立自验结论。
⇒ **自验结论**由独立成员（`verifier-k4`，独立克隆、只读 + `/tmp` 可写）出具；**通过与否**归 CTO 收件闸 + K3 终审。本卡未推远端、未建 PR、未合并。

---

# §B 批 1 历史记录（原 §1–§9；落点已被 §A 改写，读数为其时真实读数）

# #1057 证据件 — 作业单元缺两件（实例 + 评估属性）

- **卡**：GitHub issue #1057（3-5｜模块 K4）｜本地镜像 `.k4-cards/card-1057.md`（GitHub 账号级封禁期：**未读线上、未发评论、未开 PR**）
- **执行人**：`k4-coder-c`（k4 小队编码 C）｜**自验**：独立成员（task-8），**非编码兼任**
- **工作树**：`D:\novis-backup-20260526\Novis\.synova-wt-1057`｜分支 `fix/1057-activity-instance-props`
- **基线**：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`
- **判据等级**：L2-真跑通（真机库 + 真实写入路径 + 改坏即红）
- **状态**：**未合并** —— 等待 GitHub 通路恢复 + CTO/K3 放行
- 读卡确认（先于写码产生）：`.k4-publish/read-card-confirm.md`

---

## 0. 卡面判据 ↔ 本件读数（一屏对照）

| # | 卡面判据（§⑥） | 本件读数 | 状态 |
|---|---|---|---|
| ① | `graph_nodes` 出现 `activity/*` 节点（计数非 0） | 真机库**在位**：`0 → 1`（`activity/production`，graph=`wani-baby`） | 🟢 |
| ② | 属性非空（10 个属性至少覆盖读得到） | 8 个 `activity/*` 类目 **10/10** 覆盖；实例 10 个属性经 `queryNodes` 逐字读回 | 🟢 |
| ③ | 反例（改坏即红） | 删实例文件 ⇒ **5 条判据测试红**；复原 ⇒ **11 绿** | 🟢 |

---

## 1. 前提冻结（逐条实测；输出为命令原始读数）

| 前提 | 命令 | 输出摘要 |
|---|---|---|
| `activity/` = 8 个类目 | `Get-ChildItem extensions/ontology/activity -File` | `acquisition/compliance/coordination/governance/innovation/learning/maintenance/production` ⇒ **count = 8** |
| `production.json` 顶层键 = 6 个、**10 属性 0 命中** | `python3` 读 JSON | `TOP= ['$id','label','tags','requiredProps','optionalProps','description']`；`optionalProps` 原有 **7 键**，卡面 10 属性**全缺** |
| 已在生产链加载 | `grep -rn 'loadOntology(' src`（排除 loader 本体） | **4 处**：`src/init/file-driven-loaders.ts:96`、`src/mcp/tool-definitions.ts:394`、`src/routes/ontology-admin.ts:17`、`src/sentinel/sentinel-loader.ts:219`；目录常量 `src/l4/ontology-loader.ts:80` |
| 真机库 `graph_nodes` = 0 行 | python3 sqlite3（`mode=ro`） | `SELECT COUNT(*) FROM graph_nodes` = **0** |
| 真机库为**旧形态** | `PRAGMA table_info(graph_nodes)` | `['id','type','graph','name','confidence','props_json','created_at','updated_at','valid_to']` —— **无 `props` 列**；`schema_version` 表**不存在** |
| loader 平铺扫描（实例须放子目录） | 读 `src/l4/ontology-loader.ts:59-68` | `scanDir` = `readdirSync(dir).filter(f => f.endsWith('.json'))`，**不递归** |

> ⚠️ 口径替换（队长 2026-10-09 裁定 ③）：卡面 §⑥ 的 `sqlite3` **CLI 在本机不存在**（`command -v sqlite3` ⇒ `NOT_FOUND`）。**语义不变，读数工具替换为 python3 内置 `sqlite3`**（`mode=ro` 只读打开做查询）。上面与下面的所有 SQL 读数均出自该替换工具，**未假装原命令跑过**。

---

## 2. 判据① — 真机 `data/synova.db` **在位**（队长裁定授权；生产路径自愈式迁移）

**执行序**：先落一致性快照（回滚件）→ 记 sha256 before → 开库打印 before → **走生产路径** `new SqliteGraphStore(db)`（构造函数自带 `reconcileSchema`，属应用自身行为，非手工 hack）→ `createNode` → 打印 after。

### 2.1 原件 sha256（前后）+ 回滚件

```
STEP B｜一致性快照（VACUUM INTO，落 worktree data/1057-snapshot/；data/ 已 gitignore 不进 git）
snapshot = data\1057-snapshot\snapshot-1057-before-inplace.db size = 12812288
9b8b398a73437bcffc6f835add857f638deae8b432b0fee6a58aee2470d9f161 *data/1057-snapshot/snapshot-1057-before-inplace.db

STEP C｜真机原件 sha256 BEFORE
437d07a662b9fb1320820fb9357551f593d3ebe8011b69f0abee8b8b6452db2a *…/synova-agent/data/synova.db

STEP E｜真机原件 sha256 AFTER
771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a *…/synova-agent/data/synova.db
size=12959744 mtime=2026-10-09 03:34:59.148433400 +0800   （BEFORE: 12926976 / 2026-08-14 20:21:52）
```

### 2.2 before / 迁移后 / after（测试内原始读数）

```
[1057][真机在位·before] {"cols":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to"],"hasSchemaVersionTable":false,"schemaVersionRows":[],"activityCount":0,"totalNodes":0}
[1057][真机在位·迁移后] {"cols":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to","props"],"schemaVersionRows":[2,3,4]}
[1057][真机在位·after] {"nodeId":"node-6da9de53-bf8f-4273-a880-70ec9ecebfec","cols":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to","props"],"activityCount":1,"cardSql":"SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'","rows":[{"id":"node-6da9de53-bf8f-4273-a880-70ec9ecebfec","type":"activity/production","name":"门店零售交付","graph":"wani-baby"}]}
```

### 2.3 独立于测试断言的真机只读复读（python3 sqlite3）

```
PRAGMA table_info(graph_nodes) cols = ['id','type','graph','name','confidence','props_json','created_at','updated_at','valid_to','props']
schema_version rows = [2, 3, 4]
SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%' = 1
SELECT COUNT(*) FROM graph_nodes (total) = 1
ROW id=node-6da9de53-bf8f-4273-a880-70ec9ecebfec graph=wani-baby type=activity/production name_cjk_chars=6
    props keys(15) = ['name','output_type','production_mode','cycle_time_hours','capacity_utilization','headcount','hours_per_run','runs_per_period','unit_labor_cost','error_rate','structuredness','error_tolerance','data_reachability','agent_readiness_score','agent_type_recommendation']
    10 eval props present = True
    10 eval props numeric  = {'headcount': 10, 'hours_per_run': 10, 'runs_per_period': 30, 'unit_labor_cost': 88, 'error_rate': 0.02, 'structuredness': 0.55, 'error_tolerance': 0.35, 'data_reachability': 0.2, 'agent_readiness_score': 0.45}
    agent_type_recommendation set = True
```

### 2.4 回滚件可核（快照仍为迁移前形态）

```
snapshot cols = ['id','type','graph','name','confidence','props_json','created_at','updated_at','valid_to']
snapshot activity/* count = 0
```

> **未合并声明**：真机库是**本机 dev 数据资产**（`data/` 已在 `.gitignore`），本次在位迁移+写入**不产生 git 变更**。回滚方式：以 2.1 快照覆盖原库（sha256 `9b8b398a…`），即回到 count=0 / 无 `props` 列的迁移前形态。

### 2.5 表级副作用披露（CTO 2026-10-09 追问项，逐项如实）

**库表数 52 → 55**（+3）：`schema_version`（迁移框架表）、`metric_readings`（迁移 002）、`orgs`（迁移 003）。
⇒ 在位运行不只加 `graph_nodes.props`，**还建了 3 张表**（属同一 `reconcileSchema` 行为，非本卡手工动作）。

**`PRAGMA table_info(graph_triples)` 前 / 后（CTO 点名项）**：前置口径 = 迁移前一致性快照（该快照是整库副本，取它即"迁移前真值"，非推理）。

```
BEFORE = AFTER，**逐列完全相同、未被本次写入触碰**：
  14 列: id,subject_type,subject_id,predicate,object_type,object_id,graph,weight,props_json,
         confidence,source,valid_from,valid_to,created_at
  DDL: CREATE TABLE graph_triples ( id INTEGER PRIMARY KEY AUTOINCREMENT, … props_json TEXT DEFAULT '{}', … )
  COUNT(graph_triples) = 0 → 0
```
⇒ ① 该表**没有 `props` 列**；② 主键是 `INTEGER PRIMARY KEY AUTOINCREMENT`（**canonical 是 `TEXT PRIMARY KEY`**）；
③ 迁移 001 只 `ALTER graph_nodes`，**没碰它**。本卡据此**未建任何边**（`createEdge` 在本形态上物理不可用，#1455 在修）。

### 2.6 🔴 形状漂移声明（如实声明 + 建议另立卡；本卡不擅动）

真机 `graph_nodes` 的形态与 canonical `SCHEMA_SQL`（`src/adapters/sqlite-graph-store.ts:20-40`）**不一致**，且迁移 001 未涉及主键：

| 维度 | 真机库实测 | canonical `SCHEMA_SQL` | 差异 |
|---|---|---|---|
| 主键 | 复合 `PRIMARY KEY (id, graph)` | `id TEXT PRIMARY KEY` | 🔴 形状漂移 |
| `valid_from` | **不存在** | `valid_from TEXT NOT NULL DEFAULT (datetime('now'))` | 🔴 缺列 |
| 额外列 | `confidence` / `updated_at` / `props_json` | 无 | 遗留形态 |

⇒ **本批不重建 `graph_nodes`**（今天不红，重建属高风险数据迁移）⇒ **建议另立卡**（提案→K3→CTO）。**本卡不擅动**（写集也不含 `src/**`）。

---

## 3. 判据① 对照组（队长裁定 ⑤：**两个读数都贴，不许合并成一句「通过」**）

### 3.1 新库对照（`:memory:` 全新库）

```
[1057][新库对照] {"kind":":memory: 全新库","cols":["id","graph","type","name","props","created_at","valid_from","valid_to"],"migrations":[2,3,4],"nodeId":"node-bc294df9-…","countAfter":1,"note":"迁移 001 在全新库上是 no-op（表由 initSchema 建，已含 props 列）"}
```

### 3.2 旧形态库（hermetic 夹具）+ 判别性反证

```
[1057][判别性反证] 旧形态库列 = id,type,graph,name,confidence,props_json,created_at,updated_at,valid_to | INSERT 与 SELECT props 双双报错 | 插入 activity/* 前计数 = 0
[1057][判据① 真实写入路径] {"colsBefore":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to"],"countBefore":0,"colsAfter":[…,"props"],"migrations":[2,3,4],"nodeId":"node-04c11c3c-…","cardSql":"SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'","countAfter":1,"readBackEvalProps":[…]}
```

**三者对照结论（分开陈述）**：
- 真机库：**需要**迁移 001 真加列 + 回填（`props_json→props`），之后写入成功 ⇒ 判据① 绿。
- 新库：`initSchema` 建表即含 `props`，迁移 001 空转 ⇒ 同一写入路径也绿（**但不能据此声称真机库曾绿**）。
- 旧形态库 + 裸 INSERT（绕过生产类）：**必红**（`table graph_nodes has no column named props` / `no such column: props`）⇒ 证明判据走的是**真实写入路径**，不是静态 grep。

---

## 4. 判据② — 10 个评估属性覆盖 + 实例属性读回

### 4.1 schema 面（8 个类目 × 10 属性）

```
[1057][判据② schema 面] ["acquisition: optionalProps=16 含 10/10","compliance: optionalProps=14 含 10/10","coordination: optionalProps=15 含 10/10","governance: optionalProps=14 含 10/10","innovation: optionalProps=14 含 10/10","learning: optionalProps=12 含 10/10","maintenance: optionalProps=15 含 10/10","production: optionalProps=17 含 10/10"]
```

### 4.2 生产链真实加载（接线 ≠ 被执行 —— 这里真调 loader）

```
[1057][loader 实测] activityTypes = activity/acquisition,activity/compliance,activity/coordination,activity/governance,activity/innovation,activity/learning,activity/maintenance,activity/production
（logger 原始行：{"service":"l4/ontology-loader","nodes":29,"edges":55,"msg":"本体类型加载完成"} ⇒ 类型总数 29 **未变** = 无新节点类型）
```

### 4.3 实例面（逐字读回）

```
[1057][实例属性] {"type":"activity/production","graph":"wani-baby","name":"门店零售交付","evalProps":["headcount=10","hours_per_run=10","runs_per_period=30","unit_labor_cost=88","error_rate=0.02","structuredness=0.55","error_tolerance=0.35","data_reachability=0.2","agent_readiness_score=0.45","agent_type_recommendation=copilot — 辅助型 Agent（商品推荐/补货建议，人工确认后放行）"]}
```

**属性类型口径（本卡自决，卡面未给，见读卡确认 §6-2）**：9 × `number` + 1 × `string`（`agent_type_recommendation`）。
**实例值来源**：逐字段 `_provenance` 标注 `derived:`（派生自 `data/golden/wani-baby-v1.json`，sha256 `f2f4cee40f982488abdab707beb125c3712969b66b63c93c20c3f8f271988bab`）或 `handfill:`（**手填占位，待访谈核实**）。**未声称"已核访谈"**。

---

## 5. 判据③ — 改坏即红（删实例 ⇒ 必红；复原 ⇒ 必绿）

```
阶段 1｜mv 走实例文件 → 实例是否还在: NO
阶段 2｜npx vitest run tests/l4/activity-instance-1057.test.ts
  × 实例文件不会被 loader 当成第 9 个节点类型（…）
  × 实例引用既有 $id（不新建类型）、10 个评估属性非空、含逐字段来源标注
  × 判别性夹具（改坏即红）：抹掉任一评估属性 ⇒ 同一判据函数必报缺失
  × 真实路径：SqliteGraphStore 构造即迁移（props_json→props）+ 写入实例 + 判据 SQL 计数 = 1 + 10 属性读回
  × 全新库：initSchema 建表即含 props 列 ⇒ 同一写入路径计数 = 1
  Error: [1057] 实例文件不存在: …\instances\activity-production-wani-baby-001.json
  Test Files  1 failed (1)      Tests  5 failed | 6 passed | 2 skipped (13)
  VITEST_DAMAGED_EXIT=1
阶段 3｜mv 复原 → 实例是否复原: YES｜复原后 sha256: 9c9aa30a629a91a875f390198afca950ba09e1674f5011ae30bcb3105a8f292e
阶段 4｜重跑
  Test Files  1 passed (1)      Tests  11 passed | 2 skipped (13)
  VITEST_RESTORED_EXIT=0
```

（"2 skipped" = 两个真机口径段落未设 env 时的正常跳过。）

### 5.1 判别性夹具自检协议（队长 2026-10-09 纪律；本卡事后补齐，并**据以修掉一个真缺陷**）

**为什么必须两小步都过**：① 仓库 `tsconfig.json` 的 `exclude` 含 `tests` ⇒ 全局 `tsc --noEmit` 对夹具**零覆盖**，必须单文件跑；② 破坏若让语法非法，vitest 报 `no tests / exit 1` ⇒ **抄 exit code 会把"文件没解析"当成"判别性成立"**。

**结果一（本协议当场抓出并修掉 4 处真类型错误 TS2345）**：原用自造结构体 `SqliteHandle` 当库句柄，缺 `memory/readonly/name/open/…` ⇒ 传给 `new SqliteGraphStore(db)` 报 TS2345；**全局 tsc 永远看不见**（`tests` 被 exclude）。已修：改用 `better-sqlite3` 真实类型 `type Db = Database.Database`（零 `as any` / `as unknown as`）。

**结果二（破坏态，两小步 + exit code 原始读数）**
```
期望用例数（源文件真值）: it( 11 + realIt( 1 + inplaceIt( 1 = 13
步骤①-b 单文件 tsc（破坏态）: TSC_DAMAGED_EXIT=2  TS1xxx 计数 = 0  本测试文件诊断数 = 0
        （余下 3 条 TS2307 全在 src/**，是 @synova/logger 为 vitest alias 所致的单文件编译假象，非本卡缺陷）
步骤②-b vitest 收集数: Test Files 1 failed (1) ｜ Tests 5 failed | 6 passed | 2 skipped (13)
        ⇒ 收集数 13 == 期望 13（**不是 no tests**），且逐用例行有具名 ×/✓/↓
失败证据: AssertionError: expected false to be true ｜ Error: [1057] 实例文件不存在: …activity-production-wani-baby-001.json
步骤③ 两小步都过后才读 exit code: VITEST_DAMAGED_EXIT=1
复原: sha256 = 9c9aa30a629a91a875f390198afca950ba09e1674f5011ae30bcb3105a8f292e（与破坏前逐字一致）
绿腿复跑: tsc TS1xxx=0 / 本文件诊断=0 ｜ Tests 11 passed | 2 skipped (13)
```
⇒ 判别性成立：**收集数满 + 断言真失败**，不是"解析失败被当成红"。
**遗留（控制塔域，本卡不碰）**：给 `tests/` 建专用 tsconfig ⇒ 提案→K3→CTO。

---

## 6. 写集互斥 / 冲突扫描（M2；完整输出，标注「共 N 处」）

```
扫描 1｜src+tests 中引用 `ontology/activity` 的 .ts 文件：**共 1 处**（= 本卡新建测试自身）
    tests/l4/activity-instance-1057.test.ts:58  const ACTIVITY_DIR = join(REPO_ROOT, 'extensions', 'ontology', 'activity');
扫描 2｜`loadOntology(` 装配点（排除 loader 本体）：**共 4 处**
    src/init/file-driven-loaders.ts:96 / src/mcp/tool-definitions.ts:394 / src/routes/ontology-admin.ts:17 / src/sentinel/sentinel-loader.ts:219
扫描 3｜10 个属性名在 HEAD 基线（main 5a6591c4a）的引用：
    headcount => 26 处；hours_per_run / runs_per_period / unit_labor_cost / error_rate / structuredness /
    error_tolerance / data_reachability / agent_readiness_score / agent_type_recommendation => 各 0 处
扫描 4｜本卡文件名唯一性：`activity-instance-1057` 命中 3 个文件（本卡 task brief / 读卡确认 / 测试自身）——**无他卡撞名**
扫描 5｜写集交叉核：本卡 `extensions/ontology/activity/**`；并行卡 #1134 = `edge-types/**`、#1436 = `pool|external/**` ⇒ **不同子目录，无交叉**
```

🔴 **同名近义披露（不隐藏在结论里）**：`headcount` 在 main 本体中**已存在**，语义位置 3 处 —— `resource/team.json`（团队人数）、`outcome/people.json`（人员结果）、`field-mappings/hr-standard.json`（外部字段「员工总数」）。本卡新增的是**作业单元投入人数**（`activity/*`）。属**不同节点类型下的近义字段**，非"同一概念两个 id"；若 CTO 要求改名（如 `staff_count`），每文件 1 行改动 ⇒ 列入未决项。

---

## 7. 改动清单（数字来自命令原始输出）

```
$ git status --porcelain
 M extensions/ontology/activity/acquisition.json
 M extensions/ontology/activity/compliance.json
 M extensions/ontology/activity/coordination.json
 M extensions/ontology/activity/governance.json
 M extensions/ontology/activity/innovation.json
 M extensions/ontology/activity/learning.json
 M extensions/ontology/activity/maintenance.json
 M extensions/ontology/activity/production.json
?? .claude/task-briefs/1057-activity-instance-props.md
?? extensions/ontology/activity/instances/
?? tests/l4/activity-instance-1057.test.ts

$ git diff --stat     （提交前，仅已跟踪文件）
 8 files changed, 8 insertions(+), 8 deletions(-)
```

**文件总数**：8 改 + 3 新（实例 JSON / 测试 / task brief）= **11 个**；其中治理产物（task brief）不计入 PR 预算 ⇒ **PR 内产品/测试文件 = 10 ≤ 12** ✔｜**单域**（L4 本体内容面）✔

---

## 8. 自验独立性与边界

**判据资格口径（原文照录 · CTO/队长 2026-10-09 裁定）**：**活库 = 交付本体，fixture = 判据**。
即：真机库那条 `activity/production` 节点是**交付本体 + 留档**，**不得充当判据**；判据①的可复现来源 = **cwd 在本工作树内**的隔离 fixture（旧形态库 DDL 逐列抄真机读数 → 自愈迁移 → 写入 → 判据 SQL），加"裸 INSERT 必红"判别性反证。

- **本件不含"审计通过"字样**；编码（`k4-coder-c`）**不自判通过**。自验由独立成员（task-8 `docs/synova/product-lines/evidence/1057-verify-*.md`）执行，三态结论归其出具；通过与否归 CTO 收件闸 + K3 终审。
- 提交前已跑定向测试（**未跑全量 vitest**，遵守"重型验证串行 ≤1"上限）。
- 本卡提交 4 个（时间序，无 amend/rebase 改写）：`17d1d18be`（仅 task brief，先于写码）→ `d083c212b`（brief 改名加日期前缀，修组 12 日期窗口）→ `ad7ab56ac`（实现 + 本证据件）→ `3975cd5ed`（`.claude/claims/1057.yaml` 写集声明，治理产物）。
- 组 12 载体双备：date-prefixed brief（本地认领）+ `.claude/claims/1057.yaml`（**日期无关**，CI 可核：`--issue-of fix/1057-activity-instance-props ⇒ 1057`、`--path 1057 ⇒ 该文件`、`--coverage` 本卡 13/13 全覆盖、`broken=[] degraded=false`）。
- **提交后复跑**（committed tree，worktree 干净）：`Tests 11 passed | 2 skipped (13)` exit 0；复跑后真机库 sha256 **仍为 `771f0677…`**、`activity/*` 计数**仍为 1** ⇒ 证明测试 cwd 隔离生效、无二次写入。

## 9. 遗留 / 待裁清单（未解决项，直说）

1. 🔴 **`graph_triples` 同样缺 `props` 列且零迁移** ⇒ 本机 `createEdge` 硬失败、`queryEdges` 失败后静默返回 `[]`（队长裁定 ④ 明示 #1455 在修）。⇒ **本卡未建任何边**；"实例 + 因果边"里的**边那半今天物理不可用**，待 #1455 落地后另卡接续。
2. 🔴 **`graph_nodes` 形状漂移**（真机复合 PK `(id, graph)`、缺 `valid_from`、多 `confidence`/`updated_at`/`props_json`，与 canonical `SCHEMA_SQL` 不一致；迁移 001 未涉主键）⇒ **本批不重建**，**建议另立卡**（提案→K3→CTO），本卡不擅动。详见 §2.6。
3. **表级副作用**：在位运行同时建了 `metric_readings` / `orgs` / `schema_version` 三表（库表 52→55），属 `reconcileSchema` 行为，非本卡手工动作。详见 §2.5。
4. **SOG 校验器无 `activity/*` schema** ⇒ 走「未覆盖类型 — 可见降级放行」（`src/l4/sog-schema-validator.ts:198-210`，`NODE_SCHEMAS` 仅 8 个旧 UPPERCASE 类型）。不在本卡修（`src/**` 禁碰；#980/#1436 域）。
5. **实例值多为手填占位**（`_provenance` 标注 `handfill:`），**待真实访谈核实**；`data_reachability`/`capacity_utilization` 为 golden 近似派生（语义近似已标注）。
6. **`agent_readiness_score` / `agent_type_recommendation` 的口径属 3-6（agent_readiness）** ⇒ 本卡只落示例值 + 自由文本，**不锁死算法/枚举**。
7. **10 属性的类型口径（9 number + 1 string）为本卡自决**（卡面未给），可被 3-6 推翻。
8. `headcount` 与 `resource/team`、`outcome/people` 近义（见 §6 披露）⇒ 是否改名待 CTO 裁。
9. 测试文件按卡面指定名 `activity-instance-1057.test.ts`（实质含真实 SQLite I/O，按铁律 33 本可叫 `.integration.test.ts`）；**遵卡面文件名**，此处备案。
10. **未合并**：GitHub 账号级封禁 ⇒ 无 `ls-remote` 回执（实测 `git ls-remote --heads origin` ⇒ **exit 128 `ERROR: Your account is suspended`**）、未 push、未开 PR、未回填板。本地 commit 见分支 `fix/1057-activity-instance-props`（4 个，见 §8）。
