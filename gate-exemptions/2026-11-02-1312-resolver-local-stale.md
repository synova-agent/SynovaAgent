# review: #1312

> 一次裁定：`resolve-ci-base.sh` 多远端时**本地分支不得作对账基**（一任务一 worktree ⇒ 本地 main 天然陈旧 ⇒ `main..HEAD` 混入他线提交）。
> 依据：2026-11-02 连续 5 个 session 被 D331 误拦；`派单件/2026-11-02-方案-D331-base陈旧误拦.md`。
> 原则（借 DSH）：判定用的基必须显式、可验证、带锚；不可信 ⇒ fail-closed，不回落到环境量。

- scripts/control-tower/resolve-ci-base.sh — 多远端：本地分支让位于远端跟踪；无远端跟踪 ⇒ exit 2；非分支（sha/tag）原样保留 — #1312
- tests/control-tower/resolve-ci-base.test.sh — 新增 T13/T14/T15（多远端陈旧/无跟踪/sha 逃生缝） — #1312
- gate-exemptions/2026-11-02-1312-resolver-local-stale.md — 本豁免件自身属受保护路径变更，故随批自覆盖声明以保证证据链闭合 — #1312
- docs/authority/DOCS-REGISTRY.yaml — 登记 DOC-1312（D2 登记门禁） — #1312
- .claude/claims/1312.yaml — 本批认领单属受保护路径，需随批豁免以保证认领链闭合 — #1312
- memory/notes/proposed/2026-11-02-1312-resolver-local-stale.md — 四态 Note（铁律 49） — #1312
