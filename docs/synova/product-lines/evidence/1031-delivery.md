# #1031 交付件 · 本体参数桥（M6 收尾三件：diff / 自验结论 / 遗留清单）

> ## ⚠️ 版本说明（K4-02 批 2 · 2026-10-11）
> 本件**同时承载两批**：
> - **§A（本文件顶部，权威）**：K4-02 批 2 —— CTO 甲裁定「按派单件交付 + 判据②改落点 + 两笔账显式声明」下的**棘轮上移 + 覆盖力降档机器化**。
> - **§B（下方原 §0–§4，批 1 历史记录，未删改）**：批 1 的读数**在其时真实**（as_of `origin/main = 5a6591c4a`，55 件边类型）。
>   其中**已被现实施覆盖**的计数类陈述（读 §B 时以此为界）：
>   · `edge-types/` **55 件 → 现 56 件**（第 56 件 `goal_decomposition.json`，由 local-main `18ed356f feat(k12-07)` 引入）；
>   · V5 tally：`tf_placeholder 52 → 53`｜`cs_other 0 → 1`｜`lag_resolved 55 → 56`（`cs_declaration 55` 不变）；
>   · §B 的契约、六态、降档分析、U-1…U-7 **仍然有效**。

---

# §A K4-02 批 2 —— 棘轮上移（55→56）+ 覆盖力降档机器化（两笔账）

- **卡**：issue #1031（W2 前置 · 类型层→实例层参数桥）｜**任务书**：`CARD-1031-TASK.md`｜**旧卡面**：`.k4-cards/card-1031.md`
- **执行**：`coder-k4-03`｜**工作树**：`D:\synova-wt-b2-1031`｜**分支**：`fix/1031-ontology-param-bridge`
- **基线**：`origin/local-main = dc5ce093c37f6cf8ef069431b3192a390637f88d`（`lanfetch` 后；`rev-list --left-right --count origin/local-main...HEAD` = `0	6`）
- **写集内落点**：`src/l4/ontology-loader.ts`（注入实现）+ `tests/l4/ontology-loader-param-bridge-1031.test.ts`（判据件）+ 本证据件 + claim/brief
- 🔴 **三条禁令（照令执行）**：① `src/loops/direction-monitor.ts` **一行不碰** ② `extensions/ontology/edge-types/**` **不碰** ③ **不得**把「direction-monitor 读取面」写成"已交"（见 §A.6 两笔账 未交①）

## §A.0 前提冻结（逐条**独立实测**，不照抄任务书；原始输出可复跑）

| # | 前提 | 我的命令 | 原始输出摘要 | 判 |
|---|---|---|---|---|
| D1 | local-main 上 `transfer_function` 的**生产读取面**只剩 1 处注释 | `git grep -n 'transfer_function' origin/local-main -- src/` | 恰 **1 命中**：`origin/local-main:src/loops/direction-monitor.ts:312:   * 部分边类型使用默认基线；未来支持从 transfer_function 推导预期范围。` | ✅ |
| D2 | 分支未碰 `direction-monitor.ts` | `git diff --name-only origin/local-main...HEAD -- src/loops/direction-monitor.ts \| wc -l`（+ blob 对照） | `DIRECTION_MONITOR_CHANGED_FILES=0`；**blob 同一**：`HEAD:… = origin/local-main:… = 34fe81773d881f963d2eb654233e76721f8efe13` | ✅ **加强** |
| D3 | 边类型带 `causal_strength` | `git grep -l 'causal_strength' origin/local-main -- extensions/ontology/edge-types/ \| wc -l` | `EDGE_TYPES_WITH_CAUSAL_STRENGTH=55` / `EDGE_TYPES_TOTAL=56` ⇒ 第 56 件**无该键** | ✅ |
| D4 | 417 行测试**不依赖** `direction-monitor.ts` | `grep -n -i directionmonitor <测试>` / `grep -c '^import'` | `DirectionMonitor` **1 处**（头注释 `:14-15`）；小写 `direction-monitor` **0 处**；`IMPORT_LINES=2`（vitest + `../../src/l4/ontology-loader`） | ✅ |
| D5 | 测试规模（**重测**，任务书口径 417/23/94） | `wc -l` / `grep -c 'describe('` / `grep -c '^  it('` / `grep -c 'expect('` | `LINES=417` / `DESCRIBE=5` / `IT=23` / `EXPECT=94` | ✅ **三个数字全对**（无需更正） |
| D6 | 实现规模 | `git diff --stat origin/local-main...HEAD` | `src/l4/ontology-loader.ts +259`｜`tests/…-1031.test.ts +417` | ✅ |
| D7 | 桥的**读取面含 `causal_strength`**（卡面补全硬要求） | 读 `EDGE_PARAM_KEYS` + 真仓计数（下 §A.0-b） | `EDGE_PARAM_KEYS = ["transfer_function","causal_strength","action_effect_lag"]` ⇒ **已纳入读取面 ✅** | ✅ |
| D8 | 真仓**没有任何 `causal_strength` 数值**（⇒ 数值注入未交） | 同上 | `cs_resolved = 0`（55 `declaration_only` + 1 `absent`） | ✅ |

### §A.0-b 真仓实测（用 **loader 本体**读 56 件；命令 = `npx tsx <TEMP>/real-tally.ts`，非 vitest）
```
EDGE_PARAM_KEYS = ["transfer_function","causal_strength","action_effect_lag"]
EDGE_TYPES_LOADED = 56
LOADER_DEGRADED = false        ERRORS = 0
TALLY = {"tf_resolved":0,"tf_placeholder":53,"tf_prose":3,"tf_other":0,"cs_declaration":55,"cs_resolved":0,"cs_other":1,"lag_resolved":56,"lag_other":0}
PARAMS_LEN_ANOMALIES = []
CS_RESOLVED_LABELS = []
GOAL_DECOMPOSITION_PARAMS = [{"key":"transfer_function","status":"placeholder","injectable":false},{"key":"causal_strength","status":"absent","injectable":false},{"key":"action_effect_lag","status":"resolved","injectable":true}]
GOAL_DECOMPOSITION_PROPS = {"action_effect_lag":"0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞"}   DEGRADED = true
```
Δ 来源（**逐条可归因**，非"数字漂了"）：第 56 件 `goal_decomposition.json` 的
`transfer_function = "N/A — 结构性从属边（非因果传导）：…"`（命中占位族 `n/a`）⇒ `tf_placeholder +1`；
`causal_strength` **缺键** ⇒ `cs_other +1`；`action_effect_lag` 非空串（散文值）⇒ `lag_resolved +1`。

