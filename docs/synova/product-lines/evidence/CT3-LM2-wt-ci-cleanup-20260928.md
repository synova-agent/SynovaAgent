# CT3-LM2 证据 — 清理 `/private/tmp/wt-ci`（破坏性操作，已兵底）

> 成员: gate-fix ｜ 任务: task-6（CT-LM2）｜ 分支: `fix/ct-win-gitattributes-20260927`
> 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct-win`（证据落点；主树零写入）
> 对象: `/private/tmp/wt-ci`（**不在仓库内**）@ `ee721b0a` [`fix/ci-concurrency-trigger-narrowing`]
> 授权: CTO 已裁定照常清理；队长已完成安全核实 + 兵底
> 判据形态：**删除型卡，"改坏即红"不适用** ⇒ 用**清前存在 / 清后不存在**的原始输出对照

---

## 一、兵底核验（**先验证充分性，再破坏**）

```
$ ls -la /tmp/L-M2-preserve/
total 96
-rw-r--r--@    1 wane  wheel   1093 Sep 28 06:20 .claude_task-briefs_2026-09-26-D981-ci-concurrency.md
-rw-r--r--@    1 wane  wheel  27180 Sep 28 06:20 .github_workflows_ci.yml
-rw-r--r--@    1 wane  wheel   4605 Sep 28 06:20 L-M2-staged.patch
-rw-r--r--@    1 wane  wheel   1061 Sep 28 06:20 memory_notes_implemented_2026-09-26-ci-concurrency.md
-rw-r--r--@    1 wane  wheel    873 Sep 28 06:20 task-state_D981.json

$ md5 -q /tmp/L-M2-preserve/L-M2-staged.patch
8782eb941b020e1e046a170a86cbe79c        ← 与卡面前提冻结一致 ✅
```

**兵底充分性**（把将被销毁的 **staged 内容** 与兵底逐份比 md5；不止比 patch 的 md5）：

```
$ （git -C /private/tmp/wt-ci show :<path> | md5 -q  vs  md5 -q /tmp/L-M2-preserve/<兵底名>）
  ✅ .claude/task-briefs/2026-09-26-D981-ci-concurrency.md  staged=dfce4181d2d25d97234736aa3a7bc9d8 == 兵底=dfce4181d2d25d97234736aa3a7bc9d8
  ✅ .github/workflows/ci.yml  staged=1b0ffa5381747e3a773a5c8ac981ffef == 兵底=1b0ffa5381747e3a773a5c8ac981ffef
  ✅ memory/notes/implemented/2026-09-26-ci-concurrency.md  staged=d425fbd4517c30d43c892041da0ab7b7 == 兵底=d425fbd4517c30d43c892041da0ab7b7
  ✅ task-state/D981.json  staged=8eed8458aa9f4fa03e1237f6623d934e == 兵底=8eed8458aa9f4fa03e1237f6623d934e
```

patch 覆盖的 4 个文件（`+++` 头逐条）：

```
$ grep -E '^\+\+\+ ' /tmp/L-M2-preserve/L-M2-staged.patch
+++ b/.claude/task-briefs/2026-09-26-D981-ci-concurrency.md
+++ b/.github/workflows/ci.yml
+++ b/memory/notes/implemented/2026-09-26-ci-concurrency.md
+++ b/task-state/D981.json
```

**远端保底在**（不删分支）：`fix/ci-concurrency-trigger-narrowing` @ `ee721b0a` 仍在 origin。

---

## 二、清前证据（**存在**）

```
$ git worktree list | grep wt-ci
/private/tmp/wt-ci                                            ee721b0a [fix/ci-concurrency-trigger-narrowing]

$ git -C /private/tmp/wt-ci status --short
A  .claude/task-briefs/2026-09-26-D981-ci-concurrency.md
M  .github/workflows/ci.yml
A  memory/notes/implemented/2026-09-26-ci-concurrency.md
A  task-state/D981.json
                                                    ← 恰 4 行（**不是**"无脑旧 blob"，是 4 个 staged 未提交文件）

$ ls -la /private/tmp/wt-ci          ← 目录存在
total 2248
drwxr-xr-x@   89 wane  wheel   2848 Sep 26 03:43 .

$ git worktree list | wc -l
     369
