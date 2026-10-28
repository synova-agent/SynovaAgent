# review: #1122
# gate-exemptions — #1122 Step 1 · 总闸最小可跑版（G2 遥测 / G6 归一 / G10 同形字）

- scripts/control-tower/verify-governance.sh — 新建一键验收总闸：G2/G6/G10 三项逐项 PASS/FAIL/SKIP ＋ 末行 GOVERNANCE: x/y PASS，判不了 exit 2，只读不写仓库 — #1122
- tests/control-tower/verify-governance.test.sh — 同批新建配对测试（T0 至 T16，53 断言：3/3 PASS、遥测缺失 SKIP、注入 128 归判据故障、0/1/2 透传、改坏即红、--days 边界、坏行计数、判不了 exit 2、只读与注入缝、WIRING 自洽） — #1122
- gate-exemptions/2026-10-28-1122-verify-governance.md — 本豁免文件自身在 gate-exemptions/** 保护面内，按 #623 加同 diff 自覆盖行 — #1122
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-0325；merge gitea/main 后让位 #1115 占用的 0324），仅追加一条条目 — #1122
