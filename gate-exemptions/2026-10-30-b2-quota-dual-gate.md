# review: #1147
任务: "#1147"

# B2 配额双闸（#1147 余项）受保护路径豁免 — 裁定号 #1147

本批次只加配额双闸（gen-gate-meta --quota 三桶计数 ＋ --emit 失败 exit 2 ＋ verify-governance G11），
不改任何既有判据语义；下列 6 行逐条覆盖 diff 内全部受保护路径（4 件代码/测试 ＋ 本文件自覆盖 ＋ DOCS-REGISTRY 自登记）。

- scripts/control-tower/gen-gate-meta.sh — 批次 B2 新增 quota 三桶计数与 emit 失败降级（三态 0/1/2） — #1147
- scripts/control-tower/verify-governance.sh — 批次 B2 新增 G11 配额双闸并同步头契约与四道判据 — #1147
- tests/control-tower/gen-gate-meta.test.sh — 批次 B2 扩充夹具覆盖 quota 三桶 emit 降级与改坏即红 — #1147
- tests/control-tower/verify-governance.test.sh — 批次 B2 扩充夹具覆盖 G11 三态与改坏即红 — #1147
- gate-exemptions/2026-10-30-b2-quota-dual-gate.md — 本豁免文件自身按 623 口径需同 diff 自覆盖 — #1147
- docs/authority/DOCS-REGISTRY.yaml — 批次 B2 纯追加 DOC-1147-02 登记本豁免文件 — #1147
