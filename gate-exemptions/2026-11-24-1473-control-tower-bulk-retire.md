# review: #1474
# 豁免登记 — Issue #1473 控制塔全量成批退役；PR #1474（基线 8fe8cdd72）
#
# 变更性质：按 #1473 判定规则，成批退役无真实消费者的控制塔孤儿实现、专属测试与失效入口。
# 测试引用不构成保留理由；历史文档／旧 GATE-INVENTORY 提及不构成消费者。
# 保留红线：core-gates / core-tests、契约与用户可见行为测试、现役 pre-commit / pre-push / commit-msg、
#   Secrets、部署备份恢复、runner、scripts/audit/**，以及有真实生产或明确手动诊断消费者的工具。
# 本批不新增门禁/台账；claim 用 scaffold；代码历史由 git 保留。
#
# 逐文件豁免（三段式：路径 — 理由（≥10 字） — 裁定号）：
- scripts/control-tower/** — #1473 控制塔孤儿实现与失效基线/入口成批退役 — #1473
- scripts/check-fde-terms.sh — #1473 去除已退役 check-dataflow-alignment 的失效 path 引用 — #1473
- scripts/workflow/** — #1473 失效 workflow 门禁脚本成批退役 — #1473
- scripts/hooks/** — #1473 失效钩子成批退役 — #1473
- tests/control-tower/** — #1473 上述实现对应的专属测试同批退役及混测去引用 — #1473
- gate-exemptions/2026-11-24-1473-control-tower-bulk-retire.md — 本豁免件自身在 diff 内（自覆盖行） — #1473
