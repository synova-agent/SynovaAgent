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
- 修法（三信号，按强度排序；**R1 收口 verifier P2 后加佐证**）:
  1. `rebase-state`: `<.git/rebase-{merge,apply}>/orig-head` 存在 **且** marker 是该 orig-head 的祖先
     （= 该会话确实在 marker 之后重放）—— **可伪造类（forgeable=1）**；
  2. `cherry-pick-state`: `CHERRY_PICK_HEAD` 存在 **且** marker 是其祖先 —— **可伪造类（forgeable=1）**；
  3. `tree-subject-match`: HEAD 与 marker 提交 **同 subject 同 tree**（纯重写副本）—— **内容类（forgeable=0）**。
- 🔴 R1 收口原因（verifier P2）: 初版 `in-progress` **仅看目录存在** ⇒
  ① 一次中断的 rebase 残留目录会把此后所有 mismatch 降级为 suspected；
  ② `mkdir .git/rebase-merge` 一行即可把真 `--no-verify` 洗成 suspected ⇒ 阈值不触发（可绕过）。
  收口 = **佐证 + 分类 + forgeable 标注**（两类字段使"可伪造类"可被单独统计与审计）。
- 记录形态: `suspected-rewrite head-mismatch marker=… parent=… suspect=<why> forgeable=0|1`；
  **记录保留、可 grep、可审计**（不静默漏判）；消费侧按类分开计数并显式打印 **可伪造类计数**。
- 消费侧（`pre-commit-check.sh` GATEKEEPER-COUNT 段）**双计数**: 仅 `detected-bypass` 触发硬阻断/ACK 语义；`suspected-rewrite` 仅打印可见计数。
- 退出条件: 若出现「真绕过被误分类为 suspected」的实证 ⇒ 立即收紧信号③（例如要求 tree 相同**且** diff 相同）或取消状态类信号（1/2）只保留内容类（3）。
- 判别性证据（夹具内自证）: 去掉佐证（回退到"只看目录存在"）⇒ 用例⑤（陈旧残留）与⑥（伪造佐证）**必红**；已实测。

## 三、回滚

- 余量: 删 `# SLACK-CAP` 行 ⇒ 退回「无上限、仅动态打印」；`--slack/--slack-cap` 为只读出口，删除无副作用。
- gatekeeper: 单文件回滚 `post-commit.sh` 的分类段 ⇒ 退回一律 `detected-bypass`（误报回归，但不会漏判）。
