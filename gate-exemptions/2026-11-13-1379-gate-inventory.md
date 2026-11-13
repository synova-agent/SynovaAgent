# review: #1379
# 豁免说明：第一阶段只交付历史门禁残余盘点清单及必要登记；不新增门禁、不删除任何对象。
# 边界：仅盘点文档、必要登记、经批准的 core-gates 兼容与本豁免；不碰 core-gates、core runner、契约／用户可见测试、scripts/audit/**。
# 回滚：移除本批新增清单、豁免、登记条目与 core-gates 兼容行；不改任何既有历史条目。
- docs/authority/DOCS-REGISTRY.yaml — 登记 #1379 盘点清单与本豁免的边界 — #1379
- docs/authority/GATE-INVENTORY.yaml — 经用户批准仅补登现存 gitea/core-gates；不新增门禁、不改退役状态 — #1379
- scripts/control-tower/gen-gate-meta.sh — 经用户批准仅在 WF_IDS 兼容现存 gitea/core-gates，并同步两处注释 — #1379
- tests/control-tower/gen-gate-meta.test.sh — 配对断言改为枚举实际 workflow／run_by 数并修正 N2 作用域夹具，覆盖 core-gates 兼容 — #1379
- gate-exemptions/2026-11-13-1379-gate-inventory.md — 本次豁免文件随批自覆盖登记 — #1379
