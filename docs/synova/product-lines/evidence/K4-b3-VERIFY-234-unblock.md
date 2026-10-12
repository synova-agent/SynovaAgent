# K4-b3-VERIFY-234-unblock — 独立复核：队长实施的 N2 补完笔（`25b3cb10d`）

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`25b3cb10da83ded60232582b6c5fa2a9b49221f7`（`git ls-remote` 实测）＝ **`2758ef982`（A 件 -1134）＋ `25b3cb10d`（B 件 -1031 + C 件 completeness）**
> **实施者 = 队长** ⇒ **本复核由我独立做**（实施/复核分离）｜**方法**：临时 detached worktree（`%TEMP%\k4b3-verify\wt-n5`）＋ junction 到 `D:\synova-wt\node_modules`（gitignored、不进写集）
> **队内用语**：只给「自验结论」，通过与否归 CTO + K3。

---

## 〇、结论先行（**退回**：1 处必改）

**🔴 a-1（必改，一行）**：`tests/l4/ontology-loader-param-bridge-1031.test.ts:427`
```ts
expect(BASELINE_TALLY.cs_other).toBe(1);     // 该常量本笔已改为 1 + PRESENT_PENDING_EDGES.length
```
⇒ **58 件态（= `l3-65` 合入 2 边后的真实态）实测 `cs_other = 3`** ⇒ **该断言必红**，本件 `Test Files 1 failed | 2 passed`、`exit 1`。
⇒ **所以「合并顺序无关」在本笔上不成立** ⇒ **`25b3cb10d` 不宜作为 #472 的合并对象**（详见 §五）。

## 一、复现你的 A 态（不质疑，先站住基线）
```
$ npx vitest run <三件>          （口径：vitest 5.0.2 三文件 run；时点 2026-10-12；版本 25b3cb10d）
 Test Files  3 passed (3) ｜ Tests  88 passed (88) ｜ exit 0
⇒ 与你的回执**逐值一致** ✅（A 态：56 件）
```

## 二、四态（**全部我自己造 + 每态核 R22「替换确实发生」**）
| 态 | 构造 / R22 证明 | 实测 | 你的期望 | 判 |
|---|---|---|---|---|
| **A 阴性（56）** | 本笔自身树 | `3 passed / 88 passed`｜**exit 0** | 绿 | ✅ **一致** |
| **B 合并后（58）** | 放入 `a7437498c` **2 件真件**；`hash-object == rev-parse a7437498c:<path>` **True**（两件）；件数 56→**58** | `1 failed | 2 passed`｜**exit 1**：`× 🔴 第 56 件 goal_decomposition 逐字段点名（tally Δ 的可归因来源）` `AssertionError: expected 3 to be 1` | **绿** | 🔴 **不一致 = a-1** |
| **C 未登记新增（59）** | 复制第 3 件 `zz_verifier_unregistered_probe.json`；存在=True；58→**59** | **exit 1**，含 `× N2-2 ② 未登记新增 ⇒ 红 + 点名片名` ⇒ 消息原文：`未登记新增件（请显式登记后重跑）: zz_verifier_unregistered_probe.json: expected [Array(1)] to deeply equal []` | 红+点名 | ✅ **一致（真点名到文件）** |
| **D 删除 SPEC 件（57）** | 删 `brand_building.json`；存在=False；58→**57** | **exit 1**，含 `× N2-1 ① SPEC 成员不许缺` ⇒ 消息原文：`规范基线件缺失（删除/改名必须显式改 SPEC_EDGE_TYPES）: brand_building.json: expected ['brand_building.json'] to deeply equal []` | 红+点名 | ✅ **一致（真点名到文件）** |
| 复原 | `git checkout -- <件>` | 回绿 | — | ✅ |

## 三、你点名要我判的两条

