# Task Brief: D705 cto-docs-batch-d593-confirm-backlog

> 生成: 2026-09-11 | 任务: D705 | 认领: synova-cto
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
CTO 台账记账批次（非五层）。两件事：① K3 D593-FIX2 复审条件②（CTO 确认 #476 的
Architecture job 结论）——CTO 以 GitHub API 实抓 job 级物证写入 task-state/D593.json，
供 K3 批复 PASS 升级；② CTO 亲历的 3 个控制塔缺陷登记 board-backlog.json
（D665 期间实证：synova-commit 删除项丢失 / brief 双解析器口径 / D660 潜伏地雷）。
### b) 文件审计
- task-state/D593.json：现状 audited + fix_task_id=fix/d593-restore（K3 2026-09-10 复审
  CONDITIONAL PASS），无 cto_confirmation 字段——本批次新增
- docs/synova/coordination/board-backlog.json：#482 合并后 19 条，无上述 3 个 PLAN id
  （grep 实证零重复）
### c) 决策
新增字段/新增条目，零删改既有内容（append-only 记账）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- memory 教训：M2 声称vs事实（物证必须 API 实抓非推断）；铁律 0（先对齐——认领制
  要求独立任务号，D665 范围不含本批次，alloc D705 防混同）。
- 参考：第一性原理（台账=不遗忘机制，登记不问创始人）→ 结论：物证 + append-only。

## Q2: 范围 — 正确的最简方案
做什么：
- task-state/D593.json — 新增 cto_confirmation 字段（条件②物证 + K3 批复请求）
- docs/synova/coordination/board-backlog.json — 追加 3 条 PLAN（synova-commit-deletion-loss/
  brief-archlayer-dual-parser/d660-brief-latent-mine）
- .claude/task-briefs/2026-09-11-D705-cto-docs-batch-d593-confirm-backlog.md — 本 brief
- task-state/D705.json — 状态登记
- .claude/bypass.log — hook 追加的提交证据行入库（append-only）
- task-state/D664.json — 旧 CTO 本地 alloc 壳从未入库，随批登记
- .claude/task-briefs/2026-09-10-D664-pre-commit-check-grep-p-self-clean.md — D664 已填
  brief 入库（派单材料）
- docs/synova/coordination/CTO-交接-518bfe33-新CTO接入-20260910.md — 交接文档入库
- docs/synova/coordination/CTO履职总账-旧CTO-4d509874-提取20260909.md — 前任履职总账入库
不做什么：
- 不改 docs/synova/audit-reports/ 下任何 K3 报告（审计产物只读）
- 不改 scripts/audit/audit-rules.sh（K3 红线）
- 不改 src/server.ts（产品代码与本任务无关）
- 不改 memory/notes/ 下既有四态文件

## Q3: 验收 — 入口 → 交互 → 结果
入口：K3 下轮审计读取 task-state/D593.json
处理：cto_confirmation 物证 + backlog PLAN 条目
结果：两个 JSON 合法（python json.load 通过）；K3 可据此批复条件②

## 架构层: 基础设施（控制塔台账，非五层）
CTO 台账记账批次，不属于五层产品架构

## Done 标准:
- [ ] python3 json.load 校验 task-state/D593.json 与 board-backlog.json 均通过
- [ ] grep cto_confirmation task-state/D593.json 命中
- [ ] python3 解析 board-backlog.json 含 PLAN-synova-commit-deletion-loss 条目
