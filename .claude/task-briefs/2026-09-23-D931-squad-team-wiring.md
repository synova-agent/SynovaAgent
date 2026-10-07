# Task Brief — D931 小队执行形态接线（队长预设挂 Agent Teams + 派单硬字段 + 纪律条）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

治理/组织形态面，不动 src/** 产品代码。触发：创始人 2026-09-23「小队是摆设、队长预设没到位」。
文件审计：`docs/synova/presets/install-squad-lead.sh`（25 行，复制 CTO 组成 + 换 persona）；落位后预设第 210 行 = legacy `delegation`；DSH 侧 team 三包 = `@deepseek-ai/dsh-experimental-{agent-team,tool-agent-team,client-ui-agent-team}`（样板见 DSH `apps/web/tests/agent-team-panel.overlay.yml:24`）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/第一性原理 + 结论=**能力必须接在正确的载体上，且编制约束要物理化**。
历史：M3（机制建成未接线）；D926（纪律技能化但未接线团队机制）。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- docs/synova/presets/install-squad-lead.sh — delegation → agent-team/tool-agent-team/ui-agent-team（含 config，maxMembers=4）+ 修全角变量 bug
- docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md — 增「团队机制」节
- .claude/skills/squad-discipline/SKILL.md、.dsh/skills/squad-discipline/SKILL.md — 增「团队机制」节（双写）
- docs/synova/coordination/派单模板.md — 增「执行形态」硬字段节
- task-state/D931.json、.claude/task-briefs/2026-09-23-D931-squad-team-wiring.md

不做什么（含文件路径）：
- 不改 scripts/control-tower/install-dsh-preset.sh（其 G1 探测缺口另行开卡）
- 不改 scripts/audit/**（审计红线）、不改 src/ 产品代码

## 写集

| 文件 | 类别 |
|---|---|
| `docs/synova/presets/install-squad-lead.sh` | task |
| `docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md` | task |
| `.claude/skills/squad-discipline/SKILL.md` | task |
| `.dsh/skills/squad-discipline/SKILL.md` | task |
| `docs/synova/coordination/派单模板.md` | task |
| `task-state/D931.json` | task |
| `.claude/task-briefs/2026-09-23-D931-squad-team-wiring.md` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash docs/synova/presets/install-squad-lead.sh $(pwd)` + 落位后 grep 校验
处理：预设组成替换 + 三处文本接线
结果：`agent-team:1 tool-agent-team:1 ui-agent-team:1 残留 delegation:0 | maxMembers:4`；技能 SYNC-OK

## 架构层

治理/组织形态（`docs/synova/presets` + `.claude/skills`；不触五层依赖图）

## Done 标准

- [ ] 落位后预设 grep：agent-team/tool-agent-team/ui-agent-team 各 1、delegation 0、maxMembers 4
- [ ] `bash scripts/workflow/sync-dsh-skills.sh --check` → SYNC-OK
- [ ] 派单模板含「执行形态」节（缺一不派）；队长预设与纪律技能均含「团队机制」节
