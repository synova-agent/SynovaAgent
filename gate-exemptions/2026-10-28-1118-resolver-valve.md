# review: #1118
# gate-exemptions — #1118（#1115 后续）· resolve-ci-base legacy 别名安全阀 ＋ 配对测试修正

- scripts/control-tower/resolve-ci-base.sh — case 拆 main 与 local-main 两臂（local-main 标 LEGACY_ALIAS），新增 ④b 安全阀：候选 local-main 引用与 canonical 同 SHA 才放行，分叉或领先 exit 2；并修正 #1115 留下的头注错字（新鲜度断言的跟踪引用名） — #1118
- tests/control-tower/resolve-ci-base.test.sh — 修存量用例 3/4/5 的断言与物化路径到 gitea/main，补用例 9 至 14b（同 SHA、祖先容忍告警、分叉、领先、非别名不误伤、两条改坏即红） — #1118
- gate-exemptions/2026-10-28-1118-resolver-valve.md — 本豁免文件自身在 gate-exemptions 保护面内，按 623 加同 diff 自覆盖行 — #1118
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-1118；R1 口径 id = DOC-<Issue#>），仅追加一条条目、不改既有项 — #1118
