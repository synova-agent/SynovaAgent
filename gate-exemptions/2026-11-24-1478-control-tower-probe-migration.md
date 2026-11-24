# review: #1479
# 豁免登记 — Issue #1478 控制塔第二批（元流程检查删除＋四项判据迁移）；PR #1479（基线 20bb9892c）
#
# 变更性质：A 删除 probe-criterion-precheck；B 把 bundle/content-exile/m6-determinism/ontology-values
# 的有效产品判据先迁入标准测试，再删旧 probe 与专属旧测试；C 现役入口/看板全部保留。
# 不新增门禁、不改产品代码/公开契约；共享 oracle 放 tests/support/**。
#
# 逐文件豁免（三段式：路径 — 理由（≥10 字） — 裁定号）：
- scripts/control-tower/** — #1478 元流程自检删除＋四项 probe 迁移后退役 — #1478
- tests/control-tower/** — #1478 旧 probe 专属测试随 probe 退役及基线/登记同步 — #1478
- gate-exemptions/2026-11-24-1478-control-tower-probe-migration.md — 本豁免件自身在 diff 内（自覆盖行） — #1478
