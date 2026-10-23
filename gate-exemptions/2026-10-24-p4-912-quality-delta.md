# 豁免 · #912 批 1 质量增量闸（check-quality-delta · G1/G3/G4）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**裁 330**
> （#912 批 1 批准 ＋ A1/A2/A3 三条必改）｜提报卡：Issue #912；实施：PR-A。
> 逐行三段式（`- <路径> — <理由> — <裁定号>`），不整文件生效；理由内不含破折号。
> 本件覆盖本卡 diff 命中的**全部**受保护路径（`scripts/**`、`tests/control-tower/**`、
> `.gitea/workflows/**`、`docs/authority/DOCS-REGISTRY.yaml`、`gate-exemptions/**`），含本文件自身的自覆盖行。

- scripts/control-tower/check-quality-delta.py — 新建：G1/G3/G4 变更集闸（三态 0/1/2；A1 空集 SKIP；A2 不判散文；A3 白名单文件化） — 裁 330
- scripts/pre-commit-check.sh — 修改：追加质量增量闸附加块（不计组号；SYNO_QUALITY_DELTA=0 回滚） — 裁 330
- .gitea/workflows/local-gates.yml — 修改：新增具名步 ①e（同脚本同 base 口径；三态 `|| exit $?` 原样透传） — 裁 330
- tests/control-tower/check-quality-delta.test.sh — 新建：配对判据测试（T1–T12；含 A1 空集、坏 base、棘轮、变异体改坏必红） — 裁 330
- tests/control-tower/quality-standard.test.sh — 修改：#912 新增能力件/步骤后，断言常量同步（rows=3→4、covered X5/S9/K33/R35→X6/S10/K34/R37；判据未改） — 裁 330
- tests/control-tower/quality-baseline.test.sh — 修改：同上（REGISTRY rows=3→4；真树 orphans 总数 32→33 的格式断言；判据未改） — 裁 330
- tests/control-tower/AGENTS.md — 修改：加 1 行报备（新测试件＋WIRE 口径），测试域“新增测试须报备”要求 — 裁 330
- docs/authority/DOCS-REGISTRY.yaml — 修改：登记本豁免件（DOC-0247），登记门禁要求新文档入台账 — 裁 330
- gate-exemptions/2026-10-24-p4-912-quality-delta.md — 本豁免文件自身（受保护目录自我保护，需自覆盖） — 裁 330