## §A.1 判据审计表（Done → 用例名 → 行号）+ 缺口

行号 = 批 1 交付时 `tests/l4/ontology-loader-param-bridge-1031.test.ts` 的行号（`grep -n` 原始读数）。

| # | Done（旧卡面 ①–⑤ + 补强） | 用例 / 实现 | 行号 | 状态 |
|---|---|---|---|---|
| ① | 注入存在且可判（**断言值**） | V1 组 5 it：`:96 expect(r.props.transfer_function).toBe(TF_NUMBER)`；`:104/:113` 同形透传 identity；`:121` `causal_strength` 值；`:127-131` 恒 3 条 | 89–133 | ✅ |
| ② | 【**改落点**】注入面断言（不再要求 DirectionMonitor 输出差异） | V2 组 5 it：`:156-161` 注入前无键 vs 注入后有值；`:189` 新增键恰 2；`:199-201` 纯函数/不改入参；`:208-210` 唯一变量 | 139–212 | ✅ |
| ③ | 降级可见有 log（不静默） | V3 组 7 it：`:227/:239/:251/:262` warn 计数逐态；`:289-295` 拆 log ⇒ 必红 | 218–296 | ✅ |
| ④ | schema 门禁（G-3）**可跑**；造非法形态 ⇒ **必红** | **in-loader 值域门禁** ✅：`isValidParamValue`（loader `:245-259`）+ 六态机；V3 边界 2 it（`:265-287`）逐条 `malformed` + 不注入 + 不入 props ⇒ 非法形态必红 | 265–287 | ⚠️ **半场**（脚本级未交，见 §A.6 未交④） |
| ⑤ | L1≠L2（真跑，非 grep） | V5 组 4 it（`:302-388`）+ 回归 2 it（`:394-417`）；log 用 `vi.mock('@synova/logger')` **运行时捕获**（`:24-30`） | 302–417 | ✅ |
| 补 | 另核：读取面必须含 `causal_strength` | V1 第 4 it（`:116-122`）+ `EDGE_PARAM_KEYS`（loader `:191`） | 116–122 | ✅ 已纳入 |
| 补 | 契约发布（先定契约后写码） | `1031-injection-contract.md`（六态表 / 六不变式 / 判据映射 / 降档声明） | — | ✅ |

**缺口（"先补测试"清单）**：
- **G1** V5 真仓棘轮件数 `toHaveLength(55)` → **56**（`:305`）⇒ 当前必红（§A.2）。
- **G2** V5 tally 期望上移（`:335-345`）：`tf_placeholder 52→53`、`cs_other 0→1`、`lag_resolved 55→56`。
- **G3** 第 56 件无**点名**用例（其逐字段状态：`tf=placeholder / cs=absent / lag=resolved`）⇒ 新增。
- **G4** 覆盖力降档（未交 ①–④）此前**仅散文**（§B 0-① / 契约 §4.1）⇒ 按本批硬要求改为**机器可判**（棘轮常量 + 真仓 `cs_resolved===0` 断言）。
- **G5** 头注释 `as_of 5a6591c4a` / 55 件 / 「55/55 三者齐备」等陈述 → 更新为批 2 实测事实。

## §A.2 先红（批 1 判据件 vs 新事实；**未动实现**）

**① 初次先红**（批 1 判据件原样，只跑不动）：`cd /d D:\synova-wt-b2-1031 && npx vitest run tests/l4/ontology-loader-param-bridge-1031.test.ts`
```
 ❯ tests/l4/ontology-loader-param-bridge-1031.test.ts (23 tests | 1 failed) 183ms
     ✓ …（V1 5 条 / V2 5 条 / V3 7 条 / 回归 2 条 全绿）
     × 55 件全部过桥；分类计数与 as_of 5a6591c4a 逐件实测一致
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
VITEST_RED_EXIT=1

失败原文（禁截断）：
AssertionError: expected [ { …(11) }, …(55) ] to have a length of 55 but got 56
 ❯ tests/l4/ontology-loader-param-bridge-1031.test.ts:305:32
    305|     expect(ontology.edgeTypes).toHaveLength(55);
```
> 口径诚实标注：此处**只有 1 条用例红** —— 它在 `:305` 即失败，**tally 深比较尚未执行**。为把 tally 缺口也单独照出来，做了第 ② 步。

**② 分步红（只修 G1「件数」、tally 原样）**：
```
 ❯ tests/l4/ontology-loader-param-bridge-1031.test.ts (23 tests | 1 failed) 317ms
     × 56 件全部过桥；分类计数与 as_of local-main=dc5ce093 逐件实测一致（棘轮）
AssertionError: expected { tf_resolved: +0, …(8) } to deeply equal { tf_resolved: +0, …(8) }
- Expected        + Received
    "cs_declaration": 55,
-   "cs_other": 0,          →  +   "cs_other": 1,
    "cs_resolved": 0,
    "lag_other": 0,
-   "lag_resolved": 55,     →  +   "lag_resolved": 56,
    "tf_other": 0,
-   "tf_placeholder": 52,   →  +   "tf_placeholder": 53,
    "tf_prose": 3,
    "tf_resolved": 0,
 ❯ tests/l4/ontology-loader-param-bridge-1031.test.ts:376:19
VITEST_STEP1_EXIT=1
```
⇒ 两条缺口（G1 件数 / G2 tally）各自有独立红证，且 Δ 与 §A.0-b 的实测**逐项一致**（可归因，非"数字漂了"）。

## §A.3 改动清单（逐处；**不删弱任何既有断言**）

全部落在 `tests/l4/ontology-loader-param-bridge-1031.test.ts`（loader **零改动**，见 §A.5 与 §A.9 的 `git status`）。

| # | 位置（改后行号） | 改动 | 对应缺口 |
|---|---|---|---|
| ① | `:90-122`（新增常量块） | `BASELINE_EDGE_TYPES=56`｜`BASELINE_TALLY`（9 键，含 `cs_resolved:0`）｜`EDGE_56`｜`LEDGER`（已交 3 / 未交 4） | G1/G2/G4 |
| ② | 头注释 `:14-24` | 增批 2 说明（as_of `dc5ce093` / 56 件 / 第 56 件来源 commit / 两笔账机器化） | G5 |
| ③ | V5 describe 标题 + `:345` | 「真实 55 件」→「真实 56 件」；`toHaveLength(55)` → `toHaveLength(BASELINE_EDGE_TYPES)` | G1/G5 |
| ④ | `:376` | tally 深比较字面量 → `expect(tally).toEqual(BASELINE_TALLY)`（原 9 个数字上移到常量块，附 Δ 来源注释） | G2 |
| ⑤ | 新增 `:379-407` | 用例「🔴 第 56 件 `goal_decomposition` 逐字段点名」：`tf=placeholder / cs=absent / lag=resolved` + 只有 lag 可注入 + `issues` 2 条 + `BASELINE_TALLY.cs_other===1` 绑死 | G3 |
| ⑥ | 新增 describe `:475-513` | 「两笔账棘轮（已交 / 未交，机器可判）」5 用例：已交 3 项 `DELIVERED`｜未交 4 项 `NOT_DELIVERED`｜未交③ 的**真仓** `cs_resolved===0` 断言｜已交② 的读取面三键断言｜未交① 的"不提供已交证据"边界 | G4 |

