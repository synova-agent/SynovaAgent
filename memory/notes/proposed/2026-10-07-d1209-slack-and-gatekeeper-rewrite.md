---
状态: proposed
日期: 2026-10-07
决策: 发现制余量（scan − FACE-TOTAL）改为「动态可见 + 上限 SLACK-CAP=10 超限即红」；gatekeeper 把 rebase/cherry-pick 重写从「确证绕过」中分离为「疑似（suspected-rewrite）」
理由: ① 下界语义的必然副作用是余量随加测试单调增长（= 可被静默删除的测试数无界）⇒ 需可见 + 上限；② rebase 重放提交被一律记为 --no-verify（实测当日 8 条误报、两次人工 ACK）⇒ 能区分则区分，不能区分则把「疑似」与「确证」分离且都不丢
---

# D1209 — 发现制余量上限与可见性 + gatekeeper 重写/确证分离

- 状态: proposed（2026-10-07，治理线 B）
- 关联: #1227（发现制）· #1270（gatekeeper 误报）· #1263（--ci-reds 范围收紧，另一段）

## 一、余量（slack）语义

- 定义: `slack = scan − FACE-TOTAL` = **可被静默删除而仍判绿的测试数**（下界语义的代价面）。
- 旧表述（过窄）: 「净零变换（删 1 + 加 1）不可检测」⇒ 修正为「**≤ 当前余量的净删除不可检测**」（净零只是最常见形态）。
- 新约束:
  - `--list` 动态向 stderr 打印 `余量 slack=N（scan − FACE-TOTAL）`（人看得见它在涨；CI 日志与 `CI-REGISTRY` 行都可见）；
  - `# SLACK-CAP=10`（台账注释行）：余量 > 上限 ⇒ 违规（exit 1），**逼周期性显式上调 FACE-TOTAL**（一行、低频，不进每 PR 的中央写集）；
  - **禁止自动上调**（会让棘轮失效）；上调必须是一次显式提交 + 说明理由。

## 二、gatekeeper：重写 vs 真绕过

- 病根: `post-commit.sh` 在 head 不一致时**一律**记 `detected-bypass`；`git rebase` 重放提交的 parent 必与 marker 的旧 HEAD 不同 ⇒ 误报（实测当日 8 条，人工 ACK 放行 2 次）。
- 修法（两信号，命中任一即判「重写」）:
  1. `in-progress`: `.git/{rebase-merge,rebase-apply,CHERRY_PICK_HEAD}` 存在（重写进行中）；
  2. `same-tree-subject`: HEAD 与 marker 提交 **同 subject 同 tree**（纯重写副本：parent 变、内容未变）。
- 记录形态: `suspected-rewrite head-mismatch marker=… parent=… suspect=<why>`；**记录保留、可 grep、可审计**（不静默漏判）。
- 消费侧（`pre-commit-check.sh` GATEKEEPER-COUNT 段）**双计数**: 仅 `detected-bypass` 触发硬阻断/ACK 语义；`suspected-rewrite` 仅打印可见计数。
- 退出条件: 若出现「真绕过被误分类为 suspected」的实证 ⇒ 立即收紧信号②（例如要求 tree 相同**且** diff 相同）或取消信号②只保留信号①。

## 三、回滚

- 余量: 删 `# SLACK-CAP` 行 ⇒ 退回「无上限、仅动态打印」；`--slack/--slack-cap` 为只读出口，删除无副作用。
- gatekeeper: 单文件回滚 `post-commit.sh` 的分类段 ⇒ 退回一律 `detected-bypass`（误报回归，但不会漏判）。
