# #1031 交付件 · 本体参数桥（M6 收尾三件：diff / 自验结论 / 遗留清单）

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
