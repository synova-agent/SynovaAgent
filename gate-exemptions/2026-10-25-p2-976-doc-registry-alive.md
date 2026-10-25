# 豁免 · #976 DOCS-REGISTRY 存活判据（active 条目 path 必须存在）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**裁 399**
> （CTO 开工令：第 1 件 #976 轻量档；K3 审计 #974 D2 实测 24 条 `status=active` 的 path 已不在树内）。
> 提报卡：Issue #976；判据两态（造 active 但路径不存在 ⇒ 红 ／ 真实仓 ⇒ 绿）＋改坏必红原始输出见配对测试。
> 逐行三段式（`- <路径> — <理由> — <裁定号>`），逐条判定、不整文件生效；理由内不含破折号。
> 本件覆盖本批 diff 命中的全部受保护路径（`scripts/doc-system/**`、`tests/doc-system/**`、
> `docs/authority/DOCS-REGISTRY.yaml`、`gate-exemptions/**`），含本文件自身的自覆盖行。

- scripts/doc-system/doc-registry-gate.sh — 修改：新增存活判据（status 为 active 且 path 不在树内则逐条点名并 exit 1；active 无 path 字段同红；status 字段解析为 0 则 fail-closed exit 2），既有未登记与重号判据一字不动 — 裁 399
- tests/doc-system/doc-registry-gate.test.sh — 修改：新增 K 段 17 条配对判据（两态闭环／无 path 字段／通配路径／0 条 status 字段／存量真实仓／变异实现判别力自证），既有夹具仅补 status 字段 — 裁 399
- docs/authority/DOCS-REGISTRY.yaml — 修改：24 条 active 存量降 archived（只改 status 行、不删条目不改 id 与 note）并追加 1 条登记本豁免件（DOC-0273） — 裁 399
- gate-exemptions/2026-10-25-p2-976-doc-registry-alive.md — 自覆盖：本文件自身即受保护路径 gate-exemptions/** 的新增件，须逐条豁免含自覆盖行 — 裁 399
