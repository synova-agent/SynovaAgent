# D1034 — cto-handover 加「派单模板 v2」（预置坑位）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
CTO 自用 skill（开工必读）。新增一节"派单模板 v2"：把执行者会踩的坑预置进派单。
### b) 文件审计
grep 该 skill：§〇c 已引 （232 行），
但该区按契约 §7 属"待分流（过程性⇒出库）"。
### c) 决策
不就地改 coordination/ 那份；在 skill 新增 §〇c'（skill 属契约 §3 闸 3 豁免类，且是开工必读）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 今天实证：执行方反复被 CI 绊住（反复 sync / 取消 35 分钟 job / Q2 缺路径三连锁红 /
  squash×union 假冲突）⇒ 根因是"派单里没写他们会踩什么"
- 同族：教训库 L-018（复利要靠"必经路径"，不是"记在库里等人查"）
- 参考：Anthropic 工程基线（把约束写进执行者必经的载体）

## Q2: 范围 — 正确的最简方案

做什么：
- .claude/skills/cto-handover/SKILL.md — 新增 §〇c' 派单模板 v2（九段结构）
- .dsh/skills/cto-handover/SKILL.md — 同上（**逐字节一致**）
- .claude/task-briefs/2026-09-27-D1034-dispatch-template-v2.md — 本 brief
- memory/notes/implemented/process/2026-09-27-dispatch-template-v2.md — 决策 Note
- .claude/current-brief — 指向本 brief
- .claude/bypass.log — hook 自动登记

不做什么：
- 不改 docs/synova/coordination/派单模板.md（该区按契约 §7 属待分流/过程性⇒出库）
- 不改任何门禁脚本（scripts/**）
- 不改 .github/workflows/ci.yml
- 不改 docs/synova/DOC-CONTRACT.md
- 不改 src/** 产品代码

## Q3: 验收 — 入口 → 交互 → 结果
入口：CTO 派单前读 skill §〇c（开工必读）
处理：按 §〇c' 九段结构写派单，尤其 ③ 门禁合规 与 ④ 推送纪律
结果：派单自带"避坑"，执行者不必边做边撞

## 架构层: N/A（治理层）

## Done 标准
- [ ] 双份 skill md5 一致 —— verify: md5 -q 两份相同
- [ ] §〇c' 存在且含"门禁合规"与"推送纪律"两段 —— verify: grep -c '〇c' 与 grep -c '推送纪律'
- [ ] 不触及 coordination/ 那份模板 —— verify: git diff --name-only origin/main...HEAD | grep -c 'coordination/派单模板'
