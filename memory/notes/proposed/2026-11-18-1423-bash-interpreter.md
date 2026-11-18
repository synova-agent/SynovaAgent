---
状态: proposed
日期: 2026-11-18
决策: 在现有 pre-commit 入口对 WSL bash 明确返回环境错误，Windows 本地门禁统一使用 Git for Windows Bash。
理由: 不同会话 PATH 会选择不同 bash，WSL 无法解析 Windows worktree 的绝对 gitdir，必须 fail-fast 而不是把环境故障包装成业务红绿。
---

# Windows 本地门禁解释器保护（#1423）

- **现状**：同一脚本在 Git Bash 可运行，在 WSL bash 因 worktree gitdir 路径解析失败而判不了。
- **决定**：仅在现有入口增加 WSL 检测和明确错误，exit 2；不做路径转换，不新增检查组或 CI context。
- **依据**：真实 WSL 调用与 Git Bash 对照；判据纪律要求环境依赖显式。
- **生效时点**：PR 合并后生效。
- **边界**：正常 Git Bash/Linux 行为不变，不改产品代码和质量判据。
