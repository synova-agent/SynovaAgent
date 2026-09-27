# D1023 — cto-handover skill 补「派单前附相关教训」（复利机制）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
CTO 自用 skill（开工必读）。补一节派单纪律：把"经验教训库"的条目附进派单。
### b) 文件审计
grep 该 skill：§〇c ① 第 6 项已要求"上一轮教训 → 派单引用"，但**未说来源**。
双份（.claude/skills + .dsh/skills）须逐字节一致（组 13 门禁）。
### c) 决策
不改派单流程本身，只①补来源指引 ②加一节 §〇d 说明"挑 2–3 条 + 对应表"。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 同型教训：§〇b（漏"借鉴 DSH"⇒ 执行方自研一轮）⇒ 派单是最易漏的高频动作
- 创始人 2026-09-27：「记下来只是给人看；**附进派单**才是下一批开工就带着它」
- 参考：Anthropic 工程基线（把纪律写进"开工必读"载体，而非依赖记性）

## Q2: 范围 — 正确的最简方案

做什么：
- .claude/skills/cto-handover/SKILL.md — ① §〇c ① 第 6 项补"来源" ② 新增 §〇d
- .dsh/skills/cto-handover/SKILL.md — 同上（**逐字节一致**）
- .claude/task-briefs/2026-09-27-D1023-skill-lessons-ref.md — 本 brief
- memory/notes/implemented/process/2026-09-27-skill-lessons-ref.md — 决策 Note
- .claude/bypass.log — post-commit hook 自动登记

不做什么：
- 不改派单模板（docs/synova/coordination/派单模板.md）
- 不改任何门禁脚本、不改 .github/**
- 不改 skill 的其他章节

## Q3: 验收 — 入口 → 交互 → 结果
入口：CTO 派单前读 skill（开工必读）
处理：按 §〇d 打开教训库 → 挑 2–3 条相关条目
结果：派单指令里带上这几条的「判据」+「防线」

## 架构层: N/A（治理层）

## Done 标准
- [ ] 双份 skill md5 一致 —— verify: md5 -q 两份，输出必须相同
- [ ] §〇d 存在且含"对应表"（派什么→附哪几条）—— verify: grep -c '〇d' 两份均 =1
- [ ] §〇c ① 第 6 项含来源路径 —— verify: grep -c '经验教训库' 两份均 ≥2
