# 2026-11-24 · #1478 控制塔第二批：元流程检查删除＋四项判据迁移

## 现状（施工前，gitea/main @ 20bb9892c）

- #1476 已合并；控制塔仍存四类大体量探针：probe-bundle-content、probe-content-exile、probe-m6-determinism、probe-ontology-values，以及元流程自检 probe-criterion-precheck。
- probe-ontology-values 被 4 个标准测试 import（tests/l4、tests/ontology）；其余 probe 有专属测试但无产品入口。
- probe-ladder、check-acceptance-matrix、validate_doc_contract、gen-task-board、gen-cto-health、generate-dashboard、weekly-recon 有真实入口，本批保留。

## 决定

- A：删除 probe-criterion-precheck 及其专属测试、fixture、基线登记。
- B：先迁移有效产品判据到 tests/contract／tests/user-visible／现有标准产品测试，真实通过后再删旧 probe 与专属测试；共享测试 oracle 放 tests/support；不改产品代码/公开契约。
- C：看板与现役入口全部保留，不删除/不改写生成物。

## 依据

- Issue #1478 任务书（CTO 裁定 A＋B 继续，C 不动）。
- 真实调用链：probe-ontology-values 的 4 个测试 import；probe-ladder PROBES 注册表；check-doc-contract.sh exec validate_doc_contract；weekly-recon-launchd 调用 weekly-recon。
- 迁移原则：真实产品入口、独立期望值、至少一个改坏反例、先迁移后删除。

## 生效时点

- 合并本 PR 后生效；回退 = 单 PR revert；触发硬停止的单项保留旧 probe 并记录证据。
