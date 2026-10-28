# gate-exemptions — #1108 W10 · Unicode 同形字分级门禁（A/B/C 阻断 · D 仅提醒 · 只查 diff）

- scripts/control-tower/check-unicode-confusable.py — 新建同形字分级扫描器（A/B/C 档 P0 阻断、D 档仅提醒、只判 diff 新增行、三态 0/1/2、--json、--list-legacy、--selfcheck） — #1108
- tests/control-tower/check-unicode-confusable.test.sh — 同批新建配对测试（T0–T18，含 M-11 西里尔冒充标识符、M-12 存量不阻断、B/C 档、解码边界、改坏即红、WIRING 记账自洽） — #1108
- gate-exemptions/2026-10-28-1108-unicode-confusable.md — 本豁免文件自身在 gate-exemptions/** 保护面内，按 #623 加同 diff 自覆盖行 — #1108
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-0323），仅追加一条条目 — #1108
