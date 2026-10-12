# K4-b3-VERIFY-1350 — 独立复核：#1350（= 板卡 #65 / K4-05bis）**A 段**卡面 ＋ claim

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：分支 `k4b3/l3-65` @ `afa582cd8034309b2866e1a5c6086f2bbf819d15`（`git ls-remote` 实测）
> **diff 左端**：`ba1b22a8b5`（所有读数在该 SHA 上取）
> **被审件**：`.claude/task-briefs/2026-10-11-1350-K4-05bis-边词表-目标层级边与计划边.md`（49044 B，562 行）＋ `.claude/claims/1350.yaml`（4059 B）
> **范围声明**：**本件只审 A 段（卡面 ＋ claim ＋ 核验件）**。**B 段（写 `extensions/ontology/edge-types/`）尚未开工** ⇒ V1/V2/V3 判据**无可复核物**。

---

## 〇、对象与字节

```
$ git ls-remote --heads origin | grep k4b3/l3-65
afa582cd8034309b2866e1a5c6086f2bbf819d15	refs/heads/k4b3/l3-65

claim.writeset 三件:
  .claude/claims/1350.yaml
  .claude/task-briefs/2026-10-11-1350-K4-05bis-边词表-目标层级边与计划边.md
  docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md

$ git -c core.quotepath=false diff --name-only ba1b22a8b5..afa582cd8   → 同上 3 条（逐条相等）
独立 SHA-1 比对 3/3 一致｜BOM 全 none
```
⇒ **claim.writeset ≡ 实 diff ≡ 3 件**，**零预授权、零越界**（无 `src/`、无 `extensions/`、无 `packages/`）。这一点做得对。

---

## 一、claim 的 6 条 `done:` 判据 —— **逐条实跑，6/6 通过**

| # | claim 声明（原文摘） | 我的实测命令与结果 | 判 |
|---|---|---|---|
| 1 | `git diff --name-only ba1b22a8b5..HEAD \| grep -c "^src/" \|\| true` ⇒ `0` | 实测 `^src/` 命中 = **0** | ✅ |
| 2 | `git ls-tree -r --name-only ba1b22a8b5 -- extensions/ontology/edge-types/ \| wc -l` ⇒ `56` | 实测 **56** | ✅ |
| 3 | `merge-base --is-ancestor 0b0601fac … && … 1ab0cbb33 … && echo BOTH_ANCESTOR` | 两条 `--is-ancestor` 均 **exit 0** ⇒ `BOTH_ANCESTOR` | ✅ |
| 4 | brief 六字段计数 ⇒ `6` | `^## Q0:\|^## Q1:\|^## Q2:\|^## Q3:\|^## 架构层:\|^## Done 标准` 命中 = **6**（逐行：Q0/Q1/Q2/Q3/架构层/Done 标准） | ✅ |
| 5 | `grep -c "^#CRITERIA: B"` ⇒ `1` | 命中 = **1** | ✅ |
| 6 | 禁入项（`edge-lag-unknown-degraded-1134` / `ontology-loader-param-bridge-1031`）⇒ `0` | 实测命中 = **0** | ✅ |

**判别力提示（供自验员/收件闸用）**：上表 **#2 / #3 / #6 三条对本段恒真** —— 它们断的是 **base 的目录计数 / base 的祖先链 / 本段不含某两件**，**不随 A 段产物变化**，因此**不得**当作"A 段成果"计入。真正有判别力的是 **#1（`src/` 前缀计数）、#4（六字段）、#5（#CRITERIA）** 三条（反证：#1 同一 grep 打 `1ab0cbb33^1..1ab0cbb33` 得 **1**）。
**归属**：impl-c / #1350 A 段（非缺陷，属口径分层，已同步记入 `K4-b3-VERIFY-1412.md` a-3）。

---

## 二、🔴 a-1（须队长处置）**B 段实际写面 > 任务板写集声明，也 > 队长的扩写集清单**

impl-c 在 brief 里**如实登记**了"卡面原写集不含这些件、是否纳入由队长裁定"（**不擅自扩，做法正确**）；claim 注释里也把 B 段计划件列为"**不预授权**"。但**任务板 `task-3` 的 `write_scopes` 与队长件 D4/R7 的扩写集声明尚未跟上**：

| 件 | 出现在何处 | 是否已在任务板 write scope | 是否已在队长扩写集（D4/R7） |
|---|---|---|---|
| `extensions/ontology/edge-types/goal_decomposes_to.json`（名待 N3/N4 认领） | claim 注释 L10 | ❌（task-3 说"放行时追加"） | ❌ |
| `extensions/ontology/edge-types/plan_commits_to.json`（同上） | claim 注释 L11 | ❌ | ❌ |
| `tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts` | claim 注释 L12 | ❌ | ❌ |
| **`extensions/ontology/manifest.json`** | brief **R-3「✅ 纳入本卡写集」**（队长裁定） | ❌ | ❌ |
| **`packages/ontology/src/edge-types.ts`** | brief L296/L304「**有生产消费方 ⇒ 纳入写集**」；claim 注释 L14 | ❌ | ❌ |
| `docs/synova/product-lines/evidence/K4-b3-1350-edge-vocabulary.md` | claim 注释 L15 | ❌ | ❌ |

