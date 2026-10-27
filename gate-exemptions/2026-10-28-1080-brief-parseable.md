# gate-exemptions — #1072 check-brief-parseable 空参 fail-closed（裁 427 D3）

- scripts/workflow/check-brief-parseable.sh — 按裁 427 D3 区分「未传参」与「传空参」（BRIEF_ARG_EMPTY ⇒ exit 2，禁静默解析别的 brief） — 裁 427
- tests/control-tower/check-brief-parseable.test.sh — 三态自测（空参⇒2／未传参⇒回退／坏路径⇒现行为） — 裁 427
- tests/control-tower/brief-parseable.test.sh — 既有测试件随 rename/引用同步（不动断言语义） — 裁 427
- tests/control-tower/precommit-groups-injection.test.sh — 铺底分支 #1071 的受保护夹具（本支 stacked 含其 diff） — 裁 427
- scripts/pre-commit-check.sh — 铺底分支 #1071 的受保护门禁脚本（本支 stacked 含其 diff） — 裁 427
- gate-exemptions/2026-10-28-1080-brief-parseable.md — 本豁免文件自身受保护，按 #623 加同 diff 自覆盖行 — 裁 427
- docs/authority/DOCS-REGISTRY.yaml — D2 登记门禁要求登记本豁免文件（DOC-0309），仅追加一条 — 裁 427
