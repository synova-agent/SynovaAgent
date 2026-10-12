# K4-b3-VERIFY-234-unblock-r2 — 独立复核：队长 a-1 修复笔 `612df29c5`

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`612df29c56e5ea7966046d5d24861573b37154a5`（`git ls-remote` 实测；`25b3cb10d..612df29c5`；**1 件**：`tests/l4/ontology-loader-param-bridge-1031.test.ts`）
> **实施者 = 队长 ⇒ 本复核由我独立做**（实施/复核分离）｜**方法**：临时 detached worktree（`%TEMP%\k4b3-verify\wt-n6`）＋ junction 到 `D:\synova-wt\node_modules`（gitignored、不进写集）
> **队内用语**：只给「自验结论」，通过与否归 CTO + K3。

---

## 〇、结论先行

**✅ `612df29c5` —— `可提请独立审计`；我判「无阻塞项，可作为合并对象」**（在 58 件态也绿 ⇒ **"合并顺序无关"这次成立**）。
附 **2 条 a-lite（建议，不阻塞）**：① 提交消息是未展开的 `$MSG`；② B/C 件仍无注入缝（与 `-1134` 手法不一致）。

## 一、四态复跑（**全部我自己造 + 每态核 R22**）

| 态 | 构造 / R22 | 实测 | 你报的 | 判 |
|---|---|---|---|---|
| **A 56 件** | 本笔自身树 | `3 passed / 88 passed`｜**exit 0** | 同 | ✅ |
| **B 58 件** | 放 `a7437498c` 2 件真件；`hash-object == rev-parse` **True**（两件） | `3 passed / 88 passed`｜**exit 0** | 同 | ✅ **修复目标态达成**（上轮此处红） |
| **C +1 未登记（59）** | 复制 `augments.json` → `zz_unregistered_verifier.json` | **exit 1**；`AssertionError: 未登记新增件（请显式登记后重跑）: zz_unregistered_verifier.json: expected [ 'zz_unregistered_verifier.json' ] to deeply equal []` | 点名 ✅ | ✅ **一致（真点名）** |
| **D 删 SPEC 件（57）** | 删 `augments.json` | **exit 1**；`AssertionError: 规范基线件缺失（删除/改名必须显式改 SPEC_EDGE_TYPES）: augments.json: expected [ 'augments.json' ] to deeply equal []` | 点名 ✅ | ✅ **一致（真点名）** |
| 复原 | — | 回绿（29 passed） | — | ✅ |

## 二、🔴 我额外加的两态（**答你 §5.1／§5.2 用实测，不用意见**）

### E（答 §5.2：从 `id` 推 label 是不是"第二套口径"）—— **不是静默风险** ✅
**造法**：把在场预告件 `goal_decomposes_to.json` 的 `label` 改成 `ZZ_WRONG_LABEL`（脚本化，已核"替换确实发生"：1447→1443 字节）。
```
exit 1 ｜ × 🔴 第 56 件 `goal_decomposition` 逐字段点名（tally Δ 的可归因来源）
AssertionError: absent 集必须恰为「goal_decomposition + 在场预告件」:
   expected [ 'GOAL_DECOMPOSITION', …(2) ] to deeply equal [ 'GOAL_DECOMPOSES_TO', …(2) ]
   +   "ZZ_WRONG_LABEL"
```
⇒ **`id → label` 的推导是被"件内真实 label"当场对账的**：一旦两者不一致 ⇒ **红且把两个数组都打出来** ⇒ **不是"同一事实两处取值"的静默形态（F1）** ⇒ **我不记 a**。
⇒ 但**仍建议改**（a-lite，见 §四）：读件内 `label` 或给 `PendingEdgeAddition` 加 `label` 字段 —— 因为**报错形态**会让下一位复核员误以为"集合算错了"，而真实原因是 id/label 命名约定不一致。

### F′（答 §5.1：新断言是否**双向**、有无放宽）—— **双向，未放宽** ✅
**造法**：给在场预告件的 **`optionalProps`** 加 `causal_strength`（**有效扰动**，见 §三 的方法学订正）。
```
exit 1 ｜ 2 failed
 × 56 件全部过桥…（棘轮）      ← 聚合计数（toEqual(BASELINE_TALLY)）
 × 🔴 第 56 件 …（tally Δ 的可归因来源）
   AssertionError: absent 集必须恰为「goal_decomposition + 在场预告件」:
     expected [ 'GOAL_DECOMPOSES_TO', …(1) ] to deeply equal [ 'GOAL_DECOMPOSES_TO', …(2) ]
```
⇒ 预告件"**少了 absent**"也被抓 ⇒ 断言**双向**（缺席红 ∧ 多出红 ∧ 少出红）⇒ **不构成放宽**；且它把旧的「**常量 vs 字面**」换成了「**实测集 vs 派生期望**」⇒ 在 58 件态**更强**。
**⇒ §5.1 我的判定：不构成"把逐件断言降级成聚合数"，也不构成放宽。**
**残留（建议，不阻塞）**：`BASELINE_TALLY` 的**基值仍是字面**（`55 + Δ` / `1 + Δ` / `56 + Δ`、`cs_declaration: 55`、`tf_placeholder: 1`）⇒ 当 **SPEC 段**分类变化（例：U8 被 CTO 追认 ⇒ E-17/E-38 落成区间）时仍需手改 = 第二套真源残余。建议照 `-1134` 的 `DERIVED_*` 同式把基值也由**同一份逐件计算**派生。

