# #1031 交付件 · 本体参数桥（M6 收尾三件：diff / 自验结论 / 遗留清单）

- 卡：ISSUE #1031（W2 前置 · 参数从类型层到实例层的桥）
- 执行人：`@k4-coder-f`（编码员）｜队长：lead｜裁定：**CTO 乙案**
- 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1031`｜分支 `fix/1031-ontology-param-bridge`
- 基线：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`（worktree 与该点同步，无 behind/ahead）
- **交付 commit：`dca0b7b2f93f107a2af4e239a10635222c439ef9`**
- 契约件（前置）：`docs/synova/product-lines/evidence/1031-injection-contract.md`

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

**写集合规**：实际改动文件 ∈ 声明写集（`src/l4/ontology-loader.ts` / `tests/l4/ontology-loader-param-bridge-1031.test.ts` / `docs/synova/product-lines/evidence/1031-*.md`）。
🔴 唯一越出的是 **流程件** `.claude/task-briefs/2026-10-09-1031-ontology-param-bridge.md` —— **pre-commit 组 12 硬阻断强制要求**（无 brief ⇒ 无法提交）。
**该越界已主动上报 lead**，非产品代码写集扩张。

---

## 2. M6-② 自测结论（**非自验** —— 见下方显式声明）

> 🔴 **声明：以下为编码员自测结论，不是自验结论。**
> 按小队纪律「自验不得由编码兼任」，本卡的**独立自验必须由另一名成员执行**。
> **截至本件落笔，lead 尚未为本卡建独立自验任务行 ⇒ 独立自验 = 未做**，本卡**不得**标 `可提请独立审计`。

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
- ⚠️ **未跑基线对照**（未在 base commit 上重跑 tsc 计数）⇒ 本件只声称"改动文件 0 错误 + 纯增量"，
  **不声称**"34 条经基线比对确认全部为存量"。该对照留给独立自验。
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
| **U-5** | **G-3 引证不可核** | 派单件引证 `docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md:93` **文件不存在**（近邻件 67 行、零命中）⇒ 本卡 schema **不冒用 G-3 出处**，自署名「本卡提出 + 待治理线/K3 确认」 |
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

---

## 4. 自检 5 问（写完必答）

1. **接线检查**：新 export（`readEdgeTypeParams` / `getEdgeTypeParams` / `applyEdgeTypeParams` + 类型）在 main **无生产调用方** —— **卡面明示的预期状态**（卡面原话：「本卡【不要求】本卡内出现生产可见效果」）。调用方 = 本卡测试 + 第三卡。
2. **异常处理**：未新增 `catch`；降级走 `degraded` + `issues[]` + `log.warn`（**不静默**，V4-B 已证明拆掉 log 即红）。
3. **类型安全**：`as any` / `as never` / `as unknown as` = **0**；运行时守 `isValidParamValue`（`unknown` → 判别后收窄），未用 `any` 谎报类型。
4. **测试质量**：23 条全带 `expect()`；覆盖 正常（resolved 三形态）/ 降级（六态）+ 边界（空串/null/数组/歧义对象/NaN/未知 label）；含真实 55 件 L2-真跑。
5. **残留清理**：无死代码；`grep -c 'V4-BREAK'` = 0（临时夹具已复原）；未删既有代码（删除行 = 0）。

---

**签署：执行人@k4-coder-f｜编码员自测完成｜🔴 独立自验未做（待派）｜未合并**
