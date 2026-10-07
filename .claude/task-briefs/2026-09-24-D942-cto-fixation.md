# Task Brief — D942 CTO 固化（方向·研究院结论·技能·预设入仓）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
治理/固化面，不动 src/**。触发：创始人指令"把今天确定的方向与任务固化到预设/skill/系统提示里，每个任务都不许忘记"。
文件审计：`docs/synova/coordination/CTO-固化-*`（新建）；`.claude/skills/cto-handover/SKILL.md`（加开工首件节）；`docs/synova/presets/synova-cto|synova-k3-audit/`（预设入仓，解 G3）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：Anthropic/第一性原理 + 结论=**纪律必须落到"每次开工必读"的载体上，否则必然遗忘**。
历史：M3（机制建成未接线）；院方 7.6 七环（错误高发在②综合环）。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/CTO-固化-最终方向与在制任务-20260924.md（固化 I：分工/开发模式/验收链/五条口径纪律/红线/五卡/在飞PR/待裁）
- docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md（固化 II：宪章级/TD-001/议程六条纪律+七环/议题状态/错误清单与裁定/边界D方法/MOVO挂起）
- .claude/skills/cto-handover/SKILL.md + .dsh/skills/cto-handover/SKILL.md（加"开工首件"强制引用）
- docs/synova/presets/synova-cto/、docs/synova/presets/synova-k3-audit/（预设入仓 + persona 内嵌固化指引）
- docs/synova/coordination/审计发现台账-DSH-CTO.md（引用豁免段）

不做什么：不改 scripts/**、不改 docs/synova/coordination/ownership.yaml、不碰 scripts/audit/**、不改 src/。

## 写集
| 文件 | 类别 |
|---|---|
| `docs/synova/coordination/CTO-固化-最终方向与在制任务-20260924.md` | task |
| `docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md` | task |
| `docs/synova/presets/synova-cto/**`、`docs/synova/presets/synova-k3-audit/**` | task |
| `.claude/skills/cto-handover/SKILL.md`、`.dsh/skills/cto-handover/SKILL.md` | task |
| `docs/synova/coordination/审计发现台账-DSH-CTO.md` | task |

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/workflow/sync-dsh-skills.sh --check`；引用门禁
处理：技能双写一致；固化件可核
结果：SYNC-OK（16 技能）；两份固化件引用违规 0；预设入仓（cto + k3-audit）

## 架构层
治理/固化（docs/synova + .claude/skills；不触五层依赖图）

## Done 标准
- [ ] `sync-dsh-skills.sh --check` → SYNC-OK
- [ ] 固化 I/II 引用门禁违规 0
- [ ] `docs/synova/presets/synova-cto/` 与 `synova-k3-audit/` 各含 preset.yml + persona-block.yml（含固化指引段）
