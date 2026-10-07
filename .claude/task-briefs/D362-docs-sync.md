# D362 文档拉平

## Q0: 定位
把本地全部未提交文档（审计报告/coordination/权威文档/dev doc/html/仪表盘）与品牌替换改动锁进 git，拉平到 main，开分支合流走 PR。

## Q1: 调研
Mac 已用 PR 工作流（MULTI-MACHINE-PR-WORKFLOW.md）把 D334/D335 合并进 main；本地 feat/prompt-architecture 落后 main 8 提交。文档归档按 GIT-SYNC-PLAN.md（html 是交付物、企业数据不进 git）。

## Q2: 范围 — 文档拉平 + 品牌替换

做什么：
- src/config.ts
- src/services/update-checker.ts
- scripts/setup/configure-machine.sh
- scripts/control-tower/gen-task-board.py
- tests/control-tower/gen-task-board.test.py
- tests/control-tower/hooks-install.test.sh
- scripts/check-file-driven.sh
- scripts/control-tower/synova-commit

不做什么：
- .env
- data/
- release/
- .claude/bypass.log
- .claude/settings.json

## Q3: 验收
git status 干净（仅剩被忽略的运行时产物）→ 拉平 main → feat/docs-sync 分支 cherry-pick + 文档索引 + HARNESS-ONBOARDING.md → push + PR 链接。

## 本任务在哪一层:
L0 工程/文档（不涉及五层架构代码变更，纯归档与合并）。

## Done 标准
- [ ] DS1: git show HEAD --stat 含 700+ 文档，无 release/、.env、*.log 混入
- [ ] DS2: git status --short 仅剩被忽略的运行时产物（bypass.log/settings.json 等）
- [ ] DS3: main 已 pull --ff-only + feat/docs-sync 已 push + PR 链接生成
