# Task Brief: #1460 checker-review.sh SIGPIPE 假红修复

> 卡号 #1460 | 触发: PR #1456 合并后 main 的 Checker Review 红 | 基线 main 990c1b48

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔 CI 验证器 `scripts/checker-review.sh`（maker/checker 分离的 checker 侧）。
### b) 文件审计
`:32` 唯一 `| head` 管道：`echo "$CHANGED" | head -20`；变更集 638 件时 `head` 提前退出 ⇒ SIGPIPE(141) ⇒ CI `-eo pipefail` 假红。
### c) 决策
改无管道截断（`awk "NR<=20" <<<`），不动任何判据。

## Q1: 调研 — 业界最佳实践 / memory 历史教训
参考 D1214（check-required-contexts SIGPIPE 假红硬化）同型教训：管道 + 提前退出 = 信号竞态。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/checker-review.sh

不做什么：
- 不改 scripts/pre-commit-check.sh
- 不改 .github/workflows/ci.yml

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI job `Checker Review (maker/checker)` 的 `bash scripts/checker-review.sh`
处理：大变更集（638 件）下打印变更清单不再触发 SIGPIPE
结果：main 上该 job 转绿；`--ci-reds` 未登记失败清零

## 架构层: 基础设施（控制塔 CI 验证器）

## Done 标准
- [x] verify: bash -eo pipefail scripts/checker-review.sh 期望 rc=0
- [x] verify: bash -x -eo pipefail scripts/checker-review.sh 期望 rc=0
- [x] verify: bash scripts/pre-commit-check.sh 期望 13 组通过
- [x] verify: bash -c 'grep -c "| head" scripts/checker-review.sh' 期望 0
