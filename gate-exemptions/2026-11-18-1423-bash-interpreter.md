# review: #1423
# 豁免说明：仅修复 Windows 本地门禁的解释器环境可判定性，不新增门禁组或 CI context。
# 边界：WSL 明确 exit 2；Git Bash/Linux 判据不变；不做 gitdir 转换，不改产品代码。
# 回滚：移除入口保护、配对测试、本豁免与对应 Note。
- scripts/pre-commit-check.sh — 在现有入口增加 WSL 环境明确报错 — #1423
- tests/control-tower/pre-commit-interpreter.test.sh — 覆盖解释器与 pre-push 环境失败回归 — #1423
- scripts/pre-push-check.sh — 保留 baseline 环境错误并继续输出可判定提示 — #1423
- gate-exemptions/2026-11-18-1423-bash-interpreter.md — 本次限定豁免文件自身同步登记 — #1423