**我独立复核了 `packages/ontology/src/edge-types.ts` 的"有生产消费方"这一前提（实测）**：
```
$ git grep -n "ALL_EDGE_TYPES" ba1b22a8b5 -- packages/ src/
packages/ontology/src/edge-types.ts:100:export const ALL_EDGE_TYPES: readonly EdgeType[] = [
packages/ontology/src/index.ts:20:  ALL_EDGE_TYPES,
src/l4/data-exporter.ts:12 / :183   ✔ 消费
src/l4/data-purger.ts:14   / :267   ✔ 消费
src/l4/entity-resolver.ts:14 / :215: return ALL_EDGE_TYPES.map(et => typeCounts.get(et) || 0);
⇒ 消费方 = 3 个 src/ 文件（与队长 R6 记「3 个」一致）
⇒ 该文件对象键数 = 52 / 数组条目数 = 52 / 注释自述 "All 52 edge types"（与 R6 的「52 条」一致，K4 定稿件的「51」为陈旧）
⇒ src/l4/entity-resolver.ts:215 使「向量维 = 数组长度」⇒ 52→54 **属行为变化**（与 R6 描述一致）
```
**风险（写给收件闸）**：若 B 段按 brief 落地，L3 的 PR 将包含 **6 件**（2 边件 ＋ 1 测试 ＋ manifest.json ＋ `packages/ontology/src/edge-types.ts` ＋ 1 evidence），且 `packages/ontology/**` 是**跨包**改动。任务板写集若不同步更新，会同时撞两件事：**M2「写集互斥/逐文件声明」** 与 **PR ≤12 文件 + 单域** 的判定口径（跨包 = 跨域）。
**处置建议**：放行 B 段**之前**，队长先 (a) 把上述件补进 `task-3` 的 `write_scopes`，(b) 在 D4/R7 的扩写集清单里显式登记，(c) 声明 L3 的 PR 是否仍算"单域"（若否 ⇒ 拆 PR）。
**归属**：**lead（任务板 + 扩写集声明）**；impl-c 已尽登记义务，**非 impl-c 缺陷**。

---

## 三、a-2（轻）brief 内部对 `packages/ontology/src/edge-types.ts` 的处置表述不一致

```
L219: packages/ontology/src/edge-types.ts （下游同步见「未决项」，未获写集前不动）
L296: **A. `packages/ontology/src/edge-types.ts`（`EdgeType` 常量 ＋ `ALL_EDGE_TYPES`）—— 有生产消费方 ⇒ 纳入写集**
L304: ⇒ **结论（按队长 D 裁定）**：**被生产代码消费（非文档）⇒ 纳入写集**。
```
⇒ L219 与 L296/L304 一处说"未获写集前不动"、一处说"纳入写集"。语义可调和（"纳入"= 已登记待放行），但**字面互斥**会让执行者两种读法都成立。
**归属**：impl-c / brief；处置 = L219 改为「已登记入写集，待队长放行后同 PR 追加」。

---

## 四、b 类（无法核实）

| # | 项 | 说明 |
|---|---|---|
| b-1 | **V1 / V2 / V3 判据** | B 段未开工 ⇒ **无可复核物**。其中 V1「与既有 56 件**同构**」仍缺**分隔符口径**（既有件 `$id` = 51 snake ＋ 5 kebab ＋ 6 单字，见 `K4-b3-VERIFY-prereq-2026-10-12.md` a-1）⇒ "同构"若按"统一下划线"实现，会与既有 5 件不一致。**须在 B 段开工前钉口径** |
| b-2 | 「#1031 的桥可读其字段」（V2 后半） | 依赖 B 段落地的字段形态；同时受 §3.5.1「对象形态 vs 字符串」争议影响（见 `K4-b3-VERIFY-lead-3ca12b9c.md`） |
| b-3 | brief 里 CTO 受理裁定**九项**的逐字性 | 本件只核其**存在与内部一致性**（#CRITERIA: B=1、六字段齐）；**未**逐字比对裁定原件（原件不在本仓，同 #66 核验件的 b-1 限制） |

---

## 五、c 类（跑不通）

**未发现。** 注：验 `#CRITERIA: B` 与六字段时，PowerShell 5.1 的 `$B`/`$b` **大小写不敏感**曾导致变量互相覆盖（路径变 `0`）—— 复核时变量名须带前缀。

---

## 六、d 类：结论用语

- **A 段（卡面 ＋ claim ＋ #66 核验件）—— `可提请独立审计`**：写集 ≡ diff（3 件）、6 条 done 全部实跑通过、三处已知漂移（基数 55→57 改 56→58；卡面【边界】与受理裁定的冲突；#1134 前置解除）均已显式处置，且**claim 明确"不预授权"**（好做法）。
- **B 段暂不可复核**，且**放行前须先补写集**（a-1）与钉"同构"分隔符口径（b-1）。
- 本件共 2 处须改（a-1 归 lead、a-2 归 impl-c），均不动 A 段结论。