**规模 Δ（原始计数）**：`417 → 513` 行｜`5 → 6` describe｜`23 → 29` it｜`94 → 115` expect。
**未改**：`auditEdgeLags` 之外的 loader 一行未动；V1/V2/V3/回归组的断言逐条保留（新增只有 ⑥ 的 5 条 + ⑤ 的 1 条）。

## §A.4 恢复绿（原始输出）

```
$ npx vitest run tests/l4/ontology-loader-param-bridge-1031.test.ts
 ✓ tests/l4/ontology-loader-param-bridge-1031.test.ts (29 tests) 154ms
 Test Files  1 passed (1)
      Tests  29 passed (29)
VITEST_GREEN_EXIT=0

$ npx vitest run …（§A.5 还原后复跑）
 ✓ tests/l4/ontology-loader-param-bridge-1031.test.ts (29 tests) 154ms
      Tests  29 passed (29)
VITEST_RESTORED_EXIT=0
```

## §A.5 造红 / 还原（判别性：改坏即红 + 还原即绿）

**M1（语义型改坏：拆掉「读取面含 `causal_strength`」= 直接攻击卡面补全的硬要求）**
改动：`src/l4/ontology-loader.ts`
`export const EDGE_PARAM_KEYS = ['transfer_function', 'causal_strength', 'action_effect_lag'] as const;`
→ `export const EDGE_PARAM_KEYS = ['transfer_function', 'action_effect_lag'] as const;`（摘掉中间键）
```
 ❯ tests/l4/ontology-loader-param-bridge-1031.test.ts (29 tests | 12 failed) 197ms
     × causal_strength 从 optionalProps 取源（#1430 字段的读取面）⇒ 值正确
        AssertionError: expected [ 'transfer_function', …(1) ] to include 'causal_strength'   （:161）
     × params 恒 3 条且顺序 = EDGE_PARAM_KEYS  → expected [ …(2) ] to have a length of 3 but got 2（:168）
     × V2 三条（注入面键数/值）＋ V3 两条 ＋ V5 三条（含「第 56 件逐字段点名」）＋ 回归一条
     × 已交② 的机器可判证据：读取面**含** `causal_strength`（三键齐备，顺序固定）
        AssertionError: expected [ 'transfer_function', …(1) ] to deeply equal [ 'transfer_function', …(2) ]（:504）
M1_RED_EXIT=1
```
⇒ **红是可归因的**：首条失败逐字点名 `causal_strength`，末条正是本卡新增的「读取面三键」棘轮 ⇒ 该棘轮对"读取面被削"**有分辨力**（不是恒真断言）。

**还原（字节级）**：`copy` 回备份件 ⇒ `certutil -hashfile src\l4\ontology-loader.ts SHA256` = `9920161717d4fc5b92cac4a6c601a693cff8ddeb882c2baeb1f0d0d986f57f5e`
（与改动前 **逐字一致**）⇒ 复跑 **29 passed / exit 0**；`git status --porcelain`：
```
 M docs/synova/product-lines/evidence/1031-delivery.md
 M tests/l4/ontology-loader-param-bridge-1031.test.ts
```
⇒ **`src/l4/ontology-loader.ts` 不在改动列表里**（= 与 HEAD 逐字节相同，红证零残留）。

## §A.6 🔴 两笔账（**PR 正文与证据件各一份**）

> CTO 2026-10-11 甲裁定原文：**已交 = 注入契约 + 实现 + 417 行测试；未交 = ① direction-monitor.ts 读取面 ② 生产可见效果 ③ causal_strength 数值注入 ⇒ 覆盖力降档必须显式声明；「接入调度」另立卡。**

### 已交（逐条，可核）
1. **注入契约**：`docs/synova/product-lines/evidence/1031-injection-contract.md` —— 读取面（按 label 查类型层，option c）/ 注入点 / 同形透传形状表 / **六态**降级语义 / **六条不变式** / 判据映射 / 覆盖力降档声明（§4.1）。
2. **实现**：`src/l4/ontology-loader.ts`（**+259 行**，纯增量、删除行 0）—— `EDGE_PARAM_KEYS`（3 键，**含 `causal_strength`**）｜`readEdgeTypeParams` / `getEdgeTypeParams` / `applyEdgeTypeParams`｜P-3 值域运行时守卫（`isValidParamValue`）+ 六态机 + `degraded`/`issues` + `log.warn`（**非静默**）｜`clearOntologyCache()` 同步失效参数记忆化。
3. **判据件**：`tests/l4/ontology-loader-param-bridge-1031.test.ts`（批 1 = 417 行 / 5 describe / 23 it / 94 expect；**批 2 增补 G1–G4 后 = 513 行 / 6 describe / 29 it / 115 expect**，见 §A.3 规模 Δ）—— 真跑 + `vi.mock` 运行时捕获 log，非 grep。

### 未交（逐条，**含 1 条实施席实测补记**）
1. ① **`src/loops/direction-monitor.ts` 读取面** —— CTO 明令剔除，本卡一行未碰。
   **机器可判证据**：`git rev-parse HEAD:src/loops/direction-monitor.ts` = `git rev-parse origin/local-main:src/loops/direction-monitor.ts` = `34fe81773d881f963d2eb654233e76721f8efe13`（**blob 同一**，强于"未出现在 diff 里"）。
