# 决策 Note · K12-21 #467 取目标态落新 base

**状态**：已实施
**日期**：2026-10-13
**决策**：把 #467 的**最终内容**（14 件）按件取到新 base `f5827e3b6`，**不用** merge／rebase／cherry-pick；
并把 T10 的 `BASELINE_FAILS` 按新 base 的**既成红集**（3 条，各有独立卡）**重述**。
**理由**：见下四条 ＋ 两条代价。

---

## 一、为什么"按件取材"而不是 merge / rebase / cherry-pick

```
· **不 merge**  —— D706「索引精确提交」不变量用 `git show --name-status <commit>` 取"实际提交变更集"；
   而 `git show` 对 **merge 提交**出的是 **combined diff** ⇒ `_after` 为空/不等 ⇒ **误拦**（本线已实测该口径）。
· **不 rebase** —— 该分支**已推送**（`cee02cd69` 在远端）⇒ rebase = 重写已推历史 ⇒ 需 **force push = 红线**。
· **不 cherry-pick** —— `df8ed1227` 已实测 **CONFLICT add/add**；且 cherry-pick 搬的是"当时的补丁"，
   会把"当时基于旧 base 的上下文"一起搬进来。
· **取目标态** —— `git checkout <#467 head> -- <14 件>` 取的是**最终内容**⇒ 天然无条件冲突。
```

## 二、为什么"取这 14 件"是安全的（实测，非推断）

```
· #467 head `cee02cd69` 相对主干 **28 落后 / 5 领先** ⇒ 它的**整体树**是陈旧的
  （若整树 merge 会**回退** #194/#189/#199/#200 等已合内容）
· 但 `merge-base(f5827e3b6, cee02cd69)` = `bb2e5e1a0`（= #468 的 merge_commit）
· 🔴 **实测：主干在 `bb2e5e1a0..f5827e3b6` 期间未改这 14 件中的任何一件**
  ⇒ "take theirs" 与"take 主干版"**逐字等价**，不存在覆盖他人改动的风险。
```

## 三、为什么 T10 基线要从 1 条改成 3 条（**不是放宽判据**）

```
【T10 的机制】集合等式（`probe-contract.test.sh:455-462`）：
  `实测 FAIL 集 == BASELINE_FAILS` —— **双向生效**：新增红要报，存量债"悄悄消失"也要报。
  ∴ 改基线**不改判据语义**，只把"当前既成红集"写成**显式声明**。

【新 base 上的既成红集 = 3 条（各由他卡引入，非本件引入）】
  ① probe-content-registry —— K12-14 存量债：`probe-content-registry.ts:103` **硬编码绝对项数 20**，
     与注册表真值漂移（锚 25 → #199 后 22，探针恒报"应为 20"）⇒ 结构性恒红。归治理线。
  ② probe-role-config —— 🔴 **跨 PR 真红（新 base 上才显现）**：#194/#468 已合（引擎侧
     `permission-grants.ts:248` `GRANTS_KEY='permissionGrants'` 真读磁盘，三角色
     `roles/{finance,hr,sales}/capabilities.yaml` 该段**实测都在**）；而本探针 `:62 TARGETS` / `:65 GATE_TARGETS`
     仍指向 **`extensions/presets/grants/`**（不存在）⇒ **落点约定不一致** ⇒ 归 **#505**
     （卡面改述 ＋ 改探针指向 `roles/<roleId>/capabilities.yaml`）。
  ③ probe-output-contract —— 🔴 **跨 PR 真红（新 base 上才显现）**：四件契约 yaml 与校验器均已落（#189/#470），
     探针 `walkContract` **只收数组形态的 `required`**，而契约用**布尔** `required: true`
     ⇒ 显式不一致 ⇒ 归 **#506**（认布尔 ＋ 加判别力自检）。

【为何必须把它显式写下来，而不是"就让它红着"】
  · ① 不写 ⇒ ②③ 会以"**新增产品红**"形态压着 T10 ⇒ **反而掩盖信号**（等式双向报警被触发但无归属）
  · ② 派单令要求 `probe-contract.test.sh ⇒ fail=0`（Done 判据）⇒ 不重述则**物理不可达**
  · ③ 逐条记明卡号与根因 = 派单令「**引用新卡**」的落法
```

## 四、代价（如实登记）

```
· **代价 1**：T10 基线从此**依赖新 base** ⇒ 若他卡（#505/#506/K12-14）修好对应件，
  本断言会**转红**（刻意如此：把"红没了"也变成一次显式声明，防"悄悄刷绿"）⇒ 届时应**显式**同步 `BASELINE_FAILS`。
· **代价 2**：Done 判据的 `pass=94` 在本 base 上**实测为 `pass=95`** ——
  该文件 blob 与 2026-10-12 我核过 94 的那棵树**逐字相同**（`06dd31757b1f`），
  差额来自**依赖分支态的断言计数**（T10 由 bad→ok ＋1；T7 在现 base 上不再产生 mismatch ⇒ +1），
  **非本件引入**。如实标注，**不把 95 写成 94**。
```

---

> 本 Note 由 K12 第 8 批执行会话（lead）产出，依据分叉专线派单（经 CTO 授权）件 1。
> 相关载体：`.claude/task-briefs/2026-10-13-205-取目标态落新base.md`（claim brief）｜
> Gitea `#205`（卡面）｜`#505`／`#506`（两条跨 PR 真红的承接卡）。
