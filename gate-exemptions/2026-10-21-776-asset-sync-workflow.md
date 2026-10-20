# 豁免 · #776 PR-2 资产同步 workflow（push→local-main 自动同步 ASSET-AUTO 段 ＋ #769）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**CTO 裁 277**
> （限段真跑：只改 M1–M10 段 ＋ #769，不建卡）＋ 规格 `.handbook/派单件/2026-10-21-规格-776-资产同步.md`
> §7 红线②（CI 拦 `.gitea/` 改动 ⇒ 走本目录登记，不得绕过/`--no-verify`）。逐行三段式，不整文件生效。
> 本件是 PR-1（`2026-10-21-p6-776-asset-sync.md`）之后的**独立送审**一件：`.gitea/AGENTS.md` 要求
> workflow 改动单列 PR，禁与业务改动同 PR。

- .gitea/workflows/asset-sync.yml — #776 PR-2 新建：push→local-main 时调 asset-sync.py 同步 ASSET-AUTO 段＋#769；独立工作目录、permissions 最小集、三态退出码原样透传（0 绿／1 真红／2 降级均不吞） — #776
- gate-exemptions/2026-10-21-776-asset-sync-workflow.md — 本豁免文件自身（受保护目录自我保护，需自覆盖） — #776
- docs/authority/DOCS-REGISTRY.yaml — 登记本豁免件（DOC-0236），D782 D2 登记门禁要求新文档入台账 — #776
