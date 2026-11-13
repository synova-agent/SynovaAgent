# 决策: #1378 门禁文档一致性最小收口

状态: proposed
日期: 2026-11-13

## 现状

部分现行文档、技能和活跃 K3 预设仍把旧 `local-gates` 当作权威合并门，把本地 pre-commit 描述为硬阻断，或把 K3 独立审计、固定终审和 git 跟踪审计报告当作所有任务的必经流程。这与 #1378 的创始人最新口径冲突。

## 决定

只修正现行入口的冲突表述：Gitea `core-gates / core (pull_request_target)` 是唯一权威合并门；pre-commit 是本地软提示；旧 `local-gates` 仅手动；独立审计仅由创始人／CTO／任务明确要求触发，结论写任务卡／Issue／PR 评论，不生成审计报告文件。保留禁止自审、不得修改 `scripts/audit/**`、被审方不得编写审计标准的红线。同步技能镜像与活跃 K3 预设，不改历史材料、工作流、分支保护、产品代码或核心 runner。

## 依据

- #1378 Issue 全文及创始人最新裁定。
- 根 `AGENTS.md` §8 已确认的核心门事实；`.gitea/workflows/local-gates.yml` 仅 `workflow_dispatch` 的现有实物。
- 技能单一事实源为 `.synova/skills`，既有同步入口为 `scripts/workflow/sync-dsh-skills.sh`。

## 生效时点

本 Note 随 #1378 PR 留痕；CTO 验收并合并后生效。历史材料保持原样，仅作历史参考。
