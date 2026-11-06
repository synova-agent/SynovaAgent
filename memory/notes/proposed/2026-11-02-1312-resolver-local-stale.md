---
状态: proposed
日期: 2026-11-02
决策: resolve-ci-base 在多远端（开发机）时，本地分支不再作对账基——优先 gitea/<trunk> → origin/<trunk>；两者皆无则 exit 2（fail-closed 并给命令）；非分支形态（sha/tag）保持原样，逃生缝不变。
理由: 一任务一 worktree 的作业方式下，新建 worktree 不更新本地 main ⇒ 本地 main 天然陈旧 ⇒ base..HEAD 混入他线已合提交 ⇒ D331 等 6 道门禁索要他人记录/范围过宽。2026-11-02 连续 5 个 session 被误拦。原则借 DSH：判定基必须显式可验证，不可信即拒绝。
---

# resolve-ci-base 本地陈旧（#1312）

- 改动：`scripts/control-tower/resolve-ci-base.sh` ④ 多远端分支。
- 不动：单远端 / CI 路径；`SYNO_BASE_REF=<sha>` 与 `<remote>/<branch>` 语义。
- 回滚：恢复 ④ 原块（本地优先）即回到原行为。
