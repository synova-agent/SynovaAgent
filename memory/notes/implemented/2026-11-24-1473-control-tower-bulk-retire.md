# 2026-11-24 · #1473 控制塔全量成批退役

## 现状（施工前，gitea/main @ 8fe8cdd72）

- #1472 只退役了 `scripts/hooks/hook-enforce-loop.sh`，属四文件试点；#1473 要求按全量口径清出控制塔孤儿实现、专属测试与失效入口。
- 本批对 `scripts/control-tower/**`、`tests/control-tower/**`、`scripts/hooks/**`、`scripts/workflow/**` 做完整筛选：以最新 gitea/main 的调用链为准，测试引用不构成保留理由；历史文档与旧 GATE-INVENTORY 提及不构成消费者。
- 保留红线：core-gates / core-tests、契约与用户可见行为测试、现役 pre-commit / pre-push / commit-msg、Secrets、部署备份恢复、runner、`scripts/audit/**`，以及有真实生产或明确手动诊断消费者的工具。

## 决定

- 按 Issue #1473 的判定规则成批退役无真实消费者的实现与专属测试；逐项删除/扣留证据见 PR 评论。
- 代码历史由 git 保留，不另开 process-archive PR；失效基线登记与失效入口同批移除。
- 不新增门禁、台账或报告文件；claim 用 scaffold；必要豁免按既有规则。

## 依据

- Issue #1473 判定规则与范围；Issue #1471 盘点与复核勘误（仅作候选来源，逐项在最新 gitea/main 重核）。
- `scripts/control-tower/AGENTS.md`、`LOOP.md`、根 `AGENTS.md` §12、现役 Skills/presets 的调用点；`scripts/control-tower/sealed-tests.sh` 与 `gate-integrity-baseline.txt` 的棘轮口径。
- 删除/扣留逐项证据在 PR 评论；本 Note 不复制完整清单。

## 生效时点

- 合并本 PR 后生效；回退 = 单 PR revert（代码历史与 git 记录保留）。
