# review: docs/synova/reviews/1394.hooks-and-gatesplit.json
# 豁免说明：#1394 已明确批准 post-commit 外部审计默认关闭及本批活性指令清扫；#1400 同批修正分工文档。
# 边界：不碰 core-gates、core-tests.sh、tests/user-visible/**、tests/contract/**、scripts/audit/**，不新增门禁，不删除 external-auditor.sh。
# 回滚：恢复 post-commit 默认调用、配对测试、安装说明、豁免登记和本豁免。
- scripts/hooks/post-commit.sh — 按任务将外部审计改为显式启用并默认关闭 — #1394
- scripts/workflow/install-post-commit.sh — 仅同步默认关闭说明而不改安装逻辑 — #1394
- tests/control-tower/post-commit.test.sh — 增加默认关闭与显式启用真实入口回归 — #1394
- tests/control-tower/install-post-commit.test.sh — 补齐安装器真实入口与幂等配对回归 — #1394
- docs/authority/DOCS-REGISTRY.yaml — 登记本批限定豁免及其边界 — #1394
- gate-exemptions/2026-11-16-1394-hooks-and-gatesplit.md — 本次豁免文件随批自覆盖登记 — #1394