```

清前 `git worktree list` 中**已带 `prunable` 标记的僵尸登记共 6 条**（本节原始输出节选，供第三节差额归因）：

```
/private/tmp/diag712                                          6d4e76cb (detached HEAD) prunable
/private/tmp/w674                                             93623d86 [docs/d849-ingest-institute] prunable
/private/tmp/w696m                                            b7d67305 (detached HEAD) prunable
/private/tmp/w704                                             503df169 (detached HEAD) prunable
/private/tmp/w721                                             3a7f51c6 (detached HEAD) prunable
/private/tmp/w850                                             527ac0b8 [docs/d850-authority] prunable
```

---

## 三、执行清理

从仓库根执行（`--force` 是 **`worktree remove` 的**，**不是 force push** —— 红线未破；未用 `git stash`、未用 `--no-verify`）：

```
$ git worktree remove --force /private/tmp/wt-ci
remove exit=0
$ git worktree prune
prune exit=0
```

---

## 四、清后证据（**不存在**）

```
$ git worktree list | grep -c wt-ci
0                                   ← 判据：必须 0 ✅（grep 无匹配时输出了 0 行，管道另打印 0）

$ ls -la /private/tmp/wt-ci
ls: /private/tmp/wt-ci: No such file or directory      ← 判据：必须不存在 ✅

$ git worktree list | wc -l
     362                            ← 清前 369
```

⚠️ **差额 = 7，不是 1 —— 如实归因（不掩盖）**：
`git worktree prune` 除 `wt-ci` 外，还清掉了**清前就已标记 `prunable`** 的 **6 条僵尸登记**
（见 §二末节），以及 `wt-ci` 自身 1 条 → 369 − 7 = 362。
那 **6 个目录仍在磁盘上**（本次**未删任何目录**），只是不再是注册工作树。
这属 `git worktree prune` 的既定义务（卡面要求执行），但**超出卡片"总数应减 1"的预期**，故逐条登记（见 §六 遗留清单 1）。

**不改动项复核**：

```
$ git ls-remote --heads origin | grep ci-concurrency-trigger-narrowing
ee721b0abf52a4cdcc42caef44669d2cca423264	refs/heads/fix/ci-concurrency-trigger-narrowing   ← 保底分支仍在 ✅

$ md5 -q /tmp/L-M2-preserve/L-M2-staged.patch
8782eb941b020e1e046a170a86cbe79c          ← 兵底未被动 ✅
$ ls -A /tmp/L-M2-preserve/ | wc -l
5                                         ← 兵底 5 份原样 ✅
```

---

## 五、自验结论

- 清前存在：**成立**（`worktree list` 1 条 + `status --short` 4 行 + 目录 `ls` 可见）。
- 清后不存在：**成立**（`grep -c wt-ci` = 0 + `ls` → No such file or directory）。
- 兵底充分：**成立**（4 份 staged 内容与兵底逐份 md5 相同，不止比对 patch 自身 md5）。
- 不删远端保底分支：**成立**（`ls-remote` 回执仍在）。
- 不动兵底：**成立**（patch md5 不变，5 份文件齐）。
- 红线：未用 `--no-verify` / `git stash` / force push（`--force` 仅属 `worktree remove`）。

**自验结论: 可提请独立审计**（不构成审计通过；审计权归 K3）。

---

## 六、遗留清单

1. **`git worktree prune` 连带清掉 6 条僵尸登记**（`/private/tmp/{diag712,w674,w696m,w704,w721,w850}`）：
   这些目录**仍在磁盘上**但已不再是注册工作树（orphan 目录）。卡面只要求"总数减 1"，
   实际减 7 ⇒ 超出部分如实登记，由 CTO 决定是否另行清理这 6 个目录（**不在本卡写集，未动**）。
2. **残余差异（沿用队长前提冻结的诚实记录，未掩盖）**：
   · `if: always()` 计数：staged 版 = **2** vs main = **1**；
   · 「D981 等价性核验」记录的 `5ed267af` **未入 main**（仅在未合分支 `chore/D1014-ci-concurrency`）。
   ⇒ staged 版语义已被 D1014（`4345d6d6`，已入 main）取代，故本次清理**不丢 main 侧真相**；
   但上述两条差异**未被本次操作消除**，如需收口须另立卡（不属 task-6 写集）。
3. 本卡只删工作树登记，**未删任何文件内容**（内容已在 §一 兵底，且 committed 部分在 origin 分支上）。
