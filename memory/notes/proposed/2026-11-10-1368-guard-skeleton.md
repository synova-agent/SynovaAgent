# 决策: #1368 W3「一开始就做对」骨架配套按新门禁对齐

状态: proposed
日期: 2026-11-10

## 现状

`#1319` 收口后，main 的唯一必需 context 是 `core-gates / core (pull_request_target)`（受信 base workflow ＋ 显式检出 PR head SHA）；旧 `local-gates` 只保留 `workflow_dispatch` 手动；`pre-commit-check.sh` 只是本地软提示。但根 `AGENTS.md` §8、`.synova/skills/{squad-discipline,dsh-code-standards}`、`docs/synova/presets/{synova-coding,synova-squad-lead}` 与 DEV DOC 规格仍按旧口径描述（旧门为 CI 权威、`SYNO_CI=1` 硬阻断），agent 会照旧流程判断「能不能合」；同时验收未要求用户可见行为回归，同类「改 B 坏 A」回归缺省漏检。

## 决定

按 #1368 四切片做**指针化同步、不复制正文**：

1. 根 `AGENTS.md` §8 改为新门禁事实（唯一必需 context、受信事件来源、旧门仅手动、pre-commit 软提示定位不变），尺寸仍 ≤65,536 B，改前先跑 doc-truth。
2. `squad-discipline` 新增 §八「验收口径：用户可见行为回归必填」＋按行为切片＋禁冒充验证；`dsh-code-standards` 在稳定原则、按对象适用表与交付前自检补对应要求。
3. `docs/synova/presets/` 的 `synova-coding`、`synova-squad-lead` persona 只加验收口径与唯一门禁指针。
4. `dev-doc-spec` §7 与 `template/编码指令模板.md` §五补「用户可见行为回归」字段。

`.synova/skills`（单一事实源）改完以 `scripts/workflow/sync-dsh-skills.sh --apply` 同步 `.dsh/skills` 镜像。不新增门禁、必需 context、回归台账或人工矩阵。

## 依据

- 门禁事实取自实物：`.gitea/workflows/core-gates.yml`（`pull_request_target`、`CORE_HEAD_SHA` 显式检出、受信输入预检）、`.gitea/workflows/local-gates.yml`（仅 `workflow_dispatch`）、`#1319` G2 收口评论（唯一必需 context）与裁定 v1.0 §3.1.1（用户可见行为回归＝补测试，不新增门禁）。
- 改前与改后各跑一次 `bash scripts/doc-system/check-doc-truth.sh`，原始输出与本件 PR 回执同处留证。

## 生效时点

本 Note 随 #1368 PR 记录治理口径变更；只有 CTO 审批后合并才生效。合并后新会话按新口径施工，旧口径描述只作历史。
