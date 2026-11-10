# review: #1319
# 豁免说明：T2b 受信事件最小改造需修改四个既有受保护实现文件，并同步登记本豁免。
# 授权：#1319 T2b 任务放行；平台探针 run 3830 已实证 base workflow、默认 base checkout 与 pull_request_target context。
# 边界：仅改触发事件、显式 PR head SHA、事件映射及配对 harness；不改其他核心判据，不执行 T3。
# 回滚：关闭本改造 PR 或 revert 该小 PR；main 保持无必需 context，直到重新完成正常 PR 与核心恒绿反例。
- .gitea/workflows/core-gates.yml — 改用受信 pull_request_target 并显式检出 PR head SHA — #1319
- scripts/ci/core-tests.sh — 事件环境校验接受 pull_request_target 并映射为既有 pull-request 判据 — #1319
- tests/control-tower/core-tests.test.sh — 增加 pull_request_target 正常预检配对验证 — #1319
- tests/control-tower/core-gates-workflow.test.sh — 增加 head 伪造 workflow 不执行及 base 预检 rc=2 反例 — #1319
- docs/authority/DOCS-REGISTRY.yaml — 仅登记本限定豁免件 — #1319
- gate-exemptions/2026-11-10-1319-t2b-trusted-target.md — 本豁免件自身随批自覆盖 — #1319
