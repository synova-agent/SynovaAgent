# 双角色预设与 Skill 修订实施（#1323 · Win 实施端）

- **状态**: proposed（仓内已实施；待独立复核；运行态已安装但新会话未验证）
- **日期**: 2026-11-04
- **卡**: #1323 ｜ 本地分支 `docs/1323-preset-skill-revamp`（远端 PR 分支 `docs/1323-preset-skill-revamp-r2`，PR #1329）｜ 基线 `gitea/main` `97da9b7c`（rebase 后，2026-11-04；原基线 `49d9fee36`）
- **依据**: `产品宪章-v8.4-最小修订案-2026-11-04.md`（已落位 #1321/#1322）＋ `CTO-DEVDOC-Coding双角色预设与Skill修订方案-v1.0-2026-11-04.md` ＋ `DSH开工指令-宪章v8.4与双角色预设修订-2026-11-04.md`
- **上游边界**: 宪章 v8.4 权威原件/镜像/AGENTS 同步由 **#1321/#1322** 落位；门禁判据源切裁定 v1.0（T1）由 **#1324** 落位；源件 7 份由 **#1317** 归档。本卡只做**实施端**，不重复上述工作。
- **决策**: 按已批准方案修订 CTO / DEV DOC / 关卡 A / coding 四端预设与 skill，并最小同步根 `AGENTS.md` 角色入口与交接契约；**不新增任何门禁、台账或统计指标**。
- **理由**: 方向源头（宪章/优先级/边界/锁版）已落位；若预设与 skill 仍沿用旧口径，执行端只会更准确地执行旧方向。

## 一、做了什么（范围）

| 阶段 | 内容 | 文件 |
|---|---|---|
| 1 | CTO＝模块产品与技术负责人：权威顺序／一会话一模块／模块锚卡／六步／11 条停点／风险触发一次独立复核／八+六字段交接契约；根入口同步 | `.synova/skills/cto-handover/SKILL.md`（＋镜像）｜`docs/synova/presets/synova-cto/{persona-block.yml,preset.yml,README.md}`｜`AGENTS.md` |
| 2 | DEV DOC v4（八节）＋关卡 A 收缩（风险触发／一个复核者／五问）＋编码指令模板重写 | `.synova/skills/dev-doc-spec/SKILL.md`、`template/编码指令模板.md`、`.synova/skills/devdoc-gate-a/SKILL.md`（＋镜像） |
| 3 | 执行端：队长接单核前提/按需协作规模/带证据退回；coding 开工四问＋单任务轻量流程/不冒充独立验收；两 skill 收缩；两份 preset 元数据与 coding README 同步 | `.synova/skills/{squad-discipline,dsh-code-standards}/SKILL.md`（＋镜像）｜`docs/synova/presets/synova-coding/{cordis.patch.yml,preset.yml,README.md}`｜`docs/synova/presets/synova-squad-lead/{cordis.patch.yml,preset.yml}` |

**文件数（rebase 后命令口径）**：`git diff --name-status gitea/main..HEAD` = **25**（19 个源文件 ＋ 6 个 `.dsh/skills/**` 镜像）；排除 `.dsh` = **19**（15 个实施文件 ＋ 门禁豁免件 ＋ `DOCS-REGISTRY` 的 `DOC-1323-01` 登记行 ＋ claim ＋ 本 Note）。`git diff --stat` 汇总见提交回执。

## 二、状态区分（不得合并成"全部完成"）

- **修订案**：已批准（2026-11-04，六项全部通过）。
- **权威原件/镜像**：**已由 #1321/#1322 落位**；门禁判据源**已由 #1324（T1）** 落位。本卡**未**推翻或重复这些落位；仅按门禁要求在 `DOCS-REGISTRY.yaml` 追加 `DOC-1323-01` 登记行（配合 `.dsh/skills/**` 镜像豁免件，二者均为让 CI 登记/门禁保护两条硬门通过所必需）。
- **仓内文件**：已修改（25 文件 = 19 源 ＋ 6 镜像），7 个提交；已推送远端 r2 分支并以 **PR #1329** 提交（原 PR #1325 因 CI 失败＋需 rebase 被 CTO 排期关闭；#1326/#1328 因回执时序（R7）由 #1329 取代）。
- **安装**：已完成（synova-cto / coding / squad-lead 运行态已落位；重启 DSH 后新会话生效）。
- **新会话行为**：**未验证**（需重启 DSH 后新开 CTO/队长/编码三会话，由人核；旧会话不作证据）。

## 三、边界与不做什么

- 不新增门禁/配额/台账/元门禁；不改 `scripts/audit/**`；不改产品业务代码；不实施 GATE-STANDARD W0–W9；不推 main。
- 不重复 #1321 的宪章落位，不改 `docs/synova/产品宪章-v8.4-镜像.md`。
- 旧口径（9 问 9 节／G1–G6／所有任务强制关卡 A／固定团队人数／固定 DSH 版本·SHA／门禁盘点前置／取号／task-state 回填）只出现在"已删除/历史"声明处。
- `check-preset-bundles.sh --repo` 对 synova-squad-lead 仍红、`sync-dsh-skills.sh --check` 仍报 3 个本机额外技能：均为**改前就存在**（另案处理），本卡未动门禁实物。

## 四、回退（以仓库基线为准，本卡**不保留**运行态 `.bak`）

- 仓内：`git checkout <基线> -- <文件>`；或反向应用本卡 patch。
- 运行态：`git checkout <基线> -- <仓库源>` 后重跑 `bash scripts/control-tower/install-dsh-preset.sh --install synova-coding synova-squad-lead`；CTO 运行 bundle 需按 `docs/synova/presets/synova-cto/README.md` 的步骤从基线 `persona-block.yml` 重生成并覆盖 profile 副本。然后重启 DSH。
- 不提供"一键回滚脚本"；门禁与运行时以实物为准。
