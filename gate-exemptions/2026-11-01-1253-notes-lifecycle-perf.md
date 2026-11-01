# review: #1253
<!-- 任务: "#1253" -->
# 豁免说明：#1253（P0）notes 生命周期门禁性能修复：逐文件 spawn → 单进程解析，并补 timeout / 缺 python 的显式降级。
# 本批只改实现与降级路径，**不改僵尸判定口径**（D# 提取／status 白名单 impl_done|spec_done 一字未动）。
- scripts/control-tower/check-notes-lifecycle.sh — 单进程解析替代逐文件 spawn 并补超时与缺python显式降级 — #1253
- tests/control-tower/check-notes-lifecycle.test.sh — 配对测试新增性能回归与超时降级两态并保留原18例 — #1253
- gate-exemptions/2026-11-01-1253-notes-lifecycle-perf.md — 本豁免件自身属受保护目录变更故随批自覆盖 — #1253
- docs/authority/DOCS-REGISTRY.yaml — 为本批豁免件补 DOC-1253 登记行以闭合 D782 D2 登记门禁 — #1253
