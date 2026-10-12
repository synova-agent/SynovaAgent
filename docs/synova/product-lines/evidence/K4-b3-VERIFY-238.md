# K4-b3-VERIFY-238 — 独立复核：#238（K4-05 编号权威表 ＋ 引用对齐判据）

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`k4b3/238-239` @ **`a6e927a9a7f1f62f3100d69723ae8cae2055b1ae`**（`git ls-remote` 实测；分支已于复核期间出现）
> **diff 左端**：`ba1b22a8b5`
> **本件状态**：**结构面已核（§一）**；**判据面（末行口径 / 反例造红 / 接线 / 测试真断言）待下轮**——本轮不冒充已核。

---

## 一、结构面

### 1.1 对象与写集

```
$ git ls-remote --heads origin | grep k4b3/238-239
a6e927a9a7f1f62f3100d69723ae8cae2055b1ae	refs/heads/k4b3/238-239

$ git log --oneline ba1b22a8b5..origin/k4b3/238-239
a6e927a9a feat(238): K4-05 编号权威表 + 引用对齐判据（判据④ 末行 occurrences=45 distinct=15 hit=15 miss=0）

$ git diff --name-status ba1b22a8b5..origin/k4b3/238-239   （7 件）
A  .claude/claims/238.yaml
M  docs/synova/GLOSSARY.md
A  docs/synova/coordination/numbering-authority.md
A  docs/synova/product-lines/evidence/K4-b3-238-numbering-authority.md
A  memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
M  scripts/control-tower/probe-cycle-edges.ts
A  tests/coordination/numbering-authority.test.ts
```
- 与 task-1 声明写集的对照：`claims/238.yaml`、`GLOSSARY.md`、`coordination/numbering-authority.md`、`scripts/control-tower/probe-cycle-edges.ts`、`tests/coordination/numbering-authority.test.ts`、`evidence/K4-b3-238-*` **均在声明内** ✅。
- ⚠️ **`memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md` 不在 task-1 声明写集内**（见 §1.2，事出有因但另有更严重的问题）。
- **PR 预算**：7 件（≤12）✅；域 = `docs/` ＋ `scripts/control-tower/` ＋ `tests/` ＋ `.claude/claims/` ＋ `memory/notes/`（多域，但属"一卡一封"性质，按治理产物口径可议）。

### 1.2 🔴 a-1（须处置）**同路径跨分支异构**：`memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md` 在两个分支上是**不同内容**

```
$ git rev-parse origin/k4b3/lead:memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
c972f7f5b52ab3e17f110a1de6916c3776d470cb      ← 队长版（已含第四轮 5 处订正）
$ git rev-parse origin/k4b3/238-239:memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
199780539be6b1d557aadf1351d609260e892043      ← L1 版（= 我两轮前审过的**旧版**）

blob 相同 = False；逐行差异 = 8 行
  L1 版（旧，<=）缺失的内容正是队长本轮订正后的：
    · 「最长 **480 字符（多数态口径）**」（旧版写 485）
    · 「🔴 修正后的准确自陈」整段：机器读字段零变化 / note 去引号（201 十处 947→937、345 四处 544→539）
    · 「引号策略教训：应转义 `\"`」
    · 「🔴 越界声明：201/345 不属本批任何卡 ⇒ 需 CTO 追认」
```
**风险（这是本条的要害）**：两条支**同时新增同一路径且内容不同** ⇒ 无论哪条后合入，都会**覆盖**先合入者；若 `k4b3/238-239` 后合，则**第四轮的订正内容被静默回退**（400 行左右的订正段落消失，且不会报冲突或报错——同一路径新增在合并时通常表现为"后者覆盖/需人工裁决"）。
**为什么不是 L1 的孤立失误**：该 Note 是为**满足 `scripts/control-tower/**` 的 Note 引用门禁**而存在；L1 需要它（其改的是 `probe-cycle-edges.ts`），但它**从未落 main**，L1 只能拿到某个快照 ⇒ **快照过期**。⇒ 属**跨分支单源文件的同步缺陷**。
**归属**：**lead（分支/单源治理）＋ impl-a（取了过期快照）**。
**处置建议（三选一，请队长裁）**：
1. **收敛到一条线**：Note 只由 `k4b3/lead` 携带，L1 分支**移除该文件**（改名后其 probe 仍在 `scripts/control-tower/`，会触发 Note 门禁 ⇒ 需同时确认门禁对该 PR 如何取 Note：若门禁只看**同 PR diff 内**是否有 Note，则 L1 必须自带一份 ⇒ 走方案 2/3）。
2. **两条线都带，但强制取队长版**：在 L1 分支上用 `git checkout origin/k4b3/lead -- <path>` 取**最新 blob**（`c972f7f5…`），并在 PR 正文声明"该件真源 = `k4b3/lead`"。
3. **先把 Note 合入 main**（单点落地），此后各线**引用 main 上的件**、不再各自新增 —— 这也符合 M 纪律「不引用未落 main 的路径」。
> 我倾向 **3 → 2**（先落 main 最省事且根治；短期按 2 保证不回退）。

### 1.3 待核（下轮，本件不冒充已核）

| # | 待核项 | 判据（我打算怎么测） |
|---|---|---|
| V-1 | 判据④ 末行字符串 `occurrences=45 distinct=15 hit=15 miss=0` | **必须在 `ba1b22a8b5` 上实跑 probe，取其原始输出末行**；并核 **`occurrences` 定义 = 跨口径求和（22+23）**，不得硬编码 |
| V-2 | 「删除即报红」判别性夹具 | 在 /tmp 副本删 1 条引用 ⇒ 末行应 `44` 且**非零退出**；复原后哈希一致（**口径 W：`Get-FileHash` 原始字节**） |
| V-3 | 编号权威表 `numbering-authority.md` 的**双向映射完整性** | 42 条 E 号是否**逐条**有 `$id`/`label` 对应或显式标"无落点"；**E-10/E-12 必须显式写"两版候选均 ∉ 词表"**；三源分歧**须并列三源**（不是两栏） |
| V-4 | GLOSSARY.md 改动 | `E-4.1/E-4.2`（L74）与两位式冲突是否**显式标注或解决**（不许留着不说）；改动是否只在这两行 |
| V-5 | 测试件 `numbering-authority.test.ts` | 有真 `expect()`；**覆盖正常/降级/边界**；且**不是"恒真"断言**（我对每一条 expect 做一次"改动输入是否变红"的反证选择） |
| V-6 | 接线（铁律 0-2） | probe 是否被**真实调用链**消费（`scripts/control-tower/**` 是否被 pre-commit/CI 调用）；只有 grep 命中不算 |

---

## 二、本轮结论用语

**`a6e927a9a`（#238 首笔）—— 结构面：1 条须处置（a-1 同路径跨分支异构）＋ 1 条越界登记（Note 不在声明写集）；判据面 6 项待核，本件不冒充已核。**
**a-1 的隐患等级高于"写集越界"**：它会在合并时**静默回退已完成的订正内容**，且不报错 —— 建议在收件闸前先定单源方案（§1.2 三选一）。