2. ② **生产可见效果** —— 本桥新 export 在 main **无生产调用方**；卡面原话「本卡【不要求】本卡内出现生产可见效果」，真效果需第三卡（DirectionMonitor 接入调度）。
3. ③ **`causal_strength` 数值注入** —— 读取面**已纳入**（`EDGE_PARAM_KEYS` 含它 ✅），但真仓 **`cs_resolved = 0`**（55 `declaration_only` + 1 `absent`）⇒ 今天没有任何数值可注入；真值标定属 **U-3/U-7（另卡）**。
4. ④ **脚本级 schema 门禁（G-3 的「存量占位串计数报告 + 新增占位串阻断」）** —— 📌 **CTO 三笔未列，实施席实测补记**：卡面 Done ④ 的"脚本半场"；`1031-injection-contract.md §5` 的 **U-1** 已声明"若动 `scripts/**` ⇒ 拆给治理线"。本卡**未落地**该脚本门禁，且**不得**落地（判据冻结）。
   —— **in-loader 半场已交**：P-3 值域断言 + 非法形态 `malformed`（V3 边界 2 it）⇒ 「断言可跑 + 非法必红」在 loader 侧成立。

### §A.6-b 给 CTO 的提案输入：**U-2 语义互斥**（本卡不落地，单独成段）
`scripts/control-tower/check-ontology-fields.sh:80` **硬要求 `transfer_function` 为非空字符串**（`:33` 冻结字段集含 `transfer_function`），
而 G-3 的落地目标是「断言 `transfer_function ∈ number|{param:number}|{ref:string}`；新增占位串阻断」。
⇒ **一旦第一批真值按 P-3 标定成 `number`，既有门禁立刻 exit 1**（字符串断言 vs 数值真值）。
且该脚本 `:16` 自述「新增必查字段 = 判据变更 ⇒ 提案 → K3 → CTO」。
⇒ **两者必须一并改**（不是"搬走一条断言"）：这属**判据变更**，须走 提案→K3→CTO；**本卡不碰该脚本**（红线：`scripts/audit/**` 与门禁语义变更归提案线）。

## §A.7 边界与 LIMITS（诚实标注，防误读）

1. **判据②已按 CTO 改落点**：断言对象 = **注入面 `props` 值**（覆盖"参数落到哪"），**不覆盖**"参数改变下游计算"⇒ 本件**不得**被读成"下游输出已改变"。
2. **无生产调用方**：新 export 只被本卡测试调用（+ 未来第三卡）⇒ 本件是 **L2-真跑（函数级）**，不是"生产链路已通"。
3. **`direction-monitor.ts` 零改动**（blob 同一，§A.6 未交①）。
4. **未跑全量 vitest / 未跑基线 tsc 对照**（重型验证按全队串行纪律；本卡只跑单文件 vitest）。
5. **未合并**：本卡 commit 在本地；推 PR 由队长按 CTO 顺序执行；**通过与否**归 CTO 收件闸 + K3 终审（本件不作"通过"判定）。

## §A.8 遗留 / 未决（直说）

1. 🔴 **U-1 / U-2**：脚本级 schema 门禁未落地，且与既有 `check-ontology-fields.sh` **语义互斥** ⇒ 须一并改、走 提案→K3→CTO（§A.6-b 即提案输入）。
2. 🔴 **U-3 / U-7**：52（现 53）条占位串 + 55 条 `causal_strength` 声明串的**真值标定**属另卡；本卡只让"声明"可读。
3. ⚠️ **U-4**：3 条散文公式（`brand_builds` / `couples` / `cumulative_learning`）是否包成 `{ref:<公式原文>}` 属语义发明 ⇒ 待治理线裁定。
4. ⚠️ **U-5**：G-3 引证件不存在（§B §3.4 更正留痕：近邻件 91 行、命中 1 处）⇒ 请 CTO 复核该引证的权威文本出处。
5. ⚠️ **U-6**：`action_effect_lag` 值域收口属 **#1134**（同批：本席已实测 56 件 / `unknown` 50 / 第 3 类值 1 条并在该卡挂账）。
6. ⚠️ **新增第 56 件的连带影响**：`goal_decomposition.json` 的 `transfer_function` = `"N/A — …"` ⇒ 命中占位族（属"占位串"而非"散文公式"）；其 `causal_strength` **缺键**（唯一 `absent`）。**是否应补该键（对齐 #1430 的 55/55 声明形态）属另卡**，本卡只如实点名。

## §A.9 门禁 / D708 / token（原始输出）

> 提交 SHA 与「提交后复跑」读数由**提交后追加的 `§A.9-b`** 承载（M6 复跑件）。

### A.9.1 pre-commit 13 组（**同一 staged 集**，两种载体配置）
```
$ bash scripts/pre-commit-check.sh                     → DEFAULT_EXIT=1
  ❌ 声明闸① brief schema（Q1–Q3/架构层/Done/骨架/Q0c；D1220 退时间戳+Q0）: 1 处 [硬阻断]
      今日无 task brief。请先运行: bash scripts/workflow/task-start.sh "任务描述"
  ❌ 声明闸② brief↔代码一致性（Q2 写集/排除项/可解析；D1148 合并 15→3）: 1 处 [硬阻断]
      tests/l4/ontology-loader-param-bridge-1031.test.ts (不在 Q2 范围内)
  ❌ 2 组未通过 — 提交已拒绝
$ SYNO_CLAIM_V2=1 bash scripts/pre-commit-check.sh     → CLAIMV2_EXIT=0
  ℹ️  组 12 claim 载体: 16 条 claim（并集）；覆盖 2/2 个暂存文件
  ✅ 组 12 claim 载体: 全部暂存文件均被 claim 覆盖（legacy 判定无对象）
  ✅ 全部 13 组通过
```
（根因同批 K4-03/K4-01：`scripts/pre-commit-check.sh:1040-1043` 对**未设**值落默认关，而决策 Note
`memory/notes/implemented/2026-10-08-1423-claim-default-on.md` 写「默认开」；`ci.yml:196-199` 未注入
`SYNO_CLAIM_V2` ⇒ PR CI 会同样红。**本卡不改门禁**。）

### A.9.2 D708 合并级写集对账
```
$ python3 scripts/control-tower/merge_writeset_gate.py --base origin/local-main --head HEAD \
      --branch fix/1031-ontology-param-bridge --repo-root .
✅ 结论: pass — 提交文件集 ⊆ 声明写集（无夹带）
   身份来源: claim → #1031（.claude\claims\1031.yaml）｜变更集 6 个文件（merge-base dc5ce093）
   声明写集 6 条（多源并集，全部 S0:claim.writeset）｜豁免 1 条 [claim-self]：.claude/claims/1031.yaml
D708_EXIT=0
```