### 5.1 `BASELINE_TALLY` 是否被弱化（"逐件断言降级成聚合数"）—— **我判：不构成弱化** ✅（但有一处残留）
**理由（只认实测与 diff）**：
1. `BASELINE_TALLY` **在本笔之前就是聚合 `Record<string,number>`**（diff 只改了它的**取值表达**：字面 → `基值 + 在场预告件 Δ`）⇒ **粒度未变**；
2. `expect(tally).toEqual(BASELINE_TALLY)` 仍是**全类相等**（非 `>=`、非子集）⇒ 任何一类漂移皆红；
3. 🔴 **逐件 loop 未被删/未改**（本笔 diff 只动常量块与 C 件；`for (const e of ontology.edgeTypes)` 段 `git diff` 无命中）⇒ 逐件分类仍由实跑守住；
4. Δ 由 `PENDING_REGISTERED_ADDITIONS[].expected` 驱动，而**实测侧由 `tally` 独立算出** ⇒ 声明与实测对照（**B 态 L406 `toEqual(BASELINE_TALLY)` 通过**即证明：实测 `tf_prose=57 / cs_other=3 / lag_resolved=58` 与派生期望**逐类相等**）✅
**⇒ 不是弱化，`a` 不记。**
**但记一处「残留」（建议，不阻塞）**：`BASELINE_TALLY` 的**基值仍是字面**（`tf_prose: 55 + Δ`、`cs_other: 1 + Δ`、`lag_resolved: 56 + Δ`）。当 **SPEC 段**分类发生变化时（例：#234 的 U8 若被 CTO 追认 ⇒ E-17/E-38 从 `unknown` 落成区间 ⇒ 基值 55/56 即失效）**仍需手改此处** = **第二套真源**的残余。⇒ 建议把基值也由**同一份逐件计算**派生（`-1134` 已用 `DERIVED_DEGRADED = SPEC.length - DERIVED_IN_DOMAIN - NON_CAUSAL_REGISTRY.length + Δ` 这一手法，B 件可照抄同一式）。

### 5.2 `BASELINE_EDGE_TYPES = 扫盘件数` 是否变成恒真 —— **我判：不是恒真；且"件数漂移 ⇒ 必红 + 点名"仍活着** ✅
**实测（我最关心的就是这条）**：
- B 件的尺寸断言是 `expect(ontology.edgeTypes).toHaveLength(ACTUAL_EDGE_FILES.length)` ⇒ **两侧不同源**（loader 实跑 vs `readdirSync` 扫盘）⇒ **不是恒真**（loader 漏读/多读即红）；但它**抓不到"与登记清单漂移"**——**这是设计如此**（你说得对）。
- **漂移的真抓取点 = `-1134` 的 N2 集合棘轮**，我用 C/D **实测其有效且点名**：
  - C（+1 未登记）⇒ `N2-2` 红，消息含 **`zz_verifier_unregistered_probe.json`** ✅
  - D（-1 SPEC 件）⇒ `N2-1` 红，消息含 **`brand_building.json`** ✅
- ⇒ **"增/删件 ⇒ 必红且点名" 成立**（抓取点在集合层，不在尺寸层）—— **与你的判一致** ✅
- 注：`-1134:900-904` 的 `expect(BASELINE_*).toBe(DERIVED_*)` 属**派生 vs 派生**（自洽声明，无独立分辨力）；其**真分辨力**在同文件的 `-521/837`（实测 `edges.length` vs `BASELINE_TOTAL`）与 N2-1/2/3 ⇒ 该注释里已自陈"棘轮在 N2-1/2/3"，**口径诚实** ✅

### 6 `cs_other` 语义（1→3）—— **我以实跑核，不是读你的推** ✅
B 态 `expect(tally).toEqual(BASELINE_TALLY)` **通过**，而该常量此时 `cs_other = 1 + 2(在场预告件) = 3` ⇒ **实测 `cs_other = 3`**（两件预告件均缺 `causal_strength` 键 ⇒ `absent`）✅ 与你的 loader 契约推理一致。

### 7 两条边界（你自陈的）—— 我判定
- **B 件无注入缝**（用 `process.cwd()` 定位，而 `-1134` 有 `SYNO_EDGE_TYPES_DIR`）：**我判"建议补，但不阻塞"** —— 四态我已用临时树复现（证明可造），但**同批两件手法不一致**会在下一位复核员那里再踩一次（"改真仓才测得动"）。⇒ 建议 B/C 件同样支持 `SYNO_EDGE_TYPES_DIR`（一处 `?? …` 即可）。
- **C 件"读件内真实 `$id`、不从文件名推"**：✅ **与我的独立实测一致** —— 我在第一阶段就测过：56 件里有 **5 件的 `$id` 尾段与文件名主干不同**（`decision-concentrates` / `external-assumption` / `incentive-binds` / `locks-in` / `signal-transmits`）⇒ **从文件名推必错 5 件**，你的第一版红是对的，改后正确 ✅（这条是**你采纳了我前轮的读数**，此处仅作一致性确认。）

