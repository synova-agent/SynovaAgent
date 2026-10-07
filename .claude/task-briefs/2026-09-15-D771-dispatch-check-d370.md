# Task Brief: D771 派单前复核脚本 D370 类崩溃修复 + 幻号/欠登记 task-state 补登记 + B 卡派单文档

> 生成: 2026-09-15 | 分支: fix/d771-dispatch-check-d370 | as any: 0
> 域: mac（scripts/control-tower = Mac 域；task-state 属域判定豁免）单域
> 主线贡献: infra:派单前复核（CTO 自己每天用的门禁）+ 看板可信度
> 触发: D770 派单期间实测——pre-dispatch-check.sh 第②项在第 92 行崩溃（unbound variable）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
`scripts/control-tower/pre-dispatch-check.sh` 是 CTO 的**派单前机械复核**（10 项），D770 实测它在第②项（前置 PR 合并状态）崩溃 → 复核在最后一步静默中断，等于**门禁假绿**。本任务修它，并把连带发现的登记债补齐。

### b) 文件审计（实测）
- `scripts/control-tower/pre-dispatch-check.sh:92`：`echo "  PR #$pr → $st（派单若声称"已合"须与此一致）"` → `$st（` 被 bash 解析为变量名 `st（` → `set -u` 下 unbound variable（D370 类）。
- 同类扫描：`grep -rnE '\$[A-Za-z_][A-Za-z0-9_]*[（）：、，。「」【】]' scripts/` 命中 38 处（含注释/无 set -u 脚本，多为存量）。
- 登记债实测：D742/D743/D745/D746/D747 全历史无 task-state（幻号）；D598/D599 交付物已并入 main（#427/#431）但无 task-state。

### c) 决策
修法用花括号显式边界（`${st}`）；不顺带批量改 38 处存量（范围控制；存量由 D738 的常驻扫描门禁覆盖——该卡正是为此存在，当前仍在 PR #544 未合）。幻号一律补登记：有交付物的记 impl_done、占位号记 rejected。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 脚本在含 PR 号的派单文档上跑完 10 项不崩；幻号清零。
② 测试 = 以真实派单文档回放（`pre-dispatch-check.sh docs/synova/coordination/派单-D760-D769-DSH借鉴卡-20260915.md`）为验收，非 mock。
③ 实现 = 1 行花括号修复 + 9 个 task-state + 1 份派单文档。
④ 接线 = 脚本已被 CTO 流程调用（D732 起固化），无需新接线。
⑤ 验证 = 修复前崩溃输出 / 修复后「✅ 机械项全通过」两次原始输出。

引用依据：
- ctrl-tower-change 模式 2（D370）：全角标点紧贴变量必须加花括号
- 铁律 24/11：门禁不允许静默中断——本次是「崩在最后一项」= 结论失真
- D384：不许幻号；D738（未合）：`$VAR` 全角边界常驻扫描门禁正是为覆盖本类

### b) 本任务执行约束
- rule: "修复后 10 项跑完不崩" verify: "bash scripts/control-tower/pre-dispatch-check.sh <派单文档> → 末行「✅ 机械项全通过」（exit 0）"
- rule: "幻号清零" verify: "for id in D742 D743 D745 D746 D747 D598 D599; do test -f task-state/$id.json; done → 全存在"

### c) 决策参考系
参考：第一性原理（门禁崩溃 = 最贵的假绿）+ ctrl-tower-change 模式 2 → 最小修复（1 行），存量扫描交由既有卡（D738）。

### d) 相关 Note 引用
无（未触治理脚本区外规则文档；D534 触发面为 scripts/{control-tower,workflow,hooks} 的**非 .sh 修复**判定——本次为 .sh 修复且未改规则文档，Note 门禁实测通过）。

## Q2: 范围 — 正确的最简方案

做什么：
- scripts/control-tower/pre-dispatch-check.sh — 第 92 行 `${pr}`/`${st}` 花括号边界 + 内层双引号改「」（1 行）
- task-state/D742.json · D743.json · D745.json · D746.json · D747.json — 补登记（3 真任务 + 2 作废占位）
- task-state/D598.json · D599.json — 补登记（B-03 / B-09+B-10，交付物已在 main）
- task-state/D770.json · D771.json — 本批两任务的自身台账
- docs/synova/coordination/派单-D760-D769-DSH借鉴卡-20260915.md — B 卡派单文档（执行方规则/顺序/硬守卫）

不做什么：
- 不改 scripts/pre-commit-check.sh（本地门禁主脚本不在本单）
- 不改 scripts/control-tower/gen-plan-status.py（生成器不动）
- 不改 docs/synova/research/DSH迁移施工图-20260820/**（上游图纸只引用）
- 不改 scripts/audit/**（K3 红线）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：CTO 发派单前跑 `bash scripts/control-tower/pre-dispatch-check.sh <派单文档>`
处理（中间步骤）：逐项机械复核（任务号登记 / 写集路径 / file:line / 计划锚定 hash / 内部一致性 / 前置 PR 状态）
结果（最终展示在哪）：末行「✅ 机械项全通过」（exit 0）；幻号 ID 看板可见

## 架构层: scripts（控制塔：派单复核门禁）；不触 L1-L5
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: `bash scripts/control-tower/pre-dispatch-check.sh docs/synova/coordination/派单-D760-D769-DSH借鉴卡-20260915.md` → 末行 ✅ 机械项全通过
- [ ] 反向验证: verify: 修复前的 `$st（` 形态回放 → `unbound variable` 崩溃（原始输出入 PR 正文）
- [ ] 幻号清零: verify: `for id in D742 D743 D745 D746 D747 D598 D599; do test -f task-state/$id.json || echo MISSING $id; done` → 无 MISSING
- [ ] 结果可见: verify: `grep -c "依据计划: v1.2@" docs/synova/coordination/派单-D760-D769-DSH借鉴卡-20260915.md` → 1

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-15-D771-dispatch-check-d370.md | task |
| docs/synova/coordination/派单-D760-D769-DSH借鉴卡-20260915.md | task |
| memory/notes/implemented/2026-09-15-dispatch-check-d370-crash.md | task |
| scripts/control-tower/pre-dispatch-check.sh | task |
| task-state/D598.json | task |
| task-state/D599.json | task |
| task-state/D742.json | task |
| task-state/D743.json | task |
| task-state/D745.json | task |
| task-state/D746.json | task |
| task-state/D747.json | task |