### A.9.3 token 0 处复核（四口径；不回显 token 值）
```
$ set /p TOK=<D:\win-push.token                                  （仅内存变量）
$ git -c … grep -l "<TOK>" HEAD                                  → 无输出 / GIT_GREP_EXIT=1
$ findstr /s /m /c:"<TOK>" <loader|test|delivery|contract|claim> → 无输出 / FINDSTR_EXIT=1
$ git -c … diff --cached | findstr /c:"<TOK>"                     → 无输出 / STAGED_DIFF_EXIT=1
$ git -c … log -3 --format=%B | findstr /c:"<TOK>"                → 无输出 / MSGS_EXIT=1
```

### A.9.4 环境事实（同批已上报）
本克隆**未安装 git hooks**（`.git/hooks` 仅 `*.sample`；`core.hooksPath` 未设）⇒ 提交不触发 hook 链；
门禁证据 = **手动跑同源脚本**（§A.9.1/A.9.2 的原始输出）。

## §A.10 收尾三件索引（实施席口径）+ 自验归属声明

| 收尾件（RUNBOOK §4 / M6） | 本件落点 |
|---|---|
| **diff** | §A.0 D6（分支 diff stat）+ §A.9（提交时点 diff 与 PR 变更集） |
| **复跑读数**（实施席） | §A.4（恢复绿）+ §A.9（提交后复跑） |
| **遗留清单** | §A.8（6 条）+ §A.6（未交 4 笔） |

**自验归属（M3）**：本件**不含「自验结论」三态判定**（也不含「审计通过」字样）——**自验不得由编码兼任**。
§A 全部读数的性质 = 「**实施席复跑证据**」；**自验结论**由独立成员（`verifier-k4`，独立克隆）出具；**通过与否**归 CTO 收件闸 + K3 终审。

---

# §B 批 1 历史记录（原 §0–§4；计数类断言以 §A 为准）

- 卡：ISSUE #1031（W2 前置 · 参数从类型层到实例层的桥）
- 执行人：`@k4-coder-f`（编码员）｜队长：lead｜裁定：**CTO 乙案**
- 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1031`｜分支 `fix/1031-ontology-param-bridge`
- 基线：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`（worktree 与该点同步，无 behind/ahead）
- **分支 HEAD（最终）：`dfe12ce7c3b766352530e3965eed7703fcbf1b6d`**
- commit 链：`dca0b7b2f` feat（实现）→ `26e2b22b4` docs（本收尾件）→ `dfe12ce7c` chore（claim，治理产物）
- 契约件（前置）：`docs/synova/product-lines/evidence/1031-injection-contract.md`

### 0-⓪ 分支级最终 diff（**以本节为准**；§1 的两段 stat 是 **commit-1 时点**，已被本节取代）

> ⚠️ **自指边界（显式声明）**：本文件无法一字不差地写出"包含本文件自身修改的那次提交之后"的 stat——
> 每次补写本文件都会再改一次 stat（自指悖论）。因此：
> - 下图是 **commit-3（claim 提交）时点**的快照；
> - **分支最终 HEAD 与最终 stat 以现场复跑为准**：`git diff --stat 5a6591c4a..HEAD`（命令原样给出，可复现）；
> - **卡上回执 `.k4-publish/WIN-1031-delivery.md` 给出最终值**（它是仓库外文件，不受自指约束）。
> 复现口径始终是 **base = `5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`**。

```
$ git diff --stat 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4..HEAD     # commit-3 时点
 .claude/claims/1031.yaml                           |  14 +
 .../2026-10-09-1031-ontology-param-bridge.md       |  59 +++
 .../synova/product-lines/evidence/1031-delivery.md | 218 +++++++++++
 .../evidence/1031-injection-contract.md            | 208 ++++++++++
 src/l4/ontology-loader.ts                          | 259 +++++++++++++
 tests/l4/ontology-loader-param-bridge-1031.test.ts | 417 +++++++++++++++++++++
 6 files changed, 1175 insertions(+)

$ git diff --numstat 5a6591c4a..HEAD
14	0	.claude/claims/1031.yaml
59	0	.claude/task-briefs/2026-10-09-1031-ontology-param-bridge.md
218	0	docs/synova/product-lines/evidence/1031-delivery.md
208	0	docs/synova/product-lines/evidence/1031-injection-contract.md
259	0	src/l4/ontology-loader.ts
417	0	tests/l4/ontology-loader-param-bridge-1031.test.ts
```

- **PR 预算复核**：文件总数 **6**（仅本文件的增删会使其上下浮动）；其中**治理产物 2 件**
  （`.claude/claims/1031.yaml`、`.claude/task-briefs/2026-10-09-1031-ontology-param-bridge.md`）
  **不计入** ⇒ **计入门禁 4 件** ≤ 12 ✅；单域 ✅（治理产物豁免依据：lead 全队授权 + D1174 先例）。
- **全文件删除行 = 0**（含 `src/`）⇒ 纯增量。
- **pre-commit 13 组**：✅ 全部通过（组 12 Task Scope 一致性在补 brief 后由 ❌ 转 ✅）。

---

## 0. 🔴 两条必须显式声明的边界

### 0-① 乙案改判据②的**覆盖力降档**（不许当成原判据②已满足）

| | 原判据② | 乙案改后 |
|---|---|---|
| 断言对象 | **DirectionMonitor 输出必须不同** | **注入面 `props.transfer_function` / `props.causal_strength` 值必须不同且正确** |
| 覆盖的是什么 | 「参数改变 → **下游计算结果**改变」 | 「参数改变 → **参数落点**改变」 |
| 覆盖的是什么 | ❌ **不覆盖** | ✅ 覆盖 |

**降档事实**：下游输出的改变**不在本卡覆盖范围内**。本卡**不宣称**「参数能改变下游输出」。
降档根因（实测）：`src/loops/direction-monitor.ts` 在 main **仅 291 行**，卡面所述 `:546` 物理不存在；
读取路径所属分支 `origin/feat/D1143-param-consumer-w2`（PR #1029）**未合入 main** ⇒ 原判据②在 main 上不可执行。
补足路径 = 第三卡（DirectionMonitor 接入 loop 调度），卡面自述「真正的用户可见效果需第三卡」。

### 0-② **未合并 + 封禁期不可回填**

- 分支**仅存在于本地**，**未 push、未开 PR、卡未回填**。
- 待 **GitHub 通路恢复 + CTO/K3 放行** 后方可 push/PR/合并。
- 🔴 **K3 复审通过前不得合并**（本件不是审计结论）。
- 封禁回执（编码员实测，第三次独立实证）：

