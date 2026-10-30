# review: #1181
# gate-exemptions — 门禁数据修复：删除 sealed 隔离台账陈旧条目（受保护面：scripts/control-tower/**）

- scripts/control-tower/gate-integrity-baseline.txt — ① 删除指向已改名文件（brief-parseable.test.sh）的陈旧隔离条目（台账判据 b「须删条目」）；② FACE-TOTAL 197→204（scan=209，余量 5，落 3~5 口径；主树新增夹具未上调下界 ⇒ 撞 SLACK-CAP=10，显式上调留痕）— #1158
- gate-exemptions/2026-10-30-gate-sealed-stale.md — 本豁免文件自身在 gate-exemptions/** 保护面内，按 #623 同 diff 自覆盖 — #1158
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-0324），仅追加一条条目 — #1158
