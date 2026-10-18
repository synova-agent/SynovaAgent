# 开工前必做两件事：查基础（禁止重复建设）＋ 对齐 DSH 代码标准

状态: implemented
日期: 2026-10-18

## 一句话

10 份包守则新增 §八之三：开工前必须盘点既有基础（136 个 control-tower 件 + 四个既有约定），
且交付件必须对齐 DSH 代码标准（typed error / fail loud / explicit authority / Known Limitations / Source map）。

## 问题（实测）

1. **重复建设实例**：`check-package-selfsufficiency.py`（1205 行）**复用现成件 0 处**，而其四类机制均已存在：
   - `pre-dispatch-check.sh`：三态退出码 + 机械/语义分层
   - `check-gate-integrity.sh`：`@降级` 契约 + `SYNO_GATE_DEGRADED_LOG` + degraded 日志字段
   - `check-verifiable-done.sh` / `check-gate-integrity.sh`：判别力自检
   - D732：UTF-8 强制
2. **代码标准差距**：对照 DSH（`dsh-experimental-agent-team` 等）：
   - DSH 每包有 README（Summary / Design philosophy / **Source map** / **Known Limitations**）
   - 错误用 `class TeamError extends HarnessError`（带 code），不是裸 Error
   - 设计承诺四条：Durable log, derived state / Process-local ownership / **Explicit authority** / **Bounds that fail loud**
   - 我们那份 checker：有 `@input/@output/@exit/@degraded` ✅，但**无 Known Limitations 段**、无 Source map、错误类型未带 code

## 决定

在 10 份包守则加 §八之三，含两张清单：
- ① 既有基础盘点（四类范围 + 输出格式 + 四个必须复用的既有约定 + 判据：缺节不许开工）
- ② DSH 标准 8 项（头部契约 / typed error / fail loud / explicit authority / Known Limitations / 设计哲学 / 测试配对 / README 骨架）+ 判据（缺则 L1 不收、独立复核逐条核）

## 依据

创始人 2026-10-18：「一定要检查现在是否有什么基础，是不是重复建设。其次一定要学习 dsh 的代码质量，学习人家的代码风格和标准。」

## 生效时点

本 commit 起。