```
### 命令: git ls-remote --heads origin | grep fix/1031-ontology-param-bridge
### as_of: 2026-10-08T19:46:14Z
--- 原始输出（全部，不截断）---
ERROR: Your account is suspended. Please visit https://support.github.com for more information.
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.
--- git ls-remote exit=128 ---
--- 过滤本卡分支 ---
--- grep exit=1 （1 = 远端无此分支）---
```
（回执全文：`.k4-publish/v4/ls-remote-receipt.txt`；前两次独立实证 = 队长侧的 API 403 + SSH exit 128。）

---

## 1. M6-① diff（`git diff --stat` 原始输出，禁手写）

> ⏱ 本节的 stat 是 **commit-1（实现提交）时点快照**，保留以示"提交时的真实写集"；
> **分支最终数字见 §0-⓪**（6 件 / +1175）。

```
$ git diff --stat 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4..HEAD
 .../2026-10-09-1031-ontology-param-bridge.md       |  59 +++
 .../evidence/1031-injection-contract.md            | 208 ++++++++++
 src/l4/ontology-loader.ts                          | 259 +++++++++++++
 tests/l4/ontology-loader-param-bridge-1031.test.ts | 417 +++++++++++++++++++++
 4 files changed, 943 insertions(+)
```

```
$ git show --stat --oneline HEAD
dca0b7b2f feat(#1031): 本体参数桥 — 类型层参数可注入边实例 props（CTO 乙案）
 .../2026-10-09-1031-ontology-param-bridge.md       |  59 +++
 .../evidence/1031-injection-contract.md            | 208 ++++++++++
 src/l4/ontology-loader.ts                          | 259 +++++++++++++
 tests/l4/ontology-loader-param-bridge-1031.test.ts | 417 +++++++++++++++++++++
 4 files changed, 943 insertions(+)
```

**PR 预算核算**：4 文件 ≤ 12 ✅；单域（src/l4 + tests/l4 + docs/evidence + 流程件 brief）✅。
**纯增量证明**（`git diff --cached --numstat`，实现提交前）：

```
208	0	docs/synova/product-lines/evidence/1031-injection-contract.md
259	0	src/l4/ontology-loader.ts
417	0	tests/l4/ontology-loader-param-bridge-1031.test.ts
```
⇒ `src/` 改动 **删除行数 = 0**（`clearOntologyCache()` 的 `paramCache.clear()` 为纯插入，原 3 行未动）
⇒ **类型改动纯增量**，不可能在其它文件引入类型错误。

**写集合规**：产品代码改动文件 ∈ 声明写集（`src/l4/ontology-loader.ts` / `tests/l4/ontology-loader-param-bridge-1031.test.ts` / `docs/synova/product-lines/evidence/1031-*.md`）✅。
流程/治理产物 2 件（`.claude/task-briefs/2026-10-09-1031-ontology-param-bridge.md` + `.claude/claims/1031.yaml`）：
**组件 12 物理强制要求**（无 brief ⇒ 提交被硬阻断；实测：首轮 commit 被组 12 拦下，补 brief 后转绿），
且经 **lead 全队授权**（治理产物不计入 PR 预算，D1174 先例）⇒ **不算越界**。

---

## 2. M6-② 自测结论（**非自验** —— 见下方显式声明）

> 🔴 **声明：以下为编码员自测结论，不是自验结论。**
> 按小队纪律「自验不得由编码兼任」，本卡的**独立自验必须由另一名成员执行**。
>
> **本件初版落笔时**：lead 尚未为本卡建独立自验任务行 ⇒ 独立自验 = 未做，本卡不得标 `可提请独立审计`。
>
> ✅ **【后续更新 2026-10-09】**：独立自验**已执行完毕**，结论 = **通过（可提请独立审计）**。
> 自验员**未沿用**本件任何结论，独立复跑并**补跑了我未跑的基线 tsc 对照**（见 §2.2 更新行），
> 且**抓出本件两处证据级错误 E-1/E-2**（见 §3.4）—— 这正是"自验不得由编码兼任"起作用之处。
> **最终判据状态以自验员结论与 K3 终审为准；本件不自行宣布通过。**

判据逐条 ↔ 原始输出（全部为**真跑**，非 grep 静态判据）：

| 判据 | 结果 | 原始输出 |
|---|---|---|
| **V1** 注入存在且可判（断言值） | ✅ 绿 | `23 passed (23)`；断言为 `expect(r.props.transfer_function).toBe(TF_NUMBER)`（值相等，非"存在"）。三形态（`number`/`{param:number}`/`{ref:string}`）逐个断言值 + **同引用**（`toBe`，证同形透传不包装） |
| **V2**（乙案改落点）注入前 vs 注入后值不同且正确 | ✅ 绿 | 两条对照：① 无键→有值；② **陈旧值 `0.01` → 真值 `{param:0.55}`**（数值确实改变）。差值只来自参数：`after.weight === before.weight`、`after.edgeType` 不变、新增键恰 2 个、`JSON.stringify` 逐字节相等（无时钟/顺序）、入参未被修改 |
| **V3** 降级可见且有 log | ✅ 绿 | 六态穷举（absent/placeholder/declaration_only/prose_formula/malformed/resolved）。log 断言 = `vi.mock('@synova/logger')` **运行时捕获**：每次降级 `warnCount() - n === 1` |
| **V4** 改坏即红 / 复原即绿 | ✅ 绿 | 见 §2.1 三态原始输出 |
| **V5** L1≠L2 | ✅ 绿 | 测试 `import` 后**真执行**；含 **真实 55 件 JSON 过桥**的 L2-真跑（分类计数逐件实测） |

### 2.1 V4 判别性夹具（改坏即红）—— 原始输出

```
════════ V4-0 基线（未改坏）════════
 Test Files  1 passed (1)
      Tests  23 passed (23)
      （vitest exit=0）

════════ V4-A 拆掉注入 ════════
 Test Files  1 failed (1)
      Tests  10 failed | 13 passed (23)
      （vitest exit=1）

════════ V4-B 拆掉 log.warn ════════
 Test Files  1 failed (1)
      Tests  5 failed | 18 passed (23)
      （vitest exit=1）

════════ V4-C 复原 ════════
 Test Files  1 passed (1)
      Tests  23 passed (23)
      （vitest exit=0）
```

**判别性成立的关键——红的是"对的那几条"，不是一片红**：

- **V4-A（拆注入）** 红的恰好是断言注入值的 10 条：V1 ×4、V2 ×4、V5（注入面）×2；
  **V3 的降级/log 断言全绿**（因为 V3 断言的是"不注入 + 有 log"，拆注入反而满足"不注入"）。