## 三、方法学订正（**我自己的两次无效扰动，必须披露**）
1. **我第一次的 E 扰动没生效**：`node -e` 内联脚本被 PowerShell 引号处理吞掉（`SyntaxError: missing ) after argument list`）⇒ 脚本**解析期就死了**，文件未改 ⇒ 那次"29 passed"是**空跑**。⇒ 改用**脚本文件**（`m-perturb.mjs`，带 `NOT_REPLACED` 保护）重做，才得到 §二 的真红。
2. **我第一次的 F 扰动无效（方向错）**：我把 `causal_strength` 加在**顶层** ⇒ **loader 根本不看那里** —— 原文 `readRawParam` L262-269：
   ```
   * `transfer_function` / `action_effect_lag` 在顶层；`causal_strength` 在 `optionalProps` 内。
   function readRawParam(def, key) { if (key==='transfer_function') return def.transfer_function;
     if (key==='action_effect_lag') return def.action_effect_lag;
     const op = def.optionalProps; return op ? op.causal_strength : undefined; }
   ```
   ⇒ 顶层加键**不改判定**（我实测文件里确有 `causal_strength:0.5` 而测试仍绿）⇒ 那次"未红"**不是缺陷，是我的扰动没打到测量点**。⇒ 已按**字段真实归属位置**重做为 F′（`optionalProps`）。
   **⇒ 纪律**：造红必须打在**判据真正读取的位置**（本条与"改输入即红"同族；位置错 ⇒ 假绿）。
3. 我对 **§5.2** 的补充证据：你最初的**第一版**（从文件名推 `$id`）之所以红，正是同一类"位置/来源错"——**与我第一阶段独立读数一致**（56 件里恰 **5 件** `$id` 尾段 ≠ 文件名主干：`decision-concentrates`/`external-assumption`/`incentive-binds`/`locks-in`/`signal-transmits`）✅

## 四、a / b / c / d

**a 与实测不一致处**
- **a-lite-1（归 lead，建议）**：**提交消息 = `$MSG`**（我实测 `subject=[$MSG]`、`body=[]`）⇒ 该修复笔在历史上**不可读**（未展开的 shell 变量）。分支已共享 ⇒ **禁 force/改写历史**；建议**下一笔补一条说明**（或在本轮回执登记），以免"留痕"变成反向证据。
- **a-lite-2（归 lead，建议）**：**B/C 件仍无注入缝**（`-1134` 有 `SYNO_EDGE_TYPES_DIR`，B/C 用 `process.cwd()`）⇒ 我被迫用临时树造态。**建议加 `process.env.SYNO_EDGE_TYPES_DIR ?? …`（一处）**，否则下位复核员会重踩"必须改真仓才测得动"。
- **a-lite-3（归 lead，建议）**：B 件 `BASELINE_TALLY` **基值仍字面**（见 §二 残留）。

**b 无法核实处**
- b-1：**三卡合并的完整态**我未跑（不存在）⇒ 我的 B 态是**等价构造**（58 件 + 2 件真件）。**但本笔的目标态就是它**，且它已实测绿 ⇒ 结论成立。
- b-2：`promoteAfter`（预告件到期）仍是**纸面期限**（前轮已报）。

**c 跑不通处**：无（**但见 §三**：我自己两次扰动无效，已订正并给出正确做法）。

**d 能否据此独立开工/决策**：**能** —— 六态齐（A 绿 56 / B 绿 58 / C 红点名 / D 红点名 / E 红（id-label 对账）/ F′ 红（双向）），每条带命令与原始输出；且"合并顺序无关"**这次由我独立复现成立**。

## 五、结论用语

**✅ `612df29c5` —— `可提请独立审计`**；**我判：无阻塞项，可作为 #472 的合并对象**（前提：合并带入 `l3-65` 的 +2 边 = 58 件 —— 那正是本笔的目标态，已实测 `3 passed / 88 passed / exit 0`）。
**两条自陈**：① 我第一次 E/F 扰动无效（引号吞脚本 + 字段位置错），**均已订正重做**，出件用的是订正后的结果；② 临时树移除前如实记录仍有 **3 条未跟踪文件**（2 件我放入的预告件 + 1 个我写的校验脚本），随 `worktree remove --force` 销毁，残留 `Test-Path=False` 已核。
