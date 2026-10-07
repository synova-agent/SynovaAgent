# Task Brief: D732 plan-and-gates（主线计划 + 派单必读门禁）

> 生成: 2026-09-13 | 任务: D732 | 认领: 主 CTO（synova-cto）
> 参考: 创始人指令「写一个文档把整个计划落盘；每次派单前必读；必须落地之后再回归主线」

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理机制落地（非五层）。把「主线计划」与「派单前必读」落成**机器可执行**的两件：计划文档为单一事实源；派单文档必须锚定计划版本+哈希。
### b) 文件审计（实测）
- 原 #536 有 24 文件 → 被 D734 PR 预算门禁判超限 → 两个机制卡在分支上未进 main（实测 main 无计划文档、第⑩项命中 0）
- 本 PR 从 #536 抽出**机制生效所需的 11 文件**（≤12 上限）
### c) 决策
拆小 PR 直插 main；后续文档/登记类内容另开 PR。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 47：声明必须由物理证据支撑 → 「读没读计划」用哈希校验而不是自觉
- 历史教训：D732 前 CTO 派单未复核（越域/内部矛盾/写错路径三次）；本次把复核脚本化
### 参考：铁律 47 + 本日三次派单缺陷 → 用哈希锚定 + 生成器消除声明层漂移

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/整体推进计划-主线-20260913.md — 主线单一事实源（三支柱/三阶段/11 条机制/资源上限）
- scripts/control-tower/pre-dispatch-check.sh — 第⑩项：派单必须锚定计划版本+哈希（附第⑨项内部一致性）
- tests/control-tower/pre-dispatch-check.test.sh — 其密封测试（7 断言）
- scripts/control-tower/gen-plan-status.py — 计划任务区块从 task-state 真相源重生成
- tests/control-tower/gen-plan-status.test.sh — 其密封测试（5 断言）
- .claude/skills/pre-dispatch-check/SKILL.md — 复核技能（八项+⑨⑩）
- .dsh/skills/pre-dispatch-check/SKILL.md — 同上（双写，D370 同步）
- .claude/skills/cto-handover/SKILL.md — 硬接入「派单前必读计划」
- .dsh/skills/cto-handover/SKILL.md — 同上（双写）
- .claude/task-briefs/2026-09-13-D732-dispatch-batch3-registration.md — 本 brief
- memory/notes/implemented/2026-09-13-pre-dispatch-check-process.md — 决策 Note（铁律 49）
不做什么：
- 不改 scripts/audit/（审计红线）
- 不改 .github/workflows/ci.yml（批 C merge queue 集中改）
- 不带入 #536 的派单文档与 task-state（另开文档 PR）
- 不改 dsh/plugins/task-board-adapter/（看板修复归并行 CTO 在途任务）

## Q3: 验收 — 入口 → 交互 → 结果
入口：CTO 每次派单前 / 任何人读计划文档
处理：跑 pre-dispatch-check（十项，含计划哈希锚定）；计划区块由生成器重生成
结果：派单必须引用 `依据计划: v<版本>@<哈希>`，哈希不符即拒；计划任务表与真相源一致

## 架构层: 基础设施（治理机制，非五层）
变更面限 docs/synova/coordination/ + scripts/control-tower/ + tests/control-tower/ + skills 双写 + 一份 Note

## 主线贡献: infra:派单前复核与计划锚定（治本日三次派单缺陷，属支撑但为并行前提）
## 域: mac

## Done 标准:
- [ ] 两个测试全绿：bash tests/control-tower/pre-dispatch-check.test.sh → 7 通过 0 失败；bash tests/control-tower/gen-plan-status.test.sh → 5 通过 0 失败
- [ ] 计划文档含版本与哈希锚定节：grep -c '依据计划' docs/synova/coordination/整体推进计划-主线-20260913.md → ≥1
- [ ] 第⑩项在位：grep -c '主线计划锚定' scripts/control-tower/pre-dispatch-check.sh → ≥1
- [ ] 生成器幂等：连跑两次 gen-plan-status.py → 第二次输出「无变化」
