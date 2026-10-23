# 豁免 · #917 拍 1：GitHub 退 architecture job／Gitea 进 ①f（一进一出，裁 300/335）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**裁 335**
> （#917 拍 1 批准：退 `architecture` ＋ 加 ①f；一进一出按裁 300）。提报卡：Issue #917；实施：PR-B。
> 逐行三段式（`- <路径> — <理由> — <裁定号>`），不整文件生效；理由内不含破折号。本件覆盖本卡 diff 命中的
> **全部**受保护路径（`.gitea/workflows/**`、`.github/workflows/**`、`tests/control-tower/**`、
> `docs/authority/DOCS-REGISTRY.yaml`、`gate-exemptions/**`），含本文件自身的自覆盖行。

- .github/workflows/ci.yml — 修改：退役 architecture job（15→14）＋ all-checks-passed.needs 同步删一项（真重复：Gitea ② 同脚本同 SYNO_CI=1） — 裁 335
- .gitea/workflows/local-gates.yml — 修改：新增 ①f（tsc --noEmit ＋ check:iron-laws 去重执行），步序末尾避免 CI-S id 漂移 — 裁 335
- tests/control-tower/quality-standard.test.sh — 修改：盘点断言常量随新增 CI 步同步（S10/K37 → S11/R38），判据未改 — 裁 335
- docs/authority/DOCS-REGISTRY.yaml — 修改：登记本豁免件（DOC-0253），登记门禁要求新文档入台账 — 裁 335
- gate-exemptions/2026-10-24-p4-917-retire-architecture.md — 本豁免文件自身（受保护目录自我保护，需自覆盖） — 裁 335
