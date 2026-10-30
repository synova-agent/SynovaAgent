# Task Brief — #1141 / #1152 quality-baseline 断言交叉核对

#CRITERIA: D

## Q1: 问题
`tests/control-tower/quality-baseline.test.sh` 把 `rows=26`、`orphans` 分母 `41` 写成字面量，登记表每次增长就红（已连续两轮漂移）。上一轮"从自身输出动态取值"的补丁属同义反复，被退回。

## Q2: 范围
做：
- tests/control-tower/quality-baseline.test.sh
- gate-exemptions/2026-10-30-1141-quality-baseline-constants.md
- docs/authority/DOCS-REGISTRY.yaml
- .claude/task-briefs/2026-10-29-1141-quality-baseline-constants.md
- .claude/claims/1141.yaml
- memory/notes/proposed/2026-10-29-1141-quality-baseline-constants.md
不做：
- 不改 scripts/control-tower/quality-baseline.py
- 不改 docs/authority/WIRING-REGISTRY.yaml
- 不改 CI workflow

## Q3: 验收
入口：bash tests/control-tower/quality-baseline.test.sh
处理：真件输出条数与独立计数交叉核对（capability 行数、classification 条目数）
结果：TEST-OK 0 失败；改坏独立计数 ⇒ 断言必红

## 架构层: 不属五层业务（治理/测试断言）

## Done 标准
- [x] 测试 0 失败 verify: `bash tests/control-tower/quality-baseline.test.sh 2>&1 | tail -1`
- [x] 交叉核对承重（改坏独立计数 ⇒ 红） verify: 见 PR 正文前后态
- [x] 判据逻辑零改动（只动测试与载体） verify: `git diff --numstat gitea/main -- scripts/control-tower/quality-baseline.py`
- [x] 受保护路径 0 失败 verify: `bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/main --root . 2>&1 | tail -1`