- **V4-B（拆 log）** 红的恰好是 5 条 V3 断言（期望 `warn` 1 次，实得 **0** 次）；V1/V2 全绿。
  ```
  - 1
  + 0
   ❯ tests/l4/ontology-loader-param-bridge-1031.test.ts:292:29
      292|     expect(warnCount() - n).toBe(1);
  ```
⇒ 两条夹具的**红色集合互不重叠且各自指向被拆掉的那一处**，排除了"改哪都红"的假判别。
（原始输出全文：`.k4-publish/v4/V4-*.txt`。⚠️ `.k4-publish/` 由 `.git/info/exclude:18` 排除，**不进仓库** ⇒
完整日志为**本地件**；本件已内联关键原始输出。独立自验可在同一工作树复跑 §2.1 四条命令原样复现。
BREAK 标记复原后 `grep -c 'V4-BREAK' src/l4/ontology-loader.ts` ⇒ `0`。）

### 2.2 诚实读数：`tsc --noEmit` 不是全绿

```
$ npx tsc --noEmit     # 全项目
… 34 行 error TS …
$ grep -c 'error TS' .k4-publish/v4/tsc-full.txt
34
$ grep -cE 'ontology-loader|1031' .k4-publish/v4/tsc-full.txt
0
```
- 34 条**全部为存量**（文件集：`extensions/sentinels/_extinct/**`、`src/connectors/ima.ts`、`src/mcp/*`、`src/server.ts`），
  **改动文件 0 命中**。
- 判「存量」的依据（两条，非"看起来像"）：① §1 已证 `src/` 改动**删除行数 = 0**（纯增量，additive 类型改动不可能在下游造错）；
  ② 唯一同时出现在错误集与 ontology-loader 下游引用集里的文件是 `src/mcp/tool-definitions.ts`，其错误为
  `TS2307 Cannot find module '@modelcontextprotocol/sdk/types.js'`（**依赖缺失，与本次改动无关**）。
- ✅ **【更新 2026-10-09·独立自验员补跑】**：自验员**补跑了基线对照** ⇒ **34 条经实测确认为存量**，
  改动文件 **0 命中**，**无新错误种类**。⇒ 我原口径（只声称弱结论 + 明确声明未跑对照）**被自验证实**；
  自验员**未据为己见强加于编码员**，而是独立复现后确认 —— 本条按自验结论更新，**归属自验员**。
- ⚠️ 另注：`tsconfig.json:29-30` `include=["src/**"]` + `exclude=["tests"]` ⇒ **测试文件根本不进 tsc 程序**（存量项目特性，非本卡引入）。

### 2.3 真实 55 件 L2-真跑读数（桥跑在真实 JSON 上）

```
files: 55
transfer_function  顶层 55/55 : 占位串 ×52 / 散文公式 ×3 / 合法值 ×0
causal_strength    optionalProps 55/55 : 描述串 ×55（完全相同）/ 数值 ×0
action_effect_lag  顶层 55/55 : "unknown" ×50 + 3-6_months ×2 + immediate ×1 + 1_month ×1 + 1-3_months ×1
```
⇒ 真实数据上**唯一可注入的键 = `action_effect_lag`**（55/55）。
`transfer_function` 全为占位/散文、`causal_strength` 全为声明串 ⇒ **55 件全部走降级路径**（有 log，不静默）。
测试内以同一计数硬断言（`expect(tally).toEqual({...})`）⇒ 数据一旦变化即红。

---

## 3. M6-③ 遗留清单

### 3.1 未决项（本卡不做，转治理线；出处见契约件 §5）

| # | 未决项 | 归属 |
|---|---|---|
| **U-1** | **schema 门禁落地**（P-3 值域断言 + 存量占位串计数 + 新增占位串阻断） | 卡面自述「若动 `scripts/**` 的 schema 门禁 ⇒ 拆给治理线」；本卡不动 `scripts/**` |
| **U-2** | 🔴 **与既有已落库门禁语义互斥**（本卡新发现） | `scripts/control-tower/check-ontology-fields.sh:80` **硬要求 `transfer_function` 为非空字符串**（`:33` 冻结字段集 `action_effect_lag transfer_function`）。⇒ 一旦按 P-3 标定成 `number`，**既有门禁立刻 exit 1**；且该脚本 `:16` 自述「新增必查字段 = 判据变更 ⇒ 提案 → K3 → CTO」。**必须与 schema 门禁一并改，不是"搬走一条断言"** |
| **U-3** | **真值标定**（52 条占位串 → 数字/`{param}`/`{ref}`） | 卡面明示属①，另卡 |
| **U-4** | **散文公式 3 条**（`brand_builds`/`couples`/`cumulative_learning`）的规范化 | 是否包成 `{ref:<公式原文>}` 属**语义发明**，本卡不擅作主张 |
| **U-5** | **G-3 引证不可核** | 派单件引证 `docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md:93` **文件不存在**。近邻件 `CTO-固化-最终方向与在制任务-20260924.md` **实测 91 行 / 67 非空行**（`wc -l` = 91）⇒ `:93` 物理不可能存在；该近邻件**命中 1 处**（`:5` 把不存在的件列为「**配套件（必读）**」），正文对 `transfer_function`/`G-3`/`占位` 三模式 0 命中。⇒ 本卡 schema **不冒用 G-3 出处**，自署名「本卡提出 + 待治理线/K3 确认」。**更正留痕见 §3.4** |
| **U-6** | `action_effect_lag` 值域收口（`unknown` 是否越权威枚举） | 属 **#1134**；本卡只做非空字符串原样透传 |
| **U-7** | **`causal_strength` 真值** | 55/55 仅描述串 ⇒ 本卡只能让「**声明**」可读（`status=declaration_only` + `declaredAs`），**值**须待 U-3。**本卡不伪造值** |

### 3.2 上游/依赖

- **上游**：D1143（PR #1029，读取路径）**未合入 main** ⇒ 本卡不依赖它（乙案已改落点）。
- **串行约束**：#1455 若改 `src/l4/ontology-loader.ts` 须先协调本卡（卡面声明「本卡先接桥」）；
  实测 `.synova-wt-1455` 写集为 `src/store/**` + `tests/store/**`，**当前无重叠**。
- **第三卡**：DirectionMonitor 接入 loop 调度（下游可见效果）。

### 3.3 残留风险（留给独立自验复核）

