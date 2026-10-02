# D940 返工（#743 K3 P0）：占用表全源归属 TS_TOP

- 日期: 2026-09-25
- 状态: proposed（随 #743 PR 落地后 git mv 至 implemented/）
- 决策人: coder-a（DSH 小队），CTO 队长派单 §一

## 问题（K3 批次5 §一 P0 实证）

`alloc-task-id.sh` 的 D550 origin/main 占用合并段用**当前 CWD** 执行
`git ls-tree --name-only origin/main task-state/`（无 `-C`）。生产环境 CWD=本仓，行为正确；
但在测试夹具 / CI 环境下，CWD 是**真实仓库**，task-state 已注入夹具目录 → 真仓 main 的
大号（D944/D956）混入 MAX 计算表 → NEXT ≠ 夹具期望号 → D940 跨位置拒绝路径**永不触发**
（K3 实测：夹具前置成立，工具却发出 D944；本机复刻：发 D956）。

## 决策

1. 占用表**全源**（origin/main 合并、worktree 扫描、branch -r 扫描、ls-remote 快照）必须
   跟随 task-state 所属仓库：`TS_TOP = git -C "$TASK_STATE_DIR" rev-parse --show-toplevel`，
   统算一次、全源共用，不得混入 CWD 所在仓。
2. 生产不变性：CWD=本仓时 `git -C "$TS_TOP"` 与无 `-C` 逐字节同源，行为零变化。
3. 配对测试 §6 改为**自带 origin/main 的夹具仓**（判别性构造）：本地空 + 夹具 main 占
   D600 → 必须发 D601。原版以真仓 origin/main 为期望源，实际依赖被本次修掉的污染行为。

## 参考

参考：第一性原理（单一归属，测量源与被测对象同一仓库）+ K3 批次5 §一实证 + 项目既有
TS_TOP 模式（ls-remote 快照段 L142 已如此，本次是把不一致的 D550 段拉齐）+ 结论。
