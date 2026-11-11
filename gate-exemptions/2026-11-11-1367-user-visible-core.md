# review: #1367
# 豁免说明：W2 用户可见行为回归集接入核心门，按 CTO 评论 11616 一次性修改受信面并同步最小棘轮。
# 边界：仅核心 runner、配对门禁测试、完整性基线及登记件；tests/user-visible/** 不进入 trusted regex。
# 回滚：移除 user-visible 独立运行段和本批配对测试，并还原 FACE-TOTAL=215。
- scripts/ci/core-tests.sh — 新增无条件用户可见回归运行段并保持三态判据 — #1367
- tests/control-tower/core-tests.test.sh — 既有核心配对夹具同步用户可见必需对象 — #1367
- tests/control-tower/core-user-visible.test.sh — 新增用户可见核心接入的五项配对反例 — #1367
- scripts/control-tower/gate-integrity-baseline.txt — 新增一个密封配对测试后最小上调下界 — #1367
- docs/authority/DOCS-REGISTRY.yaml — 登记本次限定豁免及其授权边界 — #1367
- gate-exemptions/2026-11-11-1367-user-visible-core.md — 本次豁免文件随批自覆盖登记 — #1367
