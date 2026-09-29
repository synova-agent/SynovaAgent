# D1068 — 门禁证据载体迁移：bypass.log → commit trailer（分段交付）

- **状态**: proposed
- **日期**: 2026-09-29
- **决策**: 门禁证据的载体从「git 跟踪的 append-only 文件 `.claude/bypass.log`」迁到
  **commit trailer**（`PreCommit-PASS: <sha256>`）。本批（段 1）只交**机制核 + CI 可见化**；
  删 `merge=union`、停写旧日志、21 个日志断言测试改造属后续段。
- **理由（目的）**: 解除「谁合并谁弄脏别人」的合并吞吐瓶颈 —— 旧载体是**所有分支共写同一个
  可变 tracked 文件**，每次提交都被 `post-commit` 追加一行 ⇒ 每个分支必带该文件变更。
  D1065 实测：GitHub 的可合并性计算**不尊重 `merge=union`**，同一 PR 在 main 前移后仍判 dirty，
  合并前必须「贴最新 main 再推一次」，一轮 CI ≈ 40 分钟 ⇒ 串行合并墙钟 ≈ N × 40 分钟。

## 关键设计判据（实测推出，非推断）

**trailer 值必须绑到「pre-commit 真跑过」这件事，否则只是自证空话。**
若 trailer 只写提交 SHA 或树 SHA，任何人裸 `git commit` 都能事后补上同一个值。
故：`trailer 值 = sha256(证据标记文件内容)`，而标记文件**只在门禁跑完后**写出
（`scripts/control-tower/precommit-evidence.sh`，落 `.git/synova-evidence/precommit-pass`，
**不被 git 跟踪** ⇒ 不会重演「每提交必脏」）。未跑门禁 ⇒ 无标记 ⇒ 算不出 trailer。
这就是判据 C3「改坏即红」的物理基础。

## 本批实测发现（推翻了派单件两处前提）

1. **「只删 union 不停写」会让情况更糟**（本地真实 merge 实测）:
   删掉 `merge=union` 后，两分支各改 `.claude/bypass.log` ⇒ `CONFLICT (add/add)` **硬冲突**；
   union 在时自动合并 clean。⇒ 只删 union = 把「可自动合并的脏」换成「不可自动合并的脏」，
   合并吞吐**更差**，与 C1 目标相反。**真解 = ① 停写 ② 再删 union**。
   裁决: CTO 2026-09-29「拆两步：写入侧先（含停写），再删 union」。
2. **改造面远大于派单件**：`bypass.log` 被 **42 个文件**引用（`scripts/` 20 + `tests/` 22），
   其中 **21 个测试硬断言日志结构**（"存在"/"被 git 跟踪"/"每次新增恰好 1 行"）。
   派单件 ⑥ 只点了 6 个消费者 ⇒ 段 2–5 合计 ≈ 30 文件，**超「PR ≤12 文件」**，必须分段。

## 已知缺口（诚实声明）

- **本批的 CI trailer 检查只 `::warning::` 可见化，不硬失败**：证据标记由**已安装的**
  pre-commit hook 写入，现有 clone / 其他机器不跑 `install-hooks.sh` ⇒ 它们产出的新提交无 trailer。
  硬失败会在过渡期误拦。硬门禁留给「停写」同批（届时所有机器必须重装 hook）。
- **C1「GitHub 判 clean」本批无法验证**：union 未删（按上条裁决），且 GitHub 侧判定需 PR 环境。
  本地可核部分已验（无 union 声明时同文件并发修改 clean）。
- 自验为**队内独立自验**（独立成员、只读）⇒ 结论只到「可提请独立审计」，**通过与否归 CTO 收件闸 + K3**。