## 四、a / b / c / d

**a 与实测不一致处（1 条，必改）**
- **a-1**：`-1031:427` `expect(BASELINE_TALLY.cs_other).toBe(1)` ⇒ **58 件态必红**（我实测 `exit 1` / `expected 3 to be 1`）⇒ **"合并顺序无关"不成立**。
  **同族风险扫描**：我对三件做了一遍"**对派生常量再施字面断言**"的全量扫描（正则 `expect\((BASELINE_|DERIVED_)[^)]*\)\.(toBe|toEqual)\([0-9]`）⇒ **全仓命中 = 恰好这 1 处**（无第二例）⇒ **修一行即可，不是族问题**。
  **修法建议（二选一）**：① `expect(BASELINE_TALLY.cs_other - PRESENT_PENDING_EDGES.length).toBe(1)`（断言"SPEC 段恰 1 件 absent"）；② 更佳：按**实测逐件**断言并**点名**那个 absent 件（与 `-1134` 的 N2-1/N2-2 同法，含消息参数）。

**b 无法核实处**
- b-1：**合并后的完整态**（234 + l3-65 + 238-239 同树）我**未跑全量**（三卡 merge 态不存在）⇒ 我的 B 态是**等价构造**（58 件真件）。**但 a-1 的因果是确定的**：58 件 ⇒ `PRESENT_PENDING_EDGES.length = 2` ⇒ `cs_other = 3 ≠ 1` ⇒ **必红**（不依赖其它卡）。
- b-2：`promoteAfter`（预告件到期）仍是**纸面期限**，无判据可跑（前轮已报，此处重申）。

**c 跑不通处**：无。**自陈**：为让 B/C 件可造红，我被迫改**临时工作树**（非真仓）——因 B/C 件无注入缝（见 §三.7）。**订正我自己的话**：D 态删除的件已 `git checkout` 复原；但 B 态放入的 2 件在 `25b3cb10d` 树上**本不存在** ⇒ 它们是**未跟踪文件**，`checkout` 不会清除 —— 移除临时树前 `git status` 实测仍有 **2 条**。最终由 `git worktree remove --force` 销毁，**残留核验 `Test-Path` = False、`worktree list` 无该项** ✅。（此处我先写成"临时树最终 0 变更"，**不准确，已订正** —— 对我自己的证据也用同一把尺。）

**d 能否据此独立开工/决策**：**能** —— 四态齐（A✅绿 / B🔴红=缺陷 / C✅红+点名 / D✅红+点名），且每条结论都带命令与原始输出。

## 五、结论用语（你要的那句）

**🔴 `25b3cb10d` —— `退回`（1 处必改：`-1031:427`）**，**不宜作为 #472 的合并对象**。
**精确边界（两种读法都给，避免误读）**：
- 若 #472 的合并**会带入 `l3-65` 的 +2 边**（= 58 件，也是本笔 N2 的**设计目标态**）⇒ **不可合**（`-1031` 必红）⇒ 修 a-1 后方可；
- 若 #472 **仅合 `k4b3/234` 且树上仍是 56 件** ⇒ 现态可合（A 态实测 88 passed / exit 0），**但这违背本笔的立意**（"合并顺序无关"）⇒ 不建议按此放行。
**修完后请再给 SHA**，我复跑 B/C/D 三态（预计为**单行改动**，可快速复核）。
**其余判定**：5.1 **不构成弱化**（逐件 loop 未动 + 全类 `toEqual`）｜5.2 **不是恒真且漂移抓取仍活**（C/D 点名实测）｜`cs_other=3` **实跑确认**｜C 件 `$id` 读法 **与我独立读数一致**｜B，件无注入缝**建议补但不阻塞**。
