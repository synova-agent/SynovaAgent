# Task Brief — 门禁日志与 Claude Code 解耦（.claude/ → .synova/logs/）

#CRITERIA: D

## Q1: 问题
`scripts/install-hooks.sh` 生成的 pre-commit 包装器把 3 个运行时日志写进 `.claude/`（pre-commit-failures.log / gate-soft-warnings.log / last-precommit-success）。`.claude/` 是 Claude Code 专属目录，与工具中立原则冲突；Claude 退役后这些路径成为死重命名，且"门禁运行时产物"不该绑在某个 AI 客户端上。

## Q2: 范围
做：
- `scripts/install-hooks.sh`：3 处写入改 `<ROOT>/.synova/logs/…` 并 `mkdir -p`；头注同步
- 读取方同步（新路径优先，legacy `.claude/` 只读回落 + `::warning`）：`scripts/hooks/post-commit.sh`、`scripts/pre-commit-check.sh`、`scripts/workflow/loop-context.sh`、`scripts/control-tower/log-snapshot.sh`、`scripts/control-tower/gen-cto-health.py`、`scripts/project/pr-queue-scan.py`（噪声清单）、`scripts/check-fde-terms.sh`（白名单）、`dsh/plugins/synova-dashboards/lib/collect.js`（看板读取）
- `.gitignore` 增加 `.synova/logs/`
不做：
- 不改任何判据语义；不删 `.claude/bypass.log` 的既有路径（D735 双写不动）
- 不迁移历史文件（legacy 回落在，不需要搬）

## Q3: 验收
入口：`bash scripts/install-hooks.sh`（生成 .git/hooks/pre-commit）
处理：失败提交时写入 `.synova/logs/pre-commit-failures.log` + `gate-soft-warnings.log`，无论成败写 `last-precommit-success`
结果：`grep -rn 'ROOT/.claude/(pre-commit-failures|gate-soft-warnings|last-precommit-success)' scripts/` ⇒ 0 命中；旧路径无新写入

## 架构层: 不属五层业务（治理/工具链）

## Done 标准
- [x] 判据①：`grep -rn 'ROOT/\.claude/\(pre-commit-failures\|gate-soft-warnings\|last-precommit-success\)' scripts/` ⇒ 0 命中 verify: 贴原始计数
- [x] 功能测试：临时仓模拟失败提交 ⇒ 日志落 `.synova/logs/`，旧路径无写入 verify: 贴 ls/cat 输出
- [x] 幂等：`bash scripts/install-hooks.sh` 连续两次 rc=0 verify: 贴 rc
- [x] 读取方全部同步（含 `log-snapshot.sh` 这个先前漏掉的） verify: 贴 legacy 引用清单
- [x] ①d 0 失败、本地门禁唯一允许红＝①c verify: 贴输出
