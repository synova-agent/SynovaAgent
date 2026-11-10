# review: #1319
# 豁免说明：旧 local-gates 触发退役需修改受保护工作流，并同步登记本豁免。
# 授权：#1319 T3 任务放行；G2 已由 #1319 评论 11575 收口，main 唯一必需 context 为 core-gates / core (pull_request_target)。
# 边界：仅移除旧 push/pull_request 自动触发，保留 workflow_dispatch 与全部旧步骤；不改新门、分支保护或 GitHub，不清理历史文件。
# 回滚：关闭 T3 PR 或 revert 该小 PR 由 CTO 修复；不得恢复旧必需 context。
- .gitea/workflows/local-gates.yml — 仅将自动触发退役为 workflow_dispatch 手动入口，旧步骤不变 — #1319
- docs/authority/DOCS-REGISTRY.yaml — 仅登记本 T3 限定豁免件 — #1319
- gate-exemptions/2026-11-09-1319-g2-old-trigger-retire.md — 本豁免件自身随批自覆盖 — #1319
