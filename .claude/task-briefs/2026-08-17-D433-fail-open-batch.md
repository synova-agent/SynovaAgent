# Task Brief: D433: 控制塔 fail-open 批量修复（K3 终审 P1 一次性补齐）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制塔脚本领地) | 上游: K3 终审报告 audit/k3-final-20260817 §三 P1

## Q0: 定位
K3 终审判定 8 个 CP 分支各带 fail-open 残留（门禁"该拦没拦/该报没报"）。本任务一次性批量补齐 A 类（fail-open）+ B 类（熔断漏报）+ C 类（CI 兜底 + 契约对齐）共 8 处，避免逐个挤牙膏。

## Q1: 调研
- K3 报告 §三 逐项附 file:line：P1-3(U7 git-fail exit0)、P1-4(U1 base不可解析 exit0)、P1-5(U2 无写集表 exit0)、P1-6(U5b 子目录.env 漏)、P2-1(ACK 未写日志)、P1-2补(possible-bypass 不计熔断)、U7c(CI 无控制塔测试 job)、P1-7(sop-gate 契约头注入缝声称不存在)。
- 铁律 11(降级显式)/M1(fail-open 根)。修法=exit 0→2/1 + grep 模式 + CI job + 契约对齐。

## Q2: 范围
做什么：
- scripts/control-tower/ct-test-gate.sh
- scripts/control-tower/check-bypass-log.sh
- scripts/workflow/check-dev-doc-write-set.sh
- scripts/check-secrets.sh
- scripts/pre-commit-check.sh
- scripts/workflow/sop-gate.sh
- .github/workflows/ci.yml
- tests/control-tower/write-set-check.test.sh
- .claude/task-briefs/2026-08-17-D433-fail-open-batch.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：各门禁脚本 / pre-commit 13 组 / CI。
处理：8 处 fail-open 改 fail-closed（exit 2/1）+ possible-bypass 入熔断 + CI 控制塔测试 job + 契约对齐。
结果：6 个配对测试全绿；git 不可用/base 不可解析/无写集表 均不再"当通过"。

## 架构层: 控制塔/工程基建（非 L1-L5 产品层）
#CRITERIA: D

## Done 标准
- [x] 8 处修复 + 6 配对测试全绿 — verify: for t in ct-test-gate check-bypass-log write-set-check secrets-env-exempt sop-gate writeset-c6-gatekeeper; do bash tests/control-tower/$t.test.sh || exit 1; done
- [x] 语法通过 — verify: bash -n scripts/pre-commit-check.sh scripts/control-tower/ct-test-gate.sh
