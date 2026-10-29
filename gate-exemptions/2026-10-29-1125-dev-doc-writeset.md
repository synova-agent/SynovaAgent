# review: #1137
# gate-exemptions — #1125 写集门禁补删除项语义（D 进变更集）

- scripts/workflow/check-dev-doc-write-set.sh — 三处变更集补 D 并改带状态判（声明删除 ⇔ D 出现；声明修改仍须 A/C/M/R；git 不可用 ⇒ exit 2） — #1125
- tests/control-tower/check-dev-doc-write-set.test.sh — 同批补 #1125 真 git 夹具：声明删除加 git mv ⇒ 0；去掉 D 的改坏版 ⇒ 1；纯删除 ⇒ 0；声明修改加零变更 ⇒ 1；git 不可用 ⇒ 2 — #1125
- gate-exemptions/2026-10-29-1125-dev-doc-writeset.md — 本豁免文件自身在 gate-exemptions 通配保护面内，按 #623 加同 diff 自覆盖行 — #1125
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-1125），仅追加一条条目 — #1125