1. 本卡**无生产调用方**（卡面明示的预期状态）⇒ 独立自验**不得**以"生产链路跑通"为标准，须以「真跑函数 + 判别性夹具」为标准。
2. **未跑全量 vitest / 未跑基线 tsc 对照** —— 属重型验证，按纪律留自验员串行执行。
3. 记忆化（`paramCache`）与 `loadOntology` 的 `cache` 同生命周期；若未来有热重载改 JSON，须调 `clearOntologyCache()`（测试已覆盖该生命周期）。
4. 本卡改动**纯增量**，但 `EdgeTypeDef` 新增 2 个可选字段属**接口面扩张**，独立自验应确认无既有消费者受影响（本件已附 `loadOntology`/`getTypesByTags`/`validateEdgeEndpoints` 回归断言全绿）。

### 3.4 📌 更正留痕（独立自验发现的**证据级**错误 —— 保留不删）

> **纪律：结论对 ≠ 证据可错。** 本卡结论正确，但支持它的两条事实写错了 ⇒ 由**独立自验员**实测更正，
> 本件**保留原始错写 + 更正过程**，供 K3 判定"引证笔误"而非"该权威根本不存在"。

| # | 我初版写的 | 独立自验实测 | 错因（根因，非"手滑"） |
|---|---|---|---|
| **E-1** | 近邻件「全文 **67** 行」 | **91** 行（`wc -l` = 91；**67 是非空行数** `grep -cve '^[[:space:]]*$'`） | 我用 PowerShell `Measure-Object -Line` 并把它当「总行数」读。**该 cmdlet 只计非空行**——同一文件实测 `Measure-Object -Line` = **67**、`wc -l` = **91**（差 24 个空行） |
| **E-2** | 近邻件「**零**命中」 | **命中 1 处**：`:5` 把那份不存在的件列为「**配套件（必读）**」 | 「零命中」是我**三模式 grep**（`transfer_function\|G-3\|占位`）的 0 结果 —— 复跑该口径确实 0；但我把**限定语抹掉**写成无限定的「零命中」，语义被放大成"文件里什么都没提它" |

**结论不变**：`docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md` 在 `origin/main` **确实不存在**
（`git ls-tree -r --name-only origin/main -- docs/synova/coordination/ | grep 固化` ⇒ 仅 `CTO-固化-最终方向与在制任务-20260924.md` 一件），
⇒ `:93` 物理不可能存在 ⇒ **G-3 引证不可核**成立。

**连带更正（同一自验批次，属仓库级发现，本卡不处置）**：该不存在件在 `origin/main` 被 **8** 个文件引用
（`git grep -l 'CTO-固化-II-研究院权威结论-20260924' origin/main | wc -l` ⇒ 8）：
`.claude/task-briefs/2026-09-24-D942-cto-fixation.md`、`.claude/task-briefs/2026-09-24-D943-mechanism.md`、
`.claude/task-briefs/2026-09-24-D955-d943-docs-anchor.md`、`docs/synova/coordination/CTO-固化-最终方向与在制任务-20260924.md`、
`docs/synova/presets/synova-k3-audit/persona-block.yml`、`docs/synova/product-lines/evidence/1452-batch-d/A-01-objects.json`、
`memory/notes/implemented/2026-09-25-research-institute-baseline.md`、`task-state/D955.json`。
⚠️ 与 lead 转述的「**9** 个文件」有差：实测 **8**；且 **`task-state/D943.json` 不在引用集内**
（该文件存在，但 `git grep -c <件名> origin/main -- task-state/D943.json` ⇒ 0），
而 lead 未列的 `1452-batch-d/A-01-objects.json` **在**引用集内。**已回报 lead 供 CTO 报告取准。**

### 3.5 判别性夹具方法学（自验员踩坑后下发全队，本卡遵从情况）

> 全队新纪律：**「破坏后先跑 `tsc` 确认无 `TS1xxx`，再跑夹具」** —— 否则可能把"文件没解析"当成"判别性成立"。

**本卡 V4 两处夹具实测不受此坑影响**（证据而非自述）：
- 两处破坏均为**语法合法**形态（`if (c) { } else { … }` 空块 / `if (c) { /*注释*/ }`），非「`if (...) <注释>` 紧接 `else`」的非法形态；
- 决定性证据：破坏后 vitest **确实跑了测试并报断言失败**（V4-A 报 `AssertionError: expected undefined to be 'unknown'`；
  V4-B 报 `expected 0 to be 1` 的 `- 1 / + 0` 断言 diff），**不是** `no tests` 类空跑；
- 且两次破坏的**红色条数**分别为 10 / 5，与"注入/日志各自的作用面"精确对应 ⇒ 非"整片红"。
- 遗留诚实点：破坏期间我**未**跑 `tsc`；上述结论由**断言级证据**支撑，不依赖 tsc。后续夹具按新纪律补跑 tsc。

---

## 4. 自检 5 问（写完必答）

1. **接线检查**：新 export（`readEdgeTypeParams` / `getEdgeTypeParams` / `applyEdgeTypeParams` + 类型）在 main **无生产调用方** —— **卡面明示的预期状态**（卡面原话：「本卡【不要求】本卡内出现生产可见效果」）。调用方 = 本卡测试 + 第三卡。
2. **异常处理**：未新增 `catch`；降级走 `degraded` + `issues[]` + `log.warn`（**不静默**，V4-B 已证明拆掉 log 即红）。
3. **类型安全**：`as any` / `as never` / `as unknown as` = **0**；运行时守 `isValidParamValue`（`unknown` → 判别后收窄），未用 `any` 谎报类型。
4. **测试质量**：23 条全带 `expect()`；覆盖 正常（resolved 三形态）/ 降级（六态）+ 边界（空串/null/数组/歧义对象/NaN/未知 label）；含真实 55 件 L2-真跑。
5. **残留清理**：无死代码；`grep -c 'V4-BREAK'` = 0（临时夹具已复原）；未删既有代码（删除行 = 0）。

---

**签署：执行人@k4-coder-f｜编码员自测完成｜独立自验已执行（结论=通过/可提请独立审计，归自验员）｜🔴 未合并（待 GitHub 通路恢复 + CTO/K3 放行；K3 复审通过前不得合并）**

> 📌 **本件修订记录（非 amend，历史可核）**
> - `dca0b7b2f` feat 实现 → `26e2b22b4` docs 收尾三件 → `dfe12ce7c` chore claim → `69200d62e` docs 数字对齐 → `e5da80f58` docs 自指边界
> - **`e5da80f58` 之后追加 doc-only 更正提交（本行所在）**：依独立自验 L1 发现更正 **E-1/E-2**（§3.4），
>   并把"独立自验未做"更新为"已执行/通过"（§2、§2.2、§3 签名）。
>   **一律新增提交、不 amend** —— `e5da80f58` 保持可核。
