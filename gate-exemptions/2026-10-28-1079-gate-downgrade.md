# gate-exemptions — #1071 组级降级 fixture 语义重写＋死码清理（裁 427 D2+D4）

- tests/control-tower/precommit-groups-injection.test.sh — 按裁 427 D2 重写降级语义断言：降级只摘计数、点名恒在；rc 期望按触发组细分（D1148 seg1 触发闸②=组12 ⇒ rc=1，禁期望 0） — 裁 427
- scripts/pre-commit-check.sh — 按裁 427 D4 删 inert `_downgraded()` 并简化 CI-strict 分支（行为等价，零语义变更） — 裁 427
- gate-exemptions/2026-10-28-1079-gate-downgrade.md — 本豁免文件自身受保护，按 #623 加同 diff 自覆盖行 — 裁 427
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-0308），仅追加一条 — 裁 427
