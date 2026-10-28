# review: #1109
# gate-exemptions — #1108 W10 · Unicode 同形字分级门禁（A/B/C 阻断 · D 仅提醒 · 只查 diff）

- scripts/control-tower/check-unicode-confusable.py — 新建同形字分级扫描器（A/B/C 档 P0 阻断、D 档仅提醒、只判 diff 新增行、三态 0/1/2、--json、--list-legacy、--selfcheck） — #1108
- tests/control-tower/check-unicode-confusable.test.sh — 同批新建配对测试（T0 至 T18，含 M-11 西里尔冒充标识符、M-12 存量不阻断、B/C 档、解码边界、改坏即红、WIRING 记账自洽） — #1108
- scripts/pre-commit-check.sh — 在「附: 治理面自检」段内接入新扫描器：A/B/C 走 hard_check（本地软提示、CI strict 硬阻断）、D 档只 echo 提醒；判不了按 exit 2 计违规 — #1108
- .gitea/workflows/local-gates.yml — 文件末尾追加「⑥ W10 Unicode 同形字分级门禁」step（输出 test_count=N、A/B/C 在本步阻断、`exit "$_UNI_RC"` 原样透传三态），不改既有 step 顺序与语义 — #1108
- gate-exemptions/2026-10-28-1108-unicode-confusable.md — 本豁免文件自身在 gate-exemptions/** 保护面内，按 #623 加同 diff 自覆盖行 — #1108
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-0323），仅追加一条条目 — #1108
