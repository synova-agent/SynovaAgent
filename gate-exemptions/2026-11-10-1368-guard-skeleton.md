# review: #1368
# #1368 W3 骨架配套：`.dsh/skills/**` 是 `.synova/skills/**` 的仓内镜像（sync-dsh-skills 生成）；本批改 squad-discipline／dsh-code-standards／dev-doc-spec 三份源与模板，镜像随动，按门禁要求补豁免。
# 证据：claim .claude/claims/1368.yaml；门禁事实来自 #1319 G2 收口（唯一必需 context）与裁定 v1.0 §3.1.1；doc-truth 改动前后均通过。
# 边界：只覆盖镜像同步、本豁免自覆盖与 DOCS-REGISTRY 登记行；不改门禁脚本、工作流、分支保护。
- .dsh/skills/** — 双轨 skills 的 .synova 源同步镜像，变更受任务 #1368 授权 — #1368
- docs/authority/DOCS-REGISTRY.yaml — 为本批新增豁免件补 DOC-1368-01 登记行 — #1368
- gate-exemptions/2026-11-10-1368-guard-skeleton.md — 本豁免文件自覆盖（#623 清单与豁免目录自我保护）— #1368
