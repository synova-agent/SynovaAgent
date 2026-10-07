# Task Brief: D377: CTO 交接文档定稿 + 任务编号规范 + 文档状态澄清

> 生成: 2026-08-16 | 分支: feat/d376-routing-charter-v4 | as any: 0

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属基础设施（coordination 协作宪法）。创始人 2026-08-16 指示：① 过渡 CTO 写完整交接文档给真正 CTO ② DSH 线任务编号改为 SYNOVA-IMPL-DSH-{任务名}-{YYYYMMDD}.md（不再向 Codex 拿 D#）③ 澄清 D376 里两份文档"定稿/草稿"矛盾。

### b) 文件审计
- TASK-ROUTING.md v4（D376 已提交）：改任务编号规则
- DIVISION-CHARTER-v4.md（D376 已提交）：头"草稿待审"改"已定稿"
- cto-handover SKILL.md：重写为完整交接文档（14 节）
- 关系: 修正 + 补全

### c) 决策
任务编号双轨（DSH 用 SYNOVA-IMPL-DSH，Claude 用 D#），并行不冲突。参考：DeepSeek/第一性原理（去掉向 Codex 拿号的往返摩擦）——收敛。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC → ② 测试（coordination 文档，靠解析/一致性）→ ③ 实现（已改）→ ④ 接线（cto-handover 被 CTO persona 引用）→ ⑤ 验证。
引用铁律 0（先对齐）、47（契约）。

### b) 执行约束
- rule: "交接文档是 CTO 单一事实源"
  verify: "grep -n '任务编号规范' .claude/skills/cto-handover/SKILL.md"

### c) 决策参考系
参考：DeepSeek/第一性原理（去掉拿号摩擦）——收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- docs/synova/coordination/TASK-ROUTING.md
- docs/synova/coordination/dsh-division-draft/DIVISION-CHARTER-v4.md
- .claude/skills/cto-handover/SKILL.md
- .dsh/skills/cto-handover/SKILL.md

不做什么：
- 不改 src/server.ts（业务代码，独立任务）

## Q3: 验收 — 入口 → 交互 → 结果

入口：CTO session 开工读 cto-handover
处理：读交接文档 + 三仪表盘 → 接手
结果：真正 CTO 无缝接手，任务编号自定，文档状态一致

## 架构层: 基础设施

#CRITERIA: A

## Done 标准
- [ ] grep -n "SYNOVA-IMPL-DSH" .claude/skills/cto-handover/SKILL.md docs/synova/coordination/TASK-ROUTING.md 命中
- [ ] bash scripts/workflow/sync-dsh-skills.sh --check 返回 exit 0
