# 豁免 · #911 claim-v2 恢复「默认开」（四处同源 ＋ CI 显式注入）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**Issue #911**
> （CTO 裁 318／319；创始人 2026-10-24 派单「第 1 件」）。逐行三段式（`- <路径> — <理由> — #911`），
> 不整文件生效；理由内不含破折号。本件覆盖本卡 diff 命中的**全部**受保护路径
> （`scripts/**`、`.gitea/workflows/**`、`tests/control-tower/**`、`docs/authority/DOCS-REGISTRY.yaml`、
> `gate-exemptions/**`），含本文件自身的自覆盖行。

- scripts/control-tower/claim_store.py — 修改：claim_v2_enabled 未设 ⇒ True（恢复裁 1423）＋docstring 三处口径对齐；唯一回滚点＝显式 0/off/false/no/n — #911
- scripts/pre-commit-check.sh — 修改：组 6 的 case 增空值分支 ⇒ 1（与 claim_store 单源）＋ 组 6/12 两处注释改「默认开」 — #911
- scripts/check-verifiable-done.sh — 修改：同一 case 的空值分支补齐 ⇒ 1（漏改则 Done 判据默认退回 legacy，与单源分裂） — #911
- scripts/workflow/resolve-commit-brief.sh — 修改：同一 case 的空值分支补齐 ⇒ 1（漏改则 pre-commit 的 BRIEF 解析永远拿不到 claim，组 6/12 的 claim 分支默认不可达） — #911
- .gitea/workflows/local-gates.yml — 修改：步① 显式注入 SYNO_CLAIM_V2=1 并 echo 生效值（防未来回归；回滚＝显式 0），C3 证据来源 — #911
- tests/control-tower/claim_store.test.sh — 修改：feature flag 判据由「默认关」改为两态矩阵（未设/truthy ⇒ on；0/off/false/no/n ⇒ off） — #911
- tests/control-tower/claim-identity-v2.test.py — 修改：a1b 断言默认开＋两态矩阵；b4/c2 改显式 0（回滚态语义不变）；新增 c2b（未设等价于开） — #911
- tests/control-tower/precommit-claim-wiring.test.sh — 修改：边界断言默认开；新增四处同源静态断言与「未设 ⇒ claim 分支实际执行」端到端行为断言 — #911
- docs/authority/DOCS-REGISTRY.yaml — 修改：登记本豁免件（DOC-0245），登记门禁要求新文档入台账 — #911
- gate-exemptions/2026-10-24-p4-911-claim-v2-default-on.md — 本豁免文件自身（受保护目录自我保护，需自覆盖） — #911
